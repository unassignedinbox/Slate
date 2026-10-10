/* Runs the real per-frame path for every scene, headless: build, update, hit,
   collect, and validate every render piece the way the GPU would consume it.
   This is the check that catches "the app draws nothing". */
import { SCENES, makeScene, Scene, CarScene, SheetScene, RenderPiece } from '../src/app/scenes';
import { DentField } from '../src/app/dentfield';
import { bakeDentAtlas } from '../src/frac/dentmap';
import { v3, norm, sub, add, mul } from '../src/core/math';

const atlas = bakeDentAtlas();
let bad = 0;
const fail = (m: string) => { console.log(`  FAIL ${m}`); bad++; };

function check(tag: string, pieces: RenderPiece[]): void {
  if (pieces.length === 0) fail(`${tag}: no render pieces at all`);
  let verts = 0, glass = 0;
  for (const p of pieces) {
    if (!p.mesh || p.mesh.count === 0) { fail(`${tag}: empty mesh`); continue; }
    verts += p.mesh.count;
    if (p.glass) glass++;
    for (const m of p.model) if (!Number.isFinite(m)) { fail(`${tag}: NaN in model matrix`); break; }
    for (let i = 0; i < Math.min(p.mesh.pos.length, 3000); i++) {
      if (!Number.isFinite(p.mesh.pos[i])) { fail(`${tag}: NaN vertex`); break; }
    }
    if (p.deform !== undefined && (p.deform < 0 || p.deform > 3)) fail(`${tag}: bad deform mode ${p.deform}`);
    if (p.alpha <= 0) fail(`${tag}: invisible piece (alpha ${p.alpha})`);
  }
  console.log(`  ${tag}: ${pieces.length} pieces, ${verts} verts, ${glass} glass`);
}

for (const def of SCENES) {
  console.log(`\n=== ${def.id}  (${def.label})`);
  const scene: Scene = makeScene(def);
  if (scene instanceof CarScene || scene instanceof SheetScene) scene.dents = new DentField(atlas);

  let pieces: RenderPiece[] = [];
  scene.update(0.016, 1, 1);
  scene.collect(pieces);
  check('fresh', pieces);

  // aim a ray at the scene the way main.ts does, from the demo camera
  const tgt = scene.cameraTarget;
  const eye = add(tgt, mul(norm(v3(0.6, 0.35, 1)), scene.cameraDist));
  const rd = norm(sub(tgt, eye));
  const hit = scene.pick(eye, rd);
  if (!hit) { fail('pick returned null aiming straight at the target'); continue; }
  console.log(`  pick: ${hit.point.x.toFixed(2)}, ${hit.point.y.toFixed(2)}, ${hit.point.z.toFixed(2)}`);
  scene.hit(hit.point, rd, def.energy);
  for (let i = 0; i < 40; i++) scene.update(0.016, 1, 1);
  pieces = [];
  scene.collect(pieces);
  check('after hit', pieces);

  if (scene instanceof CarScene || scene instanceof SheetScene) {
    const A = new Float32Array(32), B = new Float32Array(32);
    const C = new Float32Array(32), D = new Float32Array(32);
    const nd = scene.dents.pack(A, B, C, D);
    console.log(`  dents packed: ${nd}`);
    if (nd === 0) fail('hit registered no dent instance');
    for (const arr of [A, B, C, D]) {
      for (let i = 0; i < nd * 4; i++) if (!Number.isFinite(arr[i])) fail('NaN in packed dent uniform');
    }
    if (nd > 0) {
      if (!(A[3] > 0)) fail(`A.w (1/half) must be > 0, got ${A[3]}`);
      if (!(D[3] > 0)) fail(`D.w (scale) must be > 0, got ${D[3]}`);
      if (C[3] < 0 || C[3] > atlas.types.length - 1) fail(`type index out of range: ${C[3]}`);
      if (B[3] < 0 || B[3] > atlas.frames - 1) fail(`frame cursor out of range: ${B[3]}`);
    }
  }
  const st = (scene as unknown as { stats?: () => Record<string, string> }).stats?.() ?? {};
  for (const [k, v] of Object.entries(st)) {
    if (v === undefined || v === null || v === 'NaN' || String(v).includes('NaN')) fail(`stat "${k}" = ${v}`);
  }
  scene.dispose();
}

console.log(bad === 0 ? '\nall scenes OK' : `\n${bad} FAILURES`);
process.exit(bad === 0 ? 0 : 1);
