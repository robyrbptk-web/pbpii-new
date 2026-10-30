/**
 * Overpass API proxy for the road, footprint and boundary layers.
 *
 * The browser posts `data=<Overpass QL>` (GET with `?data=` is accepted too);
 * the query is validated and its timeout clamped here, then fanned out over the
 * public mirrors in order because a single mirror routinely answers 429 or a
 * runtime error. Successful bodies are passed through verbatim — the client
 * parses `elements` itself — and cached per normalized query for a day, so a
 * mirror outage still serves the last good geometry.
 */
import { createTtlCache } from '../lib/proxy.js';

const UPSTREAMS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const UPSTREAM_TIMEOUT_MS = 20_000;
const TOTAL_DEADLINE_MS = 30_000;
const MIN_MIRROR_WINDOW_MS = 4_000;
const CACHE_MS = 24 * 3600_000;
const MAX_KEYS = 32;
const MAX_BODY_BYTES = 24 * 1024;
const MAX_RESPONSE_BYTES = 6 * 1024 * 1024;
const MAX_AROUND_M = 50_000;
const MAX_BBOX_DEG = 12;
const MAX_TIMEOUT_S = 25;
const USER_AGENT = 'pii-global-view/1.0';

const caches = new Map();

/** createTtlCache holds one slot, so each distinct query gets its own instance. */
function cacheFor(key) {
  let cache = caches.get(key);
  if (!cache) {
    if (caches.size >= MAX_KEYS) caches.delete(caches.keys().next().value);
    cache = createTtlCache(CACHE_MS);
    caches.set(key, cache);
  }
  return cache;
}

function looksRateLimited(text) {
  const lower = String(text || '').toLowerCase();
  return lower.includes('rate_limited')
    || lower.includes('quota of your ip address')
    || lower.includes('too many requests');
}

function looksRuntimeError(text) {
  const lower = String(text || '').toLowerCase();
  return lower.includes('runtime error')
    || lower.includes('timed out')
    || lower.includes('out of memory');
}

