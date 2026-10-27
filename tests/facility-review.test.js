/**
 * Tests for the facility verification workflow (Issue #55).
 * Run with: node --test tests/facility-review.test.js
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const U = require('../assets/js/facility-utils.js');
const R = require('../assets/js/facility-review.js');

const ROOT = path.join(__dirname, '..');
const NOW = Date.parse('2026-10-27T10:00:00Z');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const clone = (o) => JSON.parse(JSON.stringify(o));

function raw(over) {
  return Object.assign({
    id: 'fac-x', name: 'X Hospital', type: 'hospital', district: 'Bankura', address: null,
    phone: '+91 3242 250 201', hours: null, services: ['Surgery'], lat: 23.2, lng: 87.0,
    verified: false, reviewState: 'pending', verifiedBy: null, source: null, lastChecked: null, reviewLog: []
  }, over);
}

const VERIFY = { state: 'verified', by: 'maintainer-a', source: 'District health office list', date: '2026-10-20' };

// ---- applyReview ----

test('verifying needs a source, a person and a real date, and says what is missing', () => {
  const r = R.applyReview(raw(), { state: 'verified', by: '', source: '', date: '2026-02-31' }, { now: NOW });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.errors.length, 3);
  assert.match(r.errors.join(' '), /without a source/);
  assert.match(r.errors.join(' '), /who made this decision/);
  assert.match(r.errors.join(' '), /real date/);
});

test('a verification dated in the future is refused', () => {
  const r = R.applyReview(raw(), Object.assign({}, VERIFY, { date: '2026-10-28' }), { now: NOW });
  assert.strictEqual(r.ok, false);
  assert.match(r.errors[0], /future/);
});

test('verifying sets the evidence fields and appends one log entry', () => {
  const before = raw();
  const frozen = JSON.stringify(before);
  const r = R.applyReview(before, VERIFY, { now: NOW });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(JSON.stringify(before), frozen, 'input must not be changed');
  const f = r.record;
  assert.strictEqual(f.reviewState, 'verified');
  assert.strictEqual(f.verified, true);
  assert.strictEqual(f.verifiedBy, 'maintainer-a');
  assert.strictEqual(f.source, 'District health office list');
  assert.strictEqual(f.lastChecked, '2026-10-20');
  assert.strictEqual(f.reviewLog.length, 1);
  assert.deepStrictEqual(f.reviewLog[0], {
    at: '2026-10-27T10:00:00.000Z', by: 'maintainer-a', from: 'pending', to: 'verified',
    date: '2026-10-20', source: 'District health office list'
  });
  assert.deepStrictEqual(R.validateRecord(f, { now: NOW }), []);
});

test('the date defaults to today', () => {
  const r = R.applyReview(raw(), { state: 'verified', by: 'a', source: 's' }, { now: NOW });
  assert.strictEqual(r.record.lastChecked, '2026-10-27');
});

test('stale, rejected and pending need a note, and keep the earlier evidence', () => {
  const verified = R.applyReview(raw(), VERIFY, { now: NOW }).record;
  ['stale', 'rejected', 'pending'].forEach((state) => {
    const no = R.applyReview(verified, { state, by: 'maintainer-b' }, { now: NOW });
    assert.strictEqual(no.ok, false, state);
    assert.match(no.errors[0], /note/);
    const yes = R.applyReview(verified, { state, by: 'maintainer-b', note: 'phone no longer answers' }, { now: NOW + 1000 });
    assert.strictEqual(yes.ok, true, state);
    assert.strictEqual(yes.record.verified, false);
    assert.strictEqual(yes.record.reviewState, state);
    assert.strictEqual(yes.record.source, 'District health office list');
    assert.strictEqual(yes.record.lastChecked, '2026-10-20');
    assert.strictEqual(yes.record.reviewLog.length, 2);
    assert.deepStrictEqual(R.validateRecord(yes.record, { now: NOW }), []);
  });
});

test('an unknown state is refused', () => {
  const r = R.applyReview(raw(), { state: 'approved', by: 'a', note: 'x' }, { now: NOW });
  assert.strictEqual(r.ok, false);
  assert.match(r.errors[0], /pending, verified, stale, rejected/);
});

test('text is stripped of markup and control characters and cut to length', () => {
  const r = R.applyReview(raw(), { state: 'verified', by: '<b>maint\u0000ainer</b>\u202e', source: 'S'.repeat(500), note: 'n'.repeat(900) }, { now: NOW });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.record.verifiedBy, 'bmaint ainer/b');
  assert.strictEqual(r.record.source.length, R.LIMITS.source);
  assert.strictEqual(r.record.reviewLog[0].note.length, R.LIMITS.note);
  assert.ok(!/[<>\u202e\u0000]/.test(JSON.stringify(r.record)));
});

test('the log only grows: three decisions keep all three in order', () => {
  let f = raw();
  f = R.applyReview(f, VERIFY, { now: NOW }).record;
  f = R.applyReview(f, { state: 'stale', by: 'maintainer-b', note: 'closed for repairs' }, { now: NOW + 60000 }).record;
  f = R.applyReview(f, Object.assign({}, VERIFY, { date: '2026-10-27', by: 'maintainer-c' }), { now: NOW + 120000 }).record;
  assert.deepStrictEqual(f.reviewLog.map((e) => e.from + '>' + e.to), ['pending>verified', 'verified>stale', 'stale>verified']);
  assert.deepStrictEqual(f.reviewLog.map((e) => e.by), ['maintainer-a', 'maintainer-b', 'maintainer-c']);
  assert.deepStrictEqual(R.validateRecord(f, { now: NOW + 200000 }), []);
});

// ---- validateRecord ----

test('validateRecord: a verified record with no evidence is an error', () => {
  const bad = raw({ verified: true, reviewState: 'verified' });
  const out = R.validateRecord(bad, { now: NOW }).join('\n');
  assert.match(out, /without a source/);
  assert.match(out, /without verifiedBy/);
  assert.match(out, /valid lastChecked/);
  assert.match(out, /reviewLog is empty|no record of who/);
});

test('validateRecord: the boolean must agree with the state', () => {
  assert.match(R.validateRecord(raw({ verified: true }), { now: NOW }).join(), /does not match reviewState/);
});

test('validateRecord: a state other than pending needs a log entry that explains it', () => {
  const hand = raw({ reviewState: 'rejected' });
  assert.match(R.validateRecord(hand, { now: NOW }).join(), /no record of who decided it/);
  const wrongLast = R.applyReview(raw(), VERIFY, { now: NOW }).record;
  wrongLast.reviewState = 'stale';
  assert.match(R.validateRecord(wrongLast, { now: NOW }).join('\n'), /last log entry says verified/);
});

test('validateRecord: edited evidence that no longer matches the log is caught', () => {
  const good = R.applyReview(raw(), VERIFY, { now: NOW }).record;
  const bySwap = clone(good); bySwap.verifiedBy = 'someone-else';
  const dateSwap = clone(good); dateSwap.lastChecked = '2026-10-26';
  const sourceSwap = clone(good); sourceSwap.source = 'Made up';
  assert.match(R.validateRecord(bySwap, { now: NOW }).join(), /verifiedBy does not match/);
  assert.match(R.validateRecord(dateSwap, { now: NOW }).join(), /lastChecked does not match/);
  assert.match(R.validateRecord(sourceSwap, { now: NOW }).join(), /source does not match/);
});

test('validateRecord: a log that goes back in time or skips a state is caught', () => {
  let f = R.applyReview(raw(), VERIFY, { now: NOW }).record;
  f = R.applyReview(f, { state: 'stale', by: 'b', note: 'n' }, { now: NOW + 1000 }).record;
  const backwards = clone(f); backwards.reviewLog[1].at = '2020-01-01T00:00:00.000Z';
  assert.match(R.validateRecord(backwards, { now: NOW }).join(), /older than the entry before/);
  const gap = clone(f); gap.reviewLog[1].from = 'pending';
  assert.match(R.validateRecord(gap, { now: NOW }).join(), /starts from pending/);
});

test('validateRecord: a lastChecked date with no source is refused', () => {
  assert.match(R.validateRecord(raw({ lastChecked: '2026-10-01' }), { now: NOW }).join(), /no source/);
  assert.match(R.validateRecord(raw({ lastChecked: 'yesterday' }), { now: NOW }).join(), /real YYYY-MM-DD/);
});

// ---- compareRecords (what a pull request may change) ----

test('compareRecords: adding a log entry with a review change is fine', () => {
  const before = raw();
  const after = R.applyReview(before, VERIFY, { now: NOW }).record;
  assert.deepStrictEqual(R.compareRecords(before, after), []);
});

test('compareRecords: editing or deleting an earlier log entry is refused', () => {
  const before = R.applyReview(raw(), VERIFY, { now: NOW }).record;
  const edited = clone(before); edited.reviewLog[0].by = 'someone-else';
  const wiped = clone(before); wiped.reviewLog = [];
  assert.match(R.compareRecords(before, edited).join(), /may only be added to/);
  assert.match(R.compareRecords(before, wiped).join(), /may only be added to/);
});

test('compareRecords: changing the review fields without a log entry is refused', () => {
  const before = raw();
  const after = clone(before); after.source = 'Some site'; after.lastChecked = '2026-10-20';
  assert.match(R.compareRecords(before, after).join(), /without a new reviewLog entry/);
});

test('compareRecords: changing the details of a verified record needs a new verification', () => {
  const before = R.applyReview(raw(), VERIFY, { now: NOW }).record;
  const sneaky = clone(before); sneaky.phone = '+91 99999 99999';
  assert.match(R.compareRecords(before, sneaky).join(), /details changed \(phone\) on a verified record/);

  const downgraded = R.applyReview(sneaky, { state: 'pending', by: 'maintainer-b', note: 'phone changed, needs a re-check' }, { now: NOW + 1000 }).record;
  assert.deepStrictEqual(R.compareRecords(before, downgraded), []);

  const reverified = R.applyReview(sneaky, Object.assign({}, VERIFY, { date: '2026-10-27' }), { now: NOW + 2000 }).record;
  assert.deepStrictEqual(R.compareRecords(before, reverified), []);
});

test('compareRecords: details of a pending record can change freely', () => {
  const before = raw();
  const after = clone(before); after.hours = 'Mon to Sat 9:00 to 17:00';
  assert.deepStrictEqual(R.compareRecords(before, after), []);
});

test('compareRecords: a record from before the workflow gaining the new empty fields is not a review change', () => {
  const legacy = { id: 'a', name: 'A', type: 'hospital', verified: false, source: null, lastChecked: null };
  const upgraded = raw({ id: 'a', name: 'A', type: 'hospital', district: undefined, address: undefined, phone: undefined, services: undefined, lat: undefined, lng: undefined });
  assert.deepStrictEqual(R.compareRecords(legacy, upgraded), []);
  const forged = raw({ id: 'a', name: 'A', type: 'hospital', reviewState: 'verified', verified: true, verifiedBy: 'x', source: 's', lastChecked: '2026-10-01' });
  assert.match(R.compareRecords(legacy, forged).join(), /without a new reviewLog entry/);
});

test('compareFiles matches records by id and ignores new records', () => {
  const a = { facilities: [raw({ id: 'a' }), raw({ id: 'b' })] };
  const b = clone(a);
  b.facilities[0].source = 'x';
  b.facilities.push(raw({ id: 'c' }));
  const out = R.compareFiles(a, b);
  assert.strictEqual(out.length, 1);
  assert.match(out[0], /^a:/);
});

// ---- queue and summary ----

function fileForQueue() {
  const fresh = R.applyReview(raw({ id: 'f-fresh', name: 'Fresh' }), Object.assign({}, VERIFY, { date: '2026-10-20' }), { now: NOW }).record;
  const oldStale = R.applyReview(raw({ id: 'f-old', name: 'Old' }), Object.assign({}, VERIFY, { date: '2025-12-01' }), { now: Date.parse('2025-12-01T10:00:00Z') }).record;
  const olderStale = R.applyReview(raw({ id: 'f-older', name: 'Older' }), Object.assign({}, VERIFY, { date: '2025-03-01' }), { now: Date.parse('2025-03-01T10:00:00Z') }).record;
  const marked = R.applyReview(R.applyReview(raw({ id: 'f-marked', name: 'Marked' }), VERIFY, { now: NOW }).record, { state: 'stale', by: 'b', note: 'n' }, { now: NOW + 1000 }).record;
  const rejected = R.applyReview(raw({ id: 'f-rej', name: 'Rejected' }), { state: 'rejected', by: 'b', note: 'no such place' }, { now: NOW }).record;
  const pendingNever1 = raw({ id: 'f-p2', name: 'P2' });
  const pendingNever2 = raw({ id: 'f-p1', name: 'P1' });
  const pendingDated = R.applyReview(
    R.applyReview(raw({ id: 'f-pd', name: 'PD' }), Object.assign({}, VERIFY, { date: '2026-05-01' }), { now: Date.parse('2026-05-01T10:00:00Z') }).record,
    { state: 'pending', by: 'b', note: 'phone changed' }, { now: Date.parse('2026-05-02T10:00:00Z') }
  ).record;
  return U.normalizeFacilities({ facilities: [fresh, oldStale, pendingNever1, rejected, olderStale, marked, pendingDated, pendingNever2] });
}

test('queue: stale first, then pending, oldest check first, never-checked before dated, ties by id', () => {
  const q = R.queue(fileForQueue(), { now: NOW });
  assert.deepStrictEqual(q.map((i) => i.id + ':' + i.state), [
    'f-older:stale', 'f-old:stale', 'f-marked:stale', 'f-p1:pending', 'f-p2:pending', 'f-pd:pending'
  ]);
});

test('queue leaves out fresh verified and rejected records and reports how overdue each one is', () => {
  const q = R.queue(fileForQueue(), { now: NOW });
  assert.ok(!q.some((i) => i.id === 'f-fresh' || i.id === 'f-rej'));
  const older = q.find((i) => i.id === 'f-older');
  assert.strictEqual(older.ageDays, 605);
  assert.strictEqual(older.overdueDays, 605 - 180);
  assert.strictEqual(q.find((i) => i.id === 'f-p1').overdueDays, null);
});

test('summary counts each effective state', () => {
  assert.deepStrictEqual(R.summary(fileForQueue(), { now: NOW }), { verified: 1, stale: 3, pending: 3, rejected: 1, total: 8 });
});

test('the same record moves from verified to stale as time passes, with no edit', () => {
  const f = U.normalizeFacility(R.applyReview(raw(), Object.assign({}, VERIFY, { date: '2026-01-01' }), { now: Date.parse('2026-01-01T10:00:00Z') }).record);
  assert.strictEqual(R.queue([f], { now: Date.parse('2026-06-30T10:00:00Z') }).length, 0);
  assert.strictEqual(R.queue([f], { now: Date.parse('2026-07-01T10:00:00Z') }).length, 1);
});

// ---- the shipped data and the pages ----

test('the shipped facilities.json passes every check and every record is pending', () => {
  const data = JSON.parse(read('assets/data/facilities.json'));
  assert.deepStrictEqual(R.validateFile(data, { now: NOW }), []);
  assert.deepStrictEqual(data.reviewPolicy, { maxAgeDays: 180, byType: {} });
  data.facilities.forEach((f) => {
    assert.strictEqual(f.reviewState, 'pending', f.id);
    assert.strictEqual(f.verifiedBy, null, f.id);
    assert.deepStrictEqual(f.reviewLog, [], f.id);
  });
});

test('validateFile reports duplicate ids and a missing list', () => {
  assert.match(R.validateFile({}).join(), /no "facilities" array/);
  const d = { facilities: [raw({ id: 'a' }), raw({ id: 'a' })] };
  assert.match(R.validateFile(d, { now: NOW }).join(), /duplicate id/);
});

test('the admin panel loads the scripts in order and has the freshness view', () => {
  const html = read('pages/admin-panel.html');
  ['facility-freshness', 'freshness-counts', 'freshness-filter', 'freshness-message', 'freshness-rows', 'freshness-more'].forEach((id) => {
    assert.ok(html.includes('id="' + id + '"'), id);
  });
  const order = ['facility-utils.js', 'facility-review.js', 'facility-review-ui.js'].map((f) => html.indexOf('assets/js/' + f));
  assert.ok(order.every((i) => i !== -1));
  assert.deepStrictEqual(order.slice().sort((a, b) => a - b), order);
});

test('the freshness view draws with textContent only', () => {
  const code = read('assets/js/facility-review-ui.js').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(code, /innerHTML|insertAdjacentHTML|outerHTML|document\.write/);
});

test('the public site code never calls the review writer', () => {
  ['hospitals.js', 'facility-review-ui.js', 'facility-corrections.js', 'facility-corrections-ui.js'].forEach((f) => {
    assert.doesNotMatch(read('assets/js/' + f), /applyReview/, f);
  });
});

// ---- the maintainer script ----

function script(args, file) {
  return spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'facility-review.js')].concat(args, file ? ['--file', file] : []), { encoding: 'utf8' });
}

function tempData() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relief-fr-'));
  const file = path.join(dir, 'facilities.json');
  fs.copyFileSync(path.join(ROOT, 'assets', 'data', 'facilities.json'), file);
  return file;
}

test('script: summary and list work on the shipped data', () => {
  const s = script(['summary', '--now', '2026-10-27']);
  assert.strictEqual(s.status, 0, s.stderr);
  assert.match(s.stdout, /Facilities: 46/);
  assert.match(s.stdout, /pending\s+46/);
  const l = script(['list', '--limit', '2', '--now', '2026-10-27']);
  assert.match(l.stdout, /Needs a check: 46/);
  assert.match(l.stdout, /fac-001/);
  assert.doesNotMatch(l.stdout, /fac-003/);
  const j = JSON.parse(script(['list', '--json', '--limit', '1']).stdout);
  assert.strictEqual(j.length, 1);
  assert.strictEqual(j[0].id, 'fac-001');
});

test('script: record refuses a verification without a source and writes nothing', () => {
  const file = tempData();
  const before = fs.readFileSync(file, 'utf8');
  const r = script(['record', 'fac-001', '--state', 'verified', '--by', 'maintainer-a'], file);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /without a source/);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), before);
});

test('script: record verifies one record, appends a log entry and the file still passes check', () => {
  const file = tempData();
  const r = script(['record', 'fac-002', '--state', 'verified', '--by', 'maintainer-a', '--source', 'District health office list', '--date', '2026-10-20', '--now', '2026-10-27'], file);
  assert.strictEqual(r.status, 0, r.stderr);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const f = data.facilities.find((x) => x.id === 'fac-002');
  assert.strictEqual(f.reviewState, 'verified');
  assert.strictEqual(f.reviewLog.length, 1);
  assert.strictEqual(data.facilities.filter((x) => x.reviewState === 'verified').length, 1);
  assert.strictEqual(script(['check', '--now', '2026-10-27'], file).status, 0);
  const base = path.join(path.dirname(file), 'base.json');
  fs.copyFileSync(path.join(ROOT, 'assets', 'data', 'facilities.json'), base);
  const c = script(['check', '--base', base, '--now', '2026-10-27'], file);
  assert.strictEqual(c.status, 0, c.stderr);
});

test('script: the shipped data passes check against the version before this workflow existed', () => {
  const legacy = JSON.parse(read('assets/data/facilities.json'));
  delete legacy.reviewPolicy;
  legacy.facilities.forEach((f) => { delete f.reviewState; delete f.verifiedBy; delete f.reviewLog; });
  const base = path.join(path.dirname(tempData()), 'legacy.json');
  fs.writeFileSync(base, JSON.stringify(legacy, null, 2) + '\n');
  const c = script(['check', '--base', base, '--now', '2026-10-27']);
  assert.strictEqual(c.status, 0, c.stderr);
});

test('script: check --base fails when someone rewrites history or changes a verified record by hand', () => {
  const file = tempData();
  script(['record', 'fac-002', '--state', 'verified', '--by', 'maintainer-a', '--source', 'S', '--date', '2026-10-20', '--now', '2026-10-27'], file);
  const base = path.join(path.dirname(file), 'base.json');
  fs.copyFileSync(file, base);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const f = data.facilities.find((x) => x.id === 'fac-002');
  f.phone = '+91 1';
  f.reviewLog[0].by = 'someone-else';
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  const c = script(['check', '--base', base, '--now', '2026-10-27'], file);
  assert.strictEqual(c.status, 1);
  assert.match(c.stderr, /may only be added to/);
  assert.match(c.stderr, /details changed \(phone\)/);
});

test('script: an unknown id or command exits non zero', () => {
  assert.strictEqual(script(['record', 'nope', '--state', 'stale', '--by', 'a', '--note', 'n'], tempData()).status, 1);
  assert.strictEqual(script(['bogus']).status, 1);
});
