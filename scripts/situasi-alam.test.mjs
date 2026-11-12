// Offline: node --test scripts/situasi-alam.test.mjs
// Opt-in, one bounded call per loader: node scripts/situasi-alam.test.mjs --live
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SOURCES, fetchNatureSource, createNatureLoaders,
  parseEarthquakes, parseAlertFeed, parseCap, parseVolcanoCoordinates,
  parseVolcanoes, parseHotspots, parseFlights,
  earthquakes, alerts, volcanoes, hotspots, flights,
} from '../lib/situasi-alam.js';

const NOW = Date.parse('2026-11-11T14:30:00Z');
const capUrl = (id) => `https://www.bmkg.go.id/alerts/nowcast/id/${id}_alert.xml`;
const ring = '-6,106 -6,107 -7,107 -6,106';
const ring2 = '-8,110 -8,111 -9,111 -8,110';
const feed = (urls) => `<rss><channel>${urls.map((url) => `<item><link>${url}</link></item>`).join('')}</channel></rss>`;
function cap({ id = 'alert-1', status = 'Actual', msgType = 'Alert', scope = 'Public', effective = '2026-11-11T21:00:00+07:00', expires = '2026-11-11T22:00:00+07:00', references = '', extra = '', info = true } = {}) {
  return `<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
    <identifier>${id}</identifier><sent>2026-11-11T20:53:00+07:00</sent>
    <status>${status}</status><msgType>${msgType}</msgType><scope>${scope}</scope><references>${references}</references>
    ${info ? `<info><language>id</language><headline><![CDATA[Hujan <b>Lebat</b> &amp; Petir]]></headline>
      <description>Waspada &#97;ngin.</description><effective>${effective}</effective><expires>${expires}</expires>
      <severity>Moderate</severity><certainty>Observed</certainty><urgency>Immediate</urgency>
      <instruction>Ikuti arahan BMKG.</instruction>
      <area><areaDesc>Jawa Barat</areaDesc><polygon>${ring}</polygon><polygon>${ring2}</polygon></area>
      ${extra}</info>` : ''}</alert>`;
}
const quake = (extra = {}) => ({ DateTime: '2026-11-11T13:00:00+00:00', Coordinates: '-6.10,105.30',
  Magnitude: '5.1', Kedalaman: '10 km', Wilayah: 'Barat Daya Sumur', Potensi: 'Tidak berpotensi tsunami', ...extra });
const gempa = (rows) => ({ Infogempa: { gempa: rows } });
const coordinatesHtml = `<table><tbody>
  <tr><td><a href="/v1/gunung-api/anak-krakatau">Anak Krakatau</a></td><td>-6.102</td><td>105.423</td></tr>
  <tr><td>Merapi</td><td>-7.54</td><td>110.44</td></tr>
  <tr><td>Lewotobi Laki-laki</td><td>-8.542</td><td>122.775</td></tr>
  <tr><td>Agung</td><td>-8.342</td><td>115.508</td></tr>
  <tr><td>Invalid</td><td></td><td>120</td></tr>
  </tbody></table>`;
