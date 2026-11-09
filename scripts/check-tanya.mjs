/**
 * Menguji lapisan penelusuran web "Tanya PII" tanpa menyentuh internet.
 *
 *   npm run check:tanya
 *
 * `api/chat.js` dimuat apa adanya (impor baris pertamanya dilepas) lalu
 * `fetch`-nya diganti tiruan yang mengembalikan umpan RSS dan artikel backend.
 * Yang diperiksa adalah aturan yang membuatnya aman untuk pembaca: laman resmi
 * mendahului berita, berita mendahului sumber umum, yang terbaru lebih dulu,
 * tautan bukan-HTTPS dan tautan Google News yang tidak terbuka dibuang, dan
 * hasil web tidak pernah menyamar sebagai berkas resmi.
 */
import { readFileSync } from 'node:fs';

const sumber = readFileSync(new URL('../api/chat.js', import.meta.url), 'utf8')
  .replace(/^import .*$/m, '')
  .replace('export default async function handler', 'async function handler');

/** Semua permintaan jaringan modul lewat satu corong yang bisa diganti per tes. */
let fetchImpl = async () => { throw new Error('tes ini tidak boleh memanggil internet'); };

/* Rujukan resmi dan kuota dibaca dari backend aplikasi, bukan dari CMS lama.
   Tiruan ini meniru jalur Apps Script pada api/pii.js: satu POST, satu sampul. */
const URL_BACKEND_UJI = 'https://script.google.com/macros/s/uji-tanya/exec';
const kirimAksiUji = async (badan, url) => {
  const respons = await fetchImpl(url, { method: 'POST', body: JSON.stringify(badan) });
  return JSON.parse(await respons.text());
};

const modul = new Function('fetch', 'AbortSignal', 'process', 'URL', 'TextDecoder',
  'kirimAksi', 'DEFAULT_GAS_WEB_APP_URL',
  `${sumber}\nreturn { teksUrl, bukaEntitas, teksBersih, isiTag, tanggalISO, tanggalLabel,`
  + ' sumberResmi, tautanAsli, beritaBing, beritaGoogle, hostname, saringRelevan,'
  + ' skorRelevansi, kataKunci, menyebutOrganisasi, cariWeb, sumberBagian, webSitasi,'
  + ' wikipediaSearch, tepatWaktu, TINGKAT, faktaSitasi, bersihkanPenanda,'
  + ' lampiranBersih, userPesan, handler };')(
  (...args) => fetchImpl(...args),
  { timeout: () => ({}) },
  { env: {} },
  URL,
  TextDecoder,
  kirimAksiUji,
  URL_BACKEND_UJI);

let lolos = 0;
let gagal = 0;
function uji(nama, kondisi) {
  if (kondisi) { lolos += 1; return true; }
  gagal += 1;
  console.error(`  ✗ ${nama}`);
  return false;
}
function sama(nama, dapat, harus) {
  if (uji(nama, JSON.stringify(dapat) === JSON.stringify(harus))) return;
  console.error(`    dapat: ${JSON.stringify(dapat)}\n    harus: ${JSON.stringify(harus)}`);
}

/* ------------------------------------------------------- pembersih teks/XML */

sama('bukaEntitas membuka entity bertingkat',
  modul.bukaEntitas('&lt;p&gt;A&amp;B &#39;C&#39;&lt;/p&gt;'), '<p>A&B \'C\'</p>');
sama('teksBersih membuang tag dan skrip',
  modul.teksBersih('<div>Halo <script>evil()</script> dunia</div>'), 'Halo dunia');
sama('isiTag membaca CDATA',
  modul.isiTag('<item><title><![CDATA[Judul]]></title></item>', 'title'), 'Judul');
sama('tanggalISO merapikan RFC 822',
  modul.tanggalISO('Tue, 02 Oct 2026 07:00:00 GMT'), '2026-10-02');
