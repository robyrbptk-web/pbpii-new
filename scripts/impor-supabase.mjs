// Pindahkan isi 24 lembar Apps Script ke Supabase.
// Pemetaan header sheet -> kolom tabel ada di bawah; skema dibaca langsung dari
// migrasi 0001 supaya tidak ada daftar kolom yang bisa tertinggal.
//
//   node scripts/impor-supabase.mjs            -> laporan saja (kering)
//   node scripts/impor-supabase.mjs --jalan    -> tulis ke Supabase

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { jalan } from './sb.mjs';

const AKAR = join(dirname(fileURLToPath(import.meta.url)), '..');
const HASIL = process.argv.includes('--jalan');

function envLokal() {
  const lok = join(AKAR, '.env.local');
  if (!existsSync(lok)) return;
  for (const baris of readFileSync(lok, 'utf8').split('\n')) {
    const cocok = baris.match(/^([A-Z0-9_]+)=(.*)$/);
    if (cocok && !process.env[cocok[1]]) process.env[cocok[1]] = cocok[2];
  }
}
envLokal();

const URL_SB = process.env.SUPABASE_URL;
const KUNCI = process.env.SUPABASE_SECRET_KEY;
if (!URL_SB || !KUNCI) throw new Error('SUPABASE_URL / SUPABASE_SECRET_KEY belum ada di .env.local');

const KEPALA = {
  apikey: KUNCI,
  Authorization: `Bearer ${KUNCI}`,
  'Content-Type': 'application/json',
  Prefer: 'return=minimal,resolution=merge-duplicates',
};

// ------------------------------------------------------------------ skema

function bacaSkema() {
  const sql = readFileSync(join(AKAR, 'supabase/migrations/0001_skema_dasar.sql'), 'utf8');
  const tabel = {};
  const re = /create table if not exists (\w+) \(([\s\S]*?)\n\);/g;
  let m;
  while ((m = re.exec(sql))) {
    const kolom = {};
    for (const baris of m[2].split('\n')) {
      const isi = baris.trim().replace(/,$/, '');
      if (!isi || /^--/.test(isi)) continue;
      if (/^(unique|primary key|foreign key|check|constraint)\b/i.test(isi)) continue;
      const [nama, tipe] = isi.split(/\s+/);
      if (!/^[a-z_][a-z0-9_]*$/.test(nama)) continue;
      kolom[nama] = tipe.toLowerCase();
    }
    tabel[m[1]] = kolom;
  }
  return tabel;
}
const SKEMA = bacaSkema();

// Name collisions between sheets and tables that are not a plain rename.
const ATAS = {
  date: 'tanggal_raw',
  location: 'lokasi',
  description: 'deskripsi',
  participants: 'peserta',
  startTime: 'jam_mulai',
  endTime: 'jam_selesai',
  registrationDeadline: 'batas_daftar',
  quota: 'kuota',
  additionalInfo: 'info_tambahan',
  eventId: 'target_id',
  profilPada: 'profil_on',
};

const DAFTAR = [
  ['Settings', 'settings', ['key', 'value']],
  ['Orgs', 'orgs'],
  ['Standards', 'standards'],
  ['Kaders', 'kader'],
  ['Articles', 'articles'],
  ['Gallery', 'gallery'],
  ['Activities', 'activities'],
  ['Forms', 'forms'],
  ['Participants', 'participants'],
  ['Letters', 'letters'],
  ['Sessions', 'sessions'],
  ['Posts', 'posts'],
  ['PostMedia', 'post_media'],
  ['Reactions', 'reactions'],
  ['Comments', 'comments'],
  ['Follows', 'follows'],
  ['Bookmarks', 'bookmarks'],
  ['Stories', 'stories'],
  ['Threads', 'threads'],
  ['PustakaBerkas', 'pustaka_berkas'],
  ['Fakta', 'fakta'],
  ['Notifikasi', 'notifikasi'],
  ['Chat', 'chat_log'],
];

const SERIAL = new Set(['chat_log', 'pustaka_potongan']);

// ------------------------------------------------------------------ sumber

function hampere(v) {
  return v && typeof v === 'object' && 'v' in v ? v.v : null;
}

