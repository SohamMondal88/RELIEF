/**
 * Tests for Issue #30: server-verified subscription state.
 * The state machine, the "never trust client state" rule, and the
 * ReliefAPI.verifySubscription() call with a mocked fetch (no real backend,
 * no keys, no network).
 */

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const S = require('../assets/js/subscription-state.js');
const ReliefAPI = require('../assets/js/api.js');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
// Comments are allowed to mention localStorage and friends; code is not.
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const SERVER_TIME = '2026-10-26T10:00:00Z';

function body(overrides) {
    return Object.assign({
        schemaVersion: 1,
        status: 'active',
        plan: 'plus',
        billingPeriod: 'monthly',
        features: ['priority_booking', 'pharmacy_discount'],
        currentPeriodEnd: '2026-11-26T00:00:00Z',
        cancelAtPeriodEnd: false,
        lastPaymentResult: 'succeeded',
        serverTime: SERVER_TIME
    }, overrides);
}

function jsonResponse(data, init) {
    const status = (init && init.status) || 200;
    const type = init && init.type !== undefined ? init.type : 'application/json';
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: (name) => (name.toLowerCase() === 'content-type' ? type : null) },
        json: async () => {
            if (data instanceof Error) throw data;
            return data;
        }
    };
}

describe('state machine: normalize()', () => {
    it('knows exactly the six states', () => {
        assert.deepStrictEqual(S.STATES, ['none', 'pending', 'active', 'past_due', 'cancelled', 'unknown']);
    });

    it('accepts a valid active response and unlocks only known features', () => {
        const r = S.normalize(body({ features: ['priority_booking', 'made_up_feature', 'priority_booking'] }));
        assert.strictEqual(r.state, 'active');
        assert.strictEqual(r.verified, true);
        assert.deepStrictEqual(S.entitlements(r), ['priority_booking']);
        assert.strictEqual(S.hasFeature(r, 'priority_booking'), true);
        assert.strictEqual(S.hasFeature(r, 'nurse_helpline'), false);
        assert.strictEqual(r.verifiedAt, '2026-10-26T10:00:00.000Z');
    });

    for (const status of ['none', 'pending', 'past_due', 'cancelled']) {
        it('grants nothing in "' + status + '" even if the server lists features', () => {
            const r = S.normalize(body({ status, features: ['priority_booking', 'nurse_helpline'] }));
            assert.strictEqual(r.state, status);
            assert.strictEqual(r.verified, true);
            assert.deepStrictEqual(S.entitlements(r), []);
            assert.deepStrictEqual(Array.from(r.features), []);
        });
    }

    it('turns malformed responses into "unknown" and grants nothing', () => {
        const bad = [
            null, undefined, 'active', 42, [], {},
            body({ schemaVersion: 2 }),
            body({ schemaVersion: undefined }),
            body({ status: 'paid' }),
            body({ status: 'ACTIVE' }),
            body({ status: undefined }),
            body({ plan: 'platinum' }),
            body({ plan: null }),                         // active needs a plan
            body({ serverTime: 'yesterday' }),
            body({ serverTime: undefined }),
            body({ currentPeriodEnd: null }),             // active needs an end date
            body({ currentPeriodEnd: 'soon' }),
            body({ currentPeriodEnd: '2026-10-01T00:00:00Z' }), // period already over by the server's clock
            body({ features: 'priority_booking' })
        ];
        bad.forEach((input, i) => {
            const r = S.normalize(input);
            assert.strictEqual(r.state, 'unknown', 'case ' + i);
            assert.strictEqual(r.verified, false, 'case ' + i);
            assert.strictEqual(r.reason, 'invalid-response', 'case ' + i);
            assert.deepStrictEqual(S.entitlements(r), [], 'case ' + i);
        });
    });

    it('judges the period by the server clock, not the browser clock', () => {
        const realNow = Date.now;
        Date.now = () => Date.parse('2030-01-01T00:00:00Z'); // browser clock far in the future
        try {
            assert.strictEqual(S.normalize(body()).state, 'active');
        } finally {
            Date.now = realNow;
        }
    });

    it('returns frozen results that cannot be edited into an upgrade', () => {
        const r = S.normalize(body({ status: 'past_due' }));
        assert.throws(() => { 'use strict'; r.state = 'active'; }, TypeError);
        assert.throws(() => { 'use strict'; r.features.push('nurse_helpline'); }, TypeError);
        assert.deepStrictEqual(S.entitlements(r), []);
    });
});

