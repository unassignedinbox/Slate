//==================================================================================================
//  ROADEDITOR — CITY GENERATOR
//==================================================================================================
//  Builds a whole metro: districts, a ring-and-radial primary network, recursive block subdivision
//  with curved local streets, cul-de-sacs, a waterfront, a motorway with interchanges, a canyon loop
//  for the driving roads, a railway with real level crossings and a subway under the arterials.
//
//  The subdivision works on convex regions. A cut always splits a region in two; the children are
//  inset along the new edge by the new road's corridor width, and every edge remembers how far it
//  was inset so the next road can be extended back out to meet its neighbour. That bookkeeping is
//  what stops the generator from producing the classic artefacts — overlapping corridors, roads
//  that stop 3 m short of the next street, and junctions that never quite close.
//==================================================================================================

import {
  clamp,
  lerp,
  Rng,
  SegmentGrid,
  TAU,
  DEG,
  polyArea,
  polyCentroid,
  polyClean,
  ensureCCW,
  insetConvex,
  clipConvexHalfPlane,
  clipSegmentToConvex,
  sideOfLine,
  dist2,
  MAT,
} from './core.js';
import { sampleControlPoints, resampleAdaptive, smoothPath, pathLength, alongPath, offsetPath, pathFrames, filletPolyline } from './spline.js';
import { PROFILES, CLASS_DEFAULT, sectionOf, halfWidthOf } from './profiles.js';
import { RoadNetwork, Road, Railway, SubwayLine, buildNetwork, newId } from './network.js';
import { Terrain } from './terrain.js';

//--------------------------------------------------------------------------------------------------
//  Feature toggles. The City Generator panel flips these and the whole cross-section follows: bus
//  lanes become general traffic, cycle lanes and parking bays disappear, footways drop back to a
//  verge. Derived profiles are cached so a regeneration does not rebuild them.
//--------------------------------------------------------------------------------------------------
const derivedCache = new Map();
export function deriveProfile(base, flags) {
  const key = `${base.id}|${flags.bus ? 1 : 0}${flags.cycle ? 1 : 0}${flags.parking ? 1 : 0}${flags.sidewalk ? 1 : 0}`;
  if (derivedCache.has(key)) return derivedCache.get(key);
  const bands = [];
  for (const b of base.bands) {
    if (b.t === 'lane') {
      if (b.kind === 'bus' && !flags.bus) {
        bands.push({ ...b, kind: 'car' });
        continue;
      }
      if (b.kind === 'bike' && !flags.cycle) continue;
      if (b.kind === 'parking' && !flags.parking) continue;
    }
    if (b.t === 'walk' && !flags.sidewalk) continue;
    if (b.t === 'rail' && flags.tram === false) continue;
    bands.push(b);
  }
  const cleaned = [];
  for (let i = 0; i < bands.length; i++) {
    const b = bands[i];
    if (b.t === 'kerb') {
      const prev = bands[i - 1];
      const next = bands[i + 1];
      if (!prev || !next || prev.t === 'kerb' || next.t === 'kerb' || next.t === 'guard') continue;
    }
    cleaned.push(b);
  }
  const out = { ...base, id: `${base.id}${key.slice(base.id.length + 1) ? '-d' + hashCode(key).toString(36) : ''}`, baseId: base.id, bands: cleaned, derived: key };
  derivedCache.set(key, out);
  return out;
}
function hashCode(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h >>> 0;
}

//--------------------------------------------------------------------------------------------------
//  District styles. Each style is what a local planner would have written down: how big the blocks
//  are, how much the streets wander, which classes appear at which subdivision level, and which of
//  the cross-section library's profiles are allowed.
//--------------------------------------------------------------------------------------------------
const STYLES = {
  core: {
    label: 'Central business district',
    minBlock: 62, maxDepth: 5, bow: 1.3, bowScale: 0.02, cutJitter: 0.09, openBlock: 0.01,
    classes: ['arterial', 'collector', 'local', 'alley', 'alley', 'alley'],
    profiles: {
      arterial: [['arterial-2x2-complete', 3], ['trunk-2x2-bus', 1]],
      collector: [['arterial-2x2-complete', 2], ['arterial-2x2', 1], ['collector-1x1-parking', 2]],
      local: [['oneway-narrow', 3], ['woonerf', 2], ['residential-1x1', 1]],
      alley: [['alley', 3], ['oneway-narrow', 1], ['woonerf', 1]],
    },
    oneWay: 0.55, culDeSac: 0.02,
  },
  midtown: {
    label: 'Midtown mixed use',
    minBlock: 74, maxDepth: 5, bow: 1.8, bowScale: 0.03, cutJitter: 0.13, openBlock: 0.02,
    classes: ['arterial', 'collector', 'local', 'local', 'alley'],
    profiles: {
      arterial: [['arterial-2x2-complete', 3], ['boulevard-tram', 1]],
      collector: [['collector-1x1-parking', 3], ['arterial-2x2', 1]],
      local: [['residential-1x1-cycle', 2], ['residential-1x1', 2], ['oneway-narrow', 2]],
      alley: [['alley', 2], ['oneway-narrow', 1]],
    },
    oneWay: 0.3, culDeSac: 0.05,
  },
  residential: {
    label: 'Inner residential',
    minBlock: 86, maxDepth: 4, bow: 4.2, bowScale: 0.05, cutJitter: 0.2, openBlock: 0.03,
    classes: ['collector', 'collector', 'local', 'local', 'local'],
    profiles: {
      collector: [['collector-1x1-parking', 3], ['residential-1x1', 1]],
      local: [['residential-1x1-cycle', 3], ['residential-1x1', 2], ['woonerf', 1]],
      alley: [['alley', 1]],
    },
    oneWay: 0.08, culDeSac: 0.14,
  },
  suburb: {
    label: 'Suburban',
    minBlock: 104, maxDepth: 4, bow: 7.5, bowScale: 0.07, cutJitter: 0.28, openBlock: 0.05,
    classes: ['collector', 'local', 'local', 'local'],
    profiles: {
      collector: [['collector-1x1-parking', 2], ['rural-wide', 1]],
      local: [['residential-1x1', 3], ['residential-1x1-cycle', 1], ['woonerf', 1]],
      alley: [['alley', 1]],
    },
    oneWay: 0.0, culDeSac: 0.24,
  },
  industrial: {
    label: 'Industrial estate',
    minBlock: 132, maxDepth: 4, bow: 2.0, bowScale: 0.015, cutJitter: 0.05, openBlock: 0.1,
    classes: ['arterial', 'collector', 'service', 'service'],
    profiles: {
      arterial: [['arterial-2x2', 2], ['industrial-service', 1], ['trunk-2x2-bus', 1]],
      collector: [['industrial-service', 3], ['collector-1x1-parking', 1]],
      local: [['industrial-service', 3]],
      service: [['industrial-service', 3], ['alley', 1]],
    },
    oneWay: 0.25, culDeSac: 0.22,
  },
  waterfront: {
    label: 'Waterfront quarter',
    minBlock: 92, maxDepth: 4, bow: 3.0, bowScale: 0.04, cutJitter: 0.16, openBlock: 0.05,
    classes: ['collector', 'collector', 'local', 'local'],
    profiles: {
      collector: [['collector-1x1-parking', 2], ['boulevard-tram', 1]],
      local: [['residential-1x1-cycle', 2], ['woonerf', 2], ['oneway-narrow', 1]],
      alley: [['alley', 1]],
    },
    oneWay: 0.2, culDeSac: 0.15,
  },
  garden: {
    label: 'Garden suburb',
    minBlock: 116, maxDepth: 4, bow: 9.0, bowScale: 0.08, cutJitter: 0.32, openBlock: 0.12,
    classes: ['collector', 'local', 'local', 'local'],
    profiles: {
      collector: [['collector-1x1-parking', 1], ['rural-wide', 1]],
      local: [['residential-1x1', 2], ['woonerf', 2], ['rural-2lane', 1]],
    },
    oneWay: 0.0, culDeSac: 0.3,
  },
  business: {
    label: 'Business park',
    minBlock: 142, maxDepth: 4, bow: 5.0, bowScale: 0.03, cutJitter: 0.12, openBlock: 0.14,
    classes: ['arterial', 'collector', 'collector', 'local'],
    profiles: {
      arterial: [['arterial-2x2-complete', 2], ['arterial-2x2', 1]],
      collector: [['collector-1x1-parking', 2], ['residential-1x1-cycle', 1]],
      local: [['residential-1x1-cycle', 2], ['woonerf', 1]],
    },
    oneWay: 0.15, culDeSac: 0.26,
  },
  parkland: {
    label: 'Parkland / open',
    minBlock: 164, maxDepth: 3, bow: 6.0, bowScale: 0.02, cutJitter: 0.1, openBlock: 0.3,
    classes: ['collector', 'local', 'track'],
    profiles: {
      collector: [['rural-wide', 1], ['collector-1x1-parking', 1]],
      local: [['rural-2lane', 2], ['gravel-track', 1], ['canyon-2lane', 1]],
    },
    oneWay: 0, culDeSac: 0.14,
  },
};

