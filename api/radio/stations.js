/**
 * Radio Browser directory for the globe's radio layer.
 *
 * Serves `/api/radio/stations` (GET) with the exact contract the built bundle
 * validates (`src/data/radio.js`): `{ stations, updatedAt, stale, degraded,
 * degradedReason, coverage, acceptedGeneration, catalogInstance }` where every
 * station row passes the client's strict shape checks (UUID id, https-only
 * stream, ISO-2 country code, codec list, `metadataTrust:
 * 'untrusted-community'`). Ported from vite.config.js
 * `createRadioProxyMiddleware`; all upstream calls are keyless.
 *
 * Serverless state: catalog caching, generations and mirror discovery live in
 * the warm instance only. `catalogInstance` is a fresh random token per
 * instance — the client's documented "new producer instance" path — so a
 * restarted function never looks like a generation regression. Health policy,
 * SSRF pinning and error strings are unchanged from the dev proxy.
 */
import { getRadioCatalog } from '../../lib/radio-browser.js';

/** The dev proxy answers no-store on every radio route; keep that exact policy. */
function json(res, status, body, cacheState) {
  if (res.headersSent) return;
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Radio-Cache': cacheState,
  });
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  if (String(req.method || 'GET').toUpperCase() !== 'GET') {
    res.writeHead(405, { Allow: 'GET', 'Cache-Control': 'no-store' });
    res.end();
    return;
  }

  try {
    const { payload, state } = await getRadioCatalog();
    json(res, 200, {
      stations: payload.stations,
      updatedAt: payload.updatedAt,
      stale: Boolean(payload.stale),
      degraded: Boolean(payload.degraded),
      degradedReason: payload.degradedReason || null,
      coverage: payload.coverage || null,
      acceptedGeneration: payload.acceptedGeneration ?? null,
      catalogInstance: payload.catalogInstance,
    }, state);
  } catch (error) {
    console.warn('[radio] directory unavailable:', error?.message || error);
    json(res, 503, {
      error: 'Radio directory is temporarily unavailable',
      degraded: Boolean(error?.radioCatalogDegraded),
      degradedReason: error?.radioDegradedReason || null,
    }, 'miss');
  }
}

/** Nine bounded upstream queries plus mirror discovery on a cold instance. */
export const maxDuration = 30;
