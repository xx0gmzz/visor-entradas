// Service worker: guarda la app en caché para que abra sin conexión.
// Las entradas no pasan por aquí: están en IndexedDB.

const CACHE = "visor-entradas-__BUILD__"; // el despliegue sustituye __BUILD__ por el commit

const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.webmanifest",
  "./js/app.js",
  "./js/db.js",
  "./js/files.js",
  "./icons/icon.svg",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./vendor/pdfjs/pdf.min.mjs",
  "./vendor/pdfjs/pdf.worker.min.mjs",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Primero la caché (abre al instante y sin cobertura); si no está, la red.
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || new URL(request.url).origin !== location.origin) return;
  event.respondWith(
    caches
      .match(request, { ignoreSearch: true })
      .then(
        (cached) =>
          cached ||
          fetch(request).catch(() =>
            request.mode === "navigate" ? caches.match("./index.html") : Response.error(),
          ),
      ),
  );
});
