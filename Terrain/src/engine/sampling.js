// Coordinate helpers. Two conventions are used by layers:
//   lattice(ctx, p): (u, v) in noise-lattice units, transformed by scale / offset / rotation. Used by noise.
//   unit(ctx, p):    (x, y) in [-1, 1] with the aspect fixed, transformed by offset / scale. Used by shapes.
import { fractal } from './noise.js';

export function fieldOf(N, fn) {
  const out = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) out[y * N + x] = fn(x, y, y * N + x);
  return out;
}

export function latticeFn(ctx, p) {
  const N = ctx.N, s = p.scale ?? 2;
  const ox = (p.offsetX ?? 0) * s, oy = (p.offsetY ?? 0) * s;
  const r = ((p.rotation ?? 0) * Math.PI) / 180, c = Math.cos(r), sn = Math.sin(r);
  return (x, y) => {
    const u = (x / (N - 1)) * 2 * s - s + ox;
    const v = (y / (N - 1)) * 2 * s - s + oy;
    return [u * c - v * sn, u * sn + v * c];
  };
}

export function unitFn(ctx, p) {
  const N = ctx.N, s = p.scale ?? 1;
  const ox = p.offsetX ?? 0, oy = p.offsetY ?? 0;
  const r = ((p.rotation ?? 0) * Math.PI) / 180, c = Math.cos(r), sn = Math.sin(r);
  return (x, y) => {
    const ux = ((x / (N - 1)) * 2 - 1 - ox) / s;
    const uy = ((y / (N - 1)) * 2 - 1 - oy) / s;
    return [ux * c - uy * sn, ux * sn + uy * c];
  };
}

// Fractal of an arbitrary base noise over the layer's lattice, normalised to [0, 1] by the caller.
export function fractalField(ctx, p, base, kind = 'fbm') {
  const lat = latticeFn(ctx, p);
  return fieldOf(ctx.N, (x, y) => {
    const [u, v] = lat(x, y);
    return fractal(base, u, v, p.seed ?? 1, p.octaves ?? 6, p.lacunarity ?? 2, p.gain ?? 0.5, kind);
  });
}

export function normalizeUnit(a) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < a.length; i++) { if (a[i] < lo) lo = a[i]; if (a[i] > hi) hi = a[i]; }
  const r = hi - lo || 1;
  for (let i = 0; i < a.length; i++) a[i] = (a[i] - lo) / r;
  return a;
}
