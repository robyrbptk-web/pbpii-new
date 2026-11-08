// Isi properti aplikasi yang dulu tinggal di Script Properties Apps Script.
//
//   node scripts/siapkan-properti.mjs                 # hanya penanda basis data
//   PBPII_ADMIN_PASSWORD=... node scripts/siapkan-properti.mjs
//
// Kata sandi admin hanya diterima lewat environment, tidak pernah ditulis ke
// berkas, dicetak, maupun disimpan sebagai teks: yang masuk tabel props adalah
// hash + salt dengan algoritma yang sama persis dengan hashPassword_ di backend.

import { readFileSync, existsSync } from 'node:fs';
import crypto from 'node:crypto';
import { db } from '../server/supa.mjs';

for (const nama of ['.env.local', '.env']) {
  if (!existsSync(nama)) continue;
  for (const baris of readFileSync(nama, 'utf8').split(/\r?\n/)) {
    const cocok = /^([A-Z0-9_]+)=(.*)$/.exec(baris.trim());
    if (cocok && process.env[cocok[1]] === undefined) process.env[cocok[1]] = cocok[2];
  }
}

/** Tiru hashPassword_: 250 putaran SHA-256 hex atas salt + ':' + sandi. */
function hashSandi(sandi, salt) {
  let nilai = `${salt}:${sandi}`;
  for (let i = 0; i < 250; i++) nilai = crypto.createHash('sha256').update(nilai, 'utf8').digest('hex');
  return nilai;
}

function tulis(key, value) {
  db('props', {
    metode: 'POST',
    badan: { key, value },
    kepala: { Prefer: 'return=minimal,resolution=merge-duplicates' },
  });
}

function baca(key) {
  const hasil = db('props', { kueri: `select=value&key=eq.${encodeURIComponent(key)}` });
  const baris = JSON.parse(hasil.teks || '[]');
  return baris.length ? String(baris[0].value) : '';
}

// Lapisan lembar menolak bekerja tanpa penanda ini, sama seperti sheet_() yang
// menuntut SPREADSHEET_ID terisi. Nilainya tidak dipakai untuk membuka apa pun.
if (!baca('SPREADSHEET_ID')) {
  tulis('SPREADSHEET_ID', 'supabase');
  console.log('SPREADSHEET_ID: penanda basis data dipasang.');
} else {
  console.log('SPREADSHEET_ID: sudah ada.');
}

const sandi = process.env.PBPII_ADMIN_PASSWORD || '';
if (!sandi) {
  console.log('PBPII_ADMIN_PASSWORD kosong: akun admin dilewati.');
} else if (sandi.length < 8) {
  console.log('PBPII_ADMIN_PASSWORD kurang dari 8 karakter: akun admin dilewati.');
} else {
  const salt = crypto.randomUUID();
  tulis('ADMIN_USERNAME', 'admin');
  tulis('ADMIN_PASSWORD_HASH', hashSandi(sandi, salt));
  tulis('ADMIN_PASSWORD_SALT', salt);
  db('props', { metode: 'DELETE', kueri: 'key=eq.ADMIN_PASSWORD' });
  console.log('Akun admin: username dipasang, hash + salt baru dibuat.');
}

const keys = JSON.parse(db('props', { kueri: 'select=key&order=key.asc' }).teks).map((x) => x.key);
console.log(`Properti tersimpan (${keys.length}): ${keys.join(', ')}`);