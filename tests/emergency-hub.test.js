// Emergency resource hub (Issue #46): the shipped data, review flags (unreviewed, overdue), the empty,
// unavailable and invalid states, grouping, search and the page wiring. See docs/EMERGENCY_HUB.md.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const H = require('../assets/js/emergency-hub.js');
const SOS = require('../assets/js/emergency-sos.js');
const HUB = require('../assets/data/emergency-hub.json');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const CONTACTS = SOS.REGIONAL_EMERGENCY_DATA;
const NOW = new Date('2026-11-13T10:00:00Z');

function hub(resources, extra) {
  return Object.assign({
    types: [{ id: 'medical', label: 'Medical' }, { id: 'first-aid', label: 'First aid' }],
    audiences: [{ id: 'everyone', label: 'Everyone' }],
    reviewCadenceDays: 180,
    resources: resources
  }, extra);
}
function page(overrides) {
  return Object.assign({ id: 'p1', type: 'medical', audience: 'everyone', title: 'A page', summary: 'About it', href: 'firstaid.html', source: 'Some source', sourceUrl: null, lastReviewed: null }, overrides);
}
const ids = (list) => list.map((r) => r.id);

// ---- the shipped file -------------------------------------------------------------------------

test('the shipped hub file builds with nothing skipped', () => {
  const built = H.build(HUB, CONTACTS, { now: NOW });
  assert.strictEqual(built.ok, true);
  assert.deepStrictEqual(built.skipped, []);
  assert.strictEqual(built.resources.length, HUB.resources.length);
});

test('every resource has a source, a type, an audience and a review flag', () => {
  H.build(HUB, CONTACTS, { now: NOW }).resources.forEach((r) => {
    assert.ok(r.source.trim() !== '', r.id);
    assert.ok(r.typeLabel && r.audienceLabel, r.id);
    assert.ok(['reviewed', 'overdue', 'unreviewed'].includes(r.review.state), r.id);
  });
});

test('numbers come from the SOS data, none is typed into the hub file or page', () => {
  const built = H.build(HUB, CONTACTS, { now: NOW });
  built.resources.filter((r) => r.kind === 'contact').forEach((r) => {
    const [code, number] = HUB.resources.find((x) => x.id === r.id).contact.split(':');
    assert.ok(CONTACTS[code].services.some((s) => s.number === number && s.name === r.title && s.source === r.source), r.id);
  });
  const code = read('pages/emergency-hub.html') + read('assets/js/emergency-hub-ui.js') + read('assets/js/emergency-hub.js');
  assert.doesNotMatch(code, /\b(108|102|911|999)\b/);
  // The hub file only points at numbers ("IN:112"), it has no number or tel: field of its own.
  assert.ok(HUB.resources.every((r) => !('number' in r) && !('tel' in r)));
  assert.doesNotMatch(JSON.stringify(HUB), /tel:/);
  assert.doesNotMatch(read('pages/emergency-hub.html') + read('assets/js/emergency-hub-ui.js'), /tel:\d/);
});

test('nothing in the shipped file claims a review that nobody recorded', () => {
  HUB.resources.filter((r) => !r.contact).forEach((r) => assert.strictEqual(r.lastReviewed, null, r.id));
  H.build(HUB, CONTACTS, { now: NOW }).resources.forEach((r) => {
    if (!r.lastReviewed) assert.strictEqual(r.review.state, 'unreviewed', r.id);
  });
});

test('the file names an owner and a review cadence', () => {
  assert.ok(typeof HUB.owner === 'string' && HUB.owner.trim() !== '');
  assert.strictEqual(HUB.reviewCadenceDays, 180);
  const doc = read('docs/EMERGENCY_HUB.md');
  ['Ownership and review cadence', 'reviewCadenceDays', 'lastReviewed', 'Not reviewed yet', '180'].forEach((w) => assert.ok(doc.includes(w), w));
});

test('page links in the file point at real pages', () => {
  HUB.resources.filter((r) => r.href).forEach((r) => assert.ok(fs.existsSync(path.join(root, 'pages', r.href.split('#')[0])), r.href));
});

// ---- review flags -----------------------------------------------------------------------------

test('no date, a bad date or a future date is "not reviewed yet"', () => {
  [undefined, null, '', 'soon', '2026-02-30', '2027-01-01', 5, {}].forEach((v) => {
    const s = H.reviewStatus(v, { now: NOW });
    assert.strictEqual(s.state, 'unreviewed', String(v));
    assert.strictEqual(s.needsReview, true);
    assert.strictEqual(s.label, 'Not reviewed yet');
  });
});

test('a date inside the cadence is reviewed, 180 days is still fine, 181 is overdue', () => {
  assert.strictEqual(H.reviewStatus('2026-11-13', { now: NOW }).state, 'reviewed');
  assert.strictEqual(H.reviewStatus('2026-05-17', { now: NOW }).state, 'reviewed');
  const old = H.reviewStatus('2026-05-16', { now: NOW });
  assert.strictEqual(old.state, 'overdue');
  assert.strictEqual(old.needsReview, true);
  assert.match(old.label, /Review overdue, last reviewed 2026-05-16/);
});