function bacaLembar(nama, kepalaPaksa) {
  // File .rows.json ditulis ulang dari rentang sel yang pasti karena gviz pernah
  // menelan beberapa baris Settings ke dalam label kolomnya.
  const rapi = join(AKAR, 'tmp-migrasi', `${nama}.rows.json`);
  if (existsSync(rapi)) {
    const j = JSON.parse(readFileSync(rapi, 'utf8'));
    return { kepala: j.kepala.map((x) => String(x ?? '').trim()), baris: j.baris };
  }
  const lok = join(AKAR, 'tmp-migrasi', `${nama}.gviz.json`);
  const teks = readFileSync(lok, 'utf8');
  const tabel = JSON.parse(teks.slice(teks.indexOf('{'), teks.lastIndexOf('}') + 1)).table;
  const semua = (tabel.rows || []).map((r) => (r.c || []).map(hampere));
  const label = (tabel.cols || []).map((c) => c.label || '');
  // gviz menandai baris header sebagai label bila dia mengenalnya. Bila label
  // kosong, baris pertama masih ikut terbawa dan harus dipotong sendiri.
  const pakaiLabel = label.length > 0 && label.every((x) => x);
  const kepala = (kepalaPaksa || (pakaiLabel ? label : semua[0]) || []).map((x) => String(x ?? '').trim());
  const baris = pakaiLabel ? semua : semua.slice(1);
  return { kepala, baris };
}

// ------------------------------------------------------------------ nilai

function keSnake(nama) {
  return String(nama)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();
}

function bersihkan(nama, nilai, tipe, lapor) {
  const teks = String(nilai ?? '').trim();
  if (teks === '') return undefined;
  if (/^(boolean)$/.test(tipe)) {
    if (/^(true|1|yes)$/i.test(teks)) return true;
    if (/^(false|0|no)$/i.test(teks)) return false;
    lapor(`boolean "${teks}" pada ${nama} dilewati`);
    return undefined;
  }
  if (/^(integer|bigint|numeric|double)/.test(tipe)) {
    const angka = Number(teks.replace(/,/g, ''));
    if (!Number.isFinite(angka)) {
      lapor(`angka "${teks}" pada ${nama} dilewati`);
      return undefined;
    }
    return angka;
  }
  if (/^jsonb$/.test(tipe)) {
    try {
      return JSON.parse(teks);
    } catch {
      lapor(`bukan json di ${nama}: ${teks.slice(0, 60)}`);
      return undefined;
    }
  }
  if (/^(timestamptz|date)$/.test(tipe)) {
    if (/^\d{13}$/.test(teks)) return new Date(Number(teks)).toISOString();
    if (/^\d{4}-\d{2}-\d{2}$/.test(teks) && tipe === 'date') return teks;
    if (/^\d{4}-\d{2}-\d{2}[T ]/.test(teks)) return tipe === 'date' ? teks.slice(0, 10) : teks.replace(' ', 'T');
    if (tipe === 'date' && /^\d{1,2}[-/]\d{1,2}[-/]\d{4}$/.test(teks)) return `${teks.slice(-4)}-${teks.slice(3, 5)}-${teks.slice(0, 2)}`;
    return teks;
  }
  return teks;
}

// ------------------------------------------------------------------ tulis

async function kirim(tabel, baris, upsert) {
  const r = await fetch(`${URL_SB}/rest/v1/${tabel}`, {
    method: 'POST',
    headers: { ...KEPALA, Prefer: upsert ? 'return=minimal,resolution=merge-duplicates' : 'return=minimal' },
    body: JSON.stringify(baris),
  });
  const teks = await r.text();
  if (r.status >= 300 && r.status !== 201 && r.status !== 204) {
    throw new Error(`${r.status} ${teks.slice(0, 400)}`);
  }
}

async function kirimPerbaris(tabel, baris, upsert, catatan) {
  for (const satu of baris) {
    try {
      await kirim(tabel, [satu], upsert);
    } catch (e) {
      const kunci = Object.entries(satu).slice(0, 2).map(([k, v]) => `${k}=${v}`).join(' ');
      catatan.push(`${tabel}: ${kunci} -> ${String(e.message).slice(0, 160)}`);
    }
  }
}

function potong(baris, n = 50) {
  // PostgREST menolak satu batch bila kunci objeknya tidak seragam, jadi
  // baris dikelompokkan dulu menurut tanda tangan kolomnya.
  const gugus = new Map();
  for (const satu of baris) {
    const tanda = Object.keys(satu).sort().join('|');
    if (!gugus.has(tanda)) gugus.set(tanda, []);
    gugus.get(tanda).push(satu);
  }
  const out = [];
  for (const kelompok of gugus.values()) {
    for (let i = 0; i < kelompok.length; i += n) out.push(kelompok.slice(i, i + n));
  }
  return out;
}

// ------------------------------------------------------------------ jalan

const laporan = [];
const gagal = [];
function lapor(pesan) {
  if (!laporan.includes(pesan)) laporan.push(pesan);
}

