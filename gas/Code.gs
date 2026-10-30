/**
 * Backend CMS Website Pengurus Besar Pelajar Islam Indonesia.
 * Database: Google Sheets. API: Google Apps Script Web App.
 *
 * Cara pasang:
 * 1. Jalankan setup() dari spreadsheet yang terhubung.
 * 2. Tambahkan file HTML bernama AdminSetup dari AdminSetup.html.
 * 3. Atur password lewat menu PB PII > Atur akun admin. Bila hilang, jalankan
 *    aturUlangPasswordAdmin() lalu ganti lagi.
 * 4. Deploy sebagai Web App, execute as Me, access Anyone.
 * 5. Cek versi yang sedang melayani lewat doGet atau action "health".
 */
const BACKEND_VERSION = '2026-10-30.3';

const APP = {
  SHEET_ARTICLES: 'Articles',
  SHEET_SETTINGS: 'Settings',
  SHEET_GALLERY: 'Gallery',
  SHEET_ORGS: 'Orgs',
  SHEET_ACTIVITIES: 'Activities',
  SHEET_FORMS: 'Forms',
  SHEET_PARTICIPANTS: 'Participants',
  SHEET_LETTERS: 'Letters',
  SHEET_SESSIONS: 'Sessions',
  SHEET_CHAT: 'Chat',
  TOKEN_TTL_SECONDS: 21600,
  CHAT_DAILY_LIMIT: 20,
  CHAT_MAX_CHARS: 900,
  PROP_SPREADSHEET_ID: 'SPREADSHEET_ID',
  PROP_ADMIN_USERNAME: 'ADMIN_USERNAME',
  PROP_ADMIN_PASSWORD: 'ADMIN_PASSWORD',
  PROP_ADMIN_PASSWORD_HASH: 'ADMIN_PASSWORD_HASH',
  PROP_ADMIN_PASSWORD_SALT: 'ADMIN_PASSWORD_SALT',
  PROP_AI_KEY: 'AI_API_KEY',
  PROP_AI_URL: 'AI_CHAT_URL',
  PROP_AI_MODEL: 'AI_MODEL',
  PROP_MEDIA_FOLDER: 'MEDIA_FOLDER_ID',
  PB_ORG_ID: 'pb-pii',
  PB_ORG_NAME: 'Pengurus Besar PII'
};

/**
 * Kata sandi pemulihan akun admin. Nilainya terlihat di repository publik, jadi
 * jangan dipakai untuk login produksi: jalankan hanya lewat aturUlangPasswordAdmin()
 * bila akses hilang, lalu segera ganti lewat menu PB PII > Atur akun admin.
 * Kata sandi yang disimpan di server selalu berupa hash, bukan teks ini.
 */
const DEFAULT_ADMIN_PASSWORD = 'tauhid12';

const ORG_HEADERS = [
  'id', 'jenjang', 'name', 'province', 'district', 'subdistrict', 'parentId',
  'email', 'passwordHash', 'passwordSalt', 'phone', 'skUrl', 'status',
  'verifiedBy', 'verifiedAt', 'createdAt', 'updatedAt', 'lastLoginAt', 'note'
];
const ACTIVITY_HEADERS = [
  'id', 'orgId', 'title', 'category', 'date', 'location', 'description',
  'participants', 'coverImage', 'status', 'createdAt', 'updatedAt'
];
const FORM_HEADERS = [
  'id', 'orgId', 'activityId', 'title', 'description', 'status', 'createdAt', 'updatedAt'
];
const PARTICIPANT_HEADERS = [
  'id', 'formId', 'orgId', 'name', 'institution', 'phone', 'email', 'note', 'createdAt'
];
const LETTER_HEADERS = [
  'id', 'fromOrgId', 'toOrgId', 'category', 'subject', 'body', 'status', 'createdAt', 'readAt'
];

const LETTER_CATEGORIES = ['Kesekretariatan', 'Kebendaharaan', 'Kelembagaan', 'Eksternal'];
const JENJANG_LABEL = { PB: 'Pengurus Besar', PW: 'Pengurus Wilayah', PD: 'Pengurus Daerah', PK: 'Pengurus Komisariat' };
const PROVINCES = [
  'Aceh', 'Sumatera Utara', 'Sumatera Barat', 'Riau', 'Kepulauan Riau', 'Jambi',
  'Sumatera Selatan', 'Bangka Belitung', 'Bengkulu', 'Lampung',
  'Banten', 'DKI Jakarta', 'Jawa Barat', 'Jawa Tengah', 'DI Yogyakarta', 'Jawa Timur',
  'Bali', 'Nusa Tenggara Barat', 'Nusa Tenggara Timur',
  'Kalimantan Barat', 'Kalimantan Tengah', 'Kalimantan Selatan', 'Kalimantan Timur', 'Kalimantan Utara',
  'Sulawesi Utara', 'Gorontalo', 'Sulawesi Tengah', 'Sulawesi Barat', 'Sulawesi Selatan', 'Sulawesi Tenggara',
  'Maluku', 'Maluku Utara', 'Papua', 'Papua Barat', 'Papua Barat Daya', 'Papua Tengah',
  'Papua Pegunungan', 'Papua Selatan'
];

// Nama resmi wilayah.id yang berbeda dari penulisan di PROVINCES.
const PROVINCE_ALIASES = {
  'KEPULAUAN BANGKA BELITUNG': 'Bangka Belitung',
  'DAERAH ISTIMEWA YOGYAKARTA': 'DI Yogyakarta'
};

const ARTICLE_HEADERS = [
  'id', 'title', 'slug', 'category', 'excerpt', 'content',
  'coverImage', 'author', 'status', 'createdAt', 'updatedAt'
];
const GALLERY_HEADERS = [
  'id', 'title', 'imageUrl', 'caption',
  'featured', 'sortOrder', 'createdAt'
];
const SETTINGS_HEADERS = ['key', 'value'];
const SESSION_HEADERS = ['token', 'kind', 'subject', 'createdAt', 'expiresAt'];
const CHAT_HEADERS = [
  'createdAt', 'kind', 'subject', 'question', 'answer', 'provider', 'status'
];

// Satu daftar skema dipakai setup() dan health_() supaya tidak pernah berbeda.
const SHEET_SCHEMA = [
  [APP.SHEET_ARTICLES, ARTICLE_HEADERS],
  [APP.SHEET_SETTINGS, SETTINGS_HEADERS],
  [APP.SHEET_GALLERY, GALLERY_HEADERS],
  [APP.SHEET_ORGS, ORG_HEADERS],
  [APP.SHEET_ACTIVITIES, ACTIVITY_HEADERS],
  [APP.SHEET_FORMS, FORM_HEADERS],
  [APP.SHEET_PARTICIPANTS, PARTICIPANT_HEADERS],
  [APP.SHEET_LETTERS, LETTER_HEADERS],
  [APP.SHEET_SESSIONS, SESSION_HEADERS],
  [APP.SHEET_CHAT, CHAT_HEADERS]
];

const DEFAULT_SETTINGS = [
  ['siteName', 'Pengurus Besar Pelajar Islam Indonesia'],
  ['tagline', '#PIILevelUp'],
  ['heroTitle', 'Organisasi Pelajar Tertua di Indonesia, Bergerak Sejak 4 Mei 1947'],
  ['heroText', 'Pelajar Islam Indonesia (PII) telah menemani perjalanan bangsa selama puluhan tahun. Dari rahim sejarah itulah lahir kader-kader pelajar yang beriman, berilmu, dan berjuang untuk umat serta negara.'],
  ['chairmanName', 'Kevin Prayoga, S.H.'],
  ['chairmanRole', 'Periode 2026 – 2028'],
  ['chairmanPhoto', ''],
  ['chairmanGreeting', 'Assalamu’alaikum warahmatullahi wabarakatuh.\n\nPelajar Islam Indonesia, sebagai organisasi pelajar tertua di Indonesia, telah menemani perjalanan bangsa selama puluhan tahun. Namun zaman terus bergerak. Tantangan pelajar hari ini tidak lagi sama dengan satu atau dua dekade yang lalu. Perubahan sosial, teknologi, dan dinamika global menuntut PII untuk terus berbenah tanpa kehilangan jati dirinya.\n\nPII Level Up hadir sebagai ikhtiar kolektif untuk meningkatkan kualitas kaderisasi dan penguatan kelembagaan agar PII tetap relevan, berdampak, dan berkelanjutan. Ini bukan tentang meninggalkan nilai, melainkan memperkuatnya. Bukan menghapus sejarah, tetapi melanjutkannya dengan cara yang lebih adaptif dan progresif.\n\nMelalui pembaruan sistem kaderisasi, penguatan kapasitas kader, serta pengelolaan kelembagaan yang lebih profesional, PII Level Up menjadi ruang tumbuh bagi pelajar Islam untuk naik kelas — dalam karakter, intelektualitas, dan kepemimpinan.\n\nWassalamu’alaikum warahmatullahi wabarakatuh.'],
  ['chairmanGreetingVisible', 'true'],
  ['aboutText', 'Pelajar Islam Indonesia (PII) berdiri di Yogyakarta pada 4 Mei 1947 dan menjadi organisasi pelajar tertua di Indonesia. PII bergerak dalam bidang pendidikan dan kebudayaan dengan tujuan mewujudkan kesempurnaan pendidikan dan kebudayaan yang sesuai dengan Islam bagi segenap rakyat Indonesia dan umat manusia.'],
  ['footerText', 'Pengurus Besar — Pelajar Islam Indonesia · Jl. Menteng Raya No. 58, Jakarta Pusat'],
  ['contactEmail', ''],
  ['instagramUrl', ''],
  ['youtubeUrl', '']
];

