const zlib = require('node:zlib');

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function createTrayIconBuffer(size = 32) {
  const stride = size * 4 + 1;
  const pixels = Buffer.alloc(stride * size);
  const center = (size - 1) / 2;
  const radius = size * 0.43;

  for (let y = 0; y < size; y += 1) {
    pixels[y * stride] = 0;
    for (let x = 0; x < size; x += 1) {
      const offset = y * stride + 1 + x * 4;
      const inside = Math.hypot(x - center, y - center) <= radius;
      const lens = Math.hypot(x - center + size * 0.08, y - center + size * 0.1) <= radius * 0.52;
      pixels[offset] = inside ? (lens ? 239 : 85) : 0;
      pixels[offset + 1] = inside ? (lens ? 246 : 116) : 0;
      pixels[offset + 2] = inside ? 255 : 0;
      pixels[offset + 3] = inside ? 255 : 0;
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

module.exports = { createTrayIconBuffer };
