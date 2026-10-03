import { SIM_COMMON, WORLD_RO } from './sim.wgsl.js';

// Shared camera / light uniforms
const CAM = /* wgsl */`
struct Cam {
  view: mat4x4f, proj: mat4x4f, invView: mat4x4f, lightVP: mat4x4f,
  eye: vec4f,     // xyz, time
  res: vec4f,     // width, height, tanX, tanY
  misc: vec4f,    // render radius, projScale, numBalls, fluid visible
  dims: vec4f,    // W, H, D, paddle enabled
  lightO: vec4f,  // light origin, shadow map size
  lightR: vec4f,  // light right axis, ortho half extent
  lightU: vec4f,  // light up axis
}
struct Mat {
  base: vec4f,     // albedo rgb, opacity (scattering extinction)
  absorb: vec4f,   // absorption rgb, roughness
  scatter: vec4f,  // in-scatter colour rgb, in-scatter density
  p0: vec4f,       // F0, refraction, wrap/SSS, foam
  p1: vec4f,       // albedo noise, normal detail, clearcoat, caustics
}
const SUN_DIR = vec3f(0.42, 0.82, 0.38);
const SUN_COL = vec3f(1.0, 0.94, 0.84) * 3.2;
const PI = 3.14159265;

fn sky(dIn: vec3f) -> vec3f {
  let d = normalize(dIn);
  let sd = normalize(SUN_DIR);
  let y = d.y;
  let zenith = vec3f(0.16, 0.34, 0.70);
  let horizon = vec3f(0.80, 0.84, 0.90);
  let ground = vec3f(0.26, 0.24, 0.22);
  var c = select(mix(horizon * 0.7, ground, clamp(-y * 3.0, 0.0, 1.0)),
                 mix(horizon, zenith, pow(clamp(y, 0.0, 1.0), 0.5)), y > 0.0);
  let s = max(dot(d, sd), 0.0);
  c += SUN_COL * (pow(s, 1200.0) * 30.0 + pow(s, 64.0) * 0.35 + pow(s, 6.0) * 0.08);
  return c;
}
fn aces(x: vec3f) -> vec3f {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0));
}
fn hash3(p0: vec3f) -> f32 {
  var p = fract(p0 * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
fn vnoise(p: vec3f) -> f32 {
  let i = floor(p);
  var f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(i), hash3(i + vec3f(1, 0, 0)), f.x), mix(hash3(i + vec3f(0, 1, 0)), hash3(i + vec3f(1, 1, 0)), f.x), f.y),
             mix(mix(hash3(i + vec3f(0, 0, 1)), hash3(i + vec3f(1, 0, 1)), f.x), mix(hash3(i + vec3f(0, 1, 1)), hash3(i + vec3f(1, 1, 1)), f.x), f.y), f.z);
}
fn fbm(p0: vec3f) -> f32 {
  var p = p0; var a = 0.5; var s = 0.0;
  for (var i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + vec3f(1.7, 9.2, 3.1); a *= 0.5; }
  return s;
}
fn ggx(n: vec3f, v: vec3f, l: vec3f, rough: f32) -> f32 {
  let h = normalize(v + l);
  let a = max(rough * rough, 0.002);
  let nh = max(dot(n, h), 0.0);
  let nv = max(dot(n, v), 1e-3);
  let nl = max(dot(n, l), 0.0);
  let dd = nh * nh * (a * a - 1.0) + 1.0;
  let D = a * a / (PI * dd * dd);
  let k = (rough + 1.0) * (rough + 1.0) / 8.0;
  let G = nv / (nv * (1.0 - k) + k) * nl / (nl * (1.0 - k) + k);
  return D * G / (4.0 * nv) ;
}
// distance of p from the light plane, along -SUN_DIR (matches the light depth map)
fn lightDist(p: vec3f, c: Cam) -> f32 { return dot(c.lightO.xyz - p, normalize(SUN_DIR)); }
fn lightUV(p: vec3f, c: Cam) -> vec2f {
  let q = c.lightVP * vec4f(p, 1.0);
  return vec2f(q.x * 0.5 + 0.5, 0.5 - q.y * 0.5);
}
// animated caustic pattern (two warped cell layers)
fn causticPattern(xz: vec2f, t: f32) -> f32 {
  var acc = 0.0;
  for (var l = 0; l < 2; l++) {
    let s = select(0.55, 0.9, l == 1);
    let w = xz * s + vec2f(vnoise(vec3f(xz * 0.3, t * 0.4)), vnoise(vec3f(xz * 0.3 + 7.0, t * 0.4))) * 1.6 + f32(l) * 3.7;
    let i = floor(w);
    let f = fract(w);
    var md = 9.0;
    var md2 = 9.0;
    for (var y = -1; y <= 1; y++) {
      for (var x = -1; x <= 1; x++) {
        let g = vec2f(f32(x), f32(y));
        let h = hash3(vec3f(i + g, f32(l)));
        let o = 0.5 + 0.45 * sin(t * (0.6 + h) + 6.2831 * vec2f(h, fract(h * 7.31)));
        let d = length(g + o - f);
        if (d < md) { md2 = md; md = d; } else if (d < md2) { md2 = d; }
      }
    }
    acc += pow(clamp(1.0 - (md2 - md) * 2.2, 0.0, 1.0), 6.0);
  }
  return acc;
}
`;

