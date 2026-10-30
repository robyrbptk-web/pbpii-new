/**
 * Hardened Radio Browser broker shared by `/api/radio/stations` and
 * `/api/radio/click/[id]`.
 *
 * Ported from the dev-server middleware in vite.config.js
 * (`createRadioProxyMiddleware`, lines 797-1305). The security posture is
 * copied verbatim: a host allowlist (`*.api.radio-browser.info`), endpoint
 * allowlist, `dns.lookup` pinning that refuses to connect to non-global
 * addresses, redirect refusal, byte caps and per-request timeouts.
 *
 * Serverless reality: there is no long-lived process, so the dev proxy's
 * bookkeeping (servedStationIds, the catalog generation counter) lives only
 * inside one warm function instance. `catalogInstance` is a per-instance
 * random token — exactly the contract the client already implements for
 * server restarts — so generations never falsely repeat or regress across
 * instances, and click tracking validates UUID shape instead of a
 * process-local served-id set.
 */
import https from 'node:https';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import dns from 'node:dns';
import { createTtlCache } from './proxy.js';

const RADIO_DIRECTORY_CACHE_MS = 45 * 60 * 1000;
const RADIO_DIRECTORY_STALE_MS = 7 * 24 * 60 * 60 * 1000;
const RADIO_MIRROR_CACHE_MS = 6 * 60 * 60 * 1000;
const RADIO_FETCH_TIMEOUT_MS = 12_000;
const RADIO_RESPONSE_MAX_BYTES = 4 * 1024 * 1024;
const RADIO_DIRECTORY_LIMIT = 750;
const RADIO_CATALOG_MIN_SUCCESSFUL_QUERIES = 5;
const RADIO_CATALOG_HEALTHY_MIN_STATIONS = Math.ceil(RADIO_DIRECTORY_LIMIT / 2);
/** Shared wall-clock budget for one catalog build across all queries. */
const RADIO_REFRESH_DEADLINE_MS = 24_000;
const RADIO_USER_AGENT = 'GodsEyeView/1.0 (Radio Browser directory client)';
const RADIO_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RADIO_FALLBACK_MIRRORS = Object.freeze([
  'https://de1.api.radio-browser.info',
  'https://de2.api.radio-browser.info',
  'https://nl1.api.radio-browser.info',
]);

// ---------------------------------------------------------------------------
// Country normalization — copy of src/data/radioCountry.js (the client
// re-validates countryCode with the same table, so they must agree).
// ---------------------------------------------------------------------------
const RADIO_COUNTRY_MAX_LENGTH = 80;
const ISO_ALPHA_2_CODES = Object.freeze(`
AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ
CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR
GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO
JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR
MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO
RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV
TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW
`.trim().split(/\s+/));
const ISO_ALPHA_2_SET = new Set(ISO_ALPHA_2_CODES);
const ENGLISH_REGION_NAMES = typeof Intl?.DisplayNames === 'function'
  ? new Intl.DisplayNames(['en'], { type: 'region' })
  : null;

