/**
 * HLS / media proxy for a registered camera id.
 *
 * Only two URLs are ever fetched: the playlist stored in the registry, and a
 * `?seg=` reference that was rewritten out of that playlist and stays on the
 * playlist's own origin. Nothing here takes a host from the client.
 */
import { findSource, isVideoFeedType, normalizeFeedType, rewriteHlsPlaylist } from '../../../lib/cctv.js';

const UPSTREAM_TIMEOUT_MS = 15000;
const UPSTREAM_AGENT = 'pii-global-view/1.0';

const json = (res, status, error, headers = {}) => {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(JSON.stringify({ error }));
};

async function upstreamFetch(url, range) {
  const headers = { 'User-Agent': UPSTREAM_AGENT };
  if (range) headers.Range = range;
  return fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
}

function isPlaylist(url, contentType) {
  return contentType.includes('mpegurl') || /\.m3u8(\?|$)/i.test(new URL(url).pathname);
}

export default async function handler(req, res) {
  const cameraId = String(req.query?.id || '').trim();
  if (!/^id-[a-z0-9_-]{2,96}$/i.test(cameraId)) {
    json(res, 400, 'Kamera tidak dikenal.');
    return;
  }

  const source = await findSource(cameraId);
  const mediaUrl = String(source?.url || '').trim();
  const feedType = normalizeFeedType(source?.feedType || 'image');

  if (!mediaUrl || !/^https?:\/\//i.test(mediaUrl)) {
    json(res, 404, 'Belum ada stream untuk kamera ini.', { 'X-CCTV-Status': 'no-feed' });
    return;
  }

  const seg = String(req.query?.seg || '').trim();
  const range = req.headers?.range ? String(req.headers.range) : '';

  if (seg) {
    if (!isVideoFeedType(feedType)) {
      json(res, 400, 'seg hanya untuk stream video.');
      return;
    }
    let segUrl;
    try {
      segUrl = new URL(seg);
    } catch {
      json(res, 400, 'seg tidak valid.');
      return;
    }
    if (segUrl.origin !== new URL(mediaUrl).origin) {
      json(res, 403, 'Origin seg tidak diizinkan.');
      return;
    }

    try {
      const upstream = await upstreamFetch(segUrl.toString(), range);
      if (!upstream.ok && upstream.status !== 206) {
        json(res, 502, `Upstream menjawab ${upstream.status}.`, { 'X-CCTV-Status': 'upstream-error' });
        return;
      }
      const contentType = upstream.headers.get('content-type') || '';
      if (isPlaylist(segUrl.toString(), contentType)) {
        const variant = await upstream.text();
        if (!variant.trimStart().startsWith('#EXTM3U')) {
          json(res, 502, 'Varian upstream bukan HLS playlist.', { 'X-CCTV-Status': 'invalid-playlist' });
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Cache-Control': 'no-store',
          'X-CCTV-Status': 'hls-playlist',
        });
        res.end(rewriteHlsPlaylist(variant, segUrl.toString(), cameraId));
        return;
      }
      const body = Buffer.from(await upstream.arrayBuffer());
      res.writeHead(upstream.status, {
        'Content-Type': contentType || 'video/mp2t',
        'Content-Length': body.length,
        'Cache-Control': 'public, max-age=4',
        'X-CCTV-Status': 'hls-segment',
      });
      res.end(body);
    } catch (error) {
      console.warn(`[cctv/media] ${cameraId} seg:`, error?.message || error);
      json(res, 502, 'Segmen gagal diambil.', { 'X-CCTV-Status': 'upstream-error' });
    }
    return;
  }

  try {
    const upstream = await upstreamFetch(mediaUrl, range);
    const contentType = upstream.headers.get('content-type') || '';
    if (!upstream.ok && upstream.status !== 206) {
      json(res, 502, `Upstream menjawab ${upstream.status}.`, { 'X-CCTV-Status': 'upstream-error' });
      return;
    }

    if (feedType === 'hls' || isPlaylist(mediaUrl, contentType)) {
      const playlist = await upstream.text();
      if (!playlist.trimStart().startsWith('#EXTM3U')) {
        json(res, 502, 'Upstream bukan HLS playlist.', { 'X-CCTV-Status': 'invalid-playlist' });
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Cache-Control': 'no-store',
        'X-CCTV-Status': 'hls-playlist',
      });
      res.end(rewriteHlsPlaylist(playlist, mediaUrl, cameraId));
      return;
    }

    const body = Buffer.from(await upstream.arrayBuffer());
    const headers = {
      'Content-Type': contentType || 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': 'public, max-age=4',
      'X-CCTV-Status': 'media',
    };
    if (upstream.status === 206) {
      headers['Content-Range'] = upstream.headers.get('content-range') || '';
      headers['Accept-Ranges'] = 'bytes';
    }
    res.writeHead(upstream.status, headers);
    res.end(body);
  } catch (error) {
    console.warn(`[cctv/media] ${cameraId}:`, error?.message || error);
    json(res, 502, 'Stream gagal diambil.', { 'X-CCTV-Status': 'upstream-error' });
  }
}
