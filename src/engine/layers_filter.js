// Slate — filters / modifiers #95–128 (transform heightmap data).
import {
  clamp, lerp, smoothstep, histogram, bilinear, gaussBlur, boxBlur,
  slopeAspect, curvature,
} from './util.js';

const P = (k, label, min, max, step, def, unit = '', hint = '') =>
  ({ k, label, min, max, step, def, unit, hint, type: 'slider' });
const L = (n, id, name, desc, params, run, extra = {}) =>
  ({ n, id, name, cat: 'filter', desc, targets: ['height'], params, run, ...extra });

function morpho(f, n, radius, mode) {
  const r = Math.max(0, Math.round(radius));
  const out = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let m = mode === 'max' ? -Infinity : Infinity;
    for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) {
      const v = f[clamp(y + oy, 0, n - 1) * n + clamp(x + ox, 0, n - 1)];
      m = mode === 'max' ? Math.max(m, v) : Math.min(m, v);
    }
    out[y * n + x] = m;
  }
  return out;
}
function median(f, n, radius) {
  const r = Math.max(0, Math.round(radius));
  const out = new Float32Array(n * n), win = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    win.length = 0;
    for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++)
      win.push(f[clamp(y + oy, 0, n - 1) * n + clamp(x + ox, 0, n - 1)]);
    win.sort((a, b) => a - b);
    out[y * n + x] = win[win.length >> 1];
  }
  return out;
}
function localRough(f, n, radius) {
  const r = Math.max(1, Math.round(radius));
  const out = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let mn = Infinity, mx = -Infinity;
    for (let oy = -r; oy <= r; oy += 1) for (let ox = -r; ox <= r; ox += 1) {
      const v = f[clamp(y + oy, 0, n - 1) * n + clamp(x + ox, 0, n - 1)];
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    out[y * n + x] = mx - mn;
  }
  return out;
}

