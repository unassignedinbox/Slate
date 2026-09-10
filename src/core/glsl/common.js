// Shared GLSL for SLATE: atlas addressing (Z-slice tiles, never a heightmap),
// manual trilinear sampling of RGBA32F, SDF utilities, value noise / fbm.
export const ATLAS_GLSL = /* glsl */`
uniform ivec3 uDim;      // volume dimensions in voxels
uniform vec3 uLo;        // world AABB min
uniform vec3 uHi;        // world AABB max
uniform float uCell;     // cell size in metres
const float BAND_ = 0.45;
uniform ivec2 uAtlasSize;

ivec2 atlasAddr(ivec3 q){
  q = clamp(q, ivec3(0), uDim - ivec3(1));
  return ivec2((q.z % 16) * uDim.x + q.x, (q.z / 16) * uDim.y + q.y);
}
// atlas pixel → voxel coordinate (inverse of atlasAddr, within one slice)
ivec3 addrVoxel(ivec2 uv){
  ivec2 t = uv / uDim.xy;    // (tile column, tile row)
  return ivec3(uv.x - t.x * uDim.x, uv.y - t.y * uDim.y, t.y * 16 + t.x);
}
vec3 voxelWorld(ivec3 q){ return uLo + (vec3(q) + vec3(0.5)) * uCell; }
// Trilinear sample of the volume atlas (manual — RGBA32F is not filterable).
vec4 atlasSample(sampler2D tex, vec3 p){
  vec3 q = clamp((p - uLo) / uCell - vec3(0.5), vec3(0), vec3(uDim) - vec3(1.001));
  ivec3 i = ivec3(floor(q)); vec3 f = vec3(q) - vec3(i);
  ivec3 i1 = min(i + ivec3(1), uDim - ivec3(1));
  vec4 c000 = texelFetch(tex, atlasAddr(i), 0);
  vec4 c100 = texelFetch(tex, atlasAddr(ivec3(i1.x, i.y, i.z)), 0);
  vec4 c010 = texelFetch(tex, atlasAddr(ivec3(i.x, i1.y, i.z)), 0);
  vec4 c110 = texelFetch(tex, atlasAddr(ivec3(i1.x, i1.y, i.z)), 0);
  vec4 c001 = texelFetch(tex, atlasAddr(ivec3(i.x, i.y, i1.z)), 0);
  vec4 c101 = texelFetch(tex, atlasAddr(ivec3(i1.x, i.y, i1.z)), 0);
  vec4 c011 = texelFetch(tex, atlasAddr(ivec3(i.x, i1.y, i1.z)), 0);
  vec4 c111 = texelFetch(tex, atlasAddr(i1), 0);
  return mix(mix(mix(c000, c100, f.x), mix(c010, c110, f.x), f.y),
             mix(mix(c001, c101, f.x), mix(c011, c111, f.x), f.y), f.z);
}
float voxelVolume(){ return uCell * uCell * uCell; }
// Signed distance with AABB-boundary extension (outside grows positive).
float sdf(sampler2D tex, vec3 p){
  return atlasSample(tex, p).r + length(max(max(uLo - p, p - uHi), vec3(0)));
}
vec3 sdfNormal(sampler2D tex, vec3 p){
  float e = uCell * 0.75;
  vec3 g = vec3(
    sdf(tex, p + vec3(e, 0, 0)) - sdf(tex, p - vec3(e, 0, 0)),
    sdf(tex, p + vec3(0, e, 0)) - sdf(tex, p - vec3(0, e, 0)),
    sdf(tex, p + vec3(0, 0, e)) - sdf(tex, p - vec3(0, 0, e)));
  return length(g) > 1e-7 ? normalize(g) : vec3(0, 1, 0);
}
// Quadratic brush kernel (compact support radius r).
float brushKernel(vec3 p, vec3 c, float r){
  float a = max(0.0, 1.0 - length(p - c) / r);
  return a * a;
}
float hash11(float x){ return fract(sin(x * 12.9898) * 43758.5453); }
float hash13(vec3 x){ return fract(sin(dot(x, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }
`;

