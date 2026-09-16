// Shared GLSL chunks. Physics MUST match src/ocean/spectra.js + bathymetry.js.

export const NOISE_GLSL = /* glsl */`
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
// unit gaussian pair (Box-Muller)
vec2 gauss2(vec2 p) {
  float u1 = max(hash12(p), 1e-6);
  float u2 = hash12(p + 19.19);
  float r = sqrt(-2.0 * log(u1));
  float t = 6.2831853 * u2;
  return r * vec2(cos(t), sin(t));
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i), b = hash12(i + vec2(1, 0));
  float c = hash12(i + vec2(0, 1)), d = hash12(i + vec2(1, 1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm3(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { v += a * vnoise(p); p = p * 2.03 + 11.7; a *= 0.5; }
  return v;
}
float fbm4(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * vnoise(p); p = p * 2.03 + 11.7; a *= 0.5; }
  return v;
}
// gradient of value noise (for detail normals)
vec2 vnoiseGrad(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  vec2 du = 6.0 * f * (1.0 - f);
  float a = hash12(i), b = hash12(i + vec2(1, 0));
  float c = hash12(i + vec2(0, 1)), d = hash12(i + vec2(1, 1));
  return vec2(mix(b - a, d - c, u.y), mix(c - a, d - b, u.x)) * du;
}
`;

export const BATHY_GLSL = /* glsl */`
// uBathy0 = (mode, shoreX, slope, tide), uBathy1 = (barX, barH, barW, reefEdge),
// uBathy2 = (reefDepth, reefDeep, angleRad, 0)
uniform vec4 uBathy0;
uniform vec4 uBathy1;
uniform vec4 uBathy2;
float bathyDepth(vec2 p) {
  float mode = uBathy0.x;
  if (mode < 0.5) return 250.0;
  float X = p.x, Z = p.y;
  if (mode > 3.5) {
    float a = uBathy2.z, c = cos(a), s = sin(a);
    X = c * p.x - s * p.y; Z = s * p.x + c * p.y;
  }
  float wig = 30.0 * sin(Z * 0.008) + 15.0 * sin(Z * 0.023 + 1.7);
  float shoreX = uBathy0.y, slope = uBathy0.z, tide = uBathy0.w;
  if (mode < 1.5) {
    float d = X - (shoreX + wig);
    float D = d * slope + tide;
    if (d > 600.0) { float e = d - 600.0; D += 0.00004 * e * e; }
    return clamp(D, -4.0, 300.0);
  } else if (mode < 2.5) {
    float d = X - (shoreX + wig);
    float D = d * slope + tide;
    if (d > 600.0) { float e = d - 600.0; D += 0.00004 * e * e; }
    float t = (X - uBathy1.x) / uBathy1.z;
    D -= uBathy1.y * exp(-t * t);
    return clamp(D, -4.0, 300.0);
  } else {
    float shelf = smoothstep(uBathy1.w - 60.0, uBathy1.w + 60.0, X);
    float D = uBathy2.y + (uBathy2.x - uBathy2.y) * shelf;
    float ramp = smoothstep(shoreX - 60.0, shoreX + 40.0, X);
    D = D + (-2.0 - D) * ramp + tide;
    return clamp(D, -4.0, 300.0);
  }
}
vec2 bathyShoreDir(vec2 p) {
  float e = 2.0;
  float dx = bathyDepth(p + vec2(e, 0.0)) - bathyDepth(p - vec2(e, 0.0));
  float dz = bathyDepth(p + vec2(0.0, e)) - bathyDepth(p - vec2(0.0, e));
  vec2 g = vec2(dx, dz);
  float n = length(g);
  if (n < 1e-6) return vec2(1.0, 0.0);
  return -g / n;
}
// Green's law + group velocity shoaling gain for wavenumber k at depth D
float shoalingGain(float k, float D) {
  if (k <= 0.0 || D <= 0.15) return 1.0;
  float g = 9.81;
  float w0 = sqrt(g * k);
  float cg0 = 0.5 * (w0 / k);
  float c = sqrt((g / k) * tanh(k * D));
  float kd = k * D;
  float s = sinh(2.0 * kd);
  float nn = s > 1e-6 ? 0.5 * (1.0 + (2.0 * kd) / s) : 1.0;
  float cg = max(c * nn, 1e-3);
  return clamp(sqrt(cg0 / cg), 0.5, 2.6);
}
`;

