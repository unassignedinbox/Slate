// City blocks: planar-graph face extraction, then a block surface that welds straight onto the
// back of the verge so the city is one continuous shell. No buildings — paving, kerbed planting,
// parking courts and service yards, exactly as asked.

import { MeshBuilder, SURF, MARK } from '../core/mesh.js';
import { grid, quadPatch } from '../core/geokit.js';
import {
  v3, v3sub, v3add, v3scale, normXZ, headingOf, angleDelta, clamp, lerp, smoothstep,
  polygonAreaXZ, polygonCentroidXZ, pointInPolygonXZ, v3dist2D,
} from '../core/math.js';
import { fbm2D } from '../core/rng.js';
import { ROAD_CLASS } from './profile.js';

export const PAVING = ['slab', 'brick', 'herringbone', 'sett', 'asphalt', 'grass', 'parking'];

/** Half-edge face traversal of the road graph. */
export function extractFaces(net) {
  const half = new Map(); // key `${edgeId}:${fromNode}`
  for (const e of net.edges.values()) {
    half.set(`${e.id}:${e.a}`, { edgeId: e.id, from: e.a, to: e.b });
    half.set(`${e.id}:${e.b}`, { edgeId: e.id, from: e.b, to: e.a });
  }
  const dirAt = (nodeId, edgeId) => {
    const e = net.edges.get(edgeId);
    const atA = e.a === nodeId;
    const L = e.curve.length;
    const probe = Math.min(Math.max(2, L * 0.08), L * 0.5);
    const p0 = atA ? e.curve.pointAt(0) : e.curve.pointAt(L);
    const p1 = atA ? e.curve.pointAt(probe) : e.curve.pointAt(L - probe);
    return normXZ(v3sub(p1, p0));
  };
  const orderAt = new Map();
  for (const n of net.nodes.values()) {
    const list = n.edges.map((eid) => ({ eid, h: headingOf(dirAt(n.id, eid)) }));
    list.sort((a, b) => a.h - b.h);
    orderAt.set(n.id, list);
  }
  const visited = new Set();
  const faces = [];
  for (const [key, h] of half) {
    if (visited.has(key)) continue;
    const face = [];
    let cur = h, guard = 0;
    while (guard++ < 2000) {
      const k = `${cur.edgeId}:${cur.from}`;
      if (visited.has(k)) break;
      visited.add(k);
      face.push(cur);
      // at the far node, take the next edge clockwise from the reversed direction
      const list = orderAt.get(cur.to);
      const idx = list.findIndex((x) => x.eid === cur.edgeId);
      if (idx < 0) break;
      const nextIdx = (idx - 1 + list.length) % list.length;
      const nextEdge = list[nextIdx].eid;
      const e = net.edges.get(nextEdge);
      const nextTo = e.a === cur.to ? e.b : e.a;
      cur = { edgeId: nextEdge, from: cur.to, to: nextTo };
      if (`${cur.edgeId}:${cur.from}` === key) break;
    }
    if (face.length >= 3) faces.push(face);
  }
  return faces;
}

/** Build block surfaces for every interior face. */
export function buildBlocks(net, surface, settings, rng) {
  const mb = new MeshBuilder('blocks');
  const faces = extractFaces(net);
  const blocks = [];
  let skipped = 0;

  for (const face of faces) {
    const nodePoly = face.map((h) => net.nodes.get(h.from).p);
    const area = polygonAreaXZ(nodePoly);
    if (area <= 0) { skipped++; continue; }            // outer face
    if (area < 220) { skipped++; continue; }           // slivers
    if (face.length > 24) { skipped++; continue; }     // degenerate wrap (grade separation)

    const loop = blockBoundary(net, surface, face, nodePoly);
    if (!loop || loop.length < 6) { skipped++; continue; }
    const a2 = polygonAreaXZ(loop);
    if (Math.abs(a2) < 90) { skipped++; continue; }
    const ring = a2 > 0 ? loop.slice().reverse() : loop;
    const centroid = polygonCentroidXZ(ring);
    // a face bounded by a motorway or a ramp is an interchange gore, not a city block:
    // it gets grass up to the kerb, never paving or parking bays
    const gore = face.some((h) => {
      const cls = net.edges.get(h.edgeId)?.profile?.class;
      return cls === ROAD_CLASS.HIGHWAY || cls === ROAD_CLASS.RAMP;
    });
    const pattern = gore ? 'grass' : choosePattern(rng, Math.abs(a2));
    const rot = dominantAngle(ring);
    const info = fillBlock(mb, ring, centroid, pattern, rot, settings, rng, gore);
    blocks.push({ ring, centroid, area: Math.abs(a2), pattern, rot, ...info });
  }

  return { mesh: mb.vertexCount ? mb.finish() : null, blocks, faces: faces.length, skipped };
}

