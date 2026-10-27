/**
 * Versioned, safe migration for the data RELIEF keeps in localStorage (Issue #93).
 *
 * The stored lists (reminders, dashboard timeline, appointment requests, saved
 * facilities) and the picked doctor were written by older builds without any
 * version, and a half written or hand edited value used to crash the page that
 * read it. migrate() brings them to the current schema once, and is safe to run
 * on every page load:
 *
 *   - Idempotent: the version marker is written last, and a second run changes nothing.
 *   - Keeps what is valid: a list loses only its broken entries, never the good ones.
 *   - Fails safely: unreadable JSON or a value of the wrong type is removed, a storage
 *     error leaves the old data in place and the marker unwritten so the next load retries.
 *   - Never downgrades: data marked with a newer version is left exactly as it is.
 *   - Never logs and never puts stored text in its result (counts only).
 *
 * The stored formats are unchanged, so the pages that read them keep working.
 * To change a format later: bump CURRENT_VERSION and add a step to MIGRATIONS.
 */
(function (root, factory) {
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    module.exports = factory();
  } else {
    root.ReliefStorageSchema = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION_KEY = 'relief_schema_version';
  var CURRENT_VERSION = 1;

  function isObject(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v);
  }
  function isText(v) {
    return typeof v === 'string' && v.trim() !== '';
  }

  // One validator per stored record. They only check what the pages need to render
  // the record without throwing; extra fields are kept as they are.
  var RECORDS = {
    reminder: function (r) {
      return isObject(r) && isText(r.medicine) && typeof r.time === 'string' &&
        /^([01]\d|2[0-3]):[0-5]\d$/.test(r.time);
    },
    historyEntry: function (r) {
      return isObject(r) && typeof r.date === 'string' && isText(r.event) && typeof r.status === 'string';
    },
    appointmentRequest: function (r) {
      return isObject(r) && isText(r.id) && typeof r.preferredDate === 'string' &&
        typeof r.status === 'string';
    },
    savedFacility: function (r) {
      return isObject(r) && (typeof r.id === 'string' || typeof r.id === 'number') && isText(r.name);
    },
    doctor: function (r) {
      return isObject(r) && isText(r.name);
    }
  };

  // key -> how to read it. "list" values are arrays of records, "single" is one record.
  var STORED = [
    { key: 'relief_reminders_v1', shape: 'list', valid: RECORDS.reminder },
    { key: 'relief_history_v1', shape: 'list', valid: RECORDS.historyEntry },
    { key: 'relief_appointment_requests', shape: 'list', valid: RECORDS.appointmentRequest },
    { key: 'relief_saved_facilities', shape: 'list', valid: RECORDS.savedFacility },
    { key: 'selectedDoctor', shape: 'single', valid: RECORDS.doctor }
  ];

  function parse(raw) {
    try { return { ok: true, value: JSON.parse(raw) }; } catch (e) { return { ok: false }; }
  }

  /** Decides what one key needs. Returns { op: 'keep' | 'rewrite' | 'remove', text?, kept, dropped }. */
  function checkKey(spec, raw) {
    var parsed = parse(raw);
    if (!parsed.ok) return { op: 'remove', kept: 0, dropped: 1 };
    var value = parsed.value;
    if (spec.shape === 'single') {
      return spec.valid(value) ? { op: 'keep', kept: 1, dropped: 0 } : { op: 'remove', kept: 0, dropped: 1 };
    }
    if (!Array.isArray(value)) return { op: 'remove', kept: 0, dropped: 1 };
    var good = value.filter(spec.valid);
    var dropped = value.length - good.length;
    if (dropped === 0) return { op: 'keep', kept: good.length, dropped: 0 };
    if (good.length === 0) return { op: 'remove', kept: 0, dropped: dropped };
    return { op: 'rewrite', text: JSON.stringify(good), kept: good.length, dropped: dropped };
  }

  // Version 0 is what older builds left behind: no marker at all.
  var MIGRATIONS = [
    {
      from: 0,
      to: 1,
      /** Plans the writes without touching storage. Throws if storage cannot be read. */
      plan: function (storage) {
        var steps = [];
        var kept = 0;
        var dropped = 0;
        STORED.forEach(function (spec) {
          var raw = storage.getItem(spec.key);
          if (raw === null || raw === undefined) return;
          var result = checkKey(spec, raw);
          kept += result.kept;
          dropped += result.dropped;
          if (result.op !== 'keep') steps.push({ key: spec.key, op: result.op, text: result.text });
        });
        return { steps: steps, kept: kept, dropped: dropped };
      }
    }
  ];

  /** Reads the stored version. Missing or unreadable markers count as 0 (the legacy layout). */
  function readVersion(storage) {
    var raw = storage.getItem(VERSION_KEY);
    if (typeof raw === 'string' && /^\d{1,6}$/.test(raw)) return parseInt(raw, 10);
    return 0;
  }

  /**
   * Brings storage up to CURRENT_VERSION. Never throws.
   * Returns { status, from, to, kept, dropped } with counts only. status is one of:
   *   'current'      already at the current version, nothing was touched
   *   'migrated'     upgraded; dropped counts the broken entries that were removed
   *   'newer'        written by a newer build; nothing was touched
   *   'incomplete'   a write failed; old data stays and the next load tries again
   *   'unavailable'  storage cannot be read (blocked, private mode)
   */
  function migrate(storage) {
    var report = { status: 'unavailable', from: 0, to: 0, kept: 0, dropped: 0 };
    var version;
    try {
      if (!storage) return report;
      version = readVersion(storage);
    } catch (e) {
      return report;
    }
    report.from = version;
    report.to = version;
    if (version > CURRENT_VERSION) { report.status = 'newer'; return report; }
    if (version === CURRENT_VERSION) { report.status = 'current'; return report; }

    try {
      for (var i = 0; i < MIGRATIONS.length; i++) {
        var step = MIGRATIONS[i];
        if (step.from !== version) continue;
        var plan = step.plan(storage);
        report.kept += plan.kept;
        report.dropped += plan.dropped;
        report.status = 'incomplete';
        plan.steps.forEach(function (s) {
          if (s.op === 'remove') storage.removeItem(s.key);
          else storage.setItem(s.key, s.text);
        });
        version = step.to;
      }
      storage.setItem(VERSION_KEY, String(version));
      report.to = version;
      report.status = 'migrated';
    } catch (e) {
      // Some writes may have gone through; every one of them is a valid list, so the
      // next run only has the rest left to do. The marker is not written.
      report.status = 'incomplete';
    }
    return report;
  }

  /**
   * Reads the dashboard timeline. Returns an array of valid entries, or null when
   * nothing usable is stored (missing, unreadable or not a list), so the caller can
   * decide what to show. Never throws.
   */
  function loadHistory(storage) {
    try {
      var raw = storage.getItem('relief_history_v1');
      if (raw === null || raw === undefined) return null;
      var parsed = parse(raw);
      if (!parsed.ok || !Array.isArray(parsed.value)) return null;
      return parsed.value.filter(RECORDS.historyEntry);
    } catch (e) {
      return null;
    }
  }

  var api = {
    VERSION_KEY: VERSION_KEY,
    CURRENT_VERSION: CURRENT_VERSION,
    STORED_KEYS: STORED.map(function (s) { return s.key; }),
    migrate: migrate,
    loadHistory: loadHistory,
    lastReport: null
  };

  // In a page, run once before the page's own script reads storage.
  if (typeof window !== 'undefined' && !(typeof module !== 'undefined' && module.exports)) {
    try { api.lastReport = migrate(window.localStorage); } catch (e) { /* storage blocked */ }
  }

  return api;
}));
