// Broken road runs.
//
// A street is built slab by slab along the route. Rules that keep it drivable:
//  * each crack is ONE plane shared by the slabs either side (so the two edges
//    are parallel; the pieces look like they genuinely split apart),
//  * a joint always steps DOWN onto the next slab (dropA), never up, and the
//    step is sized against the local grade so uphill streets stay clean,
//  * slabs never pitch-wobble (only roll/yaw), so the centre line at a joint is
//    governed by the swell field alone, which both slabs share.
import * as THREE from 'three';
import { MeshBuilder, K, PAL, lin } from '../../core/geo.js';
import { fracturePoly, centrePoly, clipPoly, transformPoly } from '../../core/fracture.js';
import { F } from '../../core/world.js';
import { makeParent } from '../../core/motion.js';
import { boxP, clipAll, soilUnderside, V3 } from '../ctx.js';

const C = {
  asphalt: () => lin(PAL.asphalt), curb: () => lin(PAL.curb), pave: () => lin(PAL.pave),
  cut: () => lin(PAL.cut), soil: () => lin(PAL.soil),
};

export function roadRun(ctx, s0, s1, o = {}) {
  const rng = ctx.rng.fork(Math.round(s0 * 7));
  const R = ctx.route;
  const W = o.width ?? 9, walk = o.walk ?? 2.3, curb = 0.12, th = 0.45, fd = o.foundation ?? 0.9;
  const total = W + 2 * walk;
  const lenR = o.len ?? [8, 14], gapR = o.gap ?? [0.2, 0.7], dropR = o.drop ?? [0.04, 0.14];
  const slabs = [];
  let s = s0;
  while (s < s1 - 0.5) {
    let L = rng.range(lenR[0], lenR[1]);
    if (s1 - (s + L) < lenR[0] * 0.7) L = s1 - s;
    const sB = Math.min(s1, s + L);
    slabs.push({ sA: s, sB, gapAfter: 0 });
    const g = rng.range(gapR[0], gapR[1]);
    slabs[slabs.length - 1].gapAfter = g;
    s = sB + g;
  }
  const crackAng = slabs.map(() => rng.range(-1, 1) * (o.crackAngle ?? 0.2));
  const out = [];
  for (let i = 0; i < slabs.length; i++) {
    const { sA, sB } = slabs[i];
    const prevGap = i > 0 ? slabs[i - 1].gapAfter : 0;
    const grade = R.at(sA).grade;
    let drop = i === 0 ? (o.firstDrop ?? 0) : rng.range(dropR[0], dropR[1]) + Math.max(0, grade * prevGap);
    const fr = ctx.frame(sA, sB, {
      dropA: drop,
      lat: (o.latJitter ?? 0.35) * rng.range(-1, 1),
      yaw: (o.yawJitter ?? 0.01) * rng.range(-1, 1),
    });
    const L = fr.len;
    const thS = i > 0 ? crackAng[i - 1] : 0, thE = i < slabs.length - 1 ? crackAng[i] : 0;
    const ext = (total / 2) * Math.max(Math.abs(Math.tan(thS)), Math.abs(Math.tan(thE))) + 0.2;
    const planes = [
      [V3(Math.sin(thE), 0, Math.cos(thE)), Math.cos(thE) * L / 2],
      [V3(-Math.sin(thS), 0, -Math.cos(thS)), Math.cos(thS) * L / 2],
    ];
    const BL = L + 2 * ext;
    const gmat = new THREE.Matrix4().makeTranslation(o.latOffsetPattern ?? 0, 0, fr.sMid);
    const rock = o.rock && rng.chance(o.rock) ? rng.range(0.025, 0.045) : 0;
    const motion = {
      swell: 1, ends: true, ext: [total / 2, L / 2],
      rot: { x: 0, y: rng.range(0.0015, 0.004), z: rock || rng.range(0.002, 0.005), f: rng.range(0.35, 0.7), p: rng.range(0, 6.28) },
    };
    const crumble = o.crumble && i > 0 && i < slabs.length - 1 && rng.chance(o.crumble);
    const flags = F.DRIVABLE | F.ROUTE;

    if (crumble) {
      // one tall block, fractured top-to-bottom; pieces ride a shared parent until released
      const block = clipAll(boxP(total, th + fd, BL, new THREE.Matrix4().makeTranslation(0, -(th + fd) / 2, 0),
        { top: K.ROAD, bottom: K.SOIL, side: K.CUT }, { top: C.asphalt(), bottom: C.soil(), side: C.cut() }), planes);
      const pieces = fracturePoly(block, {
        count: rng.int(3, 5), rng, minFrac: 0.1, jitter: 0.25, cutColor: C.cut(),
        normalFn: (r) => new THREE.Vector3(r.gauss(), r.gauss() * 0.08, r.gauss() * 0.6),
      });
      const par = makeParent(fr.pos, fr.quat, motion);
      const bodies = [];
      for (const pc of pieces) {
        const { poly, centroid } = centrePoly(pc);
        const mb = new MeshBuilder();
        const gm = new THREE.Matrix4().makeTranslation(centroid.x, centroid.y, centroid.z).premultiply(gmat);
        mb.convex(poly, undefined, gm);
        const wpos = centroid.clone().applyQuaternion(fr.quat).add(fr.pos);
        bodies.push(ctx.body({
          mb, pos: wpos, quat: fr.quat, motion: { parent: par }, flags: flags | F.CRUMBLE,
          colliders: [{ poly, drivable: true, surface: 'road' }], name: 'crumble-slab',
        }));
      }
      ctx.crumbles.push({ sTrigger: sB + (o.crumbleDelay ?? 7), bodies, centre: fr.pos.clone(), up: fr.up.clone(), along: fr.along.clone() });
      out.push({ sA, sB, fr, bodies, crumble: true });
      continue;
    }

    const mb = new MeshBuilder();
    const cols = [];
    const asphalt = clipAll(boxP(W, th, BL, new THREE.Matrix4().makeTranslation(0, -th / 2, 0),
      { top: K.ROAD, side: K.CUT, bottom: K.CUT }, { top: C.asphalt(), side: C.cut(), bottom: C.cut() }), planes);
    if (asphalt) {
      if (o.precrack !== 0 && rng.chance(o.precrack ?? 0.45)) {
        const parts = fracturePoly(asphalt, {
          count: rng.int(2, 3), rng, minFrac: 0.2, jitter: 0.3, cutColor: C.cut(),
          normalFn: (r) => new THREE.Vector3(r.gauss(), 0, r.gauss() * 0.7),
        });
        for (const p of parts) {
          const { centroid } = centrePoly(p);
          const push = centroid.clone().setY(0).normalize().multiplyScalar(rng.range(0.02, 0.07));
          push.y = -rng.range(0.0, 0.025);
          mb.convex(transformPoly(p, new THREE.Matrix4().makeTranslation(push.x, push.y, push.z)), undefined, gmat);
        }
      } else mb.convex(asphalt, undefined, gmat);
      cols.push({ poly: asphalt, drivable: true, surface: 'road' });
    }
    const missing = o.walk !== 0 && rng.chance(o.missingWalk ?? 0.12) ? rng.sign() : 0;
    for (const side of [1, -1]) {
      if (walk <= 0) break;
      const sw = clipAll(boxP(walk, th + curb, BL, new THREE.Matrix4().makeTranslation(side * (W / 2 + walk / 2), -th / 2 + curb / 2, 0),
        { top: K.PAVE, side: K.CUT, bottom: K.CUT }, { top: C.pave(), side: C.curb(), bottom: C.cut() }), planes);
      if (!sw) continue;
      if (side === missing) {
        // the outer half of this pavement has broken away
        const { neg } = clipPoly(sw, V3(side * 0.94, 0, rng.range(-0.35, 0.35)).normalize(), side * (W / 2 + walk * 0.45) * 0.94, K.CUT, C.cut());
        if (neg) { mb.convex(neg, undefined, gmat); cols.push({ poly: neg, drivable: true, surface: 'kerb' }); }
        continue;
      }
      mb.convex(sw, undefined, gmat);
      cols.push({ poly: sw, drivable: true, surface: 'kerb' });
    }
    const found = clipAll(boxP(total - 0.1, fd, BL, new THREE.Matrix4().makeTranslation(0, -th - fd / 2, 0),
      { side: K.CUT, bottom: K.SOIL }, { side: C.soil(), bottom: C.soil() }), planes);
    if (found) { mb.convex(found, undefined, gmat); cols.push({ poly: found, drivable: false, surface: 'solid' }); }
    if (o.soil !== false && L > 5) {
      soilUnderside(mb, total * 0.92, L * 0.85, rng.range(o.soilDepth?.[0] ?? 1.8, o.soilDepth?.[1] ?? 4.5),
        new THREE.Matrix4().makeTranslation(0, -th - fd + 0.02, 0), rng);
    }
    const body = ctx.body({ mb, pos: fr.pos, quat: fr.quat, motion, flags, colliders: cols, name: 'road-slab' });
    body.userData.sA = sA; body.userData.sB = sB;
    out.push({ sA, sB, fr, bodies: [body], crumble: false });
  }
  return out;
}

