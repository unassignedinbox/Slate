/**
 * Rasterises the circuit to docs/track-map.png (no browser needed) so the
 * layout can be eyeballed straight from the spline data.
 *
 *   node tools/trackpng.mjs
 */
import fs from 'node:fs';
import zlib from 'node:zlib';

function ctx2d() {
  const noop = () => {};
  return new Proxy(
    {
      getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      createRadialGradient: () => ({ addColorStop: noop }),
      createLinearGradient: () => ({ addColorStop: noop }),
      measureText: () => ({ width: 10 }),
    },
    { get: (t, k) => (k in t ? t[k] : noop), set: (t, k, v) => ((t[k] = v), true) }
  );
}
globalThis.document = { createElement: () => ({ getContext: () => ctx2d(), style: {} }) };
globalThis.window = { devicePixelRatio: 1, addEventListener: () => {} };

const { Track } = await import('../src/track.js');
const { LANDMARKS } = await import('../src/trackData.js');

const W = 1200;
const H = 760;
const buf = new Uint8Array(W * H * 3);
const px = (x, y, r, g, b) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  buf[i] = r;
  buf[i + 1] = g;
  buf[i + 2] = b;
};
// background
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const t = y / H;
    px(x, y, 10 - t * 5, 15 - t * 8, 26 - t * 14);
  }
}

function fillPoly(pts, r, g, b) {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minY = Math.min(minY, p[1]);
    maxY = Math.max(maxY, p[1]);
  }
  for (let y = Math.max(0, Math.floor(minY)); y <= Math.min(H - 1, Math.ceil(maxY)); y++) {
    const xs = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const c = pts[(i + 1) % pts.length];
      if (a[1] === c[1]) continue;
      const yc = y + 0.5;
      if (yc >= Math.min(a[1], c[1]) && yc < Math.max(a[1], c[1])) {
        xs.push(a[0] + ((yc - a[1]) / (c[1] - a[1])) * (c[0] - a[0]));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = Math.max(0, Math.round(xs[k])); x <= Math.min(W - 1, Math.round(xs[k + 1])); x++) px(x, y, r, g, b);
    }
  }
}

function line(x0, y0, x1, y1, r, g, b, w = 1) {
  const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0)) * 2 + 1;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t;
    for (let dy = -w; dy <= w; dy++) for (let dx = -w; dx <= w; dx++) px(Math.round(x + dx), Math.round(y + dy), r, g, b);
  }
}

const track = new Track();
const pad = 60;
let minX = Infinity;
let maxX = -Infinity;
let minZ = Infinity;
let maxZ = -Infinity;
for (let i = 0; i < track.N; i++) {
  const c = track.centers[i];
  const hw = track.widths[i] + 4;
  minX = Math.min(minX, c.x - hw);
  maxX = Math.max(maxX, c.x + hw);
  minZ = Math.min(minZ, c.z - hw);
  maxZ = Math.max(maxZ, c.z + hw);
}
const s = Math.min((W - pad * 2) / (maxX - minX), (H - pad * 2) / (maxZ - minZ));
const ox = pad + (W - pad * 2 - (maxX - minX) * s) / 2 - minX * s;
const oz = pad + (H - pad * 2 - (maxZ - minZ) * s) / 2 - minZ * s;
const P = (x, z) => [x * s + ox, z * s + oz];

const maxY = Math.max(...track.centers.map((c) => c.y));
const quads = [];
for (let i = 0; i < track.N; i++) {
  const j = (i + 1) % track.N;
  const a = track.pointAt(i, -track.widths[i]);
  const b = track.pointAt(i, track.widths[i]);
  const c = track.pointAt(j, track.widths[j]);
  const d = track.pointAt(j, -track.widths[j]);
  quads.push({ i, y: (track.centers[i].y + track.centers[j].y) / 2, pts: [P(a.x, a.z), P(b.x, b.z), P(c.x, c.z), P(d.x, d.z)] });
}
quads.sort((p, q) => p.y - q.y);
for (const q of quads) {
  const t = q.y / maxY;
  const bank = Math.min(1, Math.abs(track.banks[q.i]) / 0.6);
  fillPoly(q.pts, Math.round(38 + t * 26 + bank * 110), Math.round(46 + t * 92 - bank * 14), Math.round(62 + t * 120 - bank * 40));
}
// edges + centre line
for (const q of quads) {
  line(q.pts[0][0], q.pts[0][1], q.pts[3][0], q.pts[3][1], 120, 190, 230, 0);
  line(q.pts[1][0], q.pts[1][1], q.pts[2][0], q.pts[2][1], 120, 190, 230, 0);
}
for (let i = 0; i < track.N; i += 12) {
  const a = track.centers[i];
  const b = track.centers[(i + 6) % track.N];
  const [x0, y0] = P(a.x, a.z);
  const [x1, y1] = P(b.x, b.z);
  line(x0, y0, x1, y1, 47, 230, 255, 0);
}
// start/finish
const si = track.startIndex;
const sa = track.pointAt(si, -track.widths[si]);
const sb = track.pointAt(si, track.widths[si]);
line(...P(sa.x, sa.z), ...P(sb.x, sb.z), 255, 176, 30, 1);
// landmarks
for (const l of LANDMARKS) {
  const [x, y] = P(l.x, l.z);
  for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) if (dx * dx + dy * dy < 17) px(Math.round(x + dx), Math.round(y + dy), 255, 63, 168);
}

// ---------------------------------------------------------------- write PNG
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y++) {
  raw[y * (W * 3 + 1)] = 0;
  Buffer.from(buf.buffer, y * W * 3, W * 3).copy(raw, y * (W * 3 + 1) + 1);
}
const crcTable = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c >>> 0;
}
const crc = (b) => {
  let c = 0xffffffff;
  for (const v of b) c = crcTable[(c ^ v) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;
ihdr[9] = 2;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
fs.mkdirSync('docs', { recursive: true });
fs.writeFileSync('docs/track-map.png', png);
console.log(`docs/track-map.png written (${W}x${H})`);
