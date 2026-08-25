/* Service Worker — Ardines Web (Depot Air Mineral)
 * Strategi:
 *  - Precache shell: halaman, manifest, ikon, dan aset statis.
 *  - Navigation requests: network-first, fallback ke cache (offline).
 *  - Aset statis (assets/): cache-first (nama hashed = immutable).
 *  - API (/api/...): network-only (data order/stok harus real-time).
 * Versi cache di-bump setiap deploy agar aset baru tidak basi.
 */
const CACHE = 'ardines-v1';
const PRECACHE = [
  '/',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-192-maskable.png',
  '/icon-512-maskable.png',
  '/favicon.svg',
  '/og.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // POST /api/orders dll — lewati

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // aset eksternal (gambar) — biarkan

  // API: network-only
  if (url.pathname.startsWith('/api/')) return;

  // Navigation (dokumen): network-first, fallback cache
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put('/', copy));
          return response;
        })
        .catch(() => caches.match('/').then((r) => r || caches.match(request)))
    );
    return;
  }

  // Statis: cache-first, revalidate ke cache
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
    )
  );
});
