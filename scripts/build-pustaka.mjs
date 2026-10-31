/**
 * Bangun korpus Pustaka Organisasi dari folder PDF kebinan PII.
 *
 * Hasilnya dua berkas di luar folder website (republish aman karena repository
 * website bersifat publik):
 *   - pustaka.json      : metadata berkas + potongan teks per rentang halaman,
 *                         dipakai pencarian isi dan penelusuran Tanya PII.
 *   - pustaka-berkas.json: hanya metadata, untuk sheet Documents.
 *
 * Jalankan:  node scripts/build-pustaka.mjs "<folder PDF>" [outputDir]
 * Berkas berkata sandi dicoba ulang dengan PUSTAKA_PASSWORD bila perlu.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PDFTOTEXT = process.env.PDFTOTEXT || 'pdftotext';
const TARGET_WORDS = Number(process.env.PUSTAKA_CHUNK_WORDS || 500);
const PASSWORD = process.env.PUSTAKA_PASSWORD || '';

/** Kategori ditentukan dari judul berkas supaya berkas baru cukup ditambah polanya. */
const KATEGORI = [
  [/ta'?dib/i, 'Kaderisasi', 'Buku Induk Kaderisasi PII: ta\'dib, panduan training, dan ta\'lim.'],
  [/pedoman training|poin/i, 'Pelatihan', 'Pedoman training PII: jenis, konsep, dan penyelenggaraan.'],
  [/silabus.*leadership basic/i, 'Pelatihan', 'Silabus Leadership Basic Training (LBT).'],
  [/silabus.*leadership advance/i, 'Pelatihan', 'Silabus Leadership Advance Training (LAT).'],
  [/silabus.*mental/i, 'Pelatihan', 'Silabus Mental Training (Mentra).'],
  [/pku|pola kebijakan umum/i, 'Kebijakan Umum', 'Pola Kebijakan Umum (PKU) Ketua Umum PB PII.'],
  [/muktamar/i, 'Putusan & Kodifikasi', 'Kodifikasi hasil-hasil Muktamar Nasional PII.'],
  [/rapimnas/i, 'Putusan & Kodifikasi', 'Kodifikasi sidang Rapimnas PII.'],
  [/buku saku.*ppo|ppo/i, 'Organisasi & PPO', 'Buku saku Pengembangan dan Pemberdayaan Organisasi (PPO).'],
  [/panduan kelembagaan/i, 'Kelembagaan', 'Buku Panduan Kelembagaan PB PII.'],
  [/pedoman administrasi|ppa/i, 'Administrasi', 'Pedoman Administrasi (PPA) PII.']
];

const slug = (nama) => path.basename(nama, '.pdf')
  .toLowerCase()
  .replace(/\s*\(?(tanpa password)\)?/i, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 48);

function kategori(namaFile) {
  for (const [pola, kat, ringkas] of KATEGORI) if (pola.test(namaFile)) return { kat, ringkas };
  return { kat: 'Umum', ringkas: '' };
}

/** pdftotext memisahkan halaman dengan form feed (\f). */
function teksHalaman(src) {
  const argumen = ['-enc', 'UTF-8', '-l', '9999'];
  if (PASSWORD) argumen.push('-upw', PASSWORD);
  argumen.push(src, '-');
  try {
    return execFileSync(PDFTOTEXT, argumen, { maxBuffer: 1 << 28, encoding: 'utf8' });
  } catch (error) {
    const pesan = String(error.stdout || '') + String(error.stderr || '');
    if (/incorrect password/i.test(pesan) && !PASSWORD) {
      throw new Error(`${path.basename(src)} berkata sandi — set PUSTAKA_PASSWORD lalu ulangi.`);
    }
    throw error;
  }
}

function bersihkan(baris) {
  return baris
    .replace(/\r/g, '')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/^ ?[-–—.·]*\d{1,4}[-–—.·]? ?$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Potongan panjangnya TARGET_WORDS agar muat sebagai konteks AI dan enak dicuplik. */
function potong(docId, halaman) {
  const chunks = [];
  let buf = [];
  let kata = 0;
  let mulai = 0;

  const simpan = (sampai) => {
    if (!buf.length) return;
    const teks = bersihkan(buf.join('\n '));
    if (teks.split(/\s+/).filter(Boolean).length >= 12) {
      chunks.push({ d: docId, h: [mulai, sampai], t: teks });
    }
    buf = [];
    kata = 0;
  };

  halaman.forEach((isi, index) => {
    const nomor = index + 1;
    if (!buf.length) mulai = nomor;
    for (const baris of isi.split('\n')) {
      const n = baris.trim();
      if (!n) continue;
      buf.push(n);
      kata += n.split(/\s+/).length;
      if (kata >= TARGET_WORDS) {
        simpan(nomor);
        mulai = nomor;
      }
    }
    if (kata >= TARGET_WORDS * 0.6) simpan(nomor);
  });
  simpan(halaman.length);
  return chunks;
}

const sumber = path.resolve(process.argv[2] || '.');
const keluar = path.resolve(process.argv[3] || path.join(sumber, '..', 'pustaka-out'));
if (!fs.existsSync(sumber)) throw new Error(`Folder tidak ditemukan: ${sumber}`);
fs.mkdirSync(keluar, { recursive: true });

const semua = fs.readdirSync(sumber).filter((f) => /\.pdf$/i.test(f));
// Bila ada salinan "tanpa password", pakai salinan itu dan buang versi terenkripsinya.
const namaDescript = new Set(
  semua.filter((f) => /tanpa password/i.test(f)).map((f) => slug(f))
);
const daftarPdf = semua.filter((f) => {
  if (/tanpa password/i.test(f)) return true;
  return !namaDescript.has(slug(f));
});

const berkas = [];
const chunks = [];
for (const nama of daftarPdf) {
  const absolut = path.join(sumber, nama);
  const halaman = teksHalaman(absolut).split('\f');
  const id = slug(nama);
  const { kat, ringkas } = kategori(nama);
  const potongan = potong(id, halaman);
  chunks.push(...potongan);
  berkas.push({
    id,
    judul: path.basename(nama, '.pdf').replace(/\s*\(?(tanpa password)\)?/i, '').trim(),
    kategori: kat,
    ringkas,
    halaman: halaman.filter((h) => h.trim()).length || halaman.length,
    potong: potongan.length,
    byte: fs.statSync(absolut).size,
    berkas: nama
  });
  console.log(`${id}: ${berkas.at(-1).halaman} hlm, ${potongan.length} potong`);
}

const isi = { versi: 1, dibuat: new Date().toISOString(), docs: berkas, chunks };
fs.writeFileSync(path.join(keluar, 'pustaka.json'), JSON.stringify(isi));
fs.writeFileSync(path.join(keluar, 'pustaka-berkas.json'), JSON.stringify({ versi: 1, dibuat: isi.dibuat, docs: berkas }, null, 2));

const byte = fs.statSync(path.join(keluar, 'pustaka.json')).size;
console.log(`\n${berkas.length} berkas, ${chunks.length} potongan, ${Math.round(byte / 1024)} KB → ${keluar}`);
