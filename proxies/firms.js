/**
 * NASA FIRMS live active-fire proxy for the fire layer.
 *
 * Upstream: https://firms.modaps.eosdis.nasa.gov/api/area/csv/{KEY}/{SOURCE}/world/2
 * merges three independent VIIRS NRT satellites (NOAA-20, NOAA-21, Suomi-NPP),
 * fetched sequentially — never in parallel — because FIRMS quotas are 5,000
 * transactions per 10 minutes per MAP_KEY. `days=1` means "current UTC day",
 * which is nearly empty just after midnight, so the pull is `days=2` clamped
 * to the trailing 24 h.
 *
 * Key comes from `FIRMS_MAP_KEY` (the globe's own name for it) or
 * `NASA_FIRMS_API_KEY`. Without one, this answers exactly what the client
 * special-cases: 503 `{error:'no_key'}` — the layer then shows "key required"
 * and stops hammering the endpoint.
 *
 * The CSV parsing is the globe's `src/data/firmsCsv.js` ported into this file
 * (a Vercel function cannot import from the other project) — same header
 * tolerance, same unpadded `acq_time` handling, same 24 h window with 2 h
 * forward slack. Response shape is unchanged:
 * `{fetchedAt, stale, ttlMs, sources, count, fires}`.
 *
 * Serverless limits shaped two choices: no disk cache (the 30 min TTL lives in
 * a warm instance only) and a per-source cap on kept detections, because three
 * world/2 granules hold ~130k records each and a function response is capped
 * around 6 MB. Highest-Radiative-Power fires are kept, which is what the heat
 * map and the top-FRP list render anyway.
 */
import { createTtlCache } from '../lib/proxy.js';

const TTL_MS = 30 * 60_000;
const SOURCES = ['VIIRS_NOAA20_NRT', 'VIIRS_NOAA21_NRT', 'VIIRS_SNPP_NRT'];
const SOURCE_TIMEOUT_MS = 20_000;
/** Sequential budget: past this, the remaining sources are marked unavailable. */
const REFRESH_DEADLINE_MS = 50_000;
const MAX_RESPONSE_BYTES = 24 * 1024 * 1024;
/** Kept detections per source — bounds memory and the function response size. */
const MAX_FIRES_PER_SOURCE = 9_000;

/** Header fields that must all be present for a payload to count as FIRMS CSV. */
const REQUIRED_HEADER_FIELDS = ['latitude', 'longitude', 'acq_date', 'acq_time', 'confidence', 'frp'];
const HOUR_MS = 3600_000;
const WINDOW_MS = 24 * HOUR_MS;
/** Forward slack absorbs upstream/local clock skew. */
const FORWARD_SLACK_MS = 2 * HOUR_MS;

const cache = createTtlCache(TTL_MS);

const mapKey = () => String(process.env.FIRMS_MAP_KEY || process.env.NASA_FIRMS_API_KEY || '').trim();

/** Cheap "is this actually FIRMS CSV?" gate — errors arrive as HTML or text. */
function isLikelyCsv(text) {
  if (typeof text !== 'string') return false;
  const trimmed = text.trimStart();
  if (!trimmed || trimmed[0] === '<') return false;
  const endOfLine = trimmed.indexOf('\n');
  const headerLine = trimmed.slice(0, endOfLine === -1 ? undefined : endOfLine).trim().toLowerCase();
  const fields = headerLine.split(',').map((field) => field.trim());
  return REQUIRED_HEADER_FIELDS.every((required) => fields.includes(required));
}

/** FIRMS area CSV -> flat detection records, or null for a non-CSV payload. */
function parseFirmsCsv(text) {
  if (!isLikelyCsv(text)) return null;
  const lines = text.split('\n');
  let headerIndex = 0;
  while (headerIndex < lines.length && !lines[headerIndex].trim()) headerIndex += 1;
  const header = lines[headerIndex].trim().toLowerCase().split(',').map((field) => field.trim());
  const col = new Map(header.map((name, index) => [name, index]));
  const iLat = col.get('latitude');
  const iLon = col.get('longitude');
  const iFrp = col.get('frp');
  const iConfidence = col.get('confidence');
  const iBrightness = col.get('bright_ti4') ?? col.get('brightness');
  const iBrightnessTi5 = col.get('bright_ti5') ?? col.get('bright_t31');
  const iDaynight = col.get('daynight');
  const iAcqDate = col.get('acq_date');
  const iAcqTime = col.get('acq_time');
  const iSatellite = col.get('satellite');
  const iInstrument = col.get('instrument');

  const records = [];
  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    const parts = line.split(',');
    if (parts.length < header.length) continue; // malformed row — skip
    const lat = Number(parts[iLat]);
    const lon = Number(parts[iLon]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    records.push({
      lat,
      lon,
      frp: finiteOrZero(parts[iFrp]),
      // Categorical (l/n/h) for VIIRS — passed through raw, normalized client-side.
      confidence: cell(parts, iConfidence),
      brightness: finiteOrZero(parts[iBrightness]),
      brightnessTi5: finiteOrZero(parts[iBrightnessTi5]),
      daynight: cell(parts, iDaynight),
      acqDate: cell(parts, iAcqDate),
      acqTime: cell(parts, iAcqTime), // NOT zero-padded — kept verbatim
      satellite: cell(parts, iSatellite),
      instrument: cell(parts, iInstrument),
    });
  }
  return records;
}

