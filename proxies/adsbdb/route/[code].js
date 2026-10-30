/**
 * adsbdb callsign → scheduled route enrichment.
 *
 * The client reads `{ found, airline, origin, destination }` (the shape the dev
 * proxy builds), so the upstream `response.flightroute` object is narrowed here
 * and a miss answers `found: false` — enrichment is fail-silent by contract.
 * Only v0 is called: v3 redirects to the adsbdb marketing site.
 */
import { createTtlCache } from '../../../lib/proxy.js';
import { fetchAdsbdb } from '../../../lib/adsbdb.js';

const TTL_MS = 24 * 3600_000;
const MAX_KEYS = 64;

const caches = new Map();

function cacheFor(key) {
  let cache = caches.get(key);
  if (!cache) {
    if (caches.size >= MAX_KEYS) caches.delete(caches.keys().next().value);
    cache = createTtlCache(TTL_MS);
    caches.set(key, cache);
  }
  return cache;
}

function airport(a = {}) {
  return {
    code: a.iata_code || a.icao_code || '',
    name: a.municipality || a.name || '',
    lat: Number.isFinite(a.latitude) ? a.latitude : null,
    lon: Number.isFinite(a.longitude) ? a.longitude : null,
  };
}

function parseRoute(json) {
  const flightRoute = json?.response?.flightroute || json?.flightroute || null;
  if (!flightRoute?.origin || !flightRoute?.destination) return null;
  return {
    airline: flightRoute.airline?.name || null,
    origin: airport(flightRoute.origin),
    destination: airport(flightRoute.destination),
  };
}

async function fetchRoute(callsign) {
  return fetchAdsbdb([`https://api.adsbdb.com/v0/callsign/${encodeURIComponent(callsign)}`], parseRoute);
}

export default async function handler(req, res) {
  const pathname = new URL(req.url || '/', 'http://localhost').pathname;
  const segment = String(req.query?.code || pathname.split('/').filter(Boolean).pop() || '').trim();
  const callsign = segment.toUpperCase();

  const send = (status, body, cacheState = 'miss') => {
    if (res.headersSent) return;
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': status === 200 ? 'public, max-age=3600' : 'no-store',
      'X-PII-Cache': cacheState,
    });
    res.end(JSON.stringify(body));
  };

  if (!/^[A-Z0-9]{2,8}$/.test(callsign)) {
    send(400, { error: 'invalid callsign' });
    return;
  }

  try {
    const { value, state } = await cacheFor(callsign).get(() => fetchRoute(callsign));
    send(200, value ? { found: true, ...value } : { found: false }, state);
  } catch (error) {
    console.warn(`[adsbdb/route] ${callsign} unavailable:`, error?.message || error);
    send(502, { error: 'Rute pesawat sedang tidak tersedia.' });
  }
}
