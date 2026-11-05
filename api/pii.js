/**
 * Vercel serverless proxy: keeps the Apps Script URL out of browser code and
 * avoids browser CORS issues.
 *
 * Layer 1 of anti-spam. The function restarts cold on every deploy and runs on
 * any region, so this window is per instance and best-effort; Apps Script
 * keeps the durable counters in CacheService and the daily quotas in Sheets.
 * The proxy still does the things only it can do: cap request size, drop
 * abusive action/IP pairs fast, and forward the real client IP downstream.
 */
export const DEFAULT_GAS_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbxTlciByFgttDG8CuKkAUWr2j4na-jS-ENq7S3gjiclX1Uw3cSu7Rj0d8VMALt-qh-J_w/exec';

/** Reads are cheap; writes are where spam lives. `limit` requests per `windowMs`. */
const RULES = {
  read: { limit: 240, windowMs: 60_000 },
  captcha: { limit: 30, windowMs: 600_000 },
  login: { limit: 10, windowMs: 600_000 },
  // Posting has no daily count cap, so this budget is sized for a whole campus
  // sharing one exit IP — a burst should slow down, never look like a quota.
  write: { limit: 150, windowMs: 600_000 }
};

const READ_ACTIONS = new Set([
  'health', 'public', 'whoami', 'eventThread', 'orgLookup', 'publicForm', 'chatStatus',
  'pustakaList', 'pustakaCari', 'pustakaBaca', 'pustakaKonteks', 'pustakaStatus',
  'feedList', 'feedThread', 'kaderProfil', 'kaderJaringan', 'kaderCari', 'ceritaList'
]);

const WRITE_ACTIONS = new Set([
  'login', 'orgLogin', 'orgRegister', 'publicRegister', 'kaderLogin', 'kaderEmailLogin',
  'kaderRegister', 'eventLike', 'eventComment', 'uploadImage', 'orgUploadImage', 'orgUploadLetterImage',
  'feedUpload', 'feedPost', 'feedEdit', 'feedDelete', 'feedLike', 'feedComment', 'feedRepost', 'feedBookmark', 'feedFollow',
  'kaderProfilSimpan', 'ceritaHapus'
]);

/** Every password/OAuth entry point shares the strictest budget. */
const LOGIN_ACTIONS = new Set(['login', 'orgLogin', 'kaderLogin', 'kaderEmailLogin']);

/** Base64 media/PDF uploads are the only payloads allowed to be large. */
const MAX_BODY_BYTES = 220_000;
const MAX_UPLOAD_BYTES = 4_500_000;
const UPLOAD_ACTIONS = new Set(['uploadImage', 'orgUploadImage', 'orgUploadPdf', 'orgUploadLetterImage', 'feedUpload', 'kaderUnggah', 'ceritaUnggah']);
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_DRIVE_RESPONSE_BYTES = 16 * 1024 * 1024;

const hits = new Map();

function imageMime(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes.toString('ascii', 1, 4) === 'PNG') return 'image/png';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return '';
}

function restoreLegacyImage(bytes) {
  const text = bytes.toString('ascii').trim();
  const numberPattern = /-?\d{1,3}/g;
  const restored = Buffer.allocUnsafe(Math.min(text.length, MAX_IMAGE_BYTES));
  let count = 0;
  let previousEnd = 0;
  let match;
  while ((match = numberPattern.exec(text))) {
    const separator = text.slice(previousEnd, match.index);
    if (count === 0 ? match.index !== 0 : !/^,\s*$/.test(separator)) return null;
    if (count >= MAX_IMAGE_BYTES) throw new Error('Ukuran gambar Drive melebihi batas.');
    const value = Number(match[0]);
    if (!Number.isInteger(value) || value < -128 || value > 255) return null;
    restored[count] = value & 0xff;
    count += 1;
    previousEnd = numberPattern.lastIndex;
  }
  if (count < 3 || !/^\s*$/.test(text.slice(previousEnd))) return null;
  const image = restored.subarray(0, count);
  return imageMime(image) ? image : null;
}

async function readLimitedBody(response, limit) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Sumber gambar tidak mengirimkan data.');

  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new Error('Ukuran gambar Drive melebihi batas.');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, size);
}

