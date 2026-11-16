/**
 * Tests for saved facilities (Issue #54): persistence, duplicates, failures, facilities that are gone,
 * and what is (and is not) written to storage.
 *
 * node --test tests/saved-facilities.test.js
 */
const test = require('node:test');
const assert = require('node:assert');
const S = require('../assets/js/saved-facilities.js');
const U = require('../assets/js/facility-utils.js');
const Schema = require('../assets/js/storage-schema.js');
const fx = require('./helpers/provider-fixtures');

// A storage object like localStorage. `fail` makes reads or writes throw, the way a blocked or full one does.
function makeStore(initial, fail) {
  const data = new Map(Object.entries(initial || {}));
  const mode = fail || {};
  return {
    data,
    getItem(k) { if (mode.read) throw new Error('SecurityError'); return data.has(k) ? data.get(k) : null; },
    setItem(k, v) { if (mode.write) { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; } data.set(k, String(v)); },
    removeItem(k) { data.delete(k); }
  };
}

const [A, B] = U.normalizeFacilities(fx.hospitals);
const stored = (store) => JSON.parse(store.data.get(S.KEY));
const NOW = 1700000000000;

test('saving keeps the facility, and it is still there when the list is read again (persistence)', () => {
  const store = makeStore();
  const result = S.toggle(store, A, NOW);
  assert.deepStrictEqual([result.ok, result.saved], [true, true]);
  const again = S.read(makeStore({ [S.KEY]: store.data.get(S.KEY) }));
  assert.strictEqual(again.items.length, 1);
  assert.strictEqual(again.items[0].id, A.id);
  assert.strictEqual(again.items[0].name, A.name);
  assert.strictEqual(again.items[0].savedAt, NOW);
});

test('pressing Save twice removes it, it never makes a duplicate', () => {
  const store = makeStore();
  S.toggle(store, A);
  S.toggle(store, B);
  assert.strictEqual(stored(store).length, 2);
  const second = S.toggle(store, A);
  assert.deepStrictEqual([second.ok, second.saved], [true, false]);
  assert.deepStrictEqual(stored(store).map((i) => i.id), [B.id]);
});

test('a list that already holds the same facility twice shows it once, keeping the first, and counts the extra', () => {
  const twice = JSON.stringify([
    { id: 'x1', name: 'First copy', location: 'Kolkata', savedAt: 1 },
    { id: 'x2', name: 'Other', savedAt: 2 },
    { id: 'x1', name: 'Second copy', savedAt: 3 },
    { id: 1, name: 'Numeric id' },
    { id: '1', name: 'Same id as text' }
  ]);
  const result = S.read(makeStore({ [S.KEY]: twice }));
  assert.deepStrictEqual(result.items.map((i) => i.name), ['First copy', 'Other', 'Numeric id']);
  assert.strictEqual(result.dropped, 2);
});

test('ids that match built-in object names (constructor, toString, __proto__) are kept, saved and removed like any other', () => {
  const store = makeStore();
  for (const id of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    const saved = S.toggle(store, { id, name: 'Facility ' + id }, NOW);
    assert.deepStrictEqual([saved.ok, saved.saved], [true, true], id);
    const listed = S.read(store);
    assert.ok(listed.items.some((i) => i.id === id), id + ' should be listed after saving');
    assert.strictEqual(listed.dropped, 0, id);
  }
  assert.strictEqual(S.read(store).items.length, 4);
  const removed = S.toggle(store, { id: 'constructor', name: 'Facility constructor' }, NOW);
  assert.deepStrictEqual([removed.ok, removed.saved], [true, false]);
  assert.deepStrictEqual(S.read(store).items.map((i) => i.id), ['toString', '__proto__', 'hasOwnProperty']);
});

test('reconcile: a saved id like "constructor" that the directory does not have is missing, not listed', () => {
  const rows = S.reconcile([{ id: 'constructor', name: 'Gone' }, { id: 'toString', name: 'Here' }], [{ id: 'toString', name: 'Here' }]);
  assert.deepStrictEqual(rows.map((r) => r.status), ['missing', 'listed']);
});

test('toggle on a list with a repeat removes every copy of that facility', () => {
  const store = makeStore({ [S.KEY]: JSON.stringify([{ id: 'x1', name: 'One' }, { id: 'x1', name: 'One again' }, { id: 'x2', name: 'Two' }]) });
  assert.strictEqual(S.toggle(store, { id: 'x1', name: 'One' }).saved, false);
  assert.deepStrictEqual(stored(store).map((i) => i.id), ['x2']);
});

