//==================================================================================================
//  ROADEDITOR — NETWORK MODEL AND TOPOLOGY PASSES
//==================================================================================================
//  The network is the single source of truth: roads, junction nodes, railways, subway lines, water
//  and blocks. Geometry is derived from it, never edited in place.
//
//  Build order (see buildNetwork):
//    1. sample      control points -> adaptive path
//    2. attach      dangling ends snap or extend onto the nearest carriageway
//    3. intersect   carriageway-to-carriageway crossings become junctions or grade separations
//    4. stitch      ends that landed on top of each other weld into one node; collinear pairs merge
//    5. grade       terrain elevation, then the bridge lifts for water, rail and grade separations
//    6. junction    cut distances, trimmed arms, fillet radii, control type
//    7. validate    the report the Validation panel shows verbatim
//
//  Every road end that carries a node is trimmed back by its cut distance, so two arms of a
//  junction can never overlap: what is left between the cut lines is the junction surface, built in
//  junction.js from the same cross-sections. That is what keeps the topology clean.
//==================================================================================================

import { clamp, lerp, Rng, SegmentGrid, dist2, norm2 } from './core.js';
import { sampleControlPoints, resampleAdaptive, pathLength, subPath, curvatureAt, smoothPath, alongPath } from './spline.js';
import { PROFILES, CLASS_DEFAULT, CLASS_FAMILY, sectionOf, halfWidthOf } from './profiles.js';

let nextId = 1;
export const newId = (p = 'x') => `${p}${nextId++}`;

export class Road {
  constructor(cfg = {}) {
    this.id = cfg.id || newId('r');
    this.name = cfg.name || '';
    this.cls = cfg.cls || 'local';
    this.profileId = cfg.profileId || CLASS_DEFAULT[this.cls] || 'residential-1x1';
    this.profile = cfg.profile || PROFILES[this.profileId] || PROFILES['residential-1x1'];
    this.ctrl = (cfg.ctrl || []).map((p) => ({ x: p.x, y: p.y, z: p.z ?? 0 }));
    this.path = (cfg.path || []).map((p) => ({ x: p.x, y: p.y, z: p.z ?? 0 }));
    this.closedLoop = !!cfg.closedLoop;
    this.oneway = cfg.oneway ?? this.profile.oneWay ?? false;
    this.districtId = cfg.districtId ?? null;
    this.order = cfg.order ?? 0;
    this.tags = cfg.tags || {};
    this.startNode = null;
    this.endNode = null;
    this.cuts = { a: 0, b: 0 };
    this.bridges = []; // { s0, s1, kind, clearance, ramp }
    this.rail = !!cfg.rail;
    this.subway = !!cfg.subway;
    this.length = pathLength(this.path, this.closedLoop);
  }
  get family() {
    return CLASS_FAMILY[this.cls] ?? 2;
  }
  get halfWidth() {
    return this.profile ? halfWidthOf(this.profile) : 3.5;
  }
  get hasSidewalk() {
    return !!(this.profile && sectionOf(this.profile).hasSidewalk);
  }
  sample(minSpacing = 2.5, maxSpacing = 9) {
    let pts;
    if (this.ctrl.length >= 2) {
      const dense = sampleControlPoints(this.ctrl, this.closedLoop, 12);
      pts = resampleAdaptive(smoothPath(dense, 1, this.closedLoop), minSpacing, maxSpacing, 24, this.closedLoop);
    } else pts = this.path.map((p) => ({ ...p }));
    this.setPath(pts);
    return this;
  }
  setPath(pts) {
    this.path = pts;
    this.length = pathLength(pts, this.closedLoop);
    return this;
  }
  /** A road is "on structure" where it stands more than 1.4 m above natural ground. */
  structureSpans(terrain) {
    const spans = [];
    if (!terrain) return spans;
    let open = null;
    for (let i = 0; i < this.path.length; i++) {
      const p = this.path[i];
      const above = (p.z ?? 0) - terrain.height(p.x, p.y) > 1.4;
      const s = arcLengthIndex(this.path, i);
      if (above && !open) open = { s0: s, s1: s };
      else if (above) open.s1 = s;
      else if (open) {
        if (open.s1 - open.s0 > 6) spans.push(open);
        open = null;
      }
    }
    if (open && open.s1 - open.s0 > 6) spans.push(open);
    return spans;
  }
}

export class JunctionNode {
  constructor(x, y, z = 0) {
    this.id = newId('j');
    this.x = x;
    this.y = y;
    this.z = z;
    this.arms = []; // { roadId, which, road, outward:{x,y}, angle, halfWidth, lanes, cls, oneway }
    this.kind = 'cross';
    this.control = 'none';
    this.fillet = 8;
    this.roundabout = false;
    this.roundaboutRadius = 0;
    this.trim = {};
    this.width = 0;
    this.gradeSep = false;
    this.crossings = [];
  }
}

export class Railway {
  constructor(cfg = {}) {
    this.id = newId('rail');
    this.name = cfg.name || '';
    this.ctrl = cfg.ctrl || [];
    this.path = [];
    this.length = 0;
    this.crossings = []; // { s, point, angleDeg, kind }
    this.stations = cfg.stations || [];
    this.electrified = cfg.electrified ?? true;
    this.sample();
  }
  sample() {
    const dense = sampleControlPoints(this.ctrl, false, 12);
    this.path = resampleAdaptive(smoothPath(dense, 1, false), 2.0, 8, 24, false);
    this.length = pathLength(this.path, false);
    return this;
  }
}

export class SubwayLine {
  constructor(cfg = {}) {
    this.id = newId('sub');
    this.name = cfg.name || '';
    this.colour = cfg.colour || '#d2533f';
    this.ctrl = cfg.ctrl || [];
    this.path = [];
    this.length = 0;
    this.depth = cfg.depth ?? 16;
    this.stations = [];
    this.sample();
  }
  sample() {
    const dense = sampleControlPoints(this.ctrl, false, 12);
    this.path = resampleAdaptive(smoothPath(dense, 2, false), 4, 16, 40, false);
    this.length = pathLength(this.path, false);
    return this;
  }
}

//--------------------------------------------------------------------------------------------------
//  Network container
//--------------------------------------------------------------------------------------------------
export class RoadNetwork {
  constructor(extent = 3000) {
    this.extent = extent;
    this.roads = [];
    this.nodes = [];
    this.railways = [];
    this.subways = [];
    this.blocks = [];
    this.water = null;
    this.districts = [];
    this.terrain = null;
    this.meta = { seed: 1, generated: 0 };
    this._grid = null;
    this.dirty = true;
  }
  addRoad(cfg) {
    const r = cfg instanceof Road ? cfg : new Road(cfg);
    if (!r.path.length) r.sample();
    this.roads.push(r);
    return r;
  }
  addNode(x, y, z = 0) {
    const n = new JunctionNode(x, y, z);
    this.nodes.push(n);
    return n;
  }
  removeRoad(road) {
    const i = this.roads.indexOf(road);
    if (i >= 0) this.roads.splice(i, 1);
  }
  roadById(id) {
    return this.roads.find((r) => r.id === id);
  }
  buildIndex(cell = 48) {
    const grid = new SegmentGrid(cell);
    for (const r of this.roads) {
      const p = r.path;
      for (let i = 0; i < p.length - 1; i++) grid.insert({ r, i }, p[i].x, p[i].y, p[i + 1].x, p[i + 1].y);
    }
    this._grid = grid;
    return grid;
  }
  stats() {
    const laneKm = this.roads.reduce((s, r) => s + (r.length * (r.profile ? sectionOf(r.profile).lanes.length : 2)) / 1000, 0);
    const sidewalkKm = this.roads.reduce((s, r) => s + (r.profile && sectionOf(r.profile).hasSidewalk ? (r.length * 2) / 1000 : 0), 0);
    const kerbKm = this.roads.reduce((s, r) => s + ((r.profile ? sectionOf(r.profile).kerbBands.length : 0) * r.length) / 1000, 0);
    const bridgeKm = this.roads.reduce((s, r) => s + r.bridges.reduce((t, b) => t + (b.s1 - b.s0), 0) / 1000, 0);
    const byClass = {};
    for (const r of this.roads) byClass[r.cls] = (byClass[r.cls] || 0) + 1;
    return {
      roads: this.roads.length,
      nodes: this.nodes.length,
      roadKm: this.roads.reduce((s, r) => s + r.length, 0) / 1000,
      laneKm,
      kerbKm,
      sidewalkKm,
      bridgeKm,
      railRoads: this.railways.length,
      railKm: this.railways.reduce((s, r) => s + r.length, 0) / 1000,
      subwayKm: this.subways.reduce((s, r) => s + r.length, 0) / 1000,
      stations: this.subways.reduce((s, r) => s + r.stations.length, 0),
      blocks: this.blocks.length,
      crossings: this.railways.reduce((s, r) => s + r.crossings.length, 0),
      byClass,
    };
  }
}

//--------------------------------------------------------------------------------------------------
//  Pass 1 — sampling
//--------------------------------------------------------------------------------------------------
export function sampleNetwork(net) {
  for (const r of net.roads) {
    if (r.ctrl.length >= 2) r.sample();
    else r.setPath(r.path.map((p) => ({ ...p })));
  }
  return net;
}

//--------------------------------------------------------------------------------------------------
//  Node requests. Both attachment and crossing passes describe their junctions as a point plus the
//  road arms that meet there; createNodes() turns requests into JunctionNode records afterwards.
//--------------------------------------------------------------------------------------------------
function request(point, arms, extra = {}) {
  return { point: { x: point.x, y: point.y, z: point.z ?? 0 }, arms, ...extra };
}

