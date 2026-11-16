/**
 * Tests for Issue #170: Firebase start-up in assets/js/api.js.
 * A stub `firebase` global stands in for the SDK; api.js is loaded fresh for every case.
 *
 * node --test tests/firebase-init.test.js
 */

const test = require('node:test');
const assert = require('node:assert');

const API_PATH = require.resolve('../assets/js/api.js');

const GOOD_CONFIG = {
  apiKey: 'AIzaFakeKeyForTests',
  authDomain: 'relief-test.firebaseapp.com',
  projectId: 'relief-test',
  appId: '1:123:web:abc'
};

// Records what api.js asks the SDK to do.
function stubFirebase(options) {
  const opts = options || {};
  const calls = { initializeApp: [], auth: 0, firestore: 0, appCheckActivate: [] };
  const sdk = {
    apps: opts.existingApp ? [{ name: '[DEFAULT]', options: opts.existingOptions || GOOD_CONFIG }] : [],
    initializeApp(config) {
      calls.initializeApp.push(config);
      if (sdk.apps.length) {
        const error = new Error('Firebase App named [DEFAULT] already exists');
        error.code = 'app/duplicate-app';
        throw error;
      }
      const app = { name: '[DEFAULT]', options: config };
      sdk.apps.push(app);
      return app;
    }
  };
  if (opts.auth !== false) sdk.auth = () => { calls.auth += 1; return opts.authObject || { currentUser: null }; };
  if (opts.firestore !== false) sdk.firestore = () => { calls.firestore += 1; return opts.dbObject || {}; };
  if (opts.appCheck) sdk.appCheck = () => ({ activate: (...args) => calls.appCheckActivate.push(args) });
  return { sdk, calls };
}

function loadApi(globals) {
  delete require.cache[API_PATH];
  const g = globals || {};
  if (g.firebase) globalThis.firebase = g.firebase; else delete globalThis.firebase;
  globalThis.window = g.window || {};
  const warnings = [];
  const realWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    return { api: require(API_PATH), warnings };
  } finally {
    console.warn = realWarn;
  }
}

const realError = console.error;
test.beforeEach(() => { console.error = () => {}; });

test.afterEach(() => {
  console.error = realError;
  delete globalThis.firebase;
  delete globalThis.window;
  delete require.cache[API_PATH];
});

async function rejection(promise) {
  try { await promise; } catch (error) { return error; }
  assert.fail('expected a rejection');
}

function assertUnavailable(error, reason) {
  assert.ok(!(error instanceof TypeError), 'must not be a TypeError: ' + error.message);
  assert.strictEqual(error.code, 'auth-unavailable');
  assert.strictEqual(error.reason, reason);
  assert.match(error.message, /sign-in is unavailable/i);
}

test('configured: starts the app once and hands out auth and firestore', () => {
  const { sdk, calls } = stubFirebase();
  const { api, warnings } = loadApi({ firebase: sdk, window: { RELIEF_FIREBASE_CONFIG: GOOD_CONFIG } });
  assert.deepStrictEqual(api.getFirebaseStatus(), { available: true, reason: null });
  assert.strictEqual(calls.initializeApp.length, 1);
  assert.deepStrictEqual(calls.initializeApp[0], GOOD_CONFIG);
  assert.strictEqual(calls.auth, 1);
  assert.strictEqual(calls.firestore, 1);
  assert.deepStrictEqual(warnings, []);
});

test('configured: asking for the status again does not start anything again', () => {
  const { sdk, calls } = stubFirebase();
  const { api } = loadApi({ firebase: sdk, window: { RELIEF_FIREBASE_CONFIG: GOOD_CONFIG } });
  api.getFirebaseStatus();
  api.getFirebaseStatus();
  assert.strictEqual(calls.initializeApp.length, 1);
  assert.strictEqual(calls.auth, 1);
});