test('broken entries are dropped and counted, good ones stay', () => {
  const list = [
    { id: 'ok', name: 'Fine', lat: 22.5, lng: 88.3, phone: '+91 33 0000 0000' },
    null, 'text', 7, [], { name: 'no id' }, { id: 'noname' }, { id: 'blank', name: '   ' }, { id: {}, name: 'object id' }
  ];
  const result = S.read(makeStore({ [S.KEY]: JSON.stringify(list) }));
  assert.deepStrictEqual(result.items.map((i) => i.id), ['ok']);
  assert.strictEqual(result.dropped, 8);
  assert.strictEqual(result.unreadable, false);
});

test('bad coordinates in a saved entry are read as no position, not as a place', () => {
  const list = [
    { id: 'a', name: 'A', lat: 'x', lng: 1 }, { id: 'b', name: 'B', lat: 95, lng: 1 }, { id: 'c', name: 'C', lat: 0, lng: 0 },
    { id: 'd', name: 'D', lat: NaN, lng: 1 }, { id: 'e', name: 'E', lat: 22.5, lng: 88.3 }
  ];
  const items = S.read(makeStore({ [S.KEY]: JSON.stringify(list) })).items;
  assert.deepStrictEqual(items.map((i) => [i.lat, i.lng]), [[null, null], [null, null], [null, null], [null, null], [22.5, 88.3]]);
});

test('unreadable stored text gives an empty list, is reported, and is not overwritten by a read', () => {
  ['{not json', '"just text"', '{"a":1}', '42'].forEach((bad) => {
    const store = makeStore({ [S.KEY]: bad });
    const result = S.read(store);
    assert.deepStrictEqual([result.items, result.unreadable, result.unavailable], [[], true, false], bad);
    assert.strictEqual(store.data.get(S.KEY), bad, 'a read does not touch it');
  });
  // saving after that starts a fresh list
  const store = makeStore({ [S.KEY]: '{not json' });
  assert.strictEqual(S.toggle(store, A).ok, true);
  assert.deepStrictEqual(stored(store).map((i) => i.id), [A.id]);
});

test('failure: when storage refuses the write, nothing changes and the result says so', () => {
  const store = makeStore({ [S.KEY]: JSON.stringify([{ id: 'keep', name: 'Keep me' }]) }, { write: true });
  const saved = S.toggle(store, A);
  assert.deepStrictEqual([saved.ok, saved.saved, saved.reason], [false, false, 'storage']);
  assert.deepStrictEqual(saved.items.map((i) => i.id), ['keep']);
  assert.deepStrictEqual(stored(store).map((i) => i.id), ['keep']);
  const removed = S.remove(store, 'keep');
  assert.deepStrictEqual([removed.ok, removed.reason], [false, 'storage']);
  assert.deepStrictEqual(stored(store).map((i) => i.id), ['keep']);
});

test('failure: a failed removal reports the facility as still saved', () => {
  const store = makeStore({ [S.KEY]: JSON.stringify([{ id: 'keep', name: 'Keep me' }]) }, { write: true });
  const result = S.toggle(store, { id: 'keep', name: 'Keep me' });
  assert.deepStrictEqual([result.ok, result.saved], [false, true]);
});

test('failure: storage that cannot even be read is reported as unavailable and nothing is written', () => {
  const store = makeStore({}, { read: true });
  assert.deepStrictEqual(S.read(store), { items: [], dropped: 0, unreadable: false, unavailable: true });
  const result = S.toggle(store, A);
  assert.deepStrictEqual([result.ok, result.reason], [false, 'storage']);
  assert.strictEqual(store.data.size, 0);
  assert.strictEqual(S.remove(store, 'x').ok, false);
});

test('toggle refuses something that is not a facility', () => {
  const store = makeStore();
  [null, undefined, {}, { id: 'a' }, { name: 'no id' }, { id: {}, name: 'x' }, { id: 'a', name: ' ' }].forEach((bad) => {
    assert.strictEqual(S.toggle(store, bad).ok, false, JSON.stringify(bad));
  });
  assert.strictEqual(store.data.size, 0);
});

