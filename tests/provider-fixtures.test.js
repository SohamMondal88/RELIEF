/**
 * Tests for the shared synthetic provider fixtures (Issue #122).
 * Rules are in docs/PROVIDER_TEST_FIXTURES.md.
 *
 * node --test tests/provider-fixtures.test.js
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const fx = require('./helpers/provider-fixtures');
const Schema = require('../assets/js/facility-schema.js');

const ROOT = path.join(__dirname, '..');
const NOW = Date.UTC(2026, 9, 27);

test('every fixture record meets the fixture rules', () => {
  assert.deepStrictEqual(fx.validateAll(fx.data), []);
});

test('the file and every record say they are synthetic, and nothing is verified', () => {
  assert.strictEqual(fx.data.synthetic, true);
  assert.match(fx.data._note, /SYNTHETIC/);
  Object.keys(fx.KINDS).forEach((kind) => {
    fx.data[fx.KINDS[kind].key].forEach((r) => {
      assert.strictEqual(r.synthetic, true, r.id);
      assert.ok(r.id.startsWith('synthetic-' + kind + '-'), r.id);
      assert.notStrictEqual(r.verified, true, r.id + ' must not be verified');
      assert.ok(!r.source && !r.lastChecked, r.id + ' must not have a source or check date');
    });
  });
});

test('hospitals and pharmacies are also accepted by the real facility contract', () => {
  fx.hospitals.concat(fx.pharmacies).forEach((record) => {
    const result = Schema.validateFacility(record, NOW);
    assert.strictEqual(result.valid, true, record.id + ': ' + JSON.stringify(result.errors));
  });
});

test('there is at least one of each kind, one with no coordinates and one open 24 hours', () => {
  Object.keys(fx.KINDS).forEach((kind) => assert.ok(fx.data[fx.KINDS[kind].key].length >= 2, kind));
  const all = [].concat(fx.hospitals, fx.doctors, fx.pharmacies, fx.ambulances);
  assert.ok(all.some((r) => r.lat === undefined || r.lat === null), 'a record without coordinates');
  assert.ok(all.some((r) => /open 24 hours/i.test(r.hours || '')), 'a 24 hour record');
});

test('doctors point at hospital fixtures that exist (or at none)', () => {
  const ids = fx.hospitals.map((h) => h.id);
  fx.doctors.forEach((d) => assert.ok(d.facilityId === null || ids.includes(d.facilityId), d.id));
  assert.ok(fx.doctors.some((d) => d.facilityId === null));
});

test('fixture text contains no real contact details', () => {
  const text = JSON.stringify(fx.data);
  assert.ok(!/@/.test(text), 'no email addresses');
  (text.match(/https?:\/\/[^"\s]+/g) || []).forEach((url) => assert.match(url, /^https:\/\/([a-z-]+\.)?example\.org(\/|$)/));
});

test('get returns a copy, so one test cannot change what another sees', () => {
  const a = fx.get('doctor', 'synthetic-doctor-001');
  a.name = 'changed';
  assert.strictEqual(fx.get('doctor', 'synthetic-doctor-001').name, 'Dr. Sample Rao');
  assert.throws(() => fx.get('doctor', 'nope'), /No doctor fixture/);
});

// ---------------------------------------------------------------------------
// The validator must reject bad records (otherwise the checks above prove nothing)
// ---------------------------------------------------------------------------

const good = () => fx.get('hospital', 'synthetic-hospital-001');
const cases = [
  ['not an object', 'hospital', null, 'record must be an object'],
  ['not marked synthetic', 'hospital', Object.assign(good(), { synthetic: false }), 'synthetic must be true'],
  ['id without the synthetic prefix', 'hospital', Object.assign(good(), { id: 'h-1' }), 'id must look like'],
  ['id of the wrong kind', 'hospital', Object.assign(good(), { id: 'synthetic-doctor-001' }), 'id must look like'],
  ['missing name', 'hospital', Object.assign(good(), { name: '  ' }), 'name is required'],
  ['unknown hospital type', 'hospital', Object.assign(good(), { type: 'spa' }), 'type must be one of'],
  ['marked verified', 'hospital', Object.assign(good(), { verified: true }), 'verified must not be true'],
  ['has a source', 'hospital', Object.assign(good(), { source: 'https://example.org/list' }), 'source must be absent'],
  ['has a check date', 'hospital', Object.assign(good(), { lastChecked: '2026-10-01' }), 'lastChecked must be absent'],
  ['real looking phone', 'hospital', Object.assign(good(), { phone: '+91 98765 43210' }), 'fictional 5550'],
  ['latitude without longitude', 'hospital', Object.assign(good(), { lng: undefined }), 'together or neither'],
  ['latitude out of range', 'hospital', Object.assign(good(), { lat: 91 }), 'out of range'],
  ['0,0 coordinates', 'hospital', Object.assign(good(), { lat: 0, lng: 0 }), '0,0'],
  ['coordinates as text', 'hospital', Object.assign(good(), { lat: '23.2' }), 'must be numbers'],
  ['impossible hour', 'hospital', Object.assign(good(), { hours: 'Mon-Fri 9:00-25:00' }), 'impossible time'],
  ['hours with no times', 'hospital', Object.assign(good(), { hours: 'whenever' }), 'hours must say'],
  ['same open and close time', 'hospital', Object.assign(good(), { hours: '9:00-9:00' }), 'same time'],
  ['http website', 'hospital', Object.assign(good(), { website: 'http://hospital.example.org' }), 'must be https'],
  ['website on a real looking host', 'hospital', Object.assign(good(), { website: 'https://www.apollohospitals.com' }), 'example.org'],
  ['website that is not a URL', 'hospital', Object.assign(good(), { website: 'hospital dot org' }), 'not a valid URL'],
  ['email address', 'hospital', Object.assign(good(), { address: 'mail me at a@b.org' }), 'no email'],
  ['markup in text', 'hospital', Object.assign(good(), { name: '<b>Sample</b>' }), 'no markup'],
  ['doctor without a specialty', 'doctor', Object.assign(fx.get('doctor', 'synthetic-doctor-001'), { specialty: '' }), 'specialty is required'],
  ['ambulance with an unknown service type', 'ambulance', Object.assign(fx.get('ambulance', 'synthetic-ambulance-001'), { serviceType: 'helicopter' }), 'serviceType must be one of'],
  ['pharmacy typed as a hospital', 'pharmacy', Object.assign(fx.get('pharmacy', 'synthetic-pharmacy-001'), { type: 'hospital' }), 'type must be one of']
];

cases.forEach(([label, kind, record, expected]) => {
  test('[invalid] ' + label + ' is rejected', () => {
    const problems = fx.validateProvider(kind, record);
    assert.ok(problems.some((p) => p.includes(expected)), 'expected "' + expected + '" in ' + JSON.stringify(problems));
  });
});

test('[invalid] validateAll catches duplicate ids and a doctor linked to a missing hospital', () => {
  const file = JSON.parse(JSON.stringify(fx.data));
  file.hospitals[1].id = file.hospitals[0].id;
  file.doctors[0].facilityId = 'synthetic-hospital-099';
  const problems = fx.validateAll(file).join('\n');
  assert.match(problems, /duplicate id/);
  assert.match(problems, /points at no hospital fixture/);
});

// ---------------------------------------------------------------------------
// Test data must never leak into the real data
// ---------------------------------------------------------------------------

test('synthetic fixtures do not appear in the shipped data or the page scripts', () => {
  const real = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'data', 'facilities.json'), 'utf8'));
  const realIds = real.facilities.map((f) => f.id);
  const realNames = real.facilities.map((f) => f.name);
  [].concat(fx.hospitals, fx.pharmacies).forEach((f) => {
    assert.ok(!realIds.includes(f.id), f.id + ' is in assets/data/facilities.json');
    assert.ok(!realNames.includes(f.name), f.name + ' is in assets/data/facilities.json');
  });
  const scriptDir = path.join(ROOT, 'assets', 'js');
  fs.readdirSync(scriptDir).filter((n) => n.endsWith('.js')).forEach((n) => {
    assert.ok(!/synthetic-(hospital|doctor|pharmacy|ambulance)-/.test(fs.readFileSync(path.join(scriptDir, n), 'utf8')), n + ' mentions a synthetic fixture id');
  });
  ['pages', 'profiles'].forEach((dir) => {
    (function walk(d) {
      fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
        const p = path.join(d, e.name);
        if (e.isDirectory()) return walk(p);
        if (/\.(html|js)$/.test(e.name)) assert.ok(!/synthetic-(hospital|doctor|pharmacy|ambulance)-/.test(fs.readFileSync(p, 'utf8')), p + ' mentions a synthetic fixture id');
      });
    })(path.join(ROOT, dir));
  });
});