const ALLOWED_SETTINGS = [
  'siteName',
  'tagline',
  'heroTitle',
  'heroText',
  'chairmanName',
  'chairmanRole',
  'chairmanPhoto',
  'chairmanGreeting',
  'chairmanGreetingVisible',
  'aboutText',
  'footerText',
  'contactEmail',
  'instagramUrl',
  'youtubeUrl'
];

/**
 * Buat sheet yang dibutuhkan tanpa menghapus data yang sudah ada, lalu perbaiki
 * struktur yang tertinggal dari versi kode ini. Idempoten: aman dijalankan
 * berulang pada spreadsheet yang sudah berisi data.
 */
function setup() {
  let spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const properties = PropertiesService.getScriptProperties();
  const savedId = properties.getProperty(APP.PROP_SPREADSHEET_ID);

  if (!spreadsheet && savedId) {
    spreadsheet = SpreadsheetApp.openById(savedId);
  }
  if (!spreadsheet) {
    throw new Error('Buka Apps Script dari Google Spreadsheet website PB PII, lalu jalankan setup() kembali.');
  }

  const dibuat = [];
  const diperbaiki = [];
  const perluTinjauan = [];

  SHEET_SCHEMA.forEach(function (entry) {
    const result = ensureSheet_(spreadsheet, entry[0], entry[1]);
    if (result.created) dibuat.push(entry[0]);
    if (result.repaired) diperbaiki.push(entry[0]);
    if (result.mismatch) {
      perluTinjauan.push(entry[0] + ' (kolom: ' + result.mismatch.join(', ') + ')');
    }
  });

  const settingsSheet = spreadsheet.getSheetByName(APP.SHEET_SETTINGS);
  const orgsSheet = spreadsheet.getSheetByName(APP.SHEET_ORGS);

  properties.setProperty(APP.PROP_SPREADSHEET_ID, spreadsheet.getId());
  properties.setProperty(APP.PROP_ADMIN_USERNAME, 'admin');

  const punyaKataSandi = Boolean(properties.getProperty(APP.PROP_ADMIN_PASSWORD_HASH)) ||
    Boolean(properties.getProperty(APP.PROP_ADMIN_PASSWORD));
  if (!punyaKataSandi) {
    saveAdminPassword_(DEFAULT_ADMIN_PASSWORD);
  }

  if (settingsSheet) {
    ensureDefaultSettings_(settingsSheet);
  }
  const pbDibuat = orgsSheet ? ensurePbOrg_(orgsSheet) : false;
  if (pbDibuat) dibuat.push('akun induk ' + APP.PB_ORG_ID);

  const laporan = [];
  laporan.push('Backend ' + BACKEND_VERSION + ' siap. Spreadsheet: ' + spreadsheet.getId() + '.');
  laporan.push(dibuat.length
    ? 'Dibuat: ' + dibuat.join(', ') + '.'
    : 'Semua sheet sudah ada; tidak ada yang dibuat baru.');
  if (diperbaiki.length) laporan.push('Kolom dilengkapi: ' + diperbaiki.join(', ') + '.');
  if (perluTinjauan.length) {
    laporan.push('PERLU TINJAUAN MANUAL — header tidak sesuai skema, tidak diubah: ' +
      perluTinjauan.join('; ') + '.');
  }
  laporan.push(punyaKataSandi
    ? 'Kata sandi admin yang sudah ada tetap berlaku; nilai teks polos lama otomatis berubah jadi hash pada login berikutnya.'
    : 'Kata sandi awal: ' + DEFAULT_ADMIN_PASSWORD + ' — segera ganti lewat menu PB PII > Atur akun admin.');

  const message = laporan.join('\n');
  try {
    SpreadsheetApp.getUi().alert(message);
  } catch (error) {
    // Dipanggil dari editor: hasil tampil di panel eksekusi.
    Logger.log(message);
  }
  return message;
}

/**
 * Pemulihan akun admin: setel ulang username dan kata sandi ke nilai awal.
 * Jalankan sekali dari editor Apps Script bila kata sandi admin hilang,
 * lalu segera ganti lewat menu PB PII > Atur akun admin.
 */
function aturUlangPasswordAdmin() {
  const properties = PropertiesService.getScriptProperties();
  properties.setProperty(APP.PROP_ADMIN_USERNAME, 'admin');
  saveAdminPassword_(DEFAULT_ADMIN_PASSWORD);
  const message =
    'Akun admin disetel ulang.\n\nUsername: admin\nKata sandi: ' + DEFAULT_ADMIN_PASSWORD +
    '\n\nSegera ganti melalui menu PB PII > Atur akun admin.';
  try {
    SpreadsheetApp.getUi().alert(message);
  } catch (error) {
    // Dipanggil dari editor Apps Script: hasil tampil di panel eksekusi.
    Logger.log(message);
  }
  return message;
}

/**
 * Menampilkan URL Web App (/exec) milik project ini supaya mudah disalin ke
 * Vercel (GAS_WEB_APP_URL) atau dibandingkan dengan URL yang dipakai website.
 * Bila deployment Web App belum ada, Apps Script mengembalikan URL yang baru
 * valid setelah deployment dibuat di menu Deploy.
 */
function tampilkanUrlBackend() {
  let url = '';
  try {
    url = ScriptApp.getService().getUrl();
  } catch (error) {
    url = 'URL service belum tersedia: ' + error.message;
  }
  const message =
    'URL backend website (Tempel di Vercel > Environment Variables > GAS_WEB_APP_URL):\n\n' + url +
    '\n\nBuka URL itu di browser untuk melihat versi backend yang sedang melayani (versi kode ini: ' + BACKEND_VERSION + ').' +
    '\nSitus membaca satu titik saja di api/pii.js, jadi cukup ganti nilai ini.' +
    '\nBila versi di browser lebih lama, pilih Deploy > Manage deployments > New version.';
  try {
    SpreadsheetApp.getUi().alert(message);
  } catch (error) {
    // Dipanggil dari editor Apps Script: hasil tampil di panel eksekusi.
    Logger.log(message);
  }
  return url;
}

/**
 * Tambahkan menu pengaturan akun pada spreadsheet saat dibuka.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('PB PII')
    .addItem('Atur akun admin', 'configureAdmin')
    .addItem('Setel ulang password admin', 'aturUlangPasswordAdmin')
    .addItem('Salin URL backend (/exec)', 'tampilkanUrlBackend')
    .addItem('Segarkan teks resmi website', 'segarkanTeksResmi')
    .addItem('Ganti teks dengan salinan resmi', 'paksaTeksResmi')
    .addToUi();
}

/**
 * Menimpa seluruh teks kop dengan salinan resmi, termasuk nilai yang sudah
 * pernah ditulis sebelumnya. Dipakai saat salinan resmi di repository berubah.
 */
function paksaTeksResmi() {
  return segarkanTeksResmi(true);
}

/**
 * Menimpa teks kop website dengan salinan resmi PB PII terbaru. Nilai yang
 * sudah diubah redaksi lewat dashboard admin sengaja dilewati, kecuali dipaksa.
 */
function segarkanTeksResmi(force) {
  const sheet = sheet_(APP.SHEET_SETTINGS);
  const rows = sheet.getLastRow() > 1
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getDisplayValues()
    : [];
  const rowOfKey = new Map();
  rows.forEach(function (row, index) {
    rowOfKey.set(String(row[0]).trim(), index + 2);
  });

  const updated = [];
  const added = [];
  const skipped = [];

  DEFAULT_SETTINGS.forEach(function (setting) {
    const key = String(setting[0]);
    const value = String(setting[1]);
    const rowNumber = rowOfKey.get(key);

    if (!rowNumber) {
      sheet.appendRow([key, value]);
      added.push(key);
      return;
    }
    const existing = String(sheet.getRange(rowNumber, 2).getDisplayValue());
    if (existing === value) {
      return;
    }
    if (!force) {
      skipped.push(key);
      return;
    }
    sheet.getRange(rowNumber, 2).setValue(value);
    updated.push(key);
  });

  const parts = [];
  if (added.length) parts.push('ditambah (' + added.join(', ') + ')');
  if (updated.length) parts.push('diperbarui (' + updated.join(', ') + ')');
  if (skipped.length) parts.push(skipped.length + ' nilai hasil edit redaksi dipertahankan');
  const message = parts.length
    ? 'Teks resmi: ' + parts.join('; ') + '.'
    : 'Semua teks sudah sesuai salinan resmi.';

  try {
    SpreadsheetApp.getUi().alert(message);
  } catch (error) {
    // Dipanggil dari editor/API tanpa UI, pesan tetap dikembalikan.
    Logger.log(message);
  }
  return message;
}

function configureAdmin() {
  const html = HtmlService.createHtmlOutputFromFile('AdminSetup')
    .setWidth(420)
    .setHeight(470);
  SpreadsheetApp.getUi().showModalDialog(html, 'Atur akun admin PB PII');
}

/**
 * Dipanggil dari AdminSetup.html. Password hanya disimpan sebagai Script Property.
 */
function saveAdminPassword(password, confirmation) {
  const value = String(password || '');
  const repeated = String(confirmation || '');

  if (value.length < 8) {
    throw new Error('Password harus terdiri dari minimal 8 karakter.');
  }
  if (value !== repeated) {
    throw new Error('Konfirmasi password tidak cocok.');
  }

  const properties = PropertiesService.getScriptProperties();
  properties.setProperty(APP.PROP_ADMIN_USERNAME, 'admin');
  saveAdminPassword_(value);
  return 'Akun admin siap digunakan. Username: admin.';
}

