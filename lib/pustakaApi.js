/**
 * Perpustakaan umum untuk Pustaka.
 *
 * Koleksi dibacakan dari Internet Archive: katalog lewat `advancedsearch.php`,
 * metadata lewat `metadata/{id}`, dan isi buku lewat `download/{id}/{berkas}`
 * dengan header Range. Tidak ada kunci API dan tidak ada berkas buku yang ikut
 * tersimpan di repo — proksi ini hanya mengantar teks yang memang bebas baca.
 *
 * Teks hasil pemindaian dirapikan dulu (baris terpotong disambung, penanda
 * halaman dibuang), lalu dipecah menjadi halaman baca supaya sisi depan tidak
 * pernah menelan seluruh buku sekaligus.
 */
import { Readable } from 'node:stream';
import { sendJson } from './proxy.js';

const ARC = 'https://archive.org';
const TIMEOUT = 25000;

/**
 * Keputusan rak dan berkas buku tidak boleh disandera lama di peramban:
 * berkas mana yang dibuka pembaca diambil dari sini, jadi jawaban cukup
 * bertahan semenit meski lalu lintas ke arsip tetap dihaluskan.
 */
const SEGAAR = { 'Cache-Control': 'public, max-age=60' };

/** Batas unduhan satu berkas: di atasnya buku dianggap terlalu panjang. */
const MAX_BYTE = 1_600_000;

/** Ukuran satu halaman baca dalam karakter teks yang sudah dirapikan. */
const HALAMAN = 16_000;

/**
 * Rak yang sudah diuji mengembalikan buku layak baca. `wajib` adalah saring
 * struktur arsip, `kata` topik yang hanya dipakai bila pengunjung tidak
 * mengetik kata kunci sendiri.
 */
const RAK = [
  {
    kunci: 'sastra',
    label: 'Sastra Indonesia',
    wajib: 'language:(indonesian) AND mediatype:(texts)',
    kata: ['novel', 'roman', 'cerita', 'sastra'],
  },
  {
    kunci: 'islam',
    label: 'Keislaman',
    wajib: 'language:(indonesian) AND mediatype:(texts)',
    kata: ['islam', 'fiqh', 'hadis', 'tafsir', 'akhlak'],
  },
  {
    kunci: 'sejarah',
    label: 'Sejarah & Perjuangan',
    wajib: 'language:(indonesian) AND mediatype:(texts)',
    kata: ['sejarah', 'riwayat', 'perjuangan', 'kemerdekaan'],
  },
  {
    kunci: 'pelajar',
    label: 'Ke-Pelajar-an',
    wajib: 'language:(indonesian) AND mediatype:(texts)',
    kata: ['pelajar', 'pendidikan', 'sekolah', 'siswa', 'kurikulum'],
  },
  {
    kunci: 'dunia',
    label: 'Klasik Dunia',
    wajib: 'collection:(gutenberg) AND mediatype:(texts)',
    kata: [],
  },
];

const RAK_BY_KEY = new Map(RAK.map((rak) => [rak.kunci, rak]));

/**
 * Daftar awal tanpa rak dan tanpa kata kunci tetap harus menyaring topik.
 * Tanpa baris ini, hasil yang paling banyak diunduh justru berkas acak
 * seperti formulir scan atau lembar kerja.
 */
const KUERI_BAKU = [
  'language:(indonesian) AND mediatype:(texts)',
  '(novel OR roman OR cerita OR sastra OR kisah OR hikayat OR islam OR sejarah OR pendidikan)',
].join(' AND ');

/** Daftar rak dikirim di setiap jawaban supaya sisi depan tidak menyalinnya. */
export const PUSTAKA_RAK = RAK.map(({ kunci, label }) => ({ kunci, label }));

const BAHASA = {
  ind: 'Bahasa Indonesia',
  indonesian: 'Bahasa Indonesia',
  eng: 'Bahasa Inggris',
  ara: 'Bahasa Arab',
  nld: 'Bahasa Belanda',
  mal: 'Bahasa Melayu',
  san: 'Bahasa Sanskerta',
};

function teks(value) {
  return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '');
}

function potong(value, panjang) {
  const bersih = String(value || '').replace(/\s+/g, ' ').trim();
  return bersih.length > panjang ? `${bersih.slice(0, panjang - 1)}…` : bersih;
}

