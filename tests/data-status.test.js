/**
 * Tests for the data status labels and legend (Issue #110): verified, not verified, sample data and
 * status unavailable, shared by the list, the map popup and the legend.
 *
 * node --test tests/data-status.test.js
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const U = require('../assets/js/facility-utils.js');
const fx = require('./helpers/provider-fixtures');

const NOW = Date.UTC(2026, 9, 27);
const OPTS = { now: NOW };
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

const evidence = { source: 'https://example.org/list', verifiedBy: 'reviewer', lastChecked: '2026-10-01' };
const verified = U.normalizeFacility(Object.assign({ id: 'v', name: 'Verified Sample', district: 'Kolkata', reviewState: 'verified' }, evidence));
const pending = U.normalizeFacility({ id: 'p', name: 'Pending Sample', district: 'Kolkata', reviewState: 'pending' });
const noStatus = U.normalizeFacility({ id: 'n', name: 'No Status Sample', district: 'Kolkata' });
const sample = U.normalizeFacility({ id: 's', name: 'Sample Record', district: 'Kolkata', synthetic: true });

const keyOf = (record) => U.dataStatus(record, OPTS).key;

test('only a record with a source, a verifier and a recent date is Verified', () => {
  assert.strictEqual(keyOf(verified), 'verified');
  [{ source: null }, { verifiedBy: null }, { lastChecked: null }, { lastChecked: '2099-01-01' }].forEach((missing) => {
    const f = U.normalizeFacility(Object.assign({ id: 'x', name: 'X', reviewState: 'verified' }, evidence, missing));
    assert.strictEqual(keyOf(f), 'unverified', JSON.stringify(missing));
  });
  assert.strictEqual(keyOf(U.normalizeFacility({ id: 'x', name: 'X', verified: true })), 'unverified', 'the bare flag is not enough');
});

test('a record with no status information is "Status unavailable", never verified or "Not verified"', () => {
  assert.strictEqual(keyOf(noStatus), 'unavailable');
  assert.strictEqual(U.dataStatus(noStatus, OPTS).badge, 'Status unavailable');
  assert.strictEqual(keyOf(U.normalizeFacility({ id: 'x', name: 'X', reviewState: 'bogus' })), 'unavailable');
  assert.strictEqual(keyOf(U.normalizeFacility({ id: 'x', name: 'X', verified: false })), 'unverified', 'an explicit false is a statement');
  // records that did not go through normalizeFacility (the sample doctor and pharmacy lists)
  assert.strictEqual(keyOf({ name: 'Plain object' }), 'unavailable');
  assert.strictEqual(keyOf({ name: 'Claims it', verified: 'yes' }), 'unavailable');
});

test('missing or broken input never throws and never says verified', () => {
  [null, undefined, 0, '', 'text', [], 42].forEach((value) => {
    assert.strictEqual(U.dataStatus(value, OPTS).key, 'unavailable', String(value));
  });
  assert.strictEqual(U.statusBadgeHtml(U.dataStatus(undefined)).includes('Verified'), false);
});

test('sample data is always "Sample data", even when it claims to be verified', () => {
  assert.strictEqual(keyOf(sample), 'sample');
  const claims = U.normalizeFacility(Object.assign({ id: 'c', name: 'Claims', reviewState: 'verified', synthetic: true }, evidence));
  assert.strictEqual(keyOf(claims), 'sample');
  assert.strictEqual(U.dataStatus(claims, OPTS).badge, 'Sample data');
  assert.strictEqual(keyOf({ name: 'Doctor', synthetic: true }), 'sample');
  assert.strictEqual(keyOf(U.normalizeFacility({ id: 'x', name: 'X', reviewState: 'pending', synthetic: 'true' })), 'unverified', 'only the real boolean counts');
});

test('the shared provider fixtures are shown as sample data', () => {
  fx.hospitals.concat(fx.pharmacies).forEach((record) => assert.strictEqual(keyOf(U.normalizeFacility(record)), 'sample', record.id));
});

test('stale and rejected records keep their own labels', () => {
  const stale = U.normalizeFacility(Object.assign({ id: 's', name: 'Old', reviewState: 'verified' }, evidence, { lastChecked: '2025-01-01' }));
  assert.strictEqual(keyOf(stale), 'stale');
  assert.strictEqual(keyOf(U.normalizeFacility({ id: 'r', name: 'R', reviewState: 'rejected' })), 'rejected');
});

test('every label has words, a distinct symbol and a meaning, so colour is never the only cue', () => {
  const badges = new Set();
  const icons = new Set();
  U.STATUS_ORDER.forEach((key) => {
    const probe = { verified, unverified: pending, stale: U.normalizeFacility(Object.assign({ id: 's', name: 'Old', reviewState: 'verified' }, evidence, { lastChecked: '2025-01-01' })),
      rejected: U.normalizeFacility({ id: 'r', name: 'R', reviewState: 'rejected' }), sample, unavailable: noStatus }[key];
    const status = U.dataStatus(probe, OPTS);
    assert.strictEqual(status.key, key);
    assert.ok(status.badge.length > 3 && status.icon.length > 0 && status.description.length > 20, key);
    badges.add(status.badge);
    icons.add(status.icon);
    const html = U.statusBadgeHtml(status);
    assert.ok(html.includes('>' + status.badge + '</span>'), 'the label is real text in ' + key);
    assert.ok(html.includes('data-icon='), key);
  });
  assert.strictEqual(badges.size, U.STATUS_ORDER.length);
  assert.strictEqual(icons.size, U.STATUS_ORDER.length);
});

test('list and map agree: the popup carries exactly the badge the card shows', () => {
  [verified, pending, noStatus, sample].forEach((record) => {
    const badge = U.statusBadgeHtml(U.dataStatus(record, OPTS));
    const popup = U.popupHtml(record, OPTS);
    assert.ok(popup.includes(badge), record.id);
    assert.ok(popup.includes(record.name), record.id);
  });
  assert.strictEqual(U.popupHtml(verified, OPTS).includes('Not verified'), false);
  assert.ok(U.popupHtml(noStatus, OPTS).includes('Status unavailable'));
});

test('the popup escapes the name and the area', () => {
  const html = U.popupHtml({ name: '<img src=x onerror=alert(1)>', district: '"><script>', statusKnown: true, reviewState: 'pending' }, OPTS);
  assert.ok(!/<img|<script/.test(html), html);
  assert.ok(html.includes('&lt;img'));
});

test('the page scripts draw the list and the popup from the same functions', () => {
  const hospitals = read('assets/js/hospitals.js');
  assert.match(hospitals, /U\.dataStatus\(f/);
  assert.match(hospitals, /U\.popupHtml\(f/);
  assert.doesNotMatch(hospitals, /badge-' \+ /, 'no second place that builds a badge class by hand');
  ['doctors', 'pharmacies', 'ambulances'].forEach((name) => {
    const text = read('assets/js/' + name + '.js');
    assert.match(text, /statusBadgeHtml\(U\.dataStatus\(/, name + ' card');
    assert.match(text, /legendHtml\(/, name + ' legend');
  });
  assert.match(read('assets/js/pharmacies.js'), /popupHtml\(pharmacy\)/);
  assert.match(read('assets/js/ambulances.js'), /popupHtml\(ambulance\)/);
});

test('the sample doctor, pharmacy and ambulance records are all marked as sample data', () => {
  ['doctors', 'pharmacies', 'ambulances'].forEach((name) => {
    const text = read('assets/js/' + name + '.js');
    const records = (text.match(/\n            id: \d+,/g) || []).length;
    const marked = (text.match(/\n            id: \d+,\n            synthetic: true,/g) || []).length;
    assert.ok(records > 0 && records === marked, name + ': ' + marked + ' of ' + records + ' records marked');
  });
});

test('legend: only the labels the records use, in a fixed order, with what they mean', () => {
  const all = U.legendHtml([sample, noStatus, pending, verified], OPTS);
  const order = ['Verified', 'Not verified', 'Sample data', 'Status unavailable'].map((t) => all.indexOf('>' + t + '</span>'));
  order.forEach((i) => assert.ok(i > 0));
  assert.deepStrictEqual([...order].sort((a, b) => a - b), order, 'fixed order');
  assert.ok(!all.includes('>Needs re-checking<') && !all.includes('>Could not be confirmed<'));
  assert.match(all, /never shown as verified/);

  const onlyPending = U.legendHtml([pending, pending], OPTS);
  assert.ok(onlyPending.includes('>Not verified</span>'));
  assert.ok(!onlyPending.includes('>Verified</span>'), 'a legend never describes a label no record has');

  assert.ok(U.legendHtml([noStatus], OPTS).includes('>Status unavailable</span>'));
  assert.ok(!U.legendHtml([noStatus], OPTS).includes('Verified'));
});

test('legend: nothing to explain when there are no records', () => {
  assert.strictEqual(U.legendHtml([], OPTS), '');
  assert.strictEqual(U.legendHtml(undefined, OPTS), '');
  assert.strictEqual(U.legendHtml(null), '');
});

test('the real facility file only produces labels it can back up', () => {
  const raw = JSON.parse(read('assets/data/facilities.json'));
  const list = U.normalizeFacilities(raw);
  list.forEach((f) => {
    const key = U.dataStatus(f).key;
    if (key === 'verified') assert.ok(f.source && f.verifiedBy && f.lastChecked, f.id);
    assert.notStrictEqual(key, 'sample', f.id + ' is real data');
  });
});