/** Kata sandi hanya boleh tinggal sebagai hash + salt, tidak pernah sebagai teks. */
function saveAdminPassword_(password) {
  const properties = PropertiesService.getScriptProperties();
  const salt = Utilities.getUuid();
  properties.setProperty(APP.PROP_ADMIN_PASSWORD_HASH, hashPassword_(password, salt));
  properties.setProperty(APP.PROP_ADMIN_PASSWORD_SALT, salt);
  properties.deleteProperty(APP.PROP_ADMIN_PASSWORD);
}

function adminPasswordReady_() {
  const properties = PropertiesService.getScriptProperties();
  return Boolean(properties.getProperty(APP.PROP_ADMIN_PASSWORD_HASH)) ||
    Boolean(properties.getProperty(APP.PROP_ADMIN_PASSWORD));
}

function verifyAdminPassword_(password) {
  const properties = PropertiesService.getScriptProperties();
  const hash = properties.getProperty(APP.PROP_ADMIN_PASSWORD_HASH);
  const salt = properties.getProperty(APP.PROP_ADMIN_PASSWORD_SALT);
  if (hash && salt) {
    return hashPassword_(password, salt) === String(hash);
  }

  // Deployment lama masih menyimpan teks polos: naikkan ke hash saat cocok,
  // supaya penggantian kode ini tidak pernah mengunci admin yang sedang bertugas.
  const legacy = properties.getProperty(APP.PROP_ADMIN_PASSWORD);
  if (legacy && String(password) === legacy) {
    saveAdminPassword_(legacy);
    return true;
  }
  return false;
}

/**
 * Buka URL /exec di browser untuk memeriksa versi backend yang sedang melayani
 * tanpa perlu token login.
 */
function doGet() {
  return json_(health_());
}

/**
 * Status operasional: versi kode, kesiapan sheet, dan jumlah baris. Tidak
 * mengembalikan kata sandi, token, maupun isi data.
 */
function health_() {
  const properties = PropertiesService.getScriptProperties();
  const spreadsheetId = properties.getProperty(APP.PROP_SPREADSHEET_ID) || '';
  const sheets = {};
  const masalah = [];

  if (spreadsheetId) {
    const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    SHEET_SCHEMA.forEach(function (entry) {
      const sheet = spreadsheet.getSheetByName(entry[0]);
      if (!sheet) {
        sheets[entry[0]] = null;
        masalah.push(entry[0] + ' belum ada');
        return;
      }
      sheets[entry[0]] = Math.max(0, sheet.getLastRow() - 1);
    });
  } else {
    masalah.push('SPREADSHEET_ID belum diatur');
  }

  if (!properties.getProperty(APP.PROP_ADMIN_PASSWORD_HASH) &&
      !properties.getProperty(APP.PROP_ADMIN_PASSWORD)) {
    masalah.push('kata sandi admin belum diatur');
  }

  return {
    ok: masalah.length === 0,
    service: 'PB PII CMS API',
    version: BACKEND_VERSION,
    spreadsheetId: spreadsheetId,
    sheets: sheets,
    masalah: masalah,
    message: masalah.length
      ? 'Jalankan setup() dari editor Apps Script.'
      : 'Backend siap. Gunakan POST melalui proxy Vercel.'
  };
}

/**
 * API untuk konten publik, login/logout, dan operasi dashboard admin.
 */
function doPost(event) {
  try {
    const raw = event && event.postData && event.postData.contents
      ? event.postData.contents
      : '{}';
    const body = JSON.parse(raw);
    const action = String(body.action || '');
    let data;

    if (action === 'health') {
      data = health_();
    } else if (action === 'public') {
      data = publicData_();
    } else if (action === 'chat') {
      data = chat_(body);
    } else if (action === 'chatStatus') {
      data = chatStatus_(body);
    } else if (action === 'login') {
      data = login_(body);
    } else if (action === 'logout') {
      data = logout_(body.token);
    } else if (action === 'orgLookup') {
      data = orgLookup_();
    } else if (action === 'orgRegister') {
      data = orgRegister_(body);
    } else if (action === 'orgLogin') {
      data = orgLogin_(body);
    } else if (action === 'publicForm') {
      data = publicForm_(body.id);
    } else if (action === 'publicRegister') {
      data = publicRegister_(body);
    } else if (action.indexOf('org') === 0) {
      data = orgAction_(action, body, requireOrg_(body.token));
    } else {
      requireAuth_(body.token);
      data = adminAction_(action, body);
    }

    return json_({ ok: true, data: data });
  } catch (error) {
    return json_({
      ok: false,
      error: String(error && error.message ? error.message : error)
    });
  }
}

function adminAction_(action, body) {
  switch (action) {
    case 'adminData':
      return adminData_();
    case 'saveSettings':
      return saveSettings_(body.settings || {});
    case 'saveArticle':
      return saveArticle_(body.article || {});
    case 'deleteArticle':
      return deleteRowById_(APP.SHEET_ARTICLES, body.id);
    case 'saveGalleryItem':
      return saveGalleryItem_(body.item || {});
    case 'uploadImage':
      return uploadImage_(body);
    case 'deleteGalleryItem':
      return deleteRowById_(APP.SHEET_GALLERY, body.id);
    case 'adminOrgs':
      return adminOrgs_();
    case 'adminVerifyOrg':
      return orgSetStatus_(body.id, body.decision, 'admin', '');
    case 'adminSavePbAccount':
      return adminSavePbAccount_(body);
    default:
      throw new Error('Aksi tidak dikenal.');
  }
}

function login_(body) {
  const properties = PropertiesService.getScriptProperties();
  const username = String(
    properties.getProperty(APP.PROP_ADMIN_USERNAME) || ''
  ).trim();

  if (!username || !adminPasswordReady_()) {
    throw new Error('Admin belum dikonfigurasi. Pilih menu PB PII > Atur akun admin pada spreadsheet.');
  }
  if (
    String(body.username || '').trim().toLowerCase() !== username.toLowerCase() ||
    !verifyAdminPassword_(String(body.password || ''))
  ) {
    throw new Error('Username atau kata sandi salah.');
  }

  const token = sessionPut_('admin', username);

  return {
    token: token,
    username: username,
    expiresIn: APP.TOKEN_TTL_SECONDS
  };
}

function requireAuth_(token) {
  if (!sessionSubject_(token, 'admin')) {
    throw new Error('Sesi berakhir atau token tidak valid. Silakan login kembali.');
  }
}

function logout_(token) {
  sessionDrop_(token);
  return { loggedOut: true };
}

/**
 * Sesi disimpan di sheet, bukan CacheService. Cache script Apps Script dipaksa
 * maksimal 10 menit, jadi sesi 6 jam yang dijanjikan TOKEN_TTL_SECONDS sebenarnya
 * gugur lebih cepat dan pengguna terus diminta login ulang.
 */
function sessionPut_(kind, subject) {
  const token = Utilities.getUuid() + '-' + Utilities.getUuid();
  const now = new Date();
  sheet_(APP.SHEET_SESSIONS).appendRow([
    token,
    kind,
    String(subject),
    now.toISOString(),
    new Date(now.getTime() + APP.TOKEN_TTL_SECONDS * 1000).toISOString()
  ]);
  pruneSessions_(now.toISOString());
  return token;
}

function sessionSubject_(token, kind) {
  if (!token) {
    return '';
  }
  const nowIso = new Date().toISOString();
  const rows = rows_(APP.SHEET_SESSIONS);
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i].token) !== String(token)) continue;
    if (String(rows[i].kind) !== kind) return '';
    return String(rows[i].expiresAt) >= nowIso ? String(rows[i].subject || '') : '';
  }
  return '';
}

function sessionDrop_(token) {
  if (!token) {
    return;
  }
  dropSessions_(function (row) { return String(row[0]) === String(token); });
}

/** Hapus baris Sessions dari bawah ke atas supaya nomor baris yang belum dibaca tidak bergeser. */
function dropSessions_(predicate) {
  const sheet = sheet_(APP.SHEET_SESSIONS);
  const values = sheet.getDataRange().getValues();
  for (let i = values.length - 1; i > 0; i--) {
    if (predicate(values[i])) {
      sheet.deleteRow(i + 1);
    }
  }
}

function pruneSessions_(nowIso) {
  const cutoff = Date.parse(nowIso);
  dropSessions_(function (row) { return timeOf_(row[4]) < cutoff; });
}

