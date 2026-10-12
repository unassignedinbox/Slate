//==================================================================================================
//  ROADEDITOR — TERRAIN AND WATER
//==================================================================================================
//  A heightfield the roads are laid on. Roads stamp their corridor into it so a carriageway is
//  never left floating over a hill or buried in it; the stamp has a blend skirt so the ground meets
//  the kerb line naturally instead of stepping.
//
//  The river is carved and its surface is emitted as its own ribbon at the water level, so a bridge
//  has something to span and the waterfront promenade has a shore to sit on.
//==================================================================================================

import { clamp, lerp, smoothstep, fbm, Rng, SegmentGrid, MAT, dist2 } from './core.js';
import { sampleControlPoints, resampleAdaptive, smoothPath, alongPath, pathLength } from './spline.js';

export class Terrain {
  constructor(extent, rng = new Rng(11), opts = {}) {
    this.extent = extent;
    this.rng = rng;
    this.relief = opts.relief ?? 1;
    this.hills = opts.hills ?? 0.55;
    this.base = opts.base ?? 26;
    this.waterLevel = 0;
    this.river = opts.river || null;
    this.stamps = [];
    this.stampGrid = new SegmentGrid(64);
    this.seed = opts.seed ?? 3;
    this.valleyAxis = opts.valleyAxis ?? rng.f(0, Math.PI * 2);
    this.buildRiver();
  }