export const ANALYTIC_GLSL = /* glsl */`
// Analytic wave sources (point emitters, plane trains, canceller beams).
// uSrcA[i] = (x, z, type, amp), uSrcB[i] = (dirx, dirz, wavelength, phase),
// uSrcC[i] = (beamWidth, decayLen, 0, 0). type: 0 point, 1 plane, 2 canceller.
uniform float uSrcCount;
uniform vec4 uSrcA[8];
uniform vec4 uSrcB[8];
uniform vec4 uSrcC[8];
float analyticHeight(vec2 p, float t) {
  float h = 0.0;
  for (int i = 0; i < 8; i++) {
    if (float(i) >= uSrcCount) break;
    vec4 A = uSrcA[i];
    vec4 B = uSrcB[i];
    vec4 C = uSrcC[i];
    float amp = A.w;
    if (abs(amp) < 1e-6) continue;
    float lambda = max(B.z, 0.5);
    float k = 6.2831853 / lambda;
    float om = sqrt(9.81 * k); // deep-water dispersion for emitters
    vec2 rel = p - A.xy;
    if (A.z < 0.5) {
      float r = length(rel);
      float env = exp(-r / max(C.y, 1.0)) * smoothstep(0.0, 0.5 * lambda, r);
      h += amp * sin(k * r - om * t + B.w) * env;
    } else {
      vec2 d = normalize(B.xy + vec2(1e-6, 0.0));
      float s = dot(rel, d);
      float perp = dot(rel, vec2(-d.y, d.x));
      float beam = exp(-(perp * perp) / (max(C.x, 1.0) * max(C.x, 1.0)));
      float gate = smoothstep(0.0, lambda, s) * exp(-max(s, 0.0) / max(C.y, 10.0));
      h += amp * sin(k * s - om * t + B.w) * beam * gate;
    }
  }
  return h;
}
`;

export const CASCADE_SAMPLE_GLSL = /* glsl */`
uniform sampler2D uDisp0;
uniform sampler2D uDisp1;
uniform sampler2D uDisp2;
uniform vec3 uTiles; // tile lengths (m)
// Per-cascade UV rotation kills visible tiling of the repeating tiles.
// Cascade 0 stays axis-aligned (swell direction must match UI/sources);
// detail cascades rotate. MUST match CASCADE_ROT in spectra.js.
vec2 cascUV(vec2 p, float tile, float ang) {
  float c = cos(ang), s = sin(ang);
  return mat2(c, -s, s, c) * p / tile;
}
vec3 oceanDisp(vec2 p) {
  vec3 d = vec3(0.0);
  d += texture2D(uDisp0, cascUV(p, uTiles.x, 0.0)).rgb;
  d += texture2D(uDisp1, cascUV(p, uTiles.y, 0.6)).rgb;
  d += texture2D(uDisp2, cascUV(p, uTiles.z, 2.2)).rgb;
  return d;
}
float cascFade(float dist, vec2 r) { return 1.0 - smoothstep(r.x, r.y, dist); }
vec3 oceanDispFaded(vec2 p, float dist) {
  vec3 d = vec3(0.0);
  d += texture2D(uDisp0, cascUV(p, uTiles.x, 0.0)).rgb * cascFade(dist, vec2(1500.0, 4200.0));
  d += texture2D(uDisp1, cascUV(p, uTiles.y, 0.6)).rgb * cascFade(dist, vec2(320.0, 950.0));
  d += texture2D(uDisp2, cascUV(p, uTiles.z, 2.2)).rgb * cascFade(dist, vec2(70.0, 240.0));
  return d;
}
`;

// Cheap sky radiance used for water reflections (must roughly match SKY shader).
export const SKYFN_GLSL = /* glsl */`
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform float uCloudiness;
uniform float uSkyTime;
vec3 skyApprox(vec3 dir) {
  float y = dir.y;
  vec3 col = mix(uHorizon, uZenith, pow(clamp(y, 0.0, 1.0), 0.55));
  if (y < 0.0) col = mix(uHorizon, uHorizon * 0.35, clamp(-y * 4.0, 0.0, 1.0));
  float sd = max(dot(dir, uSunDir), 0.0);
  col += uSunColor * (pow(sd, 900.0) * 4.0 + pow(sd, 18.0) * 0.28);
  if (y > 0.02 && uCloudiness > 0.01) {
    vec2 cuv = dir.xz / (y + 0.18);
    float cl = fbm3(cuv * 1.4 + vec2(uSkyTime * 0.008, 0.0));
    float cover = smoothstep(1.0 - uCloudiness * 0.75, 1.15 - uCloudiness * 0.55, cl);
    float shade = 0.55 + 0.45 * fbm3(cuv * 3.1 - vec2(uSkyTime * 0.012, 0.3));
    vec3 cloudCol = mix(vec3(0.42, 0.45, 0.5), vec3(1.02, 1.0, 0.98), shade);
    float sunAmt = pow(sd, 3.0);
    cloudCol += uSunColor * sunAmt * 0.35;
    col = mix(col, cloudCol, cover * smoothstep(0.02, 0.2, y) * 0.85);
  }
  return col;
}
`;