const activityHtml = `<table><tbody>
  <tr><td rowspan="1"><a>Level IV (Awas)</a><span>Deskripsi</span></td><td rowspan="1">0</td><td>Tidak ada gunung api Level IV (Awas)</td></tr>
  <tr><td rowspan="3"><a>Level III (Siaga)</a><span>Hasil pengamatan visual</span></td><td rowspan="3">2</td></tr>
  <tr><td>Anak Krakatau - Lampung <a href="https://magma.esdm.go.id/v1/gunung-api/laporan/1?signature=public&amp;x=1">Lihat laporan</a><br></td></tr>
  <tr><td>Merapi - Daerah Istimewa Yogyakarta dan Jawa Tengah <a href="javascript:alert(1)">Lihat laporan</a></td></tr>
  <tr><td rowspan="2">Level II (Waspada)</td><td rowspan="2">1</td></tr>
  <tr><td>Lewotobi Laki-laki - Nusa Tenggara Timur <a href="/v1/gunung-api/laporan/2">Lihat laporan</a></td></tr>
  <tr><td rowspan="3">Level I (Normal)</td><td rowspan="3">2</td></tr>
  <tr><td>Agung - Bali <a href="/v1/gunung-api/laporan/3">Lihat laporan</a></td></tr>
  <tr><td>Unmatched - Province</td></tr>
  <tr><td>Not a volcano - Must not inherit an exhausted rowspan</td></tr>
</tbody></table><table><tr><td>Other table - Not a volcano</td></tr></table>`;
function hotspotFeature({ lon = 128.0479, lat = -1.70964, satellite = 'NASA-MODIS', time = '2026-11-11T07:20:00.000000Z', ...extra } = {}) {
  return { type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: {
    hs_id: 'shared-not-unique', date_hotspot_ori: time, sumber: satellite, confidence: 0, confidence_level: 'low',
    desa: 'Wooi', kabkota: 'Halmahera Selatan', nama_provinsi: 'Maluku Utara', ...extra,
  } };
}
const geojson = (features) => ({ type: 'FeatureCollection', features });
const state = (overrides = {}) => Object.assign(['8a0001', '  GA123  ', 'Indonesia', NOW / 1000 - 60, NOW / 1000 - 10, 106.8, -6.2, 10000, false, 220, 0], overrides);
const mockLoaders = (values, now = () => NOW) => createNatureLoaders({ now, fetchSource: async (url) => {
  if (!Object.hasOwn(values, url)) throw new Error('Fixture source unavailable');
  return typeof values[url] === 'string' ? values[url] : JSON.stringify(values[url]);
} });
function assertShape(result) {
  assert.ok(Array.isArray(result.items));
  assert.equal(typeof result.source, 'string');
  assert.equal(typeof result.note, 'string');
  for (const item of result.items) {
    for (const field of ['title', 'lat', 'lon', 'time', 'summary', 'url']) assert.ok(Object.hasOwn(item, field), `missing ${field}`);
    assert.ok(item.lat === null || (Number.isFinite(item.lat) && Math.abs(item.lat) <= 90));
    assert.ok(item.lon === null || (Number.isFinite(item.lon) && Math.abs(item.lon) <= 180));
    assert.ok(item.time === null || Number.isFinite(Date.parse(item.time)));
    assert.match(item.url, /^https:\/\//);
  }
  assert.equal(new Set(result.items.map((item) => item.id)).size, result.items.length);
}

test('all five named exports are async functions without importing situasi.js', () => {
  for (const loader of [earthquakes, alerts, volcanoes, hotspots, flights]) assert.equal(loader.constructor.name, 'AsyncFunction');
});

test('earthquakes union array/object feeds, dedupe time plus lat/lon, and retain felt data', async () => {
  const loader = mockLoaders({
    [SOURCES.earthquakes]: gempa([quake(), quake({ Coordinates: ' -6.100 , 105.300 ', DateTime: '2026-11-11T20:00:00+07:00' })]),
    [SOURCES.latestEarthquake]: gempa(quake({ Coordinates: '-7,110', DateTime: '2026-11-11T14:00:00Z', Magnitude: '3.2' })),
    [SOURCES.feltEarthquakes]: gempa([quake({ Dirasakan: 'II-III Sumur' })]),
  });
  const pack = await loader.earthquakes();
  assertShape(pack);
  assert.equal(pack.partial, false);
  assert.equal(pack.items.length, 2);
  assert.equal(pack.items[0].magnitude, 3.2);
  const item = pack.items[1];
  assert.equal(item.lat, -6.1);
  assert.equal(item.lon, 105.3);
  assert.equal(item.time, '2026-11-11T13:00:00.000Z');
  assert.equal(item.depth, 10);
  assert.equal(item.magnitude, 5.1);
  assert.equal(item.felt, 'II-III Sumur');
  assert.match(item.summary, /Tidak berpotensi tsunami.*II-III Sumur/);
  assert.equal(item.feeds.length, 2);
});

test('earthquake missing values are not coerced to zero; bad coordinates are discarded', () => {
  const rows = parseEarthquakes(gempa([quake({ Magnitude: '', Kedalaman: null, DateTime: '' }),
    quake({ Coordinates: '0,0' }), quake({ Coordinates: ',106' }), quake({ Coordinates: '-6,181' }), quake({ Coordinates: '106,-6' })]));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].magnitude, null);
  assert.equal(rows[0].depth, null);
  assert.equal(rows[0].time, null);
  assert.equal(rows[1].lat, 0);
  assert.throws(() => parseEarthquakes({ error: 'changed shape' }), /Format/);
});

test('earthquakes return partial successes, but propagate total upstream failure', async () => {
  const pack = await mockLoaders({ [SOURCES.latestEarthquake]: gempa(quake()) }).earthquakes();
  assert.equal(pack.partial, true);
  assert.equal(pack.items.length, 1);
  await assert.rejects(mockLoaders({}).earthquakes(), /belum dapat/);
});

