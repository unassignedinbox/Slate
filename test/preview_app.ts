/*
 * "Render what the user sees."
 *
 * Every other headless preview in this repo rasterises FLAT normals recomputed
 * from the displaced triangles. That is not what the app draws: the app draws
 * smooth vertex normals coming out of the vertex shader, which for a stamped
 * dent means the baked normal map. The two can look completely different - the
 * geometry can fold beautifully while the shading stays glassy and flat - so
 * this preview runs the shader's OWN normals through a light model close to
 * the renderer's, from the app's own camera.
 */
import { SCENES, makeScene, SheetScene, CarScene } from '../src/app/scenes';
import { DentField, MAX_DENTS } from '../src/app/dentfield';
import { bakeDentAtlas, DentAtlas } from '../src/frac/dentmap';
import { shellNormals, IndexedShell } from '../src/geom/carbody';
import { Canvas, View, triSmooth, v3 } from './raster';
import { V3, norm, add, mul } from '../src/core/math';

const atlas: DentAtlas = bakeDentAtlas();
const RES = atlas.res, FRAMES = atlas.frames;
const clampi = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const mixv = (a: number[], b: number[], w: number) => a.map((v, i) => v + (b[i] - v) * w);

function bil(src: Float32Array, type: number, frame: number, u: number, v: number): number[] {
  const fx = u * (RES - 1), fy = v * (RES - 1);
  const i0 = Math.floor(fx), j0 = Math.floor(fy);
  const wx = fx - i0, wy = fy - j0;
  const tx = (i: number, j: number) => {
    const ii = clampi(i, 0, RES - 1), jj = clampi(j, 0, RES - 1);
    const o = ((type * FRAMES + frame) * RES * RES + jj * RES + ii) * 4;
    return [src[o], src[o + 1], src[o + 2], src[o + 3]];
  };
  return mixv(mixv(tx(i0, j0), tx(i0 + 1, j0), wx), mixv(tx(i0, j0 + 1), tx(i0 + 1, j0 + 1), wx), wy);
}

/** The vertex shader, on the CPU: position AND normal. */
function shade(
  A: Float32Array, B: Float32Array, C: Float32Array, D: Float32Array, n: number,
  p0: V3, base: V3,
): { p: V3; n: V3 } {
  const dp = [0, 0, 0], dn = [0, 0, 0];
  for (let k = 0; k < n; k++) {
    const Ak = A.subarray(k * 4), Bk = B.subarray(k * 4), Ck = C.subarray(k * 4), Dk = D.subarray(k * 4);
    const r = [p0.x - Ak[0], p0.y - Ak[1], p0.z - Ak[2]];
    const dt = (q: Float32Array) => r[0] * q[0] + r[1] * q[1] + r[2] * q[2];
    const u = dt(Bk) * Ak[3], v = dt(Ck) * Ak[3];
    if (Math.abs(u) > 1 || Math.abs(v) > 1) continue;
    if (Math.abs(dt(Dk)) > 0.55 / Ak[3]) continue;
    const type = Math.trunc(Ck[3]);
    const f0 = Math.floor(Bk[3]), f1 = Math.min(f0 + 1, FRAMES - 1), tt = Bk[3] - f0;
    const uu = u * 0.5 + 0.5, vv = v * 0.5 + 0.5;
    const d = mixv(bil(atlas.pos, type, f0, uu, vv), bil(atlas.pos, type, f1, uu, vv), tt);
    for (let c = 0; c < 3; c++) dp[c] += (Bk[c] * d[0] + Ck[c] * d[1] + Dk[c] * d[2]) * Dk[3];
    const nl = mixv(bil(atlas.nrm, type, f0, uu, vv), bil(atlas.nrm, type, f1, uu, vv), tt);
    const nw = [0, 1, 2].map((c) => Bk[c] * nl[0] + Ck[c] * nl[1] + Dk[c] * nl[2]);
    const L = Math.hypot(nw[0], nw[1], nw[2]) || 1;
    for (let c = 0; c < 3; c++) dn[c] += nw[c] / L - Dk[c];
  }
  const o = [base.x + dn[0], base.y + dn[1], base.z + dn[2]];
  const L = Math.hypot(o[0], o[1], o[2]) || 1;
  return {
    p: v3(p0.x + dp[0], p0.y + dp[1], p0.z + dp[2]),
    n: v3(o[0] / L, o[1] / L, o[2] / L),
  };
}

