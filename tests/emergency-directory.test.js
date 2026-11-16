// Emergency resource directory (Issue #105): entries built from the SOS data, last-checked labels,
// search and its empty and unavailable states, and the page wiring. See docs/EMERGENCY_DIRECTORY.md.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const D = require('../assets/js/emergency-directory.js');
const SOS = require('../assets/js/emergency-sos.js');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const DATA = SOS.REGIONAL_EMERGENCY_DATA;
const NOW = new Date('2026-11-13T10:00:00Z');

function svc(overrides) {
  return Object.assign({ name: 'Test line', number: '112', source: 'Test source' }, overrides);
}
function data(services) {
  return { XX: { code: 'XX', name: 'Testland', services } };
}
const ids = (list) => list.map((e) => e.id);

// ---- entries ----------------------------------------------------------------------------------

test('every number in the SOS data is in the directory, with its source, and nothing else is added', () => {
  const built = D.buildEntries(DATA, { now: NOW });
  assert.strictEqual(built.ok, true);
  const helplines = built.entries.filter((e) => e.kind === 'helpline');
  const expected = [];
  Object.keys(DATA).forEach((code) => DATA[code].services.forEach((s) => expected.push(code + ':' + s.number + ':' + s.source)));
  assert.deepStrictEqual(helplines.map((e) => e.region.code + ':' + e.number + ':' + e.source), expected);
  helplines.forEach((e) => {
    assert.ok(e.source.trim() !== '');
    assert.strictEqual(e.telHref, 'tel:' + e.number);
  });
});

test('the directory code and page carry no phone number of their own', () => {
  const source = read('assets/js/emergency-directory.js') + read('assets/js/emergency-directory-ui.js') + read('pages/emergency-directory.html');
  assert.doesNotMatch(source, /tel:\d/);
  assert.doesNotMatch(source, /\b(112|108|102|911|999|1098|181)\b/);
});

test('an entry without a source, a name or a clean number is skipped and counted, never shown', () => {
  const built = D.buildEntries(data([
    svc({ source: '' }), svc({ source: undefined }), svc({ name: '' }), svc({ number: '1 12' }), svc({ number: '+91112' }),
    svc({ number: 112 }), svc({ number: '' }), null, 'text', svc({ number: '999', name: 'Good one' })
  ]));
  assert.strictEqual(built.ok, true);
  assert.deepStrictEqual(built.entries.filter((e) => e.kind === 'helpline').map((e) => e.number), ['999']);
  assert.strictEqual(built.skipped, 9);
});

test('missing or unusable data is unavailable, and the site pages are still returned', () => {
  [undefined, null, {}, [], 'x', 5, { IN: null }, { IN: { name: 'India' } }, { IN: { name: '', services: [] } }].forEach((value) => {
    const built = D.buildEntries(value);
    assert.strictEqual(built.ok, false, JSON.stringify(value));
    assert.strictEqual(built.reason, 'unavailable');
    assert.deepStrictEqual(ids(built.siteEntries), D.SITE_RESOURCES.map((r) => r.id));
  });
});

test('a region with no services is not an error: the pages of RELIEF are still listed', () => {
  const built = D.buildEntries({ XX: { name: 'Testland', services: [] } });
  assert.strictEqual(built.ok, true);
  assert.deepStrictEqual(ids(built.entries), D.SITE_RESOURCES.map((r) => r.id));
});