test('configured: App Check is only activated when a site key is set', () => {
  const plain = stubFirebase({ appCheck: true });
  loadApi({ firebase: plain.sdk, window: { RELIEF_FIREBASE_CONFIG: GOOD_CONFIG } });
  assert.deepStrictEqual(plain.calls.appCheckActivate, []);

  const keyed = stubFirebase({ appCheck: true });
  loadApi({ firebase: keyed.sdk, window: { RELIEF_FIREBASE_CONFIG: GOOD_CONFIG, RELIEF_APP_CHECK_SITE_KEY: 'site-key' } });
  assert.deepStrictEqual(keyed.calls.appCheckActivate, [['site-key', true]]);
});

test('incomplete config: nothing is started and sign-in reports unavailable', async () => {
  for (const missing of ['apiKey', 'authDomain', 'projectId', 'appId']) {
    const { sdk, calls } = stubFirebase();
    const partial = Object.assign({}, GOOD_CONFIG);
    delete partial[missing];
    const { api, warnings } = loadApi({ firebase: sdk, window: { RELIEF_FIREBASE_CONFIG: partial } });
    assert.deepStrictEqual(api.getFirebaseStatus(), { available: false, reason: 'incomplete-config' }, missing);
    assert.strictEqual(calls.initializeApp.length, 0, missing);
    assert.strictEqual(warnings.length, 1, missing);
    assertUnavailable(await rejection(api.login('a@b.co', 'secret1')), 'incomplete-config');
  }
  const blank = stubFirebase();
  const { api } = loadApi({ firebase: blank.sdk, window: { RELIEF_FIREBASE_CONFIG: Object.assign({}, GOOD_CONFIG, { apiKey: '   ' }) } });
  assert.strictEqual(api.getFirebaseStatus().reason, 'incomplete-config');
});

test('placeholder config (the one shipped in api.js) is rejected before init', async () => {
  const { sdk, calls } = stubFirebase();
  const { api, warnings } = loadApi({ firebase: sdk });
  assert.deepStrictEqual(api.getFirebaseStatus(), { available: false, reason: 'placeholder-config' });
  assert.strictEqual(calls.initializeApp.length, 0);
  assert.strictEqual(warnings.length, 1);
  assert.doesNotMatch(warnings[0], /your_firebase_api_key/, 'config values are not logged');
  assertUnavailable(await rejection(api.signup({ email: 'a@b.co', password: 'secret1' })), 'placeholder-config');

  const mixed = stubFirebase();
  const second = loadApi({ firebase: mixed.sdk, window: { RELIEF_FIREBASE_CONFIG: Object.assign({}, GOOD_CONFIG, { projectId: 'your_project' }) } });
  assert.strictEqual(second.api.getFirebaseStatus().reason, 'placeholder-config');
  assert.strictEqual(mixed.calls.initializeApp.length, 0);
});

test('repeated init: an app that already exists is reused and nothing throws', () => {
  const { sdk, calls } = stubFirebase({ existingApp: true });
  const { api } = loadApi({ firebase: sdk });
  assert.deepStrictEqual(api.getFirebaseStatus(), { available: true, reason: null });
  assert.strictEqual(calls.initializeApp.length, 0);
  assert.strictEqual(calls.auth, 1);
});

test('repeated init: an existing app with placeholder or incomplete options is not trusted', async () => {
  const cases = [
    [Object.assign({}, GOOD_CONFIG, { apiKey: 'your_firebase_api_key' }), 'placeholder-config'],
    [Object.assign({}, GOOD_CONFIG, { projectId: 'your_project' }), 'placeholder-config'],
    [{ apiKey: GOOD_CONFIG.apiKey, projectId: GOOD_CONFIG.projectId }, 'incomplete-config'],
    [undefined, 'incomplete-config']
  ];
  for (const [options, reason] of cases) {
    const { sdk, calls } = stubFirebase({ existingApp: true });
    sdk.apps[0].options = options;
    const { api, warnings } = loadApi({ firebase: sdk, window: { RELIEF_FIREBASE_CONFIG: GOOD_CONFIG } });
    assert.deepStrictEqual(api.getFirebaseStatus(), { available: false, reason }, reason);
    assert.strictEqual(calls.initializeApp.length, 0);
    assert.strictEqual(calls.auth, 0, 'no service is handed out for a bad app');
    assert.strictEqual(warnings.length, 1);
    assertUnavailable(await rejection(api.login('a@b.co', 'secret1')), reason);
  }
});

