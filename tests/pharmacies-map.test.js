/**
 * pharmacies.js must keep working when the map cannot start (issue #178).
 *
 * node --test tests/pharmacies-map.test.js
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'pharmacies.js'), 'utf8');

function makeElement(tag) {
  return {
    tagName: String(tag).toUpperCase(),
    className: '',
    hidden: false,
    value: '',
    children: [],
    attributes: {},
    listeners: {},
    innerHTML: '',
    textContent: '',
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return name in this.attributes ? this.attributes[name] : null; },
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
    insertBefore(child, ref) {
      child.parentNode = this;
      const at = this.children.indexOf(ref);
      this.children.splice(at === -1 ? this.children.length : at, 0, child);
      return child;
    }
  };
}

function fakePage(options) {
  const opts = options || {};
  const listeners = {};
  const container = makeElement('div');
  const map = makeElement('div');
  map.id = 'map';
  container.appendChild(map);
  const list = makeElement('div');
  const search = makeElement('input');
  const button = makeElement('button');
  const select = makeElement('select');
  const byId = { 'pharmacy-type': makeElement('select'), location: makeElement('select'), services: makeElement('select') };
  if (!opts.noMap) byId.map = map;
  const byQuery = {
    '.pharmacies-list': list,
    '.search-box input': search,
    '.btn-filter': button,
    '.sort-options select': select
  };
  const document = {
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    createElement: makeElement,
    getElementById(id) { return byId[id] || null; },
    querySelector(selector) { return byQuery[selector] || null; },
    querySelectorAll() { return []; }
  };
  return { document, listeners, map, container, list, button };
}

function run(extraGlobals, options) {
  const page = fakePage(options);
  const context = vm.createContext(Object.assign({ document: page.document, window: {} }, extraGlobals));
  vm.runInContext(source, context, { filename: 'pharmacies.js' });
  page.listeners.DOMContentLoaded.forEach((fn) => fn());
  return page;
}

test('without Leaflet the page script does not throw', () => {
  assert.doesNotThrow(() => run({}));
});

test('without Leaflet the pharmacy list is still shown and filtering keeps working', () => {
  const page = run({});
  assert.ok(page.list.children.length > 0, 'pharmacies are listed');
  assert.doesNotThrow(() => page.button.listeners.click.forEach((fn) => fn()));
});

test('without Leaflet the empty map box is replaced by a visible note', () => {
  const page = run({});
  assert.strictEqual(page.map.hidden, true);
  const note = page.container.children.find((el) => el.className === 'map-unavailable');
  assert.ok(note, 'a note is shown in the map container');
  assert.strictEqual(note.getAttribute('role'), 'status');
  assert.match(note.textContent, /map could not be loaded/i);
});

test('a page without a map container does not throw', () => {
  const L = { map() { throw new Error('should not be called'); } };
  assert.doesNotThrow(() => run({ L }, { noMap: true }));
});

test('if Leaflet fails while starting, the page falls back to the note', () => {
  const L = { map() { throw new Error('Map container is already initialized.'); } };
  let page;
  assert.doesNotThrow(() => { page = run({ L }); });
  assert.ok(page.container.children.some((el) => el.className === 'map-unavailable'));
  assert.doesNotThrow(() => page.button.listeners.click.forEach((fn) => fn()));
});

test('with Leaflet the map is built and no note is shown', () => {
  const calls = [];
  const chain = {
    setView() { calls.push('setView'); return chain; },
    addTo() { return chain; },
    bindPopup() { return chain; },
    fitBounds() { calls.push('fitBounds'); },
    removeLayer() {},
    getBounds() { return { pad: () => ({}) }; }
  };
  const L = {
    map(id) { calls.push('map:' + id); return chain; },
    tileLayer() { return chain; },
    marker() { return chain; },
    featureGroup: function () { return chain; }
  };
  const page = run({ L });
  assert.ok(calls.includes('map:map'));
  assert.strictEqual(page.map.hidden, false);
  assert.strictEqual(page.container.children.filter((el) => el.className === 'map-unavailable').length, 0);
});
