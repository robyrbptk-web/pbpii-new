/**
 * Generates the PWA icons from assets/logo-pii.png.
 * Run with `node scripts/make-icons.mjs`; output is committed because Vercel
 * has no image tooling. Only 8-bit RGBA, non-interlaced PNGs are supported,
 * which is what the logo file uses.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(root, 'assets/logo-pii.png');

function decodePng(buffer) {
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString();
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const [depth, color, , , interlace] = [data[8], data[9], data[10], data[11], data[12]];
      if (depth !== 8 || color !== 6 || interlace !== 0) {
        throw new Error(`Unsupported PNG (depth ${depth}, color ${color}, interlace ${interlace})`);
      }
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const pixels = Buffer.alloc(width * height * 4);
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const current = Buffer.alloc(stride);
    for (let x = 0; x < stride; x += 1) {
      const left = x >= 4 ? current[x - 4] : 0;
      const up = previous[x];
      const upLeft = x >= 4 ? previous[x - 4] : 0;
      let value = line[x];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        value += pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      current[x] = value & 0xff;
    }
    current.copy(pixels, y * stride);
    previous = current;
  }
  return { width, height, pixels };
}

function encodePng(width, height, pixels) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const chunk = (type, data) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'ascii');
    const crcTable = chunk.table || (chunk.table = Array.from({ length: 256 }, (_, n) => {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      return c >>> 0;
    }));
    let crc = 0xffffffff;
    for (const byte of Buffer.concat([head.subarray(4), data])) {
      crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 0);
    return Buffer.concat([head, data, tail]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Box-filter resize in premultiplied alpha so edges do not fringe. */
function resize({ width, height, pixels }, targetWidth, targetHeight) {
  const out = Buffer.alloc(targetWidth * targetHeight * 4);
  const scaleX = width / targetWidth;
  const scaleY = height / targetHeight;
  for (let y = 0; y < targetHeight; y += 1) {
    const y0 = Math.floor(y * scaleY);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * scaleY));
    for (let x = 0; x < targetWidth; x += 1) {
      const x0 = Math.floor(x * scaleX);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * scaleX));
      let r = 0; let g = 0; let b = 0; let a = 0; let count = 0;
      for (let sy = y0; sy < y1; sy += 1) {
        for (let sx = x0; sx < x1; sx += 1) {
          const index = (sy * width + sx) * 4;
          const alpha = pixels[index + 3] / 255;
          r += pixels[index] * alpha;
          g += pixels[index + 1] * alpha;
          b += pixels[index + 2] * alpha;
          a += alpha;
          count += 1;
        }
      }
      const index = (y * targetWidth + x) * 4;
      const alpha = a / count;
      out[index] = alpha ? Math.round(r / a) : 0;
      out[index + 1] = alpha ? Math.round(g / a) : 0;
      out[index + 2] = alpha ? Math.round(b / a) : 0;
      out[index + 3] = Math.round(alpha * 255);
    }
  }
  return { width: targetWidth, height: targetHeight, pixels: out };
}

function blank(size, [r, g, b]) {
  const pixels = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i += 1) {
    pixels[i * 4] = r;
    pixels[i * 4 + 1] = g;
    pixels[i * 4 + 2] = b;
    pixels[i * 4 + 3] = 255;
  }
  return { width: size, height: size, pixels };
}

/** Draw `logo` centred on a solid tile, occupying `ratio` of the tile height. */
function compose(size, ratio, background) {
  const tile = blank(size, background);
  const target = Math.round(size * ratio);
  const scaled = resize(logo, Math.round((target * logo.width) / logo.height), target);
  const left = Math.round((size - scaled.width) / 2);
  const top = Math.round((size - scaled.height) / 2);
  for (let y = 0; y < scaled.height; y += 1) {
    for (let x = 0; x < scaled.width; x += 1) {
      const source = (y * scaled.width + x) * 4;
      const alpha = scaled.pixels[source + 3] / 255;
      if (!alpha) continue;
      const targetIndex = ((top + y) * size + left + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        tile.pixels[targetIndex + channel] = Math.round(
          scaled.pixels[source + channel] * alpha + tile.pixels[targetIndex + channel] * (1 - alpha),
        );
      }
      tile.pixels[targetIndex + 3] = 255;
    }
  }
  return tile;
}

const logo = decodePng(readFileSync(SOURCE));
console.log(`logo ${logo.width}x${logo.height}`);

const BRAND = [12, 41, 72];
const OUTPUTS = [
  ['assets/icon-192.png', compose(192, 0.84, [255, 255, 255])],
  ['assets/icon-512.png', compose(512, 0.84, [255, 255, 255])],
  ['assets/icon-maskable-512.png', compose(512, 0.6, BRAND)],
  ['assets/apple-touch-icon.png', compose(180, 0.8, [255, 255, 255])],
];

for (const [path, image] of OUTPUTS) {
  writeFileSync(join(root, path), encodePng(image.width, image.height, image.pixels));
  console.log(`wrote ${path}`);
}