//--------------------------------------------------------------------------------------------------
//  Pass 2 — attachment
//--------------------------------------------------------------------------------------------------
export function attachEnds(net, opts = {}) {
  // The generator solves its street ends against the corridor centreline exactly, so this pass is a
  // weld, not a search: anything further away than a sampling step is a genuine dead end.
  // Two radii: the generator's solves land on their target exactly, so anything within a metre is a
  // weld. Anything up to `reach` is a street end whose region boundary was not a carriageway (the
  // edge of the map, or a block face that no cut ever opened) — a short spur reaches that one.
  const snapDist = opts.snap ?? 1.5;
  const reach = opts.reach ?? 26;
  net.buildIndex();
  const grid = net._grid;
  const candidates = [];

  for (const road of net.roads.slice()) {
    if (road.closedLoop || road.path.length < 3) continue;
    // A cul-de-sac, a hairpin spur or a service stub is supposed to stop. The head of a cul-de-sac
    // is a turning head in the middle of a block: stretching that to the nearest street is the
    // difference between a map and a spider web. Its stem still has to connect, so only the far end
    // is exempt.
    const isCulDeSac = !!(road.tags && road.tags.culDeSac);
    const closedEnd = isCulDeSac ? 'b' : road.tags && (road.tags.spur || road.tags.deadEnd) ? 'both' : null;
    for (const which of ['a', 'b']) {
      if (closedEnd === 'both' || closedEnd === which) continue;
      const path = road.path;
      const end = which === 'a' ? path[0] : path[path.length - 1];
      const inner = which === 'a' ? path[Math.min(2, path.length - 1)] : path[Math.max(0, path.length - 3)];
      const dir = norm2({ x: end.x - inner.x, y: end.y - inner.y });
      let best = null;
      grid.query(end.x - reach, end.y - reach, end.x + reach, end.y + reach, (item) => {
        const other = item.r;
        if (other === road || other.closedLoop) return;
        if (other.family < road.family - 1) return; // never hang a street off a footpath
        const a = other.path[item.i];
        const b = other.path[item.i + 1];
        const hit = segSegProjection(end, dir, a, b, reach);
        if (!hit) return;
        if (hit.dist > reach) return;
        if (!best || hit.dist < best.dist) best = { hit, other, i: item.i };
      });
      if (!best) continue;
      const target = best.hit.point;
      let s = 0;
      for (let i = 0; i < best.i; i++) s += dist2(best.other.path[i], best.other.path[i + 1]);
      s += dist2(best.other.path[best.i], target);
      if (s < 2 || s > best.other.length - 2) continue;
      const snapped = best.hit.dist <= snapDist;
      if (snapped) {
        if (which === 'a') path[0] = { x: target.x, y: target.y, z: path[0].z };
        else path[path.length - 1] = { x: target.x, y: target.y, z: path[path.length - 1].z };
      } else {
        const stub = { x: target.x, y: target.y, z: which === 'a' ? path[0].z : path[path.length - 1].z };
        if (which === 'a') path.unshift(stub);
        else path.push(stub);
      }
      road.setPath(path);
      candidates.push({ road, which, target, other: best.other, s, point: { x: target.x, y: target.y, z: 0 } });
    }
  }
  // Second phase: ends that the directional search above could not serve. A street that finished
  // inside a block — a cul-de-sac stem picked off a boundary, a short cut whose target corridor
  // turned away — is joined to the nearest carriageway instead of being left floating. Bounded to
  // 30 m so this can never reach across a block and invent a road.
  const rescue = opts.rescue ?? 30;
  for (const road of net.roads.slice()) {
    if (road.closedLoop || road.path.length < 2) continue;
    if (candidates.some((c) => c.road === road)) continue;
    for (const which of ['a', 'b']) {
      const path = road.path;
      const end = which === 'a' ? path[0] : path[path.length - 1];
      if (candidates.some((c) => c.road === road && c.which === which)) continue;
      let best = null;
      grid.query(end.x - rescue, end.y - rescue, end.x + rescue, end.y + rescue, (item) => {
        const other = item.r;
        if (other === road || other.closedLoop) return;
        if (other.family < road.family - 1) return;
        const a = other.path[item.i];
        const b = other.path[item.i + 1];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const l2 = dx * dx + dy * dy || 1e-9;
        const t = clamp(((end.x - a.x) * dx + (end.y - a.y) * dy) / l2, 0, 1);
        const px = a.x + dx * t;
        const py = a.y + dy * t;
        const d = Math.hypot(px - end.x, py - end.y);
        if (d < 0.4 || d > rescue) return;
        if (!best || d < best.d) best = { d, point: { x: px, y: py, z: lerp(a.z ?? 0, b.z ?? 0, t) }, other, i: item.i, t };
      });
      if (!best) continue;
      let s = 0;
      for (let i = 0; i < best.i; i++) s += dist2(best.other.path[i], best.other.path[i + 1]);
      s += dist2(best.other.path[best.i], best.point);
      if (s < 2 || s > best.other.length - 2) continue;
      const stub = { x: best.point.x, y: best.point.y, z: end.z };
      if (best.d <= snapDist) {
        if (which === 'a') path[0] = stub;
        else path[path.length - 1] = stub;
      } else if (which === 'a') path.unshift(stub);
      else path.push(stub);
      road.setPath(path);
      candidates.push({ road, which, target: stub, other: best.other, s, point: { x: stub.x, y: stub.y, z: 0 } });
    }
  }

  if (!candidates.length) return [];

  // Split each target once, with every cut it received.
  const byTarget = new Map();
  for (const c of candidates) {
    let list = byTarget.get(c.other);
    if (!list) byTarget.set(c.other, (list = []));
    list.push(c);
  }
  const replacements = new Map();
  for (const [target, list] of byTarget) replacements.set(target, splitRoad(net, target, list.map((c) => c.s)));

  const requests = [];
  for (const c of candidates) {
    const segs = replacements.get(c.other);
    const loc = locateSplit(segs, c.s);
    const arms = [{ road: c.road, which: c.which }];
    if (loc) arms.push(loc);
    requests.push(request(c.point, arms, { kind: 'attach' }));
  }
  return requests;
}

/**
 * Where the ray from `p` along `dir` meets the segment a..b, or null.
 *
 * The hit has to land ON the segment — not merely on the infinite line through it. Solving for the
 * line and clamping to the segment is the tempting shortcut and it is wrong in the worst way: on a
 * nearly parallel pair it returns a point hundreds of metres away while reporting the distance to
 * the line, so a road end quietly snaps across the map. The parameter along the segment is checked
 * instead.
 */
function segSegProjection(p, dir, a, b, reach) {
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const el = Math.hypot(ex, ey);
  if (el < 1e-6) return null;
  const ux = ex / el;
  const uy = ey / el;
  const den = dir.x * -uy + dir.y * ux;
  if (Math.abs(den) < 1e-3) return null;
  const t = ((a.x - p.x) * -uy + (a.y - p.y) * ux) / den;
  if (t < -0.5 || t > reach) return null;
  const nx = p.x + dir.x * t;
  const ny = p.y + dir.y * t;
  const u = ((nx - a.x) * ux + (ny - a.y) * uy) / el;
  if (u < -0.02 || u > 1.02) return null;
  const uc = clamp(u, 0, 1);
  const cx = a.x + ux * el * uc;
  const cy = a.y + uy * el * uc;
  const dist = Math.hypot(cx - p.x, cy - p.y);
  if (dist > reach + 0.5) return null;
  return { point: { x: cx, y: cy, z: lerp(a.z ?? 0, b.z ?? 0, uc) }, dist };
}

//--------------------------------------------------------------------------------------------------
//  Pass 2b — duplicates
//--------------------------------------------------------------------------------------------------
/**
 * Drops carriageways that lie on top of another one. Overlapping duplicates are the single most
 * damaging artefact a procedural plan can carry: they double every visual, and every crossing pass
 * afterwards turns them into gravel. Roads are tested most important first (family, then length), so
 * the survivor of an overlapping group is the one the plan actually wants.
 */
export function dedupeRoads(net, opts = {}) {
  const tol = opts.tolerance ?? 1.6;
  const threshold = opts.threshold ?? 0.82;
  const sample = opts.sample ?? 8;
  const grid = net.buildIndex();
  const order = net.roads.slice().sort((a, b) => b.family - a.family || b.length - a.length);
  const keep = [];
  const dropped = [];
  const droppedSet = new Set();
  for (const road of order) {
    if (road.tags && (road.tags.primary || road.tags.layer || road.tags.motorway)) {
      keep.push(road);
      continue;
    }
    if (road.length < 30) {
      keep.push(road);
      continue;
    }
    let samples = 0;
    let shadowed = 0;
    const step = Math.max(sample, road.length / 64);
    for (let s2 = 0; s2 <= road.length; s2 += step) {
      const p = alongPath(road.path, s2, false);
      samples++;
      let hit = false;
      grid.query(p.x - tol, p.y - tol, p.x + tol, p.y + tol, (item) => {
        if (hit) return;
        const other = item.r;
        if (other === road) return;
        if (droppedSet.has(other)) return;
        if (other.family < road.family) return; // a bigger street beside a lane is not a duplicate
        const a = other.path[item.i];
        const b = other.path[item.i + 1];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const l2 = dx * dx + dy * dy || 1e-9;
        const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / l2, 0, 1);
        if (Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)) < tol) hit = true;
      });
      if (hit) shadowed++;
    }
    if (samples > 2 && shadowed / samples >= threshold) {
      dropped.push(road);
      droppedSet.add(road);
    }
    else keep.push(road);
  }
  if (dropped.length) {
    const gone = new Set(dropped);
    net.roads = net.roads.filter((r) => !gone.has(r));
    net.buildIndex();
  }
  return { dropped: dropped.length, kept: keep.length };
}

