/**
 * Tests for request resilience (error handling, retries, request ids, safe logging).
 *
 * node --test tests/request-resilience.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const R = require('../assets/js/request-resilience.js');
const ReliefAPI = require('../assets/js/api.js');

const realFetch = globalThis.fetch;
const sleeps = [];

test.beforeEach(() => {
  sleeps.length = 0;
  R.configure({ sleep: async (ms) => { sleeps.push(ms); }, random: () => 0.5, isOnline: () => true, log: () => {} });
  R.clearRecentErrors();
  globalThis.window = { RELIEF_BACKEND_URL: 'https://api.example.test' };
});
test.afterEach(() => {
  globalThis.fetch = realFetch;
  delete globalThis.window;
});

function res(body, { status = 200, headers = {} } = {}) {
  const h = Object.assign({ 'content-type': 'application/json' }, headers);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => (h[String(k).toLowerCase()] === undefined ? null : h[String(k).toLowerCase()]) },
    json: async () => body
  };
}

// ---------- classification ----------

test('classify: offline, timeout, 4xx and 5xx get distinct, actionable messages', () => {
  const offline = R.classify({ code: 'backend-unavailable', reason: 'offline' });
  const timeout = R.classify({ code: 'backend-unavailable', reason: 'timeout' });
  const auth = R.classify({ code: 'unauthenticated', status: 401 });
  const forbidden = R.classify({ code: 'forbidden', status: 403 });
  const limited = R.classify({ code: 'rate-limited', status: 429 });
  const bad = R.classify({ code: 'rejected', status: 422 });
  const server = R.classify({ code: 'backend-unavailable', reason: 'server', status: 503 });

  assert.deepStrictEqual([offline.kind, timeout.kind, auth.kind, forbidden.kind, limited.kind, bad.kind, server.kind],
    ['offline', 'timeout', 'unauthenticated', 'forbidden', 'rate-limited', 'rejected', 'server']);
  assert.strictEqual(offline.action, 'retry');
  assert.strictEqual(auth.action, 'sign-in');
  assert.strictEqual(bad.action, 'fix-input');
  assert.strictEqual(bad.retryable, false, 'repeating a rejected request cannot help');
  assert.strictEqual(server.retryable, true);
  for (const i of [offline, timeout, auth, forbidden, limited, bad, server]) {
    assert.ok(i.title && i.message, 'every kind has user-readable text');
    assert.doesNotMatch(i.message, /undefined|\[object|Error:|TypeError/);
  }
});

test('classify handles raw fetch/abort errors and garbage without throwing', () => {
  assert.strictEqual(R.classify(new TypeError('Failed to fetch')).kind, 'unavailable');
  assert.strictEqual(R.classify(Object.assign(new Error('x'), { name: 'AbortError' })).kind, 'timeout');
  assert.strictEqual(R.classify(null).kind, 'unknown');
  assert.strictEqual(R.classify('boom').kind, 'unknown');
});

test('classify never shows server-sent text', () => {
  const info = R.classify({ code: 'rejected', status: 400, message: 'SQL error near password=hunter2', details: { secret: 1 } });
  assert.doesNotMatch(JSON.stringify(info), /hunter2|SQL/);
});

// ---------- request ids ----------

test('request ids come from headers or body, and odd values are dropped', () => {
  assert.strictEqual(R.extractRequestId(res({}, { headers: { 'x-request-id': 'req_abc12345' } })), 'req_abc12345');
  assert.strictEqual(R.extractRequestId(res({}), { requestId: 'body-id-9999' }), 'body-id-9999');
  assert.strictEqual(R.extractRequestId(res({})), null);
  assert.strictEqual(R.extractRequestId(res({}, { headers: { 'x-request-id': 'has spaces and <script>' } })), null);
  assert.strictEqual(R.extractRequestId(res({}, { headers: { 'x-request-id': 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig' } })), null);
  assert.strictEqual(R.sanitizeRequestId('x'.repeat(65)), null);
});

test('support reference includes kind, status and request id only', () => {
  const info = R.classify({ code: 'backend-unavailable', reason: 'server', status: 502, requestId: 'req_123456' });
  assert.strictEqual(R.supportReference(info), 'server-502 ref req_123456');
});

test('Retry-After is parsed from seconds and dates', () => {
  assert.strictEqual(R.parseRetryAfter('3'), 3000);
  assert.strictEqual(R.parseRetryAfter('nonsense'), null);
  assert.strictEqual(R.parseRetryAfter(new Date(10_000).toUTCString(), 4_000), 6000);
});

// ---------- retry policy ----------

test('retry: transient failures are retried with backoff, then succeed', async () => {
  let calls = 0;
  const out = await R.retry(async () => {
    calls += 1;
    if (calls < 3) throw Object.assign(new Error('x'), { code: 'backend-unavailable', reason: 'server', status: 503 });
    return 'ok';
  }, { method: 'GET' });
  assert.strictEqual(out, 'ok');
  assert.strictEqual(calls, 3);
  assert.strictEqual(sleeps.length, 2);
  assert.ok(sleeps[1] >= sleeps[0], 'delay does not shrink');
});

test('retry: gives up after the limit and reports the last error with the attempt count', async () => {
  let calls = 0;
  await assert.rejects(
    () => R.retry(async () => { calls += 1; throw Object.assign(new Error('x'), { code: 'backend-unavailable', reason: 'timeout' }); }, { method: 'GET', retries: 2 }),
    (e) => e.attempts === 3
  );
  assert.strictEqual(calls, 3);
});

test('retry: 4xx (other than 408/429) is never retried', async () => {
  for (const status of [400, 401, 403, 404, 422]) {
    let calls = 0;
    await assert.rejects(() => R.retry(async () => { calls += 1; throw Object.assign(new Error('x'), { status }); }, { method: 'GET' }));
    assert.strictEqual(calls, 1, 'status ' + status);
  }
});

test('retry: a long Retry-After is not waited out', async () => {
  let calls = 0;
  await assert.rejects(() => R.retry(async () => { calls += 1; throw Object.assign(new Error('x'), { status: 429, code: 'rate-limited', retryAfterMs: 60000 }); }, { method: 'GET' }));
  assert.strictEqual(calls, 1);
  assert.strictEqual(sleeps.length, 0);
});

test('retry: a short Retry-After is honoured', async () => {
  let calls = 0;
  await R.retry(async () => {
    calls += 1;
    if (calls === 1) throw Object.assign(new Error('x'), { status: 429, code: 'rate-limited', retryAfterMs: 1500 });
    return 1;
  }, { method: 'GET' });
  assert.deepStrictEqual(sleeps, [1500]);
});

test('retry: a write that may have reached the server is not repeated', async () => {
  for (const err of [
    { code: 'backend-unavailable', reason: 'timeout', sent: true },
    { code: 'backend-unavailable', reason: 'network', sent: true },
    { code: 'backend-unavailable', reason: 'server', status: 500, sent: true }
  ]) {
    let calls = 0;
    await assert.rejects(() => R.retry(async () => { calls += 1; throw Object.assign(new Error('x'), err); }, { method: 'POST' }));
    assert.strictEqual(calls, 1, JSON.stringify(err));
  }
});

test('retry: a write that never left the browser can be repeated', async () => {
  let calls = 0;
  const out = await R.retry(async () => {
    calls += 1;
    if (calls === 1) throw Object.assign(new Error('x'), { code: 'backend-unavailable', reason: 'offline', sent: false });
    return 'sent';
  }, { method: 'POST' });
  assert.strictEqual(out, 'sent');
  assert.strictEqual(calls, 2);
});

test('idempotency keys are unique and non-empty', () => {
  const keys = new Set(Array.from({ length: 50 }, () => R.newIdempotencyKey()));
  assert.strictEqual(keys.size, 50);
});

// ---------- ReliefAPI end to end with a mocked fetch ----------

test('API: GET retries a 503 then succeeds', async () => {
  let calls = 0;
  globalThis.fetch = async () => (++calls < 3 ? res({}, { status: 503 }) : res({ corrections: [] }));
  const out = await ReliefAPI.listFacilityCorrections({});
  assert.deepStrictEqual(out, { corrections: [] });
  assert.strictEqual(calls, 3);
});

test('API 5xx: surfaces a server error with the request id after retries', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return res({}, { status: 500, headers: { 'x-request-id': 'req_500500' } }); };
  await assert.rejects(() => ReliefAPI.listFacilityCorrections({}), (e) => {
    assert.strictEqual(e.code, 'backend-unavailable');
    assert.strictEqual(e.reason, 'server');
    assert.strictEqual(e.requestId, 'req_500500');
    assert.strictEqual(R.classify(e).kind, 'server');
    return true;
  });
  assert.strictEqual(calls, 3, 'one try plus two retries');
});

test('API 4xx: is not retried and keeps its code', async () => {
  for (const [status, code] of [[400, 'rejected'], [401, 'unauthenticated'], [403, 'forbidden'], [404, 'rejected'], [422, 'rejected']]) {
    let calls = 0;
    globalThis.fetch = async () => { calls += 1; return res({ errors: { f: 'bad' } }, { status, headers: { 'x-request-id': 'req_4xx4xx' } }); };
    await assert.rejects(() => ReliefAPI.listFacilityCorrections({}), (e) => e.code === code && e.requestId === 'req_4xx4xx');
    assert.strictEqual(calls, 1, 'status ' + status);
  }
});

test('API 429 with a short Retry-After is retried once it passes', async () => {
  let calls = 0;
  globalThis.fetch = async () => (++calls === 1 ? res({}, { status: 429, headers: { 'retry-after': '1' } }) : res({ corrections: [] }));
  await ReliefAPI.listFacilityCorrections({});
  assert.strictEqual(calls, 2);
  assert.deepStrictEqual(sleeps, [1000]);
});

test('API network failure: reads are retried, error is classified', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new TypeError('Failed to fetch'); };
  await assert.rejects(() => ReliefAPI.listFacilityCorrections({}), (e) => e.reason === 'network' && R.classify(e).retryable);
  assert.strictEqual(calls, 3);
});

test('API offline: fails fast without sending and says offline', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return res({}); };
  const realNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true });
  R.configure({ isOnline: () => false });
  try {
    await assert.rejects(() => ReliefAPI.submitFacilityCorrection({ a: 1 }), (e) => {
      assert.strictEqual(e.reason, 'offline');
      assert.strictEqual(R.classify(e).kind, 'offline');
      return true;
    });
    assert.strictEqual(calls, 0, 'nothing was sent while offline');
  } finally {
    if (realNav) Object.defineProperty(globalThis, 'navigator', realNav); else delete globalThis.navigator;
  }
});

test('API timeout: aborts, classifies as timeout, and does NOT resend a write', async () => {
  let calls = 0;
  globalThis.fetch = (url, init) => { calls += 1; return new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  }); };
  // reach backendRequest's timeoutMs via the real timers with a tiny timeout
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...a) => realSetTimeout(fn, ms === 8000 ? 5 : ms, ...a);
  try {
    await assert.rejects(() => ReliefAPI.submitFacilityCorrection({ a: 1 }), (e) => e.reason === 'timeout' && R.classify(e).kind === 'timeout');
    assert.strictEqual(calls, 1, 'a write that may have been received is not repeated automatically');
    calls = 0;
    await assert.rejects(() => ReliefAPI.listFacilityCorrections({}), (e) => e.reason === 'timeout');
    assert.strictEqual(calls, 3, 'a read is retried');
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
});

test('API submissions: same idempotency key on a user retry, new key for new submission', async () => {
  const keys = [];
  let fail = true;
  globalThis.fetch = async (url, init) => {
    keys.push(init.headers['Idempotency-Key']);
    if (fail) return res({}, { status: 500 });
    return res({ ok: true });
  };
  const first = await ReliefAPI.submitFacilityCorrection({ a: 1 }).catch((e) => e);
  assert.ok(first.idempotencyKey, 'the failed call exposes its key so the UI can reuse it');
  assert.strictEqual(keys.length, 1, 'a 500 on a write is not auto-repeated');
  fail = false;
  await ReliefAPI.submitFacilityCorrection({ a: 1 }, { idempotencyKey: first.idempotencyKey });
  assert.strictEqual(keys[1], keys[0], 'the retry reuses the key');
  await ReliefAPI.submitFacilityCorrection({ a: 2 });
  assert.notStrictEqual(keys[2], keys[0], 'a new submission gets a new key');
});

test('API GET does not send an idempotency key', async () => {
  let headers;
  globalThis.fetch = async (url, init) => { headers = init.headers; return res({ corrections: [] }); };
  await ReliefAPI.listFacilityCorrections({});
  assert.strictEqual(headers['Idempotency-Key'], undefined);
});

// ---------- logging ----------

test('redact removes passwords, tokens, emails, phone numbers and health details', () => {
  const out = R.redact({
    password: 'hunter2', token: 'abc', Authorization: 'Bearer abc.def.ghi', symptoms: ['chest pain'],
    note: 'I am diabetic', email: 'a@b.co', status: 500, path: '/v1/x?token=SECRET123&a=1',
    message: 'call +91 98765 43210', nested: { apiKey: 'k', ok: 'fine' }
  });
  const text = JSON.stringify(out);
  for (const leak of ['hunter2', 'abc.def', 'chest pain', 'diabetic', 'a@b.co', 'SECRET123', '98765', '"k"']) {
    assert.ok(!text.includes(leak), 'leaked: ' + leak);
  }
  assert.strictEqual(out.status, 500);
  assert.strictEqual(out.nested.ok, 'fine');
});

test('redact scrubs secrets that sit inside plain strings', () => {
  const s = R.redact('Bearer abcDEF123.456 and eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc-def user me@x.org');
  assert.doesNotMatch(s, /abcDEF123|eyJhbGci|me@x\.org/);
});

test('safeUrl drops query strings, fragments and credentials', () => {
  assert.strictEqual(R.safeUrl('https://u:p@api.example.test/v1/a?token=1&q=chest+pain#frag'), 'https://api.example.test/v1/a');
});

test('logError records only safe fields and never request bodies or server text', async () => {
  const lines = [];
  R.configure({ log: (e) => lines.push(e) });
  globalThis.fetch = async () => res({ error: 'bad password for me@x.org', diagnosis: 'flu' }, { status: 500, headers: { 'x-request-id': 'req_logged1' } });
  await assert.rejects(() => ReliefAPI.submitFacilityCorrection({
    facilityId: 'f1', proposedValue: 'secret health note', contact: 'me@x.org', password: 'hunter2'
  }));
  assert.ok(lines.length >= 1);
  const text = JSON.stringify(lines) + R.diagnosticsText();
  for (const leak of ['hunter2', 'me@x.org', 'secret health note', 'diagnosis', 'bad password', 'flu']) {
    assert.ok(!text.includes(leak), 'logged: ' + leak);
  }
  assert.strictEqual(lines[0].requestId, 'req_logged1');
  assert.strictEqual(lines[0].status, 500);
});

test('logError never throws even if the logger does', () => {
  R.configure({ log: () => { throw new Error('console is broken'); } });
  assert.doesNotThrow(() => R.logError('x', new Error('y')));
});

// ---------- degrade + states ----------

test('degrade: a failing non-critical feature falls back instead of throwing', async () => {
  let seen;
  const value = await R.degrade('map', async () => { throw new TypeError('Failed to fetch'); }, {
    fallbackValue: 'list-only', onFallback: (info) => { seen = info; }
  });
  assert.strictEqual(value, 'list-only');
  assert.ok(seen && seen.message);
  assert.strictEqual(R.recentErrors()[0].context, 'degraded:map');
});

test('describeState: loading, empty, success and error are consistent and accessible', () => {
  const loading = R.describeState({ state: 'loading' });
  const empty = R.describeState({ state: 'empty', message: 'No results' });
  const success = R.describeState({ state: 'success', message: 'Saved' });
  const error = R.describeState({ state: 'error', error: { code: 'backend-unavailable', reason: 'timeout', requestId: 'req_state01' } });
  assert.strictEqual(loading.role, 'status');
  assert.strictEqual(empty.message, 'No results');
  assert.strictEqual(success.role, 'status');
  assert.strictEqual(error.role, 'alert');
  assert.strictEqual(error.retry, true);
  assert.match(error.reference, /req_state01/);
  const rejected = R.describeState({ state: 'error', error: { code: 'rejected', status: 400 } });
  assert.strictEqual(rejected.retry, false, 'no useless Try again for a request that cannot succeed');
  assert.strictEqual(R.describeState({ state: 'bogus' }).state, 'error');
});

test('error state with emergency flag tells people what to do if urgent', () => {
  const html = [];
  const el = { appendChild: () => {}, set innerHTML(v) { html.push(v); }, get innerHTML() { return ''; } };
  const fakeDoc = { createElement: () => ({ setAttribute() {}, appendChild() {}, set innerHTML(v) { html.push(v); }, addEventListener() {} }) };
  globalThis.document = fakeDoc;
  try { R.renderState(el, { state: 'error', error: { code: 'backend-unavailable', reason: 'offline' }, emergency: true }, () => {}); }
  finally { delete globalThis.document; }
  assert.match(html.join(' '), /emergency number/);
});
