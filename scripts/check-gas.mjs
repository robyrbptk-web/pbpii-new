/**
 * Memeriksa logika backend di `gas/Code.gs` tanpa Google Apps Script.
 *
 *   npm run check:gas
 *
 * Sumbernya dibaca apa adanya lalu dijalankan dengan Services palsu
 * (SpreadsheetApp, Utilities, Session, PropertiesService, CacheService,
 * UrlFetchApp), jadi standar keaktifan berjenjang, umpan acara publik,
 * pembatas laju, captcha, login Google kader, suka, dan komentar ikut teruji
 * lewat jalur `doPost` yang sama dengan yang dipakai browser — bukan hanya
 * sintaksnya.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const HEADERS = {
  Articles: ['id', 'title', 'slug', 'category', 'excerpt', 'content', 'coverImage', 'author', 'status', 'createdAt', 'updatedAt', 'seoTitle', 'seoDescription', 'seoKeywords', 'orgId'],
  Gallery: ['id', 'title', 'imageUrl', 'caption', 'featured', 'sortOrder', 'createdAt'],
  Settings: ['key', 'value'],
  Orgs: ['id', 'jenjang', 'name', 'province', 'district', 'subdistrict', 'parentId', 'email', 'passwordHash', 'passwordSalt', 'phone', 'skUrl', 'status', 'verifiedBy', 'verifiedAt', 'createdAt', 'updatedAt', 'lastLoginAt', 'note'],
  Activities: ['id', 'orgId', 'title', 'category', 'date', 'location', 'description', 'participants', 'coverImage', 'status', 'createdAt', 'updatedAt', 'startTime', 'endTime', 'registrationDeadline', 'quota', 'additionalInfo'],
  Forms: ['id', 'orgId', 'activityId', 'title', 'description', 'status', 'createdAt', 'updatedAt', 'fields'],
  Participants: ['id', 'formId', 'orgId', 'name', 'institution', 'phone', 'email', 'note', 'createdAt', 'answers', 'status', 'updatedAt', 'registrationKey'],
  Letters: ['id', 'fromOrgId', 'toOrgId', 'category', 'subject', 'body', 'status', 'createdAt', 'readAt', 'replyToId', 'threadId', 'attachmentId', 'attachmentName'],
  Sessions: ['token', 'kind', 'subject', 'createdAt', 'expiresAt'],
  Chat: ['createdAt', 'kind', 'subject', 'question', 'answer', 'provider', 'status'],
  Standards: ['id', 'orgId', 'minPerMonth', 'setByOrgId', 'setByName', 'note', 'updatedAt'],
  Kaders: ['id', 'email', 'name', 'picture', 'googleSub', 'createdAt', 'lastLoginAt', 'note', 'passwordHash', 'passwordSalt'],
  Reactions: ['id', 'eventId', 'actorKey', 'actorName', 'kind', 'createdAt', 'targetType'],
  Comments: ['id', 'eventId', 'actorKey', 'actorName', 'actorPicture', 'text', 'status', 'createdAt', 'updatedAt', 'targetType', 'parentId'],
  Posts: ['id', 'authorKey', 'authorId', 'authorName', 'authorPicture', 'jenis', 'isi', 'eventId', 'repostOf', 'visibel', 'createdAt', 'updatedAt'],
  PostMedia: ['id', 'postId', 'url', 'mime', 'urut', 'createdAt'],
  Follows: ['id', 'actorKey', 'actorId', 'targetId', 'createdAt'],
  Bookmarks: ['id', 'actorKey', 'postId', 'createdAt'],
  PustakaBerkas: ['id', 'judul', 'kategori', 'ringkas', 'halaman', 'potong', 'byte', 'berkas', 'versi', 'tanggal', 'visibel'],
  PustakaPotongan: ['doc', 'halaman', 'teks', 'halamanAkhir', 'bab']
};

const SHEETS = {};
const rowsOf = (name) => (SHEETS[name] ||= []);

function seed(name, rows) {
  rowsOf(name).push(...rows.map((row) => ({ ...row })));
}

class FakeRange {
  constructor(sheet, row, column, rowSpan, columnSpan) {
    this.sheet = sheet;
    this.row = row;
    this.column = column;
    this.rowSpan = rowSpan || 1;
    this.columnSpan = columnSpan || 1;
  }

  getValues() {
    const headers = HEADERS[this.sheet.name];
    const out = [];
    for (let r = 0; r < this.rowSpan; r += 1) {
      const index = this.row - 1 + r;
      if (index === 0) { out.push(headers.slice()); continue; }
      const record = this.sheet.records[index - 1] || {};
      out.push(headers.map((header) => record[header] === undefined ? '' : record[header]));
    }
    return out;
  }

  getDisplayValues() {
    return this.getValues().map((row) => row.map((value) => String(value)));
  }

  setValues(values) {
    values.forEach((row, offset) => this.writeRow(this.row + offset, row));
  }

  setValue(value) {
    this.writeCell(this.row, this.column, value);
  }

  writeRow(at, values) {
    const headers = HEADERS[this.sheet.name];
    // Nomor baris sheet: 1 = header, 2 = records[0].
    const index = at - 2;
    const record = this.sheet.records[index] ||= {};
    values.forEach((value, offset) => { record[headers[offset]] = value; });
  }

  writeCell(at, column, value) {
    const header = HEADERS[this.sheet.name][column - 1];
    if (!header) return;
    const record = this.sheet.records[at - 2] ||= {};
    record[header] = value;
  }

  setFontWeight() { return this; }
}

class FakeSheet {
  constructor(name) { this.name = name; }

  get records() { return rowsOf(this.name); }

  getLastRow() { return this.records.length + 1; }

  getLastColumn() { return HEADERS[this.name].length; }

  getDataRange() { return new FakeRange(this, 1, 1, this.records.length + 1, HEADERS[this.name].length); }

  getRange(row, column, rowSpan, columnSpan) { return new FakeRange(this, row, column, rowSpan, columnSpan); }

  appendRow(values) {
    const record = {};
    HEADERS[this.name].forEach((header, index) => { record[header] = values[index] === undefined ? '' : values[index]; });
    this.records.push(record);
    return this;
  }

  deleteRow(row) { this.records.splice(row - 2, 1); return this; }

  setFrozenRows() { return this; }

  clearContents() { this.records.length = 0; return this; }

  getMaxRows() { return Math.max(1000, this.records.length + 1); }

  getMaxColumns() { return Math.max(26, HEADERS[this.name].length); }

  insertRowsAfter() { return this; }

  insertColumnsAfter() { return this; }
}

const SpreadsheetApp = {
  openById: () => ({ getSheetByName: (name) => (HEADERS[name] ? new FakeSheet(name) : null) })
};
const properti = { SPREADSHEET_ID: 'fixture-spreadsheet' };
const PropertiesService = {
  getScriptProperties: () => ({
    getProperty: (key) => (key in properti ? properti[key] : null),
    setProperty: (key, value) => { properti[key] = String(value); },
    deleteProperty: (key) => { delete properti[key]; }
  })
};
const Session = { getScriptTimeZone: () => 'Asia/Jakarta' };
let uuidSeq = 0;
const Utilities = {
  formatDate: (date, zone, pattern) => {
    const iso = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString();
    if (pattern === 'yyyy-MM-dd') return iso.slice(0, 10);
    if (pattern === 'yyyy-MM') return iso.slice(0, 7);
    return iso;
  },
  getUuid: () => `fixture-${(++uuidSeq).toString(16).padStart(4, '0')}`,
  computeDigest: (_algo, value) => Array.from(createHash('sha256').update(String(value)).digest()),
  newBlob: (bytes, mime, name) => ({
    getBytes: () => Array.from(bytes),
    getContentType: () => String(mime),
    getName: () => String(name),
    getDataAsString: () => Buffer.from(Array.from(bytes, (b) => (b + 256) % 256)).toString('utf8')
  }),
  DigestAlgorithm: { SHA_256: 'SHA_256' },
  base64Decode: (raw) => Array.from(Buffer.from(String(raw), 'base64'), (byte) => byte > 127 ? byte - 256 : byte),
  base64Encode: (bytes) => Buffer.from(bytes).toString('base64')
};

/** CacheService palsu: hitungan jendela geser dan captcha harus benar-benar hidup. */
const cacheStore = new Map();
const scriptCache = {
  get(key) {
    const item = cacheStore.get(key);
    if (!item) return null;
    if (item.expiresAt <= Date.now()) {
      cacheStore.delete(key);
      return null;
    }
    return item.value;
  },
  put(key, value, seconds) {
    const ttl = Math.max(1, Math.min(600, Number(seconds) || 60));
    cacheStore.set(key, { value: String(value), expiresAt: Date.now() + ttl * 1000 });
  },
  remove(key) { cacheStore.delete(key); }
};
const CacheService = { getScriptCache: () => scriptCache };

/** Titik-titik keluar yang bisa diatur per pemeriksaan. */
const http = { google: null, turnstile: null, ai: null, calls: [] };
const UrlFetchApp = {
  fetch(url, options) {
    http.calls.push({ url: String(url), options });
    if (String(url).includes('pollinations') || String(options?.payload || '').includes('"messages"')) {
      const teks = http.ai ? JSON.stringify(http.ai)
        : JSON.stringify({ choices: [{ message: { content: 'Jawaban contoh dari layanan AI.' } }] });
      return { getContentText: () => teks, getResponseCode: () => 200 };
    }
    const text = String(url).includes('oauth2.googleapis.com/tokeninfo')
      ? JSON.stringify(http.google || { error: 'tokeninfo belum diatur' })
      : JSON.stringify(http.turnstile || { success: false });
    return { getContentText: () => text, getResponseCode: () => 200 };
  }
};

const ContentService = {
  MimeType: { JSON: 'JSON' },
  createTextOutput: (text) => {
    const output = {
      getContentText: () => text,
      asText: () => text,
      setMimeType: () => output
    };
    return output;
  }
};

/** DriveApp palsu: folder media PB PII cukup satu, tiap unggah tercatat. */
const driveFiles = [];
let corruptNextDriveRead = false;
let includePustakaCorpus = true;

/**
 * Korpus pustaka palsu: kalimat aslinya dipotong dari berkas kebinan PII supaya
 * pemeriksaan pencarian isi dan rujukan Tanya PII memakai teks sungguhan.
 */
const pustakaFixture = {
  versi: 1,
  dibuat: '2026-10-31T02:04:57.927Z',
  docs: [
    { id: 'ebook-ta-dib-pii', judul: "Ebook Ta'dib PII", kategori: 'Kaderisasi',
      ringkas: "Buku Induk Kaderisasi PII.", halaman: 393, potong: 2,
      berkas: "Ebook Ta'dib PII (tanpa password).pdf" },
    { id: 'silabus-leadership-basic-training-poin', judul: 'Silabus Leadership Basic Training',
      kategori: 'Pelatihan', ringkas: 'Silabus LBT.', halaman: 87, potong: 1,
      berkas: 'Silabus LEADERSHIP BASIC TRAINING (POIN).pdf' },
    { id: 'buku-saku-ppo-2020', judul: 'Buku Saku PPO 2020', kategori: 'Organisasi & PPO',
      ringkas: 'PPO.', halaman: 51, potong: 1, berkas: 'BUKU SAKU PPO 2020.pdf' },
    { id: 'pku-rancangan-internal', judul: 'PKU PB PII (rancangan)', kategori: 'Kebijakan Umum',
      ringkas: 'Draf yang belum disahkan forum.', halaman: 12, potong: 1,
      berkas: 'PKU PB PII draf.pdf', visibel: false }
  ],
  chunks: [
    { d: 'ebook-ta-dib-pii', h: [120, 124], b: 'BAB III ORIENTASI TA’DIB › Ketentuan Mengenai Waktu Turba', t: 'Ketentuan Mengenai Waktu Turba. Waktu turba tidak dibatasi berapa minimal harinya atau maksimal harinya. Turba dilakukan sampai permasalahan yang terjadi di daerah atau wilayah yang didatangi bisa selesai.' },
    { d: 'ebook-ta-dib-pii', h: [88, 90], t: 'Ta’lim Awal adalah jenjang pembinaan pertama bagi kader PII sebelum mengikuti training kepemimpinan.' },
    { d: 'silabus-leadership-basic-training-poin', h: [12, 15], t: 'Leadership Basic Training atau LBT adalah training kepemimpinan dasar bagi kader PII yang telah mengikuti ta’lim awal.' },
    { d: 'buku-saku-ppo-2020', h: [7, 9], t: 'Pengembangan dan Pemberdayaan Organisasi membina pengurus komisariat, daerah, wilayah, sampai pengurus besar.' },
    { d: 'pku-rancangan-internal', h: [3, 3], b: 'BAB II POLA KEBIJAKAN UMUM', t: 'Rancangan PKU memuat prioritas kerja pengurus besar yang belum disahkan forum tertinggi organisasi.' }
  ]
};

const pustakaFile = {
  getId: () => 'fixture-pustaka-korpus',
  getName: () => 'pustaka.json',
  getLastUpdated: () => new Date('2026-10-31T02:04:57.927Z'),
  getBlob: () => ({ getDataAsString: () => JSON.stringify(pustakaFixture) })
};

/** Pegangan berkas Drive palsu; isinya bisa dibaca ulang dan ditimpa seperti API asli. */
function fileHandle(record) {
  return {
    getId: () => record.id,
    getName: () => record.name,
    getMimeType: () => record.mime,
    getDescription: () => record.description,
    setDescription: (value) => { record.description = String(value); },
    setSharing: (access, permission) => {
      if (access === undefined) throw new Error('Argumen tidak boleh nol: accessType.');
      record.sharing = { access, permission };
    },
    setTrashed: (value) => { record.trashed = Boolean(value); },
    setContent: (blob) => {
      record.bytes = Array.from(blob.getBytes());
      record.mime = String(blob.getContentType());
      record.name = String(blob.getName());
    },
    getBlob: () => ({
      getBytes: () => {
        const isi = (record.bytes || []).slice();
        if (corruptNextDriveRead) {
          corruptNextDriveRead = false;
          return isi.slice(1);
        }
        return isi;
      }
    })
  };
}

const fakeFolder = {
  getId: () => 'fixture-folder-media',
  getName: () => 'PB PII Media',
  setSharing() {},
  getFiles() {
    const daftar = driveFiles.map(fileHandle);
    let index = 0;
    return { hasNext: () => index < daftar.length, next: () => daftar[index++] };
  },
  getFilesByName(nama) {
    const berkas = [];
    if (String(nama) === 'pustaka.json' && includePustakaCorpus) berkas.push(pustakaFile);
    driveFiles.filter((file) => file.name === String(nama)).forEach((record) => berkas.push({
      getId: () => record.id,
      getName: () => record.name,
      getLastUpdated: () => new Date(record.updatedAt || '2026-10-31T02:04:57.927Z')
    }));
    let index = 0;
    return { hasNext: () => index < berkas.length, next: () => berkas[index++] };
  },
  createFile(blob) {
    const record = {
      id: `fixture-file-${driveFiles.length + 1}`,
      name: String(blob.getName()),
      bytes: Array.from(blob.getBytes()),
      mime: String(blob.getContentType()),
      description: '',
      sharing: null
    };
    driveFiles.push(record);
    return fileHandle(record);
  }
};
const DriveApp = {
  Access: { ANYONE_WITH_LINK: 'ANYONE_WITH_LINK', PRIVATE: 'PRIVATE' },
  Permission: { VIEW: 'VIEW', NONE: 'NONE' },
  getFolderById: () => fakeFolder,
  getFileById(id) {
    const record = driveFiles.find((file) => file.id === String(id));
    if (!record) throw new Error('Berkas Drive tidak ditemukan.');
    return fileHandle(record);
  },
  getFoldersByName: () => ({ hasNext: () => true, next: () => fakeFolder }),
  createFolder: () => fakeFolder
};

