// Slate Fluid — Position Based Fluids (Macklin & Müller 2013) solver running in a Web Worker.
// Sim units: smoothing radius h = 1. One unit ~ 10 cm, so gravity = 98 units/s^2.
// Features: incompressibility (PBF density constraint), artificial pressure (s_corr),
// XSPH viscosity (multi-pass for very viscous fluids), cohesion, yield stress (mud),
// adhesion + friction against all solids (walls, static obstacles, rigid balls, paddle),
// two-way coupled rigid spheres (buoyancy / drag emerge from particle contacts).

'use strict';

const MAXP = 26000;
const MAXNB = 64;
const SPACING = 0.6;          // rest particle spacing (in units of h)
const PR = 0.3;               // particle collision radius
const GRAVITY = 98;
const POLY6 = 315 / (64 * Math.PI);
const SPIKY = -45 / Math.PI;
const DQ = 0.2;               // s_corr reference distance
const W_DQ = POLY6 * Math.pow(1 - DQ * DQ, 3);

const x = new Float32Array(MAXP * 3);
const v = new Float32Array(MAXP * 3);
const p = new Float32Array(MAXP * 3);
const dp = new Float32Array(MAXP * 3);
const vt = new Float32Array(MAXP * 3);
const lam = new Float32Array(MAXP);
const dens = new Float32Array(MAXP);
const nb = new Int32Array(MAXP * MAXNB);
const nbc = new Int32Array(MAXP);
const nG = new Float32Array(MAXP * MAXNB * 3); // cached constraint gradients per neighbor pair
const nS = new Float32Array(MAXP * MAXNB);     // cached s_corr per neighbor pair
const tmp3 = new Float32Array(MAXP * 3);
const cellOf = new Int32Array(MAXP);
const sorted = new Int32Array(MAXP);
let cellStart = new Int32Array(1);
let gx = 1, gy = 1, gz = 1;
let N = 0;

// rest density for our lattice spacing
let RHO0 = 0;
(function computeRho0() {
  let s = 0;
  for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) for (let k = -3; k <= 3; k++) {
    const r2 = (i * i + j * j + k * k) * SPACING * SPACING;
    if (r2 < 1) { const w = 1 - r2; s += POLY6 * w * w * w; }
  }
  RHO0 = s;
})();

const MATERIALS = {
  water:     { visc: 0.015, passes: 1, adh: 0.02, fric: 0.01, coh: 0.00, yield: 0.0, iters: 3 },
  milk:      { visc: 0.05,  passes: 1, adh: 0.08, fric: 0.05, coh: 0.02, yield: 0.0, iters: 3 },
  chocolate: { visc: 0.35,  passes: 2, adh: 0.35, fric: 0.30, coh: 0.08, yield: 0.6, iters: 3 },
  honey:     { visc: 0.55,  passes: 3, adh: 0.60, fric: 0.55, coh: 0.12, yield: 0.0, iters: 3 },
  mud:       { visc: 0.40,  passes: 2, adh: 0.40, fric: 0.50, coh: 0.05, yield: 2.5, iters: 3 },
};
let mat = MATERIALS.water;

// ---- scene state ----
let W = 40, H = 28, D = 14;
let obstacles = [];      // {type:'sphere',c:[..],r} | {type:'box',c,h} | {type:'ramp',n:[..],o}
let balls = [];          // {p:[..], v:[..], r, m, J:[..]}
let paddle = null;       // {x, vx, base, amp, period}
let emitter = null;      // {c:[..], r, speed, acc, max}
let time = 0;
let sceneName = 'dam';

function addParticle(px, py, pz, vx = 0, vy = 0, vz = 0) {
  if (N >= MAXP) return false;
  const i = N * 3;
  x[i] = px; x[i + 1] = py; x[i + 2] = pz;
  v[i] = vx; v[i + 1] = vy; v[i + 2] = vz;
  N++;
  return true;
}
const jit = () => (Math.random() - 0.5) * 0.02;
function fillBox(x0, y0, z0, x1, y1, z1, accept) {
  for (let py = y0; py < y1; py += SPACING)
    for (let pz = z0; pz < z1; pz += SPACING)
      for (let px = x0; px < x1; px += SPACING) {
        if (accept && !accept(px, py, pz)) continue;
        if (sdfStatic(px, py, pz) < PR) continue;
        addParticle(px + jit(), py + jit(), pz + jit());
      }
}

