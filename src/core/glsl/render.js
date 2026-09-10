// SLATE render shaders — raymarched SDF terrain (true volumetric: caves, overhangs),
// procedural water with current advection from the flow map, particle sprites.
import { ATLAS_GLSL, NOISE_GLSL } from './common.js';

export const terrainFS = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
${ATLAS_GLSL}
${NOISE_GLSL}
uniform sampler2D uTerrain;
uniform sampler2D uFlow;
uniform vec3 uCamPos;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform vec3 uCamFwd;
uniform vec2 uScreen;
uniform float uTanFov;
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform float uExposure;
uniform float uWaterLevel;
uniform vec4 uWaterOpt;    // wave height · wavelength · foam · clarity
uniform vec4 uRenderOpt;   // shadows · AO · steps scale · flow strength
uniform int uMode;         // 0 shaded · 1 albedo · 2 normal · 3 occupancy · 4 sed/wet · 5 flow
uniform vec2 uDepthParams; // A=(f+n)/(n-f) · B=2fn/(n-f)
out vec4 outColor;

float terrainSDF(vec3 p){
  return atlasSample(uTerrain, p).r + length(max(max(uLo - p, p - uHi), vec3(0)));
}
vec4 terrainFull(vec3 p){ return atlasSample(uTerrain, p); }
vec3 terrainNormal(vec3 p){
  float e = max(uCell * 0.6, 0.35);
  vec3 g = vec3(
    terrainSDF(p + vec3(e, 0, 0)) - terrainSDF(p - vec3(e, 0, 0)),
    terrainSDF(p + vec3(0, e, 0)) - terrainSDF(p - vec3(0, e, 0)),
    terrainSDF(p + vec3(0, 0, e)) - terrainSDF(p - vec3(0, 0, e)));
  return length(g) > 1e-8 ? normalize(g) : vec3(0.0, 1.0, 0.0);
}
vec2 aabbHit(vec3 ro, vec3 rd){
  vec3 inv = 1.0 / max(abs(rd), vec3(1e-5)) * sign(rd + vec3(1e-9));
  vec3 t0 = (uLo - ro) * inv, t1 = (uHi - ro) * inv;
  vec3 tmin = min(t0, t1), tmax = max(t0, t1);
  return vec2(max(max(tmin.x, tmin.y), tmin.z), min(min(tmax.x, tmax.y), tmax.z));
}

// ── flow map ──
vec4 flowAt(vec2 xz){
  vec2 uv = (xz - uLo.xz) / (uHi.xz - uLo.xz);
  return texture(uFlow, clamp(uv, vec2(0.001), vec2(0.999)));
}

// ── sky ──
vec3 skyColor(vec3 rd){
  float horizon = exp(-max(rd.y, 0.0) * 3.0);
  vec3 zenith = vec3(0.19, 0.31, 0.52);
  vec3 ground = vec3(0.62, 0.66, 0.72);
  vec3 sky = mix(zenith, ground, horizon);
  float sun = max(dot(rd, uSunDir), 0.0);
  sky += uSunCol * (pow(sun, 900.0) * 12.0 + pow(sun, 12.0) * 0.18);
  return sky;
}

// ── soft shadow via SDF march ──
float softShadow(vec3 p, vec3 l){
  if(uRenderOpt.x <= 0.0) return 1.0;
  float res = 1.0; float t = uCell * 1.6;
  for(int i = 0; i < 36; i++){
    float d = terrainSDF(p + l * t);
    res = min(res, 10.0 * d / t);
    t += clamp(d, uCell * 0.5, 3.0);
    if(res < 0.02 || t > 90.0) break;
  }
  return clamp(res, 0.0, 1.0);
}
// ── SDF ambient occlusion ──
float calcAO(vec3 p, vec3 n){
  if(uRenderOpt.y <= 0.0) return 1.0;
  float occ = 0.0; float sca = 1.0;
  for(int i = 1; i <= 5; i++){
    float h = 0.12 + float(i) * 0.42;
    occ += (h - terrainSDF(p + n * h)) * sca;
    sca *= 0.72;
  }
  return clamp(1.0 - 1.4 * occ / max(uRenderOpt.y, 0.001), 0.0, 1.0);
}

// ── material ──
vec3 rockAlbedo(vec3 p, vec3 n, vec4 tv){
  float strata = sin(p.y * 0.42 + fbm(p * 0.13, 3) * 5.0) * 0.5 + 0.5;
  vec3 base = mix(vec3(0.412, 0.368, 0.325), vec3(0.318, 0.278, 0.243), strata);
  float grain = fbm(p * 2.7, 3);
  base *= 0.88 + grain * 0.24;
  float slope = 1.0 - n.y;
  base = mix(base, vec3(0.455, 0.442, 0.425), clamp(slope * 1.4 - 0.25, 0.0, 0.55)); // cliff faces
  float sed = clamp(tv.z * 0.5, 0.0, 0.85);                                          // deposited sediment
  base = mix(base, vec3(0.66, 0.574, 0.42), sed);
  float veg = smoothstep(0.55, 0.85, n.y) * smoothstep(26.0, 6.0, p.y) * (0.35 + 0.65 * tv.g);
  base = mix(base, vec3(0.235, 0.335, 0.18), veg * 0.65);                            // sparse vegetation
  base *= 1.0 - tv.g * 0.35;                                                         // wetness darkens
  return base;
}

