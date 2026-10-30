/**
 * Point ellipsoid-height lookup for the terrain floor clamp.
 *
 * Ported from the dev proxy's `terrainHeightsProxy`: the Re:Earth upstream
 * caps 256 points per call and answers `{ results: [{ lon, lat, elevation,
 * geoid, ellipsoid }] }` in request order, which is exactly the shape the
 * client requires, so heights are cached per canonical 5dp point and the body
 * is rebuilt positionally. A point with no real height answers 502 rather than
 * being padded with a fabricated 0.
 */
import { createTtlCache } from '../../lib/proxy.js';

const UPSTREAM = 'https://terrain.reearth.land/heights.json';
const PRECISION = 5;
const UPSTREAM_CHUNK = 256;
const MAX_POINTS = 2000;
const POINT_TTL_MS = 30 * 24 * 3600_000;
const ATTEMPT_TIMEOUT_MS = 9000;

/** @type {Map<string, {at:number, result:object}>} */
const points = new Map();
const batchCaches = new Map();
const BATCH_TTL_MS = 60_000;
const MAX_BATCH_KEYS = 8;

/** createTtlCache holds one slot, so each distinct batch gets its own instance. */
function batchCacheFor(key) {
  let cache = batchCaches.get(key);
  if (!cache) {
    if (batchCaches.size >= MAX_BATCH_KEYS) batchCaches.delete(batchCaches.keys().next().value);
    cache = createTtlCache(BATCH_TTL_MS);
    batchCaches.set(key, cache);
  }
  return cache;
}

function pointKey([lon, lat]) {
  return `${lon.toFixed(PRECISION)},${lat.toFixed(PRECISION)}`;
}

function validResult(result) {
  return Boolean(result) && Number.isFinite(result.ellipsoid);
}

/** Parses the `points=lon,lat;lon,lat;…` parameter, or null when malformed. */
function parsePointsParam(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  const pairs = text.split(';').map((part) => part.trim()).filter(Boolean);
  if (!pairs.length || pairs.length > MAX_POINTS) return null;
  const parsed = [];
  for (const pair of pairs) {
    const parts = pair.split(',');
    if (parts.length !== 2) return null;
    const lon = Number(parts[0]);
    const lat = Number(parts[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    if (Math.abs(lon) > 180 || Math.abs(lat) > 90) return null;
    parsed.push([lon, lat]);
  }
  return parsed;
}

async function fetchChunk(chunk) {
  const encoded = encodeURIComponent(chunk.map(pointKey).join(';'));
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const upstream = await fetch(`${UPSTREAM}?points=${encoded}`, {
        signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
        headers: { Accept: 'application/json', 'User-Agent': 'pii-global-view/1.0' },
      });
      if (!upstream.ok) throw new Error(`HTTP ${upstream.status}`);
      const parsed = await upstream.json();
      if (!Array.isArray(parsed?.results)) throw new Error('malformed response (no results array)');
      return parsed.results;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

/** Fetches only the stale points, writes them into the per-point cache. */
async function resolveBatch(requested) {
  const now = Date.now();
  const missing = [];
  const seen = new Set();
  for (const item of requested) {
    const entry = points.get(item.key);
    const warm = entry && validResult(entry.result) && now - entry.at < POINT_TTL_MS;
    if (warm || seen.has(item.key)) continue;
    seen.add(item.key);
    missing.push(item);
  }

  let upstreamError = null;
  for (let i = 0; i < missing.length; i += UPSTREAM_CHUNK) {
    const chunk = missing.slice(i, i + UPSTREAM_CHUNK);
    try {
      const fetched = await fetchChunk(chunk.map((item) => item.point));
      const fetchedAt = Date.now();
      for (let j = 0; j < chunk.length; j += 1) {
        if (validResult(fetched[j])) points.set(chunk[j].key, { at: fetchedAt, result: fetched[j] });
      }
      if (fetched.length !== chunk.length || chunk.some((_, j) => !validResult(fetched[j]))) {
        upstreamError = upstreamError || new Error('upstream omitted one or more terrain heights');
      }
    } catch (error) {
      upstreamError = error;
    }
  }

  const results = requested.map(({ key }) => {
    const entry = points.get(key);
    return entry && validResult(entry.result) ? entry.result : null;
  });
  return { results, upstreamError };
}

async function readBody(req) {
  if (typeof req.body === 'string') return req.body;
  if (req.body && typeof req.body === 'object') {
    return String(req.body.points ?? req.body.data ?? '');
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function pointsParameter(req) {
  const url = new URL(req.url || '/', 'http://localhost');
  const fromQuery = url.searchParams.get('points');
  if (fromQuery) return fromQuery;
  if (req.method !== 'POST' && req.method !== 'PUT') return null;
  const body = await readBody(req);
  if (!body) return null;
  const fromForm = new URLSearchParams(body).get('points');
  if (fromForm) return fromForm;
  try {
    const parsed = JSON.parse(body);
    return typeof parsed?.points === 'string' ? parsed.points : null;
  } catch {
    return body;
  }
}

export default async function handler(req, res) {
  const send = (status, body, cacheState = 'miss') => {
    if (res.headersSent) return;
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': status === 200 ? 'public, max-age=86400' : 'no-store',
      'X-PII-Cache': cacheState,
    });
    res.end(JSON.stringify(body));
  };

  try {
    const parsed = parsePointsParam(await pointsParameter(req));
    if (!parsed) {
      send(400, { error: 'invalid points parameter — expected "lon,lat;lon,lat;…" with finite numbers' });
      return;
    }

    const requested = parsed.map((point) => ({ key: pointKey(point), point }));
    const { value, state } = await batchCacheFor(requested.map((item) => item.key).join(';'))
      .get(() => resolveBatch(requested));
    if (value.upstreamError) {
      console.warn('[terrain/heights] refresh incomplete:', value.upstreamError?.message || value.upstreamError);
    }
    if (value.results.some((result) => result === null)) {
      send(502, { error: 'terrain heights fetch failed and no cache available for every point' }, state);
      return;
    }
    send(200, { results: value.results }, state);
  } catch (error) {
    console.warn('[terrain/heights] unavailable:', error?.message || error);
    send(502, { error: 'Ketinggian terrain sedang tidak tersedia.' });
  }
}
