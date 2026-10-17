// Section 1 dressing: the town around the line. Nothing here is on the racing
// surface; everything is placed through the corridor test so it frames the
// route without ever intruding on it (or on the chase camera's space above it).
import * as THREE from 'three';
import { MeshBuilder, K, PAL, lin } from '../../core/geo.js';
import { fracturePoly, centrePoly, transformPoly } from '../../core/fracture.js';
import { F } from '../../core/world.js';
import { makeParent } from '../../core/motion.js';
import { boxP, soilUnderside, V3, Q } from '../ctx.js';
import { chunkify, houseParts, shopParts, gablePoly, plot, tree } from '../kit/buildings.js';
import { prop, FURNITURE, STREET, VEHICLES } from '../kit/props.js';

const T = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z);
const RT = (x, y, z, rx = 0, ry = 0, rz = 0) => new THREE.Matrix4().compose(V3(x, y, z), Q(rx, ry, rz), V3(1, 1, 1));

/** A house (or shop) on its own torn plot, facing the street. */
export function homestead(ctx, pose, rng, o = {}) {
  const w = o.w ?? rng.range(16, 22), d = o.d ?? rng.range(17, 23);
  const pl = plot(ctx, pose, { w, d, rng, tree: o.tree ?? true, treeChance: o.treeChance ?? 0.55, fence: o.fence ?? true, depth: o.depth });
  const shop = o.shop ?? false;
  const near = o.near ?? false;
  const parts = shop
    ? shopParts(rng, { w: rng.range(10, 14), d: rng.range(10, 13), floors: rng.int(2, 3), chunks: rng.range(0.4, 1.4) })
    : houseParts(rng, { w: rng.range(8, 11), d: rng.range(8, 11), floors: rng.int(2, 3), hollow: near && rng.chance(0.55), chunks: rng.range(0.25, 1.5) });
  const hpos = V3(rng.range(-2, 2), 0.02, rng.range(-1.5, 2.5)).applyQuaternion(pose.quat).add(pose.pos);
  const heavy = rng.chance(0.35);
  chunkify(ctx, parts.parts, { pos: hpos, quat: pose.quat.clone().multiply(Q(0, rng.range(-0.08, 0.08), 0)) }, {
    parent: pl.parent, explode: heavy ? [0.3, 2.2] : [0.05, 0.6], centre: V3(0, parts.H * 0.45, 0), height: parts.H,
    lift: heavy ? 0.06 : 0.02, tilt: heavy ? 0.08 : 0.03, solid: near, rng,
  });
  // contents escaping through the cracks
  if (near || heavy) {
    const n = rng.int(1, heavy ? 4 : 2);
    for (let i = 0; i < n; i++) {
      const p = V3(rng.range(-6, 6), parts.H * rng.range(0.4, 1.3), rng.range(-6, 6)).applyQuaternion(pose.quat).add(hpos);
      prop(ctx, rng.pick(FURNITURE), { pos: p, quat: Q(rng.range(0, 6), rng.range(0, 6), rng.range(0, 6)) }, { rng, drift: 0.8 });
    }
  }
  if (rng.chance(o.carChance ?? 0.3)) {
    const p = V3(rng.sign() * (w / 2 - 3), rng.range(1.0, 2.5), rng.range(-d / 3, d / 3)).applyQuaternion(pose.quat).add(pose.pos);
    prop(ctx, rng.pick(VEHICLES), { pos: p, quat: pose.quat.clone().multiply(Q(rng.range(-0.15, 0.15), rng.range(-0.4, 0.4), rng.range(-0.15, 0.15))) }, { rng, drift: 0.5 });
  }
  return pl;
}

