// SLATE simulation shaders — GPU multi-agent weathering on the SDF volume.
// Research basis: Hartley, Mellado, Fiorio & Faraj, "Flexible terrain erosion",
// The Visual Computer (2024) — alteration / transport / deposition split with
// independent particle agents on SDF/voxel terrain. Adapted, not reproduced.
//
// Terrain atlas (RGBA32F): R distance · G wetness · B cumulative deposited · A solid fraction.
// Agents: 0 rain · 1 river · 2 wind. Thermal erosion is a column relaxation pass.
// Settling: capacity + Stokes-style deposition + retirement — agents never cut forever.
import { ATLAS_GLSL, NOISE_GLSL } from './common.js';

const PRE = ATLAS_GLSL + NOISE_GLSL + /* glsl */`
uniform sampler2D uTerrain;
uniform sampler2D uPosAge;    // xyz position · w age   (-1 = dead)
uniform sampler2D uVelWater;  // xyz velocity · w water
uniform sampler2D uMeta;      // x type · y brush radius · z diameter mm · w restitution
uniform sampler2D uSpecies;   // x load · y coarse fraction · z detached total · w unused
uniform vec4 uProcess;        // detachment · hardness · deposition · capacity
uniform vec4 uEnv;            // dt · step · seed · wind dir radians
uniform vec4 uRain;           // intensity · grain mm · impact scale · evaporate
uniform vec4 uRiver;          // intensity · speed · brush radius · grain mm
uniform vec4 uWind;           // speed · height · spread · abrasion
uniform vec4 uSpawnW;         // rain · river · wind · reserved weights
uniform vec3 uRiverSrc;       // xz source · z spread
uniform float uMaxDetach;     // per-agent cumulative detach cap (m³)
const float DENSITY = 2650.0;
float lifeOf(float kind){ return kind < 0.5 ? 20.0 : (kind < 1.5 ? 30.0 : 25.0); }
vec3 rockProduct(float kind){
  if(kind < 0.5) return vec3(0.72, 0.28, 0.00);   // rain: mostly fines
  if(kind < 1.5) return vec3(0.35, 0.35, 0.30);   // river: bed mix
  return vec3(0.90, 0.10, 0.00);                  // wind: fine saltation
}
`;

