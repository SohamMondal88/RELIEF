const CACHE = 'relief-v1';
const CORE = ['/', '/index.html', '/assets/css/style.css', '/assets/css/ui-enhancements.css', '/assets/js/main.js', '/assets/js/app-enhancements.js', '/assets/js/i18n.js', '/assets/js/auth-session.js', '/assets/js/chatbot.js'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((res) => {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(event.request, copy));
    return res;
  }).catch(() => cached)));
});
