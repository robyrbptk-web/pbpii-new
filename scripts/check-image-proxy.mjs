import assert from 'node:assert/strict';
import handler from '../api/pii.js';

const originalFetch = globalThis.fetch;
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01]);
let fetchCalls = 0;
let upstreamResponse;
let scaledResponse = null;

globalThis.fetch = async (url, options) => {
  fetchCalls += 1;
  const teks = String(url);
  const unduhan = /^https:\/\/drive\.usercontent\.google\.com\/download\?id=/.test(teks);
  assert.ok(unduhan || /^https:\/\/drive\.google\.com\/thumbnail\?id=/.test(teks),
    'URL tak dikenal: ' + teks);
  assert.equal(options.redirect, 'follow');
  if (!unduhan) {
    if (!scaledResponse) throw new Error('bentuk berskala tidak tersedia');
    return scaledResponse;
  }
  return upstreamResponse;
};

function mockResponse(body, options = {}) {
  const result = new Response(body, options);
  Object.defineProperty(result, 'url', { value: 'https://drive.usercontent.google.com/download?id=drive-file-id-123456789' });
  return result;
}

function response() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(value) { this.body = value; return this; }
  };
}

async function request(imageId) {
  const res = response();
  await handler({ method: 'GET', query: { imageId }, headers: {} }, res);
  return res;
}

try {
  const invalid = await request('https://example.com/image.jpg');
  assert.equal(invalid.statusCode, 400);
  assert.equal(fetchCalls, 0);

  upstreamResponse = mockResponse(jpeg, { status: 200, headers: { 'Content-Type': 'text/html' } });
  const valid = await request('drive-file-id-123456789');
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.headers['content-type'], 'image/jpeg');
  assert.deepEqual(valid.body, jpeg);
  assert.match(valid.headers['cache-control'], /s-maxage=21600/);
  console.log('OK  same-origin proxy returns validated JPEG bytes with cache headers');

  const legacyBytes = Buffer.from(Array.from(jpeg, (byte) => byte > 127 ? byte - 256 : byte).join(','));
  upstreamResponse = mockResponse(legacyBytes, { status: 200, headers: { 'Content-Type': 'image/jpeg' } });
  const restored = await request('drive-file-id-123456789');
  assert.equal(restored.statusCode, 200);
  assert.deepEqual(restored.body, jpeg);
  console.log('OK  legacy numeric-byte uploads are restored to binary images');

  upstreamResponse = mockResponse('<html>access denied</html>', { status: 200 });
  const invalidImage = await request('drive-file-id-123456789');
  assert.equal(invalidImage.statusCode, 502);
  assert.match(invalidImage.body.error, /bukan gambar/);
  console.log('OK  Drive HTML/error responses are never served as images');

  /* Foto kamera mudah melewati 4 MB. Bentuk berskala Google diminta lebih dulu;
     kalau gagal, berkas asli tetap dikirim utuh — menampilkan gambar lebih
     penting daripada menghemat bandwidth. */
  const tooLarge = Buffer.alloc(4 * 1024 * 1024 + 1);
  jpeg.copy(tooLarge);
  upstreamResponse = mockResponse(tooLarge, { status: 200 });
  const scaled = Buffer.concat([jpeg, Buffer.alloc(1200)]);
  scaledResponse = mockResponse(scaled, { status: 200, headers: { 'Content-Type': 'image/jpeg' } });
  const ringan = await request('drive-file-id-123456789');
  assert.equal(ringan.statusCode, 200);
  assert.deepEqual(ringan.body, scaled);
  assert.equal(ringan.headers['content-type'], 'image/jpeg');
  console.log('OK  oversized photos prefer the scaled Google rendition');

  scaledResponse = null;
  upstreamResponse = mockResponse(tooLarge, { status: 200 });
  const utuh = await request('drive-file-id-123456789');
  assert.equal(utuh.statusCode, 200);
  assert.equal(utuh.body.length, tooLarge.length);
  assert.equal(utuh.headers['content-type'], 'image/jpeg');
  console.log('OK  oversized photos still serve whole when no scaled rendition exists');

  upstreamResponse = mockResponse(Buffer.alloc(16 * 1024 * 1024 + 1), { status: 200 });
  const oversized = await request('drive-file-id-123456789');
  assert.equal(oversized.statusCode, 413);
  console.log('OK  proxy rejects responses beyond the Drive ceiling');
} finally {
  globalThis.fetch = originalFetch;
}
