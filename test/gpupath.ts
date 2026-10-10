/* Emulates the GPU path exactly: builds the padded RGBA32F texture the way
   DentAtlasGpu uploads it, then runs a line-for-line transliteration of the
   GLSL in render/vat.ts against it. If this disagrees with the CPU reference
   the screen shows garbage, and there is no way to see that from a PNG made
   by the CPU path alone. */
import { bakeDentAtlas } from '../src/frac/dentmap';
import { DentField, MAX_DENTS } from '../src/app/dentfield';
import { TEXW } from '../src/render/vat';
import { buildBoxShell, shellNormals } from '../src/geom/carbody';
import { v3, V3 } from '../src/core/math';

const atlas = bakeDentAtlas();
const RES = atlas.res, FRAMES = atlas.frames;

// ---- exactly what DentAtlasGpu does to get the data onto the GPU
const texels = atlas.types.length * FRAMES * RES * RES;
const rows = Math.ceil(texels / TEXW);
const padded = rows * TEXW * 4;
const mk = (src: Float32Array) => {
  const d = new Float32Array(padded);
  d.set(src.subarray(0, Math.min(src.length, padded)));
  return d;
};
const posTex = mk(atlas.pos), nrmTex = mk(atlas.nrm);
console.log(`atlas ${atlas.types.length}x${FRAMES}x${RES}^2 = ${texels} texels -> ${TEXW}x${rows} RGBA32F`);
if (texels > padded / 4) throw new Error('texture too small for the atlas: data would be truncated');

let bad = 0;
const fail = (m: string) => { console.log(`  FAIL ${m}`); bad++; };

// ---- GLSL transliteration -------------------------------------------------
const clampi = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
function vatFetch(t: Float32Array, idx: number): number[] {
  const x = idx % TEXW, y = Math.floor(idx / TEXW);       // texelFetch(t, ivec2(...))
  const o = (y * TEXW + x) * 4;
  return [t[o], t[o + 1], t[o + 2], t[o + 3]];
}
function dentTexel(t: Float32Array, type: number, frame: number, cx: number, cy: number): number[] {
  const rr = RES;
  cx = clampi(cx, 0, rr - 1); cy = clampi(cy, 0, rr - 1);
  return vatFetch(t, ((type * FRAMES + frame) * rr + cy) * rr + cx);
}
const mix = (a: number[], b: number[], w: number) => a.map((v, i) => v + (b[i] - v) * w);
function dentBilinear(t: Float32Array, type: number, frame: number, u: number, v: number): number[] {
  const fx = u * (RES - 1), fy = v * (RES - 1);
  const i0 = Math.floor(fx), j0 = Math.floor(fy);
  const wx = fx - Math.floor(fx), wy = fy - Math.floor(fy);
  const a = dentTexel(t, type, frame, i0, j0);
  const b = dentTexel(t, type, frame, i0 + 1, j0);
  const c = dentTexel(t, type, frame, i0, j0 + 1);
  const d = dentTexel(t, type, frame, i0 + 1, j0 + 1);
  return mix(mix(a, b, wx), mix(c, d, wx), wy);
}
function applyDents(
  A: Float32Array, B: Float32Array, C: Float32Array, D: Float32Array, count: number, p0: V3,
): { dp: V3; dmg: number } {
  const dp = v3(0, 0, 0); let dmg = 0;
  for (let k = 0; k < MAX_DENTS; k++) {
    if (k >= count) break;
    const Ak = A.subarray(k * 4, k * 4 + 4), Bk = B.subarray(k * 4, k * 4 + 4);
    const Ck = C.subarray(k * 4, k * 4 + 4), Dk = D.subarray(k * 4, k * 4 + 4);
    const r = [p0.x - Ak[0], p0.y - Ak[1], p0.z - Ak[2]];
    const dt = (q: Float32Array) => r[0] * q[0] + r[1] * q[1] + r[2] * q[2];
    const u = dt(Bk) * Ak[3], v = dt(Ck) * Ak[3];
    if (Math.abs(u) > 1 || Math.abs(v) > 1) continue;
    if (Math.abs(dt(Dk)) > 0.55 / Ak[3]) continue;
    const type = Math.trunc(Ck[3]);
    const fr = Bk[3];
    const f0 = Math.trunc(Math.floor(fr)), f1 = Math.min(f0 + 1, FRAMES - 1);
    const tt = fr - f0;
    const uu = u * 0.5 + 0.5, vv = v * 0.5 + 0.5;
    const d0 = dentBilinear(posTex, type, f0, uu, vv);
    const d1 = dentBilinear(posTex, type, f1, uu, vv);
    const d = mix(d0, d1, tt);
    dp.x += (Bk[0] * d[0] + Ck[0] * d[1] + Dk[0] * d[2]) * Dk[3];
    dp.y += (Bk[1] * d[0] + Ck[1] * d[1] + Dk[1] * d[2]) * Dk[3];
    dp.z += (Bk[2] * d[0] + Ck[2] * d[1] + Dk[2] * d[2]) * Dk[3];
    dmg = Math.max(dmg, d[3]);
  }
  return { dp, dmg };
}

