/**
 * Export and import of the dashboard data kept in this browser (Issue #82).
 *
 * Covers the two things the dashboard saves: medicine reminders (relief_reminders_v1) and the
 * health timeline (relief_history_v1). The backup is a JSON file the user saves and loads
 * themselves. It is a personal, local backup: nothing in it has been checked by anyone, and it is
 * not a medical record.
 *
 * Pure logic with storage passed in, so it runs under node:test. The page wiring is in
 * data-backup-ui.js.
 *
 * Import is all or nothing:
 *   1. parseBackup() checks the whole file (size, JSON, format, version, every record) and
 *      refuses it if anything is wrong. Nothing is written at this stage.
 *   2. describeImport() tells the user what would be replaced.
 *   3. applyBackup() writes both keys, reads them back, and puts the old values back if a write
 *      fails, so a failed import never leaves half of a restore behind.
 */
(function (root, factory) {
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    module.exports = factory(require('./reminders.js'));
  } else {
    root.ReliefDataBackup = factory(root.ReliefReminders);
  }
}(typeof self !== 'undefined' ? self : this, function (R) {
  'use strict';

  var FORMAT = 'relief-local-backup';
  var VERSION = 1;
  var MAX_BYTES = 512 * 1024;
  var MAX_REMINDERS = 200;
  var MAX_TIMELINE = 200;
  var MAX_PROBLEMS_SHOWN = 5;
  var REMINDERS_KEY = 'relief_reminders_v1';
  var HISTORY_KEY = 'relief_history_v1';
  var STATUSES = ['active', 'paused', 'completed'];

  var NOTICE = 'A backup of reminders and timeline entries kept in one browser by RELIEF. It is not a medical record and nobody has verified what it says.';

  // The dashboard writes these two example rows the first time it opens. They are not the user's
  // entries, so they are left out of a backup.
  var SAMPLE_TIMELINE = [
    { date: '2026-01-02', event: 'Symptom check completed', status: 'Advised doctor consult' },
    { date: '2026-01-04', event: 'Appointment booked', status: 'Dr. A. Sen - 10:30 AM' }
  ];

  function isObject(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v);
  }
  function isText(v, max) {
    return typeof v === 'string' && v.trim() !== '' && v.length <= max;
  }
  function optionalText(v, max) {
    return v === undefined || (typeof v === 'string' && v.length <= max);
  }
  function isSample(entry) {
    return SAMPLE_TIMELINE.some(function (s) {
      return s.date === entry.date && s.event === entry.event && s.status === entry.status;
    });
  }

  // ---------- export ----------

  /** What would go into a backup right now: { reminders, timeline }, both already cleaned. */
  function collect(storage) {
    var reminders = R.loadReminders(storage);
    var timeline = R.loadHistory(storage, HISTORY_KEY, []).filter(function (entry) {
      return R.isValidDate(entry.date) && entry.event.trim() !== '' && !isSample(entry);
    });
    return { reminders: reminders, timeline: timeline };
  }

  /** The backup as an object. `now` is only used for the exportedAt time. */
  function buildBackup(storage, now) {
    var data = collect(storage);
    return {
      format: FORMAT,
      version: VERSION,
      exportedAt: (now instanceof Date ? now : new Date()).toISOString(),
      notice: NOTICE,
      data: { reminders: data.reminders, timeline: data.timeline }
    };
  }

  function backupFileName(now) {
    var d = now instanceof Date ? now : new Date();
    return 'relief-backup-' + d.toISOString().slice(0, 10) + '.json';
  }

  // ---------- import: checking the file ----------

  function fail(code, message, problems) {
    return { ok: false, code: code, message: message, problems: problems || [] };
  }

  function checkReminder(r, index) {
    var where = 'Reminder ' + (index + 1) + ': ';
    if (!isObject(r)) return where + 'is not an entry.';
    if (!isText(r.medicine, R.MAX_NAME_LENGTH)) return where + 'needs a medicine name of up to ' + R.MAX_NAME_LENGTH + ' characters.';
    if (!R.isValidTime(r.time)) return where + 'the time is not HH:MM.';
    if (!isText(r.id, 64)) return where + 'has no id.';
    if (!optionalText(r.instructions, R.MAX_INSTRUCTIONS_LENGTH)) return where + 'the note is too long or not text.';
    if (r.status !== undefined && STATUSES.indexOf(r.status) === -1) return where + 'the status is not one this version knows.';
    if (r.startDate !== undefined && r.startDate !== '' && !R.isValidDate(r.startDate)) return where + 'the start date is not a real date.';
    if (r.endDate !== undefined && r.endDate !== '' && !R.isValidDate(r.endDate)) return where + 'the end date is not a real date.';
    if (r.scheduleMode !== undefined && R.SCHEDULE_MODES.indexOf(r.scheduleMode) === -1) return where + 'the schedule type is not known.';
    if (r.scheduleMode === 'fixed' && !R.isValidTimeZone(r.timeZone)) return where + 'the fixed time zone is not valid.';
    if (r.lastNotifiedOn !== undefined && r.lastNotifiedOn !== '' && !R.isValidDate(r.lastNotifiedOn)) return where + 'a date inside it is not a real date.';
    if (r.lastNotifiedAtMs !== undefined && !(typeof r.lastNotifiedAtMs === 'number' && isFinite(r.lastNotifiedAtMs) && r.lastNotifiedAtMs >= 0)) return where + 'a number inside it is not valid.';
    return null;
  }

  function checkTimelineEntry(e, index) {
    var where = 'Timeline entry ' + (index + 1) + ': ';
    if (!isObject(e)) return where + 'is not an entry.';
    if (!R.isValidDate(e.date)) return where + 'the date is not a real date (YYYY-MM-DD).';
    if (!isText(e.event, 200)) return where + 'needs an event of up to 200 characters.';
    if (typeof e.status !== 'string' || e.status.length > 200) return where + 'the status is too long or not text.';
    return null;
  }

  /**
   * Checks a backup file's text. Never throws and never writes anything.
   * Returns { ok: true, backup: { exportedAt, reminders, timeline } } or
   *         { ok: false, code, message, problems }. code is one of:
   *   too-large, not-json, not-a-backup, unsupported-version, newer-version, invalid-data
   */
  function parseBackup(text) {
    if (typeof text !== 'string') return fail('not-json', 'That file could not be read as text.');
    // Length in characters is at most the size in bytes, so also check the real byte size when we can.
    var bytes = typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(text).length : text.length;
    if (bytes > MAX_BYTES) {
      return fail('too-large', 'That file is bigger than ' + (MAX_BYTES / 1024) + ' KB, which is more than a RELIEF backup ever holds. Nothing was changed.');
    }

    var parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      return fail('not-json', 'That file is not valid JSON, so it is not a RELIEF backup. Nothing was changed.');
    }

    if (!isObject(parsed) || parsed.format !== FORMAT) {
      return fail('not-a-backup', 'That file is not a RELIEF backup. Nothing was changed.');
    }
    if (typeof parsed.version !== 'number' || !isFinite(parsed.version) || Math.floor(parsed.version) !== parsed.version || parsed.version < 1) {
      return fail('unsupported-version', 'This backup has a version number RELIEF does not understand. Nothing was changed.');
    }
    if (parsed.version > VERSION) {
      return fail('newer-version', 'This backup was made by a newer version of RELIEF (backup version ' + parsed.version + ', this page reads version ' + VERSION + '). Nothing was changed.');
    }

    var data = parsed.data;
    if (!isObject(data) || !Array.isArray(data.reminders) || !Array.isArray(data.timeline)) {
      return fail('invalid-data', 'The backup is missing its reminders or timeline list. Nothing was changed.');
    }
    if (data.reminders.length > MAX_REMINDERS || data.timeline.length > MAX_TIMELINE) {
      return fail('invalid-data', 'The backup has more than ' + MAX_REMINDERS + ' reminders or ' + MAX_TIMELINE + ' timeline entries. Nothing was changed.');
    }

    var problems = [];
    var seen = {};
    data.reminders.forEach(function (r, i) {
      var problem = checkReminder(r, i);
      if (!problem && seen[r.id]) problem = 'Reminder ' + (i + 1) + ': uses the same id as an earlier reminder.';
      if (problem) problems.push(problem);
      else seen[r.id] = true;
    });
    data.timeline.forEach(function (e, i) {
      var problem = checkTimelineEntry(e, i);
      if (problem) problems.push(problem);
    });
    if (problems.length) {
      var shown = problems.slice(0, MAX_PROBLEMS_SHOWN);
      if (problems.length > shown.length) shown.push('And ' + (problems.length - shown.length) + ' more.');
      return fail('invalid-data', 'The backup has ' + problems.length + ' entr' + (problems.length === 1 ? 'y' : 'ies') + ' that cannot be used, so none of it was loaded. Nothing was changed.', shown);
    }

    return {
      ok: true,
      backup: {
        exportedAt: typeof parsed.exportedAt === 'string' ? parsed.exportedAt.slice(0, 40) : '',
        // Same cleaning the dashboard applies when it reads its own data.
        reminders: data.reminders.map(function (r, i) { return R.normalizeReminder(r, i); }),
        timeline: data.timeline.map(function (e) {
          return { date: e.date, event: R.clip(e.event, 200), status: R.clip(e.status, 200) };
        })
      }
    };
  }

  // ---------- import: preview and apply ----------

  /** What the user is about to replace, for the confirmation step. Counts and the reminder names the file holds. */
  function describeImport(backup, storage) {
    var current = collect(storage);
    return {
      exportedAt: backup.exportedAt,
      file: { reminders: backup.reminders.length, timeline: backup.timeline.length },
      current: { reminders: current.reminders.length, timeline: current.timeline.length },
      reminders: backup.reminders.map(function (r) { return r.medicine + ' at ' + r.time; })
    };
  }

  function restoreValue(storage, key, value) {
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, value);
  }

  /**
   * Replaces the saved reminders and timeline with the backup, or changes nothing.
   * Resolves { ok: true, reminders, timeline } or { ok: false, code, message, rolledBack }.
   * code: 'storage-unavailable' (could not read the current data, nothing was touched) or
   *       'write-failed' (a write was refused or did not read back; the old values were put back).
   */
  function applyBackup(storage, backup) {
    var before;
    try {
      before = [readListStrict(storage, REMINDERS_KEY), readListStrict(storage, HISTORY_KEY)];
    } catch (e) {
      return { ok: false, code: 'storage-unavailable', message: 'This browser is not letting RELIEF read its saved data, so nothing was changed.', rolledBack: true };
    }

    var next = [JSON.stringify(backup.reminders), JSON.stringify(backup.timeline)];
    try {
      storage.setItem(REMINDERS_KEY, next[0]);
      storage.setItem(HISTORY_KEY, next[1]);
      if (storage.getItem(REMINDERS_KEY) !== next[0] || storage.getItem(HISTORY_KEY) !== next[1]) {
        throw new Error('read back differs');
      }
      return { ok: true, reminders: backup.reminders.length, timeline: backup.timeline.length };
    } catch (e) {
      var rolledBack = true;
      [REMINDERS_KEY, HISTORY_KEY].forEach(function (key, i) {
        try { restoreValue(storage, key, before[i]); } catch (err) { rolledBack = false; }
      });
      return {
        ok: false,
        code: 'write-failed',
        message: rolledBack
          ? 'This browser refused to save the backup (storage may be full or blocked). Your current reminders and timeline were put back as they were.'
          : 'This browser refused to save the backup and the old data could not be fully put back. Check your reminders and timeline before doing anything else.',
        rolledBack: rolledBack
      };
    }
  }

  // A storage that throws is an error here, not "nothing stored".
  function readListStrict(storage, key) {
    var raw = storage.getItem(key);
    return raw === undefined ? null : raw;
  }

  return {
    FORMAT: FORMAT,
    VERSION: VERSION,
    MAX_BYTES: MAX_BYTES,
    MAX_REMINDERS: MAX_REMINDERS,
    MAX_TIMELINE: MAX_TIMELINE,
    NOTICE: NOTICE,
    SAMPLE_TIMELINE: SAMPLE_TIMELINE,
    REMINDERS_KEY: REMINDERS_KEY,
    HISTORY_KEY: HISTORY_KEY,
    collect: collect,
    buildBackup: buildBackup,
    backupFileName: backupFileName,
    parseBackup: parseBackup,
    describeImport: describeImport,
    applyBackup: applyBackup
  };
}));