const source = readFileSync(new URL('../gas/Code.gs', import.meta.url), 'utf8');
const exported = [
  'monthShift_', 'monthlyActivityIndex_', 'standardsMap_', 'keaktifanFor_',
  'eventsFeed_', 'publicData_', 'orgData_', 'orgSetStandard_', 'keaktifanSettings_',
  'orgSaveActivity_', 'orgSaveForm_', 'orgSaveArticle_', 'orgParticipants_', 'orgSetParticipantStatus_',
  'publicForm_', 'publicRegister_', 'requireOrg_', 'currentMonthKey_', 'todayKey_', 'APP', 'STANDARD_HEADERS',
  'doPost', 'throttle_', 'clientIp_', 'captchaIssue_', 'assertCaptcha_', 'kaderLogin_',
  'eventLike_', 'eventComment_', 'eventThread_', 'whoami_', 'publicSettings_',
  'actorOf_', 'safeActorKey_', 'chatIdentity_', 'guestSubject_', 'RATE_RULES', 'hashPassword_',
  'pustakaKorpus_', 'pustakaCocok_', 'pustakaRujukanAI_', 'pustakaPromptBagian_', 'driveKesiapan_',
  'ensureDefaultSettings_', 'sanitizeArticleHtml_', 'sanitizeLetterHtml_', 'saveArticle_', 'uploadImage_', 'driveImageUrl_',
  'orgUploadPdf_', 'orgUploadLetterImage_', 'orgSendLetter_', 'orgReadLetterAttachment_', 'orgReadLetterImage_',
  'perbaikiFotoDrive', 'bytesDariTeksAngka_',
  'pustakaDaftar_',
  'feedAksi_', 'feedList_', 'feedKonteks_', 'feedSkor_', 'feedTautanMedia_', 'videoKind_', 'feedCekIsi_', 'FEED_TAB', 'FEED_JENIS', 'SHEET_SCHEMA', 'POST_HEADERS',
  'bersihkanSisaFeed_', 'buangBerkasDrive_'
].join(', ');
const load = new Function(
  'SpreadsheetApp', 'PropertiesService', 'Session', 'Utilities', 'CacheService', 'ContentService', 'LockService', 'HtmlService', 'UrlFetchApp', 'DriveApp', 'AppLog',
  `${source}\nreturn { ${exported} };`
);
const gas = load(SpreadsheetApp, PropertiesService, Session, Utilities, CacheService,
  ContentService,
  { getScriptLock: () => ({ waitForLock: () => true, waitLock: () => true, hasLock: () => true, releaseLock() {} }) },
  { createTemplateOutput: () => ({ evaluate: () => ({ getContent: () => '' }) }) },
  UrlFetchApp,
  DriveApp,
  { info() {}, warn() {} });

// ------------------------------------------------------------------ fixtures

const today = gas.todayKey_();
const month = gas.currentMonthKey_();
const lastMonth = gas.monthShift_(month, -1);
const ancient = gas.monthShift_(month, -8) + '-05';
const future = gas.monthShift_(month, 1) + '-12';

seed('Settings', [
  { key: 'siteName', value: 'PB PII' },
  { key: 'keaktifanMinPerMonth', value: '2' },
  { key: 'googleClientId', value: 'fixture-client.apps.googleusercontent.com' },
  { key: 'kaderCommentDailyLimit', value: '3' }
]);
seed('Orgs', [
  { id: 'pb-pii', jenjang: 'PB', name: 'Pengurus Besar PII', province: 'DKI Jakarta', parentId: '', status: 'verified' },
  { id: 'pw-kalbar', jenjang: 'PW', name: 'PW Kalimantan Barat', province: 'Kalimantan Barat', parentId: 'pb-pii', status: 'verified' },
  { id: 'pd-pontianak', jenjang: 'PD', name: 'PD Kota Pontianak', province: 'Kalimantan Barat', district: 'Kota Pontianak', parentId: 'pw-kalbar', status: 'verified' },
  { id: 'pk-untan', jenjang: 'PK', name: 'PK Universitas Tanjungpura', province: 'Kalimantan Barat', district: 'Kota Pontianak', parentId: 'pd-pontianak', status: 'verified' },
  { id: 'pk-poltek', jenjang: 'PK', name: 'PK Poltek Negeri Pontianak', province: 'Kalimantan Barat', district: 'Kota Pontianak', parentId: 'pd-pontianak', status: 'verified' },
  { id: 'pd-singkawang', jenjang: 'PD', name: 'PD Kota Singkawang', province: 'Kalimantan Barat', district: 'Kota Singkawang', parentId: 'pw-kalbar', status: 'verified' }
]);
seed('Activities', [
  { id: 'act-kadaria', orgId: 'pk-untan', title: 'Kajian Dasar Rohis', category: 'Kajian', date: today, location: 'Masjid Ulum Agama', description: 'Kajian rutin kader baru.', participants: 40, status: 'published', createdAt: `${today}T08:00:00.000Z`, updatedAt: `${today}T08:00:00.000Z` },
  { id: 'act-lk-tingkat', orgId: 'pk-untan', title: 'Latihan Kepemimpinan Tingkat 1', category: 'Pendidikan', date: future, location: 'Aula Fakultas Hukum UNTAN', description: 'Pendidikan dasar bagi kader PII dengan kelas persiapan dan sesi outdoor.', participants: 120, status: 'published', createdAt: `${today}T09:00:00.000Z`, updatedAt: `${today}T09:00:00.000Z` },
  { id: 'act-draft', orgId: 'pk-untan', title: 'Rapat Koordinasi Internal', category: 'Organisasi', date: today, location: 'Sekretariat', description: 'Belum dibuka untuk umum.', participants: 0, status: 'draft', createdAt: `${today}T10:00:00.000Z`, updatedAt: `${today}T10:00:00.000Z` },
  { id: 'act-lama', orgId: 'pk-untan', title: 'Bakti Sosial Lama', category: 'Sosial', date: ancient, location: 'Sungai Raya', description: 'Sudah lewat dan keluar jendela umpan.', participants: 25, status: 'published', createdAt: `${ancient}T08:00:00.000Z`, updatedAt: `${ancient}T08:00:00.000Z` },
  { id: 'act-pd', orgId: 'pd-pontianak', title: 'Baitul Arqam Guru', category: 'Pendidikan', date: lastMonth + '-20', location: 'Pontianak', description: 'Kegiatan bulan lalu, tidak dihitung bulan ini.', participants: 60, status: 'published', createdAt: `${lastMonth}-20T08:00:00.000Z`, updatedAt: `${lastMonth}-20T08:00:00.000Z` },
  { id: 'act-poltek', orgId: 'pk-poltek', title: 'Workshop Esai Nasional', category: 'Karya Tulis', date: today, location: 'Kampus Poltek', description: 'Pendampingan menulis karya ilmiah.', participants: 15, status: 'published', createdAt: `${today}T07:00:00.000Z`, updatedAt: `${today}T07:00:00.000Z` }
]);
seed('Forms', [
  { id: 'form-lk-closed', orgId: 'pk-untan', activityId: 'act-lk-tingkat', title: 'Pendaftaran LK-1 (ditutup)', description: 'Gelombang pertama sudah ditutup.', status: 'closed', createdAt: `${today}T06:00:00.000Z`, updatedAt: `${today}T06:00:00.000Z` },
  { id: 'form-lk-open', orgId: 'pk-untan', activityId: 'act-lk-tingkat', title: 'Pendaftaran LK-1 Gelombang 2', description: 'Kuota tersisa terbatas.', status: 'open', createdAt: `${today}T06:30:00.000Z`, updatedAt: `${today}T06:30:00.000Z` },
  { id: 'form-kadaria', orgId: 'pk-untan', activityId: 'act-kadaria', title: 'Formulir Kajian', description: '', status: 'open', createdAt: `${today}T06:00:00.000Z`, updatedAt: `${today}T06:00:00.000Z` }
]);
seed('Participants', [
  { id: 'p1', formId: 'form-lk-open', orgId: 'pk-untan', name: 'Aisyah', institution: 'SMAN 1', phone: '0811', email: '', note: '', createdAt: `${today}T10:00:00.000Z` },
  { id: 'p2', formId: 'form-lk-open', orgId: 'pk-untan', name: 'Bilal', institution: 'SMAN 2', phone: '0812', email: '', note: '', createdAt: `${today}T10:05:00.000Z` },
  { id: 'p3', formId: 'form-lk-closed', orgId: 'pk-untan', name: 'Khadijah', institution: '', phone: '', email: 'k@example.id', note: '', createdAt: `${today}T09:00:00.000Z` }
]);
seed('Articles', [{ id: 'a1', title: 'PII Level Up', slug: 'pii-level-up', category: 'Berita', excerpt: '', content: '', coverImage: '', author: 'PB PII', status: 'published', createdAt: `${today}T00:00:00.000Z`, updatedAt: `${today}T00:00:00.000Z` }]);
seed('Gallery', []);
seed('Letters', []);
seed('Sessions', []);
seed('Chat', []);
seed('Standards', [
  { id: 'pd-pontianak', orgId: 'pd-pontianak', minPerMonth: 3, setByOrgId: 'pw-kalbar', setByName: 'PW Kalimantan Barat', note: 'Standar daerah.', updatedAt: `${today}T05:00:00.000Z` },
  { id: 'pk-poltek', orgId: 'pk-poltek', minPerMonth: 1, setByOrgId: 'pd-pontianak', setByName: 'PD Kota Pontianak', note: '', updatedAt: `${today}T05:00:00.000Z` }
]);
seed('Kaders', [
  { id: 'kader-rozak', email: 'rozak@example.com', name: 'Rozak', picture: 'https://lh3.googleusercontent.com/a/rozak', googleSub: 'sub-rozak', createdAt: `${today}T04:00:00.000Z`, lastLoginAt: `${today}T04:00:00.000Z`, note: '' }
]);
seed('Reactions', [
  { id: 'r1', eventId: 'act-kadaria', actorKey: 'k:kader-rozak', actorName: 'Rozak', kind: 'like', createdAt: `${today}T05:00:00.000Z` },
  { id: 'r2', eventId: 'act-kadaria', actorKey: 'k:kader-lain', actorName: 'Kader Lain', kind: 'like', createdAt: `${today}T05:10:00.000Z` },
  { id: 'r3', eventId: 'act-kadaria', actorKey: 'o:pd-pontianak', actorName: 'PD Kota Pontianak', kind: 'like', createdAt: `${today}T05:20:00.000Z` },
  { id: 'r4', eventId: 'act-poltek', actorKey: 'k:kader-lain', actorName: 'Kader Lain', kind: 'like', createdAt: `${today}T05:30:00.000Z` }
]);
seed('Comments', [
  { id: 'c1', eventId: 'act-kadaria', actorKey: 'k:kader-rozak', actorName: 'Rozak', actorPicture: 'https://lh3.googleusercontent.com/a/rozak', text: 'Materinya lengkap, insyaallah hadir.', status: 'published', createdAt: `${today}T06:00:00.000Z`, updatedAt: `${today}T06:00:00.000Z` },
  { id: 'c2', eventId: 'act-kadaria', actorKey: 'k:kader-lain', actorName: 'Kader Lain', actorPicture: '', text: 'Kuota parkirnya diperhatikan, Pak.', status: 'published', createdAt: `${today}T06:30:00.000Z`, updatedAt: `${today}T06:30:00.000Z` },
  { id: 'c3', eventId: 'act-kadaria', actorKey: 'k:kader-hadir', actorName: 'Penyusup', actorPicture: '', text: 'cari pinjaman online', status: 'hidden', createdAt: `${today}T06:40:00.000Z`, updatedAt: `${today}T06:40:00.000Z` },
  { id: 'c4', eventId: 'act-poltek', actorKey: 'k:kader-lain', actorName: 'Kader Lain', actorPicture: '', text: 'Mantap untuk penulis muda.', status: 'published', createdAt: `${today}T06:50:00.000Z`, updatedAt: `${today}T06:50:00.000Z` }
]);

// -------------------------------------------------------------------- checks

const checks = [];
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  checks.push({ label, ok: a === e, actual: a, expected: e });
}

const savedSettings = SHEETS.Settings;
SHEETS.Settings = [
  { key: 'heroTitle', value: 'Organisasi Pelajar Tertua di Indonesia, Bergerak Sejak 4 Mei 1947' },
  { key: 'heroText', value: 'Salinan yang sudah diubah redaksi.' },
  { key: 'aboutText', value: 'Pelajar Islam Indonesia (PII) berdiri di Yogyakarta pada 4 Mei 1947 dan menjadi organisasi pelajar tertua di Indonesia. PII bergerak dalam bidang pendidikan dan kebudayaan dengan tujuan mewujudkan kesempurnaan pendidikan dan kebudayaan yang sesuai dengan Islam bagi segenap rakyat Indonesia dan umat manusia.' }
];
gas.ensureDefaultSettings_(new FakeSheet('Settings'));
check('homepage defaults migrate without overwriting editorial copy', [
  rowsOf('Settings').find((row) => row.key === 'heroTitle')?.value,
  rowsOf('Settings').find((row) => row.key === 'heroText')?.value,
  rowsOf('Settings').find((row) => row.key === 'aboutText')?.value
], [
  'Membina Pelajar, Menguatkan Pendidikan dan Kebudayaan',
  'Salinan yang sudah diubah redaksi.',
  'Buku Panduan Kelembagaan (PII) mencatat bahwa Pelajar Islam Indonesia lahir pada 4 Mei 1947 dan merupakan organisasi pelajar Islam tertua di Indonesia. Ebook Ta’dib PII merumuskan tujuan PII sebagai kesempurnaan pendidikan dan kebudayaan yang sesuai dengan Islam bagi seluruh rakyat Indonesia dan umat manusia.'
]);
SHEETS.Settings = savedSettings;

const savedArticle = gas.saveArticle_({
  title: 'Panduan kegiatan pelajar',
  slug: 'panduan-kegiatan-pelajar',
  status: 'published',
  content: '<h2>Persiapan</h2><p>Baca <a href="https://example.org/panduan">panduan</a>.</p>',
  seoTitle: 'Panduan kegiatan pelajar PII',
  seoDescription: 'Langkah ringkas untuk menyiapkan kegiatan pelajar.',
  seoKeywords: 'PII, kegiatan, pelajar'
});
const savedArticleRow = rowsOf('Articles').find((row) => row.id === savedArticle.id);
check('article rich text and SEO metadata are stored safely', [
  savedArticleRow.slug,
  savedArticleRow.content,
  savedArticleRow.seoTitle,
  savedArticleRow.seoDescription,
  savedArticleRow.seoKeywords
], [
  'panduan-kegiatan-pelajar',
  '<h2>Persiapan</h2><p>Baca <a href="https://example.org/panduan" rel="noopener noreferrer">panduan</a>.</p>',
  'Panduan kegiatan pelajar PII',
  'Langkah ringkas untuk menyiapkan kegiatan pelajar.',
  'PII, kegiatan, pelajar'
]);

check('article sanitizer removes scripts and unsafe formatting attributes', gas.sanitizeArticleHtml_(
  '<h2 style="color:red">Aman</h2><p onclick="evil()">Teks <a href="javascript:alert(1)">tautan</a></p>' +
  '<script>alert(1)</script><img src="https://example.org/foto.jpg" onerror="evil()" alt="Foto">'
), '<h2>Aman</h2><p>Teks <a>tautan</a></p><img src="https://example.org/foto.jpg" alt="Foto" loading="lazy">');
const orgArticle = gas.orgSaveArticle_(
  { id: 'pk-untan', name: 'PK Universitas Tanjungpura', status: 'verified' },
  { title: 'Kegiatan Kaderisasi', status: 'published', content: '<h2>Pelaksanaan</h2><script>buruk()</script><p>Berita lembaga.</p>' }
);
const storedOrgArticle = rowsOf('Articles').find((row) => row.id === orgArticle.id);
check('verified organization can publish a sanitized article under its ownership', [
  storedOrgArticle.orgId,
  storedOrgArticle.author,
  storedOrgArticle.status,
  storedOrgArticle.content
], [
  'pk-untan',
  'PK Universitas Tanjungpura',
  'published',
  '<h2>Pelaksanaan</h2><p>Berita lembaga.</p>'
]);
check('organization article is included in its own dashboard', gas.orgData_({ id: 'pk-untan' }).articles
  .some((article) => article.id === orgArticle.id), true);
check('published organization article is included in public content', gas.publicData_().articles
  .some((article) => article.id === orgArticle.id), true);
