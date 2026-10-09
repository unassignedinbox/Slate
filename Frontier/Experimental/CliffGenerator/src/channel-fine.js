// Continuous channel profile on the mesh grid.
//
// The river simulation carves one height per simulation cell (4 m here), so every bank and every
// water edge is a stair of cell-sized steps. The network it produced is kept as line segments
// (centreline cell → downstream cell, with bed, water level, width and depth at each end), and this
// module evaluates the same channel law on the finer mesh grid: the distance to the nearest
// segment is continuous, the bed and water level are interpolated along the segment, and the bank
// is blended back into the base surface over the reach. The result is a smooth channel whose shore
// is a smooth contour, not a staircase.
//
// Pure JS; runs wherever refineField runs (main thread).

import { NO_WATER } from './features.js';

const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

// net: { N, size, px, pz, down, isRiver, width, depth, bed, wl, dry, bankSlope, maxBank }
//   px/pz: centreline position per river cell in simulation-cell units; bed/wl in metres.
// height: fine heights (M×M), modified in place. waterLevel: fine water (M×M), modified in place.
// Returns { river: Float32Array (M×M) } — the fine channel mask.
export function carveFineChannels(height, waterLevel, M, net, sea) {
  const { N, size, px, pz, down, isRiver, width, depth, bed, wl, dry, bankSlope, maxBank } = net;
  const total = M * M;
  const f = (M - 1) / (N - 1);            // fine cells per simulation cell
  const cellF = size / (M - 1);           // metres per fine cell
  const bestD = new Float32Array(total).fill(Infinity); // nearest distance, metres
  const bestI = new Float32Array(total).fill(-1);       // owning segment (start cell)
  const bestT = new Float32Array(total);                // position along it, 0..1
  const wetD = new Float32Array(total).fill(Infinity);  // nearest wet segment
  const wetI = new Int32Array(total).fill(-1);
  const wetT = new Float32Array(total);
  const river = new Float32Array(total);

  for (let s = 0; s < N * N; s++) {
    if (!isRiver[s]) continue;
    const d = down[s];
    const hasSeg = d >= 0 && isRiver[d];
    const ax = px[s] * f, az = pz[s] * f;
    const bx = hasSeg ? px[d] * f : ax, bz = hasSeg ? pz[d] * f : az;
    const w = width[s];
    const reachM = w * 0.5 + w * 1.6 + maxBank / bankSlope;     // reach of the bank blend [m]
    const reach = reachM / cellF + 1;
    const i0 = Math.max(0, Math.floor(Math.min(ax, bx) - reach)), i1 = Math.min(M - 1, Math.ceil(Math.max(ax, bx) + reach));
    const j0 = Math.max(0, Math.floor(Math.min(az, bz) - reach)), j1 = Math.min(M - 1, Math.ceil(Math.max(az, bz) + reach));
    const vx = bx - ax, vz = bz - az, vv = vx * vx + vz * vz;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        let t = vv > 1e-9 ? ((i - ax) * vx + (j - az) * vz) / vv : 0;
        t = Math.max(0, Math.min(1, t));
        const qx = ax + vx * t - i, qz = az + vz * t - j;
        const dm = Math.sqrt(qx * qx + qz * qz) * cellF;
        if (dm > reachM) continue;
        const c = j * M + i;
        if (dm < bestD[c]) { bestD[c] = dm; bestI[c] = s; bestT[c] = t; }
        if (!dry[s] && dm < wetD[c]) { wetD[c] = dm; wetI[c] = s; wetT[c] = t; }
      }
    }
  }

  for (let c = 0; c < total; c++) {
    const s = bestI[c];
    if (s < 0) continue;
    const base = height[c];
    if (base <= sea) continue;                      // the sea bed is not a bank
    const d = down[s];
    const hasSeg = d >= 0 && isRiver[d];
    const t = bestT[c];
    const w = width[s];
    const dep = depth[s];
    const half = w * 0.5;
    const dm = bestD[c];
    const bedHere = hasSeg ? bed[s] + (bed[d] - bed[s]) * t : bed[s];
    const wlHere = hasSeg ? wl[s] + (wl[d] - wl[s]) * t : wl[s];
    // channel law: a floor from the bed up to the bank foot, then a bank rising to its limit and
    // faded into the base surface. The floor is a smoothstep and the bank a cosine rise, so the
    // slope is zero where they join. The bank shape and its fade share one normalised distance x,
    // so the surface stays continuous at the reach limit.
    const reachB = maxBank / bankSlope;
    let target, a = 1;
    if (dm <= half) {
      const u = half > 0 ? dm / half : 0;
      target = bedHere + dep * 0.35 * smooth(0, 1, u);
    } else {
      const x = Math.min(1, (dm - half) / Math.max(1e-3, reachB));
      const bankH = Math.min(maxBank, reachB * bankSlope);
      target = bedHere + dep * 0.35 + bankH * 0.5 * (1 - Math.cos(Math.PI * x));
      a = 1 - smooth(0.5, 1, (dm - half) / Math.max(1e-3, reachB));
    }
    // never fill ground that is below the water: raising it would dam the river's own water out
    if (target > base && base < wlHere) target = base;
    if (a <= 0) continue;
    const next = base + (target - base) * a;
    height[c] = next;
    // water: the nearest wet segment decides the level (a dry gully beside a river keeps the water)
    const ws = wetI[c];
    // the water surface spreads out to where the bank rises above it, so the wet reach is the bank reach
    if (ws >= 0 && wetD[c] <= width[ws] * 0.5 + width[ws] * 1.6 + maxBank / bankSlope) {
      const wd = down[ws];
      const wHas = wd >= 0 && isRiver[wd];
      const wt = wetT[c];
      const wLevel = wHas ? wl[ws] + (wl[wd] - wl[ws]) * wt : wl[ws];
      river[c] = 1 - smooth(width[ws] * 0.45, width[ws] * 0.5 + width[ws] * 0.4, wetD[c]);
      if (wLevel > NO_WATER * 0.5 && wLevel > height[c] - 0.02) waterLevel[c] = wLevel;
    }
  }
  // the medial line between two segments is a faint crease (the nearest segment switches there):
  // two light passes over the channel band take it out without moving the shape
  for (let pass = 0; pass < 2; pass++) {
    const src = Float32Array.from(height);
    for (let cj = 1; cj < M - 1; cj++) for (let ci = 1; ci < M - 1; ci++) {
      const c = cj * M + ci, w = Math.min(1, river[c] * 1.5 + (bestI[c] >= 0 ? 0.25 : 0));
      if (w <= 0 || src[c] <= sea) continue;
      const sm = 4 * src[c] + 2 * (src[c - 1] + src[c + 1] + src[c - M] + src[c + M]) + src[c - M - 1] + src[c - M + 1] + src[c + M - 1] + src[c + M + 1];
      height[c] = src[c] + (sm / 16 - src[c]) * w * 0.5;
    }
  }
  return { river };
}
