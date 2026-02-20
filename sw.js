// Parkpickerl Checker – Service Worker
// Ermöglicht Offline-Modus, Caching, Push-Benachrichtigungen

const CACHE_NAME = 'parkpickerl-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://fonts.googleapis.com/css2?family=Syne:wght@400;600;800&family=DM+Mono:wght@400;500&display=swap',
];

// ─── Install: Assets cachen ───────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW] Caching static assets');
      // Einzeln cachen damit ein Fehler nicht alles blockiert
      return Promise.allSettled(
        STATIC_ASSETS.map(url => cache.add(url).catch(e => console.warn('[SW] Cache miss:', url, e)))
      );
    }).then(() => self.skipWaiting())
  );
});

// ─── Activate: Alte Caches löschen ───────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ─── Fetch: Cache-First für statische Assets, Network-First für API ─
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // API-Abfragen: Network-First (brauchen aktuelle Daten)
  if (url.pathname.startsWith('/api/') || url.hostname === 'data.wien.gv.at') {
    event.respondWith(
      fetch(event.request)
        .then(res => res)
        .catch(() => new Response(
          JSON.stringify({ error: 'offline', message: 'Keine Internetverbindung.' }),
          { headers: { 'Content-Type': 'application/json' } }
        ))
    );
    return;
  }

  // Karten-Tiles: Network-First mit Cache-Fallback
  if (url.hostname.includes('carto') || url.hostname.includes('openstreetmap')) {
    event.respondWith(
      fetch(event.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME + '-tiles').then(c => c.put(event.request, clone));
          return res;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Alles andere: Cache-First
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        }
        return res;
      });
    })
  );
});

// ─── Push-Benachrichtigungen ──────────────────────────────────────
self.addEventListener('push', event => {
  const data = event.data?.json() || {
    title: 'Parkpickerl Checker',
    body: 'Erinnerung: Parkschein prüfen!',
    icon: '/icon-192.png'
  };
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon || '/icon-192.png',
      badge: '/icon-192.png',
      vibrate: [200, 100, 200],
      data: { url: data.url || '/' }
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(clientList => {
      const url = event.notification.data?.url || '/';
      for (const client of clientList) {
        if (client.url === url && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