const duplicateOrgArticle = gas.orgSaveArticle_(
  { id: 'pk-untan', name: 'PK Universitas Tanjungpura', status: 'verified' },
  { title: 'Kegiatan Kaderisasi', status: 'draft', content: '<p>Draft kedua.</p>' }
);
check('organization article slugs remain unique across entries',
  rowsOf('Articles').find((row) => row.id === duplicateOrgArticle.id).slug !== storedOrgArticle.slug, true);
check('organization cannot edit another organization article', captureError(() => gas.orgSaveArticle_(
  { id: 'pk-poltek', name: 'PK Poltek Negeri Pontianak', status: 'verified' },
  { id: orgArticle.id, title: 'Diambil alih', status: 'published', content: '<p>Tidak boleh.</p>' }
)), 'Artikel ini bukan milik lembaga Anda.');
check('unverified organization cannot publish articles', captureError(() => gas.orgSaveArticle_(
  { id: 'pd-singkawang', name: 'PD Kota Singkawang', status: 'pending' },
  { title: 'Belum terverifikasi', status: 'published', content: '<p>Draft.</p>' }
)), 'Akun lembaga belum diverifikasi. Tunggu persetujuan atasan atau hubungi PB PII.');
check('letter sanitizer allows private image references but blocks external images', gas.sanitizeLetterHtml_(
  '<p>Isi surat</p><img src="https://example.org/pixel.png"><img src="pbpii-letter-image:private-image" alt="Rapat">'
), '<p>Isi surat</p><img src="pbpii-letter-image:private-image" alt="Rapat" loading="lazy">');

const photo = gas.uploadImage_({
  name: 'cover.jpg',
  data: Buffer.from([0xFF, 0xD8, 0xFF, 0x00]).toString('base64')
});
check('uploaded photos receive a working link-view permission', driveFiles.find((file) => file.id === photo.fileId)?.sharing, {
  access: 'ANYONE_WITH_LINK',
  permission: 'VIEW'
});
check('JPEG signature is detected from signed Apps Script bytes', photo.mime, 'image/jpeg');
check('uploaded JPEG bytes remain binary in Drive', driveFiles.find((file) => file.id === photo.fileId)?.bytes, [-1, -40, -1, 0]);
check('uploaded JPEG byte count matches the verified Drive file', photo.bytes, 4);
const pngPhoto = gas.uploadImage_({
  name: 'cover.png',
  data: Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x00]).toString('base64')
});
check('PNG signature is detected from signed Apps Script bytes', pngPhoto.mime, 'image/png');
corruptNextDriveRead = true;
check('upload rejects bytes that fail post-save verification',
  captureError(() => gas.uploadImage_({
    name: 'cover-corrupt.jpg',
    data: Buffer.from([0xFF, 0xD8, 0xFF, 0x00]).toString('base64')
  })),
  'Foto gagal diverifikasi setelah disimpan. Silakan coba unggah ulang.');

const senderOrg = rowsOf('Orgs').find((row) => row.id === 'pk-untan');
const receiverOrg = rowsOf('Orgs').find((row) => row.id === 'pd-pontianak');
const privateImage = gas.orgUploadLetterImage_(senderOrg, {
  name: 'Foto rapat.jpg',
  data: Buffer.from([0xFF, 0xD8, 0xFF, 0x00]).toString('base64'),
  ip: 'letter-image-upload-fixture'
});
check('letter inline images remain private in Drive', driveFiles.find((file) => file.id === privateImage.fileId)?.sharing, {
  access: 'PRIVATE',
  permission: 'VIEW'
});
const pdfBytes = Buffer.from('%PDF-1.7\nPII letter fixture');
const attachment = gas.orgUploadPdf_(senderOrg, {
  name: 'Surat resmi.pdf',
  data: pdfBytes.toString('base64'),
  ip: 'letter-upload-fixture'
});
const sentLetter = gas.orgSendLetter_(senderOrg, {
  toOrgId: receiverOrg.id,
  category: 'Kelembagaan',
  subject: 'Permohonan koordinasi',
  body: 'Isi surat resmi dengan gambar <img src="pbpii-letter-image:' + privateImage.fileId + '" alt="Foto rapat">',
  attachmentId: attachment.fileId,
  attachmentName: attachment.name
});
const massLetter = gas.orgSendLetter_(senderOrg, {
  toOrgIds: ['pd-pontianak', 'pw-kalbar'],
  category: 'Kelembagaan',
  subject: 'Undangan koordinasi jejaring',
  body: '<p>Mohon hadir dalam koordinasi.</p>'
});
check('one letter can be sent to multiple verified superior organizations', [
  massLetter.count,
  massLetter.ids.length,
  rowsOf('Letters').filter((row) => massLetter.ids.includes(row.id)).map((row) => row.toOrgId).sort()
], [2, 2, ['pd-pontianak', 'pw-kalbar']]);
let deniedMassRecipient = false;
try {
  gas.orgSendLetter_(senderOrg, {
    toOrgIds: ['pd-pontianak', 'pd-singkawang'],
    category: 'Kelembagaan',
    subject: 'Tujuan di luar jejaring',
    body: 'Tidak boleh terkirim sebagian.'
  });
} catch (error) {
  deniedMassRecipient = /jejaring/.test(error.message);
}
check('mass delivery is rejected if any recipient is outside the sender network', deniedMassRecipient, true);
const receivedPdf = gas.orgReadLetterAttachment_(receiverOrg, sentLetter.id);
check('letter PDF is readable by its recipient', [
  receivedPdf.name,
  receivedPdf.mime,
  Buffer.from(receivedPdf.data, 'base64').toString()
], [attachment.name, 'application/pdf', pdfBytes.toString()]);
check('letter PDF remains private in Drive', driveFiles.find((file) => file.id === attachment.fileId)?.sharing, {
  access: 'PRIVATE',
  permission: 'VIEW'
});
const receivedImage = gas.orgReadLetterImage_(receiverOrg, sentLetter.id, privateImage.fileId);
check('a recipient can read only inline images embedded in their letter', [
  receivedImage.mime,
  Buffer.from(receivedImage.data, 'base64').toString('hex')
], ['image/jpeg', 'ffd8ff00']);
const reply = gas.orgSendLetter_(receiverOrg, {
  toOrgId: senderOrg.id,
  category: 'Kelembagaan',
  subject: 'Re: Permohonan koordinasi',
  body: 'Balasan untuk surat tersebut.',
  replyToId: sentLetter.id
});
check('a direct superior can reply in the original letter thread', [
  reply.replyToId,
  reply.threadId
], [sentLetter.id, sentLetter.threadId]);
let deniedReply = false;
try {
  gas.orgSendLetter_(receiverOrg, {
    toOrgId: 'pw-kalbar',
    category: 'Kelembagaan',
    subject: 'Balasan salah tujuan',
    body: 'Tidak boleh keluar dari percakapan.',
    replyToId: sentLetter.id
  });
} catch (error) {
  deniedReply = /Balasan harus dikirim/.test(error.message);
}
check('letter replies cannot be redirected to another organization', deniedReply, true);
let deniedPdfRead = false;
try {
  gas.orgReadLetterAttachment_(rowsOf('Orgs').find((row) => row.id === 'pw-kalbar'), sentLetter.id);
} catch (error) {
  deniedPdfRead = /hanya dapat dibuka/.test(error.message);
}
check('unrelated organizations cannot read letter attachments', deniedPdfRead, true);
let deniedImageRead = false;
try {
  gas.orgReadLetterImage_(rowsOf('Orgs').find((row) => row.id === 'pw-kalbar'), sentLetter.id, privateImage.fileId);
} catch (error) {
  deniedImageRead = /hanya dapat dibuka/.test(error.message);
}
check('unrelated organizations cannot read private letter images', deniedImageRead, true);

const orgs = [];
const byId = {};
['pb-pii', 'pw-kalbar', 'pd-pontianak', 'pk-untan', 'pk-poltek', 'pd-singkawang'].forEach((id) => {
  const row = rowsOf('Orgs').find((item) => item.id === id);
  byId[id] = row;
  orgs.push(row);
});
const standards = gas.standardsMap_();
const monthIndex = gas.monthlyActivityIndex_(rowsOf('Activities'));
const fallback = gas.keaktifanSettings_().defaultMin;
const keaktifanOf = (id) => gas.keaktifanFor_(id, orgs, byId, standards, monthIndex, month, fallback);

