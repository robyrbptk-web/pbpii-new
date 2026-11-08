// Satu jalur keluar ke Supabase untuk lapisan lembar, berkas, dan properties.
// Semua permintaan jalan sinkron lewat kanal I/O supaya kode hasil pemindahan
// dari Apps Script tidak perlu diubah menjadi async.
import * as io from './io.mjs';

export const dasar = () => String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
export const kunci = () => process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export function kepalaDasar(tambahan = {}) {
  const k = kunci();
  return {
    apikey: k,
    Authorization: `Bearer ${k}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...tambahan,
  };
}

/**
 * Panggil REST Supabase dan tunggu jawabannya. `binari` untuk unduhan berkas,
 * `badanB64` untuk unggahan berkas.
 */
export function rest(alur, { kueri = '', metode = 'GET', badan, badanB64, kepala = {}, binari = false, tenggang = 30000 } = {}) {
  const k = kunci();
  if (!dasar() || !k) throw new Error('Konfigurasi Supabase belum lengkap.');
  const hasil = io.panggil({
    url: `${dasar()}/${alur}${kueri ? `?${kueri}` : ''}`,
    metode,
    kepala: kepalaDasar(kepala),
    badan: badan === undefined ? undefined : JSON.stringify(badan),
    badanB64,
    binari,
    tenggang,
  });
  if (hasil.status >= 300) {
    const ringkas = binari
      ? `(binari ${hasil.b64 ? Math.round((hasil.b64.length * 3) / 4 / 1024) : 0} KB)`
      : String(hasil.teks || '').slice(0, 300);
    throw new Error(`${metode} ${alur} -> ${hasil.status} ${ringkas}`);
  }
  return hasil;
}

/** Selubung PostgREST: alurnya selalu dimulai dari rest/v1. */
export function db(tabel, opsi = {}) {
  return rest(`rest/v1/${tabel}`, opsi);
}

/** Selubung Storage: unduh, unggah, atau hapus satu objek. */
export function simpan(aksi, emberas, jalur, { mime = 'application/octet-stream', badanB64, kepala = {}, rentang, tenggang } = {}) {
  const path = `storage/v1/object/${encodeURIComponent(emberas)}/${String(jalur).split('/').map(encodeURIComponent).join('/')}`;
  return rest(path, {
    metode: aksi,
    kepala: {
      'Content-Type': mime,
      'x-upsert': 'true',
      ...(rentang ? { Range: `bytes=${rentang.mulai}-${rentang.sampai}` } : {}),
      ...kepala,
    },
    badanB64,
    binari: aksi === 'GET',
    tenggang,
  });
}

export function bytesKeB64(bytes) {
  return Buffer.from([...bytes].map((n) => (n + 256) % 256)).toString('base64');
}

/** Base64 -> daftar byte bertanda seperti hasil Utilities.base64Decode. */
export function b64KeBytes(b64) {
  return [...Buffer.from(String(b64 || ''), 'base64')].map((n) => (n > 127 ? n - 256 : n));
}