vec3 shadeTerrain(vec3 p, vec3 rd, out float outT){
  vec4 tv = terrainFull(p);
  vec3 n = terrainNormal(p);
  vec3 alb = rockAlbedo(p, n, tv);
  if(uMode == 1){ outT = length(p - uCamPos); return alb; }
  if(uMode == 2){ outT = length(p - uCamPos); return n * 0.5 + vec3(0.5); }
  if(uMode == 3){ outT = length(p - uCamPos); return mix(vec3(0.05, 0.07, 0.3), vec3(1.0, 0.9, 0.4), tv.a); }
  if(uMode == 4){
    outT = length(p - uCamPos);
    return vec3(tv.z * 0.55, tv.g, tv.g * 0.4 + tv.z * 0.15);
  }
  float sh = softShadow(p + n * uCell * 1.5, uSunDir);
  float ao = calcAO(p, n);
  float dif = max(dot(n, uSunDir), 0.0) * sh;
  float skyl = clamp(0.5 + 0.5 * n.y, 0.0, 1.0);
  float bnc = clamp(0.4 - 0.4 * n.y, 0.0, 1.0);
  vec3 lin = uSunCol * dif * 2.1 + skyColor(vec3(0, 1, 0)) * skyl * 0.55 + vec3(0.3, 0.28, 0.24) * bnc * 0.3;
  lin *= ao;
  vec3 col = alb * lin;
  // ── river film: wetness + animated ripples advected by the current ──
  vec4 fl = flowAt(p.xz);
  float flMag = clamp(fl.z * 2.2, 0.0, 1.0);
  if(flMag > 0.045 && p.y > uWaterLevel + 0.05){
    vec2 dir = length(fl.xy) > 1e-4 ? normalize(fl.xy) : vec2(1.0, 0.0);
    float ripple = vnoise(vec3(p.x * 3.1 - dir.x * uTime * 4.2 * uRenderOpt.w, p.y, p.z * 3.1 - dir.y * uTime * 4.2 * uRenderOpt.w));
    vec2 rt = vec2((ripple - 0.5) * 0.55);
    vec3 rn = normalize(n + vec3(dir.x * rt.x, 0.0, dir.y * rt.y) + vec3(0.0, (ripple - 0.5) * 0.08, 0.0));
    vec3 h = normalize(uSunDir - rd);
    float spec = pow(max(dot(rn, h), 0.0), 90.0) * flMag * 2.4;
    col += uSunCol * spec * sh;
    col *= 1.0 - flMag * 0.30;                              // water film darkens
    col = mix(col, vec3(0.30, 0.42, 0.46), flMag * 0.16);   // thin water tint
    float foamN = vnoise(vec3(p.xz * 2.2 - dir * uTime * 3.4, uTime * 0.3));
    float streak = smoothstep(0.62, 0.95, foamN * (0.45 + flMag)) * flMag * smoothstep(0.35, 0.75, flMag);
    col = mix(col, vec3(0.95), streak * 0.65);
  }
  if(uMode == 5) col = mix(col, vec3(0.05, 0.85, 0.95), flMag * 0.9);
  col = pow(col * uExposure, vec3(1.0 / 2.2));
  outT = length(p - uCamPos);
  return col;
}