check('standar PK tanpa ketentuan sendiri warisan PD', keaktifanOf('pk-untan').min, 3);
check('penetap standar PK terbaca sebagai PD', keaktifanOf('pk-untan').setBy.name, 'PD Kota Pontianak');
check('sumber standar warisan', keaktifanOf('pk-untan').source, 'org');
check('ketentuan sendiri menang atas warisan', keaktifanOf('pk-poltek').min, 1);
check('kegiatan terbit bulan ini dihitung', keaktifanOf('pk-untan').count, 1);
check('kegiatan draft tidak dihitung', keaktifanOf('pk-poltek').count, 1);
check('kegiatan bulan lalu tidak masuk bulan ini', keaktifanOf('pd-pontianak').count, 0);
check('jumlah peserta kegiatan jadi bukti keaktifan', keaktifanOf('pk-untan').participants, 40);
check('kegiatan bulan depan belum dihitung', keaktifanOf('pk-untan').sisa, 2);
check('sisa kekurangan menuju standar', keaktifanOf('pk-poltek').sisa, 0);
check('persentase keaktifan', keaktifanOf('pk-poltek').persen, 100);
check('lembaga tanpa ketentuan apa pun memakai bawaan Settings', keaktifanOf('pd-singkawang').min, 2);
check('sumber bawaan', keaktifanOf('pd-singkawang').source, 'default');
check('pergeseran bulan menembus tahun', gas.monthShift_('2026-01', -1), '2025-12');
check('pergeseran bulan maju', gas.monthShift_(month, 2), expectAdvance(month, 2));
function expectAdvance(key, delta) {
  const [year, monthNumber] = key.split('-').map(Number);
  const total = year * 12 + (monthNumber - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

const feed = gas.eventsFeed_(orgs, rowsOf('Activities'), rowsOf('Forms'), rowsOf('Participants'), 'k:kader-rozak');
const upcoming = feed.filter((event) => event.upcoming);
const lk = feed.find((event) => event.id === 'act-lk-tingkat');
check('umpan mengecualikan draft', feed.some((event) => event.id === 'act-draft'), false);
check('umpan mengecualikan kegiatan terlalu lama', feed.some((event) => event.id === 'act-lama'), false);
check('agenda mendatang terurut terdekat dulu', upcoming.map((event) => event.id), ['act-lk-tingkat', 'act-kadaria', 'act-poltek']);
check('tautan pendaftaran memakai formulir yang dibuka', lk.form.url, 'formulir.html?id=form-lk-open');
check('peserta formulir terbuka dihitung', lk.form.registered, 2);
check('kuota berasal dari kegiatan', lk.form.quota, 120);
check('penyelenggara ikut terbawa', lk.host.jenjangLabel, 'Pengurus Komisariat');
check('kategori terbawa', lk.category, 'Pendidikan');
const kadaria = feed.find((event) => event.id === 'act-kadaria');
check('tanggal tampil di kartu acara', kadaria.date, today);
check('jumlah suka terbawa ke umpan', kadaria.likes, 3);
check('suka milik kader sendiri ditandai', kadaria.liked, true);
check('komentar disembunyikan tidak ikut tampil', kadaria.commentCount, 2);
check('pratinjau komentar terbaru dua saja', kadaria.comments.map((item) => item.author), ['Rozak', 'Kader Lain']);
check('komentar milik sendiri ditandai', kadaria.comments.map((item) => item.mine), [true, false]);
check('pengunjung tanpa akun tidak punya suka', gas.eventsFeed_(orgs, rowsOf('Activities'), rowsOf('Forms'), rowsOf('Participants'), '')
  .find((event) => event.id === 'act-kadaria').liked, false);
check('kegiatan tanpa formulir tidak punya tombol daftar', feed.find((event) => event.id === 'act-poltek').form, null);
check('umpan terurut tanggal menurun', feed.map((event) => event.date), feed.map((event) => event.date).sort().reverse());

const feedStateActivity = {
  id: 'act-feed-state', orgId: 'pk-untan', title: 'Status pendaftaran umpan', category: 'Kegiatan',
  date: future, status: 'published', participants: 5, quota: 2,
  registrationDeadline: `${month}-28T23:59`
};
const feedStateForm = { id: 'form-feed-state', orgId: 'pk-untan', activityId: feedStateActivity.id, title: 'Formulir umpan', status: 'open' };
const feedStateParticipants = [
  { id: 'feed-accepted', formId: feedStateForm.id, status: 'accepted' },
  { id: 'feed-rejected', formId: feedStateForm.id, status: 'rejected' }
];
const feedState = gas.eventsFeed_(orgs, [feedStateActivity], [feedStateForm], feedStateParticipants, '')
  .find((event) => event.id === feedStateActivity.id);
check('umpan tidak menghitung peserta yang ditolak', [feedState.form.registered, feedState.form.quota, feedState.form.remaining], [1, 2, 1]);
check('umpan memakai status pendaftaran terbuka selama kuota dan deadline aman', feedState.form.status, 'open');

const deadlineActivity = { ...feedStateActivity, id: 'act-feed-deadline', registrationDeadline: `${month}-01T00:00` };
const deadlineFeed = gas.eventsFeed_(orgs, [deadlineActivity], [{ ...feedStateForm, activityId: deadlineActivity.id }], [], '')
  .find((event) => event.id === deadlineActivity.id);
check('umpan menampilkan formulir sebagai tertutup setelah batas daftar', [deadlineFeed.form.status, deadlineFeed.form.closedReason], ['closed', 'Batas waktu pendaftaran sudah berakhir.']);

const publicPayload = gas.publicData_();
check('aksi public ikut mengirim events', Array.isArray(publicPayload.events), true);
check('bawaan keaktifan terbawa ke situs publik', publicPayload.keaktifan.defaultMin, 2);
check('backend mengumumkan jalur akun yang didukung', publicPayload.capabilities, { kaderEmail: true, chat: true });

const dashboard = gas.orgData_({ id: 'pd-pontianak' });
check('dashboard lembaga memuat keaktifan sendiri', dashboard.keaktifan.month, month);
check('dashboard anak lembaga memuat standar', dashboard.network.map((item) => `${item.id}:${item.keaktifan.min}`).sort(), ['pk-poltek:1', 'pk-untan:3']);
check('induk boleh menetapkan standar', dashboard.keaktifanInfo.canSetStandards, true);
check('punya ketentuan sendiri terbaca', dashboard.keaktifanInfo.ownStandard, true);
check('tren enam bulan tersedia', dashboard.keaktifanTrend.length, 6);

const setByParent = gas.orgSetStandard_({ id: 'pd-pontianak', jenjang: 'PD', name: 'PD Kota Pontianak', status: 'verified' }, { orgId: 'pk-untan', minPerMonth: 4 });
check('atasan langsung dapat menetapkan standar', setByParent, { orgId: 'pk-untan', orgName: 'PK Universitas Tanjungpura', minPerMonth: 4, cleared: false, setByName: 'PD Kota Pontianak' });
check('standar baru langsung berlaku', keaktifanOf('pk-untan') === null ? null : gas.keaktifanFor_('pk-untan', orgs, byId, gas.standardsMap_(), monthIndex, month, fallback).min, 4);

const rejected = captureError(() => gas.orgSetStandard_({ id: 'pk-poltek', jenjang: 'PK', name: 'PK Poltek', status: 'verified' }, { orgId: 'pk-untan', minPerMonth: 9 }));
check('sesama PK tidak boleh menetapkan standar', rejected, 'Hanya lembaga di atasnya secara berjenjang yang dapat menetapkan standar ini.');
const selfSet = captureError(() => gas.orgSetStandard_({ id: 'pd-pontianak', jenjang: 'PD', name: 'PD Kota Pontianak', status: 'verified' }, { orgId: 'pd-pontianak', minPerMonth: 9 }));
check('lembaga tidak bisa menetapkan standar sendiri', selfSet, 'Standar lembaga sendiri ditetapkan oleh atasan Anda.');
const tooBig = captureError(() => gas.orgSetStandard_({ id: 'pw-kalbar', jenjang: 'PW', name: 'PW Kalimantan Barat', status: 'verified' }, { orgId: 'pd-pontianak', minPerMonth: 99 }));
check('angka standar dibatasi 0-60', tooBig, 'Isi standar keaktifan dengan angka 0 sampai 60 kegiatan per bulan.');
const unverified = captureError(() => gas.orgSetStandard_({ id: 'pd-pontianak', jenjang: 'PD', name: 'PD Kota Pontianak', status: 'pending' }, { orgId: 'pk-untan', minPerMonth: 2 }));
check('akun belum terverifikasi ditolak', unverified, 'Akun lembaga belum diverifikasi. Tunggu persetujuan atasan atau hubungi PB PII.');
const cleared = gas.orgSetStandard_({ id: 'pw-kalbar', jenjang: 'PW', name: 'PW Kalimantan Barat', status: 'verified' }, { orgId: 'pk-untan', minPerMonth: 0 });
check('angka nol menghapus ketentuan khusus', cleared.cleared, true);
check('setelah dihapus, warisan PD kembali berlaku', gas.keaktifanFor_('pk-untan', orgs, byId, gas.standardsMap_(), monthIndex, month, fallback).min, 3);
const grandParent = gas.orgSetStandard_({ id: 'pw-kalbar', jenjang: 'PW', name: 'PW Kalimantan Barat', status: 'verified' }, { orgId: 'pk-poltek', minPerMonth: 5 });
check('lembaga dua tingkat di atas juga boleh menetapkan', grandParent.minPerMonth, 5);

const linked = gas.orgSaveActivity_({ id: 'pk-untan', jenjang: 'PK', name: 'PK Universitas Tanjungpura', status: 'verified' }, { title: 'Rihlah Dakwah', date: future, category: 'Dakwah', location: 'Nanga Pinoh', description: 'Perjalanan dakwah kader.', participants: 30, status: 'published', formId: 'form-kadaria' });
check('kegiatan baru tersimpan', rowsOf('Activities').some((row) => row.title === 'Rihlah Dakwah'), true);
check('formulir terpilih tertaut ke kegiatan baru', rowsOf('Forms').find((row) => row.id === 'form-kadaria').activityId, linked.id);
const foreignForm = captureError(() => gas.orgSaveActivity_({ id: 'pk-untan', jenjang: 'PK', name: 'PK Universitas Tanjungpura', status: 'verified' }, { title: 'Salah Form', date: future, status: 'published', formId: 'pd-singkawang-tidak-ada' }));
check('formulir yang tidak ada ditolak', foreignForm, 'Formulir pendaftaran tidak ditemukan.');

const customFields = [
  { id: 'name', type: 'short', label: 'Nama lengkap', required: true, maxLength: 120 },
  { id: 'phone', type: 'phone', label: 'Nomor WhatsApp', required: true },
  { id: 'email', type: 'email', label: 'Email' },
  { id: 'info', type: 'info', label: 'Informasi', help: 'Bawa kartu pelajar.' },
  { id: 'jenis', type: 'radio', label: 'Kategori peserta', required: true, options: ['Pelajar', 'Umum'] },
  { id: 'minat', type: 'checkbox', label: 'Sesi yang diminati', options: ['Diskusi', 'Simulasi'] },
  { id: 'usia', type: 'number', label: 'Usia', required: true },
  { id: 'persetujuan', type: 'consent', label: 'Saya menyetujui tata tertib', required: true }
];
const customActivity = gas.orgSaveActivity_(senderOrg, {
  title: 'Sekolah Advokasi Pelajar', date: future, startTime: '08:30', endTime: '12:00',
  registrationDeadline: '2099-12-31T23:59', quota: 2, additionalInfo: 'Datang 15 menit lebih awal.',
  category: 'Pendidikan', location: 'Aula PB PII', participants: 0, status: 'published',
  form: { enabled: true, status: 'open', description: 'Isi data dengan benar.', fields: customFields }
});
const customActivityRow = rowsOf('Activities').find((row) => row.id === customActivity.id);
const customFormRow = rowsOf('Forms').find((row) => row.id === customActivity.formId);
check('event dan custom form tersimpan dalam satu aksi', [
  Boolean(customActivity.formId), customActivityRow.startTime, customActivityRow.endTime,
  customActivityRow.quota, customFormRow.activityId, JSON.parse(customFormRow.fields).length
], [true, '08:30', '12:00', 2, customActivity.id, 8]);
const customPublic = gas.publicForm_(customActivity.formId);
check('form publik menerima definisi field dan status kuota', [
  customPublic.fields.find((field) => field.id === 'jenis').options,
  customPublic.registrationOpen, customPublic.remaining, customPublic.activity.additionalInfo
], [['Pelajar', 'Umum'], true, 2, 'Datang 15 menit lebih awal.']);
check('form lama otomatis memakai field bawaan yang kompatibel',
  gas.publicForm_('form-lk-open').fields.map((field) => field.id), ['name', 'institution', 'phone', 'email', 'note']);
const customAnswers = {
  name: 'Peserta Dinamis', phone: '0812000111', email: '', jenis: 'Pelajar',
  minat: ['Diskusi', 'Simulasi'], usia: 17, persetujuan: true
};
check('field wajib divalidasi di server', captureError(() => gas.publicRegister_({
  formId: customActivity.formId, ip: 'dynamic-missing', answers: { ...customAnswers, jenis: '' }
})), 'Field "Kategori peserta" wajib diisi.');
check('pilihan di luar definisi ditolak', captureError(() => gas.publicRegister_({
  formId: customActivity.formId, ip: 'dynamic-option', answers: { ...customAnswers, jenis: 'Pilihan palsu' }
})), 'Pilihan pada field "Kategori peserta" tidak valid.');
const dynamicRegistration = gas.publicRegister_({
  formId: customActivity.formId, ip: 'dynamic-success', registrationKey: 'dynamic-registration-key-1', answers: customAnswers
});
const dynamicParticipant = rowsOf('Participants').find((row) => row.id === dynamicRegistration.id);
check('jawaban dinamis dan kolom kompatibilitas tersimpan', [
  dynamicParticipant.name, dynamicParticipant.phone, dynamicParticipant.status,
  JSON.parse(dynamicParticipant.answers).minat, dynamicRegistration.registrationCode
], ['Peserta Dinamis', '0812000111', 'pending', ['Diskusi', 'Simulasi'], gas.publicRegister_({
  formId: customActivity.formId, ip: 'dynamic-replay', registrationKey: 'dynamic-registration-key-1', answers: customAnswers
}).registrationCode]);
check('retry dengan kunci yang sama tidak menggandakan peserta',
  rowsOf('Participants').filter((row) => row.formId === customActivity.formId).length, 1);
gas.publicRegister_({
  formId: customActivity.formId, ip: 'dynamic-second', registrationKey: 'dynamic-registration-key-2',
  answers: { ...customAnswers, name: 'Peserta Kedua', phone: '0812000222' }
});
check('kuota ditutup setelah pendaftar mencapai batas', captureError(() => gas.publicRegister_({
  formId: customActivity.formId, ip: 'dynamic-third', registrationKey: 'dynamic-registration-key-3',
  answers: { ...customAnswers, name: 'Peserta Ketiga', phone: '0812000333' }
})), 'Kuota peserta sudah penuh.');
const customParticipants = gas.orgParticipants_(senderOrg, customActivity.formId);
check('pengelola menerima jawaban, kode, dan statistik peserta', [
  customParticipants.stats.total,
  customParticipants.participants.find((row) => row.id === dynamicRegistration.id).answers.jenis,
  customParticipants.participants.every((row) => row.registrationCode.startsWith('PII-'))
], [2, 'Pelajar', true]);
gas.orgSetParticipantStatus_(senderOrg, dynamicRegistration.id, 'accepted');
check('keputusan peserta tersimpan dan statistik berubah', [
  rowsOf('Participants').find((row) => row.id === dynamicRegistration.id).status,
  gas.orgParticipants_(senderOrg, customActivity.formId).stats.accepted
], ['accepted', 1]);
check('lembaga lain tidak dapat mengubah peserta', captureError(() => gas.orgSetParticipantStatus_(
  rowsOf('Orgs').find((row) => row.id === 'pk-poltek'), dynamicRegistration.id, 'rejected'
)), 'Peserta ini bukan milik formulir lembaga Anda.');
check('field nama wajib tidak dapat dihapus', captureError(() => gas.orgSaveForm_(senderOrg, {
  title: 'Tanpa nama', fields: [{ id: 'email', type: 'email', label: 'Email', required: true }]
})), 'Field Nama lengkap wajib ada, bertipe jawaban singkat, dan wajib diisi.');

// -------------------------------------- keamanan: pembatas laju, captcha, akun

const sesiBerlaku = new Date(Date.now() + 3600 * 1000).toISOString();
seed('Sessions', [
  { token: 'ses-rozak', kind: 'kader', subject: 'kader-rozak', createdAt: `${today}T07:00:00.000Z`, expiresAt: sesiBerlaku },
  { token: 'ses-kuota', kind: 'kader', subject: 'kader-kuota', createdAt: `${today}T07:00:00.000Z`, expiresAt: sesiBerlaku },
  { token: 'ses-panjang', kind: 'kader', subject: 'kader-panjang', createdAt: `${today}T07:00:00.000Z`, expiresAt: sesiBerlaku },
  { token: 'ses-pd', kind: 'org', subject: 'pd-pontianak', createdAt: `${today}T07:00:00.000Z`, expiresAt: sesiBerlaku },
  { token: 'ses-poltek', kind: 'org', subject: 'pk-poltek', createdAt: `${today}T07:00:00.000Z`, expiresAt: sesiBerlaku },
  { token: 'ses-admin', kind: 'admin', subject: 'admin', createdAt: `${today}T07:00:00.000Z`, expiresAt: sesiBerlaku },
  { token: 'ses-kedaluwarsa', kind: 'kader', subject: 'kader-rozak', createdAt: `${ancient}T07:00:00.000Z`, expiresAt: `${ancient}T07:00:00.000Z` }
]);
seed('Kaders', [
  { id: 'kader-kuota', email: 'kuota@example.com', name: 'Kader Kuota', picture: '', googleSub: 'sub-kuota', createdAt: `${today}T04:00:00.000Z`, lastLoginAt: `${today}T04:00:00.000Z`, note: '' },
  { id: 'kader-panjang', email: 'panjang@example.com', name: 'Kader Panjang', picture: '', googleSub: 'sub-panjang', createdAt: `${today}T04:00:00.000Z`, lastLoginAt: `${today}T04:00:00.000Z`, note: '' }
]);
seed('Comments', [
  { id: 'cq1', eventId: 'act-poltek', actorKey: 'k:kader-kuota', actorName: 'Kader Kuota', actorPicture: '', text: 'Komentar satu.', status: 'published', createdAt: `${today}T07:10:00.000Z`, updatedAt: `${today}T07:10:00.000Z` },
  { id: 'cq2', eventId: 'act-poltek', actorKey: 'k:kader-kuota', actorName: 'Kader Kuota', actorPicture: '', text: 'Komentar dua.', status: 'published', createdAt: `${today}T07:20:00.000Z`, updatedAt: `${today}T07:20:00:000Z` },
  { id: 'cq3', eventId: 'act-poltek', actorKey: 'k:kader-kuota', actorName: 'Kader Kuota', actorPicture: '', text: 'Komentar tiga.', status: 'published', createdAt: `${today}T07:30:00.000Z`, updatedAt: `${today}T07:30:00:000Z` }
]);

/** Memanggil API yang sama dengan browser: satu pintu doPost, satu token JSON. */
function request(body) {
  const response = gas.doPost({ postData: { contents: JSON.stringify(body) } });
  return JSON.parse(response.getContentText());
}

/**
 * Cloudflare Turnstile satu-satunya verifikasi, jadi kunci pengujinya dipasang
 * lebih dulu; blok di bawah mengembalikan lagi keadaan belum ber kunci.
 */
function aturSetting(key, value) {
  const row = rowsOf('Settings').find((item) => item.key === key);
  if (row) row.value = value;
  else seed('Settings', [{ key, value }]);
}
aturSetting('turnstileSiteKey', 'site-key-abc');
aturSetting('turnstileSecret', 'secret-xyz');
http.turnstile = { success: true };

/** Browser mengirim token dari widget, bukan jawaban hitungan. */
const TOKEN_MANUSIA = { captchaToken: 'tok-manusia' };

const percobaanLogin = [];
for (let i = 0; i < 9; i += 1) {
  percobaanLogin.push(request({ action: 'login', username: 'pb', password: 'tebakan', ip: '9.9.9.9' }));
}
check('delapan percobaan login pertama dilayani normal', percobaanLogin.slice(0, 8).every((item) => item.ok === false && item.code !== 'rate_limited'), true);
check('percobaan login kesembilan dibatasi laju', percobaanLogin[8].code, 'rate_limited');
check('jawaban pembatas menyertakan hitung tunggu', typeof percobaanLogin[8].retryAfter, 'number');
check('pembatas laju memakai kunci IP dari proxy', gas.clientIp_({ ip: '203.0.113.7, 10.0.0.1' }), '203.0.113.7');
check('masuk admin tanpa centang Turnstile ditolak', request({ action: 'login', username: 'pb', password: 'tebakan', ip: '9.9.9.8' }).code, 'captcha');
check('masuk lembaga tanpa centang Turnstile ditolak', request({ action: 'orgLogin', email: 'pk-baru@example.com', password: 'tebakan', ip: '198.51.100.45' }).code, 'captcha');

let lewatBeruntun = 0;
for (let i = 0; i < gas.RATE_RULES.chat.limit + 1; i += 1) {
  try {
    gas.throttle_('chat', '198.51.100.30');
    lewatBeruntun += 1;
  } catch (error) {
    lewatBeruntun += 0;
  }
}
check('pertanyaan Tanya PII dibatasi per menit', lewatBeruntun, gas.RATE_RULES.chat.limit);

const widget = request({ action: 'captcha', ip: '203.0.113.7' });
check('browser ditawari widget Turnstile, bukan soal hitung', widget.data, { kind: 'turnstile', siteKey: 'site-key-abc' });
const payloadPublic = request({ action: 'public', ip: '203.0.113.7' });
check('kunci rahasia tidak pernah keluar ke browser', 'turnstileSecret' in payloadPublic.data.settings, false);
check('kunci situs Turnstile boleh dilihat browser', payloadPublic.data.settings.turnstileSiteKey, 'site-key-abc');
const paketAdmin = request({ action: 'adminData', token: 'ses-admin' });
check('dasbor admin pun tidak menerima nilai secret', 'turnstileSecret' in paketAdmin.data.settings, false);
check('dasbor admin hanya menerima penanda secret terisi', paketAdmin.data.settings.turnstileSecretSet, true);
const hasilSimpan = request({ action: 'saveSettings', token: 'ses-admin', settings: { turnstileSiteKey: 'site-key-abc', turnstileSecret: 'secret-xyz' } });
check('simpan pengaturan membalas penanda, bukan nilai secret', hasilSimpan.data.turnstileSecretSet, true);
check('umpan simpan tidak pernah membawa nilai secret', 'turnstileSecret' in hasilSimpan.data, false);

const tanpaVerifikasi = request({ action: 'publicRegister', formId: 'form-kadaria', name: 'Nur Aisyah', phone: '081234567890', ip: '203.0.113.7' });
check('pendaftaran tanpa centang Turnstile ditolak', tanpaVerifikasi.code, 'captcha');
const pesertaAwal = rowsOf('Participants').length;
http.turnstile = { success: false, 'error-codes': ['bad-request'] };
const ditolak = request({ action: 'publicRegister', formId: 'form-kadaria', name: 'Spam Bot', phone: '081100011', ip: '203.0.113.7', ...TOKEN_MANUSIA });
check('token yang ditolak Cloudflare gagal masuk', ditolak.code, 'captcha');
http.turnstile = { success: true };
check('peserta baru tidak tercatat ketika ditolak', rowsOf('Participants').length, pesertaAwal);
const benar = request({ action: 'publicRegister', formId: 'form-kadaria', name: 'Nur Aisyah', phone: '081234567890', ip: '203.0.113.7', ...TOKEN_MANUSIA });
check('pendaftaran lolos dengan centang Turnstile', benar.ok, true);
check('peserta tercatat satu baris', rowsOf('Participants').length, pesertaAwal + 1);
const daftarLembaga = request({ action: 'orgRegister', jenjang: 'PK', province: 'Kalimantan Barat', district: 'Kota Pontianak', subdistrict: 'Kec. Pontianak Timur', email: 'pk-baru@example.com', password: 'rahasia123', ip: '198.51.100.40' });
check('pendaftaran lembaga juga butuh centang Turnstile', daftarLembaga.code, 'captcha');
const daftarLolos = request({ action: 'orgRegister', jenjang: 'PK', province: 'Kalimantan Barat', district: 'Kota Pontianak', subdistrict: 'Kec. Pontianak Timur', email: 'pk-baru@example.com', password: 'rahasia123', ip: '198.51.100.40', ...TOKEN_MANUSIA });
check('lembaga baru terdaftar setelah verifikasi', daftarLolos.data.status, 'pending');

/* Baru satu kunci terisi tidak boleh mengunci siapa pun dari formulir. */
aturSetting('turnstileSecret', '');
check('kunci situs saja tidak menawarkan widget', request({ action: 'captcha', ip: '203.0.113.8' }).data, { kind: 'none' });
check('setengah kunci dipasang, pendaftaran tetap lolos',
  request({ action: 'publicRegister', formId: 'form-kadaria', name: 'Separuh Kunci', phone: '081299990003', ip: '203.0.113.8' }).ok, true);
aturSetting('turnstileSiteKey', '');
check('kedua kunci kosong, login tidak menuntut captcha',
  request({ action: 'login', username: 'pb', password: 'tebakan', ip: '9.9.9.7' }).code === 'captcha', false);
aturSetting('turnstileSiteKey', 'site-key-abc');
aturSetting('turnstileSecret', 'secret-xyz');
check('kembali menuntut centang setelah kunci dipasang',
  request({ action: 'login', username: 'pb', password: 'tebakan', ip: '9.9.9.6' }).code, 'captcha');

const klaimGoogle = {
  iss: 'https://accounts.google.com',
  aud: 'fixture-client.apps.googleusercontent.com',
  sub: 'sub-baru',
  email: 'Bilal@Example.com',
  email_verified: true,
  name: 'Bilal Rehnomi',
  picture: 'https://lh3.googleusercontent.com/a/x',
  exp: Math.floor(Date.now() / 1000) + 3600
};
http.google = klaimGoogle;
http.turnstile = { success: false, 'error-codes': ['bad-request'] };
check('centang yang ditolak Cloudflare menggagalkan masuk kader',
  request({ action: 'kaderLogin', idToken: 'head.payload.sig', ip: '198.51.100.4', ...TOKEN_MANUSIA }).code, 'captcha');
http.turnstile = { success: true };
const masukKader = request({ action: 'kaderLogin', idToken: 'head.payload.sig', ip: '198.51.100.4', ...TOKEN_MANUSIA });
check('kader berhasil masuk dengan Google', masukKader.ok, true);
check('peran kader dibedakan dari pengurus', masukKader.data.role, 'kader');
check('nama kader diambil dari klaim Google', masukKader.data.kader.name, 'Bilal Rehnomi');
check('email kader dinormalkan', masukKader.data.kader.email, 'bilal@example.com');
check('baris kader baru tercatat', rowsOf('Kaders').filter((row) => row.googleSub === 'sub-baru').length, 1);
const siapa = request({ action: 'whoami', token: masukKader.data.token });
check('whoami mengenali kader', siapa.data.role, 'kader');
check('kader tidak punya jenjang pengurus', 'jenjang' in siapa.data, false);
check('tamu tanpa token dikenali sebagai tamu', request({ action: 'whoami' }).data.role, 'tamu');
check('sesi kader kedaluwarsa tidak dianggap kader', request({ action: 'whoami', token: 'ses-kedaluwarsa' }).data.role, 'tamu');
check('kader lolos sebagai identitas Tanya PII', gas.chatIdentity_({ token: 'ses-rozak' }).kind, 'kader');
check('token rusak ditolak sebelum diverifikasi', request({ action: 'kaderLogin', idToken: 'abc', ip: '198.51.100.5', ...TOKEN_MANUSIA }).ok, false);
http.google = { ...klaimGoogle, aud: 'klien-punya-orang-lain' };
check('token Google dari situs lain ditolak', request({ action: 'kaderLogin', idToken: 'head.payload.sig', ip: '198.51.100.5', ...TOKEN_MANUSIA }).error, 'Token login tidak dibuat untuk website ini.');
http.google = { ...klaimGoogle, exp: Math.floor(Date.now() / 1000) - 60 };
check('token Google kedaluwarsa ditolak', request({ action: 'kaderLogin', idToken: 'head.payload.sig', ip: '198.51.100.6', ...TOKEN_MANUSIA }).error, 'Token login sudah kedaluwarsa. Silakan masuk ulang.');
http.google = { ...klaimGoogle, email_verified: false };
check('email Google belum terverifikasi ditolak', request({ action: 'kaderLogin', idToken: 'head.payload.sig', ip: '198.51.100.7', ...TOKEN_MANUSIA }).ok, false);
http.google = { ...klaimGoogle, name: 'Bilal Baru' };
const masukKedua = request({ action: 'kaderLogin', idToken: 'head.payload.sig', ip: '198.51.100.8', ...TOKEN_MANUSIA });
check('login ulang memakai baris kader yang sama', rowsOf('Kaders').filter((row) => row.googleSub === 'sub-baru').length, 1);
check('nama kader diperbarui dari klaim terbaru', masukKedua.data.kader.name, 'Bilal Baru');

// -------------------------------------------------- masuk kader tanpa Google

const daftarTanpaVerifikasi = request({ action: 'kaderRegister', email: 'siti@example.com', name: 'Siti Aminah', password: 'sandiku123', ip: '198.51.100.20' });
check('daftar kader dengan email butuh centang Turnstile', daftarTanpaVerifikasi.code, 'captcha');
check('kata sandi pendek ditolak', request({ action: 'kaderRegister', email: 'siti@example.com', name: 'Siti Aminah', password: 'singkat', ip: '198.51.100.20', ...TOKEN_MANUSIA }).error, 'Kata sandi minimal 8 karakter.');
check('email tidak valid ditolak', request({ action: 'kaderRegister', email: 'bukan-email', name: 'Siti Aminah', password: 'sandiku123', ip: '198.51.100.20', ...TOKEN_MANUSIA }).error, 'Alamat email tidak valid.');
const daftar = request({ action: 'kaderRegister', email: 'Siti@Example.com', name: 'Siti Aminah', password: 'sandiku123', ip: '198.51.100.20', ...TOKEN_MANUSIA });
check('kader bisa daftar tanpa Google', daftar.data.role, 'kader');
check('email pendaftaran dinormalkan', daftar.data.kader.email, 'siti@example.com');
check('satu baris kader baru dibuat', rowsOf('Kaders').filter((row) => row.email === 'siti@example.com').length, 1);
check('kata sandi disimpan sebagai hash, bukan teks', rowsOf('Kaders').some((row) => row.passwordHash === 'sandiku123'), false);
const daftarGanda = request({ action: 'kaderRegister', email: 'siti@example.com', name: 'Siti Baru', password: 'sandiku456', ip: '198.51.100.25', ...TOKEN_MANUSIA });
check('email yang sudah punya akun tidak bisa daftar lagi', daftarGanda.error, 'Email ini sudah punya akun kader. Silakan masuk.');
http.google = { ...klaimGoogle, sub: 'sub-siti', email: 'siti@example.com', name: 'Siti Aminah' };
const gabungGoogle = request({ action: 'kaderLogin', idToken: 'head.payload.sig', ip: '198.51.100.26', ...TOKEN_MANUSIA });
check('akun email yang masuk lewat Google tidak dobel', rowsOf('Kaders').filter((row) => row.email === 'siti@example.com').length, 1);
check('identitas Google tertaut ke akun email', rowsOf('Kaders').find((row) => row.email === 'siti@example.com').googleSub, 'sub-siti');
check('masuk Google tetap memberi sesi kader', request({ action: 'whoami', token: gabungGoogle.data.token }).data.role, 'kader');
http.google = klaimGoogle;
check('masuk email kader tanpa centang Turnstile ditolak', request({ action: 'kaderEmailLogin', email: 'siti@example.com', password: 'sandiku123', ip: '198.51.100.27' }).code, 'captcha');
const masukEmail = request({ action: 'kaderEmailLogin', email: 'siti@example.com', password: 'sandiku123', ip: '198.51.100.21', ...TOKEN_MANUSIA });
check('masuk dengan email dan kata sandi', masukEmail.data.role, 'kader');
check('sesi email dikenal sebagai kader', request({ action: 'whoami', token: masukEmail.data.token }).data.role, 'kader');
check('kata sandi salah ditolak', request({ action: 'kaderEmailLogin', email: 'siti@example.com', password: 'salah12345', ip: '198.51.100.22', ...TOKEN_MANUSIA }).error, 'Email atau kata sandi salah.');
check('email yang belum terdaftar gagal diam-diam', request({ action: 'kaderEmailLogin', email: 'tiada@example.com', password: 'apa12345', ip: '198.51.100.23', ...TOKEN_MANUSIA }).error, 'Email atau kata sandi salah.');
const tembokEmail = [];
for (let i = 0; i < gas.RATE_RULES['kader-login'].limit + 2; i += 1) {
  tembokEmail.push(request({ action: 'kaderEmailLogin', email: 'siti@example.com', password: 'tebakan', ip: '198.51.100.24' }));
}
check('tebakan kata sandi beruntun dari satu email dibatasi', tembokEmail[gas.RATE_RULES['kader-login'].limit].code, 'rate_limited');
check('sesi email dihitung sebagai identitas kader', gas.chatIdentity_({ token: masukEmail.data.token }).kind, 'kader');
check('kader non-Google mendapat jatah penuh Tanya PII', gas.chatIdentity_({ token: masukEmail.data.token }).batas, gas.APP.CHAT_DAILY_LIMIT);

// ------------------------------------------------ Tanya PII pengunjung umum

const ipTamu = '198.51.100.60';
const tamu = gas.chatIdentity_({ ip: ipTamu });
check('pengunjung tanpa akun jadi identitas tamu', tamu.kind, 'tamu');
check('tamu dijatah lima pertanyaan sehari', tamu.batas, 5);
check('kunci tamu stabil sepanjang hari', gas.guestSubject_(ipTamu), gas.guestSubject_(ipTamu));
check('jaringan lain mendapat kunci berbeda', gas.guestSubject_(ipTamu) === gas.guestSubject_('198.51.100.61'), false);
const statusTamu = request({ action: 'chatStatus', ip: ipTamu });
check('status tamu memuat sisa jatah', statusTamu.data, { boleh: true, akun: 'tamu', batas: 5, dipakai: 0, sisa: 5 });
seed('Chat', Array.from({ length: 5 }, (_unused, index) => ({
  createdAt: `${today}T0${index}:05:00.000Z`, kind: 'tamu', subject: tamu.subject,
  question: 'apa itu pii', answer: 'halo', provider: 'gratis', status: 'ok'
})));
check('jatah tamu habis setelah lima pertanyaan', request({ action: 'chatStatus', ip: ipTamu }).data.boleh, false);
check('pertanyaan keenam dari jaringan yang sama ditahan', request({ action: 'chat', ip: ipTamu, message: 'Apa itu PII?' }).error,
  'Jatah 5 pertanyaan gratis hari ini dari jaringan ini sudah habis. Masuk sebagai kader untuk jatah yang lebih besar, atau coba lagi besok.');
check('tamu dari jaringan lain masih dapat mencoba', request({ action: 'chatStatus', ip: '198.51.100.61' }).data.boleh, true);
check('login membuka kuota untuk akun sendiri', request({ action: 'chatStatus', token: 'ses-rozak', ip: ipTamu }).data.batas, gas.APP.CHAT_DAILY_LIMIT);

const ipCatat = '198.51.100.62';
const catat = request({ action: 'chatRecord', ip: ipCatat, question: 'Apa itu PII?', answer: 'Organisasi pelajar.', provider: 'Pollinations:openai' });
check('pemakaian dari gerbang AI ikut tercatat', catat.data, { akun: 'tamu', batas: 5, dipakai: 1 });
check('catatan memakai kunci jaringan yang sama', request({ action: 'chatStatus', ip: ipCatat }).data.dipakai, 1);
check('catatan tanpa jawaban ditolak', request({ action: 'chatRecord', ip: ipCatat, question: 'apa kabar', answer: '   ' }).ok, false);
const ipPenuh = '198.51.100.63';
for (let i = 1; i <= 5; i += 1) request({ action: 'chatRecord', ip: ipPenuh, question: `pertanyaan ${i}`, answer: 'jawaban' });
check('tamu tidak bisa mencatat lebih dari jatahnya', request({ action: 'chatRecord', ip: ipPenuh, question: 'pertanyaan enam', answer: 'jawaban' }).error,
  'Kuota harian identitas ini sudah penuh.');
check('jatah tercatat berlaku juga untuk pertanyaan berikutnya', request({ action: 'chat', ip: ipPenuh, message: 'Apa itu PII?' }).ok, false);
const catatKader = request({ action: 'chatRecord', token: 'ses-rozak', ip: '198.51.100.64', question: 'Kaderisasi itu apa?', answer: 'Proses pembinaan.' });
check('akun kader mencatat pemakaian atas namanya sendiri', catatKader.data.akun, 'kader');

const sukaPertama = request({ action: 'eventLike', token: 'ses-rozak', eventId: 'act-lk-tingkat', ip: '198.51.100.9' });
check('suka pertama tercatat', sukaPertama.data, { liked: true, likes: 1 });
const sukaKedua = request({ action: 'eventLike', token: 'ses-rozak', eventId: 'act-lk-tingkat', ip: '198.51.100.9' });
check('menekan suka sekali lagi menghapusnya', sukaKedua.data, { liked: false, likes: 0 });
check('suka wajib masuk dulu', request({ action: 'eventLike', eventId: 'act-kadaria' }).ok, false);
check('kegiatan draft tidak bisa disukai', request({ action: 'eventLike', token: 'ses-rozak', eventId: 'act-draft' }).error, 'Acara tidak ditemukan atau belum diterbitkan.');
const utas = request({ action: 'eventThread', eventId: 'act-kadaria', token: 'ses-rozak' });
check('utas acara terbaca untuk kader', utas.data.comments.length, 2);
check('utas menandai komentar milik sendiri', utas.data.comments.filter((item) => item.mine).length, 1);
check('utas mengirim jumlah suka', utas.data.likes, 3);
check('utas menandai suka milik sendiri', utas.data.liked, true);
const utasTamu = request({ action: 'eventThread', eventId: 'act-kadaria' });
check('utas tetap terbuka untuk tamu', utasTamu.data.comments.length, 2);
check('tamu tidak ditandai sebagai penulis komentar', utasTamu.data.comments.some((item) => item.mine), false);

const komentarBaru = request({ action: 'eventComment', token: 'ses-rozak', eventId: 'act-kadaria', text: 'Semangat terus', ip: '198.51.100.10' });
check('komentar kader tersimpan tanpa captcha', komentarBaru.data.comment.text, 'Semangat terus');
check('komentar baru ditandai milik sendiri', komentarBaru.data.comment.mine, true);
const spamTautan = request({ action: 'eventComment', token: 'ses-rozak', eventId: 'act-kadaria', text: 'lihat https://toko.example promo', ip: '198.51.100.11' });
check('komentar berisi tautan ditolak', spamTautan.ok, false);
check('komentar terlalu pendek ditolak',
  request({ action: 'eventComment', token: 'ses-rozak', eventId: 'act-kadaria', text: 'ok', ip: '198.51.100.12' }).ok,
  false);
check('kuota komentar harian per kader diberlakukan',
  request({ action: 'eventComment', token: 'ses-kuota', eventId: 'act-lk-tingkat', text: 'Satu lagi', ip: '198.51.100.13' }).error,
  'Kuota 3 komentar hari ini sudah terpakai. Lanjutkan besok.');
const banjirIp = '198.51.100.77';
for (let i = 0; i < gas.RATE_RULES['event-comment-ip'].limit; i++) gas.throttle_('event-comment-ip', banjirIp);
check('banjir komentar dari satu jaringan dibatasi',
  request({ action: 'eventComment', token: 'ses-panjang', eventId: 'act-kadaria', text: 'Terus mengalir', ip: banjirIp }).code,
  'rate_limited');
const komentarPanjang = request({ action: 'eventComment', token: 'ses-panjang', eventId: 'act-kadaria', text: 'x'.repeat(600), ip: '198.51.100.14' });
check('komentar panjang dipotong ke batas yang diizinkan', komentarPanjang.data.comment.text.length, 500);

// ------------------------------------------------------ unggah foto pengurus

/** Berekas JPEG minimal (tanda tangannya saja) dalam base64 seperti dikirim browser. */
const jpegBase64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]).toString('base64');
const fileSebelumUpload = driveFiles.length;
const unggah = request({ action: 'orgUploadImage', token: 'ses-pd', name: 'sampul-lk-1', data: jpegBase64, ip: '203.0.113.50' });
check('pengurus bisa mengunggah sampul acara', unggah.ok, true);
const artikelLewatApi = request({
  action: 'orgSaveArticle',
  token: 'ses-pd',
  article: { title: 'Berita PD Pontianak', status: 'published', content: '<p>Berita melalui API lembaga.</p>' }
});
check('orgSaveArticle is routed through an authenticated organization session',
  [artikelLewatApi.ok, rowsOf('Articles').find((row) => row.id === artikelLewatApi.data.id)?.orgId],
  [true, 'pd-pontianak']);
