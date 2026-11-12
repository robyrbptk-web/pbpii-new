import test from 'node:test';
import assert from 'node:assert/strict';
import { createSituationHandler } from '../proxies/situasi.js';
import { CITIES, getSituation, parseRss, plainText, safeLink, xmlValue } from '../lib/situasi.js';

const RSS = `<?xml version="1.0"?><rss><channel>
  <item><title><![CDATA[PII &amp; Indonesia]]></title><link>https://news.example/a</link>
    <pubDate>Wed, 11 Nov 2026 10:00:00 +0000</pubDate><description>Ringkasan</description></item>
  <item><title>Tanpa tautan aman</title><link>javascript:alert(1)</link></item>
  <item><title>Surat kabar</title><link>https://user:pass@news.example/b</link></item>
</channel></rss>`;

test('RSS parsing strips markup, decodes entities and rejects unsafe links', () => {
  const items = parseRss(RSS, 'Uji');
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'PII & Indonesia');
  assert.equal(items[0].url, 'https://news.example/a');
  assert.equal(items[0].summary, 'Ringkasan');
  assert.equal(items[0].source, 'Uji');
});

test('non-feed documents are rejected rather than parsed as news', () => {
  assert.throws(() => parseRss('<html><body>maintenance</body></html>', 'x'));
  assert.throws(() => parseRss('<html><body><item><title>x</title></item></body></html>', 'x'));
});

test('safe links allow only HTTP(S) without credentials', () => {
  assert.equal(safeLink('https://example.org/a'), 'https://example.org/a');
  assert.equal(safeLink('//example.org/a'), '');
  assert.equal(safeLink('javascript:alert(1)'), '');
  assert.equal(safeLink('https://u:p@example.org/'), '');
  assert.equal(safeLink('data:text/html,x'), '');
});

test('plain text decodes numeric entities and never throws on invalid code points', () => {
  assert.equal(plainText('<b>Halo</b>&#65;&#x42;'), 'Halo AB');
  assert.equal(plainText('&#xD800;'), '');
  assert.equal(plainText(null), '');
});

test('xmlValue is tag-name bound, not an attribute-name search', () => {
  assert.equal(xmlValue('<item><title>Judul</title></item>', 'title'), 'Judul');
  assert.equal(xmlValue('<item data-title="no">Ya</item>', 'title'), '');
});

function callMock(account = { ok: true, data: { role: 'kader' } }) {
  const calls = [];
  return { calls, call: async (body) => { calls.push(body); if (body.action === 'public') return { ok: true, data: { events: [] } }; return account; } };
}

function resMock() {
  const out = { status: 0, body: null, headers: {}, headersSent: false };
  out.setHeader = (key, value) => { out.headers[key.toLowerCase()] = value; };
  out.status = (code) => { out.status = code; return out; };
  out.json = (body) => { out.body = body; out.headersSent = true; return out; };
  return out;
}

test('guest, malformed and expired sessions are denied before any data loader runs', async () => {
  let loaded = 0;
  const handler = createSituationHandler(async () => ({ ok: true, data: { role: 'tamu' } }), async () => { loaded++; return {}; });
  const missing = resMock();
  await handler({ method: 'POST', headers: {}, body: { kind: 'berita' }, socket: {} }, missing);
  assert.equal(missing.status, 401);
  const bad = resMock();
  await handler({ method: 'POST', headers: { authorization: 'Basic abc' }, body: { kind: 'berita' }, socket: {} }, bad);
  assert.equal(bad.status, 401);
  const guest = resMock();
  await handler({ method: 'POST', headers: { authorization: 'Bearer token' }, body: { kind: 'berita' }, socket: {} }, guest);
  assert.equal(guest.status, 401);
  assert.equal(loaded, 0);
});

test('kader, org and admin all pass; responses are private and uncached', async () => {
  for (const role of ['kader', 'org', 'admin']) {
    const { call } = callMock({ ok: true, data: { role } });
    const handler = createSituationHandler(call, async () => ({ items: [{ title: 'x' }], source: 'uji', fetchedAt: '2026-11-11T00:00:00Z' }));
    const res = resMock();
    await handler({ method: 'POST', headers: { authorization: 'Bearer sesi' }, body: { kind: 'gempa', city: 'jakarta' }, socket: {} }, res);
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.headers['cache-control'], 'private, no-store');
    assert.equal(res.headers.vary, 'Authorization');
  }
});

test('session probe returns the role without invoking a source loader', async () => {
  let loaded = 0;
  const { call } = callMock();
  const handler = createSituationHandler(call, async () => { loaded++; return {}; });
  const res = resMock();
  await handler({ method: 'POST', headers: { authorization: 'Bearer sesi' }, body: { kind: 'sesi' }, socket: {} }, res);
  assert.equal(res.body.data.role, 'kader');
  assert.equal(loaded, 0);
});

test('kegiatan keeps only finite in-range coordinates and never exposes editing fields', async () => {
  const call = async (body) => body.action === 'whoami' ? { ok: true, data: { role: 'kader' } } : { ok: true, data: { events: [
    { id: 'a', title: 'Valid', latitude: '-6.2', longitude: '106.8', date: '2026-11-20', endDate: '2026-11-21', location: 'Jakarta', jenjangKaderisasi: 'INTRA', host: { name: 'PB PII', email: 'secret@example.org' }, upcoming: true, participantEmails: ['x@y.z'] },
    { id: 'b', title: 'Nol', latitude: '0', longitude: '0' },
    { id: 'c', title: 'Kosong', latitude: '', longitude: '' },
    { id: 'd', title: 'Kosong null', latitude: null, longitude: 106 },
    { id: 'e', title: 'Luar', latitude: '-90.1', longitude: '106' },
  ] } };
  const handler = createSituationHandler(call, async () => ({}));
  const res = resMock();
  await handler({ method: 'POST', headers: { authorization: 'Bearer sesi' }, body: { kind: 'kegiatan' }, socket: {} }, res);
  const items = res.body.data.items;
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((item) => item.id), ['a', 'b']);
  assert.deepEqual(Object.keys(items[0]).sort(), ['date', 'endDate', 'host', 'id', 'lat', 'level', 'location', 'lon', 'title', 'upcoming', 'url']);
  assert.equal(items[0].host, 'PB PII');
  assert.equal(items[0].url, '/acara.html?event=a');
});

test('method, kind and upstream failures answer honestly without leaking internals', async () => {
  const { call } = callMock();
  const handler = createSituationHandler(call, getSituation);
  const method = resMock();
  await handler({ method: 'GET', headers: { authorization: 'Bearer sesi' }, body: {}, socket: {} }, method);
  assert.equal(method.status, 405);
  const kind = resMock();
  await handler({ method: 'POST', headers: { authorization: 'Bearer sesi' }, body: { kind: '../../secret' }, socket: {} }, kind);
  assert.equal(kind.status, 400);
  const backend = resMock();
  const down = createSituationHandler(async () => ({ ok: false }), getSituation);
  await down({ method: 'POST', headers: { authorization: 'Bearer sesi' }, body: { kind: 'berita' }, socket: {} }, backend);
  assert.equal(backend.status, 503);
});

test('city allow-list is fixed and weather is the only city-scoped choice', () => {
  assert.deepEqual(Object.keys(CITIES), ['jakarta', 'bandung', 'medan', 'surabaya', 'pontianak', 'makassar', 'denpasar', 'jayapura']);
  assert.ok(Object.isFrozen(CITIES));
});