  buildRiver() {
    if (!this.river) return null;
    const E = this.extent;
    const rng = this.rng;
    const angle = rng.f(0, Math.PI * 2);
    const dir = { x: Math.cos(angle), y: Math.sin(angle) };
    const nrm = { x: -dir.y, y: dir.x };
    const half = E * 0.72;
    const ctrl = [];
    const steps = 7;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const along = (t - 0.5) * 2 * half;
      const wobble = Math.sin(t * Math.PI * 2.3 + rng.f(0, 2)) * E * 0.1 + rng.gauss(0, E * 0.025);
      ctrl.push({ x: dir.x * along + nrm.x * wobble, y: dir.y * along + nrm.y * wobble, z: 0 });
    }
    const dense = sampleControlPoints(ctrl, false, 16);
    const path = resampleAdaptive(smoothPath(dense, 2, false), 6, 26, 30, false);
    const width = this.river.width ?? this.rng.f(70, 130);
    this.river = { path, width, depth: this.river.depth ?? this.rng.f(4, 7) };
    this.river.ctrl = ctrl;
    return this.river;
  }

  riverDistance(x, y) {
    if (!this.river) return { d: Infinity, t: 0 };
    const path = this.river.path;
    let best = Infinity;
    let bestT = 0;
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i];
      const b = path[i + 1];
      const ex = b.x - a.x;
      const ey = b.y - a.y;
      const len = ex * ex + ey * ey;
      let t = len > 1e-6 ? ((x - a.x) * ex + (y - a.y) * ey) / len : 0;
      t = clamp(t, 0, 1);
      const px = a.x + ex * t;
      const py = a.y + ey * t;
      const d = Math.hypot(x - px, y - py);
      if (d < best) {
        best = d;
        bestT = (i + t) / (path.length - 1);
      }
    }
    return { d: best, t: bestT };
  }

  /** Natural ground before any road stamping. */
  baseHeight(x, y) {
    const E = this.extent;
    const scale = 1 / (E * 0.34);
    let h = this.base;
    h += (fbm(x * scale * 0.5, y * scale * 0.5, 4, this.seed) - 0.5) * 150 * this.relief;
    h += (fbm(x * scale * 2.3, y * scale * 2.3, 3, this.seed + 17) - 0.5) * 34 * this.relief;
    h += (fbm(x * scale * 7.1, y * scale * 7.1, 2, this.seed + 41) - 0.5) * 6 * this.relief;
    // A shallow bowl under the city centre keeps the core readable from the air.
    const r = Math.hypot(x, y) / E;
    h -= Math.exp(-Math.pow(r * 4.2, 2)) * 22 * this.relief;
    // Ridges near the map edge turn the perimeter into canyon country.
    const edge = clamp((r - 0.34) / 0.34, 0, 1);
    h += Math.pow(edge, 1.4) * (58 + 52 * fbm(x / (E * 0.2), y / (E * 0.2), 3, this.seed + 91)) * this.relief * this.hills;
    if (this.river) {
      const { d } = this.riverDistance(x, y);
      const w = this.river.width * 0.5;
      const bank = 46;
      if (d < w + bank) {
        const inner = clamp(d / w, 0, 1);
        const outer = clamp((d - w) / bank, 0, 1);
        // Flatten into a valley floor, then drop to the river bed.
        const target = -this.river.depth * (1 - smoothstep(inner)) + 1.2;
        const blend = 1 - smoothstep(outer);
        h = lerp(h, Math.min(h, target), blend * 0.92);
      }
    }
    return h;
  }

  /** Ground after road corridors were stamped in. */
  height(x, y) {
    let h = this.baseHeight(x, y);
    if (this.stamps.length) {
      let bestW = 0;
      let bestZ = 0;
      const cell = this.stampGrid.cell;
      this.stampGrid.query(x - cell, y - cell, x + cell, y + cell, (s) => {
        if (s.minX - 8 > x || s.maxX + 8 < x || s.minY - 8 > y || s.maxY + 8 < y) return;
        const d = pointSegDistance(x, y, s);
        const w = stampWeight(d, s);
        if (w > bestW) {
          bestW = w;
          bestZ = s.z;
        }
      });
      if (bestW > 0) h = lerp(h, bestZ, bestW);
    }
    return h;
  }

  /**
   * Stamps a road corridor: the ground inside the carriageway band is pushed to the road's own
   * elevation, and the blend skirt carries it back to natural ground over `blend` metres.
   */
  stampRoad(path, halfWidth, blend = 5.5) {
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i];
      const b = path[i + 1];
      if (dist2(a, b) < 0.4) continue;
      const s = {
        ax: a.x,
        ay: a.y,
        bx: b.x,
        by: b.y,
        z: (a.z + b.z) * 0.5,
        half: halfWidth,
        blend,
        minX: Math.min(a.x, b.x),
        maxX: Math.max(a.x, b.x),
        minY: Math.min(a.y, b.y),
        maxY: Math.max(a.y, b.y),
      };
      this.stamps.push(s);
      this.stampGrid.insert(s, s.minX, s.minY, s.maxX, s.maxY);
    }
  }

  /** Water surface ribbon along the river at the water level. */
  buildWaterMesh(mb) {
    if (!this.river) return;
    const path = this.river.path;
    const w = this.river.width * 0.5 + 6;
    mb.beginGroup('water-river', { kind: 'water' });
    const rows = [];
    for (let i = 0; i < path.length; i++) {
      const a = path[Math.max(0, i - 1)];
      const b = path[Math.min(path.length - 1, i + 1)];
      const t = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const nx = -(b.y - a.y) / t;
      const ny = (b.x - a.x) / t;
      const p = path[i];
      rows.push([
        mb.vertex({ x: p.x + nx * w, y: p.y + ny * w, z: this.waterLevel }, { x: 0, y: 0, z: 1 }, [1, 1, 1], MAT.WATER),
        mb.vertex({ x: p.x - nx * w, y: p.y - ny * w, z: this.waterLevel }, { x: 0, y: 0, z: 1 }, [1, 1, 1], MAT.WATER),
      ]);
    }
    for (let i = 0; i < rows.length - 1; i++) mb.strip(rows[i], rows[i + 1], true);
    mb.endGroup();
  }

  buildMesh(mb, resolution = 220) {
    const E = this.extent * 1.06;
    const n = resolution;
    const step = E / (n - 1);
    const x0 = -E / 2;
    const y0 = -E / 2;
    const normals = new Float32Array(n * n * 3);
    const heights = new Float32Array(n * n);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        heights[j * n + i] = this.height(x0 + i * step, y0 + j * step);
      }
    }
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const hl = heights[j * n + Math.max(0, i - 1)];
        const hr = heights[j * n + Math.min(n - 1, i + 1)];
        const hd = heights[Math.max(0, j - 1) * n + i];
        const hu = heights[Math.min(n - 1, j + 1) * n + i];
        const nx = hl - hr;
        const ny = hd - hu;
        const nz = 2 * step;
        const l = Math.hypot(nx, ny, nz) || 1;
        normals[(j * n + i) * 3] = nx / l;
        normals[(j * n + i) * 3 + 1] = ny / l;
        normals[(j * n + i) * 3 + 2] = nz / l;
      }
    }
    const rows = [];
    for (let j = 0; j < n; j++) {
      const row = [];
      for (let i = 0; i < n; i++) {
        const idx = j * n + i;
        const x = x0 + i * step;
        const y = y0 + j * step;
        const h = heights[idx];
        const nrm = { x: normals[idx * 3], y: normals[idx * 3 + 1], z: normals[idx * 3 + 2] };
        const underwater = h < this.waterLevel + 0.5;
        const slope = 1 - nrm.z;
        const sand = clamp(smoothstep(clamp((this.waterLevel + 7 - h) / 7, 0, 1)), 0, 1);
        let mat = MAT.GRASS;
        let tint = [1, 1, 1];
        if (underwater) {
          mat = MAT.SAND;
          tint = [0.72, 0.7, 0.62];
        } else if (sand > 0.35) {
          mat = MAT.SAND;
          tint = [0.95, 0.93, 0.84];
        } else if (slope > 0.34) {
          mat = MAT.ROCK;
          tint = [0.9, 0.88, 0.86];
        } else if (slope > 0.2) {
          mat = MAT.GRAVEL;
          tint = [0.96, 0.95, 0.9];
        }
        const relief = clamp((h - this.waterLevel) / 120, 0, 1);
        tint = [tint[0] * (1 - relief * 0.16), tint[1] * (1 - relief * 0.2), tint[2] * (1 - relief * 0.26)];
        row.push(mb.vertex({ x, y, z: h }, nrm, tint, mat));
      }
      rows.push(row);
    }
    for (let j = 0; j < rows.length - 1; j++) mb.strip(rows[j], rows[j + 1], true);
  }
}

function pointSegDistance(x, y, s) {
  const ex = s.bx - s.ax;
  const ey = s.by - s.ay;
  const len = ex * ex + ey * ey;
  let t = len > 1e-6 ? ((x - s.ax) * ex + (y - s.ay) * ey) / len : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(x - (s.ax + ex * t), y - (s.ay + ey * t));
}

function stampWeight(d, s) {
  if (d <= s.half) return 1;
  if (d >= s.half + s.blend) return 0;
  return 1 - smoothstep((d - s.half) / s.blend);
}
