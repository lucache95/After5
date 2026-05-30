/* after5 service worker — minimal offline app-shell + push notifications.
 *
 * Conservative by design:
 *  - Caches only a tiny static app shell (offline fallback page + manifest/icons).
 *  - NEVER caches API, auth, or any non-GET / cross-origin requests.
 *  - Network-first for navigations, falling back to the cached shell offline.
 */

const CACHE = 'after5-shell-v1';

// App-shell assets safe to precache. Keep this list tiny and static.
const SHELL = [
  '/offline',
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/icons/icon-maskable.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

// Only intercept top-level navigations. Network-first; on failure serve the
// cached offline shell. All other requests (API, auth, assets) pass straight
// through to the network untouched.
self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;
  if (request.mode !== 'navigate') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Never touch API/auth routes.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return;

  event.respondWith(
    fetch(request).catch(() =>
      caches.match('/offline').then((cached) => cached || Response.error()),
    ),
  );
});

// Push: show a notification built from the push payload. Payload is expected
// as JSON { title, body, url, tag }, but plain-text and empty payloads degrade
// gracefully.
self.addEventListener('push', (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      data = { body: event.data.text() };
    }
  }

  const title = data.title || 'after5';
  const options = {
    body: data.body || 'you have a new update',
    icon: '/icons/icon.svg',
    badge: '/icons/icon.svg',
    tag: data.tag || 'after5-push',
    data: { url: data.url || '/home' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Focus an existing tab or open the target URL when a notification is tapped.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/home';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
