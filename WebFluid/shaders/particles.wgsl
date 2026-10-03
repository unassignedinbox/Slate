// ============================================================================
// Particle sprite passes for screen-space fluid rendering:
//  - depth pass:    writes linear view-space depth of sphere impostors
//  - thickness pass: additive accumulation of fluid thickness
// ============================================================================

struct Cam {
  view     : mat4x4f,
  proj     : mat4x4f,
  invView  : mat4x4f,
  invProj  : mat4x4f,
  eye      : vec3f,
  time     : f32,
  sunDir   : vec3f,
  pRadius  : f32,
  res      : vec2f,
  thickRadius : f32,
  pad      : f32,
};
@group(0) @binding(0) var<uniform> cam : Cam;
@group(1) @binding(0) var<storage, read> parts : array<vec4f>;

struct SpriteOut {
  @builtin(position) pos : vec4f,
  @location(0) uv : vec2f,
  @location(1) viewCenter : vec3f,
};

fn spriteVS(vi: u32, ii: u32, radius: f32) -> SpriteOut {
  var corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
    vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));
  let c = corners[vi];
  let wp = parts[ii].xyz;
  let vc = (cam.view * vec4f(wp, 1.0)).xyz;
  let vp = vc + vec3f(c * radius, 0.0);
  var o: SpriteOut;
  o.pos = cam.proj * vec4f(vp, 1.0);
  o.uv = c;
  o.viewCenter = vc;
  return o;
}

// ------------------------------------------------------------- depth pass

@vertex
fn vsDepth(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> SpriteOut {
  return spriteVS(vi, ii, cam.pRadius);
}

struct DepthOut {
  @location(0) color : vec4f,
  @builtin(frag_depth) depth : f32,
};

@fragment
fn fsDepth(in: SpriteOut) -> DepthOut {
  let r2 = dot(in.uv, in.uv);
  if (r2 > 1.0) { discard; }
  let nz = sqrt(1.0 - r2);
  // view space: camera looks along -Z, sphere surface toward camera is +nz
  let viewPos = in.viewCenter + vec3f(in.uv * cam.pRadius, nz * cam.pRadius);
  let clip = cam.proj * vec4f(viewPos, 1.0);
  var o: DepthOut;
  o.depth = clamp(clip.z / clip.w, 0.0, 1.0);
  o.color = vec4f(-viewPos.z, 0.0, 0.0, 1.0); // positive linear view depth
  return o;
}

// ---------------------------------------------------------- thickness pass

@vertex
fn vsThick(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> SpriteOut {
  return spriteVS(vi, ii, cam.thickRadius);
}

@fragment
fn fsThick(in: SpriteOut) -> @location(0) vec4f {
  let r2 = dot(in.uv, in.uv);
  if (r2 > 1.0) { discard; }
  let nz = sqrt(1.0 - r2);
  // integrated chord length through the sphere, softened
  let t = nz * nz * cam.thickRadius * 2.0;
  return vec4f(t, 0.0, 0.0, 1.0);
}
