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
    const cameras = sources.map((source) => {
      const feedType = normalizeFeedType(source.feedType || 'image');
      const verification = source.verification || { status: 'unchecked', checkedAt: null, verifiedAt: null };
      const verified = verification.status === 'verified';
      return {
        id: source.id,
        status: verified ? 'ok' : 'degraded',
        sourceKind: feedType,
        label: source.provider || source.city || '',
        message: verified ? 'SAMPEL HLS TERVERIFIKASI' : verification.status === 'failed' ? 'SAMPEL GAGAL' : 'BELUM DIUJI',
        feedType,
        // This is the actual observation time, not the time health was read.
        updatedAt: verification.checkedAt ? Date.parse(verification.checkedAt) : null,
        verifiedAt: verification.verifiedAt,
        verification,
      };
    });
    sendJson(res, 200, { cameras, count: cameras.length });
  } catch (error) {
    console.warn('[cctv/health]', error?.message || error);
    sendJson(res, 502, { error: 'Status kamera sedang tidak tersedia.' });
  }
}
