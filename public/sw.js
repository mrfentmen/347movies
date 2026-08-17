/* 347movies service worker (PWA). Deliberately conservative, constitution §7 in mind:
   video bytes are NEVER cached (they live on archive.org and are fetched cross-origin —
   this worker only ever handles same-origin requests). The shell (css/js/fonts/images)
   is cached for offline-ish loading; HTML and all API requests always hit the network so
   the catalog stays fresh. Third-party hosts (archive.org, ads, fonts CDNs) are ignored. */
const CACHE = "347movies-shell-v1";
const SHELL = [
  "/",
  "/css/style.css",
  "/js/app.js",
  "/favicon.svg",
  "/fonts/limelight.woff2",
  "/fonts/plex-sans.woff2",
  "/fonts/plex-mono-400.woff2",
  "/fonts/plex-mono-500.woff2",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
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

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Only same-origin GETs; navigations and API always hit the network (fresh content).
  if (url.origin !== self.location.origin) return;
  if (event.request.method !== "GET") return;
  if (event.request.mode === "navigate") return;
  if (url.pathname.startsWith("/api/")) return;
  event.respondWith(
    caches.match(event.request).then((hit) => {
      if (hit) return hit;
      return fetch(event.request).then((res) => {
        if (res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return res;
      });
    }),
  );
});
