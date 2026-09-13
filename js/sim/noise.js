// Seeded noise utilities (deterministic, shared by field build + eroders).
export function mulberry32(seed) {
  let a = (seed | 0) >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hash3(x, y, z, seed) {
  let n = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^
    Math.imul(z | 0, 1440662683) ^ Math.imul(seed | 0, 1274126177);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}
const fade = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;
export function valueNoise3(x, y, z, seed) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const u = fade(x - ix), v = fade(y - iy), w = fade(z - iz);
  return lerp(
    lerp(
      lerp(hash3(ix, iy, iz, seed), hash3(ix + 1, iy, iz, seed), u),
      lerp(hash3(ix, iy + 1, iz, seed), hash3(ix + 1, iy + 1, iz, seed), u), v),
    lerp(
      lerp(hash3(ix, iy, iz + 1, seed), hash3(ix + 1, iy, iz + 1, seed), u),
      lerp(hash3(ix, iy + 1, iz + 1, seed), hash3(ix + 1, iy + 1, iz + 1, seed), u), v),
    w);
}
export function fbm3(x, y, z, oct, gain, lac, seed) {
  let a = 0.5, f = 1, s = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    s += a * valueNoise3(x * f, y * f, z * f, seed + i * 101);
    norm += a; a *= gain; f *= lac;
  }
  return s / (norm || 1);
}
export function ridged3(x, y, z, oct, gain, lac, seed) {
  let a = 0.5, f = 1, s = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    const n = valueNoise3(x * f, y * f, z * f, seed + i * 131);
    s += a * (1 - Math.abs(n * 2 - 1)) ** 2;
    norm += a; a *= gain; f *= lac;
  }
  return s / (norm || 1);
}
