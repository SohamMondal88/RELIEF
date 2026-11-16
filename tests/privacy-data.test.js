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
            // A name ending in "_" is a prefix a script adds a suffix to (form-guard.js writes relief_formguard_<form>).
            // It counts as covered when at least one listed key starts with it; each real key still has to be listed.
            const covered = key.endsWith('_')
                ? P.inventoryKeys().some((k) => k.startsWith(key))
                : P.inventoryKeys().includes(key);
            assert.ok(covered, key + ' is used by a script but missing from INVENTORY');
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

// ---------------------------------------------------------------------------
// "Clear data stored in this browser" (Issue #81): the local half on its own
// ---------------------------------------------------------------------------

describe('clearLocalData', () => {
    it('removes every RELIEF key, keeps unrelated keys and reports exactly what went', () => {
        const store = filled();
        const r = P.clearLocalData(store);
        assert.strictEqual(r.status, 'cleared');
        assert.deepStrictEqual(store.keys().sort(), ['some_other_app', 'theme']);
        assert.strictEqual(store.getItem('some_other_app'), 'keep me');
        assert.strictEqual(r.local.removed.length, P.inventoryKeys().length + 1);
        assert.deepStrictEqual(r.local.failed, []);
    });

    it('does not touch a key that only looks similar (no relief_ prefix, not in the inventory)', () => {
        const store = memoryStorage({ relief_reminders_v1: '[]', 'my_relief_notes': 'x', Relief_upper: 'x', reliefx: 'x', userLocationBackup: 'x' });
        P.clearLocalData(store);
        assert.deepStrictEqual(store.keys().sort(), ['Relief_upper', 'my_relief_notes', 'reliefx', 'userLocationBackup']);
    });

    it('never contacts a server: no sign-in service is involved and the result says so', () => {
        const r = P.clearLocalData(filled());
        assert.strictEqual(r.server.state, 'not-contacted');
        assert.match(r.server.message, /did not contact any server/);
        assert.match(r.server.message, /still exists/);
    });

    it('says there was nothing to clear when nothing is stored, and is safe to run twice', () => {
        const store = filled();
        P.clearLocalData(store);
        assert.strictEqual(P.clearLocalData(store).status, 'nothing');
        assert.strictEqual(P.clearLocalData(memoryStorage({ theme: 'dark' })).status, 'nothing');
    });

    it('reports partial when a key refuses to go, names it, and still removes the rest', () => {
        const store = memoryStorage({ relief_reminders_v1: '[]', userLocation: '{}', theme: 'dark' }, {
            removeItem: (k) => (k === 'userLocation' ? 'ignore' : undefined)
        });
        const r = P.clearLocalData(store);
        assert.strictEqual(r.status, 'partial');
        assert.deepStrictEqual(r.local.failed, ['userLocation']);
        assert.deepStrictEqual(store.keys().sort(), ['theme', 'userLocation']);
    });

    it('treats a storage that throws on removeItem as partial, not as cleared', () => {
        const store = memoryStorage({ relief_lang: 'en' }, { removeItem: () => { throw new Error('SecurityError'); } });
        assert.strictEqual(P.clearLocalData(store).status, 'partial');
    });

    it('reports failed, without throwing, when storage is missing or cannot be listed', () => {
        assert.strictEqual(P.clearLocalData(null).status, 'failed');
        const blocked = { getItem() { throw new Error('SecurityError'); }, removeItem() {}, get length() { throw new Error('SecurityError'); } };
        assert.doesNotThrow(() => P.clearLocalData(blocked));
        assert.ok(['failed', 'nothing'].includes(P.clearLocalData(blocked).status));
    });
});

describe('countOtherKeys', () => {
    it('counts the keys that are not RELIEF\'s, so the page can say how many are kept', () => {
        assert.strictEqual(P.countOtherKeys(filled()), 2);
        assert.strictEqual(P.countOtherKeys(memoryStorage({})), 0);
        assert.strictEqual(P.countOtherKeys(null), null);
    });
});

