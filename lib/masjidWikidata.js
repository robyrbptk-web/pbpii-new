/**
 * Sumber masjid Wikidata untuk lib/masjidNearby.js.
 *
 * Dipakai hanya bila semua mirror Overpass tidak menjawab. Basis datanya jauh lebih
 * tipis — cuma rumah ibadah yang punya entri Wikidata — jadi daftar kosong di sini
 * berarti "belum tercatat", bukan "fitur rusak".
 */

const SPARQL = 'https://query.wikidata.org/sparql';
const MOSQUE = 'Q32815';
const UPSTREAM_TIMEOUT_MS = 9_000;
const KM_PER_DEGREE = 111;
const USER_AGENT = 'pbpii-website/1.0';

/**
 * Kotak pencarian sudut-ke-sudut. Semua angka dibulatkan lebih dulu sehingga tidak ada
 * teks dari browser yang pernah masuk ke badan kueri.
 */
function query(lat, lon, radiusKm) {
  const dLat = radiusKm / KM_PER_DEGREE;
  const dLon = radiusKm / (KM_PER_DEGREE * Math.max(0.05, Math.cos((lat * Math.PI) / 180)));
  return [
    'SELECT ?item ?nama ?kota ?coord WHERE {',
    '  SERVICE wikibase:box {',
    '    ?item wdt:P625 ?coord.',
    `    bd:serviceParam wikibase:cornerSouthWest "Point(${(lon - dLon).toFixed(5)} ${(lat - dLat).toFixed(5)})"^^geo:wktLiteral.`,
    `    bd:serviceParam wikibase:cornerNorthEast "Point(${(lon + dLon).toFixed(5)} ${(lat + dLat).toFixed(5)})"^^geo:wktLiteral.`,
    '  }',
    `  ?item wdt:P31 wd:${MOSQUE}.`,
    '  OPTIONAL { ?item wdt:P131 ?wilayah. ?wilayah rdfs:label ?kota FILTER(LANG(?kota)="id") }',
    '  SERVICE wikibase:label { bd:serviceParam wikibase:language "id,en". ?item rdfs:label ?nama. }',
    '} LIMIT 200',
  ].join('\n');
}

function ubahBinding(binding) {
  const sumbu = /Point\(\s*(-?[\d.]+)[\s,]+(-?[\d.]+)\s*\)/i.exec(binding?.coord?.value || '');
  if (!sumbu) return null;
  const lon = Number(sumbu[1]);
  const lat = Number(sumbu[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const nama = String(binding?.nama?.value || '').trim();
  return {
    name: nama || 'Masjid atau musala (belum bernama di Wikidata)',
    address: String(binding?.kota?.value || '').trim(),
    lat,
    lon,
  };
}

/** `radius` dalam meter, `point` {lat, lon} — mengembalikan baris mentah {name, address, lat, lon}. */
export async function cariWikidata(radius, point) {
  const url = `${SPARQL}?query=${encodeURIComponent(query(point.lat, point.lon, radius / 1000))}&format=json`;
  const response = await fetch(url, {
    headers: { Accept: 'application/sparql-results+json', 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json().catch(() => null);
  const bindings = body?.results?.bindings;
  if (!Array.isArray(bindings)) throw new Error('Tidak ada hasil');
  return bindings.map(ubahBinding).filter(Boolean);
}