/** Sel tanggal Sheets datang sebagai Date, jadi selalu dibandingkan lewat epoch. */
function timeOf_(value) {
  if (value instanceof Date) {
    return value.getTime();
  }
  const parsed = Date.parse(String(value));
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Asisten "Tanya PII". Hanya untuk sesi login (admin atau lembaga) dan dibatasi
 * APP.CHAT_DAILY_LIMIT pertanyaan berhasil per akun per hari, karena kuota
 * layanan AI gratis kecil dan jumlah kader yang memakai juga terbatas.
 */
function chat_(body) {
  const me = chatIdentity_(body.token);
  const question = cleanText_(body.message).slice(0, APP.CHAT_MAX_CHARS);
  if (question.length < 3) {
    throw new Error('Tulis pertanyaan dengan jelas.');
  }

  const dipakai = chatUsageToday_(me);
  if (dipakai >= APP.CHAT_DAILY_LIMIT) {
    throw new Error('Kuota ' + APP.CHAT_DAILY_LIMIT + ' pertanyaan hari ini untuk ' +
      me.label + ' sudah habis. Coba lagi besok.');
  }

  let jawaban;
  try {
    jawaban = askModel_(question, me);
  } catch (error) {
    logChat_(me, question, '', 'percobaan', 'gagal');
    throw error;
  }

  logChat_(me, question, jawaban.reply, jawaban.provider, 'ok');
  return {
    reply: jawaban.reply,
    provider: jawaban.provider,
    sisa: Math.max(0, APP.CHAT_DAILY_LIMIT - dipakai - 1)
  };
}

function chatStatus_(body) {
  const me = chatIdentity_(body.token);
  const dipakai = chatUsageToday_(me);
  return {
    boleh: dipakai < APP.CHAT_DAILY_LIMIT,
    akun: me.label,
    batas: APP.CHAT_DAILY_LIMIT,
    dipakai: dipakai,
    sisa: Math.max(0, APP.CHAT_DAILY_LIMIT - dipakai)
  };
}

function chatIdentity_(token) {
  const admin = sessionSubject_(token, 'admin');
  if (admin) {
    return { kind: 'admin', subject: admin, label: 'admin' };
  }

  const orgId = sessionSubject_(token, 'org');
  if (!orgId) {
    throw new Error('Tanya PII khusus kader yang sudah login. Silakan masuk terlebih dahulu.');
  }
  const org = orgById_(rows_(APP.SHEET_ORGS), orgId);
  return { kind: 'org', subject: orgId, label: (org && cleanText_(org.name)) || orgId };
}

function chatUsageToday_(me) {
  const today = chatDay_(new Date());
  return rows_(APP.SHEET_CHAT).filter(function (row) {
    return String(row.status) === 'ok' &&
      String(row.kind) === me.kind &&
      String(row.subject) === String(me.subject) &&
      chatDay_(new Date(timeOf_(row.createdAt))) === today;
  }).length;
}

function chatDay_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function logChat_(me, question, answer, provider, status) {
  sheet_(APP.SHEET_CHAT).appendRow([
    new Date().toISOString(),
    me.kind,
    String(me.subject),
    String(question).slice(0, APP.CHAT_MAX_CHARS),
    String(answer).slice(0, 4000),
    provider,
    status
  ]);
}

/**
 * Satu jalur untuk semua layanan AI yang mengikuti format OpenAI: Pollinations
 * (tanpa kunci, bawaan), Groq, OpenAI, atau endpoint kompatibel Gemini. Ganti
 * lewat Script Properties: AI_CHAT_URL, AI_MODEL, AI_API_KEY.
 */
function askModel_(question, me) {
  const properties = PropertiesService.getScriptProperties();
  const key = String(properties.getProperty(APP.PROP_AI_KEY) || '').trim();
  const url = String(properties.getProperty(APP.PROP_AI_URL) || '').trim() ||
    'https://text.pollinations.ai/openai';
  const model = String(properties.getProperty(APP.PROP_AI_MODEL) || '').trim() ||
    (key ? 'gpt-4o-mini' : 'openai');

  const headers = { 'Content-Type': 'application/json' };
  if (key) {
    headers.Authorization = 'Bearer ' + key;
  }

  let response;
  try {
    response = UrlFetchApp.fetch(url, {
      method: 'post',
      headers: headers,
      payload: JSON.stringify({
        model: model,
        temperature: 0.4,
        messages: [
          { role: 'system', content: chatSystemPrompt_(me) },
          { role: 'user', content: question }
        ]
      }),
      muteHttpExceptions: true
    });
  } catch (error) {
    throw new Error('Layanan AI tidak menjawab tepat waktu. Silakan coba lagi.');
  }

  const code = response.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error('Layanan AI menolak permintaan (kode ' + code + ').');
  }

  let parsed;
  try {
    parsed = JSON.parse(response.getContentText());
  } catch (error) {
    throw new Error('Balasan layanan AI tidak dapat dibaca.');
  }

  const choice = parsed && parsed.choices && parsed.choices[0];
  const reply = cleanText_(choice && choice.message && choice.message.content);
  if (!reply) {
    throw new Error('Layanan AI mengembalikan jawaban kosong.');
  }
  return { reply: reply.slice(0, 4000), provider: model };
}

function chatSystemPrompt_(me) {
  const settings = settingsMap_();
  const identitas = me.kind === 'org'
    ? 'Penanya login sebagai pengurus ' + me.label + '.'
    : 'Penanya login sebagai pengelola website.';

  return [
    'Kamu adalah asisten "Tanya PII" di website resmi PB PII.',
    'Organisasi ini adalah ' + (settings.siteName || 'Pengurus Besar Pelajar Islam Indonesia') +
      ' (PII), bukan istilah Personally Identifiable Information.',
    'Slogan: ' + (settings.tagline || '#PIILevelUp') + '.',
    'Ketua Umum PB PII: ' + (settings.chairmanName || 'Kevin Prayoga, S.H.') +
      ' (' + (settings.chairmanRole || '') + ').',
    'PII berdiri di Yogyakarta pada 4 Mei 1947 sebagai organisasi pelajar tertua di Indonesia,',
    'bergerak di bidang pendidikan dan kebudayaan; struktur kepengurusannya PB, PW (wilayah),',
    'PD (daerah), dan PK (komisariat).',
    identitas,
    'Jawab dalam bahasa Indonesia, ringkas, maksimal 160 kata, tanpa format markdown berat.',
    'Jangan mengarang nama orang, tanggal, angka, atau keputusan resmi. Bila tidak yakin,',
    'katakan tidak tahu dan arahkan penanya mengonfirmasi lewat pengurus atau dashboard website.',
    'Hindari politik praktis dan hindari memberi fatwa; arahkan pertanyaan agama kepada ustadz',
    'atau pengurus.'
  ].join(' ');
}

function publicData_() {
  const articles = rows_(APP.SHEET_ARTICLES)
    .filter(function (article) {
      return String(article.status).toLowerCase() === 'published';
    })
    .sort(function (a, b) {
      return String(b.createdAt).localeCompare(String(a.createdAt));
    });

  const gallery = rows_(APP.SHEET_GALLERY)
    .filter(function (item) {
      return String(item.featured).toLowerCase() === 'true';
    })
    .sort(function (a, b) {
      return (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0);
    });

  return {
    settings: settingsMap_(),
    articles: articles,
    gallery: gallery
  };
}

function adminData_() {
  return {
    settings: settingsMap_(),
    articles: rows_(APP.SHEET_ARTICLES).sort(function (a, b) {
      return String(b.updatedAt).localeCompare(String(a.updatedAt));
    }),
    gallery: rows_(APP.SHEET_GALLERY).sort(function (a, b) {
      return (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0);
    })
  };
}

function settingsMap_() {
  const result = {};
  rows_(APP.SHEET_SETTINGS).forEach(function (row) {
    result[String(row.key)] = row.value == null ? '' : String(row.value);
  });
  return result;
}

function saveSettings_(values) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    throw new Error('Format pengaturan tidak valid.');
  }

  const sheet = sheet_(APP.SHEET_SETTINGS);
  const rows = sheet.getDataRange().getValues();
  const rowByKey = {};

  for (let i = 1; i < rows.length; i++) {
    rowByKey[String(rows[i][0])] = i + 1;
  }

  ALLOWED_SETTINGS.forEach(function (key) {
    if (!Object.prototype.hasOwnProperty.call(values, key)) {
      return;
    }

    const value = key === 'chairmanPhoto'
      ? safeUrl_(values[key])
      : String(values[key] == null ? '' : values[key]);

    if (rowByKey[key]) {
      sheet.getRange(rowByKey[key], 2).setValue(value);
    } else {
      sheet.appendRow([key, value]);
    }
  });

  return settingsMap_();
}

function saveArticle_(article) {
  const title = String(article.title || '').trim();
  if (!title) {
    throw new Error('Judul artikel wajib diisi.');
  }

  const status = String(article.status || 'draft').toLowerCase();
  if (['draft', 'published'].indexOf(status) === -1) {
    throw new Error('Status artikel tidak valid.');
  }

  const sheet = sheet_(APP.SHEET_ARTICLES);
  const id = String(article.id || Utilities.getUuid());
  const existing = findRow_(APP.SHEET_ARTICLES, id);
  const now = new Date().toISOString();
  const row = [
    id,
    title,
    slugify_(article.slug || title),
    String(article.category || 'Berita').trim(),
    String(article.excerpt || '').trim(),
    String(article.content || ''),
    safeUrl_(article.coverImage),
    String(article.author || 'Redaksi PB PII').trim(),
    status,
    existing ? existing.createdAt : now,
    now
  ];

  if (existing) {
    sheet.getRange(existing._row, 1, 1, row.length).setValues([row]);
  } else {
    sheet.appendRow(row);
  }

  return { id: id, slug: row[2], status: status };
}

function saveGalleryItem_(item) {
  const title = String(item.title || '').trim();
  const imageUrl = safeUrl_(item.imageUrl);

  if (!title || !imageUrl) {
    throw new Error('Judul dan URL gambar wajib diisi.');
  }

  const sheet = sheet_(APP.SHEET_GALLERY);
  const id = String(item.id || Utilities.getUuid());
  const existing = findRow_(APP.SHEET_GALLERY, id);
  const sortOrder = Number(item.sortOrder);
  const row = [
    id,
    title,
    imageUrl,
    String(item.caption || '').trim(),
    String(item.featured) === 'true' ? 'true' : 'false',
    Number.isFinite(sortOrder) ? sortOrder : 0,
    existing ? existing.createdAt : new Date().toISOString()
  ];

  if (existing) {
    sheet.getRange(existing._row, 1, 1, row.length).setValues([row]);
  } else {
    sheet.appendRow(row);
  }

  return { id: id };
}

function deleteRowById_(sheetName, id) {
  const value = String(id || '');
  if (!value) {
    throw new Error('ID data wajib diisi.');
  }

  const existing = findRow_(sheetName, value);
  if (!existing) {
    throw new Error('Data tidak ditemukan.');
  }

  sheet_(sheetName).deleteRow(existing._row);
  return { deleted: true, id: value };
}

