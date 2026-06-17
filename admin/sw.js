// Service worker — PWA Administration L'Atelier d'Estelle
// Stratégie "network-first" : on récupère toujours la dernière version en ligne
// (donc les mises à jour s'appliquent immédiatement), et on retombe sur le cache
// uniquement en cas de coupure réseau.

const CACHE = 'atelier-admin-v2';
const SHELL = [
  '/admin/',
  '/admin/index.html',
  '/js/admin.js',
  '/admin/manifest.webmanifest',
  '/admin/icon-192.png',
  '/admin/icon-512.png',
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

  e.respondWith((async () => {
    try {
      const fresh = await fetch(req);
      const cache = await caches.open(CACHE);
      cache.put(req, fresh.clone());
      return fresh;
    } catch (_) {
      const cached = await caches.match(req);
      return cached || caches.match('/admin/index.html');
    }
  })());
});

// --- Web Push : réception et clic sur une notification ---
self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (_) { data = { body: e.data ? e.data.text() : '' }; }
  const title = data.title || "L'Atelier d'Estelle";
  e.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    icon: data.icon || '/admin/icon-192.png',
    badge: data.badge || '/admin/icon-192.png',
    tag: data.tag,
    renotify: !!data.tag,
    data: { url: data.url || '/admin/' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || '/admin/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { if (c.url.includes('/admin') && 'focus' in c) return c.focus(); }
    return self.clients.openWindow ? self.clients.openWindow(target) : null;
  }));
});
