// Slate — color / texturing #179–203. Same stack; these write surface data.
import { clamp, lerp, smoothstep, hexToRgb, hillshade, normalAt, flowAccum, ambientOcc } from './util.js';
import { valueNoise, fbm } from './noise.js';

const P = (k, label, min, max, step, def, unit = '', hint = '') =>
  ({ k, label, min, max, step, def, unit, hint, type: 'slider' });
const C = (k, label, def, hint = '') => ({ k, label, type: 'color', def, hint });
const L = (n, id, name, desc, params, run, extra = {}) =>
  ({ n, id, name, cat: 'color', desc, targets: ['alb'], params, run, ...extra });

function setAlb(S, i, r, g, b) { S.alb[i * 3] = r; S.alb[i * 3 + 1] = g; S.alb[i * 3 + 2] = b; }
function mix3(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }
// Multi-stop gradient: stops = [[t, [r,g,b]], ...].
function gradient(stops, t) {
  t = clamp(t);
  for (let s = 0; s < stops.length - 1; s++) {
    const [t0, c0] = stops[s], [t1, c1] = stops[s + 1];
    if (t <= t1 || s === stops.length - 2) {
      const f = smoothstep(t0, Math.max(t0 + 1e-4, t1), t);
      return mix3(c0, c1, f);
    }
  }
  return stops[stops.length - 1][1];
}
const CLUTS = [
  [[0, [0.05, 0.1, 0.2]], [0.35, [0.1, 0.35, 0.5]], [0.55, [0.5, 0.7, 0.4]], [0.8, [0.55, 0.45, 0.3]], [1, [0.95, 0.95, 0.95]]],
  [[0, [0, 0, 0]], [0.25, [0.2, 0.05, 0.4]], [0.5, [0.8, 0.2, 0.3]], [0.75, [1, 0.7, 0.2]], [1, [1, 1, 0.9]]],
  [[0, [0.02, 0.05, 0.02]], [0.4, [0.1, 0.3, 0.1]], [0.65, [0.45, 0.5, 0.25]], [0.85, [0.6, 0.55, 0.45]], [1, [0.9, 0.9, 0.9]]],
  [[0, [0.1, 0.02, 0.05]], [0.4, [0.45, 0.15, 0.1]], [0.7, [0.8, 0.5, 0.25]], [0.9, [0.95, 0.85, 0.6]], [1, [1, 1, 1]]],
  [[0, [0.9, 0.9, 0.9]], [0.3, [0.6, 0.7, 0.8]], [0.6, [0.3, 0.4, 0.55]], [0.85, [0.1, 0.15, 0.3]], [1, [0, 0, 0]]],
  [[0, [0, 0.2, 0.1]], [0.3, [0, 0.5, 0.5]], [0.55, [0.3, 0.8, 0.3]], [0.8, [0.9, 0.9, 0.2]], [1, [0.7, 0.1, 0.1]]],
];