//--------------------------------------------------------------------------------------------------
//  Pass 3 — crossings
//--------------------------------------------------------------------------------------------------
export function resolveCrossings(net, opts = {}) {
  const grid = net.buildIndex();
  const records = [];
  const seen = new Set();
  const pairHits = new Map();
  // Two streets that merely run alongside each other are not a crossing. Without this test every
  // pair of near-parallel carriageways cuts the other into slivers at each sample step, and the
  // network shatters into a hundred thousand metre-long fragments.
  const minAngle = opts.minAngle ?? 0.14;

  for (const road of net.roads) {
    const p = road.path;
    for (let i = 0; i < p.length - 1; i++) {
      const ax = p[i].x;
      const ay = p[i].y;
      const bx = p[i + 1].x;
      const by = p[i + 1].y;
      grid.query(ax, ay, bx, by, (item) => {
        const other = item.r;
        if (other === road) {
          if (Math.abs(item.i - i) < 3) return;
        } else if (road.closedLoop && other.closedLoop) return;
        const key = road.id < other.id ? `${road.id}|${other.id}|${i}|${item.i}` : `${other.id}|${road.id}|${item.i}|${i}`;
        if (seen.has(key)) return;
        seen.add(key);
        const hit = segSegIntersect({ x: ax, y: ay, z: p[i].z }, { x: bx, y: by, z: p[i + 1].z }, other.path[item.i], other.path[item.i + 1]);
        if (!hit) return;
        // Angle between the two directions at the crossing.
        const a1 = Math.atan2(p[i + 1].y - p[i].y, p[i + 1].x - p[i].x);
        const a2 = Math.atan2(other.path[item.i + 1].y - other.path[item.i].y, other.path[item.i + 1].x - other.path[item.i].x);
        if (Math.abs(Math.sin(a1 - a2)) < minAngle) return;
        const sA = arcLengthTo(road.path, i, hit.ta);
        const sB = arcLengthTo(other.path, item.i, hit.tb);
        // Ignore crossings that land on an existing end: those are already junctions.
        if (sA < 1.5 || sA > road.length - 1.5) return;
        if (sB < 1.5 || sB > other.length - 1.5) return;
        // One pairing crosses at most once in a sane plan; a second hit within a few metres is the
        // curve grazing its neighbour, not a junction.
        const pairKey = road.id < other.id ? `${road.id}|${other.id}` : `${other.id}|${road.id}`;
        const prev = pairHits.get(pairKey);
        if (prev !== undefined && Math.abs(prev.sA - sA) < 6 && Math.abs(prev.sB - sB) < 6) return;
        pairHits.set(pairKey, { sA, sB });
        records.push({ roadA: road, sA, roadB: other, sB, point: hit.point });
      });
    }
  }
  if (!records.length) return [];

  // Grade separation decision, made before splitting so the lift is recorded in pre-split length.
  for (const rec of records) {
    const fa = rec.roadA.family;
    const fb = rec.roadB.family;
    const gap = Math.abs(fa - fb);
    const eitherMajor = rec.roadA.cls === 'motorway' || rec.roadB.cls === 'motorway';
    const railLike = rec.roadA.rail || rec.roadB.rail;
    rec.gradeSep = opts.autoGrade === false ? false : (gap >= 4 && fa + fb >= 5) || (eitherMajor && gap >= 2) || railLike;
    if (rec.gradeSep) {
      // The lower-order road goes up and over; a major road keeps its own alignment.
      const lower = fa <= fb ? rec.roadA : rec.roadB;
      const s = lower === rec.roadA ? rec.sA : rec.sB;
      lower.bridges.push({ s0: Math.max(0, s - 46), s1: s + 46, clearance: railLike ? 7.4 : 6.4, kind: railLike ? 'rail' : 'grade', ramp: 62 });
    }
  }

  const byRoad = new Map();
  for (const rec of records) {
    pushCut(byRoad, rec.roadA, rec.sA);
    pushCut(byRoad, rec.roadB, rec.sB);
  }
  if (globalThis.__REX) {
    const rows = [...byRoad.entries()].map(([r, c]) => ({ id: r.id, cls: r.cls, len: +r.length.toFixed(1), n: c.length, cuts: c.map((x) => +x.toFixed(1)).sort((a, b) => a - b).slice(0, 40) }));
    rows.sort((a, b) => b.n - a.n);
    const target = rows[0].id;
    const partners = {};
    for (const rec of records) {
      if (rec.roadA.id === target) partners[rec.roadB.id + ':' + rec.roadB.cls + ':' + rec.roadB.length.toFixed(0)] = (partners[rec.roadB.id + ':' + rec.roadB.cls + ':' + rec.roadB.length.toFixed(0)] || 0) + 1;
      if (rec.roadB.id === target) partners[rec.roadA.id + ':' + rec.roadA.cls + ':' + rec.roadA.length.toFixed(0)] = (partners[rec.roadA.id + ':' + rec.roadA.cls + ':' + rec.roadA.length.toFixed(0)] || 0) + 1;
    }
    const pairCount = {};
    for (const rec of records) {
      const k = `${rec.roadA.id}/${rec.roadB.id}`;
      pairCount[k] = (pairCount[k] || 0) + 1;
    }
    const topPairs = Object.entries(pairCount).sort((a, b) => b[1] - a[1]).slice(0, 8);
    console.error('records', records.length, 'pairs', Object.keys(pairCount).length, 'top pairs', topPairs);
    for (const [k, n] of topPairs.slice(0, 3)) {
      const [ida, idb] = k.split('/');
      const A = net.roads.find((r) => r.id === ida);
      const B = net.roads.find((r) => r.id === idb);
      console.error(
        `  pair ${k} n=${n}`, 
        'A', A && [A.cls, +A.length.toFixed(1), Object.keys(A.tags).join(','), A.path.length],
        'B', B && [B.cls, +B.length.toFixed(1), Object.keys(B.tags).join(','), B.path.length],
        'A0', A && [+A.path[0].x.toFixed(1), +A.path[0].y.toFixed(1)],
        'B0', B && [+B.path[0].x.toFixed(1), +B.path[0].y.toFixed(1)],
      );
    }
    const longest = [...net.roads].sort((a, b) => b.length - a.length).slice(0, 10).map((r) => [r.id, r.cls, +r.length.toFixed(0), Object.keys(r.tags).join(',')]);
    console.error('longest roads before crossing split:', longest);
  }
  const replacements = new Map();
  for (const [road, cuts] of byRoad) replacements.set(road, splitRoad(net, road, cuts));

  const requests = [];
  for (const rec of records) {
    const segA = locateSplit(replacements.get(rec.roadA), rec.sA);
    const segB = locateSplit(replacements.get(rec.roadB), rec.sB);
    const arms = [];
    if (segA) arms.push(segA);
    if (segB) arms.push(segB);
    if (arms.length < 2) continue;
    requests.push(request(rec.point, arms, { gradeSep: rec.gradeSep, kind: 'crossing' }));
  }
  return requests;
}

function pushCut(map, road, s) {
  let list = map.get(road);
  if (!list) map.set(road, (list = []));
  list.push(s);
}

/**
 * Splits a road at a list of arc lengths, replacing it with the chain of pieces. Every cut becomes
 * a road end so a junction node can address it directly.
 */
export function splitRoad(net, road, cutLengths, optsMinCut = 6.0) {
  const total = road.length || pathLength(road.path, road.closedLoop);
  // Cuts closer together than this are one junction, not two. The junction trim will remove several
  // metres of every arm anyway, so merging them here is what stops the plan producing metre-long
  // fragments of arterial between two crossings.
  const eps = optsMinCut;
  const cuts = [...new Set(cutLengths.map((s) => clamp(s, eps, total - eps)).map((s) => Math.round(s * 100) / 100))].sort((a, b) => a - b);
  const filtered = [];
  for (const s of cuts) if (!filtered.length || s - filtered[filtered.length - 1] > eps) filtered.push(s);
  if (!filtered.length) return [{ road, which: 'b', s0: 0, s1: total }];
  net.removeRoad(road);
  const bounds = [0, ...filtered, total];
  const segs = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const piece = subPath(road.path, bounds[i], bounds[i + 1], false);
    if (piece.length < 2 || bounds[i + 1] - bounds[i] < 1) continue;
    const child = new Road({
      cls: road.cls,
      profileId: road.profileId,
      profile: road.profile,
      path: piece,
      districtId: road.districtId,
      order: road.order,
      oneway: road.oneway,
      tags: { ...road.tags, splitOf: road.id },
      name: road.name,
    });
    child.bridges = road.bridges
      .filter((b) => b.s1 > bounds[i] && b.s0 < bounds[i + 1])
      .map((b) => ({ ...b, s0: Math.max(b.s0, bounds[i]) - bounds[i], s1: Math.min(b.s1, bounds[i + 1]) - bounds[i] }));
    net.roads.push(child);
    segs.push({ road: child, s0: bounds[i], s1: bounds[i + 1], which: 'b' });
  }
  return segs;
}

function locateSplit(segs, s) {
  if (!segs || !segs.length) return null;
  let best = null;
  for (let i = 0; i < segs.length; i++) {
    const d1 = Math.abs(segs[i].s1 - s);
    const d0 = Math.abs(segs[i].s0 - s);
    if (i < segs.length - 1 && d1 < 3.5 && (!best || d1 < best.d)) best = { road: segs[i].road, which: 'b', d: d1 };
    if (i > 0 && d0 < 3.5 && (!best || d0 < best.d)) best = { road: segs[i].road, which: 'a', d: d0 };
  }
  if (best) return { road: best.road, which: best.which };
  return null;
}

function arcLengthTo(path, i, t) {
  let s = 0;
  for (let k = 0; k < i; k++) s += dist2(path[k], path[k + 1]);
  s += dist2(path[i], path[i + 1]) * t;
  return s;
}

function segSegIntersect(a, b, c, d) {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / den;
  const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / den;
  if (t <= 0.0001 || t >= 0.9999 || u <= 0.0001 || u >= 0.9999) return null;
  return { ta: t, tb: u, point: { x: a.x + r.x * t, y: a.y + r.y * t, z: lerp(a.z ?? 0, b.z ?? 0, t) } };
}

