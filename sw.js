// Service worker ของ My Money Planner: ใช้งานออฟไลน์ได้
// ออนไลน์ = โหลดเวอร์ชันล่าสุดเสมอ (แล้วเก็บสำเนาไว้) · ออฟไลน์ = ใช้สำเนาที่เก็บไว้
const CACHE = "mmp-v2";
const ASSETS = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png"];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return Promise.all(ASSETS.map(function (a) { return c.add(a).catch(function () {}); }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  const r = e.request;
  // ไม่ยุ่งกับคำขอไปยัง Google Apps Script หรือโดเมนอื่น
  if (r.method !== "GET" || new URL(r.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(r).then(function (res) {
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(r, copy); }); }
      return res;
    }).catch(function () {
      return caches.match(r).then(function (m) { return m || caches.match("./index.html"); });
    })
  );
});
