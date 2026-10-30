/**
 * CelesTrak TLE proxy for the satellite layer.
 *
 * The browser cannot call CelesTrak directly (CORS + it 403s bulk groups
 * without a descriptive User-Agent). Wired through the rewrite
 * `/api/celestrak/:group` → `/api/celestrak?group=:group`.
 */
import { createTtlCache } from '../lib/proxy.js';

const TTL_MS = 6 * 3600_000;
const USER_AGENT = 'pii-global-view/1.0';

const cache = createTtlCache(TTL_MS);

async function fetchTle(group) {
  const url = new URL('https://celestrak.org/NORAD/elements/gp.php');
  url.searchParams.set('GROUP', group);
  url.searchParams.set('FORMAT', 'tle');

  let upstream = await fetch(url, {
    signal: AbortSignal.timeout(20000),
    headers: { 'User-Agent': USER_AGENT },
  });

  // CelesTrak answers 403 when a group was already downloaded from this host
  // inside its refresh window; the supplemental feed carries the same objects.
  if (upstream.status === 403 && /has not updated since/i.test(await upstream.clone().text().catch(() => ''))) {
    const supplemental = new URL('https://celestrak.org/NORAD/elements/supplemental/sup-gp.php');
    supplemental.searchParams.set('FILE', group);
    supplemental.searchParams.set('FORMAT', 'tle');
    upstream = await fetch(supplemental, {
      signal: AbortSignal.timeout(20000),
      headers: { 'User-Agent': USER_AGENT },
    });
  }

  if (!upstream.ok) throw new Error(`HTTP ${upstream.status}`);
  const body = await upstream.text();
  if (!/^1 /m.test(body)) throw new Error('no TLE lines in response');
  return body;
}

export default async function handler(req, res) {
  // The globe calls `/api/celestrak/<group>`; the vercel.json rewrite turns that
  // into `?group=`, and `api/celestrak/[group].js` delivers it as a path param.
  const params = req.query || Object.fromEntries(new URL(req.url || '/', 'http://localhost').searchParams);
  const group = String(params.group || '').trim();

  if (!/^[a-z0-9-]+$/i.test(group)) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('invalid group');
    return;
  }

  try {
    const { value, state } = await cache.get(() => fetchTle(group));
    if (res.headersSent) return;
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      'X-TLE-Cache': state,
    });
    res.end(value);
  } catch (error) {
    console.warn(`[celestrak] ${group} unavailable:`, error?.message || error);
    if (res.headersSent) return;
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('upstream unavailable');
  }
}
