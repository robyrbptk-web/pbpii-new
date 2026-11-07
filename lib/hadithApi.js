/**
 * Kumpulan hadis untuk Ruang Ibadah.
 *
 * Sumbernya berkas statis fawazahmed0/hadith-api@1 yang diantar jsDelivr tanpa kunci
 * API. Satu berkas berisi satu hadis, jadi proksi mengambil edisi Indonesia dan
 * edisi Arab sekaligus, menggabungkannya, lalu menyimpannya 30 hari karena isinya
 * tidak pernah berubah.
 *
 * Terjemahan Indonesia tidak lengkap: 2.636 nomor Sahih Muslim berisi teks kosong.
 * Daftar nomor yang benar-benar ada dibekukan di lib/hadithIndex.js, sehingga
 * nomor yang bolong langsung diarahkan ke hadis terdekat tanpa mengejar belasan
 * berkas ke jsDelivr — yang malah berbalas 403.
 */
import { createTtlCache, sendJson } from './proxy.js';
import { HADITH_ID } from './hadithIndex.js';

const UPSTREAM = 'https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions';

/** Edisi yang punya terjemahan Indonesia; batas nomor ikut dibekukan dari sumber. */
const NAMA_BUKU = {
  bukhari: 'Sahih Bukhari',
  muslim: 'Sahih Muslim',
  abudawud: 'Sunan Abu Dawud',
  nasai: 'Sunan Nasa-i',
  ibnmajah: 'Sunan Ibnu Majah',
  tirmidhi: "Jami' Tirmidzi",
  malik: 'Muwaththa Malik',
};

const BOOKS = Object.fromEntries(
  Object.entries(NAMA_BUKU).map(([book, name]) => [book, { name, max: HADITH_ID[book]?.jumlah || 0 }]),
);

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

/** Teks Indonesia satu nomor; null bila berkasnya hilang atau isinya kosong. */
function bacaIndonesia(book, number) {
  return cacheFor(`id:${book}:${number}`).get(async () => {
    const hadith = await fetchEdition(`ind-${book}`, number);
    const text = String(hadith?.text || '').trim();
    return text.length < 5 ? null : { text, arabicNumber: hadith.arabicnumber ?? null };
  }).then((hasil) => hasil.value);
}

function bacaArab(book, number) {
  return cacheFor(`ar:${book}:${number}`).get(async () => {
    const hadith = await fetchEdition(`ara-${book}`, number).catch(() => null);
    return String(hadith?.text || '').trim();
  }).then((hasil) => hasil.value);
}

/** Nomor yang terjemahannya berisi, terdekat dulu; nomor itu sendiri bila ada. */
function nomorTerdekat(book, number) {
  const rentang = HADITH_ID[book]?.ada || [];
  let kiri = null;
  for (const [awal, akhir] of rentang) {
    if (number >= awal && number <= akhir) return number;
    if (number < awal) {
      if (kiri === null || awal - number <= number - kiri) return awal;
      return kiri;
    }
    kiri = akhir;
  }
  return kiri;
}

/**
 * Tetangga yang benar-benar berisi. Tanpa ini tombol maju bisa meminta nomor
 * bolong lalu dilempar kembali ke nomor yang sedang tampil — pengguna terjebak.
 */
function nomorTetangga(book, number, arah) {
  const rentang = HADITH_ID[book]?.ada || [];
  if (arah === 'maju') {
    for (const [awal, akhir] of rentang) {
      if (number < awal) return awal;
      if (number < akhir) return number + 1;
    }
    return null;
  }
  let hasil = null;
  for (const [awal, akhir] of rentang) {
    if (number <= awal) return hasil;
    if (number <= akhir) return number - 1;
    hasil = akhir;
  }
  return hasil;
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

  const arah = String(req.query?.arah || '');
  const found = arah === 'maju' || arah === 'mundur'
    ? nomorTetangga(book, rawNumber, arah)
    : nomorTerdekat(book, rawNumber);
  if (!found) {
    const pesan = arah === 'maju' ? 'Sudah di hadis terakhir buku ini.'
      : arah === 'mundur' ? 'Sudah di hadis pertama buku ini.'
        : 'Terjemahan Indonesia buku ini belum tersedia.';
    sendJson(res, 404, { success: false, error: pesan }, 'miss');
    return;
  }

  const rentang = HADITH_ID[book].ada;
  try {
    const [indonesian, arabic] = await Promise.all([bacaIndonesia(book, found), bacaArab(book, found)]);
    if (!indonesian) throw new Error(`nomor ${found} kosong padahal indeks menyebutnya ada`);
    sendJson(res, 200, {
      success: true,
      data: {
        book,
        bookName: meta.name,
        max: meta.max,
        number: found,
        diminta: rawNumber,
        pertama: rentang[0][0],
        terakhir: rentang[rentang.length - 1][1],
        arabicNumber: indonesian.arabicNumber,
        arabic: String(arabic || '').trim(),
        text: indonesian.text,
        books: BOOKS,
      },
    }, 'hit');
  } catch (error) {
    console.warn('[hadith] upstream unavailable:', error?.message || error);
    sendJson(res, 502, { success: false, error: 'Kumpulan hadis sedang tidak tersedia, coba lagi sebentar.' }, 'miss');
  }
}