/** acq_date "YYYY-MM-DD" + unpadded acq_time "HHMM" -> epoch ms (NaN if bad). */
function acquisitionMsUtc(acqDate, acqTime) {
  if (typeof acqDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(acqDate)) return NaN;
  const timeText = String(acqTime ?? '').trim();
  if (!/^\d{1,4}$/.test(timeText)) return NaN;
  const hhmm = timeText.padStart(4, '0');
  const year = Number(acqDate.slice(0, 4));
  const month = Number(acqDate.slice(5, 7));
  const day = Number(acqDate.slice(8, 10));
  const hours = Number(hhmm.slice(0, 2));
  const minutes = Number(hhmm.slice(2, 4));
  if (month < 1 || month > 12 || day < 1 || day > 31 || hours > 23 || minutes > 59) return NaN;
  return Date.UTC(year, month - 1, day, hours, minutes);
}

/** Keep records acquired within [now - 24 h, now + 2 h]; memoized per stamp. */
function filterTrailing24h(records, nowMs) {
  if (!Array.isArray(records) || !Number.isFinite(nowMs)) return [];
  const oldest = nowMs - WINDOW_MS;
  const newest = nowMs + FORWARD_SLACK_MS;
  const memo = new Map();
  return records.filter((record) => {
    const key = `${record.acqDate}:${record.acqTime}`;
    let ms = memo.get(key);
    if (ms === undefined) {
      ms = acquisitionMsUtc(record.acqDate, record.acqTime);
      memo.set(key, ms);
    }
    return Number.isFinite(ms) && ms >= oldest && ms <= newest;
  });
}

function cell(parts, index) {
  if (index === undefined || parts[index] === undefined) return '';
  return parts[index].trim();
}

function finiteOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

/** Fetch + parse one source. Never logs the URL — it embeds the MAP_KEY. */
async function fetchSource(key, source) {
  const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(key)}/${source}/world/2`;
  const upstream = await fetch(url, { signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS) });
  if (!upstream.ok) throw new Error(`HTTP ${upstream.status}`);
  const declared = Number(upstream.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw new Error('CSV too large');
  const text = await upstream.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) throw new Error('CSV too large');
  const records = parseFirmsCsv(text);
  if (records === null) throw new Error('non-CSV upstream response');
  return records;
}

/**
 * Sequential refresh of all three sources. Partial success (>=1 source ok)
 * still yields a cacheable entry with the failed sources marked `ok:false`;
 * total failure throws so the caller can serve stale.
 */
async function refreshUpstream(key) {
  const startedAt = Date.now();
  const sources = [];
  const fires = [];
  for (const source of SOURCES) {
    if (Date.now() - startedAt > REFRESH_DEADLINE_MS) {
      sources.push({ source, count: 0, ok: false });
      continue;
    }
    try {
      const records = keepStrongest(
        filterTrailing24h(await fetchSource(key, source), Date.now()),
        MAX_FIRES_PER_SOURCE,
      );
      sources.push({ source, count: records.length, ok: true });
      // NOT fires.push(...records): spreading a ~100k array blows V8's
      // argument limit and the whole source would be dropped on a RangeError.
      for (const record of records) fires.push(record);
    } catch (error) {
      console.warn(`[firms] ${source} fetch failed:`, error?.message || error);
      sources.push({ source, count: 0, ok: false });
    }
  }
  if (!sources.some((entry) => entry.ok)) throw new Error('all FIRMS sources failed');
  return { at: Date.now(), sources, fires };
}

/** Trim to the `limit` strongest detections (FRP drives the heat scale). */
function keepStrongest(records, limit) {
  if (records.length <= limit) return records;
  return records.sort((a, b) => b.frp - a.frp).slice(0, limit);
}

/**
 * Cache entry -> response payload. Fires are RE-filtered to the trailing 24 h
 * at serve time so a stale entry never hands over day-old detections.
 */
function buildPayload(entry, stale) {
  const fires = filterTrailing24h(entry.fires, Date.now());
  return {
    fetchedAt: entry.at,
    stale,
    ttlMs: TTL_MS,
    sources: entry.sources,
    count: fires.length,
    fires,
    fireCap: MAX_FIRES_PER_SOURCE * SOURCES.length,
  };
}

export default async function handler(req, res) {
  const send = (status, body) => {
    if (res.headersSent) return;
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };

  if (req.method !== 'GET') {
    send(405, { error: 'Method Not Allowed' });
    return;
  }

  const key = mapKey();
  if (!key) {
    // The client treats this exact pair as "key required" and stops retrying.
    send(503, { error: 'no_key' });
    return;
  }

  try {
    const { value, state } = await cache.get(() => refreshUpstream(key));
    send(200, buildPayload(value, state === 'stale'));
  } catch (error) {
    console.warn('[firms] refresh failed and no cache available:', error?.message || error);
    send(502, { error: 'firms fetch failed and no cache available' });
  }
}

/** Three sequential world/2 granules need more than the default clock. */
export const maxDuration = 30;
