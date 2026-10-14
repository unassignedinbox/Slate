// ============================================================================
// SC_RELIGHT.WGSL — surface cache relighting ("Lumen calculates lighting on Surface
// Cache positions and amortizes updates across frames").
// For each covered card texel in this frame's budget slice:
//     Lo = albedo * max(N·sun,0) * sun * sunVisibility(pos,N)
//        + albedo * voxelRadiance(pos + N*0.15)          (multi-bounce, from prior frames)
//        + emissive * smallEmissiveScale
// Slice: a contiguous row band of the atlas rotates every frame (uniform tx0.y..ty1),
// so a full passport refresh takes SC_RELIGHT_FRAMES frames; dynamic-object rows are
// forced every frame. This is the amortization document demands.
// ============================================================================
//@@common
//@@strip SCRADD SCRADSAMPLED

@group(3) @binding(0) var scPos : texture_2d<u32>;
@group(3) @binding(1) var scA1 : texture_2d<f32>;
@group(3) @binding(2) var scA2 : texture_2d<f32>;
@group(3) @binding(3) var scA3 : texture_2d<f32>;
@group(3) @binding(4) var scRadianceOut : texture_storage_2d<rgba16float, write>;
@group(3) @binding(5) var<uniform> relightCfg : vec4u;   // x: row0, y: rowCount, z: frame parity, w: 0

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid : vec3u) {
  if (F.frame.w & 4u) == 0u { return; }                 // surface cache stage disabled
  let row = relightCfg.x + gid.y;
  if gid.y >= relightCfg.y || row >= 1024u { return; }
  let texel = vec2i(i32(gid.x), i32(row));
  let posBits = textureLoad(scPos, texel, 0);
  if posBits.w == 0u {
    textureStore(scRadianceOut, texel, vec4f(0.0));
    return;
  }
  let p = vec3f(bitcast<f32>(posBits.x), bitcast<f32>(posBits.y), bitcast<f32>(posBits.z));
  let a1 = textureLoad(scA1, texel, 0);                 // albedo rgb | metal
  let a2 = textureLoad(scA2, texel, 0);                 // normal oct | rough | cov
  let a3 = textureLoad(scA3, texel, 0);                 // emissive | matId/16
  if a2.w < 0.5 { textureStore(scRadianceOut, texel, vec4f(0.0)); return; }

  let n = octDecode(a2.xy);
  let albedo = a1.rgb;
  let matId = u32(a3.w * 16.0 + 0.5);
  let matIs = materials[matId];
  var emissiveScale = 1.0;
  if matIs.emis.x + matIs.emis.y + matIs.emis.z > 0.001 { emissiveScale = F.slice.y; } // small-emissive cull demo

  let direct = F.sunColor.xyz * max(dot(n, F.sunDir.xyz), 0.0) * sunVisibility(p, n);
  let bounced = voxelRadiance(p + n * 0.15).rgb;
  let skyTerm = skyRadiance(n, false) * skyVisibility(p, n, n, vec3u(vec3f(p * 513.0)));
  let lo = albedo * (direct + bounced + skyTerm * 0.5) + a3.rgb * emissiveScale;
  textureStore(scRadianceOut, texel, vec4f(lo, 1.0));
}
