// ============================================================================
//  COMMON.WGSL — shared declarations + field samplers for the SDF GI pipeline.
//  Prepended to every pass module by the loader (WGSL has no #include).
//
//  Bind-group conventions (identical in every pass that includes this file):
//    group(0) binding(0) : FrameParams uniform           — every pass
//    group(1) binding(0) : FieldParams uniform           — global distance field + voxel light state
//            binding(1)  : gdfTables  storage array<u32> — 3 toroidal tile tables (2 u32 per slot)
//            binding(2..4) : gdfVol0/1/2 texture_3d<f32> — sparse clipmap distance atlasses (r16f)
//            binding(5)  : gdfSampler sampler            — trilinear
//            binding(6)  : voxRad0   texture_3d<f32>     — clipmap-0 voxel lighting (rgba16f)
//    group(2) binding(0) : cardsWorld  array<CardWorld>  — all mesh cards, world frame
//            binding(1)  : tileCardInfo array<u32>       — per L0 pool tile: start | count<<20
//            binding(2)  : tileCardIds  array<u32>       — card indices per L0 pool tile
//            binding(3)  : scRadiance texture_2d<f32>    — surface-cache radiance atlas (rgba16f)
//
//  Pass-specific I/O starts at group(3).
// ============================================================================

const TILE_VOXELS_I : i32 = 16;
const ATLAS_TILES_X : u32 = 32u;
const ATLAS_TILES_Y : u32 = 32u;
const ATLAS_TILES_Z : u32 = 2u;
const TEX_DIM = vec3f(512.0, 512.0, 32.0);
const SC_ATLAS_F : f32 = 1024.0;
const CARD_TEX : u32 = 8u;
const CLIP_VOXEL = array<f32, 3>(0.1, 0.4, 1.6);
const CLIP_CELL  = array<f32, 3>(1.6, 6.4, 25.6);
const CLIP_DMAX  = array<f32, 3>(1.6, 6.4, 25.6);
const CLIP_RADIUS = array<f32, 3>(18.0, 96.0, 400.0);
const CLIP_GRID = array<u32, 3>(64u, 48u, 40u);
const TBL_O1 : u32 = 262144u;   // 64^3 slots
const TBL_O2 : u32 = 372736u;   // +48^3
const TWO_PI : f32 = 6.283185307179586;
const PI : f32 = 3.141592653589793;
const BIG : f32 = 1.0e6;

struct FrameParams {
  viewProj : mat4x4f,
  invViewProj : mat4x4f,
  prevViewProj : mat4x4f,
  camPos : vec4f,
  prevCamPos : vec4f,
  sunDir : vec4f,      // xyz toward sun, w unused
  sunColor : vec4f,    // rgb irradiance, w exposure
  horizon : vec4f,     // rgb, w time(s)
  zenith : vec4f,      // rgb, w giIntensity
  screen : vec4f,      // capture w, h, 1/w, 1/h
  canvas : vec4f,      // canvas w, h, 1/w, 1/h
  frame : vec4u,       // x frameIdx, y viewMode, z rngSalt, w stage flags
  slice : vec4f,       // x debug slice height, y smallEmissiveScale, z pad, w pad
}
struct FieldParams {
  focus : vec4f,       // xyz clipmap focus (the car), w = allocation epoch
  tabMeta : vec4u,     // x = clip0 pool size
  dbg : vec4u,
}

struct CardLocal { orgHalfU : vec4f, ext : vec4f, content : vec4u } // ext = (halfV, wLo, wHi, dirIdx)
struct CardWorld { org : vec4f, t : vec4f, b : vec4f, n : vec4f }   // org.w=halfU t.w=halfV b.w=wLo n.w=wHi

struct Material { base : vec4f, emis : vec4f, misc : vec4f } // base(rgb, metal) emis(radiance rgb, rough) misc.x flag(1=glass 2=paint)

@group(0) @binding(0) var<uniform> F : FrameParams;
@group(0) @binding(1) var<storage, read> materials : array<Material>;
@group(0) @binding(2) var<storage, read> transforms : array<mat4x4f>;
@group(1) @binding(0) var<uniform> FD : FieldParams;
@group(1) @binding(1) var<storage, read> gdfTables : array<u32>;
//@@region GDFVOLD
@group(1) @binding(2) var gdfVol0 : texture_3d<f32>;
@group(1) @binding(3) var gdfVol1 : texture_3d<f32>;
@group(1) @binding(4) var gdfVol2 : texture_3d<f32>;
//@@end GDFVOLD
@group(1) @binding(5) var gdfSampler : sampler;
//@@region VOXD
@group(1) @binding(6) var voxRad0 : texture_3d<f32>;
//@@end VOXD
@group(2) @binding(0) var<storage, read> cardsWorld : array<CardWorld>;
@group(2) @binding(1) var<storage, read> tileCardInfo : array<u32>;
@group(2) @binding(2) var<storage, read> tileCardIds : array<u32>;
//@@region SCRADD
@group(2) @binding(3) var scRadiance : texture_2d<f32>;
//@@end SCRADD

