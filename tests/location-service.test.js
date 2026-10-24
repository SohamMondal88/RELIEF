/**
 * Tests for the shared location helpers (Issue #15).
 * Run with: node --test tests/location-service.test.js
 */
const test = require('node:test');
const assert = require('node:assert');
const RL = require('../assets/js/location-service.js');

function memoryStorage(initial) {
  const data = Object.assign({}, initial);
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; }
  };
}

function geoWith(behaviour) {
  let calls = 0;
  return {
    get calls() { return calls; },
    getCurrentPosition(success, error, options) {
      calls += 1;
      behaviour(success, error, options, calls);
    }
  };
}

const granted = (lat, lng) => (success) => success({ coords: { latitude: lat, longitude: lng } });
const failing = (code) => (success, error) => error({ code, message: 'x' });

// ---- geolocation states

test('granted: resolves with coordinates and source gps', async () => {
  const geo = geoWith(granted(22.57, 88.36));
  const pos = await RL.getPosition({ geolocation: geo });
  assert.deepStrictEqual(pos, { lat: 22.57, lng: 88.36, source: 'gps' });
});

test('denied: rejects with reason denied and an actionable message', async () => {
  const geo = geoWith(failing(1));
  await assert.rejects(RL.getPosition({ geolocation: geo }), (err) => {
    assert.strictEqual(err.reason, 'denied');
    assert.match(err.message, /enter your town/i);
    return true;
  });
});

test('unavailable: error code 2 and bad coordinates both map to unavailable', async () => {
  await assert.rejects(RL.getPosition({ geolocation: geoWith(failing(2)) }), { reason: 'unavailable' });
  await assert.rejects(RL.getPosition({ geolocation: geoWith(granted(NaN, 5)) }), { reason: 'unavailable' });
});

test('timeout: error code 3 maps to timeout', async () => {
  await assert.rejects(RL.getPosition({ geolocation: geoWith(failing(3)) }), { reason: 'timeout' });
});

test('timeout: a browser that never calls back is rejected by the backup timer', async () => {
  const geo = geoWith(() => { /* never answers */ });
  await assert.rejects(RL.getPosition({ geolocation: geo, timeout: 20 }), { reason: 'timeout' });
});

test('unsupported: missing geolocation API', async () => {
  await assert.rejects(RL.getPosition({ geolocation: null }), { reason: 'unsupported' });
  await assert.rejects(RL.getPosition({ geolocation: {} }), { reason: 'unsupported' });
});

test('geolocation options pass a timeout and low accuracy', async () => {
  let seen;
  const geo = geoWith((success, error, options) => { seen = options; granted(1, 2)(success); });
  await RL.getPosition({ geolocation: geo, timeout: 5000 });
  assert.strictEqual(seen.timeout, 5000);
  assert.strictEqual(seen.enableHighAccuracy, false);
});

test('retry: timeout then success uses a second attempt', async () => {
  const geo = geoWith((success, error, o, n) => (n === 1 ? error({ code: 3 }) : granted(10, 20)(success)));
  const pos = await RL.getPositionWithRetry({ geolocation: geo, retries: 1 });
  assert.strictEqual(pos.lat, 10);
  assert.strictEqual(geo.calls, 2);
});

test('retry: denial is never retried', async () => {
  const geo = geoWith(failing(1));
  await assert.rejects(RL.getPositionWithRetry({ geolocation: geo, retries: 3 }), { reason: 'denied' });
  assert.strictEqual(geo.calls, 1);
});

test('retry: gives up after the allowed retries', async () => {
  const geo = geoWith(failing(2));
  await assert.rejects(RL.getPositionWithRetry({ geolocation: geo, retries: 2 }), { reason: 'unavailable' });
  assert.strictEqual(geo.calls, 3);
});

// ---- storage

test('save rounds precision and stores an expiring record', () => {
  const storage = memoryStorage();
  const rec = RL.saveLocation({ lat: 22.572646, lng: 88.363895, source: 'gps' }, { storage, now: 1000 });
  assert.strictEqual(rec.lat, 22.57);
  assert.strictEqual(rec.lng, 88.36);
  assert.strictEqual(rec.expiresAt, 1000 + RL.GPS_TTL_MS);
  const stored = JSON.parse(storage.data[RL.STORAGE_KEY]);
  assert.deepStrictEqual(Object.keys(stored).sort(), ['expiresAt', 'label', 'lat', 'lng', 'savedAt', 'source']);
});

test('manual locations keep their label and last longer', () => {
  const rec = RL.buildRecord({ lat: 23.2, lng: 87.0, label: 'Bankura', source: 'manual' }, 0);
  assert.strictEqual(rec.label, 'Bankura');
  assert.strictEqual(rec.expiresAt, RL.MANUAL_TTL_MS);
});

