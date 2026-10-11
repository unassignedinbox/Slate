// City generator: warped block grid, class hierarchy, a grade-separated motorway with a diamond
// interchange, a railway with level crossings and a road bridge, a subway alignment, and the
// surface-condition pass (patches, potholes, calming, works zones).

import { RoadNetwork, resetIds, classRank } from './network.js';
import { defaultProfile, ROAD_CLASS } from './profile.js';
import { makeRailLine, findRailCrossings } from './rail.js';
import { makeRng, fbm2D } from '../core/rng.js';
import { clamp, lerp, v3dist2D, normXZ, v3sub } from '../core/math.js';

export const PRESETS = {
  downtown: {
    label: 'Downtown grid',
    blocksX: 5, blocksZ: 5, cell: 118, curvature: 0.1, arterialEvery: 2,
    highway: true, rail: true, subway: true, parkingDensity: 0.72, damage: 0.4, works: 2,
  },
  riverside: {
    label: 'Riverside bend',
    blocksX: 5, blocksZ: 4, cell: 132, curvature: 0.55, arterialEvery: 3,
    highway: true, rail: true, subway: false, parkingDensity: 0.5, damage: 0.5, works: 1,
  },
  interchange: {
    label: 'Motorway interchange',
    blocksX: 3, blocksZ: 4, cell: 150, curvature: 0.2, arterialEvery: 2,
    highway: true, rail: false, subway: false, parkingDensity: 0.25, damage: 0.3, works: 1,
  },
  industrial: {
    label: 'Industrial + rail',
    blocksX: 4, blocksZ: 4, cell: 160, curvature: 0.18, arterialEvery: 3,
    highway: false, rail: true, subway: false, parkingDensity: 0.3, damage: 0.75, works: 3,
  },
};

export function defaultSettings(preset = 'downtown') {
  return {
    preset,
    seed: 20481,
    ...PRESETS[preset],
    laneWidth: 3.5,
    footway: 1.0,
    cornerRadius: 0,          // 0 = derive from class
    terrain: 0.0,
    calming: true,
    propDensity: 1,
    trafficCount: 18,
    parkedCars: true,
    parkedLimit: 90,
  };
}

