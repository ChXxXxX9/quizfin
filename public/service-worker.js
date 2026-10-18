const CACHE_NAME = 'quiz-nuoto-v49_firebase';
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
  './assets/fonts/schola-regular.woff',
  './assets/fonts/schola-bold.woff',
  './assets/fonts/schola-italic.woff',
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
