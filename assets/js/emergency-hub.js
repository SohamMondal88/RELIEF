/**
 * Emergency resource hub: data checks, review flags, grouping and search behind pages/emergency-hub.html.
 * No DOM access, so it can be tested with node:test. See docs/EMERGENCY_HUB.md.
 *
 * Resources come from assets/data/emergency-hub.json. A resource with a `contact` ("IN:112") takes its
 * name, number, source, source link and check date from REGIONAL_EMERGENCY_DATA in assets/js/emergency-sos.js,
 * the list the SOS dialog uses, so numbers are never typed twice. Any other resource is a page of this
 * site with its own source text and lastReviewed date (null until a person has reviewed it).
 *
 * Nothing here dials a number: the page renders a plain tel: link and the call starts only on a tap.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.EmergencyHub = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULT_CADENCE_DAYS = 180;
  var MAX_QUERY = 100;
  var DAY_MS = 24 * 60 * 60 * 1000;

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

  // A relative link to a page of this site: "firstaid.html" or "ambulances.html#emergency-sos".
  function isSiteLink(href) {
    return typeof href === 'string' && /^[a-z0-9-]+\.html(#[a-z0-9-]+)?$/.test(href);
  }

  function cleanName(name) {
    return name.replace(/\s*\(default\)\s*$/i, '');
  }

  /**
   * Review flag from a lastReviewed date:
   *   reviewed    a real date, not in the future, no older than cadenceDays
   *   overdue     a real date older than cadenceDays
   *   unreviewed  no date, a date that is not a real day, or a date in the future
   * Returns { state, ageDays, needsReview, label }.
   */
  function reviewStatus(lastReviewed, opts) {
    var o = opts || {};
    var cadence = o.cadenceDays > 0 ? o.cadenceDays : DEFAULT_CADENCE_DAYS;
    var d = o.now instanceof Date ? o.now : new Date();
    var todayNum = Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / DAY_MS);
    var day = parseDay(lastReviewed);
    var age = day === null ? null : todayNum - day;
    if (age === null || age < 0) {
      return { state: 'unreviewed', ageDays: null, needsReview: true, label: 'Not reviewed yet' };
    }
    if (age > cadence) {
      return { state: 'overdue', ageDays: age, needsReview: true, label: 'Review overdue, last reviewed ' + lastReviewed };
    }
    return { state: 'reviewed', ageDays: age, needsReview: false, label: 'Reviewed ' + lastReviewed };
  }

  function findContact(contacts, ref) {
    if (typeof ref !== 'string' || !/^[A-Za-z]{2,3}:[0-9]{2,6}$/.test(ref) || !isObject(contacts)) return null;
    var parts = ref.split(':');
    if (!Object.prototype.hasOwnProperty.call(contacts, parts[0])) return null;
    var region = contacts[parts[0]];
    if (!isObject(region) || !nonEmpty(region.name) || !Array.isArray(region.services)) return null;
    var svc = region.services.filter(function (s) { return isObject(s) && s.number === parts[1]; })[0];
    if (!svc || !nonEmpty(svc.name) || !nonEmpty(svc.source)) return null;
    return { region: { code: parts[0], name: cleanName(region.name) }, svc: svc };
  }

  function labelOf(list, id) {
    var hit = list.filter(function (x) { return x.id === id; })[0];
    return hit ? hit.label : id;
  }

  function validList(list) {
    return Array.isArray(list) && list.length > 0 && list.every(function (x) { return isObject(x) && nonEmpty(x.id) && nonEmpty(x.label); });
  }

  /**
   * Checks the hub file and resolves each resource.
   *   { ok: true, resources, skipped, types, audiences, owner, cadenceDays }
   *   { ok: false, reason: 'unavailable' }  no usable file at all
   *   { ok: false, reason: 'invalid' }      the file has no valid type or audience list or no resource list
   * A resource that fails its checks goes to `skipped` with a reason and is never shown with guessed values.
   * An empty `resources` list is valid: the page shows its "nothing published yet" state.
   */
  function build(hub, contacts, opts) {
    if (!isObject(hub)) return { ok: false, reason: 'unavailable' };
    if (!validList(hub.types) || !validList(hub.audiences) || !Array.isArray(hub.resources)) return { ok: false, reason: 'invalid' };
    var cadence = hub.reviewCadenceDays > 0 ? hub.reviewCadenceDays : DEFAULT_CADENCE_DAYS;
    var typeIds = hub.types.map(function (t) { return t.id; });
    var audienceIds = hub.audiences.map(function (a) { return a.id; });
    var seen = {};
    var resources = [];
    var skipped = [];

    hub.resources.forEach(function (raw, i) {
      var id = isObject(raw) && nonEmpty(raw.id) ? raw.id : '#' + i;
      function skip(reason) { skipped.push({ id: id, reason: reason }); }
      if (!isObject(raw) || !nonEmpty(raw.id)) return skip('no id');
      if (seen[raw.id]) return skip('duplicate id');
      if (typeIds.indexOf(raw.type) === -1) return skip('unknown type');
      if (audienceIds.indexOf(raw.audience) === -1) return skip('unknown audience');
      var entry = { id: raw.id, type: raw.type, typeLabel: labelOf(hub.types, raw.type), audience: raw.audience, audienceLabel: labelOf(hub.audiences, raw.audience) };

      if (raw.contact != null) {
        var found = findContact(contacts, raw.contact);
        if (!found) return skip('contact not found or has no source');
        var svc = found.svc;
        entry.kind = 'contact';
        entry.title = svc.name;
        entry.number = svc.number;
        entry.telHref = /^[0-9]{2,6}$/.test(svc.number) ? 'tel:' + svc.number : null;
        if (!entry.telHref) return skip('bad number');
        entry.region = found.region.name;
        entry.source = svc.source;
        entry.sourceUrl = isHttps(svc.sourceUrl) ? svc.sourceUrl : null;
        entry.lastReviewed = svc.lastVerified != null ? svc.lastVerified : null;
      } else {
        if (!nonEmpty(raw.title)) return skip('no title');
        if (!isSiteLink(raw.href)) return skip('bad link');
        if (!nonEmpty(raw.source)) return skip('no source');
        entry.kind = 'page';
        entry.title = raw.title;
        entry.summary = nonEmpty(raw.summary) ? raw.summary : '';
        entry.href = raw.href;
        entry.region = '';
        entry.source = raw.source;
        entry.sourceUrl = isHttps(raw.sourceUrl) ? raw.sourceUrl : null;
        entry.lastReviewed = raw.lastReviewed != null ? raw.lastReviewed : null;
      }
      entry.review = reviewStatus(entry.lastReviewed, { now: opts && opts.now, cadenceDays: cadence });
      seen[raw.id] = true;
      resources.push(entry);
    });

    return {
      ok: true,
      resources: resources,
      skipped: skipped,
      types: hub.types,
      audiences: hub.audiences,
      owner: nonEmpty(hub.owner) ? hub.owner : '',
      cadenceDays: cadence
    };
  }

  function normalizeQuery(query) {
    if (typeof query !== 'string') return '';
    return query.slice(0, MAX_QUERY).toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function haystack(r) {
    return [r.title, r.summary || '', r.number || '', r.region, r.typeLabel, r.audienceLabel, r.source].join(' ').toLowerCase();
  }

  /** Resources matching the text (every word) and the chosen type and audience ('' means any). */
  function filter(resources, criteria) {
    var c = criteria || {};
    var words = normalizeQuery(c.query).split(' ').filter(Boolean);
    return (Array.isArray(resources) ? resources : []).filter(function (r) {
      if (c.type && r.type !== c.type) return false;
      if (c.audience && r.audience !== c.audience) return false;
      var text = haystack(r);
      return words.every(function (w) { return text.indexOf(w) !== -1; });
    });
  }

  /** Groups by emergency type in the order of the type list. Types with nothing in them are left out. */
  function groupByType(resources, types) {
    return (Array.isArray(types) ? types : []).map(function (t) {
      return { type: t, items: resources.filter(function (r) { return r.type === t.id; }) };
    }).filter(function (g) { return g.items.length > 0; });
  }

  /** The number to dial for each region, for the "get help now" section. Missing or bad data gives []. */
  function primaryNumbers(contacts) {
    if (!isObject(contacts)) return [];
    return Object.keys(contacts).filter(function (code) {
      var r = contacts[code];
      return isObject(r) && nonEmpty(r.name) && /^[0-9]{2,6}$/.test(String(r.primaryNumber)) && typeof r.primaryNumber === 'string';
    }).map(function (code) {
      return { code: code, name: cleanName(contacts[code].name), number: contacts[code].primaryNumber, telHref: 'tel:' + contacts[code].primaryNumber };
    });
  }

  return {
    DEFAULT_CADENCE_DAYS: DEFAULT_CADENCE_DAYS,
    reviewStatus: reviewStatus,
    build: build,
    normalizeQuery: normalizeQuery,
    filter: filter,
    groupByType: groupByType,
    primaryNumbers: primaryNumbers
  };
});
