/**
 * "Tanya PII" — gerbang AI di sisi server.
 *
 * Kenapa tidak diteruskan ke Apps Script saja: deployment yang sekarang aktif
 * masih versi lama, jadi aksi "chat" jatuh ke requireAuth_ dan balasan selalu
 * "Sesi berakhir". Fungsi ini memanggil layanan AI sendiri sehingga chat tetap
 * hidup. Kunci AI (kalau dipasang) hanya dibaca dari environment Vercel dan
 * tidak pernah keluar ke browser maupun ke repository; tanpa kunci apa pun
 * dipakai layanan gratis Pollinations.
 *
 * Pencatatan kuota di sheet "Chat" Apps Script tetap dicoba dan dipakai kalau
 * backend yang baru sudah terpasang; kalau belum, pembatas lunak di memori
 * fungsi ini yang berlaku.
 */
import { DEFAULT_GAS_WEB_APP_URL } from './pii.js';

const MAX_CHARS = 900;
const MAX_HISTORY = 8;
const DAILY_LIMIT = 20;
/** Pengunjung tanpa akun boleh mencoba, tapi jatahnya kecil dan per alamat IP. */
const GUEST_DAILY_LIMIT = 5;
const MINUTE_LIMIT = 4;

const POLLINATIONS_URL = 'https://text.pollinations.ai/openai';

/** Pembatas lunak: per instances Vercel, jadi ini pagar darurat, bukan audit. */
const usage = new Map();

function usageFor(device) {
  const day = new Date().toISOString().slice(0, 10);
  const key = `${device}|${day}`;
  const now = Date.now();
  let entry = usage.get(key);
  if (!entry || now - entry.startedAt > 24 * 60 * 60 * 1000) {
    entry = { count: 0, startedAt: now, recent: [] };
    usage.set(key, entry);
  }
  if (usage.size > 5000) {
    for (const [storedKey, stored] of usage) {
      if (now - stored.startedAt > 24 * 60 * 60 * 1000) usage.delete(storedKey);
    }
  }
  entry.recent = entry.recent.filter((time) => now - time < 60 * 1000);
  return entry;
}

function systemPrompt() {
  return [
    'Kamu adalah asisten "Tanya PII" di website resmi PB PII.',
    'Organisasi ini adalah Pengurus Besar Pelajar Islam Indonesia (PII), bukan istilah',
    'Personally Identifiable Information.',
    'Slogan: #PIILevelUp. Ketua Umum PB PII: Kevin Prayoga, S.H. (Periode 2026-2028).',
    'PII berdiri di Yogyakarta pada 4 Mei 1947 sebagai organisasi pelajar tertua di Indonesia,',
    'bergerak di bidang pendidikan dan kebudayaan; struktur kepengurusannya PB, PW (wilayah),',
    'PD (daerah), dan PK (komisariat). Sekretariat Nasional di Jl. Menteng Raya No. 58, Jakarta Pusat.',
    'Jawab dalam bahasa Indonesia, ringkas, maksimal 160 kata, tanpa format markdown berat.',
    'Jangan mengarang nama orang, tanggal, angka, atau keputusan resmi. Bila tidak yakin,',
    'katakan tidak tahu dan arahkan penanya mengonfirmasi lewat pengurus atau dashboard website.',
    'Hindari politik praktis dan hindari memberi fatwa; arahkan pertanyaan agama kepada ustadz',
    'atau pengurus.',
  ].join(' ');
}