export const LAYERS_FILTER = [
  L(95, 'blur-gauss', 'Blur Gaussian', 'Gaussian blur smoothing.', [
    P('radius', 'Radius', 0, 24, 0.5, 3, 'px'),
  ], (ctx, p, S) => { S.h.set(gaussBlur(S.h, ctx.n, p.radius)); }),
  L(96, 'blur-box', 'Blur Box', 'Box / average blur.', [
    P('radius', 'Radius', 0, 24, 1, 3, 'px'), P('iters', 'Iterations', 1, 6, 1, 1),
  ], (ctx, p, S) => {
    let f = S.h;
    for (let i = 0; i < p.iters; i++) f = boxBlur(f, ctx.n, p.radius);
    S.h.set(f);
  }),
  L(97, 'blur-radial', 'Blur Radial', 'Radial (zoom) blur from center.', [
    P('x', 'Center X', 0, 1, 0.005, 0.5), P('y', 'Center Y', 0, 1, 0.005, 0.5),
    P('strength', 'Strength', 0, 1, 0.01, 0.3), P('samples', 'Samples', 2, 24, 1, 8),
  ], (ctx, p, S) => {
    const n = ctx.n, src = Float32Array.from(S.h);
    const cx = p.x * (n - 1), cy = p.y * (n - 1);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      let acc = 0;
      for (let s = 0; s < p.samples; s++) {
        const t = 1 - (s / p.samples) * p.strength * 0.5;
        acc += bilinear(src, n, cx + (x - cx) * t, cy + (y - cy) * t);
      }
      S.h[y * n + x] = acc / p.samples;
    }
  }),
  L(98, 'sharpen', 'Sharpen', 'Unsharp sharpening of relief.', [
    P('amount', 'Amount', 0, 3, 0.05, 0.8), P('radius', 'Radius', 0.5, 12, 0.5, 2, 'px'),
  ], (ctx, p, S) => {
    const b = gaussBlur(S.h, ctx.n, p.radius);
    for (let i = 0; i < S.h.length; i++) S.h[i] += (S.h[i] - b[i]) * p.amount;
  }),
  L(99, 'unsharp', 'Unsharp Mask', 'Unsharp mask with threshold.', [
    P('amount', 'Amount', 0, 3, 0.05, 0.7), P('radius', 'Radius', 0.5, 12, 0.5, 2.5, 'px'),
    P('threshold', 'Threshold', 0, 0.2, 0.002, 0.01),
  ], (ctx, p, S) => {
    const b = gaussBlur(S.h, ctx.n, p.radius);
    for (let i = 0; i < S.h.length; i++) {
      const d = S.h[i] - b[i];
      if (Math.abs(d) > p.threshold) S.h[i] += d * p.amount;
    }
  }),
  L(100, 'median', 'Median', 'Median filter (despeckle, keep edges).', [
    P('radius', 'Radius', 0, 6, 1, 1, 'px'),
  ], (ctx, p, S) => { if (p.radius > 0) S.h.set(median(S.h, ctx.n, p.radius)); }),
  L(101, 'dilate', 'Dilate', 'Morphological dilation (grow highs).', [
    P('radius', 'Radius', 0, 12, 1, 2, 'px'), P('iters', 'Iterations', 1, 6, 1, 1),
  ], (ctx, p, S) => {
    let f = S.h;
    for (let i = 0; i < p.iters; i++) f = morpho(f, ctx.n, p.radius, 'max');
    S.h.set(f);
  }),
  L(102, 'erode-morph', 'Erode Morphological', 'Morphological erosion (grow lows).', [
    P('radius', 'Radius', 0, 12, 1, 2, 'px'), P('iters', 'Iterations', 1, 6, 1, 1),
  ], (ctx, p, S) => {
    let f = S.h;
    for (let i = 0; i < p.iters; i++) f = morpho(f, ctx.n, p.radius, 'min');
    S.h.set(f);
  }),
  L(103, 'smooth', 'Smooth', 'General smoothing (neighbors average).', [
    P('amount', 'Amount', 0, 1, 0.02, 0.5), P('iters', 'Iterations', 1, 12, 1, 2),
  ], (ctx, p, S) => {
    const n = ctx.n;
    for (let it = 0; it < p.iters; it++) {
      const src = Float32Array.from(S.h);
      for (let y = 1; y < n - 1; y++) for (let x = 1; x < n - 1; x++) {
        const i = y * n + x;
        const avg = (src[i - 1] + src[i + 1] + src[i - n] + src[i + n]) * 0.25;
        S.h[i] = src[i] + (avg - src[i]) * p.amount;
      }
    }
  }),
  L(104, 'detail-enhance', 'Detail Enhance', 'Boost fine detail against a blurred base.', [
    P('amount', 'Amount', 0, 3, 0.05, 1), P('radius', 'Base radius', 1, 32, 1, 8, 'px'),
  ], (ctx, p, S) => {
    const b = gaussBlur(S.h, ctx.n, p.radius);
    for (let i = 0; i < S.h.length; i++) S.h[i] = clamp(S.h[i] + (S.h[i] - b[i]) * p.amount, -0.5, 1.5);
  }),
  L(105, 'contrast', 'Contrast', 'Contrast adjustment around a pivot.', [
    P('amount', 'Amount', 0, 3, 0.05, 1.2), P('pivot', 'Pivot', 0, 1, 0.01, 0.5),
  ], (ctx, p, S) => {
    for (let i = 0; i < S.h.length; i++) S.h[i] = (S.h[i] - p.pivot) * p.amount + p.pivot;
  }),
  L(106, 'brightness', 'Brightness', 'Brightness shift.', [
    P('amount', 'Amount', -0.5, 0.5, 0.005, 0.05),
  ], (ctx, p, S) => {
    for (let i = 0; i < S.h.length; i++) S.h[i] += p.amount;
  }),
  L(107, 'gamma', 'Gamma', 'Gamma correction.', [
    P('gamma', 'Gamma', 0.1, 4, 0.05, 1.4),
  ], (ctx, p, S) => {
    for (let i = 0; i < S.h.length; i++) S.h[i] = Math.pow(Math.max(0, S.h[i]), p.gamma);
  }),
  L(108, 'levels', 'Levels', 'Input/output levels with gamma.', [
    P('inLo', 'Input black', 0, 1, 0.005, 0), P('inHi', 'Input white', 0, 1, 0.005, 1),
    P('gamma', 'Gamma', 0.1, 4, 0.05, 1), P('outLo', 'Output black', 0, 1, 0.005, 0), P('outHi', 'Output white', 0, 1, 0.005, 1),
  ], (ctx, p, S) => {
    const r = Math.max(1e-5, p.inHi - p.inLo);
    for (let i = 0; i < S.h.length; i++) {
      const t = clamp((S.h[i] - p.inLo) / r);
      S.h[i] = p.outLo + Math.pow(t, p.gamma) * (p.outHi - p.outLo);
    }
  }),
  L(109, 'curves', 'Curves', 'Curve remapping through 5 knots.', [
    P('p0', 'Black point', 0, 1, 0.005, 0), P('p1', 'Shadows', 0, 1, 0.005, 0.25),
    P('p2', 'Midtones', 0, 1, 0.005, 0.5), P('p3', 'Highlights', 0, 1, 0.005, 0.75), P('p4', 'White point', 0, 1, 0.005, 1),
  ], (ctx, p, S) => {
    const xs = [0, 0.25, 0.5, 0.75, 1], ys = [p.p0, p.p1, p.p2, p.p3, p.p4];
    const lut = new Float32Array(256);
    for (let k = 0; k < 256; k++) {
      const t = k / 255;
      let seg = 0;
      while (seg < 3 && t > xs[seg + 1]) seg++;
      const f = smoothstep(xs[seg], xs[seg + 1], t);
      lut[k] = lerp(ys[seg], ys[seg + 1], f);
    }
    for (let i = 0; i < S.h.length; i++) S.h[i] = lut[clamp(Math.round(S.h[i] * 255), 0, 255)];
  }),
  L(110, 'histogram', 'Histogram', 'Analyze the distribution (passes height through).', [
    P('bins', 'Bins', 8, 128, 1, 32),
  ], (ctx, p, S) => {
    const H = histogram(S.h, p.bins);
    ctx.maps.histogram = H;
    ctx.layerResult = { histogram: H.bins, min: H.min, max: H.max };
  }),
  L(111, 'equalize', 'Equalize', 'Histogram equalization.', [
    P('strength', 'Strength', 0, 1, 0.02, 1),
  ], (ctx, p, S) => {
    const { bins, min, max } = histogram(S.h, 256);
    const cdf = new Float32Array(256);
    let acc = 0;
    const total = S.h.length;
    for (let i = 0; i < 256; i++) { acc += bins[i]; cdf[i] = acc / total; }
    const r = (max - min) || 1;
    for (let i = 0; i < S.h.length; i++) {
      const b = clamp(Math.round(((S.h[i] - min) / r) * 255), 0, 255);
      const eq = min + cdf[b] * (max - min);
      S.h[i] = lerp(S.h[i], eq, p.strength);
    }
  }),
  L(112, 'normalize', 'Normalize', 'Remap to 0–1 (min/max or percentiles).', [
    P('lo', 'Low %ile', 0, 50, 0.5, 0, '%'), P('hi', 'High %ile', 50, 100, 0.5, 100, '%'),
  ], (ctx, p, S) => {
    const sorted = Float32Array.from(S.h).sort();
    const lo = sorted[Math.floor((p.lo / 100) * (sorted.length - 1))];
    const hi = sorted[Math.floor((p.hi / 100) * (sorted.length - 1))];
    const r = (hi - lo) || 1;
    for (let i = 0; i < S.h.length; i++) S.h[i] = clamp((S.h[i] - lo) / r);
  }),
  L(113, 'invert', 'Invert', 'Invert values.', [], (ctx, p, S) => {
    for (let i = 0; i < S.h.length; i++) S.h[i] = 1 - S.h[i];
  }),
  L(114, 'abs', 'Abs', 'Absolute value around a pivot.', [
    P('pivot', 'Pivot', 0, 1, 0.01, 0.5),
  ], (ctx, p, S) => {
    for (let i = 0; i < S.h.length; i++) S.h[i] = Math.abs(S.h[i] - p.pivot) * 2;
  }),
  L(115, 'clamp', 'Clamp', 'Clamp to range.', [
    P('lo', 'Min', 0, 1, 0.005, 0), P('hi', 'Max', 0, 1, 0.005, 1),
  ], (ctx, p, S) => {
    for (let i = 0; i < S.h.length; i++) S.h[i] = clamp(S.h[i], Math.min(p.lo, p.hi), Math.max(p.lo, p.hi));
  }),
  L(116, 'remap', 'Remap', 'Remap value range with curve.', [
    P('inLo', 'From min', 0, 1, 0.005, 0), P('inHi', 'From max', 0, 1, 0.005, 1),
    P('outLo', 'To min', 0, 1, 0.005, 0), P('outHi', 'To max', 0, 1, 0.005, 1), P('curve', 'Curve', 0.1, 4, 0.05, 1),
  ], (ctx, p, S) => {
    const r = Math.max(1e-5, p.inHi - p.inLo);
    for (let i = 0; i < S.h.length; i++) {
      const t = clamp((S.h[i] - p.inLo) / r);
      S.h[i] = p.outLo + Math.pow(t, p.curve) * (p.outHi - p.outLo);
    }
  }),
  L(117, 'terrace', 'Terrace', 'Terracing / quantized steps with bevels.', [
    P('levels', 'Levels', 2, 32, 1, 8), P('bevel', 'Bevel', 0, 1, 0.02, 0.25), P('warp', 'Warp steps', 0, 1, 0.02, 0),
  ], (ctx, p, S) => {
    for (let i = 0; i < S.h.length; i++) {
      const t = clamp(S.h[i], 0, 1) * p.levels;
      const k = Math.floor(t), f = t - k;
      const e = smoothstep(1 - p.bevel, 1, f); // bevel near riser
      S.h[i] = (k + e * (1 - p.bevel * 0.5) + f * p.bevel * 0.5) / p.levels;
    }
  }),
  L(118, 'quantize', 'Quantize', 'Quantize to N levels (hard).', [
    P('levels', 'Levels', 2, 64, 1, 8),
  ], (ctx, p, S) => {
    for (let i = 0; i < S.h.length; i++)
      S.h[i] = clamp(Math.round(clamp(S.h[i], 0, 1) * (p.levels - 1)) / (p.levels - 1));
  }),
  L(119, 'posterize', 'Posterize', 'Posterize with gamma + dither.', [
    P('levels', 'Levels', 2, 32, 1, 5), P('gamma', 'Gamma', 0.2, 3, 0.05, 1), P('dither', 'Dither', 0, 0.1, 0.002, 0.01),
  ], (ctx, p, S) => {
    const n = ctx.n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const bayer = (((x & 1) << 1) | (y & 1)) / 4 - 0.375;
      const g = Math.pow(clamp(S.h[i], 0, 1), p.gamma) + bayer * p.dither;
      S.h[i] = clamp(Math.round(clamp(g, 0, 1) * (p.levels - 1)) / (p.levels - 1));
    }
  }),
  L(120, 'steepen', 'Steepen', 'Increase slope steepness (relief exaggeration).', [
    P('amount', 'Amount', 0, 3, 0.05, 1), P('radius', 'Base radius', 1, 32, 1, 6, 'px'),
  ], (ctx, p, S) => {
    const b = gaussBlur(S.h, ctx.n, p.radius);
    for (let i = 0; i < S.h.length; i++) S.h[i] = b[i] + (S.h[i] - b[i]) * (1 + p.amount);
  }),
  L(121, 'flatten', 'Flatten', 'Flatten toward a value.', [
    P('value', 'Value', 0, 1, 0.005, 0.4), P('amount', 'Amount', 0, 1, 0.01, 0.6),
  ], (ctx, p, S) => {
    for (let i = 0; i < S.h.length; i++) S.h[i] = lerp(S.h[i], p.value, p.amount);
  }),
  L(122, 'planar', 'Planar', 'Flatten toward a fitted plane.', [
    P('amount', 'Amount', 0, 1, 0.01, 0.7),
  ], (ctx, p, S) => {
    const n = ctx.n;
    // least-squares plane z = ax + by + c
    let sx = 0, sy = 0, sz = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, cnt = 0;
    const stride = Math.max(1, (n / 64) | 0);
    for (let y = 0; y < n; y += stride) for (let x = 0; x < n; x += stride) {
      const z = S.h[y * n + x];
      sx += x; sy += y; sz += z; sxx += x * x; syy += y * y; sxy += x * y; sxz += x * z; syz += y * z; cnt++;
    }
    void sxx; void syy; void sxy; void sxz; void syz;
    // Gradient-fit plane z = mz + gx*(x-mx) + gy*(y-my).
    const mx = sx / cnt, my = sy / cnt, mz = sz / cnt;
    let nx = 0, ny = 0, dx = 0, dy = 0;
    for (let y = 0; y < n; y += stride) for (let x = 0; x < n; x += stride) {
      nx += (x - mx) * (S.h[y * n + x] - mz); dx += (x - mx) * (x - mx);
      ny += (y - my) * (S.h[y * n + x] - mz); dy += (y - my) * (y - my);
    }
    const gx = dx > 1e-9 ? nx / dx : 0, gy = dy > 1e-9 ? ny / dy : 0;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const plane = mz + gx * (x - mx) + gy * (y - my);
      S.h[y * n + x] = lerp(S.h[y * n + x], plane, p.amount);
    }
  }),
  L(123, 'slope-map', 'Slope', 'Replace with slope map.', [
    P('scale', 'Scale', 0.2, 8, 0.1, 2),
  ], (ctx, p, S) => {
    const { slope } = slopeAspect(S.h, ctx.n);
    for (let i = 0; i < S.h.length; i++) S.h[i] = clamp(slope[i] * p.scale * 0.25);
  }),
  L(124, 'direction-map', 'Direction', 'Replace with aspect/direction map.', [], (ctx, p, S) => {
    const { aspect } = slopeAspect(S.h, ctx.n);
    for (let i = 0; i < S.h.length; i++) S.h[i] = aspect[i] / (Math.PI * 2);
  }),
  L(125, 'convexity-map', 'Convexity', 'Replace with convexity curvature map.', [
    P('scale', 'Scale', 0.5, 20, 0.5, 6),
  ], (ctx, p, S) => {
    const c = curvature(S.h, ctx.n);
    for (let i = 0; i < S.h.length; i++) S.h[i] = clamp(c[i] * p.scale * 0.5 + 0.5);
  }),
  L(126, 'concavity-map', 'Concavity', 'Replace with concavity curvature map.', [
    P('scale', 'Scale', 0.5, 20, 0.5, 6),
  ], (ctx, p, S) => {
    const c = curvature(S.h, ctx.n);
    for (let i = 0; i < S.h.length; i++) S.h[i] = clamp(-c[i] * p.scale * 0.5 + 0.5);
  }),
  L(127, 'roughness-map', 'Roughness', 'Replace with surface-roughness map.', [
    P('radius', 'Window', 1, 12, 1, 3, 'px'), P('scale', 'Scale', 0.5, 20, 0.5, 5),
  ], (ctx, p, S) => {
    const r = localRough(S.h, ctx.n, p.radius);
    for (let i = 0; i < S.h.length; i++) S.h[i] = clamp(r[i] * p.scale);
  }),
  L(128, 'smoothness-map', 'Smoothness', 'Replace with surface-smoothness map.', [
    P('radius', 'Window', 1, 12, 1, 3, 'px'), P('scale', 'Scale', 0.5, 20, 0.5, 5),
  ], (ctx, p, S) => {
    const r = localRough(S.h, ctx.n, p.radius);
    for (let i = 0; i < S.h.length; i++) S.h[i] = clamp(1 - r[i] * p.scale);
  }),
];
