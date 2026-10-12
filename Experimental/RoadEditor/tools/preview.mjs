// Renders the plan to a PNG so the generator can be checked without a browser.
//
//   node tools/preview.mjs [preset] [seed] [out.png] [extent]
//
// Roads are drawn as centrelines coloured by class and junctions as discs sized by their footprint,
// which is what the road surface plus the intersection polygon covers once the editor draws them.
import { generateCity, PRESETS } from '../src/citygen.js';
import zlib from 'node:zlib';
import fs from 'node:fs';

const preset = process.argv[2] || 'city';
const seed = Number(process.argv[3] || 20261012);
const out = process.argv[4] || '/tmp/preview.png';
const extent = Number(process.argv[5] || (PRESETS[preset] || PRESETS.city).extent);

const t0 = performance.now();
const { net, report } = generateCity({ ...(PRESETS[preset] || PRESETS.city), preset, seed, extent });
const t1 = performance.now();

const W = Number(process.env.RE_SIZE || 1180);
const H = W;
const img = new Float32Array(W * H * 3);
const colours = {
  motorway: [1.0, 0.24, 0.24], trunk: [1.0, 0.62, 0.22], arterial: [1.0, 0.88, 0.35],
  collector: [0.72, 0.9, 0.35], local: [0.45, 0.76, 1.0], alley: [0.45, 0.55, 1.0],
  service: [0.68, 0.55, 0.85], footway: [0.95, 0.55, 0.7], cycleway: [0.42, 0.95, 0.68],
  canyon: [0.16, 0.78, 0.85], rural: [0.62, 0.95, 0.62], ramp: [1.0, 0.45, 0.3],
};
const scale = (W * 0.95) / extent;
const px = (p) => [W / 2 + p.x * scale, H / 2 - p.y * scale];

function plot(x, y, c, a = 1) {
  const i = Math.round(x);
  const j = Math.round(y);
  if (i < 1 || j < 1 || i >= W - 1 || j >= H - 1) return;
  const o = (j * W + i) * 3;
  img[o] += (c[0] - img[o]) * a;
  img[o + 1] += (c[1] - img[o + 1]) * a;
  img[o + 2] += (c[2] - img[o + 2]) * a;
}
function line(a, b, c, width = 1, alpha = 1) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) * 1.5));
  for (let i = 0; i <= steps; i++) {
    const x = a[0] + (dx * i) / steps;
    const y = a[1] + (dy * i) / steps;
    for (let oy = -width; oy <= width; oy++) for (let ox = -width; ox <= width; ox++) plot(x + ox, y + oy, c, alpha);
  }
}
function disc(cx, cy, r, c, alpha = 1) {
  for (let y = -r; y <= r; y++) {
    for (let x = -r; x <= r; x++) {
      if (x * x + y * y > r * r) continue;
      plot(cx + x, cy + y, c, alpha);
    }
  }
}

// Ground: blocks washed over the terrain, so the street pattern reads against its blocks.
for (const block of net.blocks || []) {
  const poly = block.poly || [];
  for (let i = 0; i < poly.length; i++) {
    const a = px(poly[i]);
    const b = px(poly[(i + 1) % poly.length]);
    line(a, b, [0.07, 0.2, 0.12], 0, 0.5);
  }
}
// Junction footprints first, then the carriageways on top of them. The discs are drawn faint: they
// are there to show where a junction polygon lands, not to hide the street plan behind them.
for (const node of net.nodes) {
  const r = Math.max(1.5, ((node.width || 10) / 2) * scale);
  disc(...px(node), Math.min(9, r), [0.34, 0.34, 0.38], 0.55);
}
// Roundabouts get their ring drawn, because the ring is the thing that makes the junction read.
for (const node of net.nodes) {
  if (!node.roundabout || !node.roundaboutRadius) continue;
  const steps = 48;
  for (let i = 0; i < steps; i++) {
    const a0 = (i / steps) * Math.PI * 2;
    const a1 = ((i + 1) / steps) * Math.PI * 2;
    const outer = node.roundaboutRadius * scale;
    const inner = node.centreIslandRadius * scale;
    for (const [r0, r1] of [[outer, inner]]) {
      const p0 = [px(node)[0] + Math.cos(a0) * r0, px(node)[1] + Math.sin(a0) * r0];
      const p1 = [px(node)[0] + Math.cos(a1) * r0, px(node)[1] + Math.sin(a1) * r0];
      line(p0, p1, [1, 1, 1], 0, 0.55);
      const q0 = [px(node)[0] + Math.cos(a0) * r1, px(node)[1] + Math.sin(a0) * r1];
      const q1 = [px(node)[0] + Math.cos(a1) * r1, px(node)[1] + Math.sin(a1) * r1];
      line(q0, q1, [0.5, 0.5, 0.5], 0, 0.4);
    }
  }
}
let km = 0;
for (const road of net.roads) {
  const c = colours[road.cls] || [0.8, 0.8, 0.8];
  const width = (road.halfWidth || 3) > 6 ? 2 : (road.halfWidth || 3) > 4 ? 1 : 0;
  for (let i = 1; i < road.path.length; i++) line(px(road.path[i - 1]), px(road.path[i]), c, width);
  km += road.length;
}
for (const rail of net.railways || []) {
  for (let i = 1; i < rail.path.length; i++) line(px(rail.path[i - 1]), px(rail.path[i]), [0.5, 0.5, 0.55], 0, 0.9);
}
for (const sub of net.subways || []) {
  for (let i = 1; i < sub.path.length; i += 2) line(px(sub.path[i - 1]), px(sub.path[i]), [0.55, 0.3, 0.75], 0, 0.5);
}

// Encoder
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y++) {
  raw[y * (W * 3 + 1)] = 0;
  for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 3;
    for (let k = 0; k < 3; k++) {
      const v = Math.max(0, Math.min(1, img[o + k]));
      raw[y * (W * 3 + 1) + 1 + x * 3 + k] = Math.round(Math.pow(v, 0.85) * 255);
    }
  }
}
let table = null;
function crc32(buf) {
  if (!table) {
    table = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;
ihdr[9] = 2;
fs.writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]));

const stats = net.stats();
console.log(`${out}  ${W}x${H}`);
console.log(`preset ${preset} seed ${seed} extent ${extent} m`);
console.log(`generate ${(t1 - t0).toFixed(0)} ms`);
console.log(`roads ${stats.roads}   nodes ${stats.nodes}   road ${(km / 1000).toFixed(1)} km   blocks ${stats.blocks}`);
const roundabouts = net.nodes.filter((n) => n.roundabout).length;
console.log(`junctions ${net.nodes.length}   roundabouts ${roundabouts}`);
console.log(`validation ${report.validation.errors} errors, ${report.validation.warnings} warnings`);
console.log(`colours: motorway red, trunk orange, arterial yellow, collector lime, local blue, alley indigo, canyon cyan, footway pink, railway grey, subway violet`);