const ringkas = [];
for (const [sheet, tabel, kepalaPaksa] of DAFTAR) {
  const kolom = SKEMA[tabel];
  if (!kolom) throw new Error(`Tabel ${tabel} tidak ada di skema.`);
  const { kepala: pakai, baris } = bacaLembar(sheet, kepalaPaksa);
  const takTerpeta = [];
  const siap = [];
  for (const [nomor, satu] of baris.entries()) {
    if (satu.every((v) => String(v ?? '').trim() === '')) continue;
    const obj = { seq: nomor + 1 };
    pakai.forEach((nama, i) => {
      const usul = [keSnake(nama), ATAS[nama]].filter(Boolean);
      const kolomNama = usul.find((c) => kolom[c]);
      if (!kolomNama) {
        if (!takTerpeta.includes(nama)) takTerpeta.push(nama);
        return;
      }
      const nilai = bersihkan(`${tabel}.${kolomNama}`, satu[i], kolom[kolomNama], lapor);
      if (nilai !== undefined) obj[kolomNama] = nilai;
    });
    if (tabel === 'activities' && obj.tanggal_raw && /^\d{4}-\d{2}-\d{2}$/.test(String(obj.tanggal_raw))) {
      obj.tanggal = obj.tanggal_raw;
    }
    if (Object.keys(obj).length > 1) siap.push(obj);
  }
  ringkas.push({ sheet, tabel, sumber: baris.length, masuk: siap.length, upsert: !SERIAL.has(tabel), takTerpeta });
  if (!HASIL) continue;
  if (SERIAL.has(tabel)) {
    const kosong = await fetch(`${URL_SB}/rest/v1/${tabel}?id=gt.0`, { method: 'DELETE', headers: KEPALA });
    if (kosong.status >= 300) lapor(`${tabel}: gagal mengosongkan tabel (${kosong.status})`);
  }
  for (const bagian of potong(siap)) {
    try {
      await kirim(tabel, bagian, !SERIAL.has(tabel));
    } catch (e) {
      lapor(`${tabel}: batch gagal (${String(e.message).slice(0, 120)}), diulang per baris`);
      await kirimPerbaris(tabel, bagian, !SERIAL.has(tabel), gagal);
    }
  }
}

// Korpus Pustaka berasal dari berkas hasil ekstraksi PDF, bukan dari gviz.
async function imporPotongan() {
  const lok = 'C:/Users/ADVAN/Documents/pbpii-app/pustaka-out/pustaka.json';
  if (!existsSync(lok)) {
    lapor(`Korpus ${lok} tidak ditemukan - pustaka_potongan dilewati.`);
    return { sheet: 'pustaka.json', tabel: 'pustaka_potongan', sumber: 0, masuk: 0 };
  }
  const korpus = JSON.parse(readFileSync(lok, 'utf8'));
  const siap = korpus.chunks.map((c, i) => {
    const halaman = Number((c.h || [])[0] || 0) || 0;
    const akhir = Number((c.h || [])[1] || 0) || 0;
    return { seq: i + 1, doc: c.d, halaman, halaman_akhir: akhir, bab: String(c.b || ''), teks: String(c.t || '') };
  });
  const n = { sheet: 'pustaka.json', tabel: 'pustaka_potongan', sumber: korpus.chunks.length, masuk: siap.length };
  ringkas.push(n);
  if (!HASIL) return n;
  await fetch(`${URL_SB}/rest/v1/pustaka_potongan?id=gt.0`, { method: 'DELETE', headers: KEPALA });
  for (const bagian of potong(siap, 25)) {
    try {
      await kirim('pustaka_potongan', bagian, false);
    } catch (e) {
      lapor(`pustaka_potongan: batch gagal (${String(e.message).slice(0, 120)}), diulang per baris`);
      await kirimPerbaris('pustaka_potongan', bagian, false, gagal);
    }
  }
  return n;
}
await imporPotongan();

// Baris baru dari backend mengambil seq dari sequence tabel, jadi sequence itu
// harus dilepas di atas seq tertinggi hasil impor.
async function selaraskanSeq() {
  const daftar = [...new Set([...DAFTAR.map(([, t]) => t), 'pustaka_potongan'])];
  for (const t of daftar) {
    await jalan(
      `select setval(pg_get_serial_sequence('${t}', 'seq'), coalesce((select max(seq) from ${t}), 0) + 1, false) as ${t}`,
    );
  }
}
if (HASIL) {
  try {
    await selaraskanSeq();
  } catch (e) {
    lapor(`penyelarasan seq gagal: ${String(e.message).slice(0, 200)}`);
  }
}

console.log('mode:', HASIL ? 'TULIS' : 'KERING');
for (const r of ringkas) {
  console.log(
    `${r.sheet.padEnd(14)} -> ${r.tabel.padEnd(16)} ${String(r.sumber).padStart(4)} baris, ${String(r.masuk).padStart(4)} siap` +
      (r.takTerpeta && r.takTerpeta.length ? ` | header tak dikenal: ${r.takTerpeta.join(', ')}` : ''),
  );
}
if (laporan.length) console.log('\nCatatan:\n- ' + laporan.join('\n- '));
if (gagal.length) console.log('\nBaris gagal:\n- ' + gagal.join('\n- '));
