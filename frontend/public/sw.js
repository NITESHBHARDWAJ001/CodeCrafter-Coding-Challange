// Activate a new version immediately instead of waiting for every open tab to close —
// avoids testing against a stale cached worker while this is still being iterated on.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = { title: 'CodeCrafter Club', body: '' };
  try { data = { ...data, ...event.data.json() }; } catch { /* non-JSON payload: keep defaults */ }
  // No `icon` here on purpose: Windows/Chrome's toast renderer can silently drop the whole
  // notification if the icon format isn't one it likes (SVG in particular). Plain text is safe.
  event.waitUntil(
    self.registration.showNotification(data.title, { body: data.body, data: { url: data.url || '/' } })
      .catch((err) => console.error('[sw] showNotification failed', err)),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((c) => new URL(c.url).pathname === url);
      if (existing) return existing.focus();
      return self.clients.openWindow(url);
    }),
  );
});