export const LAYERS_COLOR = [
  L(179, 'colorize', 'Colorize', 'Altitude-based color ramp.', [
    C('cLow', 'Low color', '#1d4e89'), C('cMid', 'Mid color', '#3f7a3a'), C('cHigh', 'High color', '#e8e8e8'),
    P('mid', 'Mid position', 0.05, 0.95, 0.01, 0.5), P('contrast', 'Contrast', 0.2, 3, 0.05, 1),
  ], (ctx, p, S) => {
    const h = ctx.field('height01');
    const lo = hexToRgb(p.cLow), mi = hexToRgb(p.cMid), hi = hexToRgb(p.cHigh);
    for (let i = 0; i < h.length; i++) {
      const t = clamp(Math.pow(h[i], p.contrast));
      const c = t < p.mid ? mix3(lo, mi, smoothstep(0, p.mid, t)) : mix3(mi, hi, smoothstep(p.mid, 1, t));
      setAlb(S, i, c[0], c[1], c[2]);
    }
  }),
  L(180, 'satmap', 'SatMap', 'Satellite-style map coloring with relief shading.', [
    P('azimuth', 'Sun azimuth', 0, 360, 1, 315, '°'), P('altitude', 'Sun altitude', 1, 89, 1, 45, '°'),
    P('shade', 'Shade strength', 0, 1, 0.05, 0.55), P('sat', 'Saturation', 0, 2, 0.05, 1),
    P('snowLine', 'Snow line', 0, 1, 0.01, 0.72),
  ], (ctx, p, S) => {
    const n = ctx.n, h = ctx.field('height01'), s = ctx.field('slope');
    const hs = hillshade(ctx.h, n, p.azimuth, p.altitude);
    const veg = [0.16, 0.36, 0.12], rock = [0.42, 0.36, 0.3], sand = [0.76, 0.68, 0.47], snow = [0.93, 0.94, 0.96];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const a = Math.atan(s[i]) * 180 / Math.PI;
      const nz = valueNoise(x * 0.08, y * 0.08, 4);
      let c = mix3(veg, sand, smoothstep(0.35, 0.6, h[i]) * 0.7 + nz * 0.15);
      c = mix3(c, rock, smoothstep(22, 45, a));
      c = mix3(c, snow, smoothstep(p.snowLine - 0.06, p.snowLine + 0.06, h[i]) * (1 - smoothstep(50, 65, a)));
      const l = 1 - p.shade * 0.5 + (hs[i] - 0.5) * p.shade;
      const g = (c[0] + c[1] + c[2]) / 3;
      setAlb(S, i, clamp((g + (c[0] - g) * p.sat) * l), clamp((g + (c[1] - g) * p.sat) * l), clamp((g + (c[2] - g) * p.sat) * l));
    }
  }),
  L(181, 'clut', 'CLUTer', 'Color lookup table by elevation.', [
    P('table', 'Table', 0, 5, 1, 0, 'enum', 'Terrain|Magma|Forest|Mars|Mono|Aqua'),
    P('contrast', 'Contrast', 0.2, 3, 0.05, 1),
  ], (ctx, p, S) => {
    const h = ctx.field('height01'), stops = CLUTS[p.table | 0] || CLUTS[0];
    for (let i = 0; i < h.length; i++) {
      const c = gradient(stops, Math.pow(h[i], p.contrast));
      setAlb(S, i, c[0], c[1], c[2]);
    }
  }),
  L(182, 'color-slope', 'Color Slope', 'Color ramp by slope angle.', [
    C('cFlat', 'Flat color', '#4a7c3a'), C('cSteep', 'Steep color', '#6b6259'),
    P('lo', 'Flat angle', 0, 60, 1, 8, '°'), P('hi', 'Steep angle', 0, 90, 1, 45, '°'),
  ], (ctx, p, S) => {
    const s = ctx.field('slope'), a = hexToRgb(p.cFlat), b = hexToRgb(p.cSteep);
    for (let i = 0; i < s.length; i++) {
      const t = smoothstep(p.lo, Math.max(p.lo + 1, p.hi), Math.atan(s[i]) * 180 / Math.PI);
      const c = mix3(a, b, t);
      setAlb(S, i, c[0], c[1], c[2]);
    }
  }),
  L(183, 'color-height', 'Color Height', 'Two-color ramp by height.', [
    C('cLo', 'Low color', '#274b73'), C('cHi', 'High color', '#cfd6da'),
    P('lo', 'Low', 0, 1, 0.01, 0.2), P('hi', 'High', 0, 1, 0.01, 0.8),
  ], (ctx, p, S) => {
    const h = ctx.field('height01'), a = hexToRgb(p.cLo), b = hexToRgb(p.cHi);
    for (let i = 0; i < h.length; i++) {
      const c = mix3(a, b, smoothstep(p.lo, Math.max(p.lo + 1e-3, p.hi), h[i]));
      setAlb(S, i, c[0], c[1], c[2]);
    }
  }),
  L(184, 'color-curv', 'Color Curvature', 'Tint convex ridges vs concave crevices.', [
    C('cConvex', 'Convex color', '#b09a7a'), C('cConcave', 'Concave color', '#3a4a5a'),
    P('scale', 'Scale', 1, 30, 1, 8),
  ], (ctx, p, S) => {
    const c = ctx.field('curvN'), a = hexToRgb(p.cConvex), b = hexToRgb(p.cConcave);
    for (let i = 0; i < c.length; i++) {
      const t = clamp(c[i] * p.scale * 0.15 + 0.5);
      const col = mix3(b, a, t);
      setAlb(S, i, col[0], col[1], col[2]);
    }
  }),
  L(185, 'color-flow', 'Color Flow', 'Tint water-flow channels.', [
    C('cDry', 'Dry color', '#8a7a5a'), C('cWet', 'Wet color', '#2a6a9a'),
    P('threshold', 'Threshold', 0, 1, 0.01, 0.3), P('soft', 'Softness', 0, 0.4, 0.01, 0.1),
  ], (ctx, p, S) => {
    const f = ctx.field('flow'), a = hexToRgb(p.cDry), b = hexToRgb(p.cWet);
    for (let i = 0; i < f.length; i++) {
      const c = mix3(a, b, smoothstep(p.threshold - p.soft, p.threshold + p.soft, f[i]));
      setAlb(S, i, c[0], c[1], c[2]);
    }
  }),
  L(186, 'color-snow', 'Color Snow', 'Snow color on high, flat ground.', [
    C('color', 'Snow color', '#eef2f6'), P('line', 'Snow line', 0, 1, 0.01, 0.6),
    P('slopeMax', 'Max slope°', 0, 90, 1, 42, '°'), P('soft', 'Softness', 0, 0.3, 0.01, 0.07),
    P('sparkle', 'Sparkle', 0, 1, 0.05, 0.25),
  ], (ctx, p, S) => {
    const n = ctx.n, h = ctx.field('height01'), s = ctx.field('slope'), c = hexToRgb(p.color);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const a = Math.atan(s[i]) * 180 / Math.PI;
      const m = smoothstep(p.line - p.soft, p.line + p.soft, h[i]) * (1 - smoothstep(p.slopeMax - 8, p.slopeMax + 8, a));
      const sp = 1 + (valueNoise(x * 0.9, y * 0.9, 11) - 0.5) * p.sparkle;
      // blend toward snow by mask, keep base elsewhere
      setAlb(S, i,
        lerp(S.alb[i * 3], clamp(c[0] * sp), m),
        lerp(S.alb[i * 3 + 1], clamp(c[1] * sp), m),
        lerp(S.alb[i * 3 + 2], clamp(c[2] * sp), m));
    }
  }),
  L(187, 'color-rock', 'Color Rock', 'Rock color on cliffs with strata banding.', [
    C('cA', 'Rock A', '#6e655c'), C('cB', 'Rock B', '#4a4239'),
    P('slopeMin', 'Min slope°', 0, 80, 1, 30, '°'), P('bands', 'Strata bands', 0, 30, 1, 10), P('bandAmt', 'Band amount', 0, 1, 0.05, 0.4),
  ], (ctx, p, S) => {
    const h = ctx.field('height01'), s = ctx.field('slope');
    const a = hexToRgb(p.cA), b = hexToRgb(p.cB);
    for (let i = 0; i < h.length; i++) {
      const m = smoothstep(p.slopeMin - 10, p.slopeMin + 10, Math.atan(s[i]) * 180 / Math.PI);
      const band = p.bands > 0 ? 0.5 + 0.5 * Math.sin(h[i] * p.bands * Math.PI * 2) : 0.5;
      const c = mix3(a, b, clamp(band * p.bandAmt + h[i] * 0.3, 0, 1));
      setAlb(S, i, lerp(S.alb[i * 3], c[0], m), lerp(S.alb[i * 3 + 1], c[1], m), lerp(S.alb[i * 3 + 2], c[2], m));
    }
  }),
  L(188, 'color-veg', 'Color Vegetation', 'Vegetation in low, flat, moist areas.', [
    C('cA', 'Leaf A', '#2f6b24'), C('cB', 'Leaf B', '#6a8f3c'),
    P('hMax', 'Max height', 0, 1, 0.01, 0.6), P('slopeMax', 'Max slope°', 0, 60, 1, 28, '°'),
    P('moistMin', 'Min moisture', 0, 1, 0.01, 0.25), P('patch', 'Patchiness', 1, 24, 1, 8),
  ], (ctx, p, S) => {
    const n = ctx.n, h = ctx.field('height01'), s = ctx.field('slope');
    const a = hexToRgb(p.cA), b = hexToRgb(p.cB);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const m = (1 - smoothstep(p.hMax - 0.1, p.hMax + 0.05, h[i])) *
        (1 - smoothstep(p.slopeMax - 8, p.slopeMax + 8, Math.atan(s[i]) * 180 / Math.PI)) *
        smoothstep(p.moistMin - 0.1, p.moistMin + 0.15, ctx.moist[i]);
      const patch = fbm(valueNoise, x / n * p.patch, y / n * p.patch, { octaves: 3, seed: 21 });
      const c = mix3(a, b, patch);
      setAlb(S, i, lerp(S.alb[i * 3], c[0], m), lerp(S.alb[i * 3 + 1], c[1], m), lerp(S.alb[i * 3 + 2], c[2], m));
    }
  }),
  L(189, 'color-desert', 'Color Desert', 'Sand seas with dune shading.', [
    C('cA', 'Sand shadow', '#b08d55'), C('cB', 'Sand light', '#e3c88f'),
    P('azimuth', 'Sun azimuth', 0, 360, 1, 315, '°'), P('altitude', 'Sun altitude', 1, 89, 1, 50, '°'),
    P('hMax', 'Max height', 0, 1, 0.01, 0.55),
  ], (ctx, p, S) => {
    const h = ctx.field('height01'), hs = hillshade(ctx.h, ctx.n, p.azimuth, p.altitude);
    const a = hexToRgb(p.cA), b = hexToRgb(p.cB);
    for (let i = 0; i < h.length; i++) {
      const m = 1 - smoothstep(p.hMax - 0.08, p.hMax + 0.08, h[i]);
      const c = mix3(a, b, hs[i]);
      setAlb(S, i, lerp(S.alb[i * 3], c[0], m), lerp(S.alb[i * 3 + 1], c[1], m), lerp(S.alb[i * 3 + 2], c[2], m));
    }
  }),
  L(190, 'color-ice', 'Color Ice', 'Glacial ice on peaks and flats.', [
    C('cA', 'Ice deep', '#3d7fa6'), C('cB', 'Ice bright', '#cfe8f2'),
    P('line', 'Ice line', 0, 1, 0.01, 0.75), P('crevasse', 'Crevasses', 0, 1, 0.05, 0.5),
  ], (ctx, p, S) => {
    const n = ctx.n, h = ctx.field('height01'), cv = ctx.field('convex');
    const a = hexToRgb(p.cA), b = hexToRgb(p.cB);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const m = smoothstep(p.line - 0.06, p.line + 0.06, h[i]);
      const crev = clamp(cv[i] * 2 - 0.4, 0, 1) * p.crevasse;
      const c = mix3(b, a, clamp(crev + (1 - m) * 0 + valueNoise(x * 0.2, y * 0.2, 8) * 0.2, 0, 1));
      setAlb(S, i, lerp(S.alb[i * 3], c[0], m), lerp(S.alb[i * 3 + 1], c[1], m), lerp(S.alb[i * 3 + 2], c[2], m));
    }
  }),
  L(191, 'color-water', 'Color Water', 'Water surface color by depth.', [
    C('cShallow', 'Shallow', '#4fa3b8'), C('cDeep', 'Deep', '#0b3550'), P('shore', 'Shore foam', 0, 1, 0.05, 0.4),
  ], (ctx, p, S) => {
    const n = ctx.n, lvl = ctx.waterLevel;
    const a = hexToRgb(p.cShallow), b = hexToRgb(p.cDeep);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const d = lvl - ctx.h[i];
      if (d <= 0) continue;
      const t = clamp(d * 7);
      const foam = Math.exp(-d * 40) * p.shore * (0.5 + valueNoise(x * 0.5, y * 0.5, 3));
      const c = mix3(a, b, t);
      setAlb(S, i, clamp(c[0] + foam * 0.7), clamp(c[1] + foam * 0.7), clamp(c[2] + foam * 0.65));
    }
  }),
  L(192, 'gradient-map', 'Gradient Map', 'Remap height through a 4-stop gradient.', [
    C('c0', 'Stop 0', '#101820'), C('c1', 'Stop 1', '#2e6f8e'), C('c2', 'Stop 2', '#d9c27a'), C('c3', 'Stop 3', '#f5f2ea'),
    P('t1', 'Stop 1 pos', 0.05, 0.9, 0.01, 0.35), P('t2', 'Stop 2 pos', 0.1, 0.95, 0.01, 0.65),
  ], (ctx, p, S) => {
    const h = ctx.field('height01');
    const stops = [[0, hexToRgb(p.c0)], [p.t1, hexToRgb(p.c1)], [p.t2, hexToRgb(p.c2)], [1, hexToRgb(p.c3)]];
    for (let i = 0; i < h.length; i++) {
      const c = gradient(stops, h[i]);
      setAlb(S, i, c[0], c[1], c[2]);
    }
  }),
  L(193, 'triplanar', 'Triplanar', 'Triplanar-projected detail grain (3-axis noise).', [
    P('freq', 'Frequency', 2, 96, 1, 24), P('amount', 'Amount', 0, 1, 0.02, 0.35),
    P('contrast', 'Contrast', 0.2, 3, 0.05, 1.2),
  ], (ctx, p, S) => {
    const n = ctx.n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const [nx, ny, nz] = normalAt(ctx.h, n, x, y, 2.5);
      const u = x / (n - 1), v = y / (n - 1), w = ctx.h[i];
      const px = valueNoise(v * p.freq + w * p.freq * 0.5, u * 3 + w * p.freq, 31);
      const py = valueNoise(u * p.freq + w * p.freq * 0.5, v * 3 + w * p.freq, 47);
      const pz = valueNoise(u * p.freq, v * p.freq, 63);
      const wx = Math.abs(nx), wy = Math.abs(ny), wz = Math.abs(nz);
      const sum = wx + wy + wz || 1;
      let g = (px * wx + py * wy + pz * wz) / sum;
      g = Math.pow(clamp(g), p.contrast);
      const m = 1 - p.amount * 0.5 + (g - 0.5) * p.amount;
      S.alb[i * 3] = clamp(S.alb[i * 3] * m * 1.2);
      S.alb[i * 3 + 1] = clamp(S.alb[i * 3 + 1] * m * 1.2);
      S.alb[i * 3 + 2] = clamp(S.alb[i * 3 + 2] * m * 1.2);
    }
  }),
  L(194, 'splat', 'Splat', 'Multi-texture splat: rock/scree/grass/snow/sand weights.', [
    C('rock', 'Rock', '#6b6259'), C('scree', 'Scree', '#8a7f6a'), C('grass', 'Grass', '#4c7a35'),
    C('snow', 'Snow', '#eef2f6'), C('sand', 'Sand', '#d9bd7f'),
    P('snowLine', 'Snow line', 0, 1, 0.01, 0.68), P('sandLine', 'Sand line', 0, 1, 0.01, 0.32),
    P('breakup', 'Breakup', 1, 32, 1, 10),
  ], (ctx, p, S) => {
    const n = ctx.n, h = ctx.field('height01'), s = ctx.field('slope');
    const rock = hexToRgb(p.rock), scree = hexToRgb(p.scree), grass = hexToRgb(p.grass);
    const snow = hexToRgb(p.snow), sand = hexToRgb(p.sand);
    const weights = new Float32Array(n * n * 5);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const a = Math.atan(s[i]) * 180 / Math.PI;
      const br = (fbm(valueNoise, x / n * p.breakup, y / n * p.breakup, { octaves: 3, seed: 71 }) - 0.5) * 0.35;
      let wSnow = smoothstep(p.snowLine - 0.07, p.snowLine + 0.07, h[i] + br) * (1 - smoothstep(48, 62, a));
      let wRock = smoothstep(30, 52, a + br * 60);
      let wSand = (1 - smoothstep(p.sandLine - 0.05, p.sandLine + 0.1, h[i] + br)) * (1 - smoothstep(25, 40, a));
      let wScree = smoothstep(18, 30, a) * (1 - wRock) * (0.5 + br);
      let wGrass = Math.max(0, 1 - wSnow - wRock - wSand - wScree);
      const sum = wSnow + wRock + wSand + wScree + wGrass || 1;
      wSnow /= sum; wRock /= sum; wSand /= sum; wScree /= sum; wGrass /= sum;
      weights[i * 5] = wRock; weights[i * 5 + 1] = wScree; weights[i * 5 + 2] = wGrass;
      weights[i * 5 + 3] = wSnow; weights[i * 5 + 4] = wSand;
      setAlb(S, i,
        rock[0] * wRock + scree[0] * wScree + grass[0] * wGrass + snow[0] * wSnow + sand[0] * wSand,
        rock[1] * wRock + scree[1] * wScree + grass[1] * wGrass + snow[1] * wSnow + sand[1] * wSand,
        rock[2] * wRock + scree[2] * wScree + grass[2] * wGrass + snow[2] * wSnow + sand[2] * wSand);
    }
    ctx.maps.splat = weights;
  }),
  L(195, 'material', 'Material', 'Full material: albedo + roughness by criteria.', [
    C('color', 'Color', '#7a6f5f'), P('rough', 'Roughness', 0, 1, 0.01, 0.85),
    P('hLo', 'Height min', 0, 1, 0.01, 0), P('hHi', 'Height max', 0, 1, 0.01, 1),
    P('sLo', 'Slope min°', 0, 90, 1, 0, '°'), P('sHi', 'Slope max°', 0, 90, 1, 90, '°'),
  ], (ctx, p, S) => {
    const h = ctx.field('height01'), s = ctx.field('slope'), c = hexToRgb(p.color);
    for (let i = 0; i < h.length; i++) {
      const a = Math.atan(s[i]) * 180 / Math.PI;
      const m = smoothstep(p.hLo - 0.03, p.hLo + 0.03, h[i]) * (1 - smoothstep(p.hHi - 0.03, p.hHi + 0.03, h[i])) *
        smoothstep(p.sLo - 3, p.sLo + 3, a) * (1 - smoothstep(p.sHi - 3, p.sHi + 3, a));
      setAlb(S, i, lerp(S.alb[i * 3], c[0], m), lerp(S.alb[i * 3 + 1], c[1], m), lerp(S.alb[i * 3 + 2], c[2], m));
      S.rough[i] = lerp(S.rough[i], p.rough, m);
    }
  }, { targets: ['alb', 'rough'] }),
  L(196, 'albedo', 'Albedo', 'Flat albedo / diffuse fill.', [
    C('color', 'Color', '#808080'), P('noise', 'Grain', 0, 0.3, 0.005, 0),
  ], (ctx, p, S) => {
    const n = ctx.n, c = hexToRgb(p.color);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const g = p.noise > 0 ? (valueNoise(x * 0.7, y * 0.7, 5) - 0.5) * p.noise : 0;
      setAlb(S, i, clamp(c[0] + g), clamp(c[1] + g), clamp(c[2] + g));
    }
  }),
  L(197, 'normal-map', 'Normal Map', 'Tangent-space normal map from height.', [
    P('strength', 'Strength', 0.1, 8, 0.1, 2), P('flipY', 'Flip Y', 0, 1, 1, 0),
  ], (ctx, p, S) => {
    const n = ctx.n;
    const nm = new Float32Array(n * n * 3);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const [nx, ny, nz] = normalAt(ctx.h, n, x, y, p.strength);
      const i = y * n + x, fy = p.flipY ? -ny : ny;
      nm[i * 3] = nx * 0.5 + 0.5; nm[i * 3 + 1] = fy * 0.5 + 0.5; nm[i * 3 + 2] = nz * 0.5 + 0.5;
      setAlb(S, i, nm[i * 3], nm[i * 3 + 1], nm[i * 3 + 2]);
    }
    ctx.maps.normal = nm;
  }),
  L(198, 'roughness-map', 'Roughness Map', 'Roughness from slope + cavity + noise.', [
    P('base', 'Base', 0, 1, 0.01, 0.7), P('slopeAmt', 'Slope amount', 0, 1, 0.02, 0.3),
    P('cavAmt', 'Cavity amount', 0, 1, 0.02, 0.2), P('var', 'Variation', 0, 1, 0.02, 0.2),
    P('preview', 'Show in color', 0, 1, 1, 1),
  ], (ctx, p, S) => {
    const n = ctx.n, s = ctx.field('slope'), cv = ctx.field('cavity');
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const r = clamp(p.base + smoothstep(10, 60, Math.atan(s[i]) * 180 / Math.PI) * p.slopeAmt +
        cv[i] * p.cavAmt + (valueNoise(x * 0.15, y * 0.15, 17) - 0.5) * p.var * 2);
      S.rough[i] = r;
      if (p.preview) setAlb(S, i, r, r, r);
    }
    ctx.maps.roughness = Float32Array.from(S.rough);
  }, { targets: ['rough', 'alb'] }),
  L(199, 'ao-map', 'Ambient Occlusion Map', 'Bake ambient occlusion.', [
    P('radius', 'Radius', 1, 12, 1, 5, 'px'), P('strength', 'Strength', 0, 2, 0.05, 1),
    P('preview', 'Show in color', 0, 1, 1, 1),
  ], (ctx, p, S) => {
    const ao = ambientOcc(ctx.h, ctx.n, p.radius, p.strength);
    S.ao.set(ao);
    if (p.preview) for (let i = 0; i < ao.length; i++) setAlb(S, i, ao[i], ao[i], ao[i]);
    ctx.maps.ao = Float32Array.from(ao);
  }, { targets: ['ao', 'alb'] }),
  L(200, 'displacement-map', 'Displacement Map', 'Micro-displacement detail + map output.', [
    P('amount', 'Amount', 0, 0.1, 0.002, 0.02), P('freq', 'Frequency', 2, 96, 1, 32), P('oct', 'Octaves', 1, 6, 1, 3),
  ], (ctx, p, S) => {
    const n = ctx.n, disp = new Float32Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const d = fbm(valueNoise, x / n * p.freq, y / n * p.freq, { octaves: p.oct, seed: 91 }) - 0.5;
      disp[i] = d + 0.5;
      S.h[i] += d * p.amount * 2;
    }
    ctx.maps.displacement = disp;
  }, { targets: ['height'] }),
  L(201, 'flow-map', 'Flow Map', 'Water-flow direction + accumulation maps.', [
    P('preview', 'Show in color', 0, 1, 1, 1),
  ], (ctx, p, S) => {
    const n = ctx.n, f = flowAccum(ctx.h, n), { aspect } = ctx; // aspect via field below
    void aspect;
    const asp = ctx.field('aspect');
    S.flow.set(f);
    const dir = new Float32Array(n * n * 2);
    for (let i = 0; i < f.length; i++) { dir[i * 2] = Math.cos(asp[i]); dir[i * 2 + 1] = Math.sin(asp[i]); }
    ctx.maps.flowDir = dir;
    ctx.maps.flow = Float32Array.from(f);
    if (p.preview) for (let i = 0; i < f.length; i++) setAlb(S, i, dir[i * 2] * 0.5 + 0.5, dir[i * 2 + 1] * 0.5 + 0.5, f[i]);
  }, { targets: ['flow', 'alb'] }),
  L(202, 'moisture-map', 'Moisture Map', 'Moisture: flow + concavity + altitude falloff.', [
    P('flowAmt', 'Flow amount', 0, 1, 0.02, 0.6), P('altFall', 'Altitude falloff', 0, 1, 0.02, 0.5),
    P('preview', 'Show in color', 0, 1, 1, 1),
  ], (ctx, p, S) => {
    const f = ctx.field('flow'), cv = ctx.field('cavity'), h = ctx.field('height01');
    for (let i = 0; i < f.length; i++) {
      const m = clamp(f[i] * p.flowAmt + cv[i] * 0.35 + (1 - h[i]) * p.altFall * 0.4 + ctx.moist[i] * 0.35, 0, 1);
      S.moist[i] = m;
      if (p.preview) setAlb(S, i, m * 0.3, m * 0.55, m);
    }
    ctx.maps.moisture = Float32Array.from(S.moist);
  }, { targets: ['moist', 'alb'] }),
  L(203, 'snow-map', 'Snow Map', 'Snow coverage with wind breakup.', [
    P('line', 'Snow line', 0, 1, 0.01, 0.58), P('slopeMax', 'Max slope°', 0, 90, 1, 40, '°'),
    P('breakup', 'Breakup', 1, 32, 1, 12), P('preview', 'Show in color', 0, 1, 1, 1),
  ], (ctx, p, S) => {
    const n = ctx.n, h = ctx.field('height01'), s = ctx.field('slope');
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const br = (fbm(valueNoise, x / n * p.breakup, y / n * p.breakup, { octaves: 3, seed: 41 }) - 0.5) * 0.2;
      const m = smoothstep(p.line - 0.06, p.line + 0.06, h[i] + br) *
        (1 - smoothstep(p.slopeMax - 8, p.slopeMax + 8, Math.atan(s[i]) * 180 / Math.PI));
      S.snow[i] = m;
      if (p.preview) setAlb(S, i, m, m, m * 1.0);
    }
    ctx.maps.snow = Float32Array.from(S.snow);
  }, { targets: ['snow', 'alb'] }),
];
