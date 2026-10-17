// Section 2 city kit: streets laid on the plates, lots, and the generic building
// stock (towers, mid-rises, old low-rises, car parks). Everything is built in a
// plate's local frame, so every building stands square to its tipped plate and
// the whole skyline of a plate leans together.
import * as THREE from 'three';
import { MeshBuilder, K, PAL, lin } from '../../core/geo.js';
import { fracturePoly, transformPoly } from '../../core/fracture.js';
import { F } from '../../core/world.js';
import { boxP, V3, Q } from '../ctx.js';
import { plateBody } from './structures.js';

const T = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z);
const RT = (x, y, z, rx = 0, ry = 0, rz = 0) => new THREE.Matrix4().compose(V3(x, y, z), Q(rx, ry, rz), V3(1, 1, 1));

// ------------------------------------------------------------------ streets
/**
 * A plate's street network: segments in plate-local coordinates with the half
 * width of the carriageway and the building setback. Used for the asphalt overlay
 * and to keep lots off the streets.
 */
export class StreetNet {
  constructor(plate) {
    this.plate = plate;
    this.segs = [];   // { ax, az, bx, bz, hw, setback }
    this.ribbons = [];
    this.cell = 24;
    this.hash = new Map();
  }
  _add(seg) {
    this.segs.push(seg);
    const c = this.cell, r = seg.setback + 2;
    const x0 = Math.floor((Math.min(seg.ax, seg.bx) - r) / c), x1 = Math.floor((Math.max(seg.ax, seg.bx) + r) / c);
    const z0 = Math.floor((Math.min(seg.az, seg.bz) - r) / c), z1 = Math.floor((Math.max(seg.az, seg.bz) + r) / c);
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const k = `${x},${z}`;
      if (!this.hash.has(k)) this.hash.set(k, []);
      this.hash.get(k).push(seg);
    }
  }
  /** Signed clearance of a local point from the street network (negative = inside a setback). */
  clearance(x, z) {
    const arr = this.hash.get(`${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}`);
    let best = Infinity;
    if (!arr) return best;
    for (const s of arr) {
      const ex = s.bx - s.ax, ez = s.bz - s.az, L2 = ex * ex + ez * ez;
      const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - s.ax) * ex + (z - s.az) * ez) / L2)) : 0;
      const d = Math.hypot(x - s.ax - ex * t, z - s.az - ez * t) - s.setback;
      if (d < best) best = d;
    }
    return best;
  }
  /** Clearance from the racing line's streets only (beyond their setback). */
  routeClearance(x, z) {
    let best = Infinity;
    for (const s of this.segs) {
      if (!s.route) continue;
      const ex = s.bx - s.ax, ez = s.bz - s.az, L2 = ex * ex + ez * ez;
      const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - s.ax) * ex + (z - s.az) * ez) / L2)) : 0;
      const d = Math.hypot(x - s.ax - ex * t, z - s.az - ez * t) - s.setback;
      if (d < best) best = d;
    }
    return best;
  }

  /** Distance to the nearest carriageway edge (negative = on the road). */
  roadDist(x, z) {
    const arr = this.hash.get(`${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}`);
    let best = Infinity;
    if (!arr) return best;
    for (const s of arr) {
      const ex = s.bx - s.ax, ez = s.bz - s.az, L2 = ex * ex + ez * ez;
      const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - s.ax) * ex + (z - s.az) * ez) / L2)) : 0;
      best = Math.min(best, Math.hypot(x - s.ax - ex * t, z - s.az - ez * t) - s.hw);
    }
    return best;
  }
  rectClear(x, z, hx, hz, yaw = 0, margin = 0) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const nx = Math.max(2, Math.ceil(hx / 3)), nz = Math.max(2, Math.ceil(hz / 3));
    for (let i = 0; i <= nx; i++) for (let k = 0; k <= nz; k++) {
      const a = -hx + (2 * hx * i) / nx, b = -hz + (2 * hz * k) / nz;
      if (this.clearance(x + a * c + b * s, z - a * s + b * c) < margin) return false;
    }
    return true;
  }

  /** The racing line's own street on this plate, from route stations s0..s1. */
  routeStreet(route, s0, s1, o = {}) {
    const P = this.plate, hw = o.hw ?? 12, setback = o.setback ?? hw + 5;
    const pts = [];
    for (let s = s0; s <= s1 + 1e-6; s += 2) {
      const f = route.at(Math.min(s, s1));
      const c = P.toLocal(route.pos(Math.min(s, s1)));
      const r = f.r.clone().applyQuaternion(P.qInv); r.y = 0; r.normalize();
      pts.push({ c, r, s: Math.min(s, s1) });
    }
    for (let i = 1; i < pts.length; i++) this._add({ ax: pts[i - 1].c.x, az: pts[i - 1].c.z, bx: pts[i].c.x, bz: pts[i].c.z, hw, setback, route: true });
    if (o.ribbon !== false) this.ribbons.push({ pts, hw, kind: K.LANES + hw / 40, route: true });
    return this;
  }

  /** A straight street between two map points (u, v). */
  street(map, ua, va, ub, vb, o = {}) {
    const P = this.plate, hw = o.hw ?? 8, setback = o.setback ?? hw + 4;
    const A = P.localAtMap(ua, va), B = P.localAtMap(ub, vb);
    const L = Math.hypot(B.x - A.x, B.z - A.z);
    const dx = (B.x - A.x) / L, dz = (B.z - A.z) / L;
    const r = V3(-dz, 0, dx); // right of travel A->B in local x/z (y up): (dx,dz) x up
    const pts = [];
    for (let d = 0; d <= L + 1e-6; d += 2) {
      const c = V3(A.x + dx * Math.min(d, L), 0, A.z + dz * Math.min(d, L));
      pts.push({ c, r, s: d });
    }
    this._add({ ax: A.x, az: A.z, bx: B.x, bz: B.z, hw, setback });
    this.ribbons.push({ pts, hw, kind: K.LANES + hw / 40 });
    return this;
  }

  /** Asphalt overlays: one body per plate. Side streets stop where they meet a route street. */
  build(ctx) {
    const P = this.plate;
    const mb = new MeshBuilder();
    const asph = lin(PAL.asphalt), kerb = lin(PAL.curb);
    const routeSegs = this.segs.filter((s) => s.route);
    const onRoute = (x, z) => {
      for (const s of routeSegs) {
        const ex = s.bx - s.ax, ez = s.bz - s.az, L2 = ex * ex + ez * ez;
        const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - s.ax) * ex + (z - s.az) * ez) / L2)) : 0;
        if (Math.hypot(x - s.ax - ex * t, z - s.az - ez * t) < s.hw + 0.3) return true;
      }
      return false;
    };
    for (const rb of this.ribbons) {
      const y = rb.route ? 0.045 : 0.035;
      for (let i = 1; i < rb.pts.length; i++) {
        const a = rb.pts[i - 1], b = rb.pts[i];
        if (!rb.route && (onRoute(a.c.x, a.c.z) || onRoute(b.c.x, b.c.z))) continue;
        if (!P.onGround(a.c.x, a.c.z) || !P.onGround(b.c.x, b.c.z)) continue;
        const v = [], g = [];
        const L0 = a.c.clone().addScaledVector(a.r, -rb.hw), R0 = a.c.clone().addScaledVector(a.r, rb.hw);
        const L1 = b.c.clone().addScaledVector(b.r, -rb.hw), R1 = b.c.clone().addScaledVector(b.r, rb.hw);
        for (const p of [L0, R0, R1, L1]) p.y = y;
        // pattern space: x lateral (+ = right), z along
        mb.polyG([L0, R0, R1, L1], [V3(-rb.hw, 0, a.s), V3(rb.hw, 0, a.s), V3(rb.hw, 0, b.s), V3(-rb.hw, 0, b.s)], rb.kind, asph, V3(0, 1, 0));
        // kerb lines
        for (const sd of [-1, 1]) {
          const k0 = a.c.clone().addScaledVector(a.r, sd * (rb.hw + 0.1)), k1 = b.c.clone().addScaledVector(b.r, sd * (rb.hw + 0.1));
          const k0o = a.c.clone().addScaledVector(a.r, sd * (rb.hw + 0.45)), k1o = b.c.clone().addScaledVector(b.r, sd * (rb.hw + 0.45));
          for (const p of [k0, k1, k0o, k1o]) p.y = y + 0.01;
          mb.poly(sd > 0 ? [k0, k0o, k1o, k1] : [k0o, k0, k1, k1o], K.MARK, kerb, undefined, V3(0, 1, 0));
        }
      }
    }
    ctx.body({ mb, pos: P.pos, quat: P.quat, motion: { parent: P.parent }, flags: F.SCENERY, name: `${P.name}-streets` });
  }
}