/** Houses on both sides of a street stretch, facing the line. */
export function streetHouses(ctx, s0, s1, o = {}) {
  const rng = ctx.rng.fork(Math.round(s0 * 17 + 3));
  const R = ctx.route;
  const spacing = o.spacing ?? [19, 27];
  let placed = 0;
  for (const side of o.sides ?? [1, -1]) {
    let s = s0 + rng.range(2, spacing[0]);
    while (s < s1) {
      if (!rng.chance(o.skip ?? 0.1)) {
        const f = R.at(s);
        const w = rng.range(16, 22), d = rng.range(17, 23);
        let ok = false;
        for (let tries = 0; tries < 4 && !ok; tries++) {
          const lateral = f.width / 2 + rng.range(o.gap?.[0] ?? 3, o.gap?.[1] ?? 8) + d / 2 + tries * 3;
          const dy = rng.range(o.dy?.[0] ?? -6, o.dy?.[1] ?? 4) - tries;
          const pose = ctx.poseAt(s, side * lateral, dy, 0, -side * Math.PI / 2 + rng.range(-0.18, 0.18), [rng.range(-0.06, 0.06), rng.range(-0.06, 0.06)]);
          if (!ctx.isBoxClear(pose, w / 2, d / 2, -8, 13, { margin: 1.5 })) continue;
          homestead(ctx, pose, rng, { w, d, near: true, shop: rng.chance(o.shops ?? 0.15) });
          ctx.reserve(pose.pos, Math.max(w, d) * 0.55);
          ok = true; placed++;
        }
      }
      s += rng.range(spacing[0], spacing[1]);
    }
  }
  return placed;
}

/** Floating junk around (and lightly across) the line. */
export function scatterJunk(ctx, s0, s1, o = {}) {
  const rng = ctx.rng.fork(Math.round(s0 * 29 + 1));
  const R = ctx.route;
  const types = o.types ?? FURNITURE.concat(STREET);
  for (let s = s0; s < s1; s += rng.range(o.every?.[0] ?? 7, o.every?.[1] ?? 13)) {
    const f = R.at(s);
    if (f.surface === 'air' && !o.air) continue;
    const side = rng.sign();
    const lat = side * rng.range(f.width / 2 + 1.5, f.width / 2 + (o.band ?? 14));
    const up = rng.range(o.up?.[0] ?? -3, o.up?.[1] ?? 9);
    const pose = ctx.poseAt(s, lat, up, rng.range(-3, 3), rng.range(0, 6.28), [rng.range(-1.2, 1.2), rng.range(-1.2, 1.2)]);
    prop(ctx, rng.pick(types), pose, { rng });
  }
  // light things drifting across the lane: chairs, boxes, planks - plough through them
  const inLane = o.inLane ?? 0;
  const LIGHT = ['chair', 'crate', 'cone', 'plank', 'bin', 'lamp', 'suitcase', 'frame', 'rug', 'mattress', 'chair', 'table'];
  for (let i = 0; i < inLane; i++) {
    const s = rng.range(s0, s1);
    const f = R.at(s);
    if (f.surface === 'air') continue;
    const pose = ctx.poseAt(s, rng.range(-f.width / 2 + 2, f.width / 2 - 2), rng.range(1.0, 2.6), 0, rng.range(0, 6.28), [rng.range(-1, 1), rng.range(-1, 1)]);
    prop(ctx, rng.pick(LIGHT), pose, { rng, drift: 0.4 });
  }
}

/** Background mass: plots, houses, street fragments floating in a region. */
export function townFill(ctx, region, count, o = {}) {
  const rng = ctx.rng.fork(o.seed ?? 31337);
  let placed = 0;
  for (let i = 0; i < count * 8 && placed < count; i++) {
    const pos = V3(rng.range(region.x0, region.x1), rng.range(region.y0, region.y1), rng.range(region.z0, region.z1));
    const quat = Q(rng.range(-0.1, 0.1), rng.range(0, Math.PI * 2), rng.range(-0.1, 0.1));
    const w = rng.range(16, 26), d = rng.range(16, 26);
    const pose = { pos, quat };
    if (!ctx.isBoxClear(pose, w / 2, d / 2, -10, 16, { margin: 3, above: 14, below: 9 })) continue;
    const kind = rng.next();
    if (kind < 0.72) homestead(ctx, pose, rng, { w, d, shop: rng.chance(0.2), depth: [4, 12], carChance: 0.25 });
    else if (kind < 0.86) streetFragment(ctx, pose, rng);
    else gardenFragment(ctx, pose, rng);
    ctx.reserve(pos, Math.max(w, d) * 0.6);
    placed++;
  }
  return placed;
}

