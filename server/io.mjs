// Saluran I/O sinkron. Kode backend hasil pemindahan dari Apps Script bekerja
// sinkron (rows_, sheet_, DriveApp dipanggil di tengah-tengah logika), sedangkan
// Node hanya punya fetch asinkron. Jalur ini memindahkan fetch ke satu worker
// yang berdiri sendiri: utusan menulis permintaan ke SharedArrayBuffer lalu
// membekukan dirinya dengan Atomics.wait, worker mengerjakan fetch dan membuka
// blokirnya. Perilaku kode inti jadi identik dengan Apps Script, tanpa perlu
// mengubah ribuan baris menjadi async.
import { Worker } from 'node:worker_threads';

// Worker eval selalu diperlakukan sebagai CommonJS. Vercel menjalankan Node
// dengan --no-experimental-detect-module, jadi bentuk ESM di sini mati sebelum
// sempat mengabari utusan dan Atomics.wait menunggu sampai fungsi kedaluwarsa.
const KODE = `
const { workerData } = require('node:worker_threads');
const st = new Int32Array(workerData.status);
const pm = new Uint8Array(workerData.permintaan);
const jb = new Uint8Array(workerData.jawaban);
const encoder = new TextEncoder();
const decoder = new TextDecoder();

// Indeks: 0 = keadaan, 1 = panjang permintaan, 2 = panjang jawaban,
// 3 = galat, 4 = batas waktu permintaan, 5 = nomor permintaan.
(async () => {
for (;;) {
  if (Atomics.load(st, 0) === 1) {
    const panjang = Atomics.load(st, 1);
    const permintaan = JSON.parse(decoder.decode(pm.slice(0, panjang)));
    let keluar;
    let galat = 0;
    try {
      const sinyal = AbortSignal.timeout(Math.max(1000, permintaan.tenggang || 25000));
      const badan = permintaan.badanB64
        ? new Uint8Array(Buffer.from(permintaan.badanB64, 'base64'))
        : permintaan.badan;
      const r = await fetch(permintaan.url, {
        method: permintaan.metode || 'GET',
        headers: permintaan.kepala || {},
        body: badan,
        signal: sinyal,
      });
      const isi = permintaan.binari
        ? { b64: Buffer.from(await r.arrayBuffer()).toString('base64') }
        : { teks: await r.text() };
      keluar = JSON.stringify({
        status: r.status,
        headers: Object.fromEntries(r.headers.entries ? r.headers.entries() : []),
        ...isi,
      });
    } catch (e) {
      galat = 1;
      keluar = JSON.stringify({ pesan: String((e && e.message) || e) });
    }
    const bytes = encoder.encode(keluar);
    if (bytes.length > jb.length) {
      const potong = encoder.encode(JSON.stringify({ pesan: 'Jawaban melebihi kanal I/O.' }));
      jb.set(potong);
      Atomics.store(st, 2, potong.length);
      Atomics.store(st, 3, 1);
    } else {
      jb.set(bytes);
      Atomics.store(st, 2, bytes.length);
      Atomics.store(st, 3, galat);
    }
    Atomics.store(st, 0, 2);
    Atomics.notify(st, 0);
    continue;
  }
  Atomics.wait(st, 0, 0, 2);
}
})();
`;

const BATAS = 24 << 20;
let mulai = null;
let st = null;
let pm = null;
let jb = null;

function pasang() {
  if (mulai) return;
  const status = new SharedArrayBuffer(64);
  // Unggahan gambar 3 MB menjadi base64 di dalam JSON permintaan, jadi kanal
  // permintaan dibuat cukup longgar untuk itu.
  const permintaanBuf = new SharedArrayBuffer(16 << 20);
  const jawabanBuf = new SharedArrayBuffer(BATAS);
  const w = new Worker(KODE, {
    eval: true,
    workerData: { status, permintaan: permintaanBuf, jawaban: jawabanBuf },
  });
  w.on('error', (e) => {
    console.error('worker io mati:', e && e.message);
    // Utusan yang sedang membeku harus dibangunkan dengan galat ini; tanpa itu
    // ia menunggu sampai batas waktu fungsi padahal penyebabnya sudah jelas.
    if (st && jb) {
      const bytes = encoder.encode(JSON.stringify({ pesan: 'Worker I/O: ' + String((e && e.message) || e) }));
      jb.set(bytes);
      Atomics.store(st, 2, bytes.length);
      Atomics.store(st, 3, 1);
      Atomics.store(st, 0, 2);
      Atomics.notify(st, 0);
    }
    mulai = null;
  });
  w.unref();
  mulai = w;
  st = new Int32Array(status);
  pm = new Uint8Array(permintaanBuf);
  jb = new Uint8Array(jawabanBuf);
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Lakukan permintaan HTTP dan tunggu sampai selesai. Sinkron. */
export function panggil(permintaan) {
  pasang();
  const bytes = encoder.encode(JSON.stringify(permintaan));
  if (bytes.length > pm.length) throw new Error('Permintaan melebihi kanal I/O.');
  pm.set(bytes);
  Atomics.store(st, 1, bytes.length);
  Atomics.store(st, 0, 1);
  Atomics.notify(st, 0);
  const hasil = Atomics.wait(st, 0, 1, permintaan.tenggang ? permintaan.tenggang + 10000 : 60000);
  if (hasil === 'timed-out') {
    Atomics.store(st, 0, 0);
    throw new Error('Kanal I/O menunggu terlalu lama.');
  }
  const panjang = Atomics.load(st, 2);
  const teks = decoder.decode(jb.slice(0, panjang));
  if (Atomics.load(st, 3)) {
    Atomics.store(st, 0, 0);
    throw new Error(JSON.parse(teks).pesan || 'I/O gagal.');
  }
  Atomics.store(st, 0, 0);
  return JSON.parse(teks);
}

export function tutup() {
  if (!mulai) return;
  const w = mulai;
  mulai = null;
  w.terminate();
}
