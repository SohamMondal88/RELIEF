/**
 * Tests for Issue #94: installable, offline-aware app shell.
 * The manifest and its icons, the pages that link it, that the service worker saves only
 * the allow-listed public files, cleans old caches and never stores anything else, and
 * that a page that cannot be reached falls back to pages/offline.html.
 * Issue #185: install is all or nothing (a failed update keeps the old worker and cache),
 * saved files are fetched past the HTTP cache, and cache writes finish inside waitUntil.
 * The service worker is run for real in a vm with a fake cache and fetch.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const ORIGIN = 'https://relief.example';

const swSource = read('sw.js');

// ---- run sw.js with fakes -------------------------------------------------

function makeWorker({ network, putDelay = 0, putFails = false } = {}) {
  const store = new Map(); // cache name -> Map(url -> Response)
  const listeners = {};
  const fetched = [];
  const requests = [];
  const state = { online: true, skipWaiting: 0, claimed: 0 };
  const cacheApi = (name) => ({
    async add(url) {
      const res = await net({ url, method: 'GET', mode: 'cors' });
      if (!res.ok) throw new Error('bad status');
      store.get(name).set(String(url), res);
    },
    async put(key, res) {
      if (putDelay) await new Promise((resolve) => setTimeout(resolve, putDelay));
      if (putFails) throw new Error('QuotaExceededError');
      store.get(name).set(String(key), res);
    },
    async match(key) { const hit = store.get(name).get(String(key)); return hit ? hit.clone() : undefined; },
    async keys() { return [...store.get(name).keys()].map((url) => ({ url })); }
  });
  const caches = {
    async open(name) { if (!store.has(name)) store.set(name, new Map()); return cacheApi(name); },
    async keys() { return [...store.keys()]; },
    async delete(name) { return store.delete(name); }
  };
  const net = async (request) => {
    fetched.push(request.url);
    requests.push(request);
    if (!state.online) throw new TypeError('Failed to fetch');
    if (network) return network(request);
    return new Response('body of ' + request.url, { status: 200 });
  };
  const self = {
    location: new URL(ORIGIN + '/sw.js'),
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting: () => { state.skipWaiting += 1; return Promise.resolve(); },
    clients: { claim: () => { state.claimed += 1; return Promise.resolve(); } }
  };
  vm.runInNewContext(swSource, { self, caches, fetch: net, URL, Request, Response, Promise, Set, Map, Array, Object, String }, { filename: 'sw.js' });

  async function fire(type, init) {
    let waiting = [];
    const event = Object.assign({
      waitUntil: (p) => { waiting.push(p); },
      respondWith: (p) => { event.response = Promise.resolve(p); }
    }, init);
    listeners[type](event);
    await Promise.all(waiting);
    // A fetch handler may call waitUntil later, once the network answered (a cache write), so wait for those too.
    if (event.response) await event.response.catch(() => undefined);
    await Promise.all(waiting);
    return event;
  }
  const navigate = (url) => fire('fetch', { request: { method: 'GET', url: ORIGIN + url, mode: 'navigate' } });
  const request = (url, extra) => fire('fetch', { request: Object.assign({ method: 'GET', url, mode: 'cors' }, extra) });
  const cachedUrls = () => [...store.values()].flatMap((c) => [...c.keys()]).map((u) => new URL(u).pathname).sort();
  return { store, state, fire, navigate, request, cachedUrls, fetched, requests, listeners };
}

const readList = (name) => {
  const match = swSource.match(new RegExp('const ' + name + ' = \\[([\\s\\S]*?)\\];'));
  assert.ok(match, name + ' is in sw.js');
  return (match[1].match(/'[^']+'/g) || []).map((s) => s.slice(1, -1));
};
assert.match(swSource, /const OFFLINE_PATH = 'pages\/offline\.html';/);
const PAGES = readList('PAGE_PATHS').concat('pages/offline.html'); // the list names it through OFFLINE_PATH
const ASSETS = readList('ASSET_PATHS');

describe('web app manifest', () => {
  const manifest = JSON.parse(read('manifest.webmanifest'));

  it('has the fields a browser needs to offer install', () => {
    assert.ok(manifest.name && manifest.short_name);
    assert.ok(manifest.short_name.length <= 12);
    assert.strictEqual(manifest.display, 'standalone');
    assert.match(manifest.theme_color, /^#[0-9a-f]{6}$/i);
    assert.match(manifest.background_color, /^#[0-9a-f]{6}$/i);
    assert.ok(manifest.start_url && manifest.scope);
  });

  it('start_url stays inside scope, and both are relative so a sub-folder deploy still works', () => {
    const base = new URL(ORIGIN + '/manifest.webmanifest');
    const start = new URL(manifest.start_url, base);
    const scope = new URL(manifest.scope, base);
    assert.ok(start.href.startsWith(scope.href));
    assert.ok(!manifest.start_url.startsWith('/') && !manifest.scope.startsWith('/'));
    assert.ok(fs.existsSync(path.join(ROOT, manifest.start_url)), 'start_url file exists');
  });

  it('has real 192 and 512 png icons and a maskable one', () => {
    const sizeOf = (file) => {
      const buf = fs.readFileSync(path.join(ROOT, file));
      assert.strictEqual(buf.subarray(1, 4).toString(), 'PNG', file + ' is a png');
      return buf.readUInt32BE(16) + 'x' + buf.readUInt32BE(20);
    };
    manifest.icons.forEach((icon) => {
      assert.strictEqual(icon.type, 'image/png');
      assert.strictEqual(sizeOf(icon.src), icon.sizes, icon.src);
    });
    const has = (size, purpose) => manifest.icons.some((i) => i.sizes === size && i.purpose === purpose);
    assert.ok(has('192x192', 'any'));
    assert.ok(has('512x512', 'any'));
    assert.ok(has('512x512', 'maskable'));
  });

  it('is linked from the home page and the two offline guidance pages, to the real file', () => {
    [['index.html', ''], ['pages/firstaid.html', '../'], ['pages/hospitals.html', '../']].forEach(([file, prefix]) => {
      const html = read(file);
      assert.ok(html.includes('<link rel="manifest" href="' + prefix + 'manifest.webmanifest">'), file);
      assert.match(html, /<meta name="theme-color" content="#00b894">/);
    });
  });

  it('contains no personal data, keys or backend addresses', () => {
    const text = read('manifest.webmanifest');
    assert.doesNotMatch(text, /https?:\/\/|key|token|secret|@/i);
  });
});

describe('what the service worker is allowed to save', () => {
  it('only lists files that exist in the repo', () => {
    [...PAGES, ...ASSETS].forEach((file) => assert.ok(fs.existsSync(path.join(ROOT, file)), file));
  });

  it('never lists a page or script that holds account or private data', () => {
    const forbidden = /dashboard|login|signup|admin|profile|patient|subscription|appointment|reminder|firebase|privacy-data|assistant|facilities\.json/i;
    [...PAGES, ...ASSETS].forEach((file) => assert.doesNotMatch(file, forbidden, file));
  });

  it('covers every local script and stylesheet the two guidance pages and the offline page load', () => {
    const needed = new Set();
    ['pages/firstaid.html', 'pages/hospitals.html', 'pages/offline.html'].forEach((file) => {
      const html = read(file);
      // Decorative footer images are left out, the alt text shows when they are missing.
      for (const m of html.matchAll(/<(?:script|link)\b[^>]*?(?:src|href)="([^"]+)"/g)) {
        const ref = m[1];
        if (/^(https?:|tel:|mailto:|#|data:)/.test(ref)) continue;
        if (/rel="(?:manifest|apple-touch-icon|icon)"/.test(m[0])) continue;
        if (/\.html($|[?#])/.test(ref)) continue;
        needed.add(path.posix.normalize(path.posix.join('pages', ref)));
      }
    });
    // Analytics is left out on purpose: it is a tracking script and the page works without it.
    needed.delete('assets/js/vercel-analytics.js');
    const saved = new Set([...PAGES, ...ASSETS]);
    const missing = [...needed].filter((f) => !saved.has(f));
    assert.deepStrictEqual(missing, []);
  });

  it('the offline page loads no script, so nothing on it can run or call out', () => {
    assert.doesNotMatch(read('pages/offline.html'), /<script/i);
  });

  it('the offline page names what needs internet and keeps emergency numbers on screen', () => {
    const html = read('pages/offline.html');
    assert.match(html, /Needs internet/);
    assert.match(html, /href="tel:112"/);
    assert.match(html, /href="firstaid\.html"/);
  });
});

describe('service worker behaviour', () => {
  it('install saves exactly the listed files and takes over', async () => {
    const w = makeWorker();
    await w.fire('install');
    assert.deepStrictEqual(w.cachedUrls(), [...PAGES, ...ASSETS].map((p) => '/' + p).sort());
    assert.strictEqual(w.state.skipWaiting, 1);
    assert.deepStrictEqual([...w.store.keys()], [w.store.keys().next().value]);
    assert.match([...w.store.keys()][0], /^relief-static-v\d+$/);
  });

  it('activate deletes older relief caches and leaves other caches alone', async () => {
    const w = makeWorker();
    await w.fire('install');
    const current = [...w.store.keys()][0];
    await w.store.set('relief-static-v1', new Map([['x', new Response('old')]]));
    await w.store.set('relief-static-v0', new Map());
    await w.store.set('someone-elses-cache', new Map());
    await w.fire('activate');
    assert.deepStrictEqual([...w.store.keys()].sort(), [current, 'someone-elses-cache'].sort());
    assert.strictEqual(w.state.claimed, 1);
  });

  it('ignores POST, other sites and files that are not on the list', async () => {
    const w = makeWorker();
    const post = await w.request(ORIGIN + '/pages/firstaid.html', { method: 'POST' });
    const other = await w.request('https://identitytoolkit.googleapis.com/v1/accounts:signIn');
    const cdn = await w.request('https://unpkg.com/leaflet@1.7.1/dist/leaflet.js');
    const data = await w.request(ORIGIN + '/assets/data/facilities.json');
    const api = await w.request(ORIGIN + '/v1/subscription');
    const dashScript = await w.request(ORIGIN + '/assets/js/dashboard.js');
    [post, other, cdn, data, api, dashScript].forEach((e) => assert.strictEqual(e.response, undefined));
    assert.deepStrictEqual(w.cachedUrls(), []);
  });

  it('a listed page is fetched first, saved, and served from the save only when offline', async () => {
    const w = makeWorker();
    const online = await w.navigate('/pages/firstaid.html?from=home#top');
    assert.strictEqual(await (await online.response).text(), 'body of ' + ORIGIN + '/pages/firstaid.html?from=home#top');
    assert.deepStrictEqual(w.cachedUrls(), ['/pages/firstaid.html']);
    w.state.online = false;
    const offline = await w.navigate('/pages/firstaid.html');
    assert.strictEqual(await (await offline.response).text(), 'body of ' + ORIGIN + '/pages/firstaid.html?from=home#top');
  });

  it('a failed answer (404, 500) is never saved', async () => {
    const w = makeWorker({ network: async () => new Response('nope', { status: 500 }) });
    const e = await w.navigate('/pages/firstaid.html');
    assert.strictEqual((await e.response).status, 500);
    assert.deepStrictEqual(w.cachedUrls(), []);
  });

  it('account pages are fetched from the network, never saved, and fall back to the offline page', async () => {
    const w = makeWorker();
    await w.fire('install');
    const before = w.cachedUrls();
    for (const page of ['/pages/dashboard.html', '/pages/login.html', '/pages/signup.html', '/pages/appointments.html', '/profiles/patient/patient.html', '/index.html']) {
      const e = await w.navigate(page);
      assert.strictEqual(await (await e.response).text(), 'body of ' + ORIGIN + page);
    }
    assert.deepStrictEqual(w.cachedUrls(), before);
    w.state.online = false;
    const e = await w.navigate('/pages/dashboard.html');
    const res = await e.response;
    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.get('location'), ORIGIN + '/pages/offline.html');
    assert.deepStrictEqual(w.cachedUrls(), before);
  });

  it('a listed page that is not saved yet and cannot be reached also shows the offline page', async () => {
    const w = makeWorker();
    w.state.online = false;
    const res = await (await w.navigate('/pages/hospitals.html')).response;
    assert.strictEqual(res.status, 302);
    assert.strictEqual(res.headers.get('location'), ORIGIN + '/pages/offline.html');
  });

  it('the offline page itself cannot redirect to itself', async () => {
    const w = makeWorker();
    w.state.online = false;
    const res = await (await w.navigate('/pages/offline.html')).response;
    assert.strictEqual(res.status, 503);
  });

  it('a new version number gives a new cache name, so the old one is cleaned', () => {
    assert.match(swSource, /const CACHE_VERSION = 'v\d+';/);
    assert.match(swSource, /name\.startsWith\(CACHE_PREFIX\) && name !== CACHE_NAME/);
  });
});

describe('install is all or nothing (issue #185)', () => {
  const CURRENT = swSource.match(/const CACHE_VERSION = '(v\d+)';/)[1];
  const CURRENT_CACHE = 'relief-static-' + CURRENT;
  const OLD_CACHE = 'relief-static-v0';
  const failing = (suffix, answer) => async (req) => (req.url.endsWith(suffix) ? answer(req) : new Response('new ' + req.url));
  const seedOld = (w, name) => w.store.set(name, new Map([[ORIGIN + '/pages/firstaid.html', new Response('old firstaid')]]));

  it('fetches every file past the browser HTTP cache', async () => {
    const w = makeWorker();
    await w.fire('install');
    assert.strictEqual(w.requests.length, PAGES.length + ASSETS.length);
    w.requests.forEach((req) => assert.strictEqual(req.cache, 'reload', req.url));
    assert.deepStrictEqual(w.fetched.map((u) => new URL(u).pathname).sort(), [...PAGES, ...ASSETS].map((p) => '/' + p).sort());
  });

  it('saves each file with the status, headers and body it came with', async () => {
    const w = makeWorker({ network: async (req) => new Response('body ' + new URL(req.url).pathname, { status: 200, headers: { 'Content-Type': 'text/css', 'X-Test': '1' } }) });
    await w.fire('install');
    const saved = w.store.get(CURRENT_CACHE).get(ORIGIN + '/assets/css/offline.css');
    assert.strictEqual(saved.status, 200);
    assert.strictEqual(saved.headers.get('content-type'), 'text/css');
    assert.strictEqual(saved.headers.get('x-test'), '1');
    assert.strictEqual(await saved.text(), 'body /assets/css/offline.css');
  });

  it('does not install, and does not take over, when one asset answers 404', async () => {
    const w = makeWorker({ network: failing('api.js', () => new Response('', { status: 404 })) });
    seedOld(w, OLD_CACHE);
    await assert.rejects(w.fire('install'), /api\.js/);
    assert.strictEqual(w.state.skipWaiting, 0);
    assert.deepStrictEqual([...w.store.keys()], [OLD_CACHE], 'no half filled cache is left behind');
  });

  it('does not install when one page is missing or the network drops mid-way', async () => {
    for (const network of [
      failing('pages/hospitals.html', () => new Response('', { status: 500 })),
      failing('assets/locales/bn.json', () => { throw new TypeError('Failed to fetch'); }),
      failing('pages/offline.html', () => new Response('', { status: 404 }))
    ]) {
      const w = makeWorker({ network });
      await assert.rejects(w.fire('install'));
      assert.strictEqual(w.state.skipWaiting, 0);
      assert.deepStrictEqual([...w.store.keys()], []);
    }
  });

  it('a failed update leaves the cache of the running version exactly as it was', async () => {
    const w = makeWorker({ network: failing('main.js', () => new Response('', { status: 503 })) });
    seedOld(w, CURRENT_CACHE);
    const before = w.store.get(CURRENT_CACHE);
    await assert.rejects(w.fire('install'));
    assert.strictEqual(w.store.get(CURRENT_CACHE), before);
    assert.deepStrictEqual([...before.keys()], [ORIGIN + '/pages/firstaid.html']);
    assert.strictEqual(await (await before.get(ORIGIN + '/pages/firstaid.html')).text(), 'old firstaid');
  });

  it('a failed update never reaches activate, so the last good cache is not deleted', async () => {
    const w = makeWorker({ network: failing('api.js', () => new Response('', { status: 404 })) });
    seedOld(w, OLD_CACHE);
    await assert.rejects(w.fire('install'));
    // The browser drops a worker whose install failed, activate only runs for a worker that installed.
    assert.deepStrictEqual([...w.store.keys()], [OLD_CACHE]);
    assert.strictEqual(w.state.claimed, 0);
  });

  it('a successful update fills the new cache with the new files, takes over and removes the old cache', async () => {
    const w = makeWorker({ network: async (req) => new Response('new ' + new URL(req.url).pathname) });
    seedOld(w, OLD_CACHE);
    w.store.set('someone-elses-cache', new Map());
    await w.fire('install');
    assert.strictEqual(w.state.skipWaiting, 1);
    assert.deepStrictEqual([...w.store.keys()].sort(), [CURRENT_CACHE, OLD_CACHE, 'someone-elses-cache'].sort(), 'old cache is still there until activate');
    await w.fire('activate');
    assert.deepStrictEqual([...w.store.keys()].sort(), [CURRENT_CACHE, 'someone-elses-cache'].sort());
    assert.strictEqual(w.state.claimed, 1);
    const saved = w.store.get(CURRENT_CACHE);
    assert.strictEqual(saved.size, PAGES.length + ASSETS.length);
    assert.strictEqual(await saved.get(ORIGIN + '/pages/firstaid.html').clone().text(), 'new /pages/firstaid.html');
    // Offline now, the new copy is what the page gets.
    w.state.online = false;
    const res = await (await w.navigate('/pages/firstaid.html')).response;
    assert.strictEqual(await res.text(), 'new /pages/firstaid.html');
  });

  it('install works again after a failed attempt once the network is back', async () => {
    let broken = true;
    const w = makeWorker({ network: async (req) => (broken && req.url.endsWith('api.js') ? new Response('', { status: 404 }) : new Response('ok')) });
    await assert.rejects(w.fire('install'));
    broken = false;
    await w.fire('install');
    assert.strictEqual(w.state.skipWaiting, 1);
    assert.ok(w.cachedUrls().includes('/assets/js/api.js'));
  });

  it('a copy saved on a visit is written inside waitUntil, so the worker is not stopped half way', async () => {
    const w = makeWorker({ putDelay: 15 });
    const e = await w.navigate('/pages/firstaid.html');
    assert.strictEqual(await (await e.response).text(), 'body of ' + ORIGIN + '/pages/firstaid.html');
    // fire() resolves once everything the handler passed to waitUntil has finished, so the copy must be there.
    assert.deepStrictEqual(w.cachedUrls(), ['/pages/firstaid.html']);
  });

  it('a failed cache write (storage full) does not break the page', async () => {
    const w = makeWorker({ putFails: true });
    const e = await w.navigate('/pages/firstaid.html');
    assert.strictEqual(await (await e.response).text(), 'body of ' + ORIGIN + '/pages/firstaid.html');
    assert.deepStrictEqual(w.cachedUrls(), []);
  });
});