/**
 * What fills a block.  European blocks are mostly green courtyards and paved squares with the
 * occasional parking court or service yard, not the wall-to-wall asphalt an American lot plan
 * would give you.
 */
function choosePattern(rng, area) {
  const r = rng();
  if (area > 7000) return r < 0.54 ? 'grass' : r < 0.79 ? 'slab' : r < 0.92 ? 'parking' : 'asphalt';
  if (area > 2500) return r < 0.46 ? 'grass' : r < 0.68 ? 'slab' : r < 0.82 ? 'parking' : r < 0.93 ? 'brick' : 'asphalt';
  return r < 0.30 ? 'grass' : r < 0.52 ? 'brick' : r < 0.72 ? 'herringbone' : r < 0.88 ? 'sett' : 'slab';
}

/** The paved apron every block carries between the kerb and whatever fills the middle. */
const EDGE_SURFACE = {
  grass: SURF.PAVER, parking: SURF.CONCRETE, asphalt: SURF.CONCRETE,
  slab: SURF.PAVER, brick: SURF.PAVER, herringbone: SURF.PAVER, sett: SURF.PAVER,
};

function dominantAngle(ring) {
  let best = 0, bestLen = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const l = v3dist2D(a, b);
    if (l > bestLen) { bestLen = l; best = Math.atan2(b.z - a.z, b.x - a.x); }
  }
  return best;
}

/**
 * Boundary of one face taken from the actual road geometry: ribbon verge points plus the
 * junction corner arcs, so block and street share vertices.
 */
function blockBoundary(net, surface, face, nodePoly) {
  const out = [];
  // which side of travel does the block interior sit on?
  const h0 = net.edges.get(face[0].edgeId);
  const fwd0 = h0.a === face[0].from;
  const mid = h0.curve.frameAt(h0.curve.length * 0.5);
  const probe = {
    x: mid.p.x - mid.right.x * 6 * (fwd0 ? 1 : -1),
    y: 0,
    z: mid.p.z - mid.right.z * 6 * (fwd0 ? 1 : -1),
  };
  const leftSide = pointInPolygonXZ(probe, nodePoly);

  for (let i = 0; i < face.length; i++) {
    const h = face[i];
    const edge = net.edges.get(h.edgeId);
    const ribbon = surface.ribbons.get(h.edgeId);
    if (!ribbon) return null;
    const forward = edge.a === h.from;
    const stations = forward ? ribbon.stations : ribbon.stations.slice().reverse();
    // profile index 0 is the curve's left; flip for reversed travel and for right-hand blocks
    const useLow = (forward === leftSide);
    for (const st of stations) {
      const pts = st.row.pts;
      const q = useLow ? pts[0] : pts[pts.length - 1];
      out.push({ x: q.p.x, y: q.p.y, z: q.p.z });
    }
    // kerb return at the far node: pick the corner arc that actually joins these two roads
    const next = face[(i + 1) % face.length];
    const info = surface.junctions.get(h.to);
    if (info && info.corners.length) {
      const nextEdge = net.edges.get(next.edgeId);
      const nextRibbon = surface.ribbons.get(next.edgeId);
      const nextFwd = nextEdge.a === next.from;
      const nextStations = nextFwd ? nextRibbon.stations : nextRibbon.stations.slice().reverse();
      const nUseLow = (nextFwd === leftSide);
      const head = nUseLow ? nextStations[0].row.pts[0] : nextStations[0].row.pts[nextStations[0].row.pts.length - 1];
      const tail = out[out.length - 1];
      let best = null, bestCost = Infinity;
      for (const arc of info.corners) {
        const a0 = arc.back[0], a1 = arc.back[arc.back.length - 1];
        const fwdCost = v3dist2D(tail, a0) + v3dist2D(a1, head.p);
        const revCost = v3dist2D(tail, a1) + v3dist2D(a0, head.p);
        const cost = Math.min(fwdCost, revCost);
        if (cost < bestCost) { bestCost = cost; best = { arc, reversed: revCost < fwdCost }; }
      }
      if (best && bestCost < 6) {
        const seq = best.reversed ? best.arc.back.slice().reverse() : best.arc.back.slice();
        for (let a = 1; a < seq.length - 1; a++) out.push({ x: seq[a].x, y: seq[a].y, z: seq[a].z });
      }
    }
  }
  // drop duplicates
  const clean = [];
  for (const p of out) {
    const prev = clean[clean.length - 1];
    if (prev && v3dist2D(prev, p) < 0.05) continue;
    clean.push(p);
  }
  return clean;
}