export const DISTRICT_TYPES = Object.keys(STYLES);

//--------------------------------------------------------------------------------------------------
//  Parameters
//--------------------------------------------------------------------------------------------------
export const PRESETS = {
  metro: { label: 'Metro — 6 km, NFS scale', extent: 6000, relief: 1.15, rings: 2, radials: 9, motorways: 2, canyon: true, river: true, rail: 2, subway: 3, blocks: 1.0 },
  city: { label: 'City — 3 km', extent: 3000, relief: 0.8, rings: 1, radials: 7, motorways: 1, canyon: true, river: true, rail: 1, subway: 2, blocks: 1.0 },
  town: { label: 'Town — 1.6 km', extent: 1600, relief: 0.55, rings: 1, radials: 5, motorways: 0, canyon: true, river: false, rail: 1, subway: 0, blocks: 1.0 },
  island: { label: 'Island circuit — 5 km', extent: 5000, relief: 1.6, rings: 1, radials: 5, motorways: 0, canyon: true, river: true, rail: 0, subway: 0, blocks: 0.7 },
};

export const DEFAULT_PARAMS = {
  preset: 'city',
  seed: 20261012,
  extent: 3000,
  relief: 0.9,
  rings: 1,
  radials: 7,
  motorways: 1,
  canyon: true,
  river: true,
  rail: 1,
  subway: 2,
  density: 1.0,
  bus: true,
  cycle: true,
  parking: true,
  sidewalk: true,
  scale: 1.0,
};

//--------------------------------------------------------------------------------------------------
//  Main entry
//--------------------------------------------------------------------------------------------------
export function generateCity(params = {}) {
  const P = { ...DEFAULT_PARAMS, ...params };
  const rng = new Rng(P.seed);
  const t0 = now();
  const terrain = new Terrain(P.extent, rng.fork(7), {
    relief: P.relief,
    hills: 0.6,
    river: P.river ? { width: P.extent * rng.f(0.022, 0.04), depth: rng.f(4, 7) } : null,
  });
  const net = new RoadNetwork(P.extent);
  net.terrain = terrain;
  net.meta = { seed: P.seed, preset: P.preset, generated: Date.now() };

  const ctx = {
    P,
    rng,
    net,
    terrain,
    flags: { bus: P.bus, cycle: P.cycle, parking: P.parking, sidewalk: P.sidewalk, tram: true },
    blocks: [],
    stats: {},
  };

  const mapPoly = makeMapRegion(P.extent, rng);

  // 1. Districts
  ctx.districts = makeDistricts(P.extent, rng, P);
  net.districts = ctx.districts;
  ctx.styleOf = (x, y) => styleAt(ctx.districts, x, y).style;
  ctx.districtAt = (x, y) => styleAt(ctx.districts, x, y);

  ctx.netIndex = new SegmentGrid(40);
  // 2. Primary skeleton
  const core = buildCore(ctx, mapPoly);
  const rings = buildRings(ctx, mapPoly, core);
  const radials = buildRadials(ctx, mapPoly, core);
  if (P.motorways > 0) buildMotorways(ctx, mapPoly);
  if (P.canyon) buildCanyonLoop(ctx, mapPoly);
  buildWaterfront(ctx, mapPoly);
  buildDiagonals(ctx, mapPoly);

  // 3. Blocks
  const regions = carvePrimaryRegions(ctx, mapPoly, rings, radials);
  ctx.stats.regions = regions.length;
  for (const region of regions) subdivideRegion(ctx, region, 0);
  ctx.stats.counters = ctx.counters;
  addBlockFillers(ctx);

  net.blocks = ctx.blocks;

  if (P.skeletonOnly || P.stopAfterStreets) return { net, terrain, report: { stages: {}, validation: { issues: [], errors: 0, warnings: 0, info: 0 } }, ctx };

  // 4. Topology
  ctx.topology = buildNetwork(net, {
    attach: { snap: 8, reach: 44 },
    crossings: { autoGrade: true },
    stitch: { weld: 2.4 },
  });

  // 5. Water bridges (assigned before grading so the lift lands in the same pass)
  terrain.stampRoads = null;
  assignWaterBridges(net, terrain);

  // 6. Rail and subway
  if (P.rail > 0) buildRailways(ctx, mapPoly);
  if (P.subway > 0) buildSubway(ctx);

  // 7. Flatten the ground under the roads now that every elevation is final
  stampTerrain(terrain, net);

  ctx.stats.ms = now() - t0;
  net.meta.stats = ctx.stats;
  return { net, terrain, report: ctx.topology, ctx };
}

const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

//--------------------------------------------------------------------------------------------------
//  Map region and districts
//--------------------------------------------------------------------------------------------------
function makeMapRegion(E, rng) {
  const n = rng.i(13, 19);
  const pts = [];
  const squash = rng.f(0.9, 1.1);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const r = (E / 2) * rng.f(0.88, 1.0);
    pts.push({ x: Math.cos(a) * r * squash, y: Math.sin(a) * r / squash });
  }
  return ensureCCW(polyClean(pts));
}

function makeDistricts(E, rng, P) {
  const seeds = [];
  const R = E / 2;
  // Centre first, then a ring of satellites, then a scattering of edge districts.
  seeds.push({ x: rng.gauss(0, R * 0.05), y: rng.gauss(0, R * 0.05), style: STYLES.core, weight: 1.6, name: 'Central' });
  const names = ['North', 'North East', 'East', 'South East', 'South', 'South West', 'West', 'North West'];
  const inner = rng.i(4, 6);
  for (let i = 0; i < inner; i++) {
    const a = (i / inner) * TAU + rng.f(-0.3, 0.3);
    const r = R * rng.f(0.34, 0.5);
    seeds.push({ x: Math.cos(a) * r, y: Math.sin(a) * r, style: pickStyle(rng, 'inner'), weight: rng.f(0.8, 1.3), name: names[i % 8] + ' Quarter' });
  }
  const outer = rng.i(5, 8);
  for (let i = 0; i < outer; i++) {
    const a = (i / outer) * TAU + rng.f(-0.35, 0.35);
    const r = R * rng.f(0.72, 0.98);
    seeds.push({ x: Math.cos(a) * r, y: Math.sin(a) * r, style: pickStyle(rng, 'outer'), weight: rng.f(0.7, 1.2), name: names[i % 8] + ' District' });
  }
  return seeds;
}

function pickStyle(rng, band) {
  if (band === 'inner') {
    return rng.weighted([
      [STYLES.midtown, 3],
      [STYLES.residential, 3],
      [STYLES.industrial, 1],
      [STYLES.business, 1],
      [STYLES.core, 1],
    ]);
  }
  return rng.weighted([
    [STYLES.suburb, 4],
    [STYLES.garden, 2],
    [STYLES.industrial, 2],
    [STYLES.business, 2],
    [STYLES.residential, 2],
    [STYLES.parkland, 2],
    [STYLES.waterfront, 1],
  ]);
}

