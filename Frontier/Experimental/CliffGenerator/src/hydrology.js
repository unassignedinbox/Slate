// Simulated river network (Gaea-style "Rivers"): drainage of the eroded heightfield instead of
// hand-drawn channels. Pure JS — runs in the worker and under Node.
//
//   1. priority-flood depression filling (Barnes et al. 2014) with an epsilon gradient, seeded from
//      the map border and the sea, so every cell has a downhill path to an outlet
//   2. D8 steepest-descent flow directions on the filled surface and flow accumulation
//      (uniform rainfall + injected flow at drawn-river guides)
//   3. cells whose catchment exceeds a threshold are channel cells; width and depth scale with
//      catchment area; a monotone bed and water profile is built from the outlets upstream
//   4. channels are carved with a concave bed and sloped banks (chamfer distance from the nearest
//      channel cell, nearest-source semantics), braided bars on wide, flat reaches
//   5. depressions that are deep / large enough or fed by a channel become lakes at spill level
//
// Outputs masks and water levels in the same convention as features.js (NO_WATER where dry).

import { SimplexNoise } from './noise.js';
import { NO_WATER } from './features.js';

const smoothstep = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

// Binary min-heap on (key, index) pairs stored in parallel typed arrays.
class Heap {
  constructor(capacity) { this.k = new Float64Array(capacity); this.v = new Int32Array(capacity); this.n = 0; }
  push(key, val) {
    let i = this.n++;
    const k = this.k, v = this.v;
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v;
    const topV = v[0];
    const lastK = k[--this.n], lastV = v[this.n];
    let i = 0;
    for (;;) {
      let c = i * 2 + 1; if (c >= this.n) break;
      if (c + 1 < this.n && k[c + 1] < k[c]) c++;
      if (k[c] >= lastK) break;
      k[i] = k[c]; v[i] = v[c]; i = c;
    }
    k[i] = lastK; v[i] = lastV;
    return topV;
  }
  get size() { return this.n; }
}

const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DZ = [0, 0, 1, -1, 1, -1, 1, -1];
const DL = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];

// Priority flood: returns the filled surface and the processing order (increasing filled height).
export function fillDepressions(height, N, seaLevel = -Infinity) {
  const filled = new Float32Array(N * N);
  const closed = new Uint8Array(N * N);
  const order = new Int32Array(N * N);
  const heap = new Heap(N * N + 8);
  const eps = 1e-4;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const idx = j * N + i;
      const border = i === 0 || j === 0 || i === N - 1 || j === N - 1;
      if (border || height[idx] <= seaLevel) {
        filled[idx] = Math.max(height[idx], seaLevel);
        closed[idx] = 1; heap.push(filled[idx], idx);
      }
    }
  }
  let n = 0;
  while (heap.size) {
    const c = heap.pop();
    order[n++] = c;
    const ci = c % N, cj = (c - ci) / N;
    for (let d = 0; d < 8; d++) {
      const ni = ci + DX[d], nj = cj + DZ[d];
      if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
      const nidx = nj * N + ni;
      if (closed[nidx]) continue;
      closed[nidx] = 1;
      filled[nidx] = Math.max(height[nidx], filled[c] + eps * DL[d]);
      heap.push(filled[nidx], nidx);
    }
  }
  return { filled, order };
}

// D8 downstream neighbour on the filled surface (-1 at outlets).
export function flowDirections(filled, N) {
  const down = new Int32Array(N * N).fill(-1);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const idx = j * N + i;
      let best = -1, bestDrop = 0;
      for (let d = 0; d < 8; d++) {
        const ni = i + DX[d], nj = j + DZ[d];
        if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
        const nidx = nj * N + ni;
        const drop = (filled[idx] - filled[nidx]) / DL[d];
        if (drop > bestDrop) { bestDrop = drop; best = nidx; }
      }
      down[idx] = best;
    }
  }
  return down;
}

