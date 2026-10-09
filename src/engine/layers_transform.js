// Slate — transforms #204–216. Spatial manipulation of height + color data.
import { clamp, bilinear, bilinearWrap } from './util.js';
import { perlin, fbm } from './noise.js';

const P = (k, label, min, max, step, def, unit = '', hint = '') =>
  ({ k, label, min, max, step, def, unit, hint, type: 'slider' });
const L = (n, id, name, desc, params, run, extra = {}) =>
  ({ n, id, name, cat: 'transform', desc, targets: ['height', 'alb'], params, run, ...extra });

// Remap helper: dst[i] = sample(src, mapX(x,y), mapY(x,y)).
function remap2(ctx, S, fn, wrap = false) {
  const n = ctx.n;
  const hs = Float32Array.from(S.h);
  const as = Float32Array.from(S.alb);
  const smp = wrap ? bilinearWrap : bilinear;
  // color sampler on demand
  const sampC = (x, y, c) => {
    if (!wrap) { x = clamp(x, 0, n - 1.001); y = clamp(y, 0, n - 1.001); }
    else { x = ((x % n) + n) % n; y = ((y % n) + n) % n; }
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const x1 = wrap ? (x0 + 1) % n : Math.min(n - 1, x0 + 1);
    const y1 = wrap ? (y0 + 1) % n : Math.min(n - 1, y0 + 1);
    const fx = x - x0, fy = y - y0;
    const g = (xx, yy) => as[(yy * n + xx) * 3 + c];
    return (g(x0, y0) * (1 - fx) + g(x1, y0) * fx) * (1 - fy) + (g(x0, y1) * (1 - fx) + g(x1, y1) * fx) * fy;
  };
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const [sx, sy] = fn(x, y);
    const i = y * n + x;
    S.h[i] = smp(hs, n, sx, sy);
    S.alb[i * 3] = sampC(sx, sy, 0);
    S.alb[i * 3 + 1] = sampC(sx, sy, 1);
    S.alb[i * 3 + 2] = sampC(sx, sy, 2);
  }
}

