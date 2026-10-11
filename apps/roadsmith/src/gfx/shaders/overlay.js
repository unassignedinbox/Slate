// Editor overlays drawn after the scene: quad wireframe, spline/control handles, gizmo, lane graph.
// All of them are plain coloured line/triangle lists in world space.

export const OVERLAY_WGSL = /* wgsl */ `
struct OGlobals {
  viewProj : mat4x4f,
  camPos   : vec4f,
  params   : vec4f,   // x = depth bias, y = time, z = pixel scale, w = alpha
};

@group(0) @binding(0) var<uniform> O: OGlobals;

struct VSIn {
  @location(0) pos    : vec3f,
  @location(1) colour : vec4f,
};

struct VSOut {
  @builtin(position) clip : vec4f,
  @location(0) colour : vec4f,
  @location(1) wpos   : vec3f,
};

@vertex
fn vs_main(v: VSIn) -> VSOut {
  var o: VSOut;
  // pull overlay lines a hair towards the camera so they never z-fight the road
  let toCam = normalize(O.camPos.xyz - v.pos);
  let p = v.pos + toCam * O.params.x * (0.004 + distance(O.camPos.xyz, v.pos) * 0.0022);
  o.clip = O.viewProj * vec4f(p, 1.0);
  o.colour = v.colour;
  o.wpos = v.pos;
  return o;
}

@fragment
fn fs_main(i: VSOut) -> @location(0) vec4f {
  var a = i.colour.a * O.params.w;
  // fade distant wireframe so dense junction meshes stay readable
  let d = distance(O.camPos.xyz, i.wpos);
  a *= clamp(1.0 - (d - 220.0) / 420.0, 0.0, 1.0);
  if (a <= 0.004) { discard; }
  return vec4f(i.colour.rgb, a);
}
`;

// Quad wireframe: reuses the scene vertex buffer (only position is read) with a line-list index buffer.
export const WIRE_WGSL = /* wgsl */ `
struct OGlobals {
  viewProj : mat4x4f,
  camPos   : vec4f,
  params   : vec4f,
};
@group(0) @binding(0) var<uniform> O: OGlobals;

struct VSOut {
  @builtin(position) clip: vec4f,
  @location(0) wpos: vec3f,
};

@vertex
fn vs_main(@location(0) pos: vec3f) -> VSOut {
  var o: VSOut;
  let toCam = normalize(O.camPos.xyz - pos);
  let p = pos + toCam * (0.01 + distance(O.camPos.xyz, pos) * 0.0016);
  o.clip = O.viewProj * vec4f(p, 1.0);
  o.wpos = pos;
  return o;
}

@fragment
fn fs_main(i: VSOut) -> @location(0) vec4f {
  let d = distance(O.camPos.xyz, i.wpos);
  let a = O.params.w * clamp(1.0 - (d - 90.0) / 160.0, 0.0, 1.0);
  if (a <= 0.004) { discard; }
  return vec4f(0.52, 0.80, 1.0, a);
}
`;
