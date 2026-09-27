import * as THREE from 'three';
import { clamp } from '../util/mathx.js';

// ---------------------------------------------------------------------------
// The road network.
//
// NOT a straight line: the main supply road serpentines up the beachhead with
// hairpins, chicanes and blind crests, threading between the strongpoints so
// every defensive position gets a shot at you. There is also a rough bypass
// track (shorter, but it runs straight through a minefield) and a couple of
// spurs into the gun positions.
// ---------------------------------------------------------------------------

const MAIN = [
  [6, 330], [-16, 268], [-74, 214], [-138, 158], [-170, 74], [-138, -6],
  [-58, -58], [42, -84], [132, -126], [192, -206], [186, -300], [128, -372],
  [24, -410], [-86, -444], [-176, -512], [-214, -616], [-176, -718],
  [-84, -790], [22, -830], [118, -890], [170, -984], [158, -1094],
  [88, -1174], [-24, -1214], [-136, -1256], [-222, -1338], [-238, -1450],
  [-176, -1552], [-66, -1610], [52, -1650], [154, -1710], [214, -1808],
  [196, -1922], [110, -2006], [-6, -2054], [-116, -2104], [-186, -2196],
  [-158, -2306], [-74, -2392], [-6, -2472], [4, -2560], [2, -2660],
];

// Rough bypass: peels off at the crossroads, cuts the corner, but crosses the
// minefield and the exposed flank of the ridge before rejoining.
const BYPASS = [
  [118, -890], [176, -820], [230, -760], [268, -700], [274, -620],
  [230, -540], [150, -486], [40, -462], [-60, -470], [-140, -520],
  [-180, -580], [-196, -640],
];

// Spur up to the ridge battery.
const SPUR_A = [
  [-176, -1552], [-244, -1600], [-306, -1662], [-330, -1742],
];

// Service track behind the wall approach, links the tank park.
const SPUR_B = [
  [-6, -2054], [86, -2096], [150, -2170], [154, -2262], [96, -2334], [-2, -2368],
];

function toCurve(points) {
  return new THREE.CatmullRomCurve3(
    points.map(([x, z]) => new THREE.Vector3(x, 0, z)),
    false,
    'catmullrom',
    0.35,
  );
}

export class Path {
  constructor(name, points, width, spacing = 2.4) {
    this.name = name;
    this.width = width;
    this.curve = toCurve(points);
    this.length = this.curve.getLength();
    const count = Math.max(8, Math.round(this.length / spacing));
    this.samples = [];
    const pts = this.curve.getSpacedPoints(count);
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const prev = pts[Math.max(0, i - 1)];
      const next = pts[Math.min(pts.length - 1, i + 1)];
      const dir = new THREE.Vector3().subVectors(next, prev);
      dir.y = 0;
      if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
      dir.normalize();
      this.samples.push({
        x: p.x,
        z: p.z,
        y: 0,
        t: i / (pts.length - 1),
        dist: (i / (pts.length - 1)) * this.length,
        dx: dir.x,
        dz: dir.z,
        nx: -dir.z, // left-hand normal in XZ
        nz: dir.x,
        width,
      });
    }
  }

  buildGrid(cellSize = 24) {
    this.cellSize = cellSize;
    this.grid = new Map();
    for (const s of this.samples) {
      const cx = Math.floor(s.x / cellSize);
      const cz = Math.floor(s.z / cellSize);
      const k = (cx * 73856093) ^ (cz * 19349663);
      let bucket = this.grid.get(k);
      if (!bucket) this.grid.set(k, (bucket = []));
      bucket.push(s);
    }
    return this;
  }

  nearest(x, z, radius = 40) {
    const r = Math.ceil(radius / this.cellSize);
    const cx = Math.floor(x / this.cellSize);
    const cz = Math.floor(z / this.cellSize);
    let best = null;
    let bestD2 = radius * radius;
    for (let i = -r; i <= r; i++) {
      for (let j = -r; j <= r; j++) {
        const bucket = this.grid.get(((cx + i) * 73856093) ^ ((cz + j) * 19349663));
        if (!bucket) continue;
        for (const s of bucket) {
          const dx = s.x - x;
          const dz = s.z - z;
          const d2 = dx * dx + dz * dz;
          if (d2 < bestD2) {
            bestD2 = d2;
            best = s;
          }
        }
      }
    }
    return best ? { sample: best, dist: Math.sqrt(bestD2) } : null;
  }

  /** Position + tangent at normalised distance along the path. */
  at(t) {
    const i = clamp(Math.round(t * (this.samples.length - 1)), 0, this.samples.length - 1);
    return this.samples[i];
  }

  /** Sample offset laterally from the centreline (positive = left). */
  offset(t, lateral) {
    const s = this.at(t);
    return new THREE.Vector3(s.x + s.nx * lateral, s.y, s.z + s.nz * lateral);
  }
}

export class RoadNetwork {
  constructor() {
    this.main = new Path('main', MAIN, 13.5);
    this.paths = [
      this.main,
      new Path('bypass', BYPASS, 9.5),
      new Path('spurA', SPUR_A, 7.5),
      new Path('spurB', SPUR_B, 8.0),
    ];

    // Per-path spatial hashes, so terrain generation can ask "how far is the
    // nearest road?" in O(1) and gameplay can ask "am I on the main road?".
    for (const path of this.paths) path.buildGrid(24);
  }

  /** Nearest road sample across the whole network within `radius`, or null. */
  nearest(x, z, radius = 40) {
    let best = null;
    for (const path of this.paths) {
      const hit = path.nearest(x, z, radius);
      if (hit && (!best || hit.dist < best.dist)) best = hit;
    }
    return best;
  }

  /** Fill in road elevations from the raw terrain, then smooth them so the
   *  road reads as a graded, engineered surface instead of following noise. */
  gradeTo(baseHeightFn) {
    for (const path of this.paths) {
      const raw = path.samples.map((s) => baseHeightFn(s.x, s.z));
      const n = raw.length;
      const smoothed = new Array(n);
      const win = Math.round(11 + path.width); // wide window = long, graded curves
      for (let i = 0; i < n; i++) {
        let sum = 0;
        let wsum = 0;
        for (let k = -win; k <= win; k++) {
          const idx = clamp(i + k, 0, n - 1);
          const w = 1 - Math.abs(k) / (win + 1);
          sum += raw[idx] * w;
          wsum += w;
        }
        smoothed[i] = sum / wsum;
      }
      // second pass: clamp gradient so there are no silly ramps
      const maxGrade = 0.12;
      for (let i = 1; i < n; i++) {
        const run = path.samples[i].dist - path.samples[i - 1].dist;
        const d = smoothed[i] - smoothed[i - 1];
        const lim = maxGrade * run;
        if (d > lim) smoothed[i] = smoothed[i - 1] + lim;
        else if (d < -lim) smoothed[i] = smoothed[i - 1] - lim;
      }
      for (let i = 0; i < n; i++) path.samples[i].y = smoothed[i];
    }
  }

  /** Progress of a world position along the *main* road, 0..1. */
  progress(x, z) {
    const hit = this.main.nearest(x, z, 220);
    if (hit) return hit.sample.t;
    return clamp((316 - z) / (316 + 2660), 0, 1);
  }
}
