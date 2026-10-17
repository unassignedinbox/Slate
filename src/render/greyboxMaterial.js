// Procedural greybox material.
//
// One MeshStandardMaterial for the whole level. Patterns are computed in the
// fragment shader from the baked pattern-space position (gpos) and surface kind
// (gkind) - see core/geo.js:
//   PLAIN 1 m / 4 m prototype grid      FACADE window bays per 3 m floor (+ variants)
//   ROAD  lane paint in route space     CUT    fresh fracture: dark, rough, mottled
//   ROOF  tile courses                  STONE  masonry courses
//   FLOOR boards, PAVE slabs, GRASS/SOIL noise, WATER/GLASS/METAL sheen
// Everything is anti-aliased with screen-space derivatives and fades out before it
// can shimmer, so the blockout stays readable at speed and at distance.
import * as THREE from 'three';

const GLSL_HELPERS = /* glsl */`
varying vec3 vGpos;
varying vec3 vObjN;
varying float vGkind;

float gbHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float gbNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(gbHash(i), gbHash(i + vec2(1.0, 0.0)), f.x), mix(gbHash(i + vec2(0.0, 1.0)), gbHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
// lines of world width w every sp metres; fades out when they get dense on screen
float gbLines(vec2 p, float sp, float w) {
  vec2 q = p / sp;
  vec2 fw = max(fwidth(q), vec2(1e-5));
  vec2 d = abs(fract(q - 0.5) - 0.5);
  vec2 lw = vec2(w / sp);
  vec2 a = 1.0 - smoothstep(lw - fw, lw + fw, d);
  float l = max(a.x, a.y);
  return l * (1.0 - smoothstep(0.08, 0.22, max(fw.x, fw.y)));
}
float gbLine1(float x, float sp, float w) {
  float q = x / sp;
  float fw = max(fwidth(q), 1e-5);
  float d = abs(fract(q - 0.5) - 0.5);
  float lw = w / sp;
  return (1.0 - smoothstep(lw - fw, lw + fw, d)) * (1.0 - smoothstep(0.08, 0.22, fw));
}
// anti-aliased rectangle mask with an explicit derivative (for wrapped coordinates)
float gbBox(vec2 p, vec2 lo, vec2 hi, vec2 fw) {
  vec2 a = smoothstep(lo - fw, lo + fw, p) * (1.0 - smoothstep(hi - fw, hi + fw, p));
  return a.x * a.y;
}

void greybox(inout vec3 col, inout float rough, inout float metal) {
  float kindF = vGkind + 0.002;
  float kind = floor(kindF);
  float variant = fract(kindF);
  vec3 n = normalize(vObjN);
  vec3 an = abs(n);
  bool top = an.y > max(an.x, an.z);
  vec2 uv = top ? vGpos.xz : (an.x > an.z ? vGpos.zy : vGpos.xy);
  float minor = gbLines(uv, 1.0, 0.012);
  float major = gbLines(uv, 4.0, 0.028);
  float grid = max(minor * 0.4, major);

  if (kind < 0.5) {                       // PLAIN
    col *= 1.0 - grid * 0.17;
  } else if (kind < 1.5) {                // FACADE
    col *= 1.0 - grid * 0.05;
    if (an.y < 0.6) {
      float u = an.x > an.z ? vGpos.z : vGpos.x;
      float v = vGpos.y;
      vec2 fw = max(fwidth(vec2(u, v)), vec2(1e-4));
      float floorH = 3.0, bay = 2.6, ww = 1.15, wh = 1.45, sill = 0.95;
      bool church = variant > 0.4 && variant < 0.6;
      bool shed = variant > 0.65;
      if (church) { floorH = 1000.0; bay = 4.0; ww = 1.25; wh = 5.8; sill = 2.2; }
      if (shed) { floorH = 1000.0; bay = 3.4; ww = 2.7; wh = 1.3; sill = 5.6; }
      float fy = mod(v, floorH);
      float fx = mod(u + bay * 0.5, bay) - bay * 0.5;
      float win = gbBox(vec2(fx, fy), vec2(-ww * 0.5, sill), vec2(ww * 0.5, sill + wh), fw);
      if (church) {
        // pointed head: narrow the top of the lancet
        float t = clamp((fy - (sill + wh - 1.1)) / 1.1, 0.0, 1.0);
        win *= step(abs(fx), ww * 0.5 * (1.0 - t * t * 0.95));
      }
      if (variant > 0.2 && variant < 0.3 && v < 3.0) win = max(win, gbBox(vec2(fx, v), vec2(-1.2, 0.35), vec2(1.2, 2.75), fw));
      if (!church && !shed && v < 3.0 && abs(u) < 0.6 && n.z > 0.5) win = max(win, gbBox(vec2(u, v), vec2(-0.55, 0.0), vec2(0.55, 2.2), fw) * 0.8);
      win *= step(0.25, v);
      col = mix(col, vec3(0.19, 0.22, 0.25), win * 0.88);
      rough = mix(rough, 0.32, win);
      metal = mix(metal, 0.1, win);
      if (!church && !shed) col *= 1.0 - 0.10 * gbLine1(v, floorH, 0.035);
    }
  } else if (kind < 2.5) {                // ROAD: gpos.x lateral, gpos.z route station
    float x = vGpos.x, s = vGpos.z;
    vec2 fw = max(fwidth(vec2(x, s)), vec2(1e-4));
    float dash = gbBox(vec2(x, mod(s, 9.0)), vec2(-0.08, 0.0), vec2(0.08, 4.5), fw);
    float edge = gbBox(vec2(abs(x), 0.5), vec2(3.95, 0.0), vec2(4.1, 1.0), fw);
    col = mix(col, vec3(0.80, 0.79, 0.74), max(dash, edge) * 0.85);
    col *= 0.93 + 0.1 * gbNoise(vGpos.xz * vec2(1.3, 0.6));
    col *= 1.0 - minor * 0.04;
    rough = 0.96;
  } else if (kind < 3.5) {                // CUT
    col *= 0.78 + 0.32 * gbNoise(uv * 2.7) + 0.08 * gbNoise(uv * 11.0);
    rough = 1.0;
  } else if (kind < 4.5) {                // ROOF tiles
    float rows = gbLine1(vGpos.y, variant > 0.4 ? 0.45 : 0.3, 0.025);
    col *= 1.0 - rows * 0.24;
    col *= 0.94 + 0.09 * gbNoise(vGpos.xz * 0.9);
  } else if (kind < 5.5) {                // GRASS
    col *= 0.9 + 0.16 * gbNoise(vGpos.xz * 0.45) + 0.05 * gbNoise(vGpos.xz * 3.1);
    col *= 1.0 - grid * 0.05;
  } else if (kind < 6.5) {                // SOIL
    col *= 0.76 + 0.34 * gbNoise(uv * 0.9) + 0.06 * gbNoise(uv * 6.0);
    rough = 1.0;
  } else if (kind < 7.5) {                // FLOOR boards
    float boards = gbLine1(vGpos.x, 0.21, 0.01);
    col *= 1.0 - boards * 0.25;
    col *= 0.93 + 0.1 * gbNoise(vec2(vGpos.x * 4.6, vGpos.z * 0.35));
  } else if (kind < 8.5) {                // WATER
    rough = 0.18;
    col *= 0.88 + 0.14 * gbNoise(vGpos.xz * 0.35);
  } else if (kind < 9.5) {                // GLASS
    rough = 0.15; metal = 0.15;
  } else if (kind < 10.5) {               // PAVE
    float slabs = gbLines(uv, 1.25, 0.02);
    col *= 1.0 - slabs * 0.17;
    col *= 0.94 + 0.08 * gbNoise(uv * 0.6);
  } else if (kind < 11.5) {               // PROP
    rough = 0.78;
  } else if (kind < 12.5) {               // STONE courses
    vec2 st = top ? vGpos.xz : vec2(an.x > an.z ? vGpos.z : vGpos.x, vGpos.y);
    float row = floor(st.y / 0.55);
    float bricks = max(gbLine1(st.y, 0.55, 0.022), gbLine1(st.x + mod(row, 2.0) * 0.55, 1.1, 0.022) * (top ? 0.5 : 1.0));
    col *= 1.0 - bricks * 0.2;
    col *= 0.92 + 0.11 * gbNoise(st * 1.1);
  } else if (kind < 13.5) {               // METAL
    rough = 0.42; metal = 0.4;
  } else if (kind < 14.5) {               // FLATROOF
    col *= 1.0 - grid * 0.13;
    col *= 0.95 + 0.07 * gbNoise(vGpos.xz * 0.3);
  } else if (kind < 15.5) {               // MARK
  } else if (kind < 16.5) {               // CURTAIN: towers (variant: 0 glass, .25 ribbon, .5 precast grid, .75 stone)
    if (an.y < 0.6) {
      float u = an.x > an.z ? vGpos.z : vGpos.x;
      float v = vGpos.y;
      vec2 fw = max(fwidth(vec2(u, v)), vec2(1e-4));
      float floorH = 3.8, mull = 1.5, glassLo = 0.95, glassHi = 3.65, mw = 0.07;
      vec3 glassC = vec3(0.30, 0.34, 0.37);
      if (variant > 0.2 && variant < 0.4) { mull = 6.0; glassLo = 1.35; glassHi = 2.9; mw = 0.12; }
      else if (variant > 0.4 && variant < 0.6) { mull = 1.9; glassLo = 0.8; glassHi = 3.0; mw = 0.34; glassC = vec3(0.26, 0.28, 0.30); }
      else if (variant > 0.6) { floorH = 3.6; mull = 2.4; glassLo = 1.0; glassHi = 2.7; mw = 0.7; glassC = vec3(0.24, 0.26, 0.28); }
      float fy = mod(v, floorH);
      float fx = mod(u, mull);
      float g = gbBox(vec2(fx, fy), vec2(mw * 0.5, glassLo), vec2(mull - mw * 0.5, glassHi), fw);
      float far = smoothstep(0.08, 0.3, max(fw.x, fw.y)); // far away: average it out
      g = mix(g, (glassHi - glassLo) / floorH * (1.0 - mw / mull), far);
      col = mix(col, glassC, g * 0.92);
      rough = mix(rough, 0.18, g);
      metal = mix(metal, 0.25, g);
      col *= 1.0 - 0.12 * gbLine1(v, floorH, 0.05) * (1.0 - far);
    } else {
      col *= 1.0 - grid * 0.12;
    }
  } else if (kind < 17.5) {               // STRATA: torn ground, layered
    float y = vGpos.y + 1.6 * gbNoise(vGpos.xz * 0.05 + vGpos.y * 0.01);
    float band = floor(y / 2.7);
    float t = gbHash(vec2(band, 3.7));
    col *= 0.72 + 0.42 * t;
    col *= 0.84 + 0.22 * gbNoise(uv * 0.8) + 0.06 * gbNoise(uv * 5.0);
    col *= 1.0 - 0.18 * gbLine1(y, 2.7, 0.06);
    rough = 1.0;
  } else if (kind < 18.5) {               // LANES: multi-lane carriageway, half-width = variant * 40 m
    float x = vGpos.x, s = vGpos.z, hw = variant * 40.0;
    vec2 fw = max(fwidth(vec2(x, s)), vec2(1e-4));
    float ax = abs(x);
    float paint = gbBox(vec2(ax, 0.5), vec2(0.1, 0.0), vec2(0.26, 1.0), fw);
    float k = floor(ax / 3.5 + 0.5);
    if (k >= 1.0 && k * 3.5 < hw - 1.6) paint = max(paint, gbBox(vec2(ax - k * 3.5, mod(s, 9.0)), vec2(-0.08, 0.0), vec2(0.08, 3.0), fw));
    paint = max(paint, gbBox(vec2(ax, 0.5), vec2(hw - 0.6, 0.0), vec2(hw - 0.42, 1.0), fw));
    col = mix(col, vec3(0.80, 0.79, 0.74), paint * 0.85);
    col *= 0.93 + 0.1 * gbNoise(vGpos.xz * vec2(1.3, 0.6));
    col *= 1.0 - minor * 0.03;
    rough = 0.96;
  }
}
`;

export function createGreyboxMaterial(opts = {}) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0.0, ...opts });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec3 gpos;
attribute float gkind;
varying vec3 vGpos;
varying vec3 vObjN;
varying float vGkind;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vGpos = gpos; vObjN = normal; vGkind = gkind;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
${GLSL_HELPERS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
float gbRough = 1.0; float gbMetal = 0.0;
greybox(diffuseColor.rgb, gbRough, gbMetal);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = min(roughnessFactor, gbRough < 0.99 ? gbRough : roughnessFactor);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
metalnessFactor = max(metalnessFactor, gbMetal);`);
  };
  mat.customProgramCacheKey = () => 'greybox-v3';
  return mat;
}
