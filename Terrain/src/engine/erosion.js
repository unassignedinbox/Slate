// 53-69 Erosion. Every node modifies the incoming heightmap and returns a new one.
// Hydraulic variants use a particle simulation that picks up and deposits sediment; stream-power variants
// route water over the surface (see hydrology.js) and incise channels in proportion to discharge and slope.
import { makeDef } from './def.js';
import { num, int, sel, seedParam } from './schema.js';
import { mulberry32 } from './rng.js';
import { clamp, lerp, blurBox, blurGauss, smoothstep, sampleBilinear, distanceFromMask } from './grid.js';
import { derive } from './context.js';
import { routeWater } from './hydrology.js';

const bil = (h, N, x, y) => sampleBilinear(h, N, x, y);

// Lague-style particle hydraulics. Operates on a copy of the field.
export function particleErosion(H, N, o, seed) {
  const h = Float32Array.from(H);
  const rnd = mulberry32(seed);
  const r = Math.max(1, Math.round(o.radius));
  const brushI = [], brushW = [];
  let wsum = 0;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const d = Math.hypot(dx, dy);
    if (d > r) continue;
    const w = 1 - d / (r + 1);
    brushI.push(dy * N + dx); brushW.push(w); wsum += w;
  }
  for (let k = 0; k < brushW.length; k++) brushW[k] /= wsum;
  const inertia = o.inertia, minSlope = 0.0005;
  for (let n = 0; n < o.drops; n++) {
    let x = 2 + rnd() * (N - 5), y = 2 + rnd() * (N - 5);
    let dx = 0, dy = 0, speed = 1, water = 1, sed = 0;
    for (let s = 0; s < o.life; s++) {
      const ix = Math.floor(x), iy = Math.floor(y);
      if (ix < 1 || iy < 1 || ix >= N - 2 || iy >= N - 2) break;
      const fx = x - ix, fy = y - iy, idx = iy * N + ix;
      const h00 = h[idx], h10 = h[idx + 1], h01 = h[idx + N], h11 = h[idx + N + 1];
      const gx = (h10 - h00) * (1 - fy) + (h11 - h01) * fy;
      const gy = (h01 - h00) * (1 - fx) + (h11 - h10) * fx;
      dx = dx * inertia - gx * (1 - inertia);
      dy = dy * inertia - gy * (1 - inertia);
      let len = Math.hypot(dx, dy);
      if (len < 1e-9) { const a = rnd() * Math.PI * 2; dx = Math.cos(a); dy = Math.sin(a); len = 1; }
      dx /= len; dy /= len;
      const nx = x + dx, ny = y + dy;
      if (nx < 1 || ny < 1 || nx >= N - 2 || ny >= N - 2) break;
      const hOld = h00 * (1 - fx) * (1 - fy) + h10 * fx * (1 - fy) + h01 * (1 - fx) * fy + h11 * fx * fy;
      const hNew = bil(h, N, nx, ny);
      const dH = hNew - hOld;
      const cap = Math.max(-dH, minSlope) * speed * water * o.capacity;
      if (sed > cap || dH > 0) {
        const dep = dH > 0 ? Math.min(dH, sed) : (sed - cap) * o.deposit;
        sed -= dep;
        h[idx] += dep * (1 - fx) * (1 - fy); h[idx + 1] += dep * fx * (1 - fy);
        h[idx + N] += dep * (1 - fx) * fy; h[idx + N + 1] += dep * fx * fy;
      } else {
        const ero = Math.min((cap - sed) * o.erode, -dH);
        sed += ero;
        for (let k = 0; k < brushI.length; k++) {
          const j = idx + brushI[k];
          if (j < 0 || j >= h.length) continue;
          h[j] -= ero * brushW[k];
        }
      }
      speed = Math.sqrt(Math.max(0, speed * speed + dH * o.gravity));
      water *= 1 - o.evaporation;
      x = nx; y = ny;
    }
  }
  for (let i = 0; i < h.length; i++) h[i] = clamp(h[i]);
  return h;
}

