// Blend/combiner math (129-152), filters/modifiers (95-128), and spatial transforms (204-216).
import { clamp01, clamp, boxBlur, gaussBlur, slopeOf, curvatureOf, sample, minmax, normalize, make, gradient } from './grid.js';
import { fbm, perlin } from './noise.js';

// ---------- Combiners / blend modes (layer `top` over `base`) ----------
const EPS = 1e-6;
const overlay = (a, b) => (a < 0.5 ? 2 * a * b : 1 - 2 * (1 - a) * (1 - b));
const softLight = (a, b) => (b <= 0.5 ? a - (1 - 2 * b) * a * (1 - a) : a + (2 * b - 1) * (Math.sqrt(a) - a));
export const BLEND = {
  129: (a, b) => a + b,                               // Add
  130: (a, b) => a - b,                               // Subtract
  131: (a, b) => a * b,                               // Multiply
  132: (a, b) => a / (b + EPS),                       // Divide
  133: (a, b) => Math.max(a, b),                      // Max
  134: (a, b) => Math.min(a, b),                      // Min
  135: (a, b) => (a + b) / 2,                         // Average
  136: (a, b) => b,                                   // Blend (linear, opacity-weighted)
  137: (a, b) => overlay(a, b),                       // Overlay
  138: (a, b) => 1 - (1 - a) * (1 - b),               // Screen
  139: (a, b) => Math.min(a, b),                      // Darken
  140: (a, b) => Math.max(a, b),                      // Lighten
  141: (a, b) => Math.abs(a - b),                     // Difference
  142: (a, b) => a + b - 2 * a * b,                   // Exclusion
  143: (a, b) => softLight(a, b),                     // Soft Light
  144: (a, b) => overlay(b, a),                       // Hard Light
  145: (a, b) => a / (1 - b + EPS),                   // Color Dodge
  146: (a, b) => 1 - (1 - a) / (b + EPS),             // Color Burn
  147: (a, b) => a + b,                               // Linear Dodge
  148: (a, b) => a + b - 1,                           // Linear Burn
  149: (a, b) => (b < 0.5 ? 1 - (1 - a) / (2 * b + EPS) : a / (2 * (1 - b) + EPS)), // Vivid Light
  150: (a, b) => a + 2 * b - 1,                       // Linear Light
  151: (a, b) => (b < 0.5 ? Math.min(a, 2 * b) : Math.max(a, 2 * b - 1)), // Pin Light
  152: (a, b) => (a + b >= 1 ? 1 : 0),                // Hard Mix
};
export const blendValue = (mode, a, b) => {
  const f = BLEND[mode] || BLEND[136];
  return clamp01(f(a, b));
};
// Blend two whole fields with an optional per-pixel weight (0..1).
export function blendFields(mode, base, top, weight) {
  const out = new Float32Array(base.length);
  for (let i = 0; i < base.length; i++) {
    const w = weight ? weight[i] : 1;
    const v = blendValue(mode, base[i], top[i]);
    out[i] = base[i] + (v - base[i]) * w;
  }
  return out;
}

// ---------- Filters / modifiers (95-128) ----------
function map(src, f) { const o = new Float32Array(src.length); for (let i = 0; i < src.length; i++) o[i] = f(src[i], i); return o; }
function localFilter(src, N, r, reduce) {
  const out = new Float32Array(src.length), buf = [];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    buf.length = 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const xx = clamp(x + dx, 0, N - 1), yy = clamp(y + dy, 0, N - 1);
      buf.push(src[yy * N + xx]);
    }
    out[y * N + x] = reduce(buf);
  }
  return out;
}
const median = (b) => { b.sort((p, q) => p - q); return b[b.length >> 1]; };
const quantize = (v, n) => Math.round(v * (n - 1)) / (n - 1);
const cdfEqualize = (src) => {
  const bins = 512, hist = new Float64Array(bins);
  for (const v of src) hist[Math.min(bins - 1, Math.max(0, Math.floor(clamp01(v) * bins)))]++;
  const cdf = new Float64Array(bins); let acc = 0;
  for (let i = 0; i < bins; i++) { acc += hist[i]; cdf[i] = acc / src.length; }
  return map(src, (v) => cdf[Math.min(bins - 1, Math.max(0, Math.floor(clamp01(v) * bins)))]);
};
// Curve presets for Curves node.
const CURVES = {
  scurve: (t) => t * t * (3 - 2 * t),
  easein: (t) => t * t,
  easeout: (t) => 1 - (1 - t) * (1 - t),
  inverse: (t) => 0.5 - Math.sin(Math.asin(1 - 2 * t) / 3),
};