test('privacy: only the facility\'s own details are stored, never a distance or the visitor\'s position', () => {
  const withDistance = Object.assign({}, A, { distanceKm: 3.2, userLocation: { lat: 22.1, lng: 88.1 }, origin: [22.1, 88.1] });
  const copy = S.snapshot(withDistance, NOW);
  assert.deepStrictEqual(Object.keys(copy).sort(), ['id', 'lat', 'lng', 'location', 'name', 'phone', 'savedAt'].sort());
  const store = makeStore();
  S.toggle(store, withDistance, NOW);
  const text = store.data.get(S.KEY);
  assert.ok(!/distanceKm|userLocation|origin|22\.1|88\.1/.test(text), text);
  assert.strictEqual(copy.lat, A.lat);
  assert.strictEqual(copy.lng, A.lng);
});

test('the stored copy uses the address, then the area, then nothing', () => {
  assert.strictEqual(S.snapshot({ id: 1, name: 'N', address: '1 Main Rd', district: 'Kolkata' }).location, '1 Main Rd');
  assert.strictEqual(S.snapshot({ id: 1, name: 'N', district: 'Kolkata' }).location, 'Kolkata');
  assert.strictEqual(S.snapshot({ id: 1, name: 'N' }).location, '');
  assert.strictEqual(S.snapshot({ id: 1, name: 'N', lat: 95, lng: 1 }).lat, null);
});

test('reconcile: a saved facility that is gone from the directory is marked missing, never dropped', () => {
  const items = [{ id: A.id, name: A.name }, { id: 'deleted-9', name: 'Gone Hospital' }];
  const rows = S.reconcile(items, [A, B]);
  assert.deepStrictEqual(rows.map((r) => r.status), ['listed', 'missing']);
  assert.strictEqual(rows[0].current, A);
  assert.strictEqual(rows[1].item.name, 'Gone Hospital');
  assert.strictEqual(rows.length, 2);
});

test('reconcile: with no directory (offline or not loaded) nothing is called missing', () => {
  const items = [{ id: A.id, name: A.name }, { id: 'deleted-9', name: 'Gone Hospital' }];
  [null, undefined, 'x', {}].forEach((none) => {
    assert.deepStrictEqual(S.reconcile(items, none).map((r) => r.status), ['unchecked', 'unchecked']);
  });
  assert.deepStrictEqual(S.reconcile(items, []).map((r) => r.status), ['missing', 'missing'], 'a loaded but empty directory is a real answer');
  assert.deepStrictEqual(S.reconcile([], [A]), []);
});

test('reconcile matches ids as text, so a number and its text are the same facility', () => {
  assert.strictEqual(S.reconcile([{ id: 7, name: 'Seven' }], [{ id: '7', name: 'Seven' }])[0].status, 'listed');
});

test('syncNotes: always says the list is on this device only and not synced, signed in or out', () => {
  const out = S.syncNotes({ signedIn: false, online: true }).join(' ');
  const inn = S.syncNotes({ signedIn: true, online: true }).join(' ');
  assert.match(out, /not signed in/);
  assert.match(out, /do not need an account/);
  assert.match(inn, /signed in, but saved facilities are not synced to your account/);
  [out, inn].forEach((text) => {
    assert.match(text, /this device only/);
    assert.match(text, /not copied to your other devices/);
    assert.doesNotMatch(text, /\bsynced across\b|sign in to sync|backed up/i);
  });
});

test('syncNotes: offline and blocked-storage warnings appear only when they apply', () => {
  assert.doesNotMatch(S.syncNotes({ online: true }).join(' '), /offline/i);
  assert.match(S.syncNotes({ online: false }).join(' '), /You are offline.*may be out of date/);
  assert.doesNotMatch(S.syncNotes({}).join(' '), /offline|blocked/i);
  assert.match(S.syncNotes({ unavailable: true }).join(' '), /storage is blocked.*nothing you save will be kept/);
});

test('a saved list this module wrote passes the storage migration unchanged (the two agree on the format)', () => {
  const store = makeStore();
  S.toggle(store, A, NOW);
  S.toggle(store, B, NOW);
  const before = store.data.get(S.KEY);
  const report = Schema.migrate(store);
  assert.ok(report && report.status !== undefined);
  assert.deepStrictEqual(JSON.parse(store.data.get(S.KEY)).map((i) => i.id), JSON.parse(before).map((i) => i.id));
  assert.strictEqual(S.read(store).items.length, 2);
});