/** A loose piece of street (not on the line): asphalt, kerbs, a car or two, a lamp. */
export function streetFragment(ctx, pose, rng) {
  const L = rng.range(14, 26);
  const motion = { swell: 1, ext: [7, L / 2], bob: { a: rng.range(0.3, 0.9), f: rng.range(0.2, 0.4), p: rng.range(0, 6) }, rot: { x: 0.02, y: 0.01, z: 0.02, f: 0.2, p: rng.range(0, 6) } };
  const P = makeParent(pose.pos, pose.quat, motion);
  const mb = new MeshBuilder();
  const top = boxP(9, 0.45, L, T(0, -0.22, 0), { top: K.ROAD, side: K.CUT, bottom: K.CUT }, { top: lin(PAL.asphalt), side: lin(PAL.cut), bottom: lin(PAL.cut) });
  mb.convex(top, undefined, T(0, 0, rng.range(0, 100)));
  for (const sx of [-1, 1]) mb.box(2.3, 0.57, L, T(sx * 5.65, -0.16, 0), { top: K.PAVE, side: K.CUT }, { top: lin(PAL.pave), side: lin(PAL.curb) });
  soilUnderside(mb, 13, L * 0.9, rng.range(3, 7), T(0, -0.45, 0), rng);
  ctx.body({ mb, pos: pose.pos, quat: pose.quat, motion: { parent: P }, colliders: [{ poly: top }], name: 'street-fragment' });
  if (rng.chance(0.7)) prop(ctx, rng.pick(VEHICLES), { pos: V3(rng.range(-2, 2), 1.6, rng.range(-L / 4, L / 4)).applyQuaternion(pose.quat).add(pose.pos), quat: pose.quat.clone().multiply(Q(0, rng.range(-0.3, 0.3), 0)) }, { rng, drift: 0.5 });
  if (rng.chance(0.6)) prop(ctx, 'lamppost', { pos: V3(5.6, 3.6, rng.range(-L / 3, L / 3)).applyQuaternion(pose.quat).add(pose.pos), quat: pose.quat.clone().multiply(Q(rng.range(-0.3, 0.3), 0, rng.range(-0.3, 0.3))) }, { rng, drift: 0.4 });
}

export function gardenFragment(ctx, pose, rng) {
  const pl = plot(ctx, pose, { w: rng.range(14, 22), d: rng.range(14, 22), rng, tree: true, treeChance: 1, depth: [4, 10] });
  if (rng.chance(0.6)) tree(ctx, { pos: pose.pos.clone().add(V3(rng.range(-4, 4), 0, rng.range(-4, 4))), quat: pose.quat }, pl.parent, rng, 0.8);
  // garden shed
  if (rng.chance(0.7)) {
    const parts = [
      { poly: boxP(3, 2.4, 2.4, T(0, 1.2, 0), K.FLOOR, lin(PAL.propDark)), count: 2, explode: [0.1, 0.6] },
      { poly: transformPoly(gablePoly(3, 0.9, 2.4, 0.2, { roof: K.ROOF, gable: K.FLOOR }, { roof: lin(PAL.roofDark), gable: lin(PAL.propDark) }), T(0, 2.4, 0)), count: 1, explode: [0.2, 1] },
    ];
    chunkify(ctx, parts, { pos: pose.pos.clone().add(V3(rng.range(-5, 5), 0, rng.range(-5, 5)).applyQuaternion(pose.quat)), quat: pose.quat }, { parent: pl.parent, solid: false, rng });
  }
}

