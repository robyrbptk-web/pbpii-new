/**
 * Per-camera registry report for the globe HUD.
 *
 * Serverless functions are stateless, so this describes what the registry
 * knows about each camera rather than a live probe of every stream; the frame
 * and media routes report the real outcome when a camera is actually opened.
 */
import { getSources, normalizeFeedType } from '../../lib/cctv.js';
import { sendJson } from '../../lib/proxy.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  try {
    const sources = await getSources();
    const updatedAt = Date.now();
    const cameras = sources.map((source) => {
      const feedType = normalizeFeedType(source.feedType || 'image');
      const hasUrl = typeof source.url === 'string' && !!source.url.trim();
      return {
        id: source.id,
        status: hasUrl ? 'ok' : 'degraded',
        sourceKind: hasUrl ? feedType : 'registry',
        label: source.provider || source.city || '',
        message: hasUrl ? 'SIAP' : 'TANPA STREAM',
        feedType,
        updatedAt,
      };
    });
    sendJson(res, 200, { cameras, count: cameras.length });
  } catch (error) {
    console.warn('[cctv/health]', error?.message || error);
    sendJson(res, 502, { error: 'Status kamera sedang tidak tersedia.' });
  }
}
