// Service worker: cache the app shell, keep news fresh (network first), open links from notifications.
const SHELL = "upsc-shell-v1";
const ASSETS = ["/", "/static/styles.css", "/static/app.js", "/static/icon-192.png", "/manifest.webmanifest"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(SHELL).then((c) => c.addAll(ASSETS))); self.skipWaiting(); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== SHELL && k !== "upsc-data").map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/pdf/")) return;          // let the browser download PDFs directly
  if (url.pathname.startsWith("/api/")) {
    // network first; fall back to last copy so the day's notes can be read offline
    e.respondWith(fetch(e.request).then((r) => {
      if (r.ok && (url.pathname.startsWith("/api/day/") || url.pathname === "/api/overview")) {
        const copy = r.clone(); caches.open("upsc-data").then((c) => c.put(e.request, copy));
      }
      return r;
    }).catch(() => caches.match(e.request)));
    return;
  }
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok) { const copy = r.clone(); caches.open(SHELL).then((c) => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request).then((m) => m || caches.match("/"))));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const link = "/" + (e.notification.data?.link || "#/today");
  e.waitUntil(self.clients.matchAll({ type: "window" }).then((cs) => {
    for (const c of cs) { c.navigate(link); return c.focus(); }
    return self.clients.openWindow(link);
  }));
});