export const FILTERS = {
  95: (h, N, p) => gaussBlur(h, N, p.radius ?? 3),
  96: (h, N, p) => boxBlur(h, N, Math.max(1, Math.round(p.radius ?? 3))),
  97: (h, N, p) => { // radial blur toward centre
    const cx = (p.centerX ?? 0.5) * N, cy = (p.centerY ?? 0.5) * N, s = p.strength ?? 0.3, steps = 8;
    const out = new Float32Array(h.length);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let acc = 0;
      for (let k = 0; k < steps; k++) {
        const t = (k / steps) * s;
        acc += sample(h, N, x + (cx - x) * t, y + (cy - y) * t);
      }
      out[y * N + x] = acc / steps;
    }
    return out;
  },
  98: (h, N, p) => { const b = gaussBlur(h, N, 1.5); return map(h, (v, i) => v + (p.amount ?? 0.5) * (v - b[i])); },
  99: (h, N, p) => { const b = gaussBlur(h, N, p.radius ?? 2); const t = p.threshold ?? 0.01; return map(h, (v, i) => { const d = v - b[i]; return Math.abs(d) > t ? v + (p.amount ?? 1) * d : v; }); },
  100: (h, N, p) => localFilter(h, N, Math.max(1, Math.round(p.radius ?? 1)), median),
  101: (h, N, p) => localFilter(h, N, Math.max(1, Math.round(p.radius ?? 1)), (b) => Math.max(...b)),
  102: (h, N, p) => localFilter(h, N, Math.max(1, Math.round(p.radius ?? 1)), (b) => Math.min(...b)),
  103: (h, N, p) => { const b = boxBlur(h, N, 1); return map(h, (v, i) => v + ((b[i] - v) * (p.amount ?? 0.5))); },
  104: (h, N, p) => { const big = gaussBlur(h, N, p.radius ?? 8); return map(h, (v, i) => v + (p.amount ?? 0.5) * (v - big[i])); },
  105: (h, N, p) => map(h, (v) => clamp01((v - 0.5) * (p.amount ?? 1.5) + 0.5)),
  106: (h, N, p) => map(h, (v) => clamp01(v + (p.amount ?? 0.1))),
  107: (h, N, p) => map(h, (v) => Math.pow(clamp01(v), p.gamma ?? 1)),
  108: (h, N, p) => { // levels
    const lo = p.inLow ?? 0, hi = p.inHigh ?? 1, g = p.gamma ?? 1, ol = p.outLow ?? 0, oh = p.outHigh ?? 1;
    return map(h, (v) => ol + (oh - ol) * Math.pow(clamp01((v - lo) / Math.max(EPS, hi - lo)), g));
  },
  109: (h, N, p) => { const f = CURVES[p.curve ?? 'scurve'] || CURVES.scurve; return map(h, (v) => f(clamp01(v))); },
  110: (h) => h, // histogram: pass-through, stats computed by the stack
  111: (h) => cdfEqualize(h),
  112: (h) => normalize(h),
  113: (h) => map(h, (v) => 1 - v),
  114: (h) => map(h, (v) => Math.abs(2 * v - 1)),
  115: (h, N, p) => map(h, (v) => clamp(v, p.min ?? 0, p.max ?? 1)),
  116: (h, N, p) => { const a = p.inMin ?? 0, b = p.inMax ?? 1, c = p.outMin ?? 0, d = p.outMax ?? 1; return map(h, (v) => c + (d - c) * clamp01((v - a) / Math.max(EPS, b - a))); },
  117: (h, N, p) => { const s = Math.max(2, p.steps ?? 8), sm = p.smooth ?? 0.2; return map(h, (v) => { const q = v * s, f = Math.floor(q), t = q - f; const k = clamp01((t - 0.5 + sm / 2) / Math.max(EPS, sm)); return (f + k) / s; }); },
  118: (h, N, p) => map(h, (v) => quantize(clamp01(v), Math.max(2, p.levels ?? 8))),
  119: (h, N, p) => { const n = Math.max(2, p.levels ?? 6); return map(h, (v) => (Math.floor(clamp01(v) * n) + 0.5) / n); },
  120: (h, N, p) => { const b = gaussBlur(h, N, p.radius ?? 2); return map(h, (v, i) => clamp01(v + (p.amount ?? 1) * (v - b[i]) * 2)); },
  121: (h, N, p) => { const t = p.value ?? 0.5, a = p.amount ?? 0.5; const sl = slopeOf(h, N, 1); return map(h, (v, i) => v + (t - v) * a * (1 - sl[i])); },
  122: (h, N, p) => { // planar: least-squares plane fit, then blend toward it
    let sx = 0, sy = 0, sz = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0; const n = h.length;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const v = h[y * N + x]; const u = x / N, w = y / N; sx += u; sy += w; sz += v; sxx += u * u; syy += w * w; sxy += u * w; sxz += u * v; syz += w * v; }
    // solve 3x3 normal equations via Cramer's rule
    const A = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]], B = [sxz, syz, sz];
    const det = (M) => M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
    const D = det(A) || 1;
    const rep = (c) => { const M = A.map((r) => r.slice()); for (let k = 0; k < 3; k++) M[k][c] = B[k]; return det(M); };
    const a = rep(0) / D, b = rep(1) / D, c0 = rep(2) / D, t = p.amount ?? 1;
    return map(h, (v, i) => { const x = (i % N) / N, y = ((i / N) | 0) / N; const plane = a * x + b * y + c0; return v + (plane - v) * t; });
  },
};

