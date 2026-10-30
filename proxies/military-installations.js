/**
 * Bounded OpenStreetMap "military installation context" proxy.
 *
 * The globe asks for the features inside its current view rectangle and shows
 * them as UNREVIEWED mapped context — never an assertion about what a site is
 * used for. Upstream is Overpass, tried mirror by mirror because the public
 * instances rate-limit or refuse a single IP.
 *
 * Client contract (`/api/military-installations?south=&west=&north=&east=`):
 * `{elements, saturated, elementCap, retrievedAt, status}`. `saturated` is the
 * honest "Overpass truncated us" flag — a client that hits it re-asks with
 * `exact=1` for its real viewport, so features just outside the snapped tile
 * can never starve the ones on screen.
 *
 * Abuse guards: the bbox must be finite, in range, non-crossing, at most 10°
 * per side, and the element count is hard-capped. Cache keys snap outward onto
 * a 0.05° grid (~5.5 km) so neighbouring viewports share one entry — and
 * because the snap only ever GROWS the box, a cached answer always covers what
 * was asked for.
 */
import { createTtlCache } from '../lib/proxy.js';

/** Upstream element cap: a response that hits it exactly is SATURATED. */
const ELEMENT_CAP = 700;
const CACHE_TTL_MS = 5 * 60_000;
const UPSTREAM_TIMEOUT_MS = 20_000;
/** Keeps one viewport query from buffering an unbounded body into the lambda. */
const MAX_RESPONSE_BYTES = 6 * 1024 * 1024;
/** Distinct bbox entries kept per warm instance. */
const MAX_CACHE_ENTRIES = 80;
/** Cache-key grid step in degrees (~5.5 km). */
const BBOX_STEP_DEG = 0.05;

const MIRRORS = Object.freeze([
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
]);

/** @type {Map<string, ReturnType<typeof createTtlCache>>} one TTL cache per bbox */
const caches = new Map();

function boxCache(key) {
  let cache = caches.get(key);
  if (!cache) {
    if (caches.size >= MAX_CACHE_ENTRIES) {
      const oldest = caches.keys().next().value;
      if (oldest !== undefined) caches.delete(oldest);
    }
    cache = createTtlCache(CACHE_TTL_MS);
    caches.set(key, cache);
  }
  return cache;
}

function requiredFinite(params, name) {
  const raw = params.get(name);
  if (raw === null || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/** Validate the client rectangle, or null when it is unusable. */
function validBox(params) {
  const south = requiredFinite(params, 'south');
  const west = requiredFinite(params, 'west');
  const north = requiredFinite(params, 'north');
  const east = requiredFinite(params, 'east');
  if (![south, west, north, east].every(Number.isFinite)) return null;
  if (south < -90 || north > 90 || west < -180 || east > 180 || south >= north || west >= east) return null;
  if (north - south > 10 || east - west > 10) return null;
  return { south, west, north, east };
}

/** Snap a box OUTWARD onto the shared cache grid so views can share entries. */
function quantizeBox(box, stepDeg = BBOX_STEP_DEG) {
  // Round the ratio first: 29.9999/0.05 lands a hair under an exact grid line
  // in binary floating point, which would otherwise snap a whole cell too far.
  const snap = (value, grow) => {
    const cells = Number((value / stepDeg).toFixed(9));
    return Number(((grow > 0 ? Math.ceil(cells) : Math.floor(cells)) * stepDeg).toFixed(6));
  };
  return {
    south: Math.max(-90, snap(box.south, -1)),
    west: Math.max(-180, snap(box.west, -1)),
    north: Math.min(90, snap(box.north, 1)),
    east: Math.min(180, snap(box.east, 1)),
  };
}

/**
 * Cache key at the precision the query actually uses. Snapped boxes live on a
 * 0.05° grid so 3 decimals is exact; an `exact=1` request carries the raw
 * viewport at 5 decimals and must be keyed at 5, or two nearby exact viewports
 * would share one answer.
 */
function cacheKey(box, decimals = 3) {
  return [box.south, box.west, box.north, box.east].map((value) => value.toFixed(decimals)).join(',');
}

function looksRateLimited(text) {
  const body = String(text || '').toLowerCase();
  return body.includes('rate_limited')
    || body.includes('quota of your ip address')
    || body.includes('dispatcher_client::request_read_and_idx::rate_limited')
    || body.includes('too many requests');
}

/** An HTTP-200 body carrying a runtime error is a transient mirror failure. */
function looksLikeRuntimeError(text) {
  const body = String(text || '').toLowerCase();
  return body.includes('runtime error')
    || body.includes('timed out')
    || body.includes('out of memory');
}

/** POST one QL to the mirrors in order; returns parsed JSON or throws. */
async function queryOverpass(query) {
  const body = `data=${encodeURIComponent(query)}`;
  let lastError = null;
  for (const endpoint of MIRRORS) {
    try {
      const upstream = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'pii-global-view/1.0',
        },
        body,
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
      const text = await upstream.text();
      if (upstream.status === 429 || looksRateLimited(text)) {
        lastError = new Error(`rate limited by ${new URL(endpoint).hostname}`);
        continue;
      }
      if (looksLikeRuntimeError(text)) {
        lastError = new Error(`runtime error on ${new URL(endpoint).hostname}`);
        continue;
      }
      if (!upstream.ok) {
        lastError = new Error(`HTTP ${upstream.status} from ${new URL(endpoint).hostname}`);
        continue;
      }
      if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
        throw new Error('overpass response too large');
      }
      const parsed = JSON.parse(text);
      if (parsed?.error) throw new Error('overpass returned an error payload');
      return parsed;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('all Overpass mirrors failed');
}

async function refresh(box) {
  const bbox = `${box.south},${box.west},${box.north},${box.east}`;
  const query = `[out:json][timeout:20];`
    + `(nwr["military"~"^(airfield|naval_base|range|barracks|base)$"](${bbox});`
    + `nwr["landuse"="military"](${bbox}););`
    + `out center tags geom ${ELEMENT_CAP};`;
  const parsed = await queryOverpass(query);
  const elements = Array.isArray(parsed?.elements) ? parsed.elements.slice(0, ELEMENT_CAP) : [];
  return {
    elements,
    saturated: elements.length >= ELEMENT_CAP,
    elementCap: ELEMENT_CAP,
    retrievedAt: new Date().toISOString(),
    status: 'ready',
  };
}

const send = (res, status, body, cacheState) => {
  if (res.headersSent) return;
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': status === 200 ? 'public, max-age=60' : 'no-store',
    'X-Military-Installations': cacheState,
  });
  res.end(JSON.stringify(body));
};

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8', Allow: 'GET', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ error: 'Method Not Allowed' }));
    return;
  }

  const params = new URL(req.url || '/', 'http://localhost').searchParams;
  const requested = validBox(params);
  if (!requested) {
    send(res, 400, { error: 'A non-dateline bbox no larger than 10 degrees is required' }, 'NONE');
    return;
  }

  const exact = params.get('exact') === '1';
  const box = exact ? requested : quantizeBox(requested);
  const key = exact ? `exact:${cacheKey(box, 5)}` : cacheKey(box);

  try {
    const { value, state } = await boxCache(key).get(() => refresh(box));
    send(res, 200, { ...value, status: state === 'hit' ? 'cached' : value.status }, state.toUpperCase());
  } catch (error) {
    console.warn('[military-installations] unavailable:', error?.message || error);
    send(res, 503, { error: 'Mapped installation context is temporarily unavailable' }, 'NONE');
  }
}

/** Overpass mirrors answer slowly when they answer at all. */
export const maxDuration = 30;
