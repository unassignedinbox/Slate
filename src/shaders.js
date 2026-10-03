// GLSL ES 3.00 shaders for the screen-space fluid renderer.
// Pipeline:
//   1. scene pass       -> HDR colour + linear eye depth (MRT)
//   2. fluid depth pass -> sphere-impostor particles, nearest eye depth (R32F)
//   3. thickness pass   -> additive gaussian thickness + foam (RGBA16F)
//   4. bilateral blur   -> smooth depth surface (separable, depth-aware, N iterations)
//   5. gaussian blur    -> smooth thickness
//   6. composite        -> normals from depth, refraction, Beer–Lambert absorption,
//                          scattering, Fresnel/GGX specular, env reflection, foam, tonemap.

export const COMMON = /* glsl */`
const vec3 SUN_DIR = normalize(vec3(0.45, 0.8, 0.35));
const vec3 SUN_COL = vec3(1.0, 0.95, 0.85) * 3.0;
vec3 skyColor(vec3 d) {
  float y = d.y;
  vec3 zenith = vec3(0.18, 0.36, 0.72);
  vec3 horizon = vec3(0.78, 0.82, 0.88);
  vec3 ground = vec3(0.22, 0.2, 0.19);
  vec3 c = y > 0.0 ? mix(horizon, zenith, pow(clamp(y, 0.0, 1.0), 0.55))
                   : mix(horizon * 0.6, ground, clamp(-y * 4.0, 0.0, 1.0));
  float s = max(dot(d, SUN_DIR), 0.0);
  c += SUN_COL * (pow(s, 900.0) * 18.0 + pow(s, 12.0) * 0.12);
  return c;
}
vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
float hash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i), hash13(i + vec3(1,0,0)), f.x), mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x), mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z);
}
`;

