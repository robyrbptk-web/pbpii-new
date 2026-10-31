/**
 * App-shell cache for the PB PII site. Content from /api/ and the globe bundle
 * under /peta/ always goes to the network; this worker only keeps the shell so
 * the installed app opens instantly and survives a lost connection.
 */
const CACHE_NAME = 'pbpii-shell-v20';
const APP_SHELL = [
  '/',
  '/index.html',
  '/ibadah.html',
  '/peta.html',
  '/tanya.html',
  '/acara.html',
  '/login.html',
  '/admin.html',
  '/daftar.html',
  '/lembaga.html',
  '/formulir.html',
  '/offline.html',
  '/styles.css',
  '/captcha.css',
  '/app.js',
  '/ibadah.js',
  '/site.js',
  '/tanya.js',
  '/acara.js',
  '/akun.js',
  '/captcha.js',
  '/manifest.json',
  '/assets/quran-surah.json',
  '/assets/ibadah-kota.json',
  '/assets/logo-pii.png',
  '/assets/icon-192.png',
  '/assets/icon-512.png',
  '/assets/icon-maskable-512.png',
  '/assets/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // One missing asset must not abort the whole install.
      .then((cache) => Promise.allSettled(APP_SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

/** Network-first, falling back to the cached copy. */
async function freshThenCache(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);
  if (event.request.method !== 'GET' || requestUrl.origin !== self.location.origin) return;
  if (requestUrl.pathname.startsWith('/api/')) return;
  // The globe ships its own hashed build; caching would pin an old bundle.
  if (requestUrl.pathname.startsWith('/peta/')) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      freshThenCache(event.request).catch(async () => {
        const cachedPage = await caches.match(event.request, { ignoreSearch: true });
        return cachedPage || caches.match('/offline.html');
      })
    );
    return;
  }

  // Scripts and styles change with every deploy, so they are network-first.
  if (/\.(?:js|css)$/.test(requestUrl.pathname)) {
    event.respondWith(freshThenCache(event.request).catch(() => new Response('', { status: 504 })));
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      });
    })
  );
});
