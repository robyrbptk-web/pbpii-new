/**
 * Tile math + daily-budget accounting for the TomTom traffic-flow proxy.
 *
 * Ported from the globe's `src/data/tomtomTiles.js` (gods-eye-view), because a
 * Vercel function can only import files that live inside this project. Pure and
 * dependency-free, so `api/tomtom/status.js` and `api/tomtom/flow/[z]/[x]/[y].js`
 * share one copy.
 *
 * Slippy scheme: standard Web Mercator XYZ, y grows southward
 * (https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames) — the scheme
 * TomTom's `traffic/map/4/tile/flow` endpoints use.
 */

/** Min supported TomTom flow-tile zoom (proxy validation). */
export const MIN_TILE_ZOOM = 8;
/** Max supported TomTom flow-tile zoom (proxy validation). */
export const MAX_TILE_ZOOM = 16;

/**
 * Validate a z/x/y tile coordinate for the TomTom flow proxy.
 *
 * @param {number} z - Zoom level; integer within [MIN_TILE_ZOOM, MAX_TILE_ZOOM].
 * @param {number} x - Tile column; integer within [0, 2^z - 1].
 * @param {number} y - Tile row; integer within [0, 2^z - 1].
 * @returns {boolean} True when the coordinate is a fetchable tile.
 */
export function isValidTileCoord(z, x, y) {
  if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y)) return false;
  if (z < MIN_TILE_ZOOM || z > MAX_TILE_ZOOM) return false;
  const n = 2 ** z;
  return x >= 0 && x < n && y >= 0 && y < n;
}

/**
 * UTC calendar-day key for budget bucketing.
 *
 * @param {number} [epochMs=Date.now()] - Timestamp in ms.
 * @returns {string} 'YYYY-MM-DD' in UTC.
 */
export function utcDayKey(epochMs = Date.now()) {
  return new Date(epochMs).toISOString().slice(0, 10);
}

/**
 * Normalize a budget state against today's UTC day key. Rolls the counter to
 * zero on day change; replaces missing/corrupt state. Returns the SAME object
 * when it is already valid for `dayKey`, so the caller can keep one instance.
 *
 * @param {{date:string, count:number}|null|undefined} state - Persisted state.
 * @param {string} dayKey - Today's UTC day key (from `utcDayKey`).
 * @returns {{date:string, count:number}} Valid state for `dayKey`.
 */
export function normalizeBudget(state, dayKey) {
  const valid = Boolean(state)
    && state.date === dayKey
    && Number.isFinite(state.count)
    && state.count >= 0;
  return valid ? state : { date: dayKey, count: 0 };
}

/**
 * Whether the daily soft cap has been reached.
 *
 * @param {{count:number}} state - Normalized budget state.
 * @param {number} limit - Daily tile budget; non-positive/invalid never blocks.
 * @returns {boolean} True when `count >= limit`.
 */
export function isOverBudget(state, limit) {
  if (!Number.isFinite(limit) || limit <= 0) return false;
  return state.count >= limit;
}

/** Free-tier daily tile ceiling used when TOMTOM_DAILY_TILE_BUDGET is unset. */
const DEFAULT_DAILY_BUDGET = 40000;

/**
 * Soft daily cap on upstream tile fetches (cache hits never count). Reads
 * TOMTOM_DAILY_TILE_BUDGET and falls back to the default when it is missing or
 * not a positive integer — a bad env value must never disable the governor.
 *
 * @returns {number} Tiles per UTC day.
 */
export function dailyBudgetLimit() {
  const raw = Number.parseInt(process.env.TOMTOM_DAILY_TILE_BUDGET || '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_DAILY_BUDGET;
}

/**
 * Parse a `z/x/y` tile reference the proxy received from the globe.
 *
 * The client asks for `/api/tomtom/flow/{z}/{x}/{y}.pbf`, so the last segment
 * still carries the `.pbf` suffix on Vercel. Accepts the suffix (and a bare
 * number) and nothing else.
 *
 * @param {string|number} zRaw - Zoom segment.
 * @param {string|number} xRaw - Column segment.
 * @param {string|number} yRaw - Row segment, optionally ending in `.pbf`.
 * @returns {?{z:number, x:number, y:number}} Validated coordinate, or null.
 */
export function parseTileCoord(zRaw, xRaw, yRaw) {
  const digits = (value) => String(value ?? '').trim().replace(/\.pbf$/i, '');
  const z = Number(digits(zRaw));
  const x = Number(digits(xRaw));
  const y = Number(digits(yRaw));
  if (!/^\d+$/.test(digits(zRaw)) || !/^\d+$/.test(digits(xRaw)) || !/^\d+$/.test(digits(yRaw))) {
    return null;
  }
  return isValidTileCoord(z, x, y) ? { z, x, y } : null;
}
