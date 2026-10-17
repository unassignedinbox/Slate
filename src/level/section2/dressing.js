// Section 2 dressing: the street life the city was abandoned with. The rule that
// sells the world is gravity: everything loose has slid DOWNHILL on its plate and
// come to rest against something (a kerb, a lamp post, another car), and
// everything hanging (signal heads, wires, chandeliers) hangs PLUMB - straight
// down - while the streets and towers around it lean. Hanging things swing
// gently because the plates rock under them.
import * as THREE from 'three';
import { MeshBuilder, K, PAL, lin } from '../../core/geo.js';
import { F } from '../../core/world.js';
import { boxP, V3, Q } from '../ctx.js';
import { groundProp, CITY_CARS } from '../kit/props.js';
import { tree } from '../kit/buildings.js';
import { plateBody } from './structures.js';

/** Cracked road surface patches: dark jagged lines on the asphalt. */
export function roadCracks(ctx, plate, route, s0, s1, rng, o = {}) {
  const crack = lin(0x1a1a1a);
  const mb = new MeshBuilder();
  for (let s = s0; s < s1; s += rng.range(12, 30)) {
    const f = route.at(s);
    const lat = rng.range(-6, 6);
    const p = routeLocal(plate, route, s, lat);
    const n = rng.int(2, 5);
    let cx = p.x, cz = p.z;
    for (let i = 0; i < n; i++) {
      const dx = rng.range(-2, 2), dz = rng.range(-1.5, 1.5);
      const len = Math.hypot(dx, dz);
      const yaw = Math.atan2(dx, dz);
      mb.box(0.08, 0.02, len + 0.04, RT((cx + cx + dx) / 2, 0.04, (cz + cz + dz) / 2, 0, yaw, 0), K.CUT, crack);
      cx += dx; cz += dz;
    }
  }
  ctx.body({ mb, pos: plate.pos, quat: plate.quat, motion: { parent: plate.parent }, flags: F.SCENERY, name: 'road-cracks' });
}

/** Road buckling: where earthquake/tilt has cracked and heaved the asphalt upward. */
export function roadBuckles(ctx, plate, route, s0, s1, rng) {
  const conc = lin(PAL.concrete), cut = lin(PAL.cut);
  for (let s = s0; s < s1; s += rng.range(30, 60)) {
    const f = route.at(s);
    const lat = rng.range(-5, 5);
    const p = routeLocal(plate, route, s, lat);
    const w = rng.range(3, 8), d = rng.range(2, 5), h = rng.range(0.3, 1.2);
    const mb = new MeshBuilder();
    mb.box(w, h, d, undefined, K.CUT, cut);
    plateBody(ctx, plate, mb, p.x, h / 2, p.z, routeYaw(plate, route, s) + rng.range(-0.3, 0.3), { rx: rng.range(-0.1, 0.1), rz: rng.range(-0.05, 0.05), name: 'road-buckle' });
  }
}

const T = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z);
const RT = (x, y, z, rx = 0, ry = 0, rz = 0) => new THREE.Matrix4().compose(V3(x, y, z), Q(rx, ry, rz), V3(1, 1, 1));

/** Plate-local point at route station s, offset `left` metres to the left of the line. */
export function routeLocal(plate, route, s, left = 0) {
  const f = route.at(s);
  const p = route.pos(s).addScaledVector(f.r, -left);
  return plate.toLocal(p);
}
/** Plate-local yaw of the line's direction at s (a prop's +Z along the line). */
export function routeYaw(plate, route, s) {
  const t = route.at(s).t.clone().applyQuaternion(plate.qInv);
  return Math.atan2(t.x, t.z);
}
/** World-space downhill direction projected onto the plate, as a plate-local yaw. */
export function downhillYaw(plate) {
  const d = V3(0, -1, 0).applyQuaternion(plate.qInv);
  return Math.atan2(d.x, d.z);
}

