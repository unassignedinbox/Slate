// Section 1 set pieces: the structures the racing line runs on or through.
import * as THREE from 'three';
import { MeshBuilder, K, PAL, lin } from '../../core/geo.js';
import { fracturePoly, centrePoly, clipPoly, transformPoly, polyMass } from '../../core/fracture.js';
import { F } from '../../core/world.js';
import { makeParent } from '../../core/motion.js';
import { DEG } from '../../core/rng.js';
import { boxP, clipAll, soilUnderside, V3, Q } from '../ctx.js';
import { chunkify, houseParts, shopParts, gablePoly, hipPoly, plot, tree, polyFromFaces } from '../kit/buildings.js';
import { prop } from '../kit/props.js';

const T = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z);
const RT = (x, y, z, rx = 0, ry = 0, rz = 0) => new THREE.Matrix4().compose(V3(x, y, z), Q(rx, ry, rz), V3(1, 1, 1));
const WALLS = [PAL.wall, PAL.wall2, PAL.wall3, PAL.wall4];
const fw = (fr, x, y, z) => V3(x, y, z).applyQuaternion(fr.quat).add(fr.pos);
const fq = (fr, rx = 0, ry = 0, rz = 0) => fr.quat.clone().multiply(Q(rx, ry, rz));

function crackPlanes(L, thS, thE) {
  return [
    [V3(Math.sin(thE), 0, Math.cos(thE)), Math.cos(thE) * L / 2],
    [V3(-Math.sin(thS), 0, -Math.cos(thS)), Math.cos(thS) * L / 2],
  ];
}

/** Breakable panel: an intact body plus hidden pre-shattered chunks swapped in on impact. */
export function breakable(ctx, poly, pose, parent, o = {}) {
  const rng = ctx.rng.fork(ctx.stats.bodies + 99);
  const mb = new MeshBuilder();
  mb.convex(poly, undefined, o.gmat);
  const body = ctx.body({ mb, pos: pose.pos, quat: pose.quat, motion: { parent }, flags: F.BREAKABLE, colliders: [{ poly, drivable: false }], name: o.name || 'breakable' });
  body.userData.breakSpeed = o.breakSpeed ?? 3;
  body.userData.breakCost = o.breakCost ?? 0.06;
  const pieces = fracturePoly(poly, { count: o.count ?? 12, rng, minFrac: 0.02, jitter: 0.4, cutColor: lin(PAL.cut) });
  const chunks = [];
  for (const pc of pieces) {
    const { poly: p, centroid } = centrePoly(pc);
    const cm = new MeshBuilder();
    cm.convex(p, undefined, T(centroid.x, centroid.y, centroid.z));
    const c = ctx.body({ mb: cm, pos: centroid.clone().applyQuaternion(pose.quat).add(pose.pos), quat: pose.quat.clone(), motion: { parent }, flags: F.SCENERY, name: 'shard' });
    c.visible = false;
    c.userData.linDamp = 0.5; c.userData.angDamp = 0.3;
    chunks.push(c);
  }
  body.userData.chunks = chunks;
  return body;
}

// ------------------------------------------------------------------ kicker
export function kickerSlab(ctx, sA, sB, o = {}) {
  const rng = ctx.rng.fork(Math.round(sA * 11));
  const fr = ctx.frame(sA, sB, { dropA: o.dropA ?? 0.03 });
  const W = o.width ?? 13.6, th = 0.55;
  const gmat = o.gmat || T(0, 0, fr.sMid);
  const mb = new MeshBuilder();
  const top = boxP(W, th, fr.len, T(0, -th / 2, 0), { top: o.topKind ?? K.ROAD, side: K.CUT, bottom: K.CUT },
    { top: lin(o.topCol ?? PAL.asphalt), side: lin(PAL.cut), bottom: lin(PAL.cut) });
  mb.convex(top, undefined, gmat);
  const found = boxP(W - 0.4, 1.0, Math.max(0.5, fr.len - 0.3), T(0, -th - 0.5, 0), { side: K.CUT, bottom: K.SOIL }, lin(o.foundCol ?? PAL.soil));
  mb.convex(found, undefined, gmat);
  if (o.soil !== false) soilUnderside(mb, W * 0.9, fr.len * 0.85, rng.range(2, 4), T(0, -th - 1.0, 0), rng);
  if (o.pipe) mb.cylinder(0.55, 0.55, W + 3, 10, RT(0, -th - 1.6, fr.len / 2 - 1.2, 0, 0, Math.PI / 2), K.METAL, lin(PAL.metal));
  const motion = o.motion || { swell: 1, ends: true, ext: [W / 2, fr.len / 2] };
  const body = ctx.body({
    mb, pos: fr.pos, quat: fr.quat, motion, flags: F.DRIVABLE | F.ROUTE,
    colliders: [{ poly: top, drivable: true, surface: 'kicker' }, { poly: found, drivable: false }], name: 'kicker',
  });
  return { body, fr };
}

