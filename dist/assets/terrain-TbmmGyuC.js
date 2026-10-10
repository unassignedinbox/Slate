import"./modulepreload-polyfill-P2Xu9kJm.js";var e=`
fn hash2(p: vec2i) -> u32 {
  var h: u32 = u32(p.x) * 0x27d4eb2du + u32(p.y) * 0x85ebca6bu;
  h = h ^ (h >> 15u); h = h * 0x2c1b3c6du;
  h = h ^ (h >> 12u); h = h * 0x297a2d39u;
  h = h ^ (h >> 15u);
  return h;
}
fn rand2(p: vec2i, seed: u32) -> f32 {
  return f32(hash2(p) ^ (seed * 0x9e3779b9u)) * (1.0 / 4294967296.0);
}
fn grad2(p: vec2i, seed: u32) -> vec2f {
  let a = rand2(p, seed) * 6.2831853;
  return vec2f(cos(a), sin(a));
}
// quintic fade: C2 continuous, no second-derivative jump at cell walls
fn fade2(t: vec2f) -> vec2f { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }

fn perlin(p: vec2f, seed: u32) -> f32 {
  let i = vec2i(floor(p));
  let f = fract(p);
  let u = fade2(f);
  let a = dot(grad2(i + vec2i(0, 0), seed), f - vec2f(0.0, 0.0));
  let b = dot(grad2(i + vec2i(1, 0), seed), f - vec2f(1.0, 0.0));
  let c = dot(grad2(i + vec2i(0, 1), seed), f - vec2f(0.0, 1.0));
  let d = dot(grad2(i + vec2i(1, 1), seed), f - vec2f(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 1.4142;
}

// cellular noise, returns F2-F1 (ridge-like crests) and F1
fn cellular(p: vec2f, seed: u32) -> vec2f {
  let ip = vec2i(floor(p));
  let fp = fract(p);
  var f1 = 8.0;
  var f2 = 8.0;
  for (var y = -1; y <= 1; y = y + 1) {
    for (var x = -1; x <= 1; x = x + 1) {
      let o = vec2i(x, y);
      let h = hash2(ip + o) ^ (seed * 0x9e3779b9u);
      let jx = f32(h & 0xffffu) / 65535.0;
      let jy = f32((h >> 16u) & 0xffffu) / 65535.0;
      let d = length(vec2f(f32(x), f32(y)) + vec2f(jx, jy) - fp);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
    }
  }
  return vec2f(f1, f2 - f1);
}

// rotation per octave kills the axis-aligned "corduroy" of a shared lattice
const OCT_ROT = mat2x2f(0.8775826, 0.4794255, -0.4794255, 0.8775826);

fn fbm(pIn: vec2f, oct: i32, lac: f32, gain: f32, seed: u32) -> f32 {
  var p = pIn;
  var a = 1.0;
  var sum = 0.0;
  var norm = 0.0;
  for (var i = 0; i < oct; i = i + 1) {
    sum = sum + a * perlin(p, seed + u32(i) * 7919u);
    norm = norm + a;
    a = a * gain;
    p = OCT_ROT * p * lac;
  }
  return sum / max(norm, 1e-5);
}

fn ridged(pIn: vec2f, oct: i32, lac: f32, gain: f32, sharp: f32, seed: u32) -> f32 {
  var p = pIn;
  var a = 1.0;
  var sum = 0.0;
  var norm = 0.0;
  var prev = 1.0;
  for (var i = 0; i < oct; i = i + 1) {
    var n = 1.0 - abs(perlin(p, seed + u32(i) * 7919u));
    n = pow(n, 1.0 + sharp * 2.0);
    sum = sum + a * n * prev;        // multiply by previous octave: sharper, branched crests
    prev = mix(1.0, n, 0.6);
    norm = norm + a;
    a = a * gain;
    p = OCT_ROT * p * lac;
  }
  return sum / max(norm, 1e-5) * 2.0 - 1.0;
}

fn billow(pIn: vec2f, oct: i32, lac: f32, gain: f32, seed: u32) -> f32 {
  var p = pIn;
  var a = 1.0;
  var sum = 0.0;
  var norm = 0.0;
  for (var i = 0; i < oct; i = i + 1) {
    sum = sum + a * (abs(perlin(p, seed + u32(i) * 7919u)) * 2.0 - 1.0);
    norm = norm + a;
    a = a * gain;
    p = OCT_ROT * p * lac;
  }
  return sum / max(norm, 1e-5);
}

fn warpedFbm(p: vec2f, oct: i32, lac: f32, gain: f32, amp: f32, freq: f32, seed: u32) -> f32 {
  let q = vec2f(fbm(p * freq + vec2f(0.0, 0.0), 4, 2.0, 0.5, seed + 11u),
                fbm(p * freq + vec2f(5.2, 1.3), 4, 2.0, 0.5, seed + 23u));
  let r = vec2f(fbm(p * freq + 4.0 * q + vec2f(1.7, 9.2), 3, 2.0, 0.5, seed + 37u),
                fbm(p * freq + 4.0 * q + vec2f(8.3, 2.8), 3, 2.0, 0.5, seed + 53u));
  return fbm(p + amp * r, oct, lac, gain, seed);
}

fn smoothRange(x: f32, lo: f32, hi: f32, soft: f32) -> f32 {
  let s = max(soft, 1e-4);
  return clamp(smoothstep(lo - s, lo + s, x) * (1.0 - smoothstep(hi - s, hi + s, x)), 0.0, 1.0);
}
`,t=`
struct GenU {
  res: u32, layerCount: u32, seed: u32, pad0: u32,
  worldSize: f32, strataScale: f32, strataContrast: f32, strataTilt: f32,
  layers: array<vec4f, 64>,
};
@group(0) @binding(0) var<uniform> U: GenU;
@group(0) @binding(1) var<storage, read_write> height: array<f32>;
@group(0) @binding(2) var<storage, read_write> hardness: array<f32>;
${e}

fn layerValue(li: u32, p: vec2f, h: f32) -> f32 {
  let L0 = U.layers[li * 4u + 0u];
  let L1 = U.layers[li * 4u + 1u];
  let L2 = U.layers[li * 4u + 2u];
  let L3 = U.layers[li * 4u + 3u];
  let kind = i32(L0.x);
  let seed = U.seed + u32(L0.w) * 1013u;
  let q = p * L1.x + vec2f(L2.z, L2.w);
  let oct = i32(L1.y);
  var v = 0.0;

  if (kind == 0) {                       // fBm  (rolling base terrain)
    v = fbm(q, oct, L1.z, L1.w, seed) * 0.5 + 0.5;
  } else if (kind == 1) {                // ridged  (mountain crests)
    v = ridged(q, oct, L1.z, L1.w, L3.w, seed) * 0.5 + 0.5;
  } else if (kind == 2) {                // billow  (dunes / hills)
    v = billow(q, oct, L1.z, L1.w, seed) * 0.5 + 0.5;
  } else if (kind == 3) {                // domain-warped fBm  (organic swirl)
    v = warpedFbm(q, oct, L1.z, L1.w, L2.x, L2.y, seed) * 0.5 + 0.5;
  } else if (kind == 4) {                // cellular  (mesas / plates)
    let c = cellular(q, seed);
    v = clamp(c.y * 2.0, 0.0, 1.0);
  } else if (kind == 5) {                // terrace  (strata benches)
    let steps = max(L3.w, 1.0);
    let t = h * steps;
    let f = fract(t);
    let shaped = mix(f, smoothstep(0.0, 1.0, pow(f, max(L1.x, 0.05))), 1.0);
    v = (floor(t) + shaped) / steps;
    return v;
  } else if (kind == 6) {                // curve  (gamma / canyon profile)
    v = pow(clamp(h, 0.0, 1.0), max(L1.x, 0.02));
    return v;
  } else if (kind == 7) {                // radial falloff  (island / basin)
    let d = length(p * 2.0 - vec2f(1.0)) * L1.x;
    v = clamp(1.0 - smoothstep(L3.x, max(L3.y, L3.x + 0.01), d), 0.0, 1.0);
  } else if (kind == 8) {                // tilt plane  (regional slope)
    v = clamp(dot(p - vec2f(0.5), vec2f(cos(L1.x), sin(L1.x))) + 0.5, 0.0, 1.0);
  } else if (kind == 9) {                // slope-aware noise detail
    v = fbm(q, oct, L1.z, L1.w, seed) * 0.5 + 0.5;
  }
  return v;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let res = U.res;
  if (gid.x >= res || gid.y >= res) { return; }
  let idx = gid.y * res + gid.x;
  let p = (vec2f(f32(gid.x), f32(gid.y)) + 0.5) / f32(res);

  var h = 0.0;
  for (var li = 0u; li < U.layerCount; li = li + 1u) {
    let L0 = U.layers[li * 4u + 0u];
    let L3 = U.layers[li * 4u + 3u];
    let strength = L0.z;
    if (strength == 0.0) { continue; }
    let v = layerValue(li, p, h);
    // every layer can be restricted to an altitude band of what is below it
    let mask = smoothRange(h, L3.x, L3.y, L3.z);
    let amt = strength * mask;
    let blend = i32(L0.y);
    if (blend == 0) { h = h + v * amt; }
    else if (blend == 1) { h = mix(h, max(h, v), amt); }
    else if (blend == 2) { h = mix(h, min(h, v), amt); }
    else if (blend == 3) { h = mix(h, h * v, amt); }
    else if (blend == 4) { h = mix(h, v, amt); }
    else if (blend == 5) { h = h - v * amt; }
  }
  height[idx] = clamp(h, 0.0, 1.0);

  // --- rock hardness field -----------------------------------------
  // Tilted strata + a slow lateral variation. Erosion divides by this, so
  // hard bands survive as benches and cliff lips while soft bands undercut:
  // the single biggest realism win over "noise + smooth erosion".
  let strataY = (height[idx] * 1.0 + dot(p, vec2f(U.strataTilt, U.strataTilt * 0.6))) * U.strataScale;
  let bands = sin(strataY * 6.2831853) * 0.5 + 0.5;
  let regional = fbm(p * 2.3, 4, 2.0, 0.5, U.seed + 777u) * 0.5 + 0.5;
  hardness[idx] = mix(1.0, mix(0.45, 1.55, bands) * mix(0.8, 1.2, regional), U.strataContrast);
}
`,n=`
struct ErodeU {
  res: u32, iter: u32, pad0: u32, pad1: u32,
  cell: f32, dt: f32, rain: f32, evap: f32,
  capacity: f32, dissolve: f32, deposit: f32, minSlope: f32,
  gravity: f32, pipeArea: f32, hardnessInf: f32, inertia: f32,
  talus: f32, thermalRate: f32, rainSpotScale: f32, rainSpotAmount: f32,
  seaLevel: f32, sedimentDarken: f32, pad2: f32, pad3: f32,
};
@group(0) @binding(0) var<uniform> E: ErodeU;
@group(0) @binding(1) var<storage, read_write> height: array<f32>;
@group(0) @binding(2) var<storage, read_write> water: array<f32>;
@group(0) @binding(3) var<storage, read_write> sediment: array<f32>;
@group(0) @binding(4) var<storage, read_write> sedimentTmp: array<f32>;
@group(0) @binding(5) var<storage, read_write> flux: array<vec4f>;
@group(0) @binding(6) var<storage, read_write> vel: array<vec2f>;
@group(0) @binding(7) var<storage, read_write> hardness: array<f32>;
@group(0) @binding(8) var<storage, read_write> deposited: array<f32>;
@group(0) @binding(9) var<storage, read_write> eroded: array<f32>;
@group(0) @binding(10) var<storage, read_write> delta: array<f32>;

fn ix(x: i32, y: i32) -> u32 {
  let r = i32(E.res);
  return u32(clamp(y, 0, r - 1) * r + clamp(x, 0, r - 1));
}
fn inside(x: i32, y: i32) -> bool {
  let r = i32(E.res);
  return x >= 0 && y >= 0 && x < r && y < r;
}
`,r=`
${n}
${e}
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let r = i32(E.res);
  let x = i32(gid.x); let y = i32(gid.y);
  if (x >= r || y >= r) { return; }
  let i = ix(x, y);

  // rainfall: spatially varying (orographic patches), not uniform drizzle
  let p = vec2f(f32(x), f32(y)) / f32(E.res);
  let spot = fbm(p * E.rainSpotScale, 3, 2.0, 0.5, 4242u) * 0.5 + 0.5;
  let rain = E.rain * mix(1.0, spot * 2.0, E.rainSpotAmount);
  var w = water[i] + rain * E.dt;

  let hi = height[i];
  let top = hi + w;
  var f = flux[i];
  let A = E.pipeArea; let g = E.gravity; let l = E.cell;

  let dhL = top - (height[ix(x - 1, y)] + water[ix(x - 1, y)]);
  let dhR = top - (height[ix(x + 1, y)] + water[ix(x + 1, y)]);
  let dhT = top - (height[ix(x, y - 1)] + water[ix(x, y - 1)]);
  let dhB = top - (height[ix(x, y + 1)] + water[ix(x, y + 1)]);

  var fL = max(0.0, f.x * E.inertia + E.dt * A * g * dhL / l);
  var fR = max(0.0, f.y * E.inertia + E.dt * A * g * dhR / l);
  var fT = max(0.0, f.z * E.inertia + E.dt * A * g * dhT / l);
  var fB = max(0.0, f.w * E.inertia + E.dt * A * g * dhB / l);

  // closed borders: nothing flows out of the domain
  if (x == 0) { fL = 0.0; }
  if (x == r - 1) { fR = 0.0; }
  if (y == 0) { fT = 0.0; }
  if (y == r - 1) { fB = 0.0; }

  // never drain more water than the cell holds
  let sum = fL + fR + fT + fB;
  if (sum > 0.0) {
    let k = min(1.0, w * l * l / (sum * E.dt));
    fL = fL * k; fR = fR * k; fT = fT * k; fB = fB * k;
  }
  flux[i] = vec4f(fL, fR, fT, fB);
  water[i] = w;
}
`,i=`
${n}
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let r = i32(E.res);
  let x = i32(gid.x); let y = i32(gid.y);
  if (x >= r || y >= r) { return; }
  let i = ix(x, y);
  let l = E.cell;

  let fo = flux[i];
  let inL = flux[ix(x - 1, y)].y;
  let inR = flux[ix(x + 1, y)].x;
  let inT = flux[ix(x, y - 1)].w;
  let inB = flux[ix(x, y + 1)].z;
  let dV = E.dt * ((inL + inR + inT + inB) - (fo.x + fo.y + fo.z + fo.w));

  let w0 = water[i];
  let w1 = max(0.0, w0 + dV / (l * l));
  let wMean = max(0.5 * (w0 + w1), 1e-5);

  // velocity from the net horizontal flux through the cell
  let vx = 0.5 * (inL - fo.x + fo.y - inR) / (l * wMean);
  let vy = 0.5 * (inT - fo.z + fo.w - inB) / (l * wMean);
  let v = vec2f(vx, vy);
  vel[i] = v;

  // local tilt from the terrain gradient
  let hL = height[ix(x - 1, y)]; let hR = height[ix(x + 1, y)];
  let hT = height[ix(x, y - 1)]; let hB = height[ix(x, y + 1)];
  let grad = vec2f((hR - hL) * 0.5, (hB - hT) * 0.5) / l;
  let tilt = max(E.minSlope, sin(atan(length(grad))));

  let speed = length(v);
  // Mei capacity, damped in deep standing water (lakes drop their load)
  let depthFade = clamp(1.0 - (w1 - 0.02) * 2.0, 0.25, 1.0);
  let C = E.capacity * tilt * speed * depthFade * clamp(w1 * 60.0, 0.0, 1.0);

  var h = height[i];
  var s = sediment[i];
  let hard = max(0.15, hardness[i]);

  if (C > s) {
    // soft rock cuts faster: strata turn into benches and undercut cliffs
    let amount = min((C - s) * E.dissolve / mix(1.0, hard, E.hardnessInf), 0.02);
    h = h - amount;
    s = s + amount;
    eroded[i] = eroded[i] + amount;
  } else {
    let amount = min((s - C) * E.deposit, s);
    h = h + amount;
    s = s - amount;
    deposited[i] = deposited[i] + amount;
  }

  height[i] = clamp(h, 0.0, 1.5);
  sediment[i] = s;
  water[i] = w1;
}
`,a=`
${n}
fn sampleSed(p: vec2f) -> f32 {
  let r = f32(E.res);
  let c = clamp(p, vec2f(0.0), vec2f(r - 1.001));
  let i0 = vec2i(floor(c));
  let f = fract(c);
  let s00 = sediment[ix(i0.x, i0.y)];
  let s10 = sediment[ix(i0.x + 1, i0.y)];
  let s01 = sediment[ix(i0.x, i0.y + 1)];
  let s11 = sediment[ix(i0.x + 1, i0.y + 1)];
  return mix(mix(s00, s10, f.x), mix(s01, s11, f.x), f.y);
}
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let r = i32(E.res);
  let x = i32(gid.x); let y = i32(gid.y);
  if (x >= r || y >= r) { return; }
  let i = ix(x, y);
  let v = vel[i];
  // trace back along the flow and pick up the sediment that arrives here
  let src = vec2f(f32(x), f32(y)) - v * E.dt / E.cell;
  sedimentTmp[i] = sampleSed(src);
  water[i] = max(0.0, water[i] * (1.0 - E.evap * E.dt));
}
`,o=`
${n}
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let r = u32(E.res);
  if (gid.x >= r || gid.y >= r) { return; }
  let i = gid.y * r + gid.x;
  sediment[i] = sedimentTmp[i];
}
`,s=`
${n}
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let r = i32(E.res);
  let x = i32(gid.x); let y = i32(gid.y);
  if (x >= r || y >= r) { return; }
  let i = ix(x, y);
  let h = height[i];
  // harder rock stands at a steeper angle of repose
  let talus = E.talus * mix(1.0, max(0.3, hardness[i]), E.hardnessInf) * E.cell;
  var total = 0.0;
  var maxDiff = 0.0;
  for (var oy = -1; oy <= 1; oy = oy + 1) {
    for (var ox = -1; ox <= 1; ox = ox + 1) {
      if (ox == 0 && oy == 0) { continue; }
      let d = h - height[ix(x + ox, y + oy)];
      let dist = select(1.41421, 1.0, ox == 0 || oy == 0);
      let excess = d - talus * dist;
      if (excess > 0.0) { total = total + excess; maxDiff = max(maxDiff, excess); }
    }
  }
  delta[i] = min(total, maxDiff * 2.0) * E.thermalRate;
}
`,c=`
${n}
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let r = i32(E.res);
  let x = i32(gid.x); let y = i32(gid.y);
  if (x >= r || y >= r) { return; }
  let i = ix(x, y);
  let h = height[i];
  let talus = E.talus * mix(1.0, max(0.3, hardness[i]), E.hardnessInf) * E.cell;

  var give = delta[i];
  var gain = 0.0;
  for (var oy = -1; oy <= 1; oy = oy + 1) {
    for (var ox = -1; ox <= 1; ox = ox + 1) {
      if (ox == 0 && oy == 0) { continue; }
      let j = ix(x + ox, y + oy);
      let hn = height[j];
      let dist = select(1.41421, 1.0, ox == 0 || oy == 0);
      // how much the neighbour sheds toward this (lower) cell
      let d = hn - h;
      let excess = d - talus * dist;
      if (excess > 0.0) {
        var sumN = 0.0;
        for (var ny = -1; ny <= 1; ny = ny + 1) {
          for (var nx = -1; nx <= 1; nx = nx + 1) {
            if (nx == 0 && ny == 0) { continue; }
            let dd = hn - height[ix(x + ox + nx, y + oy + ny)];
            let dist2 = select(1.41421, 1.0, nx == 0 || ny == 0);
            let e2 = dd - talus * dist2;
            if (e2 > 0.0) { sumN = sumN + e2; }
          }
        }
        if (sumN > 0.0) { gain = gain + delta[j] * (excess / sumN); }
      }
    }
  }
  height[i] = height[i] - give + gain;
  deposited[i] = deposited[i] + max(0.0, gain - give) * 0.5;
}
`,l=`
struct AnaU {
  res: u32, aoDirs: u32, aoSteps: u32, pad0: u32,
  worldSize: f32, heightScale: f32, aoRadius: f32, flowGain: f32,
  depGain: f32, eroGain: f32, seaLevel: f32, pad1: f32,
};
@group(0) @binding(0) var<uniform> A: AnaU;
@group(0) @binding(1) var<storage, read> height: array<f32>;
@group(0) @binding(2) var<storage, read> water: array<f32>;
@group(0) @binding(3) var<storage, read> deposited: array<f32>;
@group(0) @binding(4) var<storage, read> eroded: array<f32>;
@group(0) @binding(5) var<storage, read> hardness: array<f32>;
@group(0) @binding(6) var nrmAo: texture_storage_2d<rgba16float, write>;
@group(0) @binding(7) var masks: texture_storage_2d<rgba16float, write>;

fn hAt(x: i32, y: i32) -> f32 {
  let r = i32(A.res);
  return height[u32(clamp(y, 0, r - 1) * r + clamp(x, 0, r - 1))];
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let r = i32(A.res);
  let x = i32(gid.x); let y = i32(gid.y);
  if (x >= r || y >= r) { return; }
  let i = u32(y * r + x);
  let cell = A.worldSize / f32(A.res);

  let hC = hAt(x, y);
  let hL = hAt(x - 1, y); let hR = hAt(x + 1, y);
  let hT = hAt(x, y - 1); let hB = hAt(x, y + 1);

  // world-space normal (height is normalised, so scale by heightScale)
  let dx = (hR - hL) * A.heightScale * 0.5;
  let dy = (hB - hT) * A.heightScale * 0.5;
  let n = normalize(vec3f(-dx, cell, -dy));

  // concave (gullies, bowls) vs convex (ridges, lips)
  let curv = (hL + hR + hT + hB - 4.0 * hC) * A.heightScale / cell * 12.0;

  // --- horizon-scan ambient occlusion -------------------------------
  var ao = 0.0;
  let dirCount = i32(A.aoDirs);
  let stepCount = i32(A.aoSteps);
  for (var d = 0; d < dirCount; d = d + 1) {
    let ang = (f32(d) + 0.5) / f32(dirCount) * 6.2831853;
    let dir = vec2f(cos(ang), sin(ang));
    var maxSlope = 0.0;
    var t = 1.0;
    for (var s = 0; s < stepCount; s = s + 1) {
      let p = vec2f(f32(x), f32(y)) + dir * t;
      let hs = hAt(i32(p.x), i32(p.y));
      let dist = t * cell;
      let dh = (hs - hC) * A.heightScale;
      maxSlope = max(maxSlope, dh / dist);
      t = t * 1.42 + 1.0;
      if (t * cell > A.aoRadius) { break; }
    }
    // horizon angle -> visible sky fraction for this direction
    ao = ao + 1.0 / sqrt(1.0 + maxSlope * maxSlope);
  }
  ao = clamp(ao / f32(dirCount), 0.0, 1.0);
  ao = pow(ao, 1.35);

  textureStore(nrmAo, vec2i(x, y), vec4f(n * 0.5 + 0.5, ao));

  let wet = clamp(water[i] * A.flowGain, 0.0, 1.0);
  let dep = clamp(deposited[i] * A.depGain, 0.0, 1.0);
  let ero = clamp(eroded[i] * A.eroGain, 0.0, 1.0);
  textureStore(masks, vec2i(x, y), vec4f(wet, clamp(curv * 0.5 + 0.5, 0.0, 1.0), dep, ero));
}
`,u=`
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
`,d=`
${u}
${e}

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
`,f=`
${u}
${e}

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
`,p=`
${u}
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
`,m=class{device;ctx;format;res=1024;gridN=768;adapterInfo=``;buffers={};genU;eroU;anaU;renU;nrmAo;masks;sampler;msaa;depth;pipelines={};renderPipes={};bindGroups={};layouts={};canvasSize=[1,1];erosionDone=0;onError=()=>{};async init(e){if(!navigator.gpu)throw Error(`WebGPU is not available in this browser. Use Chrome/Edge 113+, or Safari 18+.`);let t=await navigator.gpu.requestAdapter({powerPreference:`high-performance`});if(!t)throw Error(`No suitable GPU adapter found.`);let n={},r=1073741824,i=t.limits;i.maxStorageBufferBindingSize>134217728&&(n.maxStorageBufferBindingSize=Math.min(i.maxStorageBufferBindingSize,r),n.maxBufferSize=Math.min(i.maxBufferSize,r));for(let e of[`maxStorageBuffersInVertexStage`,`maxStorageBuffersPerShaderStage`])typeof i[e]==`number`&&i[e]>0&&(n[e]=Math.min(i[e],8));this.device=await t.requestDevice({requiredLimits:n}),this.device.lost.then(e=>{console.error(`WebGPU device lost:`,e.message),this.onError(`GPU device lost`,e.message||`The GPU process restarted.`)}),this.device.addEventListener(`uncapturederror`,e=>{let t=e.error;console.error(t),this.onError(`GPU validation error`,String(t.message).replace(/\n/g,`<br>`))});let a=t.info;this.adapterInfo=a?`${a.vendor||`?`} ${a.architecture||``} ${a.description||``}`.trim():`GPU`,this.ctx=e.getContext(`webgpu`),this.format=navigator.gpu.getPreferredCanvasFormat(),this.ctx.configure({device:this.device,format:this.format,alphaMode:`opaque`}),this.sampler=this.device.createSampler({magFilter:`linear`,minFilter:`linear`,addressModeU:`clamp-to-edge`,addressModeV:`clamp-to-edge`}),this.genU=this.device.createBuffer({size:1072,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.eroU=this.device.createBuffer({size:96,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.anaU=this.device.createBuffer({size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.renU=this.device.createBuffer({size:1344,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.buildPipelines(),this.allocate(this.res)}storage(e,t=0){return this.device.createBuffer({size:e,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC|t})}allocate(e){this.res=e;for(let e of Object.values(this.buffers))e.destroy();this.buffers={};let t=e*e;for(let e of[`height`,`water`,`sediment`,`sedimentTmp`,`hardness`,`deposited`,`eroded`,`delta`])this.buffers[e]=this.storage(t*4);this.buffers.flux=this.storage(t*16),this.buffers.vel=this.storage(t*8),this.nrmAo?.destroy(),this.masks?.destroy();let n={size:[e,e],format:`rgba16float`,usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST};this.nrmAo=this.device.createTexture(n),this.masks=this.device.createTexture(n),this.buildBindGroups(),this.erosionDone=0}module(e,t){let n=this.device.createShaderModule({code:e,label:t});return n.getCompilationInfo().then(n=>{let r=n.messages.filter(e=>e.type===`error`);if(!r.length)return;let i=e.split(`
`),a=r.slice(0,4).map(e=>`<b>${t}:${e.lineNum}</b> ${e.message}<br><code style="color:#8b97a5">${(i[e.lineNum-1]??``).trim()}</code>`).join(`<br><br>`);this.onError(`WGSL compile error`,a),console.error(t,r)}),n}buildPipelines(){let e=this.device,n=(t,n)=>e.createComputePipeline({layout:e.createPipelineLayout({bindGroupLayouts:[n]}),compute:{module:this.module(t,`compute`),entryPoint:`main`}}),u=GPUShaderStage.COMPUTE;this.layouts.gen=e.createBindGroupLayout({entries:[{binding:0,visibility:u,buffer:{type:`uniform`}},{binding:1,visibility:u,buffer:{type:`storage`}},{binding:2,visibility:u,buffer:{type:`storage`}}]}),this.layouts.erode=e.createBindGroupLayout({entries:[{binding:0,visibility:u,buffer:{type:`uniform`}},...Array.from({length:10},(e,t)=>({binding:t+1,visibility:u,buffer:{type:`storage`}}))]}),this.layouts.analysis=e.createBindGroupLayout({entries:[{binding:0,visibility:u,buffer:{type:`uniform`}},...Array.from({length:5},(e,t)=>({binding:t+1,visibility:u,buffer:{type:`read-only-storage`}})),{binding:6,visibility:u,storageTexture:{access:`write-only`,format:`rgba16float`}},{binding:7,visibility:u,storageTexture:{access:`write-only`,format:`rgba16float`}}]});let m=GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT;this.layouts.render=e.createBindGroupLayout({entries:[{binding:0,visibility:m,buffer:{type:`uniform`}},{binding:1,visibility:m,buffer:{type:`read-only-storage`}},{binding:2,visibility:m,buffer:{type:`read-only-storage`}},{binding:3,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:`float`}},{binding:4,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:`float`}},{binding:5,visibility:GPUShaderStage.FRAGMENT,sampler:{type:`filtering`}}]}),this.pipelines.gen=n(t,this.layouts.gen),this.pipelines.flux=n(r,this.layouts.erode),this.pipelines.erode=n(i,this.layouts.erode),this.pipelines.transport=n(a,this.layouts.erode),this.pipelines.commit=n(o,this.layouts.erode),this.pipelines.thermalCalc=n(s,this.layouts.erode),this.pipelines.thermalApply=n(c,this.layouts.erode),this.pipelines.analysis=n(l,this.layouts.analysis);let h=e.createPipelineLayout({bindGroupLayouts:[this.layouts.render]}),g=(t,n)=>e.createRenderPipeline({layout:h,vertex:{module:this.module(t,`render-vs`),entryPoint:`vs`},fragment:{module:this.module(t,`render-fs`),entryPoint:`fs`,targets:[{format:this.format,blend:n.blend?{color:{srcFactor:`src-alpha`,dstFactor:`one-minus-src-alpha`},alpha:{srcFactor:`one`,dstFactor:`one-minus-src-alpha`}}:void 0}]},primitive:{topology:n.topology??`triangle-list`,cullMode:`none`},depthStencil:{format:`depth24plus`,depthWriteEnabled:n.depthWrite,depthCompare:n.depthCompare},multisample:{count:4}});this.renderPipes.sky=g(p,{depthWrite:!1,depthCompare:`always`}),this.renderPipes.terrain=g(d,{depthWrite:!0,depthCompare:`less`}),this.renderPipes.terrainWire=g(d,{depthWrite:!0,depthCompare:`less`,topology:`line-list`}),this.renderPipes.water=g(f,{blend:!0,depthWrite:!1,depthCompare:`less`})}buildBindGroups(){let e=this.device,t=e=>({buffer:this.buffers[e]});this.bindGroups.gen=e.createBindGroup({layout:this.layouts.gen,entries:[{binding:0,resource:{buffer:this.genU}},{binding:1,resource:t(`height`)},{binding:2,resource:t(`hardness`)}]}),this.bindGroups.erode=e.createBindGroup({layout:this.layouts.erode,entries:[{binding:0,resource:{buffer:this.eroU}},{binding:1,resource:t(`height`)},{binding:2,resource:t(`water`)},{binding:3,resource:t(`sediment`)},{binding:4,resource:t(`sedimentTmp`)},{binding:5,resource:t(`flux`)},{binding:6,resource:t(`vel`)},{binding:7,resource:t(`hardness`)},{binding:8,resource:t(`deposited`)},{binding:9,resource:t(`eroded`)},{binding:10,resource:t(`delta`)}]}),this.bindGroups.analysis=e.createBindGroup({layout:this.layouts.analysis,entries:[{binding:0,resource:{buffer:this.anaU}},{binding:1,resource:t(`height`)},{binding:2,resource:t(`water`)},{binding:3,resource:t(`deposited`)},{binding:4,resource:t(`eroded`)},{binding:5,resource:t(`hardness`)},{binding:6,resource:this.nrmAo.createView()},{binding:7,resource:this.masks.createView()}]}),this.bindGroups.render=e.createBindGroup({layout:this.layouts.render,entries:[{binding:0,resource:{buffer:this.renU}},{binding:1,resource:t(`height`)},{binding:2,resource:t(`water`)},{binding:3,resource:this.nrmAo.createView()},{binding:4,resource:this.masks.createView()},{binding:5,resource:this.sampler}]})}dispatch(e,t,n){let r=e.beginComputePass();r.setPipeline(t),r.setBindGroup(0,n);let i=Math.ceil(this.res/8);r.dispatchWorkgroups(i,i),r.end()}generate(e,t,n){let r=new ArrayBuffer(32),i=new Uint32Array(r),a=new Float32Array(r);i[0]=this.res,i[1]=n,i[2]=e.seed>>>0,i[3]=0,a[4]=e.worldSize,a[5]=e.strataScale,a[6]=e.strataContrast,a[7]=e.strataTilt,this.device.queue.writeBuffer(this.genU,0,r),this.device.queue.writeBuffer(this.genU,32,t);let o=new Float32Array(this.res*this.res);for(let e of[`water`,`sediment`,`sedimentTmp`,`deposited`,`eroded`,`delta`])this.device.queue.writeBuffer(this.buffers[e],0,o);this.device.queue.writeBuffer(this.buffers.flux,0,new Float32Array(this.res*this.res*4)),this.device.queue.writeBuffer(this.buffers.vel,0,new Float32Array(this.res*this.res*2));let s=this.device.createCommandEncoder();this.dispatch(s,this.pipelines.gen,this.bindGroups.gen),this.device.queue.submit([s.finish()]),this.erosionDone=0}writeErosionUniforms(e,t,n){let r=new ArrayBuffer(96),i=new Uint32Array(r),a=new Float32Array(r);i[0]=this.res,i[1]=n,i[2]=0,i[3]=0,a[4]=t.worldSize/this.res/t.heightScale,a[5]=e.dt,a[6]=e.rain,a[7]=e.evaporation,a[8]=e.capacity,a[9]=e.dissolve,a[10]=e.deposit,a[11]=e.minSlope,a[12]=e.gravity,a[13]=e.pipeArea,a[14]=e.hardnessInfluence,a[15]=e.inertia,a[16]=e.talus,a[17]=e.thermalRate,a[18]=e.rainSpotScale,a[19]=e.rainSpotAmount,a[20]=t.seaLevel,a[21]=0,a[22]=0,a[23]=0,this.device.queue.writeBuffer(this.eroU,0,r)}erode(e,t,n){let r=this.device.createCommandEncoder();for(let i=0;i<n;i++)this.writeErosionUniforms(e,t,this.erosionDone+i),this.dispatch(r,this.pipelines.flux,this.bindGroups.erode),this.dispatch(r,this.pipelines.erode,this.bindGroups.erode),this.dispatch(r,this.pipelines.transport,this.bindGroups.erode),this.dispatch(r,this.pipelines.commit,this.bindGroups.erode),e.thermalEvery>0&&(this.erosionDone+i)%e.thermalEvery===0&&(this.dispatch(r,this.pipelines.thermalCalc,this.bindGroups.erode),this.dispatch(r,this.pipelines.thermalApply,this.bindGroups.erode));this.device.queue.submit([r.finish()]),this.erosionDone+=n}analyze(e){let t=new ArrayBuffer(48),n=new Uint32Array(t),r=new Float32Array(t);n[0]=this.res,n[1]=e.aoDirs,n[2]=e.aoSteps,n[3]=0,r[4]=e.worldSize,r[5]=e.heightScale,r[6]=e.aoRadius,r[7]=e.flowGain,r[8]=e.depGain,r[9]=e.eroGain,r[10]=e.seaLevel,r[11]=0,this.device.queue.writeBuffer(this.anaU,0,t);let i=this.device.createCommandEncoder();this.dispatch(i,this.pipelines.analysis,this.bindGroups.analysis),this.device.queue.submit([i.finish()])}resize(e,t){(e!==this.canvasSize[0]||t!==this.canvasSize[1])&&(this.canvasSize=[e,t],this.msaa?.destroy(),this.depth?.destroy(),this.msaa=this.device.createTexture({size:[e,t],sampleCount:4,format:this.format,usage:GPUTextureUsage.RENDER_ATTACHMENT}),this.depth=this.device.createTexture({size:[e,t],sampleCount:4,format:`depth24plus`,usage:GPUTextureUsage.RENDER_ATTACHMENT}))}render(e,t,n,r,i,a,o,s){let c=new Float32Array(48);c.set(e,0);let l=16;c.set([t[0],t[1],t[2],1],l),l+=4;let u=i.sunAzimuth*Math.PI/180,d=i.sunElevation*Math.PI/180,f=[Math.cos(d)*Math.cos(u),Math.sin(d),Math.cos(d)*Math.sin(u)];c.set([...f,i.sunIntensity],l),l+=4,c.set([...i.sunColor,1],l),l+=4,c.set([...i.zenith,i.ambient],l),l+=4,c.set([...i.horizon,i.bounce],l),l+=4,c.set([r.worldSize,r.heightScale,this.res,this.gridN],l),l+=4,c.set([s,i.shadowSteps,r.seaLevel,i.exposure],l),l+=4,c.set([i.shadingMode,o,i.detail,i.fog],l),this.device.queue.writeBuffer(this.renU,0,c),this.device.queue.writeBuffer(this.renU,192,a),this.device.queue.writeBuffer(this.renU,1216,new Float32Array(n));let p=this.device.createCommandEncoder(),m=p.beginRenderPass({colorAttachments:[{view:this.msaa.createView(),resolveTarget:this.ctx.getCurrentTexture().createView(),clearValue:{r:.02,g:.03,b:.04,a:1},loadOp:`clear`,storeOp:`store`}],depthStencilAttachment:{view:this.depth.createView(),depthClearValue:1,depthLoadOp:`clear`,depthStoreOp:`store`}});m.setBindGroup(0,this.bindGroups.render),m.setPipeline(this.renderPipes.sky),m.draw(3),m.setPipeline(i.wireframe?this.renderPipes.terrainWire:this.renderPipes.terrain);let h=(this.gridN-1)*(this.gridN-1);m.draw(h*6),i.showWater&&(m.setPipeline(this.renderPipes.water),m.draw(h*6)),m.end(),this.device.queue.submit([p.finish()])}async readBuffer(e){let t=this.res*this.res*4,n=this.device.createBuffer({size:t,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),r=this.device.createCommandEncoder();r.copyBufferToBuffer(this.buffers[e],0,n,0,t),this.device.queue.submit([r.finish()]),await n.mapAsync(GPUMapMode.READ);let i=new Float32Array(n.getMappedRange().slice(0));return n.unmap(),n.destroy(),i}},h=[`fBm`,`Ridged`,`Billow`,`Warped fBm`,`Cellular`,`Terrace`,`Curve`,`Radial`,`Tilt`,`Detail`],g=[`Add`,`Max`,`Min`,`Multiply`,`Replace`,`Subtract`],_=1,v=()=>_++;function y(e={}){return{id:v(),name:`Noise`,type:0,blend:0,enabled:!0,strength:.5,freq:3,octaves:8,lacunarity:2.02,gain:.5,warpAmp:.4,warpFreq:1.2,offX:0,offY:0,maskLo:-.1,maskHi:1.1,maskSoft:.08,extra:.5,seedOffset:0,...e}}function b(e={}){return{id:v(),name:`Material`,enabled:!0,strength:1,albedo:[.34,.31,.28],albedo2:[.26,.24,.22],rough:.9,altLo:-.1,altHi:1.1,slopeLo:-.1,slopeHi:1.1,soft:.08,slopeSoft:.08,wetW:0,depW:0,eroW:0,aoW:0,curvW:0,noiseScale:.02,noiseAmt:0,detailScale:.01,blendSharp:1,sparkle:0,...e}}function ee(e){let t=e.filter(e=>e.enabled).slice(0,16),n=new Float32Array(256);return t.forEach((e,t)=>{let r=t*16;n[r+0]=e.type,n[r+1]=e.blend,n[r+2]=e.strength,n[r+3]=e.seedOffset,n[r+4]=e.freq,n[r+5]=e.octaves,n[r+6]=e.lacunarity,n[r+7]=e.gain,n[r+8]=e.warpAmp,n[r+9]=e.warpFreq,n[r+10]=e.offX,n[r+11]=e.offY,n[r+12]=e.maskLo,n[r+13]=e.maskHi,n[r+14]=e.maskSoft,n[r+15]=e.extra}),{data:n,count:t.length}}function te(e){let t=e.filter(e=>e.enabled).slice(0,10),n=new Float32Array(288);return t.forEach((e,t)=>{let r=t*24;n[r+0]=e.albedo[0],n[r+1]=e.albedo[1],n[r+2]=e.albedo[2],n[r+3]=e.rough,n[r+4]=e.altLo,n[r+5]=e.altHi,n[r+6]=e.slopeLo,n[r+7]=e.slopeHi,n[r+8]=e.soft,n[r+9]=e.wetW,n[r+10]=e.depW,n[r+11]=e.noiseScale,n[r+12]=e.noiseAmt,n[r+13]=e.curvW,n[r+14]=e.aoW,n[r+15]=e.strength,n[r+16]=e.albedo2[0],n[r+17]=e.albedo2[1],n[r+18]=e.albedo2[2],n[r+19]=e.detailScale,n[r+20]=e.slopeSoft,n[r+21]=e.blendSharp,n[r+22]=e.eroW,n[r+23]=e.sparkle}),{data:n,count:t.length}}var x=()=>({seed:1337,worldSize:8e3,heightScale:1600,strataScale:9,strataContrast:.65,strataTilt:.25,seaLevel:.12,aoDirs:12,aoSteps:12,aoRadius:900,flowGain:90,depGain:26,eroGain:30}),S=()=>({iterations:260,rain:.0115,evaporation:.022,capacity:.95,dissolve:.35,deposit:.35,minSlope:.018,gravity:9.81,pipeArea:1,inertia:.92,dt:.085,hardnessInfluence:.85,talus:.72,thermalRate:.28,thermalEvery:3,rainSpotScale:2.6,rainSpotAmount:.55}),C=()=>({sunAzimuth:128,sunElevation:26,sunIntensity:4.1,sunColor:[1,.86,.68],zenith:[.22,.38,.68],horizon:[.62,.68,.76],ambient:.85,bounce:.22,exposure:1.05,fog:1,shadowSteps:48,detail:.35,shadingMode:0,showWater:!0,wireframe:!1}),w=e=>b(e),T=[{name:`Alpine Massif`,gen:[y({name:`Continental base`,type:0,blend:4,strength:1,freq:1.1,octaves:6,gain:.52}),y({name:`Ranges`,type:1,blend:0,strength:.72,freq:2.2,octaves:9,gain:.5,extra:.55}),y({name:`Warped relief`,type:3,blend:0,strength:.22,freq:1.6,octaves:6,warpAmp:.55,warpFreq:1.1}),y({name:`Peak sharpening`,type:6,blend:4,strength:.75,freq:1.45,maskLo:.35,maskHi:1.2,maskSoft:.2}),y({name:`Ridge detail`,type:1,blend:0,strength:.1,freq:9,octaves:6,extra:.8,maskLo:.3,maskHi:1.2,maskSoft:.22})],mats:[w({name:`Bedrock`,albedo:[.27,.26,.25],albedo2:[.19,.18,.18],rough:.92,detailScale:.004,noiseAmt:0}),w({name:`Cliff granite`,albedo:[.33,.31,.3],albedo2:[.22,.21,.21],rough:.85,slopeLo:.42,slopeHi:1.2,slopeSoft:.12,eroW:.35,detailScale:.012}),w({name:`Scree`,albedo:[.38,.35,.31],albedo2:[.3,.28,.25],rough:.95,slopeLo:.18,slopeHi:.52,slopeSoft:.1,depW:.55,curvW:.4,noiseScale:.05,noiseAmt:.22}),w({name:`Alpine turf`,albedo:[.12,.17,.08],albedo2:[.17,.21,.1],rough:.95,altLo:.12,altHi:.52,soft:.1,slopeLo:-.1,slopeHi:.3,slopeSoft:.1,curvW:.3,noiseScale:.012,noiseAmt:.25}),w({name:`Valley sediment`,albedo:[.42,.37,.3],albedo2:[.33,.29,.24],rough:.9,slopeLo:-.1,slopeHi:.18,slopeSoft:.07,depW:.9,curvW:.5}),w({name:`Snow`,albedo:[.92,.94,.98],albedo2:[.82,.86,.95],rough:.32,altLo:.58,altHi:1.2,soft:.12,slopeLo:-.1,slopeHi:.46,slopeSoft:.14,curvW:.35,sparkle:.5,detailScale:.02})]},{name:`Desert Mesas`,gen:[y({name:`Plain`,type:0,blend:4,strength:1,freq:.9,octaves:5,gain:.45}),y({name:`Plateaus`,type:4,blend:0,strength:.55,freq:2.6}),y({name:`Mesa benches`,type:5,blend:4,strength:.85,freq:.7,extra:9}),y({name:`Wind detail`,type:2,blend:0,strength:.06,freq:12,octaves:5})],mats:[w({name:`Red bed`,albedo:[.42,.21,.12],albedo2:[.33,.16,.09],rough:.95,detailScale:.006}),w({name:`Buff strata`,albedo:[.56,.42,.26],albedo2:[.47,.34,.2],rough:.92,eroW:.5,slopeLo:.3,slopeHi:1.2,slopeSoft:.12,detailScale:.03}),w({name:`Caprock`,albedo:[.3,.26,.22],albedo2:[.24,.2,.17],rough:.88,slopeLo:-.1,slopeHi:.2,slopeSoft:.06,altLo:.45,altHi:1.2,soft:.1}),w({name:`Dune sand`,albedo:[.72,.58,.36],albedo2:[.62,.49,.3],rough:.85,slopeLo:-.1,slopeHi:.22,slopeSoft:.08,depW:.85,curvW:.5,sparkle:.12}),w({name:`Wash gravel`,albedo:[.5,.44,.34],albedo2:[.4,.35,.28],rough:.93,wetW:.6,depW:.4})],world:{heightScale:1100,strataScale:16,strataContrast:.9,seaLevel:.02},erosion:{rain:.006,capacity:.75,talus:1.15,thermalRate:.22,iterations:200},render:{sunAzimuth:58,sunElevation:19,sunColor:[1,.78,.55],horizon:[.76,.66,.55],zenith:[.28,.44,.7]}},{name:`Coastal Fjords`,gen:[y({name:`Shelf`,type:0,blend:4,strength:1,freq:1.3,octaves:7,gain:.55}),y({name:`Coast ranges`,type:1,blend:0,strength:.6,freq:2.8,octaves:9,extra:.6}),y({name:`Inlets`,type:3,blend:5,strength:.3,freq:1.5,octaves:5,warpAmp:.9,warpFreq:.8}),y({name:`Island falloff`,type:7,blend:3,strength:.9,freq:1,maskLo:.55,maskHi:1.25})],mats:[w({name:`Wet bedrock`,albedo:[.2,.21,.21],albedo2:[.14,.15,.16],rough:.7,detailScale:.008}),w({name:`Sea cliff`,albedo:[.3,.3,.31],albedo2:[.21,.22,.23],rough:.8,slopeLo:.4,slopeHi:1.2,slopeSoft:.1,eroW:.4}),w({name:`Moss`,albedo:[.1,.16,.08],albedo2:[.14,.2,.1],rough:.96,altLo:.14,altHi:.6,soft:.12,slopeLo:-.1,slopeHi:.34,slopeSoft:.1,curvW:.35,noiseScale:.01,noiseAmt:.3}),w({name:`Shore sand`,albedo:[.56,.52,.44],albedo2:[.46,.43,.36],rough:.88,altLo:.1,altHi:.17,soft:.03,depW:.5}),w({name:`Snowline`,albedo:[.9,.93,.97],albedo2:[.8,.85,.93],rough:.35,altLo:.66,altHi:1.2,soft:.1,slopeLo:-.1,slopeHi:.42,slopeSoft:.12,sparkle:.45})],world:{seaLevel:.17,heightScale:1500,worldSize:9e3},erosion:{rain:.016,evaporation:.016,iterations:300},render:{sunAzimuth:210,sunElevation:15,sunColor:[1,.8,.62],zenith:[.2,.33,.62],horizon:[.7,.74,.8],fog:1.6}},{name:`Volcanic Badlands`,gen:[y({name:`Shield`,type:0,blend:4,strength:1,freq:.8,octaves:6,gain:.5}),y({name:`Cone`,type:7,blend:0,strength:.75,freq:1,maskLo:0,maskHi:1.2}),y({name:`Flows`,type:3,blend:0,strength:.25,freq:3.2,octaves:7,warpAmp:.7,warpFreq:1.6}),y({name:`Gullies`,type:1,blend:5,strength:.14,freq:10,octaves:6,extra:.9,maskLo:.2,maskHi:.95,maskSoft:.2})],mats:[w({name:`Basalt`,albedo:[.1,.095,.1],albedo2:[.07,.07,.075],rough:.78,detailScale:.01}),w({name:`Scoria`,albedo:[.26,.12,.09],albedo2:[.18,.09,.07],rough:.95,slopeLo:.25,slopeHi:1.2,slopeSoft:.12,eroW:.45}),w({name:`Ash drift`,albedo:[.34,.32,.31],albedo2:[.27,.26,.26],rough:.97,depW:.8,curvW:.5,slopeLo:-.1,slopeHi:.3,slopeSoft:.1}),w({name:`Sulphur`,albedo:[.62,.55,.16],albedo2:[.5,.45,.14],rough:.8,wetW:.7,noiseScale:.03,noiseAmt:.35,strength:.7})],world:{heightScale:1800,strataScale:6,strataContrast:.4,seaLevel:.03},erosion:{rain:.013,dissolve:.45,talus:.85,iterations:240},render:{sunAzimuth:300,sunElevation:12,sunColor:[1,.72,.5],zenith:[.18,.22,.34],horizon:[.5,.42,.4],exposure:1.15}}],E=[{key:`type`,label:`Operator`,type:`select`,options:h},{key:`blend`,label:`Blend`,type:`select`,options:g},{key:`strength`,label:`Strength`,min:0,max:2,step:.005},{key:`freq`,label:`Scale`,min:.05,max:24,step:.01},{key:`octaves`,label:`Octaves`,min:1,max:12,step:1},{key:`lacunarity`,label:`Lacunarity`,min:1.2,max:3.2,step:.01},{key:`gain`,label:`Gain`,min:.2,max:.8,step:.005},{key:`extra`,label:`Sharpness / Steps`,min:0,max:16,step:.05},{key:`warpAmp`,label:`Warp amount`,min:0,max:2,step:.01},{key:`warpFreq`,label:`Warp scale`,min:.1,max:6,step:.01},{key:`offX`,label:`Offset X`,min:-20,max:20,step:.05},{key:`offY`,label:`Offset Y`,min:-20,max:20,step:.05},{key:`maskLo`,label:`Mask from`,min:-.1,max:1.1,step:.005},{key:`maskHi`,label:`Mask to`,min:-.1,max:1.2,step:.005},{key:`maskSoft`,label:`Mask falloff`,min:.001,max:.4,step:.001},{key:`seedOffset`,label:`Seed offset`,min:0,max:64,step:1}],D=[{key:`albedo`,label:`Albedo A`,type:`color`},{key:`albedo2`,label:`Albedo B`,type:`color`},{key:`rough`,label:`Roughness`,min:.02,max:1,step:.005},{key:`strength`,label:`Coverage`,min:0,max:1,step:.005},{key:`altLo`,label:`Altitude from`,min:-.1,max:1.1,step:.005},{key:`altHi`,label:`Altitude to`,min:-.1,max:1.2,step:.005},{key:`soft`,label:`Altitude falloff`,min:.002,max:.4,step:.002},{key:`slopeLo`,label:`Slope from`,min:-.1,max:1.1,step:.005},{key:`slopeHi`,label:`Slope to`,min:-.1,max:1.2,step:.005},{key:`slopeSoft`,label:`Slope falloff`,min:.002,max:.4,step:.002},{key:`curvW`,label:`Concavity (−convex)`,min:-1,max:1,step:.01},{key:`wetW`,label:`Flow / wetness`,min:0,max:1,step:.01},{key:`depW`,label:`Sediment`,min:0,max:1,step:.01},{key:`eroW`,label:`Scoured rock`,min:0,max:1,step:.01},{key:`aoW`,label:`Openness`,min:0,max:1,step:.01},{key:`noiseScale`,label:`Breakup scale`,min:.001,max:.2,step:.001},{key:`noiseAmt`,label:`Breakup amount`,min:0,max:.5,step:.005},{key:`detailScale`,label:`Macro variation`,min:5e-4,max:.08,step:5e-4},{key:`blendSharp`,label:`Blend sharpness`,min:.1,max:4,step:.02},{key:`sparkle`,label:`Glitter`,min:0,max:1,step:.01}],O=e=>document.querySelector(e),k=e=>`#`+e.map(e=>Math.round(Math.min(1,Math.max(0,e))**(1/2.2)*255).toString(16).padStart(2,`0`)).join(``),A=e=>{let t=parseInt(e.slice(1),16);return[(t>>16&255)/255,(t>>8&255)/255,(t&255)/255].map(e=>e**2.2)},j=class{gen;mats;world;erosion;render;hooks;stack=`gen`;selGen=0;selMat=0;openGroups=new Set([`layer`,`erosion`]);constructor(e,t,n,r,i,a){this.gen=e,this.mats=t,this.world=n,this.erosion=r,this.render=i,this.hooks=a,O(`.tabs`).addEventListener(`click`,e=>{let t=e.target.closest(`.tab`);t&&(document.querySelectorAll(`.tab`).forEach(e=>e.classList.remove(`on`)),t.classList.add(`on`),this.stack=t.dataset.stack,this.refresh())}),O(`#addLayer`).addEventListener(`click`,()=>this.add()),O(`#dupLayer`).addEventListener(`click`,()=>this.duplicate()),O(`#delLayer`).addEventListener(`click`,()=>this.remove()),O(`#upLayer`).addEventListener(`click`,()=>this.move(-1)),O(`#downLayer`).addEventListener(`click`,()=>this.move(1))}list(){return this.stack===`gen`?this.gen:this.mats}sel(){return this.stack===`gen`?this.selGen:this.selMat}setSel(e){this.stack===`gen`?this.selGen=e:this.selMat=e}changed(){this.stack===`gen`?this.hooks.rebuild():this.hooks.repaint()}add(){this.stack===`gen`?this.gen.splice(this.selGen+1,0,y({name:`Ridged`,type:1,strength:.2})):this.mats.splice(this.selMat+1,0,b({name:`Material`})),this.setSel(this.sel()+1),this.refresh(),this.changed()}duplicate(){let e=this.list()[this.sel()];if(!e)return;let t={...e,id:Math.random(),name:e.name+` copy`};this.list().splice(this.sel()+1,0,t),this.setSel(this.sel()+1),this.refresh(),this.changed()}remove(){this.list().length<=1||(this.list().splice(this.sel(),1),this.setSel(Math.max(0,this.sel()-1)),this.refresh(),this.changed())}move(e){let t=this.sel(),n=t+e,r=this.list();n<0||n>=r.length||([r[t],r[n]]=[r[n],r[t]],this.setSel(n),this.refresh(),this.changed())}refresh(){let e=O(`#stack`);e.innerHTML=``,O(`#stackTitle`).textContent=this.stack===`gen`?`Terrain layers (${this.gen.length})`:`Material layers (${this.mats.length})`;let t=this.list();t.forEach((n,r)=>{let i=document.createElement(`div`);i.className=`layer`+(r===this.sel()?` sel`:``)+(n.enabled?``:` off`),i.draggable=!0;let a=this.stack===`gen`?`${h[n.type]} · ${g[n.blend]}`:`${Math.round(n.strength*100)}%`,o=this.stack===`mat`?`<span class="sw" style="background:${k(n.albedo)}"></span>`:``;i.innerHTML=`<span class="hnd">⠿</span>
        <span class="eye ${n.enabled?`on`:``}">${n.enabled?`●`:`○`}</span>
        ${o}<span class="nm">${n.name}</span><span class="kind">${a}</span>`,i.addEventListener(`click`,e=>{if(e.target.classList.contains(`eye`)){n.enabled=!n.enabled,this.refresh(),this.changed();return}this.setSel(r),this.refresh()}),i.addEventListener(`dblclick`,()=>{let e=prompt(`Layer name`,n.name);e&&(n.name=e,this.refresh())}),i.addEventListener(`dragstart`,()=>{i.classList.add(`drag`),e.dataset.from=String(r)}),i.addEventListener(`dragend`,()=>i.classList.remove(`drag`)),i.addEventListener(`dragover`,e=>e.preventDefault()),i.addEventListener(`drop`,n=>{n.preventDefault();let i=Number(e.dataset.from);if(Number.isNaN(i)||i===r)return;let[a]=t.splice(i,1);t.splice(r,0,a),this.setSel(r),this.refresh(),this.changed()}),e.appendChild(i)}),this.buildInspector()}group(e,t,n,r){let i=document.createElement(`div`);i.className=`group`+(this.openGroups.has(t)?``:` closed`);let a=document.createElement(`div`);a.className=`gh`,a.innerHTML=`<span class="chev">▼</span>${e}`,a.addEventListener(`click`,()=>{i.classList.toggle(`closed`),i.classList.contains(`closed`)?this.openGroups.delete(t):this.openGroups.add(t)});let o=document.createElement(`div`);if(o.className=`gb`,o.appendChild(n),r){let e=document.createElement(`div`);e.className=`hint`,e.textContent=r,o.appendChild(e)}return i.append(a,o),i}fields(e,t,n){let r=document.createDocumentFragment();for(let i of t){let t=document.createElement(`div`);t.className=`fld`+(i.type===`color`||i.type===`select`?` wide`:``);let a=document.createElement(`label`);if(a.textContent=i.label,a.title=i.label,t.appendChild(a),i.type===`select`){let r=document.createElement(`select`);(i.options??[]).forEach((e,t)=>{let n=document.createElement(`option`);n.value=String(t),n.textContent=e,r.appendChild(n)}),r.value=String(e[i.key]),r.addEventListener(`change`,()=>{e[i.key]=Number(r.value),n(),this.refresh()}),t.appendChild(r)}else if(i.type===`color`){let r=document.createElement(`input`);r.type=`color`,r.value=k(e[i.key]),r.addEventListener(`input`,()=>{e[i.key]=A(r.value),n()}),t.appendChild(r)}else{let r=document.createElement(`input`);r.type=`range`,r.min=String(i.min??0),r.max=String(i.max??1),r.step=String(i.step??.01),r.value=String(e[i.key]);let a=document.createElement(`input`);a.className=`val`,a.type=`text`;let o=e=>Math.abs(e)>=100?e.toFixed(0):Math.abs(e)>=10?e.toFixed(1):e.toFixed(3);a.value=o(Number(e[i.key])),r.addEventListener(`input`,()=>{e[i.key]=Number(r.value),a.value=o(Number(r.value)),n()}),a.addEventListener(`change`,()=>{let t=Number(a.value);Number.isNaN(t)||(e[i.key]=t,r.value=String(t),n())}),t.append(r,a)}r.appendChild(t)}let i=document.createElement(`div`);return i.appendChild(r),i}buildInspector(){let e=O(`#inspector`);e.innerHTML=``;let t=this.list()[this.sel()];if(t){let n=this.stack===`gen`,r=n?E:D,i=this.fields(t,r,()=>{n?this.hooks.rebuild():this.hooks.repaint()});e.appendChild(this.group(`${n?`Layer`:`Material`} · ${t.name}`,`layer`,i,n?`Operators evaluate top to bottom. “Mask from/to” restricts a layer to an altitude band of the result below it — that is how you keep ridges off the plains.`:`Materials composite top to bottom. Rules are multiplied: altitude × slope × concavity × flow × sediment × scour × openness × breakup.`))}e.appendChild(this.group(`World`,`world`,this.fields(this.world,[{key:`worldSize`,label:`Terrain size (m)`,min:1e3,max:24e3,step:100},{key:`heightScale`,label:`Height (m)`,min:100,max:4e3,step:10},{key:`seaLevel`,label:`Sea level`,min:0,max:.6,step:.002},{key:`strataScale`,label:`Strata frequency`,min:1,max:40,step:.5},{key:`strataContrast`,label:`Strata hardness`,min:0,max:1,step:.01},{key:`strataTilt`,label:`Strata tilt`,min:-1,max:1,step:.01}],()=>this.hooks.rebuild()),`Hard and soft bands make cliffs undercut and bench instead of melting into smooth cones.`)),e.appendChild(this.group(`Erosion`,`erosion`,this.fields(this.erosion,[{key:`iterations`,label:`Target iterations`,min:0,max:2e3,step:10},{key:`rain`,label:`Rainfall`,min:0,max:.05,step:5e-4},{key:`rainSpotAmount`,label:`Rain patchiness`,min:0,max:1,step:.01},{key:`evaporation`,label:`Evaporation`,min:.002,max:.2,step:.001},{key:`capacity`,label:`Carry capacity`,min:.05,max:3,step:.01},{key:`dissolve`,label:`Dissolve rate`,min:.01,max:1.5,step:.01},{key:`deposit`,label:`Deposit rate`,min:.01,max:1.5,step:.01},{key:`minSlope`,label:`Min slope`,min:.001,max:.12,step:.001},{key:`inertia`,label:`Flow inertia`,min:.5,max:.995,step:.005},{key:`dt`,label:`Time step`,min:.01,max:.2,step:.005},{key:`hardnessInfluence`,label:`Strata influence`,min:0,max:1,step:.01},{key:`talus`,label:`Talus angle`,min:.05,max:2.5,step:.01},{key:`thermalRate`,label:`Slump rate`,min:0,max:1,step:.01},{key:`thermalEvery`,label:`Slump interval`,min:1,max:20,step:1}],()=>this.hooks.erosionParams()),`Pipe-model shallow water: flux → velocity → capacity → scour/deposit → sediment advection. Changes apply to the running simulation.`)),e.appendChild(this.group(`Lighting & look`,`light`,this.fields(this.render,[{key:`sunAzimuth`,label:`Sun azimuth`,min:0,max:360,step:1},{key:`sunElevation`,label:`Sun elevation`,min:-5,max:89,step:.5},{key:`sunIntensity`,label:`Sun intensity`,min:0,max:10,step:.05},{key:`sunColor`,label:`Sun colour`,type:`color`},{key:`zenith`,label:`Sky zenith`,type:`color`},{key:`horizon`,label:`Sky horizon`,type:`color`},{key:`ambient`,label:`Sky light`,min:0,max:3,step:.01},{key:`bounce`,label:`Ground bounce`,min:0,max:1,step:.01},{key:`exposure`,label:`Exposure`,min:.2,max:3,step:.01},{key:`fog`,label:`Aerial perspective`,min:0,max:5,step:.02},{key:`shadowSteps`,label:`Shadow steps`,min:0,max:96,step:1},{key:`detail`,label:`Micro detail`,min:0,max:1,step:.01}],()=>this.hooks.repaint()))),e.appendChild(this.group(`Analysis bake`,`analysis`,this.fields(this.world,[{key:`aoDirs`,label:`AO directions`,min:4,max:32,step:1},{key:`aoSteps`,label:`AO steps`,min:4,max:32,step:1},{key:`aoRadius`,label:`AO radius (m)`,min:50,max:4e3,step:10},{key:`flowGain`,label:`Wetness gain`,min:1,max:400,step:1},{key:`depGain`,label:`Sediment gain`,min:1,max:200,step:1},{key:`eroGain`,label:`Scour gain`,min:1,max:200,step:1}],()=>this.hooks.repaint()),`Horizon-scan occlusion and the mask set the texture stack reads.`))}},M=(e,t)=>{let n=new Float32Array(16);for(let r=0;r<4;r++)for(let i=0;i<4;i++){let a=0;for(let n=0;n<4;n++)a+=e[n*4+i]*t[r*4+n];n[r*4+i]=a}return n},N=(e,t,n,r)=>{let i=1/Math.tan(e/2),a=new Float32Array(16);return a[0]=i/t,a[5]=i,a[10]=r/(n-r),a[11]=-1,a[14]=r*n/(n-r),a},P=(e,t)=>[e[0]-t[0],e[1]-t[1],e[2]-t[2]],F=(e,t)=>[e[1]*t[2]-e[2]*t[1],e[2]*t[0]-e[0]*t[2],e[0]*t[1]-e[1]*t[0]],I=e=>{let t=Math.hypot(e[0],e[1],e[2])||1;return[e[0]/t,e[1]/t,e[2]/t]},L=(e,t)=>e[0]*t[0]+e[1]*t[1]+e[2]*t[2],R=(e,t,n)=>{let r=I(P(t,e)),i=I(F(r,n)),a=F(i,r),o=new Float32Array(16);return o[0]=i[0],o[4]=i[1],o[8]=i[2],o[1]=a[0],o[5]=a[1],o[9]=a[2],o[2]=-r[0],o[6]=-r[1],o[10]=-r[2],o[12]=-L(i,e),o[13]=-L(a,e),o[14]=L(r,e),o[15]=1,{m:o,f:r,s:i,u:a}},z=e=>document.querySelector(e),B=z(`#overlay`),V=(e,t)=>{B.style.display=`grid`,B.innerHTML=`<div class="box"><h2>${e}</h2><p>${t}</p></div>`};window.addEventListener(`error`,e=>V(`Runtime error`,`${e.message}<br><small>${e.filename}:${e.lineno}</small>`)),window.addEventListener(`unhandledrejection`,e=>V(`Runtime error`,String(e.reason)));var H=new m,U=z(`#gpu`),W=T[0].gen.map(e=>({...e})),G=T[0].mats.map(e=>({...e})),K=x(),q=S(),J=C(),Y=!0,X=!0,Z=!0,Q=0,$={az:.95,el:.42,dist:1.35,panY:.18};(async()=>{try{V(`Initialising WebGPU`,`Requesting adapter…`),H.onError=(e,t)=>V(e,t),await H.init(U)}catch(e){V(`WebGPU unavailable`,String(e.message??e)+`<br><br>Chrome/Edge 113+ on Windows/macOS/ChromeOS, Chrome 121+ on Linux (may need <code>--enable-unsafe-webgpu</code>), or Safari 18.`);return}B.style.display=`none`,z(`#gpuName`).textContent=H.adapterInfo.slice(0,48);let e=new j(W,G,K,q,J,{rebuild:()=>{Z=!0},restartErosion:()=>{Z=!0},repaint:()=>{X=!0},erosionParams:()=>{}});e.refresh();let t=z(`#preset`);T.forEach((e,n)=>{let r=document.createElement(`option`);r.value=String(n),r.textContent=e.name,t.appendChild(r)}),t.addEventListener(`change`,()=>{let n=T[+t.value];W=n.gen.map(e=>({...e})),G=n.mats.map(e=>({...e})),Object.assign(K,x(),n.world??{}),Object.assign(q,S(),n.erosion??{}),Object.assign(J,C(),n.render??{}),K.seed=Number(z(`#seed`).value)||1337,e.gen=W,e.mats=G,e.selGen=0,e.selMat=0,e.refresh(),Z=!0}),z(`#build`).addEventListener(`click`,()=>{Z=!0}),z(`#reset`).addEventListener(`click`,()=>{Z=!0});let n=z(`#erodeToggle`),r=()=>{n.textContent=Y?`⏸ Erosion`:`▶ Erosion`,n.classList.toggle(`on`,Y)};n.addEventListener(`click`,()=>{Y=!Y,r()}),r();let i=z(`#seed`);i.addEventListener(`change`,()=>{K.seed=Number(i.value)||1,Z=!0}),z(`#dice`).addEventListener(`click`,()=>{K.seed=Math.floor(Math.random()*1e5),i.value=String(K.seed),Z=!0}),z(`#res`).addEventListener(`change`,e=>{let t=Number(e.target.value);H.gridN=t>=2048?1024:t>=1024?768:512,H.allocate(t),Z=!0}),document.querySelectorAll(`.ric[data-mode]`).forEach(e=>{e.addEventListener(`click`,()=>{document.querySelectorAll(`.ric[data-mode]`).forEach(e=>e.classList.remove(`on`)),e.classList.add(`on`),J.shadingMode=Number(e.dataset.mode)})});let a=(e,t,n)=>{let r=z(e),i=n;r.classList.toggle(`on`,i),r.addEventListener(`click`,()=>{i=!i,r.classList.toggle(`on`,i),t(i)})};a(`#tWater`,e=>J.showWater=e,!0),a(`#tWire`,e=>J.wireframe=e,!1);let o=!1;a(`#tSun`,e=>o=e,!1),z(`#tTop`).addEventListener(`click`,()=>{$.el=1.45,$.az=0,$.dist=1.05});let s=null;U.addEventListener(`pointerdown`,e=>{s={x:e.clientX,y:e.clientY,btn:e.button},U.setPointerCapture(e.pointerId)}),U.addEventListener(`pointerup`,e=>{s=null,U.releasePointerCapture(e.pointerId)}),U.addEventListener(`pointermove`,e=>{if(!s)return;let t=e.clientX-s.x,n=e.clientY-s.y;s.x=e.clientX,s.y=e.clientY,o&&s.btn===0?(J.sunAzimuth=(J.sunAzimuth+t*.35+360)%360,J.sunElevation=Math.max(-4,Math.min(88,J.sunElevation-n*.2))):s.btn===2||e.shiftKey?$.panY=Math.max(-.4,Math.min(1.2,$.panY+n*.0016)):($.az-=t*.005,$.el=Math.max(.03,Math.min(1.52,$.el+n*.004)))}),U.addEventListener(`contextmenu`,e=>e.preventDefault()),U.addEventListener(`wheel`,e=>{e.preventDefault(),$.dist=Math.max(.12,Math.min(4,$.dist*(1+Math.sign(e.deltaY)*.08)))},{passive:!1});let c=(e,t)=>{let n=document.createElement(`a`);n.href=URL.createObjectURL(e),n.download=t,n.click(),setTimeout(()=>URL.revokeObjectURL(n.href),4e3)};z(`#exportR16`).addEventListener(`click`,async()=>{let e=await H.readBuffer(`height`),t=new Uint16Array(e.length);for(let n=0;n<e.length;n++)t[n]=Math.max(0,Math.min(1,e[n]))*65535;c(new Blob([t.buffer],{type:`application/octet-stream`}),`terrain_${H.res}x${H.res}_16bit.r16`)}),z(`#exportPng`).addEventListener(`click`,async()=>{let e=await H.readBuffer(`height`),t=document.createElement(`canvas`);t.width=t.height=H.res;let n=t.getContext(`2d`),r=n.createImageData(H.res,H.res);for(let t=0;t<e.length;t++){let n=Math.max(0,Math.min(1,e[t]))*255;r.data[t*4]=r.data[t*4+1]=r.data[t*4+2]=n,r.data[t*4+3]=255}n.putImageData(r,0,0),t.toBlob(e=>e&&c(e,`terrain_${H.res}.png`))});let l=!1;z(`#shot`).addEventListener(`click`,()=>{l=!0});let u=z(`#progress i`),d=0,f=0,p=performance.now(),m=4,h=()=>{requestAnimationFrame(h);let e=performance.now(),n=e,r=Math.max(1,Math.floor(U.clientWidth*Math.min(devicePixelRatio,2))),i=Math.max(1,Math.floor(U.clientHeight*Math.min(devicePixelRatio,2)));if((U.width!==r||U.height!==i)&&(U.width=r,U.height=i),H.resize(r,i),Z){let e=ee(W);H.generate(K,e.data,e.count),Z=!1,X=!0}if(Y&&H.erosionDone<q.iterations){let e=Math.min(m,q.iterations-H.erosionDone);H.erode(q,K,e),H.analyze({...K,aoDirs:4,aoSteps:6}),X=!0}else X&&e-Q>120&&(H.analyze(K),X=!1,Q=e);let a=K.worldSize,o=a*$.dist,s=[Math.cos($.az)*Math.cos($.el)*o,Math.sin($.el)*o+K.heightScale*.15,Math.sin($.az)*Math.cos($.el)*o],c=[0,K.heightScale*$.panY,0],g=r/i,_=48*Math.PI/180,v=R(s,c,[0,1,0]),y=M(N(_,g,a*.002,a*6),v.m),b=Math.tan(_/2),x=[v.f[0],v.f[1],v.f[2],0,v.s[0],v.s[1],v.s[2],0,v.u[0],v.u[1],v.u[2],0,b,g,0,0],S=te(G);H.render(y,s,x,K,J,S.data,S.count,e*.001),l&&(l=!1,U.toBlob(e=>{if(!e)return;let t=document.createElement(`a`);t.href=URL.createObjectURL(e),t.download=`projectzero_terrain.png`,t.click()}));let C=performance.now()-n;if(C>14&&m>1?m--:C<7&&m<24&&m++,f++,e-p>500){d=f*1e3/(e-p),f=0,p=e;let n=Math.min(1,H.erosionDone/Math.max(1,q.iterations));u.style.width=`${n*100}%`,z(`#st1`).innerHTML=`<b>${H.res}²</b> sim · <b>${H.gridN}²</b> mesh · ${(H.gridN*H.gridN*2/1e6).toFixed(1)} M tris`,z(`#st2`).innerHTML=`erosion <b>${H.erosionDone}</b>/${q.iterations} (${(n*100).toFixed(0)}%)`,z(`#st3`).innerHTML=`<b>${d.toFixed(0)}</b> fps · ${m} steps/frame`,z(`#st4`).innerHTML=`${(K.worldSize/1e3).toFixed(1)} km × ${K.heightScale.toFixed(0)} m relief · cell ${(K.worldSize/H.res).toFixed(1)} m`,z(`#vbadge`).innerHTML=`<b>${T[+t.value]?.name??`Custom`}</b> · seed ${K.seed}`,z(`#dot`).style.background=Y&&H.erosionDone<q.iterations?`var(--warn)`:`var(--ok)`}};requestAnimationFrame(h)})();