// opts: { catchment [km²], widthScale [m per √km²], maxWidth [m], depthScale, bankAngle [°],
//         maxBank [m], waterDepth (fraction of depth), braiding, lakes (0/1), lakeMinArea [cells],
//         seaLevel, sources: [gx, gz, ...] (drawn river guides), guideFlow [km²] }
export function simulateRivers(height, N, size, opts, seed = 1) {
  const cell = size / (N - 1);
  const cellKm2 = (cell * cell) / 1e6;
  const total = N * N;
  const original = Float32Array.from(height);

  const { filled, order } = fillDepressions(height, N, opts.seaLevel == null ? -Infinity : opts.seaLevel);
  const down = flowDirections(filled, N);

  // accumulation (in cells), highest cells first
  const acc = new Float32Array(total).fill(1);
  if (opts.sources && opts.sources.length) {
    const guide = Math.max(0, opts.guideFlow || 0) / cellKm2;
    for (let s = 0; s < opts.sources.length; s += 2) {
      const gi = Math.round(opts.sources[s]), gj = Math.round(opts.sources[s + 1]);
      if (gi < 0 || gj < 0 || gi >= N || gj >= N) continue;
      acc[gj * N + gi] += s === 0 ? guide : guide * 0.03;
    }
  }
  for (let n = total - 1; n >= 0; n--) {
    const c = order[n];
    const d = down[c];
    if (d >= 0) acc[d] += acc[c];
  }

  const threshold = Math.max(4, (opts.catchment || 0.1) / cellKm2);
  const isRiver = new Uint8Array(total);
  const width = new Float32Array(total);
  const depth = new Float32Array(total);
  const bed = new Float32Array(total);
  const wl = new Float32Array(total);
  const waterFrac = opts.waterDepth == null ? 0.6 : opts.waterDepth;
  const maxWidth = Math.max(cell * 2, opts.maxWidth || 120);
  let riverCells = 0;
  // outlets first so the downstream bed is known
  for (let n = 0; n < total; n++) {
    const c = order[n];
    if (acc[c] < threshold) continue;
    isRiver[c] = 1; riverCells++;
    const km2 = acc[c] * cellKm2;
    let w = Math.min(maxWidth, Math.max(cell * 1.5, (opts.widthScale || 25) * Math.sqrt(km2)));
    const dep = Math.max(0.5, (opts.depthScale || 1) * Math.pow(w, 0.45));
    width[c] = w; depth[c] = dep;
    const d = down[c];
    let b = filled[c] - dep;
    let l = b + dep * waterFrac;
    if (d >= 0 && isRiver[d]) {
      b = Math.max(b, bed[d] + 0.0004 * cell);
      l = Math.min(filled[c] - dep * 0.2, Math.max(b + dep * waterFrac, wl[d]));
      b = Math.min(b, l - dep * 0.25);
    }
    bed[c] = b; wl[c] = l;
  }

  const riverMask = new Float32Array(total);
  const waterLevel = new Float32Array(total).fill(NO_WATER);
  const lakeMask = new Float32Array(total);
  const stats = { riverCells, lakeCells: 0, maxWidth: 0, maxKm2: 0 };
  for (let c = 0; c < total; c++) if (isRiver[c]) { stats.maxWidth = Math.max(stats.maxWidth, width[c]); stats.maxKm2 = Math.max(stats.maxKm2, acc[c] * cellKm2); }

  // ---- lakes: depressions on the filled surface ---------------------------------------------
  const lakeLevel = new Float32Array(total).fill(NO_WATER);
  if (opts.lakes) {
    const seen = new Uint8Array(total);
    const stack = [];
    const minArea = Math.max(4, opts.lakeMinArea || 24);
    for (let s = 0; s < total; s++) {
      if (seen[s] || filled[s] - height[s] < 0.4) continue;
      // flood the connected depression
      stack.length = 0; stack.push(s); seen[s] = 1;
      const cells = []; let fed = false, deepest = 0;
      while (stack.length) {
        const c = stack.pop(); cells.push(c);
        if (acc[c] >= threshold * 0.5) fed = true;
        deepest = Math.max(deepest, filled[c] - height[c]);
        const ci = c % N, cj = (c - ci) / N;
        for (let d = 0; d < 4; d++) {
          const ni = ci + DX[d], nj = cj + DZ[d];
          if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
          const nidx = nj * N + ni;
          if (seen[nidx] || filled[nidx] - height[nidx] < 0.4) continue;
          seen[nidx] = 1; stack.push(nidx);
        }
      }
      if (cells.length < minArea && !(fed && deepest > 1.5)) continue;
      // partial fill: level between the deepest point and the spill level
      let minH = Infinity, spill = -Infinity;
      for (const c of cells) { if (height[c] < minH) minH = height[c]; if (filled[c] > spill) spill = filled[c]; }
      const fill = opts.lakeFill == null ? 1 : Math.max(0, Math.min(1, opts.lakeFill));
      const level = minH + (spill - minH) * fill - 0.05;
      for (const c of cells) {
        if (height[c] >= level) continue;
        lakeLevel[c] = level;
        lakeMask[c] = 1;
        stats.lakeCells++;
      }
    }
  }

  // ---- carve channels: chamfer distance from the nearest channel cell -----------------------
  const bankSlope = Math.tan((Math.max(10, Math.min(80, opts.bankAngle || 35)) * Math.PI) / 180);
  const maxBank = Math.max(1, opts.maxBank == null ? 30 : opts.maxBank);
  const dist = new Float32Array(total).fill(Infinity);
  const src = new Int32Array(total).fill(-1);
  const heap = new Heap(total * 2 + 8);
  for (let c = 0; c < total; c++) if (isRiver[c]) { dist[c] = 0; src[c] = c; heap.push(0, c); }
  const touched = [];
  while (heap.size) {
    const c = heap.pop();
    const dc = dist[c];
    const s = src[c];
    const reach = width[s] * 0.5 + width[s] * 1.6 + maxBank / bankSlope; // channel + water margin + banks
    if (dc * cell > reach) continue;
    touched.push(c);
    const ci = c % N, cj = (c - ci) / N;
    for (let d = 0; d < 8; d++) {
      const ni = ci + DX[d], nj = cj + DZ[d];
      if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
      const nidx = nj * N + ni;
      const nd = dc + DL[d];
      if (nd < dist[nidx]) { dist[nidx] = nd; src[nidx] = s; heap.push(nd, nidx); }
    }
  }

  const braidNoise = new SimplexNoise(seed * 19 + 3);
  const braiding = opts.braiding || 0;
  for (const c of touched) {
    const s = src[c];
    const d = dist[c] * cell;
    const w = width[s], dep = depth[s];
    let half = w * 0.5;
    const ci = c % N, cj = (c - ci) / N;
    const x = (ci / (N - 1) - 0.5) * size, z = (cj / (N - 1) - 0.5) * size;
    // braided bars on wide, gentle reaches
    let bar = 0;
    if (braiding > 0 && w > cell * 6) {
      const dn = down[s];
      const grad = dn >= 0 ? (bed[s] - bed[dn]) / (cell * 1.2) : 0;
      const gentle = 1 - smoothstep(0.003, 0.012, grad);
      const wide = smoothstep(cell * 6, cell * 14, w);
      const br = braiding * gentle * wide;
      if (br > 0) {
        half *= 1 + br * 1.2;
        const n = braidNoise.fbm(x / (w * 0.9), z / (w * 0.9), 3, 2.1, 0.55);
        const n2 = braidNoise.fbm(x / (w * 0.3) + 7, z / (w * 0.3) - 4, 2, 2, 0.5);
        bar = br * smoothstep(-0.05, 0.35, n + n2 * 0.35);
      }
    }
    const waterHere = wl[s];
    let target;
    if (d <= half) {
      const t = d / half;
      target = bed[s] + dep * 0.35 * t * t;
      // bars rise to just above the water so they read as gravel islands
      if (bar > 0) target = Math.max(target, target + (waterHere + 0.35 - target) * bar);
    } else {
      const rise = (d - half) * bankSlope;
      if (rise > maxBank) continue;
      target = bed[s] + dep * 0.35 + rise;
    }
    // lakes keep their floor
    if (lakeLevel[c] > NO_WATER * 0.5 && target < height[c]) target = Math.max(target, height[c] - dep * 0.3);
    if (target < height[c]) height[c] = target;
    const m = 1 - smoothstep(half, half + w * 0.9, d);
    if (m > riverMask[c]) riverMask[c] = m;
    if (d <= half + w * 1.5 && waterHere > waterLevel[c]) waterLevel[c] = waterHere;
  }

  // lakes: water at spill level over the depression (and a shore band in the mask)
  if (opts.lakes) {
    for (let c = 0; c < total; c++) {
      if (lakeLevel[c] <= NO_WATER * 0.5) continue;
      if (lakeLevel[c] > waterLevel[c]) waterLevel[c] = lakeLevel[c];
      // shallow silt bed just under the surface so the shore is not a knife edge
      const ci = c % N, cj = (c - ci) / N;
      for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
        const ii = ci + di, jj = cj + dj;
        if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue;
        const n = jj * N + ii;
        if (lakeMask[n] === 0) lakeMask[n] = Math.max(lakeMask[n], 0.5 - Math.hypot(di, dj) * 0.12);
      }
    }
  }

  // log-scaled accumulation for shading (wet streaks, gully floors)
  let maxAcc = 1;
  for (let c = 0; c < total; c++) if (acc[c] > maxAcc) maxAcc = acc[c];
  const flow = new Float32Array(total);
  const lm = Math.log1p(maxAcc);
  for (let c = 0; c < total; c++) flow[c] = Math.log1p(acc[c]) / lm;

  let cut = 0;
  for (let c = 0; c < total; c++) cut += original[c] - height[c];
  stats.cutVolume = cut * cell * cell;
  return { riverMask, waterLevel, lakeMask, flow, acc, filled, down, stats };
}
