import * as THREE from 'three';
import { fbm, valueNoise2 } from '../util/noise.js';
import { clamp, lerp, smoothstep, smootherstep } from '../util/mathx.js';
import { WORLD } from '../config.js';

// ---------------------------------------------------------------------------
// Field = the analytic description of the ground.
//
//   base profile (terraced climb from surf to wall)
//   + rolling fBm
//   + huge earth mounds / spoil banks
//   - shell craters (with raised lips)
//   - zig-zag trenches
//   -> graded roads blended on top
//
// Everything (terrain mesh, car suspension, prop placement, turret line of
// sight, water depth) reads from this one function, so nothing ever floats or
// sinks.
// ---------------------------------------------------------------------------

const SEG_CELL = 26;

class SegmentIndex {
  constructor(cell = SEG_CELL) {
    this.cell = cell;
    this.grid = new Map();
    this.items = [];
  }

  _key(cx, cz) {
    return (cx * 73856093) ^ (cz * 19349663);
  }

  addPolyline(points, data) {
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      const item = { ax: a.x, az: a.z, bx: b.x, bz: b.z, data };
      const idx = this.items.push(item) - 1;
      const pad = (data.halfWidth || 6) + 6;
      const minX = Math.min(a.x, b.x) - pad;
      const maxX = Math.max(a.x, b.x) + pad;
      const minZ = Math.min(a.z, b.z) - pad;
      const maxZ = Math.max(a.z, b.z) + pad;
      for (let cx = Math.floor(minX / this.cell); cx <= Math.floor(maxX / this.cell); cx++) {
        for (let cz = Math.floor(minZ / this.cell); cz <= Math.floor(maxZ / this.cell); cz++) {
          const k = this._key(cx, cz);
          let bucket = this.grid.get(k);
          if (!bucket) this.grid.set(k, (bucket = []));
          bucket.push(idx);
        }
      }
    }
  }

  /** Visit every segment whose cell contains (x,z). */
  query(x, z) {
    return this.grid.get(this._key(Math.floor(x / this.cell), Math.floor(z / this.cell)));
  }
}

function distToSegment(px, pz, ax, az, bx, bz) {
  const vx = bx - ax;
  const vz = bz - az;
  const wx = px - ax;
  const wz = pz - az;
  const len2 = vx * vx + vz * vz;
  let t = len2 > 1e-8 ? (wx * vx + wz * vz) / len2 : 0;
  t = clamp(t, 0, 1);
  const cx = ax + vx * t;
  const cz = az + vz * t;
  return Math.hypot(px - cx, pz - cz);
}

/**
 * Rasterised road influence. Stamping every road sample into a 2 m grid once
 * turns "how far am I from the nearest carriageway, and how high is it there"
 * into an O(1) bilinear lookup - which matters when the terrain mesh alone
 * asks the question 130 000 times.
 */
class RoadRaster {
  constructor(roads, bounds, res = 2, reach = 30) {
    this.res = res;
    this.minX = bounds.minX;
    this.minZ = bounds.minZ;
    this.nx = Math.ceil((bounds.maxX - bounds.minX) / res) + 1;
    this.nz = Math.ceil((bounds.maxZ - bounds.minZ) / res) + 1;
    this.reach = reach;
    const n = this.nx * this.nz;
    this.dist = new Float32Array(n).fill(reach);
    this.roadY = new Float32Array(n);
    this.half = new Float32Array(n);

    for (const path of roads.paths) {
      const halfW = path.width * 0.5;
      const r = Math.ceil((halfW + 14) / res);
      for (const s of path.samples) {
        const ci = Math.round((s.x - this.minX) / res);
        const cj = Math.round((s.z - this.minZ) / res);
        for (let i = -r; i <= r; i++) {
          const gi = ci + i;
          if (gi < 0 || gi >= this.nx) continue;
          for (let j = -r; j <= r; j++) {
            const gj = cj + j;
            if (gj < 0 || gj >= this.nz) continue;
            const px = this.minX + gi * res;
            const pz = this.minZ + gj * res;
            const d = Math.hypot(px - s.x, pz - s.z);
            const idx = gj * this.nx + gi;
            if (d < this.dist[idx]) {
              this.dist[idx] = d;
              this.roadY[idx] = s.y;
              this.half[idx] = halfW;
            }
          }
        }
      }
    }
  }