function rows_(sheetName) {
  const sheet = sheet_(sheetName);
  const values = sheet.getDataRange().getValues();

  if (values.length < 2) {
    return [];
  }

  const headers = values[0].map(String);
  return values.slice(1)
    .filter(function (row) {
      return row.some(function (value) {
        return value !== '' && value !== null;
      });
    })
    .map(function (row) {
      const result = {};
      headers.forEach(function (header, index) {
        const value = row[index];
        result[header] = value instanceof Date ? value.toISOString() : value;
      });
      return result;
    });
}

function findRow_(sheetName, id) {
  const sheet = sheet_(sheetName);
  const values = sheet.getDataRange().getValues();

  if (values.length < 2) {
    return null;
  }

  const headers = values[0].map(String);
  const idColumn = headers.indexOf('id');
  if (idColumn < 0) {
    return null;
  }

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][idColumn]) !== String(id)) {
      continue;
    }

    const result = {};
    headers.forEach(function (header, index) {
      const value = values[i][index];
      result[header] = value instanceof Date ? value.toISOString() : value;
    });
    result._row = i + 1;
    return result;
  }

  return null;
}

function ensureSheet_(spreadsheet, name, headers) {
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(name);
  }

  if (sheet.getLastRow() === 0) {
    styleHeader_(sheet, headers);
    return { sheet: sheet, created: true, repaired: false };
  }

  const existing = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0]
    .map(function (value) { return String(value).trim(); })
    .filter(function (value) { return value !== ''; });

  const sama = existing.length === headers.length && headers.every(function (header, index) {
    return existing[index] === header;
  });
  if (sama) {
    return { sheet: sheet, created: false, repaired: false };
  }

  // Skema baru hanya menambah kolom di ujung, jadi header boleh ditambal
  // tanpa menggeser data. Susunan kolom yang berbeda tidak pernah diubah otomatis.
  const tinggalDiperpanjang = existing.every(function (header, index) {
    return header === headers[index];
  });
  if (tinggalDiperpanjang) {
    styleHeader_(sheet, headers);
    return { sheet: sheet, created: false, repaired: true };
  }

  return { sheet: sheet, created: false, repaired: false, mismatch: existing };
}

function styleHeader_(sheet, headers) {
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
}

function ensurePbOrg_(sheet) {
  const lastRow = sheet.getLastRow();
  const ids = lastRow > 1
    ? sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues()
    : [];
  const alreadyThere = ids.some(function (row) {
    return String(row[0]).trim() === APP.PB_ORG_ID;
  });
  if (alreadyThere) {
    return false;
  }

  const now = new Date().toISOString();
  sheet.appendRow([
    APP.PB_ORG_ID, 'PB', APP.PB_ORG_NAME, '', '', '', '',
    '', '', '', '', '', 'verified', 'setup', now, now, now, '',
    'Akun induk organisasi'
  ]);
  return true;
}

function ensureDefaultSettings_(sheet) {
  const existingKeys = {};
  const lastRow = sheet.getLastRow();

  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues()
      .forEach(function (row) {
        existingKeys[String(row[0])] = true;
      });
  }

  DEFAULT_SETTINGS.forEach(function (setting) {
    if (!existingKeys[setting[0]]) {
      sheet.appendRow(setting);
    }
  });
}

function sheet_(name) {
  const id = PropertiesService.getScriptProperties()
    .getProperty(APP.PROP_SPREADSHEET_ID);

  if (!id) {
    throw new Error('Database belum disiapkan. Jalankan setup() terlebih dahulu.');
  }

  const spreadsheet = SpreadsheetApp.openById(id);
  const sheet = spreadsheet.getSheetByName(name);
  if (!sheet) {
    throw new Error('Sheet ' + name + ' belum tersedia. Jalankan setup() terlebih dahulu.');
  }
  return sheet;
}

function slugify_(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || Utilities.getUuid();
}

const MEDIA_FOLDER_NAME = 'PB PII Media';
const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;

/**
 * Folder Drive untuk foto yang diunggah dari dashboard. Id-nya disimpan sebagai
 * Script Property supaya dua orang yang menyimpan bersamaan tidak membuat dua
 * folder berbeda.
 */
function mediaFolder_() {
  const properties = PropertiesService.getScriptProperties();
  const stored = properties.getProperty(APP.PROP_MEDIA_FOLDER);
  if (stored) {
    try {
      return DriveApp.getFolderById(stored);
    } catch (error) {
      // Folder dihapus manual dari Drive: dibuat ulang di bawah.
    }
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const found = DriveApp.getFoldersByName(MEDIA_FOLDER_NAME);
    const folder = found.hasNext() ? found.next() : DriveApp.createFolder(MEDIA_FOLDER_NAME);
    properties.setProperty(APP.PROP_MEDIA_FOLDER, folder.getId());
    return folder;
  } finally {
    lock.releaseLock();
  }
}

/** Jenis berkas dibaca dari tanda tangan byte, bukan dari label yang dikirim browser. */
function imageKind_(bytes) {
  const fourCC = (offset) => String.fromCharCode.apply(null, bytes.slice(offset, offset + 4));
  if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return 'image/png';
  if (fourCC(0) === 'RIFF' && fourCC(8) === 'WEBP') return 'image/webp';
  return '';
}

/**
 * Menyimpan foto langsung ke Drive dan membalas URL publik, jadi pengurus cukup
 * menyeret berkas dari ponsel alih-alih menaruh gambarnya di tempat lain dulu.
 */
function uploadImage_(body) {
  const raw = String(body.data || '').replace(/^data:[^,]*;base64,/i, '').replace(/\s/g, '');
  if (!raw) {
    throw new Error('Tidak ada berkas gambar yang dikirim.');
  }

  let bytes;
  try {
    bytes = Utilities.base64Decode(raw);
  } catch (error) {
    throw new Error('Data gambar tidak terbaca sebagai base64.');
  }

  const mime = imageKind_(bytes);
  if (!mime) {
    throw new Error('Hanya berkas JPEG, PNG, atau WebP yang diterima.');
  }
  if (bytes.length > MAX_UPLOAD_BYTES) {
    throw new Error('Ukuran foto melebihi 3 MB. Kecilkan terlebih dahulu.');
  }

  const extension = mime === 'image/jpeg' ? 'jpg' : mime === 'image/png' ? 'png' : 'webp';
  const name = slugify_(body.name || 'foto') + '-' + Utilities.getUuid().slice(0, 8) + '.' + extension;
  const file = mediaFolder_().createFile(name, bytes, mime);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.LIMITED);

  return {
    url: 'https://lh3.googleusercontent.com/d/' + file.getId() + '=w1600',
    fileId: file.getId(),
    bytes: bytes.length,
    mime: mime
  };
}

function safeUrl_(value) {
  const url = String(value || '').trim();
  if (url && !/^https:\/\//i.test(url)) {
    throw new Error('URL gambar harus menggunakan https://');
  }
  return url;
}

/* ---------------------------------------------------------------------------
 * Akun lembaga (PB/PW/PD/PK), kegiatan, formulir, peserta, surat.
 * Relasi memakai id + parentId yang datar supaya mudah dipindah ke Supabase.
 * ------------------------------------------------------------------------- */

function orgLookup_() {
  const verified = rows_(APP.SHEET_ORGS).filter(function (org) {
    return String(org.status) === 'verified';
  });
  return {
    provinces: PROVINCES,
    categories: LETTER_CATEGORIES,
    wps: verified.filter(function (org) { return org.jenjang === 'PW'; })
      .map(function (org) { return { id: org.id, province: org.province, name: org.name }; }),
    pds: verified.filter(function (org) { return org.jenjang === 'PD'; })
      .map(function (org) {
        return { id: org.id, province: org.province, district: org.district, name: org.name };
      })
  };
}

function orgRegister_(body) {
  const jenjang = String(body.jenjang || '').toUpperCase();
  if (['PW', 'PD', 'PK'].indexOf(jenjang) < 0) {
    throw new Error('Jenjang lembaga tidak valid.');
  }

  const province = canonicalProvince_(body.province);
  const district = cleanText_(body.district).slice(0, 120);
  const subdistrict = cleanText_(body.subdistrict).slice(0, 120);
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const phone = cleanText_(body.phone).slice(0, 40);
  const note = cleanText_(body.note).slice(0, 500);
  const skUrl = String(body.skUrl || '').trim();

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error('Alamat email lembaga tidak valid.');
  }
  if (password.length < 8) {
    throw new Error('Kata sandi minimal 8 karakter.');
  }
  if ((jenjang === 'PD' || jenjang === 'PK') && !district) {
    throw new Error('Nama kota/kabupaten wajib diisi.');
  }
  if (jenjang === 'PK' && !subdistrict) {
    throw new Error('Nama kecamatan wajib diisi.');
  }
  if (skUrl && !/^https:\/\//i.test(skUrl)) {
    throw new Error('Tautan SK harus diawali https://');
  }

  const orgs = rows_(APP.SHEET_ORGS);
  if (orgs.some(function (org) { return String(org.email).toLowerCase() === email; })) {
    throw new Error('Email tersebut sudah dipakai akun lembaga lain.');
  }

  const parent = resolveParentOrg_(orgs, jenjang, province, district);
  const name = [
    APP.PB_ORG_NAME.replace('Pengurus Besar PII', JENJANG_LABEL[jenjang] + ' PII'),
    jenjang === 'PW' ? province : jenjang === 'PD' ? district : subdistrict
  ].join(' ');

  const duplicate = orgs.some(function (org) {
    if (org.jenjang !== jenjang) return false;
    if (normText_(org.province) !== normText_(province)) return false;
    if (jenjang !== 'PW' && normText_(org.district) !== normText_(district)) return false;
    if (jenjang === 'PK' && normText_(org.subdistrict) !== normText_(subdistrict)) return false;
    return String(org.status) === 'pending' || String(org.status) === 'verified';
  });
  if (duplicate) {
    throw new Error('Lembaga dengan wilayah tersebut sudah terdaftar atau sedang menunggu verifikasi.');
  }

  const salt = Utilities.getUuid();
  const now = new Date().toISOString();
  const id = Utilities.getUuid();
  sheet_(APP.SHEET_ORGS).appendRow([
    id, jenjang, name, province, district, subdistrict, parent.id,
    email, hashPassword_(password, salt), salt, phone, skUrl, 'pending',
    '', '', now, now, '', note || ('Menunggu verifikasi ' + parent.name)
  ]);

  return { id: id, name: name, status: 'pending', parentName: parent.name };
}

