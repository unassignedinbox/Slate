// Utility (217-235) and vegetation/scatter (236-240) nodes.
import { clamp01, smoothstep, boxBlur, minmax, slopeOf, normalize } from './grid.js';
import { hash2 } from './noise.js';
import { hex } from './color.js';

const P = (p, k, d) => (p[k] ?? d);
const rgbToHsv = (r, g, b) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0; if (d) { if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h /= 6; if (h < 0) h += 1; } return [h, mx ? d / mx : 0, mx]; };
const hsvToRgb = (h, s, v) => { const i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s); switch (((i % 6) + 6) % 6) { case 0: return [v, t, p]; case 1: return [q, v, p]; case 2: return [p, v, t]; case 3: return [p, q, v]; case 4: return [t, p, v]; default: return [v, p, q]; } };
const chanOf = (name) => ({ R: 0, G: 1, B: 2 })[name] ?? 0;
const lum = (a, i) => 0.2126 * a[i * 3] + 0.7152 * a[i * 3 + 1] + 0.0722 * a[i * 3 + 2];
const mapRGB = (st, f) => { const a = st.albedo, o = new Float32Array(a.length); for (let i = 0; i < st.N * st.N; i++) { const c = f(a[i * 3], a[i * 3 + 1], a[i * 3 + 2], i); o[i * 3] = c[0]; o[i * 3 + 1] = c[1]; o[i * 3 + 2] = c[2]; } return o; };

export const UTILITY = {
  // 217 Cache: checkpoint — snapshot kept for compare/revert
  217: () => ({ type: 'pass' }),
  // 218 Output: marks a named output snapshot
  218: (h, st, p) => ({ type: 'pass', output: P(p, 'name', 'out') }),
  // 219 Input: replace the stack height with an imported heightmap (layer data)
  219: (h, st, p) => (st.importData ? { type: 'mod', h: st.importData } : { type: 'pass' }),
  // 220 File Import: same as Input, sourced from a file (raw16/png) loaded by the UI
  220: (h, st, p) => (st.importData ? { type: 'mod', h: st.importData } : { type: 'pass' }),
  // 221 Export: pass-through; export is triggered by the UI
  221: () => ({ type: 'pass' }),
  // 222 View: sets the preview channel for the viewport
  222: (h, st, p) => { st.view = { mode: P(p, 'mode', 'height') }; return { type: 'pass' }; },
  // 223 Compare: snapshot of the stack before this layer
  223: (h, st) => { st.compareWith = Float32Array.from(h); return { type: 'pass' }; },
  // 224 3D View: sets viewport exaggeration for the 3D preview
  224: (h, st, p) => { st.view3D = { exaggeration: P(p, 'exaggeration', 1) }; return { type: 'pass' }; },
  // 225 Stats: compute statistics for the stats panel
  225: (h, st) => { const [mn, mx] = minmax(h); let s = 0; for (const v of h) s += v; st.stats = { min: mn, max: mx, mean: s / h.length }; return { type: 'pass' }; },
  // 226 Switch: choose between the stack input and the layer's alternate input
  226: (h, st, p) => (P(p, 'select', 0) === 1 && st.importData ? { type: 'mod', h: st.importData } : { type: 'pass' }),
  // 227 Gate: values below the threshold are replaced by the fill value
  227: (h, st, p) => { const t = P(p, 'threshold', 0.2), f = P(p, 'fill', 0); return { type: 'mod', h: Float32Array.from(h, (v) => (v < t ? f : v)) }; },
  // 228 Merge: blend imported heightmap with the stack (50/50 by default)
  228: (h, st, p) => (st.importData ? { type: 'mod', h: Float32Array.from(h, (v, i) => v + (st.importData[i] - v) * P(p, 'amount', 0.5)) } : { type: 'pass' }),
  // 229 Split: write quantised band index to a map (height pass-through)
  229: (h, st, p) => { const n = Math.max(2, P(p, 'bands', 4)); return { type: 'map', name: 'split', data: Float32Array.from(h, (v) => Math.floor(clamp01(v) * n) / (n - 1)) }; },
  // 230 Channel Extract: pull one albedo channel into height
  230: (h, st, p) => { const c = chanOf(P(p, 'channel', 'R')); return { type: 'mod', h: Float32Array.from(st.albedo.filter((_, k) => k % 3 === c)) }; },
  // 231 Combine Channels: write height into one albedo channel
  231: (h, st, p) => { const c = chanOf(P(p, 'channel', 'R')); const alb = Float32Array.from(st.albedo); for (let i = 0; i < h.length; i++) alb[i * 3 + c] = clamp01(h[i]); return { type: 'rawalbedo', rgb: alb }; },
  // 232 Grayscale
  232: (h, st) => ({ type: 'color', w: new Float32Array(h.length).fill(1), rgb: mapRGB(st, (r, g, b) => { const L = 0.2126 * r + 0.7152 * g + 0.0722 * b; return [L, L, L]; }) }),
  // 233 RGB to HSV: encodes hue/sat/value as RGB for inspection
  233: (h, st) => ({ type: 'color', w: new Float32Array(h.length).fill(1), rgb: mapRGB(st, (r, g, b) => rgbToHsv(r, g, b)) }),
  // 234 HSV to RGB: interprets albedo as HSV and converts back
  234: (h, st) => ({ type: 'color', w: new Float32Array(h.length).fill(1), rgb: mapRGB(st, (hh, s, v) => hsvToRgb(hh, s, v)) }),
  // 235 Luminance: height from albedo luminance
  235: (h, st) => ({ type: 'mod', h: Float32Array.from(h.length ? new Float32Array(h.length).map((_, i) => lum(st.albedo, i)) : h) }),
};