check('hasil unggah berupa URL gambar publik Google', unggah.data.url.startsWith('https://drive.usercontent.google.com/download?id='), true);
check('jenis berkas dibaca dari tanda tangan byte', unggah.data.mime, 'image/jpeg');
check('bytes sampul tersimpan sebagai JPEG biner', driveFiles.find((file) => file.id === unggah.data.fileId)?.bytes.slice(0, 3), [-1, -40, -1]);
check('berkas masuk ke folder media PB PII', driveFiles.length, fileSebelumUpload + 1);
check('nama berkas mengikuti judul dan ekstensi', /\.jpg$/.test(driveFiles[driveFiles.length - 1].name), true);
check('token kader tidak bisa mengunggah atas nama lembaga',
  request({ action: 'orgUploadImage', token: 'ses-rozak', name: 'coba', data: jpegBase64, ip: '203.0.113.51' }).error,
  'Sesi berakhir atau token tidak valid. Silakan login kembali.');
check('bukan gambar ditolak',
  request({ action: 'orgUploadImage', token: 'ses-pd', name: 'virus', data: Buffer.from('halo dunia').toString('base64'), ip: '203.0.113.52' }).error,
  'Hanya berkas JPEG, PNG, atau WebP yang diterima.');
check('gambar kosong ditolak', request({ action: 'orgUploadImage', token: 'ses-pd', name: 'kosong', data: '', ip: '203.0.113.53' }).error,
  'Tidak ada berkas gambar yang dikirim.');