// ------------------------------------------------------------------ buildings
const TOWER_COL = [PAL.tower, PAL.tower2, PAL.tower3, PAL.concrete, PAL.stoneCity];
const MID_COL = [PAL.concrete, PAL.stoneCity, PAL.brick, PAL.wall, PAL.wall2, PAL.concrete2];
const LOW_COL = [PAL.brick, PAL.brick2, PAL.stoneCity, PAL.wall, PAL.wall3, PAL.wall4];

/** Fracture a part into a few chunks and add them with hairline gaps (static cracks). */
function cracked(mb, poly, rng, n, gap = 0.06) {
  if (n <= 1) { mb.convex(poly); return; }
  const pieces = fracturePoly(poly, { count: n, rng, minFrac: 0.08, jitter: 0.35, cutKind: K.CUT, cutColor: lin(PAL.cut) });
  for (const pc of pieces) {
    let cx = 0, cy = 0, cz = 0, k = 0;
    for (const f of pc.faces) for (const v of f.v) { cx += v.x; cy += v.y; cz += v.z; k++; }
    const o = V3(cx / k, cy / k, cz / k).normalize().multiplyScalar(gap);
    mb.convex(pc, T(o.x * 0.6, -Math.abs(o.y) * 0.5, o.z * 0.6));
  }
}

