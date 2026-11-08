// Tiruan layanan Apps Script untuk Node.
//
// Berkas ini dipasang lebih dulu, sebelum server/inti.cjs dimuat. Logika
// backend hasil pemindahan memanggil SpreadsheetApp, DriveApp, Utilities,
// PropertiesService, dan UrlFetchApp seperti di editor Apps Script; tugas
// lapisan ini hanya menyediakan nama-nama itu dengan perilaku yang sama di
// atas Supabase. Tidak ada keputusan bisnis yang boleh hidup di sini.
import crypto from 'node:crypto';
import { panggil as urlPanggil } from './io.mjs';
import { Buku } from './lembar.mjs';
import { db, simpan, bytesKeB64, b64KeBytes, dasar as urlDasar } from './supa.mjs';

const ZONA = 'Asia/Jakarta';

// ----------------------------------------------------------------- Utilities

function tanggalBagian(tanggal, zona) {
  const bagian = new Intl.DateTimeFormat('en-GB', {
    timeZone: zona || ZONA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(tanggal));
  const keluaran = {};
  for (const satu of bagian) keluaran[satu.type] = satu.value;
  if (keluaran.hour === '24') keluaran.hour = '00';
  return keluaran;
}

function formatTanggal(tanggal, zona, pola) {
  const b = tanggalBagian(tanggal, zona);
  const isian = {
    yyyy: b.year,
    MM: b.month,
    dd: b.day,
    HH: b.hour,
    mm: b.minute,
    ss: b.second,
  };
  // Pola Apps Script memakai kutip satu untuk teks yang tidak diubah, contoh
  // "yyyy-MM-dd'T'HH:mm" -> tanggal ISO tanpa zona.
  return String(pola).replace(/'([^']*)'|yyyy|MM|dd|HH|mm|ss/g, (cocok, teks) =>
    teks !== undefined ? teks : isian[cocok] ?? cocok);
}

function byteSah(bytes) {
  return Uint8Array.from([...bytes].map((n) => (n + 256) % 256));
}

function blob(barang, mime, nama) {
  const isinya = typeof barang === 'string' ? [...Buffer.from(barang, 'utf8')] : [...byteSah(barang)];
  return {
    getBytes: () => isinya.map((n) => (n > 127 ? n - 256 : n)),
    getContent: () => isinya,
    getDataAsString: (karakter) => Buffer.from(isinya).toString(karakter === 'UTF-8' || !karakter ? 'utf8' : String(karakter).toLowerCase()),
    getContentType: () => mime || 'application/octet-stream',
    getName: () => nama || '',
    setName: (baru) => { nama = String(baru || ''); },
    setContentType: (baru) => { mime = String(baru || mime); },
  };
}

const AlgoritmaSidik = { SHA_256: 'sha256', SHA_1: 'sha1', MD5: 'md5' };

function sidik(algoritma, nilai) {
  const nama = typeof algoritma === 'string' ? algoritma : 'sha256';
  const hash = crypto.createHash(AlgoritmaSidik[nama] || String(nama).toLowerCase().replace(/_/g, ''));
  hash.update(typeof nilai === 'string' ? nilai : Buffer.from(byteSah(nilai)));
  return [...hash.digest()].map((n) => (n > 127 ? n - 256 : n));
}

const Utilities = {
  getUuid: () => crypto.randomUUID(),
  formatDate: (tanggal, zona, pola) => formatTanggal(tanggal, zona, pola),
  base64Encode: (bytes) => Buffer.from(typeof bytes === 'string' ? bytes : byteSah(bytes)).toString('base64'),
  base64Decode: (teks) => b64KeBytes(String(teks || '').replace(/\s/g, '')),
  newBlob: (bytes, mime, nama) => blob(bytes, mime, nama),
  computeDigest: (algoritma, nilai) => sidik(algoritma, nilai),
  DigestAlgorithm: AlgoritmaSidik,
  Charset: { UTF_8: 'UTF-8' },
};

// -------------------------------------------------------------- Properties

