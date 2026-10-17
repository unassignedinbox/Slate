// Buildings: assembled from convex parts (walls, floors, roof prisms), fractured,
// and turned into chunk bodies that ride a shared parent motion and drift a little
// on their own. Patterns (windows, tiles, masonry) live in building space, so a
// facade still reads as one facade across its cracks.
import * as THREE from 'three';
import { MeshBuilder, K, PAL, lin, newellNormal } from '../../core/geo.js';
import { fracturePoly, centrePoly, transformPoly, polyMass, clipPoly } from '../../core/fracture.js';
import { F } from '../../core/world.js';
import { makeParent } from '../../core/motion.js';
import { boxP, V3, Q, M4, soilUnderside } from '../ctx.js';

const T = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z);

/** Polyhedron from loose face loops; normals are oriented away from the vertex centroid. */
export function polyFromFaces(list) {
  const c = new THREE.Vector3();
  let k = 0;
  for (const f of list) for (const p of f.v) { c.add(p); k++; }
  c.multiplyScalar(1 / k);
  const faces = [];
  for (const f of list) {
    let v = f.v.map((p) => p.clone());
    const n = newellNormal(v, new THREE.Vector3());
    const fc = v.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / v.length);
    if (n.dot(fc.sub(c)) < 0) { v.reverse(); n.negate(); }
    faces.push({ v, n, kind: f.kind, color: f.color });
  }
  return { faces };
}

/** Gable roof prism, ridge along Z, base (eave line) at y=0. */
export function gablePoly(w, h, L, oh, kinds, cols) {
  const hw = w / 2 + oh, hl = L / 2 + oh * 0.6, drop = (oh / (w / 2)) * h;
  const a0 = V3(-hw, -drop, -hl), a1 = V3(hw, -drop, -hl), r0 = V3(0, h, -hl);
  const b0 = V3(-hw, -drop, hl), b1 = V3(hw, -drop, hl), r1 = V3(0, h, hl);
  return polyFromFaces([
    { v: [a0, b0, r1, r0], kind: kinds.roof, color: cols.roof },
    { v: [a1, r0, r1, b1], kind: kinds.roof, color: cols.roof },
    { v: [a0, r0, a1], kind: kinds.gable, color: cols.gable },
    { v: [b0, b1, r1], kind: kinds.gable, color: cols.gable },
    { v: [a0, a1, b1, b0], kind: K.CUT, color: cols.under || cols.gable },
  ]);
}

/** Hip roof (pyramid if square). */
export function hipPoly(w, h, L, oh, kinds, cols) {
  const hw = w / 2 + oh, hl = L / 2 + oh, drop = (oh / (Math.min(w, L) / 2)) * h;
  const c00 = V3(-hw, -drop, -hl), c10 = V3(hw, -drop, -hl), c11 = V3(hw, -drop, hl), c01 = V3(-hw, -drop, hl);
  const rl = Math.max(0, hl - hw);
  const ra = V3(0, h, -rl), rb = V3(0, h, rl);
  const faces = [{ v: [c00, c10, c11, c01], kind: K.CUT, color: cols.under || cols.gable }];
  if (rl > 0.05) {
    faces.push({ v: [c00, c01, rb, ra], kind: kinds.roof, color: cols.roof });
    faces.push({ v: [c10, ra, rb, c11], kind: kinds.roof, color: cols.roof });
    faces.push({ v: [c00, ra, c10], kind: kinds.roof, color: cols.roof });
    faces.push({ v: [c01, c11, rb], kind: kinds.roof, color: cols.roof });
  } else {
    faces.push({ v: [c00, c01, ra], kind: kinds.roof, color: cols.roof });
    faces.push({ v: [c10, ra, c11], kind: kinds.roof, color: cols.roof });
    faces.push({ v: [c00, ra, c10], kind: kinds.roof, color: cols.roof });
    faces.push({ v: [c01, c11, ra], kind: kinds.roof, color: cols.roof });
  }
  return polyFromFaces(faces);
}

/**
 * Turn building-space parts into chunk bodies.
 * parts: [{ poly, count, explode:[a,b], drivable, solid, name, fixed }]
 * pose: { pos, quat } of the building origin (ground-floor centre).
 * motion: parent motion descriptor (whole building) or an existing parent.
 */
