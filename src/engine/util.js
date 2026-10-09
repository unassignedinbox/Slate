// Slate Terrain Layer Stack — shared math / field utilities (pure JS, no DOM).
export const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, x) => (a === b ? 0 : clamp((x - a) / (b - a)));
export const smoothstep = (a, b, x) => {
  const t = invLerp(a, b, x);
  return t * t * (3 - 2 * t);
};
export const TAU = Math.PI * 2;

// Deterministic seeded PRNG (mulberry32).
export function mulberry32(seed) {
  let s = (seed >>> 0) || 1;
  return function () {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Stateless integer hash -> [0,1). Used by all noise lattices.
export function hash2(x, y, seed) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1440662683)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export function hash2s(x, y, seed) { return hash2(x, y, seed) * 2 - 1; } // signed

export const id = (n, x, y) => y * n + x;
export const makeField = (n, fill = 0) => {
  const f = new Float32Array(n * n);
  if (fill !== 0) f.fill(fill);
  return f;
};
export const copyField = (f) => Float32Array.from(f);

// Bilinear sample of an n*n field at continuous coords [0,n-1], clamped.
export function bilinear(f, n, x, y) {
  x = clamp(x, 0, n - 1.001); y = clamp(y, 0, n - 1.001);
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(n - 1, x0 + 1), y1 = Math.min(n - 1, y0 + 1);
  const fx = x - x0, fy = y - y0;
  const a = f[y0 * n + x0], b = f[y0 * n + x1], c = f[y1 * n + x0], d = f[y1 * n + x1];
  return lerp(lerp(a, b, fx), lerp(c, d, fx), fy);
}
// Bilinear sample with wrap (tiling).
export function bilinearWrap(f, n, x, y) {
  x = ((x % n) + n) % n; y = ((y % n) + n) % n;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = (x0 + 1) % n, y1 = (y0 + 1) % n;
  const fx = x - x0, fy = y - y0;
  const a = f[y0 * n + x0], b = f[y0 * n + x1], c = f[y1 * n + x0], d = f[y1 * n + x1];
  return lerp(lerp(a, b, fx), lerp(c, d, fx), fy);
}

export function fieldStats(f) {
  let mn = Infinity, mx = -Infinity, sum = 0;
  for (let i = 0; i < f.length; i++) { const v = f[i]; if (v < mn) mn = v; if (v > mx) mx = v; sum += v; }
  const mean = sum / f.length;
  let va = 0;
  for (let i = 0; i < f.length; i++) { const d = f[i] - mean; va += d * d; }
  return { min: mn, max: mx, mean, std: Math.sqrt(va / f.length) };
}
export function normalizeInPlace(f, lo = 0, hi = 1) {
  const s = fieldStats(f);
  const r = s.max - s.min;
  if (r < 1e-9) { f.fill(lo); return f; }
  for (let i = 0; i < f.length; i++) f[i] = lo + ((f[i] - s.min) / r) * (hi - lo);
  return f;
}
export function histogram(f, bins = 32) {
  const s = fieldStats(f);
  const h = new Array(bins).fill(0);
  const r = (s.max - s.min) || 1;
  for (let i = 0; i < f.length; i++) {
    let b = Math.floor(((f[i] - s.min) / r) * bins);
    if (b >= bins) b = bins - 1;
    h[b]++;
  }
  return { bins: h, min: s.min, max: s.max };
}

// --- Derived terrain maps (all cached by the stack context) ---
// Slope: gradient magnitude (rise/run in height units per cell). Aspect: downhill angle [0,TAU).
export function slopeAspect(h, n) {
  const slope = new Float32Array(n * n), aspect = new Float32Array(n * n);
  for (let y = 0; y < n; y++) {
    const yu = Math.max(0, y - 1) * n, yc = y * n, yd = Math.min(n - 1, y + 1) * n;
    for (let x = 0; x < n; x++) {
      const xl = Math.max(0, x - 1), xr = Math.min(n - 1, x + 1);
      const dx = (h[yc + xr] - h[yc + xl]) / (xr - xl || 1);
      const dy = (h[yd + x] - h[yu + x]) / (((y < n - 1) - (y > 0)) || 1);
      const i = yc + x;
      slope[i] = Math.hypot(dx, dy);
      aspect[i] = Math.atan2(-dy, -dx) + Math.PI; // direction water would flow, 0..TAU
    }
  }
  return { slope, aspect };
}
// Mean-curvature approximation via Laplacian; splits into convex/concave parts.
export function curvature(h, n) {
  const curv = new Float32Array(n * n);
  for (let y = 0; y < n; y++) {
    const yu = Math.max(0, y - 1) * n, yc = y * n, yd = Math.min(n - 1, y + 1) * n;
    for (let x = 0; x < n; x++) {
      const xl = Math.max(0, x - 1), xr = Math.min(n - 1, x + 1);
      curv[yc + x] = (h[yc + xl] + h[yc + xr] + h[yu + x] + h[yd + x]) * 0.25 - h[yc + x];
    }
  }
  return curv;
}
// D8 flow accumulation, log-normalized to 0..1.
export function flowAccum(h, n) {
  const order = new Int32Array(n * n);
  for (let i = 0; i < n * n; i++) order[i] = i;
  order.sort((a, b) => h[b] - h[a]); // high -> low
  const acc = new Float32Array(n * n).fill(1);
  const DX = [1, 1, 0, -1, -1, -1, 0, 1], DY = [0, 1, 1, 1, 0, -1, -1, -1];
  for (let k = 0; k < order.length; k++) {
    const i = order[k];
    const x = i % n, y = (i / n) | 0;
    let best = 0, bi = -1;
    for (let d = 0; d < 8; d++) {
      const nx = x + DX[d], ny = y + DY[d];
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      const drop = (h[i] - h[ny * n + nx]) / (d % 2 ? 1.4142 : 1);
      if (drop > best) { best = drop; bi = ny * n + nx; }
    }
    if (bi >= 0) acc[bi] += acc[i];
  }
  const out = new Float32Array(n * n);
  const mx = Math.log1p(n * n);
  for (let i = 0; i < out.length; i++) out[i] = Math.log1p(acc[i]) / mx;
  return out;
}
// Cheap horizon-based ambient occlusion (4 directions, few steps).
export function ambientOcc(h, n, radius = 5, strength = 1) {
  const ao = new Float32Array(n * n);
  const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x, hc = h[i];
    let occ = 0;
    for (const [dx, dy] of dirs) {
      let peak = 0;
      for (let s = 1; s <= radius; s++) {
        const nx = clamp(x + dx * s, 0, n - 1) | 0, ny = clamp(y + dy * s, 0, n - 1) | 0;
        const a = (h[ny * n + nx] - hc) / s;
        if (a > peak) peak = a;
        const px = clamp(x - dx * s, 0, n - 1) | 0, py = clamp(y - dy * s, 0, n - 1) | 0;
        const b = (h[py * n + px] - hc) / s;
        if (b > peak) peak = b;
      }
      occ += clamp(peak * 2, 0, 1);
    }
    ao[i] = clamp(1 - (occ / 4) * strength);
  }
  return ao;
}
// Hillshade 0..1 for sun azimuth/altitude (degrees).
export function hillshade(h, n, azimDeg = 315, altDeg = 45) {
  const { slope, aspect } = slopeAspect(h, n);
  const az = (azimDeg * Math.PI) / 180, alt = (altDeg * Math.PI) / 180;
  const out = new Float32Array(n * n);
  for (let i = 0; i < out.length; i++) {
    const sl = Math.atan(slope[i]);
    out[i] = clamp(
      Math.sin(alt) * Math.cos(sl) + Math.cos(alt) * Math.sin(sl) * Math.cos(az - aspect[i] + Math.PI),
      0, 1
    );
  }
  return out;
}
// Surface normal at pixel (for normal maps / triplanar).
export function normalAt(h, n, x, y, strength = 1) {
  const xl = h[y * n + Math.max(0, x - 1)], xr = h[y * n + Math.min(n - 1, x + 1)];
  const yu = h[Math.max(0, y - 1) * n + x], yd = h[Math.min(n - 1, y + 1) * n + x];
  const nx = (xl - xr) * strength, ny = (yu - yd) * strength, nz = 2;
  const l = Math.hypot(nx, ny, nz);
  return [nx / l, ny / l, nz / l];
}
export function hexToRgb(hex) {
  const v = parseInt(String(hex).replace('#', ''), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}
export function rgbToHsv(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 1e-9) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6; if (h < 0) h += 1;
  }
  return [h, mx < 1e-9 ? 0 : d / mx, mx];
}
export function hsvToRgb(h, s, v) {
  h = ((h % 1) + 1) % 1;
  const c = v * s, x = c * (1 - Math.abs(((h * 6) % 2) - 1)), m = v - c;
  let r = 0, g = 0, b = 0;
  const s6 = h * 6;
  if (s6 < 1) { r = c; g = x; } else if (s6 < 2) { r = x; g = c; } else if (s6 < 3) { g = c; b = x; }
  else if (s6 < 4) { g = x; b = c; } else if (s6 < 5) { r = x; b = c; } else { r = c; b = x; }
  return [r + m, g + m, b + m];
}
// Simple separable gaussian blur (radius in px, sigma auto).
export function gaussBlur(f, n, radius) {
  radius = Math.max(0, Math.round(radius));
  if (radius < 1) return Float32Array.from(f);
  const k = [];
  const sig = Math.max(0.6, radius / 2);
  let sum = 0;
  for (let i = -radius; i <= radius; i++) { const w = Math.exp((-i * i) / (2 * sig * sig)); k.push(w); sum += w; }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  const tmp = new Float32Array(n * n), out = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let a = 0;
    for (let i = -radius; i <= radius; i++) a += f[y * n + clamp(x + i, 0, n - 1)] * k[i + radius];
    tmp[y * n + x] = a;
  }
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let a = 0;
    for (let i = -radius; i <= radius; i++) a += tmp[clamp(y + i, 0, n - 1) * n + x] * k[i + radius];
    out[y * n + x] = a;
  }
  return out;
}
// Box blur, radius px, separable.
export function boxBlur(f, n, radius) {
  radius = Math.max(0, Math.round(radius));
  if (radius < 1) return Float32Array.from(f);
  const tmp = new Float32Array(n * n), out = new Float32Array(n * n);
  const w = 2 * radius + 1;
  for (let y = 0; y < n; y++) {
    let a = 0;
    for (let i = -radius; i <= radius; i++) a += f[y * n + clamp(x0(i), 0, n - 1)] || 0;
    function x0(i) { return 0 + i; }
    for (let x = 0; x < n; x++) {
      tmp[y * n + x] = a / w;
      a += (f[y * n + clamp(x + radius + 1, 0, n - 1)] - f[y * n + clamp(x - radius, 0, n - 1)]);
    }
  }
  for (let x = 0; x < n; x++) {
    let a = 0;
    for (let i = -radius; i <= radius; i++) a += tmp[clamp(i, 0, n - 1) * n + x];
    for (let y = 0; y < n; y++) {
      out[y * n + x] = a / w;
      a += tmp[clamp(y + radius + 1, 0, n - 1) * n + x] - tmp[clamp(y - radius, 0, n - 1) * n + x];
    }
  }
  return out;
}
export function downUp(f, n, factor) {
  // Downsample then upsample (smoothing / pixelation helper), factor >= 1.
  factor = Math.max(1, Math.round(factor));
  if (factor <= 1) return Float32Array.from(f);
  const m = Math.max(1, Math.round(n / factor));
  const small = new Float32Array(m * m);
  for (let y = 0; y < m; y++) for (let x = 0; x < m; x++) {
    const sx = Math.min(n - 1, Math.round((x / (m - 1 || 1)) * (n - 1)));
    const sy = Math.min(n - 1, Math.round((y / (m - 1 || 1)) * (n - 1)));
    small[y * m + x] = f[sy * n + sx];
  }
  const out = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    out[y * n + x] = bilinear(small, m, (x / (n - 1)) * (m - 1), (y / (n - 1)) * (m - 1));
  }
  return out;
}
