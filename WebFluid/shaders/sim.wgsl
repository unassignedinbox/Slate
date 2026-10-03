// ============================================================================
// Position-Based Fluids (Macklin & Müller 2013) — WebGPU compute
// Spatial hash grid via atomic linked lists, XSPH viscosity, artificial
// pressure (cohesion), SDF collisions (tank, sphere, box) with adhesion
// (sticking) + friction so viscous fluids coat surfaces.
// ============================================================================

struct SimParams {
  gridMin        : vec3f,
  cellSize       : f32,
  gridDims       : vec3i,
  numParticles   : u32,

  dt             : f32,
  h              : f32,
  invRho0        : f32,
  epsLambda      : f32,

  kCorr          : f32,
  wDqInv         : f32,
  viscosity      : f32,
  poly6          : f32,

  spiky          : f32,
  particleRadius : f32,
  stickRate      : f32,
  adhesionAccel  : f32,

  gravity        : vec3f,
  adhesionRange  : f32,

  boxMin         : vec3f,
  pad0           : f32,
  boxMax         : vec3f,
  pad1           : f32,

  spherePos      : vec3f,
  sphereRadius   : f32,
  sphereVel      : vec3f,
  pad2           : f32,

  obsMin         : vec3f,
  pad3           : f32,
  obsMax         : vec3f,
  obsEnable      : f32,
};

@group(0) @binding(0) var<uniform> P : SimParams;
@group(0) @binding(1) var<storage, read_write> pos      : array<vec4f>;
@group(0) @binding(2) var<storage, read_write> vel      : array<vec4f>;
@group(0) @binding(3) var<storage, read_write> pred     : array<vec4f>; // current predicted
@group(0) @binding(4) var<storage, read_write> lambdas  : array<f32>;
@group(0) @binding(5) var<storage, read_write> gridHead : array<atomic<i32>>;
@group(0) @binding(6) var<storage, read_write> gridNext : array<i32>;
@group(0) @binding(7) var<storage, read_write> velTmp   : array<vec4f>;
@group(0) @binding(8) var<storage, read_write> predOut  : array<vec4f>; // write target for jacobi iter

// ---------------------------------------------------------------- grid utils

fn cellCoord(p: vec3f) -> vec3i {
  let c = vec3i(floor((p - P.gridMin) / P.cellSize));
  return clamp(c, vec3i(0), P.gridDims - vec3i(1));
}

fn cellIndex(c: vec3i) -> i32 {
  return c.x + P.gridDims.x * (c.y + P.gridDims.y * c.z);
}

// ---------------------------------------------------------------- kernels

fn w_poly6(r2: f32) -> f32 {
  let h2 = P.h * P.h;
  if (r2 >= h2) { return 0.0; }
  let d = h2 - r2;
  return P.poly6 * d * d * d;
}

// gradient of spiky kernel wrt pi, d = pi - pj
fn gradSpiky(d: vec3f, r: f32) -> vec3f {
  let hr = P.h - r;
  return (-P.spiky * hr * hr / max(r, 1e-6)) * d;
}

// ---------------------------------------------------------------- SDF helpers