// ------------------------------------------------------------- supermarket
export function supermarket(ctx, sBack, s0, s1) {
  const R = ctx.route, rng = ctx.rng.fork(777);
  const f0 = R.at(s0);
  const yaw = Math.atan2(f0.t.x, f0.t.z);
  const quat = Q(0, yaw, 0), qi = quat.clone().invert();
  const origin = R.pos(s0);
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9, ys = 0, n = 0;
  const pts = [];
  for (let s = sBack; s <= s1; s += 1) {
    const p = R.pos(s).sub(origin).applyQuaternion(qi);
    pts.push(p);
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    if (s >= s0) { ys += R.pos(s).y; n++; }
  }
  const yRoof = ys / n - 0.1;
  const x0 = minX - 0.4, x1 = maxX + 14, z0 = minZ, z1 = maxZ + 18; // right edge = the exit lip
  const W = x1 - x0, D = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const centre = V3(cx, 0, cz).applyQuaternion(quat).add(origin);
  centre.y = yRoof;
  const P = makeParent(centre, quat, { swell: 1, ext: [W / 2, D / 2], rot: { x: 0.001, y: 0.0015, z: 0.001, f: 0.25, p: 1.3 } });
  const L = (p) => V3(p.x - cx, 0, p.z - cz); // route point in deck-local
  const local = pts.map(L);
  const distToLine = (x, z) => local.reduce((m, p) => Math.min(m, Math.hypot(p.x - x, p.z - z)), 1e9);
  const exit = local[local.length - 1];
  const entry = local[0];

  const mb = new MeshBuilder(), cols = [];
  const wallCol = lin(PAL.wall2);
  const deck = boxP(W, 0.9, D, T(0, -0.45, 0), { top: K.FLATROOF, side: K.FACADE + 0.75, bottom: K.CUT }, { top: lin(PAL.flatRoof), side: wallCol, bottom: lin(PAL.cut) });
  mb.convex(deck);
  cols.push({ poly: deck, drivable: true, surface: 'roof' });
  // parapets: catch overshoots on the far and outer edges; open where the line enters/leaves
  const ph = 0.9, pt = 0.45;
  const addWall = (x, z, w, d) => { const p = boxP(w, ph, d, T(x, ph / 2, z), K.PLAIN, wallCol); mb.convex(p); cols.push({ poly: p, drivable: false, surface: 'parapet' }); };
  addWall(0, D / 2 - pt / 2, W, pt);                       // far edge
  addWall(W / 2 - pt / 2, 0, pt, D - 2 * pt);              // left (outer) edge
  const ex0 = exit.z - 10, ex1 = exit.z + 10;              // right edge: open at the exit lane
  if (ex0 > -D / 2 + 4) addWall(-W / 2 + pt / 2, (-D / 2 + 4 + ex0) / 2, pt, ex0 - (-D / 2 + 4));
  if (ex1 < D / 2 - 1) addWall(-W / 2 + pt / 2, (ex1 + D / 2 - pt) / 2, pt, D / 2 - pt - ex1);
  // roof plant: AC units, skylights, vent stacks - only well clear of the line
  const placed = [];
  for (let i = 0; i < 120 && placed.length < 16; i++) {
    const x = rng.range(-W / 2 + 4, W / 2 - 4), z = rng.range(-D / 2 + 4, D / 2 - 4);
    if (distToLine(x, z) < 13) continue;
    if (placed.some((q) => Math.hypot(q[0] - x, q[1] - z) < 7)) continue;
    placed.push([x, z]);
    const kind = rng.int(0, 2);
    if (kind === 0) { const p = boxP(3.2, 1.8, 2.4, RT(x, 0.9, z, 0, rng.range(0, 1.6), 0), K.METAL, lin(PAL.metal)); mb.convex(p); cols.push({ poly: p, drivable: false }); }
    else if (kind === 1) { const p = boxP(4, 0.5, 6, RT(x, 0.25, z, 0, rng.range(0, 1.6), 0), K.GLASS, lin(PAL.glass)); mb.convex(p); cols.push({ poly: p, drivable: false }); }
    else { mb.cylinder(0.5, 0.5, 2.4, 8, T(x, 1.2, z), K.METAL, lin(PAL.metal)); }
  }
  // membrane seams + perimeter coping for scale and speed cues
  for (let x = -W / 2 + 6; x < W / 2 - 3; x += 6) mb.box(0.12, 0.03, D - 2, T(x, 0.012, 0), K.MARK, lin(0x8e9192));
  ctx.body({ mb, pos: centre, quat, motion: { parent: P }, flags: F.DRIVABLE | F.ROUTE, colliders: cols, name: 'supermarket-roof' });
  // trolleys drifting up off the roof, a few across the line
  for (let i = 0; i < 10; i++) {
    const p = pts[Math.floor(rng.range(0.15, 0.85) * pts.length)];
    const lp = V3(p.x + rng.range(-9, 9), rng.range(1.2, 4.5), p.z + rng.range(-6, 6)).applyQuaternion(quat).add(origin);
    lp.y = yRoof + rng.range(1.0, 4.5);
    prop(ctx, 'cart', { pos: lp, quat: Q(rng.range(-0.6, 0.6), rng.range(0, 6), rng.range(-0.6, 0.6)) }, { rng, drift: 0.6 });
  }
  // the store itself hangs below the roof deck, coming apart downwards
  const bH = 8;
  const store = boxP(W - 1.2, bH, D - 1.2, T(0, -0.9 - bH / 2, 0), { side: K.FACADE + 0.75, top: K.CUT, bottom: K.CUT }, { side: wallCol, top: lin(PAL.cut), bottom: lin(PAL.cut) });
  chunkify(ctx, [{ poly: store, count: 14, explode: [0.6, 3.0] }], { pos: centre, quat }, { parent: P, centre: V3(0, 4, 0), lift: 0, tilt: 0.05, breathe: [0.1, 0.4] });
  // billboard frame on the outer edge (silhouette landmark from the kicker)
  const bb = new MeshBuilder();
  for (const s of [-1, 1]) bb.box(0.4, 7, 0.4, T(s * 6, 3.5, 0), K.METAL, lin(PAL.metal));
  bb.box(14, 4, 0.3, T(0, 7, 0), K.MARK, lin(PAL.white));
  bb.box(14.4, 0.3, 0.5, T(0, 9.1, 0), K.METAL, lin(PAL.metal));
  ctx.body({ mb: bb, pos: V3(W / 2 + 2, 0, D * 0.15).applyQuaternion(quat).add(centre), quat: quat.clone().multiply(Q(0, Math.PI / 2 + 0.2, 0.04)), motion: { parent: P, rot: { x: 0.01, y: 0.01, z: 0.02, f: 0.3, p: 2 } }, flags: 0, colliders: [{ poly: boxP(14, 4, 0.3, T(0, 7, 0), K.MARK, lin(PAL.white)) }], name: 'billboard' });
  ctx.label('SUPERMARKET ROOF', centre.clone().add(V3(0, 4, 0)), { kind: 'note' });
  return { centre, quat, W, D, parent: P, yRoof };
}

/** Floating parking lot with cars and trolleys. */
export function parkingLot(ctx, pose, o = {}) {
  const rng = ctx.rng.fork(4242 + (o.seed || 0));
  const w = o.w ?? 34, d = o.d ?? 40;
  const P = makeParent(pose.pos, pose.quat, { swell: 1, ext: [w / 2, d / 2], bob: { a: 0.5, f: 0.2, p: 1 }, rot: { x: 0.02, y: 0.01, z: 0.025, f: 0.15, p: 0.5 } });
  const mb = new MeshBuilder();
  const slab = boxP(w, 0.6, d, T(0, -0.3, 0), { top: K.PAVE, side: K.CUT, bottom: K.SOIL }, { top: lin(PAL.asphalt), side: lin(PAL.cut), bottom: lin(PAL.soil) });
  mb.convex(slab);
  for (let i = 0; i < 7; i++) mb.box(0.15, 0.02, 5, T(-w / 2 + 4 + i * 2.6, 0.01, -d / 2 + 4), K.MARK, lin(PAL.mark));
  for (let i = 0; i < 7; i++) mb.box(0.15, 0.02, 5, T(-w / 2 + 4 + i * 2.6, 0.01, d / 2 - 4), K.MARK, lin(PAL.mark));
  soilUnderside(mb, w * 0.9, d * 0.9, 5, T(0, -0.6, 0), rng);
  ctx.body({ mb, pos: pose.pos, quat: pose.quat, motion: { parent: P }, colliders: [{ poly: slab }], name: 'parking' });
  for (let i = 0; i < (o.cars ?? 5); i++) {
    const p = V3(rng.range(-w / 2 + 3, w / 2 - 3), rng.range(1.2, 4), rng.range(-d / 2 + 3, d / 2 - 3)).applyQuaternion(pose.quat).add(pose.pos);
    prop(ctx, rng.pick(['sedan', 'hatch', 'van']), { pos: p, quat: pose.quat.clone().multiply(Q(rng.range(-0.3, 0.3), rng.range(0, 6), rng.range(-0.3, 0.3))) }, { rng, drift: 0.6 });
  }
  for (let i = 0; i < (o.carts ?? 6); i++) {
    const p = V3(rng.range(-w / 2, w / 2), rng.range(1, 7), rng.range(-d / 2, d / 2)).applyQuaternion(pose.quat).add(pose.pos);
    prop(ctx, 'cart', { pos: p, quat: Q(rng.range(0, 6), rng.range(0, 6), rng.range(0, 6)) }, { rng });
  }
  return P;
}