//--------------------------------------------------------------------------------------------------
//  Pass 4 — stitch. Ends that landed on top of each other weld into one node; two ends that are
//  collinear weld into one longer road instead, which is what keeps a subdivided grid from turning
//  into hundreds of two-arm "junctions".
//--------------------------------------------------------------------------------------------------
export function stitchEnds(net, requests = [], opts = {}) {
  const weld = opts.weld ?? 2.2;
  const grid = new SegmentGrid(16);
  const ends = [];
  for (const road of net.roads) {
    if (road.closedLoop || road.path.length < 2) continue;
    for (const which of ['a', 'b']) {
      const p = which === 'a' ? road.path[0] : road.path[road.path.length - 1];
      const q = which === 'a' ? road.path[Math.min(2, road.path.length - 1)] : road.path[Math.max(0, road.path.length - 3)];
      const e = { road, which, p, dir: norm2({ x: q.x - p.x, y: q.y - p.y }), merged: false };
      ends.push(e);
      grid.insert(e, p.x, p.y, p.x, p.y);
    }
  }
  // Group coincident ends.
  const groups = [];
  for (const e of ends) {
    if (e.group) continue;
    const group = [e];
    e.group = group;
    grid.query(e.p.x - weld, e.p.y - weld, e.p.x + weld, e.p.y + weld, (o) => {
      if (o === e || o.group || o.merged) return;
      if (dist2(o.p, e.p) <= weld) {
        o.group = group;
        group.push(o);
      }
    });
    groups.push(group);
  }

  const merged = new Set();
  const out = requests.slice();
  let weldCount = 0;
  for (const group of groups) {
    if (group.length === 1) continue;
    // Two collinear ends of comparable class weld into one road.
    if (group.length === 2 && !group.some((e) => e.road.closedLoop)) {
      const [e1, e2] = group;
      const dot = e1.dir.x * -e2.dir.x + e1.dir.y * -e2.dir.y;
      if (dot > 0.965 && e1.road.cls === e2.road.cls && e1.road.id !== e2.road.id) {
        const keep = e1.road;
        const drop = e2.road;
        const keepPath = e1.which === 'a' ? keep.path.slice().reverse() : keep.path.slice();
        const dropPath = e2.which === 'b' ? drop.path.slice() : drop.path.slice().reverse();
        if (e1.which === 'a') keep.path = keepPath;
        const joined = keepPath.concat(dropPath.slice(1));
        keep.setPath(joined);
        keep.bridges = keep.bridges.concat(drop.bridges);
        net.removeRoad(drop);
        merged.add(drop.id);
        weldCount++;
        continue;
      }
    }
    const arms = group.filter((e) => !merged.has(e.road.id)).map((e) => ({ road: e.road, which: e.which }));
    if (arms.length >= 2) out.push(request(group[0].p, arms, { kind: 'stitch' }));
  }
  return { requests: out, welded: weldCount };
}

//--------------------------------------------------------------------------------------------------
//  Node creation: cluster requests spatially, merge the arms and emit JunctionNode records.
//--------------------------------------------------------------------------------------------------
export function createNodes(net, requests, opts = {}) {
  const grid = new SegmentGrid(24);
  const nodes = [];
  // Two crossing requests become one junction only when they really are one junction: the merge
  // radius is the width of the carriageways involved plus a little room for the kerb returns, not
  // the width of the widest street times one and a half. A generous radius swallowed every
  // crossing in a dense district and produced junctions with twenty arms, each arm a ten-metre
  // stub of a street that had been cut three times in the same spot. Requests that stay separate
  // get their own junction, and the short edge dissolution pass merges the pair properly if the
  // sliver between them turns out to be junction surface rather than street.
  const maxArms = opts.maxMergeArms ?? 8;
  for (const req of requests) {
    if (!req || req.arms.length < 2) continue;
    // A grade-separated crossing is not a junction. If it were made into one it would trim both
    // carriageways and then meet itself several metres in the air, which is both a validation error
    // and, on screen, two roads merging into a ramp that goes nowhere.
    if (req.gradeSep) continue;
    let host = null;
    const armHalf = Math.max(...req.arms.map((a) => a.road.halfWidth));
    grid.query(req.point.x - 40, req.point.y - 40, req.point.x + 40, req.point.y + 40, (n) => {
      if (host || n.gradeSep || req.gradeSep) return;
      const mergeR = clamp(3 + (armHalf + n._halfW) * 0.4, 5, opts.mergeReach ?? 15);
      if (dist2(n, req.point) > mergeR) return;
      const fresh = req.arms.filter((a) => !n.arms.some((b) => b.roadId === a.road.id && b.which === a.which)).length;
      if (n.arms.length + fresh > maxArms) return;
      host = n;
    });
    let node = host;
    if (!node) {
      node = new JunctionNode(req.point.x, req.point.y, req.point.z ?? 0);
      node._halfW = Math.max(...req.arms.map((a) => a.road.halfWidth));
      node._n = 0;
      node.gradeSep = !!req.gradeSep;
      nodes.push(node);
      grid.insert(node, node.x, node.y, node.x, node.y);
    }
    for (const arm of req.arms) {
      if (!arm || !arm.road) continue;
      if (node.arms.some((a) => a.roadId === arm.road.id && a.which === arm.which)) continue;
      node.arms.push({ roadId: arm.road.id, which: arm.which, road: arm.road });
    }
    node._n++;
  }
  if (globalThis.__RENODES) {
    const big = nodes.filter((n) => n.arms.length >= 8).map((n) => [n.id, n.arms.length, +n.x.toFixed(0), +n.y.toFixed(0)]);
    console.error('NODES: requests', requests.length, 'nodes', nodes.length, 'with 8+ arms', big.length, big.slice(0, 12));
    const reqBig = requests.filter((r) => r.arms.length >= 8).map((r) => [r.kind, r.arms.length, +r.point.x.toFixed(0), +r.point.y.toFixed(0), r.arms.map((a) => a.road.cls).join('/')]);
    console.error('NODES: fat requests', reqBig.length, reqBig.slice(0, 8));
  }
  net.nodes.push(...nodes);
  return nodes;
}

//--------------------------------------------------------------------------------------------------
//  Pass 4b — topologise
//--------------------------------------------------------------------------------------------------
/**
 * Dissolves the pseudo-nodes a splitter inevitably leaves behind. A street cut at eight crossings
 * comes out as nine roads joined by eight two-arm nodes; left alone the map reads as a thousand
 * stubs and every later pass costs ten times what it should. Two behaviours, both standard:
 *
 *   collapse   two nodes joined by a road shorter than the threshold become one node
 *   dissolve   at a two-arm node whose arms run on in the same direction, the two roads join
 *
 * Grade separation is respected: a node pair either side of a bridge deck is real, not a pseudo
 * node, so a road that carries a bridge is never collapsed.
 */