function rampFrom(x0, x1, height) {
  const nx = -height, ny = x1 - x0, l = Math.hypot(nx, ny);
  const n = [nx / l, ny / l, 0];
  return { type: 'ramp', n, o: n[0] * x0, x0, x1, height };
}

function loadScene(name) {
  sceneName = name; N = 0; balls = []; obstacles = []; paddle = null; emitter = null; time = 0;
  if (name === 'dam') {
    W = 40; H = 28; D = 14;
    obstacles.push({ type: 'box', c: [26, 4.5, 7], h: [1.5, 4.5, 2.5] });
    obstacles.push({ type: 'sphere', c: [33, 2.5, 3.5], r: 2.5 });
    setupGrid();
    fillBox(0.5, 0.5, 0.5, 13, 17, D - 0.5);
  } else if (name === 'splash') {
    W = 28; H = 30; D = 16;
    setupGrid();
    fillBox(0.5, 0.5, 0.5, W - 0.5, 5.5, D - 0.5);
    const c = [9, 16, 8], R = 3.6;
    fillBox(c[0] - R, c[1] - R, c[2] - R, c[0] + R, c[1] + R, c[2] + R,
      (a, b, d) => (a - c[0]) ** 2 + (b - c[1]) ** 2 + (d - c[2]) ** 2 < R * R);
    addBall([19, 22, 8], [0, -10, 0], 2.6, 2.5);
  } else if (name === 'ocean') {
    W = 56; H = 24; D = 10;
    const ramp = rampFrom(28, 56, 13);
    obstacles.push(ramp);
    obstacles.push({ type: 'box', c: [40, 6, 5], h: [1.2, 6, 1.2] }); // pier post
    paddle = { x: 1.0, vx: 0, base: 1.0, amp: 6.0, period: 2.6 };
    setupGrid();
    fillBox(paddle.x + 0.5, 0.5, 0.5, W - 0.5, 6.5, D - 0.5);
  } else if (name === 'pour') {
    W = 30; H = 34; D = 20;
    obstacles.push({ type: 'box', c: [15, 3.5, 10], h: [3, 3.5, 3] });
    obstacles.push({ type: 'sphere', c: [15, 11.2, 10], r: 4.4 });
    obstacles.push({ type: 'box', c: [6, 1.5, 6], h: [2.5, 1.5, 2.5] });
    emitter = { c: [14.2, 30, 10], r: 1.5, speed: 16, acc: 0, max: 16000 };
    setupGrid();
    fillBox(0.5, 0.5, 0.5, W - 0.5, 1.4, D - 0.5);
  }
  postSceneInfo();
}

function setupGrid() {
  gx = Math.ceil(W); gy = Math.ceil(H); gz = Math.ceil(D);
  cellStart = new Int32Array(gx * gy * gz + 1);
}

function addBall(pos, vel, r, density) {
  if (balls.length >= 6) balls.shift();
  const m = density * (4 / 3) * Math.PI * r * r * r / (SPACING ** 3);
  balls.push({ p: pos.slice(), v: vel.slice(), r, m, J: [0, 0, 0], density });
}