function starShaped(ring, centroid) {
  for (let i = 0; i < ring.length; i++) {
    const mid = {
      x: (ring[i].x + centroid.x) / 2,
      y: 0,
      z: (ring[i].z + centroid.z) / 2,
    };
    if (!pointInPolygonXZ(mid, ring)) return false;
  }
  return true;
}

const PATTERN_SURFACE = {
  slab: SURF.FOOTWAY, brick: SURF.BRICK, herringbone: SURF.PAVER, sett: SURF.COBBLE,
  asphalt: SURF.ASPHALT, grass: SURF.GRASS, parking: SURF.ASPHALT,
};

function fillBlock(mb, ring, centroid, pattern, rot, settings, rng, gore = false) {
  const surf = PATTERN_SURFACE[pattern] ?? SURF.FOOTWAY;
  const patternId = PAVING.indexOf(pattern);
  const cs = Math.cos(-rot), sn = Math.sin(-rot);
  let ySum = 0;
  for (const p of ring) ySum += p.y;
  const baseY = ySum / ring.length;
  const centre = { x: centroid.x, y: baseY - 0.02, z: centroid.z };
  const mark = pattern === 'parking' ? MARK.PARKING_BAY : MARK.NONE;
  const attrsFor = (p) => ({
    u: (p.x - centroid.x) * cs - (p.z - centroid.z) * sn,
    v: (p.x - centroid.x) * sn + (p.z - centroid.z) * cs,
    surface: surf,
    wear: 0.3,
    ao: 1,
    flags: 0,
    mark,
    laneWidth: 2.5,
    laneA: -1e4, laneB: 1e4,
    param: patternId,
  });

  const edgeSurf = gore ? surf : (EDGE_SURFACE[pattern] ?? SURF.PAVER);
  const attrsEdge = (p) => ({ ...attrsFor(p), surface: edgeSurf, mark: MARK.NONE, param: 0, wear: 0.22 });
  mb.attr({ surface: surf });
  if (!starShaped(ring, centroid)) {
    // concave block: fan from the boundary to a smoothed medial point set via ear clipping
    const idx = ring.map((p) => mb.vertex(p, attrsFor(p)));
    const tris = earClip(ring);
    for (const t of tris) mb.tri(idx[t[0]], idx[t[1]], idx[t[2]]);
    return { quadFilled: false, patternId };
  }
  // band 0 is the paved apron along the kerb; the rest is the courtyard material
  const steps = [0.055, 0.28, 0.58, 0.82];
  let prevIdx = ring.map((p) => mb.vertex(p, attrsEdge(p)));
  let prevPts = ring;
  for (let r = 0; r < steps.length; r++) {
    const a = steps[r];
    const pts = ring.map((p) => ({
      x: lerp(p.x, centre.x, a),
      y: lerp(p.y, centre.y, Math.min(1, a * 1.2)),
      z: lerp(p.z, centre.z, a),
    }));
    const apron = r === 0;
    const attrs = apron ? attrsEdge : attrsFor;
    mb.attr({ surface: apron ? edgeSurf : surf });
    const idx = pts.map((p) => mb.vertex(p, apron ? attrsEdge(p) : attrsFor(p)));
    const outer = apron ? prevIdx : prevPts.map((p) => mb.vertex(p, attrsFor(p)));
    void attrs;
    for (let i = 0; i < pts.length; i++) {
      const n = (i + 1) % pts.length;
      mb.quad(outer[i], outer[n], idx[n], idx[i]);
    }
    prevIdx = idx; prevPts = pts;
  }
  mb.attr({ surface: surf });
  const mids = [];
  for (let i = 0; i < prevPts.length; i++) {
    const n = (i + 1) % prevPts.length;
    const mp = {
      x: (prevPts[i].x + prevPts[n].x) / 2,
      y: (prevPts[i].y + prevPts[n].y) / 2,
      z: (prevPts[i].z + prevPts[n].z) / 2,
    };
    mids.push(mb.vertex(mp, attrsFor(mp)));
  }
  const cIdx = mb.vertex(centre, attrsFor(centre));
  for (let i = 0; i < prevIdx.length; i++) {
    const prev = (i - 1 + prevIdx.length) % prevIdx.length;
    mb.quad(prevIdx[i], mids[i], cIdx, mids[prev]);
  }
  return { quadFilled: true, patternId };
}

