/** Public upstream loaders only. Authentication and caching belong to the caller.
 * No import from situasi.js: it can import these loaders without a cycle.
 * All times are ISO 8601 or null; coordinates are numbers or null.
 */
export const SOURCES = Object.freeze({
  earthquakes: 'https://data.bmkg.go.id/DataMKG/TEWS/gempaterkini.json',
  latestEarthquake: 'https://data.bmkg.go.id/DataMKG/TEWS/autogempa.json',
  feltEarthquakes: 'https://data.bmkg.go.id/DataMKG/TEWS/gempadirasakan.json',
  alerts: 'https://www.bmkg.go.id/alerts/nowcast/id/rss.xml',
  volcanoes: 'https://magma.esdm.go.id/v1/gunung-api/tingkat-aktivitas',
  volcanoCoordinates: 'https://magma.esdm.go.id/v1/gunung-api',
  hotspots: 'https://opsroom.sipongidata.my.id/api/opsroom/indoHotspot?wilayah=IN&filterperiode=false&late=24&satelit[]=NASA-MODIS&satelit[]=NASA-NOAA20&satelit[]=NASA-NOAA21&confidence[]=low&confidence[]=medium&confidence[]=high',
  flights: 'https://opensky-network.org/api/states/all?lamin=-11.5&lomin=94.5&lamax=6.5&lomax=141.5',
});

const MAX_BYTES = 3_500_000;
const TIMEOUT_MS = 12_000;
const CAP_LINK = /^https:\/\/www\.bmkg\.go\.id\/alerts\/nowcast\/id\/[A-Za-z0-9_-]+_alert\.xml$/;

/** Streams decoded bytes under a per-request cap, plus an optional shared cap.
 * Redirects are forbidden, including CAP redirects outside the allowlist.
 */