  sample(x, z, out) {
    const fx = (x - this.minX) / this.res;
    const fz = (z - this.minZ) / this.res;
    const i0 = Math.floor(fx);
    const j0 = Math.floor(fz);
    if (i0 < 0 || j0 < 0 || i0 >= this.nx - 1 || j0 >= this.nz - 1) {
      out.dist = this.reach;
      out.y = 0;
      out.half = 0;
      return out;
    }
    const tx = fx - i0;
    const tz = fz - j0;
    const a = j0 * this.nx + i0;
    const b = a + 1;
    const c = a + this.nx;
    const d = c + 1;
    const w00 = (1 - tx) * (1 - tz);
    const w10 = tx * (1 - tz);
    const w01 = (1 - tx) * tz;
    const w11 = tx * tz;
    out.dist = this.dist[a] * w00 + this.dist[b] * w10 + this.dist[c] * w01 + this.dist[d] * w11;
    out.y = this.roadY[a] * w00 + this.roadY[b] * w10 + this.roadY[c] * w01 + this.roadY[d] * w11;
    // nearest (not blended) half-width avoids smearing road classes together
    let best = this.dist[a];
    let half = this.half[a];
    if (this.dist[b] < best) { best = this.dist[b]; half = this.half[b]; }
    if (this.dist[c] < best) { best = this.dist[c]; half = this.half[c]; }
    if (this.dist[d] < best) { best = this.dist[d]; half = this.half[d]; }
    out.half = half;
    return out;
  }
}

export class Field {
  constructor(layout, roads) {
    this.layout = layout;
    this.roads = roads;
    this.seed = WORLD.seed;
    this._rs = { dist: 99, y: 0, half: 0 };

    this.trenchIndex = new SegmentIndex();
    for (const tr of layout.trenches) {
      this.trenchIndex.addPolyline(tr.points, { halfWidth: tr.width * 0.5, depth: tr.depth });
    }

    // Bucket mounds/craters by Z band - cheap broad phase for 100k+ samples.
    this.bandSize = 120;
    this.bands = new Map();
    const push = (list, item, radius) => {
      const minB = Math.floor((item.z - radius) / this.bandSize);
      const maxB = Math.floor((item.z + radius) / this.bandSize);
      for (let b = minB; b <= maxB; b++) {
        let arr = this.bands.get(b);
        if (!arr) this.bands.set(b, (arr = { mounds: [], craters: [] }));
        arr[list].push(item);
      }
    };
    for (const m of layout.mounds) push('mounds', m, m.r * 1.2);
    for (const c of layout.craters) push('craters', c, c.r * 1.6);
  }

  /** Must be called after roads.gradeTo(), before any height() query. */
  bakeRoads(bounds) {
    this.raster = new RoadRaster(this.roads, bounds, 2, 30);
  }

  /** Big-scale shape of the beachhead: terraces climbing away from the sea. */
  profile(z) {
    let y = 1.2;
    y += 9.0 * smootherstep(120, -420, z);   // first rise off the beach
    y += 7.0 * smootherstep(-640, -1180, z); // the dunes / first ridge
    y += 6.5 * smootherstep(-1400, -1900, z); // second ridge
    y += 9.0 * smootherstep(-2080, -2600, z); // glacis up to the wall
    // seabed: drops away steeply past the surf line
    y -= 30.0 * smootherstep(140, 460, z);
    return y;
  }