describe('verify(): the only way to get a state', () => {
    it('uses the server answer', async () => {
        const r = await S.verify({ verifySubscription: async () => body({ status: 'pending' }) });
        assert.strictEqual(r.state, 'pending');
        assert.strictEqual(r.verified, true);
    });

    it('is "unknown" when the call rejects, and never throws', async () => {
        const err = Object.assign(new Error('down'), { code: 'backend-unavailable' });
        const r = await S.verify({ verifySubscription: async () => { throw err; } });
        assert.strictEqual(r.state, 'unknown');
        assert.strictEqual(r.reason, 'unreachable');
        assert.deepStrictEqual(S.entitlements(r), []);
    });

    it('is "unknown" when the call throws synchronously', async () => {
        const r = await S.verify({ verifySubscription: () => { throw new Error('boom'); } });
        assert.strictEqual(r.state, 'unknown');
    });

    it('is "unknown" when the server never answers (timeout)', async () => {
        const r = await S.verify({ verifySubscription: () => new Promise(() => {}) }, { timeoutMs: 20 });
        assert.strictEqual(r.state, 'unknown');
        assert.strictEqual(r.reason, 'timeout');
    });

    it('is "unknown" when there is no API object or no verifySubscription method', async () => {
        assert.strictEqual((await S.verify(null)).reason, 'no-service');
        assert.strictEqual((await S.verify({})).reason, 'no-service');
    });

    it('keeps "not signed in" apart from "could not reach the server"', async () => {
        const err = Object.assign(new Error('401'), { code: 'unauthenticated' });
        const r = await S.verify({ verifySubscription: async () => { throw err; } });
        assert.strictEqual(r.state, 'unknown');
        assert.strictEqual(r.reason, 'unauthenticated');
    });
});

describe('never trust client-side state', () => {
    it('ignores a "paid" flag in localStorage when the server cannot be reached', async () => {
        const store = {
            relief_subscription: JSON.stringify({ state: 'active', plan: 'family', features: ['nurse_helpline'] }),
            isPremium: 'true',
            plan: 'family'
        };
        globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem() {}, removeItem() {} };
        try {
            const down = () => { throw Object.assign(new Error('offline'), { code: 'backend-unavailable' }); };
            const r = await S.verify({ verifySubscription: down });
            assert.strictEqual(r.state, 'unknown');
            assert.deepStrictEqual(S.entitlements(r), []);
        } finally {
            delete globalThis.localStorage;
        }
    });

    it('ignores ?status=success style URL parameters', async () => {
        globalThis.location = { search: '?payment=success&status=active&plan=family', hash: '#paid' };
        try {
            const r = await S.verify({ verifySubscription: async () => { throw new Error('offline'); } });
            assert.strictEqual(r.state, 'unknown');
            assert.deepStrictEqual(S.entitlements(r), []);
        } finally {
            delete globalThis.location;
        }
    });

    it('does not accept a hand-built "verified active" object', () => {
        const forged = { state: 'active', verified: true, plan: 'family', features: ['nurse_helpline', 'care_coordinator'] };
        assert.strictEqual(S.isVerified(forged), false);
        assert.deepStrictEqual(S.entitlements(forged), []);
        assert.strictEqual(S.hasFeature(forged, 'nurse_helpline'), false);
    });

    it('does not accept a result that went through JSON (localStorage) and back', () => {
        const real = S.normalize(body());
        assert.strictEqual(S.hasFeature(real, 'priority_booking'), true);
        const revived = JSON.parse(JSON.stringify(real));
        assert.strictEqual(S.isVerified(revived), false);
        assert.deepStrictEqual(S.entitlements(revived), []);
    });

    it('does not accept a copy of a verified result', () => {
        const real = S.normalize(body());
        const copy = Object.assign({}, real);
        assert.deepStrictEqual(S.entitlements(copy), []);
    });

    it('describe() does not show "active" for a forged object', () => {
        const info = S.describe({ state: 'active', verified: true, plan: 'family' });
        assert.match(info.title, /could not verify/i);
    });

    it('subscription code never touches storage, cookies or the URL', () => {
        ['assets/js/subscription-state.js', 'assets/js/subscription.js'].forEach((file) => {
            const code = stripComments(read(file));
            assert.doesNotMatch(code, /localStorage|sessionStorage|indexedDB|document\.cookie|location\.(search|hash|href)|URLSearchParams/, file);
        });
    });

    it('verifySubscription() in api.js never touches storage, cookies or the URL', () => {
        const src = stripComments(read('assets/js/api.js'));
        const start = src.indexOf('const verifySubscription');
        assert.ok(start !== -1);
        const snippet = src.slice(start, src.indexOf('\n', start));
        assert.doesNotMatch(snippet, /localStorage|sessionStorage|cookie|location/);
    });

    it('no script saves plan, payment or entitlement data in browser storage', () => {
        const dir = path.join(ROOT, 'assets', 'js');
        fs.readdirSync(dir).filter((f) => f.endsWith('.js')).forEach((file) => {
            const code = stripComments(fs.readFileSync(path.join(dir, file), 'utf8'));
            const writes = code.match(/(local|session)Storage\.setItem\(\s*[^,)]+/g) || [];
            writes.forEach((call) => {
                assert.doesNotMatch(call, /subscri|premium|entitle|payment|paid/i, file + ': ' + call);
            });
        });
    });
});