describe('describeClearResult wording', () => {
    it('cleared: lists what was removed, says no server was contacted and never says an account was deleted', () => {
        const t = P.describeClearResult(P.clearLocalData(filled()));
        assert.strictEqual(t.tone, 'success');
        assert.match(t.headline, /Data stored in this browser was cleared/);
        assert.ok(t.lines.some((l) => /^Removed from this browser: .*Medicine reminders/.test(l)));
        assert.ok(t.lines.some((l) => /did not contact any server/.test(l)));
        assert.ok(!/account (was|were) deleted/i.test(t.headline + t.lines.join(' ')));
        assert.ok(t.lines.some((l) => /other browsers or devices/.test(l)));
    });

    it('partial: names the key that stayed and the manual fallback', () => {
        const store = memoryStorage({ userLocation: '{}', relief_lang: 'en' }, { removeItem: (k) => (k === 'userLocation' ? 'ignore' : undefined) });
        const t = P.describeClearResult(P.clearLocalData(store));
        assert.strictEqual(t.tone, 'error');
        assert.ok(t.lines.some((l) => /Could not remove: Saved location/.test(l) && /browser settings/.test(l)));
        assert.ok(t.lines.some((l) => /^Removed from this browser: .*Language choice/.test(l)));
    });

    it('nothing and failed are told apart', () => {
        assert.strictEqual(P.describeClearResult(P.clearLocalData(memoryStorage({}))).headline, 'There was nothing to clear.');
        const failed = P.describeClearResult(P.clearLocalData(null));
        assert.strictEqual(failed.headline, 'Nothing was cleared.');
        assert.strictEqual(failed.tone, 'error');
        assert.ok(!failed.lines.some((l) => /did not contact/.test(l)));
    });
});

describe('clear control on the dashboard', () => {
    const html = read('pages/dashboard.html');
    const controls = read('assets/js/privacy-controls.js');

    it('has a clear button with its own confirmation that lists what goes, next to the delete button', () => {
        assert.match(html, /id="privacy-clear"[^>]*aria-controls="privacy-clear-confirm"[^>]*aria-expanded="false"/);
        assert.match(html, /id="privacy-clear-confirm"[^>]*role="group"[^>]*hidden/);
        assert.match(html, /id="privacy-clear-list"/);
        assert.match(html, /id="privacy-clear-yes"/);
        assert.match(html, /id="privacy-clear-cancel"/);
        assert.match(html, /does not contact any server and does not delete an account/);
    });

    it('only clears from the confirmation button, and never calls the account deletion', () => {
        const at = controls.indexOf('P.clearLocalData(');
        assert.ok(at > -1);
        assert.ok(controls.lastIndexOf('function runClear', at) > -1, 'clearLocalData is called inside runClear');
        assert.match(controls, /clearYes\.addEventListener\('click', runClear\)/);
        const runClear = controls.slice(controls.indexOf('function runClear'), controls.indexOf('if (clearBtn && clearConfirm)'));
        assert.ok(!/deleteAccount|ReliefAPI/.test(runClear));
    });

    it('the documentation names the clear control and what it leaves alone', () => {
        const doc = read('docs/PRIVACY_AND_DATA.md');
        assert.match(doc, /Clear data stored in this browser/);
        assert.match(doc, /6\.5/);
    });
});

// ---------------------------------------------------------------------------
// Blocked storage and clears made in another tab (review follow-up on Issue #81)
// ---------------------------------------------------------------------------

// A Storage whose reads throw, like a browser that blocks site data.
function blockedStorage() {
    const boom = () => { throw new Error('SecurityError'); };
    return { get length() { return boom(); }, key: boom, getItem: boom, setItem: boom, removeItem: boom };
}