test('CAP feed admits only unique exact HTTPS BMKG detail paths', () => {
  const valid = capUrl('CSB20261111007');
  const invalid = [
    'http://www.bmkg.go.id/alerts/nowcast/id/a_alert.xml',
    'https://www.bmkg.go.id.evil.test/alerts/nowcast/id/a_alert.xml',
    'https://www.bmkg.go.id@evil.test/alerts/nowcast/id/a_alert.xml',
    'https://evil.test/alerts/nowcast/id/a_alert.xml',
    'https://www.bmkg.go.id/alerts/nowcast/id/../a_alert.xml',
    'https://www.bmkg.go.id/alerts/nowcast/id/%2e%2e_alert.xml',
    `${valid}?redirect=evil`, `${valid}#fragment`, '/alerts/nowcast/id/a_alert.xml',
    'https://www.bmkg.go.id:443/alerts/nowcast/id/a_alert.xml',
  ];
  assert.deepEqual(parseAlertFeed(feed([valid, ...invalid, valid])), [valid]);
  assert.throws(() => parseAlertFeed('<html>Unavailable</html>'), /XML/);
  assert.throws(() => parseAlertFeed('<!DOCTYPE rss [<!ENTITY a SYSTEM "file:///etc/passwd">]><rss/>'), /XML/);
});

test('CAP retains all valid polygons, lat/lon ordering and validity/status fields', () => {
  const [item] = parseCap(cap({ extra: '<area><areaDesc>Bad ring</areaDesc><polygon>106,-6 107,-6 107,-7 106,-6</polygon></area>' }), capUrl('a'), NOW);
  assert.equal(item.title, 'Hujan Lebat & Petir');
  assert.equal(item.summary, 'Waspada angin.');
  assert.equal(item.polygons.length, 2);
  assert.deepEqual(item.polygons[0][0], [-6, 106]);
  assert.deepEqual(item.polygons[1][0], [-8, 110]);
  assert.equal(item.lat, -6);
  assert.equal(item.lon, 106);
  assert.equal(item.effective, '2026-11-11T14:00:00.000Z');
  assert.equal(item.expires, '2026-11-11T15:00:00.000Z');
  assert.equal(item.severity, 'Moderate');
  assert.equal(item.certainty, 'Observed');
  assert.equal(item.status, 'Actual');
  assert.equal(item.msgType, 'Alert');
  assert.equal(item.validity, 'active');
  assert.equal(item.active, true);
});

test('expired, future, unknown, test, private and cancelled CAPs never supply map fills', () => {
  const cases = [
    [{ expires: '2026-11-11T14:30:00Z' }, 'expired'],
    [{ effective: '2026-11-11T14:45:00Z' }, 'upcoming'],
    [{ expires: '' }, 'unknown'], [{ effective: 'invalid' }, 'unknown'],
    [{ effective: '2026-11-11T16:00:00Z' }, 'unknown'],
    [{ status: 'Test' }, 'non-operational'], [{ scope: 'Restricted' }, 'non-operational'],
    [{ msgType: 'Cancel' }, 'cancelled'],
  ];
  for (const [options, validity] of cases) {
    const [item] = parseCap(cap(options), capUrl('a'), NOW);
    assert.deepEqual(item.polygons, []);
    assert.equal(item.active, false);
    assert.equal(item.polygonCount, 2);
    assert.equal(item.validity, validity);
    assert.equal(item.severity, 'Moderate');
  }
  assert.equal(parseCap(cap({ expires: '2026-11-11T14:30:00Z' }), capUrl('a'), NOW)[0].expired, true);
  assert.equal(parseCap(cap({ effective: '' }), capUrl('a'), NOW)[0].effective, '2026-11-11T13:53:00.000Z');
});

test('CAP handles namespaces and multiple info languages, rejects malformed and unclosed rings', () => {
  const namespaced = cap().replace(/<(\/)?(\w+)(?=[\s>])/g, '<$1cap:$2');
  assert.equal(parseCap(namespaced, capUrl('a'), NOW)[0].polygons.length, 2);
  const bilingual = cap().replace('</alert>', '<info><language>en-US</language><headline>English duplicate</headline></info></alert>');
  assert.equal(parseCap(bilingual, capUrl('a'), NOW).length, 1);
  const broken = cap().replace(ring, '-6,106 -6,107 -7,107 -7,106').replace(ring2, '-6,106 -6,106 -6,106 -6,106');
  assert.deepEqual(parseCap(broken, capUrl('a'), NOW)[0].polygons, []);
  assert.throws(() => parseCap('<alert/>', capUrl('a'), NOW), /identifier/);
  assert.throws(() => parseCap(cap({ info: false }), capUrl('a'), NOW), /info/);
});