export function generateCity(settings) {
  const rng = makeRng(settings.seed);
  resetIds();
  const net = new RoadNetwork();
  const nx = clamp(Math.round(settings.blocksX), 2, 9);
  const nz = clamp(Math.round(settings.blocksZ), 2, 9);
  const cell = settings.cell;
  const warp = settings.curvature;
  const grid = [];

  const terrainY = (x, z) => (settings.terrain || 0) * (fbm2D(x * 0.0022, z * 0.0022, 3, settings.seed) - 0.5) * 2;

  for (let i = 0; i <= nx; i++) {
    grid[i] = [];
    for (let j = 0; j <= nz; j++) {
      const bx = (i - nx / 2) * cell;
      const bz = (j - nz / 2) * cell;
      const wx = (fbm2D(i * 0.7 + 10, j * 0.7, 2, settings.seed) - 0.5) * cell * 0.5 * warp;
      const wz = (fbm2D(i * 0.7, j * 0.7 + 20, 2, settings.seed + 3) - 0.5) * cell * 0.5 * warp;
      const x = bx + wx, z = bz + wz;
      grid[i][j] = net.addNode({ x, y: terrainY(x, z), z }, { tag: `grid${i}_${j}` });
    }
  }

  const classFor = (i, j, axis) => {
    const every = Math.max(2, settings.arterialEvery);
    const major = axis === 'x' ? j % every === 0 : i % every === 0;
    if (major) {
      const spine = axis === 'x' ? j === Math.floor(nz / 2) : i === Math.floor(nx / 2);
      return spine ? ROAD_CLASS.ARTERIAL : ROAD_CLASS.COLLECTOR;
    }
    return ROAD_CLASS.LOCAL;
  };

  const makeProfile = (cls) => {
    const p = defaultProfile(cls);
    p.laneWidth = cls === ROAD_CLASS.HIGHWAY ? Math.max(3.5, settings.laneWidth + 0.15) : settings.laneWidth;
    if (p.footwayL > 0) { p.footwayL *= settings.footway; p.footwayR *= settings.footway; }
    return p;
  };

  const viaFor = (a, b, amount, salt) => {
    if (amount < 0.02) return [];
    const d = v3dist2D(a.p, b.p);
    const dir = normXZ(v3sub(b.p, a.p));
    const right = { x: dir.z, y: 0, z: -dir.x };
    const out = [];
    for (const f of [0.34, 0.66]) {
      const bow = (fbm2D(a.p.x * 0.01 + salt, b.p.z * 0.01, 2, settings.seed + 7) - 0.5) * d * 0.16 * amount;
      out.push({
        x: lerp(a.p.x, b.p.x, f) + right.x * bow,
        y: lerp(a.p.y, b.p.y, f),
        z: lerp(a.p.z, b.p.z, f) + right.z * bow,
      });
    }
    return out;
  };

  const addStreet = (a, b, cls, extra = {}) => {
    const profile = makeProfile(cls);
    if (cls === ROAD_CLASS.LOCAL) {
      profile.parkingL = rng.chance(0.85);
      profile.parkingR = rng.chance(0.85);
    }
    return net.addEdge(a.id, b.id, {
      profile,
      via: viaFor(a, b, warp, cls === ROAD_CLASS.LOCAL ? 3 : 0),
      ...extra,
    });
  };

  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j <= nz; j++) {
      if (i < nx) {
        const cls = classFor(i, j, 'x');
        if (cls !== ROAD_CLASS.LOCAL || rng.chance(0.88)) addStreet(grid[i][j], grid[i + 1][j], cls);
      }
      if (j < nz) {
        const cls = classFor(i, j, 'z');
        if (cls !== ROAD_CLASS.LOCAL || rng.chance(0.88)) addStreet(grid[i][j], grid[i][j + 1], cls);
      }
    }
  }

  // prune orphan nodes
  for (const n of [...net.nodes.values()]) if (n.edges.length === 0) net.removeNode(n.id);

  const bounds = networkBounds(net);
  const meta = { highway: null, rail: [], subway: null };

  // ---------------------------------------------------------------- motorway + diamond interchange
  if (settings.highway) {
    const xH = bounds.max.x + 190;
    const spineJ = Math.floor(nz / 2);
    const arterialRow = grid.map((col) => col[spineJ]).filter(Boolean);
    const east = arterialRow[arterialRow.length - 1];
    const zC = east.p.z;
    const hw = makeProfile(ROAD_CLASS.HIGHWAY);
    const ramp = makeProfile(ROAD_CLASS.RAMP);

    const h = [];
    const zs = [-1, -0.56, -0.26, 0.26, 0.56, 1];
    const len = cell * (nz + 1.4);
    const ys = [0.2, 0.9, 7.6, 7.6, 0.9, 0.2];
    for (let k = 0; k < zs.length; k++) {
      h.push(net.addNode({ x: xH, y: ys[k], z: zC + zs[k] * len * 0.5 }, { tag: `hw${k}`, control: 'none' }));
    }
    for (let k = 0; k < h.length - 1; k++) {
      const elevated = ys[k] > 5 && ys[k + 1] > 5;
      net.addEdge(h[k].id, h[k + 1].id, {
        profile: { ...hw },
        structure: elevated ? 'bridge' : 'ground',
        name: `Motorway ${k}`,
      });
    }
    meta.highway = { nodes: h.map((n) => n.id), x: xH };

    // extend the arterial east, passing beneath the viaduct
    const underA = net.addNode({ x: xH - 95, y: 0, z: zC }, { control: 'signal' });
    const underB = net.addNode({ x: xH + 95, y: 0, z: zC }, { control: 'signal' });
    const arterial = makeProfile(ROAD_CLASS.ARTERIAL);
    net.addEdge(east.id, underA.id, { profile: { ...arterial } });
    net.addEdge(underA.id, underB.id, { profile: { ...arterial }, structure: 'ground', name: 'Underpass' });
    const far = net.addNode({ x: xH + 240, y: 0, z: zC }, {});
    net.addEdge(underB.id, far.id, { profile: { ...arterial } });

    // four diamond ramps
    const rampSpec = [
      { from: h[1], to: underA, bow: -1, dirSign: -1 },
      { from: h[4], to: underA, bow: 1, dirSign: 1 },
      { from: h[1], to: underB, bow: 1, dirSign: -1 },
      { from: h[4], to: underB, bow: -1, dirSign: 1 },
    ];
    for (const r of rampSpec) {
      const a = r.from.p, b = r.to.p;
      const mid1 = { x: a.x + (r.to === underA ? -26 : 26), y: lerp(a.y, b.y, 0.45), z: lerp(a.z, b.z, 0.35) };
      const mid2 = { x: lerp(a.x, b.x, 0.72), y: lerp(a.y, b.y, 0.85), z: lerp(a.z, b.z, 0.82) };
      net.addEdge(r.from.id, r.to.id, {
        profile: { ...ramp },
        via: [mid1, mid2],
        name: 'Ramp',
      });
    }
  }

  // ---------------------------------------------------------------- railway
  const rails = [];
  if (settings.rail) {
    const z0 = bounds.min.z - 90, z1 = bounds.max.z + 90;
    const xr = lerp(bounds.min.x, bounds.max.x, 0.32);
    const pts = [];
    for (let k = 0; k <= 6; k++) {
      const f = k / 6;
      pts.push({
        x: xr + Math.sin(f * 2.2) * cell * 0.22 * (0.4 + warp),
        y: 0.0,
        z: lerp(z0, z1, f),
      });
    }
    const line = makeRailLine(pts, { id: 'rail-main', speed: 19 });
    rails.push(line);
    findRailCrossings(net, line);
    meta.rail.push(line.id);

    // carry the widest crossing road over the railway on a bridge
    let best = null;
    for (const c of line.crossings) {
      const e = net.edges.get(c.edgeId);
      if (!e) continue;
      const rank = classRank[e.profile.class] ?? 0;
      if (!best || rank > best.rank) best = { c, e, rank };
    }
    if (best && best.rank >= 2) {
      const e = best.e;
      const a = net.nodes.get(e.a), b = net.nodes.get(e.b);
      a.p.y = 6.8; b.p.y = 6.8;
      a.elevationLocked = true; b.elevationLocked = true;
      e.structure = 'bridge';
      e.features.railCrossing = null;
      line.crossings = line.crossings.filter((c) => c.edgeId !== e.id);
      // the two neighbouring streets become the approach ramps
      for (const node of [a, b]) {
        for (const eid of node.edges) {
          const nb = net.edges.get(eid);
          if (nb === e) continue;
          const other = net.nodes.get(nb.a === node.id ? nb.b : nb.a);
          if (other.p.y < 1 && !other.elevationLocked) other.p.y = 1.1;
        }
      }
    }
  }

  // ---------------------------------------------------------------- subway alignment
  if (settings.subway) {
    const iMid = Math.floor(nx / 2);
    const path = [];
    for (let j = 0; j <= nz; j++) {
      const n = grid[iMid][j];
      if (n) path.push({ x: n.p.x + 6, y: 0, z: n.p.z });
    }
    if (path.length >= 3) meta.subway = path;
  }

  net.rebuildAllCurves();
  applyConditions(net, settings, rng);

  return { net, rails, subway: meta.subway, meta, bounds: networkBounds(net), rng };
}

