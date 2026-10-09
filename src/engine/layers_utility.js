// Slate — utility #217–235. Pipeline management, I/O markers, channel ops.
import { clamp, lerp, fieldStats, histogram, rgbToHsv, hsvToRgb } from './util.js';
import { valueNoise, fbm } from './noise.js';

const P = (k, label, min, max, step, def, unit = '', hint = '') =>
  ({ k, label, min, max, step, def, unit, hint, type: 'slider' });
const L = (n, id, name, desc, params, run, extra = {}) =>
  ({ n, id, name, cat: 'utility', desc, targets: [], params, run, ...extra });

const albLuma = (S, i) => 0.2126 * S.alb[i * 3] + 0.7152 * S.alb[i * 3 + 1] + 0.0722 * S.alb[i * 3 + 2];

export const LAYERS_UTILITY = [
  L(217, 'cache', 'Cache', 'Cache this layer result for Merge / Compare.', [
    P('slot', 'Slot', 0, 3, 1, 0, '', 'Cache slot A–D'),
  ], (ctx, p, S) => {
    ctx.cache[p.slot | 0] = { h: Float32Array.from(S.h), alb: Float32Array.from(S.alb) };
    ctx.layerResult = { cached: `slot ${'ABCD'[p.slot | 0]}`, pixels: ctx.n * ctx.n };
  }),
  L(218, 'output', 'Output', 'Mark the final output point of the stack.', [], (ctx, p, S) => {
    ctx.outputAt = ctx.layerIndex;
    ctx.maps.output = { h: Float32Array.from(S.h), alb: Float32Array.from(S.alb) };
    void p;
  }),
  L(219, 'input', 'Input', 'Import an external heightmap (loaded via file picker).', [
    P('gain', 'Gain', 0, 2, 0.02, 1), P('offset', 'Offset', -1, 1, 0.005, 0),
  ], (ctx, p, S) => {
    const src = ctx.layerData; // Float32Array(res²) 0..1 or null
    if (src && src.length === S.h.length) {
      for (let i = 0; i < S.h.length; i++) S.h[i] = clamp(src[i] * p.gain + p.offset);
      ctx.layerResult = { source: 'external heightmap', gain: p.gain };
    } else {
      S.h.fill(clamp(0.4 * p.gain + p.offset)); // placeholder until a file is loaded
      ctx.layerResult = { source: 'none — load a file in the inspector' };
    }
  }, { targets: ['height'] }),
  L(220, 'file-import', 'File Import', 'Load .raw/.png heightmap data (via file picker).', [
    P('gain', 'Gain', 0, 2, 0.02, 1), P('offset', 'Offset', -1, 1, 0.005, 0),
    P('channel', 'Channel', 0, 3, 1, 0, 'enum', 'Luminance|Red|Green|Blue'),
    P('flipY', 'Flip Y', 0, 1, 1, 0),
  ], (ctx, p, S) => {
    const src = ctx.layerData;
    if (src && src.length === S.h.length) {
      const n = ctx.n;
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const sy = p.flipY ? n - 1 - y : y;
        S.h[y * n + x] = clamp(src[sy * n + x] * p.gain + p.offset);
      }
      ctx.layerResult = { source: 'file data', channel: p.channel };
    } else {
      S.h.fill(clamp(0.4 * p.gain + p.offset));
      ctx.layerResult = { source: 'none — load a file in the inspector' };
    }
  }, { targets: ['height'] }),
  L(221, 'export', 'Export', 'Export marker: snapshots buffers for download.', [
    P('what', 'What', 0, 4, 1, 0, 'enum', 'Height+Color|Height|Color|Normal|All maps'),
  ], (ctx, p, S) => {
    ctx.exports.push({ at: ctx.layerIndex, what: p.what, h: Float32Array.from(S.h), alb: Float32Array.from(S.alb) });
    ctx.layerResult = { queued: ['height+color', 'height', 'color', 'normal', 'all maps'][p.what | 0] };
  }),
  L(222, 'view', 'View', 'Preview this point of the stack in the viewport.', [
    P('buffer', 'Buffer', 0, 5, 1, 0, 'enum', 'Height|Color|Flow|Slope|AO|Moisture'),
  ], (ctx, p, S) => {
    const names = ['height', 'color', 'flow', 'slope', 'ao', 'moisture'];
    ctx.previewSolo = { buffer: names[p.buffer | 0], at: ctx.layerIndex };
    ctx.layerResult = { viewing: names[p.buffer | 0] };
    void S;
  }),
  L(223, 'compare', 'Compare', 'Side-by-side compare vs cache slot or start.', [
    P('against', 'Against', 0, 4, 1, 4, 'enum', 'Slot A|Slot B|Slot C|Slot D|Stack start'),
    P('split', 'Split', 0, 1, 0.01, 0.5),
  ], (ctx, p, S) => {
    ctx.compare = { against: p.against | 0, split: p.split, at: ctx.layerIndex };
    ctx.layerResult = { compareAgainst: ['A', 'B', 'C', 'D', 'start'][p.against | 0] };
    void S;
  }),
  L(224, 'view-3d', '3D View', 'Switch the viewport to the 3D mesh here.', [
    P('shade', 'Shade', 0, 3, 1, 0, 'enum', 'Textured|Clay|Height|Wireframe'),
  ], (ctx, p, S) => {
    ctx.view3d = { shade: p.shade | 0, at: ctx.layerIndex };
    ctx.layerResult = { viewport: ['textured', 'clay', 'height', 'wireframe'][p.shade | 0] };
    void S;
  }),
  L(225, 'stats', 'Stats', 'Statistics readout for this point in the stack.', [
    P('bins', 'Histogram bins', 8, 128, 1, 32),
  ], (ctx, p, S) => {
    const hs = fieldStats(S.h);
    const H = histogram(S.h, p.bins);
    let lr = 0, lg = 0, lb = 0;
    for (let i = 0; i < S.h.length; i++) { lr += S.alb[i * 3]; lg += S.alb[i * 3 + 1]; lb += S.alb[i * 3 + 2]; }
    ctx.layerResult = {
      min: +hs.min.toFixed(4), max: +hs.max.toFixed(4), mean: +hs.mean.toFixed(4), std: +hs.std.toFixed(4),
      avgColor: [lr / S.h.length, lg / S.h.length, lb / S.h.length].map((v) => +v.toFixed(3)),
      histogram: H.bins, waterLevel: +ctx.waterLevel.toFixed(4),
    };
  }),
  L(226, 'switch', 'Switch', 'Toggle between generated fill (A) and pass-through (B).', [
    P('select', 'Select', 0, 1, 1, 0, 'enum', 'A · Generate|B · Pass'),
    P('freq', 'Gen frequency', 0.5, 32, 0.5, 5), P('seed', 'Seed', 0, 9999, 1, 81),
  ], (ctx, p, S) => {
    if (p.select === 0) {
      const n = ctx.n;
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++)
        S.h[y * n + x] = fbm(valueNoise, x / n * p.freq, y / n * p.freq, { octaves: 4, seed: p.seed });
    } // B: S.h already holds the pass-through copy
    ctx.layerResult = { selected: p.select === 0 ? 'A' : 'B' };
  }, { targets: ['height'] }),
  L(227, 'gate', 'Gate', 'Conditional pass-through above a height threshold.', [
    P('threshold', 'Threshold', 0, 1, 0.01, 0.5), P('soft', 'Softness', 0, 0.3, 0.005, 0.05),
    P('fail', 'Fail value', 0, 1, 0.01, 0.4),
  ], (ctx, p, S) => {
    const n = ctx.n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const t = (S.h[i] - (p.threshold - p.soft)) / Math.max(1e-4, p.soft * 2);
      const m = clamp(t);
      S.h[i] = lerp(p.fail, ctx.h[i], m * m * (3 - 2 * m));
    }
  }, { targets: ['height'] }),
  L(228, 'merge', 'Merge', 'Merge this point with an earlier cached layer.', [
    P('slot', 'Slot', 0, 4, 1, 0, 'enum', 'A|B|C|D|Previous layer'),
    P('mode', 'Mode', 0, 3, 1, 0, 'enum', 'Average|Max|Min|Difference'),
    P('amount', 'Amount', 0, 1, 0.01, 0.5),
  ], (ctx, p, S) => {
    let other = null;
    if (p.slot <= 3) other = ctx.cache[p.slot | 0];
    else if (ctx.history.length) other = ctx.history[ctx.history.length - 1];
    if (!other) { ctx.layerResult = { merged: 'nothing cached yet' }; return; }
    for (let i = 0; i < S.h.length; i++) {
      const a = S.h[i], b = other.h[i];
      const m = p.mode === 0 ? (a + b) / 2 : p.mode === 1 ? Math.max(a, b) : p.mode === 2 ? Math.min(a, b) : Math.abs(a - b);
      S.h[i] = lerp(a, m, p.amount);
    }
    ctx.layerResult = { merged: ['A', 'B', 'C', 'D', 'previous'][p.slot | 0] };
  }, { targets: ['height'] }),
  L(229, 'split', 'Split', 'Split color into R/G/B channels; view one as gray.', [
    P('channel', 'View', 0, 2, 1, 0, 'enum', 'Red|Green|Blue'),
  ], (ctx, p, S) => {
    const n = ctx.n, r = new Float32Array(n * n), g = new Float32Array(n * n), b = new Float32Array(n * n);
    for (let i = 0; i < n * n; i++) {
      r[i] = S.alb[i * 3]; g[i] = S.alb[i * 3 + 1]; b[i] = S.alb[i * 3 + 2];
    }
    ctx.maps.r = r; ctx.maps.g = g; ctx.maps.b = b;
    const src = [r, g, b][p.channel | 0];
    for (let i = 0; i < n * n; i++) { S.alb[i * 3] = src[i]; S.alb[i * 3 + 1] = src[i]; S.alb[i * 3 + 2] = src[i]; }
    ctx.layerResult = { viewing: ['red', 'green', 'blue'][p.channel | 0] };
  }, { targets: ['alb'] }),
  L(230, 'channel-extract', 'Channel Extract', 'Extract one albedo channel to gray.', [
    P('channel', 'Channel', 0, 3, 1, 0, 'enum', 'Red|Green|Blue|Alpha(height)'),
  ], (ctx, p, S) => {
    for (let i = 0; i < S.h.length; i++) {
      const v = p.channel <= 2 ? S.alb[i * 3 + (p.channel | 0)] : S.h[i];
      S.alb[i * 3] = v; S.alb[i * 3 + 1] = v; S.alb[i * 3 + 2] = v;
    }
  }, { targets: ['alb'] }),
  L(231, 'combine-channels', 'Combine Channels', 'Build RGB from map sources.', [
    P('srcR', 'Red ←', 0, 5, 1, 0, 'enum', 'Height|Slope|Flow|Cavity|Moisture|Snow'),
    P('srcG', 'Green ←', 0, 5, 1, 1, 'enum', 'Height|Slope|Flow|Cavity|Moisture|Snow'),
    P('srcB', 'Blue ←', 0, 5, 1, 2, 'enum', 'Height|Slope|Flow|Cavity|Moisture|Snow'),
  ], (ctx, p, S) => {
    const srcs = [ctx.field('height01'), ctx.field('slopeN'), ctx.field('flow'), ctx.field('cavity'), ctx.moist, ctx.snow];
    const R = srcs[p.srcR | 0], G = srcs[p.srcG | 0], B = srcs[p.srcB | 0];
    for (let i = 0; i < S.h.length; i++) { S.alb[i * 3] = R[i]; S.alb[i * 3 + 1] = G[i]; S.alb[i * 3 + 2] = B[i]; }
  }, { targets: ['alb'] }),
  L(232, 'grayscale', 'Grayscale', 'Convert color to grayscale (channel average).', [], (ctx, p, S) => {
    for (let i = 0; i < S.h.length; i++) {
      const v = (S.alb[i * 3] + S.alb[i * 3 + 1] + S.alb[i * 3 + 2]) / 3;
      S.alb[i * 3] = v; S.alb[i * 3 + 1] = v; S.alb[i * 3 + 2] = v;
    }
    void p;
  }, { targets: ['alb'] }),
  L(233, 'rgb-hsv', 'RGB to HSV', 'Color-space conversion (visualized as RGB).', [
    P('channel', 'Boost', 0, 2, 1, 0, 'enum', 'None|Saturation ×2|Value ×1.2'),
  ], (ctx, p, S) => {
    for (let i = 0; i < S.h.length; i++) {
      let [h, s, v] = rgbToHsv(S.alb[i * 3], S.alb[i * 3 + 1], S.alb[i * 3 + 2]);
      if (p.channel === 1) s = clamp(s * 2);
      if (p.channel === 2) v = clamp(v * 1.2);
      const [r, g, b] = hsvToRgb(h, s, v);
      S.alb[i * 3] = r; S.alb[i * 3 + 1] = g; S.alb[i * 3 + 2] = b;
    }
    ctx.maps.hsv = true;
  }, { targets: ['alb'] }),
  L(234, 'hsv-rgb', 'HSV to RGB', 'Treat color as HSV and convert to RGB.', [], (ctx, p, S) => {
    for (let i = 0; i < S.h.length; i++) {
      const [r, g, b] = hsvToRgb(S.alb[i * 3], S.alb[i * 3 + 1], S.alb[i * 3 + 2]);
      S.alb[i * 3] = r; S.alb[i * 3 + 1] = g; S.alb[i * 3 + 2] = b;
    }
    void p;
  }, { targets: ['alb'] }),
  L(235, 'luminance', 'Luminance', 'Extract Rec.709 luminance.', [], (ctx, p, S) => {
    for (let i = 0; i < S.h.length; i++) {
      const v = albLuma(S, i);
      S.alb[i * 3] = v; S.alb[i * 3 + 1] = v; S.alb[i * 3 + 2] = v;
    }
    ctx.maps.luminance = true;
    void p;
  }, { targets: ['alb'] }),
];