describe('messages', () => {
    const cases = {
        none: body({ status: 'none', plan: null, features: [], currentPeriodEnd: null }),
        pending: body({ status: 'pending' }),
        active: body(),
        past_due: body({ status: 'past_due' }),
        cancelled: body({ status: 'cancelled' })
    };

    it('every state has its own title and message', () => {
        const titles = new Set();
        Object.keys(cases).forEach((state) => {
            const info = S.describe(S.normalize(cases[state]));
            assert.ok(info.title && info.message, state);
            titles.add(info.title);
        });
        titles.add(S.describe(S.unknown('unreachable')).title);
        assert.strictEqual(titles.size, 6);
    });

    it('"unknown" says it could not verify and that benefits stay off', () => {
        const info = S.describe(S.unknown('unreachable'));
        assert.match(info.title, /could not verify/i);
        assert.match(info.message, /stay off/i);
        assert.strictEqual(info.retry, true);
        assert.strictEqual(info.tone, 'error');
    });

    it('an unusable server answer is not described as "could not reach"', () => {
        const info = S.describe(S.normalize({ status: 'active' }));
        assert.match(info.message, /answer we could not use/);
        assert.match(info.title, /could not verify/i);
    });

    it('pending says benefits are off until confirmed', () => {
        assert.match(S.describe(S.normalize(cases.pending)).message, /benefits stay off/i);
    });

    it('active names the plan and renewal date; cancel-at-period-end says it will not renew', () => {
        const info = S.describe(S.normalize(cases.active));
        assert.match(info.title, /Plus Care/);
        assert.match(info.message, /26 Nov 2026/);
        const ending = S.describe(S.normalize(body({ cancelAtPeriodEnd: true })));
        assert.match(ending.message, /will not renew/);
    });

    it('failed and cancelled states allow a safe retry', () => {
        assert.strictEqual(S.describe(S.normalize(cases.past_due)).retry, true);
        assert.match(S.describe(S.normalize(cases.past_due)).message, /try again safely/i);
        assert.match(S.describe(S.normalize(cases.cancelled)).message, /subscribe again/i);
        const failed = S.describe(S.normalize(body({ status: 'none', plan: null, features: [], currentPeriodEnd: null, lastPaymentResult: 'failed' })));
        assert.match(failed.message, /did not go through/i);
        assert.match(failed.message, /try again/i);
    });

    it('a refund is explained', () => {
        const info = S.describe(S.normalize(body({ status: 'cancelled', lastPaymentResult: 'refunded' })));
        assert.match(info.message, /refunded/i);
    });

    it('not signed in is told apart from a server problem', () => {
        assert.match(S.describe(S.unknown('unauthenticated')).title, /sign in/i);
    });
});

