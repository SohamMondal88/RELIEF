/**
 * Tests for Issue #173: one fetch helper with a timeout, cancellation and classified failures.
 * ReliefResilience.fetchJson and createRequestSlot, the places that use them (place lookup, the
 * Nominatim search helpers in api.js) and a check that the pages load the helper first.
 *
 * node --test tests/fetch-json.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const R = require('../assets/js/request-resilience.js');
const RL = require('../assets/js/location-service.js');
const ReliefAPI = require('../assets/js/api.js');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const realFetch = globalThis.fetch;

test.beforeEach(() => {
  R.configure({ sleep: async () => {}, random: () => 0.5, isOnline: () => true, log: () => {} });
  R.clearRecentErrors();
});
test.afterEach(() => {
  globalThis.fetch = realFetch;
});

function response(body, { status = 200, headers = {}, text } = {}) {
  const h = Object.assign({ 'content-type': 'application/json' }, headers);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => (h[String(k).toLowerCase()] === undefined ? null : h[String(k).toLowerCase()]) },
    text: async () => (text !== undefined ? text : JSON.stringify(body)),
    json: async () => body
  };
}

// A fetch that never answers on its own. It records the signal it was given and rejects when that fires, like a real one.
function stalledFetch(seen) {
  return (url, init) => new Promise((resolve, reject) => {
    if (seen) seen.push({ url, init });
    if (init && init.signal) {
      init.signal.addEventListener('abort', () => reject(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' })));
    }
  });
}

const failure = async (promise) => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  assert.fail('expected the promise to reject');
};

// ---------- fetchJson ----------

test('fetchJson resolves with the parsed JSON and sends the extra init options', async () => {
  const seen = [];
  const fakeFetch = async (url, init) => { seen.push({ url, init }); return response({ events: [1, 2] }); };
  const data = await R.fetchJson('/data.json', { fetch: fakeFetch, init: { cache: 'no-cache', headers: { Accept: 'application/json' } } });
  assert.deepStrictEqual(data, { events: [1, 2] });
  assert.strictEqual(seen[0].url, '/data.json');
  assert.strictEqual(seen[0].init.cache, 'no-cache');
  assert.deepStrictEqual(seen[0].init.headers, { Accept: 'application/json' });
  assert.ok(seen[0].init.signal, 'the request carries a signal so it can be cancelled');
});

test('timeout: a request that never answers is stopped, cancelled and classified as a timeout', async () => {
  const seen = [];
  const error = await failure(R.fetchJson('/slow.json', { fetch: stalledFetch(seen), timeoutMs: 20 }));
  assert.strictEqual(error.reason, 'timeout');
  assert.strictEqual(R.isAborted(error), false, 'a timeout is a failure to show, not a cancellation');
  assert.strictEqual(R.classify(error).kind, 'timeout');
  assert.strictEqual(R.classify(error).retryable, true);
  assert.strictEqual(seen[0].init.signal.aborted, true, 'the underlying request was cancelled too');
});

test('timeout: also applies when the fetch ignores its signal', async () => {
  const error = await failure(R.fetchJson('/slow.json', { fetch: () => new Promise(() => {}), timeoutMs: 20 }));
  assert.strictEqual(error.reason, 'timeout');
});

test('timeout: also covers a body that starts and then stalls', async () => {
  const stalledBody = { ok: true, status: 200, headers: { get: () => null }, text: () => new Promise(() => {}) };
  const error = await failure(R.fetchJson('/slow.json', { fetch: async () => stalledBody, timeoutMs: 20 }));
  assert.strictEqual(error.reason, 'timeout');
});

test('abort: the caller cancels a request in flight and nobody should show it as a failure', async () => {
  const seen = [];
  const controller = new AbortController();
  const pending = R.fetchJson('/a.json', { fetch: stalledFetch(seen), signal: controller.signal, timeoutMs: 5000 });
  controller.abort();
  const error = await failure(pending);
  assert.strictEqual(R.isAborted(error), true);
  assert.strictEqual(error.reason, 'aborted');
  assert.strictEqual(seen[0].init.signal.aborted, true);
});

test('abort: a signal that is already aborted sends nothing', async () => {
  let calls = 0;
  const controller = new AbortController();
  controller.abort();
  const error = await failure(R.fetchJson('/a.json', { fetch: async () => { calls += 1; return response({}); }, signal: controller.signal }));
  assert.strictEqual(R.isAborted(error), true);
  assert.strictEqual(calls, 0);
});

test('abort: a finished request is not affected by a later abort and leaves no listener behind', async () => {
  const controller = new AbortController();
  let removed = 0;
  const real = controller.signal.removeEventListener.bind(controller.signal);
  controller.signal.removeEventListener = (...args) => { removed += 1; return real(...args); };
  const data = await R.fetchJson('/ok.json', { fetch: async () => response({ ok: 1 }), signal: controller.signal });
  assert.deepStrictEqual(data, { ok: 1 });
  controller.abort();
  assert.strictEqual(removed, 1);
});

test('offline: nothing is sent and the failure is classified as offline', async () => {
  R.configure({ isOnline: () => false });
  let calls = 0;
  const error = await failure(R.fetchJson('/a.json', { fetch: async () => { calls += 1; return response({}); } }));
  assert.strictEqual(error.reason, 'offline');
  assert.strictEqual(R.classify(error).kind, 'offline');
  assert.strictEqual(calls, 0);
});

test('network: a fetch that fails while online is "unavailable", and while offline it is "offline"', async () => {
  const broken = async () => { throw new TypeError('Failed to fetch'); };
  const online = await failure(R.fetchJson('/a.json', { fetch: broken }));
  assert.strictEqual(online.reason, 'network');
  assert.strictEqual(R.classify(online).kind, 'unavailable');
  R.configure({ isOnline: () => false });
  const offlineNow = await failure(R.fetchJson('/a.json', { fetch: broken }));
  assert.strictEqual(offlineNow.reason, 'offline');
});

test('network: no fetch function, or an answer that is not a response, is a network failure', async () => {
  assert.strictEqual((await failure(R.fetchJson('/a.json', { fetch: async () => undefined }))).reason, 'network');
  const realGlobal = globalThis.fetch;
  globalThis.fetch = undefined;
  try {
    assert.strictEqual((await failure(R.fetchJson('/a.json'))).reason, 'network');
  } finally {
    globalThis.fetch = realGlobal;
  }
});

test('HTTP 500: a server failure with the status and the request id', async () => {
  const fakeFetch = async () => response({}, { status: 500, headers: { 'x-request-id': 'req-123456' } });
  const error = await failure(R.fetchJson('/a.json', { fetch: fakeFetch }));
  assert.strictEqual(error.status, 500);
  const info = R.classify(error);
  assert.strictEqual(info.kind, 'server');
  assert.strictEqual(info.requestId, 'req-123456');
  assert.strictEqual(info.retryable, true);
});

test('HTTP 404: a rejected request that Try again cannot fix, and 429 keeps Retry-After', async () => {
  const notFound = await failure(R.fetchJson('/a.json', { fetch: async () => response({}, { status: 404 }) }));
  assert.strictEqual(R.classify(notFound).kind, 'rejected');
  assert.strictEqual(R.classify(notFound).retryable, false);
  const limited = await failure(R.fetchJson('/a.json', { fetch: async () => response({}, { status: 429, headers: { 'retry-after': '7' } }) }));
  assert.strictEqual(R.classify(limited).kind, 'rate-limited');
  assert.strictEqual(limited.retryAfterMs, 7000);
});

test('malformed JSON: a 200 with a body that is not JSON is its own failure, not a crash', async () => {
  const withText = await failure(R.fetchJson('/a.json', { fetch: async () => response(null, { text: '{"events": [' }) }));
  assert.strictEqual(withText.reason, 'bad-answer');
  assert.strictEqual(R.classify(withText).kind, 'unavailable');
  // A response that only has json() (small fakes) is handled the same way.
  const jsonOnly = { ok: true, status: 200, headers: { get: () => null }, json: async () => { throw new SyntaxError('Unexpected token <'); } };
  assert.strictEqual((await failure(R.fetchJson('/a.json', { fetch: async () => jsonOnly }))).reason, 'bad-answer');
});

test('empty: a blank body, a 204 and a JSON null are "empty", not valid data', async () => {
  const blank = await failure(R.fetchJson('/a.json', { fetch: async () => response(null, { text: '   ' }) }));
  assert.strictEqual(blank.reason, 'empty');
  assert.strictEqual(R.classify(blank).kind, 'unavailable');
  const noContent = await failure(R.fetchJson('/a.json', { fetch: async () => response(null, { status: 204, text: '' }) }));
  assert.strictEqual(noContent.reason, 'empty');
  const nothing = await failure(R.fetchJson('/a.json', { fetch: async () => response(null, { text: 'null' }) }));
  assert.strictEqual(nothing.reason, 'empty');
  const jsonOnly = { ok: true, status: 200, headers: { get: () => null }, json: async () => null };
  assert.strictEqual((await failure(R.fetchJson('/a.json', { fetch: async () => jsonOnly }))).reason, 'empty');
  // An empty list is a real answer: it is up to the page to say "no results".
  assert.deepStrictEqual(await R.fetchJson('/a.json', { fetch: async () => response([]) }), []);
});

// ---------- latest request wins ----------

test('request slot: a new request cancels the one before it and only the newest is current', async () => {
  const slot = R.createRequestSlot();
  const first = slot.begin();
  const firstResult = failure(R.fetchJson('/first', { fetch: stalledFetch(), signal: first.signal, timeoutMs: 5000 }));
  assert.strictEqual(first.isCurrent(), true);

  const second = slot.begin();
  assert.strictEqual(first.isCurrent(), false);
  assert.strictEqual(second.isCurrent(), true);
  assert.strictEqual(first.signal.aborted, true);
  assert.strictEqual(second.signal.aborted, false);
  assert.strictEqual(R.isAborted(await firstResult), true);

  second.done();
  assert.strictEqual(second.isCurrent(), false, 'a finished request is no longer current');
  assert.strictEqual(second.signal.aborted, false, 'finishing does not abort');
});

test('request slot: abort() cancels whatever is running', () => {
  const slot = R.createRequestSlot();
  const running = slot.begin();
  slot.abort();
  assert.strictEqual(running.signal.aborted, true);
  assert.strictEqual(running.isCurrent(), false);
  assert.doesNotThrow(() => slot.abort());
});

// ---------- the place lookup ----------

test('place lookup: a stalled Nominatim request ends with a message instead of waiting for ever', async () => {
  const seen = [];
  const error = await failure(RL.resolveManualLocation('Mejia village', { fetch: stalledFetch(seen), timeoutMs: 20 }));
  assert.strictEqual(error.reason, 'network');
  assert.match(error.message, /took too long/i);
  assert.strictEqual(seen[0].init.signal.aborted, true);
});

test('place lookup: a newer lookup can cancel the older one, which then reports "aborted"', async () => {
  const slot = R.createRequestSlot();
  const older = slot.begin();
  const olderResult = failure(RL.resolveManualLocation('Mejia village', { fetch: stalledFetch(), signal: older.signal }));
  slot.begin();
  const error = await olderResult;
  assert.strictEqual(error.reason, 'aborted');
});

test('place lookup: offline, 500, malformed JSON and an empty answer keep their old meanings', async () => {
  const lookup = (fetchImpl) => failure(RL.resolveManualLocation('Mejia village', { fetch: fetchImpl }));
  R.configure({ isOnline: () => false });
  assert.strictEqual((await lookup(async () => response([]))).reason, 'network');
  R.configure({ isOnline: () => true });
  assert.strictEqual((await lookup(async () => response({}, { status: 500 }))).reason, 'network');
  assert.strictEqual((await lookup(async () => response(null, { text: '<html>' }))).reason, 'network');
  assert.strictEqual((await lookup(async () => response(null, { text: '' }))).reason, 'notfound');
  assert.strictEqual((await lookup(async () => response([]))).reason, 'notfound');
});

// ---------- the Nominatim search helpers in api.js ----------

test('api search helpers: encoded query, status checked, list required', async () => {
  const urls = [];
  globalThis.fetch = async (url) => { urls.push(url); return response([{ place_id: 7, display_name: 'Alpha', lat: '1', lon: '2' }]); };
  const doctors = await ReliefAPI.searchDoctors({ specialty: 'skin & hair', location: 'Kol kata?' });
  assert.strictEqual(urls[0], 'https://nominatim.openstreetmap.org/search?q=doctor+skin%20%26%20hair+in+Kol%20kata%3F&format=json');
  assert.deepStrictEqual(doctors, [{ id: 7, name: 'Alpha', location: { lat: '1', lng: '2' }, specialty: 'skin & hair' }]);
  await ReliefAPI.searchHospitals({ lat: 22.5, lng: 88.3 });
  await ReliefAPI.searchPharmacies({ lat: 22.5, lng: 88.3 });
  assert.match(urls[1], /q=hospital\+near\+22\.5%2C88\.3&format=json$/);
  assert.match(urls[2], /q=pharmacy\+near\+22\.5%2C88\.3&format=json$/);
});

test('api search helpers: a 500, a timeout and a non-list answer reject with something classify() understands', async () => {
  const quiet = console.error;
  console.error = () => {};
  try {
    globalThis.fetch = async () => response({}, { status: 500 });
    assert.strictEqual(R.classify(await failure(ReliefAPI.searchHospitals({ lat: 1, lng: 2 }))).kind, 'server');

    globalThis.fetch = async () => response({ error: 'nope' });
    assert.strictEqual((await failure(ReliefAPI.searchPharmacies({ lat: 1, lng: 2 }))).reason, 'bad-answer');

    globalThis.fetch = stalledFetch();
    const realSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = (fn, ms, ...rest) => realSetTimeout(fn, ms === 10000 ? 5 : ms, ...rest);
    try {
      assert.strictEqual(R.classify(await failure(ReliefAPI.searchDoctors({ specialty: 'x', location: 'y' }))).kind, 'timeout');
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }
  } finally {
    console.error = quiet;
  }
});

// ---------- the pages ----------

test('pages load request-resilience.js before the scripts that use it', () => {
  const needs = {
    'pages/health-events.html': ['assets/js/api.js', 'assets/js/health-events-ui.js'],
    'pages/admin-panel.html': ['assets/js/api.js', 'assets/js/facility-review-ui.js', 'assets/js/health-events-ui.js'],
    'pages/hospitals.html': ['assets/js/location-service.js'],
    'pages/ambulances.html': ['assets/js/location-service.js'],
    'pages/pharmacies.html': ['assets/js/location-service.js']
  };
  for (const [page, scripts] of Object.entries(needs)) {
    const html = read(page);
    const helper = html.indexOf('assets/js/request-resilience.js');
    assert.ok(helper !== -1, page + ' loads request-resilience.js');
    for (const script of scripts) {
      assert.ok(helper < html.indexOf(script), page + ': request-resilience.js comes before ' + script);
    }
  }
});

test('the files that read local data and look up places no longer call fetch() themselves', () => {
  const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  for (const file of ['assets/js/health-events-ui.js', 'assets/js/facility-review-ui.js', 'assets/js/location-service.js']) {
    assert.doesNotMatch(strip(read(file)), /(^|[^.\w])fetch\s*\(/, file + ' goes through ReliefResilience.fetchJson');
  }
  assert.doesNotMatch(strip(read('assets/js/api.js')), /fetch\(`\$\{config\.OPENSTREETMAP_NOMINATIM_URL\}/, 'the search helpers go through fetchJson');
});
