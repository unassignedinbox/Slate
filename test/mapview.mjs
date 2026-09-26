// mapview.mjs — renders a top-down map of the battlefield (terrain palette +
// hillshade + prop footprints) to PNG for visual verification. Pure node, no GL.
import zlib from 'node:zlib';
import fs from 'node:fs';
import { S, CFG } from '../js/state.js';
import * as world from '../js/world.js';
import { H, MOUNDS, TRENCHES, ROADS, WIRES, HEDGEHOGS, CRATERS, roadDist, moundF, trenchNear } from '../js/world.js';

const SENTRY_XS = [-140, -75, -30, 30, 90, 145];

// ---- PNG encoder ----
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
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
function writePNG(path, width, height, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  const raw = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  }
  const idat = zlib.deflateSync(raw, { level: 6 });
  fs.writeFileSync(path, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0)),
  ]));
}

// ---- render ----
const W = 880, Hh = 1080;
const X0 = -180, X1 = 180, Z0 = -270, Z1 = 190;
const rgb = Buffer.alloc(W * Hh * 3);

// palette (mirrors world.js faceColor)
const P = {
  deep: [141, 127, 99], wet: [176, 163, 125], sand: [215, 197, 152], dune: [185, 173, 127],
  grass: [[125, 154, 84], [115, 144, 73], [134, 161, 92]],
  earth: [149, 128, 92], earth2: [125, 107, 78], scorch: [91, 84, 66],
  trenchF: [106, 90, 68], trenchW: [119, 102, 76], road: [155, 127, 87], road2: [141, 113, 76],
  water: [47, 111, 143], waterDeep: [30, 78, 105],
};

const WATER = -3.2; // approximate initial tide for the map

for (let py = 0; py < Hh; py++) {
  const z = Z0 + ((Z1 - Z0) * py) / (Hh - 1);
  for (let px = 0; px < W; px++) {
    const x = X0 + ((X1 - X0) * px) / (W - 1);
    const h = H(x, z);
    let c;
    if (h < WATER) {
      const d = Math.min(1, (WATER - h) / 4);
      c = [P.water[0] * (1 - d * 0.55) + P.waterDeep[0] * d * 0.55,
           P.water[1] * (1 - d * 0.55) + P.waterDeep[1] * d * 0.55,
           P.water[2] * (1 - d * 0.55) + P.waterDeep[2] * d * 0.55];
    } else {
      const tf = world.trenchF(x, z);
      const rd = roadDist(x, z);
      const mf = moundF(x, z);
      // crater factor
      let cf = 0;
      for (const cr of CRATERS) {
        const dx = x - cr[0], dz = z - cr[1];
        if (dx * dx + dz * dz < cr[2] * cr[2]) cf = Math.max(cf, 1 - Math.sqrt(dx * dx + dz * dz) / cr[2]);
      }
      const nz = Math.abs(Math.sin(x * 12.9898 + z * 78.233)) % 1;
      if (h < -1.4) c = P.deep;
      else if (h < 0.55) c = P.wet;
      else if (z < -88 + nz * 8 && h < 1.5) c = P.sand;
      else if (z < -72 + nz * 8) c = nz < 0.45 ? P.dune : P.sand;
      else c = P.grass[Math.floor(nz * 3) % 3];
      if (mf > 0.34) c = nz < 0.5 ? P.earth : P.earth2;
      if (cf > 0.4) c = P.scorch;
      else if (cf > 0.14) c = P.earth2;
      if (tf.par > 0.16) c = nz < 0.5 ? P.earth2 : P.earth;
      if (tf.carve > 0.02) c = tf.carve > 1.25 ? P.trenchF : P.trenchW;
      if (rd < 0.05) c = nz < 0.5 ? P.road : P.road2;
      else if (rd < 1.2 && z > -96) c = P.road2;
      // hillshade
      const e = 1.6;
      const hx = H(x + e, z) - h, hz = H(x, z + e) - h;
      const shade = Math.max(0.55, Math.min(1.25, 1 + (hx * -0.5 + hz * -0.35) * 0.55));
      c = [c[0] * shade, c[1] * shade, c[2] * shade];
    }
    const o = (py * W + px) * 3;
    rgb[o] = Math.max(0, Math.min(255, c[0]));
    rgb[o + 1] = Math.max(0, Math.min(255, c[1]));
    rgb[o + 2] = Math.max(0, Math.min(255, c[2]));
  }
}

