// Slate — water features #85–94. These CARVE into the heightmap; water is a
// transparent fill rendered later at ctx.waterLevel inside the carved basins.
import { clamp, smoothstep, mulberry32, bilinear } from './util.js';
import { valueNoise, fbm } from './noise.js';

const P = (k, label, min, max, step, def, unit = '', hint = '') =>
  ({ k, label, min, max, step, def, unit, hint, type: 'slider' });
const SEED = P('seed', 'Seed', 0, 9999, 1, 55);
const L = (n, id, name, desc, params, run, extra = {}) =>
  ({ n, id, name, cat: 'water', desc, targets: ['height'], params, run, ...extra });

// Carve a downhill river path with valley + channel profile.
function carveRiverPath(f, moist, n, o) {
  const { sx, sy, depth, width, valleyW, valleyD, length, seed, moistW = 1 } = o;
  const rnd = mulberry32((seed * 1013904223) >>> 0 || 13);
  let x = sx, y = sy, px = (rnd() - 0.5), py = (rnd() - 0.5);
  const pl = Math.hypot(px, py) || 1; px /= pl; py /= pl;
  for (let s = 0; s < length; s++) {
    const xi = Math.round(x), yi = Math.round(y);
    if (xi < 1 || yi < 1 || xi >= n - 1 || yi >= n - 1) break;
    const gx = (bilinear(f, n, x + 1, y) - bilinear(f, n, x - 1, y)) * 0.5;
    const gy = (bilinear(f, n, x, y + 1) - bilinear(f, n, x, y - 1)) * 0.5;
    let dx = -gx * 30 + px * 0.4 + (rnd() - 0.5) * 0.35;
    let dy = -gy * 30 + py * 0.4 + (rnd() - 0.5) * 0.35;
    const l = Math.hypot(dx, dy) || 1;
    px = dx / l; py = dy / l;
    x += px; y += py;
    const t = s / length;
    const wChan = width * (0.55 + 0.9 * t), wVal = valleyW * (0.5 + t);
    const dep = depth * (0.45 + 0.55 * Math.sin(Math.min(1, t * 1.15) * Math.PI * 0.5));
    const r = Math.ceil(wVal * 1.6);
    for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) {
      const nx = Math.round(x) + ox, ny = Math.round(y) + oy;
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      const dd = Math.hypot(ox, oy);
      const chan = Math.exp(-(dd * dd) / (wChan * wChan));
      const val = Math.exp(-(dd * dd) / (wVal * wVal * 4));
      const j = ny * n + nx;
      f[j] -= chan * dep * 0.12 + val * valleyD * 0.05;
      if (moist) moist[j] = clamp(moist[j] + chan * 0.5 * moistW + val * 0.2 * moistW, 0, 1);
    }
  }
}

