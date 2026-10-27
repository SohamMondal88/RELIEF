/**
 * Contract tests for healthcare facility data (Issue #61).
 *
 * Checks the real dataset, fictional fixtures and the way the directory copes with
 * missing or broken records.
 *
 * node --test tests/facility-contract.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Schema = require('../assets/js/facility-schema.js');
const U = require('../assets/js/facility-utils.js');

const ROOT = path.join(__dirname, '..');
const readJson = (...parts) => JSON.parse(fs.readFileSync(path.join(ROOT, ...parts), 'utf8'));
const NOW = Date.UTC(2026, 9, 27); // 2026-10-27, so date checks do not depend on today

const real = readJson('assets', 'data', 'facilities.json');
const fixtures = readJson('tests', 'fixtures', 'facilities', 'valid-realistic.json');
const invalidCases = readJson('tests', 'fixtures', 'facilities', 'invalid-records.json');

const base = (extra) => Object.assign({ id: 'x-1', name: 'Test Hospital', type: 'hospital', district: 'Testpur' }, extra);

// ---------------------------------------------------------------------------
// The real dataset
// ---------------------------------------------------------------------------

test('[dataset] every record in assets/data/facilities.json meets the contract', () => {
  const result = Schema.validateDataset(real, NOW);
  assert.strictEqual(result.ok, true, result.problems.join('; '));
  assert.deepStrictEqual(
    result.quarantined,
    [],
    'These records break the contract: ' + JSON.stringify(result.quarantined, null, 2)
  );
  assert.strictEqual(result.accepted.length, real.facilities.length);
});

test('[dataset] ids are unique', () => {
  const ids = real.facilities.map((f) => String(f.id));
  const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert.deepStrictEqual(duplicates, []);
});

test('[dataset] the file declares the schema version this code understands', () => {
  assert.strictEqual(real.schemaVersion, Schema.SCHEMA_VERSION);
});

test('[dataset] the dataset is not empty and every type is one the page knows', () => {
  assert.ok(real.facilities.length > 0);
  real.facilities.forEach((f) => {
    assert.ok(Schema.KNOWN_TYPES.includes(f.type), f.id + ' has unknown type ' + f.type);
    assert.ok(U.FACILITY_TYPES[f.type], f.id + ' type has no display label in facility-utils');
  });
});

test('[dataset] nothing is marked verified without a source and a check date', () => {
  real.facilities.filter((f) => f.verified === true).forEach((f) => {
    assert.ok(f.source && f.lastChecked, f.id + ' is verified without evidence');
  });
});

// ---------------------------------------------------------------------------
// Fictional fixtures
// ---------------------------------------------------------------------------

test('[fixtures] realistic fictional records are accepted', () => {
  const result = Schema.validateDataset(fixtures, NOW);
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.quarantined, [], JSON.stringify(result.quarantined));
  assert.strictEqual(result.accepted.length, fixtures.facilities.length);
});

test('[fixtures] contain no real personal information (made-up numbers and example.org links only)', () => {
  const text = JSON.stringify(fixtures);
  assert.ok(!/@/.test(text), 'no email addresses');
  (text.match(/https?:\/\/[^"\s]+/g) || []).forEach((url) => assert.match(url, /example\.org/));
  fixtures.facilities.forEach((f) => {
    if (f.phone) assert.match(f.phone, /5550|00000/, f.id + ' should use an obviously fake number');
  });
});

// ---------------------------------------------------------------------------
// Rejecting invalid records
// ---------------------------------------------------------------------------

invalidCases.forEach((c) => {
  test('[invalid] ' + c.label + ' is rejected with a clear reason', () => {
    const result = Schema.validateFacility(c.record, NOW);
    assert.strictEqual(result.valid, false, 'should have been rejected: ' + JSON.stringify(c.record));
    assert.ok(
      result.errors.some((e) => e.includes(c.error)),
      'expected an error containing "' + c.error + '" but got ' + JSON.stringify(result.errors)
    );
  });
});

test('[invalid] one bad record is quarantined and the rest of the file still loads', () => {
  const data = { schemaVersion: 1, facilities: [base({ id: 'ok-1' }), base({ id: 'bad-1', name: '' }), base({ id: 'ok-2' })] };
  const result = Schema.validateDataset(data, NOW);
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.accepted.map((f) => f.id), ['ok-1', 'ok-2']);
  assert.strictEqual(result.quarantined.length, 1);
  assert.strictEqual(result.quarantined[0].id, 'bad-1');
  assert.strictEqual(result.quarantined[0].index, 1);
  assert.ok(result.quarantined[0].errors.length > 0);
});

test('[invalid] a duplicate id is quarantined, the first one is kept', () => {
  const result = Schema.validateDataset([base({ id: 'dup', name: 'First' }), base({ id: 'dup', name: 'Second' })], NOW);
  assert.deepStrictEqual(result.accepted.map((f) => f.name), ['First']);
  assert.match(result.quarantined[0].errors[0], /duplicate id/);
});

test('[invalid] numeric and string ids that look the same count as duplicates', () => {
  const result = Schema.validateDataset([base({ id: 7 }), base({ id: '7' })], NOW);
  assert.strictEqual(result.accepted.length, 1);
});

test('[invalid] too many services is rejected', () => {
  const services = Array.from({ length: Schema.LIMITS.services + 1 }, (_, i) => 'Service ' + i);
  assert.strictEqual(Schema.validateFacility(base({ services }), NOW).valid, false);
});

test('[invalid] every error says which field is wrong', () => {
  invalidCases.forEach((c) => {
    Schema.validateFacility(c.record, NOW).errors.forEach((e) => {
      const subjects = Schema.REQUIRED_FIELDS.concat(Schema.OPTIONAL_FIELDS, ['record', 'coordinates', 'a verified facility']);
      assert.ok(subjects.some((name) => e.startsWith(name)), 'error does not name what is wrong: ' + e);
    });
  });
});

// ---------------------------------------------------------------------------
// Unknown types and missing optional fields
// ---------------------------------------------------------------------------

test('[unknown type] is accepted with a warning, not rejected', () => {
  const result = Schema.validateDataset([base({ type: 'dialysis' })], NOW);
  assert.strictEqual(result.accepted.length, 1);
  assert.strictEqual(result.quarantined.length, 0);
  assert.match(result.warnings[0].warnings[0], /unknown type "dialysis"/);
});

test('[unknown type] still renders, filters and sorts without errors', () => {
  const list = U.normalizeFacilities([base({ type: 'dialysis', lat: 22.5, lng: 88.3 }), base({ id: 'x-2', name: 'A Clinic', type: 'clinic' })]);
  assert.strictEqual(list.length, 2);
  assert.doesNotThrow(() => {
    U.getFilterOptions(list);
    U.filterFacilities(list, { type: 'dialysis' });
    U.sortFacilities(list, 'distance', { lat: 22.5, lng: 88.3 });
  });
  assert.deepStrictEqual(U.getFilterOptions(list).types, ['clinic', 'dialysis']);
  assert.strictEqual(U.FACILITY_TYPES.dialysis, undefined, 'callers must fall back to the raw type text');
});

test('[optional] a record with only the required fields is valid', () => {
  const result = Schema.validateFacility(base(), NOW);
  assert.deepStrictEqual(result, { valid: true, errors: [], warnings: [] });
});

test('[optional] null optional fields are valid (contact details may be unknown)', () => {
  const record = base({ address: null, phone: null, hours: null, services: null, lat: null, lng: null, verified: null, source: null, lastChecked: null });
  assert.strictEqual(Schema.validateFacility(record, NOW).valid, true);
});

test('[optional] absent phone, address, hours and coordinates never break the helpers', () => {
  const list = U.normalizeFacilities(fixtures.facilities);
  assert.strictEqual(list.length, fixtures.facilities.length);
  const minimal = list.find((f) => f.id === 'fx-006');
  assert.deepStrictEqual(
    [minimal.address, minimal.phone, minimal.hours, minimal.lat, minimal.lng, minimal.services],
    [null, null, null, null, null, []]
  );
  assert.doesNotThrow(() => {
    U.getFilterOptions(list);
    U.filterFacilities(list, { search: 'minimal', verifiedOnly: false });
    U.filterFacilities(list, { verifiedOnly: true });
    U.sortFacilities(list, 'name', null);
    U.sortFacilities(list, 'distance', { lat: 22.5, lng: 88.3 });
    list.forEach((f) => {
      U.verificationLabel(f);
      U.formatDistance(null);
      U.escapeHtml(f.name);
    });
  });
});

test('[optional] facilities without coordinates are sorted last by distance, not dropped', () => {
  const list = U.normalizeFacilities(fixtures.facilities);
  const sorted = U.sortFacilities(list, 'distance', { lat: 22.6, lng: 88.4 });
  assert.strictEqual(sorted.length, list.length);
  assert.strictEqual(sorted[0].id, 'fx-001');
  const withoutCoords = sorted.filter((f) => f.distanceKm == null).map((f) => f.id);
  assert.deepStrictEqual(sorted.slice(-withoutCoords.length).map((f) => f.id), withoutCoords);
});

test('[optional] a record that slipped past the contract still cannot crash the helpers', () => {
  const rough = [
    { name: 'No id or type' },
    { id: 5, name: 'Odd values', services: 'ICU', lat: '22', lng: null, verified: 'yes', phone: 12 },
    null, 'text', 42, [], {}
  ];
  const list = U.normalizeFacilities(rough);
  assert.strictEqual(list.length, 2);
  assert.doesNotThrow(() => {
    U.getFilterOptions(list);
    U.filterFacilities(list, { search: 'odd' });
    U.sortFacilities(list, 'distance', { lat: 22.5, lng: 88.3 });
    list.forEach((f) => U.verificationLabel(f));
  });
  assert.deepStrictEqual(list[1].services, []);
  assert.strictEqual(list[1].verified, false);
});

test('[optional] markup in text is escaped by the display helper', () => {
  assert.strictEqual(U.escapeHtml('<b onclick="x">&'), '&lt;b onclick=&quot;x&quot;&gt;&amp;');
  assert.strictEqual(U.escapeHtml(null), '');
});

// ---------------------------------------------------------------------------
// Coordinates and dates
// ---------------------------------------------------------------------------

test('[coordinates] a point outside West Bengal is accepted with a warning (likely a typo)', () => {
  const result = Schema.validateDataset([base({ lat: 28.61, lng: 77.2 })], NOW);
  assert.strictEqual(result.accepted.length, 1);
  assert.match(result.warnings[0].warnings[0], /outside West Bengal/);
});

test('[coordinates] boundaries of the allowed ranges', () => {
  assert.strictEqual(Schema.validateFacility(base({ lat: 90, lng: 180 }), NOW).valid, true);
  assert.strictEqual(Schema.validateFacility(base({ lat: -90, lng: -180 }), NOW).valid, true);
  assert.strictEqual(Schema.validateFacility(base({ lat: 90.0001, lng: 0.1 }), NOW).valid, false);
  assert.strictEqual(Schema.validateFacility(base({ lat: 10, lng: 180.0001 }), NOW).valid, false);
  assert.strictEqual(Schema.validateFacility(base({ lat: NaN, lng: 10 }), NOW).valid, false);
});

test('[dates] today is allowed, tomorrow is not', () => {
  assert.strictEqual(Schema.validateFacility(base({ lastChecked: '2026-10-27' }), NOW).valid, true);
  assert.strictEqual(Schema.validateFacility(base({ lastChecked: '2026-10-28' }), NOW).valid, false);
  assert.strictEqual(Schema.validateFacility(base({ lastChecked: '2024-02-29' }), NOW).valid, true, 'leap day');
  assert.strictEqual(Schema.validateFacility(base({ lastChecked: '2025-02-29' }), NOW).valid, false, 'not a leap year');
});

test('[phones] common Indian formats are accepted, free text is not', () => {
  ['+91 33 2241 4239', '(033) 2241-4239', '03322414239', '+91 98000 00000', '1800 123 4567'].forEach((phone) => {
    assert.strictEqual(Schema.validateFacility(base({ phone }), NOW).valid, true, phone);
  });
  ['call', '12-34', '+91 (33) ext 5', '1'.repeat(16)].forEach((phone) => {
    assert.strictEqual(Schema.validateFacility(base({ phone }), NOW).valid, false, phone);
  });
});

// ---------------------------------------------------------------------------
// File-level problems and versioning
// ---------------------------------------------------------------------------

test('[file] accepts a bare list and an object with a "facilities" list', () => {
  assert.strictEqual(Schema.validateDataset([base()], NOW).ok, true);
  assert.strictEqual(Schema.validateDataset({ facilities: [base()] }, NOW).ok, true);
  assert.strictEqual(Schema.validateDataset({ facilities: [] }, NOW).accepted.length, 0);
});

test('[file] anything else is reported as unusable without throwing', () => {
  [null, undefined, 'text', 12, {}, { facilities: 'no' }, { items: [] }, true].forEach((data) => {
    let result;
    assert.doesNotThrow(() => { result = Schema.validateDataset(data, NOW); }, JSON.stringify(data));
    assert.strictEqual(result.ok, false, JSON.stringify(data));
    assert.ok(result.problems.length > 0);
  });
});

test('[version] data from a newer schema is refused with a clear message', () => {
  const result = Schema.validateDataset({ schemaVersion: Schema.SCHEMA_VERSION + 1, facilities: [base()] }, NOW);
  assert.strictEqual(result.ok, false);
  assert.match(result.problems[0], /schema version \d+ but this site understands up to \d+/);
});

test('[version] older or missing versions still load; a bad version value is a problem', () => {
  assert.strictEqual(Schema.validateDataset({ schemaVersion: 1, facilities: [base()] }, NOW).ok, true);
  assert.strictEqual(Schema.validateDataset({ facilities: [base()] }, NOW).schemaVersion, null);
  const bad = Schema.validateDataset({ schemaVersion: '1', facilities: [base()] }, NOW);
  assert.strictEqual(bad.ok, false);
  assert.match(bad.problems[0], /schemaVersion must be a whole number/);
});

test('[version] the contract is documented with the same version number', () => {
  const doc = fs.readFileSync(path.join(ROOT, 'docs', 'FACILITY_DATA_CONTRACT.md'), 'utf8');
  assert.match(doc, new RegExp('Current version: \\*\\*' + Schema.SCHEMA_VERSION + '\\*\\*'));
  Schema.REQUIRED_FIELDS.concat(Schema.OPTIONAL_FIELDS).forEach((field) => {
    assert.ok(doc.includes('`' + field + '`'), 'docs/FACILITY_DATA_CONTRACT.md does not mention ' + field);
  });
});

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

test('[wiring] the hospitals page validates data before using it', () => {
  const js = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'hospitals.js'), 'utf8');
  assert.match(js, /FacilitySchema\.validateDataset/);
  assert.match(js, /checked\.accepted/);
  const html = fs.readFileSync(path.join(ROOT, 'pages', 'hospitals.html'), 'utf8');
  const schemaAt = html.indexOf('facility-schema.js');
  assert.ok(schemaAt !== -1 && schemaAt < html.indexOf('assets/js/hospitals.js'));
});

test('[wiring] the offline cache includes the schema script', () => {
  assert.match(fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8'), /assets\/js\/facility-schema\.js/);
});

test('[wiring] CI runs these tests (node --test covers tests/*.test.js)', () => {
  const ci = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.match(ci, /node --test/);
});
