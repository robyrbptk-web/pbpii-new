// Chat punya fungsi sendiri karena layanan AI gratis bisa butuh puluhan detik,
// jauh di atas batas waktu proxy CMS. Kunci AI tidak pernah lewat file ini:
// Apps Script yang menyimpan dan memanggil layanannya.
import { DEFAULT_GAS_WEB_APP_URL } from './pii.js';

const ALLOWED = ['chat', 'chatStatus'];

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok:false, error:'Method not allowed' });
  const body = req.body || {};
  if (ALLOWED.indexOf(String(body.action || '')) < 0) {
    return res.status(400).json({ ok:false, error:'Aksi chat tidak dikenali.' });
  }

  const url = process.env.GAS_WEB_APP_URL || DEFAULT_GAS_WEB_APP_URL;
  try {
    const upstream = await fetch(url, { method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'}, body: JSON.stringify(body) });
    const raw = await upstream.text();
    let data; try { data = JSON.parse(raw); } catch { throw new Error('Respons Apps Script bukan JSON. Periksa deployment Web App.'); }
    return res.status(200).json(data);
  } catch (e) { return res.status(502).json({ok:false,error:e.message || 'Gagal menghubungi backend.'}); }
}
