/**
 * Tests for Issue #187: paths that are built in JavaScript and never show up in the HTML.
 * .github/scripts/check-links.py checks every href and src written in the HTML. The pages a script sends the visitor to
 * (window.location.href = 'dashboard.html', a sign-in link, the offline page) are strings in the .js files, so this
 * test reads them and checks each one against the real files, the way the browser resolves it from the page that
 * loads the script. It also covers the login and signup check in main.js, which has to work with cleanUrls on
 * (/pages/login as well as /pages/login.html), and the profile page images.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

function htmlPages() {
  const pages = ['index.html'];
  for (const file of fs.readdirSync(path.join(ROOT, 'pages'))) if (file.endsWith('.html')) pages.push('pages/' + file);
  for (const dir of fs.readdirSync(path.join(ROOT, 'profiles'), { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    for (const file of fs.readdirSync(path.join(ROOT, 'profiles', dir.name))) {
      if (file.endsWith('.html')) pages.push('profiles/' + dir.name + '/' + file);
    }
  }
  return pages;
}

// script file -> the folders of the pages that load it (a page address is resolved from its folder).
function loadersByScript() {
  const map = new Map();
  for (const page of htmlPages()) {
    for (const match of read(page).matchAll(/<script\b[^>]*?\bsrc="([^"]+)"/g)) {
      if (/^(https?:)?\/\//.test(match[1])) continue;
      const script = path.posix.normalize(path.posix.join(path.posix.dirname(page), match[1].split(/[?#]/)[0]));
      if (!map.has(script)) map.set(script, new Set());
      map.get(script).add(path.posix.dirname(page));
    }
  }
  return map;
}

const withoutComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// Quoted strings that are a local page address: 'dashboard.html', '../index.html', 'pages/login.html?x=1'.
function pagePathsIn(source) {
  const found = [];
  for (const match of withoutComments(source).matchAll(/(['"])((?:\.{1,2}\/)*(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.html)(?:[?#][^'"]*)?\1/g)) found.push(match[2]);
  return found;
}

test('every page a script sends the visitor to exists, resolved from a page that loads the script', () => {
  const loaders = loadersByScript();
  // sw.js is registered from the site root and its paths are relative to it.
  loaders.set('sw.js', new Set(['.']));
  let checked = 0;
  const problems = [];
  for (const [script, folders] of loaders) {
    if (!fs.existsSync(path.join(ROOT, script))) continue;
    for (const target of pagePathsIn(read(script))) {
      checked += 1;
      const exists = [...folders].some((folder) => fs.existsSync(path.join(ROOT, path.posix.normalize(path.posix.join(folder, target)))));
      if (!exists) problems.push(script + ' builds "' + target + '", which is not a file from ' + [...folders].join(' or '));
    }
  }
  assert.deepStrictEqual(problems, []);
  assert.ok(checked > 20, 'found the page paths in the scripts, got ' + checked);
});

test('the dashboard address after login and signup resolves from pages/, where those scripts run', () => {
  const loaders = loadersByScript();
  for (const script of ['assets/js/login.js', 'assets/js/signup.js']) {
    assert.deepStrictEqual([...loaders.get(script)], ['pages'], script + ' is loaded by one page, in pages/');
    const targets = pagePathsIn(read(script));
    assert.ok(targets.includes('dashboard.html'), script);
    targets.forEach((target) => assert.ok(fs.existsSync(path.join(ROOT, 'pages', target)), script + ' -> ' + target));
  }
});

test('the offline page the service worker falls back to, and the pages it saves, exist', () => {
  const sw = read('sw.js');
  const offline = sw.match(/const OFFLINE_PATH = '([^']+)'/)[1];
  assert.ok(fs.existsSync(path.join(ROOT, offline)), offline);
  const pages = sw.match(/const PAGE_PATHS = \[([\s\S]*?)\];/)[1].match(/'[^']+\.html'/g).map((s) => s.slice(1, -1));
  assert.ok(pages.length >= 2);
  pages.forEach((page) => assert.ok(fs.existsSync(path.join(ROOT, page)), page));
});

test('the signed-in redirect on login and signup works with and without .html (cleanUrls)', () => {
  assert.strictEqual(JSON.parse(read('vercel.json')).cleanUrls, true);
  const context = { window: { matchMedia: () => ({ matches: false }) } };
  vm.runInNewContext(read('assets/js/main.js'), context);
  const isAuthPage = context.reliefIsAuthPage;
  assert.strictEqual(typeof isAuthPage, 'function');
  ['/pages/login', '/pages/signup', '/pages/login.html', '/pages/signup.html', '/relief/pages/login'].forEach((p) => assert.strictEqual(isAuthPage(p), true, p));
  ['/', '/index.html', '/pages/dashboard', '/pages/dashboard.html', '/pages/login-help', '/pages/signup-guide.html', '/pages/loginx', '/pages/login/extra', ''].forEach((p) => assert.strictEqual(isAuthPage(p), false, p));
  assert.strictEqual(isAuthPage(undefined), false);
});

test('main.js uses that check for the signed-in redirect on the auth pages', () => {
  const main = read('assets/js/main.js');
  assert.match(main, /if \(reliefIsAuthPage\(window\.location\.pathname\)\) \{\s*window\.location\.href = 'dashboard\.html';/);
  assert.doesNotMatch(main, /\\\.html\$\/\.test\(window\.location\.pathname\)/);
  assert.ok(fs.existsSync(path.join(ROOT, 'pages', 'login.html')) && fs.existsSync(path.join(ROOT, 'pages', 'signup.html')));
});

test('every image on the profile pages exists, so no avatar answers 404', () => {
  const pages = htmlPages().filter((page) => page.startsWith('profiles/'));
  assert.ok(pages.length >= 4);
  let images = 0;
  for (const page of pages) {
    for (const match of read(page).matchAll(/<img\b[^>]*?\bsrc="([^"]+)"/g)) {
      if (/^(https?:|data:)/.test(match[1])) continue;
      images += 1;
      const file = path.posix.normalize(path.posix.join(path.posix.dirname(page), match[1].split(/[?#]/)[0]));
      assert.ok(fs.existsSync(path.join(ROOT, file)), page + ' loads ' + match[1] + ' (' + file + ')');
    }
  }
  assert.ok(images >= 5, 'found the five avatars, got ' + images);
});

test('the check-links script has no allowlist left to hide a missing file', () => {
  const script = read('.github/scripts/check-links.py');
  assert.doesNotMatch(script, /KNOWN_LEGACY_EXCEPTIONS|legacy/i);
});
