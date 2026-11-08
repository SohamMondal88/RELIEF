/**
 * Maintainer side of the facility verification policy (docs/FACILITY_VERIFICATION_POLICY.md).
 *
 * Pure functions, no DOM and no file access, so they are tested with node:test and
 * used by both scripts/facility-review.js and the admin panel:
 *   - queue():          stale and pending records in the order a maintainer should work them
 *   - summary():        how many records are in each state today
 *   - applyReview():    one review decision on one record, with the audit log entry
 *   - validateRecord(): is this record allowed to say what it says
 *   - compareRecords(): was this record changed the right way (append-only log)
 *
 * The public site never calls applyReview. Browsers cannot write facilities.json, so
 * the only way a state changes is a maintainer running the script and a pull request.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./facility-utils.js'));
  } else {
    root.FacilityReview = factory(root.FacilityUtils);
  }
})(typeof self !== 'undefined' ? self : this, function (U) {
  'use strict';

  var STATES = U.REVIEW_STATES;
  var LIMITS = { by: 60, source: 200, note: 300 };

  // Fields that describe the place. If one of these changes on a record that is
  // marked verified, the old check no longer covers the new value.
  var CONTENT_FIELDS = ['name', 'type', 'district', 'address', 'phone', 'hours', 'services', 'lat', 'lng'];
  var REVIEW_FIELDS = ['reviewState', 'verified', 'verifiedBy', 'source', 'lastChecked'];

  function sameValue(a, b) {
    return JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
  }

  function isoDay(now) {
    var ms = now == null ? Date.now() : (now instanceof Date ? now.getTime() : (typeof now === 'number' ? now : Date.parse(now)));
    return new Date(isNaN(ms) ? Date.now() : ms).toISOString().slice(0, 10);
  }

  function isoTime(now) {
    var ms = now == null ? Date.now() : (now instanceof Date ? now.getTime() : (typeof now === 'number' ? now : Date.parse(now)));
    return new Date(isNaN(ms) ? Date.now() : ms).toISOString();
  }

  // Text that ends up in the data file and in the admin table: no markup, no control characters.
  function cleanText(value, max) {
    return String(value == null ? '' : value)
      .replace(/[\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]/g, ' ')
      .replace(/[<>]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max);
  }

  // ---- Reading the data ----------------------------------------------------

  function summary(facilities, opts) {
    var counts = { verified: 0, stale: 0, pending: 0, rejected: 0, total: 0 };
    facilities.forEach(function (f) {
      counts[U.reviewStatus(f, opts).state] += 1;
      counts.total += 1;
    });
    return counts;
  }

  function dayOrNull(f) {
    return U.parseDay(f.lastChecked);
  }

  /**
   * Records that need a person to look at them.
   * Order: stale first (they carry, or carried, a trust label that has run out), then
   * pending. Inside each group the record checked longest ago comes first, and a record
   * that was never checked comes before any dated one. Ties are broken by id so the
   * list is the same every time. Rejected records are not in the queue: they were
   * looked at and need a decision about the data, not another check.
   */
  function queue(facilities, opts) {
    var items = [];
    facilities.forEach(function (f) {
      var st = U.reviewStatus(f, opts);
      if (st.state !== 'stale' && st.state !== 'pending') return;
      items.push({
        id: f.id,
        name: f.name,
        type: f.type,
        district: f.district,
        state: st.state,
        reason: st.reason,
        ageDays: st.ageDays,
        maxAgeDays: st.maxAgeDays,
        overdueDays: st.ageDays == null ? null : Math.max(0, st.ageDays - st.maxAgeDays),
        lastChecked: f.lastChecked || null,
        source: f.source || null,
        verifiedBy: f.verifiedBy || null
      });
    });
    var rank = { stale: 0, pending: 1 };
    items.sort(function (a, b) {
      if (rank[a.state] !== rank[b.state]) return rank[a.state] - rank[b.state];
      var da = dayOrNull(a);
      var db = dayOrNull(b);
      if (da !== db) {
        if (da === null) return -1;
        if (db === null) return 1;
        return da - db;
      }
      return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
    });
    return items;
  }

  // ---- Making a decision -----------------------------------------------------

  /**
   * Applies one review decision to one raw record and returns a new record (the input
   * is not changed). change = { state, by, source, date, note }.
   *   verified: needs by, source and a date (default today, never in the future)
   *   stale, rejected, pending: need by and a note saying why
   * Always appends one entry to reviewLog and never edits an earlier one.
   */
  function applyReview(record, change, opts) {
    var o = opts || {};
    var c = change || {};
    var errors = [];
    var state = c.state;
    var by = cleanText(c.by, LIMITS.by);
    var source = cleanText(c.source, LIMITS.source);
    var note = cleanText(c.note, LIMITS.note);
    var today = isoDay(o.now);
    var date = c.date ? String(c.date) : today;

    if (!record || typeof record !== 'object') return { ok: false, errors: ['No such record.'] };
    if (STATES.indexOf(state) === -1) errors.push('State must be one of: ' + STATES.join(', ') + '.');
    if (!by) errors.push('Say who made this decision (by).');
    if (U.parseDay(date) === null) errors.push('Date must be a real date written YYYY-MM-DD.');
    else if (date > today) errors.push('The date cannot be in the future.');
    if (state === 'verified' && !source) errors.push('A record cannot be verified without a source. Say where the details were confirmed.');
    if (state && state !== 'verified' && !note) errors.push('Say why in the note.');
    if (errors.length) return { ok: false, errors: errors };

    var next = JSON.parse(JSON.stringify(record));
    var from = STATES.indexOf(record.reviewState) !== -1 ? record.reviewState : (record.verified === true ? 'verified' : 'pending');
    var log = Array.isArray(next.reviewLog) ? next.reviewLog : [];

    next.reviewState = state;
    next.verified = state === 'verified';
    if (state === 'verified') {
      next.verifiedBy = by;
      next.source = source;
      next.lastChecked = date;
    }
    var entry = { at: isoTime(o.now), by: by, from: from, to: state, date: date };
    if (state === 'verified') entry.source = source;
    if (note) entry.note = note;
    log.push(entry);
    next.reviewLog = log;
    return { ok: true, record: next, entry: entry };
  }

  // ---- Checking a record -----------------------------------------------------

  /**
   * Problems with one raw record as stored. [] means fine. Does not depend on today's
   * date for age, so an old but honest record is not an error here (it is "stale").
   */
  function validateRecord(raw, opts) {
    var o = opts || {};
    var id = raw && raw.id ? raw.id : '(no id)';
    var problems = [];
    function add(msg) { problems.push(id + ': ' + msg); }
    if (!raw || typeof raw !== 'object') return ['(record): not an object'];

    var state = raw.reviewState;
    if (STATES.indexOf(state) === -1) {
      add('reviewState must be one of ' + STATES.join(', '));
      return problems;
    }
    if (raw.verified !== (state === 'verified')) add('verified (' + raw.verified + ') does not match reviewState (' + state + ')');

    if (state === 'verified') {
      if (!raw.source) add('verified without a source');
      if (!raw.verifiedBy) add('verified without verifiedBy');
      if (U.parseDay(raw.lastChecked) === null) add('verified without a valid lastChecked date');
      else if (raw.lastChecked > isoDay(o.now)) add('lastChecked is in the future');
    }
    if (raw.lastChecked != null && U.parseDay(raw.lastChecked) === null) add('lastChecked is not a real YYYY-MM-DD date');
    if (raw.lastChecked && !raw.source) add('has a lastChecked date but no source');

    var log = raw.reviewLog;
    if (!Array.isArray(log)) {
      add('reviewLog must be an array');
      return problems;
    }
    var prevAt = '';
    log.forEach(function (e, i) {
      var where = 'reviewLog[' + i + ']';
      if (!e || typeof e !== 'object') { add(where + ' is not an object'); return; }
      if (isNaN(Date.parse(e.at)) || typeof e.at !== 'string') add(where + ' has no valid "at" time');
      else {
        if (prevAt && e.at < prevAt) add(where + ' is older than the entry before it');
        prevAt = e.at;
      }
      if (!e.by) add(where + ' has no "by"');
      if (STATES.indexOf(e.to) === -1) add(where + ' has an unknown "to" state');
      if (STATES.indexOf(e.from) === -1) add(where + ' has an unknown "from" state');
      if (e.to === 'verified' && !e.source) add(where + ' verifies without a source');
      if (i > 0 && log[i - 1] && e.from !== log[i - 1].to) add(where + ' starts from ' + e.from + ' but the entry before ended at ' + log[i - 1].to);
    });
    if (state !== 'pending' && log.length === 0) add('state is ' + state + ' but the reviewLog is empty, so there is no record of who decided it');
    if (log.length) {
      var last = log[log.length - 1];
      if (last && last.to !== state) add('reviewState is ' + state + ' but the last log entry says ' + last.to);
      if (last && state === 'verified') {
        if (last.by !== raw.verifiedBy) add('verifiedBy does not match who the last log entry names');
        if (last.date !== raw.lastChecked) add('lastChecked does not match the date in the last log entry');
        if (last.source !== raw.source) add('source does not match the last log entry');
      }
    }
    return problems;
  }

  /**
   * Compares the same record before and after a change (for example the version on
   * main and the version in a pull request). The log may only grow. A review field may
   * only change together with a new log entry. A verified record whose details changed
   * must carry a fresh verification.
   */
  function compareRecords(before, after) {
    var id = after && after.id ? after.id : '(no id)';
    var problems = [];
    function add(msg) { problems.push(id + ': ' + msg); }
    if (!before || !after) return problems;
    // A record from before this workflow existed has no reviewState. Read it the way
    // normalizeFacility does, so adding the new fields is not counted as a review change.
    before = Object.assign({}, before, {
      reviewState: STATES.indexOf(before.reviewState) !== -1 ? before.reviewState : (before.verified === true ? 'verified' : 'pending')
    });
    var oldLog = Array.isArray(before.reviewLog) ? before.reviewLog : [];
    var newLog = Array.isArray(after.reviewLog) ? after.reviewLog : [];

    var prefixOk = newLog.length >= oldLog.length && oldLog.every(function (e, i) { return sameValue(e, newLog[i]); });
    if (!prefixOk) add('reviewLog was edited or shortened, it may only be added to');

    var grew = newLog.length > oldLog.length;
    var reviewChanged = REVIEW_FIELDS.some(function (k) { return !sameValue(before[k], after[k]); });
    if (reviewChanged && !grew) add('review fields changed without a new reviewLog entry');

    var contentChanged = CONTENT_FIELDS.filter(function (k) { return !sameValue(before[k], after[k]); });
    if (contentChanged.length && after.reviewState === 'verified') {
      var newest = grew ? newLog[newLog.length - 1] : null;
      if (!newest || newest.to !== 'verified') {
        add('details changed (' + contentChanged.join(', ') + ') on a verified record without a new verification');
      }
    }
    return problems;
  }

  function compareFiles(beforeData, afterData) {
    var problems = [];
    var before = {};
    ((beforeData && beforeData.facilities) || []).forEach(function (f) { if (f && f.id) before[f.id] = f; });
    ((afterData && afterData.facilities) || []).forEach(function (f) {
      if (f && f.id && before[f.id]) problems = problems.concat(compareRecords(before[f.id], f));
    });
    return problems;
  }

  function validateFile(data, opts) {
    var problems = [];
    var list = data && Array.isArray(data.facilities) ? data.facilities : null;
    if (!list) return ['facilities.json has no "facilities" array'];
    var seen = {};
    list.forEach(function (f) {
      if (f && f.id) {
        if (seen[f.id]) problems.push(f.id + ': duplicate id');
        seen[f.id] = true;
      }
      problems = problems.concat(validateRecord(f, opts));
    });
    return problems;
  }

  return {
    STATES: STATES,
    LIMITS: LIMITS,
    CONTENT_FIELDS: CONTENT_FIELDS,
    cleanText: cleanText,
    summary: summary,
    queue: queue,
    applyReview: applyReview,
    validateRecord: validateRecord,
    validateFile: validateFile,
    compareRecords: compareRecords,
    compareFiles: compareFiles
  };
});