/**
 * Membersihkan input pengunjung dari sintaks kueri arsip. Sisanya dipecah
 * menjadi kata dan disusun ulang, jadi tidak ada operator yang lolos.
 */
function amankanKueri(input) {
  return teks(input)
    .replace(/[+&|!(){}\[\]^"~*?:\\/]/g, ' ')
    .split(/\s+/)
    .filter((kata) => kata.length > 1)
    .slice(0, 8);
}

function bahasaLabel(value) {
  const kode = teks(value).toLowerCase().replace(/[^a-z]/g, '');
  return BAHASA[kode] || '';
}

/**
 * Pengenal buku dan nama berkas arsip dipakai ulang di URL unduhan, jadi hanya
 * karakter tercetak yang dibolehkan dan `..` ditutup. Nilainya tetap di-encode
 * sebelum masuk URL, sehingga tidak ada jalur atau header yang bocor.
 */
function namaAman(value, panjang) {
  const bersih = String(value || '')
    .trim()
    .replace(/[\u0000-\u001f\u007f]/g, '');
  if (!bersih || bersih.length > panjang) return '';
  if (bersih.includes('..') || bersih.includes('/') || bersih.includes('\\')) return '';
  return bersih;
}

async function unduh(url, header = {}) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT),
    headers: { Accept: 'text/plain;q=0.9, application/json;q=0.5', ...header },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response;
}

// ------------------------------------------------------------------ penataan

/**
 * Teks pemindaian menaruh satu baris buku per baris berkas dan menyelingi
 * nomor halaman. Dipadatkan kembali menjadi paragraf agar enak dibaca di
 * layar ponsel, tempat baris panjang tidak pernah muat.
 */
