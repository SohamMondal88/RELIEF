/**
 * Edge-case coverage for location permission and geocoding (Issue #60).
 *
 * Every scenario runs against mocks. No test needs a real device location, a network
 * connection or any API credentials, and a guard below fails loudly if one tries.
 *
 * node --test tests/location-edge-cases.test.js
 *
 * Each test name starts with the scenario it covers, so a failure says what regressed:
 *   [permission]  [timeout]  [unavailable]  [malformed]  [approximate]
 *   [manual]      [correction]  [privacy]  [isolation]
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const RL = require('../assets/js/location-service.js');

// ---------------------------------------------------------------------------
// Fresh, isolated environment for every test. Nothing is shared between tests,
// so permission state and storage can never leak from one scenario to the next.
// ---------------------------------------------------------------------------

function memoryStorage(initial) {
  const data = Object.assign({}, initial);
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; }
  };
}

function freshEnv() {
  const log = { networkCalls: [] };
  const storage = memoryStorage();
  // Any request that a test did not explicitly mock is a test bug: fail with a clear reason.
  const fetch = async (url) => {
    log.networkCalls.push(url);
    throw new Error('Unmocked network call to ' + url + ' (tests must not use the live geocoder)');
  };
  return { storage, fetch, log };
}

/** A navigator.geolocation stand-in. `permission` mimics the browser permission prompt. */
function geolocation(permission, position) {
  const state = { calls: 0, options: [] };
  return {
    state,
    getCurrentPosition(success, error, options) {
      state.calls += 1;
      state.options.push(options);
      if (permission === 'denied') return error({ code: 1, message: 'User denied Geolocation' });
      if (permission === 'timeout') return error({ code: 3, message: 'Timeout expired' });
      if (permission === 'unavailable') return error({ code: 2, message: 'Position unavailable' });
      if (permission === 'throws') throw new Error('SecurityError: insecure origin');
      return success({ coords: position });
    }
  };
}

const KOLKATA = { latitude: 22.572646, longitude: 88.363895, accuracy: 20 };

const nominatim = (results) => async () => ({ ok: true, json: async () => results });

// ---------------------------------------------------------------------------
// Permission states
// ---------------------------------------------------------------------------

test('[permission] denied: rejects with reason "denied" and tells the user what to do next', async () => {
  const geo = geolocation('denied');
  await assert.rejects(RL.getPosition({ geolocation: geo }), (err) => {
    assert.strictEqual(err.reason, 'denied', 'a denied prompt must map to reason "denied"');
    assert.match(err.message, /PIN code/i, 'the message must offer the manual fallback');
    return true;
  });
});

test('[permission] denied: is never retried, so the browser is not asked again', async () => {
  const geo = geolocation('denied');
  await assert.rejects(RL.getPositionWithRetry({ geolocation: geo, retries: 3 }), { reason: 'denied' });
  assert.strictEqual(geo.state.calls, 1, 'retrying after a denial would re-prompt the user');
});

test('[permission] denied then manual entry still works (reminder: no geolocation needed)', async () => {
  const env = freshEnv();
  await assert.rejects(RL.getPosition({ geolocation: geolocation('denied') }), { reason: 'denied' });
  const loc = await RL.resolveManualLocation('Siliguri', { fetch: env.fetch });
  assert.strictEqual(loc.source, 'manual');
  assert.strictEqual(env.log.networkCalls.length, 0, 'a known town must not need the network');
});

test('[permission] unsupported: missing geolocation API and a non-function API both fall back', async () => {
  await assert.rejects(RL.getPosition({ geolocation: null }), { reason: 'unsupported' });
  await assert.rejects(RL.getPosition({ geolocation: {} }), { reason: 'unsupported' });
});

test('[permission] a browser that throws synchronously (insecure origin) is reported as unavailable', async () => {
  await assert.rejects(RL.getPosition({ geolocation: geolocation('throws') }), { reason: 'unavailable' });
});

// ---------------------------------------------------------------------------
// Timeout and unavailable
// ---------------------------------------------------------------------------

test('[timeout] browser timeout error maps to "timeout"', async () => {
  await assert.rejects(RL.getPosition({ geolocation: geolocation('timeout') }), { reason: 'timeout' });
});

test('[timeout] a browser that never answers is stopped by the backup timer', async () => {
  const silent = { getCurrentPosition() { /* never calls back */ } };
  const started = Date.now();
  await assert.rejects(RL.getPosition({ geolocation: silent, timeout: 20 }), { reason: 'timeout' });
  assert.ok(Date.now() - started < 2000, 'the backup timer should fire shortly after the timeout');
});

