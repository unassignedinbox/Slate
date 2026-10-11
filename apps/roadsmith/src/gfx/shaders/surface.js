// The main material shader: one pipeline, 50 procedural surface families driven by vertex ids.

import { STRUCTS, BINDINGS, NOISE, PBR, SHADOW } from './common.js';

export const SURFACE_WGSL = /* wgsl */ `
${STRUCTS}
${BINDINGS}
${NOISE}
${PBR}
${SHADOW}

// ---------------------------------------------------------------- surface id -> procedural family
// 0 asphalt · 1 concrete · 2 paving · 3 grass · 4 aggregate · 5 metal
// 6 paint/plastic · 7 glass · 8 emissive · 9 rubber · 10 tactile · 11 water
var<private> FAMILY: array<u32, 50> = array<u32, 50>(
  0u, 0u, 0u, 1u, 1u, 2u, 3u, 1u, 0u, 1u,
  1u, 4u, 5u, 1u, 10u, 4u, 11u, 7u, 9u, 6u,
  2u, 2u, 3u, 5u, 8u, 8u, 8u, 6u, 6u, 6u,
  6u, 6u, 6u, 6u, 6u, 7u, 9u, 5u, 8u, 8u,
  5u, 1u, 4u, 6u, 5u, 2u, 6u, 4u, 4u, 1u,
);

struct VSIn {
  @location(0) pos   : vec3f,
  @location(1) nrm   : vec3f,
  @location(2) tan   : vec3f,
  @location(3) uv    : vec2f,
  @location(4) attrA : vec4f,   // surface, wear, ao, flagsPacked
  @location(5) attrB : vec4f,   // laneWidth, laneA, laneB, param
};

struct VSOut {
  @builtin(position) clip : vec4f,
  @location(0) wpos  : vec3f,
  @location(1) nrm   : vec3f,
  @location(2) tan   : vec3f,
  @location(3) uv    : vec2f,
  @location(4) wap   : vec4f,            // wear, ao, param, laneWidth
  @location(5) @interpolate(flat) ids : vec2u,
  @location(6) laneAB: vec2f,
  @location(7) inst  : vec4f,            // instance tint (rgb) + variant (a)
};

struct InstIn {
  @location(6) posYaw : vec4f,  // xyz world, w yaw
  @location(7) tint   : vec4f,  // rgb paint, w variant
  @location(8) extra  : vec4f,  // x spin about local X, y scale, z lift about local Z, w emissive
};

// local axes: +X forward, +Y up, +Z left.  extra.z rotates about Z (wheel spin, vehicle pitch,
// boom lift), extra.x rotates about X (body roll), posYaw.w yaws +X onto the heading.
fn instanceRotate(p: vec3f, inst: InstIn) -> vec3f {
  var q = p;
  let cz = cos(inst.extra.z); let sz = sin(inst.extra.z);
  q = vec3f(q.x * cz - q.y * sz, q.x * sz + q.y * cz, q.z);
  let cx = cos(inst.extra.x); let sx = sin(inst.extra.x);
  q = vec3f(q.x, q.y * cx - q.z * sx, q.y * sx + q.z * cx);
  let c = cos(inst.posYaw.w); let s = sin(inst.posYaw.w);
  return vec3f(q.x * c - q.z * s, q.y, q.x * s + q.z * c);
}

fn instanceTransform(p: vec3f, inst: InstIn) -> vec3f {
  return instanceRotate(p * max(inst.extra.y, 0.0001), inst);
}

fn instanceDirection(p: vec3f, inst: InstIn) -> vec3f {
  return instanceRotate(p, inst);
}

@vertex
fn vs_static(v: VSIn) -> VSOut {
  var o: VSOut;
  o.clip = G.viewProj * vec4f(v.pos, 1.0);
  o.wpos = v.pos;
  o.nrm = v.nrm;
  o.tan = v.tan;
  o.uv = v.uv;
  o.wap = vec4f(v.attrA.y, v.attrA.z, v.attrB.w, v.attrB.x);
  o.ids = vec2u(u32(v.attrA.x + 0.5), u32(max(v.attrA.w, 0.0) + 0.5));
  o.laneAB = v.attrB.yz;
  o.inst = vec4f(1.0, 1.0, 1.0, 0.0);
  return o;
}

@vertex
fn vs_instanced(v: VSIn, inst: InstIn) -> VSOut {
  var o: VSOut;
  let rn = instanceDirection(v.nrm, inst);
  let rt = instanceDirection(v.tan, inst);
  let wp = instanceTransform(v.pos, inst) + inst.posYaw.xyz;
  o.clip = G.viewProj * vec4f(wp, 1.0);
  o.wpos = wp;
  o.nrm = rn;
  o.tan = rt;
  o.uv = v.uv;
  o.wap = vec4f(v.attrA.y, v.attrA.z, v.attrB.w, v.attrB.x);
  o.ids = vec2u(u32(v.attrA.x + 0.5), u32(max(v.attrA.w, 0.0) + 0.5));
  o.laneAB = v.attrB.yz;
  o.inst = vec4f(inst.tint.rgb, inst.extra.w);
  return o;
}

// ---------------------------------------------------------------- material helpers
struct Surf {
  albedo : vec3f,
  rough  : f32,
  metal  : f32,
  height : f32,
  emissive: vec3f,
};

fn asphaltSurf(uv: vec2f, wear: f32, scale: f32, detail: f32) -> Surf {
  var s: Surf;
  let p = uv * scale;
  let agg = worley(p * 7.0);
  let fine = fbm(p * 26.0, 3);
  let coarse = fbm(p * 1.4, 4);
  // polished wheel paths lighten and smooth the bitumen, grime darkens it
  let polish = clamp(wear, 0.0, 1.0);
  var base = mix(0.052, 0.098, coarse) + agg.x * 0.045 * (1.0 - polish * 0.6);
  base += (fine - 0.5) * 0.02 * detail;
  base = mix(base, base * 1.26 + 0.012, polish * 0.75);
  let tint = vec3f(1.0, 0.985, 0.962);
  s.albedo = vec3f(base) * tint;
  s.rough = clamp(0.94 - polish * 0.30 - agg.x * 0.05, 0.42, 0.98);
  s.metal = 0.0;
  s.height = (agg.x - 0.5) * 0.0024 + (fine - 0.5) * 0.0012;
  s.emissive = vec3f(0.0);
  return s;
}

fn concreteSurf(uv: vec2f, wear: f32, scale: f32, detail: f32) -> Surf {
  var s: Surf;
  let p = uv * scale;
  let broom = sin(p.y * 128.0 + fbm(p * 5.0, 2) * 6.0) * 0.5 + 0.5;
  let blot = fbm(p * 2.2, 4);
  let grit = worley(p * 22.0).x;
  var v = 0.46 + blot * 0.17 + broom * 0.018 * detail - grit * 0.03;
  v -= wear * 0.14 * (0.4 + blot * 0.6);
  // expansion joints every 2.4 m
  let joint = 1.0 - stripeAA(uv.x + 0.06, 2.4, 0.045, 0.012);
  v -= joint * 0.1;
  s.albedo = vec3f(v) * vec3f(0.99, 0.985, 0.97);
  s.rough = clamp(0.88 - wear * 0.1 + grit * 0.05, 0.4, 1.0);
  s.metal = 0.0;
  s.height = -joint * 0.004 + (grit - 0.5) * 0.001 + (broom - 0.5) * 0.0006 * detail;
  s.emissive = vec3f(0.0);
  return s;
}

// paving patterns: returns (mortar mask, cell id, local uv)
fn pavingCell(uv: vec2f, pattern: f32) -> vec3f {
  let pid = i32(pattern + 0.5);
  var cell = vec2f(0.0);
  var local = vec2f(0.0);
  var id = 0.0;
  if (pid == 1) {                       // running bond brick
    let row = floor(uv.y / 0.14);
    let off = select(0.0, 0.11, (row % 2.0) == 0.0);
    cell = vec2f(floor((uv.x + off) / 0.22), row);
    local = vec2f(fract((uv.x + off) / 0.22), fract(uv.y / 0.14));
  } else if (pid == 2) {                // herringbone
    let a = floor(uv / 0.26);
    let f = fract(uv / 0.26);
    let flip = (a.x + a.y) % 2.0;
    if (flip == 0.0) { local = vec2f(fract(f.x * 1.0), fract(f.y * 2.0)); }
    else { local = vec2f(fract(f.x * 2.0), fract(f.y * 1.0)); }
    cell = a;
  } else if (pid == 3) {                // basketweave
    let a = floor(uv / 0.44);
    let f = fract(uv / 0.44);
    let flip = (a.x + a.y) % 2.0;
    if (flip == 0.0) { local = vec2f(f.x, fract(f.y * 2.0)); }
    else { local = vec2f(fract(f.x * 2.0), f.y); }
    cell = a;
  } else if (pid == 4) {                // hexagonal setts
    let r = vec2f(0.34, 0.2);
    let h = r * 0.5;
    let a = (uv % r) - h;
    let b = ((uv + h) % r) - h;
    if (dot(a, a) < dot(b, b)) { local = a / r + 0.5; cell = floor(uv / r); }
    else { local = b / r + 0.5; cell = floor((uv + h) / r) + 0.5; }
  } else if (pid == 5) {                // cobble setts (irregular)
    let w = worley(uv / 0.16);
    local = vec2f(w.x, w.x);
    cell = vec2f(w.y * 91.0, w.y * 37.0);
    id = w.y;
    return vec3f(smoothstep(0.26, 0.46, w.x), w.y, w.x);
  } else if (pid == 6) {                // large flagstones, staggered
    let row = floor(uv.y / 0.6);
    let off = fract(row * 0.37) * 0.4;
    cell = vec2f(floor((uv.x + off) / 0.9), row);
    local = vec2f(fract((uv.x + off) / 0.9), fract(uv.y / 0.6));
  } else {                              // 0: square slabs
    cell = floor(uv / 0.45);
    local = fract(uv / 0.45);
  }
  id = hash21(cell + 0.5);
  let e = min(min(local.x, 1.0 - local.x), min(local.y, 1.0 - local.y));
  let mortar = smoothstep(0.0, 0.055, e);
  return vec3f(mortar, id, e);
}

fn pavingSurf(uv: vec2f, wear: f32, scale: f32, detail: f32, pattern: f32, base: vec3f) -> Surf {
  var s: Surf;
  let p = uv * scale;
  let c = pavingCell(p, pattern);
  let mortar = c.x;
  let id = c.y;
  let grain = fbm(p * 30.0, 3);
  let stain = fbm(p * 1.1, 4);
  var col = base * (0.84 + id * 0.3);
  col *= 0.9 + grain * 0.18 * detail;
  col = mix(col * 0.62, col, mortar);
  col *= 1.0 - wear * 0.22 * (0.4 + stain * 0.8);
  s.albedo = col;
  s.rough = clamp(0.82 + (1.0 - mortar) * 0.12 - id * 0.06, 0.35, 1.0);
  s.metal = 0.0;
  s.height = (mortar - 1.0) * 0.006 + (grain - 0.5) * 0.0015 * detail + id * 0.0012;
  s.emissive = vec3f(0.0);
  return s;
}

fn grassSurf(uv: vec2f, wear: f32, scale: f32, detail: f32) -> Surf {
  var s: Surf;
  let p = uv * scale;
  let clump = fbm(p * 3.1, 4);
  let blade = worley(p * 38.0);
  let dry = fbm(p * 0.6, 3);
  let green = mix(vec3f(0.055, 0.112, 0.040), vec3f(0.115, 0.182, 0.064), clump);
  let straw = vec3f(0.168, 0.158, 0.082);
  var col = mix(green, straw, clamp(dry * 0.75 + wear * 0.35, 0.0, 1.0));
  col *= 0.82 + blade.y * 0.4 * detail;
  s.albedo = col;
  s.rough = 0.97;
  s.metal = 0.0;
  s.height = (clump - 0.5) * 0.02 + (blade.x - 0.5) * 0.01;
  s.emissive = vec3f(0.0);
  return s;
}

fn aggregateSurf(uv: vec2f, wear: f32, scale: f32, detail: f32, base: vec3f) -> Surf {
  var s: Surf;
  let p = uv * scale;
  let st = worley(p * 13.0);
  let st2 = worley(p * 31.0);
  let dust = fbm(p * 2.0, 4);
  var col = base * (0.66 + st.y * 0.62);
  col *= 0.86 + dust * 0.3;
  col = mix(col, base * 0.72, smoothstep(0.1, 0.0, st.x));
  col *= 1.0 - wear * 0.18;
  s.albedo = col * (0.9 + st2.y * 0.2 * detail);
  s.rough = 0.96;
  s.metal = 0.0;
  s.height = (0.5 - st.x) * 0.012 + (0.5 - st2.x) * 0.004;
  s.emissive = vec3f(0.0);
  return s;
}

fn metalSurf(uv: vec2f, wear: f32, scale: f32, detail: f32, base: vec3f, rough0: f32) -> Surf {
  var s: Surf;
  let p = uv * scale;
  let brush = fbm(vec2f(p.x * 90.0, p.y * 2.0), 3);
  let rust = smoothstep(0.52, 0.86, fbm(p * 2.6, 4) + wear * 0.45);
  let rustCol = vec3f(0.168, 0.072, 0.030) * (0.7 + fbm(p * 9.0, 3) * 0.7);
  var col = base * (0.88 + brush * 0.24 * detail);
  col = mix(col, rustCol, rust);
  s.albedo = col;
  s.rough = clamp(mix(rough0, 0.92, rust) + (brush - 0.5) * 0.08, 0.08, 1.0);
  s.metal = mix(1.0, 0.1, rust);
  s.height = (brush - 0.5) * 0.0008 - rust * 0.0015;
  s.emissive = vec3f(0.0);
  return s;
}

fn paintSurf(uv: vec2f, wear: f32, scale: f32, base: vec3f, rough0: f32) -> Surf {
  var s: Surf;
  let p = uv * scale;
  let orange = fbm(p * 42.0, 3);
  let scuff = smoothstep(0.55, 0.95, fbm(p * 7.0, 4) + wear * 0.4);
  s.albedo = mix(base, base * 0.68, scuff) * (0.96 + orange * 0.08);
  s.rough = clamp(rough0 + scuff * 0.22 + (orange - 0.5) * 0.05, 0.05, 1.0);
  s.metal = 0.0;
  s.height = (orange - 0.5) * 0.0004;
  s.emissive = vec3f(0.0);
  return s;
}

fn glassSurf(base: vec3f) -> Surf {
  var s: Surf;
  s.albedo = base * 0.1;
  s.rough = 0.045;
  s.metal = 0.0;
  s.height = 0.0;
  s.emissive = vec3f(0.0);
  return s;
}

fn rubberSurf(uv: vec2f, scale: f32) -> Surf {
  var s: Surf;
  let p = uv * scale;
  let tread = stripeAA(p.x * 0.5 + sin(p.y * 7.0) * 0.08, 0.06, 0.55, 0.08);
  s.albedo = vec3f(0.028, 0.028, 0.031) * (0.8 + tread * 0.5);
  s.rough = 0.92 - tread * 0.08;
  s.metal = 0.0;
  s.height = tread * 0.003;
  s.emissive = vec3f(0.0);
  return s;
}

fn tactileSurf(uv: vec2f, scale: f32, base: vec3f) -> Surf {
  var s: Surf;
  let p = uv * scale;
  let g = fract(p / 0.065) - 0.5;
  let d = length(g) * 0.065;
  let blister = smoothstep(0.021, 0.014, d);
  s.albedo = mix(base * 0.92, base * 1.1, blister);
  s.rough = 0.86;
  s.metal = 0.0;
  s.height = blister * 0.005;
  s.emissive = vec3f(0.0);
  return s;
}

fn waterSurf(uv: vec2f, t: f32) -> Surf {
  var s: Surf;
  let p = uv * 0.6;
  let r = fbm(p * 3.0 + vec2f(t * 0.05, t * 0.03), 4);
  s.albedo = vec3f(0.018, 0.030, 0.038);
  s.rough = 0.06 + r * 0.05;
  s.metal = 0.0;
  s.height = (r - 0.5) * 0.01;
  s.emissive = vec3f(0.0);
  return s;
}

// ---------------------------------------------------------------- road markings
struct Paint { mask: f32, colour: vec3f, raised: f32 };

// ---------------------------------------------------------------- traffic sign faces
// 4x6 stencil font, row 0 at the top, packed 4 bits per row.  0-9 then S T O P.
fn glyphRows(g: u32) -> u32 {
  switch (g) {
    case 0u:  { return 0x699996u; }
    case 1u:  { return 0x262227u; }
    case 2u:  { return 0x69124Fu; }
    case 3u:  { return 0xE16196u; }
    case 4u:  { return 0x26AF22u; }
    case 5u:  { return 0xF8E196u; }
    case 6u:  { return 0x68E996u; }
    case 7u:  { return 0xF12444u; }
    case 8u:  { return 0x696996u; }
    case 9u:  { return 0x699716u; }
    case 10u: { return 0x786116u; }   // S
    case 11u: { return 0xF44444u; }   // T
    case 12u: { return 0x699996u; }   // O
    case 13u: { return 0xE99E88u; }   // P
    default:  { return 0u; }
  }
}
/** 1 inside the glyph ink.  p is in [0,1]^2 with y measured downward. */
fn glyphInk(g: u32, p: vec2f) -> f32 {
  if (p.x < 0.0 || p.x >= 1.0 || p.y < 0.0 || p.y >= 1.0) { return 0.0; }
  let cx = u32(clamp(p.x, 0.0, 0.999) * 4.0);
  let cy = u32(clamp(p.y, 0.0, 0.999) * 6.0);
  let row = (glyphRows(g) >> ((5u - cy) * 4u)) & 15u;
  return f32((row >> (3u - cx)) & 1u);
}
/** Centred string of digits for value v (1-3 digits), em box half-size h, 4x supersampled. */
fn digitsInk(v: u32, uv: vec2f, h: vec2f, e: vec2f) -> f32 {
  var n = 1u;
  if (v >= 10u) { n = 2u; }
  if (v >= 100u) { n = 3u; }
  let adv = h.x * 2.0 / f32(n);
  var ink = 0.0;
  for (var k = 0u; k < 4u; k = k + 1u) {
    let o = vec2f(select(-e.x, e.x, (k & 1u) == 0u), select(-e.y, e.y, (k & 2u) == 0u)) * 0.3;
    let q = uv + o;
    let col = floor((q.x + h.x) / adv);
    if (col < 0.0 || col >= f32(n) || abs(q.y) > h.y) { continue; }
    var d = v;
    let place = n - 1u - u32(col);
    for (var j = 0u; j < place; j = j + 1u) { d = d / 10u; }
    let lp = vec2f(((q.x + h.x) - col * adv) / (adv * 0.86) - 0.08, (h.y - q.y) / (h.y * 2.0));
    ink = ink + glyphInk(d % 10u, lp) * 0.25;
  }
  return ink;
}
fn lettersInk(uv: vec2f, h: vec2f, e: vec2f) -> f32 {
  // the four glyphs of STOP, codes 10..13
  let adv = h.x * 2.0 / 4.0;
  var ink = 0.0;
  for (var k = 0u; k < 4u; k = k + 1u) {
    let o = vec2f(select(-e.x, e.x, (k & 1u) == 0u), select(-e.y, e.y, (k & 2u) == 0u)) * 0.3;
    let q = uv + o;
    let col = floor((q.x + h.x) / adv);
    if (col < 0.0 || col >= 4.0 || abs(q.y) > h.y) { continue; }
    let lp = vec2f(((q.x + h.x) - col * adv) / (adv * 0.88) - 0.06, (h.y - q.y) / (h.y * 2.0));
    ink = ink + glyphInk(10u + u32(col), lp) * 0.25;
  }
  return ink;
}
fn ringAA(d: f32, r: f32, w: f32) -> f32 { return 1.0 - smoothstep(r - w, r + w, d); }

/** Vector artwork for one sign face.  uv is [-1,1] over the plate, variant selects the legend. */
fn signSurf(sid: u32, uv: vec2f, variant: f32, duv: vec2f) -> Surf {
  var s: Surf;
  s.rough = 0.38;
  s.metal = 0.0;
  s.height = 0.0;
  s.emissive = vec3f(0.0);
  let white = vec3f(0.84, 0.845, 0.83);
  let red   = vec3f(0.44, 0.035, 0.045);
  let blue  = vec3f(0.022, 0.09, 0.30);
  let black = vec3f(0.035, 0.035, 0.038);
  let green = vec3f(0.015, 0.16, 0.10);
  let yellow= vec3f(0.62, 0.44, 0.02);
  let e = duv * 0.5;
  let w = max(length(duv), 2.0e-4) * 1.1;
  let r = length(uv);
  var col = white;
  if (sid == 27u) {                                  // speed limit roundel
    col = mix(white, red, ringAA(r, 0.995, w) * (1.0 - ringAA(r, 0.76, w)));
    let v = u32(max(variant, 10.0));
    col = mix(col, black, digitsInk(v, uv, vec2f(0.44, 0.40), e));
  } else if (sid == 28u) {                           // STOP octagon
    col = red;
    let oct = max(max(abs(uv.x), abs(uv.y)), (abs(uv.x) + abs(uv.y)) * 0.7071);
    col = mix(col, white, (1.0 - ringAA(oct, 0.86, w)) * ringAA(oct, 0.97, w));
    col = mix(col, white, lettersInk(uv, vec2f(0.66, 0.26), e));
  } else if (sid == 29u) {                           // give way triangle
    // inverted triangle: distance to the three edges, border band in red
    let a = uv.y * 0.5 + 0.5;
    let e0 = -uv.y;
    let e1 = (uv.y * 0.5 + uv.x * 0.866) ;
    let e2 = (uv.y * 0.5 - uv.x * 0.866) ;
    let d = min(min(0.86 - e0, 0.5 - e1), 0.5 - e2);
    col = mix(red, white, smoothstep(0.0, 0.1, d - 0.18));
  } else {                                           // information plates
    let k = u32(variant + 0.5);
    if (k == 1u) {                                   // priority road diamond
      let dm = abs(uv.x) + abs(uv.y);
      col = mix(yellow, white, 1.0 - smoothstep(0.62, 0.72, dm));
      col = mix(col, black, (1.0 - smoothstep(0.86, 0.96, dm)) * smoothstep(0.76, 0.86, dm));
    } else if (k == 2u) {                            // no entry
      col = mix(red, white, (1.0 - smoothstep(0.17, 0.21, abs(uv.y))) * (1.0 - smoothstep(0.56, 0.62, abs(uv.x))));
    } else if (k == 3u) {                            // pedestrian crossing warning
      col = blue;
      let inTri = step(abs(uv.x) * 1.25, 0.86 - uv.y * 0.9) * step(-0.82, uv.y);
      col = mix(col, white, inTri);
      // zebra under the walking figure
      let bars = step(0.5, fract(uv.x * 4.0)) * step(abs(uv.y + 0.42), 0.12) * inTri;
      col = mix(col, black, bars);
      let body = step(length((uv - vec2f(0.02, 0.18)) * vec2f(2.6, 1.5)), 0.42) * inTri;
      col = mix(col, black, body);
    } else if (k == 4u) {                            // direction plate
      col = green;
      col = mix(col, white, (1.0 - smoothstep(0.90, 0.96, max(abs(uv.x), abs(uv.y)))) * smoothstep(0.84, 0.90, max(abs(uv.x), abs(uv.y))));
      let bar = step(abs(uv.y + 0.0), 0.12) * step(abs(uv.x), 0.62);
      col = mix(col, white, bar * 0.9);
    } else if (k == 7u) {                            // St Andrew's cross arm
      col = white;
      col = mix(col, red, smoothstep(0.56, 0.68, abs(uv.x)));
    } else if (k == 6u) {                            // roadworks lane-closure board
      let amber = vec3f(0.60, 0.33, 0.01);
      col = amber;
      let edge = max(abs(uv.x) - 0.06, abs(uv.y));
      col = mix(col, white, smoothstep(0.84, 0.92, edge));
      // black chevrons pointing the way past the works
      let ch = fract((uv.x * 1.6 - abs(uv.y) * 1.1) * 2.0);
      col = mix(col, black, step(0.5, ch) * step(abs(uv.y), 0.66) * step(abs(uv.x), 0.84));
    } else if (k == 5u) {                            // street name plate
      col = white;
      let edge = max(abs(uv.x), abs(uv.y));
      col = mix(col, blue, 1.0 - smoothstep(0.86, 0.94, edge));
      let text = step(0.35, fract(uv.x * 7.0)) * step(abs(uv.y), 0.34) * step(abs(uv.x), 0.72);
      col = mix(col, white, text);
    } else {                                         // parking P
      col = blue;
      let edge = max(abs(uv.x), abs(uv.y));
      col = mix(col, white, smoothstep(0.80, 0.88, edge));
      var ink = 0.0;
      for (var q = 0u; q < 4u; q = q + 1u) {
        let o = vec2f(select(-e.x, e.x, (q & 1u) == 0u), select(-e.y, e.y, (q & 2u) == 0u)) * 0.3;
        let pp = uv + o;
        ink = ink + glyphInk(13u, vec2f(pp.x / 0.9 + 0.5, 0.5 - pp.y / 1.2)) * 0.25;
      }
      col = mix(col, white, ink);
    }
  }
  s.albedo = col;
  // retroreflective sheeting picks up headlights at night
  s.emissive = col * 0.12 * G.flags.z;
  return s;
}

fn signalColour(group: f32, lens: f32) -> vec3f {
  let gi = clamp(i32(group + 0.5), 0, 23);
  let st = SIGNALS[gi];
  let li = i32(lens + 0.5);
  var on = 0.0;
  if (li == 0) { on = st.x; } else if (li == 1) { on = st.y; } else if (li == 2) { on = st.z; } else { on = st.w; }
  var base = vec3f(0.42, 0.045, 0.030);
  if (li == 1) { base = vec3f(0.5, 0.26, 0.03); }
  if (li == 2) { base = vec3f(0.06, 0.42, 0.14); }
  if (li == 3) { base = vec3f(0.5, 0.5, 0.46); }
  return base * (0.055 + on * 10.0);
}

fn arrowMask(q: vec2f, kind: f32) -> f32 {
  // q in metres, centred on the lane, +x = direction of travel
  var p = q;
  if (kind > 1.5) { p.y = -p.y; }                 // mirror for left turns
  var m = 0.0;
  // shaft
  let shaft = step(abs(p.y), 0.14) * step(-1.6, p.x) * step(p.x, 0.9);
  // head
  let hx = p.x - 1.55;
  let head = step(abs(p.y), max(0.0, 0.42 - abs(hx) * 1.1)) * step(abs(hx), 0.38);
  m = max(shaft, head);
  if (kind > 0.5) {                               // turn barb
    let bx = p.x - 0.55;
    let barb = step(abs(p.y - clamp(bx * 1.0, 0.0, 0.8)), 0.12) * step(0.0, bx) * step(bx, 0.85);
    let tipx = p.x - 1.35;
    let tip = step(abs(p.y - 0.8), max(0.0, 0.34 - abs(tipx) * 1.0)) * step(abs(tipx), 0.32);
    m = max(max(m * step(p.x, 1.25), barb), tip);
  }
  return m;
}

fn roadPaint(uv: vec2f, laneAB: vec2f, laneWidth: f32, flags: u32, mark: u32, param: f32, wear: f32) -> Paint {
  var out: Paint;
  out.mask = 0.0;
  out.colour = MATS[46].albedo.rgb;
  out.raised = 0.0;
  if (G.flags.y < 0.5) { return out; }
  let s = uv.x;
  let t = uv.y;
  let laneA = laneAB.x;
  let laneB = laneAB.y;
  if (laneB - laneA < 0.5) { return out; }
  let yellow = MATS[46].p1.w > 0.5;
  let oneway = (flags & 4u) != 0u;
  let centreDouble = (flags & 8u) != 0u;
  let aa = 0.035;
  var m = 0.0;
  var col = out.colour;

  // edge lines
  let eL = 1.0 - smoothstep(0.055, 0.055 + aa, abs(t - (laneA + 0.1)));
  let eR = 1.0 - smoothstep(0.055, 0.055 + aa, abs(t - (laneB - 0.1)));
  m = max(m, max(eL, eR));

  // lane dividers
  let n = max(1.0, round((laneB - laneA) / max(laneWidth, 1.0)));
  let k = round((t - laneA) / max(laneWidth, 1.0));
  if (k > 0.5 && k < n - 0.5) {
    let tk = laneA + k * laneWidth;
    let line = 1.0 - smoothstep(0.055, 0.055 + aa, abs(t - tk));
    let isCentre = abs(tk) < 0.35 && !oneway;
    if (isCentre && centreDouble) {
      let d1 = 1.0 - smoothstep(0.05, 0.05 + aa, abs(t - tk - 0.09));
      let d2 = 1.0 - smoothstep(0.05, 0.05 + aa, abs(t - tk + 0.09));
      let cm = max(d1, d2);
      if (cm > 0.0 && yellow) { col = mix(col, vec3f(0.62, 0.44, 0.05), cm); }
      m = max(m, cm);
    } else {
      let dash = stripeAA(s, 9.0, 0.333, 0.03);
      m = max(m, line * dash);
    }
  }

  // parking bays outboard of the travel lanes
  if ((flags & 1u) != 0u && t < laneA + 0.05) {
    let bay = 1.0 - smoothstep(0.045, 0.045 + aa, abs(t - (laneA - 2.3)));
    let tick = (1.0 - smoothstep(0.045, 0.08, abs(fract(s / 5.8) - 0.5) * 5.8)) * step(laneA - 2.3, t);
    m = max(m, max(bay, tick));
  }
  if ((flags & 2u) != 0u && t > laneB - 0.05) {
    let bay = 1.0 - smoothstep(0.045, 0.045 + aa, abs(t - (laneB + 2.3)));
    let tick = (1.0 - smoothstep(0.045, 0.08, abs(fract(s / 5.8) - 0.5) * 5.8)) * step(t, laneB + 2.3);
    m = max(m, max(bay, tick));
  }

  let approach = select(t > 0.0, t < 0.0, param < 0.0);
  let d = abs(param);

  // stop bar
  if ((flags & 256u) != 0u && approach && d > 5.1 && d < 5.65) {
    m = max(m, 1.0);
  }
  // zebra crossing
  if ((flags & 128u) != 0u && d > 1.3 && d < 4.3) {
    let bars = stripeAA(t + 0.3, 1.2, 0.55, 0.05);
    let fade = smoothstep(1.3, 1.5, d) * (1.0 - smoothstep(4.0, 4.3, d));
    m = max(m, bars * fade);
  }
  // lane arrows
  if ((flags & 256u) != 0u && approach && d > 7.4 && d < 12.0 && !((flags & 128u) != 0u && d < 5.0)) {
    let lane = floor((t - laneA) / max(laneWidth, 1.0));
    let lc = laneA + (lane + 0.5) * laneWidth;
    let dir = select(1.0, -1.0, param < 0.0);
    let kind = select(0.0, 1.0, hash21(vec2f(round(lc * 7.0), round(param * 0.3))) > 0.62);
    m = max(m, arrowMask(vec2f(9.7 - d, (t - lc) * dir), kind));
  }

  // worn paint
  let scuff = fbm(uv * vec2f(3.0, 6.0), 4);
  let worn = clamp(1.0 - wear * 0.55 - (scuff - 0.5) * 0.5, 0.25, 1.0);
  out.mask = clamp(m, 0.0, 1.0) * worn;
  out.colour = col;
  out.raised = out.mask * 0.0022;
  return out;
}

// ---------------------------------------------------------------- fragment
@fragment
fn fs_main(i: VSOut) -> @location(0) vec4f {
  let duv = fwidth(i.uv);          // taken in uniform control flow, threaded to the AA helpers
  let sid = min(i.ids.x, 49u);
  let packed = i.ids.y;
  let flags = packed & 0xffffu;
  let mark = packed >> 16u;
  let mat = MATS[sid];
  let fam = FAMILY[sid];
  let enabled = mat.p2.x > 0.5;
  let scale = max(mat.p0.z, 0.001);
  let detail = select(0.0, mat.p0.w, enabled);
  let wear = clamp(i.wap.x * mat.p1.x * G.params.y, 0.0, 1.4);
  let ao = clamp(i.wap.y, 0.0, 1.0);
  let t = G.camPos.w;

  var S: Surf;
  if (sid >= 27u && sid <= 30u) {
    // traffic sign faces: vector artwork in plate space (uv is [-1,1] across the plate)
    S = signSurf(sid, i.uv, i.laneAB.x, duv);
  } else if (!enabled) {
    S.albedo = mat.albedo.rgb;
    S.rough = mat.p0.x;
    S.metal = mat.p0.y;
    S.height = 0.0;
    S.emissive = vec3f(0.0);
  } else if (fam == 0u) {
    S = asphaltSurf(i.uv, wear, scale, detail);
    S.albedo *= mat.albedo.rgb * 3.0;
  } else if (fam == 1u) {
    S = concreteSurf(i.uv, wear, scale, detail);
    S.albedo *= mat.albedo.rgb * 1.9;
  } else if (fam == 2u) {
    S = pavingSurf(i.uv, wear, scale, detail, mat.p1.w, mat.albedo.rgb);
  } else if (fam == 3u) {
    S = grassSurf(i.uv, wear, scale, detail);
    S.albedo *= mat.albedo.rgb * 2.6;
  } else if (fam == 4u) {
    S = aggregateSurf(i.uv, wear, scale, detail, mat.albedo.rgb);
  } else if (fam == 5u) {
    S = metalSurf(i.uv, wear, scale, detail, mat.albedo.rgb, mat.p0.x);
  } else if (fam == 6u) {
    S = paintSurf(i.uv, wear, scale, mat.albedo.rgb, mat.p0.x);
  } else if (fam == 7u) {
    S = glassSurf(mat.albedo.rgb);
  } else if (fam == 9u) {
    S = rubberSurf(i.uv, scale);
  } else if (fam == 10u) {
    S = tactileSurf(i.uv, scale, mat.albedo.rgb);
  } else if (fam == 11u) {
    S = waterSurf(i.uv, t);
  } else {
    // emissive family: lenses, signals, billboards
    S.albedo = mat.albedo.rgb * 0.25;
    S.rough = 0.25;
    S.metal = 0.0;
    S.height = 0.0;
    if (sid == 25u) {
      S.emissive = signalColour(i.laneAB.x, i.laneAB.y) * mat.p1.z;
    } else if (sid == 26u) {
      // billboard poster: procedural colour fields, lit at night
      let p = i.uv * 0.35;
      let band = fbm(p * 2.0, 3);
      let stripe = stripeAA(i.uv.y, 1.3, 0.5, 0.1);
      let poster = mix(mat.albedo.rgb, mat.albedo.rgb.gbr * 1.4, band) * (0.6 + stripe * 0.8);
      S.albedo = poster * 0.5;
      S.emissive = poster * mat.p1.z * (0.25 + G.flags.z * 1.4);
    } else {
      S.emissive = mat.albedo.rgb * mat.p1.z * (0.4 + G.flags.z);
    }
  }

  // ---- instance paint (vehicles, trains)
  if (sid == 34u || sid == 43u) { S.albedo *= i.inst.rgb; }
  if (sid == 38u || sid == 39u) { S.emissive *= 0.4 + i.inst.a; }

  // ---- road markings & conditions (carriageway only)
  var albedo = S.albedo;
  var rough = S.rough;
  var metal = S.metal;
  var height = S.height;
  var emissive = S.emissive;

  if (fam == 0u) {
    if ((flags & 512u) != 0u) {   // construction: broken-out surface and dust
      let dust = fbm(i.uv * 1.7, 4);
      albedo = mix(albedo, vec3f(0.19, 0.17, 0.145) * (0.7 + dust * 0.7), 0.55);
      rough = 0.99;
      height += (dust - 0.5) * 0.004;
    }
    let paint = roadPaint(i.uv, i.laneAB, i.wap.w, flags, mark, i.wap.z, i.wap.x);
    if (paint.mask > 0.001) {
      albedo = mix(albedo, paint.colour, paint.mask);
      rough = mix(rough, 0.58, paint.mask);
      height += paint.raised;
    }
  }

  // ---- wetness: darkens, smooths, pools in the gutter and on worn asphalt
  let wet = clamp(G.params.x, 0.0, 1.0);
  if (wet > 0.001) {
    let pool = smoothstep(0.35, 0.95, fbm(i.uv * 0.9, 4) + select(0.0, 0.3, sid == 2u));
    let w = wet * mix(0.45, 1.0, pool);
    albedo *= mix(1.0, 0.56, w);
    rough = mix(rough, 0.07, w * 0.92);
    height = mix(height, 0.0, w * 0.8);
  }

  // ---- normal from the procedural height field
  var N = normalize(i.nrm);
  var T = i.tan - N * dot(N, i.tan);
  let tl = length(T);
  if (tl > 1e-4) {
    T = T / tl;
    let B = cross(N, T);
    let e = 0.035;
    var h0 = height;
    var hx = height;
    var hy = height;
    if (enabled && fam != 7u && fam != 8u) {
      // re-evaluate the dominant height term with small uv offsets
      let sx = i.uv + vec2f(e, 0.0);
      let sy = i.uv + vec2f(0.0, e);
      if (fam == 0u) { hx = asphaltSurf(sx, wear, scale, detail).height; hy = asphaltSurf(sy, wear, scale, detail).height; }
      else if (fam == 1u) { hx = concreteSurf(sx, wear, scale, detail).height; hy = concreteSurf(sy, wear, scale, detail).height; }
      else if (fam == 2u) { hx = pavingSurf(sx, wear, scale, detail, mat.p1.w, mat.albedo.rgb).height; hy = pavingSurf(sy, wear, scale, detail, mat.p1.w, mat.albedo.rgb).height; }
      else if (fam == 3u) { hx = grassSurf(sx, wear, scale, detail).height; hy = grassSurf(sy, wear, scale, detail).height; }
      else if (fam == 4u) { hx = aggregateSurf(sx, wear, scale, detail, mat.albedo.rgb).height; hy = aggregateSurf(sy, wear, scale, detail, mat.albedo.rgb).height; }
      else if (fam == 10u) { hx = tactileSurf(sx, scale, mat.albedo.rgb).height; hy = tactileSurf(sy, scale, mat.albedo.rgb).height; }
      let gain = mat.p2.z * (1.0 - wet * 0.75);
      N = normalize(N - (T * (hx - h0) + B * (hy - h0)) * gain / e);
    }
  }

  // ---- lighting
  let V = normalize(G.camPos.xyz - i.wpos);
  let L = normalize(G.sunDir.xyz);
  let ndl = max(dot(N, L), 0.0);
  let shade = shadowFactor(i.wpos, ndl);
  let sunRad = G.sunColour.rgb * G.sunDir.w * shade;
  var colour = directLight(N, V, L, albedo, rough, metal, sunRad);
  colour += ambientLight(N, V, albedo, rough, metal, ao);
  colour += punctualLights(i.wpos, N, V, albedo, rough, metal);
  colour += emissive;

  // selection highlight on the active junction
  if (G.selection.w > 0.0) {
    let d = distance(i.wpos.xz, G.selection.xz);
    let ring = (1.0 - smoothstep(G.selection.w - 1.6, G.selection.w, d)) * 0.10
             + (1.0 - smoothstep(0.55, 1.2, abs(d - G.selection.w))) * 0.5;
    colour += vec3f(0.25, 0.52, 0.95) * ring * G.flags.x;
  }

  colour = applyFog(colour, i.wpos, G.camPos.xyz);
  return vec4f(colour, mat.albedo.a);
}

// ---------------------------------------------------------------- shadow pass
@vertex
fn vs_shadow(v: VSIn) -> @builtin(position) vec4f {
  return G.sunViewProj * vec4f(v.pos, 1.0);
}

@vertex
fn vs_shadow_inst(v: VSIn, inst: InstIn) -> @builtin(position) vec4f {
  return G.sunViewProj * vec4f(instanceTransform(v.pos, inst) + inst.posYaw.xyz, 1.0);
}
`;
