// Turns a Network into triangle buckets. Pure (no three.js), so it is unit-tested
// and runs the same way in the browser and in Node.
import { V3, V, Sampled, resample, smoothPath, at, nearest, segIntersect, perpRight, dist2 } from '../core/geometry';
import {
  Road, Network, Lane, LaneKind, LANE_RAISE, laneBands, roadWidth, Prop, PROP_INFO,
} from '../core/model';
import { MeshBuilder } from './builder';
import { Frame, framesAll, framesRange, strip, wall, lineMarking, arrow } from './frames';

export interface Junction {
  p: V3;
  radius: number;
  roadId: string;
  atStart: boolean;
}

export interface NetworkMesh {
  builder: MeshBuilder;
  sampled: Map<string, Sampled>;
  junctions: Junction[];
  crossings: { p: V3; roadId: string; railId: string }[];
  stats: { roads: number; props: number; triangles: number };
}

const STEP: Record<string, number> = { road: 2.5, path: 2.5, rail: 2, subway: 4 };

export function sampleRoad(road: Road): Sampled {
  // Straight (non-smooth) polylines are exact between their control points, so they only
  // need coarse samples; curved ones are densified along the Catmull-Rom spline.
  if (!road.smooth) {
    const coarse = road.category === 'subway' ? 4 : 20;
    return resample(road.points.map((p) => V(p.x, p.y, p.z)), coarse);
  }
  const dense = smoothPath(road.points, 8);
  return resample(dense, STEP[road.category] ?? 2.5);
}

/** Surface material for a lane kind. */
export function laneMaterial(kind: LaneKind, surface: string): string {
  switch (kind) {
    case 'driving':
    case 'parking':
      return `surf_${surface}`;
    case 'pedestrian':
      return `surf_${surface === 'asphalt' ? 'paving' : surface}`;
    case 'bus':
      return 'bus';
    case 'bike':
      return 'bike';
    case 'shoulder':
      return 'gravel';
    case 'sidewalk':
      return 'sidewalk';
    case 'median':
      return 'grass';
  }
}

function markingKind(L: Lane, R: Lane): 'yellow' | 'white-dash' | 'white-solid' | null {
  const rl = LANE_RAISE[L.kind] > 0;
  const rr = LANE_RAISE[R.kind] > 0;
  if (rl || rr) return null; // the curb itself is the boundary
  if (L.kind === 'pedestrian' && R.kind === 'pedestrian') return null;
  if (L.kind === 'parking' && R.kind === 'parking') return null;
  const motor = (k: LaneKind) => k === 'driving' || k === 'bus' || k === 'bike';
  if (motor(L.kind) && motor(R.kind)) {
    if (L.dir !== 0 && R.dir !== 0 && L.dir * R.dir === -1) return 'yellow';
    if (L.dir === R.dir && L.kind === 'driving' && R.kind === 'driving') return 'white-dash';
    return 'white-solid';
  }
  return 'white-solid';
}

