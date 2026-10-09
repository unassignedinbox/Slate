// Evaluation context: the mutable state a layer sees (height, colour, water, named maps) plus lazily cached
// derived fields (slope, curvature, hydrology, AO, flow). Any change to height clears the derived cache.
import { slopeDegrees, gradientXY, laplacian, blurBox, localStdDev, percentile, clamp, newGrid, scaleToMax } from './grid.js';
import { routeWater } from './hydrology.js';

export function createContext(config, H, C) {
  const N = config.resolution;
  const ctx = {
    N,
    worldSize: config.worldSize,
    heightScale: config.heightScale,
    cellSize: config.worldSize / N,
    seed: config.seed ?? 1,
    H,
    C: C ?? newGrid(N * 3, 0.5),
    water: newGrid(N, 0),
    maps: {},          // name -> { ch, data }
    scatter: [],
    stats: {},
    cache: new Map(),
    get(name, fn) {
      if (!this.cache.has(name)) this.cache.set(name, fn(this));
      return this.cache.get(name);
    },
    setHeight(next) {
      this.H = next;
      this.cache.clear();
    },
  };
  return ctx;
}

// Derived fields. Each is a function of ctx and is memoised per height state.
export const derive = {
  slope: (ctx) => slopeDegrees(ctx.H, ctx.N, ctx.cellSize, ctx.heightScale),
  slopeN: (ctx) => scaleToMax(ctx.get('slope', derive.slope), 90),
  grad: (ctx) => gradientXY(ctx.H, ctx.N),
  lap: (ctx) => laplacian(ctx.H, ctx.N),
  // Convexity-positive curvature in [-1, 1]: + on ridges, - in valleys and hollows.
  curvature: (ctx) => {
    const lap = ctx.get('lap', derive.lap);
    const abs = Float32Array.from(lap, Math.abs);
    const s = percentile(abs, 0.98) || 1e-6;
    return Float32Array.from(lap, (v) => clamp(-v / s, -1, 1));
  },
  hydro: (ctx) => routeWater(ctx.H, ctx.N),
  flowN: (ctx) => {
    const acc = ctx.get('hydro', derive.hydro).acc;
    const out = new Float32Array(acc.length);
    let mx = 1;
    for (let i = 0; i < acc.length; i++) if (acc[i] > mx) mx = acc[i];
    const lm = Math.log(mx + 1);
    for (let i = 0; i < acc.length; i++) out[i] = Math.log(acc[i] + 1) / lm;
    return out;
  },
  blurSmall: (ctx) => blurBox(ctx.H, ctx.N, Math.max(1, Math.round(ctx.N / 128))),
  blurLarge: (ctx) => blurBox(ctx.H, ctx.N, Math.max(2, Math.round(ctx.N / 12))),
  roughness: (ctx) => localStdDev(ctx.H, ctx.N, Math.max(1, Math.round(ctx.N / 64))),
  // Hemispherical ambient occlusion from 8 horizon rays. 1 = open sky, 0 = fully occluded.
  ao: (ctx) => {
    const { N, H } = ctx;
    const hs = ctx.heightScale, cs = ctx.cellSize;
    const R = Math.max(4, Math.min(16, Math.round(N / 24)));
    const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
    const out = new Float32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = y * N + x, h0 = H[i] * hs;
      let occ = 0;
      for (const [dx, dy] of dirs) {
        let best = 0;
        for (let s = 1; s <= R; s++) {
          const nx = x + dx * s, ny = y + dy * s;
          if (nx < 0 || ny < 0 || nx >= N || ny >= N) break;
          const dist = s * cs * Math.hypot(dx, dy);
          const t = (H[ny * N + nx] * hs - h0) / dist;
          if (t > best) best = t;
        }
        occ += Math.atan(best) / (Math.PI / 2);
      }
      out[i] = clamp(1 - occ / dirs.length);
    }
    return out;
  },
};

// Shadow map for a directional sun. Cast by ray marching toward the light across the heightfield.
export function shadowMap(ctx, azimuthDeg, elevationDeg) {
  const { N, H } = ctx;
  const hs = ctx.heightScale, cs = ctx.cellSize;
  const az = (azimuthDeg * Math.PI) / 180, el = (Math.max(1, elevationDeg) * Math.PI) / 180;
  const dx = Math.cos(az), dy = Math.sin(az), slope = Math.tan(el);
  const steps = Math.min(N, 128);
  const out = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x, h0 = H[i] * hs;
    let lit = 1;
    for (let s = 1; s <= steps; s++) {
      const fx = x + dx * s, fy = y + dy * s;
      if (fx < 0 || fy < 0 || fx >= N - 1 || fy >= N - 1) break;
      const j = Math.round(fy) * N + Math.round(fx);
      const rayH = h0 + slope * s * cs;
      if (H[j] * hs > rayH) { lit = 0; break; }
    }
    out[i] = lit;
  }
  return out;
}
