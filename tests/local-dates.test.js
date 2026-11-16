/**
 * "Today" in a time zone (Issue #181).
 *
 * The dashboard timeline used new Date().toISOString().slice(0, 10), which is the UTC date. In
 * Asia/Kolkata that is yesterday between 00:00 and 05:30. These tests run the helper for fixed
 * zones around local midnight and across daylight saving changes, so they give the same answer
 * on every machine whatever its own time zone is.
 *
 * node --test tests/local-dates.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const R = require('../assets/js/reminders.js');
const Schema = require('../assets/js/facility-schema.js');

const ROOT = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
const utcDay = (iso) => new Date(iso).toISOString().slice(0, 10);

// [zone, instant, local date, what the old UTC rule said]
const MIDNIGHTS = [
  // Kolkata is UTC+5:30 all year. Local midnight is 18:30 UTC the day before.
  ['Asia/Kolkata', '2026-11-15T18:29:59Z', '2026-11-15', '2026-11-15'],
  ['Asia/Kolkata', '2026-11-15T18:30:00Z', '2026-11-16', '2026-11-15'],
  ['Asia/Kolkata', '2026-11-15T23:59:59Z', '2026-11-16', '2026-11-15'],
  ['Asia/Kolkata', '2026-11-16T00:00:00Z', '2026-11-16', '2026-11-16'],
  // Los Angeles is UTC-8 in November and UTC-7 in summer. The UTC date runs ahead in the evening.
  ['America/Los_Angeles', '2026-11-17T07:59:59Z', '2026-11-16', '2026-11-17'],
  ['America/Los_Angeles', '2026-11-17T08:00:00Z', '2026-11-17', '2026-11-17'],
  ['America/Los_Angeles', '2026-07-01T06:59:59Z', '2026-06-30', '2026-07-01'],
  ['America/Los_Angeles', '2026-07-01T07:00:00Z', '2026-07-01', '2026-07-01'],
  // Kiritimati is UTC+14, the first place to reach a new date. Local midnight is 10:00 UTC the day before.
  ['Pacific/Kiritimati', '2026-11-15T09:59:59Z', '2026-11-15', '2026-11-15'],
  ['Pacific/Kiritimati', '2026-11-15T10:00:00Z', '2026-11-16', '2026-11-15'],
  ['Pacific/Kiritimati', '2026-11-15T23:59:59Z', '2026-11-16', '2026-11-15'],
  ['Pacific/Kiritimati', '2026-11-16T09:59:59Z', '2026-11-16', '2026-11-16'],
  // UTC itself is the control: the old rule and the new one agree.
  ['UTC', '2026-11-15T23:59:59Z', '2026-11-15', '2026-11-15'],
  ['UTC', '2026-11-16T00:00:00Z', '2026-11-16', '2026-11-16']
];

for (const [zone, instant, expected] of MIDNIGHTS) {
  test(`getTodayInZone: ${zone} at ${instant} is ${expected}`, () => {
    assert.strictEqual(R.getTodayInZone(new Date(instant), zone), expected);
    assert.strictEqual(R.getTodayInZone(Date.parse(instant), zone), expected, 'a number of milliseconds works too');
  });
}

test('the UTC date really was wrong in the zones above (so the tests above cover the bug)', () => {
  const wrong = MIDNIGHTS.filter(([, instant, expected]) => utcDay(instant) !== expected);
  assert.ok(wrong.length >= 6, 'expected several rows where the UTC date differs, got ' + wrong.length);
  MIDNIGHTS.forEach(([zone, instant, , utc]) => assert.strictEqual(utcDay(instant), utc, zone + ' ' + instant));
});

test('across a daylight saving change the date still flips at local midnight', () => {
  // US spring forward 2026-03-08 02:00 PST -> 03:00 PDT: that local day is 23 hours long.
  const la = 'America/Los_Angeles';
  assert.strictEqual(R.getTodayInZone(new Date('2026-03-08T07:59:59Z'), la), '2026-03-07');
  assert.strictEqual(R.getTodayInZone(new Date('2026-03-08T08:00:00Z'), la), '2026-03-08');
  assert.strictEqual(R.getTodayInZone(new Date('2026-03-09T06:59:59Z'), la), '2026-03-08', '23 hour day ends at 07:00 UTC');
  assert.strictEqual(R.getTodayInZone(new Date('2026-03-09T07:00:00Z'), la), '2026-03-09');

  // US fall back 2026-11-01 02:00 PDT -> 01:00 PST: that local day is 25 hours long.
  assert.strictEqual(R.getTodayInZone(new Date('2026-11-01T06:59:59Z'), la), '2026-10-31');
  assert.strictEqual(R.getTodayInZone(new Date('2026-11-01T07:00:00Z'), la), '2026-11-01');
  assert.strictEqual(R.getTodayInZone(new Date('2026-11-02T07:59:59Z'), la), '2026-11-01', '25 hour day ends at 08:00 UTC');
  assert.strictEqual(R.getTodayInZone(new Date('2026-11-02T08:00:00Z'), la), '2026-11-02');

  // Europe/London falls back 2026-10-25 02:00 BST -> 01:00 GMT. The repeated hour stays on the same date.
  const london = 'Europe/London';
  assert.strictEqual(R.getTodayInZone(new Date('2026-10-24T23:30:00Z'), london), '2026-10-25');
  assert.strictEqual(R.getTodayInZone(new Date('2026-10-25T00:30:00Z'), london), '2026-10-25');
  assert.strictEqual(R.getTodayInZone(new Date('2026-10-25T01:30:00Z'), london), '2026-10-25');
  assert.strictEqual(R.getTodayInZone(new Date('2026-10-25T23:59:59Z'), london), '2026-10-25');
  assert.strictEqual(R.getTodayInZone(new Date('2026-10-26T00:00:00Z'), london), '2026-10-26');
});

test('a leap day and a year end give real dates', () => {
  assert.strictEqual(R.getTodayInZone(new Date('2028-02-28T19:00:00Z'), 'Asia/Kolkata'), '2028-02-29');
  assert.strictEqual(R.getTodayInZone(new Date('2028-02-29T19:00:00Z'), 'Asia/Kolkata'), '2028-03-01');
  assert.strictEqual(R.getTodayInZone(new Date('2026-12-31T18:30:00Z'), 'Asia/Kolkata'), '2027-01-01');
});

test('an unknown zone or a broken instant falls back instead of throwing', () => {
  const device = R.getLocalTimeZone();
  const instant = new Date('2026-11-16T12:00:00Z');
  assert.strictEqual(R.getTodayInZone(instant, 'Not/AZone'), R.getTodayInZone(instant, device));
  assert.strictEqual(R.getTodayInZone(instant, ''), R.getTodayInZone(instant, device));
  assert.strictEqual(R.getTodayInZone(instant), R.getTodayInZone(instant, device));
  assert.match(R.getTodayInZone(new Date('nonsense'), 'UTC'), /^\d{4}-\d{2}-\d{2}$/);
  assert.match(R.getTodayInZone(undefined, 'UTC'), /^\d{4}-\d{2}-\d{2}$/);
});

test('the answer does not depend on the machine time zone', () => {
  // Runs the same call in child processes with different TZ values.
  const { execFileSync } = require('node:child_process');
  const code = `console.log(require(${JSON.stringify(path.join(ROOT, 'assets/js/reminders.js'))}).getTodayInZone(new Date('2026-11-15T20:00:00Z'), 'Asia/Kolkata'))`;
  for (const tz of ['UTC', 'Asia/Kolkata', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
    const out = execFileSync(process.execPath, ['-e', code], { env: Object.assign({}, process.env, { TZ: tz }) }).toString().trim();
    assert.strictEqual(out, '2026-11-16', 'TZ=' + tz);
  }
});

// ---------- lastChecked in the facility data contract ----------

function facility(extra) {
  return Object.assign({ id: 'f1', name: 'Test Clinic', type: 'clinic', district: 'Kolkata' }, extra);
}

test('facility lastChecked is compared with today in the data zone (Asia/Kolkata), not the UTC date', () => {
  // 02:00 on 2026-11-16 in Kolkata is still 2026-11-15 in UTC. A record checked "today" in Kolkata
  // is not from the future, but the UTC rule rejected it.
  const now = Date.parse('2026-11-15T20:30:00Z');
  assert.strictEqual(Schema.validateFacility(facility({ lastChecked: '2026-11-16' }), now).valid, true);
  assert.strictEqual(Schema.validateFacility(facility({ lastChecked: '2026-11-17' }), now).valid, false);
  const tomorrow = Schema.validateFacility(facility({ lastChecked: '2026-11-17' }), now);
  assert.ok(tomorrow.errors.includes('lastChecked is in the future'));
  assert.strictEqual(Schema.DATA_TIME_ZONE, 'Asia/Kolkata');
});

test('facility lastChecked rule, for each zone, around local midnight', () => {
  for (const [zone, instant, expected] of MIDNIGHTS) {
    const now = Date.parse(instant);
    const next = new Date(Date.parse(expected + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
    assert.strictEqual(Schema.validateFacility(facility({ lastChecked: expected }), now, zone).valid, true, `${zone} ${instant}: today is allowed`);
    assert.strictEqual(Schema.validateFacility(facility({ lastChecked: next }), now, zone).valid, false, `${zone} ${instant}: tomorrow is not`);
  }
});

test('the schema and reminders.js agree on today for every zone and instant above', () => {
  for (const [zone, instant] of MIDNIGHTS) {
    const today = R.getTodayInZone(new Date(instant), zone);
    const record = facility({ lastChecked: today });
    assert.strictEqual(Schema.validateFacility(record, Date.parse(instant), zone).valid, true, zone + ' ' + instant);
  }
});

test('the schema check does not move with the visitor\'s machine either', () => {
  const { execFileSync } = require('node:child_process');
  const schemaPath = JSON.stringify(path.join(ROOT, 'assets/js/facility-schema.js'));
  const code = `const S=require(${schemaPath});const f={id:'f',name:'N',type:'clinic',district:'Kolkata',lastChecked:'2026-11-16'};console.log(S.validateFacility(f, Date.parse('2026-11-15T20:30:00Z')).valid)`;
  for (const tz of ['UTC', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
    const out = execFileSync(process.execPath, ['-e', code], { env: Object.assign({}, process.env, { TZ: tz }) }).toString().trim();
    assert.strictEqual(out, 'true', 'TZ=' + tz);
  }
});

test('validateDataset passes the zone through, and an unknown zone falls back to the data zone', () => {
  const now = Date.parse('2026-11-15T20:30:00Z');
  const data = { schemaVersion: 1, facilities: [facility({ lastChecked: '2026-11-16' })] };
  assert.strictEqual(Schema.validateDataset(data, now).accepted.length, 1);
  assert.strictEqual(Schema.validateDataset(data, now, 'America/Los_Angeles').quarantined.length, 1, 'still 2026-11-15 in Los Angeles');
  assert.strictEqual(Schema.validateDataset(data, now, 'Not/AZone').accepted.length, 1);
});

test('a record from a different day in an invalid date is still rejected, not rolled forward', () => {
  const now = Date.parse('2026-11-15T20:30:00Z');
  assert.strictEqual(Schema.validateFacility(facility({ lastChecked: '2026-02-30' }), now).valid, false);
  assert.strictEqual(Schema.validateFacility(facility({ lastChecked: '2026-13-01' }), now).valid, false);
});

// ---------- wiring ----------

test('the dashboard timeline no longer stamps the UTC date, and stays on the same helper as reminders.js', () => {
  const js = read('assets', 'js', 'dashboard.js');
  assert.doesNotMatch(js, /toISOString\(\)\.slice\(0, 10\)/);
  assert.match(js, /date: R\.getTodayInZone\(new Date\(\), timeZone\)/);
  assert.doesNotMatch(read('assets', 'js', 'facility-schema.js'), /toISOString\(\)\.slice\(0, 10\);\s*\n\s*if \(typeof record\.lastChecked/);
});

test('facility-schema.js still loads on its own (it is saved offline without reminders.js)', () => {
  const src = read('assets', 'js', 'facility-schema.js');
  assert.doesNotMatch(src, /require\(|ReliefReminders/);
});

test('the docs describe the rule', () => {
  assert.match(read('docs', 'REMINDER_SCHEDULING.md'), /Dates shown as "today"/);
  assert.match(read('docs', 'FACILITY_DATA_CONTRACT.md'), /Asia\/Kolkata/);
});
