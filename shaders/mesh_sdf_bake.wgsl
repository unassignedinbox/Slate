// ============================================================================
// MESH_SDF_BAKE.WGSL — Lumen "mesh distance field" generation: each Lumen object gets a
// signed distance volume in OBJECT space, evaluated exactly per voxel against every
// triangle (no ray cheats: closest-point-on-triangle distance + orientation sign,
// the same construction UE's distance field bake uses). Runs once at startup per object.
// ============================================================================
//@@common

struct BakeJob {
  sdfMin : vec4f,       // object-space volume min corner
  invVox : vec4f,       // 1/voxelSize per axis (object units)
  atlasCfg : vec4u,     // base voxel xyz in the shared mesh-SDF atlas, y = object triangle count
  dims : vec4u,         // volume dims in voxels
}
@group(3) @binding(0) var<uniform> job : BakeJob;
@group(3) @binding(1) var<storage, read> srcPos : array<vec4f>;     // object positions (xyz)
@group(3) @binding(2) var<storage, read> srcIdx : array<u32>;       // object indices
@group(3) @binding(3) var meshSdfOut : texture_storage_3d<r16float, write>;

fn pointTriDist2(p : vec3f, a : vec3f, b : vec3f, c : vec3f) -> vec4f {
  // Real-Time Collision Detection ch.5 closest point; xyz = closest point, w = squared distance
  let ab = b - a; let ac = c - a; let ap = p - a;
  let d1 = dot(ab, ap); let d2 = dot(ac, ap);
  if d1 <= 0.0 && d2 <= 0.0 { return vec4f(a, dot(ap, ap)); }
  let bp = p - b; let d3 = dot(ab, bp); let d4 = dot(ac, bp);
  if d3 >= 0.0 && d4 <= d3 { let q = p - b; return vec4f(b, dot(q, q)); }
  let vc = d1 * d4 - d3 * d2;
  if vc <= 0.0 && d1 >= 0.0 && d3 <= 0.0 {
    let v = d1 / (d1 - d3); let q = a + ab * v; let r = p - q; return vec4f(q, dot(r, r));
  }
  let cp = p - c; let d5 = dot(ab, cp); let d6 = dot(ac, cp);
  if d6 >= 0.0 && d5 <= d6 { let q = p - c; return vec4f(c, dot(q, q)); }
  let vb = d5 * d2 - d1 * d6;
  if vb <= 0.0 && d2 >= 0.0 && d6 <= 0.0 {
    let w = d2 / (d2 - d6); let q = a + ac * w; let r = p - q; return vec4f(q, dot(r, r));
  }
  let va = d3 * d6 - d5 * d4;
  if va <= 0.0 && (d4 - d3) >= 0.0 && (d5 - d6) >= 0.0 {
    let w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); let q = b + (c - b) * w; let r = p - q; return vec4f(q, dot(r, r));
  }
  let denom = 1.0 / (va + vb + vc);
  let v = vb * denom; let w = vc * denom;
  let q = a + ab * v + ac * w; let r = p - q;
  return vec4f(q, dot(r, r));
}

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  if gid.x >= job.dims.x || gid.y >= job.dims.y || gid.z >= job.dims.z { return; }
  let voxel = vec3f(gid) + vec3f(0.5);
  let p = job.sdfMin.xyz + voxel / job.invVox.xyz;
  var bestD2 = 1e9;
  var bestN = vec3f(0.0, 0.0, 1.0);
  var bestQ = p + vec3f(0.0, 0.0, 1.0);
  let triCount = job.atlasCfg.w;
  for (var t = 0u; t < triCount; t++) {
    let a = srcPos[srcIdx[t * 3u]].xyz;
    let b = srcPos[srcIdx[t * 3u + 1u]].xyz;
    let c = srcPos[srcIdx[t * 3u + 2u]].xyz;
    let r = pointTriDist2(p, a, b, c);
    if r.w < bestD2 {
      bestD2 = r.w;
      bestQ = r.xyz;
      bestN = normalize(cross(b - a, c - a));
    }
  }
  var d = sqrt(bestD2);
  if dot(bestN, p - bestQ) < 0.0 { d = -d; }
  textureStore(meshSdfOut, vec3i(gid) + vec3i(job.atlasCfg.xyz), vec4f(d, 0.0, 0.0, 0.0));
}