// ------------------------------------------------------------------ hanging things
/**
 * A pole planted on the plate with a mast arm over the road and a signal head
 * hanging plumb from its tip on a short cable (the head swings).
 */
export function signalMast(ctx, plate, x, z, yaw, reach, rng) {
  const m = lin(0x4a4d50);
  const mb = new MeshBuilder();
  const H = 7.2;
  mb.cylinder(0.2, 0.15, H, 8, T(0, H / 2, 0), K.METAL, m);
  mb.box(0.18, 0.22, reach, T(0, H - 0.4, reach / 2), K.METAL, m);
  mb.box(0.12, 1.4, 0.12, RT(0, H - 1.0, 0.5, -0.6, 0, 0), K.METAL, m);
  plateBody(ctx, plate, mb, x, 0, z, yaw, { name: 'signal-mast', colliders: [{ poly: boxP(0.5, H, 0.5, T(0, H / 2, 0), K.METAL, m) }] });
  // tip of the arm in world space; the head hangs from it with WORLD-vertical rest pose
  for (const along of [reach * 0.55, reach * 0.95]) {
    const tip = plate.toWorld(...V3(0, H - 0.5, along).applyQuaternion(Q(0, yaw, 0)).add(V3(x, 0, z)).toArray());
    const hm = new MeshBuilder();
    hm.box(0.04, 0.9, 0.04, T(0, -0.45, 0), K.METAL, m);
    hm.box(0.42, 1.15, 0.36, T(0, -1.45, 0), K.METAL, m);
    for (let i = 0; i < 3; i++) hm.cylinder(0.12, 0.12, 0.03, 8, RT(0, -1.08 - i * 0.34, 0.19, Math.PI / 2, 0, 0), K.MARK, lin(PAL.propLight));
    const wyaw = Math.atan2(...(() => { const d = V3(0, 0, 1).applyQuaternion(plate.q(0, yaw, 0)); return [d.x, d.z]; })()) + Math.PI / 2;
    ctx.body({ mb: hm, pos: tip, quat: Q(0, wyaw, 0), motion: { parent: plate.parent, swing: { a: rng.range(0.05, 0.11), f: rng.range(1.4, 1.9), p: rng.range(0, 6) } }, flags: F.SCENERY, name: 'signal-head' });
  }
}

/** Wire spanned across the street between two poles (catenary for the tram). */
export function spanWire(ctx, plate, route, s, hw, rng, o = {}) {
  const m = lin(0x55585c);
  const yaw = routeYaw(plate, route, s);
  const H = 7.4;
  for (const sd of [-1, 1]) {
    const p = routeLocal(plate, route, s, sd * (hw + 1.0));
    const mb = new MeshBuilder();
    mb.cylinder(0.16, 0.12, H, 6, T(0, H / 2, 0), K.METAL, m);
    plateBody(ctx, plate, mb, p.x, 0, p.z, yaw, { name: 'catenary-pole', colliders: [{ poly: boxP(0.4, H, 0.4, T(0, H / 2, 0), K.METAL, m) }] });
  }
  // the span wire itself (rigid with the plate) and the contact wire under it
  const c = routeLocal(plate, route, s, 0);
  const mb = new MeshBuilder();
  const L = (hw + 1.0) * 2;
  mb.box(L, 0.05, 0.05, RT(0, H - 0.25, 0, 0, 0, 0), K.METAL, m);
  for (const l of o.tracks ?? [-1.9, 1.9]) mb.box(0.04, 0.5, 0.04, T(l, H - 0.55, 0), K.METAL, m);
  plateBody(ctx, plate, mb, c.x, 0, c.z, yaw, { name: 'span-wire', flags: F.SCENERY });
  if (o.broken) {
    // a snapped contact wire hanging down in a long loop, swinging
    const sd = rng.sign();
    const tip = plate.toWorld(...routeLocal(plate, route, s, sd * rng.range(2, 6)).add(V3(0, H - 0.6, 0)).toArray());
    const wm = new MeshBuilder();
    const len = rng.range(3.5, 5);
    wm.box(0.05, len, 0.05, T(0, -len / 2, 0), K.METAL, m);
    ctx.body({ mb: wm, pos: tip, quat: Q(0, rng.range(0, 6), 0), motion: { parent: plate.parent, swing: { a: rng.range(0.12, 0.25), f: Math.sqrt(12 / len) * 0.8, p: rng.range(0, 6) } }, flags: F.SCENERY, name: 'hanging-wire' });
  }
}

