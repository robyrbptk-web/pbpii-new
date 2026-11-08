// Bangkitkan server/inti.cjs dari gas/Code.gs.
//
// Logika backend dipindah apa adanya. Satu-satunya yang sengaja diubah adalah
// tautan gambar hasil unggahan: berkas baru hidup di Storage, bukan di Drive.
// Ganti di bawah dicocokkan dengan jumlah kemunculan yang diharapkan, jadi
// perubahan di Code.gs tidak bisa membuat port ini diam-diam masih mengirim
// tautan Drive untuk berkas yang sudah pindah.
//
//   node scripts/bikin-inti.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const AKAR = join(dirname(fileURLToPath(import.meta.url)), '..');
const sumber = readFileSync(join(AKAR, 'gas', 'Code.gs'), 'utf8');

// Nama yang disediakan server/gas.mjs di lingkup global. Kalau Code.gs
// mendeklarasikan nama yang sama, tiruan tidak akan pernah terpakai.
const DISEDIAKAN = [
  'Utilities', 'PropertiesService', 'CacheService', 'LockService', 'Session',
  'ScriptApp', 'ContentService', 'HtmlService', 'SpreadsheetApp', 'DriveApp',
  'UrlFetchApp', 'Logger', 'tautanMedia_', 'polaMedia_',
  'Buffer', 'process', 'require', 'module', 'exports', 'global', 'globalThis',
];
const bertabrakan = DISEDIAKAN.filter((nama) =>
  new RegExp(`^(?:const|let|var)\\s+${nama}\\b|^function\\s+${nama}\\b`, 'm').test(sumber));
if (bertabrakan.length) {
  console.error('Code.gs mendeklarasikan nama yang sudah dipakai lapisan port:\n- ' + bertabrakan.join('\n- '));
  process.exit(1);
}

const GANTI = [
  // Unggahan baru: foto galeri/artikel dan media feed.
  {
    nama: 'tautan unggahan media',
    pola: /'https:\/\/drive\.usercontent\.google\.com\/download\?id='\s*\+\s*file\.getId\(\)\s*\+\s*'&export=view&authuser=0'/g,
    keluaran: 'tautanMedia_(file.getId())',
    harus: 2,
  },
  // Baris lama masih menunjuk berkas Drive yang benar-benar ada, jadi
  // normalisasi ini dibiarkan utuh. Diperiksa supaya pergeseran terlihat.
  {
    nama: 'normalisasi tautan Drive lama',
    pola: /'https:\/\/drive\.usercontent\.google\.com\/download\?id=' \+ cocok\[1\] \+ '&export=view&authuser=0'/g,
    keluaran: null,
    harus: 1,
  },
  // Penyaring gambar umpan hanya mengenali tautan Drive. Berkas baru tersimpan
  // di Storage, jadi polanya diambil dari lapisan port.
  {
    nama: 'penyaring tautan media umpan',
    pola: /\/\^https:\\\/\\\/drive\\\.usercontent\\\.google\\\.com\\\/download\\\?id=\[A-Za-z0-9_-\]\{10,\}\//,
    keluaran: 'polaMedia_()',
    harus: 1,
  },
];

let isi = sumber;
const salah = [];
for (const { nama, pola, keluaran, harus } of GANTI) {
  const ketemu = isi.match(pola);
  const jumlah = ketemu ? ketemu.length : 0;
  if (jumlah !== harus) {
    salah.push(`${nama}: ditemukan ${jumlah}, seharusnya ${harus}`);
    continue;
  }
  if (keluaran) isi = isi.replace(pola, keluaran);
}
if (salah.length) {
  console.error('Pola port tidak cocok dengan Code.gs:\n- ' + salah.join('\n- '));
  console.error('Sunting scripts/bikin-inti.mjs bersama perubahan di Code.gs.');
  process.exit(1);
}

const jumlahFungsi = (isi.match(/^function [A-Za-z_$][\w$]*\(/gm) || []).length;
const keluar = `// Dibangkitkan oleh scripts/bikin-inti.mjs dari gas/Code.gs - jangan sunting manual.
// Muat server/gas.mjs dan panggil pasang() sebelum berkas ini di-require.
// Sengaja tanpa "use strict": Apps Script menjalankan kode ini dalam mode
// sloppy, dan beberapa fungsi mengandalkan perilaku itu.

${isi.replace(/\s+$/, '\n')}
module.exports = { doPost, doGet, health_, BACKEND_VERSION, jumlahFungsi: ${jumlahFungsi} };
`;

writeFileSync(join(AKAR, 'server', 'inti.cjs'), keluar);
console.log(`server/inti.cjs: ${keluar.split('\n').length - 1} baris, ${jumlahFungsi} fungsi, ${GANTI.length} pola diperiksa.`);