export async function fetchNatureSource(url, { signal, budget } = {}) {
  if (!Object.values(SOURCES).includes(url) && !CAP_LINK.test(url)) throw new Error('URL sumber tidak diizinkan');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Batas waktu sumber 12 detik')), TIMEOUT_MS);
  let reader;
  try {
    const combined = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
    combined.throwIfAborted();
    if (budget && budget.remaining <= 0) throw new Error('Batas ukuran gabungan sumber terlampaui');
    const response = await fetch(url, {
      headers: { 'User-Agent': 'PBPII-Ruang-Situasi/1.0', Accept: 'application/json, application/xml, application/rss+xml, text/html' },
      signal: combined,
      redirect: 'error',
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Sumber menjawab HTTP ${response.status}`);
    }
    if (!response.body) throw new Error('Sumber tidak mengirim isi respons');
    reader = response.body.getReader();
    const declared = Number(response.headers.get('content-length'));
    if (declared > MAX_BYTES || (budget && declared > budget.remaining)) throw new Error('Respons sumber terlalu besar');
    const chunks = [];
    let size = 0;
    while (true) {
      combined.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (budget) budget.remaining -= value.byteLength;
      if (size > MAX_BYTES || (budget && budget.remaining < 0)) throw new Error('Respons sumber terlalu besar');
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks).toString('utf8');
  } catch (error) {
    controller.abort();
    if (reader) await reader.cancel().catch(() => {});
    throw error;
  } finally {
    clearTimeout(timer);
    reader?.releaseLock();
  }
}

function text(value) {
  return String(value ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]*>/g, ' ').replace(/&#(x[\da-f]+|\d+);/gi, (_, code) => {
      const n = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code);
      return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '';
    }).replace(/&(amp|lt|gt|quot|apos|nbsp);/gi, (_, name) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' })[name.toLowerCase()])
    .replace(/\s+/g, ' ').trim();
}

function link(value, base) {
  try {
    const url = new URL(value, base);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

// Only fixed tag names are passed in. No DTD/entities are evaluated.
function tags(xml, name) {
  return [...String(xml).matchAll(new RegExp(`<((?:[\\w-]+:)?${name})(?:\\s[^>]*)?>([\\s\\S]*?)<\\/\\1\\s*>`, 'gi'))].map((m) => m[2]);
}
const xmlValue = (xml, name) => text(tags(xml, name)[0] || '');
function checkedXml(xml, root) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || !new RegExp(`<(?:[\\w-]+:)?${root}\\b`, 'i').test(xml)) throw new Error('Format XML sumber tidak dikenali');
  return String(xml).replace(/<!--[\s\S]*?-->/g, '');
}
function number(value) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function coordinates(latValue, lonValue) {
  const lat = number(latValue), lon = number(lonValue);
  return lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}
function iso(value) {
  // Never infer the timezone of an unzoned source timestamp.
  const raw = text(value);
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/i.test(raw)) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}
function epoch(value) {
  const n = number(value);
  if (n === null || n < 0 || n > 8.64e12) return null;
  return new Date(n * 1000).toISOString();
}
const newest = (a, b) => (Date.parse(b.time) || 0) - (Date.parse(a.time) || 0);

/** Accepts Infogempa.gempa in either BMKG object or array form. Depth is km. */
export function parseEarthquakes(data, feed = SOURCES.earthquakes) {
  const raw = data?.Infogempa?.gempa;
  if (!raw || (typeof raw !== 'object')) throw new Error('Format gempa BMKG tidak dikenali');
  const rows = Array.isArray(raw) ? raw : [raw];
  return rows.flatMap((row) => {
    const pair = text(row?.Coordinates).split(',');
    const point = pair.length === 2 ? coordinates(...pair) : null;
    if (!point) return [];
    const time = iso(row.DateTime);
    const magnitude = number(row.Magnitude);
    const depth = number(text(row.Kedalaman).replace(/\s*km$/i, ''));
    const region = text(row.Wilayah), potential = text(row.Potensi), felt = text(row.Dirasakan);
    return [{ id: `gempa:${time || text(row.DateTime)}:${point.lat},${point.lon}`,
      title: `Gempa${magnitude === null ? '' : ` M${magnitude}`} · ${region || 'BMKG'}`,
      ...point, time, summary: [region, potential, felt].filter(Boolean).join(' · '), url: feed,
      magnitude, depth, region, potential, felt, feeds: [feed] }];
  });
}

function mergeEarthquakes(items) {
  const merged = new Map();
  for (const item of items) {
    const old = merged.get(item.id);
    if (!old) { merged.set(item.id, item); continue; }
    old.feeds = [...new Set([...old.feeds, ...item.feeds])];
    for (const key of ['magnitude', 'depth', 'region', 'potential', 'felt']) {
      if (old[key] === null || old[key] === '') old[key] = item[key];
    }
    old.summary = [old.region, old.potential, old.felt].filter(Boolean).join(' · ');
  }
  return [...merged.values()].sort(newest);
}

export function parseAlertFeed(xml) {
  return [...new Set(tags(checkedXml(xml, 'rss'), 'item').map((body) => xmlValue(body, 'link')).filter((url) => CAP_LINK.test(url)))];
}

function polygon(raw) {
  const points = text(raw).split(/\s+/).map((pair) => {
    const pieces = pair.split(',');
    const p = pieces.length === 2 ? coordinates(...pieces) : null;
    return p ? [p.lat, p.lon] : null;
  });
  if (points.length < 4 || points.some((p) => !p)) return null;
  const first = points[0], last = points.at(-1);
  if (first[0] !== last[0] || first[1] !== last[1] || new Set(points.map((p) => p.join(','))).size < 3) return null;
  return points;
}

/** polygons contains only currently active public CAP fills, in [lat, lon]
 * order. Expired/upcoming/test/cancelled items remain available to the list.
 */
export function parseCap(xml, url, now = Date.now()) {
  const body = checkedXml(xml, 'alert');
  const identifier = xmlValue(body, 'identifier');
  if (!identifier) throw new Error('CAP tidak memiliki identifier');
  const time = iso(xmlValue(body, 'sent'));
  const status = xmlValue(body, 'status'), msgType = xmlValue(body, 'msgType'), scope = xmlValue(body, 'scope');
  const references = xmlValue(body, 'references').split(/\s+/).map((ref) => ref.split(',')[1]).filter(Boolean);
  let infos = tags(body, 'info');
  const local = infos.filter((info) => /^id(?:-|$)/i.test(xmlValue(info, 'language')));
  if (local.length) infos = local;
  if (!infos.length && msgType !== 'Cancel') throw new Error('CAP tidak memiliki info');
  return (infos.length ? infos : ['']).map((info, index) => {
    // CAP specifies sent as the default when effective is absent, not invalid.
    const effectiveRaw = xmlValue(info, 'effective');
    const effective = effectiveRaw ? iso(effectiveRaw) : time;
    const expires = iso(xmlValue(info, 'expires'));
    const validWindow = !!effective && !!expires && Date.parse(expires) > Date.parse(effective);
    const expired = !!expires && Date.parse(expires) <= now;
    let validity = !validWindow ? 'unknown' : expired ? 'expired' : Date.parse(effective) > now ? 'upcoming' : 'active';
    if (status !== 'Actual' || scope !== 'Public' || !['Alert', 'Update', 'Cancel'].includes(msgType)) validity = 'non-operational';
    if (msgType === 'Cancel') validity = 'cancelled';
    const active = validity === 'active';
    const rings = tags(info, 'polygon').map(polygon).filter(Boolean);
    const anchor = rings[0]?.[0];
    return { id: `cap:${identifier}:${index}`, identifier,
      title: xmlValue(info, 'headline') || xmlValue(info, 'event') || 'Peringatan cuaca BMKG',
      lat: anchor?.[0] ?? null, lon: anchor?.[1] ?? null, time,
      summary: xmlValue(info, 'description'), url: CAP_LINK.test(url) ? url : SOURCES.alerts,
      effective, expires, severity: xmlValue(info, 'severity'), certainty: xmlValue(info, 'certainty'),
      urgency: xmlValue(info, 'urgency'), status, msgType, scope, references, validity, expired, active,
      polygons: active ? rings : [], polygonCount: rings.length,
      areas: tags(info, 'areaDesc').map(text), instruction: xmlValue(info, 'instruction'),
    };
  });
}

function applyCapReferences(items) {
  for (const update of items) {
    if (update.status !== 'Actual' || update.scope !== 'Public' || !['Cancel', 'Update'].includes(update.msgType)) continue;
    for (const old of items) {
      if (old.identifier === update.identifier || !update.references.includes(old.identifier)) continue;
      old.active = false;
      old.polygons = [];
      old.validity = update.msgType === 'Cancel' ? 'cancelled' : 'superseded';
    }
  }
  return items;
}

function tableRows(html) {
  return [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(([, row]) =>
    [...row.matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/gi)].map(([, attributes, body]) => ({ attributes, body })));
}
const volcanoKey = (name) => text(name).toLowerCase().replace(/^(?:gunung\s+api|gunung|g\.)\s+/i, '').replace(/[^a-z0-9]/g, '');
function href(html) {
  const match = /\bhref\s*=\s*(["'])(.*?)\1/i.exec(html);
  return match?.[2] ? link(text(match[2]), SOURCES.volcanoCoordinates) : '';
}

export function parseVolcanoCoordinates(html) {
  const positions = new Map();
  for (const cells of tableRows(html)) {
    if (cells.length < 3) continue;
    const key = volcanoKey(cells[0].body);
    const point = coordinates(text(cells[1].body), text(cells[2].body));
    if (!key || !point) continue;
    // Ambiguous names never get guessed coordinates.
    positions.set(key, positions.has(key) ? null : { ...point, url: href(cells[0].body) });
  }
  if (!positions.size) throw new Error('Koordinat MAGMA tidak dikenali');
  return positions;
}

/** The activity page has rowspanned level headers, then plain name - province
 * cells. It does not supply observation times; time must remain null.
 */
export function parseVolcanoes(html, positions = new Map()) {
  const items = [];
  const tables = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].map((m) => m[1]);
  for (const table of tables) {
    let level = null, levelLabel = '', remaining = 0;
    for (const cells of tableRows(table)) {
      const header = cells.find((cell) => /^Level\s+(?:IV|III|II|I)\b/i.test(text(cell.body)));
      if (header) {
        const match = /^Level\s+(IV|III|II|I)\s*(\([^)]*\))?/i.exec(text(header.body));
        level = { I: 1, II: 2, III: 3, IV: 4 }[match[1].toUpperCase()];
        levelLabel = match[0];
        remaining = Number(/\browspan\s*=\s*["']?(\d+)/i.exec(header.attributes)?.[1] || 1);
      }
      if (remaining <= 0) { level = null; continue; }
      for (const cell of cells) {
        if (cell === header) continue;
        const label = text(cell.body).replace(/\s*Lihat laporan\b.*$/i, '').trim();
        const split = /^(.+?)\s+[-–]\s+(.+)$/.exec(label);
        if (!split || !level) continue;
        const [, title, province] = split;
        const key = volcanoKey(title), point = positions.get(key);
        items.push({ id: `gunung:${key}`, title, lat: point?.lat ?? null, lon: point?.lon ?? null,
          time: null, summary: `${levelLabel} · ${province}`, url: href(cell.body) || point?.url || SOURCES.volcanoes,
          level, levelLabel, province, coordinateSource: point ? SOURCES.volcanoCoordinates : null });
      }
      remaining--;
    }
  }
  if (!items.length) throw new Error('Tingkat aktivitas MAGMA tidak dikenali');
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

export function parseHotspots(data) {
  if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features)) throw new Error('Format hotspot SIPONGI tidak dikenali');
  const seen = new Set();
  return data.features.flatMap((feature) => {
    if (feature?.geometry?.type !== 'Point' || !Array.isArray(feature.geometry.coordinates)) return [];
    const [lon, lat] = feature.geometry.coordinates;
    const point = coordinates(lat, lon);
    if (!point) return [];
    const p = feature.properties || {};
    const satellite = text(p.sumber), time = iso(p.date_hotspot_ori), confidence = text(p.confidence_level).toLowerCase();
    const id = `hotspot:${satellite}:${time || text(p.date_hotspot_ori)}:${point.lat},${point.lon}`;
    if (seen.has(id)) return [];
    seen.add(id);
    const village = text(p.desa), district = text(p.kabkota), province = text(p.nama_provinsi);
    return [{ id, title: `Hotspot termal · ${village || district || satellite || 'SIPONGI'}`, ...point, time,
      summary: [satellite, confidence, village, district, province].filter(Boolean).join(' · '),
      url: 'https://opsroom.sipongidata.my.id/', confidence, confidenceScore: number(p.confidence), satellite,
      village, district, province, confirmedFire: false }];
  }).sort(newest);
}

/** OpenSky altitude in metres (barometric), speed in m/s, heading in degrees.
 * time is time_position, never last_contact or the dataset snapshot time.
 */
export function parseFlights(data, now = Date.now()) {
  const snapshotTime = epoch(data?.time);
  if (!snapshotTime || !(data.states === null || Array.isArray(data.states))) throw new Error('Format penerbangan OpenSky tidak dikenali');
  const seen = new Set();
  const items = (data.states || []).flatMap((state) => {
    if (!Array.isArray(state)) return [];
    const icao24 = text(state[0]).toLowerCase(), point = coordinates(state[6], state[5]);
    if (!/^[a-f0-9]{6}$/.test(icao24) || !point || seen.has(icao24)) return [];
    if (point.lat < -11.5 || point.lat > 6.5 || point.lon < 94.5 || point.lon > 141.5) return [];
    seen.add(icao24);
    const time = epoch(state[3]), lastContact = epoch(state[4]), callsign = text(state[1]);
    const positionAgeSeconds = time ? Math.max(0, (now - Date.parse(time)) / 1000) : null;
    const stale = positionAgeSeconds === null || positionAgeSeconds > 300;
    const altitude = number(state[7]), velocity = number(state[9]), track = number(state[10]);
    return [{ id: `flight:${icao24}`, title: callsign || icao24.toUpperCase(), ...point, time,
      summary: `${text(state[2])}${stale ? ' · Posisi lama/tidak bertanggal' : ''}`,
      url: `https://opensky-network.org/network/explorer?icao24=${icao24}`,
      icao24, callsign, originCountry: text(state[2]), lastContact, altitude,
      speed: velocity !== null && velocity >= 0 ? velocity : null,
      heading: track !== null && track >= 0 && track < 360 ? track : null,
      onGround: typeof state[8] === 'boolean' ? state[8] : null, positionAgeSeconds, stale }];
  });
  return { items, snapshotTime };
}