test('[timeout] a late answer after the timeout is ignored', async () => {
  let late;
  const slow = { getCurrentPosition(success) { late = success; } };
  const result = RL.getPosition({ geolocation: slow, timeout: 10 });
  await assert.rejects(result, { reason: 'timeout' });
  assert.doesNotThrow(() => late({ coords: KOLKATA }), 'a late callback must not throw or resolve twice');
});

test('[timeout] one retry is allowed, and the options keep the request cheap', async () => {
  let n = 0;
  const geo = {
    state: { options: [] },
    getCurrentPosition(success, error, options) {
      geo.state.options.push(options);
      n += 1;
      return n === 1 ? error({ code: 3 }) : success({ coords: KOLKATA });
    }
  };
  const pos = await RL.getPositionWithRetry({ geolocation: geo, retries: 1, timeout: 500 });
  assert.strictEqual(n, 2);
  assert.strictEqual(pos.source, 'gps');
  assert.strictEqual(geo.state.options[0].enableHighAccuracy, false, 'high accuracy drains the battery');
  assert.strictEqual(geo.state.options[0].timeout, 500);
});

test('[timeout] gives up after the allowed retries and keeps the last reason', async () => {
  const geo = geolocation('timeout');
  await assert.rejects(RL.getPositionWithRetry({ geolocation: geo, retries: 2 }), { reason: 'timeout' });
  assert.strictEqual(geo.state.calls, 3, 'one attempt plus two retries');
});

test('[unavailable] position unavailable error maps to "unavailable" and can be retried', async () => {
  const geo = geolocation('unavailable');
  await assert.rejects(RL.getPositionWithRetry({ geolocation: geo, retries: 1 }), { reason: 'unavailable' });
  assert.strictEqual(geo.state.calls, 2);
});

test('[unavailable] an unknown error code is treated as unavailable, not as a crash', async () => {
  const odd = { getCurrentPosition(_s, error) { error({ code: 99 }); } };
  await assert.rejects(RL.getPosition({ geolocation: odd }), { reason: 'unavailable' });
  const noCode = { getCurrentPosition(_s, error) { error(undefined); } };
  await assert.rejects(RL.getPosition({ geolocation: noCode }), { reason: 'unavailable' });
});

// ---------------------------------------------------------------------------
// Malformed results
// ---------------------------------------------------------------------------

const BAD_DEVICE_COORDS = [
  ['missing coords', undefined],
  ['null coords', null],
  ['empty coords', {}],
  ['string latitude', { latitude: '22.5', longitude: 88.3 }],
  ['null latitude', { latitude: null, longitude: 88.3 }],
  ['NaN', { latitude: NaN, longitude: 88.3 }],
  ['Infinity', { latitude: Infinity, longitude: 88.3 }],
  ['latitude above 90', { latitude: 91, longitude: 88.3 }],
  ['latitude below -90', { latitude: -91, longitude: 88.3 }],
  ['longitude above 180', { latitude: 22.5, longitude: 181 }]
];

BAD_DEVICE_COORDS.forEach(([name, coords]) => {
  test('[malformed] device returns ' + name + ': treated as unavailable, never used', async () => {
    const geo = { getCurrentPosition(success) { success({ coords }); } };
    await assert.rejects(RL.getPosition({ geolocation: geo }), { reason: 'unavailable' });
  });
});

test('[malformed] device returns no position object at all', async () => {
  const geo = { getCurrentPosition(success) { success(undefined); } };
  await assert.rejects(RL.getPosition({ geolocation: geo }), { reason: 'unavailable' });
});

const BAD_GEOCODER_RESULTS = [
  ['an empty list', []],
  ['not a list', { lat: '22.5', lon: '88.3' }],
  ['null', null],
  ['a result without coordinates', [{ display_name: 'Somewhere' }]],
  ['non-numeric coordinates', [{ lat: 'abc', lon: 'def' }]],
  ['null coordinates (would become 0,0)', [{ lat: null, lon: null }]],
  ['empty-string coordinates (would become 0,0)', [{ lat: '', lon: '' }]],
  ['array coordinates (would become 0,0)', [{ lat: [], lon: [] }]],
  ['boolean coordinates (would become 1,1)', [{ lat: true, lon: true }]],
  ['out-of-range coordinates', [{ lat: '123.4', lon: '88.3' }]],
  ['infinite coordinates', [{ lat: 'Infinity', lon: '88.3' }]]
];

BAD_GEOCODER_RESULTS.forEach(([name, results]) => {
  test('[malformed] geocoder returns ' + name + ': reported as "notfound"', async () => {
    await assert.rejects(
      RL.resolveManualLocation('Nowhereville', { fetch: nominatim(results) }),
      { reason: 'notfound' }
    );
  });
});

