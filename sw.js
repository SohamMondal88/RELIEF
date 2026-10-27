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
 */
const CACHE_VERSION = 'v5';
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
  'assets/js/firstaid.js',
  'assets/js/hospitals.js',
  'assets/js/auth-mode.js',
  'assets/js/api.js',
  'assets/js/facility-schema.js',
  'assets/js/facility-utils.js',
  'assets/js/facility-corrections.js',
  'assets/js/facility-corrections-ui.js',
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

// Sends a page that cannot be loaded to the offline page (a redirect, so its links resolve correctly).
function offlinePage() {
  return Response.redirect(OFFLINE_URL, 302);
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
    if (cached) return cached;
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

  if (PAGE_URLS.has(key)) {
    event.respondWith(networkFirst(request, key).catch(() =>
      key === OFFLINE_URL
        ? new Response('You are offline.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
        : offlinePage()
    ));
  } else if (ASSET_URLS.has(key)) {
    event.respondWith(networkFirst(request, key));
  } else if (request.mode === 'navigate') {
    // Dashboard, login and every other page: network only, never stored. If it fails, show the offline page.
    event.respondWith(fetch(request).catch(offlinePage));
  }
  // Anything else (api, firebase config, data files, other requests) goes straight to the network.
});
