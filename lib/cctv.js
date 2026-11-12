/** Public Indonesian CCTV registry and bounded, same-camera HLS transport.
 * Coordinates come from operators, never from guessed city centres. Jakarta's
 * public cards currently omit coordinates: these sources omit lat/lon (NOT
 * null, which the globe coerces to zero) and remain usable by the room player.
 */
import { createHash } from 'node:crypto';

const CATALOG_TTL_MS = 6 * 3600_000;
// A catalog missing an operator is served for minutes, not hours, so the next
// request can fill the gap instead of freezing a partial list for the day.
const PARTIAL_CATALOG_TTL_MS = 10 * 60_000;
const USER_AGENT = 'pii-global-view/1.0';
const JAKARTA_DATA_URL = 'https://jakcctv.jakarta.go.id/publik/data';
const BPJT_URL = 'https://bpjt.pu.go.id/cctv/';
const BANDUNG_CITY_URL = 'https://pelindung.bandung.go.id:8443/api/cek';
const TASIK_URL = 'https://atcs.tasikmalayakota.go.id/';
const BANDUNGKAB_URL = 'https://dishub.bandungkab.go.id/cctv/';
const JAKARTA_ORIGIN = 'https://dki-jkt.balitower.co.id:7028';
const BPJT_ORIGINS = new Set([
  'https://cctv.citramarga.com', 'https://camera.jtd.co.id',
  'https://pub2.hk-opt.com', 'https://pub.hk-opt.com',
  'https://info.serbaraja-tollroad.co.id:20443', 'https://cctv.cms.co.id',
  'https://live.pbtr.co.id:5443', 'https://cctv.hmwtoll.com',
]);
const PACK_ORIGINS = {
  'jakarta-public': new Set([JAKARTA_ORIGIN]),
  'bpjt-public': BPJT_ORIGINS,
  'bandung-city-cctv': new Set(['https://pelindung.bandung.go.id:3443']),
  'tasikmalaya-atcs': new Set(['https://atcs.tasikmalayakota.go.id']),
  'bandungkab-dishub': new Set(['https://cctv.bandungkab.go.id']),
};
const MEDIA_ORIGINS = new Set(Object.values(PACK_ORIGINS).flatMap(set => [...set]));
export const CAMERA_ID_PATTERN = /^id-[a-z0-9_-]{2,96}$/i;
export const MAX_MEDIA_BYTES = 4_000_000; // Below Vercel's 4.5 MB response limit.
const MAX_PLAYLIST_BYTES = 128_000;
const MAX_CATALOG_BYTES = 3_000_000;
const MAX_JAKARTA_PAGES = 8; // Public endpoint serves eight cameras per page.
const MAX_PROBES = 19;
const ANCHORS = {
  bandung: { lat: -6.9175, lon: 107.6191 },
  tasikmalaya: { lat: -7.3274, lon: 108.2207 },
  bandungkab: { lat: -7.0241, lon: 107.5304 },
};
const LIMITS = {
  jakarta: [64, 'CCTV_JAKARTA_MAX_SOURCES'],
  bpjt: [400, 'CCTV_BPJT_MAX_SOURCES'],
  bandung: [250, 'CCTV_BANDUNG_CITY_MAX_SOURCES'],
  tasikmalaya: [80, 'CCTV_TASIK_MAX_SOURCES'],
  bandungkab: [40, 'CCTV_BANDUNGKAB_MAX_SOURCES'],
};
function maxFor(pack) {
  const [fallback, key] = LIMITS[pack];
  const raw = Number(process.env[key]);
  return Number.isFinite(raw) && raw > 0 ? Math.max(8, Math.min(fallback, Math.floor(raw))) : fallback;
}
function numberValue(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return NaN;
  const text = String(value).trim();
  // A single decimal comma is unambiguous. Never guess missing decimal places,
  // signs, coordinate systems, or malformed values such as 631972.0.
  if (!/^-?\d+(?:[.,]\d+)?$/.test(text)) return NaN;
  return Number(text.replace(',', '.'));
}
function withinIndonesia(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon)
    && lat >= -11.5 && lat <= 6.5 && lon >= 94.5 && lon <= 141.5;
}
function orderedCoordinates(rawLat, rawLon) {
  const lat = numberValue(rawLat), lon = numberValue(rawLon);
  if (withinIndonesia(lat, lon)) return { lat, lon };
  if (withinIndonesia(lon, lat)) return { lat: lon, lon: lat };
  return null;
}
function headingFromId(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) % 100003;
  return (hash % 16) * 22.5;
}
function stableId(pack, key) {
  const slug = String(key).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 62);
  const digest = createHash('sha256').update(String(key)).digest('hex').slice(0, 12);
  return `id-${pack}-${slug}-${digest}`;
}
function nearestTo(anchor, cameras, maxCount) {
  if (cameras.length <= maxCount) return cameras;
  const rad = value => value * Math.PI / 180;
  const distance = c => Math.sin(rad(c.lat - anchor.lat) / 2) ** 2
    + Math.cos(rad(anchor.lat)) * Math.cos(rad(c.lat)) * Math.sin(rad(c.lon - anchor.lon) / 2) ** 2;
  return cameras.slice().sort((a, b) => distance(a) - distance(b) || a.id.localeCompare(b.id)).slice(0, maxCount);
}