/** Surface condition pass: wear, patches, potholes, calming, works zones. */
export function applyConditions(net, settings, rng) {
  const damage = clamp(settings.damage ?? 0.4, 0, 1);
  const edges = [...net.edges.values()];
  for (const e of edges) {
    e.features.potholes.length = 0;
    e.features.patches.length = 0;
    e.features.speedBumps.length = 0;
    e.features.construction.length = 0;
    const L = e.curve.length;
    const band = e.profile.laneWidth * (e.profile.lanesF + e.profile.lanesB) * 0.5;
    e.wear = clamp(0.2 + damage * 0.55 + rng.range(-0.1, 0.1), 0, 1);
    const s0 = e.mouthSA ?? 4, s1 = e.mouthSB ?? L - 4;
    const span = Math.max(0, s1 - s0 - 8);
    if (span < 6) continue;

    const potholeCount = Math.min(6, Math.floor(damage * span / 55 + rng.range(0, 1)));
    for (let i = 0; i < potholeCount; i++) {
      e.features.potholes.push({
        s: s0 + 4 + rng() * span,
        t: rng.range(-band * 0.85, band * 0.85),
        r: rng.range(0.32, 0.95),
        depth: rng.range(0.035, 0.1) * (0.5 + damage),
      });
    }
    const patchCount = Math.min(8, Math.floor(damage * span / 40 + rng.range(0, 1.5)));
    for (let i = 0; i < patchCount; i++) {
      e.features.patches.push({
        s: s0 + 4 + rng() * span,
        t: rng.range(-band * 0.9, band * 0.9),
        length: rng.range(1.6, 6.5),
        width: rng.range(0.9, 2.8),
        kind: rng.chance(0.5) ? 'overband' : 'patch',
      });
    }
    if (settings.calming && e.profile.class === ROAD_CLASS.LOCAL && span > 45 && rng.chance(0.4)) {
      const n = rng.int(1, 2);
      for (let i = 1; i <= n; i++) {
        e.features.speedBumps.push({
          s: s0 + (span * i) / (n + 1) + 4,
          length: rng.chance(0.35) ? 7.5 : 3.8,
          height: rng.range(0.075, 0.11),
          type: rng.chance(0.35) ? 'table' : 'hump',
        });
      }
    }
  }

  // works zones on a handful of roads
  const candidates = edges.filter((e) => (e.mouthSB - e.mouthSA) > 60 && e.structure === 'ground');
  rng.shuffle(candidates);
  for (let i = 0; i < Math.min(settings.works ?? 1, candidates.length); i++) {
    const e = candidates[i];
    const s0 = e.mouthSA + 18 + rng() * ((e.mouthSB - e.mouthSA) - 48);
    const band = e.profile.laneWidth * (e.profile.lanesF + e.profile.lanesB) * 0.5;
    const side = rng.chance(0.5) ? -1 : 1;
    const t0 = side < 0 ? -band + 0.4 : band * 0.1;
    e.features.construction.push({
      s0, s1: s0 + rng.range(10, 24),
      t0, t1: t0 + rng.range(2.6, 3.8),
      depth: rng.range(0.4, 0.7),
      kind: 'trench',
    });
  }

  // junction control policy
  for (const n of net.nodes.values()) {
    if (n.edges.length < 3) { n.control = 'none'; continue; }
    if (n.control !== 'auto' && n.control !== 'none') continue;
    let maxRank = 0, minRank = 9;
    for (const eid of n.edges) {
      const r = classRank[net.edges.get(eid).profile.class] ?? 1;
      maxRank = Math.max(maxRank, r);
      minRank = Math.min(minRank, r);
    }
    n.control = maxRank >= 3 ? 'signal' : maxRank >= 2 ? (n.edges.length >= 4 ? 'signal' : 'stop') : 'stop';
  }
}

export function networkBounds(net) {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const n of net.nodes.values()) {
    min.x = Math.min(min.x, n.p.x); max.x = Math.max(max.x, n.p.x);
    min.y = Math.min(min.y, n.p.y); max.y = Math.max(max.y, n.p.y);
    min.z = Math.min(min.z, n.p.z); max.z = Math.max(max.z, n.p.z);
  }
  if (!Number.isFinite(min.x)) return { min: { x: -100, y: 0, z: -100 }, max: { x: 100, y: 0, z: 100 } };
  return { min, max };
}