function orgLogin_(body) {
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const org = orgById_(rows_(APP.SHEET_ORGS), null, email);

  if (!org || !org.passwordHash || !org.passwordSalt) {
    throw new Error('Email atau kata sandi salah.');
  }
  if (hashPassword_(password, org.passwordSalt) !== String(org.passwordHash)) {
    throw new Error('Email atau kata sandi salah.');
  }

  const token = sessionPut_('org', org.id);
  orgSetCell_(APP.SHEET_ORGS, org.id, 'lastLoginAt', new Date().toISOString());

  return { token: token, org: orgSelf_(org), expiresIn: APP.TOKEN_TTL_SECONDS };
}

function requireOrg_(token) {
  const id = sessionSubject_(token, 'org');
  if (!id) {
    throw new Error('Sesi berakhir atau token tidak valid. Silakan login kembali.');
  }
  const org = orgById_(rows_(APP.SHEET_ORGS), id);
  if (!org) {
    throw new Error('Akun lembaga tidak ditemukan.');
  }
  return org;
}

function orgAction_(action, body, org) {
  switch (action) {
    case 'orgData':
      return orgData_(org);
    case 'orgProfile':
      return orgProfile_(org, body);
    case 'orgSaveActivity':
      return orgSaveActivity_(org, body.activity || {});
    case 'orgDeleteActivity':
      return orgDeleteActivity_(org, body.id);
    case 'orgSaveForm':
      return orgSaveForm_(org, body.form || {});
    case 'orgSetFormStatus':
      return orgSetFormStatus_(org, body.id, body.status);
    case 'orgParticipants':
      return orgParticipants_(org, body.formId);
    case 'orgDeleteParticipant':
      return orgDeleteParticipant_(org, body.id);
    case 'orgSendLetter':
      return orgSendLetter_(org, body);
    case 'orgMarkLetter':
      return orgMarkLetter_(org, body.id, body.status);
    case 'orgVerify':
      return orgVerify_(org, body);
    case 'orgLogout':
      if (body.token) CacheService.getScriptCache().remove('orgauth:' + String(body.token));
      return { loggedOut: true };
    default:
      throw new Error('Aksi lembaga tidak dikenal.');
  }
}

function orgData_(org) {
  const me = orgById_(rows_(APP.SHEET_ORGS), org.id);
  if (!me) {
    throw new Error('Akun lembaga tidak ditemukan.');
  }

  const orgs = rows_(APP.SHEET_ORGS);
  const activities = rows_(APP.SHEET_ACTIVITIES);
  const forms = rows_(APP.SHEET_FORMS);
  const participants = rows_(APP.SHEET_PARTICIPANTS);
  const letters = rows_(APP.SHEET_LETTERS);
  const orgName = {};
  orgs.forEach(function (item) { orgName[item.id] = item.name; });
  const byId = {};
  orgs.forEach(function (item) { byId[item.id] = item; });

  const participantCount = {};
  participants.forEach(function (row) {
    participantCount[row.formId] = (participantCount[row.formId] || 0) + 1;
  });

  const scopeIds = descendantsOf_(orgs, me.id);
  const statFor = buildStats_(activities, forms);
  const network = scopeIds.map(function (id) {
    const item = byId[id];
    if (!item) return null;
    return Object.assign(slimOrg_(item), {
      parentName: orgName[item.parentId] || '',
      kpi: statFor(id),
      canVerify: me.jenjang === 'PB' || item.parentId === me.id
    });
  }).filter(Boolean).sort(function (a, b) {
    const order = { PW: 0, PD: 1, PK: 2 };
    return (order[a.jenjang] || 9) - (order[b.jenjang] || 9) || a.name.localeCompare(b.name);
  });

  const ancestors = ancestorsOf_(orgs, me.id).map(function (id) {
    return byId[id] ? slimOrg_(byId[id]) : null;
  }).filter(Boolean);

  const contacts = ancestors.concat(network.filter(function (item) {
    return item.status === 'verified';
  }));

  const ownActivities = activities.filter(function (item) {
    return item.orgId === me.id;
  }).sort(byDateDesc_).slice(0, 200);

  const formsAll = forms.filter(function (item) {
    return item.orgId === me.id || scopeIds.indexOf(item.orgId) >= 0;
  }).map(function (item) {
    return Object.assign({}, item, {
      orgName: orgName[item.orgId] || '',
      mine: item.orgId === me.id,
      participantCount: participantCount[item.id] || 0
    });
  }).sort(byDateDesc_).slice(0, 300);

  const activitiesAll = activities.filter(function (item) {
    return item.orgId === me.id || scopeIds.indexOf(item.orgId) >= 0;
  }).sort(byDateDesc_);

  const networkActivities = activitiesAll.filter(function (item) {
    return item.orgId !== me.id && String(item.status) === 'published';
  }).slice(0, 120).map(function (item) {
    return Object.assign({}, item, {
      orgName: orgName[item.orgId] || '',
      orgJenjang: byId[item.orgId] ? byId[item.orgId].jenjang : ''
    });
  });

  const inbox = letters.filter(function (item) {
    return item.toOrgId === me.id;
  }).sort(byDateDesc_).slice(0, 150).map(function (item) {
    return Object.assign({}, item, {
      fromName: orgName[item.fromOrgId] || '',
      toName: orgName[item.toOrgId] || ''
    });
  });

  const outbox = letters.filter(function (item) {
    return item.fromOrgId === me.id;
  }).sort(byDateDesc_).slice(0, 150).map(function (item) {
    return Object.assign({}, item, {
      fromName: orgName[item.fromOrgId] || '',
      toName: orgName[item.toOrgId] || ''
    });
  });

  const self = orgSelf_(me);
  self.parentName = orgName[me.parentId] || '';

  return {
    org: self,
    jenjangLabel: JENJANG_LABEL[me.jenjang] || me.jenjang,
    categories: LETTER_CATEGORIES,
    kpi: statFor(me.id),
    stats: {
      activities: activities.filter(function (item) { return item.orgId === me.id; }).length,
      published: activities.filter(function (item) {
        return item.orgId === me.id && String(item.status) === 'published';
      }).length,
      forms: forms.filter(function (item) { return item.orgId === me.id; }).length,
      participants: participants.filter(function (item) {
        return item.orgId === me.id || scopeIds.indexOf(item.orgId) >= 0;
      }).length,
      unread: inbox.filter(function (item) { return String(item.status) === 'unread'; }).length,
      networkSize: network.length
    },
    activities: ownActivities,
    networkActivities: networkActivities,
    forms: formsAll,
    letters: { inbox: inbox, outbox: outbox },
    network: network,
    ancestors: ancestors,
    contacts: contacts
  };
}

function orgProfile_(org, body) {
  const phone = cleanText_(body.phone).slice(0, 40);
  const skUrl = String(body.skUrl || '').trim();
  if (skUrl && !/^https:\/\//i.test(skUrl)) {
    throw new Error('Tautan SK harus diawali https://');
  }
  orgSetCell_(APP.SHEET_ORGS, org.id, 'phone', phone);
  orgSetCell_(APP.SHEET_ORGS, org.id, 'skUrl', skUrl);
  orgSetCell_(APP.SHEET_ORGS, org.id, 'updatedAt', new Date().toISOString());
  return orgSelf_(orgById_(rows_(APP.SHEET_ORGS), org.id));
}