/** Faded road markings: cracked lane lines and center stripes on asphalt. */
export function roadMarkings(ctx, plate, route, s0, s1, rng, o = {}) {
  const mark = lin(0xccccaa);
  const mb = new MeshBuilder();
  const hw = o.hw ?? 8;
  // Center dashed line
  for (let s = s0; s < s1; s += rng.range(3, 6)) {
    const segLen = rng.range(1.5, 3);
    const s2 = Math.min(s1, s + segLen);
    const a = routeLocal(plate, route, s, 0), b = routeLocal(plate, route, s2, 0);
    const d = b.clone().sub(a); const L = Math.hypot(d.x, d.z);
    const yaw = Math.atan2(d.x, d.z);
    if (rng.chance(0.3)) continue; // some dashes missing (faded)
    mb.box(0.12, 0.015, L + 0.02, RT((a.x + b.x) / 2, 0.04, (a.z + b.z) / 2, 0, yaw, 0), K.PLAIN, mark);
  }
  // Edge lines (solid but cracked)
  for (const side of [-1, 1]) {
    const lat = side * (hw - 0.5);
    for (let s = s0; s < s1 - 1; s += 4) {
      const s2 = Math.min(s1, s + 4);
      const a = routeLocal(plate, route, s, lat), b = routeLocal(plate, route, s2, lat);
      const d = b.clone().sub(a); const L = Math.hypot(d.x, d.z);
      const yaw = Math.atan2(d.x, d.z);
      if (rng.chance(0.15)) continue; // gaps in edge lines
      mb.box(0.15, 0.015, L + 0.02, RT((a.x + b.x) / 2, 0.04, (a.z + b.z) / 2, 0, yaw, 0), K.PLAIN, mark);
    }
  }
  ctx.body({ mb, pos: plate.pos, quat: plate.quat, motion: { parent: plate.parent }, flags: F.SCENERY, name: 'road-markings' });
}

/** Fallen utility poles: broken telephone/power poles leaning against buildings. */
export function fallenPoles(ctx, plate, route, s0, s1, rng) {
  const wood = lin(PAL.propDark), metal = lin(PAL.metal);
  for (let s = s0; s < s1; s += rng.range(35, 70)) {
    const f = route.at(s);
    const side = rng.sign();
    const lat = side * rng.range(10, 16);
    const p = route.pos(s).addScaledVector(f.r, -lat);
    if (!plate.onGround(p.x, p.z, 2)) continue;
    const mb = new MeshBuilder();
    const poleH = rng.range(8, 14);
    // The pole itself — tilted
    mb.cylinder(0.15, 0.12, poleH, 6, T(0, poleH / 2, 0), K.METAL, wood);
    // Cross arm
    mb.box(0.1, 0.1, rng.range(2, 4), T(0, poleH - 1, 0), K.METAL, metal);
    // A few insulators
    for (const ox of [-1.2, 0, 1.2]) mb.cylinder(0.08, 0.06, 0.3, 6, T(ox, poleH - 0.7, 0), K.METAL, metal);
    plateBody(ctx, plate, mb, p.x, 0, p.z, rng.range(0, 6), { rx: rng.range(0.4, 1.2) * rng.sign(), rz: rng.range(-0.2, 0.2), name: 'fallen-pole' });
  }
}

