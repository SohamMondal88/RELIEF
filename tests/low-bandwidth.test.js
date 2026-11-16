// Low-data mode (Issue #50): the stored choice, the connection hint, what the stylesheet may and may not
// touch, and the wiring on the essential pages. See docs/LOW_BANDWIDTH.md.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const L = require('../assets/js/low-bandwidth.js');
const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

function memoryStorage(initial) {
  const data = Object.assign({}, initial);
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    data
  };
}
const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
const forgetful = { getItem: () => null, setItem() {} }; // accepts writes but keeps nothing

// ---- the stored choice ------------------------------------------------------------------------

test('only the exact words on and off are read back', () => {
  assert.strictEqual(L.readPreference(memoryStorage({ relief_low_bandwidth: 'on' })), 'on');
  assert.strictEqual(L.readPreference(memoryStorage({ relief_low_bandwidth: 'off' })), 'off');
  ['', 'ON', 'true', '1', 'yes', ' on', '{"a":1}', 'null'].forEach((v) => {
    assert.strictEqual(L.readPreference(memoryStorage({ relief_low_bandwidth: v })), null, v);
  });
  assert.strictEqual(L.readPreference(memoryStorage()), null);
});

test('blocked or missing storage reads as "never chosen" and does not throw', () => {
  assert.strictEqual(L.readPreference(throwing), null);
  assert.strictEqual(L.readPreference(null), null);
  assert.strictEqual(L.readPreference(undefined), null);
});

test('writing keeps the choice, and says false when it could not be kept', () => {
  const s = memoryStorage();
  assert.strictEqual(L.writePreference(s, 'on'), true);
  assert.strictEqual(s.data.relief_low_bandwidth, 'on');
  assert.strictEqual(L.writePreference(s, 'off'), true);
  assert.strictEqual(s.data.relief_low_bandwidth, 'off');
  assert.strictEqual(L.writePreference(throwing, 'on'), false);
  assert.strictEqual(L.writePreference(forgetful, 'on'), false);
  assert.strictEqual(L.writePreference(null, 'on'), false);
  ['yes', '', null, undefined, true].forEach((v) => assert.strictEqual(L.writePreference(s, v), false, String(v)));
  assert.strictEqual(s.data.relief_low_bandwidth, 'off');
});

test('the storage key is the one in the privacy inventory and the privacy document', () => {
  const privacy = require('../assets/js/privacy-data.js');
  assert.strictEqual(L.KEY, 'relief_low_bandwidth');
  assert.ok(privacy.inventoryKeys().includes(L.KEY));
  assert.ok(read('docs/PRIVACY_AND_DATA.md').includes('`relief_low_bandwidth`'));
});

// ---- the mode is the person's choice ----------------------------------------------------------

test('the mode is active only when the person turned it on', () => {
  assert.strictEqual(L.isActive('on'), true);
  [null, 'off', undefined, 'true', 1].forEach((v) => assert.strictEqual(L.isActive(v), false, String(v)));
});

test('a slow or Data Saver hint only makes a suggestion, it never switches the mode on', () => {
  const slow = L.connectionHint({ connection: { effectiveType: '2g', saveData: false } });
  assert.deepStrictEqual(slow, { saveData: false, slow: true, suggest: true });
  assert.strictEqual(L.barState(null, slow), 'suggest');
  assert.strictEqual(L.isActive(null), false);
});

test('connection hints: Data Saver, slow types, fast types, missing and odd values', () => {
  assert.strictEqual(L.connectionHint({ connection: { saveData: true } }).suggest, true);
  ['slow-2g', '2g', '3g'].forEach((t) => assert.strictEqual(L.connectionHint({ connection: { effectiveType: t } }).suggest, true, t));
  ['4g', '5g', '', 'fast'].forEach((t) => assert.strictEqual(L.connectionHint({ connection: { effectiveType: t } }).suggest, false, t));
  [undefined, null, {}, { connection: null }, { connection: { effectiveType: 3 } }, { connection: { saveData: 'yes' } }].forEach((n) => {
    assert.deepStrictEqual(L.connectionHint(n), { saveData: false, slow: false, suggest: false }, JSON.stringify(n));
  });
});