// ------------------------------------------------------------------ card frames (identical to js/cards.js)
fn cardN(d : u32) -> vec3f {
  switch d {
    case 0u { return vec3f(1.0, 0.0, 0.0); }
    case 1u { return vec3f(-1.0, 0.0, 0.0); }
    case 2u { return vec3f(0.0, 1.0, 0.0); }
    case 3u { return vec3f(0.0, -1.0, 0.0); }
    case 4u { return vec3f(0.0, 0.0, 1.0); }
    default { return vec3f(0.0, 0.0, -1.0); }
  }
}
fn cardT(d : u32) -> vec3f {
  if d <= 1u { return vec3f(0.0, 1.0, 0.0); }
  return vec3f(1.0, 0.0, 0.0);
}
fn cardB(d : u32) -> vec3f {
  switch d {
    case 0u { return vec3f(0.0, 0.0, 1.0); }
    case 1u { return vec3f(0.0, 0.0, -1.0); }
    case 2u { return vec3f(0.0, 0.0, -1.0); }
    case 3u { return vec3f(0.0, 0.0, 1.0); }
    case 4u { return vec3f(0.0, 1.0, 0.0); }
    default { return vec3f(0.0, -1.0, 0.0); }
  }
}

// ------------------------------------------------------------------ hashing / sampling helpers
fn pcg3d(vIn : vec3u) -> vec3u {
  var v = vIn * vec3u(1664525u) + vec3u(1013904223u);
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> vec3u(16u);
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
fn rand3(seed : vec3u) -> vec3f {
  let h = pcg3d(seed);
  return vec3f(h) * (1.0 / 4294967296.0);
}
fn cosineSampleHemisphere(n : vec3f, seed : vec3u) -> vec3f {
  let r = rand3(seed);
  let a = TWO_PI * r.x;
  let s = sqrt(r.y);
  let axis = select(vec3f(0.0, 0.0, 1.0), vec3f(1.0, 0.0, 0.0), abs(n.z) > 0.9);
  let t = normalize(cross(n, axis));
  return normalize(t * (cos(a) * s) + cross(n, t) * (sin(a) * s) + n * sqrt(max(0.0, 1.0 - r.y)));
}
fn octEncode(n0 : vec3f) -> vec2f {
  var n = n0 / (abs(n0.x) + abs(n0.y) + abs(n0.z) + 1e-7);
  if n.z < 0.0 {
    let sx = select(-1.0, 1.0, n.x >= 0.0);
    let sy = select(-1.0, 1.0, n.y >= 0.0);
    n = vec3f((1.0 - abs(n.y)) * sx, (1.0 - abs(n.x)) * sy, n.z);
  }
  return n.xy * 0.5 + vec2f(0.5);
}
fn octDecode(e : vec2f) -> vec3f {
  let f = e * 2.0 - vec2f(1.0);
  var n = vec3f(f.x, f.y, 1.0 - abs(f.x) - abs(f.y));
  let t = max(-n.z, 0.0);
  n.x += select(t, -t, n.x >= 0.0);
  n.y += select(t, -t, n.y >= 0.0);
  return normalize(n);
}

// ------------------------------------------------------------------ sky shared by every miss path
fn skyParams() -> SkyParams {
  return SkyParams(F.horizon.xyz, F.zenith.xyz, F.sunDir.xyz, F.sunColor.xyz);
}
struct SkyParams { horizon : vec3f, zenith : vec3f, sunDir : vec3f, sunColor : vec3f }
fn skyRadiance(dir : vec3f, includeSun : bool) -> vec3f {
  let sky = skyParams();
  let h = clamp(dir.z, -1.0, 1.0);
  var col = mix(sky.horizon, sky.zenith, clamp(h * 1.6 + 0.25, 0.0, 1.0));
  if includeSun {
    let c = max(dot(dir, sky.sunDir), 0.0);
    col += sky.sunColor * pow(c, 1200.0) * 90.0;
    col += sky.sunColor * pow(c, 24.0) * 0.045;
  }
  return col;
}

// ====================================================================
//  Global distance field — sparse toroidal tables + trilinear atlasses
// ====================================================================
fn clipIndexForRadius(r : f32) -> u32 {
  if r <= CLIP_RADIUS[0] { return 0u; }
  if r <= CLIP_RADIUS[1] { return 1u; }
  return 2u;
}
fn gdfCellOf(p : vec3f, level : u32) -> vec3i { return vec3i(floor(p / CLIP_CELL[level])); }
fn gdfCellHash(c : vec3i) -> u32 {
  let v = bitcast<vec3u>(c) * vec3u(1898087u, 852847u, 1632097u);
  return pcg3d(vec3u(v)).x;
}
fn gdfTileAt(p : vec3f, level : u32) -> u32 {   // returns pool index, or 0xFFFFFFFF when missing
  let c = gdfCellOf(p, level);
  let dim = CLIP_GRID[level];
  let dimI = vec3i(i32(dim));
  let w3 = ((c % dimI) + dimI) % dimI;
  let base = select(select(0u, TBL_O1, level == 1u), TBL_O2, level == 2u);
  let slot = base + (u32(w3.z) * dim + u32(w3.y)) * dim + u32(w3.x);
  if gdfTables[slot * 2u] != gdfCellHash(c) { return 0xFFFFFFFFu; }
  let pool = gdfTables[slot * 2u + 1u];
  if pool == 0u { return 0xFFFFFFFFu; }
  return pool - 1u;
}
fn gdfTileVoxelBase(pool : u32) -> vec3i {
  let x = pool % ATLAS_TILES_X;
  let y = (pool / ATLAS_TILES_X) % ATLAS_TILES_Y;
  let z = pool / (ATLAS_TILES_X * ATLAS_TILES_Y);
  return vec3i(i32(x), i32(y), i32(z)) * TILE_VOXELS_I;
}
fn gdfAtlasUvw(p : vec3f, level : u32, pool : u32) -> vec3f {
  let cellMin = vec3f(gdfCellOf(p, level)) * CLIP_CELL[level];
  let local = (p - cellMin) / CLIP_VOXEL[level];
  return (vec3f(gdfTileVoxelBase(pool)) + local) / TEX_DIM;
}
//@@region GDFSAMPLED
// Signed distance at p, finest available clipmap. y = clip level used, z = 1 when a tile supplied the value.
fn gdfSample(p : vec3f, wantLevel : u32) -> vec3f {
  for (var level = wantLevel; level < 3u; level++) {
    let pool = gdfTileAt(p, level);
    if pool != 0xFFFFFFFFu {
      var s = 0.0;
      let uvw = gdfAtlasUvw(p, level, pool);
      if level == 0u { s = textureSampleLevel(gdfVol0, gdfSampler, uvw, 0.0).r; }
      else if level == 1u { s = textureSampleLevel(gdfVol1, gdfSampler, uvw, 0.0).r; }
      else { s = textureSampleLevel(gdfVol2, gdfSampler, uvw, 0.0).r; }
      return vec3f(s * CLIP_CELL[level], f32(level), 1.0);
    }
  }
  return vec3f(CLIP_DMAX[2u], 2.0, 0.0);
}

fn gdfDistance(p : vec3f) -> vec3f {
  let level = clipIndexForRadius(distance(p, FD.focus.xyz));
  return gdfSample(p, level);
}

// --------------------------------------------------------------------
//  Cone trace through the clipmaps (sphere tracing relaxed by the cone).
//    coneTan : tan(half cone angle)  e.g. 0.033 tight shadows, 0.577 diffuse gathers
//    returns  t, hitLevel, hit(0/1), minRatio (soft-visibility metric)
// --------------------------------------------------------------------
struct ConeHit { t : f32, level : f32, hit : f32, minRatio : f32 }
fn coneTrace(o : vec3f, dir : vec3f, t0 : f32, maxT : f32, coneTan : f32) -> ConeHit {
  var t = t0;
  var minRatio = 1.0;
  var lastD = CLIP_DMAX[0u];
  var lastLevel = 2.0;
  for (var i = 0; i < 64; i++) {
    let p = o + dir * t;
    let level = clipIndexForRadius(distance(p, FD.focus.xyz));
    let s = gdfSample(p, level);
    let voxel = CLIP_VOXEL[u32(s.y)];
    lastLevel = s.y;
    lastD = s.x;
    let r = max(t * coneTan, voxel * 0.72);
    if s.x < r {
      return ConeHit(t, s.y, 1.0, minRatio);
    }
    minRatio = min(minRatio, clamp(s.x / r, 0.0, 1.0));
    t += clamp(s.x * 0.85, voxel * 0.85, CLIP_CELL[u32(s.y)]);
    if t > maxT { break; }
  }
  return ConeHit(t, lastLevel, select(0.0, 1.0, lastD < 0.0), minRatio);
}

// sharp-ish soft shadow toward the sun (visibility = minimum in-transit ratio, Lumen-style band test)
fn sunVisibility(o : vec3f, n : vec3f) -> f32 {
  let dir = F.sunDir.xyz;
  let start = o + n * (CLIP_VOXEL[0u] * 1.5);
  let h = coneTrace(start, dir, 0.05, 200.0, 0.011);
  if h.hit > 0.5 { return 0.0; }
  return clamp(h.minRatio * 1.25 - 0.08, 0.0, 1.0);
}

// sky visibility along one direction — used by surface cache ambient + gathers
fn skyVisibility(o : vec3f, n : vec3f, dir : vec3f, seed : vec3u) -> f32 {
  let h = coneTrace(o + n * (CLIP_VOXEL[0u] * 1.5), dir, 0.08, 60.0, 0.42);
  if h.hit > 0.5 { return 0.0; }
  return smoothstep(0.55, 1.0, h.minRatio);
}
//@@end GDFSAMPLED

//@@region VOXSAMPLED
// --------------------------------------------------------------------
//  Clipmap-0 voxel lighting sample (rgba16f, trilinear). xy+rgb = radiance, w = occlusion.
// --------------------------------------------------------------------
fn voxelRadiance(p : vec3f) -> vec4f {
  if (F.frame.w & 8u) == 0u { return vec4f(0.0); }   // voxel-light stage flag
  let pool = gdfTileAt(p, 0u);
  if pool == 0xFFFFFFFFu { return vec4f(skyRadiance(normalize(p - FD.focus.xyz + vec3f(0.0, 0.0, 1.0)), false) * 0.25, 0.0); }
  let uvw = gdfAtlasUvw(p, 0u, pool);
  return textureSampleLevel(voxRad0, gdfSampler, uvw, 0.0);
}
//@@end VOXSAMPLED

//@@region SCRADSAMPLED
// --------------------------------------------------------------------
//  Surface-cache radiance fetch: find the nearest covered mesh card of the L0 tile at p,
//  then its radiance texel. Returns rgb radiance + a = coverage.
// --------------------------------------------------------------------
fn cardFetch(p : vec3f, fromDir : vec3f) -> vec4f {
  if (F.frame.w & 4u) == 0u { return vec4f(0.0); }   // surface-cache stage flag
  let pool = gdfTileAt(p, 0u);
  if pool == 0xFFFFFFFFu { return vec4f(0.0, 0.0, 0.0, 0.0); }
  let info = tileCardInfo[pool];
  let start = info & 0xFFFFFu;
  let count = info >> 20u;
  var best = vec4f(0.0);
  var bestD = 1e5;
  for (var i = 0u; i < count; i++) {
    let ci = tileCardIds[start + i];
    let c = cardsWorld[ci];
    let d = p - c.org.xyz;
    let u = dot(d, c.t.xyz);
    let v = dot(d, c.b.xyz);
    let w = dot(d, c.n.xyz);
    // slab distance to the card rectangle (uv outside is penalised, w outside its range too)
    let du = max(abs(u) - c.org.w, 0.0);
    let dv = max(abs(v) - c.t.w, 0.0);
    let dw = max(max(c.b.w - w, w - c.n.w), 0.0);
    let slab = du * du + dv * dv + dw * dw * 4.0;
    if slab < bestD && w >= c.b.w - 0.02 && w <= c.n.w + 0.02 {
      // project to texel
      let cu = clamp((u / c.org.w) * 0.5 + 0.5, 0.0, 1.0);
      let cv = clamp((v / c.t.w) * 0.5 + 0.5, 0.0, 1.0);
      let tileX = ci % 128u;
      let tileY = ci / 128u;
      let tx = tileX * CARD_TEX + u32(cu * 7.999);
      let ty = tileY * CARD_TEX + u32(cv * 7.999);
      let s = textureLoad(scRadiance, vec2i(i32(tx), i32(ty)), 0);
      if s.w > 0.5 {
        let facing = select(0.0, 1.0, dot(c.n.xyz, -fromDir) > -0.25);
        bestD = slab;
        best = vec4f(s.rgb, s.w * max(facing, 0.35));
      }
    }
  }
  return best;
}
//@@end SCRADSAMPLED