// ---------------------------------------------------------------- particles (camera + light views)
export const PARTICLE_WGSL = CAM + /* wgsl */`
@group(0) @binding(0) var<uniform> cam: Cam;
@group(0) @binding(1) var<storage, read> pos: array<vec4f>;
@group(0) @binding(2) var<storage, read> vel: array<vec4f>;
@group(0) @binding(3) var sceneLin: texture_2d<f32>;

struct VOut {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
  @location(1) eyeC: vec3f,
  @location(2) dens: f32,
  @location(3) foam: f32,
  @location(4) wc: vec3f,
}
fn corner(vi: u32) -> vec2f {
  var c = array<vec2f, 6>(vec2f(-1, -1), vec2f(1, -1), vec2f(1, 1), vec2f(-1, -1), vec2f(1, 1), vec2f(-1, 1));
  return c[vi];
}
@vertex fn vsCam(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  var o: VOut;
  let c = corner(vi);
  let p = pos[ii];
  let r = cam.misc.x;
  let e = cam.view * vec4f(p.xyz, 1.0);
  o.clip = cam.proj * vec4f(e.xy + c * r, e.z, 1.0);
  o.uv = c; o.eyeC = e.xyz; o.dens = p.w; o.foam = vel[ii].w; o.wc = p.xyz;
  return o;
}
@vertex fn vsLight(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  var o: VOut;
  let c = corner(vi);
  let p = pos[ii];
  let r = cam.misc.x;
  let w = p.xyz + (cam.lightR.xyz * c.x + cam.lightU.xyz * c.y) * r;
  o.clip = cam.lightVP * vec4f(w, 1.0);
  o.uv = c; o.eyeC = vec3f(0.0); o.dens = p.w; o.foam = vel[ii].w; o.wc = p.xyz;
  return o;
}

struct DepthOut { @location(0) d: f32, @builtin(frag_depth) fd: f32 }

@fragment fn fsDepth(i: VOut) -> DepthOut {
  let r2 = dot(i.uv, i.uv);
  if (r2 > 1.0) { discard; }
  let r = cam.misc.x;
  let pe = i.eyeC + vec3f(i.uv, sqrt(1.0 - r2)) * r;
  let sd = textureLoad(sceneLin, vec2i(i.clip.xy), 0).r;
  if (-pe.z > sd) { discard; }
  let cp = cam.proj * vec4f(pe, 1.0);
  var o: DepthOut;
  o.d = -pe.z;
  o.fd = cp.z / cp.w;
  return o;
}

@fragment fn fsThick(i: VOut) -> @location(0) vec4f {
  let r2 = dot(i.uv, i.uv);
  if (r2 > 1.0) { discard; }
  let r = cam.misc.x;
  let z = sqrt(1.0 - r2);
  let sd = textureLoad(sceneLin, vec2i(i.clip.xy), 0).r;
  if (-i.eyeC.z - z * r > sd) { discard; }
  let t = 2.0 * z * r * exp(-r2 * 1.6);
  // whitewater: explicit foam attribute + sparse spray particles
  let spray = smoothstep(0.7, 0.3, i.dens);
  let f = clamp(i.foam + spray * 0.6, 0.0, 1.0);
  return vec4f(t, t * f, 0.0, 0.0);
}

@fragment fn fsLightDepth(i: VOut) -> DepthOut {
  let r2 = dot(i.uv, i.uv);
  if (r2 > 1.0) { discard; }
  let r = cam.misc.x;
  let surf = i.wc + normalize(SUN_DIR) * (sqrt(1.0 - r2) * r);
  let q = cam.lightVP * vec4f(surf, 1.0);
  var o: DepthOut;
  o.d = lightDist(surf, cam);
  o.fd = clamp(q.z, 0.0, 1.0);
  return o;
}

@fragment fn fsLightThick(i: VOut) -> @location(0) vec4f {
  let r2 = dot(i.uv, i.uv);
  if (r2 > 1.0) { discard; }
  let r = cam.misc.x;
  return vec4f(2.0 * sqrt(1.0 - r2) * r * exp(-r2 * 1.6), 0.0, 0.0, 0.0);
}

struct SceneOut { @location(0) color: vec4f, @location(1) lin: f32, @builtin(frag_depth) fd: f32 }
@fragment fn fsDebug(i: VOut) -> SceneOut {
  let r2 = dot(i.uv, i.uv);
  if (r2 > 1.0) { discard; }
  let r = cam.misc.x;
  let n = vec3f(i.uv, sqrt(1.0 - r2));
  let pe = i.eyeC + n * r;
  let cp = cam.proj * vec4f(pe, 1.0);
  let lE = normalize((cam.view * vec4f(SUN_DIR, 0.0)).xyz);
  var col = mix(vec3f(1.0, 0.35, 0.08), vec3f(0.1, 0.45, 1.0), clamp(i.dens, 0.0, 1.0));
  col = mix(col, vec3f(1.0), i.foam);
  var o: SceneOut;
  o.color = vec4f(col * (0.25 + 0.75 * max(dot(n, lE), 0.0)), 1.0);
  o.lin = -pe.z;
  o.fd = cp.z / cp.w;
  return o;
}
`;

