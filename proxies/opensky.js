/**
 * OpenSky proxy for the aircraft layer: live state vectors plus trail backfill.
 *
 * `/api/opensky` answers with the upstream snapshot the client expects
 * (`{ time, states: [...] }`); a single lat/lon from the camera cannot narrow
 * OpenSky, so it keeps the worldwide frame the globe filters locally, and only
 * a real bbox narrows the query. `/api/opensky-track` (rewritten here) returns
 * `{ path: [...] }` waypoints for one icao24.
 *
 * Anonymous by default; OPENSKY_* credentials only widen the daily budget.
 */
import { createTtlCache, envValue } from '../lib/proxy.js';

const STATES_URL = 'https://opensky-network.org/api/states/all';
const TRACKS_URL = 'https://opensky-network.org/api/tracks/all';
const TOKEN_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';
const SNAPSHOT_TTL_MS = 12_000;
const TRACK_TTL_MS = 60_000;
const TIMEOUT_MS = 20_000;
const MAX_TRACK_WINDOW_S = 7 * 24 * 3600;
const MAX_KEYS = 8;

const snapshotCaches = new Map();
const trackCaches = new Map();

/** createTtlCache holds one slot, so each distinct client query gets its own instance. */
function cacheFor(caches, key, ttlMs) {
  let cache = caches.get(key);
  if (!cache) {
    if (caches.size >= MAX_KEYS) caches.delete(caches.keys().next().value);
    cache = createTtlCache(ttlMs);
    caches.set(key, cache);
  }
  return cache;
}

let token = '';
let tokenExpiryMs = 0;
let tokenPending = null;