sama('tanggalISO menolak waktu tak jelas', modul.tanggalISO('kemarin'), '');
sama('tanggalISO melewatkan tanggal ISO', modul.tanggalISO('2026-11-01T09:12:00Z'), '2026-11-01');
sama('tanggalLabel memakai bulan Indonesia', modul.tanggalLabel('2026-10-02'), '2 Oktober 2026');
sama('tanggalLabel diam kalau bukan tanggal', modul.tanggalLabel(''), '');
sama('hostname menghapus www', modul.hostname('https://www.pbpii.or.id/a'), 'pbpii.or.id');
sama('hostname aman untuk tautan rusak', modul.hostname('bukan-tautan'), '');

/* ------------------------------------------------- tautan asli vs redirector */

sama('tautanAsli mengeluarkan url dari redirect Bing',
  modul.tautanAsli('https://www.bing.com/news/apiclick.aspx?ref=F&url=https%3A%2F%2Frepublika.co.id%2Fa&tid=1'),
  'https://republika.co.id/a');
sama('tautanAsli menerima tautan biasa',
  modul.tautanAsli('https://pbpii.or.id/berita'), 'https://pbpii.or.id/berita');
sama('tautanAsli membuang http polos', modul.tautanAsli('http://pbpii.or.id/x'), '');
sama('tautanAsli membuang javascript:',
  modul.tautanAsli('https://bing.com/news/apiclick.aspx?url=javascript%3Aalert(1)'), '');
sama('tautanAsli membuang halaman pencarian Bing sendiri',
  modul.tautanAsli('https://www.bing.com/news/search?q=pii'), '');
sama('tautanAsli membuang rumah MSN',
  modul.tautanAsli('https://www.msn.com/id-id/a'), '');
sama('tautanAsli tetap menerima subdomain penerbit',
  modul.tautanAsli('https://news.google.com/rss/articles/abc'), 'https://news.google.com/rss/articles/abc');

/* ------------------------------------------------------- umpan RSS & WordPress */

const UMPAN_BING = `<?xml version="1.0"?><rss version="2.0" xmlns:News="https://schemas.microsoft.com/win/2004/08/news">
<channel>
  <item>
    <title><![CDATA[Kepengurusan PB PII 2026-2030]]></title>
    <link>https://www.bing.com/news/apiclick.aspx?url=https%3A%2F%2Frepublika.co.id%2Fpii&amp;tid=9</link>
    <description>Pelajar Islam Indonesia menetapkan susunan pengurus baru untuk periode mendatang.</description>
    <pubDate>Fri, 30 Oct 2026 08:00:00 GMT</pubDate>
    <News:Source>Republika</News:Source>
  </item>
  <item>
    <title><![CDATA[Tanpa tautan asli]]></title>
    <link>https://www.bing.com/news/search?q=pii</link>
    <description>Cuplikan panjang cukup tapi tautannya redirector tanpa parameter url.</description>
    <pubDate>Sat, 31 Oct 2026 08:00:00 GMT</pubDate>
  </item>
  <item>
    <title><![CDATA[Cuplikan pendek]]></title>
    <link>https://www.bing.com/news/apiclick.aspx?url=https%3A%2F%2Ftempo.co%2Fa</link>
    <description>Singkat.</description>
  </item>
</channel></rss>`;

const UMPAN_GOOGLE = `<?xml version="1.0"?><rss version="2.0"><channel>
  <item>
    <title>Pelajar Islam Indonesia gelar pelatihan - Antara News</title>
    <link>https://news.google.com/rss/articles/abc?oc=5</link>
    <pubDate>Thu, 29 Oct 2026 01:00:00 GMT</pubDate>
    <description>Pelatihan kader digelar di beberapa daerah.</description>
  </item>
  <item>
    <title>Bukan berita - Blog</title>
    <link>http://news.google.com/rss/articles/xyz</link>
    <pubDate>Thu, 29 Oct 2026 01:00:00 GMT</pubDate>
    <description>Tautan http harus dibuang, bukan diterima.</description>
  </item>
</channel></rss>`;

/* Sampul aksi `public` backend aplikasi: artikel terbit milik pengurus sendiri. */
const UMPAN_ARTIKEL = JSON.stringify({
  ok: true,
  data: {
    articles: [
      {
        title: 'Sambutan Ketua Umum PB PII',
        slug: 'sambutan-ketua-umum',
        excerpt: '',
        content: '<p>Kevin Prayoga, S.H. memimpin Pelajar Islam Indonesia periode ini dengan program kaderisasi.</p>',
        createdAt: '2026-10-20T04:00:00+00:00',
        updatedAt: '2026-11-01T04:00:00+00:00'
      },
      {
        title: 'Posong', slug: 'kosong', content: '<p>terlalu pendek</p>',
        createdAt: '2026-09-01T04:00:00+00:00'
      }
    ]
  }
});