function countryKey(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('en')
    .replace(/[‐‑‒–—-]+/g, ' ')
    .replace(/[.’']/g, '')
    .replace(/&/g, ' and ')
    .replace(/\s+/g, ' ')
    .trim();
}

const COUNTRY_NAME_TO_CODE = new Map();
for (const code of ISO_ALPHA_2_CODES) {
  const displayName = ENGLISH_REGION_NAMES?.of(code);
  if (displayName && displayName !== code) COUNTRY_NAME_TO_CODE.set(countryKey(displayName), code);
}
for (const [name, code] of Object.entries({
  america: 'US',
  'united states of america': 'US',
  usa: 'US',
  'u s': 'US',
  'u s a': 'US',
  britain: 'GB',
  'great britain': 'GB',
  uk: 'GB',
  'u k': 'GB',
  'south korea': 'KR',
  'north korea': 'KP',
  russia: 'RU',
  vietnam: 'VN',
  'czech republic': 'CZ',
  'ivory coast': 'CI',
  laos: 'LA',
  bolivia: 'BO',
  tanzania: 'TZ',
  moldova: 'MD',
  brunei: 'BN',
  'cape verde': 'CV',
  'the netherlands': 'NL',
})) COUNTRY_NAME_TO_CODE.set(countryKey(name), code);

function canonicalCountryName(code) {
  return ENGLISH_REGION_NAMES?.of(code) || code;
}

/** Normalize a bounded country code or English/common country name; fails closed. */
export function normalizeRadioCountryInput(value) {
  if (value === undefined || value === null || value === '') {
    return Object.freeze({ valid: true, empty: true, code: '', name: '' });
  }
  if (typeof value !== 'string' || value.length > RADIO_COUNTRY_MAX_LENGTH) {
    return Object.freeze({ valid: false, empty: false, code: '', name: '' });
  }
  const trimmed = value.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (
    !trimmed
    || trimmed.length > RADIO_COUNTRY_MAX_LENGTH
    || /[\u0000-\u001f\u007f]/.test(trimmed)
    || !/^[\p{L}\p{M}.&'’()\-\s]+$/u.test(trimmed)
  ) return Object.freeze({ valid: false, empty: false, code: '', name: '' });

  const possibleCode = trimmed.toUpperCase();
  const code = ISO_ALPHA_2_SET.has(possibleCode)
    ? possibleCode
    : COUNTRY_NAME_TO_CODE.get(countryKey(trimmed)) || '';
  if (!code) return Object.freeze({ valid: false, empty: false, code: '', name: '' });
  return Object.freeze({
    valid: true,
    empty: false,
    code,
    name: canonicalCountryName(code),
  });
}

// ---------------------------------------------------------------------------
// Input sanitizers and SSRF guards (ported verbatim from vite.config.js)
// ---------------------------------------------------------------------------
function cleanRadioText(value, maxLength) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength).trim();
}

function isNonGlobalIpv4(hostname) {
  const pieces = hostname.split('.');
  if (pieces.length !== 4 || pieces.some((piece) => !/^\d{1,3}$/.test(piece))) return false;
  const values = pieces.map(Number);
  if (values.some((value) => value > 255)) return true;
  const [a, b, c] = values;
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0)
    || (a === 192 && b === 88 && c === 99)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113);
}

