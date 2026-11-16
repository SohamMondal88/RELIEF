// Emergency contact directory (Issue #49): the checks on the data, staleness, region lookup with its
// fallbacks, and the page wiring. See docs/EMERGENCY_CONTACTS.md.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const C = require('../assets/js/emergency-contacts.js');
const SOS = require('../assets/js/emergency-sos.js');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const DATA = SOS.REGIONAL_EMERGENCY_DATA;
const NOW = new Date('2026-11-13T10:00:00Z');

function svc(overrides) {
  return Object.assign({
    name: 'National Emergency Helpline',
    number: '112',
    source: 'Govt. of India ERSS (112.gov.in)',
    sourceUrl: 'https://112.gov.in',
    scope: 'national',
    lastVerified: null
  }, overrides);
}

function data(services, extra) {
  return { XX: Object.assign({ code: 'XX', name: 'Testland', services: services }, extra) };
}

// ---- the published list -----------------------------------------------------------------------

test('every published number has a name, digits, a source and a scope', () => {
  assert.deepStrictEqual(C.dataProblems(DATA), {});
});

test('every region in the SOS data is listed, and each has at least one national number', () => {
  const regions = C.listRegions(DATA).map((r) => r.code);
  assert.deepStrictEqual(regions, Object.keys(DATA));
  regions.forEach((code) => {
    const found = C.lookup(DATA, code, { now: NOW });
    assert.ok(found.ok, code);
    assert.ok(found.national.length > 0, code + ' has no national number');
  });
});

test('the numbers are the same ones the SOS dialog uses (one list, not two)', () => {
  Object.keys(DATA).forEach((code) => {
    const shown = C.lookup(DATA, code, { now: NOW }).national.map((n) => n.number);
    assert.deepStrictEqual(shown, DATA[code].services.map((s) => s.number));
  });
});

test('nothing is claimed as verified before a person has recorded a check', () => {
  Object.keys(DATA).forEach((code) => {
    C.lookup(DATA, code, { now: NOW }).national.forEach((n) => {
      if (!n.lastVerified) {
        assert.strictEqual(n.status.state, 'unverified', code + ' ' + n.number);
        assert.strictEqual(n.status.needsReview, true);
      }
    });
  });
});

