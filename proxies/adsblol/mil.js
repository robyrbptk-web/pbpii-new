/**
 * adsb.lol military aircraft proxy for the military layer.
 *
 * Body is passed through verbatim because the client validates `data.ac`
 * itself; only the round-trip is proxied (adsb.lol sends no browser CORS).
 * A 12 s window absorbs the globe's poll burst, and a failed refresh keeps
 * serving the last good frame instead of dropping the layer.
 */
import { createTtlCache } from '../../lib/proxy.js';

const UPSTREAM = 'https://api.adsb.lol/v2/mil';
const TTL_MS = 12_000;
const USER_AGENT = 'pii-global-view/1.0';

const cache = createTtlCache(TTL_MS);

async function fetchMil() {
  const upstream = await fetch(UPSTREAM, {
    signal: AbortSignal.timeout(20000),
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
  });
  const body = await upstream.text();
  if (!upstream.ok) throw new Error(`HTTP ${upstream.status}`);
  let parsed = null;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error('malformed response');
  }
  if (!Array.isArray(parsed?.ac)) throw new Error('response has no ac array');
  return { status: upstream.status, body };
}

export default async function handler(req, res) {
  try {
    const { value, state } = await cache.get(fetchMil);
    if (res.headersSent) return;
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-PII-Cache': state,
      'X-ADS-B-Cache': state.toUpperCase(),
    });
    res.end(value.body);
  } catch (error) {
    console.warn('[adsblol/mil] unavailable:', error?.message || error);
    if (res.headersSent) return;
    res.writeHead(502, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify({ error: 'Data militer sedang tidak tersedia.' }));
  }
}
