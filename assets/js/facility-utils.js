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

  // Accepts the saved formats seen in the app: {lat, lng} or [lat, lng].
  function parseUserLocation(raw) {
    var value = raw;
    if (typeof raw === 'string') {
      try { value = JSON.parse(raw); } catch (e) { return null; }
    }
    var lat;
    var lng;
    if (Array.isArray(value)) {
      lat = Number(value[0]);
      lng = Number(value[1]);
    } else if (value && typeof value === 'object') {
      lat = Number(value.lat);
      lng = Number(value.lng);
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
    facilities.forEach(function (f) { services = services.concat(f.services); });
    return {
      types: uniqueSorted(facilities.map(function (f) { return f.type; })),
      districts: uniqueSorted(facilities.map(function (f) { return f.district; })),
      services: uniqueSorted(services)
    };
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
      if (c.verifiedOnly && reviewStatus(f, { now: c.now, policy: c.policy }).state !== 'verified') return false;
      return true;
    });
  }

  function withDistance(facilities, userLocation) {
    return facilities.map(function (f) {
      var d = null;
      if (userLocation && isValidCoord(f.lat, f.lng)) {
        d = haversineKm(userLocation.lat, userLocation.lng, f.lat, f.lng);
      }
      return Object.assign({}, f, { distanceKm: d });
    });
  }

  // sortBy: 'distance' or 'name'. Facilities without a distance go last.
  function sortFacilities(facilities, sortBy, userLocation) {
    var list = withDistance(facilities, userLocation);
    list.sort(function (a, b) {
      if (sortBy === 'distance' && userLocation) {
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
    matchesSearch: matchesSearch,
    filterFacilities: filterFacilities,
    sortFacilities: sortFacilities,
    formatDistance: formatDistance,
    verificationLabel: verificationLabel
  };
});