// --------------------------------------------------------------- shop roofs
export function shopRoof(ctx, sA, sB, o = {}) {
  const rng = ctx.rng.fork(Math.round(sA * 3));
  const fr = ctx.frame(sA, sB, { dropA: o.dropA ?? 0 });
  const W = o.width ?? 18, th = 0.6;
  const wallCol = lin(rng.pick(WALLS), 0.03, rng);
  const P = makeParent(fr.pos, fr.quat, { swell: 1, ends: true, ext: [W / 2, fr.len / 2], rot: { x: 0, y: 0.002, z: 0.003, f: rng.range(0.3, 0.6), p: rng.range(0, 6) } });
  const mb = new MeshBuilder(), cols = [];
  const top = boxP(W, th, fr.len, T(0, -th / 2, 0), { top: K.FLATROOF, side: K.PLAIN, bottom: K.CUT }, { top: lin(PAL.flatRoof, 0.03, rng), side: wallCol, bottom: lin(PAL.cut) });
  mb.convex(top); cols.push({ poly: top, drivable: true, surface: 'roof' });
  for (const sx of [-1, 1]) {
    const pp = boxP(0.4, 0.8, fr.len, T(sx * (W / 2 - 0.2), 0.4, 0), K.PLAIN, wallCol);
    mb.convex(pp); cols.push({ poly: pp, drivable: false, surface: 'parapet' });
  }
  // a vent or hatch near one parapet, outside the 14 m lane
  if (rng.chance(0.7)) { const v = boxP(1.4, 1.0, 1.4, T(rng.sign() * (W / 2 - 1.4), 0.5, rng.range(-fr.len / 3, fr.len / 3)), K.METAL, lin(PAL.metal)); mb.convex(v); cols.push({ poly: v }); }
  ctx.body({ mb, pos: fr.pos, quat: fr.quat, motion: { parent: P }, flags: F.DRIVABLE | F.ROUTE, colliders: cols, name: 'shop-roof' });
  const sp = shopParts(rng, { w: fr.len - 0.3, d: W - 0.5, floors: o.floors ?? rng.int(2, 3), parapet: false, chunks: 1.3 });
  const bq = fr.quat.clone().multiply(Q(0, Math.PI / 2, 0));
  const bpos = fr.pos.clone().addScaledVector(fr.up, -th - sp.H - 0.02);
  chunkify(ctx, sp.parts, { pos: bpos, quat: bq }, { parent: P, explode: [0.15, 1.4], centre: V3(0, sp.H + 2, 0), lift: 0, height: sp.H });
  return { fr, parent: P };
}

// ----------------------------------------------------------- terrace roofs
export function terrace(ctx, s0, s1, o = {}) {
  const rng = ctx.rng.fork(5340);
  const n = o.houses ?? 5;
  const bank = (o.bank ?? 15) * DEG;
  const hd = 9.3, a = hd / 2, tb = Math.tan(bank), rise = hd * tb;
  const step = (s1 - s0) / n;
  for (let i = 0; i < n; i++) {
    const sA = s0 + i * step + (i ? 0.18 : 0), sB = s0 + (i + 1) * step - (i < n - 1 ? 0.18 : 0);
    const fr = ctx.frame(sA, sB, { flat: true, dropA: i ? 0.05 : 0 });
    const L = fr.len;
    const roofCol = lin(PAL.roof, 0.05, rng), wallCol = lin(rng.pick(WALLS), 0.04, rng);
    const P = makeParent(fr.pos, fr.quat, { swell: 1, ends: true, ext: [hd, L / 2], rot: { x: 0, y: 0.0015, z: 0.0015, f: rng.range(0.3, 0.5), p: rng.range(0, 6) } });
    const gp = transformPoly(gablePoly(2 * hd, rise, L, 0.35, { roof: K.ROOF, gable: K.FACADE }, { roof: roofCol, gable: wallCol }), T(a, -a * tb, 0));
    const mb = new MeshBuilder();
    mb.convex(gp, undefined, T(-a, a * tb + 6, 0));
    const cols = [{ poly: gp, drivable: true, surface: 'roof' }];
    if (i > 0 && rng.chance(0.75)) {
      const ch = boxP(1.0, 2.4, 1.8, T(a, rise / 2 + 1.0, -L / 2 + 0.3), K.STONE, lin(PAL.stoneDark));
      mb.convex(ch); cols.push({ poly: ch, drivable: false, surface: 'chimney' });
      for (const dz of [-0.45, 0.45]) mb.cylinder(0.18, 0.18, 0.6, 6, T(a, rise / 2 + 2.5, -L / 2 + 0.3 + dz), K.PLAIN, lin(PAL.cut));
    }
    ctx.body({ mb, pos: fr.pos, quat: fr.quat, motion: { parent: P }, flags: F.DRIVABLE | F.ROUTE, colliders: cols, name: 'terrace-roof' });
    // the house under its roof: 2 floors, front facade facing the eave side (right of the line)
    const hp = { pos: fw(fr, a, -a * tb - 6, 0), quat: fq(fr, 0, -Math.PI / 2, 0) };
    const walls = boxP(2 * hd - 0.6, 6, L - 0.25, T(0, 3, 0), { side: K.FACADE, top: K.CUT, bottom: K.CUT }, { side: wallCol, top: lin(PAL.cut), bottom: lin(PAL.cut) });
    chunkify(ctx, [{ poly: transformPoly(walls, new THREE.Matrix4().makeRotationY(Math.PI / 2)), count: 5, explode: [0.1, 0.9] }], hp, { parent: P, centre: V3(0, 7, 0), lift: 0, height: 6 });
  }
  ctx.label('PITCHED ROOF  15° BANK', ctx.route.pos((s0 + s1) / 2).add(V3(0, 6, 0)), { kind: 'note' });
}