// ---------------------------------------------------------------- scene: sky + meshes with fluid shadows & caustics
export const SCENE_WGSL = CAM + SIM_COMMON + WORLD_RO + /* wgsl */`
struct Inst { model: mat4x4f, color: vec4f, params: vec4f }  // params: kind, ball index, roughness, _
@group(0) @binding(0) var<uniform> cam: Cam;
@group(0) @binding(1) var<storage, read> inst: array<Inst>;
@group(0) @binding(2) var<storage, read> world: World;
@group(0) @binding(3) var lightDepth: texture_2d<f32>;
@group(0) @binding(4) var lightThick: texture_2d<f32>;
@group(0) @binding(5) var samp: sampler;
@group(0) @binding(6) var<uniform> mat: Mat;

struct SceneOut { @location(0) color: vec4f, @location(1) lin: f32 }

struct FsIn { @builtin(position) clip: vec4f, @location(0) uv: vec2f }
@vertex fn vsFull(@builtin(vertex_index) vi: u32) -> FsIn {
  let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u)) * 2.0 - 1.0;
  var o: FsIn;
  o.clip = vec4f(p, 0.0, 1.0);
  o.uv = p * 0.5 + 0.5;
  return o;
}
@fragment fn fsSky(i: FsIn) -> SceneOut {
  let dE = normalize(vec3f((i.uv * 2.0 - 1.0) * cam.res.zw, -1.0));
  let d = (cam.invView * vec4f(dE, 0.0)).xyz;
  var o: SceneOut;
  o.color = vec4f(sky(d), 1.0);
  o.lin = 1e6;
  return o;
}

struct MOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
  @location(1) normal: vec3f,
  @location(2) @interpolate(flat) id: u32,
  @location(3) lin: f32,
}
@vertex fn vsMesh(@location(0) p: vec3f, @location(1) n: vec3f, @builtin(instance_index) ii: u32) -> MOut {
  let I = inst[ii];
  var m = I.model;
  let kind = I.params.x;
  if (kind > 0.5 && kind < 1.5) {          // rigid ball
    let b = world.balls[u32(I.params.y)];
    m = mat4x4f(vec4f(b.p.w, 0, 0, 0), vec4f(0, b.p.w, 0, 0), vec4f(0, 0, b.p.w, 0), vec4f(b.p.xyz, 1.0));
  } else if (kind > 1.5 && kind < 2.5) {   // wave paddle
    m[3].x += world.paddle.x;
  }
  let w = m * vec4f(p, 1.0);
  var o: MOut;
  o.world = w.xyz;
  o.normal = normalize((m * vec4f(n, 0.0)).xyz);
  if (kind > 3.5) { o.normal = -o.normal; } // tank interior walls
  o.id = ii;
  let e = cam.view * w;
  o.lin = -e.z;
  o.clip = cam.proj * e;
  return o;
}

@fragment fn fsMesh(i: MOut) -> SceneOut {
  let I = inst[i.id];
  let kind = I.params.x;
  var n = normalize(i.normal);
  var base = I.color.rgb;
  let rough = I.params.z;
  let wp = i.world;
  if (kind > 2.5 && kind < 3.5) {            // tiled floor
    let t = floor(wp.xz / 2.0);
    base = mix(vec3f(0.50, 0.49, 0.47), vec3f(0.66, 0.64, 0.60), (t.x + t.y) - 2.0 * floor((t.x + t.y) * 0.5));
    let g = abs(fract(wp.xz / 2.0) - 0.5);
    base *= 0.82 + 0.18 * (1.0 - smoothstep(0.465, 0.495, max(g.x, g.y)));
    base *= 0.9 + 0.2 * vnoise(vec3f(wp.xz * 3.0, 0.0));
  } else if (kind > 3.5) {                   // pool tiles on the walls
    let uvw = select(wp.zy, wp.xy, abs(n.z) > 0.5);
    let g = abs(fract(uvw / 1.5) - 0.5);
    base = vec3f(0.62, 0.74, 0.78) * (0.8 + 0.2 * (1.0 - smoothstep(0.44, 0.49, max(g.x, g.y))));
  }
  let v = normalize(cam.eye.xyz - wp);
  let l = normalize(SUN_DIR);
  // ---- fluid shadow / transmittance from the light-space maps
  let luv = lightUV(wp, cam);
  var sunT = 1.0;
  var caust = 0.0;
  if (all(luv > vec2f(0.0)) && all(luv < vec2f(1.0))) {
    let sz = vec2f(textureDimensions(lightDepth));
    let dl = textureLoad(lightDepth, vec2i(luv * sz), 0).r;
    let below = lightDist(wp, cam) - dl;
    if (below > 0.3) {
      let T = textureSampleLevel(lightThick, samp, luv, 0.0).r;
      let ext = mat.absorb.rgb + vec3f(mat.base.a) + vec3f(mat.scatter.a * 0.3);
      sunT = exp(-dot(ext, vec3f(0.333)) * T * 0.6);
      // caustics: focus where the light-space thickness is concave + procedural pattern
      let px = 1.0 / sz;
      let lap = textureSampleLevel(lightThick, samp, luv + vec2f(px.x * 2.0, 0.0), 0.0).r + textureSampleLevel(lightThick, samp, luv - vec2f(px.x * 2.0, 0.0), 0.0).r
              + textureSampleLevel(lightThick, samp, luv + vec2f(0.0, px.y * 2.0), 0.0).r + textureSampleLevel(lightThick, samp, luv - vec2f(0.0, px.y * 2.0), 0.0).r - 4.0 * T;
      let wet = smoothstep(0.2, 2.0, T);
      caust = mat.p1.w * wet * (causticPattern(wp.xz * 0.9 + wp.y * 0.3, cam.eye.w) * 0.9 + clamp(-lap * 0.8, 0.0, 2.0)) * exp(-below * 0.04);
    }
  }
  // analytic ball shadows + AO
  var sh = 1.0;
  let nb = u32(cam.misc.z);
  for (var k = 0u; k < nb; k++) {
    let b = world.balls[k];
    let oc = b.p.xyz - wp;
    let t = dot(oc, l);
    if (t > 0.0) { sh *= smoothstep(b.p.w * 0.55, b.p.w * 1.2, length(oc - l * t)); }
    let dl = length(oc);
    sh *= 1.0 - 0.6 * clamp(b.p.w * b.p.w / (dl * dl) * max(dot(n, oc / dl), 0.0), 0.0, 1.0);
  }
  let ndl = max(dot(n, l), 0.0);
  let amb = mix(vec3f(0.24, 0.22, 0.21), vec3f(0.42, 0.52, 0.68), n.y * 0.5 + 0.5) * 0.65;
  let sunLight = SUN_COL * ndl * sh * sunT;
  let fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
  var col = base * (amb + sunLight * 0.5) + SUN_COL * ggx(n, v, l, max(rough, 0.05)) * fres * ndl * sh * sunT * 0.4;
  col += base * SUN_COL * caust * sh * 0.25;
  col += sky(reflect(-v, n)) * fres * (1.0 - rough) * 0.35;
  var o: SceneOut;
  o.color = vec4f(col, 1.0);
  o.lin = i.lin;
  return o;
}
`;

