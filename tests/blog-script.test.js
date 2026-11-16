// blog.js runs on pages/blog.html, which has no .mobile-menu-btn or .mobile-menu (the nav uses .hamburger).
// These tests run the real script against a small fake DOM so a missing optional element cannot stop the rest (Issue #193).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'blog.js'), 'utf8');

function fakeElement(extra) {
  const classes = new Set();
  return Object.assign({
    listeners: {},
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name)
    },
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    getBoundingClientRect: () => ({ top: 10 }),
    offsetLeft: 0,
    scrollLeft: 0
  }, extra);
}

// `present` maps a selector to the element a page would return for it. Everything else is missing.
function loadBlog(present = {}, lists = {}) {
  const documentListeners = {};
  const windowListeners = {};
  const alerts = [];
  const document = {
    addEventListener: (type, fn) => { (documentListeners[type] = documentListeners[type] || []).push(fn); },
    querySelector: (selector) => present[selector] || null,
    querySelectorAll: (selector) => lists[selector] || []
  };
  const window = {
    scrollY: 0,
    innerHeight: 800,
    scrollTo: () => {},
    matchMedia: () => ({ matches: false }),
    addEventListener: (type, fn) => { (windowListeners[type] = windowListeners[type] || []).push(fn); }
  };
  vm.runInNewContext(source, { document, window, alert: (message) => alerts.push(message), console });
  return {
    alerts,
    window,
    windowListeners,
    // the file registers more than one DOMContentLoaded handler, like the browser runs them all in order
    ready: () => documentListeners.DOMContentLoaded.forEach((fn) => fn())
  };
}

test('blog.js starts without a mobile menu on the page', () => {
  const blog = loadBlog();
  assert.doesNotThrow(() => blog.ready());
});

test('the navbar gets its scrolled class even though the mobile menu is missing', () => {
  const navbar = fakeElement();
  const blog = loadBlog({ '.navbar': navbar });
  blog.ready();
  blog.window.scrollY = 120;
  blog.windowListeners.scroll.forEach((fn) => fn());
  assert.ok(navbar.classList.contains('scrolled'));
  blog.window.scrollY = 0;
  blog.windowListeners.scroll.forEach((fn) => fn());
  assert.ok(!navbar.classList.contains('scrolled'));
});

test('scroll handlers do not throw on a page with no navbar', () => {
  const card = fakeElement();
  const blog = loadBlog({}, { '.alert-card, .article-card, .topic-card, .news-card': [card] });
  blog.ready();
  assert.doesNotThrow(() => blog.windowListeners.scroll.forEach((fn) => fn()));
  assert.ok(card.classList.contains('animate'), 'cards still animate in');
});

test('article cards still get the touch hover effect', () => {
  const card = fakeElement();
  const blog = loadBlog({}, { '.article-card, .topic-card, .news-card': [card] });
  blog.ready();
  card.listeners.touchstart[0].call(card);
  assert.ok(card.classList.contains('hover-effect'));
  card.listeners.touchend[0].call(card);
  assert.ok(!card.classList.contains('hover-effect'));
});

test('the alert slider is wired up when it exists', () => {
  const slider = fakeElement();
  const blog = loadBlog({ '.alert-slider': slider });
  blog.ready();
  assert.deepStrictEqual(Object.keys(slider.listeners).sort(), ['mousedown', 'mouseleave', 'mousemove', 'mouseup']);
});

test('a newsletter form or search bar missing its input or button is skipped, not a crash', () => {
  const emptyForm = fakeElement({ querySelector: () => null });
  const emptyBar = fakeElement({ querySelector: () => null });
  const blog = loadBlog({ '.newsletter-form': emptyForm, '.search-bar': emptyBar });
  assert.doesNotThrow(() => blog.ready());
});

test('the newsletter and search controls still work when present', () => {
  const input = fakeElement({ value: '' });
  const button = fakeElement();
  const form = fakeElement({ querySelector: (s) => (s === 'input' ? input : button) });
  const searchInput = fakeElement({ value: '' });
  const searchButton = fakeElement();
  const bar = fakeElement({ querySelector: (s) => (s === 'input' ? searchInput : searchButton) });
  const blog = loadBlog({ '.newsletter-form': form, '.search-bar': bar });
  blog.ready();

  button.listeners.click[0]({ preventDefault() {} });
  assert.deepStrictEqual(blog.alerts, ['Please enter a valid email address']);
  input.value = 'a@b.co';
  button.listeners.click[0]({ preventDefault() {} });
  assert.match(blog.alerts[1], /Thank you for subscribing with a@b\.co/);
  assert.strictEqual(input.value, '');

  searchButton.listeners.click[0]();
  assert.strictEqual(blog.alerts[2], 'Please enter a search term');
});

test('an error that is not about a missing element is not swallowed', () => {
  const blog = loadBlog({ '.navbar': fakeElement() });
  blog.window.addEventListener = () => { throw new Error('real bug'); };
  assert.throws(() => blog.ready(), /real bug/);
});
