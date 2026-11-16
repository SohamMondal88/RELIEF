/**
 * Emergency contact directory: the checks and lookups behind pages/emergency-contacts.html.
 * No DOM access, so it can be tested with node:test.
 *
 * The numbers live in REGIONAL_EMERGENCY_DATA in assets/js/emergency-sos.js (one list for the SOS
 * dialog and for this page). Every entry needs a number, a service name, a source and a scope, and
 * may carry a sourceUrl and a lastVerified date. See docs/EMERGENCY_CONTACTS.md.
 *
 * Nothing here dials a number. telHref() only builds the link, and the page renders it as a normal
 * link, so a call starts only when the person taps it.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.EmergencyContacts = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULT_MAX_AGE_DAYS = 180;
  var DAY_MS = 24 * 60 * 60 * 1000;
  var SCOPES = ['national', 'local'];

  // Browser language region (en-IN) to a region code used in the data. This only pre-selects a
  // region, the person can always change it. EU member states, as listed by the European Union.
  var EU_COUNTRIES = ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT',
    'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE'];
  var COUNTRY_TO_REGION = { IN: 'IN', US: 'US', CA: 'US', GB: 'UK' };
  EU_COUNTRIES.forEach(function (code) { COUNTRY_TO_REGION[code] = 'EU'; });

  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function nonEmpty(value) {
    return typeof value === 'string' && value.trim() !== '';
  }

  // YYYY-MM-DD that is a real calendar day, as a UTC day number. null for anything else.
  function parseDay(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    var t = Date.parse(value + 'T00:00:00Z');
    if (isNaN(t) || new Date(t).toISOString().slice(0, 10) !== value) return null;
    return Math.floor(t / DAY_MS);
  }

  function today(now) {
    var d = now instanceof Date ? now : new Date();
    return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / DAY_MS);
  }

  // A "tel:" link only ever carries digits, so a stray character or a "+" cannot change what is dialled.
  function isDialable(number) {
    return typeof number === 'string' && /^[0-9]{2,6}$/.test(number);
  }

  function isHttps(url) {
    if (typeof url !== 'string') return false;
    try { return new URL(url).protocol === 'https:'; } catch (e) { return false; }
  }

  function telHref(number) {
    return isDialable(number) ? 'tel:' + number : null;
  }

  /**
   * How far a number can be trusted, worked out from lastVerified alone:
   *   verified    a real date, not in the future, no older than maxAgeDays
   *   stale       a real date older than maxAgeDays
   *   unverified  no date, or a date that is not a real day or is in the future
   * Returns { state, ageDays, needsReview, label }.
   */
  function verificationStatus(contact, opts) {
    var o = opts || {};
    var maxAge = o.maxAgeDays > 0 ? o.maxAgeDays : DEFAULT_MAX_AGE_DAYS;
    var raw = isObject(contact) ? contact.lastVerified : null;
    var day = parseDay(raw);
    var age = day === null ? null : today(o.now) - day;
    if (age !== null && age < 0) age = null;
    if (age === null) {
      return { state: 'unverified', ageDays: null, needsReview: true, label: 'Not verified yet, needs review' };
    }
    if (age > maxAge) {
      return { state: 'stale', ageDays: age, needsReview: true, label: 'Needs re-checking: last verified ' + raw };
    }
    return { state: 'verified', ageDays: age, needsReview: false, label: 'Verified ' + raw };
  }

  /**
   * Checks one service entry. Returns a list of problems, empty when it is fine.
   * A published number needs a name, digits only, a source and a known scope.
   */
  function contactProblems(contact) {
    var problems = [];
    if (!isObject(contact)) return ['not an object'];
    if (!nonEmpty(contact.name)) problems.push('missing service name');
    if (!isDialable(contact.number)) problems.push('number must be 2 to 6 digits');
    if (!nonEmpty(contact.source)) problems.push('missing source');
    if (SCOPES.indexOf(contact.scope) === -1) problems.push('scope must be national or local');
    if (contact.sourceUrl != null && !isHttps(contact.sourceUrl)) problems.push('sourceUrl must be an https link or null');
    if (contact.lastVerified != null && parseDay(contact.lastVerified) === null) problems.push('lastVerified must be a real YYYY-MM-DD date or null');
    if (parseDay(contact.lastVerified) !== null && parseDay(contact.lastVerified) > today()) problems.push('lastVerified is in the future');
    return problems;
  }

  /** Problems across a whole data object: { 'IN[0] 112': ['missing source'], ... }. Empty object when clean. */
  function dataProblems(data) {
    var found = {};
    if (!isObject(data) || Object.keys(data).length === 0) return { data: ['no regions'] };
    Object.keys(data).forEach(function (code) {
      var region = data[code];
      if (!isObject(region)) { found[code] = ['region is not an object']; return; }
      if (!nonEmpty(region.name)) (found[code] = found[code] || []).push('missing region name');
      if (!Array.isArray(region.services) || region.services.length === 0) {
        (found[code] = found[code] || []).push('no services');
        return;
      }
      region.services.forEach(function (svc, i) {
        var list = contactProblems(svc);
        if (list.length) found[code + '[' + i + '] ' + (isObject(svc) ? svc.number : '?')] = list;
      });
    });
    return found;
  }

  // The SOS data labels India "(Default)", which means nothing on a page that lets you pick.
  function cleanName(name) {
    return name.replace(/\s*\(default\)\s*$/i, '');
  }

  /** Region codes with a name, in data order. Entries that are not usable regions are skipped. */
  function listRegions(data) {
    if (!isObject(data)) return [];
    return Object.keys(data).filter(function (code) {
      return isObject(data[code]) && nonEmpty(data[code].name) && Array.isArray(data[code].services);
    }).map(function (code) { return { code: code, name: cleanName(data[code].name) }; });
  }

  /** Region code from a browser language tag such as "en-IN", or null when it cannot be told. */
  function regionFromLocale(tag, data) {
    if (typeof tag !== 'string') return null;
    var match = tag.match(/^[A-Za-z]{2,3}(?:-[A-Za-z]{4})?-([A-Za-z]{2})\b/);
    if (!match) return null;
    var code = COUNTRY_TO_REGION[match[1].toUpperCase()];
    if (!code) return null;
    return !data || (isObject(data[code]) && Array.isArray(data[code].services)) ? code : null;
  }

  /**
   * Numbers for one region, split into national and local and each with its verification status.
   *   { ok: true, region, national: [...], local: [...] }
   *   { ok: false, reason: 'unavailable' }     the data is missing or has no regions
   *   { ok: false, reason: 'unknown-region' }  the code is empty or not in the data
   * Entries that fail contactProblems() are left out, never shown with a guessed value.
   */
  function lookup(data, code, opts) {
    if (!isObject(data) || listRegions(data).length === 0) return { ok: false, reason: 'unavailable' };
    var known = listRegions(data).some(function (r) { return r.code === code; });
    if (!known) return { ok: false, reason: 'unknown-region' };
    var region = data[code];
    var national = [];
    var local = [];
    region.services.forEach(function (svc) {
      if (contactProblems(svc).length) return;
      var entry = {
        name: svc.name,
        number: svc.number,
        telHref: telHref(svc.number),
        source: svc.source,
        sourceUrl: svc.sourceUrl || null,
        scope: svc.scope,
        lastVerified: svc.lastVerified || null,
        recommended: svc.recommended === true,
        status: verificationStatus(svc, opts)
      };
      (svc.scope === 'local' ? local : national).push(entry);
    });
    return { ok: true, region: { code: code, name: cleanName(region.name) }, national: national, local: local };
  }

  return {
    DEFAULT_MAX_AGE_DAYS: DEFAULT_MAX_AGE_DAYS,
    parseDay: parseDay,
    telHref: telHref,
    verificationStatus: verificationStatus,
    contactProblems: contactProblems,
    dataProblems: dataProblems,
    listRegions: listRegions,
    regionFromLocale: regionFromLocale,
    lookup: lookup
  };
});