/** Bounds the QL so one browser tab cannot ask a public mirror for the planet. */
function sanitizeQuery(rawBody) {
  let query = String(rawBody || '');
  try {
    const params = new URLSearchParams(rawBody);
    const fromForm = params.get('data') || params.get('query');
    if (fromForm) query = fromForm;
  } catch {
    return { ok: false, error: 'Malformed query body' };
  }
  if (!query.trim()) return { ok: false, error: 'Missing Overpass data query' };
  if (query.length > MAX_BODY_BYTES) return { ok: false, error: 'Overpass query too large' };

  if (/\b(?:foreach|complete|retro|compare|convert|make)\b/i.test(query)) {
    return { ok: false, error: 'Unsupported Overpass construct' };
  }
  if (/\bpoly\s*:/i.test(query)) return { ok: false, error: 'Overpass poly filter not allowed' };

  let bounded = false;
  for (const match of query.matchAll(/around(?:\.\w+)?:\s*([\d.eE+-]+)/gi)) {
    const radius = Number(match[1]);
    if (!Number.isFinite(radius) || radius > MAX_AROUND_M) {
      return { ok: false, error: 'Overpass around radius too large' };
    }
    bounded = true;
  }
  const bboxPattern = /\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/g;
  for (const match of query.matchAll(bboxPattern)) {
    const [south, west, north, east] = match.slice(1).map(Number);
    if (Math.abs(north - south) > MAX_BBOX_DEG || Math.abs(east - west) > MAX_BBOX_DEG) {
      return { ok: false, error: 'Overpass bbox too large' };
    }
    bounded = true;
  }
  // Area pivots are bounded by their own relation, not by a coordinate window.
  if (/\bis_in\s*\(|\bpivot\b|->\s*\.\w+/i.test(query)) bounded = true;
  if (!bounded) return { ok: false, error: 'Overpass query is not spatially bounded' };

  const clamped = query.replace(/\[\s*timeout\s*:\s*(\d+(?:\.\d+)?)\s*\]/i,
    (clause, seconds) => `[timeout:${Math.min(Number(seconds), MAX_TIMEOUT_S)}]`);
  return { ok: true, query: clamped };
}

async function readBody(req) {
  const { body } = req;
  if (typeof body === 'string') return body;
  if (body && typeof body === 'object' && Object.keys(body).length) {
    const data = body.data ?? body.query;
    return typeof data === 'string' ? `data=${encodeURIComponent(data)}` : '';
  }
  if (typeof req[Symbol.asyncIterator] !== 'function') return '';
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function queryMirror(endpoint, body, timeoutMs) {
  const upstream = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
    },
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await upstream.text();
  return { status: upstream.status, body: text, endpoint };
}

/** Rotates mirrors on refusal / 429 / runtime error; keeps the best answer. */
async function runQuery(body) {
  let rateLimited = null;
  let refusal = null;
  let lastError = null;
  // One shared wall-clock budget, so four slow mirrors cannot stack into a
  // minute-long request the serverless runtime would kill anyway.
  const deadlineAt = Date.now() + TOTAL_DEADLINE_MS;

  for (const endpoint of UPSTREAMS) {
    const remaining = deadlineAt - Date.now();
    if (remaining < MIN_MIRROR_WINDOW_MS) {
      lastError = lastError || new Error('Overpass mirror budget exhausted');
      break;
    }
    try {
      const payload = await queryMirror(endpoint, body, Math.min(UPSTREAM_TIMEOUT_MS, remaining));
      if (payload.status === 429 || looksRateLimited(payload.body)) {
        rateLimited = rateLimited || payload;
        continue;
      }
      if (looksRuntimeError(payload.body)) {
        lastError = new Error(`Overpass runtime error (${endpoint})`);
        continue;
      }
      if (payload.status < 200 || payload.status >= 300 || payload.body.length > MAX_RESPONSE_BYTES) {
        refusal = refusal || payload;
        lastError = new Error(`Overpass upstream returned ${payload.status} (${endpoint})`);
        continue;
      }
      if (!/"elements"\s*:/.test(payload.body)) {
        lastError = new Error(`Overpass response has no elements array (${endpoint})`);
        continue;
      }
      return { status: 200, body: payload.body, endpoint };
    } catch (error) {
      lastError = error;
    }
  }

  if (rateLimited) return { ...rateLimited, failed: true };
  if (refusal) return { ...refusal, failed: true };
  throw lastError || new Error('All Overpass upstreams failed');
}

export default async function handler(req, res) {
  const send = (status, body, cacheState, endpoint) => {
    if (res.headersSent) return;
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': status === 200 ? 'public, max-age=15' : 'no-store',
      'X-PII-Cache': cacheState,
      'X-Overpass-Cache': cacheState.toUpperCase(),
      'X-Overpass-Upstream': endpoint || 'none',
    });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };

  let cacheKey = null;
  try {
    const raw = req.method === 'GET' || req.method === 'HEAD'
      ? new URLSearchParams(new URL(req.url || '/', 'http://localhost').search).toString()
      : await readBody(req);

    if (!String(raw || '').trim()) {
      send(400, { error: 'Missing Overpass query body' }, 'miss');
      return;
    }

    const sanitized = sanitizeQuery(raw);
    if (!sanitized.ok) {
      send(400, { error: sanitized.error }, 'miss');
      return;
    }

    const body = `data=${encodeURIComponent(sanitized.query)}`;
    cacheKey = sanitized.query.replace(/\s+/g, ' ').trim();

    const { value, state } = await cacheFor(cacheKey).get(async () => {
      const payload = await runQuery(body);
      if (payload.failed) throw Object.assign(new Error(`Overpass declined (${payload.status})`), payload);
      return payload;
    });

    send(value.status, value.body, state, value.endpoint);
  } catch (error) {
    console.warn('[overpass] query failed:', error?.message || error);
    // A declined query keeps the mirror's own status so the client backs off
    // (429) instead of retrying on a generic gateway error.
    const status = error?.status === 429 ? 429 : 502;
    send(status, { error: 'Data Overpass sementara tidak tersedia.' }, 'miss', error?.endpoint);
  }
}