/** Weighted nearest-seed lookup — a cheap multiplicatively-weighted Voronoi. */
function styleAt(districts, x, y) {
  let best = null;
  let bestScore = Infinity;
  for (const d of districts) {
    const dd = (x - d.x) * (x - d.x) + (y - d.y) * (y - d.y);
    const score = dd / (d.weight * d.weight);
    if (score < bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best || { style: STYLES.residential, name: 'City' };
}

//--------------------------------------------------------------------------------------------------
//  Region utilities: a convex polygon plus a per-edge inset ledger.
//--------------------------------------------------------------------------------------------------
function regionFromPoly(poly) {
  return { poly: ensureCCW(poly), edges: poly.map(() => ({ inset: 0, road: false })) };
}

function regionArea(r) {
  return Math.abs(polyArea(r.poly));
}

/** True when every turn of the boundary goes the same way. Cuts assume it; see subdivideRegion. */
function isConvex(poly) {
  const n = poly.length;
  if (n < 4) return true;
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const c = poly[(i + 2) % n];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-6) continue;
    const s2 = cross > 0 ? 1 : -1;
    if (sign === 0) sign = s2;
    else if (s2 !== sign) return false;
  }
  return true;
}

function regionBounds(poly) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

/** Inset with a different amount per edge, keeping free edges where they are. */
function insetRegion(poly, insets) {
  const n = poly.length;
  const ccw = polyArea(poly) > 0;
  const s = ccw ? 1 : -1;
  const lines = [];
  for (let i = 0; i < n; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % n];
    let dx = q.x - p.x;
    let dy = q.y - p.y;
    const l = Math.hypot(dx, dy) || 1;
    dx /= l;
    dy /= l;
    const nx = -dy * s;
    const ny = dx * s;
    const d = insets[i] ?? insets[0] ?? 0;
    lines.push({ px: p.x + nx * d, py: p.y + ny * d, dx, dy });
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const A = lines[(i - 1 + n) % n];
    const B = lines[i];
    const den = A.dx * B.dy - A.dy * B.dx;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((B.px - A.px) * B.dy - (B.py - A.py) * B.dx) / den;
    out.push({ x: A.px + A.dx * t, y: A.py + A.dy * t });
  }
  return polyClean(out);
}

/** Exact extent of a convex polygon measured along an axis. */
function extentAlong(poly, axis) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of poly) {
    const d = p.x * axis.x + p.y * axis.y;
    if (d < lo) lo = d;
    if (d > hi) hi = d;
  }
  return hi - lo;
}

/**
 * Minimum width of a convex polygon: the smallest distance between any edge's supporting line and
 * the opposite vertex. Bounding boxes lie about diagonal slivers, and a sliver that claims to be
 * 200 m wide while being 12 m thick is what produces streets with no room for a frontage.
 */
function minWidthOf(poly) {
  let best = Infinity;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    let bestD = 0;
    for (const p of poly) {
      const d = Math.abs(sideOfLine(p, a, b));
      if (d > bestD) bestD = d;
    }
    if (bestD < best) best = bestD;
  }
  return best === Infinity ? 0 : best;
}

function matchParentEdge(p, q, parent) {
  for (let i = 0; i < parent.poly.length; i++) {
    const a = parent.poly[i];
    const b = parent.poly[(i + 1) % parent.poly.length];
    if (Math.abs(sideOfLine(p, a, b)) < 0.06 && Math.abs(sideOfLine(q, a, b)) < 0.06) return i;
  }
  return -1;
}

/**
 * Turns a cut into the next region. The cut is applied twice: once at the road centreline, which is
 * the boundary both neighbours share, and again inset by the new road's corridor half-width for
 * this side. Doing the inset as a second half-plane clip rather than by moving each edge's
 * supporting line is what keeps every region convex no matter how tight the corner it was cut out
 * of: a large per-edge offset against a short edge flips a corner and produces a bow-tie, and a
 * bow-tie region is a bug generator for everything downstream.
 */
function childRegion(parent, cutA, cutB, cutInset, keepLeft, cutRoad = null) {
  let dx = cutB.x - cutA.x;
  let dy = cutB.y - cutA.y;
  const l = Math.hypot(dx, dy) || 1;
  dx /= l;
  dy /= l;
  const s = keepLeft ? 1 : -1;
  const ax = cutA.x + -dy * cutInset * s;
  const ay = cutA.y + dx * cutInset * s;
  const bx = cutB.x + -dy * cutInset * s;
  const by = cutB.y + dx * cutInset * s;
  const clean = clipConvexHalfPlane(parent.poly, { x: ax, y: ay }, { x: bx, y: by }, keepLeft);
  if (clean.length < 3) return null;
  const edges = [];
  for (let i = 0; i < clean.length; i++) {
    const p = clean[i];
    const q = clean[(i + 1) % clean.length];
    const onCut =
      Math.abs(sideOfLine(p, { x: ax, y: ay }, { x: bx, y: by })) < 0.12 &&
      Math.abs(sideOfLine(q, { x: ax, y: ay }, { x: bx, y: by })) < 0.12;
    if (onCut) {
      // The corridor along this edge is the street that was just laid on it, so the edge inset is
      // that street's half width — never the parent's inset plus a margin. Inset is a distance to a
      // centreline: adding it up per level walks every deep cut away from the street it should meet,
      // which is what turns a subdivision into a fan of floating fragments.
      edges.push({ inset: cutRoad ? cutRoad.halfWidth : cutInset, road: true, source: cutRoad ? cutRoad.id : null, first: !cutRoad });
      continue;
    }
    const pi = matchParentEdge(p, q, parent);
    if (pi >= 0) {
      const copy = { ...parent.edges[pi] };
      // Only the very first cut edge of a corridor is a road end; the rest is the corridor's flank.
      copy.first = false;
      edges.push(copy);
    } else edges.push({ inset: 0, road: false, first: false, source: null });
  }
  return { poly: clean, edges };
}

//--------------------------------------------------------------------------------------------------
//  Road construction helpers
//--------------------------------------------------------------------------------------------------
function profileFor(ctx, cls, style) {
  const list = style.profiles[cls] || style.profiles.local || [['residential-1x1', 1]];
  const id = ctx.rng.weighted(list);
  const base = PROFILES[id] || PROFILES[CLASS_DEFAULT[cls]] || PROFILES['residential-1x1'];
  return deriveProfile(base, ctx.flags);
}

/**
 * Incremental spatial index of every carriageway segment laid so far. The generator solves its
 * street ends against this index, which is the only reliable way to connect a new street to the
 * one it is meant to meet: region bookkeeping drifts as soon as corridors are cut in a different
 * order, but the actual centreline never lies.
 */
function indexRoad(ctx, road) {
  if (!ctx.netIndex) return;
  const p = road.path;
  for (let i = 0; i < p.length - 1; i++) ctx.netIndex.insert({ road, i }, p[i].x, p[i].y, p[i + 1].x, p[i + 1].y);
}

/**
 * Distance from `p` along `dir` to the nearest carriageway centreline ahead of it. Returns 0 when
 * there is nothing within `max`.
 */
function reachToNetwork(ctx, p, dir, max = 42, exclude = null) {
  if (!ctx.netIndex) return 0;
  let best = 0;
  ctx.netIndex.query(p.x - max, p.y - max, p.x + max, p.y + max, (item) => {
    if (exclude && item.road === exclude) return;
    const a = item.road.path[item.i];
    const b = item.road.path[item.i + 1];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const el = Math.hypot(ex, ey);
    if (el < 1e-6) return;
    const ux = ex / el;
    const uy = ey / el;
    const den = dir.x * -uy + dir.y * ux;
    if (Math.abs(den) < 1e-3) return;
    const t = ((a.x - p.x) * -uy + (a.y - p.y) * ux) / den;
    if (t < -0.5 || t > max) return;
    const u = ((p.x + dir.x * t - a.x) * ux + (p.y + dir.y * t - a.y) * uy) / el;
    if (u < -0.05 || u > 1.05) return;
    if (!best || Math.abs(t) < Math.abs(best)) best = t;
  });
  return best;
}

