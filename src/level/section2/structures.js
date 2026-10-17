// Section 2 structures: the authored set pieces on and around the racing line.
import * as THREE from 'three';
import { MeshBuilder, K, PAL, lin } from '../../core/geo.js';
import { fracturePoly, centrePoly, transformPoly, clipPoly } from '../../core/fracture.js';
import { makeParent } from '../../core/motion.js';
import { F } from '../../core/world.js';
import { boxP, V3, Q } from '../ctx.js';
import { prop, groundProp } from '../kit/props.js';
import { breakable } from '../section1/structures.js';

const T = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z);
const RT = (x, y, z, rx = 0, ry = 0, rz = 0) => new THREE.Matrix4().compose(V3(x, y, z), Q(rx, ry, rz), V3(1, 1, 1));
const mul = (A, B) => new THREE.Matrix4().multiplyMatrices(A, B);

/** Body placed in a plate's local frame (rigid with the plate unless extra motion is given). */
export function plateBody(ctx, plate, mb, x, y, z, yaw = 0, o = {}) {
  return ctx.body({
    mb, pos: plate.toWorld(x, y, z), quat: plate.q(o.rx || 0, yaw, o.rz || 0),
    motion: { parent: plate.parent, ...(o.motion || {}) }, flags: o.flags ?? 0,
    colliders: o.colliders || [], name: o.name || 'city', mass: o.mass, userData: o.userData,
  });
}

/** Route frame basis -> car orientation (car local: +X left, +Y up, +Z forward). */
export function routeQuat(f) {
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(f.r.clone().negate(), f.u, f.t));
}

// ----------------------------------------------------------------- portals
/** A heavy steel portal frame: two concrete piers, a box-girder lintel. Rides a plate. */
export function cityGate(ctx, s, plate, o = {}) {
  const R = ctx.route;
  const f = R.at(s);
  const yaw = Math.atan2(f.t.x, f.t.z);
  const quat = Q(0, yaw, 0);
  const centre = R.pos(s).add(V3(0, o.lift ?? 2.1, 0));
  const w = o.w ?? 18, h = o.h ?? 11, pier = 2.6, lint = 2.4, depth = 3.0;
  const P = makeParent(centre, quat, { parent: plate.parent });
  const conc = lin(PAL.concrete), steel = lin(PAL.steel), dark = lin(PAL.frame);
  const mb = new MeshBuilder();
  const base = -h / 2 - (o.footing ?? 0);
  for (const sx of [-1, 1]) {
    const x = sx * (w / 2 + pier / 2);
    const H = h / 2 + lint - base;
    mb.box(pier, H, depth, T(x, base + H / 2, 0), K.PLAIN, conc);
    mb.box(pier + 0.6, 1.0, depth + 0.6, T(x, base + 0.5, 0), K.PLAIN, lin(PAL.concrete2));
    // steel cheek plates
    mb.box(0.2, H - 1.5, depth * 0.7, T(x - sx * (pier / 2 + 0.1), base + H / 2 + 0.5, 0), K.METAL, steel);
  }
  mb.box(w + 2 * pier + 1.2, lint, depth + 0.4, T(0, h / 2 + lint / 2, 0), K.METAL, steel);
  for (let i = -3; i <= 3; i++) mb.box(0.18, lint - 0.2, depth + 0.5, T(i * (w / 7), h / 2 + lint / 2, 0), K.METAL, dark);
  mb.box(w + 2 * pier + 1.6, 0.35, depth + 0.8, T(0, h / 2 + lint + 0.18, 0), K.METAL, dark);
  if (o.sill) mb.box(w + 2 * pier, 1.0, depth, T(0, -h / 2 - 0.5, 0), K.PLAIN, lin(PAL.concrete2));
  ctx.body({ mb, pos: centre, quat, motion: { parent: P }, name: o.name || 'city-gate' });
  if (o.label) ctx.label(o.label, centre.clone().add(V3(0, h / 2 + 5, 0)), { kind: 'portal', size: 1.4 });
  return { centre, quat, w, h, parent: P };
}

// ----------------------------------------------------------------- kicker ridge
/**
 * The buckled kerb ridge at P1's torn edge: the edge of the plate was pushed up in
 * three slabs when it broke - the launch ramp over the first chasm.
 */
