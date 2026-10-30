/**
 * Regional cockpit briefing: place + weather + recent location-matched news.
 *
 * The globe calls `/api/regional-brief?latitude=&longitude=` when the pilot
 * parks on a region, and renders whatever comes back as plain text. Everything
 * here is keyless — Open-Meteo for both the observation and the place label,
 * Google News RSS (GDELT as the fallback index) for the headlines — because
 * this route is public surface and no upstream key may ride along.
 *
 * Response shape is what the client reads (it never inspects raw upstream
 * payloads):
 *   { status, retrievedAt, coordinates, place, placeStatus, weather,
 *     weatherStatus, newsStatus, newsQuery, newsSource, articles }
 *
 * Place is the one deliberate difference from the dev proxy. The dev middleware
 * reverse-geocodes via Nominatim, which needs a registered contact User-Agent
 * and a 1 request/second courtesy window; this deployment instead takes the
 * IANA zone name Open-Meteo already returns for the point ("Asia/Jakarta") and
 * resolves that name through Open-Meteo's keyless geocoding search, keeping the
 * nearest hit. Same fields out, and an ocean point yields no place rather than
 * a misleading city.
 */
import { createTtlCache } from '../lib/proxy.js';

const CACHE_TTL_MS = 5 * 60_000;
const UPSTREAM_TIMEOUT_MS = 12_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 120;
const MAX_ARTICLES = 5;
/** A geocoded city farther than this from the point is not "the place". */
const MAX_PLACE_DISTANCE_KM = 150;

const CURRENT_FIELDS = 'temperature_2m,apparent_temperature,precipitation,weather_code,'
  + 'cloud_cover,wind_speed_10m,wind_direction_10m,visibility';

/** @type {Map<string, ReturnType<typeof createTtlCache>>} one TTL cache per grid cell */
const caches = new Map();