// ── motion: integrate 4 substeps, SDF collision + restitution, respawn ──
export const motionFS = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
${PRE}
layout(location=0) out vec4 outPos;
layout(location=1) out vec4 outVel;
layout(location=2) out vec4 outMeta;
layout(location=3) out vec4 outImpact; // x normal impact speed · y contact · z wetness · w birth
uniform ivec2 uPT;
float rnd(float x){ return hash11(x * 1.618 + uEnv.y * 0.317 + uEnv.z); }
vec3 windVec(){ return vec3(cos(uEnv.w), 0.0, sin(uEnv.w)) * uWind.x; }
void main(){
  ivec2 uv = ivec2(gl_FragCoord.xy);
  int id = uv.y * uPT.x + uv.x;
  vec4 pa = texelFetch(uPosAge, uv, 0);
  vec4 vw = texelFetch(uVelWater, uv, 0);
  vec4 meta = texelFetch(uMeta, uv, 0);
  vec4 sp = texelFetch(uSpecies, uv, 0);
  outPos = pa; outVel = vw; outMeta = meta; outImpact = vec4(0);
  float dt = uEnv.x;

  // ── respawn dead / expired / drained / capped agents ──
  float life = lifeOf(meta.x);
  bool dead = pa.w < 0.0 || pa.w > life || vw.w < 0.015 || sp.z > uMaxDetach;
  bool offWorld = any(lessThan(pa.xyz, uLo + vec3(0.3))) || any(greaterThan(pa.xyz, uHi - vec3(0.3)));
  if(dead || offWorld){
    float pick = rnd(float(id) * 7.31) * (uSpawnW.x + uSpawnW.y + uSpawnW.z);
    float kind = pick < uSpawnW.x ? 0.0 : (pick < uSpawnW.x + uSpawnW.y ? 1.0 : 2.0);
    float totalW = uSpawnW.x + uSpawnW.y + uSpawnW.z;
    if(totalW <= 0.001){ outPos.w = -1.0; outVel = vec4(0); return; }
    float seed = float(id) * 5.13 + uEnv.y * 1.77;
    vec3 p; vec3 v; float radius; float diam; float rest;
    if(kind < 0.5){        // rain: sky birth, drop to the first surface contact
      vec2 xz = uLo.xz + vec2(2.0) + vec2(rnd(seed + 1.0), rnd(seed + 2.0)) * (uHi.xz - uLo.xz - vec2(4.0));
      p = vec3(xz.x, uHi.y - 0.5, xz.y);
      for(int i = 0; i < 110; i++){
        float d = sdf(uTerrain, p);
        if(d < 0.08 || p.y < uLo.y + 0.2) break;
        p.y -= clamp(d * 0.6, 0.05, 2.0);
      }
      float dS = sdf(uTerrain, p);
      p += sdfNormal(uTerrain, p) * (dS < 0.5 ? 0.14 : 1.5);
      v = vec3(uWind.x * 0.25, -2.0, uWind.x * 0.1 * sin(seed));
      radius = 0.55; diam = uRain.y; rest = 0.05;
    } else if(kind < 1.5){ // river: born at the source marker, on the surface
      p = vec3(uRiverSrc.x + (rnd(seed + 3.0) - 0.5) * uRiverSrc.z,
               uHi.y - 0.5,
               uRiverSrc.y + (rnd(seed + 5.0) - 0.5) * uRiverSrc.z);
      for(int i = 0; i < 110; i++){
        float d = sdf(uTerrain, p);
        if(d < 0.08 || p.y < uLo.y + 0.2) break;
        p.y -= clamp(d * 0.6, 0.05, 2.0);
      }
      vec3 n = sdfNormal(uTerrain, p);
      p += n * 0.14;
      v = vec3(n.x, -0.3, n.z) * uRiver.y;
      radius = uRiver.z; diam = uRiver.w; rest = 0.02;
    } else {               // wind: upwind boundary band, aerodynamic birth
      vec2 dir = vec2(cos(uEnv.w), sin(uEnv.w));
      vec2 side = vec2(-dir.y, dir.x);
      float lateral = (rnd(seed + 5.0) - 0.5) * (uHi.x + uHi.z) * 0.9;
      vec2 edge = dir * -1.0 * max(abs(uHi.x) / max(abs(dir.x), 0.15), abs(uHi.z) / max(abs(dir.y), 0.15))
                + side * lateral;
      edge = clamp(edge, uLo.xz + vec2(0.6), uHi.xz - vec2(0.6));
      p = vec3(edge.x, clamp(uWind.y + (rnd(seed + 9.0) - 0.5) * uWind.z, uLo.y + 0.5, uHi.y - 0.5), edge.y);
      v = windVec() * (0.8 + 0.4 * rnd(seed + 11.0));
      radius = 0.50; diam = 0.12; rest = 0.35;
    }
    outPos = vec4(p, 0.0);
    outVel = vec4(v, 1.0);
    outMeta = vec4(kind, radius, diam, rest);
    outImpact = vec4(0, 0, 0, 1);
    return;
  }

  // ── integrate: gravity / wind relaxation / downhill creep, 4 substeps ──
  vec3 p = pa.xyz;
  vec3 v = vw.xyz;
  float water = vw.w;
  float kind = meta.x;
  float load = sp.x;
  float collisionR = max(0.12, min(0.35, meta.y * 0.45));
  float impactN = 0.0; float contact = 0.0; float wet = 0.0;
  for(int i = 0; i < 4; i++){
    float h = dt * 0.25;
    if(kind > 1.5){ // wind: relax toward the wind field, vertical return + settling + gust
      float settle = clamp(meta.z * meta.z * 0.10, 0.02, 1.2) + load * 2.0;
      vec3 air = windVec();
      air.y = (uWind.y - p.y) * 0.4 + sin(p.z * 0.6 + uEnv.y * 0.09) * 0.45 - settle;
      v = mix(v, air, 1.0 - exp(-h * 2.4));
    } else {
      float grav = 1.0 - clamp(load * 0.12, 0.0, 0.35);   // loaded drops fall slower
      v += vec3(uWind.x * 0.06, -9.81 * grav, 0.0) * h;
      v *= exp(-h * 0.25);
      if(kind > 0.5){ // river: biased downhill creep along the surface gradient
        vec3 n = sdfNormal(uTerrain, p);
        vec3 downslope = n - vec3(0.0, 1.0, 0.0);
        v += downslope * (uRiver.y * 3.5) * h;
      }
    }
    v *= min(1.0, 14.0 / max(length(v), 0.001));
    vec3 q = p + v * h;
    float d = sdf(uTerrain, q);
    if(d < collisionR){
      vec3 n = sdfNormal(uTerrain, q);
      q += n * (collisionR - d);
      float inward = min(dot(v, n), 0.0);
      impactN = max(impactN, -inward);
      contact = 1.0;
      v -= (1.0 + meta.w) * inward * n;
      v *= exp(-h * (kind > 1.5 ? 0.8 : 0.5));
      if(kind > 1.5 && length(v) < uWind.x * 0.35 && rnd(float(id) + uEnv.y * 3.1) < 0.35){
        // saltation re-launch: hop downwind instead of grinding the same spot
        vec2 dir = vec2(cos(uEnv.w), sin(uEnv.w));
        v += vec3(dir.x, 0.0, dir.y) * uWind.x * 0.7 + vec3(0.0, 1.4 + rnd(float(id) * 3.7) * 1.2, 0.0);
      }
    }
    p = q;
    wet = max(wet, 1.0 - smoothstep(0.0, 1.2, d));
  }
  float evap = kind < 0.5 ? uRain.w : (kind < 1.5 ? 0.004 : 0.0);
  water *= exp(-dt * evap);
  outPos = vec4(p, pa.w + dt);
  outVel = vec4(v, water);
  outMeta = meta;
  outImpact = vec4(impactN, contact, wet, 0);
}
`;

// ── event: propose detachment / deposition demands, normalize brush weights ──
export const eventFS = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
${PRE}
layout(location=0) out vec4 outDemand;  // x detach m³ · y deposit m³ · z coarseFrac · w kind
layout(location=1) out vec4 outSums;    // x Σk·band·solid · y Σk·band·empty · z speed · w load
uniform sampler2D uImpact;
uniform ivec2 uPT;
void main(){
  ivec2 uv = ivec2(gl_FragCoord.xy);
  int id = uv.y * uPT.x + uv.x;
  outDemand = vec4(0); outSums = vec4(0);
  vec4 pa = texelFetch(uPosAge, uv, 0);
  vec4 vw = texelFetch(uVelWater, uv, 0);
  vec4 meta = texelFetch(uMeta, uv, 0);
  vec4 hit = texelFetch(uImpact, uv, 0);
  vec4 sp = texelFetch(uSpecies, uv, 0);
  if(pa.w < 0.0) return;
  float d = sdf(uTerrain, pa.xyz);
  if(d > 0.30 || d < -0.75) return;                       // not at the interface
  vec3 c = pa.xyz - sdfNormal(uTerrain, pa.xyz) * d;      // project to the zero surface
  float radius = meta.y;
  float kind = meta.x;
  float dt = uEnv.x;
  float speed = length(vw.xyz);
  float water = vw.w;
  float load = sp.x;

  // normalized compact brush weights over the local neighbourhood
  vec2 sums = vec2(0);
  ivec3 center = ivec3(floor((c - uLo) / uCell));
  for(int z = -4; z <= 4; z++)
  for(int y = -4; y <= 4; y++)
  for(int x = -4; x <= 4; x++){
    ivec3 q = center + ivec3(x, y, z);
    if(any(lessThan(q, ivec3(0))) || any(greaterThanEqual(q, uDim))) continue;
    vec4 t = texelFetch(uTerrain, atlasAddr(q), 0);
    float band = 1.0 - smoothstep(BAND_, 2.0 * BAND_, abs(t.r));
    float k = brushKernel(voxelWorld(q), c, radius) * band;
    if(k <= 0.0) continue;
    sums += k * vec2(t.a, 1.0 - t.a);
  }
  float solidSum = max(sums.x, 1e-5);
  float emptySum = max(sums.y, 1e-5);

  // ── mechanics (research-informed coefficients, see docs/EROSION.md) ──
  float strata = 0.5 + 0.5 * sin(c.y * 0.55);                       // bedding bands
  float critical = 0.15 + uProcess.y * 1.55 + strata * 0.25;        // critical shear
  float stress = sqrt(speed / max(0.12, radius * 0.5));             // shear stress proxy
  float hemisphere = 2.0944 * radius * radius * radius;             // affected volume
  float capacity = (0.02 + uProcess.w * 0.30) * water * (0.15 + 0.35 * speed);
  float detach = 0.0;
  float coarseFrac = 0.3;
  if(kind < 0.5){                       // rain: thresholded impact + shear detachment
    float sizeF = clamp(meta.z / 3.0, 0.3, 3.0);
    detach = uProcess.x * max(stress - critical, 0.0) * hemisphere * 0.22 * dt * sizeF;
    detach += uProcess.x * uRain.z * 0.05 * impactN * impactN * hemisphere * dt;
    coarseFrac = 0.18;
  } else if(kind < 1.5){                // river: current-driven bed/bank shear
    detach = uProcess.x * max(stress - critical * 0.8, 0.0) * hemisphere * 0.30 * dt;
    coarseFrac = 0.42;
  } else {                              // wind: speed/contact abrasion, dry
    float abrasion = max(hit.x * 0.8, speed * 0.16);
    detach = uProcess.x * uWind.w * abrasion * hemisphere * 0.25 * dt * clamp(0.4 + strata, 0.2, 1.6);
    coarseFrac = 0.06;
  }
  float roomLeft = max(0.0, 1.0 - sp.z / uMaxDetach);   // cumulative-cut cap: no infinite holes
  detach = min(detach * roomLeft, capacity + 0.002);
  detach = min(detach, solidSum * voxelVolume() * 0.30);
  // deposition: Stokes-style settling — slow, loaded agents drop their cargo
  float settle = load * uProcess.z * dt * (0.9 / (0.10 + speed * speed * 0.35));
  settle = min(settle, load);
  float deposit = settle * emptySum * voxelVolume() * 0.5;
  outDemand = vec4(detach, deposit, coarseFrac, kind);
  outSums = vec4(sums.x, sums.y, speed, load);
}
`;