export function kickerRidge(ctx, plate, sK, stages = 3, stageLen = 9) {
  const rng = ctx.rng.fork(4201);
  const asph = lin(PAL.asphalt), cut = lin(PAL.cut), fill = lin(PAL.fill);
  const W = 30;
  for (let i = 0; i < stages; i++) {
    const sA = sK + i * stageLen, sB = sA + stageLen;
    const fr = ctx.frame(sA, sB, { dropA: 0.02 });
    const mb = new MeshBuilder();
    const th = 0.6;
    const top = boxP(W, th, fr.len, T(0, -th / 2, 0), { top: K.LANES + 0.30, side: K.CUT, bottom: K.CUT }, { top: asph, side: cut, bottom: cut });
    mb.convex(top, undefined, T(0, 0, fr.sMid));
    const fillH = 0.8 + (i + 1) * 1.3;
    const found = boxP(W - 0.6, fillH, fr.len - 0.2, T(0, -th - fillH / 2, 0), { side: K.STRATA, bottom: K.SOIL }, fill);
    mb.convex(found);
    // broken slab edges either side
    for (const sx of [-1, 1]) mb.box(rng.range(2, 4), rng.range(0.6, 1.6), fr.len * rng.range(0.5, 0.9), RT(sx * (W / 2 + 1.2), -0.4 - rng.range(0, 0.6), rng.range(-1, 1), rng.range(-0.1, 0.1), rng.range(-0.2, 0.2), sx * rng.range(0.1, 0.35)), { top: K.PAVE, side: K.CUT }, { top: lin(PAL.pave), side: cut });
    ctx.body({ mb, pos: fr.pos, quat: fr.quat, motion: { parent: plate.parent }, flags: F.ROUTE, colliders: [{ poly: top, drivable: true, surface: 'kicker' }, { poly: found }], name: 'kicker-ridge' });
  }
}

// ----------------------------------------------------------------- the fallen tower
/**
 * A 60-storey office tower that toppled off P2 and lies wedged across the chasm.
 * Its curtain wall is the road: the floor lines run across it like rumble strips.
 * Rigid with P2 (its base is jammed against P2's cliff); its crown hangs 4 m above
 * P3's low edge, so the relative heave of the two plates only changes the drop.
 */
export function fallenTower(ctx, P2, TW, map, o) {
  const rng = ctx.rng.fork(4401);
  const B = map.at(o.u, 0, o.v0); B.y = TW.heightAt(B.x, B.z);
  const C = map.at(o.u, 0, o.v1); C.y = TW.heightAt(C.x, C.z);
  const W = o.w ?? 30, D = o.d ?? 30;
  const yT = C.clone().sub(B).normalize();
  const zT = TW.n.clone();
  const xT = new THREE.Vector3().crossVectors(yT, zT).normalize();
  const quat = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xT, yT, zT));
  const L = C.distanceTo(B);
  const origin = B.clone().addScaledVector(zT, -D / 2);
  const glass = lin(PAL.curtain), cut = lin(PAL.cut), conc = lin(PAL.concrete);
  const curtain = K.CURTAIN;
  // shaft: the drivable facade is local +Z
  const shaft = boxP(W, L, D, T(0, L / 2, 0), { right: curtain, left: curtain, front: curtain, back: curtain, top: K.CUT, bottom: K.CUT }, { side: glass, top: cut, bottom: cut });
  const mb = new MeshBuilder();
  mb.convex(shaft);
  // corner mullion caps standing proud of the facade along both edges
  for (const sx of [-1, 1]) mb.box(0.7, L - 1, 0.35, T(sx * (W / 2 - 0.35), L / 2, D / 2 + 0.17), K.METAL, lin(PAL.steel));
  // broken ends: floor slabs and columns showing
  for (const [y0, dir] of [[0, -1], [L, 1]]) {
    for (let k = 0; k < D / 3.8 - 1; k++) {
      const z = -D / 2 + 2 + k * 3.8;
      const ext = rng.range(0.4, 3.2);
      mb.box(W - rng.range(0, 8), 0.4, ext, RT(rng.range(-2, 2), y0 + dir * ext / 2, z, Math.PI / 2, 0, rng.range(-0.05, 0.05)), { side: K.CUT, top: K.FLOOR }, { side: cut, top: conc });
    }
    for (let i = 0; i < 7; i++) mb.box(0.8, rng.range(1, 5), 0.8, RT(rng.range(-W / 2 + 2, W / 2 - 2), y0 + dir * rng.range(0.5, 2), rng.range(-D / 2 + 2, D / 2 - 4), rng.range(-0.3, 0.3), 0, rng.range(-0.3, 0.3)), K.PLAIN, conc);
  }
  ctx.body({ mb, pos: origin, quat, motion: { parent: P2.parent }, flags: F.ROUTE, colliders: [{ poly: shaft, drivable: true, surface: 'facade' }], name: 'fallen-tower' });
  // the crown's loose ends: chunks of the top floors that break away ahead of you
  const crumbleBodies = [];
  for (const sx of [-1, 1]) {
    const block = boxP(rng.range(6, 9), rng.range(6, 10), rng.range(8, 14), null, { side: curtain, top: K.CUT, bottom: K.CUT }, { side: glass, top: cut, bottom: cut });
    const parts = fracturePoly(block, { count: 3, rng, cutKind: K.CUT, cutColor: cut });
    for (const pp of parts) {
      const { poly, centroid } = centrePoly(pp);
      const lp = V3(sx * (W / 2 + 3.5) + centroid.x, L - 6 + centroid.y, D / 2 - 6 + centroid.z);
      const cm = new MeshBuilder();
      cm.convex(poly);
      const b = ctx.body({ mb: cm, pos: lp.clone().applyQuaternion(quat).add(origin), quat: quat.clone(), motion: { parent: P2.parent }, flags: F.SCENERY, name: 'tower-crown-chunk' });
      crumbleBodies.push(b);
    }
  }
  return { origin, quat, L, W, D, xT, yT, zT, crumbleBodies };
}

