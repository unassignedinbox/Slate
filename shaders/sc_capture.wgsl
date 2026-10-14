// ============================================================================
// SC_CAPTURE.WGSL — mesh card rasterization ("Lumen Scene" capture).
// Each mesh card is an 8x8 surface sprite in the surface-cache atlas. Cards are
// axis-aligned in world space (dynamic objects' cards move with them), and the
// closest surface along the card normal wins the card's slab, via depth test.
//   A0 rgba32uint : world position xyz (bit bits) | coverage=1
//   A1 rgba16f    : albedo rgb | metalness
//   A2 rgba16f    : world normal xy (oct) | roughness | coverage
//   A3 rgba16f    : emissive radiance rgb | material flags
// ============================================================================
//@@common

struct VsOut {
  @builtin(position) clip : vec4f,
  @location(0) uv : vec2f,
  @location(1) @interpolate(flat) cardId : u32,
  @location(2) @interpolate(flat) matId : u32,
  @location(3) nrm : vec3f,
  @location(4) depthLocal : f32,
}

@vertex fn vsMain(
  @location(0) pos : vec3f,
  @location(1) cardId : u32,
  @location(2) matId : u32,
  @location(3) nrm : vec3f,
  @builtin(instance_index) inst : u32,
) -> VsOut {
  let c = cardsWorld[cardId];
  let m = transforms[inst];
  let wp = (m * vec4f(pos, 1.0)).xyz;
  let d = wp - c.org.xyz;
  let u = clamp(dot(d, c.t.xyz) / c.org.w, -1.0, 1.0);
  let v = clamp(dot(d, c.b.xyz) / c.t.w, -1.0, 1.0);
  let w = dot(d, c.n.xyz);
  let tileX = f32(cardId % 128u);
  let tileY = f32(cardId / 128u);
  let px = tileX * 8.0 + (u * 0.5 + 0.5) * 8.0;
  let py = tileY * 8.0 + (v * 0.5 + 0.5) * 8.0;
  let depthLocal = clamp((c.n.w - w) / max(c.n.w - c.b.w, 1e-4), 0.0, 1.0);
  var o : VsOut;
  o.clip = vec4f(px / 512.0 - 1.0, 1.0 - py / 512.0, depthLocal, 1.0);
  o.depthLocal = depthLocal;
  o.uv = vec2f(u, v);
  o.cardId = cardId;
  o.matId = matId;
  o.nrm = normalize((m * vec4f(nrm, 0.0)).xyz);
  return o;
}

struct FsOut {
  @location(0) a0 : vec4u,
  @location(1) a1 : vec4f,
  @location(2) a2 : vec4f,
  @location(3) a3 : vec4f,
}

@fragment fn fsMain(v : VsOut) -> FsOut {
  let c = cardsWorld[v.cardId];
  let w = c.n.w - v.depthLocal * max(c.n.w - c.b.w, 1e-4);
  let wp = c.org.xyz + c.t.xyz * (v.uv.x * c.org.w) + c.b.xyz * (v.uv.y * c.t.w) + c.n.xyz * w;
  let mat = materials[v.matId];
  var base = mat.base.rgb;
  if mat.misc.x == 1.0 { base = base * 0.06; }
  var o : FsOut;
  o.a0 = vec4u(bitcast<u32>(wp.x), bitcast<u32>(wp.y), bitcast<u32>(wp.z), 1u);
  o.a1 = vec4f(base, mat.base.w);
  o.a2 = vec4f(octEncode(normalize(v.nrm)), mat.emis.w, 1.0);
  o.a3 = vec4f(mat.emis.rgb, f32(v.matId) / 16.0);
  return o;
}