// ---------------------------------------------------------------- landmarks
export function waterTower(ctx, pos, quat, rng) {
  const P = makeParent(pos, quat, { swell: 1, ext: [6, 6], bob: { a: 0.8, f: 0.16, p: 0.4 }, rot: { x: 0.03, y: 0.02, z: 0.03, f: 0.11, p: 1.4 } });
  const mb = new MeshBuilder();
  const m = lin(PAL.metal), wall = lin(PAL.wall2);
  mb.cylinder(5.2, 5.2, 7, 14, T(0, 3.5, 0), K.PLAIN, wall);
  mb.cylinder(5.6, 0.6, 2.6, 14, T(0, 8.3, 0), K.ROOF, lin(PAL.roofDark));
  mb.cylinder(5.4, 2.2, 1.6, 14, T(0, -0.8, 0), K.METAL, m);
  mb.box(11.6, 0.15, 0.8, T(0, 1.4, 5.4), K.METAL, m);
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI / 4;
    const len = rng.range(2.5, 4.5);
    mb.box(0.45, len, 0.45, RT(Math.cos(a) * 3.6, -1.6 - len / 2, Math.sin(a) * 3.6, rng.range(-0.1, 0.1), 0, rng.range(-0.1, 0.1)), K.METAL, m);
  }
  const col = boxP(10.4, 11, 10.4, T(0, 3, 0), K.PLAIN, wall);
  ctx.body({ mb, pos, quat, motion: { parent: P }, colliders: [{ poly: col }], name: 'water-tower' });
  // the snapped-off lower legs, tumbling below
  for (let i = 0; i < 4; i++) {
    const lm = new MeshBuilder();
    lm.box(0.45, rng.range(5, 9), 0.45, T(0, 0, 0), K.METAL, m);
    const a = i * Math.PI / 2 + Math.PI / 4;
    const p = V3(Math.cos(a) * rng.range(4, 9), rng.range(-22, -12), Math.sin(a) * rng.range(4, 9)).applyQuaternion(quat).add(pos);
    ctx.body({ mb: lm, pos: p, quat: Q(rng.range(-0.8, 0.8), rng.range(0, 6), rng.range(-0.8, 0.8)), motion: { swell: 1, ext: [1, 1], bob: { a: 0.6, f: 0.3, p: i }, spin: { axis: [rng.gauss(), rng.gauss(), rng.gauss()], rate: rng.range(0.03, 0.1) } }, flags: F.SCENERY, name: 'tower-leg' });
  }
}

export function mill(ctx, pose, rng) {
  const pl = plot(ctx, pose, { w: 26, d: 22, rng, tree: true, treeChance: 1, fence: false, depth: [6, 12] });
  const stone = lin(PAL.stone);
  const parts = [
    { poly: boxP(12, 9, 10, T(0, 4.5, 0), { side: K.FACADE, top: K.CUT, bottom: K.CUT }, { side: stone, top: lin(PAL.cut), bottom: lin(PAL.cut) }), count: 5, explode: [0.1, 0.9] },
    { poly: transformPoly(gablePoly(12, 4.5, 10, 0.5, { roof: K.ROOF, gable: K.FACADE }, { roof: lin(PAL.roofDark), gable: stone }), T(0, 9, 0)), count: 3, explode: [0.3, 1.5] },
  ];
  chunkify(ctx, parts, { pos: pose.pos.clone().add(V3(-3, 0, 0).applyQuaternion(pose.quat)), quat: pose.quat }, { parent: pl.parent, centre: V3(0, 4, 0), rng });
  // water wheel: turns on its axle (custom spin), mill race below it
  const wm = new MeshBuilder();
  const R = 4.2, wood = lin(PAL.propDark);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    wm.box(0.25, R * 2 * Math.sin(Math.PI / 12) + 0.1, 1.5, RT(Math.cos(a) * R, Math.sin(a) * R, 0, 0, 0, a), K.PROP, wood);
    wm.box(0.15, R, 0.15, RT(Math.cos(a) * R / 2, Math.sin(a) * R / 2, 0.55, 0, 0, a + Math.PI / 2), K.PROP, wood);
    wm.box(0.15, R, 0.15, RT(Math.cos(a) * R / 2, Math.sin(a) * R / 2, -0.55, 0, 0, a + Math.PI / 2), K.PROP, wood);
    wm.box(0.9, 0.08, 1.5, RT(Math.cos(a) * (R + 0.4), Math.sin(a) * (R + 0.4), 0, 0, 0, a), K.PROP, wood);
  }
  wm.cylinder(0.35, 0.35, 2.4, 8, RT(0, 0, 0, Math.PI / 2, 0, 0), K.METAL, lin(PAL.metal));
  const wpos = V3(5.2, 4.6, 0).applyQuaternion(pose.quat).add(pose.pos);
  const wq = pose.quat.clone().multiply(Q(0, Math.PI / 2, 0));
  ctx.body({ mb: wm, pos: wpos, quat: wq, motion: { parent: pl.parent, spin: { axis: [0, 0, 1], rate: 0.45 } }, flags: F.SCENERY, name: 'water-wheel' });
  const race = new MeshBuilder();
  race.box(3, 0.6, 14, T(0, 0, 0), { top: K.WATER, side: K.STONE }, { top: lin(PAL.water), side: stone });
  ctx.body({ mb: race, pos: V3(5.2, -1.2, 0).applyQuaternion(pose.quat).add(pose.pos), quat: pose.quat.clone().multiply(Q(0.05, 0, 0.04)), motion: { parent: pl.parent, bob: { a: 0.3, f: 0.3, p: 1 } }, flags: F.SCENERY, name: 'mill-race' });
}

