/**
 * Membundel data statis ibadah supaya halaman tidak menunggu API Muslim.
 * Jalankan: node scripts/make-ibadah-static.mjs   (dev server harus hidup: npm run dev:site)
 *
 * Daftar surat dan daftar kab/kota praktis tidak berubah, tetapi situs harus
 * menariknya dari api.myquran.com lewat proxy yang dingin setiap kali pengunjung
 * membuka Ruang Ibadah. Menyimpan keduanya sebagai berkas statis memangkas satu
 * round-trip penuh dan membuat pencarian kota bekerja tanpa jaringan.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.argv[2] || 'http://127.0.0.1:4173';

async function rows(path) {
  const response = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(90000) });
  const body = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(body?.data) || !body.data.length) {
    throw new Error(`${path} → HTTP ${response.status}, ${JSON.stringify(body).slice(0, 120)}`);
  }
  return body.data;
}

const surahs = (await rows('/api/muslim/quran')).map((surah) => ({
  number: Number(surah.number),
  name: surah.name,
  name_latin: surah.name_latin,
  number_of_ayahs: Number(surah.number_of_ayahs),
  translation: surah.translation,
  revelation: surah.revelation,
}));

const cities = (await rows('/api/muslim/kota')).map((city) => ({
  id: city.id,
  lokasi: city.lokasi,
}));

if (surahs.length !== 114) throw new Error(`Daftar surat seharusnya 114, dapat ${surahs.length}.`);
if (cities.length < 500) throw new Error(`Daftar kab/kota terlalu sedikit: ${cities.length}.`);

const write = (name, value) => {
  writeFileSync(join(ROOT, 'assets', name), `${JSON.stringify(value)}\n`);
  console.log(`assets/${name}  ${value.length} baris`);
};

write('quran-surah.json', surahs);
write('ibadah-kota.json', cities);
