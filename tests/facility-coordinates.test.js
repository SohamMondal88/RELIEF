/**
 * Issue #177: a missing or broken latitude/longitude must never put a facility on the map at a
 * made-up place, and must never take the facility out of the list.
 *
 * node --test tests/facility-coordinates.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const Schema = require('../assets/js/facility-schema.js');
const U = require('../assets/js/facility-utils.js');
const RL = require('../assets/js/location-service.js');

const NOW = Date.UTC(2026, 9, 27);
const base = (extra) => Object.assign({ id: 'c-1', name: 'Coordinate Test Hospital', type: 'hospital', district: 'Testpur' }, extra);

// Each row: [label, lat, lng]. None of these may end up as a pin.
const UNUSABLE = [
  ['empty string', '', ''],
  ['spaces only', '   ', '   '],
  ['non-numeric text', 'north', 'east'],
  ['NaN', NaN, NaN],
  ['Infinity', Infinity, Infinity],
  ['-Infinity', -Infinity, 88.3],
  ['the text "Infinity"', 'Infinity', '88.3'],
  ['boolean', true, false],
  ['list', [22.5], [88.3]],
  ['object', { v: 22.5 }, { v: 88.3 }],
  ['latitude too high', 90.0001, 88.3],
  ['latitude too low', -90.0001, 88.3],
  ['longitude too high', 22.5, 180.0001],
  ['longitude too low', 22.5, -180.0001],
  ['out of range as text', '95', '88.3'],
  ['only one half is null', 22.5, null],
  ['only one half is missing', undefined, 88.3],
  ['one half is an empty string', 22.5, ''],
  ['0,0 is open sea, not a place', 0, 0],
  ['0,0 as text', '0', '0.0']
];

UNUSABLE.forEach(([label, lat, lng]) => {
  test('[unusable] ' + label + ': record stays, the pin goes', () => {
    const record = base({ lat, lng });
    const check = Schema.validateFacility(record, NOW);
    assert.strictEqual(check.valid, true, 'must not be quarantined: ' + check.errors.join('; '));
    assert.ok(check.warnings.some((w) => /no map location/.test(w)), 'expected a warning, got ' + JSON.stringify(check.warnings));

    const dataset = Schema.validateDataset([record], NOW);
    assert.strictEqual(dataset.quarantined.length, 0);
    assert.strictEqual(dataset.accepted.length, 1);
    assert.strictEqual(dataset.accepted[0].lat, null);
    assert.strictEqual(dataset.accepted[0].lng, null);

    const facility = U.normalizeFacility(record);
    assert.strictEqual(facility.lat, null);
    assert.strictEqual(facility.lng, null);
    assert.strictEqual(U.isValidCoord(facility.lat, facility.lng), false);
    // The same raw record without going through the schema first gives the same answer.
    assert.strictEqual(U.normalizeFacility(dataset.accepted[0]).lat, null);
  });
});

test('[unusable] the caller\'s record is not changed', () => {
  const record = base({ lat: '', lng: '' });
  Schema.validateDataset([record], NOW);
  assert.strictEqual(record.lat, '');
  assert.strictEqual(record.lng, '');
});

test('[unusable] two broken values give two reasons, the right one for each axis', () => {
  const found = Schema.readCoordinates({ lat: 95, lng: 'east' });
  assert.deepStrictEqual(found.problems, ['lat must be a number between -90 and 90', 'lng must be a number between -180 and 180']);
});

test('[unusable] one bad record does not hide its neighbours', () => {
  const list = [base({ id: 'a', lat: 22.5, lng: 88.3 }), base({ id: 'b', lat: '', lng: null }), base({ id: 'c', lat: 22.6, lng: 88.4 })];
  const result = Schema.validateDataset(list, NOW);
  assert.deepStrictEqual(result.accepted.map((f) => f.id), ['a', 'b', 'c']);
  assert.deepStrictEqual(result.warnings.map((w) => w.id), ['b']);
  const facilities = U.normalizeFacilities(result.accepted);
  assert.deepStrictEqual(facilities.map((f) => U.isValidCoord(f.lat, f.lng)), [true, false, true]);
});

test('[unusable] a facility without a location sorts last by distance and keeps its place in name order', () => {
  const list = U.normalizeFacilities(Schema.validateDataset([
    base({ id: 'far', name: 'Far', lat: 26.7, lng: 88.4 }),
    base({ id: 'none', name: 'Aaa No Pin', lat: '', lng: '' }),
    base({ id: 'near', name: 'Near', lat: 22.6, lng: 88.4 })
  ], NOW).accepted);
  const byDistance = U.sortFacilities(list, 'distance', { lat: 22.57, lng: 88.36 });
  assert.deepStrictEqual(byDistance.map((f) => f.id), ['near', 'far', 'none']);
  assert.strictEqual(byDistance[2].distanceKm, null);
  assert.deepStrictEqual(U.sortFacilities(list, 'name', { lat: 22.57, lng: 88.36 }).map((f) => f.id), ['none', 'far', 'near']);
});

// ---------------------------------------------------------------------------
// Values that are kept
// ---------------------------------------------------------------------------

test('[usable] numbers and numeric strings give the same result', () => {
  [[22.5726, 88.3639], ['22.5726', '88.3639'], [' 22.5726 ', '\t88.3639\n'], ['2.25726e1', '8.83639e1']].forEach(([lat, lng]) => {
    const found = Schema.readCoordinates({ lat, lng });
    assert.deepStrictEqual(found, { lat: 22.5726, lng: 88.3639, problems: [] });
    const facility = U.normalizeFacility(base({ lat, lng }));
    assert.deepStrictEqual([facility.lat, facility.lng], [22.5726, 88.3639]);
  });
});

test('[usable] numeric strings reach the list as numbers, so distance and pins work', () => {
  const accepted = Schema.validateDataset([base({ lat: '22.57', lng: '88.36' })], NOW).accepted[0];
  assert.strictEqual(typeof accepted.lat, 'number');
  assert.strictEqual(typeof accepted.lng, 'number');
  const [facility] = U.normalizeFacilities([accepted]);
  const [sorted] = U.sortFacilities([facility], 'distance', { lat: 22.57, lng: 88.36 });
  assert.strictEqual(sorted.distanceKm, 0);
});

test('[usable] exact limits are kept and a point outside West Bengal still warns about the region only', () => {
  assert.deepStrictEqual(Schema.readCoordinates({ lat: 90, lng: 180 }).problems, []);
  assert.deepStrictEqual(Schema.readCoordinates({ lat: -90, lng: -180 }).problems, []);
  const far = Schema.validateFacility(base({ lat: 28.61, lng: 77.2 }), NOW);
  assert.deepStrictEqual(far.warnings, ['coordinates are outside West Bengal']);
  assert.deepStrictEqual(Schema.readCoordinates({ lat: 28.61, lng: 77.2 }), { lat: 28.61, lng: 77.2, problems: [] });
});

test('[usable] a record that never had coordinates gets no warning and the same object back', () => {
  const record = base({});
  assert.deepStrictEqual(Schema.validateFacility(record, NOW), { valid: true, errors: [], warnings: [] });
  assert.strictEqual(Schema.validateDataset([record], NOW).accepted[0], record);
  const nulls = base({ lat: null, lng: null });
  assert.deepStrictEqual(Schema.validateFacility(nulls, NOW).warnings, []);
});

test('[usable] a coordinate of 0 on one axis only is a real place (the equator or the prime meridian)', () => {
  assert.deepStrictEqual(Schema.readCoordinates({ lat: 0, lng: 88.3 }).problems, []);
  assert.deepStrictEqual(Schema.readCoordinates({ lat: 22.5, lng: 0 }).problems, []);
  assert.ok(U.facilityCoords(0, 88.3));
});

// ---------------------------------------------------------------------------
// One rule everywhere
// ---------------------------------------------------------------------------

test('[consistency] the schema, the list helper and the location service agree on every value', () => {
  const values = [22.5, '22.5', ' 22.5 ', '', '  ', null, undefined, NaN, Infinity, -Infinity, 'abc', true, false, [], [1], {}, 91, -91, '91'];
  values.forEach((lat) => {
    values.forEach((lng) => {
      const viaSchema = Schema.readCoordinates({ lat, lng });
      const viaUtils = U.facilityCoords(lat, lng);
      const viaService = RL.normalizeCoords(lat, lng);
      const bothSet = lat !== undefined && lat !== null && lng !== undefined && lng !== null;
      const expected = bothSet ? viaService : null;
      const label = JSON.stringify([lat, lng]);
      assert.deepStrictEqual(viaUtils, expected, 'utils ' + label);
      assert.deepStrictEqual(viaSchema.lat === null ? null : { lat: viaSchema.lat, lng: viaSchema.lng }, expected, 'schema ' + label);
    });
  });
});
