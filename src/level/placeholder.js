// Placeholder section: a neutral floating runway in the same world, far from the
// designed sections, so the last portal has somewhere real to send you and the
// "many worlds in one level" chain works end to end. Its design is a later job;
// nothing here pre-empts it. (Section 2 lived here until it was designed.)
import * as THREE from 'three';
import { MeshBuilder, K, PAL, lin } from '../core/geo.js';
import { F } from '../core/world.js';
import { RouteBuilder } from '../core/route.js';
import { makeParent } from '../core/motion.js';
import { LevelCtx, boxP, soilUnderside, V3, Q } from './ctx.js';
import { roadRun } from './kit/road.js';
import { chunkify } from './kit/buildings.js';

const T = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z);

export function buildPlaceholder(world, origin, headingDeg, { n = 3, seed = 3303 } = {}) {
  const id = `${n}A`;
  const route = new RouteBuilder({ start: [origin.x, origin.y, origin.z], heading: headingDeg, width: 22, speed: 60 })
    .beat(id, `SECTION ${n} (TO BE DESIGNED)`)
    .straight(280, { dy: -3, surface: 'road' })
    .build();
  const ctx = new LevelCtx({ world, route, seed, name: `SECTION ${n}`, section: `S${n}` });
  ctx.beat = id;
  roadRun(ctx, 0, 280, { width: 18, walk: 2, len: [34, 50], gap: [0.1, 0.3], drop: [0.02, 0.05], precrack: 0.3, soilDepth: [6, 12], missingWalk: 0 });
  const rng = ctx.rng;
  // scale blocks along the runway: 4 m grid cubes, plain greybox
  for (let s = 30; s < 270; s += 24) {
    for (const side of [1, -1]) {
      const p = ctx.poseAt(s, side * rng.range(16, 30), rng.range(-2, 10), 0, rng.range(0, 1));
      const mb = new MeshBuilder();
      const h = rng.pick([4, 8, 12]);
      mb.box(4, h, 4, T(0, h / 2, 0), K.PLAIN, lin(PAL.wall2));
      ctx.body({ mb, pos: p.pos, quat: p.quat, motion: { swell: 1, ext: [2, 2], bob: { a: 0.4, f: 0.3, p: s }, rot: { x: 0.02, y: 0.03, z: 0.02, f: 0.2, p: s } }, colliders: [{ poly: boxP(4, h, 4, T(0, h / 2, 0), K.PLAIN, lin(PAL.wall2)) }], name: 'placeholder-block' });
    }
  }
  // finish gate at s = 250
  const f = route.at(250);
  const yaw = Math.atan2(f.t.x, f.t.z);
  const gq = Q(0, yaw, 0);
  const gc = route.pos(250);
  const P = makeParent(gc, gq, { swell: 1, ext: [12, 2] });
  chunkify(ctx, [
    { poly: boxP(1.6, 9, 1.6, T(-12, 4.5, 0), K.STONE, lin(PAL.stone)), fixed: true },
    { poly: boxP(1.6, 9, 1.6, T(12, 4.5, 0), K.STONE, lin(PAL.stone)), fixed: true },
    { poly: boxP(25.6, 1.4, 1.6, T(0, 9.7, 0), K.MARK, lin(PAL.white)), fixed: true },
  ], { pos: gc, quat: gq }, { parent: P });
  ctx.label(`END OF GREYBOX  -  SECTION ${n} GOES HERE`, gc.clone().add(V3(0, 14, 0)), { kind: 'portal', size: 1.3 });
  ctx.label(`${id}  SECTION ${n} (TO BE DESIGNED)`, route.pos(20).add(V3(0, 8, 0)), { kind: 'beat', size: 1.2 });
  // arrival gateway (the far side of the previous section's portal)
  const a = route.at(0);
  const ayaw = Math.atan2(a.t.x, a.t.z);
  const aq = Q(0, ayaw, 0);
  const lift = 2.1; // portal centre height above the runway at arrival
  const ac = route.pos(0).add(V3(0, lift, 0));
  const AP = makeParent(ac, aq, { swell: 1, ext: [10, 2] });
  const w = 18, h = 11, post = 2.4, lint = 2.2, depth = 2.6;
  chunkify(ctx, [
    { poly: boxP(post, h + lint, depth, T(-(w / 2 + post / 2), lint / 2, -2), K.STONE, lin(PAL.stone)), fixed: true },
    { poly: boxP(post, h + lint, depth, T(w / 2 + post / 2, lint / 2, -2), K.STONE, lin(PAL.stone)), fixed: true },
    { poly: boxP(w + 2 * post, lint, depth, T(0, h / 2 + lint / 2, -2), K.STONE, lin(PAL.stone)), fixed: true },
  ], { pos: ac, quat: aq }, { parent: AP });
  ctx.respawns.push({ s: 6, pos: route.pos(6).add(V3(0, 0.9, 0)), quat: aq.clone(), speed: 20 });
  return { ctx, route, arrival: { centre: ac, quat: aq, parent: AP }, finishS: 250 };
}