// ---------------------------------------------------------------- post: depth smoothing, thickness blur, composite
export const SMOOTH_WGSL = CAM + /* wgsl */`
@group(0) @binding(0) var<uniform> cam: Cam;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var<uniform> dir: vec4f;   // xy direction, z = world filter radius, w = range falloff
@vertex fn vsFull(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u)) * 2.0 - 1.0;
  return vec4f(p, 0.0, 1.0);
}
// depth-aware bilateral filter with a narrow-range clamp (keeps silhouettes, kills sphere bumps)
@fragment fn fsSmooth(@builtin(position) fc: vec4f) -> @location(0) f32 {
  let ic = vec2i(fc.xy);
  let d = textureLoad(src, ic, 0).r;
  if (d > 1e5) { return d; }
  let size = vec2i(textureDimensions(src));
  let radPx = clamp(dir.z * cam.misc.y * 0.5 / d, 1.0, 40.0);
  let taps = 12;
  let stepPx = radPx / f32(taps);
  let range = dir.w;
  var sum = 0.0;
  var ws = 0.0;
  for (var k = -taps; k <= taps; k++) {
    let off = dir.xy * f32(k) * stepPx;
    let sc = clamp(ic + vec2i(round(off)), vec2i(0), size - vec2i(1));
    var s = textureLoad(src, sc, 0).r;
    if (s > 1e5) { continue; }
    // narrow range: samples far in front are clamped instead of rejected, far behind are dropped
    if (s < d - range * 1.5) { s = d - range * 1.5; }
    if (s > d + range * 3.0) { continue; }
    let x = f32(k) / f32(taps);
    let dz = (s - d) / range;
    let w = exp(-x * x * 2.0) * exp(-dz * dz * 0.5);
    sum += s * w;
    ws += w;
  }
  return sum / max(ws, 1e-5);
}
`;