function drawDeformed(
  c: Canvas, view: View, shell: IndexedShell, base: Float32Array,
  f: DentField, col: [number, number, number], spec: number, rough: number,
): void {
  const A = new Float32Array(MAX_DENTS * 4), B = new Float32Array(MAX_DENTS * 4);
  const C = new Float32Array(MAX_DENTS * 4), D = new Float32Array(MAX_DENTS * 4);
  const n = f.pack(A, B, C, D);
  const P = new Float32Array(shell.n * 3), N = new Float32Array(shell.n * 3);
  for (let i = 0; i < shell.n; i++) {
    const r = shade(A, B, C, D, n,
      v3(shell.pos[i * 3], shell.pos[i * 3 + 1], shell.pos[i * 3 + 2]),
      v3(base[i * 3], base[i * 3 + 1], base[i * 3 + 2]));
    P[i * 3] = r.p.x; P[i * 3 + 1] = r.p.y; P[i * 3 + 2] = r.p.z;
    N[i * 3] = r.n.x; N[i * 3 + 1] = r.n.y; N[i * 3 + 2] = r.n.z;
  }
  const g = (a: Float32Array, i: number) => v3(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]);
  for (let t = 0; t < shell.tris.length; t += 3) {
    const a = shell.tris[t], b = shell.tris[t + 1], d = shell.tris[t + 2];
    triSmooth(c, view, [g(P, a), g(P, b), g(P, d)], [g(N, a), g(N, b), g(N, d)], col, spec, rough);
  }
}

// camera exactly like main.ts: target, dist, yaw, pitch
const cam = (tgt: V3, dist: number, yaw: number, pitch: number, vx: number, W: number, H: number): View => {
  const e = add(tgt, mul(v3(
    Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw)), dist));
  return { eye: e, ctr: tgt, scale: 0.62, vx, vy: 0, vw: W, vh: H };
};

const W = 760, H = 620;
const c = new Canvas(W * 3, H);

// ---- the sheet scene, as the app shows it
const sheet = makeScene(SCENES.find((s) => s.id === 'sheet')!) as SheetScene;
sheet.dents = new DentField(atlas);
for (const [x, y, e] of [[-0.40, 0.20, 800], [0.10, -0.12, 4200], [0.44, 0.24, 14000]] as const) {
  sheet.hit(v3(x, sheet.originY + y, sheet.T / 2), v3(0, 0, -1), e);
}
for (const d of sheet.dents.items) d.level = d.target;
const sBase = shellNormals(sheet.shell.pos, sheet.shell.tris);
// NB: dent instances live in OBJECT space (the app applies them in the vertex
// shader, before the model matrix), so deform first and translate after.
drawDeformed(c, cam(v3(0, 0, 0), 3.1, 0.6, 0.22, 0, W, H),
  sheet.shell, sBase, sheet.dents, [78, 86, 96], 1.0, 0.14);

// ---- the car, stamped dents only
const car = makeScene(SCENES.find((s) => s.id === 'car')!) as CarScene;
car.dents = new DentField(atlas);
for (const [x, y, z, e] of [
  [0.34, 0.12, 0.95, 9000], [-1.20, 0.10, 0.92, 15000],
  [0.95, 0.52, 0.30, 2600], [-0.45, 0.05, 0.95, 4500],
] as const) {
  const p = v3(x, y, z);
  car.dents.add(p, car.rig.normalAt(p), v3(-0.2, -0.3, -1), e);
}
for (const d of car.dents.items) d.level = d.target;
const cBase = shellNormals(car.rig.shell.pos, car.rig.shell.tris);
const paint: [number, number, number] = [36, 66, 112];
drawDeformed(c, cam(v3(0, 0.1, 0), 6.4, 0.9, 0.18, W, W, H), car.rig.shell, cBase, car.dents, paint, 1.0, 0.13);
drawDeformed(c, cam(v3(-0.2, 0.05, 0.5), 2.6, 0.30, 0.10, 2 * W, W, H), car.rig.shell, cBase, car.dents, paint, 1.0, 0.13);

c.save('/tmp/app.png');
console.log('wrote /tmp/app.png');