/**
 * Generic building on a plate. Returns { body, h }.
 *  o: { type: tower|mid|low|parking|slab, h, rng, collide, damage (0..1), col, variant, yaw }
 */
export function cityBuilding(ctx, plate, x, z, hx, hz, o = {}) {
  const rng = o.rng || ctx.rng;
  const type = o.type || 'mid';
  const yaw = o.yaw ?? rng.range(-0.15, 0.15);
  const mb = new MeshBuilder();
  const dmg = o.damage ?? 0;
  const W = hx * 2, D = hz * 2;
  const colliders = [];
  let H = 0;
  const cut = lin(PAL.cut), roofC = lin(PAL.flatRoof);
  if (type === 'tower') {
    const col = lin(o.col ?? rng.pick(TOWER_COL), 0.03, rng);
    const variant = o.variant ?? rng.pick([0, 0, 0.25, 0.5, 0.75]);
    const hp = rng.range(7, 15);
    const inset = rng.range(1.5, Math.min(6, Math.min(hx, hz) * 0.3));
    const hs = o.h ?? rng.range(70, 160);
    const podium = boxP(W, hp, D, T(0, hp / 2, 0), { side: K.FACADE + 0.25, top: K.FLATROOF, bottom: K.CUT }, { side: lin(PAL.stoneCity, 0.03, rng), top: roofC, bottom: cut });
    cracked(mb, podium, rng, dmg > 0.3 ? 3 : 1, 0.2);
    const sw = W - inset * 2, sd = D - inset * 2;
    const shaftH = hs * (dmg > 0.6 ? rng.range(0.7, 0.85) : 1);
    const shaft = boxP(sw, shaftH, sd, T(0, hp + shaftH / 2, 0), { side: K.CURTAIN + variant, top: K.FLATROOF, bottom: K.CUT }, { side: col, top: roofC, bottom: cut });
    cracked(mb, shaft, rng, dmg > 0.4 ? rng.int(2, 3) : 1, 0.3);
    // Broken windows on tower shaft — dark recessed rectangles showing interior
    if (dmg > 0.3) {
      const interior = lin(PAL.interior);
      const nWin = dmg > 0.6 ? rng.int(4, 12) : rng.int(2, 6);
      for (let wi = 0; wi < nWin; wi++) {
        const wy = hp + rng.range(2, shaftH - 2);
        const side = rng.sign();
        const wW = rng.range(1.2, 2.4), wH = rng.range(1.4, 2.2);
        if (rng.chance(0.5)) {
          mb.box(0.15, wH, wW, T(side * (sw / 2 + 0.05), wy, rng.range(-sd / 2 + 1, sd / 2 - 1)), K.CUT, interior);
        } else {
          mb.box(wW, wH, 0.15, T(rng.range(-sw / 2 + 1, sw / 2 - 1), wy, side * (sd / 2 + 0.05)), K.CUT, interior);
        }
      }
    }
    H = hp + shaftH;
    // setback tier + crown
    if (shaftH === hs && rng.chance(0.6)) {
      const t2 = rng.range(0.12, 0.3) * hs, w2 = sw * rng.range(0.6, 0.85), d2 = sd * rng.range(0.6, 0.85);
      mb.box(w2, t2, d2, T(0, H + t2 / 2, 0), { side: K.CURTAIN + variant, top: K.FLATROOF }, { side: col, top: roofC });
      H += t2;
      if (rng.chance(0.55)) {
        const mh = rng.range(4, 8);
        mb.box(w2 * 0.55, mh, d2 * 0.55, T(0, H + mh / 2, 0), { side: K.PLAIN, top: K.FLATROOF }, { side: lin(PAL.concrete2), top: roofC });
        if (rng.chance(0.5)) mb.cylinder(0.3, 0.12, rng.range(10, 26), 6, T(rng.range(-2, 2), H + mh + 8, rng.range(-2, 2)), K.METAL, lin(PAL.steel));
        H += mh;
      }
    } else {
      mb.box(sw * 0.5, 4, sd * 0.5, T(0, H + 2, 0), { side: K.PLAIN, top: K.FLATROOF }, { side: lin(PAL.concrete2), top: roofC });
    }
    colliders.push({ poly: boxP(W, hp, D, T(0, hp / 2, 0), K.PLAIN, col) }, { poly: boxP(sw, shaftH, sd, T(0, hp + shaftH / 2, 0), K.PLAIN, col) });
    if (shaftH < hs) {
      // the snapped-off top: a separate block resting askew on the stump
      const topH = hs - shaftH;
      const tm = new MeshBuilder();
      const tp = boxP(sw, topH, sd, T(0, topH / 2, 0), { side: K.CURTAIN + variant, top: K.FLATROOF, bottom: K.CUT }, { side: col, top: roofC, bottom: cut });
      cracked(tm, tp, rng, 2, 0.08);
      const sx = rng.sign();
      const lean = rng.range(0.08, 0.2) * sx;
      // pivot on the stump's edge
      const px = sx * sw * 0.42;
      const piv = V3(px, hp + shaftH + 0.2, 0);
      const off = V3(-px, 0, rng.range(-1, 1)).applyQuaternion(Q(0, 0, -lean));
      const lp = piv.clone().add(off);
      const wpos = V3(lp.x, lp.y, lp.z).applyQuaternion(Q(0, yaw, 0)).add(V3(x, 0, z));
      plateBody(ctx, plate, tm, wpos.x, wpos.y, wpos.z, yaw, { rz: -lean, name: 'tower-top', colliders: o.collide ? [{ poly: boxP(sw, topH, sd, T(0, topH / 2, 0), K.PLAIN, col) }] : [] });
    }
  } else if (type === 'mid' || type === 'slab') {
    const col = lin(o.col ?? rng.pick(MID_COL), 0.04, rng);
    const h = o.h ?? (type === 'slab' ? rng.range(28, 48) : rng.range(16, 42));
    const kind = rng.chance(0.65) ? K.FACADE : K.CURTAIN + rng.pick([0.25, 0.5, 0.75]);
    const body = boxP(W, h, D, T(0, h / 2, 0), { side: kind, top: K.FLATROOF, bottom: K.CUT }, { side: col, top: roofC, bottom: cut });
    cracked(mb, body, rng, dmg > 0.3 ? rng.int(2, 4) : 1, 0.22);
    // ground floor shopfronts + cornice
    mb.box(W + 0.3, 4.2, D + 0.3, T(0, 2.1, 0), { side: K.FACADE + 0.25, top: K.CUT }, { side: lin(PAL.stoneCity, 0.03, rng), top: cut });
    // Colonnade: some buildings have arcade columns along the ground floor
    if (rng.chance(0.35) && W > 16) {
      const spacing = rng.range(4, 6);
      const nCols = Math.max(2, Math.floor(W / spacing));
      for (let ci = 0; ci < nCols; ci++) {
        const cx = -W / 2 + (ci + 0.5) * (W / nCols);
        mb.cylinder(0.35, 0.35, 4.2, 6, T(cx, 2.1, D / 2 + 0.2), K.STONE, lin(PAL.stoneCity));
        mb.cylinder(0.35, 0.35, 4.2, 6, T(cx, 2.1, -D / 2 - 0.2), K.STONE, lin(PAL.stoneCity));
      }
    }
    mb.box(W + 0.8, 0.7, D + 0.8, T(0, h + 0.1, 0), K.PLAIN, lin(PAL.concrete2));
    H = h + 0.45;
    if (rng.chance(0.55)) waterTank(mb, rng.range(-hx * 0.5, hx * 0.5), H, rng.range(-hz * 0.5, hz * 0.5), rng);
    if (rng.chance(0.5)) { const pw = W * rng.range(0.25, 0.45), pd = D * rng.range(0.25, 0.45), ph = rng.range(3, 5); mb.box(pw, ph, pd, T(rng.range(-hx + pw / 2 + 1, hx - pw / 2 - 1), H + ph / 2, rng.range(-hz + pd / 2 + 1, hz - pd / 2 - 1)), { side: K.PLAIN, top: K.FLATROOF }, { side: lin(PAL.concrete2), top: roofC }); }
    colliders.push({ poly: boxP(W, h, D, T(0, h / 2, 0), K.PLAIN, col) });
    // External balconies: some mid-rise buildings have balcony slabs on one face
    if (rng.chance(0.45) && h > 14) {
      const balcFace = rng.sign();
      const nBalcs = rng.int(2, 6);
      for (let bi = 0; bi < nBalcs; bi++) {
        const by = 5 + bi * rng.range(3.5, 5);
        if (by > h - 2) break;
        const bw = rng.range(2, 4), bd = rng.range(1, 1.8);
        // Balcony slab
        mb.box(bw, 0.15, bd, T(rng.range(-hx + 2, hx - 2), by, balcFace * (hz + bd / 2)), K.FACADE + 0.25, lin(PAL.concrete2));
        // Railing
        mb.box(bw, 0.8, 0.05, T(rng.range(-hx + 2, hx - 2), by + 0.5, balcFace * (hz + bd)), K.METAL, lin(PAL.steel));
      }
    }
    // Broken windows: for damaged buildings, add dark recessed rectangles on facades
    // showing the interior — these read as shattered glass from a distance
    if (dmg > 0.25) {
      const interior = lin(PAL.interior);
      const nWin = dmg > 0.5 ? rng.int(3, 8) : rng.int(1, 4);
      for (let wi = 0; wi < nWin; wi++) {
        const wy = rng.range(5, h - 2);
        const side = rng.sign();
        const face = rng.sign();
        const wW = rng.range(1.2, 2.4), wH = rng.range(1.4, 2.2);
        const wD = 0.15;
        // On the side face or front/back face
        if (rng.chance(0.5)) {
          mb.box(wD, wH, wW, T(side * (hx + 0.05), wy, rng.range(-hz + 1, hz - 1)), K.CUT, interior);
        } else {
          mb.box(wW, wH, wD, T(rng.range(-hx + 1, hx - 1), wy, face * (hz + 0.05)), K.CUT, interior);
        }
      }
    }
  } else if (type === 'low') {
    const col = lin(o.col ?? rng.pick(LOW_COL), 0.05, rng);
    const h = o.h ?? rng.range(8, 17);
    const body = boxP(W, h, D, T(0, h / 2, 0), { side: K.FACADE, top: K.FLATROOF, bottom: K.CUT }, { side: col, top: roofC, bottom: cut });
    cracked(mb, body, rng, dmg > 0.3 ? rng.int(2, 3) : 1, 0.2);
    mb.box(W + 0.2, 3.6, D + 0.2, T(0, 1.8, 0), { side: K.FACADE + 0.25, top: K.CUT }, { side: col, top: cut });
    mb.box(W + 0.6, 0.6, D + 0.6, T(0, h + 0.3, 0), K.PLAIN, lin(PAL.stoneCity));
    H = h + 0.6;
    if (rng.chance(0.35)) waterTank(mb, rng.range(-hx * 0.4, hx * 0.4), H, rng.range(-hz * 0.4, hz * 0.4), rng, 0.8);
    colliders.push({ poly: boxP(W, h, D, T(0, h / 2, 0), K.PLAIN, col) });
    // Fire escape ladders: zig-zag external staircases on the side of buildings
    if (rng.chance(0.4) && h > 10) {
      const ladderSide = rng.sign();
      const metalC = lin(PAL.steel);
      const nLandings = Math.floor(h / 4) - 1;
      for (let li = 0; li < nLandings; li++) {
        const ly = 4 + li * 4;
        // Landing platform
        mb.box(1.2, 0.08, 1.6, T(ladderSide * (hx + 0.6), ly, 0), K.METAL, metalC);
        // Railing
        mb.box(0.04, 1.0, 1.6, T(ladderSide * (hx + 1.15), ly + 0.5, 0), K.METAL, metalC);
        mb.box(0.04, 1.0, 0.04, T(ladderSide * (hx + 0.05), ly + 0.5, 0.8), K.METAL, metalC);
        mb.box(0.04, 1.0, 0.04, T(ladderSide * (hx + 0.05), ly + 0.5, -0.8), K.METAL, metalC);
      }
    }
    // Broken windows on low buildings
    if (dmg > 0.25) {
      const interior = lin(PAL.interior);
      const nWin = dmg > 0.5 ? rng.int(2, 5) : rng.int(1, 3);
      for (let wi = 0; wi < nWin; wi++) {
        const wy = rng.range(4, h - 1);
        const side = rng.sign();
        const wW = rng.range(1, 2), wH = rng.range(1, 1.8);
        if (rng.chance(0.5)) {
          mb.box(0.12, wH, wW, T(side * (hx + 0.05), wy, rng.range(-hz + 1, hz - 1)), K.CUT, interior);
        } else {
          mb.box(wW, wH, 0.12, T(rng.range(-hx + 1, hx - 1), wy, side * (hz + 0.05)), K.CUT, interior);
        }
      }
    }
  } else if (type === 'parking') {
    // open decks on columns: the floors read from far away
    const n = o.floors ?? rng.int(4, 7), fh = 3.2;
    const conc = lin(PAL.concrete), conc2 = lin(PAL.concrete2);
    for (let i = 0; i <= n; i++) {
      mb.box(W, 0.4, D, T(0, i * fh + 0.2, 0), { top: K.FLOOR, side: K.PLAIN, bottom: K.PLAIN }, { top: conc2, side: conc, bottom: conc });
      if (i > 0) mb.box(W + 0.2, 1.0, D + 0.2, T(0, i * fh + 0.9, 0), { side: K.PLAIN, top: K.CUT }, { side: conc, top: cut });
    }
    for (let a = -hx + 2; a <= hx - 2 + 1e-6; a += Math.max(6, (W - 4) / Math.round((W - 4) / 8))) for (let b = -hz + 2; b <= hz - 2 + 1e-6; b += Math.max(6, (D - 4) / Math.round((D - 4) / 8))) mb.box(0.6, n * fh, 0.6, T(a, n * fh / 2, b), K.PLAIN, conc);
    H = n * fh + 1.4;
    colliders.push({ poly: boxP(W, H, D, T(0, H / 2, 0), K.PLAIN, conc) });
  }
  // Some buildings lean dramatically (the tilt is in the plate's local frame)
  // ~50% get moderate tilt; 10% of those get near-topple angles
  const leaner = rng.chance(0.50);
  const extreme = leaner && rng.chance(0.10);
  const rx = leaner ? rng.range(-0.12, 0.12) * (extreme ? 2 : 1) : 0;
  const rz = leaner ? rng.range(-0.12, 0.12) * (extreme ? 2 : 1) : 0;
  const body = plateBody(ctx, plate, mb, x, 0, z, yaw, { rx, rz, name: `bld-${type}`, colliders: o.collide ? colliders : [], flags: 0 });
  // Dangling chunks: for damaged buildings, add concrete pieces cracked but still
  // attached at an angle — they look like they're about to fall off
  if (dmg > 0.4 && (type === 'mid' || type === 'tower' || type === 'slab')) {
    const n = rng.int(1, 3);
    for (let i = 0; i < n; i++) {
      const cm = new MeshBuilder();
      const cw = rng.range(2, 5), ch = rng.range(1.5, 4), cd = rng.range(0.4, 1.2);
      cm.box(cw, ch, cd, undefined, K.FACADE + 0.25, lin(rng.pick(MID_COL), 0.04, rng));
      const side = rng.sign();
      const face = rng.sign();
      const cy = rng.range(H * 0.2, H * 0.8);
      const cx2 = side * (hx - cd / 2);
      const cz2 = face * hz;
      plateBody(ctx, plate, cm, x + cx2, cy, z + cz2, yaw, { rx: rng.range(0.15, 0.5) * face, rz: rng.range(-0.1, 0.1), name: 'dangle-chunk' });
    }
  }
    // Damaged rooftops: for mid-rise buildings, add partial parapet collapse and
    // rooftop debris visible from the roof incline ramp
    if (dmg > 0.3 && (type === 'mid' || type === 'low') && H > 8) {
      const nMissing = rng.int(1, 3);
      for (let mi = 0; mi < nMissing; mi++) {
        const side = rng.sign();
        const pw = rng.range(W * 0.2, W * 0.5), pd = 0.4, ph = rng.range(0.4, 0.8);
        const pm = new MeshBuilder();
        pm.box(pw, ph, pd, undefined, K.CUT, cut);
        const px = side * rng.range(hx * 0.2, hx * 0.7);
        plateBody(ctx, plate, pm, x + px, H - ph / 2, z + (rng.chance(0.5) ? hz : -hz), yaw, { rx: rng.range(0.2, 0.7) * rng.sign(), name: 'roof-parapet' });
      }
    }
    // Exposed floors: for very damaged buildings, show interior floor slabs through
    // the broken facade — adds depth and makes buildings look truly shattered
    if (dmg > 0.5 && H > 12 && (type === 'mid' || type === 'tower')) {
    const openSide = rng.sign();
    const openFace = rng.sign();
    const fh = rng.range(3.5, 5);
    const nFloors = Math.min(4, Math.floor(H / fh));
    const conc = lin(PAL.concrete);
    for (let fl = 1; fl <= nFloors; fl++) {
      if (rng.chance(0.3)) continue; // some floors missing entirely
      const fb = new MeshBuilder();
      const fw = rng.range(W * 0.5, W * 0.85), fd = rng.range(D * 0.4, D * 0.7);
      fb.box(fw, 0.3, fd, undefined, K.FLOOR, conc);
      const fy = fl * fh;
      // Offset toward the open face to be visible from outside
      const fox = openSide * rng.range(hx * 0.1, hx * 0.4);
      const foz = openFace * rng.range(hz * 0.1, hz * 0.4);
      plateBody(ctx, plate, fb, x + fox, fy, z + foz, yaw, { name: 'exposed-floor' });
    }
  }
  return { body, h: H, yaw, rx, rz };
}