describe('ReliefAPI.verifySubscription() with a mocked fetch', () => {
    const realFetch = globalThis.fetch;
    afterEach(() => {
        globalThis.fetch = realFetch;
        delete globalThis.window;
    });

    function configure(url) {
        globalThis.window = { RELIEF_BACKEND_URL: url };
    }

    it('fails with backend-unavailable when no backend is configured (and does not call fetch)', async () => {
        let called = false;
        globalThis.fetch = async () => { called = true; return jsonResponse(body()); };
        await assert.rejects(() => ReliefAPI.verifySubscription(), { code: 'backend-unavailable' });
        assert.strictEqual(called, false);
    });

    it('refuses a plain-http backend that is not local', async () => {
        configure('http://api.example.org');
        globalThis.fetch = async () => jsonResponse(body());
        await assert.rejects(() => ReliefAPI.verifySubscription(), { code: 'backend-unavailable' });
    });

    it('sends a credentialed, uncached GET with no client-supplied plan or status', async () => {
        configure('https://api.example.org/');
        let seen;
        globalThis.fetch = async (url, init) => { seen = { url, init }; return jsonResponse(body()); };
        const data = await ReliefAPI.verifySubscription();
        assert.strictEqual(seen.url, 'https://api.example.org/v1/subscription');
        assert.strictEqual(seen.init.method, 'GET');
        assert.strictEqual(seen.init.credentials, 'include');
        assert.strictEqual(seen.init.cache, 'no-store');
        assert.strictEqual(seen.init.body, undefined);
        assert.strictEqual(data.status, 'active');
    });

    it('allows http for a local backend', async () => {
        configure('http://localhost:8080');
        globalThis.fetch = async () => jsonResponse(body());
        assert.strictEqual((await ReliefAPI.verifySubscription()).status, 'active');
    });

    it('maps failures to error codes and never returns a value', async () => {
        configure('https://api.example.org');
        const cases = [
            [() => { throw new TypeError('Failed to fetch'); }, 'backend-unavailable'],
            [async () => jsonResponse({}, { status: 500 }), 'backend-unavailable'],
            [async () => jsonResponse({}, { status: 503 }), 'backend-unavailable'],
            [async () => jsonResponse({}, { status: 401 }), 'unauthenticated'],
            [async () => jsonResponse({}, { status: 403 }), 'forbidden'],
            [async () => jsonResponse({}, { status: 429 }), 'rate-limited'],
            [async () => jsonResponse({}, { status: 404 }), 'rejected'],
            [async () => jsonResponse(body(), { type: 'text/html' }), 'backend-unavailable'],
            [async () => jsonResponse(new SyntaxError('bad json')), 'backend-unavailable']
        ];
        for (const [impl, code] of cases) {
            globalThis.fetch = impl;
            await assert.rejects(() => ReliefAPI.verifySubscription(), { code });
        }
    });

    it('end to end: a dead server means "could not verify", a good one means the server state', async () => {
        configure('https://api.example.org');
        globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
        const down = await S.verify(ReliefAPI);
        assert.strictEqual(down.state, 'unknown');
        assert.deepStrictEqual(S.entitlements(down), []);

        globalThis.fetch = async () => jsonResponse(body());
        const up = await S.verify(ReliefAPI);
        assert.strictEqual(up.state, 'active');
        assert.deepStrictEqual(S.entitlements(up), ['priority_booking', 'pharmacy_discount']);
    });

    it('a server that answers 200 with garbage still gives "unknown"', async () => {
        configure('https://api.example.org');
        globalThis.fetch = async () => jsonResponse({ status: 'active', plan: 'family', features: ['nurse_helpline'] });
        const r = await S.verify(ReliefAPI);
        assert.strictEqual(r.state, 'unknown');
        assert.deepStrictEqual(S.entitlements(r), []);
    });
});

describe('pages', () => {
    it('subscription page loads api.js, subscription-state.js, subscription.js in that order', () => {
        const html = read('pages/subscription.html');
        const a = html.indexOf('assets/js/api.js');
        const b = html.indexOf('assets/js/subscription-state.js');
        const c = html.indexOf('assets/js/subscription.js');
        assert.ok(a !== -1 && b !== -1 && c !== -1);
        assert.ok(a < b && b < c);
    });

    it('subscription page has a live status region and switched-off checkout buttons', () => {
        const html = read('pages/subscription.html');
        assert.match(html, /id="subscription-status"[^>]*aria-live="polite"/);
        const buttons = html.match(/<button class="btn btn-primary"[^>]*>/g) || [];
        assert.strictEqual(buttons.length, 4);
        buttons.forEach((b) => assert.match(b, /disabled/));
    });

    it('subscription page explains billing, renewal, cancellation and support before checkout', () => {
        const html = read('pages/subscription.html');
        ['Billing period', 'Renewal', 'Cancelling', 'Refunds', 'Support'].forEach((word) => {
            assert.ok(html.includes(word), word);
        });
    });

    it('dashboard no longer hard-codes plan benefits', () => {
        const html = read('pages/dashboard.html');
        assert.doesNotMatch(html, /Priority appointment slots|24\/7 nurse assistance|Discounted pharmacy deliveries/);
        assert.match(html, /id="plan-benefits"[^>]*hidden/);
        const a = html.indexOf('assets/js/api.js');
        const b = html.indexOf('assets/js/subscription-state.js');
        const c = html.indexOf('assets/js/subscription.js');
        assert.ok(a !== -1 && a < b && b < c);
    });

    it('api.js can load as a classic script (no ES module export, no Firebase needed)', () => {
        const src = read('assets/js/api.js');
        assert.doesNotMatch(src, /^\s*export\s/m);
        assert.doesNotThrow(() => new (require('node:vm').Script)(src, { filename: 'api.js' }));
    });
});
