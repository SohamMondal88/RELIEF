/**
 * Tests for Issue #22: isolate demo authentication.
 * Mocks localStorage, ReliefAPI and the page host, then checks that the browser
 * only fallback runs in demo mode and never stores a plain password.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const Auth = require('../assets/js/auth-mode.js');

const PROD = { hostname: 'relief-gamma.vercel.app', protocol: 'https:' };
const LOCAL = { hostname: 'localhost', protocol: 'http:' };

function memoryStorage(initial) {
    const data = Object.assign({}, initial);
    return {
        getItem: (k) => (k in data ? data[k] : null),
        setItem: (k, v) => { data[k] = String(v); },
        removeItem: (k) => { delete data[k]; },
        data
    };
}

function authError(code, message) {
    const e = new Error(message || code);
    e.code = code;
    return e;
}

function apiThatReturns(user) {
    return {
        login: async () => user,
        signup: async () => user
    };
}

function apiThatThrows(error) {
    return {
        login: async () => { throw error; },
        signup: async () => { throw error; }
    };
}

function deps(overrides) {
    return Object.assign({
        api: null,
        storage: memoryStorage(),
        env: PROD,
        crypto: globalThis.crypto
    }, overrides);
}

describe('isDemoMode', () => {
    it('is on for localhost, 127.0.0.1 and IPv6 loopback', () => {
        ['localhost', 'LOCALHOST', '127.0.0.1', '[::1]'].forEach((hostname) => {
            assert.strictEqual(Auth.isDemoMode({ hostname }), true, hostname);
        });
    });

    it('is on for a file:// preview', () => {
        assert.strictEqual(Auth.isDemoMode({ hostname: '', protocol: 'file:' }), true);
    });

    it('is on only for an explicit flag or meta tag on other hosts', () => {
        assert.strictEqual(Auth.isDemoMode({ hostname: 'example.org', flag: true }), true);
        assert.strictEqual(Auth.isDemoMode({ hostname: 'example.org', metaContent: 'true' }), true);
        assert.strictEqual(Auth.isDemoMode({ hostname: 'example.org', flag: 'true' }), false);
        assert.strictEqual(Auth.isDemoMode({ hostname: 'example.org', metaContent: 'false' }), false);
    });

    it('is off for production hosts, including look-alikes of localhost', () => {
        ['relief-gamma.vercel.app', 'localhost.evil.com', '127.0.0.1.nip.io', 'notlocalhost', ''].forEach((hostname) => {
            assert.strictEqual(Auth.isDemoMode({ hostname, protocol: 'https:' }), false, hostname);
        });
        assert.strictEqual(Auth.isDemoMode(undefined), false);
    });
});

describe('login with the service available', () => {
    it('returns the service user and never touches the demo store', async () => {
        const storage = memoryStorage();
        const user = { uid: 'u1', email: 'a@b.co', name: 'A' };
        const result = await Auth.login('a@b.co', 'secret1', deps({ api: apiThatReturns(user), storage }));
        assert.deepStrictEqual(result, user);
        assert.ok(!(Auth.DEMO_USERS_KEY in storage.data));
    });
});

describe('login when the service is down', () => {
    it('fails on a production host when the service throws', async () => {
        const api = apiThatThrows(authError('auth/network-request-failed'));
        await assert.rejects(Auth.login('a@b.co', 'secret1', deps({ api })), (e) => {
            assert.strictEqual(e.message, Auth.UNAVAILABLE_MESSAGE);
            assert.strictEqual(e.kind, 'unavailable');
            return true;
        });
    });

    it('fails on a production host when there is no service at all', async () => {
        await assert.rejects(Auth.login('a@b.co', 'secret1', deps({ api: null })), /unavailable/i);
        await assert.rejects(Auth.signup('A', 'a@b.co', 'secret1', deps({ api: undefined })), /unavailable/i);
    });

    it('does not log in from a demo account that exists in storage on a production host', async () => {
        const storage = memoryStorage();
        await Auth.signup('A', 'a@b.co', 'secret1', deps({ storage, env: LOCAL }));
        await assert.rejects(Auth.login('a@b.co', 'secret1', deps({ storage, env: PROD })), /unavailable/i);
    });

    it('falls back to the demo store on localhost', async () => {
        const storage = memoryStorage();
        const api = apiThatThrows(new TypeError('Failed to fetch'));
        const created = await Auth.signup('Asha', 'asha@example.com', 'secret1', deps({ api, storage, env: LOCAL }));
        assert.strictEqual(created.demo, true);
        const user = await Auth.login('asha@example.com', 'secret1', deps({ api, storage, env: LOCAL }));
        assert.strictEqual(user.email, 'asha@example.com');
        assert.strictEqual(user.name, 'Asha');
        assert.strictEqual(user.demo, true);
    });

    it('falls back on a non-local host only with the explicit flag', async () => {
        const env = { hostname: 'staging.example.org', flag: true };
        const storage = memoryStorage();
        await Auth.signup('A', 'a@b.co', 'secret1', deps({ storage, env }));
        const user = await Auth.login('a@b.co', 'secret1', deps({ storage, env }));
        assert.strictEqual(user.demo, true);
    });
});

describe('wrong credentials never fall back', () => {
    const wrong = ['auth/wrong-password', 'auth/user-not-found', 'auth/invalid-credential'];

    wrong.forEach((code) => {
        it('login: ' + code + ' on localhost stays a failure even if a matching demo account exists', async () => {
            const storage = memoryStorage();
            await Auth.signup('A', 'a@b.co', 'secret1', deps({ storage, env: LOCAL }));
            const api = apiThatThrows(authError(code));
            await assert.rejects(Auth.login('a@b.co', 'secret1', deps({ api, storage, env: LOCAL })), (e) => {
                assert.strictEqual(e.message, 'Invalid email or password.');
                assert.strictEqual(e.kind, 'credentials');
                return true;
            });
        });
    });

    it('login: the service format error is a credentials failure, not an outage', async () => {
        const api = apiThatThrows(new Error('Invalid email or password format'));
        await assert.rejects(Auth.login('a@b.co', 'x', deps({ api, env: LOCAL })), { message: 'Invalid email or password.' });
    });

    it('signup: email already in use is reported and no demo account is created', async () => {
        const storage = memoryStorage();
        const api = apiThatThrows(authError('auth/email-already-in-use'));
        await assert.rejects(Auth.signup('A', 'a@b.co', 'secret1', deps({ api, storage, env: LOCAL })), /already in use/);
        assert.ok(!(Auth.DEMO_USERS_KEY in storage.data));
    });

    it('classifies errors', () => {
        assert.strictEqual(Auth.classifyError(authError('auth/wrong-password')), 'credentials');
        assert.strictEqual(Auth.classifyError(authError('auth/network-request-failed')), 'unavailable');
        assert.strictEqual(Auth.classifyError(new TypeError('Failed to fetch')), 'unavailable');
        assert.strictEqual(Auth.classifyError(null), 'unavailable');
    });
});

describe('demo account storage', () => {
    it('never saves the plain password, only a salted hash', async () => {
        const storage = memoryStorage();
        await Auth.signup('A', 'a@b.co', 'hunter2-password', deps({ storage, env: LOCAL }));
        const raw = storage.data[Auth.DEMO_USERS_KEY];
        assert.ok(!raw.includes('hunter2-password'));
        const record = JSON.parse(raw)[0];
        assert.ok(!('password' in record));
        assert.match(record.salt, /^[0-9a-f]{32}$/);
        assert.match(record.hash, /^[0-9a-f]{64}$/);
        assert.ok(record.iterations >= 100000);
        Object.keys(storage.data).forEach((k) => assert.ok(!storage.data[k].includes('hunter2-password'), k));
    });

    it('uses a different salt and hash for the same password', async () => {
        const storage = memoryStorage();
        await Auth.signup('A', 'a@b.co', 'same-password', deps({ storage, env: LOCAL }));
        await Auth.signup('B', 'b@b.co', 'same-password', deps({ storage, env: LOCAL }));
        const [a, b] = JSON.parse(storage.data[Auth.DEMO_USERS_KEY]);
        assert.notStrictEqual(a.salt, b.salt);
        assert.notStrictEqual(a.hash, b.hash);
    });

    it('rejects a wrong demo password and an unknown email', async () => {
        const storage = memoryStorage();
        await Auth.signup('A', 'a@b.co', 'secret1', deps({ storage, env: LOCAL }));
        await assert.rejects(Auth.login('a@b.co', 'secret2', deps({ storage, env: LOCAL })), { message: 'Invalid email or password.' });
        await assert.rejects(Auth.login('x@b.co', 'secret1', deps({ storage, env: LOCAL })), { message: 'Invalid email or password.' });
    });

    it('rejects a duplicate demo signup', async () => {
        const storage = memoryStorage();
        await Auth.signup('A', 'a@b.co', 'secret1', deps({ storage, env: LOCAL }));
        await assert.rejects(Auth.signup('A2', 'a@b.co', 'secret1', deps({ storage, env: LOCAL })), /already in use/);
        assert.strictEqual(JSON.parse(storage.data[Auth.DEMO_USERS_KEY]).length, 1);
    });

    it('removes the old plain-text relief_users store and does not trust it', async () => {
        const legacy = JSON.stringify([{ id: 'user_1', name: 'Old', email: 'old@b.co', password: 'plain-text' }]);
        const storage = memoryStorage({ [Auth.LEGACY_USERS_KEY]: legacy });
        await assert.rejects(Auth.login('old@b.co', 'plain-text', deps({ storage, env: LOCAL })), { message: 'Invalid email or password.' });
        assert.ok(!(Auth.LEGACY_USERS_KEY in storage.data));
    });

    it('also removes the legacy store on a production host', async () => {
        const storage = memoryStorage({ [Auth.LEGACY_USERS_KEY]: '[{"password":"x"}]' });
        await assert.rejects(Auth.login('a@b.co', 'secret1', deps({ storage, env: PROD })), /unavailable/i);
        assert.ok(!(Auth.LEGACY_USERS_KEY in storage.data));
    });

    it('survives corrupt stored data', async () => {
        const storage = memoryStorage({ [Auth.DEMO_USERS_KEY]: '{not json' });
        await assert.rejects(Auth.login('a@b.co', 'secret1', deps({ storage, env: LOCAL })), { message: 'Invalid email or password.' });
        const user = await Auth.signup('A', 'a@b.co', 'secret1', deps({ storage, env: LOCAL }));
        assert.strictEqual(user.email, 'a@b.co');
    });

    it('reports blocked or full storage instead of pretending the account exists', async () => {
        const storage = memoryStorage();
        storage.setItem = () => { throw new Error('QuotaExceededError'); };
        await assert.rejects(Auth.signup('A', 'a@b.co', 'secret1', deps({ storage, env: LOCAL })), (e) => e.kind === 'storage');
    });

    it('explains when the browser has no Web Crypto', async () => {
        await assert.rejects(
            Auth.signup('A', 'a@b.co', 'secret1', deps({ env: LOCAL, crypto: {} })),
            (e) => e.kind === 'demo-unsupported'
        );
    });
});

describe('demo notice and page wiring', () => {
    const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

    it('shows the demo notice only in demo mode', () => {
        const el = { textContent: '', hidden: true };
        assert.strictEqual(Auth.showDemoNotice(el, { env: LOCAL }), true);
        assert.strictEqual(el.hidden, false);
        assert.match(el.textContent, /not secure/i);
        assert.strictEqual(Auth.showDemoNotice(el, { env: PROD }), false);
        assert.strictEqual(el.hidden, true);
        assert.strictEqual(el.textContent, '');
        assert.strictEqual(Auth.showDemoNotice(null, { env: LOCAL }), false);
    });

    it('login and signup no longer touch localStorage or plain passwords', () => {
        ['assets/js/login.js', 'assets/js/signup.js'].forEach((f) => {
            const src = read(f);
            assert.ok(!/localStorage/.test(src), f + ' must not use localStorage directly');
            assert.ok(!/relief_users/.test(src), f);
            assert.ok(!/falling back to local auth/.test(src), f);
        });
    });

    it('login and signup pages load auth-mode.js before their script and carry a notice element', () => {
        [['pages/login.html', 'login.js'], ['pages/signup.html', 'signup.js']].forEach(([page, script]) => {
            const html = read(page);
            assert.ok(html.indexOf('auth-mode.js') > -1, page);
            assert.ok(html.indexOf('auth-mode.js') < html.indexOf(script), page);
            assert.match(html, /id="demo-notice"[^>]*hidden/, page);
        });
    });

    it('has no hardcoded credentials in the auth scripts', () => {
        ['assets/js/auth-mode.js', 'assets/js/login.js', 'assets/js/signup.js'].forEach((f) => {
            assert.ok(!/password\s*[:=]\s*['"][^'"]+['"]/i.test(read(f)), f);
        });
    });
});
