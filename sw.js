/*
 * RELIEF service worker (offline access for first aid guidance and saved hospitals).
 *
 * Every saved file is fetched from the network first and the saved copy is only
 * used when the network fails, so an online visit always gets the newest files.
 * Bump CACHE_VERSION whenever you add, remove or rename a path below. Old
 * "relief-static-*" caches are deleted on activate.
 *
 * Only same-origin GET requests for the exact paths below are ever cached.
 * Accounts, dashboard, login, firebase and api calls are never stored.
 * Any other page that cannot be reached shows pages/offline.html instead of the
 * browser error. That page is not a copy of the missing page, nothing is saved.
 *
 * Vercel runs with cleanUrls, so /pages/firstaid.html answers 308 to /pages/firstaid.
 * Both addresses are the same saved page. The saved copies are always keyed by the
 * .html path, and a copy that was stored after a redirect is handed out as a plain
 * response, because the browser refuses to show a redirected response for a navigation.
 */
const CACHE_VERSION = 'v6';
const CACHE_PREFIX = 'relief-static-';
const CACHE_NAME = CACHE_PREFIX + CACHE_VERSION;

// Paths are relative to the folder sw.js lives in (the site root).
const OFFLINE_PATH = 'pages/offline.html';

const PAGE_PATHS = [
  'pages/firstaid.html',
  'pages/hospitals.html',
  OFFLINE_PATH
];

// Every css/js file the two guidance pages load from this site (a test checks the list stays complete).
// The facility list (assets/data/facilities.json) is deliberately not saved: it can go out of date.
const ASSET_PATHS = [
  'assets/css/firstaid.css',
  'assets/css/hospitals.css',
  'assets/css/location-panel.css',
  'assets/css/offline.css',
  'assets/js/session-guard.js',
  'assets/js/main.js',
  'assets/js/request-resilience.js',
  'assets/js/firstaid.js',
  'assets/js/hospitals.js',
  'assets/js/auth-mode.js',
  'assets/js/api.js',
  'assets/js/facility-schema.js',
  'assets/js/facility-utils.js',
  'assets/js/facility-corrections.js',
  'assets/js/facility-corrections-ui.js',
  'assets/js/storage-schema.js',
  'assets/js/location-service.js',
  'assets/js/location-panel.js',
  'assets/js/i18n.js',
  'assets/js/app-enhancements.js',
  'assets/locales/en.json',
  'assets/locales/bn.json',
  'assets/images/logo.jpg',
  'assets/images/favicon.jpg'
];

const root = new URL('./', self.location).href;
const toUrl = (path) => new URL(path, root).href;
const PAGE_URLS = new Set(PAGE_PATHS.map(toUrl));
const ASSET_URLS = new Set(ASSET_PATHS.map(toUrl));
const OFFLINE_URL = toUrl(OFFLINE_PATH);

// The key a request is saved under: the .html address, whether the page was asked for as
// /pages/firstaid.html or as /pages/firstaid. Anything that is not a saved page gives null.
function savedPageKey(key) {
  if (PAGE_URLS.has(key)) return key;
  return PAGE_URLS.has(key + '.html') ? key + '.html' : null;
}

// A page the server redirected (the .html address to the clean one) is stored with redirected = true, and
// Chrome and Safari fail a navigation that is answered with such a response. Same status, headers and body, flag cleared.
function plain(response) {
  if (!response.redirected) return response;
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

function offlineText() {
  return new Response('You are offline.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

// A page that cannot be loaded shows the saved offline page straight away, with no redirect in between.
// The address bar keeps the page that was asked for, so reloading it once back online loads the real page.
// The offline page uses relative links, so a base tag makes them resolve from pages/ whatever the address is.
async function offlinePage() {
  const cache = await caches.open(CACHE_NAME);
  const saved = await cache.match(OFFLINE_URL);
  if (!saved) return offlineText();
  const html = await plain(saved).text();
  if (!/<head[^>]*>/i.test(html)) return offlineText();
  const headers = new Headers(saved.headers);
  headers.delete('content-length');
  headers.delete('content-encoding');
  headers.set('Content-Type', 'text/html; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  return new Response(
    html.replace(/<head[^>]*>/i, (tag) => tag + '<base href="' + OFFLINE_URL + '">'),
    { status: 200, headers }
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // One missing file should not block the whole install.
      Promise.all([...PAGE_URLS, ...ASSET_URLS].map((url) =>
        cache.add(url).catch(() => undefined)
      ))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names
          .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      ))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(request, cacheKey) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(cacheKey, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await cache.match(cacheKey);
    if (cached) return plain(cached);
    throw error;
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Ignore the query string and hash so "firstaid.html?x=1" still matches.
  const key = url.origin + url.pathname;
  const pageKey = savedPageKey(key);

  if (pageKey) {
    event.respondWith(networkFirst(request, pageKey).catch((error) => {
      // The offline page only ever answers a navigation, a script's fetch() gets the plain network error.
      if (request.mode !== 'navigate') throw error;
      return pageKey === OFFLINE_URL ? offlineText() : offlinePage();
    }));
  } else if (ASSET_URLS.has(key)) {
    event.respondWith(networkFirst(request, key));
  } else if (request.mode === 'navigate') {
    // Dashboard, login and every other page: network only, never stored. If it fails, show the offline page.
    event.respondWith(fetch(request).catch(offlinePage));
  }
  // Anything else (api, firebase config, data files, other requests) goes straight to the network.
});
