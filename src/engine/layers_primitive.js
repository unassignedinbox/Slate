// Slate — primitives / base generators #1–28 (raw height data from scratch).
import { clamp, hash2, mulberry32 } from './util.js';
import {
  perlin, simplex, valueNoise, worley, voronoiCrackle, cellular, gabor,
  sparseConv, wavelet, fbm, ridged, billow, swiss, jordan,
  patGrid, patHex, patBrick, patChecker, patStripes, waveSine, waveSaw, waveTri,
} from './noise.js';

const P = (k, label, min, max, step, def, unit = '', hint = '') =>
  ({ k, label, min, max, step, def, unit, hint, type: 'slider' });
const SEED = P('seed', 'Seed', 0, 9999, 1, 1);
const FREQ = P('freq', 'Frequency', 0.5, 64, 0.5, 6, '', 'Features across the tile');
const L = (n, id, name, desc, params, run, extra = {}) =>
  ({ n, id, name, cat: 'primitive', desc, targets: ['height'], params, run, ...extra });

// Iterate pixels with normalized coords; cb(x, y, u, v) -> value.
function fill(ctx, S, cb) {
  const n = ctx.n;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++)
    S.h[y * n + x] = cb(x, y, x / (n - 1), y / (n - 1));
}

export const LAYERS_PRIMITIVE = [
  L(1, 'constant', 'Constant', 'Flat value everywhere.', [
    P('value', 'Value', 0, 1, 0.005, 0.5),
  ], (ctx, p, S) => S.h.fill(p.value)),
  L(2, 'perlin', 'Perlin', 'Classic Perlin gradient noise.', [
    FREQ, P('oct', 'Octaves', 1, 8, 1, 4), P('lac', 'Lacunarity', 1.2, 4, 0.05, 2), P('gain', 'Gain', 0.1, 0.9, 0.05, 0.5), SEED,
  ], (ctx, p, S) => fill(ctx, S, (x, y, u, v) =>
    clamp(fbm(perlin, u * p.freq, v * p.freq, { octaves: p.oct, lacunarity: p.lac, gain: p.gain, seed: p.seed, signed: true })))),
  L(3, 'simplex', 'Simplex', 'Simplex gradient noise.', [
    FREQ, P('oct', 'Octaves', 1, 8, 1, 4), P('lac', 'Lacunarity', 1.2, 4, 0.05, 2), P('gain', 'Gain', 0.1, 0.9, 0.05, 0.5), SEED,
  ], (ctx, p, S) => fill(ctx, S, (x, y, u, v) =>
    clamp(fbm(simplex, u * p.freq, v * p.freq, { octaves: p.oct, lacunarity: p.lac, gain: p.gain, seed: p.seed, signed: true })))),
  L(4, 'value-noise', 'Value Noise', 'Blocky interpolated lattice noise.', [
    FREQ, P('oct', 'Octaves', 1, 8, 1, 3), P('lac', 'Lacunarity', 1.2, 4, 0.05, 2), P('gain', 'Gain', 0.1, 0.9, 0.05, 0.5), SEED,
  ], (ctx, p, S) => fill(ctx, S, (x, y, u, v) =>
    fbm(valueNoise, u * p.freq, v * p.freq, { octaves: p.oct, lacunarity: p.lac, gain: p.gain, seed: p.seed }))),
  L(5, 'voronoi-f1', 'Voronoi (F1)', 'Distance to nearest cell center.', [
    FREQ, P('jitter', 'Jitter', 0, 1, 0.05, 1), SEED,
  ], (ctx, p, S) => fill(ctx, S, (x, y, u, v) =>
    clamp(worley(u * p.freq, v * p.freq, p.seed, p.jitter)[0]))),
  L(6, 'voronoi-f2', 'Voronoi (F2)', 'Distance to second-closest cell.', [
    FREQ, P('jitter', 'Jitter', 0, 1, 0.05, 1), SEED,
  ], (ctx, p, S) => fill(ctx, S, (x, y, u, v) =>
    clamp(worley(u * p.freq, v * p.freq, p.seed, p.jitter)[1] * 0.7))),
  L(7, 'voronoi-f3', 'Voronoi (F3)', 'Distance to third-closest cell.', [
    FREQ, P('jitter', 'Jitter', 0, 1, 0.05, 1), SEED,
  ], (ctx, p, S) => fill(ctx, S, (x, y, u, v) =>
    clamp(worley(u * p.freq, v * p.freq, p.seed, p.jitter)[2] * 0.55))),
  L(8, 'voronoi-f4', 'Voronoi (F4)', 'Distance to fourth-closest cell.', [
    FREQ, P('jitter', 'Jitter', 0, 1, 0.05, 1), SEED,
  ], (ctx, p, S) => fill(ctx, S, (x, y, u, v) =>
    clamp(worley(u * p.freq, v * p.freq, p.seed, p.jitter)[3] * 0.45))),
  L(9, 'voronoi-crackle', 'Voronoi Crackle', 'Edge-based crackle (F2−F1).', [
    FREQ, P('jitter', 'Jitter', 0, 1, 0.05, 1), P('sharp', 'Sharpness', 0.5, 4, 0.1, 1.5), SEED,
  ], (ctx, p, S) => fill(ctx, S, (x, y, u, v) =>
    clamp(1 - voronoiCrackle(u * p.freq, v * p.freq, p.seed, p.jitter) * 2 * p.sharp + (1 - p.sharp) * 0.5))),
  L(10, 'worley', 'Worley', 'Worley distance noise (F2−F1 veins + cells).', [
    FREQ, P('mode', 'Mode', 0, 2, 1, 0, 'enum', 'Cells|Veins|Crystals'), P('jitter', 'Jitter', 0, 1, 0.05, 1), SEED,
  ], (ctx, p, S) => fill(ctx, S, (x, y, u, v) => {
    const [f1, f2, , , idv] = worley(u * p.freq, v * p.freq, p.seed, p.jitter);
    if (p.mode === 0) return clamp(f1);
    if (p.mode === 1) return clamp(1 - (f2 - f1) * 2.2);
    return clamp(idv * 0.65 + f1 * 0.35);
  })),
  L(11, 'cellular', 'Cellular', 'Cellular-automata diffusion pattern.', [
    P('freq', 'Frequency', 2, 128, 1, 32), P('steps', 'Steps', 1, 8, 1, 4), SEED,
  ], (ctx, p, S) => fill(ctx, S, (x, y, u, v) =>
    cellular(u * p.freq, v * p.freq, p.seed, p.steps))),
  L(12, 'gabor', 'Gabor', 'Directional Gabor kernels (anisotropic).', [
    FREQ, P('angle', 'Angle', 0, 180, 1, 35, '°'), P('band', 'Bandwidth', 0.3, 3, 0.1, 1.2), P('freq2', 'Kernel freq', 0.5, 8, 0.1, 3), SEED,
  ], (ctx, p, S) => fill(ctx, S, (x, y, u, v) =>
    gabor(u * p.freq, v * p.freq, p.seed, p.freq2, (p.angle * Math.PI) / 180, p.band))),
  L(13, 'sparse-conv', 'Sparse Convolution', 'Sparse impulses convolved with a kernel.', [
    FREQ, P('density', 'Density', 1, 12, 1, 5), P('kernel', 'Kernel', 0, 2, 1, 0, 'enum', 'Gaussian|Ring|Cone'), SEED,
  ], (ctx, p, S) => fill(ctx, S, (x, y, u, v) =>
    sparseConv(u * p.freq, v * p.freq, p.seed, p.density, p.kernel))),
  L(14, 'wavelet', 'Wavelet', 'Band-limited wavelet noise.', [
    FREQ, P('oct', 'Octaves', 1, 6, 1, 4), SEED,
  ], (ctx, p, S) => fill(ctx, S, (x, y, u, v) =>
    wavelet(u * p.freq, v * p.freq, p.seed, p.oct))),
  L(15, 'fbm', 'fBm (Fractal Brownian Motion)', 'Layered value-noise octaves.', [
    FREQ, P('oct', 'Octaves', 1, 10, 1, 5), P('lac', 'Lacunarity', 1.2, 4, 0.05, 2), P('gain', 'Gain', 0.1, 0.9, 0.05, 0.5), SEED,
  ], (ctx, p, S) => fill(ctx, S, (x, y, u, v) =>
    fbm(valueNoise, u * p.freq, v * p.freq, { octaves: p.oct, lacunarity: p.lac, gain: p.gain, seed: p.seed }))),
  L(16, 'ridged', 'Ridged Multifractal', 'Sharp-crested ridged fractal.', [
    FREQ, P('oct', 'Octaves', 1, 10, 1, 5), P('lac', 'Lacunarity', 1.2, 4, 0.05, 2.1), P('gain', 'Gain', 0.1, 0.9, 0.05, 0.5), P('sharp', 'Sharpness', 0.5, 4, 0.1, 2), SEED,
  ], (ctx, p, S) => fill(ctx, S, (x, y, u, v) =>
    ridged(perlin, u * p.freq, v * p.freq, { octaves: p.oct, lacunarity: p.lac, gain: p.gain, seed: p.seed, sharp: p.sharp }))),
  L(17, 'billow', 'Billow', 'Puffy billow fractal (abs value).', [
    FREQ, P('oct', 'Octaves', 1, 10, 1, 5), P('lac', 'Lacunarity', 1.2, 4, 0.05, 2), P('gain', 'Gain', 0.1, 0.9, 0.05, 0.5), SEED,
  ], (ctx, p, S) => fill(ctx, S, (x, y, u, v) =>
    billow(perlin, u * p.freq, v * p.freq, { octaves: p.oct, lacunarity: p.lac, gain: p.gain, seed: p.seed }))),
  L(18, 'swiss', 'Swiss', 'Swiss-cheese fractal (fbm minus holes).', [
    FREQ, P('oct', 'Octaves', 1, 8, 1, 4), P('lac', 'Lacunarity', 1.2, 4, 0.05, 2), P('gain', 'Gain', 0.1, 0.9, 0.05, 0.5), SEED,
  ], (ctx, p, S) => fill(ctx, S, (x, y, u, v) =>
    swiss(valueNoise, u * p.freq, v * p.freq, { octaves: p.oct, lacunarity: p.lac, gain: p.gain, seed: p.seed }))),
  L(19, 'jordan', 'Jordan', 'Warped ridged fractal (gradient-perturbed).', [
    FREQ, P('oct', 'Octaves', 1, 8, 1, 5), P('lac', 'Lacunarity', 1.2, 4, 0.05, 2), P('gain', 'Gain', 0.1, 0.9, 0.05, 0.5), P('warp', 'Warp', 0, 1, 0.05, 0.35), SEED,
  ], (ctx, p, S) => fill(ctx, S, (x, y, u, v) =>
    jordan(perlin, u * p.freq, v * p.freq, { octaves: p.oct, lacunarity: p.lac, gain: p.gain, seed: p.seed, warp: p.warp }))),
  L(20, 'random', 'Random', 'White noise / random values.', [
    P('scale', 'Grain', 1, 16, 1, 1, 'px', 'Pixel block size'), SEED,
  ], (ctx, p, S) => {
    const n = ctx.n, rnd = mulberry32(p.seed * 7919 + 11);
    const blocks = new Map();
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const bx = (x / p.scale) | 0, by = (y / p.scale) | 0;
      const k = by * 100000 + bx;
      if (!blocks.has(k)) blocks.set(k, rnd());
      S.h[y * n + x] = blocks.get(k);
    }
    void hash2;
  }),
  L(21, 'grid', 'Grid', 'Grid line pattern.', [
    P('freq', 'Cells', 1, 64, 1, 12), P('width', 'Line width', 0.01, 0.5, 0.01, 0.08), P('invert', 'Invert', 0, 1, 1, 0),
  ], (ctx, p, S) => fill(ctx, S, (x, y, u, v) => {
    const g = patGrid(u * p.freq, v * p.freq, { width: p.width });
    return p.invert ? 1 - g : g;
  })),
  L(22, 'hexagonal', 'Hexagonal', 'Hex grid pattern.', [
    P('freq', 'Cells', 1, 64, 1, 10), P('invert', 'Invert', 0, 1, 1, 0),
  ], (ctx, p, S) => fill(ctx, S, (x, y, u, v) => {
    const g = patHex(u * p.freq, v * p.freq);
    return p.invert ? 1 - g : g;
  })),
  L(23, 'brick', 'Brick', 'Brick courses with mortar.', [
    P('freq', 'Courses', 1, 64, 1, 10), P('mortar', 'Mortar', 0.01, 0.4, 0.01, 0.07), P('ratio', 'Brick ratio', 0.5, 3, 0.1, 2),
  ], (ctx, p, S) => fill(ctx, S, (x, y, u, v) =>
    patBrick(u * p.freq * p.ratio * 0.5, v * p.freq * 0.5, { mortar: p.mortar }))),
  L(24, 'checker', 'Checker', 'Checkerboard.', [
    P('freq', 'Cells', 1, 64, 1, 8), P('soft', 'Softness', 0, 0.5, 0.01, 0),
  ], (ctx, p, S) => fill(ctx, S, (x, y, u, v) => {
    const c = patChecker(u * p.freq, v * p.freq);
    if (p.soft <= 0) return c;
    const fx = (((u * p.freq) % 1) + 1) % 1, fy = (((v * p.freq) % 1) + 1) % 1;
    const d = Math.min(fx, 1 - fx, fy, 1 - fy);
    const e = clamp(d / p.soft, 0, 1);
    return c ? e : 1 - e;
  })),
  L(25, 'stripes', 'Stripes', 'Parallel stripes.', [
    P('freq', 'Stripes', 1, 64, 1, 12), P('angle', 'Angle', 0, 180, 1, 0, '°'), P('width', 'Width', 0.05, 0.95, 0.05, 0.5), P('soft', 'Softness', 0, 0.5, 0.01, 0),
  ], (ctx, p, S) => fill(ctx, S, (x, y, u, v) => {
    const t = (((u * Math.cos(p.angle * Math.PI / 180) + v * Math.sin(p.angle * Math.PI / 180)) * p.freq) % 1 + 1) % 1;
    if (p.soft <= 0) return t < p.width ? 1 : 0;
    const dOn = Math.min(Math.abs(t - p.width / 2), 1 - Math.abs(t - p.width / 2));
    return clamp((p.width / 2 - dOn) / Math.max(1e-3, p.soft) + 0.5, 0, 1) > 0.5 ? 1 : clamp((p.width / 2 - dOn) / Math.max(1e-3, p.soft) + 0.5, 0, 1);
  })),
  L(26, 'sine', 'Sine', 'Sine wave field.', [
    P('freq', 'Frequency', 0.5, 64, 0.5, 6), P('angle', 'Angle', 0, 180, 1, 0, '°'),
  ], (ctx, p, S) => fill(ctx, S, (x, y, u, v) =>
    waveSine(u, v, { angle: (p.angle * Math.PI) / 180, freq: p.freq }))),
  L(27, 'sawtooth', 'Sawtooth', 'Sawtooth ramp wave.', [
    P('freq', 'Frequency', 0.5, 64, 0.5, 6), P('angle', 'Angle', 0, 180, 1, 0, '°'),
  ], (ctx, p, S) => fill(ctx, S, (x, y, u, v) =>
    waveSaw(u, v, { angle: (p.angle * Math.PI) / 180, freq: p.freq }))),
  L(28, 'triangle-wave', 'Triangle Wave', 'Triangle wave field.', [
    P('freq', 'Frequency', 0.5, 64, 0.5, 6), P('angle', 'Angle', 0, 180, 1, 0, '°'),
  ], (ctx, p, S) => fill(ctx, S, (x, y, u, v) =>
    waveTri(u, v, { angle: (p.angle * Math.PI) / 180, freq: p.freq }))),
];
void patStripes;
