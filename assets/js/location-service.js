/**
 * Shared location helpers: resilient geolocation, manual-location fallback and
 * safe persistence. Pure logic with injectable dependencies (geolocation,
 * storage, fetch, clock) so it can be tested with node:test.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ReliefLocation = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STORAGE_KEY = 'userLocation';
  var GPS_TTL_MS = 24 * 60 * 60 * 1000;          // 1 day
  var MANUAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;   // 7 days
  var DEFAULT_TIMEOUT_MS = 10000;
  var NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

  // Used for map centring only when no location is saved. Not shown as the user's position.
  var DEFAULT_LOCATION = { lat: 22.9868, lng: 87.855, label: 'West Bengal (default)', source: 'default' };

  // Town coordinates taken from the facility data already in this repository.
  // They let the manual form work without a network request.
  var KNOWN_PLACES = [
    { label: 'Kolkata', lat: 22.5726, lng: 88.3639 },
    { label: 'Siliguri', lat: 26.7271, lng: 88.3953 },
    { label: 'Durgapur', lat: 23.5204, lng: 87.3119 },
    { label: 'Bankura', lat: 23.2329, lng: 87.0755 },
    { label: 'Purulia', lat: 23.3338, lng: 86.3648 },
    { label: 'Malda', lat: 25.0, lng: 88.15 },
    { label: 'Jalpaiguri', lat: 26.5167, lng: 88.7333 },
    { label: 'Cooch Behar', lat: 26.3167, lng: 89.4333 },
    { label: 'Krishnanagar', lat: 23.4, lng: 88.5 },
    { label: 'Haldia', lat: 22.0257, lng: 88.0583 },
    { label: 'Tamluk', lat: 22.3, lng: 87.92 },
    { label: 'Midnapore', lat: 22.425, lng: 87.32 }
  ];

  var MESSAGES = {
    denied: 'Location permission was denied. You can enter your town, village or PIN code below instead, or allow location access in your browser settings and try again.',
    unavailable: 'Your device could not work out its position. Check that location services are on, or enter your town, village or PIN code below.',
    timeout: 'Finding your location took too long. Try again, or enter your town, village or PIN code below.',
    unsupported: 'This browser does not support location. Enter your town, village or PIN code below.',
    notfound: 'We could not find that place. Check the spelling, or try a nearby town or a 6 digit PIN code.',
    network: 'We could not look up that place because the network is unavailable. Pick one of the suggested towns, or try again later.',
    invalid: 'Enter a town, village, address or a 6 digit PIN code.'
  };

  function messageFor(reason) {
    return MESSAGES[reason] || 'Something went wrong while getting your location. Please enter it manually.';
  }

  function makeError(reason, original) {
    var err = new Error(messageFor(reason));
    err.reason = reason;
    err.original = original;
    return err;
  }

  function isValidCoord(lat, lng) {
    return typeof lat === 'number' && typeof lng === 'number' &&
      isFinite(lat) && isFinite(lng) &&
      lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
  }

  // Number(null), Number('') and Number([]) are all 0, which would turn a malformed
  // geocoder or storage value into a real-looking point at 0,0. Accept only numbers
  // and non-empty numeric strings.
  function toCoord(value) {
    if (typeof value === 'number') return value;
    if (typeof value === 'string' && value.trim() !== '') return Number(value);
    return NaN;
  }

  /**
   * The one place that decides whether a latitude/longitude pair can be used for a map
   * or a distance. Accepts numbers and non-empty numeric strings; returns { lat, lng } as
   * numbers, or null for NaN, Infinity, null, booleans, empty strings, objects and anything
   * outside -90..90 / -180..180 (both ends included).
   */
  function normalizeCoords(lat, lng) {
    var a = toCoord(lat);
    var b = toCoord(lng);
    return isValidCoord(a, b) ? { lat: a, lng: b } : null;
  }

  // Keep roughly 1 km precision (2 decimals); nearby listings do not need more.
  function roundCoord(n) {
    return Math.round(n * 100) / 100;
  }

  function reasonFromGeoError(err) {
    var code = err && err.code;
    if (code === 1) return 'denied';
    if (code === 3) return 'timeout';
    return 'unavailable';
  }

  /**
   * One geolocation attempt. Resolves {lat, lng, source: 'gps'}; rejects with an Error
   * carrying .reason: denied | unavailable | timeout | unsupported.
   * A backup timer covers browsers that never call back.
   */
  function getPosition(options) {
    var opts = options || {};
    var geo = opts.geolocation !== undefined ? opts.geolocation
      : (typeof navigator !== 'undefined' ? navigator.geolocation : null);
    var timeout = opts.timeout || DEFAULT_TIMEOUT_MS;
    return new Promise(function (resolve, reject) {
      if (!geo || typeof geo.getCurrentPosition !== 'function') {
        reject(makeError('unsupported'));
        return;
      }
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        reject(makeError('timeout'));
      }, timeout + 1000);
      function finish(fn, value) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        fn(value);
      }
      try {
        geo.getCurrentPosition(function (pos) {
          var c = pos && pos.coords;
          if (!c || !isValidCoord(c.latitude, c.longitude)) {
            finish(reject, makeError('unavailable'));
            return;
          }
          finish(resolve, { lat: c.latitude, lng: c.longitude, source: 'gps' });
        }, function (err) {
          finish(reject, makeError(reasonFromGeoError(err), err));
        }, { enableHighAccuracy: false, timeout: timeout, maximumAge: opts.maximumAge != null ? opts.maximumAge : 300000 });
      } catch (e) {
        finish(reject, makeError('unavailable', e));
      }
    });
  }

  /** getPosition with retries for timeout/unavailable. Permission denial is never retried. */
  function getPositionWithRetry(options) {
    var opts = options || {};
    var retries = opts.retries != null ? opts.retries : 1;
    function attempt(left) {
      return getPosition(opts).catch(function (err) {
        if (left > 0 && (err.reason === 'timeout' || err.reason === 'unavailable')) {
          return attempt(left - 1);
        }
        throw err;
      });
    }
    return attempt(retries);
  }

  function getStorage(storage) {
    if (storage !== undefined) return storage;
    try {
      return typeof localStorage !== 'undefined' ? localStorage : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Builds the record that is saved. Format:
   * { lat, lng, label, source: 'gps' | 'manual', savedAt, expiresAt }
   */
  function buildRecord(loc, now) {
    var t = now != null ? now : Date.now();
    var source = loc.source === 'manual' ? 'manual' : 'gps';
    var ttl = source === 'manual' ? MANUAL_TTL_MS : GPS_TTL_MS;
    return {
      lat: roundCoord(loc.lat),
      lng: roundCoord(loc.lng),
      label: loc.label ? String(loc.label).slice(0, 120) : '',
      source: source,
      savedAt: t,
      expiresAt: t + ttl
    };
  }

  /** Reads a stored value. Accepts the new record, {lat,lng} and [lat,lng] (older formats). */
  function parseRecord(raw, now) {
    var value = raw;
    if (typeof raw === 'string') {
      try { value = JSON.parse(raw); } catch (e) { return null; }
    }
    var lat;
    var lng;
    if (Array.isArray(value)) {
      lat = toCoord(value[0]);
      lng = toCoord(value[1]);
    } else if (value && typeof value === 'object') {
      lat = toCoord(value.lat);
      lng = toCoord(value.lng);
    } else {
      return null;
    }
    if (!isValidCoord(lat, lng)) return null;
    var t = now != null ? now : Date.now();
    var isRecord = value && typeof value === 'object' && !Array.isArray(value);
    if (isRecord && typeof value.expiresAt === 'number' && value.expiresAt <= t) {
      return null;
    }
    return {
      lat: lat,
      lng: lng,
      label: isRecord && value.label ? String(value.label) : '',
      source: isRecord && value.source === 'manual' ? 'manual' : 'gps',
      savedAt: isRecord && typeof value.savedAt === 'number' ? value.savedAt : null,
      expiresAt: isRecord && typeof value.expiresAt === 'number' ? value.expiresAt : null
    };
  }

  /** Saves a valid location and returns the record. Bad coordinates are not stored: returns null. */
  function saveLocation(loc, options) {
    var opts = options || {};
    var coords = loc ? normalizeCoords(loc.lat, loc.lng) : null;
    if (!coords) return null;
    var record = buildRecord(Object.assign({}, loc, coords), opts.now);
    var store = getStorage(opts.storage);
    try {
      if (store) store.setItem(STORAGE_KEY, JSON.stringify(record));
    } catch (e) { /* storage blocked or full: the location is used for this visit only */ }
    return record;
  }

  function loadLocation(options) {
    var opts = options || {};
    var store = getStorage(opts.storage);
    if (!store) return null;
    var raw;
    try {
      raw = store.getItem(STORAGE_KEY);
    } catch (e) {
      return null;
    }
    if (raw == null) return null;
    var rec = parseRecord(raw, opts.now);
    if (!rec) {
      try { store.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
    }
    return rec;
  }

  function clearLocation(options) {
    var store = getStorage((options || {}).storage);
    try {
      if (store) store.removeItem(STORAGE_KEY);
    } catch (e) { /* ignore */ }
  }

  /** Saved location or the West Bengal default (for centring a map only). */
  function getLocationOrDefault(options) {
    return loadLocation(options) || DEFAULT_LOCATION;
  }

  function normalizeQuery(text) {
    return String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  }

  function isPinCode(text) {
    return /^[1-9]\d{5}$/.test(text);
  }

  function findKnownPlace(text) {
    var q = normalizeQuery(text).toLowerCase();
    if (!q) return null;
    for (var i = 0; i < KNOWN_PLACES.length; i++) {
      if (KNOWN_PLACES[i].label.toLowerCase() === q) return KNOWN_PLACES[i];
    }
    return null;
  }

  /**
   * Turns typed text (town, village, address or PIN code) into coordinates.
   * Known towns resolve offline; everything else is looked up with OpenStreetMap Nominatim.
   * Resolves {lat, lng, label, source: 'manual'}; rejects with .reason invalid | notfound | network.
   */
  function resolveManualLocation(text, options) {
    var opts = options || {};
    var q = normalizeQuery(text);
    if (q.length < 3 || q.length > 120) {
      return Promise.reject(makeError('invalid'));
    }
    if (/^\d+$/.test(q) && !isPinCode(q)) {
      return Promise.reject(makeError('invalid'));
    }
    var known = findKnownPlace(q);
    if (known) {
      return Promise.resolve({ lat: known.lat, lng: known.lng, label: known.label, source: 'manual' });
    }
    var doFetch = opts.fetch || (typeof fetch !== 'undefined' ? fetch : null);
    if (!doFetch) return Promise.reject(makeError('network'));
    var url = NOMINATIM_URL + '?format=json&limit=1&countrycodes=in&q=' +
      encodeURIComponent(isPinCode(q) ? q + ', India' : q);
    return Promise.resolve()
      .then(function () { return doFetch(url, { headers: { Accept: 'application/json' } }); })
      .catch(function (e) { throw makeError('network', e); })
      .then(function (res) {
        if (!res || !res.ok) throw makeError('network');
        return res.json().catch(function (e) { throw makeError('network', e); });
      })
      .then(function (results) {
        var first = Array.isArray(results) ? results[0] : null;
        var lat = first ? toCoord(first.lat) : NaN;
        var lng = first ? toCoord(first.lon) : NaN;
        if (!isValidCoord(lat, lng)) throw makeError('notfound');
        return { lat: lat, lng: lng, label: q, source: 'manual' };
      });
  }

  return {
    STORAGE_KEY: STORAGE_KEY,
    DEFAULT_LOCATION: DEFAULT_LOCATION,
    KNOWN_PLACES: KNOWN_PLACES,
    GPS_TTL_MS: GPS_TTL_MS,
    MANUAL_TTL_MS: MANUAL_TTL_MS,
    messageFor: messageFor,
    isValidCoord: isValidCoord,
    normalizeCoords: normalizeCoords,
    getPosition: getPosition,
    getPositionWithRetry: getPositionWithRetry,
    buildRecord: buildRecord,
    parseRecord: parseRecord,
    saveLocation: saveLocation,
    loadLocation: loadLocation,
    clearLocation: clearLocation,
    getLocationOrDefault: getLocationOrDefault,
    isPinCode: isPinCode,
    findKnownPlace: findKnownPlace,
    resolveManualLocation: resolveManualLocation
  };
});
