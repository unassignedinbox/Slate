// Section 2 - THE TILTED CITY: the plates.
//
// The downtown has broken into a few enormous plates of ground, each tipped at
// its own angle and hanging in the sky. Everything built on a plate is rigid
// with it - streets, towers, parked cars - so the whole skyline of a plate leans
// as one. The plates themselves rock very slowly (fractions of a degree, half a
// metre of heave) like heavy rafts. Because the racing surface is the plate
// itself, there are no joints to drift apart inside a plate; the only places
// where two moving things meet are the authored crossings (a jump, a drop, a
// fallen tower wedged between two plates).
import * as THREE from 'three';
import { MeshBuilder, K, PAL, lin } from '../../core/geo.js';
import { fracturePoly, clipPoly, prismPoly, polyBounds } from '../../core/fracture.js';
import { makeParent } from '../../core/motion.js';
import { F } from '../../core/world.js';
import { V3, Q } from '../ctx.js';

export const DEG = Math.PI / 180;
const T = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z);
const RT = (x, y, z, rx = 0, ry = 0, rz = 0) => new THREE.Matrix4().compose(V3(x, y, z), Q(rx, ry, rz), V3(1, 1, 1));

/** The section's map frame: u forward (along the arrival heading), v to the left, h absolute height. */
export class MapFrame {
  constructor(origin, headingDeg) {
    this.o = origin.clone();
    this.heading = headingDeg;
    const p = headingDeg * DEG;
    this.F = V3(Math.cos(p), 0, -Math.sin(p));
    this.L = V3(-Math.sin(p), 0, -Math.cos(p));
    this.quat = new THREE.Quaternion().setFromAxisAngle(V3(0, 1, 0), p); // local +X -> F, +Z -> right
  }
  at(u, h, v) { return V3(this.o.x + this.F.x * u + this.L.x * v, h, this.o.z + this.F.z * u + this.L.z * v); }
  uv(p) { const dx = p.x - this.o.x, dz = p.z - this.o.z; return { u: dx * this.F.x + dz * this.F.z, v: dx * this.L.x + dz * this.L.z }; }
}

/** An infinite plane the racing line can be laid on (RouteBuilder `on`). */
export class PlaneSurf {
  constructor(point, normal) { this.c = point.clone(); this.n = normal.clone().normalize(); }
  heightAt(x, z) { const n = this.n; return this.c.y - (n.x * (x - this.c.x) + n.z * (z - this.c.z)) / n.y; }
  /** Route bank (rad, + lowers the right side) of a line heading psi on this plane. */
  bankAt(x, z, psi) {
    const n = this.n;
    const hx = Math.cos(psi), hz = -Math.sin(psi);
    const t = V3(hx, -(n.x * hx + n.z * hz) / n.y, hz).normalize();
    const rh = V3(Math.sin(psi), 0, Math.cos(psi));
    const u0 = new THREE.Vector3().crossVectors(rh, t).normalize();
    return Math.atan2(n.dot(rh), n.dot(u0));
  }
}

/**
 * A plate of city ground. Defined by a reference point on its top surface, a tilt
 * (pitch: the surface descends along +u; roll: it descends towards +v) and a map
 * extent. Local frame: origin at the pivot on the top surface, X ~ forward (u),
 * Y = plate normal, Z ~ right (-v).
 */
