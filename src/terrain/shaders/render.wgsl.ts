import { COMMON } from './common.wgsl';

const RENDER_BINDINGS = /* wgsl */`
struct RenderU {
  viewProj: mat4x4f,
  camPos: vec4f,
  sunDir: vec4f,        // xyz = direction TO the sun, w = intensity
  sunColor: vec4f,
  zenith: vec4f,        // rgb, w = ambient strength
  horizon: vec4f,       // rgb, w = ground bounce
  params: vec4f,        // worldSize, heightScale, simRes, gridN
  params2: vec4f,       // time, shadowSteps, seaLevel, exposure
  flags: vec4f,         // shadingMode, matCount, detailAmount, fogAmount
  mats: array<vec4f, 72>,   // 0..59 = 10 material layers x 6, 64..67 = camera basis for the sky
};
@group(0) @binding(0) var<uniform> R: RenderU;
@group(0) @binding(1) var<storage, read> height: array<f32>;
@group(0) @binding(2) var<storage, read> water: array<f32>;
@group(0) @binding(3) var nrmAoTex: texture_2d<f32>;
@group(0) @binding(4) var maskTex: texture_2d<f32>;
@group(0) @binding(5) var samp: sampler;

fn simRes() -> i32 { return i32(R.params.z); }
fn hIdx(x: i32, y: i32) -> u32 {
  let r = simRes();
  return u32(clamp(y, 0, r - 1) * r + clamp(x, 0, r - 1));
}
/** bilinear height in normalised [0,1] units, uv in [0,1] */
fn heightAt(uv: vec2f) -> f32 {
  let r = f32(simRes());
  let p = clamp(uv, vec2f(0.0), vec2f(1.0)) * (r - 1.0);
  let i0 = vec2i(floor(p));
  let f = fract(p);
  let h00 = height[hIdx(i0.x, i0.y)];
  let h10 = height[hIdx(i0.x + 1, i0.y)];
  let h01 = height[hIdx(i0.x, i0.y + 1)];
  let h11 = height[hIdx(i0.x + 1, i0.y + 1)];
  return mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
}
fn waterAt(uv: vec2f) -> f32 {
  let r = f32(simRes());
  let p = clamp(uv, vec2f(0.0), vec2f(1.0)) * (r - 1.0);
  let i0 = vec2i(floor(p));
  let f = fract(p);
  let w00 = water[hIdx(i0.x, i0.y)];
  let w10 = water[hIdx(i0.x + 1, i0.y)];
  let w01 = water[hIdx(i0.x, i0.y + 1)];
  let w11 = water[hIdx(i0.x + 1, i0.y + 1)];
  return mix(mix(w00, w10, f.x), mix(w01, w11, f.x), f.y);
}
fn gridUV(vid: u32) -> vec2f {
  let g = u32(R.params.w);
  let quads = g - 1u;
  let q = vid / 6u;
  let c = vid % 6u;
  let qx = q % quads;
  let qy = q / quads;
  var ox = 0u; var oy = 0u;
  if (c == 1u) { ox = 1u; }
  else if (c == 2u) { oy = 1u; }
  else if (c == 3u) { oy = 1u; }
  else if (c == 4u) { ox = 1u; }
  else if (c == 5u) { ox = 1u; oy = 1u; }
  return vec2f(f32(qx + ox), f32(qy + oy)) / f32(quads);
}
fn worldFromUV(uv: vec2f, h: f32) -> vec3f {
  return vec3f((uv.x - 0.5) * R.params.x, h * R.params.y, (uv.y - 0.5) * R.params.x);
}

/** soft shadow by marching the heightfield toward the sun */
fn sunShadow(startWorld: vec3f, startUV: vec2f) -> f32 {
  let steps = i32(R.params2.y);
  if (steps <= 0) { return 1.0; }
  let sd = normalize(R.sunDir.xyz);
  if (sd.y <= 0.02) { return 0.0; }
  let ws = R.params.x;
  var shadow = 1.0;
  var t = ws / f32(simRes()) * 2.0;
  for (var s = 0; s < steps; s = s + 1) {
    let p = startWorld + sd * t;
    let uv = vec2f(p.x / ws + 0.5, p.z / ws + 0.5);
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { break; }
    let terrain = heightAt(uv) * R.params.y;
    let diff = terrain - p.y;
    if (diff > 0.0) {
      // penumbra widens with distance from the blocker
      shadow = min(shadow, clamp(1.0 - diff / (t * 0.06 + 0.5), 0.0, 1.0));
      if (shadow < 0.02) { break; }
    }
    t = t * 1.32 + ws / f32(simRes());
    if (t > ws * 1.5) { break; }
  }
  return shadow;
}

fn skyColor(dir: vec3f) -> vec3f {
  let up = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
  let grad = mix(R.horizon.rgb, R.zenith.rgb, pow(up, 0.55));
  let sd = normalize(R.sunDir.xyz);
  let c = max(dot(dir, sd), 0.0);
  let mie = pow(c, 12.0) * 0.6 + pow(c, 420.0) * 8.0;      // glow + disc
  return grad + R.sunColor.rgb * mie * R.sunDir.w * 0.35;
}

fn acesTonemap(x: vec3f) -> vec3f {
  let a = 2.51; let b = 0.03; let c = 2.43; let d = 0.59; let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3f(0.0), vec3f(1.0));
}
`;