export function gasStation(ctx, pose, rng) {
  const P = makeParent(pose.pos, pose.quat, { swell: 1, ext: [14, 12], bob: { a: 0.5, f: 0.2, p: 2 }, rot: { x: 0.015, y: 0.01, z: 0.02, f: 0.14, p: 0.3 } });
  const mb = new MeshBuilder();
  const slab = boxP(30, 0.5, 24, T(0, -0.25, 0), { top: K.PAVE, side: K.CUT, bottom: K.SOIL }, { top: lin(PAL.pave), side: lin(PAL.cut), bottom: lin(PAL.soil) });
  mb.convex(slab);
  soilUnderside(mb, 27, 21, 6, T(0, -0.5, 0), rng);
  ctx.body({ mb, pos: pose.pos, quat: pose.quat, motion: { parent: P }, colliders: [{ poly: slab }], name: 'forecourt' });
  const parts = [
    { poly: boxP(16, 0.8, 10, T(-3, 5.6, 0), { side: K.MARK, top: K.FLATROOF, bottom: K.PLAIN }, { side: lin(PAL.white), top: lin(PAL.flatRoof), bottom: lin(PAL.wall2) }), count: 3, explode: [0.3, 1.6] },
    { poly: boxP(9, 4, 7, T(9, 2, 4), { side: K.FACADE + 0.25, top: K.FLATROOF }, { side: lin(PAL.wall), top: lin(PAL.flatRoof) }), count: 3, explode: [0.2, 1.0] },
  ];
  for (const x of [-9, 3]) for (const z of [-3, 3]) parts.push({ poly: boxP(0.5, 5.2, 0.5, T(x, 2.6, z), K.METAL, lin(PAL.metal)), count: 1, explode: [0.1, 0.6] });
  chunkify(ctx, parts, pose, { parent: P, centre: V3(-3, 2, 0), rng, lift: 0.05 });
  for (const x of [-6, 0]) {
    const pm = new MeshBuilder();
    pm.box(0.8, 1.7, 0.5, T(0, 0, 0), K.PROP, lin(PAL.wall3));
    pm.box(0.6, 0.4, 0.05, T(0, 0.4, 0.27), K.GLASS, lin(PAL.glass));
    ctx.body({ mb: pm, pos: V3(x, 1.4 + rng.range(0, 1.5), 0).applyQuaternion(pose.quat).add(pose.pos), quat: pose.quat.clone().multiply(Q(rng.range(-0.3, 0.3), rng.range(-0.5, 0.5), rng.range(-0.3, 0.3))), motion: { parent: P, bob: { a: 0.3, f: 0.5, p: x }, rot: { x: 0.05, y: 0.1, z: 0.05, f: 0.3, p: x } }, flags: F.SCENERY, name: 'pump' });
  }
  const sign = new MeshBuilder();
  sign.box(0.4, 8, 0.4, T(0, 4, 0), K.METAL, lin(PAL.metal));
  sign.box(2.6, 3.2, 0.4, T(0, 8.6, 0), K.MARK, lin(PAL.white));
  ctx.body({ mb: sign, pos: V3(13, 0, -10).applyQuaternion(pose.quat).add(pose.pos), quat: pose.quat.clone().multiply(Q(0.05, 0.3, -0.12)), motion: { parent: P, rot: { x: 0.02, y: 0.02, z: 0.03, f: 0.2, p: 3 } }, flags: F.SCENERY, name: 'price-sign' });
}