// ── scatter: instanced quads accumulate demands into the exchange atlas ──
export const scatterVS = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
${PRE}
uniform sampler2D uDemand;
uniform sampler2D uSums;
uniform ivec2 uPT;
uniform float uFoot;         // footprint half-extent in voxels (max 4)
out vec3 vCenter;
out vec4 vDemand;
out vec4 vSums;
out float vRadius;
void main(){
  int inst = gl_InstanceID;
  int pid = inst / 9;
  int slice = inst - pid * 9 - 4;              // -4 .. +4
  ivec2 puv = ivec2(pid % uPT.x, pid / uPT.x);
  vec4 pa = texelFetch(uPosAge, puv, 0);
  vec4 dem = texelFetch(uDemand, puv, 0);
  vec4 meta = texelFetch(uMeta, puv, 0);
  vCenter = vec3(0); vDemand = vec4(0); vSums = vec4(0); vRadius = 0.5;
  if(pa.w < 0.0 || dem.x + dem.y <= 0.0){ gl_Position = vec4(0, 0, 0, 1); return; }
  vec3 n = sdfNormal(uTerrain, pa.xyz);
  float d = sdf(uTerrain, pa.xyz);
  vec3 c = pa.xyz - n * d;
  vCenter = c;
  vDemand = dem;
  vSums = texelFetch(uSums, puv, 0);
  vRadius = meta.y;
  ivec3 ci = ivec3(floor((c - uLo) / uCell));
  int z = clamp(ci.z + slice, 0, uDim.z - 1);
  int N = int(uFoot);
  vec2 px = vec2(float((z % 16) * uDim.x + ci.x - N), float((z / 16) * uDim.y + ci.y - N));
  vec2 wh = vec2(float(2 * N + 1));
  vec2 corner = px + wh * vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vec2 ndc = corner / vec2(uAtlasSize) * 2.0 - 1.0;
  gl_Position = vec4(ndc.x, ndc.y, 0.0, 1.0);
}
`;

export const scatterFS = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
${PRE}
uniform sampler2D uSums;
in vec3 vCenter;
in vec4 vDemand;
in vec4 vSums;
in float vRadius;
layout(location=0) out vec4 outExchange;
void main(){
  ivec3 q = addrVoxel(ivec2(gl_FragCoord.xy));
  vec3 w = voxelWorld(q);
  float k = brushKernel(w, vCenter, vRadius);
  if(k <= 0.0) discard;
  vec4 t = texelFetch(uTerrain, atlasAddr(q), 0);
  float band = 1.0 - smoothstep(BAND_, 2.0 * BAND_, abs(t.r));
  float ws = k * band * t.a;
  float we = k * band * (1.0 - t.a);
  float e = vDemand.x * ws / max(vSums.x, 1e-5);          // erode volume (m³)
  float dep = vDemand.y * we / max(vSums.y, 1e-5);        // deposit volume (m³)
  float wet = k * band * 0.02;
  outExchange = vec4(e, dep, dep * vDemand.z, wet);
}
`;