export function buildNetwork(net: Network): NetworkMesh {
  const mb = new MeshBuilder();
  const sampled = new Map<string, Sampled>();
  const roadsById = new Map<string, Road>();
  for (const r of net.roads) {
    roadsById.set(r.id, r);
    sampled.set(r.id, sampleRoad(r));
  }

  // ---- Road cross-sections ---------------------------------------------------------
  for (const road of net.roads) {
    const S = sampled.get(road.id)!;
    if (S.length < 0.5) continue;
    if (road.category === 'road' || road.category === 'path') buildCarriageway(mb, road, S);
    if (road.category === 'rail') buildRailway(mb, S);
    if (road.category === 'subway') {
      const under = S.pts.map((p) => V(p.x, p.y - 7, p.z));
      mb.tube('tunnel', under, 3.2, 12);
    }
  }

  // ---- Junctions and zebra crossings -----------------------------------------------
  const junctions = findJunctions(net.roads, sampled);
  for (const j of junctions) {
    const ring: V3[] = [];
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      ring.push(V(j.p.x + Math.cos(a) * j.radius, j.p.y + 0.004, j.p.z + Math.sin(a) * j.radius));
    }
    mb.poly('surf_asphalt', ring, V(0, 1, 0));
    const road = roadsById.get(j.roadId)!;
    const S = sampled.get(road.id)!;
    if (hasCarriageway(road) && S.length > 14) {
      const sz = j.atStart ? 4.5 : S.length - 4.5;
      buildZebra(mb, road, S, sz);
    }
  }

  // ---- Rail crossings (derived from road x railway intersections) --------------------
  const crossings: NetworkMesh['crossings'] = [];
  const rails = net.roads.filter((r) => r.category === 'rail');
  const CELL = 40;
  for (const rail of rails) {
    const RS = sampled.get(rail.id)!;
    // Spatial hash of rail segments (by midpoint cell) so each road segment only tests nearby rail.
    const cells = new Map<string, number[]>();
    const ck = (x: number, z: number) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
    for (let k = 0; k < RS.pts.length - 1; k++) {
      const key = ck((RS.pts[k].x + RS.pts[k + 1].x) / 2, (RS.pts[k].z + RS.pts[k + 1].z) / 2);
      let arr = cells.get(key);
      if (!arr) cells.set(key, (arr = []));
      arr.push(k);
    }
    for (const road of net.roads) {
      if (!hasCarriageway(road)) continue;
      const S = sampled.get(road.id)!;
      for (let i = 0; i < S.pts.length - 1; i++) {
        const a = S.pts[i];
        const b = S.pts[i + 1];
        const x0 = Math.floor(Math.min(a.x, b.x) / CELL) - 1;
        const x1 = Math.floor(Math.max(a.x, b.x) / CELL) + 1;
        const z0 = Math.floor(Math.min(a.z, b.z) / CELL) - 1;
        const z1 = Math.floor(Math.max(a.z, b.z) / CELL) + 1;
        for (let cx = x0; cx <= x1; cx++) {
          for (let cz = z0; cz <= z1; cz++) {
            for (const k of cells.get(`${cx},${cz}`) ?? []) {
              const hit = segIntersect(a, b, RS.pts[k], RS.pts[k + 1]);
              if (!hit) continue;
              const p = V(a.x + (b.x - a.x) * hit.t, 0, a.z + (b.z - a.z) * hit.t);
              p.y = at(S, S.s[i] + (S.s[i + 1] - S.s[i]) * hit.t).p.y;
              const hr = nearest(S, p);
              if (!hr || hr.s < 8 || hr.s > S.length - 8) continue;
              if (crossings.some((c) => dist2(c.p, p) < 12)) continue;
              crossings.push({ p, roadId: road.id, railId: rail.id });
              const railHit = nearest(RS, p);
              if (railHit) buildRailCrossing(mb, road, S, p, railHit.t);
            }
          }
        }
      }
    }
  }

  // ---- Props ---------------------------------------------------------------------------
  let propCount = 0;
  for (const prop of net.props) {
    const road = roadsById.get(prop.roadId);
    const S = sampled.get(prop.roadId);
    if (!road || !S) continue;
    propCount++;
    placeProp(mb, road, S, prop);
  }

  let triangles = 0;
  for (const b of mb.buckets.values()) triangles += b.idx.length / 3;
  return {
    builder: mb,
    sampled,
    junctions,
    crossings,
    stats: { roads: net.roads.length, props: propCount, triangles: Math.round(triangles) },
  };
}

function hasCarriageway(road: Road): boolean {
  return road.lanes.some((l) => l.kind === 'driving' || l.kind === 'bus' || l.kind === 'bike' || l.kind === 'parking');
}

