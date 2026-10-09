// 95-128 Filters / modifiers. Each takes the incoming heightfield and returns a transformed one.
// Derived-view nodes (Slope, Direction, Convexity, Concavity, Roughness, Smoothness) output their measurement as height.
import { makeDef } from './def.js';
import { num, int } from './schema.js';
import { clamp, lerp, smoothstep, blurGauss, blurBox, morphFilter, normalizeGrid, minMax, scaleToMax } from './grid.js';
import { derive } from './context.js';
import { fieldOf } from './sampling.js';
import { hash2 } from './rng.js';

const px = (N, scale) => Math.max(0, (scale * N) / 256);
const box = (H, N, r) => blurBox(H, N, Math.max(0, Math.round(r)));
const pivot = (p) => p.pivot ?? 0.5;

// Median over a (2r+1)^2 window.
function medianFilter(H, N, r) {
  const out = new Float32Array(N * N), buf = new Float32Array((2 * r + 1) * (2 * r + 1));
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let k = 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      buf[k++] = H[Math.min(N - 1, Math.max(0, y + dy)) * N + Math.min(N - 1, Math.max(0, x + dx))];
    }
    buf.sort();
    out[y * N + x] = buf[k >> 1];
  }
  return out;
}

// Histogram-equalisation via the cumulative distribution.
function equalise(H) {
  const bins = 1024;
  const { min, max } = minMax(H);
  const r = max - min || 1;
  const cdf = new Float32Array(bins);
  for (let i = 0; i < H.length; i++) cdf[Math.min(bins - 1, Math.floor(((H[i] - min) / r) * bins))]++;
  let acc = 0;
  for (let b = 0; b < bins; b++) { acc += cdf[b]; cdf[b] = acc / H.length; }
  return Float32Array.from(H, (v) => cdf[Math.min(bins - 1, Math.floor(((v - min) / r) * bins))]);
}

// Gradient components (unit height per cell) in cell units, rescaled to world metres of slope.
const slopeMap = (ctx) => ctx.get('slope', derive.slope);