function makeRoad(ctx, cfg) {
  const style = cfg.style || STYLES.residential;
  const profile = cfg.profile || profileFor(ctx, cfg.cls, style);
  const road = new Road({
    cls: cfg.cls,
    profile,
    ctrl: cfg.ctrl,
    closedLoop: cfg.closedLoop,
    name: cfg.name,
    districtId: cfg.districtId,
    order: cfg.order ?? 0,
    tags: cfg.tags || {},
    oneway: cfg.oneway,
  });
  road.sample(cfg.minSpacing ?? 2.5, cfg.maxSpacing ?? 9);
  ctx.net.roads.push(road);
  indexRoad(ctx, road);
  return road;
}

//--------------------------------------------------------------------------------------------------
//  Primary skeleton — core loop, ring roads, radials
//--------------------------------------------------------------------------------------------------
function buildCore(ctx, mapPoly) {
  const { rng, net, P } = ctx;
  const R = P.extent * 0.055;
  const arms = Math.max(3, Math.min(5, ctx.P.radials ? 4 : 3));
  const ctrl = [];
  const n = 7;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    ctrl.push({ x: Math.cos(a) * R * rng.f(0.92, 1.08), y: Math.sin(a) * R * rng.f(0.92, 1.08), z: 0 });
  }
  const road = makeRoad(ctx, {
    cls: 'collector',
    ctrl,
    closedLoop: true,
    name: 'Central loop',
    tags: { primary: true, layer: 1 },
    style: STYLES.core,
    maxSpacing: 7,
  });
  return { road, radius: R };
}

function ringPath(R, n, rng, jitter = 0.05) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rng.f(-0.04, 0.04);
    const r = R * rng.f(1 - jitter, 1 + jitter);
    pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r, z: 0 });
  }
  pts.push({ ...pts[0] });
  return pts;
}

function buildRings(ctx, mapPoly, core) {
  const { rng, P } = ctx;
  const rings = [];
  const count = P.rings;
  for (let i = 0; i < count; i++) {
    const R = P.extent * (0.185 + i * 0.145) * rng.f(0.94, 1.06);
    const n = 14 + i * 4;
    const ctrl = ringPath(R, n, rng, 0.05);
    const cls = i === 0 ? 'arterial' : 'trunk';
    const road = makeRoad(ctx, {
      cls,
      ctrl,
      closedLoop: true,
      name: i === 0 ? 'Inner ring road' : 'Outer ring road',
      tags: { primary: true, ring: i, layer: 2 },
      style: STYLES.midtown,
      maxSpacing: 12,
    });
    rings.push({ road, poly: ctrl.map((p) => ({ x: p.x, y: p.y })), inset: road.halfWidth + 7 });
  }
  return rings;
}

/** Two long straight avenues cutting the grid, the way a baroque plan does. */
function buildDiagonals(ctx, mapPoly) {
  const { rng, P } = ctx;
  const count = P.extent > 2500 ? rng.i(1, 3) : rng.i(0, 1);
  for (let i = 0; i < count; i++) {
    const a = rng.f(0, TAU);
    const off = P.extent * rng.f(-0.16, 0.16);
    const dir = { x: Math.cos(a), y: Math.sin(a) };
    const nrm = { x: -dir.y, y: dir.x };
    const half = P.extent * 0.5;
    const ctrl = [
      { x: dir.x * -half + nrm.x * off, y: dir.y * -half + nrm.y * off, z: 0 },
      { x: nrm.x * off + rng.gauss(0, 12), y: nrm.y * off + rng.gauss(0, 12), z: 0 },
      { x: dir.x * half + nrm.x * off, y: dir.y * half + nrm.y * off, z: 0 },
    ];
    const road = makeRoad(ctx, {
      cls: 'arterial',
      ctrl,
      name: `${['Grand', 'Liberty', 'Victory', 'Harbour'][i % 4]} Avenue`,
      tags: { primary: true, diagonal: true },
      style: STYLES.midtown,
      maxSpacing: 14,
    });
    ctx.diagonals = ctx.diagonals || [];
    ctx.diagonals.push({ road, chord: [{ x: ctrl[0].x, y: ctrl[0].y }, { x: ctrl[2].x, y: ctrl[2].y }], inset: road.halfWidth + 7 });
  }
}

function buildRadials(ctx, mapPoly, core) {
  const { rng, P, net } = ctx;
  const radials = [];
  const count = clamp(P.radials, 3, 12);
  const phase = rng.f(0, TAU);
  const innerR = P.extent * 0.05;
  for (let i = 0; i < count; i++) {
    const a = phase + (i / count) * TAU + rng.f(-0.06, 0.06);
    const reach = P.extent * rng.f(0.42, 0.52);
    const ctrl = [];
    const steps = 5;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const r = lerp(innerR, reach, t);
      const ang = a + Math.sin(t * Math.PI) * rng.f(-0.09, 0.09) + t * rng.f(-0.05, 0.05);
      ctrl.push({ x: Math.cos(ang) * r, y: Math.sin(ang) * r, z: 0 });
    }
    const cls = i % 3 === 0 ? 'trunk' : 'arterial';
    const road = makeRoad(ctx, {
      cls,
      ctrl,
      name: `${['', 'North ', 'East ', 'South ', 'West '][i % 5]}Avenue ${i + 1}`,
      tags: { primary: true, radial: i },
      style: STYLES.midtown,
      maxSpacing: 12,
    });
    radials.push(road);
  }
  return radials;
}

function buildMotorways(ctx, mapPoly) {
  const { rng, P } = ctx;
  for (let m = 0; m < P.motorways; m++) {
    const angle = rng.f(0, Math.PI) + (m * Math.PI) / Math.max(1, P.motorways);
    const dir = { x: Math.cos(angle), y: Math.sin(angle) };
    const nrm = { x: -dir.y, y: dir.x };
    const half = P.extent * 0.55;
    const ctrl = [];
    const steps = 8;
    const offset = P.extent * rng.f(-0.12, 0.12);
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const along = (t - 0.5) * 2 * half;
      const wob = Math.sin(t * Math.PI * 1.6 + rng.f(0, 3)) * P.extent * 0.055 + offset;
      ctrl.push({ x: dir.x * along + nrm.x * wob, y: dir.y * along + nrm.y * wob, z: 0 });
    }
    const main = makeRoad(ctx, {
      cls: 'motorway',
      ctrl,
      name: m === 0 ? 'M1 City Motorway' : `M${m + 1} Ring Motorway`,
      tags: { primary: true, motorway: true, layer: 3 },
      style: STYLES.core,
      maxSpacing: 16,
    });
    // Slip roads at every grade-separated crossing along the motorway.
    addRamps(ctx, main, rng);
  }
}

function addRamps(ctx, motorway, rng) {
  const path = motorway.path;
  const candidates = [];
  for (let s = motorway.length * 0.16; s < motorway.length * 0.84; s += 40) {
    const p = alongPath(path, s, false);
    // Only where something crossing exists close by will a ramp make sense; the topology pass
    // attaches the ends, so a ramp start that finds nothing simply dangles and is dropped.
    candidates.push({ s, p });
  }
  const chosen = [];
  const spacing = 340;
  for (const c of candidates) {
    if (chosen.length && Math.abs(c.s - chosen[chosen.length - 1].s) < spacing) continue;
    if (rng.bool(0.55)) chosen.push(c);
  }
  for (const c of chosen) {
    for (const side of [-1, 1]) {
      if (rng.bool(0.25)) continue;
      const s0 = clamp(c.s - 150, 10, motorway.length - 10);
      const s1 = clamp(c.s + 130, 10, motorway.length - 10);
      const a = alongPath(path, s0, false);
      const b = alongPath(path, s1, false);
      const la = { x: -a.ty, y: a.tx };
      const lb = { x: -b.ty, y: b.tx };
      const w = motorway.halfWidth;
      const out = 26;
      const ctrl = [
        { x: a.x + la.x * w * side, y: a.y + la.y * w * side, z: 0 },
        { x: a.x + la.x * (w + out) * side + a.tx * 26, y: a.y + la.y * (w + out) * side + a.ty * 26, z: 0 },
        { x: (a.x + b.x) / 2 + la.x * (w + out * 1.5) * side, y: (a.y + b.y) / 2 + la.y * (w + out * 1.5) * side, z: 0 },
        { x: b.x + lb.x * (w + out * 0.6) * side - b.tx * 18, y: b.y + lb.y * (w + out * 0.6) * side - b.ty * 18, z: 0 },
        { x: b.x + lb.x * w * side, y: b.y + lb.y * w * side, z: 0 },
      ];
      makeRoad(ctx, {
        cls: 'ramp',
        ctrl,
        name: 'Slip road',
        tags: { ramp: true, motorway: motorway.name },
        style: STYLES.core,
        minSpacing: 2,
        maxSpacing: 6,
      });
    }
  }
}

