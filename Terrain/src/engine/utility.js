// 217-235 Utility / pipeline / inspection nodes. These route data (cache, switch, gate, merge), import and export
// heightmaps, inspect the stack (view, compare, 3D view, stats, histogram) and convert between colour channels.
import { makeDef } from './def.js';
import { num, sel, bool } from './schema.js';
import { clamp, minMax, mean, sampleBilinear } from './grid.js';
import { combineGrid } from './blend.js';
import { rgbToHsv, hsvToRgb } from './colourspace.js';

const resampleTo = (src, M, N) => {
  const out = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    out[y * N + x] = sampleBilinear(src, M, (x / (N - 1)) * (M - 1), (y / (N - 1)) * (M - 1));
  }
  return out;
};

const lum = (C, i) => 0.299 * C[i * 3] + 0.587 * C[i * 3 + 1] + 0.114 * C[i * 3 + 2];
const colourMap = (N, fn) => {
  const out = new Float32Array(N * N * 3);
  for (let i = 0; i < N * N; i++) { const c = fn(i); out[i * 3] = c[0]; out[i * 3 + 1] = c[1]; out[i * 3 + 2] = c[2]; }
  return out;
};

export const utilityDefs = [
  makeDef({
    id: 217, key: 'cache', name: 'Cache', cat: 'Utility', kind: 'util', params: [],
    desc: 'Caches the stack at this point. Switch, Merge and Combine layers above it read this snapshot. Identity otherwise.',
    run: (ctx, p, layer, env) => { env.pushSnapshot(ctx, layer.id); return {}; },
  }),
  makeDef({
    id: 218, key: 'output', name: 'Output', cat: 'Utility', kind: 'util', params: [],
    desc: 'Marks the final output node. The viewport and exports always read the full stack result.',
    run: () => ({ stats: { output: true } }),
  }),
  makeDef({
    id: 219, key: 'input', name: 'Input', cat: 'Utility', kind: 'height', params: [sel('mode', 'Source', 'imported', [['imported', 'Imported heightmap'], ['flat', 'Reset to flat']]), num('level', 'Flat level', 0.5, 0, 1, 0.01)],
    desc: 'Input: resets the terrain to an imported heightmap (or a flat level) so layers above start from it.',
    run: (ctx, p, layer) => {
      if (p.mode === 'imported' && layer.imported) return { height: resampleTo(layer.imported.data, layer.imported.n, ctx.N) };
      return { height: new Float32Array(ctx.N * ctx.N).fill(p.level) };
    },
  }),
  makeDef({
    id: 220, key: 'fileImport', name: 'File Import', cat: 'Utility', kind: 'height', params: [num('gain', 'Gain', 1, 0, 4, 0.01), num('offset', 'Offset', 0, -1, 1, 0.005)],
    desc: 'Loads a .r16 / .raw / PNG heightmap from disk (use the Import button in the inspector). Identity if nothing is loaded.',
    run: (ctx, p, layer) => {
      if (!layer.imported) return {};
      const h = resampleTo(layer.imported.data, layer.imported.n, ctx.N);
      return { height: Float32Array.from(h, (v) => clamp(v * p.gain + p.offset)) };
    },
  }),
  makeDef({
    id: 221, key: 'export', name: 'Export', cat: 'Utility', kind: 'util', params: [sel('format', 'Format', 'r16', [['r16', 'Heightmap .r16 (16-bit)'], ['png', 'Heightmap .png'], ['raw', 'Raw float32']])],
    desc: 'Marks an export node. Use the Export card in the inspector to write files; the node itself is identity.',
    run: () => ({ stats: { export: true } }),
  }),
  makeDef({
    id: 222, key: 'view', name: 'View', cat: 'Utility', kind: 'util', params: [],
    desc: 'Records the stack state at this point so the 2-D viewer can show it (select "View" in the viewport).',
    run: (ctx, p, layer, env) => { env.recordView(ctx, layer.id, 'view'); return {}; },
  }),
  makeDef({
    id: 223, key: 'compare', name: 'Compare', cat: 'Utility', kind: 'util', params: [num('split', 'Split position', 0.5, 0, 1, 0.01)],
    desc: 'Compare: records the state at this point; the 2-D viewer splits between this state and the final result.',
    run: (ctx, p, layer, env) => { env.recordView(ctx, layer.id, 'compare', p.split); return {}; },
  }),
  makeDef({
    id: 224, key: 'view3d', name: '3D View', cat: 'Utility', kind: 'util', params: [sel('mode', 'Mesh', 'heightmap', [['heightmap', 'Heightmap mesh'], ['voxel', 'Voxel mesh']])],
    desc: 'Requests the 3-D viewport in the chosen mesh mode when the stack is evaluated.',
    run: () => ({ stats: { view3d: true } }),
  }),
  makeDef({
    id: 225, key: 'stats', name: 'Stats', cat: 'Utility', kind: 'util', params: [],
    desc: 'Statistics of the stack at this point: min, max, mean, deviation and water coverage (shown in the inspector).',
    run: (ctx) => {
      const { min, max } = minMax(ctx.H);
      const m = mean(ctx.H);
      let v = 0; for (let i = 0; i < ctx.H.length; i++) v += (ctx.H[i] - m) ** 2;
      let wet = 0; for (let i = 0; i < ctx.water.length; i++) if (ctx.water[i] > 0) wet++;
      return { stats: { min, max, mean: m, std: Math.sqrt(v / ctx.H.length), waterCoverage: wet / ctx.water.length } };
    },
  }),
  makeDef({
    id: 226, key: 'switch', name: 'Switch', cat: 'Utility', kind: 'height', params: [sel('source', 'Source', 'live', [['live', 'Live stack'], ['snapshot', 'Nearest cache snapshot']])],
    desc: 'Switch: passes either the live stack or the nearest Cache snapshot below.',
    run: (ctx, p, layer, env) => {
      if (p.source === 'live') return {};
      const snap = env.nearestSnapshot();
      if (!snap) return {};
      return { height: Float32Array.from(snap.H), color: Float32Array.from(snap.C) };
    },
  }),
  makeDef({
    id: 227, key: 'gate', name: 'Gate', cat: 'Utility', kind: 'height', params: [num('threshold', 'Mean height threshold', 0.2, 0, 1, 0.01), bool('invert', 'Invert condition', false)],
    desc: 'Gate: passes the terrain through when the mean height meets the threshold, otherwise resets it to flat zero.',
    run: (ctx, p) => {
      const pass = mean(ctx.H) >= p.threshold !== p.invert;
      return pass ? {} : { height: new Float32Array(ctx.N * ctx.N) };
    },
  }),
  makeDef({
    id: 228, key: 'merge', name: 'Merge', cat: 'Utility', kind: 'height', params: [sel('mode', 'Blend mode', 'max', [['max', 'Max'], ['add', 'Add'], ['average', 'Average'], ['multiply', 'Multiply'], ['blend', 'Blend']]), num('amount', 'Amount', 1, 0, 1, 0.01)],
    desc: 'Merge: combines the live stack with the nearest Cache snapshot using a blend mode.',
    run: (ctx, p, layer, env) => {
      const snap = env.nearestSnapshot();
      if (!snap) return {};
      return { height: combineGrid(ctx.H, snap.H, p.mode, p.amount) };
    },
  }),
  makeDef({
    id: 229, key: 'split', name: 'Split', cat: 'Utility', kind: 'map', params: [],
    desc: 'Split: writes the R, G and B channels of the colour buffer as three separate maps.',
    run: (ctx) => {
      const N = ctx.N, C = ctx.C;
      const ch = (k) => Float32Array.from({ length: N * N }, (_, i) => C[i * 3 + k]);
      return { maps: [{ name: 'split_r', ch: 1, data: ch(0) }, { name: 'split_g', ch: 1, data: ch(1) }, { name: 'split_b', ch: 1, data: ch(2) }] };
    },
  }),
  makeDef({
    id: 230, key: 'channelExtract', name: 'Channel Extract', cat: 'Utility', kind: 'height', params: [sel('channel', 'Channel', 'r', [['r', 'Red'], ['g', 'Green'], ['b', 'Blue']])],
    desc: 'Extracts one colour channel as the height.',
    run: (ctx, p) => {
      const k = { r: 0, g: 1, b: 2 }[p.channel];
      return { height: Float32Array.from({ length: ctx.N * ctx.N }, (_, i) => ctx.C[i * 3 + k]) };
    },
  }),
  makeDef({
    id: 231, key: 'combineChannels', name: 'Combine Channels', cat: 'Utility', kind: 'color', params: [],
    desc: 'Combines split R, G and B maps (or the current colour, if absent) into an RGB colour.',
    run: (ctx) => {
      const r = ctx.maps.split_r, g = ctx.maps.split_g, b = ctx.maps.split_b;
      if (!r || !g || !b) return {};
      return { color: colourMap(ctx.N, (i) => [r.data[i], g.data[i], b.data[i]]) };
    },
  }),
  makeDef({
    id: 232, key: 'grayscale', name: 'Grayscale', cat: 'Utility', kind: 'color', params: [],
    desc: 'Desaturates the colour buffer to its luminance.',
    run: (ctx) => ({ color: colourMap(ctx.N, (i) => { const l = lum(ctx.C, i); return [l, l, l]; }) }),
  }),
  makeDef({
    id: 233, key: 'rgbToHsv', name: 'RGB to HSV', cat: 'Utility', kind: 'color', params: [],
    desc: 'Re-encodes the colour buffer: channels now hold hue, saturation and value (shown as RGB).',
    run: (ctx) => ({ color: colourMap(ctx.N, (i) => rgbToHsv(ctx.C[i * 3], ctx.C[i * 3 + 1], ctx.C[i * 3 + 2])) }),
  }),
  makeDef({
    id: 234, key: 'hsvToRgb', name: 'HSV to RGB', cat: 'Utility', kind: 'color', params: [],
    desc: 'Interprets the colour buffer as hue, saturation and value and converts it back to RGB.',
    run: (ctx) => ({ color: colourMap(ctx.N, (i) => hsvToRgb(ctx.C[i * 3], ctx.C[i * 3 + 1], ctx.C[i * 3 + 2])) }),
  }),
  makeDef({
    id: 235, key: 'luminance', name: 'Luminance', cat: 'Utility', kind: 'height', params: [],
    desc: 'Extracts luminance of the colour buffer as the height.',
    run: (ctx) => ({ height: Float32Array.from({ length: ctx.N * ctx.N }, (_, i) => lum(ctx.C, i)) }),
  }),
];