test('the bar offers: on stays on, a choice of off is respected even on a slow link, a first visit gets the suggestion', () => {
  const slow = { suggest: true };
  assert.strictEqual(L.barState('on', slow), 'on');
  assert.strictEqual(L.barState('on', null), 'on');
  assert.strictEqual(L.barState('off', slow), 'off');
  assert.strictEqual(L.barState(null, slow), 'suggest');
  assert.strictEqual(L.barState(null, { suggest: false }), 'off');
  assert.strictEqual(L.barState(null, undefined), 'off');
});

test('apply sets and removes the class on <html> and nothing else', () => {
  const classes = new Set();
  const doc = { documentElement: { classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) } } };
  L.apply(doc, true);
  assert.deepStrictEqual([...classes], ['relief-lite']);
  L.apply(doc, false);
  assert.deepStrictEqual([...classes], []);
});

test('pictures are deferred except the brand logo, map pieces and anything that is not a picture', () => {
  const img = (cls, ancestors) => ({ nodeType: 1, tagName: 'IMG', className: cls || '', closest: (sel) => (ancestors || []).some((a) => sel.includes(a)) ? {} : null });
  assert.strictEqual(L.deferable(img()), true);
  assert.strictEqual(L.deferable(img('', ['.logo'])), false);
  assert.strictEqual(L.deferable(img('', ['.brand'])), false);
  assert.strictEqual(L.deferable(img('', ['.leaflet-container'])), false);
  assert.strictEqual(L.deferable(img('leaflet-tile')), false);
  assert.strictEqual(L.deferable({ nodeType: 1, tagName: 'DIV', className: '' }), false);
  assert.strictEqual(L.deferable({ nodeType: 3 }), false);
  assert.strictEqual(L.deferable(null), false);
});

// A small stand-in for the page: images as plain objects with attributes, and a document that finds them.
function fakeImg(attrs, extra) {
  const a = Object.assign({}, attrs);
  return Object.assign({
    nodeType: 1, tagName: 'IMG', className: a.class || '', complete: false, attrs: a,
    closest: () => null,
    getAttribute: (k) => (k in a ? a[k] : null),
    setAttribute: (k, v) => { a[k] = String(v); },
    removeAttribute: (k) => { delete a[k]; }
  }, extra);
}
function fakeDoc(imgs) {
  const has = (img, k) => k in img.attrs;
  return {
    querySelectorAll(sel) {
      const m = sel.match(/^img\[([\w-]+)\]$/);
      return m ? imgs.filter((i) => has(i, m[1])) : imgs;
    }
  };
}

test('switching on after the page has loaded cancels pictures still downloading, and leaves the rest alone', () => {
  const hero = fakeImg({ src: 'assets/images/hero-image.png' });
  const done = fakeImg({ src: 'assets/images/partner1.png' }, { complete: true });
  const lazyAlready = fakeImg({ src: 'assets/images/a.png', loading: 'lazy' });
  const logo = fakeImg({ src: 'assets/images/logo.png' }, { closest: (sel) => (sel.includes('.logo') ? {} : null) });
  const tile = fakeImg({ src: 'https://tile/1.png', class: 'leaflet-tile' });
  const noSrc = fakeImg({});
  L.deferExisting(fakeDoc([hero, done, lazyAlready, logo, tile, noSrc]));
  assert.strictEqual(hero.getAttribute('src'), null);
  assert.strictEqual(hero.getAttribute('data-relief-src'), 'assets/images/hero-image.png');
  [done, lazyAlready, logo, tile].forEach((i) => assert.ok(i.getAttribute('src'), i.attrs.src));
  [done, lazyAlready, logo, tile, noSrc].forEach((i) => assert.strictEqual(i.getAttribute('data-relief-src'), null));
});

test('switching off puts the addresses and the loading attribute back, and touches nothing this script did not change', () => {
  const hero = fakeImg({ src: 'assets/images/hero-image.png' });
  const marked = fakeImg({ src: 'assets/images/b.png' });
  const own = fakeImg({ src: 'assets/images/c.png', loading: 'lazy' }); // lazy before the mode, so it stays lazy
  L.deferExisting(fakeDoc([hero, marked, own]));
  L.markLazy(marked);
  L.markLazy(own);
  assert.strictEqual(marked.getAttribute('loading'), 'lazy');
  L.restorePictures(fakeDoc([hero, marked, own]));
  assert.strictEqual(hero.getAttribute('src'), 'assets/images/hero-image.png');
  assert.strictEqual(hero.getAttribute('data-relief-src'), null);
  assert.strictEqual(marked.getAttribute('loading'), null);
  assert.strictEqual(marked.getAttribute('data-relief-lazy'), null);
  assert.strictEqual(own.getAttribute('loading'), 'lazy');
});