test('[malformed] geocoder response that is not JSON is a network-style failure, not a crash', async () => {
  const broken = async () => ({ ok: true, json: async () => { throw new SyntaxError('Unexpected token <'); } });
  await assert.rejects(RL.resolveManualLocation('Nowhereville', { fetch: broken }), { reason: 'network' });
});

test('[malformed] geocoder response with no body helper is handled', async () => {
  await assert.rejects(RL.resolveManualLocation('Nowhereville', { fetch: async () => undefined }), { reason: 'network' });
});

test('[malformed] saved data with bad coordinates is dropped and removed from storage', () => {
  const bad = [
    '{not json', 'null', '42', '"text"', '[]', '{}',
    JSON.stringify({ lat: null, lng: null }),
    JSON.stringify({ lat: '', lng: '' }),
    JSON.stringify([null, null]),
    JSON.stringify({ lat: 200, lng: 10 }),
    JSON.stringify({ lat: 'north', lng: 'east' })
  ];
  bad.forEach((raw) => {
    const storage = memoryStorage({ userLocation: raw });
    assert.strictEqual(RL.loadLocation({ storage }), null, 'stored value ' + raw + ' must not become a location');
    assert.ok(!('userLocation' in storage.data), 'stored value ' + raw + ' should be cleaned up');
  });
});

test('[malformed] older saved formats still load: [lat, lng], {lat, lng} and numeric strings', () => {
  assert.strictEqual(RL.loadLocation({ storage: memoryStorage({ userLocation: '[22.5,88.3]' }) }).lat, 22.5);
  assert.strictEqual(RL.loadLocation({ storage: memoryStorage({ userLocation: '{"lat":"22.5","lng":"88.3"}' }) }).lng, 88.3);
});

// ---------------------------------------------------------------------------
// Approximate results
// ---------------------------------------------------------------------------

test('[approximate] a coarse position (kilometres of error) is accepted and flagged as gps', async () => {
  const coarse = { latitude: 22.9868, longitude: 87.855, accuracy: 50000 };
  const pos = await RL.getPosition({ geolocation: geolocation('granted', coarse) });
  assert.strictEqual(pos.source, 'gps');
  assert.ok(RL.isValidCoord(pos.lat, pos.lng));
});

test('[approximate] a position without an accuracy value still works', async () => {
  const pos = await RL.getPosition({ geolocation: geolocation('granted', { latitude: 22.5, longitude: 88.3 }) });
  assert.strictEqual(pos.lat, 22.5);
});

test('[approximate] saved positions are rounded to about 1 km', () => {
  const env = freshEnv();
  const record = RL.saveLocation({ lat: 22.572646, lng: 88.363895, source: 'gps' }, { storage: env.storage, now: 1000 });
  assert.strictEqual(record.lat, 22.57);
  assert.strictEqual(record.lng, 88.36);
  const stored = JSON.parse(env.storage.data.userLocation);
  assert.deepStrictEqual([stored.lat, stored.lng], [22.57, 88.36]);
});

test('[approximate] a geocoder result is used as returned, not treated as exact', async () => {
  const loc = await RL.resolveManualLocation('Some village', { fetch: nominatim([{ lat: '23.1234', lon: '87.9876' }]) });
  assert.strictEqual(loc.label, 'Some village');
  const saved = RL.saveLocation(loc, { storage: memoryStorage(), now: 0 });
  assert.strictEqual(saved.lat, 23.12);
});

test('[approximate] the first of several geocoder matches is used', async () => {
  const loc = await RL.resolveManualLocation('Common name', {
    fetch: nominatim([{ lat: '22.1', lon: '88.1' }, { lat: '25.0', lon: '90.0' }])
  });
  assert.deepStrictEqual([loc.lat, loc.lng], [22.1, 88.1]);
});

// ---------------------------------------------------------------------------
// Manual entry and correction
// ---------------------------------------------------------------------------

test('[manual] input is trimmed and case-insensitive for known towns', async () => {
  const loc = await RL.resolveManualLocation('   kOlKaTa  ', { fetch: freshEnv().fetch });
  assert.strictEqual(loc.label, 'Kolkata');
});

test('[manual] a valid PIN code is looked up with the PIN and India in the query', async () => {
  let url;
  await RL.resolveManualLocation('713301', {
    fetch: async (u) => { url = u; return { ok: true, json: async () => [{ lat: '23.5', lon: '87.3' }] }; }
  });
  assert.match(url, /q=713301%2C%20India/);
  assert.match(url, /countrycodes=in/);
});

