// Service worker — PWA « Mon espace » L'Atelier d'Estelle
// Stratégie "network-first" : on récupère toujours la dernière version en ligne
// (les mises à jour s'appliquent immédiatement), et on retombe sur le cache
// uniquement en cas de coupure réseau.

const CACHE = 'atelier-espace-v1';
const SHELL = [
  '/compte.html',
  '/js/compte.js',
  '/css/style.css',
  '/favicon.svg',
  '/icon-192.png',
  '/icon-512.png',
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {})));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  // On ne touche pas aux requêtes API (autre origine : le Worker) ni aux non-GET
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  // On laisse le site vitrine (autres pages) au navigateur : on ne gère que l'espace
  if (req.mode === 'navigate' && url.pathname !== '/compte.html') return;

  e.respondWith((async () => {
    try {
      const fresh = await fetch(req);
      const cache = await caches.open(CACHE);
      cache.put(req, fresh.clone());
      return fresh;
    } catch (_) {
      const cached = await caches.match(req);
      return cached || caches.match('/compte.html');
    }
  })());
});