test('repeated init: loading api.js twice starts the app only once', () => {
  const { sdk, calls } = stubFirebase();
  const globals = { firebase: sdk, window: { RELIEF_FIREBASE_CONFIG: GOOD_CONFIG } };
  loadApi(globals);
  const second = loadApi(globals);
  assert.strictEqual(calls.initializeApp.length, 1);
  assert.strictEqual(calls.auth, 2);
  assert.deepStrictEqual(second.api.getFirebaseStatus(), { available: true, reason: null });
});

test('a missing Auth script makes sign-in unavailable instead of a TypeError', async () => {
  const noAuth = stubFirebase({ auth: false });
  const { api } = loadApi({ firebase: noAuth.sdk, window: { RELIEF_FIREBASE_CONFIG: GOOD_CONFIG } });
  assert.deepStrictEqual(api.getFirebaseStatus(), { available: false, reason: 'auth-missing' });
  assert.ok(api, 'ReliefAPI is still defined');
  assertUnavailable(await rejection(api.login('a@b.co', 'secret1')), 'auth-missing');
  assertUnavailable(await rejection(api.getCurrentUser()), 'auth-missing');
  assert.deepStrictEqual(await api.logout(), { success: true });
});

test('a missing Firestore script keeps Auth for sign-out but sign-in stays unavailable', async () => {
  let signedOut = 0;
  const authObject = { currentUser: { uid: 'u1', getIdToken: async () => 'token' }, signOut: async () => { signedOut += 1; } };
  const noDb = stubFirebase({ firestore: false, authObject });
  const { api } = loadApi({ firebase: noDb.sdk, window: { RELIEF_FIREBASE_CONFIG: GOOD_CONFIG } });
  assert.deepStrictEqual(api.getFirebaseStatus(), { available: false, reason: 'firestore-missing' });
  assertUnavailable(await rejection(api.login('a@b.co', 'secret1')), 'firestore-missing');
  assertUnavailable(await rejection(api.signup({ email: 'a@b.co', password: 'secret1' })), 'firestore-missing');
  assertUnavailable(await rejection(api.getCurrentUser()), 'firestore-missing');
  assert.deepStrictEqual(await api.logout(), { success: true });
  assert.strictEqual(signedOut, 1, 'the saved Firebase session is really ended');
  assert.deepStrictEqual(await api.refreshSession(), { refreshed: true }, 'the kept Auth client also refreshes the session');
});

test('a service that throws while starting is reported as unavailable', async () => {
  const { sdk } = stubFirebase();
  sdk.firestore = () => { throw new Error('boom'); };
  const { api } = loadApi({ firebase: sdk, window: { RELIEF_FIREBASE_CONFIG: GOOD_CONFIG } });
  assert.strictEqual(api.getFirebaseStatus().reason, 'init-failed');
  assertUnavailable(await rejection(api.signup({ email: 'a@b.co', password: 'secret1' })), 'init-failed');
});

test('no SDK on the page: quiet, getCurrentUser is null, login is unavailable, logout is a no-op', async () => {
  const { api, warnings } = loadApi({});
  assert.deepStrictEqual(api.getFirebaseStatus(), { available: false, reason: 'sdk-missing' });
  assert.deepStrictEqual(warnings, []);
  assert.strictEqual(await api.getCurrentUser(), null);
  assert.deepStrictEqual(await api.logout(), { success: true });
  assertUnavailable(await rejection(api.login('a@b.co', 'secret1')), 'sdk-missing');
});

test('a bad email still gets the plain validation error, not the unavailable one', async () => {
  const { api } = loadApi({});
  const error = await rejection(api.login('not-an-email', 'x'));
  assert.match(error.message, /Invalid email or password/);
});
