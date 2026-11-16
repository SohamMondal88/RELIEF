// Prints the WCAG 2.x contrast ratio of every foreground/background pair the design system relies on.
// Reads the tokens from assets/css/design-tokens.css so the numbers in docs/DESIGN_SYSTEM.md can be reproduced:
//   node scripts/design-contrast.js
// Exit code 1 if a pair is below its minimum (4.5 for text, 3 for non-text parts of a control).
const fs = require('node:fs');
const path = require('node:path');

function readTokens(css) {
  const tokens = {};
  for (const m of css.matchAll(/--(ds-[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) tokens[m[1]] = m[2].toLowerCase();
  return tokens;
}
function lum(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function ratio(a, b) {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// [foreground token, background token, minimum, what it is for]
const PAIRS = [
  ['ds-ink', 'ds-bg', 4.5, 'body text on the page background'],
  ['ds-ink', 'ds-surface', 4.5, 'body text on cards'],
  ['ds-ink-muted', 'ds-bg', 4.5, 'secondary text on the page background'],
  ['ds-ink-muted', 'ds-surface', 4.5, 'secondary text on cards'],
  ['ds-ink-muted', 'ds-surface-2', 4.5, 'secondary text on tinted panels'],
  ['ds-on-primary', 'ds-primary', 4.5, 'label on a primary button'],
  ['ds-on-primary', 'ds-primary-hover', 4.5, 'label on a primary button, hovered'],
  ['ds-primary', 'ds-surface', 4.5, 'links and outline buttons on cards'],
  ['ds-primary', 'ds-bg', 4.5, 'links and outline buttons on the page'],
  ['ds-primary', 'ds-primary-soft', 4.5, 'text on a soft primary badge'],
  ['ds-on-danger', 'ds-danger', 4.5, 'label on an emergency button'],
  ['ds-on-danger', 'ds-danger-hover', 4.5, 'label on an emergency button, hovered'],
  ['ds-danger-ink', 'ds-danger-soft', 4.5, 'error alert text'],
  ['ds-warning-ink', 'ds-warning-soft', 4.5, 'warning alert text'],
  ['ds-success-ink', 'ds-success-soft', 4.5, 'success alert text'],
  ['ds-info-ink', 'ds-info-soft', 4.5, 'information alert text'],
  ['ds-footer-ink', 'ds-footer-bg', 4.5, 'footer text'],
  ['ds-footer-link', 'ds-footer-bg', 4.5, 'footer links'],
  ['ds-focus', 'ds-surface', 3, 'focus ring on cards'],
  ['ds-focus', 'ds-bg', 3, 'focus ring on the page'],
  ['ds-focus-on-dark', 'ds-footer-bg', 3, 'focus ring on the footer'],
  ['ds-border-strong', 'ds-surface', 3, 'form field border on cards (non-text 3:1)']
];

function run(root) {
  const t = readTokens(fs.readFileSync(path.join(root, 'assets', 'css', 'design-tokens.css'), 'utf8'));
  return PAIRS.map(([fg, bg, min, use]) => {
    if (!t[fg] || !t[bg]) throw new Error('missing token ' + (!t[fg] ? fg : bg));
    const r = ratio(t[fg], t[bg]);
    return { fg, bg, fgHex: t[fg], bgHex: t[bg], min, use, ratio: r, ok: r >= min };
  });
}

module.exports = { run, ratio, readTokens, PAIRS };

if (require.main === module) {
  const rows = run(path.join(__dirname, '..'));
  for (const r of rows) {
    console.log((r.ok ? 'ok   ' : 'FAIL ') + r.ratio.toFixed(2).padStart(5) + ':1 (min ' + r.min + ')  ' + r.fgHex + ' on ' + r.bgHex + '  ' + r.use);
  }
  process.exit(rows.every((r) => r.ok) ? 0 : 1);
}
