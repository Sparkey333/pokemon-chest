/* Pokémon Den — service worker.
 *
 * Exists for one reason: so the app opens and works when the phone has no
 * signal. It is deliberately conservative about what it is willing to hand
 * back from cache, because a collection tracker that shows you stale prices
 * is worse than one that admits it is offline.
 *
 * The rules:
 *   /api/*        never cached, never intercepted — live prices, BYOK proxy
 *                 calls and the local server's own routes must always be real.
 *   /data/*       network first, cache as a fallback. Your collection changes
 *                 whenever the export is re-read; the cached copy is only
 *                 there so the app still opens on a plane.
 *   app shell     stale-while-revalidate. Serve instantly from cache, then
 *                 quietly refresh in the background for next launch.
 *   cross-origin  not intercepted at all (card art from TCGdex) — the browser
 *                 cache already handles those, and holding someone else's
 *                 images in our quota is how you blow a phone's storage.
 *
 * The cache name carries the app version, so shipping a new build drops every
 * old entry on activate rather than leaving a half-updated shell behind.
 */
const VERSION = '2.4.0';
const CACHE = `pokechest-shell-v${VERSION}`;

/* The minimum set that has to be present for the app to boot and render. */
const SHELL = [
  '/',
  '/index.html',
  '/assets/styles.css',
  '/assets/revamp.css',
  '/assets/app.js',
  '/assets/revamp.js',
  '/manifest.webmanifest',
  '/assets/pwa/icon-192.png',
  '/assets/pwa/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  // addAll is all-or-nothing; a single 404 would leave us with no cache at
  // all, so each entry is allowed to fail on its own.
  e.waitUntil(caches.open(CACHE)
    .then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => { }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('message', e => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // card art etc — hands off
  if (url.pathname.startsWith('/api/')) return;      // never cache live data

  if (url.pathname.startsWith('/data/')) {
    e.respondWith(
      fetch(req)
        .then(res => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then(hit => hit || Response.error()))
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(hit => {
      const net = fetch(req)
        .then(res => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(req, copy));
          }
          return res;
        })
        .catch(() => hit || Response.error());
      return hit || net;
    })
  );
});
