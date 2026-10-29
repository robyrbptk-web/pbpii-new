// Proxy data wilayah Indonesia (38 provinsi, kabupaten/kota, kecamatan) dari wilayah.id.
// Browser memanggil /api/wilayah supaya tidak bergantung pada CORS dan bisa di-cache di edge.
const BASE_URL = 'https://wilayah.id/api';

const LEVELS = {
  provinces: { path: () => 'provinces.json', parent: null },
  regencies: { path: (parent) => 'regencies/' + parent + '.json', parent: /^\d{2}$/ },
  districts: { path: (parent) => 'districts/' + parent + '.json', parent: /^\d{2}\.\d{2}$/ }
};

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const level = String(req.query.level || 'provinces');
  const spec = LEVELS[level];
  if (!spec) return res.status(400).json({ ok: false, error: 'Level wilayah tidak dikenal.' });

  const parent = String(req.query.parent || '').trim();
  if (spec.parent && !spec.parent.test(parent)) {
    return res.status(400).json({ ok: false, error: 'Kode induk wilayah tidak valid.' });
  }

  try {
    const upstream = await fetch(BASE_URL + '/' + spec.path(parent), {
      headers: { Accept: 'application/json' }
    });
    if (!upstream.ok) throw new Error('upstream ' + upstream.status);
    const payload = await upstream.json();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
    return res.status(200).json({ ok: true, level, parent, data: payload.data || [] });
  } catch (error) {
    return res.status(502).json({ ok: false, error: 'Data wilayah sedang tidak tersedia. Coba lagi nanti.' });
  }
}
