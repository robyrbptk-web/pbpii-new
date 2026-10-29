/**
 * API Muslim (api.myquran.com v3) fetchers shared by the ibadah proxies.
 *
 * The upstream is keyless, so these handlers exist to keep the browser
 * same-origin, to cache payloads that never change (daftar surat, teks ayat),
 * and to validate every input before it reaches a path segment upstream.
 */
import { createTtlCache, sendJson } from './proxy.js';

const UPSTREAM = 'https://api.myquran.com/v3';

/** Kab/kota ids are md5 hashes; anything else is a request mistake. */
export function validCityId(value) {
  return /^[a-f0-9]{32}$/i.test(String(value || '').trim());
}

export function validCoordinate(value, limit) {
  const number = Number(value);
  return Number.isFinite(number) && Math.abs(number) <= limit ? number : null;
}

class UpstreamLimitError extends Error {}

const caches = new Map();

function cacheFor(key, ttlMs) {
  if (!caches.has(key)) caches.set(key, createTtlCache(ttlMs));
  return caches.get(key);
}

/**
 * Fetch one allowlisted path, retry once on a transport error, and unwrap the
 * upstream envelope. `status: false` is a real answer (unknown id) and is
 * passed through so the client can show it instead of a generic failure.
 */
async function fetchUpstream(path, searchParams = null) {
  const url = new URL(`${UPSTREAM}${path}`);
  for (const [key, value] of Object.entries(searchParams || {})) {
    url.searchParams.set(key, String(value));
  }

  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(20000),
        headers: { Accept: 'application/json' },
      });
      if (response.status === 429) throw new UpstreamLimitError();
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json();
      if (body?.status === false && !body?.data) return { ok: false, message: body?.message || 'Data tidak ditemukan.' };
      return { ok: true, body };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function respond(res, cache, produce) {
  try {
    const { value, state } = await cache.get(produce);
    if (!value.ok) {
      sendJson(res, 404, { success: false, error: value.message }, 'miss');
      return;
    }
    sendJson(res, 200, {
      success: true,
      data: value.body.data ?? null,
      meta: { source: `${UPSTREAM}`, fetchedAt: Date.now(), ...(value.meta || {}) },
    }, state);
  } catch (error) {
    if (error instanceof UpstreamLimitError) {
      sendJson(res, 503, { success: false, error: 'API Muslim sedang membatasi permintaan, coba lagi sebentar.' }, 'miss');
      return;
    }
    console.warn('[muslim] upstream unavailable:', error?.message || error);
    sendJson(res, 502, { success: false, error: 'API Muslim tidak tersedia' }, 'miss');
  }
}

/**
 * `/sholat/jadwal/:id/today` — hari ini saja, cache pendek.
 *
 * No `tz` is passed: the upstream times are already local civil times for the
 * city (verified identical across tz=Asia/Jakarta|Makassar|Jayapura), so a tz
 * argument would only mislead the label.
 */
export function jadwalHandler(req, res) {
  const id = String(req.query?.id || '').trim();
  if (!validCityId(id)) {
    sendJson(res, 400, { success: false, error: 'Parameter id kab/kota tidak valid' }, 'miss');
    return;
  }
  return respond(res, cacheFor(`jadwal:${id}`, 3600_000), () => fetchUpstream(`/sholat/jadwal/${id}/today`));
}

/** `/sholat/kabkota/semua`, filtered in-process by `q`. */
export function kotaHandler(req, res) {
  const keyword = String(req.query?.q || '').trim().toUpperCase().slice(0, 40);
  return respond(res, cacheFor('kota', 7 * 24 * 3600_000), async () => {
    const result = await fetchUpstream('/sholat/kabkota/semua');
    if (result.ok && keyword) {
      const rows = Array.isArray(result.body.data) ? result.body.data : [];
      result.body = {
        ...result.body,
        data: rows.filter((row) => String(row?.lokasi || '').toUpperCase().includes(keyword)),
      };
    }
    return result;
  });
}

/** `/quran` (daftar surat) or `/quran/:nomor?page&limit` (ayat). */
export function quranHandler(req, res) {
  const raw = String(req.query?.nomor || '').trim();
  if (!raw) {
    return respond(res, cacheFor('quran-list', 30 * 24 * 3600_000), () => fetchUpstream('/quran'));
  }

  const surah = Number(raw);
  if (!Number.isInteger(surah) || surah < 1 || surah > 114) {
    sendJson(res, 400, { success: false, error: 'Nomor surat harus 1–114' }, 'miss');
    return undefined;
  }
  const page = Math.min(Math.max(Number(req.query?.page) || 1, 1), 20);
  const limit = Math.min(Math.max(Number(req.query?.limit) || 50, 1), 100);

  return respond(res, cacheFor(`quran:${surah}:${page}:${limit}`, 30 * 24 * 3600_000), async () => {
    const result = await fetchUpstream(`/quran/${surah}`, { page, limit });
    if (result.ok) result.meta = { pagination: result.body.pagination || null };
    return result;
  });
}

/** `/qibla/:lat,:lon` from the secretariat or the visitor's position. */
export function qiblaHandler(req, res) {
  const lat = validCoordinate(req.query?.lat, 90);
  const lon = validCoordinate(req.query?.lon, 180);
  if (lat === null || lon === null) {
    sendJson(res, 400, { success: false, error: 'Koordinat tidak valid' }, 'miss');
    return undefined;
  }
  const fixed = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  return respond(res, cacheFor(`qibla:${fixed}`, 30 * 24 * 3600_000), () => fetchUpstream(`/qibla/${fixed}`));
}

/** `/cal/today` — tanggal Hijriah hari ini. */
export function kalenderHandler(req, res) {
  return respond(res, cacheFor('kalender', 3600_000), () => fetchUpstream('/cal/today'));
}