test('source links are https and sources are not empty', () => {
  Object.keys(DATA).forEach((code) => {
    DATA[code].services.forEach((s) => {
      assert.ok(s.source.trim().length > 0);
      if (s.sourceUrl !== null) assert.match(s.sourceUrl, /^https:\/\//);
    });
  });
});

// ---- staleness --------------------------------------------------------------------------------

test('a missing date is unverified and needs review', () => {
  [undefined, null, '', 'not a date', 0, {}].forEach((value) => {
    const s = C.verificationStatus({ lastVerified: value }, { now: NOW });
    assert.strictEqual(s.state, 'unverified', String(value));
    assert.strictEqual(s.needsReview, true);
    assert.match(s.label, /Not verified yet/);
  });
  assert.strictEqual(C.verificationStatus(null, { now: NOW }).state, 'unverified');
});

test('a recent date is verified, 180 days old still is, 181 days old is stale', () => {
  assert.strictEqual(C.verificationStatus({ lastVerified: '2026-11-13' }, { now: NOW }).state, 'verified');
  const edge = C.verificationStatus({ lastVerified: '2026-05-17' }, { now: NOW }); // 180 days before 13 Nov
  assert.strictEqual(edge.ageDays, 180);
  assert.strictEqual(edge.state, 'verified');
  const old = C.verificationStatus({ lastVerified: '2026-05-16' }, { now: NOW });
  assert.strictEqual(old.ageDays, 181);
  assert.strictEqual(old.state, 'stale');
  assert.strictEqual(old.needsReview, true);
  assert.match(old.label, /Needs re-checking/);
});

test('the age limit can be changed, a bad limit falls back to 180', () => {
  const s = { lastVerified: '2026-10-01' }; // 43 days
  assert.strictEqual(C.verificationStatus(s, { now: NOW, maxAgeDays: 30 }).state, 'stale');
  assert.strictEqual(C.verificationStatus(s, { now: NOW, maxAgeDays: -5 }).state, 'verified');
  assert.strictEqual(C.verificationStatus(s, { now: NOW, maxAgeDays: 'abc' }).state, 'verified');
});

test('a date in the future or a day that does not exist is never verified', () => {
  assert.strictEqual(C.verificationStatus({ lastVerified: '2027-01-01' }, { now: NOW }).state, 'unverified');
  assert.strictEqual(C.verificationStatus({ lastVerified: '2026-02-30' }, { now: NOW }).state, 'unverified');
  assert.strictEqual(C.verificationStatus({ lastVerified: '13-11-2026' }, { now: NOW }).state, 'unverified');
});

test('a stale or unverified number is still listed (it is flagged, not hidden)', () => {
  const found = C.lookup(data([svc({ lastVerified: '2020-01-01' }), svc({ number: '108', lastVerified: null })]), 'XX', { now: NOW });
  assert.deepStrictEqual(found.national.map((n) => n.status.state), ['stale', 'unverified']);
});

// ---- unknown regions and unavailable data -----------------------------------------------------

test('an unknown or empty region is reported, never guessed', () => {
  ['XX', '', 'in', ' IN', null, undefined, 42, '__proto__', 'constructor', 'toString'].forEach((code) => {
    assert.deepStrictEqual(C.lookup(DATA, code), { ok: false, reason: 'unknown-region' }, String(code));
  });
});

test('missing or unusable data is reported as unavailable', () => {
  [undefined, null, {}, [], 'text', 7, { IN: null }, { IN: { name: 'India' } }, { IN: { services: [] } }].forEach((value) => {
    assert.deepStrictEqual(C.lookup(value, 'IN'), { ok: false, reason: 'unavailable' }, JSON.stringify(value));
    assert.deepStrictEqual(C.listRegions(value).length, 0);
  });
});

test('a region with no usable entries still answers, with empty lists', () => {
  const found = C.lookup(data([{ name: 'No number here', source: 'x', scope: 'national' }]), 'XX');
  assert.strictEqual(found.ok, true);
  assert.deepStrictEqual(found.national, []);
  assert.deepStrictEqual(found.local, []);
});

test('an entry without a source or with a bad number is left out, never shown', () => {
  const found = C.lookup(data([
    svc({ source: '' }),
    svc({ source: undefined }),
    svc({ number: '1 12' }),
    svc({ number: '+91112' }),
    svc({ number: 112 }),
    svc({ scope: 'worldwide' }),
    svc({ number: '999' })
  ]), 'XX');
  assert.deepStrictEqual(found.national.map((n) => n.number), ['999']);
});

test('national and local numbers are kept apart', () => {
  const found = C.lookup(data([svc(), svc({ name: 'Local control room', number: '1070', scope: 'local' })]), 'XX');
  assert.deepStrictEqual(found.national.map((n) => n.number), ['112']);
  assert.deepStrictEqual(found.local.map((n) => n.number), ['1070']);
});

test('dataProblems names each broken entry', () => {
  const bad = {
    A: { name: 'A', services: [svc({ source: '' }), svc({ sourceUrl: 'http://example.com' }), svc({ lastVerified: '2026-13-01' }), svc({ lastVerified: '2999-01-01' })] },
    B: { name: 'B', services: [] },
    C: null
  };
  const problems = C.dataProblems(bad);
  assert.deepStrictEqual(Object.keys(problems).sort(), ['A[0] 112', 'A[1] 112', 'A[2] 112', 'A[3] 112', 'B', 'C']);
  assert.ok(problems['A[0] 112'].includes('missing source'));
  assert.ok(problems['A[1] 112'].includes('sourceUrl must be an https link or null'));
  assert.ok(problems['A[3] 112'].includes('lastVerified is in the future'));
  assert.deepStrictEqual(Object.keys(C.dataProblems({})), ['data']);
  assert.deepStrictEqual(Object.keys(C.dataProblems(null)), ['data']);
});

// ---- region from the browser language ---------------------------------------------------------

test('the region guess follows the browser language and may be null', () => {
  assert.strictEqual(C.regionFromLocale('en-IN', DATA), 'IN');
  assert.strictEqual(C.regionFromLocale('hi-IN', DATA), 'IN');
  assert.strictEqual(C.regionFromLocale('en-US', DATA), 'US');
  assert.strictEqual(C.regionFromLocale('en-CA', DATA), 'US');
  assert.strictEqual(C.regionFromLocale('en-GB', DATA), 'UK');
  assert.strictEqual(C.regionFromLocale('de-DE', DATA), 'EU');
  assert.strictEqual(C.regionFromLocale('fr-FR', DATA), 'EU');
  ['en', 'bn', 'ja-JP', 'pt-BR', '', null, undefined, 5, 'zz-ZZ'].forEach((tag) => {
    assert.strictEqual(C.regionFromLocale(tag, DATA), null, String(tag));
  });
});

test('a guess is dropped when the data has no such region', () => {
  assert.strictEqual(C.regionFromLocale('en-IN', { US: DATA.US }), null);
  assert.strictEqual(C.regionFromLocale('en-IN', {}), null);
});

// ---- tap to call ------------------------------------------------------------------------------

test('tel links carry digits only and never anything else', () => {
  assert.strictEqual(C.telHref('112'), 'tel:112');
  ['', '1 12', '112;ext=1', '+911', 'abc', null, undefined, 112, '1', '1234567'].forEach((value) => {
    assert.strictEqual(C.telHref(value), null, String(value));
  });
});

test('the page script never dials by itself', () => {
  const ui = read('assets/js/emergency-contacts-ui.js');
  const lib = read('assets/js/emergency-contacts.js');
  [ui, lib].forEach((source) => {
    assert.doesNotMatch(source, /window\.open|location\.(href|assign|replace)\s*=|location\.(assign|replace)\(|\.click\(\)/, 'must not navigate or click a link');
    assert.doesNotMatch(source, /setTimeout|setInterval/, 'nothing is scheduled');
  });
  assert.match(ui, /call\.href = entry\.telHref/);
});

// ---- the page ---------------------------------------------------------------------------------

test('the page loads the data before the checks and the checks before the page script', () => {
  const html = read('pages/emergency-contacts.html');
  const at = (name) => html.indexOf('assets/js/' + name);
  assert.ok(at('emergency-sos.js') !== -1 && at('emergency-contacts.js') !== -1 && at('emergency-contacts-ui.js') !== -1);
  assert.ok(at('emergency-sos.js') < at('emergency-contacts.js'));
  assert.ok(at('emergency-contacts.js') < at('emergency-contacts-ui.js'));
});

test('the page works without sign-in or location: no auth scripts, no geolocation call', () => {
  const html = read('pages/emergency-contacts.html');
  ['session-guard', 'auth-mode', 'api.js', 'login'].forEach((name) => assert.ok(!html.includes(name), name));
  assert.doesNotMatch(read('assets/js/emergency-contacts-ui.js') + read('assets/js/emergency-contacts.js'), /geolocation|fetchLocation/);
});

test('the page has a manual fallback and a warning that RELIEF does not dispatch help', () => {
  const html = read('pages/emergency-contacts.html');
  assert.match(html, /id="contacts-unavailable"/);
  assert.match(html, /Region not listed/);
  assert.match(html, /does not dispatch help/);
  assert.match(html, /<noscript>/);
});

test('the page ships no phone number of its own: every number comes from the data', () => {
  const html = read('pages/emergency-contacts.html');
  assert.doesNotMatch(html, /tel:/);
  assert.doesNotMatch(html, /\b(112|108|102|911|999)\b/);
});

test('the document explains the review rules', () => {
  const doc = read('docs/EMERGENCY_CONTACTS.md');
  ['lastVerified', 'sourceUrl', 'scope', '180', 'Not verified yet'].forEach((word) => assert.ok(doc.includes(word), word));
});
