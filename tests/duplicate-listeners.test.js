// Regression tests for #192: one user action must reach exactly one handler, and running an init twice
// must not stack a second copy of a listener.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

// A target that keeps its listeners the way the DOM does: the same function added twice for the same
// event counts once, a different function counts again.
function target(props = {}) {
    const listeners = {};
    const classes = new Set();
    return Object.assign({
        dataset: {},
        listeners,
        attrs: {},
        style: {},
        addEventListener(type, fn) {
            const list = listeners[type] || (listeners[type] = []);
            if (!list.includes(fn)) list.push(fn);
        },
        removeEventListener(type, fn) {
            if (listeners[type]) listeners[type] = listeners[type].filter((item) => item !== fn);
        },
        count(type) { return (listeners[type] || []).length; },
        setAttribute(name, value) { this.attrs[name] = String(value); },
        getAttribute(name) { return name in this.attrs ? this.attrs[name] : null; },
        removeAttribute(name) { delete this.attrs[name]; },
        classList: {
            add: (name) => classes.add(name),
            remove: (name) => classes.delete(name),
            toggle: (name, force) => {
                const on = force === undefined ? !classes.has(name) : force;
                if (on) classes.add(name); else classes.delete(name);
                return on;
            },
            contains: (name) => classes.has(name)
        },
        contains() { return false; },
        focus() {},
        appendChild(child) { return child; },
        querySelector() { return null; },
        querySelectorAll() { return []; }
    }, props);
}

// A page with a login form, the shared header and nothing else. DOMContentLoaded callbacks are collected so a
// test can fire them as often as it likes.
function buildPage({ withForms = [], withHamburger = false } = {}) {
    const forms = {};
    withForms.forEach((id) => { forms[id] = target({ id, elements: {} }); });
    const hamburger = withHamburger ? target({ className: 'hamburger' }) : null;
    const nav = withHamburger ? target({ id: 'main-nav-links' }) : null;
    const ready = [];
    const document = target({
        body: target(),
        head: target(),
        createElement: () => target(),
        getElementById: (id) => forms[id] || (id === 'main-nav-links' ? nav : null),
        querySelector: (selector) => (selector === '.hamburger' ? hamburger : null),
        querySelectorAll: (selector) => {
            if (selector === '.nav-links') return nav ? [nav] : [];
            if (selector === '#login-form input' || selector === '#signup-form input') return [];
            return [];
        }
    });
    const origAdd = document.addEventListener;
    document.addEventListener = function (type, fn) {
        if (type === 'DOMContentLoaded') ready.push(fn);
        origAdd.call(document, type, fn);
    };
    const window = target({ scrollY: 0, innerWidth: 1200, matchMedia: () => ({ matches: false, addEventListener() {} }) });
    window.ReliefAuth = { showDemoNotice() {} };
    const context = vm.createContext({ window, document, console });
    const load = (file) => vm.runInContext(read(file), context, { filename: file });
    const fireReady = () => ready.slice().forEach((fn) => fn());
    return { forms, hamburger, nav, document, window, load, fireReady };
}

test('main.js adds no submit listener of its own to the login and signup forms', () => {
    const page = buildPage({ withForms: ['login-form', 'signup-form', 'symptoms-form'] });
    page.load('assets/js/main.js');
    page.fireReady();
    for (const id of ['login-form', 'signup-form', 'symptoms-form']) {
        assert.equal(page.forms[id].count('submit'), 0, id + ' got a submit listener from main.js');
    }
});

test('the login page ends up with exactly one submit listener on the form', () => {
    const page = buildPage({ withForms: ['login-form'] });
    page.load('assets/js/main.js');
    page.load('assets/js/login.js');
    page.fireReady();
    assert.equal(page.forms['login-form'].count('submit'), 1);
});

test('the signup page ends up with exactly one submit listener on the form', () => {
    const page = buildPage({ withForms: ['signup-form'] });
    page.load('assets/js/main.js');
    page.load('assets/js/signup.js');
    page.fireReady();
    assert.equal(page.forms['signup-form'].count('submit'), 1);
});

test('the symptom checker form keeps one listener that stops a plain post', () => {
    const page = buildPage({ withForms: ['symptoms-form'] });
    page.load('assets/js/main.js');
    page.load('assets/js/symptoms.js');
    page.fireReady();
    const form = page.forms['symptoms-form'];
    assert.equal(form.count('submit'), 1);
    let prevented = false;
    form.listeners.submit[0]({ preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
});

test('initMobileNavigation twice leaves one handler per event and element', () => {
    const { initMobileNavigation } = require('../assets/js/main.js');
    const hamburger = target();
    const nav = target({ id: 'main-nav-links' });
    const link = target();
    const dropdownToggle = target();
    const doc = target({
        getElementById: (id) => (id === 'main-nav-links' ? nav : null),
        querySelector: (selector) => (selector === '.hamburger' ? hamburger : selector === '.nav-links' ? nav : null),
        querySelectorAll: (selector) => {
            if (selector === '.nav-links') return [nav];
            if (selector === '.nav-links a') return [link];
            if (selector === '.dropdown-toggle') return [dropdownToggle];
            return [];
        }
    });
    assert.equal(initMobileNavigation(doc), true);
    assert.equal(initMobileNavigation(doc), false, 'the second call must do nothing');
    assert.equal(hamburger.count('click'), 1);
    assert.equal(doc.count('keydown'), 1);
    assert.equal(link.count('click'), 1);
    assert.equal(dropdownToggle.count('click'), 1);
});

test('no page script attaches its own hamburger handler next to initMobileNavigation', () => {
    // A second handler only stays quiet because main.js happens to run first. Swap the order and the menu
    // opens and closes in the same click.
    const offenders = fs.readdirSync(path.join(root, 'assets', 'js'))
        .filter((file) => file.endsWith('.js') && file !== 'main.js' && file !== 'i18n.js')
        .filter((file) => /navInitialized|querySelector\(['"]\.hamburger['"]\)/.test(read('assets/js/' + file)));
    assert.deepEqual(offenders, []);
});

test('no page includes the same script twice', () => {
    const pages = ['index.html', '404.html']
        .concat(fs.readdirSync(path.join(root, 'pages')).map((file) => 'pages/' + file))
        .concat(['ambulance', 'doctor', 'patient', 'pharmacy'].map((kind) => `profiles/${kind}/${kind}.html`));
    for (const page of pages) {
        if (!fs.existsSync(path.join(root, page))) continue;
        const srcs = [...read(page).matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1].split('?')[0]);
        const dupes = srcs.filter((src, i) => srcs.indexOf(src) !== i);
        assert.deepEqual(dupes, [], page + ' includes a script more than once');
    }
});
