// WebGPU compute: Position Based Fluids, fully on the GPU.
// One bind group (8 bindings) shared by every entry point.
export const MAX_BALLS = 8;
export const MAX_OBS = 8;
export const CELL_CAP = 24;

export const SIM_COMMON = /* wgsl */`
struct Params {
  dims: vec4f,   // W, H, D, particle radius
  grid: vec4u,   // gx, gy, gz, N
  phys: vec4f,   // dt, gravity, rho0, eps
  mat0: vec4f,   // visc, adhesion, friction, cohesion
  mat1: vec4f,   // yield, kcorr, paddleBase, paddleAmp
  misc: vec4f,   // paddlePeriod (0 = none), numBalls, numObstacles, foam (0/1)
  obs: array<vec4f, ${MAX_OBS * 2}>,
}
struct Ball { p: vec4f, v: vec4f }   // p.w = radius, v.w = mass
`;

export const WORLD_RW = /* wgsl */`
struct World {
  balls: array<Ball, ${MAX_BALLS}>,
  paddle: vec4f,                       // x, vx, time, _
  imp: array<atomic<i32>, ${MAX_BALLS * 4}>,
}`;
export const WORLD_RO = /* wgsl */`
struct World {
  balls: array<Ball, ${MAX_BALLS}>,
  paddle: vec4f,
  imp: array<i32, ${MAX_BALLS * 4}>,
}`;