function clean(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function readBody(req) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  if (typeof req.body === 'string') {
    try { return Promise.resolve(JSON.parse(req.body || '{}')); } catch { return Promise.resolve({}); }
  }
  return new Promise((resolve) => {
    let raw = '';
    req.on?.('data', (chunk) => { raw += chunk; if (raw.length > 64 * 1024) req.destroy?.(); });
    req.on?.('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); } });
    req.on?.('error', () => resolve({}));
  });
}

function reply(res, status, payload) {
  if (res.headersSent) return;
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

/** Susun daftar kandidat penyedia dari environment; tanpa kunci = Pollinations saja. */
function providers() {
  const list = [];
  const add = (label, url, key, model) => {
    if (url && key) list.push({ label, url, key, model });
  };

  const genericKey = clean(process.env.AI_API_KEY);
  const genericUrl = clean(process.env.AI_CHAT_URL);
  add('AI_CHAT_URL', genericUrl, genericKey, clean(process.env.AI_MODEL) || 'gpt-4o-mini');

  const gemini = clean(process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY);
  add('Gemini', gemini ? 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions' : '',
    gemini, clean(process.env.AI_MODEL) || 'gemini-2.0-flash');

  const groq = clean(process.env.GROQ_API_KEY);
  add('Groq', groq ? 'https://api.groq.com/openai/v1/chat/completions' : '',
    groq, clean(process.env.AI_MODEL) || 'llama-3.3-70b-versatile');

  const openai = clean(process.env.OPENAI_API_KEY);
  add('OpenAI', openai ? 'https://api.openai.com/v1/chat/completions' : '',
    openai, clean(process.env.AI_MODEL) || 'gpt-4o-mini');

  return list;
}

async function callProvider(provider, messages) {
  const response = await fetch(provider.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${provider.key}`,
    },
    body: JSON.stringify({
      model: provider.model,
      temperature: 0.4,
      max_tokens: 800,
      messages,
    }),
    signal: AbortSignal.timeout(45000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`${provider.label} menolak permintaan (kode ${response.status}).`);
  }
  const text = clean(data?.choices?.[0]?.message?.content);
  if (!text) throw new Error(`${provider.label} mengembalikan jawaban kosong.`);
  return { reply: text.slice(0, 4000), provider: `${provider.label}:${provider.model}` };
}

/**
 * Pollinations gratis tanpa kunci. Batasnya 1 balasan per 30 detik per IP keluar,
 * jadi kalau sedang penuh kita laporkan hitungan detik mundur ke browser, bukan
 * pesan error yang membuat fitur tampak mati.
 */
async function callPollinations(messages) {
  const response = await fetch(clean(process.env.AI_CHAT_URL) || POLLINATIONS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: clean(process.env.AI_MODEL) || 'openai',
      referrer: 'pbpii-new.vercel.app',
      temperature: 0.4,
      max_tokens: 800,
      messages,
    }),
    signal: AbortSignal.timeout(55000),
  });

  const raw = await response.text();
  let data = null;
  try { data = JSON.parse(raw); } catch { /* balasan teks polos */ }

  if (!response.ok) {
    const message = String(data?.error?.message || data?.message || raw || '').slice(0, 300);
    const wait = message.match(/Retry after (\d+)s/i);
    const error = new Error('Layanan AI gratis sedang padat.');
    error.retryAfter = wait ? Number(wait[1]) : (/FREE_LIMIT|429|rate/i.test(message) ? 30 : 0);
    throw error;
  }

  const text = clean(data?.choices?.[0]?.message?.content) || clean(raw);
  if (!text) throw new Error('Layanan AI mengembalikan jawaban kosong.');
  return { reply: text.slice(0, 4000), provider: `Pollinations:${clean(process.env.AI_MODEL) || 'openai'}` };
}

async function askModel(messages) {
  const errors = [];
  for (const provider of providers()) {
    try {
      return await callProvider(provider, messages);
    } catch (error) {
      errors.push(error.message);
    }
  }
  try {
    return await callPollinations(messages);
  } catch (error) {
    errors.push(error.message);
    const wrapped = new Error(error.message || 'Layanan AI tidak menjawab tepat waktu.');
    wrapped.retryAfter = error.retryAfter || 0;
    throw wrapped;
  }
}

/**
 * Kuota Apps Script dipakai kalau deployment-nya sudah mendukung aksi chat —
 * termasuk untuk tamu, yang dihitung per alamat jaringan.
 */
async function gasCall(payload, timeoutMs = 12000) {
  const url = process.env.GAS_WEB_APP_URL || DEFAULT_GAS_WEB_APP_URL;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const result = await response.json().catch(() => null);
    if (!result?.ok) return null;
    if (/sesi berakhir|tidak dikenali/i.test(String(result.error || ''))) return null;
    return result.data;
  } catch {
    return null;
  }
}

function gasQuota(body, ip) {
  if (!body.token && !ip) return null;
  return gasCall({ action: 'chatStatus', token: body.token || '', ip });
}

/** Balasan yang sudah dikerjakan di sini ikut dicatat agar kuota harian akurat. */
function gasRecord(body, ip, question, jawaban) {
  if (!body.token && !ip) return null;
  return gasCall({
    action: 'chatRecord',
    token: body.token || '',
    ip,
    question,
    answer: jawaban.reply,
    provider: jawaban.provider,
  }, 9000);
}

function ipOf(req) {
  const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || String(req.headers?.['x-real-ip'] || '').trim() || '';
}

/** Kunci lokal: alamat IP hari ini, karena perangkat kiriman browser bisa dipalsukan. */
function deviceOf(body, ip) {
  if (body.token) return String(body.token).slice(0, 64);
  return ip ? `ip:${ip}`.slice(0, 64) : clean(body.device).slice(0, 40) || 'anonim';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    reply(res, 405, { ok: false, error: 'Method not allowed' });
    return;
  }

  const body = await readBody(req);
  const action = String(body.action || '');
  if (['chat', 'chatStatus'].indexOf(action) < 0) {
    reply(res, 400, { ok: false, error: 'Aksi chat tidak dikenali.' });
    return;
  }

  const ip = ipOf(req);
  const device = deviceOf(body, ip);
  const entry = usageFor(device);
  const gas = await gasQuota(body, ip);
  const defaultBatas = body.token ? DAILY_LIMIT : GUEST_DAILY_LIMIT;
  const batas = gas && typeof gas.batas === 'number' ? gas.batas : defaultBatas;

  if (action === 'chatStatus') {
    const dipakai = gas && typeof gas.dipakai === 'number' ? gas.dipakai : entry.count;
    reply(res, 200, {
      ok: true,
      data: {
        boleh: dipakai < batas,
        akun: gas?.akun || (body.token ? 'akun' : 'tamu'),
        batas,
        dipakai,
        sisa: Math.max(0, batas - dipakai),
        sumber: gas ? 'apps-script' : 'lokal',
      },
    });
    return;
  }

  const question = clean(body.message).slice(0, MAX_CHARS);
  if (question.length < 3) {
    reply(res, 200, { ok: false, error: 'Tulis pertanyaan dengan jelas.' });
    return;
  }

  const dipakai = gas && typeof gas.dipakai === 'number' ? gas.dipakai : entry.count;
  if (dipakai >= batas) {
    reply(res, 200, {
      ok: false,
      code: 'quota',
      batas,
      error: body.token
        ? `Kuota ${batas} pertanyaan hari ini sudah habis. Coba lagi besok.`
        : `Jatah ${batas} pertanyaan gratis hari ini sudah habis. Masuk sebagai kader untuk jatah yang lebih besar, atau coba lagi besok.`,
    });
    return;
  }
  if (entry.recent.length >= MINUTE_LIMIT) {
    reply(res, 200, { ok: false, error: 'Terlalu cepat. Tunggu sebentar sebelum mengirim pertanyaan lagi.', retryAfter: 15 });
    return;
  }

  const history = Array.isArray(body.history) ? body.history.slice(-MAX_HISTORY) : [];
  const messages = [
    { role: 'system', content: systemPrompt() },
    ...history
      .map((turn) => ({
        role: String(turn?.role) === 'assistant' ? 'assistant' : 'user',
        content: clean(turn?.content).slice(0, MAX_CHARS),
      }))
      .filter((turn) => turn.content.length > 0),
    { role: 'user', content: question },
  ];

  try {
    const jawaban = await askModel(messages);
    entry.count += 1;
    entry.recent.push(Date.now());
    const catat = await gasRecord(body, ip, question, jawaban);
    const sisa = catat && typeof catat.dipakai === 'number'
      ? Math.max(0, (catat.batas || batas) - catat.dipakai)
      : Math.max(0, batas - dipakai - 1);
    reply(res, 200, {
      ok: true,
      data: {
        reply: jawaban.reply,
        provider: jawaban.provider,
        akun: catat?.akun || (gas?.akun || (body.token ? 'akun' : 'tamu')),
        batas: catat?.batas || batas,
        sisa,
      },
    });
  } catch (error) {
    reply(res, 200, {
      ok: false,
      error: error.message || 'Layanan AI tidak menjawab tepat waktu.',
      retryAfter: error.retryAfter || 0,
    });
  }
}