/** Exact origins, HTTPS, no URL credentials, fragments or ambiguous paths. */
function publicUrl(value, origins = MEDIA_ORIGINS) {
  if (typeof value !== 'string' || /[\s\\\x00-\x1f\x7f]/.test(value)) return null;
  try {
    const url = new URL(value);
    const decodedPath = decodeURIComponent(url.pathname);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash
      || !origins.has(url.origin) || /[%\\\x00-\x1f\x7f]/.test(decodedPath)
      || /%2f|%5c/i.test(url.pathname)) return null;
    return url;
  } catch { return null; }
}
export function isAllowedStreamUrl(value, sourceKind) {
  if (sourceKind && !PACK_ORIGINS[sourceKind]) return false;
  const url = publicUrl(value, sourceKind ? PACK_ORIGINS[sourceKind] : MEDIA_ORIGINS);
  return !!url && /\.m3u8$/i.test(url.pathname);
}

/** Bind each child URI to the ORIGINAL registered camera, not a variant's
 * directory. Flat-file servers additionally require the camera filename stem.
 */
export function resolveCameraMediaUrl(reference, playlistUrl, registeredUrl = playlistUrl) {
  const root = publicUrl(registeredUrl);
  const base = publicUrl(playlistUrl);
  if (!root || !base || root.origin !== base.origin || /[\\\x00-\x1f\x7f]/.test(String(reference))) {
    throw new Error('Disallowed camera URL');
  }
  const target = publicUrl(new URL(reference, base).toString());
  if (!target || target.origin !== root.origin) throw new Error('Disallowed media origin');
  const directory = root.pathname.slice(0, root.pathname.lastIndexOf('/') + 1);
  if (!target.pathname.startsWith(directory)) throw new Error('Media outside camera path');
  const relative = target.pathname.slice(directory.length);
  const stem = root.pathname.slice(directory.length).replace(/\.m3u8$/i, '');
  const flat = directory === '/camera/' || /^\/video\/[^/]+\/$/.test(directory)
    || directory === '/LiveApp/streams/';
  if (flat && relative !== `${stem}.m3u8`) {
    const suffix = relative.startsWith(stem) ? relative.slice(stem.length) : '';
    if (!suffix || !/^(?:\d|[-_./])/.test(suffix)) throw new Error('Media belongs to another camera');
  }
  if (!/\.(?:m3u8|ts|m4s|mp4|aac|key|bin)$/i.test(target.pathname)) throw new Error('Not an HLS resource');
  return target.toString();
}

