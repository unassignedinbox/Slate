/**
 * Shared GLSL chunks.
 *
 * HEADER  – boilerplate + hashes + rotation helpers
 * NOISE   – value / perlin / simplex / worley in 2D and 3D
 * FRACTAL – fBm, billow, ridged, hybrid-multifractal, ridged-multifractal (Musgrave)
 * FIELD   – heightfield sampling: clamped fetch, gradient, slope, curvature
 *
 * Every node shader is assembled as HEADER + (whatever it needs) + body, and the
 * concatenated string doubles as the program cache key upstream.
 */

export const HEADER = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler3D;

in vec2 vUV;

uniform vec2 uTexel;   // 1/resolution
uniform vec2 uRes;     // resolution in texels

const float PI  = 3.14159265359;
const float TAU = 6.28318530718;

float saturate(float x){ return clamp(x, 0.0, 1.0); }
vec2  saturate(vec2 x){ return clamp(x, 0.0, 1.0); }
vec3  saturate(vec3 x){ return clamp(x, 0.0, 1.0); }

float remap(float v, float a, float b, float c, float d){
  return c + (d - c) * (v - a) / max(1e-9, b - a);
}

mat2 rot2(float a){ float s = sin(a), c = cos(a); return mat2(c, -s, s, c); }

mat3 rotY(float a){ float s=sin(a), c=cos(a); return mat3(c,0.,-s, 0.,1.,0., s,0.,c); }

// --- hashes (Dave Hoskins, MIT) ------------------------------------------
float hash11(float p){
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}
float hash12(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hash13(vec3 p3){
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
vec3 hash33(vec3 p3){
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}
vec3 hash32(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yzz) * p3.zyx);
}
`;

export const NOISE = /* glsl */ `
// ---------------------------------------------------------------- value
float valueNoise2(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i + vec2(0,0));
  float b = hash12(i + vec2(1,0));
  float c = hash12(i + vec2(0,1));
  float d = hash12(i + vec2(1,1));
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y) * 2.0 - 1.0;
}
float valueNoise3(vec3 p){
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float n000 = hash13(i + vec3(0,0,0));
  float n100 = hash13(i + vec3(1,0,0));
  float n010 = hash13(i + vec3(0,1,0));
  float n110 = hash13(i + vec3(1,1,0));
  float n001 = hash13(i + vec3(0,0,1));
  float n101 = hash13(i + vec3(1,0,1));
  float n011 = hash13(i + vec3(0,1,1));
  float n111 = hash13(i + vec3(1,1,1));
  float x00 = mix(n000, n100, u.x);
  float x10 = mix(n010, n110, u.x);
  float x01 = mix(n001, n101, u.x);
  float x11 = mix(n011, n111, u.x);
  return mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z) * 2.0 - 1.0;
}

// --------------------------------------------------------------- perlin
vec2 gradDir2(vec2 i){
  float a = hash12(i) * TAU;
  return vec2(cos(a), sin(a));
}
float perlin2(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = dot(gradDir2(i + vec2(0,0)), f - vec2(0,0));
  float b = dot(gradDir2(i + vec2(1,0)), f - vec2(1,0));
  float c = dot(gradDir2(i + vec2(0,1)), f - vec2(0,1));
  float d = dot(gradDir2(i + vec2(1,1)), f - vec2(1,1));
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y) * 1.4142;
}
vec3 gradDir3(vec3 i){ return normalize(hash33(i) * 2.0 - 1.0); }
float perlin3(vec3 p){
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float n000 = dot(gradDir3(i + vec3(0,0,0)), f - vec3(0,0,0));
  float n100 = dot(gradDir3(i + vec3(1,0,0)), f - vec3(1,0,0));
  float n010 = dot(gradDir3(i + vec3(0,1,0)), f - vec3(0,1,0));
  float n110 = dot(gradDir3(i + vec3(1,1,0)), f - vec3(1,1,0));
  float n001 = dot(gradDir3(i + vec3(0,0,1)), f - vec3(0,0,1));
  float n101 = dot(gradDir3(i + vec3(1,0,1)), f - vec3(1,0,1));
  float n011 = dot(gradDir3(i + vec3(0,1,1)), f - vec3(0,1,1));
  float n111 = dot(gradDir3(i + vec3(1,1,1)), f - vec3(1,1,1));
  float x00 = mix(n000, n100, u.x);
  float x10 = mix(n010, n110, u.x);
  float x01 = mix(n001, n101, u.x);
  float x11 = mix(n011, n111, u.x);
  return mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z) * 1.1547;
}

