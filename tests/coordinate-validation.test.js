// Issue #88: every coordinate that reaches Leaflet, a distance or an emergency SMS link is checked first.
const test = require('node:test');
const assert = require('node:assert');
const RL = require('../assets/js/location-service.js');
const U = require('../assets/js/facility-utils.js');
const SOS = require('../assets/js/emergency-sos.js');

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    dump: () => data.get(RL.STORAGE_KEY) || null
  };
}

const BAD_NUMBERS = [NaN, Infinity, -Infinity, 1e308, null, undefined, '', '   ', 'abc', 'NaN', 'Infinity', true, false, [], {}, [1], () => 1];

test('normalizeCoords accepts numbers and numeric strings inside the range', () => {
  assert.deepStrictEqual(RL.normalizeCoords(22.57, 88.36), { lat: 22.57, lng: 88.36 });
  assert.deepStrictEqual(RL.normalizeCoords('22.57', ' 88.36 '), { lat: 22.57, lng: 88.36 });
  assert.deepStrictEqual(RL.normalizeCoords(0, 0), { lat: 0, lng: 0 });
});

test('normalizeCoords accepts the exact boundaries and rejects just past them', () => {
  assert.ok(RL.normalizeCoords(90, 180));
  assert.ok(RL.normalizeCoords(-90, -180));
  assert.strictEqual(RL.normalizeCoords(90.000001, 0), null);
  assert.strictEqual(RL.normalizeCoords(-90.000001, 0), null);
  assert.strictEqual(RL.normalizeCoords(0, 180.000001), null);
  assert.strictEqual(RL.normalizeCoords(0, -180.000001), null);
});

test('normalizeCoords rejects NaN, infinities, null, empty strings, booleans and objects without throwing', () => {
  for (const bad of BAD_NUMBERS) {
    assert.strictEqual(RL.normalizeCoords(bad, 10), null, 'lat ' + String(typeof bad === 'function' ? 'fn' : JSON.stringify(bad)));
    assert.strictEqual(RL.normalizeCoords(10, bad), null, 'lng ' + String(typeof bad === 'function' ? 'fn' : JSON.stringify(bad)));
  }
  assert.strictEqual(RL.normalizeCoords(), null);
});

test('saveLocation stores nothing for bad coordinates and returns null', () => {
  for (const bad of [NaN, Infinity, null, '', 95, 'x', false]) {
    const storage = memoryStorage();
    assert.strictEqual(RL.saveLocation({ lat: bad, lng: 10, source: 'gps' }, { storage }), null);
    assert.strictEqual(storage.dump(), null);
  }
  assert.strictEqual(RL.saveLocation(null, { storage: memoryStorage() }), null);
  assert.strictEqual(RL.saveLocation(undefined), null);
});

test('saveLocation turns a null latitude into no location, not a point at 0,0', () => {
  const storage = memoryStorage();
  assert.strictEqual(RL.saveLocation({ lat: null, lng: null, source: 'gps' }, { storage }), null);
  assert.strictEqual(RL.loadLocation({ storage }), null);
});

test('loadLocation ignores stored junk and removes it', () => {
  const junk = [
    '{"lat":null,"lng":null}', '[null,null]', '{"lat":"","lng":""}', '{"lat":true,"lng":false}',
    '{"lat":91,"lng":0}', '{"lat":0,"lng":181}', '[1e999,0]', '{"lat":[],"lng":{}}', '"text"', '12', 'null', '{bad json'
  ];
  for (const raw of junk) {
    const storage = memoryStorage();
    storage.setItem(RL.STORAGE_KEY, raw);
    assert.strictEqual(RL.loadLocation({ storage }), null, raw);
    assert.strictEqual(storage.dump(), null, 'junk removed: ' + raw);
  }
});

test('parseUserLocation (facility-utils) does not turn null, empty or boolean values into 0,0', () => {
  for (const raw of ['{"lat":null,"lng":null}', [null, null], { lat: '', lng: '' }, { lat: true, lng: false }, [[], []], { lat: '  ', lng: ' ' }, [NaN, 1], [Infinity, 1], { lat: 90.5, lng: 0 }]) {
    assert.strictEqual(U.parseUserLocation(raw), null, JSON.stringify(raw));
  }
  assert.deepStrictEqual(U.parseUserLocation({ lat: '22.5', lng: '88.3' }), { lat: 22.5, lng: 88.3 });
  assert.deepStrictEqual(U.parseUserLocation([90, -180]), { lat: 90, lng: -180 });
  assert.deepStrictEqual(U.parseUserLocation({ lat: 0, lng: 0 }), { lat: 0, lng: 0 });
});

