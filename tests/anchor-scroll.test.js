// In-page links and deep links (Issue #190): one shared handler, ids looked up as ids, the scroll done
// again when a hidden page is shown, and no hand-made "offsetTop - 80" left in the scripts.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { reliefHashTarget, reliefAnchorClick, reliefRestoreHashScroll } = require('../assets/js/main.js');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

function fakeDoc(ids) {
  const els = {};
  ids.forEach((id) => { els[id] = { id, scrolled: [], scrollIntoView(opts) { this.scrolled.push(opts); } }; });
  return { els, getElementById: (id) => (Object.prototype.hasOwnProperty.call(els, id) ? els[id] : null) };
}

// A click on `href` (or on something inside a link with that href).
function fakeClick(href, { classes = [], inner = false, defaultPrevented = false } = {}) {
  const link = {
    getAttribute: (name) => (name === 'href' ? href : null),
    classList: { contains: (c) => classes.includes(c) }
  };
  const target = inner ? { closest: (sel) => (sel === 'a[href^="#"]' ? link : null) } : Object.assign(link, { closest: (sel) => (sel === 'a[href^="#"]' ? link : null) });
  const event = { target, defaultPrevented, prevented: false, preventDefault() { this.prevented = true; this.defaultPrevented = true; } };
  return event;
}

test('reliefHashTarget finds an element by id', () => {
  const doc = fakeDoc(['contact-form', 'map']);
  assert.strictEqual(reliefHashTarget('#contact-form', doc), doc.els['contact-form']);
  assert.strictEqual(reliefHashTarget('#map', doc), doc.els.map);
});

test('reliefHashTarget returns null for nothing, a bare hash and an id that is not on the page', () => {
  const doc = fakeDoc(['map']);
  for (const hash of ['', '#', '#missing', 'map', undefined, null, 42]) {
    assert.strictEqual(reliefHashTarget(hash, doc), null, String(hash));
  }
  assert.strictEqual(reliefHashTarget('#map', null), null);
  assert.strictEqual(reliefHashTarget('#map', {}), null);
});

test('reliefHashTarget never throws on ids that are not valid selectors', () => {
  const doc = fakeDoc(['1a', 'a:b', 'a[1]', 'it\'s', 'तारीख']);
  for (const hash of ['#1a', '#a:b', '#a[1]', '#it\'s', '#%E0%A4%A', '#..', '#a b', '#>', '#:~:text=hello']) {
    assert.doesNotThrow(() => reliefHashTarget(hash, doc), hash);
  }
  assert.strictEqual(reliefHashTarget('#1a', doc), doc.els['1a']);
  assert.strictEqual(reliefHashTarget('#a:b', doc), doc.els['a:b']);
  assert.strictEqual(reliefHashTarget('#a[1]', doc), doc.els['a[1]']);
  assert.strictEqual(reliefHashTarget('#%E0%A4%A4%E0%A4%BE%E0%A4%B0%E0%A5%80%E0%A4%96', doc), doc.els['तारीख'], 'percent-encoded ids are decoded');
});

test('a bad percent sequence falls back to the raw text instead of throwing', () => {
  const doc = fakeDoc(['%E0%A4%A']);
  assert.strictEqual(reliefHashTarget('#%E0%A4%A', doc), doc.els['%E0%A4%A']);
});

test('a real in-page link is left to the browser', () => {
  const event = fakeClick('#contact-form');
  reliefAnchorClick(event);
  assert.strictEqual(event.prevented, false, 'preventDefault would stop the browser setting the hash');
});

test('a click on something inside a link is treated like a click on the link', () => {
  const real = fakeClick('#map', { inner: true });
  reliefAnchorClick(real);
  assert.strictEqual(real.prevented, false);
  const bare = fakeClick('#', { inner: true });
  reliefAnchorClick(bare);
  assert.strictEqual(bare.prevented, true);
});

test('a bare # (placeholder links, the Services toggle) is stopped so the page does not jump to the top', () => {
  const event = fakeClick('#');
  reliefAnchorClick(event);
  assert.strictEqual(event.prevented, true);
});

