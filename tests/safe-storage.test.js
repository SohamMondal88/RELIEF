/**
 * Issue #168: malformed, missing, blocked or full browser storage must not break a page.
 *
 * Covers the safe-storage helper (corrupt JSON, wrong types, legacy values, a localStorage that
 * throws when read, quota errors), the session list in main.js, the places that read
 * localStorage by name, and the wiring of the new script into the pages.
 *
 * Run: node --test tests/safe-storage.test.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const S = require('../assets/js/safe-storage.js');
const R = require('../assets/js/reminders.js');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
// the file without its // comments, for checks on what the code does
const code = (rel) => read(rel).replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');

function memoryStorage(initial, opts) {
  const o = opts || {};
  const data = new Map(Object.entries(initial || {}));
  return {
    data,
    get length() { return data.size; },
    key(i) { return Array.from(data.keys())[i] || null; },
    getItem(key) {
      if (o.failRead) throw new DOMException('blocked', 'SecurityError');
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      if (o.quota) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      data.set(key, String(value));
    },
    removeItem(key) {
      if (o.failRemove) throw new DOMException('blocked', 'SecurityError');
      data.delete(key);
    }
  };
}

const blockedWindow = () => Object.defineProperty({}, 'localStorage', {
  get() { throw new DOMException('The operation is insecure.', 'SecurityError'); }
});

// ---------------------------------------------------------------------------
// getStorage
// ---------------------------------------------------------------------------

test('getStorage returns the storage, or null when reading window.localStorage throws', () => {
  const storage = memoryStorage();
  assert.strictEqual(S.getStorage({ localStorage: storage }), storage);
  assert.strictEqual(S.getStorage(blockedWindow()), null);
  assert.strictEqual(S.getStorage({}), null);
  assert.strictEqual(S.getStorage(null), null);
});

// ---------------------------------------------------------------------------
// parseJson and readJson
// ---------------------------------------------------------------------------

test('parseJson rejects text that is not JSON, and values of the wrong shape', () => {
  assert.deepStrictEqual(S.parseJson('[1,2]', Array.isArray), { ok: true, value: [1, 2] });
  assert.strictEqual(S.parseJson('{"a":', Array.isArray).ok, false, 'cut off by a full quota');
  assert.strictEqual(S.parseJson('not json', Array.isArray).ok, false);
  assert.strictEqual(S.parseJson('{"a":1}', Array.isArray).ok, false, 'an object where a list belongs');
  assert.strictEqual(S.parseJson('42', Array.isArray).ok, false);
  assert.strictEqual(S.parseJson('"text"', Array.isArray).ok, false);
  assert.strictEqual(S.parseJson('null', Array.isArray).ok, false);
  assert.strictEqual(S.parseJson(undefined, Array.isArray).ok, false);
  assert.strictEqual(S.parseJson(42, Array.isArray).ok, false, 'a value that is not text');
  assert.strictEqual(S.parseJson('[1]', () => { throw new Error('bad check'); }).ok, false, 'a throwing check counts as invalid');
  assert.deepStrictEqual(S.parseJson('{"a":1}').value, { a: 1 }, 'no shape check given');
});

test('readJson reports ok, missing, unreadable and unavailable', () => {
  const storage = memoryStorage({ good: '[1]', cut: '[{"a":', wrong: '{"a":1}', empty: '' });
  assert.deepStrictEqual(S.readJson(storage, 'good', Array.isArray), { status: 'ok', value: [1], raw: '[1]' });
  assert.strictEqual(S.readJson(storage, 'absent', Array.isArray).status, 'missing');
  assert.strictEqual(S.readJson(storage, 'empty', Array.isArray).status, 'missing', 'an empty string has nothing to keep');
  const cut = S.readJson(storage, 'cut', Array.isArray);
  assert.strictEqual(cut.status, 'unreadable');
  assert.strictEqual(cut.raw, '[{"a":');
  assert.strictEqual(S.readJson(storage, 'wrong', Array.isArray).status, 'unreadable');
  assert.strictEqual(S.readJson(null, 'good', Array.isArray).status, 'unavailable');
  assert.strictEqual(S.readJson(memoryStorage({}, { failRead: true }), 'good', Array.isArray).status, 'unavailable');
});

test('legacy values: a bare list from an older build reads fine, extra fields are kept', () => {
  const legacy = JSON.stringify([{ id: 'a', medicine: 'Iron', time: '07:00', unknownField: 1 }]);
  const result = S.readJson(memoryStorage({ k: legacy }), 'k', Array.isArray);
  assert.strictEqual(result.status, 'ok');
  assert.strictEqual(result.value[0].unknownField, 1);
});

// ---------------------------------------------------------------------------
// setItem, removeItem, keepUnreadable
// ---------------------------------------------------------------------------

test('setItem and removeItem return false instead of throwing on quota, blocked or no storage', () => {
  const storage = memoryStorage();
  assert.strictEqual(S.setItem(storage, 'k', 'v'), true);
  assert.strictEqual(storage.data.get('k'), 'v');
  assert.strictEqual(S.setItem(memoryStorage({}, { quota: true }), 'k', 'v'), false);
  assert.strictEqual(S.setItem(null, 'k', 'v'), false);
  assert.strictEqual(S.removeItem(storage, 'k'), true);
  assert.strictEqual(S.removeItem(memoryStorage({}, { failRemove: true }), 'k'), false);
  assert.strictEqual(S.removeItem(null, 'k'), false);
});

test('keepUnreadable copies the damaged value aside once and never replaces an earlier copy', () => {
  const storage = memoryStorage({ k: '{"cut":' });
  assert.strictEqual(S.keepUnreadable(storage, 'k', '{"cut":'), true);
  assert.strictEqual(storage.data.get('k' + S.BACKUP_SUFFIX), '{"cut":');

  assert.strictEqual(S.keepUnreadable(storage, 'k', 'something newer and also broken'), true);
  assert.strictEqual(storage.data.get('k' + S.BACKUP_SUFFIX), '{"cut":', 'the first copy is kept');
  assert.strictEqual(storage.data.get('k'), '{"cut":', 'the original key is not touched by the helper');
});

test('keepUnreadable reports false when the copy could not be made', () => {
  assert.strictEqual(S.keepUnreadable(memoryStorage({}, { quota: true }), 'k', 'x'), false);
  assert.strictEqual(S.keepUnreadable(memoryStorage({}, { failRead: true }), 'k', 'x'), false);
  assert.strictEqual(S.keepUnreadable(null, 'k', 'x'), false);
  assert.strictEqual(S.keepUnreadable(memoryStorage(), 'k', null), false);
});

test('preserveUnreadable keeps damaged text, leaves healthy and missing values alone', () => {
  const storage = memoryStorage({ bad: 'oops', good: '[]' });
  const bad = S.preserveUnreadable(storage, 'bad', Array.isArray);
  assert.strictEqual(bad.status, 'unreadable');
  assert.strictEqual(bad.kept, true);
  assert.strictEqual(storage.data.get('bad' + S.BACKUP_SUFFIX), 'oops');

  assert.strictEqual(S.preserveUnreadable(storage, 'good', Array.isArray).status, 'ok');
  assert.strictEqual(S.preserveUnreadable(storage, 'nothing', Array.isArray).status, 'missing');
  assert.ok(!storage.data.has('good' + S.BACKUP_SUFFIX));
  assert.ok(!storage.data.has('nothing' + S.BACKUP_SUFFIX));

  const full = memoryStorage({ bad: 'oops' }, {});
  full.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); };
  assert.strictEqual(S.preserveUnreadable(full, 'bad', Array.isArray).kept, false);
});

test('"Delete my data" removes the kept copies too', () => {
  const P = require('../assets/js/privacy-data.js');
  const storage = memoryStorage({ relief_reminders_v1: '[]' });
  S.keepUnreadable(storage, 'relief_reminders_v1', '{"cut":');
  assert.ok(P.findStoredKeys(storage).includes('relief_reminders_v1' + S.BACKUP_SUFFIX), 'listed with the rest');
  const result = P.deleteLocalData(storage);
  assert.strictEqual(result.state, 'deleted');
  assert.strictEqual(storage.data.size, 0);
});

test('the existing reminder loaders accept the null a blocked page now passes them', () => {
  assert.deepStrictEqual(R.loadReminders(null), []);
  assert.deepStrictEqual(R.loadHistory(null, 'k', [{ date: 'x' }]), []);
  assert.strictEqual(R.saveReminders(null, []), false);
  assert.strictEqual(R.saveReminders(memoryStorage({}, { quota: true }), []), false);
});

// ---------------------------------------------------------------------------
// main.js: sessions and the saved position (runs the page script in a bare context)
// ---------------------------------------------------------------------------

function loadMain(localStorageValue) {
  const sandbox = {
    document: { addEventListener() {}, querySelectorAll: () => [], getElementById: () => null, querySelector: () => null },
    window: {},
    navigator: { userAgent: 'test', onLine: true },
    console: { error() {}, log() {}, warn() {} }
  };
  if (localStorageValue === 'throws') {
    Object.defineProperty(sandbox, 'localStorage', { configurable: true, get() { throw new DOMException('The operation is insecure.', 'SecurityError'); } });
  } else if (localStorageValue !== undefined) {
    sandbox.localStorage = localStorageValue;
  }
  const context = vm.createContext(sandbox);
  vm.runInContext(read('assets/js/main.js'), context, { filename: 'main.js' });
  return context;
}

test('loadSessions only returns a list of objects, whatever is stored', () => {
  const cases = {
    '{"token":"a"}': [],
    '"text"': [],
    '42': [],
    'null': [],
    '{not json': [],
    '[null, 5, "x", [1], {"token":"ok"}]': [{ token: 'ok' }],
    '[]': []
  };
  for (const [raw, expected] of Object.entries(cases)) {
    const ctx = loadMain(memoryStorage({ relief_auth_sessions: raw }));
    assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.loadSessions())), expected, raw);
  }
});

test('the session functions do not throw when localStorage throws on read, write or quota', () => {
  const blocked = loadMain('throws');
  assert.deepStrictEqual(Array.from(blocked.loadSessions()), []);
  assert.doesNotThrow(() => blocked.saveSessions([{ token: 'a' }]));
  assert.doesNotThrow(() => blocked.clearSessions());
  assert.strictEqual(blocked.getActiveSession(), null);

  const full = loadMain(memoryStorage({}, { quota: true, failRemove: true }));
  assert.doesNotThrow(() => full.saveSessions([{ token: 'a' }]));
  assert.doesNotThrow(() => full.clearSessions());
});

test('a saved session list still round trips on healthy storage', () => {
  const storage = memoryStorage();
  const ctx = loadMain(storage);
  ctx.saveSessions([{ token: 't', expiresAt: Date.now() + 60000 }]);
  assert.strictEqual(JSON.parse(storage.data.get('relief_auth_sessions'))[0].token, 't');
  ctx.clearSessions();
  assert.strictEqual(storage.data.has('relief_auth_sessions'), false);
});

test('getLocation still returns the position when the browser will not let it be remembered', async () => {
  const ctx = loadMain(memoryStorage({}, { quota: true }));
  ctx.navigator.geolocation = { getCurrentPosition: (ok) => ok({ coords: { latitude: 22.5, longitude: 88.3 } }) };
  const position = await ctx.getLocation();
  assert.deepStrictEqual({ lat: position.lat, lng: position.lng }, { lat: 22.5, lng: 88.3 });

  const blocked = loadMain('throws');
  blocked.navigator.geolocation = { getCurrentPosition: (ok) => ok({ coords: { latitude: 1, longitude: 2 } }) };
  assert.deepStrictEqual(Object.assign({}, await blocked.getLocation()), { lat: 1, lng: 2 });
});

// ---------------------------------------------------------------------------
// other scripts that named localStorage outside a try
// ---------------------------------------------------------------------------

function withBlockedGlobalStorage(fn) {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new DOMException('The operation is insecure.', 'SecurityError'); } });
  try {
    return fn();
  } finally {
    if (had) Object.defineProperty(globalThis, 'localStorage', had); else delete globalThis.localStorage;
  }
}

test('form-guard and auth-mode do not throw when reading localStorage throws', () => {
  const Guard = require('../assets/js/form-guard.js');
  const Auth = require('../assets/js/auth-mode.js');
  withBlockedGlobalStorage(() => {
    const guard = Guard.createGuard('contact', {}, {});
    assert.ok(guard, 'a guard is created without a working storage');
    assert.doesNotThrow(() => Auth.showDemoNotice({ hidden: true }, {}));
  });
});

test('session-guard starts without throwing when reading window.localStorage throws', () => {
  const source = code('assets/js/session-guard.js');
  assert.match(source, /try \{ pageStorage = window\.localStorage; \} catch/);
  assert.ok(!/storage: window\.localStorage/.test(source), 'init no longer reads window.localStorage outside a try');
});

test('no page script passes the bare localStorage name into a call outside a try', () => {
  const dashboard = code('assets/js/dashboard.js');
  assert.ok(!/[(,]\s*localStorage\s*[,)]/.test(dashboard), 'dashboard.js uses the safe store');
  assert.ok(!/\blocalStorage\.(getItem|setItem|removeItem)/.test(dashboard));
  assert.ok(!/window\.localStorage/.test(code('assets/js/appointment-status-ui.js')));
  assert.ok(!/window\.localStorage/.test(code('assets/js/appointments.js')));
  assert.ok(!/\blocalStorage\.setItem/.test(code('assets/js/doctors.js')));
});

// ---------------------------------------------------------------------------
// wiring
// ---------------------------------------------------------------------------

test('each page that uses safe-storage.js loads it before the script that needs it', () => {
  const pages = {
    'pages/dashboard.html': ['dashboard.js'],
    'pages/doctors.html': ['doctors.js'],
    'pages/appointments.html': ['appointments.js', 'appointment-status-ui.js']
  };
  for (const [page, scripts] of Object.entries(pages)) {
    const html = read(page);
    const helper = html.indexOf('assets/js/safe-storage.js');
    assert.ok(helper > -1, page + ' does not load safe-storage.js');
    for (const script of scripts) {
      assert.ok(helper < html.indexOf('assets/js/' + script), page + ': safe-storage.js must come before ' + script);
    }
  }
});

test('the dashboard has the notice element the script fills in', () => {
  assert.match(read('pages/dashboard.html'), /id="storage-notice"[^>]*role="status"[^>]*hidden/);
  assert.match(read('assets/css/dashboard.css'), /\.storage-notice/);
});

test('no cached page loads safe-storage.js, so sw.js does not need to save it', () => {
  const sw = read('sw.js');
  const cachedPages = Array.from(sw.matchAll(/'(pages\/[a-z-]+\.html)'/g), (m) => m[1]);
  assert.ok(cachedPages.length > 0);
  cachedPages.forEach((page) => assert.ok(!read(page).includes('safe-storage.js'), page + ' loads safe-storage.js, add it to ASSET_PATHS'));
});
