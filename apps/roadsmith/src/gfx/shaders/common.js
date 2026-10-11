// Shared WGSL chunks. Everything is plain template strings so the app runs with no build step.

export const STRUCTS = /* wgsl */ `
struct Globals {
  viewProj   : mat4x4f,
  sunViewProj: mat4x4f,
  invViewProj: mat4x4f,
  camPos     : vec4f,   // xyz, w = time
  sunDir     : vec4f,   // xyz = direction TO the sun, w = sun intensity
  sunColour  : vec4f,   // rgb, w = ambient intensity
  skyColour  : vec4f,   // rgb zenith, w = exposure
  horizon    : vec4f,   // rgb horizon, w = ground bounce
  params     : vec4f,   // x wetness, y wear gain, z shadow texel, w light count
  flags      : vec4f,   // x selection highlight, y markings on, z night, w shadow strength
  fog        : vec4f,   // rgb fog colour, w density
  selection  : vec4f,   // xyz selected junction centre, w radius (<=0 = nothing)
};

struct Material {
  albedo : vec4f,   // rgb base colour, a opacity
  p0     : vec4f,   // roughness, metallic, patternScale, detailGain
  p1     : vec4f,   // wearGain, puddleGain, emissive, patternId
  p2     : vec4f,   // enabled, tintStrength, normalGain, spare
};

struct Light {
  posRange : vec4f, // xyz world, w range
  colour   : vec4f, // rgb, w intensity
};
`;

export const BINDINGS = /* wgsl */ `
@group(0) @binding(0) var<uniform> G: Globals;
@group(0) @binding(1) var<uniform> MATS: array<Material, 50>;
@group(0) @binding(2) var<uniform> LIGHTS: array<Light, 48>;
@group(0) @binding(3) var<uniform> SIGNALS: array<vec4f, 24>;
@group(0) @binding(4) var shadowTex: texture_depth_2d;
@group(0) @binding(5) var shadowSamp: sampler_comparison;
`;

export const NOISE = /* wgsl */ `
fn hash21(p: vec2f) -> f32 {
  var h = fract(p * vec2f(0.1031, 0.1030));
  h += dot(h, h.yx + 33.33);
  return fract((h.x + h.y) * h.x * 97.0);
}
fn hash22(p: vec2f) -> vec2f {
  var h = fract(vec2f(dot(p, vec2f(127.1, 311.7)), dot(p, vec2f(269.5, 183.3))) * 0.000763);
  return fract(h * 43758.5453 + h.yx);
}
fn vnoise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = hash21(i);
  let b = hash21(i + vec2f(1.0, 0.0));
  let c = hash21(i + vec2f(0.0, 1.0));
  let d = hash21(i + vec2f(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
fn fbm(p0: vec2f, oct: i32) -> f32 {
  var p = p0;
  var a = 0.5;
  var s = 0.0;
  for (var i = 0; i < oct; i++) {
    s += a * vnoise(p);
    p = p * 2.03 + vec2f(13.1, 7.7);
    a *= 0.5;
  }
  return s;
}
// scattered aggregate: distance to the nearest jittered cell point
fn worley(p: vec2f) -> vec2f {
  let n = floor(p);
  let f = p - n;
  var d1 = 8.0;
  var d2 = 8.0;
  var id = 0.0;
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let g = vec2f(f32(i), f32(j));
      let o = hash22(n + g);
      let r = g + o - f;
      let d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; id = hash21(n + g); }
      else if (d < d2) { d2 = d; }
    }
  }
  return vec2f(sqrt(d1), id);
}
fn stripeAA(x: f32, period: f32, duty: f32, w: f32) -> f32 {
  let t = fract(x / period);
  return smoothstep(0.0, w, t) * (1.0 - smoothstep(duty - w, duty, t));
}
`;

