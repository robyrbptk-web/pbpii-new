/**
 * Catch-all for `/api/*` paths that have no proxy.
 *
 * Without this, Vercel answers unknown data routes with its own 404 text and the
 * globe prints that inside a panel, which reads like a broken website. Known
 * gaps get a specific reason (they need a websocket or a paid key); anything
 * else gets the generic notice.
 */
const UNAVAILABLE = [
  {
    prefix: '/api/ais-live',
    reason: 'Layer kapal butuh koneksi WebSocket AISStream dan kunci AISSTREAM_TOKEN — tidak bisa dijalankan sebagai fungsi serverless.',
  },
  {
    prefix: '/api/google/',
    reason: 'Pencarian tempat memakai Google Places, yang menuntut kunci berbayar GOOGLE_MAPS_API_KEY.',
  },
  {
    prefix: '/api/realtime',
    reason: 'Lapisan realtime butuh layanan WebSocket/Redis tersendiri, bukan fungsi serverless.',
  },
  {
    prefix: '/api/setup/',
    reason: 'Pengaturan kunci provider hanya tersedia saat globe dijalankan sebagai server development, bukan di situs publik.',
  },
];

export default function handler(req, res) {
  const url = new URL(req.url || '/', 'http://localhost');
  const known = UNAVAILABLE.find((entry) => url.pathname.startsWith(entry.prefix));
  const body = JSON.stringify({
    ok: false,
    error: known ? 'layer_unavailable' : 'endpoint_not_configured',
    path: url.pathname,
    message: known
      ? known.reason
      : 'Lapisan ini belum punya proxy di proyek website. Tambahkan file di folder api/ agar datanya tampil.',
  });
  res.writeHead(501, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-PII-Route': 'unavailable',
  });
  res.end(body);
}