test('distance sorting ignores an invalid user location instead of producing NaN distances', () => {
  const list = [
    { id: 'b', name: 'B', lat: 22.5, lng: 88.3 },
    { id: 'a', name: 'A', lat: 23.5, lng: 87.3 }
  ];
  for (const origin of [{ lat: NaN, lng: 88 }, { lat: Infinity, lng: 0 }, { lat: '22', lng: '88' }, { lat: null, lng: null }, { lat: 120, lng: 0 }]) {
    const sorted = U.sortFacilities(list, 'distance', origin);
    assert.deepStrictEqual(sorted.map((f) => f.id), ['a', 'b']);
    assert.ok(sorted.every((f) => f.distanceKm === null), JSON.stringify(origin));
  }
  const ok = U.sortFacilities(list, 'distance', { lat: 22.5, lng: 88.3 });
  assert.deepStrictEqual(ok.map((f) => f.id), ['b', 'a']);
  assert.ok(Number.isFinite(ok[0].distanceKm));
});

test('facilities with bad coordinates get no distance and are not valid map points', () => {
  const bad = U.normalizeFacilities([
    { name: 'NaN', lat: NaN, lng: 88 },
    { name: 'Inf', lat: 22, lng: Infinity },
    { name: 'Str', lat: '22', lng: '88' },
    { name: 'Null', lat: null, lng: null },
    { name: 'Range', lat: 22, lng: 400 }
  ]);
  assert.strictEqual(bad.length, 5);
  for (const f of bad) assert.strictEqual(U.isValidCoord(f.lat, f.lng), false, f.name);
  for (const f of U.sortFacilities(bad, 'distance', { lat: 22.5, lng: 88.3 })) assert.strictEqual(f.distanceKm, null, f.name);
});

test('SOS SMS fallback only includes a location when it is a valid position', () => {
  for (const location of [{ lat: NaN, lng: 1 }, { lat: 1, lng: Infinity }, { lat: 91, lng: 0 }, { lat: 0, lng: -181 }, { lat: '22', lng: '88' }, { lat: null, lng: null }]) {
    const body = decodeURIComponent(SOS.buildSMSFallback({ location }).smsHref);
    assert.ok(!/NaN|Infinity|maps\.google/.test(body), JSON.stringify(location));
    assert.ok(body.includes('Location: Unavailable'));
  }
  const good = decodeURIComponent(SOS.buildSMSFallback({ location: { lat: 90, lng: -180 } }).smsHref);
  assert.ok(good.includes('?q=90.000000,-180.000000'));
});

test('SOS fetchLocation rejects an unusable GPS fix without throwing', async () => {
  const geo = (coords) => ({ getCurrentPosition: (ok) => ok({ coords, timestamp: 1 }) });
  for (const coords of [{ latitude: NaN, longitude: 1 }, { latitude: 1, longitude: Infinity }, { latitude: 91, longitude: 0 }, { latitude: null, longitude: null }, { latitude: '22', longitude: '88' }, {}]) {
    await assert.rejects(SOS.fetchLocation({ geolocation: geo(coords), timeoutMs: 1000 }), (e) => e.code === 'INVALID_POSITION' && e.isUnavailable === true, JSON.stringify(coords));
  }
  const ok = await SOS.fetchLocation({ geolocation: geo({ latitude: -90, longitude: 180, accuracy: 5 }), timeoutMs: 1000 });
  assert.strictEqual(ok.lat, -90);
  assert.strictEqual(ok.lng, 180);
});

test('getPosition rejects an unusable GPS fix with a readable reason', async () => {
  const geo = (coords) => ({ getCurrentPosition: (ok) => ok({ coords }) });
  for (const coords of [{ latitude: NaN, longitude: 1 }, { latitude: 1, longitude: -Infinity }, { latitude: 'x', longitude: 1 }]) {
    await assert.rejects(RL.getPosition({ geolocation: geo(coords), timeout: 100 }), (e) => e.reason === 'unavailable' && typeof e.message === 'string' && !/\n\s+at /.test(e.message));
  }
});
