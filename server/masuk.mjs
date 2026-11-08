// Pintu masuk backend hasil pemindahan.
//
// Bentuknya sengaja sama dengan Web App Apps Script: satu permintaan POST
// masuk ke doPost(event), satu balikan JSON keluar. Di antaranya hanya ada
// pembukaan sesi lembar (agar tulisan di tengah aksi terkumpul dan dikirim
// sekali) dan pemasangan tiruan layanan Google.
//
// Tidak ada keputusan bisnis di berkas ini. Semuanya hidup di server/inti.cjs
// yang dibangkitkan dari gas/Code.gs.
import { createRequire } from 'node:module';
import { pasang } from './gas.mjs';
import { bukaSesi, simpanSesi, tutupSesi } from './lembar.mjs';

const require = createRequire(import.meta.url);

let inti = null;

/** Tiruan dipasang lebih dulu supaya inti.cjs menemukan nama globalnya. */
function muat() {
  if (inti) return inti;
  pasang();
  inti = require('./inti.cjs');
  return inti;
}

function teksBalikan(keluaran) {
  if (typeof keluaran === 'string') return keluaran;
  if (keluaran && typeof keluaran.__teks === 'string') return keluaran.__teks;
  if (keluaran && typeof keluaran.getContent === 'function') return String(keluaran.getContent());
  return JSON.stringify(keluaran ?? {});
}

/**
 * Jalankan satu aksi. Kodenya sinkron dari awal sampai akhir, sama seperti
 * Apps Script: satu permintaan memegang kendali penuh atas prosesnya, jadi
 * tidak ada dua aksi yang saling menimpa antrean tulisan.
 */
export function jalankan(badan) {
  const { doPost } = muat();
  bukaSesi();
  let balikan;
  try {
    balikan = doPost({ postData: { contents: JSON.stringify(badan || {}) } });
  } catch (galat) {
    console.error('[inti] doPost:', galat && galat.message);
    return { ok: false, error: 'Layanan data sedang bermasalah. Silakan coba lagi.' };
  }

  let hasil;
  try {
    hasil = JSON.parse(teksBalikan(balikan));
  } catch (galat) {
    console.error('[inti] balikan tidak berbentuk JSON:', teksBalikan(balikan).slice(0, 200));
    return { ok: false, error: 'Layanan data sedang bermasalah. Silakan coba lagi.' };
  }

  try {
    simpanSesi();
  } catch (galat) {
    // Tulian sebagian sudah masuk ke basis data, persis seperti sheets bila
    // permintaan terputus. Balikan dibuat jujur supaya klien tidak mengira
    // seluruh perubahan tersimpan.
    console.error('[inti] simpanSesi:', galat && galat.message);
    return { ok: false, error: 'Perubahan belum sepenuhnya tersimpan. Silakan ulangi.', separuh: true, data: hasil && hasil.ok ? hasil.data : undefined };
  } finally {
    tutupSesi();
  }
  return hasil;
}

/** Status operasional tanpa perlu membungkusnya sebagai permintaan HTTP. */
export function kesehatan() {
  const { health_, BACKEND_VERSION } = muat();
  return { versi: BACKEND_VERSION, ...health_() };
}
