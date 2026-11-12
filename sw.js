/**
 * App-shell cache for the PB PII site. Content from /api/ and the globe bundle
 * under /peta/ always goes to the network; this worker only keeps the shell so
 * the installed app opens instantly and survives a lost connection.
 */
const CACHE_NAME = 'pbpii-shell-v68';
const APP_SHELL = [
  '/',
  '/index.html',
  '/app',
  '/app/acara',
  '/app/artikel',
  '/app/feed',
  '/app/ibadah',
  '/app/notifikasi',
  '/app/profil',
  '/app/pustaka',
  '/app/tanya',
  '/ibadah.html',
  '/peta.html',
  '/situasi',
  '/situasi.html',
  '/tanya.html',
  '/pustaka.html',
  '/pustaka',
  '/acara.html',
  '/feed.html',
  '/profil.html',
  '/sso.html',
  '/login.html',
  '/admin.html',
  '/daftar.html',
  '/lembaga.html',
  '/formulir.html',
  '/offline.html',
  '/styles.css',
  '/appshell.css',
  '/appshell.js',
  '/captcha.css',
  '/perpustakaan.css',
  '/perpustakaan.js',
  '/cerita.css',
  '/app.js',
  '/ibadah.js',
  '/ibadah.css',
  '/site.js',
  '/markdown.js',
  '/office.js',
  '/tanya.js',
  '/situasi.css',
  '/situasi.js',
  '/vendor/leaflet/leaflet.css',
  '/vendor/leaflet/leaflet.js',
  '/vendor/hls/hls.min.js',
  '/acara.js',
  '/feed.js',
  '/profil.js',
  '/cerita.js',
  '/akun.js',
  '/notifikasi.js',
  '/captcha.js',
  '/editor.css',
  '/editor.js',
  '/form-builder.js',
  '/manifest.json',
  '/assets/quran-surah.json',
  '/assets/ibadah-kota.json',
  '/assets/logo-pii.webp',
  '/assets/ketua-umum-2026.jpg',
  '/assets/icon-192.png',
  '/assets/icon-512.png',
  '/assets/icon-maskable-512.png',
  '/assets/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // One missing asset must not abort the whole install.
      .then((cache) => Promise.allSettled(APP_SHELL.map(async (url) => {
        /* Berkas statis boleh dijawab cache HTTP sampai sehari penuh, jadi
           pratinjau pun harus menembusnya; kalau tidak, salinan lama di
           perangkat ikut dibekukan ke dalam cache versi baru. */
        const jawaban = await fetch(new Request(url, { cache: 'reload' }));
        if (jawaban.ok) await cache.put(url, jawaban);
      })))
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

/**
 * Stale-while-revalidate for scripts and styles: the saved copy paints at once
 * instead of blocking the page on a phone connection, and the fresh copy is
 * written for the next visit. Safe because every deploy that touches these
 * files bumps CACHE_NAME, so `activate` clears the cache first and nobody is
 * left reading a stale bundle behind new markup.
 */
async function cacheThenRefresh(request) {
  const cache = await caches.open(CACHE_NAME);
  const saved = await cache.match(request, { ignoreSearch: true });
  /* Saat versi cache naik salinan tersimpan belum ada, dan permintaan pengganti
     itu tidak boleh menjawab dari sendiri: berkas statis dibatasi
     "stale-while-revalidate=86400", jadi cache HTTP memberikan salinan lama dan
     salinan usang itu ikut tersimpan di cache baru. Pengunjung kemudian terpaku
     pada gaya lama selama sehari penuh walaupun markup-nya sudah baru. Karena
     itu pancingan pertama menembus ke jaringan; sesudah ada salinan, penyegaran
     berjalan senyap seperti biasa. */
  const permintaan = saved ? request : new Request(request, { cache: 'reload' });
  const refresh = fetch(permintaan)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  if (saved) return saved;
  const online = await refresh;
  if (online) return online;
  throw new Error('offline');
}

self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);
  if (event.request.method !== 'GET' || requestUrl.origin !== self.location.origin) return;
  if (requestUrl.pathname.startsWith('/api/')) return;
  // Serving the worker from cache would pin this file to its own old version.
  if (requestUrl.pathname === '/sw.js') return;
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

  // Scripts and styles change with every deploy, but a phone should not wait on
  // them; the background refresh plus the CACHE_NAME bump keeps them current.
  if (/\.(?:js|css)$/.test(requestUrl.pathname)) {
    event.respondWith(cacheThenRefresh(event.request).catch(() => new Response('', { status: 504 })));
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
