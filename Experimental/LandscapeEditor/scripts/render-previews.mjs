// Render preset previews (hypsometric + hillshade) as PNGs for visual checks.
import { writeFileSync } from 'fs';
import { deflateSync } from 'zlib';
import { presets, makeDocument } from '../presets.js';
import { compositeStack, computeSignals } from '../terrain.js';
import { compositeSatmap } from '../satmap.js';

function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  const idat = deflateSync(raw);
  const chunks = [];
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    chunks.push(len, td, crc);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  chunks.push(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  chunk('IHDR', ihdr);
  chunk('IDAT', idat);
  chunk('IEND', Buffer.alloc(0));
  return Buffer.concat(chunks);
}

let T = null;
function crc32(buf) {
  if (!T) {
    T = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      T[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = T[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

const size = 320;
for (const preset of presets) {
  const doc = makeDocument(preset, { resolution: size });
  const { field, extra } = compositeStack(doc.layers, size, { sunAz: doc.sun.azimuth, sunEl: doc.sun.elevation });
  const signals = computeSignals(field, extra, doc.sun.azimuth, doc.sun.elevation);
  const sat = compositeSatmap(signals, doc.satLayers, size);
  // hillshade-boosted satmap
  const out = new Uint8ClampedArray(size * size * 4);
  const { heightN, slope, aspect, ao } = signals.arrays;
  for (let i = 0; i < size * size; i++) {
    const shade = 0.45 + 0.75 * aspect[i] * (1 - slope[i] * 0.45) * (0.4 + 0.6 * ao[i]);
    out[i * 4] = Math.min(255, sat[i * 4] * shade * 1.35);
    out[i * 4 + 1] = Math.min(255, sat[i * 4 + 1] * shade * 1.35);
    out[i * 4 + 2] = Math.min(255, sat[i * 4 + 2] * shade * 1.35);
    out[i * 4 + 3] = 255;
  }
  writeFileSync(`/tmp/preview-${preset.id}.png`, png(size, out));
  console.log('wrote', `/tmp/preview-${preset.id}.png`);
}