// ---- compare against the CPU reference on a real panel --------------------
const field = new DentField(atlas);
field.add(v3(-0.30, 0.12, 0), v3(0, 0, 1), v3(0.1, -0.2, -1), 700);
field.add(v3(0.22, -0.10, 0), v3(0, 0, 1), v3(0, 0, -1), 4200);
field.add(v3(0.05, 0.28, 0), v3(0, 0, 1), v3(-0.3, 0, -1), 12000);
for (const d of field.items) d.level = d.target;
const A = new Float32Array(MAX_DENTS * 4), B = new Float32Array(MAX_DENTS * 4);
const C = new Float32Array(MAX_DENTS * 4), D = new Float32Array(MAX_DENTS * 4);
const n = field.pack(A, B, C, D);
console.log(`packed ${n} instances`);

const shell = buildBoxShell(1.55, 1.05, 0.0012, 0.014);
let worst = 0, touched = 0, gpuMax = 0, cpuMax = 0;
for (let i = 0; i < shell.n; i++) {
  const p = v3(shell.pos[i * 3], shell.pos[i * 3 + 1], shell.pos[i * 3 + 2]);
  const g = applyDents(A, B, C, D, n, p);
  const c = field.sample(p);
  const gl = Math.hypot(g.dp.x, g.dp.y, g.dp.z);
  const cl = Math.hypot(c.d.x, c.d.y, c.d.z);
  gpuMax = Math.max(gpuMax, gl); cpuMax = Math.max(cpuMax, cl);
  if (gl > 1e-6) touched++;
  worst = Math.max(worst, Math.hypot(g.dp.x - c.d.x, g.dp.y - c.d.y, g.dp.z - c.d.z));
}
console.log(`vertices moved by the shader path: ${touched} / ${shell.n}`);
console.log(`max displacement  GPU ${(gpuMax * 1000).toFixed(2)} mm   CPU ${(cpuMax * 1000).toFixed(2)} mm`);
console.log(`max GPU-vs-CPU disagreement: ${(worst * 1e6).toFixed(3)} um`);
if (touched === 0) fail('the shader path moves NO vertices - the screen would show a flat panel');
if (gpuMax < 0.005) fail(`shader displacement is only ${(gpuMax * 1000).toFixed(2)} mm - invisible`);
if (worst > 1e-5) fail(`shader and CPU reference disagree by ${(worst * 1000).toFixed(3)} mm`);