const muat = (petakan) => async (url) => {
  const teks = Object.keys(petakan).find((cocok) => String(url).includes(cocok));
  if (!teks) throw new Error('luar jaringan: ' + url);
  const isi = petakan[teks];
  return {
    ok: true,
    status: 200,
    text: async () => isi,
    json: async () => JSON.parse(isi)
  };
};

const PETA = {
  'bing.com/news/search': UMPAN_BING,
  'news.google.com/rss/search': UMPAN_GOOGLE,
  'script.google.com/macros': UMPAN_ARTIKEL
};

/* -------------------------------------------------------------- parser bertingkat */

{
  const asal = fetchImpl;
  fetchImpl = muat(PETA);
  try {
    const bing = await modul.beritaBing('Pelajar Islam Indonesia');
    sama('Bing hanya mengambil item bertautan asli', bing.length, 1);
    sama('Bing membuka redirect ke penerbit', bing[0]?.url, 'https://republika.co.id/pii');
    sama('Bing menandai tingkat berita', bing[0]?.tier, 'berita');
    sama('Bing membaca penerbit', bing[0]?.penerbit, 'Republika');
    sama('Bing membaca tanggal', bing[0]?.tanggal, '2026-10-30');

    const google = await modul.beritaGoogle('Pelajar Islam Indonesia');
    sama('Google membuang tautan http', google.length, 1);
    sama('Google memisahkan penerbit dari judul', google[0]?.penerbit, 'Antara News');
    sama('Google tetap menandai berita', google[0]?.tier, 'berita');

    const resmi = await modul.sumberResmi();
    sama('Artikel situs sendiri hanya meluluskan pos berisi', resmi.length, 1);
    sama('Rujukan resmi memakai alamat baca artikel yang sebenarnya',
      resmi[0]?.url, 'https://pbpii.or.id/?artikel=sambutan-ketua-umum');
    sama('Tanggal artikel mengikuti pembaruan terakhir', resmi[0]?.tanggal, '2026-11-01');
    sama('Artikel pengurus ditandai resmi', resmi[0]?.tier, 'resmi');
    sama('Penerbit resmi = domain', resmi[0]?.penerbit, 'pbpii.or.id');
  } finally {
    fetchImpl = asal;
  }
}

/* ------------------------------------------------------------------ penapisan */