/** Broken barriers: concrete traffic barriers and bollards knocked over or cracked. */
export function brokenBarriers(ctx, plate, route, s0, s1, rng) {
  const conc = lin(PAL.concrete), cut = lin(PAL.cut);
  for (let s = s0; s < s1; s += rng.range(15, 35)) {
    const f = route.at(s);
    const side = rng.sign();
    const lat = side * rng.range(9, 11);
    const p = routeLocal(plate, route, s, lat);
    if (!plate.onGround(p.x, p.z, 2)) continue;
    const fallen = rng.chance(0.4);
    const mb = new MeshBuilder();
    if (fallen) {
      // Knocked-over barrier slab
      const bw = rng.range(2, 4), bh = rng.range(0.6, 1), bd = rng.range(0.3, 0.5);
      mb.box(bw, bh, bd, undefined, K.CUT, cut);
      plateBody(ctx, plate, mb, p.x, bh / 2, p.z, routeYaw(plate, route, s), { rx: rng.range(0.3, 0.8) * rng.sign(), rz: rng.range(-0.2, 0.2), name: 'fallen-barrier' });
    } else {
      // Standing bollard
      mb.cylinder(0.2, 0.2, rng.range(0.6, 1.0), 6, T(0, 0.4, 0), K.PLAIN, conc);
      plateBody(ctx, plate, mb, p.x, 0, p.z, 0, { name: 'bollard' });
    }
  }
}

/** Accumulated rubble against building walls — shows time since destruction. */
export function wallRubble(ctx, plate, route, s0, s1, rng) {
  const cut = lin(PAL.cut), stone = lin(PAL.stoneCity);
  for (let s = s0; s < s1; s += rng.range(25, 50)) {
    const f = route.at(s);
    const side = rng.sign();
    const lat = side * rng.range(12, 18);
    const p = route.pos(s).addScaledVector(f.r, -lat);
    if (!plate.onGround(p.x, p.z, 2)) continue;
    const n = rng.int(3, 7);
    for (let i = 0; i < n; i++) {
      const mb = new MeshBuilder();
      const w = rng.range(0.6, 2.5), h = rng.range(0.2, 0.8), d = rng.range(0.6, 2);
      mb.box(w, h, d, undefined, K.CUT, rng.chance(0.5) ? cut : stone);
      const rp = p.clone().add(V3(rng.range(-3, 3), rng.range(0, 0.3), rng.range(-3, 3)));
      plateBody(ctx, plate, mb, rp.x, h / 2, rp.z, rng.range(0, 6), { rx: rng.range(-0.4, 0.4), rz: rng.range(-0.4, 0.4), name: 'wall-rubble' });
    }
  }
}

/** Torn awnings: hanging fabric/metal overhangs along building fronts, some collapsed. */
export function tornAwnings(ctx, plate, route, s0, s1, rng, o = {}) {
  const hw = o.hw ?? 12;
  const fabric = lin(0x8b7355), metal = lin(PAL.steel);
  for (let s = s0; s < s1; s += rng.range(14, 28)) {
    const side = rng.sign();
    const lp = routeLocal(plate, route, s, side * (hw + 0.5));
    if (!plate.onGround(lp.x, lp.z, 2)) continue;
    const collapsed = rng.chance(0.35);
    const mb = new MeshBuilder();
    const aw = rng.range(3, 7), ad = rng.range(1.5, 3), ah = 0.08;
    mb.box(aw, ah, ad, T(0, 0, ad / 2), K.METAL, collapsed ? metal : fabric);
    // support arms
    for (const sx of [-1, 1]) mb.box(0.06, 2.8, 0.06, T(sx * aw / 2, 1.4, 0), K.METAL, metal);
    const yaw = routeYaw(plate, route, s) + (side > 0 ? Math.PI : 0);
    plateBody(ctx, plate, mb, lp.x, 2.8, lp.z, yaw, { rx: collapsed ? rng.range(0.3, 0.8) : rng.range(0, 0.1), name: 'awning' });
  }
}

