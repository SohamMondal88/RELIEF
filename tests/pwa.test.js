/**
 * Tests for Issue #94: installable, offline-aware app shell.
 * The manifest and its icons, the pages that link it, that the service worker saves only
 * the allow-listed public files, cleans old caches and never stores anything else, and
 * that a page that cannot be reached falls back to pages/offline.html.
 * Issue #186: the same behaviour on the clean addresses Vercel serves (/pages/firstaid
 * next to /pages/firstaid.html), no redirected response for a navigation and no redirect
 * on the way to the offline page.
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

function makeWorker({ network } = {}) {
  const store = new Map(); // cache name -> Map(url -> Response)
  const listeners = {};
  const fetched = [];
  const state = { online: true, skipWaiting: 0, claimed: 0 };
  const cacheApi = (name) => ({
    async add(url) {
      const res = await net({ url, method: 'GET', mode: 'cors' });
      if (!res.ok) throw new Error('bad status');
      store.get(name).set(String(url), res);
    },
    async put(key, res) { store.get(name).set(String(key), res); },
    async match(key) {
      const hit = store.get(name).get(String(key));
      if (!hit) return undefined;
      const copy = hit.clone();
      // clone() of the fake flagged response would lose the flag, a real cache keeps it.
      if (hit.redirected) Object.defineProperty(copy, 'redirected', { value: true });
      return copy;
    },
    async keys() { return [...store.get(name).keys()].map((url) => ({ url })); }
  });
  const caches = {
    async open(name) { if (!store.has(name)) store.set(name, new Map()); return cacheApi(name); },
    async keys() { return [...store.keys()]; },
    async delete(name) { return store.delete(name); }
  };
  const net = async (request) => {
    fetched.push(request.url);
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
  vm.runInNewContext(swSource, { self, caches, fetch: net, URL, Response, Headers, Promise, Set, Map, Array, Object, String }, { filename: 'sw.js' });

  async function fire(type, init) {
    let waiting = [];
    const event = Object.assign({
      waitUntil: (p) => { waiting.push(p); },
      respondWith: (p) => { event.response = Promise.resolve(p); }
    }, init);
    listeners[type](event);
    await Promise.all(waiting);
    return event;
  }
  const navigate = (url) => fire('fetch', { request: { method: 'GET', url: ORIGIN + url, mode: 'navigate' } });
  const request = (url, extra) => fire('fetch', { request: Object.assign({ method: 'GET', url, mode: 'cors' }, extra) });
  const cachedUrls = () => [...store.values()].flatMap((c) => [...c.keys()]).map((u) => new URL(u).pathname).sort();
  return { store, state, fire, navigate, request, cachedUrls, fetched, listeners };
}

// A response the way the browser reports one that followed a redirect (the .html address answering 308 to the clean one).
const redirected = (body, init) => {
  const res = new Response(body, init);
  Object.defineProperty(res, 'redirected', { value: true });
  return res;
};
// The real offline page for pages/offline.html, a short body for everything else.
const withOfflinePage = (extra) => async (req) => {
  if (new URL(req.url).pathname === '/pages/offline.html') return new Response(read('pages/offline.html'), { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  return extra ? extra(req) : new Response('body of ' + req.url, { status: 200 });
};

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

  it('install does not fail when one file is missing', async () => {
    const w = makeWorker({ network: async (req) => (req.url.endsWith('api.js') ? new Response('', { status: 404 }) : new Response('ok')) });
    await w.fire('install');
    assert.ok(!w.cachedUrls().includes('/assets/js/api.js'));
    assert.ok(w.cachedUrls().includes('/pages/firstaid.html'));
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

  it('account pages are fetched from the network, never saved, and show the offline page when it cannot be reached', async () => {
    const w = makeWorker({ network: withOfflinePage() });
    await w.fire('install');
    const before = w.cachedUrls();
    for (const page of ['/pages/dashboard.html', '/pages/login.html', '/pages/signup.html', '/pages/appointments.html', '/profiles/patient/patient.html', '/index.html']) {
      const e = await w.navigate(page);
      assert.strictEqual(await (await e.response).text(), 'body of ' + ORIGIN + page);
    }
    assert.deepStrictEqual(w.cachedUrls(), before);
    w.state.online = false;
    const res = await (await w.navigate('/pages/dashboard.html')).response;
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('location'), null);
    assert.match(await res.text(), /<h1>You are offline<\/h1>/);
    assert.deepStrictEqual(w.cachedUrls(), before);
  });

  it('a listed page that is not saved yet and cannot be reached also shows the offline page', async () => {
    const w = makeWorker({ network: withOfflinePage() });
    await w.fire('install');
    w.store.values().next().value.delete(ORIGIN + '/pages/hospitals.html');
    w.state.online = false;
    const res = await (await w.navigate('/pages/hospitals.html')).response;
    assert.strictEqual(res.status, 200);
    assert.match(await res.text(), /<h1>You are offline<\/h1>/);
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

describe('clean URLs (cleanUrls in vercel.json)', () => {
  it('vercel.json really has cleanUrls on, which is why the clean address matters', () => {
    assert.strictEqual(JSON.parse(read('vercel.json')).cleanUrls, true);
  });

  it('the clean address of a listed page is fetched first, saved under the .html path, and served from it offline', async () => {
    const w = makeWorker();
    const online = await w.navigate('/pages/firstaid?from=home#top');
    assert.strictEqual(await (await online.response).text(), 'body of ' + ORIGIN + '/pages/firstaid?from=home#top');
    assert.deepStrictEqual(w.fetched, [ORIGIN + '/pages/firstaid?from=home#top']);
    assert.deepStrictEqual(w.cachedUrls(), ['/pages/firstaid.html']);
    w.state.online = false;
    for (const asked of ['/pages/firstaid', '/pages/firstaid.html', '/pages/firstaid?x=1']) {
      const res = await (await w.navigate(asked)).response;
      assert.strictEqual(await res.text(), 'body of ' + ORIGIN + '/pages/firstaid?from=home#top', asked);
    }
  });

  it('the clean address of every listed page is answered from the saved copy offline', async () => {
    const w = makeWorker({ network: withOfflinePage() });
    await w.fire('install');
    w.state.online = false;
    for (const file of PAGES.filter((p) => p !== 'pages/offline.html')) {
      const res = await (await w.navigate('/' + file.replace(/\.html$/, ''))).response;
      assert.strictEqual(await res.text(), 'body of ' + ORIGIN + '/' + file, file);
    }
  });

  it('a saved copy that was stored after a redirect is handed out without the redirected flag', async () => {
    // What the cache of an already running version holds: the install of that version fetched the .html address, which redirected.
    const w = makeWorker();
    const name = 'relief-static-' + swSource.match(/const CACHE_VERSION = '(v\d+)';/)[1];
    w.store.set(name, new Map([[ORIGIN + '/pages/hospitals.html', redirected('saved after a redirect', { status: 200, headers: { 'X-Test': '1' } })]]));
    assert.ok(w.store.get(name).get(ORIGIN + '/pages/hospitals.html').redirected);
    w.state.online = false;
    for (const asked of ['/pages/hospitals', '/pages/hospitals.html']) {
      const res = await (await w.navigate(asked)).response;
      assert.strictEqual(res.redirected, false, asked);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers.get('x-test'), '1');
      assert.strictEqual(await res.text(), 'saved after a redirect');
    }
  });

  it('a navigation that the server answers with a redirect is passed on untouched and not saved', async () => {
    const w = makeWorker({ network: async () => new Response(null, { status: 308, headers: { Location: '/pages/firstaid' } }) });
    const res = await (await w.navigate('/pages/firstaid.html')).response;
    assert.strictEqual(res.status, 308);
    assert.deepStrictEqual(w.cachedUrls(), []);
  });

  it('the offline fallback is the saved offline page itself, no redirect, for the .html and the clean address', async () => {
    const w = makeWorker({ network: withOfflinePage() });
    await w.fire('install');
    w.state.online = false;
    for (const asked of ['/pages/dashboard', '/pages/dashboard.html', '/profiles/patient/patient', '/index', '/']) {
      const res = await (await w.navigate(asked)).response;
      assert.strictEqual(res.status, 200, asked);
      assert.strictEqual(res.redirected, false);
      assert.strictEqual(res.headers.get('location'), null);
      assert.match(res.headers.get('content-type'), /^text\/html/);
      const html = await res.text();
      assert.match(html, /<h1>You are offline<\/h1>/, asked);
    }
  });

  it('the offline page keeps its links working from any address through a base tag', async () => {
    const w = makeWorker({ network: withOfflinePage() });
    await w.fire('install');
    w.state.online = false;
    const html = await (await (await w.navigate('/profiles/patient/patient')).response).text();
    const base = html.match(/<base href="([^"]+)">/);
    assert.ok(base, 'base tag');
    assert.strictEqual(base[1], ORIGIN + '/pages/offline.html');
    assert.ok(html.indexOf(base[0]) < html.indexOf('<link rel="stylesheet"'), 'base comes before the first link');
    // The page asks for ../assets/css/offline.css and firstaid.html, which must land on the saved files.
    const resolve = (ref) => new URL(ref, base[1]).pathname;
    assert.strictEqual(resolve(html.match(/<link rel="stylesheet" href="([^"]+)"/)[1]), '/assets/css/offline.css');
    assert.strictEqual(resolve(html.match(/<a href="(firstaid\.html)"/)[1]), '/pages/firstaid.html');
    assert.ok(ASSETS.includes('assets/css/offline.css'));
  });

  it('the saved offline page opens from its clean address too', async () => {
    const w = makeWorker({ network: withOfflinePage() });
    await w.fire('install');
    w.state.online = false;
    const res = await (await w.navigate('/pages/offline')).response;
    assert.match(await res.text(), /<h1>You are offline<\/h1>/);
  });

  it('with no saved offline page the fallback is the plain 503 text, never a redirect', async () => {
    const w = makeWorker();
    w.state.online = false;
    const res = await (await w.navigate('/pages/dashboard')).response;
    assert.strictEqual(res.status, 503);
    assert.strictEqual(res.headers.get('location'), null);
  });

  it('only navigations get the offline page, a script asking for a listed page gets the network error', async () => {
    const w = makeWorker({ network: withOfflinePage() });
    w.state.online = false;
    for (const asked of [ORIGIN + '/pages/firstaid', ORIGIN + '/pages/firstaid.html']) {
      const e = await w.request(asked);
      await assert.rejects(e.response, TypeError);
    }
  });

  it('api paths, other methods and unknown routes stay on the network and never get HTML from the cache', async () => {
    const w = makeWorker({ network: withOfflinePage() });
    await w.fire('install');
    const before = w.cachedUrls();
    const fetchedBefore = w.fetched.length;
    // None of these are looked at by the cache code: no respondWith at all.
    for (const asked of [ORIGIN + '/api/firstaid', ORIGIN + '/v1/hospitals', ORIGIN + '/pages/firstaid/', ORIGIN + '/pages/firstaid.json', ORIGIN + '/assets/data/facilities.json']) {
      assert.strictEqual((await w.request(asked)).response, undefined, asked);
    }
    for (const asked of ['/pages/firstaid', '/pages/firstaid.html', '/pages/dashboard']) {
      assert.strictEqual((await w.request(ORIGIN + asked, { method: 'POST' })).response, undefined, asked);
      assert.strictEqual((await w.request(ORIGIN + asked, { method: 'PUT' })).response, undefined, asked);
    }
    assert.strictEqual(w.fetched.length, fetchedBefore);
    assert.deepStrictEqual(w.cachedUrls(), before);
    // A navigation to an api-looking path is answered by the network, and offline by the offline page, never by a saved page.
    const online = await w.navigate('/api/firstaid');
    assert.strictEqual(await (await online.response).text(), 'body of ' + ORIGIN + '/api/firstaid');
    w.state.online = false;
    const offline = await (await w.navigate('/api/firstaid')).response;
    assert.match(await offline.text(), /<h1>You are offline<\/h1>/);
  });

  it('an unknown route reaches the network and its 404 page is shown as it is, not replaced or saved', async () => {
    const w = makeWorker({ network: async () => new Response('custom 404 page', { status: 404 }) });
    const res = await (await w.navigate('/pages/does-not-exist')).response;
    assert.strictEqual(res.status, 404);
    assert.strictEqual(await res.text(), 'custom 404 page');
    assert.deepStrictEqual(w.cachedUrls(), []);
  });

  it('a failed answer for the clean address is passed on and never saved', async () => {
    const w = makeWorker({ network: async () => new Response('nope', { status: 404 }) });
    const res = await (await w.navigate('/pages/firstaid')).response;
    assert.strictEqual(res.status, 404);
    assert.deepStrictEqual(w.cachedUrls(), []);
  });
});