export async function readBoundedBody(response, maxBytes = MAX_MEDIA_BYTES) {
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel();
    throw new Error('Upstream body exceeds byte limit');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty upstream body');
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error('Upstream body exceeds byte limit');
      chunks.push(Buffer.from(value));
    }
    if (!size) throw new Error('Empty upstream body');
    return Buffer.concat(chunks, size);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

// Bound aggregate catalog/probe concurrency, including response bodies. Six
// slots keep the five operator catalogs moving over long-haul links without
// letting the page fan out unchecked.
let activeRequests = 0;
const requestQueue = [];
async function withRequestSlot(run) {
  if (activeRequests >= 6) await new Promise(resolve => requestQueue.push(resolve));
  else activeRequests++;
  try { return await run(); } finally {
    const next = requestQueue.shift();
    if (next) next(); else activeRequests--;
  }
}
async function fetchResource(url, { maxBytes, signal, range, timeoutMs = 12000 } = {}) {
  return withRequestSlot(async () => {
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    combined.throwIfAborted();
    const headers = { 'User-Agent': USER_AGENT, Accept: '*/*' };
    if (range) headers.Range = range;
    const response = await fetch(url, { headers, redirect: 'manual', signal: combined });
    // No redirects at all: even same-origin redirects can change camera scope.
    if (!response.ok || response.redirected || (response.url && response.url !== url)) {
      await response.body?.cancel();
      throw new Error(`Upstream HTTP ${response.status} or redirect`);
    }
    const playlist = response.headers.get('content-type')?.includes('mpegurl') || /\.m3u8$/i.test(new URL(url).pathname);
    const limit = Math.min(maxBytes || MAX_MEDIA_BYTES, playlist ? MAX_PLAYLIST_BYTES : MAX_MEDIA_BYTES);
    return { body: await readBoundedBody(response, limit), headers: response.headers, status: response.status, url };
  });
}
export async function fetchCameraMedia(url, registeredUrl, options = {}) {
  const target = resolveCameraMediaUrl(url, registeredUrl, registeredUrl);
  return fetchResource(target, options);
}
async function fetchText(url, signal) {
  return (await fetchResource(url, { maxBytes: MAX_CATALOG_BYTES, signal, timeoutMs: 15000 })).body.toString('utf8');
}
async function mapBounded(items, concurrency, callback) {
  const result = new Array(items.length);
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const current = index++;
      result[current] = await callback(items[current], current);
    }
  }));
  return result;
}
function decodeHtml(text) {
  return String(text).replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[0-9a-f]+);/gi, entity => {
    const named = { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' };
    if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
    const code = entity[2].toLowerCase() === 'x' ? parseInt(entity.slice(3), 16) : parseInt(entity.slice(2), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  });
}
function hlsSource({ id, name, lat, lon, streamUrl, city, cityId, provider, sourceKind, license, groundElevationM, allowUnlocated = false }) {
  if (!CAMERA_ID_PATTERN.test(id) || !name || !isAllowedStreamUrl(streamUrl, sourceKind)) return null;
  const coordinates = orderedCoordinates(lat, lon);
  if (!coordinates && !allowUnlocated) return null;
  return {
    id, name, city, cityId, provider,
    ...(coordinates || {}),
    locationStatus: coordinates ? 'operator-provided' : 'not-published',
    headingDeg: headingFromId(id), headingConfidence: 'low', pitchDeg: -18,
    fovDeg: 44, rangeM: 145, mountHeightM: 8, groundElevationM,
    feedType: 'hls', url: streamUrl, sourceKind, license,
    verification: { status: 'unchecked', checkedAt: null, verifiedAt: null },
  };
}