// ── acceptance: clamp against occupancy, update terrain, write accept ratios ──
export const acceptFS = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
${PRE}
uniform sampler2D uExchange;
layout(location=0) out vec4 outTerrain;
layout(location=1) out vec4 outAccept;   // x rE · y rD · z |Δa| · w aNew
uniform float uWetDecay;
void main(){
  ivec2 uv = ivec2(gl_FragCoord.xy);
  vec4 t = texelFetch(uTerrain, uv, 0);
  vec4 ex = texelFetch(uExchange, uv, 0);
  float vv = voxelVolume();
  float E = ex.r / vv;                    // erode demand in voxel units
  float D = ex.g / vv;
  float a = t.a;
  float acceptedE = min(E, a);
  float acceptedD = min(D, (1.0 - a) + acceptedE);
  float aNew = clamp(a + acceptedD - acceptedE, 0.0, 1.0);
  float rE = E > 1e-7 ? acceptedE / E : 0.0;
  float rD = D > 1e-7 ? acceptedD / D : 0.0;
  // distance re-anchor: partial occupancy defines the interface
  float d = t.r;
  if(aNew > 0.02 && aNew < 0.98){
    d = (0.5 - aNew) * uCell;
  } else if(aNew >= 0.98){
    d = min(t.r, -0.5 * uCell);
  } else {
    d = max(t.r, 0.5 * uCell);
  }
  d = clamp(d, -200.0, 200.0);
  float wet = clamp(t.g * uWetDecay + ex.a, 0.0, 1.0);
  float dep = t.b + acceptedD;
  outTerrain = vec4(d, wet, dep, aNew);
  outAccept = vec4(rE, rD, abs(aNew - a), aNew);
}
`;

// ── feedback: return accepted ratios to the agents, update cargo (mass-aware) ──
export const feedbackFS = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
${PRE}
uniform sampler2D uAccept;
uniform sampler2D uDemand;
uniform sampler2D uSums;
layout(location=0) out vec4 outSpecies;   // x load · y coarseFrac · z detached total · w free
uniform ivec2 uPT;
uniform float uAttrition;
void main(){
  ivec2 uv = ivec2(gl_FragCoord.xy);
  vec4 pa = texelFetch(uPosAge, uv, 0);
  vec4 sp = texelFetch(uSpecies, uv, 0);
  outSpecies = vec4(max(sp.x, 0.0), sp.y, sp.z, 0.0);
  if(pa.w < 0.0) return;
  vec4 meta = texelFetch(uMeta, uv, 0);
  vec4 dem = texelFetch(uDemand, uv, 0);
  float load = sp.x;
  if(dem.x + dem.y <= 0.0) return;
  // gather accepted ratios over the same compact brush
  vec3 n = sdfNormal(uTerrain, pa.xyz);
  float d0 = sdf(uTerrain, pa.xyz);
  vec3 c = pa.xyz - n * d0;
  float radius = meta.y;
  float sumW = 0.0; float accE = 0.0; float accD = 0.0; float accCoarse = 0.0;
  ivec3 center = ivec3(floor((c - uLo) / uCell));
  for(int z = -4; z <= 4; z++)
  for(int y = -4; y <= 4; y++)
  for(int x = -4; x <= 4; x++){
    ivec3 q = center + ivec3(x, y, z);
    if(any(lessThan(q, ivec3(0))) || any(greaterThanEqual(q, uDim))) continue;
    vec4 t = texelFetch(uTerrain, atlasAddr(q), 0);
    float band = 1.0 - smoothstep(BAND_, 2.0 * BAND_, abs(t.r));
    float k = brushKernel(voxelWorld(q), c, radius) * band;
    if(k <= 0.0) continue;
    vec4 acc = texelFetch(uAccept, atlasAddr(q), 0);
    vec4 ex = texelFetch(uExchange, atlasAddr(q), 0);
    sumW += k;
    accE += k * acc.x;
    accD += k * acc.y;
    accCoarse += k * acc.y * (ex.g > 1e-7 ? ex.b / ex.g : 0.0);
  }
  sumW = max(sumW, 1e-5);
  float fE = clamp(accE / sumW, 0.0, 1.0);
  float fD = clamp(accD / sumW, 0.0, 1.0);
  float kind = meta.x;
  vec3 product = rockProduct(kind);
  float detachedVox = (dem.x * fE) / voxelVolume();
  float depositedVox = (dem.y * fD) / voxelVolume();
  float coarseMass = load * sp.y;
  float fineMass = load - coarseMass;
  // deposition preferentially drops coarse grains; fines travel further
  float dropCoarse = min(coarseMass, depositedVox * (0.35 + 0.65 * sp.y));
  float dropFine = min(fineMass, max(0.0, depositedVox - dropCoarse));
  coarseMass -= dropCoarse; fineMass -= dropFine;
  // detachment adds the agent's rock product
  coarseMass += detachedVox * product.z;
  fineMass += detachedVox * (product.x + product.y);
  // statistical attrition: coarse chips grind down to fines (mass preserving)
  float speed = length(texelFetch(uVelWater, uv, 0).xyz);
  float grind = exp(-uEnv.x * uAttrition * (0.4 + speed * 0.12));
  coarseMass *= grind;
  float newLoad = coarseMass + fineMass;
  float newCoarse = newLoad > 1e-6 ? coarseMass / newLoad : 0.0;
  outSpecies = vec4(newLoad, clamp(newCoarse, 0.0, 1.0), sp.z + dem.x * fE, 0.0);
}
`;

