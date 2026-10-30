/**
 * GBFS bike-share feed proxy.
 *
 * The client builds `/api/gbfs/${encodeURIComponent(upstreamUrl)}`, so this
 * single catch-all file answers every bike-share host the globe knows about.
 * It is an OPEN path, so nothing is forwarded before the target passes all
 * four gates: HTTPS-only, an allowlisted host, an allowlisted station feed
 * path, and a bounded response size. Credentials, ports and redirects out of
 * the allowlist are refused.
 *
 * The client does `response.json()` and throws on any non-OK status, so a
 * successful answer is the upstream GBFS JSON with its own content type; every
 * refusal here is small JSON with a non-2xx status instead of Vercel's 404 text.
 */
import { createTtlCache } from '../../lib/proxy.js';

const UPSTREAM_TIMEOUT_MS = 12_000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
/** station_information is semi-static; station_status is real-time (uncached). */
const INFORMATION_TTL_MS = 300_000;
const MAX_CACHE_ENTRIES = 48;

const ALLOWED_HOSTS = new Set([
  'gbfs.lyft.com',
  'gbfs.bluebikes.com',
  'gbfs.bcycle.com',
  'gbfs.biketownpdx.com',
  'gbfs.cogobikeshare.com',
  'austin.publicbikesystem.net',
  'hon.publicbikesystem.net',
  'chat.publicbikesystem.net',
]);

/** @type {Map<string, ReturnType<typeof createTtlCache>>} one cache per feed URL */
const caches = new Map();

function feedCache(key) {
  let cache = caches.get(key);
  if (!cache) {
    if (caches.size >= MAX_CACHE_ENTRIES) {
      const oldest = caches.keys().next().value;
      if (oldest !== undefined) caches.delete(oldest);
    }
    cache = createTtlCache(INFORMATION_TTL_MS);
    caches.set(key, cache);
  }
  return cache;
}

function isAllowedHost(hostname) {
  const host = String(hostname || '').trim().toLowerCase();
  if (!host) return false;
  return ALLOWED_HOSTS.has(host) || host.endsWith('.publicbikesystem.net');
}

function isAllowedPath(pathname) {
  return /\/station_(information|status)\.json$/i.test(String(pathname || ''));
}

function cacheControl(pathname) {
  return /\/station_information\.json$/i.test(String(pathname || ''))
    ? 'public, max-age=300'
    : 'no-store';
}

const sendError = (res, status, message) => {
  if (res.headersSent) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ error: message }));
};

/**
 * Rebuild the upstream URL from whatever the platform handed this route.
 * `req.params.slug` is decoded by some runtimes and still percent-encoded by
 * others, so both forms are tried before the raw request path.
 */
function targetFrom(req) {
  const raw = Array.isArray(req.params?.slug) ? req.params.slug.join('/') : String(req.params?.slug ?? '');
  const pathFromUrl = String(req.url || '').split('?')[0].replace(/^\/+/, '').replace(/^api\/gbfs\/?/, '');
  const candidates = [raw, decodeSafe(raw), pathFromUrl, decodeSafe(pathFromUrl)];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      return { url: new URL(candidate) };
    } catch {
      // try the next spelling
    }
  }
  return null;
}

function decodeSafe(value) {
  try {
    return decodeURIComponent(String(value || ''));
  } catch {
    return '';
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    sendError(res, 405, 'Method Not Allowed');
    return;
  }

  const parsed = targetFrom(req);
  if (!parsed) {
    sendError(res, 400, 'Invalid GBFS upstream URL');
    return;
  }
  const target = parsed.url;

  if (target.protocol !== 'https:') {
    sendError(res, 400, 'Only https GBFS targets are allowed');
    return;
  }
  if (target.username || target.password || target.port || target.hash) {
    sendError(res, 400, 'GBFS target must be a plain feed URL');
    return;
  }
  if (!isAllowedHost(target.hostname)) {
    sendError(res, 403, 'GBFS host not allowed');
    return;
  }
  if (!isAllowedPath(target.pathname)) {
    sendError(res, 400, 'Only station_information/station_status endpoints are allowed');
    return;
  }

  const isStatus = /\/station_status\.json$/i.test(target.pathname);

  async function fetchFeed() {
    const upstream = await fetch(target.toString(), {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'pii-global-view/1.0',
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (upstream.status >= 300 && upstream.status < 400) {
      await upstream.body?.cancel?.().catch(() => {});
      throw new Error('GBFS redirect refused');
    }
    const declared = Number(upstream.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw new Error('GBFS response too large');
    const body = await upstream.text();
    if (Buffer.byteLength(body, 'utf8') > MAX_RESPONSE_BYTES) throw new Error('GBFS response too large');
    if (!upstream.ok) throw new Error(`GBFS upstream HTTP ${upstream.status}`);
    return body;
  }

  try {
    if (isStatus) {
      // Real-time availability must never be replayed from a warm instance.
      const body = await fetchFeed();
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': cacheControl(target.pathname),
        'X-GBFS-Upstream': target.hostname,
        'X-GBFS-Cache': 'MISS',
      });
      res.end(body);
      return;
    }
    const { value, state } = await feedCache(target.toString()).get(fetchFeed);
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cacheControl(target.pathname),
      'X-GBFS-Upstream': target.hostname,
      'X-GBFS-Cache': state.toUpperCase(),
    });
    res.end(value);
  } catch (error) {
    console.warn(`[gbfs] ${target.hostname} unavailable:`, error?.message || error);
    sendError(res, 502, 'GBFS upstream unavailable');
  }
}

/** Some bike-share origins answer slowly on a cold cache. */
export const maxDuration = 15;
