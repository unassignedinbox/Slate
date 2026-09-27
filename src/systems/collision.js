// Uniform-grid broad phase for every solid thing on the battlefield.
// Obstacles are upright cylinders - good enough for a car at ground level and
// fast enough for the ~4000 of them this map contains.

export class Colliders {
  constructor(cell = 16) {
    this.cell = cell;
    this.grid = new Map();
    this.items = [];
  }

  _key(cx, cz) {
    return (cx * 73856093) ^ (cz * 19349663);
  }

  /**
   * @param {object} o {x, z, r, kind: 'solid'|'soft'|'wire', damage, mass}
   */
  add(o) {
    const item = { kind: 'solid', damage: 0, ...o };
    this.items.push(item);
    const r = Math.ceil(item.r / this.cell);
    const cx = Math.floor(item.x / this.cell);
    const cz = Math.floor(item.z / this.cell);
    for (let i = -r; i <= r; i++) {
      for (let j = -r; j <= r; j++) {
        const k = this._key(cx + i, cz + j);
        let b = this.grid.get(k);
        if (!b) this.grid.set(k, (b = []));
        b.push(item);
      }
    }
    return item;
  }

  addLine(ax, az, bx, bz, r, opts, step = null) {
    const len = Math.hypot(bx - ax, bz - az);
    const s = step || r * 1.3;
    const n = Math.max(1, Math.round(len / s));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      this.add({ x: ax + (bx - ax) * t, z: az + (bz - az) * t, r, ...opts });
    }
  }

  query(x, z, radius, out = []) {
    out.length = 0;
    const r = Math.ceil(radius / this.cell);
    const cx = Math.floor(x / this.cell);
    const cz = Math.floor(z / this.cell);
    const seen = new Set();
    for (let i = -r; i <= r; i++) {
      for (let j = -r; j <= r; j++) {
        const b = this.grid.get(this._key(cx + i, cz + j));
        if (!b) continue;
        for (const it of b) {
          if (it.dead || seen.has(it)) continue;
          const d = Math.hypot(it.x - x, it.z - z);
          if (d < radius + it.r) {
            seen.add(it);
            it._dist = d;
            out.push(it);
          }
        }
      }
    }
    return out;
  }
}