/** Parse only public iframe cards; never fetch protected/private camera APIs. */
export function parseJakartaPage(payload) {
  if (!payload || typeof payload.cards !== 'string') return [];
  const cameras = [];
  const cards = payload.cards.split(/<div\b[^>]*class=["']card["'][^>]*>/i).slice(1, 9);
  for (const card of cards) {
    const rawSrc = /<iframe\b[^>]*\bsrc=["']([^"']+)["']/i.exec(card)?.[1];
    const embed = publicUrl(decodeHtml(rawSrc || ''), PACK_ORIGINS['jakarta-public']);
    if (!embed || !/^\/[^/]+\/embed\.html$/.test(embed.pathname)) continue;
    const streamKey = embed.pathname.split('/')[1];
    const identity = /^(\d+)_.*_CCTV-(\d+)$/i.exec(streamKey);
    const id = identity ? `id-jkt-${identity[1]}-${identity[2]}` : stableId('jkt', streamKey);
    const title = /class=["']title["'][^>]*>([^<]*)</i.exec(card)?.[1];
    const badge = /class=["']badge["'][^>]*>([^<]*)</i.exec(card)?.[1];
    const source = hlsSource({
      id, name: decodeHtml([title, badge].filter(Boolean).join(' ')) || streamKey,
      // Consume explicit official attributes if supplied in future responses.
      lat: /\bdata-lat=["']([^"']+)["']/i.exec(card)?.[1],
      lon: /\bdata-lon=["']([^"']+)["']/i.exec(card)?.[1],
      streamUrl: new URL('index.m3u8', embed).toString(),
      city: 'Jakarta', cityId: 'jakarta', provider: 'Pemprov DKI Jakarta / Bali Tower',
      sourceKind: 'jakarta-public', license: 'JakCCTV public viewing feed; operator rights retained',
      groundElevationM: 7, allowUnlocated: true,
    });
    if (source) cameras.push({ ...source, embedUrl: embed.toString(), registryUrl: JAKARTA_DATA_URL });
  }
  return cameras;
}
async function loadJakartaSources(signal) {
  const first = JSON.parse(await fetchText(`${JAKARTA_DATA_URL}?q=&page=1`, signal));
  const pages = Math.min(MAX_JAKARTA_PAGES, Math.ceil(maxFor('jakarta') / 8), Math.max(1, Math.ceil(numberValue(first.total) / 8) || 1));
  const rest = await mapBounded(Array.from({ length: pages - 1 }, (_, i) => i + 2), 4, async page => {
    try { return parseJakartaPage(JSON.parse(await fetchText(`${JAKARTA_DATA_URL}?q=&page=${page}`, signal))); }
    catch (error) { console.warn(`[CCTV] Jakarta page ${page}: ${error.message}`); return []; }
  });
  return [...parseJakartaPage(first), ...rest.flat()].slice(0, maxFor('jakarta'));
}

/** Extract the JSON assignment without evaluating any upstream JavaScript. */
export function parseBpjtRegistry(html) {
  const assignment = /\b(?:const|let|var)\s+allStreams\s*=\s*/.exec(html);
  if (!assignment) return [];
  const start = assignment.index + assignment[0].length;
  let depth = 0, quoted = false, escaped = false, end = start;
  for (; end < html.length; end++) {
    const char = html[end];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === '{' || char === '[') depth++;
    else if ((char === '}' || char === ']') && --depth === 0) { end++; break; }
  }
  let groups;
  try { groups = JSON.parse(html.slice(start, end)); } catch { return []; }
  const rows = Array.isArray(groups) ? groups : Object.values(groups || {}).flat();
  const seen = new Set(), cameras = [];
  for (const row of rows.slice(0, 2500)) {
    const streamUrl = String(row?.streamhls || '').trim();
    if (!isAllowedStreamUrl(streamUrl, 'bpjt-public')) continue;
    const parsed = new URL(streamUrl);
    if (seen.has(parsed.origin + parsed.pathname)) continue;
    const source = hlsSource({
      id: stableId('bpjt', `${row.id_ruas || 'tol'}-${row.unique_id || parsed.pathname}`),
      name: [row.nama_ruas, row.nama_segment, row.nama_km].filter(v => v && v !== '0').join(' — '),
      lat: row.lat, lon: row.lon, streamUrl,
      city: String(row.nama_ruas || 'Jalan Tol Indonesia'), cityId: `tol-${String(row.id_ruas || 'indonesia').replace(/[^a-z0-9-]/gi, '')}`,
      provider: `BPJT / ${String(row.bujt || 'Operator jalan tol')}`,
      sourceKind: 'bpjt-public', license: 'BPJT public viewing feed; operator rights retained',
    });
    if (source) { seen.add(parsed.origin + parsed.pathname); cameras.push({ ...source, registryUrl: BPJT_URL }); }
  }
  return cameras;
}
async function loadBpjtSources(signal) {
  return parseBpjtRegistry(await fetchText(BPJT_URL, signal)).slice(0, maxFor('bpjt'));
}
async function loadBandungCitySources(signal) {
  const rows = JSON.parse(await fetchText(BANDUNG_CITY_URL, signal));
  const cameras = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    let streamUrl = String(row?.stream_cctv || '').trim();
    try {
      const parsed = new URL(streamUrl);
      if (parsed.hostname === 'pelindung.bandung.go.id' && !parsed.port) { parsed.port = '3443'; streamUrl = parsed.toString(); }
    } catch { continue; }
    const source = hlsSource({
      id: `id-bdg-${String(row?.id || '').replace(/[^a-z0-9-]/gi, '')}`,
      name: String(row?.cctv_name || '').trim(), lat: row?.lat, lon: row?.lng, streamUrl,
      city: 'Bandung', cityId: 'bandung', provider: 'Diskominfo Kota Bandung',
      sourceKind: 'bandung-city-cctv', license: 'Bandung City public CCTV (PELINDUNG)', groundElevationM: 768,
    });
    if (source) cameras.push(source);
  }
  return nearestTo(ANCHORS.bandung, cameras, maxFor('bandung'));
}
async function loadTasikmalayaSources(signal) {
  const html = await fetchText(TASIK_URL, signal);
  const match = /var\s+cctv\s*=\s*(\{[\s\S]*?\})\s*;\s*(?:var|<\/script>)/.exec(html);
  if (!match) return [];
  const cameras = [];
  for (const row of Object.values(JSON.parse(match[1]))) {
    const source = hlsSource({
      id: `id-tsk-${String(row?.id || '').replace(/[^a-z0-9-]/gi, '')}`,
      name: String(row?.nama || '').trim(), lat: row?.lokasi_lat, lon: row?.lokasi_lng,
      streamUrl: String(row?.link || '').trim(), city: 'Tasikmalaya', cityId: 'tasikmalaya',
      provider: 'ATCS Kota Tasikmalaya', sourceKind: 'tasikmalaya-atcs',
      license: 'ATCS Kota Tasikmalaya public stream', groundElevationM: 350,
    });
    if (source) cameras.push(source);
  }
  return nearestTo(ANCHORS.tasikmalaya, cameras, maxFor('tasikmalaya'));
}
export function parseBandungKabRegistry(html) {
  const byId = new Map();
  const pattern = /\{\s*id:\s*(\d+),\s*name:\s*"((?:[^"\\]|\\.)*)",\s*code:\s*"((?:[^"\\]|\\.)*)",\s*coordinates:\s*\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\],\s*streamUrl:\s*"((?:[^"\\]|\\.)*)"/g;
  for (const match of html.matchAll(pattern)) {
    const [, rawId, rawName, rawCode, lat, lon, rawUrl] = match;
    const source = hlsSource({
      id: `id-bdgkab-${rawId}`, name: `${rawName.trim()}${rawCode ? ` (${rawCode})` : ''}`,
      lat, lon, streamUrl: rawUrl.replace(/\\\//g, '/').trim(),
      city: 'Kabupaten Bandung', cityId: 'bandung-kabupaten', provider: 'Dishub Kabupaten Bandung',
      sourceKind: 'bandungkab-dishub', license: 'Dishub Kabupaten Bandung public stream', groundElevationM: 700,
    });
    // Current official page uses public path tokens, not ?api=. Keep both
    // formats; if it publishes duplicates prefer the explicit API-query copy.
    if (source && (!byId.has(source.id) || /[?&]api=/.test(source.url))) byId.set(source.id, source);
  }
  return [...byId.values()];
}
async function loadBandungKabSources(signal) {
  return nearestTo(ANCHORS.bandungkab, parseBandungKabRegistry(await fetchText(BANDUNGKAB_URL, signal)), maxFor('bandungkab'));
}