/** Return a normalized public HTTPS URL, or null for local/private targets. */
export function publicRadioHttpsUrl(value) {
  try {
    const url = new URL(String(value ?? ''));
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
    if (url.protocol !== 'https:' || url.username || url.password || !hostname) return null;
    if (
      hostname === 'localhost'
      || hostname.endsWith('.localhost')
      || hostname.endsWith('.local')
      || isNonGlobalIpv4(hostname)
      || hostname.includes(':')
    ) return null;
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

/** Normalize one Radio Browser station and omit favicons and unsafe streams. */
export function normalizeRadioBrowserStation(raw) {
  const id = cleanRadioText(raw?.stationuuid, 40).toLowerCase();
  const lat = raw?.geo_lat === null || raw?.geo_lat === '' ? null : Number(raw?.geo_lat);
  const lon = raw?.geo_long === null || raw?.geo_long === '' ? null : Number(raw?.geo_long);
  const codec = cleanRadioText(raw?.codec, 16).toUpperCase();
  const streamUrl = publicRadioHttpsUrl(raw?.url_resolved || raw?.url);
  if (
    !RADIO_UUID_RE.test(id)
    || Number(raw?.lastcheckok) !== 1
    || Number(raw?.hls) === 1
    || !Number.isFinite(lat) || lat < -90 || lat > 90
    || !Number.isFinite(lon) || lon < -180 || lon > 180
    || !/^(?:MP3|AAC(?:\+|-LC|-HE)?|HE-AAC)$/i.test(codec)
    || !streamUrl
  ) return null;

  const name = cleanRadioText(raw?.name, 140);
  if (!name) return null;
  const tags = String(raw?.tags ?? '')
    .split(',')
    .map((tag) => cleanRadioText(tag, 80).toLocaleLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .filter((tag, index, all) => all.indexOf(tag) === index)
    .slice(0, 24);
  const languages = String(raw?.language ?? '')
    .split(',')
    .map((language) => cleanRadioText(language, 40))
    .filter(Boolean)
    .slice(0, 8);
  const rawCountryCode = cleanRadioText(raw?.countrycode, 2).toUpperCase();
  const normalizedCode = normalizeRadioCountryInput(rawCountryCode);
  const normalizedCountry = normalizedCode.valid && !normalizedCode.empty
    ? normalizedCode
    : normalizeRadioCountryInput(cleanRadioText(raw?.country, 80));
  const bitrate = Number(raw?.bitrate);
  return {
    id,
    name,
    lat,
    lon,
    streamUrl,
    homepage: publicRadioHttpsUrl(raw?.homepage),
    tags,
    languages,
    state: cleanRadioText(raw?.state, 80),
    country: normalizedCountry.valid && !normalizedCountry.empty
      ? normalizedCountry.name
      : cleanRadioText(raw?.country, 80),
    countryCode: normalizedCountry.valid ? normalizedCountry.code : '',
    metadataTrust: 'untrusted-community',
    codec,
    bitrate: Number.isInteger(bitrate) && bitrate >= 8 && bitrate <= 1024 ? bitrate : null,
    clickCount: Math.max(0, Math.min(10_000_000, Number(raw?.clickcount) || 0)),
  };
}

/** The station shape the globe validates; clickCount stays server-side. */
export function publicRadioStation(station) {
  return {
    id: station.id,
    name: station.name,
    lat: station.lat,
    lon: station.lon,
    streamUrl: station.streamUrl,
    homepage: station.homepage,
    tags: station.tags,
    languages: station.languages,
    state: station.state,
    country: station.country,
    countryCode: station.countryCode,
    metadataTrust: station.metadataTrust,
    codec: station.codec,
    bitrate: station.bitrate,
  };
}

export function isRadioStationUuid(value) {
  return RADIO_UUID_RE.test(String(value ?? '').toLowerCase());
}

function radioMirrorOrigin(value) {
  const hostname = String(value ?? '').toLowerCase().replace(/\.$/, '');
  if (!/^[a-z0-9-]+\.api\.radio-browser\.info$/.test(hostname)) return null;
  return `https://${hostname}`;
}

/** Return whether a resolved Radio Browser address is safe for an outbound request. */
export function isPublicRadioAddress(value) {
  const address = String(value ?? '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!address) return false;
  if (!address.includes(':')) {
    const ipv4 = address.split('.');
    return ipv4.length === 4
      && ipv4.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
      && !isNonGlobalIpv4(address);
  }
  const pieces = address.split('::');
  if (pieces.length > 2) return false;
  const left = pieces[0] ? pieces[0].split(':') : [];
  const right = pieces[1] ? pieces[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((pieces.length === 1 && missing !== 0) || (pieces.length === 2 && missing < 1)) return false;
  const groups = [...left, ...Array(Math.max(0, missing)).fill('0'), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return false;
  const numeric = groups.reduce((total, group) => (total << 16n) | BigInt(`0x${group}`), 0n);
  const inCidr = (base, prefix) => {
    const shift = 128n - BigInt(prefix);
    return (numeric >> shift) === (base >> shift);
  };
  const base = (text) => text.split(':').reduce(
    (total, group) => (total << 16n) | BigInt(`0x${group || '0'}`),
    0n,
  );
  const cidr = (text, prefix) => inCidr(base(text), prefix);
  return cidr('2000:0:0:0:0:0:0:0', 3)
    && !cidr('2001:0:0:0:0:0:0:0', 23)
    && !cidr('2001:db8:0:0:0:0:0:0', 32)
    && !cidr('2002:0:0:0:0:0:0:0', 16)
    && !cidr('3fff:0:0:0:0:0:0:0', 20);
}

/** Allowlist: only https, only *.api.radio-browser.info, only these three routes. */
function radioProxyDestination(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    return null;
  }
  const origin = radioMirrorOrigin(url.hostname);
  if (
    !origin
    || url.origin !== origin
    || url.username
    || url.password
    || url.port
    || url.hash
  ) return null;
  const discovery = url.hostname.toLowerCase() === 'all.api.radio-browser.info'
    && url.pathname === '/json/servers'
    && !url.search;
  const directory = url.pathname === '/json/stations/search';
  const click = /^\/json\/url\/[0-9a-f-]+$/i.test(url.pathname) && !url.search;
  return discovery || directory || click ? url : null;
}

async function resolveRadioProxyAddresses(hostname) {
  const resolved = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  const rows = Array.isArray(resolved) ? resolved : [resolved];
  const addresses = rows
    .map((row) => ({ address: String(row?.address || ''), family: Number(row?.family) || undefined }))
    .filter((row) => row.address);
  if (!addresses.length || addresses.some((row) => !isPublicRadioAddress(row.address))) {
    throw new Error('Radio Browser resolved to a forbidden address');
  }
  return addresses;
}

/** TLS to a pre-validated address: the pinned lookup prevents DNS-rebind TOCTOU. */
function fetchPinnedRadioResponse(url, options, addresses) {
  return new Promise((resolve, reject) => {
    const address = addresses[0];
    const request = https.request(url, {
      method: 'GET',
      headers: options.headers,
      signal: options.signal,
      lookup(_hostname, lookupOptions, callback) {
        if (lookupOptions?.all) callback(null, addresses);
        else callback(null, address.address, address.family);
      },
    }, (response) => {
      const headers = new Headers();
      for (const [name, value] of Object.entries(response.headers)) {
        if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
        else if (value !== undefined) headers.set(name, String(value));
      }
      resolve(new Response(Readable.toWeb(response), {
        status: response.statusCode || 500,
        statusText: response.statusMessage || '',
        headers,
      }));
    });
    request.on('error', reject);
    request.end();
  });
}

/** Read a Response body as text with a hard byte cap (ported from vite.config.js). */
async function readResponseTextCapped(response, maxBytes) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    const err = new Error('Upstream response too large');
    err.code = 'RESPONSE_TOO_LARGE';
    throw err;
  }
  const reader = response.body?.getReader?.();
  if (!reader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > maxBytes) {
      const err = new Error('Upstream response too large');
      err.code = 'RESPONSE_TOO_LARGE';
      throw err;
    }
    return text;
  }
  const decoder = new TextDecoder();
  let out = '';
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      try { await reader.cancel(); } catch { /* no-op */ }
      const err = new Error('Upstream response too large');
      err.code = 'RESPONSE_TOO_LARGE';
      throw err;
    }
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
}

async function mapRadioConcurrent(values, concurrency, mapper) {
  const results = new Array(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= values.length) return;
      results[index] = await mapper(values[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// Per-instance state (one warm function instance; degrades gracefully on cold)
// ---------------------------------------------------------------------------
let mirrorCache = { origins: [...RADIO_FALLBACK_MIRRORS], cachedAt: 0 };
let mirrorPromise = null;
/** Payload of the last healthy catalog, used to age-check stale serving. */
let lastHealthyCatalog = null;
let catalogGeneration = 0;
const catalogInstance = randomUUID();
const catalogCache = createTtlCache(RADIO_DIRECTORY_CACHE_MS);

async function fetchJson(url, maxBytes = RADIO_RESPONSE_MAX_BYTES, timeoutMs = RADIO_FETCH_TIMEOUT_MS) {
  const destination = radioProxyDestination(url);
  if (!destination) throw new Error('Radio Browser destination is not permitted');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const addresses = await resolveRadioProxyAddresses(destination.hostname);
    const response = await fetchPinnedRadioResponse(destination, {
      headers: { Accept: 'application/json', 'User-Agent': RADIO_USER_AGENT },
      signal: controller.signal,
    }, addresses);
    if (response.status >= 300 && response.status < 400) {
      try { await response.body?.cancel?.(); } catch { /* no-op */ }
      throw new Error('Radio Browser redirects are refused');
    }
    if (!response.ok) throw new Error(`Radio Browser returned ${response.status}`);
    const text = await readResponseTextCapped(response, maxBytes);
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

async function mirrors() {
  if (Date.now() - mirrorCache.cachedAt < RADIO_MIRROR_CACHE_MS) return mirrorCache.origins;
  if (!mirrorPromise) {
    mirrorPromise = (async () => {
      try {
        const rows = await fetchJson('https://all.api.radio-browser.info/json/servers', 256 * 1024);
        const discovered = [...new Set((Array.isArray(rows) ? rows : []).map((row) => radioMirrorOrigin(row?.name)).filter(Boolean))];
        if (discovered.length) {
          mirrorCache = { origins: [...discovered, ...RADIO_FALLBACK_MIRRORS.filter((origin) => !discovered.includes(origin))], cachedAt: Date.now() };
        }
      } catch {
        mirrorCache = { ...mirrorCache, cachedAt: Date.now() };
      }
      return mirrorCache.origins;
    })().finally(() => { mirrorPromise = null; });
  }
  return mirrorPromise;
}

async function fetchPath(pathname, { maxBytes, timeoutMs, maxMirrors } = {}) {
  let lastError = null;
  const origins = await mirrors();
  for (const origin of origins.slice(0, maxMirrors ?? origins.length)) {
    try {
      return await fetchJson(`${origin}${pathname}`, maxBytes, timeoutMs);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('No Radio Browser mirror is available');
}

async function refreshCatalog(deadlineAt) {
  const queries = [null, 'news', 'talk', 'weather', 'emergency', 'scanner', 'aviation', 'marine', 'traffic'];
  const outcomes = await mapRadioConcurrent(queries, 3, async (tag, index) => {
    if (Date.now() >= deadlineAt) return { succeeded: false, stations: [] };
    const params = new URLSearchParams({
      has_geo_info: 'true',
      is_https: 'true',
      hidebroken: 'true',
      order: 'clickcount',
      reverse: 'true',
      limit: index === 0 ? '1800' : '220',
    });
    if (tag) params.set('tag', tag);
    try {
      const rows = await fetchPath(`/json/stations/search?${params}`, {
        timeoutMs: Math.max(1_000, Math.min(RADIO_FETCH_TIMEOUT_MS, deadlineAt - Date.now())),
      });
      if (!Array.isArray(rows)) throw new Error('Radio Browser catalog payload was not an array');
      if (!rows.every((row) => (
        row
        && typeof row === 'object'
        && !Array.isArray(row)
        && typeof row.stationuuid === 'string'
        && typeof row.name === 'string'
        && (typeof row.url_resolved === 'string' || typeof row.url === 'string')
      ))) throw new Error('Radio Browser catalog contained a malformed station row');
      const stations = rows.map(normalizeRadioBrowserStation).filter(Boolean);
      const requestedTag = cleanRadioText(tag, 80)
        .toLocaleLowerCase()
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const requestedTagCovered = !requestedTag || stations.some((station) => (
        station.tags.some((stationTag) => stationTag === requestedTag || stationTag.includes(requestedTag))
      ));
      return {
        // Coverage is based on accepted rows, and specialist responses must
        // contain an accepted station tagged for the requested category.
        succeeded: stations.length > 0 && requestedTagCovered,
        stations,
      };
    } catch {
      return { succeeded: false, stations: [] };
    }
  });
  const resultSets = outcomes.map((outcome) => outcome.stations);

  const selected = [];
  const seen = new Set();
  const take = (station) => {
    if (!station || seen.has(station.id) || selected.length >= RADIO_DIRECTORY_LIMIT) return;
    seen.add(station.id);
    selected.push(station);
  };
  // Seed specialist station-tag queries before popularity fill so operational
  // categories remain represented even when global click charts skew musical.
  for (const rows of resultSets.slice(1)) rows.slice(0, 45).forEach(take);
  resultSets.flat().sort((a, b) => b.clickCount - a.clickCount || a.name.localeCompare(b.name)).forEach(take);
  const timestamp = Date.now();
  const successfulQueries = outcomes.filter((outcome) => outcome.succeeded).length;
  const broadQueryHealthy = outcomes[0].succeeded && outcomes[0].stations.length > 0;
  const healthReasons = [];
  if (!broadQueryHealthy) healthReasons.push('broad-query-unhealthy');
  if (successfulQueries < RADIO_CATALOG_MIN_SUCCESSFUL_QUERIES) healthReasons.push('query-coverage-below-policy');
  if (selected.length < RADIO_CATALOG_HEALTHY_MIN_STATIONS) healthReasons.push('station-coverage-below-policy');
  const degraded = healthReasons.length > 0;
  const coverage = {
    successfulQueries,
    totalQueries: queries.length,
    stationCount: selected.length,
    healthyStationMinimum: RADIO_CATALOG_HEALTHY_MIN_STATIONS,
  };
  const nextCatalog = {
    cachedAt: timestamp,
    updatedAt: new Date(timestamp).toISOString(),
    stations: selected.map(publicRadioStation),
    degraded,
    degradedReason: degraded ? healthReasons.join(',') : null,
    coverage,
    catalogInstance,
    stale: false,
  };
  if (degraded && lastHealthyCatalog) {
    const error = new Error('Radio Browser catalog refresh did not meet health policy');
    error.radioCatalogDegraded = true;
    error.radioDegradedReason = nextCatalog.degradedReason;
    error.radioCoverage = coverage;
    throw error;
  }
  if (degraded && !selected.length) {
    const error = new Error('Radio Browser catalog refresh returned no usable stations');
    error.radioCatalogDegraded = true;
    error.radioDegradedReason = nextCatalog.degradedReason;
    error.radioCoverage = coverage;
    throw error;
  }
  if (degraded) {
    // Fresh-but-degraded: no generation is accepted, matching the dev proxy.
    return { ...nextCatalog, acceptedGeneration: null };
  }
  catalogGeneration += 1;
  const payload = { ...nextCatalog, acceptedGeneration: catalogGeneration };
  lastHealthyCatalog = payload;
  return payload;
}

/**
 * Build (or reuse) the directory payload the globe validates.
 * Returns { payload, state } on success; throws with radio* annotations when
 * every source failed and no cacheable payload exists.
 */
export async function getRadioCatalog() {
  const deadlineAt = Date.now() + RADIO_REFRESH_DEADLINE_MS;
  let lastRefreshError = null;
  const { value, state } = await catalogCache.get(
    () => refreshCatalog(deadlineAt).catch((error) => {
      lastRefreshError = error;
      throw error;
    }),
  );
  if (state === 'stale') {
    // Same 7-day stale ceiling the dev proxy enforces before serving cache.
    if (!value || Date.now() - value.cachedAt > RADIO_DIRECTORY_STALE_MS) {
      throw lastRefreshError || new Error('Radio Browser catalog is unavailable');
    }
    return {
      payload: {
        ...value,
        stale: true,
        degraded: true,
        degradedReason: lastRefreshError?.radioDegradedReason || 'refresh-failed',
        coverage: lastRefreshError?.radioCoverage || value.coverage,
      },
      state,
    };
  }
  return { payload: value, state };
}

/**
 * Forward one station click to the Radio Browser counter endpoint.
 * Serverless functions cannot keep the dev proxy's servedStationIds set, so
 * the caller validates the UUID shape first; forwarding (instead of 404-ing)
 * is the documented degradation and keeps the upstream click statistics live.
 */
export async function recordRadioClick(id) {
  await fetchPath(`/json/url/${encodeURIComponent(id)}`, {
    maxBytes: 256 * 1024,
    timeoutMs: 8_000,
    maxMirrors: 2,
  });
}
