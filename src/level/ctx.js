// Level construction context shared by all builders.
import * as THREE from 'three';
import { Body, F } from '../core/world.js';
import { MeshBuilder, K, PAL, lin } from '../core/geo.js';
import { boxPoly, transformPoly, polyPlanes, polyVerts, clipPoly } from '../core/fracture.js';
import { RNG } from '../core/rng.js';

export class LevelCtx {
  constructor({ world, route = null, seed = 1, name = '', section = '' }) {
    this.world = world;
    this.route = route;
    this.rng = new RNG(seed);
    this.name = name;
    this.section = section;
    this.labels = [];     // { text, pos, size, kind } designer annotations
    this.respawns = [];   // { s, pos, quat, speed }
    this.crumbles = [];   // { sTrigger, bodies, centre }
    this.portals = [];
    this.spinners = [];   // bodies driven by custom code each frame
    this.keepout = [];    // spheres reserved by scenery { x,y,z,r }
    this.corridor = [];   // route corridor samples
    this.stats = { bodies: 0, colliders: 0, props: 0 };
    this.beat = '';
    if (route) this.buildCorridor();
  }

  // ---------------------------------------------------------------- frames
  /** Route-aligned frame for [sA,sB]: local X = left, Y = up, Z = along. Top surface at the route. */
  frame(sA, sB, o = {}) {
    const R = this.route;
    const pA = R.pos(sA), pB = R.pos(sB);
    const up = o.flat ? new THREE.Vector3(0, 1, 0) : R.at(sA).u.clone().add(R.at(sB).u).normalize();
    if (o.dropA) pA.addScaledVector(up, -o.dropA);
    if (o.dropB) pB.addScaledVector(up, -o.dropB);
    const along = pB.clone().sub(pA);
    const len = along.length();
    along.normalize();
    if (o.yaw) along.applyAxisAngle(up, o.yaw);
    const left = new THREE.Vector3().crossVectors(up, along).normalize();
    const up2 = new THREE.Vector3().crossVectors(along, left).normalize();
    if (o.roll) { left.applyAxisAngle(along, o.roll); up2.applyAxisAngle(along, o.roll); }
    const quat = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(left, up2, along));
    const pos = pA.clone().add(pB).multiplyScalar(0.5).addScaledVector(left, o.lat || 0);
    return { pos, quat, len, along, up: up2, left, sMid: (sA + sB) / 2, sA, sB };
  }

  /** Pose at route station s with offsets in the route frame (left, up, along) + yaw. */
  poseAt(s, left = 0, up = 0, along = 0, yaw = 0, tilt = [0, 0]) {
    const f = this.route.at(s);
    const lv = f.r.clone().negate();
    const pos = f.p.clone().addScaledVector(lv, left).addScaledVector(f.u, up).addScaledVector(f.t, along);
    const fwd = new THREE.Vector3(f.t.x, 0, f.t.z).normalize();
    const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(fwd.x, fwd.z) + yaw);
    if (tilt[0] || tilt[1]) quat.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt[0], 0, tilt[1])));
    return { pos, quat };
  }

  // ---------------------------------------------------------------- bodies
  body(o) {
    const geometry = o.mb && !o.mb.empty ? o.mb.toGeometry() : null;
    const b = new Body({
      name: o.name, pos: o.pos, quat: o.quat, motion: o.motion || null, flags: o.flags || 0,
      geometry, mass: o.mass, beat: o.beat ?? this.beat, userData: o.userData || {}, radius: o.radius,
    });
    for (const c of o.colliders || []) {
      b.addCollider(polyPlanes(c.poly), polyVerts(c.poly), { drivable: c.drivable ?? false, solid: c.solid ?? true, surface: c.surface || 'solid' });
      this.stats.colliders++;
    }
    if (!geometry && o.radius === undefined && b.colliders.length) {
      b.radius = Math.max(...b.colliders.map((c) => c.center.length() + c.radius));
    }
    this.world.add(b);
    this.stats.bodies++;
    if (o.flags & F.PROP) this.stats.props++;
    return b;
  }

  // ---------------------------------------------------------------- corridor
  buildCorridor() {
    const R = this.route;
    this.cgrid = new Map();
    for (let s = 0; s <= R.length; s += 2) {
      const f = R.at(s);
      const k = { x: f.p.x, y: f.p.y, z: f.p.z, hw: (f.width || 14) / 2 + 1.5, s };
      this.corridor.push(k);
      const key = `${Math.floor(k.x / 16)},${Math.floor(k.z / 16)}`;
      if (!this.cgrid.has(key)) this.cgrid.set(key, []);
      this.cgrid.get(key).push(k);
    }
  }

  /** Point vs corridor (hashed). */
  pointClear(p, { above = 10, below = 7, margin = 1 } = {}) {
    const cx = Math.floor(p.x / 16), cz = Math.floor(p.z / 16);
    for (let x = cx - 2; x <= cx + 2; x++) for (let z = cz - 2; z <= cz + 2; z++) {
      const arr = this.cgrid.get(`${x},${z}`);
      if (!arr) continue;
      for (const k of arr) {
        const dx = p.x - k.x, dz = p.z - k.z, lim = k.hw + margin;
        if (dx * dx + dz * dz > lim * lim) continue;
        if (p.y < k.y + above && p.y > k.y - below) return false;
      }
    }
    return true;
  }

  /** Oriented box (local x/z half-extents, local y from y0 to y1) vs corridor + keepout. */
  isBoxClear(pose, hx, hz, y0, y1, o = {}) {
    const p = new THREE.Vector3();
    const n = o.samples ?? 4;
    for (let i = 0; i <= n; i++) for (let k = 0; k <= n; k++) for (let j = 0; j <= 2; j++) {
      p.set(-hx + (2 * hx * i) / n, y0 + ((y1 - y0) * j) / 2, -hz + (2 * hz * k) / n).applyQuaternion(pose.quat).add(pose.pos);
      if (!this.pointClear(p, o)) return false;
    }
    if (!o.ignoreKeepout) {
      const c = new THREE.Vector3(0, (y0 + y1) / 2, 0).applyQuaternion(pose.quat).add(pose.pos);
      const r = Math.hypot(hx, hz, (y1 - y0) / 2) * (o.keepScale ?? 0.8);
      for (const k of this.keepout) if (Math.hypot(c.x - k.x, c.y - k.y, c.z - k.z) < r + k.r) return false;
    }
    return true;
  }

  /**
   * Is a sphere (centre c, radius r) clear of the racing corridor (+ clearance above
   * for car and chase camera, below for the road structure) and of reserved scenery?
   */
  isClear(c, r, { above = 10, below = 7, margin = 1, ignoreKeepout = false } = {}) {
    for (const k of this.corridor) {
      const dx = c.x - k.x, dz = c.z - k.z;
      const lim = k.hw + r + margin;
      if (dx * dx + dz * dz > lim * lim) continue;
      if (c.y - r < k.y + above && c.y + r > k.y - below) return false;
    }
    if (!ignoreKeepout) {
      for (const k of this.keepout) {
        const d = Math.hypot(c.x - k.x, c.y - k.y, c.z - k.z);
        if (d < r + k.r) return false;
      }
    }
    return true;
  }

  reserve(c, r) { this.keepout.push({ x: c.x, y: c.y, z: c.z, r }); }

  label(text, pos, o = {}) { this.labels.push({ text, pos: pos.clone(), size: o.size || 1, kind: o.kind || 'beat', beat: o.beat ?? this.beat }); }
}

