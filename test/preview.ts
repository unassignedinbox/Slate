/* Headless PNG preview of the crack networks + harvested fragments. */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { CrackNetwork } from '../src/frac/crack2d';
import { RegionExtractor } from '../src/frac/regions';
import { MATERIALS, MaterialId } from '../src/sim/materials';

function png(w: number, h: number, rgba: Uint8Array): Buffer {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const crcTable = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
    return t;
  })();
  const crc = (b: Buffer) => { let c = -1; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const cc = Buffer.alloc(4); cc.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, cc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const CELL = 640, PAD = 16;
const cases: [MaterialId, number][] = [
  ['annealed-glass', 40], ['tempered-glass', 40], ['acrylic', 400],
];
const W = cases.length * (CELL + PAD) + PAD;
const H = CELL * (1.15 / 1.7) + PAD * 2;
const img = new Uint8Array(W * Math.round(H) * 4);
const HH = Math.round(H);
for (let i = 0; i < W * HH; i++) { img[i * 4] = 16; img[i * 4 + 1] = 18; img[i * 4 + 2] = 22; img[i * 4 + 3] = 255; }

function px(x: number, y: number, r: number, g: number, b: number, a = 1) {
  const xi = Math.round(x), yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= W || yi >= HH) return;
  const o = (yi * W + xi) * 4;
  img[o] = img[o] * (1 - a) + r * a;
  img[o + 1] = img[o + 1] * (1 - a) + g * a;
  img[o + 2] = img[o + 2] * (1 - a) + b * a;
}
function line(x0: number, y0: number, x1: number, y1: number, c: [number, number, number], a = 1) {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
  for (let i = 0; i <= n; i++) px(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, c[0], c[1], c[2], a);
}

let col = 0;
for (const [id, E] of cases) {
  const mat = MATERIALS[id];
  const t = id === 'acrylic' ? 0.004 : 0.006;
  const net = new CrackNetwork({ width: 1.7, height: 1.15, thickness: t, material: mat, res: 380, seed: 9 });
  net.impact({ x: 0.12, y: 0.08, energy: E, radius: 0.012, penetration: 0.4 });
  const dt = (net.h / 1900) * 0.8;
  let steps = 0;
  while (!net.done && steps++ < 400000) net.step(dt);
  const ex = new RegionExtractor(net);
  const frags = [...ex.harvest(false, 3), ...ex.harvest(true, 3)];

  const ox = PAD + col * (CELL + PAD), oy = PAD;
  const sc = CELL / 1.7;
  const X = (x: number) => ox + (x + 0.85) * sc;
  const Y = (y: number) => oy + (0.575 - y) * sc;

  // fragments: filled with a per-piece tint so the tessellation is visible
  let k = 0;
  for (const f of frags) {
    const p = f.poly;
    const hue = (k++ * 97) % 255;
    const c: [number, number, number] = [60 + (hue % 90), 90 + ((hue * 7) % 80), 120 + ((hue * 13) % 100)];
    // scanline fill
    let minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < p.length; i += 2) { minY = Math.min(minY, Y(p[i + 1])); maxY = Math.max(maxY, Y(p[i + 1])); }
    for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
      const xs: number[] = [];
      for (let i = 0, n = p.length / 2; i < n; i++) {
        const j = (i + 1) % n;
        const y0 = Y(p[i * 2 + 1]), y1 = Y(p[j * 2 + 1]);
        if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) {
          xs.push(X(p[i * 2]) + ((y - y0) / (y1 - y0)) * (X(p[j * 2]) - X(p[i * 2])));
        }
      }
      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2) for (let x = Math.ceil(xs[i]); x <= xs[i + 1]; x++) px(x, y, c[0], c[1], c[2], 0.85);
    }
  }
  // crack paths on top
  for (const path of net.paths) {
    for (let i = 0; i + 3 < path.pts.length; i += 2) {
      line(X(path.pts[i]), Y(path.pts[i + 1]), X(path.pts[i + 2]), Y(path.pts[i + 3]), [235, 245, 255], 0.95);
    }
  }
  // border
  for (let x = 0; x < CELL; x++) { px(ox + x, oy, 90, 100, 110); px(ox + x, oy + CELL * (1.15 / 1.7), 90, 100, 110); }
  for (let y = 0; y < CELL * (1.15 / 1.7); y++) { px(ox, oy + y, 90, 100, 110); px(ox + CELL, oy + y, 90, 100, 110); }

  console.log(`${id} E=${E}J  paths=${net.paths.length} len=${net.stats().length.toFixed(1)}m frags=${frags.length}`);
  col++;
}

writeFileSync('/tmp/cracks.png', png(W, HH, img));
console.log('wrote /tmp/cracks.png', W, HH);