// ----------------------------------------------------------------- the arch
/**
 * A tower that toppled across the avenue and came to rest against the tower
 * opposite: a 120 m leaning gateway you drive under (21 m clear over the line).
 * Plate-local: the avenue runs along local X; the tower tips towards local +Z
 * (the right of the line) about an axis along the avenue.
 */
export function leaningArch(ctx, plate, map, o) {
  const rng = ctx.rng.fork(4301);
  const base = plate.localAtMap(o.u, o.vBase);        // left side, base centre
  const rest = plate.localAtMap(o.u + 4, o.vRest);    // right side tower centre
  const L = o.len ?? 120, W = 28;
  const theta = o.theta ?? 44 * Math.PI / 180;
  const glass = lin(PAL.tower2), cut = lin(PAL.cut);
  // the supporting tower on the right
  const sm = new MeshBuilder();
  const sH = 150;
  sm.box(32, 12, 32, T(0, 6, 0), { side: K.FACADE + 0.25, top: K.FLATROOF }, { side: lin(PAL.stoneCity), top: lin(PAL.flatRoof) });
  sm.box(28, sH, 28, T(0, 12 + sH / 2, 0), { side: K.CURTAIN + 0.5, top: K.FLATROOF }, { side: lin(PAL.concrete), top: lin(PAL.flatRoof) });
  // crushed zone where the falling tower struck
  for (let i = 0; i < 9; i++) sm.box(rng.range(2, 6), rng.range(2, 5), rng.range(1, 3), RT(rng.range(-12, 12), rng.range(70, 95), -14 - rng.range(0, 1.5), rng.range(-0.4, 0.4), rng.range(-0.4, 0.4), rng.range(-0.4, 0.4)), K.CUT, cut);
  plateBody(ctx, plate, sm, rest.x, 0, rest.z, 0, { name: 'arch-support', colliders: [{ poly: boxP(32, 12, 32, T(0, 6, 0), K.PLAIN, glass) }, { poly: boxP(28, sH, 28, T(0, 12 + sH / 2, 0), K.PLAIN, glass) }] });
  // the leaning tower: built upright, then tipped about the local X axis (towards +Z)
  const tm = new MeshBuilder();
  const shaft = boxP(W, L, W, T(0, L / 2, 0), { side: K.CURTAIN, top: K.FLATROOF, bottom: K.CUT }, { side: glass, top: lin(PAL.flatRoof), bottom: cut });
  // the base is crushed into the street: clip what would be under the ground after tipping
  const qTip = Q(theta, 0, 0); // Rx(+theta): local +Y towards +Z
  const nUp = V3(0, 1, 0).applyQuaternion(qTip.clone().invert()); // ground normal in tower space
  const { neg } = clipPolyHalf(shaft, nUp.clone().negate(), 0.6);
  tm.convex(neg || shaft);
  tm.box(W * 0.5, 6, W * 0.5, T(0, L + 3, 0), { side: K.PLAIN, top: K.FLATROOF }, { side: lin(PAL.concrete2), top: lin(PAL.flatRoof) });
  const body = plateBody(ctx, plate, tm, base.x, 0, base.z, 0, { rx: theta, name: 'arch-tower', colliders: [{ poly: neg || shaft }] });
  // rubble at the hinge
  for (let i = 0; i < 12; i++) {
    const rm = new MeshBuilder();
    const sz = rng.range(1.5, 4.5);
    rm.box(sz, sz * rng.range(0.4, 0.9), sz * rng.range(0.6, 1.2), T(0, 0, 0), K.CUT, lin(PAL.concrete2));
    plateBody(ctx, plate, rm, base.x + rng.range(-16, 16), sz * 0.25, base.z + rng.range(-20, 6), rng.range(0, 6), { rx: rng.range(-0.4, 0.4), rz: rng.range(-0.4, 0.4), name: 'rubble', flags: F.SCENERY });
  }
  // glass and steel that rains down when you pass under (visual only)
  const shed = [];
  for (let i = 0; i < 16; i++) {
    const t = rng.range(30, 70);                 // along the tower axis
    const lp = V3(rng.range(-W / 2 + 2, W / 2 - 2), t, W / 2 + 0.3).applyQuaternion(qTip).add(V3(base.x, 0, base.z));
    const pm = new MeshBuilder();
    pm.box(rng.range(1.2, 2.6), rng.range(1.5, 3.4), 0.12, T(0, 0, 0), K.GLASS, lin(PAL.glass));
    if (i % 4 === 0) pm.box(0.3, rng.range(2, 4), 0.3, T(0.8, 0, 0), K.METAL, lin(PAL.steel));
    shed.push(plateBody(ctx, plate, pm, lp.x, lp.y, lp.z, rng.range(0, 6), { rx: theta + rng.range(-0.3, 0.3), name: 'arch-shard', flags: F.SCENERY }));
  }
  return { body, shed, theta };
}

function clipPolyHalf(poly, n, d) { return clipPoly(poly, n, d, K.CUT, lin(PAL.cut)); }

