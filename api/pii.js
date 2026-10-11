// Vercel serverless proxy: keeps the Apps Script URL out of browser code and avoids browser CORS issues.
const DEFAULT_GAS_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbxTlciByFgttDG8CuKkAUWr2j4na-jS-ENq7S3gjiclX1Uw3cSu7Rj0d8VMALt-qh-J_w/exec';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok:false, error:'Method not allowed' });
  const url = process.env.GAS_WEB_APP_URL || DEFAULT_GAS_WEB_APP_URL;
  try {
    const upstream = await fetch(url, { method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'}, body: JSON.stringify(req.body || {}) });
    const raw = await upstream.text();
    let data; try { data = JSON.parse(raw); } catch { throw new Error('Respons Apps Script bukan JSON. Periksa URL deployment dan izin Web App.'); }
    return res.status(200).json(data);
  } catch (e) { return res.status(502).json({ok:false,error:e.message || 'Gagal menghubungi Apps Script.'}); }
}
