// Wild Mystics service worker: offline play + instant repeat loads.
// - Navigations: network first (fresh index.html after deploys), cached copy offline.
// - Hashed build files (assets/*-[hash].js|css): cache first — they never change.
// - Game assets (models, audio, portraits, textures): stale-while-revalidate.
// - Never touches the cloud-save API or cross-origin requests.
const CACHE = 'wm-v2';
const CORE = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './assets/manifest.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

const hashed = /\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.(js|css|woff2?|wasm)$/;

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.includes('/api/')) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('./index.html', copy)); return res; }).catch(() => caches.match('./index.html')));
    return;
  }
  if (hashed.test(url.pathname)) {
    e.respondWith(caches.match(req).then((hit) => hit ?? fetch(req).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return res; })));
    return;
  }
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const hit = await c.match(req);
    const net = fetch(req).then((res) => { if (res.ok && res.status === 200) c.put(req, res.clone()); return res; }).catch(() => hit);
    return hit ?? net;
  }));
});