export function waterTank(mb, x, y, z, rng, s = 1) {
  const wood = lin(PAL.propDark), m = lin(PAL.metal);
  const r = rng.range(1.6, 2.4) * s, h = rng.range(3, 4.5) * s, leg = rng.range(2.5, 4) * s;
  for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) mb.box(0.25, leg, 0.25, T(x + a * r * 0.6, y + leg / 2, z + b * r * 0.6), K.METAL, m);
  mb.cylinder(r, r, h, 10, T(x, y + leg + h / 2, z), K.PLAIN, wood);
  mb.cylinder(r * 1.05, 0.2, r * 0.7, 10, T(x, y + leg + h + r * 0.35, z), K.ROOF, lin(PAL.roofDark));
}

/**
 * City blocks by rasterising the plate: 2 m cells that are on solid ground and
 * clear of every street setback and every occupied footprint; then the largest
 * free rectangles are taken greedily (maximal rectangle in a histogram). Blocks
 * therefore run right up to the building line of every street, curved or not.
 */
export function extractBlocks(plate, net, o = {}) {
  const cs = o.cell ?? 2;
  const xs = plate.corners.map((c) => c.x), zs = plate.corners.map((c) => c.z);
  const x0 = Math.min(...xs), z0 = Math.min(...zs);
  const nx = Math.ceil((Math.max(...xs) - x0) / cs), nz = Math.ceil((Math.max(...zs) - z0) / cs);
  const ok = new Uint8Array(nx * nz);
  const occ = o.occupied || [];
  for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) {
    const x = x0 + (i + 0.5) * cs, z = z0 + (k + 0.5) * cs;
    if (net.clearance(x, z) < 0.5) continue;
    if (occ.some((r) => Math.abs(x - r.x) < r.hx + 1.5 && Math.abs(z - r.z) < r.hz + 1.5)) continue;
    if (!plate.onGround(x, z, o.edge ?? 4)) continue;
    ok[i * nz + k] = 1;
  }
  const blocks = [];
  const minW = Math.ceil((o.min ?? 12) / cs);
  const h = new Int32Array(nz);
  for (let iter = 0; iter < (o.maxBlocks ?? 400); iter++) {
    // largest rectangle of free cells: rows = i (x), histogram along k (z)
    let best = { area: 0 };
    h.fill(0);
    for (let i = 0; i < nx; i++) {
      for (let k = 0; k < nz; k++) h[k] = ok[i * nz + k] ? h[k] + 1 : 0;
      const st = [];
      for (let k = 0; k <= nz; k++) {
        const hk = k < nz ? h[k] : 0;
        let start = k;
        while (st.length && st[st.length - 1][1] >= hk) {
          const [ks, hs] = st.pop();
          const w = k - ks;
          if (hs >= minW && w >= minW) {
            // cap very long blocks so they get subdivided sensibly
            const area = Math.min(hs, 60) * Math.min(w, 60);
            if (area > best.area) best = { area, i1: i, i0: i - hs + 1, k0: ks, k1: k - 1 };
          }
          start = ks;
        }
        st.push([start, hk]);
      }
    }
    if (!best.area) break;
    const bx0 = x0 + best.i0 * cs, bx1 = x0 + (best.i1 + 1) * cs, bz0 = z0 + best.k0 * cs, bz1 = z0 + (best.k1 + 1) * cs;
    blocks.push({ x: (bx0 + bx1) / 2, z: (bz0 + bz1) / 2, hx: (bx1 - bx0) / 2, hz: (bz1 - bz0) / 2 });
    // consume it plus an alley around it
    const pad = 1;
    for (let i = Math.max(0, best.i0 - pad); i <= Math.min(nx - 1, best.i1 + pad); i++) for (let k = Math.max(0, best.k0 - pad); k <= Math.min(nz - 1, best.k1 + pad); k++) ok[i * nz + k] = 0;
  }
  return blocks;
}