fn sdBoxAt(p: vec3f, bmin: vec3f, bmax: vec3f) -> f32 {
  let c = (bmin + bmax) * 0.5;
  let b = (bmax - bmin) * 0.5;
  let q = abs(p - c) - b;
  return length(max(q, vec3f(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0);
}

fn boxNormal(p: vec3f, bmin: vec3f, bmax: vec3f) -> vec3f {
  let e = 0.004;
  let n = vec3f(
    sdBoxAt(p + vec3f(e,0.0,0.0), bmin, bmax) - sdBoxAt(p - vec3f(e,0.0,0.0), bmin, bmax),
    sdBoxAt(p + vec3f(0.0,e,0.0), bmin, bmax) - sdBoxAt(p - vec3f(0.0,e,0.0), bmin, bmax),
    sdBoxAt(p + vec3f(0.0,0.0,e), bmin, bmax) - sdBoxAt(p - vec3f(0.0,0.0,e), bmin, bmax));
  return normalize(n + vec3f(1e-6, 0.0, 0.0));
}

// push point out of the obstacle box (expanded by pr)
fn pushOutBox(pIn: vec3f, pr: f32) -> vec3f {
  var p = pIn;
  let bmin = P.obsMin - vec3f(pr);
  let bmax = P.obsMax + vec3f(pr);
  if (all(p > bmin) && all(p < bmax)) {
    let dMin = p - bmin;
    let dMax = bmax - p;
    var best = dMin.x; var axis = 0; var sgn = -1.0;
    if (dMax.x < best) { best = dMax.x; axis = 0; sgn = 1.0; }
    if (dMin.y < best) { best = dMin.y; axis = 1; sgn = -1.0; }
    if (dMax.y < best) { best = dMax.y; axis = 1; sgn = 1.0; }
    if (dMin.z < best) { best = dMin.z; axis = 2; sgn = -1.0; }
    if (dMax.z < best) { best = dMax.z; axis = 2; sgn = 1.0; }
    if (axis == 0) { if (sgn < 0.0) { p.x = bmin.x; } else { p.x = bmax.x; } }
    else if (axis == 1) { if (sgn < 0.0) { p.y = bmin.y; } else { p.y = bmax.y; } }
    else { if (sgn < 0.0) { p.z = bmin.z; } else { p.z = bmax.z; } }
  }
  return p;
}

fn resolveCollisions(pIn: vec3f) -> vec3f {
  var p = pIn;
  let pr = P.particleRadius;

  // container (stay inside)
  p = clamp(p, P.boxMin + vec3f(pr), P.boxMax - vec3f(pr));

  // dynamic sphere (push out)
  let ds = p - P.spherePos;
  let l = length(ds);
  let minD = P.sphereRadius + pr;
  if (l < minD) {
    p = P.spherePos + ds * (minD / max(l, 1e-5));
    p = clamp(p, P.boxMin + vec3f(pr), P.boxMax - vec3f(pr));
  }

  // static obstacle block
  if (P.obsEnable > 0.5) {
    p = pushOutBox(p, pr);
  }
  return p;
}

// Adhesion / friction near surfaces: viscous fluids stick & coat.
fn applyAdhesion(p: vec3f, vIn: vec3f) -> vec3f {
  var v = vIn;
  if (P.stickRate <= 0.0 && P.adhesionAccel <= 0.0) { return v; }

  let pr   = P.particleRadius;
  let adhR = P.adhesionRange;
  let dt   = P.dt;

  // --- dynamic sphere (moving surface: stick relative to its velocity)
  {
    let ds = p - P.spherePos;
    let l = length(ds);
    let d = l - P.sphereRadius - pr;
    if (d < adhR) {
      let n = ds / max(l, 1e-5);
      let w = 1.0 - clamp(d / adhR, 0.0, 1.0);
      let stick = 1.0 - exp(-P.stickRate * dt * (1.0 + 3.0 * w));
      v = mix(v, P.sphereVel, stick * w);
      v -= n * (P.adhesionAccel * w * dt);
    }
  }

  // --- container walls + floor (nearest of 5, ceiling excluded)
  {
    var best = p.y - P.boxMin.y;          var n = vec3f(0.0, 1.0, 0.0);
    var d = p.x - P.boxMin.x;  if (d < best) { best = d; n = vec3f(1.0, 0.0, 0.0); }
    d = P.boxMax.x - p.x;      if (d < best) { best = d; n = vec3f(-1.0, 0.0, 0.0); }
    d = p.z - P.boxMin.z;      if (d < best) { best = d; n = vec3f(0.0, 0.0, 1.0); }
    d = P.boxMax.z - p.z;      if (d < best) { best = d; n = vec3f(0.0, 0.0, -1.0); }
    let dd = best - pr;
    if (dd < adhR) {
      let w = 1.0 - clamp(dd / adhR, 0.0, 1.0);
      let stick = 1.0 - exp(-P.stickRate * dt * (1.0 + 3.0 * w));
      v = mix(v, vec3f(0.0), stick * w);
      v -= n * (P.adhesionAccel * w * dt);
    }
  }

  // --- static obstacle block
  if (P.obsEnable > 0.5) {
    let sd = sdBoxAt(p, P.obsMin, P.obsMax) - pr;
    if (sd < adhR) {
      let n = boxNormal(p, P.obsMin, P.obsMax);
      let w = 1.0 - clamp(sd / adhR, 0.0, 1.0);
      let stick = 1.0 - exp(-P.stickRate * dt * (1.0 + 3.0 * w));
      v = mix(v, vec3f(0.0), stick * w);
      v -= n * (P.adhesionAccel * w * dt);
    }
  }
  return v;
}

// ============================================================ entry points

@compute @workgroup_size(256)
fn predict(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= P.numParticles) { return; }
  var v = vel[i].xyz + P.gravity * P.dt;
  // CFL speed clamp
  let vmax = 0.45 * P.h / P.dt;
  let s = length(v);
  if (s > vmax) { v *= vmax / s; }
  vel[i] = vec4f(v, 0.0);
  pred[i] = vec4f(pos[i].xyz + v * P.dt, 0.0);
}

@compute @workgroup_size(256)
fn clearGrid(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&gridHead)) { return; }
  atomicStore(&gridHead[i], -1);
}

