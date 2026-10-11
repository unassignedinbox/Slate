// City blocks: planar-graph face extraction, then a block surface that welds straight onto the
// back of the verge so the city is one continuous shell. No buildings — paving, kerbed planting,
// parking courts and service yards, exactly as asked.

import { MeshBuilder, SURF, MARK } from '../core/mesh.js';
import { grid, quadPatch } from '../core/geokit.js';
import {
  v3, v3sub, v3add, v3scale, normXZ, headingOf, angleDelta, clamp, lerp,
  polygonAreaXZ, polygonCentroidXZ, pointInPolygonXZ, v3dist2D,
} from '../core/math.js';
import { fbm2D } from '../core/rng.js';

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
    const pattern = choosePattern(rng, Math.abs(a2));
    const rot = dominantAngle(ring);
    const info = fillBlock(mb, ring, centroid, pattern, rot, settings, rng);
    blocks.push({ ring, centroid, area: Math.abs(a2), pattern, rot, ...info });
  }

  return { mesh: mb.vertexCount ? mb.finish() : null, blocks, faces: faces.length, skipped };
}

function choosePattern(rng, area) {
  const r = rng();
  if (area > 7000) return r < 0.45 ? 'asphalt' : r < 0.75 ? 'grass' : 'parking';
  if (area > 2500) return r < 0.3 ? 'parking' : r < 0.55 ? 'slab' : r < 0.8 ? 'grass' : 'asphalt';
  return r < 0.3 ? 'brick' : r < 0.55 ? 'herringbone' : r < 0.75 ? 'slab' : 'sett';
}

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

function fillBlock(mb, ring, centroid, pattern, rot, settings, rng) {
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

  mb.attr({ surface: surf });
  if (!starShaped(ring, centroid)) {
    // concave block: fan from the boundary to a smoothed medial point set via ear clipping
    const idx = ring.map((p) => mb.vertex(p, attrsFor(p)));
    const tris = earClip(ring);
    for (const t of tris) mb.tri(idx[t[0]], idx[t[1]], idx[t[2]]);
    return { quadFilled: false, patternId };
  }
  const rings = 3;
  let prevIdx = ring.map((p) => mb.vertex(p, attrsFor(p)));
  let prevPts = ring;
  for (let r = 1; r <= rings; r++) {
    const a = Math.pow(r / (rings + 0.6), 1.15);
    const pts = ring.map((p) => ({
      x: lerp(p.x, centre.x, a),
      y: lerp(p.y, centre.y, Math.min(1, a * 1.2)),
      z: lerp(p.z, centre.z, a),
    }));
    const idx = pts.map((p) => mb.vertex(p, attrsFor(p)));
    for (let i = 0; i < pts.length; i++) {
      const n = (i + 1) % pts.length;
      mb.quad(prevIdx[i], prevIdx[n], idx[n], idx[i]);
    }
    prevIdx = idx; prevPts = pts;
  }
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

/** Terrain shell under everything: large grid with gentle relief and a soil apron. */
export function buildGround(bounds, settings = {}) {
  const mb = new MeshBuilder('ground');
  const pad = settings.pad ?? 260;
  const min = { x: bounds.min.x - pad, z: bounds.min.z - pad };
  const sizeX = (bounds.max.x - bounds.min.x) + pad * 2;
  const sizeZ = (bounds.max.z - bounds.min.z) + pad * 2;
  const n = 64;
  const baseY = settings.baseY ?? 0.04;
  mb.attr({ surface: SURF.GRASS });
  grid(mb, { x: min.x, y: baseY, z: min.z }, sizeX, sizeZ, n, n, (x, z) => {
    const d = Math.min(
      Math.min(x - bounds.min.x, bounds.max.x - x),
      Math.min(z - bounds.min.z, bounds.max.z - z),
    );
    const outside = clamp(-d / pad, 0, 1);
    return baseY - outside * 2.2 + (fbm2D(x * 0.004, z * 0.004, 3, 11) - 0.5) * 1.2 * outside;
  }, { attrs: { surface: SURF.SOIL, wear: 0.5, ao: 1, flags: 0, mark: 0, laneWidth: 1, laneA: -1e4, laneB: 1e4, param: 5 } });
  return mb.finish();
}
