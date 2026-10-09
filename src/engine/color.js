// Color / texturing nodes (179-203). Each returns one of:
//   { type:'color', rgb: Float32Array(3N), w: Float32Array(N*N) }   blended into albedo
//   { type:'map',   name, data: Float32Array(N*N | 3N) }             written to st.maps
//   { type:'mod',   h }                                              modifies height (Displacement)
import { clamp01, smoothstep, boxBlur, minmax } from './grid.js';
import { fbm, perlin, hash2, voronoiDists } from './noise.js';

export const hex = (s) => { const n = parseInt(String(s).replace('#', ''), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };

// Palettes: stops of [position, hex]
export const PALETTES = {
  earth: [[0, '#1d3b5a'], [0.2, '#c8b77a'], [0.36, '#4f7a3a'], [0.62, '#7a6d55'], [0.82, '#8d8a85'], [1, '#f5f7fa']],
  desert: [[0, '#6b4f2a'], [0.35, '#d7b071'], [0.7, '#e8cd98'], [1, '#f7efe0']],
  arctic: [[0, '#2c4e6b'], [0.3, '#9fb9c9'], [0.6, '#dfe9f1'], [1, '#ffffff']],
  volcanic: [[0, '#120d0b'], [0.3, '#3a2a25'], [0.6, '#6e3b2e'], [0.85, '#b9a79b'], [1, '#e8e4df']],
  pastel: [[0, '#8fb8de'], [0.3, '#bde0b5'], [0.6, '#f4e7b5'], [0.85, '#e7b9b0'], [1, '#f5f5f5']],
};
const stopsRGB = (name) => (PALETTES[name] || PALETTES.earth).map(([t, c]) => [t, ...hex(c)]);
export function paletteAt(stops, t) {
  t = clamp01(t);
  for (let k = 1; k < stops.length; k++) {
    if (t <= stops[k][0]) {
      const a = stops[k - 1], b = stops[k], u = (t - a[0]) / (b[0] - a[0] || 1);
      return [a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u, a[3] + (b[3] - a[3]) * u];
    }
  }
  const l = stops[stops.length - 1]; return [l[1], l[2], l[3]];
}
const rgbField = (N, f) => { const o = new Float32Array(N * N * 3); for (let i = 0; i < N * N; i++) { const c = f(i); o[i * 3] = c[0]; o[i * 3 + 1] = c[1]; o[i * 3 + 2] = c[2]; } return o; };
const fill = (N, v) => new Float32Array(N * N).fill(v);
const P = (p, k, d) => (p[k] ?? d);
const ones = (N) => new Float32Array(N * N).fill(1);

export const COLOR = {
  179: (p, st, d) => { const s = stopsRGB(P(p, 'palette', 'earth')); return { type: 'color', rgb: rgbField(st.N, (i) => paletteAt(s, st.h[i])), w: ones(st.N) }; },
  180: (p, st, d) => { // satellite-like: palette + fine noise + slope darkening
    const s = stopsRGB(P(p, 'palette', 'earth')), sd = P(p, 'seed', 4), N = st.N;
    return { type: 'color', w: ones(N), rgb: rgbField(N, (i) => {
      const x = (i % N) / N * 8, y = ((i / N) | 0) / N * 8;
      const n = fbm(perlin, x, y, sd, 4) * 0.12;
      const c = paletteAt(s, st.h[i]);
      const dark = 1 - d.slope[i] * 0.35;
      return [clamp01((c[0] + n) * dark), clamp01((c[1] + n) * dark), clamp01((c[2] + n) * dark)];
    }) };
  },
  181: (p, st) => { // CLUT: palette quantised into N bands (lookup table style)
    const s = stopsRGB(P(p, 'palette', 'earth')), steps = Math.max(2, P(p, 'steps', 8));
    return { type: 'color', w: ones(st.N), rgb: rgbField(st.N, (i) => paletteAt(s, Math.floor(clamp01(st.h[i]) * steps) / (steps - 1 || 1))) };
  },
  182: (p, st, d) => ({ type: 'color', w: ones(st.N), rgb: rgbField(st.N, (i) => paletteAt([[0, ...hex(P(p, 'flat', '#6e8f3f'))], [1, ...hex(P(p, 'steep', '#5b4a3c'))]], d.slope[i])) }),
  183: (p, st) => ({ type: 'color', w: ones(st.N), rgb: rgbField(st.N, (i) => paletteAt([[0, ...hex(P(p, 'low', '#2b4c7e'))], [1, ...hex(P(p, 'high', '#f2efe8'))]], st.h[i])) }),
  184: (p, st, d) => ({ type: 'color', w: ones(st.N), rgb: rgbField(st.N, (i) => paletteAt([[0, ...hex(P(p, 'concave', '#2e3b2a'))], [0.5, ...hex('#8a8a7a')], [1, ...hex(P(p, 'convex', '#d6c9a2'))]], d.curv[i])) }),
  185: (p, st, d) => ({ type: 'color', w: ones(st.N), rgb: rgbField(st.N, (i) => paletteAt([[0, ...hex('#8b7b5b')], [0.6, ...hex('#4b6b5a')], [1, ...hex(P(p, 'wet', '#1d4f7a'))]], d.flow[i])) }),
  186: (p, st, d) => ({ type: 'color', rgb: fillRGB(st.N, hex(P(p, 'color', '#f7fbff'))), w: snowW(st, d, p) }),
  187: (p, st, d) => ({ type: 'color', rgb: fillRGB(st.N, hex(P(p, 'color', '#7b6e62'))), w: Float32Array.from(d.slope, (s) => smoothstep(0.35, 0.7, s)) }),
  188: (p, st, d) => ({ type: 'color', rgb: fillRGB(st.N, hex(P(p, 'color', '#4f7d32'))), w: Float32Array.from(st.h, (h, i) => (1 - smoothstep(0.2, 0.5, d.slope[i])) * (1 - smoothstep(0.4, 0.6, h))) }),
  189: (p, st, d) => ({ type: 'color', rgb: fillRGB(st.N, hex(P(p, 'color', '#d9b77c'))), w: Float32Array.from(st.h, (h, i) => (1 - smoothstep(0.15, 0.4, h)) * (1 - d.slope[i])) }),
  190: (p, st, d) => ({ type: 'color', rgb: fillRGB(st.N, hex(P(p, 'color', '#cfe8f5'))), w: Float32Array.from(st.h, (h, i) => smoothstep(P(p, 'line', 0.8), 0.95, h) * (0.5 + 0.5 * d.slope[i])) }),
  191: (p, st) => ({ type: 'color', rgb: fillRGB(st.N, hex(P(p, 'color', '#1f5f8b'))), w: st.water ? Float32Array.from(st.water, (v) => (Number.isNaN(v) ? 0 : 1)) : fill(st.N, 0) }),
  192: (p, st) => { // Gradient map: luminance of current albedo through a gradient ramp
    const s = stopsRGB(P(p, 'palette', 'volcanic')), alb = st.albedo;
    return { type: 'color', w: ones(st.N), rgb: rgbField(st.N, (i) => { const L = 0.2126 * alb[i * 3] + 0.7152 * alb[i * 3 + 1] + 0.0722 * alb[i * 3 + 2]; return paletteAt(s, L); }) };
  },
  193: (p, st, d) => { // triplanar-style: projection along x or y chosen by slope direction, blended
    const sc = P(p, 'scale', 12), sd = P(p, 'seed', 9), N = st.N;
    const base = hex(P(p, 'base', '#8a7c63')), alt = hex(P(p, 'alt', '#5c5143'));
    return { type: 'color', w: ones(N), rgb: rgbField(N, (i) => {
      const x = (i % N) / N * sc, y = ((i / N) | 0) / N * sc;
      const px = Math.sin(x * 6 + perlin(x, y, sd) * 2) * 0.5 + 0.5;
      const py = Math.sin(y * 6 + perlin(y, x, sd) * 2) * 0.5 + 0.5;
      const t = d.slope[i];
      const tex = px * (1 - t) + py * t; const u = clamp01(0.5 + (tex - 0.5) * 0.6);
      return [base[0] * u + alt[0] * (1 - u), base[1] * u + alt[1] * (1 - u), base[2] * u + alt[2] * (1 - u)];
    }) };
  },
  194: (p, st, d) => { // splat: 4 weighted materials driven by height/slope/noise
    const N = st.N, mats = [hex('#7c8f4a'), hex('#8a7f6a'), hex('#a7a5a0'), hex('#e6dccb')];
    return { type: 'color', w: ones(N), rgb: rgbField(N, (i) => {
      const x = (i % N) / N * 6, y = ((i / N) | 0) / N * 6;
      const wts = [ (1 - smoothstep(0.2, 0.5, st.h[i])) * (1 - d.slope[i]), (1 - d.slope[i]) * 0.5 + 0.2 * fbm(perlin, x, y, 3, 2), d.slope[i], smoothstep(0.7, 0.9, st.h[i]) ].map((v) => Math.max(0, v + 0.1 * hash2(i % N, (i / N) | 0, 5)));
      const sum = wts.reduce((a, b) => a + b, 0) || 1;
      let r = 0, g = 0, b = 0; for (let k = 0; k < 4; k++) { r += mats[k][0] * wts[k] / sum; g += mats[k][1] * wts[k] / sum; b += mats[k][2] * wts[k] / sum; }
      return [r, g, b];
    }) };
  },
  195: (p, st) => { // full material: preset albedo + roughness
    const mat = P(p, 'material', 'rock'), presets = { rock: '#7a7068', grass: '#58803a', sand: '#d8bf8a', snow: '#f4f8fb', metal: '#9aa0a6' };
    const rgb = fillRGB(st.N, hex(presets[mat] || presets.rock));
    const rough = fill(st.N, { rock: 0.9, grass: 0.8, sand: 0.95, snow: 0.5, metal: 0.25 }[mat] ?? 0.8);
    return { type: 'color', w: ones(st.N), rgb, extra: { roughness: rough } };
  },
  196: (p, st) => { const g = P(p, 'gain', 1); return { type: 'color', w: ones(st.N), rgb: Float32Array.from(st.albedo, (v) => clamp01(v * g)) }; },
  197: (p, st, d) => { // Normal map from gradient (tangent-space RGB)
    const N = st.N, out = new Float32Array(N * N * 3), s = P(p, 'strength', 1) * N * 0.25;
    for (let i = 0; i < N * N; i++) {
      const nx = -d.gx[i] * s, ny = -d.gy[i] * s, nz = 1; const l = Math.hypot(nx, ny, nz);
      out[i * 3] = 0.5 + 0.5 * nx / l; out[i * 3 + 1] = 0.5 + 0.5 * ny / l; out[i * 3 + 2] = 0.5 + 0.5 * nz / l;
    }
    return { type: 'map', name: 'normal', data: out };
  },
  198: (p, st, d) => ({ type: 'map', name: 'roughness', data: Float32Array.from(d.slope, (s, i) => clamp01(0.4 + 0.5 * (1 - s) + 0.1 * (d.curv[i] - 0.5))) }),
  199: (p, st, d) => { const r = Math.max(2, P(p, 'radius', 6)); const m = boxBlur(st.h, st.N, r); return { type: 'map', name: 'ao', data: Float32Array.from(st.h, (h, i) => clamp01(1 - (m[i] - h) * P(p, 'strength', 6))) }; },
  200: (p, st) => { const sd = P(p, 'seed', 12), amp = P(p, 'amount', 0.01), sc = P(p, 'scale', 24), N = st.N; return { type: 'mod', h: Float32Array.from(st.h, (h, i) => h + amp * (perlin(((i % N) / N) * sc, (((i / N) | 0) / N) * sc, sd))) }; },
  201: (p, st, d) => ({ type: 'map', name: 'flowMap', data: rgbField(st.N, (i) => [0.5 + 0.5 * Math.sign(-d.gx[i]) * Math.min(1, Math.abs(d.gx[i]) * 40), 0.5 + 0.5 * Math.sign(-d.gy[i]) * Math.min(1, Math.abs(d.gy[i]) * 40), d.flow[i]]) }),
  202: (p, st, d) => ({ type: 'map', name: 'moisture', data: Float32Array.from(st.h, (h, i) => clamp01(d.flow[i] * (1 - smoothstep(0.4, 0.9, h)) * (1 - d.slope[i] * 0.5) + 0.1)) }),
  203: (p, st, d) => ({ type: 'map', name: 'snow', data: snowW(st, d, p) }),
};

function fillRGB(N, c) { const o = new Float32Array(N * N * 3); for (let i = 0; i < N * N; i++) { o[i * 3] = c[0]; o[i * 3 + 1] = c[1]; o[i * 3 + 2] = c[2]; } return o; }
function snowW(st, d, p) { const line = P(p, 'line', 0.7); return Float32Array.from(st.h, (h, i) => clamp01(smoothstep(line - 0.05, line + 0.05, h) * (1 - smoothstep(0.4, 0.8, d.slope[i])))); }
export { minmax, voronoiDists };