/** A driving road around the rim: long curves, hairpins and guardrails, NFS country. */
function buildCanyonLoop(ctx, mapPoly) {
  const { rng, P } = ctx;
  const R = P.extent * rng.f(0.4, 0.46);
  const n = rng.i(22, 32);
  const seedA = rng.f(0, 10);
  const seedB = rng.f(0, 10);
  const amp = rng.f(0.05, 0.11);
  const ctrl = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    // Two low-frequency terms keep the rim sweeping instead of zig-zagging.
    const wob = Math.sin(a * 3 + seedA) * 0.55 + Math.sin(a * 1 + seedB) * 0.45;
    const r = R * (1 + wob * amp);
    ctrl.push({ x: Math.cos(a) * r, y: Math.sin(a) * r, z: 0 });
  }
  ctrl.push({ ...ctrl[0] });
  const loop = makeRoad(ctx, {
    cls: 'canyon',
    ctrl,
    closedLoop: true,
    name: 'Rim circuit',
    tags: { canyon: true, scenic: true },
    style: STYLES.parkland,
    minSpacing: 2.5,
    maxSpacing: 8,
  });
  // A couple of hairpin spurs hanging off the circuit for the driving loop.
  for (let i = 0; i < rng.i(2, 4); i++) {
    const s = rng.f(0.1, 0.9) * loop.length;
    const p = alongPath(loop.path, s, true);
    const nrm = { x: -p.ty, y: p.tx };
    const inward = p.x * nrm.x + p.y * nrm.y > 0 ? -1 : 1;
    const len = P.extent * rng.f(0.06, 0.13);
    const dir = { x: rng.f(-1, 1), y: rng.f(-1, 1) };
    const dl = Math.hypot(dir.x, dir.y) || 1;
    dir.x /= dl;
    dir.y /= dl;
    const ctrl2 = [
      { x: p.x, y: p.y, z: 0 },
      { x: p.x + dir.x * len * 0.35 + nrm.x * inward * len * 0.25, y: p.y + dir.y * len * 0.35 + nrm.y * inward * len * 0.25, z: 0 },
      { x: p.x + dir.x * len * 0.7 - nrm.x * inward * len * 0.3, y: p.y + dir.y * len * 0.7 - nrm.y * inward * len * 0.3, z: 0 },
      { x: p.x + dir.x * len - nrm.x * inward * len * 0.15, y: p.y + dir.y * len - nrm.y * inward * len * 0.15, z: 0 },
    ];
    makeRoad(ctx, {
      cls: 'canyon',
      ctrl: ctrl2,
      name: 'Hairpin spur',
      tags: { canyon: true, spur: true },
      style: STYLES.parkland,
      minSpacing: 2,
      maxSpacing: 6,
    });
  }
  return loop;
}

function buildWaterfront(ctx, mapPoly) {
  const { terrain, P, rng } = ctx;
  if (!terrain.river) return;
  const path = terrain.river.path;
  const offset = terrain.river.width * 0.5 + 12;
  const side = rng.bool() ? 1 : -1;
  const ctrl = [];
  for (let i = 0; i < path.length; i += 2) {
    const a = path[Math.max(0, i - 1)];
    const b = path[Math.min(path.length - 1, i + 1)];
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = -(b.y - a.y) / l;
    const ny = (b.x - a.x) / l;
    ctrl.push({ x: path[i].x + nx * offset * side, y: path[i].y + ny * offset * side, z: 0 });
  }
  if (ctrl.length < 3) return;
  makeRoad(ctx, {
    cls: 'footway',
    profile: deriveProfile(PROFILES['promenade'], ctx.flags),
    ctrl,
    name: 'River promenade',
    tags: { waterfront: true, path: true },
    style: STYLES.waterfront,
    minSpacing: 3,
    maxSpacing: 12,
  });
  // A riverside drive on the same side, set back behind the promenade.
  const ctrl2 = ctrl.map((p, i) => {
    const q = ctrl[Math.min(ctrl.length - 1, i + 1)];
    const r = ctrl[Math.max(0, i - 1)];
    const l = Math.hypot(q.x - r.x, q.y - r.y) || 1;
    const nx = -(q.y - r.y) / l;
    const ny = (q.x - r.x) / l;
    return { x: p.x - nx * 22 * side, y: p.y - ny * 22 * side, z: 0 };
  });
  makeRoad(ctx, {
    cls: 'collector',
    ctrl: ctrl2,
    name: 'Wharf road',
    tags: { waterfront: true },
    style: STYLES.waterfront,
    maxSpacing: 12,
  });
}

//--------------------------------------------------------------------------------------------------
//  Primary regions: cut the map polygon by the ring and radial corridors so the subdivision works
//  inside the skeleton rather than across it.
//--------------------------------------------------------------------------------------------------
function carvePrimaryRegions(ctx, mapPoly, rings, radials) {
  let regions = [regionFromPoly(mapPoly)];
  // Radial and motorway corridors are straight enough in their inner length to cut with a chord.
  const lineCuts = [];
  for (const road of radials) {
    const a = road.path[0];
    const b = road.path[road.path.length - 1];
    lineCuts.push({ a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y }, inset: road.halfWidth + 1.5, road });
  }
  for (const road of ctx.net.roads) {
    if (road.cls !== 'motorway') continue;
    const a = road.path[0];
    const b = road.path[road.path.length - 1];
    lineCuts.push({ a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y }, inset: road.halfWidth + 1.5, road });
  }
  for (const cut of ctx.diagonals || []) lineCuts.push({ a: cut.chord[0], b: cut.chord[1], inset: cut.inset, road: cut.road });
  for (const cut of lineCuts) regions = applyLineCut(regions, cut);
  // Ring corridors peel convex wedges off the outside of each region.
  for (const ring of rings) regions = carveByPolygon(regions, ring.poly, ring.inset);
  return regions.filter((r) => regionArea(r) > 1100);
}

function straddles(poly, a, b) {
  const s1 = Math.sign(sideOfLine(poly[0], a, b));
  for (const p of poly) {
    if (Math.sign(sideOfLine(p, a, b)) !== s1 && Math.abs(sideOfLine(p, a, b)) > 0.5) return true;
  }
  return false;
}

function cutLineSpan(poly, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l = Math.hypot(dx, dy) || 1;
  const far0 = { x: a.x - (dx / l) * 1e5, y: a.y - (dy / l) * 1e5 };
  const far1 = { x: a.x + (dx / l) * 1e5, y: a.y + (dy / l) * 1e5 };
  const span = clipSegmentToConvex(far0, far1, poly);
  if (!span) return null;
  const len = Math.hypot(span[1].x - span[0].x, span[1].y - span[0].y);
  if (len < 8) return null;
  return span;
}

/** Index of the polygon edge that carries `p`, or -1. Endpoints of a chord sit exactly on one. */
function edgeAt(poly, p, tol = 0.4) {
  let best = -1;
  let bestD = tol;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy || 1e-9;
    const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / l2, 0, 1);
    const d = Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/**
 * Solves a street end against the corridor it is meant to meet. The region edge it lands on is the
 * carriageway centreline pushed back by that corridor's half width, so the exact meeting point is
 * the chord's intersection with the edge's own offset line. Doing this from the region's edge
 * records — instead of hunting for the nearest geometry — keeps the junction exact at every depth.
 */
