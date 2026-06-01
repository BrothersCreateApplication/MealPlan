// Vào Bếp - Service Worker
const CACHE = 'vaobep-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/style.css',
  '/js/app.js',
  '/js/home.js',
  '/js/fridge.js',
  '/js/cart.js',
  '/js/history.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(cached =>
      cached || fetch(event.request).then(response =>
        caches.open(CACHE).then(cache => {
          cache.put(event.request, response.clone());
          return response;
        })
      ).catch(() => new Response('Không có kết nối mạng', { status: 503 }))
    )
  );
});