{
  const kunci = modul.kataKunci('siapa ketua umum pb pii sekarang');
  uji('kataKunci membuang kata tanya', !kunci.includes('siapa') && kunci.includes('ketua'));
  sama('Kata waktu bukan topik pencarian',
    modul.kataKunci('apa berita terbaru tentang pelajar islam indonesia dalam beberapa hari terakhir'),
    ['pelajar', 'islam', 'indonesia']);

  const bahan = [
    { judul: 'Pelajar Islam Indonesia lama', url: 'https://a.test/1', isi: 'pelajar islam indonesia', tier: 'umum', tanggal: '2020-01-01' },
    { judul: 'Pelajar Islam Indonesia terbaru', url: 'https://b.test/2', isi: 'pelajar islam indonesia', tier: 'berita', tanggal: '2026-10-10' },
    { judul: 'Pelajar Islam Indonesia resmi', url: 'https://pbpii.or.id/3', isi: 'pelajar islam indonesia', tier: 'resmi', tanggal: '2026-09-09' },
    { judul: 'Partai lain', url: 'https://c.test/4', isi: 'pelajar islam indonesia', tier: 'resmi', tanggal: '2026-11-01' },
    { judul: 'Pelajar Islam Indonesia duplikat', url: 'https://pbpii.or.id/3/', isi: 'pelajar islam indonesia', tier: 'resmi', tanggal: '2026-08-08' }
  ];
  const hasil = modul.saringRelevan(['pelajar', 'islam', 'indonesia'], bahan, true);
  sama('Resmi mendahului berita dan umum', hasil.map((i) => i.tier), ['resmi', 'berita', 'umum']);
  sama('URL duplikat dibuang sekali', hasil[0].url, 'https://pbpii.or.id/3');
  sama('Judul tanpa nama organisasi ditolak', hasil.some((i) => i.judul === 'Partai lain'), false);
  sama('Maksimal tiga rujukan', hasil.length, 3);

  const tanpaTanggal = modul.saringRelevan(['pelajar', 'islam', 'indonesia'],
    [bahan[1], { ...bahan[1], judul: 'Pelajar Islam Indonesia tanpa tanggal', url: 'https://d.test/5', tanggal: '' }], true);
  sama('Berketanggal diperlakukan lebih baru', tanpaTanggal[0].tanggal, '2026-10-10');

  const lepasNama = { judul: 'Pelajar Merdeka bicara', url: 'https://c.test/9', isi: 'pelajar islam indonesia aktif', tier: 'berita', tanggal: '2026-10-01' };
  sama('Tanpa nama wajib, judul tak bernama PII boleh masuk',
    modul.saringRelevan(['pelajar', 'islam', 'indonesia'], [lepasNama], false).length, 1);
  sama('Dengan nama wajib, judul tak bernama PII disaring',
    modul.saringRelevan(['pelajar', 'islam', 'indonesia'], [lepasNama], true).length, 0);
  sama('Skor nol untuk yang tak nyambung', modul.skorRelevansi(['kucing'], { judul: 'Anjing', isi: 'Burung' }), 0);
  sama('Penanda organisasi cocok untuk PII', modul.menyebutOrganisasi('PB PII Rakerwil'), true);
  sama('Penanda organisasi menolak kata mirip', modul.menyebutOrganisasi('Ilmu pissang'), false);
}

/* ------------------------------------------------------------------ bahan prompt */

{
  const bagian = modul.sumberBagian([], [], [
    { judul: 'Sambutan Ketua Umum', url: 'https://pbpii.or.id/x', isi: 'Kevin Prayoga, S.H.', penerbit: 'pbpii.or.id', tier: 'resmi', tanggal: '2026-10-20' },
    { judul: 'Kabar lama', url: 'https://news.google.com/y', isi: 'Pengurus lama', penerbit: 'Antara', tier: 'berita', tanggal: '' }
  ]);
  uji('Bahan melabeli RESMI', bagian.includes('[RESMI]'));
  uji('Bahan melabeli BERITA', bagian.includes('[BERITA]'));
  uji('Bahan menyebut tanggal Indonesia', bagian.includes('20 Oktober 2026'));
  uji('Bahan memerintahkan fakta vs opini', bagian.includes('belum terkonfirmasi'));
  uji('Bahan memerintahkan yang terbaru', bagian.includes('bertanggal paling baru'));
  sama('Bahan kosong bila tak ada sumber', modul.sumberBagian([], [], []), '');
}

{
  const bagian = modul.sumberBagian([
    {
      topik: 'kepengurusan ketua umum',
      pernyataan: 'Ketua Umum PB PII adalah Kevin Prayoga, S.H., Periode 2026 - 2028.',
      sumber: 'Pengurus Besar PII', terbit: '2026-11-01', sejak: '2026-11-01', sampai: ''
    }
  ], [
    { judul: 'Buku Panduan', b: 'BAB I', h: [4, 6], isi: 'PII berdiri 1947.' }
  ], [
    { judul: 'Kabar lama', url: 'https://a.test/1', isi: 'Ketua Umum lama', penerbit: 'Blog', tier: 'umum', tanggal: '2012-01-01' }
  ]);
  uji('Bahan melabeli DATA RESMI', bagian.includes('[DATA RESMI]'));
  uji('Bahan menyebut masa berlaku data resmi', bagian.includes('berlaku sejak 1 November 2026'));
  uji('Bahan menyebut siapa yang mengelola', bagian.includes('dikelola pengurus'));
  uji('Data resmi didahulukan di atas berkas dan web',
    bagian.indexOf('[DATA RESMI]') < bagian.indexOf('Berkas "Buku Panduan"')
      && bagian.indexOf('Berkas "Buku Panduan"') < bagian.indexOf('[UMUM]'));
  uji('Prompt melarang web menimpa data resmi', bagian.includes('jangan menggantinya dengan hasil pencarian web'));
  const tanpaFakta = modul.sumberBagian([], [], [
    { judul: 'Kabar', url: 'https://a.test/1', isi: 'x', penerbit: 'Blog', tier: 'umum', tanggal: '2026-01-01' }
  ]);
  uji('Perintah khusus data resmi tidak muncul tanpa fakta',
    !tanpaFakta.includes('[DATA RESMI]'));
  uji('Prompt melarang penanda berkurung disalin ke jawaban',
    bagian.includes('jangan disalin ke jawaban'));
}

