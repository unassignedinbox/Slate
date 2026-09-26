import * as THREE from 'three';
import { clamp } from './util.js';

const CELL = 24;

/**
 * Very small broad-phase for static battlefield clutter: everything is
 * either a circle or an oriented box in the XZ plane.
 */
export class Colliders {
  constructor() {
    this.items = [];
    this.buckets = new Map();
    this.occluders = [];
  }

  _key(cx, cz) {
    return cx * 10007 + cz;
  }

  _insert(item) {
    const r = item.reach;
    const x0 = Math.floor((item.x - r) / CELL);
    const x1 = Math.floor((item.x + r) / CELL);
    const z0 = Math.floor((item.z - r) / CELL);
    const z1 = Math.floor((item.z + r) / CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const k = this._key(cx, cz);
        let arr = this.buckets.get(k);
        if (!arr) {
          arr = [];
          this.buckets.set(k, arr);
        }
        arr.push(item);
      }
    }
  }

  addCircle(x, z, radius, opts = {}) {
    const item = {
      type: 'circle',
      x,
      z,
      radius,
      reach: radius,
      severity: opts.severity !== undefined ? opts.severity : 1,
      damage: opts.damage !== undefined ? opts.damage : 1,
      kind: opts.kind || 'solid',
      height: opts.height || 2,
      onHit: opts.onHit || null,
      data: opts.data || null,
    };
    this.items.push(item);
    this._insert(item);
    return item;
  }

  addBox(x, z, halfX, halfZ, yaw = 0, opts = {}) {
    const item = {
      type: 'box',
      x,
      z,
      halfX,
      halfZ,
      yaw,
      cos: Math.cos(-yaw),
      sin: Math.sin(-yaw),
      reach: Math.hypot(halfX, halfZ),
      severity: opts.severity !== undefined ? opts.severity : 1,
      damage: opts.damage !== undefined ? opts.damage : 1,
      kind: opts.kind || 'solid',
      height: opts.height || 2,
      onHit: opts.onHit || null,
      data: opts.data || null,
    };
    this.items.push(item);
    this._insert(item);
    return item;
  }

  /** Line-of-sight blocker (approximated by a sphere). */
  addOccluder(x, y, z, radius) {
    this.occluders.push({ x, y, z, r: radius });
  }

  nearby(x, z, radius, out = []) {
    out.length = 0;
    const x0 = Math.floor((x - radius) / CELL);
    const x1 = Math.floor((x + radius) / CELL);
    const z0 = Math.floor((z - radius) / CELL);
    const z1 = Math.floor((z + radius) / CELL);
    const seen = new Set();
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const arr = this.buckets.get(this._key(cx, cz));
        if (!arr) continue;
        for (const it of arr) {
          if (seen.has(it)) continue;
          seen.add(it);
          out.push(it);
        }
      }
    }
    return out;
  }

  /** Closest-point penetration of a circle against one collider. */
  static penetration(item, px, pz, radius) {
    if (item.type === 'circle') {
      const dx = px - item.x;
      const dz = pz - item.z;
      const d = Math.hypot(dx, dz);
      const overlap = item.radius + radius - d;
      if (overlap <= 0) return null;
      const inv = d > 1e-5 ? 1 / d : 0;
      return { nx: d > 1e-5 ? dx * inv : 1, nz: d > 1e-5 ? dz * inv : 0, overlap };
    }
    // Oriented box
    const rx = px - item.x;
    const rz = pz - item.z;
    const lx = rx * item.cos - rz * item.sin;
    const lz = rx * item.sin + rz * item.cos;
    const cx = clamp(lx, -item.halfX, item.halfX);
    const cz = clamp(lz, -item.halfZ, item.halfZ);
    let dx = lx - cx;
    let dz = lz - cz;
    let d = Math.hypot(dx, dz);
    if (d > radius) return null;
    if (d < 1e-5) {
      // Deep inside — push out along the shallowest axis.
      const ox = item.halfX - Math.abs(lx);
      const oz = item.halfZ - Math.abs(lz);
      if (ox < oz) {
        dx = Math.sign(lx) || 1;
        dz = 0;
        d = 0;
        const overlap = ox + radius;
        const c = Math.cos(item.yaw);
        const s = Math.sin(item.yaw);
        return { nx: dx * c - dz * s, nz: dx * s + dz * c, overlap };
      }
      dx = 0;
      dz = Math.sign(lz) || 1;
      const overlap = oz + radius;
      const c = Math.cos(item.yaw);
      const s = Math.sin(item.yaw);
      return { nx: dx * c - dz * s, nz: dx * s + dz * c, overlap };
    }
    const inv = 1 / d;
    const nx = dx * inv;
    const nz = dz * inv;
    const overlap = radius - d;
    const c = Math.cos(item.yaw);
    const s = Math.sin(item.yaw);
    return { nx: nx * c - nz * s, nz: nx * s + nz * c, overlap };
  }

  /** Resolve the car (modelled as two circles) against static clutter. */
  resolveCar(car, dt, ctx) {
    const fwd = car.forward;
    const points = [
      { x: car.pos.x + fwd.x * 1.05, z: car.pos.z + fwd.z * 1.05, r: 1.02 },
      { x: car.pos.x - fwd.x * 1.05, z: car.pos.z - fwd.z * 1.05, r: 1.02 },
    ];
    const list = this.nearby(car.pos.x, car.pos.z, 6);
    let wire = 0;
    let totalDamage = 0;
    for (const p of points) {
      for (const item of list) {
        if (item.disabled) continue;
        const hit = Colliders.penetration(item, p.x, p.z, p.r);
        if (!hit) continue;
        if (item.kind === 'wire') {
          wire = Math.max(wire, 1);
          if (item.onHit) item.onHit(car, hit, dt);
          continue;
        }
        if (item.kind === 'trigger') {
          if (item.onHit) item.onHit(car, hit, dt);
          continue;
        }
        const push = hit.overlap + 0.001;
        const dmg = car.collide(hit.nx * push, hit.nz * push, item.severity, item.damage);
        totalDamage += dmg;
        if (dmg > 0 && item.onHit) item.onHit(car, hit, dt);
        if (dmg > 0 && ctx && ctx.onCrash) ctx.onCrash(item, dmg, p);
      }
    }
    return { wire, damage: totalDamage };
  }

  /** Does any occluder block the segment a -> b? */
  blocksLine(ax, ay, az, bx, by, bz) {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const len2 = dx * dx + dy * dy + dz * dz;
    if (len2 < 1e-6) return false;
    for (let i = 0; i < this.occluders.length; i++) {
      const o = this.occluders[i];
      const ox = o.x - ax;
      const oy = o.y - ay;
      const oz = o.z - az;
      let t = (ox * dx + oy * dy + oz * dz) / len2;
      if (t <= 0.02 || t >= 0.98) continue;
      const cx = ax + dx * t - o.x;
      const cy = ay + dy * t - o.y;
      const cz = az + dz * t - o.z;
      if (cx * cx + cy * cy + cz * cz < o.r * o.r) return true;
    }
    return false;
  }
}
