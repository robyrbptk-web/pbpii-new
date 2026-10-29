/**
 * National school sample for the PII Global View "Sekolah Indonesia" layer.
 *
 * api-sekolah ignores `page` and forces `limit=10` when `kode_wilayah` is
 * present, while a global query only reaches a few provinces. One 10-row
 * query per province (38 codes) is the only way to plot schools across the
 * archipelago, so this fan-out mirrors the globe's dev proxy.
 */
import { createTtlCache, sendJson } from '../lib/proxy.js';

const UPSTREAM = 'https://sekolah.devapi.id/sekolah';
const PROVINCE_CODES = Object.freeze([
  '11', '12', '13', '14', '15', '16', '17', '18', '19', '21',
  '31', '32', '33', '34', '35', '36',
  '51', '52', '53',
  '61', '62', '63', '64', '65',
  '71', '72', '73', '74', '75', '76',
  '81', '82',
  '91', '92', '93', '94', '95', '96',
]);
const TTL_MS = 24 * 3600_000;
const CONCURRENCY = 3;
const GAP_MS = 150;
const PER_PROVINCE_LIMIT = 10;
/** Return whatever finished instead of timing out the whole request. */
const TIME_BUDGET_MS = 22_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const cache = createTtlCache(TTL_MS);

async function fetchProvince(kode) {
  const url = new URL(UPSTREAM);
  url.searchParams.set('kode_wilayah', kode);
  url.searchParams.set('limit', String(PER_PROVINCE_LIMIT));
  const upstream = await fetch(url, {
    signal: AbortSignal.timeout(15000),
    headers: { Accept: 'application/json' },
  });
  if (!upstream.ok) throw new Error(`HTTP ${upstream.status}`);
  const parsed = await upstream.json();
  if (parsed?.success !== true || !Array.isArray(parsed.data)) {
    throw new Error('malformed response');
  }
  return parsed.data;
}

async function collectSample() {
  const deadline = Date.now() + TIME_BUDGET_MS;
  const rows = [];
  const failed = [];
  let cursor = 0;

  const worker = async () => {
    while (cursor < PROVINCE_CODES.length && Date.now() < deadline) {
      const kode = PROVINCE_CODES[cursor];
      cursor += 1;
      try {
        rows.push(...await fetchProvince(kode));
      } catch {
        await sleep(1200);
        try {
          rows.push(...await fetchProvince(kode));
        } catch {
          failed.push(kode);
        }
      }
      await sleep(GAP_MS);
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  if (rows.length === 0) throw new Error('all province queries failed');

  const seen = new Set();
  const data = rows.filter((row) => {
    const npsn = String(row?.npsn || '').trim();
    if (!npsn || seen.has(npsn)) return false;
    seen.add(npsn);
    return true;
  });

  return {
    success: true,
    data,
    meta: {
      sampled: true,
      provincesQueried: cursor,
      provincesFailed: failed,
      limitPerProvince: PER_PROVINCE_LIMIT,
      fetchedAt: Date.now(),
    },
  };
}

export default async function handler(req, res) {
  try {
    const { value, state } = await cache.get(collectSample);
    sendJson(res, 200, value, state);
  } catch (error) {
    console.warn('[sekolah] unavailable:', error?.message || error);
    sendJson(res, 502, { success: false, error: 'Sekolah API tidak tersedia' }, 'miss');
  }
}