const toPix = (x, z) => [Math.round(((x - X0) / (X1 - X0)) * (W - 1)), Math.round(((z - Z0) / (Z1 - Z0)) * (Hh - 1))];
function dot(x, z, r, col) {
  const [cx, cy] = toPix(x, z);
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const px = cx + dx, py = cy + dy;
    if (px < 0 || px >= W || py < 0 || py >= Hh) continue;
    if (dx * dx + dy * dy > r * r) continue;
    const o = (py * W + px) * 3;
    rgb[o] = col[0]; rgb[o + 1] = col[1]; rgb[o + 2] = col[2];
  }
}
function line(x0, z0, x1, z1, col, w = 1) {
  const [ax, ay] = toPix(x0, z0), [bx, by] = toPix(x1, z1);
  const n = Math.max(Math.abs(bx - ax), Math.abs(by - ay)) * 2 + 1;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    dot(ax + (bx - ax) * t - X0, 0, 0, [0, 0, 0]); // noop guard
    const px = Math.round(ax + (bx - ax) * t), py = Math.round(ay + (by - ay) * t);
    for (let d = -w; d <= w; d++) {
      for (let dd = -w; dd <= w; dd++) {
        const qx = px + d, qy = py + dd;
        if (qx < 0 || qx >= W || qy < 0 || qy >= Hh) continue;
        const o = (qy * W + qx) * 3;
        rgb[o] = col[0]; rgb[o + 1] = col[1]; rgb[o + 2] = col[2];
      }
    }
  }
}

// wall band
for (let py = 0; py < Hh; py++) {
  const z = Z0 + ((Z1 - Z0) * py) / (Hh - 1);
  if (z > 168.4 && z < 176) {
    for (let px = 0; px < W; px++) {
      const x = X0 + ((X1 - X0) * px) / (W - 1);
      if (Math.abs(x) < 5.2 && z < 171) continue; // gate
      const o = (py * W + px) * 3;
      const g = 150 + ((px * 7 + py * 3) % 3) * 6;
      rgb[o] = g; rgb[o + 1] = g - 6; rgb[o + 2] = g - 14;
    }
  }
}
// roads outline (thin dashed) for clarity
for (const r of ROADS) for (let i = 0; i < r.pts.length - 1; i++) line(r.pts[i][0], r.pts[i][1], r.pts[i + 1][0], r.pts[i + 1][1], [92, 68, 40], 0);
// wire
for (const w of WIRES) for (let i = 0; i < w.pts.length - 1; i++) line(w.pts[i][0], w.pts[i][1], w.pts[i + 1][0], w.pts[i + 1][1], [40, 46, 52], 0);
// mines
for (const m of S.tankMines) dot(m.x, m.z, 1, [220, 60, 30]);
for (const m of S.apMines) dot(m.x, m.z, 1, [255, 120, 60]);
// hedgehogs, tanks, sentries, craft
for (const h of HEDGEHOGS) dot(h[0], h[1], 1, [110, 80, 55]);
dot(-30, -122, 3, [70, 66, 60]); dot(42, -130, 3, [70, 66, 60]); dot(-78, -108, 3, [70, 66, 60]);
dot(10, 28, 3, [70, 66, 60]);
dot(-95, 48, 3, [86, 102, 66]); dot(128, 58, 3, [86, 102, 66]); dot(-140, 100, 3, [86, 102, 66]);
for (const sx of SENTRY_XS) dot(sx, 168, 2, [255, 40, 20]);
dot(112, 74, 2, [255, 40, 20]); dot(-156, 112, 2, [255, 40, 20]);
dot(4, -158, 4, [80, 72, 68]); // landing craft
dot(CFG.carSpawn.x, CFG.carSpawn.z, 2, [255, 130, 40]); // car
dot(CFG.spawn.x, CFG.spawn.z, 2, [255, 255, 255]); // player

writePNG(new URL('./map.png', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), W, Hh, rgb);
console.log('map written to test/map.png', `${W}x${Hh}`);
