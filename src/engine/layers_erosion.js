// Slate — erosion #53–69. All modify the heightmap (real carving).
import { clamp, mulberry32, bilinear, smoothstep, flowAccum } from './util.js';
import { valueNoise, fbm } from './noise.js';

const P = (k, label, min, max, step, def, unit = '', hint = '') =>
  ({ k, label, min, max, step, def, unit, hint, type: 'slider' });
const SEED = P('seed', 'Seed', 0, 9999, 1, 21);
const L = (n, id, name, desc, params, run, extra = {}) =>
  ({ n, id, name, cat: 'erosion', desc, targets: ['height'], params, run, ...extra });

// Classic droplet hydraulic erosion (Hans Theobald-style), in place on field f.
export function dropletErode(f, n, o = {}) {
  const {
    drops = 8000, lifetime = 24, inertia = 0.05, capacity = 4, minSlope = 0.02,
    erode = 0.35, deposit = 0.3, gravity = 4, evaporate = 0.01, seed = 1, rain = false,
  } = o;
  const rnd = mulberry32((seed * 2654435761) >>> 0 || 7);
  const maxDrop = Math.min(drops, n * n * 4);
  for (let d = 0; d < maxDrop; d++) {
    let x = rain ? rnd() * (n - 1) : 1 + rnd() * (n - 3);
    let y = rain ? rnd() * (n - 1) : 1 + rnd() * (n - 3);
    let dx = 0, dy = 0, speed = 1, water = 1, sed = 0;
    for (let s = 0; s < lifetime; s++) {
      const xi = x | 0, yi = y | 0;
      if (xi < 0 || yi < 0 || xi >= n - 1 || yi >= n - 1) break;
      const fx = x - xi, fy = y - yi;
      const i = yi * n + xi;
      const h00 = f[i], h10 = f[i + 1], h01 = f[i + n], h11 = f[i + n + 1];
      const gx = (h10 - h00) * (1 - fy) + (h11 - h01) * fy;
      const gy = (h01 - h00) * (1 - fx) + (h11 - h10) * fx;
      const hOld = h00 * (1 - fx) * (1 - fy) + h10 * fx * (1 - fy) + h01 * (1 - fx) * fy + h11 * fx * fy;
      dx = dx * inertia - gx * (1 - inertia);
      dy = dy * inertia - gy * (1 - inertia);
      const len = Math.hypot(dx, dy) || 1;
      dx /= len; dy /= len;
      x += dx; y += dy;
      if (x < 0 || y < 0 || x > n - 1.001 || y > n - 1.001) break;
      const hNew = bilinear(f, n, x, y);
      const dh = hNew - hOld;
      const cap = Math.max(-dh, minSlope) * speed * water * capacity;
      if (dh > 0) {
        const amt = Math.min(dh, sed);
        sed -= amt;
        addSed(f, n, xi, yi, fx, fy, amt * deposit + dh * 0.05);
      } else if (sed > cap || dh > -1e-5) {
        const amt = dh > -1e-5 ? Math.min(0.01, sed) : (sed - cap) * deposit;
        sed -= amt;
        addSed(f, n, xi, yi, fx, fy, amt);
      } else {
        const amt = Math.min((cap - sed) * erode, -dh * 2 + 0.002);
        sed += amt;
        addSed(f, n, xi, yi, fx, fy, -amt);
      }
      speed = Math.sqrt(Math.max(0.01, speed * speed + -dh * gravity));
      water *= 1 - evaporate;
      if (water < 0.01) {
        addSed(f, n, xi, yi, fx, fy, sed * 0.5);
        break;
      }
    }
  }
}
function addSed(f, n, xi, yi, fx, fy, amt) {
  const i = yi * n + xi;
  f[i] += amt * (1 - fx) * (1 - fy);
  f[i + 1] += amt * fx * (1 - fy);
  f[i + n] += amt * (1 - fx) * fy;
  f[i + n + 1] += amt * fx * fy;
}