export const BLUR_WGSL = /* wgsl */`
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var<uniform> dir: vec4f;
@vertex fn vsFull(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u)) * 2.0 - 1.0;
  return vec4f(p, 0.0, 1.0);
}
@fragment fn fsBlur(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let ic = vec2i(fc.xy);
  let size = vec2i(textureDimensions(src));
  var s = vec4f(0.0);
  var ws = 0.0;
  for (var k = -8; k <= 8; k++) {
    let w = exp(-f32(k * k) / 24.0);
    let sc = clamp(ic + vec2i(dir.xy * f32(k) * dir.z), vec2i(0), size - vec2i(1));
    s += textureLoad(src, sc, 0) * w;
    ws += w;
  }
  return s / ws;
}
`;

export const COMPOSITE_WGSL = CAM + /* wgsl */`
@group(0) @binding(0) var<uniform> cam: Cam;
@group(0) @binding(1) var<uniform> mat: Mat;
@group(0) @binding(2) var sceneColor: texture_2d<f32>;
@group(0) @binding(3) var fluidDepth: texture_2d<f32>;
@group(0) @binding(4) var thick: texture_2d<f32>;
@group(0) @binding(5) var sceneLin: texture_2d<f32>;
@group(0) @binding(6) var lightDepth: texture_2d<f32>;
@group(0) @binding(7) var lightThick: texture_2d<f32>;
@group(0) @binding(8) var samp: sampler;

@vertex fn vsFull(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u)) * 2.0 - 1.0;
  return vec4f(p, 0.0, 1.0);
}

fn eyePos(ic: vec2i) -> vec3f {
  let size = vec2i(textureDimensions(fluidDepth));
  let c = clamp(ic, vec2i(0), size - vec2i(1));
  let d = textureLoad(fluidDepth, c, 0).r;
  let uv = (vec2f(c) + 0.5) / vec2f(size);
  let ndc = vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  return vec3f(ndc * cam.res.zw * d, -d);
}

fn finish(c: vec3f) -> vec4f {
  // exposure, ACES, gamma handled by sRGB-less canvas -> do it manually
  return vec4f(pow(aces(c * 0.95), vec3f(1.0 / 2.2)), 1.0);
}

@fragment fn fsComposite(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let ic = vec2i(fc.xy);
  let res = vec2f(textureDimensions(sceneColor));
  let uv = fc.xy / res;
  let bg = textureLoad(sceneColor, ic, 0).rgb;
  let d = textureLoad(fluidDepth, ic, 0).r;
  if (d > 1e5 || cam.misc.w < 0.5) { return finish(bg); }

  // ---- reconstruct the surface
  let P = eyePos(ic);
  var ddx = eyePos(ic + vec2i(1, 0)) - P;
  let ddx2 = P - eyePos(ic - vec2i(1, 0));
  if (abs(ddx2.z) < abs(ddx.z)) { ddx = ddx2; }
  var ddy = eyePos(ic - vec2i(0, 1)) - P;
  let ddy2 = P - eyePos(ic + vec2i(0, 1));
  if (abs(ddy2.z) < abs(ddy.z)) { ddy = ddy2; }
  var nE = normalize(cross(ddx, ddy));
  if (nE.z < 0.0) { nE = -nE; }

  let th = textureLoad(thick, ic, 0);
  let T = th.r;
  let foamT = th.g;
  let R = mat3x3f(cam.invView[0].xyz, cam.invView[1].xyz, cam.invView[2].xyz);
  var N = normalize(R * nE);
  let V = normalize(R * normalize(-P));
  let wp = (cam.invView * vec4f(P, 1.0)).xyz;
  let t = cam.eye.w;
  let L = normalize(SUN_DIR);

  // ---- micro detail: capillary ripples for liquids, lumpy grain for mud
  let det = mat.p1.y;
  if (det > 0.0) {
    let q = wp * select(1.6, 0.9, mat.p1.x > 0.0) + vec3f(t * 0.6, t * 0.25, -t * 0.45) * select(1.0, 0.0, mat.p1.x > 0.0);
    let e = 0.12;
    let gN = vec3f(fbm(q + vec3f(e, 0, 0)) - fbm(q - vec3f(e, 0, 0)),
                   fbm(q + vec3f(0, e, 0)) - fbm(q - vec3f(0, e, 0)),
                   fbm(q + vec3f(0, 0, e)) - fbm(q - vec3f(0, 0, e))) / (2.0 * e);
    N = normalize(N - (gN - N * dot(gN, N)) * det);
  }

  // ---- light visibility at the surface (fluid self-shadowing via light depth map)
  var sunVis = 1.0;
  let luv = lightUV(wp, cam);
  if (all(luv > vec2f(0.0)) && all(luv < vec2f(1.0))) {
    let sz = vec2f(textureDimensions(lightDepth));
    let dl = textureLoad(lightDepth, vec2i(luv * sz), 0).r;
    let depthBelow = max(lightDist(wp, cam) - dl - 0.6, 0.0);
    let ext = dot(mat.absorb.rgb, vec3f(0.333)) + mat.base.a + mat.scatter.a * 0.3;
    sunVis = exp(-depthBelow * ext * 0.7);
  }

  // ---- refraction & absorption (Beer–Lambert)
  let refrAmt = mat.p0.y * clamp(T * 0.07, 0.0, 1.0);
  var ruv = uv + nE.xy * vec2f(1.0, -1.0) * refrAmt;
  ruv = clamp(ruv, vec2f(0.001), vec2f(0.999));
  if (textureLoad(sceneLin, vec2i(ruv * res), 0).r < d) { ruv = uv; }
  let refr = textureSampleLevel(sceneColor, samp, ruv, 0.0).rgb;
  let transmitted = refr * exp(-mat.absorb.rgb * T);

  // ---- body: in-scattering (water/honey glow) + opaque scattering albedo (milk/chocolate/mud)
  let amb = mix(vec3f(0.22, 0.21, 0.2), vec3f(0.42, 0.52, 0.68), N.y * 0.5 + 0.5);
  let inscatter = mat.scatter.rgb * (amb * 0.45 + SUN_COL * 0.35 * sunVis) * (1.0 - exp(-mat.scatter.a * T));
  var albedo = mat.base.rgb;
  if (mat.p1.x > 0.0) { albedo *= 0.65 + 0.7 * fbm(wp * 0.7); }
  let ndl = dot(N, L);
  let wrap = mat.p0.z;
  let diff = max((ndl + wrap) / (1.0 + wrap), 0.0);
  let backlit = pow(clamp(dot(V, -L), 0.0, 1.0), 3.0) * wrap * exp(-T * 0.25);
  let lit = albedo * (amb * 0.75 + SUN_COL * 0.45 * diff * sunVis) + albedo * SUN_COL * backlit * 0.5 * sunVis;
  let opacity = 1.0 - exp(-mat.base.a * T);
  let body = mix(transmitted, lit, opacity) + inscatter * (1.0 - opacity);

  // ---- specular + reflection
  let rough = mat.absorb.a;
  let nv = max(dot(N, V), 1e-3);
  let F0 = mat.p0.x;
  let F = F0 + (1.0 - F0) * pow(1.0 - nv, 5.0);
  var spec = SUN_COL * ggx(N, V, L, rough) * max(ndl, 0.0) * F * sunVis * 1.2;
  if (mat.p1.z > 0.0) { // clearcoat lobe (glossy chocolate / honey)
    spec += SUN_COL * ggx(N, V, L, 0.06) * max(ndl, 0.0) * (0.04 + 0.96 * pow(1.0 - nv, 5.0)) * mat.p1.z * sunVis;
  }
  let refl = mix(sky(reflect(-V, N)), amb * 0.7, rough * 0.85);
  var col = body * (1.0 - F) + refl * F + spec;

  // ---- whitewater / foam
  if (mat.p0.w > 0.0) {
    let fa = clamp(foamT * 0.45, 0.0, 1.0);
    let breakup = smoothstep(0.25, 0.75, fbm(wp * 1.4 + vec3f(0.0, t * 0.3, 0.0)) + fa * 0.5);
    let f = clamp(fa * breakup * 1.3, 0.0, 0.95) * mat.p0.w;
    let foamCol = vec3f(0.92, 0.95, 0.97) * (amb * 0.9 + SUN_COL * 0.35 * max(ndl * 0.6 + 0.4, 0.0) * sunVis);
    col = mix(col, foamCol, f);
  }

  // thin sheets fade out smoothly instead of a hard silhouette
  col = mix(bg, col, clamp(T * 1.8, 0.0, 1.0));
  return finish(col);
}
`;
