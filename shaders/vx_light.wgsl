// ============================================================================
// VX_LIGHT.WGSL — voxel lighting for clipmap 0.
// For every voxel of the scheduled tiles, radiance arriving at the voxel center is
// gathered with 8 short cone traces through the global distance field: 6 axis
// directions + 2 per-frame jittered directions. Cone hits fetch their radiance from
// the surface cache (whose texels hold the previous frames' direct+indirect — this
// feedback is what turns one bounce into two), cone misses read the sky.
//   Output: rgba16f = radiance rgb | occlusion (fraction of cones that hit nearby)
// Scheduled tiles rotate through the frame budget; car-adjacent tiles always update.
// ============================================================================
//@@common
//@@strip VOXD VOXSAMPLED

@group(3) @binding(0) var<uniform> vxInfo : vec4u;      // x = tiles this dispatch
@group(3) @binding(1) var<storage, read> vxJobs : array<vec4i>;  // xyz tile cell, w pool index
@group(3) @binding(2) var voxOut : texture_storage_3d<rgba16float, write>;

@compute @workgroup_size(8, 8, 8)
fn main(@builtin(workgroup_id) wid : vec3u, @builtin(local_invocation_id) lid : vec3u) {
  if (F.frame.w & 8u) == 0u { return; }                 // voxel lighting stage disabled
  let tileIdx = wid.z / 2u;
  if tileIdx >= vxInfo.x { return; }
  let job = vxJobs[tileIdx];
  let pool = u32(job.w);
  let voxel = vec3u(wid.x * 8u + lid.x, wid.y * 8u + lid.y, (wid.z % 2u) * 8u + lid.z);
  let p2 = vec3f(job.xyz) * CLIP_CELL[0u] + (vec3f(voxel) + vec3f(0.5)) * CLIP_VOXEL[0u];

  // 6 axis directions + 2 rotating extras (stable, blue-noise-ish)
  var radiance = vec3f(0.0);
  var occSum = 0.0;
  let seed0 = vec3u(voxel) + vec3u(u32(F.frame.x) * 1973u);
  let r = rand3(seed0);
  var dirs = array<vec3f, 8>(
    vec3f(1.0, 0.0, 0.0), vec3f(-1.0, 0.0, 0.0),
    vec3f(0.0, 1.0, 0.0), vec3f(0.0, -1.0, 0.0),
    vec3f(0.0, 0.0, 1.0), vec3f(0.0, 0.0, -1.0),
    normalize(vec3f(r.x * 2.0 - 1.0, r.y * 2.0 - 1.0, r.z * 2.0 - 1.0) + vec3f(0.0, 0.0, 0.35)),
    normalize(vec3f(r.y * 2.0 - 1.0, r.z * 2.0 - 1.0, r.x * 2.0 - 1.0) + vec3f(0.35, 0.0, 0.0)));
  for (var i = 0u; i < 8u; i++) {
    let dir = dirs[i];
    let start = p2 + dir * (CLIP_VOXEL[0u] * 0.5);
    let h = coneTrace(start, dir, CLIP_VOXEL[0u] * 0.5, CLIP_CELL[0u] * 4.0, 0.707);
    if h.hit > 0.5 && u32(h.level) == 0u {
      let hp = start + dir * h.t;
      let s = cardFetch(hp, dir);
      if s.w > 0.4 {
        radiance += s.rgb;
        occSum += 1.0 / (1.0 + h.t * 1.5);
        continue;
      }
      // covered surface but no card there: treat as shadowed, not sky
      radiance += vec3f(0.0);
      occSum += 1.0 / (1.0 + h.t * 1.5);
      continue;
    }
    radiance += skyRadiance(dir, false);
  }
  let avg = radiance * (1.0 / 8.0);
  textureStore(voxOut, gdfTileVoxelBase(pool) + vec3i(voxel), vec4f(avg, clamp(occSum * (1.0 / 8.0) * 2.0, 0.0, 1.0)));
}
