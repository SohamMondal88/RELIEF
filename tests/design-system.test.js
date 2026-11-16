/**
 * Tests for the shared design system (Issue #130, first slice).
 * Run with: node --test tests/design-system.test.js
 *
 * What this cannot do: it does not render anything. e2e/design-system.spec.js does that in a browser.
 * These keep the pieces that must agree from drifting: the measured colours, the .ds scoping, the CSP on
 * every page, and the list of pages docs/DESIGN_SYSTEM.md says are migrated or not migrated.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { run } = require('../scripts/design-contrast.js');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');

const MIGRATED = ['index.html', 'pages/firstaid.html', 'pages/hospitals.html', 'pages/login.html', 'pages/signup.html', 'pages/dashboard.html'];
const ALL_PAGES = ['index.html', '404.html']
  .concat(fs.readdirSync(path.join(ROOT, 'pages')).filter((f) => f.endsWith('.html')).map((f) => 'pages/' + f))
  .filter((f) => read(f).trim() !== '');            // pages/home.html is an empty redirect file

test('every colour pair in design-tokens.css meets its minimum contrast', () => {
  const rows = run(ROOT);
  assert.ok(rows.length >= 20);
  for (const r of rows) assert.ok(r.ok, r.use + ' is ' + r.ratio.toFixed(2) + ':1 (' + r.fgHex + ' on ' + r.bgHex + '), needs ' + r.min);
});

test('design-tokens.css holds only :root custom properties with the ds- prefix', () => {
  const css = read('assets/css/design-tokens.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks = css.match(/[^{}]+\{/g);
  assert.deepStrictEqual(blocks.map((b) => b.trim()), [':root {']);
  for (const m of css.matchAll(/^\s*(--[\w-]+)\s*:/gm)) assert.match(m[1], /^--ds-/, m[1]);
});

test('design-system.css: every rule is scoped under .ds, no external urls, no imports', () => {
  const css = read('assets/css/design-system.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/@import|url\(/i.test(css), 'no @import and no url() (keeps the CSP and the offline cache simple)');
  // Selector lists are the text before each "{" outside @keyframes bodies and at-rule preludes.
  const stripped = css.replace(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  const preludes = stripped.match(/[^{}]+(?=\{)/g).map((s) => s.trim()).filter((s) => s && !s.startsWith('@'));
  for (const prelude of preludes) {
    for (const sel of prelude.split(',').map((s) => s.trim())) {
      assert.ok(sel.startsWith('.ds'), 'selector is not scoped under .ds: ' + sel);
    }
  }
});

test('design-system.css keeps focus visible and respects reduced motion', () => {
  const css = read('assets/css/design-system.css');
  assert.match(css, /\.ds :focus-visible\s*\{[^}]*outline:\s*3px solid var\(--ds-focus\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /animation-duration: 0\.01ms !important/);
  const noOutline = css.split('\n').filter((l) => /outline:\s*(none|0)\b/.test(l));
  assert.deepStrictEqual(noOutline.map((l) => l.trim()), ['.ds main[tabindex="-1"]:focus { outline: none; }']);
  assert.ok(/min-height: var\(--ds-touch\)/.test(css), '44px touch targets');
});

test('design-system.css has !important only for the inline gradient, the skip link and the motion reset', () => {
  const lines = read('assets/css/design-system.css').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => l.includes('!important'));
  const text = lines.map((l) => l.trim());
  assert.ok(text.some((l) => l.startsWith('.ds .main-content { background: var(--ds-bg) !important')));
  assert.ok(text.some((l) => l.startsWith('color: var(--ds-on-primary) !important')), 'skip link');
  assert.strictEqual(text.length, 6, 'unexpected !important: ' + text.join(' | '));
});

for (const page of MIGRATED) {
  test(page + ' opts in to the design system correctly', () => {
    const html = read(page);
    const up = page.includes('/') ? '../' : '';
    assert.match(html, /<body class="ds">/);
    const tokens = html.indexOf('href="' + up + 'assets/css/design-tokens.css"');
    const layer = html.indexOf('href="' + up + 'assets/css/design-system.css"');
    assert.ok(tokens !== -1 && layer !== -1, 'both stylesheets are linked');
    const own = [...html.matchAll(/<link rel="stylesheet" href="((?:\.\.\/)?assets\/css\/(?!design-)[^"]+)"/g)].map((m) => m.index);
    assert.ok(own.length >= 1);
    assert.ok(tokens < Math.min(...own), 'tokens come before the page stylesheets');
    assert.ok(layer > Math.max(...own), 'the component layer comes after the page stylesheets');
    assert.ok(!/c3cfe2/.test(html), 'the old inline gradient is gone');
    assert.ok(fs.existsSync(path.join(ROOT, 'assets/css/design-tokens.css')) && fs.existsSync(path.join(ROOT, 'assets/css/design-system.css')));
  });

  test(page + ' keeps its Content Security Policy and adds no inline script', () => {
    const html = read(page);
    const csp = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/);
    assert.ok(csp, 'CSP meta tag present');
    assert.ok(!/unsafe-inline['"]?\s*(;|$)/.test(csp[1].split(';').find((d) => d.trim().startsWith('script-src')) || ''), 'script-src has no unsafe-inline');
    for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
      if (!/\bsrc=/.test(m[1])) assert.strictEqual(m[2].trim(), '', 'inline script found');
    }
    assert.ok(!/<link[^>]+href="https?:\/\/(?!cdnjs\.cloudflare\.com|fonts\.googleapis\.com|unpkg\.com)/.test(html), 'no new external origin');
  });
}

test('docs/DESIGN_SYSTEM.md lists exactly the migrated and the not migrated pages', () => {
  const doc = read('docs/DESIGN_SYSTEM.md');
  const migratedSection = doc.split('### Migrated in this slice')[1].split('### Not migrated yet')[0];
  const notSection = doc.split('### Not migrated yet (follow-up work)')[1].split('## Known limitations')[0];
  const mig = [...migratedSection.matchAll(/\(`?((?:pages\/)?[\w-]+\.html)`?\)/g)].map((m) => m[1]).sort();
  assert.deepStrictEqual(mig, MIGRATED.slice().sort());
  const listed = [...notSection.matchAll(/`((?:pages\/)?[\w-]+\.html)`/g)].map((m) => m[1]).sort();
  const expected = ALL_PAGES.filter((p) => !MIGRATED.includes(p) && p !== 'pages/home.html').sort();
  assert.deepStrictEqual(listed, expected);
  assert.ok(!/no major page left/i.test(doc));
  // and the pages the doc calls not migrated really are not
  for (const p of expected) assert.ok(!/<body class="ds"/.test(read(p)), p + ' is not supposed to be migrated yet');
});