// ------------------------------------------------------------------ helpers
export function boxP(w, h, d, M, kinds, colors) {
  const poly = boxPoly(w, h, d, (name) => ({
    kind: typeof kinds === 'number' ? kinds : (kinds[name] ?? kinds.side ?? K.PLAIN),
    color: Array.isArray(colors) ? colors : (colors[name] ?? colors.side ?? colors.top),
  }));
  return M ? transformPoly(poly, M) : poly;
}

export function clipAll(poly, planes) {
  let p = poly;
  for (const [n, d] of planes) {
    if (!p) return null;
    const { neg } = clipPoly(p, n, d, K.CUT, p.faces[0].color);
    p = neg;
  }
  return p;
}

/** Convex torn-earth underside: frustum then point, hanging below y=0 of M. */
export function soilUnderside(mb, w, d, depth, M, rng, col = lin(PAL.soil)) {
  const jx = rng.range(-0.2, 0.2) * w, jz = rng.range(-0.2, 0.2) * d;
  const mw = w * rng.range(0.45, 0.7), md = d * rng.range(0.45, 0.7);
  const d1 = depth * rng.range(0.35, 0.55);
  const top = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
  const mid = [[-mw / 2 + jx, -md / 2 + jz], [mw / 2 + jx, -md / 2 + jz], [mw / 2 + jx, md / 2 + jz], [-mw / 2 + jx, md / 2 + jz]];
  const V = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(M);
  const T = top.map(([x, z]) => V(x, 0, z)), Mi = mid.map(([x, z]) => V(x, -d1, z));
  const apex = V(jx + rng.range(-0.15, 0.15) * w, -depth, jz + rng.range(-0.15, 0.15) * d);
  const down = new THREE.Vector3(0, -1, 0).transformDirection(M);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    const out = new THREE.Vector3().addVectors(T[i], T[j]).multiplyScalar(0.5).sub(V(jx, -d1 * 0.5, jz)).normalize();
    mb.poly([T[i], T[j], Mi[j], Mi[i]], K.SOIL, col, undefined, out);
    const out2 = new THREE.Vector3().addVectors(Mi[i], Mi[j]).multiplyScalar(0.5).sub(apex).normalize().add(down.clone().multiplyScalar(-0.2));
    mb.poly([Mi[i], Mi[j], apex], K.SOIL, col, undefined, out2);
  }
}

export const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const Q = (rx = 0, ry = 0, rz = 0) => new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ'));
export function M4(pos, quat) { return new THREE.Matrix4().compose(pos, quat, new THREE.Vector3(1, 1, 1)); }
