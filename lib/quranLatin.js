/**
 * Transliterasi Latin per ayat Al-Qur'an.
 *
 * Sumber tanpa kunci: equran.id (ejaan Kemenag, ā ī ū ḥ ṣ) dengan cadangan
 * alquran.cloud. Keduanya diambil dari server supaya halaman tetap
 * same-origin, dan karena teks Latin tidak pernah berubah hasilnya disimpan
 * tiga puluh hari lalu dikirim dalam bentuk paling ramping ({n, latin}).
 */
import { createTtlCache, sendJson } from './proxy.js';

const EQURAN = 'https://equran.id/api/v2/surat/';
const CLOUD = 'https://api.alquran.cloud/v1/surah/';

const SIFAT_MINTA = { Accept: 'application/json', 'User-Agent': 'pbpii-web/1.0 (transliterasiLatin)' };

async function json(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000), headers: SIFAT_MINTA });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function rapikan(ayat) {
  return ayat
    .map(({ n, latin }) => ({ n: Number(n), latin: String(latin || '').replace(/\s+/g, ' ').trim() }))
    .filter((row) => Number.isInteger(row.n) && row.latin);
}

async function dariEquran(surah) {
  const body = await json(`${EQURAN}${surah}`);
  const rows = rapikan((body?.data?.ayat || []).map((ayat) => ({ n: ayat?.nomorAyat, latin: ayat?.teksLatin })));
  if (!rows.length) throw new Error('equran.id tidak punya teks Latin surat ini');
  return { surah: Number(body?.data?.nomor) || surah, source: 'equran.id', ayat: rows };
}

async function dariCloud(surah) {
  const body = await json(`${CLOUD}${surah}/en.transliteration`);
  const rows = rapikan((body?.data?.ayahs || []).map((ayat) => ({ n: ayat?.numberInSurah, latin: ayat?.text })));
  if (!rows.length) throw new Error('alquran.cloud tidak punya teks Latin surat ini');
  return { surah: Number(body?.data?.number) || surah, source: 'alquran.cloud', ayat: rows };
}

const caches = new Map();

function cacheUntuk(surah) {
  if (!caches.has(surah)) caches.set(surah, createTtlCache(30 * 24 * 3600_000));
  return caches.get(surah);
}

/** `/muslim/latin?surah=1..114` → `{ surah, source, ayat: [{ n, latin }] }`. */
export async function latinHandler(req, res) {
  const surah = Number(req.query?.surah);
  if (!Number.isInteger(surah) || surah < 1 || surah > 114) {
    sendJson(res, 400, { success: false, error: 'Nomor surat harus 1–114' }, 'miss');
    return;
  }

  try {
    const { value, state } = await cacheUntuk(surah).get(async () => {
      try {
        return await dariEquran(surah);
      } catch (primaryError) {
        try {
          return await dariCloud(surah);
        } catch (fallbackError) {
          const sebab = fallbackError?.message || fallbackError;
          throw new Error(`equran: ${primaryError?.message}; cloud: ${sebab}`);
        }
      }
    });
    sendJson(res, 200, { success: true, data: value, meta: { source: value.source, fetchedAt: Date.now() } }, state);
  } catch (error) {
    console.warn('[latin] upstream unavailable:', error?.message || error);
    sendJson(res, 502, { success: false, error: 'Transliterasi Latin sedang tidak tersedia' }, 'miss');
  }
}
