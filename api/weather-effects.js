/**
 * Weather-effects proxy — camera-local Open-Meteo observations that drive the
 * cockpit cloud/rain effects.
 *
 * Contract copied from the dev proxy (vite.config.js `weatherEffectsProxy`):
 * GET `latitude`/`longitude`, response `{ status: 'ready'|'cached'|'stale',
 * retrievedAt, coordinates: { latitude, longitude }, weather }` where `weather`
 * is the normalized Open-Meteo current (the client only reads `payload.weather`
 * plus `payload.status`). Invalid point → 400, upstream outage → 503, all with
 * the dev proxy's exact error strings.
 */
import { createTtlCache } from '../lib/proxy.js';

const TTL_MS = 5 * 60_000;
const USER_AGENT = 'pii-global-view/1.0';
const WEATHER_MAX_RESPONSE_BYTES = 512 * 1024;

const caches = new Map();
function cacheFor(key) {
  let cache = caches.get(key);
  if (!cache) {
    if (caches.size >= 180) caches.delete(caches.keys().next().value);
    cache = createTtlCache(TTL_MS);
    caches.set(key, cache);
  }
  return cache;
}

function json(res, status, payload, headerState) {
  if (res.headersSent) return;
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': status === 200 ? 'public, max-age=60' : 'no-store',
    'X-Weather-Effects': headerState,
  });
  res.end(JSON.stringify(payload));
}

function validPoint(params) {
  const latitude = Number(params.latitude);
  const longitude = Number(params.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (typeof params.latitude !== 'number' && !/^[+-]?\d+(?:\.\d+)?$/.test(String(params.latitude))) return null;
  if (typeof params.longitude !== 'number' && !/^[+-]?\d+(?:\.\d+)?$/.test(String(params.longitude))) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

/** Ported from gods-eye-view/src/data/regionalBrief.js normalizeRegionalWeather. */
function normalizeRegionalWeather(payload) {
  const current = payload?.current;
  if (!current || !Number.isFinite(Number(current.temperature_2m))) return null;
  const numberOrNull = (value) => {
    if (value === null || value === undefined || value === '') return null;
    return Number.isFinite(Number(value)) ? Number(value) : null;
  };
  // Open-Meteo reports zone-naive timestamps that are UTC; pin them explicitly.
  const observedRaw = typeof current.time === 'string' && !/(?:[zZ]|[+-]\d\d:?\d\d)$/.test(current.time)
    ? `${current.time}Z`
    : current.time;
  return {
    observedAt: Number.isNaN(Date.parse(observedRaw)) ? null : new Date(observedRaw).toISOString(),
    temperatureC: numberOrNull(current.temperature_2m),
    apparentTemperatureC: numberOrNull(current.apparent_temperature),
    precipitationMm: numberOrNull(current.precipitation),
    cloudCoverPct: numberOrNull(current.cloud_cover),
    windKph: numberOrNull(current.wind_speed_10m),
    windDirectionDeg: numberOrNull(current.wind_direction_10m),
    visibilityM: numberOrNull(current.visibility),
    weatherCode: numberOrNull(current.weather_code),
  };
}

async function fetchRegionalWeather(point) {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', point.latitude.toFixed(5));
  url.searchParams.set('longitude', point.longitude.toFixed(5));
  url.searchParams.set('current', 'temperature_2m,apparent_temperature,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,visibility');
  url.searchParams.set('timezone', 'UTC');
  const response = await fetch(url, {
    signal: AbortSignal.timeout(9000),
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!response.ok) throw new Error(`Upstream returned ${response.status}`);
  const text = await response.text();
  if (text.length > WEATHER_MAX_RESPONSE_BYTES) throw new Error('Weather response too large');
  const payload = JSON.parse(text);
  const weather = normalizeRegionalWeather(payload);
  if (!weather) throw new Error('Weather observation unavailable');
  return {
    status: 'ready',
    retrievedAt: new Date().toISOString(),
    coordinates: point,
    weather,
  };
}

export default async function handler(req, res) {
  const method = String(req.method || 'GET').toUpperCase();
  if (method !== 'GET') {
    json(res, 405, { error: 'Method Not Allowed' }, 'MISS');
    return;
  }

  const params = req.query && Object.keys(req.query).length
    ? req.query
    : Object.fromEntries(new URL(req.url || '/', 'http://localhost').searchParams);

  const point = validPoint(params);
  if (!point) {
    json(res, 400, { error: 'Valid latitude and longitude are required' }, 'MISS');
    return;
  }

  // Cache grid: 0.1° — the same key rounding the dev proxy uses.
  const key = `${(Math.round(point.latitude * 10) / 10).toFixed(1)},${(Math.round(point.longitude * 10) / 10).toFixed(1)}`;

  try {
    const { value, state } = await cacheFor(key).get(() => fetchRegionalWeather(point));
    json(
      res,
      200,
      state === 'hit' || state === 'coalesced' ? { ...value, status: 'cached' } : value,
      'public, max-age=60',
      state === 'hit' ? 'HIT' : state === 'coalesced' ? 'INFLIGHT' : state === 'stale' ? 'STALE' : 'MISS',
    );
  } catch (error) {
    console.warn('[weather-effects] unavailable:', error?.message || error);
    json(res, 503, { error: 'Weather effects are temporarily unavailable' }, 'MISS');
  }
}