function earClip(poly) {
  const n = poly.length;
  const idx = [...Array(n).keys()];
  const tris = [];
  const area = (a, b, c) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  let guard = 0;
  while (idx.length > 3 && guard++ < 5000) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const i0 = idx[(i - 1 + idx.length) % idx.length], i1 = idx[i], i2 = idx[(i + 1) % idx.length];
      const a = poly[i0], b = poly[i1], c = poly[i2];
      if (area(a, b, c) >= 0) continue;
      let ok = true;
      for (const j of idx) {
        if (j === i0 || j === i1 || j === i2) continue;
        if (pointInTri(poly[j], a, b, c)) { ok = false; break; }
      }
      if (!ok) continue;
      tris.push([i0, i1, i2]);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (idx.length === 3) tris.push([idx[0], idx[1], idx[2]]);
  return tris;
}

function pointInTri(p, a, b, c) {
  const d1 = (p.x - b.x) * (a.z - b.z) - (a.x - b.x) * (p.z - b.z);
  const d2 = (p.x - c.x) * (b.z - c.z) - (b.x - c.x) * (p.z - c.z);
  const d3 = (p.x - a.x) * (c.z - a.z) - (c.x - a.x) * (p.z - a.z);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

/**
 * Terrain shell. The ground never lies on top of the road: the lattice is carved away
 * anywhere near a corridor or a city block, and the gap is closed by a graded shoulder
 * ("skirt") that starts exactly on the outer edge of the verge and falls away to grade.
 * Spacing is fine over the city and coarse out to the horizon.
 */
export function buildGround(bounds, settings = {}, world = {}) {
  const mb = new MeshBuilder('ground');
  const relief = world.relief || (() => 0);
  const pad = settings.pad ?? 420;
  const step = settings.step ?? 11;
  const padSteps = 9;
  const SKIRT = [0, 3, 7, 12, 20];       // shoulder rings, metres out from the verge edge
  const REACH = 18;                      // how far the apron looks for the road it must meet

  /** terrain height away from the roads, including the fall-off beyond the city */
  const terrainAt = (x, z) => {
    let y = relief(x, z);
    const edge = Math.min(
      Math.min(x - bounds.min.x, bounds.max.x - x),
      Math.min(z - bounds.min.z, bounds.max.z - z),
    );
    const outside = clamp(-edge / pad, 0, 1);
    if (outside > 0) y += -outside * 2.4 + (fbm2D(x * 0.004, z * 0.004, 3, 11) - 0.5) * 2.6 * outside;
    return y;
  };

  // ---------------------------------------------------------------- corridor field
  // Only road that actually touches the ground carves it: a viaduct overhead or a tunnel
  // underneath must leave the terrain intact, or the scene ends up with holes.
  const atGrade = (x, z, y) => Math.abs(y - terrainAt(x, z)) <= 1.0;
  const samples = [];
  if (world.surface) {
    for (const rib of world.surface.ribbons.values()) {
      const stations = rib.stations;
      const take = Math.max(1, Math.round(2.6 / Math.max(0.6, (stations[1]?.s ?? 3) - (stations[0]?.s ?? 0))));
      for (let i = 0; i < stations.length; i += take) {
        const st = stations[i];
        const pts = st.row.pts;
        const l = pts[0].world || pts[0].p;
        const r = pts[pts.length - 1].world || pts[pts.length - 1].p;
        const c = st.frame.p;
        const ey = Math.min(l.y, r.y);
        if (atGrade(c.x, c.z, ey)) samples.push({ x: c.x, z: c.z, hw: Math.max(v3dist2D(c, l), v3dist2D(c, r)), y: ey });
      }
    }
    for (const info of world.surface.junctions.values()) {
      const jy = info.centre.y ?? 0;
      if (atGrade(info.centre.x, info.centre.z, jy)) {
        samples.push({ x: info.centre.x, z: info.centre.z, hw: (info.radius ?? 8) + 1.2, y: jy });
      }
    }
  }
  const CELL = 36;
  const hash = new Map();
  let maxHw = 0;
  for (const s of samples) {
    maxHw = Math.max(maxHw, s.hw);
    const k = `${Math.floor(s.x / CELL)},${Math.floor(s.z / CELL)}`;
    let list = hash.get(k);
    if (!list) hash.set(k, (list = []));
    list.push(s);
  }
  const reach = REACH;
  const rings = Math.min(4, Math.ceil((maxHw + reach) / CELL));
  /** distance outside the nearest road edge + the lowest road edge height in reach */
  const nearestRoad = (x, z) => {
    const ci = Math.floor(x / CELL), cj = Math.floor(z / CELL);
    let bestD = Infinity, low = Infinity;
    for (let i = -rings; i <= rings; i++) {
      for (let j = -rings; j <= rings; j++) {
        const list = hash.get(`${ci + i},${cj + j}`);
        if (!list) continue;
        for (const s of list) {
          const d = Math.hypot(x - s.x, z - s.z) - s.hw;
          if (d < bestD) bestD = d;
          // follow the *lowest* road nearby: a ramp into an underpass pulls the ground
          // down with it instead of being buried by whatever crosses above
          if (d < reach && s.y < low) low = s.y;
        }
      }
    }
    return bestD === Infinity ? null : { d: bestD, y: low };
  };

  // ---------------------------------------------------------------- block footprints
  const foot = [];
  for (const b of world.blocks || []) {
    let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
    for (const p of b.ring) {
      if (p.x < minx) minx = p.x;
      if (p.x > maxx) maxx = p.x;
      if (p.z < minz) minz = p.z;
      if (p.z > maxz) maxz = p.z;
    }
    foot.push({ ring: b.ring, minx, maxx, minz, maxz });
  }
  const inBlock = (x, z) => {
    for (const b of foot) {
      if (x < b.minx || x > b.maxx || z < b.minz || z > b.maxz) continue;
      if (pointInPolygonXZ({ x, y: 0, z }, b.ring)) return true;
    }
    return false;
  };

  /** final ground height: terrain, pulled down to meet the nearest road edge */
  const groundAt = (x, z) => {
    const t = terrainAt(x, z);
    const n = nearestRoad(x, z);
    if (!n) return t;
    const rimY = Math.min(t, n.y - 0.12);
    if (n.d < 0) return rimY - 0.65;
    return lerp(rimY, t, smoothstep(clamp(n.d / 24, 0, 1)));
  };

  // ---------------------------------------------------------------- lattice
  const axis = (lo, hi) => {
    const out = [];
    for (let i = padSteps; i >= 1; i--) out.push(lo - pad * Math.pow(i / padSteps, 2.3));
    const n = Math.max(2, Math.ceil((hi - lo) / step));
    for (let i = 0; i <= n; i++) out.push(lo + ((hi - lo) * i) / n);
    for (let i = 1; i <= padSteps; i++) out.push(hi + pad * Math.pow(i / padSteps, 2.3));
    return out;
  };
  // The fine lattice has to cover every road, not just the city rectangle: out in the pad the
  // cells are hundreds of metres across, and dropping one because a motorway clips its corner
  // punches a hole the size of a district.
  const ext = { minx: bounds.min.x, maxx: bounds.max.x, minz: bounds.min.z, maxz: bounds.max.z };
  for (const sm of samples) {
    const r = sm.hw + REACH;
    ext.minx = Math.min(ext.minx, sm.x - r); ext.maxx = Math.max(ext.maxx, sm.x + r);
    ext.minz = Math.min(ext.minz, sm.z - r); ext.maxz = Math.max(ext.maxz, sm.z + r);
  }
  const xs = axis(ext.minx, ext.maxx);
  const zs = axis(ext.minz, ext.maxz);

  const H = [], D = [];
  for (let i = 0; i < xs.length; i++) {
    H[i] = new Float64Array(zs.length);
    D[i] = new Float64Array(zs.length);
    for (let j = 0; j < zs.length; j++) {
      const n = nearestRoad(xs[i], zs[j]);
      D[i][j] = n ? n.d : Infinity;
      H[i][j] = groundAt(xs[i], zs[j]);
    }
  }

  const baseAttrs = { wear: 0.5, ao: 1, flags: 0, mark: 0, laneWidth: 1, laneA: -1e4, laneB: 1e4, param: 5 };
  const vert = (x, y, z, wear = 0.5) => mb.vertex({ x, y, z }, { u: x, v: z, ...baseAttrs, wear });
  // how far inside the built-up rectangle a point is; negative once you leave it
  const inset = (x, z) => Math.min(
    Math.min(x - bounds.min.x, bounds.max.x - x),
    Math.min(z - bounds.min.z, bounds.max.z - z),
  );
  let kept = 0, dropped = 0;
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < zs.length - 1; j++) {
      // any corner inside a corridor, or a centre inside a block: the road shoulder and
      // the block paving own that ground, so the lattice stays out of it entirely
      if (Math.min(D[i][j], D[i + 1][j], D[i][j + 1], D[i + 1][j + 1]) < 0) { dropped++; continue; }
      const cx = (xs[i] + xs[i + 1]) / 2, cz = (zs[j] + zs[j + 1]) / 2;
      if (inBlock(cx, cz)) { dropped++; continue; }
      // Outskirts dry out before they turn to bare soil, and the grass/soil line is
      // dithered by noise so it reads as a ragged field edge rather than a rectangle.
      const out = clamp((-inset(cx, cz) - 6) / 90, 0, 1);
      const patch = fbm2D(cx * 0.0055, cz * 0.0055, 3, 37);
      const wear = clamp(0.22 + patch * 0.55 + out * 0.5, 0, 1);
      mb.attr({ surface: out > 0.34 + (patch - 0.5) * 0.44 ? SURF.SOIL : SURF.GRASS });
      kept++;
      mb.quad(
        vert(xs[i], H[i][j], zs[j], wear),
        vert(xs[i], H[i][j + 1], zs[j + 1], wear),
        vert(xs[i + 1], H[i + 1][j + 1], zs[j + 1], wear),
        vert(xs[i + 1], H[i + 1][j], zs[j], wear),
      );
    }
  }

  // ---------------------------------------------------------------- graded shoulder
  // Starts on the exact outer vertex of the verge (so it reads as one surface with the
  // road), falls at ~2 % and blends into the lattice, which it overlaps by 3 m.
  let skirts = 0;
  if (world.surface) {
    mb.attr({ surface: SURF.GRASS });
    for (const rib of world.surface.ribbons.values()) {
      const stations = rib.stations;
      for (const side of [-1, 1]) {
        let prev = null;
        for (let i = 0; i < stations.length; i++) {
          const st = stations[i];
          const pts = st.row.pts;
          const edgeP = side < 0 ? (pts[0].world || pts[0].p) : (pts[pts.length - 1].world || pts[pts.length - 1].p);
          const right = st.frame.right;
          const ox = right.x * side, oz = right.z * side;
          // the paved block on the inside of a face already covers this ground
          // (only when the whole strip is inside it — a narrow block tail still needs a shoulder)
          if (inBlock(edgeP.x + ox * 1.6, edgeP.z + oz * 1.6)
            && inBlock(edgeP.x + ox * 11, edgeP.z + oz * 11)
            && inBlock(edgeP.x + ox * 20, edgeP.z + oz * 20)) { prev = null; continue; }
          // viaducts, embankments and cuttings are the structure builder's business —
          // a graded shoulder there would pour dirt over whatever passes underneath
          if (Math.abs(edgeP.y - terrainAt(edgeP.x, edgeP.z)) > 0.8) { prev = null; continue; }
          const ring = [];
          for (const r of SKIRT) {
            const x = edgeP.x + ox * r, z = edgeP.z + oz * r;
            let y;
            if (r < 0.001) y = edgeP.y;                                  // welds onto the verge
            else {
              y = Math.min(
                lerp(edgeP.y, groundAt(x, z) + 0.04, smoothstep(clamp(r / 20, 0, 1))),
                edgeP.y - 0.02 * r,                                      // 2 % fall for drainage
                groundAt(x, z) + 0.15,                                   // never mound up
              );
              // where the shoulder runs under other paving it simply tucks out of sight
              const n = nearestRoad(x, z);
              if (inBlock(x, z) || (n && n.d < -0.6)) y = Math.min(y, (n ? n.y : edgeP.y) - 0.55);
            }
            ring.push(vert(x, y, z));
          }
          if (prev) {
            for (let k = 0; k < ring.length - 1; k++) {
              if (side < 0) mb.quad(prev[k], prev[k + 1], ring[k + 1], ring[k]);
              else mb.quad(ring[k], ring[k + 1], prev[k + 1], prev[k]);
              skirts++;
            }
          }
          prev = ring;
        }
      }
    }
  }


  // ---------------------------------------------------------------- junction aprons
  // Every plate (including dead-end bull-noses) gets the same graded collar, offset from
  // its real boundary polygon, so there is no gap where roads meet or stop.
  let collars = 0;
  if (world.surface) {
    const OFFS = [0, 3, 7, 12, 20];
    for (const info of world.surface.junctions.values()) {
      const bnd = info.boundary;
      if (!bnd || bnd.length < 6) continue;
      const c = info.centre;
      if (Math.abs((c.y ?? 0) - terrainAt(c.x, c.z)) > 0.8) continue;      // elevated junction
      // decimate the boundary to ~3 m so the collar stays cheap but still hugs the plate
      const loop = [];
      for (const p of bnd) {
        const last = loop[loop.length - 1];
        if (!last || v3dist2D(last, p) > 3) loop.push(p);
      }
      if (loop.length > 2 && v3dist2D(loop[0], loop[loop.length - 1]) < 1.5) loop.pop();
      if (loop.length < 4) continue;
      mb.attr({ surface: SURF.GRASS });
      let prev = null, first = null;
      for (let i = 0; i <= loop.length; i++) {
        const p = loop[i % loop.length];
        const dx = p.x - c.x, dz = p.z - c.z;
        const len = Math.hypot(dx, dz) || 1;
        const ox = dx / len, oz = dz / len;
        const ring = [];
        for (const o0 of OFFS) {
          const o = o0 + 0.18;                                            // clear of the plate edge
          const x = p.x + ox * o, z = p.z + oz * o;
          let y;
          if (o0 === 0) y = p.y - 0.04;
          else {
            y = Math.min(
              lerp(p.y, groundAt(x, z) + 0.01, smoothstep(clamp(o / 20, 0, 1))),
              p.y - 0.02 * o,
              groundAt(x, z) + 0.12,
            );
            const n = nearestRoad(x, z);
            if (inBlock(x, z) || (n && n.d < -0.6)) y = Math.min(y, (n ? n.y : p.y) - 0.55);
          }
          ring.push(vert(x, y, z));
        }
        if (prev) {
          for (let k = 0; k < ring.length - 1; k++) {
            mb.quad(prev[k], prev[k + 1], ring[k + 1], ring[k]);
            collars++;
          }
        }
        prev = ring;
        if (!first) first = ring;
      }
    }
  }

  mb.meta = { cells: kept, dropped, skirts, collars };
  return mb.finish();
}
