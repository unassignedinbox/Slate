// Shared WGSL: hashing, gradient noise, fBm family, domain warp, cellular.
// Integer bit-mix hash (not sin-based): stays exact far from the origin.
export const COMMON = /* wgsl */`
fn hash2(p: vec2i) -> u32 {
  var h: u32 = u32(p.x) * 0x27d4eb2du + u32(p.y) * 0x85ebca6bu;
  h = h ^ (h >> 15u); h = h * 0x2c1b3c6du;
  h = h ^ (h >> 12u); h = h * 0x297a2d39u;
  h = h ^ (h >> 15u);
  return h;
}
fn rand2(p: vec2i, seed: u32) -> f32 {
  return f32(hash2(p) ^ (seed * 0x9e3779b9u)) * (1.0 / 4294967296.0);
}
fn grad2(p: vec2i, seed: u32) -> vec2f {
  let a = rand2(p, seed) * 6.2831853;
  return vec2f(cos(a), sin(a));
}
// quintic fade: C2 continuous, no second-derivative jump at cell walls
fn fade2(t: vec2f) -> vec2f { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }

fn perlin(p: vec2f, seed: u32) -> f32 {
  let i = vec2i(floor(p));
  let f = fract(p);
  let u = fade2(f);
  let a = dot(grad2(i + vec2i(0, 0), seed), f - vec2f(0.0, 0.0));
  let b = dot(grad2(i + vec2i(1, 0), seed), f - vec2f(1.0, 0.0));
  let c = dot(grad2(i + vec2i(0, 1), seed), f - vec2f(0.0, 1.0));
  let d = dot(grad2(i + vec2i(1, 1), seed), f - vec2f(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 1.4142;
}

// cellular noise, returns F2-F1 (ridge-like crests) and F1
fn cellular(p: vec2f, seed: u32) -> vec2f {
  let ip = vec2i(floor(p));
  let fp = fract(p);
  var f1 = 8.0;
  var f2 = 8.0;
  for (var y = -1; y <= 1; y = y + 1) {
    for (var x = -1; x <= 1; x = x + 1) {
      let o = vec2i(x, y);
      let h = hash2(ip + o) ^ (seed * 0x9e3779b9u);
      let jx = f32(h & 0xffffu) / 65535.0;
      let jy = f32((h >> 16u) & 0xffffu) / 65535.0;
      let d = length(vec2f(f32(x), f32(y)) + vec2f(jx, jy) - fp);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
    }
  }
  return vec2f(f1, f2 - f1);
}

// rotation per octave kills the axis-aligned "corduroy" of a shared lattice
const OCT_ROT = mat2x2f(0.8775826, 0.4794255, -0.4794255, 0.8775826);

fn fbm(pIn: vec2f, oct: i32, lac: f32, gain: f32, seed: u32) -> f32 {
  var p = pIn;
  var a = 1.0;
  var sum = 0.0;
  var norm = 0.0;
  for (var i = 0; i < oct; i = i + 1) {
    sum = sum + a * perlin(p, seed + u32(i) * 7919u);
    norm = norm + a;
    a = a * gain;
    p = OCT_ROT * p * lac;
  }
  return sum / max(norm, 1e-5);
}

fn ridged(pIn: vec2f, oct: i32, lac: f32, gain: f32, sharp: f32, seed: u32) -> f32 {
  var p = pIn;
  var a = 1.0;
  var sum = 0.0;
  var norm = 0.0;
  var prev = 1.0;
  for (var i = 0; i < oct; i = i + 1) {
    var n = 1.0 - abs(perlin(p, seed + u32(i) * 7919u));
    n = pow(n, 1.0 + sharp * 2.0);
    sum = sum + a * n * prev;        // multiply by previous octave: sharper, branched crests
    prev = mix(1.0, n, 0.6);
    norm = norm + a;
    a = a * gain;
    p = OCT_ROT * p * lac;
  }
  return sum / max(norm, 1e-5) * 2.0 - 1.0;
}

fn billow(pIn: vec2f, oct: i32, lac: f32, gain: f32, seed: u32) -> f32 {
  var p = pIn;
  var a = 1.0;
  var sum = 0.0;
  var norm = 0.0;
  for (var i = 0; i < oct; i = i + 1) {
    sum = sum + a * (abs(perlin(p, seed + u32(i) * 7919u)) * 2.0 - 1.0);
    norm = norm + a;
    a = a * gain;
    p = OCT_ROT * p * lac;
  }
  return sum / max(norm, 1e-5);
}

fn warpedFbm(p: vec2f, oct: i32, lac: f32, gain: f32, amp: f32, freq: f32, seed: u32) -> f32 {
  let q = vec2f(fbm(p * freq + vec2f(0.0, 0.0), 4, 2.0, 0.5, seed + 11u),
                fbm(p * freq + vec2f(5.2, 1.3), 4, 2.0, 0.5, seed + 23u));
  let r = vec2f(fbm(p * freq + 4.0 * q + vec2f(1.7, 9.2), 3, 2.0, 0.5, seed + 37u),
                fbm(p * freq + 4.0 * q + vec2f(8.3, 2.8), 3, 2.0, 0.5, seed + 53u));
  return fbm(p + amp * r, oct, lac, gain, seed);
}

fn smoothRange(x: f32, lo: f32, hi: f32, soft: f32) -> f32 {
  let s = max(soft, 1e-4);
  return clamp(smoothstep(lo - s, lo + s, x) * (1.0 - smoothstep(hi - s, hi + s, x)), 0.0, 1.0);
}
`;