// ----------------------------------------------------------------- the fault
/** Where the fault crosses the avenue: a tram nose-down over the scarp, tipped slabs, a split kiosk. */
export function faultDetails(ctx, P1a, P1b, route, sF, rng) {
  const f = route.at(sF + 3);
  const yawT = (() => { const t = f.t.clone().applyQuaternion(P1b.qInv); return Math.atan2(t.x, t.z); })();
  const at = (plate, ds, left) => plate.toLocal(route.pos(sF + ds).addScaledVector(f.r, -left));
  // a tram that ran off the step: nose on P1b, tail still up on P1a
  const p = at(P1b, 2, 8.5);
  groundProp(ctx, 'tram', P1b, p.x, p.z, { yaw: yawT + 0.18, rx: 0.11, rng, lift: 0.4 });
  // broken asphalt slabs tipped against the scarp, either side of the lane
  for (const left of [-10.5, -14, 12.5, 16]) {
    const q = at(P1b, rng.range(0.5, 2.5), left);
    const sm = new MeshBuilder();
    const w = rng.range(2.5, 4.5), L = rng.range(2.5, 4);
    sm.box(w, 0.45, L, T(0, 0, 0), { top: K.ROAD, side: K.CUT }, { top: lin(PAL.asphalt), side: lin(PAL.cut) });
    plateBody(ctx, P1b, sm, q.x, 0.5, q.z, yawT + rng.range(-0.4, 0.4), { rx: rng.range(0.25, 0.45), rz: rng.range(-0.15, 0.15), name: 'fault-slab', flags: F.SCENERY });
  }
}

// ----------------------------------------------------------------- the plaza
/** The landing plaza on P2: open paving, a fountain whose water stays level in a tipped basin. */
export function plaza(ctx, plate, map, rng) {
  const c = plate.localAtMap(560, -30);
  // basin (tilted with the plate)
  const bm = new MeshBuilder();
  const stone = lin(PAL.stoneCity);
  bm.cylinder(7, 7, 0.9, 20, T(0, 0.45, 0), K.STONE, stone);
  bm.cylinder(1.2, 1.4, 3.2, 10, T(0, 1.6, 0), K.STONE, stone);
  bm.cylinder(2.6, 2.2, 0.4, 14, T(0, 3.2, 0), K.STONE, stone);
  plateBody(ctx, plate, bm, c.x, 0, c.z, 0, { name: 'fountain', colliders: [{ poly: boxP(12, 1.0, 12, T(0, 0.5, 0), K.STONE, stone) }] });
  // water: a WORLD-level disc at the basin's low rim - it fills the low side only
  const rimLow = (() => { let lo = Infinity, hi = -Infinity; for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; const w = plate.toWorld(c.x + Math.cos(a) * 6.6, 0.85, c.z + Math.sin(a) * 6.6); lo = Math.min(lo, w.y); hi = Math.max(hi, w.y); } return { lo, hi }; })();
  const wc = plate.toWorld(c.x, 0, c.z);
  const wm = new MeshBuilder();
  wm.cylinder(6.6, 6.6, 0.06, 20, T(0, 0, 0), K.WATER, lin(PAL.water));
  ctx.body({ mb: wm, pos: V3(wc.x, rimLow.lo - 0.05, wc.z), quat: Q(0, 0, 0), motion: { parent: plate.parent }, flags: F.SCENERY, name: 'fountain-water' });
  // benches and planters that slid to the low side of the plaza; a statue off its plinth
  for (let i = 0; i < 10; i++) {
    const q = plate.localAtMap(rng.range(515, 600), rng.range(-48, -16));
    groundProp(ctx, rng.pick(['bench', 'planter', 'bin', 'bollard', 'planter']), plate, q.x, q.z, { yaw: rng.range(0, 6), rng });
  }
  for (let i = 0; i < 6; i++) {
    const q = plate.localAtMap(rng.range(515, 600), rng.range(24, 52));
    groundProp(ctx, rng.pick(['bench', 'planter', 'kiosk', 'bin']), plate, q.x, q.z, { yaw: rng.range(0, 6), rng });
  }
  const pl = plate.localAtMap(585, 40);
  const sm = new MeshBuilder();
  sm.box(3, 3.2, 3, T(0, 1.6, 0), K.STONE, stone);
  plateBody(ctx, plate, sm, pl.x, 0, pl.z, 0.2, { name: 'plinth', colliders: [{ poly: boxP(3, 3.2, 3, T(0, 1.6, 0), K.STONE, stone) }] });
  const st = new MeshBuilder();
  st.box(1.4, 4.2, 1.0, T(0, 0, 0), K.STONE, lin(PAL.stone));
  st.box(2.2, 0.8, 1.6, T(0, -2.4, 0), K.STONE, lin(PAL.stone));
  plateBody(ctx, plate, st, pl.x - 2.5, 0.8, pl.z + 3.2, 0.9, { rx: 1.45, rz: 0.2, name: 'statue', flags: F.SCENERY });
}

// ----------------------------------------------------------------- the hotel
/**
 * THE GRAND HOTEL: the line runs straight through its lobby (26 m wide, 13 m
 * high, 90 m deep). Glass walls at both ends shatter; chandeliers hang plumb in a
 * room tilted 7 degrees; the furniture has all slid to the low (left) wall.
 */