{
  const bersih = modul.bersihkanPenanda(
    'Ketua Umum adalah Kevin Prayoga, S.H. Sumber: [DATA RESMI] kepengurusan ketua umum [RESMI] '
    + 'lalu [BERITA] dan [UMUM] serta [B3].');
  uji('Label kepercayaan dibuang dari teks pembaca',
    !/\[(?:DATA[ ]+)?RESMI\]|\[BERITA\]|\[UMUM\]|\[B3\]/.test(bersih));
  uji('Isi jawaban tetap utuh setelah pembersihan', /Kevin Prayoga/.test(bersih), true);
  sama('Penanda hanya dibuang, bukan kata lain',
    modul.bersihkanPenanda('Resmi saja, bukan [RESMI].'), 'Resmi saja, bukan.');

  /* Model menyalin label dengan spasi tipis tak-putus (U+202F), bukan spasi biasa. */
  const tipis = modul.bersihkanPenanda('Sumber: [DATA RESMI] kepengurusan ketua umum.');
  uji('Label dengan spasi tipis ikut dibuang', !tipis.includes('['), true);
  sama('Kalimat sumber tetap terbaca', tipis, 'Sumber: kepengurusan ketua umum.');

  const dikutip = modul.faktaSitasi([
    { topik: 'Kantor sekretariat', pernyataan: 'Jl. Menteng Raya No. 58.', sejak: '2026-11-05', sampai: '' },
    { topik: 'tanpa isi', pernyataan: '   ' }
  ]);
  sama('Hanya fakta berpendapat yang jadi rujukan', dikutip.length, 1);
  sama('Masa berlaku ikut ditampilkan ke pembaca', dikutip[0].sejak, '5 November 2026');
  sama('Topik dirapikan ke teks biasa', dikutip[0].topik, 'Kantor sekretariat');
  sama('Sitasi fakta kosong untuk bukan daftar', modul.faktaSitasi(null), []);
}

/* ----------------------------------------------------------------------- sitasi */

{
  const kutip = modul.webSitasi([
    { judul: 'A', url: 'https://pbpii.or.id/a', isi: 'x'.repeat(400), penerbit: 'pbpii.or.id', tier: 'resmi', tanggal: '2026-10-20T00:00:00Z' },
    { judul: 'B', url: 'http://pbpii.or.id/b', isi: 'y', tier: 'berita' },
    { judul: '', url: 'https://pbpii.or.id/c', isi: 'z', tier: 'umum' }
  ]);
  sama('Hanya HTTPS dan bersetajuk', kutip.length, 1);
  sama('Tanggal dirapikan ke ISO', kutip[0].tanggal, '2026-10-20');
  sama('Tingkat ikut terbawa', kutip[0].tier, 'resmi');
  sama('Penerbit ikut terbawa', kutip[0].penerbit, 'pbpii.or.id');
  sama('Cuplikan dipotong', kutip[0].cuplikan.length, 320);
  sama('Tingkat asing jadi umum',
    modul.webSitasi([{ judul: 'D', url: 'https://e.test/d', isi: 'w', tier: 'rahasia' }])[0].tier, 'umum');
  sama('Sitasi kosong untuk bukan daftar', modul.webSitasi(null), []);
}

/* ------------------------------------------------------------------ orkestrasi */

