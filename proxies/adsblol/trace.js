/**
 * adsb.lol trace backfill for the military layer's trail.
 *
 * The client only consumes `{ timestamp, trace: [[offset, lat, lon, alt, …]] }`,
 * so an upstream answer that is not that shape (api.adsb.lol replies 400 for
 * aircraft with no stored trace) falls through to the tar1090 readsb file the
 * dev proxy uses, and a total miss answers as an empty trail rather than an
 * error the globe would render.
 */
import { createTtlCache } from '../../lib/proxy.js';

const TTL_MS = 60_000;
const MAX_KEYS = 16;
const USER_AGENT = 'pii-global-view/1.0';

const caches = new Map();

/** createTtlCache holds one slot, so each hex gets its own instance. */
function cacheFor(key) {
  let cache = caches.get(key);
  if (!cache) {
    if (caches.size >= MAX_KEYS) caches.delete(caches.keys().next().value);
    cache = createTtlCache(TTL_MS);
    caches.set(key, cache);
  }
  return cache;
}

async function readTrace(url) {
  const upstream = await fetch(url, {
    signal: AbortSignal.timeout(12_000),
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
  });
  const body = await upstream.text();
  if (!upstream.ok) return null;
  try {
    const parsed = JSON.parse(body);
    return Array.isArray(parsed?.trace) ? JSON.stringify(parsed) : null;
  } catch {
    return null;
  }
}

async function fetchTrace(hex) {
  const lastTwo = hex.slice(-2);
  const urls = [
    `https://api.adsb.lol/v2/trace/${hex}`,
    `https://adsb.lol/data/traces/${lastTwo}/trace_full_${hex}.json`,
  ];
  for (const url of urls) {
    try {
      const body = await readTrace(url);
      if (body) return { status: 200, body };
    } catch {
      // try the next source
    }
  }
  return { status: 200, body: JSON.stringify({ hex, trace: [] }) };
}

export default async function handler(req, res) {
  const params = new URL(req.url || '/', 'http://localhost').searchParams;
  const raw = String(params.get('hex') || params.get('icao') || params.get('icao24') || '').trim().toLowerCase();

  if (!/^[0-9a-f~]{6,7}$/.test(raw)) {
    if (res.headersSent) return;
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ error: 'hex must be a 6-7 char hex string' }));
    return;
  }

  try {
    const { value, state } = await cacheFor(raw).get(() => fetchTrace(raw));
    if (res.headersSent) return;
    res.writeHead(value.status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-PII-Cache': state,
      'X-ADS-B-Cache': state.toUpperCase(),
    });
    res.end(value.body);
  } catch (error) {
    console.warn(`[adsblol/trace] ${raw} unavailable:`, error?.message || error);
    if (res.headersSent) return;
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ error: 'Jejak pesawat sedang tidak tersedia.' }));
  }
}
