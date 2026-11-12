/** Rebuild lib/cctv-seed.js from the live Jakarta and BPJT catalogs.
 * Vercel's sin1 egress is blocked by Cloudflare on both catalog hosts, while
 * the camera media hosts themselves answer normally. Run this from a network
 * that can reach the catalogs, then commit the regenerated seed.
 */
import { writeFileSync } from 'node:fs';

import { parseJakartaPage, parseBpjtRegistry } from '../lib/cctv.js';

const JAKARTA = 'https://jakcctv.jakarta.go.id/publik/data';
const BPJT = 'https://bpjt.pu.go.id/cctv/';
const UA = { 'User-Agent': 'pii-global-view/1.0', Accept: '*/*' };

async function text(url) {
  const response = await fetch(url, { headers: UA, signal: AbortSignal.timeout(25000) });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.text();
}

const jakarta = [];
for (let page = 1; page <= 8; page++) {
  const payload = JSON.parse(await text(`${JAKARTA}?q=&page=${page}`));
  const cards = parseJakartaPage(payload);
  jakarta.push(...cards);
  if (!cards.length) break;
}

const bpjt = parseBpjtRegistry(await text(BPJT));

const packs = [
  {
    sourceKind: 'jakarta-public',
    registryUrl: JAKARTA,
    defaults: {
      city: 'Jakarta', cityId: 'jakarta',
      provider: 'Pemprov DKI Jakarta / Bali Tower',
      license: 'JakCCTV public viewing feed; operator rights retained',
      groundElevationM: 7,
    },
    cameras: jakarta.slice(0, 64).map(camera => ({
      id: camera.id, name: camera.name, url: camera.url,
      ...(camera.lat === undefined ? {} : { lat: camera.lat, lon: camera.lon }),
      ...(camera.embedUrl ? { embedUrl: camera.embedUrl } : {}),
    })),
  },
  {
    sourceKind: 'bpjt-public',
    registryUrl: BPJT,
    defaults: {
      license: 'BPJT public viewing feed; operator rights retained',
    },
    cameras: bpjt.slice(0, 400).map(camera => ({
      id: camera.id, name: camera.name, url: camera.url,
      lat: camera.lat, lon: camera.lon,
      city: camera.city, cityId: camera.cityId, provider: camera.provider,
    })),
  },
];

const harvestedAt = new Date().toISOString();
const lines = [
  '/** Fallback catalog for operators whose registry pages block server egress.',
  ' * Regenerate with scratch/harvest-cctv-seed.mjs from a reachable network;',
  ' * every row is re-validated by hlsSource() at load time, so a malformed or',
  ' * off-origin entry is dropped rather than trusted.',
  ' */',
  'export const CCTV_SEED = {',
  `  harvestedAt: ${JSON.stringify(harvestedAt)},`,
  '  packs: [',
];
for (const pack of packs) {
  lines.push('    {');
  lines.push(`      sourceKind: ${JSON.stringify(pack.sourceKind)},`);
  lines.push(`      registryUrl: ${JSON.stringify(pack.registryUrl)},`);
  lines.push(`      defaults: ${JSON.stringify(pack.defaults)},`);
  lines.push('      cameras: [');
  for (const camera of pack.cameras) lines.push(`        ${JSON.stringify(camera)},`);
  lines.push('      ],');
  lines.push('    },');
}
lines.push('  ],', '};', '');

writeFileSync(new URL('../lib/cctv-seed.js', import.meta.url), lines.join('\n'));
console.log(`jakarta ${jakarta.length}, bpjt ${bpjt.length} -> ${new URL('../lib/cctv-seed.js', import.meta.url).pathname}`);