export const LAYERS_TRANSFORM = [
  L(204, 'translate', 'Translate', 'Move layer data by an offset.', [
    P('dx', 'X offset', -1, 1, 0.005, 0.1), P('dy', 'Y offset', -1, 1, 0.005, 0),
    P('wrap', 'Wrap edges', 0, 1, 1, 0),
  ], (ctx, p, S) => {
    const n = ctx.n, ox = p.dx * (n - 1), oy = p.dy * (n - 1);
    remap2(ctx, S, (x, y) => [x - ox, y - oy], !!p.wrap);
  }),
  L(205, 'rotate', 'Rotate', 'Rotate layer data about center.', [
    P('angle', 'Angle', -180, 180, 0.5, 15, '°'),
    P('x', 'Center X', 0, 1, 0.005, 0.5), P('y', 'Center Y', 0, 1, 0.005, 0.5),
  ], (ctx, p, S) => {
    const n = ctx.n, a = (-p.angle * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
    const cx = p.x * (n - 1), cy = p.y * (n - 1);
    remap2(ctx, S, (x, y) => [cx + (x - cx) * ca - (y - cy) * sa, cy + (x - cx) * sa + (y - cy) * ca]);
  }),
  L(206, 'scale', 'Scale', 'Scale layer data about center.', [
    P('scale', 'Scale', 0.1, 4, 0.01, 1.25), P('sx', 'X scale', 0.1, 4, 0.01, 1), P('sy', 'Y scale', 0.1, 4, 0.01, 1),
    P('x', 'Center X', 0, 1, 0.005, 0.5), P('y', 'Center Y', 0, 1, 0.005, 0.5),
  ], (ctx, p, S) => {
    const n = ctx.n, cx = p.x * (n - 1), cy = p.y * (n - 1);
    const zx = p.scale * p.sx, zy = p.scale * p.sy;
    remap2(ctx, S, (x, y) => [cx + (x - cx) / zx, cy + (y - cy) / zy]);
  }),
  L(207, 'warp', 'Warp', 'Directional smear warp along a vector field.', [
    P('angle', 'Angle', 0, 360, 1, 30, '°'), P('amount', 'Amount', 0, 60, 0.5, 12, 'px'),
    P('freq', 'Variation', 0.5, 24, 0.5, 5), P('seed', 'Seed', 0, 9999, 1, 71),
  ], (ctx, p, S) => {
    const n = ctx.n, a = (p.angle * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
    remap2(ctx, S, (x, y) => {
      const w = fbm(perlin, x / n * p.freq, y / n * p.freq, { octaves: 3, seed: p.seed, signed: true });
      return [x - ca * w * p.amount, y - sa * w * p.amount];
    });
  }),
  L(208, 'domain-warp', 'Domain Warp', 'Noise-based domain distortion (2-stage).', [
    P('amount', 'Amount', 0, 80, 0.5, 18, 'px'), P('freq', 'Frequency', 0.5, 24, 0.5, 4), P('seed', 'Seed', 0, 9999, 1, 72),
  ], (ctx, p, S) => {
    const n = ctx.n;
    remap2(ctx, S, (x, y) => {
      const u = x / n, v = y / n;
      const qx = fbm(perlin, u * p.freq + 5.2, v * p.freq + 1.3, { octaves: 3, seed: p.seed, signed: true });
      const qy = fbm(perlin, u * p.freq + 8.1, v * p.freq + 9.7, { octaves: 3, seed: p.seed + 7, signed: true });
      const wx = fbm(perlin, u * p.freq + qx * 1.5, v * p.freq + qy * 1.5, { octaves: 3, seed: p.seed + 13, signed: true });
      const wy = fbm(perlin, u * p.freq + qy * 1.5 + 3, v * p.freq + qx * 1.5 + 7, { octaves: 3, seed: p.seed + 29, signed: true });
      return [x - wx * p.amount, y - wy * p.amount];
    });
  }),
  L(209, 'tile', 'Tile', 'Tile / repeat pattern N×M.', [
    P('nx', 'Tiles X', 1, 8, 1, 2), P('ny', 'Tiles Y', 1, 8, 1, 2), P('mirror', 'Mirror alternate', 0, 1, 1, 0),
  ], (ctx, p, S) => {
    const n = ctx.n;
    remap2(ctx, S, (x, y) => {
      let u = (x / (n - 1)) * p.nx, v = (y / (n - 1)) * p.ny;
      if (p.mirror) {
        const ix = Math.floor(u), iy = Math.floor(v);
        u = ix % 2 ? 1 - (u - ix) : u - ix;
        v = iy % 2 ? 1 - (v - iy) : v - iy;
      } else { u = u % 1; v = v % 1; }
      return [u * (n - 1), v * (n - 1)];
    });
  }),
  L(210, 'mirror', 'Mirror', 'Mirror / flip about an axis.', [
    P('axis', 'Axis', 0, 2, 1, 0, 'enum', 'Horizontal|Vertical|Both'),
    P('pos', 'Position', 0, 1, 0.005, 0.5),
  ], (ctx, p, S) => {
    const n = ctx.n, c = p.pos * (n - 1);
    remap2(ctx, S, (x, y) => {
      let sx = x, sy = y;
      if (p.axis === 0 || p.axis === 2) { if (x > c) sx = 2 * c - x; }
      if (p.axis === 1 || p.axis === 2) { if (y > c) sy = 2 * c - y; }
      return [clamp(sx, 0, n - 1), clamp(sy, 0, n - 1)];
    });
  }),
  L(211, 'repeat', 'Repeat', 'Repeat with offset (echo tiling).', [
    P('nx', 'Tiles X', 1, 8, 1, 2), P('ny', 'Tiles Y', 1, 8, 1, 2),
    P('ox', 'Offset X', 0, 1, 0.01, 0.25), P('oy', 'Offset Y', 0, 1, 0.01, 0),
  ], (ctx, p, S) => {
    const n = ctx.n;
    remap2(ctx, S, (x, y) => {
      const u = (((x / (n - 1)) * p.nx + p.ox) % 1 + 1) % 1;
      const v = (((y / (n - 1)) * p.ny + p.oy) % 1 + 1) % 1;
      return [u * (n - 1), v * (n - 1)];
    });
  }),
  L(212, 'flip', 'Flip', 'Flip horizontal / vertical.', [
    P('mode', 'Mode', 0, 2, 1, 0, 'enum', 'Horizontal|Vertical|Both'),
  ], (ctx, p, S) => {
    const n = ctx.n;
    remap2(ctx, S, (x, y) => [
      (p.mode === 0 || p.mode === 2) ? n - 1 - x : x,
      (p.mode === 1 || p.mode === 2) ? n - 1 - y : y,
    ]);
  }),
  L(213, 'crop', 'Crop', 'Crop to a region (stretched back to full tile).', [
    P('x', 'Center X', 0, 1, 0.005, 0.5), P('y', 'Center Y', 0, 1, 0.005, 0.5),
    P('size', 'Size', 0.05, 1, 0.005, 0.6),
  ], (ctx, p, S) => {
    const n = ctx.n, cx = p.x * (n - 1), cy = p.y * (n - 1), half = (p.size * (n - 1)) / 2;
    remap2(ctx, S, (x, y) => [
      clamp(cx - half + (x / (n - 1)) * half * 2, 0, n - 1),
      clamp(cy - half + (y / (n - 1)) * half * 2, 0, n - 1),
    ]);
  }),
  L(214, 'resize', 'Resize', 'Resolution blur (in-place smooth upscale/downscale).', [
    P('factor', 'Factor', 0.1, 4, 0.05, 0.5, '×', 'Simulated resolution scale'),
  ], (ctx, p, S) => {
    // In a fixed-res stack this is the honest equivalent: low-pass at target res.
    const n = ctx.n;
    if (p.factor >= 0.99 && p.factor <= 1.01) return;
    const f = Math.max(1, Math.round(1 / Math.min(1, p.factor)));
    const hs = Float32Array.from(S.h);
    const small = Math.max(2, Math.round(n / f));
    const tmp = new Float32Array(small * small);
    for (let y = 0; y < small; y++) for (let x = 0; x < small; x++)
      tmp[y * small + x] = hs[Math.min(n - 1, Math.round((y / (small - 1)) * (n - 1))) * n + Math.min(n - 1, Math.round((x / (small - 1)) * (n - 1)))];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++)
      S.h[y * n + x] = bilinear(tmp, small, (x / (n - 1)) * (small - 1), (y / (n - 1)) * (small - 1));
  }, { targets: ['height'] }),
  L(215, 'resample', 'Resample', 'Resample to a coarser grid (pixelate).', [
    P('cells', 'Cells', 4, 512, 1, 64, '', 'Grid resolution across tile'),
    P('smooth', 'Smooth', 0, 1, 1, 0, '', 'Bilinear vs nearest'),
  ], (ctx, p, S) => {
    const n = ctx.n, m = clamp(Math.round(p.cells), 2, n);
    const hs = Float32Array.from(S.h), as = Float32Array.from(S.alb);
    const gx = (x) => (x / (n - 1)) * (m - 1), gy = (y) => (y / (n - 1)) * (m - 1);
    const cell = new Float32Array(m * m), cellC = new Float32Array(m * m * 3);
    for (let y = 0; y < m; y++) for (let x = 0; x < m; x++) {
      const sx = Math.min(n - 1, Math.round((x / (m - 1)) * (n - 1)));
      const sy = Math.min(n - 1, Math.round((y / (m - 1)) * (n - 1)));
      cell[y * m + x] = hs[sy * n + sx];
      cellC[(y * m + x) * 3] = as[(sy * n + sx) * 3];
      cellC[(y * m + x) * 3 + 1] = as[(sy * n + sx) * 3 + 1];
      cellC[(y * m + x) * 3 + 2] = as[(sy * n + sx) * 3 + 2];
    }
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const i = y * n + x;
      if (p.smooth) {
        S.h[i] = bilinear(cell, m, gx(x), gy(y));
        for (let c = 0; c < 3; c++) {
          const X = clamp(gx(x), 0, m - 1.001), Y = clamp(gy(y), 0, m - 1.001);
          const x0 = Math.floor(X), y0 = Math.floor(Y), x1 = Math.min(m - 1, x0 + 1), y1 = Math.min(m - 1, y0 + 1);
          const fx = X - x0, fy = Y - y0, g = (xx, yy) => cellC[(yy * m + xx) * 3 + c];
          S.alb[i * 3 + c] = (g(x0, y0) * (1 - fx) + g(x1, y0) * fx) * (1 - fy) + (g(x0, y1) * (1 - fx) + g(x1, y1) * fx) * fy;
        }
      } else {
        const cx = clamp(Math.round(gx(x)), 0, m - 1), cy = clamp(Math.round(gy(y)), 0, m - 1);
        S.h[i] = cell[cy * m + cx];
        S.alb[i * 3] = cellC[(cy * m + cx) * 3];
        S.alb[i * 3 + 1] = cellC[(cy * m + cx) * 3 + 1];
        S.alb[i * 3 + 2] = cellC[(cy * m + cx) * 3 + 2];
      }
    }
  }),
  L(216, 'offset', 'Offset', 'Offset with wrap (toroidal shift).', [
    P('dx', 'X offset', -1, 1, 0.005, 0.25), P('dy', 'Y offset', -1, 1, 0.005, 0.25),
  ], (ctx, p, S) => {
    const n = ctx.n, ox = p.dx * n, oy = p.dy * n;
    remap2(ctx, S, (x, y) => [x - ox, y - oy], true);
  }),
];
