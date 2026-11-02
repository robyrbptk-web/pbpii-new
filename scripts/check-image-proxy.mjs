import assert from 'node:assert/strict';
import handler from '../api/pii.js';

const originalFetch = globalThis.fetch;
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01]);
let fetchCalls = 0;
let upstreamResponse;

globalThis.fetch = async (url, options) => {
  fetchCalls += 1;
  assert.match(String(url), /^https:\/\/drive\.usercontent\.google\.com\/download\?id=/);
  assert.equal(options.redirect, 'follow');
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
  assert.match(valid.headers['cache-control'], /s-maxage=86400/);
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

  const tooLarge = Buffer.alloc(4 * 1024 * 1024 + 1);
  jpeg.copy(tooLarge);
  upstreamResponse = mockResponse(tooLarge, { status: 200 });
  const oversized = await request('drive-file-id-123456789');
  assert.equal(oversized.statusCode, 413);
  console.log('OK  proxy rejects oversized images');
} finally {
  globalThis.fetch = originalFetch;
}