/* ------------------------------------------------------------------ */
/* TERRAIN                                                             */
/* ------------------------------------------------------------------ */
export const TERRAIN_SHADER = /* wgsl */`
${RENDER_BINDINGS}
${COMMON}

struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) world: vec3f,
  @location(2) hNorm: f32,
};

@vertex
fn vs(@builtin(vertex_index) vid: u32) -> VSOut {
  let uv = gridUV(vid);
  let h = heightAt(uv);
  let world = worldFromUV(uv, h);
  var o: VSOut;
  o.pos = R.viewProj * vec4f(world, 1.0);
  o.uv = uv;
  o.world = world;
  o.hNorm = h;
  return o;
}

struct Layer {
  albedo: vec3f, rough: f32,
  altLo: f32, altHi: f32, slopeLo: f32, slopeHi: f32,
  soft: f32, wetW: f32, depW: f32, noiseScale: f32,
  noiseAmt: f32, curvW: f32, aoW: f32, strength: f32,
  albedo2: vec3f, detailScale: f32,
  slopeSoft: f32, blendSharp: f32, eroW: f32, sparkle: f32,
};

fn getLayer(i: u32) -> Layer {
  let a = R.mats[i * 6u + 0u];
  let b = R.mats[i * 6u + 1u];
  let c = R.mats[i * 6u + 2u];
  let d = R.mats[i * 6u + 3u];
  let e = R.mats[i * 6u + 4u];
  let f = R.mats[i * 6u + 5u];
  var L: Layer;
  L.albedo = a.rgb; L.rough = a.w;
  L.altLo = b.x; L.altHi = b.y; L.slopeLo = b.z; L.slopeHi = b.w;
  L.soft = c.x; L.wetW = c.y; L.depW = c.z; L.noiseScale = c.w;
  L.noiseAmt = d.x; L.curvW = d.y; L.aoW = d.z; L.strength = d.w;
  L.albedo2 = e.rgb; L.detailScale = e.w;
  L.slopeSoft = f.x; L.blendSharp = f.y; L.eroW = f.z; L.sparkle = f.w;
  return L;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  let na = textureSample(nrmAoTex, samp, in.uv);
  let mk = textureSample(maskTex, samp, in.uv);
  var n = normalize(na.xyz * 2.0 - 1.0);
  let ao = na.w;
  let wet = mk.x;
  let curv = mk.y * 2.0 - 1.0;     // <0 concave, >0 convex
  let dep = mk.z;
  let ero = mk.w;
  let alt = in.hNorm;
  let slope = clamp(1.0 - n.y, 0.0, 1.0);

  // --- micro detail normal (two octaves, scaled in world units) -----
  let detAmt = R.flags.z;
  if (detAmt > 0.001) {
    let wp = in.world.xz;
    let e = 0.75;
    let f0 = fbm(wp * 0.35, 3, 2.1, 0.5, 991u);
    let fx = fbm((wp + vec2f(e, 0.0)) * 0.35, 3, 2.1, 0.5, 991u);
    let fy = fbm((wp + vec2f(0.0, e)) * 0.35, 3, 2.1, 0.5, 991u);
    let bump = vec3f(-(fx - f0), 0.0, -(fy - f0)) * detAmt * 6.0;
    n = normalize(n + bump);
  }

  // --- texture layer stack -----------------------------------------
  var albedo = vec3f(0.22, 0.2, 0.18);
  var rough = 0.9;
  var sparkleAmt = 0.0;
  var wSum = 0.0001;
  let count = u32(R.flags.y);
  for (var i = 0u; i < count; i = i + 1u) {
    let L = getLayer(i);
    if (L.strength <= 0.0) { continue; }
    var w = L.strength;
    w = w * smoothRange(alt, L.altLo, L.altHi, L.soft);
    w = w * smoothRange(slope, L.slopeLo, L.slopeHi, L.slopeSoft);
    // concave gathers (soil, snow drifts), convex sheds (bare rock)
    if (L.curvW > 0.0) { w = w * clamp(0.5 - curv * L.curvW, 0.0, 1.0); }
    if (L.curvW < 0.0) { w = w * clamp(0.5 + curv * (-L.curvW), 0.0, 1.0); }
    w = w * mix(1.0, wet, clamp(L.wetW, 0.0, 1.0)) ;
    w = w * mix(1.0, dep, clamp(L.depW, 0.0, 1.0));
    w = w * mix(1.0, ero, clamp(L.eroW, 0.0, 1.0));
    w = w * mix(1.0, ao, clamp(L.aoW, 0.0, 1.0));
    if (L.noiseAmt > 0.0) {
      let nz = fbm(in.world.xz * L.noiseScale, 4, 2.0, 0.5, 313u + i * 97u) * 0.5 + 0.5;
      w = w * mix(1.0, smoothstep(0.5 - L.noiseAmt, 0.5 + L.noiseAmt, nz), 1.0);
    }
    if (w <= 0.0005) { continue; }
    w = pow(w, max(L.blendSharp, 0.05));
    // two-tone macro variation so no layer reads as flat paint
    let varNz = fbm(in.world.xz * max(L.detailScale, 0.001), 3, 2.3, 0.5, 57u + i * 131u) * 0.5 + 0.5;
    let col = mix(L.albedo, L.albedo2, varNz);
    albedo = albedo * (1.0 - w) + col * w;
    rough = rough * (1.0 - w) + L.rough * w;
    sparkleAmt = sparkleAmt * (1.0 - w) + L.sparkle * w;
    wSum = wSum + w;
  }

  // wet rock darkens and polishes (real, and it sells rivers)
  let wetness = clamp(wet * 1.2, 0.0, 1.0);
  albedo = albedo * mix(1.0, 0.55, wetness);
  rough = mix(rough, 0.12, wetness * 0.85);

  // --- debug / analysis views ---------------------------------------
  let mode = i32(R.flags.x);
  if (mode == 1) { albedo = vec3f(alt); }
  else if (mode == 2) { albedo = mix(vec3f(0.05, 0.3, 0.1), vec3f(0.9, 0.2, 0.1), slope); }
  else if (mode == 3) { albedo = mix(vec3f(0.1), vec3f(0.2, 0.5, 1.0), wet); }
  else if (mode == 4) { albedo = vec3f(ao); }
  else if (mode == 5) { albedo = mix(vec3f(0.9, 0.5, 0.2), vec3f(0.2, 0.4, 0.9), clamp(ero, 0.0, 1.0)); }
  else if (mode == 6) { albedo = mix(vec3f(0.1), vec3f(0.95, 0.85, 0.5), dep); }

  // --- lighting ------------------------------------------------------
  let sd = normalize(R.sunDir.xyz);
  let v = normalize(R.camPos.xyz - in.world);
  let ndl = max(dot(n, sd), 0.0);
  var shadow = 1.0;
  if (mode == 0 || mode > 6) { shadow = sunShadow(in.world, in.uv); }
  let sun = R.sunColor.rgb * R.sunDir.w * ndl * shadow;

  // sky dome ambient weighted by how much sky the normal sees, x AO
  let skyAmb = mix(R.horizon.rgb, R.zenith.rgb, clamp(n.y * 0.5 + 0.5, 0.0, 1.0)) * R.zenith.w * ao;
  let bounce = R.horizon.rgb * R.horizon.w * clamp(-n.y * 0.5 + 0.5, 0.0, 1.0) * ao;

  var color = albedo * (sun + skyAmb + bounce);

  // GGX-ish specular, strongest on wet rock and snow
  let h = normalize(sd + v);
  let a = max(rough * rough, 0.004);
  let ndh = max(dot(n, h), 0.0);
  let d = a * a / (3.14159 * pow(ndh * ndh * (a * a - 1.0) + 1.0, 2.0));
  let fres = 0.04 + 0.96 * pow(1.0 - max(dot(h, v), 0.0), 5.0);
  color = color + R.sunColor.rgb * R.sunDir.w * d * fres * shadow * ndl;

  if (sparkleAmt > 0.0) {
    let g = fbm(in.world.xz * 90.0, 2, 2.0, 0.5, 7771u);
    let glint = pow(clamp(g, 0.0, 1.0), 14.0) * sparkleAmt * ndl * shadow;
    color = color + vec3f(glint) * 3.0;
  }

  // --- aerial perspective -------------------------------------------
  let dist = length(R.camPos.xyz - in.world);
  let fogAmt = 1.0 - exp(-dist * R.flags.w * 0.0008);
  let fogCol = skyColor(normalize(in.world - R.camPos.xyz));
  color = mix(color, fogCol, clamp(fogAmt, 0.0, 1.0));

  color = acesTonemap(color * R.params2.w);
  return vec4f(pow(color, vec3f(1.0 / 2.2)), 1.0);
}
`;

