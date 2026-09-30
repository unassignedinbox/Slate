/* Headless check of the sheet-metal bake: pristine body, a front-corner crush,
   a door dent, and the same door dent driven through the deformation cage
   (so the per-vertex VAT and the lattice path can be compared). */
import { CarRig } from '../src/app/carrig';
import { evalCage } from '../src/frac/dent';
import { makeScene, SCENES, RenderPiece } from '../src/app/scenes';
import { m4TransformPoint, v3 as V3f } from '../src/core/math';
import { Canvas, View, drawShell, tri, v3, norm, cross, sub, dot } from './raster';

const rig = new CarRig();
const n = rig.shell.n;
console.log(`shell: ${n} welded verts, ${rig.shell.tris.length / 3} tris, ` +
  `${rig.topo.edgeRest.length} stretch + ${rig.topo.bendRest.length} bend constraints`);
console.log(`cage:  ${rig.cage.nx}x${rig.cage.ny}x${rig.cage.nz} = ${rig.cage.nodes} nodes`);

const W = 560, H = 400;
const c = new Canvas(W * 4, H);
const view = (i: number, eye: [number, number, number], scale: number): View => ({
  eye: v3(...eye), ctr: v3(0, 0, 0), scale, vx: i * W, vy: 0, vw: W, vh: H,
});

const paint: [number, number, number] = [42, 78, 132];

// 0 ------------------------------------- full assembly, straight from the scene
{
  const scene = makeScene(SCENES.find((x) => x.id === 'car')!);
  const pieces: RenderPiece[] = [];
  scene.collect(pieces);
  const vw = view(0, [4.6, 2.4, 5.0], 1.05);
  vw.ctr = V3f(0, 0.95, 0);
  vw.eye = V3f(4.6, 2.4, 5.0);
  const key = norm(v3(0.45, 0.8, 0.4));
  console.log(`scene pieces: ${pieces.length} (${pieces.filter((p) => p.glass).length} glass)`);
  for (const pc of pieces) {
    const m = pc.model;
    const col: [number, number, number] = pc.glass
      ? [pc.color[0] * 255 * 1.4 + 60, pc.color[1] * 255 * 1.4 + 60, pc.color[2] * 255 * 1.4 + 70]
      : [pc.color[0] * 255, pc.color[1] * 255, pc.color[2] * 255];
    const idx = pc.mesh.idx;
    const ntri = idx ? idx.length / 3 : pc.mesh.count / 3;
    for (let t = 0; t < ntri; t++) {
      const g = (k: number) => {
        const vi = idx ? idx[t * 3 + k] : t * 3 + k;
        return m4TransformPoint(m, V3f(pc.mesh.pos[vi * 3], pc.mesh.pos[vi * 3 + 1], pc.mesh.pos[vi * 3 + 2]));
      };
      const A = g(0), B = g(1), C = g(2);
      const nn = norm(cross(sub(B, A), sub(C, A)));
      const l = 0.2 + 0.9 * Math.max(0, dot(nn, key));
      tri(c, vw, A, B, C, [col[0] * l, col[1] * l, col[2] * l]);
    }
  }
}

// 1 ------------------------------------------------- front corner, full crush
for (const i of [0, 1]) {
  const s = rig.ensureBaked(i);
  s.level = s.target = rig.frames - 1;
}
let t0 = Date.now();
let def = rig.deformed();
console.log(`front crush: ${rig.bakedCount} sites baked in ${rig.bakeMs.toFixed(0)} ms, ` +
  `eval ${Date.now() - t0} ms`);
drawShell(c, view(1, [4.6, 1.3, 2.2], 1.15), def, rig.shell.tris, paint);

// 2 ------------------------------------------ front corner crush, 60 % in
rig.reset();
const door = rig.ensureBaked(0);
door.level = door.target = (rig.frames - 1) * 0.6;
def = rig.deformed();
drawShell(c, view(2, [3.4, 1.1, -2.6], 1.15), def, rig.shell.tris, paint);

// 3 -------------------------------------- same dent, but through the CAGE
const cageFrames = door.cage!;
const nodes = rig.cage.nodes;
const f0 = Math.floor(door.level), f1 = Math.min(f0 + 1, rig.frames - 1);
const tt = door.level - f0;
const blend = new Float32Array(nodes * 4);
for (let i = 0; i < nodes * 4; i++) {
  blend[i] = cageFrames[f0 * nodes * 4 + i] * (1 - tt) + cageFrames[f1 * nodes * 4 + i] * tt;
}
const viaCage = new Float32Array(rig.shell.pos);
let maxErr = 0, sumErr = 0;
for (let i = 0; i < n; i++) {
  const p = v3(rig.shell.pos[i * 3], rig.shell.pos[i * 3 + 1], rig.shell.pos[i * 3 + 2]);
  const d = evalCage(rig.cage, blend, p);
  viaCage[i * 3] += d.x; viaCage[i * 3 + 1] += d.y; viaCage[i * 3 + 2] += d.z;
  const ex = Math.hypot(viaCage[i * 3] - def[i * 3], viaCage[i * 3 + 1] - def[i * 3 + 1], viaCage[i * 3 + 2] - def[i * 3 + 2]);
  maxErr = Math.max(maxErr, ex); sumErr += ex;
}
console.log(`cage vs per-vertex: mean ${(sumErr / n * 1000).toFixed(2)} mm, max ${(maxErr * 1000).toFixed(1)} mm`);
drawShell(c, view(3, [1.2, 1.5, 5.4], 1.15), viaCage, rig.shell.tris, paint);

// depth report
rig.reset();
const s0 = rig.ensureBaked(1);
for (let f = 0; f < rig.frames; f += 4) {
  s0.level = s0.target = f;
  const d = rig.deformed();
  let mx = 0;
  for (let i = 0; i < n; i++) {
    mx = Math.max(mx, Math.hypot(
      d[i * 3] - rig.shell.pos[i * 3], d[i * 3 + 1] - rig.shell.pos[i * 3 + 1],
      d[i * 3 + 2] - rig.shell.pos[i * 3 + 2]));
  }
  console.log(`  frame ${String(f).padStart(2)}: max permanent displacement ${(mx * 1000).toFixed(1)} mm`);
}

// patch sizes: how much of the body each bake actually stores
let tot = 0;
const t1 = Date.now();
for (let i = 0; i < rig.sites.length; i++) {
  const b = rig.ensureBaked(i).bake!;
  tot += b.count;
  console.log(`  site ${String(i).padStart(2)} ${rig.sites[i].site.label.padEnd(22)} ` +
    `patch ${String(b.count).padStart(5)} verts (${(b.count / n * 100).toFixed(1)} %)  ${b.ms.toFixed(0)} ms`);
}
console.log(`all ${rig.sites.length} sites: ${tot} patch verts, ${((Date.now() - t1) / 1000).toFixed(1)} s total, ` +
  `VAT = ${(tot * rig.frames * 2 * 16 / 1048576).toFixed(1)} MB`);

c.save('/tmp/car.png');
console.log('wrote /tmp/car.png');
