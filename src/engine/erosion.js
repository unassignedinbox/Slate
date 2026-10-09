// Erosion solvers. Each takes a Float32Array heightfield and returns a new one.
import { hash2 } from './noise.js';
import { boxBlur, gradient, fillDepressions, d8Receivers, flowAccumulation, clamp, clamp01, sample, slopeOf } from './grid.js';

// Particle-based hydraulic erosion (droplet model, Lague-style).
export function dropletErosion(src, N, o = {}) {
  const h = Float32Array.from(src);
  const iters = o.iterations ?? 60000, seed = o.seed ?? 1;
  const inertia = o.inertia ?? 0.05, capacityK = o.capacity ?? 4;
  const erodeS = o.erodeSpeed ?? 0.3, depositS = o.depositSpeed ?? 0.3;
  const evap = o.evaporation ?? 0.01, maxSteps = o.maxSteps ?? 40, radius = o.radius ?? 2;
  const gravity = 4, minSlope = 0.01;
  // erosion brush weights
  const brush = [];
  let wsum = 0;
  for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
    const d = Math.hypot(dx, dy);
    if (d > radius) continue;
    const w = Math.max(0, 1 - d / radius);
    brush.push([dx, dy, w]); wsum += w;
  }
  brush.forEach((b) => { b[2] /= wsum; });
  for (let it = 0; it < iters; it++) {
    let px = hash2(it, 3, seed) * (N - 2) + 1, py = hash2(it, 7, seed) * (N - 2) + 1;
    let dirx = 0, diry = 0, speed = 1, water = 1, sediment = 0;
    for (let s = 0; s < maxSteps; s++) {
      const xi = px | 0, yi = py | 0;
      if (xi < 1 || yi < 1 || xi >= N - 2 || yi >= N - 2) break;
      const fx = px - xi, fy = py - yi;
      const i = yi * N + xi;
      const hA = h[i], hB = h[i + 1], hC = h[i + N], hD = h[i + N + 1];
      const gxv = (hB - hA) * (1 - fy) + (hD - hC) * fy;
      const gyv = (hC - hA) * (1 - fx) + (hD - hB) * fx;
      const hHere = hA * (1 - fx) * (1 - fy) + hB * fx * (1 - fy) + hC * (1 - fx) * fy + hD * fx * fy;
      dirx = dirx * inertia - gxv * (1 - inertia);
      diry = diry * inertia - gyv * (1 - inertia);
      const len = Math.hypot(dirx, diry);
      if (len < 1e-9) break;
      dirx /= len; diry /= len;
      const nx = px + dirx, ny = py + diry;
      if (nx < 1 || ny < 1 || nx >= N - 2 || ny >= N - 2) break;
      const nxi = nx | 0, nyi = ny | 0, nfx = nx - nxi, nfy = ny - nyi;
      const j = nyi * N + nxi;
      const hNew = h[j] * (1 - nfx) * (1 - nfy) + h[j + 1] * nfx * (1 - nfy) + h[j + N] * (1 - nfx) * nfy + h[j + N + 1] * nfx * nfy;
      const dh = hNew - hHere;
      const cap = Math.max(-dh, minSlope) * speed * water * capacityK;
      if (sediment > cap || dh > 0) {
        const dep = dh > 0 ? Math.min(dh, sediment) : (sediment - cap) * depositS;
        sediment -= dep;
        h[i] += dep * (1 - fx) * (1 - fy); h[i + 1] += dep * fx * (1 - fy);
        h[i + N] += dep * (1 - fx) * fy; h[i + N + 1] += dep * fx * fy;
      } else {
        const er = Math.min((cap - sediment) * erodeS, -dh);
        for (const [bx, by, bw] of brush) {
          const cx = xi + bx, cy = yi + by;
          if (cx < 0 || cy < 0 || cx >= N || cy >= N) continue;
          const amt = er * bw;
          h[cy * N + cx] -= amt;
        }
        sediment += er;
      }
      speed = Math.sqrt(Math.max(0, speed * speed + dh * gravity));
      water *= 1 - evap;
      px = nx; py = ny;
    }
  }
  return h;
}

// Thermal weathering: material above the talus angle slides to lower neighbours.
export function thermal(src, N, o = {}) {
  const h = Float32Array.from(src);
  const talus = o.talus ?? 0.01, rate = o.rate ?? 0.5, iters = o.iterations ?? 40;
  const D = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let it = 0; it < iters; it++) {
    const delta = new Float32Array(h.length);
    for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
      const i = y * N + x;
      let total = 0, over = [];
      for (const [dx, dy] of D) {
        const j = (y + dy) * N + (x + dx);
        const d = h[i] - h[j];
        if (d > talus) { over.push([j, d]); total += d; }
      }
      if (!total) continue;
      const move = (total * 0.5) * rate;
      for (const [j, d] of over) {
        const m = move * d / total;
        delta[i] -= m; delta[j] += m;
      }
    }
    for (let i = 0; i < h.length; i++) h[i] += delta[i];
  }
  return h;
}