test('load returns a saved location and drops an expired one', () => {
  const storage = memoryStorage();
  RL.saveLocation({ lat: 22.57, lng: 88.36, source: 'gps' }, { storage, now: 1000 });
  assert.strictEqual(RL.loadLocation({ storage, now: 2000 }).lat, 22.57);
  assert.strictEqual(RL.loadLocation({ storage, now: 1000 + RL.GPS_TTL_MS + 1 }), null);
  assert.strictEqual(RL.STORAGE_KEY in storage.data, false);
});

test('load still reads the older formats and ignores corrupt data', () => {
  assert.deepStrictEqual(
    RL.loadLocation({ storage: memoryStorage({ userLocation: '{"lat":22.5,"lng":88.3}' }) }).lat, 22.5);
  assert.strictEqual(RL.loadLocation({ storage: memoryStorage({ userLocation: '[23.1,87.2]' }) }).lng, 87.2);
  const bad = memoryStorage({ userLocation: '{not json' });
  assert.strictEqual(RL.loadLocation({ storage: bad }), null);
  assert.strictEqual(RL.STORAGE_KEY in bad.data, false);
  assert.strictEqual(RL.loadLocation({ storage: memoryStorage({ userLocation: '{"lat":999,"lng":1}' }) }), null);
});

test('storage that throws never breaks the page', () => {
  const broken = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('quota'); },
    removeItem() { throw new Error('blocked'); }
  };
  assert.doesNotThrow(() => RL.saveLocation({ lat: 1, lng: 2, source: 'gps' }, { storage: broken }));
  assert.strictEqual(RL.loadLocation({ storage: broken }), null);
  assert.doesNotThrow(() => RL.clearLocation({ storage: broken }));
  assert.strictEqual(RL.loadLocation({ storage: null }), null);
});

test('clear removes the saved location; default is West Bengal', () => {
  const storage = memoryStorage();
  RL.saveLocation({ lat: 22.57, lng: 88.36, source: 'gps' }, { storage });
  RL.clearLocation({ storage });
  assert.strictEqual(RL.loadLocation({ storage }), null);
  const fallback = RL.getLocationOrDefault({ storage });
  assert.strictEqual(fallback.source, 'default');
  assert.ok(fallback.lat > 21 && fallback.lat < 28 && fallback.lng > 85 && fallback.lng < 90);
});

// ---- manual location

test('manual: known town resolves without a network call', async () => {
  const loc = await RL.resolveManualLocation('  bankura ', { fetch: () => { throw new Error('should not fetch'); } });
  assert.strictEqual(loc.label, 'Bankura');
  assert.strictEqual(loc.source, 'manual');
});

test('manual: PIN code is looked up and parsed', async () => {
  let requested;
  const fetchStub = async (url) => {
    requested = url;
    return { ok: true, json: async () => [{ lat: '22.5726', lon: '88.3639' }] };
  };
  const loc = await RL.resolveManualLocation('700001', { fetch: fetchStub });
  assert.strictEqual(loc.lat, 22.5726);
  assert.strictEqual(loc.lng, 88.3639);
  assert.match(requested, /countrycodes=in/);
  assert.match(requested, /700001/);
});

test('manual: rejects empty, too short and malformed PIN input', async () => {
  await assert.rejects(RL.resolveManualLocation(''), { reason: 'invalid' });
  await assert.rejects(RL.resolveManualLocation('ab'), { reason: 'invalid' });
  await assert.rejects(RL.resolveManualLocation('12345'), { reason: 'invalid' });
  await assert.rejects(RL.resolveManualLocation('x'.repeat(200)), { reason: 'invalid' });
});

test('manual: no results gives notfound, failures give network', async () => {
  const none = async () => ({ ok: true, json: async () => [] });
  await assert.rejects(RL.resolveManualLocation('Nowhereville', { fetch: none }), { reason: 'notfound' });
  const httpError = async () => ({ ok: false, status: 503 });
  await assert.rejects(RL.resolveManualLocation('Nowhereville', { fetch: httpError }), { reason: 'network' });
  const offline = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(RL.resolveManualLocation('Nowhereville', { fetch: offline }), { reason: 'network' });
});

test('every failure reason has its own actionable message', () => {
  ['denied', 'unavailable', 'timeout', 'unsupported', 'notfound', 'network', 'invalid'].forEach((r) => {
    assert.ok(RL.messageFor(r).length > 20, r);
  });
  assert.notStrictEqual(RL.messageFor('denied'), RL.messageFor('timeout'));
});