// Filters that produce derived data (generators in the layer model).
export function derivedField(id, h, N, p) {
  switch (id) {
    case 123: { const s = slopeOf(h, N, p.heightScale ?? 1); return s; }
    case 124: { const { gx, gy } = gradient(h, N); return map(gx, (_, i) => 0.5 + 0.5 * Math.atan2(gy[i], gx[i]) / Math.PI); }
    case 125: return curvatureOf(h, N, p.radius ?? 2);
    case 126: return map(curvatureOf(h, N, p.radius ?? 2), (v) => 1 - v);
    case 127: { // local roughness = stddev in window
      const r = Math.max(1, Math.round(p.radius ?? 2)); const m = boxBlur(h, N, r); const m2 = boxBlur(map(h, (v) => v * v), N, r);
      const out = map(h, (_, i) => Math.sqrt(Math.max(0, m2[i] - m[i] * m[i])));
      return normalize(out);
    }
    case 128: return map(derivedField(127, h, N, p), (v) => 1 - v);
  }
  return null;
}

// ---------- Transforms (204-216): remap the whole stack state ----------
// coordFn(x, y) -> [sx, sy] in source cell coordinates.
export function remapChannel(src, N, coordFn, wrap = false) {
  const out = new Float32Array(src.length);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let [sx, sy] = coordFn(x, y);
    if (wrap) { sx = ((sx % N) + N) % N; sy = ((sy % N) + N) % N; }
    out[y * N + x] = sample(src, N, sx, sy);
  }
  return out;
}
export const TRANSFORMS = {
  204: (N, p) => (x, y) => [x - (p.dx ?? 0) * N, y - (p.dy ?? 0) * N],
  205: (N, p) => { const a = -((p.angle ?? 0) * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a), cx = N / 2; return (x, y) => { const dx = x - cx, dy = y - cx; return [dx * c - dy * s + cx, dx * s + dy * c + cx]; }; },
  206: (N, p) => { const k = p.factor ?? 1; const cx = N / 2; return (x, y) => [(x - cx) / k + cx, (y - cx) / k + cx]; },
  207: (N, p) => { const amt = (p.amount ?? 0.1) * N, s = p.scale ?? 3, sd = p.seed ?? 1; return (x, y) => { const u = x / N * s, v = y / N * s; return [x + amt * fbm(perlin, u, v, sd, 3), y + amt * fbm(perlin, u + 5.2, v + 1.3, sd + 3, 3)]; }; },
  208: (N, p) => { const amt = (p.amount ?? 0.2) * N, s = p.scale ?? 2, sd = p.seed ?? 1; return (x, y) => { const u = x / N * s, v = y / N * s; const q1 = fbm(perlin, u, v, sd, 3), q2 = fbm(perlin, u + 5.2, v + 1.3, sd + 3, 3); const r1 = fbm(perlin, u + 4 * q1, v + 4 * q2, sd + 7, 3); return [x + amt * r1, y + amt * (r1 * 0.5 - q1 * 0.5)]; }; },
  209: (N, p) => { const k = Math.max(1, p.count ?? 2); return (x, y) => [(x * k) % N, (y * k) % N]; },
  210: (N, p) => (x, y) => { const mx = p.axis === 'y' ? x : (x < N / 2 ? x : N - 1 - x); const my = p.axis === 'x' ? y : (y < N / 2 ? y : N - 1 - y); return p.axis === 'y' ? [x, my] : p.axis === 'x' ? [mx, y] : [mx, my]; },
  211: (N, p) => { const k = Math.max(1, p.count ?? 2); const ox = (p.dx ?? 0) * N; return (x, y) => [((x + ox) % (N / k)) * k, (y % (N / k)) * k]; },
  212: (N, p) => (x, y) => [p.axis === 'v' ? x : N - 1 - x, p.axis === 'h' ? y : N - 1 - y],
  213: (N, p) => { const s = clamp01(p.size ?? 0.5), x0 = (p.x ?? 0) * N * (1 - s), y0 = (p.y ?? 0) * N * (1 - s); return (x, y) => [x0 + x * s, y0 + y * s]; },
  214: (N, p) => { const f = Math.max(0.1, p.factor ?? 1); return (x, y) => [Math.floor(x * f) / f, Math.floor(y * f) / f]; },
  215: (N, p) => { const f = Math.max(0.1, p.factor ?? 1); return (x, y) => [x * f - (f - 1) * 0, y * f]; },
  216: (N, p) => (x, y) => [x + (p.dx ?? 0) * N, y + (p.dy ?? 0) * N],
};
