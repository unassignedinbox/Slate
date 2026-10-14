// ============================================================================
// GBUFFER.WGSL — primary visibility: rasterize the scene (course + ControlVehicle)
// into normal/albedo/emissive targets + depth. Final gather shades from this.
//   T0 rgba16f : world normal (xy oct-packed) | roughness | metalness
//   T1 rgba16f : base color rgb | material family 0..15 in span /16
//   T2 rgba16f : emissive radiance rgb | coverage=1
// ============================================================================
//@@common

struct VsOut {
  @builtin(position) clip : vec4f,
  @location(0) nrm : vec3f,
  @location(1) @interpolate(flat) matId : u32,
  @location(2) worldPos : vec3f,
}

@vertex fn vsMain(
  @location(0) pos : vec3f,
  @location(1) nrm : vec3f,
  @location(2) matId : u32,
  @builtin(instance_index) inst : u32,
) -> VsOut {
  let m = transforms[inst];
  let wp = m * vec4f(pos, 1.0);
  var o : VsOut;
  o.clip = F.viewProj * wp;
  o.nrm = normalize((m * vec4f(nrm, 0.0)).xyz);
  o.matId = matId;
  o.worldPos = wp.xyz;
  return o;
}

struct FsOut {
  @location(0) t0 : vec4f,
  @location(1) t1 : vec4f,
  @location(2) t2 : vec4f,
}

@fragment fn fsMain(v : VsOut) -> FsOut {
  let mat = materials[v.matId];
  // glass: the authored transmissive glazing is shaded as dark smooth dielectric for GI purposes;
  // its small painted faces still rasterize so occlusion stays exact.
  var base = mat.base.rgb;
  if mat.misc.x == 1.0 { base = base * 0.06; }
  var o : FsOut;
  o.t0 = vec4f(octEncode(normalize(v.nrm)), mat.emis.w, mat.base.w);
  o.t1 = vec4f(base, f32(v.matId) / 16.0);
  o.t2 = vec4f(mat.emis.rgb, 1.0);
  return o;
}