async function fetchToken() {
  const clientId = envValue('OPENSKY_CLIENT_ID');
  const clientSecret = envValue('OPENSKY_CLIENT_SECRET');
  if (!clientId || !clientSecret) return '';
  if (token && Date.now() < tokenExpiryMs - 60_000) return token;
  if (tokenPending) return tokenPending;

  tokenPending = (async () => {
    try {
      const response = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=client_credentials&client_id=${encodeURIComponent(clientId)}`
          + `&client_secret=${encodeURIComponent(clientSecret)}`,
        signal: AbortSignal.timeout(10_000),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.access_token) {
        console.warn('[opensky] OAuth client_credentials rejected:', payload?.error || `HTTP ${response.status}`);
        token = '';
        tokenExpiryMs = 0;
        return '';
      }
      token = String(payload.access_token);
      const expiresIn = Number(payload.expires_in);
      tokenExpiryMs = Date.now() + (Number.isFinite(expiresIn) ? expiresIn : 1800) * 1000;
      return token;
    } catch (error) {
      console.warn('[opensky] OAuth token request failed:', error?.message || error);
      token = '';
      tokenExpiryMs = 0;
      return '';
    } finally {
      tokenPending = null;
    }
  })();
  return tokenPending;
}

async function credentials() {
  const bearer = await fetchToken();
  if (bearer) return { authorization: `Bearer ${bearer}`, mode: 'oauth' };

  const username = envValue('OPENSKY_USERNAME');
  const password = envValue('OPENSKY_PASSWORD');
  if (username && password) {
    return {
      authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
      mode: 'basic',
    };
  }
  return { authorization: '', mode: 'anon' };
}

/** OpenSky bbox order is minalt,maxalt,minlon,maxlon,minlat,maxlat. */
function readBbox(params) {
  const explicit = String(params.get('bbox') || '').trim();
  if (explicit) {
    const values = explicit.split(',').map(Number);
    if (values.length !== 6 || values.some((v) => !Number.isFinite(v))) return null;
    const [minAlt, maxAlt, minLon, maxLon, minLat, maxLat] = values;
    return bboxParam({ minAlt, maxAlt, minLon, maxLon, minLat, maxLat });
  }
  const number = (name) => {
    const raw = String(params.get(name) || '').trim();
    return raw === '' || !/^-?\d+(?:\.\d+)?$/.test(raw) ? null : Number(raw);
  };
  const minLon = number('minlon');
  const maxLon = number('maxlon');
  const minLat = number('minlat');
  const maxLat = number('maxlat');
  if ([minLon, maxLon, minLat, maxLat].some((v) => v === null)) return null;
  return bboxParam({
    minAlt: number('minalt') ?? 0,
    maxAlt: number('maxalt') ?? 20000,
    minLon,
    maxLon,
    minLat,
    maxLat,
  });
}

function bboxParam({ minAlt, maxAlt, minLon, maxLon, minLat, maxLat }) {
  if (!(maxLon > minLon) || !(maxLat > minLat)) return null;
  if (Math.abs(minLon) > 180 || Math.abs(maxLon) > 180) return null;
  if (Math.abs(minLat) > 90 || Math.abs(maxLat) > 90) return null;
  if (maxLon - minLon > 180 || maxLat - minLat > 90) return null;
  if (!Number.isFinite(minAlt) || !Number.isFinite(maxAlt) || maxAlt < minAlt) return null;
  return [minAlt, maxAlt, minLon, maxLon, minLat, maxLat].join(',');
}

/** Epoch-seconds query bound, or null unless it is a plausible OpenSky timestamp. */
function readEpoch(params, names) {
  for (const name of names) {
    const raw = String(params.get(name) || '').trim();
    if (/^\d{10}$/.test(raw)) return Number(raw);
  }
  return null;
}

async function fetchUpstream(url, auth) {
  const headers = { Accept: 'application/json' };
  if (auth.authorization) headers.Authorization = auth.authorization;
  let response = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  // A rejected key must not kill the layer: fall back to the anonymous budget.
  if ((response.status === 401 || response.status === 403) && auth.authorization) {
    response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  }
  const body = await response.text();
  return { status: response.status, body, headers: response.headers };
}

function respond(res, status, body, cacheState, authMode, extraHeaders = {}) {
  if (res.headersSent) return;
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-PII-Cache': cacheState,
    'X-OpenSky-Cache': cacheState,
    'X-OpenSky-Auth': authMode,
    ...extraHeaders,
  });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

/** Waypoints in the shape the client parses: [time, lat, lon, baro_alt, true_track, on_ground]. */
function statesToPath(body) {
  let states = null;
  try {
    states = JSON.parse(body)?.states;
  } catch {
    states = null;
  }
  const path = [];
  for (const row of Array.isArray(states) ? states : []) {
    const time = Number(row?.[3] ?? row?.[4]);
    const lon = Number(row?.[5]);
    const lat = Number(row?.[6]);
    if (!Number.isFinite(time) || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    path.push([time, lat, lon, row?.[7] ?? null, row?.[10] ?? null, row?.[8] === true ? 1 : 0]);
  }
  path.sort((a, b) => a[0] - b[0]);
  return path;
}

async function serveSnapshot(res, params, auth) {
  const bbox = readBbox(params);
  const url = new URL(STATES_URL);
  url.searchParams.set('extended', '1');
  if (bbox) url.searchParams.set('bbox', bbox);
  const key = bbox || 'global';

  const { value, state } = await cacheFor(snapshotCaches, key, SNAPSHOT_TTL_MS).get(async () => {
    const upstream = await fetchUpstream(url, auth);
    if (upstream.status === 429) {
      const error = new Error('HTTP 429');
      error.rateLimited = true;
      error.retryAfter = upstream.headers.get('retry-after');
      throw error;
    }
    if (upstream.status < 200 || upstream.status >= 300) throw new Error(`HTTP ${upstream.status}`);
    let parsed = null;
    try {
      parsed = JSON.parse(upstream.body);
    } catch {
      throw new Error('malformed snapshot');
    }
    if (!Array.isArray(parsed?.states)) throw new Error('snapshot has no states array');
    return { status: upstream.status, body: upstream.body };
  });
  respond(res, value.status, value.body, state, auth.mode);
}

async function serveTrack(res, icao24, params, auth) {
  const begin = readEpoch(params, ['begin', 'start']);
  const end = readEpoch(params, ['end', 'stop']);
  const windowed = begin !== null && end !== null && end > begin && end - begin <= MAX_TRACK_WINDOW_S;

  const url = new URL(windowed ? STATES_URL : TRACKS_URL);
  url.searchParams.set('icao24', icao24);
  if (windowed) {
    url.searchParams.set('start', String(begin));
    url.searchParams.set('end', String(end));
  } else {
    url.searchParams.set('time', '0');
  }

  const { value, state } = await cacheFor(trackCaches, `${icao24}:${windowed ? `${begin}-${end}` : 'latest'}`, TRACK_TTL_MS)
    .get(async () => {
      const upstream = await fetchUpstream(url, auth);
      if (upstream.status === 404) return { status: 200, body: JSON.stringify({ icao24, path: [] }) };
      if (upstream.status < 200 || upstream.status >= 300) throw new Error(`HTTP ${upstream.status}`);
      if (!windowed) return { status: upstream.status, body: upstream.body };
      return { status: upstream.status, body: JSON.stringify({ icao24, path: statesToPath(upstream.body) }) };
    });
  respond(res, value.status, value.body, state, auth.mode);
}

export default async function handler(req, res) {
  const requestUrl = new URL(req.url || '/', 'http://localhost');
  const params = requestUrl.searchParams;
  for (const [name, value] of Object.entries(req.query || {})) {
    if (!params.has(name)) params.set(name, String(value));
  }
  const isTrack = /opensky-track\b/.test(requestUrl.pathname) || params.has('icao24');
  const auth = await credentials();

  try {
    if (isTrack) {
      const icao24 = String(params.get('icao24') || '').trim().toLowerCase();
      if (!/^[0-9a-f]{6}$/.test(icao24)) {
        respond(res, 400, { error: 'icao24 must be a 6-char hex string' }, 'miss', auth.mode);
        return;
      }
      await serveTrack(res, icao24, params, auth);
      return;
    }
    await serveSnapshot(res, params, auth);
  } catch (error) {
    const label = isTrack ? `${params.get('icao24')} track` : 'snapshot';
    console.warn(`[opensky] ${label} unavailable:`, error?.message || error);
    const headers = error?.rateLimited ? { 'Retry-After': String(error.retryAfter || 120) } : {};
    respond(res, 502, { error: 'OpenSky sementara tidak tersedia.' }, 'miss', auth.mode, headers);
  }
}