export const FULLSCREEN_VS = /* glsl */`#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)) * 2.0 - 1.0;
  vUv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

// ---------- 1. scene ----------
export const SKY_FS = /* glsl */`#version 300 es
precision highp float;
${COMMON}
in vec2 vUv;
uniform mat4 uInvView; uniform vec2 uTan;
layout(location=0) out vec4 oColor;
layout(location=1) out float oDepth;
void main() {
  vec3 dirEye = normalize(vec3((vUv * 2.0 - 1.0) * uTan, -1.0));
  vec3 d = mat3(uInvView) * dirEye;
  oColor = vec4(skyColor(d), 1.0);
  oDepth = 1e6;
}`;

export const MESH_VS = /* glsl */`#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
uniform mat4 uModel, uView, uProj;
out vec3 vWorld, vNormal; out float vDepth;
void main() {
  vec4 w = uModel * vec4(aPos, 1.0);
  vWorld = w.xyz;
  vNormal = mat3(uModel) * aNormal;
  vec4 e = uView * w;
  vDepth = -e.z;
  gl_Position = uProj * e;
}`;

export const MESH_FS = /* glsl */`#version 300 es
precision highp float;
${COMMON}
in vec3 vWorld, vNormal; in float vDepth;
uniform vec3 uColor, uCamPos; uniform int uMode; uniform float uRough;
uniform vec4 uBalls[6]; uniform int uBallCount;
layout(location=0) out vec4 oColor;
layout(location=1) out float oDepth;
void main() {
  vec3 n = normalize(vNormal);
  vec3 base = uColor;
  if (uMode == 1) { // tiled floor
    vec2 t = floor(vWorld.xz / 2.0);
    float c = mod(t.x + t.y, 2.0);
    base = mix(vec3(0.55, 0.53, 0.5), vec3(0.72, 0.7, 0.66), c);
    vec2 g = abs(fract(vWorld.xz / 2.0) - 0.5);
    base *= 0.8 + 0.2 * (1.0 - smoothstep(0.46, 0.49, max(g.x, g.y))); // grout lines
  } else if (uMode == 3) { // line
    oColor = vec4(uColor, 1.0); oDepth = vDepth; return;
  }
  vec3 v = normalize(uCamPos - vWorld);
  float ndl = max(dot(n, SUN_DIR), 0.0);
  // soft shadows from rigid balls (analytic sphere occlusion along sun dir)
  float sh = 1.0;
  for (int i = 0; i < 6; i++) {
    if (i >= uBallCount) break;
    vec3 oc = uBalls[i].xyz - vWorld; float r = uBalls[i].w;
    float t = dot(oc, SUN_DIR);
    if (t > 0.0) { float d = length(oc - SUN_DIR * t); sh *= smoothstep(r * 0.6, r * 1.25, d); }
    // ambient occlusion
    float l = length(oc); sh *= 1.0 - 0.5 * clamp(r * r / (l * l) * max(dot(n, oc / l), 0.0), 0.0, 1.0);
  }
  vec3 amb = mix(vec3(0.25, 0.23, 0.22), vec3(0.45, 0.55, 0.7), n.y * 0.5 + 0.5) * 0.6;
  vec3 h = normalize(v + SUN_DIR);
  float a = uRough * uRough;
  float nh = max(dot(n, h), 0.0);
  float dd = nh * nh * (a * a - 1.0) + 1.0;
  float ggx = a * a / (3.14159 * dd * dd);
  float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
  vec3 col = base * (amb + SUN_COL * ndl * sh * 0.5) + SUN_COL * ggx * fres * ndl * sh * 0.25;
  col += skyColor(reflect(-v, n)) * fres * (1.0 - uRough) * 0.5;
  oColor = vec4(col, 1.0);
  oDepth = vDepth;
}`;

// ---------- 2/3. particles ----------
export const PARTICLE_VS = /* glsl */`#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in float aDens;
uniform mat4 uView, uProj; uniform float uRadius, uScale;
out vec3 vEye; out float vDens;
void main() {
  vec4 e = uView * vec4(aPos, 1.0);
  vEye = e.xyz; vDens = aDens;
  gl_Position = uProj * e;
  gl_PointSize = max(uRadius * uScale / max(-e.z, 0.01), 1.0);
}`;

export const DEPTH_FS = /* glsl */`#version 300 es
precision highp float;
in vec3 vEye; in float vDens;
uniform mat4 uProj; uniform float uRadius; uniform sampler2D uSceneDepth;
out float oDepth;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0; c.y = -c.y;
  float r2 = dot(c, c);
  if (r2 > 1.0) discard;
  vec3 pe = vEye + vec3(c, sqrt(1.0 - r2)) * uRadius;
  float sd = texelFetch(uSceneDepth, ivec2(gl_FragCoord.xy), 0).r;
  if (-pe.z > sd) discard;
  vec4 cp = uProj * vec4(pe, 1.0);
  gl_FragDepth = cp.z / cp.w * 0.5 + 0.5;
  oDepth = -pe.z;
}`;

export const THICK_FS = /* glsl */`#version 300 es
precision highp float;
in vec3 vEye; in float vDens;
uniform float uRadius; uniform sampler2D uSceneDepth;
out vec4 oThick;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(c, c);
  if (r2 > 1.0) discard;
  float sd = texelFetch(uSceneDepth, ivec2(gl_FragCoord.xy), 0).r;
  float z = sqrt(1.0 - r2);
  if (-vEye.z - z * uRadius > sd) discard;
  float t = 2.0 * z * uRadius * exp(-r2 * 1.5);
  // isolated / low density particles = spray & foam
  float foam = smoothstep(0.85, 0.35, vDens);
  oThick = vec4(t, t * foam, 0.0, 1.0);
}`;

export const DEBUG_FS = /* glsl */`#version 300 es
precision highp float;
in vec3 vEye; in float vDens;
uniform mat4 uProj; uniform float uRadius;
out vec4 oColor;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0; c.y = -c.y;
  float r2 = dot(c, c); if (r2 > 1.0) discard;
  vec3 n = vec3(c, sqrt(1.0 - r2));
  vec3 pe = vEye + n * uRadius;
  vec4 cp = uProj * vec4(pe, 1.0);
  gl_FragDepth = cp.z / cp.w * 0.5 + 0.5;
  vec3 col = mix(vec3(0.95, 0.4, 0.1), vec3(0.1, 0.45, 1.0), clamp(vDens, 0.0, 1.0));
  oColor = vec4(col * (0.35 + 0.65 * max(dot(n, normalize(vec3(0.3, 0.6, 0.7))), 0.0)), 1.0);
}`;

// ---------- 4. bilateral depth smoothing ----------
export const BILATERAL_FS = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D uTex; uniform vec2 uDir; uniform float uWorldRadius, uScale, uFalloff;
out float oDepth;
void main() {
  ivec2 ic = ivec2(gl_FragCoord.xy);
  float d = texelFetch(uTex, ic, 0).r;
  if (d > 1e5) { oDepth = d; return; }
  float radPx = clamp(uWorldRadius * uScale / d, 1.0, 28.0);
  const int TAPS = 10;
  float stepPx = radPx / float(TAPS);
  float sum = 0.0, ws = 0.0;
  ivec2 size = textureSize(uTex, 0);
  for (int i = -TAPS; i <= TAPS; i++) {
    vec2 off = uDir * float(i) * stepPx;
    ivec2 sc = clamp(ic + ivec2(round(off)), ivec2(0), size - 1);
    float s = texelFetch(uTex, sc, 0).r;
    if (s > 1e5) continue;
    float x = float(i) / float(TAPS);
    float w = exp(-x * x * 2.5);
    float dz = (s - d) / uFalloff;
    w *= exp(-dz * dz);
    sum += s * w; ws += w;
  }
  oDepth = sum / ws;
}`;