export function chunkify(ctx, parts, pose, o = {}) {
  const rng = o.rng || ctx.rng.fork(ctx.stats.bodies + 11);
  const par = o.parent || makeParent(pose.pos, pose.quat, o.motion || { swell: 1, ext: [8, 8], rot: { x: 0.012, y: 0.01, z: 0.012, f: rng.range(0.15, 0.3), p: rng.range(0, 6) } });
  const centre = o.centre || V3(0, (o.height || 6) / 2, 0);
  const bodies = [];
  const flagsBase = o.flags ?? 0;
  for (const part of parts) {
    if (!part.poly) continue;
    const count = part.count ?? 1;
    const pieces = count > 1 ? fracturePoly(part.poly, { count, rng, minFrac: part.minFrac ?? 0.06, jitter: 0.35, cutColor: lin(part.cutCol ?? PAL.cut), normalFn: part.normalFn }) : [part.poly];
    for (const pc of pieces) {
      const { poly, centroid } = centrePoly(pc);
      if (polyMass(poly).volume < (part.minVol ?? 0.02)) continue;
      const dir = centroid.clone().sub(centre);
      if (dir.lengthSq() < 1e-6) dir.set(rng.range(-1, 1), 0.3, rng.range(-1, 1));
      dir.normalize();
      const ex = part.fixed ? 0 : rng.range(...(part.explode || o.explode || [0.1, 0.6]));
      const off = dir.clone().multiplyScalar(ex);
      off.y += part.fixed ? 0 : Math.max(0, centroid.y) * (o.lift ?? 0.02);
      const tilt = part.fixed ? 0 : (o.tilt ?? 0.03);
      const lq = Q(rng.range(-tilt, tilt), rng.range(-tilt, tilt), rng.range(-tilt, tilt));
      const mb = new MeshBuilder();
      mb.convex(poly, undefined, T(centroid.x, centroid.y, centroid.z));
      const wpos = centroid.clone().add(off).applyQuaternion(pose.quat).add(pose.pos);
      const wq = pose.quat.clone().multiply(lq);
      const wdir = dir.clone().applyQuaternion(pose.quat);
      const own = part.fixed ? { parent: par } : {
        parent: par,
        drift: { d: [wdir.x, wdir.y, wdir.z], a: rng.range(...(o.breathe || [0.06, 0.32])), f: rng.range(0.2, 0.5), p: rng.range(0, 6.28) },
        rot: { x: rng.range(0, 0.008), y: rng.range(0, 0.006), z: rng.range(0, 0.008), f: rng.range(0.2, 0.45), p: rng.range(0, 6.28) },
      };
      const solid = part.solid ?? o.solid ?? true;
      const cols = solid || part.drivable ? [{ poly, drivable: !!part.drivable, surface: part.surface || 'building' }] : [];
      bodies.push(ctx.body({
        mb, pos: wpos, quat: wq, motion: own, flags: flagsBase | (part.drivable ? F.DRIVABLE : 0) | (part.flags || 0),
        colliders: cols, name: part.name || o.name || 'chunk',
      }));
    }
  }
  return { bodies, parent: par };
}

// -------------------------------------------------------------------- house
const WALLS = [PAL.wall, PAL.wall2, PAL.wall3, PAL.wall4];

/**
 * Detached house. Building space: origin at ground-floor centre, front = +Z.
 * o: { w, d, floors, roof:'gable'|'hip'|'flat', pitch, hollow, chunks (0..1 scale), explode }
 */
