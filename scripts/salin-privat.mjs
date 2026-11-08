// Penerima sementara untuk memindahkan berkas Pustaka privat ke Storage.
//
//   node scripts/salin-privat.mjs            # mendengarkan di 127.0.0.1:8787
//
// Berkas Pustaka tidak pernah dibagikan lewat tautan, jadi skrip di terminal
// tidak bisa mengunduhnya sendiri tanpa kredensial Drive. Yang bisa membacanya
// adalah sesi admin yang sudah masuk di situs: /api/pii?pdf=<id>&doc=<doc>
// mengalirkan berkas asli bersama header X-PII-Sesi. Karena itu transfernya
// dijalankan dari dalam halaman admin (token sesi tidak pernah keluar dari
// browser) dan byte hasilnya diserahkan ke penerima ini.
//
// Penerima hanya mengikat 127.0.0.1 dan hanya menerima Origin situs PII, jadi
// tidak bisa dipakai dari jaringan maupun dari halaman web lain.
//
//   GET  /daftar   -> dokumen yang belum punya objek di emberas pustaka
//   POST /terima?doc=<id>&id=<driveId>&nama=<berkas>  (badan: byte PDF asli)

import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { db, dasar, kepalaDasar } from '../server/supa.mjs';

for (const nama of ['.env.local', '.env']) {
  if (!existsSync(nama)) continue;
  for (const baris of readFileSync(nama, 'utf8').split(/\r?\n/)) {
    const cocok = /^([A-Z0-9_]+)=(.*)$/.exec(baris.trim());
    if (cocok && process.env[cocok[1]] === undefined) process.env[cocok[1]] = cocok[2];
  }
}

const PORT = Number(process.env.PORT_SALIN || 8787);
const BATAS = 64 * 1024 * 1024;
const ASAL = new Set([
  'https://pbpii-new.vercel.app',
  'https://pbpii.or.id',
  'https://www.pbpii.or.id',
]);

function asalSah(req) {
  const asal = String(req.headers.origin || '');
  if (ASAL.has(asal)) return asal;
  if (/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(asal)) return asal;
  return '';
}

function json(res, kode, isi) {
  const teks = JSON.stringify(isi);
  res.writeHead(kode, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(teks) });
  res.end(teks);
}

function baris(tabel, kueri) {
  return JSON.parse(db(tabel, { kueri }).teks || '[]');
}

function daftar() {
  const docs = baris('pustaka_berkas', 'select=id,judul,berkas,byte&order=seq.asc.nullslast&limit=500');
  const sudah = new Set(
    baris('berkas', 'select=nama&emberas=eq.pustaka&sampah=is.false&limit=5000').map((s) => String(s.nama))
  );
  return docs
    .filter((d) => String(d.berkas || '') && !sudah.has(String(d.berkas)))
    .map((d) => ({ doc: d.id, nama: d.berkas, judul: d.judul, byte: Number(d.byte) || 0 }));
}

async function bacaBadan(req) {
  const potong = [];
  let total = 0;
  for await (const bagian of req) {
    total += bagian.length;
    if (total > BATAS) throw new Error('Berkas terlalu besar.');
    potong.push(bagian);
  }
  return Buffer.concat(potong);
}

const server = createServer(async (req, res) => {
  const asal = asalSah(req);
  if (asal) {
    res.setHeader('Access-Control-Allow-Origin', asal);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    // Chrome meminta izin khusus sebelum halaman publik boleh menyentuh 127.0.0.1.
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    res.setHeader('Access-Control-Max-Age', '600');
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(asal ? 204 : 403);
    return res.end();
  }
  if (!asal) return json(res, 403, { ok: false, error: 'Origin tidak diizinkan.' });

  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  try {
    if (req.method === 'GET' && url.pathname === '/daftar') {
      const antre = daftar();
      console.log(`Daftar diminta: ${antre.length} dokumen belum tersalin.`);
      return json(res, 200, { ok: true, data: antre });
    }

    if (req.method === 'POST' && url.pathname === '/terima') {
      const doc = String(url.searchParams.get('doc') || '').slice(0, 60);
      const id = String(url.searchParams.get('id') || '');
      if (!/^[A-Za-z0-9_-]{10,128}$/.test(id)) throw new Error('Id berkas tidak sah.');
      const cocok = baris('pustaka_berkas', `select=id,judul,berkas,byte&id=eq.${encodeURIComponent(doc)}&limit=1`)[0];
      if (!cocok) throw new Error('Dokumen tidak dikenal.');

      const bytes = await bacaBadan(req);
      // Relay yang gagal menjawab dengan halaman HTML, bukan berkas; jangan
      // sampai halaman galat itu tersimpan sebagai buku.
      if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('Isi bukan PDF.');

      const nama = String(cocok.berkas);
      // Unggah lewat fetch biasa, bukan kanal I/O sinkron: base64 buku 14 MB
      // lebih besar daripada kanal permintaan yang dipakai backend.
      const unggah = await fetch(`${dasar()}/storage/v1/object/pustaka/${encodeURIComponent(id)}`, {
        method: 'POST',
        headers: { ...kepalaDasar(), 'Content-Type': 'application/pdf', 'x-upsert': 'true' },
        body: bytes,
        signal: AbortSignal.timeout(180000),
      });
      if (!unggah.ok) throw new Error(`unggah ${unggah.status}: ${(await unggah.text()).slice(0, 160)}`);
      db('berkas', {
        metode: 'POST',
        badan: { id, emberas: 'pustaka', nama, mime: 'application/pdf', publik: false, byte: bytes.length, sampah: false },
        kepala: { Prefer: 'return=minimal,resolution=merge-duplicates' },
      });
      console.log(`  ${doc}: ${Math.round(bytes.length / 1024)} KB -> pustaka/${id} (${nama})`);
      return json(res, 200, { ok: true, data: { doc, id, nama, byte: bytes.length } });
    }

    return json(res, 404, { ok: false, error: 'Alur tidak dikenal.' });
  } catch (galat) {
    console.log(`  GAGAL: ${String(galat.message).slice(0, 200)}`);
    return json(res, 400, { ok: false, error: String(galat.message).slice(0, 200) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Penerima berkas privat siap di http://127.0.0.1:${PORT}`);
  console.log(`${daftar().length} dokumen Pustaka belum tersalin.`);
});