export function dissolveShortEdges(net, opts = {}) {
  const maxLen = opts.collapseLength ?? 7;
  const turnLimit = opts.dissolveTurn ?? 0.32; // radians, ~18 degrees
  const nodes = net.nodes;
  if (!nodes.length) return { collapsed: 0, dissolved: 0 };

  const parent = new Map();
  for (const n of nodes) parent.set(n, n);
  const find = (x) => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r);
    let c = x;
    while (parent.get(c) !== r) {
      const nx = parent.get(c);
      parent.set(c, r);
      c = nx;
    }
    return r;
  };
  // A group of collapsed nodes keeps one arm per street that still arrives at it, so the number of
  // arms a group will have is known before the group is formed. Junctions with more arms than a
  // driver can read are worse than a short street between two junctions, so a merge that would
  // push a group past `maxArms` is refused and the short road stays where it is.
  const armKey = (a) => `${a.roadId}|${a.which}`;
  const maxArms = opts.maxArms ?? 10;
  const maxStreets = opts.maxStreets ?? 5;
  // What a driver has to read at a junction is the number of *streets*, not the number of arms: a
  // four-way crossing has eight arms and one decision each. So a group is measured in streets, and
  // two arms that leave the node in opposite directions are the same street passing through.
  const armAngle = (node, arm) => {
    const o = arm.outward || armOutward(arm, node);
    return Math.atan2(o.y, o.x);
  };
  const streetCount = (angles) => {
    const used = new Array(angles.length).fill(false);
    let count = 0;
    for (let i = 0; i < angles.length; i++) {
      if (used[i]) continue;
      used[i] = true;
      count++;
      for (let j = i + 1; j < angles.length; j++) {
        if (used[j]) continue;
        let d = Math.abs(angles[j] - angles[i]);
        if (d > Math.PI) d = Math.PI * 2 - d;
        if (Math.abs(d - Math.PI) < 0.6) {
          used[j] = true;
          break;
        }
      }
    }
    return count;
  };
  const groupArms = new Map();
  const groupKeys = new Map();
  for (const n of nodes) {
    groupKeys.set(n, new Set((n.arms || []).map(armKey)));
    groupArms.set(n, (n.arms || []).map((a) => armAngle(n, a)));
  }
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return false;
    const ka = groupKeys.get(ra);
    const kb = groupKeys.get(rb);
    const mergedKeys = new Set(ka);
    for (const k of kb) mergedKeys.add(k);
    const mergedAngles = groupArms.get(ra).concat(groupArms.get(rb));
    if (mergedKeys.size > maxArms || streetCount(mergedAngles) > maxStreets) return false;
    parent.set(rb, ra);
    groupKeys.set(ra, mergedKeys);
    groupArms.set(ra, mergedAngles);
    groupKeys.delete(rb);
    groupArms.delete(rb);
    return true;
  };

  let collapsed = 0;
  let refused = 0;
  const removed = new Set();
  for (const road of net.roads) {
    if (road.closedLoop || !road.startNode || !road.endNode) continue;
    if (road.startNode === road.endNode) continue;
    // A span longer than ten metres is a real bridge deck — the road is carrying traffic over
    // something, so it is not junction surface however short it is. The span has to fit inside the
    // road to count: after a split, the span lists still carry the whole original deck.
    const realDeck = (road.bridges || []).some((b) => b.s1 - b.s0 > 10 && b.s1 - b.s0 <= road.length * 1.2);
    if (realDeck) continue;
    if (road.gradeSep) continue;
    if (road.length > maxLen) continue;
    // Two junctions closer than the threshold are one junction, however far apart the terrain has
    // left them: a twelve-metre street with four metres of fall in it is not a street.
    if (road.length > 8 && Math.abs(road.startNode.z - road.endNode.z) > 2.5) continue;
    if (!union(road.startNode, road.endNode)) {
      refused++;
      // The arm cap refused this merge, so two junctions stay a few metres apart with a sliver of
      // asphalt between them. That sliver is not a street — it is the junction surface the two
      // polygons leave uncovered — so it is drawn as carriageway and nothing else, and it is not
      // reported as a street that is too short to exist.
      if (opts.junctionSkin && road.length <= (opts.skinLength ?? 6)) road.junctionSkin = true;
      continue;
    }
    removed.add(road);
    collapsed++;
  }

  const groups = new Map();
  for (const n of nodes) {
    const r = find(n);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(n);
  }
  const rep = new Map();
  for (const [r, list] of groups) {
    let best = list[0];
    for (const n of list) if ((n.arms ? n.arms.length : 0) > (best.arms ? best.arms.length : 0)) best = n;
    rep.set(r, best);
  }

  // Rebuild the surviving nodes with the union of the group's arms.
  const survivors = [];
  for (const [r, list] of groups) {
    const keep = rep.get(r);
    const arms = [];
    const seen = new Set();
    for (const n of list) {
      for (const arm of n.arms || []) {
        if (removed.has(arm.road)) continue;
        const k = armKey(arm);
        if (seen.has(k)) continue;
        seen.add(k);
        arms.push(arm);
      }
    }
    keep.arms = arms;
    let sx = 0;
    let sy = 0;
    let sz = 0;
    for (const n of list) {
      sx += n.x;
      sy += n.y;
      sz += n.z;
    }
    keep.x = sx / list.length;
    keep.y = sy / list.length;
    keep.z = sz / list.length;
    survivors.push(keep);
  }
  net.nodes = survivors;

  // Repoint road ends and drop the collapsed debris.
  const kept = [];
  for (const road of net.roads) {
    if (removed.has(road)) continue;
    const sN = road.startNode && parent.has(road.startNode) ? rep.get(find(road.startNode)) : road.startNode;
    const eN = road.endNode && parent.has(road.endNode) ? rep.get(find(road.endNode)) : road.endNode;
    if (sN && eN && sN === eN && road.length <= maxLen) continue;
    road.startNode = sN;
    road.endNode = eN;
    kept.push(road);
  }
  net.roads = kept;

  // Rebuild arm references now that roads changed identity.
  for (const node of net.nodes) {
    node.arms = (node.arms || []).filter((a) => net.roads.includes(a.road));
    for (const arm of node.arms) {
      if (arm.which === 'a' && arm.road.endNode === node && arm.road.startNode !== node) arm.which = 'b';
      else if (arm.which === 'b' && arm.road.startNode === node && arm.road.endNode !== node) arm.which = 'a';
    }
  }

  // Dissolve two-arm nodes whose arms run on in the same direction.
  let dissolved = 0;
  for (let guard = 0; guard < 8; guard++) {
    let changed = false;
    for (const node of net.nodes.slice()) {
      if (!node.arms || node.arms.length !== 2) continue;
      const [a1, a2] = node.arms;
      if (!a1.road || !a2.road || a1.road === a2.road) continue;
      if (a1.road.bridges.length || a2.road.bridges.length) continue;
      const out1 = armOutward(a1, node);
      const out2 = armOutward(a2, node);
      const dot = out1.x * -out2.x + out1.y * -out2.y;
      if (dot < Math.cos(turnLimit)) continue;
      const joined = joinRoads(net, a1, a2, node);
      if (joined) {
        dissolved++;
        changed = true;
      }
    }
    if (!changed) break;
  }

  // Debris: fragments left inside a junction footprint that no request ever claimed. They have no
  // node at either end, they are shorter than a car, and they sit where the junction surface will be
  // drawn anyway, so they are removed rather than connected.
  const nodeGrid = new SegmentGrid(20);
  for (const n of net.nodes) nodeGrid.insert(n, n.x, n.y, n.x, n.y);
  const insideJunction = (p2, radius) => {
    let hit = false;
    nodeGrid.query(p2.x - radius, p2.y - radius, p2.x + radius, p2.y + radius, (n) => {
      if (hit) return;
      const r = radius + Math.max(0, (n.arms ? n.arms.length : 0) - 2) * 1.5;
      if (Math.hypot(n.x - p2.x, n.y - p2.y) <= r) hit = true;
    });
    return hit;
  };
  let debris = 0;
  const debrisSet = new Set();
  const survivors2 = [];
  for (const road of net.roads) {
    const loose = !road.startNode || !road.endNode;
    if (loose && !road.closedLoop && road.length <= (opts.debrisLength ?? 6) && !(road.tags && (road.tags.primary || road.tags.motorway))) {
      const a = road.path[0];
      const b = road.path[road.path.length - 1];
      if (insideJunction(a, 7) && insideJunction(b, 7)) {
        debris++;
        debrisSet.add(road);
        continue;
      }
    }
    survivors2.push(road);
  }
  net.roads = survivors2;
  if (debrisSet.size) {
    for (const node of net.nodes) {
      const before = node.arms.length;
      node.arms = node.arms.filter((arm) => !debrisSet.has(arm.road));
      if (node.arms.length !== before) node.arms = node.arms.slice();
    }
  }

  // Anything left pointing at a road that no longer exists is dropped with it, and every surviving
  // arm gets its outward bearing recomputed: joining two roads moves the far end, and a stale
  // bearing would show up later as a junction drawn with one arm pointing the wrong way.
  for (const node of net.nodes) {
    node.arms = (node.arms || []).filter((a) => net.roads.includes(a.road));
    for (const arm of node.arms) {
      const road = arm.road;
      if (!road || road.path.length < 2) continue;
      const at = arm.which === 'a' ? road.path[0] : road.path[road.path.length - 1];
      const other = arm.which === 'a' ? road.path[Math.min(2, road.path.length - 1)] : road.path[Math.max(0, road.path.length - 3)];
      const dx = other.x - at.x;
      const dy = other.y - at.y;
      const l = Math.hypot(dx, dy) || 1;
      arm.outward = { x: dx / l, y: dy / l, z: 0 };
      arm.angle = Math.atan2(arm.outward.y, arm.outward.x);
    }
    node.arms.sort((a, b) => a.angle - b.angle);
  }
  if (globalThis.__RENODES) {
    const hist = net.nodes.reduce((a, n) => ((a[n.arms.length] = (a[n.arms.length] || 0) + 1), a), {});
    console.error('DISSOLVE: collapsed', collapsed, 'refused', refused, 'debris', debris, 'arms', JSON.stringify(hist));
  }
  net.nodes = net.nodes.filter((n) => n.arms.length >= 1);
  return { collapsed, refused, dissolved, debris, skin: net.roads.filter((r) => r.junctionSkin).length, nodes: net.nodes.length, roads: net.roads.length };
}

/** Unit vector of an arm pointing away from the node along the road. */
function armOutward(arm, node) {
  const path = arm.road.path;
  if (arm.which === 'a') {
    const p = path[0];
    const q = path[Math.min(2, path.length - 1)];
    return norm2({ x: q.x - p.x, y: q.y - p.y });
  }
  const p = path[path.length - 1];
  const q = path[Math.max(0, path.length - 3)];
  return norm2({ x: q.x - p.x, y: q.y - p.y });
}

/**
 * Joins two roads at a shared node into one. The four ways a pair of ends can meet are handled
 * explicitly — concatenating the wrong way round is how a merger silently doubles a road back on
 * itself.
 */
function joinRoads(net, a1, a2, node) {
  const A = a1.road;
  const B = a2.road;
  if (!A || !B || A === B) return false;
  if (A.cls !== B.cls && A.family !== B.family) return false;
  if (A.tags && A.tags.primary && !(B.tags && B.tags.primary)) return false;
  const w1 = a1.which;
  const w2 = a2.which;
  let joined;
  let newStart;
  let newEnd;
  let farNode;
  let farWhich;
  if (w1 === 'b' && w2 === 'a') {
    joined = A.path.concat(B.path.slice(1));
    newStart = A.startNode;
    newEnd = B.endNode;
    farNode = B.endNode;
    farWhich = 'b';
  } else if (w1 === 'b' && w2 === 'b') {
    joined = A.path.concat(B.path.slice().reverse().slice(1));
    newStart = A.startNode;
    newEnd = B.startNode;
    farNode = B.startNode;
    farWhich = 'a';
  } else if (w1 === 'a' && w2 === 'b') {
    joined = B.path.concat(A.path.slice(1));
    newStart = B.startNode;
    newEnd = A.endNode;
    farNode = B.startNode;
    farWhich = 'a';
  } else {
    joined = A.path.slice().reverse().concat(B.path.slice(1));
    newStart = A.endNode;
    newEnd = B.endNode;
    farNode = B.endNode;
    farWhich = 'b';
  }
  if (joined.length < 2) return false;
  A.setPath(joined);
  A.startNode = newStart;
  A.endNode = newEnd;
  A.bridges = (A.bridges || []).concat(B.bridges || []);
  A.tags = { ...(B.tags || {}), ...(A.tags || {}) };
  net.removeRoad(B);
  node.arms = node.arms.filter((a) => a !== a1 && a !== a2);
  if (farNode) {
    // The far node used to hold B; it now holds the other end of the joined road.
    farNode.arms = (farNode.arms || []).filter((a) => a.road !== B);
    if (!farNode.arms.some((a) => a.road === A && (a.which === 'a' || a.which === 'b'))) {
      farNode.arms.push({ roadId: A.id, which: w1 === 'a' ? 'a' : 'b', road: A, outward: null });
    }
    if (w1 === 'a') A.startNode = farNode;
    else A.endNode = farNode;
  }
  for (const n of net.nodes) {
    for (const arm of n.arms || []) {
      if (arm.road !== A) continue;
      if (n === A.startNode) arm.which = 'a';
      else if (n === A.endNode) arm.which = 'b';
    }
    n.arms = (n.arms || []).filter((a) => a.road !== B);
    n.arms = n.arms.filter((a, i) => n.arms.findIndex((b) => b.roadId === a.roadId && b.which === a.which) === i);
  }
  return true;
}