test('the cadence in the file is used, a bad one falls back to 180', () => {
  const run = (cadence) => H.build(hub([page({ lastReviewed: '2026-10-01' })], { reviewCadenceDays: cadence }), CONTACTS, { now: NOW }).resources[0].review.state;
  assert.strictEqual(run(30), 'overdue');
  assert.strictEqual(run(365), 'reviewed');
  assert.strictEqual(run(-1), 'reviewed');
  assert.strictEqual(run('x'), 'reviewed');
});

test('stale and unreviewed resources are still listed, flagged and counted', () => {
  const built = H.build(hub([page({ id: 'a', lastReviewed: '2020-01-01' }), page({ id: 'b' }), page({ id: 'c', lastReviewed: '2026-11-10' })]), CONTACTS, { now: NOW });
  assert.deepStrictEqual(built.resources.map((r) => r.review.state), ['overdue', 'unreviewed', 'reviewed']);
  assert.strictEqual(built.resources.filter((r) => r.review.needsReview).length, 2);
});

test('a contact takes its check date from the number', () => {
  const copy = JSON.parse(JSON.stringify(CONTACTS));
  copy.IN.services[0].lastVerified = '2026-11-01';
  const built = H.build(hub([{ id: 'x', type: 'medical', audience: 'everyone', contact: 'IN:112' }]), copy, { now: NOW });
  assert.strictEqual(built.resources[0].review.state, 'reviewed');
  assert.strictEqual(built.resources[0].lastReviewed, '2026-11-01');
});

// ---- empty, unavailable, invalid --------------------------------------------------------------

test('an empty resource list is valid and gives nothing to show', () => {
  const built = H.build(hub([]), CONTACTS, { now: NOW });
  assert.strictEqual(built.ok, true);
  assert.deepStrictEqual(built.resources, []);
  assert.deepStrictEqual(H.groupByType(built.resources, built.types), []);
});

test('a missing or unreadable file is unavailable', () => {
  [undefined, null, 'text', 5, [], true].forEach((v) => assert.deepStrictEqual(H.build(v, CONTACTS), { ok: false, reason: 'unavailable' }, String(v)));
});

test('a file without types, audiences or a resource list is invalid', () => {
  [{}, { types: [], audiences: [], resources: [] }, hub('x'), hub(null), { types: [{ id: 'a' }], audiences: [{ id: 'b', label: 'B' }], resources: [] },
    Object.assign(hub([]), { audiences: 'everyone' })].forEach((v) => {
    assert.deepStrictEqual(H.build(v, CONTACTS), { ok: false, reason: 'invalid' }, JSON.stringify(v));
  });
});

test('missing contact data skips contacts and keeps pages', () => {
  const list = [{ id: 'c', type: 'medical', audience: 'everyone', contact: 'IN:112' }, page()];
  [undefined, null, {}, 'x'].forEach((contacts) => {
    const built = H.build(hub(list), contacts, { now: NOW });
    assert.deepStrictEqual(ids(built.resources), ['p1']);
    assert.deepStrictEqual(built.skipped, [{ id: 'c', reason: 'contact not found or has no source' }]);
  });
  assert.deepStrictEqual(H.primaryNumbers(undefined), []);
  assert.deepStrictEqual(H.primaryNumbers({ IN: { name: 'India', primaryNumber: '1 12' } }), []);
});

test('bad resources are skipped with a reason and never shown', () => {
  const built = H.build(hub([
    null, { type: 'medical' }, page({ id: 'dup' }), page({ id: 'dup' }), page({ id: 't', type: 'nope' }), page({ id: 'a', audience: 'nope' }),
    page({ id: 'n', title: '' }), page({ id: 'l', href: 'https://evil.example/x' }), page({ id: 'l2', href: '../index.html' }), page({ id: 's', source: '' }),
    { id: 'u', type: 'medical', audience: 'everyone', contact: 'ZZ:112' }, { id: 'u2', type: 'medical', audience: 'everyone', contact: '112' },
    { id: 'u3', type: 'medical', audience: 'everyone', contact: 'IN:999' }
  ]), CONTACTS, { now: NOW });
  assert.deepStrictEqual(ids(built.resources), ['dup']);
  assert.deepStrictEqual(built.skipped.map((s) => s.reason), [
    'no id', 'no id', 'duplicate id', 'unknown type', 'unknown audience', 'no title', 'bad link', 'bad link', 'no source',
    'contact not found or has no source', 'contact not found or has no source', 'contact not found or has no source'
  ]);
});

test('a contact without a source in the data is skipped', () => {
  const copy = JSON.parse(JSON.stringify(CONTACTS));
  copy.IN.services[0].source = '';
  const built = H.build(hub([{ id: 'x', type: 'medical', audience: 'everyone', contact: 'IN:112' }]), copy, { now: NOW });
  assert.deepStrictEqual(built.resources, []);
});

