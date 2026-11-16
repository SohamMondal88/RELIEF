/**
 * Shared header and footer (Issue #104).
 *
 * The header and footer of every public page are written from layout/*.tpl by scripts/shared-layout.js. These tests
 * fail when a page drifts from the templates, when a page keeps its own copy of the header or footer, and when the
 * shared parts lose the emergency link, the current-page mark, a valid path or the phone menu rules.
 *
 *   node --test tests/shared-layout.test.js
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../scripts/shared-layout.js');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const HOW_TO_FIX = ' (edit layout/*.tpl, then run: node scripts/shared-layout.js)';

const ALL_PAGES = ['index.html', '404.html'].concat(fs.readdirSync(path.join(ROOT, 'pages')).filter((f) => f.endsWith('.html')).map((f) => 'pages/' + f));
const MANAGED = L.managedPages();

function region(html, part) {
  const match = html.match(L.markerPattern(part));
  return match ? match[0] : null;
}

function hrefs(html) {
  return [...html.matchAll(/<a\s[^>]*?href="([^"]*)"[^>]*>/g)].map((m) => ({ tag: m[0], href: m[1] }));
}

function resolveLocal(file, href) {
  if (/^(https?:|mailto:|tel:|#)/.test(href)) return null;
  const target = href.split('#')[0].split('?')[0];
  return target.startsWith('/') ? target.slice(1) : path.posix.normalize(path.posix.join(path.posix.dirname(file), target));
}

// ---------------------------------------------------------------------------
// Drift
// ---------------------------------------------------------------------------

test('every managed page matches the templates', () => {
  const drift = L.findDrift().map((d) => d.file);
  assert.deepStrictEqual(drift, [], 'pages out of date: ' + drift.join(', ') + HOW_TO_FIX);
});

test('drift is detected: an edited header, a deleted footer link and a missing part all show up', () => {
  const page = 'pages/about.html';
  const html = read(page);
  const edited = html.replace('>About Us</a>', '>About</a>');
  const noMarkers = html.replace(/<!-- shared-layout:footer begin[\s\S]*?shared-layout:footer end -->/, '<footer class="footer">mine</footer>');
  assert.notStrictEqual(edited, html);
  const drifted = (text) => L.findDrift((file) => (file === page ? text : read(file))).map((d) => d.file);
  assert.deepStrictEqual(drifted(edited), [page]);
  assert.deepStrictEqual(drifted(noMarkers), [page]);
  assert.deepStrictEqual(drifted(html), []);
});

test('applying the templates twice changes nothing', () => {
  MANAGED.forEach((file) => {
    const once = L.apply(read(file), L.pageInfo(file));
    assert.strictEqual(L.apply(once, L.pageInfo(file)), once, file);
  });
});

test('no page keeps its own copy of the header or footer outside the markers', () => {
  ALL_PAGES.filter((file) => !MANAGED.includes(file) && !(file in L.EXEMPT_PAGES)).forEach((file) => {
    const html = read(file);
    assert.ok(!/<nav\s+class="navbar"|<header\s+class="topbar"/.test(html), file + ' has its own header. Add it to SITE_PAGES or COMPACT_PAGES in scripts/shared-layout.js and run the script');
    assert.ok(!/<footer\s+class="(?:wrap )?footer"/.test(html), file + ' has its own footer. Add it to SITE_PAGES or COMPACT_PAGES in scripts/shared-layout.js and run the script');
  });
  MANAGED.forEach((file) => {
    const html = read(file);
    const outside = L.PARTS.reduce((text, part) => text.replace(L.markerPattern(part), ''), html);
    assert.ok(!/<nav\s+class="navbar"|<header\s+class="topbar"|<footer\s+class="(?:wrap )?footer"/.test(outside), file + ' has a second header or footer outside the markers');
  });
});

test('the page lists have no typos: every listed page exists, none is listed twice', () => {
  const listed = MANAGED.concat(Object.keys(L.EXEMPT_PAGES));
  assert.strictEqual(new Set(listed).size, listed.length);
  listed.forEach((file) => assert.ok(fs.existsSync(path.join(ROOT, file)), file));
  Object.values(L.EXEMPT_PAGES).forEach((reason) => assert.ok(reason.length > 20));
});

test('templates are rendered per page: tour only on the home page, no token is left, paths fit the folder', () => {
  const home = L.render('header', L.pageInfo('index.html'));
  const about = L.render('header', L.pageInfo('pages/about.html'));
  assert.match(home, /btn-revisit-tour/);
  assert.doesNotMatch(about, /btn-revisit-tour/);
  assert.match(home, /href="pages\/about\.html"/);
  assert.match(about, /href="\.\.\/pages\/about\.html"/);
  assert.match(about, /href="\.\.\/index\.html"/);
  MANAGED.forEach((file) => assert.ok(!/\{\{/.test(read(file)), file + ' still has a template token'));
});

// ---------------------------------------------------------------------------
// Emergency access
// ---------------------------------------------------------------------------

test('every shared header has an Emergency link to the ambulances page, with no sign-in or location needed', () => {
  MANAGED.forEach((file) => {
    const header = region(read(file), 'header');
    const link = hrefs(header).find((a) => /class="nav-emergency"/.test(a.tag));
    assert.ok(link, file + ' needs the Emergency link');
    assert.strictEqual(resolveLocal(file, link.href), 'pages/ambulances.html', file);
    assert.ok(!/data-protected|onclick|hidden/.test(link.tag), file);
  });
  const ambulances = read('pages/ambulances.html');
  assert.ok(!/data-protected/.test(ambulances), 'the emergency page must not need sign-in');
});

test('every managed page also loads the floating Emergency SOS button script', () => {
  MANAGED.forEach((file) => assert.match(read(file), /assets\/js\/app-enhancements\.js/, file));
});

test('every public page, shared header or not, has a way to the emergency page or a phone number', () => {
  ALL_PAGES.filter((file) => file !== 'pages/home.html').forEach((file) => { // home.html only redirects to the home page
    const html = read(file);
    const reachable = /app-enhancements\.js/.test(html)
      || hrefs(html).some((a) => resolveLocal(file, a.href) === 'pages/ambulances.html' || /^tel:/.test(a.href));
    assert.ok(reachable, file + ' has no route to emergency help');
  });
});

// ---------------------------------------------------------------------------
// Destinations and paths
// ---------------------------------------------------------------------------

test('every link in a shared part points at a file that exists, from every page and folder depth', () => {
  MANAGED.forEach((file) => {
    const html = read(file);
    ['header', 'footer'].forEach((part) => {
      hrefs(region(html, part)).forEach(({ href }) => {
        const target = resolveLocal(file, href);
        if (target === null || href === '#') return;
        assert.ok(fs.existsSync(path.join(ROOT, target)), file + ' ' + part + ': ' + href + ' -> ' + target + ' does not exist');
      });
    });
  });
});

test('pages of the same kind link to the same places, wherever they live', () => {
  ['header', 'footer'].forEach((part) => {
    [L.SITE_PAGES, L.COMPACT_PAGES].forEach((group) => {
      const sets = group.map((file) => JSON.stringify(
        hrefs(region(read(file), part)).map((a) => resolveLocal(file, a.href) || a.href).filter((t) => t !== 'index.html' || true)
      ));
      const unique = [...new Set(sets)];
      // The home page alone has the tour button, which is not a link.
      assert.strictEqual(unique.length, 1, part + ' links differ between ' + group[0] + ' and another page');
    });
  });
});

test('the site footer no longer sends "Home" to the redirect stub', () => {
  MANAGED.forEach((file) => assert.ok(!/pages\/home\.html|href="home\.html"/.test(region(read(file), 'footer')), file));
});

test('the footer links to the legal pages and the contact page on every managed page', () => {
  MANAGED.forEach((file) => {
    const targets = hrefs(region(read(file), 'footer')).map((a) => resolveLocal(file, a.href));
    ['pages/privacy-policy.html', 'pages/accessibility.html', 'pages/terms-of-service.html', 'pages/cookie-policy.html', 'pages/contact.html']
      .forEach((t) => assert.ok(targets.includes(t), file + ' footer needs ' + t));
  });
});

test('404.html uses root-absolute paths, because it is served from any depth', () => {
  const html = read('404.html');
  hrefs(html).concat([...html.matchAll(/<(?:img|script)\s[^>]*src="([^"]*)"/g)].map((m) => ({ href: m[1] }))).forEach(({ href }) => {
    if (/^(https?:|mailto:|tel:|#)/.test(href)) return;
    assert.ok(href.startsWith('/'), '404.html has the relative path ' + href);
  });
  assert.ok(hrefs(html).some((a) => a.href === '/pages/ambulances.html'), '404 keeps its Emergency link');
});

// ---------------------------------------------------------------------------
// Current page
// ---------------------------------------------------------------------------

test('the link to the page you are on is marked aria-current="page", and no other link is', () => {
  MANAGED.forEach((file) => {
    const html = read(file);
    ['header', 'footer'].forEach((part) => {
      hrefs(region(html, part)).forEach(({ tag, href }) => {
        const isSelf = resolveLocal(file, href) === file;
        assert.strictEqual(/aria-current="page"/.test(tag), isSelf, file + ' ' + part + ': ' + tag);
      });
    });
  });
});

test('pages that are in the menu show where you are', () => {
  ['index.html', 'pages/about.html', 'pages/contact.html', 'pages/doctors.html', 'pages/symptoms.html', 'pages/hospitals.html',
    'pages/pharmacies.html', 'pages/ambulances.html', 'pages/login.html', 'pages/signup.html', 'pages/health-events.html'].forEach((file) => {
    assert.match(region(read(file), 'header'), /aria-current="page"/, file);
  });
});

test('the current page is not shown by colour alone', () => {
  const css = read('assets/css/shared-layout.css');
  assert.match(css, /\[aria-current="page"\][^{]*\{[^}]*text-decoration:\s*underline/);
});

// ---------------------------------------------------------------------------
// Skip link and landmarks
// ---------------------------------------------------------------------------

test('every managed page has a skip link whose target exists and can take focus', () => {
  MANAGED.forEach((file) => {
    const html = read(file);
    const skip = html.match(/<a\s[^>]*class="skip-link"[^>]*>|<a\s[^>]*href="#main-content"[^>]*class="skip-link"[^>]*>/);
    assert.ok(skip, file + ' needs a skip link');
    const id = skip[0].match(/href="#([^"]+)"/)[1];
    const target = html.match(new RegExp('<[a-z]+[^>]*\\sid="' + id + '"[^>]*>'));
    assert.ok(target, file + ': no element with id ' + id);
    assert.match(target[0], /tabindex="-1"/, file + ': skip target needs tabindex="-1"');
    assert.strictEqual((html.match(/class="skip-link"/g) || []).length, 1, file + ' has more than one skip link');
  });
});

test('each navigation landmark on a page has its own name', () => {
  MANAGED.forEach((file) => {
    const names = [...read(file).matchAll(/<nav\b([^>]*)>/g)].map((m) => (m[1].match(/aria-label="([^"]+)"/) || [])[1]);
    assert.ok(names.every(Boolean), file + ' has a nav with no aria-label');
    assert.strictEqual(new Set(names).size, names.length, file + ' repeats a nav name');
  });
});

// ---------------------------------------------------------------------------
// Phone menu
// ---------------------------------------------------------------------------

test('the phone menu is a real button with a name, a state and a target that exists', () => {
  L.SITE_PAGES.forEach((file) => {
    const html = read(file);
    const button = html.match(/<button[^>]*class="hamburger"[^>]*>/)[0];
    assert.match(button, /type="button"/, file);
    assert.match(button, /aria-label="[^"]+"/, file);
    assert.match(button, /aria-expanded="false"/, file);
    const controls = button.match(/aria-controls="([^"]+)"/)[1];
    assert.match(html, new RegExp('id="' + controls + '"'), file);
  });
});

test('a closed phone menu is invisible and out of the tab order', () => {
  const css = read('assets/css/shared-layout.css');
  const mobile = css.match(/@media \(max-width: 1279px\) \{[\s\S]*?\n\}\n/)[0];
  assert.match(mobile, /\.navbar \.nav-links \{[^}]*visibility:\s*hidden/);
  assert.match(mobile, /\.navbar \.nav-links\.active \{[^}]*visibility:\s*visible/);
  assert.match(mobile, /\.navbar \.hamburger \{[^}]*width:\s*44px;[^}]*height:\s*44px/);
});

test('the script and the stylesheet agree on where the menu collapses', () => {
  const css = read('assets/css/shared-layout.css');
  const js = read('assets/js/main.js');
  const limit = js.match(/const RELIEF_MOBILE_NAV_MAX = (\d+);/)[1];
  assert.ok(css.includes('max-width: ' + limit + 'px'), 'css uses ' + limit);
  assert.ok(css.includes('min-width: ' + (Number(limit) + 1) + 'px'), 'desktop starts one pixel after');
  assert.ok(!/innerWidth <= 992/.test(js));
});

test('opening the menu moves focus to its first link, and Escape returns it to the button', () => {
  const { initMobileNavigation } = require('../assets/js/main.js');
  const listeners = {};
  const attrs = { 'aria-expanded': 'false' };
  const classes = new Set();
  const first = { focused: false, focus() { this.focused = true; } };
  const nav = { id: 'main-nav-links', classList: { toggle: (n, on) => (on ? classes.add('nav') : classes.delete('nav')), remove: () => classes.delete('nav'), contains: () => false }, querySelector: () => first, contains: () => false };
  let buttonFocused = false;
  const button = {
    dataset: {}, classList: { toggle(n, on) { on ? classes.add('btn') : classes.delete('btn'); }, remove() { classes.delete('btn'); }, contains: () => classes.has('btn') },
    getAttribute: (k) => attrs[k], setAttribute: (k, v) => { attrs[k] = v; }, addEventListener: (n, fn) => { listeners[n] = fn; },
    focus: () => { buttonFocused = true; }, contains: () => false
  };
  const doc = {
    querySelector: (s) => (s === '.hamburger' ? button : nav),
    querySelectorAll: (s) => (s === '.nav-links' ? [nav] : []),
    getElementById: () => nav,
    addEventListener: (n, fn) => { listeners['doc:' + n] = fn; }
  };
  assert.strictEqual(initMobileNavigation(doc), true);
  listeners.click({ stopPropagation() {} });
  assert.strictEqual(attrs['aria-expanded'], 'true');
  assert.strictEqual(first.focused, true, 'focus moved into the menu');
  listeners['doc:keydown']({ key: 'Escape' });
  assert.strictEqual(attrs['aria-expanded'], 'false');
  assert.strictEqual(buttonFocused, true, 'focus is back on the button');
});

test('the Services toggle keeps the menu open on a tablet, a plain link closes it', () => {
  const { initMobileNavigation } = require('../assets/js/main.js');
  const attrs = { 'aria-expanded': 'true' };
  const open = new Set(['btn']);
  const nav = { id: 'main-nav-links', classList: { remove: () => open.delete('nav') }, querySelector: () => null, contains: () => false };
  const button = {
    dataset: {}, classList: { toggle() {}, remove: () => open.delete('btn'), contains: (n) => open.has('btn') },
    getAttribute: (k) => attrs[k], setAttribute: (k, v) => { attrs[k] = v; }, addEventListener() {}, focus() {}, contains: () => false
  };
  const handlers = {};
  const link = (name, isToggle) => ({
    classList: { contains: (c) => isToggle && c === 'dropdown-toggle' },
    addEventListener: (n, fn) => { if (n === 'click') handlers[name] = fn; }
  });
  const doc = {
    querySelector: (s) => (s === '.hamburger' ? button : nav),
    querySelectorAll: (s) => (s === '.nav-links' ? [nav] : s === '.nav-links a' ? [link('services', true), link('home', false)] : []),
    getElementById: () => nav,
    addEventListener() {}
  };
  const had = Object.prototype.hasOwnProperty.call(global, 'window');
  const before = global.window;
  global.window = { innerWidth: 1100 };
  try {
    assert.strictEqual(initMobileNavigation(doc), true);
    handlers.services();
    assert.strictEqual(attrs['aria-expanded'], 'true', 'the Services toggle did not close the menu');
    handlers.home();
    assert.strictEqual(attrs['aria-expanded'], 'false', 'a plain link still closes it');
  } finally {
    if (had) global.window = before; else delete global.window;
  }
});

test('the shared stylesheet is saved offline with the pages that use it', () => {
  assert.match(read('sw.js'), /'assets\/css\/shared-layout\.css'/);
  ['pages/hospitals.html', 'pages/firstaid.html'].forEach((file) => assert.match(read(file), /assets\/css\/shared-layout\.css/));
});

test('the locale files have the new Emergency label', () => {
  ['en', 'bn'].forEach((lang) => assert.ok(JSON.parse(read('assets/locales/' + lang + '.json'))['nav.emergency'], lang));
});