// ---- signed distance to static solids (obstacles only, walls handled separately) ----
let sdN0 = 0, sdN1 = 0, sdN2 = 0, sdVx = 0, sdVy = 0, sdVz = 0, sdBall = -1;
function sdfStatic(px, py, pz) {
  let best = 1e9;
  for (let k = 0; k < obstacles.length; k++) {
    const o = obstacles[k];
    let d, n0, n1, n2;
    if (o.type === 'sphere') {
      const dx = px - o.c[0], dy = py - o.c[1], dz = pz - o.c[2];
      const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
      d = l - o.r; n0 = dx / l; n1 = dy / l; n2 = dz / l;
    } else if (o.type === 'box') {
      const rx = px - o.c[0], ry = py - o.c[1], rz = pz - o.c[2];
      const qx = Math.abs(rx) - o.h[0], qy = Math.abs(ry) - o.h[1], qz = Math.abs(rz) - o.h[2];
      const mx = Math.max(qx, 0), my = Math.max(qy, 0), mz = Math.max(qz, 0);
      const ol = Math.sqrt(mx * mx + my * my + mz * mz);
      if (ol > 0) {
        d = ol; n0 = Math.sign(rx) * mx / ol; n1 = Math.sign(ry) * my / ol; n2 = Math.sign(rz) * mz / ol;
      } else {
        if (qx > qy && qx > qz) { d = qx; n0 = Math.sign(rx); n1 = 0; n2 = 0; }
        else if (qy > qz) { d = qy; n0 = 0; n1 = Math.sign(ry); n2 = 0; }
        else { d = qz; n0 = 0; n1 = 0; n2 = Math.sign(rz); }
      }
    } else { // ramp half-space
      d = o.n[0] * px + o.n[1] * py - o.o; n0 = o.n[0]; n1 = o.n[1]; n2 = 0;
    }
    if (d < best) { best = d; sdN0 = n0; sdN1 = n1; sdN2 = n2; }
  }
  return best;
}

// nearest solid including balls; also outputs solid velocity
function sdfAll(px, py, pz) {
  let best = sdfStatic(px, py, pz);
  sdVx = sdVy = sdVz = 0; sdBall = -1;
  for (let k = 0; k < balls.length; k++) {
    const b = balls[k];
    const dx = px - b.p[0], dy = py - b.p[1], dz = pz - b.p[2];
    const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
    const d = l - b.r;
    if (d < best) {
      best = d; sdN0 = dx / l; sdN1 = dy / l; sdN2 = dz / l;
      sdVx = b.v[0]; sdVy = b.v[1]; sdVz = b.v[2]; sdBall = k;
    }
  }
  return best;
}

// ---- spatial grid ----
function buildGrid() {
  cellStart.fill(0);
  for (let i = 0; i < N; i++) {
    let cx = p[i * 3] | 0, cy = p[i * 3 + 1] | 0, cz = p[i * 3 + 2] | 0;
    if (cx < 0) cx = 0; else if (cx >= gx) cx = gx - 1;
    if (cy < 0) cy = 0; else if (cy >= gy) cy = gy - 1;
    if (cz < 0) cz = 0; else if (cz >= gz) cz = gz - 1;
    const c = (cz * gy + cy) * gx + cx;
    cellOf[i] = c; cellStart[c + 1]++;
  }
  const nc = gx * gy * gz;
  for (let c = 0; c < nc; c++) cellStart[c + 1] += cellStart[c];
  const cursor = cellStart.slice(0, nc);
  for (let i = 0; i < N; i++) sorted[cursor[cellOf[i]]++] = i;
  // reorder particle storage by cell for cache locality (sorted becomes identity)
  for (const arr of [x, v, p]) {
    for (let k = 0; k < N; k++) { const s3 = sorted[k] * 3, k3 = k * 3; tmp3[k3] = arr[s3]; tmp3[k3 + 1] = arr[s3 + 1]; tmp3[k3 + 2] = arr[s3 + 2]; }
    arr.set(tmp3.subarray(0, N * 3));
  }
  const co = new Int32Array(N);
  for (let k = 0; k < N; k++) co[k] = cellOf[sorted[k]];
  cellOf.set(co);
  for (let k = 0; k < N; k++) sorted[k] = k;

  for (let i = 0; i < N; i++) {
    const i3 = i * 3, pix = p[i3], piy = p[i3 + 1], piz = p[i3 + 2];
    const c = cellOf[i];
    const cx = c % gx, cy = ((c / gx) | 0) % gy, cz = (c / (gx * gy)) | 0;
    let cnt = 0; const base = i * MAXNB;
    for (let z = cz - 1; z <= cz + 1; z++) {
      if (z < 0 || z >= gz) continue;
      for (let y = cy - 1; y <= cy + 1; y++) {
        if (y < 0 || y >= gy) continue;
        const row = (z * gy + y) * gx;
        const x0 = cx > 0 ? cx - 1 : 0, x1 = cx < gx - 1 ? cx + 1 : gx - 1;
        const s = cellStart[row + x0], e = cellStart[row + x1 + 1];
        for (let k = s; k < e; k++) {
          const j = sorted[k];
          if (j === i) continue;
          const j3 = j * 3;
          const dx = pix - p[j3], dy = piy - p[j3 + 1], dz = piz - p[j3 + 2];
          if (dx * dx + dy * dy + dz * dz < 1 && cnt < MAXNB) nb[base + cnt++] = j;
        }
      }
    }
    nbc[i] = cnt;
  }
}