// ------------------------------------------------------------- townhouse
/** The split townhouse: drive through its first floor; the top storey hovers above. */
export function townhouse(ctx, sA, sB) {
  const rng = ctx.rng.fork(8010);
  const fr = ctx.frame(sA, sB, { flat: true });
  const L = fr.len, W = 13.4, hw = W / 2;
  const P = makeParent(fr.pos, fr.quat, { swell: 1, ends: true, ext: [hw, L / 2], rot: { x: 0, y: 0.0015, z: 0.0015, f: 0.3, p: 1 } });
  const wallCol = lin(PAL.wall3), floorCol = lin(PAL.floor);
  const G = 3.4; // ground floor height below the drive floor
  // drive floor (route)
  {
    const mb = new MeshBuilder();
    const deck = boxP(W - 0.7, 0.35, L, T(0, -0.175, 0), { top: K.FLOOR, side: K.CUT, bottom: K.PLAIN }, { top: floorCol, side: lin(PAL.cut), bottom: lin(PAL.interior) });
    mb.convex(deck, undefined, T(0, G, 0));
    ctx.body({ mb, pos: fr.pos, quat: fr.quat, motion: { parent: P }, flags: F.DRIVABLE | F.ROUTE, colliders: [{ poly: deck, drivable: true, surface: 'floor' }], name: 'house-floor' });
  }
  const bpose = { pos: fr.pos.clone().addScaledVector(fr.up, -G), quat: fr.quat };
  const Hw = G + 3.1;
  const parts = [];
  for (const sx of [-1, 1]) {
    // side walls with a torn top edge
    let wall = boxP(0.35, Hw, L + 0.9, T(sx * (hw - 0.175), Hw / 2, 0), K.FACADE, wallCol);
    for (let k = 0; k < 2; k++) {
      const z = rng.range(-L / 3, L / 3);
      const n = V3(0, 1, rng.range(-0.25, 0.25)).normalize();
      const r = clipPoly(wall, n, n.dot(V3(0, Hw - rng.range(0.2, 1.4), z)), K.CUT, lin(PAL.cut));
      if (r.neg) wall = r.neg;
    }
    parts.push({ poly: wall, count: 6, explode: [0.03, 0.22], name: 'house-wall' });
  }
  for (const sz of [-1, 1]) {
    for (const sx of [-1, 1]) parts.push({ poly: boxP(hw - 4.7, Hw, 0.35, T(sx * (4.7 + (hw - 4.7) / 2), Hw / 2, sz * (L / 2 + 0.28)), K.FACADE, wallCol), count: 2, explode: [0.05, 0.3] });
    parts.push({ poly: boxP(9.4, G - 0.2, 0.35, T(0, (G - 0.2) / 2, sz * (L / 2 + 0.28)), K.FACADE, wallCol), count: 2, explode: [0.05, 0.3] });
  }
  parts.push({ poly: boxP(W - 0.7, 0.3, L, T(0, -0.15, 0), { top: K.FLOOR, side: K.CUT, bottom: K.CUT }, { top: floorCol, side: lin(PAL.cut), bottom: lin(PAL.cut) }), count: 2, explode: [0.05, 0.4] });
  for (const z of [-L / 2 + 8, L / 2 - 9]) for (const sx of [-1, 1]) {
    parts.push({ poly: boxP(1.4, 3.0, 0.2, T(sx * (hw - 0.35 - 0.7), G + 1.5, z), K.PLAIN, lin(PAL.wall2)), fixed: true, name: 'jamb' });
  }
  chunkify(ctx, parts, bpose, { parent: P, centre: V3(0, G + 1.5, 0), breathe: [0.02, 0.07], tilt: 0.008 });
  // garden below
  plot(ctx, { pos: fr.pos.clone().addScaledVector(fr.up, -G - 0.05), quat: fr.quat }, { parent: P, w: 26, d: L + 16, tree: true, treeChance: 1, rng });
  // the plaster wall across the drive line - burst through it
  const wallPoly = boxP(W - 1.0, 3.0, 0.16, T(0, 1.5, 0), { side: K.PLAIN, front: K.PLAIN, back: K.PLAIN }, lin(PAL.white));
  const bw = breakable(ctx, wallPoly, { pos: fw(fr, 0, 0, 2.5), quat: fr.quat }, P, { name: 'plaster-wall', count: 14 });
  ctx.label('BREAKABLE WALL', fw(fr, 0, 4.2, 2.5), { kind: 'note' });
  // contents: drifting, within reach of the line
  const F_ = (type, x, y, z, ry = 0, rx = 0, rz = 0) => prop(ctx, type, { pos: fw(fr, x, y, z), quat: fq(fr, rx, ry, rz) }, { parent: P, drift: 1.2, rng });
  F_('sofa', 4.7, 0.9, -10, Math.PI / 2, 0.05, 0.1); F_('armchair', -4.8, 1.0, -11, -1.2, 0.2); F_('armchair', -4.4, 1.6, -6, -1.9, 0.4, 0.3);
  F_('table', 1.4, 0.8, -8, 0.4, 0.08); F_('rug', 0.2, 0.25, -9, 0.2, 0.02); F_('lamp', 5.3, 1.3, -4, 0, 0.25); F_('tv', -5.5, 1.8, -2, -Math.PI / 2, 0.1);
  F_('bookshelf', 5.8, 1.5, -1, Math.PI / 2, 0, 0.15); F_('piano', -5.3, 1.1, -13, -Math.PI / 2, 0.05); F_('frame', 6.0, 2.2, -7, Math.PI / 2, 0, 0.3);
  F_('table', 0.6, 0.9, 8, 1.4, 0.1); F_('chair', 1.8, 1.2, 7, 0.5, 0.6, 0.2); F_('chair', -0.8, 1.6, 9, 2.4, -0.3, 1.0);
  F_('chair', 0.4, 2.3, 10, 3.6, 1.2, 0.4); F_('chair', -2.0, 0.9, 7.5, 1.0, 0.1); F_('fridge', 5.6, 1.4, 12, Math.PI / 2, 0.12); F_('stove', 5.5, 0.8, 10.2, Math.PI / 2);
  F_('clock', -5.7, 1.6, 5, -Math.PI / 2, 0.15); F_('crate', -5.2, 0.9, 12, 0.3, 0.2); F_('door', -3.5, 1.8, 4.2, 0.7, 0.4, 0.2);
  // things from the storey above, hanging in the gap between the halves
  F_('bed', -3.8, 5.6, -6, 0.3, 0.25, 0.2); F_('wardrobe', 4.6, 6.2, 3, 0.4, 0.2, -0.3); F_('bathtub', -4.2, 5.2, 10, 0.8, 0.3);
  F_('mattress', 2.4, 7.2, -12, 0.6, 0.9); F_('suitcase', -2, 6.5, 0, 1, 1, 1); F_('frame', 3, 5.8, 8, 0.2, 1.1, 0.5);
  // the top storey + roof, torn off and hovering
  const top = fw(fr, 0, 8.6, 0);
  const P2 = makeParent(top, fr.quat.clone().multiply(Q(0.03, 0.06, -0.04)), { swell: 1, ext: [hw, L / 2], yaw: { a: 0.04, f: 0.12, p: 0.5 }, bob: { a: 0.6, f: 0.22, p: 2 }, rot: { x: 0.015, y: 0, z: 0.02, f: 0.18, p: 1 } });
  const up = [];
  for (const sx of [-1, 1]) up.push({ poly: boxP(0.35, 3.0, L + 0.9, T(sx * (hw - 0.175), 1.5, 0), K.FACADE, wallCol), count: 4, explode: [0.1, 0.8] });
  for (const sz of [-1, 1]) up.push({ poly: boxP(W, 3.0, 0.35, T(0, 1.5, sz * (L / 2 + 0.28)), K.FACADE, wallCol), count: 3, explode: [0.1, 0.8] });
  up.push({ poly: boxP(W - 0.7, 0.3, L, T(0, -0.1, 0), { top: K.FLOOR, side: K.CUT, bottom: K.PLAIN }, { top: floorCol, side: lin(PAL.cut), bottom: lin(PAL.interior) }), count: 4, explode: [0.2, 1.2] });
  up.push({ poly: transformPoly(gablePoly(W, (W / 2) * Math.tan(0.7), L + 0.9, 0.5, { roof: K.ROOF, gable: K.FACADE }, { roof: lin(PAL.roofDark), gable: wallCol }), T(0, 3.0, 0)), count: 6, explode: [0.3, 2.0] });
  chunkify(ctx, up, { pos: top, quat: P2.baseQuat }, { parent: P2, centre: V3(0, 1.5, 0), lift: 0.15, tilt: 0.05 });
  return { fr, parent: P };
}

