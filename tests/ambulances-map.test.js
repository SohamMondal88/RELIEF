/**
 * ambulances.js must keep working when the Leaflet CDN script did not load (issue #75).
 *
 * node --test tests/ambulances-map.test.js
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'ambulances.js'), 'utf8');

// Just enough DOM for ambulances.js, with a record of what the script did.
function fakePage() {
  const listeners = {};
  const created = [];
  const makeElement = (tag) => {
    const el = {
      tagName: String(tag).toUpperCase(),
      className: '',
      hidden: false,
      children: [],
      attributes: {},
      listeners: {},
      _html: '',
      get innerHTML() { return this._html; },
      set innerHTML(value) { this._html = value; if (value === '') this.children = []; },
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
    return el;
  };

  const container = makeElement('div');
  const map = makeElement('div');
  map.id = 'map';
  container.appendChild(map);
  const list = makeElement('div');
  const call911 = makeElement('button');
  const request = makeElement('button');

  const document = {
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    createElement(tag) { const el = makeElement(tag); created.push(el); return el; },
    getElementById(id) { return id === 'map' ? map : null; },
    querySelector(selector) {
      return { '.ambulance-list': list, '.btn-call-911': call911, '.btn-request': request }[selector] || null;
    },
    querySelectorAll() { return []; }
  };
  return { document, listeners, map, container, list, created };
}

function run(extraGlobals) {
  const page = fakePage();
  const context = vm.createContext(Object.assign({ document: page.document, window: {} }, extraGlobals));
  vm.runInContext(source, context, { filename: 'ambulances.js' });
  // Fire DOMContentLoaded for every script listener, like the browser does.
  page.listeners.DOMContentLoaded.forEach((fn) => fn());
  return page;
}

test('without Leaflet the page script does not throw', () => {
  assert.doesNotThrow(() => run({}));
});

test('without Leaflet the ambulance list is still shown', () => {
  const page = run({});
  assert.ok(page.list.children.length === 4, 'all four ambulance services are listed');
});

test('without Leaflet the empty map box is replaced by a visible note', () => {
  const page = run({});
  assert.strictEqual(page.map.hidden, true, 'the empty map box is hidden');
  const note = page.container.children.find((el) => el.className === 'map-unavailable');
  assert.ok(note, 'a note is shown in the map container');
  assert.strictEqual(note.getAttribute('role'), 'status');
  assert.match(note.textContent, /map could not be loaded/i);
  assert.ok(page.container.children.indexOf(note) < page.container.children.indexOf(page.map), 'the note sits where the map would be');
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
    icon() { return {}; },
    marker() { return chain; },
    featureGroup() { return chain; }
  };
  const page = run({ L });
  assert.ok(calls.includes('map:map'), 'L.map was called for #map');
  assert.strictEqual(page.map.hidden, false);
  assert.strictEqual(page.container.children.filter((el) => el.className === 'map-unavailable').length, 0);
});
