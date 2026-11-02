/**
 * Kumpulan hadis untuk Ruang Ibadah.
 *
 * Sumbernya berkas statis fawazahmed0/hadith-api yang diantar jsDelivr tanpa kunci
 * API. Satu berkas berisi satu hadis, jadi proksi mengambil edisi Indonesia dan
 * edisi Arab sekaligus, menggabungkannya, lalu menyimpannya 30 hari karena isinya
 * tidak pernah berubah.
 */
import { createTtlCache, sendJson } from './proxy.js';

const UPSTREAM = 'https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions';

/** Edisi yang punya terjemahan Indonesia; batas nomor diverifikasi 2 November 2026. */
const BOOKS = {
  bukhari: { name: 'Sahih Bukhari', max: 7563 },
  muslim: { name: 'Sahih Muslim', max: 7563 },
  abudawud: { name: 'Sunan Abu Dawud', max: 5274 },
  nasai: { name: 'Sunan Nasa-i', max: 5758 },
  ibnmajah: { name: 'Sunan Ibnu Majah', max: 4341 },
  tirmidhi: { name: "Jami' Tirmidzi", max: 3956 },
  malik: { name: 'Muwaththa Malik', max: 1858 },
};

const caches = new Map();

function cacheFor(key) {
  if (!caches.has(key)) caches.set(key, createTtlCache(30 * 24 * 3600_000));
  return caches.get(key);
}

async function fetchEdition(edition, number) {
  const response = await fetch(`${UPSTREAM}/${edition}/${number}.json`, {
    signal: AbortSignal.timeout(20000),
    headers: { Accept: 'application/json' },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json().catch(() => null);
  return Array.isArray(body?.hadiths) ? body.hadiths[0] || null : null;
}

/** `/hadis?b=bukhari&n=1` — satu hadis lengkap dengan teks Arab. */
export async function hadithHandler(req, res) {
  const book = String(req.query?.b || 'bukhari').trim().toLowerCase();
  const meta = BOOKS[book];
  if (!meta) {
    sendJson(res, 400, { success: false, error: 'Buku hadis tidak dikenal.' }, 'miss');
    return;
  }

  const rawNumber = Math.floor(Number(req.query?.n || 1));
  if (!Number.isInteger(rawNumber) || rawNumber < 1 || rawNumber > meta.max) {
    sendJson(res, 400, { success: false, error: `Nomor hadis harus antara 1 dan ${meta.max}.` }, 'miss');
    return;
  }

  try {
    const { value, state } = await cacheFor(`${book}:${rawNumber}`).get(async () => {
      const [indonesian, arabic] = await Promise.all([
        fetchEdition(`ind-${book}`, rawNumber),
        fetchEdition(`ara-${book}`, rawNumber).catch(() => null),
      ]);
      if (!indonesian) return null;
      return {
        book,
        bookName: meta.name,
        max: meta.max,
        number: rawNumber,
        arabicNumber: indonesian.arabicnumber ?? null,
        arabic: String(arabic?.text || '').trim(),
        text: String(indonesian.text || '').trim(),
      };
    });

    if (!value) {
      sendJson(res, 404, { success: false, error: 'Hadis ini belum tersedia dalam terjemahan Indonesia.' }, 'miss');
      return;
    }
    sendJson(res, 200, { success: true, data: { ...value, books: BOOKS } }, state);
  } catch (error) {
    console.warn('[hadith] upstream unavailable:', error?.message || error);
    sendJson(res, 502, { success: false, error: 'Kumpulan hadis sedang tidak tersedia, coba lagi sebentar.' }, 'miss');
  }
}
