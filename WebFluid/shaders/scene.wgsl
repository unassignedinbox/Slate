// ============================================================================
// Scene rendering: procedural sky, checker floor, lit meshes (obstacles),
// tank edge lines. Rendered into HDR scene buffer at dynamic resolution.
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

const SUN_COLOR = vec3f(1.0, 0.96, 0.9);

fn sky(dIn: vec3f) -> vec3f {
  let d = normalize(dIn);
  let t = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
  var c = mix(vec3f(0.42, 0.45, 0.50), vec3f(0.55, 0.68, 0.88), pow(t, 0.55));
  // horizon glow
  c += vec3f(0.9, 0.75, 0.55) * 0.18 * pow(1.0 - abs(d.y), 5.0);
  // sun
  let sd = max(dot(d, cam.sunDir), 0.0);
  c += SUN_COLOR * (pow(sd, 450.0) * 20.0 + pow(sd, 32.0) * 0.28);
  // below horizon: darker ground haze
  if (d.y < 0.0) {
    c = mix(c, vec3f(0.18, 0.18, 0.20), clamp(-d.y * 3.0, 0.0, 1.0));
  }
  return c;
}

// ------------------------------------------------------------------- sky

struct SkyOut {
  @builtin(position) pos : vec4f,
  @location(0) ndc : vec2f,
};

@vertex
fn vsSky(@builtin(vertex_index) vi: u32) -> SkyOut {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: SkyOut;
  o.pos = vec4f(p[vi], 1.0, 1.0);
  o.ndc = p[vi];
  return o;
}

@fragment
fn fsSky(in: SkyOut) -> @location(0) vec4f {
  let vp = cam.invProj * vec4f(in.ndc, 0.6, 1.0);
  let dirView = normalize(vp.xyz / vp.w);
  let dirWorld = (cam.invView * vec4f(dirView, 0.0)).xyz;
  return vec4f(sky(dirWorld), 1.0);
}

// ------------------------------------------------------------------- floor

struct FloorOut {
  @builtin(position) pos : vec4f,
  @location(0) wp : vec3f,
};

@vertex
fn vsFloor(@builtin(vertex_index) vi: u32) -> FloorOut {
  let S = 30.0;
  var quad = array<vec2f, 6>(
    vec2f(-S, -S), vec2f(S, -S), vec2f(S, S),
    vec2f(-S, -S), vec2f(S, S), vec2f(-S, S));
  let xz = quad[vi];
  var o: FloorOut;
  o.wp = vec3f(xz.x, 0.0, xz.y);
  o.pos = cam.proj * cam.view * vec4f(o.wp, 1.0);
  return o;
}

@fragment
fn fsFloor(in: FloorOut) -> @location(0) vec4f {
  let ck = floor(in.wp.x * 1.25) + floor(in.wp.z * 1.25);
  let checker = select(0.78, 0.62, (i32(ck) & 1) == 0);
  var alb = vec3f(checker) * vec3f(0.92, 0.94, 1.0);
  // subtle warm center
  alb *= 0.9 + 0.1 * exp(-dot(in.wp.xz, in.wp.xz) * 0.03);

  let n = vec3f(0.0, 1.0, 0.0);
  let ndl = max(dot(n, cam.sunDir), 0.0);
  var col = alb * (0.35 * sky(n) + SUN_COLOR * ndl * 0.85);

  // fake soft shadow inside the tank region
  let inTank = smoothstep(1.75, 1.35, abs(in.wp.x)) * smoothstep(1.25, 0.95, abs(in.wp.z));
  col *= 1.0 - 0.18 * inTank;

  // distance fog into horizon
  let dist = length(in.wp - cam.eye);
  let fog = 1.0 - exp(-dist * 0.045);
  col = mix(col, vec3f(0.5, 0.58, 0.7), fog * 0.85);
  return vec4f(col, 1.0);
}

// ------------------------------------------------------------------- meshes

struct Obj {
  model  : mat4x4f,
  color  : vec4f,   // rgb albedo, a roughness
  params : vec4f,   // x specular intensity
};
@group(1) @binding(0) var<uniform> obj : Obj;

struct MeshOut {
  @builtin(position) pos : vec4f,
  @location(0) wp : vec3f,
  @location(1) n  : vec3f,
};

@vertex
fn vsMesh(@location(0) p: vec3f, @location(1) n: vec3f) -> MeshOut {
  var o: MeshOut;
  let wp = (obj.model * vec4f(p, 1.0)).xyz;
  o.wp = wp;
  o.n = normalize((obj.model * vec4f(n, 0.0)).xyz);
  o.pos = cam.proj * cam.view * vec4f(wp, 1.0);
  return o;
}

@fragment
fn fsMesh(in: MeshOut) -> @location(0) vec4f {
  let n = normalize(in.n);
  let v = normalize(cam.eye - in.wp);
  let ndl = max(dot(n, cam.sunDir), 0.0);
  let h = normalize(cam.sunDir + v);
  let rough = obj.color.a;
  let shin = mix(400.0, 12.0, rough);
  let spec = pow(max(dot(n, h), 0.0), shin) * obj.params.x;
  let fres = pow(1.0 - max(dot(n, v), 0.0), 5.0);

  var col = obj.color.rgb * (0.4 * sky(n) + SUN_COLOR * ndl * 0.9);
  col += SUN_COLOR * spec;
  col += sky(reflect(-v, n)) * (0.04 + 0.4 * fres) * obj.params.x;
  return vec4f(col, 1.0);
}

// ------------------------------------------------------------------- lines

struct LineOut { @builtin(position) pos : vec4f, };

@vertex
fn vsLine(@location(0) p: vec3f) -> LineOut {
  var o: LineOut;
  o.pos = cam.proj * cam.view * vec4f(p, 1.0);
  return o;
}

@fragment
fn fsLine() -> @location(0) vec4f {
  return vec4f(0.75, 0.8, 0.88, 1.0);
}