// ------------------------------------------------------------------ bridge
export function bridgeSpan(ctx, sA, sB, o = {}) {
  const rng = ctx.rng.fork(Math.round(sA * 5));
  const fr = ctx.frame(sA, sB, { dropA: o.dropA ?? 0 });
  const L = fr.len, W = 12.6, roadW = 8.6;
  const stone = lin(PAL.stone, 0.03, rng), stoneD = lin(PAL.stoneDark, 0.03, rng);
  const gmat = T(0, 0, fr.sMid);
  const motion = o.motion || { swell: 1, ends: true, ext: [W / 2, L / 2], rot: { x: 0, y: 0.002, z: 0.004, f: 0.4, p: rng.range(0, 6) } };
  const P = makeParent(fr.pos, fr.quat, motion);
  const planes = crackPlanes(L, rng.range(-0.3, 0.3) * (o.cutStart ?? 1), rng.range(-0.3, 0.3) * (o.cutEnd ?? 1));
  const BL = L + 9;
  const mb = new MeshBuilder(), cols = [];
  const add = (poly, col) => { if (!poly) return; mb.convex(poly, undefined, gmat); if (col) cols.push(col(poly)); };
  add(clipAll(boxP(roadW, 0.4, BL, T(0, -0.2, 0), { top: K.ROAD, side: K.CUT, bottom: K.CUT }, { top: lin(PAL.asphalt), side: stoneD, bottom: stoneD }), planes), (p) => ({ poly: p, drivable: true, surface: 'road' }));
  for (const sx of [-1, 1]) {
    add(clipAll(boxP((W - roadW) / 2, 0.52, BL, T(sx * (roadW / 2 + (W - roadW) / 4), -0.14, 0), { top: K.PAVE, side: K.STONE, bottom: K.CUT }, { top: lin(PAL.pave), side: stone, bottom: stoneD }), planes), (p) => ({ poly: p, drivable: true, surface: 'kerb' }));
    add(clipAll(boxP(0.6, 1.05, BL, T(sx * (W / 2 + 0.3), 0.52, 0), K.STONE, stone), planes), (p) => ({ poly: p, drivable: false, surface: 'parapet' }));
  }
  add(clipAll(boxP(W + 1.2, 2.2, BL, T(0, -0.4 - 1.1, 0), { side: K.STONE, bottom: K.STONE }, stone), planes), (p) => ({ poly: p, drivable: false }));
  // arch ring below: rises to the crown at mid-span
  const rise = Math.min(6, L * 0.16);
  const nb = 9;
  for (let j = 0; j < nb; j++) {
    const ph = Math.PI * (j + 0.5) / nb;
    const z = -(L / 2) * Math.cos(ph), y = -2.6 - rise * (1 - Math.sin(ph));
    const slope = Math.atan2(rise * Math.cos(ph), (L / 2) * Math.sin(ph)); // dy/dz of the intrados
    const blk = boxP(W + 0.8, 1.0, (L / nb) * 1.08 / Math.max(0.35, Math.cos(slope)), RT(0, y, z, -slope, 0, 0), K.STONE, stoneD);
    add(clipAll(blk, planes));
    const fillH = -2.6 - y;
    if (fillH > 0.6) add(clipAll(boxP(W + 0.9, fillH, L / nb + 0.05, T(0, -2.6 - fillH / 2, z), K.STONE, stone), planes));
  }
  ctx.body({ mb, pos: fr.pos, quat: fr.quat, motion: { parent: P }, flags: F.DRIVABLE | F.ROUTE, colliders: cols, name: 'bridge-span' });
  // lamp standards on the parapets
  for (const z of [-L / 4, L / 4]) {
    if (rng.chance(0.6)) prop(ctx, 'lamppost', { pos: fw(fr, rng.sign() * (W / 2 + 0.3), 3.8, z), quat: fq(fr, rng.range(-0.15, 0.15), rng.range(0, 3), rng.range(-0.2, 0.2)) }, { parent: P, drift: 0.8, rng });
  }
  return { fr, parent: P };
}

export function bridgePier(ctx, pos, quat, rng) {
  const parts = [{ poly: boxP(14, 12, 4.5, T(0, -6, 0), K.STONE, lin(PAL.stone, 0.03, rng)), count: 4, explode: [0.3, 1.5] }];
  parts.push({ poly: transformPoly(polyFromFaces(prismFaces(4.5, 12, 3.2)), T(0, -6, 0)), count: 1, explode: [0.2, 0.8] });
  chunkify(ctx, parts, { pos, quat }, { motion: { swell: 1, ext: [7, 2.5], bob: { a: 0.8, f: 0.2, p: rng.range(0, 6) }, rot: { x: 0.03, y: 0.02, z: 0.03, f: 0.15, p: rng.range(0, 6) } }, centre: V3(0, -6, 0) });
}

function prismFaces(w, h, tip) {
  // cutwater: triangular prism pointing +Z
  const a = V3(-w / 2, -h / 2, w / 2), b = V3(w / 2, -h / 2, w / 2), c = V3(0, -h / 2, w / 2 + tip);
  const a2 = a.clone().setY(h / 2), b2 = b.clone().setY(h / 2), c2 = c.clone().setY(h / 2);
  const col = lin(PAL.stoneDark), k = K.STONE;
  return [
    { v: [a, b, c], kind: k, color: col }, { v: [a2, c2, b2], kind: k, color: col },
    { v: [a, a2, b2, b], kind: k, color: col }, { v: [b, b2, c2, c], kind: k, color: col }, { v: [c, c2, a2, a], kind: k, color: col },
  ];
}