//--------------------------------------------------------------------------------------------------
//  Pass 5 — grade
//--------------------------------------------------------------------------------------------------
export function planGrade(net, terrain) {
  for (const road of net.roads) {
    const lift = road.cls === 'footway' || road.cls === 'cycleway' ? 0.14 : 0.02;
    for (const p of road.path) p.z = (terrain ? terrain.height(p.x, p.y) : 0) + lift;
    const zs = road.path.map((p) => p.z);
    for (let i = 1; i < road.path.length - 1; i++) road.path[i].z = (zs[i - 1] + 2 * zs[i] + zs[i + 1]) * 0.25;
    if (road.bridges.length) applyBridges(road, terrain);
    limitGrade(road);
  }
  return net;
}

/**
 * Enforces a design gradient. Terrain-following roads on the rim of a map can otherwise end up with
 * 20 % ramps that no carriageway would ever be built with. The limit is applied as a forward and
 * backward sweep so the fix stays local.
 */
export function limitGrade(road, maxGrade = 0.11, opts = {}) {
  const path = road.path;
  if (path.length === 2) {
    // A two-point road is a single segment, and the gradient limiter used to walk straight past it:
    // the road kept whatever the terrain gave it, which on a cliff face is a wall rather than a
    // street. One of the two ends has to give, and it is the one no junction is holding.
    const dl = Math.hypot(path[1].x - path[0].x, path[1].y - path[0].y);
    if (dl < 0.3) {
      path[1].z = path[0].z;
      return;
    }
    const max = maxGrade * dl;
    const dz = path[1].z - path[0].z;
    if (Math.abs(dz) <= max) return;
    const heldA = !!road.startNode;
    const heldB = !!road.endNode;
    if (heldA && heldB) return;
    if (heldA) path[1].z = path[0].z + Math.sign(dz) * max;
    else path[0].z = path[1].z - Math.sign(dz) * max;
    return;
  }
  if (path.length < 3) return;
  // Pinned ends: the two ends of a road are set by the junctions they land on, so the limiter is
  // allowed to reshape the profile between them but not to move the ends themselves. Without this
  // the last call in the relaxation walks the ends straight back off their junctions. The backward
  // sweep starts two points from the end either way, because it reads its neighbour ahead of it.
  const last = path.length - 2;
  const onStructure = (i) => road.bridges.some((b) => {
    const s = arcLengthIndex(path, i);
    return s > b.s0 - 4 && s < b.s1 + 4;
  });
  const sweeps = Math.max(1, opts.sweeps ?? 1);
  // The sweeps alternate, and the sweep that runs last has the final word on the profile: ending on
  // a forward sweep means the residual steep segment, when the street is too short to hold the grade
  // at all, sits at the far end from the junction rather than right on the junction mouth.
  const dirs = [];
  for (let sweep = 0; sweep < sweeps; sweep++) dirs.push(1, -1);
  if (opts.pinEnds) dirs.push(1);
  for (const dir of dirs) {
    const start = dir === 1 ? 1 : last;
    const end = dir === 1 ? path.length : -1;
    for (let i = start; i !== end; i += dir) {
      if (opts.pinEnds && (i === 0 || i === path.length - 1)) {
        // A pinned end with a neighbour on top of it: the pair is shorter than a kerb stone, so the
        // neighbour takes the end's height instead of leaving a vertical sliver of asphalt.
        const nb = path[i === 0 ? 1 : path.length - 2];
        if (nb && Math.hypot(path[i].x - nb.x, path[i].y - nb.y) < 0.3) nb.z = path[i].z;
        continue;
      }
      if (onStructure(i)) continue;
      const prev = path[i - dir];
      const dl = Math.hypot(path[i].x - prev.x, path[i].y - prev.y);
      // A duplicated control point has no length in plan, so it has no gradient either; it takes its
      // neighbour's height rather than leaving a vertical jog in the profile.
      if (dl < 0.3) {
        path[i].z = prev.z;
        continue;
      }
      const max = maxGrade * dl;
      const dz = path[i].z - prev.z;
      if (Math.abs(dz) > max) path[i].z = prev.z + Math.sign(dz) * max;
    }
  }
}

export function applyBridges(road, terrain) {
  for (const b of road.bridges) {
    const ramp = b.ramp ?? clamp((b.s1 - b.s0) * 0.6, 24, 90);
    const from = Math.max(0, b.s0 - ramp);
    const to = Math.min(road.length, b.s1 + ramp);
    const clearance = b.clearance ?? 6.2;
    for (let i = 0; i < road.path.length; i++) {
      const s = arcLengthIndex(road.path, i);
      if (s < from || s > to) continue;
      const inDeck = s >= b.s0 && s <= b.s1;
      const edge = inDeck ? 1 : 1 - Math.abs(s - (s < b.s0 ? b.s0 : b.s1)) / ramp;
      const lift = clearance * clamp(edge * 1.05, 0, 1);
      const base = terrain ? terrain.height(road.path[i].x, road.path[i].y) : road.path[i].z;
      road.path[i].z = Math.max(road.path[i].z, base + lift + 0.15);
    }
    const from2 = from - 8;
    const to2 = to + 8;
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 1; i < road.path.length - 1; i++) {
        const s = arcLengthIndex(road.path, i);
        if (s < from2 || s > to2) continue;
        const avg = (road.path[i - 1].z + 2 * road.path[i].z + road.path[i + 1].z) * 0.25;
        road.path[i].z = lerp(road.path[i].z, avg, pass === 0 ? 0.45 : 0.2);
      }
    }
  }
}

export function arcLengthIndex(path, i) {
  let s = 0;
  const lim = Math.min(i, path.length - 1);
  for (let k = 0; k < lim; k++) s += Math.hypot(path[k + 1].x - path[k].x, path[k + 1].y - path[k].y, (path[k + 1].z ?? 0) - (path[k].z ?? 0));
  return s;
}

//--------------------------------------------------------------------------------------------------
//  Pass 6 — junctions
//--------------------------------------------------------------------------------------------------
export function buildJunctions(net, opts = {}) {
  for (const node of net.nodes) {
    const arms = node.arms
      .map((a) => {
        const road = a.road || net.roadById(a.roadId);
        if (!road || road.path.length < 2) return null;
        const p = a.which === 'a' ? road.path[0] : road.path[road.path.length - 1];
        const q = a.which === 'a' ? road.path[Math.min(2, road.path.length - 1)] : road.path[Math.max(0, road.path.length - 3)];
        const outward = norm2({ x: q.x - p.x, y: q.y - p.y });
        return {
          roadId: road.id,
          which: a.which,
          road,
          outward,
          angle: Math.atan2(outward.y, outward.x),
          halfWidth: road.halfWidth,
          lanes: road.profile ? sectionOf(road.profile).lanes.length : 2,
          cls: road.cls,
          oneway: road.oneway,
        };
      })
      .filter(Boolean);
    arms.sort((a, b) => a.angle - b.angle);
    node.arms = arms;
    if (arms.length < 2) {
      node.kind = 'dead-end';
      continue;
    }
    node.kind = arms.length === 2 ? 'bend' : arms.length === 3 ? 'tee' : arms.length === 4 ? 'cross' : 'multi';
    const fillet = clamp(4 + arms.reduce((s, a) => s + a.halfWidth, 0) / arms.length, 4, 15);
    node.fillet = fillet;

    // Five or more arms meeting at one point is not a junction a driver can read — it is a hub,
    // and the plan has one wherever radial arterials converge. Nine arms of stop lines would be
    // both unbuildable and unreadable, so a hub becomes a roundabout: every approach is then a
    // single give-way movement, the circulating carriageway does the sorting out, and the junction
    // gets one shared plane instead of one grade per pair of arms. Freeway-class roads never join
    // one — a trunk or motorway arm meeting that many streets means the plan is wrong elsewhere,
    // not that the roundabout needs to be bigger.
    const widest = arms.reduce((m, a) => Math.max(m, a.halfWidth), 0);
    const freewayArm = arms.some((a) => a.road.family >= 5);
    if (opts.roundabouts !== false && !node.roundabout && !node.gradeSep && arms.length >= 5 && !freewayArm) {
      const ring = clamp(Math.max(widest * 0.85, 6.5) + arms.length * 1.1 + 2.5, 9, 26);
      node.roundabout = true;
      node.roundaboutRadius = ring;
      node.centreIslandRadius = Math.max(3, ring - (widest > 7 ? 7.4 : 4.8));
    }

    let maxCut = 0;
    const cuts = {};
    for (const a of arms) {
      let cut = a.halfWidth * 0.9;
      if (node.roundabout) {
        // Every arm stops at the circulating carriageway; the ring owns the space in between.
        cut = Math.max(node.roundaboutRadius, a.halfWidth * 1.1);
      } else {
        // How far back an arm has to be cut is set by where its kerb line stops crossing another
        // arm's carriageway. Two arms pointing the same way fork off and constrain each other; two
        // arms pointing opposite ways are the two halves of one street, where the far carriageway's
        // kerb is simply the continuing kerb, and demanding clearance from it drove the cut out to
        // fifty metres and the junction to a hundred. Shallow angles still need a long cut — that is
        // real, a street crossing at twenty degrees occupies a lot of kerb — so the sine is only
        // floored, never discarded.
        for (const b of arms) {
          if (a === b) continue;
          const d = deltaAngle(a.angle, b.angle);
          if (d > Math.PI * 0.62) continue;
          const sin = Math.max(0.5, Math.sin(d));
          cut = Math.max(cut, (b.halfWidth + Math.max(0, 0.5 * a.halfWidth * Math.cos(d))) / sin);
        }
        cut = Math.min(cut, 34) + fillet * 0.4;
      }
      cuts[a.roadId] = cut;
      maxCut = Math.max(maxCut, cut);
    }
    node.width = node.roundabout ? (node.roundaboutRadius + 3) * 2 : maxCut * 2;
    node.trim = cuts;
    let zsum = 0;
    for (const a of arms) zsum += a.which === 'a' ? a.road.path[0].z : a.road.path[a.road.path.length - 1].z;
    node.z = zsum / arms.length;

    // Control type follows what the junction has to do, not how many lanes pass through it: two
    // arms are a bend or a level crossing and need nothing, four arms of arterials need signals,
    // and a lone arterial crossing a street yields. Counting total lanes signalled half the city.
    const arterials = arms.filter((a) => a.road.family === 4).length;
    const totalLanes = arms.reduce((s, a) => s + a.lanes, 0);
    if (node.roundabout) node.control = 'roundabout';
    else if (arms.length === 2) node.control = 'none';
    else if (arterials >= 2 || (arterials >= 1 && totalLanes >= 20) || (arms.length >= 4 && totalLanes >= 26)) node.control = 'signal';
    else if (freewayArm) node.control = 'priority';
    else if (totalLanes >= 10) node.control = 'yield';
    else node.control = 'none';
  }
  // Trimming happens after every cut distance is known so no arm is cut twice.
  for (const node of net.nodes) {
    for (const a of node.arms) {
      const cut = Math.min(node.trim[a.roadId] ?? 0, a.road.length * 0.45);
      trimRoadEnd(a.road, a.which, cut, node);
    }
  }
  return net;
}