export class Plate extends PlaneSurf {
  constructor(ctx, map, o) {
    const qTilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(-(o.roll || 0) * DEG, 0, -(o.pitch || 0) * DEG, 'ZYX'));
    const quat = map.quat.clone().multiply(qTilt);
    const n = V3(0, 1, 0).applyQuaternion(quat);
    const ref = map.at(o.ref[0], o.ref[2], o.ref[1]);
    super(ref, n);
    this.ctx = ctx;
    this.map = map;
    this.name = o.name;
    this.quat = quat;
    this.qInv = quat.clone().invert();
    const pv = o.pivot || [(o.u0 + o.u1) / 2, (o.v0 + o.v1) / 2];
    const pw = map.at(pv[0], 0, pv[1]);
    pw.y = this.heightAt(pw.x, pw.z);
    this.pos = pw;
    if (o.drop) { this.pos.addScaledVector(n, -o.drop); this.c.addScaledVector(n, -o.drop); }
    this.parent = o.shareParent ? o.shareParent.parent : makeParent(this.pos, quat, o.motion || {});
    this.ext = { u0: o.u0, u1: o.u1, v0: o.v0, v1: o.v1 };
    this.thick = o.thick ?? 14;
    // the plate's outline in local coordinates (corners of the map rectangle on the plane)
    this.corners = [[o.u0, o.v0], [o.u1, o.v0], [o.u1, o.v1], [o.u0, o.v1]].map(([u, v]) => this.localAtMap(u, v));
    this.keep = [];   // local rects {x0,x1,z0,z1} the torn edge may not eat into
    this.cuts = [];   // extra clip planes (local) e.g. the fault line: [n, d] keeps n.p <= d
    this.pieces = [];
  }

  /** World point -> plate-local (rest pose). */
  toLocal(p) { return p.clone().sub(this.pos).applyQuaternion(this.qInv); }
  toWorld(x, y, z) { return V3(x, y, z).applyQuaternion(this.quat).add(this.pos); }
  /** Plate-local point of the surface above map (u, v). */
  localAtMap(u, v) { const w = this.map.at(u, 0, v); w.y = this.heightAt(w.x, w.z); return this.toLocal(w); }
  /** World pose for something standing on the plate at local (x, z), rotated by yaw about the plate normal. */
  pose(x, z, yaw = 0, y = 0) { return { pos: this.toWorld(x, y, z), quat: this.quat.clone().multiply(Q(0, yaw, 0)) }; }
  /** World quaternion for a local rotation. */
  q(rx = 0, ry = 0, rz = 0) { return this.quat.clone().multiply(Q(rx, ry, rz)); }
  /** Is local (x, z) on the plate (inside its untorn outline, minus a margin)? */
  inside(x, z, margin = 0) {
    const c = this.corners;
    for (let i = 0; i < 4; i++) {
      const a = c[i], b = c[(i + 1) % 4];
      const ex = b.x - a.x, ez = b.z - a.z, L = Math.hypot(ex, ez);
      // inward normal for a CCW (seen from +Y) ring... decide sign by the centroid
      const nx = -ez / L, nz = ex / L;
      const cx = (c[0].x + c[2].x) / 2, cz = (c[0].z + c[2].z) / 2;
      const sgn = Math.sign((cx - a.x) * nx + (cz - a.z) * nz) || 1;
      if (((x - a.x) * nx + (z - a.z) * nz) * sgn < margin) return false;
    }
    for (const [n, d] of this.cuts) if (n.x * x + n.z * z > d - margin) return false;
    return true;
  }

  /**
   * Is local (x, z) over actual ground (inside one of the torn shards)? The margin
   * applies only to the outer (torn) boundary, not to the cracks between shards.
   */
  onGround(x, z, margin = 0) {
    if (!this._sides) this.prepSides();
    for (const sides of this._sides) {
      let ok = true;
      for (const sd of sides) if (sd.n.x * x + sd.n.z * z > sd.d - (sd.outer ? margin : 0) + 1e-6) { ok = false; break; }
      if (ok) return true;
    }
    return false;
  }

  prepSides() {
    this._sides = this.pieces.map((pc) => pc.poly.faces.filter((f) => Math.abs(f.n.y) < 0.5).map((f) => {
      const n = V3(f.n.x, 0, f.n.z).normalize();
      return { n, d: n.x * f.v[0].x + n.z * f.v[0].z, outer: true };
    }));
    // a side shared with another shard (opposite normal, same plane) is a crack, not an edge
    const all = this._sides.flat();
    for (const a of all) for (const b of all) if (a !== b && a.n.dot(b.n) < -0.9999 && Math.abs(a.d + b.d) < 1e-3) { a.outer = false; b.outer = false; }
  }

  /** All four corners (and the centre) of a local rect footprint on the ground? */
  rectOnGround(x, z, hx, hz, yaw = 0, margin = 0) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    for (const [a, b] of [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz], [0, 0]]) {
      const px = x + a * c + b * s, pz = z - a * s + b * c;
      if (!this.onGround(px, pz, margin)) return false;
    }
    return true;
  }

  /**
   * Build the slab: convex shards (vertical fracture), torn along the boundary,
   * strata on the cut faces, a hanging root mass of earth below.
   */
  build(rng, o = {}) {
    const ctx = this.ctx;
    const top = this.corners.map((c) => V3(c.x, 0, c.z));
    const bot = this.corners.map((c) => V3(c.x, -this.thick, c.z));
    const topCol = lin(o.groundCol ?? PAL.pave), sideCol = lin(PAL.fill), botCol = lin(PAL.soil);
    let slab = prismPoly(top, bot, { top: K.PAVE, side: K.STRATA, bottom: K.SOIL }, { top: topCol, side: sideCol, bottom: botCol });
    for (const [n, d] of this.cuts) { slab = clipPoly(slab, n, d, K.STRATA, sideCol).neg; }
    const b = polyBounds(slab);
    const area = (b.max.x - b.min.x) * (b.max.z - b.min.z);
    const count = o.count ?? Math.max(4, Math.round(area / 5200));
    const shards = fracturePoly(slab, { count, rng, minFrac: 0.02, jitter: 0.35, normalFn: () => { const a = rng.range(0, Math.PI); return V3(Math.cos(a), 0, Math.sin(a)); }, cutKind: K.STRATA, cutColor: sideCol });
    // tear the outline: each shard on the boundary loses a wedge to a random plane
    const ring = this.corners;
    const edges = [];
    for (let i = 0; i < 4; i++) {
      const a = ring[i], c = ring[(i + 1) % 4];
      const ex = c.x - a.x, ez = c.z - a.z, L = Math.hypot(ex, ez);
      let nx = ez / L, nz = -ex / L;
      const mx = (ring[0].x + ring[2].x) / 2, mz = (ring[0].z + ring[2].z) / 2;
      if ((a.x - mx) * nx + (a.z - mz) * nz < 0) { nx = -nx; nz = -nz; }
      edges.push({ a, c, n: V3(nx, 0, nz), d: a.x * nx + a.z * nz, L, skip: (o.noTear || []).includes(i) });
    }
    for (let sh of shards) {
      for (const e of edges) {
        if (e.skip || !sh) continue;
        let touches = false;
        for (const f of sh.faces) for (const v of f.v) if (Math.abs(v.x * e.n.x + v.z * e.n.z - e.d) < 0.6) touches = true;
        if (!touches) continue;
        for (let tries = 0; tries < 3; tries++) {
          const ang = rng.range(-0.32, 0.32);
          const n = e.n.clone().applyAxisAngle(V3(0, 1, 0), ang);
          // the plane passes inside the edge by 3..16 m at the shard's centre
          let cx = 0, cz = 0, k = 0;
          for (const f of sh.faces) for (const v of f.v) { cx += v.x; cz += v.z; k++; }
          cx /= k; cz /= k;
          const dist = cx * e.n.x + cz * e.n.z - e.d; // negative: inside
          const inward = rng.range(2, o.tear ?? 12);
          const px = cx - e.n.x * dist - e.n.x * inward, pz = cz - e.n.z * dist - e.n.z * inward;
          const d = n.x * px + n.z * pz;
          if (this.keep.some((r) => [[r.x0, r.z0], [r.x1, r.z0], [r.x0, r.z1], [r.x1, r.z1]].some(([x, z]) => n.x * x + n.z * z > d))) continue;
          const res = clipPoly(sh, n, d, K.STRATA, sideCol);
          if (res.neg) sh = res.neg;
          break;
        }
      }
      if (!sh) continue;
      const mb = new MeshBuilder();
      mb.convex(sh);
      const body = ctx.body({ mb, pos: this.pos, quat: this.quat, motion: { parent: this.parent }, flags: F.ROUTE, colliders: [{ poly: sh, drivable: true, surface: 'road' }], name: `${this.name}-ground` });
      this.pieces.push({ poly: sh, body });
    }
    this.buildRoots(rng, o);
    return this;
  }

  /** The torn earth hanging under the plate: a few inverted spires of layered ground. */
  buildRoots(rng, o = {}) {
    const mb = new MeshBuilder();
    const n = o.roots ?? 5;
    const xs = this.corners.map((c) => c.x), zs = this.corners.map((c) => c.z);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
    const col = lin(PAL.fill), col2 = lin(PAL.rock);
    for (let i = 0; i < n; i++) {
      const cx = rng.range(x0 + 40, x1 - 40), cz = rng.range(z0 + 30, z1 - 30);
      const w = rng.range(70, 150), d = rng.range(60, 120), depth = rng.range(50, 120);
      root(mb, cx, -this.thick + 0.5, cz, w, d, depth, rng, i % 2 ? col : col2);
    }
    // one big central mass so the plate reads as a chunk of ground, not a sheet
    root(mb, (x0 + x1) / 2, -this.thick + 0.5, (z0 + z1) / 2, (x1 - x0) * 0.62, (z1 - z0) * 0.62, o.coreDepth ?? 150, rng, col2);
    this.ctx.body({ mb, pos: this.pos, quat: this.quat, motion: { parent: this.parent }, flags: F.SCENERY, name: `${this.name}-roots` });
  }

  /** Underground cross-section where the route crosses an edge: basements, a metro tube, pipes. */
  section(rng, x, z, outYaw, o = {}) {
    const mb = new MeshBuilder();
    const conc = lin(PAL.concrete), dark = lin(PAL.cut), steel = lin(PAL.steel);
    const M = RT(x, 0, z, 0, outYaw, 0); // local +Z points out of the cliff
    const add = (fn) => fn(mb, M);
    const w = o.w ?? 60;
    // basement floors sticking out of the broken face
    for (const [y, ext] of [[-3.6, rng.range(1, 3)], [-7.2, rng.range(0.5, 4)], [-10.8, rng.range(1, 2.5)]]) {
      for (let k = -w / 2; k < w / 2; k += rng.range(9, 16)) {
        const L = rng.range(5, 12);
        mb.box(L, 0.45, ext + 1, new THREE.Matrix4().multiplyMatrices(M, RT(k + L / 2, y, ext / 2 - 0.5, rng.range(-0.03, 0.03), 0, rng.range(-0.06, 0.06))), { top: K.FLOOR, side: K.CUT }, { top: conc, side: dark });
      }
    }
    // columns hanging out of the face
    for (let k = -w / 2 + 4; k < w / 2; k += rng.range(7, 11)) mb.box(0.7, rng.range(3, 9), 0.7, new THREE.Matrix4().multiplyMatrices(M, RT(k, -5, rng.range(0.2, 1.5), rng.range(-0.15, 0.15), 0, rng.range(-0.1, 0.1))), K.PLAIN, conc);
    // a metro tube, broken open
    if (o.metro !== false) {
      const mx = o.metroX ?? rng.range(-w / 4, w / 4), my = -this.thick + 4.2;
      const R = 3.6, L = rng.range(3, 7);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        if (i === 9 && rng.chance(0.6)) continue; // a missing segment
        mb.box(2.0, 0.45, L + rng.range(-1, 1), new THREE.Matrix4().multiplyMatrices(M, RT(mx + Math.cos(a) * R, my + Math.sin(a) * R, L / 2 - 0.5, 0, 0, a + Math.PI / 2)), { side: K.PLAIN, top: K.CUT }, { side: conc, top: dark });
      }
      mb.box(2.6, 0.2, L, new THREE.Matrix4().multiplyMatrices(M, T(mx, my - R + 0.9, L / 2 - 0.5)), K.FLOOR, lin(PAL.concrete2));
      for (const s of [-0.75, 0.75]) mb.box(0.12, 0.16, L, new THREE.Matrix4().multiplyMatrices(M, T(mx + s, my - R + 1.08, L / 2 - 0.5)), K.METAL, steel);
    }
    // pipes
    for (let i = 0; i < (o.pipes ?? 6); i++) {
      const r = rng.range(0.25, 0.9);
      mb.cylinder(r, r, rng.range(2, 7), 8, new THREE.Matrix4().multiplyMatrices(M, RT(rng.range(-w / 2, w / 2), rng.range(-2.5, -this.thick + 2), 1.5, Math.PI / 2 + rng.range(-0.3, 0.3), 0, rng.range(-0.2, 0.2))), K.METAL, i % 2 ? steel : lin(PAL.metal));
    }
    this.ctx.body({ mb, pos: this.pos, quat: this.quat, motion: { parent: this.parent }, flags: F.SCENERY, name: `${this.name}-section` });
  }
}

