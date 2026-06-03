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
  '/js/cooking-mode.js',
  '/js/cooking.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

// Chỉ cache-first cho static assets (icons, fonts)
const STATIC_EXT = ['.png', '.svg', '.ico', '.webp', '.woff', '.woff2', '.ttf'];

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
  const url = new URL(event.request.url);
  const isStatic = STATIC_EXT.some(ext => url.pathname.endsWith(ext));

  if (isStatic) {
    // Cache-first cho ảnh, icon (không thay đổi)
    event.respondWith(
      caches.match(event.request).then(cached =>
        cached || fetch(event.request).then(response => {
          const cloned = response.clone();
          caches.open(CACHE).then(cache => cache.put(event.request, cloned));
          return response;
        })
      )
    );
  } else {
    // Network-first cho HTML, JS, CSS, API (luôn lấy mới, cache fallback)
    event.respondWith(
      fetch(event.request).then(response => {
        const cloned = response.clone();
        caches.open(CACHE).then(cache => cache.put(event.request, cloned));
        return response;
      }).catch(() => caches.match(event.request).then(cached =>
        cached || new Response('Không có kết nối mạng', { status: 503 })
      ))
    );
  }
});