function propertyObjek() {
  let sumber = null;
  const muat = () => {
    if (sumber) return sumber;
    sumber = new Map();
    try {
      const hasil = db('props', { kueri: 'select=key,value' });
      for (const satu of JSON.parse(hasil.teks || '[]')) sumber.set(String(satu.key), String(satu.value));
    } catch {
      // Tabel properties belum terbaca; environment tetap dipakai.
    }
    return sumber;
  };
  return {
    getProperty(nama) {
      // Tabel props adalah sumber utama, sama seperti Script Properties di
      // Apps Script: nilai yang baru ditulis kode harus langsung terbaca lagi
      // di permintaan yang sama. Environment hanya cadangan untuk rahasia yang
      // belum disalin ke tabel.
      const nilai = muat().get(String(nama));
      if (nilai !== undefined && nilai !== '') return nilai;
      const dariEnv = process.env[String(nama)];
      return dariEnv === undefined || dariEnv === '' ? null : String(dariEnv);
    },
    setProperty(nama, nilai) {
      muat().set(String(nama), String(nilai));
      db('props', {
        metode: 'POST',
        badan: { key: String(nama), value: String(nilai) },
        kepala: { Prefer: 'return=minimal,resolution=merge-duplicates' },
      });
      return this;
    },
    deleteProperty(nama) {
      muat().delete(String(nama));
      db('props', { metode: 'DELETE', kueri: `key=eq.${encodeURIComponent(String(nama))}` });
      return this;
    },
    getKeys: () => [...muat().keys()],
  };
}

let properti = null;
const PropertiesService = {
  getScriptProperties: () => (properti = properti || propertyObjek()),
};

// ------------------------------------------------------------------- Cache

const cacheIsi = new Map();
const CacheService = {
  getScriptCache: () => ({
    get(kunci) {
      const simpanan = cacheIsi.get(String(kunci));
      if (!simpanan) return null;
      if (Date.now() > simpanan.kedaluwarsa) {
        cacheIsi.delete(String(kunci));
        return null;
      }
      return simpanan.nilai;
    },
    put(kunci, nilai, detik) {
      cacheIsi.set(String(kunci), { nilai: String(nilai), kedaluwarsa: Date.now() + 1000 * (Number(detik) || 900) });
    },
    putAll(objek) {
      Object.keys(objek || {}).forEach((k) => this.put(k, objek[k]));
    },
    remove(kunci) {
      cacheIsi.delete(String(kunci));
    },
    removeAll(kunci) {
      String(kunci || '').split(',').forEach((satu) => cacheIsi.delete(satu.trim()));
    },
  }),
};

// -------------------------------------------------------------------- Lock

const LockService = {
  // Satu permintaan dijalankan bergiliran, jadi tidak ada dua penulis yang
  // bisa bertemu dalam proses yang sama.
  getScriptLock: () => ({ waitLock: () => true, tryLock: () => true, releaseLock: () => {} }),
};

// ----------------------------------------------------------------- Session

const Session = {
  getScriptTimeZone: () => ZONA,
  getActiveUser: () => null,
  getEffectiveUser: () => ({ getEmail: () => '' }),
};

// ---------------------------------------------------------------- ScriptApp

const ScriptApp = {
  getService: () => ({ getUrl: () => String(process.env.BACKEND_URL || '') }),
  getOAuthToken: () => '',
  getProjectTriggers: () => [],
  newTrigger: () => ({
    timeBased: () => ({ everyDays: () => ({ atHour: () => ({ create: () => ({}) }) }) }),
    create: () => ({}),
  }),
  ScriptTarget: { SPREADSHEET: 'SPREADSHEET' },
  EventType: { TIME_BASED: 'TIME_BASED' },
};

// ---------------------------------------------------------- ContentService

const ContentService = {
  MimeType: { JSON: 'JSON', TEXT: 'TEXT', HTML: 'HTML' },
  createTextOutput: (teks) => ({
    __teks: String(teks),
    setMimeType() { return this; },
    getContent() { return this.__teks; },
  }),
};

const HtmlService = {
  createHtmlOutputFromFile: () => ({ setWidth: () => ({ setHeight: () => ({}) }) }),
};

