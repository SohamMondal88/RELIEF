// Mobile navigation state (Issue #191): one close path, resize across the breakpoint, the back/forward
// cache, the closed drawer kept away from keyboard and screen readers, and no scroll lock.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { initMobileNavigation } = require('../assets/js/main.js');

const root = path.join(__dirname, '..');

class FakeElement {
  constructor(tag, opts = {}) {
    this.tag = tag;
    this.attrs = new Map(Object.entries(opts.attrs || {}));
    this.classes = new Set(opts.classes || []);
    this.children = [];
    this.parent = null;
    this.dataset = {};
    this.style = {};
    this.listeners = {};
    this.focused = false;
    this.id = opts.id || '';
    const self = this;
    this.classList = {
      add: (c) => self.classes.add(c),
      remove: (c) => self.classes.delete(c),
      contains: (c) => self.classes.has(c),
      toggle: (c, force) => {
        const on = force === undefined ? !self.classes.has(c) : !!force;
        if (on) self.classes.add(c); else self.classes.delete(c);
        return on;
      }
    };
  }
  append(child) { child.parent = this; this.children.push(child); return child; }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  removeAttribute(name) { this.attrs.delete(name); }
  hasAttribute(name) { return this.attrs.has(name); }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  contains(other) {
    for (let node = other; node; node = node.parent) if (node === this) return true;
    return false;
  }
  closest(selector) {
    const cls = selector.replace(/^\./, '');
    for (let node = this; node; node = node.parent) if (node.classes && node.classes.has(cls)) return node;
    return null;
  }
  querySelector(selector) {
    const cls = selector.replace(/^\./, '');
    const walk = (node) => {
      for (const child of node.children) {
        if (child.classes.has(cls)) return child;
        const hit = walk(child);
        if (hit) return hit;
      }
      return null;
    };
    return walk(this);
  }
  focus() { this.focused = true; }
  fire(type, event = {}) {
    (this.listeners[type] || []).forEach((fn) => fn.call(this, Object.assign({ target: this, preventDefault() { event.defaultPrevented = true; }, stopPropagation() {} }, event)));
  }
}

// A page with the same shape as the real navbar: two .nav-links lists, a Services dropdown, a hamburger.
function buildPage({ width = 375, withMatchMedia = true } = {}) {
  const body = new FakeElement('body');
  const outside = body.append(new FakeElement('main'));
  const hamburger = body.append(new FakeElement('button', { classes: ['hamburger'], attrs: { 'aria-expanded': 'false' } }));
  const navLeft = body.append(new FakeElement('ul', { classes: ['nav-links'], id: 'main-nav-links' }));
  const navRight = body.append(new FakeElement('ul', { classes: ['nav-links'] }));
  const home = navLeft.append(new FakeElement('a', { attrs: { href: 'index.html' } }));
  const dropdown = navLeft.append(new FakeElement('li', { classes: ['dropdown'] }));
  const toggle = dropdown.append(new FakeElement('a', { classes: ['dropdown-toggle'], attrs: { href: '#', 'aria-expanded': 'false' } }));
  const login = navRight.append(new FakeElement('a', { attrs: { href: 'pages/login.html' } }));

  const win = new FakeElement('window');
  win.innerWidth = width;
  win.queries = [];
  if (withMatchMedia) {
    win.matchMedia = (query) => {
      win.queries.push(query);
      const max = Number(/max-width:\s*(\d+)px/.exec(query)[1]);
      return { matches: win.innerWidth <= max };
    };
  }

  const docListeners = new FakeElement('document');
  const doc = {
    defaultView: win,
    body,
    documentElement: new FakeElement('html'),
    addEventListener: (type, fn) => docListeners.addEventListener(type, fn),
    getElementById: (id) => [navLeft, navRight].find((n) => n.id === id) || null,
    querySelector: (selector) => {
      if (selector === '.hamburger') return hamburger;
      if (selector === '.nav-links') return navLeft;
      return null;
    },
    querySelectorAll: (selector) => {
      if (selector === '.nav-links') return [navLeft, navRight];
      if (selector === '.nav-links a') return [home, toggle, login];
      if (selector === '.dropdown-toggle') return [toggle];
      if (selector === '.dropdown.active') return dropdown.classes.has('active') ? [dropdown] : [];
      return [];
    }
  };
  const press = (key) => docListeners.fire('keydown', { key });
  const clickDocument = (target) => docListeners.fire('click', { target });
  // A click on an element reaches its own handlers first and then the document, like in a browser.
  const click = (el) => { el.fire('click'); clickDocument(el); };
  const resizeTo = (w) => { win.innerWidth = w; win.fire('resize'); };
  return { doc, win, body, outside, hamburger, navLeft, navRight, home, dropdown, toggle, login, press, click, clickDocument, resizeTo };
}

