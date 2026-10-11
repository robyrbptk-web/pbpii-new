/**
 * Backend CMS Website Pengurus Besar Pelajar Islam Indonesia.
 * Database: Google Sheets. API: Google Apps Script Web App.
 *
 * Cara pasang:
 * 1. Jalankan setup() dari spreadsheet yang terhubung.
 * 2. Tambahkan file HTML bernama AdminSetup dari AdminSetup.html.
 * 3. Atur password melalui menu spreadsheet PB PII > Atur akun admin.
 * 4. Deploy sebagai Web App, execute as Me, access Anyone.
 */
const APP = {
  SHEET_ARTICLES: 'Articles',
  SHEET_SETTINGS: 'Settings',
  SHEET_GALLERY: 'Gallery',
  TOKEN_TTL_SECONDS: 21600,
  PROP_SPREADSHEET_ID: 'SPREADSHEET_ID',
  PROP_ADMIN_USERNAME: 'ADMIN_USERNAME',
  PROP_ADMIN_PASSWORD: 'ADMIN_PASSWORD'
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

const DEFAULT_SETTINGS = [
  ['siteName', 'Pengurus Besar Pelajar Islam Indonesia'],
  ['tagline', 'Kepelajaran • Keislaman • Keindonesiaan'],
  ['heroTitle', 'Membentuk Pelajar, Menyiapkan Pemimpin Masa Depan'],
  ['heroText', 'Pelajar Islam Indonesia merupakan ruang pembinaan dan perjuangan pelajar untuk memperkuat keilmuan, akhlak, kepemimpinan, serta tanggung jawab kepada umat dan bangsa.'],
  ['chairmanName', 'Nama Ketua Umum PB PII'],
  ['chairmanRole', 'Ketua Umum Pengurus Besar Pelajar Islam Indonesia'],
  ['chairmanPhoto', ''],
  ['chairmanGreeting', 'Assalamu’alaikum warahmatullahi wabarakatuh.\n\nPelajar memiliki peran penting dalam merawat masa depan umat dan bangsa. Karena itu, pendidikan tidak cukup dimaknai sebagai proses memperoleh pengetahuan, tetapi juga sebagai ikhtiar membentuk akhlak, keluasan wawasan, kemandirian berpikir, dan keberanian untuk bertanggung jawab.\n\nPelajar Islam Indonesia berupaya menghadirkan ruang pembinaan yang mempertemukan nilai-nilai keislaman, tradisi keilmuan, dan semangat kebangsaan. Di tengah perubahan zaman, kader PII dituntut terus belajar, terbuka terhadap perkembangan ilmu pengetahuan, serta mampu menjawab persoalan masyarakat dengan gagasan dan kerja nyata.\n\nSaya mengajak seluruh keluarga besar PII untuk menjaga semangat belajar, memperkuat persaudaraan, dan merawat pengabdian. Mari menjadikan organisasi ini sebagai ruang tumbuh bagi pelajar yang berintegritas, berilmu, dan siap berkontribusi bagi Indonesia.\n\nWassalamu’alaikum warahmatullahi wabarakatuh.'],
  ['chairmanGreetingVisible', 'true'],
  ['aboutText', 'Pelajar Islam Indonesia (PII) berdiri di Yogyakarta pada 4 Mei 1947. PII bergerak dalam bidang pendidikan dan kebudayaan dengan ikhtiar mewujudkan pendidikan dan kebudayaan yang sesuai dengan nilai-nilai Islam bagi masyarakat Indonesia dan umat manusia.'],
  ['footerText', 'Pengurus Besar Pelajar Islam Indonesia'],
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
 * Buat sheet yang dibutuhkan tanpa menghapus data yang sudah ada.
 * Jalankan dari Apps Script yang terikat ke spreadsheet website.
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

  ensureSheet_(spreadsheet, APP.SHEET_ARTICLES, ARTICLE_HEADERS);
  ensureSheet_(spreadsheet, APP.SHEET_SETTINGS, SETTINGS_HEADERS);
  ensureSheet_(spreadsheet, APP.SHEET_GALLERY, GALLERY_HEADERS);
  ensureDefaultSettings_(spreadsheet.getSheetByName(APP.SHEET_SETTINGS));

  properties.setProperty(APP.PROP_SPREADSHEET_ID, spreadsheet.getId());
  properties.setProperty(APP.PROP_ADMIN_USERNAME, 'admin');

  return 'Setup selesai. Username admin adalah admin. Pilih menu PB PII > Atur akun admin untuk menyimpan password.';
}

/**
 * Tambahkan menu pengaturan akun pada spreadsheet saat dibuka.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('PB PII')
    .addItem('Atur akun admin', 'configureAdmin')
    .addToUi();
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
  properties.setProperty(APP.PROP_ADMIN_PASSWORD, value);
  return 'Akun admin siap digunakan. Username: admin.';
}

function doGet() {
  return json_({
    ok: true,
    service: 'PB PII CMS API',
    message: 'API aktif. Gunakan POST melalui proxy Vercel.'
  });
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

    if (action === 'public') {
      data = publicData_();
    } else if (action === 'login') {
      data = login_(body);
    } else if (action === 'logout') {
      data = logout_(body.token);
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
    case 'deleteGalleryItem':
      return deleteRowById_(APP.SHEET_GALLERY, body.id);
    default:
      throw new Error('Aksi tidak dikenal.');
  }
}

function login_(body) {
  const properties = PropertiesService.getScriptProperties();
  const username = String(
    properties.getProperty(APP.PROP_ADMIN_USERNAME) || ''
  ).trim();
  const password = properties.getProperty(APP.PROP_ADMIN_PASSWORD);

  if (!username || !password) {
    throw new Error('Admin belum dikonfigurasi. Pilih menu PB PII > Atur akun admin pada spreadsheet.');
  }
  if (
    String(body.username || '').trim().toLowerCase() !== username.toLowerCase() ||
    String(body.password || '') !== password
  ) {
    throw new Error('Username atau kata sandi salah.');
  }

  const token = Utilities.getUuid() + '-' + Utilities.getUuid();
  CacheService.getScriptCache().put(
    'auth:' + token,
    username,
    APP.TOKEN_TTL_SECONDS
  );

  return {
    token: token,
    username: username,
    expiresIn: APP.TOKEN_TTL_SECONDS
  };
}

function requireAuth_(token) {
  if (!token || !CacheService.getScriptCache().get('auth:' + String(token))) {
    throw new Error('Sesi berakhir atau token tidak valid. Silakan login kembali.');
  }
}

function logout_(token) {
  if (token) {
    CacheService.getScriptCache().remove('auth:' + String(token));
  }
  return { loggedOut: true };
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
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  }

  return sheet;
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

function safeUrl_(value) {
  const url = String(value || '').trim();
  if (url && !/^https:\/\//i.test(url)) {
    throw new Error('URL gambar harus menggunakan https://');
  }
  return url;
}

function json_(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