export const filterDefs = [
  makeDef({
    id: 95, key: 'blurGauss', name: 'Blur Gaussian', cat: 'Filters', params: [num('radius', 'Radius (px @256)', 3, 0, 40, 0.1)],
    desc: 'Gaussian blur (three box passes, variance matched).',
    run: (ctx, p) => ({ height: blurGauss(ctx.H, ctx.N, px(ctx.N, p.radius) + 0.01) }),
  }),
  makeDef({
    id: 96, key: 'blurBox', name: 'Blur Box', cat: 'Filters', params: [num('radius', 'Radius (px @256)', 3, 0, 40, 0.1)],
    desc: 'Box (average) blur.',
    run: (ctx, p) => ({ height: box(ctx.H, ctx.N, px(ctx.N, p.radius)) }),
  }),
  makeDef({
    id: 97, key: 'blurRadial', name: 'Blur Radial', cat: 'Filters', params: [num('strength', 'Strength', 0.5, 0, 1, 0.01), int('taps', 'Taps', 9, 3, 32), ...[num('cx', 'Centre X', 0, -1, 1, 0.01), num('cy', 'Centre Y', 0, -1, 1, 0.01)]],
    desc: 'Radial (zoom) blur: samples smeared toward or away from a centre.',
    run: (ctx, p) => {
      const N = ctx.N, cx = (p.cx * 0.5 + 0.5) * (N - 1), cy = (p.cy * 0.5 + 0.5) * (N - 1);
      const H = ctx.H;
      return { height: fieldOf(N, (x, y) => {
        let s = 0, n = 0;
        for (let k = 0; k < p.taps; k++) {
          const t = (k / (p.taps - 1) - 0.5) * p.strength;
          const sx = cx + (x - cx) * (1 + t), sy = cy + (y - cy) * (1 + t);
          const ix = clamp(Math.round(sx), 0, N - 1), iy = clamp(Math.round(sy), 0, N - 1);
          s += H[iy * N + ix]; n++;
        }
        return s / n;
      }) };
    },
  }),
  makeDef({
    id: 98, key: 'sharpen', name: 'Sharpen', cat: 'Filters', params: [num('amount', 'Amount', 0.8, 0, 3, 0.01), num('radius', 'Radius (px @256)', 2, 0.5, 20, 0.1)],
    desc: 'Unsharp sharpening: adds back the difference between the image and its blur.',
    run: (ctx, p) => {
      const b = blurGauss(ctx.H, ctx.N, px(ctx.N, p.radius) + 0.5);
      return { height: Float32Array.from(ctx.H, (h, i) => clamp(h + p.amount * (h - b[i]))) };
    },
  }),
  makeDef({
    id: 99, key: 'unsharp', name: 'Unsharp Mask', cat: 'Filters', params: [num('amount', 'Amount', 1.2, 0, 4, 0.01), num('radius', 'Radius (px @256)', 4, 0.5, 30, 0.1), num('threshold', 'Threshold', 0.002, 0, 0.1, 0.0005)],
    desc: 'Unsharp mask with a threshold: only differences above the threshold are amplified.',
    run: (ctx, p) => {
      const b = blurGauss(ctx.H, ctx.N, px(ctx.N, p.radius) + 0.5);
      return { height: Float32Array.from(ctx.H, (h, i) => {
        const d = h - b[i];
        return clamp(Math.abs(d) > p.threshold ? h + p.amount * d : h);
      }) };
    },
  }),
  makeDef({
    id: 100, key: 'median', name: 'Median', cat: 'Filters', params: [int('radius', 'Radius', 1, 1, 4)],
    desc: 'Median filter: removes spikes while keeping edges.',
    run: (ctx, p) => ({ height: medianFilter(ctx.H, ctx.N, p.radius) }),
  }),
  makeDef({
    id: 101, key: 'dilate', name: 'Dilate', cat: 'Filters', params: [int('radius', 'Radius (cells)', 1, 1, 12)],
    desc: 'Morphological dilation: maximum over a window (ridges grow).',
    run: (ctx, p) => ({ height: morphFilter(ctx.H, ctx.N, p.radius, true) }),
  }),
  makeDef({
    id: 102, key: 'erodeMorph', name: 'Erode (Morphological)', cat: 'Filters', params: [int('radius', 'Radius (cells)', 1, 1, 12)],
    desc: 'Morphological erosion: minimum over a window (ridges shrink).',
    run: (ctx, p) => ({ height: morphFilter(ctx.H, ctx.N, p.radius, false) }),
  }),
  makeDef({
    id: 103, key: 'smooth', name: 'Smooth', cat: 'Filters', params: [int('iterations', 'Iterations', 4, 1, 60), num('amount', 'Amount', 0.5, 0, 1, 0.01)],
    desc: 'General smoothing: repeated four-neighbour averaging.',
    run: (ctx, p) => {
      const N = ctx.N;
      let h = Float32Array.from(ctx.H);
      for (let it = 0; it < p.iterations; it++) {
        const n = new Float32Array(h.length);
        for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
          const i = y * N + x;
          const a = h[y * N + Math.max(0, x - 1)], b = h[y * N + Math.min(N - 1, x + 1)];
          const c = h[Math.max(0, y - 1) * N + x], d = h[Math.min(N - 1, y + 1) * N + x];
          n[i] = lerp(h[i], (a + b + c + d) * 0.25, p.amount);
        }
        h = n;
      }
      return { height: h };
    },
  }),
  makeDef({
    id: 104, key: 'detailEnhance', name: 'Detail Enhance', cat: 'Filters', params: [num('amount', 'Amount', 1.0, 0, 4, 0.01), num('scale', 'Detail scale (px @256)', 6, 1, 40, 0.5)],
    desc: 'Boosts high-frequency detail: the residual above a broad blur is amplified.',
    run: (ctx, p) => {
      const b = blurGauss(ctx.H, ctx.N, px(ctx.N, p.scale));
      return { height: Float32Array.from(ctx.H, (h, i) => clamp(h + p.amount * (h - b[i]))) };
    },
  }),
  makeDef({
    id: 105, key: 'contrast', name: 'Contrast', cat: 'Filters', params: [num('amount', 'Contrast', 1.3, 0, 4, 0.01), num('pivot', 'Pivot', 0.5, 0, 1, 0.01)],
    desc: 'Contrast around a pivot value.',
    run: (ctx, p) => ({ height: Float32Array.from(ctx.H, (h) => clamp((h - pivot(p)) * p.amount + pivot(p))) }),
  }),
  makeDef({
    id: 106, key: 'brightness', name: 'Brightness', cat: 'Filters', params: [num('amount', 'Offset', 0, -1, 1, 0.005)],
    desc: 'Shifts all heights up or down.',
    run: (ctx, p) => ({ height: Float32Array.from(ctx.H, (h) => clamp(h + p.amount)) }),
  }),
  makeDef({
    id: 107, key: 'gamma', name: 'Gamma', cat: 'Filters', params: [num('gamma', 'Gamma', 1.5, 0.1, 4, 0.01)],
    desc: 'Power-law (gamma) correction.',
    run: (ctx, p) => ({ height: Float32Array.from(ctx.H, (h) => clamp(h) ** p.gamma) }),
  }),
  makeDef({
    id: 108, key: 'levels', name: 'Levels', cat: 'Filters', params: [num('inLo', 'Input black', 0, 0, 1, 0.005), num('inHi', 'Input white', 1, 0, 1, 0.005), num('outLo', 'Output black', 0, 0, 1, 0.005), num('outHi', 'Output white', 1, 0, 1, 0.005)],
    desc: 'Input/output level remap with clipping.',
    run: (ctx, p) => {
      const r = Math.max(1e-4, p.inHi - p.inLo);
      return { height: Float32Array.from(ctx.H, (h) => lerp(p.outLo, p.outHi, clamp((h - p.inLo) / r))) };
    },
  }),
  makeDef({
    id: 109, key: 'curves', name: 'Curves', cat: 'Filters', params: [num('mid', 'Midtone output', 0.5, 0, 1, 0.01), num('shadows', 'Shadow lift', 0, -0.3, 0.3, 0.01)],
    desc: 'Tone curve through black, a midtone control point and white.',
    run: (ctx, p) => ({ height: Float32Array.from(ctx.H, (h) => {
      const t = clamp(h);
      const y = t + (p.mid - 0.5) * 4 * t * (1 - t) + p.shadows * (1 - t) * (1 - t);
      return clamp(y);
    }) }),
  }),
  makeDef({
    id: 110, key: 'histogram', name: 'Histogram', cat: 'Filters', kind: 'util', params: [int('bins', 'Bins', 64, 8, 256)],
    desc: 'Histogram display: computes the height distribution (shown in the inspector) and passes the stack through.',
    run: (ctx, p) => {
      const bins = new Array(p.bins).fill(0);
      for (let i = 0; i < ctx.H.length; i++) bins[Math.min(p.bins - 1, Math.floor(ctx.H[i] * p.bins))]++;
      return { stats: { histogram: bins } };
    },
  }),
  makeDef({
    id: 111, key: 'equalize', name: 'Equalize', cat: 'Filters', params: [num('amount', 'Amount', 1, 0, 1, 0.01)],
    desc: 'Histogram equalisation: spreads heights evenly over the full range.',
    run: (ctx, p) => {
      const e = equalise(ctx.H);
      return { height: Float32Array.from(ctx.H, (h, i) => lerp(h, e[i], p.amount)) };
    },
  }),
  makeDef({
    id: 112, key: 'normalize', name: 'Normalize', cat: 'Filters', params: [],
    desc: 'Remaps the heights to the full 0-1 range.',
    run: (ctx) => ({ height: normalizeGrid(ctx.H) }),
  }),
  makeDef({
    id: 113, key: 'invert', name: 'Invert', cat: 'Filters', params: [],
    desc: 'Inverts heights (peaks become basins).',
    run: (ctx) => ({ height: Float32Array.from(ctx.H, (h) => 1 - h) }),
  }),
  makeDef({
    id: 114, key: 'abs', name: 'Abs', cat: 'Filters', params: [num('pivot', 'Fold pivot', 0.5, 0, 1, 0.01)],
    desc: 'Absolute value about a pivot: folds the terrain so valleys become ridges.',
    run: (ctx, p) => ({ height: Float32Array.from(ctx.H, (h) => clamp(Math.abs(h - p.pivot) * 2)) }),
  }),
  makeDef({
    id: 115, key: 'clamp', name: 'Clamp', cat: 'Filters', params: [num('lo', 'Min', 0, 0, 1, 0.005), num('hi', 'Max', 1, 0, 1, 0.005)],
    desc: 'Clamps heights to a range.',
    run: (ctx, p) => ({ height: Float32Array.from(ctx.H, (h) => clamp(h, p.lo, Math.max(p.lo, p.hi))) }),
  }),
  makeDef({
    id: 116, key: 'remap', name: 'Remap', cat: 'Filters', params: [num('inLo', 'Input min', 0, 0, 1, 0.005), num('inHi', 'Input max', 1, 0, 1, 0.005), num('outLo', 'Output min', 0, 0, 1, 0.005), num('outHi', 'Output max', 1, 0, 1, 0.005)],
    desc: 'Linear remap of the value range (no clipping).',
    run: (ctx, p) => {
      const r = p.inHi - p.inLo || 1e-4;
      return { height: Float32Array.from(ctx.H, (h) => clamp(p.outLo + ((h - p.inLo) / r) * (p.outHi - p.outLo))) };
    },
  }),
  makeDef({
    id: 117, key: 'terrace', name: 'Terrace', cat: 'Filters', params: [int('steps', 'Terraces', 8, 2, 64), num('soft', 'Riser softness', 0.2, 0, 1, 0.01)],
    desc: 'Terracing: stepped plateaus with adjustable riser softness.',
    run: (ctx, p) => ({ height: Float32Array.from(ctx.H, (h) => {
      const t = h * p.steps, f = t - Math.floor(t);
      return clamp((Math.floor(t) + smoothstep(0.5 - p.soft * 0.5, 0.5 + p.soft * 0.5, f)) / p.steps);
    }) }),
  }),
  makeDef({
    id: 118, key: 'quantize', name: 'Quantize', cat: 'Filters', params: [int('levels', 'Levels', 12, 2, 256)],
    desc: 'Quantises heights to N discrete levels.',
    run: (ctx, p) => ({ height: Float32Array.from(ctx.H, (h) => Math.round(clamp(h) * (p.levels - 1)) / (p.levels - 1)) }),
  }),
  makeDef({
    id: 119, key: 'posterize', name: 'Posterize', cat: 'Filters', params: [int('levels', 'Levels', 6, 2, 64), num('dither', 'Dither', 0.3, 0, 1, 0.01)],
    desc: 'Posterise with a per-cell dither that breaks up banding.',
    run: (ctx, p) => ({ height: Float32Array.from(ctx.H, (h, i) => {
      const d = (hash2(i % ctx.N, (i / ctx.N) | 0, 5) - 0.5) * p.dither;
      return clamp(Math.round(clamp(h + d / p.levels) * (p.levels - 1)) / (p.levels - 1));
    }) }),
  }),
  makeDef({
    id: 120, key: 'steepen', name: 'Steepen', cat: 'Filters', params: [num('amount', 'Amount', 0.6, 0, 3, 0.01)],
    desc: 'Exaggerates relief where the ground is already steep.',
    run: (ctx, p) => {
      const s = ctx.get('slopeN', derive.slopeN);
      const mean = minMax(ctx.H).min + (minMax(ctx.H).max - minMax(ctx.H).min) * 0.5;
      return { height: Float32Array.from(ctx.H, (h, i) => clamp(mean + (h - mean) * (1 + p.amount * s[i]))) };
    },
  }),
  makeDef({
    id: 121, key: 'flatten', name: 'Flatten', cat: 'Filters', params: [num('value', 'Target height', 0.3, 0, 1, 0.005), num('amount', 'Amount', 0.6, 0, 1, 0.01)],
    desc: 'Pulls the heights toward a level.',
    run: (ctx, p) => ({ height: Float32Array.from(ctx.H, (h) => lerp(h, p.value, p.amount)) }),
  }),
  makeDef({
    id: 122, key: 'planar', name: 'Planar', cat: 'Filters', params: [num('angle', 'Plane angle [deg]', 0, -180, 180, 1), num('tilt', 'Tilt', 0.3, -1, 1, 0.01), num('amount', 'Amount', 0.6, 0, 1, 0.01)],
    desc: 'Flattens toward a tilted plane.',
    run: (ctx, p) => {
      const N = ctx.N, a = (p.angle * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
      return { height: fieldOf(N, (x, y, i) => {
        const ux = x / (N - 1) - 0.5, uy = y / (N - 1) - 0.5;
        const plane = 0.5 + p.tilt * (ux * c + uy * s);
        return clamp(lerp(ctx.H[i], plane, p.amount));
      }) };
    },
  }),
  makeDef({
    id: 123, key: 'slope', name: 'Slope', cat: 'Filters', params: [],
    desc: 'Writes the slope angle (0 flat .. 90 vertical) as height.',
    run: (ctx) => ({ height: scaleToMax(slopeMap(ctx), 90) }),
  }),
  makeDef({
    id: 124, key: 'direction', name: 'Direction', cat: 'Filters', params: [],
    desc: 'Writes the slope aspect (downhill direction, 0..360 deg mapped to 0..1) as height.',
    run: (ctx) => {
      const g = ctx.get('grad', derive.grad);
      return { height: Float32Array.from(g.gx, (gx, i) => (Math.atan2(-g.gy[i], -gx) + Math.PI) / (2 * Math.PI)) };
    },
  }),
  makeDef({
    id: 125, key: 'convexity', name: 'Convexity', cat: 'Filters', params: [],
    desc: 'Writes convex curvature (ridges and spurs) as height.',
    run: (ctx) => ({ height: Float32Array.from(ctx.get('curvature', derive.curvature), (c) => clamp(c * 0.5 + 0.5)) }),
  }),
  makeDef({
    id: 126, key: 'concavity', name: 'Concavity', cat: 'Filters', params: [],
    desc: 'Writes concave curvature (hollows and valleys) as height.',
    run: (ctx) => ({ height: Float32Array.from(ctx.get('curvature', derive.curvature), (c) => clamp(-c * 0.5 + 0.5)) }),
  }),
  makeDef({
    id: 127, key: 'roughness', name: 'Roughness', cat: 'Filters', params: [],
    desc: 'Writes local surface roughness (standard deviation) as height.',
    run: (ctx) => ({ height: scaleToMax(ctx.get('roughness', derive.roughness)) }),
  }),
  makeDef({
    id: 128, key: 'smoothness', name: 'Smoothness', cat: 'Filters', params: [],
    desc: 'Writes the inverse of roughness (smooth surfaces are bright).',
    run: (ctx) => ({ height: Float32Array.from(scaleToMax(ctx.get('roughness', derive.roughness)), (r) => 1 - r) }),
  }),
];