const antarmuka = {
  alert: (pesan) => console.log('[ui] ' + String(pesan).slice(0, 200)),
  showModalDialog: () => {},
  createMenuItem: () => ({ withCallback: () => ({ addToUi: () => {} }) }),
  Menu: {},
};

const SpreadsheetApp = {
  getActiveSpreadsheet: () => new Buku(process.env.SPREADSHEET_ID || 'pbpii'),
  openById: (id) => new Buku(id),
  getUi: () => antarmuka,
};

// --------------------------------------------------------------- UrlFetchApp

function tanggapan(hasil, muteHttpExceptions) {
  if (hasil.status >= 400 && !muteHttpExceptions) {
    throw new Error(`Request failed for ${hasil.url || ''} returned code ${hasil.status}`);
  }
  const bytes = hasil.b64 ? b64KeBytes(hasil.b64) : [...Buffer.from(String(hasil.teks || ''), 'utf8')];
  return {
    getResponseCode: () => hasil.status,
    getHeaders: () => hasil.headers || {},
    getContentText: (karakter) => (karakter ? Buffer.from(bytes).toString(String(karakter).toLowerCase().replace(/[-_]/g, '')) : Buffer.from(bytes).toString('utf8')),
    getContent: () => bytes,
    getBlob: () => blob(bytes, (hasil.headers || {})['content-type'] || 'application/octet-stream', ''),
    getBytes: () => bytes,
  };
}

/** Unduhan berkas lama Apps Script dipindahkan ke Storage, jalurnya tetap sama. */
function alihkanDrive(url, opsi) {
  const api = /googleapis\.com\/drive\/v3\/files\/([^?]+)\?[^ ]*alt=media/.exec(url);
  const unduhan = /drive\.usercontent\.google\.com\/download\?[^ ]*id=([A-Za-z0-9_-]{10,128})/.exec(url);
  const id = api ? decodeURIComponent(api[1]) : unduhan ? unduhan[1] : null;
  if (!id) return null;

  const baris = berkasRow(id);
  if (!baris) return { status: 404, headers: {}, teks: 'file not found' };
  const rentang = (opsi.headers || {}).Range || (opsi.headers || {}).range;
  const cocok = /^bytes=(\d+)-(\d+)$/.exec(String(rentang || ''));
  const hasil = simpan('GET', baris.emberas, baris.id, {
    rentang: cocok ? { mulai: Number(cocok[1]), sampai: Number(cocok[2]) } : undefined,
  });
  return { status: cocok ? 206 : 200, headers: { 'content-type': baris.mime }, b64: hasil.b64 || '' };
}

function UrlFetchAppFetch(url, opsi = {}) {
  const dialihkan = alihkanDrive(String(url), opsi);
  if (dialihkan) return tanggapan({ ...dialihkan, url }, true);

  const kepala = { ...(opsi.headers || {}) };
  let badan;
  let metode = String(opsi.method || 'GET').toUpperCase();
  if (opsi.payload !== undefined && opsi.payload !== null) {
    if (typeof opsi.payload === 'string') badan = opsi.payload;
    else {
      badan = Object.entries(opsi.payload).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
      kepala['Content-Type'] = kepala['Content-Type'] || 'application/x-www-form-urlencoded';
    }
    if (metode === 'GET') metode = 'POST';
  } else if (opsi.contentType) {
    kepala['Content-Type'] = opsi.contentType;
  }
  const hasil = dbUrl(metode, String(url), kepala, badan, opsi);
  return tanggapan(hasil, opsi.muteHttpExceptions === true);
}

function dbUrl(metode, url, kepala, badan, opsi) {
  const jawaban = urlPanggil({
    url,
    metode,
    kepala,
    badan,
    tenggang: Math.round((Number(opsi.timeout) || 25) * 1000),
  });
  return { ...jawaban, url };
}

// ---------------------------------------------------------------- DriveApp

const EMBERAS_NAMA = {
  'PB PII Media': 'media',
  'PB PII Surat': 'surat',
  'PB PII Pustaka': 'pustaka',
};

function emberasDari(idAtauNama) {
  const teks = String(idAtauNama || '').trim();
  if (EMBERAS_NAMA[teks]) return EMBERAS_NAMA[teks];
  if (['media', 'surat', 'pustaka'].includes(teks)) return teks;
  return null;
}

