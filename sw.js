const CACHE_NAME = 'conecta-cache-v25';
const APP_SHELL = ['./', './index.html', './styles.css', './responsive-overrides.css', './desktop-search.css', './campus-features.css', './polls.css', './script.js', './push-notifications.js', './campus-features.js', './polls.js', './story-composer-ui.js', './pwa-install.js', './manifest.json', './icon.svg'];
const APP_SHELL_URLS = new Set(
  APP_SHELL.map((path) => new URL(path, self.registration.scope).href)
);

function getSafeAppUrl(value, fallback = './') {
  try {
    const url = new URL(value || fallback, self.registration.scope);
    return url.origin === self.location.origin ? url.href : new URL(fallback, self.registration.scope).href;
  } catch {
    return new URL(fallback, self.registration.scope).href;
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.all(
        APP_SHELL.map((path) => {
          const url = new URL(path, self.registration.scope).href;
          return cache.add(url).catch((error) => {
            console.warn(`No se pudo guardar ${url} para uso sin conexión:`, error);
          });
        })
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key.startsWith('conecta-cache-') && key !== CACHE_NAME) return caches.delete(key);
        })
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  if (new URL(event.request.url).origin !== self.location.origin) return;

  const isNavigation = event.request.mode === 'navigate';
  const isAppShellRequest = APP_SHELL_URLS.has(event.request.url);
  if (!isNavigation && !isAppShellRequest) return;

  // Guardamos únicamente recursos estáticos del shell, nunca respuestas de usuario/API.
  event.respondWith(
    fetch(event.request).then(async (response) => {
      if (response.ok) {
        try {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(event.request, response.clone());
        } catch (error) {
          console.warn('No se pudo actualizar la copia local de CONECTA:', error);
        }
      }
      return response;
    }).catch(async () => {
      const cached = await caches.match(event.request);
      if (cached) return cached;
      if (isNavigation) {
        return (await caches.match(new URL('./index.html', self.registration.scope).href)) || Response.error();
      }
      return Response.error();
    })
  );
});

self.addEventListener('push', (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      data = { body: event.data.text() };
    }
  }

  const notification = data.notification || data;
  const messageData = data.data && typeof data.data === 'object' ? data.data : {};
  const safeUrl = getSafeAppUrl(messageData.url || data.url, './');
  const safeIcon = getSafeAppUrl(notification.icon || data.icon, './icon.svg');
  const safeBadge = getSafeAppUrl(notification.badge || data.badge, './icon.svg');
  event.waitUntil(
    self.registration.showNotification(String(notification.title || data.title || 'Notificación CONECTA'), {
      body: String(notification.body || data.body || ''),
      icon: safeIcon,
      badge: safeBadge,
      data: safeUrl
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = getSafeAppUrl(event.notification.data, './');
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (new URL(client.url).href === targetUrl && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});
