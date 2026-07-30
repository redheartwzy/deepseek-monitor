const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

function crc32(buf) {
  let c = 0xFFFFFFFF;
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let x = i;
    for (let j = 0; j < 8; j++) x = x & 1 ? 0xEDB88320 ^ (x >>> 1) : x >>> 1;
    t[i] = x;
  }
  for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const l = Buffer.alloc(4);
  l.writeUInt32BE(data.length);
  const d = Buffer.concat([t, data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc32(d));
  return Buffer.concat([l, t, data, c]);
}

function makeIcon(size) {
  const row = size * 4 + 1;
  const raw = Buffer.alloc(row * size);
  for (let y = 0; y < size; y++) {
    raw[y * row] = 0;
    for (let x = 0; x < size; x++) {
      const cx = size / 2, cy = size / 2, ml = size / 2 - 1;
      const inC = ((x - cx) ** 2 + (y - cy) ** 2) <= ml * ml;
      const o = y * row + 1 + x * 4;
      if (inC) {
        raw[o] = 59;
        raw[o + 1] = 130;
        raw[o + 2] = 246;
        raw[o + 3] = 255;
      } else {
        raw[o] = 0;
        raw[o + 1] = 0;
        raw[o + 2] = 0;
        raw[o + 3] = 0;
      }
    }
  }
  const ih = Buffer.alloc(13);
  ih.writeUInt32BE(size, 0);
  ih.writeUInt32BE(size, 4);
  ih[8] = 8;
  ih[9] = 6; // RGBA
  ih[10] = 0;
  ih[11] = 0;
  ih[12] = 0;
  const sg = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  return Buffer.concat([
    sg, chunk('IHDR', ih),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// Electron tray icon (32x32)
fs.writeFileSync(path.join(__dirname, '..', 'icon.png'), makeIcon(32));
console.log('icon.png (32x32) created');

// PWA icons
const iconsDir = path.join(__dirname, '..', 'public', 'icons');
if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir, { recursive: true });
fs.writeFileSync(path.join(iconsDir, 'icon-192.png'), makeIcon(192));
fs.writeFileSync(path.join(iconsDir, 'icon-512.png'), makeIcon(512));
console.log('PWA icons created (192x192, 512x512)');
