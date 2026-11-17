/**
 * Tests for Issue #195: no first-party image reference may point at a file that is not in the repository,
 * every image has an alt attribute and a size, and a missing photo cannot collapse a card.
 * Run with: node --test tests/media-references.test.js
 *
 * The e2e smoke test only sees the files a page asks for while it loads. This reads every reference in the HTML,
 * the stylesheets and the scripts, so a dead one in a rule or a string that is not used yet cannot hide.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const IMAGE = '(?:png|jpe?g|gif|svg|webp|ico|avif)';

function listFiles(dir, ext) {
  return fs.readdirSync(path.join(ROOT, dir)).filter((f) => f.endsWith(ext)).map((f) => (dir ? dir + '/' : '') + f);
}

// The profile pages are covered by tests/page-paths.test.js and .github/scripts/check-links.py (issue #187).
const PAGES = ['index.html', '404.html'].concat(listFiles('pages', '.html'));
const STYLESHEETS = listFiles('assets/css', '.css');
const SCRIPTS = listFiles('assets/js', '.js');

const isLocal = (ref) => ref && !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(ref);
const clean = (ref) => ref.trim().replace(/^['"]|['"]$/g, '').split(/[?#]/)[0];
const exists = (file) => fs.existsSync(path.join(ROOT, file));

// What the browser would ask for, resolved from the file that names it.
function fromFolder(folder, ref) {
  return ref.startsWith('/') ? ref.slice(1) : path.posix.normalize(path.posix.join(folder, ref));
}

test('every image a page names in its HTML exists', () => {
  const problems = [];
  let checked = 0;
  for (const page of PAGES) {
    const html = read(page);
    const folder = path.posix.dirname(page);
    const refs = [];
    for (const m of html.matchAll(new RegExp('(?:src|poster|href)\\s*=\\s*"([^"]+\\.' + IMAGE + '(?:[?#][^"]*)?)"', 'gi'))) refs.push(m[1]);
    for (const m of html.matchAll(/srcset\s*=\s*"([^"]+)"/gi)) m[1].split(',').forEach((part) => refs.push(part.trim().split(/\s+/)[0]));
    for (const m of html.matchAll(/url\(([^)]+)\)/gi)) refs.push(m[1]);
    for (const raw of refs) {
      const ref = clean(raw);
      if (!isLocal(ref) || !new RegExp('\\.' + IMAGE + '$', 'i').test(ref)) continue;
      checked += 1;
      if (!exists(fromFolder(folder, ref))) problems.push(page + ' names ' + ref);
    }
  }
  assert.deepStrictEqual(problems, []);
  assert.ok(checked > 40, 'found the images in the pages, got ' + checked);
});

test('every image a stylesheet names in url() exists, resolved from the stylesheet', () => {
  const problems = [];
  let checked = 0;
  for (const css of STYLESHEETS) {
    const folder = path.posix.dirname(css);
    for (const m of read(css).replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/url\(([^)]+)\)/gi)) {
      const ref = clean(m[1]);
      if (!isLocal(ref) || !new RegExp('\\.' + IMAGE + '$', 'i').test(ref)) continue;
      checked += 1;
      if (!exists(fromFolder(folder, ref))) problems.push(css + ' names ' + ref);
    }
  }
  assert.deepStrictEqual(problems, []);
  assert.ok(checked > 0, 'found url() images in the stylesheets');
});

test('every image a script names exists, from the page folder or the site root', () => {
  const problems = [];
  for (const script of SCRIPTS) {
    const source = read(script).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const m of source.matchAll(new RegExp('([\'"`])([^\'"`\\s]*\\.' + IMAGE + ')(?:[?#][^\'"`]*)?\\1', 'gi'))) {
      const ref = m[2];
      if (!isLocal(ref)) continue;
      // Scripts run from pages/ (../assets/...) or from the site root (assets/...).
      const found = ['pages', ''].some((folder) => exists(fromFolder(folder, ref)));
      if (!found) problems.push(script + ' names ' + ref);
    }
  }
  assert.deepStrictEqual(problems, []);
});

test('the web app manifest icons exist', () => {
  const manifest = JSON.parse(read('manifest.webmanifest'));
  assert.ok(manifest.icons.length > 0);
  manifest.icons.forEach((icon) => assert.ok(exists(icon.src), icon.src));
});

// ---------- alt text and reserved space ----------

const imgTags = (page) => [...read(page).matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);

test('every image has an alt attribute, and an informative one says something', () => {
  const problems = [];
  for (const page of PAGES) {
    for (const tag of imgTags(page)) {
      const alt = tag.match(/\balt="([^"]*)"/);
      if (!alt) problems.push(page + ' has an image without alt: ' + tag.slice(0, 80));
      else if (/^(image|photo|picture|img|logo)$/i.test(alt[1].trim())) problems.push(page + ' has a placeholder alt "' + alt[1] + '"');
    }
  }
  assert.deepStrictEqual(problems, []);
});

test('pictures that only repeat the text next to them are decorative (empty alt)', () => {
  // These show a partner logo as a stand in thumbnail. The card heading or the source name beside them says what
  // the item is, and an alt such as "WHO" would claim the logo is that organization's.
  const blog = read('pages/blog.html');
  assert.strictEqual((blog.match(/<div class="article-image">\s*<img[^>]*\balt=""/g) || []).length, 3);
  assert.strictEqual((blog.match(/<div class="news-source[^"]*">\s*<img[^>]*\balt=""/g) || []).length, 4);
  for (const page of ['pages/login.html', 'pages/signup.html']) {
    assert.match(read(page), /<div class="auth-image">\s*<img[^>]*\balt=""/, page);
  }
});

// The header logo and the footer badges are shared page chrome: the stylesheet gives them a fixed size
// (.logo img, .brand img and .footer-badges img), which the e2e test "a late picture does not move the page" checks.
// index.html gets its sizes in the page weight change (#95).
const isChrome = (tag) => /logo\.jpg|hipaa-badge|ssl-badge/.test(tag);
const SIZED_ELSEWHERE = new Set(['index.html']);

test('every picture in the content carries width and height, so the browser reserves its space before it loads', () => {
  const problems = [];
  for (const page of PAGES.filter((p) => !SIZED_ELSEWHERE.has(p))) {
    for (const tag of imgTags(page).filter((t) => !isChrome(t))) {
      if (!/\bwidth="\d+"/.test(tag) || !/\bheight="\d+"/.test(tag)) problems.push(page + ': ' + tag.slice(0, 90));
    }
  }
  assert.deepStrictEqual(problems, []);
});

test('every stylesheet that sizes the footer badges makes the HIPAA badge reserve the shape of its file', () => {
  // The pages say width="80" height="40" for it, but the file is 807x448, so without this it is 80px wide until it
  // loads and 72px after, and the badge next to it moves.
  const withBadges = STYLESHEETS.filter((css) => /\.footer-badges img \{/.test(read(css)));
  assert.ok(withBadges.length >= 10, 'found the stylesheets that size the badges, got ' + withBadges.length);
  for (const css of withBadges) {
    assert.match(read(css), /\.footer-badges img\[src\$="hipaa-badge\.webp"\]\s*\{[^}]*aspect-ratio:\s*807\s*\/\s*448/, css);
  }
});

test('the width and height of an image have the shape of the file', () => {
  const problems = [];
  const sizeOf = (file) => {
    const buf = fs.readFileSync(path.join(ROOT, file));
    if (buf.subarray(1, 4).toString() === 'PNG') return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
    if (buf[0] === 0xff && buf[1] === 0xd8) {
      let i = 2;
      while (i < buf.length) {
        if (buf[i] !== 0xff) { i += 1; continue; }
        const marker = buf[i + 1];
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
        i += 2 + buf.readUInt16BE(i + 2);
      }
    }
    if (buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP' && buf.subarray(12, 16).toString() === 'VP8 ') {
      return [buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff];
    }
    return null;
  };
  let checked = 0;
  for (const page of PAGES.filter((p) => !SIZED_ELSEWHERE.has(p))) {
    for (const tag of imgTags(page).filter((t) => !isChrome(t))) {
      const src = tag.match(/\bsrc="([^"]+)"/)[1];
      const w = Number((tag.match(/\bwidth="(\d+)"/) || [])[1]);
      const h = Number((tag.match(/\bheight="(\d+)"/) || [])[1]);
      if (!isLocal(src) || !w || !h) continue;
      const size = sizeOf(fromFolder(path.posix.dirname(page), decodeURI(clean(src))));
      if (!size) continue;
      checked += 1;
      if (Math.abs(w / h - size[0] / size[1]) > 0.02) problems.push(page + ': ' + src + ' is ' + size.join('x') + ' but the tag says ' + w + 'x' + h);
    }
  }
  assert.deepStrictEqual(problems, []);
  assert.ok(checked > 10, 'compared the shape of the images, got ' + checked);
});

// ---------- a missing photo cannot collapse a card ----------

test('doctor and pharmacy cards no longer ask for a photo that does not exist, and keep a fixed height', () => {
  for (const [script, css, cls] of [['assets/js/doctors.js', 'assets/css/doctors.css', 'doctor-image'], ['assets/js/pharmacies.js', 'assets/css/pharmacies.css', 'pharmacy-image']]) {
    assert.doesNotMatch(read(script), /background-image|image:\s*["']/, script + ' still builds a background image');
    const rule = read(css).match(new RegExp('\\.' + cls + ' \\{([^}]*)\\}'));
    assert.ok(rule, css + ' has .' + cls);
    assert.match(rule[1], /(?:^|[\s;])(?:height|min-height|aspect-ratio):/, cls + ' reserves its space');
  }
});
