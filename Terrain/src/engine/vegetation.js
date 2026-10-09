// 236-240 Vegetation / scatter. Density and tree/grass lines are maps; Scatter places instances (tree points) that the
// viewport renders as instanced geometry. Biome classifies the land by altitude and moisture (Whittaker-style bands).
import { makeDef } from './def.js';
import { num, int, sel, seedParam } from './schema.js';
import { mulberry32 } from './rng.js';
import { clamp, smoothstep } from './grid.js';
import { derive } from './context.js';
import { hexColour } from './colourspace.js';

export const BIOMES = [
  { name: 'Snow & ice', col: '#eef3f7' },
  { name: 'Tundra', col: '#9aa58a' },
  { name: 'Boreal forest', col: '#2f5a43' },
  { name: 'Temperate forest', col: '#3b7140' },
  { name: 'Grassland', col: '#9bb05a' },
  { name: 'Shrubland', col: '#8f8d56' },
  { name: 'Desert', col: '#d8b98a' },
  { name: 'Rock', col: '#7a736a' },
];

export const vegetationDefs = [
  makeDef({
    id: 236, key: 'scatter', name: 'Scatter', cat: 'Vegetation', kind: 'veg',
    params: [int('count', 'Instances (thousands)', 8, 1, 200), num('minScale', 'Min scale', 0.6, 0.1, 3, 0.05), num('maxScale', 'Max scale', 1.4, 0.1, 4, 0.05),
      num('maxSlope', 'Max slope [deg]', 30, 0, 90, 0.5), num('maxHeight', 'Max altitude', 0.7, 0, 1, 0.01), seedParam(236)],
    desc: 'Point scattering: instances placed by density, altitude and slope limits (drawn in the 3-D view).',
    run: (ctx, p) => {
      const N = ctx.N, rnd = mulberry32(p.seed);
      const density = ctx.maps.density?.data;
      const treeline = ctx.maps.treeline?.data;
      const s = ctx.get('slope', derive.slope);
      const want = Math.round(p.count * 1000 * (N / 256) ** 2 / 4);
      const out = [];
      let guard = 0;
      while (out.length < want && guard++ < want * 20) {
        const x = Math.floor(rnd() * N), y = Math.floor(rnd() * N), i = y * N + x;
        if (s[i] > p.maxSlope || ctx.H[i] > p.maxHeight) continue;
        const d = density ? density[i] : 1;
        if (rnd() > d) continue;
        if (treeline && rnd() > treeline[i]) continue;
        out.push({ x: x / (N - 1), y: y / (N - 1), h: ctx.H[i], s: p.minScale + (p.maxScale - p.minScale) * rnd() });
      }
      return { scatter: out, stats: { instances: out.length } };
    },
  }),
  makeDef({
    id: 237, key: 'density', name: 'Density', cat: 'Vegetation', kind: 'map',
    params: [num('amount', 'Base density', 0.8, 0, 1, 0.01), num('slopeFade', 'Slope fade', 0.6, 0, 1, 0.01), num('moisture', 'Moisture weight', 0.5, 0, 1, 0.01)],
    desc: 'Vegetation density map: favours gentle, moist, low ground.',
    run: (ctx, p) => {
      const s = ctx.get('slopeN', derive.slopeN), f = ctx.get('flowN', derive.flowN);
      return { map: { name: 'density', ch: 1, data: Float32Array.from(ctx.H, (h, i) => clamp(p.amount * (1 - p.slopeFade * s[i]) * (1 - p.moisture + p.moisture * f[i]) * (1 - smoothstep(0.6, 0.85, h)))) } };
    },
  }),
  makeDef({
    id: 238, key: 'biome', name: 'Biome', cat: 'Vegetation', kind: 'color',
    params: [num('wet', 'Moisture influence', 0.5, 0, 1, 0.01)],
    desc: 'Biome classification from altitude, slope and moisture; writes a biome colour and a "biome" index map.',
    run: (ctx, p) => {
      const N = ctx.N, s = ctx.get('slopeN', derive.slopeN), f = ctx.get('flowN', derive.flowN);
      const idx = new Float32Array(N * N), color = new Float32Array(N * N * 3), palette = BIOMES.map((b) => hexColour(b.col));
      for (let i = 0; i < N * N; i++) {
        const h = ctx.H[i];
        const moist = (1 - p.wet) * 0.5 + p.wet * f[i];
        let b;
        if (h > 0.85) b = 0;
        else if (s[i] > 0.6) b = 7;
        else if (h > 0.7) b = 1;
        else if (moist > 0.6 && h < 0.5) b = 3;
        else if (moist > 0.5) b = 2;
        else if (moist < 0.25) b = 6;
        else if (h > 0.5) b = 5;
        else b = 4;
        idx[i] = b;
        color[i * 3] = palette[b][0]; color[i * 3 + 1] = palette[b][1]; color[i * 3 + 2] = palette[b][2];
      }
      return { color, map: { name: 'biome', ch: 1, data: idx } };
    },
  }),
  makeDef({
    id: 239, key: 'treeLine', name: 'Tree Line', cat: 'Vegetation', kind: 'map',
    params: [num('altitude', 'Tree line altitude', 0.6, 0, 1, 0.01), num('soft', 'Softness', 0.04, 0.001, 0.3, 0.001)],
    desc: 'Tree-line mask: 1 below the tree line, fading to 0 above it.',
    run: (ctx, p) => ({ map: { name: 'treeline', ch: 1, data: Float32Array.from(ctx.H, (h) => 1 - smoothstep(p.altitude - p.soft, p.altitude + p.soft, h)) } }),
  }),
  makeDef({
    id: 240, key: 'grassLine', name: 'Grass Line', cat: 'Vegetation', kind: 'map',
    params: [num('altitude', 'Grass line altitude', 0.45, 0, 1, 0.01), num('soft', 'Softness', 0.05, 0.001, 0.3, 0.001)],
    desc: 'Grass-line mask: grass coverage that thins out above the grass line.',
    run: (ctx, p) => ({ map: { name: 'grassline', ch: 1, data: Float32Array.from(ctx.H, (h) => 1 - smoothstep(p.altitude - p.soft, p.altitude + p.soft, h)) } }),
  }),
];