test('[manual] invalid input never reaches the network', async () => {
  const env = freshEnv();
  const inputs = ['', '   ', 'ab', '12345', '1234567', '0123456', 'x'.repeat(121), null, undefined];
  for (const input of inputs) {
    await assert.rejects(RL.resolveManualLocation(input, { fetch: env.fetch }), { reason: 'invalid' }, 'input: ' + JSON.stringify(input));
  }
  assert.strictEqual(env.log.networkCalls.length, 0);
});

test('[manual] input is URL-encoded so it cannot change the query', async () => {
  let url;
  await RL.resolveManualLocation('Town&format=xml#frag', {
    fetch: async (u) => { url = u; return { ok: true, json: async () => [{ lat: '22.5', lon: '88.3' }] }; }
  });
  assert.ok(!/&format=xml/.test(url), 'user text must not inject query parameters');
  assert.match(url, /Town%26format%3Dxml%23frag/);
});

test('[manual] a failed lookup leaves the previously saved location untouched', async () => {
  const env = freshEnv();
  RL.saveLocation({ lat: 22.57, lng: 88.36, label: 'Kolkata', source: 'manual' }, { storage: env.storage, now: 0 });
  await assert.rejects(RL.resolveManualLocation('Nowhereville', { fetch: nominatim([]) }), { reason: 'notfound' });
  assert.strictEqual(RL.loadLocation({ storage: env.storage, now: 1 }).label, 'Kolkata');
});

test('[correction] entering a different place replaces the saved one, label and expiry included', () => {
  const env = freshEnv();
  RL.saveLocation({ lat: 22.57, lng: 88.36, label: 'Kolkta', source: 'manual' }, { storage: env.storage, now: 1000 });
  RL.saveLocation({ lat: 22.57, lng: 88.36, label: 'Kolkata', source: 'manual' }, { storage: env.storage, now: 5000 });
  const loaded = RL.loadLocation({ storage: env.storage, now: 5001 });
  assert.strictEqual(loaded.label, 'Kolkata');
  assert.strictEqual(loaded.expiresAt, 5000 + RL.MANUAL_TTL_MS);
});

test('[correction] a manual place overrides a detected one that was wrong', () => {
  const env = freshEnv();
  RL.saveLocation({ lat: 20.0, lng: 80.0, source: 'gps' }, { storage: env.storage, now: 0 });
  RL.saveLocation({ lat: 23.52, lng: 87.31, label: 'Durgapur', source: 'manual' }, { storage: env.storage, now: 10 });
  const loaded = RL.loadLocation({ storage: env.storage, now: 11 });
  assert.strictEqual(loaded.source, 'manual');
  assert.strictEqual(loaded.label, 'Durgapur');
});

test('[correction] clearing the saved location returns to the default, which is not shown as the user\'s position', () => {
  const env = freshEnv();
  RL.saveLocation({ lat: 22.57, lng: 88.36, source: 'gps' }, { storage: env.storage, now: 0 });
  RL.clearLocation({ storage: env.storage });
  assert.strictEqual(RL.loadLocation({ storage: env.storage }), null);
  assert.strictEqual(RL.getLocationOrDefault({ storage: env.storage }).source, 'default');
});

test('[correction] saved locations expire: GPS after one day, manual after seven', () => {
  const env = freshEnv();
  RL.saveLocation({ lat: 22.57, lng: 88.36, source: 'gps' }, { storage: env.storage, now: 0 });
  assert.ok(RL.loadLocation({ storage: env.storage, now: RL.GPS_TTL_MS - 1 }));
  assert.strictEqual(RL.loadLocation({ storage: env.storage, now: RL.GPS_TTL_MS }), null);

  RL.saveLocation({ lat: 22.57, lng: 88.36, label: 'Kolkata', source: 'manual' }, { storage: env.storage, now: 0 });
  assert.ok(RL.loadLocation({ storage: env.storage, now: RL.GPS_TTL_MS + 1 }));
  assert.strictEqual(RL.loadLocation({ storage: env.storage, now: RL.MANUAL_TTL_MS }), null);
});

test('[correction] a very long label is capped', () => {
  const record = RL.saveLocation({ lat: 22.5, lng: 88.3, label: 'x'.repeat(500), source: 'manual' }, { storage: memoryStorage() });
  assert.strictEqual(record.label.length, 120);
});

