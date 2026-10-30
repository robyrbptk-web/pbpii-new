/**
 * Radio Browser click tracker: POST `/api/radio/click/<uuid>`.
 *
 * The globe fires a fire-and-forget POST when a station starts playing so the
 * upstream click ranking stays honest. Ported from vite.config.js
 * `createRadioProxyMiddleware` (`/click/:id` branch).
 *
 * Stateful degradation: the dev proxy refused ids outside its in-memory
 * `servedStationIds` set, which cannot exist across serverless instances.
 * Instead this route validates the strict UUID shape and forwards the click to
 * the mirror's `/json/url/<uuid>` counter endpoint — the destination is still
 * locked to the *.api.radio-browser.info allowlist with DNS-pinned public
 * addresses, so nothing but a validated UUID can reach the network.
 */
import { isRadioStationUuid, recordRadioClick } from '../../../lib/radio-browser.js';

export default async function handler(req, res) {
  if (String(req.method || '').toUpperCase() !== 'POST') {
    res.writeHead(405, { Allow: 'POST', 'Cache-Control': 'no-store' });
    res.end();
    return;
  }

  const params = req.query && Object.keys(req.query).length ? req.query : {};
  const raw = String(params.id ?? '').trim().toLowerCase();
  if (!isRadioStationUuid(raw)) {
    res.writeHead(404, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify({ error: 'Unknown radio station' }));
    return;
  }

  // The dev proxy answered 204 and counted in the background; a serverless
  // instance may freeze after the response, so the forward is awaited with a
  // tight budget and its failure never changes the 204 the client expects.
  try {
    await recordRadioClick(raw);
  } catch (error) {
    console.warn('[radio-click] count forward failed:', error?.message || error);
  }
  res.writeHead(204, { 'Cache-Control': 'no-store' });
  res.end();
}

export const maxDuration = 15;
