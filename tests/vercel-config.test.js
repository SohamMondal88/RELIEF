/**
 * Tests for vercel.json and the 404 page (Issue #66, the Vercel site not showing or not behaving like the repository).
 * Run with: node --test tests/vercel-config.test.js
 *
 * What this cannot do: it reads files, it does not run Vercel. Whether the Vercel project builds the right branch,
 * and that the deployed files match a commit, has to be checked on Vercel (docs/DEPLOYMENT_AUDIT.md lists how).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const vercel = JSON.parse(read('vercel.json'));

test('vercel.json uses the current format, not the legacy "routes" list', () => {
  // With "routes", Vercel puts the rule for "headers" after the catch-all, so a file served from disk never gets the
  // security headers. The 404 page needs no rule: Vercel serves 404.html by itself for a path that does not exist.
  assert.strictEqual(vercel.routes, undefined, 'remove "routes"; the headers below would not reach static files');
  assert.ok(fs.existsSync(path.join(ROOT, '404.html')), '404.html must exist at the site root');
});

test('vercel.json sends the security headers on every path', () => {
  assert.ok(Array.isArray(vercel.headers) && vercel.headers.length >= 1, 'headers are missing, so the site is served without a CSP');
  const rule = vercel.headers.find((h) => h.source === '/(.*)');
  assert.ok(rule, 'one rule must cover every path');
  const names = rule.headers.map((h) => h.key.toLowerCase()).sort();
  assert.deepStrictEqual(names, ['content-security-policy', 'permissions-policy', 'referrer-policy', 'x-content-type-options', 'x-frame-options']);
  rule.headers.forEach((h) => assert.ok(h.value && h.value.trim(), h.key + ' has no value'));
});

test('the keys of vercel.json are ones Vercel knows', () => {
  const known = ['cleanUrls', 'trailingSlash', 'headers', 'redirects', 'rewrites'];
  Object.keys(vercel).forEach((k) => assert.ok(known.includes(k), k + ' is not used in this project; check the Vercel docs before adding it'));
});

test('the 404 page works from any depth: absolute links, a language, the same policy as the other pages', () => {
  // Vercel serves this one file for /nothing and for /a/b/c alike, so "assets/css/style.css" would point at /a/b/assets/css/style.css.
  const html = read('404.html');
  assert.match(html, /<html[^>]*\slang="en"/i);
  const local = [...html.matchAll(/\s(?:href|src)="([^"]+)"/g)].map((m) => m[1]).filter((u) => !/^(https?:|mailto:|tel:|#|data:)/i.test(u));
  assert.ok(local.length > 0, 'expected local links to check');
  local.forEach((u) => assert.ok(u.startsWith('/'), '404.html: "' + u + '" must start with "/" or it breaks on a nested path'));
  const meta = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/i;
  assert.strictEqual(html.match(meta)[1], read('index.html').match(meta)[1], '404.html needs the same CSP meta as the other pages');
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i, 'no inline script: the policy blocks it');
});