test('deferPictures marks pictures added while it runs, and stops when told to', () => {
  let callback; let disconnected = false; const listeners = {};
  const win = {
    MutationObserver: function (cb) { callback = cb; this.observe = () => {}; this.disconnect = () => { disconnected = true; }; },
    document: { addEventListener: (n, f) => { listeners[n] = f; }, removeEventListener: (n) => { delete listeners[n]; } }
  };
  const stop = L.deferPictures(win, false);
  assert.strictEqual(listeners.DOMContentLoaded, undefined, 'it keeps running after load when asked to');
  const added = fakeImg({ src: 'x.png' });
  const tile = fakeImg({ src: 't.png', class: 'leaflet-tile' });
  callback([{ addedNodes: [added, tile] }]);
  assert.strictEqual(added.getAttribute('loading'), 'lazy');
  assert.strictEqual(tile.getAttribute('loading'), null);
  stop();
  assert.strictEqual(disconnected, true);
  L.deferPictures(win, true);
  assert.strictEqual(typeof listeners.DOMContentLoaded, 'function');
  assert.strictEqual(typeof L.deferPictures({ document: {} }, true), 'function');
});

test('the bar starts the picture deferral when the mode is switched on, and ends it when switched off', () => {
  const code = read('assets/js/low-bandwidth.js');
  const choose = code.slice(code.indexOf('function choose('), code.indexOf("if (state === 'suggest')"));
  assert.match(choose, /apply\(document, isActive\(value\)\);\s*setDeferral\(isActive\(value\)\)/);
  assert.match(code, /function setDeferral\(active\)[\s\S]*deferPictures\(root[\s\S]*deferExisting\(document\)[\s\S]*restorePictures\(document\)/);
});

// ---- the stylesheet ---------------------------------------------------------------------------

const css = read('assets/css/low-bandwidth.css');
const rules = css.replace(/\/\*[\s\S]*?\*\//g, '').split('}').map((r) => r.trim()).filter(Boolean).map((r) => {
  const [selector, body] = r.split('{');
  return { selectors: selector.split(',').map((x) => x.trim()), body: (body || '').trim() };
});

test('every rule is scoped to html.relief-lite, except the bar itself', () => {
  rules.forEach((r) => r.selectors.forEach((sel) => {
    assert.ok(sel.startsWith('html.relief-lite') || sel.startsWith('.relief-lite-'), sel);
  }));
});

test('the mode never hides text, buttons, links, forms, the SOS or the map', () => {
  const hiding = rules.filter((r) => /display:\s*none/.test(r.body));
  assert.ok(hiding.length >= 2);
  hiding.forEach((r) => r.selectors.forEach((sel) => {
    assert.doesNotMatch(sel, /\b(a|button|input|select|textarea|form|nav|h[1-6]|p|li)\b(?![-\w])/, sel);
    assert.doesNotMatch(sel, /sos|emergency|search|location|map|facility|hospital|call|tel/i, sel);
  }));
  // pictures are hidden only in the page body and footer, and map tiles and markers are left alone
  const imgRule = rules.find((r) => r.selectors.some((s) => /\bimg\b/.test(s)) && /display:\s*none/.test(r.body));
  assert.ok(imgRule.selectors.some((s) => s.includes('[class*="leaflet"]')));
});

test('every branch that hides pictures leaves map pictures alone, including the one for .main-content (the maps sit inside it)', () => {
  const imgRule = rules.find((r) => r.selectors.some((s) => /\bimg\b/.test(s)) && /display:\s*none/.test(r.body));
  assert.ok(imgRule.selectors.some((s) => s.startsWith('html.relief-lite .main-content img')));
  imgRule.selectors.forEach((sel) => assert.ok(sel.endsWith(':not([class*="leaflet"])'), sel));
});

