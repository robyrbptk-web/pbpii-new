/** Indonesian volcano catalog (MIT-licensed indonesia-public-static-api). */
import { createTtlCache, sendJson } from '../lib/proxy.js';

const UPSTREAM = 'https://indonesia-public-static-api.vercel.app/api/volcanoes';
const TTL_MS = 7 * 24 * 3600_000;

const cache = createTtlCache(TTL_MS);

async function fetchCatalog() {
  const upstream = await fetch(UPSTREAM, {
    signal: AbortSignal.timeout(20000),
    headers: { Accept: 'application/json' },
  });
  if (!upstream.ok) throw new Error(`HTTP ${upstream.status}`);
  const rows = await upstream.json();
  if (!Array.isArray(rows)) throw new Error('malformed response');
  return rows;
}

export default async function handler(req, res) {
  try {
    const { value, state } = await cache.get(fetchCatalog);
    sendJson(res, 200, value, state);
  } catch (error) {
    console.warn('[volcanoes] unavailable:', error?.message || error);
    sendJson(res, 502, { success: false, error: 'Volcano API tidak tersedia' }, 'miss');
  }
}