/** Petakan satu berkas Storage ke baris tabel berkas. */
function berkasRow(id) {
  const hasil = db('berkas', { kueri: `select=*&id=eq.${encodeURIComponent(String(id))}&limit=1` });
  const baris = JSON.parse(hasil.teks || '[]')[0];
  return baris && !baris.sampah ? baris : null;
}

function berkasTulis(baris) {
  db('berkas', {
    metode: 'POST',
    badan: baris,
    kepala: { Prefer: 'return=minimal,resolution=merge-duplicates' },
  });
}

function berkasObjek(baris, isi) {
  let unduhan = isi === undefined ? null : isi;
  const ambil = () => {
    if (unduhan === null) {
      const hasil = simpan('GET', baris.emberas, baris.id);
      unduhan = b64KeBytes(hasil.b64 || '');
    }
    return unduhan;
  };
  const simpanIsi = (bytes, mime) => {
    simpan('POST', baris.emberas, baris.id, { mime, badanB64: bytesKeB64(bytes) });
    baris = { ...baris, mime: mime || baris.mime, byte: bytes.length, diubah: new Date().toISOString() };
    berkasTulis(baris);
    unduhan = [...bytes];
  };
  return {
    getId: () => baris.id,
    getName: () => baris.nama,
    getMimeType: () => baris.mime,
    getDescription: () => baris.keterangan,
    setDescription: (teks) => {
      baris.keterangan = String(teks || '');
      berkasTulis(baris);
    },
    setName: (teks) => {
      baris.nama = String(teks || '');
      berkasTulis(baris);
    },
    getSize: () => (unduhan === null ? Number(baris.byte) || 0 : unduhan.length),
    getLastUpdated: () => new Date(baris.diubah || baris.dibuat || Date.now()),
    getCreatedDate: () => new Date(baris.dibuat || Date.now()),
    getBlob: () => blob(ambil(), baris.mime, baris.nama),
    getContentText: () => Buffer.from(byteSah(ambil())).toString('utf8'),
    setContent: (barang) => {
      const b = typeof barang === 'string' ? [...Buffer.from(barang, 'utf8')] : [...byteSah(barang.getBytes ? barang.getBytes() : barang)];
      simpanIsi(b, (barang && barang.getContentType && barang.getContentType()) || baris.mime);
    },
    setSharing: (akses) => {
      baris.publik = String(akses) === 'ANYONE_WITH_LINK';
      berkasTulis(baris);
    },
    setTrashed: (sampah) => {
      baris.sampah = Boolean(sampah);
      berkasTulis(baris);
      if (baris.sampah) {
        try {
          simpan('DELETE', baris.emberas, baris.id);
        } catch {
          // Objek sudah lebih dulu hilang; peta barisnya cukup.
        }
      }
    },
    getUrl: () => (baris.publik ? `${urlDasar()}/storage/v1/object/public/${baris.emberas}/${baris.id}` : ''),
    download: () => ambil(),
  };
}

function folderObjek(emberas, nama) {
  const daftar = (kueri) => {
    const hasil = db('berkas', { kueri: `select=*&emberas=eq.${emberas}&sampah=is.false${kueri ? '&' + kueri : ''}&order=dibuat.desc&limit=1000` });
    return JSON.parse(hasil.teks || '[]');
  };
  const Iterator = (daftarIsi) => {
    let i = 0;
    return {
      hasNext: () => i < daftarIsi.length,
      next: () => berkasObjek(daftarIsi[i++]),
    };
  };
  return {
    getId: () => emberas,
    getName: () => nama,
    createFile: (barang, namaLain, mimeLain) => {
      const b = typeof barang === 'string' ? [...Buffer.from(barang, 'utf8')] : [...byteSah((barang.getBytes && barang.getBytes()) || barang)];
      const mime = (barang && barang.getContentType && barang.getContentType()) || mimeLain || 'application/octet-stream';
      const namaFile = (barang && barang.getName && barang.getName()) || namaLain || 'berkas';
      const id = Utilities.getUuid();
      simpan('POST', emberas, id, { mime, badanB64: bytesKeB64(b) });
      const baris = {
        id,
        emberas,
        nama: String(namaFile).slice(0, 240),
        mime,
        keterangan: (barang && barang.getDescription && barang.getDescription()) || '',
        publik: emberas === 'media',
        byte: b.length,
      };
      berkasTulis(baris);
      return berkasObjek(baris, b);
    },
    getFiles: () => Iterator(daftar('')),
    getFilesByName: (namaFile) => Iterator(daftar(`nama=eq.${encodeURIComponent(String(namaFile))}`)),
    setSharing: () => {},
  };
}