const isOpen = (p) => p.hamburger.getAttribute('aria-expanded') === 'true';
const isInert = (nav) => nav.hasAttribute('inert');

test('a closed drawer on a phone is inert, an open one is not', () => {
  const p = buildPage({ width: 375 });
  assert.strictEqual(initMobileNavigation(p.doc), true);
  assert.ok(isInert(p.navLeft) && isInert(p.navRight), 'both lists are out of the Tab order while closed');
  p.click(p.hamburger);
  assert.ok(isOpen(p));
  assert.ok(!isInert(p.navLeft) && !isInert(p.navRight), 'open drawer is reachable');
  p.click(p.hamburger);
  assert.ok(!isOpen(p));
  assert.ok(isInert(p.navLeft) && isInert(p.navRight));
});

test('the desktop navbar is never inert', () => {
  const p = buildPage({ width: 1280 });
  initMobileNavigation(p.doc);
  assert.ok(!isInert(p.navLeft) && !isInert(p.navRight));
});

test('Escape closes the menu and returns focus to the hamburger', () => {
  const p = buildPage();
  initMobileNavigation(p.doc);
  p.click(p.hamburger);
  p.press('Escape');
  assert.ok(!isOpen(p));
  assert.ok(!p.navLeft.classes.has('active') && !p.hamburger.classes.has('active'));
  assert.ok(p.hamburger.focused, 'focus goes back to the hamburger');
  assert.ok(isInert(p.navLeft));
});

test('Escape with the menu closed does nothing', () => {
  const p = buildPage();
  initMobileNavigation(p.doc);
  p.press('Escape');
  assert.strictEqual(p.hamburger.focused, false);
});

test('a click outside closes the menu, a click inside does not', () => {
  const p = buildPage();
  initMobileNavigation(p.doc);
  p.click(p.hamburger);
  p.clickDocument(p.navLeft);
  assert.ok(isOpen(p), 'click inside the drawer keeps it open');
  p.clickDocument(p.outside);
  assert.ok(!isOpen(p));
  assert.ok(isInert(p.navRight));
});

test('choosing a destination closes the menu on a phone but not on desktop', () => {
  const phone = buildPage({ width: 375 });
  initMobileNavigation(phone.doc);
  phone.click(phone.hamburger);
  phone.click(phone.login);
  assert.ok(!isOpen(phone));
  assert.ok(isInert(phone.navLeft));

  const desktop = buildPage({ width: 1280 });
  initMobileNavigation(desktop.doc);
  desktop.hamburger.setAttribute('aria-expanded', 'true');
  desktop.click(desktop.home);
  assert.ok(isOpen(desktop), 'the close-on-link rule is for the drawer only');
});

test('an in-page link outside the menu closes it through the same path: state, both lists and inert', () => {
  const p = buildPage({ width: 375 });
  initMobileNavigation(p.doc);
  p.click(p.hamburger);
  assert.ok(isOpen(p));
  assert.ok(!isInert(p.navLeft) && !isInert(p.navRight));
  // like "Explore Our Journey" (#our-story) on the about page: a link in the page, not in the drawer
  const inPageLink = p.outside.append(new FakeElement('a', { attrs: { href: '#our-story' } }));
  p.click(inPageLink);
  assert.ok(!isOpen(p));
  assert.ok(!p.hamburger.classes.has('active'));
  assert.ok(!p.navLeft.classes.has('active') && !p.navRight.classes.has('active'), 'neither list is left active');
  assert.ok(isInert(p.navLeft) && isInert(p.navRight), 'the closed drawer is inert again');
});

test('only initMobileNavigation changes the menu state, the smooth-scroll handler no longer closes it by hand', () => {
  const source = fs.readFileSync(path.join(root, 'assets/js/main.js'), 'utf8');
  const start = source.indexOf('function initMobileNavigation');
  const end = source.indexOf('\nfunction ', start + 10);
  assert.ok(start > 0 && end > start, 'found initMobileNavigation');
  const outside = source.slice(0, start) + source.slice(end);
  assert.ok(!/\.nav-links\.active/.test(outside), 'no other code reads or clears the open drawer by its class');
  assert.ok(!/menuButton/.test(outside), 'no other code writes the hamburger state');
});

test('the Services toggle opens its sub menu and leaves the drawer open', () => {
  const p = buildPage();
  initMobileNavigation(p.doc);
  p.click(p.hamburger);
  p.click(p.toggle);
  assert.ok(isOpen(p), 'the drawer stays open');
  assert.ok(p.dropdown.classes.has('active'));
  assert.strictEqual(p.toggle.getAttribute('aria-expanded'), 'true');
  p.click(p.hamburger);
  assert.ok(!p.dropdown.classes.has('active'), 'closing the drawer folds the sub menu');
  assert.strictEqual(p.toggle.getAttribute('aria-expanded'), 'false');
});

