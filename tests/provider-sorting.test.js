/**
 * Tests for safe, repeatable sorting of the provider lists (Issue #86): invalid coordinates, no location,
 * ties, empty lists, opening hours listed or not, and the guard against invented ratings and availability.
 *
 * node --test tests/provider-sorting.test.js
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const U = require('../assets/js/facility-utils.js');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const ORIGIN = { lat: 22.5726, lng: 88.3639 }; // Kolkata

function rec(id, name, lat, lng, hours) {
  return { id, name, lat, lng, hours: hours === undefined ? null : hours };
}
const ids = (list) => list.map((f) => f.id);

test('compareNames: case and accents do not matter, numbers sort as numbers, equal names fall back to id', () => {
  assert.ok(U.compareNames({ name: 'alpha', id: '1' }, { name: 'Beta', id: '2' }) < 0);
  assert.ok(U.compareNames({ name: 'Zeta', id: '1' }, { name: 'alpha', id: '2' }) > 0);
  assert.ok(U.compareNames({ name: 'Clinic 2', id: 'a' }, { name: 'Clinic 10', id: 'b' }) < 0);
  assert.ok(U.compareNames({ name: 'Same', id: 'fac-2' }, { name: 'Same', id: 'fac-10' }) < 0);
  assert.strictEqual(U.compareNames({ name: 'Same', id: 'x' }, { name: 'same', id: 'x' }), 0);
});

test('compareNames does not throw on missing names or ids', () => {
  assert.doesNotThrow(() => [{}, { name: null }, { name: undefined, id: 3 }, null, undefined, { name: 5 }].sort(U.compareNames));
});

test('invalid coordinates never get a distance and always sort after the valid ones, by name', () => {
  const list = [
    rec('nan', 'A NaN', NaN, 88.36),
    rec('inf', 'B Infinity', Infinity, 88.36),
    rec('range', 'C Out of range', 95, 88.36),
    rec('lng', 'D Bad longitude', 22.5, 181),
    rec('str', 'E String', '22.57', '88.36'),
    rec('nul', 'F Null', null, null),
    rec('undef', 'G Undefined'),
    rec('far', 'Z Far but valid', 28.61, 77.21),
    rec('near', 'Y Near and valid', 22.58, 88.37)
  ];
  const sorted = U.sortFacilities(list, 'distance', ORIGIN);
  assert.deepStrictEqual(ids(sorted), ['near', 'far', 'nan', 'inf', 'range', 'lng', 'str', 'nul', 'undef']);
  sorted.slice(2).forEach((f) => assert.strictEqual(f.distanceKm, null, f.id));
  sorted.slice(0, 2).forEach((f) => assert.ok(Number.isFinite(f.distanceKm) && f.distanceKm >= 0, f.id));
});

test('an unusable location sorts by name, whatever sort was asked for', () => {
  const list = [rec('b', 'Bravo', 22.6, 88.4), rec('a', 'Alpha', 22.9, 88.9)];
  [null, undefined, {}, { lat: NaN, lng: 88 }, { lat: 'x', lng: 'y' }, { lat: 91, lng: 0 }, 'Kolkata', 42].forEach((bad) => {
    assert.deepStrictEqual(ids(U.sortFacilities(list, 'distance', bad)), ['a', 'b'], JSON.stringify(bad));
    sortedHasNoDistance(U.sortFacilities(list, 'distance', bad));
  });
  function sortedHasNoDistance(l) { l.forEach((f) => assert.strictEqual(f.distanceKm, null)); }
});

test('describeSort says what will really happen', () => {
  assert.deepStrictEqual(U.describeSort('distance', ORIGIN).sortBy, 'distance');
  assert.match(U.describeSort('distance', ORIGIN).note, /valid position come last/);
  const none = U.describeSort('distance', null);
  assert.strictEqual(none.sortBy, 'name');
  assert.match(none.note, /needs your location/);
  assert.strictEqual(U.describeSort('distance', { lat: NaN, lng: 1 }).sortBy, 'name');
  assert.strictEqual(U.describeSort('name', ORIGIN).note, '');
  assert.strictEqual(U.describeSort('rating', ORIGIN).sortBy, 'name', 'an unknown sort is read as name');
  assert.match(U.describeSort('hours').note, /list opening hours come first/);
});

test('an empty list, or one with nothing usable, sorts to an empty or unchanged list without throwing', () => {
  assert.deepStrictEqual(U.sortFacilities([], 'distance', ORIGIN), []);
  assert.deepStrictEqual(U.sortFacilities([], 'hours', null), []);
  assert.deepStrictEqual(U.sortFacilities([], 'name', undefined), []);
  assert.deepStrictEqual(ids(U.sortFacilities([rec('only', 'Only', 'x', 'y')], 'distance', ORIGIN)), ['only']);
});

test('sorting by hours puts entries that list hours first, then name; blank hours count as not listed', () => {
  const list = [
    rec('1', 'Delta', 1, 1, null),
    rec('2', 'Charlie', 1, 1, '   '),
    rec('3', 'Bravo', 1, 1, '9:00-17:00'),
    rec('4', 'Alpha', 1, 1, undefined),
    rec('5', 'Echo', 1, 1, 'Open 24 hours')
  ];
  assert.deepStrictEqual(ids(U.sortFacilities(list, 'hours', null)), ['3', '5', '4', '2', '1']);
  assert.strictEqual(U.hasListedHours(list[0]), false);
  assert.strictEqual(U.hasListedHours(list[1]), false);
  assert.strictEqual(U.hasListedHours({ hours: 42 }), false);
  assert.strictEqual(U.hasListedHours(null), false);
  assert.strictEqual(U.hasListedHours(list[2]), true);
  // the hours text is never read: "Closed" is still "listed"
  assert.strictEqual(U.hasListedHours({ hours: 'Closed' }), true);
});

test('the result does not depend on the order of the input, and the input is not changed', () => {
  const list = [
    rec('3', 'Same Name', 22.60, 88.40), rec('1', 'Same Name', 22.60, 88.40), rec('2', 'Same Name', 22.60, 88.40),
    rec('4', 'Other', 22.70, 88.30), rec('5', 'Broken', NaN, NaN)
  ];
  const copy = JSON.parse(JSON.stringify(list));
  const first = ids(U.sortFacilities(list, 'distance', ORIGIN));
  assert.deepStrictEqual(list.map((f) => f.id), copy.map((f) => f.id), 'input order unchanged');
  for (const sortBy of ['name', 'distance', 'hours']) {
    const expected = ids(U.sortFacilities(list, sortBy, ORIGIN));
    [[...list].reverse(), [list[2], list[4], list[0], list[3], list[1]]].forEach((shuffled) => {
      assert.deepStrictEqual(ids(U.sortFacilities(shuffled, sortBy, ORIGIN)), expected, sortBy);
    });
  }
  assert.deepStrictEqual(first.slice(0, 3).sort(), ['1', '2', '3'], 'ties stay together');
  assert.deepStrictEqual(first.slice(0, 3), ['1', '2', '3'], 'and are ordered by id');
});

test('two records at the same distance are ordered by name', () => {
  const list = [rec('b', 'Bravo', 22.6, 88.4), rec('a', 'Alpha', 22.6, 88.4)];
  assert.deepStrictEqual(ids(U.sortFacilities(list, 'distance', ORIGIN)), ['a', 'b']);
});

// ---- the doctor and pharmacy pages must not show a rating, a review count or an availability claim ----

test('the doctor and pharmacy scripts and pages have no ratings, review counts, availability or made up distances', () => {
  const files = ['assets/js/doctors.js', 'assets/js/pharmacies.js', 'pages/doctors.html', 'pages/pharmacies.html'];
  files.forEach((file) => {
    const text = read(file);
    assert.doesNotMatch(text, /\brating\s*:/, file + ' has a rating field');
    assert.doesNotMatch(text, /\breviews\s*:/, file + ' has a review count');
    assert.doesNotMatch(text, /\bavailability\s*:/, file + ' has an availability field');
    assert.doesNotMatch(text, /doctor-rating|fa-star|class="reviews"|availability-badge/, file + ' draws stars or an availability badge');
    assert.doesNotMatch(text, /\d\s*miles away/, file + ' has a distance that is not computed');
    assert.doesNotMatch(text, /value="(rating|availability)"/, file + ' offers sorting by rating or availability');
  });
  assert.doesNotMatch(read('pages/doctors.html'), /id="availability"/, 'the availability filter has no data behind it');
});

function sortOptions(file, labelPart) {
  const html = read(file);
  const select = new RegExp('<select[^>]*aria-label="Sort ' + labelPart + ' by"[^>]*>([\\s\\S]*?)</select>').exec(html);
  assert.ok(select, 'sort select in ' + file);
  return [...select[1].matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
}

test('sort options are only fields that exist in the data', () => {
  assert.deepStrictEqual(sortOptions('pages/doctors.html', 'doctors'), ['name', 'specialty']);
  assert.deepStrictEqual(sortOptions('pages/pharmacies.html', 'pharmacies'), ['name', 'distance', 'delivery']);
});

test('every select value on the doctor and pharmacy pages can match a record', () => {
  const doctorsSrc = read('assets/js/doctors.js');
  const specialties = [...doctorsSrc.matchAll(/specialty:\s*"([^"]+)"/g)].map((m) => m[1].toLowerCase());
  const doctorOptions = [...read('pages/doctors.html').matchAll(/<select id="specialty">([\s\S]*?)<\/select>/g)][0][1];
  const doctorValues = [...doctorOptions.matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
  // dentist is offered but has no sample doctor: that is an empty result, not a broken value
  doctorValues.filter((v) => v !== 'dentist').forEach((v) => assert.ok(specialties.includes(v), 'specialty option ' + v + ' matches no sample doctor'));

  const pharmaciesSrc = read('assets/js/pharmacies.js');
  const types = [...pharmaciesSrc.matchAll(/type:\s*"([^"]+)"/g)].map((m) => m[1].toLowerCase());
  const typeOptions = /<select id="pharmacy-type">([\s\S]*?)<\/select>/.exec(read('pages/pharmacies.html'))[1];
  [...typeOptions.matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]).forEach((v) => assert.ok(types.includes(v), 'type option ' + v + ' matches no sample pharmacy'));
});

// ---- pharmacy distance: the sample coordinates are placeholders, so distance stays off ----

test('pharmacy distance sorting stays disabled while the sample coordinates are not in West Bengal', () => {
  const src = read('assets/js/pharmacies.js');
  const lats = [...src.matchAll(/\blat:\s*(-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
  const lngs = [...src.matchAll(/\blng:\s*(-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
  assert.ok(lats.length > 0 && lats.length === lngs.length);
  // a loose box around West Bengal
  const inBengal = lats.every((lat, i) => lat > 21.5 && lat < 27.3 && lngs[i] > 85.8 && lngs[i] < 89.9);
  const flag = /const PHARMACY_COORDINATES_ARE_REAL = (true|false);/.exec(src);
  assert.ok(flag, 'the placeholder-coordinates switch is missing');
  if (!inBengal) {
    assert.strictEqual(flag[1], 'false', 'coordinates outside West Bengal must not be used for distance');
    assert.match(read('pages/pharmacies.html'), /<option value="distance" disabled>/, 'the Distance option must be disabled');
  }
});

test('the pharmacy script only builds an origin for distance when the coordinates are real', () => {
  const src = read('assets/js/pharmacies.js');
  assert.match(src, /saved && PHARMACY_COORDINATES_ARE_REAL \?/);
  assert.match(src, /sortBy === 'distance' && PHARMACY_COORDINATES_ARE_REAL \? 'distance' : 'name'/);
  assert.match(src, /Distance sorting is not available for pharmacies yet/);
});

test('the doctor page has no coordinates, and the hospital list gets its coordinates from facilities.json', () => {
  assert.doesNotMatch(read('assets/js/doctors.js'), /\b(lat|lng)\s*:/);
  assert.doesNotMatch(read('assets/js/hospitals.js'), /\b(lat|lng):\s*-?\d/);
});