// Stream-power incision: E = K * A^m * S^n. Creates real valley/channel networks.
export function streamPower(src, N, o = {}) {
  let h = Float32Array.from(src);
  const K = o.K ?? 0.5, m = o.m ?? 0.5, n = o.n ?? 1, iters = o.iterations ?? 4;
  const dt = o.dt ?? 0.5, thresh = o.threshold ?? 0;
  for (let it = 0; it < iters; it++) {
    const filled = fillDepressions(h, N);
    const recv = d8Receivers(filled, N);
    const { acc } = flowAccumulation(filled, N, recv);
    const amax = Math.max(...acc);
    const next = Float32Array.from(h);
    for (let i = 0; i < h.length; i++) {
      const r = recv[i];
      if (r === i) continue;
      const dist = (r - i === 1 || i - r === 1 || r - i === N || i - r === N) ? 1 : Math.SQRT2;
      const S = Math.max(0, (h[i] - h[r]) / dist) * N * 0.5;
      const A = acc[i] / amax;
      if (acc[i] < thresh) continue;
      const e = K * Math.pow(A, m) * Math.pow(S, n);
      next[i] -= Math.min(e * dt, 0.5 * (h[i] - h[r]) + 1e-6);
    }
    h = next;
  }
  return h;
}

// Wind abrasion: material is eroded on windward faces and deposited leeward.
export function windErosion(src, N, o = {}) {
  const strength = o.strength ?? 0.3, ang = ((o.angle ?? 0) * Math.PI) / 180;
  const dx = Math.cos(ang), dy = Math.sin(ang);
  const { gx, gy } = gradient(src, N);
  const abrade = new Float32Array(src.length);
  const out = Float32Array.from(src);
  for (let i = 0; i < src.length; i++) {
    const windward = Math.max(0, -(gx[i] * dx + gy[i] * dy));
    abrade[i] = Math.min(windward * 4, 0.05) * strength;
    out[i] -= abrade[i];
  }
  // deposit: shift the removed material downwind via a directional blur
  const shifted = new Float32Array(src.length);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const sx = x - dx * 3, sy = y - dy * 3;
    shifted[y * N + x] = sample(abrade, N, sx, sy);
  }
  for (let i = 0; i < out.length; i++) out[i] += shifted[i] * 0.9;
  return boxBlur(out, N, 1);
}

// Glacial carving: U-shaped valleys around high-flow channels.
export function glacial(src, N, o = {}) {
  const h = Float32Array.from(src);
  const filled = fillDepressions(src, N);
  const recv = d8Receivers(filled, N);
  const { acc } = flowAccumulation(filled, N, recv);
  const amax = Math.max(...acc);
  const chan = new Float32Array(h.length);
  for (let i = 0; i < h.length; i++) chan[i] = acc[i] / amax > (o.threshold ?? 0.02) ? 1 : 0;
  const width = o.width ?? 6, depth = o.depth ?? 0.06;
  const dist = boxBlur(chan, N, Math.max(1, width | 0));
  for (let i = 0; i < h.length; i++) {
    const u = clamp01(dist[i] * 1.8);
    h[i] -= depth * u * u * (1 - 0.3 * u);
  }
  return h;
}

// Coastal wave erosion near a sea level: notches cliffs and flattens the shelf.
export function coastal(src, N, o = {}) {
  const h = Float32Array.from(src);
  const sea = o.seaLevel ?? 0.2, band = o.band ?? 0.05, strength = o.strength ?? 0.5;
  const sm = boxBlur(src, N, 2);
  for (let i = 0; i < h.length; i++) {
    const d = Math.abs(h[i] - sea);
    if (d < band) {
      const w = 1 - d / band;
      h[i] += (sea - h[i]) * 0.3 * w * strength + (sm[i] - h[i]) * 0.2 * w;
    }
  }
  return h;
}

// Cascade: steepens over-steep flow paths into stepped falls.
export function cascade(src, N, o = {}) {
  const h = Float32Array.from(src);
  const thresh = o.threshold ?? 0.02, steps = o.steps ?? 3, amount = o.amount ?? 0.02;
  const s = slopeOf(h, N, 1);
  for (let i = 0; i < h.length; i++) {
    if (s[i] > thresh) {
      const q = Math.round(h[i] / amount / (steps / 3 + 1)) * amount * (steps / 3 + 1);
      h[i] = h[i] * 0.6 + q * 0.4;
    }
  }
  return h;
}

// Sediment transport: material moves from steep slopes to flat deposition zones.
export function sedimentTransport(src, N, o = {}) {
  const sl = slopeOf(src, N, 1);
  const flat = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) flat[i] = 1 - sl[i];
  const dep = boxBlur(src, N, o.radius ?? 4);
  const out = Float32Array.from(src);
  const amt = o.amount ?? 0.5;
  for (let i = 0; i < out.length; i++) {
    const w = flat[i] * flat[i] * amt;
    out[i] = out[i] * (1 - w) + dep[i] * w;
  }
  return out;
}

