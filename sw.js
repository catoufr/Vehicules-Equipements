'use strict';
// Changer VERSION à chaque publication (avec APP_VERSION dans app.js).
const VERSION = '0.15.4';
// Préfixe propre à cette appli : les trois applis partagent la même origine,
// on ne touche jamais aux caches des autres.
const PREFIX = 'veh-equip-';
const CACHE = PREFIX + VERSION;
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'energy.js', 'maint.js', 'attach.js', 'invoice.js', 'reg.js', 'insur.js', 'equip.js', 'analyse.js', 'charges.js', 'sync.js', 'manifest-vehicules.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(FILES.map(function (f) { return new Request(f, { cache: 'reload' }); })); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k.indexOf(PREFIX) === 0 && k !== CACHE; })
          .map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

// Réseau d'abord (dernière version à l'ouverture), cache en secours hors connexion.
self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req, { cache: 'no-cache' })
      .then(function (res) {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      })
      .catch(function () {
        return caches.match(req, { ignoreSearch: true }).then(function (m) { return m || caches.match('index.html'); });
      })
  );
});
