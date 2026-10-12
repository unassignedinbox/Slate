// Rasterises the network to a PNG with no external dependencies (zlib + a hand-rolled encoder).
// Useful for eyeballing a generator change without a browser in the loop.
import { generateCity, PRESETS } from '../src/citygen.js';
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const preset = process.argv[2] || 'city';
const seed = Number(process.argv[3] || 20261012);
const out = process.argv[4] || '/tmp/network.png';
const N = 1200;

const COLOUR = {
  motorway: [255, 82, 82], trunk: [255, 177, 66], arterial: [255, 224, 102], collector: [200, 245, 107],
  local: [143, 211, 255], alley: [125, 139, 255], service: [179, 157, 219], rural: [165, 214, 167],
  canyon: [38, 198, 218], footway: [244, 143, 177], cycleway: [105, 240, 174], transit: [240, 98, 146],
  ramp: [255, 112, 67], roundabout: [255, 213, 79], living: [176, 190, 197], track: [188, 170, 164], bridge: [77, 208, 225],
};
const WIDTH = { motorway: 5, trunk: 4, arterial: 3.2, collector: 2.2, local: 1.4, alley: 1, service: 1.3, rural: 1.4, canyon: 1.6, footway: 0.8, cycleway: 1, ramp: 1.8, transit: 2.4 };

const P = { ...PRESETS[preset], preset, seed };
const t0 = performance.now();
const { net, terrain, report } = generateCity({ ...P, skeletonOnly: process.env.RE_SKELETON === '1', stopAfterStreets: process.env.RE_STREETS === '1' });
const genMs = performance.now() - t0;

const S = net.extent * 1.04;
const sc = N / S;
const X = (x) => (x + S / 2) * sc;
const Y = (y) => N - (y + S / 2) * sc;

const buf = new Uint8Array(N * N * 3);
const fill = (r, g, b) => {
  for (let i = 0; i < N * N; i++) {
    buf[i * 3] = r;
    buf[i * 3 + 1] = g;
    buf[i * 3 + 2] = b;
  }
};
const px = (x, y, c, a = 1) => {
  if (x < 0 || y < 0 || x >= N || y >= N) return;
  const i = (y * N + x) * 3;
  buf[i] = buf[i] * (1 - a) + c[0] * a;
  buf[i + 1] = buf[i + 1] * (1 - a) + c[1] * a;
  buf[i + 2] = buf[i + 2] * (1 - a) + c[2] * a;
};
const disc = (cx, cy, r, c, a = 1) => {
  const r2 = r * r;
  for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) {
    const dx = x - cx;
    const dy = y - cy;
    if (dx * dx + dy * dy <= r2) px(x, y, c, a);
  }
};
const line = (x0, y0, x1, y1, width, c, a = 1) => {
  const steps = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 1.4));
  const w2 = width / 2;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    disc(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, Math.max(0.6, w2), c, a);
  }
};
const polyline = (pts, width, c, a = 1) => {
  for (let i = 0; i < pts.length - 1; i++) line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], width, c, a);
};
const fillPoly = (pts, c, a = 1) => {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minY = Math.min(minY, p[1]);
    maxY = Math.max(maxY, p[1]);
  }
  for (let y = Math.max(0, Math.floor(minY)); y <= Math.min(N - 1, Math.ceil(maxY)); y++) {
    const xs = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % pts.length];
      if (p[1] === q[1]) continue;
      if ((y >= p[1] && y < q[1]) || (y >= q[1] && y < p[1])) xs.push(p[0] + ((y - p[1]) / (q[1] - p[1])) * (q[0] - p[0]));
    }
    xs.sort((m, n) => m - n);
    for (let i = 0; i + 1 < xs.length; i += 2) for (let x = Math.ceil(xs[i]); x <= Math.floor(xs[i + 1]); x++) px(x, y, c, a);
  }
};

fill(20, 22, 26);
// Terrain tint
for (let y = 0; y < N; y += 2) {
  for (let x = 0; x < N; x += 2) {
    const wx = (x / sc) - S / 2;
    const wy = ((N - y) / sc) - S / 2;
    const h = terrain.height(wx, wy);
    const r = terrain.riverDistance(wx, wy).d;
    let c = [28, 34, 30];
    if (h < 0.4) c = [22, 40, 62];
    else if (r < terrain.river ? 0 : 0) c = [30, 36, 32];
    else if (h > 90) c = [44, 42, 40];
    else if (h > 45) c = [36, 38, 34];
    px(x, y, c);
    px(x + 1, y, c);
    px(x, y + 1, c);
    px(x + 1, y + 1, c);
  }
}
// Water
if (terrain.river) {
  const pts = terrain.river.path.map((p) => [X(p.x), Y(p.y)]);
  polyline(pts, terrain.river.width * sc, [26, 58, 92], 0.9);
}
// Blocks
for (const b of net.blocks) {
  fillPoly(b.poly.map((p) => [X(p.x), Y(p.y)]), b.open ? [30, 42, 32] : [38, 42, 48], 0.85);
}
// Roads, thin to thick so majors end up on top
const order = ['footway', 'cycleway', 'alley', 'track', 'service', 'local', 'living', 'rural', 'canyon', 'collector', 'transit', 'arterial', 'roundabout', 'ramp', 'trunk', 'motorway'];
for (const cls of order) {
  for (const r of net.roads) {
    if (r.cls !== cls) continue;
    if (r.length < 6) continue;
    polyline(r.path.map((p) => [X(p.x), Y(p.y)]), WIDTH[cls] || 1.4, COLOUR[cls] || [150, 150, 150], 0.95);
  }
}
for (const rail of net.railways) polyline(rail.path.map((p) => [X(p.x), Y(p.y)]), 1.4, [230, 230, 230], 0.9);
for (const sub of net.subways) {
  polyline(sub.path.map((p) => [X(p.x), Y(p.y)]), 2.4, [210, 100, 80], 0.5);
  for (const s of sub.stations) disc(X(s.x), Y(s.y), 3, [255, 220, 160], 1);
  for (const p of sub.path) disc(X(p.x), Y(p.y), 1.2, [188, 170, 164], 1);
}
for (const n of net.nodes) disc(X(n.x), Y(n.y), 1.1, [255, 255, 255], 0.5);

// PNG encode
const raw = Buffer.alloc((N * 3 + 1) * N);
for (let y = 0; y < N; y++) {
  raw[y * (N * 3 + 1)] = 0;
  Buffer.from(buf.buffer, y * N * 3, N * 3).copy(raw, y * (N * 3 + 1) + 1);
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const body = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
};
let table = null;
function crc32(bufIn) {
  if (!table) {
    table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < bufIn.length; i++) c = table[(c ^ bufIn[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(N, 0);
ihdr.writeUInt32BE(N, 4);
ihdr[8] = 8;
ihdr[9] = 2;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 6 })),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(out, png);
const s = net.stats();
console.log(
  `${out}  ${N}x${N}  roads ${s.roads}  ${s.roadKm.toFixed(1)} km  nodes ${s.nodes}  blocks ${s.blocks}  gen ${genMs.toFixed(0)} ms  err ${report.validation.errors} warn ${report.validation.warnings}`,
);
