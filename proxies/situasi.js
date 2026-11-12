import { kirimAksi, DEFAULT_GAS_WEB_APP_URL } from '../api/pii.js';
import { getSituation } from '../lib/situasi.js';

const backend = (body) => kirimAksi(body, process.env.GAS_WEB_APP_URL || DEFAULT_GAS_WEB_APP_URL, 14000);
const requests = new Map();

export function createSituationHandler(call = backend, load = getSituation) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Vary', 'Authorization');
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Metode tidak diizinkan.' });
    const token = /^Bearer\s+(\S+)$/i.exec(String(req.headers?.authorization || ''))?.[1] || '';
    if (!token || token.length > 160) return res.status(401).json({ ok: false, error: 'Silakan masuk untuk membuka Ruang Situasi.' });
    const ip = String(req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].slice(0, 64);
    const now = Date.now();
    for (const [key, item] of requests) if (now > item.until) requests.delete(key);
    const count = requests.get(ip) || { count: 0, until: now + 60000 };
    if (++count.count > 90) {
      res.setHeader('Retry-After', '60');
      return res.status(429).json({ ok: false, error: 'Tunggu sebentar sebelum menyegarkan lagi.' });
    }
    requests.set(ip, count);
    const kind = String(req.body?.kind || 'berita');
    const city = String(req.body?.city || 'jakarta');
    if (kind.length > 24 || city.length > 24) return res.status(400).json({ ok: false, error: 'Pilihan data tidak dikenali.' });
    try {
      const account = await call({ action: 'whoami', token, ip });
      if (!account?.ok) return res.status(503).json({ ok: false, error: 'Sesi belum dapat diperiksa. Coba lagi sebentar.' });
      if (!['kader', 'org', 'admin'].includes(account.data?.role)) return res.status(401).json({ ok: false, error: 'Sesi berakhir. Silakan masuk kembali.' });
      if (kind === 'sesi') return res.status(200).json({ ok: true, data: { role: account.data.role } });
      if (kind === 'kegiatan') {
        const payload = await call({ action: 'public', ip });
        if (!payload?.ok) throw new Error('Daftar kegiatan tidak dapat diambil');
        const items = (payload.data?.events || []).filter((event) => {
          return event.latitude !== '' && event.latitude != null && event.longitude !== '' && event.longitude != null
            && Number.isFinite(Number(event.latitude)) && Number.isFinite(Number(event.longitude))
            && Math.abs(Number(event.latitude)) <= 90 && Math.abs(Number(event.longitude)) <= 180;
        }).map((event) => ({ id: event.id, title: event.title, lat: Number(event.latitude), lon: Number(event.longitude),
          date: event.date, endDate: event.endDate, level: event.jenjangKaderisasi, location: event.location,
          host: event.host?.name || '', upcoming: event.upcoming,
          url: `/acara.html?event=${encodeURIComponent(event.id)}` }));
        return res.status(200).json({ ok: true, data: { items, source: 'Kegiatan PII', fetchedAt: new Date().toISOString(), note: 'Titik dan jadwal diisi pengurus penyelenggara. Peta ini hanya untuk melihat kegiatan.' } });
      }
      const data = await load(kind, city);
      return res.status(200).json({ ok: true, data });
    } catch (error) {
      console.warn('[situasi]', kind, error.message);
      return res.status(error.status || 502).json({ ok: false, error: error.status === 400 ? error.message : 'Sumber sedang tidak dapat dihubungi. Coba lagi sebentar.' });
    }
  };
}

export default createSituationHandler();