function buildCarriageway(mb: MeshBuilder, road: Road, S: Sampled): void {
  const bands = laneBands(road.lanes);
  if (bands.length === 0) return;
  const rows = framesAll(S, 0);
  const W = roadWidth(road);

  // Lane surfaces
  for (const { lane, a, b } of bands) {
    const lift = LANE_RAISE[lane.kind];
    const r = lift > 0 ? framesAll(S, lift) : rows;
    strip(mb, laneMaterial(lane.kind, road.surface), r, a, b);
  }

  // Curb faces where neighbouring heights differ; outer edges too.
  for (let i = 0; i < bands.length; i++) {
    const cur = bands[i];
    const hCur = LANE_RAISE[cur.lane.kind];
    const next = bands[i + 1];
    if (next) {
      const hNext = LANE_RAISE[next.lane.kind];
      if (hCur > hNext) wall(mb, 'curb', framesAll(S, 0), cur.b, hNext, hCur, 1);
      else if (hNext > hCur) wall(mb, 'curb', framesAll(S, 0), next.a, hCur, hNext, -1);
    } else if (hCur > 0) {
      wall(mb, 'curb', framesAll(S, 0), cur.b, 0, hCur, 1);
    }
  }
  if (bands[0] && LANE_RAISE[bands[0].lane.kind] > 0) {
    wall(mb, 'curb', framesAll(S, 0), bands[0].a, 0, LANE_RAISE[bands[0].lane.kind], -1);
  }

  // Lane boundary markings
  for (let i = 0; i < bands.length - 1; i++) {
    const L = bands[i].lane;
    const R = bands[i + 1].lane;
    const off = bands[i].b;
    const kind = markingKind(L, R);
    if (!kind) continue;
    if (kind === 'yellow') {
      const sep = road.preset === 'highway' ? 0.2 : 0;
      if (sep) {
        lineMarking(mb, 'paint_yellow', S, off - sep, 0.12, 0.012);
        lineMarking(mb, 'paint_yellow', S, off + sep, 0.12, 0.012);
      } else {
        lineMarking(mb, 'paint_yellow', S, off, 0.15, 0.012);
      }
    } else if (kind === 'white-dash') {
      lineMarking(mb, 'paint_white', S, off, 0.12, 0.012, 3, 6);
    } else {
      lineMarking(mb, 'paint_white', S, off, 0.15, 0.012);
    }
  }

  // Outer edge lines for carriageway-edge (driving next to shoulder / sidewalk handled by curb).
  for (const band of bands) {
    if (band.lane.kind === 'shoulder' && bands.length > 1) {
      lineMarking(mb, 'paint_white', S, band.lane === bands[0].lane ? band.b : band.a, 0.15, 0.012);
    }
  }

  // Parking bays (perpendicular lines), arrows
  for (const band of bands) {
    const lane = band.lane;
    if (lane.kind === 'parking') {
      const bayLen = 5.5;
      for (let s = 2; s < S.length - 1; s += bayLen) {
        const h = at(S, s);
        const p = (x: number, c: number): V3 => V(h.p.x + h.n.x * c + h.t.x * x, h.p.y + 0.012, h.p.z + h.n.z * c + h.t.z * x);
        const bayA = band.a + 0.1;
        const bayB = band.b;
        mb.poly('paint_white', [p(-0.06, bayA), p(0.06, bayA), p(0.06, bayB), p(-0.06, bayB)]);
      }
    }
    if ((lane.kind === 'driving' || lane.kind === 'bus' || lane.kind === 'bike') && lane.dir !== 0 && lane.width >= 2.4) {
      const c = (band.a + band.b) / 2;
      const spacing = lane.kind === 'driving' ? 28 : 22;
      for (let s = 14; s < S.length - 6; s += spacing) {
        arrow(mb, 'paint_white', S, s, c, lane.dir, 0.014);
      }
    }
  }
}

function buildZebra(mb: MeshBuilder, road: Road, S: Sampled, sz: number): void {
  const bands = laneBands(road.lanes);
  const carriage = bands.filter((b) => LANE_RAISE[b.lane.kind] === 0);
  if (carriage.length === 0) return;
  const a0 = carriage[0].a;
  const a1 = carriage[carriage.length - 1].b;
  const s0 = sz - 1.5;
  const s1 = sz + 1.5;
  const h0 = at(S, s0);
  const h1 = at(S, s1);
  for (let x = a0 + 0.4; x + 0.5 <= a1 - 0.4; x += 1.0) {
    const xa = x;
    const xb = x + 0.5;
    const P = (h: ReturnType<typeof at>, c: number): V3 => V(h.p.x + h.n.x * c, h.p.y + 0.014, h.p.z + h.n.z * c);
    mb.poly('paint_white', [P(h0, xa), P(h1, xa), P(h1, xb), P(h0, xb)]);
  }
}

