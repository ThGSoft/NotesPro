/* NotesPro offline shell: cache static assets and last HTML so the dashboard can reopen. */
const CACHE = 'notespro-offline-v1';

function isApiRequest(url) {
  return /\/api\//.test(url.pathname);
}

function isAuthOrAdmin(url) {
  return /\/(admin|login|logout|register|activate)\b/.test(url.pathname);
}

function isStaticAsset(url) {
  if (/\.(js|css|png|jpe?g|gif|ico|webp|svg|woff2?|map)(\?|$)/i.test(url.pathname)) return true;
  const host = url.hostname;
  return host.includes('cdn.jsdelivr.net')
    || host.includes('code.jquery.com')
    || host.includes('cdnjs.cloudflare.com');
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  const network = fetch(request).then((response) => {
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => cached);
  return cached || network;
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  let url;
  try {
    url = new URL(request.url);
  } catch (_) {
    return;
  }
  if (isApiRequest(url) || isAuthOrAdmin(url)) return;
  if (isStaticAsset(url)) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }
  const accept = request.headers.get('accept') || '';
  if (request.mode === 'navigate' || accept.includes('text/html')) {
    event.respondWith(networkFirst(request));
  }
});