// Vegetation / scatter (236-240): write density-style maps used by the viewport and export.
export const VEGETATION = {
  236: (h, st, p, d) => { // Scatter: poisson-like thinning of random points on allowed terrain
    const N = st.N, sd = P(p, 'seed', 21), density = P(p, 'density', 0.02);
    const out = new Float32Array(N * N);
    for (let i = 0; i < N * N; i++) {
      const ok = (1 - smoothstep(0.35, 0.6, d.slope[i])) * (1 - smoothstep(0.5, 0.8, st.h[i]));
      if (hash2(i % N, (i / N) | 0, sd) < density * ok * 40) out[i] = 1;
    }
    return { type: 'map', name: 'scatter', data: out };
  },
  237: (h, st, p, d) => { // Density: smoothed scatter distribution
    const sc = st.maps.scatter || new Float32Array(st.N * st.N);
    const r = Math.max(1, P(p, 'radius', 3));
    const dens = boxBlur(sc, st.N, r);
    return { type: 'map', name: 'density', data: normalize(dens) };
  },
  238: (h, st, p, d) => { // Biome: classify altitude x slope x moisture into 6 biome ids (normalised)
    const N = st.N, mo = st.maps.moisture;
    const data = new Float32Array(N * N);
    for (let i = 0; i < N * N; i++) {
      const hgt = st.h[i], s = d.slope[i], m = mo ? mo[i] : d.flow[i];
      let id = 0;
      if (hgt < (st.seaLevel ?? 0.15)) id = 0;
      else if (s > 0.6) id = 1;
      else if (hgt > 0.7) id = 2;
      else if (m > 0.55) id = 3;
      else if (m < 0.2) id = 4;
      else id = 5;
      data[i] = id / 5;
    }
    return { type: 'map', name: 'biome', data };
  },
  239: (h, st, p) => { const line = P(p, 'altitude', 0.6), w = P(p, 'softness', 0.05); return { type: 'map', name: 'treeLine', data: Float32Array.from(st.h, (v) => smoothstep(line - w, line + w, v)) }; },
  240: (h, st, p) => { const line = P(p, 'altitude', 0.35), w = P(p, 'softness', 0.05); return { type: 'map', name: 'grassLine', data: Float32Array.from(st.h, (v) => 1 - smoothstep(line - w, line + w, v)) }; },
};