// ---- collisions (position level) ----
function collide(i, dt, accumulate) {
  const i3 = i * 3;
  let px = p[i3], py = p[i3 + 1], pz = p[i3 + 2];
  // obstacles
  const d = sdfStatic(px, py, pz);
  if (d < PR) { const c = PR - d; px += sdN0 * c; py += sdN1 * c; pz += sdN2 * c; }
  // rigid balls (two-way)
  for (let k = 0; k < balls.length; k++) {
    const b = balls[k];
    const dx = px - b.p[0], dy = py - b.p[1], dz = pz - b.p[2];
    const l2 = dx * dx + dy * dy + dz * dz, R = b.r + PR;
    if (l2 < R * R) {
      const l = Math.sqrt(l2) || 1e-6, c = R - l;
      const nx = dx / l, ny = dy / l, nz = dz / l;
      px += nx * c; py += ny * c; pz += nz * c;
      if (accumulate) { b.J[0] -= nx * c; b.J[1] -= ny * c; b.J[2] -= nz * c; }
    }
  }
  // container walls (+ wave paddle)
  const minX = paddle ? paddle.x + PR : PR;
  if (px < minX) px = minX; else if (px > W - PR) px = W - PR;
  if (py < PR) py = PR; else if (py > H - PR) py = H - PR;
  if (pz < PR) pz = PR; else if (pz > D - PR) pz = D - PR;
  p[i3] = px; p[i3 + 1] = py; p[i3 + 2] = pz;
}

// ---- emitter ----
function emit(dt) {
  const e = emitter;
  if (!e || N >= e.max) return;
  e.acc += e.speed * dt;
  while (e.acc >= SPACING && N < e.max) {
    e.acc -= SPACING;
    const y = e.c[1] - e.acc;
    for (let a = -e.r; a <= e.r; a += SPACING)
      for (let b = -e.r; b <= e.r; b += SPACING)
        if (a * a + b * b <= e.r * e.r)
          addParticle(e.c[0] + a + jit(), y, e.c[2] + b + jit(), 0, -e.speed, 0);
  }
}

