// Paritas backend: jalankan aksi baca yang sama di Apps Script yang masih tayang
// dan di backend hasil pemindahan (Supabase), lalu bandingkan isinya.
//
//   node scripts/uji-paritas.mjs
//   node scripts/uji-paritas.mjs public feedList
//
// Hanya aksi baca tanpa token yang dipakai, jadi skrip ini tidak mengubah satu
// baris pun di kedua sisi. Selisih pada nilai yang memang berubah-ubah (stempel
// waktu, versi, jatah kuota) diabaikan dan dicatat sebagai "dinamis".

import fs from 'node:fs';
import { DEFAULT_GAS_WEB_APP_URL } from '../api/pii.js';

for (const nama of ['.env.local', '.env']) {
  if (!fs.existsSync(nama)) continue;
  for (const baris of fs.readFileSync(nama, 'utf8').split(/\r?\n/)) {
    const cocok = /^([A-Z0-9_]+)=(.*)$/.exec(baris.trim());
    if (cocok && process.env[cocok[1]] === undefined) process.env[cocok[1]] = cocok[2];
  }
}
process.env.PBPII_BACKEND = 'supabase';
process.env.SPREADSHEET_ID = process.env.SPREADSHEET_ID || 'pbpii';

const GAS_URL = process.env.GAS_WEB_APP_URL || DEFAULT_GAS_WEB_APP_URL;
const { jalankan } = await import('../server/masuk.mjs');
const { tutup } = await import('../server/io.mjs');

const DAFTAR = [
  { action: 'public' },
  { action: 'orgLookup' },
  { action: 'captcha' },
  { action: 'whoami' },
  { action: 'feedList', tab: 'untuk-anda' },
  { action: 'pustakaList' },
  { action: 'pustakaCari', q: 'kaderisasi', batas: 3 },
  { action: 'kaderProfil', id: 'kader-rozak' },
  { action: 'publicForm', id: 'form-lk-open' },
  { action: 'chatStatus' },
];

const DINAMIS = new Set([
  'versi', 'version', 'diperiksa', 'waktu', 'dibuat', 'now', 'tanggalCek',
  'sisaKuota', 'kuotaSisa', 'sisa', 'batas', 'terpakai', 'jumlah', 'total',
  'masalah', 'message', 'siap', 'spreadsheetId',
]);

function ringkas(nilai) {
  const teks = typeof nilai === 'string' ? nilai : JSON.stringify(nilai);
  return String(teks).length > 90 ? String(teks).slice(0, 90) + '…' : teks;
}

/** Kumpulkan beda menjadi daftar alur supaya keluaran mudah dibaca. */
function beda(a, b, alur, keluar, dinamis) {
  if (a === b) return;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    if (Array.isArray(a) !== Array.isArray(b)) {
      keluar.push({ alur, a: ringkas(a), b: ringkas(b) });
      return;
    }
    const kunci = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of kunci) {
      if (DINAMIS.has(k)) { dinamis.push(`${alur}.${k}`); continue; }
      if (Array.isArray(a)) {
        if (a.length !== b.length) dinamis.push(`${alur}.panjang(${a.length}≠${b.length})`);
        for (let i = 0; i < Math.max(a.length, b.length); i++) {
          if (i >= a.length || i >= b.length) { keluar.push({ alur: `${alur}[${i}]`, a: a[i] === undefined ? '(tidak ada)' : ringkas(a[i]), b: b[i] === undefined ? '(tidak ada)' : ringkas(b[i]) }); continue; }
          beda(a[i], b[i], `${alur}[${i}]`, keluar, dinamis);
        }
      } else {
        beda(a[k], b[k], `${alur}.${k}`, keluar, dinamis);
      }
    }
    return;
  }
  if (JSON.stringify(a) === JSON.stringify(b)) return;
  keluar.push({ alur, a: ringkas(a), b: ringkas(b) });
}

async function dariGas(badan) {
  const jawaban = await fetch(GAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ ...badan, ip: '203.0.113.90' }),
    signal: AbortSignal.timeout(60_000),
  });
  return JSON.parse(await jawaban.text());
}

const dipilih = process.argv.slice(2);
const aksi = dipilih.length ? DAFTAR.filter((satu) => dipilih.includes(satu.action)) : DAFTAR;

let lulus = 0, gagal = 0;
for (const satu of aksi) {
  let gas, port;
  try {
    gas = await dariGas(satu);
  } catch (galat) {
    console.log(`${satu.action}: GAS tidak terjawab (${String(galat.message).slice(0, 80)}) - dilewati`);
    continue;
  }
  port = jalankan({ ...satu, ip: '203.0.113.90' });
  const keluar = [], dinamis = [];
  beda(gas, port, satu.action, keluar, dinamis);
  if (keluar.length === 0) {
    lulus += 1;
    console.log(`${satu.action}: SAMA${dinamis.length ? ` (${dinamis.length} kunci dinamis diabaikan)` : ''}`);
  } else {
    gagal += 1;
    console.log(`${satu.action}: ${keluar.length} beda (gas | supabase)`);
    for (const satuBeda of keluar.slice(0, 8)) {
      console.log(`   ${satuBeda.alur}\n     gas: ${satuBeda.a}\n     sb : ${satuBeda.b}`);
    }
  }
}

console.log(`\n${lulus} sama, ${gagal} berbeda dari ${aksi.length} aksi.`);
tutup();
process.exitCode = gagal ? 1 : 0;