// -------------------------------------------------------------- simplex
float simplex2(vec2 p){
  const float K1 = 0.366025404; // (sqrt(3)-1)/2
  const float K2 = 0.211324865; // (3-sqrt(3))/6
  vec2 i = floor(p + (p.x + p.y) * K1);
  vec2 a = p - i + (i.x + i.y) * K2;
  float m = step(a.y, a.x);
  vec2 o = vec2(m, 1.0 - m);
  vec2 b = a - o + K2;
  vec2 c = a - 1.0 + 2.0 * K2;
  vec3 h = max(0.5 - vec3(dot(a,a), dot(b,b), dot(c,c)), 0.0);
  vec3 n = h * h * h * h * vec3(
    dot(a, gradDir2(i + 0.0)),
    dot(b, gradDir2(i + o)),
    dot(c, gradDir2(i + 1.0)));
  return dot(n, vec3(70.0));
}
float simplex3(vec3 p){
  const float K1 = 0.333333333;
  const float K2 = 0.166666667;
  vec3 i = floor(p + (p.x + p.y + p.z) * K1);
  vec3 d0 = p - (i - (i.x + i.y + i.z) * K2);
  vec3 e = step(vec3(0.0), d0 - d0.yzx);
  vec3 i1 = e * (1.0 - e.zxy);
  vec3 i2 = 1.0 - e.zxy * (1.0 - e);
  vec3 d1 = d0 - (i1 - K2);
  vec3 d2 = d0 - (i2 - 2.0 * K2);
  vec3 d3 = d0 - (1.0 - 3.0 * K2);
  vec4 h = max(0.6 - vec4(dot(d0,d0), dot(d1,d1), dot(d2,d2), dot(d3,d3)), 0.0);
  vec4 n = h * h * h * h * vec4(
    dot(d0, gradDir3(i)),
    dot(d1, gradDir3(i + i1)),
    dot(d2, gradDir3(i + i2)),
    dot(d3, gradDir3(i + 1.0)));
  return dot(vec4(31.316), n);
}

// --------------------------------------------------------------- worley
// returns (F1, F2) squared-free distances, and the cell id in .z
vec3 worley2(vec2 p){
  vec2 ip = floor(p), fp = fract(p);
  float f1 = 8.0, f2 = 8.0, id = 0.0;
  for (int j = -1; j <= 1; j++)
  for (int i = -1; i <= 1; i++){
    vec2 g = vec2(float(i), float(j));
    vec2 o = hash22(ip + g);
    float d = length(g + o - fp);
    if (d < f1){ f2 = f1; f1 = d; id = hash12(ip + g); }
    else if (d < f2){ f2 = d; }
  }
  return vec3(f1, f2, id);
}
vec3 worley3(vec3 p){
  vec3 ip = floor(p), fp = fract(p);
  float f1 = 8.0, f2 = 8.0, id = 0.0;
  for (int k = -1; k <= 1; k++)
  for (int j = -1; j <= 1; j++)
  for (int i = -1; i <= 1; i++){
    vec3 g = vec3(float(i), float(j), float(k));
    vec3 o = hash33(ip + g);
    float d = length(g + o - fp);
    if (d < f1){ f2 = f1; f1 = d; id = hash13(ip + g); }
    else if (d < f2){ f2 = d; }
  }
  return vec3(f1, f2, id);
}

// -------------------------------------------------- unified noise basis
// 0 perlin  1 simplex  2 value  3 worley-F1  4 worley edge (F2-F1)
float basis2(vec2 p, int b){
  if (b == 0) return perlin2(p);
  if (b == 1) return simplex2(p);
  if (b == 2) return valueNoise2(p);
  vec3 w = worley2(p);
  if (b == 3) return w.x * 2.0 - 1.0;
  return (w.y - w.x) * 2.0 - 1.0;
}
float basis3(vec3 p, int b){
  if (b == 0) return perlin3(p);
  if (b == 1) return simplex3(p);
  if (b == 2) return valueNoise3(p);
  vec3 w = worley3(p);
  if (b == 3) return w.x * 2.0 - 1.0;
  return (w.y - w.x) * 2.0 - 1.0;
}
`;

export const FRACTAL = /* glsl */ `
// Fractal modes
//  0 fBm                 - classic sum of octaves, rolling hills
//  1 Billow              - |n|, puffy / eroded-dome look
//  2 Ridged              - 1-|n| squared, sharp ridgelines
//  3 Hybrid Multifractal - Musgrave: valleys smooth, peaks rough
//  4 Ridged Multifractal - Musgrave: badlands, spires, canyon walls
//  5 Swiss / Terrain     - derivative-damped fBm, believable mountain mass
//  6 Jordan / DeJong     - heavily warped turbulence, gnarly rock
float fractal2(vec2 p, int mode, int basis, int octaves, float lacunarity,
               float gain, float H, float offsetP, float warpAmt, float seed)
{
  p += vec2(seed * 137.17, seed * 71.93);

  float sum = 0.0, amp = 1.0, freq = 1.0, norm = 0.0;
  float prev = 1.0;
  vec2 dsum = vec2(0.0);
  mat2 R = rot2(0.5);

  for (int i = 0; i < 24; i++){
    if (i >= octaves) break;

    vec2 q = p * freq;
    if (warpAmt > 0.0){
      // cheap derivative-driven domain warp -> gnarlier silhouettes
      q += dsum * warpAmt;
    }
    float n = basis2(q, basis);

    if (mode == 1){                       // billow
      n = abs(n) * 2.0 - 1.0;
    } else if (mode == 2){                // ridged
      n = 1.0 - abs(n);
      n = n * n * 2.0 - 1.0;
    } else if (mode == 3){                // hybrid multifractal
      float w = clamp(prev, 0.0, 1.0);
      float sig = (n + offsetP);
      sum += w * amp * sig;
      norm += amp;
      prev = sig;
      // finite-difference derivative for warp feedback
      float e = 0.35 / freq;
      dsum += vec2(basis2(q + vec2(e,0.0), basis) - n,
                   basis2(q + vec2(0.0,e), basis) - n) * amp;
      amp *= gain; freq *= lacunarity; p = R * p;
      continue;
    } else if (mode == 4){                // ridged multifractal
      float sig = offsetP - abs(n);
      sig = sig * sig;
      sum += sig * amp * prev;
      norm += amp;
      prev = clamp(sig * 2.0, 0.0, 1.0);
      amp *= pow(lacunarity, -H); freq *= lacunarity; p = R * p;
      continue;
    } else if (mode == 5){                // swiss / damped terrain
      float e = 0.35 / freq;
      vec2 d = vec2(basis2(q + vec2(e,0.0), basis) - n,
                    basis2(q + vec2(0.0,e), basis) - n) / e;
      dsum += d;
      sum += amp * n / (1.0 + dot(dsum, dsum) * 0.35);
      norm += amp;
      amp *= gain; freq *= lacunarity; p = R * p;
      continue;
    } else if (mode == 6){                // jordan turbulence
      float e = 0.35 / freq;
      vec2 d = vec2(basis2(q + vec2(e,0.0), basis) - n,
                    basis2(q + vec2(0.0,e), basis) - n) / e;
      dsum += d * 0.5;
      n = abs(n);
      sum += amp * n;
      norm += amp;
      amp *= gain * saturate(sum);
      freq *= lacunarity; p = R * p;
      continue;
    }

    sum += n * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
    p = R * p;
  }

  float v = sum / max(1e-6, norm);
  return v;
}