export function factory(ctx, pose, rng) {
  const P = makeParent(pose.pos, pose.quat, { swell: 1, ext: [20, 15], bob: { a: 0.6, f: 0.13, p: 0.2 }, rot: { x: 0.01, y: 0.008, z: 0.01, f: 0.1, p: 2.2 } });
  const brick = lin(PAL.wall4), dark = lin(PAL.roofDark);
  const mb = new MeshBuilder();
  const yard = boxP(52, 0.7, 38, T(0, -0.35, 0), { top: K.PAVE, side: K.SOIL, bottom: K.SOIL }, { top: lin(PAL.pave), side: lin(PAL.soil), bottom: lin(PAL.soil) });
  mb.convex(yard);
  soilUnderside(mb, 48, 34, 12, T(0, -0.7, 0), rng);
  ctx.body({ mb, pos: pose.pos, quat: pose.quat, motion: { parent: P }, colliders: [{ poly: yard }], name: 'factory-yard' });
  const parts = [{ poly: boxP(36, 9, 22, T(-4, 4.5, 0), { side: K.FACADE + 0.75, top: K.CUT }, { side: brick, top: lin(PAL.cut) }), count: 8, explode: [0.2, 1.4] }];
  for (let i = 0; i < 4; i++) parts.push({ poly: transformPoly(gablePoly(9, 3.2, 22, 0.1, { roof: K.ROOF, gable: K.GLASS }, { roof: dark, gable: lin(PAL.glass) }), T(-17.5 + i * 9, 9, 0)), count: 2, explode: [0.3, 2] });
  chunkify(ctx, parts, pose, { parent: P, centre: V3(-4, 4, 0), rng, lift: 0.04 });
  // the chimney: drums drifting apart up the stack - a landmark you see from the bridge
  let y = 0;
  const base = V3(18, 0, -10);
  for (let i = 0; i < 6; i++) {
    const h = rng.range(6, 9), r0 = 2.4 - i * 0.18, r1 = r0 - 0.16;
    const cm = new MeshBuilder();
    cm.cylinder(r0, r1, h, 12, T(0, 0, 0), K.STONE, brick);
    if (i === 5) cm.cylinder(r1 + 0.3, r1 + 0.3, 0.6, 12, T(0, h / 2, 0), K.STONE, lin(PAL.stoneDark));
    const gap = i ? rng.range(0.6, 2.2) * i * 0.6 : 0;
    y += (i ? gap : 0) + h / 2;
    const p = V3(base.x + rng.range(-0.4, 0.4) * i, y, base.z + rng.range(-0.4, 0.4) * i).applyQuaternion(pose.quat).add(pose.pos);
    ctx.body({ mb: cm, pos: p, quat: pose.quat.clone().multiply(Q(rng.range(-0.05, 0.05) * i, rng.range(0, 6), rng.range(-0.05, 0.05) * i)), motion: { parent: P, bob: { a: 0.15 * i, f: 0.2, p: i }, rot: { x: 0.01 * i, y: 0.02, z: 0.01 * i, f: 0.15, p: i } }, colliders: [{ poly: boxP(r0 * 2, h, r0 * 2, null, K.STONE, brick) }], name: 'chimney-drum' });
    y += h / 2;
  }
}

