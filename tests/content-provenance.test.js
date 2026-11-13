/**
 * Provenance and review dates for health-resource content (Issue #79).
 *
 * node --test tests/content-provenance.test.js
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const P = require('../assets/js/content-provenance.js');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const NOW = new Date('2026-11-13T09:00:00Z');
const good = (extra) => Object.assign({
  status: 'source-checked',
  sourceUrl: 'https://www.example-health.org/first-aid/burns',
  sourceName: 'Example Health Authority, Burns',
  lastReviewed: '2026-10-01'
}, extra);

// ---------- dates ----------

test('[date] one format everywhere: day, short month, year, without a leading zero', () => {
  assert.strictEqual(P.formatDate('2026-11-09'), '9 Nov 2026');
  assert.strictEqual(P.formatDate('2026-01-31'), '31 Jan 2026');
  assert.strictEqual(P.formatDate('2024-02-29'), '29 Feb 2024');
  assert.strictEqual(P.formatDate('2026-12-01'), '1 Dec 2026');
});

test('[date] it does not move with the time zone of the machine', () => {
  const before = process.env.TZ;
  try {
    ['Pacific/Kiritimati', 'Pacific/Pago_Pago', 'UTC'].forEach((tz) => {
      process.env.TZ = tz;
      assert.strictEqual(P.formatDate('2026-11-09'), '9 Nov 2026', tz);
    });
  } finally {
    if (before === undefined) delete process.env.TZ; else process.env.TZ = before;
  }
});

const BAD_DATES = ['2026-02-30', '2025-02-29', '2026-13-01', '2026-00-10', '2026-1-5', '26-11-09', '2026/11/09', ' 2026-11-09', '2026-11-09 ', '2026-11-09T10:00:00Z', '09-11-2026', 'yesterday', '', null, undefined, 20261109, {}, [], true];
BAD_DATES.forEach((value) => {
  test('[date] ' + String(JSON.stringify(value)) + ' is not a date', () => {
    assert.strictEqual(P.isIsoDate(value), false);
    assert.strictEqual(P.formatDate(value), '');
    const info = P.describe(good({ lastReviewed: value }), { now: NOW });
    assert.strictEqual(info.reviewedText, 'Not recorded');
    assert.strictEqual(info.status, 'not-reviewed', 'a review with no usable date is not shown as a review');
  });
});

test('[date] a review date in the future is not believed, one day ahead is allowed for time zones', () => {
  assert.strictEqual(P.describe(good({ lastReviewed: '2026-11-14' }), { now: NOW }).status, 'source-checked');
  assert.strictEqual(P.describe(good({ lastReviewed: '2026-11-15' }), { now: NOW }).status, 'not-reviewed');
  assert.strictEqual(P.describe(good({ lastReviewed: '2030-01-01' }), { now: NOW }).reviewedText, 'Not recorded');
});

// ---------- source link ----------

const BAD_URLS = ['http://www.example.org/page', 'javascript:alert(1)', 'data:text/html,<b>x</b>', 'ftp://example.org/x', '//example.org/x', '/relative/page', 'example.org', 'https://', 'https://user:pass@example.org/', 'https://exa mple.org/', 'https://example.org/a b', 'not a url', '', '   ', null, undefined, 5, {}, ['https://example.org'], 'https://' + 'a'.repeat(300) + '.org'];
BAD_URLS.forEach((value) => {
  test('[source] ' + String(JSON.stringify(value)).slice(0, 50) + ' is not accepted as a source', () => {
    const info = P.describe(good({ sourceUrl: value }), { now: NOW });
    assert.strictEqual(info.sourceUrl, null);
    assert.strictEqual(info.sourceText, 'Source not recorded');
    assert.strictEqual(info.status, 'not-reviewed', 'no source, no review status');
  });
});

test('[source] an https link is kept, and its name is shown instead of the address', () => {
  const info = P.describe(good(), { now: NOW });
  assert.strictEqual(info.sourceUrl, 'https://www.example-health.org/first-aid/burns');
  assert.strictEqual(info.sourceText, 'Example Health Authority, Burns');
});

test('[source] without a name the host is shown, never a made up title', () => {
  const info = P.describe(good({ sourceName: undefined }), { now: NOW });
  assert.strictEqual(info.sourceText, 'example-health.org');
});

test('[source] a name with no link is not shown as a source', () => {
  const info = P.describe({ sourceName: 'Some Authority' }, { now: NOW });
  assert.strictEqual(info.sourceText, 'Source not recorded');
  assert.ok(!JSON.stringify(info).includes('Some Authority'));
});

// ---------- status needs its evidence ----------

test('[status] a record with nothing in it says so plainly', () => {
  [undefined, null, {}, [], 'text', 7, true, () => 1].forEach((meta) => {
    const info = P.describe(meta, { now: NOW });
    assert.strictEqual(info.status, 'not-reviewed');
    assert.strictEqual(info.statusLabel, 'Not reviewed');
    assert.strictEqual(info.sourceText, 'Source not recorded');
    assert.strictEqual(info.reviewedText, 'Not recorded');
    assert.strictEqual(info.sourceUrl, null);
    assert.strictEqual(info.recorded, false);
  });
});

test('[status] source-checked needs a link and a date', () => {
  assert.strictEqual(P.describe(good(), { now: NOW }).status, 'source-checked');
  assert.strictEqual(P.describe(good({ sourceUrl: undefined }), { now: NOW }).status, 'not-reviewed');
  assert.strictEqual(P.describe(good({ lastReviewed: undefined }), { now: NOW }).status, 'not-reviewed');
});

test('[status] clinician-reviewed also needs a named reviewer, otherwise it is not shown', () => {
  const claimed = good({ status: 'clinician-reviewed' });
  assert.strictEqual(P.describe(claimed, { now: NOW }).status, 'not-reviewed');
  assert.strictEqual(P.describe(Object.assign({}, claimed, { reviewedBy: '   ' }), { now: NOW }).status, 'not-reviewed');
  const ok = P.describe(Object.assign({}, claimed, { reviewedBy: 'A. Rao, physician' }), { now: NOW });
  assert.strictEqual(ok.status, 'clinician-reviewed');
  assert.strictEqual(ok.reviewedBy, 'A. Rao, physician');
});

test('[status] a downgraded record drops the date and the reviewer so it does not read like a review', () => {
  const info = P.describe(good({ status: 'clinician-reviewed', sourceUrl: 'http://insecure.example.org', reviewedBy: 'A. Rao, physician' }), { now: NOW });
  assert.strictEqual(info.status, 'not-reviewed');
  assert.strictEqual(info.reviewedText, 'Not recorded');
  assert.strictEqual(info.reviewedBy, '');
  const notReviewed = P.describe(good({ status: 'not-reviewed', reviewedBy: 'A. Rao, physician' }), { now: NOW });
  assert.strictEqual(notReviewed.reviewedText, 'Not recorded');
  assert.strictEqual(notReviewed.reviewedBy, '');
});

test('[status] a reviewer name next to a source-checked record is not shown as a clinician review', () => {
  const info = P.describe(good({ reviewedBy: 'A. Rao, physician' }), { now: NOW });
  assert.strictEqual(info.status, 'source-checked');
  assert.strictEqual(info.reviewedBy, '');
});

test('[status] unknown or odd status values count as not reviewed', () => {
  ['approved', 'Clinician reviewed', 'medically-approved', '', null, 3, {}, ['source-checked']].forEach((status) => {
    assert.strictEqual(P.describe(good({ status }), { now: NOW }).status, 'not-reviewed', String(JSON.stringify(status)));
  });
});

test('[status] `ignored` names the fields that were present but unusable', () => {
  const n = P.normalize({ status: 'clinician-reviewed', sourceUrl: 'http://x.org', sourceName: 5, lastReviewed: '2026-02-30', reviewedBy: {} }, { now: NOW });
  assert.deepStrictEqual(n.ignored.sort(), ['lastReviewed', 'reviewedBy', 'sourceName', 'sourceUrl', 'status']);
  assert.deepStrictEqual(P.normalize({}, { now: NOW }).ignored, []);
});

// ---------- text cleaning ----------

test('[text] names are trimmed, collapsed and length limited', () => {
  assert.strictEqual(P.normalize(good({ sourceName: '  Example \n  Authority  ' }), { now: NOW }).sourceName, 'Example Authority');
  assert.strictEqual(P.normalize(good({ sourceName: 'x'.repeat(121) }), { now: NOW }).sourceName, '');
  assert.strictEqual(P.normalize(good({ sourceName: 'x'.repeat(120) }), { now: NOW }).sourceName.length, 120);
});

test('[text] a record with odd keys does not pollute anything or throw', () => {
  const evil = JSON.parse('{"__proto__": {"polluted": true}, "status": "source-checked", "constructor": 1, "sourceUrl": "https://example.org/a", "lastReviewed": "2026-10-01"}');
  assert.doesNotThrow(() => P.describe(evil, { now: NOW }));
  assert.strictEqual(({}).polluted, undefined);
  const throwing = { get sourceUrl() { throw new Error('boom'); } };
  // a getter that throws is the caller's bug; the normal malformed values above must never throw
  assert.throws(() => P.describe(throwing, { now: NOW }));
});

// ---------- overdue ----------

test('[overdue] a review older than 6 months is said to be, a recent one is not', () => {
  const at = (day, lastReviewed) => P.describe(good({ lastReviewed }), { now: new Date(day + 'T09:00:00Z') });
  // 183 days is still inside the window, 184 is not
  assert.strictEqual(at('2026-11-13', '2026-05-14').overdue, false);
  assert.strictEqual(at('2026-11-13', '2026-05-13').overdue, true);
  assert.strictEqual(at('2026-11-13', '2026-05-13').overdueText, 'This check is more than 6 months old.');
  const clinician = P.describe(good({ status: 'clinician-reviewed', reviewedBy: 'A. Rao, physician', lastReviewed: '2026-05-13' }), { now: new Date('2026-11-13T09:00:00Z') });
  assert.strictEqual(clinician.overdueText, 'This review is more than 6 months old.');
  assert.strictEqual(at('2026-11-13', '2026-10-01').overdue, false);
  assert.strictEqual(at('2026-11-13', '2026-10-01').overdueText, '');
  assert.strictEqual(P.describe({}, { now: NOW }).overdue, false);
});

// ---------- the element ----------

function fakeDocument() {
  const make = (tag) => ({
    tag, className: '', children: [], attrs: {}, textContent: '',
    appendChild(c) { this.children.push(c); return c; },
    set href(v) { this.attrs.href = v; }, get href() { return this.attrs.href; },
    set rel(v) { this.attrs.rel = v; }, get rel() { return this.attrs.rel; }
  });
  return { createElement: make, createTextNode: (t) => ({ tag: '#text', textContent: t }) };
}
const flat = (node) => [node].concat(...(node.children || []).map(flat));
const texts = (node) => flat(node).filter((n) => n.textContent && !(n.children && n.children.length)).map((n) => n.textContent);

test('[element] a missing record shows the three honest lines and no link', () => {
  const el = P.buildElement(fakeDocument(), undefined, { now: NOW });
  assert.match(el.className, /guide-provenance--empty/);
  assert.deepStrictEqual(texts(el), ['Source', 'Source not recorded', 'Last reviewed', 'Not recorded', 'Review status', 'Not reviewed']);
  assert.ok(!flat(el).some((n) => n.tag === 'a'));
});

test('[element] a checked record shows the link, the formatted date and the status', () => {
  const el = P.buildElement(fakeDocument(), good(), { now: NOW });
  const link = flat(el).find((n) => n.tag === 'a');
  assert.strictEqual(link.href, 'https://www.example-health.org/first-aid/burns');
  assert.strictEqual(link.rel, 'noopener noreferrer');
  assert.strictEqual(link.textContent, 'Example Health Authority, Burns');
  assert.ok(texts(el).includes('1 Oct 2026'));
  // A source check is not called a review (FIRST_AID_REVIEW_CHECKLIST.md section 2).
  assert.ok(texts(el).includes('Source checked, not a clinical review'));
  assert.ok(texts(el).includes('Checked against the source on'));
  assert.ok(!texts(el).includes('Last reviewed'));
});

test('[element] markup in a name stays text, and an unsafe link is not rendered as a link', () => {
  const el = P.buildElement(fakeDocument(), good({ sourceName: '<img src=x onerror=alert(1)>', sourceUrl: 'javascript:alert(1)' }), { now: NOW });
  assert.ok(!flat(el).some((n) => n.tag === 'a' || n.tag === 'img'));
  assert.ok(!texts(el).some((t) => t.includes('onerror')));
});

// ---------- the first aid page ----------

test('[page] the first aid page loads the helper before firstaid.js and each article gets the block', () => {
  const html = read('pages', 'firstaid.html');
  assert.ok(html.indexOf('content-provenance.js') !== -1 && html.indexOf('content-provenance.js') < html.indexOf('firstaid.js'));
  const js = read('assets', 'js', 'firstaid.js');
  assert.match(js, /window\.ReliefProvenance\.buildElement\(document, guide\.provenance\)/);
});

test('[page] each article\'s provenance status matches its row in the register (no provenance means Not reviewed)', () => {
  const js = read('assets', 'js', 'firstaid.js');
  const doc = read('docs', 'FIRST_AID_REVIEW_CHECKLIST.md');
  const register = doc.slice(doc.indexOf('## 6. Article register'));
  const inRegister = { 'not-reviewed': 'Not reviewed', 'source-checked': 'Source-checked', 'clinician-reviewed': 'Clinician reviewed' };
  // Everything between one title line and the next belongs to that article.
  const blocks = js.split(/^\s*title:\s*"/m).slice(1);
  assert.ok(blocks.length >= 5);
  blocks.forEach((block) => {
    const title = block.slice(0, block.indexOf('"'));
    const row = register.split('\n').find((line) => line.startsWith('| ' + title + ' |'));
    assert.ok(row, title + ' is in the register');
    const claimed = /\bprovenance\s*:/.test(block) ? ((/status:\s*'([a-z-]+)'/.exec(block) || [])[1] || 'not-reviewed') : 'not-reviewed';
    assert.ok(inRegister[claimed], title + ' uses a status that does not exist: ' + claimed);
    assert.strictEqual(row.split('|')[3].trim(), inRegister[claimed], title);
  });
});

test('[page] the helper is saved for offline use because the first aid page needs it', () => {
  const sw = read('sw.js');
  assert.match(sw, /'assets\/js\/content-provenance\.js'/);
});

test('[docs] the checklist explains the fields, the fallback and the date format', () => {
  const doc = read('docs', 'FIRST_AID_REVIEW_CHECKLIST.md');
  assert.match(doc, /content-provenance\.js/);
  assert.match(doc, /Source not recorded/);
  assert.match(doc, /9 Nov 2026/);
});