async function serveDriveImage(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const id = String(req.query?.imageId || '');
  if (!/^[A-Za-z0-9_-]{10,128}$/.test(id)) {
    return res.status(400).json({ ok: false, error: 'ID gambar tidak valid.' });
  }
  const decision = allow('drive-image|' + clientIp(req), RULES.read);
  if (!decision.ok) {
    res.setHeader('Retry-After', String(decision.retryAfter));
    return res.status(429).json({ ok: false, error: 'Terlalu sering memuat gambar. Coba lagi sebentar.' });
  }

  try {
    const upstream = await fetch(
      'https://drive.usercontent.google.com/download?id=' + encodeURIComponent(id) + '&export=view&authuser=0',
      { redirect: 'follow', signal: AbortSignal.timeout(15_000) }
    );
    const finalHost = new URL(upstream.url).hostname;
    if (finalHost === 'accounts.google.com') {
      // Berkas yang baru saja dicabut izinnya (cerita kedaluwarsa atau kabar
      // dihapus) dialihkan Google ke halaman masuk, bukan 404.
      return res.status(404).json({ ok: false, error: 'Gambar sudah tidak tersedia.' });
    }
    if (finalHost !== 'drive.google.com'
      && finalHost !== 'drive.usercontent.google.com'
      && !finalHost.endsWith('.googleusercontent.com')) {
      throw new Error('Sumber gambar Drive mengarah ke host yang tidak diizinkan.');
    }
    if (!upstream.ok) {
      return res.status(upstream.status === 404 ? 404 : 502)
        .json({ ok: false, error: 'Gambar Drive tidak dapat diakses.' });
    }

    let bytes = await readLimitedBody(upstream, MAX_DRIVE_RESPONSE_BYTES);
    let mime = imageMime(bytes);
    if (!mime) {
      bytes = restoreLegacyImage(bytes);
      mime = bytes && imageMime(bytes);
    }
    if (!mime) {
      return res.status(502).json({ ok: false, error: 'Berkas Drive bukan gambar yang didukung.' });
    }
    if (bytes.length > MAX_IMAGE_BYTES) {
      return res.status(413).json({ ok: false, error: 'Ukuran gambar Drive melebihi batas.' });
    }

    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Length', String(bytes.length));
    res.setHeader('Content-Disposition', 'inline');
    // Isi berkas Drive bisa diperbaiki tanpa mengganti ID, jadi cache tepi sengaja
    // tidak seharian agar foto lama tampil begitu berkasnya dibetulkan.
    res.setHeader('Cache-Control', 'public, max-age=1800, s-maxage=21600, stale-while-revalidate=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.end(bytes);
  } catch (error) {
    const tooLarge = /melebihi batas/.test(String(error && error.message));
    return res.status(tooLarge ? 413 : 502)
      .json({ ok: false, error: error.message || 'Gagal memuat gambar Drive.' });
  }
}

/** Menormalkan tautan Drive lama sebelum UI mengarahkannya ke proxy gambar ini. */
const DEAD_DRIVE_URL =
  /https:\/\/(?:lh3\.googleusercontent\.com\/d\/|drive\.google\.com\/(?:file\/d\/|thumbnail\?id=|uc\?id=|open\?id=))([A-Za-z0-9_-]{10,})(?:\/view)?(?:[?=&][^\s"'<>\\]*)?/gi;

function rewriteDriveImages(value) {
  if (Array.isArray(value)) return value.map(rewriteDriveImages);
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) value[key] = rewriteDriveImages(child);
    return value;
  }
  if (typeof value !== 'string' || value.indexOf('google') === -1) return value;
  return value.replace(
    DEAD_DRIVE_URL,
    (raw, id) => 'https://drive.usercontent.google.com/download?id=' + id + '&export=view&authuser=0'
  );
}

function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  if (forwarded) return forwarded.slice(0, 64);
  return String(req.headers['x-real-ip'] || req.headers['x-vercel-forwarded-for'] || '').trim().slice(0, 64) || 'tanpa-ip';
}

function ruleFor(action) {
  if (action === 'captcha') return RULES.captcha;
  if (LOGIN_ACTIONS.has(action)) return RULES.login;
  if (READ_ACTIONS.has(action)) return RULES.read;
  if (WRITE_ACTIONS.has(action)) return RULES.write;
  // Aksi admin (org*, save*, delete*) lewat sesi login: tetap dibatasi, tapi longgar.
  return { limit: 90, windowMs: 600_000 };
}

/** Sliding window: buang stempel yang sudah keluar dari jendela, lalu hitung. */
function allow(key, rule) {
  const now = Date.now();
  let entry = hits.get(key);
  if (!entry || now - entry.startedAt > rule.windowMs * 2) {
    entry = { startedAt: now, recent: [] };
    hits.set(key, entry);
  }
  entry.recent = entry.recent.filter((time) => now - time < rule.windowMs);
  if (entry.recent.length >= rule.limit) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((rule.windowMs - (now - entry.recent[0])) / 1000)) };
  }
  entry.recent.push(now);
  if (hits.size > 8000) {
    for (const [storedKey, stored] of hits) {
      if (now - stored.startedAt > rule.windowMs * 2) hits.delete(storedKey);
    }
  }
  return { ok: true };
}

export default async function handler(req, res) {
  if (req.method === 'GET') return serveDriveImage(req, res);
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const action = String(body.action || '');
  const ip = clientIp(req);
  const rule = ruleFor(action);
  const decision = allow(`${action || 'kosong'}|${ip}`, rule);

  if (!decision.ok) {
    res.setHeader('Retry-After', String(decision.retryAfter));
    return res.status(429).json({
      ok: false,
      code: 'rate_limited',
      error: `Terlalu sering mengirim permintaan dari jaringan ini. Tunggu ${decision.retryAfter} detik lalu coba lagi.`,
      retryAfter: decision.retryAfter
    });
  }

  const declaredSize = Number(req.headers['content-length'] || 0);
  const isUpload = UPLOAD_ACTIONS.has(action);
  const maxSize = isUpload ? MAX_UPLOAD_BYTES : MAX_BODY_BYTES;
  if (declaredSize > maxSize) {
    return res.status(413).json({
      ok: false,
      error: isUpload
        ? action === 'orgUploadPdf'
          ? 'Lampiran PDF terlalu besar untuk diunggah (maksimal 2,5 MB).'
          : 'Berkas terlalu besar untuk diunggah (maksimal sekitar 3 MB).'
        : 'Permintaan terlalu besar untuk diproses.'
    });
  }

  const url = process.env.GAS_WEB_APP_URL || DEFAULT_GAS_WEB_APP_URL;
  try {
    const upstream = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      // Apps Script never sees the visitor's IP, so the durable limiter needs it here.
      body: JSON.stringify({ ...body, ip })
    });
    const raw = await upstream.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error('Respons Apps Script bukan JSON. Periksa URL deployment dan izin Web App.');
    }
    return res.status(200).json(rewriteDriveImages(data));
  } catch (e) {
    return res.status(502).json({ ok: false, error: e.message || 'Gagal menghubungi Apps Script.' });
  }
}
