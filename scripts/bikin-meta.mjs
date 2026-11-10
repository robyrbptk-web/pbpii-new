// Bangkitkan server/meta.mjs dari dua sumber yang sudah ada: SHEET_SCHEMA di
// gas/Code.gs dan daftar kolom di seluruh migrasi Supabase (0001 membuka
// tabelnya, berikutnya menambah kolom). Kalau ada header sheet yang tidak
// punya kolom, generator berhenti dengan pesan — jadi pemetaan tidak pernah
// bisa diam-diam tertinggal.
//
//   node scripts/bikin-meta.mjs

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { TABEL, GANTI, keSnake } from '../server/peta.mjs';

const AKAR = join(dirname(fileURLToPath(import.meta.url)), '..');
const gs = readFileSync(join(AKAR, 'gas/Code.gs'), 'utf8');
const BERKAS_MIGRASI = readdirSync(join(AKAR, 'supabase', 'migrations'))
  .filter((nama) => nama.endsWith('.sql'))
  .sort();
const migrasi = BERKAS_MIGRASI.map((nama) => ({
  nama,
  sql: readFileSync(join(AKAR, 'supabase', 'migrations', nama), 'utf8'),
}));

function konstanta(nama) {
  const mulai = gs.indexOf(`const ${nama} = {`);
  if (mulai < 0) throw new Error(`${nama} tidak ditemukan.`);
  const akhir = gs.indexOf('\n};', mulai);
  const isi = {};
  const re = /([A-Z0-9_]+)\s*:\s*'([^']*)'/g;
  let m;
  while ((m = re.exec(gs.slice(mulai, akhir)))) isi[m[1]] = m[2];
  return isi;
}

function header(nama) {
  const mulai = gs.indexOf(`const ${nama} = [`);
  if (mulai < 0) throw new Error(`${nama} tidak ditemukan.`);
  const akhir = gs.indexOf(']', mulai);
  return [...gs.slice(mulai, akhir).matchAll(/'([^']*)'/g)].map((m) => m[1]);
}

const APP = konstanta('APP');

const kolomTabel = {};
const tipeTabel = {};
const pkTabel = {};
for (const { sql } of migrasi) {
  const reTabel = /create table if not exists (\w+) \(([\s\S]*?)\n\);/g;
  let t;
  while ((t = reTabel.exec(sql))) {
    const nama = [];
    const tipe = {};
    let pk = null;
    for (const baris of t[2].split('\n')) {
      const isi = baris.trim().replace(/,$/, '');
      if (!isi || /^--/.test(isi)) continue;
      if (/^(unique|primary key|foreign key|check|constraint)\b/i.test(isi)) continue;
      const [kolom, ...sisa] = isi.split(/\s+/);
      if (!/^[a-z_][a-z0-9_]*$/.test(kolom)) continue;
      nama.push(kolom);
      tipe[kolom] = sisa.join(' ').toLowerCase();
      if (/primary key/.test(isi) || /\b(bigserial|serial)\b/.test(isi)) pk = pk || kolom;
    }
    kolomTabel[t[1]] = nama;
    tipeTabel[t[1]] = tipe;
    pkTabel[t[1]] = pk;
  }
}

/* Kolom yang baru datang dari migrasi setelah 0001. Urutan berkas adalah
   urutan penerapan, jadi penamaan kolom selalu mengikuti keadaan database. */
for (const { nama, sql } of migrasi) {
  const reAlter = /^\s*alter table (\w+) add column (?:if not exists )?(\w+)\s+([a-z][a-z0-9_]*(?:\([0-9,]+\))?)/gim;
  let a;
  while ((a = reAlter.exec(sql))) {
    const [, tabel, kolom, tipe] = a;
    if (!kolomTabel[tabel]) {
      console.error(`${nama}: menambah kolom di tabel ${tabel} yang tidak dikenal.`);
      process.exit(1);
    }
    if (!kolomTabel[tabel].includes(kolom)) kolomTabel[tabel].push(kolom);
    tipeTabel[tabel][kolom] = tipe.toLowerCase();
  }
}
if (Object.values(pkTabel).some((pk) => !pk)) {
  console.error('Ada tabel tanpa kunci utama:', Object.entries(pkTabel).filter(([, pk]) => !pk).map(([n]) => n));
  process.exit(1);
}

const reSkema = /\[\s*APP\.SHEET_[A-Z_]+\s*,\s*([A-Z_]+)\s*\]/g;
const mulaiSkema = gs.indexOf('const SHEET_SCHEMA = [');
const akhirSkema = gs.indexOf('\n];', mulaiSkema);
const pasangan = [...gs.slice(mulaiSkema, akhirSkema).matchAll(reSkema)].map((m) => m[1]);

const reNama = /\[\s*(APP\.SHEET_[A-Z_]+)\s*,/g;
const namaSheet = [...gs.slice(mulaiSkema, akhirSkema).matchAll(reNama)].map((m) => APP[m[1].split('.')[1]]);
if (namaSheet.length !== pasangan.length) throw new Error('SHEET_SCHEMA tidak seimbang.');

const salah = [];
const meta = {};
namaSheet.forEach((sheet, i) => {
  const tabel = TABEL[sheet];
  if (!tabel) {
    salah.push(`${sheet}: tabel tujuan belum didaftarkan di server/peta.mjs`);
    return;
  }
  const kolom = kolomTabel[tabel];
  const tipe = tipeTabel[tabel];
  if (!kolom) {
    salah.push(`${sheet}: tabel ${tabel} tidak ada di migrasi`);
    return;
  }
  const headers = header(pasangan[i]);
  const peta = headers.map((h) => {
    const usul = [keSnake(h), GANTI[h]].filter(Boolean);
    const ketemu = usul.find((c) => kolom.includes(c));
    if (!ketemu) salah.push(`${sheet}.${h}: tidak ada kolom di ${tabel}`);
    return ketemu || null;
  });
  const pk = pkTabel[tabel];
  const ambil = [...new Set([pk, ...peta.filter(Boolean), 'seq'])];
  meta[sheet] = {
    tabel,
    headers,
    peta,
    pk,
    tipe: peta.map((c) => (c ? tipe[c] || 'text' : null)),
    ambil,
  };
});

if (salah.length) {
  console.error('Pemetaan belum lengkap:\n- ' + salah.join('\n- '));
  process.exit(1);
}

const isi = `// Dibangkitkan oleh scripts/bikin-meta.mjs - jangan sunting manual.
export const META = ${JSON.stringify(meta, null, 2)};

export const TABEL_KE_SHEET = Object.fromEntries(
  Object.entries(META).map(([sheet, m]) => [m.tabel, sheet]),
);

export function lembar(namaSheet) {
  const m = META[namaSheet];
  if (!m) throw new Error('Lembar tidak dikenal: ' + namaSheet);
  return m;
}
`;
writeFileSync(join(AKAR, 'server/meta.mjs'), isi);
console.log(`${Object.keys(meta).length} sheet terpetakan bersih.`);
for (const [sheet, m] of Object.entries(meta)) {
  console.log(`  ${sheet.padEnd(15)} -> ${m.tabel.padEnd(17)} ${m.headers.length} kolom`);
}