export const LAYERS_WATER = [
  L(85, 'water-fill', 'Water Fill', 'Fill depressions to water level (pit-fill + sets level).', [
    P('level', 'Water level', 0, 1, 0.005, 0.3), P('passes', 'Fill passes', 1, 24, 1, 8),
    P('shoreline', 'Shore smooth', 0, 1, 0.05, 0.3),
  ], (ctx, p, S) => {
    const n = ctx.n;
    for (let it = 0; it < p.passes; it++) {
      for (let y = 1; y < n - 1; y++) for (let x = 1; x < n - 1; x++) {
        const i = y * n + x;
        if (S.h[i] >= p.level) continue;
        let mn = Infinity;
        mn = Math.min(mn, S.h[i - 1], S.h[i + 1], S.h[i - n], S.h[i + n]);
        if (S.h[i] < mn - 1e-4) S.h[i] = Math.min(mn, p.level); // raise pit toward spill
      }
    }
    if (p.shoreline > 0) {
      const src = Float32Array.from(S.h);
      for (let y = 1; y < n - 1; y++) for (let x = 1; x < n - 1; x++) {
        const i = y * n + x;
        const band = Math.exp(-(((src[i] - p.level) / 0.03) ** 2));
        if (band > 0.02) {
          const avg = (src[i - 1] + src[i + 1] + src[i - n] + src[i + n]) * 0.25;
          S.h[i] = src[i] + (avg - src[i]) * band * p.shoreline;
        }
      }
    }
    ctx.waterLevel = p.level;
  }),
  L(86, 'lake', 'Lake', 'Carve lake basins into the terrain; sets water level.', [
    P('count', 'Lakes', 1, 12, 1, 3), P('size', 'Size', 4, 60, 1, 22, 'px'),
    P('depth', 'Depth', 0.01, 0.4, 0.005, 0.1), P('level', 'Water level', 0, 1, 0.005, 0.3),
    P('round', 'Roundness', 0.3, 1, 0.05, 0.75), SEED,
  ], (ctx, p, S) => {
    const n = ctx.n, rnd = mulberry32(p.seed * 5 + 77);
    for (let k = 0; k < p.count; k++) {
      const cx = (0.15 + rnd() * 0.7) * (n - 1), cy = (0.15 + rnd() * 0.7) * (n - 1);
      const rx = p.size * (0.6 + rnd() * 0.8), ry = rx * (p.round + (1 - p.round) * rnd() * 0.5);
      const rot = rnd() * Math.PI, ca = Math.cos(rot), sa = Math.sin(rot);
      const dep = p.depth * (0.6 + rnd() * 0.8);
      const rr = Math.ceil(Math.max(rx, ry) * 1.4);
      // sample rim height to anchor the basin below local terrain
      let rim = 0, cnt = 0;
      for (let a = 0; a < 12; a++) {
        const px = clamp(Math.round(cx + Math.cos(a / 12 * 6.283) * rx * 1.2), 0, n - 1);
        const py = clamp(Math.round(cy + Math.sin(a / 12 * 6.283) * ry * 1.2), 0, n - 1);
        rim += S.h[py * n + px]; cnt++;
      }
      rim /= cnt;
      for (let oy = -rr; oy <= rr; oy++) for (let ox = -rr; ox <= rr; ox++) {
        const nx = Math.round(cx) + ox, ny = Math.round(cy) + oy;
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        const ex = (ox * ca - oy * sa) / rx, ey = (ox * sa + oy * ca) / ry;
        const d = Math.hypot(ex, ey);
        if (d > 1.4) continue;
        const bowl = d < 1 ? (Math.cos(d * Math.PI) * 0.5 + 0.5) : 0;
        const shore = smoothstep(1.4, 0.9, d);
        const target = Math.min(rim - dep * 0.15, p.level - dep * bowl - 0.005);
        const j = ny * n + nx;
        S.h[j] = S.h[j] + (Math.min(S.h[j], target) - S.h[j]) * shore;
        if (d < 1.1) S.moist[j] = clamp(S.moist[j] + (1.1 - d) * 0.7, 0, 1);
      }
    }
    ctx.waterLevel = p.level;
  }, { also: ['moist'] }),
  L(87, 'river', 'River', 'Carve river channels with valleys (downhill paths).', [
    P('count', 'Rivers', 1, 16, 1, 4), P('depth', 'Depth', 0.01, 0.5, 0.01, 0.14),
    P('width', 'Width', 0.6, 10, 0.2, 2.6, 'px'), P('valley', 'Valley width', 1, 30, 1, 10, 'px'),
    P('valleyD', 'Valley depth', 0, 0.4, 0.01, 0.08), P('length', 'Length', 50, 1500, 10, 700, 'px'), SEED,
  ], (ctx, p, S) => {
    const n = ctx.n, rnd = mulberry32(p.seed * 13 + 91);
    // start rivers at high points
    for (let k = 0; k < p.count; k++) {
      let bx = 0, by = 0, bv = -1;
      for (let t = 0; t < 40; t++) {
        const x = (rnd() * (n - 1)) | 0, y = (rnd() * (n - 1)) | 0;
        if (S.h[y * n + x] > bv) { bv = S.h[y * n + x]; bx = x; by = y; }
      }
      carveRiverPath(S.h, S.moist, n, {
        sx: bx, sy: by, depth: p.depth, width: p.width, valleyW: p.valley,
        valleyD: p.valleyD, length: p.length, seed: p.seed + k * 131,
      });
    }
  }, { also: ['moist'] }),
  L(88, 'stream', 'Stream', 'Carve small stream channels (shallow, narrow).', [
    P('count', 'Streams', 1, 60, 1, 16), P('depth', 'Depth', 0.005, 0.2, 0.005, 0.05),
    P('width', 'Width', 0.3, 5, 0.1, 1.1, 'px'), P('length', 'Length', 20, 600, 5, 220, 'px'), SEED,
  ], (ctx, p, S) => {
    const n = ctx.n, rnd = mulberry32(p.seed * 29 + 93);
    for (let k = 0; k < p.count; k++) {
      let bx = 0, by = 0, bv = -1;
      for (let t = 0; t < 24; t++) {
        const x = (rnd() * (n - 1)) | 0, y = (rnd() * (n - 1)) | 0;
        if (S.h[y * n + x] > bv) { bv = S.h[y * n + x]; bx = x; by = y; }
      }
      carveRiverPath(S.h, S.moist, n, {
        sx: bx, sy: by, depth: p.depth, width: p.width, valleyW: p.width * 2.2,
        valleyD: p.depth * 0.3, length: p.length, seed: p.seed + k * 57, moistW: 0.7,
      });
    }
  }, { also: ['moist'] }),
  L(89, 'ocean', 'Ocean', 'Ocean level + coastal shelf carving and wave notches.', [
    P('level', 'Sea level', 0, 1, 0.005, 0.3), P('shelf', 'Shelf width', 1, 60, 1, 18, 'px'),
    P('depth', 'Shelf depth', 0, 0.4, 0.01, 0.12), P('waves', 'Wave notch', 0, 1, 0.05, 0.4), SEED,
  ], (ctx, p, S) => {
    const n = ctx.n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const i = y * n + x, h = S.h[i];
      if (h < p.level) {
        // deepen offshore progressively
        const t = clamp((p.level - h) * 6, 0, 1);
        S.h[i] = h - t * p.depth * 0.5;
        S.moist[i] = 1;
      } else {
        // shelf + notch just above the waterline
        const above = h - p.level;
        const shelf = Math.exp(-above * 14) * p.depth * 0.6;
        const wv = (valueNoise(x * 0.3, y * 0.3, p.seed) - 0.5) * p.waves * Math.exp(-above * 22) * 0.05;
        S.h[i] = h - shelf + wv;
        S.moist[i] = clamp(S.moist[i] + Math.exp(-above * 10) * 0.8, 0, 1);
      }
    }
    ctx.waterLevel = p.level;
  }, { also: ['moist'] }),
  L(90, 'flood', 'Flood', 'Flood-plain fill: raise water level + silt the shallows.', [
    P('level', 'Flood level', 0, 1, 0.005, 0.38), P('silt', 'Silt deposit', 0, 0.1, 0.002, 0.015),
    P('smooth', 'Bed smooth', 0, 1, 0.05, 0.5),
  ], (ctx, p, S) => {
    const n = ctx.n, src = Float32Array.from(S.h);
    for (let y = 1; y < n - 1; y++) for (let x = 1; x < n - 1; x++) {
      const i = y * n + x;
      if (src[i] > p.level) continue;
      const depth = p.level - src[i];
      const avg = (src[i - 1] + src[i + 1] + src[i - n] + src[i + n]) * 0.25;
      S.h[i] = src[i] + (avg - src[i]) * p.smooth * clamp(depth * 8, 0.15, 1) + p.silt * clamp(depth * 6, 0, 1);
      S.moist[i] = 1;
    }
    ctx.waterLevel = Math.max(ctx.waterLevel, p.level);
  }, { also: ['moist'] }),
  L(91, 'pond', 'Pond', 'Small pond basins carved at quiet spots.', [
    P('count', 'Ponds', 1, 20, 1, 5), P('size', 'Size', 2, 24, 1, 8, 'px'),
    P('depth', 'Depth', 0.005, 0.25, 0.005, 0.06), P('level', 'Water level', 0, 1, 0.005, 0.3), SEED,
  ], (ctx, p, S) => {
    const n = ctx.n, rnd = mulberry32(p.seed * 31 + 97);
    for (let k = 0; k < p.count; k++) {
      const cx = rnd() * (n - 1), cy = rnd() * (n - 1);
      const r = p.size * (0.5 + rnd() * 0.8), rr = Math.ceil(r * 1.3);
      // anchor below local terrain
      let rim = 0, cnt = 0;
      for (let a = 0; a < 8; a++) {
        const px = clamp(Math.round(cx + Math.cos(a / 8 * 6.283) * r), 0, n - 1);
        const py = clamp(Math.round(cy + Math.sin(a / 8 * 6.283) * r), 0, n - 1);
        rim += S.h[py * n + px]; cnt++;
      }
      rim /= cnt;
      const dep = p.depth * (0.6 + rnd() * 0.8);
      for (let oy = -rr; oy <= rr; oy++) for (let ox = -rr; ox <= rr; ox++) {
        const nx = Math.round(cx) + ox, ny = Math.round(cy) + oy;
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        const d = Math.hypot(ox, oy) / r;
        if (d > 1.3) continue;
        const bowl = d < 1 ? (Math.cos(d * Math.PI) * 0.5 + 0.5) : 0;
        const m = smoothstep(1.3, 0.8, d);
        const j = ny * n + nx;
        const target = Math.min(rim - dep * 0.2, p.level - dep * bowl - 0.004);
        S.h[j] = S.h[j] + (Math.min(S.h[j], target) - S.h[j]) * m;
        S.moist[j] = clamp(S.moist[j] + m * 0.6, 0, 1);
      }
    }
    ctx.waterLevel = Math.max(ctx.waterLevel, p.level);
  }, { also: ['moist'] }),
  L(92, 'waterfall', 'Waterfall', 'Waterfall drop: stepped lip + plunge pool carving.', [
    P('x', 'X', 0, 1, 0.005, 0.5), P('y', 'Y', 0, 1, 0.005, 0.4),
    P('angle', 'Flow angle', 0, 360, 1, 90, '°'), P('drops', 'Drops', 1, 8, 1, 3),
    P('dropH', 'Drop height', 0.01, 0.3, 0.005, 0.07), P('pool', 'Pool size', 2, 30, 1, 9, 'px'),
    P('width', 'Width', 1, 20, 0.5, 5, 'px'),
  ], (ctx, p, S) => {
    const n = ctx.n, a = (p.angle * Math.PI) / 180, dx = Math.cos(a), dy = Math.sin(a);
    let cx = p.x * (n - 1), cy = p.y * (n - 1);
    let lipH = bilinear(S.h, n, cx, cy);
    for (let d = 0; d < p.drops; d++) {
      const stepLen = p.pool * 1.8;
      cx += dx * stepLen; cy += dy * stepLen;
      const target = lipH - p.dropH;
      // carve channel + plunge pool
      const r = Math.ceil(p.pool * 1.4);
      for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) {
        const nx = Math.round(cx) + ox, ny = Math.round(cy) + oy;
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        const along = (ox * dx + oy * dy) / p.pool, across = Math.abs(-ox * dy + oy * dx) / p.width;
        if (across > 2.2 || along < -1.6 || along > 1.2) continue;
        const pool = Math.exp(-(along * along) * 1.2 - across * across * 1.6);
        const j = ny * n + nx;
        S.h[j] = S.h[j] + (Math.min(S.h[j], target - p.dropH * 0.35 * pool) - S.h[j]) * clamp(pool * 1.4, 0, 1);
        S.moist[j] = 1;
      }
      lipH = target;
      cx += dx * p.pool * 0.6; cy += dy * p.pool * 0.6;
    }
  }, { also: ['moist'] }),
  L(93, 'delta', 'Delta', 'River delta: depositional fan + distributary channels.', [
    P('x', 'Apex X', 0, 1, 0.005, 0.5), P('y', 'Apex Y', 0, 1, 0.005, 0.3),
    P('angle', 'Flow angle', 0, 360, 1, 90, '°'), P('size', 'Fan size', 6, 90, 1, 36, 'px'),
    P('build', 'Build-up', 0, 0.2, 0.005, 0.05), P('channels', 'Channels', 1, 9, 1, 4),
    P('spread', 'Spread', 10, 120, 1, 55, '°'), SEED,
  ], (ctx, p, S) => {
    const n = ctx.n, rnd = mulberry32(p.seed * 37 + 99);
    const ax = p.x * (n - 1), ay = p.y * (n - 1);
    const base = (p.angle * Math.PI) / 180, half = (p.spread * Math.PI) / 360;
    const mouths = [];
    for (let c = 0; c < p.channels; c++) {
      const aa = base + (p.channels === 1 ? 0 : -half + (2 * half * c) / (p.channels - 1)) + (rnd() - 0.5) * 0.12;
      mouths.push(aa);
      let x = ax, y = ay;
      for (let s = 0; s < p.size * 1.2; s++) {
        x += Math.cos(aa) * 1 + (rnd() - 0.5) * 0.8;
        y += Math.sin(aa) * 1 + (rnd() - 0.5) * 0.8;
        const xi = Math.round(x), yi = Math.round(y);
        if (xi < 0 || yi < 0 || xi >= n || yi >= n) break;
        const t = s / (p.size * 1.2);
        const w = 0.8 + t * 2.2, r = Math.ceil(w * 2);
        for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) {
          const nx = xi + ox, ny = yi + oy;
          if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
          const dd = Math.hypot(ox, oy) / w;
          if (dd > 2) continue;
          S.h[ny * n + nx] -= Math.exp(-dd * dd * 1.6) * p.build * 0.35 * (1 - t * 0.5);
          S.moist[ny * n + nx] = clamp(S.moist[ny * n + nx] + 0.3, 0, 1);
        }
      }
    }
    // fan build-up between channels
    const r = Math.ceil(p.size * 1.2);
    const axi = Math.round(ax), ayi = Math.round(ay);
    for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) {
      const nx = axi + ox, ny = ayi + oy;
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      const d = Math.hypot(ox, oy) / p.size;
      if (d > 1.2) continue;
      let da = Math.atan2(oy, ox) - base;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      if (Math.abs(da) > half + 0.2) continue;
      const fan = (1 - smoothstep(0.7, 1.2, d)) * (1 - smoothstep(half, half + 0.2, Math.abs(da)));
      const lobe = 0.6 + 0.4 * fbm(valueNoise, nx / n * 9, ny / n * 9, { octaves: 2, seed: p.seed });
      S.h[ny * n + nx] += fan * p.build * lobe;
    }
    void mouths;
  }, { also: ['moist'] }),
  L(94, 'meander', 'Meander', 'Meandering river path carved across the tile.', [
    P('angle', 'Direction', 0, 180, 1, 90, '°'), P('amp', 'Amplitude', 0, 0.3, 0.005, 0.09),
    P('freq', 'Bends', 0.5, 10, 0.5, 3), P('width', 'Width', 0.5, 12, 0.25, 3, 'px'),
    P('depth', 'Depth', 0.01, 0.4, 0.005, 0.09), P('phase', 'Phase', 0, 6.28, 0.05, 0), SEED,
  ], (ctx, p, S) => {
    const n = ctx.n, a = (p.angle * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
    const steps = Math.ceil(n * 1.6);
    for (let s = 0; s <= steps; s++) {
      const t = s / steps - 0.3; // run past edges
      const along = t * n;
      const bend = Math.sin(t * p.freq * Math.PI * 2 + p.phase) * p.amp * n +
        Math.sin(t * p.freq * Math.PI * 2 * 2.7 + p.phase * 2) * p.amp * n * 0.25;
      const cx = n / 2 + ca * along - sa * bend, cy = n / 2 + sa * along + ca * bend;
      const wob = 1 + 0.25 * valueNoise(s * 0.05, p.seed, p.seed);
      const r = Math.ceil(p.width * wob * 2.4);
      for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) {
        const nx = Math.round(cx) + ox, ny = Math.round(cy) + oy;
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        const dd = Math.hypot(ox, oy) / (p.width * wob);
        if (dd > 2.4) continue;
        const chan = Math.exp(-dd * dd * 1.5);
        const cut = dd < 1 ? 1 : Math.exp(-(dd - 1) * 2); // cut bank vs slip-off slope
        const j = ny * n + nx;
        S.h[j] -= chan * p.depth * 0.14 * cut;
        S.moist[j] = clamp(S.moist[j] + chan * 0.55, 0, 1);
      }
    }
  }, { also: ['moist'] }),
];
