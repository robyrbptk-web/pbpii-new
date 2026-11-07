/**
 * Membekukan daftar nomor hadis yang terjemahan Indonesia-nya benar-benar berisi.
 * Jalankan: node scripts/make-hadith-index.mjs
 *
 * Sumbernya berkas buku utuh fawazahmed0/hadith-api@1, dan yang dipakai adalah
 * field `hadithnumber`: posisi dalam array `hadiths` bergeser dari nomor berkas
 * (Sahih Bukhari mulai entri 403), jadi tidak boleh dipakai sebagai nomor.
 * Sebagian nomor kosong atau tidak ada — Sahih Muslim kehilangan 2.636 nomor —
 * jadi daftar ini dipakai proksi untuk melompat ke hadis terdekat tanpa mengejar
 * belasan berkas ke jsDelivr setiap permintaan.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UPSTREAM = 'https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions';
const BUKU = ['bukhari', 'muslim', 'abudawud', 'nasai', 'ibnmajah', 'tirmidhi', 'malik'];
const MIN_PANJANG = 5;

/**
 * Batas penomoran berkas per hadis, diuji 6 November 2026: berkas nomor
 * berikutnya selalu 404 meski berkas buku utuh menyimpan lebih banyak entri.
 * Nomor di atas batas ini tidak akan pernah terbaca pembaca hadis.
 */
const BATAS = {
  bukhari: 7563,
  muslim: 7563,
  abudawud: 5274,
  nasai: 5758,
  ibnmajah: 4341,
  tirmidhi: 3956,
  malik: 1858,
};

const indeks = {};
for (const buku of BUKU) {
  const response = await fetch(`${UPSTREAM}/ind-${buku}.min.json`, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`ind-${buku}.min.json → HTTP ${response.status}`);
  const body = await response.json();
  const baris = Array.isArray(body?.hadiths) ? body.hadiths : [];
  if (baris.length < BATAS[buku]) {
    throw new Error(`ind-${buku}: berkas buku hanya ${baris.length} entri, batas ${BATAS[buku]} tidak tercapai.`);
  }

  const ada = [];
  for (const hadith of baris) {
    const nomor = Number(hadith?.hadithnumber);
    // Nomor pecahan (402.2) adalah sub-hadis yang tidak punya berkas sendiri,
    // dan posisi dalam array tidak selalu sama dengan nomor (bukhari bergeser
    // mulai entri 403), jadi hanya `hadithnumber` utuh yang dipakai.
    if (!Number.isInteger(nomor) || nomor < 1 || nomor > BATAS[buku]) continue;
    if (String(hadith?.text || '').trim().length >= MIN_PANJANG) ada.push(nomor);
  }
  ada.sort((a, b) => a - b);
  if (ada.length < BATAS[buku] * 0.4) {
    throw new Error(`ind-${buku}: hanya ${ada.length}/${BATAS[buku]} berisi, periksa sumber.`);
  }

  const rentang = [];
  for (const nomor of ada) {
    const terakhir = rentang[rentang.length - 1];
    if (terakhir && nomor === terakhir[1] + 1) terakhir[1] = nomor;
    else if (!terakhir || nomor !== terakhir[1]) rentang.push([nomor, nomor]);
  }
  indeks[buku] = { jumlah: BATAS[buku], ada: rentang };
  console.log(`${buku}: ${ada.length}/${BATAS[buku]} berisi, ${rentang.length} rentang (berkas buku ${baris.length} entri)`);
}

const angka = JSON.stringify(indeks, null, 0)
  .replace(/\],\[/g, '],\n    [')
  .replace(/\{/g, '{ ')
  .replace(/\}/g, ' }');
const isi = `/**
 * Daftar nomor hadis yang terjemahan Indonesia-nya berisi, per buku.
 *
 * Sumbernya \`.min.json\` fawazahmed0/hadith-api, dan yang dipakai adalah field
 * \`hadithnumber\` — posisi dalam array tidak selalu sama dengan nomor berkas.
 * Regenerasi bila sumber menambah terjemahan: node scripts/make-hadith-index.mjs
 */
export const HADITH_ID = ${angka};
`;
writeFileSync(join(ROOT, 'lib', 'hadithIndex.js'), isi);
console.log('lib/hadithIndex.js ditulis', (isi.length / 1024).toFixed(0), 'KB');
