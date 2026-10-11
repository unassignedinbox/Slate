// WGSL for the road studio. One uniform block shared by all passes, a directional
// shadow map, procedural texture stacks (see src/engine/textures.js for the layer ids)
// and a fullscreen sky. Texture layers are evaluated per fragment in world space.
export const WGSL = /* wgsl */ `
struct Globals {
  viewProj: mat4x4f,
  lightVP: mat4x4f,
  invVP: mat4x4f,
  camPos: vec4f,
  sunDir: vec4f,      // xyz direction to sun, w intensity
  sunColor: vec4f,
  skyTop: vec4f,
  skyHorizon: vec4f,
  groundTint: vec4f,
  fog: vec4f,         // x density, z enabled
  misc: vec4f,        // x unused, y exposure, z shadows on, w wetness
  palette: array<vec4f, 32>,
  stacks: array<vec4f, 64>,
};

@group(0) @binding(0) var<uniform> G: Globals;
@group(1) @binding(0) var shadowMap: texture_depth_2d;
@group(1) @binding(1) var shadowSamp: sampler_comparison;

struct VIn {
  @location(0) pos: vec3f,
  @location(1) nrm: vec3f,
  @location(2) mat: f32,
  @location(3) uv: f32,
  @location(4) ao: f32,
};

struct IIn {
  @location(5) m0: vec4f,
  @location(6) m1: vec4f,
  @location(7) m2: vec4f,
  @location(8) m3: vec4f,
  @location(9) paint: f32,
};

struct VOut {
  @builtin(position) clip: vec4f,
  @location(0) wpos: vec3f,
  @location(1) wnrm: vec3f,
  @location(2) @interpolate(flat) mat: f32,
  @location(3) uv: f32,
  @location(4) ao: f32,
};

fn emit(wp: vec3f, wn: vec3f, m: f32, uv: f32, ao: f32) -> VOut {
  var o: VOut;
  o.clip = G.viewProj * vec4f(wp, 1.0);
  o.wpos = wp;
  o.wnrm = wn;
  o.mat = m;
  o.uv = uv;
  o.ao = ao;
  return o;
}

@vertex fn vs_main(v: VIn) -> VOut {
  return emit(v.pos, v.nrm, v.mat, v.uv, v.ao);
}

@vertex fn vs_inst(v: VIn, i: IIn) -> VOut {
  let M = mat4x4f(i.m0, i.m1, i.m2, i.m3);
  var m = v.mat;
  if (m > 19.5 && m < 20.5) { m = 20.0 + i.paint; }
  let wp = (M * vec4f(v.pos, 1.0)).xyz;
  let wn = (M * vec4f(v.nrm, 0.0)).xyz;
  return emit(wp, wn, m, v.uv, v.ao);
}

@vertex fn vs_shadow(v: VIn) -> @builtin(position) vec4f {
  return G.lightVP * vec4f(v.pos, 1.0);
}

@vertex fn vs_shadow_inst(v: VIn, i: IIn) -> @builtin(position) vec4f {
  let M = mat4x4f(i.m0, i.m1, i.m2, i.m3);
  return G.lightVP * (M * vec4f(v.pos, 1.0));
}

// ---------- helpers ----------
fn sq(x: f32) -> f32 {
  return x * x;
}

// ---------- noise ----------
fn hash21(p: vec2f) -> f32 {
  var q = fract(p * vec2f(123.34, 456.21));
  q += dot(q, q + 45.32);
  return fract(q.x * q.y);
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

fn fbm(p0: vec2f) -> f32 {
  var p = p0;
  var a = 0.5;
  var s = 0.0;
  for (var k = 0; k < 4; k++) {
    s += a * vnoise(p);
    p = p * 2.03 + vec2f(17.1, 9.2);
    a *= 0.5;
  }
  return s;
}

// x: distance to nearest feature, y: distance to second, z: random id of nearest cell
fn voro(p: vec2f) -> vec3f {
  let i = floor(p);
  let f = fract(p);
  var f1 = 8.0;
  var f2 = 8.0;
  var ch = 0.0;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let g = vec2f(f32(x), f32(y));
      let o = vec2f(hash21(i + g), hash21(i + g + vec2f(7.3, 3.1)));
      let r = g + o - f;
      let d = sqrt(dot(r, r));
      if (d < f1) {
        f2 = f1;
        f1 = d;
        ch = hash21(i + g + vec2f(1.7, 5.3));
      } else if (d < f2) {
        f2 = d;
      }
    }
  }
  return vec3f(f1, f2, ch);
}

// ---------- texture layers (ids match LAYER_TYPES in src/engine/textures.js) ----------
struct LOut { v: f32, h: f32 };  // v: albedo factor around 1, h: height in mm-scale units

fn layerEval(t: i32, q: vec2f, uvx: f32, sc: f32, seed: f32, pr: vec4f) -> LOut {
  var o: LOut;
  o.v = 1.0;
  o.h = 0.0;
  let S = max(sc, 0.05);
  let sd = vec2f(seed * 1.37, seed * 0.71);
  let qs = q / S + sd;

  if (t == 0) {                       // aggregate
    let n1 = fbm(qs * 6.0);
    let n2 = vnoise(qs * 40.0);
    o.v = 0.7 + 0.45 * (n1 - 0.45) + 0.12 * n2;
    o.h = (n2 - 0.5) * 0.35 + (n1 - 0.5) * 0.5;
  } else if (t == 1) {                // chip seal
    let cell = floor(qs * 16.0);
    let spk = step(0.72, hash21(cell));
    o.v = 0.85 + spk * 0.9;
    o.h = spk * 0.25;
  } else if (t == 2) {                // hairline cracks
    let vo = voro(qs * (0.3 + 0.4 * pr.x));
    let e = vo.y - vo.x;
    let cr = 1.0 - smoothstep(0.0, 0.03, e);
    o.v = 1.0 - cr * 0.85;
    o.h = -cr * 0.7;
  } else if (t == 3) {                // alligator cracking
    let vo = voro(qs * 0.35 * (0.5 + pr.x));
    let e = vo.y - vo.x;
    let cr = (1.0 - smoothstep(0.0, 0.05, e)) * (0.6 + 0.4 * fbm(qs * 2.0));
    o.v = 1.0 - cr * 0.8;
    o.h = -cr * 0.8;
  } else if (t == 4) {                // patch repair
    let c = floor(qs * 0.5);
    let on = step(1.0 - pr.x * 0.6, hash21(c));
    let lc = fract(qs * 0.5);
    let edge = min(min(lc.x, 1.0 - lc.x), min(lc.y, 1.0 - lc.y));
    let patchTone = 0.8 + 0.12 * hash21(c + vec2f(3.1, 1.7));
    o.v = mix(1.0, patchTone, on) - on * (1.0 - smoothstep(0.0, 0.03, edge)) * 0.25;
    o.h = on * 0.02;
  } else if (t == 5) {                // tire polish bands
    let b = exp(-sq((uvx - 0.27) / 0.11)) + exp(-sq((uvx - 0.73) / 0.11));
    o.v = 1.0 - 0.38 * b * (0.75 + 0.25 * vnoise(vec2f(qs.x * 0.5, qs.y * 6.0)));
    o.h = -b * 0.05;
  } else if (t == 6) {                // oil stains
    let f = fbm(qs * 0.35);
    let st = smoothstep(0.6, 0.72, f);
    o.v = 1.0 - 0.75 * st;
    o.h = -0.15 * st;
  } else if (t == 7) {                // dust and grime
    let f = fbm(qs * 0.12);
    o.v = 0.72 + 0.5 * f;
  } else if (t == 8) {                // concrete slabs; pr.x size, pr.y joint width
    let L = max(pr.x, 0.05);
    let gq = q / L + sd;
    let f = fract(gq);
    let dm = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)) * L;
    let jm = 1.0 - smoothstep(0.0, max(pr.y, 0.001), dm);
    let cell = floor(gq);
    o.v = (0.9 + 0.2 * hash21(cell + sd)) * (1.0 - 0.5 * jm);
    o.h = -jm * 0.5;
  } else if (t == 9) {                // clay bricks; pr.x length, pr.y height, pr.z mortar
    let BL = max(pr.x, 0.05);
    let BH = max(pr.y, 0.02);
    let mo = max(pr.z, 0.002);
    let rowc = q.y / BH;
    let row = floor(rowc);
    let gx = q.x / BL + fract(row * 0.5);
    let cell = vec2f(floor(gx), row);
    let fx = fract(gx) * BL;
    let fy = fract(rowc) * BH;
    let dm = min(min(fx, BL - fx), min(fy, BH - fy));
    let mort = 1.0 - smoothstep(0.0, mo * 0.5 + 0.001, dm);
    o.v = (0.82 + 0.3 * hash21(cell + sd)) * (1.0 - 0.45 * mort);
    o.h = -mort * 0.5;
  } else if (t == 10) {               // granite setts; pr.x size, pr.y gap
    let SS = max(pr.x, 0.05);
    let vo = voro(q / SS + sd);
    let e = (vo.y - vo.x) * SS;
    let gap = 1.0 - smoothstep(0.0, max(pr.y, 0.002), e * 0.5);
    let dome = 1.0 - smoothstep(0.0, 0.5, vo.x);
    o.v = (0.7 + 0.5 * vo.z) * (0.85 + 0.2 * dome) * (1.0 - 0.5 * gap);
    o.h = dome * 0.6 - gap * 0.6;
  } else if (t == 11) {               // gravel and sand
    let vo = voro(qs * 4.0);
    o.v = 0.5 + 0.6 * vo.z;
    o.h = vo.z * 0.5 - vo.x * 0.2;
  } else if (t == 12) {               // wet sheen (handled in roughness)
    o.v = 0.8;
  } else {                            // 13: paint scuffs
    let n = vnoise(vec2f(qs.x * 0.3, qs.y * 7.0));
    o.v = 1.0 - 0.45 * step(0.8, n);
  }
  return o;
}

fn maskEval(mk: i32, uvx: f32, q: vec2f) -> f32 {
  if (mk == 1) {                      // lane bands
    return exp(-sq((uvx - 0.27) / 0.12)) + exp(-sq((uvx - 0.73) / 0.12));
  }
  if (mk == 2) {                      // curb edge
    return smoothstep(0.7, 1.0, abs(uvx * 2.0 - 1.0));
  }
  if (mk == 3) {                      // blotches
    return smoothstep(0.55, 0.7, vnoise(q * 0.25 + vec2f(5.2, 1.3)));
  }
  return 1.0;
}

struct SOut { alb: vec3f, rough: f32, h: f32 };

fn stackEval(si: u32, p: vec3f, n: vec3f, uvx: f32, base: vec3f, baseR: f32) -> SOut {
  var alb = base;
  var rough = baseR;
  var h = 0.0;
  let horiz = abs(n.y) > 0.5;
  let q = select(vec2f(p.x + p.z, p.y), vec2f(p.x, p.z), horiz);
  for (var li = 0u; li < 8u; li++) {
    let b = (si * 8u + li) * 4u;
    let v0 = G.stacks[b];
    if (v0.w < 0.5) { continue; }
    let v1 = G.stacks[b + 1u];
    let v2 = G.stacks[b + 2u];
    let v3 = G.stacks[b + 3u];
    let lo = layerEval(i32(v0.x + 0.5), q, uvx, v1.x, v1.w, v3);
    let mk = maskEval(i32(v2.w + 0.5), uvx, q);
    let a = clamp(v0.z * v1.y * mk, 0.0, 1.0);
    let bl = i32(v0.y + 0.5);
    if (bl == 0) {
      alb = mix(alb, v2.rgb * lo.v, a);
    } else if (bl == 1) {
      alb = mix(alb, alb * lo.v * (v2.rgb * 2.0), a);
    } else {
      alb = clamp(alb + (lo.v - 0.5) * v2.rgb * 0.5 * a, vec3f(0.0), vec3f(1.0));
    }
    rough = mix(rough, clamp(v1.z + (lo.v - 0.5) * 0.12, 0.05, 1.0), a);
    h += lo.h * a;
  }
  var o: SOut;
  o.alb = alb;
  o.rough = rough;
  o.h = h;
  return o;
}

// ---------- lighting ----------
fn aces(x: vec3f) -> vec3f {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0));
}

fn shadowAt(wp: vec3f, n: vec3f) -> f32 {
  let p = wp + n * 0.06;
  let lc = G.lightVP * vec4f(p, 1.0);
  let nd = lc.xyz / lc.w;
  let uv = vec2f(nd.x * 0.5 + 0.5, 0.5 - nd.y * 0.5);
  // Sample unconditionally (uniform control flow) with clamped coordinates, then select.
  let inside = uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0 && nd.z <= 1.0;
  let cuv = clamp(uv, vec2f(0.0), vec2f(1.0));
  let tx = 1.0 / 2048.0;
  var s = 0.0;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      s += textureSampleCompare(shadowMap, shadowSamp, cuv + vec2f(f32(x), f32(y)) * tx * 1.5, nd.z - 0.0015);
    }
  }
  return select(1.0, s / 9.0, inside);
}

@fragment fn fs_main(i: VOut) -> @location(0) vec4f {
  let V = normalize(G.camPos.xyz - i.wpos);
  var N = normalize(i.wnrm);
  if (dot(N, V) < 0.0) { N = -N; }
  let m = u32(i.mat + 0.5);
  var alb = G.palette[m].rgb;
  var rough = G.palette[m].w;
  var emis = vec3f(0.0);
  if (m == 13u) { emis = G.palette[m].rgb * 5.0; }

  let isAsph = m == 1u || m == 2u;
  let isPave = m == 5u;
  if (isAsph || isPave) {
    let si = select(0u, 1u, isPave);
    let s = stackEval(si, i.wpos, N, i.uv, alb, rough);
    alb = s.alb;
    rough = s.rough;
    let wet = G.misc.w;
    alb = alb * (1.0 - 0.25 * wet);
    rough = mix(rough, 0.12, wet * 0.7);
    if (abs(N.y) > 0.6) {
      // Bump from the height field: finite differences in world x and z.
      let e = 0.02;
      let hx = stackEval(si, i.wpos + vec3f(e, 0.0, 0.0), N, i.uv, alb, rough).h;
      let hz = stackEval(si, i.wpos + vec3f(0.0, 0.0, e), N, i.uv, alb, rough).h;
      let g = vec3f((hx - s.h) / e, 0.0, (hz - s.h) / e);
      N = normalize(N - g * 0.06);
    }
  } else {
    let nz = vnoise(i.wpos.xz * 9.0) * 0.6 + vnoise(i.wpos.xz * 47.0) * 0.4;
    alb = alb * (0.88 + 0.24 * nz);
  }

  let L = normalize(G.sunDir.xyz);
  let sunI = G.sunDir.w;
  var sh = 1.0;
  if (G.misc.z > 0.5 && sunI > 0.001) { sh = shadowAt(i.wpos, N); }
  let ndl = max(dot(N, L), 0.0);
  let H = normalize(L + V);
  let ndh = max(dot(N, H), 0.0);
  let shin = mix(600.0, 14.0, rough);
  let spec = pow(ndh, shin) * (shin + 8.0) / 25.13 * (0.04 + 0.5 * (1.0 - rough)) * ndl;
  let sunCol = G.sunColor.rgb * sunI;
  let diffuse = alb * ndl * sunCol * sh;
  let hemi = mix(G.groundTint.rgb, G.skyTop.rgb, 0.5 + 0.5 * N.y);
  let ambient = alb * hemi * 0.6 * mix(0.45, 1.0, i.ao);
  var col = diffuse + ambient + spec * sunCol * sh + emis;

  let dist = length(i.wpos - G.camPos.xyz);
  let f = 1.0 - exp(-G.fog.x * dist * dist);
  col = mix(col, G.skyHorizon.rgb, clamp(f * G.fog.z, 0.0, 1.0));
  col = aces(col * G.misc.y);
  col = pow(col, vec3f(1.0 / 2.2));
  return vec4f(col, 1.0);
}

// ---------- sky ----------
struct SkyOut {
  @builtin(position) pos: vec4f,
  @location(0) ndc: vec2f,
};

@vertex fn vs_sky(@builtin(vertex_index) vi: u32) -> SkyOut {
  let p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: SkyOut;
  o.pos = vec4f(p[vi], 0.0, 1.0);
  o.ndc = p[vi];
  return o;
}

@fragment fn fs_sky(i: SkyOut) -> @location(0) vec4f {
  let far = G.invVP * vec4f(i.ndc, 1.0, 1.0);
  let wp = far.xyz / far.w;
  let rd = normalize(wp - G.camPos.xyz);
  let t = clamp(rd.y, 0.0, 1.0);
  var col = mix(G.skyHorizon.rgb, G.skyTop.rgb, pow(t, 0.45));
  let sd = max(dot(rd, normalize(G.sunDir.xyz)), 0.0);
  col += G.sunColor.rgb * G.sunDir.w * (pow(sd, 900.0) * 6.0 + pow(sd, 8.0) * 0.12);
  col = aces(col * G.misc.y);
  col = pow(col, vec3f(1.0 / 2.2));
  return vec4f(col, 1.0);
}
`;
