/**
 * Pelaksana migrasi Supabase.
 *
 * Kredensial dibaca dari .env.local (berada di .gitignore) atau environment
 * proses. Tidak ada nilai rahasia yang ditulis ke dalam berkas ini atau dicetak
 * penuh — perintah `keys` hanya menampilkan prefiks pendek untuk pencocokan.
 *
 *   node scripts/sb.mjs query "select 1"
 *   node scripts/sb.mjs file supabase/migrations/0001_skema_dasar.sql
 *   node scripts/sb.mjs keys
 */
import fs from 'node:fs';
import path from 'node:path';

const AKAR = path.resolve(import.meta.dirname, '..');
const ENV_LOKAL = path.join(AKAR, '.env.local');

function bacaEnv() {
  const isi = {};
  if (fs.existsSync(ENV_LOKAL)) {
    for (const baris of fs.readFileSync(ENV_LOKAL, 'utf8').split(/\r?\n/)) {
      const cocok = /^([A-Z0-9_]+)=(.*)$/.exec(baris.trim());
      if (cocok) isi[cocok[1]] = cocok[2];
    }
  }
  return { ...isi, ...process.env };
}

const ENV = bacaEnv();
const TOKEN = ENV.SUPABASE_ACCESS_TOKEN || '';
const REF = ENV.SUPABASE_PROJECT_REF || '';

async function api(waktu, opsi = {}) {
  if (!TOKEN) throw new Error('SUPABASE_ACCESS_TOKEN belum ada di .env.local');
  const res = await fetch(`https://api.supabase.com/v1${waktu}`, {
    ...opsi,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      ...(opsi.headers || {}),
    },
    signal: AbortSignal.timeout(opsi.timeout || 120000),
  });
  const teks = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${waktu}: ${teks.slice(0, 500)}`);
  return teks ? JSON.parse(teks) : null;
}

export async function jalan(sql, parameter = []) {
  return api(`/projects/${REF}/database/query`, {
    method: 'POST',
    body: JSON.stringify({ query: sql, params: parameter }),
  });
}

async function tulisEnv(nama, nilai) {
  const baris = fs.existsSync(ENV_LOKAL)
    ? fs.readFileSync(ENV_LOKAL, 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith(`${nama}=`))
    : [];
  baris.push(`${nama}=${nilai}`);
  fs.writeFileSync(ENV_LOKAL, baris.join('\n') + '\n');
}

const perintah = process.argv[2];
const argumen = process.argv.slice(3).join(' ');

try {
  if (perintah === 'query') {
    console.log(JSON.stringify(await jalan(argumen), null, 2));
  } else if (perintah === 'file') {
    const sql = fs.readFileSync(path.resolve(AKAR, argumen), 'utf8');
    const hasil = await jalan(sql);
    console.log(JSON.stringify(hasil === undefined ? 'ok' : hasil).slice(0, 2000));
  } else if (perintah === 'keys') {
    const daftar = await api(`/projects/${REF}/api-keys`);
    for (const kunci of daftar) {
      const nilai = kunci.value || '';
      if (!nilai) continue;
      const nama = kunci.name === 'service_role' ? 'SUPABASE_SERVICE_ROLE_KEY'
        : kunci.name === 'anon' ? 'SUPABASE_ANON_KEY' : null;
      if (!nama) continue;
      await tulisEnv(nama, nilai);
      console.log(`${nama}: ${nilai.slice(0, 8)}… (${nilai.length} karakter)`);
    }
    await tulisEnv('SUPABASE_URL', `https://${REF}.supabase.co`);
    console.log('SUPABASE_URL tersimpan');
  } else if (perintah === 'health') {
    const proyek = await api(`/projects/${REF}`);
    console.log(JSON.stringify({ ref: proyek.ref, name: proyek.name, region: proyek.region, status: proyek.status }, null, 2));
  } else {
    console.log('pakai: query | file <path> | keys | health');
  }
} catch (err) {
  console.error('GAGAL:', err.message);
  process.exitCode = 1;
}