test('alerts use at most 4 simultaneous requests, at most 20 details, and a shared deadline/budget', async () => {
  const urls = Array.from({ length: 25 }, (_, i) => capUrl(`test${i}`));
  let active = 0, peak = 0;
  const requested = [], signals = [], budgets = [];
  const loader = createNatureLoaders({ now: () => NOW, fetchSource: async (url, options) => {
    requested.push(url); signals.push(options.signal); budgets.push(options.budget);
    if (url === SOURCES.alerts) return feed([...urls, 'https://evil.test/should-not-fetch']);
    active++; peak = Math.max(peak, active);
    await new Promise((resolve) => setImmediate(resolve));
    active--;
    if (url === urls[0]) throw new Error('One CAP unavailable');
    return cap({ id: url });
  } });
  const pack = await loader.alerts();
  assertShape(pack);
  assert.equal(peak, 4);
  assert.equal(requested.length, 21);
  assert.ok(!requested.includes(urls[20]));
  assert.equal(pack.items.length, 19);
  assert.equal(pack.partial, true);
  assert.equal(new Set(signals).size, 1);
  assert.equal(new Set(budgets).size, 1);
  assert.equal(budgets[0].remaining, 3_500_000);
});

test('alerts keep empty RSS distinct from upstream/detail failures and stop scheduling exhausted budgets', async () => {
  assert.deepEqual((await mockLoaders({ [SOURCES.alerts]: '<rss><channel/></rss>' }).alerts()).items, []);
  await assert.rejects(mockLoaders({}).alerts());
  await assert.rejects(mockLoaders({ [SOURCES.alerts]: feed([capUrl('a')]) }).alerts(), /Detail/);
  let details = 0;
  const loader = createNatureLoaders({ now: () => NOW, fetchSource: async (url, { budget }) => {
    if (url === SOURCES.alerts) return feed(Array.from({ length: 20 }, (_, i) => capUrl(`b${i}`)));
    details++; budget.remaining = 0;
    return cap();
  } });
  assert.equal((await loader.alerts()).partial, true);
  assert.equal(details, 1);
});

test('CAP cancellation and update references disable earlier polygons without removing list items', async () => {
  for (const msgType of ['Cancel', 'Update']) {
    const pack = await mockLoaders({
      [SOURCES.alerts]: feed([capUrl('old'), capUrl('new')]),
      [capUrl('old')]: cap({ id: 'old-id' }),
      [capUrl('new')]: cap({ id: 'new-id', msgType, info: msgType !== 'Cancel', references: 'sender,old-id,2026-11-11T13:53:00Z' }),
    }).alerts();
    const old = pack.items.find((item) => item.identifier === 'old-id');
    assert.equal(pack.items.length, 2);
    assert.deepEqual(old.polygons, []);
    assert.equal(old.active, false);
    assert.equal(old.validity, msgType === 'Cancel' ? 'cancelled' : 'superseded');
  }
});

test('MAGMA parses rowspanned levels and name/province cells, matching real catalog coordinates only', () => {
  const positions = parseVolcanoCoordinates(coordinatesHtml);
  const items = parseVolcanoes(activityHtml, positions);
  assertShape({ items, source: 'fixture', note: '' });
  assert.equal(items.length, 5);
  assert.deepEqual(items.map((item) => item.level), [3, 3, 2, 1, 1]);
  assert.equal(items[0].lat, -6.102);
  assert.equal(items[0].lon, 105.423);
  assert.match(items[0].url, /signature=public&x=1$/);
  assert.equal(items[1].province, 'Daerah Istimewa Yogyakarta dan Jawa Tengah');
  assert.ok(!items[1].url.startsWith('javascript:'));
  assert.equal(items[2].title, 'Lewotobi Laki-laki');
  assert.equal(items[2].levelLabel, 'Level II (Waspada)');
  assert.equal(items[4].lat, null);
  assert.equal(items[4].lon, null);
  assert.equal(items[4].coordinateSource, null);
  assert.ok(items.every((item) => item.time === null));
  assert.throws(() => parseVolcanoes('<html>Maintenance</html>'), /MAGMA/);
  assert.throws(() => parseVolcanoCoordinates('<html>Maintenance</html>'), /Koordinat/);
});

