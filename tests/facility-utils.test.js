/**
 * Tests for the facility directory helpers (Issue #13).
 * Run with: node --test tests/facility-utils.test.js
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const U = require('../assets/js/facility-utils.js');

const sample = U.normalizeFacilities([
  { id: 'a', name: 'Alpha Hospital', type: 'hospital', district: 'Bankura', services: ['Emergency Care', 'Surgery'], lat: 23.23, lng: 87.07, reviewState: 'verified', verifiedBy: 'maintainer-a', source: 'WB Health Dept', lastChecked: '2026-10-01' },
  { id: 'b', name: 'Beta PHC', type: 'phc', district: 'Purulia', services: ['Maternity'], lat: 23.33, lng: 86.36 },
  { id: 'c', name: 'Gamma Clinic', type: 'clinic', district: 'Bankura', services: [] }
]);

test('normalizeFacilities fills missing fields and drops invalid records', () => {
  const list = U.normalizeFacilities({ facilities: [{ name: 'X' }, null, { id: 1 }] });
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].verified, false);
  assert.strictEqual(list[0].address, null);
  assert.deepStrictEqual(list[0].services, []);
  assert.deepStrictEqual(U.normalizeFacilities(undefined), []);
});

test('escapeHtml neutralises markup', () => {
  assert.strictEqual(U.escapeHtml('<img src=x onerror="a()">&\''), '&lt;img src=x onerror=&quot;a()&quot;&gt;&amp;&#39;');
  assert.strictEqual(U.escapeHtml(null), '');
});

test('haversineKm gives known distances', () => {
  assert.strictEqual(U.haversineKm(10, 10, 10, 10), 0);
  const d = U.haversineKm(22.5726, 88.3639, 28.6139, 77.209); // Kolkata - Delhi
  assert.ok(d > 1280 && d < 1320, 'got ' + d);
});

test('parseUserLocation accepts object, array and JSON string; rejects bad input', () => {
  assert.deepStrictEqual(U.parseUserLocation({ lat: 22.5, lng: 88.3 }), { lat: 22.5, lng: 88.3 });
  assert.deepStrictEqual(U.parseUserLocation([22.5, 88.3]), { lat: 22.5, lng: 88.3 });
  assert.deepStrictEqual(U.parseUserLocation('{"lat":22.5,"lng":88.3}'), { lat: 22.5, lng: 88.3 });
  assert.strictEqual(U.parseUserLocation('not json'), null);
  assert.strictEqual(U.parseUserLocation(null), null);
  assert.strictEqual(U.parseUserLocation({ lat: 200, lng: 0 }), null);
  assert.strictEqual(U.parseUserLocation({ lat: 'x', lng: 1 }), null);
});

test('search covers name, district and services', () => {
  assert.deepStrictEqual(U.filterFacilities(sample, { search: 'alpha' }).map(f => f.id), ['a']);
  assert.deepStrictEqual(U.filterFacilities(sample, { search: 'purulia' }).map(f => f.id), ['b']);
  assert.deepStrictEqual(U.filterFacilities(sample, { search: 'maternity' }).map(f => f.id), ['b']);
  assert.deepStrictEqual(U.filterFacilities(sample, { search: 'bankura surgery' }).map(f => f.id), ['a']);
  assert.strictEqual(U.filterFacilities(sample, { search: '   ' }).length, 3);
  assert.strictEqual(U.filterFacilities(sample, { search: 'zzz' }).length, 0);
});

const NOW = Date.parse('2026-10-27T10:00:00Z');

test('type, district, service and verified filters combine', () => {
  assert.deepStrictEqual(U.filterFacilities(sample, { type: 'phc' }).map(f => f.id), ['b']);
  assert.deepStrictEqual(U.filterFacilities(sample, { district: 'Bankura' }).map(f => f.id), ['a', 'c']);
  assert.deepStrictEqual(U.filterFacilities(sample, { service: 'Surgery' }).map(f => f.id), ['a']);
  assert.deepStrictEqual(U.filterFacilities(sample, { verifiedOnly: true, now: NOW }).map(f => f.id), ['a']);
  assert.strictEqual(U.filterFacilities(sample, { district: 'Bankura', type: 'phc' }).length, 0);
});

test('filter options come from the data', () => {
  const o = U.getFilterOptions(sample);
  assert.deepStrictEqual(o.types, ['clinic', 'hospital', 'phc']);
  assert.deepStrictEqual(o.districts, ['Bankura', 'Purulia']);
  assert.deepStrictEqual(o.services, ['Emergency Care', 'Maternity', 'Surgery']);
});

test('sort by distance uses the user location and puts unlocated records last', () => {
  const nearPurulia = { lat: 23.3, lng: 86.4 };
  const sorted = U.sortFacilities(sample, 'distance', nearPurulia);
  assert.deepStrictEqual(sorted.map(f => f.id), ['b', 'a', 'c']);
  assert.ok(sorted[0].distanceKm < sorted[1].distanceKm);
  assert.strictEqual(sorted[2].distanceKm, null);
});

test('sort by distance without a location falls back to name; name sort works', () => {
  assert.deepStrictEqual(U.sortFacilities(sample, 'distance', null).map(f => f.id), ['a', 'b', 'c']);
  assert.deepStrictEqual(U.sortFacilities(sample, 'name', { lat: 1, lng: 1 }).map(f => f.id), ['a', 'b', 'c']);
});

test('verification label shows source and date only for verified records', () => {
  assert.strictEqual(U.verificationLabel(sample[0], { now: NOW }), 'Verified - source: WB Health Dept - checked 2026-10-01');
  assert.strictEqual(U.verificationLabel(sample[1], { now: NOW }), 'Not verified');
});

test('shipped facilities.json is well formed and not claimed as verified without a source', () => {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '../assets/data/facilities.json'), 'utf8'));
  const list = U.normalizeFacilities(raw);
  assert.ok(list.length > 0);
  assert.strictEqual(list.length, raw.facilities.length);
  const ids = new Set(list.map(f => f.id));
  assert.strictEqual(ids.size, list.length);
  list.forEach(f => {
    assert.ok(U.FACILITY_TYPES[f.type], 'unknown type ' + f.type);
    assert.ok(U.isValidCoord(f.lat, f.lng), 'bad coords for ' + f.id);
    if (f.verified) assert.ok(f.source && f.lastChecked && f.verifiedBy, 'verified record needs source, date and verifier: ' + f.id);
  });
});

// ---- Review states and staleness (Issue #55) ----

const rec = (over) => U.normalizeFacility(Object.assign({
  id: 'x', name: 'X Hospital', type: 'hospital', reviewState: 'verified',
  verifiedBy: 'maintainer-a', source: 'District health office list', lastChecked: '2026-10-01'
}, over));
const at = (iso) => Date.parse(iso + 'T10:00:00Z');

test('old records with only the boolean still load: verified:true is read as verified, absent as pending', () => {
  assert.strictEqual(U.normalizeFacility({ name: 'A', verified: true }).reviewState, 'verified');
  assert.strictEqual(U.normalizeFacility({ name: 'A' }).reviewState, 'pending');
  assert.strictEqual(U.normalizeFacility({ name: 'A', verified: true, reviewState: 'rejected' }).reviewState, 'rejected');
  assert.strictEqual(U.normalizeFacility({ name: 'A', reviewState: 'bogus' }).reviewState, 'pending');
});

test('a verified record inside the window is verified', () => {
  const st = U.reviewStatus(rec({}), { now: at('2026-10-27') });
  assert.strictEqual(st.state, 'verified');
  assert.strictEqual(st.ageDays, 26);
  assert.strictEqual(st.maxAgeDays, 180);
});

test('stale cutoff: exactly 180 days old is still verified, 181 is stale', () => {
  const f = rec({ lastChecked: '2026-01-01' });
  assert.strictEqual(U.reviewStatus(f, { now: at('2026-06-30') }).ageDays, 180);
  assert.strictEqual(U.reviewStatus(f, { now: at('2026-06-30') }).state, 'verified');
  assert.strictEqual(U.reviewStatus(f, { now: at('2026-07-01') }).ageDays, 181);
  assert.strictEqual(U.reviewStatus(f, { now: at('2026-07-01') }).state, 'stale');
  assert.strictEqual(U.reviewStatus(f, { now: at('2026-07-01') }).reason, 'too-old');
});

test('the window is configurable: per call, in the data, and per facility type', () => {
  const f = rec({ lastChecked: '2026-10-01' });
  assert.strictEqual(U.reviewStatus(f, { now: at('2026-10-27'), maxAgeDays: 10 }).state, 'stale');
  const policy = U.getReviewPolicy({ reviewPolicy: { maxAgeDays: 20, byType: { hospital: 40, pharmacy: 7 } } });
  assert.strictEqual(U.reviewStatus(f, { now: at('2026-10-27'), policy }).state, 'verified');
  assert.strictEqual(U.reviewStatus(rec({ type: 'clinic' }), { now: at('2026-10-27'), policy }).state, 'stale');
  assert.strictEqual(U.reviewStatus(rec({ type: 'pharmacy' }), { now: at('2026-10-10'), policy }).state, 'stale');
});

test('getReviewPolicy falls back to 180 days for anything that is not a positive whole number', () => {
  assert.strictEqual(U.getReviewPolicy(null).maxAgeDays, 180);
  assert.strictEqual(U.getReviewPolicy({}).maxAgeDays, 180);
  [0, -5, 1.5, '90', NaN, null].forEach((bad) => {
    const p = U.getReviewPolicy({ reviewPolicy: { maxAgeDays: bad, byType: { hospital: bad } } });
    assert.strictEqual(p.maxAgeDays, 180, String(bad));
    assert.deepStrictEqual(p.byType, {}, String(bad));
  });
});

test('a record marked verified without evidence is shown as pending, never as verified', () => {
  const now = at('2026-10-27');
  const cases = {
    'no-source': { source: null },
    'no-verifier': { verifiedBy: null },
    'no-date': { lastChecked: null },
    'future-date': { lastChecked: '2027-01-01' }
  };
  Object.keys(cases).forEach((reason) => {
    const st = U.reviewStatus(rec(cases[reason]), { now });
    assert.strictEqual(st.state, 'pending', reason);
    assert.strictEqual(st.reason, reason);
    assert.strictEqual(U.reviewLabel(rec(cases[reason]), { now }).badge, 'Not verified', reason);
  });
  assert.strictEqual(U.reviewStatus(rec({ lastChecked: '2026-02-31' }), { now }).state, 'pending');
  assert.strictEqual(U.reviewStatus(rec({ lastChecked: 'last week' }), { now }).state, 'pending');
});

test('stored stale, rejected and pending keep their state whatever the date', () => {
  const now = at('2026-10-27');
  assert.strictEqual(U.reviewStatus(rec({ reviewState: 'stale' }), { now }).state, 'stale');
  assert.strictEqual(U.reviewStatus(rec({ reviewState: 'rejected' }), { now }).state, 'rejected');
  assert.strictEqual(U.reviewStatus(rec({ reviewState: 'pending' }), { now }).state, 'pending');
});

test('public labels follow the state', () => {
  const now = at('2026-10-27');
  const ok = U.reviewLabel(rec({}), { now });
  assert.deepStrictEqual([ok.state, ok.badge], ['verified', 'Verified']);
  assert.match(ok.detail, /source: District health office list/);
  assert.match(ok.detail, /last checked 26 days ago \(2026-10-01\)/);

  const old = U.reviewLabel(rec({ lastChecked: '2025-01-01' }), { now });
  assert.deepStrictEqual([old.state, old.badge], ['stale', 'Needs re-checking']);
  assert.match(old.detail, /last checked 664 days ago/);
  assert.match(old.detail, /call ahead/);

  const flagged = U.reviewLabel(rec({ reviewState: 'stale', lastChecked: null, source: null }), { now });
  assert.strictEqual(flagged.badge, 'Needs re-checking');
  assert.match(flagged.detail, /flagged for re-checking/);

  assert.strictEqual(U.reviewLabel(rec({ reviewState: 'rejected' }), { now }).badge, 'Could not be confirmed');
  assert.strictEqual(U.reviewLabel(rec({ reviewState: 'pending', source: null, lastChecked: null }), { now }).detail, 'no source recorded yet');
  assert.strictEqual(U.reviewLabel(rec({ reviewState: 'pending' }), { now }).detail, 'waiting for review');
  assert.match(U.reviewLabel(rec({ lastChecked: '2026-10-27' }), { now }).detail, /today/);
  assert.match(U.reviewLabel(rec({ lastChecked: '2026-10-26' }), { now }).detail, /1 day ago/);
});

test('only the word "Verified" is ever used for a verified, fresh, evidenced record', () => {
  const now = at('2026-10-27');
  const everything = [
    rec({}), rec({ lastChecked: '2025-01-01' }), rec({ reviewState: 'stale' }), rec({ reviewState: 'rejected' }),
    rec({ reviewState: 'pending' }), rec({ source: null }), rec({ verifiedBy: null }), rec({ lastChecked: null })
  ];
  everything.forEach((f) => {
    const label = U.reviewLabel(f, { now });
    const says = /^Verified$/.test(label.badge);
    assert.strictEqual(says, U.reviewStatus(f, { now }).state === 'verified');
  });
});

test('"Verified only" leaves out stale, rejected, pending and unevidenced records', () => {
  const now = at('2026-10-27');
  const list = [
    rec({ id: '1' }), rec({ id: '2', lastChecked: '2025-01-01' }), rec({ id: '3', reviewState: 'rejected' }),
    rec({ id: '4', reviewState: 'pending' }), rec({ id: '5', source: null })
  ];
  assert.deepStrictEqual(U.filterFacilities(list, { verifiedOnly: true, now }).map((f) => f.id), ['1']);
  assert.strictEqual(U.filterFacilities(list, { now }).length, 5);
});

test('the shipped data has no record that claims more than its evidence', () => {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '../assets/data/facilities.json'), 'utf8'));
  const policy = U.getReviewPolicy(raw);
  assert.strictEqual(policy.maxAgeDays, 180);
  raw.facilities.forEach((f) => {
    assert.ok(U.REVIEW_STATES.includes(f.reviewState), f.id + ' has no valid reviewState');
    assert.strictEqual(f.verified, f.reviewState === 'verified', f.id);
    if (f.reviewState === 'verified') {
      assert.ok(f.source && f.verifiedBy && U.parseDay(f.lastChecked) !== null, f.id + ' is verified without evidence');
    }
  });
});
