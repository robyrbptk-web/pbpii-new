/**
 * Keyless geocoding proxy in the Google Geocoding JSON shape.
 *
 * The globe's search boxes and the CCTV tab read `data.status === 'OK'`,
 * `results[0].geometry.location`, `formatted_address`, `types` and
 * `address_components` exactly as Google returns them, so this route mirrors
 * that contract. Upstreams are keyless: Open-Meteo Geocoding for forward
 * `address` queries and Nominatim reverse for `latlng` queries. The Google
 * `key` parameter is ignored — no credential is ever forwarded or echoed.
 */
import { createTtlCache, envValue } from '../../lib/proxy.js';

const TTL_MS = 12 * 3600_000;
const USER_AGENT = 'pii-global-view/1.0';
const NOMINATIM_UA = `${USER_AGENT} (+https://pbpii.id)`;
const MAX_CACHE_KEYS = 200;

/** One shared-TTL cache per distinct validated query (createTtlCache is per-key). */
const caches = new Map();
async function cached(key, produce) {
  let cache = caches.get(key);
  if (!cache) {
    if (caches.size >= MAX_CACHE_KEYS) caches.delete(caches.keys().next().value);
    cache = createTtlCache(TTL_MS);
    caches.set(key, cache);
  }
  return cache.get(produce);
}

function params(req) {
  return req.query && Object.keys(req.query).length
    ? req.query
    : Object.fromEntries(new URL(req.url || '/', 'http://localhost').searchParams);
}

/** Google always answers 200 + a status field; malformed requests never hit upstream. */
function googleStatus(res, status, results = []) {
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'public, max-age=3600',
  });
  res.end(JSON.stringify({ results, status }));
}

/** Trimmed 1..200-char printable query, or null. */
function cleanAddress(raw) {
  const text = String(raw ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return text.length >= 1 && text.length <= 200 ? text : null;
}

/** "lat,lng[,alt]" -> {latitude, longitude} with strict range checks. */
function cleanLatlng(raw) {
  const parts = String(raw ?? '').split(',').map((part) => part.trim());
  if (parts.length < 2 || parts.length > 3) return null;
  const [latitude, longitude] = parts;
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(latitude) || !/^[+-]?\d+(?:\.\d+)?$/.test(longitude)) return null;
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { latitude: lat, longitude: lon };
}

/** Two-decimal coordinate budget keeps upstream URLs bounded and cache keys tidy. */
function round5(value) {
  return Math.round(value * 100000) / 100000;
}

/** GeoNames feature code -> the Google types the globe's framing logic keys off. */
function typesForFeatureCode(code) {
  const value = String(code || '');
  if (value.startsWith('PCL')) return ['country', 'political'];
  if (value === 'PPLA') return ['administrative_area_level_1', 'political'];
  if (/^PPLA[2-5]$/.test(value)) return ['administrative_area_level_2', 'political'];
  if (/^PPL[CHLSTX]*$/.test(value) && value !== 'PPLA') return ['locality', 'political'];
  if (value.startsWith('AIR')) return ['airport', 'point_of_interest'];
  if (value.startsWith('MTN') || value.startsWith('VALY')) return ['natural_feature', 'establishment'];
  return ['place'];
}

function joinAddress(place) {
  return [place.name, place.admin3, place.admin2, place.admin1, place.country]
    .filter((part, index, all) => part && all.indexOf(part) === index)
    .join(', ');
}

function toGoogleResult(place) {
  const location = { lat: Number(place.latitude), lng: Number(place.longitude) };
  const components = [];
  if (place.locality || place.name) {
    components.push({ long_name: place.locality || place.name, short_name: '', types: ['locality', 'political'] });
  }
  if (place.admin2) components.push({ long_name: place.admin2, short_name: '', types: ['administrative_area_level_2', 'political'] });
  if (place.admin1) components.push({ long_name: place.admin1, short_name: '', types: ['administrative_area_level_1', 'political'] });
  if (place.country) {
    components.push({
      long_name: place.country,
      short_name: place.country_code || '',
      types: ['country', 'political'],
    });
  }
  return {
    address_components: components,
    formatted_address: joinAddress(place),
    geometry: { location, location_type: 'APPROXIMATE' },
    place_id: `om:${place.id ?? `${location.lat},${location.lng}`}`,
    types: place.types || typesForFeatureCode(place.feature_code),
  };
}