function deltaAngle(a, b) {
  let d = b - a;
  const TAU = Math.PI * 2;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return Math.abs(d);
}

export function trimRoadEnd(road, which, cut, node) {
  if (!cut || cut <= 0.05) {
    if (which === 'a') road.startNode = node;
    else road.endNode = node;
    return;
  }
  const len = road.length || pathLength(road.path, false);
  const c = Math.min(cut, Math.max(0, len - 1));
  if (which === 'a') {
    road.path = subPath(road.path, c, len, false);
    road.cuts.a = c;
    road.startNode = node;
    for (const b of road.bridges) {
      b.s0 -= c;
      b.s1 -= c;
    }
  } else {
    road.path = subPath(road.path, 0, len - c, false);
    road.cuts.b = c;
    road.endNode = node;
  }
  road.length = pathLength(road.path, false);
  road.bridges = road.bridges.filter((b) => b.s1 > 0.5 && b.s0 < road.length - 0.5);
}

//--------------------------------------------------------------------------------------------------
//  Pass 6a — node relief
//--------------------------------------------------------------------------------------------------
/**
 * Gives every junction one height. A street cannot meet another with one kerb six metres above the
 * other's — on real ground the approach road ramps up to the crossing, and that is what is built
 * here: the node takes a single height and each arm is blended toward it, then the gradient limit
 * is re-applied so the blend comes out as a graded ramp rather than a step.
 */
export function relaxNodes(net, opts = {}) {
  const maxShift = opts.maxShift ?? 60;
  const targets = new Map();
  const onDeck = (road, which) => {
    for (const b of road.bridges || []) {
      if (b.s1 - b.s0 < 8) continue;
      const s = which === 'a' ? 0 : road.length;
      if (s > b.s0 - 2 && s < b.s1 + 2) return true;
    }
    return false;
  };
  const nodeZ = (node) => {
    let sum = 0;
    let weight = 0;
    let deckSum = 0;
    let deckWeight = 0;
    for (const arm of node.arms || []) {
      const road = arm.road;
      if (!road || road.closedLoop || !road.path.length) continue;
      const at = arm.which === 'a' ? road.path[0] : road.path[road.path.length - 1];
      const w = 1 + Math.min(3, road.family);
      sum += at.z * w;
      weight += w;
      // A junction whose arm is already up on a deck belongs at deck level, not at the average.
      if (onDeck(road, arm.which)) {
        deckSum += at.z; 
        deckWeight += 1;
      }
    }
    if (deckWeight) return deckSum / deckWeight;
    return weight ? sum / weight : node.z;
  };
  for (const node of net.nodes) targets.set(node, nodeZ(node));

  // A street shorter than its own approach ramps cannot have two different heights at its ends: no
  // carriageway rises six metres over forty of them. Its two junctions are averaged together, and
  // that passes on along the chain of short streets until every cluster sits at one level.
  // Averaging is a diffusion: each sweep only moves a junction halfway toward its neighbours, so a
  // cluster of short streets needs about as many sweeps as it is junctions across. Six was enough
  // for a pair and nowhere near enough for a block: junctions two streets apart were still half a
  // metre apart, which over a two-metre street is a twenty per cent grade. A hundred sweeps over
  // two thousand roads costs a few milliseconds and settles the whole city to a level.
  const chainPasses = opts.chainPasses ?? 96;
  for (let pass = 0; pass < chainPasses; pass++) {
    let changed = 0;
    for (const road of net.roads) {
      if (road.closedLoop || !road.startNode || !road.endNode) continue;
      if (road.startNode === road.endNode || road.length > (opts.chainLength ?? 70)) continue;
      const a = targets.get(road.startNode);
      const b = targets.get(road.endNode);
      if (a === undefined || b === undefined) continue;
      const m = (a + b) / 2;
      if (Math.abs(a - m) > 0.05 || Math.abs(b - m) > 0.05) changed++;
      targets.set(road.startNode, m);
      targets.set(road.endNode, m);
    }
    if (!changed) break;
  }

  for (let pass = 0; pass < 2; pass++) {
    for (const node of net.nodes) {
      const target = targets.get(node);
      if (target === undefined || !node.arms || node.arms.length < 2) continue;
      let low = Infinity;
      let high = -Infinity;
      for (const arm of node.arms) {
        const road = arm.road;
        if (!road || road.closedLoop || !road.path.length) continue;
        const at = arm.which === 'a' ? road.path[0] : road.path[road.path.length - 1];
        low = Math.min(low, at.z);
        high = Math.max(high, at.z);
      }
      if (!isFinite(low) || high - low < 0.4) continue;
      for (const arm of node.arms) {
        const road = arm.road;
        if (!road || road.closedLoop || road.path.length < 2) continue;
        const idx = arm.which === 'a' ? 0 : road.path.length - 1;
        const delta = target - road.path[idx].z;
        if (Math.abs(delta) > maxShift) continue;
        // The ramp owns at most most of the street, so a short street absorbs its rise gently.
        const rampDist = Math.max(4, Math.min(road.length * 0.95, Math.abs(delta) / 0.075 + 6));
        let acc = 0;
        for (let i = 0; i < road.path.length; i++) {
          const k = idx === 0 ? i : road.path.length - 1 - i;
          if (i > 0) acc += dist2(road.path[k], road.path[idx === 0 ? k - 1 : k + 1]);
          const t = clamp(acc / rampDist, 0, 1);
          const w = 0.5 * (1 + Math.cos(Math.PI * t));
          if (w <= 0) break;
          road.path[k].z += delta * w;
        }
      }
      node.z = target;
    }
    // Bridges are deliberately NOT re-applied here: a deck's height was decided in planGrade, and
    // re-deriving it after the junction heights moved would undo exactly the ramp just built.
    for (const road of net.roads) limitGrade(road, 0.14);
  }

  // Final clamp, iterated. The blended approach is what shapes the ramp; the clamp is what makes
  // the junction exactly one surface. The two have to take turns: the clamp moves a road end, the
  // gradient limit pulls it back toward its neighbour, so each round the neighbour gets closer too
  // and after a few rounds every arm really does land on the node's height.
  for (let round = 0; round < 5; round++) {
    for (const node of net.nodes) {
      const target = targets.get(node);
      if (target === undefined || !node.arms || node.arms.length < 2) continue;
      for (const arm of node.arms) {
        const road = arm.road;
        if (!road || road.closedLoop || road.path.length < 2) continue;
        const idx = arm.which === 'a' ? 0 : road.path.length - 1;
        const step = arm.which === 'a' ? 1 : -1;
        const end = road.path[idx];
        if (Math.abs(end.z - target) < 0.015) continue;
        end.z = target;
        // Bring the approach along with it, so the gradient limit has a ramp to smooth rather than
        // a step to fight.
        for (const [k, w] of [[1, 0.62], [2, 0.3], [3, 0.12]]) {
          const p2 = road.path[idx + step * k];
          if (!p2) break;
          p2.z += (target - p2.z) * w;
        }
      }
      node.z = target;
    }
    for (const road of net.roads) limitGrade(road, 0.14);
  }
  // Last word: every arm end sits on its junction, and the limiter is allowed to smooth the street
  // behind it but not to lift the end off the junction again.
  for (const node of net.nodes) {
    const target = targets.get(node);
    if (target === undefined || !node.arms) continue;
    for (const arm of node.arms) {
      const road = arm.road;
      if (!road || road.closedLoop || road.path.length < 2) continue;
      const end = arm.which === 'a' ? road.path[0] : road.path[road.path.length - 1];
      end.z = target;
    }
  }
  // Repeated sweeps, because one pass only moves each excess to the next pair of points: with the
  // ends pinned, the profile has to walk the excess along the street until it is spread thin, and a
  // single sweep leaves a cliff wherever the fix landed. Eight sweeps is where it stops changing.
  for (const road of net.roads) limitGrade(road, 0.14, { pinEnds: true, sweeps: 8 });
  return net;
}

//--------------------------------------------------------------------------------------------------
//  Pass 6b — render paths
//--------------------------------------------------------------------------------------------------
/**
 * Resamples each carriageway to a coarser, smoother path for the renderer to sweep. The simulation
 * path stays as sampled — that is what crossings and junction trims were solved against — while the
 * geometry only needs enough points to stay within a few centimetres of it. This is the difference
 * between a city that builds in two seconds and one that builds in twenty.
 */
