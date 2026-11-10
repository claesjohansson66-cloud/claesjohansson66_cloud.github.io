/* Service worker för Hundregistrering
   - Med uppkoppling: hämtar alltid senaste versionen av sidan från servern.
   - Utan uppkoppling (eller mycket dålig täckning): använder sparad kopia.
   - Tar över direkt och tar bort gamla cacher från tidigare versioner. */

const CACHE = 'hundprov-v2';
const START = ['./', './index.html'];
const TIMEOUT_MS = 4000; // så länge vi väntar på nätet innan sparad kopia används

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    for (const url of START) {
      try {
        const res = await fetch(url, { cache: 'reload' });
        if (res.ok) await cache.put(url, res);
      } catch (e) { /* offline vid installation – försök igen senare */ }
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  const done = (async () => {
    const keys = await caches.keys();
    const old = keys.filter((k) => k !== CACHE);
    await Promise.all(old.map((k) => caches.delete(k)));
    await self.clients.claim();
    return old.length > 0;
  })();
  event.waitUntil(done);
  // Ersatte vi en äldre version? Ladda om öppna sidor så att den nya versionen visas direkt.
  // (Görs först när aktiveringen är klar, annars väntar sidan och service workern på varandra.)
  done.then(async (replaced) => {
    if (!replaced) return;
    await new Promise((r) => setTimeout(r, 200));
    const wins = await self.clients.matchAll({ type: 'window' });
    wins.forEach((w) => { w.navigate(w.url).catch(() => {}); });
  });
});

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/* Sidan själv: nätet först, sparad kopia som reserv */
async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  const net = fetch(request, { cache: 'no-store' }).then(async (res) => {
    if (res && res.ok) {
      await cache.put('./index.html', res.clone());
      await cache.put('./', res.clone());
    }
    return res;
  });
  try {
    return await withTimeout(net, TIMEOUT_MS);
  } catch (e) {
    const cached = (await cache.match('./index.html')) || (await cache.match('./'));
    if (cached) return cached;
    return net; // ingen kopia sparad ännu – vänta på nätet ändå
  }
}

/* Övriga filer (typsnitt, ikoner m.m.): sparad kopia direkt, uppdateras i bakgrunden */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  const net = fetch(request).then((res) => {
    if (res && (res.ok || res.type === 'opaque')) cache.put(request, res.clone());
    return res;
  }).catch(() => cached);
  return cached || net;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.pathname.endsWith('/sw.js')) return;

  const isPage = req.mode === 'navigate' ||
    (url.origin === self.location.origin && (url.pathname.endsWith('/') || url.pathname.endsWith('.html')));

  if (isPage) {
    event.respondWith(networkFirst(req));
  } else {
    event.respondWith(staleWhileRevalidate(req));
  }
});