export const SIM_WGSL = SIM_COMMON + WORLD_RW + /* wgsl */`
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read_write> pos: array<vec4f>;   // xyz, density ratio
@group(0) @binding(2) var<storage, read_write> vel: array<vec4f>;   // xyz, foam
@group(0) @binding(3) var<storage, read_write> pred: array<vec4f>;  // predicted xyz, lambda
@group(0) @binding(4) var<storage, read_write> tmp: array<vec4f>;
@group(0) @binding(5) var<storage, read_write> gridCount: array<atomic<u32>>;
@group(0) @binding(6) var<storage, read_write> gridIdx: array<u32>;
@group(0) @binding(7) var<storage, read_write> world: World;

const POLY6: f32 = 1.5666814;      // 315 / (64 pi), h = 1
const SPIKY: f32 = -14.323944;     // -45 / pi
const W_DQ: f32 = 1.4762071;       // POLY6 * (1 - 0.2^2)^3
const CAP: u32 = ${CELL_CAP}u;
const IMP: f32 = 100000.0;

fn cellOf(p: vec3f) -> vec3i {
  let g = vec3i(P.grid.xyz);
  return clamp(vec3i(floor(p)), vec3i(0), g - vec3i(1));
}
fn cellId(c: vec3i) -> u32 {
  return (u32(c.z) * P.grid.y + u32(c.y)) * P.grid.x + u32(c.x);
}

// nearest static obstacle: xyz = outward normal, w = signed distance
fn sdObs(p: vec3f) -> vec4f {
  var best = vec4f(0.0, 1.0, 0.0, 1e9);
  let n = u32(P.misc.z);
  for (var k = 0u; k < n; k++) {
    let a = P.obs[k * 2u];
    let b = P.obs[k * 2u + 1u];
    var r: vec4f;
    if (a.x < 0.5) {
      let d = p - a.yzw;
      let l = max(length(d), 1e-6);
      r = vec4f(d / l, l - b.x);
    } else if (a.x < 1.5) {
      let rel = p - a.yzw;
      let q = abs(rel) - b.xyz;
      let m = max(q, vec3f(0.0));
      let ol = length(m);
      let s = select(vec3f(-1.0), vec3f(1.0), rel >= vec3f(0.0));
      if (ol > 0.0) {
        r = vec4f(s * m / ol, ol);
      } else if (q.x > q.y && q.x > q.z) {
        r = vec4f(s.x, 0.0, 0.0, q.x);
      } else if (q.y > q.z) {
        r = vec4f(0.0, s.y, 0.0, q.y);
      } else {
        r = vec4f(0.0, 0.0, s.z, q.z);
      }
    } else {
      r = vec4f(a.y, a.z, 0.0, a.y * p.x + a.z * p.y - a.w);
    }
    if (r.w < best.w) { best = r; }
  }
  return best;
}

fn clampWalls(p: vec3f, r: f32) -> vec3f {
  let lo = vec3f(select(r, world.paddle.x + r, P.misc.x > 0.0), r, r);
  let hi = P.dims.xyz - vec3f(r);
  return clamp(p, lo, hi);
}

// ---------------------------------------------------------------- rigid balls (single thread)
@compute @workgroup_size(1)
fn ballPredict() {
  let dt = P.phys.x;
  let t = world.paddle.z + dt;
  if (P.misc.x > 0.0) {
    let nx = P.mat1.z + P.mat1.w * (0.5 - 0.5 * cos(6.2831853 * t / P.misc.x));
    world.paddle = vec4f(nx, (nx - world.paddle.x) / dt, t, 0.0);
  } else {
    world.paddle = vec4f(0.0, 0.0, t, 0.0);
  }
  let nb = u32(P.misc.y);
  for (var k = 0u; k < nb; k++) {
    var b = world.balls[k];
    let r = b.p.w;
    b.v.y -= P.phys.y * dt;
    b.p = vec4f(b.p.xyz + b.v.xyz * dt, r);
    let c = clampWalls(b.p.xyz, r);
    let hit = c - b.p.xyz;
    if (hit.x != 0.0) {
      b.v.x *= -0.3;
      if (P.misc.x > 0.0 && hit.x > 0.0 && b.p.x < P.dims.x * 0.5) { b.v.x = max(b.v.x, world.paddle.y); }
    }
    if (hit.y != 0.0) { b.v.y *= -0.3; b.v.x *= 0.97; b.v.z *= 0.97; }
    if (hit.z != 0.0) { b.v.z *= -0.3; }
    b.p = vec4f(c, r);
    let o = sdObs(b.p.xyz);
    if (o.w < r) {
      b.p = vec4f(b.p.xyz + o.xyz * (r - o.w), r);
      let vn = dot(b.v.xyz, o.xyz);
      if (vn < 0.0) { b.v = vec4f(b.v.xyz - 1.3 * vn * o.xyz, b.v.w); }
    }
    world.balls[k] = b;
    for (var a = 0u; a < 4u; a++) { atomicStore(&world.imp[k * 4u + a], 0); }
  }
  for (var i = 0u; i < nb; i++) {
    for (var j = i + 1u; j < nb; j++) {
      var A = world.balls[i];
      var B = world.balls[j];
      let d = B.p.xyz - A.p.xyz;
      let l = max(length(d), 1e-5);
      let R = A.p.w + B.p.w;
      if (l < R) {
        let n = d / l;
        let wa = B.v.w / (A.v.w + B.v.w);
        let wb = 1.0 - wa;
        let rel = dot(B.v.xyz - A.v.xyz, n);
        A.p = vec4f(A.p.xyz - n * (R - l) * wa, A.p.w);
        B.p = vec4f(B.p.xyz + n * (R - l) * wb, B.p.w);
        if (rel < 0.0) {
          A.v = vec4f(A.v.xyz + n * rel * wa * 1.4, A.v.w);
          B.v = vec4f(B.v.xyz - n * rel * wb * 1.4, B.v.w);
        }
        world.balls[i] = A;
        world.balls[j] = B;
      }
    }
  }
}

@compute @workgroup_size(1)
fn ballFinalize() {
  let dt = P.phys.x;
  let nb = u32(P.misc.y);
  for (var k = 0u; k < nb; k++) {
    var b = world.balls[k];
    let J = vec3f(f32(atomicLoad(&world.imp[k * 4u])), f32(atomicLoad(&world.imp[k * 4u + 1u])), f32(atomicLoad(&world.imp[k * 4u + 2u]))) / IMP;
    var v = b.v.xyz + J / (b.v.w * dt);
    let s = length(v);
    if (s > 150.0) { v *= 150.0 / s; }
    b.v = vec4f(v, b.v.w);
    world.balls[k] = b;
  }
}

// ---------------------------------------------------------------- particles
@compute @workgroup_size(256)
fn clearGrid(@builtin(global_invocation_id) id: vec3u) {
  let n = P.grid.x * P.grid.y * P.grid.z;
  if (id.x < n) { atomicStore(&gridCount[id.x], 0u); }
}

@compute @workgroup_size(128)
fn predict(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= P.grid.w) { return; }
  let dt = P.phys.x;
  var v = vel[i].xyz;
  v.y -= P.phys.y * dt;
  let p = clampWalls(pos[i].xyz + v * dt, P.dims.w);
  pred[i] = vec4f(p, 0.0);
}

@compute @workgroup_size(128)
fn insert(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= P.grid.w) { return; }
  let c = cellId(cellOf(pred[i].xyz));
  let k = atomicAdd(&gridCount[c], 1u);
  if (k < CAP) { gridIdx[c * CAP + k] = i; }
}

@compute @workgroup_size(128)
fn lambda(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= P.grid.w) { return; }
  let pi = pred[i].xyz;
  let rho0 = P.phys.z;
  var rho = POLY6;
  var gs = vec3f(0.0);
  var sg2 = 0.0;
  let c0 = cellOf(pi);
  let g = vec3i(P.grid.xyz);
  for (var dz = -1; dz <= 1; dz++) {
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        let c = c0 + vec3i(dx, dy, dz);
        if (any(c < vec3i(0)) || any(c >= g)) { continue; }
        let cid = cellId(c);
        let cnt = min(atomicLoad(&gridCount[cid]), CAP);
        for (var k = 0u; k < cnt; k++) {
          let j = gridIdx[cid * CAP + k];
          if (j == i) { continue; }
          let d = pi - pred[j].xyz;
          let r2 = dot(d, d);
          if (r2 >= 1.0) { continue; }
          let w = 1.0 - r2;
          rho += POLY6 * w * w * w;
          let r = sqrt(r2);
          if (r > 1e-5) {
            let hr = 1.0 - r;
            let gr = d * (SPIKY * hr * hr / (r * rho0));
            gs += gr;
            sg2 += dot(gr, gr);
          }
        }
      }
    }
  }
  let ratio = rho / rho0;
  let C = max(ratio - 1.0, -P.mat0.w);
  pred[i].w = -C / (sg2 + dot(gs, gs) + P.phys.w);
  pos[i].w = ratio;
}

@compute @workgroup_size(128)
fn delta(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= P.grid.w) { return; }
  let me = pred[i];
  let pi = me.xyz;
  let li = me.w;
  let rho0 = P.phys.z;
  let kc = P.mat1.y;
  var dp = vec3f(0.0);
  let c0 = cellOf(pi);
  let g = vec3i(P.grid.xyz);
  for (var dz = -1; dz <= 1; dz++) {
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        let c = c0 + vec3i(dx, dy, dz);
        if (any(c < vec3i(0)) || any(c >= g)) { continue; }
        let cid = cellId(c);
        let cnt = min(atomicLoad(&gridCount[cid]), CAP);
        for (var k = 0u; k < cnt; k++) {
          let j = gridIdx[cid * CAP + k];
          if (j == i) { continue; }
          let pj = pred[j];
          let d = pi - pj.xyz;
          let r2 = dot(d, d);
          if (r2 >= 1.0) { continue; }
          let r = sqrt(r2);
          if (r < 1e-5) { continue; }
          let w = 1.0 - r2;
          let wr = POLY6 * w * w * w / W_DQ;
          let wr2 = wr * wr;
          let scorr = -kc * wr2 * wr2;
          let hr = 1.0 - r;
          dp += d * ((li + pj.w + scorr) * SPIKY * hr * hr / (r * rho0));
        }
      }
    }
  }
  var p = pi + dp;
  // obstacles
  let pr = P.dims.w;
  let o = sdObs(p);
  if (o.w < pr) { p += o.xyz * (pr - o.w); }
  // two-way rigid balls
  let nb = u32(P.misc.y);
  for (var k = 0u; k < nb; k++) {
    let b = world.balls[k];
    let d = p - b.p.xyz;
    let R = b.p.w + pr;
    let l2 = dot(d, d);
    if (l2 < R * R) {
      let l = max(sqrt(l2), 1e-5);
      let n = d / l;
      let corr = n * (R - l);
      p += corr;
      atomicAdd(&world.imp[k * 4u], i32(-corr.x * IMP));
      atomicAdd(&world.imp[k * 4u + 1u], i32(-corr.y * IMP));
      atomicAdd(&world.imp[k * 4u + 2u], i32(-corr.z * IMP));
    }
  }
  p = clampWalls(p, pr);
  tmp[i] = vec4f(p, li);
}

@compute @workgroup_size(128)
fn copyPred(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= P.grid.w) { return; }
  pred[id.x] = tmp[id.x];
}

@compute @workgroup_size(128)
fn velocity(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= P.grid.w) { return; }
  let dt = P.phys.x;
  var v = (pred[i].xyz - pos[i].xyz) / dt;
  let vmax = 0.9 / dt;
  let s = length(v);
  if (s > vmax) { v *= vmax / s; }
  vel[i] = vec4f(v, vel[i].w);
}

// normalized XSPH viscosity: v_i += c * sum (v_j - v_i) w_ij / max(sum w_ij, 0.6)
@compute @workgroup_size(128)
fn viscosity(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= P.grid.w) { return; }
  let pi = pred[i].xyz;
  let vi = vel[i];
  var acc = vec3f(0.0);
  var ws = 0.0;
  let c0 = cellOf(pi);
  let g = vec3i(P.grid.xyz);
  for (var dz = -1; dz <= 1; dz++) {
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        let c = c0 + vec3i(dx, dy, dz);
        if (any(c < vec3i(0)) || any(c >= g)) { continue; }
        let cid = cellId(c);
        let cnt = min(atomicLoad(&gridCount[cid]), CAP);
        for (var k = 0u; k < cnt; k++) {
          let j = gridIdx[cid * CAP + k];
          if (j == i) { continue; }
          let d = pi - pred[j].xyz;
          let r2 = dot(d, d);
          if (r2 >= 1.0) { continue; }
          let w = (1.0 - r2) * (1.0 - r2) * (1.0 - r2);
          acc += (vel[j].xyz - vi.xyz) * w;
          ws += w;
        }
      }
    }
  }
  tmp[i] = vec4f(vi.xyz + acc * (P.mat0.x / max(ws, 0.6)), vi.w);
}

@compute @workgroup_size(128)
fn copyVel(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= P.grid.w) { return; }
  vel[id.x] = tmp[id.x];
}

// adhesion / friction against solids, yield stress, whitewater, commit positions
@compute @workgroup_size(128)
fn finalize(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= P.grid.w) { return; }
  let dt = P.phys.x;
  let p = pred[i].xyz;
  var v = vel[i].xyz;
  var foam = vel[i].w;
  let dens = pos[i].w;

  var s = sdObs(p);
  var sv = vec3f(0.0);
  var ball = -1;
  let nb = u32(P.misc.y);
  for (var k = 0u; k < nb; k++) {
    let b = world.balls[k];
    let d = p - b.p.xyz;
    let l = max(length(d), 1e-5);
    if (l - b.p.w < s.w) { s = vec4f(d / l, l - b.p.w); sv = b.v.xyz; ball = i32(k); }
  }
  let minX = select(0.0, world.paddle.x, P.misc.x > 0.0);
  if (p.x - minX < s.w) { s = vec4f(1.0, 0.0, 0.0, p.x - minX); sv = vec3f(select(0.0, world.paddle.y, P.misc.x > 0.0), 0.0, 0.0); ball = -1; }
  if (P.dims.x - p.x < s.w) { s = vec4f(-1.0, 0.0, 0.0, P.dims.x - p.x); sv = vec3f(0.0); ball = -1; }
  if (p.y < s.w) { s = vec4f(0.0, 1.0, 0.0, p.y); sv = vec3f(0.0); ball = -1; }
  if (p.z < s.w) { s = vec4f(0.0, 0.0, 1.0, p.z); sv = vec3f(0.0); ball = -1; }
  if (P.dims.z - p.z < s.w) { s = vec4f(0.0, 0.0, -1.0, P.dims.z - p.z); sv = vec3f(0.0); ball = -1; }

  let adh = P.mat0.y;
  let fric = P.mat0.z;
  if (s.w < P.dims.w + 0.45) {
    let rv = v - sv;
    var vn = dot(rv, s.xyz);
    let vt = (rv - vn * s.xyz) * (1.0 - fric);
    if (vn > 0.0) { vn *= (1.0 - adh); }
    vn -= adh * 30.0 * dt;
    let nv = sv + vt + vn * s.xyz;
    if (ball >= 0) {
      let J = -(nv - v) * dt;
      let k = u32(ball);
      atomicAdd(&world.imp[k * 4u], i32(J.x * IMP));
      atomicAdd(&world.imp[k * 4u + 1u], i32(J.y * IMP));
      atomicAdd(&world.imp[k * 4u + 2u], i32(J.z * IMP));
    }
    v = nv;
  }
  let yld = P.mat1.x;
  if (yld > 0.0) {
    let sp = length(v);
    if (sp < yld && dens > 0.85) { v *= sp / yld; }
  }
  // whitewater potential: fast + sparse fluid (crests, spray, impact zones) -> foam that slowly decays
  if (P.misc.w > 0.5) {
    let sp = length(v);
    let gen = smoothstep(0.9, 0.55, dens) * smoothstep(8.0, 25.0, sp) + smoothstep(30.0, 60.0, sp) * 0.5;
    foam = clamp(foam * exp(-dt * 0.6) + gen * dt * 6.0, 0.0, 1.0);
  } else {
    foam = 0.0;
  }
  vel[i] = vec4f(v, foam);
  pos[i] = vec4f(p, dens);
}
`;