byId['pk-poltek'].status = 'pending';
check('unggah ditolak selama lembaga belum terverifikasi',
  request({ action: 'orgUploadImage', token: 'ses-poltek', name: 'tertunda', data: jpegBase64, ip: '203.0.113.54' }).error,
  'Akun lembaga belum diverifikasi. Tunggu persetujuan atasan atau hubungi PB PII.');
byId['pk-poltek'].status = 'verified';
let unggahLolos = 0;
for (let i = 0; i < gas.RATE_RULES['org-upload'].limit + 2; i += 1) {
  if (request({ action: 'orgUploadImage', token: 'ses-pd', name: `banjir-${i}`, data: jpegBase64, ip: '203.0.113.55' }).ok) unggahLolos += 1;
}
check('banjir unggah dibatasi laju per lembaga', unggahLolos, gas.RATE_RULES['org-upload'].limit);

// --------------------------------------------- pustaka dan rujukan Tanya PII

const pustakaTamu = request({ action: 'pustakaList' });
check('pustaka terkunci untuk pengunjung', pustakaTamu.ok, false);
check('penolakan pustaka memakai bahasa pengurus',
  /^Pustaka organisasi khusus akun/.test(String(pustakaTamu.error)), true);

const daftarPustaka = request({ action: 'pustakaList', token: 'ses-rozak' });
check('kader menerima daftar berkas pustaka', daftarPustaka.data.docs.length, 3);
check('daftar pustaka melaporkan korpus siap', daftarPustaka.data.tersedia, true);
seed('PustakaBerkas', pustakaFixture.docs.map((doc) => ({ ...doc })));
seed('PustakaPotongan', pustakaFixture.chunks.map((chunk) => ({
  doc: chunk.d,
  halaman: chunk.h[0],
  teks: chunk.t,
  halamanAkhir: chunk.h[1],
  bab: chunk.b || ''
})));
// Satu baris warutan impor lama: hanya tiga kolom pertama yang pernah terisi.
seed('PustakaPotongan', [{ doc: 'ebook-ta-dib-pii', halaman: 200, teks: 'Baris lama tanpa kolom bab dan halaman akhir.' }]);
driveFiles.push({ id: 'fixture-ebook-original', name: "Ebook Ta'dib PII (tanpa password).pdf" });
includePustakaCorpus = false;
const daftarPustakaDariSheet = gas.pustakaDaftar_('kader');
const korpusSheet = gas.pustakaKorpus_();
includePustakaCorpus = true;
check('original PDF links are resolved when the searchable corpus falls back to sheets',
  [daftarPustakaDariSheet.sumber, daftarPustakaDariSheet.docs.find((doc) => doc.id === 'ebook-ta-dib-pii')?.tautan],
  ['sheet', 'https://drive.google.com/file/d/fixture-ebook-original/view']);
check('korpus sheet mengembalikan rentang halaman', korpusSheet.chunks[0].h, [120, 124]);
check('korpus sheet menyimpan nama bab', korpusSheet.chunks[0].b, 'BAB III ORIENTASI TA’DIB › Ketentuan Mengenai Waktu Turba');
check('baris warutan tetap punya halaman yang masuk akal',
  korpusSheet.chunks.find((chunk) => chunk.t.startsWith('Baris lama')).h, [200, 200]);
check('berkas sheet tersembunyi tidak didaftarkan untuk kader',
  daftarPustakaDariSheet.docs.some((doc) => doc.id === 'pku-rancangan-internal'), false);

const cariLbt = request({ action: 'pustakaCari', token: 'ses-rozak', q: 'apa itu LBT', ip: '198.51.100.80' });
check('sesi kader bisa mencari isi berkas', cariLbt.ok, true);
check('pencarian isi menemukan silabus LBT', cariLbt.data.hasil[0].judul, 'Silabus Leadership Basic Training');
check('hasil pencarian menyebut rentang halaman', Array.isArray(cariLbt.data.hasil[0].h), true);

const daftarAdmin = request({ action: 'pustakaList', token: 'ses-admin' });
check('admin tetap melihat berkas yang disembunyikan', daftarAdmin.data.docs.some((doc) => doc.id === 'pku-rancangan-internal'), true);
check('daftar kader menandai berkas yang tampil untuk umum', daftarPustaka.data.docs.every((doc) => doc.visibel === true), true);
const cariRancangan = request({ action: 'pustakaCari', token: 'ses-rozak', q: 'rancangan prioritas forum tertinggi', ip: '198.51.100.90' });
check('pencarian kader tidak menyentuh berkas tersembunyi',
  cariRancangan.data.hasil.some((hasil) => hasil.d === 'pku-rancangan-internal'), false);
const tanyaRancangan = request({ action: 'chat', token: 'ses-rozak', message: 'Apa isi rancangan prioritas pengurus besar?', ip: '198.51.100.91' });
check('Tanya PII tetap punya jawaban untuk pertanyaan semi-umum', tanyaRancangan.ok, true);
check('Tanya PII tidak mengutip berkas tersembunyi',
  (tanyaRancangan.data.rujukan || []).every((rujukan) => rujukan.judul !== 'PKU PB PII (rancangan)'), true);

/* Impor korpus: kolom bab dan halaman akhir harus benar-benar tertulis. */
properti.PUSAKA_IMPOR_KEY = 'kunci-uji';
check('impor tahap mulai menyimpan metadata berkas', request({
  action: 'pustakaImpor', key: 'kunci-uji', tahap: 'mulai', docs: [
    { id: 'uji-impor', judul: 'Berkas Uji', kategori: 'Uji', halaman: 9, potong: 1,
      berkas: 'uji.pdf', versi: 'Edisi 2', visibel: false }
  ]
}).data.berkas, 1);
check('impor tahap potongan menerima kutipan', request({
  action: 'pustakaImpor', key: 'kunci-uji', tahap: 'potongan', potongan: [
    { d: 'uji-impor', h: [7, 9], b: 'BAB I UJI', t: 'Kalimat uji untuk memeriksa rentang halaman dan bab ikut tersimpan.' }
  ]
}).data.diterima, 1);
const barisPotong = rowsOf('PustakaPotongan').find((row) => row.doc === 'uji-impor');
check('rentang halaman tertulis sebagai dua kolom', [barisPotong.halaman, barisPotong.halamanAkhir], [7, 9]);
check('bab tertulis bersama potongan', barisPotong.bab, 'BAB I UJI');
check('visibilitas tertulis di lembar berkas', rowsOf('PustakaBerkas').find((row) => row.id === 'uji-impor').visibel, 'false');
const imporSelesai = request({ action: 'pustakaImpor', key: 'kunci-uji', tahap: 'selesai', dibuat: '2026-11-04T00:00:00.000Z' });
check('tahap selesai melaporkan isi korpus', [imporSelesai.data.berkas, imporSelesai.data.potong], [1, 1]);
check('kunci impor hangus sesudah tahap selesai', properti.PUSAKA_IMPOR_KEY, undefined);
check('impor kedua tanpa kunci ditolak', request({ action: 'pustakaImpor', key: 'kunci-uji', tahap: 'mulai', docs: [] }).ok, false);

const cariTurba = request({ action: 'pustakaCari', token: 'ses-rozak', q: 'aturan waktu turba', ip: '198.51.100.81' });
check('pencarian menemukan kutipan turba di Ta’dim', /turba/i.test(cariTurba.data.hasil[0].cuplikan), true);
check('kandidat pencarian tidak melebihi batas', cariTurba.data.hasil.length <= 12, true);

const baca = request({ action: 'pustakaBaca', token: 'ses-rozak', doc: 'ebook-ta-dib-pii', ip: '198.51.100.82' });
check('isi berkas pustaka bisa dibaca kader', baca.data.doc.judul, "Ebook Ta'dib PII");
check('potongan bawa nomor halaman', baca.data.potong[0].h[0], 120);
check('berkas di luar korpus ditolak', request({ action: 'pustakaBaca', token: 'ses-rozak', doc: 'luar-biasa', ip: '198.51.100.83' }).ok, false);
check('status pustaka khusus admin', request({ action: 'pustakaStatus', token: 'ses-rozak' }).ok, false);
check('aksi pustaka tidak dikenal tetap tertahan', request({ action: 'pustakaBukan' }).code === 'aksi', false);

const sehatPustaka = request({ action: 'health' }).data;
check('health melaporkan korpus pustaka', sehatPustaka.pustaka, { tersedia: true, sumber: 'drive', berkas: 4, potong: 5 });

