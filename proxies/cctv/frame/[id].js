/**
 * Single CCTV frame for a camera id, served same-origin.
 *
 * The id is looked up in the registry; the request never supplies a host, so
 * this cannot be turned into an open proxy. Cameras whose operator publishes
 * no image answer 503 quickly and the globe paints its own placeholder.
 */
import { findSource, normalizeFeedType } from '../../../lib/cctv.js';

const UPSTREAM_TIMEOUT_MS = 12000;

export default async function handler(req, res) {
  const cameraId = String(req.query?.id || '').trim();
  const send = (status, body, headers = {}) => {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    });
    res.end(JSON.stringify(body));
  };

  if (!/^id-[a-z0-9_-]{2,96}$/i.test(cameraId)) {
    send(400, { error: 'Kamera tidak dikenal.' });
    return;
  }

  const source = await findSource(cameraId);
  if (!source) {
    send(404, { error: 'Kamera tidak terdaftar.' });
    return;
  }

  const feedType = normalizeFeedType(source.feedType || 'image');
  const url = String(source.url || '').trim();
  if (!url || !/^https?:\/\//i.test(url) || feedType !== 'image') {
    send(503, { error: 'Belum ada citra untuk kamera ini.' }, { 'X-CCTV-Status': 'no-feed' });
    return;
  }

  try {
    const upstream = await fetch(url, {
      headers: { 'User-Agent': 'pii-global-view/1.0' },
      redirect: 'follow',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    const contentType = upstream.headers.get('content-type') || '';
    if (!upstream.ok || !contentType.startsWith('image/')) {
      send(502, { error: 'Citra kamera tidak tersedia.' }, { 'X-CCTV-Status': 'upstream-error' });
      return;
    }
    const body = Buffer.from(await upstream.arrayBuffer());
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=15',
      'X-CCTV-Status': 'ok',
    });
    res.end(body);
  } catch (error) {
    console.warn(`[cctv/frame] ${cameraId}:`, error?.message || error);
    send(502, { error: 'Citra kamera tidak tersedia.' }, { 'X-CCTV-Status': 'upstream-error' });
  }
}