// ── water ──
float waveH(vec2 xz, out vec2 slope){
  vec4 fl = flowAt(xz);
  vec2 dir = length(fl.xy) > 1e-4 ? normalize(fl.xy) : vec2(cos(0.7), sin(0.7));
  float cur = clamp(fl.z * 4.5, 0.0, 6.0) * uRenderOpt.w;
  float t = uTime;
  float lambda = max(2.0, uWaterOpt.y);
  float amp = min(max(uWaterOpt.x, 0.0), lambda * 0.14);
  vec2 warp = vec2(vnoise(vec3(xz * 0.16, t * 0.05)) - 0.5);
  vec2 q = xz - dir * t * cur * 0.35 + warp * 0.8;
  float h = 0.0; slope = vec2(0.0);
  for(int i = 0; i < 4; i++){
    float fi = float(i);
    float ang = 0.7 + fi * 1.137;
    vec2 d = fi == 0.0 ? dir : vec2(cos(ang), sin(ang));
    float w = fi == 0.0 ? 0.52 : (fi == 1.0 ? 0.26 : (fi == 2.0 ? 0.14 : 0.08));
    float freq = 6.2831853 / lambda * pow(1.713, fi);
    float phase = dot(q, d) * freq - t * sqrt(9.81 * freq) * 0.42 + fi * 2.413;
    h += amp * w * sin(phase);
    slope += d * (amp * w * freq * cos(phase));
  }
  return h;
}
vec3 shadeWater(vec3 ro, vec3 rd, float tHit, float tTerrain, out float outT){
  vec3 p = ro + rd * tHit;
  vec2 slope = vec2(0.0);
  waveH(p.xz, slope);
  vec3 n = normalize(vec3(-slope.x, 1.0, -slope.y));
  // fine ripples
  float rip = vnoise(vec3(p.xz * 1.7 + uTime * 0.35, uTime * 0.22));
  n = normalize(n + vec3((rip - 0.5) * 0.14, 0.0, (rip - 0.5) * 0.14));
  // bed refraction: short terrain march below the surface
  vec3 bed = vec3(0.10, 0.16, 0.18);
  float depthAtP = 4.0;
  {
    float t = 0.3;
    float maxT = tTerrain > 0.0 ? min(24.0, tTerrain - tHit) : 24.0;
    for(int i = 0; i < 20; i++){
      vec3 q = ro + rd * (tHit + t);
      if(q.y < uLo.y) break;
      float d = terrainSDF(q);
      if(d < uCell * 0.4){
        vec4 tv = terrainFull(q);
        bed = rockAlbedo(q, terrainNormal(q), tv);
        depthAtP = max(p.y - q.y, 0.2);
        break;
      }
      t += clamp(d * 0.7, 0.25, 2.2);
      if(t > maxT) break;
    }
  }
  vec3 absorb = exp(-depthAtP * (2.4 / max(uWaterOpt.w, 0.05)) * vec3(0.42, 0.28, 0.22));
  vec3 refr = bed * absorb;
  float fres = pow(1.0 - max(dot(-rd, n), 0.0), 5.0) * 0.92 + 0.04;
  vec3 refl = skyColor(reflect(rd, n));
  vec3 col = mix(refr, refl, clamp(fres, 0.04, 1.0));
  vec3 h = normalize(uSunDir - rd);
  col += uSunCol * pow(max(dot(n, h), 0.0), 240.0) * 3.2;   // sun glint
  // foam: shore proximity + current strength + crest noise (no tile, world-space)
  float tS = 0.3; float shoreD = 9.0;
  for(int i = 0; i < 14; i++){
    vec3 q = ro + rd * (tHit + tS);
    float d = terrainSDF(q);
    shoreD = min(shoreD, d);
    tS += clamp(d * 0.8, 0.3, 1.6);
    if(tS > 14.0 || d < 0.05) break;
  }
  vec4 fl = flowAt(p.xz);
  float curMag = clamp(fl.z * 2.2, 0.0, 1.0);
  vec2 fdir = length(fl.xy) > 1e-4 ? normalize(fl.xy) : vec2(1.0, 0.0);
  float foamN = vnoise(vec3(p.xz * 1.6 - fdir * uTime * 2.8, uTime * 0.4));
  float foam = smoothstep(0.55, 0.9, foamN * (0.35 + curMag * 0.9)) * curMag * uWaterOpt.z;
  foam += smoothstep(0.9, 0.05, shoreD) * uWaterOpt.z * 0.8 * smoothstep(0.02, 0.5, curMag + 0.25);
  col = mix(col, vec3(0.93, 0.96, 0.97), clamp(foam, 0.0, 0.85));
  if(uMode == 5){
    col = mix(col * 0.25, vec3(0.1, 0.9, 1.0), curMag);
  }
  col = pow(col * uExposure, vec3(1.0 / 2.2));
  outT = tHit;
  return col;
}