// ---- one PBF substep ----
function step(dt) {
  time += dt;
  if (paddle) {
    const nx = paddle.base + paddle.amp * (0.5 - 0.5 * Math.cos(2 * Math.PI * time / paddle.period));
    paddle.vx = (nx - paddle.x) / dt; paddle.x = nx;
  }
  emit(dt);

  const vmax = 0.9 / dt;
  for (let i = 0; i < N; i++) {
    const i3 = i * 3;
    v[i3 + 1] -= GRAVITY * dt;
    p[i3] = x[i3] + v[i3] * dt; p[i3 + 1] = x[i3 + 1] + v[i3 + 1] * dt; p[i3 + 2] = x[i3 + 2] + v[i3 + 2] * dt;
  }
  // rigid balls predict
  for (const b of balls) {
    b.v[1] -= GRAVITY * dt;
    for (let a = 0; a < 3; a++) b.p[a] += b.v[a] * dt;
    b.J[0] = b.J[1] = b.J[2] = 0;
    ballWalls(b);
  }
  ballBall();

  buildGrid();

  const iters = mat.iters + (dt > 0.01 ? 1 : 0), coh = mat.coh, eps = 0.35;
  const kcorr = 0.004;
  for (let it = 0; it < iters; it++) {
    // lambdas
    for (let i = 0; i < N; i++) {
      const i3 = i * 3, pix = p[i3], piy = p[i3 + 1], piz = p[i3 + 2];
      let rho = POLY6, gxs = 0, gys = 0, gzs = 0, sg2 = 0;
      const base = i * MAXNB, cnt = nbc[i];
      for (let k = 0; k < cnt; k++) {
        const j3 = nb[base + k] * 3;
        const dx = pix - p[j3], dy = piy - p[j3 + 1], dz = piz - p[j3 + 2];
        const r2 = dx * dx + dy * dy + dz * dz;
        const q = base + k, q3 = q * 3;
        if (r2 >= 1) { nG[q3] = nG[q3 + 1] = nG[q3 + 2] = 0; nS[q] = 0; continue; }
        const w = 1 - r2, wp = POLY6 * w * w * w; rho += wp;
        const r = Math.sqrt(r2);
        if (r > 1e-5) {
          const hr = 1 - r, f = SPIKY * hr * hr / (r * RHO0);
          const ax = f * dx, ay = f * dy, az = f * dz;
          nG[q3] = ax; nG[q3 + 1] = ay; nG[q3 + 2] = az;
          const wr = wp / W_DQ; nS[q] = -kcorr * wr * wr * wr * wr;
          gxs += ax; gys += ay; gzs += az; sg2 += ax * ax + ay * ay + az * az;
        } else { nG[q3] = nG[q3 + 1] = nG[q3 + 2] = 0; nS[q] = 0; }
      }
      dens[i] = rho / RHO0;
      let C = rho / RHO0 - 1;
      if (C < -coh) C = -coh;
      lam[i] = -C / (sg2 + gxs * gxs + gys * gys + gzs * gzs + eps);
    }
    // position corrections (reuse cached gradients)
    for (let i = 0; i < N; i++) {
      const i3 = i * 3, li = lam[i];
      let ox = 0, oy = 0, oz = 0;
      const base = i * MAXNB, cnt = nbc[i];
      for (let k = 0; k < cnt; k++) {
        const q = base + k, q3 = q * 3;
        const f = li + lam[nb[q]] + nS[q];
        ox += f * nG[q3]; oy += f * nG[q3 + 1]; oz += f * nG[q3 + 2];
      }
      dp[i3] = ox; dp[i3 + 1] = oy; dp[i3 + 2] = oz;
    }
    const last = it === iters - 1;
    for (let i = 0; i < N; i++) {
      const i3 = i * 3;
      p[i3] += dp[i3]; p[i3 + 1] += dp[i3 + 1]; p[i3 + 2] += dp[i3 + 2];
      collide(i, dt, true);
    }
    if (last) break;
  }

  // velocity update
  const inv = 1 / dt;
  for (let i = 0; i < N; i++) {
    const i3 = i * 3;
    let vx = (p[i3] - x[i3]) * inv, vy = (p[i3 + 1] - x[i3 + 1]) * inv, vz = (p[i3 + 2] - x[i3 + 2]) * inv;
    const s2 = vx * vx + vy * vy + vz * vz;
    if (s2 > vmax * vmax) { const s = vmax / Math.sqrt(s2); vx *= s; vy *= s; vz *= s; }
    v[i3] = vx; v[i3 + 1] = vy; v[i3 + 2] = vz;
  }

  // XSPH viscosity (normalized, Jacobi passes)
  for (let pass = 0; pass < mat.passes; pass++) {
    const c = mat.visc;
    for (let i = 0; i < N; i++) {
      const i3 = i * 3, pix = p[i3], piy = p[i3 + 1], piz = p[i3 + 2];
      let sx = 0, sy = 0, sz = 0, ws = 0;
      const base = i * MAXNB, cnt = nbc[i];
      for (let k = 0; k < cnt; k++) {
        const j3 = nb[base + k] * 3;
        const dx = pix - p[j3], dy = piy - p[j3 + 1], dz = piz - p[j3 + 2];
        const r2 = dx * dx + dy * dy + dz * dz;
        if (r2 >= 1) continue;
        const w = (1 - r2) * (1 - r2) * (1 - r2);
        sx += (v[j3] - v[i3]) * w; sy += (v[j3 + 1] - v[i3 + 1]) * w; sz += (v[j3 + 2] - v[i3 + 2]) * w; ws += w;
      }
      if (ws > 0) { const f = c / Math.max(ws, 0.6); vt[i3] = v[i3] + sx * f; vt[i3 + 1] = v[i3 + 1] + sy * f; vt[i3 + 2] = v[i3 + 2] + sz * f; }
      else { vt[i3] = v[i3]; vt[i3 + 1] = v[i3 + 1]; vt[i3 + 2] = v[i3 + 2]; }
    }
    v.set(vt.subarray(0, N * 3));
  }

  // adhesion, friction (no-slip-ish), yield stress
  const adh = mat.adh, fric = mat.fric, yld = mat.yield;
  const range = PR + 0.45;
  const minX = paddle ? paddle.x : 0;
  for (let i = 0; i < N; i++) {
    const i3 = i * 3, px = p[i3], py = p[i3 + 1], pz = p[i3 + 2];
    let d = sdfAll(px, py, pz);
    // walls as planes
    let wd = px - minX; if (wd < d) { d = wd; sdN0 = 1; sdN1 = 0; sdN2 = 0; sdVx = paddle ? paddle.vx : 0; sdVy = sdVz = 0; sdBall = -1; }
    wd = W - px; if (wd < d) { d = wd; sdN0 = -1; sdN1 = 0; sdN2 = 0; sdVx = sdVy = sdVz = 0; sdBall = -1; }
    wd = py; if (wd < d) { d = wd; sdN0 = 0; sdN1 = 1; sdN2 = 0; sdVx = sdVy = sdVz = 0; sdBall = -1; }
    wd = pz; if (wd < d) { d = wd; sdN0 = 0; sdN1 = 0; sdN2 = 1; sdVx = sdVy = sdVz = 0; sdBall = -1; }
    wd = D - pz; if (wd < d) { d = wd; sdN0 = 0; sdN1 = 0; sdN2 = -1; sdVx = sdVy = sdVz = 0; sdBall = -1; }
    let vx = v[i3], vy = v[i3 + 1], vz = v[i3 + 2];
    if (d < range) {
      const rx = vx - sdVx, ry = vy - sdVy, rz = vz - sdVz;
      let vn = rx * sdN0 + ry * sdN1 + rz * sdN2;
      let tx = rx - vn * sdN0, ty = ry - vn * sdN1, tz = rz - vn * sdN2;
      if (vn > 0) vn *= (1 - adh);
      vn -= adh * 30 * dt;                      // pull towards surface
      const fk = 1 - fric;
      tx *= fk; ty *= fk; tz *= fk;
      const nvx = sdVx + tx + vn * sdN0, nvy = sdVy + ty + vn * sdN1, nvz = sdVz + tz + vn * sdN2;
      if (sdBall >= 0) { // reaction on the ball (drag)
        const b = balls[sdBall];
        b.J[0] -= (nvx - vx) * dt; b.J[1] -= (nvy - vy) * dt; b.J[2] -= (nvz - vz) * dt;
      }
      vx = nvx; vy = nvy; vz = nvz;
    }
    if (yld > 0) {
      const s = Math.sqrt(vx * vx + vy * vy + vz * vz);
      if (s < yld && dens[i] > 0.85) { const f = s / yld; vx *= f; vy *= f; vz *= f; }
    }
    v[i3] = vx; v[i3 + 1] = vy; v[i3 + 2] = vz;
    x[i3] = px; x[i3 + 1] = py; x[i3 + 2] = pz;
  }

  // rigid ball response: momentum from particle displacements
  for (const b of balls) {
    b.v[0] += b.J[0] / (b.m * dt); b.v[1] += b.J[1] / (b.m * dt); b.v[2] += b.J[2] / (b.m * dt);
    const s = Math.hypot(b.v[0], b.v[1], b.v[2]);
    if (s > 120) for (let a = 0; a < 3; a++) b.v[a] *= 120 / s;
  }
}

