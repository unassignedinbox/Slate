// Dev tool: evaluate a project (or the starter) and write PNG previews of height/albedo/water.
// usage: node scripts/render-preview.mjs [N] [outDir]
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { starterProject } from '../src/engine/project.js';
import { evaluate } from '../src/engine/stack.js';

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function png(width, height, rgb) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    rgb.copy ? rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3) : raw.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), y * (width * 3 + 1) + 1);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

if (process.argv[1] && process.argv[1].endsWith('render-preview.mjs')) {
  const N = +(process.argv[2] || 256), out = process.argv[3] || 'preview';
  mkdirSync(out, { recursive: true });
  const t0 = Date.now();
  const st = evaluate(starterProject(N));
  console.log('evaluated in', Date.now() - t0, 'ms; range', st.range, 'timings', st.timings.map((t) => t.ms).join(','));
  const hgt = Buffer.alloc(N * N * 3), alb = Buffer.alloc(N * N * 3);
  for (let i = 0; i < N * N; i++) {
    const v = Math.round(st.h[i] * 255);
    // hillshade-like grayscale
    hgt[i * 3] = hgt[i * 3 + 1] = hgt[i * 3 + 2] = v;
    const wet = st.water && !Number.isNaN(st.water[i]);
    if (wet) { hgt[i * 3] = 30; hgt[i * 3 + 1] = 110; hgt[i * 3 + 2] = 220; }
    alb[i * 3] = Math.round(st.albedo[i * 3] * 255); alb[i * 3 + 1] = Math.round(st.albedo[i * 3 + 1] * 255); alb[i * 3 + 2] = Math.round(st.albedo[i * 3 + 2] * 255);
  }
  writeFileSync(`${out}/height.png`, png(N, N, hgt));
  writeFileSync(`${out}/albedo.png`, png(N, N, alb));
  console.log('wrote', out);
}
export { png };