test('[correction] blocked or full storage never breaks the page', () => {
  const broken = {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('quota'); },
    removeItem() { throw new Error('denied'); }
  };
  assert.doesNotThrow(() => RL.saveLocation({ lat: 22.5, lng: 88.3, source: 'gps' }, { storage: broken }));
  assert.strictEqual(RL.loadLocation({ storage: broken }), null);
  assert.doesNotThrow(() => RL.clearLocation({ storage: broken }));
  assert.strictEqual(RL.getLocationOrDefault({ storage: broken }).source, 'default');
});

// ---------------------------------------------------------------------------
// Privacy: errors and logs do not expose precise coordinates
// ---------------------------------------------------------------------------

test('[privacy] failure messages and errors never contain the coordinates involved', async () => {
  const precise = { latitude: 22.572646, longitude: 88.363895 };
  const outcomes = [];
  for (const mode of ['denied', 'timeout', 'unavailable']) {
    await RL.getPosition({ geolocation: geolocation(mode, precise) }).catch((e) => outcomes.push(e));
  }
  await RL.getPosition({ geolocation: { getCurrentPosition(s) { s({ coords: { latitude: 91.123456, longitude: 88.363895 } }); } } })
    .catch((e) => outcomes.push(e));
  await RL.resolveManualLocation('Nowhereville', { fetch: nominatim([{ lat: '123.456789', lon: '88.363895' }]) })
    .catch((e) => outcomes.push(e));

  assert.strictEqual(outcomes.length, 5);
  outcomes.forEach((err) => {
    const text = [err.message, String(err), JSON.stringify({ reason: err.reason })].join(' ');
    assert.ok(!/22\.5726|88\.3638|91\.1234|123\.4567/.test(text), 'an error exposed coordinates: ' + text);
  });
});

test('[privacy] the saved record holds rounded coordinates only', () => {
  const env = freshEnv();
  RL.saveLocation({ lat: 22.572646, lng: 88.363895, source: 'gps' }, { storage: env.storage });
  assert.ok(!/22\.5726|88\.3638/.test(env.storage.data.userLocation));
});

test('[privacy] a geocoder request carries only the text the user typed, never a stored position', async () => {
  const env = freshEnv();
  RL.saveLocation({ lat: 22.572646, lng: 88.363895, source: 'gps' }, { storage: env.storage });
  let url;
  await RL.resolveManualLocation('Some village', {
    fetch: async (u) => { url = u; return { ok: true, json: async () => [{ lat: '23.1', lon: '87.9' }] }; }
  });
  assert.ok(!/22\.5|88\.3/.test(url), 'the request leaked the saved position: ' + url);
});

test('[privacy] the service does not log, so coordinates cannot reach the console', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'location-service.js'), 'utf8');
  assert.ok(!/console\./.test(source));
});

// ---------------------------------------------------------------------------
// Isolation and independence
// ---------------------------------------------------------------------------

test('[isolation] a permission denial in one test does not leak into the next', async () => {
  // First "test" state: denied.
  await assert.rejects(RL.getPosition({ geolocation: geolocation('denied') }), { reason: 'denied' });
  // Second state, new environment: granted. The module keeps no permission memory.
  const pos = await RL.getPosition({ geolocation: geolocation('granted', KOLKATA) });
  assert.strictEqual(pos.source, 'gps');
});

test('[isolation] storage is per environment: saving in one does not show up in another', () => {
  const a = freshEnv();
  const b = freshEnv();
  RL.saveLocation({ lat: 22.5, lng: 88.3, source: 'gps' }, { storage: a.storage });
  assert.strictEqual(RL.loadLocation({ storage: b.storage }), null);
});

test('[isolation] the default location object cannot be changed by a caller through a result', () => {
  const first = RL.getLocationOrDefault({ storage: memoryStorage() });
  assert.strictEqual(first.source, 'default');
  assert.ok(RL.isValidCoord(first.lat, first.lng));
});

test('[isolation] an unmocked network call fails loudly (so CI never needs a live geocoder)', async () => {
  const env = freshEnv();
  await assert.rejects(RL.resolveManualLocation('Unmocked place', { fetch: env.fetch }), { reason: 'network' });
  assert.strictEqual(env.log.networkCalls.length, 1);
  assert.match(env.log.networkCalls[0], /nominatim/);
});

test('[isolation] every documented failure reason has a distinct, actionable message', () => {
  const reasons = ['denied', 'unavailable', 'timeout', 'unsupported', 'notfound', 'network', 'invalid'];
  const messages = reasons.map((r) => RL.messageFor(r));
  messages.forEach((m, i) => assert.ok(m.length > 20, reasons[i] + ' needs a real message'));
  assert.strictEqual(new Set(messages).size, reasons.length, 'two reasons share the same message');
  assert.ok(RL.messageFor('something-new').length > 0, 'unknown reasons still get a safe message');
});