export const PBR = /* wgsl */ `
const PI = 3.14159265359;

fn distributionGGX(ndh: f32, rough: f32) -> f32 {
  let a = rough * rough;
  let a2 = a * a;
  let d = ndh * ndh * (a2 - 1.0) + 1.0;
  return a2 / max(PI * d * d, 1e-5);
}
fn geometrySchlick(ndv: f32, ndl: f32, rough: f32) -> f32 {
  let k = (rough + 1.0) * (rough + 1.0) / 8.0;
  let gv = ndv / (ndv * (1.0 - k) + k);
  let gl = ndl / (ndl * (1.0 - k) + k);
  return gv * gl;
}
fn fresnelSchlick(c: f32, f0: vec3f) -> vec3f {
  return f0 + (vec3f(1.0) - f0) * pow(clamp(1.0 - c, 0.0, 1.0), 5.0);
}

fn directLight(N: vec3f, V: vec3f, L: vec3f, albedo: vec3f, rough: f32, metal: f32, radiance: vec3f) -> vec3f {
  let H = normalize(V + L);
  let ndl = max(dot(N, L), 0.0);
  if (ndl <= 0.0) { return vec3f(0.0); }
  let ndv = max(dot(N, V), 1e-4);
  let ndh = max(dot(N, H), 0.0);
  let f0 = mix(vec3f(0.04), albedo, metal);
  let D = distributionGGX(ndh, rough);
  let Gq = geometrySchlick(ndv, ndl, rough);
  let F = fresnelSchlick(max(dot(H, V), 0.0), f0);
  let spec = (D * Gq * F) / max(4.0 * ndv * ndl, 1e-4);
  let kd = (vec3f(1.0) - F) * (1.0 - metal);
  return (kd * albedo / PI + spec) * radiance * ndl;
}

fn ambientLight(N: vec3f, V: vec3f, albedo: vec3f, rough: f32, metal: f32, ao: f32) -> vec3f {
  let up = clamp(N.y * 0.5 + 0.5, 0.0, 1.0);
  let sky = mix(G.horizon.rgb, G.skyColour.rgb, up);
  let bounce = G.horizon.rgb * G.horizon.w * (1.0 - up);
  let irradiance = (sky + bounce) * G.sunColour.w;
  let ndv = max(dot(N, V), 1e-4);
  let f0 = mix(vec3f(0.04), albedo, metal);
  let F = fresnelSchlick(ndv, f0);
  let kd = (vec3f(1.0) - F) * (1.0 - metal);
  // cheap specular horizon term for wet/shiny materials
  let R = reflect(-V, N);
  let specSky = mix(G.horizon.rgb, G.skyColour.rgb, clamp(R.y * 0.5 + 0.5, 0.0, 1.0)) * G.sunColour.w;
  let specOcc = mix(0.2, 1.0, pow(ao, 2.0));
  return (kd * albedo * irradiance + specSky * F * (1.0 - rough * 0.85) * specOcc) * ao;
}

fn punctualLights(P: vec3f, N: vec3f, V: vec3f, albedo: vec3f, rough: f32, metal: f32) -> vec3f {
  var acc = vec3f(0.0);
  let n = i32(G.params.w);
  for (var i = 0; i < n; i++) {
    let lp = LIGHTS[i].posRange;
    let d = lp.xyz - P;
    let dist2 = dot(d, d);
    let range = max(lp.w, 0.01);
    if (dist2 > range * range) { continue; }
    let dist = sqrt(max(dist2, 1e-4));
    let L = d / dist;
    let win = clamp(1.0 - pow(dist / range, 4.0), 0.0, 1.0);
    let atten = win * win / (dist2 + 1.0);
    // lamps throw downwards: soften contribution for surfaces above the source
    let down = clamp(-L.y * 0.5 + 0.9, 0.0, 1.0);
    let radiance = LIGHTS[i].colour.rgb * LIGHTS[i].colour.w * atten * down;
    acc += directLight(N, V, L, albedo, rough, metal, radiance);
  }
  return acc;
}
`;

export const SHADOW = /* wgsl */ `
fn shadowFactor(worldPos: vec3f, ndl: f32) -> f32 {
  let strength = G.flags.w;
  if (strength <= 0.001) { return 1.0; }
  let clip = G.sunViewProj * vec4f(worldPos, 1.0);
  let ndc = clip.xyz / clip.w;
  if (ndc.z <= 0.0 || ndc.z >= 1.0) { return 1.0; }
  var uv = ndc.xy * vec2f(0.5, -0.5) + vec2f(0.5);
  if (uv.x <= 0.002 || uv.x >= 0.998 || uv.y <= 0.002 || uv.y >= 0.998) { return 1.0; }
  let texel = G.params.z;
  let bias = clamp(0.0016 * tan(acos(clamp(ndl, 0.02, 1.0))), 0.0005, 0.006);
  var sum = 0.0;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let o = vec2f(f32(x), f32(y)) * texel;
      sum += textureSampleCompareLevel(shadowTex, shadowSamp, uv + o, ndc.z - bias);
    }
  }
  let s = sum / 9.0;
  return mix(1.0, s, strength);
}

fn applyFog(colour: vec3f, worldPos: vec3f, camPos: vec3f) -> vec3f {
  let d = distance(worldPos, camPos);
  let heightFall = exp(-max(worldPos.y, 0.0) * 0.012);
  let f = 1.0 - exp(-d * G.fog.w * heightFall);
  let sunAmount = pow(max(dot(normalize(worldPos - camPos), G.sunDir.xyz), 0.0), 8.0);
  let fogCol = mix(G.fog.rgb, G.sunColour.rgb, sunAmount * 0.45);
  return mix(colour, fogCol, clamp(f, 0.0, 1.0));
}
`;