// Thermal weathering: material above talus angle slides downhill. iters passes.
export function thermalErode(f, n, talus = 0.02, iters = 8, rate = 0.5) {
  const tmp = new Float32Array(n * n);
  for (let it = 0; it < iters; it++) {
    tmp.set(f);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const nb = [];
      if (x > 0) nb.push(i - 1);
      if (x < n - 1) nb.push(i + 1);
      if (y > 0) nb.push(i - n);
      if (y < n - 1) nb.push(i + n);
      let total = 0;
      const diffs = [];
      for (const j of nb) {
        const d = tmp[i] - tmp[j];
        if (d > talus) { diffs.push([j, d]); total += d; }
      }
      if (!total) continue;
      const move = Math.min((total / nb.length - talus) * rate, tmp[i]);
      for (const [j, d] of diffs) {
        const amt = move * (d / total);
        f[i] -= amt; f[j] += amt * 0.98;
      }
    }
  }
}

// Carve downhill channels from random seeds (stream/river networks).
export function carveStreams(f, n, o = {}) {
  const { count = 60, depth = 0.03, width = 1.5, length = 200, seed = 1, jitter = 0.35, sink = true } = o;
  const rnd = mulberry32((seed * 40503 + 17) >>> 0 || 3);
  for (let c = 0; c < count; c++) {
    let x = rnd() * (n - 1), y = rnd() * (n - 1);
    let px = 0, py = 0;
    const w = width * (0.6 + rnd() * 0.8);
    for (let s = 0; s < length; s++) {
      const xi = Math.round(x), yi = Math.round(y);
      if (xi < 1 || yi < 1 || xi >= n - 1 || yi >= n - 1) break;
      const gx = (bilinear(f, n, x + 1, y) - bilinear(f, n, x - 1, y)) * 0.5;
      const gy = (bilinear(f, n, x, y + 1) - bilinear(f, n, x, y - 1)) * 0.5;
      let dx = -gx + (rnd() - 0.5) * jitter * 0.02;
      let dy = -gy + (rnd() - 0.5) * jitter * 0.02;
      const l = Math.hypot(dx, dy);
      if (l < 1e-6) { if (!sink) break; dx = px; dy = py; }
      else { const il = 1 / l; dx *= il; dy *= il; }
      dx = dx * 0.7 + px * 0.3; dy = dy * 0.7 + py * 0.3;
      const l2 = Math.hypot(dx, dy) || 1;
      px = dx / l2; py = dy / l2;
      x += px; y += py;
      const r = Math.ceil(w * 2);
      const prof = 1 - s / length; // deeper upstream→mid, deposit at mouth
      for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) {
        const nx = Math.round(x) + ox, ny = Math.round(y) + oy;
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        const dd = Math.hypot(ox, oy) / Math.max(0.6, w);
        if (dd > 2) continue;
        const carve = Math.exp(-dd * dd * 1.8) * depth * (0.3 + 0.7 * prof);
        f[ny * n + nx] -= carve;
        if (s > length * 0.85) f[ny * n + nx] += carve * 0.35; // mouth fan
      }
    }
  }
}

const scaleDrops = (n, k) => Math.round(n * n * k);