function pointCache(key) {
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

function cleanText(value, maxLength = 180) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function safeHttpUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

/** Required finite query number, or null — never let a stray string reach a URL. */
function requiredFinite(params, name) {
  const raw = params.get(name);
  if (raw === null || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function validPoint(params) {
  const latitude = requiredFinite(params, 'latitude');
  const longitude = requiredFinite(params, 'longitude');
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

async function fetchText(url, { headers = {}, maxBytes = MAX_RESPONSE_BYTES } = {}) {
  const upstream = await fetch(url, { headers, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
  if (!upstream.ok) throw new Error(`upstream ${upstream.status}`);
  const declared = Number(upstream.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error('response too large');
  const text = await upstream.text();
  if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new Error('response too large');
  return text;
}

async function fetchJson(url, options) {
  return JSON.parse(await fetchText(url, options));
}

/** Great-circle km between two points — used to keep place labels honest. */
function distanceKm(from, to) {
  const ratio = Math.PI / 180;
  const phi1 = from.latitude * ratio;
  const phi2 = to.latitude * ratio;
  const deltaPhi = (to.latitude - from.latitude) * ratio;
  const deltaLambda = (to.longitude - from.longitude) * ratio;
  const a = Math.sin(deltaPhi / 2) ** 2
    + Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Open-Meteo current conditions. `timezone=auto` is asked for so the same call
 * also names the point's zone (which `fetchPlace` resolves into a label),
 * which means `current.time` arrives as naive LOCAL time — `utc_offset_seconds`
 * converts it back to the real UTC instant instead of pinning the naive string
 * to UTC.
 */
async function fetchWeather(point) {
  const params = new URLSearchParams({
    latitude: point.latitude.toFixed(5),
    longitude: point.longitude.toFixed(5),
    current: CURRENT_FIELDS,
    timezone: 'auto',
  });
  const payload = await fetchJson(`https://api.open-meteo.com/v1/forecast?${params}`);
  const current = payload?.current;
  if (!current || !Number.isFinite(Number(current.temperature_2m))) return null;

  const offsetSeconds = Number(payload?.utc_offset_seconds);
  let observedAt = null;
  if (typeof current.time === 'string' && !/(?:[zZ]|[+-]\d\d:?\d\d)$/.test(current.time)) {
    const base = Date.parse(`${current.time}Z`);
    observedAt = Number.isNaN(base)
      ? null
      : new Date(base - (Number.isFinite(offsetSeconds) ? offsetSeconds * 1000 : 0)).toISOString();
  } else {
    const instant = Date.parse(current.time);
    observedAt = Number.isNaN(instant) ? null : new Date(instant).toISOString();
  }

  return {
    observedAt,
    temperatureC: numberOrNull(current.temperature_2m),
    apparentTemperatureC: numberOrNull(current.apparent_temperature),
    precipitationMm: numberOrNull(current.precipitation),
    cloudCoverPct: numberOrNull(current.cloud_cover),
    windKph: numberOrNull(current.wind_speed_10m),
    windDirectionDeg: numberOrNull(current.wind_direction_10m),
    visibilityM: numberOrNull(current.visibility),
    weatherCode: numberOrNull(current.weather_code),
    timezone: cleanText(payload?.timezone, 64) || null,
  };
}

/** Nearest Open-Meteo geocoding hit for the zone name, or null. */
async function fetchPlace(point, timezoneName) {
  const cityName = String(timezoneName || '').split('/').pop().replace(/_/g, ' ').trim();
  if (!cityName) return null;
  const params = new URLSearchParams({
    name: cityName.slice(0, 80),
    count: '10',
    language: 'en',
    format: 'json',
  });
  const payload = await fetchJson(`https://geocoding-api.open-meteo.com/v1/search?${params}`);
  const rows = Array.isArray(payload?.results) ? payload.results : [];
  const candidates = rows.filter((row) => Number.isFinite(row?.latitude) && Number.isFinite(row?.longitude));
  if (!candidates.length) return null;
  const nearest = candidates
    .map((row) => ({ row, km: distanceKm(point, { latitude: row.latitude, longitude: row.longitude }) }))
    .sort((a, b) => a.km - b.km)[0];
  if (!nearest || nearest.km > MAX_PLACE_DISTANCE_KM) return null;

  const locality = cleanText(nearest.row.name, 90);
  const region = cleanText(nearest.row.admin1, 90);
  const country = cleanText(nearest.row.country, 90);
  const label = [locality, region]
    .filter((value, index, values) => value && values.indexOf(value) === index)
    .join(', ') || country || locality;
  if (!label) return null;
  return {
    label,
    locality: locality || null,
    region: region || null,
    country: country || null,
    countryCode: cleanText(nearest.row.country_code, 4).toUpperCase() || null,
  };
}

function decodeRssText(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function rssTag(block, tag) {
  return decodeRssText(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(block)?.[1] || '');
}

function normalizeRssArticles(xml, limit = MAX_ARTICLES) {
  const seen = new Set();
  const articles = [];
  for (const match of String(xml || '').matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const item = match[1];
    const title = rssTag(item, 'title').slice(0, 180);
    const parsed = safeHttpUrl(rssTag(item, 'link'));
    if (!title || !parsed) continue;
    let url;
    try {
      url = new URL(parsed);
    } catch {
      continue;
    }
    if (!['http:', 'https:'].includes(url.protocol)) continue;
    const source = rssTag(item, 'source');
    const signature = `${title.toLowerCase()}|${source.toLowerCase() || url.hostname}`;
    if (seen.has(signature)) continue;
    seen.add(signature);
    const rawDate = rssTag(item, 'pubDate');
    articles.push({
      title,
      url: url.href,
      domain: source || url.hostname.replace(/^www\./, ''),
      publishedAt: Number.isNaN(Date.parse(rawDate)) ? null : new Date(rawDate).toISOString(),
      sourceCountry: null,
    });
    if (articles.length >= limit) break;
  }
  return articles;
}

/** GDELT ArticleList rows, deduplicated, without trusting any upstream HTML. */
function normalizeGdeltArticles(payload, limit = MAX_ARTICLES) {
  const rows = Array.isArray(payload?.articles) ? payload.articles : [];
  const seen = new Set();
  const articles = [];
  for (const row of rows) {
    const url = safeHttpUrl(row?.url || row?.url_mobile);
    const title = cleanText(row?.title, 180);
    if (!url || !title) continue;
    let host;
    try {
      host = new URL(url).hostname;
    } catch {
      continue;
    }
    const signature = `${title.toLowerCase()}|${host}`;
    if (seen.has(signature)) continue;
    seen.add(signature);
    const rawDate = cleanText(row?.seendate, 32);
    const compact = /^(\d{8})T(\d{6})Z$/.exec(rawDate);
    const publishedAt = compact
      ? `${compact[1].slice(0, 4)}-${compact[1].slice(4, 6)}-${compact[1].slice(6, 8)}T`
        + `${compact[2].slice(0, 2)}:${compact[2].slice(2, 4)}:${compact[2].slice(4, 6)}Z`
      : (Number.isNaN(Date.parse(rawDate)) ? null : new Date(rawDate).toISOString());
    articles.push({
      title,
      url,
      domain: cleanText(row?.domain || host.replace(/^www\./, ''), 80),
      publishedAt,
      sourceCountry: cleanText(row?.sourcecountry, 60) || null,
    });
    if (articles.length >= Math.max(1, Math.min(MAX_ARTICLES, limit))) break;
  }
  return articles;
}

async function fetchNews(place) {
  const query = place?.locality || place?.region || place?.country;
  if (!query) return { status: 'unavailable', query: null, articles: [], source: null };
  const safe = String(query).replace(/["\\]/g, ' ').trim();
  if (!safe) return { status: 'unavailable', query: null, articles: [], source: null };

  try {
    const params = new URLSearchParams({ q: safe, hl: 'en-US', gl: 'US', ceid: 'US:en' });
    const xml = await fetchText(`https://news.google.com/rss/search?${params}`, {
      headers: { 'User-Agent': 'pii-global-view/1.0' },
    });
    const articles = normalizeRssArticles(xml, MAX_ARTICLES);
    if (articles.length) return { status: 'ready', query, articles, source: 'Google News RSS' };
  } catch { /* fall through to the keyless GDELT index */ }

  try {
    const params = new URLSearchParams({
      query: `"${safe}"`,
      mode: 'artlist',
      format: 'json',
      maxrecords: '5',
      sort: 'datedesc',
      timespan: '48h',
    });
    const payload = await fetchJson(`https://api.gdeltproject.org/api/v2/doc/doc?${params}`, {
      headers: { 'User-Agent': 'pii-global-view/1.0' },
    });
    const articles = normalizeGdeltArticles(payload, MAX_ARTICLES);
    return { status: articles.length ? 'ready' : 'empty', query, articles, source: articles.length ? 'GDELT fallback' : null };
  } catch {
    return { status: 'unavailable', query, articles: [], source: null };
  }
}

/**
 * One refresh: weather first (its zone name feeds the place lookup, and the
 * place names the news query), so a single upstream chain produces the brief.
 */
async function refresh(point) {
  const weather = await fetchWeather(point).catch(() => null);
  const place = weather?.timezone
    ? await fetchPlace(point, weather.timezone).catch(() => null)
    : null;
  const news = await fetchNews(place);
  if (!place && !weather && news.status === 'unavailable') {
    throw new Error('All regional briefing sources unavailable');
  }
  return {
    status: place && weather && news.status !== 'unavailable' ? 'ready' : 'partial',
    retrievedAt: new Date().toISOString(),
    coordinates: point,
    place,
    placeStatus: place ? 'ready' : 'unavailable',
    weather,
    weatherStatus: weather ? 'ready' : 'unavailable',
    newsStatus: news.status,
    newsQuery: news.query,
    newsSource: news.source,
    articles: news.articles,
    cachedAt: Date.now(),
  };
}

/** Same 60-minute stale ceiling the dev proxy serves after a refresh failure. */
const REGIONAL_BRIEF_STALE_MS = 60 * 60_000;

const send = (res, status, body, cacheState) => {
  if (res.headersSent) return;
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    // A stale payload is a degraded answer; like the dev proxy it must not be
    // re-cached downstream (only fresh hits get max-age=60).
    'Cache-Control': status === 200 && cacheState !== 'STALE' ? 'public, max-age=60' : 'no-store',
    'X-Regional-Brief': cacheState,
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
  const point = validPoint(params);
  if (!point) {
    send(res, 400, { error: 'Valid latitude and longitude are required' }, 'NONE');
    return;
  }

  // 0.1° grid (~11 km): the cockpit brief is regional, so nearby pins share one
  // answer instead of minting a fresh upstream fan-out per pixel.
  const key = `${(Math.round(point.latitude * 10) / 10).toFixed(1)},${(Math.round(point.longitude * 10) / 10).toFixed(1)}`;

  try {
    const { value, state } = await pointCache(key).get(() => refresh(point));
    const { cachedAt, ...payload } = value;
    if (state === 'stale') {
      if (Date.now() - cachedAt > REGIONAL_BRIEF_STALE_MS) {
        send(res, 503, { error: 'Regional briefing is temporarily unavailable' }, 'STALE');
        return;
      }
      send(res, 200, { ...payload, status: 'stale' }, 'STALE');
      return;
    }
    send(
      res,
      200,
      { ...payload, status: state === 'hit' ? 'cached' : payload.status },
      state === 'coalesced' ? 'INFLIGHT' : state.toUpperCase(),
    );
  } catch (error) {
    console.warn('[regional-brief] unavailable:', error?.message || error);
    send(res, 503, { error: 'Regional briefing is temporarily unavailable' }, 'NONE');
  }
}

/** Weather + geocoding + a news index, sequentially. */
export const maxDuration = 30;
