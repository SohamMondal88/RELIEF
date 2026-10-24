/*
 * RELIEF service worker (offline access for first aid guidance and saved hospitals).
 *
 * Bump CACHE_VERSION whenever a file in PRECACHE_PATHS changes. Old
 * "relief-static-*" caches are deleted on activate.
 *
 * Only same-origin GET requests for the exact paths below are ever cached.
 * Accounts, dashboard, login, firebase and api calls are never stored.
 */
const CACHE_VERSION = 'v1';
const CACHE_PREFIX = 'relief-static-';
const CACHE_NAME = CACHE_PREFIX + CACHE_VERSION;

// Paths are relative to the folder sw.js lives in (the site root).
const PAGE_PATHS = [
  'pages/firstaid.html',
  'pages/hospitals.html'
];

const ASSET_PATHS = [
  'assets/css/firstaid.css',
  'assets/css/hospitals.css',
  'assets/js/main.js',
  'assets/js/firstaid.js',
  'assets/js/hospitals.js',
  'assets/js/app-enhancements.js',
  'assets/images/logo.jpg'
];

const root = new URL('./', self.location).href;
const toUrl = (path) => new URL(path, root).href;
const PAGE_URLS = new Set(PAGE_PATHS.map(toUrl));
const ASSET_URLS = new Set(ASSET_PATHS.map(toUrl));

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

async function cacheFirst(request, cacheKey) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) {
    cache.put(cacheKey, response.clone());
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Ignore the query string and hash so "firstaid.html?x=1" still matches.
  const key = url.origin + url.pathname;

  if (PAGE_URLS.has(key)) {
    event.respondWith(networkFirst(request, key));
  } else if (ASSET_URLS.has(key)) {
    event.respondWith(cacheFirst(request, key));
  }
  // Anything else (dashboard, login, api, firebase config...) goes straight to the network.
});