{
  const asal = fetchImpl;
  const alamat = [];
  fetchImpl = async (url) => {
    alamat.push(String(url));
    return muat(PETA)(url);
  };
  try {
    const hasil = await modul.cariWeb('apa berita terbaru tentang PII dalam beberapa hari terakhir');
    const berita = alamat.find((u) => u.includes('bing.com/news')) || '';
    const pertanyaan = decodeURIComponent((berita.match(/[?&]q=([^&]*)/) || [])[1] || '');
    uji('Pencari berita ditanya dengan kata topik, bukan kalimat tanya',
      pertanyaan === 'pelajar islam indonesia' || pertanyaan === 'Pelajar Islam Indonesia');
    uji('Pertanyaan berita tetap mendapat rujukan', hasil.length > 0);
  } finally {
    fetchImpl = asal;
  }
}

{
  const asal = fetchImpl;
  fetchImpl = muat(PETA);
  try {
    const hasil = await modul.cariWeb('siapa ketua umum pb pii sekarang');
    uji('Pertanyaan organisasi memakai sumber resmi lebih dulu', hasil[0]?.tier === 'resmi');
    uji('Semua hasil bertingkat sah', hasil.every((i) => ['resmi', 'berita', 'umum'].includes(i.tier)));
    uji('Semua hasil HTTPS', hasil.every((i) => /^https:\/\//.test(i.url)));
    uji('Maksimal tiga', hasil.length <= 3);
  } finally {
    fetchImpl = asal;
  }
}

{
  /* Satu tenggat dipakai bersama: sumber yang terlambat dilepas, tidak membuat
     pembaca menunggu tanpa jawaban. */
  const asal = fetchImpl;
  const lambat = (milidetik) => async (url) => {
    await new Promise((tunggu) => setTimeout(tunggu, milidetik));
    const isi = String(url).includes('bing.com/news') ? UMPAN_BING
      : String(url).includes('news.google.com/rss') ? UMPAN_GOOGLE
        : String(url).includes('script.google.com/macros') ? UMPAN_ARTIKEL : '{}';
    return { ok: true, status: 200, text: async () => isi, json: async () => JSON.parse(isi) };
  };
  try {
    fetchImpl = lambat(250);
    const cukup = await modul.cariWeb('siapa ketua umum pb pii sekarang', 9000);
    uji('Batas waktu longgar memberi sumber resmi', cukup[0]?.tier === 'resmi');

    fetchImpl = lambat(2600);
    const mepet = await modul.cariWeb('siapa ketua umum pb pii sekarang', 100);
    sama('Tenggat habis → tangan kosong, bukan karangan', mepet, []);

    fetchImpl = async (url) => {
      const resmi = String(url).includes('script.google.com/macros');
      if (resmi) await new Promise((tunggu) => setTimeout(tunggu, 2600));
      const isi = String(url).includes('bing.com/news') ? UMPAN_BING
        : String(url).includes('news.google.com/rss') ? UMPAN_GOOGLE : UMPAN_ARTIKEL;
      return { ok: true, status: 200, text: async () => isi, json: async () => JSON.parse(isi) };
    };
    const sebagian = await modul.cariWeb('siapa ketua umum pb pii sekarang', 1500);
    uji('Resmi yang terlambat tidak menghapus berita yang sudah ada',
      sebagian.length > 0 && sebagian.every((i) => i.tier === 'berita'));
  } finally {
    fetchImpl = asal;
  }
}

{
  const asal = fetchImpl;
  fetchImpl = async () => { throw new Error('semua sumber mati'); };
  try {
    const hasil = await modul.cariWeb('siapa ketua umum pb pii sekarang');
    sama('Mat total → tangan kosong, bukan karangan', hasil, []);
  } finally {
    fetchImpl = asal;
  }
}

{
  const asal = fetchImpl;
  fetchImpl = muat({ 'wikipedia.org/w/api.php': JSON.stringify({
    query: { pages: { 1: { title: 'Pelajar Islam Indonesia', fullurl: 'https://id.wikipedia.org/wiki/PII',
      extract: 'Pelajar Islam Indonesia adalah organisasi kepemudaan Islam yang berdiri sejak 1949 dan tersebar di seluruh Indonesia.',
      touched: '2026-11-01T00:00:00Z' } } } }) });
  try {
    const hasil = await modul.cariWeb('apa itu pelajar islam indonesia');
    sama('Wiki saja tetap dianggap UMUM, bukan RESMI', hasil[0]?.tier, 'umum');
    uji('Wiki membawa tanggal', hasil[0]?.tanggal === '2026-11-01');
  } finally {
    fetchImpl = asal;
  }
}

{
  const lambat = new Promise((selesai) => setTimeout(() => selesai([1, 2]), 400));
  const cepat = new Promise((selesai) => setTimeout(() => selesai([3]), 10));
  sama('tepatWaktu melepas yang terlambat', await modul.tepatWaktu(Date.now() + 60, lambat), []);
  sama('tepatWaktu menjaga yang tepat waktu', await modul.tepatWaktu(Date.now() + 600, cepat), [3]);
  sama('tepatWaktu tidak menunggu kalau tenggat sudah lewat',
    await modul.tepatWaktu(Date.now() - 1, new Promise(() => {})), []);
  sama('Sumber resmi tidak dibaca kalau tenggat sudah habis',
    await modul.sumberResmi(Date.now() - 1), []);
}

/* -------------------------------------------------------------------- lampiran */

{
  const gambarSah = `data:image/jpeg;base64,${'a'.repeat(40)}=`;
  const bersih = modul.lampiranBersih([
    { jenis: 'gambar', nama: 'Foto kegiatan.jpg', data: gambarSah },
    { jenis: 'gambar', nama: 'Palsu', data: 'https://jahat.example/x.png' },
    { jenis: 'gambar', nama: 'Asing', data: 'data:image/svg+xml;base64,PHN2Zz4=' },
    { jenis: 'dokumen', nama: 'PKU PB PII.pdf', isi: 'isi berkas yang terbaca' },
    { jenis: 'dokumen', nama: '', isi: '' },
    { jenis: 'lain', nama: 'X' },
    'bukan objek'
  ]);
  sama('Gambar sah lolos, yang palsu atau asing dibuang', bersih.map((i) => i.jenis), ['gambar', 'dokumen']);
  sama('Nama dirapikan', bersih[0].nama, 'Foto kegiatan.jpg');
  sama('Dokumen tanpa nama dan isi dibuang', bersih.length, 2);
  sama('Bukan daftar ditolak', modul.lampiranBersih(null), []);
  sama('Maksimal empat', modul.lampiranBersih([
    { jenis: 'dokumen', nama: 'A', isi: '1' }, { jenis: 'dokumen', nama: 'B', isi: '2' },
    { jenis: 'dokumen', nama: 'C', isi: '3' }, { jenis: 'dokumen', nama: 'D', isi: '4' },
    { jenis: 'dokumen', nama: 'E', isi: '5' }
  ]).length, 4);

  const pesan = modul.userPesan('Jelaskan lampirannya.', [
    { jenis: 'gambar', nama: 'Foto kegiatan.jpg', data: gambarSah },
    { jenis: 'dokumen', nama: 'PKU PB PII.pdf', isi: 'Teks berkas PKU.' },
    { jenis: 'dokumen', nama: 'Pindaian.pdf', isi: '' }
  ]);
  uji('Pesan bergambar berbentuk bagian-bagian', Array.isArray(pesan.content));
  sama('Gambar menjadi bagian image_url', pesan.content[0].type, 'image_url');
  sama('Data URL gambar terbawa utuh', pesan.content[0].image_url.url, gambarSah);
  uji('Dokumen disebut namanya dalam teks', pesan.content[1].text.includes('PKU PB PII.pdf'));
  uji('Dokumen terbaca disertakan apa adanya', pesan.content[1].text.includes('Teks berkas PKU.'));
  uji('Dokumen tanpa teks disebut tidak terbaca', pesan.content[1].text.includes('tidak ada teks terbaca'));
  uji('Pertanyaan menjadi bagian terakhir', pesan.content[pesan.content.length - 1].text === 'Jelaskan lampirannya.');
  sama('Tanpa lampiran pesan tetap teks polos', modul.userPesan('Halo', []).content, 'Halo');
}

console.log(`${lolos} lolos, ${gagal} gagal`);
process.exit(gagal ? 1 : 0);