test('MAGMA ambiguous name matches do not invent positions; coordinate failures preserve status records', async () => {
  const positions = parseVolcanoCoordinates(`${coordinatesHtml}<table><tr><td>ANAK-KRAKATAU</td><td>-6</td><td>106</td></tr></table>`);
  assert.equal(parseVolcanoes(activityHtml, positions)[0].lat, null);
  const pack = await mockLoaders({ [SOURCES.volcanoes]: activityHtml }).volcanoes();
  assert.equal(pack.partial, true);
  assert.equal(pack.items.length, 5);
  assert.ok(pack.items.every((item) => item.lat === null && item.time === null));
  await assert.rejects(mockLoaders({ [SOURCES.volcanoCoordinates]: coordinatesHtml }).volcanoes(), /Tingkat/);
});

test('SIPONGI uses GeoJSON lon/lat and satellite+time+coordinate identity, not hs_id', () => {
  const items = parseHotspots(geojson([
    hotspotFeature(), hotspotFeature(), hotspotFeature({ lon: 129 }),
    hotspotFeature({ satellite: 'NASA-NOAA20' }), hotspotFeature({ time: '2026-11-11T07:25:00Z' }),
    hotspotFeature({ lat: '' }), hotspotFeature({ lon: 190 }),
    { ...hotspotFeature(), geometry: { type: 'Polygon', coordinates: [[[128, -1]]] } },
  ]));
  assertShape({ items, source: 'fixture', note: '' });
  assert.equal(items.length, 4);
  assert.equal(items[0].time, '2026-11-11T07:25:00.000Z');
  assert.equal(items[1].lat, -1.70964);
  assert.equal(items[1].lon, 128.0479);
  assert.equal(items[1].confidence, 'low');
  assert.equal(items[1].confidenceScore, 0);
  assert.ok(items.every((item) => item.confirmedFire === false));
  assert.equal(items[1].village, 'Wooi');
  assert.equal(parseHotspots(geojson([hotspotFeature({ time: '2026-11-11 14:20:00' })]))[0].time, null);
  assert.deepEqual(parseHotspots(geojson([])), []);
  assert.throws(() => parseHotspots({ features: [] }), /SIPONGI/);
});

test('hotspot loader uses the exact public URL and explains detections are not confirmed fires', async () => {
  const pack = await mockLoaders({ [SOURCES.hotspots]: geojson([hotspotFeature()]) }).hotspots();
  assertShape(pack);
  assert.match(SOURCES.hotspots, /satelit\[\]=NASA-MODIS.*NASA-NOAA20.*NASA-NOAA21/);
  assert.match(pack.note, /BUKAN kebakaran terkonfirmasi/);
});

test('OpenSky vector indexes, units, snapshot time and 5-minute stale boundary', () => {
  const result = parseFlights({ time: NOW / 1000 - 20, states: [state(),
    state({ 0: '8a0002', 3: NOW / 1000 - 300 }),
    state({ 0: '8a0003', 3: NOW / 1000 - 301, 4: NOW / 1000 }),
    state({ 0: '8a0004', 3: null, 7: null, 9: null, 10: null }),
  ] }, NOW);
  assertShape({ ...result, source: 'fixture', note: '' });
  assert.equal(result.snapshotTime, '2026-11-11T14:29:40.000Z');
  const [item, boundary, old, unknown] = result.items;
  assert.equal(item.title, 'GA123');
  assert.equal(item.lat, -6.2);
  assert.equal(item.lon, 106.8);
  assert.equal(item.altitude, 10000);
  assert.equal(item.speed, 220);
  assert.equal(item.heading, 0);
  assert.equal(item.time, '2026-11-11T14:29:00.000Z');
  assert.equal(item.lastContact, '2026-11-11T14:29:50.000Z');
  assert.equal(item.positionAgeSeconds, 60);
  assert.equal(item.stale, false);
  assert.equal(boundary.stale, false);
  assert.equal(old.stale, true);
  assert.equal(old.lastContact, '2026-11-11T14:30:00.000Z');
  assert.equal(unknown.time, null);
  assert.equal(unknown.stale, true);
  assert.equal(unknown.altitude, null);
  assert.equal(unknown.heading, null);
});