// ---- THE SHADING NORMAL ---------------------------------------------------
// The CPU previews recompute flat normals from the displaced triangles, which
// flatters the result enormously: it shows creases even if the shader's own
// normals are garbage. The app shades with aNrm + dn from the baked normal
// map, so that is what has to be checked.
function shaderNormal(p0: V3, base: V3): V3 {
  const nrm = [base.x, base.y, base.z];
  const dn = [0, 0, 0];
  for (let k = 0; k < n; k++) {
    const Ak = A.subarray(k * 4, k * 4 + 4), Bk = B.subarray(k * 4, k * 4 + 4);
    const Ck = C.subarray(k * 4, k * 4 + 4), Dk = D.subarray(k * 4, k * 4 + 4);
    const r = [p0.x - Ak[0], p0.y - Ak[1], p0.z - Ak[2]];
    const dt = (q: Float32Array) => r[0] * q[0] + r[1] * q[1] + r[2] * q[2];
    const u = dt(Bk) * Ak[3], v = dt(Ck) * Ak[3];
    if (Math.abs(u) > 1 || Math.abs(v) > 1) continue;
    if (Math.abs(dt(Dk)) > 0.55 / Ak[3]) continue;
    const type = Math.trunc(Ck[3]);
    const f0 = Math.trunc(Math.floor(Bk[3]));
    const f1 = Math.min(f0 + 1, FRAMES - 1);
    const tt = Bk[3] - f0;
    const uu = u * 0.5 + 0.5, vv = v * 0.5 + 0.5;
    const nl = mix(dentBilinear(nrmTex, type, f0, uu, vv), dentBilinear(nrmTex, type, f1, uu, vv), tt);
    const nw = [0, 1, 2].map((c) => Bk[c] * nl[0] + Ck[c] * nl[1] + Dk[c] * nl[2]);
    const L = Math.hypot(nw[0], nw[1], nw[2]) || 1;
    for (let c = 0; c < 3; c++) dn[c] += nw[c] / L - Dk[c];
  }
  const o = [0, 1, 2].map((c) => nrm[c] + dn[c]);
  const L = Math.hypot(o[0], o[1], o[2]) || 1;
  return v3(o[0] / L, o[1] / L, o[2] / L);
}

// true geometric normal of the deformed sheet, area weighted
const dpos = new Float32Array(shell.pos);
for (let i = 0; i < shell.n; i++) {
  const p = v3(shell.pos[i * 3], shell.pos[i * 3 + 1], shell.pos[i * 3 + 2]);
  const g = applyDents(A, B, C, D, n, p);
  dpos[i * 3] += g.dp.x; dpos[i * 3 + 1] += g.dp.y; dpos[i * 3 + 2] += g.dp.z;
}
const trueN = shellNormals(dpos, shell.tris);
const flatN = shellNormals(shell.pos, shell.tris);

let sum = 0, cnt = 0, worstAng = 0;
for (let i = 0; i < shell.n; i++) {
  const p = v3(shell.pos[i * 3], shell.pos[i * 3 + 1], shell.pos[i * 3 + 2]);
  const g = applyDents(A, B, C, D, n, p);
  if (Math.hypot(g.dp.x, g.dp.y, g.dp.z) < 2e-3) continue;      // only inside dents
  const base = v3(flatN[i * 3], flatN[i * 3 + 1], flatN[i * 3 + 2]);
  const s = shaderNormal(p, base);
  const t = v3(trueN[i * 3], trueN[i * 3 + 1], trueN[i * 3 + 2]);
  const ang = Math.acos(Math.max(-1, Math.min(1, s.x * t.x + s.y * t.y + s.z * t.z))) * 180 / Math.PI;
  sum += ang; cnt++; worstAng = Math.max(worstAng, ang);
}
console.log(`\nshading normal vs true deformed surface, over ${cnt} dented vertices:`);
console.log(`  mean error ${(sum / cnt).toFixed(1)} deg, worst ${worstAng.toFixed(1)} deg`);
if (sum / cnt > 12) fail(`the shader shades a ${(sum / cnt).toFixed(0)}-degree-wrong surface: ` +
  'geometry folds but the lighting stays flat, so on screen you see almost nothing');

console.log(bad === 0 ? '\nGPU path OK' : `\n${bad} FAILURES`);
process.exit(bad === 0 ? 0 : 1);