function solveEnd(region, p, dir, edge) {
  if (edge < 0 || !region.edges[edge]) return { x: p.x, y: p.y };
  const rec = region.edges[edge];
  if (!rec.road || !rec.inset) return { x: p.x, y: p.y };
  const poly = region.poly;
  const a = poly[edge];
  const b = poly[(edge + 1) % poly.length];
  let ex = b.x - a.x;
  let ey = b.y - a.y;
  const el = Math.hypot(ex, ey);
  if (el < 1e-6) return { x: p.x, y: p.y };
  ex /= el;
  ey /= el;
  // Outward normal of this edge (region interior is to the left of its CCW boundary).
  const nx = -ey;
  const ny = ex;
  const sign = polyArea(poly) > 0 ? -1 : 1;
  const ox = a.x + nx * rec.inset * sign;
  const oy = a.y + ny * rec.inset * sign;
  const den = dir.x * ey - dir.y * ex;
  if (Math.abs(den) < 1e-4) return { x: p.x, y: p.y };
  const t = ((ox - p.x) * ey - (oy - p.y) * ex) / den;
  if (Math.abs(t) > 90) return { x: p.x, y: p.y };
  return { x: p.x + dir.x * t, y: p.y + dir.y * t };
}

/**
 * Cuts every region the line passes through, in two, marking the new edge as a road corridor. The
 * corridor road is built once, before the children are cut, so each child edge can name the street
 * it flanks and later cuts can solve their ends against it exactly.
 */
function applyLineCut(regions, cut) {
  const out = [];
  for (const region of regions) {
    if (!straddles(region.poly, cut.a, cut.b)) {
      out.push(region);
      continue;
    }
    const span = cutLineSpan(region.poly, cut.a, cut.b);
    if (!span) {
      out.push(region);
      continue;
    }
    const lineA = { x: span[0].x, y: span[0].y };
    const lineB = { x: span[1].x, y: span[1].y };
    let kept = 0;
    for (const side of [true, false]) {
      const child = childRegion(region, lineA, lineB, cut.inset, side, cut.road || null);
      if (child && regionArea(child) > 420) {
        out.push(child);
        kept++;
      }
    }
    if (!kept) out.push(region);
  }
  return out;
}

/**
 * Carves a closed corridor out of the regions. Each edge of the corridor polygon peels a convex
 * piece off the outside of the remaining region, so an annulus (which is not convex) ends up as a
 * handful of convex wedges — each one a block of city that faces the ring road along exactly one
 * of its edges.
 */
function carveByPolygon(regions, corridor, inset) {
  const out = [];
  const poly = ensureCCW(corridor);
  for (const region of regions) {
    let inner = region;
    for (let i = 0; i < poly.length && inner; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const outside = childRegion(inner, a, b, inset, false);
      const inside = childRegion(inner, a, b, inset, true);
      if (outside && regionArea(outside) > 420) out.push(outside);
      inner = inside;
    }
    if (inner && regionArea(inner) > 420) out.push(inner);
  }
  return out;
}

//--------------------------------------------------------------------------------------------------
//  Recursive subdivision
//--------------------------------------------------------------------------------------------------
function subdivideRegion(ctx, region, depth) {
  if (!isConvex(region.poly)) ctx.counters.nonConvex = (ctx.counters.nonConvex || 0) + 1;
  const { rng } = ctx;
  const poly = region.poly;
  if (poly.length < 3) return;
  const bounds = regionBounds(poly);
  const size = Math.min(bounds.w, bounds.h);
  const c = polyCentroid(poly);
  const style = ctx.styleOf(c.x, c.y);
  const district = ctx.districtAt(c.x, c.y);

  const limit = style.minBlock * ctx.P.density;
  const area = regionArea(region);
  const thin = minWidthOf(poly);
  ctx.counters = ctx.counters || { calls: 0, stopSize: 0, stopDepth: 0, stopOpen: 0, cutFail: 0, made: 0 };
  ctx.counters.calls++;
  // Stop on: depth, a block that is already small enough, or a strip too thin to carry another
  // street with two frontages on it. A long thin strip is still cut — perpendicular to its length.
  if (depth > style.maxDepth || area < limit * limit * 1.15 || thin < Math.max(30, limit * 0.42) || poly.length < 3) {
    if (depth > style.maxDepth) ctx.counters.stopDepth++;
    else ctx.counters.stopSize++;
    if (size > 34 && rng.bool(style.culDeSac * 0.7)) addCulDeSac(ctx, region, style);
    ctx.blocks.push({ poly, style: style.label, district: district.name, area: regionArea(region), x: c.x, y: c.y });
    return;
  }
  if (rng.bool(style.openBlock)) {
    ctx.counters.stopOpen++;
    ctx.blocks.push({ poly, style: style.label, district: district.name, area: regionArea(region), x: c.x, y: c.y, open: true });
    return;
  }

  const cut = chooseCut(region, rng, style, depth);
  if (!cut) {
    ctx.counters.cutFail++;
    ctx.blocks.push({ poly, style: style.label, district: district.name, area: regionArea(region), x: c.x, y: c.y, open: true });
    return;
  }
  const cls = style.classes[Math.min(depth, style.classes.length - 1)];
  const profile = profileFor(ctx, cls, style);
  const bow = Math.min(style.bow, size * style.bowScale, Math.max(0.6, size * 0.09));
  const inset = (profile ? halfWidthOf(profile) : 4) + bow + 1.4;

  const road = buildCutRoad(ctx, region, cut, cls, profile, style, depth, bow, inset);
  if (road) ctx.counters.made++;
  cut.road = road;
  const children = [];
  for (const side of [true, false]) {
    const child = childRegion(region, cut.a, cut.b, inset, side, road);
    if (!child) {
      ctx.counters.dropNull = (ctx.counters.dropNull || 0) + 1;
      continue;
    }
    const a2 = regionArea(child);
    if (a2 <= 260) {
      ctx.counters.dropSmall = (ctx.counters.dropSmall || 0) + 1;
      continue;
    }
    children.push(child);
  }
  for (const child of children) subdivideRegion(ctx, child, depth + 1);
}

/**
 * Walks outward from a cut end until it reaches the un-inset line of the region edge it leaves
 * through — that line is exactly where the neighbouring corridor begins, because every edge
 * remembers how far it was inset. Overshooting into the next block (which then produces a street
 * crossing another street) and stopping short (which produces a dangling end) are both wrong here,
 * so this is solved rather than guessed.
 */
function extendToNeighbour(region, p, dir) {
  const poly = region.poly;
  const ccw = polyArea(poly) > 0;
  let best = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    let ex = b.x - a.x;
    let ey = b.y - a.y;
    const l = Math.hypot(ex, ey) || 1;
    ex /= l;
    ey /= l;
    const nx = -ey * (ccw ? 1 : -1);
    const ny = ex * (ccw ? 1 : -1);
    const inset = region.edges[i] ? region.edges[i].inset : 0;
    const ox = a.x - nx * inset;
    const oy = a.y - ny * inset;
    const den = dir.x * ey - dir.y * ex;
    if (Math.abs(den) < 1e-6) continue;
    const t = ((ox - p.x) * ey - (oy - p.y) * ex) / -den;
    const u = ((ox - p.x) * dir.y - (oy - p.y) * dir.x) / -den;
    if (u < -0.02 || u > 1.02) continue;
    if (t > best && t < 90) best = t;
  }
  const len = best > 0.5 ? best + 1.5 : 6;
  return { x: p.x + dir.x * len, y: p.y + dir.y * len };
}

function chooseCut(region, rng, style, depth) {
  const poly = region.poly;
  const bounds = regionBounds(poly);
  const c = { x: bounds.cx, y: bounds.cy };
  // Principal axis from the vertex spread: cut across the long direction so blocks stay squarish.
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of poly) {
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  // Cut across the long axis, alternating, so blocks stay squarish instead of becoming ribbons.
  const along = depth % 2 === 0 ? theta : theta + Math.PI / 2;
  const angle = along + rng.gauss(0, style.cutJitter);
  const dir = { x: Math.cos(angle), y: Math.sin(angle) };
  const nrm = { x: -dir.y, y: dir.x };
  const score = extentAlong(poly, dir);
  const across = extentAlong(poly, nrm);
  const sigma = Math.max(0.06, Math.min(0.18, across / Math.max(1, score) * 0.5));
  for (let attempt = 0; attempt < 4; attempt++) {
    const off = rng.gauss(0, sigma * (1 - attempt * 0.25)) * across;
    const mid = { x: c.x + nrm.x * off, y: c.y + nrm.y * off };
    const a = { x: mid.x - dir.x * score * 1.2, y: mid.y - dir.y * score * 1.2 };
    const b = { x: mid.x + dir.x * score * 1.2, y: mid.y + dir.y * score * 1.2 };
    const spanIn = cutLineSpan(poly, a, b);
    if (!spanIn) continue;
    const len = Math.hypot(spanIn[1].x - spanIn[0].x, spanIn[1].y - spanIn[0].y);
    if (len < 16) continue;
    return { a, b, spanIn, dir, nrm, angle };
  }
  return null;
}

