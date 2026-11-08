// Salin berkas Drive lama ke Supabase Storage supaya backend hasil pemindahan
// bisa membaca dan membagikan berkas dengan nama objek = id Drive aslinya.
//
//   node scripts/salin-media.mjs [--kering] [--ulang] [--emberas=media,pustaka,surat]
//
// Berkas media hari ini dibagikan lewat tautan, jadi bisa diunduh tanpa
// kredensial apa pun. Berkas pustaka dan lampiran surat bersifat privat:
// GOOGLE_OAUTH_TOKEN (token editor Apps Script) harus diisi, kalau tidak kedua
// emberas itu dilewati dengan catatan.
//
// Skrip ini idempoten: id yang sudah punya baris di tabel berkas dilewati.

import { readFileSync, existsSync } from 'node:fs';
import { db, simpan, bytesKeB64 } from '../server/supa.mjs';

for (const nama of ['.env.local', '.env']) {
  if (!existsSync(nama)) continue;
  for (const baris of readFileSync(nama, 'utf8').split(/\r?\n/)) {
    const cocok = /^([A-Z0-9_]+)=(.*)$/.exec(baris.trim());
    if (cocok && process.env[cocok[1]] === undefined) process.env[cocok[1]] = cocok[2];
  }
}

const AKAR = { KERING: process.argv.includes('--kering'), ULANG: process.argv.includes('--ulang') };
const EMBERAS_DIMINTA = (() => {
  const cocok = /--emberas=(\S+)/.exec(process.argv.join(' '));
  return cocok ? cocok[1].split(',').map((s) => s.trim()) : ['media', 'pustaka', 'surat'];
})();
const TOKEN = process.env.GOOGLE_OAUTH_TOKEN || '';

/** Sumber id Drive per tabel dan kolom, mengikuti cara kode lama menyimpan tautan. */
const SUMBER = [
  { tabel: 'articles', kolom: 'cover_image', emberas: 'media' },
  { tabel: 'gallery', kolom: 'image_url', emberas: 'media' },
  { tabel: 'activities', kolom: 'cover_image', emberas: 'media' },
  { tabel: 'post_media', kolom: 'url', emberas: 'media' },
  { tabel: 'kader', kolom: 'sampul', emberas: 'media' },
  { tabel: 'settings', kolom: 'value', emberas: 'media', kunci: 'chairmanPhoto' },
  { tabel: 'pustaka_berkas', kolom: 'berkas', emberas: 'pustaka', nama: 'judul' },
  { tabel: 'letters', kolom: 'attachment_id', emberas: 'surat', nama: 'attachment_name' },
];

const POLA_ID = /(?:\?|&)id=([A-Za-z0-9_-]{10,})|(?:\/d\/|files\/)([A-Za-z0-9_-]{10,})/;

function ambilId(nilai) {
  const cocok = POLA_ID.exec(String(nilai || ''));
  return cocok ? (cocok[1] || cocok[2] || '') : '';
}

/**
 * Sebagian unggahan lama tersimpan di Drive sebagai teks byte bertanda
 * ("-1,-40,-1,-32,...") alih-alih berkas asli, jadi browser tidak bisa
 * membacanya walau mime-nya image/jpeg. Pola itu hanya bisa berasal dari satu
 * hal, dan angka-angkanya memulihkan berkas asli secara utuh.
 */
function pulihBytes(bytes) {
  const teks = Buffer.from(bytes).toString('utf8');
  if (!/^(-?\d{1,3},){16,}/.test(teks.slice(0, 4096))) return null;
  const angka = teks.split(',').map(Number);
  if (angka.some((n) => !Number.isInteger(n) || n < -128 || n > 127)) return null;
  return new Uint8Array(angka.map((n) => (n + 256) % 256));
}

function baris(tabel, kueri) {
  const hasil = db(tabel, { kueri });
  return JSON.parse(hasil.teks || '[]');
}

const sudah = new Set(baris('berkas', 'select=id&limit=5000').map((satu) => String(satu.id)));
const antre = new Map();

for (const sumber of SUMBER) {
  if (!EMBERAS_DIMINTA.includes(sumber.emberas)) continue;
  const kolom = sumber.kunci ? 'key,value' : [sumber.kolom, sumber.nama].filter(Boolean).join(',');
  const daftar = baris(sumber.tabel, `select=${kolom}&limit=5000`);
  for (const satu of daftar) {
    const nilai = sumber.kunci
      ? (String(satu.key || '') === sumber.kunci ? satu.value : '')
      : satu[sumber.kolom];
    const id = ambilId(nilai);
    if (!id || (!AKAR.ULANG && sudah.has(id)) || antre.has(id)) continue;
    antre.set(id, {
      id,
      emberas: sumber.emberas,
      nama: String((sumber.nama && satu[sumber.nama]) || id),
      dari: `${sumber.tabel}.${sumber.kolom}`,
    });
  }
}

console.log(`${antre.size} berkas belum ada di Storage (${EMBERAS_DIMINTA.join(', ')}).`);
if (AKAR.KERING) {
  for (const satu of antre.values()) console.log(`  ${satu.emberas}/${satu.id} <- ${satu.dari}`);
  process.exit(0);
}

const privat = [...antre.values()].filter((satu) => satu.emberas !== 'media');
if (privat.length && !TOKEN) {
  console.log(`GOOGLE_OAUTH_TOKEN kosong: ${privat.length} berkas pustaka/surat dilewati.`);
}

let berhasil = 0, gugur = 0;
for (const satu of antre.values()) {
  if (satu.emberas !== 'media' && !TOKEN) continue;
  try {
    const jawaban = await fetch(
      `https://drive.usercontent.google.com/download?id=${encodeURIComponent(satu.id)}&export=view`,
      {
        redirect: 'follow',
        signal: AbortSignal.timeout(60_000),
        headers: satu.emberas === 'media' ? {} : { Authorization: `Bearer ${TOKEN}` },
      }
    );
    if (!jawaban.ok) throw new Error(`unduhan ${jawaban.status}`);
    const mime = String(jawaban.headers.get('content-type') || 'application/octet-stream').split(';')[0];
    if (/text\/html/.test(mime)) throw new Error('Drive menjawab dengan halaman, bukan berkas');
    let bytes = new Uint8Array(await jawaban.arrayBuffer());
    if (!bytes.length) throw new Error('berkas kosong');
    const pulih = pulihBytes(bytes);
    if (pulih) {
      console.log(`  ${satu.id}: teks byte bertanda dipulihkan ${bytes.length} -> ${pulih.length} byte.`);
      bytes = pulih;
    }

    simpan('POST', satu.emberas, satu.id, { mime, badanB64: bytesKeB64(bytes) });
    db('berkas', {
      metode: 'POST',
      badan: {
        id: satu.id,
        emberas: satu.emberas,
        nama: satu.nama || satu.id,
        mime,
        publik: satu.emberas === 'media',
        byte: bytes.length,
        sampah: false,
      },
      kepala: { Prefer: 'return=minimal,resolution=merge-duplicates' },
    });
    berhasil += 1;
    console.log(`  ${satu.emberas}/${satu.id} ${Math.round(bytes.length / 1024)} KB (${mime})`);
  } catch (galat) {
    gugur += 1;
    console.log(`  GAGAL ${satu.id} dari ${satu.dari}: ${String(galat.message).slice(0, 120)}`);
  }
}

console.log(`Selesai: ${berhasil} tersalin, ${gugur} gagal, ${sudah.size} sudah ada sebelumnya.`);