export function buildRenderPaths(net, opts = {}) {
  const tol = opts.tolerance ?? 0.12;
  const minStep = opts.minStep ?? 3.5;
  const maxStep = opts.maxStep ?? 26;
  let saved = 0;
  for (const road of net.roads) {
    const path = road.path;
    if (!path || path.length < 3) {
      road.renderPath = path;
      continue;
    }
    const out = [path[0]];
    let anchorIdx = 0;
    let s = 0;
    for (let i = 1; i < path.length; i++) {
      s += dist2(path[i - 1], path[i]);
      const last = i === path.length - 1;
      let far = false;
      const a = path[anchorIdx];
      const b = path[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const l2 = dx * dx + dy * dy || 1e-9;
      for (let k = anchorIdx + 1; k < i; k++) {
        const p = path[k];
        const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
        const ex = a.x + dx * t - p.x;
        const ey = a.y + dy * t - p.y;
        if (Math.hypot(ex, ey) > tol) {
          far = true;
          break;
        }
      }
      if (far || last || s > maxStep) {
        out.push(b);
        anchorIdx = i;
        s = 0;
      }
    }
    // Coarser than the design step wastes triangles without changing the silhouette.
    const keep = [];
    for (let i = 0; i < out.length; i++) {
      const prev = keep[keep.length - 1];
      if (i > 0 && i < out.length - 1 && prev && dist2(prev, out[i]) < minStep) continue;
      keep.push(out[i]);
    }
    if (keep.length < 2) keep.push(path[path.length - 1]);
    road.renderPath = keep;
    saved += path.length - keep.length;
  }
  return { pointsBefore: net.roads.reduce((n, r) => n + r.path.length, 0), pointsAfter: net.roads.reduce((n, r) => n + (r.renderPath ? r.renderPath.length : 0), 0), saved };
}

//--------------------------------------------------------------------------------------------------
//  Pass 7 — validation
//--------------------------------------------------------------------------------------------------
export function validateNetwork(net) {
  const issues = [];
  const push = (sev, code, msg, ref) => issues.push({ sev, code, msg, ...ref });
  const minRadius = { motorway: 220, trunk: 150, arterial: 90, collector: 55, local: 18, rural: 110, canyon: 24 };
  for (const r of net.roads) {
    if (r.length < 6) {
      // A sliver of junction surface between two junctions is expected geometry; anything else this
      // short is a street that should not exist.
      push(r.junctionSkin ? 'info' : 'error', 'SHORT_ROAD', `${r.cls} segment is only ${r.length.toFixed(1)} m long`, { roadId: r.id, x: r.path[0].x, y: r.path[0].y });
      continue;
    }
    const floorR = minRadius[r.cls];
    if (floorR) {
      let tightest = 0;
      let at = 0;
      for (let i = 1; i < r.path.length - 1; i++) {
        const k = curvatureAt(r.path, i, false);
        if (k > tightest) {
          tightest = k;
          at = i;
        }
      }
      const radius = tightest > 1e-6 ? 1 / tightest : Infinity;
      if (radius < floorR * 0.45) {
        push('warn', 'TIGHT_RADIUS', `${r.cls} radius ${radius.toFixed(0)} m against a ${floorR} m class minimum`, {
          roadId: r.id,
          x: r.path[at].x,
          y: r.path[at].y,
        });
      }
    }
    // The map is finite. A radial that runs off the edge is meant to run off the edge — that is how
    // the city stops without stopping in a circle — so free ends out there are information, not
    // errors, and everything inside the boundary is still held to the rule.
    const edge = net.extent * 0.46;
    const atEdge = (p) => Math.max(Math.abs(p.x), Math.abs(p.y)) > edge;
    if (!r.startNode && !r.endNode && !r.closedLoop) {
      const sev = atEdge(r.path[0]) && atEdge(r.path[r.path.length - 1]) ? 'info' : 'warn';
      const code = sev === 'info' ? 'MAP_EDGE' : 'DANGLING';
      push(sev, code, sev === 'info' ? `${r.cls} runs off the map edge` : `${r.cls} connects to nothing at either end`, { roadId: r.id, x: r.path[0].x, y: r.path[0].y });
    } else if (r.family >= 5) {
      if (!r.startNode) {
        const p0 = r.path[0];
        push(atEdge(p0) ? 'info' : 'warn', atEdge(p0) ? 'MAP_EDGE' : 'DANGLING_MAJOR', `${r.cls} has a free start at ${Math.round(p0.x)}, ${Math.round(p0.y)}`, { roadId: r.id, x: p0.x, y: p0.y });
      }
      if (!r.endNode) {
        const p1 = r.path[r.path.length - 1];
        push(atEdge(p1) ? 'info' : 'warn', atEdge(p1) ? 'MAP_EDGE' : 'DANGLING_MAJOR', `${r.cls} has a free end`, { roadId: r.id, x: p1.x, y: p1.y });
      }
    }
    const isPath = r.cls === 'footway' || r.cls === 'cycleway' || r.cls === 'path';
    if (r.profile && sectionOf(r.profile).lanes.length === 0 && r.family >= 2)
      push('error', 'NO_LANES', `profile "${r.profileId}" has no carriageway`, { roadId: r.id, x: r.path[0].x, y: r.path[0].y });
    if (isPath) push('info', 'PATH_ONLY', `${r.cls} carries no motor traffic`, { roadId: r.id, x: r.path[0].x, y: r.path[0].y });
    for (let i = 1; i < r.path.length; i++) {
      const dh = r.path[i].z - r.path[i - 1].z;
      const dl = dist2(r.path[i], r.path[i - 1]);
      if (dl > 0.3 && Math.abs(dh / dl) > 0.15) {
        push('warn', 'STEEP_GRADE', `${(Math.abs(dh / dl) * 100).toFixed(0)} % grade on ${r.cls}`, { roadId: r.id, x: r.path[i].x, y: r.path[i].y });
        break;
      }
    }
  }
  for (const n of net.nodes) {
    const lanes = n.arms.map((a) => a.lanes);
    if (lanes.length > 1 && Math.max(...lanes) - Math.min(...lanes) > 4)
      push('info', 'LANE_MISMATCH', `junction joins ${Math.min(...lanes)}-lane and ${Math.max(...lanes)}-lane approaches`, { nodeId: n.id, x: n.x, y: n.y });
    for (let i = 0; i < n.arms.length; i++) {
      for (let j = i + 1; j < n.arms.length; j++) {
        const d = (deltaAngle(n.arms[i].angle, n.arms[j].angle) * 180) / Math.PI;
        // Acute approaches are normal in an organic plan and only worth noting, not flagging: what
        // a highway engineer would call out is anything under 16°, where turning movements collide.
        if (d < 16) push('info', 'SHALLOW_ANGLE', `junction ${n.id} has a ${d.toFixed(0)}° approach angle`, { nodeId: n.id, x: n.x, y: n.y });
      }
    }
    const zs = n.arms.map((a) => (a.which === 'a' ? a.road.path[0].z : a.road.path[a.road.path.length - 1].z));
    if (zs.length > 1 && Math.max(...zs) - Math.min(...zs) > 2.5)
      push('error', 'GRADE_CLASH', `junction ${n.id} joins arms ${(Math.max(...zs) - Math.min(...zs)).toFixed(1)} m apart vertically`, { nodeId: n.id, x: n.x, y: n.y });
  }
  const errs = issues.filter((i) => i.sev === 'error').length;
  const warns = issues.filter((i) => i.sev === 'warn').length;
  // The panel shows the first four hundred issues, so the list is ordered by what the reader has to
  // act on rather than by the order the roads happen to be stored in: a hundred informational notes
  // about footways must not push the junctions that clash out of the report.
  const rank = { error: 0, warn: 1, info: 2 };
  const ordered = issues.slice().sort((a, b) => rank[a.sev] - rank[b.sev]);
  return { issues: ordered.slice(0, 400), errors: errs, warnings: warns, info: issues.length - errs - warns, clean: errs === 0 };
}

//--------------------------------------------------------------------------------------------------
//  Full build
//--------------------------------------------------------------------------------------------------
export function buildNetwork(net, opts = {}) {
  const trace = (label) => {
    if (!globalThis.__RETRACE) return;
    let max = 0;
    let maxRoad = null;
    for (const r of net.roads) if (r.length > max) { max = r.length; maxRoad = r; }
    let km = 0;
    for (const r of net.roads) km += r.length;
    globalThis.__RETRACE.push([label, net.roads.length, +max.toFixed(1), `${(km / 1000).toFixed(1)} km`, maxRoad ? `${maxRoad.id}:${maxRoad.cls}` : '-']);
  };
  const t0 = now();
  const report = { stages: {} };
  trace('start');
  sampleNetwork(net);
  trace('sample');
  const t1 = now();
  const attachReqs = attachEnds(net, opts.attach || {});
  trace('attach');
  const t2 = now();
  const dupes = dedupeRoads(net, opts.dedupe || {});
  report.duplicates = dupes;
  trace('dedupe');
  report.roadsBeforeCrossings = net.roads.length;
  if (globalThis.__REX) {
    const pre = [...net.roads].sort((a, b) => b.length - a.length).slice(0, 8).map((r) => [r.id, r.cls, +r.length.toFixed(0), Object.keys(r.tags).join(','), r.path.length, r.ctrl.length]);
    console.error('PRE-CROSS longest:', pre);
  }
  const crossReqs = resolveCrossings(net, opts.crossings || {});
  trace('crossings');
  const t3 = now();
  const stitched = stitchEnds(net, attachReqs.concat(crossReqs), opts.stitch || {});
  const t4 = now();
  createNodes(net, stitched.requests, opts.nodes || {});
  report.topology = dissolveShortEdges(net, opts.topology || {});
  trace('topology');
  planGrade(net, net.terrain);
  const t5 = now();
  buildJunctions(net, opts.junctions || {});
  // Trimming shortens every arm, which can leave a few metres of road between two junctions that
  // were already close. Those slivers are junction surface, not street, so they are dissolved here.
  report.topologyAfterTrim = dissolveShortEdges(net, {
    collapseLength: opts.topology?.collapseLength ?? 13,
    dissolveTurn: opts.topology?.dissolveTurn ?? 0.3,
    debrisLength: opts.topology?.debrisLengthSecond ?? 6,
    junctionSkin: true,
  });
  trace('topology2');
  // Heights are settled last, on the trimmed arms: a junction has to read as one level, and only
  // after trimming is the arm end the point that actually meets it.
  relaxNodes(net, opts.relief || {});
  trace('relief');
  report.renderPaths = buildRenderPaths(net, opts.render || {});
  const t6 = now();
  report.stages = {
    sample: t1 - t0,
    attach: t2 - t1,
    intersect: t3 - t2,
    stitch: t4 - t3,
    grade: t5 - t4,
    junction: t6 - t5,
  };
  report.attachments = attachReqs.length;
  report.crossings = crossReqs.length;
  report.welds = stitched.welded;
  report.nodes = net.nodes.length;
  report.validation = validateNetwork(net);
  report.ms = t6 - t0;
  net.dirty = false;
  return report;
}

const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
