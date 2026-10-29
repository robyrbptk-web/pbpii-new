/**
 * Camera registry for PII Global View.
 *
 * Four public Indonesian ATCS packs are merged here:
 *   - Dishub DKI Jakarta via the cctv-jakarta dataset (locations only: the
 *     upstream stream host is offline, so no video URL is advertised),
 *   - Diskominfo Kota Bandung (PELINDUNG), Tasikmalaya ATCS and Dishub
 *     Kabupaten Bandung, which serve live HLS playlists.
 *
 * Every route (`/api/cctv/*`) reads the same cached catalog so the globe sees a
 * stable id space. Upstream hosts are never taken from the request: the only
 * URL a proxy fetches is the one this registry published for that camera id.
 */
import { createTtlCache } from './proxy.js';

const FETCH_TIMEOUT_MS = 15000;
const CATALOG_TTL_MS = 6 * 3600_000;
const USER_AGENT = 'pii-global-view/1.0 (+https://pbpii.or.id)';

const JAKARTA_DATA_URL = 'https://raw.githubusercontent.com/lakuapik/cctv-jakarta/master/data.json';
const BANDUNG_CITY_URL = 'https://pelindung.bandung.go.id:8443/api/cek';
const TASIK_URL = 'https://atcs.tasikmalayakota.go.id/';
const BANDUNGKAB_URL = 'https://dishub.bandungkab.go.id/cctv/';

const ANCHORS = {
  jakarta: { lat: -6.2088, lon: 106.8456 },
  bandung: { lat: -6.9175, lon: 107.6191 },
  tasikmalaya: { lat: -7.3274, lon: 108.2207 },
  bandungkab: { lat: -7.0241, lon: 107.5304 },
};

const DEFAULT_MAX = {
  jakarta: 400,
  bandung: 250,
  tasikmalaya: 80,
  bandungkab: 40,
};

const MAX_ENV = {
  jakarta: 'CCTV_JAKARTA_MAX_SOURCES',
  bandung: 'CCTV_BANDUNG_CITY_MAX_SOURCES',
  tasikmalaya: 'CCTV_TASIK_MAX_SOURCES',
  bandungkab: 'CCTV_BANDUNGKAB_MAX_SOURCES',
};

function maxFor(pack) {
  const raw = Number(process.env[MAX_ENV[pack]]);
  if (!Number.isFinite(raw)) return DEFAULT_MAX[pack];
  return Math.max(8, Math.min(600, Math.floor(raw)));
}

function numberValue(value, fallback = NaN) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function withinIndonesia(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon)
    && lat >= -11.5 && lat <= 6.5
    && lon >= 94.5 && lon <= 141.5;
}

/**
 * Dishub Jakarta publishes lat/lon the wrong way round for a handful of rows;
 * Indonesia never reaches those latitudes, so a swap is unambiguous.
 */
function orderedCoordinates(rawLat, rawLon) {
  if (withinIndonesia(rawLat, rawLon)) return { lat: rawLat, lon: rawLon };
  if (withinIndonesia(rawLon, rawLat)) return { lat: rawLon, lon: rawLat };
  return null;
}

function headingFromId(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) % 100003;
  return (hash % 16) * 22.5;
}