describe('blocked storage is not the same as empty storage', () => {
    it('isStorageReadable tells a working empty storage from a blocked one', () => {
        assert.strictEqual(P.isStorageReadable(memoryStorage({})), true);
        assert.strictEqual(P.isStorageReadable(memoryStorage({ relief_lang: 'en' })), true);
        assert.strictEqual(P.isStorageReadable(blockedStorage()), false);
        assert.strictEqual(P.isStorageReadable(null), false);
    });

    it('describeStored still returns [] for blocked storage, so callers must check readability first', () => {
        assert.deepStrictEqual(P.describeStored(blockedStorage()), []);
        assert.deepStrictEqual(P.describeStored(memoryStorage({})), []);
    });

    it('clearing blocked storage is "failed", never "nothing to clear"', () => {
        const r = P.clearLocalData(blockedStorage());
        assert.strictEqual(r.status, 'failed');
        assert.strictEqual(r.local.state, 'unavailable');
        // an empty but working storage stays "nothing"
        assert.strictEqual(P.clearLocalData(memoryStorage({})).status, 'nothing');
    });

    it('the failed result tells the user how to remove the data in the browser settings', () => {
        const t = P.describeClearResult(P.clearLocalData(blockedStorage()));
        assert.strictEqual(t.headline, 'Nothing was cleared.');
        assert.ok(t.lines.some((l) => l === P.MANUAL_CLEAR_NOTE));
        assert.match(P.MANUAL_CLEAR_NOTE, /browser settings/);
        assert.match(P.MANUAL_CLEAR_NOTE, /cannot see what is stored/);
    });
});

describe('isDashboardDataRemoval (storage event from another tab)', () => {
    const store = memoryStorage({});
    const ev = (over) => Object.assign({ key: 'relief_reminders_v1', oldValue: '[]', newValue: null, storageArea: store }, over);

    it('is true when the reminders or timeline key was removed, or storage was cleared', () => {
        assert.strictEqual(P.isDashboardDataRemoval(ev(), store), true);
        assert.strictEqual(P.isDashboardDataRemoval(ev({ key: 'relief_history_v1' }), store), true);
        assert.strictEqual(P.isDashboardDataRemoval(ev({ key: null }), store), true);
    });

    it('is false for a write, for other keys (a logout removes the session key) and for another storage area', () => {
        assert.strictEqual(P.isDashboardDataRemoval(ev({ newValue: '[{"id":"a"}]' }), store), false);
        assert.strictEqual(P.isDashboardDataRemoval(ev({ key: 'relief_auth_sessions' }), store), false);
        assert.strictEqual(P.isDashboardDataRemoval(ev({ key: 'theme' }), store), false);
        assert.strictEqual(P.isDashboardDataRemoval(ev({ storageArea: memoryStorage({}) }), store), false);
        assert.strictEqual(P.isDashboardDataRemoval(null, store), false);
        assert.strictEqual(P.isDashboardDataRemoval({}, store), false);
    });
});

// Runs the real privacy-controls.js against a tiny fake page.
function mountControls(options) {
    const opts = options || {};
    const listeners = { document: {}, window: {} };
    const make = (id) => {
        const el = {
            id, hidden: false, disabled: false, className: '', textContent: '', children: [], attrs: {},
            appendChild(c) { this.children.push(c); return c; },
            setAttribute(k, v) { this.attrs[k] = v; },
            addEventListener(type, fn) { (this.l = this.l || {})[type] = fn; },
            focus() { this.focused = true; },
            set innerHTML(v) { this.children = []; },
            get innerHTML() { return ''; },
            allText() { return [this.textContent].concat(this.children.map((c) => c.allText())).join(' '); }
        };
        return el;
    };
    const ids = ['privacy-delete', 'privacy-stored', 'privacy-confirm', 'privacy-confirm-title', 'privacy-confirm-yes',
        'privacy-confirm-cancel', 'privacy-status', 'privacy-clear', 'privacy-clear-confirm', 'privacy-clear-title',
        'privacy-clear-list', 'privacy-clear-other', 'privacy-clear-yes', 'privacy-clear-cancel'];
    const els = {};
    ids.forEach((id) => { els[id] = make(id); });
    const dispatched = [];
    const document = {
        getElementById: (id) => els[id] || null,
        createElement: () => make('x'),
        addEventListener: (type, fn) => { listeners.document[type] = fn; },
        dispatchEvent: (e) => { dispatched.push(e); return true; }
    };
    const window = {
        ReliefPrivacy: P,
        addEventListener: (type, fn) => { listeners.window[type] = fn; }
    };
    if (opts.blocked) {
        Object.defineProperty(window, 'localStorage', { get() { throw new Error('SecurityError'); } });
    } else {
        window.localStorage = opts.storage || memoryStorage({});
    }
    const ctx = vm.createContext({ window, document, CustomEvent: function (type, init) { this.type = type; this.detail = init && init.detail; } });
    new vm.Script(read('assets/js/privacy-controls.js')).runInContext(ctx);
    listeners.document.DOMContentLoaded();
    return { els, listeners, dispatched, window };
}