const DriveApp = {
  Access: { ANYONE_WITH_LINK: 'ANYONE_WITH_LINK', ANYONE: 'ANYONE', PRIVATE: 'PRIVATE', MY_DRIVE: 'MY_DRIVE', DOMAIN: 'DOMAIN' },
  Permission: { VIEW: 'VIEW', EDIT: 'EDIT', NONE: 'NONE', OWNER: 'OWNER' },
  getFolderById: (id) => {
    const emberas = emberasDari(id);
    if (!emberas) throw new Error('Folder tidak ditemukan.');
    return folderObjek(emberas, Object.keys(EMBERAS_NAMA).find((k) => EMBERAS_NAMA[k] === emberas) || emberas);
  },
  getFoldersByName: (nama) => {
    const emberas = emberasDari(nama);
    const daftar = emberas ? [folderObjek(emberas, String(nama))] : [];
    let i = 0;
    return { hasNext: () => i < daftar.length, next: () => daftar[i++] };
  },
  createFolder: (nama) => {
    const emberas = emberasDari(nama);
    if (!emberas) throw new Error('Folder tidak dikenali: ' + nama);
    return folderObjek(emberas, String(nama));
  },
  getFileById: (id) => {
    const baris = berkasRow(String(id));
    if (!baris) throw new Error('Berkas tidak ditemukan di penyimpanan.');
    return berkasObjek(baris);
  },
  getFiles: () => folderObjek('media', 'PB PII Media').getFiles(),
};

// ------------------------------------------------------------------ pasang

/**
 * Tautan yang diserahkan ke browser untuk berkas gambar baru. Bucket media
 * membaca tanpa kunci, jadi URL Storage langsung bisa dipakai elemen <img>.
 * MEDIA_BASE_URL dipakai bila gambar ingin disajikan lewat domain sendiri.
 */
function dasarMedia_() {
  const custom = String(process.env.MEDIA_BASE_URL || '').replace(/\/+$/, '');
  return custom || `${urlDasar()}/storage/v1/object/public/media`;
}

function lolosPola(teks) {
  return String(teks).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tautanMedia_(id) {
  return `${dasarMedia_()}/${encodeURIComponent(String(id || ''))}`;
}

/**
 * Pemeriksaan "apakah ini tautan gambar yang boleh ditampilkan". Baris lama
 * masih menunjuk berkas Drive yang memang sudah dibagikan lewat tautan, jadi
 * kedua bentuk diterima; yang lain dianggap bukan gambar dan disembunyikan.
 */
function polaMedia_() {
  return new RegExp(
    `^(?:https:\\/\\/drive\\.usercontent\\.google\\.com\\/download\\?id=[A-Za-z0-9_-]{10,}|${lolosPola(dasarMedia_())}\\/)`
  );
}

export function pasang() {
  Object.assign(globalThis, {
    Utilities,
    PropertiesService,
    CacheService,
    LockService,
    Session,
    ScriptApp,
    ContentService,
    HtmlService,
    SpreadsheetApp,
    DriveApp,
    UrlFetchApp: { fetch: UrlFetchAppFetch },
    Logger: { log: (...argumen) => console.log(...argumen) },
    tautanMedia_,
    polaMedia_,
  });
  return { Utilities, DriveApp, PropertiesService };
}

/** Dipakai generator inti supaya fungsi bawaan Node tidak tertutup. */
export { db, simpan, berkasRow, emberasDari, tautanMedia_, polaMedia_ };