function findJunctions(roads: Road[], sampled: Map<string, Sampled>): Junction[] {
  const CELL = 20;
  const grid = new Map<string, { roadId: string; p: V3; half: number }[]>();
  const key = (x: number, z: number) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
  const carriageRoads = roads.filter((r) => r.category === 'road' || r.category === 'path');
  for (const r of carriageRoads) {
    const S = sampled.get(r.id)!;
    const half = roadWidth(r) / 2;
    for (let k = 0; k < S.pts.length; k += 2) {
      const k2 = key(S.pts[k].x, S.pts[k].z);
      let arr = grid.get(k2);
      if (!arr) grid.set(k2, (arr = []));
      arr.push({ roadId: r.id, p: S.pts[k], half });
    }
  }
  const out: Junction[] = [];
  for (const r of carriageRoads) {
    const S = sampled.get(r.id)!;
    if (S.length < 0.5) continue;
    const half = roadWidth(r) / 2;
    const ends: [V3, boolean][] = [
      [S.pts[0], true],
      [S.pts[S.pts.length - 1], false],
    ];
    for (const [e, atStart] of ends) {
      let touching = false;
      let radius = half;
      const cx = Math.floor(e.x / CELL);
      const cz = Math.floor(e.z / CELL);
      for (let dx = -1; dx <= 1 && !touching; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          for (const c of grid.get(`${cx + dx},${cz + dz}`) ?? []) {
            if (c.roadId === r.id) continue;
            const d = dist2(c.p, e);
            if (d < 2.0 + c.half * 0.5) {
              touching = true;
              radius = Math.max(radius, c.half);
            }
          }
        }
      }
      if (touching) out.push({ p: V(e.x, e.y, e.z), radius: radius + 0.4, roadId: r.id, atStart });
    }
  }
  return out;
}

function buildRailway(mb: MeshBuilder, S: Sampled): void {
  const ballast = framesAll(S, 0.02);
  strip(mb, 'ballast', ballast, -1.9, 1.9);
  const rails = framesAll(S, 0.14);
  strip(mb, 'steel', rails, -0.79, -0.65);
  strip(mb, 'steel', rails, 0.65, 0.79);
  for (let s = 0; s < S.length; s += 0.65) {
    const h = at(S, s);
    mb.box('sleeper', V(h.p.x, h.p.y + 0.06, h.p.z), h.t, 0.13, 0.07, 1.5);
  }
}

function buildRailCrossing(mb: MeshBuilder, road: Road, S: Sampled, p: V3, railT: V3): void {
  const W = roadWidth(road);
  const hr = nearest(S, p);
  if (!hr) return;
  const t = hr.t;
  const n = perpRight(t);
  // Rubber crossing pad between the rails across the carriageway.
  const r = railT;
  const pad = (a: number, b: number): V3 => V(p.x + t.x * a + r.x * b, p.y + 0.03, p.z + t.z * a + r.z * b);
  mb.poly('crossing_pad', [pad(-W / 2, -1.2), pad(W / 2, -1.2), pad(W / 2, 1.2), pad(-W / 2, 1.2)]);

  // Gates on both approaches: a boom spanning the road plus two posts at the kerbs.
  for (const sigma of [-1, 1]) {
    const dd = 6.0 * sigma;
    const c = V(p.x + t.x * dd, p.y, p.z + t.z * dd);
    const halfSpan = W / 2 + 0.6;
    for (const side of [-1, 1]) {
      const post = V(c.x + n.x * halfSpan * side, c.y, c.z + n.z * halfSpan * side);
      mb.cylinder('pole', post, 0.09, 1.3, 8);
      mb.cylinder('lamp_red', V(post.x, post.y + 1.3, post.z), 0.18, 0.18, 8);
    }
    // Boom arm, lowered to 1.1 m, spans the lanes.
    const boomCentre = V(c.x, c.y + 1.1, c.z);
    mb.box('gate', boomCentre, n, halfSpan, 0.07, 0.07);
  }
}

