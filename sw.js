const CACHE_NAME = "bird-royale-v3";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./game.js",
  "./sounds.js",
  "./ambientPresets.js",
  "./clientRenderLoop.js",
  "./manifest.webmanifest",
  "./assets/icon.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
      .catch(() => undefined)
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  const isAppAsset = [
    "/", "/index.html", "/styles.css", "/game.js", "/sounds.js", "/ambientPresets.js",
    "/clientRenderLoop.js", "/manifest.webmanifest", "/assets/icon.svg"
  ].includes(url.pathname) || url.pathname.endsWith(".js") || url.pathname.endsWith(".css") || url.pathname.endsWith(".html");

  if (!isAppAsset && url.origin === self.location.origin) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => undefined);
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || Response.error()))
  );
});