/** Rewrite variants, segments, keys and initialization maps. Fail closed rather
 * than leaking a cross-origin URI to the browser. The fourth argument preserves
 * the original camera boundary when rewriting a nested variant.
 */
export function rewriteHlsPlaylist(playlist, baseUrl, cameraId, registeredUrl = baseUrl) {
  if (!CAMERA_ID_PATTERN.test(cameraId) || !String(playlist).trimStart().startsWith('#EXTM3U')) throw new Error('Invalid HLS playlist');
  const proxyUri = ref => `/api/cctv/media/${encodeURIComponent(cameraId)}?seg=${encodeURIComponent(resolveCameraMediaUrl(ref, baseUrl, registeredUrl))}`;
  const rewritten = String(playlist).split(/\r?\n/).map(line => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (!trimmed.startsWith('#')) return proxyUri(trimmed);
    if (/URI\s*=/i.test(line) && !/\bURI="[^"]+"/.test(line)) throw new Error('Invalid HLS URI attribute');
    return line.replace(/\bURI="([^"]+)"/g, (_, ref) => `URI="${proxyUri(ref)}"`);
  }).join('\n');
  if (Buffer.byteLength(rewritten) > MAX_MEDIA_BYTES) throw new Error('Rewritten playlist exceeds byte limit');
  return rewritten;
}