// ---------- 5. thickness blur ----------
export const BLUR_FS = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D uTex; uniform vec2 uDir;
out vec4 o;
void main() {
  ivec2 ic = ivec2(gl_FragCoord.xy);
  ivec2 size = textureSize(uTex, 0);
  vec4 s = vec4(0.0); float ws = 0.0;
  for (int i = -8; i <= 8; i++) {
    float w = exp(-float(i * i) / 24.0);
    s += texelFetch(uTex, clamp(ic + ivec2(uDir * float(i) * 1.5), ivec2(0), size - 1), 0) * w;
    ws += w;
  }
  o = s / ws;
}`;

// ---------- 6. composite / fluid shading ----------
export const COMPOSITE_FS = /* glsl */`#version 300 es
precision highp float;
${COMMON}
in vec2 vUv;
uniform sampler2D uScene, uDepth, uThick, uSceneDepth;
uniform mat4 uInvView;
uniform vec2 uTan, uRes;
uniform float uTime;
// material
uniform vec3 uBase;        // scattering albedo
uniform vec3 uAbsorb;      // Beer–Lambert absorption per unit thickness
uniform float uOpacity;    // scattering extinction (0 = clear, high = opaque)
uniform float uRough;      // GGX roughness
uniform float uF0;         // reflectance at normal incidence
uniform float uRefract;    // refraction distortion strength
uniform float uSSS;        // subsurface / wrap lighting amount
uniform float uFoam;       // foam/spray whitening
uniform float uNoise;      // surface albedo variation (mud)
uniform int uShowFluid;
out vec4 oColor;

vec3 eyePos(vec2 uv) {
  float d = texture(uDepth, uv).r;
  return vec3((uv * 2.0 - 1.0) * uTan * d, -d);
}