export const LAYERS_EROSION = [
  L(53, 'hydro', 'Hydraulic (General)', 'Full droplet hydraulic simulation: rain + flow + deposition.', [
    P('drops', 'Droplets', 0.02, 1.5, 0.02, 0.35, '×px', 'Droplets as a fraction of pixel count'),
    P('lifetime', 'Lifetime', 4, 60, 1, 24, 'steps'), P('erode', 'Erode rate', 0.05, 1, 0.05, 0.35),
    P('deposit', 'Deposit rate', 0.05, 1, 0.05, 0.3), P('capacity', 'Capacity', 0.5, 12, 0.5, 4), SEED,
  ], (ctx, p, S) => dropletErode(S.h, ctx.n, {
    drops: scaleDrops(ctx.n, p.drops), lifetime: p.lifetime, erode: p.erode, deposit: p.deposit, capacity: p.capacity, seed: p.seed, rain: true,
  })),
  L(54, 'hydro-rain', 'Hydraulic Rain', 'Rain-impact particle erosion (short, even drops).', [
    P('drops', 'Droplets', 0.05, 3, 0.05, 0.8, '×px'), P('erode', 'Erode rate', 0.05, 1, 0.05, 0.3),
    P('roughen', 'Roughen', 0, 0.05, 0.002, 0.008), SEED,
  ], (ctx, p, S) => {
    dropletErode(S.h, ctx.n, { drops: scaleDrops(ctx.n, p.drops), lifetime: 8, erode: p.erode, deposit: 0.4, capacity: 2, seed: p.seed, rain: true });
    if (p.roughen > 0) {
      const n = ctx.n, rnd = mulberry32(p.seed * 31 + 5);
      for (let i = 0; i < S.h.length; i++) S.h[i] += (rnd() - 0.5) * p.roughen;
    }
  }),
  L(55, 'hydro-flow', 'Hydraulic Flow', 'Flow-direction erosion along D8 accumulation.', [
    P('strength', 'Strength', 0, 0.3, 0.005, 0.08), P('threshold', 'Threshold', 0, 1, 0.01, 0.25), P('soft', 'Softness', 0, 0.4, 0.01, 0.1),
  ], (ctx, p, S) => {
    const f = flowAccum(S.h, ctx.n);
    for (let i = 0; i < S.h.length; i++)
      S.h[i] -= smoothstep(p.threshold - p.soft, p.threshold + p.soft, f[i]) * p.strength * (0.4 + f[i]);
  }),
  L(56, 'hydro-stream', 'Hydraulic Stream', 'Stream-channel carving (many small channels).', [
    P('count', 'Streams', 4, 400, 1, 90), P('depth', 'Depth', 0.002, 0.12, 0.002, 0.02),
    P('width', 'Width', 0.4, 4, 0.1, 1.2, 'px'), P('length', 'Length', 20, 600, 5, 220, 'px'), SEED,
  ], (ctx, p, S) => carveStreams(S.h, ctx.n, { count: p.count, depth: p.depth, width: p.width, length: p.length, seed: p.seed })),
  L(57, 'hydro-river', 'Hydraulic River', 'River-system carving (few large valleys).', [
    P('count', 'Rivers', 1, 60, 1, 10), P('depth', 'Depth', 0.005, 0.25, 0.005, 0.06),
    P('width', 'Width', 1, 9, 0.25, 3.2, 'px'), P('length', 'Length', 50, 1200, 10, 600, 'px'), SEED,
  ], (ctx, p, S) => carveStreams(S.h, ctx.n, { count: p.count, depth: p.depth, width: p.width, length: p.length, seed: p.seed, jitter: 0.5, sink: false })),
  L(58, 'thermal', 'Thermal', 'Thermal weathering: talus slopes, scree.', [
    P('talus', 'Talus angle', 0.002, 0.12, 0.002, 0.025, 'h/px'), P('iters', 'Iterations', 1, 60, 1, 12), P('rate', 'Rate', 0.05, 1, 0.05, 0.5),
  ], (ctx, p, S) => thermalErode(S.h, ctx.n, p.talus, p.iters, p.rate)),
  L(59, 'wind', 'Wind', 'Wind abrasion: directional scour + lee deposition.', [
    P('angle', 'Wind angle', 0, 360, 1, 45, '°'), P('strength', 'Strength', 0, 0.2, 0.005, 0.05),
    P('gusts', 'Gustiness', 0, 1, 0.05, 0.5), P('iters', 'Passes', 1, 12, 1, 3), SEED,
  ], (ctx, p, S) => {
    const n = ctx.n, a = (p.angle * Math.PI) / 180, dx = Math.cos(a), dy = Math.sin(a);
    const tmp = new Float32Array(n * n);
    for (let it = 0; it < p.iters; it++) {
      tmp.set(S.h);
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const i = y * n + x;
        const up = bilinear(tmp, n, x - dx * 2, y - dy * 2);
        const gust = 0.6 + 0.8 * valueNoise(x * 0.05 + it * 9, y * 0.05, p.seed) * p.gusts + (1 - p.gusts) * 0.4;
        const diff = (tmp[i] - up) * p.strength * gust;
        S.h[i] = tmp[i] - Math.max(0, diff) * 0.7; // scour windward bumps
        const dn = bilinear(tmp, n, x + dx * 2, y + dy * 2);
        S.h[i] += Math.max(0, (tmp[i] - dn)) * p.strength * gust * 0.25; // lee deposit
      }
    }
  }),
  L(60, 'glacial', 'Glacial', 'Glacial carving: U-valleys along fall lines.', [
    P('strength', 'Strength', 0, 0.4, 0.01, 0.12), P('width', 'Valley width', 2, 24, 1, 8, 'px'),
    P('angle', 'Flow angle', 0, 360, 1, 90, '°'), P('cover', 'Ice cover', 0, 1, 0.05, 0.5), SEED,
  ], (ctx, p, S) => {
    const n = ctx.n, a = (p.angle * Math.PI) / 180, dx = Math.cos(a), dy = Math.sin(a);
    const cover = new Float32Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++)
      cover[y * n + x] = smoothstep(1 - p.cover - 0.2, 1 - p.cover + 0.3,
        fbm(valueNoise, x / n * 4, y / n * 4, { octaves: 3, seed: p.seed }));
    const src = Float32Array.from(S.h);
    const w = Math.max(1, Math.round(p.width / 2));
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const i = y * n + x, m = cover[i];
      if (m <= 0.01) continue;
      // U-profile: average across flow direction (widen), lower along it
      let acc = 0, cnt = 0;
      for (let s = -w; s <= w; s++) {
        acc += bilinear(src, n, x - dy * s, y + dx * s); cnt++;
      }
      const avg = acc / cnt;
      const down = bilinear(src, n, x + dx * w * 0.5, y + dy * w * 0.5);
      const u = (avg * 0.65 + Math.min(src[i], down) * 0.35);
      S.h[i] = src[i] + (Math.min(u, src[i]) - src[i]) * m * clamp(p.strength * 4, 0, 1) - m * p.strength * 0.15;
    }
  }),
  L(61, 'coastal', 'Coastal', 'Wave erosion at the coastline: notches + platforms.', [
    P('level', 'Sea level', 0, 1, 0.005, 0.3), P('range', 'Tidal range', 0.002, 0.12, 0.002, 0.03),
    P('strength', 'Strength', 0, 0.3, 0.01, 0.1), P('notch', 'Notch', 0, 1, 0.05, 0.5),
  ], (ctx, p, S) => {
    const n = ctx.n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const i = y * n + x, h = S.h[i];
      const band = Math.exp(-(((h - p.level) / Math.max(1e-4, p.range)) ** 2));
      const plat = smoothstep(p.level + p.range * 2, p.level - p.range, h); // below -> platform
      S.h[i] = h - band * p.strength * p.notch * 0.4 - plat * p.strength * 0.25 * (h > p.level - p.range * 3 ? 1 : 0.2);
    }
  }),
  L(62, 'cascade', 'Cascade', 'Waterfall / cascade erosion: stepped plunge pools.', [
    P('steps', 'Steps', 2, 16, 1, 6), P('strength', 'Strength', 0, 0.3, 0.01, 0.1),
    P('pools', 'Pool depth', 0, 0.2, 0.005, 0.05),
  ], (ctx, p, S) => {
    const n = ctx.n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const i = y * n + x, h = S.h[i];
      const t = clamp(h * p.steps, 0, p.steps - 1e-3);
      const f = t - Math.floor(t); // position within step
      const edge = smoothstep(0.75, 1, f); // lip of each step
      S.h[i] = h - edge * p.strength * 0.3 - smoothstep(0, 0.2, f) * edge * 0 + (1 - edge) * 0;
      S.h[i] -= smoothstep(0.9, 1, f) * p.pools; // plunge pool under lip
    }
    thermalErode(S.h, n, 0.05, 2, 0.3);
  }),
  L(63, 'sediment', 'Sediment Transport', 'Move deposited material downhill (advect + settle).', [
    P('dist', 'Distance', 0.5, 12, 0.5, 3, 'px'), P('settle', 'Settle rate', 0, 1, 0.05, 0.4), P('iters', 'Passes', 1, 8, 1, 2),
  ], (ctx, p, S) => {
    const n = ctx.n;
    for (let it = 0; it < p.iters; it++) {
      const src = Float32Array.from(S.h);
      for (let y = 1; y < n - 1; y++) for (let x = 1; x < n - 1; x++) {
        const i = y * n + x;
        const gx = (src[i + 1] - src[i - 1]) * 0.5, gy = (src[i + n] - src[i - n]) * 0.5;
        const l = Math.hypot(gx, gy);
        if (l < 1e-5) continue;
        const sx = x + (gx / l) * p.dist, sy = y + (gy / l) * p.dist; // downhill
        const target = bilinear(src, n, sx, sy);
        const move = (src[i] - target) * p.settle * 0.15;
        if (move > 0) { S.h[i] -= move * 0.5; }
      }
      // settle pass: blur lows
      for (let y = 1; y < n - 1; y++) for (let x = 1; x < n - 1; x++) {
        const i = y * n + x;
        const avg = (S.h[i - 1] + S.h[i + 1] + S.h[i - n] + S.h[i + n]) * 0.25;
        if (avg < S.h[i]) S.h[i] = S.h[i] + (avg - S.h[i]) * p.settle * 0.3;
      }
    }
  }, { also: ['moist'] }),
  L(64, 'debris-flow', 'Debris Flow', 'Mud/debris flows: channelized scour + fan deposits.', [
    P('strength', 'Strength', 0, 0.3, 0.01, 0.1), P('slopeMin', 'Min slope°', 5, 60, 1, 18, '°'),
    P('fans', 'Fan size', 1, 16, 1, 6, 'px'), SEED,
  ], (ctx, p, S) => {
    const n = ctx.n, src = Float32Array.from(S.h);
    const rnd = mulberry32(p.seed * 97 + 3);
    const fans = [];
    for (let k = 0; k < 24; k++) fans.push([rnd() * (n - 1), rnd() * (n - 1), 0.5 + rnd()]);
    for (let y = 1; y < n - 1; y++) for (let x = 1; x < n - 1; x++) {
      const i = y * n + x;
      const gx = (src[i + 1] - src[i - 1]) * 0.5, gy = (src[i + n] - src[i - n]) * 0.5;
      const sl = Math.atan(Math.hypot(gx, gy)) * 180 / Math.PI;
      if (sl < p.slopeMin) continue;
      const l = Math.hypot(gx, gy) || 1;
      const ch = bilinear(src, n, x + (gx / l) * 2, y + (gy / l) * 2);
      const scour = Math.max(0, src[i] - ch) * p.strength * 2;
      S.h[i] -= scour;
      // deposit fan downhill
      const fx = Math.round(x + (gx / l) * p.fans), fy = Math.round(y + (gy / l) * p.fans);
      if (fx > 0 && fy > 0 && fx < n && fy < n) S.h[fy * n + fx] += scour * 0.4;
    }
    void fans;
  }, { also: ['moist'] }),
  L(65, 'snowmelt', 'Snowmelt', 'Meltwater erosion weighted by snow zones.', [
    P('line', 'Snow line', 0, 1, 0.01, 0.5), P('strength', 'Strength', 0, 0.3, 0.01, 0.09), P('rills', 'Rill count', 4, 200, 1, 60), SEED,
  ], (ctx, p, S) => {
    const n = ctx.n;
    const snow = new Float32Array(n * n);
    for (let i = 0; i < snow.length; i++) snow[i] = smoothstep(p.line - 0.08, p.line + 0.15, S.h[i]);
    const f = flowAccum(S.h, n);
    for (let i = 0; i < S.h.length; i++) S.h[i] -= snow[i] * f[i] * p.strength;
    const keep = Float32Array.from(S.h);
    carveStreams(S.h, n, { count: p.rills, depth: p.strength * 0.2, width: 1, length: 120, seed: p.seed });
    for (let i = 0; i < S.h.length; i++) S.h[i] = keep[i] + (S.h[i] - keep[i]) * snow[i];
  }),
  L(66, 'fast-erosion', 'FastErosion', 'Quick single-pass erosion (thermal + smooth).', [
    P('talus', 'Talus', 0.005, 0.12, 0.005, 0.03), P('smooth', 'Smooth', 0, 1, 0.05, 0.35),
  ], (ctx, p, S) => {
    thermalErode(S.h, ctx.n, p.talus, 1, 0.6);
    const n = ctx.n, src = Float32Array.from(S.h);
    for (let y = 1; y < n - 1; y++) for (let x = 1; x < n; x++) {
      const i = y * n + x;
      const avg = (src[i - 1] + src[i + 1] + src[i - n] + src[i + n]) * 0.25;
      S.h[i] = src[i] + (avg - src[i]) * p.smooth;
    }
  }),
  L(67, 'flow-erosion', 'FlowErosion', 'Flow-map driven erosion (uses live flow).', [
    P('strength', 'Strength', 0, 0.4, 0.01, 0.12), P('width', 'Channel width', 0.5, 6, 0.25, 1.5, 'px'),
  ], (ctx, p, S) => {
    const n = ctx.n, f = flowAccum(S.h, n);
    // widen flow by max-filter
    const r = Math.max(0, Math.round(p.width));
    const w = new Float32Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      let m = 0;
      for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) {
        const nx = clamp(x + ox, 0, n - 1), ny = clamp(y + oy, 0, n - 1);
        m = Math.max(m, f[ny * n + nx]);
      }
      w[y * n + x] = m;
    }
    for (let i = 0; i < S.h.length; i++) S.h[i] -= w[i] * w[i] * p.strength;
  }),
  L(68, 'rain-erosion', 'RainErosion', 'Raindrop splash: micro-pits + grain.', [
    P('pits', 'Pit count', 0.01, 2, 0.01, 0.3, '×px'), P('size', 'Pit size', 0.5, 4, 0.25, 1.2, 'px'),
    P('depth', 'Depth', 0.001, 0.05, 0.001, 0.008), SEED,
  ], (ctx, p, S) => {
    const n = ctx.n, rnd = mulberry32(p.seed * 13 + 29);
    const count = Math.round(n * n * p.pits);
    for (let k = 0; k < count; k++) {
      const cx = rnd() * (n - 1), cy = rnd() * (n - 1);
      const r = Math.ceil(p.size * 2);
      const d = p.depth * (0.5 + rnd());
      for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) {
        const nx = Math.round(cx) + ox, ny = Math.round(cy) + oy;
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        const dd = Math.hypot(ox, oy) / p.size;
        if (dd > 2) continue;
        const prof = Math.exp(-dd * dd * 2) - 0.35 * Math.exp(-((dd - 1.4) ** 2) * 3); // pit + rim
        S.h[ny * n + nx] -= prof * d;
      }
    }
  }),
  L(69, 'stream-erosion', 'StreamErosion', 'Dendritic stream-network carving from D8 paths.', [
    P('seeds', 'Seed streams', 4, 300, 1, 80), P('depth', 'Depth', 0.002, 0.1, 0.002, 0.015),
    P('width', 'Width', 0.4, 4, 0.1, 1, 'px'), P('trib', 'Tributaries', 0, 1, 0.05, 0.6), SEED,
  ], (ctx, p, S) => {
    carveStreams(S.h, ctx.n, { count: p.seeds, depth: p.depth, width: p.width, length: 260, seed: p.seed });
    if (p.trib > 0)
      carveStreams(S.h, ctx.n, { count: Math.round(p.seeds * p.trib), depth: p.depth * 0.55, width: Math.max(0.4, p.width * 0.6), length: 130, seed: p.seed ^ 0x5eed, jitter: 0.6 });
  }),
];
