/**
 * Cari masjid & musala terdekat untuk Ruang Ibadah.
 *
 * Sumber utama OpenStreetMap lewat Overpass karena isinya paling lengkap; Wikidata dipakai
 * bila semua mirror Overpass tidak menjawab — dari beberapa jaringan dan developer lokal
 * mirror itu sering tidak bisa dijangkau sama sekali. Keduanya hanya mengembalikan nama,
 * alamat, dan titik, jadi jarak, urutan, dan pemangkasan dihitung di sini agar hasilnya
 * konsisten apa pun sumber yang menjawab.
 */
import { createTtlCache, sendJson } from './proxy.js';
import { cariOverpass } from './masjidOverpass.js';
import { cariWikidata } from './masjidWikidata.js';

const MAX_RESULTS = 25;
const MIN_RADIUS_M = 500;
const MAX_RADIUS_M = 20_000;

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

function rapikan(rows, point, radius) {
  const seen = new Set();
  return rows
    .map((row) => {
      const lat = Number(row.lat.toFixed(6));
      const lon = Number(row.lon.toFixed(6));
      return { ...row, lat, lon, distanceKm: Number(distanceKm(point.lat, point.lon, lat, lon).toFixed(2)) };
    })
    .filter((row) => row.distanceKm <= radius / 1000)
    .filter((row) => !seen.has(`${row.lat}:${row.lon}`) && seen.add(`${row.lat}:${row.lon}`))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, MAX_RESULTS);
}

async function dariDuaSumber(radius, point) {
  let lastError = null;
  for (const sumber of [cariOverpass, cariWikidata]) {
    try {
      const mosques = rapikan(await sumber(radius, point), point, radius);
      return { count: mosques.length, radius, mosques };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Semua sumber masjid gagal');
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
    const { value, state } = await cacheFor(`${point.lat},${point.lon}:${radius}`)
      .get(() => dariDuaSumber(radius, point));

    sendJson(res, 200, { success: true, data: value }, state);
  } catch (error) {
    console.warn('[masjid] upstream unavailable:', error?.message || error);
    sendJson(res, 502, { success: false, error: 'Data masjid sedang tidak tersedia, coba lagi sebentar.' }, 'miss');
  }
}