test('only https source links are kept', () => {
  const built = H.build(hub([page({ id: 'a', sourceUrl: 'https://example.org/x' }), page({ id: 'b', sourceUrl: 'http://example.org' }), page({ id: 'c', sourceUrl: 'javascript:alert(1)' })]), CONTACTS);
  assert.deepStrictEqual(built.resources.map((r) => r.sourceUrl), ['https://example.org/x', null, null]);
});

// ---- grouping and search ----------------------------------------------------------------------

const BUILT = H.build(HUB, CONTACTS, { now: NOW });

test('resources are grouped by emergency type in the order of the type list, empty types left out', () => {
  const groups = H.groupByType(BUILT.resources, BUILT.types);
  assert.deepStrictEqual(groups.map((g) => g.type.id), ['all-services', 'medical', 'maternal-child', 'first-aid']);
  assert.strictEqual(groups.reduce((n, g) => n + g.items.length, 0), BUILT.resources.length);
  const extra = H.groupByType(BUILT.resources.filter((r) => r.type === 'medical'), BUILT.types);
  assert.deepStrictEqual(extra.map((g) => g.type.id), ['medical']);
});

test('audience is carried on each resource', () => {
  assert.deepStrictEqual(ids(H.filter(BUILT.resources, { audience: 'mothers-children' })), ['in-102']);
});

test('search by word, number and region; type and audience filters combine', () => {
  assert.ok(ids(H.filter(BUILT.resources, { query: 'ambulance' })).includes('in-108'));
  assert.deepStrictEqual(ids(H.filter(BUILT.resources, { query: '108' })), ['in-108']);
  assert.deepStrictEqual(ids(H.filter(BUILT.resources, { query: 'united kingdom' })), ['uk-999']);
  assert.deepStrictEqual(ids(H.filter(BUILT.resources, { query: 'ambulance', type: 'maternal-child' })), ['in-102']);
  assert.deepStrictEqual(H.filter(BUILT.resources, { type: 'first-aid', audience: 'mothers-children' }), []);
  assert.strictEqual(H.filter(BUILT.resources, {}).length, BUILT.resources.length);
  assert.strictEqual(H.filter(BUILT.resources, { query: '   ' }).length, BUILT.resources.length);
});

test('no match is an empty list and odd input does not throw', () => {
  assert.deepStrictEqual(H.filter(BUILT.resources, { query: 'qqqqzzzz' }), []);
  ['<script>', '(', '\\', '.*', 'a'.repeat(4000)].forEach((q) => assert.doesNotThrow(() => H.filter(BUILT.resources, { query: q })));
  assert.deepStrictEqual(H.filter(undefined, { query: 'x' }), []);
  assert.strictEqual(H.normalizeQuery('a'.repeat(300)).length, 100);
});

test('the "call for help" row has one number per region from the SOS data', () => {
  const list = H.primaryNumbers(CONTACTS);
  assert.deepStrictEqual(list.map((n) => n.code), Object.keys(CONTACTS));
  list.forEach((n) => assert.strictEqual(n.telHref, 'tel:' + CONTACTS[n.code].primaryNumber));
});

// ---- the page ---------------------------------------------------------------------------------

test('the page loads the numbers, then the checks, then the page script', () => {
  const html = read('pages/emergency-hub.html');
  const at = (n) => html.indexOf('assets/js/' + n);
  assert.ok(at('emergency-sos.js') !== -1 && at('emergency-hub.js') !== -1 && at('emergency-hub-ui.js') !== -1);
  assert.ok(at('emergency-sos.js') < at('emergency-hub.js') && at('emergency-hub.js') < at('emergency-hub-ui.js'));
});

test('the page works without sign-in or location and never dials by itself', () => {
  const html = read('pages/emergency-hub.html');
  ['session-guard', 'auth-mode', 'api.js', 'login'].forEach((n) => assert.ok(!html.includes(n), n));
  const code = read('assets/js/emergency-hub.js') + read('assets/js/emergency-hub-ui.js');
  assert.doesNotMatch(code, /geolocation|fetchLocation|localStorage|sessionStorage/);
  assert.doesNotMatch(code, /window\.open|location\.(href|assign|replace)\s*=|location\.(assign|replace)\(|\.click\(\)/);
});

test('the page says RELIEF does not dispatch help, keeps wellness apart and has every state', () => {
  const html = read('pages/emergency-hub.html');
  assert.match(html, /does not dispatch help/);
  assert.match(html, /Not an emergency\?/);
  ['id="hub-loading"', 'id="hub-unavailable"', 'id="hub-empty"', 'id="hub-nomatch"', '<noscript>', 'role="status"'].forEach((s) => assert.ok(html.includes(s), s));
});

test('the page script reads the data file named in the hub doc', () => {
  assert.match(read('assets/js/emergency-hub-ui.js'), /\.\.\/assets\/data\/emergency-hub\.json/);
  assert.ok(fs.existsSync(path.join(root, 'assets', 'data', 'emergency-hub.json')));
});