export function townHall(ctx, pose, rng) {
  const P = makeParent(pose.pos, pose.quat, { swell: 1, ext: [16, 10], bob: { a: 0.3, f: 0.15, p: 0.9 }, rot: { x: 0.006, y: 0.005, z: 0.006, f: 0.12, p: 0.4 } });
  const stone = lin(PAL.stone);
  const mb = new MeshBuilder();
  const base = boxP(38, 1.2, 24, T(0, -0.6, 0), { top: K.PAVE, side: K.STONE, bottom: K.SOIL }, { top: lin(PAL.pave), side: stone, bottom: lin(PAL.soil) });
  mb.convex(base);
  for (let i = 0; i < 3; i++) mb.box(14 - i * 0.01, 0.3, 1.2, T(0, -0.15 + i * 0.3 + 0.15, 12.6 + 0.6 * (2 - i)), K.STONE, stone);
  soilUnderside(mb, 34, 21, 10, T(0, -1.2, 0), rng);
  ctx.body({ mb, pos: pose.pos, quat: pose.quat, motion: { parent: P }, colliders: [{ poly: base }], name: 'town-hall-base' });
  const parts = [
    { poly: boxP(32, 11, 18, T(0, 5.5, 0), { side: K.FACADE, top: K.CUT }, { side: stone, top: lin(PAL.cut) }), count: 7, explode: [0.15, 1.0] },
    { poly: transformPoly(gablePoly(18, 4, 32, 0.4, { roof: K.ROOF, gable: K.FACADE }, { roof: lin(PAL.roofDark), gable: stone }), new THREE.Matrix4().makeRotationY(Math.PI / 2).premultiply(T(0, 11, 0))), count: 4, explode: [0.3, 1.8] },
    { poly: boxP(14, 3, 1.2, T(0, 9.6, 9.6), K.STONE, lin(PAL.stoneDark)), count: 2, explode: [0.2, 1] },
  ];
  for (let i = 0; i < 6; i++) parts.push({ poly: boxP(0.9, 8, 0.9, T(-6.25 + i * 2.5, 4, 9.6), K.STONE, stone), count: 1, explode: [0.1, 0.5] });
  chunkify(ctx, parts, pose, { parent: P, centre: V3(0, 5, 0), rng });
  // clock tower above the pediment, drifting up off the roof
  const tw = new MeshBuilder();
  tw.box(5, 7, 5, T(0, 3.5, 0), K.FACADE, stone);
  for (const [x, z, ry] of [[0, 2.55, 0], [0, -2.55, Math.PI], [2.55, 0, Math.PI / 2], [-2.55, 0, -Math.PI / 2]]) tw.cylinder(1.6, 1.6, 0.1, 16, RT(x, 4.6, z, Math.PI / 2, ry, 0), K.MARK, lin(PAL.white));
  tw.cylinder(3.9, 0.01, 4.5, 4, T(0, 9.25, 0), K.ROOF, lin(PAL.roofDark), null, null, Math.PI / 4);
  ctx.body({ mb: tw, pos: V3(0, 16.5, 0).applyQuaternion(pose.quat).add(pose.pos), quat: pose.quat.clone().multiply(Q(0.05, 0.1, -0.06)), motion: { parent: P, bob: { a: 0.5, f: 0.2, p: 0.1 }, rot: { x: 0.02, y: 0.03, z: 0.02, f: 0.15, p: 0.7 } }, colliders: [{ poly: boxP(5, 11, 5, T(0, 5.5, 0), K.PLAIN, stone) }], name: 'clock-tower' });
}