export function hotel(ctx, plate, route, s0, s1, rng) {
  const f0 = route.at(s0);
  const c0 = plate.toLocal(route.pos(s0)), c1 = plate.toLocal(route.pos(s1));
  const cx = (c0.x + c1.x) / 2, cz = (c0.z + c1.z) / 2;
  const yaw = Math.atan2(c1.x - c0.x, c1.z - c0.z) - Math.PI / 2; // local X along the line
  const Lh = Math.hypot(c1.x - c0.x, c1.z - c0.z);
  const half = 13, ceil = 13;
  const stone = lin(PAL.stoneCity), wall = lin(PAL.wall), cut = lin(PAL.cut), roofC = lin(PAL.flatRoof);
  const mb = new MeshBuilder();
  const cols = [];
  // wings either side of the lobby (local Z = left of the line is -Z here because yaw puts X along the line)
  const wingD = 34;
  for (const sd of [-1, 1]) {
    const zc = sd * (half + wingD / 2);
    const wing = boxP(Lh, 22, wingD, T(0, 11, zc), { side: K.FACADE + 0.25, top: K.FLATROOF, bottom: K.CUT }, { side: stone, top: roofC, bottom: cut });
    mb.convex(wing);
    cols.push({ poly: wing });
  }
  // the floors above the lobby, then the hotel tower
  const upper = boxP(Lh, 22 - ceil, half * 2, T(0, ceil + (22 - ceil) / 2, 0), { side: K.FACADE, top: K.FLATROOF, bottom: K.PLAIN }, { side: stone, top: roofC, bottom: lin(PAL.interior) });
  mb.convex(upper);
  cols.push({ poly: upper });
  const tH = 92;
  mb.box(Lh * 0.62, tH, 42, T(0, 22 + tH / 2, 0), { side: K.FACADE, top: K.FLATROOF }, { side: lin(PAL.wall2), top: roofC });
  mb.box(Lh * 0.62 + 1.2, 1.2, 43.2, T(0, 22 + tH, 0), K.PLAIN, lin(PAL.concrete2));
  mb.box(14, 7, 10, T(0, 22 + tH + 4, 0), { side: K.PLAIN, top: K.FLATROOF }, { side: lin(PAL.concrete2), top: roofC });
  // lobby interior: stone floor, coffered ceiling bands, columns
  mb.box(Lh - 0.4, 0.06, half * 2, T(0, 0.08, 0), K.STONE, lin(PAL.stoneCity));
  for (let x = -Lh / 2 + 6; x < Lh / 2 - 4; x += 12) {
    mb.box(1.4, 0.8, half * 2, T(x, ceil - 0.4, 0), K.PLAIN, lin(PAL.interior));
    for (const sd of [-1, 1]) {
      mb.box(1.2, ceil, 1.2, T(x, ceil / 2, sd * (half - 2.2)), K.STONE, stone);
      cols.push({ poly: boxP(1.2, ceil, 1.2, T(x, ceil / 2, sd * (half - 2.2)), K.STONE, stone) });
    }
  }
  // canopies over both entrances
  for (const sx of [-1, 1]) mb.box(4, 0.5, half * 2 + 4, T(sx * (Lh / 2 + 2), 6.5, 0), K.METAL, lin(PAL.steel));
  const body = plateBody(ctx, plate, mb, cx, 0, cz, yaw, { name: 'hotel', colliders: cols });
  // reception desk against the low wall, furniture slid against it
  const toL = (x, z) => V3(x, 0, z).applyQuaternion(Q(0, yaw, 0)).add(V3(cx, 0, cz));
  const low = (() => { const d = V3(0, -1, 0).applyQuaternion(plate.qInv); const lz = V3(d.x, 0, d.z).applyQuaternion(Q(0, -yaw, 0)); return Math.sign(lz.z) || 1; })();
  const dm = new MeshBuilder();
  dm.box(16, 1.2, 1.4, T(0, 0.6, 0), K.STONE, lin(PAL.stone));
  const dp = toL(-8, low * (half - 3.6));
  plateBody(ctx, plate, dm, dp.x, 0, dp.z, yaw, { name: 'reception', colliders: [{ poly: boxP(16, 1.2, 1.4, T(0, 0.6, 0), K.STONE, wall) }] });
  for (let i = 0; i < 22; i++) {
    const p = toL(rng.range(-Lh / 2 + 6, Lh / 2 - 6), low * rng.range(half - 5.5, half - 3.2));
    groundProp(ctx, rng.pick(['sofa', 'armchair', 'armchair', 'trolley', 'plant', 'table', 'suitcase', 'chair']), plate, p.x, p.z, { yaw: rng.range(0, 6), rng });
  }
  // a few loose things still out in the room (light: plough through them)
  for (let i = 0; i < 5; i++) {
    const p = toL(rng.range(-Lh / 2 + 10, Lh / 2 - 10), rng.range(-7, 7));
    groundProp(ctx, rng.pick(['suitcase', 'chair', 'plant']), plate, p.x, p.z, { yaw: rng.range(0, 6), rng });
  }
  // chandeliers: hung from the ceiling, plumb, swinging slowly
  for (const x of [-Lh * 0.3, 0, Lh * 0.3]) {
    const top = plate.toWorld(...toL(x, 0).add(V3(0, ceil - 0.8, 0)).toArray());
    const cm = new MeshBuilder();
    const gold = lin(0xb9a982);
    cm.box(0.08, 2.2, 0.08, T(0, -1.1, 0), K.METAL, gold);
    cm.cylinder(2.6, 2.2, 0.35, 16, T(0, -2.6, 0), K.METAL, gold);
    cm.cylinder(1.7, 1.2, 0.5, 14, T(0, -3.2, 0), K.METAL, gold);
    cm.cylinder(0.8, 0.2, 0.9, 10, T(0, -3.9, 0), K.METAL, gold);
    for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; cm.box(0.12, 0.4, 0.12, T(Math.cos(a) * 2.4, -2.95, Math.sin(a) * 2.4), K.MARK, lin(PAL.propLight)); }
    ctx.body({ mb: cm, pos: top, quat: Q(0, rng.range(0, 6), 0), motion: { parent: plate.parent, swing: { a: rng.range(0.03, 0.06), f: Math.sqrt(12 / 3.4), p: rng.range(0, 6) } }, flags: F.SCENERY, name: 'chandelier' });
  }
  // the glass walls at both ends of the lobby: smash through them
  const panes = [];
  for (const sx of [-1, 1]) {
    const pane = boxP(0.18, ceil - 0.5, half * 2 - 0.6, T(0, (ceil - 0.5) / 2, 0), K.GLASS, lin(PAL.glass));
    const pp = toL(sx * (Lh / 2 - 0.4), 0);
    const pose = { pos: plate.toWorld(pp.x, 0.05, pp.z), quat: plate.q(0, yaw, 0) };
    const b = breakable(ctx, pane, pose, plate.parent, { count: 26, breakSpeed: 3, breakCost: 0.03, name: 'lobby-glass' });
    b.userData.heavy = true;
    panes.push(b);
  }
  return { body, Lh, yaw, cx, cz };
}

