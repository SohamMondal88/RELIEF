/**
 * Tests for the combined facility filters (Issue #48): services, accessibility, open now,
 * the active filter list and the suggestions shown when nothing matches.
 *
 * node --test tests/facility-filters.test.js
 */
const test = require('node:test');
const assert = require('node:assert');
const U = require('../assets/js/facility-utils.js');
const Schema = require('../assets/js/facility-schema.js');

// 10:00 on the Indian clock is 04:30 UTC, 20:00 is 14:30 UTC, 02:00 is 20:30 UTC the day before.
const AT_10 = Date.UTC(2026, 9, 27, 4, 30);
const AT_20 = Date.UTC(2026, 9, 27, 14, 30);
const AT_02 = Date.UTC(2026, 9, 26, 20, 30);

function rec(over) {
  return Object.assign({ id: 'x', name: 'Sample', type: 'hospital', district: 'Kolkata', services: [], reviewState: 'pending' }, over);
}

// A record the page would treat as verified on AT_10: source, verifier and a recent date.
function verified(over) {
  return U.normalizeFacility(Object.assign({
    id: 'v1', name: 'Verified Sample Clinic', type: 'clinic', district: 'Kolkata',
    reviewState: 'verified', source: 'https://example.org/list', verifiedBy: 'reviewer', lastChecked: '2026-10-01'
  }, over));
}

const noHours = U.normalizeFacility(rec({ id: 'n1', name: 'No Hours Hospital', services: ['Surgery'] }));

test('parseHours understands only "Open 24 hours" and one daily range', () => {
  assert.deepStrictEqual(U.parseHours('Open 24 hours'), { always: true });
  assert.deepStrictEqual(U.parseHours(' open 24 hrs '), { always: true });
  assert.deepStrictEqual(U.parseHours('09:00-17:00'), { open: 540, close: 1020 });
  assert.deepStrictEqual(U.parseHours('Daily 9:30 to 18:00'), { open: 570, close: 1080 });
  assert.deepStrictEqual(U.parseHours('20:00-06:00'), { open: 1200, close: 360 });
});

test('parseHours returns null for anything it cannot read, never a guess', () => {
  ['', null, undefined, 42, 'Mon-Fri 9-5', '9 AM - 5 PM', '09:00-17:00, 18:00-20:00', '25:00-26:00', '09:00-09:00',
    '09:60-10:00', 'Closed', 'Call to confirm', 'Mon-Sat 09:00-17:00'].forEach((text) => {
    assert.strictEqual(U.parseHours(text), null, String(text));
  });
});

test('open now is read on the Indian clock, whatever the device time zone is', () => {
  const f = verified({ hours: '09:00-17:00' });
  assert.strictEqual(U.openNowStatus(f, { now: AT_10 }), 'open');
  assert.strictEqual(U.openNowStatus(f, { now: AT_20 }), 'closed');
  assert.strictEqual(U.openNowStatus(f, { now: new Date(AT_10) }), 'open');
});

test('a range that crosses midnight and a 24 hour record', () => {
  const night = verified({ hours: '20:00-06:00' });
  assert.strictEqual(U.openNowStatus(night, { now: AT_20 }), 'open');
  assert.strictEqual(U.openNowStatus(night, { now: AT_02 }), 'open');
  assert.strictEqual(U.openNowStatus(night, { now: AT_10 }), 'closed');
  assert.strictEqual(U.openNowStatus(verified({ hours: 'Open 24 hours' }), { now: AT_10 }), 'open');
});

test('unknown hours are neither open nor closed', () => {
  // no hours, text that is not understood, hours on a record nobody verified, a time that cannot be read
  assert.strictEqual(U.openNowStatus(verified({ hours: null }), { now: AT_10 }), 'unknown');
  assert.strictEqual(U.openNowStatus(verified({ hours: 'Mon-Fri 9-5' }), { now: AT_10 }), 'unknown');
  assert.strictEqual(U.openNowStatus(U.normalizeFacility(rec({ hours: '09:00-17:00' })), { now: AT_10 }), 'unknown');
  assert.strictEqual(U.openNowStatus(verified({ hours: '09:00-17:00' }), { now: NaN }), 'unknown');
  assert.strictEqual(U.openNowStatus(null, { now: AT_10 }), 'unknown');
});

test('hours on a record whose check is too old are not trusted either', () => {
  const stale = verified({ hours: '09:00-17:00', lastChecked: '2025-01-01' });
  assert.strictEqual(U.openNowStatus(stale, { now: AT_10 }), 'unknown');
});

test('hasOpenNowData is false until some record has usable verified hours', () => {
  assert.strictEqual(U.hasOpenNowData([noHours, verified({ hours: null })], { now: AT_10 }), false);
  assert.strictEqual(U.hasOpenNowData([noHours, verified({ hours: '09:00-17:00' })], { now: AT_10 }), true);
});