/** Inverted spire of earth: two frustums and a point, slightly skewed. */
function root(mb, cx, y0, cz, w, d, depth, rng, col) {
  const ring = (hw, hd, y, ox, oz, k) => {
    const pts = [];
    for (let i = 0; i < k; i++) {
      const a = (i / k) * Math.PI * 2 + 0.3;
      const rr = 0.82 + 0.18 * Math.sin(i * 2.3 + cx);
      pts.push(V3(cx + ox + Math.cos(a) * hw * rr, y, cz + oz + Math.sin(a) * hd * rr));
    }
    return pts;
  };
  const k = 7;
  const r0 = ring(w / 2, d / 2, y0, 0, 0, k);
  const o1x = rng.range(-0.15, 0.15) * w, o1z = rng.range(-0.15, 0.15) * d;
  const r1 = ring(w * 0.32, d * 0.32, y0 - depth * 0.4, o1x, o1z, k);
  const apex = V3(cx + o1x * 1.6 + rng.range(-5, 5), y0 - depth, cz + o1z * 1.6 + rng.range(-5, 5));
  const c0 = V3(cx, y0 - depth * 0.2, cz);
  for (let i = 0; i < k; i++) {
    const j = (i + 1) % k;
    const out = r0[i].clone().add(r0[j]).multiplyScalar(0.5).sub(c0).setY(0).normalize();
    mb.poly([r0[i], r0[j], r1[j], r1[i]], K.STRATA, col, undefined, out.clone().add(V3(0, -0.4, 0)));
    mb.poly([r1[i], r1[j], apex], K.STRATA, col, undefined, out.clone().add(V3(0, -0.6, 0)));
  }
}
