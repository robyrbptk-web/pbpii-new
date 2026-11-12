/** Same-origin HLS proxy. The registry, never the request, chooses the host. */
import {
  CAMERA_ID_PATTERN, findSource, isAllowedStreamUrl, isVideoFeedType,
  normalizeFeedType, resolveCameraMediaUrl, fetchCameraMedia, rewriteHlsPlaylist,
} from '../../../lib/cctv.js';

const json = (res, status, error, headers = {}) => {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', ...headers,
  });
  res.end(JSON.stringify({ error }));
};

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    json(res, 405, 'Method not allowed', { Allow: 'GET' });
    return;
  }
  const cameraId = typeof req.query?.id === 'string' ? req.query.id.trim() : '';
  if (!CAMERA_ID_PATTERN.test(cameraId)) {
    json(res, 400, 'Kamera tidak dikenal.');
    return;
  }
  if ((req.query?.seg !== undefined && typeof req.query.seg !== 'string')
    || (req.query?.seg?.length || 0) > 4096) {
    json(res, 400, 'seg tidak valid.');
    return;
  }
  const range = req.headers?.range || '';
  if (range && (typeof range !== 'string' || !/^bytes=\d{1,12}-\d{0,12}$/.test(range))) {
    json(res, 400, 'Range tidak valid.');
    return;
  }
  try {
    const source = await findSource(cameraId);
    if (!source || !isAllowedStreamUrl(source.url, source.sourceKind)) {
      json(res, 404, 'Belum ada stream untuk kamera ini.', { 'X-CCTV-Status': 'no-feed' });
      return;
    }
    const seg = req.query?.seg || '';
    const feedType = normalizeFeedType(source.feedType);
    if (seg && !isVideoFeedType(feedType)) {
      json(res, 400, 'seg hanya untuk stream video.');
      return;
    }
    let target;
    try {
      // Client references must be absolute URLs emitted by our playlist rewrite.
      if (seg) new URL(seg);
      target = resolveCameraMediaUrl(seg || source.url, source.url, source.url);
    } catch {
      json(res, 403, 'Origin atau path seg tidak diizinkan.');
      return;
    }
    const upstream = await fetchCameraMedia(target, source.url, { range });
    const contentType = upstream.headers.get('content-type') || '';
    if (/mpegurl/i.test(contentType) || /\.m3u8$/i.test(new URL(target).pathname)) {
      const playlist = rewriteHlsPlaylist(upstream.body.toString('utf8'), target, cameraId, source.url);
      res.writeHead(200, {
        'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store',
        'X-CCTV-Status': 'hls-playlist', 'X-Content-Type-Options': 'nosniff',
      });
      res.end(playlist);
      return;
    }
    if (/text|html|json/i.test(contentType)) throw new Error('Upstream segment is not media');
    const headers = {
      'Content-Type': contentType || 'application/octet-stream',
      'Content-Length': upstream.body.length, 'Cache-Control': 'public, max-age=4',
      'X-CCTV-Status': 'hls-segment', 'X-Content-Type-Options': 'nosniff',
    };
    if (upstream.status === 206) {
      const contentRange = upstream.headers.get('content-range');
      if (contentRange) headers['Content-Range'] = contentRange;
      headers['Accept-Ranges'] = 'bytes';
    }
    res.writeHead(upstream.status, headers);
    res.end(upstream.body);
  } catch (error) {
    console.warn(`[cctv/media] ${cameraId}:`, error?.message || error);
    json(res, 502, 'Stream atau segmen gagal diambil.', { 'X-CCTV-Status': 'upstream-error' });
  }
}
