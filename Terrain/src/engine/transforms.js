// 204-216 Transforms: spatial manipulation of the heightfield (translate, rotate, scale, warp, tile, mirror, ...).
// Each samples the incoming field at transformed coordinates with bilinear interpolation.
import { makeDef } from './def.js';
import { num, int, sel, seedParam } from './schema.js';
import { sampleBilinear, blurGauss, gradientXY } from './grid.js';
import { fieldOf } from './sampling.js';
import { perlin, fractal } from './noise.js';

const bil = (H, N, x, y) => sampleBilinear(H, N, x, y);
const wrap = (v, N) => ((v % N) + N) % N;
const centre = (N, p) => [(p.cx * 0.5 + 0.5) * (N - 1), (p.cy * 0.5 + 0.5) * (N - 1)];
const noiseField = (ctx, seed, scale, octaves) => {
  const N = ctx.N;
  const out = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = (x / (N - 1)) * 2 * scale, v = (y / (N - 1)) * 2 * scale;
    out[y * N + x] = fractal(perlin, u, v, seed, octaves, 2, 0.5);
  }
  return out;
};

export const transformDefs = [
  makeDef({
    id: 204, key: 'translate', name: 'Translate', cat: 'Transforms', params: [num('dx', 'Shift X (fraction)', 0.05, -1, 1, 0.001), num('dy', 'Shift Y (fraction)', 0, -1, 1, 0.001)],
    desc: 'Moves the terrain; edges are clamped.',
    run: (ctx, p) => {
      const N = ctx.N;
      return { height: fieldOf(N, (x, y) => bil(ctx.H, N, x - p.dx * N, y - p.dy * N)) };
    },
  }),
  makeDef({
    id: 205, key: 'rotate', name: 'Rotate', cat: 'Transforms', params: [num('angle', 'Angle [deg]', 15, -180, 180, 0.5)],
    desc: 'Rotates the terrain about its centre; corners are clamped.',
    run: (ctx, p) => {
      const N = ctx.N, c = N / 2, a = (p.angle * Math.PI) / 180, cs = Math.cos(a), sn = Math.sin(a);
      return { height: fieldOf(N, (x, y) => {
        const dx = x - c, dy = y - c;
        return bil(ctx.H, N, c + dx * cs + dy * sn, c - dx * sn + dy * cs);
      }) };
    },
  }),
  makeDef({
    id: 206, key: 'scale', name: 'Scale', cat: 'Transforms', params: [num('factor', 'Zoom', 1.25, 0.2, 4, 0.01), ...[num('cx', 'Centre X', 0, -1, 1, 0.01), num('cy', 'Centre Y', 0, -1, 1, 0.01)]],
    desc: 'Scales the terrain about a centre (zoom in > 1, zoom out < 1, edges clamped).',
    run: (ctx, p) => {
      const N = ctx.N, [cx, cy] = centre(N, p);
      return { height: fieldOf(N, (x, y) => bil(ctx.H, N, cx + (x - cx) / p.factor, cy + (y - cy) / p.factor)) };
    },
  }),
  makeDef({
    id: 207, key: 'warp', name: 'Warp', cat: 'Transforms', params: [num('amount', 'Amount (cells @256)', 12, 0, 80, 0.5), num('smooth', 'Gradient smoothing', 2, 0, 12, 0.1)],
    desc: 'Self-warp: the terrain displaces itself along its own gradient, bending ridges and valleys.',
    run: (ctx, p) => {
      const N = ctx.N, H = blurGauss(ctx.H, N, p.smooth + 0.01);
      const g = gradientXY(H, N), k = (p.amount * N) / 256;
      let gm = 1e-9;
      for (let i = 0; i < g.gx.length; i++) gm = Math.max(gm, Math.abs(g.gx[i]), Math.abs(g.gy[i]));
      return { height: fieldOf(N, (x, y, i) => bil(ctx.H, N, x - (g.gx[i] / gm) * k, y - (g.gy[i] / gm) * k)) };
    },
  }),
  makeDef({
    id: 208, key: 'domainWarp', name: 'Domain Warp', cat: 'Transforms', params: [num('amount', 'Amount (cells @256)', 16, 0, 80, 0.5), num('scale', 'Noise scale', 2, 0.2, 10, 0.05), int('octaves', 'Octaves', 4, 1, 8), seedParam(101)],
    desc: 'Noise-driven domain warp: the sampling domain is distorted by two fBm fields.',
    run: (ctx, p) => {
      const N = ctx.N, nx = noiseField(ctx, p.seed, p.scale, p.octaves), ny = noiseField(ctx, p.seed + 7, p.scale, p.octaves);
      const k = (p.amount * N) / 256;
      return { height: fieldOf(N, (x, y, i) => bil(ctx.H, N, x + nx[i] * k, y + ny[i] * k)) };
    },
  }),
  makeDef({
    id: 209, key: 'tile', name: 'Tile', cat: 'Transforms', params: [int('tilesX', 'Tiles X', 2, 1, 8), int('tilesY', 'Tiles Y', 2, 1, 8)],
    desc: 'Repeats the terrain as a tile grid; each tile shows the full field.',
    run: (ctx, p) => {
      const N = ctx.N;
      return { height: fieldOf(N, (x, y) => {
        const u = wrap((x / N) * p.tilesX, 1) * N, v = wrap((y / N) * p.tilesY, 1) * N;
        return bil(ctx.H, N, u, v);
      }) };
    },
  }),
  makeDef({
    id: 210, key: 'mirror', name: 'Mirror', cat: 'Transforms', params: [sel('axis', 'Axis', 'x', [['x', 'Left/right'], ['y', 'Top/bottom'], ['xy', 'Both']]), sel('half', 'Keep', 'first', [['first', 'First half'], ['second', 'Second half']])],
    desc: 'Mirrors the terrain across an axis, keeping one half as the source.',
    run: (ctx, p) => {
      const N = ctx.N;
      return { height: fieldOf(N, (x, y) => {
        let sx = x, sy = y;
        if (p.axis !== 'y') sx = p.half === 'first' ? (x < N / 2 ? x : N - 1 - x) : (x >= N / 2 ? x : N - 1 - x);
        if (p.axis !== 'x') sy = p.half === 'first' ? (y < N / 2 ? y : N - 1 - y) : (y >= N / 2 ? y : N - 1 - y);
        return ctx.H[Math.round(sy) * N + Math.round(sx)];
      }) };
    },
  }),
  makeDef({
    id: 211, key: 'repeat', name: 'Repeat', cat: 'Transforms', params: [int('count', 'Repeats across', 3, 1, 12), num('offset', 'Row offset', 0.5, 0, 1, 0.01)],
    desc: 'Repeats a strip with an offset on alternate rows (brick-like repetition).',
    run: (ctx, p) => {
      const N = ctx.N;
      return { height: fieldOf(N, (x, y) => {
        const row = Math.floor((y / N) * p.count);
        const u = wrap((x / N) * p.count + (row & 1 ? p.offset : 0), 1) * N;
        return bil(ctx.H, N, u, y);
      }) };
    },
  }),
  makeDef({
    id: 212, key: 'flip', name: 'Flip', cat: 'Transforms', params: [sel('axis', 'Axis', 'x', [['x', 'Horizontal'], ['y', 'Vertical']])],
    desc: 'Flips the terrain horizontally or vertically.',
    run: (ctx, p) => {
      const N = ctx.N;
      return { height: fieldOf(N, (x, y) => (p.axis === 'x' ? ctx.H[y * N + (N - 1 - x)] : ctx.H[(N - 1 - y) * N + x])) };
    },
  }),
  makeDef({
    id: 213, key: 'crop', name: 'Crop', cat: 'Transforms', params: [num('x0', 'Left', 0.25, 0, 0.99, 0.005), num('y0', 'Top', 0.25, 0, 0.99, 0.005), num('w', 'Width', 0.5, 0.01, 1, 0.005), num('h', 'Height', 0.5, 0.01, 1, 0.005)],
    desc: 'Crops to a region and stretches it back to full resolution.',
    run: (ctx, p) => {
      const N = ctx.N;
      const x0 = p.x0 * (N - 1), y0 = p.y0 * (N - 1), w = p.w * (N - 1), h = p.h * (N - 1);
      return { height: fieldOf(N, (x, y) => bil(ctx.H, N, x0 + (x / (N - 1)) * w, y0 + (y / (N - 1)) * h)) };
    },
  }),
  makeDef({
    id: 214, key: 'resize', name: 'Resize', cat: 'Transforms', params: [num('scale', 'Content scale', 0.8, 0.2, 2, 0.01), num('fill', 'Outside fill', 0, 0, 1, 0.01)],
    desc: 'Resizes the content inside the frame; areas outside the source are filled with a constant.',
    run: (ctx, p) => {
      const N = ctx.N, c = (N - 1) / 2;
      return { height: fieldOf(N, (x, y) => {
        const sx = c + (x - c) / p.scale, sy = c + (y - c) / p.scale;
        if (sx < 0 || sy < 0 || sx > N - 1 || sy > N - 1) return p.fill;
        return bil(ctx.H, N, sx, sy);
      }) };
    },
  }),
  makeDef({
    id: 215, key: 'resample', name: 'Resample', cat: 'Transforms', params: [num('factor', 'Resolution factor', 0.25, 0.05, 1, 0.01)],
    desc: 'Resamples through a coarser grid and back, discarding fine detail.',
    run: (ctx, p) => {
      const N = ctx.N, M = Math.max(4, Math.round(N * p.factor));
      const small = new Float32Array(M * M);
      for (let y = 0; y < M; y++) for (let x = 0; x < M; x++) small[y * M + x] = bil(ctx.H, N, (x / (M - 1)) * (N - 1), (y / (M - 1)) * (N - 1));
      return { height: fieldOf(N, (x, y) => bil(small, M, (x / (N - 1)) * (M - 1), (y / (N - 1)) * (M - 1))) };
    },
  }),
  makeDef({
    id: 216, key: 'offset', name: 'Offset', cat: 'Transforms', params: [num('dx', 'Shift X (fraction)', 0.1, -1, 1, 0.001), num('dy', 'Shift Y (fraction)', 0, -1, 1, 0.001)],
    desc: 'Offsets the terrain with wrap-around, so nothing is lost at the edges.',
    run: (ctx, p) => {
      const N = ctx.N;
      return { height: fieldOf(N, (x, y) => bil(ctx.H, N, wrap(x - p.dx * N, N), wrap(y - p.dy * N, N))) };
    },
  }),
];