float fractal3(vec3 p, int mode, int basis, int octaves, float lacunarity,
               float gain, float H, float offsetP, float seed)
{
  p += vec3(seed * 137.17, seed * 71.93, seed * 39.41);
  float sum = 0.0, amp = 1.0, freq = 1.0, norm = 0.0, prev = 1.0;
  mat3 R = rotY(0.6);
  for (int i = 0; i < 16; i++){
    if (i >= octaves) break;
    vec3 q = p * freq;
    float n = basis3(q, basis);
    if (mode == 1) n = abs(n) * 2.0 - 1.0;
    else if (mode == 2){ n = 1.0 - abs(n); n = n * n * 2.0 - 1.0; }
    else if (mode == 4){
      float sig = offsetP - abs(n);
      sig = sig * sig;
      sum += sig * amp * prev;
      norm += amp;
      prev = clamp(sig * 2.0, 0.0, 1.0);
      amp *= pow(lacunarity, -H); freq *= lacunarity; p = R * p;
      continue;
    }
    sum += n * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
    p = R * p;
  }
  return sum / max(1e-6, norm);
}
`;

export const FIELD = /* glsl */ `
// Heightfield helpers. All sampling is clamped at the border so erosion does
// not wrap material around the edges of the tile.
float fetch(sampler2D t, vec2 uv){ return texture(t, clamp(uv, uTexel * 0.5, 1.0 - uTexel * 0.5)).r; }
float fetchO(sampler2D t, vec2 uv, vec2 off){ return fetch(t, uv + off * uTexel); }
vec4  fetch4(sampler2D t, vec2 uv){ return texture(t, clamp(uv, uTexel * 0.5, 1.0 - uTexel * 0.5)); }
vec4  fetch4O(sampler2D t, vec2 uv, vec2 off){ return fetch4(t, uv + off * uTexel); }

// Central-difference gradient in WORLD units (metres of rise per metre of run).
// uCell must be the world size of one texel.
vec2 gradient(sampler2D t, vec2 uv, float heightScale, float cell){
  float l = fetchO(t, uv, vec2(-1, 0));
  float r = fetchO(t, uv, vec2( 1, 0));
  float d = fetchO(t, uv, vec2( 0,-1));
  float u = fetchO(t, uv, vec2( 0, 1));
  return vec2(r - l, u - d) * heightScale / (2.0 * cell);
}

float slopeOf(sampler2D t, vec2 uv, float heightScale, float cell){
  return length(gradient(t, uv, heightScale, cell));
}

vec3 normalOf(sampler2D t, vec2 uv, float heightScale, float cell){
  vec2 g = gradient(t, uv, heightScale, cell);
  return normalize(vec3(-g.x, 1.0, -g.y));
}

// Discrete Laplacian -> positive in bowls, negative on ridges.
float curvatureOf(sampler2D t, vec2 uv, float heightScale, float cell){
  float c = fetch(t, uv);
  float s = fetchO(t, uv, vec2(-1,0)) + fetchO(t, uv, vec2(1,0))
          + fetchO(t, uv, vec2(0,-1)) + fetchO(t, uv, vec2(0,1));
  return (s - 4.0 * c) * heightScale / (cell * cell);
}
`;

/** Assemble a fragment shader from chunks. */
export function shader(...parts: string[]) {
  return parts.join('\n');
}