export function riverPiece(ctx, pose, w, d, rng) {
  const P = makeParent(pose.pos, pose.quat, { swell: 1, ext: [w / 2, d / 2], bob: { a: 0.6, f: 0.18, p: rng.range(0, 6) }, rot: { x: 0.02, y: 0.015, z: 0.02, f: 0.13, p: rng.range(0, 6) } });
  const mb = new MeshBuilder();
  let water = boxP(w, 0.8, d, T(0, -0.4, 0), { top: K.WATER, side: K.WATER, bottom: K.SOIL }, { top: lin(PAL.water), side: lin(PAL.water), bottom: lin(PAL.soil) });
  for (let i = 0; i < 2; i++) {
    const a = rng.range(0, Math.PI * 2), n = V3(Math.cos(a), 0, Math.sin(a));
    const r = clipPoly(water, n, (Math.abs(n.x) * w + Math.abs(n.z) * d) / 2 * rng.range(0.75, 0.95), K.WATER, lin(PAL.water));
    if (r.neg) water = r.neg;
  }
  mb.convex(water);
  for (const sx of [-1, 1]) mb.box(4, 1.4, d * 0.9, T(sx * (w / 2 + 1.6), -0.3, 0), { top: K.GRASS, side: K.SOIL, bottom: K.SOIL }, { top: lin(PAL.grass), side: lin(PAL.soil), bottom: lin(PAL.soil) });
  soilUnderside(mb, w + 6, d * 0.9, rng.range(3, 6), T(0, -1.0, 0), rng);
  ctx.body({ mb, pos: pose.pos, quat: pose.quat, motion: { parent: P }, colliders: [{ poly: water }], name: 'river' });
  return P;
}