export function houseParts(rng, o = {}) {
  const w = o.w ?? rng.range(8, 11), d = o.d ?? rng.range(8, 12), floors = o.floors ?? rng.int(2, 3);
  const H = floors * 3;
  const wallCol = lin(o.wall ?? rng.pick(WALLS), 0.03, rng);
  const roofCol = lin(o.roofCol ?? (rng.chance(0.5) ? PAL.roof : PAL.roofDark), 0.04, rng);
  const fk = o.facade ?? K.FACADE;
  const n = o.chunks ?? 1;
  const parts = [];
  const wt = 0.35;
  if (o.hollow) {
    parts.push({ poly: boxP(w, H, wt, T(0, H / 2, d / 2 - wt / 2), fk, wallCol), count: Math.round(3 * n), name: 'wall' });
    parts.push({ poly: boxP(w, H, wt, T(0, H / 2, -d / 2 + wt / 2), fk, wallCol), count: Math.round(3 * n), name: 'wall' });
    parts.push({ poly: boxP(wt, H, d - 2 * wt, T(w / 2 - wt / 2, H / 2, 0), fk, wallCol), count: Math.round(3 * n), name: 'wall' });
    parts.push({ poly: boxP(wt, H, d - 2 * wt, T(-w / 2 + wt / 2, H / 2, 0), fk, wallCol), count: Math.round(3 * n), name: 'wall' });
    for (let f = 0; f < floors; f++) {
      parts.push({ poly: boxP(w - 2 * wt, 0.3, d - 2 * wt, T(0, f * 3 + 0.15 - (f === 0 ? 0.3 : 0), 0), { top: K.FLOOR, side: K.CUT, bottom: K.PLAIN }, { top: lin(PAL.floor, 0.04, rng), side: lin(PAL.cut), bottom: lin(PAL.interior) }), count: Math.max(1, Math.round(2 * n)), name: 'floor' });
    }
  } else {
    parts.push({ poly: boxP(w, H, d, T(0, H / 2, 0), { side: fk, top: K.CUT, bottom: K.CUT }, { side: wallCol, top: lin(PAL.cut), bottom: lin(PAL.cut) }), count: Math.max(1, Math.round(5 * n)), name: 'house' });
  }
  const roof = o.roof ?? (rng.chance(0.7) ? 'gable' : 'hip');
  const pitch = o.pitch ?? rng.range(0.5, 0.75);
  if (roof === 'gable') {
    const rh = (w / 2) * Math.tan(pitch);
    parts.push({ poly: transformPoly(gablePoly(w, rh, d, 0.45, { roof: K.ROOF, gable: fk }, { roof: roofCol, gable: wallCol }), T(0, H, 0)), count: Math.max(1, Math.round(3 * n)), name: 'roof' });
  } else if (roof === 'hip') {
    const rh = (Math.min(w, d) / 2) * Math.tan(pitch);
    parts.push({ poly: transformPoly(hipPoly(w, rh, d, 0.45, { roof: K.ROOF }, { roof: roofCol, gable: wallCol }), T(0, H, 0)), count: Math.max(1, Math.round(3 * n)), name: 'roof' });
  } else {
    parts.push({ poly: boxP(w + 0.2, 0.5, d + 0.2, T(0, H + 0.25, 0), { top: K.FLATROOF, side: K.PLAIN }, { top: lin(PAL.flatRoof), side: wallCol }), count: Math.max(1, Math.round(2 * n)), name: 'roof' });
  }
  if (o.chimney !== false && roof !== 'flat' && rng.chance(0.75)) {
    const cx = rng.sign() * w * 0.22, cz = rng.range(-0.3, 0.3) * d;
    parts.push({ poly: boxP(0.9, 3.2, 0.9, T(cx, H + 1.8, cz), K.STONE, lin(PAL.stoneDark, 0.04, rng)), count: 1, name: 'chimney', explode: [0.3, 1.2] });
  }
  return { parts, w, d, H, floors };
}

/** Shop / terraced commercial block with flat roof + parapets; roof can be a route deck elsewhere. */
export function shopParts(rng, o = {}) {
  const w = o.w ?? 12, d = o.d ?? 14, floors = o.floors ?? 2;
  const H = floors * 3.2 + 0.6;
  const wallCol = lin(o.wall ?? rng.pick(WALLS), 0.03, rng);
  const parts = [];
  parts.push({ poly: boxP(w, H, d, T(0, H / 2, 0), { side: K.FACADE + 0.25, top: K.FLATROOF, bottom: K.CUT }, { side: wallCol, top: lin(PAL.flatRoof), bottom: lin(PAL.cut) }), count: Math.max(1, Math.round((o.chunks ?? 1) * 5)), name: 'shop' });
  if (o.parapet !== false) {
    for (const sx of [-1, 1]) parts.push({ poly: boxP(0.35, 0.8, d, T(sx * (w / 2 - 0.17), H + 0.4, 0), K.PLAIN, wallCol), count: 2, name: 'parapet' });
  }
  if (o.awning !== false) {
    parts.push({ poly: boxP(w * 0.9, 0.15, 1.6, new THREE.Matrix4().compose(V3(0, 3.0, d / 2 + 0.7), Q(0.22, 0, 0), V3(1, 1, 1)), K.PROP, lin(PAL.propDark)), count: 1, name: 'awning', explode: [0.2, 1.5] });
  }
  return { parts, w, d, H };
}

// -------------------------------------------------------------------- plots
/**
 * A torn-up garden plot floating with its house: lawn, soil underside, fence,
 * optional tree. Returns { parent, top (world y of lawn), pose }.
 */