// Thermal weathering: material slides from cells steeper than the talus slope to lower neighbours.
export function thermal(H, N, talusCells, iters, rate) {
  let h = Float32Array.from(H);
  for (let it = 0; it < iters; it++) {
    const next = Float32Array.from(h);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = y * N + x;
      for (const [dx, dy] of [[1, 0], [0, 1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx >= N || ny >= N) continue;
        const j = ny * N + nx;
        const d = h[i] - h[j];
        if (d > talusCells) { const m = rate * (d - talusCells) * 0.5; next[i] -= m; next[j] += m; }
        else if (-d > talusCells) { const m = rate * (-d - talusCells) * 0.5; next[j] -= m; next[i] += m; }
      }
    }
    h = next;
  }
  return h;
}

// Mass-conserving transfer along the D8 routing: each cell hands part of its excess to its downstream cell.
function downslopeTransfer(H, N, dir, rate, iters, minDrop) {
  let h = Float32Array.from(H);
  for (let it = 0; it < iters; it++) {
    const next = Float32Array.from(h);
    for (let i = 0; i < h.length; i++) {
      const j = dir[i];
      if (j < 0) continue;
      const d = h[i] - h[j];
      if (d > minDrop) { const m = Math.min(rate * (d - minDrop), d * 0.5); next[i] -= m; next[j] += m; }
    }
    h = next;
  }
  return h;
}

const cellsOf = (ctx, deg) => (Math.tan((deg * Math.PI) / 180) * ctx.cellSize) / ctx.heightScale;

// Channel mask from the flow accumulation (log-normalised), with a soft edge.
const channelMask = (ctx, thr) => {
  const f = ctx.get('flowN', derive.flowN);
  return Float32Array.from(f, (v) => smoothstep(thr, thr + 0.03, v));
};

