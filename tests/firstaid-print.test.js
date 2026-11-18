// Print and save-as-PDF support for the first aid page (issue #89).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const css = read('assets/css/firstaid.css');
const html = read('pages/firstaid.html');
const js = read('assets/js/firstaid.js');
const printCss = css.slice(css.indexOf('@media print'));

test('there is a print block in the first aid stylesheet', () => {
  assert.ok(css.includes('@media print'));
});

test('print hides navigation, footer, search and the print button', () => {
  for (const selector of ['.navbar', '.footer', '.search-guides', '.guide-categories', '.btn-print-guides']) {
    assert.ok(printCss.includes(selector), selector + ' is hidden in print');
  }
});

test('print opens every guide so the full steps and warnings are on paper', () => {
  assert.match(printCss, /\.guide-content\s*{[^}]*max-height:\s*none/);
  assert.match(printCss, /\.guide-content\s*{[^}]*overflow:\s*visible/);
});

test('the safety banner and the not-a-substitute note stay in print', () => {
  assert.ok(!/\.emergency-banner[^{]*{[^}]*display:\s*none/.test(printCss), 'banner is not hidden');
  assert.match(html, /class="print-only-note"[^>]*>[^<]*do not replace emergency care/);
  assert.match(printCss, /\.print-only-note\s*{[^}]*display:\s*block/);
});

test('the print button exists and calls window.print without inline script', () => {
  assert.match(html, /id="print-guides"/);
  assert.ok(!/onclick=/.test(html), 'no inline handlers, the CSP forbids them');
  assert.match(js, /getElementById\('print-guides'\)/);
  assert.match(js, /window\.print\(\)/);
});
