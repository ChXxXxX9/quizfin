const CACHE_NAME = 'quiz-nuoto-v53_veloce';
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
  './assets/nuotifica/saira.woff2',
  './assets/nuotifica/saira-italic.woff2',
  './assets/nuotifica/caustiche-a.png',
  './assets/nuotifica/caustiche-b.png',
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

// Libreria Firebase dal CDN di Google: gli indirizzi contengono la versione, quindi non cambiano mai
const RUNTIME_CACHE = 'quiz-nuoto-sdk-v1';

// Installazione: scarico la nuova versione del sito (ricontrollando ogni file col server).
// Un file che non arriva non blocca gli altri: verrà preso dalla rete al primo uso.
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => Promise.all(APP_SHELL.map((url) =>
    fetch(new Request(url, { cache: 'no-cache' }))
      .then((res) => (res.ok ? cache.put(url, res) : null))
      .catch(() => null)
  ))));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME && key !== RUNTIME_CACHE).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

// Il sito si apre subito dalla cache della versione installata: niente attesa della rete a ogni
// pagina o a ogni tocco. Quando esce una versione nuova (CACHE_NAME cambia a ogni pubblicazione)
// il browser la scarica in sottofondo e la usa dalla pagina successiva.
async function siteFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const hit = await cache.match(request, { ignoreSearch: true });
  if (hit) return hit;
  try {
    const res = await fetch(request);
    if (res.ok && res.type === 'basic') {
      const url = new URL(request.url);
      cache.put(url.origin + url.pathname, res.clone()).catch(() => {});
    }
    return res;
  } catch (error) {
    if (request.mode === 'navigate') {
      const fallback = await cache.match('./index.html');
      if (fallback) return fallback;
    }
    throw error;
  }
}
async function sdkFirst(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone()).catch(() => {});
  return res;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin) {
    if (url.pathname.endsWith('/service-worker.js') || url.pathname.startsWith('/__/')) return;
    event.respondWith(siteFirst(request));
    return;
  }
  if (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) {
    event.respondWith(sdkFirst(request));
  }
  // Tutto il resto (database, accesso, notifiche) passa direttamente dalla rete.
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