test('pages of RELIEF have a link, no number, no source and no date', () => {
  D.SITE_RESOURCES.forEach((r) => {
    assert.match(r.href, /^[a-z]+\.html(#[a-z-]+)?$/);
    assert.ok(fs.existsSync(path.join(root, 'pages', r.href.split('#')[0])), r.href);
    assert.strictEqual(r.number, undefined);
    assert.strictEqual(r.source, undefined);
  });
});

test('https source links are kept, anything else is dropped to plain text', () => {
  const built = D.buildEntries(data([
    svc({ sourceUrl: 'https://example.org/x' }), svc({ number: '113', sourceUrl: 'http://example.org' }),
    svc({ number: '114', sourceUrl: 'javascript:alert(1)' }), svc({ number: '115', sourceUrl: 5 })
  ]));
  assert.deepStrictEqual(built.entries.filter((e) => e.kind === 'helpline').map((e) => e.sourceUrl), ['https://example.org/x', null, null, null]);
});

// ---- last checked -----------------------------------------------------------------------------

test('no date means "not recorded", and nothing is made up', () => {
  Object.keys(DATA).forEach((code) => {
    D.buildEntries(DATA, { now: NOW }).entries.filter((e) => e.kind === 'helpline').forEach((e) => {
      const original = DATA[e.region.code].services.find((s) => s.number === e.number);
      if (!original.lastVerified && !original.lastChecked) {
        assert.strictEqual(e.checked.state, 'unknown');
        assert.strictEqual(e.checked.label, 'Last checked: not recorded');
      }
    });
  });
});

test('a real date is shown, an old one is flagged, a bad or future one is not trusted', () => {
  assert.deepStrictEqual(D.checkedStatus('2026-11-13', NOW), { state: 'checked', date: '2026-11-13', label: 'Last checked 2026-11-13' });
  assert.strictEqual(D.checkedStatus('2026-05-17', NOW).state, 'checked');   // 180 days
  assert.strictEqual(D.checkedStatus('2026-05-16', NOW).state, 'old');       // 181 days
  assert.match(D.checkedStatus('2026-05-16', NOW).label, /needs re-checking/);
  [undefined, null, '', '2026-02-30', '13-11-2026', '2027-01-01', 20261113, {}].forEach((v) => {
    assert.strictEqual(D.checkedStatus(v, NOW).state, 'unknown', String(v));
  });
});

test('lastVerified from the contact work and lastChecked are both read', () => {
  const built = D.buildEntries(data([svc({ lastVerified: '2026-11-01' }), svc({ number: '113', lastChecked: '2026-10-01' })]), { now: NOW });
  const dates = built.entries.filter((e) => e.kind === 'helpline').map((e) => e.checked.date);
  assert.deepStrictEqual(dates, ['2026-11-01', '2026-10-01']);
});

// ---- search -----------------------------------------------------------------------------------

const ALL = D.buildEntries(DATA, { now: NOW }).entries;

test('an empty or blank query lists everything in the original order', () => {
  ['', '   ', undefined, null, 5, {}].forEach((q) => assert.deepStrictEqual(ids(D.search(ALL, q)), ids(ALL), String(q)));
});

test('search by service word, number and region', () => {
  assert.ok(ids(D.search(ALL, 'ambulance')).includes('IN-108-1'));
  assert.ok(ids(D.search(ALL, 'Ambulance')).includes('IN-108-1'));
  assert.deepStrictEqual(ids(D.search(ALL, '108')), ['IN-108-1']);
  assert.deepStrictEqual(ids(D.search(ALL, 'uk')).filter((id) => id.startsWith('UK')), ['UK-999-0', 'UK-112-1']);
  assert.ok(ids(D.search(ALL, 'united states')).includes('US-911-0'));
});

test('every word has to match, extra spaces do not matter', () => {
  assert.deepStrictEqual(ids(D.search(ALL, '  maternal   ambulance ')), ['IN-102-2']);
  assert.deepStrictEqual(D.search(ALL, 'ambulance zebra'), []);
});

test('an exact number comes before a text match', () => {
  const list = D.buildEntries(data([svc({ name: 'Line 112 info', number: '113' }), svc({ name: 'Other', number: '112' })])).entries;
  assert.deepStrictEqual(D.search(list, '112').map((e) => e.number).slice(0, 2), ['112', '113']);
});

test('pages of RELIEF are found too', () => {
  assert.ok(ids(D.search(ALL, 'first aid')).includes('site-firstaid'));
  assert.ok(ids(D.search(ALL, 'hospital')).includes('site-hospitals'));
});

test('no match gives an empty list, odd input does not throw', () => {
  assert.deepStrictEqual(D.search(ALL, 'qqqqzzzz'), []);
  ['<script>', '(', '[', '\\', '.*', '%', 'a'.repeat(5000)].forEach((q) => assert.doesNotThrow(() => D.search(ALL, q), q));
  assert.deepStrictEqual(D.search(undefined, 'x'), []);
  assert.deepStrictEqual(D.search('text', 'x'), []);
});

test('a query is cut at 100 characters', () => {
  assert.strictEqual(D.normalizeQuery('a'.repeat(300)).length, 100);
  assert.strictEqual(D.normalizeQuery('  Hello   World '), 'hello world');
});

// ---- the page ---------------------------------------------------------------------------------

test('the page loads the data, then the directory, then the page script', () => {
  const html = read('pages/emergency-directory.html');
  const at = (n) => html.indexOf('assets/js/' + n);
  assert.ok(at('emergency-sos.js') !== -1 && at('emergency-directory.js') !== -1 && at('emergency-directory-ui.js') !== -1);
  assert.ok(at('emergency-sos.js') < at('emergency-directory.js') && at('emergency-directory.js') < at('emergency-directory-ui.js'));
});

test('emergency access needs no sign-in and no location', () => {
  const html = read('pages/emergency-directory.html');
  ['session-guard', 'auth-mode', 'api.js', 'login'].forEach((n) => assert.ok(!html.includes(n), n));
  const code = read('assets/js/emergency-directory.js') + read('assets/js/emergency-directory-ui.js');
  assert.doesNotMatch(code, /geolocation|fetchLocation|localStorage|sessionStorage/);
});

test('nothing dials by itself', () => {
  const code = read('assets/js/emergency-directory.js') + read('assets/js/emergency-directory-ui.js');
  assert.doesNotMatch(code, /window\.open|location\.(href|assign|replace)\s*=|location\.(assign|replace)\(|\.click\(\)|setTimeout|setInterval/);
});

test('the page has an empty state, an unavailable state, a no-JavaScript note and the warning', () => {
  const html = read('pages/emergency-directory.html');
  ['id="directory-empty"', 'id="directory-unavailable"', '<noscript>', 'does not dispatch help', 'role="status"'].forEach((s) => assert.ok(html.includes(s), s));
});

test('the document says where entries come from and how dates are shown', () => {
  const doc = read('docs/EMERGENCY_DIRECTORY.md');
  ['REGIONAL_EMERGENCY_DATA', 'SITE_RESOURCES', 'not recorded', '180'].forEach((w) => assert.ok(doc.includes(w), w));
});