// Value noise + fbm (world-space, deterministic).
export const NOISE_GLSL = /* glsl */`
float vnoise(vec3 x){
  vec3 i = floor(x); vec3 f = x - i; f = f * f * (3.0 - 2.0 * f);
  float n000 = hash13(i);
  float n100 = hash13(i + vec3(1, 0, 0));
  float n010 = hash13(i + vec3(0, 1, 0));
  float n110 = hash13(i + vec3(1, 1, 0));
  float n001 = hash13(i + vec3(0, 0, 1));
  float n101 = hash13(i + vec3(1, 0, 1));
  float n011 = hash13(i + vec3(0, 1, 1));
  float n111 = hash13(i + vec3(1, 1, 1));
  return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
             mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.z), f.z);
}
float fbm(vec3 p, int oct){
  float a = 0.5, s = 0.0, norm = 0.0;
  for(int i = 0; i < 8; i++){
    if(i >= oct) break;
    s += a * vnoise(p); norm += a; p = p * 2.02 + vec3(31.7); a *= 0.5;
  }
  return s / max(norm, 1e-5);
}
float ridged(vec3 p, int oct){
  float a = 0.5, s = 0.0, norm = 0.0;
  for(int i = 0; i < 8; i++){
    if(i >= oct) break;
    float n = 1.0 - abs(vnoise(p) * 2.0 - 1.0);
    s += a * n * n; norm += a; p = p * 2.07 + vec3(11.3); a *= 0.5;
  }
  return s / max(norm, 1e-5);
}
`;

// SDF primitive library used by node codegen (all true 3D — caves stay volumetric).
export const PRIM_GLSL = /* glsl */`
float sdSphere(vec3 p, vec3 c, float r){ return length(p - c) - r; }
float sdBox(vec3 p, vec3 c, vec3 b, float rd){
  vec3 q = abs(p - c) - b + vec3(rd);
  return length(max(q, vec3(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0) - rd;
}
float sdCylinder(vec3 p, vec3 c, float r, float h){
  vec3 d = p - c;
  vec2 dr = vec2(length(d.xz) - r, abs(d.y) - h);
  return min(max(dr.x, dr.y), 0.0) + length(max(dr, vec2(0.0)));
}
float sdCone(vec3 p, vec3 c, float rBase, float rTop, float h){
  vec3 d = p - c; d.y += h * 0.5;
  float y = clamp(d.y, 0.0, h);
  float r = mix(rBase, rTop, y / max(h, 1e-4));
  vec2 q = vec2(length(d.xz) - r, d.y - y);
  return min(max(q.x, q.y), 0.0) + length(max(q, vec2(0.0)));
}
float sdCapsule(vec3 p, vec3 a, vec3 b, float r){
  vec3 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * h) - r;
}
float sdTorus(vec3 p, vec3 c, float R, float r){
  vec3 d = p - c;
  return length(vec2(length(d.xz) - R, d.y)) - r;
}
float sdPlaneY(vec3 p, float h){ return p.y - h; }
// Bounded terrain mass: solid below a noisy height, full AABB footprint.
float sdTerrainSlab(vec3 p, float base, float top, float amp, float freq, int oct, float ridgedMix, float seed){
  float n = mix(fbm(vec3(p.xz * freq, seed), oct), ridged(vec3(p.xz * freq, seed + 7.7), oct), ridgedMix);
  float h = top + (n - 0.5) * 2.0 * amp;
  float dTop = p.y - h;
  float dBottom = base - p.y;
  float side = max(abs(p.x) - (abs(uHi.x) - uCell * 1.5), abs(p.z) - (abs(uHi.z) - uCell * 1.5));
  return max(max(dTop, dBottom), side);
}
float opUnion(float a, float b){ return min(a, b); }
float opSubtract(float a, float b){ return max(a, -b); }
float opIntersect(float a, float b){ return max(a, b); }
float opSmoothUnion(float a, float b, float k){
  float h = clamp(0.5 + 0.5 * (b - a) / max(k, 1e-4), 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}
float opSmoothSubtract(float a, float b, float k){
  float h = clamp(0.5 - 0.5 * (b + a) / max(k, 1e-4), 0.0, 1.0);
  return mix(a, -b, h) + k * h * (1.0 - h);
}
float opSmoothIntersect(float a, float b, float k){
  float h = clamp(0.5 - 0.5 * (b - a) / max(k, 1e-4), 0.0, 1.0);
  return mix(b, a, h) + k * h * (1.0 - h);
}
`;

// Baked-field sampling primitive (used downstream of simulation nodes).
export const FIELD_GLSL = /* glsl */`
uniform sampler2D uField;
float fieldSDF(vec3 p){ return sdf(uField, p); }
`;
