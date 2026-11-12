/**
 * Camera registry for the PII Situation Room CCTV layer.
 *
 * Body shape expected by the room: `{ sources: [...] }`.
 */
import { getSources } from '../../lib/cctv.js';
import { sendJson } from '../../lib/proxy.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  try {
    const sources = await getSources();
    if (!sources.length) {
      sendJson(res, 502, { error: 'Daftar kamera sedang tidak tersedia.' });
      return;
    }
    sendJson(res, 200, {
      sources, count: sources.length,
      locatedCount: sources.filter(source => Number.isFinite(source.lat) && Number.isFinite(source.lon)).length,
      verifiedCount: sources.filter(source => source.verification?.status === 'verified').length,
      verificationScope: 'bounded-playlist-and-segment-sample-not-browser-decode',
    });
  } catch (error) {
    console.warn('[cctv/sources]', error?.message || error);
    sendJson(res, 502, { error: 'Daftar kamera sedang tidak tersedia.' });
  }
}