export const erosionDefs = [
  makeDef({
    id: 53, key: 'hydraulic', name: 'Hydraulic (General)', cat: 'Erosion', status: 'full',
    params: [int('drops', 'Droplets (thousands)', 60, 1, 1000), int('life', 'Droplet lifetime', 60, 5, 200), num('inertia', 'Inertia', 0.05, 0, 0.99, 0.01),
      num('capacity', 'Sediment capacity', 8, 0.1, 40, 0.1), num('erode', 'Erode rate', 0.3, 0, 1, 0.01), num('deposit', 'Deposit rate', 0.3, 0, 1, 0.01),
      num('evaporation', 'Evaporation', 0.02, 0, 0.2, 0.001), num('gravity', 'Gravity', 4, 0.5, 20, 0.1), num('radius', 'Brush radius', 2, 1, 6, 1), seedParam(31)],
    desc: 'Particle hydraulic erosion: droplets roll downhill, pick up sediment on slopes and drop it on flats.',
    run: (ctx, p) => ({ height: particleErosion(ctx.H, ctx.N, { ...p, drops: p.drops * 1000 * (ctx.N / 256) ** 2 }, p.seed) }),
  }),
  makeDef({
    id: 54, key: 'hydraulicRain', name: 'Hydraulic Rain', cat: 'Erosion', status: 'full',
    params: [int('drops', 'Rain drops (thousands)', 120, 1, 1000), int('life', 'Fall length', 40, 5, 200), num('evaporation', 'Evaporation', 0.08, 0, 0.3, 0.001),
      num('deposit', 'Deposit rate', 0.5, 0, 1, 0.01), num('erode', 'Erode rate', 0.2, 0, 1, 0.01), seedParam(32)],
    desc: 'Rain-driven particle erosion: many short-lived drops with fast evaporation, depositing more readily.',
    run: (ctx, p) => ({ height: particleErosion(ctx.H, ctx.N, {
      drops: p.drops * 1000 * (ctx.N / 256) ** 2, life: p.life, inertia: 0.2, capacity: 5, erode: p.erode, deposit: p.deposit,
      evaporation: p.evaporation, gravity: 3, radius: 2,
    }, p.seed) }),
  }),
  makeDef({
    id: 55, key: 'hydraulicFlow', name: 'Hydraulic Flow', cat: 'Erosion', status: 'full',
    params: [num('strength', 'Strength', 0.5, 0, 2, 0.01), num('m', 'Area exponent m', 0.5, 0, 1, 0.01), num('n', 'Slope exponent n', 1, 0.2, 2, 0.01),
      int('passes', 'Passes (re-routing)', 3, 1, 8), num('smooth', 'Bed smoothing', 0.6, 0, 3, 0.05)],
    desc: 'Flow-direction erosion: stream-power incision E = K·A^m·S^n, re-routing water between passes.',
    run: (ctx, p) => {
      let h = Float32Array.from(ctx.H);
      const N = ctx.N;
      for (let pass = 0; pass < p.passes; pass++) {
        const hyd = routeWater(h, N);
        const cs = ctx.cellSize / ctx.heightScale;
        const a = Float32Array.from(hyd.acc, (v) => v * cs * cs * 1e4);
        let amax = 1; for (let i = 0; i < a.length; i++) if (a[i] > amax) amax = a[i];
        const next = Float32Array.from(h);
        for (let i = 0; i < N * N; i++) {
          const s = Math.min(1, hyd.slope[i] / cs);
          const e = p.strength * Math.pow(a[i] / amax, p.m) * Math.pow(s, p.n);
          next[i] = clamp(h[i] - e * 0.25);
        }
        h = blurBox(next, N, 1);
        if (p.smooth > 0) h = blurGauss(h, N, p.smooth);
      }
      return { height: h };
    },
  }),
  makeDef({
    id: 56, key: 'hydraulicStream', name: 'Hydraulic Stream', cat: 'Erosion', status: 'full',
    params: [num('threshold', 'Channel threshold', 0.55, 0, 1, 0.01), num('depth', 'Channel depth', 0.08, 0, 0.5, 0.005), num('width', 'Channel width (cells)', 2, 1, 12, 0.5)],
    desc: 'Stream channels: cells whose drainage area exceeds the threshold are carved into the surface.',
    run: (ctx, p) => {
      const ch = channelMask(ctx, p.threshold);
      const soft = blurGauss(ch, ctx.N, p.width);
      const f = ctx.get('flowN', derive.flowN);
      return { height: Float32Array.from(ctx.H, (v, i) => clamp(v - p.depth * soft[i] * (0.5 + 0.5 * f[i]))) };
    },
  }),
  makeDef({
    id: 57, key: 'hydraulicRiver', name: 'Hydraulic River', cat: 'Erosion', status: 'full',
    params: [num('threshold', 'Main river threshold', 0.8, 0, 1, 0.01), num('depth', 'Incision depth', 0.1, 0, 0.5, 0.005), num('valley', 'Valley width (cells)', 8, 1, 40, 0.5), num('alluvium', 'Floodplain deposit', 0.3, 0, 1, 0.01)],
    desc: 'Major rivers: deep incision with a wide valley and alluvial floodplain deposition on the flanks.',
    run: (ctx, p) => {
      const N = ctx.N;
      const ch = channelMask(ctx, p.threshold);
      const valley = blurGauss(ch, N, p.valley);
      const f = ctx.get('flowN', derive.flowN);
      const lowness = Float32Array.from(ctx.get('slopeN', derive.slopeN), (s) => 1 - smoothstep(0.05, 0.35, s));
      const out = Float32Array.from(ctx.H);
      for (let i = 0; i < out.length; i++) {
        const carve = p.depth * ch[i] * (0.4 + 0.6 * f[i]);
        const fill = p.alluvium * p.depth * 0.5 * (valley[i] - ch[i]) * lowness[i];
        out[i] = clamp(out[i] - carve + Math.max(0, fill));
      }
      return { height: out };
    },
  }),
  makeDef({
    id: 58, key: 'thermal', name: 'Thermal', cat: 'Erosion', status: 'full',
    params: [num('talus', 'Talus angle [deg]', 35, 5, 70, 0.5), int('iterations', 'Iterations', 40, 1, 300), num('rate', 'Rate', 0.5, 0, 1, 0.01)],
    desc: 'Thermal weathering: slopes steeper than the talus angle shed material to lower neighbours.',
    run: (ctx, p) => ({ height: thermal(ctx.H, ctx.N, cellsOf(ctx, p.talus), p.iterations, p.rate) }),
  }),
  makeDef({
    id: 59, key: 'wind', name: 'Wind', cat: 'Erosion', status: 'approx',
    params: [num('direction', 'Wind direction [deg]', 45, -180, 180, 1), num('strength', 'Strength', 0.5, 0, 1, 0.01), int('iterations', 'Iterations', 12, 1, 80), num('reach', 'Reach (cells)', 3, 1, 20, 0.5)],
    desc: 'Aeolian abrasion and saltation: relaxes each cell toward the surface upwind, smearing ridges leeward.',
    run: (ctx, p) => {
      const N = ctx.N, a = (p.direction * Math.PI) / 180, wx = Math.cos(a), wy = Math.sin(a);
      let h = Float32Array.from(ctx.H);
      for (let it = 0; it < p.iterations; it++) {
        const next = new Float32Array(h.length);
        for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
          const i = y * N + x;
          const up = bil(h, N, x - wx * p.reach, y - wy * p.reach);
          const d = h[i] - up;
          next[i] = h[i] - p.strength * 0.5 * Math.max(0, d) * 0.6 + p.strength * 0.5 * Math.max(0, -d) * 0.6;
        }
        h = next;
      }
      return { height: h };
    },
  }),
  makeDef({
    id: 60, key: 'glacial', name: 'Glacial', cat: 'Erosion', status: 'full',
    params: [num('threshold', 'Glacier threshold', 0.6, 0, 1, 0.01), num('radius', 'Valley radius (cells)', 14, 2, 60, 0.5), num('depth', 'Trough depth', 0.12, 0, 0.5, 0.005), num('floor', 'Flat floor share', 0.35, 0, 0.9, 0.01)],
    desc: 'Glacial U-valleys: a parabolic trough carved around each major drainage line.',
    run: (ctx, p) => {
      const N = ctx.N;
      const ch = channelMask(ctx, p.threshold);
      const dist = distanceFromMask(ch, N, p.radius);
      const out = new Float32Array(ctx.H.length);
      for (let i = 0; i < out.length; i++) {
        const t = clamp(dist[i] / p.radius);
        const u = t >= 1 ? 0 : 1 - t * t;
        const profile = p.floor * (t < p.floor ? 1 : 0) + (1 - p.floor) * u;
        out[i] = clamp(ctx.H[i] - p.depth * Math.max(0, profile));
      }
      return { height: out };
    },
  }),
  makeDef({
    id: 61, key: 'coastal', name: 'Coastal', cat: 'Erosion', status: 'approx',
    params: [num('sea', 'Sea level', 0.3, 0, 1, 0.01), num('band', 'Wave band', 0.06, 0.005, 0.3, 0.005), num('strength', 'Strength', 0.6, 0, 1, 0.01), num('cliff', 'Cliff undercut', 0.5, 0, 1, 0.01)],
    desc: 'Wave abrasion along the shoreline: planes the shore, cuts back steep cliffs in the wave band.',
    run: (ctx, p) => {
      const slopeN = ctx.get('slopeN', derive.slopeN);
      const out = new Float32Array(ctx.H.length);
      for (let i = 0; i < out.length; i++) {
        const h = ctx.H[i];
        const w = Math.exp(-(((h - p.sea) / p.band) ** 2)) * p.strength;
        const planed = lerp(h, p.sea + (h - p.sea) * 0.15, w);
        const undercut = p.cliff * w * slopeN[i] * 0.5;
        out[i] = clamp(planed - undercut * Math.max(0, h - p.sea));
      }
      return { height: out };
    },
  }),
  makeDef({
    id: 62, key: 'cascade', name: 'Cascade', cat: 'Erosion', status: 'approx',
    params: [num('threshold', 'River threshold', 0.6, 0, 1, 0.01), num('steep', 'Steepness [deg]', 18, 2, 60, 0.5), int('steps', 'Step count', 6, 1, 40), num('amount', 'Amount', 0.6, 0, 1, 0.01)],
    desc: 'Waterfalls and cascades: channel reaches that are steep are stepped into terraces.',
    run: (ctx, p) => {
      const ch = channelMask(ctx, p.threshold);
      const s = ctx.get('slope', derive.slope);
      const out = new Float32Array(ctx.H.length);
      for (let i = 0; i < out.length; i++) {
        const h = ctx.H[i];
        const q = Math.floor(h * p.steps) / p.steps + smoothstep(0.7, 1, (h * p.steps) % 1) / p.steps;
        const w = ch[i] * smoothstep(p.steep - 4, p.steep + 4, s[i]) * p.amount;
        out[i] = lerp(h, q, w);
      }
      return { height: out };
    },
  }),
  makeDef({
    id: 63, key: 'sediment', name: 'Sediment Transport', cat: 'Erosion', status: 'full',
    params: [num('fill', 'Fill amount', 0.6, 0, 1, 0.01), num('flatness', 'Flatness preference', 0.7, 0, 1, 0.01)],
    desc: 'Sediment deposition: depressions are filled from the water routing, weighted toward flat ground.',
    run: (ctx, p) => {
      const filled = ctx.get('hydro', derive.hydro).filled;
      const flat = Float32Array.from(ctx.get('slopeN', derive.slopeN), (s) => Math.pow(1 - s, 1 + 3 * p.flatness));
      return { height: Float32Array.from(ctx.H, (h, i) => clamp(h + p.fill * (filled[i] - h) * flat[i])) };
    },
  }),
  makeDef({
    id: 64, key: 'debris', name: 'Debris Flow', cat: 'Erosion', status: 'full',
    params: [num('rate', 'Transfer rate', 0.4, 0, 1, 0.01), int('iterations', 'Iterations', 25, 1, 200), num('threshold', 'Min drop', 0.0005, 0, 0.02, 0.0001)],
    desc: 'Mud and debris flows: mass moves downstream along the routing, conserving material.',
    run: (ctx, p) => {
      const dir = ctx.get('hydro', derive.hydro).dir;
      return { height: downslopeTransfer(ctx.H, ctx.N, dir, p.rate, p.iterations, p.threshold) };
    },
  }),
  makeDef({
    id: 65, key: 'snowmelt', name: 'Snowmelt', cat: 'Erosion', status: 'approx',
    params: [num('snowline', 'Snowline', 0.6, 0, 1, 0.01), num('creep', 'Frost creep', 0.6, 0, 1, 0.01), num('melt', 'Meltwater transport', 0.3, 0, 1, 0.01)],
    desc: 'Freeze-thaw creep above the snowline (rounds ridges and peaks), with meltwater carrying the debris downslope.',
    run: (ctx, p) => {
      const N = ctx.N;
      const high = Float32Array.from(ctx.H, (h) => smoothstep(p.snowline - 0.05, p.snowline + 0.05, h));
      const creep = blurGauss(ctx.H, N, 1.5);
      let h = Float32Array.from(ctx.H, (v, i) => lerp(v, creep[i], high[i] * p.creep));
      const dir = routeWater(h, N).dir;
      h = downslopeTransfer(h, N, dir, p.melt * 0.4, 6, 0.0008);
      return { height: h };
    },
  }),
  makeDef({
    id: 66, key: 'fastErosion', name: 'Fast Erosion', cat: 'Erosion', status: 'full',
    params: [num('strength', 'Strength', 0.4, 0, 2, 0.01), num('smooth', 'Smoothing', 0.8, 0, 4, 0.05)],
    desc: 'Single-pass stream-power erosion using the current routing (cheap, one re-route).',
    run: (ctx, p) => {
      const hyd = ctx.get('hydro', derive.hydro);
      const N = ctx.N, cs = ctx.cellSize / ctx.heightScale;
      const acc = hyd.acc;
      let amax = 1; for (let i = 0; i < acc.length; i++) if (acc[i] > amax) amax = acc[i];
      const out = new Float32Array(ctx.H.length);
      for (let i = 0; i < out.length; i++) {
        const s = Math.min(1, hyd.slope[i] / cs);
        out[i] = clamp(ctx.H[i] - p.strength * 0.1 * Math.sqrt(acc[i] / amax) * s);
      }
      return { height: p.smooth > 0 ? blurGauss(out, N, p.smooth) : out };
    },
  }),
  makeDef({
    id: 67, key: 'flowErosion', name: 'Flow Erosion', cat: 'Erosion', status: 'full',
    params: [num('strength', 'Strength', 0.5, 0, 2, 0.01), int('passes', 'Passes', 4, 1, 12), num('smooth', 'Bank smoothing', 0.5, 0, 3, 0.05)],
    desc: 'Flow-map driven erosion: each pass advects sediment down the flow direction map.',
    run: (ctx, p) => {
      const N = ctx.N;
      let h = Float32Array.from(ctx.H);
      for (let pass = 0; pass < p.passes; pass++) {
        const hyd = routeWater(h, N);
        const cs = ctx.cellSize / ctx.heightScale;
        const next = Float32Array.from(h);
        let amax = 1; for (let i = 0; i < hyd.acc.length; i++) if (hyd.acc[i] > amax) amax = hyd.acc[i];
        for (let i = 0; i < next.length; i++) {
          const j = hyd.dir[i];
          if (j < 0) continue;
          const drop = h[i] - h[j];
          const m = p.strength * 0.15 * Math.sqrt(hyd.acc[i] / amax) * Math.min(1, Math.max(0, drop) / cs);
          next[i] -= m; next[j] += m * 0.5;
        }
        h = p.smooth > 0 ? blurGauss(next, N, p.smooth * 0.5) : next;
      }
      return { height: h };
    },
  }),
  makeDef({
    id: 68, key: 'rainErosion', name: 'Rain Erosion', cat: 'Erosion', status: 'approx',
    params: [int('drops', 'Splashes (thousands)', 80, 1, 800), num('splash', 'Splash depth', 0.05, 0, 0.3, 0.005), int('seed', 'Seed', 9, 1, 9999)],
    desc: 'Raindrop splash erosion: random impacts excavate small pits and splash their spoil onto neighbours.',
    run: (ctx, p) => {
      const N = ctx.N, rnd = mulberry32(p.seed);
      const h = Float32Array.from(ctx.H);
      const count = Math.round(p.drops * 1000 * (N / 256) ** 2);
      for (let k = 0; k < count; k++) {
        const x = Math.floor(rnd() * (N - 2)) + 1, y = Math.floor(rnd() * (N - 2)) + 1, i = y * N + x;
        const d = p.splash * (0.5 + rnd()) * 0.2;
        h[i] -= d;
        h[i + 1] += d * 0.25; h[i - 1] += d * 0.25; h[i + N] += d * 0.25; h[i - N] += d * 0.25;
      }
      return { height: blurGauss(h, N, 0.6) };
    },
  }),
  makeDef({
    id: 69, key: 'streamErosion', name: 'Stream Erosion', cat: 'Erosion', status: 'full',
    params: [num('K', 'Stream power K', 0.3, 0, 2, 0.01), num('m', 'Area exponent', 0.5, 0, 1, 0.01), num('uplift', 'Base uplift', 0, 0, 0.3, 0.005)],
    desc: 'Stream network erosion: channel bed lowering by stream power, E = K·A^m·S, with re-routing.',
    run: (ctx, p) => {
      const cs = ctx.cellSize / ctx.heightScale;
      const hyd = ctx.get('hydro', derive.hydro);
      let amax = 1; for (let i = 0; i < hyd.acc.length; i++) if (hyd.acc[i] > amax) amax = hyd.acc[i];
      const out = new Float32Array(ctx.H.length);
      for (let i = 0; i < out.length; i++) {
        const e = p.K * Math.pow(hyd.acc[i] / amax, p.m) * Math.min(1, hyd.slope[i] / cs);
        out[i] = clamp(ctx.H[i] - e * 0.08 + p.uplift * 0.01);
      }
      return { height: out };
    },
  }),
];