  /** Terrain without roads - used to grade the roads themselves. */
  base(x, z) {
    let y = this.profile(z);

    const inland = smoothstep(150, -600, z);
    const amp = lerp(1.9, 6.4, inland);
    y += fbm(x, z, { freq: 0.0042, octaves: 4, amp, gain: 0.5, seed: this.seed });
    y += fbm(x, z, { freq: 0.016, octaves: 2, amp: lerp(0.35, 1.1, inland), seed: this.seed + 7 });

    // beach dune ripples, low and clean
    y += Math.sin(x * 0.045 + z * 0.012) * 0.7 * smoothstep(-160, 220, z);

    // flanking bluffs keep the player inside the battlefield
    const ax = Math.abs(x);
    y += 44 * smootherstep(352, 470, ax);
    y += 7 * valueNoise2(x * 0.02, z * 0.02, this.seed + 3) * smoothstep(330, 420, ax);

    // earth mounds & spoil banks
    const band = this.bands.get(Math.floor(z / this.bandSize));
    if (band) {
      for (const m of band.mounds) {
        const d = Math.hypot(x - m.x, z - m.z) / m.r;
        if (d < 1) {
          const k = smootherstep(1, 0, d);
          y += m.h * k;
        }
      }
      for (const c of band.craters) {
        const d = Math.hypot(x - c.x, z - c.z);
        if (d < c.r * 1.55) {
          const inner = smootherstep(c.r, c.r * 0.15, d);
          const lip = smootherstep(c.r * 1.55, c.r, d) * (1 - inner);
          y -= c.d * inner;
          y += c.d * 0.34 * lip;
        }
      }
    }

    // trenches
    const bucket = this.trenchIndex.query(x, z);
    if (bucket) {
      let cut = 0;
      let lip = 0;
      for (const idx of bucket) {
        const it = this.trenchIndex.items[idx];
        const d = distToSegment(x, z, it.ax, it.az, it.bx, it.bz);
        const hw = it.data.halfWidth;
        if (d < hw + 3.4) {
          cut = Math.max(cut, it.data.depth * smootherstep(hw, hw * 0.55, d));
          lip = Math.max(lip, 0.9 * smootherstep(hw + 3.4, hw + 0.6, d) * smootherstep(hw * 0.7, hw + 1.2, d));
        }
      }
      y -= cut;
      y += lip;
    }

    return y;
  }

  /** Final ground height, roads graded in. */
  height(x, z) {
    const base = this.base(x, z);
    if (!this.raster) return base;
    const rs = this.raster.sample(x, z, this._rs);
    if (rs.half <= 0) return base;
    const half = rs.half;
    const shoulder = half + 9;
    if (rs.dist > shoulder) return base;
    const k = smootherstep(shoulder, half, rs.dist);
    let y = lerp(base, rs.y, k);
    // slight crown on the carriageway so it sheds water and reads as built
    if (rs.dist < half) y += 0.22 * (1 - (rs.dist / half) ** 2);
    return y;
  }

  /** Distance to the nearest carriageway edge (negative = on the road). */
  roadDist(x, z) {
    if (!this.raster) return 99;
    const rs = this.raster.sample(x, z, this._rs);
    return rs.half > 0 ? rs.dist - rs.half : 99;
  }

  /** Cheap analytic normal via central differences. */
  normal(x, z, eps = 1.6, out = new THREE.Vector3()) {
    const hl = this.height(x - eps, z);
    const hr = this.height(x + eps, z);
    const hd = this.height(x, z - eps);
    const hu = this.height(x, z + eps);
    return out.set(hl - hr, 2 * eps, hd - hu).normalize();
  }

  /** Surface classification for driving physics + terrain colouring. */
  surface(x, z) {
    if (this.raster) {
      const rs = this.raster.sample(x, z, this._rs);
      if (rs.half > 0) {
        if (rs.dist < rs.half) return rs.half > 5.5 ? 'road' : 'track';
        if (rs.dist < rs.half + 3.5) return 'shoulder';
      }
    }
    if (z > 40) return 'sand';
    const n = valueNoise2(x * 0.012, z * 0.012, this.seed + 21);
    return n > 0.15 ? 'grass' : 'dirt';
  }
}
