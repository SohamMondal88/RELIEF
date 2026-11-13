/**
 * Export and import of the dashboard data (Issue #82).
 *
 * node --test tests/data-backup.test.js
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const B = require('../assets/js/data-backup.js');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

function memoryStorage(initial) {
  const data = Object.assign({}, initial);
  const calls = { writes: [] };
  return {
    data,
    calls,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { calls.writes.push(k); data[k] = String(v); },
    removeItem: (k) => { calls.writes.push(k); delete data[k]; }
  };
}

const reminder = (extra) => Object.assign({
  id: 'r1', medicine: 'Metformin 500mg', instructions: 'after breakfast', time: '08:00', startDate: '', endDate: '',
  status: 'active', scheduleMode: 'local', timeZone: 'Asia/Kolkata', lastNotifiedOn: '', lastNotifiedAtMs: 0
}, extra);
const entry = (extra) => Object.assign({ date: '2026-02-01', event: 'Medication reminder created', status: 'Metformin 500mg at 08:00' }, extra);

function backupText(mutate) {
  const doc = { format: 'relief-local-backup', version: 1, exportedAt: '2026-11-13T10:00:00.000Z', notice: B.NOTICE, data: { reminders: [reminder()], timeline: [entry()] } };
  if (mutate) mutate(doc);
  return JSON.stringify(doc);
}

const stored = () => memoryStorage({
  relief_reminders_v1: JSON.stringify([reminder(), reminder({ id: 'r2', medicine: 'Iron', time: '21:00' })]),
  relief_history_v1: JSON.stringify([entry(), { date: '2026-01-02', event: 'Symptom check completed', status: 'Advised doctor consult' }]),
  somebody_elses_key: 'keep me'
});

// ---------- export ----------

test('[export] the file is versioned, labelled as a local backup and holds only reminders and the timeline', () => {
  const doc = B.buildBackup(stored(), new Date('2026-11-13T10:00:00Z'));
  assert.strictEqual(doc.format, 'relief-local-backup');
  assert.strictEqual(doc.version, 1);
  assert.strictEqual(doc.exportedAt, '2026-11-13T10:00:00.000Z');
  assert.match(doc.notice, /not a medical record/);
  assert.deepStrictEqual(Object.keys(doc.data).sort(), ['reminders', 'timeline']);
  assert.strictEqual(doc.data.reminders.length, 2);
  assert.ok(!JSON.stringify(doc).includes('keep me'), 'unrelated storage is not exported');
});

test('[export] the two sample rows the dashboard seeds are not exported as the user\'s own entries', () => {
  const doc = B.buildBackup(stored());
  assert.deepStrictEqual(doc.data.timeline.map((e) => e.event), ['Medication reminder created']);
  // the samples are really the ones dashboard.js writes
  const js = read('assets', 'js', 'dashboard.js');
  B.SAMPLE_TIMELINE.forEach((s) => {
    assert.ok(js.includes("event: '" + s.event + "'") && js.includes("status: '" + s.status + "'"), s.event);
  });
});

test('[export] empty, missing or damaged storage gives an empty backup, not an error', () => {
  [memoryStorage(), memoryStorage({ relief_reminders_v1: '{oops', relief_history_v1: '[[' })].forEach((st) => {
    const doc = B.buildBackup(st);
    assert.deepStrictEqual(doc.data, { reminders: [], timeline: [] });
  });
  const throwing = { getItem() { throw new Error('blocked'); } };
  assert.deepStrictEqual(B.collect(throwing), { reminders: [], timeline: [] });
});

test('[export] the file name carries the date', () => {
  assert.strictEqual(B.backupFileName(new Date('2026-11-13T10:00:00Z')), 'relief-backup-2026-11-13.json');
});

test('[export] a timeline entry with a broken date would not be accepted back, so it is left out', () => {
  const st = memoryStorage({ relief_history_v1: JSON.stringify([entry({ date: 'yesterday' }), entry()]) });
  const doc = B.buildBackup(st);
  assert.strictEqual(doc.data.timeline.length, 1);
  assert.ok(B.parseBackup(JSON.stringify(doc)).ok);
});

// ---------- round trip ----------

test('[round trip] what is exported can be imported on another browser and reads back the same', () => {
  const from = stored();
  const text = JSON.stringify(B.buildBackup(from));
  const parsed = B.parseBackup(text);
  assert.strictEqual(parsed.ok, true);
  const to = memoryStorage({ somebody_elses_key: 'mine' });
  const applied = B.applyBackup(to, parsed.backup);
  assert.deepStrictEqual(applied, { ok: true, reminders: 2, timeline: 1 });
  assert.deepStrictEqual(B.collect(to), B.collect(from));
  assert.strictEqual(to.data.somebody_elses_key, 'mine');
});

// ---------- checking the file ----------

const REFUSED = [
  ['not text', null, 'not-json'],
  ['empty file', '', 'not-json'],
  ['not JSON', '{"format": "relief-local-backup", ', 'not-json'],
  ['a JSON list', '[1,2,3]', 'not-a-backup'],
  ['JSON null', 'null', 'not-a-backup'],
  ['another JSON file', JSON.stringify({ name: 'package', version: '1.0.0' }), 'not-a-backup'],
  ['wrong format name', backupText((d) => { d.format = 'something-else'; }), 'not-a-backup'],
  ['no version', backupText((d) => { delete d.version; }), 'unsupported-version'],
  ['version 0', backupText((d) => { d.version = 0; }), 'unsupported-version'],
  ['negative version', backupText((d) => { d.version = -1; }), 'unsupported-version'],
  ['fractional version', backupText((d) => { d.version = 1.5; }), 'unsupported-version'],
  ['version as text', backupText((d) => { d.version = '1'; }), 'unsupported-version'],
  ['a newer version', backupText((d) => { d.version = 2; }), 'newer-version'],
  ['no data', backupText((d) => { delete d.data; }), 'invalid-data'],
  ['data is a list', backupText((d) => { d.data = []; }), 'invalid-data'],
  ['no reminders list', backupText((d) => { delete d.data.reminders; }), 'invalid-data'],
  ['no timeline list', backupText((d) => { delete d.data.timeline; }), 'invalid-data'],
  ['reminders is an object', backupText((d) => { d.data.reminders = {}; }), 'invalid-data'],
  ['a reminder that is not an object', backupText((d) => { d.data.reminders = ['Iron']; }), 'invalid-data'],
  ['an empty medicine name', backupText((d) => { d.data.reminders[0].medicine = '   '; }), 'invalid-data'],
  ['a medicine name over 80 characters', backupText((d) => { d.data.reminders[0].medicine = 'x'.repeat(81); }), 'invalid-data'],
  ['a note over 300 characters', backupText((d) => { d.data.reminders[0].instructions = 'x'.repeat(301); }), 'invalid-data'],
  ['a time that is not HH:MM', backupText((d) => { d.data.reminders[0].time = '25:61'; }), 'invalid-data'],
  ['a missing id', backupText((d) => { delete d.data.reminders[0].id; }), 'invalid-data'],
  ['an unknown status', backupText((d) => { d.data.reminders[0].status = 'deleted'; }), 'invalid-data'],
  ['a date that does not exist', backupText((d) => { d.data.reminders[0].startDate = '2026-02-30'; }), 'invalid-data'],
  ['an unknown schedule type', backupText((d) => { d.data.reminders[0].scheduleMode = 'moon'; }), 'invalid-data'],
  ['a fixed schedule with a made up time zone', backupText((d) => { d.data.reminders[0].scheduleMode = 'fixed'; d.data.reminders[0].timeZone = 'Mars/Base'; }), 'invalid-data'],
  ['a negative notified time', backupText((d) => { d.data.reminders[0].lastNotifiedAtMs = -5; }), 'invalid-data'],
  ['two reminders with the same id', backupText((d) => { d.data.reminders.push(reminder()); }), 'invalid-data'],
  ['a timeline date that is not a date', backupText((d) => { d.data.timeline[0].date = 'soon'; }), 'invalid-data'],
  ['a timeline entry without an event', backupText((d) => { d.data.timeline[0].event = ''; }), 'invalid-data'],
  ['a timeline status that is not text', backupText((d) => { d.data.timeline[0].status = 5; }), 'invalid-data'],
  ['201 reminders', backupText((d) => { d.data.reminders = Array.from({ length: 201 }, (_, i) => reminder({ id: 'r' + i })); }), 'invalid-data'],
  ['201 timeline entries', backupText((d) => { d.data.timeline = Array.from({ length: 201 }, () => entry()); }), 'invalid-data'],
  ['a file over the size limit', ' '.repeat(B.MAX_BYTES + 1), 'too-large']
];

REFUSED.forEach(([name, text, code]) => {
  test('[reject] ' + name + ' is refused as ' + code + ' and writes nothing', () => {
    const st = stored();
    const before = JSON.stringify(st.data);
    const result = B.parseBackup(text);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, code);
    assert.match(result.message, /./);
    assert.match(result.message, /Nothing was changed|could not be read/);
    assert.strictEqual(JSON.stringify(st.data), before);
    assert.strictEqual(st.calls.writes.length, 0);
  });
});

test('[reject] the size limit counts bytes, not characters', () => {
  // 3 bytes each, so this is under the limit in characters and over it in bytes
  const text = '€'.repeat(Math.floor(B.MAX_BYTES / 3) + 10);
  assert.ok(text.length < B.MAX_BYTES);
  assert.strictEqual(B.parseBackup(text).code, 'too-large');
});

test('[reject] one bad entry refuses the whole file, even when the others are fine', () => {
  const text = backupText((d) => {
    d.data.reminders.push(reminder({ id: 'r2', medicine: 'Iron', time: '9am' }));
    d.data.timeline.push(entry({ date: 'nope' }));
  });
  const result = B.parseBackup(text);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.problems.length, 2);
  assert.match(result.problems[0], /^Reminder 2: the time is not HH:MM/);
  assert.match(result.problems[1], /^Timeline entry 2: /);
});

test('[reject] the list of problems is capped and never repeats what the file said', () => {
  const text = backupText((d) => {
    d.data.reminders = Array.from({ length: 12 }, (_, i) => reminder({ id: 'r' + i, medicine: 'SECRET-MEDICINE-' + i, time: 'bad' }));
  });
  const result = B.parseBackup(text);
  assert.strictEqual(result.problems.length, 6);
  assert.strictEqual(result.problems[5], 'And 7 more.');
  assert.ok(!JSON.stringify(result).includes('SECRET-MEDICINE'));
});

test('[accept] extra fields are ignored and only known fields reach storage', () => {
  const text = backupText((d) => {
    d.somethingElse = { a: 1 };
    d.data.reminders[0].password = 'hunter2';
    d.data.reminders[0].__proto__ = { polluted: true };
    d.data.timeline[0].extra = 'x';
  });
  const result = B.parseBackup(text);
  assert.strictEqual(result.ok, true);
  assert.ok(!('password' in result.backup.reminders[0]));
  assert.ok(!('extra' in result.backup.timeline[0]));
  assert.strictEqual(({}).polluted, undefined);
});

test('[accept] an empty backup is allowed and clears what is saved when confirmed', () => {
  const result = B.parseBackup(backupText((d) => { d.data.reminders = []; d.data.timeline = []; }));
  assert.strictEqual(result.ok, true);
  const st = stored();
  assert.strictEqual(B.applyBackup(st, result.backup).ok, true);
  assert.strictEqual(st.data.relief_reminders_v1, '[]');
});

test('[accept] a reminder made by an older build (no schedule fields) is read the way the dashboard reads it', () => {
  const result = B.parseBackup(backupText((d) => { d.data.reminders = [{ id: 'old', medicine: 'Iron', time: '07:30' }]; }));
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.backup.reminders[0].scheduleMode, 'local');
  assert.strictEqual(result.backup.reminders[0].status, 'active');
});

test('[accept] exactly 200 reminders and a file just under the limit are fine', () => {
  const result = B.parseBackup(backupText((d) => { d.data.reminders = Array.from({ length: 200 }, (_, i) => reminder({ id: 'r' + i })); }));
  assert.strictEqual(result.ok, true);
  assert.ok(JSON.stringify(result.backup).length < B.MAX_BYTES);
});

test('[preview] says what is in the file and what it replaces, without touching storage', () => {
  const st = stored();
  const result = B.parseBackup(backupText());
  const info = B.describeImport(result.backup, st);
  assert.deepStrictEqual(info.file, { reminders: 1, timeline: 1 });
  assert.deepStrictEqual(info.current, { reminders: 2, timeline: 1 });
  assert.deepStrictEqual(info.reminders, ['Metformin 500mg at 08:00']);
  assert.strictEqual(st.calls.writes.length, 0);
});

// ---------- writing: all or nothing ----------

test('[apply] replaces the reminders and the timeline and leaves every other key alone', () => {
  const st = stored();
  const result = B.applyBackup(st, B.parseBackup(backupText()).backup);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(JSON.parse(st.data.relief_reminders_v1).length, 1);
  assert.strictEqual(JSON.parse(st.data.relief_history_v1).length, 1);
  assert.strictEqual(st.data.somebody_elses_key, 'keep me');
  assert.deepStrictEqual(st.calls.writes, ['relief_reminders_v1', 'relief_history_v1']);
});

test('[apply] a failure on the second write puts the first value back', () => {
  const st = stored();
  const before = JSON.stringify(st.data);
  const realSet = st.setItem;
  let writes = 0;
  st.setItem = (k, v) => { writes += 1; if (writes === 2) throw new Error('QuotaExceededError'); return realSet(k, v); };
  const result = B.applyBackup(st, B.parseBackup(backupText()).backup);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'write-failed');
  assert.strictEqual(result.rolledBack, true);
  assert.match(result.message, /put back as they were/);
  assert.strictEqual(JSON.stringify(st.data), before);
});

test('[apply] a failure on the first write changes nothing', () => {
  const st = stored();
  const before = JSON.stringify(st.data);
  st.setItem = () => { throw new Error('blocked'); };
  const result = B.applyBackup(st, B.parseBackup(backupText()).backup);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(JSON.stringify(st.data), before);
});

test('[apply] a key that was empty before is removed again when the import fails', () => {
  const st = memoryStorage({ relief_reminders_v1: '[]' });
  const realSet = st.setItem;
  st.setItem = (k, v) => { if (k === 'relief_history_v1') throw new Error('full'); return realSet(k, v); };
  assert.strictEqual(B.applyBackup(st, B.parseBackup(backupText()).backup).ok, false);
  assert.strictEqual(st.data.relief_reminders_v1, '[]');
  assert.ok(!('relief_history_v1' in st.data));
});

test('[apply] a browser that accepts a write but does not keep it is treated as a failure and rolled back', () => {
  const st = stored();
  const before = JSON.stringify(st.data);
  const realSet = st.setItem;
  st.setItem = (k, v) => { if (k === 'relief_history_v1' && JSON.parse(v).length === 1 && JSON.parse(v)[0].event === 'Medication reminder created' && !st.__restoring) { return; } return realSet(k, v); };
  const result = B.applyBackup(st, B.parseBackup(backupText()).backup);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(JSON.stringify(st.data), before);
});

test('[apply] when even the roll back fails the message says so', () => {
  const st = stored();
  let failAll = false;
  const realSet = st.setItem;
  st.setItem = (k, v) => { if (k === 'relief_history_v1') { failAll = true; throw new Error('full'); } return realSet(k, v); };
  st.removeItem = () => { throw new Error('blocked'); };
  const originalReminders = st.data.relief_reminders_v1;
  // the first write succeeded, so restoring it needs setItem, which now throws as well
  st.setItem = (k, v) => { if (failAll || k === 'relief_history_v1') { failAll = true; throw new Error('full'); } return realSet(k, v); };
  const result = B.applyBackup(st, B.parseBackup(backupText()).backup);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.rolledBack, false);
  assert.match(result.message, /could not be fully put back/);
  assert.notStrictEqual(st.data.relief_reminders_v1, originalReminders);
});

test('[apply] storage that cannot even be read is left untouched', () => {
  const st = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('no'); }, removeItem() {} };
  const result = B.applyBackup(st, B.parseBackup(backupText()).backup);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, 'storage-unavailable');
});

// ---------- page and docs ----------

test('[page] the dashboard has the backup section, labelled as local and not a medical record, and loads the scripts in order', () => {
  const html = read('pages', 'dashboard.html');
  ['backup-export', 'backup-file', 'backup-preview', 'backup-apply', 'backup-cancel', 'backup-status'].forEach((id) => {
    assert.ok(html.includes('id="' + id + '"'), id);
  });
  assert.match(html, /not a medical record/);
  assert.match(html, /id="backup-status"[^>]*aria-live="polite"/);
  assert.match(html, /<input type="file" id="backup-file" accept="\.json,application\/json"/);
  const at = (name) => html.indexOf('assets/js/' + name);
  assert.ok(at('reminders.js') < at('data-backup.js') && at('data-backup.js') < at('data-backup-ui.js') && at('data-backup-ui.js') !== -1);
});

test('[page] nothing is written before the user confirms, and the dashboard reloads its own state after an import', () => {
  const ui = read('assets', 'js', 'data-backup-ui.js');
  const first = ui.indexOf('applyBackup(');
  const click = ui.lastIndexOf("applyBtn.addEventListener('click'", first);
  assert.ok(click !== -1 && first - click < 200, 'applyBackup is only called from the Replace button');
  assert.ok(!/localStorage\.(setItem|removeItem)/.test(ui), 'the UI never writes storage directly');
  assert.match(read('assets', 'js', 'dashboard.js'), /relief:data-imported/);
});

test('[docs] the privacy document describes the export and the limits of it', () => {
  const doc = read('docs', 'PRIVACY_AND_DATA.md');
  assert.match(doc, /data-backup\.js/);
  assert.ok(!/Move it elsewhere:\*\* not supported yet/.test(doc));
  assert.match(doc, /not a medical record/);
});