// ── repair: one relaxed pass restoring useful distance magnitudes near the band ──
export const repairFS = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
${PRE}
layout(location=0) out vec4 outTerrain;
void main(){
  ivec2 uv = ivec2(gl_FragCoord.xy);
  vec4 t = texelFetch(uTerrain, uv, 0);
  float a = t.a;
  float d = t.r;
  if(a > 0.02 && a < 0.98){
    d = (0.5 - a) * uCell;                      // partial voxels anchor the interface
  } else {
    ivec3 q = addrVoxel(uv);
    float best = abs(d);
    for(int i = 0; i < 6; i++){
      ivec3 o = ivec3(0);
      if(i == 0) o.x = 1; else if(i == 1) o.x = -1;
      else if(i == 2) o.y = 1; else if(i == 3) o.y = -1;
      else if(i == 4) o.z = 1; else o.z = -1;
      ivec3 nq = q + o;
      if(any(lessThan(nq, ivec3(0))) || any(greaterThanEqual(nq, uDim))) continue;
      float nd = texelFetch(uTerrain, atlasAddr(nq), 0).r;
      best = min(best, abs(nd) + uCell);
    }
    d = (d >= 0.0 ? 1.0 : -1.0) * min(best, 199.0);
  }
  outTerrain = vec4(d, t.g, t.b, t.a);
}
`;

// ── height reduce: top solid surface height per column (thermal + export) ──
export const heightFS = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
${PRE}
layout(location=0) out vec4 outHeight; // x top world y · y z min of a · z free · w free
void main(){
  ivec2 col = ivec2(gl_FragCoord.xy);
  float top = uLo.y - 2.0;
  for(int y = uDim.y - 1; y >= 0; y--){
    vec4 t = texelFetch(uTerrain, atlasAddr(ivec3(col.x, y, col.y)), 0);
    if(t.a > 0.5){ top = uLo.y + (float(y) + 0.5) * uCell; break; }
  }
  outHeight = vec4(top, 0.0, 0.0, 0.0);
}
`;

