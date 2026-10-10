/**
 * The surface shader. Everything is procedural - there is not one texture
 * file in this project - and every term is driven by a layer in the stack on
 * the right, so the material is authored by toggling and tuning layers rather
 * than by wiring nodes.
 *
 * Layer slots (index into U.L, .x = opacity, .yzw = parameters):
 *   0 asphalt base      y: lightness   z: colour temp
 *   1 aggregate         y: stone size  z: contrast
 *   2 binder / patching y: patch size  z: darkness
 *   3 tyre polish       y: width       z: strength
 *   4 cracking          y: scale       z: age
 *   5 markings          y: brightness  z: wear
 *   6 kerb concrete     y: lightness   z: staining
 *   7 footway paving    y: pattern     z: unit size   w: joint
 *   8 grime             y: scale       z: strength
 *   9 standing water    y: coverage    z: ripple
 */
export const SHADER = /* wgsl */`
struct Uniforms {
  vp    : mat4x4f,
  cam   : vec4f,
  sun   : vec4f,
  misc  : vec4f,          // time, mode, hoverNode, selNode
  tint  : vec4f,
  L     : array<vec4f, 16>,
};
@group(0) @binding(0) var<uniform> U : Uniforms;

struct VOut {
  @builtin(position) clip : vec4f,
  @location(0) wp   : vec3f,
  @location(1) nrm  : vec3f,
  @location(2) uv   : vec2f,
  @location(3) a    : vec4f,
  @location(4) b    : vec4f,
};

@vertex
fn vs(@location(0) p : vec3f,
      @location(1) n : vec3f,
      @location(2) uv : vec2f,
      @location(3) a : vec4f,
      @location(4) b : vec4f) -> VOut {
  var o : VOut;
  o.clip = U.vp * vec4f(p, 1.0);
  o.wp = p;
  o.nrm = n;
  o.uv = uv;
  o.a = a;
  o.b = b;
  return o;
}

fn hash21(q : vec2f) -> f32 {
  var p = fract(q * vec2f(0.1031, 0.1030));
  p = p + vec2f(dot(p, p.yx + 33.33));
  return fract((p.x + p.y) * p.x);
}

fn vnoise(p : vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = hash21(i);
  let b = hash21(i + vec2f(1.0, 0.0));
  let c = hash21(i + vec2f(0.0, 1.0));
  let d = hash21(i + vec2f(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn fbm(p : vec2f, oct : i32) -> f32 {
  var s = 0.0;
  var amp = 0.5;
  var f = 1.0;
  for (var i = 0; i < oct; i = i + 1) {
    s = s + vnoise(p * f) * amp;
    amp = amp * 0.5;
    f = f * 2.03;
  }
  return s;
}

/** Worley-ish cell distance, for aggregate and for paving joints. */
fn cells(p : vec2f) -> vec2f {
  let ip = floor(p);
  let fp = fract(p);
  var d1 = 8.0;
  var d2 = 8.0;
  for (var y = -1; y <= 1; y = y + 1) {
    for (var x = -1; x <= 1; x = x + 1) {
      let g = vec2f(f32(x), f32(y));
      let o = vec2f(hash21(ip + g), hash21(ip + g + 7.31));
      let d = length(g + o - fp);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
    }
  }
  return vec2f(d1, d2);
}

fn dashes(v : f32, period : f32, duty : f32) -> f32 {
  return step(fract(v / period), duty);
}

/** Painted markings, laid out from the real cross-section, not a texture. */
fn markings(uv : vec2f, a : vec4f, b : vec4f) -> f32 {
  let kind = a.y;
  let half = a.z;
  let laneW = b.x;
  let lanes = b.y;
  let mk = b.z;
  let u = uv.x;
  let v = uv.y;
  if (kind > 0.5) { return 0.0; }            // junction surface stays bare
  var m = 0.0;

  if (mk > 2.5) { return 0.0; }              // a works patch is unpainted
  if (mk > 0.5 && mk < 1.5) {                // zebra crossing
    let bars = step(fract(u / 1.3), 0.52);
    return bars * step(abs(u), half - 0.25);
  }
  if (mk > 1.5 && mk < 2.5) {                // stop bar
    return step(abs(u), half - 0.3);
  }

  // continuous edge line, 100 mm, set 250 mm off the channel
  m = max(m, 1.0 - smoothstep(0.045, 0.065, abs(abs(u) - (half - 0.3))));
  // centre line: double solid where there is more than one lane each way
  if (lanes > 1.5) {
    m = max(m, 1.0 - smoothstep(0.05, 0.07, abs(abs(u) - 0.09)));
  } else {
    let c = 1.0 - smoothstep(0.05, 0.07, abs(u));
    m = max(m, c * dashes(v, 12.0, 0.42));
  }
  // lane dividers
  for (var i = 1; i < 4; i = i + 1) {
    if (f32(i) >= lanes) { break; }
    let off = f32(i) * laneW;
    let d = 1.0 - smoothstep(0.05, 0.07, abs(abs(u) - off));
    m = max(m, d * dashes(v, 12.0, 0.35));
  }
  return m;
}

struct Surf { albedo : vec3f, rough : f32, ao : f32 };

fn surface(wp : vec3f, uv : vec2f, a : vec4f, b : vec4f) -> Surf {
  let mat = i32(a.x + 0.5);
  let wear = a.w;
  var col = vec3f(0.35);
  var rough = 0.85;
  var ao = 1.0;
  let xz = wp.xz;

  if (mat == 0 || mat == 1) {
    // ---- 0 asphalt base
    let L0 = U.L[0];
    let base = mix(vec3f(0.115, 0.118, 0.125), vec3f(0.30, 0.295, 0.285), L0.y);
    col = mix(col, base * mix(1.0, 1.08, L0.z), L0.x);
    rough = 0.92;

    // ---- 1 aggregate
    let L1 = U.L[1];
    if (L1.x > 0.001) {
      let c = cells(xz * (26.0 / max(L1.y, 0.05)));
      let stone = smoothstep(0.0, 0.55, c.y - c.x);
      let grain = fbm(xz * 46.0, 3);
      col = mix(col, col * (0.72 + 0.95 * stone) + vec3f(grain * 0.05), L1.x * L1.z);
      rough = rough - 0.08 * L1.x;
    }
    // ---- 2 binder bleed and old patches
    let L2 = U.L[2];
    if (L2.x > 0.001) {
      let patch = smoothstep(0.52, 0.60, fbm(xz * (0.06 / max(L2.y, 0.05)), 4));
      col = mix(col, col * mix(1.0, 0.62, L2.z), patch * L2.x);
      rough = mix(rough, 0.72, patch * L2.x);
    }
    // ---- 3 tyre polish in the wheel paths
    let L3 = U.L[3];
    if (L3.x > 0.001 && a.y < 0.5) {
      let laneW = max(b.x, 1.0);
      let lane = (abs(uv.x) % laneW) - laneW * 0.5;
      let path = exp(-pow(abs(abs(lane) - 0.85) / max(L3.y, 0.1), 2.0));
      col = col * (1.0 - 0.30 * path * L3.x * L3.z);
      rough = rough - 0.34 * path * L3.x * L3.z;
    }
    // ---- 4 cracking
    let L4 = U.L[4];
    if (L4.x > 0.001) {
      let c = cells(xz * (1.9 / max(L4.y, 0.05)));
      let seam = 1.0 - smoothstep(0.0, 0.045 + 0.05 * L4.z, c.y - c.x);
      let age = smoothstep(0.35, 0.95, wear * (0.5 + L4.z));
      col = mix(col, col * 0.45, seam * age * L4.x);
      ao = ao - 0.35 * seam * age * L4.x;
    }
    // ---- 5 markings
    let L5 = U.L[5];
    if (L5.x > 0.001) {
      let m = markings(uv, a, b);
      let dirt = 0.55 + 0.45 * (1.0 - L5.z * wear);
      let paint = vec3f(0.80, 0.79, 0.74) * L5.y * dirt;
      col = mix(col, paint, clamp(m, 0.0, 1.0) * L5.x);
      rough = mix(rough, 0.55, m * L5.x);
    }
    if (mat == 1) { col = col * 0.88; ao = ao * 0.82; }     // channel sits in shadow
  } else if (mat == 2 || mat == 7) {
    // ---- 6 kerb concrete
    let L6 = U.L[6];
    let c = mix(vec3f(0.30, 0.295, 0.285), vec3f(0.62, 0.615, 0.60), L6.y);
    let joint = 1.0 - smoothstep(0.0, 0.03, abs(fract(uv.y / 0.9) - 0.5) - 0.47);
    col = mix(vec3f(0.4), c, L6.x);
    col = col * (1.0 - 0.35 * joint);
    col = col * (1.0 - L6.z * 0.45 * smoothstep(0.3, 0.9, fbm(xz * 3.0, 3)));
    rough = 0.88;
    ao = 0.75;
  } else if (mat == 3) {
    // ---- 7 footway paving
    let L7 = U.L[7];
    let size = max(L7.z, 0.15);
    var q = xz / size;
    let pattern = i32(L7.y * 3.99);
    if (pattern == 1) {                      // stretcher bond
      let row = floor(q.y);
      q.x = q.x + 0.5 * (row % 2.0);
      q.y = q.y * 2.2;
    } else if (pattern == 2) {               // herringbone
      let r = vec2f(q.x + q.y, q.y - q.x) * 0.707;
      q = vec2f(r.x, r.y * 2.4);
    } else if (pattern == 3) {               // random ashlar
      q = q + vec2f(hash21(floor(q)) * 0.4, 0.0);
    }
    let cellv = fract(q) - 0.5;
    let joint = 1.0 - smoothstep(0.40, 0.48, max(abs(cellv.x), abs(cellv.y)));
    let unit = hash21(floor(q));
    let slab = mix(vec3f(0.38, 0.375, 0.365), vec3f(0.58, 0.565, 0.54), 0.35 + unit * 0.5);
    col = mix(vec3f(0.42), slab, L7.x);
    col = mix(col * 0.55, col, joint);
    col = col * (0.92 + 0.08 * fbm(xz * 22.0, 3));
    rough = 0.9;
    ao = mix(0.72, 1.0, joint);
  } else if (mat == 4 || mat == 6) {
    let g = fbm(xz * 1.4, 4);
    col = mix(vec3f(0.115, 0.165, 0.085), vec3f(0.22, 0.30, 0.135), g);
    rough = 0.98;
  } else if (mat == 5) {
    col = vec3f(0.26, 0.255, 0.25) * (0.8 + 0.4 * fbm(xz * 8.0, 3));
    rough = 0.95;
  } else if (mat == 9) {
    let g = fbm(xz * 0.35, 5);
    col = mix(vec3f(0.085, 0.105, 0.072), vec3f(0.15, 0.175, 0.11), g);
    rough = 1.0;
  }

  // ---- 8 grime, everywhere
  let L8 = U.L[8];
  if (L8.x > 0.001) {
    let g = fbm(xz * (0.9 / max(L8.y, 0.05)) + 11.0, 4);
    col = col * (1.0 - L8.x * L8.z * 0.45 * smoothstep(0.42, 0.85, g));
  }
  var s : Surf;
  s.albedo = col;
  s.rough = clamp(rough, 0.05, 1.0);
  s.ao = clamp(ao, 0.2, 1.0);
  return s;
}

@fragment
fn fs(i : VOut) -> @location(0) vec4f {
  let mode = i32(U.misc.y + 0.5);
  var N = normalize(i.nrm);
  let Vv = normalize(U.cam.xyz - i.wp);
  if (dot(N, Vv) < 0.0) { N = -N; }

  if (mode == 2) {                                   // material view
    let m = i.a.x;
    var pal = array<vec3f, 10>(
      vec3f(0.18, 0.19, 0.22), vec3f(0.35, 0.45, 0.6), vec3f(0.85, 0.72, 0.35),
      vec3f(0.55, 0.52, 0.48), vec3f(0.25, 0.45, 0.22), vec3f(0.45, 0.42, 0.40),
      vec3f(0.30, 0.55, 0.32), vec3f(0.70, 0.62, 0.40), vec3f(0.5, 0.5, 0.5),
      vec3f(0.12, 0.15, 0.10));
    let c = pal[clamp(i32(m + 0.5), 0, 9)];
    return vec4f(c * (0.45 + 0.55 * max(dot(N, normalize(U.sun.xyz)), 0.0)), 1.0);
  }
  if (mode == 3) {                                   // topology view
    let k = i.a.y;
    var c = vec3f(0.22, 0.26, 0.32);
    if (k > 0.5 && k < 1.5) { c = vec3f(0.80, 0.55, 0.18); }
    if (k > 1.5) { c = vec3f(0.25, 0.60, 0.45); }
    return vec4f(c * (0.5 + 0.5 * max(dot(N, normalize(U.sun.xyz)), 0.0)), 1.0);
  }

  let s = surface(i.wp, i.uv, i.a, i.b);
  let Ld = normalize(U.sun.xyz);
  let ndl = max(dot(N, Ld), 0.0);

  // sky: a cheap two-lobe gradient, warm sun side, cool zenith
  let up = clamp(N.y * 0.5 + 0.5, 0.0, 1.0);
  let sky = mix(vec3f(0.16, 0.18, 0.21), vec3f(0.42, 0.52, 0.66), up);
  let bounce = vec3f(0.16, 0.15, 0.13) * (1.0 - up);

  var lit = s.albedo * (sky * s.ao + bounce * s.ao);
  lit = lit + s.albedo * U.sun.w * ndl * vec3f(1.0, 0.95, 0.86);

  // specular: wet or polished asphalt picks up a long highlight
  let H = normalize(Ld + Vv);
  let sh = pow(2.0 / max(s.rough * s.rough * s.rough * s.rough, 1e-4), 0.5);
  let spec = pow(max(dot(N, H), 0.0), max(sh, 1.0)) * (1.0 - s.rough) * 0.8;
  let L9 = U.L[9];
  var wet = 0.0;
  if (L9.x > 0.001) {
    wet = L9.x * smoothstep(0.55, 0.85, fbm(i.wp.xz * (0.7 / max(L9.y, 0.05)), 4));
    lit = lit * (1.0 - 0.45 * wet);
  }
  let fres = 0.04 + 0.5 * pow(1.0 - max(dot(N, Vv), 0.0), 5.0);
  lit = lit + vec3f(spec) * U.sun.w + sky * fres * (0.25 + wet * 1.6);

  // selection / hover tint comes in as a flat add
  lit = lit + U.tint.xyz * U.tint.w;

  let fog = 1.0 - exp(-length(U.cam.xyz - i.wp) * 0.0012);
  lit = mix(lit, vec3f(0.26, 0.30, 0.36), fog * 0.7);
  return vec4f(pow(max(lit, vec3f(0.0)), vec3f(1.0 / 2.2)), 1.0);
}

// ---- flat colour pipeline, for wireframe and gizmos
struct LOut { @builtin(position) clip : vec4f, @location(0) c : vec3f };

@vertex
fn vsLine(@location(0) p : vec3f, @location(1) c : vec3f) -> LOut {
  var o : LOut;
  o.clip = U.vp * vec4f(p, 1.0);
  o.clip.z = o.clip.z - 0.00004 * o.clip.w;      // pull wires towards the eye
  o.c = c;
  return o;
}

@fragment
fn fsLine(i : LOut) -> @location(0) vec4f {
  return vec4f(i.c, 1.0);
}
`;