function orgSaveActivity_(org, activity) {
  assertVerified_(org);
  const title = cleanText_(activity.title).slice(0, 180);
  const date = String(activity.date || '').trim();
  if (!title) throw new Error('Judul kegiatan wajib diisi.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Tanggal kegiatan harus format YYYY-MM-DD.');

  const participants = Number(activity.participants);
  const status = String(activity.status || 'published').toLowerCase();
  const cover = String(activity.coverImage || '').trim();
  if (['draft', 'published'].indexOf(status) < 0) throw new Error('Status kegiatan tidak valid.');
  if (cover && !/^https:\/\//i.test(cover)) throw new Error('URL gambar harus diawali https://');

  const sheet = sheet_(APP.SHEET_ACTIVITIES);
  const id = String(activity.id || Utilities.getUuid());
  const existing = findRow_(APP.SHEET_ACTIVITIES, id);
  if (existing && existing.orgId !== org.id) throw new Error('Kegiatan ini bukan milik lembaga Anda.');

  const now = new Date().toISOString();
  const row = [
    id, org.id, title, cleanText_(activity.category).slice(0, 60) || 'Kegiatan',
    date, cleanText_(activity.location).slice(0, 160),
    String(activity.description || '').slice(0, 8000),
    Number.isFinite(participants) ? Math.max(0, Math.round(participants)) : 0,
    cover, status, existing ? existing.createdAt : now, now
  ];

  if (existing) {
    sheet.getRange(existing._row, 1, 1, row.length).setValues([row]);
  } else {
    sheet.appendRow(row);
  }
  return { id: id, status: status };
}

function orgDeleteActivity_(org, id) {
  assertVerified_(org);
  const existing = findRow_(APP.SHEET_ACTIVITIES, id);
  if (!existing) throw new Error('Kegiatan tidak ditemukan.');
  if (existing.orgId !== org.id) throw new Error('Kegiatan ini bukan milik lembaga Anda.');
  sheet_(APP.SHEET_ACTIVITIES).deleteRow(existing._row);
  return { deleted: true, id: String(id) };
}

function orgSaveForm_(org, form) {
  assertVerified_(org);
  const title = cleanText_(form.title).slice(0, 180);
  if (!title) throw new Error('Judul formulir wajib diisi.');
  const activityId = String(form.activityId || '').trim();
  if (activityId) {
    const activity = findRow_(APP.SHEET_ACTIVITIES, activityId);
    if (!activity || activity.orgId !== org.id) throw new Error('Kegiatan terkait tidak ditemukan.');
  }
  const status = String(form.status || 'open').toLowerCase();
  if (['open', 'closed'].indexOf(status) < 0) throw new Error('Status formulir tidak valid.');

  const sheet = sheet_(APP.SHEET_FORMS);
  const id = String(form.id || Utilities.getUuid());
  const existing = findRow_(APP.SHEET_FORMS, id);
  if (existing && existing.orgId !== org.id) throw new Error('Formulir ini bukan milik lembaga Anda.');

  const now = new Date().toISOString();
  const row = [
    id, org.id, activityId, title, String(form.description || '').slice(0, 4000),
    status, existing ? existing.createdAt : now, now
  ];
  if (existing) {
    sheet.getRange(existing._row, 1, 1, row.length).setValues([row]);
  } else {
    sheet.appendRow(row);
  }
  return { id: id, status: status };
}

function orgSetFormStatus_(org, id, status) {
  assertVerified_(org);
  const value = String(status || '').toLowerCase();
  if (['open', 'closed'].indexOf(value) < 0) throw new Error('Status formulir tidak valid.');
  const existing = findRow_(APP.SHEET_FORMS, id);
  if (!existing) throw new Error('Formulir tidak ditemukan.');
  if (existing.orgId !== org.id) throw new Error('Formulir ini bukan milik lembaga Anda.');
  orgSetCell_(APP.SHEET_FORMS, existing.id, 'status', value);
  orgSetCell_(APP.SHEET_FORMS, existing.id, 'updatedAt', new Date().toISOString());
  return { id: existing.id, status: value };
}

function orgParticipants_(org, formId) {
  const form = findRow_(APP.SHEET_FORMS, formId);
  if (!form) throw new Error('Formulir tidak ditemukan.');
  const orgs = rows_(APP.SHEET_ORGS);
  const scopeIds = descendantsOf_(orgs, org.id);
  if (form.orgId !== org.id && scopeIds.indexOf(form.orgId) < 0) {
    throw new Error('Formulir ini berada di luar jejaring Anda.');
  }
  const participants = rows_(APP.SHEET_PARTICIPANTS)
    .filter(function (row) { return row.formId === form.id; })
    .sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
  return { form: form, participants: participants, canDelete: form.orgId === org.id };
}

function orgDeleteParticipant_(org, id) {
  assertVerified_(org);
  const existing = findRow_(APP.SHEET_PARTICIPANTS, id);
  if (!existing) throw new Error('Peserta tidak ditemukan.');
  const form = findRow_(APP.SHEET_FORMS, existing.formId);
  if (!form || form.orgId !== org.id) throw new Error('Peserta ini bukan milik formulir lembaga Anda.');
  sheet_(APP.SHEET_PARTICIPANTS).deleteRow(existing._row);
  return { deleted: true, id: String(id) };
}

function orgSendLetter_(org, body) {
  assertVerified_(org);
  const toOrgId = String(body.toOrgId || '').trim();
  const category = String(body.category || '').trim();
  const subject = cleanText_(body.subject).slice(0, 180);
  const content = String(body.body || '').trim().slice(0, 8000);

  if (LETTER_CATEGORIES.indexOf(category) < 0) throw new Error('Kategori surat tidak valid.');
  if (!subject || !content) throw new Error('Subjek dan isi surat wajib diisi.');

  const orgs = rows_(APP.SHEET_ORGS);
  const target = orgById_(orgs, toOrgId);
  if (!target || String(target.status) !== 'verified') {
    throw new Error('Lembaga tujuan belum terverifikasi.');
  }
  if (target.id === org.id) throw new Error('Tidak dapat mengirim surat ke lembaga sendiri.');

  const scopeIds = descendantsOf_(orgs, org.id);
  const ancestorIds = ancestorsOf_(orgs, org.id);
  const allowed = org.jenjang === 'PB' || target.jenjang === 'PB'
    || scopeIds.indexOf(target.id) >= 0 || ancestorIds.indexOf(target.id) >= 0;
  if (!allowed) throw new Error('Surat hanya dapat dikirim ke atasan atau bawahan dalam jejaring Anda.');

  const id = Utilities.getUuid();
  sheet_(APP.SHEET_LETTERS).appendRow([
    id, org.id, target.id, category, subject, content, 'unread', new Date().toISOString(), ''
  ]);
  return { id: id };
}

function orgMarkLetter_(org, id, status) {
  const value = String(status || '').toLowerCase();
  if (['read', 'done', 'unread'].indexOf(value) < 0) throw new Error('Status surat tidak valid.');
  const existing = findRow_(APP.SHEET_LETTERS, id);
  if (!existing) throw new Error('Surat tidak ditemukan.');
  if (existing.toOrgId !== org.id && existing.fromOrgId !== org.id) {
    throw new Error('Surat ini bukan milik lembaga Anda.');
  }
  orgSetCell_(APP.SHEET_LETTERS, existing.id, 'status', value);
  orgSetCell_(APP.SHEET_LETTERS, existing.id, 'readAt', value === 'unread' ? '' : new Date().toISOString());
  return { id: existing.id, status: value };
}

function orgVerify_(org, body) {
  assertVerified_(org);
  const target = orgById_(rows_(APP.SHEET_ORGS), String(body.id || ''));
  if (!target) throw new Error('Lembaga tidak ditemukan.');
  if (target.jenjang === 'PB') throw new Error('Akun induk PB tidak dapat diubah dari sini.');
  if (org.jenjang !== 'PB' && target.parentId !== org.id) {
    throw new Error('Hanya atasan langsung atau PB yang dapat memverifikasi lembaga ini.');
  }
  return orgSetStatus_(target.id, body.decision, org.name, body.note);
}

function orgSetStatus_(id, decision, actorLabel, note) {
  const value = String(decision || '').toLowerCase();
  if (['verified', 'rejected', 'pending'].indexOf(value) < 0) {
    throw new Error('Keputusan verifikasi tidak valid.');
  }
  const target = findRow_(APP.SHEET_ORGS, String(id || ''));
  if (!target) throw new Error('Lembaga tidak ditemukan.');
  if (target.id === APP.PB_ORG_ID && value !== 'verified') {
    throw new Error('Akun induk PB harus tetap aktif.');
  }

  const now = new Date().toISOString();
  const sheet = sheet_(APP.SHEET_ORGS);
  setCells_(sheet, target._row, {
    status: value,
    verifiedBy: value === 'pending' ? '' : String(actorLabel || ''),
    verifiedAt: value === 'pending' ? '' : now,
    updatedAt: now,
    note: cleanText_(note).slice(0, 500)
  });
  return slimOrg_(orgById_(rows_(APP.SHEET_ORGS), target.id));
}

function adminOrgs_() {
  const orgs = rows_(APP.SHEET_ORGS);
  const statFor = buildStats_(rows_(APP.SHEET_ACTIVITIES), rows_(APP.SHEET_FORMS));
  const pb = orgById_(orgs, APP.PB_ORG_ID);
  const counts = { total: orgs.length, verified: 0, pending: 0, rejected: 0 };
  orgs.forEach(function (org) {
    const status = String(org.status);
    if (counts[status] != null) counts[status] += 1;
  });

  return {
    orgs: orgs.map(function (org) {
      return Object.assign(slimOrg_(org), {
        email: org.email || '',
        note: org.note || '',
        lastLoginAt: org.lastLoginAt || '',
        kpi: statFor(org.id)
      });
    }).sort(function (a, b) {
      const rank = { pending: 0, rejected: 1, verified: 2 };
      return (rank[a.status] || 3) - (rank[b.status] || 3) || a.jenjang.localeCompare(b.jenjang);
    }),
    pbAccount: pb ? { email: pb.email || '', hasPassword: Boolean(pb.passwordHash) } : null,
    counts: counts
  };
}

function adminSavePbAccount_(body) {
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Alamat email tidak valid.');
  if (password.length < 8) throw new Error('Kata sandi minimal 8 karakter.');
  const orgs = rows_(APP.SHEET_ORGS);
  const used = orgs.some(function (org) {
    return org.id !== APP.PB_ORG_ID && String(org.email).toLowerCase() === email;
  });
  if (used) throw new Error('Email tersebut sudah dipakai akun lembaga lain.');

  const pb = orgById_(orgs, APP.PB_ORG_ID);
  if (!pb) throw new Error('Akun induk PB belum ada. Jalankan setup() terlebih dahulu.');
  const salt = Utilities.getUuid();
  orgSetCell_(APP.SHEET_ORGS, pb.id, 'email', email);
  orgSetCell_(APP.SHEET_ORGS, pb.id, 'passwordHash', hashPassword_(password, salt));
  orgSetCell_(APP.SHEET_ORGS, pb.id, 'passwordSalt', salt);
  orgSetCell_(APP.SHEET_ORGS, pb.id, 'status', 'verified');
  orgSetCell_(APP.SHEET_ORGS, pb.id, 'updatedAt', new Date().toISOString());
  return { email: email, status: 'verified' };
}

function publicForm_(id) {
  const form = findRow_(APP.SHEET_FORMS, id);
  if (!form) throw new Error('Formulir tidak ditemukan.');
  const org = orgById_(rows_(APP.SHEET_ORGS), form.orgId);
  const activity = form.activityId ? findRow_(APP.SHEET_ACTIVITIES, form.activityId) : null;
  return {
    id: form.id,
    title: form.title,
    description: form.description,
    status: form.status,
    activityTitle: activity ? activity.title : '',
    org: org ? {
      name: org.name, jenjang: org.jenjang, province: org.province,
      district: org.district, subdistrict: org.subdistrict
    } : { name: 'PB PII', jenjang: 'PB', province: '', district: '', subdistrict: '' },
    registered: rows_(APP.SHEET_PARTICIPANTS).filter(function (row) {
      return row.formId === form.id;
    }).length
  };
}

function publicRegister_(body) {
  const form = findRow_(APP.SHEET_FORMS, String(body.formId || ''));
  if (!form) throw new Error('Formulir tidak ditemukan.');
  if (String(form.status) !== 'open') throw new Error('Formulir sudah ditutup.');

  const name = cleanText_(body.name).slice(0, 120);
  const institution = cleanText_(body.institution).slice(0, 160);
  const phone = cleanText_(body.phone).slice(0, 40);
  const email = String(body.email || '').trim().toLowerCase().slice(0, 160);
  const note = cleanText_(body.note).slice(0, 1000);

  if (!name) throw new Error('Nama peserta wajib diisi.');
  if (!phone && !email) throw new Error('Isi nomor WhatsApp atau email agar panitia dapat menghubungi.');
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Alamat email tidak valid.');

  const participants = rows_(APP.SHEET_PARTICIPANTS);
  const duplicate = participants.some(function (row) {
    return row.formId === form.id && normText_(row.name) === normText_(name)
      && (phone ? normText_(row.phone) === normText_(phone) : true);
  });
  if (duplicate) throw new Error('Pendaftaran dengan nama dan nomor yang sama sudah tercatat.');

  const id = Utilities.getUuid();
  sheet_(APP.SHEET_PARTICIPANTS).appendRow([
    id, form.id, form.orgId, name, institution, phone, email, note, new Date().toISOString()
  ]);
  return { id: id, status: 'registered' };
}

/* --------------------------------------------------------------- helpers -- */

function orgById_(orgs, id, email) {
  const wanted = String(id || '').toLowerCase();
  const mail = email ? String(email).toLowerCase() : '';
  for (let i = 0; i < orgs.length; i++) {
    const org = orgs[i];
    if (wanted && String(org.id).toLowerCase() === wanted) return org;
    if (mail && String(org.email || '').toLowerCase() === mail) return org;
  }
  return null;
}

function orgSelf_(org) {
  const slim = slimOrg_(org);
  slim.email = org.email || '';
  slim.note = org.note || '';
  slim.lastLoginAt = org.lastLoginAt || '';
  return slim;
}

function slimOrg_(org) {
  return {
    id: org.id,
    jenjang: org.jenjang,
    name: org.name,
    province: org.province || '',
    district: org.district || '',
    subdistrict: org.subdistrict || '',
    parentId: org.parentId || '',
    status: org.status || '',
    phone: org.phone || '',
    skUrl: org.skUrl || '',
    createdAt: org.createdAt || '',
    verifiedAt: org.verifiedAt || '',
    verifiedBy: org.verifiedBy || ''
  };
}

function resolveParentOrg_(orgs, jenjang, province, district) {
  if (jenjang === 'PW') {
    const pb = orgById_(orgs, APP.PB_ORG_ID);
    if (!pb || String(pb.status) !== 'verified') {
      throw new Error('Akun induk PB belum siap. Hubungi administrator website.');
    }
    return pb;
  }

  const parentJenjang = jenjang === 'PD' ? 'PW' : 'PD';
  const parent = orgs.filter(function (org) {
    if (org.jenjang !== parentJenjang || String(org.status) !== 'verified') return false;
    if (normText_(org.province) !== normText_(province)) return false;
    if (parentJenjang === 'PD' && normText_(org.district) !== normText_(district)) return false;
    return true;
  })[0];

  if (!parent) {
    throw new Error(parentJenjang === 'PW'
      ? 'PW ' + province + ' belum terverifikasi. Minta PW provinsi mendaftar dan diverifikasi PB lebih dahulu.'
      : 'PD ' + district + ' belum terverifikasi. Pastikan PD kota/kabupaten tersebut sudah terdaftar.');
  }
  return parent;
}

function descendantsOf_(orgs, id) {
  const children = {};
  orgs.forEach(function (org) {
    if (!children[org.parentId]) children[org.parentId] = [];
    children[org.parentId].push(org.id);
  });
  const result = [];
  const queue = (children[id] || []).slice();
  while (queue.length) {
    const next = queue.shift();
    if (result.indexOf(next) >= 0) continue;
    result.push(next);
    (children[next] || []).forEach(function (child) { queue.push(child); });
  }
  return result;
}

function ancestorsOf_(orgs, id) {
  const byId = {};
  orgs.forEach(function (org) { byId[org.id] = org; });
  const result = [];
  let current = byId[id];
  let guard = 0;
  while (current && current.parentId && guard < 20) {
    result.push(current.parentId);
    current = byId[current.parentId];
    guard += 1;
  }
  return result;
}

function assertVerified_(org) {
  if (String(org.status) !== 'verified') {
    throw new Error('Akun lembaga belum diverifikasi. Tunggu persetujuan atasan atau hubungi PB PII.');
  }
}

function buildStats_(activities, forms) {
  const now = Date.now();
  const d30 = now - 30 * 86400000;
  const d90 = now - 90 * 86400000;
  const index = {};

  function bucket(id) {
    if (!index[id]) {
      index[id] = { activities30: 0, activities90: 0, participants90: 0, forms90: 0 };
    }
    return index[id];
  }

  activities.forEach(function (activity) {
    if (String(activity.status) !== 'published') return;
    const time = Date.parse(activity.date || activity.createdAt);
    if (!isFinite(time)) return;
    const item = bucket(activity.orgId);
    if (time >= d30) item.activities30 += 1;
    if (time >= d90) {
      item.activities90 += 1;
      item.participants90 += Number(activity.participants) || 0;
    }
  });

  forms.forEach(function (form) {
    const time = Date.parse(form.createdAt);
    if (!isFinite(time) || time < d90) return;
    bucket(form.orgId).forms90 += 1;
  });

  return function (id) {
    const item = index[id] || { activities30: 0, activities90: 0, participants90: 0, forms90: 0 };
    const score = Math.round(100 * (
      0.5 * Math.min(1, item.activities30 / 4)
      + 0.3 * Math.min(1, item.participants90 / 100)
      + 0.2 * Math.min(1, item.forms90 / 2)
    ));
    return {
      activities30: item.activities30,
      activities90: item.activities90,
      participants90: item.participants90,
      forms90: item.forms90,
      score: score,
      label: score >= 75 ? 'Sangat Aktif' : score >= 50 ? 'Aktif' : score >= 25 ? 'Cukup' : 'Perlu Pembinaan'
    };
  };
}

function hashPassword_(password, salt) {
  let value = String(salt) + ':' + String(password);
  for (let i = 0; i < 250; i++) {
    value = bytesToHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value));
  }
  return value;
}