// ── thermal: talus relaxation — material slides when slope exceeds the friction angle ──
export const thermalFS = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
${PRE}
uniform sampler2D uHeight;    // per-column top height (DIM.x × DIM.z)
layout(location=0) out vec4 outTerrain;
uniform float uTalus;         // friction angle tangent
uniform float uRate;          // 0..1 per step
void main(){
  ivec2 uv = ivec2(gl_FragCoord.xy);
  vec4 t = texelFetch(uTerrain, uv, 0);
  ivec3 q = addrVoxel(uv);
  vec2 huv = vec2(q.x, q.z) + vec2(0.5);
  float myTop = texelFetch(uHeight, ivec2(huv), 0).r;
  float lowTop = myTop; ivec2 lowC = ivec2(huv);
  for(int i = 0; i < 4; i++){
    ivec2 o = i == 0 ? ivec2(1, 0) : i == 1 ? ivec2(-1, 0) : i == 2 ? ivec2(0, 1) : ivec2(0, -1);
    ivec2 hc = ivec2(huv) + o;
    if(any(lessThan(hc, ivec2(0))) || any(greaterThanEqual(hc, ivec2(uDim.x, uDim.z)))) continue;
    float nt = texelFetch(uHeight, hc, 0).r;
    if(nt < lowTop){ lowTop = nt; lowC = hc; }
  }
  float slope = (myTop - lowTop) / uCell;
  if(slope <= uTalus){ outTerrain = t; return; }
  float move = min((slope - uTalus) * uCell * uRate, uCell * 0.5);   // metres this step
  float yWorld = uLo.y + (float(q.y) + 0.5) * uCell;
  float a = t.a;
  bool isMine = q.x == ivec2(huv).x && q.z == ivec2(huv).y;
  bool isLow = q.x == lowC.x && q.z == lowC.y;
  if(isMine && abs(yWorld - myTop) <= uCell * 0.55){
    a = clamp(a - move / uCell * 0.6, 0.0, 1.0);
  }
  if(isLow && abs(yWorld - lowTop) <= uCell * 0.55 && move > 0.0){
    a = clamp(a + move / uCell * 0.6, 0.0, 1.0);
  }
  float d = (a > 0.02 && a < 0.98) ? (0.5 - a) * uCell
          : (a >= 0.98 ? min(t.r, -0.5 * uCell) : max(t.r, 0.5 * uCell));
  d = clamp(d, -200.0, 200.0);
  float dep = t.b + max(a - t.a, 0.0);
  outTerrain = vec4(d, t.g, dep, a);
}
`;

// ── flow map: persistent 2D accumulation of current direction / magnitude ──
export const flowDecayFS = `#version 300 es
precision highp float; precision highp sampler2D;
uniform sampler2D uFlow;
uniform float uDecay;
out vec4 outFlow;
void main(){
  vec4 f = texelFetch(uFlow, ivec2(gl_FragCoord.xy), 0);
  outFlow = f * uDecay;
}
`;

export const flowSplatVS = `#version 300 es
precision highp float; precision highp sampler2D;
uniform sampler2D uPosAge;
uniform sampler2D uVelWater;
uniform sampler2D uMeta;
uniform ivec2 uPT;
uniform vec2 uFlowRes;
uniform vec3 uLo;
uniform vec3 uHi;
out vec3 vVel;
out float vKind;
void main(){
  int pid = gl_InstanceID;
  ivec2 puv = ivec2(pid % uPT.x, pid / uPT.x);
  vec4 pa = texelFetch(uPosAge, puv, 0);
  vec4 vw = texelFetch(uVelWater, puv, 0);
  float kind = texelFetch(uMeta, puv, 0).x;
  vVel = vw.xyz; vKind = kind;
  if(pa.w < 0.0){ gl_Position = vec4(0, 0, 0, 1); return; }
  vec2 uv = (pa.xz - uLo.xz) / (uHi.xz - uLo.xz);
  vec2 px = uv * uFlowRes;
  float s = 3.0;
  vec2 corner = px + vec2(s) * vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vec2 n2 = corner / uFlowRes * 2.0 - 1.0;
  gl_Position = vec4(n2.x, n2.y, 0.0, 1.0);
}
`;

export const flowSplatFS = `#version 300 es
precision highp float; precision highp sampler2D;
in vec3 vVel;
in float vKind;
layout(location=0) out vec4 outFlow;
void main(){
  float speed = length(vVel);
  if(speed < 0.05) discard;
  float wet = vKind < 1.5 ? 1.0 : 0.35;
  vec2 dir = normalize(vVel.xz + vec2(1e-4, 0.0));
  float str = 0.06 * wet * clamp(speed * 0.4, 0.2, 2.5);
  outFlow = vec4(dir * str, str * 0.35, wet * 0.02);
}
`;

// ── particle count reduce (1×1, polled occasionally) ──
export const countFS = `#version 300 es
precision highp float; precision highp sampler2D;
uniform sampler2D uPosAge;
uniform ivec2 uPT;
out vec4 outCount;
void main(){
  float n = 0.0;
  for(int y = 0; y < 128; y++){
    if(y >= uPT.y) break;
    for(int x = 0; x < 128; x++){
      if(x >= uPT.x) break;
      if(texelFetch(uPosAge, ivec2(x, y), 0).w >= 0.0) n += 1.0;
    }
  }
  outCount = vec4(n, 0.0, 0.0, 0.0);
}
`;