/** Optional injection is for fixtures/server adapters, never user-provided URLs.
 * An injected fetchSource must honour {signal, budget} to preserve alert bounds.
 */
export function createNatureLoaders({ fetchSource = fetchNatureSource, now = Date.now } = {}) {
  return {
    async earthquakes() {
      const urls = [SOURCES.earthquakes, SOURCES.latestEarthquake, SOURCES.feltEarthquakes];
      const packs = await Promise.allSettled(urls.map(async (url) => parseEarthquakes(JSON.parse(await fetchSource(url)), url)));
      if (packs.every((p) => p.status === 'rejected')) throw new Error('Data gempa BMKG belum dapat diambil');
      const partial = packs.some((p) => p.status === 'rejected');
      return { items: mergeEarthquakes(packs.flatMap((p) => p.status === 'fulfilled' ? p.value : [])), source: 'BMKG', partial,
        note: `Gabungan gempa M5+, gempa terbaru, dan gempa dirasakan; bukan seluruh kejadian gempa. Kedalaman dalam km.${partial ? ' Sebagian umpan tidak tersedia.' : ''}` };
    },
    async alerts() {
      // One deadline and one 3.5 MB budget cover RSS and all detail requests.
      const signal = AbortSignal.timeout(TIMEOUT_MS), budget = { remaining: MAX_BYTES };
      const urls = parseAlertFeed(await fetchSource(SOURCES.alerts, { signal, budget }));
      const selected = urls.slice(0, 20), packs = new Array(selected.length);
      let cursor = 0;
      await Promise.all(Array.from({ length: Math.min(4, selected.length) }, async () => {
        while (cursor < selected.length) {
          const index = cursor++;
          try {
            signal.throwIfAborted();
            if (budget.remaining <= 0) throw new Error('Batas ukuran CAP tercapai');
            packs[index] = parseCap(await fetchSource(selected[index], { signal, budget }), selected[index], now());
          } catch { packs[index] = null; }
        }
      }));
      if (selected.length && packs.every((p) => !p)) throw new Error('Detail peringatan BMKG belum dapat diambil');
      const partial = urls.length > selected.length || packs.some((p) => !p);
      return { items: applyCapReferences(packs.flatMap((p) => p || [])).sort(newest), source: 'BMKG CAP', partial,
        note: `Isian peta hanya untuk CAP Actual/Public yang sedang berlaku. Status dan masa berlaku tetap disertakan. Maksimal 20 detail, 4 permintaan bersamaan.${partial ? ' Data peringatan sebagian/terbatas.' : ''}` };
    },
    async volcanoes() {
      const [activity, catalog] = await Promise.allSettled([
        fetchSource(SOURCES.volcanoes),
        fetchSource(SOURCES.volcanoCoordinates).then(parseVolcanoCoordinates),
      ]);
      if (activity.status === 'rejected') throw new Error('Tingkat aktivitas MAGMA belum dapat diambil');
      const items = parseVolcanoes(activity.value, catalog.status === 'fulfilled' ? catalog.value : new Map());
      const partial = catalog.status === 'rejected' || items.some((item) => item.lat === null);
      return { items, source: 'MAGMA Indonesia · PVMBG', partial,
        note: `Tingkat aktivitas resmi; koordinat dicocokkan menurut nama dari katalog MAGMA. Waktu pengamatan tidak diterbitkan di daftar ini.${partial ? ' Sebagian/seluruh koordinat tidak tersedia; tidak diperkirakan.' : ''}` };
    },
    async hotspots() {
      return { items: parseHotspots(JSON.parse(await fetchSource(SOURCES.hotspots))), source: 'SIPONGI · NASA MODIS/NOAA20/NOAA21',
        note: 'Deteksi hotspot termal satelit dalam 24 jam, semua tingkat kepercayaan. Hotspot BUKAN kebakaran terkonfirmasi; perlu verifikasi lapangan.' };
    },
    async flights() {
      return { ...parseFlights(JSON.parse(await fetchSource(SOURCES.flights)), now()), source: 'OpenSky Network',
        note: 'Snapshot ADS-B dengan cakupan terbatas, bukan pelacakan langsung. Posisi >5 menit ditandai lama; periksa time saat menampilkan cache. Ketinggian barometrik: m; kecepatan: m/s; arah: derajat. Cache pemanggil minimal 30 menit (kuota 400 kredit/IP/hari, 4 kredit/permintaan).' };
    },
  };
}

const loaders = createNatureLoaders();
export async function earthquakes() { return loaders.earthquakes(); }
export async function alerts() { return loaders.alerts(); }
export async function volcanoes() { return loaders.volcanoes(); }
export async function hotspots() { return loaders.hotspots(); }
export async function flights() { return loaders.flights(); }