const LIST = [
  verified({ id: 'a', name: 'A Clinic', district: 'Kolkata', services: ['Surgery', 'Emergency Care'], accessibility: ['Wheelchair access'], hours: 'Open 24 hours' }),
  verified({ id: 'b', name: 'B Clinic', district: 'Kolkata', services: ['Surgery'], accessibility: ['Wheelchair access', 'Accessible toilet'], hours: '09:00-17:00' }),
  verified({ id: 'c', name: 'C Clinic', district: 'Howrah', services: ['Surgery'], accessibility: ['Wheelchair access'], hours: '09:00-17:00' }),
  noHours,
  U.normalizeFacility(rec({ id: 'e', name: 'E Hospital', district: 'Kolkata', services: ['Surgery'], accessibility: 'not a list' }))
];

const ids = (list) => list.map((f) => f.id);

test('filters combine: every active filter has to match', () => {
  const base = { now: AT_10 };
  assert.deepStrictEqual(ids(U.filterFacilities(LIST, Object.assign({ service: 'Surgery' }, base))), ['a', 'b', 'c', 'n1', 'e']);
  assert.deepStrictEqual(ids(U.filterFacilities(LIST, Object.assign({ service: 'Surgery', accessibility: 'Wheelchair access' }, base))), ['a', 'b', 'c']);
  assert.deepStrictEqual(ids(U.filterFacilities(LIST, Object.assign({ service: 'Surgery', accessibility: 'Wheelchair access', district: 'Kolkata' }, base))), ['a', 'b']);
  assert.deepStrictEqual(ids(U.filterFacilities(LIST, Object.assign({ accessibility: 'Wheelchair access', district: 'Kolkata', openNow: true }, base))), ['a', 'b']);
  assert.deepStrictEqual(ids(U.filterFacilities(LIST, { accessibility: 'Wheelchair access', district: 'Kolkata', openNow: true, now: AT_20 })), ['a']);
  assert.deepStrictEqual(ids(U.filterFacilities(LIST, Object.assign({ service: 'Emergency Care', accessibility: 'Accessible toilet' }, base))), []);
  assert.deepStrictEqual(ids(U.filterFacilities(LIST, Object.assign({ search: 'clinic', service: 'Surgery', verifiedOnly: true, openNow: true }, base))), ['a', 'b', 'c']);
});

test('open now never lists a record with unknown hours, and never calls it closed either', () => {
  const open = U.filterFacilities(LIST, { openNow: true, now: AT_10 });
  assert.ok(!ids(open).includes('n1') && !ids(open).includes('e'));
  const unknown = LIST.filter((f) => U.openNowStatus(f, { now: AT_10 }) === 'unknown');
  assert.deepStrictEqual(ids(unknown), ['n1', 'e']);
  const closedAtNight = LIST.filter((f) => U.openNowStatus(f, { now: AT_20 }) === 'closed');
  assert.deepStrictEqual(ids(closedAtNight), ['b', 'c']);
});

test('missing metadata: records without services, accessibility or hours do not break any filter', () => {
  const bare = U.normalizeFacility({ id: 'z', name: 'Bare Record' });
  assert.deepStrictEqual(bare.accessibility, []);
  assert.deepStrictEqual(bare.services, []);
  assert.doesNotThrow(() => U.filterFacilities([bare], { service: 'Surgery', accessibility: 'X', openNow: true, now: AT_10 }));
  assert.deepStrictEqual(U.filterFacilities([bare], { service: 'Surgery' }), []);
  // a bad accessibility value (not a list, blank entries) is read as "no data", not as a feature
  assert.deepStrictEqual(LIST[4].accessibility, []);
  assert.deepStrictEqual(U.normalizeFacility({ id: 'y', name: 'Y', accessibility: ['Ramp', '', '  ', 7, null] }).accessibility, ['Ramp']);
});

test('the accessibility options only exist when some record has the data', () => {
  assert.deepStrictEqual(U.getFilterOptions([noHours, bareOnly()]).accessibility, []);
  assert.deepStrictEqual(U.getFilterOptions(LIST).accessibility, ['Accessible toilet', 'Wheelchair access']);
  function bareOnly() { return U.normalizeFacility({ id: 'z', name: 'Bare' }); }
});

test('describeActiveFilters lists only what is switched on, in control order', () => {
  assert.deepStrictEqual(U.describeActiveFilters({}), []);
  assert.deepStrictEqual(U.describeActiveFilters({ search: '   ', type: '', verifiedOnly: false, openNow: false }), []);
  const active = U.describeActiveFilters({ search: ' bank ', type: 'hospital', district: 'Howrah', service: 'Surgery', accessibility: 'Ramp', verifiedOnly: true, openNow: true });
  assert.deepStrictEqual(active.map((f) => f.key), ['search', 'type', 'district', 'service', 'accessibility', 'verifiedOnly', 'openNow']);
  assert.deepStrictEqual(active.map((f) => f.label), ['Search: "bank"', 'Type: Hospital', 'Area: Howrah', 'Service: Surgery', 'Accessibility: Ramp', 'Verified only', 'Open now']);
});