test('the brand logo rule is at least as heavy as the hiding rules and comes after them', () => {
  const weight = (sel) => ({
    ids: (sel.match(/#[\w-]+/g) || []).length,
    classes: (sel.match(/\.[\w-]+|\[[^\]]*\]/g) || []).length,
    tags: (sel.replace(/\[[^\]]*\]/g, '').replace(/:not\(|\)/g, ' ').match(/(^|[\s>+~])[a-z][\w-]*/gi) || []).length
  });
  const heavier = (a, b) => (a.ids - b.ids) || (a.classes - b.classes) || (a.tags - b.tags);
  const hideIdx = rules.findIndex((r) => r.selectors.some((s) => /\bimg\b/.test(s)) && /display:\s*none/.test(r.body));
  const logoIdx = rules.findIndex((r) => r.selectors.some((s) => s.includes('.logo img')));
  assert.ok(logoIdx > hideIdx);
  rules[hideIdx].selectors.forEach((h) => rules[logoIdx].selectors.forEach((l) => {
    assert.ok(heavier(weight(l), weight(h)) >= 0, l + ' vs ' + h);
  }));
});

test('animations and transitions are switched off, the splash is skipped and the 1.8 MB loader picture is not used', () => {
  assert.match(css, /animation:\s*none\s*!important/);
  assert.match(css, /transition:\s*none\s*!important/);
  assert.match(css, /\.splash-screen\s*{[^}]*display:\s*none\s*!important/);
  assert.match(css, /\.main-content\s*{[^}]*display:\s*block\s*!important/);
  assert.match(css, /\.loader-ambulance\s*{[^}]*background-image:\s*none\s*!important/);
});

test('the brand logo is kept and the bar button is a real, big target', () => {
  assert.match(css, /\.logo img[\s\S]*display:\s*inline-block\s*!important/);
  assert.match(css, /\.relief-lite-btn\s*{[^}]*min-height:\s*44px/);
});

// ---- the script -------------------------------------------------------------------------------

test('the script keeps no personal data and makes no network request', () => {
  const code = read('assets/js/low-bandwidth.js');
  assert.doesNotMatch(code, /fetch\(|XMLHttpRequest|sendBeacon|navigator\.geolocation|document\.cookie|sessionStorage|innerHTML/);
  // the only thing it stores is the one key
  assert.deepStrictEqual([...new Set(code.match(/relief_[a-z_]+/g))], ['relief_low_bandwidth']);
});

test('turning the mode off never touches reduced-motion handling', () => {
  const code = read('assets/js/low-bandwidth.js');
  assert.doesNotMatch(code, /matchMedia|style\.animation|animationPlayState/);
  // the existing reduced-motion rules live in the page stylesheets and are not removed by this change
  ['assets/css/style.css', 'assets/css/hospitals.css', 'assets/css/ambulances.css', 'assets/css/firstaid.css'].forEach((f) => {
    assert.match(read(f), /@media \(prefers-reduced-motion: reduce\)/, f);
  });
  assert.doesNotMatch(css, /prefers-reduced-motion/);
});

// ---- wiring -----------------------------------------------------------------------------------

const PAGES = ['index.html', 'pages/hospitals.html', 'pages/ambulances.html', 'pages/firstaid.html'];

test('SOS, facility search, first aid and the home page load the mode from <head>, before any body content', () => {
  PAGES.forEach((p) => {
    const html = read(p);
    const head = html.slice(0, html.indexOf('</head>'));
    assert.match(head, /assets\/css\/low-bandwidth\.css/, p);
    assert.match(head, /assets\/js\/low-bandwidth\.js/, p);
  });
});

test('the offline copy of first aid and hospitals includes the mode files, and the cache version was bumped', () => {
  const sw = read('sw.js');
  assert.ok(sw.includes("'assets/css/low-bandwidth.css'") && sw.includes("'assets/js/low-bandwidth.js'"));
  assert.doesNotMatch(sw, /CACHE_VERSION = 'v6'/);
});

test('the document says how it is turned on and off, what it does and how it was measured', () => {
  const doc = read('docs/LOW_BANDWIDTH.md');
  ['relief_low_bandwidth', 'prefers-reduced-motion', 'Data Saver', 'never turns itself on', 'Measured'].forEach((w) => assert.ok(doc.includes(w), w));
});
