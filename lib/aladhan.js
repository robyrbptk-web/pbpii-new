/**
 * Kalender Hijriah bulanan untuk Ruang Ibadah.
 *
 * API Muslim hanya mengeluarkan tanggal Hijriah hari ini, jadi rangkaian sebulan
 * diambil dari Aladhan dengan metode 20 (Kementerian Agama RI) yang bebas kunci.
 * Waktu sholat upstream dibuang — jadwal sholat halaman ini sudah memakai data
 * Kemenag dari API Muslim — sehingga muatannya tinggal pasangan tanggal.
 * Hari besar dari upstream sengaja tidak diantar: isinya catatan haul internasional
 * yang asing untuk pembaca di Indonesia.
 */
import { createTtlCache, sendJson } from './proxy.js';

const UPSTREAM = 'https://api.aladhan.com/v1';
const METHOD = 20;
const DEFAULT_LAT = -6.2088;
const DEFAULT_LON = 106.8456;

const caches = new Map();

function cacheFor(key, ttlMs) {
  if (!caches.has(key)) caches.set(key, createTtlCache(ttlMs));
  return caches.get(key);
}

function integerInRange(value, min, max) {
  const number = Math.floor(Number(value));
  return Number.isInteger(number) && number >= min && number <= max ? number : null;
}

function coordinate(value, limit, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && Math.abs(number) <= limit ? number : fallback;
}

async function getJson(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(20000),
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

/** Hari ini menurut jam Jakarta, bentuk DD-MM-YYYY yang diminta upstream. */
function jakartaToday() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(Date.now());
  const field = (type) => parts.find((part) => part.type === type)?.value || '';
  return `${field('day')}-${field('month')}-${field('year')}`;
}

/** Bulan Hijriah berjalan, dipakai saat permintaan tanpa parameter. */
async function currentHijriMonth() {
  const body = await getJson(`${UPSTREAM}/gToH/${jakartaToday()}`);
  const hijri = body?.data?.hijri || {};
  const month = integerInRange(hijri.month?.number, 1, 12);
  const year = integerInRange(hijri.year, 1300, 1500);
  if (!month || !year) throw new Error('Tanggal Hijriah hari ini tidak dikenali');
  return { year, month };
}

/** Satu sel grid: tanggal Hijriah plus tanggal Masehinya. */
function slimDay(entry) {
  const greg = entry?.date?.gregorian || {};
  const hijri = entry?.date?.hijri || {};
  return {
    hijriDay: Number(hijri.day) || null,
    gregDay: Number(greg.day) || null,
    gregMonth: Number(greg.month?.number) || null,
    gregYear: String(greg.year || ''),
    gregWeekday: String(greg.weekday?.en || ''),
  };
}

/** `/hijriah` (bulan berjalan) atau `/hijriah?t=1448&b=7` untuk navigasi antarbulan. */
export async function hijriHandler(req, res) {
  const rawYear = integerInRange(req.query?.t, 1300, 1500);
  const rawMonth = integerInRange(req.query?.b, 1, 12);
  if ((rawYear && !rawMonth) || (!rawYear && rawMonth)) {
    sendJson(res, 400, { success: false, error: 'Tahun dan bulan Hijriah harus disebut bersama.' }, 'miss');
    return;
  }

  const lat = coordinate(req.query?.lat, 90, DEFAULT_LAT).toFixed(4);
  const lon = coordinate(req.query?.lon, 180, DEFAULT_LON).toFixed(4);
  const explicit = Boolean(rawYear && rawMonth);
  const key = explicit ? `${rawYear}:${rawMonth}` : 'berjalan';

  try {
    const { value, state } = await cacheFor(key, explicit ? 30 * 24 * 3600_000 : 3600_000).get(async () => {
      const { year, month } = explicit ? { year: rawYear, month: rawMonth } : await currentHijriMonth();
      const url = new URL(`${UPSTREAM}/hijriCalendar/${year}/${month}`);
      url.searchParams.set('latitude', lat);
      url.searchParams.set('longitude', lon);
      url.searchParams.set('method', String(METHOD));
      const body = await getJson(url);
      const rows = Array.isArray(body?.data) ? body.data.map(slimDay) : [];
      if (!rows.length) throw new Error('Kalender kosong');
      return { year, month, days: rows };
    });

    sendJson(res, 200, { success: true, data: value }, state);
  } catch (error) {
    console.warn('[hijri] upstream unavailable:', error?.message || error);
    sendJson(res, 502, { success: false, error: 'Kalender Hijriah sedang tidak tersedia, coba lagi sebentar.' }, 'miss');
  }
}