function bytesToHex_(bytes) {
  return bytes.map(function (byte) {
    const value = byte < 0 ? byte + 256 : byte;
    return (value < 16 ? '0' : '') + value.toString(16);
  }).join('');
}

function orgSetCell_(sheetNameOrId, id, header, value) {
  const sheet = sheet_(sheetNameOrId);
  const values = sheet.getDataRange().getValues();
  if (!values.length) return;
  const headers = values[0].map(String);
  const idColumn = headers.indexOf('id');
  if (idColumn < 0) return;
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][idColumn]) === String(id)) {
      const updates = {};
      updates[header] = value;
      setCells_(sheet, i + 1, updates);
      return;
    }
  }
}

/** Tulis beberapa kolom sekaligus, dicari lewat nama header bukan nomor kolom. */
function setCells_(sheet, rowNumber, valuesByHeader) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0]
    .map(function (value) { return String(value).trim(); });
  Object.keys(valuesByHeader).forEach(function (name) {
    const column = headers.indexOf(name) + 1;
    if (column > 0) {
      sheet.getRange(rowNumber, column).setValue(valuesByHeader[name]);
    }
  });
}

function canonicalProvince_(value) {
  const wanted = normText_(value);
  const alias = PROVINCE_ALIASES[wanted];
  if (alias) return alias;
  for (let i = 0; i < PROVINCES.length; i++) {
    if (normText_(PROVINCES[i]) === wanted) return PROVINCES[i];
  }
  throw new Error('Provinsi tidak dikenali.');
}

function cleanText_(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function normText_(value) {
  return cleanText_(value).toUpperCase();
}

function byDateDesc_(a, b) {
  return String(b.date || b.updatedAt || b.createdAt || '')
    .localeCompare(String(a.date || a.updatedAt || a.createdAt || ''));
}

function json_(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