// Debris flow: steep material is pushed downhill along D8 receivers.
export function debrisFlow(src, N, o = {}) {
  let h = Float32Array.from(src);
  const iters = o.iterations ?? 8, thresh = o.threshold ?? 0.25, rate = o.rate ?? 0.3;
  for (let it = 0; it < iters; it++) {
    const recv = d8Receivers(h, N);
    const sl = slopeOf(h, N, 1);
    const delta = new Float32Array(h.length);
    for (let i = 0; i < h.length; i++) {
      if (sl[i] <= thresh || recv[i] === i) continue;
      const m = (sl[i] - thresh) * rate * 0.05;
      delta[i] -= m; delta[recv[i]] += m;
    }
    for (let i = 0; i < h.length; i++) h[i] += delta[i];
  }
  return h;
}

// Snowmelt: meltwater erodes only above the snowline, along the slope.
export function snowmelt(src, N, o = {}) {
  const line = o.snowline ?? 0.6, rate = o.rate ?? 0.4;
  const b = boxBlur(src, N, 2);
  const out = Float32Array.from(src);
  for (let i = 0; i < src.length; i++) {
    const w = clamp01((src[i] - line) / 0.2);
    out[i] += (b[i] - src[i]) * rate * w;
  }
  return out;
}

// Quick single-pass erosion approximation: one stream-power pass plus diffusion.
export function fastErosion(src, N, o = {}) {
  return boxBlur(streamPower(src, N, { K: o.K ?? 0.4, m: 0.5, n: 1, iterations: 1, dt: 0.6 }), N, 1);
}

// Flow-map driven erosion: smooths along the local gradient direction.
export function flowErosion(src, N, o = {}) {
  const { gx, gy } = gradient(src, N);
  const out = new Float32Array(src.length);
  const k = o.strength ?? 0.5, steps = o.steps ?? 6;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x;
    const len = Math.hypot(gx[i], gy[i]) || 1;
    let acc = 0;
    for (let s = -steps; s <= steps; s++) {
      acc += sample(src, N, x + (gx[i] / len) * s * 0.5, y + (gy[i] / len) * s * 0.5);
    }
    out[i] = src[i] * (1 - k) + (acc / (2 * steps + 1)) * k;
  }
  return out;
}

// Rain splash: local diffusion scaled by slope (raindrop impact).
export function rainErosion(src, N, o = {}) {
  const sl = slopeOf(src, N, 1);
  const b = boxBlur(src, N, 1);
  const out = Float32Array.from(src);
  const k = o.strength ?? 0.5;
  for (let i = 0; i < out.length; i++) out[i] += (b[i] - src[i]) * k * sl[i];
  return out;
}

export function hydraulicGeneral(src, N, o = {}) {
  let h = dropletErosion(src, N, { iterations: o.iterations ?? 40000, seed: o.seed ?? 1 });
  return thermal(h, N, { iterations: 4, talus: 0.02, rate: 0.3 });
}

export function hydraulicRain(src, N, o = {}) {
  let h = dropletErosion(src, N, { iterations: o.iterations ?? 80000, capacity: 2, erodeSpeed: 0.2, depositSpeed: 0.5, seed: o.seed ?? 5, maxSteps: 30 });
  return rainErosion(h, N, { strength: 0.3 });
}

// Dispatch table for Gaea erosion nodes 53-69 (index = node id).
export const EROSION = {
  53: (h, N, o) => hydraulicGeneral(h, N, o),
  54: (h, N, o) => hydraulicRain(h, N, o),
  55: (h, N, o) => flowErosion(streamPower(h, N, { K: o.K, m: 0.5, n: 1, iterations: o.iterations, dt: 0.5 }), N, { strength: 0.2, steps: 3 }),
  56: (h, N, o) => streamPower(h, N, { K: o.K, m: 0.5, n: 1, iterations: o.iterations, dt: 0.5, threshold: o.threshold }),
  57: (h, N, o) => streamPower(h, N, { K: o.K, m: 0.6, n: 1, iterations: o.iterations, dt: 0.5, threshold: o.threshold }),
  58: (h, N, o) => thermal(h, N, o),
  59: (h, N, o) => windErosion(h, N, o),
  60: (h, N, o) => glacial(h, N, o),
  61: (h, N, o) => coastal(h, N, o),
  62: (h, N, o) => cascade(h, N, o),
  63: (h, N, o) => sedimentTransport(h, N, o),
  64: (h, N, o) => debrisFlow(h, N, o),
  65: (h, N, o) => snowmelt(h, N, o),
  66: (h, N, o) => fastErosion(h, N, o),
  67: (h, N, o) => flowErosion(h, N, o),
  68: (h, N, o) => rainErosion(h, N, o),
  69: (h, N, o) => streamPower(h, N, { K: o.K, m: 0.5, n: 1, iterations: o.iterations, dt: 0.5, threshold: o.threshold }),
};
