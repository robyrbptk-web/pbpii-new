/**
 * Memastikan backend yang sedang melayani publik sama dengan kode di repo.
 * Jalankan: node scripts/check-backend.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { DEFAULT_GAS_WEB_APP_URL } = await import(pathToFileURL(join(ROOT, 'api/pii.js')).href);

const expected = readFileSync(join(ROOT, 'gas/Code.gs'), 'utf8').match(/BACKEND_VERSION = '([^']+)'/)[1];
const gasUrl = process.env.GAS_WEB_APP_URL || DEFAULT_GAS_WEB_APP_URL;
const targets = [
  ['Apps Script langsung', gasUrl],
  ['Proxy lokal :4173', 'http://127.0.0.1:4173/api/pii'],
];

let selaras = 0;

for (const [label, url] of targets) {
  let body;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'health' }),
      signal: AbortSignal.timeout(25000),
    });
    body = await response.json();
  } catch (error) {
    const sebab = /Failed to fetch|ECONNREFUSED/i.test(error.message)
      ? 'server lokal belum jalan? npm run dev:site'
      : error.message;
    console.log(`${label.padEnd(22)} TIDAK TERBACA — ${sebab}`);
    continue;
  }
  if (!body || body.version === undefined) {
    console.log(`${label.padEnd(22)} balasan bukan health: ${JSON.stringify(body).slice(0, 120)}`);
    if (!body?.ok && /Sesi berakhir/i.test(String(body?.error))) {
      console.log('   Ini sidik jari deployment lama: aksi "health" belum ada, jadi doPost jatuh ke');
      console.log('   requireAuth_. Artinya gas/Code.gs terbaru belum ditempel + Deploy > New version.');
    }
    continue;
  }
  const cocok = body.version === expected;
  if (cocok) selaras++;
  console.log(`${label.padEnd(22)} versi ${body.version} ${cocok ? '= repo' : '≠ repo (' + expected + ')'}`);
  console.log(`${''.padEnd(22)} spreadsheet ${body.spreadsheetId || '(belum diatur)'}, sheet ${JSON.stringify(body.sheets)}`);
  if (body.masalah?.length) console.log(`${''.padEnd(22)} perlu tindakan: ${body.masalah.join('; ')}`);
  if (!cocok) {
    console.log('   Deployment masih lama: tempel gas/Code.gs, Simpan, jalankan setup(), lalu');
    console.log('   Deploy > Kelola deployment > New version. Menyimpan file saja tidak mengubah /exec.');
  }
}

if (!selaras) {
  process.exitCode = 1;
  console.log('\nBelum ada backend yang melaporkan ' + expected + '.');
} else {
  console.log('\nBackend melayani ' + expected + ', sama dengan repo.');
}