test('OpenSky rejects absent/out-of-box points, duplicate aircraft and invalid schema, not empty snapshots', () => {
  const result = parseFlights({ time: NOW / 1000, states: [state(), state(),
    state({ 0: '8a0002', 5: null }), state({ 0: '8a0003', 6: '' }),
    state({ 0: '8a0004', 5: 142 }), state({ 0: '8a0005', 6: -12 }),
    state({ 0: 'bad id' }), state({ 0: '8a0006', 5: 95, 6: 0, 7: -20, 9: 0, 10: 360 }),
  ] }, NOW);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[1].lat, 0);
  assert.equal(result.items[1].altitude, -20);
  assert.equal(result.items[1].speed, 0);
  assert.equal(result.items[1].heading, null);
  assert.deepEqual(parseFlights({ time: NOW / 1000, states: null }, NOW).items, []);
  assert.throws(() => parseFlights({ time: NOW / 1000, error: 'quota' }), /OpenSky/);
  assert.throws(() => parseFlights({ time: null, states: [] }), /OpenSky/);
});

test('flights make one OpenSky request, with no alternative/ADSBlol requests', async () => {
  let requests = 0;
  const loader = createNatureLoaders({ now: () => NOW, fetchSource: async (url) => {
    requests++;
    assert.equal(url, SOURCES.flights);
    return JSON.stringify({ time: NOW / 1000, states: [state()] });
  } });
  const pack = await loader.flights();
  assertShape(pack);
  assert.equal(requests, 1);
  assert.match(pack.note, /30 menit/);
});

test('bounded fetch forbids unapproved URLs, redirects and HTTP errors', async (t) => {
  await assert.rejects(fetchNatureSource('https://evil.test/'), /tidak diizinkan/);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls++;
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    return new Response('quota', { status: 429 });
  });
  await assert.rejects(fetchNatureSource(SOURCES.flights), /HTTP 429/);
  assert.equal(calls, 1);
});

test('bounded fetch rejects oversized declared and streamed bodies and shared alert budgets', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('small', { headers: { 'content-length': '3500001' } }));
  await assert.rejects(fetchNatureSource(SOURCES.alerts), /terlalu besar/);
  t.mock.method(globalThis, 'fetch', async () => new Response(new Uint8Array(3_500_001)));
  await assert.rejects(fetchNatureSource(SOURCES.hotspots), /terlalu besar/);
  t.mock.method(globalThis, 'fetch', async () => new Response('123456'));
  const budget = { remaining: 10 };
  assert.equal(await fetchNatureSource(SOURCES.alerts, { budget }), '123456');
  assert.equal(budget.remaining, 4);
  await assert.rejects(fetchNatureSource(capUrl('a'), { budget }), /terlalu besar/);
});

test('bounded fetch honors pre-aborted group signals without issuing a request', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response('unexpected'); });
  await assert.rejects(fetchNatureSource(SOURCES.alerts, { signal: AbortSignal.abort() }));
  assert.equal(calls, 0);
});

test('bounded fetch aborts a stalled request at exactly 12 seconds', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal;
  t.mock.method(globalThis, 'fetch', async (_, options) => {
    signal = options.signal;
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  });
  const pending = fetchNatureSource(SOURCES.flights);
  const rejection = assert.rejects(pending, /12 detik/);
  t.mock.timers.tick(11_999);
  assert.equal(signal.aborted, false);
  t.mock.timers.tick(1);
  await rejection;
  assert.equal(signal.aborted, true);
});

const live = process.argv.includes('--live');
for (const name of ['earthquakes', 'alerts', 'volcanoes', 'hotspots', 'flights']) {
  test(`live probe: ${name} (opt-in, one loader invocation)`, { skip: !live }, async () => {
    let requests = 0, bytes = 0;
    const loaders = createNatureLoaders({ fetchSource: async (url, options) => {
      requests++;
      const body = await fetchNatureSource(url, options);
      bytes += Buffer.byteLength(body);
      return body;
    } });
    const pack = await loaders[name]();
    assertShape(pack);
    const extra = name === 'alerts' ? { active: pack.items.filter((i) => i.active).length,
      expired: pack.items.filter((i) => i.expired).length, polygons: pack.items.reduce((n, i) => n + i.polygons.length, 0) }
      : name === 'flights' ? { snapshotTime: pack.snapshotTime, stale: pack.items.filter((i) => i.stale).length } : {};
    console.log(JSON.stringify({ live: name, requests, bytes, items: pack.items.length,
      located: pack.items.filter((i) => i.lat !== null && i.lon !== null).length, partial: pack.partial ?? false,
      fields: Object.keys(pack.items[0] || {}), ...extra }));
  });
}