export function rapikanTeks(raw) {
  const mentah = String(raw || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\f/g, '\n\n')
    // Berkas unduhan Perpustakaan Gutenberg membuka berkas dengan pager lisensi
    // yang hanya boleh dibuang bila memang berada di paling awal berkas.
    .replace(/^\s*\*+[\s\S]{0,90}?PROJECT GUTENBERG[^\n]*\*+\s*\n/, '')
    .replace(/\*\*\*\s*END (?:OF|THE)[\s\S]*?PROJECT GUTENBERG[\s\S]*$/i, '');

  const baris = mentah
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    // Penanda halaman, nomor halaman telanjang, garis pemisah hasil pindai.
    .filter((line) => !/^\s*=*\s*(?:PAGE|HALAMAN)\s*\d*\s*=*\s*$/i.test(line))
    .filter((line) => !/^\s*\d{1,4}\s*$/.test(line))
    .filter((line) => !/^\s*[.\-_—=·•\s]{4,}$/.test(line))
    .filter((line) => !/^\s*\{\s*"lccat"/.test(line))
    .map((line) =>
      line
        .replace(/¬/g, '')
        .replace(/[□▪▫◆◇■]/g, '')
        .replace(/[ \t]{2,}/g, ' '));

  const blok = [];
  let jalan = [];
  for (const line of baris) {
    if (line.trim() === '') {
      if (jalan.length) blok.push(jalan);
      jalan = [];
    } else {
      jalan.push(line.trim());
    }
  }
  if (jalan.length) blok.push(jalan);

  const paragraf = [];
  for (const bagian of blok) {
    const rata = bagian.reduce((total, line) => total + line.length, 0) / bagian.length;
    if (bagian.length > 1 && rata > 38) {
      const utuh = bagian
        .join(' ')
        .replace(/-\s+/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (utuh) paragraf.push(utuh);
    } else {
      for (const line of bagian) {
        const bersih = line.replace(/\s+/g, ' ').trim();
        if (bersih) paragraf.push(bersih);
      }
    }
  }
  return paragraf;
}

/**
 * Perbandingan huruf wajar pada awal buku. Berkas beraksara Arab yang gagal
 * dipindai menghasilkan tumpukan simbol, jadi pembaca perlu memperingatkan
 * pengunjungnya alih-alih menyajikan sampah tanpa penjelasan.
 */
export function nilaiKerapian(paragraf) {
  const contoh = paragraf.slice(0, 12).join(' ').slice(0, 4000);
  // Sampel terlalu pendek untuk dituduh sampah: anggap terbaca.
  if (contoh.length < 500) return 1;
  const huruf = (contoh.match(/\p{L}/gu) || []).length;
  const kata = (contoh.match(/\p{L}{2,}/gu) || []).length;
  const rasio = huruf / contoh.length;
  if (rasio > 0.6 && kata > 60) return 1;
  return rasio > 0.42 ? 0.5 : 0;
}

function pecahHalaman(paragraf) {
  const halaman = [];
  let isi = [];
  let ukuran = 0;
  for (const para of paragraf) {
    if (ukuran + para.length + 2 > HALAMAN && isi.length) {
      halaman.push(isi);
      isi = [];
      ukuran = 0;
    }
    isi.push(para);
    ukuran += para.length + 2;
  }
  if (isi.length) halaman.push(isi);
  return halaman;
}

// ---------------------------------------------------------------------- cache

/**
 * Isi buku tidak pernah berubah, jadi cukup disimpan satu jam di instans
 * hangat. Dibatasi beberapa judul: satu buku penuh bisa 1,5 MB teks.
 */
const buku = new Map();
const BATAS_BUKU = 6;

async function bacaBerkas(id, namaBerkas) {
  const kunci = `${id}::${namaBerkas}`;
  const tersimpan = buku.get(kunci);
  if (tersimpan && Date.now() - tersimpan.at < 3_600_000) return tersimpan;

  const response = await unduh(
    `${ARC}/download/${encodeURIComponent(id)}/${encodeURIComponent(namaBerkas)}`,
    { Range: `bytes=0-${MAX_BYTE - 1}` },
  );
  if (!response) throw new Error('berkas tidak ditemukan');
  const mentah = await response.text();

  // Rentang jawabannya "bytes 0-1599999/1997000"; tanpa rentang, berkas utuh.
  const rentang = response.headers.get('content-range');
  const ukuranPenuh = rentang ? Number(rentang.split('/')[1]) || mentah.length : mentah.length;

  const paragraf = rapikanTeks(mentah);
  const nilai = {
    at: Date.now(),
    halaman: pecahHalaman(paragraf),
    mutu: nilaiKerapian(paragraf),
    terpotong: ukuranPenuh > MAX_BYTE,
  };
  buku.set(kunci, nilai);
  if (buku.size > BATAS_BUKU) {
    const tertua = [...buku.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (tertua) buku.delete(tertua[0]);
  }
  return nilai;
}

// -------------------------------------------------------------------- handler

/** `/api/pustaka/cari?q=&rahang=&halaman=&batas=` — katalog rak dan penelusuran. */
export async function pustakaCariHandler(req, res) {
  const query = req.query || {};
  const kata = amankanKueri(query.q);
  const rak = RAK_BY_KEY.get(teks(query.rahang).trim().toLowerCase()) || null;
  const halaman = Math.max(1, Math.floor(Number(query.halaman || 1)) || 1);
  const batas = Math.min(36, Math.max(6, Math.floor(Number(query.batas || 18)) || 18));

  const kueri = kata.length
    ? `${kata.map((k) => `"${k}"`).join(' AND ')} AND ${rak ? rak.wajib : 'mediatype:(texts)'}`
    : rak
      ? [rak.wajib, rak.kata.length && `(${rak.kata.join(' OR ')})`].filter(Boolean).join(' AND ')
      : KUERI_BAKU;

  const url = new URL(`${ARC}/advancedsearch.php`);
  url.searchParams.set('q', kueri);
  ['identifier', 'title', 'creator', 'year', 'date', 'language', 'downloads']
    .forEach((medan) => url.searchParams.append('fl[]', medan));
  url.searchParams.set('rows', String(batas));
  url.searchParams.set('page', String(halaman));
  if (!kata.length) url.searchParams.append('sort[]', 'downloads desc');
  url.searchParams.set('output', 'json');

  try {
    const response = await unduh(url.toString(), { Accept: 'application/json' });
    if (!response) {
      sendJson(res, 404, { ok: false, pesan: 'Buku yang dicari belum ada di rak ini.' }, 'miss');
      return;
    }
    const body = await response.json().catch(() => null);
    const docs = body?.response?.docs;
    if (!Array.isArray(docs)) throw new Error('katalog tidak dikenali');

    const hasil = [];
    const sudah = new Set();
    for (const doc of docs) {
      const id = teks(doc.identifier);
      const judul = potong(doc.title, 140);
      if (!id || !judul || sudah.has(id)) continue;
      // Arsip tanpa judul menyalin pengenalnya: itu nama berkas, bukan buku.
      if (judul === id) continue;
      // Unggahan yang judulnya masih nama file biasanya tidak punya teks baca.
      if (/\.(pdf|epub|djvu|mobi|docx?|xlsx?|pptx?|zip|rar)\b/i.test(judul)) continue;
      sudah.add(id);
      hasil.push({
        id,
        judul,
        penulis: potong(teks(doc.creator), 90),
        tahun: potong(doc.year || doc.date, 12).replace(/[^0-9.]/g, '').slice(0, 4),
        bahasa: bahasaLabel(doc.language),
        sampul: `${ARC}/services/img/${encodeURIComponent(id)}`,
      });
    }

    const total = Number(body?.response?.numFound) || 0;
    sendJson(res, 200, {
      ok: true,
      sumber: 'Internet Archive',
      total,
      halaman,
      batas,
      masihAda: halaman * batas < total,
      rak: PUSTAKA_RAK,
      hasil,
    }, 'miss', SEGAAR);
  } catch (error) {
    console.error('[pustaka/cari]', error?.message || error);
    sendJson(res, 502, {
      ok: false,
      pesan: 'Perpustakaan umum sedang tidak dapat dihubungi. Coba beberapa saat lagi.',
    }, 'miss');
  }
}

/** `/api/pustaka/baca/:id` — berkas teks mana yang bisa dibaca dari satu buku. */
export async function pustakaBacaHandler(req, res) {
  const id = namaAman(req.params?.id, 100);
  if (!id) {
    sendJson(res, 400, { ok: false, pesan: 'Buku ini tidak dikenal di perpustakaan.' }, 'miss');
    return;
  }

  try {
    const response = await unduh(`${ARC}/metadata/${encodeURIComponent(id)}`, { Accept: 'application/json' });
    if (!response) {
      sendJson(res, 404, { ok: false, pesan: 'Buku itu tidak lagi tersedia.' }, 'miss');
      return;
    }
    const body = await response.json().catch(() => null);
    const meta = body?.metadata;
    if (!meta) throw new Error('metadata tidak dikenali');

    if (meta['access-restricted-item']) {
      sendJson(res, 403, {
        ok: false,
        aksesTerbatas: true,
        alamat: `https://archive.org/details/${encodeURIComponent(id)}`,
        pesan: 'Buku ini dipinjamkan, bukan dibaca bebas. Pilih buku lain di rak yang sama.',
      }, 'miss');
      return;
    }

    const berkas = (body.files || [])
      .filter((file) => /\.txt$/i.test(file.name || '') && !/_meta\.txt$/i.test(file.name || ''))
      .map((file) => ({
        nama: file.name,
        label: file.name.replace(/\.txt$/i, '').replace(/_djvu$/i, '').replace(/[_-]+/g, ' ').trim(),
        ukuran: Number(file.size) || 0,
        pindai: /_djvu\.txt$/i.test(file.name),
      }))
      .filter((file) => file.ukuran >= 4_000 && file.ukuran <= 8_000_000)
      .sort((a, b) => (a.pindai === b.pindai ? b.ukuran - a.ukuran : a.pindai ? -1 : 1));

    // Dokumen asli lebih nyaman dibaca daripada teks hasil ekstraksi, jadi PDF
    // dicari lebih dulu. Berkas bersistem DRM (lcp) tidak bisa dibuka di sini.
    // Arkip menyimpan banyak PDF sekaligus, termasuk lampiran tak terkait dan
    // hasil turunan, jadi nama berkas dibandingkan dengan nama buku lebih dulu.
    // Angka dipisah sebagai token sendiri agar "VOL_1" unggul atas "VOL_2" dan
    // berkas turunan "_text.pdf" (teks hasil ekstraksi, bukan tata letak asli)
    // hanya dipakai bila dokumen pindaiannya tidak ada.
    const tanda = (nilai) => String(nilai || '')
      .toLowerCase()
      .replace(/([a-z])([0-9])/g, '$1 $2')
      .replace(/([0-9])([a-z])/g, '$1 $2')
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .filter((kata) => kata.length > 1 || /^[0-9]+$/.test(kata));
    const namaItem = new Set([...tanda(id), ...tanda(meta.title)]);
    const kecocokan = (nama) => {
      const kata = [...new Set(tanda(nama.replace(/\.pdf$/i, '')))];
      return kata.filter((nilai) => nilai.length > 1 && namaItem.has(nilai)).length
        + 2 * kata.filter((nilai) => /^[0-9]+$/.test(nilai) && namaItem.has(nilai)).length;
    };

    const pdf = (body.files || [])
      .filter((file) => /\.pdf$/i.test(file.name || '') && !/lcp/i.test(file.name || ''))
      .map((file) => {
        const ukuran = Number(file.size) || 0;
        const turunan = /_text\.pdf$/i.test(file.name) || /additional text pdf/i.test(file.format || '');
        return {
          nama: file.name,
          ukuran,
          poin: kecocokan(file.name) * 8 - (turunan ? 6 : 0) + (ukuran > 90_000_000 ? -1 : 0),
        };
      })
      .filter((file) => file.ukuran >= 60_000 && file.ukuran <= 150_000_000)
      // pdf.js hanya mengunduh bagian yang ditampilkan, jadi berkas besar tetap
      // aman; ukuran dipakai sebagai penentu terakhir supaya hemat kuota.
      .sort((a, b) => b.poin - a.poin || a.ukuran - b.ukuran)[0] || null;

    if (pdf) pdf.alamat = `/api/pustaka/berkas/${encodeURIComponent(id)}?berkas=${encodeURIComponent(pdf.nama)}`;

    if (!pdf && !berkas.length) {
      sendJson(res, 409, {
        ok: false,
        alamat: `https://archive.org/details/${encodeURIComponent(id)}`,
        pesan: (body.files || []).some((file) => /\.djvu$/i.test(file.name || ''))
          ? 'Buku ini hanya tersedia sebagai hasil pindai yang belum siap dibaca di layar. Coba judul lain di rak yang sama.'
          : 'Buku ini belum punya berkas yang bisa dibaca di layar. Coba judul lain di rak yang sama.',
      }, 'miss');
      return;
    }

    sendJson(res, 200, {
      ok: true,
      id,
      cara: pdf ? 'pdf' : 'teks',
      judul: potong(meta.title || id, 140),
      penulis: potong(teks(meta.creator), 90),
      penerbit: potong(teks(meta.publisher), 90),
      tahun: potong(meta.year || meta.date, 12).replace(/[^0-9.]/g, '').slice(0, 4),
      bahasa: bahasaLabel(meta.language),
      deskripsi: potong(teks(meta.description), 320),
      sampul: `${ARC}/services/img/${encodeURIComponent(id)}`,
      alamat: `https://archive.org/details/${encodeURIComponent(id)}`,
      pdf,
      berkas,
    }, 'miss', SEGAAR);
  } catch (error) {
    console.error('[pustaka/baca]', id, error?.message || error);
    sendJson(res, 502, {
      ok: false,
      pesan: 'Buku ini gagal dibuka. Coba buku lain atau ulangi beberapa saat lagi.',
    }, 'miss');
  }
}

/** `/api/pustaka/teks/:id?berkas=&hal=` — satu halaman baca dari satu berkas. */
export async function pustakaTeksHandler(req, res) {
  const id = namaAman(req.params?.id, 100);
  const query = req.query || {};
  const berkas = namaAman(query.berkas, 160);
  const nomor = Math.max(1, Math.floor(Number(query.hal || 1)) || 1);

  if (!id || !berkas) {
    sendJson(res, 400, { ok: false, pesan: 'Permintaan baca tidak dikenali.' }, 'miss');
    return;
  }

  try {
    const isi = await bacaBerkas(id, berkas);
    if (!isi.halaman.length) {
      sendJson(res, 409, { ok: false, pesan: 'Teks buku ini kosong atau tidak dapat dibaca.' }, 'miss');
      return;
    }

    const indeks = Math.min(nomor, isi.halaman.length) - 1;
    sendJson(res, 200, {
      ok: true,
      id,
      berkas,
      hal: indeks + 1,
      totalHal: isi.halaman.length,
      mutu: isi.mutu,
      terpotong: isi.terpotong,
      paragraf: isi.halaman[indeks],
    }, 'miss');
  } catch (error) {
    console.error('[pustaka/teks]', id, berkas, error?.message || error);
    sendJson(res, 502, {
      ok: false,
      pesan: 'Isi buku gagal dimuat. Coba halaman lain atau buka lagi beberapa saat.',
    }, 'miss');
  }
}

/**
 * `/api/pustaka/berkas/:id?berkas=` — mengantar dokumen asli ke pdf.js.
 *
 * Host berkas Internet Archive tidak mengirim header CORS, jadi browser tidak
 * diizinkan mengambil PDF-nya langsung; jalur ini menyambungkannya dengan
 * origin sama. Header Range diteruskan apa adanya supaya pembaca hanya menarik
 * bagian buku yang dibutuhkan, bukan seluruh berkas sekaligus.
 */
export async function pustakaBerkasHandler(req, res) {
  const id = namaAman(req.params?.id, 100);
  const berkas = namaAman(req.query?.berkas, 160);
  if (!id || !berkas || !/\.pdf$/i.test(berkas)) {
    sendJson(res, 400, { ok: false, pesan: 'Berkas buku ini tidak dikenali.' }, 'miss');
    return;
  }

  const header = {
    Accept: 'application/pdf;q=0.9, */*;q=0.5',
    'Accept-Encoding': 'identity',
  };
  const rentang = req.headers?.range || req.headers?.Range;
  if (typeof rentang === 'string' && /^bytes=\d*-\d*$/.test(rentang) && rentang !== 'bytes=-') {
    header.Range = rentang;
  }

  // Batas waktu hanya dipakai sampai kepala jawaban tiba. Berkas buku besar
  // mengalir pelan dari arsip dan memotongnya di tengah aliran akan membuat
  // penjawab kehilangan berkas, jadi sesudah header diterima penjaga itu lepas.
  const penanda = new AbortController();
  const penjaga = setTimeout(() => penanda.abort(), TIMEOUT);

  try {
    const hulu = await fetch(`${ARC}/download/${encodeURIComponent(id)}/${encodeURIComponent(berkas)}`, {
      headers: header,
      signal: penanda.signal,
    });
    clearTimeout(penjaga);

    if (!hulu.ok && hulu.status !== 206) {
      const hilang = hulu.status === 404 || hulu.status === 403;
      sendJson(res, hilang ? 404 : 502, {
        ok: false,
        pesan: hilang
          ? 'Berkas buku ini tidak lagi tersedia. Coba judul lain di rak yang sama.'
          : 'Dokumen asli buku sedang tidak dapat diambil. Coba lagi beberapa saat.',
      }, 'miss');
      return;
    }

    const medan = {
      'Content-Type': 'application/pdf',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=86400',
    };
    const panjang = hulu.headers.get('content-length');
    const rentangBalik = hulu.headers.get('content-range');
    if (panjang) medan['Content-Length'] = panjang;
    if (rentangBalik) medan['Content-Range'] = rentangBalik;

    res.writeHead(hulu.status === 206 ? 206 : 200, medan);
    if (!hulu.body) {
      res.end();
      return;
    }
    const aliran = Readable.fromWeb(hulu.body);
    // Penutup lebih awal adalah hal biasa: pembaca halaman PDF meninggalkannya
    // begitu bagian yang dibutuhkan turun. Arus yang patah cukup dibuang diam.
    req.on('close', () => penanda.abort());
    aliran.on('error', () => {
      penanda.abort();
      res.destroy();
    });
    aliran.pipe(res);
  } catch (error) {
    clearTimeout(penjaga);
    console.error('[pustaka/berkas]', id, error?.name || '', error?.message || '');
    if (res.headersSent) {
      res.destroy();
      return;
    }
    sendJson(res, 502, {
      ok: false,
      pesan: 'Dokumen asli gagal dimuat. Coba lagi beberapa saat atau baca versi teksnya.',
    }, 'miss');
  }
}
