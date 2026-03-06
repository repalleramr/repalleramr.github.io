const CACHE_NAME = 'baccarat-v31-chrome-safe-v3';
const APP_SHELL = [
  './',
  './?source=pwa',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './poster/poster-1024.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const network = await fetch(event.request);
        const cache = await caches.open(CACHE_NAME);
        cache.put('./index.html', network.clone());
        return network;
      } catch (error) {
        return (await caches.match('./index.html')) || (await caches.match('./'));
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(event.request, { ignoreSearch: true });
    if (cached) return cached;
    try {
      const network = await fetch(event.request);
      if (network && network.status === 200) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(event.request, network.clone());
      }
      return network;
    } catch (error) {
      return (await caches.match('./index.html')) || Response.error();
    }
  })());
});