const tanyaKader = request({ action: 'chat', token: 'ses-rozak', message: 'Bagaimana aturan waktu turba dalam kaderisasi?', ip: '198.51.100.85' });
const promptKader = http.calls.filter((call) => String(call.url).includes('pollinations')).at(-1);
const sistemKader = JSON.parse(promptKader.options.payload).messages[0].content;
check('jawaban Tanya PII ikut mengirim kutipan berkas', /Waktu turba tidak dibatasi/.test(sistemKader), true);
check('kutipan menyebut nama berkas, bab, dan rentang halaman',
  /Ebook Ta'dib PII \(BAB III ORIENTASI TA’DIB › Ketentuan Mengenai Waktu Turba, hal\. 120-124\)/.test(sistemKader), true);
check('prompt membatasi fakta pada kutipan Pustaka', /SATU-SATUNYA SUMBER FAKTA/.test(sistemKader), true);
check('jawaban AI membawa daftar rujukan', tanyaKader.data.rujukan[0].judul, "Ebook Ta'dib PII");
check('rujukan dibawa sebagai berkas, bab, dan halaman yang bisa dibuka',
  [tanyaKader.data.rujukan[0].berkas, tanyaKader.data.rujukan[0].bab, tanyaKader.data.rujukan[0].halaman],
  ['ebook-ta-dib-pii', 'BAB III ORIENTASI TA’DIB › Ketentuan Mengenai Waktu Turba', [120, 124]]);
check('rujukan tidak ikut mengirim teks mentah', tanyaKader.data.rujukan[0].isi, undefined);

const panggilanAITamuSebelum = http.calls.filter((call) => String(call.url).includes('pollinations')).length;
const tanyaTamu = request({ action: 'chat', message: 'Apa itu turba?', ip: '198.51.100.86' });
check('tamu tanpa akses Pustaka tidak menerima jawaban AI', tanyaTamu.ok, false);
check('model tidak dipanggil tanpa akses Pustaka',
  http.calls.filter((call) => String(call.url).includes('pollinations')).length, panggilanAITamuSebelum);

const korpus = gas.pustakaKorpus_();
check('pencarian kata yang tidak ada menghasilkan kosong', gas.pustakaCocok_(korpus, 'zirkoniumpalsu', 8).length, 0);
check('rujukan AI untuk tamu ditolak',
  /memiliki akses Pustaka/.test(captureError(() => gas.pustakaRujukanAI_('turba', 'tamu'))), true);
check('rujukan AI tanpa kecocokan memadai ditolak',
  /belum ditemukan kutipan/i.test(captureError(() => gas.pustakaRujukanAI_('zirkonium palsu', 'kader'))), true);
check('bentuk sitasi prompt', gas.pustakaPromptBagian_([]), '');

const konteksAI = request({ action: 'pustakaKonteks', token: 'ses-rozak', q: 'aturan waktu turba', ip: '198.51.100.87' });
check('gerbang AI minta potongan penuh ke Apps Script', /Waktu turba tidak dibatasi/.test(String(konteksAI.data.hasil[0].isi)), true);
check('potongan rujukan dibatasi panjangnya', konteksAI.data.hasil.every((item) => String(item.isi).length <= 1400), true);
check('konteks tanpa kecocokan substansial tetap kosong',
  request({ action: 'pustakaKonteks', token: 'ses-rozak', q: 'apa itu', ip: '198.51.100.88' }).data.hasil.length, 0);

// Foto: URL Drive bentuk lama 404, jadi semua jalur penyimpanan menormalkannya.
check('URL foto lama dinormalkan ke CDN unduhan',
  gas.driveImageUrl_('https://lh3.googleusercontent.com/d/1rdQWZM8ZqDR0dmBJumxTJj8cSvucrp9t=w1600'),
  'https://drive.usercontent.google.com/download?id=1rdQWZM8ZqDR0dmBJumxTJj8cSvucrp9t&export=view&authuser=0');
check('URL foto yang sudah benar tidak diubah',
  gas.driveImageUrl_('https://drive.usercontent.google.com/download?id=1rdQWZM8ZqDR0dmBJumxTJj8cSvucrp9t&export=view&authuser=0'),
  'https://drive.usercontent.google.com/download?id=1rdQWZM8ZqDR0dmBJumxTJj8cSvucrp9t&export=view&authuser=0');
check('penanda gambar surat tidak ikut diganti',
  gas.driveImageUrl_('pbpii-letter-image:abcDEF-123'), 'pbpii-letter-image:abcDEF-123');
check('gambar di isi artikel dinormalkan saat disimpan',
  /src="https:\/\/drive\.usercontent\.google\.com\/download\?id=ABC123abc-_456&amp;export=view&amp;authuser=0"/
    .test(gas.sanitizeArticleHtml_('<p>Isi</p><img src="https://lh3.googleusercontent.com/d/ABC123abc-_456=w1600" alt="Foto">')), true);
check('tabel dari editor bertahan saat disimpan',
  gas.sanitizeArticleHtml_('<table><thead><tr><th colspan="2">Keterangan</th></tr></thead><tbody>'
    + '<tr><td rowspan="2">A</td><td>B</td></tr></tbody></table>'),
  '<table><thead><tr><th colspan="2">Keterangan</th></tr></thead><tbody>'
    + '<tr><td rowspan="2">A</td><td>B</td></tr></tbody></table>');
check('rentang tabel yang tidak masuk akal dibuang',
  gas.sanitizeArticleHtml_('<table><tr><td colspan="99" onclick="alert(1)">A</td></tr></table>'),
  '<table><tr><td>A</td></tr></table>');
check('skrip di dalam sel tabel dibuang',
  gas.sanitizeArticleHtml_('<table><tr><td><script>alert(1)<\/script>Isi</td></tr></table>'),
  '<table><tr><td>Isi</td></tr></table>');
check('sel kosong tidak menjadi teks entities',
  gas.sanitizeArticleHtml_('<table><tr><td>&nbsp;</td></tr></table>'),
  '<table><tr><td>&nbsp;</td></tr></table>');

// Berkas lama yang isinya teks angka byte harus bisa dipulihkan tanpa ganti ID.
check('teks angka byte dikenali sebagai JPEG', gas.bytesDariTeksAngka_('-1,-40,-1,-32,0,16').mime, 'image/jpeg');
check('teks angka byte dipulihkan menjadi bytes aslinya',
  gas.bytesDariTeksAngka_('-1,-40,-1,-32,0,16').bytes.slice(0, 4).join(','), '255,216,255,224');
check('teks bukan gambar tidak pernah ditimpa', gas.bytesDariTeksAngka_('{"versi":1,"docs":[]}'), null);
check('angka di luar rentang byte ditolak', gas.bytesDariTeksAngka_('1,-40,999,0,1,2'), null);

driveFiles.push({
  id: 'fixture-foto-rusak',
  name: 'sambutan-ketum.jpg',
  bytes: Array.from(Buffer.from('-1,-40,-1,-32,0,16', 'utf8')),
  mime: 'image/jpeg',
  description: '',
  sharing: null
});
const logAsli = console.log;
console.log = () => {};
const hasilPerbaikan = gas.perbaikiFotoDrive();
console.log = logAsli;
const berkasRusak = driveFiles.find((file) => file.id === 'fixture-foto-rusak');
check('foto lama ditulis ulang sebagai gambar asli',
  berkasRusak.bytes.slice(0, 4).join(','), '255,216,255,224');
check('perbaikan melaporkan berkas yang dipulihkan',
  hasilPerbaikan.berkas.some((item) => item.id === 'fixture-foto-rusak'), true);
check('berkas yang sudah gambar tidak dihitung sebagai perbaikan',
  hasilPerbaikan.diperbaiki, 1);

// ------------------------------------------------------------- umpan sosial

check('setup mengenal keempat sheet umpan',
  ['Posts', 'PostMedia', 'Follows', 'Bookmarks'].every((name) => gas.SHEET_SCHEMA.some((entry) => entry[0] === name)),
  true);
check('skema Posts harness sama dengan backend', gas.POST_HEADERS, HEADERS.Posts);
check('tab umpan sesuai UI', gas.FEED_TAB, ['untuk-anda', 'mengikuti', 'terbaru', 'acara']);
check('jenis postingan umpan', gas.FEED_JENIS, ['teks', 'foto', 'video', 'pengumuman', 'acara', 'berbagi']);

/** Hanya berkas Drive sendiri yang boleh menempel pada postingan. */
check('tautan Drive diterima sebagai media',
  gas.feedTautanMedia_('https://drive.usercontent.google.com/download?id=abcdefghij123456&export=view&authuser=0')
    .split('?')[0],
  'https://drive.usercontent.google.com/download');
check('tautan situs lain ditolak sebagai media', gas.feedTautanMedia_('https://example.com/foto.jpg'), '');
check('video mp4 dikenali dari tanda tangan byte',
  gas.videoKind_([0, 0, 0, 32].concat(Array.from(Buffer.from('ftypmp42', 'ascii')))), 'video/mp4');
check('video webm dikenali dari tanda tangan byte',
  gas.videoKind_([0x1a, 0x45, 0xdf, 0xa3, 0x00, 0x00, 0x00, 0x00]), 'video/webm');
check('bukan video tidak diberi mime', gas.videoKind_([1, 2, 3, 4, 5, 6, 7, 8]), '');
check('nomor kontak tidak boleh masuk postingan',
  captureError(() => gas.feedCekIsi_('sabar ya bro, WA saya 081234567890')),
  'Postingan tidak boleh memuat tautan, email, atau nomor kontak.');

/** Peringkat "Untuk Anda": waktu-paruh 72 jam dan kenaikan untuk akun yang diikuti. */
const kartuSkor = { author: { id: 'kader-x' }, likes: 4, commentCount: 2, reposts: 0, createdAt: new Date().toISOString() };
const kartuBasah = { ...kartuSkor, createdAt: new Date(Date.now() - 72 * 3600 * 1000).toISOString() };
check('sehari dua kali umur, skor separuh', gas.feedSkor_(kartuSkor, {}) / gas.feedSkor_(kartuBasah, {}), 2);
check('kader yang diikuti dinaikkan 1,6 kali', gas.feedSkor_(kartuSkor, { 'kader-x': true }) / gas.feedSkor_(kartuSkor, {}), 1.6);

const IP_ROZAK = '203.0.113.140';
const IP_KUOTA = '203.0.113.141';
const IP_PANJANG = '203.0.113.142';

const umpanTamu = request({ action: 'feedList', ip: IP_ROZAK });
check('umpan dapat dibaca tanpa login', umpanTamu.ok, true);
check('tab bawaan umpan', umpanTamu.data.tab, 'untuk-anda');
check('tamu tidak diberi hak menulis', umpanTamu.data.kemampuan.menulis, false);
check('tamu tidak diberi hak mengunggah', umpanTamu.data.kemampuan.unggah, false);
check('tamu tidak diberi hak berkomentar', umpanTamu.data.kemampuan.komentar, false);
check('tab mengikuti dilayani sebagai daftar terbaru untuk tamu',
  request({ action: 'feedList', tab: 'mengikuti', ip: IP_ROZAK }).data.tab, 'terbaru');
check('tamu tidak dapat memposting',
  request({ action: 'feedPost', token: '', jenis: 'teks', isi: 'Coba tanpa akun', ip: IP_ROZAK }).error,
  'Masuk dulu dengan akun Google kader untuk melanjutkan.');
check('sukanya kader tidak dapat ditulis tanpa akun',
  request({ action: 'feedLike', token: '', id: 'apapun', ip: IP_ROZAK }).code, '');

const sukaAcaraSebelum = request({ action: 'eventThread', eventId: 'act-kadaria', ip: IP_ROZAK }).data.likes;

const posRozak = request({ action: 'feedPost', token: 'ses-rozak', jenis: 'teks', isi: 'Kajian rutin Kamis pagi di sekretariat.', ip: IP_ROZAK });
check('kader dapat memposting teks', posRozak.ok, true);
check('postingan baru langsung milik penulisnya', posRozak.data.post.author.mine, true);
check('kartu menyebut penulisnya kader, jadi UI boleh menawarkan ikuti', posRozak.data.post.author.kind, 'kader');
check('postingan baru belum punya interaksi', [posRozak.data.post.likes, posRozak.data.post.commentCount, posRozak.data.post.reposts], [0, 0, 0]);
const ID_ROZAK = posRozak.data.post.id;

check('postingan berisi tautan ditolak',
  request({ action: 'feedPost', token: 'ses-rozak', jenis: 'teks', isi: 'lihat https://contoh.id/promo ya', ip: IP_ROZAK }).error,
  'Postingan tidak boleh memuat tautan, email, atau nomor kontak.');
check('jenis postingan tak dikenal ditolak',
  request({ action: 'feedPost', token: 'ses-rozak', jenis: 'meme', isi: 'gambar lucu', ip: IP_ROZAK }).error,
  'Jenis postingan tidak dikenal.');
check('video tanpa berkas ditolak sebelum disimpan',
  request({ action: 'feedPost', token: 'ses-rozak', jenis: 'video', isi: 'doktrin', ip: IP_ROZAK }).error,
  'Video belum berhasil diunggah.');
check('postingan berbagi memakai tombol bagikan',
  request({ action: 'feedPost', token: 'ses-rozak', jenis: 'berbagi', isi: 'teruskan', ip: IP_ROZAK }).error,
  'Pakai tombol bagikan untuk membagikan postingan.');
const barisSetelahDitolak = rowsOf('Posts').length;
check('postingan yang ditolak tidak pernah masuk sheet', barisSetelahDitolak, 1);

const unggahFoto = request({ action: 'feedUpload', token: 'ses-kuota', name: 'dokumentasi-kajian', data: 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]).toString('base64'), ip: IP_KUOTA });
check('kader dapat mengunggah fotonya sendiri', unggahFoto.ok, true);
check('hasil unggahan berupa tautan Drive', unggahFoto.data.url.split('?')[0], 'https://drive.usercontent.google.com/download');
check('berkas unggahan dibagikan sebagai tautan lihat',
  driveFiles[driveFiles.length - 1].sharing, { access: 'ANYONE_WITH_LINK', permission: 'VIEW' });
check('unggah berkas non-media ditolak',
  request({ action: 'feedUpload', token: 'ses-kuota', data: Buffer.from('bukan gambar sama sekali', 'utf8').toString('base64'), ip: IP_KUOTA }).error,
  'Gunakan foto JPEG, PNG, WebP atau video MP4, WebM.');
check('unggah media butuh akun', request({ action: 'feedUpload', token: '', data: 'Zm9v', ip: IP_KUOTA }).ok, false);

const posFoto = request({
  action: 'feedPost', token: 'ses-kuota', jenis: 'foto', isi: 'Dokumentasi kajian Kamis.',
  media: [{ url: unggahFoto.data.url, mime: 'image/jpeg' }, { url: 'https://example.com/lain.jpg', mime: 'image/jpeg' }],
  ip: IP_KUOTA
});
check('postingan foto tersimpan dengan media Drive', posFoto.ok && posFoto.data.post.media.length, 1);
check('media dari situs lain dibuang, bukan disalin', posFoto.data.post.media[0].url.split('?')[0], 'https://drive.usercontent.google.com/download');
check('foto tanpa media yang sah ditolak',
  request({ action: 'feedPost', token: 'ses-kuota', jenis: 'foto', isi: 'fotonya mana', media: [{ url: 'https://example.com/a.jpg', mime: 'image/jpeg' }], ip: IP_KUOTA }).error,
  'Foto belum berhasil diunggah.');
check('teks saja tidak boleh membawa berkas',
  request({ action: 'feedPost', token: 'ses-kuota', jenis: 'teks', isi: 'cuma teks', media: [{ url: unggahFoto.data.url, mime: 'image/jpeg' }], ip: IP_KUOTA }).error,
  'Hanya postingan foto atau video yang boleh membawa berkas.');

const posAcara = request({ action: 'feedPost', token: 'ses-kuota', jenis: 'acara', eventId: 'act-kadaria', isi: 'Ajak kawan ke kajian ini.', ip: IP_KUOTA });
check('postingan acara membangun kartu dari data asli', posAcara.data.post.acara.title, 'Kajian Dasar Rohis');
const posAcaraGagal = request({ action: 'feedPost', token: 'ses-kuota', jenis: 'acara', eventId: 'act-draft', ip: IP_KUOTA });
check('acara draf tidak dapat dibagikan ke umpan', posAcaraGagal.error, 'Acara tidak ditemukan atau belum diterbitkan.');
const ID_KUOTA = posAcara.data.post.id;

check('sukanya kader dan suka acara memakai kolom terpisah',
  request({ action: 'eventThread', eventId: 'act-kadaria', ip: IP_ROZAK }).data.likes, sukaAcaraSebelum);

const suka1 = request({ action: 'feedLike', token: 'ses-rozak', id: ID_KUOTA, ip: IP_ROZAK });
check('tombol suka menyalakan hitungan', [suka1.data.liked, suka1.data.likes], [true, 1]);
const suka2 = request({ action: 'feedLike', token: 'ses-rozak', id: ID_KUOTA, ip: IP_ROZAK });
check('suka sekali lagi membatalkan', [suka2.data.liked, suka2.data.likes], [false, 0]);
check('suka pada postingan tidak menggeser suka acara',
  request({ action: 'eventThread', eventId: 'act-kadaria', ip: IP_ROZAK }).data.likes, sukaAcaraSebelum);
request({ action: 'feedLike', token: 'ses-panjang', id: ID_KUOTA, ip: IP_PANJANG });
check('suka dua kader dihitung dua',
  request({ action: 'feedThread', id: ID_KUOTA, ip: IP_ROZAK }).data.likes, 1);
check('suka postingan yang dihapus tidak pernah ada',
  request({ action: 'feedLike', token: 'ses-rozak', id: 'tidak-ada', ip: IP_ROZAK }).error, 'Postingan tidak ditemukan.');

const balas1 = request({ action: 'feedComment', token: 'ses-kuota', id: ID_ROZAK, text: 'Insyaallah hadir, Ka.', ip: IP_KUOTA });
check('kader dapat membalas postingan', balas1.ok, true);
check('balasan pertama tidak punya induk', balas1.data.balasan.parentId, '');
const balas2 = request({ action: 'feedComment', token: 'ses-rozak', id: ID_ROZAK, text: 'Terima kasih atas kehadirannya.', parentId: balas1.data.balasan.id, ip: IP_ROZAK });
check('balasan ke balasan menempel pada induk teratas', balas2.data.balasan.parentId, balas1.data.balasan.id);
const balas3 = request({ action: 'feedComment', token: 'ses-panjang', id: ID_ROZAK, text: 'Berarti juga untuk kami.', parentId: balas2.data.balasan.id, ip: IP_PANJANG });
check('threads tidak bersarang: cucu dilipat ke induk', balas3.data.balasan.parentId, balas1.data.balasan.id);
check('balasan berisi tautan ditolak',
  request({ action: 'feedComment', token: 'ses-panjang', id: ID_ROZAK, text: '.promo https://x.id', ip: IP_PANJANG }).error,
  'Postingan tidak boleh memuat tautan, email, atau nomor kontak.');
check('balasan terlalu pendek ditolak',
  request({ action: 'feedComment', token: 'ses-panjang', id: ID_ROZAK, text: 'ok', ip: IP_PANJANG }).error,
  'Tulis balasan yang lebih jelas.');
check('balasan pada postingan tak dikenal ditolak',
  request({ action: 'feedComment', token: 'ses-kuota', id: 'tidak-ada', text: 'halo kawan', ip: IP_KUOTA }).error,
  'Postingan tidak ditemukan.');
const utasUmpan = request({ action: 'feedThread', id: ID_ROZAK, token: 'ses-rozak', ip: IP_ROZAK });
check('utas memuat seluruh balasan', utasUmpan.data.balasan.length, 3);
check('balasan milik sendiri ditandai', utasUmpan.data.balasan.filter((item) => item.mine).length, 1);
check('jumlah balasan pada kartu sesuai utas',
  request({ action: 'feedList', tab: 'terbaru', token: 'ses-rozak', ip: IP_ROZAK }).data.items
    .find((card) => card.id === ID_ROZAK).commentCount, 3);

const bagikan1 = request({ action: 'feedRepost', token: 'ses-rozak', id: ID_KUOTA, ip: IP_ROZAK });
check('postingan kader lain dapat dibagikan', [bagikan1.data.dibagikan, bagikan1.data.reposts], [true, 1]);
const kartuBagikan = request({ action: 'feedList', tab: 'terbaru', token: 'ses-rozak', ip: IP_ROZAK }).data.items
  .find((card) => card.asal && card.asal.id === ID_KUOTA);
check('kartu berbagi menunjuk postingan asal, bukan menyalin isinya',
  Boolean(kartuBagikan)
    && kartuBagikan.jenis === 'berbagi'
    && kartuBagikan.isi === ''
    && kartuBagikan.asal.id === ID_KUOTA
    && kartuBagikan.asal.jenis === 'acara',
  true);