/** Tram rails along the line (visual strips on the asphalt). */
export function tramTracks(ctx, plate, route, s0, s1, tracks = [-1.9, 1.9]) {
  const mb = new MeshBuilder();
  const steel = lin(PAL.steel);
  for (let s = s0; s < s1 - 1; s += 4) {
    const s2 = Math.min(s1, s + 4);
    for (const tc of tracks) for (const r of [-0.72, 0.72]) {
      const a = routeLocal(plate, route, s, tc + r), b = routeLocal(plate, route, s2, tc + r);
      const d = b.clone().sub(a); const L = Math.hypot(d.x, d.z);
      const yaw = Math.atan2(d.x, d.z);
      mb.box(0.1, 0.03, L + 0.02, RT((a.x + b.x) / 2, 0.06, (a.z + b.z) / 2, 0, yaw, 0), K.METAL, steel);
    }
  }
  ctx.body({ mb, pos: plate.pos, quat: plate.quat, motion: { parent: plate.parent }, flags: F.SCENERY, name: 'tram-tracks' });
}

// ------------------------------------------------------------------ the street edge
/**
 * Lamps, trees in pits, signals, bins and benches along the line's street,
 * both sides, on the sidewalk.
 */
export function streetEdge(ctx, plate, net, route, s0, s1, o = {}) {
  const rng = ctx.rng.fork(Math.round(s0 * 7 + 13));
  const hw = o.hw ?? 12;
  const ok = (p, r = 1.5) => plate.onGround(p.x, p.z, 2) && net.roadDist(p.x, p.z) > 0.6 && (o.free ? o.free(p) : true) && !(o.avoid || []).some((a) => Math.hypot(p.x - a.x, p.z - a.z) < a.r + r);
  for (const side of [1, -1]) {
    // lamps
    for (let s = s0 + rng.range(4, 20); s < s1 - 4; s += rng.range(28, 36)) {
      const p = routeLocal(plate, route, s, side * (hw + 1.3));
      if (!ok(p)) continue;
      // the lamp's arm (+X) reaches over the road
      groundProp(ctx, 'lamppost', plate, p.x, p.z, { yaw: routeYaw(plate, route, s) + (side > 0 ? Math.PI : 0), rng });
    }
    // trees in pits
    if (o.trees !== false) {
      for (let s = s0 + rng.range(8, 16); s < s1 - 6; s += rng.range(16, 24)) {
        const p = routeLocal(plate, route, s, side * (hw + 3.4));
        if (!ok(p, 3) || net.clearance(p.x, p.z) > -0.5 && false) continue;
        const pm = new MeshBuilder();
        pm.box(1.8, 0.12, 1.8, T(0, 0.06, 0), K.SOIL, lin(PAL.soil));
        plateBody(ctx, plate, pm, p.x, 0, p.z, 0, { name: 'tree-pit', flags: F.SCENERY });
        tree(ctx, plate.pose(p.x, p.z, rng.range(0, 6)), plate.parent, rng, rng.range(0.9, 1.25));
      }
    }
    // kerbside furniture
    for (let s = s0 + rng.range(5, 15); s < s1 - 4; s += rng.range(10, 22)) {
      const p = routeLocal(plate, route, s, side * (hw + rng.range(1.8, 4.2)));
      if (!ok(p)) continue;
      const type = rng.pick(['bin', 'bin', 'bench', 'hydrant', 'bollard', 'bollard', 'mailbox', 'sign', 'planter', 'kiosk', 'shelter', 'phonebox', 'bike']);
      const yaw = routeYaw(plate, route, s) + (type === 'bench' || type === 'shelter' ? (side > 0 ? -Math.PI / 2 : Math.PI / 2) : rng.range(-0.3, 0.3));
      groundProp(ctx, type, plate, p.x, p.z, { yaw, rng });
    }
  }
}

