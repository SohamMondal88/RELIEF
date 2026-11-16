/**
 * Provenance for health-resource content: where it came from, when it was last reviewed and what
 * kind of review that was (Issue #79).
 *
 * One small metadata shape, one date formatter and one honest fallback, shared by anything that
 * shows guidance. Nothing here invents a source or a date: a field that is missing or fails its
 * check is treated as "not recorded", and a review status that its own evidence does not support
 * is shown as "Not reviewed".
 *
 * Shape of the metadata (every field optional):
 *   {
 *     status:       'not-reviewed' | 'source-checked' | 'clinician-reviewed',
 *     sourceUrl:    'https://...'      the publisher's page (https only)
 *     sourceName:   'Publisher, title' what to show for the link
 *     lastReviewed: 'YYYY-MM-DD'       a real date, not in the future
 *     reviewedBy:   'Name, role'       needed for clinician-reviewed
 *   }
 *
 * The three statuses and what each one needs are the ones in docs/FIRST_AID_REVIEW_CHECKLIST.md.
 * Pure functions, so they run under node:test. buildElement() is the only part that uses a DOM and
 * takes the document as a parameter.
 */
(function (root, factory) {
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    module.exports = factory();
  } else {
    root.ReliefProvenance = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STATUS_LABELS = {
    'not-reviewed': 'Not reviewed',
    // docs/FIRST_AID_REVIEW_CHECKLIST.md section 2: a source check may only be described as a check against the source.
    'source-checked': 'Source checked, not a clinical review',
    'clinician-reviewed': 'Clinician reviewed'
  };
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var LIMITS = { url: 300, name: 120, by: 120 };
  // The review checklist asks for a new review at least every 6 months.
  var OVERDUE_DAYS = 183;
  var DAY_MS = 24 * 60 * 60 * 1000;

  var NOT_RECORDED = {
    source: 'Source not recorded',
    date: 'Not recorded'
  };

  function isObject(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v);
  }

  function cleanText(v, max) {
    if (typeof v !== 'string') return '';
    var text = v.replace(/\s+/g, ' ').trim();
    return text.length > 0 && text.length <= max ? text : '';
  }

  /** True only for real calendar dates written YYYY-MM-DD (so 2026-02-30 is rejected). */
  function isIsoDate(v) {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
    var y = Number(v.slice(0, 4));
    var m = Number(v.slice(5, 7));
    var d = Number(v.slice(8, 10));
    var dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }

  /** The address as written, only when it is a plain https link. Anything else is not recorded. */
  function cleanUrl(v) {
    var text = cleanText(v, LIMITS.url);
    if (!text || /\s/.test(text)) return '';
    try {
      var url = new URL(text);
      if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return '';
      return url.href;
    } catch (e) {
      return '';
    }
  }

  /** '2026-11-09' becomes '9 Nov 2026'. Same output in every locale and time zone. Empty for a bad date. */
  function formatDate(iso) {
    if (!isIsoDate(iso)) return '';
    return Number(iso.slice(8, 10)) + ' ' + MONTHS[Number(iso.slice(5, 7)) - 1] + ' ' + iso.slice(0, 4);
  }

  function todayIso(now) {
    var d = now instanceof Date && !isNaN(now.getTime()) ? now : new Date();
    return d.toISOString().slice(0, 10);
  }

  /** Days between two YYYY-MM-DD dates (b minus a). */
  function daysBetween(a, b) {
    return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY_MS);
  }

  /**
   * Cleans whatever was stored into the shape above. Never throws, never invents a value.
   * Returns { status, sourceUrl, sourceName, lastReviewed, reviewedBy, ignored } where `ignored` lists
   * the fields that were present but unusable (for tests and for whoever fixes the record).
   */
  function normalize(meta, options) {
    var src = isObject(meta) ? meta : {};
    var now = options && options.now;
    var ignored = [];

    var sourceUrl = cleanUrl(src.sourceUrl);
    if (src.sourceUrl !== undefined && src.sourceUrl !== null && src.sourceUrl !== '' && !sourceUrl) ignored.push('sourceUrl');
    var sourceName = cleanText(src.sourceName, LIMITS.name);
    if (src.sourceName !== undefined && src.sourceName !== null && src.sourceName !== '' && !sourceName) ignored.push('sourceName');
    var reviewedBy = cleanText(src.reviewedBy, LIMITS.by);
    if (src.reviewedBy !== undefined && src.reviewedBy !== null && src.reviewedBy !== '' && !reviewedBy) ignored.push('reviewedBy');

    var lastReviewed = '';
    if (src.lastReviewed !== undefined && src.lastReviewed !== null && src.lastReviewed !== '') {
      // One day of slack, because a date written in a time zone ahead of UTC can be "tomorrow" in UTC.
      var limit = new Date(Date.parse(todayIso(now) + 'T00:00:00Z') + DAY_MS).toISOString().slice(0, 10);
      if (isIsoDate(src.lastReviewed) && src.lastReviewed <= limit) lastReviewed = src.lastReviewed;
      else ignored.push('lastReviewed');
    }

    // A claimed review counts only when the evidence the checklist asks for is there.
    var claimed = typeof src.status === 'string' && Object.prototype.hasOwnProperty.call(STATUS_LABELS, src.status) ? src.status : 'not-reviewed';
    if (src.status !== undefined && claimed === 'not-reviewed' && src.status !== 'not-reviewed') ignored.push('status');
    var status = claimed;
    if (claimed !== 'not-reviewed' && !(sourceUrl && lastReviewed)) status = 'not-reviewed';
    if (status === 'clinician-reviewed' && !reviewedBy) status = 'not-reviewed';
    if (status !== claimed) ignored.push('status');

    if (status === 'not-reviewed') {
      // A date or a reviewer next to "not reviewed" would read as a review that did not happen.
      lastReviewed = '';
      reviewedBy = '';
    }
    if (status !== 'clinician-reviewed') reviewedBy = '';

    return { status: status, sourceUrl: sourceUrl, sourceName: sourceName, lastReviewed: lastReviewed, reviewedBy: reviewedBy, ignored: ignored };
  }

  /**
   * What to show. Always returns text for the three lines, so a missing record reads
   * "Source not recorded / Not recorded / Not reviewed" instead of leaving a gap or a made up value.
   */
  function describe(meta, options) {
    var m = normalize(meta, options);
    var now = options && options.now;
    var overdue = !!m.lastReviewed && daysBetween(m.lastReviewed, todayIso(now)) > OVERDUE_DAYS;
    var host = '';
    if (m.sourceUrl) {
      try { host = new URL(m.sourceUrl).hostname.replace(/^www\./, ''); } catch (e) { host = ''; }
    }
    return {
      status: m.status,
      statusLabel: STATUS_LABELS[m.status],
      sourceText: m.sourceUrl ? (m.sourceName || host) : NOT_RECORDED.source,
      sourceUrl: m.sourceUrl || null,
      dateLabel: m.status === 'source-checked' ? 'Checked against the source on' : 'Last reviewed',
      reviewedText: m.lastReviewed ? formatDate(m.lastReviewed) : NOT_RECORDED.date,
      reviewedBy: m.reviewedBy,
      overdue: overdue,
      overdueText: overdue ? (m.status === 'source-checked' ? 'This check' : 'This review') + ' is more than 6 months old.' : '',
      recorded: !!(m.sourceUrl || m.lastReviewed),
      ignored: m.ignored
    };
  }

  /**
   * A small definition list for a page. Text is set with textContent, the link only ever gets an
   * https address and opens with rel="noopener noreferrer".
   */
  function buildElement(doc, meta, options) {
    var info = describe(meta, options);
    var box = doc.createElement('dl');
    box.className = 'guide-provenance' + (info.recorded ? '' : ' guide-provenance--empty');

    function row(label, valueNode) {
      var wrap = doc.createElement('div');
      var dt = doc.createElement('dt');
      dt.textContent = label;
      var dd = doc.createElement('dd');
      dd.appendChild(valueNode);
      wrap.appendChild(dt);
      wrap.appendChild(dd);
      box.appendChild(wrap);
    }
    function text(value) { return doc.createTextNode(value); }

    var source;
    if (info.sourceUrl) {
      source = doc.createElement('a');
      source.href = info.sourceUrl;
      source.rel = 'noopener noreferrer';
      source.textContent = info.sourceText;
    } else {
      source = text(info.sourceText);
    }
    row('Source', source);
    row(info.dateLabel, text(info.reviewedText + (info.overdue ? '. ' + info.overdueText : '')));
    row('Review status', text(info.statusLabel + (info.reviewedBy ? ' by ' + info.reviewedBy : '')));
    return box;
  }

  return {
    STATUS_LABELS: STATUS_LABELS,
    NOT_RECORDED: NOT_RECORDED,
    OVERDUE_DAYS: OVERDUE_DAYS,
    isIsoDate: isIsoDate,
    formatDate: formatDate,
    normalize: normalize,
    describe: describe,
    buildElement: buildElement
  };
}));