export function plot(ctx, pose, o = {}) {
  const rng = o.rng || ctx.rng.fork(ctx.stats.bodies * 3 + 5);
  const w = o.w ?? rng.range(16, 24), d = o.d ?? rng.range(18, 26);
  const motion = o.motion || {
    swell: 1, ext: [w / 2, d / 2],
    bob: { a: rng.range(0.3, 1.1), f: rng.range(0.22, 0.45), p: rng.range(0, 6.28) },
    rot: { x: rng.range(0.01, 0.03), y: rng.range(0.006, 0.02), z: rng.range(0.01, 0.03), f: rng.range(0.12, 0.28), p: rng.range(0, 6.28) },
  };
  const par = makeParent(pose.pos, pose.quat, motion);
  const mb = new MeshBuilder();
  const th = 0.6;
  const lawn = boxP(w, th, d, T(0, -th / 2, 0), { top: o.top ?? K.GRASS, side: K.SOIL, bottom: K.SOIL }, { top: lin(o.topCol ?? PAL.grass, 0.04, rng), side: lin(PAL.soil), bottom: lin(PAL.soil) });
  // tear the plot edge: clip a corner or two
  let poly = lawn;
  for (let i = 0; i < rng.int(1, 3); i++) {
    const a = rng.range(0, Math.PI * 2);
    const n = V3(Math.cos(a), 0, Math.sin(a));
    const reach = Math.abs(n.x) * w / 2 + Math.abs(n.z) * d / 2;
    const r = clipPoly(poly, n, reach * rng.range(0.7, 0.92), K.SOIL, lin(PAL.soil));
    if (r.neg) poly = r.neg;
  }
  mb.convex(poly);
  soilUnderside(mb, w * 0.85, d * 0.85, rng.range(o.depth?.[0] ?? 3, o.depth?.[1] ?? 9), T(0, -th, 0), rng);
  const colliders = o.solid === false ? [] : [{ poly, drivable: o.drivable ?? false, surface: 'lawn' }];
  ctx.body({ mb, pos: pose.pos, quat: pose.quat, motion: { parent: par }, flags: o.drivable ? F.DRIVABLE : 0, colliders, name: 'plot' });
  // fence along one or two edges
  if (o.fence !== false) {
    const fm = new MeshBuilder();
    const fc = lin(PAL.propLight, 0.03, rng);
    const edges = rng.int(1, 2);
    for (let e = 0; e < edges; e++) {
      const along = rng.chance(0.5);
      const len = (along ? w : d) * rng.range(0.5, 0.9);
      const side = rng.sign();
      for (let x = -len / 2; x <= len / 2; x += 0.3) {
        const px = along ? x : side * (w / 2 - 0.4), pz = along ? side * (d / 2 - 0.4) : x;
        fm.box(0.08, 1.0, 0.08, T(px, 0.5, pz), K.PROP, fc);
      }
      const rail = along ? [len, 0.08, 0.06] : [0.06, 0.08, len];
      const rp = along ? [0, 0.75, side * (d / 2 - 0.4)] : [side * (w / 2 - 0.4), 0.75, 0];
      fm.box(...rail, T(...rp), K.PROP, fc);
      fm.box(rail[0], 0.08, rail[2], T(rp[0], 0.35, rp[2]), K.PROP, fc);
    }
    const fpos = pose.pos.clone().add(V3(0, rng.range(0.05, 0.4), 0).applyQuaternion(pose.quat));
    ctx.body({ mb: fm, pos: fpos, quat: pose.quat.clone().multiply(Q(rng.range(-0.05, 0.05), 0, rng.range(-0.05, 0.05))), motion: { parent: par, rot: { x: 0.02, y: 0.01, z: 0.02, f: 0.3, p: rng.range(0, 6) } }, flags: F.SCENERY, name: 'fence' });
  }
  if (o.tree !== false && rng.chance(o.treeChance ?? 0.6)) {
    const tx = rng.range(-0.35, 0.35) * w, tz = (rng.chance(0.5) ? 1 : -1) * d * 0.33;
    tree(ctx, { pos: V3(tx, 0, tz).applyQuaternion(pose.quat).add(pose.pos), quat: pose.quat }, par, rng);
  }
  return { parent: par, pose, w, d };
}

export function tree(ctx, pose, par, rng, scale = 1) {
  const mb = new MeshBuilder();
  const h = rng.range(5, 8) * scale;
  mb.cylinder(0.28 * scale, 0.2 * scale, h * 0.55, 6, T(0, h * 0.27, 0), K.PROP, lin(PAL.trunk));
  const leaf = lin(PAL.leaf, 0.06, rng);
  const n = rng.int(2, 3);
  for (let i = 0; i < n; i++) {
    const r = rng.range(1.6, 2.6) * scale;
    const m = new THREE.Matrix4().compose(V3(rng.range(-0.8, 0.8) * scale, h * (0.62 + i * 0.12), rng.range(-0.8, 0.8) * scale), Q(rng.range(0, 1), rng.range(0, 3), 0), V3(1, 1, 1));
    mb.cylinder(r, r * 0.35, r * 1.5, 7, m, K.PROP, leaf, null, null, rng.range(0, 1));
    mb.cylinder(r * 0.35, r, r * 0.8, 7, m.clone().multiply(T(0, -r * 1.15, 0)), K.PROP, leaf, null, null, rng.range(0, 1));
  }
  const tq = pose.quat.clone().multiply(Q(rng.range(-0.12, 0.12), rng.range(0, 6), rng.range(-0.12, 0.12)));
  return ctx.body({
    mb, pos: pose.pos, quat: tq,
    motion: { parent: par, rot: { x: 0.04, y: 0.03, z: 0.04, f: rng.range(0.25, 0.5), p: rng.range(0, 6) } },
    flags: F.SCENERY, name: 'tree',
  });
}
