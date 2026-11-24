// Offline cache: app files network-first (so updates land), CDN libraries and
// ML models cache-first (they are pinned to exact versions).
const CACHE = 'living-murals-v3';
const CDN = ['cdn.jsdelivr.net', 'storage.googleapis.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (CDN.includes(url.hostname)) {
    e.respondWith(caches.open(CACHE).then(async c => (await c.match(req)) || fetch(req).then(r => { if (r.ok || r.type === 'opaque') c.put(req, r.clone()); return r; })));
  } else if (url.origin === location.origin) {
    e.respondWith(fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }).then(r => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return r; }).catch(() => caches.match(req)));
  }
});
