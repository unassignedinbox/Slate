// Slate — vegetation / scatter #236–240.
import { clamp, smoothstep, lerp, mulberry32, hexToRgb } from './util.js';
import { valueNoise, fbm } from './noise.js';

const P = (k, label, min, max, step, def, unit = '', hint = '') =>
  ({ k, label, min, max, step, def, unit, hint, type: 'slider' });
const L = (n, id, name, desc, params, run, extra = {}) =>
  ({ n, id, name, cat: 'vegetation', desc, targets: [], params, run, ...extra });

export const LAYERS_VEG = [
  L(236, 'scatter', 'Scatter', 'Scatter trees / rocks / grass points on the surface.', [
    P('kind', 'Kind', 0, 2, 1, 0, 'enum', 'Trees|Rocks|Grass'),
    P('count', 'Count', 10, 20000, 10, 2500), P('hLo', 'Height min', 0, 1, 0.01, 0.3),
    P('hHi', 'Height max', 0, 1, 0.01, 0.7), P('slopeMax', 'Max slope°', 0, 80, 1, 32, '°'),
    P('moistMin', 'Min moisture', 0, 1, 0.01, 0.15), P('sizeMin', 'Size min', 0.2, 3, 0.1, 0.7),
    P('sizeMax', 'Size max', 0.2, 6, 0.1, 1.6), P('seed', 'Seed', 0, 9999, 1, 91),
  ], (ctx, p, S) => {
    const n = ctx.n, rnd = mulberry32(p.seed * 43 + 5);
    const h = ctx.field('height01'), s = ctx.field('slope');
    const pts = [];
    let guard = p.count * 14 + 100;
    while (pts.length < p.count && guard-- > 0) {
      const x = rnd() * (n - 1), y = rnd() * (n - 1);
      const xi = x | 0, yi = y | 0, i = yi * n + xi;
      if (h[i] < p.hLo || h[i] > p.hHi) continue;
      if (Math.atan(s[i]) * 180 / Math.PI > p.slopeMax) continue;
      if (ctx.moist[i] < p.moistMin) continue;
      if (ctx.h[i] < ctx.waterLevel) continue; // not underwater
      const cl = fbm(valueNoise, x / n * 6, y / n * 6, { octaves: 3, seed: p.seed });
      if (rnd() > cl * 1.35) continue; // clustered groves
      pts.push({
        x: x / (n - 1), y: y / (n - 1), z: ctx.h[i],
        s: p.sizeMin + rnd() * (p.sizeMax - p.sizeMin), r: rnd() * Math.PI * 2,
        t: p.kind | 0, v: 0.75 + rnd() * 0.5,
      });
    }
    ctx.scatter.push(...pts);
    ctx.layerResult = { placed: pts.length, kind: ['trees', 'rocks', 'grass'][p.kind | 0] };
    void S;
  }),
  L(237, 'density', 'Density', 'Growth-density distribution map.', [
    P('freq', 'Frequency', 0.5, 24, 0.5, 5), P('contrast', 'Contrast', 0.2, 3, 0.05, 1.2),
    P('moistAmt', 'Moisture amount', 0, 1, 0.02, 0.5), P('seed', 'Seed', 0, 9999, 1, 92),
    P('preview', 'Show in color', 0, 1, 1, 0),
  ], (ctx, p, S) => {
    const n = ctx.n, d = new Float32Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const v = Math.pow(clamp(fbm(valueNoise, x / n * p.freq, y / n * p.freq, { octaves: 4, seed: p.seed })), p.contrast);
      d[i] = clamp(v * (1 - p.moistAmt * 0.5) + ctx.moist[i] * p.moistAmt);
      if (p.preview) { S.alb[i * 3] = d[i] * 0.4; S.alb[i * 3 + 1] = d[i]; S.alb[i * 3 + 2] = d[i] * 0.35; }
    }
    ctx.maps.density = d;
    ctx.layerResult = { map: 'density' };
  }, { targets: ['alb'] }),
  L(238, 'biome', 'Biome', 'Biome classification: tint by temperature + moisture.', [
    P('seaLevel', 'Sea level', 0, 1, 0.01, 0.3), P('snowLine', 'Snow line', 0, 1, 0.01, 0.72),
    P('tempFreq', 'Latitude warp', 0, 12, 0.5, 3), P('seed', 'Seed', 0, 9999, 1, 93),
  ], (ctx, p, S) => {
    const n = ctx.n, biome = new Uint8Array(n * n);
    const cols = [
      [0.08, 0.2, 0.35], [0.76, 0.68, 0.47], [0.16, 0.38, 0.14], [0.1, 0.3, 0.2],
      [0.42, 0.4, 0.32], [0.5, 0.52, 0.4], [0.93, 0.94, 0.96],
    ]; // ocean,sand,forest,jungle,rock,tundra,snow
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const temp = clamp(1 - ctx.h[i] * 1.1 + (fbm(valueNoise, x / n * p.tempFreq, y / n * p.tempFreq, { octaves: 2, seed: p.seed }) - 0.5) * 0.5);
      const moist = ctx.moist[i];
      let b;
      if (ctx.h[i] < p.seaLevel) b = 0;
      else if (ctx.h[i] > p.snowLine) b = 6;
      else if (temp > 0.62 && moist < 0.3) b = 1;
      else if (moist > 0.62 && temp > 0.45) b = 3;
      else if (moist > 0.38) b = 2;
      else if (temp < 0.3) b = 5;
      else b = 4;
      biome[i] = b;
      const c = cols[b];
      const edge = 0.92 + valueNoise(x * 0.3, y * 0.3, 7) * 0.16;
      S.alb[i * 3] = clamp(c[0] * edge); S.alb[i * 3 + 1] = clamp(c[1] * edge); S.alb[i * 3 + 2] = clamp(c[2] * edge);
    }
    ctx.maps.biome = biome;
    ctx.biome = biome;
  }, { targets: ['alb'] }),
  L(239, 'tree-line', 'Tree Line', 'Altitude tree-line mask: forest below, barren above.', [
    P('line', 'Tree line', 0, 1, 0.01, 0.62), P('soft', 'Softness', 0, 0.3, 0.005, 0.06),
    P('slopeMax', 'Max slope°', 0, 80, 1, 38, '°'),
  ], (ctx, p, S) => {
    const h = ctx.field('height01'), s = ctx.field('slope');
    const forest = hexToRgb('#2c5a26'), barren = hexToRgb('#7d7468');
    for (let i = 0; i < h.length; i++) {
      const a = Math.atan(s[i]) * 180 / Math.PI;
      const m = (1 - smoothstep(p.line - p.soft, p.line + p.soft, h[i])) *
        (1 - smoothstep(p.slopeMax - 8, p.slopeMax + 8, a));
      const c = [lerp(barren[0], forest[0], m), lerp(barren[1], forest[1], m), lerp(barren[2], forest[2], m)];
      S.alb[i * 3] = c[0]; S.alb[i * 3 + 1] = c[1]; S.alb[i * 3 + 2] = c[2];
    }
    ctx.maps.treeLine = Float32Array.from(h.map((v) => 1 - smoothstep(p.line - p.soft, p.line + p.soft, v)));
  }, { targets: ['alb'] }),
  L(240, 'grass-line', 'Grass Line', 'Grass coverage band between rock and sand.', [
    P('lo', 'Low edge', 0, 1, 0.01, 0.3), P('hi', 'High edge', 0, 1, 0.01, 0.62),
    P('soft', 'Softness', 0, 0.3, 0.005, 0.07), P('patch', 'Patchiness', 1, 32, 1, 11),
  ], (ctx, p, S) => {
    const n = ctx.n, h = ctx.field('height01');
    const grass = hexToRgb('#5d8a3c');
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const patch = fbm(valueNoise, x / n * p.patch, y / n * p.patch, { octaves: 3, seed: 55 });
      const m = smoothstep(p.lo - p.soft, p.lo + p.soft, h[i]) * (1 - smoothstep(p.hi - p.soft, p.hi + p.soft, h[i])) *
        smoothstep(0.3, 0.6, patch);
      S.alb[i * 3] = lerp(S.alb[i * 3], grass[0], m);
      S.alb[i * 3 + 1] = lerp(S.alb[i * 3 + 1], grass[1], m);
      S.alb[i * 3 + 2] = lerp(S.alb[i * 3 + 2], grass[2], m);
    }
  }, { targets: ['alb'] }),
];
