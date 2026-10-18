// Gemmer appens egne filer, så listen kan åbnes i butikken uden net.
const CACHE = "madplan-v2";
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/", "/manifest.webmanifest", "/icon.svg"])));
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  // Sider: prøv nettet først. Filer med hash i navnet: brug det gemte.
  if (e.request.mode === "navigate") {
    e.respondWith(fetch(e.request).then((r) => { caches.open(CACHE).then((c) => c.put("/", r.clone())); return r; }).catch(() => caches.match("/")));
    return;
  }
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return r;
  })));
});

// Notifikationer fra familien.
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || "Familiens Madplan", {
    body: d.body || "",
    tag: d.tag || "madplan",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { tab: d.tag === "vote" ? "vote" : d.tag === "votes" ? "plan" : "list" },
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = "/?tab=" + ((e.notification.data && e.notification.data.tab) || "list");
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) { if ("focus" in c) { c.navigate(url).catch(() => {}); return c.focus(); } }
    return self.clients.openWindow(url);
  }));
});