function distanceKm(lat1, lon1, lat2, lon2) {
  const toRad = (value) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function nearestTo(anchor, cameras, maxCount) {
  if (!Number.isFinite(maxCount) || maxCount <= 0 || cameras.length <= maxCount) return cameras;
  return cameras
    .map((camera, index) => ({
      camera,
      index,
      dist: distanceKm(camera.lat, camera.lon, anchor.lat, anchor.lon),
    }))
    .sort((a, b) => (a.dist - b.dist) || (a.index - b.index))
    .slice(0, maxCount)
    .map((entry) => entry.camera);
}

function titleCaseSlug(slug) {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => {
      // Acronyms, numbers and stream letters in Dishub labels (RPTRA, 001, A)
      // are already the right shape; only lowercase place names need casing.
      if (word.length === 1 || /^[A-Z0-9]+$/.test(word)) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ')
    .trim();
}

/**
 * `Bambu-Apus-001-MP-601170_2` is one stream of camera `…-001-MP-601170`, which
 * sits at site "Bambu Apus". The site index and stream suffix carry no display
 * value, so they are dropped from the label but kept in the id.
 */
function parseJakartaStream(url) {
  let path = '';
  try {
    path = decodeURIComponent(new URL(url).pathname || '');
  } catch {
    return null;
  }
  const segment = path.split('/').filter(Boolean)[0] || '';
  const base = segment.replace(/\.html$/i, '').replace(/_\d+$/, '');
  if (!base) return null;
  const name = titleCaseSlug(base
    .replace(/-MP-\d+$/i, '')
    .replace(/-\d{6}$/i, '')
    .replace(/-(?:00\d|\d{3})(?=\D|$)/i, ''));
  return { id: `id-jkt-${base.replace(/[^a-z0-9-]/gi, '').toLowerCase()}`, name: name || base };
}

async function fetchText(url, accept) {
  const response = await fetch(url, {
    headers: { Accept: accept, 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

/**
 * Dishub DKI Jakarta camera sites. The dataset only carries embed pages on
 * `cctv.balitower.co.id`, which does not answer from outside the city network,
 * so these are published as locations with no feed URL. The globe then paints
 * its own "no signal" placeholder instead of pretending a stream exists.
 */
async function loadJakartaSources() {
  try {
    const body = await fetchText(JAKARTA_DATA_URL, 'application/json');
    const json = body
      .replace(/^\s*var\s+datacctv\s*=\s*/, '')
      .replace(/;\s*$/, '')
      .replace(/,(\s*[}\]])/g, '$1');
    const collections = JSON.parse(json);
    const byId = new Map();

    for (const collection of Array.isArray(collections) ? collections : []) {
      for (const feature of collection?.features || []) {
        const props = feature?.properties;
        const stream = parseJakartaStream(props?.url || '');
        const coords = orderedCoordinates(
          numberValue(props?.location?.latitude),
          numberValue(props?.location?.longitude),
        );
        if (!stream || !coords) continue;
        if (byId.has(stream.id)) continue;
        byId.set(stream.id, {
          id: stream.id,
          name: stream.name,
          city: 'Jakarta',
          cityId: 'jakarta',
          provider: 'Dishub DKI Jakarta',
          lat: coords.lat,
          lon: coords.lon,
          headingDeg: headingFromId(stream.id),
          headingConfidence: 'low',
          pitchDeg: -18,
          fovDeg: 44,
          rangeM: 145,
          mountHeightM: 8,
          groundElevationM: 7,
          feedType: 'image',
          url: '',
          sourceKind: 'jakarta-dishub',
          license: 'Dishub DKI Jakarta public camera list (cctv-jakarta)',
        });
      }
    }

    const cameras = Array.from(byId.values());
    const capped = nearestTo(ANCHORS.jakarta, cameras, maxFor('jakarta'));
    console.log(`[CCTV] Jakarta sites: ${cameras.length} (serving ${capped.length})`);
    return capped;
  } catch (error) {
    console.warn('[CCTV] Jakarta catalog error:', error?.message || error);
    return [];
  }
}

function hlsSource({ id, name, lat, lon, streamUrl, city, cityId, provider, sourceKind, license, groundElevationM }) {
  if (!id || !name || !streamUrl) return null;
  if (!/^https:\/\/[^\s]+\.m3u8(\?[^\s]*)?$/i.test(streamUrl)) return null;
  if (!withinIndonesia(lat, lon)) return null;
  return {
    id,
    name,
    city,
    cityId,
    provider,
    lat,
    lon,
    headingDeg: headingFromId(id),
    headingConfidence: 'low',
    pitchDeg: -18,
    fovDeg: 44,
    rangeM: 145,
    mountHeightM: 8,
    groundElevationM,
    feedType: 'hls',
    url: streamUrl,
    sourceKind,
    license,
  };
}

async function loadBandungCitySources() {
  try {
    const rows = JSON.parse(await fetchText(BANDUNG_CITY_URL, 'application/json'));
    const cameras = [];
    for (const row of Array.isArray(rows) ? rows : []) {
      let streamUrl = String(row?.stream_cctv || '').trim();
      try {
        const parsed = new URL(streamUrl);
        // Rows without a port point at the web app; streams live on :3443.
        if (parsed.hostname === 'pelindung.bandung.go.id' && !parsed.port) {
          parsed.port = '3443';
          streamUrl = parsed.toString();
        }
      } catch { /* not a URL; hlsSource rejects it */ }
      const source = hlsSource({
        id: `id-bdg-${String(row?.id || '').replace(/[^a-z0-9-]/gi, '') || cameras.length}`,
        name: String(row?.cctv_name || '').trim(),
        lat: numberValue(row?.lat),
        lon: numberValue(row?.lng),
        streamUrl,
        city: 'Bandung',
        cityId: 'bandung',
        provider: 'Diskominfo Kota Bandung',
        sourceKind: 'bandung-city-cctv',
        license: 'Bandung City public CCTV (PELINDUNG)',
        groundElevationM: 768,
      });
      if (source) cameras.push(source);
    }
    const capped = nearestTo(ANCHORS.bandung, cameras, maxFor('bandung'));
    console.log(`[CCTV] Bandung city: ${cameras.length} HLS (serving ${capped.length})`);
    return capped;
  } catch (error) {
    console.warn('[CCTV] Bandung city error:', error?.message || error);
    return [];
  }
}

async function loadTasikmalayaSources() {
  try {
    const html = await fetchText(TASIK_URL, 'text/html');
    const match = /var\s+cctv\s*=\s*(\{[\s\S]*?\})\s*;\s*(?:var|<\/script>)/.exec(html);
    if (!match) return [];
    const catalog = JSON.parse(match[1]);
    const cameras = [];
    for (const row of Object.values(catalog)) {
      const source = hlsSource({
        id: `id-tsk-${String(row?.id || '').replace(/[^a-z0-9-]/gi, '') || cameras.length}`,
        name: String(row?.nama || '').trim(),
        lat: numberValue(row?.lokasi_lat),
        lon: numberValue(row?.lokasi_lng),
        streamUrl: String(row?.link || '').trim(),
        city: 'Tasikmalaya',
        cityId: 'tasikmalaya',
        provider: 'ATCS Kota Tasikmalaya',
        sourceKind: 'tasikmalaya-atcs',
        license: 'ATCS Kota Tasikmalaya public stream',
        groundElevationM: 350,
      });
      if (source) cameras.push(source);
    }
    const capped = nearestTo(ANCHORS.tasikmalaya, cameras, maxFor('tasikmalaya'));
    console.log(`[CCTV] Tasikmalaya: ${cameras.length} HLS (serving ${capped.length})`);
    return capped;
  } catch (error) {
    console.warn('[CCTV] Tasikmalaya error:', error?.message || error);
    return [];
  }
}

async function loadBandungKabSources() {
  try {
    const html = await fetchText(BANDUNGKAB_URL, 'text/html');
    const byId = new Map();
    const pattern = /\{\s*id:\s*(\d+),\s*name:\s*"((?:[^"\\]|\\.)*)",\s*code:\s*"((?:[^"\\]|\\.)*)",\s*coordinates:\s*\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\],\s*streamUrl:\s*"((?:[^"\\]|\\.)*)"/g;
    let match;
    while ((match = pattern.exec(html)) !== null) {
      const [, rawId, rawName, rawCode, rawLat, rawLon, rawUrl] = match;
      const streamUrl = rawUrl.replace(/\\\//g, '/').trim();
      // The page lists every camera twice; the tokenless copy answers
      // "Not Authorized", so only the tokenized rows are kept.
      if (/^https?:\/\/cctv\.bandungkab\.go\.id\//i.test(streamUrl) && !/[?&]api=/.test(streamUrl)) continue;
      const source = hlsSource({
        id: `id-bdgkab-${rawId}`,
        name: `${rawName.trim()}${rawCode ? ` (${rawCode})` : ''}`,
        lat: numberValue(rawLat),
        lon: numberValue(rawLon),
        streamUrl,
        city: 'Kabupaten Bandung',
        cityId: 'bandung-kabupaten',
        provider: 'Dishub Kabupaten Bandung',
        sourceKind: 'bandungkab-dishub',
        license: 'Dishub Kabupaten Bandung public stream',
        groundElevationM: 700,
      });
      if (source && !byId.has(source.id)) byId.set(source.id, source);
    }
    const cameras = Array.from(byId.values());
    const capped = nearestTo(ANCHORS.bandungkab, cameras, maxFor('bandungkab'));
    console.log(`[CCTV] Kabupaten Bandung: ${cameras.length} HLS (serving ${capped.length})`);
    return capped;
  } catch (error) {
    console.warn('[CCTV] Kabupaten Bandung error:', error?.message || error);
    return [];
  }
}

async function buildCatalog() {
  const packs = await Promise.all([
    loadJakartaSources(),
    loadBandungCitySources(),
    loadTasikmalayaSources(),
    loadBandungKabSources(),
  ]);
  const seen = new Set();
  const sources = [];
  for (const source of packs.flat()) {
    if (!source?.id || seen.has(source.id)) continue;
    seen.add(source.id);
    sources.push(source);
  }
  return sources;
}

const catalogCache = createTtlCache(CATALOG_TTL_MS);

/** All cameras advertised to the globe. */
export async function getSources() {
  const { value } = await catalogCache.get(buildCatalog);
  return value;
}

/**
 * Registry lookup used by the media/frame proxies. Jakarta ids never reach the
 * network: they have no URL, so the answer is known without loading a catalog.
 */
export async function findSource(id) {
  const wanted = String(id || '').trim();
  if (!wanted) return null;
  if (wanted.startsWith('id-jkt-')) {
    return { id: wanted, city: 'Jakarta', provider: 'Dishub DKI Jakarta', feedType: 'image', url: '', sourceKind: 'jakarta-dishub' };
  }
  const sources = await getSources();
  return sources.find((source) => source.id === wanted) || null;
}

const VIDEO_TYPES = new Set(['mp4', 'hls', 'webm']);

export function normalizeFeedType(value) {
  const type = String(value || '').toLowerCase();
  if (type === 'jpg' || type === 'jpeg' || type === 'png') return 'image';
  if (type === 'mjpg') return 'mjpeg';
  if (type === 'video') return 'mp4';
  if (type === 'stream') return 'hls';
  if (['image', 'mjpeg', 'mp4', 'hls', 'webm', 'none'].includes(type)) return type;
  return 'image';
}

export function isVideoFeedType(feedType) {
  return VIDEO_TYPES.has(feedType);
}

/**
 * Rewrite playlist references so HLS.js fetches them back through this proxy.
 * Only same-origin URIs are rewritten; nothing here accepts a host from the
 * client.
 */
export function rewriteHlsPlaylist(playlist, baseUrl, cameraId) {
  const base = new URL(baseUrl);
  const proxyUri = (ref) => {
    try {
      const absolute = new URL(ref, base);
      if (absolute.origin !== base.origin) return absolute.toString();
      return `/api/cctv/media/${encodeURIComponent(cameraId)}?seg=${encodeURIComponent(absolute.toString())}`;
    } catch {
      return ref;
    }
  };
  return String(playlist || '')
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith('#')) {
        return line.replace(/URI="([^"]+)"/g, (_, ref) => `URI="${proxyUri(ref)}"`);
      }
      return proxyUri(trimmed);
    })
    .join('\n');
}
