// Primitive generators (Gaea nodes 1-28), gradient and shape generators (29-52).
// Every generator returns a Float32Array in [0,1].
import * as N_ from './noise.js';
import { clamp01, smoothstep } from './grid.js';


const { perlin, simplex, valueNoise, voronoiDists, gaborNoise, sparseConv, waveletNoise, cellularField, fbm, hash2 } = N_;

// Build a field by calling fn(X,Y,u,v) for each pixel. X/Y are noise-space coords.
function field(N, p, fn) {
  const out = new Float32Array(N * N);
  const s = p.scale ?? 4, ox = p.offsetX ?? 0, oy = p.offsetY ?? 0;
  const rot = ((p.rotation ?? 0) * Math.PI) / 180, c = Math.cos(rot), sn = Math.sin(rot);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = (x + 0.5) / N, v = (y + 0.5) / N;
    const du = u - 0.5, dv = v - 0.5;
    const rx = du * c - dv * sn + 0.5, ry = du * sn + dv * c + 0.5;
    out[y * N + x] = fn(rx * s + ox, ry * s + oy, u, v);
  }
  return out;
}
const toUnit = (a, scale = 0.5) => { for (let i = 0; i < a.length; i++) a[i] = clamp01(0.5 + a[i] * scale); return a; };
const normUnit = (a) => {
  let mn = Infinity, mx = -Infinity;
  for (const v of a) { if (v < mn) mn = v; if (v > mx) mx = v; }
  const r = mx - mn || 1;
  for (let i = 0; i < a.length; i++) a[i] = (a[i] - mn) / r;
  return a;
};
const seedOf = (p) => p.seed ?? 1;
const oct = (p) => p.octaves ?? 6;
const lac = (p) => p.lacunarity ?? 2;
const gain = (p) => p.gain ?? 0.5;

const ridgedFbm = (p, N) => {
  const s = seedOf(p), o = oct(p);
  let amp = 1, sum = 0, norm = 0, w = 1;
  return field(N, p, (X, Y) => {
    amp = 1; sum = 0; norm = 0; w = 1;
    let f = 1;
    for (let k = 0; k < o; k++) {
      let r = 1 - Math.abs(perlin(X * f, Y * f, s + k * 17));
      r *= r; r *= w; w = Math.min(1, r * 2);
      sum += r * amp; norm += amp; amp *= gain(p); f *= lac(p);
    }
    return norm ? sum / norm : 0;
  });
};

// Voronoi F-n: n-th nearest feature distance.
const vor = (k) => (p, N) => normUnit(field(N, p, (X, Y) => voronoiDists(X, Y, seedOf(p), p.jitter ?? 1).d[k]));

