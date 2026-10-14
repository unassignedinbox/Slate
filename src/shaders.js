// All WGSL for the Lumen-style WebGPU route, generated with baked layout constants.
// Frame order: capture (once) -> GDF clipmap composition -> surface-cache direct ->
// surface-cache radiosity (amortised) -> outgoing resolve -> screen probes ->
// final gather -> blit. GI rays sphere-trace the Global Distance Field ONLY (plus
// screen traces in the probe/final-gather stage, as in Lumen). No triangle-trace
// fallback, no alias table, no analytic occluders in the GI path.
//
// Buffer economy: WebGPU guarantees only 8 storage buffers per shader stage, so the
// atlas lives in ONE vec4 buffer (8 regions), the 3 clipmaps in ONE buffer, mesh DF
// descriptors+voxels in ONE buffer, and atlas map / texel lists / counters share ONE
// atomic u32 buffer. Group 0 therefore uses exactly 7 storage buffers everywhere.

export function buildShaders(cfg) {
  const COMMON = /* wgsl */`
struct Uniforms { vp: mat4x4f, invVp: mat4x4f, f: array<vec4f, 24>, u: array<vec4u, 8> };
struct Placement {
  l2w: mat4x4f, w2l: mat4x4f, lmin: vec4f, lmax: vec4f, wmin: vec4f, wmax: vec4f,
  mesh: vec4u, cards: vec4u,
};
struct Card {
  origin: vec4f, normal: vec4f, tangent: vec4f, bitangent: vec4f, uv: vec4f,
  atlas: vec4u, info: vec4u,
};
struct Tri { a: vec4f, b: vec4f, c: vec4f, n: vec4f };
struct GDFVoxel { d: f32, o: u32 };

@group(0) @binding(0) var<uniform> U: Uniforms;
@group(0) @binding(1) var<storage, read_write> Placements: array<Placement>;
@group(0) @binding(2) var<storage, read_write> Cards: array<Card>;
@group(0) @binding(3) var<storage, read_write> Triangles: array<Tri>;
@group(0) @binding(4) var<storage, read_write> DFAll: array<vec4f>;
@group(0) @binding(5) var<storage, read_write> GDFAll: array<GDFVoxel>;
@group(0) @binding(6) var<storage, read_write> AtlasAll: array<vec4f>;
@group(0) @binding(7) var<storage, read_write> U32All: array<atomic<u32>>;
struct PassParams { p: vec4u, q: vec4f };
@group(2) @binding(0) var<uniform> P: PassParams;

const PI: f32 = 3.14159265359;
const INVALID: u32 = 0xffffffffu;
const ATLAS_N: u32 = ${cfg.ATLAS_N}u;
const GDF_N: u32 = ${cfg.GDF_N}u;
const MAT_BASE: u32 = ${cfg.triCount}u;
const MAP_BASE: u32 = 0u;
const DYN_BASE: u32 = ${cfg.ATLAS_N}u;
const STATIC_BASE: u32 = ${cfg.ATLAS_N + cfg.dynCount}u;
const COUNTER_BASE: u32 = ${cfg.ATLAS_N + cfg.dynCount + cfg.staticCount}u;
// AtlasAll regions: 0 surface, 1 normal, 2 pos, 3 emissive, 4 direct, 5 indirect, 6/7 outgoing ping-pong
fn aIdx(region: u32, texel: u32) -> u32 { return region * ATLAS_N + texel; }
fn outReadBase() -> u32 { return U.u[6u].x * ATLAS_N; }
fn outWriteBase() -> u32 { return U.u[6u].y * ATLAS_N; }

fn hash1(n: u32) -> u32 { var x = n; x ^= x >> 16u; x *= 0x7feb352du; x ^= x >> 15u; x *= 0x846ca68bu; return x ^ (x >> 16u); }
fn hashf(n: u32) -> f32 { return f32(hash1(n)) / 4294967296.0; }

// ---- mesh distance fields (per-object, mesh-local; DFAll = [descs: 3 vec4 each][voxels: (d, triBits,0,0)]) ----
struct DFRes { d: f32, tri: u32 };
fn sampleMeshDF(dfIdx: u32, pos: vec3f) -> DFRes {
  let db = dfIdx * 3u;
  let bmin = DFAll[db].xyz; let bmax = DFAll[db + 1u].xyz;
  let resF = DFAll[db + 2u];
  let res = vec3u(resF.xyz); let offset = u32(resF.w + 0.5);
  let resv = vec3f(res);
  let cell = (bmax - bmin) / resv;
  if (any(pos < bmin) || any(pos > bmax)) {
    let dd = max(max(bmin - pos, pos - bmax), vec3f(0.0));
    return DFRes(length(dd), INVALID);
  }
  let coord = (pos - bmin) / cell - vec3f(0.5);
  let lo = clamp(vec3i(floor(coord)), vec3i(0), vec3i(res) - vec3i(2));
  let fr = coord - vec3f(lo);
  var d = 0.0; var nearW = -1.0; var nearTri = 0u;
  for (var c = 0u; c < 8u; c++) {
    let off = vec3i(i32(c & 1u), i32((c >> 1u) & 1u), i32((c >> 2u) & 1u));
    let wgt = mix(vec3f(1.0) - fr, fr, vec3f(off));
    let w = wgt.x * wgt.y * wgt.z;
    let at = lo + off;
    let v = DFAll[offset + (u32(at.z) * res.y + u32(at.y)) * res.x + u32(at.x)];
    d += v.x * w;
    if (w > nearW) { nearW = w; nearTri = u32(v.y + 0.5); }
  }
  return DFRes(d, nearTri);
}

// ---- global distance field: 3 clipmap levels of 64^3 in GDFAll ----
struct GSample { d: f32, obj: u32, tol: f32, level: u32 };
fn gdfVoxel(level: u32, at: vec3i) -> GDFVoxel {
  let a = clamp(at, vec3i(0), vec3i(63));
  return GDFAll[level * GDF_N + (u32(a.z) * 64u + u32(a.y)) * 64u + u32(a.x)];
}
fn sampleLevel(level: u32, pos: vec3f) -> GSample {
  let c = U.f[4u + level];
  let coord = (pos - c.xyz) / c.w + vec3f(32.0) - vec3f(0.5);
  let lo = clamp(vec3i(floor(coord)), vec3i(0), vec3i(62));
  let fr = coord - vec3f(lo);
  var d = 0.0; var bestW = -1.0; var obj = INVALID;
  for (var k = 0u; k < 8u; k++) {
    let off = vec3i(i32(k & 1u), i32((k >> 1u) & 1u), i32((k >> 2u) & 1u));
    let wgt = mix(vec3f(1.0) - fr, fr, vec3f(off));
    let w = wgt.x * wgt.y * wgt.z;
    let v = gdfVoxel(level, lo + off);
    d += v.d * w;
    if (w > bestW) { bestW = w; obj = v.o; }
  }
  return GSample(d, obj, c.w * 0.6, level);
}
fn sampleGDF(pos: vec3f) -> GSample {
  for (var level = 0u; level < 3u; level++) {
    let c = U.f[4u + level];
    if (all(abs(pos - c.xyz) < vec3f(c.w * 32.0 * 0.98))) { return sampleLevel(level, pos); }
  }
  let c = U.f[6u];
  let dd = max(max((c.xyz - vec3f(c.w * 32.0)) - pos, pos - (c.xyz + vec3f(c.w * 32.0))), vec3f(0.0));
  return GSample(length(dd) + 0.5, INVALID, c.w * 0.6, 3u);
}
fn gdfNormal(pos: vec3f) -> vec3f {
  let s = sampleGDF(pos); let e = max(s.tol, 0.02);
  let g = vec3f(
    sampleGDF(pos + vec3f(e,0,0)).d - sampleGDF(pos - vec3f(e,0,0)).d,
    sampleGDF(pos + vec3f(0,e,0)).d - sampleGDF(pos - vec3f(0,e,0)).d,
    sampleGDF(pos + vec3f(0,0,e)).d - sampleGDF(pos - vec3f(0,0,e)).d);
  let l = length(g);
  if (l < 1e-7) { return vec3f(0,0,1); }
  return g / l;
}

// ---- sphere tracing ----
struct TraceHit { hit: bool, t: f32, obj: u32, pos: vec3f, steps: u32, exhausted: bool, hitPx: vec2i };
fn traceGDF(origin: vec3f, dir: vec3f, maxDist: f32, startT: f32) -> TraceHit {
  var h = TraceHit(false, maxDist, INVALID, origin, 0u, false, vec2i(0));
  var t = startT;
  for (var i = 0u; i < 72u; i++) {
    if (t >= maxDist) { break; }
    h.steps = i + 1u;
    let p = origin + dir * t;
    let s = sampleGDF(p);
    if (s.obj != INVALID && s.d < s.tol) { h.hit = true; h.t = t; h.obj = s.obj; h.pos = p; return h; }
    t += max(abs(s.d) * 0.85, s.tol * 0.5);
    if (i == 71u) { h.exhausted = true; }
  }
  h.pos = origin + dir * t;
  return h;
}
fn occludedGDF(origin: vec3f, dir: vec3f, maxDist: f32) -> bool {
  var t = 0.03;
  for (var i = 0u; i < 48u; i++) {
    if (t >= maxDist) { return false; }
    let s = sampleGDF(origin + dir * t);
    if (s.obj != INVALID && s.d < s.tol) { return true; }
    t += max(abs(s.d) * 0.85, s.tol * 0.5);
  }
  return false;
}
fn softShadowGDF(origin: vec3f, dir: vec3f, maxDist: f32, k: f32) -> f32 {
  var res = 1.0; var t = 0.04;
  for (var i = 0u; i < 40u; i++) {
    if (t >= maxDist) { break; }
    let s = sampleGDF(origin + dir * t);
    if (s.obj != INVALID && s.d < s.tol * 0.7) { return 0.0; }
    res = min(res, k * max(s.d, 0.0) / t);
    t += clamp(abs(s.d) * 0.9, 0.02, 0.6);
  }
  return clamp(res, 0.0, 1.0);
}

fn skyRadiance(dir: vec3f) -> vec3f {
  let h = clamp(dir.z * 0.5 + 0.5, 0.0, 1.0);
  let zen = U.f[3u].xyz * 0.30;
  let hor = U.f[3u].xyz * vec3f(0.75, 0.62, 0.48);
  var col = mix(hor, zen, h * h);
  col += U.f[2u].xyz * pow(clamp(dot(dir, U.f[1u].xyz), 0.0, 1.0), 350.0) * 0.6;
  return col;
}

// ---- surface cache ----
fn atlasBilinear(atlasCoord: vec2f, region: u32) -> vec4f {
  let W = i32(U.u[2u].x); let H = i32(U.u[2u].y);
  let c = clamp(atlasCoord - vec2f(0.5), vec2f(0.0), vec2f(f32(W - 2), f32(H - 2)));
  let lo = vec2i(floor(c)); let fr = c - vec2f(lo);
  var acc = vec4f(0.0);
  for (var k = 0u; k < 4u; k++) {
    let off = vec2i(i32(k & 1u), i32((k >> 1u) & 1u));
    let w = mix(vec2f(1.0) - fr, fr, vec2f(off));
    acc += AtlasAll[aIdx(region, u32((lo.y + off.y) * W + lo.x + off.x))] * (w.x * w.y);
  }
  return acc;
}
struct CardHit { found: bool, card: u32, coord: vec2f };
fn findCard(placementIdx: u32, worldPos: vec3f, worldNormal: vec3f) -> CardHit {
  var out = CardHit(false, 0u, vec2f(0.0));
  let pl = Placements[placementIdx];
  let localPos = (pl.w2l * vec4f(worldPos, 1.0)).xyz;
  let localN = normalize((pl.w2l * vec4f(worldNormal, 0.0)).xyz);
  var bestScore = -1e9;
  for (var ci = 0u; ci < pl.cards.x; ci++) {
    let cardIdx = pl.mesh.w + ci;
    let card = Cards[cardIdx];
    let rel = localPos - card.origin.xyz;
    let uu = dot(rel, card.tangent.xyz);
    let vv = dot(rel, card.bitangent.xyz);
    let dd = dot(rel, card.normal.xyz);
    if (uu < -0.05 || vv < -0.05 || uu > card.uv.z + 0.05 || vv > card.uv.w + 0.05) { continue; }
    let score = dot(card.normal.xyz, localN) * 2.0 - abs(dd);
    if (score > bestScore) {
      bestScore = score;
      out = CardHit(true, cardIdx, vec2f(
        f32(card.atlas.x) + clamp(uu / max(card.uv.z, 1e-6), 0.0, 1.0) * f32(card.atlas.z),
        f32(card.atlas.y) + clamp(vv / max(card.uv.w, 1e-6), 0.0, 1.0) * f32(card.atlas.w)));
    }
  }
  return out;
}
fn outRegion() -> u32 { return U.u[6u].x; }
fn sampleOutgoing(placementIdx: u32, worldPos: vec3f, worldNormal: vec3f) -> vec3f {
  let ch = findCard(placementIdx, worldPos, worldNormal);
  if (!ch.found) { return vec3f(0.0); }
  return atlasBilinear(ch.coord, outRegion()).rgb;
}
fn sampleOwnIrradiance(placementIdx: u32, worldPos: vec3f, worldNormal: vec3f) -> vec3f {
  let ch = findCard(placementIdx, worldPos, worldNormal);
  if (!ch.found) { return U.f[3u].xyz; }
  return atlasBilinear(ch.coord, 4u).rgb + atlasBilinear(ch.coord, 5u).rgb;
}
fn hemisphereDir(normal: vec3f, sampleIdx: u32, sampleCount: u32, shift: vec2f) -> vec3f {
  let height = fract((f32(sampleIdx) + 0.5) / f32(sampleCount) + shift.x);
  let angle = 6.28318530718 * fract(f32(sampleIdx) * 0.61803398875 + shift.y);
  let r = sqrt(max(1.0 - height, 0.0));
  let tangent = normalize(select(cross(normal, vec3f(0,1,0)), cross(normal, vec3f(0,0,1)), abs(normal.z) < 0.9));
  return tangent * (cos(angle) * r) + cross(normal, tangent) * (sin(angle) * r) + normal * sqrt(height);
}
fn directLighting(worldPos: vec3f, worldNormal: vec3f) -> vec3f {
  var irr = vec3f(0.0);
  let sunDir = U.f[1u].xyz;
  let ndl = dot(worldNormal, sunDir);
  if (ndl > 0.0) {
    irr += U.f[2u].xyz * U.f[1u].w * ndl * softShadowGDF(worldPos + worldNormal * 0.05, sunDir, 30.0, U.f[15u].x);
  }
  for (var li = 0u; li < 2u; li++) {
    var lpos = U.f[9u].xyz; var lcol = U.f[10u].xyz; var lint = U.f[9u].w;
    if (li == 1u) { lpos = U.f[11u].xyz; lcol = U.f[12u].xyz; lint = U.f[10u].w; }
    if (lint <= 0.0) { continue; }
    let toL = lpos - worldPos; let dist = length(toL); let dir = toL / max(dist, 1e-5);
    let ndl2 = dot(worldNormal, dir);
    if (ndl2 <= 0.0) { continue; }
    if (!occludedGDF(worldPos + worldNormal * 0.05, dir, dist - 0.15)) {
      irr += lcol * (lint / max(dist * dist, 0.01)) * ndl2;
    }
  }
  return irr;
}
fn displayTransfer(radiance: vec3f) -> vec3f {
  let hdr = max(radiance, vec3f(0.0)) * U.f[0u].w;
  let mapped = clamp((hdr * (2.51 * hdr + 0.03)) / (hdr * (2.43 * hdr + 0.59) + 0.14), vec3f(0.0), vec3f(1.0));
  return pow(mapped, vec3f(1.0 / 2.2));
}
`;

  const GDF = COMMON + /* wgsl */`
@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (any(gid >= vec3u(64u))) { return; }
  let idx = (gid.z * 64u + gid.y) * 64u + gid.x;
  let mask = U.u[4u].x;
  for (var level = 0u; level < 3u; level++) {
    if ((mask & (1u << level)) == 0u) { continue; }
    let c = U.f[4u + level];
    let worldPos = c.xyz + (vec3f(gid) + vec3f(0.5) - vec3f(32.0)) * c.w;
    var best = 1e20; var bestObj = INVALID;
    for (var pi = 0u; pi < U.u[1u].x; pi++) {
      let pl = Placements[pi];
      if (pl.cards.z != 0u) { continue; }
      let local = (pl.w2l * vec4f(worldPos, 1.0)).xyz;
      var cand = 0.0; var inside = true;
      if (any(local < pl.lmin.xyz) || any(local > pl.lmax.xyz)) {
        let dd = max(max(pl.lmin.xyz - local, local - pl.lmax.xyz), vec3f(0.0));
        cand = length(dd) * pl.lmin.w; inside = false;
      } else {
        cand = sampleMeshDF(pl.mesh.z, local).d * pl.lmin.w;
      }
      if (cand < best) { best = cand; if (inside) { bestObj = pi; } else if (bestObj == pi) { bestObj = INVALID; } }
    }
    GDFAll[level * GDF_N + idx] = GDFVoxel(best, bestObj);
  }
}
`;

  const CAPTURE = COMMON + /* wgsl */`
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let W = U.u[2u].x; let H = U.u[2u].y;
  if (gid.x >= W || gid.y >= H) { return; }
  let idx = gid.y * W + gid.x;
  AtlasAll[aIdx(0u, idx)] = vec4f(0.0); AtlasAll[aIdx(1u, idx)] = vec4f(0.0);
  AtlasAll[aIdx(2u, idx)] = vec4f(0.0); AtlasAll[aIdx(3u, idx)] = vec4f(0.0);
  let cardIdx = atomicLoad(&U32All[MAP_BASE + idx]);
  if (cardIdx == INVALID) { return; }
  let card = Cards[cardIdx];
  let fu = (f32(gid.x - card.atlas.x) + 0.5) / f32(card.atlas.z);
  let fv = (f32(gid.y - card.atlas.y) + 0.5) / f32(card.atlas.w);
  let planeU = card.uv.x + fu * card.uv.z;
  let planeV = card.uv.y + fv * card.uv.w;
  var bestDepth = -1e20; var found = false; var bestPos = vec3f(0.0); var bestN = vec3f(0.0); var bestMat = 0u;
  for (var ti = 0u; ti < card.info.z; ti++) {
    let tri = Triangles[card.info.y + ti];
    let pts = array<vec3f, 3>(tri.a.xyz, tri.b.xyz, tri.c.xyz);
    var tu = array<f32, 3>(); var tv = array<f32, 3>();
    for (var k = 0; k < 3; k++) {
      let rel = pts[k] - card.origin.xyz;
      tu[k] = dot(rel, card.tangent.xyz); tv[k] = dot(rel, card.bitangent.xyz);
    }
    let den = (tv[1] - tv[2]) * (tu[0] - tu[2]) + (tu[2] - tu[1]) * (tv[0] - tv[2]);
    if (abs(den) < 1e-14) { continue; }
    let w0 = ((tv[1] - tv[2]) * (planeU - tu[2]) + (tu[2] - tu[1]) * (planeV - tv[2])) / den;
    let w1 = ((tv[2] - tv[0]) * (planeU - tu[2]) + (tu[0] - tu[2]) * (planeV - tv[2])) / den;
    let w2 = 1.0 - w0 - w1;
    if (w0 < -0.001 || w1 < -0.001 || w2 < -0.001) { continue; }
    if (dot(tri.n.xyz, card.normal.xyz) < 0.15) { continue; }
    let pos = pts[0] * w0 + pts[1] * w1 + pts[2] * w2;
    let depth = dot(pos - card.origin.xyz, card.normal.xyz);
    if (depth > bestDepth) { bestDepth = depth; found = true; bestPos = pos; bestN = tri.n.xyz; bestMat = u32(tri.a.w + 0.5); }
  }
  if (!found) { return; }
  let m = Triangles[MAT_BASE + bestMat];
  AtlasAll[aIdx(0u, idx)] = vec4f(m.a.rgb, m.a.w);
  AtlasAll[aIdx(1u, idx)] = vec4f(bestN, m.b.w);
  AtlasAll[aIdx(2u, idx)] = vec4f(bestPos, 1.0);
  AtlasAll[aIdx(3u, idx)] = vec4f(m.b.rgb, 1.0);
}
`;

  const LIGHTING = COMMON + /* wgsl */`
@compute @workgroup_size(16, 16)
fn mainDirect(@builtin(global_invocation_id) gid: vec3u) {
  let W = U.u[2u].x; let H = U.u[2u].y;
  if (gid.x >= W || gid.y >= H) { return; }
  let idx = gid.y * W + gid.x;
  let cardIdx = atomicLoad(&U32All[MAP_BASE + idx]);
  if (cardIdx == INVALID || AtlasAll[aIdx(2u, idx)].w <= 0.0) { AtlasAll[aIdx(4u, idx)] = vec4f(0.0); return; }
  let card = Cards[cardIdx];
  let pl = Placements[card.info.x];
  if (pl.cards.z != 0u) { AtlasAll[aIdx(4u, idx)] = vec4f(0.0); return; }
  let wp = (pl.l2w * vec4f(AtlasAll[aIdx(2u, idx)].xyz, 1.0)).xyz;
  let wn = normalize((transpose(pl.w2l) * vec4f(AtlasAll[aIdx(1u, idx)].xyz, 0.0)).xyz);
  AtlasAll[aIdx(4u, idx)] = vec4f(directLighting(wp, wn), 1.0);
}

@compute @workgroup_size(64)
fn mainRadiosity(@builtin(global_invocation_id) gid: vec3u) {
  var texel = 0u;
  if (P.p.x == 0u) {
    if (gid.x >= U.u[2u].z) { return; }
    texel = atomicLoad(&U32All[DYN_BASE + gid.x]);
  } else {
    if (gid.x >= P.p.z) { return; }
    texel = atomicLoad(&U32All[STATIC_BASE + (P.p.y + gid.x) % U.u[2u].w]);
  }
  if (AtlasAll[aIdx(2u, texel)].w <= 0.0) { AtlasAll[aIdx(5u, texel)] = vec4f(0.0); return; }
  let cardIdx = atomicLoad(&U32All[MAP_BASE + texel]);
  let card = Cards[cardIdx];
  let pl = Placements[card.info.x];
  if (pl.cards.z != 0u) { AtlasAll[aIdx(5u, texel)] = vec4f(0.0); return; }
  let wp = (pl.l2w * vec4f(AtlasAll[aIdx(2u, texel)].xyz, 1.0)).xyz;
  let wn = normalize((transpose(pl.w2l) * vec4f(AtlasAll[aIdx(1u, texel)].xyz, 0.0)).xyz);
  let rays = P.p.w;
  let seed = hash1((texel * 2654435761u) ^ (U.u[0u].x * 40503u));
  let shift = vec2f(hashf(seed), hashf(seed + 77u));
  let ceiling = max(U.f[2u].xyz * 0.45, U.f[3u].xyz * 6.0);
  var sum = vec3f(0.0); var skyCount = 0u;
  for (var s = 0u; s < rays; s++) {
    let dir = hemisphereDir(wn, s, rays, shift);
    let hit = traceGDF(wp + wn * 0.06, dir, 20.0, 0.02);
    var rad = vec3f(0.0);
    if (hit.hit) { rad = sampleOutgoing(hit.obj, hit.pos - dir * 0.02, gdfNormal(hit.pos)); }
    else { rad = skyRadiance(dir); skyCount++; }
    sum += min(rad, ceiling);
  }
  AtlasAll[aIdx(5u, texel)] = vec4f(PI * sum / f32(rays), f32(skyCount) / f32(rays));
}

@compute @workgroup_size(16, 16)
fn mainResolve(@builtin(global_invocation_id) gid: vec3u) {
  let W = U.u[2u].x; let H = U.u[2u].y;
  if (gid.x >= W || gid.y >= H) { return; }
  let idx = gid.y * W + gid.x;
  let cardIdx = atomicLoad(&U32All[MAP_BASE + idx]);
  if (cardIdx == INVALID || AtlasAll[aIdx(2u, idx)].w <= 0.0) { AtlasAll[outWriteBase() + idx] = vec4f(0.0); return; }
  let card = Cards[cardIdx];
  let pl = Placements[card.info.x];
  let emis = AtlasAll[aIdx(3u, idx)].rgb;
  if (pl.cards.z != 0u) { AtlasAll[outWriteBase() + idx] = vec4f(emis, 1.0); return; }
  let alb = AtlasAll[aIdx(0u, idx)].rgb;
  let irr = AtlasAll[aIdx(4u, idx)].rgb + AtlasAll[aIdx(5u, idx)].rgb;
  AtlasAll[outWriteBase() + idx] = vec4f(emis + alb * irr / PI, 1.0);
}
`;

  const PROBE = COMMON + /* wgsl */`
@group(1) @binding(0) var gAlbedo: texture_2d<f32>;
@group(1) @binding(1) var gNormal: texture_2d<f32>;
@group(1) @binding(2) var gEmissive: texture_2d<f32>;
@group(1) @binding(3) var gDepth: texture_depth_2d;
@group(1) @binding(4) var<storage, read_write> ProbeAll: array<vec4f>;

fn worldFromDepth(px: vec2i, depth: f32) -> vec3f {
  let sz = U.f[8u].xy;
  let uv = (vec2f(px) + vec2f(0.5)) / sz;
  let w = U.invVp * vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, depth, 1.0);
  return w.xyz / w.w;
}
fn screenTrace(origin: vec3f, dir: vec3f, maxDist: f32, selfPx: vec2i) -> TraceHit {
  var h = TraceHit(false, maxDist, INVALID, origin, 0u, false, vec2i(0));
  let sz = vec2i(U.f[8u].xy);
  var t = 0.08; var step = 0.08;
  for (var i = 0u; i < 36u; i++) {
    h.steps = i + 1u;
    let p = origin + dir * t;
    let clip4 = U.vp * vec4f(p, 1.0);
    if (clip4.w <= 0.0) { break; }
    let ndc = clip4.xyz / clip4.w;
    if (any(abs(ndc.xy) > vec2f(1.0)) || ndc.z > 1.0) { t += step; step *= 1.25; continue; }
    let px = vec2i(vec2f((ndc.x + 1.0) * 0.5, (1.0 - ndc.y) * 0.5) * U.f[8u].xy);
    if (all(px == selfPx)) { t += step; continue; }
    let cpx = clamp(px, vec2i(0), sz - vec2i(1));
    let sceneDepth = textureLoad(gDepth, cpx, 0);
    if (ndc.z > sceneDepth + 2e-4 && ndc.z < sceneDepth + 0.02 + t * 0.01) {
      let sp = worldFromDepth(cpx, sceneDepth);
      h.hit = true; h.t = length(sp - origin); h.pos = sp; h.hitPx = cpx;
      h.obj = u32(textureLoad(gNormal, cpx, 0).w + 0.5);
      return h;
    }
    t += step; step *= 1.18;
    if (t >= maxDist) { break; }
  }
  return h;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let grid = vec2u(U.f[8u].zw);
  if (gid.x >= grid.x || gid.y >= grid.y) { return; }
  let pidx = gid.y * grid.x + gid.x;
  let gc = grid.x * grid.y;
  let readIrr = P.p.y * gc; let writeIrr = P.p.z * gc;
  let readMeta = (2u + P.p.y * 2u) * gc; let writeMeta = (2u + P.p.z * 2u) * gc;
  let sz = vec2i(U.f[8u].xy);
  let px = clamp(vec2i(gid.xy) * 8 + vec2i(4), vec2i(0), sz - vec2i(1));
  let depth = textureLoad(gDepth, px, 0);
  if (depth >= 0.99999) {
    ProbeAll[writeIrr + pidx] = vec4f(skyRadiance(vec3f(0,0,1)) * PI, 1.0);
    ProbeAll[writeMeta + pidx * 2u] = vec4f(0.0, 0.0, 0.0, -1.0);
    ProbeAll[writeMeta + pidx * 2u + 1u] = vec4f(0.0, 0.0, 1.0, 0.0);
    return;
  }
  let pos = worldFromDepth(px, depth);
  let normal = normalize(textureLoad(gNormal, px, 0).xyz);
  let rays = P.p.w;
  let seed = hash1((pidx * 2246822519u) ^ (U.u[0u].x * 3266489917u));
  let shift = vec2f(hashf(seed), hashf(seed + 131u));
  var sum = vec3f(0.0); var steps = 0u; var hits = 0u; var skyHits = 0u;
  for (var s = 0u; s < rays; s++) {
    let dir = hemisphereDir(normal, s, rays, shift);
    let origin = pos + normal * 0.06;
    var rad = vec3f(0.0); var done = false;
    if ((U.u[0u].w & 2u) != 0u) {
      let st = screenTrace(origin, dir, 7.0, px);
      steps += st.steps;
      if (st.hit && st.obj < U.u[1u].x) {
        rad = sampleOutgoing(st.obj, st.pos, normalize(textureLoad(gNormal, st.hitPx, 0).xyz));
        hits++; done = true;
      }
    }
    if (!done) {
      let hit = traceGDF(origin, dir, 22.0, 0.02);
      steps += hit.steps;
      if (hit.hit) { rad = sampleOutgoing(hit.obj, hit.pos - dir * 0.02, gdfNormal(hit.pos)); hits++; }
      else { rad = skyRadiance(dir); skyHits++; }
    }
    sum += min(rad, max(U.f[2u].xyz * 0.55, U.f[3u].xyz * 7.0));
  }
  atomicAdd(&U32All[COUNTER_BASE + 1u], rays);
  atomicAdd(&U32All[COUNTER_BASE + 2u], steps);
  atomicAdd(&U32All[COUNTER_BASE + 3u], hits);
  atomicAdd(&U32All[COUNTER_BASE + 4u], skyHits);
  var irr = PI * sum / f32(rays);
  let prevMeta = ProbeAll[readMeta + pidx * 2u];
  let prevN = ProbeAll[readMeta + pidx * 2u + 1u].xyz;
  if (prevMeta.w > 0.0 && length(prevMeta.xyz - pos) < 0.18 && dot(prevN, normal) > 0.9) {
    irr = mix(ProbeAll[readIrr + pidx].rgb, irr, 0.3);
  }
  ProbeAll[writeIrr + pidx] = vec4f(irr, f32(skyHits) / f32(rays));
  ProbeAll[writeMeta + pidx * 2u] = vec4f(pos, 1.0);
  ProbeAll[writeMeta + pidx * 2u + 1u] = vec4f(normal, 0.0);
}
`;

  const FINAL = COMMON + /* wgsl */`
@group(1) @binding(0) var gAlbedo: texture_2d<f32>;
@group(1) @binding(1) var gNormal: texture_2d<f32>;
@group(1) @binding(2) var gEmissive: texture_2d<f32>;
@group(1) @binding(3) var gDepth: texture_depth_2d;
@group(1) @binding(4) var outImage: texture_storage_2d<rgba16float, write>;
@group(1) @binding(5) var<storage, read_write> ProbeAll: array<vec4f>;

fn worldFromDepth(px: vec2i, depth: f32) -> vec3f {
  let sz = U.f[8u].xy;
  let uv = (vec2f(px) + vec2f(0.5)) / sz;
  let w = U.invVp * vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, depth, 1.0);
  return w.xyz / w.w;
}
fn hashColor(i: u32) -> vec3f { return vec3f(hashf(i * 3u + 11u), hashf(i * 7u + 5u), hashf(i * 13u + 23u)); }
fn sliceColor(worldXZ: vec2f) -> vec3f {
  let p = vec3f(worldXZ.x, worldXZ.y, U.f[7u].w);
  let s = sampleGDF(p);
  var col = vec3f(0.0);
  if (s.d < 0.0) { col = mix(vec3f(0.55, 0.05, 0.3), vec3f(1.0, 0.25, 0.1), clamp(-s.d / 1.5, 0.0, 1.0)); }
  else { col = mix(vec3f(1.0), vec3f(0.05, 0.25, 0.75), clamp(s.d / 4.0, 0.0, 1.0)); }
  let iso = abs(fract(s.d * 2.0) - 0.5);
  col *= 0.82 + 0.18 * smoothstep(0.0, 0.12, iso);
  if (abs(s.d) < 0.045) { col = vec3f(1.0); }
  let levelCols = array<vec3f, 3>(vec3f(0.2, 1.0, 0.3), vec3f(1.0, 0.85, 0.2), vec3f(1.0, 0.3, 0.9));
  for (var li = 0u; li < 3u; li++) {
    let c = U.f[4u + li];
    let dd = abs(worldXZ - c.xy) - vec2f(c.w * 32.0);
    if (abs(max(dd.x, dd.y)) < 0.14) { col = levelCols[li]; }
  }
  if (length(worldXZ - U.f[7u].xy) < 0.4) { col = vec3f(1.0, 0.95, 0.1); }
  return col;
}
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let sz = vec2i(U.f[8u].xy);
  if (any(vec2i(gid.xy) >= sz)) { return; }
  let px = vec2i(gid.xy);
  let mode = U.u[0u].y;
  let pip = U.f[13u];
  if (mode == 5u || ((U.u[0u].w & 8u) != 0u && f32(px.x) >= pip.x && f32(px.x) < pip.z && f32(px.y) >= pip.y && f32(px.y) < pip.w)) {
    var local = vec2f(0.0); var extent = 26.0;
    if (mode == 5u) { local = vec2f(f32(px.x) / f32(sz.x), f32(px.y) / f32(sz.y)); extent = 30.0; }
    else { local = vec2f((f32(px.x) - pip.x) / max(pip.z - pip.x, 1.0), (f32(px.y) - pip.y) / max(pip.w - pip.y, 1.0)); }
    let worldXZ = U.f[7u].xy + (local - vec2f(0.5)) * vec2f(extent, -extent);
    textureStore(outImage, px, vec4f(displayTransfer(sliceColor(worldXZ) * 1.4), 1.0));
    return;
  }
  if (mode == 8u) {
    let coord = vec2f(f32(px.x) / f32(sz.x) * f32(U.u[2u].x), f32(px.y) / f32(sz.y) * f32(U.u[2u].y));
    let idx = u32(clamp(coord.y, 0.0, f32(U.u[2u].y - 1u))) * U.u[2u].x + u32(clamp(coord.x, 0.0, f32(U.u[2u].x - 1u)));
    var col = vec3f(0.02);
    if (atomicLoad(&U32All[MAP_BASE + idx]) != INVALID && AtlasAll[aIdx(2u, idx)].w > 0.0) { col = AtlasAll[outReadBase() + idx].rgb; }
    textureStore(outImage, px, vec4f(displayTransfer(col), 1.0));
    return;
  }
  let depth = textureLoad(gDepth, px, 0);
  let camPos = U.f[0u].xyz;
  if (depth >= 0.99999) {
    let dir = normalize(worldFromDepth(px, 1.0) - camPos);
    textureStore(outImage, px, vec4f(displayTransfer(skyRadiance(dir)), 1.0));
    return;
  }
  let pos = worldFromDepth(px, depth);
  let alb = textureLoad(gAlbedo, px, 0);
  let gn = textureLoad(gNormal, px, 0);
  let emi = textureLoad(gEmissive, px, 0);
  let normal = normalize(gn.xyz);
  let placementIdx = u32(gn.w + 0.5);
  let view = normalize(camPos - pos);
  if (mode == 6u || mode == 7u) {
    let dir = normalize(pos - camPos);
    let hit = traceGDF(camPos, dir, 60.0, 0.05);
    var col = vec3f(0.0);
    if (mode == 6u) {
      if (hit.exhausted) { col = vec3f(1.0, 0.0, 1.0); }
      else { col = mix(vec3f(0.0, 0.1, 0.4), vec3f(1.0, 0.85, 0.1), clamp(f32(hit.steps) / 48.0, 0.0, 1.0)); }
    } else if (hit.hit) {
      col = sampleOutgoing(hit.obj, hit.pos - dir * 0.02, gdfNormal(hit.pos)) * 0.85 + vec3f(0.02);
    } else { col = skyRadiance(dir); }
    textureStore(outImage, px, vec4f(displayTransfer(col), 1.0));
    return;
  }
  var indirect = vec3f(0.0);
  {
    let gridF = vec2f(U.f[8u].zw);
    let gc = u32(gridF.x) * u32(gridF.y);
    let irrBase = P.p.y * gc; let metaBase = (2u + P.p.y * 2u) * gc;
    let pc = vec2f(px) / 8.0 - vec2f(0.5);
    let base = floor(pc); let fr = pc - base;
    var wsum = 0.0; var acc = vec3f(0.0);
    for (var k = 0u; k < 4u; k++) {
      let off = vec2f(f32(k & 1u), f32((k >> 1u) & 1u));
      let gp = clamp(base + off, vec2f(0.0), gridF - vec2f(1.0));
      let pidx = u32(gp.y) * u32(gridF.x) + u32(gp.x);
      let pmeta = ProbeAll[metaBase + pidx * 2u];
      if (pmeta.w < 0.0) { continue; }
      let pn = ProbeAll[metaBase + pidx * 2u + 1u].xyz;
      let bw = mix(vec2f(1.0) - fr, fr, off);
      var w = bw.x * bw.y;
      w *= pow(clamp(dot(normal, pn), 0.0, 1.0), 1.5);
      w *= exp(-abs(dot(pos - pmeta.xyz, pn)) * 6.0);
      w *= exp(-length(pos - pmeta.xyz) * 0.35);
      acc += ProbeAll[irrBase + pidx].rgb * w; wsum += w;
    }
    if (wsum > 1e-5) { indirect = acc / wsum; } else { indirect = sampleOwnIrradiance(placementIdx, pos, normal); }
  }
  let direct = directLighting(pos, normal);
  let ownCache = sampleOwnIrradiance(placementIdx, pos, normal);
  var col = vec3f(0.0);
  if (mode == 1u) { col = alb.rgb * indirect / PI; }
  else if (mode == 2u) { col = alb.rgb * direct / PI; }
  else if (mode == 3u) { col = alb.rgb * ownCache / PI + emi.rgb; }
  else if (mode == 4u) {
    let ch = findCard(placementIdx, pos, normal);
    if (ch.found) { col = atlasBilinear(ch.coord, outRegion()).rgb; }
  }
  else if (mode == 9u) {
    let ch = findCard(placementIdx, pos, normal);
    if (ch.found) { col = hashColor(ch.card) * 0.9 + vec3f(0.1); } else { col = vec3f(0.03); }
  }
  else if (mode == 10u) {
    let lv = f32(sampleGDF(pos).level);
    col = alb.rgb * 0.3 + vec3f(lv * 0.3, 0.55 - lv * 0.12, 0.25 + lv * 0.2) * 0.55 + alb.rgb * direct / PI * 0.3;
  }
  else if (mode == 11u) {
    let cell = vec2f(px % 8) / 8.0;
    col = indirect * alb.rgb / PI * 1.4 + vec3f(step(0.92, cell.x) + step(0.92, cell.y)) * 0.08;
  }
  else {
    col = alb.rgb * direct / PI + alb.rgb * indirect * U.f[3u].w / PI;
    let rough = alb.w; let metal = emi.w;
    let f0 = mix(vec3f(0.04), alb.rgb, metal);
    let fres = f0 + (vec3f(1.0) - f0) * pow(1.0 - clamp(dot(normal, view), 0.0, 1.0), 5.0);
    let seed = hash1(((u32(px.x) * 1973u) ^ (u32(px.y) * 9277u)) ^ (U.u[0u].x * 26699u));
    let rdir = normalize(reflect(-view, normal) + (vec3f(hashf(seed), hashf(seed + 3u), hashf(seed + 9u)) - vec3f(0.5)) * rough * 0.6);
    var refl = skyRadiance(rdir);
    let rh = traceGDF(pos + normal * 0.06, rdir, 25.0, 0.02);
    if (rh.hit) { refl = sampleOutgoing(rh.obj, rh.pos - rdir * 0.02, gdfNormal(rh.pos)); }
    col += fres * refl * (1.0 - rough * 0.65) * U.f[12u].w;
    col += emi.rgb;
  }
  textureStore(outImage, px, vec4f(displayTransfer(col), 1.0));
}
`;

  const RASTER = /* wgsl */`
struct RasterUniforms { vp: mat4x4f };
struct RPlacement { l2w: mat4x4f, w2l: mat4x4f, lmin: vec4f, lmax: vec4f, wmin: vec4f, wmax: vec4f, mesh: vec4u, cards: vec4u };
@group(0) @binding(0) var<uniform> RU: RasterUniforms;
@group(0) @binding(1) var<storage, read> RPlacements: array<RPlacement>;
struct VOut {
  @builtin(position) clip: vec4f,
  @location(0) normal: vec3f, @location(1) albedo: vec4f, @location(2) emissive: vec4f, @location(3) placement: f32,
};
@vertex
fn vs(@location(0) pos: vec3f, @location(1) normal: vec3f, @location(2) albedo: vec4f,
      @location(3) emissive: vec4f, @location(4) data: vec4f) -> VOut {
  let pl = RPlacements[u32(data.x + 0.5)];
  var out: VOut;
  out.clip = RU.vp * (pl.l2w * vec4f(pos, 1.0));
  out.normal = normalize((transpose(pl.w2l) * vec4f(normal, 0.0)).xyz);
  out.albedo = albedo; out.emissive = emissive; out.placement = data.x;
  return out;
}
struct FOut { @location(0) albedo: vec4f, @location(1) normal: vec4f, @location(2) emissive: vec4f };
@fragment
fn fs(inp: VOut) -> FOut {
  var out: FOut;
  out.albedo = inp.albedo;
  out.normal = vec4f(normalize(inp.normal), inp.placement);
  out.emissive = inp.emissive;
  return out;
}
`;

  const BLIT = /* wgsl */`
@group(0) @binding(0) var tex: texture_2d<f32>;
@group(0) @binding(1) var smp: sampler;
struct VOut { @builtin(position) clip: vec4f, @location(0) uv: vec2f };
@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VOut {
  var out: VOut;
  let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  out.uv = p; out.clip = vec4f(p * 2.0 - vec2f(1.0), 0.0, 1.0);
  return out;
}
@fragment
fn fs(inp: VOut) -> @location(0) vec4f { return textureSample(tex, smp, inp.uv); }
`;

  return { COMMON, GDF, CAPTURE, LIGHTING, PROBE, FINAL, RASTER, BLIT };
}
