/**
 * Tests for the public form guard (Issue #56).
 *
 * node --test tests/form-guard.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const FormGuard = require('../assets/js/form-guard.js');

function memoryStorage(initial) {
  const data = Object.assign({}, initial);
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
    dump: () => data
  };
}

function setup(options, extra) {
  const clock = { t: 1_000_000 };
  const storage = (extra && extra.storage) || memoryStorage();
  const guard = FormGuard.createGuard('contact', options, {
    now: () => clock.t,
    storage,
    config: (extra && extra.config) || {}
  });
  clock.t += 5000; // the user spent a few seconds on the form
  return { guard, clock, storage };
}

const ok = async () => 'sent';

// ---------- Invalid submissions ----------

test('honeypot filled is rejected without revealing why', async () => {
  const { guard } = setup();
  const result = await guard.run(ok, { honeypot: 'http://spam.example' });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'bot');
  assert.ok(!/honeypot|bot/i.test(result.message));
});

test('submitting faster than minFillMs is rejected but recoverable', async () => {
  const clock = { t: 0 };
  const guard = FormGuard.createGuard('contact', { minFillMs: 2000 }, {
    now: () => clock.t, storage: memoryStorage(), config: {}
  });
  clock.t += 500;
  const early = await guard.run(ok);
  assert.strictEqual(early.reason, 'too-fast');

  clock.t += 3000;
  const later = await guard.run(ok);
  assert.strictEqual(later.ok, true);
});

test('rejected bot / too-fast attempts do not consume the rate limit', async () => {
  const { guard } = setup({ maxAttempts: 1 });
  await guard.run(ok, { honeypot: 'x' });
  const result = await guard.run(ok);
  assert.strictEqual(result.ok, true);
});

// ---------- Repeated submissions ----------

test('allows maxAttempts then throttles with a retry time', async () => {
  const { guard } = setup({ maxAttempts: 3, windowMs: 60000 });
  for (let i = 0; i < 3; i++) {
    assert.strictEqual((await guard.run(ok)).ok, true);
  }
  const blocked = await guard.run(ok);
  assert.strictEqual(blocked.ok, false);
  assert.strictEqual(blocked.reason, 'rate-limited');
  assert.ok(blocked.retryAfterMs > 0 && blocked.retryAfterMs <= 60000);
  assert.match(blocked.message, /wait \d+ (second|seconds|minute|minutes)/);
});

test('user recovers once the window has passed', async () => {
  const { guard, clock } = setup({ maxAttempts: 2, windowMs: 10000 });
  await guard.run(ok);
  await guard.run(ok);
  assert.strictEqual((await guard.run(ok)).reason, 'rate-limited');

  clock.t += 10001;
  assert.strictEqual((await guard.run(ok)).ok, true);
});

test('window slides: only the oldest attempt expires first', async () => {
  const { guard, clock } = setup({ maxAttempts: 2, windowMs: 10000 });
  await guard.run(ok); // t0
  clock.t += 6000;
  await guard.run(ok); // t0 + 6s
  clock.t += 5000; // first attempt is now 11s old, second 5s old
  assert.strictEqual((await guard.run(ok)).ok, true);
  assert.strictEqual((await guard.run(ok)).reason, 'rate-limited');
});

test('the limit survives a page reload (new guard, same storage)', async () => {
  const storage = memoryStorage();
  const first = setup({ maxAttempts: 1 }, { storage });
  await first.guard.run(ok);

  const reloaded = FormGuard.createGuard('contact', { maxAttempts: 1, minFillMs: 0 }, {
    now: () => first.clock.t, storage, config: {}
  });
  assert.strictEqual((await reloaded.run(ok)).reason, 'rate-limited');
});

test('different forms are limited independently', async () => {
  const storage = memoryStorage();
  const clock = { t: 100000 };
  const env = { now: () => clock.t, storage, config: {} };
  const contact = FormGuard.createGuard('contact', { maxAttempts: 1, minFillMs: 0 }, env);
  const login = FormGuard.createGuard('login', { maxAttempts: 1, minFillMs: 0 }, env);
  await contact.run(ok);
  assert.strictEqual((await contact.run(ok)).reason, 'rate-limited');
  assert.strictEqual((await login.run(ok)).ok, true);
});

test('status() reports limited state for disabling the button', async () => {
  const { guard } = setup({ maxAttempts: 1 });
  assert.strictEqual(guard.status().limited, false);
  await guard.run(ok);
  assert.strictEqual(guard.status().limited, true);
  assert.ok(guard.status().retryAfterMs > 0);
});

// ---------- Concurrent submissions ----------

test('two simultaneous submits: only one reaches the backend', async () => {
  const { guard } = setup({ maxAttempts: 5 });
  let calls = 0;
  const slow = () => new Promise((resolve) => setTimeout(() => { calls++; resolve('done'); }, 20));

  const [a, b] = await Promise.all([guard.run(slow), guard.run(slow)]);
  assert.strictEqual(calls, 1);
  assert.deepStrictEqual([a.ok, b.ok].sort(), [false, true]);
  const rejected = a.ok ? b : a;
  assert.strictEqual(rejected.reason, 'busy');
});

test('a burst of 20 concurrent submits sends exactly one request', async () => {
  const { guard } = setup({ maxAttempts: 50 });
  let calls = 0;
  const slow = () => new Promise((resolve) => setTimeout(() => { calls++; resolve(); }, 10));
  const results = await Promise.all(Array.from({ length: 20 }, () => guard.run(slow)));
  assert.strictEqual(calls, 1);
  assert.strictEqual(results.filter((r) => r.ok).length, 1);
});

test('the lock is released after a failure so the user can retry', async () => {
  const { guard } = setup({ maxAttempts: 5 });
  const failed = await guard.run(async () => { throw new Error('Network down'); });
  assert.strictEqual(failed.ok, false);
  assert.strictEqual(failed.message, 'Network down');
  assert.strictEqual((await guard.run(ok)).ok, true);
});

// ---------- Failure-only counting (login) ----------

test('countFailuresOnly: successes never throttle', async () => {
  const { guard } = setup({ maxAttempts: 2, countFailuresOnly: true });
  for (let i = 0; i < 5; i++) {
    assert.strictEqual((await guard.run(ok)).ok, true);
  }
});

test('countFailuresOnly: repeated failures throttle and a success resets', async () => {
  const { guard, clock } = setup({ maxAttempts: 3, countFailuresOnly: true, windowMs: 60000 });
  const bad = async () => { throw new Error('Invalid email or password.'); };

  await guard.run(bad);
  await guard.run(bad);
  const third = await guard.run(bad);
  assert.match(third.message, /Too many attempts/); // warned as soon as the limit is reached
  assert.strictEqual((await guard.run(ok)).reason, 'rate-limited');

  clock.t += 60001;
  assert.strictEqual((await guard.run(ok)).ok, true);
  assert.strictEqual(guard.status().limited, false);
});

test('failure messages from the backend are passed through while under the limit', async () => {
  const { guard } = setup({ maxAttempts: 5, countFailuresOnly: true });
  const result = await guard.run(async () => { throw new Error('Invalid email or password.'); });
  assert.strictEqual(result.message, 'Invalid email or password.');
});

// ---------- Robustness ----------

test('corrupt stored data is ignored', async () => {
  const storage = memoryStorage({ relief_formguard_contact: '{not json' });
  const { guard } = setup({ maxAttempts: 1 }, { storage });
  assert.strictEqual((await guard.run(ok)).ok, true);
});

test('timestamps from the future (clock change) do not lock the user out', async () => {
  const storage = memoryStorage({
    relief_formguard_contact: JSON.stringify([9e15, 9e15, 9e15, 9e15])
  });
  const { guard } = setup({ maxAttempts: 1 }, { storage });
  assert.strictEqual((await guard.run(ok)).ok, true);
});

test('a throwing storage falls back to memory and still limits', async () => {
  const broken = {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('quota'); },
    removeItem() { throw new Error('denied'); }
  };
  const { guard } = setup({ maxAttempts: 1 }, { storage: broken });
  assert.strictEqual((await guard.run(ok)).ok, true);
  assert.strictEqual((await guard.run(ok)).reason, 'rate-limited');
});

// ---------- Configuration ----------

test('limits are configurable through the global config object', async () => {
  const { guard } = setup(undefined, { config: { contact: { maxAttempts: 1, windowMs: 5000 } } });
  assert.strictEqual(guard.config.maxAttempts, 1);
  assert.strictEqual(guard.config.windowMs, 5000);
  await guard.run(ok);
  assert.strictEqual((await guard.run(ok)).reason, 'rate-limited');
});

test('explicit options win over global config; invalid values fall back to defaults', () => {
  const cfg = FormGuard.resolveConfig('contact', { maxAttempts: 7, windowMs: -5 }, { contact: { maxAttempts: 1 } });
  assert.strictEqual(cfg.maxAttempts, 7);
  assert.strictEqual(cfg.windowMs, FormGuard.DEFAULTS.windowMs);
});

test('createGuard requires a form id', () => {
  assert.throws(() => FormGuard.createGuard(''), /formId/);
});

test('error messages do not leak implementation details', async () => {
  const { guard } = setup({ maxAttempts: 1 });
  await guard.run(ok);
  const blocked = await guard.run(ok);
  assert.ok(!/localStorage|relief_formguard|window|storage/i.test(blocked.message));
});

test('formatWait rounds up and pluralises', () => {
  assert.strictEqual(FormGuard.formatWait(1), '1 second');
  assert.strictEqual(FormGuard.formatWait(1500), '2 seconds');
  assert.strictEqual(FormGuard.formatWait(61000), '2 minutes');
});