// ----------------------------------------------------------------- the crescent
/** A curved terrace following the outside of the bend: one cornice line, 9 storeys, leaning into the corner. */
export function crescent(ctx, plate, route, s0, s1, side, rng, o = {}) {
  const off = o.off ?? 17.5, depth = o.depth ?? 18, h = o.h ?? 30;
  const stone = lin(PAL.stoneCity, 0.02, rng), roofC = lin(PAL.flatRoof);
  const n = Math.max(3, Math.round((s1 - s0) / 14));
  const occ = [];
  for (let i = 0; i < n; i++) {
    const sa = s0 + (s1 - s0) * i / n, sb = s0 + (s1 - s0) * (i + 1) / n;
    const sm = (sa + sb) / 2;
    const fa = routeLocalPt(plate, route, sa, side * (off + depth / 2)), fb = routeLocalPt(plate, route, sb, side * (off + depth / 2));
    const cx = (fa.x + fb.x) / 2, cz = (fa.z + fb.z) / 2;
    // frontage length at the facade line (outer side of a bend is longer)
    const ga = routeLocalPt(plate, route, sa, side * off), gb = routeLocalPt(plate, route, sb, side * off);
    const ha = routeLocalPt(plate, route, sa, side * (off + depth)), hb = routeLocalPt(plate, route, sb, side * (off + depth));
    const len = Math.max(Math.hypot(ga.x - gb.x, ga.z - gb.z), Math.hypot(ha.x - hb.x, ha.z - hb.z)) + 0.6;
    const yaw = Math.atan2(fb.x - fa.x, fb.z - fa.z) - Math.PI / 2;
    const mb = new MeshBuilder();
    const hh = h + rng.range(-0.2, 0.2);
    mb.box(len, hh, depth, T(0, hh / 2, 0), { side: K.FACADE, top: K.FLATROOF, bottom: K.CUT }, { side: stone, top: roofC, bottom: lin(PAL.cut) });
    mb.box(len + 0.2, 4.5, depth + 0.6, T(0, 2.25, 0), { side: K.FACADE + 0.25, top: K.CUT }, { side: lin(PAL.stoneCity), top: lin(PAL.cut) });
    mb.box(len + 0.4, 0.9, depth + 1.4, T(0, hh + 0.2, 0), K.PLAIN, lin(PAL.concrete2));
    if (i % 3 === 1) mb.box(len * 0.4, 4, depth * 0.5, T(0, hh + 2.5, 0), { side: K.FACADE, top: K.ROOF }, { side: stone, top: lin(PAL.roofDark) });
    plateBody(ctx, plate, mb, cx, 0, cz, yaw, { name: 'crescent', colliders: [{ poly: boxP(len, hh, depth, T(0, hh / 2, 0), K.PLAIN, stone) }] });
    occ.push({ x: cx, z: cz, hx: len / 2 + depth / 2, hz: len / 2 + depth / 2 });
  }
  return occ;
}
function routeLocalPt(plate, route, s, left) { const f = route.at(s); return plate.toLocal(route.pos(s).addScaledVector(f.r, -left)); }

