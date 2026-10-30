/**
 * Provider Settings key save for the globe's "POWER UP" panel.
 *
 * The dev-server twin validates {ENV_VAR: value} pairs and writes a local
 * .env. A hosted website must NEVER accept or store a browser-submitted
 * credential, so this route always refuses — with HTTP 200 and the
 * `{ ok: false, error }` shape the panel already renders into its status
 * line (`payload.error`), so the panel shows an honest message instead of a
 * broken request. Submitted values are not parsed, kept, echoed, or logged.
 */

function refuse(res, reason) {
  if (res.headersSent) return;
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify({
    ok: false,
    readOnly: true,
    error: reason,
  }));
}

const REFUSAL = 'Situs ini tidak menerima atau menyimpan kunci — Pengaturan Provider hanya berfungsi pada server development lokal.';

export default async function handler(req, res) {
  const method = String(req.method || 'POST').toUpperCase();
  if (method !== 'POST') {
    // Match the dev endpoint's method guard shape; the panel only ever POSTs.
    res.writeHead(405, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      Allow: 'POST',
    });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  // Drain the body without inspecting or retaining it: a browser may still
  // have pasted a real credential into the field, and a hanging socket would
  // surface as a scary network error in the panel.
  const stream = typeof req.on === 'function' ? req : null;
  if (stream) {
    await new Promise((resolve) => {
      let seen = 0;
      const onData = (chunk) => {
        seen += chunk?.length || 0;
        // Cap like the dev endpoint (8 KB); beyond that stop reading entirely.
        if (seen > 8192) {
          stream.removeListener?.('data', onData);
          resolve();
        }
      };
      stream.on('data', onData);
      stream.on('end', resolve);
      stream.on('error', resolve);
      setTimeout(resolve, 2000).unref?.();
    });
  }

  refuse(res, REFUSAL);
}
