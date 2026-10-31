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
  Articles: ['id', 'title', 'slug', 'category', 'excerpt', 'content', 'coverImage', 'author', 'status', 'createdAt', 'updatedAt'],
  Gallery: ['id', 'title', 'imageUrl', 'caption', 'featured', 'sortOrder', 'createdAt'],
  Settings: ['key', 'value'],
  Orgs: ['id', 'jenjang', 'name', 'province', 'district', 'subdistrict', 'parentId', 'email', 'passwordHash', 'passwordSalt', 'phone', 'skUrl', 'status', 'verifiedBy', 'verifiedAt', 'createdAt', 'updatedAt', 'lastLoginAt', 'note'],
  Activities: ['id', 'orgId', 'title', 'category', 'date', 'location', 'description', 'participants', 'coverImage', 'status', 'createdAt', 'updatedAt'],
  Forms: ['id', 'orgId', 'activityId', 'title', 'description', 'status', 'createdAt', 'updatedAt'],
  Participants: ['id', 'formId', 'orgId', 'name', 'institution', 'phone', 'email', 'note', 'createdAt'],
  Letters: ['id', 'fromOrgId', 'toOrgId', 'category', 'subject', 'body', 'status', 'createdAt', 'readAt'],
  Sessions: ['token', 'kind', 'subject', 'createdAt', 'expiresAt'],
  Chat: ['createdAt', 'kind', 'subject', 'question', 'answer', 'provider', 'status'],
  Standards: ['id', 'orgId', 'minPerMonth', 'setByOrgId', 'setByName', 'note', 'updatedAt'],
  Kaders: ['id', 'email', 'name', 'picture', 'googleSub', 'createdAt', 'lastLoginAt', 'note', 'passwordHash', 'passwordSalt'],
  Reactions: ['id', 'eventId', 'actorKey', 'actorName', 'kind', 'createdAt'],
  Comments: ['id', 'eventId', 'actorKey', 'actorName', 'actorPicture', 'text', 'status', 'createdAt', 'updatedAt']
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
}

const SpreadsheetApp = {
  openById: () => ({ getSheetByName: (name) => (HEADERS[name] ? new FakeSheet(name) : null) })
};
const PropertiesService = {
  getScriptProperties: () => ({ getProperty: (key) => (key === 'SPREADSHEET_ID' ? 'fixture-spreadsheet' : null), setProperty() {} })
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
  DigestAlgorithm: { SHA_256: 'SHA_256' },
  base64Decode: (raw) => Array.from(Buffer.from(String(raw), 'base64'))
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
      ringkas: 'PPO.', halaman: 51, potong: 1, berkas: 'BUKU SAKU PPO 2020.pdf' }
  ],
  chunks: [
    { d: 'ebook-ta-dib-pii', h: [120, 124], t: 'Ketentuan Mengenai Waktu Turba. Waktu turba tidak dibatasi berapa minimal harinya atau maksimal harinya. Turba dilakukan sampai permasalahan yang terjadi di daerah atau wilayah yang didatangi bisa selesai.' },
    { d: 'ebook-ta-dib-pii', h: [88, 90], t: 'Ta’lim Awal adalah jenjang pembinaan pertama bagi kader PII sebelum mengikuti training kepemimpinan.' },
    { d: 'silabus-leadership-basic-training-poin', h: [12, 15], t: 'Leadership Basic Training atau LBT adalah training kepemimpinan dasar bagi kader PII yang telah mengikuti ta’lim awal.' },
    { d: 'buku-saku-ppo-2020', h: [7, 9], t: 'Pengembangan dan Pemberdayaan Organisasi membina pengurus komisariat, daerah, wilayah, sampai pengurus besar.' }
  ]
};

const pustakaFile = {
  getId: () => 'fixture-pustaka-korpus',
  getName: () => 'pustaka.json',
  getLastUpdated: () => new Date('2026-10-31T02:04:57.927Z'),
  getBlob: () => ({ getDataAsString: () => JSON.stringify(pustakaFixture) })
};