// ----------------------------------------------------------------- the tower bridge
/**
 * A simplified fallen tower: a long flat slab on the TW surface, oriented
 * along the route between stations s0 and s1. This replaces the full
 * fallenTower function when the route crosses TW at an angle to the map axes.
 */
export function towerBridge(ctx, P2, TW, route, s0, s1, rng, o = {}) {
  const W = o.w ?? 28, TH = 2.4;
  const glass = lin(PAL.curtain), cut = lin(PAL.cut), steel = lin(PAL.steel), conc = lin(PAL.concrete);
  // Build as multiple road slabs that follow the TW surface (the route rides TW).
  // Each slab is ~20 m long, placed at the route frame at its station.
  const slabLen = 20;
  const crumbleBodies = [];
  for (let s = s0; s < s1 - 1; s += slabLen) {
    const sB = Math.min(s1, s + slabLen);
    const fr = ctx.frame(s, sB, { flat: false });
    // ctx.frame gives a local frame with X=left, Y=up, Z=along, top at the route.
    // The slab sits just below the route surface.
    const mb = new MeshBuilder();
    const top = boxP(W, TH, fr.len, T(0, -TH / 2, 0), { side: K.CURTAIN, top: K.CURTAIN, bottom: K.CUT },
      { side: glass, top: glass, bottom: cut });
    mb.convex(top, undefined, T(0, 0, fr.sMid));
    // Parapets
    for (const sd of [-1, 1]) mb.box(0.6, 1.2, fr.len - 2, T(sd * (W / 2 - 0.3), 0.6, fr.sMid), K.STONE, lin(PAL.concrete2));
    // Mullions on both edges
    for (const sd of [-1, 1]) {
      for (let z = fr.sA + 3; z < fr.sB; z += 3.8) {
        const pf = route.at(z);
        const lx = 0, ly = 1.75, lz = z - fr.sMid;
        mb.box(0.12, 3.5, 0.12, T(sd * (W / 2 + 0.06), ly, lz), K.METAL, steel);
      }
    }
    const body = ctx.body({ mb, pos: fr.pos, quat: fr.quat, motion: { parent: P2.parent }, flags: F.ROUTE,
      colliders: [{ poly: top, drivable: true, surface: 'facade' }], name: 'tower-bridge' });
    // Chunks at the ends of some slabs
    if (rng.chance(0.5)) {
      const sgn = rng.sign();
      const cs = rng.range(3, 5);
      const chunk = boxP(cs, rng.range(2, 5), cs, null, K.CUT, cut);
      const { poly, centroid } = centrePoly(chunk);
      const cm = new MeshBuilder();
      cm.convex(poly);
      const lp = V3(sgn * (W / 2 + rng.range(1, 3)), rng.range(-3, 0), rng.range(-fr.len * 0.3, fr.len * 0.3));
      const wp = lp.clone().applyQuaternion(fr.quat).add(fr.pos);
      const b = ctx.body({ mb: cm, pos: wp, quat: fr.quat, motion: { parent: P2.parent }, flags: F.SCENERY, name: 'tower-chunk' });
      crumbleBodies.push(b);
    }
  }
  return { centre: route.pos((s0 + s1) / 2), L: s1 - s0, W, crumbleBodies };
}

// ----------------------------------------------------------------- drive-through building
/**
 * A building that the route drives through: breakable glass walls at entry and
 * exit, a floor the car drives on, columns inside, and desks/obstacles. The
 * building is placed on a plate, centered on the route between s0 and s1.
 */