test('resizing from a phone to a desktop width closes an open menu', () => {
  const p = buildPage({ width: 375 });
  initMobileNavigation(p.doc);
  p.click(p.hamburger);
  p.click(p.toggle);
  p.resizeTo(1280);
  assert.ok(!isOpen(p), 'aria-expanded is back to false');
  assert.ok(!p.hamburger.classes.has('active'));
  assert.ok(!p.navLeft.classes.has('active') && !p.navRight.classes.has('active'));
  assert.ok(!p.dropdown.classes.has('active'));
  assert.ok(!isInert(p.navLeft) && !isInert(p.navRight), 'the desktop links are reachable');
});

test('resizing from desktop back to a phone leaves a closed, inert drawer', () => {
  const p = buildPage({ width: 1280 });
  initMobileNavigation(p.doc);
  p.resizeTo(500);
  assert.ok(!isOpen(p));
  assert.ok(isInert(p.navLeft) && isInert(p.navRight));
  p.click(p.hamburger);
  assert.ok(isOpen(p) && !isInert(p.navLeft));
});

test('a resize that stays on the same side of the breakpoint keeps the menu open', () => {
  const p = buildPage({ width: 375 });
  initMobileNavigation(p.doc);
  p.click(p.hamburger);
  p.resizeTo(420);
  assert.ok(isOpen(p), 'a phone keyboard or rotation within phone widths must not slam the menu shut');
});

test('a page restored from the back/forward cache comes back closed', () => {
  const p = buildPage({ width: 375 });
  initMobileNavigation(p.doc);
  p.click(p.hamburger);
  p.win.fire('pageshow', { persisted: true });
  assert.ok(!isOpen(p));
  assert.ok(!p.navLeft.classes.has('active'));
  assert.ok(isInert(p.navLeft));
});

test('a page restored at a desktop width has no inert navbar', () => {
  const p = buildPage({ width: 375 });
  initMobileNavigation(p.doc);
  p.click(p.hamburger);
  p.win.innerWidth = 1280; // no resize event while the page sat in the cache
  p.win.fire('pageshow', { persisted: true });
  assert.ok(!isOpen(p));
  assert.ok(!isInert(p.navLeft) && !isInert(p.navRight));
});

test('page scrolling is never locked, open or closed', () => {
  const p = buildPage();
  initMobileNavigation(p.doc);
  const locked = () => p.body.style.overflow || p.doc.documentElement.style.overflow || p.body.style.position === 'fixed'
    || [...p.body.classes].some((c) => /lock|no-scroll|modal-open/.test(c));
  p.click(p.hamburger);
  assert.ok(!locked(), 'not locked while open');
  p.press('Escape');
  assert.ok(!locked(), 'not locked after Escape');
  p.click(p.hamburger);
  p.resizeTo(1280);
  assert.ok(!locked(), 'not locked after resizing to desktop');
});

test('without matchMedia the width decides, with the same 992px limit', () => {
  const p = buildPage({ width: 992, withMatchMedia: false });
  initMobileNavigation(p.doc);
  assert.ok(isInert(p.navLeft), '992px is still the drawer layout');
  p.resizeTo(993);
  assert.ok(!isInert(p.navLeft), '993px is the desktop navbar');
});

test('the script asks for the same breakpoint the stylesheets use', () => {
  const p = buildPage();
  initMobileNavigation(p.doc);
  const asked = new Set(p.win.queries);
  assert.deepStrictEqual([...asked], ['(max-width: 992px)']);

  // In each stylesheet the hamburger first appears in an @media (max-width) block. That widest block is the
  // breakpoint of the drawer; the 768px block that follows only widens it.
  const cssDir = path.join(root, 'assets', 'css');
  let checked = 0;
  for (const file of fs.readdirSync(cssDir).filter((f) => f.endsWith('.css'))) {
    const lines = fs.readFileSync(path.join(cssDir, file), 'utf8').split('\n');
    let media = null;
    let widest = 0;
    lines.forEach((line, i) => {
      const m = /@media\s*\(max-width:\s*(\d+)px\)/.exec(line);
      if (m) media = Number(m[1]);
      else if (/^@media/.test(line)) media = null;
      if (media && /^\s*\.hamburger\s*\{/.test(line) && /display:\s*(flex|block)/.test(lines[i + 1] + (lines[i + 2] || ''))) {
        widest = Math.max(widest, media);
      }
    });
    if (widest) {
      checked += 1;
      assert.strictEqual(widest, 992, `${file}: the hamburger must appear at 992px, the width main.js uses`);
    }
  }
  assert.ok(checked >= 10, 'checked the page stylesheets, found ' + checked);
});

test('about.js and ambulances.js no longer carry their own hamburger toggle', () => {
  for (const file of ['assets/js/about.js', 'assets/js/ambulances.js']) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.ok(!/hamburger/.test(source), `${file} leaves the menu to initMobileNavigation in main.js`);
  }
});
