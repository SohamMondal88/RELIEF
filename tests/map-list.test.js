/**
 * List alternative for the Leaflet maps (Issue #80).
 *
 * node --test tests/map-list.test.js
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const ML = require('../assets/js/map-list.js');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

// A tiny DOM: elements with children, attributes and listeners.
function el(tag, props) {
  const node = Object.assign({
    tag, id: '', className: '', hidden: false, textContent: '', parentNode: null, children: [], attrs: {}, listeners: {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    removeAttribute(k) { delete this.attrs[k]; },
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    insertBefore(c, ref) { c.parentNode = this; const i = this.children.indexOf(ref); this.children.splice(i === -1 ? this.children.length : i, 0, c); return c; },
    get nextSibling() { const sibs = this.parentNode ? this.parentNode.children : []; return sibs[sibs.indexOf(this) + 1] || null; },
    focus() { this.focused = true; },
    querySelectorAll(selector) {
      // enough for ".class" selectors used here
      const cls = selector.replace(/^\./, '');
      const found = [];
      (function walk(n) { n.children.forEach((c) => { if (c.className.split(' ').includes(cls)) found.push(c); walk(c); }); })(this);
      return found;
    }
  }, props);
  return node;
}
const doc = { createElement: (tag) => el(tag) };

// ---------- names ----------

test('[marker] the label is the name and the place, and survives odd input', () => {
  assert.strictEqual(ML.markerLabel('City Hospital', 'Kalyani'), 'City Hospital, Kalyani');
  assert.strictEqual(ML.markerLabel('  City \n Hospital ', ''), 'City Hospital');
  assert.strictEqual(ML.markerLabel('City Hospital', null), 'City Hospital');
  [undefined, null, '', '   ', 5, {}, []].forEach((name) => assert.strictEqual(ML.markerLabel(name, 'x'), 'Map marker'));
});

test('[marker] the options give the marker a name for screen readers and keep it keyboard focusable', () => {
  assert.deepStrictEqual(ML.markerOptions('City Hospital', 'Kalyani'), { title: 'City Hospital, Kalyani', alt: 'City Hospital, Kalyani', keyboard: true });
});

test('[marker] a marker with an element is announced as a button; one without is left alone', () => {
  const node = el('img');
  ML.decorateMarker({ getElement: () => node });
  assert.strictEqual(node.getAttribute('role'), 'button');
  node.setAttribute('role', 'link');
  ML.decorateMarker({ getElement: () => node });
  assert.strictEqual(node.getAttribute('role'), 'link', 'an existing role is kept');
  assert.doesNotThrow(() => { ML.decorateMarker(null); ML.decorateMarker({}); ML.decorateMarker({ getElement() { throw new Error('x'); } }); });
});

test('[map] the map region says it has the same results as the list', () => {
  assert.match(ML.describeMap('facilities'), /^Map of facilities\./);
  assert.match(ML.describeMap('facilities'), /same results are listed above with their addresses and actions/);
  assert.match(ML.describeMap(''), /^Map of results\./);
});

// ---------- list semantics ----------

function results(n) {
  const list = el('div');
  for (let i = 0; i < n; i++) list.appendChild(el('div', { className: 'card' }));
  return list;
}

test('[list] results become a list of items with a name', () => {
  const list = results(3);
  assert.strictEqual(ML.markList(list, '.card', 'Facilities'), 3);
  assert.strictEqual(list.getAttribute('role'), 'list');
  assert.strictEqual(list.getAttribute('aria-label'), 'Facilities');
  assert.ok(list.children.every((c) => c.getAttribute('role') === 'listitem'));
});

test('[list] with no results the container is not a list, so a message inside it stays valid', () => {
  const list = results(2);
  ML.markList(list, '.card', 'Facilities');
  list.children.length = 0;
  list.appendChild(el('p', { className: 'no-results' }));
  assert.strictEqual(ML.markList(list, '.card', 'Facilities'), 0);
  assert.strictEqual(list.getAttribute('role'), null);
  assert.strictEqual(list.getAttribute('aria-label'), null);
});

test('[list] only direct children count, so a card inside a card is not a second item', () => {
  const list = results(1);
  list.children[0].appendChild(el('div', { className: 'card' }));
  assert.strictEqual(ML.markList(list, '.card', 'x'), 1);
});

test('[list] a missing container or label does not throw', () => {
  assert.strictEqual(ML.markList(null, '.card', 'x'), 0);
  const list = results(1);
  ML.markList(list, '.card');
  assert.strictEqual(list.getAttribute('aria-label'), 'Results');
});

// ---------- the map element ----------

function mapBox() {
  const parent = el('div', { className: 'map-container' });
  const map = el('div', { id: 'map' });
  parent.appendChild(map);
  return { parent, map };
}

test('[prepare] names the map, adds the note, a skip link before it and a landing spot after it', () => {
  const { parent, map } = mapBox();
  const refs = ML.prepare(doc, map, { noun: 'pharmacies' });
  assert.strictEqual(map.getAttribute('role'), 'region');
  assert.match(map.getAttribute('aria-label'), /^Map of pharmacies\./);
  assert.deepStrictEqual(parent.children.map((c) => c.className || c.id), ['map-note', 'map-skip-link', 'map', 'map-end']);
  assert.strictEqual(refs.note.getAttribute('role'), 'status');
  assert.strictEqual(refs.note.textContent, ML.NOTE_MAP_OK);
  assert.strictEqual(refs.skip.href, '#map-end');
  assert.strictEqual(refs.skip.textContent, 'Skip the map');
  assert.strictEqual(refs.end.getAttribute('tabindex'), '-1');
});

test('[prepare] activating the skip link moves focus past the map', () => {
  const { map } = mapBox();
  const refs = ML.prepare(doc, map, {});
  let prevented = false;
  refs.skip.listeners.click[0]({ preventDefault() { prevented = true; } });
  assert.strictEqual(prevented, true);
  assert.strictEqual(refs.end.focused, true);
});

test('[prepare] without a map element or a parent it does nothing', () => {
  assert.strictEqual(ML.prepare(doc, null, {}), null);
  assert.strictEqual(ML.prepare(doc, el('div'), {}), null);
  assert.strictEqual(ML.prepare(null, el('div'), {}), null);
});

test('[tiles] a failed tile changes the note once and keeps the map; a missing library hides the map and says so', () => {
  const { map } = mapBox();
  const refs = ML.prepare(doc, map, {});
  const handlers = {};
  const layer = { on(type, fn) { handlers[type] = fn; } };
  let calls = 0;
  ML.watchTiles(layer, () => { calls += 1; ML.tilesFailed(refs); });
  handlers.tileerror(); handlers.tileerror(); handlers.tileerror();
  assert.strictEqual(calls, 1, 'reported once');
  assert.strictEqual(refs.note.textContent, ML.NOTE_TILES_FAILED);
  assert.match(ML.NOTE_TILES_FAILED, /list above still has every result/);
  assert.strictEqual(map.hidden, false);

  ML.mapMissing(refs, map);
  assert.strictEqual(refs.note.textContent, ML.NOTE_NO_MAP);
  assert.strictEqual(map.hidden, true);
  assert.strictEqual(refs.skip.hidden, true);
});

test('[tiles] odd layers and missing refs do not throw', () => {
  assert.doesNotThrow(() => { ML.watchTiles(null, () => {}); ML.watchTiles({}, () => {}); ML.tilesFailed(null); ML.mapMissing(null, null); });
});

// ---------- the three pages ----------

const PAGES = [
  { page: 'hospitals', script: 'hospitals.js', list: 'hospitalsList', card: '.hospital-card' },
  { page: 'pharmacies', script: 'pharmacies.js', list: 'pharmaciesList', card: '.pharmacy-card' },
  { page: 'ambulances', script: 'ambulances.js', list: 'ambulanceList', card: '.ambulance-item' }
];

PAGES.forEach(({ page, script, list, card }) => {
  test(`[${page}] loads the helper and its styles before the page script`, () => {
    const html = read('pages', page + '.html');
    assert.ok(html.indexOf('map-list.js') !== -1 && html.indexOf('map-list.js') < html.indexOf(script));
    assert.match(html, /assets\/css\/map-list\.css/);
  });

  test(`[${page}] marks its results as a list, names its markers and watches the tiles`, () => {
    const js = read('assets', 'js', script);
    assert.ok(js.includes(`ML.markList(${list}, '${card}'`), 'list semantics');
    assert.match(js, /ML\.markerOptions\(/);
    assert.match(js, /ML\.decorateMarker\(marker\)/);
    assert.match(js, /ML\.watchTiles\(tiles/);
    assert.match(js, /ML\.prepare\(document, /);
  });
});

test('[pharmacies] works without the map library: no call to L before it is checked', () => {
  const js = read('assets', 'js', 'pharmacies.js');
  const init = js.slice(js.indexOf('function initMap'), js.indexOf('function updateMapMarkers'));
  assert.ok(init.indexOf("typeof L === 'undefined'") !== -1 && init.indexOf("typeof L === 'undefined'") < init.indexOf('L.map('));
  assert.match(js, /function updateMapMarkers[^{]*\{\s*if \(!map\) return;/);
  assert.match(js, /function setUserMarker[^{]*\{\s*if \(!map\) return;/);
});

test('[hospitals] the fallback text points at the list above the map, not below it', () => {
  const js = read('assets', 'js', 'hospitals.js');
  assert.ok(!/list below/.test(js));
  assert.match(ML.NOTE_NO_MAP, /list above/);
});

test('[cards] actions name the facility they belong to, and icons are hidden from screen readers', () => {
  const pharm = read('assets', 'js', 'pharmacies.js');
  assert.match(pharm, /aria-label="Call \$\{pharmacy\.name\}"/);
  assert.match(pharm, /aria-label="Request delivery from \$\{pharmacy\.name\}"/);
  const amb = read('assets', 'js', 'ambulances.js');
  assert.match(amb, /aria-label="Call \$\{ambulance\.name\}"/);
  assert.match(amb, /aria-label="Directions to \$\{ambulance\.name\}"/);
  const hosp = read('assets', 'js', 'hospitals.js');
  assert.match(hosp, /aria-label="Directions to ' \+ U\.escapeHtml\(f\.name\)/);
  [pharm, amb].forEach((js) => {
    const icons = js.match(/<i class="fas [^"]+"[^>]*>/g) || [];
    icons.filter((i) => !/aria-hidden="true"/.test(i)).forEach((i) => assert.fail('icon without aria-hidden: ' + i));
  });
});

test('[offline] the helper and its styles are saved for the offline hospitals page', () => {
  const sw = read('sw.js');
  assert.match(sw, /'assets\/js\/map-list\.js'/);
  assert.match(sw, /'assets\/css\/map-list\.css'/);
});

test('[doctors] the doctors page has no map, so it has nothing to add', () => {
  assert.ok(!/L\.map\(|id="map"/.test(read('pages', 'doctors.html') + read('assets', 'js', 'doctors.js')));
});
