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

  function normalizeFacility(raw) {
    if (!raw || typeof raw !== 'object' || !raw.name) return null;
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
      verified: raw.verified === true,
      source: raw.source || null,
      lastChecked: raw.lastChecked || null
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
      if (c.verifiedOnly && !f.verified) return false;
      return true;
    });
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

  function verificationLabel(facility) {
    if (facility.verified) {
      var parts = ['Verified'];
      if (facility.source) parts.push('source: ' + facility.source);
      if (facility.lastChecked) parts.push('checked ' + facility.lastChecked);
      return parts.join(' - ');
    }
    return 'Not verified';
  }

  return {
    FACILITY_TYPES: FACILITY_TYPES,
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
