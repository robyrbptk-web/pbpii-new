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
  write: { limit: 25, windowMs: 600_000 }
};

const READ_ACTIONS = new Set([
  'health', 'public', 'whoami', 'eventThread', 'orgLookup', 'publicForm', 'chatStatus'
]);

const WRITE_ACTIONS = new Set([
  'login', 'orgLogin', 'orgRegister', 'publicRegister', 'kaderLogin', 'eventLike',
  'eventComment', 'uploadImage', 'orgUploadImage'
]);

/** Every password/OAuth entry point shares the strictest budget. */
const LOGIN_ACTIONS = new Set(['login', 'orgLogin', 'kaderLogin']);

/** Base64 photo uploads are the only payload allowed to be big. */
const MAX_BODY_BYTES = 220_000;
const MAX_UPLOAD_BYTES = 4_500_000;
const UPLOAD_ACTIONS = new Set(['uploadImage', 'orgUploadImage']);

const hits = new Map();

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
        ? 'Foto terlalu besar untuk diunggah (maksimal sekitar 3 MB).'
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
    return res.status(200).json(data);
  } catch (e) {
    return res.status(502).json({ ok: false, error: e.message || 'Gagal menghubungi Apps Script.' });
  }
}
