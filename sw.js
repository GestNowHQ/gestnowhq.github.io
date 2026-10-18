// GestNow Mini: keeps the app's own files on the phone, so Picar opens without network (taps then wait in the queue).
// Only GET requests to this same site are handled. Supabase (data, login, files) is another site: never touched,
// never cached. Network first, so a new version arrives as soon as there is network; the copy is only a fallback.
'use strict';
const CACHE = 'gestnow-mini-v23';
const SHELL = ['./', 'index.html', 'app.js', 'style.css', 'config.js', 'vendor/supabase-2.117.2.js', 'ui/gnui.js', 'ui/gnui.css', 'vendor/inter-latin-wght.woff2'];

self.addEventListener('install', (e) => {
  // cache: 'reload' skips the browser's own 10-minute copy, so a new version never installs old files.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
function network(req) {   // a weak network should not hold the app for long: after 6 s the copy is used
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), 6000);
    fetch(req, { cache: 'no-cache' }).then((r) => { clearTimeout(t); resolve(r); }, (err) => { clearTimeout(t); reject(err); });
  });
}
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // Supabase and anything else: straight to the network
  e.respondWith(network(req).then((res) => {
    if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true })
    .then((hit) => hit || (req.mode === 'navigate' ? caches.match('index.html') : Response.error()))));
});