void main(){
  vec2 px = gl_FragCoord.xy;
  vec2 ndc = px / uScreen * 2.0 - 1.0;
  vec3 rd = normalize(uCamFwd + uCamRight * ndc.x * uTanFov * (uScreen.x / uScreen.y) + uCamUp * ndc.y * uTanFov);
  vec3 ro = uCamPos;
  vec3 col;
  float outT = 1e6;
  vec2 box = aabbHit(ro, rd);
  bool hit = false;
  if(box.y > max(box.x, 0.0)){
    float t = max(box.x, 0.02) + 0.001;
    float tMax = box.y;
    int steps = int(150.0 * clamp(uRenderOpt.z, 0.4, 1.6));
    float eps = max(uCell * 0.28, t * 0.0006);
    for(int i = 0; i < 240; i++){
      if(i >= steps) break;
      vec3 p = ro + rd * t;
      float d = terrainSDF(p);
      if(d < eps){ hit = true; break; }
      t += max(d * 0.92, 0.02);
      if(t > tMax) break;
      eps = max(uCell * 0.28, t * 0.0006);
    }
    if(hit && t < box.y) outT = t; else hit = false;
  }
  // water plane (global level)
  float tWater = -1.0;
  if(rd.y < -0.005 && uWaterLevel > uLo.y - 1.0 && uWaterLevel < uHi.y){
    float tw = (uWaterLevel - ro.y) / rd.y;
    if(tw > 0.0 && tw < outT && tw < 400.0){
      vec3 wp = ro + rd * tw;
      if(all(greaterThan(wp.xz, uLo.xz - vec2(2.0))) && all(lessThan(wp.xz, uHi.xz + vec2(2.0)))) tWater = tw;
    }
  }
  if(tWater > 0.0 && (!hit || tWater < outT)){
    col = shadeWater(ro, rd, tWater, hit ? outT : -1.0, outT);
  } else if(hit){
    col = shadeTerrain(ro + rd * outT, rd, outT);
  } else {
    col = skyColor(rd);
    col = pow(col * uExposure, vec3(1.0 / 2.2));
    outT = 1e6;
  }
  // depth for particle occlusion: zn = 0.5(1 - A + B/t), A=(f+n)/(n-f), B=2fn/(n-f)
  float zn = 0.5 * (1.0 - uDepthParams.x + uDepthParams.y / max(outT, 0.01));
  gl_FragDepth = clamp(zn, 0.0, 1.0);
  // subtle vignette
  vec2 vq = ndc;
  col *= 1.0 - 0.18 * dot(vq, vq);
  outColor = vec4(col, 1.0);
}
`;

// ── particle sprites: view-aligned instanced quads with a soft round mask ──
export const PARTICLE_VS = `#version 300 es
precision highp float; precision highp sampler2D;
uniform sampler2D uPosAge;
uniform sampler2D uMeta;
uniform sampler2D uSpecies;
uniform ivec2 uPT;
uniform vec3 uCamPos;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform vec3 uCamFwd;
uniform vec2 uScreen;
uniform float uTanFov;
uniform float uSizeMul;
uniform vec2 uDepthParams;
out vec3 vCol;
out float vAlpha;
out vec2 vCorner;
void main(){
  int pid = gl_InstanceID;
  ivec2 puv = ivec2(pid % uPT.x, pid / uPT.x);
  vec4 pa = texelFetch(uPosAge, puv, 0);
  vec4 meta = texelFetch(uMeta, puv, 0);
  vec4 sp = texelFetch(uSpecies, puv, 0);
  vCol = vec3(0.5, 0.75, 1.0); vAlpha = 0.0; vCorner = vec2(0);
  if(pa.w < 0.0){ gl_Position = vec4(0, 0, -2, 1); return; }
  vec3 toCam0 = pa.xyz - uCamPos;
  float z0 = dot(toCam0, uCamFwd);
  if(z0 < 0.25){ gl_Position = vec4(0, 0, -2, 1); return; }
  float kind = meta.x;
  float load = clamp(sp.x * 1.4, 0.0, 1.0);
  if(kind < 0.5)      vCol = mix(vec3(0.45, 0.72, 0.95), vec3(0.85, 0.62, 0.30), load);
  else if(kind < 1.5) vCol = mix(vec3(0.30, 0.55, 0.85), vec3(0.78, 0.60, 0.34), load);
  else                vCol = mix(vec3(0.92, 0.88, 0.78), vec3(0.80, 0.68, 0.42), load);
  vAlpha = kind > 1.5 ? 0.5 : 0.75;
  vCorner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)) * 2.0 - 1.0;
  vec3 toCam = pa.xyz - uCamPos;
  float z = dot(toCam, uCamFwd);
  float aspect = uScreen.x / uScreen.y;
  float zr = max(z, 0.2);
  float x = dot(toCam, uCamRight) / (zr * uTanFov * aspect);
  float y = dot(toCam, uCamUp) / (zr * uTanFov);
  float sizeW = meta.y * uSizeMul;
  float dx = sizeW / (zr * uTanFov * aspect);
  float dy = sizeW / (zr * uTanFov);
  float zndc = -uDepthParams.x + uDepthParams.y / max(z, 0.25);
  gl_Position = vec4(x + vCorner.x * dx, y + vCorner.y * dy, zndc * 0.99999, 1.0);
}
`;

export const PARTICLE_FS = `#version 300 es
precision highp float;
in vec3 vCol;
in float vAlpha;
in vec2 vCorner;
out vec4 outColor;
void main(){
  float r = dot(vCorner, vCorner);
  float a = smoothstep(1.0, 0.35, r) * vAlpha;
  if(a < 0.02) discard;
  outColor = vec4(vCol, a);
}
`;

