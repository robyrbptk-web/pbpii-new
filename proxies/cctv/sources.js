/**
 * Camera registry for the PII Global View CCTV layer.
 *
 * Body shape expected by /peta (src/data/cctv.js): `{ sources: [...] }`.
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
    sendJson(res, 200, { sources, count: sources.length });
  } catch (error) {
    console.warn('[cctv/sources]', error?.message || error);
    sendJson(res, 502, { error: 'Daftar kamera sedang tidak tersedia.' });
  }
}
