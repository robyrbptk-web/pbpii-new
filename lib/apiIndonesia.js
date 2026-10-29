/**
 * API Indonesia catalogue fetcher shared by the hospital and Transjakarta
 * proxies. The `x-api-key` header is added server-side so the key never
 * reaches the browser.
 */
import { createTtlCache, envValue, sendJson } from '../lib/proxy.js';

const UPSTREAM = 'https://use.apiindonesia.id';

export const DATASETS = Object.freeze({
  hospitals: Object.freeze({ path: '/api/v1/rumah-sakit', perPage: 200, maxPages: 5, ttlMs: 24 * 3600_000 }),
  transjakarta: Object.freeze({ path: '/api/v1/transjakarta/halte', perPage: 100, maxPages: 5, ttlMs: 7 * 24 * 3600_000 }),
});

const caches = new Map();

function cacheFor(key) {
  if (!caches.has(key)) caches.set(key, createTtlCache(DATASETS[key].ttlMs));
  return caches.get(key);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchPage(dataset, page, key) {
  const url = new URL(`${UPSTREAM}${dataset.path}`);
  url.searchParams.set('page', String(page));
  url.searchParams.set('per_page', String(dataset.perPage));
  const upstream = await fetch(url, {
    signal: AbortSignal.timeout(30000),
    headers: { Accept: 'application/json', 'x-api-key': key },
  });
  if (upstream.status === 401 || upstream.status === 403) {
    throw Object.assign(new Error('INVALID_API_KEY'), { code: 'INVALID_API_KEY' });
  }
  if (!upstream.ok) throw new Error(`HTTP ${upstream.status}`);
  const parsed = await upstream.json();
  const rows = Array.isArray(parsed?.data) ? parsed.data : Array.isArray(parsed) ? parsed : null;
  if (!rows) throw new Error('malformed response');
  return { rows, meta: parsed?.meta || null };
}

async function collect(key, apiKey) {
  const dataset = DATASETS[key];
  const rows = [];
  let pagesFetched = 0;
  let totalPages = null;

  for (let page = 1; page <= dataset.maxPages; page += 1) {
    const result = await fetchPage(dataset, page, apiKey);
    rows.push(...result.rows);
    pagesFetched = page;
    if (Number.isFinite(result.meta?.total_pages)) totalPages = result.meta.total_pages;
    if (result.rows.length < dataset.perPage) break;
    await sleep(250);
  }

  if (rows.length === 0) throw new Error('empty dataset');

  const seen = new Set();
  const data = rows.filter((row) => {
    const id = String(row?.id ?? row?.code ?? '').trim();
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  return {
    success: true,
    data,
    meta: {
      source: `${UPSTREAM}${dataset.path}`,
      pagesFetched,
      perPage: dataset.perPage,
      truncated: totalPages === null ? pagesFetched === dataset.maxPages : pagesFetched < totalPages,
      fetchedAt: Date.now(),
    },
  };
}

/** Build the `(req, res)` handler for one dataset key. */
export function createDatasetHandler(key) {
  return async function handler(req, res) {
    const apiKey = envValue('API_INDONESIA_KEY');
    if (!apiKey) {
      sendJson(res, 503, {
        success: false,
        error: 'API_INDONESIA_KEY belum diatur',
        code: 'MISSING_API_KEY',
      }, 'miss');
      return;
    }

    try {
      const { value, state } = await cacheFor(key).get(() => collect(key, apiKey));
      sendJson(res, 200, value, state);
    } catch (error) {
      const invalid = error?.code === 'INVALID_API_KEY';
      sendJson(res, 502, {
        success: false,
        error: invalid ? 'API_INDONESIA_KEY ditolak upstream' : 'API Indonesia tidak tersedia',
      }, 'miss');
    }
  };
}