@compute @workgroup_size(256)
fn buildGrid(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= P.numParticles) { return; }
  let c = cellIndex(cellCoord(pred[i].xyz));
  gridNext[i] = atomicExchange(&gridHead[c], i32(i));
}

@compute @workgroup_size(256)
fn computeLambda(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= P.numParticles) { return; }
  let pi = pred[i].xyz;
  let h2 = P.h * P.h;
  let cc = cellCoord(pi);

  var rho = 0.0;
  var gradI = vec3f(0.0);
  var sumGrad2 = 0.0;

  for (var dz = -1; dz <= 1; dz++) {
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        let nc = cc + vec3i(dx, dy, dz);
        if (any(nc < vec3i(0)) || any(nc >= P.gridDims)) { continue; }
        var j = atomicLoad(&gridHead[cellIndex(nc)]);
        loop {
          if (j < 0) { break; }
          let d = pi - pred[j].xyz;
          let r2 = dot(d, d);
          if (r2 < h2) {
            let dd = h2 - r2;
            rho += P.poly6 * dd * dd * dd;
            if (r2 > 1e-12) {
              let g = gradSpiky(d, sqrt(r2)) * P.invRho0;
              gradI += g;
              sumGrad2 += dot(g, g);
            }
          }
          j = gridNext[j];
        }
      }
    }
  }
  sumGrad2 += dot(gradI, gradI);
  let C = rho * P.invRho0 - 1.0;
  lambdas[i] = -C / (sumGrad2 + P.epsLambda);
}

@compute @workgroup_size(256)
fn applyDelta(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= P.numParticles) { return; }
  let pi = pred[i].xyz;
  let li = lambdas[i];
  let h2 = P.h * P.h;
  let cc = cellCoord(pi);

  var dp = vec3f(0.0);

  for (var dz = -1; dz <= 1; dz++) {
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        let nc = cc + vec3i(dx, dy, dz);
        if (any(nc < vec3i(0)) || any(nc >= P.gridDims)) { continue; }
        var j = atomicLoad(&gridHead[cellIndex(nc)]);
        loop {
          if (j < 0) { break; }
          if (u32(j) != i) {
            let d = pi - pred[j].xyz;
            let r2 = dot(d, d);
            if (r2 < h2 && r2 > 1e-12) {
              let dd = h2 - r2;
              let w = P.poly6 * dd * dd * dd * P.wDqInv;
              let w2 = w * w;
              let scorr = -P.kCorr * w2 * w2;
              dp += (li + lambdas[j] + scorr) * gradSpiky(d, sqrt(r2));
            }
          }
          j = gridNext[j];
        }
      }
    }
  }

  var pNew = pi + dp * P.invRho0;
  pNew = resolveCollisions(pNew);
  predOut[i] = vec4f(pNew, 0.0);
}

@compute @workgroup_size(256)
fn finalizeVel(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= P.numParticles) { return; }
  let pNew = pred[i].xyz;
  var v = (pNew - pos[i].xyz) / P.dt;
  v = applyAdhesion(pNew, v);
  velTmp[i] = vec4f(v, 0.0);
}

@compute @workgroup_size(256)
fn xsph(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= P.numParticles) { return; }
  let pi = pred[i].xyz;
  let vi = velTmp[i].xyz;
  let h2 = P.h * P.h;
  let cc = cellCoord(pi);

  var acc = vec3f(0.0);
  for (var dz = -1; dz <= 1; dz++) {
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        let nc = cc + vec3i(dx, dy, dz);
        if (any(nc < vec3i(0)) || any(nc >= P.gridDims)) { continue; }
        var j = atomicLoad(&gridHead[cellIndex(nc)]);
        loop {
          if (j < 0) { break; }
          let d = pi - pred[j].xyz;
          let r2 = dot(d, d);
          if (r2 < h2) {
            let dd = h2 - r2;
            acc += (velTmp[j].xyz - vi) * (P.poly6 * dd * dd * dd);
          }
          j = gridNext[j];
        }
      }
    }
  }
  let vNew = vi + P.viscosity * acc * P.invRho0;
  vel[i] = vec4f(vNew, 0.0);
  pos[i] = vec4f(pi, 1.0);
}