function buildCutRoad(ctx, region, cut, cls, profile, style, depth, bow, inset) {
  const { rng } = ctx;
  const span = cut.spanIn;
  // Extend each end outward by the inset of the edge it lands on, so the new street reaches the
  // corridor it is supposed to connect to instead of stopping short of it.
  const dir = { x: cut.dir.x, y: cut.dir.y };
  const e0 = edgeAt(region.poly, span[0]);
  const e1 = edgeAt(region.poly, span[1]);
  const s0 = solveEnd(region, span[0], { x: -dir.x, y: -dir.y }, e0);
  const s1 = solveEnd(region, span[1], dir, e1);
  const p0 = { x: s0.x, y: s0.y, z: 0 };
  const p1 = { x: s1.x, y: s1.y, z: 0 };
  const len = Math.hypot(p1.x - p0.x, p1.y - p0.y);
  if (len < 16) return null;
  const segs = clamp(Math.round(len / 70), 1, 4);
  const nrm = cut.nrm;
  const ctrl = [{ ...p0 }];
  const bowSign = rng.bool() ? 1 : -1;
  for (let i = 1; i < segs; i++) {
    const t = i / segs;
    const amp = bow * bowSign * Math.sin(Math.PI * t) * rng.f(0.75, 1.15);
    const jitter = rng.gauss(0, bow * 0.12);
    ctrl.push({
      x: lerp(p0.x, p1.x, t) + nrm.x * (amp + jitter),
      y: lerp(p0.y, p1.y, t) + nrm.y * (amp + jitter),
      z: 0,
    });
  }
  ctrl.push({ ...p1 });
  const road = makeRoad(ctx, {
    cls,
    profile,
    ctrl,
    name: `${cls} ${ctx.net.roads.length}`,
    style,
    order: depth,
    minSpacing: cls === 'local' || cls === 'alley' ? 2.2 : 2.6,
    maxSpacing: cls === 'arterial' || cls === 'trunk' ? 12 : 8,
  });
  road.tags.cutDepth = depth;
  road.tags.bow = bow;
  if (e0 < 0 || e1 < 0) road.tags.endUnresolved = true;
  return road;
}

/**
 * Distance from `from` along `dir` to the boundary of a convex polygon. Anything generated inside a
 * block uses this: a lane that runs out of its own block and across the next three streets is the
 * single easiest way to make a generator produce nonsense.
 */
function distanceToBoundary(poly, from, dir, limit = 4000) {
  let best = limit;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const den = dir.x * ey - dir.y * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((a.x - from.x) * ey - (a.y - from.y) * ex) / -den;
    const u = ((a.x - from.x) * dir.y - (a.y - from.y) * dir.x) / -den;
    if (u < -0.001 || u > 1.001) continue;
    if (t > 0.2 && t < best) best = t;
  }
  return best;
}

function addCulDeSac(ctx, region, style) {
  const { rng } = ctx;
  const poly = region.poly;
  const bounds = regionBounds(poly);
  const attempts = rng.i(1, 3);
  for (let k = 0; k < attempts; k++) {
    const verts = [...poly];
    const a = rng.pick(verts);
    const b = rng.pick(verts);
    if (a === b) continue;
    const len = dist2(a, b);
    if (len < 30) continue;
    const t = rng.f(0.35, 0.65);
    const start = { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: 0 };
    const inPoly = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    // Aim into the block: away from the edge midpoint toward the centroid.
    const c = polyCentroid(poly);
    const dir = { x: c.x - start.x, y: c.y - start.y };
    const dl = Math.hypot(dir.x, dir.y);
    if (dl < 22) continue;
    dir.x /= dl;
    dir.y /= dl;
    const bend = rng.gauss(0, 0.3);
    const cos = Math.cos(bend);
    const sin = Math.sin(bend);
    const dir2 = { x: dir.x * cos - dir.y * sin, y: dir.x * sin + dir.y * cos };
    // Stop before leaving the block: the ray is clipped against the polygon, then pulled in.
    const room = Math.min(distanceToBoundary(poly, start, dir2), distanceToBoundary(poly, start, dir));
    const length = Math.max(26, Math.min(dl * rng.f(0.55, 0.95), room * 0.92, 140));
    const mid = { x: start.x + dir.x * length * 0.5 + dir2.x * length * 0.1, y: start.y + dir.y * length * 0.5 + dir2.y * length * 0.1, z: 0 };
    const end = { x: start.x + dir.x * length * 0.45 + dir2.x * length * 0.45, y: start.y + dir.y * length * 0.45 + dir2.y * length * 0.45, z: 0 };
    const cls = rng.pick(['local', 'local', 'alley']);
    makeRoad(ctx, {
      cls,
      ctrl: [{ ...start }, mid, end],
      name: 'Cul-de-sac',
      style,
      tags: { culDeSac: true, turningHead: true },
      minSpacing: 2,
      maxSpacing: 6,
    });
  }
}

/** A few long connections through otherwise unbroken blocks (lanes, mews, shortcuts). */
function addBlockFillers(ctx) {
  const { rng } = ctx;
  for (const block of ctx.blocks) {
    if (block.open) continue;
    if (block.area < 5200) continue;
    if (!rng.bool(0.45)) continue;
    const poly = block.poly;
    const a = rng.pick(poly);
    const c = polyCentroid(poly);
    const dir = { x: c.x - a.x, y: c.y - a.y };
    const dl = Math.hypot(dir.x, dir.y) || 1;
    const nx = dir.x / dl;
    const ny = dir.y / dl;
    // A lane across a block: from the block edge, through the middle, out the far side.
    const outLen = distanceToBoundary(poly, a, { x: nx, y: ny });
    const far = { x: a.x + nx * Math.min(outLen, 320), y: a.y + ny * Math.min(outLen, 320), z: 0 };
    const cls = rng.pick(['alley', 'alley', 'local']);
    makeRoad(ctx, {
      cls,
      ctrl: [{ x: a.x, y: a.y, z: 0 }, { x: c.x + rng.gauss(0, 8), y: c.y + rng.gauss(0, 8), z: 0 }, far],
      name: 'Service lane',
      style: { ...STYLES.core, profiles: { ...STYLES.core.profiles, alley: [['alley', 1]], local: [['oneway-narrow', 1]] } },
      tags: { filler: true },
      minSpacing: 2,
      maxSpacing: 7,
    });
  }
}

//--------------------------------------------------------------------------------------------------
//  Water crossings: any road whose corridor meets the river gets a bridge span, so planGrade lifts
//  it and the structure pass in build.js has a deck to build.
//--------------------------------------------------------------------------------------------------
export function assignWaterBridges(net, terrain) {
  if (!terrain || !terrain.river) return;
  const half = terrain.river.width * 0.5;
  for (const road of net.roads) {
    const path = road.path;
    let s = 0;
    let runStart = null;
    let runLen = 0;
    const spans = [];
    for (let i = 0; i < path.length - 1; i++) {
      const seg = Math.hypot(path[i + 1].x - path[i].x, path[i + 1].y - path[i].y);
      const mid = { x: (path[i].x + path[i + 1].x) / 2, y: (path[i].y + path[i + 1].y) / 2 };
      const { d } = terrain.riverDistance(mid.x, mid.y);
      const over = d < half + 8;
      if (over && runStart === null) {
        runStart = s;
        runLen = 0;
      }
      if (over) runLen += seg;
      if ((!over || i === path.length - 2) && runStart !== null) {
        if (runLen > 12 && runLen < terrain.river.width * 4) spans.push({ s0: runStart - 6, s1: runStart + runLen + 6 });
        runStart = null;
      }
      s += seg;
    }
    for (const span of spans) {
      road.bridges.push({
        s0: Math.max(0, span.s0),
        s1: Math.min(road.length, span.s1),
        clearance: 9 + Math.max(0, road.family) * 0.6,
        kind: 'water',
        ramp: 70,
      });
      road.tags.bridge = true;
    }
  }
}

