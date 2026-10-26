/**
 * Tests for Issue #29: privacy inventory and account deletion.
 * Pure logic with a fake Storage and a fake sign-in service, plus checks that the
 * inventory, docs and pages match what the scripts really do.
 * Run with: node --test tests/privacy-data.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const P = require('../assets/js/privacy-data.js');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// Minimal Storage: getItem / setItem / removeItem / key / length.
function memoryStorage(initial, hooks) {
    const data = new Map(Object.entries(initial || {}));
    const h = hooks || {};
    return {
        get length() { return data.size; },
        key: (i) => (Array.from(data.keys())[i] ?? null),
        getItem: (k) => {
            if (h.getItem) h.getItem(k);
            return data.has(k) ? data.get(k) : null;
        },
        setItem: (k, v) => { data.set(k, String(v)); },
        removeItem: (k) => {
            if (h.removeItem && h.removeItem(k) === 'ignore') return;
            data.delete(k);
        },
        keys: () => Array.from(data.keys())
    };
}

function filled() {
    const seed = {};
    P.inventoryKeys().forEach((k) => { seed[k] = '"x"'; });
    seed.relief_future_feature = '1';
    seed.some_other_app = 'keep me';
    seed.theme = 'dark';
    return memoryStorage(seed);
}

const DEMO_USER = { uid: 'demo_1', email: 'a@b.co', demo: true };
const REAL_USER = { uid: 'u1', email: 'a@b.co' };

describe('inventory', () => {
    it('has unique keys and the fields the docs need', () => {
        const keys = P.inventoryKeys();
        assert.strictEqual(new Set(keys).size, keys.length);
        P.INVENTORY.forEach((item) => {
            ['key', 'label', 'category', 'holds', 'retention'].forEach((f) => {
                assert.ok(typeof item[f] === 'string' && item[f].length > 0, item.key + ' needs ' + f);
            });
            assert.strictEqual(typeof item.personal, 'boolean', item.key);
        });
    });

    it('lists the keys named in the issue and by earlier features', () => {
        ['relief_reminders_v1', 'relief_demo_users', 'userLocation', 'relief_auth_sessions',
            'relief_saved_facilities', 'relief_appointment_requests', 'relief_history_v1', 'relief_lang']
            .forEach((k) => assert.ok(P.inventoryKeys().includes(k), k));
    });

    it('covers every storage key the scripts write (so new keys cannot be forgotten)', () => {
        const dir = path.join(ROOT, 'assets', 'js');
        const found = new Set();
        fs.readdirSync(dir).filter((f) => f.endsWith('.js') && f !== 'privacy-data.js').forEach((file) => {
            const src = fs.readFileSync(path.join(dir, file), 'utf8');
            for (const m of src.matchAll(/['"](relief_[a-z0-9_]+)['"]/g)) found.add(m[1]);
            for (const m of src.matchAll(/localStorage\.(?:getItem|setItem|removeItem)\(\s*['"]([^'"]+)['"]/g)) found.add(m[1]);
        });
        assert.ok(found.size >= 8, 'scan should find the known keys, found ' + found.size);
        found.forEach((key) => {
            assert.ok(P.inventoryKeys().includes(key), key + ' is used by a script but missing from INVENTORY');
        });
    });

    it('is not bypassed by a storage key held in a constant elsewhere', () => {
        // KEY = 'name' constants next to setItem(KEY, ...) are the other way keys get in.
        const dir = path.join(ROOT, 'assets', 'js');
        fs.readdirSync(dir).filter((f) => f.endsWith('.js') && f !== 'privacy-data.js').forEach((file) => {
            const src = fs.readFileSync(path.join(dir, file), 'utf8');
            for (const m of src.matchAll(/(?:STORAGE_KEY|_KEY|SAVED_KEY|historyKey|REMINDERS_KEY)\s*=\s*['"]([^'"]+)['"]/g)) {
                assert.ok(P.inventoryKeys().includes(m[1]), file + ': ' + m[1] + ' missing from INVENTORY');
            }
        });
    });

    it('is documented: docs/PRIVACY_AND_DATA.md names every key', () => {
        const doc = read('docs/PRIVACY_AND_DATA.md');
        P.inventoryKeys().forEach((k) => assert.ok(doc.includes('`' + k + '`'), k + ' not in docs'));
    });

    it('recognises relief_ prefixed and listed keys only', () => {
        assert.strictEqual(P.isReliefKey('relief_anything_new'), true);
        assert.strictEqual(P.isReliefKey('userLocation'), true);
        assert.strictEqual(P.isReliefKey('theme'), false);
        assert.strictEqual(P.isReliefKey(null), false);
    });
});

describe('finding stored keys', () => {
    it('lists listed keys and other relief_ keys, never unrelated ones', () => {
        const found = P.findStoredKeys(filled());
        assert.ok(found.includes('relief_future_feature'));
        assert.ok(found.includes('userLocation'));
        assert.ok(!found.includes('some_other_app'));
        assert.ok(!found.includes('theme'));
    });

    it('describeStored labels known keys and flags unknown ones', () => {
        const rows = P.describeStored(memoryStorage({ relief_reminders_v1: '[]', relief_future_feature: '1' }));
        assert.strictEqual(rows[0].label, 'Medicine reminders');
        assert.strictEqual(rows[0].personal, true);
        assert.match(rows[1].label, /relief_future_feature/);
    });

    it('returns nothing for missing storage', () => {
        assert.deepStrictEqual(P.findStoredKeys(null), []);
    });
});

describe('deleteLocalData', () => {
    it('removes every RELIEF key and leaves unrelated keys alone', () => {
        const store = filled();
        const r = P.deleteLocalData(store);
        assert.strictEqual(r.state, 'deleted');
        assert.deepStrictEqual(r.failed, []);
        assert.deepStrictEqual(store.keys().sort(), ['some_other_app', 'theme']);
        assert.deepStrictEqual(r.remaining, []);
        assert.strictEqual(r.removed.length, P.inventoryKeys().length + 1);
    });

    it('reports "nothing" when nothing was stored', () => {
        const r = P.deleteLocalData(memoryStorage({ theme: 'dark' }));
        assert.strictEqual(r.state, 'nothing');
        assert.deepStrictEqual(r.removed, []);
    });

    it('reports partial when a key refuses to go, and names it', () => {
        const store = memoryStorage({ relief_reminders_v1: '[]', userLocation: '{}' }, {
            removeItem: (k) => (k === 'userLocation' ? 'ignore' : undefined)
        });
        const r = P.deleteLocalData(store);
        assert.strictEqual(r.state, 'partial');
        assert.deepStrictEqual(r.failed, ['userLocation']);
        assert.deepStrictEqual(r.removed, ['relief_reminders_v1']);
        assert.deepStrictEqual(r.remaining, ['userLocation']);
    });

    it('does not trust removeItem: a key that throws is also reported as failed', () => {
        const store = memoryStorage({ relief_lang: 'en' }, {
            removeItem: () => { throw new Error('SecurityError'); }
        });
        assert.strictEqual(P.deleteLocalData(store).state, 'partial');
    });

    it('reports unavailable when there is no storage', () => {
        assert.strictEqual(P.deleteLocalData(null).state, 'unavailable');
    });

    it('is safe to run twice', () => {
        const store = filled();
        P.deleteLocalData(store);
        assert.strictEqual(P.deleteLocalData(store).state, 'nothing');
    });
});

describe('deleteServerAccount', () => {
    it('demo accounts need no server call', async () => {
        let called = false;
        const r = await P.deleteServerAccount({ deleteAccount: async () => { called = true; } }, DEMO_USER);
        assert.strictEqual(r.state, 'not-needed');
        assert.strictEqual(called, false);
    });

    it('does not contact the service when nobody is signed in', async () => {
        let called = false;
        const r = await P.deleteServerAccount({ deleteAccount: async () => { called = true; } }, null);
        assert.strictEqual(r.state, 'not-signed-in');
        assert.strictEqual(called, false);
    });

    it('says unavailable when the API is missing or has no deleteAccount', async () => {
        const a = await P.deleteServerAccount(null, REAL_USER);
        const b = await P.deleteServerAccount({ login() {} }, REAL_USER);
        assert.strictEqual(a.state, 'unavailable');
        assert.strictEqual(b.state, 'unavailable');
        assert.match(a.message, /still exists/);
    });

    it('is deleted only when the service answers success: true', async () => {
        const ok = await P.deleteServerAccount({ deleteAccount: async () => ({ success: true }) }, REAL_USER);
        assert.strictEqual(ok.state, 'deleted');
        const vague = await P.deleteServerAccount({ deleteAccount: async () => ({}) }, REAL_USER);
        assert.strictEqual(vague.state, 'failed');
        const nothing = await P.deleteServerAccount({ deleteAccount: async () => undefined }, REAL_USER);
        assert.strictEqual(nothing.state, 'failed');
    });

    it('turns a recent-login error into a clear retry message', async () => {
        const err = Object.assign(new Error('x'), { code: 'auth/requires-recent-login' });
        const r = await P.deleteServerAccount({ deleteAccount: async () => { throw err; } }, REAL_USER);
        assert.strictEqual(r.state, 'failed');
        assert.match(r.message, /Nothing was deleted on the server/);
    });

    it('never puts the raw error text (which can hold an email) in the message', async () => {
        const err = new Error('failed for secret.person@example.com');
        const r = await P.deleteServerAccount({ deleteAccount: async () => { throw err; } }, REAL_USER);
        assert.strictEqual(r.state, 'failed');
        assert.ok(!r.message.includes('secret.person'));
    });

    it('gives up when the service never answers', async () => {
        const r = await P.deleteServerAccount({ deleteAccount: () => new Promise(() => {}) }, REAL_USER, { timeoutMs: 20 });
        assert.strictEqual(r.state, 'failed');
        assert.strictEqual(r.code, 'relief/timeout');
    });
});

describe('deleteAccount (both parts)', () => {
    it('demo account: complete, and the demo user record is gone', async () => {
        const store = filled();
        const r = await P.deleteAccount({ storage: store, api: null, user: DEMO_USER });
        assert.strictEqual(r.status, 'complete');
        assert.strictEqual(store.getItem('relief_demo_users'), null);
        assert.strictEqual(store.getItem('relief_auth_sessions'), null);
    });

    it('signed in with a working service: complete, signs out of the service', async () => {
        const store = filled();
        const calls = [];
        const api = {
            deleteAccount: async () => { calls.push('delete'); return { success: true }; },
            logout: async () => { calls.push('logout'); return { success: true }; }
        };
        const r = await P.deleteAccount({ storage: store, api, user: REAL_USER });
        assert.strictEqual(r.status, 'complete');
        assert.deepStrictEqual(calls, ['delete', 'logout']);
    });

    it('asks the service before the local session is removed', async () => {
        const store = filled();
        let sessionSeen = null;
        const api = { deleteAccount: async () => { sessionSeen = store.getItem('relief_auth_sessions'); return { success: true }; } };
        await P.deleteAccount({ storage: store, api, user: REAL_USER });
        assert.strictEqual(sessionSeen, '"x"');
    });

    it('no service: local-only, local data still removed, and it is not called complete', async () => {
        const store = filled();
        const r = await P.deleteAccount({ storage: store, api: null, user: REAL_USER });
        assert.strictEqual(r.status, 'local-only');
        assert.strictEqual(r.server.state, 'unavailable');
        assert.deepStrictEqual(P.findStoredKeys(store), []);
    });

    it('service error: local-only, local data still removed, server marked failed', async () => {
        const store = filled();
        const api = { deleteAccount: async () => { throw new Error('boom'); } };
        const r = await P.deleteAccount({ storage: store, api, user: REAL_USER });
        assert.strictEqual(r.status, 'local-only');
        assert.strictEqual(r.server.state, 'failed');
        assert.deepStrictEqual(P.findStoredKeys(store), []);
    });

    it('partial local failure beats a server success', async () => {
        const store = memoryStorage({ userLocation: '{}' }, { removeItem: () => 'ignore' });
        const api = { deleteAccount: async () => ({ success: true }) };
        const r = await P.deleteAccount({ storage: store, api, user: REAL_USER });
        assert.strictEqual(r.status, 'partial');
    });

    it('no storage: failed', async () => {
        const r = await P.deleteAccount({ storage: null, api: null, user: DEMO_USER });
        assert.strictEqual(r.status, 'failed');
    });
});

describe('describeResult wording', () => {
    const run = (deps) => P.deleteAccount(deps).then(P.describeResult);

    it('does not claim a deleted account when the server part did not happen', async () => {
        const t = await run({ storage: filled(), api: null, user: REAL_USER });
        assert.strictEqual(t.tone, 'warning');
        assert.match(t.headline, /No account on a server was deleted/);
        assert.ok(!/Your account/.test(t.headline));
        assert.ok(t.lines.some((l) => /still exists/.test(l)));
    });

    it('says a demo account is gone and that no server copy ever existed', async () => {
        const t = await run({ storage: filled(), api: null, user: DEMO_USER });
        assert.strictEqual(t.tone, 'success');
        assert.match(t.headline, /demo account/);
        assert.ok(t.lines.some((l) => /no copy on a server/.test(l)));
    });

    it('confirmed server deletion is the only time it says "Your account"', async () => {
        const api = { deleteAccount: async () => ({ success: true }), logout: async () => ({}) };
        const t = await run({ storage: filled(), api, user: REAL_USER });
        assert.match(t.headline, /Your account and local data were deleted/);
    });

    it('names what could not be removed and gives the manual fallback', async () => {
        const store = memoryStorage({ userLocation: '{}' }, { removeItem: () => 'ignore' });
        const t = await run({ storage: store, api: null, user: DEMO_USER });
        assert.strictEqual(t.tone, 'error');
        assert.ok(t.lines.some((l) => /Saved location/.test(l) && /browser settings/.test(l)));
    });

    it('does not say "no data stored" when data was found but could not be removed', async () => {
        const store = memoryStorage({ userLocation: '{}' }, { removeItem: () => 'ignore' });
        const t = await run({ storage: store, api: null, user: DEMO_USER });
        assert.ok(!t.lines.some((l) => /no RELIEF data stored/.test(l)));
        assert.ok(!t.lines.some((l) => /^Removed from this browser/.test(l)));
    });

    it('says nothing was deleted when storage is unavailable', async () => {
        const t = await run({ storage: null, api: null, user: null });
        assert.strictEqual(t.headline, 'Nothing was deleted.');
        assert.strictEqual(t.tone, 'error');
    });

    it('says so when there was nothing stored', async () => {
        const t = await run({ storage: memoryStorage({}), api: null, user: DEMO_USER });
        assert.ok(t.lines.some((l) => /no RELIEF data stored/.test(l)));
    });
});

describe('ReliefAPI.deleteAccount (api.js with a fake Firebase)', () => {
    function loadApi(fb) {
        const src = read('assets/js/api.js').replace(/^export default ReliefAPI;\s*$/m, '');
        const ctx = vm.createContext({ firebase: fb, console: { error() {} }, fetch: () => { throw new Error('no network in tests'); } });
        return new vm.Script(src + '\n;ReliefAPI;').runInContext(ctx);
    }

    function fakeFirebase(opts) {
        const deleted = [];
        const state = { userDeleted: false, deleted, batches: 0 };
        const user = opts.user === undefined ? {
            uid: 'u1',
            metadata: { lastSignInTime: new Date(opts.lastSignIn || Date.now()).toUTCString() },
            delete: async () => { if (opts.userDeleteError) throw opts.userDeleteError; state.userDeleted = true; }
        } : opts.user;
        const doc = (col, id) => ({ id, path: col + '/' + id });
        const firestore = () => ({
            collection: (name) => ({
                doc: (id) => doc(name, id),
                where: () => ({ get: async () => ({ docs: (opts.owned && opts.owned[name] || []).map((id) => ({ ref: doc(name, id) })) }) })
            }),
            batch: () => {
                const refs = [];
                return { delete: (r) => refs.push(r.path), commit: async () => { state.batches++; refs.forEach((p) => deleted.push(p)); } };
            }
        });
        const auth = () => ({ currentUser: user, signOut: async () => {} });
        return { fb: { apps: [{}], initializeApp() {}, auth, firestore: Object.assign(firestore, { FieldValue: { serverTimestamp: () => 0 } }) }, state };
    }

    it('is exposed on the public API', () => {
        assert.strictEqual(typeof loadApi(fakeFirebase({}).fb).deleteAccount, 'function');
    });

    it('refuses when nobody is signed in and deletes nothing', async () => {
        const { fb, state } = fakeFirebase({ user: null });
        await assert.rejects(loadApi(fb).deleteAccount(), (e) => e.code === 'auth/no-current-user');
        assert.deepStrictEqual(state.deleted, []);
    });

    it('refuses an old sign-in before touching any data', async () => {
        const { fb, state } = fakeFirebase({ lastSignIn: Date.now() - 60 * 60 * 1000 });
        await assert.rejects(loadApi(fb).deleteAccount(), (e) => e.code === 'auth/requires-recent-login');
        assert.deepStrictEqual(state.deleted, []);
        assert.strictEqual(state.userDeleted, false);
    });

    it('deletes profile documents, owned records and the auth user, then reports success', async () => {
        const { fb, state } = fakeFirebase({ owned: { appointments: ['a1', 'a2'], emergencyRequests: ['e1'] } });
        const r = await loadApi(fb).deleteAccount();
        assert.strictEqual(r.success, true);
        assert.deepStrictEqual(state.deleted.sort(),
            ['appointments/a1', 'appointments/a2', 'emergencyRequests/e1', 'patients/u1', 'users/u1']);
        assert.strictEqual(state.userDeleted, true);
    });

    it('does not report success when deleting the auth user fails', async () => {
        const err = Object.assign(new Error('nope'), { code: 'auth/network-request-failed' });
        const { fb } = fakeFirebase({ userDeleteError: err });
        await assert.rejects(loadApi(fb).deleteAccount(), (e) => e.code === 'auth/network-request-failed');
    });
});

describe('pages', () => {
    const html = read('pages/dashboard.html');

    it('dashboard has the delete section with a confirmation step and a live status region', () => {
        assert.match(html, /id="privacy-delete"[^>]*aria-controls="privacy-confirm"[^>]*aria-expanded="false"/);
        assert.match(html, /id="privacy-confirm"[^>]*role="group"[^>]*hidden/);
        assert.match(html, /id="privacy-status"[^>]*role="status"[^>]*aria-live="polite"/);
        assert.match(html, /id="privacy-confirm-yes"/);
        assert.match(html, /id="privacy-confirm-cancel"/);
    });

    it('loads privacy-data.js before privacy-controls.js, and both after dashboard.js', () => {
        const i = (name) => html.indexOf('assets/js/' + name);
        assert.ok(i('privacy-data.js') > -1);
        assert.ok(i('dashboard.js') < i('privacy-data.js'));
        assert.ok(i('privacy-data.js') < i('privacy-controls.js'));
    });

    it('privacy policy page links the data document and the delete control, and drops unfounded claims', () => {
        const policy = read('pages/privacy-policy.html');
        assert.match(policy, /dashboard\.html#privacy-data/);
        assert.ok(!/privacy@reliefwebapp\.com/.test(policy), 'unverified contact address should be gone');
        assert.ok(!/We implement encryption/.test(policy));
        assert.ok(!/IP address, browser type, pages visited/.test(policy));
    });

    it('page scripts do not log personal data', () => {
        ['privacy-data.js', 'privacy-controls.js'].forEach((f) => {
            assert.ok(!/console\./.test(read('assets/js/' + f)), f + ' should not log');
        });
    });
});