function placeProp(mb: MeshBuilder, road: Road, S: Sampled, prop: Prop): void {
  const info = PROP_INFO[prop.kind];
  const positions: number[] = [];
  if (prop.length > 0 && info.spacing > 0) {
    for (let s = prop.s; s <= prop.s + prop.length + 1e-6; s += info.spacing) positions.push(s);
  } else {
    positions.push(prop.s);
  }
  const bands = laneBands(road.lanes);
  for (const s of positions) {
    const h = at(S, s);
    const base = V(h.p.x + h.n.x * prop.offset, h.p.y, h.p.z + h.n.z * prop.offset);
    switch (prop.kind) {
      case 'bollard': {
        mb.cylinder('bollard_white', base, 0.13, 0.78, 8);
        mb.cylinder('bollard_yellow', V(base.x, base.y + 0.78, base.z), 0.135, 0.12, 8);
        mb.cylinder('pole', V(base.x, base.y, base.z), 0.14, 0.04, 8); // base plate
        break;
      }
      case 'streetlight': {
        mb.cylinder('pole', base, 0.09, 6.5, 6);
        const arm = V(base.x - h.n.x * 0.9 * Math.sign(prop.offset || 1), base.y + 6.3, base.z - h.n.z * 0.9 * Math.sign(prop.offset || 1));
        mb.box('pole', arm, h.n, 0.9, 0.06, 0.06);
        mb.box('lamp', V(arm.x, arm.y - 0.12, arm.z), h.t, 0.35, 0.08, 0.2);
        break;
      }
      case 'busstop': {
        const c = V(base.x, base.y, base.z);
        const up = (y: number) => V(c.x, c.y + y, c.z);
        mb.box('glass', up(1.6), h.t, 2.2, 1.0, 0.03);
        mb.box('shelter', up(2.85), h.t, 2.45, 0.07, 1.15);
        for (const sa of [-1, 1]) for (const sc of [-1, 1]) {
          const q = V(c.x + h.t.x * 2.2 * sa + h.n.x * 1.1 * sc, c.y + 1.45, c.z + h.t.z * 2.2 * sa + h.n.z * 1.1 * sc);
          mb.box('pole', q, h.t, 0.05, 1.45, 0.05);
        }
        mb.box('bench', up(0.45), h.t, 1.0, 0.05, 0.25);
        mb.cylinder('pole', V(c.x + h.t.x * 2.9, c.y, c.z + h.t.z * 2.9), 0.06, 2.5, 8);
        mb.box('bus_sign', V(c.x + h.t.x * 2.9, c.y + 2.5, c.z + h.t.z * 2.9), h.t, 0.02, 0.3, 0.25);
        break;
      }
      case 'speedbump': {
        const carriage = bands.filter((b) => LANE_RAISE[b.lane.kind] === 0);
        if (carriage.length === 0) break;
        const a0 = carriage[0].a;
        const a1 = carriage[carriage.length - 1].b;
        const ext = 0.45;
        const rows: Frame[] = [];
        for (let x = -ext; x <= ext + 1e-6; x += 0.05) {
          const hh = at(S, s + x);
          const bump = 0.09 * (0.5 + 0.5 * Math.cos((Math.PI * x) / ext));
          rows.push({ p: hh.p, n: hh.n, t: hh.t, y: hh.p.y + bump });
        }
        strip(mb, 'bump', rows, a0, a1);
        break;
      }
      case 'station': {
        const c = base;
        mb.box('station', V(c.x, c.y + 1.6, c.z), h.t, 2.0, 1.6, 1.6);
        mb.box('metro', V(c.x, c.y + 3.5, c.z), h.t, 1.0, 0.25, 0.9);
        mb.cylinder('pole', V(c.x + h.n.x * 2.2, c.y, c.z + h.n.z * 2.2), 0.08, 3.2, 8);
        break;
      }
    }
  }
}