/** Split a block into lots along its long side (and in two across if it is deep). */
export function subdivide(block, rng, o = {}) {
  const lots = [];
  const along = block.hx >= block.hz ? 'x' : 'z';
  const L = (along === 'x' ? block.hx : block.hz) * 2, Dp = (along === 'x' ? block.hz : block.hx) * 2;
  const rows = Dp > (o.deep ?? 52) ? 2 : 1;
  const alley = o.alley ?? 3;
  let a = 0;
  while (a < L - 6) {
    let len = rng.range(o.len?.[0] ?? 20, o.len?.[1] ?? 42);
    if (L - a - len < 14) len = L - a;
    len = Math.min(len, L - a);
    for (let r = 0; r < rows; r++) {
      const d = Dp / rows;
      const ca = -L / 2 + a + len / 2, cd = -Dp / 2 + d * (r + 0.5);
      const hx = along === 'x' ? len / 2 - alley / 2 : d / 2 - (rows > 1 ? alley / 2 : 0);
      const hz = along === 'x' ? d / 2 - (rows > 1 ? alley / 2 : 0) : len / 2 - alley / 2;
      if (hx < 4 || hz < 4) continue;
      lots.push({ x: block.x + (along === 'x' ? ca : cd), z: block.z + (along === 'x' ? cd : ca), hx, hz });
    }
    a += len;
  }
  return lots;
}

