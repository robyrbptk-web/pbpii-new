/**
 * Launch Library 2 recent-launch proxy for the rocket-mission layer.
 *
 * Upstream: https://ll.thespacedevs.com/2.3.0/launches/ with the trailing
 * 30-day window the client filters against — `net__gte`/`net__lte`,
 * `limit=100`, `mode=detailed`. The endpoint is keyless public; the optional
 * `LL2_API_TOKEN` (Launch Library 2 membership) is added server-side only and
 * never reaches the browser.
 *
 * The body is passed through verbatim because the client reads the raw LL2
 * record shape (`results[]` with `pad`, `mission`, `timeline`, …) itself — this
 * proxy is a CORS shim plus a rate-limit buffer, not a translator.
 */
import { createTtlCache } from '../lib/proxy.js';

const TTL_MS = 15 * 60_000;
const UPSTREAM_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 6 * 1024 * 1024;
const WINDOW_DAYS = 30;

const cache = createTtlCache(TTL_MS);

function requestHeaders() {
  const token = String(process.env.LL2_API_TOKEN || '').trim();
  return {
    Accept: 'application/json',
    ...(token ? { Authorization: `Token ${token}` } : {}),
  };
}

async function fetchRecentLaunches() {
  const end = new Date();
  const start = new Date(end.getTime() - WINDOW_DAYS * 86400000);
  const url = new URL('https://ll.thespacedevs.com/2.3.0/launches/');
  url.searchParams.set('net__gte', start.toISOString());
  url.searchParams.set('net__lte', end.toISOString());
  url.searchParams.set('limit', '100');
  url.searchParams.set('mode', 'detailed');

  const upstream = await fetch(url, {
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    headers: requestHeaders(),
  });
  if (!upstream.ok) throw new Error(`upstream HTTP ${upstream.status}`);
  const declared = Number(upstream.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw new Error('response too large');
  const body = await upstream.text();
  if (Buffer.byteLength(body, 'utf8') > MAX_RESPONSE_BYTES) throw new Error('response too large');
  const parsed = JSON.parse(body);
  if (!Array.isArray(parsed?.results)) throw new Error('malformed upstream response');
  return body;
}

export default async function handler(req, res) {
  const send = (status, body, cacheState) => {
    if (res.headersSent) return;
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': status === 200 ? 'public, max-age=900' : 'no-store',
      'X-PII-Cache': cacheState,
    });
    res.end(body);
  };

  if (req.method !== 'GET') {
    send(405, JSON.stringify({ error: 'Method Not Allowed' }), 'NONE');
    return;
  }

  try {
    const { value, state } = await cache.get(fetchRecentLaunches);
    send(200, value, state);
  } catch (error) {
    console.warn('[launches] unavailable:', error?.message || error);
    send(502, JSON.stringify({ error: 'Launch Library 2 unavailable' }), 'miss');
  }
}

/** A cold LL2 `mode=detailed` page can outlive the default clock. */
export const maxDuration = 25;