describe('privacy-controls.js with blocked storage', () => {
    it('does not say "nothing stored": the list and the confirmation say it is unknown and give the manual way', () => {
        {
            const page = mountControls({ blocked: true });
            const shown = page.els['privacy-stored'].allText();
            assert.match(shown, /Unknown/);
            assert.match(shown, /browser settings/);
            assert.doesNotMatch(shown, /has no data stored/);

            page.els['privacy-clear'].l.click();
            const box = page.els['privacy-clear-list'].allText();
            assert.match(box, /Unknown/);
            assert.match(box, /browser settings/);
            assert.doesNotMatch(box, /has no data stored/);
            assert.strictEqual(page.els['privacy-clear-yes'].disabled, true);
            assert.match(page.els['privacy-clear-other'].textContent, /cannot clear anything itself/);
        }
    });

    it('working but empty storage still says nothing is stored', () => {
        const page = mountControls({});
        assert.match(page.els['privacy-stored'].allText(), /has no data stored/);
        page.els['privacy-clear'].l.click();
        assert.match(page.els['privacy-clear-list'].allText(), /has no data stored/);
        assert.strictEqual(page.els['privacy-clear-yes'].disabled, true);
    });
});

describe('privacy-controls.js when another tab clears the data', () => {
    it('tells this tab to drop what it holds in memory, once per removal event, and says so', () => {
        const store = memoryStorage({ relief_reminders_v1: '[]' });
        const page = mountControls({ storage: store });
        const fire = page.listeners.window.storage;
        assert.strictEqual(typeof fire, 'function');

        fire({ key: 'relief_reminders_v1', newValue: null, storageArea: store });
        assert.strictEqual(page.dispatched.length, 1);
        assert.strictEqual(page.dispatched[0].type, 'relief:data-deleted');
        assert.strictEqual(page.dispatched[0].detail.otherTab, true);
        assert.notStrictEqual(page.dispatched[0].detail.local.state, 'unavailable');
        assert.match(page.els['privacy-status'].allText(), /cleared in another tab/);
        assert.strictEqual(page.els['privacy-status'].hidden, false);
    });

    it('ignores writes, unrelated keys and a different storage area', () => {
        const store = memoryStorage({});
        const page = mountControls({ storage: store });
        const fire = page.listeners.window.storage;
        fire({ key: 'relief_reminders_v1', newValue: '[]', storageArea: store });
        fire({ key: 'relief_auth_sessions', newValue: null, storageArea: store });
        fire({ key: 'relief_reminders_v1', newValue: null, storageArea: memoryStorage({}) });
        assert.strictEqual(page.dispatched.length, 0);
    });

    it('the dashboard handler that receives the event empties memory and stops saving (wiring)', () => {
        const dash = read('assets/js/dashboard.js');
        const at = dash.indexOf("addEventListener('relief:data-deleted'");
        assert.ok(at > -1);
        const body = dash.slice(at, at + 400);
        assert.match(body, /dataDeleted = true/);
        assert.match(body, /reminders = \[\]/);
        assert.match(body, /history\.length = 0/);
    });
});