export const PRIMITIVES = {
  1: (p, N) => new Float32Array(N * N).fill(p.value ?? 0.5),
  2: (p, N) => toUnit(field(N, p, (X, Y) => perlin(X, Y, seedOf(p))), 1),
  3: (p, N) => toUnit(field(N, p, (X, Y) => simplex(X, Y, seedOf(p))), 1),
  4: (p, N) => toUnit(field(N, p, (X, Y) => valueNoise(X, Y, seedOf(p))), 1),
  5: vor(0), 6: vor(1), 7: vor(2), 8: vor(3),
  9: (p, N) => normUnit(field(N, p, (X, Y) => { const d = voronoiDists(X, Y, seedOf(p), p.jitter ?? 1).d; return d[1] - d[0]; })),
  10: (p, N) => normUnit(field(N, p, (X, Y) => { const d = voronoiDists(X, Y, seedOf(p), p.jitter ?? 1).d; return d[0] * d[0] + 0.5 * d[0]; })),
  11: (p, N) => field(N, p, (X, Y) => (cellularField(X, Y, seedOf(p), 64) + 1) / 2),
  12: (p, N) => toUnit(field(N, p, (X, Y) => gaborNoise(X, Y, seedOf(p), (p.angle ?? 0) * Math.PI / 180)), 1),
  13: (p, N) => normUnit(field(N, p, (X, Y) => sparseConv(X, Y, seedOf(p)))),
  14: (p, N) => toUnit(field(N, p, (X, Y) => waveletNoise(X, Y, seedOf(p))), 1),
  15: (p, N) => toUnit(field(N, p, (X, Y) => fbm(perlin, X, Y, seedOf(p), oct(p), lac(p), gain(p))), 1),
  16: (p, N) => ridgedFbm(p, N),
  17: (p, N) => { const s = seedOf(p), o = oct(p); return normUnit(field(N, p, (X, Y) => fbm((x, y, sd) => Math.abs(perlin(x, y, sd)) * 2 - 1, X, Y, s, o, lac(p), gain(p)))); },
  18: (p, N) => { const s = seedOf(p), o = oct(p); return normUnit(field(N, p, (X, Y) => fbm((x, y, sd) => { const n = perlin(x + 0.7, y, sd); return 1 - Math.abs(n) * 1.6; }, X, Y, s, o, lac(p), gain(p)))); },
  19: (p, N) => { const s = seedOf(p), o = oct(p); return normUnit(field(N, p, (X, Y) => {
      const wx = fbm(perlin, X, Y, s + 5, 3), wy = fbm(perlin, X + 5.2, Y + 1.3, s + 9, 3);
      return fbm(perlin, X + 2 * wx, Y + 2 * wy, s, o, lac(p), gain(p));
    })); },
  20: (p, N) => { const s = seedOf(p); const out = new Float32Array(N * N); for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) out[y * N + x] = hash2(x, y, s); return out; },
  21: (p, N) => field(N, p, (X, Y) => { const w = p.lineWidth ?? 0.1; const fx = X - Math.floor(X), fy = Y - Math.floor(Y); return (fx < w || fy < w) ? 1 : 0; }),
  22: (p, N) => field(N, p, (X, Y) => { const q = X * 2 / Math.sqrt(3), r = Y - (X % 1) * 0.5; const fx = q - Math.floor(q) - 0.5, fy = r - Math.floor(r) - 0.5; return clamp01(1 - Math.hypot(fx, fy) * 2); }),
  23: (p, N) => field(N, p, (X, Y) => { const row = Math.floor(Y); const xx = X + (row & 1) * 0.5; const fx = xx - Math.floor(xx), fy = Y - row; const mortar = Math.min(fx, 1 - fx, fy, 1 - fy) < (p.lineWidth ?? 0.08) ? 1 : 0; return mortar; }),
  24: (p, N) => field(N, p, (X, Y) => ((Math.floor(X) + Math.floor(Y)) & 1 ? 1 : 0)),
  25: (p, N) => field(N, p, (X) => 0.5 + 0.5 * Math.sign(Math.sin(X * Math.PI * 2))),
  26: (p, N) => field(N, p, (X) => 0.5 + 0.5 * Math.sin(X * Math.PI * 2)),
  27: (p, N) => field(N, p, (X) => X - Math.floor(X)),
  28: (p, N) => field(N, p, (X) => 1 - Math.abs(((X % 1) + 1) % 1 * 2 - 1)),
};

// Gradients 29-32
const centered = (p, N, fn) => field(N, { ...p, scale: 1, offsetX: 0, offsetY: 0 }, (X, Y) => fn(X - 0.5, Y - 0.5));
export const GRADIENTS = {
  29: (p, N) => { const a = ((p.angle ?? 0) * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a); return centered(p, N, (x, y) => clamp01(0.5 + (x * c + y * s) * (p.extent ?? 1))); },
  30: (p, N) => centered(p, N, (x, y) => clamp01(1 - Math.hypot(x, y) * 2 * (p.extent ?? 1))),
  31: (p, N) => centered(p, N, (x, y) => ((Math.atan2(y, x) + Math.PI) / (2 * Math.PI) + (p.offset ?? 0)) % 1),
  32: (p, N) => centered(p, N, (x, y) => clamp01(1 - Math.max(Math.abs(x), Math.abs(y)) * 2 * (p.extent ?? 1))),
};

