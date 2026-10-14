// ============================================================================
// GDF_BUILD.WGSL — Global distance field tile generation.
// For every voxel of an allocated tile, the field value is built EXACTLY like Lumen's
// global distance field: the minimum over
//   (a) every dynamic Lumen object's mesh SDF, sampled trilinear through its inverse transform, and
//   (b) every nearby static triangle (point-on-triangle distance, triangle-normal sign).
// Only tiles within CLIP_DMAX of geometry are allocated; everywhere else absence == +DMAX.
// The value stored is normalized d / cellSize of the clipmap.
// ============================================================================
//@@common
//@@strip GDFVOLD GDFSAMPLED

struct GdfDyn {
  invM0 : vec4f, invM1 : vec4f, invM2 : vec4f, invM3 : vec4f,   // world -> object matrix rows
  uvwA : vec4f,     // object->atlas-uvw: uvw = uvwA.xyz * p + uvwB.xyz ; w: enabled
  uvwB : vec4f,
}
struct TileJob {
  cell : vec4i,        // tile cell coords, w = clip level
  data : vec4u,        // x pool index, y dynamic object mask, z static entry start, w static entry count
}
struct JobInfo {
  counts : vec4u,      // x tiles this dispatch, y dyn object count
  pad0 : vec4u, pad1 : vec4u, pad2 : vec4u,
}
@group(3) @binding(0) var<uniform> info : JobInfo;
@group(3) @binding(1) var<storage, read> jobs : array<TileJob>;
@group(3) @binding(2) var<storage, read> dynObjs : array<GdfDyn>;
@group(3) @binding(3) var<storage, read> staticSoup : array<vec4f>;    // 4 x vec4 per tri: a,b,c,n
@group(3) @binding(4) var meshSdfAtlas : texture_3d<f32>;
@group(3) @binding(5) var meshSdfSampler : sampler;
@group(3) @binding(6) var gdfOut0 : texture_storage_3d<r16float, write>;
@group(3) @binding(7) var gdfOut1 : texture_storage_3d<r16float, write>;
@group(3) @binding(8) var gdfOut2 : texture_storage_3d<r16float, write>;

fn staticTriDist(p : vec3f, e : u32) -> vec4f {  // xyz closest n, w signed d
  let a = staticSoup[e * 4u].xyz;
  let b = staticSoup[e * 4u + 1u].xyz;
  let c = staticSoup[e * 4u + 2u].xyz;
  let n = staticSoup[e * 4u + 3u].xyz;
  let ab = b - a; let ac = c - a; let ap = p - a;
  let d1 = dot(ab, ap); let d2 = dot(ac, ap);
  if d1 <= 0.0 && d2 <= 0.0 { let q = p - a; return vec4f(n, sign(dot(n, q)) * length(q)); }
  let bp = p - b; let d3 = dot(ab, bp); let d4 = dot(ac, bp);
  if d3 >= 0.0 && d4 <= d3 { let q = p - b; return vec4f(n, sign(dot(n, q)) * length(q)); }
  let vc = d1 * d4 - d3 * d2;
  if vc <= 0.0 && d1 >= 0.0 && d3 <= 0.0 {
    let v = d1 / (d1 - d3); let q = a + ab * v; let r = p - q; return vec4f(n, sign(dot(n, r)) * length(r));
  }
  let cp = p - c; let d5 = dot(ab, cp); let d6 = dot(ac, cp);
  if d6 >= 0.0 && d5 <= d6 { let q = p - c; return vec4f(n, sign(dot(n, q)) * length(q)); }
  let vb = d5 * d2 - d1 * d6;
  if vb <= 0.0 && d2 >= 0.0 && d6 <= 0.0 {
    let w = d2 / (d2 - d6); let q = a + ac * w; let r = p - q; return vec4f(n, sign(dot(n, r)) * length(r));
  }
  let va = d3 * d6 - d5 * d4;
  if va <= 0.0 && (d4 - d3) >= 0.0 && (d5 - d6) >= 0.0 {
    let w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); let q = b + (c - b) * w; let r = p - q;
    return vec4f(n, sign(dot(n, r)) * length(r));
  }
  let denom = 1.0 / (va + vb + vc);
  let q = a + ab * (vb * denom) + ac * (vc * denom); let r = p - q;
  return vec4f(n, sign(dot(n, r)) * length(r));
}

@compute @workgroup_size(8, 8, 8)
fn main(@builtin(workgroup_id) wid : vec3u, @builtin(local_invocation_id) lid : vec3u) {
  let tileIdx = wid.z / 2u;
  if tileIdx >= info.counts.x { return; }
  let jobI = jobs[tileIdx];
  let level = u32(jobI.cell.w);
  let pool = jobI.data.x;
  let voxel = vec3u(wid.x * 8u + lid.x, wid.y * 8u + lid.y, (wid.z % 2u) * 8u + lid.z);
  let cellMin = vec3f(jobI.cell.xyz) * CLIP_CELL[level];
  let p = cellMin + (vec3f(voxel) + vec3f(0.5)) * CLIP_VOXEL[level];

  var d = CLIP_DMAX[level];
  var sgn = 1.0f;

  // (a) dynamic objects via their mesh SDF volumes (Lumen's per-mesh distance fields)
  let mask = jobI.data.y;
  for (var o = 0u; o < info.counts.y; o++) {
    if (mask & (1u << o)) == 0u { continue; }
    let dyn = dynObjs[o];
    let po = vec3f(
      dot(dyn.invM0.xyz, p) + dyn.invM0.w,
      dot(dyn.invM1.xyz, p) + dyn.invM1.w,
      dot(dyn.invM2.xyz, p) + dyn.invM2.w);
    let uvw = dyn.uvwA.xyz * po + dyn.uvwB.xyz;
    if uvw.x < 0.004 || uvw.x > 0.996 || uvw.y < 0.004 || uvw.y > 0.996 || uvw.z < 0.004 || uvw.z > 0.996 {
      continue;                       // outside the object's volume: this object is > DMAX away here
    }
    let s = textureSampleLevel(meshSdfAtlas, meshSdfSampler, uvw, 0.0).r;
    if abs(s) < d { d = abs(s); sgn = select(1.0, -1.0, s < 0.0); }
  }

  // (b) static triangles — exact distance over the tile's own triangle list
  let start = jobI.data.z;
  let count = jobI.data.w;
  for (var e = start; e < start + count; e++) {
    let r = staticTriDist(p, e);
    if abs(r.w) < d { d = abs(r.w); sgn = select(1.0, -1.0, r.w < 0.0); }
  }

  let out = vec4f(clamp(d * sgn / CLIP_CELL[level], -1.0, 1.0), 0.0, 0.0, 0.0);
  let base = gdfTileVoxelBase(pool) + vec3i(voxel);
  if level == 0u { textureStore(gdfOut0, base, out); }
  else if level == 1u { textureStore(gdfOut1, base, out); }
  else { textureStore(gdfOut2, base, out); }
}