/** Forward geocode via Open-Meteo (keyless), biased to the request bounds. */
async function fetchForward(address, language, bounds) {
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.searchParams.set('name', address);
  url.searchParams.set('count', '8');
  url.searchParams.set('language', language);
  url.searchParams.set('format', 'json');
  const response = await fetch(url, {
    signal: AbortSignal.timeout(10000),
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json().catch(() => null);
  const results = Array.isArray(body?.results) ? body.results.slice(0, 5) : [];
  if (!results.length) return [];
  if (bounds) {
    // Viewport bias: nearest-to-centre first, mirroring Google's `bounds` hint.
    const centreLat = (bounds.south + bounds.north) / 2;
    const centreLng = (bounds.west + bounds.east) / 2;
    const distance = (place) => (place.latitude - centreLat) ** 2 + (place.longitude - centreLng) ** 2;
    results.sort((a, b) => distance(a) - distance(b));
  }
  return results.map(toGoogleResult);
}

/** Nominatim's reverse address -> the address_components the HUD/CCTV readers use. */
function toReverseResult(payload, point) {
  const addr = payload?.address || {};
  const component = (longName, types) => (longName
    ? { long_name: String(longName), short_name: types.includes('country') ? String(addr.country_code || '').toUpperCase() : '', types }
    : null);
  const locality = addr.city || addr.town || addr.village || addr.municipality || addr.suburb || addr.neighbourhood;
  const components = [
    component(addr.house_number, ['street_address']),
    component(addr.road, ['route']),
    component(addr.suburb, ['sublocality', 'sublocality_level_1']),
    component(locality, ['locality', 'political']),
    component(addr.county, ['administrative_area_level_2', 'political']),
    component(addr.state, ['administrative_area_level_1', 'political']),
    component(addr.postcode, ['postal_code']),
    component(addr.country, ['country', 'political']),
  ].filter(Boolean);
  if (!components.length && !payload?.display_name) return null;
  return {
    address_components: components,
    formatted_address: payload.display_name || [locality, addr.state, addr.country].filter(Boolean).join(', '),
    geometry: {
      location: { lat: point.latitude, lng: point.longitude },
      location_type: 'ROOFTOP',
      viewport: {
        southwest: { lat: point.latitude - 0.005, lng: point.longitude - 0.005 },
        northeast: { lat: point.latitude + 0.005, lng: point.longitude + 0.005 },
      },
    },
    place_id: `osm:${payload.osm_type || 'R'}${payload.osm_id || ''}`,
    types: locality ? ['street_address'] : ['address'],
  };
}

async function fetchReverse(point, language) {
  const url = new URL('https://nominatim.openstreetmap.org/reverse');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('lat', String(round5(point.latitude)));
  url.searchParams.set('lon', String(round5(point.longitude)));
  url.searchParams.set('zoom', '14');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('accept-language', language);
  const response = await fetch(url, {
    signal: AbortSignal.timeout(10000),
    headers: { 'User-Agent': NOMINATIM_UA },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json().catch(() => null);
  const result = toReverseResult(payload, point);
  return result ? [result] : [];
}

export default async function handler(req, res) {
  const method = String(req.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8', Allow: 'GET' });
    res.end(JSON.stringify({ error: 'Method Not Allowed' }));
    return;
  }

  const query = params(req);
  const language = /^[a-zA-Z]{2}(?:-[a-zA-Z]{2})?$/.test(String(query.language || query.lang || ''))
    ? String(query.language || query.lang)
    : 'en';
  const address = cleanAddress(query.address);
  const point = cleanLatlng(query.latlng);

  if (!address && !point) {
    googleStatus(res, 'INVALID_REQUEST');
    return;
  }

  // Optional Google `bounds=south,west,north,east` bias, validated before use.
  let bounds = null;
  if (query.bounds) {
    const nums = String(query.bounds).split(',').map(Number);
    if (nums.length === 4 && nums.every(Number.isFinite)
      && Math.abs(nums[0]) <= 90 && Math.abs(nums[1]) <= 180
      && Math.abs(nums[2]) <= 90 && Math.abs(nums[3]) <= 180) {
      bounds = { south: nums[0], west: nums[1], north: nums[2], east: nums[3] };
    }
  }

  const key = point
    ? `r|${round5(point.latitude)}|${round5(point.longitude)}|${language}`
    : `f|${language.toLowerCase()}|${(address || '').toLowerCase()}|${bounds ? `${bounds.south},${bounds.west},${bounds.north},${bounds.east}` : ''}`;

  try {
    const { value: results, state } = await cached(key, async () => {
      try {
        return point ? await fetchReverse(point, language) : await fetchForward(address, language, bounds);
      } catch (error) {
        // A failed upstream must not read as a definitive ZERO_RESULTS (the
        // client caches those); surface it so the caller retries later.
        const retry = new Error(`geocode upstream unavailable: ${error?.message || error}`);
        retry.upstream = true;
        throw retry;
      }
    });
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      'X-Geocode-Cache': state,
    });
    res.end(JSON.stringify({ results, status: results.length ? 'OK' : 'ZERO_RESULTS' }));
  } catch (error) {
    if (res.headersSent) return;
    console.warn('[geocode] unavailable:', error?.message || error);
    res.writeHead(502, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify({
      results: [],
      status: 'UNKNOWN_ERROR',
      error: envValue('PII_DEBUG_GEOCODE') ? String(error?.message || error) : 'geocoding temporarily unavailable',
    }));
  }
}
