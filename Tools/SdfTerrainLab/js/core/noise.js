// Seeded 3D value noise + fractal flavours. Pure JS, no DOM. Deterministic per seed.
export function makeNoise(seed = 1337) {
  let s = seed >>> 0;
  // integer hash → [0,1)
  function hash3(ix, iy, iz) {
    let h = (ix * 374761393 + iy * 668265263 + iz * 2147483647 + s * 974634211) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h = h ^ (h >>> 16);
    return (h >>> 0) / 4294967296;
  }
  function fade(t) { return t * t * (3 - 2 * t); }
  function value3(x, y, z) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = x - xi, yf = y - yi, zf = z - zi;
    const u = fade(xf), v = fade(yf), w = fade(zf);
    const lerp = (a, b, t) => a + (b - a) * t;
    return lerp(
      lerp(lerp(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), u),
           lerp(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), u), v),
      lerp(lerp(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), u),
           lerp(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), u), v), w) * 2 - 1;
  }
  // Standard fBm in [-1,1]-ish
  function fbm(x, y, z, oct = 4, lac = 2.02, gain = 0.5) {
    let a = 0.5, f = 1, sum = 0, norm = 0;
    for (let i = 0; i < oct; i++) {
      sum += a * value3(x * f, y * f, z * f);
      norm += a; a *= gain; f *= lac;
    }
    return sum / (norm || 1);
  }
  // Ridged multifractal in [0,1]-ish (mountains)
  function ridged(x, y, z, oct = 4, lac = 2.1, gain = 0.55, offset = 0.9) {
    let a = 0.5, f = 1, sum = 0, norm = 0;
    for (let i = 0; i < oct; i++) {
      let n = 1 - Math.abs(value3(x * f, y * f, z * f));
      n = n * n;
      sum += a * n; norm += a;
      a *= gain * (0.6 + 0.4 * n); f *= lac;
    }
    const r = sum / (norm || 1);
    return (r - offset * 0.55) / (1 - offset * 0.55 + 1e-5); // roughly [-0.4, 1]
  }
  // Billow in [0,1]-ish (rolling hills / clouds)
  function billow(x, y, z, oct = 4, lac = 2.0, gain = 0.5) {
    let a = 0.5, f = 1, sum = 0, norm = 0;
    for (let i = 0; i < oct; i++) {
      sum += a * Math.abs(value3(x * f, y * f, z * f));
      norm += a; a *= gain; f *= lac;
    }
    return sum / (norm || 1);
  }
  // Domain-warped fBm (cheap marble / strata distortion)
  function warped(x, y, z, oct, warpAmt, warpFreq) {
    const wx = fbm(x * warpFreq + 5.2, y * warpFreq + 1.3, z * warpFreq + 2.8, 3);
    const wy = fbm(x * warpFreq + 8.1, y * warpFreq + 3.7, z * warpFreq + 9.2, 3);
    const wz = fbm(x * warpFreq + 4.4, y * warpFreq + 7.9, z * warpFreq + 1.1, 3);
    return fbm(x + wx * warpAmt, y + wy * warpAmt, z + wz * warpAmt, oct);
  }
  return { hash3, value3, fbm, ridged, billow, warped, seed };
}

// Deterministic PRNG (mulberry32) for sim + scatter placement.
export function makeRng(seed = 1) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
