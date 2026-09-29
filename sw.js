/* FoxMusic V3 - Service Worker
 * Strategi:
 * - App shell (HTML, manifest, ikon PNG) -> cache-first + fallback offline
 * - CDN statis (Tailwind, Fonts, Remixicon) -> stale-while-revalidate
 * - API dinamis (/api/*, /health, /resolve) -> network-only (TIDAK di-cache)
 * - Audio streaming -> network-only (TIDAK di-cache)
 * - Cross-origin API (port 4127) -> network-only (TIDAK di-cache)
 */

const VERSION = 'v3.0.0';
const CACHE_NAME = 'foxmusic-' + VERSION;
const RUNTIME_CACHE = 'foxmusic-runtime-' + VERSION;

const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith('foxmusic-') && key !== CACHE_NAME && key !== RUNTIME_CACHE)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

function isApiRequest(url) {
  if (url.pathname.startsWith('/api/')) return true;
  if (url.pathname === '/health') return true;
  if (url.pathname === '/resolve') return true;
  return false;
}

function isAudioRequest(url) {
  return /\.(mp3|m4a|ogg|wav|aac|flac)(\?|$)/i.test(url.pathname);
}

function isStaticAsset(url) {
  if (url.origin === self.location.origin) return true;
  const h = url.hostname;
  return (
    h.includes('tailwindcss.com') ||
    h.includes('fonts.googleapis.com') ||
    h.includes('fonts.gstatic.com') ||
    h.includes('jsdelivr.net')
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  let url;
  try { url = new URL(request.url); } catch { return; }

  if (isApiRequest(url) || isAudioRequest(url)) return;

  if (url.origin !== self.location.origin && !isStaticAsset(url)) return;

  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {});
          return response;
        })
        .catch(() => caches.match(request).then((c) => c || caches.match('./index.html')))
    );
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then((cache) =>
        cache.match(request).then((cached) => {
          const fetchPromise = fetch(request)
            .then((networkResponse) => {
              if (networkResponse && networkResponse.status === 200) {
                cache.put(request, networkResponse.clone()).catch(() => {});
              }
              return networkResponse;
            })
            .catch(() => cached);
          return cached || fetchPromise;
        })
      )
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const copy = response.clone();
          caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});