export function farm(ctx, pose, rng) {
  const P = makeParent(pose.pos, pose.quat, { swell: 1, ext: [30, 26], bob: { a: 0.4, f: 0.12, p: 1.7 }, rot: { x: 0.01, y: 0.006, z: 0.012, f: 0.1, p: 0.8 } });
  const mb = new MeshBuilder();
  const field = boxP(64, 0.8, 52, T(0, -0.4, 0), { top: K.GRASS, side: K.SOIL, bottom: K.SOIL }, { top: lin(0x8f9478), side: lin(PAL.soil), bottom: lin(PAL.soil) });
  mb.convex(field);
  for (let i = 0; i < 14; i++) mb.box(60, 0.25, 0.9, T(0, 0.05, -22 + i * 3.2), K.SOIL, lin(0x7b7462));
  soilUnderside(mb, 60, 48, 14, T(0, -0.8, 0), rng);
  ctx.body({ mb, pos: pose.pos, quat: pose.quat, motion: { parent: P }, colliders: [{ poly: field }], name: 'field' });
  const barn = [
    { poly: boxP(14, 7, 22, T(0, 3.5, 0), { side: K.FLOOR, top: K.CUT }, { side: lin(PAL.wall4), top: lin(PAL.cut) }), count: 4, explode: [0.2, 1.2] },
    { poly: transformPoly(gablePoly(14, 5, 22, 0.5, { roof: K.ROOF, gable: K.FLOOR }, { roof: lin(PAL.roofDark), gable: lin(PAL.wall4) }), T(0, 7, 0)), count: 3, explode: [0.3, 2] },
  ];
  chunkify(ctx, barn, { pos: V3(18, 1.5, -10).applyQuaternion(pose.quat).add(pose.pos), quat: pose.quat.clone().multiply(Q(0, 0.3, 0)) }, { parent: P, centre: V3(0, 3, 0), rng, solid: false });
  for (let i = 0; i < 8; i++) {
    const hb = new MeshBuilder();
    hb.cylinder(0.75, 0.75, 1.3, 10, RT(0, 0, 0, 0, 0, Math.PI / 2), K.PROP, lin(0xb9ad86));
    ctx.body({ mb: hb, pos: V3(rng.range(-25, 5), rng.range(1.5, 9), rng.range(-20, 20)).applyQuaternion(pose.quat).add(pose.pos), quat: Q(rng.range(0, 6), rng.range(0, 6), 0), motion: { swell: 1, ext: [1, 1], bob: { a: 0.4, f: 0.4, p: i }, spin: { axis: [rng.gauss(), rng.gauss(), rng.gauss()], rate: rng.range(0.04, 0.15) } }, flags: F.SCENERY, name: 'hay-bale' });
  }
}

/** A football pitch far below - reads instantly from the rooftops. */
export function pitch(ctx, pose, rng) {
  const mb = new MeshBuilder();
  const f = boxP(70, 1, 46, T(0, -0.5, 0), { top: K.GRASS, side: K.SOIL, bottom: K.SOIL }, { top: lin(0x8a9a80), side: lin(PAL.soil), bottom: lin(PAL.soil) });
  mb.convex(f);
  const w = lin(PAL.mark);
  mb.box(64, 0.04, 0.2, T(0, 0.02, -20), K.MARK, w); mb.box(64, 0.04, 0.2, T(0, 0.02, 20), K.MARK, w);
  mb.box(0.2, 0.04, 40, T(-32, 0.02, 0), K.MARK, w); mb.box(0.2, 0.04, 40, T(32, 0.02, 0), K.MARK, w); mb.box(0.2, 0.04, 40, T(0, 0.02, 0), K.MARK, w);
  mb.cylinder(6, 6, 0.03, 20, T(0, 0.02, 0), K.MARK, w);
  mb.cylinder(5.8, 5.8, 0.04, 20, T(0, 0.025, 0), K.GRASS, lin(0x8a9a80));
  for (const sx of [-1, 1]) { mb.box(0.15, 2.4, 7.3, T(sx * 32, 1.2, 0), K.MARK, w); }
  soilUnderside(mb, 66, 42, 16, T(0, -1, 0), rng);
  ctx.body({ mb, pos: pose.pos, quat: pose.quat, motion: { swell: 1, ext: [35, 23], bob: { a: 0.5, f: 0.1, p: 0 }, rot: { x: 0.01, y: 0.005, z: 0.01, f: 0.08, p: 1 } }, colliders: [{ poly: f }], name: 'pitch' });
}