// ------------------------------------------------------------------ plaza
export function plaza(ctx, s0, s1, o = {}) {
  const R = ctx.route, rng = ctx.rng.fork(1169);
  const f0 = R.at(s0);
  const yaw = Math.atan2(f0.t.x, f0.t.z);
  const quat = Q(0, yaw, 0), qi = quat.clone().invert();
  const origin = R.pos(s0);
  // least-squares plane through the line, bounding box of the line
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  const pts = [];
  for (let s = s0; s <= s1; s += 1) {
    const p = R.pos(s).sub(origin).applyQuaternion(qi);
    pts.push(p);
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  const y0 = pts.reduce((a, p) => a + p.y, 0) / pts.length;
  const m = o.margin ?? 14;
  const x0 = minX - m, x1 = maxX + m, z0 = minZ - 4, z1 = maxZ + m;
  const W = x1 - x0, D = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const centre = V3(cx, y0, cz).applyQuaternion(quat).add(origin);
  centre.y = origin.y + y0 - 0.05;
  const slab = boxP(W, 0.8, D, T(0, -0.4, 0), { top: K.PAVE, side: K.CUT, bottom: K.SOIL }, { top: lin(PAL.pave), side: lin(PAL.cut), bottom: lin(PAL.soil) });
  const tiles = fracturePoly(slab, { count: o.tiles ?? 20, rng, minFrac: 0.02, jitter: 0.42, cutColor: lin(PAL.cut), normalFn: (r) => V3(r.gauss(), 0, r.gauss()) });
  const bodies = [];
  for (const t of tiles) {
    const { poly, centroid } = centrePoly(t);
    // pull each tile in a little so cracks show (horizontal shrink about its centroid)
    const bb = new THREE.Box3();
    for (const f of poly.faces) for (const p of f.v) bb.expandByPoint(p);
    const sz = bb.getSize(V3());
    const kx = Math.max(0.9, 1 - 0.3 / Math.max(1, sz.x)), kz = Math.max(0.9, 1 - 0.3 / Math.max(1, sz.z));
    for (const f of poly.faces) for (const p of f.v) { p.x *= kx; p.z *= kz; }
    const mb = new MeshBuilder();
    mb.convex(poly, undefined, T(centroid.x, centroid.y, centroid.z));
    soilUnderside(mb, sz.x * 0.7, sz.z * 0.7, rng.range(1.5, 4), T(0, -0.8 - centroid.y + 0.4, 0), rng);
    const wpos = centroid.clone().applyQuaternion(quat).add(centre);
    bodies.push(ctx.body({
      mb, pos: wpos, quat, flags: F.DRIVABLE | F.ROUTE,
      motion: { swell: 1, ext: [sz.x / 2, sz.z / 2], rot: { x: rng.range(0.0006, 0.0016), y: 0.0008, z: rng.range(0.0006, 0.0016), f: rng.range(0.2, 0.4), p: rng.range(0, 6) } },
      colliders: [{ poly, drivable: true, surface: 'plaza' }], name: 'plaza-tile',
    }));
  }
  const local = pts.map((p) => V3(p.x - cx, 0, p.z - cz));
  return { centre, quat, W, D, local, distToLine: (x, z) => local.reduce((mm, p) => Math.min(mm, Math.hypot(p.x - x, p.z - z)), 1e9) };
}

export function fountain(ctx, pos, quat, rng) {
  const P = makeParent(pos, quat, { swell: 1, ext: [5, 5], rot: { x: 0.01, y: 0.02, z: 0.01, f: 0.2, p: 0.3 } });
  const parts = [];
  const r = 5, n = 8, stone = lin(PAL.stone);
  for (let i = 0; i < n; i++) {
    const a = (i + 0.5) / n * Math.PI * 2;
    parts.push({ poly: boxP(2 * r * Math.tan(Math.PI / n) + 0.1, 0.9, 0.5, RT(Math.cos(a) * r, 0.45, Math.sin(a) * r, 0, -a + Math.PI / 2, 0), K.STONE, stone), count: 1, explode: [0.1, 0.7] });
  }
  parts.push({ poly: boxP(9, 0.3, 9, T(0, 0.1, 0), { top: K.WATER, side: K.STONE }, { top: lin(PAL.water), side: stone }), count: 3, explode: [0.05, 0.4] });
  chunkify(ctx, parts, { pos, quat }, { parent: P, centre: V3(0, 0.3, 0), tilt: 0.06 });
  const mb = new MeshBuilder();
  mb.cylinder(0.6, 0.5, 3, 8, T(0, 1.5, 0), K.STONE, stone);
  mb.cylinder(0.5, 2.2, 0.8, 10, T(0, 3.3, 0), K.STONE, stone);
  mb.box(0.8, 1.6, 0.6, T(0, 4.6, 0), K.STONE, lin(PAL.stoneDark));
  mb.box(0.5, 0.5, 0.5, T(0, 5.65, 0), K.STONE, lin(PAL.stoneDark));
  ctx.body({ mb, pos: pos.clone().add(V3(0.6, 1.6, -0.4)), quat: quat.clone().multiply(Q(0.12, 0.4, -0.1)), motion: { parent: P, bob: { a: 0.3, f: 0.3, p: 1 }, rot: { x: 0.04, y: 0.05, z: 0.04, f: 0.2, p: 2 } }, colliders: [{ poly: boxP(2.4, 6, 2.4, T(0, 3, 0), K.STONE, stone) }], name: 'fountain-column' });
  // loose water: flat discs hovering above the basin
  for (let i = 0; i < 5; i++) {
    const wm = new MeshBuilder();
    const rr = rng.range(0.5, 1.4);
    wm.cylinder(rr, rr * 0.8, rr * 0.35, 9, T(0, 0, 0), K.WATER, lin(PAL.water));
    ctx.body({ mb: wm, pos: pos.clone().add(V3(rng.range(-3, 3), rng.range(2, 6), rng.range(-3, 3))), quat: Q(rng.range(0, 6), rng.range(0, 6), 0), motion: { swell: 1, ext: [1, 1], bob: { a: 0.5, f: rng.range(0.3, 0.6), p: rng.range(0, 6) }, spin: { axis: [rng.gauss(), rng.gauss(), rng.gauss()], rate: rng.range(0.1, 0.3) } }, flags: F.SCENERY, name: 'water-blob' });
  }
}

// ------------------------------------------------------------------ church
export function church(ctx, sGap0, sNave0, sNave1, sKick1, sLip) {
  const rng = ctx.rng.fork(1365);
  const fr = ctx.frame(sNave0, sNave1, { flat: true });
  const L = fr.len, W = 16.4, hw = W / 2;
  const P = makeParent(fr.pos, fr.quat, { swell: 1, ends: true, ext: [hw, L / 2], rot: { x: 0, y: 0.001, z: 0.0015, f: 0.25, p: 0.4 } });
  const stone = lin(PAL.stone), stoneD = lin(PAL.stoneDark), floorCol = lin(PAL.pave);
  // nave floor (route) with the crypt hanging below
  {
    const mb = new MeshBuilder();
    const deck = boxP(W, 0.6, L + 0.4, T(0, -0.3, 0), { top: K.STONE, side: K.STONE, bottom: K.CUT }, { top: floorCol, side: stone, bottom: lin(PAL.cut) });
    mb.convex(deck);
    ctx.body({ mb, pos: fr.pos, quat: fr.quat, motion: { parent: P }, flags: F.DRIVABLE | F.ROUTE, colliders: [{ poly: deck, drivable: true, surface: 'nave' }], name: 'nave-floor' });
    chunkify(ctx, [{ poly: boxP(W - 1, 4, L - 2, T(0, -2.6, 0), K.STONE, stoneD), count: 5, explode: [0.4, 2.0] }], { pos: fr.pos, quat: fr.quat }, { parent: P, centre: V3(0, 0, 0), lift: 0 });
  }
  // nave walls with lancet windows, split and leaning out
  const Hn = 12;
  const walls = [];
  for (const sx of [-1, 1]) {
    walls.push({ poly: boxP(0.9, Hn, L + 6, T(sx * (hw + 0.45), Hn / 2, 2), K.FACADE + 0.5, stone), count: 6, explode: [0.3, 1.6] });
    for (let z = -L / 2 + 4; z < L / 2 + 4; z += 8) walls.push({ poly: boxP(1.3, 8.5, 1.6, T(sx * (hw + 1.45), 4.25, z), K.STONE, stoneD), count: 1, explode: [0.3, 1.0] });
  }
  chunkify(ctx, walls, { pos: fr.pos, quat: fr.quat }, { parent: P, centre: V3(0, 3, 0), lift: 0.03, tilt: 0.04 });
  // the roof, blown open and drifting above
  const roofH = hw * Math.tan(0.9);
  chunkify(ctx, [{ poly: transformPoly(gablePoly(W + 1.8, roofH, L + 6, 0.6, { roof: K.ROOF + 0.5, gable: K.FACADE + 0.5 }, { roof: lin(PAL.roofDark), gable: stone }), T(0, Hn, 2)), count: 9, explode: [2.5, 8] }],
    { pos: fr.pos, quat: fr.quat }, { parent: P, centre: V3(0, Hn - 4, 0), lift: 0.25, tilt: 0.12, solid: false });
  // arcade columns (some broken into drums)
  for (const sx of [-1, 1]) for (let z = -L / 2 + 15; z <= L / 2 - 3; z += 6.6) {
    const broken = rng.chance(0.35);
    const segs = broken ? 3 : 1;
    for (let k = 0; k < segs; k++) {
      const h = 9 / segs;
      const mb = new MeshBuilder();
      mb.cylinder(0.55, 0.55, h - 0.05, 10, T(0, 0, 0), K.STONE, stone);
      if (k === segs - 1) mb.box(1.5, 0.5, 1.5, T(0, h / 2 + 0.25, 0), K.STONE, stoneD);
      const lift = broken ? k * rng.range(0.5, 1.6) : 0;
      ctx.body({
        mb, pos: fw(fr, sx * 5.7 + (broken ? rng.range(-0.3, 0.3) * k : 0), h / 2 + k * h + lift, z), quat: fq(fr, broken ? rng.range(-0.15, 0.15) * k : 0, 0, broken ? rng.range(-0.15, 0.15) * k : 0),
        motion: { parent: P, bob: broken && k ? { a: 0.2, f: rng.range(0.3, 0.5), p: rng.range(0, 6) } : undefined },
        colliders: [{ poly: boxP(1.1, h, 1.1, null, K.STONE, stone) }], name: 'column',
      });
    }
  }
  // pews drift in the aisle - plough through them
  for (let z = -L / 2 + 14; z < L / 2 - 6; z += 2.6) for (const sx of [-1, 1]) {
    if (rng.chance(0.12)) continue;
    prop(ctx, 'pew', { pos: fw(fr, sx * 2.7 + rng.range(-0.3, 0.3), rng.range(0.6, 1.8), z + rng.range(-0.3, 0.3)), quat: fq(fr, rng.range(-0.2, 0.2), rng.range(-0.15, 0.15), rng.range(-0.25, 0.25)) }, { parent: P, drift: 1.4, rng });
  }
  for (let i = 0; i < 6; i++) prop(ctx, 'candles', { pos: fw(fr, rng.range(-6, 6), rng.range(4.5, 8), rng.range(-L / 2, L / 2)), quat: Q(rng.range(0, 6), rng.range(0, 6), rng.range(0, 6)) }, { rng });
  // tower over the west door: the line passes through its base
  const tz = -L / 2 + 5.0;
  const tp = { pos: fw(fr, 0, 0, tz), quat: fr.quat };
  const TP = makeParent(tp.pos, tp.quat, { swell: 1, ext: [6, 6], rot: { x: 0.003, y: 0.002, z: 0.003, f: 0.2, p: 3 } });
  const tw = 12.4, td = 11, door = 8.6, doorH = 7.2;
  chunkify(ctx, [
    { poly: boxP((tw - door) / 2, 10, td, T(-(door / 2 + (tw - door) / 4), 5, 0), K.STONE, stone), count: 2, explode: [0.02, 0.12] },
    { poly: boxP((tw - door) / 2, 10, td, T(door / 2 + (tw - door) / 4, 5, 0), K.STONE, stone), count: 2, explode: [0.02, 0.12] },
    { poly: boxP(door + 0.2, 10 - doorH, td, T(0, doorH + (10 - doorH) / 2, 0), K.FACADE + 0.5, stone), count: 2, explode: [0.05, 0.25] },
  ], tp, { parent: TP, centre: V3(0, 4, 0), tilt: 0.004, breathe: [0.01, 0.04] });
  const stack = [
    { h: 11, w: 11.4, y: 10, lift: 1.4, rot: [0.03, 0.06, -0.04] },
    { h: 8, w: 10.4, y: 21, lift: 3.4, rot: [-0.05, -0.08, 0.06] },
  ];
  for (const s of stack) {
    const pos = fw(fr, rng.range(-0.6, 0.6), s.y + s.lift, tz + rng.range(-0.6, 0.6));
    chunkify(ctx, [{ poly: boxP(s.w, s.h, s.w * 0.92, T(0, s.h / 2, 0), { side: K.FACADE + 0.5, top: K.CUT, bottom: K.CUT }, { side: stone, top: lin(PAL.cut), bottom: lin(PAL.cut) }), count: 4, explode: [0.2, 0.9] }],
      { pos, quat: fq(fr, ...s.rot) }, { motion: { swell: 1, ext: [6, 6], bob: { a: 0.5, f: 0.17, p: s.y }, rot: { x: 0.02, y: 0.03, z: 0.02, f: 0.12, p: s.y } }, centre: V3(0, s.h / 2, 0) });
  }
  // spire
  {
    const mb = new MeshBuilder();
    mb.cylinder(6.2, 0.01, 17, 8, T(0, 8.5, 0), K.ROOF + 0.5, lin(PAL.roofDark), null, null, Math.PI / 8);
    mb.box(0.25, 3.2, 0.25, T(0, 18.4, 0), K.METAL, lin(PAL.metal));
    mb.box(1.6, 0.25, 0.25, T(0, 18.8, 0), K.METAL, lin(PAL.metal));
    ctx.body({ mb, pos: fw(fr, 1.0, 37, tz - 0.8), quat: fq(fr, 0.1, 0.3, -0.12), motion: { swell: 1, ext: [5, 5], bob: { a: 0.9, f: 0.15, p: 1 }, rot: { x: 0.03, y: 0.05, z: 0.03, f: 0.1, p: 2 } }, colliders: [{ poly: boxP(8, 17, 8, T(0, 8.5, 0), K.ROOF, lin(PAL.roofDark)) }], name: 'spire' });
  }
  // the apse beyond the chancel: a half-ring blown outward, clear exit for the leap
  const fk = ctx.frame(sNave1, sLip, { flat: true });
  const apse = fw(fk, 0, 0, fk.len / 2 + 2);
  const AP = makeParent(apse, fk.quat, { swell: 1, ext: [8, 8], rot: { x: 0.01, y: 0.01, z: 0.01, f: 0.2, p: 0.9 } });
  const ap = [];
  for (let i = 0; i < 9; i++) {
    const a = (i + 0.5) / 9 * Math.PI;
    if (i >= 2 && i <= 6) continue; // blown-out centre: the exit
    ap.push({ poly: boxP(5.9, Hn, 0.9, RT(Math.cos(a) * 8.6, Hn / 2, Math.sin(a) * 8.6 * 0.6, 0, -a + Math.PI / 2, 0), K.FACADE + 0.5, stone), count: 3, explode: [0.5, 2.5] });
  }
  chunkify(ctx, ap, { pos: apse, quat: fk.quat }, { parent: AP, centre: V3(0, 4, -4), tilt: 0.1 });
  // shards of the blown-out section, flung wide of the flight path
  for (let i = 0; i < 10; i++) {
    const side = i % 2 ? 1 : -1;
    const p = fw(fk, side * rng.range(10, 22), rng.range(-6, 14), fk.len / 2 + rng.range(4, 26));
    const mb = new MeshBuilder();
    const pc = fracturePoly(boxP(rng.range(2, 4), rng.range(2, 5), 0.9, null, K.FACADE + 0.5, stone), { count: 2, rng, cutColor: lin(PAL.cut) })[0];
    const { poly } = centrePoly(pc);
    mb.convex(poly);
    ctx.body({ mb, pos: p, quat: Q(rng.range(0, 6), rng.range(0, 6), rng.range(0, 6)), motion: { swell: 1, ext: [2, 2], bob: { a: 0.5, f: 0.3, p: i }, spin: { axis: [rng.gauss(), rng.gauss(), rng.gauss()], rate: rng.range(0.05, 0.2) } }, colliders: [{ poly }], name: 'apse-shard' });
  }
  ctx.label('THE CHURCH', fw(fr, 0, 16, 0), { kind: 'note' });
  return { fr, parent: P };
}

// ------------------------------------------------------------------ portal
/**
 * The exit portal: a plain stone gateway. Through it you see the destination
 * (rendered by render/portalView.js). Returned frame: +Z = direction of travel.
 */
export function portalGate(ctx, s, o = {}) {
  const R = ctx.route, rng = ctx.rng.fork(9000);
  const f = R.at(s);
  const yaw = Math.atan2(f.t.x, f.t.z);
  const quat = Q(0, yaw, 0);
  const centre = R.pos(s).add(V3(0, o.lift ?? 0.8, 0));
  const w = o.w ?? 18, h = o.h ?? 11, post = 2.4, lint = 2.2, depth = 2.6;
  const P = makeParent(centre, quat, { swell: 1, ext: [w / 2, 2], rot: { x: 0.004, y: 0.004, z: 0.004, f: 0.2, p: 1.1 } });
  const parts = [
    { poly: boxP(post, h + lint, depth, T(-(w / 2 + post / 2), lint / 2 - 0.0, 0), K.STONE, lin(PAL.stone)), fixed: true },
    { poly: boxP(post, h + lint, depth, T(w / 2 + post / 2, lint / 2, 0), K.STONE, lin(PAL.stone)), fixed: true },
    { poly: boxP(w + 2 * post, lint, depth, T(0, h / 2 + lint / 2, 0), K.STONE, lin(PAL.stone)), fixed: true },
    { poly: boxP(w + 2 * post + 0.6, 0.6, depth + 0.6, T(0, h / 2 + lint + 0.3, 0), K.STONE, lin(PAL.stoneDark)), fixed: true },
    { poly: boxP(w + 2 * post, 1.2, depth, T(0, -h / 2 - 0.6, 0), K.STONE, lin(PAL.stoneDark)), fixed: true },
  ];
  chunkify(ctx, parts, { pos: centre, quat }, { parent: P, centre: V3(0, 0, 0) });
  // broken base hanging under the gate
  chunkify(ctx, [{ poly: boxP(w + 2 * post, 3, depth + 2, T(0, -h / 2 - 2.8, 0), K.STONE, lin(PAL.stoneDark)), count: 4, explode: [0.4, 2] }], { pos: centre, quat }, { parent: P, centre: V3(0, 0, 0) });
  ctx.label('PORTAL  >  SECTION 2', centre.clone().add(V3(0, h / 2 + 4.5, 0)), { kind: 'portal', size: 1.4 });
  return { centre, quat, w, h, parent: P };
}