test('describeActiveFilters and suggestRemovals use the translator when one is passed', () => {
  const seen = [];
  const tr = (key, fallback, vars) => { seen.push(key); return '[' + key + ']' + JSON.stringify(vars || {}); };
  const active = U.describeActiveFilters({ search: 'x', type: 'hospital', district: 'Howrah', service: 'Surgery', accessibility: 'Ramp', verifiedOnly: true, openNow: true }, null, tr);
  assert.deepStrictEqual(seen, ['hospitals.chip.search', 'hospitals.chip.type', 'hospitals.chip.area', 'hospitals.chip.service', 'hospitals.chip.accessibility', 'hospitals.verified', 'hospitals.opennow']);
  assert.strictEqual(active[2].label, '[hospitals.chip.area]{"value":"Howrah"}');
  // the translated label is carried into the suggestions
  const out = U.suggestRemovals(LIST, { service: 'Nothing like this' }, null, tr);
  assert.strictEqual(out[0].label, '[hospitals.chip.service]{"value":"Nothing like this"}');
  assert.strictEqual(out[0].key, 'service');
});

test('formatMessage fills placeholders and leaves unknown ones alone', () => {
  assert.strictEqual(U.formatMessage('Remove {label} ({count} facility)', { label: 'Area: Howrah', count: 1 }), 'Remove Area: Howrah (1 facility)');
  assert.strictEqual(U.formatMessage('{count} left, {other}', { count: 0 }), '0 left, {other}');
  assert.strictEqual(U.formatMessage('plain'), 'plain');
});

test('suggestRemovals names the filters whose removal brings results back, best first', () => {
  const criteria = { service: 'Emergency Care', accessibility: 'Accessible toilet', district: 'Kolkata', now: AT_10 };
  assert.deepStrictEqual(ids(U.filterFacilities(LIST, criteria)), []);
  const out = U.suggestRemovals(LIST, criteria);
  assert.deepStrictEqual(out.map((s) => [s.key, s.count]), [['service', 1], ['accessibility', 1]]);
  // removing the area still leaves nothing (no Emergency Care + Accessible toilet record), so it is not suggested
  assert.ok(!out.some((s) => s.key === 'district'));
  assert.deepStrictEqual(U.suggestRemovals(LIST, { service: 'Nothing like this' }), [{ key: 'service', label: 'Service: Nothing like this', count: 5 }]);
  // equal gains keep the order of the controls on the page (area comes before service)
  const tie = U.suggestRemovals(LIST, { service: 'Emergency Care', district: 'Howrah' });
  assert.deepStrictEqual(tie.map((s) => [s.key, s.count]), [['district', 1], ['service', 1]]);
  // a bigger gain comes first
  const big = U.suggestRemovals(LIST, { type: 'hospital', district: 'Kolkata', service: 'Emergency Care' });
  assert.deepStrictEqual(big.map((s) => [s.key, s.count]), [['service', 2], ['type', 1]]);
  assert.deepStrictEqual(U.suggestRemovals(LIST, {}), []);
});

test('withoutFilter clears one key and leaves the input alone', () => {
  const c = { service: 'Surgery', openNow: true, district: 'Kolkata' };
  assert.deepStrictEqual(U.withoutFilter(c, 'openNow'), { service: 'Surgery', openNow: false, district: 'Kolkata' });
  assert.deepStrictEqual(U.withoutFilter(c, 'service'), { service: '', openNow: true, district: 'Kolkata' });
  assert.strictEqual(c.openNow, true);
});

test('the data contract accepts an accessibility list and rejects a bad one', () => {
  const base = { id: 'f1', name: 'Sample', type: 'hospital', district: 'Kolkata' };
  assert.strictEqual(Schema.validateFacility(Object.assign({}, base, { accessibility: ['Wheelchair access'] })).valid, true);
  assert.strictEqual(Schema.validateFacility(Object.assign({}, base, { accessibility: null })).valid, true);
  assert.strictEqual(Schema.validateFacility(base).valid, true);
  assert.strictEqual(Schema.validateFacility(Object.assign({}, base, { accessibility: 'ramp' })).valid, false);
  assert.strictEqual(Schema.validateFacility(Object.assign({}, base, { accessibility: ['<b>x</b>'] })).valid, false);
  assert.strictEqual(Schema.validateFacility(Object.assign({}, base, { accessibility: [''] })).valid, false);
});
