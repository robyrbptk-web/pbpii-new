/**
 * Sumber masjid OpenStreetMap untuk lib/masjidNearby.js.
 *
 * Kueri Overpass disusun di sini dari angka hasil validasi — browser tidak pernah
 * mengirim teks kueri. Mirror dirotasi karena satu mirror sering sedang sibuk.
 */

const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
];
const MIRROR_TIMEOUT_MS = 5_000;
/** Batas total semua percobaan mirror, supaya jawaban galat datang sebelum browser menyerah. */
const TOTAL_DEADLINE_MS = 9_000;
const MAX_ELEMENTS = 60;
const USER_AGENT = 'pbpii-website/1.0';

function query(radius, lat, lon) {
  return [
    '[out:json][timeout:5];',
    '(',
    `node["amenity"="place_of_worship"]["religion"="muslim"](around:${radius},${lat},${lon});`,
    `way["amenity"="place_of_worship"]["religion"="muslim"](around:${radius},${lat},${lon});`,
    ');',
    `out center ${MAX_ELEMENTS};`,
  ].join('\n');
}

function ubahElement(element) {
  const tags = element.tags || {};
  const titik = element.center || element;
  const lat = Number(titik.lat);
  const lon = Number(titik.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const name = tags.name || tags['name:id'] || tags.alt_name || '';
  const address = [tags['addr:street'], tags['addr:city']]
    .filter((part) => typeof part === 'string' && part.trim())
    .join(', ');
  return { name: name || 'Masjid atau musala (belum bernama di peta)', address, lat, lon };
}

async function jalan(body) {
  let lastError = null;
  const deadlineAt = Date.now() + TOTAL_DEADLINE_MS;
  for (const endpoint of MIRRORS) {
    const remaining = deadlineAt - Date.now();
    if (remaining < 2_000) {
      lastError = lastError || new Error('Waktu mirror habis');
      break;
    }
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': USER_AGENT,
          Accept: 'application/json',
        },
        body,
        signal: AbortSignal.timeout(Math.min(MIRROR_TIMEOUT_MS, remaining)),
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed?.elements)) throw new Error('Tidak ada elemen');
      return parsed.elements;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Semua mirror Overpass gagal');
}

/** `radius` dalam meter, `point` {lat, lon} — mengembalikan baris mentah {name, address, lat, lon}. */
export async function cariOverpass(radius, point) {
  const elements = await jalan(`data=${encodeURIComponent(query(radius, point.lat, point.lon))}`);
  return elements.map(ubahElement).filter(Boolean);
}
