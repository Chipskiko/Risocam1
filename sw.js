const CACHE = 'risocam-v9';
const ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/main.css',
  '/riso_halftones.json',
  '/riso_trc.json',
  '/js/state.js',
  '/js/data.js',
  '/js/renderer.js',
  '/js/save.js',
  '/js/source.js',
  '/js/undo.js',
  '/js/compare.js',
  '/js/ui-controls.js',
  '/js/ui-paper.js',
  '/js/phone.js',
  '/js/riso-amt.js',
  '/js/riso-amt-worker.js',
  '/js/riso-amt-webgpu.js',
  '/js/cal-lut-worker.js',
  '/textures/kraft.jpg',
  '/textures/riso_standard.jpg',
  '/textures/smooth.jpg',
  '/textures/textured.jpg',
  '/textures/paper002_pbr_2k.png',
  '/icon-192.png',
  '/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // Network-first for navigation, cache-first for assets
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).catch(() => caches.match('/index.html'))
    );
  } else {
    e.respondWith(
      caches.match(e.request).then(r => r || fetch(e.request))
    );
  }
});
