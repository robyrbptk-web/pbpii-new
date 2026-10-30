/**
 * TomTom live traffic-flow vector tile proxy.
 *
 * The globe fetches `/api/tomtom/flow/{z}/{x}/{y}.pbf`; the TomTom key stays
 * server-side in `TOMTOM_API_KEY`. Upstream is
 * `https://api.tomtom.com/traffic/map/4/tile/flow/relative/{z}/{x}/{y}.pbf`,
 * whose body is an UNCOMPRESSED Mapbox Vector Tile (layer "Traffic flow"). The
 * bytes pass through untouched — the client decodes the protobuf itself, so
 * wrapping them in JSON would kill the layer.
 *
 * A file named `[y].js` under `api/tomtom/flow/[z]/[x]/` keeps the client's
 * `.pbf` suffix out of the routing, so it arrives attached to the last segment
 * and `parseTileCoord` drops it.
 *
 * Cache: traffic is fresh data, so a 120 s in-instance TTL with
 * serve-stale-on-failure (last-good beats a dead layer) plus a soft daily cap
 * on upstream attempts, mirroring the dev proxy's budget governor. There is no
 * disk here — a warm instance simply pays one fetch per tile per TTL.
 */
import { createTtlCache } from '../../../../../lib/proxy.js';
import {
  dailyBudgetLimit,
  isOverBudget,
  normalizeBudget,
  parseTileCoord,
  utcDayKey,
} from '../../../../../lib/tomtomTiles.js';

const TILE_TTL_MS = 120_000;
const UPSTREAM_TIMEOUT_MS = 12_000;
const MAX_TILE_BYTES = 2 * 1024 * 1024;
/** Tiles cached per warm instance before the oldest entry is dropped. */
const MAX_CACHED_TILES = 256;

/** Lets the handler tell "cap reached" apart from "upstream broken". */
class BudgetReached extends Error {}

/** @type {Map<string, ReturnType<typeof createTtlCache>>} one TTL cache per tile */
const tiles = new Map();
let budget = null;

function tileCache(key) {
  let cache = tiles.get(key);
  if (!cache) {
    if (tiles.size >= MAX_CACHED_TILES) {
      const oldest = tiles.keys().next().value;
      if (oldest !== undefined) tiles.delete(oldest);
    }
    cache = createTtlCache(TILE_TTL_MS);
    tiles.set(key, cache);
  }
  return cache;
}

function currentBudget() {
  budget = normalizeBudget(budget, utcDayKey());
  return budget;
}

async function fetchTile(apiKey, z, x, y) {
  const state = currentBudget();
  if (isOverBudget(state, dailyBudgetLimit())) throw new BudgetReached('daily tile budget reached');
  // Attempts count even when they fail — TomTom bills the request either way.
  state.count += 1;

  const url = 'https://api.tomtom.com/traffic/map/4/tile/flow/relative/'
    + `${z}/${x}/${y}.pbf?key=${encodeURIComponent(apiKey)}`;
  const upstream = await fetch(url, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
  if (!upstream.ok) throw new Error(`HTTP ${upstream.status}`);
  const bytes = new Uint8Array(await upstream.arrayBuffer());
  if (bytes.byteLength === 0) throw new Error('empty tile body');
  if (bytes.byteLength > MAX_TILE_BYTES) throw new Error('tile body too large');
  // Buffer so `res.end` writes the exact protobuf bytes.
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

const sendJson = (res, status, error, cacheState) => {
  if (res.headersSent) return;
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'x-tomtom-cache': cacheState,
  });
  res.end(JSON.stringify({ ok: false, error }));
};

const sendTile = (res, bytes, cacheState) => {
  if (res.headersSent) return;
  res.writeHead(200, {
    'Content-Type': 'application/x-protobuf',
    // Same as the dev proxy: the tile TTL is short, so nothing is edge-cached.
    'Cache-Control': 'no-store',
    'x-tomtom-cache': cacheState,
  });
  res.end(bytes);
};

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, 'Method Not Allowed', 'NONE');
    return;
  }

  const query = req.query || {};
  const coord = parseTileCoord(query.z, query.x, query.y);
  if (!coord) {
    sendJson(res, 400, 'invalid_tile', 'NONE');
    return;
  }

  const apiKey = String(process.env.TOMTOM_API_KEY || '').trim();
  if (!apiKey) {
    // Never a 404 and never the key: a clean 501 the globe can show as text.
    sendJson(res, 501, 'TOMTOM_API_KEY is not configured', 'NONE');
    return;
  }

  const { z, x, y } = coord;
  try {
    const { value, state } = await tileCache(`${z}/${x}/${y}`).get(() => fetchTile(apiKey, z, x, y));
    sendTile(res, value, state === 'hit' ? 'HIT' : state.toUpperCase());
  } catch (error) {
    if (error instanceof BudgetReached) {
      console.warn(`[tomtom/flow] ${z}/${x}/${y} over the daily tile budget`);
      sendJson(res, 429, 'budget', 'NONE');
      return;
    }
    console.warn(`[tomtom/flow] ${z}/${x}/${y} unavailable:`, error?.message || error);
    sendJson(res, 502, 'upstream', 'NONE');
  }
}

/** One TomTom round trip must fit inside the function's own clock. */
export const maxDuration = 15;