function ballWalls(b) {
  const r = b.r;
  const lim = [[paddle ? paddle.x + r : r, W - r], [r, H - r], [r, D - r]];
  for (let a = 0; a < 3; a++) {
    if (b.p[a] < lim[a][0]) { b.p[a] = lim[a][0]; if (b.v[a] < 0) b.v[a] *= -0.3; if (a === 0 && paddle && b.v[0] < paddle.vx) b.v[0] = paddle.vx; }
    if (b.p[a] > lim[a][1]) { b.p[a] = lim[a][1]; if (b.v[a] > 0) b.v[a] *= -0.3; }
  }
  if (b.p[1] <= r + 1e-3) { b.v[0] *= 0.98; b.v[2] *= 0.98; }
  // static obstacles
  const d = sdfStatic(b.p[0], b.p[1], b.p[2]);
  if (d < r) {
    const c = r - d;
    b.p[0] += sdN0 * c; b.p[1] += sdN1 * c; b.p[2] += sdN2 * c;
    const vn = b.v[0] * sdN0 + b.v[1] * sdN1 + b.v[2] * sdN2;
    if (vn < 0) { b.v[0] -= 1.3 * vn * sdN0; b.v[1] -= 1.3 * vn * sdN1; b.v[2] -= 1.3 * vn * sdN2; }
  }
}
function ballBall() {
  for (let i = 0; i < balls.length; i++) for (let j = i + 1; j < balls.length; j++) {
    const a = balls[i], b = balls[j];
    const dx = b.p[0] - a.p[0], dy = b.p[1] - a.p[1], dz = b.p[2] - a.p[2];
    const l = Math.hypot(dx, dy, dz) || 1e-6, R = a.r + b.r;
    if (l < R) {
      const n = [dx / l, dy / l, dz / l], c = R - l, wa = b.m / (a.m + b.m), wb = 1 - wa;
      const rel = (b.v[0] - a.v[0]) * n[0] + (b.v[1] - a.v[1]) * n[1] + (b.v[2] - a.v[2]) * n[2];
      for (let k = 0; k < 3; k++) {
        a.p[k] -= n[k] * c * wa; b.p[k] += n[k] * c * wb;
        if (rel < 0) { a.v[k] += n[k] * rel * wa * 1.4; b.v[k] -= n[k] * rel * wb * 1.4; }
      }
    }
  }
}