const bagikanLagi = request({ action: 'feedRepost', token: 'ses-rozak', id: ID_KUOTA, ip: IP_ROZAK });
check('menekan bagikan sekali lagi membatalkannya', [bagikanLagi.data.dibagikan, bagikanLagi.data.reposts], [false, 0]);
check('postingan sendiri tidak dibagikan',
  request({ action: 'feedRepost', token: 'ses-kuota', id: ID_KUOTA, ip: IP_KUOTA }).error,
  'Postingan sendiri tidak perlu dibagikan.');
const bagikanAsal = request({ action: 'feedRepost', token: 'ses-kuota', id: ID_ROZAK, ip: IP_KUOTA });
const kartuTurunan = request({ action: 'feedList', tab: 'terbaru', token: 'ses-rozak', ip: IP_ROZAK }).data.items
  .find((card) => card.asal && card.asal.id === ID_ROZAK);
check('hasil bagikan tidak dapat dibagikan lagi',
  request({ action: 'feedRepost', token: 'ses-rozak', id: kartuTurunan.id, ip: IP_ROZAK }).error,
  'Postingan yang dibagikan tidak bisa dibagikan lagi.');

const simpan1 = request({ action: 'feedBookmark', token: 'ses-rozak', id: ID_KUOTA, ip: IP_ROZAK });
check('penanda baca tersimpan per kader', simpan1.data.bookmarked, true);
check('kartu umpan melaporkan penanda baca milik aktor',
  request({ action: 'feedList', tab: 'terbaru', token: 'ses-rozak', ip: IP_ROZAK }).data.items
    .find((card) => card.id === ID_KUOTA).bookmarked, true);
check('penanda kader lain tidak ikut terlihat',
  request({ action: 'feedList', tab: 'terbaru', token: 'ses-panjang', ip: IP_PANJANG }).data.items
    .find((card) => card.id === ID_KUOTA).bookmarked, false);
check('penanda baca toggel',
  request({ action: 'feedBookmark', token: 'ses-rozak', id: ID_KUOTA, ip: IP_ROZAK }).data.bookmarked, false);

const ikut = request({ action: 'feedFollow', token: 'ses-rozak', kaderId: 'kader-kuota', ip: IP_ROZAK });
check('kader dapat mengikuti kader lain', [ikut.data.mengikuti, ikut.data.pengikut], [true, 1]);
check('tab mengikuti memuat postingan akun yang diikuti dan diri sendiri',
  request({ action: 'feedList', tab: 'mengikuti', token: 'ses-rozak', ip: IP_ROZAK }).data.items
    .every((card) => ['kader-kuota', 'kader-rozak'].includes(card.author.id)), true);
check('mengikuti diri sendiri ditolak',
  request({ action: 'feedFollow', token: 'ses-rozak', kaderId: 'kader-rozak', ip: IP_ROZAK }).error,
  'Tidak bisa mengikuti akun sendiri.');
check('akun yang tidak ada tidak dapat diikuti',
  request({ action: 'feedFollow', token: 'ses-rozak', kaderId: 'kader-asing', ip: IP_ROZAK }).error,
  'Akun yang diikuti tidak dikenal.');
check('membatalkan mengikuti mengurangi pengikut',
  request({ action: 'feedFollow', token: 'ses-rozak', kaderId: 'kader-kuota', ip: IP_ROZAK }).data.pengikut, 0);

const ubahMilikLain = request({ action: 'feedEdit', token: 'ses-kuota', id: ID_ROZAK, isi: 'Diubah kader lain', ip: IP_KUOTA });
check('kader lain tidak dapat mengubah postingan', ubahMilikLain.error, 'Hanya penulisnya yang dapat mengubah postingan ini.');
check('isi postingan tetap seperti semula',
  rowsOf('Posts').find((row) => row.id === ID_ROZAK).isi, 'Kajian rutin Kamis pagi di sekretariat.');
const ubahSah = request({ action: 'feedEdit', token: 'ses-rozak', id: ID_ROZAK, isi: 'Kajian rutin Kamis pagi, pindah ke aula.', ip: IP_ROZAK });
check('penulis dapat mengubah postingannya', ubahSah.data.post.isi, 'Kajian rutin Kamis pagi, pindah ke aula.');
check('perubahan mencatat waktu', ubahSah.data.post.updatedAt === ubahSah.data.post.createdAt, false);
check('perubahan berisi tautan ditolak',
  request({ action: 'feedEdit', token: 'ses-rozak', id: ID_ROZAK, isi: 'kunjungi wa.me/628123', ip: IP_ROZAK }).error,
  'Postingan tidak boleh memuat tautan, email, atau nomor kontak.');
check('admin boleh menertibkan postingan kader', request({ action: 'feedEdit', token: 'ses-admin', id: ID_ROZAK, isi: 'Rapi versi redaksi.', ip: IP_ROZAK }).ok, true);

const tabAcara = request({ action: 'feedList', tab: 'acara', token: 'ses-rozak', ip: IP_ROZAK });
check('tab acara hanya memuat kegiatan terjadwal',
  tabAcara.data.items.every((card) => card.jenis === 'acara' && /^\d{4}-\d{2}-\d{2}$/.test(card.acara.date)), true);
check('satu kegiatan hanya muncul sekali meski ada yang membagikannya',
  tabAcara.data.items.filter((card) => card.acara.id === 'act-kadaria').length, 1);
check('acara draf tidak masuk tab acara',
  tabAcara.data.items.some((card) => card.acara.id === 'act-draft'), false);
check('kartu kegiatan memakai id bentukan agar tidak tertukar dengan postingan',
  tabAcara.data.items[0].id.indexOf('acara:'), 0);
check('kartu kegiatan bukan milik kader sehingga tidak ada tombol ikuti',
  tabAcara.data.items[0].author.kind, 'acara');

const daftarPaginasi = request({ action: 'feedList', tab: 'terbaru', token: 'ses-rozak', batas: 5, mulai: 0, ip: IP_ROZAK });
check('paginasi membatasi jumlah kartu', [daftarPaginasi.data.items.length, daftarPaginasi.data.sisa],
  [Math.min(5, daftarPaginasi.data.total), Math.max(0, daftarPaginasi.data.total - 5)]);

aturSetting('feedPostDailyLimit', '2');
const kuota1 = request({ action: 'feedPost', token: 'ses-panjang', jenis: 'teks', isi: 'Musyawarah komisariat sesi satu.', ip: IP_PANJANG });
const kuota2 = request({ action: 'feedPost', token: 'ses-panjang', jenis: 'teks', isi: 'Musyawarah komisariat sesi dua.', ip: IP_PANJANG });
const kuota3 = request({ action: 'feedPost', token: 'ses-panjang', jenis: 'teks', isi: 'Musyawarah komisariat sesi tiga.', ip: IP_PANJANG });
check('dua postingan pertama sesuai kuota', [kuota1.ok, kuota2.ok], [true, true]);
check('postingan keempat melebihi kuota harian', kuota3.error, 'Kuota 2 postingan hari ini sudah terpakai. Lanjutkan besok.');
check('sisa kuota dilaporkan ke UI',
  request({ action: 'feedList', token: 'ses-panjang', ip: IP_PANJANG }).data.kuota, { sisaPos: 0, batasPos: 2 });
aturSetting('feedPostDailyLimit', '10');

/* Kuota harian mengikuti kalender setempat (WIB di produksi), tetapi cap waktu
   baris tersimpan sebagai ISO UTC. Baris di ujung hari jatuh pada tanggal UTC
   sebelah, jadi perbandingan tanggal mentah membuat kabarnya tidak dihitung dan
   jatah harian terasa reset setiap dini hari. */
const diniHari = new Date(-new Date().getTimezoneOffset() >= 0 ? `${today}T00:30:00` : `${today}T23:30:00`).toISOString();
aturSetting('feedPostDailyLimit', '3');
seed('Posts', [{
  id: 'pos-dini-hari', authorKey: 'k:kader-panjang', authorId: 'kader-panjang', authorName: 'Kader Panjang',
  authorPicture: '', jenis: 'teks', isi: 'Muhasabah setelah tengah malam.', eventId: '', repostOf: '',
  visibel: 'true', createdAt: diniHari, updatedAt: diniHari
}]);
check('kabar dini hari tetap memakai kuota hari berjalan',
  request({ action: 'feedPost', token: 'ses-panjang', jenis: 'teks', isi: 'Rapat lanjutan usai sahur.', ip: '203.0.113.151' }).error,
  'Kuota 3 postingan hari ini sudah terpakai. Lanjutkan besok.');
check('sisa kuota melihat kabar dini hari',
  request({ action: 'feedList', token: 'ses-panjang', ip: '203.0.113.151' }).data.kuota, { sisaPos: 0, batasPos: 3 });
aturSetting('feedPostDailyLimit', '10');

const sisaRozak = request({ action: 'feedList', token: 'ses-rozak', ip: IP_ROZAK }).data.kuota.sisaPos;
check('kuota harian Rozak berkurang setelah memposting', sisaRozak, 10 - rowsOf('Posts').filter((row) => row.authorKey === 'k:kader-rozak').length);

const umpanDitutup = (() => {
  aturSetting('feedOpen', 'false');
  const hasil = [
    request({ action: 'feedPost', token: 'ses-rozak', jenis: 'teks', isi: 'masih terbuka', ip: '203.0.113.149' }).error,
    request({ action: 'feedComment', token: 'ses-rozak', id: ID_ROZAK, text: 'masih terbuka', ip: '203.0.113.149' }).error,
    request({ action: 'feedRepost', token: 'ses-rozak', id: ID_KUOTA, ip: '203.0.113.149' }).error
  ];
  const kemampuan = request({ action: 'feedList', token: 'ses-rozak', ip: '203.0.113.149' }).data.kemampuan;
  aturSetting('feedOpen', 'true');
  return { hasil, kemampuan };
})();
check('redaksi dapat menutup umpan dari Settings', umpanDitutup.hasil, [
  'Umpan kader sedang ditutup oleh PB PII.',
  'Komentar umpan sedang ditutup oleh PB PII.',
  'Umpan kader sedang ditutup oleh PB PII.'
]);
check('umpan tertutup menyembunyikan tombol menulis', [umpanDitutup.kemampuan.menulis, umpanDitutup.kemampuan.komentar], [false, false]);

const hapusMilikLain = request({ action: 'feedDelete', token: 'ses-kuota', id: ID_ROZAK, ip: IP_KUOTA });
check('kader lain tidak dapat menghapus postingan', hapusMilikLain.error, 'Hanya penulisnya yang dapat mengubah postingan ini.');
const posSementara = request({
  action: 'feedPost', token: 'ses-kuota', jenis: 'foto', isi: 'Foto sementara sebelum dihapus.',
  media: [{ url: unggahFoto.data.url, mime: 'image/jpeg' }], ip: IP_KUOTA
});
const ID_SEMENTARA = posSementara.data.post.id;
request({ action: 'feedRepost', token: 'ses-rozak', id: ID_SEMENTARA, ip: IP_ROZAK });
request({ action: 'feedBookmark', token: 'ses-rozak', id: ID_SEMENTARA, ip: IP_ROZAK });
request({ action: 'feedLike', token: 'ses-rozak', id: ID_SEMENTARA, ip: IP_ROZAK });
request({ action: 'feedComment', token: 'ses-rozak', id: ID_SEMENTARA, isi: 'Bagus, thanks sudah dibagikan.', ip: IP_ROZAK });
const mediaSebelumHapus = rowsOf('PostMedia').filter((row) => row.postId === ID_SEMENTARA).length;
const berkasFoto = driveFiles.find((file) => unggahFoto.data.url.includes('id=' + file.id + '&'));
const hapus = request({ action: 'feedDelete', token: 'ses-kuota', id: ID_SEMENTARA, ip: IP_KUOTA });
check('penulis dapat menghapus postingannya', hapus.data.terhapus, ID_SEMENTARA);
check('media postingan ikut terhapus', [mediaSebelumHapus, rowsOf('PostMedia').filter((row) => row.postId === ID_SEMENTARA).length], [1, 0]);
check('komentar pada postingan yang dihapus ikut hilang',
  rowsOf('Comments').some((row) => row.eventId === ID_SEMENTARA && row.targetType === 'post'), false);
check('suka pada postingan yang dihapus ikut hilang',
  rowsOf('Reactions').some((row) => row.eventId === ID_SEMENTARA && row.targetType === 'post'), false);
check('tautan lihat foto postingan yang dihapus dicabut', berkasFoto.sharing, { access: 'PRIVATE', permission: 'NONE' });
check('foto postingan yang dihapus masuk tempat sampah Drive', berkasFoto.trashed, true);
check('bagikan atas postingan yang dihapus ikut hilang', rowsOf('Posts').some((row) => row.repostOf === ID_SEMENTARA), false);
check('penanda baca pada postingan yang dihapus ikut hilang', rowsOf('Bookmarks').some((row) => row.postId === ID_SEMENTARA), false);
check('postingan yang dihapus tidak muncul di umpan',
  request({ action: 'feedList', tab: 'terbaru', token: 'ses-kuota', ip: IP_KUOTA }).data.items.some((card) => card.id === ID_SEMENTARA),
  false);
check('id internal umpan tidak pernah keluar ke browser',
  JSON.stringify(request({ action: 'feedList', tab: 'terbaru', token: 'ses-rozak', ip: IP_ROZAK }).data.items)
    .includes('_authorKey'), false);

// Sapuan setup(): baris umpan yang kabarnya sudah hilang tidak boleh menumpuk.
rowsOf('Comments').push({ id: 'komentar-yatim', eventId: ID_SEMENTARA, targetType: 'post', isi: 'komentar tanpa induk' });
rowsOf('Reactions').push({ id: 'suka-yatim', eventId: ID_SEMENTARA, targetType: 'post', actorKey: 'k:kader-rozak' });
rowsOf('Comments').push({ id: 'komentar-kegiatan', eventId: 'act-tak-kenal', targetType: 'event', isi: 'komentar kegiatan' });
gas.bersihkanSisaFeed_();
check('sapuan menghapus komentar umpan tanpa kabar', rowsOf('Comments').some((row) => row.id === 'komentar-yatim'), false);
check('sapuan menghapus suka umpan tanpa kabar', rowsOf('Reactions').some((row) => row.id === 'suka-yatim'), false);
check('sapuan tidak menyentuh komentar kegiatan', rowsOf('Comments').some((row) => row.id === 'komentar-kegiatan'), true);
check('sapuan kedua tidak menghapus apa pun lagi',
  Object.values(gas.bersihkanSisaFeed_()).reduce((jumlah, nilai) => jumlah + nilai, 0), 0);

let kenaLaju = 0;
const batasLajuPos = gas.RATE_RULES['feed-post'].limit;
for (let i = 0; i < batasLajuPos + 1; i += 1) {
  const hasil = request({ action: 'feedPost', token: 'ses-admin', jenis: 'teks', isi: 'Pengumuman rapat pengurus ' + (i + 1), ip: '203.0.113.150' });
  if (hasil.code === 'rate_limited') kenaLaju += 1;
}
check('pemosting beruntun dibatasi laju, bukan dimuat semua', [kenaLaju, batasLajuPos], [1, gas.RATE_RULES['feed-post'].limit]);
check('aksi umpan asing ditolak di pintu masuk', request({ action: 'feedTidakAda', token: 'ses-rozak', ip: IP_ROZAK }).error, 'Aksi umpan tidak dikenal.');

// ------------------------------------------------------------------ laporan

function captureError(run) {
  try {
    run();
    return null;
  } catch (error) {
    return String(error && error.message ? error.message : error);
  }
}

const failed = checks.filter((item) => !item.ok);
checks.forEach((item) => {
  const mark = item.ok ? 'OK  ' : 'GAG ';
  console.log(`${mark}${item.label}${item.ok ? '' : `\n     dapat: ${item.actual}\n     harus: ${item.expected}`}`);
});
console.log(`\n${checks.length - failed.length}/${checks.length} pemeriksaan gas/Code.gs lulus.`);
if (failed.length) process.exitCode = 1;