/** Plain drivable deck piece along the route (roof, floor, plaza tile...) built from explicit kinds. */
export function deckPiece(ctx, sA, sB, o = {}) {
  const rng = ctx.rng.fork(Math.round(sA * 13));
  const fr = ctx.frame(sA, sB, { dropA: o.dropA || 0, lat: o.lat || 0, yaw: o.yaw || 0 });
  const w = o.width ?? 14, th = o.thick ?? 0.6;
  const ext = o.ext ?? 0;
  const mb = new MeshBuilder();
  const gmat = o.gmat || new THREE.Matrix4().makeTranslation(0, 0, fr.sMid);
  const top = boxP(w, th, fr.len + ext * 2, new THREE.Matrix4().makeTranslation(0, -th / 2, 0),
    { top: o.topKind ?? K.PLAIN, side: o.sideKind ?? K.CUT, bottom: K.CUT }, { top: o.topCol ?? lin(PAL.flatRoof), side: o.sideCol ?? lin(PAL.cut), bottom: lin(PAL.cut) });
  mb.convex(top, undefined, gmat);
  const motion = o.motion ?? { swell: 1, ends: true, ext: [w / 2, fr.len / 2], rot: { x: 0, y: 0.002, z: 0.003, f: rng.range(0.3, 0.6), p: rng.range(0, 6) } };
  const body = ctx.body({ mb, pos: fr.pos, quat: fr.quat, motion, flags: F.DRIVABLE | F.ROUTE, colliders: [{ poly: top, drivable: true, surface: o.surface || 'deck' }], name: o.name || 'deck' });
  return { body, fr };
}