function postSceneInfo() {
  self.postMessage({
    type: 'scene', name: sceneName, W, H, D,
    obstacles: obstacles.map(o => ({ ...o })), hasPaddle: !!paddle,
    radius: SPACING * 0.5,
  });
}

function throwBall(o, d, r, density) {
  // find ray entry into the domain box
  let t0 = 0, t1 = 1e9;
  const lo = [r, r, r], hi = [W - r, H - r, D - r];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-8) { if (o[a] < lo[a] || o[a] > hi[a]) { t0 = 1e9; } continue; }
    let ta = (lo[a] - o[a]) / d[a], tb = (hi[a] - o[a]) / d[a];
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
  }
  let pos;
  if (t0 > t1 || t0 >= 1e8) pos = [W / 2, H - r - 0.5, D / 2];
  else pos = [o[0] + d[0] * t0, o[1] + d[1] * t0, o[2] + d[2] * t0];
  addBall(pos, [d[0] * 45, d[1] * 45, d[2] * 45], r, density);
}

let lastMs = 0;
self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'scene') { if (m.material) mat = MATERIALS[m.material]; loadScene(m.name); }
  else if (m.type === 'material') { mat = MATERIALS[m.name] || mat; }
  else if (m.type === 'throw') throwBall(m.o, m.d, m.r || 2, m.density || 2);
  else if (m.type === 'tick') {
    const t0 = performance.now();
    if (!m.paused) for (let s = 0; s < m.substeps; s++) step(m.dt);
    lastMs = performance.now() - t0;
    const pos = x.slice(0, N * 3), dn = dens.slice(0, N);
    self.postMessage({
      type: 'frame', N, pos, dens: dn, simMs: lastMs,
      balls: balls.map(b => ({ p: b.p.slice(), r: b.r, density: b.density })),
      paddleX: paddle ? paddle.x : null,
    }, [pos.buffer, dn.buffer]);
  }
};

// allow headless testing under node
if (typeof module !== 'undefined') module.exports = { loadScene, step, get N() { return N; }, x, v, dens, setMat: n => { mat = MATERIALS[n]; }, balls: () => balls, addBall };
