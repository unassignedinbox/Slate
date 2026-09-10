// Fast seeded RNG + gradient noise / fbm / ridged / voronoi. DOM-free (node-testable).
export function mulberry32(seed) {
  let s = (seed >>> 0) || 1;
  return function () {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export class Rng {
  constructor(seed = 1337) { this.set(seed); }
  set(seed) { this.f = mulberry32(seed); }
  next() { return this.f(); }
  range(a, b) { return a + (b - a) * this.f(); }
  int(a, b) { return Math.floor(this.range(a, b + 1)); }
  pick(arr) { return arr[Math.floor(this.f() * arr.length)]; }
}

const GRAD = new Float32Array([
  1,1,0, -1,1,0, 1,-1,0, -1,-1,0, 1,0,1, -1,0,1, 1,0,-1, -1,0,-1,
  0,1,1, 0,-1,1, 0,1,-1, 0,-1,-1, 1,1,0, 0,-1,1, -1,1,0, 0,-1,-1]);

export function makeNoise(seed = 1337) {
  const rand = mulberry32(seed);
  const perm = new Uint8Array(512);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = (rand() * (i + 1)) | 0; const t = p[i]; p[i] = p[j]; p[j] = t; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  function n3(x, y, z) {
    const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
    const xf = x - X, yf = y - Y, zf = z - Z;
    const xi = X & 255, yi = Y & 255, zi = Z & 255;
    const u = fade(xf), v = fade(yf), w = fade(zf);
    const A = perm[xi] + yi, AA = perm[A] + zi, AB = perm[A + 1] + zi;
    const B = perm[xi + 1] + yi, BA = perm[B] + zi, BB = perm[B + 1] + zi;
    const g = (h, dx, dy, dz) => GRAD[h * 3] * dx + GRAD[h * 3 + 1] * dy + GRAD[h * 3 + 2] * dz;
    const x1 = g(perm[AA] & 15, xf, yf, zf), x2 = g(perm[BA] & 15, xf - 1, yf, zf);
    const y1 = g(perm[AB] & 15, xf, yf - 1, zf), y2 = g(perm[BB] & 15, xf - 1, yf - 1, zf);
    const z1 = g(perm[AA + 1] & 15, xf, yf, zf - 1), z2 = g(perm[BA + 1] & 15, xf - 1, yf, zf - 1);
    const w1 = g(perm[AB + 1] & 15, xf, yf - 1, zf - 1), w2 = g(perm[BB + 1] & 15, xf - 1, yf - 1, zf - 1);
    const l = (a, b, t) => a + (b - a) * t;
    return l(l(l(x1, x2, u), l(y1, y2, u), v), l(l(z1, z2, u), l(w1, w2, u), v), w);
  }
  function fbm(x, y, z, oct = 4, lac = 2.02, gain = 0.5) {
    let a = 0.5, f = 1, s = 0, norm = 0;
    for (let i = 0; i < oct; i++) { s += a * n3(x * f, y * f, z * f); norm += a; a *= gain; f *= lac; }
    return s / (norm || 1);
  }
  function ridged(x, y, z, oct = 4, lac = 2.1, gain = 0.5, offset = 1.0) {
    let a = 0.5, f = 1, s = 0, norm = 0;
    for (let i = 0; i < oct; i++) {
      let n = 1 - Math.abs(n3(x * f, y * f, z * f));
      n = offset * 0.5 + n * n * 0.5;
      s += a * n; norm += a; a *= gain; f *= lac;
    }
    return s / (norm || 1);
  }
  function billow(x, y, z, oct = 4, lac = 2.02, gain = 0.5) {
    let a = 0.5, f = 1, s = 0, norm = 0;
    for (let i = 0; i < oct; i++) { s += a * Math.abs(n3(x * f, y * f, z * f)); norm += a; a *= gain; f *= lac; }
    return s / (norm || 1);
  }
  // Voronoi F1/F2 + cell id hash. Returns [f1, f2, id]
  function voronoi(x, y, z, out) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    let f1 = 8, f2 = 8, id = 0;
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const cx = xi + dx, cy = yi + dy, cz = zi + dz;
      let h = (cx * 374761393 + cy * 668265263 + cz * 2147483647) | 0;
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      const r1 = ((h ^ (h >>> 16)) >>> 0) / 4294967296;
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      const r2 = ((h ^ (h >>> 16)) >>> 0) / 4294967296;
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      const r3 = ((h ^ (h >>> 16)) >>> 0) / 4294967296;
      const px = cx + r1, py = cy + r2, pz = cz + r3;
      const ddx = px - x, ddy = py - y, ddz = pz - z;
      const d = ddx * ddx + ddy * ddy + ddz * ddz;
      if (d < f1) { f2 = f1; f1 = d; id = r1; } else if (d < f2) f2 = d;
    }
    out = out || [0, 0, 0];
    out[0] = Math.sqrt(f1); out[1] = Math.sqrt(f2); out[2] = id;
    return out;
  }
  return { n3, fbm, ridged, billow, voronoi };
}