// ------------------------------------------------------------------ abandoned cars
/**
 * Cars that slid downhill and came to rest. `lanes` are lateral offsets (left +)
 * where cars may sit; `clear` keeps a band around the racing line empty.
 */
export function abandonedCars(ctx, plate, route, s0, s1, o = {}) {
  const rng = ctx.rng.fork(Math.round(s0 * 3 + 7));
  const clear = o.clear ?? 4.5;
  const placed = [];
  let s = s0 + rng.range(0, o.every?.[1] ?? 30);
  while (s < s1) {
    const n = rng.chance(o.cluster ?? 0.4) ? rng.int(2, 4) : 1;
    const baseLat = rng.pick(o.lanes ?? [-9, -5.5, 5.5, 9]);
    for (let k = 0; k < n; k++) {
      const ss = s + k * rng.range(4.5, 6);
      const lat = baseLat + rng.range(-1.2, 1.2) + (k > 0 ? rng.range(-1.5, 1.5) : 0);
      if (Math.abs(lat) < clear || ss > s1) continue;
      const p = routeLocal(plate, route, ss, lat);
      if (!plate.onGround(p.x, p.z, 3)) continue;
      if (placed.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 4.6)) continue;
      const type = rng.pick(o.types ?? CITY_CARS);
      const yaw = routeYaw(plate, route, ss) + (rng.chance(0.5) ? 0 : Math.PI) + rng.range(-0.35, 0.35) * (o.mess ?? 1);
      const roll = rng.chance(o.flip ?? 0.1) ? rng.pick([Math.PI / 2, -Math.PI / 2, Math.PI]) : 0;
      groundProp(ctx, type, plate, p.x, p.z, { yaw, rz: roll, rng });
      placed.push(p);
    }
    s += rng.range(o.every?.[0] ?? 12, o.every?.[1] ?? 30);
  }
  return placed;
}

/**
 * A pile-up: vehicles jammed together against an obstacle line on the low side,
 * some on their sides, some resting on others. Placed in plate-local coordinates
 * along a direction (dir yaw) from a start point.
 */
export function pileUp(ctx, plate, x0, z0, dirYaw, length, depth, rng, o = {}) {
  const dx = Math.sin(dirYaw), dz = Math.cos(dirYaw);
  const nx = -dz, nz = dx; // to the right of the direction (plate-local +X is left of +Z)
  const placed = [];
  for (let a = 0; a < length; a += rng.range(2.6, 4.2)) {
    const rows = rng.int(1, o.rows ?? 3);
    for (let r = 0; r < rows; r++) {
      const off = r * rng.range(2.2, 3) + rng.range(0, 0.8);
      if (off > depth) continue;
      const x = x0 + dx * a + nx * off, z = z0 + dz * a + nz * off;
      if (!plate.onGround(x, z, 1.5)) continue;
      if (placed.some((q) => Math.hypot(q.x - x, q.z - z) < 2.3)) continue;
      const type = rng.pick(o.types ?? ['sedan', 'sedan', 'hatch', 'van', 'hatch', 'truck', 'sedan']);
      const yaw = dirYaw + rng.range(-1.2, 1.2) + (rng.chance(0.5) ? Math.PI : 0);
      const roll = rng.chance(0.18) ? rng.pick([Math.PI / 2, -Math.PI / 2]) : rng.chance(0.06) ? Math.PI : 0;
      groundProp(ctx, type, plate, x, z, { yaw, rz: roll, rx: rng.range(-0.08, 0.08), rng });
      placed.push({ x, z });
      // now and then a car came to rest on top of another
      if (rng.chance(o.stack ?? 0.12)) groundProp(ctx, rng.pick(['sedan', 'hatch']), plate, x + rng.range(-0.6, 0.6), z + rng.range(-0.6, 0.6), { yaw: yaw + rng.range(-0.6, 0.6), rz: rng.range(-0.3, 0.3), rx: rng.range(-0.25, 0.25), y: 1.35, rng });
    }
  }
  return placed;
}
