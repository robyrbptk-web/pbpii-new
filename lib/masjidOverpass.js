/**
 * Cari masjid & musala terdekat untuk Ruang Ibadah.
 *
 * OpenStreetMap adalah satu-satunya basis data masjid yang bisa diakses tanpa kunci,
 * jadi kueri Overpass disusun di sini dari angka hasil validasi — browser tidak pernah
 * mengirim teks kueri. Mirror dirotasi karena satu mirror sering sedang sibuk.
 */
import { createTtlCache, sendJson } from './proxy.js';

const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
];
const MIRROR_TIMEOUT_MS = 6_000;
/** Batas total semua percobaan mirror, supaya jawaban galat datang sebelum browser menyerah. */
const TOTAL_DEADLINE_MS = 18_000;
const MAX_ELEMENTS = 60;
const MAX_RESULTS = 25;
const MIN_RADIUS_M = 500;
const MAX_RADIUS_M = 20_000;
const USER_AGENT = 'pbpii-website/1.0';

const caches = new Map();

function cacheFor(key) {
  if (!caches.has(key)) caches.set(key, createTtlCache(24 * 3600_000));
  return caches.get(key);
}

function numberOrNull(value, limit) {
  const number = Number(value);
  return Number.isFinite(number) && Math.abs(number) <= limit ? number : null;
}

/** Jarak lurut belahan bumi, cukup untuk memeringkas urutan dalam kota. */
function distanceKm(fromLat, fromLon, toLat, toLon) {
  const toRad = (degrees) => (degrees * Math.PI) / 180;
  const dLat = toRad(toLat - fromLat);
  const dLon = toRad(toLon - fromLon);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(fromLat)) * Math.cos(toRad(toLat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function query(radius, lat, lon) {
  return [
    '[out:json][timeout:5];',
    '(',
    `node["amenity"="place_of_worship"]["religion"="muslim"](around:${radius},${lat},${lon});`,
    `way["amenity"="place_of_worship"]["religion"="muslim"](around:${radius},${lat},${lon});`,
    ');',
    `out center ${MAX_ELEMENTS};`,
  ].join('\n');
}

function describe(element, origin) {
  const tags = element.tags || {};
  const point = element.center || element;
  const lat = Number(point.lat);
  const lon = Number(point.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const name = tags.name || tags['name:id'] || tags.alt_name || '';
  const address = [tags['addr:street'], tags['addr:city']]
    .filter((part) => typeof part === 'string' && part.trim())
    .join(', ');
  return {
    name: name || 'Masjid atau musala (belum bernama di peta)',
    address,
    lat: Number(lat.toFixed(6)),
    lon: Number(lon.toFixed(6)),
    distanceKm: Number(distanceKm(origin.lat, origin.lon, lat, lon).toFixed(2)),
  };
}

async function runQuery(body) {
  let lastError = null;
  const deadlineAt = Date.now() + TOTAL_DEADLINE_MS;
  for (const endpoint of MIRRORS) {
    const remaining = deadlineAt - Date.now();
    if (remaining < 2_000) {
      lastError = lastError || new Error('Waktu mirror habis');
      break;
    }
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': USER_AGENT,
          Accept: 'application/json',
        },
        body,
        signal: AbortSignal.timeout(Math.min(MIRROR_TIMEOUT_MS, remaining)),
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed?.elements)) throw new Error('Tidak ada elemen');
      return parsed.elements;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Semua mirror Overpass gagal');
}

/** `/masjid?lat=..&lon=..&radius=5000` — daftar masjid terdekat, urut jarak. */
export async function masjidHandler(req, res) {
  const lat = numberOrNull(req.query?.lat, 90);
  const lon = numberOrNull(req.query?.lon, 180);
  if (lat === null || lon === null) {
    sendJson(res, 400, { success: false, error: 'Koordinat tidak valid.' }, 'miss');
    return;
  }

  // Parameternya tidak boleh bernama `r`: vercel.json memakai `?r=` untuk
  // menurunkan rute bertingkat ke satu fungsi, dan nama yang sama akan menimpanya.
  const rawRadius = Math.round(Number(req.query?.radius) || 5000);
  const radius = Math.min(Math.max(rawRadius, MIN_RADIUS_M), MAX_RADIUS_M);
  const point = { lat: Number(lat.toFixed(5)), lon: Number(lon.toFixed(5)) };

  try {
    const { value, state } = await cacheFor(`${point.lat},${point.lon}:${radius}`).get(async () => {
      const body = `data=${encodeURIComponent(query(radius, point.lat, point.lon))}`;
      const elements = await runQuery(body);
      const seen = new Set();
      const mosques = elements
        .map((element) => describe(element, point))
        .filter((row) => row && !seen.has(`${row.lat}:${row.lon}`) && seen.add(`${row.lat}:${row.lon}`))
        .sort((a, b) => a.distanceKm - b.distanceKm)
        .slice(0, MAX_RESULTS);
      return { count: mosques.length, radius, mosques };
    });

    sendJson(res, 200, { success: true, data: value }, state);
  } catch (error) {
    console.warn('[masjid] upstream unavailable:', error?.message || error);
    sendJson(res, 502, { success: false, error: 'Data masjid sedang tidak tersedia, coba lagi sebentar.' }, 'miss');
  }
}