/* ------------------------------------------------------------------ */
/* WATER                                                               */
/* ------------------------------------------------------------------ */
export const WATER_SHADER = /* wgsl */`
${RENDER_BINDINGS}
${COMMON}

struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) world: vec3f,
  @location(2) depth: f32,
};

fn surfaceAt(uv: vec2f) -> f32 {
  let terrain = heightAt(uv);
  let sea = R.params2.z;
  return max(terrain + waterAt(uv), sea);
}

@vertex
fn vs(@builtin(vertex_index) vid: u32) -> VSOut {
  let uv = gridUV(vid);
  let terrain = heightAt(uv);
  let surf = surfaceAt(uv);
  let d = surf - terrain;
  var o: VSOut;
  o.uv = uv;
  o.depth = d;
  let world = worldFromUV(uv, surf);
  o.world = world;
  o.pos = R.viewProj * vec4f(world, 1.0);
  if (d < 0.0008) { o.pos = vec4f(0.0, 0.0, 2.0, 1.0); }   // cull dry cells
  return o;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  if (in.depth < 0.0008) { discard; }
  let ws = R.params.x;
  let e = 1.0 / f32(simRes());
  let sx = surfaceAt(in.uv + vec2f(e, 0.0)) - surfaceAt(in.uv - vec2f(e, 0.0));
  let sy = surfaceAt(in.uv + vec2f(0.0, e)) - surfaceAt(in.uv - vec2f(0.0, e));
  let cell = ws * 2.0 * e;
  var n = normalize(vec3f(-sx * R.params.y, cell, -sy * R.params.y));

  // capillary ripples
  let t = R.params2.x;
  let wp = in.world.xz;
  let r1 = fbm(wp * 1.3 + vec2f(t * 0.35, t * 0.21), 3, 2.2, 0.5, 191u);
  let r2 = fbm(wp * 2.7 - vec2f(t * 0.23, t * 0.31), 2, 2.0, 0.5, 337u);
  let ripple = vec3f(r1 - r2, 0.0, r2 - r1) * clamp(0.6 - in.depth * 8.0, 0.0, 0.6);
  n = normalize(n + ripple);

  let v = normalize(R.camPos.xyz - in.world);
  let sd = normalize(R.sunDir.xyz);
  let fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
  let refl = skyColor(reflect(-v, n));

  // Beer-Lambert absorption through the column
  let depthM = in.depth * R.params.y;
  let absorb = exp(-depthM * vec3f(0.9, 0.35, 0.18) * 1.6);
  let bed = vec3f(0.14, 0.17, 0.15) * absorb;
  let shallow = clamp(1.0 - depthM * 1.5, 0.0, 1.0);

  var color = mix(bed, refl, clamp(fres + 0.08, 0.0, 1.0));
  let h = normalize(sd + v);
  let spec = pow(max(dot(n, h), 0.0), 900.0) * 4.0;
  color = color + R.sunColor.rgb * R.sunDir.w * spec * sunShadow(in.world, in.uv);
  // whitewater where the sheet is thin and fast over steep ground
  color = color + vec3f(0.85, 0.9, 0.95) * shallow * 0.12;

  let dist = length(R.camPos.xyz - in.world);
  let fogAmt = 1.0 - exp(-dist * R.flags.w * 0.0008);
  color = mix(color, skyColor(normalize(in.world - R.camPos.xyz)), clamp(fogAmt, 0.0, 1.0));
  color = acesTonemap(color * R.params2.w);
  let alpha = clamp(0.35 + fres * 0.5 + depthM * 2.0, 0.35, 0.97);
  return vec4f(pow(color, vec3f(1.0 / 2.2)), alpha);
}
`;

/* ------------------------------------------------------------------ */
/* SKY (full-screen)                                                   */
/* ------------------------------------------------------------------ */
export const SKY_SHADER = /* wgsl */`
${RENDER_BINDINGS}
struct VSOut { @builtin(position) pos: vec4f, @location(0) ndc: vec2f };
@vertex
fn vs(@builtin(vertex_index) vid: u32) -> VSOut {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: VSOut;
  o.ndc = p[vid];
  o.pos = vec4f(p[vid], 1.0, 1.0);
  return o;
}
@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  // reconstruct a view ray from the inverse of viewProj is overkill here:
  // the CPU hands us the basis in camPos.w-packed uniforms instead.
  let fwd = normalize(R.mats[64].xyz);
  let right = normalize(R.mats[65].xyz);
  let up = normalize(R.mats[66].xyz);
  let tanHalf = R.mats[67].x;
  let dir = normalize(fwd + right * in.ndc.x * tanHalf * R.mats[67].y + up * in.ndc.y * tanHalf);
  var col = skyColor(dir);
  col = acesTonemap(col * R.params2.w);
  return vec4f(pow(col, vec3f(1.0 / 2.2)), 1.0);
}
`;
