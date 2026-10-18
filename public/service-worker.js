const CACHE_NAME = 'quiz-nuoto-v51_account-risultati';
const APP_SHELL = [
  './',
  './index.html',
  './admin.html',
  './istruttore.html',
  './bagnino.html',
  './arte.html',
  './style.css',
  './study-goal.css',
  './assets/fonts/adventor-regular.woff',
  './assets/fonts/adventor-bold.woff',
  './shell.js',
  './promo.js',
  './promo.css',
  './assets/nuotifica/logo-160.png',
  './assets/nuotifica/logo-320.png',
  './assets/nuotifica/doto.woff2',
  './portal.js',
  './study-goal.js',
  './fad.js',
  './app.js',
  './app_bagnino.js',
  './app_arte.js',
  './admin.js',
  './firebase-config.js',
  './account-actions.js',
  './gate.js',
  './qr.js',
  './announcements.js',
  './announcements.css',
  './push.js',
  './account.js',
  './account.css',
  './results.js',
  './badge-96.png',
  './questions.js',
  './explanations.js',
  './bagnino_questions.js',
  './bagnino_explanations.js',
  './arte_works.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => null));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request).then((cached) => cached || caches.match('./index.html')))
  );
});

// ---------------- Notifiche push (Firebase Cloud Messaging) ----------------
// I messaggi arrivano con i nostri campi in "data": la notifica la mostra questo service worker,
// così funziona allo stesso modo su Android, iPhone (app aggiunta alla Home) e computer.
function readPush(event) {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch (e) { payload = { body: event.data ? event.data.text() : '' }; }
  const d = payload.data || payload.notification || payload;
  return {
    title: d.titolo || d.title || 'Quiz Nuoto',
    body: d.corpo || d.body || '',
    url: d.url || (payload.fcmOptions && payload.fcmOptions.link) || './index.html',
    tag: d.tag || undefined
  };
}
self.addEventListener('push', (event) => {
  const m = readPush(event);
  event.waitUntil(self.registration.showNotification(m.title, {
    body: m.body,
    icon: './icon-192.png',
    badge: './badge-96.png',
    tag: m.tag,
    renotify: Boolean(m.tag),
    data: { url: m.url }
  }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || './index.html', self.location.href).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of windows) {
      if (new URL(w.url).origin === self.location.origin && 'focus' in w) {
        await w.focus();
        if ('navigate' in w && w.url !== url) { try { await w.navigate(url); } catch (e) { /* niente */ } }
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
