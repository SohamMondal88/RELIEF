/**
 * Tests for the facility directory helpers (Issue #13).
 * Run with: node --test tests/facility-utils.test.js
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const U = require('../assets/js/facility-utils.js');
const fx = require('./helpers/provider-fixtures');

// Synthetic records from tests/fixtures/providers (see docs/PROVIDER_TEST_FIXTURES.md).
// hospital 001 has coordinates and services, PHC 002 is nearer to Purulia, clinic 003 has no coordinates.
// The fixtures are never verified, so the one verified record is made here on purpose, for the label test only.
const [A, B, C] = ['synthetic-hospital-001', 'synthetic-hospital-002', 'synthetic-hospital-003'];
const sample = U.normalizeFacilities(fx.hospitals.map((h) =>
  h.id === A ? Object.assign({}, h, { verified: true, source: 'https://example.org/test-list', lastChecked: '2026-10-01' }) : h
));

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
  assert.deepStrictEqual(U.filterFacilities(sample, { search: 'district hospital' }).map(f => f.id), [A]);
  assert.deepStrictEqual(U.filterFacilities(sample, { search: 'samplepur' }).map(f => f.id), [B]);
  assert.deepStrictEqual(U.filterFacilities(sample, { search: 'maternity' }).map(f => f.id), [B]);
  assert.deepStrictEqual(U.filterFacilities(sample, { search: 'exampleganj surgery' }).map(f => f.id), [A]);
  assert.strictEqual(U.filterFacilities(sample, { search: '   ' }).length, 3);
  assert.strictEqual(U.filterFacilities(sample, { search: 'zzz' }).length, 0);
});

test('type, district, service and verified filters combine', () => {
  assert.deepStrictEqual(U.filterFacilities(sample, { type: 'phc' }).map(f => f.id), [B]);
  assert.deepStrictEqual(U.filterFacilities(sample, { district: 'Exampleganj' }).map(f => f.id), [A, C]);
  assert.deepStrictEqual(U.filterFacilities(sample, { service: 'Surgery' }).map(f => f.id), [A]);
  assert.deepStrictEqual(U.filterFacilities(sample, { verifiedOnly: true }).map(f => f.id), [A]);
  assert.strictEqual(U.filterFacilities(sample, { district: 'Exampleganj', type: 'phc' }).length, 0);
});

test('filter options come from the data', () => {
  const o = U.getFilterOptions(sample);
  assert.deepStrictEqual(o.types, ['clinic', 'hospital', 'phc']);
  assert.deepStrictEqual(o.districts, ['Exampleganj', 'Samplepur']);
  assert.deepStrictEqual(o.services, ['Emergency Care', 'Maternity', 'Surgery']);
});

test('sort by distance uses the user location and puts unlocated records last', () => {
  const nearPurulia = { lat: 23.3, lng: 86.4 };
  const sorted = U.sortFacilities(sample, 'distance', nearPurulia);
  assert.deepStrictEqual(sorted.map(f => f.id), [B, A, C]);
  assert.ok(sorted[0].distanceKm < sorted[1].distanceKm);
  assert.strictEqual(sorted[2].distanceKm, null);
});

test('sort by distance without a location falls back to name; name sort works', () => {
  assert.deepStrictEqual(U.sortFacilities(sample, 'distance', null).map(f => f.id), [A, B, C]);
  assert.deepStrictEqual(U.sortFacilities(sample, 'name', { lat: 1, lng: 1 }).map(f => f.id), [A, B, C]);
});

test('verification label shows source and date only for verified records', () => {
  assert.strictEqual(U.verificationLabel(sample[0]), 'Verified - source: https://example.org/test-list - checked 2026-10-01');
  assert.strictEqual(U.verificationLabel(sample[1]), 'Not verified');
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
    if (f.verified) assert.ok(f.source && f.lastChecked, 'verified record needs source and date: ' + f.id);
  });
});
