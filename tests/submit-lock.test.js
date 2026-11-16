/**
 * Tests for Issue #172: one submission per attempt, and one idempotency key per attempt.
 * The lock itself, then the lock together with the health event and facility correction stores
 * and the real API client (fake fetch), and a check that the pages load the helper.
 *
 * node --test tests/submit-lock.test.js
 */

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const L = require('../assets/js/submit-lock.js');
const H = require('../assets/js/health-events.js');
const C = require('../assets/js/facility-corrections.js');
const U = require('../assets/js/facility-utils.js');
const ReliefAPI = require('../assets/js/api.js');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// A promise the test settles by hand, so "the request is still pending" is exact and not a timing guess.
function deferred() {
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

function counterKeys() {
    let n = 0;
    return () => 'key-' + (++n);
}

describe('submit lock', () => {
    it('ignores a second and third submit while one is pending', async () => {
        const lock = L.createSubmitLock({ newKey: counterKeys() });
        const gate = deferred();
        let calls = 0;
        const task = () => { calls += 1; return gate.promise; };

        const first = lock.run(task, { fingerprint: 'a' });
        const second = lock.run(task, { fingerprint: 'a' });
        const third = lock.run(task, { fingerprint: 'a' });
        assert.strictEqual(lock.isPending(), true);
        assert.deepStrictEqual(await second, { status: 'busy' });
        assert.deepStrictEqual(await third, { status: 'busy' });

        gate.resolve({ ok: true });
        const done = await first;
        assert.strictEqual(done.status, 'done');
        assert.strictEqual(calls, 1, 'only one request for a burst of submits');
        assert.strictEqual(lock.isPending(), false);
    });

    it('tells the page when it starts and stops being busy, once each', async () => {
        const changes = [];
        const lock = L.createSubmitLock({ onChange: (busy) => changes.push(busy) });
        const gate = deferred();
        const first = lock.run(() => gate.promise);
        lock.run(() => gate.promise);
        assert.deepStrictEqual(changes, [true], 'a refused submit does not toggle the page state');
        gate.resolve(1);
        await first;
        assert.deepStrictEqual(changes, [true, false]);
    });

    it('releases when the task rejects, so the form is never stuck', async () => {
        const changes = [];
        const lock = L.createSubmitLock({ onChange: (busy) => changes.push(busy) });
        const outcome = await lock.run(async () => { throw new Error('boom'); });
        assert.strictEqual(outcome.status, 'error');
        assert.strictEqual(outcome.error.message, 'boom');
        assert.strictEqual(lock.isPending(), false);
        assert.deepStrictEqual(changes, [true, false]);
        const again = await lock.run(async () => 'fine');
        assert.deepStrictEqual([again.status, again.value], ['done', 'fine']);
    });

    it('releases when the task throws before returning a promise', async () => {
        const lock = L.createSubmitLock();
        const outcome = await lock.run(() => { throw new TypeError('sync failure'); });
        assert.strictEqual(outcome.status, 'error');
        assert.strictEqual(lock.isPending(), false);
    });

    it('reuses the key for the same content after a rejection, a new key once it succeeded', async () => {
        const lock = L.createSubmitLock({ newKey: counterKeys() });
        const keys = [];
        const task = (attempt) => { keys.push(attempt.idempotencyKey); return Promise.resolve(); };
        const failing = (attempt) => { keys.push(attempt.idempotencyKey); return Promise.reject(new Error('network')); };

        await lock.run(failing, { fingerprint: 'same' });
        await lock.run(failing, { fingerprint: 'same' });
        await lock.run(task, { fingerprint: 'same' });
        await lock.run(task, { fingerprint: 'same' });
        assert.deepStrictEqual(keys, ['key-1', 'key-1', 'key-1', 'key-2']);
    });

    it('gives edited content a new key', async () => {
        const lock = L.createSubmitLock({ newKey: counterKeys() });
        const keys = [];
        const failing = (attempt) => { keys.push(attempt.idempotencyKey); return Promise.reject(new Error('network')); };
        await lock.run(failing, { fingerprint: 'one' });
        await lock.run(failing, { fingerprint: 'two' });
        await lock.run(failing, { fingerprint: 'one' });
        assert.deepStrictEqual(keys, ['key-1', 'key-2', 'key-3']);
    });

    it('keeps the key when a resolved value is a retryable failure, drops it for a final answer', async () => {
        const lock = L.createSubmitLock({ newKey: counterKeys() });
        const keys = [];
        const answer = (value) => (attempt) => { keys.push(attempt.idempotencyKey); return Promise.resolve(value); };
        const keepKey = (result) => result.kind === 'unavailable';

        await lock.run(answer({ ok: false, kind: 'unavailable' }), { fingerprint: 'f', keepKey });
        await lock.run(answer({ ok: false, kind: 'invalid' }), { fingerprint: 'f', keepKey });
        await lock.run(answer({ ok: true }), { fingerprint: 'f', keepKey });
        assert.deepStrictEqual(keys, ['key-1', 'key-1', 'key-2']);
    });

    it('fingerprints content, not the order the fields were written in', () => {
        assert.strictEqual(L.fingerprintOf({ a: '1', b: '2' }), L.fingerprintOf({ b: '2', a: '1' }));
        assert.notStrictEqual(L.fingerprintOf({ a: '1', b: '2' }), L.fingerprintOf({ a: '1', b: '3' }));
        assert.strictEqual(typeof L.fingerprintOf(), 'string');
    });

    it('makes unique keys', () => {
        const keys = new Set(Array.from({ length: 50 }, () => L.newKey()));
        assert.strictEqual(keys.size, 50);
    });

    it('setBusy marks the form busy and turns the button off, then restores both', () => {
        const attrs = {};
        const form = { setAttribute: (k, v) => { attrs[k] = v; }, removeAttribute: (k) => { delete attrs[k]; } };
        const button = { disabled: false };
        L.setBusy(form, button, true);
        assert.deepStrictEqual([attrs['aria-busy'], button.disabled], ['true', true]);
        L.setBusy(form, button, false);
        assert.deepStrictEqual([attrs['aria-busy'], button.disabled], [undefined, false]);
        assert.doesNotThrow(() => L.setBusy(null, null, true));
    });
});

const memoryStorage = () => {
    const data = {};
    return {
        getItem: (k) => (k in data ? data[k] : null),
        setItem: (k, v) => { data[k] = String(v); },
        removeItem: (k) => { delete data[k]; }
    };
};

const EVENT_INPUT = {
    title: 'Free Eye Camp', type: 'screening', startDate: '10-11-2026', startTime: '09:00', endDate: '', endTime: '15:00',
    district: 'Purulia', venue: 'Community hall, Raghunathpur', organiser: 'Lions Club Purulia',
    services: 'Vision test, Cataract screening', eligibility: 'Everyone', contactPhone: '+91 98300 12345',
    contactEmail: '', sourceUrl: '', website: ''
};
const NOW = Date.parse('2026-10-28T06:00:00Z');

const FACILITIES = U.normalizeFacilities([
    { id: 'fac-001', name: 'Alpha Hospital', type: 'hospital', district: 'Bankura', address: '1 Main Road, Bankura', phone: '+91 3242 250 201', hours: 'Mon to Sat 9:00 to 17:00', services: ['Emergency Care'], verified: true, source: 'WB Health Dept', lastChecked: '2026-10-01' }
]);
const CORRECTION_INPUT = { facilityId: 'fac-001', field: 'hours', proposedValue: 'Mon to Sun 8:00 to 20:00', sourceUrl: '', contact: '', website: '' };

const unavailable = (reason) => Object.assign(new Error('down'), { code: 'backend-unavailable', reason: reason || 'network', sent: true });

describe('submit lock with the health event store', () => {
    it('a double submit sends one event, and "Try again" after a failure reuses the key', async () => {
        const seen = [];
        const gate = deferred();
        let mode = 'hold';
        const api = {
            submitHealthEvent: async (body, options) => {
                seen.push(options.idempotencyKey);
                if (mode === 'hold') await gate.promise;
                if (mode === 'fail') throw unavailable();
                return { id: 'srv-1', status: 'pending' };
            }
        };
        const store = H.createStore({ api, storage: memoryStorage(), demo: false, now: () => NOW });
        const lock = L.createSubmitLock({ newKey: counterKeys() });
        const send = () => lock.run(
            (attempt) => store.submit(EVENT_INPUT, { idempotencyKey: attempt.idempotencyKey }),
            { fingerprint: L.fingerprintOf(EVENT_INPUT), keepKey: (r) => r.kind === 'unavailable' }
        );

        const first = send();
        const second = send();
        assert.strictEqual((await second).status, 'busy');
        mode = 'fail';
        gate.resolve();
        const failed = await first;
        assert.strictEqual(failed.value.kind, 'unavailable');
        assert.strictEqual(seen.length, 1, 'two submits, one request');

        const retry = await send();
        assert.strictEqual(retry.value.kind, 'unavailable');
        mode = 'ok';
        const success = await send();
        assert.strictEqual(success.value.ok, true);
        assert.deepStrictEqual(seen, ['key-1', 'key-1', 'key-1'], 'every retry of the same event carries the same key');

    });

    it('works without a key (older callers): the api is called with an undefined key', async () => {
        let options;
        const api = { submitHealthEvent: async (body, o) => { options = o; return { id: 'x' }; } };
        const store = H.createStore({ api, storage: memoryStorage(), demo: false, now: () => NOW });
        assert.strictEqual((await store.submit(EVENT_INPUT)).ok, true);
        assert.strictEqual(options.idempotencyKey, undefined);
    });
});

describe('submit lock with the facility correction store', () => {
    it('sends the key the page holds, again on a retry, instead of making a new one per store', async () => {
        const seen = [];
        let fail = true;
        const api = {
            submitFacilityCorrection: async (body, options) => {
                seen.push(options.idempotencyKey);
                if (fail) throw unavailable();
                return { id: 'srv-1', status: 'pending' };
            }
        };
        const lock = L.createSubmitLock({ newKey: counterKeys() });
        const send = () => {
            // The page builds a new store for every submit, so a key kept inside the store would be lost.
            const store = C.createStore({ api, storage: memoryStorage(), demo: false, facilities: FACILITIES, now: () => NOW });
            return lock.run(
                (attempt) => store.submit(CORRECTION_INPUT, { idempotencyKey: attempt.idempotencyKey }),
                { fingerprint: L.fingerprintOf(CORRECTION_INPUT), keepKey: (r) => r.kind === 'unavailable' }
            );
        };
        assert.strictEqual((await send()).value.kind, 'unavailable');
        fail = false;
        assert.strictEqual((await send()).value.ok, true);
        assert.deepStrictEqual(seen, ['key-1', 'key-1']);
    });

    it('still makes its own key when the caller gives none', async () => {
        const seen = [];
        const api = { submitFacilityCorrection: async (body, options) => { seen.push(options.idempotencyKey); return { id: 's' }; } };
        const store = C.createStore({ api, storage: memoryStorage(), demo: false, facilities: FACILITIES, now: () => NOW });
        await store.submit(CORRECTION_INPUT);
        assert.ok(seen[0], 'a key is still sent');
    });
});

describe('submit lock with the real API client', () => {
    const realFetch = globalThis.fetch;
    afterEach(() => {
        globalThis.fetch = realFetch;
        delete globalThis.window;
    });

    it('api.submitHealthEvent sends the key the caller passes and one is made when none is given', async () => {
        globalThis.window = { RELIEF_BACKEND_URL: 'https://api.example.test' };
        const headers = [];
        globalThis.fetch = async (url, init) => {
            headers.push(init.headers);
            return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ id: 'srv-1' }) };
        };
        await ReliefAPI.submitHealthEvent({ title: 'x' }, { idempotencyKey: 'page-key-1' });
        assert.strictEqual(headers[0]['Idempotency-Key'], 'page-key-1');
        await ReliefAPI.submitHealthEvent({ title: 'x' });
        assert.notStrictEqual(headers[1]['Idempotency-Key'], 'page-key-1');
    });

    it('a double submit through the lock, the store and the client makes one request', async () => {
        globalThis.window = { RELIEF_BACKEND_URL: 'https://api.example.test' };
        const gate = deferred();
        let requests = 0;
        globalThis.fetch = async () => {
            requests += 1;
            await gate.promise;
            return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ id: 'srv-1' }) };
        };
        const store = H.createStore({ api: ReliefAPI, storage: memoryStorage(), demo: false, now: () => NOW });
        const lock = L.createSubmitLock();
        const send = () => lock.run((attempt) => store.submit(EVENT_INPUT, { idempotencyKey: attempt.idempotencyKey }), { fingerprint: L.fingerprintOf(EVENT_INPUT) });
        const burst = [send(), send(), send()];
        gate.resolve();
        const outcomes = await Promise.all(burst);
        assert.deepStrictEqual(outcomes.map((o) => o.status), ['done', 'busy', 'busy']);
        assert.strictEqual(requests, 1);
    });
});

describe('the pages use the lock', () => {
    it('health events and hospitals load submit-lock.js before the scripts that use it', () => {
        const events = read('pages/health-events.html');
        assert.ok(events.indexOf('assets/js/submit-lock.js') !== -1);
        assert.ok(events.indexOf('assets/js/submit-lock.js') < events.indexOf('assets/js/health-events-ui.js'));
        const hospitals = read('pages/hospitals.html');
        assert.ok(hospitals.indexOf('assets/js/submit-lock.js') !== -1);
        assert.ok(hospitals.indexOf('assets/js/submit-lock.js') < hospitals.indexOf('assets/js/facility-corrections-ui.js'));
    });

    it('both submit handlers go through the lock and no longer toggle the button by hand', () => {
        for (const file of ['assets/js/health-events-ui.js', 'assets/js/facility-corrections-ui.js']) {
            const source = read(file);
            assert.match(source, /ReliefSubmitLock\.createSubmitLock/, file);
            assert.match(source, /lock\.run\(/, file);
            assert.doesNotMatch(source, /(button|submitButton)\.disabled\s*=/, file + ' leaves the button to the lock');
        }
    });
});