export function driveThroughBuilding(ctx, plate, route, s0, s1, rng, o = {}) {
  const hw = o.hw ?? 10;  // half-width of the interior
  const H = o.h ?? 14;    // floor-to-ceiling height
  const glass = lin(PAL.glass), cut = lin(PAL.cut), conc = lin(PAL.concrete), stone = lin(PAL.stoneCity);
  const crumbleBodies = [];
  // Build as a series of floor slabs along the route, each ~20m long
  const slabLen = 20;
  for (let s = s0; s < s1 - 1; s += slabLen) {
    const sB = Math.min(s1, s + slabLen);
    const fr = ctx.frame(s, sB, { flat: false });
    const mb = new MeshBuilder();
    // Floor slab (drivable)
    const floor = boxP(hw * 2, 0.4, fr.len, T(0, -0.2, 0), { top: K.FLOOR, side: K.CUT, bottom: K.CUT },
      { top: lin(PAL.interior), side: cut, bottom: cut });
    mb.convex(floor, undefined, T(0, 0, fr.sMid));
    // Side walls (visual only, not collidable - the car drives through the interior)
    for (const sd of [-1, 1]) {
      mb.box(0.6, H, fr.len - 1, T(sd * (hw + 0.3), H / 2, fr.sMid), { side: K.FACADE, top: K.FLATROOF },
        { side: stone, top: lin(PAL.flatRoof) });
      // Window bands in the walls
      for (let z = fr.sA + 3; z < fr.sB; z += 4) {
        mb.box(0.08, 2.5, 3.2, T(sd * (hw + 0.05), H * 0.6, z), K.GLASS, glass);
      }
    }
    // Ceiling (visual)
    mb.box(hw * 2 + 1.2, 0.5, fr.len - 1, T(0, H + 0.25, fr.sMid), K.FLATROOF, lin(PAL.flatRoof));
    ctx.body({ mb, pos: fr.pos, quat: fr.quat, motion: { parent: plate.parent }, flags: F.SCENERY, name: 'bld-interior' });
  }
  // Breakable glass walls at entry and exit
  for (const [s, label] of [[s0, 'entry'], [s1, 'exit']]) {
    const fr = ctx.frame(s - 0.5, s + 0.5, { flat: false });
    const wallPoly = boxP(hw * 2 + 1.2, H - 0.5, 0.3, T(0, (H - 0.5) / 2, 0), K.GLASS, glass);
    const pose = { pos: fr.pos.clone(), quat: fr.quat.clone() };
    const bw = breakable(ctx, wallPoly, pose, plate.parent, { name: `bld-${label}-wall`, count: 18, breakSpeed: 3, breakCost: 0.04 });
    crumbleBodies.push(bw);
  }
  // Interior columns (solid obstacles the car weaves between)
  for (let s = s0 + 8; s < s1 - 8; s += rng.range(8, 14)) {
    for (const sd of [-1, 1]) {
      const f = route.at(s);
      const lat = sd * rng.range(3, hw - 2);
      const p = route.pos(s).addScaledVector(f.r, -lat);
      const cm = new MeshBuilder();
      const colH = H - 0.6;
      cm.box(0.8, colH, 0.8, T(0, colH / 2, 0), K.STONE, conc);
      ctx.body({ mb: cm, pos: p, quat: routeQuat(f), motion: { parent: plate.parent },
        colliders: [{ poly: boxP(0.8, colH, 0.8, T(0, colH / 2, 0), K.STONE, conc) }],
        name: 'bld-column' });
    }
  }
  return { crumbleBodies };
}

// ----------------------------------------------------------------- road collapse
/**
 * Road segments that crumble when the car passes: a chunk of road surface breaks
 * off and falls. The route has already turned before this point, so the player
 * sees the road collapse behind them (or ahead as a warning).
 */
export function roadCollapse(ctx, plate, route, s0, s1, rng, o = {}) {
  const hw = o.hw ?? 11;
  const bodies = [];
  const n = Math.max(2, Math.round((s1 - s0) / 12));
  for (let i = 0; i < n; i++) {
    const sA = s0 + (s1 - s0) * i / n;
    const sB = s0 + (s1 - s0) * (i + 1) / n;
    const fr = ctx.frame(sA, sB, { flat: false });
    const mb = new MeshBuilder();
    const w = hw * 2 * rng.range(0.6, 0.9), L = fr.len * rng.range(0.7, 0.95);
    const top = boxP(w, 0.5, L, T(0, -0.25, 0), { top: K.ROAD, side: K.CUT, bottom: K.CUT },
      { top: lin(PAL.asphalt), side: lin(PAL.cut), bottom: lin(PAL.cut) });
    mb.convex(top, undefined, T(rng.range(-1, 1), 0, rng.range(-1, 1)));
    // underside: cracked earth
    mb.box(w * 0.7, rng.range(1, 3), L * 0.7, T(0, -1.5, 0), K.STRATA, lin(PAL.soil));
    const body = ctx.body({ mb, pos: fr.pos, quat: fr.quat, motion: { parent: plate.parent },
      flags: F.SCENERY, colliders: [{ poly: top, drivable: true, surface: 'road' }], name: 'road-collapse' });
    bodies.push(body);
  }
  ctx.crumbles.push({ sTrigger: s0 - 15, bodies, centre: route.pos((s0 + s1) / 2), up: V3(0, 1, 0), along: route.at((s0 + s1) / 2).t.clone() });
  return bodies;
}

// ----------------------------------------------------------------- edges
/** Vehicles that slid to a plate's edge: some stopped short, some hang over the drop. */
export function edgeCars(ctx, plate, pts, rng) {
  for (const { x, z, yaw, over } of pts) {
    groundProp(ctx, rng.pick(['sedan', 'hatch', 'van', 'sedan']), plate, x, z, { yaw, rx: over ? rng.range(0.25, 0.5) : rng.range(-0.05, 0.05), rz: rng.range(-0.1, 0.1), lift: over ? -0.4 : 0, rng });
  }
}

/** Bent railing segments along a torn edge. */
export function railing(ctx, plate, x0, z0, x1, z1, rng) {
  const L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(L / 3));
  const m = lin(PAL.metal);
  const mb = new MeshBuilder();
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
    const yaw = Math.atan2(x1 - x0, z1 - z0);
    const bend = rng.chance(0.25) ? rng.range(-0.7, 0.7) : 0;
    mb.box(0.08, 1.1, 0.08, RT(x, 0.55, z, bend, 0, 0), K.METAL, m);
    mb.box(0.06, 0.06, L / n, RT(x, 1.05 + bend * 0.3, z, 0, yaw, bend * 0.5), K.METAL, m);
  }
  ctx.body({ mb, pos: plate.pos, quat: plate.quat, motion: { parent: plate.parent }, flags: F.SCENERY, name: 'railing' });
}
