import { COMMON } from './common.wgsl';

/* ------------------------------------------------------------------ */
/* 1. GENERATION — evaluates the terrain layer stack                    */
/* ------------------------------------------------------------------ */
export const GEN = /* wgsl */`
struct GenU {
  res: u32, layerCount: u32, seed: u32, pad0: u32,
  worldSize: f32, strataScale: f32, strataContrast: f32, strataTilt: f32,
  layers: array<vec4f, 64>,
};
@group(0) @binding(0) var<uniform> U: GenU;
@group(0) @binding(1) var<storage, read_write> height: array<f32>;
@group(0) @binding(2) var<storage, read_write> hardness: array<f32>;
${COMMON}

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
`;

/* ------------------------------------------------------------------ */
/* 2. HYDRAULIC EROSION — virtual-pipe shallow water (Mei et al.)       */
/*    Full column model: outflow flux -> water + velocity -> erosion /  */
/*    deposition against a sediment capacity -> semi-Lagrangian         */
/*    sediment advection -> evaporation. Produces real drainage         */
/*    networks, meanders, alluvial fans and deltas, not noise filtering. */
/* ------------------------------------------------------------------ */
const EROSION_BINDINGS = /* wgsl */`
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
`;

/** Pass A: outflow flux through the four virtual pipes. */
export const HYDRO_FLUX = /* wgsl */`
${EROSION_BINDINGS}
${COMMON}
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
`;

/** Pass B: apply flux -> new water depth + velocity; erode or deposit. */
export const HYDRO_ERODE = /* wgsl */`
${EROSION_BINDINGS}
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
`;

/** Pass C: semi-Lagrangian sediment transport + evaporation. */
export const HYDRO_TRANSPORT = /* wgsl */`
${EROSION_BINDINGS}
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
`;

export const HYDRO_COMMIT = /* wgsl */`
${EROSION_BINDINGS}
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let r = u32(E.res);
  if (gid.x >= r || gid.y >= r) { return; }
  let i = gid.y * r + gid.x;
  sediment[i] = sedimentTmp[i];
}
`;

/* ------------------------------------------------------------------ */
/* 3. THERMAL EROSION — talus slumping (scree, debris cones)            */
/* ------------------------------------------------------------------ */
export const THERMAL_CALC = /* wgsl */`
${EROSION_BINDINGS}
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
`;

export const THERMAL_APPLY = /* wgsl */`
${EROSION_BINDINGS}
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
`;

/* ------------------------------------------------------------------ */
/* 4. ANALYSIS — normals, horizon AO, curvature, flow/wetness           */
/* ------------------------------------------------------------------ */
export const ANALYSIS = /* wgsl */`
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
`;