void main() {
  vec3 bg = texture(uScene, vUv).rgb;
  float d = texture(uDepth, vUv).r;
  if (d > 1e5 || uShowFluid == 0) { oColor = vec4(pow(aces(bg), vec3(1.0 / 2.2)), 1.0); return; }

  vec2 px = 1.0 / uRes;
  vec3 P = eyePos(vUv);
  vec3 ddx = eyePos(vUv + vec2(px.x, 0.0)) - P;
  vec3 ddx2 = P - eyePos(vUv - vec2(px.x, 0.0));
  if (abs(ddx2.z) < abs(ddx.z)) ddx = ddx2;
  vec3 ddy = eyePos(vUv + vec2(0.0, px.y)) - P;
  vec3 ddy2 = P - eyePos(vUv - vec2(0.0, px.y));
  if (abs(ddy2.z) < abs(ddy.z)) ddy = ddy2;
  vec3 nE = normalize(cross(ddx, ddy));
  if (nE.z < 0.0) nE = -nE;

  vec4 th = texture(uThick, vUv);
  float T = th.r;
  float foam = th.g;

  mat3 R = mat3(uInvView);
  vec3 N = R * nE;
  vec3 V = R * normalize(-P);
  vec3 worldP = (uInvView * vec4(P, 1.0)).xyz;

  // micro-detail: subtle procedural ripples / clumps so the surface is not CG-smooth
  if (uNoise > 0.0) {
    float e = 0.15;
    vec3 q = worldP * 1.3;
    vec3 g = vec3(vnoise(q + vec3(e,0,0)) - vnoise(q - vec3(e,0,0)),
                  vnoise(q + vec3(0,e,0)) - vnoise(q - vec3(0,e,0)),
                  vnoise(q + vec3(0,0,e)) - vnoise(q - vec3(0,0,e)));
    N = normalize(N - g * uNoise * 1.2);
  }

  // refraction: offset the background lookup along the surface normal, scaled with thickness
  vec2 ruv = vUv + nE.xy * uRefract * clamp(T * 0.08, 0.0, 1.0);
  ruv = clamp(ruv, vec2(0.001), vec2(0.999));
  // don't pull in geometry that is in front of the fluid
  if (texture(uSceneDepth, ruv).r < d) ruv = vUv;
  vec3 refr = texture(uScene, ruv).rgb;
  vec3 transmitted = refr * exp(-uAbsorb * T);

  // diffuse/scattering body (milk, chocolate, mud, honey glow)
  float ndl = dot(N, SUN_DIR);
  float wrap = max((ndl + uSSS) / (1.0 + uSSS), 0.0);
  vec3 amb = mix(vec3(0.22, 0.2, 0.19), vec3(0.42, 0.52, 0.68), N.y * 0.5 + 0.5);
  vec3 base = uBase;
  if (uNoise > 0.0) base *= 0.75 + 0.5 * vnoise(worldP * 0.9);
  float back = pow(clamp(dot(V, -SUN_DIR), 0.0, 1.0), 4.0) * uSSS * exp(-T * 0.2);
  vec3 lit = base * (amb * 0.8 + SUN_COL * 0.45 * wrap) + base * SUN_COL * back * 0.6;
  float opacity = 1.0 - exp(-uOpacity * T);
  vec3 body = mix(transmitted, lit, opacity);

  // specular: GGX + Schlick Fresnel; environment reflection
  vec3 Hh = normalize(V + SUN_DIR);
  float a = uRough * uRough;
  float nh = max(dot(N, Hh), 0.0);
  float dd = nh * nh * (a * a - 1.0) + 1.0;
  float D = a * a / (3.14159 * dd * dd);
  float nv = max(dot(N, V), 1e-3);
  float F = uF0 + (1.0 - uF0) * pow(1.0 - nv, 5.0);
  float k = (uRough + 1.0) * (uRough + 1.0) / 8.0;
  float G = nv / (nv * (1.0 - k) + k) * max(ndl, 0.0) / (max(ndl, 0.0) * (1.0 - k) + k);
  vec3 spec = SUN_COL * D * F * G / max(4.0 * nv, 1e-3);
  vec3 env = skyColor(reflect(-V, N));
  env = mix(env, amb, uRough * 0.8);

  vec3 col = mix(body, env, F) + spec;

  // whitewater
  if (uFoam > 0.0) {
    float f = clamp(foam * 0.35 * uFoam, 0.0, 0.85);
    f *= 0.6 + 0.4 * vnoise(worldP * 3.0 + uTime * 0.5);
    col = mix(col, vec3(0.9, 0.93, 0.95) * (amb + SUN_COL * 0.3 * max(ndl, 0.0)), f);
  }

  // soft edge to avoid hard silhouettes on thin sheets
  float edge = clamp(T * 1.5, 0.0, 1.0);
  col = mix(bg, col, edge);
  oColor = vec4(pow(aces(col), vec3(1.0 / 2.2)), 1.0);
}`;
