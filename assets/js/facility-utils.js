/**
 * Pure helpers for the facility directory (search, filter, sort, distance).
 * No DOM access so they can be tested with node:test.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.FacilityUtils = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var FACILITY_TYPES = {
    hospital: 'Hospital',
    phc: 'Primary Health Centre',
    clinic: 'Clinic',
    pharmacy: 'Pharmacy',
    diagnostic: 'Diagnostic Centre'
  };

  // Review states are the policy in docs/FACILITY_VERIFICATION_POLICY.md.
  // 'stale' is also worked out from the date (see reviewStatus), so a record that
  // nobody touched stops looking verified on its own.
  var REVIEW_STATES = ['pending', 'verified', 'stale', 'rejected'];
  var DEFAULT_MAX_AGE_DAYS = 180;
  var DAY_MS = 24 * 60 * 60 * 1000;

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function toRad(deg) {
    return (deg * Math.PI) / 180;
  }

  // Great-circle distance in kilometres.
  function haversineKm(lat1, lng1, lat2, lng2) {
    var R = 6371;
    var dLat = toRad(lat2 - lat1);
    var dLng = toRad(lng2 - lng1);
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function isValidCoord(lat, lng) {
    return typeof lat === 'number' && typeof lng === 'number' &&
      isFinite(lat) && isFinite(lng) &&
      lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
  }

  // Number(null), Number('') and Number(false) are all 0, which would turn a broken value
  // into a real-looking point at 0,0. Only numbers and non-empty numeric strings count.
  function toCoord(value) {
    if (typeof value === 'number') return value;
    if (typeof value === 'string' && value.trim() !== '') return Number(value);
    return NaN;
  }

  // Accepts the saved formats seen in the app: {lat, lng} or [lat, lng].
  function parseUserLocation(raw) {
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
    return isValidCoord(lat, lng) ? { lat: lat, lng: lng } : null;
  }

  // Strict YYYY-MM-DD to UTC midnight in ms, or null. new Date('2026-02-31') would
  // quietly roll over, so the calendar date is checked by round trip.
  function parseDay(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    var ms = Date.parse(value + 'T00:00:00Z');
    if (isNaN(ms)) return null;
    return new Date(ms).toISOString().slice(0, 10) === value ? ms : null;
  }

  function toDayStart(now) {
    var ms = now == null ? Date.now() : (now instanceof Date ? now.getTime() : (typeof now === 'number' ? now : Date.parse(now)));
    if (isNaN(ms)) ms = Date.now();
    return Math.floor(ms / DAY_MS) * DAY_MS;
  }

  function cleanReviewLog(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.filter(function (e) { return e && typeof e === 'object' && !Array.isArray(e); })
      .map(function (e) { return Object.assign({}, e); });
  }

  function normalizeFacility(raw) {
    if (!raw || typeof raw !== 'object' || !raw.name) return null;
    // Old records only have the boolean `verified`. Keep reading it so nothing breaks,
    // but reviewState wins when both are there.
    var state = REVIEW_STATES.indexOf(raw.reviewState) !== -1
      ? raw.reviewState
      : (raw.verified === true ? 'verified' : 'pending');
    return {
      id: raw.id != null ? String(raw.id) : String(raw.name),
      name: String(raw.name),
      type: raw.type ? String(raw.type) : '',
      district: raw.district ? String(raw.district) : '',
      address: raw.address || null,
      phone: raw.phone || null,
      hours: raw.hours || null,
      services: Array.isArray(raw.services) ? raw.services.map(String) : [],
      accessibility: Array.isArray(raw.accessibility) ? raw.accessibility.filter(function (a) { return typeof a === 'string' && a.trim(); }) : [],
      lat: typeof raw.lat === 'number' ? raw.lat : null,
      lng: typeof raw.lng === 'number' ? raw.lng : null,
      reviewState: state,
      verified: state === 'verified',
      verifiedBy: raw.verifiedBy ? String(raw.verifiedBy) : null,
      source: raw.source || null,
      lastChecked: raw.lastChecked || null,
      reviewLog: cleanReviewLog(raw.reviewLog)
    };
  }

  // Policy lives in facilities.json ("reviewPolicy") so maintainers can change the
  // window without touching code. Anything that is not a positive whole number of
  // days is ignored.
  function getReviewPolicy(data) {
    var raw = data && typeof data === 'object' && !Array.isArray(data) && data.reviewPolicy;
    var policy = { maxAgeDays: DEFAULT_MAX_AGE_DAYS, byType: {} };
    function ok(n) { return typeof n === 'number' && isFinite(n) && n > 0 && Math.floor(n) === n; }
    if (raw && typeof raw === 'object') {
      if (ok(raw.maxAgeDays)) policy.maxAgeDays = raw.maxAgeDays;
      if (raw.byType && typeof raw.byType === 'object') {
        Object.keys(raw.byType).forEach(function (type) {
          if (ok(raw.byType[type])) policy.byType[type] = raw.byType[type];
        });
      }
    }
    return policy;
  }

  function maxAgeFor(facility, policy) {
    var p = policy || { maxAgeDays: DEFAULT_MAX_AGE_DAYS, byType: {} };
    if (p.byType && p.byType[facility.type]) return p.byType[facility.type];
    return p.maxAgeDays || DEFAULT_MAX_AGE_DAYS;
  }

  // A record only counts as checked when it names a source, a person who checked it
  // and a real date that is not in the future.
  function evidenceProblem(facility, now) {
    if (!facility.source) return 'no-source';
    if (!facility.verifiedBy) return 'no-verifier';
    var day = parseDay(facility.lastChecked);
    if (day === null) return 'no-date';
    if (day > toDayStart(now)) return 'future-date';
    return null;
  }

  /**
   * What state the record is really in today, whatever the stored reviewState says.
   * Returns { state, stored, ageDays, maxAgeDays, reason }.
   *  - 'verified' needs a source, a verifier and a past date, and an age within the window
   *  - a stored 'verified' without that evidence is shown as 'pending' (never as verified)
   *  - a stored 'verified' that is too old is 'stale'
   */
  function reviewStatus(facility, opts) {
    var o = opts || {};
    var maxAgeDays = o.maxAgeDays || maxAgeFor(facility, o.policy);
    var stored = REVIEW_STATES.indexOf(facility.reviewState) !== -1 ? facility.reviewState : 'pending';
    var day = parseDay(facility.lastChecked);
    var ageDays = day === null ? null : Math.floor((toDayStart(o.now) - day) / DAY_MS);
    if (ageDays !== null && ageDays < 0) ageDays = null;
    var result = { state: stored, stored: stored, ageDays: ageDays, maxAgeDays: maxAgeDays, reason: 'stored' };
    if (stored === 'verified') {
      var problem = evidenceProblem(facility, o.now);
      if (problem) {
        result.state = 'pending';
        result.reason = problem;
      } else if (ageDays > maxAgeDays) {
        result.state = 'stale';
        result.reason = 'too-old';
      }
    }
    return result;
  }

  function describeAge(days) {
    if (days == null) return '';
    if (days <= 0) return 'today';
    if (days === 1) return '1 day ago';
    return days + ' days ago';
  }

  /**
   * Text for the public card. Only `verified` is ever worded as verified, and that
   * only when the record has a source and a date.
   * Returns { state, badge, detail }.
   */
  function reviewLabel(facility, opts) {
    var st = reviewStatus(facility, opts);
    var checked = facility.lastChecked && st.ageDays != null
      ? 'last checked ' + describeAge(st.ageDays) + ' (' + facility.lastChecked + ')'
      : '';
    var from = facility.source ? 'source: ' + facility.source : '';
    var parts;
    if (st.state === 'verified') {
      parts = [from, checked].filter(Boolean);
      return { state: 'verified', badge: 'Verified', detail: parts.join(', ') };
    }
    if (st.state === 'stale') {
      parts = [checked || 'flagged for re-checking', from].filter(Boolean);
      return { state: 'stale', badge: 'Needs re-checking', detail: parts.join(', ') + '. Details may have changed, please call ahead.' };
    }
    if (st.state === 'rejected') {
      return { state: 'rejected', badge: 'Could not be confirmed', detail: 'a reviewer could not confirm these details, please call ahead' };
    }
    return {
      state: 'pending',
      badge: 'Not verified',
      detail: facility.source ? 'waiting for review' : 'no source recorded yet'
    };
  }

  function normalizeFacilities(data) {
    var list = Array.isArray(data) ? data : (data && data.facilities);
    if (!Array.isArray(list)) return [];
    return list.map(normalizeFacility).filter(Boolean);
  }

  function uniqueSorted(values) {
    var seen = {};
    values.forEach(function (v) { if (v) seen[v] = true; });
    return Object.keys(seen).sort(function (a, b) { return a.localeCompare(b); });
  }

  // Filter options are built from the data so they always match real records.
  function getFilterOptions(facilities) {
    var services = [];
    var accessibility = [];
    facilities.forEach(function (f) {
      services = services.concat(f.services);
      accessibility = accessibility.concat(f.accessibility || []);
    });
    return {
      types: uniqueSorted(facilities.map(function (f) { return f.type; })),
      districts: uniqueSorted(facilities.map(function (f) { return f.district; })),
      services: uniqueSorted(services),
      accessibility: uniqueSorted(accessibility)
    };
  }

  // Opening hours are free text, so only two plain shapes are understood: "Open 24 hours" and
  // one daily range such as "09:00-17:00" (a range that crosses midnight is fine). Anything with
  // days, several ranges, AM/PM or other words is left alone and counts as unknown.
  // Returns { always: true }, { open, close } in minutes after midnight, or null.
  function parseHours(text) {
    if (typeof text !== 'string') return null;
    var t = text.trim();
    if (/^(open\s+)?24\s*(hours|hrs|h)$/i.test(t)) return { always: true };
    var m = /^(?:daily\s+)?(\d{1,2}):(\d{2})\s*(?:-|to)\s*(\d{1,2}):(\d{2})$/i.exec(t);
    if (!m) return null;
    var oh = Number(m[1]), om = Number(m[2]), ch = Number(m[3]), cm = Number(m[4]);
    if (oh > 23 || ch > 23 || om > 59 || cm > 59) return null;
    var open = oh * 60 + om;
    var close = ch * 60 + cm;
    if (open === close) return null;
    return { open: open, close: close };
  }

  // The directory covers West Bengal, so "now" is always read on the Indian clock, not the
  // clock of the device. Returns minutes after midnight, or null if the time cannot be read.
  var HOURS_ZONE = 'Asia/Kolkata';
  function localMinutes(now) {
    var ms = now == null ? Date.now() : (now instanceof Date ? now.getTime() : Number(now));
    if (!isFinite(ms)) return null;
    try {
      var parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: HOURS_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
      }).formatToParts(new Date(ms));
      var h = null;
      var min = null;
      parts.forEach(function (p) {
        if (p.type === 'hour') h = Number(p.value);
        if (p.type === 'minute') min = Number(p.value);
      });
      return h === null || min === null || isNaN(h) || isNaN(min) ? null : h * 60 + min;
    } catch (e) {
      return null;
    }
  }

  /**
   * 'open', 'closed' or 'unknown'. Unknown is not a polite way of saying closed: it means the
   * page cannot tell. It is returned when the hours are missing or not in a shape parseHours
   * understands, when the record is not currently verified (hours on an unchecked record are not
   * trustworthy), or when the local time cannot be read.
   */
  function openNowStatus(facility, opts) {
    var o = opts || {};
    var hours = parseHours(facility && facility.hours);
    if (!hours) return 'unknown';
    if (reviewStatus(facility, { now: o.now, policy: o.policy }).state !== 'verified') return 'unknown';
    if (hours.always) return 'open';
    var minutes = localMinutes(o.now);
    if (minutes === null) return 'unknown';
    var inside = hours.open < hours.close
      ? (minutes >= hours.open && minutes < hours.close)
      : (minutes >= hours.open || minutes < hours.close);
    return inside ? 'open' : 'closed';
  }

  // True when at least one record has hours the "Open now" filter can use.
  function hasOpenNowData(facilities, opts) {
    return facilities.some(function (f) { return openNowStatus(f, opts) !== 'unknown'; });
  }

  function matchesSearch(facility, term) {
    var q = String(term || '').trim().toLowerCase();
    if (!q) return true;
    var haystack = [facility.name, facility.district].concat(facility.services).join(' ').toLowerCase();
    return q.split(/\s+/).every(function (word) { return haystack.indexOf(word) !== -1; });
  }

  function filterFacilities(facilities, criteria) {
    var c = criteria || {};
    return facilities.filter(function (f) {
      if (!matchesSearch(f, c.search)) return false;
      if (c.type && f.type !== c.type) return false;
      if (c.district && f.district !== c.district) return false;
      if (c.service && f.services.indexOf(c.service) === -1) return false;
      if (c.accessibility && (f.accessibility || []).indexOf(c.accessibility) === -1) return false;
      if (c.openNow && openNowStatus(f, { now: c.now, policy: c.policy }) !== 'open') return false;
      if (c.verifiedOnly && reviewStatus(f, { now: c.now, policy: c.policy }).state !== 'verified') return false;
      return true;
    });
  }

  var FILTER_KEYS = ['search', 'type', 'district', 'service', 'accessibility', 'verifiedOnly', 'openNow'];

  // Fills {name} placeholders. Used with the i18n layer, whose translations carry the placeholders.
  function formatMessage(template, vars) {
    return String(template).replace(/\{(\w+)\}/g, function (m, name) {
      return vars && vars[name] != null ? String(vars[name]) : m;
    });
  }

  // English fallback for the translator the page passes in: (key, fallback, vars) => text.
  function defaultTranslate(key, fallback, vars) { return formatMessage(fallback, vars); }

  // One entry per filter that is switched on: { key, label }, in the order the controls appear.
  // `tr` is optional (the page passes its i18n translator), so the labels follow the selected language.
  function describeActiveFilters(criteria, typeLabels, tr) {
    var c = criteria || {};
    var types = typeLabels || FACILITY_TYPES;
    var say = typeof tr === 'function' ? tr : defaultTranslate;
    var out = [];
    var term = String(c.search || '').trim();
    if (term) out.push({ key: 'search', label: say('hospitals.chip.search', 'Search: "{value}"', { value: term }) });
    if (c.type) out.push({ key: 'type', label: say('hospitals.chip.type', 'Type: {value}', { value: types[c.type] || c.type }) });
    if (c.district) out.push({ key: 'district', label: say('hospitals.chip.area', 'Area: {value}', { value: c.district }) });
    if (c.service) out.push({ key: 'service', label: say('hospitals.chip.service', 'Service: {value}', { value: c.service }) });
    if (c.accessibility) out.push({ key: 'accessibility', label: say('hospitals.chip.accessibility', 'Accessibility: {value}', { value: c.accessibility }) });
    if (c.verifiedOnly) out.push({ key: 'verifiedOnly', label: say('hospitals.verified', 'Verified only') });
    if (c.openNow) out.push({ key: 'openNow', label: say('hospitals.opennow', 'Open now') });
    return out;
  }

  function withoutFilter(criteria, key) {
    var copy = Object.assign({}, criteria);
    copy[key] = (key === 'verifiedOnly' || key === 'openNow') ? false : '';
    return copy;
  }

  /**
   * For an empty result: which single filter, if removed, would bring results back.
   * [{ key, label, count }] with the biggest gain first. Filters that would still leave nothing are left out.
   */
  function suggestRemovals(facilities, criteria, typeLabels, tr) {
    return describeActiveFilters(criteria, typeLabels, tr).map(function (f) {
      return { key: f.key, label: f.label, count: filterFacilities(facilities, withoutFilter(criteria, f.key)).length };
    }).filter(function (s) { return s.count > 0; })
      .sort(function (a, b) { return b.count - a.count; });
  }

  function withDistance(facilities, userLocation) {
    var origin = userLocation && isValidCoord(userLocation.lat, userLocation.lng);
    return facilities.map(function (f) {
      var d = null;
      if (origin && isValidCoord(f.lat, f.lng)) {
        d = haversineKm(userLocation.lat, userLocation.lng, f.lat, f.lng);
      }
      return Object.assign({}, f, { distanceKm: d });
    });
  }

  // sortBy: 'distance' or 'name'. Facilities without a distance go last.
  function sortFacilities(facilities, sortBy, userLocation) {
    var list = withDistance(facilities, userLocation);
    list.sort(function (a, b) {
      if (sortBy === 'distance' && userLocation && isValidCoord(userLocation.lat, userLocation.lng)) {
        if (a.distanceKm == null && b.distanceKm == null) return a.name.localeCompare(b.name);
        if (a.distanceKm == null) return 1;
        if (b.distanceKm == null) return -1;
        if (a.distanceKm !== b.distanceKm) return a.distanceKm - b.distanceKm;
      }
      return a.name.localeCompare(b.name);
    });
    return list;
  }

  function formatDistance(km) {
    if (km == null || !isFinite(km)) return '';
    return km < 10 ? km.toFixed(1) + ' km away' : Math.round(km) + ' km away';
  }

  // One line version of reviewLabel, kept for callers that want plain text.
  function verificationLabel(facility, opts) {
    var label = reviewLabel(facility, opts);
    if (label.state === 'verified') {
      var parts = ['Verified'];
      if (facility.source) parts.push('source: ' + facility.source);
      if (facility.lastChecked) parts.push('checked ' + facility.lastChecked);
      return parts.join(' - ');
    }
    return label.badge;
  }

  return {
    FACILITY_TYPES: FACILITY_TYPES,
    REVIEW_STATES: REVIEW_STATES,
    DEFAULT_MAX_AGE_DAYS: DEFAULT_MAX_AGE_DAYS,
    parseDay: parseDay,
    getReviewPolicy: getReviewPolicy,
    reviewStatus: reviewStatus,
    reviewLabel: reviewLabel,
    escapeHtml: escapeHtml,
    haversineKm: haversineKm,
    isValidCoord: isValidCoord,
    parseUserLocation: parseUserLocation,
    normalizeFacility: normalizeFacility,
    normalizeFacilities: normalizeFacilities,
    getFilterOptions: getFilterOptions,
    parseHours: parseHours,
    openNowStatus: openNowStatus,
    hasOpenNowData: hasOpenNowData,
    formatMessage: formatMessage,
    describeActiveFilters: describeActiveFilters,
    withoutFilter: withoutFilter,
    suggestRemovals: suggestRemovals,
    matchesSearch: matchesSearch,
    filterFacilities: filterFacilities,
    sortFacilities: sortFacilities,
    formatDistance: formatDistance,
    verificationLabel: verificationLabel
  };
});
