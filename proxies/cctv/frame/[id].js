/** HLS is decoded in the browser by the existing player, not by this route.
 * The public registry publishes no JPEG snapshots; do not fetch an HLS URL as
 * an image or manufacture a frame. Keep the globe's explicit no-feed contract.
 */
import { CAMERA_ID_PATTERN, findSource } from '../../../lib/cctv.js';

export default async function handler(req, res) {
  const send = (status, body, headers = {}) => {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff', ...headers,
    });
    res.end(JSON.stringify(body));
  };
  if (req.method !== 'GET') {
    send(405, { error: 'Method not allowed' }, { Allow: 'GET' });
    return;
  }
  const cameraId = typeof req.query?.id === 'string' ? req.query.id.trim() : '';
  if (!CAMERA_ID_PATTERN.test(cameraId)) {
    send(400, { error: 'Kamera tidak dikenal.' });
    return;
  }
  try {
    const source = await findSource(cameraId);
    if (!source) {
      send(404, { error: 'Kamera tidak terdaftar.' });
      return;
    }
    send(503, { error: 'Gunakan pemutar HLS untuk kamera ini.' }, { 'X-CCTV-Status': 'no-feed' });
  } catch (error) {
    console.warn(`[cctv/frame] ${cameraId}:`, error?.message || error);
    send(502, { error: 'Daftar kamera sedang tidak tersedia.' });
  }
}