/** Fill every block of a plate with buildings. pick(lot, rng) -> building options or null. */
export function fillBlocks(ctx, plate, net, o) {
  const rng = ctx.rng.fork(o.seed ?? 1);
  const blocks = extractBlocks(plate, net, o);
  const placed = [];
  for (const b of blocks) {
    for (const lot of subdivide(b, rng, o)) {
      const routeClear = net.routeClearance(lot.x, lot.z) - Math.max(lot.hx, lot.hz);
      lot.near = routeClear < 24; lot.routeClear = routeClear;
      const opt = o.pick(lot, rng);
      if (!opt) continue;
      const res = cityBuilding(ctx, plate, lot.x, lot.z, lot.hx, lot.hz, { rng, collide: lot.near || o.collideAll, ...opt });
      placed.push({ ...lot, ...res });
    }
  }
  return { blocks, placed };
}

/**
 * Fill a plate with lots on a jittered grid (map coordinates), skipping streets,
 * reserved zones and torn edges. pick(lot) -> building options or null.
 */
export function fillLots(ctx, plate, net, map, o) {
  const rng = ctx.rng.fork(o.seed ?? 1);
  const placed = [];
  const reserved = o.reserved || [];
  for (let u = o.u0; u < o.u1; u += o.lot[0]) {
    for (let v = o.v0; v < o.v1; v += o.lot[1]) {
      const cu = u + o.lot[0] / 2 + rng.range(-2, 2), cv = v + o.lot[1] / 2 + rng.range(-2, 2);
      const c = plate.localAtMap(cu, cv);
      let hx = o.lot[0] / 2 - rng.range(1.5, 4), hz = o.lot[1] / 2 - rng.range(1.5, 4);
      // shrink to fit if the lot touches a street setback
      let ok = false;
      for (let k = 0; k < 4 && !ok; k++) {
        if (net.rectClear(c.x, c.z, hx, hz, 0, 0.5) && plate.rectOnGround(c.x, c.z, hx, hz, 0, 3)) ok = true;
        else { hx *= 0.8; hz *= 0.8; }
      }
      if (!ok || hx < 5 || hz < 5) continue;
      if (reserved.some((r) => Math.abs(c.x - r.x) < hx + r.hx && Math.abs(c.z - r.z) < hz + r.hz)) continue;
      const routeClear = net.routeClearance(c.x, c.z) - Math.max(hx, hz);
      const lot = { x: c.x, z: c.z, hx, hz, u: cu, v: cv, near: routeClear < 22, routeClear };
      const b = o.pick(lot, rng);
      if (!b) continue;
      const res = cityBuilding(ctx, plate, c.x, c.z, hx, hz, { rng, collide: lot.near || o.collideAll, ...b });
      placed.push({ ...lot, ...res });
    }
  }
  return placed;
}