// Shape generators 33-52. Each is a self-contained landform.
const C = (p) => ({ cx: p.centerX ?? 0.5, cy: p.centerY ?? 0.5, r: p.radius ?? 0.35 });
const shapeField = (N, p, fn) => field(N, { ...p, scale: 1, offsetX: 0, offsetY: 0 }, (X, Y, u, v) => fn(u - (p.centerX ?? 0.5), v - (p.centerY ?? 0.5), u, v));
const bump = (d, r, soft) => clamp01(1 - smoothstep(r * (1 - soft), r, d));
const noise2 = (p, x, y) => fbm(perlin, x, y, seedOf(p) + 3, 4, 2, 0.5) * (p.detail ?? 0.15);

export const SHAPES = {
  33: (p, N) => { const { r } = C(p); return shapeField(N, p, (x, y) => { const d = Math.hypot(x, y) + noise2(p, x * 6, y * 6); return Math.sqrt(bump(d, r, 0.6)); }); },
  34: (p, N) => { const { r } = C(p); return shapeField(N, p, (x, y) => Math.sqrt(bump(Math.max(Math.abs(x), Math.abs(y)) + noise2(p, x * 6, y * 6), r, 0.6))); },
  35: (p, N) => { const { r } = C(p); return shapeField(N, p, (x, y) => { // equilateral triangle SDF-like distance
      const k = Math.sqrt(3); const px = Math.abs(x) - r; const py = y + r / k; let d = Math.max(px * k * 0.5 + (y * 0.5) * 1 , -y - r * 0.5) ; d = Math.max(Math.abs(x) * k * 0.5 + y * 0.5, -y) * 1.6 ; return Math.sqrt(bump(d + noise2(p, x * 6, y * 6), r * 0.7, 0.5)); }); },
  36: (p, N) => { const { r } = C(p); return shapeField(N, p, (x, y) => { const a = Math.atan2(y, x), d = Math.hypot(x, y); const rr = r * (0.55 + 0.45 * Math.abs(Math.cos(a * 2.5))); return Math.sqrt(bump(d + noise2(p, x * 6, y * 6) * 0.5, rr, 0.5)); }); },
  37: (p, N) => { const { r } = C(p); return shapeField(N, p, (x, y) => { const d = Math.hypot(x, y); const base = bump(d, r * 1.4, 1); const rid = (1 - Math.abs(fbm(perlin, x * 5, y * 5, seedOf(p), oct(p), 2, 0.5))) ** 2; return clamp01(base * (0.3 + 0.7 * rid) * (1 - smoothstep(0, r, d) * 0.3)); }); },
  38: (p, N) => { const { r } = C(p); return shapeField(N, p, (x, y) => { const d = Math.hypot(x, y); const cone = clamp01(1 - d / (r * 1.5)); const crater = smoothstep(0, r * 0.35, d) ; return clamp01(cone * (0.4 + 0.6 * crater) + noise2(p, x * 9, y * 9) * 0.2); }); },
  39: (p, N) => shapeField(N, p, (x, y) => { const d = Math.max(Math.abs(x), Math.abs(y)); return clamp01(smoothstep((p.radius ?? 0.4) , (p.radius ?? 0.4) - 0.1, d) * (p.height ?? 0.6) + noise2(p, x * 8, y * 8) * 0.1); }),
  40: (p, N) => shapeField(N, p, (x, y) => { const k = 2 * Math.PI / (p.wavelength ?? 0.12); const a = ((p.angle ?? 20) * Math.PI) / 180; const w = x * Math.cos(a) + y * Math.sin(a); return clamp01(0.5 + 0.5 * Math.sin(w * k + noise2(p, x * 3, y * 3) * 6) * (0.7 + 0.3 * fbm(perlin, x * 4, y * 4, seedOf(p), 3))); }),
  41: (p, N) => toUnit(field(N, p, (X, Y) => fbm(perlin, X, Y, seedOf(p), oct(p), lac(p), gain(p)) * 0.8 + 0.2 * Math.sin(X * 3 + Y * 2)), 1),
  42: (p, N) => field(N, p, (X, Y) => { const n = Math.abs(fbm(perlin, X, Y, seedOf(p), oct(p), lac(p), gain(p))); return clamp01(1 - n * 4); }),
  43: (p, N) => { const { r } = C(p); return shapeField(N, p, (x, y) => { const d = Math.hypot(x, y) / r; const bowl = clamp01(d) ** 2 * 0.5; const rim = Math.exp(-((d - 1) ** 2) * 14) * 0.6; return clamp01((d > 1 ? 0.5 * Math.exp(-(d - 1) * 4) : 0) + rim * 0.5 + bowl * (d < 1 ? 1 : 0) + noise2(p, x * 6, y * 6) * 0.2); }); },
  44: (p, N) => shapeField(N, p, (x, y) => { const w = p.width ?? 0.08; const along = x * Math.cos(-0.6) - y * Math.sin(-0.6); const across = x * Math.sin(-0.6) + y * Math.cos(-0.6); const wall = smoothstep(w, w * 2.2, Math.abs(across)); return clamp01(0.3 + 0.7 * wall + noise2(p, x * 6, y * 6) * 0.1 * wall + 0.1 * Math.sin(along * 20) * 0); }),
  45: (p, N) => toUnit(field(N, { ...p, scale: p.scale ?? 2 }, (X, Y) => 0.5 + 0.12 * fbm(perlin, X, Y, seedOf(p), 3, 2, 0.5)), 1),
  46: (p, N) => shapeField(N, p, (x, y) => clamp01(smoothstep(0.42, 0.36, Math.max(Math.abs(x), Math.abs(y))) * 0.7 + 0.05 * fbm(perlin, x * 5, y * 5, seedOf(p), 3))),
  47: (p, N) => shapeField(N, p, (x, y) => { const off = (p.position ?? 0) * 0.5; const t = smoothstep(off - 0.02, off + 0.02, x); return clamp01(t * 0.7 + 0.1 * fbm(perlin, x * 5, y * 5, seedOf(p), 3)); }),
  48: (p, N) => toUnit(field(N, p, (X, Y) => { const n = fbm(perlin, X, Y, seedOf(p), oct(p), lac(p), gain(p)); return Math.abs(n) > 0.3 ? 0.5 + Math.sign(n) * 0.5 * Math.min(1, Math.abs(n) - 0.3) * 2 : 0.5; }), 1),
  49: (p, N) => field(N, p, (X, Y) => { const strat = 0.5 + 0.5 * Math.sin(Y * 18 + fbm(perlin, X, Y, seedOf(p), 3) * 4); const g = Math.abs(Math.sin(X * 6 + strat * 2)); return clamp01(0.25 + 0.5 * strat * g + 0.2 * fbm(perlin, X * 3, Y * 3, seedOf(p), 4)); }),
  50: (p, N) => shapeField(N, p, (x, y) => { const c = Math.hypot(x, y * 1.2); const sh = smoothstep(0.42, 0.3, c); return clamp01(sh * 0.6 + 0.04 * fbm(perlin, x * 10, y * 10, seedOf(p), 4)); }),
  51: (p, N) => shapeField(N, p, (x, y) => { const r = Math.hypot(x, y) + fbm(perlin, x * 3, y * 3, seedOf(p), 4) * 0.15; return clamp01(smoothstep(0.32, 0.22, r) * 0.9 + 0.05 * fbm(perlin, x * 9, y * 9, seedOf(p), 3)); }),
  52: (p, N) => toUnit(field(N, p, (X, Y) => fbm(perlin, X, Y, seedOf(p), oct(p), 2, 0.5) * 1.4 + 0.3 * (1 - Math.hypot(X - (p.scale ?? 4) / 2, Y - (p.scale ?? 4) / 2) / ((p.scale ?? 4)))), 1),
};