const fakeFolder = {
  getId: () => 'fixture-folder-media',
  getName: () => 'PB PII Media',
  getFilesByName(nama) {
    const berkas = String(nama) === 'pustaka.json' ? [pustakaFile] : [];
    let index = 0;
    return { hasNext: () => index < berkas.length, next: () => berkas[index++] };
  },
  createFile(name, bytes, mime) {
    driveFiles.push({ name: String(name), bytes: bytes.length, mime: String(mime) });
    return { getId: () => `fixture-file-${driveFiles.length}`, setSharing() {} };
  }
};
const DriveApp = {
  Access: { ANYONE_WITH_LINK: 'ANYONE_WITH_LINK' },
  Permission: { LIMITED: 'LIMITED' },
  getFolderById: () => fakeFolder,
  getFoldersByName: () => ({ hasNext: () => true, next: () => fakeFolder }),
  createFolder: () => fakeFolder
};

const source = readFileSync(new URL('../gas/Code.gs', import.meta.url), 'utf8');
const exported = [
  'monthShift_', 'monthlyActivityIndex_', 'standardsMap_', 'keaktifanFor_',
  'eventsFeed_', 'publicData_', 'orgData_', 'orgSetStandard_', 'keaktifanSettings_',
  'orgSaveActivity_', 'requireOrg_', 'currentMonthKey_', 'todayKey_', 'APP', 'STANDARD_HEADERS',
  'doPost', 'throttle_', 'clientIp_', 'captchaIssue_', 'assertCaptcha_', 'kaderLogin_',
  'eventLike_', 'eventComment_', 'eventThread_', 'whoami_', 'publicSettings_',
  'actorOf_', 'safeActorKey_', 'chatIdentity_', 'guestSubject_', 'RATE_RULES', 'hashPassword_',
  'pustakaKorpus_', 'pustakaCocok_', 'pustakaRujukanAI_', 'pustakaPromptBagian_', 'driveKesiapan_'
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

// -------------------------------------- keamanan: pembatas laju, captcha, akun

const sesiBerlaku = new Date(Date.now() + 3600 * 1000).toISOString();
seed('Sessions', [
  { token: 'ses-rozak', kind: 'kader', subject: 'kader-rozak', createdAt: `${today}T07:00:00.000Z`, expiresAt: sesiBerlaku },
  { token: 'ses-kuota', kind: 'kader', subject: 'kader-kuota', createdAt: `${today}T07:00:00.000Z`, expiresAt: sesiBerlaku },
  { token: 'ses-panjang', kind: 'kader', subject: 'kader-panjang', createdAt: `${today}T07:00:00.000Z`, expiresAt: sesiBerlaku },
  { token: 'ses-pd', kind: 'org', subject: 'pd-pontianak', createdAt: `${today}T07:00:00.000Z`, expiresAt: sesiBerlaku },
  { token: 'ses-poltek', kind: 'org', subject: 'pk-poltek', createdAt: `${today}T07:00:00.000Z`, expiresAt: sesiBerlaku },
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

/** Soal verifikasi diisi angka, jadi jawabannya bisa dihitung dari teksnya. */
function answerOf(question) {
  const numbers = String(question).match(/\d+/g) || [];
  return String(Number(numbers[0]) * Number(numbers[1]));
}

const percobaanLogin = [];
for (let i = 0; i < 9; i += 1) {
  percobaanLogin.push(request({ action: 'login', username: 'pb', password: 'tebakan', ip: '9.9.9.9' }));
}
check('delapan percobaan login pertama dilayani normal', percobaanLogin.slice(0, 8).every((item) => item.ok === false && item.code !== 'rate_limited'), true);
check('percobaan login kesembilan dibatasi laju', percobaanLogin[8].code, 'rate_limited');
check('jawaban pembatas menyertakan hitung tunggu', typeof percobaanLogin[8].retryAfter, 'number');
check('pembatas laju memakai kunci IP dari proxy', gas.clientIp_({ ip: '203.0.113.7, 10.0.0.1' }), '203.0.113.7');

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

const tanpaVerifikasi = request({ action: 'publicRegister', formId: 'form-kadaria', name: 'Nur Aisyah', phone: '081234567890', ip: '203.0.113.7' });
check('pendaftaran tanpa verifikasi ditolak', tanpaVerifikasi.code, 'captcha');
const pesertaAwal = rowsOf('Participants').length;
const soal = request({ action: 'captcha', ip: '203.0.113.7' });
check('verifikasi singkat dibuat tanpa kunci eksternal', soal.data.kind, 'local');
check('soal verifikasi memuat perkalian', /\d+ × \d+/.test(soal.data.question), true);
const salah = request({ action: 'publicRegister', formId: 'form-kadaria', name: 'Spam Bot', ip: '203.0.113.7', captchaId: soal.data.id, captchaAnswer: '999999' });
check('jawaban verifikasi salah ditolak', salah.ok, false);
check('jawaban salah langsung hangus soalnya', request({ action: 'publicRegister', formId: 'form-kadaria', name: 'Spam Bot', phone: '081100011', ip: '203.0.113.7', captchaId: soal.data.id, captchaAnswer: answerOf(soal.data.question) }).code, 'captcha');
check('peserta baru tidak tercatat ketika ditolak', rowsOf('Participants').length, pesertaAwal);
const soalBenar = request({ action: 'captcha', ip: '203.0.113.7' });
const benar = request({ action: 'publicRegister', formId: 'form-kadaria', name: 'Nur Aisyah', phone: '081234567890', ip: '203.0.113.7', captchaId: soalBenar.data.id, captchaAnswer: answerOf(soalBenar.data.question) });
check('pendaftaran lolos dengan jawaban benar', benar.ok, true);
check('peserta tercatat satu baris', rowsOf('Participants').length, pesertaAwal + 1);
const dipakaiUlang = request({ action: 'publicRegister', formId: 'form-kadaria', name: 'Orang Kedua', phone: '081234567891', ip: '203.0.113.7', captchaId: soalBenar.data.id, captchaAnswer: answerOf(soalBenar.data.question) });
check('satu jawaban verifikasi hanya sekali pakai', dipakaiUlang.code, 'captcha');
const daftarLembaga = request({ action: 'orgRegister', jenjang: 'PK', province: 'Kalimantan Barat', district: 'Kota Pontianak', subdistrict: 'Kec. Pontianak Timur', email: 'pk-baru@example.com', password: 'rahasia123', ip: '198.51.100.40' });
check('pendaftaran lembaga juga butuh verifikasi', daftarLembaga.code, 'captcha');
const soalLembaga = request({ action: 'captcha', ip: '198.51.100.40' });
const daftarLolos = request({ action: 'orgRegister', jenjang: 'PK', province: 'Kalimantan Barat', district: 'Kota Pontianak', subdistrict: 'Kec. Pontianak Timur', email: 'pk-baru@example.com', password: 'rahasia123', ip: '198.51.100.40', captchaId: soalLembaga.data.id, captchaAnswer: answerOf(soalLembaga.data.question) });
check('lembaga baru terdaftar setelah verifikasi', daftarLolos.data.status, 'pending');

const batasSettings = rowsOf('Settings').length;
seed('Settings', [
  { key: 'turnstileSiteKey', value: 'site-key-abc' },
  { key: 'turnstileSecret', value: 'secret-xyz' }
]);
const soalTurnstile = request({ action: 'captcha', ip: '203.0.113.9' });
check('Turnstile otomatis dipakai bila kuncinya diisi', soalTurnstile.data, { kind: 'turnstile', siteKey: 'site-key-abc' });
const payloadTurnstile = request({ action: 'public', ip: '203.0.113.9' });
check('kunci rahasia tidak pernah keluar ke browser', 'turnstileSecret' in payloadTurnstile.data.settings, false);
check('kunci situs Turnstile boleh dilihat browser', payloadTurnstile.data.settings.turnstileSiteKey, 'site-key-abc');
http.turnstile = { success: true };
const lewatTurnstile = request({ action: 'publicRegister', formId: 'form-kadaria', name: 'Via Turnstile', phone: '081299990001', ip: '203.0.113.9', captchaToken: 'tok-123' });
check('pendaftaran lolos lewat Turnstile', lewatTurnstile.ok, true);
http.turnstile = { success: false, 'error-codes': ['bad-request'] };
const ditolakTurnstile = request({ action: 'publicRegister', formId: 'form-kadaria', name: 'Bot', phone: '081299990002', ip: '203.0.113.9', captchaToken: 'tok-palsu' });
check('token Turnstile yang ditolak gagal masuk', ditolakTurnstile.code, 'captcha');
rowsOf('Settings').length = batasSettings;

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
const masukKader = request({ action: 'kaderLogin', idToken: 'head.payload.sig', ip: '198.51.100.4' });
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
check('token rusak ditolak sebelum diverifikasi', request({ action: 'kaderLogin', idToken: 'abc', ip: '198.51.100.5' }).ok, false);
http.google = { ...klaimGoogle, aud: 'klien-punya-orang-lain' };
check('token Google dari situs lain ditolak', request({ action: 'kaderLogin', idToken: 'head.payload.sig', ip: '198.51.100.5' }).error, 'Token login tidak dibuat untuk website ini.');
http.google = { ...klaimGoogle, exp: Math.floor(Date.now() / 1000) - 60 };
check('token Google kedaluwarsa ditolak', request({ action: 'kaderLogin', idToken: 'head.payload.sig', ip: '198.51.100.6' }).error, 'Token login sudah kedaluwarsa. Silakan masuk ulang.');
http.google = { ...klaimGoogle, email_verified: false };
check('email Google belum terverifikasi ditolak', request({ action: 'kaderLogin', idToken: 'head.payload.sig', ip: '198.51.100.7' }).ok, false);
http.google = { ...klaimGoogle, name: 'Bilal Baru' };
const masukKedua = request({ action: 'kaderLogin', idToken: 'head.payload.sig', ip: '198.51.100.8' });
check('login ulang memakai baris kader yang sama', rowsOf('Kaders').filter((row) => row.googleSub === 'sub-baru').length, 1);
check('nama kader diperbarui dari klaim terbaru', masukKedua.data.kader.name, 'Bilal Baru');

// -------------------------------------------------- masuk kader tanpa Google

const daftarTanpaVerifikasi = request({ action: 'kaderRegister', email: 'siti@example.com', name: 'Siti Aminah', password: 'sandiku123', ip: '198.51.100.20' });
check('daftar kader dengan email butuh verifikasi', daftarTanpaVerifikasi.code, 'captcha');
const soalPendek = request({ action: 'captcha', ip: '198.51.100.20' });
check('kata sandi pendek ditolak', request({ action: 'kaderRegister', email: 'siti@example.com', name: 'Siti Aminah', password: 'singkat', ip: '198.51.100.20', captchaId: soalPendek.data.id, captchaAnswer: answerOf(soalPendek.data.question) }).error, 'Kata sandi minimal 8 karakter.');
const soalEmail = request({ action: 'captcha', ip: '198.51.100.20' });
check('email tidak valid ditolak', request({ action: 'kaderRegister', email: 'bukan-email', name: 'Siti Aminah', password: 'sandiku123', ip: '198.51.100.20', captchaId: soalEmail.data.id, captchaAnswer: answerOf(soalEmail.data.question) }).error, 'Alamat email tidak valid.');
const soalDaftar = request({ action: 'captcha', ip: '198.51.100.20' });
const daftar = request({ action: 'kaderRegister', email: 'Siti@Example.com', name: 'Siti Aminah', password: 'sandiku123', ip: '198.51.100.20', captchaId: soalDaftar.data.id, captchaAnswer: answerOf(soalDaftar.data.question) });
check('kader bisa daftar tanpa Google', daftar.data.role, 'kader');
check('email pendaftaran dinormalkan', daftar.data.kader.email, 'siti@example.com');
check('satu baris kader baru dibuat', rowsOf('Kaders').filter((row) => row.email === 'siti@example.com').length, 1);
check('kata sandi disimpan sebagai hash, bukan teks', rowsOf('Kaders').some((row) => row.passwordHash === 'sandiku123'), false);
const soalGanda = request({ action: 'captcha', ip: '198.51.100.25' });
const daftarGanda = request({ action: 'kaderRegister', email: 'siti@example.com', name: 'Siti Baru', password: 'sandiku456', ip: '198.51.100.25', captchaId: soalGanda.data.id, captchaAnswer: answerOf(soalGanda.data.question) });
check('email yang sudah punya akun tidak bisa daftar lagi', daftarGanda.error, 'Email ini sudah punya akun kader. Silakan masuk.');
http.google = { ...klaimGoogle, sub: 'sub-siti', email: 'siti@example.com', name: 'Siti Aminah' };
const gabungGoogle = request({ action: 'kaderLogin', idToken: 'head.payload.sig', ip: '198.51.100.26' });
check('akun email yang masuk lewat Google tidak dobel', rowsOf('Kaders').filter((row) => row.email === 'siti@example.com').length, 1);
check('identitas Google tertaut ke akun email', rowsOf('Kaders').find((row) => row.email === 'siti@example.com').googleSub, 'sub-siti');
check('masuk Google tetap memberi sesi kader', request({ action: 'whoami', token: gabungGoogle.data.token }).data.role, 'kader');
http.google = klaimGoogle;
const masukEmail = request({ action: 'kaderEmailLogin', email: 'siti@example.com', password: 'sandiku123', ip: '198.51.100.21' });
check('masuk dengan email dan kata sandi', masukEmail.data.role, 'kader');
check('sesi email dikenal sebagai kader', request({ action: 'whoami', token: masukEmail.data.token }).data.role, 'kader');
check('kata sandi salah ditolak', request({ action: 'kaderEmailLogin', email: 'siti@example.com', password: 'salah12345', ip: '198.51.100.22' }).error, 'Email atau kata sandi salah.');
check('email yang belum terdaftar gagal diam-diam', request({ action: 'kaderEmailLogin', email: 'tiada@example.com', password: 'apa12345', ip: '198.51.100.23' }).error, 'Email atau kata sandi salah.');
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
check('hasil unggah berupa URL publik Google', unggah.data.url.startsWith('https://lh3.googleusercontent.com/d/'), true);
check('jenis berkas dibaca dari tanda tangan byte', unggah.data.mime, 'image/jpeg');
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

const cariLbt = request({ action: 'pustakaCari', token: 'ses-rozak', q: 'apa itu LBT', ip: '198.51.100.80' });
check('sesi kader bisa mencari isi berkas', cariLbt.ok, true);
check('pencarian isi menemukan silabus LBT', cariLbt.data.hasil[0].judul, 'Silabus Leadership Basic Training');
check('hasil pencarian menyebut rentang halaman', Array.isArray(cariLbt.data.hasil[0].h), true);

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
check('health melaporkan korpus pustaka', sehatPustaka.pustaka, { tersedia: true, berkas: 3, potong: 4 });

const tanyaKader = request({ action: 'chat', token: 'ses-rozak', message: 'Bagaimana aturan waktu turba dalam kaderisasi?', ip: '198.51.100.85' });
const promptKader = http.calls.filter((call) => String(call.url).includes('pollinations')).at(-1);
const sistemKader = JSON.parse(promptKader.options.payload).messages[0].content;
check('jawaban Tanya PII ikut mengirim kutipan berkas', /Waktu turba tidak dibatasi/.test(sistemKader), true);
check('kutipan menyebut nama berkas dan nomor halaman', /Ebook Ta'dib PII \(halaman 120-124\)/.test(sistemKader), true);
check('prompt memerintahkan merujuk berkas', /BERKAS ORGANISASI PII YANG RELEVAN/.test(sistemKader), true);
check('jawaban AI membawa daftar rujukan', tanyaKader.data.rujukan[0].judul, "Ebook Ta'dib PII");
check('rujukan tidak ikut mengirim teks mentah', tanyaKader.data.rujukan[0].isi, undefined);

request({ action: 'chat', message: 'Apa itu turba?', ip: '198.51.100.86' });
const promptTamu = http.calls.filter((call) => String(call.url).includes('pollinations')).at(-1);
check('pengunjung tidak menerima isi berkas internal',
  /Waktu turba tidak dibatasi/.test(JSON.parse(promptTamu.options.payload).messages[0].content), false);

const korpus = gas.pustakaKorpus_();
check('pencarian kata yang tidak ada menghasilkan kosong', gas.pustakaCocok_(korpus, 'zirkoniumpalsu', 8).length, 0);
check('rujukan AI untuk tamu kosong', gas.pustakaRujukanAI_('turba', 'tamu').length, 0);
check('bentuk sitasi prompt', gas.pustakaPromptBagian_([]), '');

const konteksAI = request({ action: 'pustakaKonteks', token: 'ses-rozak', q: 'aturan waktu turba', ip: '198.51.100.87' });
check('gerbang AI minta potongan penuh ke Apps Script', /Waktu turba tidak dibatasi/.test(String(konteksAI.data.hasil[0].isi)), true);
check('potongan rujukan dibatasi panjangnya', konteksAI.data.hasil.every((item) => String(item.isi).length <= 1400), true);

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
