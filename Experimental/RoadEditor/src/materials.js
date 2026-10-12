//==================================================================================================
//  ROADEDITOR — MATERIALS
//==================================================================================================
//  Every surface is procedural: the vertex carries a material id in its colour alpha channel and
//  the fragment shader turns that into an albedo, a roughness and a bump pattern. No textures, no
//  material switching, one draw pass for the whole city.
//==================================================================================================

export const MATERIAL_GLSL = /* glsl */ `
const int MAT_ASPHALT = 0;
const int MAT_ASPHALT_LIGHT = 1;
const int MAT_CONCRETE = 2;
const int MAT_COBBLE = 3;
const int MAT_PAVER = 4;
const int MAT_PAINT_WHITE = 5;
const int MAT_PAINT_YELLOW = 6;
const int MAT_PAINT_RED = 7;
const int MAT_PAINT_GREEN = 8;
const int MAT_PAINT_BLUE = 9;
const int MAT_DIRT = 10;
const int MAT_GRAVEL = 11;
const int MAT_GRASS = 12;
const int MAT_SAND = 13;
const int MAT_ROCK = 14;
const int MAT_METAL = 15;
const int MAT_RUBBER = 16;
const int MAT_BALLAST = 17;
const int MAT_RAILSTEEL = 18;
const int MAT_WOOD = 19;
const int MAT_TUNNEL_WALL = 20;
const int MAT_TUNNEL_FLOOR = 21;
const int MAT_WATER = 22;
const int MAT_GLASS = 23;
const int MAT_SIGN_FACE = 24;
const int MAT_MARK_WHITE = 25;
const int MAT_MARK_YELLOW = 26;
const int MAT_MARK_RED = 27;
const int MAT_MARK_BLUE = 28;
const int MAT_MARK_GREEN = 29;
const int MAT_FOLIAGE = 30;
const int MAT_MARK_AMBER = 31;

float matHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float matNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = matHash(i);
  float b = matHash(i + vec2(1.0, 0.0));
  float c = matHash(i + vec2(0.0, 1.0));
  float d = matHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float matFbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * matNoise(p);
    p *= 2.07;
    a *= 0.5;
  }
  return s;
}

struct MatInfo {
  vec3 albedo;
  float roughness;
  float metallic;
  float bump;
};

MatInfo matLookup(int id, vec3 world, vec3 nrm, vec3 tint) {
  MatInfo m;
  m.albedo = tint;
  m.roughness = 0.8;
  m.metallic = 0.0;
  m.bump = 0.0;
  vec2 uv = world.xy;
  float grain = matFbm(uv * 3.5);
  float fine = matNoise(uv * 26.0);
  // Aggregate is read most from oblique angles, so weight the pattern by the surface normal.
  float steep = 1.0 - abs(nrm.z);

  if (id == MAT_ASPHALT) {
    m.albedo = tint * (0.156 + grain * 0.05 + fine * 0.03);
    m.roughness = 0.92 - fine * 0.05;
    m.bump = (grain - 0.5) * 0.35 + (fine - 0.5) * 0.4;
  } else if (id == MAT_ASPHALT_LIGHT) {
    m.albedo = tint * (0.235 + grain * 0.06 + fine * 0.035);
    m.roughness = 0.88;
    m.bump = (grain - 0.5) * 0.3 + (fine - 0.5) * 0.45;
  } else if (id == MAT_CONCRETE) {
    float joints = smoothstep(0.02, 0.0, abs(fract(uv.y * 0.22) - 0.5) - 0.47);
    m.albedo = tint * (0.62 + grain * 0.06) * (1.0 - joints * 0.25);
    m.roughness = 0.82;
    m.bump = (grain - 0.5) * 0.2 + joints * 0.6;
  } else if (id == MAT_COBBLE) {
    vec2 cell = uv * 2.4;
    vec2 f = fract(cell) - 0.5;
    float d = length(f);
    float stone = smoothstep(0.42, 0.34, d);
    m.albedo = tint * (0.35 + stone * 0.22 + grain * 0.05);
    m.roughness = 0.75;
    m.bump = (stone - 0.5) * 0.9;
  } else if (id == MAT_PAVER) {
    vec2 cell = uv * 3.1;
    vec2 f = fract(cell) - 0.5;
    float stone = smoothstep(0.47, 0.4, max(abs(f.x), abs(f.y)));
    m.albedo = tint * (0.44 + stone * 0.16 + grain * 0.05);
    m.roughness = 0.8;
    m.bump = (stone - 0.5) * 0.7;
  } else if (id == MAT_MARK_WHITE) {
    m.albedo = vec3(0.86, 0.86, 0.84) * (0.94 + grain * 0.06);
    m.roughness = 0.55;
    m.bump = (grain - 0.5) * 0.2;
  } else if (id == MAT_MARK_YELLOW) {
    m.albedo = vec3(0.92, 0.78, 0.22) * (0.94 + grain * 0.06);
    m.roughness = 0.55;
  } else if (id == MAT_MARK_RED) {
    m.albedo = vec3(0.71, 0.16, 0.13);
    m.roughness = 0.6;
  } else if (id == MAT_MARK_BLUE) {
    m.albedo = vec3(0.14, 0.31, 0.6);
    m.roughness = 0.6;
  } else if (id == MAT_MARK_GREEN) {
    m.albedo = vec3(0.15, 0.52, 0.25);
    m.roughness = 0.6;
  } else if (id == MAT_MARK_AMBER) {
    m.albedo = vec3(0.95, 0.62, 0.12);
    m.roughness = 0.4;
  } else if (id == MAT_PAINT_WHITE) {
    m.albedo = tint * 0.9;
    m.roughness = 0.5;
  } else if (id == MAT_PAINT_YELLOW) {
    m.albedo = tint * vec3(0.95, 0.8, 0.2);
    m.roughness = 0.5;
  } else if (id == MAT_PAINT_RED) {
    m.albedo = tint * vec3(0.7, 0.15, 0.12);
  } else if (id == MAT_PAINT_GREEN) {
    m.albedo = tint * vec3(0.15, 0.5, 0.25);
  } else if (id == MAT_PAINT_BLUE) {
    m.albedo = tint * vec3(0.15, 0.3, 0.58);
  } else if (id == MAT_GRASS) {
    float blades = matNoise(uv * 12.0);
    m.albedo = tint * mix(vec3(0.13, 0.2, 0.09), vec3(0.24, 0.32, 0.13), blades);
    m.roughness = 0.95;
    m.bump = (blades - 0.5) * 0.5;
  } else if (id == MAT_DIRT || id == MAT_GRAVEL) {
    float pebble = matNoise(uv * 18.0);
    m.albedo = tint * (id == MAT_DIRT ? vec3(0.28, 0.23, 0.18) : vec3(0.42, 0.4, 0.36)) * (0.85 + pebble * 0.3);
    m.roughness = 0.95;
    m.bump = (pebble - 0.5) * 0.8;
  } else if (id == MAT_SAND) {
    m.albedo = tint * vec3(0.6, 0.56, 0.45) * (0.9 + fine * 0.15);
    m.roughness = 0.9;
  } else if (id == MAT_ROCK) {
    float strata = matFbm(uv * 1.6);
    m.albedo = tint * mix(vec3(0.3, 0.28, 0.26), vec3(0.45, 0.42, 0.4), strata);
    m.roughness = 0.9;
    m.bump = (strata - 0.5) * 1.2;
  } else if (id == MAT_METAL) {
    m.albedo = tint * 0.5;
    m.roughness = 0.42;
    m.metallic = 0.85;
  } else if (id == MAT_RAILSTEEL) {
    m.albedo = vec3(0.36, 0.36, 0.38);
    m.roughness = 0.28;
    m.metallic = 0.95;
  } else if (id == MAT_BALLAST) {
    float pebble = matNoise(uv * 14.0);
    m.albedo = tint * mix(vec3(0.2, 0.19, 0.18), vec3(0.34, 0.32, 0.3), pebble);
    m.roughness = 0.95;
    m.bump = (pebble - 0.5) * 1.0;
  } else if (id == MAT_WOOD) {
    float rings = sin(uv.x * 3.0 + matFbm(uv * 2.0) * 4.0);
    m.albedo = tint * mix(vec3(0.24, 0.17, 0.11), vec3(0.34, 0.24, 0.15), rings * 0.5 + 0.5);
    m.roughness = 0.85;
    m.bump = rings * 0.3;
  } else if (id == MAT_TUNNEL_WALL) {
    m.albedo = tint * (0.3 + grain * 0.05);
    m.roughness = 0.9;
    m.bump = (grain - 0.5) * 0.3;
  } else if (id == MAT_GLASS) {
    m.albedo = tint * 0.4;
    m.roughness = 0.12;
    m.metallic = 0.25;
  } else if (id == MAT_RUBBER) {
    m.albedo = tint * 0.1;
    m.roughness = 0.95;
  } else if (id == MAT_FOLIAGE) {
    float leaf = matFbm(uv * 6.0);
    m.albedo = tint * mix(vec3(0.1, 0.19, 0.07), vec3(0.22, 0.33, 0.12), leaf);
    m.roughness = 0.9;
    m.bump = (leaf - 0.5) * 1.0;
  }
  return m;
}
`;
