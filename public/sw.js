// CareLocal PWA Service Worker
const CACHE_NAME = 'carelocal-pwa-v1';
const ASSETS_TO_CACHE = [
  '/mobile/shifts',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/favicon.ico'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE).catch(err => {
        console.warn('Pre-caching some assets failed (can be ignored on dev/dynamic routes):', err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Pass-through request fetch, fall back to cache if offline
  event.respondWith(
    fetch(event.request).catch(() => {
      return caches.match(event.request);
    })
  );
});

// Handle PWA Web Push notification receipt
self.addEventListener('push', (event) => {
  if (!event.data) return;
  
  let title = 'CareLocal Alert';
  let body = 'New alert from CareLocal.';
  let url = '/mobile/shifts';

  try {
    const data = event.data.json();
    title = data.title || title;
    body = data.body || body;
    url = data.url || url;
  } catch (err) {
    // If not JSON, use the raw text as the body
    body = event.data.text() || body;
  }

  const options = {
    body: body,
    icon: '/icon-192.png',
    badge: '/favicon.ico',
    data: {
      url: url
    }
  };
  
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
        clients.forEach((client) => {
          client.postMessage({
            type: 'PUSH_RECEIVED',
            title: title,
            body: body,
            url: url
          });
        });
      })
    ])
  );
});

// Handle notification interaction click
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  const urlToOpen = event.notification.data?.url || '/mobile/shifts';
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Direct to existing mobile window if active
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if (client.url.includes('/mobile') && 'focus' in client) {
          return client.navigate(urlToOpen).then((c) => c ? c.focus() : null);
        }
      }
      // Or open a fresh mobile PWA frame
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});