function stampTerrain(terrain, net) {
  for (const road of net.roads) {
    const half = (road.profile ? halfWidthOf(road.profile) : 3) + 0.8;
    for (let i = 0; i < road.path.length - 1; i++) {
      const a = road.path[i];
      const b = road.path[i + 1];
      const base = terrain.baseHeight((a.x + b.x) / 2, (a.y + b.y) / 2);
      const z = (a.z + b.z) / 2;
      if (z - base > 1.4) continue; // on structure: leave the ground below alone
      terrain.stampRoad([a, b], half, 0.9 + half * 0.9, z);
    }
  }
  // The promenade and paths should not cut terraces into a river bank.
  return terrain;
}

//--------------------------------------------------------------------------------------------------
//  Railway: chords across the map with real level crossings and viaducts where it meets a major road
//--------------------------------------------------------------------------------------------------
function buildRailways(ctx, mapPoly) {
  const { rng, P, net, terrain } = ctx;
  for (let i = 0; i < P.rail; i++) {
    const angle = rng.f(0, Math.PI) + (i * Math.PI) / Math.max(1, P.rail);
    const dir = { x: Math.cos(angle), y: Math.sin(angle) };
    const nrm = { x: -dir.y, y: dir.x };
    const half = P.extent * 0.52;
    const ctrl = [];
    const steps = 6;
    const offset = P.extent * rng.f(-0.18, 0.18);
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const along = (t - 0.5) * 2 * half;
      const wob = Math.sin(t * Math.PI * 1.2 + rng.f(0, 3)) * P.extent * 0.04 + offset;
      ctrl.push({ x: dir.x * along + nrm.x * wob, y: dir.y * along + nrm.y * wob, z: 0 });
    }
    const rail = new Railway({ ctrl, name: i === 0 ? 'Central Line' : `Freight Loop ${i}` });
    rail.path.forEach((p) => (p.z = terrain.height(p.x, p.y) + 0.55));
    net.railways.push(rail);
  }
  resolveRailCrossings(ctx);
}

/** Every rail/road crossing becomes either a level crossing or a rail viaduct. */
function resolveRailCrossings(ctx) {
  const { net, terrain, rng } = ctx;
  for (const rail of net.railways) {
    const lifts = [];
    for (let i = 0; i < rail.path.length - 1; i++) {
      const a = rail.path[i];
      const b = rail.path[i + 1];
      const railAng = Math.atan2(b.y - a.y, b.x - a.x);
      for (const road of net.roads) {
        if (road.path.length < 2) continue;
        for (let j = 0; j < road.path.length - 1; j++) {
          const c = road.path[j];
          const d = road.path[j + 1];
          const hit = segCross(a, b, c, d);
          if (!hit) continue;
          const roadAng = Math.atan2(d.y - c.y, d.x - c.x);
          let delta = Math.abs(((roadAng - railAng + Math.PI) % Math.PI) - 0);
          delta = Math.abs(Math.atan2(Math.sin(roadAng - railAng), Math.cos(roadAng - railAng)));
          const angleDeg = (Math.min(delta, Math.PI - delta) * 180) / Math.PI;
          const major = road.family >= 4 || road.cls === 'motorway' || road.cls === 'trunk';
          const kind = major || angleDeg < 32 ? 'over' : 'at-grade';
          const sRail = arcOf(rail.path, i, hit.t);
          rail.crossings.push({
            s: sRail,
            point: { x: hit.x, y: hit.y, z: 0 },
            angleDeg,
            kind,
            roadId: road.id,
            protected: kind === 'at-grade' ? rng.bool(0.55) : false,
          });
          if (kind === 'over') lifts.push({ s: sRail });
        }
      }
    }
    // Merge nearby crossings so a viaduct covers a whole junction rather than a single lane.
    const merges = [];
    for (const l of lifts.sort((a, b) => a.s - b.s)) {
      const last = merges[merges.length - 1];
      if (last && l.s - last.s1 < 180) last.s1 = l.s + 60;
      else merges.push({ s0: l.s - 60, s1: l.s + 60 });
    }
    for (const m of merges) liftRail(rail, m.s0, m.s1, terrain, 8.2);
  }
}

function liftRail(rail, s0, s1, terrain, clearance) {
  const ramp = 110;
  for (let i = 0; i < rail.path.length; i++) {
    const s = arcOf(rail.path, i, 0);
    if (s < s0 - ramp || s > s1 + ramp) continue;
    const inDeck = s >= s0 && s <= s1;
    const edge = inDeck ? 1 : 1 - Math.abs(s - (s < s0 ? s0 : s1)) / ramp;
    const lift = clearance * clamp(edge * 1.04, 0, 1);
    const base = terrain.height(rail.path[i].x, rail.path[i].y);
    rail.path[i].z = Math.max(rail.path[i].z, base + 0.55 + lift);
  }
  rail.path.forEach((p, i) => {
    if (i === 0 || i === rail.path.length - 1) return;
    p.z = (rail.path[i - 1].z + 2 * p.z + rail.path[i + 1].z) * 0.25;
  });
}

function arcOf(path, i, t) {
  let s = 0;
  for (let k = 0; k < i; k++) s += Math.hypot(path[k + 1].x - path[k].x, path[k + 1].y - path[k].y);
  if (i < path.length - 1) s += Math.hypot(path[i + 1].x - path[i].x, path[i + 1].y - path[i].y) * (t || 0);
  return s;
}

function segCross(a, b, c, d) {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / den;
  const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: a.x + r.x * t, y: a.y + r.y * t, t, u };
}

//--------------------------------------------------------------------------------------------------
//  Subway
//--------------------------------------------------------------------------------------------------
function buildSubway(ctx) {
  const { net, rng, P } = ctx;
  if (!net.roads.length) return;
  const major = net.nodes.filter((n) => n.arms.length >= 3 && n.arms.some((a) => a.road.family >= 4));
  if (major.length < 3) return;
  const colours = ['#d2533f', '#3f8ad2', '#4fb06a', '#c9a227', '#a05fd0'];
  const lines = clamp(P.subway, 1, 5);
  for (let l = 0; l < lines; l++) {
    const start = rng.pick(major);
    let current = start;
    const stops = [start];
    const used = new Set([start.id]);
    for (let s = 0; s < 6; s++) {
      let best = null;
      for (const n of major) {
        if (used.has(n.id)) continue;
        const d = dist2(current, n);
        if (d < 320 || d > 1900) continue;
        if (!best || d < best.d) best = { n, d };
      }
      if (!best) break;
      stops.push(best.n);
      used.add(best.n.id);
      current = best.n;
    }
    if (stops.length < 3) continue;
    const ctrl = stops.map((s) => ({ x: s.x, y: s.y, z: 0 }));
    const line = new SubwayLine({
      ctrl,
      name: `${['Metro', 'U-Bahn', 'Subway', 'Tram-Tunnel', 'Line'][l % 5]} ${String.fromCharCode(65 + l)}`,
      colour: colours[l % colours.length],
      depth: 13 + l * 4,
    });
    // Stations: keep them evenly spaced along the line.
    let lastS = -1e9;
    for (let i = 0; i < line.path.length; i++) {
      const s = arcOf(line.path, i, 0);
      if (s - lastS < 620) continue;
      const p = line.path[i];
      const near = stops.reduce((b, n) => (!b || dist2(n, p) < dist2(b, p) ? n : b), null);
      if (!near) continue;
      line.stations.push({
        s,
        name: `${ctx.districtAt(p.x, p.y).name} ${['Street', 'Park', 'Central', 'Junction', 'Cross', 'Square'][line.stations.length % 6]}`,
        x: p.x,
        y: p.y,
        z: p.z,
        surface: { x: near.x, y: near.y },
      });
      lastS = s;
    }
    line.path.forEach((p) => (p.z = -line.depth));
    net.subways.push(line);
  }
}