test('the skip link and a hash that matches nothing are left alone', () => {
  const skip = fakeClick('#main-content', { classes: ['skip-link'] });
  reliefAnchorClick(skip);
  assert.strictEqual(skip.prevented, false);
  const bad = fakeClick('#1bad:selector[');
  assert.doesNotThrow(() => reliefAnchorClick(bad));
  assert.strictEqual(bad.prevented, false);
});

test('reliefAnchorClick ignores clicks that are not on an in-page link and clicks already handled', () => {
  assert.doesNotThrow(() => reliefAnchorClick());
  assert.doesNotThrow(() => reliefAnchorClick({}));
  const elsewhere = { target: { closest: () => null }, defaultPrevented: false, preventDefault() { throw new Error('must not be called'); } };
  assert.doesNotThrow(() => reliefAnchorClick(elsewhere));
  const handled = fakeClick('#', { defaultPrevented: true });
  handled.preventDefault = () => { throw new Error('must not be called'); };
  assert.doesNotThrow(() => reliefAnchorClick(handled));
});

test('a deep link is scrolled to once the hidden content is shown', () => {
  const doc = fakeDoc(['contact-form']);
  assert.strictEqual(reliefRestoreHashScroll(doc, { hash: '#contact-form' }, 'navigate'), true);
  assert.deepStrictEqual(doc.els['contact-form'].scrolled, [{ block: 'start', behavior: 'instant' }],
    'instant, so the page style scroll-behavior: smooth does not turn it into an animation');
});

test('a reload or Back/Forward is left to the browser, which restores the earlier position', () => {
  for (const type of ['reload', 'back_forward', 'prerender']) {
    const doc = fakeDoc(['contact-form']);
    assert.strictEqual(reliefRestoreHashScroll(doc, { hash: '#contact-form' }, type), false, type);
    assert.strictEqual(doc.els['contact-form'].scrolled.length, 0, type);
  }
});

test('nothing happens without a hash, with a hash that matches nothing, or with a bad one', () => {
  const doc = fakeDoc(['map']);
  for (const hash of ['', '#', '#missing', '#1bad:sel', '#%E0%A4%A']) {
    assert.doesNotThrow(() => assert.strictEqual(reliefRestoreHashScroll(doc, { hash }, 'navigate'), false), hash);
  }
  assert.strictEqual(doc.els.map.scrolled.length, 0);
  assert.strictEqual(reliefRestoreHashScroll(null, { hash: '#map' }, 'navigate'), false);
  assert.strictEqual(reliefRestoreHashScroll(doc, null, 'navigate'), false);
});

test('without a navigation entry the load counts as a fresh one', () => {
  const doc = fakeDoc(['map']);
  assert.strictEqual(reliefRestoreHashScroll(doc, { hash: '#map' }), true);
});

test('no script subtracts a hand-made offset any more', () => {
  for (const file of ['assets/js/main.js', 'assets/js/about.js', 'assets/js/blog.js']) {
    const source = read(file);
    assert.ok(!/offsetTop\s*-\s*80/.test(source), `${file} must not scroll to offsetTop - 80`);
    assert.ok(!/querySelector\(targetId\)/.test(source), `${file} must not build a selector from an href`);
    assert.ok(!/a\[href\^="#"\]'\)\.forEach/.test(source), `${file} must not attach a click handler to each in-page link`);
  }
  assert.strictEqual((read('assets/js/main.js').match(/reliefAnchorClick/g) || []).length >= 2, true, 'main.js registers the one shared handler');
});

test('the stylesheets of pages with in-page targets keep space above them', () => {
  for (const file of ['assets/css/style.css', 'assets/css/about.css', 'assets/css/ambulances.css', 'assets/css/dashboard.css']) {
    assert.match(read(file), /:target:not\(main\)\s*\{\s*scroll-margin-top:\s*5rem;/, file);
  }
});

test('every in-page link on a page points at an id that exists on that page', () => {
  for (const file of ['index.html', ...fs.readdirSync(path.join(root, 'pages')).filter((f) => f.endsWith('.html')).map((f) => 'pages/' + f)]) {
    const html = read(file);
    const hashes = [...html.matchAll(/<a\b[^>]*\shref="#([^"]+)"/g)].map((m) => m[1]);
    for (const id of hashes) {
      assert.ok(new RegExp(`\\sid="${id}"`).test(html), `${file}: href="#${id}" has no element with that id`);
    }
  }
});
