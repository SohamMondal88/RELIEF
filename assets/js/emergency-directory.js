/**
 * Searchable emergency resource directory: the data shaping and search behind pages/emergency-directory.html.
 * No DOM access, so it can be tested with node:test. See docs/EMERGENCY_DIRECTORY.md.
 *
 * Helpline entries are built from REGIONAL_EMERGENCY_DATA in assets/js/emergency-sos.js, the list the
 * SOS dialog already uses, so no number is typed in twice and none is invented here. An entry is kept
 * only if it has a service name, a number (digits) and a source. The last-checked date is shown only
 * when the data has one (lastVerified or lastChecked, YYYY-MM-DD); otherwise the entry says "not recorded".
 * The other entries are pages of this site and carry no phone number.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.EmergencyDirectory = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX_QUERY = 100;
  var OLD_AFTER_DAYS = 180;
  var DAY_MS = 24 * 60 * 60 * 1000;

  // Pages of RELIEF that help in an emergency. They are links, not claims about the outside world,
  // so they have no source or date.
  var SITE_RESOURCES = [
    {
      id: 'site-sos',
      title: 'Emergency SOS request',
      summary: 'Send an SOS request with a confirmation step and an SMS fallback. It does not replace calling your local emergency number.',
      href: 'ambulances.html#emergency-sos',
      tags: ['sos', 'help', 'urgent', 'ambulance']
    },
    {
      id: 'site-ambulances',
      title: 'Ambulance services page',
      summary: 'Ambulance information and the SOS tools.',
      href: 'ambulances.html',
      tags: ['ambulance', 'transport', 'emergency']
    },
    {
      id: 'site-firstaid',
      title: 'First aid guides',
      summary: 'Step by step guides that also work offline once saved. These guides are not clinician reviewed yet.',
      href: 'firstaid.html',
      tags: ['first aid', 'cpr', 'burns', 'choking', 'bleeding', 'fracture']
    },
    {
      id: 'site-hospitals',
      title: 'Hospital finder',
      summary: 'Search hospitals and other facilities. Listings marked "Not verified" may be out of date, so call ahead.',
      href: 'hospitals.html',
      tags: ['hospital', 'clinic', 'facility', 'find care']
    }
  ];

  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function nonEmpty(value) {
    return typeof value === 'string' && value.trim() !== '';
  }

  function parseDay(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    var t = Date.parse(value + 'T00:00:00Z');
    if (isNaN(t) || new Date(t).toISOString().slice(0, 10) !== value) return null;
    return Math.floor(t / DAY_MS);
  }

  function isHttps(url) {
    if (typeof url !== 'string') return false;
    try { return new URL(url).protocol === 'https:'; } catch (e) { return false; }
  }

  function cleanName(name) {
    return name.replace(/\s*\(default\)\s*$/i, '');
  }

  /**
   * When was this entry last checked? Only a real date that is not in the future counts.
   * Returns { state: 'unknown' | 'checked' | 'old', date, label }.
   */
  function checkedStatus(value, now) {
    var day = parseDay(value);
    var d = now instanceof Date ? now : new Date();
    var todayNum = Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / DAY_MS);
    if (day === null || day > todayNum) {
      return { state: 'unknown', date: null, label: 'Last checked: not recorded' };
    }
    if (todayNum - day > OLD_AFTER_DAYS) {
      return { state: 'old', date: value, label: 'Last checked ' + value + ', over ' + OLD_AFTER_DAYS + ' days ago, needs re-checking' };
    }
    return { state: 'checked', date: value, label: 'Last checked ' + value };
  }

  /**
   * Turns the regional data into directory entries.
   *   { ok: true, entries: [...], skipped: n }
   *   { ok: false, reason: 'unavailable' }  when the data is missing or has no region
   * Entries that fail the checks above are counted in `skipped` and never shown.
   * Site pages come last and are always included, so the directory is never empty because the data failed.
   */
  function buildEntries(data, opts) {
    var now = opts && opts.now;
    var entries = [];
    var skipped = 0;
    var regionCount = 0;
    if (isObject(data)) {
      Object.keys(data).forEach(function (code) {
        var region = data[code];
        if (!isObject(region) || !nonEmpty(region.name) || !Array.isArray(region.services)) return;
        regionCount++;
        region.services.forEach(function (svc, i) {
          if (!isObject(svc) || !nonEmpty(svc.name) || !/^[0-9]{2,6}$/.test(String(svc.number)) || typeof svc.number !== 'string' || !nonEmpty(svc.source)) {
            skipped++;
            return;
          }
          entries.push({
            id: code + '-' + svc.number + '-' + i,
            kind: 'helpline',
            title: svc.name,
            number: svc.number,
            telHref: 'tel:' + svc.number,
            region: { code: code, name: cleanName(region.name) },
            source: svc.source,
            sourceUrl: isHttps(svc.sourceUrl) ? svc.sourceUrl : null,
            checked: checkedStatus(svc.lastVerified != null ? svc.lastVerified : svc.lastChecked, now)
          });
        });
      });
    }
    if (regionCount === 0) return { ok: false, reason: 'unavailable', siteEntries: siteEntries() };
    return { ok: true, entries: entries.concat(siteEntries()), skipped: skipped };
  }

  function siteEntries() {
    return SITE_RESOURCES.map(function (r) {
      return { id: r.id, kind: 'site', title: r.title, summary: r.summary, href: r.href, tags: r.tags.slice() };
    });
  }

  function haystack(entry) {
    var parts = [entry.title, entry.kind === 'helpline' ? 'helpline phone number' : 'on relief page'];
    if (entry.kind === 'helpline') {
      parts.push(entry.number, entry.region.name, entry.region.code, entry.source);
    } else {
      parts.push(entry.summary, (entry.tags || []).join(' '));
    }
    return parts.join(' ').toLowerCase();
  }

  /** Lower case, trimmed, one space between words, cut to MAX_QUERY characters. Anything else gives ''. */
  function normalizeQuery(query) {
    if (typeof query !== 'string') return '';
    return query.slice(0, MAX_QUERY).toLowerCase().replace(/\s+/g, ' ').trim();
  }

  /**
   * Entries that contain every word of the query. An empty query returns everything in the original
   * order. Matches on the exact number, then on the title, come first; ties keep the original order.
   */
  function search(entries, query) {
    var list = Array.isArray(entries) ? entries : [];
    var q = normalizeQuery(query);
    if (q === '') return list.slice();
    var words = q.split(' ');
    var scored = [];
    list.forEach(function (entry, index) {
      var text = haystack(entry);
      if (!words.every(function (w) { return text.indexOf(w) !== -1; })) return;
      var score = 1;
      if (entry.number === q) score = 3;
      else if (entry.title.toLowerCase().indexOf(q) !== -1) score = 2;
      scored.push({ entry: entry, score: score, index: index });
    });
    scored.sort(function (a, b) { return b.score - a.score || a.index - b.index; });
    return scored.map(function (s) { return s.entry; });
  }

  return {
    MAX_QUERY: MAX_QUERY,
    OLD_AFTER_DAYS: OLD_AFTER_DAYS,
    SITE_RESOURCES: SITE_RESOURCES,
    checkedStatus: checkedStatus,
    buildEntries: buildEntries,
    normalizeQuery: normalizeQuery,
    search: search
  };
});
