/**
 * adsbdb hex → aircraft type enrichment.
 *
 * The client reads `{ found, typeCode, typeName, registration }` (the dev
 * proxy's shape), built from the upstream `response.aircraft` record; an
 * unknown hex answers `found: false`. Only v0 is called: v3 redirects to the
 * adsbdb marketing site, so probing it would spend a request and never answer.
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

function parseAircraft(json) {
  const aircraft = json?.response?.aircraft || json?.aircraft || null;
  if (!aircraft) return null;
  return {
    typeCode: aircraft.icao_type || null,
    typeName: aircraft.manufacturer && aircraft.type
      ? `${aircraft.manufacturer} ${aircraft.type}`
      : (aircraft.type || null),
    registration: aircraft.registration || null,
  };
}

async function fetchType(hex) {
  return fetchAdsbdb([`https://api.adsbdb.com/v0/aircraft/${encodeURIComponent(hex)}`], parseAircraft);
}

export default async function handler(req, res) {
  const pathname = new URL(req.url || '/', 'http://localhost').pathname;
  const segment = String(req.query?.type || pathname.split('/').filter(Boolean).pop() || '').trim();
  const hex = segment.toLowerCase();

  const send = (status, body, cacheState = 'miss') => {
    if (res.headersSent) return;
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': status === 200 ? 'public, max-age=3600' : 'no-store',
      'X-PII-Cache': cacheState,
    });
    res.end(JSON.stringify(body));
  };

  if (!/^[0-9a-f]{6}$/.test(hex)) {
    send(400, { error: 'invalid hex' });
    return;
  }

  try {
    const { value, state } = await cacheFor(hex).get(() => fetchType(hex));
    send(200, value ? { found: true, ...value } : { found: false }, state);
  } catch (error) {
    console.warn(`[adsbdb/type] ${hex} unavailable:`, error?.message || error);
    send(502, { error: 'Tipe pesawat sedang tidak tersedia.' });
  }
}
