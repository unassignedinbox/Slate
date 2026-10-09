// 1-28 Primitives / base generators. Each returns { height } in [0, 1].
import { makeDef } from './def.js';
import { num, int, sel, seedParam, noiseParams } from './schema.js';
import { valueNoise, perlin, simplex, worleyF4, sparseKernel, gaborNoise, waveletNoise } from './noise.js';
import { hash2 } from './rng.js';
import { fieldOf, latticeFn, fractalField } from './sampling.js';
import { blurGauss, smoothstep, normalizeGrid } from './grid.js';

const fbmParams = (octaves) => noiseParams.map((p) => (p.k === 'octaves' ? { ...p, def: octaves } : p));
const lat = (ctx, p, fn) => {
  const L = latticeFn(ctx, p);
  return fieldOf(ctx.N, (x, y, i) => fn(...L(x, y), p.seed ?? 1, i));
};
const norm = (h) => ({ height: normalizeGrid(h) });
const fract = (v) => v - Math.floor(v);

export const generatorDefs = [
  makeDef({
    id: 1, key: 'constant', name: 'Constant', cat: 'Primitives',
    params: [num('value', 'Value', 0.5, 0, 1)],
    desc: 'Flat plane at a constant height.',
    run: (ctx, p) => ({ height: fieldOf(ctx.N, () => p.value) }),
  }),
  makeDef({
    id: 2, key: 'perlin', name: 'Perlin', cat: 'Primitives', params: fbmParams(1),
    desc: 'Classic gradient (Perlin) noise. One octave by default; add octaves for detail.',
    run: (ctx, p) => norm(fractalField(ctx, p, perlin)),
  }),
  makeDef({
    id: 3, key: 'simplex', name: 'Simplex', cat: 'Primitives', params: fbmParams(1),
    desc: 'Simplex noise (Gustavson 2-D) with optional octaves.',
    run: (ctx, p) => norm(fractalField(ctx, p, simplex)),
  }),
  makeDef({
    id: 4, key: 'value', name: 'Value Noise', cat: 'Primitives', params: fbmParams(1),
    desc: 'Interpolated lattice values: blocky, soft-edged noise.',
    run: (ctx, p) => norm(fractalField(ctx, p, valueNoise)),
  }),
  makeDef({
    id: 5, key: 'voronoi1', name: 'Voronoi (F1)', cat: 'Primitives', params: [num('jitter', 'Jitter', 1, 0, 1)],
    desc: 'Domes centred on each Voronoi cell point (distance to the nearest point).',
    run: (ctx, p) => norm(lat(ctx, p, (u, v, s) => 1 - worleyF4(u, v, s, p.jitter).f[0] * 0.7)),
  }),
  makeDef({
    id: 6, key: 'voronoi2', name: 'Voronoi (F2)', cat: 'Primitives', params: [num('jitter', 'Jitter', 1, 0, 1)],
    desc: 'Distance to the second-nearest Voronoi point.',
    run: (ctx, p) => norm(lat(ctx, p, (u, v, s) => worleyF4(u, v, s, p.jitter).f[1])),
  }),
  makeDef({
    id: 7, key: 'voronoi3', name: 'Voronoi (F3)', cat: 'Primitives', params: [num('jitter', 'Jitter', 1, 0, 1)],
    desc: 'Distance to the third-nearest Voronoi point.',
    run: (ctx, p) => norm(lat(ctx, p, (u, v, s) => worleyF4(u, v, s, p.jitter).f[2])),
  }),
  makeDef({
    id: 8, key: 'voronoi4', name: 'Voronoi (F4)', cat: 'Primitives', params: [num('jitter', 'Jitter', 1, 0, 1)],
    desc: 'Distance to the fourth-nearest Voronoi point.',
    run: (ctx, p) => norm(lat(ctx, p, (u, v, s) => worleyF4(u, v, s, p.jitter).f[3])),
  }),
  makeDef({
    id: 9, key: 'crackle', name: 'Voronoi Crackle', cat: 'Primitives',
    params: [num('jitter', 'Jitter', 1, 0, 1), num('width', 'Crack width', 0.08, 0.01, 0.5)],
    desc: 'Dark crack network along the edges between Voronoi cells.',
    run: (ctx, p) => norm(lat(ctx, p, (u, v, s) => {
      const f = worleyF4(u, v, s, p.jitter).f;
      return 1 - smoothstep(0, p.width, f[1] - f[0]);
    })),
  }),
  makeDef({
    id: 10, key: 'worley', name: 'Worley', cat: 'Primitives', params: [num('jitter', 'Jitter', 1, 0, 1), num('sharp', 'Cone sharpness', 1.5, 0.5, 4)],
    desc: 'Worley noise: sharp distance cones, a cellular basis with pointed peaks.',
    run: (ctx, p) => norm(lat(ctx, p, (u, v, s) => (1 - Math.min(1, worleyF4(u, v, s, p.jitter).f[0])) ** p.sharp)),
  }),
  makeDef({
    id: 11, key: 'cellular', name: 'Cellular', cat: 'Primitives', params: [num('density', 'Density', 0.5, 0.05, 0.95), int('steps', 'Automaton steps', 4, 0, 12)],
    desc: 'Cellular-automaton colonies: cell ids thresholded, then smoothed by majority-rule iterations.',
    run: (ctx, p) => {
      const N = ctx.N;
      let g = lat(ctx, p, (u, v, s) => {
        const id = worleyF4(u, v, s, 1).id;
        return id > 1 - p.density ? 1 : 0;
      });
      for (let k = 0; k < p.steps; k++) {
        const b = blurGauss(g, N, 1.2);
        g = Float32Array.from(b, (v) => (v > 0.5 ? 1 : 0));
      }
      return { height: blurGauss(g, N, 1.0) };
    },
  }),
  makeDef({
    id: 12, key: 'gabor', name: 'Gabor', cat: 'Primitives',
    params: [num('angle', 'Orientation [rad]', 0.6, -3.14, 3.14), num('freq', 'Carrier frequency', 3, 0.5, 10), ...fbmParams(4)],
    desc: 'Gabor noise: oriented cosine carriers under gaussian envelopes, summed over octaves.',
    run: (ctx, p) => norm(fractalField(ctx, p, (x, y, s) => gaborNoise(x, y, s, p.angle, p.freq))),
  }),
  makeDef({
    id: 13, key: 'sparse', name: 'Sparse Convolution', cat: 'Primitives', params: fbmParams(4),
    desc: 'Sparse convolution noise: random signed gaussian impulses summed per lattice cell.',
    run: (ctx, p) => norm(fractalField(ctx, p, (x, y, s) => sparseKernel(x, y, s, 1.1))),
  }),
  makeDef({
    id: 14, key: 'wavelet', name: 'Wavelet', cat: 'Primitives', params: fbmParams(4),
    desc: 'Wavelet-style noise built from fine, mid and coarse band-limited bands.',
    run: (ctx, p) => norm(fractalField(ctx, p, waveletNoise)),
  }),
  makeDef({
    id: 15, key: 'fbm', name: 'fBm', cat: 'Primitives', params: fbmParams(7),
    desc: 'Fractal Brownian motion: octaves of Perlin noise with gain and lacunarity.',
    run: (ctx, p) => norm(fractalField(ctx, p, perlin, 'fbm')),
  }),
  makeDef({
    id: 16, key: 'ridged', name: 'Ridged Multifractal', cat: 'Primitives', params: fbmParams(7),
    desc: 'Ridged fractal: sharp creases where the noise crosses zero.',
    run: (ctx, p) => norm(fractalField(ctx, p, perlin, 'ridged')),
  }),
  makeDef({
    id: 17, key: 'billow', name: 'Billow', cat: 'Primitives', params: fbmParams(6),
    desc: 'Billow fractal: rounded pillow-like lumps.',
    run: (ctx, p) => norm(fractalField(ctx, p, perlin, 'billow')),
  }),
  makeDef({
    id: 18, key: 'swiss', name: 'Swiss', cat: 'Primitives', params: fbmParams(6),
    desc: 'Swiss-cheese fractal: ridged octaves with holes punched by a second noise.',
    run: (ctx, p) => norm(fractalField(ctx, p, perlin, 'swiss')),
  }),
  makeDef({
    id: 19, key: 'jordan', name: 'Jordan', cat: 'Primitives', params: fbmParams(6),
    desc: 'Jordan fractal: ridged octaves modulated by a low-frequency warp.',
    run: (ctx, p) => norm(fractalField(ctx, p, perlin, 'jordan')),
  }),
  makeDef({
    id: 20, key: 'random', name: 'Random', cat: 'Primitives',
    params: [int('cells', 'Cells per side', 128, 4, 1024), seedParam(7)],
    desc: 'White noise: independent random value per cell (cell size controlled by Cells).',
    run: (ctx, p) => {
      const N = ctx.N, c = p.cells / N;
      return { height: fieldOf(N, (x, y) => hash2(Math.floor(x * c), Math.floor(y * c), p.seed)) };
    },
  }),
  makeDef({
    id: 21, key: 'grid', name: 'Grid', cat: 'Primitives',
    params: [num('scale', 'Cells', 6, 1, 40, 0.5), num('width', 'Line width', 0.08, 0.01, 0.5)],
    desc: 'Rectilinear grid of ridges.',
    run: (ctx, p) => {
      const L = latticeFn(ctx, { ...p, scale: p.scale / 2 });
      return { height: fieldOf(ctx.N, (x, y) => {
        const [u, v] = L(x, y);
        const du = Math.min(fract(u), 1 - fract(u)), dv = Math.min(fract(v), 1 - fract(v));
        return 1 - smoothstep(p.width * 0.5, p.width, Math.min(du, dv));
      }) };
    },
  }),
  makeDef({
    id: 22, key: 'hexagonal', name: 'Hexagonal', cat: 'Primitives',
    params: [num('scale', 'Cells', 5, 1, 40, 0.5), num('width', 'Edge width', 0.1, 0.01, 0.5)],
    desc: 'Hexagonal cell pattern with raised cell centres.',
    run: (ctx, p) => {
      const L = latticeFn(ctx, { ...p, scale: p.scale / 2 });
      return { height: fieldOf(ctx.N, (x, y) => {
        const [u0, v0] = L(x, y);
        const u = u0 * 1.1547, v = v0 + (Math.floor(u) % 2 ? 0.5 : 0);
        const fu = fract(u) - 0.5, fv = fract(v) - 0.5;
        const d = Math.max(Math.abs(fu) * 1.1547, Math.abs(fu) * 0.5 + Math.abs(fv));
        return smoothstep(0.5, 0.5 - p.width, d);
      }) };
    },
  }),
  makeDef({
    id: 23, key: 'brick', name: 'Brick', cat: 'Primitives',
    params: [num('scale', 'Rows', 5, 1, 40, 0.5), num('mortar', 'Mortar', 0.08, 0.01, 0.4)],
    desc: 'Running-bond brick courses with recessed mortar joints.',
    run: (ctx, p) => {
      const L = latticeFn(ctx, { ...p, scale: p.scale / 2 });
      return { height: fieldOf(ctx.N, (x, y) => {
        const [u, v] = L(x, y);
        const row = Math.floor(v);
        const bu = u + (row & 1 ? 0.5 : 0);
        const fu = fract(bu), fv = fract(v);
        const edge = Math.min(fu, 1 - fu, fv, 1 - fv);
        return smoothstep(p.mortar * 0.5, p.mortar, edge);
      }) };
    },
  }),
  makeDef({
    id: 24, key: 'checker', name: 'Checker', cat: 'Primitives',
    params: [num('scale', 'Tiles', 4, 1, 40, 0.5), num('soft', 'Edge softness', 0.02, 0, 0.3)],
    desc: 'Checkerboard of raised and lowered tiles.',
    run: (ctx, p) => {
      const L = latticeFn(ctx, { ...p, scale: p.scale / 2 });
      return { height: fieldOf(ctx.N, (x, y) => {
        const [u, v] = L(x, y);
        const a = fract(u) - 0.5, b = fract(v) - 0.5;
        const e = Math.max(p.soft, 1e-3);
        const cx = smoothstep(-e, e, a), cy = smoothstep(-e, e, b);
        return cx * cy + (1 - cx) * (1 - cy);
      }) };
    },
  }),
  makeDef({
    id: 25, key: 'stripes', name: 'Stripes', cat: 'Primitives',
    params: [num('scale', 'Stripes', 4, 1, 40, 0.5), num('duty', 'Duty cycle', 0.5, 0.05, 0.95), num('soft', 'Edge softness', 0.05, 0, 0.5)],
    desc: 'Parallel stripes with adjustable duty cycle and softness.',
    run: (ctx, p) => {
      const L = latticeFn(ctx, { ...p, scale: p.scale / 2 });
      return { height: fieldOf(ctx.N, (x, y) => {
        const [u] = L(x, y);
        const f = fract(u);
        return 1 - smoothstep(p.duty - p.soft - 1e-3, p.duty + p.soft, f);
      }) };
    },
  }),
  makeDef({
    id: 26, key: 'sine', name: 'Sine', cat: 'Primitives',
    params: [num('scale', 'Cycles', 3, 0.5, 30, 0.5)],
    desc: 'Smooth sine wave.',
    run: (ctx, p) => {
      const L = latticeFn(ctx, { ...p, scale: p.scale / 2 });
      return { height: fieldOf(ctx.N, (x, y) => 0.5 + 0.5 * Math.sin(2 * Math.PI * L(x, y)[0])) };
    },
  }),
  makeDef({
    id: 27, key: 'sawtooth', name: 'Sawtooth', cat: 'Primitives',
    params: [num('scale', 'Cycles', 3, 0.5, 30, 0.5)],
    desc: 'Linear ramps with a sharp drop at each period.',
    run: (ctx, p) => {
      const L = latticeFn(ctx, { ...p, scale: p.scale / 2 });
      return { height: fieldOf(ctx.N, (x, y) => fract(L(x, y)[0])) };
    },
  }),
  makeDef({
    id: 28, key: 'triangle', name: 'Triangle Wave', cat: 'Primitives',
    params: [num('scale', 'Cycles', 3, 0.5, 30, 0.5)],
    desc: 'Symmetric triangle wave.',
    run: (ctx, p) => {
      const L = latticeFn(ctx, { ...p, scale: p.scale / 2 });
      return { height: fieldOf(ctx.N, (x, y) => 1 - Math.abs(2 * fract(L(x, y)[0]) - 1)) };
    },
  }),
];
