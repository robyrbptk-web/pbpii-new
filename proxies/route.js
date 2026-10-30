/**
 * OSM road-routing proxy for the globe's street-following route annotations
 * (flight/ship trace styling, "walk/driving route from A to B").
 *
 * Contract copied from the dev proxy (vite.config.js `/api/route`): on any
 * soft failure the client expects HTTP 200 with `{ ok: false, error }` — it
 * falls back to a straight line — and on success
 * `{ ok: true, profile, distanceM, durationS, geometry: [[lon, lat], ...] }`.
 * Upstream is the keyless public FOSSGIS OSRM mirror; nothing else is allowed.
 */
import { createTtlCache } from '../lib/proxy.js';

const CACHE_TTL_MS = 10 * 60_000;
const USER_AGENT = 'pii-global-view/1.0';
const ROUTE_MAX_LEG_KM = 600;
const ROUTE_MAX_TOTAL_KM = 2500;
/** Vercel caps a serverless response well below the dev proxy's 8 MB; stay under it. */
const ROUTE_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

const caches = new Map();
function cacheFor(key) {
  let cache = caches.get(key);
  if (!cache) {
    if (caches.size >= 200) caches.delete(caches.keys().next().value);
    cache = createTtlCache(CACHE_TTL_MS);
    caches.set(key, cache);
  }
  return cache;
}

/** The globe tolerates Google-flavoured and OSRM-flavoured mode words alike. */
function normalizeProfile(raw) {
  const value = String(raw || 'foot').toLowerCase();
  if (value === 'car' || value === 'driving' || value === 'drive') return 'car';
  if (value === 'bike' || value === 'cycling' || value === 'bicycle') return 'bike';
  if (value === 'foot' || value === 'walking' || value === 'walk') return 'foot';
  return null;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function fail(res, message) {
  if (res.headersSent) return;
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ ok: false, error: message }));
}

async function fetchRoute(profile, coords) {
  const osrmProfile = profile === 'car' ? 'driving' : profile;
  const upstream = `https://routing.openstreetmap.de/routed-${profile}/route/v1/${osrmProfile}/${coords}?overview=full&geometries=geojson&alternatives=false&steps=false`;
  const response = await fetch(upstream, {
    signal: AbortSignal.timeout(12000),
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!response.ok) throw Object.assign(new Error('no route found'), { soft: true });
  const ctype = response.headers.get('content-type') || '';
  if (!ctype.includes('json')) throw Object.assign(new Error('no route found'), { soft: true });
  const text = await response.text();
  if (text.length > ROUTE_MAX_RESPONSE_BYTES) throw Object.assign(new Error('no route found'), { soft: true });
  const osrm = JSON.parse(text);
  const route = osrm?.routes?.[0];
  if (osrm?.code !== 'Ok' || !route?.geometry?.coordinates?.length) {
    throw Object.assign(new Error('no route found'), { soft: true });
  }
  return {
    ok: true,
    profile,
    distanceM: Math.round(route.distance),
    durationS: Math.round(route.duration),
    geometry: route.geometry.coordinates,
  };
}

export default async function handler(req, res) {
  const method = String(req.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8', Allow: 'GET' });
    res.end(JSON.stringify({ ok: false, error: 'Method Not Allowed' }));
    return;
  }

  const params = req.query && Object.keys(req.query).length
    ? req.query
    : Object.fromEntries(new URL(req.url || '/', 'http://localhost').searchParams);

  const profile = normalizeProfile(params.profile);
  if (!profile) { fail(res, 'invalid profile'); return; }

  const pairs = String(params.coords || '').split(';').map((s) => s.trim()).filter(Boolean);
  if (pairs.length < 2 || pairs.length > 12) { fail(res, 'need 2-12 coordinates'); return; }

  const clean = [];
  const pts = [];
  for (const pair of pairs) {
    const parts = pair.split(',');
    if (parts.length !== 2) { fail(res, 'invalid coordinate'); return; }
    // Strict numeric form only — no exponents, no stray words reaching upstream.
    if (!/^[+-]?\d+(?:\.\d{1,10})?$/.test(parts[0].trim()) || !/^[+-]?\d+(?:\.\d{1,10})?$/.test(parts[1].trim())) {
      fail(res, 'invalid coordinate');
      return;
    }
    const lon = Number(parts[0]);
    const lat = Number(parts[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      fail(res, 'invalid coordinate');
      return;
    }
    clean.push(`${lon},${lat}`);
    pts.push([lon, lat]);
  }

  // Reject obviously-abusive spans so this public route cannot drive heavy
  // upstream OSRM work: a real walking/driving route is local.
  let totalKm = 0;
  for (let i = 1; i < pts.length; i += 1) {
    const legKm = haversineKm(pts[i - 1][1], pts[i - 1][0], pts[i][1], pts[i][0]);
    if (legKm > ROUTE_MAX_LEG_KM) { fail(res, 'route leg too long'); return; }
    totalKm += legKm;
  }
  if (totalKm > ROUTE_MAX_TOTAL_KM) { fail(res, 'route too long'); return; }

  const coords = clean.join(';');
  const key = `${profile}|${coords}`;

  try {
    const { value, state } = await cacheFor(key).get(() => fetchRoute(profile, coords));
    if (res.headersSent) return;
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=600',
      'X-Route-Cache': state,
    });
    res.end(JSON.stringify(value));
  } catch (error) {
    // Every upstream-shaped failure is a soft 200 { ok:false } — the dev proxy
    // never returns a hard error the globe could print inside a panel.
    fail(res, error?.soft ? error.message : 'route proxy error');
    if (!error?.soft) console.warn('[route] proxy error:', error?.message || error);
  }
}