/** One bounded sample = at most three playlists and one nonempty media segment.
 * This establishes transport availability, NOT successful browser decoding.
 */
export async function verifyHlsSource(source, { signal } = {}) {
  const checkedAt = new Date().toISOString();
  const combined = signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000);
  try {
    let url = source.url;
    for (let depth = 0; depth < 3; depth++) {
      const resource = await fetchCameraMedia(url, source.url, { signal: combined });
      const playlist = resource.body.toString('utf8');
      rewriteHlsPlaylist(playlist, url, source.id, source.url);
      const refs = playlist.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
      if (!refs.length) throw new Error('Playlist has no media references');
      if (/#EXT-X-STREAM-INF:/.test(playlist)) {
        url = resolveCameraMediaUrl(refs[0], url, source.url);
        continue;
      }
      if (!/#EXTINF:/.test(playlist)) throw new Error('Playlist has no media segments');
      // Most recent complete segment is less likely to expire during the probe.
      const segmentUrl = resolveCameraMediaUrl(refs.at(-1), url, source.url);
      const segment = await fetchCameraMedia(segmentUrl, source.url, { signal: combined });
      const contentType = segment.headers.get('content-type') || '';
      if (/text|json|html|mpegurl/i.test(contentType) || /^\s*(?:<|\{|#EXTM3U)/.test(segment.body.subarray(0, 80).toString())) throw new Error('Segment is not media');
      const ts = segment.body.length >= 188 && segment.body[0] === 0x47;
      const mp4 = segment.body.length > 8 && /^(?:ftyp|styp|moof|mdat)$/.test(segment.body.subarray(4, 8).toString());
      if (!ts && !mp4) throw new Error('Unrecognized media segment');
      return { status: 'verified', checkedAt, verifiedAt: new Date().toISOString(), segmentBytes: segment.body.length, method: 'playlist-and-segment', browserDecoded: false };
    }
    throw new Error('Playlist nesting limit');
  } catch (error) {
    return { status: 'failed', checkedAt, verifiedAt: null, message: error.message, method: 'playlist-and-segment', browserDecoded: false };
  }
}
function verificationSample(sources) {
  const selected = new Map();
  const add = source => { if (source && selected.size < MAX_PROBES) selected.set(source.id, source); };
  for (const id of ['id-jkt-502045-01', 'id-jkt-501862-01', 'id-jkt-502155-01', 'id-jkt-501594-01', 'id-jkt-501478-01']) add(sources.find(s => s.id === id));
  const jakarta = sources.filter(s => s.sourceKind === 'jakarta-public');
  for (const source of jakarta.slice(0, 5)) { if ([...selected.values()].filter(s => s.sourceKind === 'jakarta-public').length < 5) add(source); }
  for (const origin of BPJT_ORIGINS) {
    const group = sources.filter(s => s.sourceKind === 'bpjt-public' && new URL(s.url).origin === origin);
    add(group.find(s => /cam1-interchange-cawang|\/tios\/2\/19\//.test(s.url)) || group[0]);
  }
  for (const kind of ['bandung-city-cctv', 'tasikmalaya-atcs', 'bandungkab-dishub']) {
    for (const source of sources.filter(s => s.sourceKind === kind).slice(0, 2)) add(source);
  }
  return [...selected.values()];
}
async function buildCatalog() {
  // Long-haul calls to operator sites can take several seconds each; the
  // header deadline stays below the function's 60s ceiling.
  const signal = AbortSignal.timeout(48000);
  const loaders = [loadJakartaSources, loadBpjtSources, loadBandungCitySources, loadTasikmalayaSources, loadBandungKabSources];
  const packs = await Promise.all(loaders.map(async loader => {
    try { return await loader(signal); }
    catch (error) { console.warn(`[CCTV] ${loader.name}: ${error.message}`); return []; }
  }));
  const byId = new Map();
  const cataloguedAt = new Date().toISOString();
  for (const source of packs.flat()) if (source.url && !byId.has(source.id)) byId.set(source.id, { ...source, cataloguedAt });
  const sources = [...byId.values()];
  if (!sources.length) throw new Error('No public CCTV catalogs available');
  await mapBounded(verificationSample(sources), 4, async source => { source.verification = await verifyHlsSource(source, { signal }); });
  console.log(`[CCTV] ${sources.length} public feeds; ${sources.filter(s => s.verification.status === 'verified').length} sample-verified`);
  return sources;
}
let catalogEntry = null;
let catalogPending = null;
export async function getSources() {
  if (catalogEntry && Date.now() - catalogEntry.at < catalogEntry.ttl) return catalogEntry.value;
  if (catalogPending) return catalogPending;
  catalogPending = buildCatalog()
    .then((value) => {
      const complete = value.some(source => source.sourceKind === 'jakarta-public')
        && value.some(source => source.sourceKind === 'bpjt-public');
      catalogEntry = { at: Date.now(), value, ttl: complete ? CATALOG_TTL_MS : PARTIAL_CATALOG_TTL_MS };
      return value;
    })
    .catch((error) => {
      if (catalogEntry) return catalogEntry.value;
      throw error;
    })
    .finally(() => { catalogPending = null; });
  return catalogPending;
}
export async function findSource(id) {
  const wanted = String(id || '').trim();
  if (!CAMERA_ID_PATTERN.test(wanted)) return null;
  return (await getSources()).find(source => source.id === wanted) || null;
}
const VIDEO_TYPES = new Set(['mp4', 'hls', 'webm']);
export function normalizeFeedType(value) {
  const type = String(value || '').toLowerCase();
  if (['jpg', 'jpeg', 'png'].includes(type)) return 'image';
  if (type === 'mjpg') return 'mjpeg';
  if (type === 'video') return 'mp4';
  if (type === 'stream') return 'hls';
  return ['image', 'mjpeg', 'mp4', 'hls', 'webm', 'none'].includes(type) ? type : 'image';
}
export function isVideoFeedType(feedType) {
  return VIDEO_TYPES.has(feedType);
}
