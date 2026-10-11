// Junction solver + all-quad junction plate builder.
//
// Pipeline per node:
//   1. sort branches CCW, compute kerb-return radii from the road classes
//   2. intersect the carriageway edge offset lines -> mitre point -> tangent distances -> trims
//   3. sample the REAL mouth cross-sections at those trims
//   4. corner patches: 7 concentric quad strips (carriageway edge, channel, kerb face, kerb top,
//      footway x2, verge) swept along a tangent-continuous fillet between the two mouths
//   5. carriageway plate: boundary loop = mouth rows + fillet level 0, closed with an inset quad
//      ring and an all-quad midpoint fan (no n-gons, no triangle fans, no overlaps)
//
// Every boundary vertex is literally the same position as the ribbon's end row, so MeshBuilder's
// positional weld fuses road and junction into ONE continuous mesh.

import {
  v3, v3add, v3sub, v3scale, v3madd, v3norm, v3dot, v3dist2D, normXZ, lineIntersectXZ,
  clamp, lerp, smoothstep, polygonAreaXZ, polygonCentroidXZ, angleDelta,
} from '../core/math.js';
import { worldSection, branchRing, carriagewaySlice, vertexAttrsFor } from './section.js';
import { ROAD_CLASS, FLAG, KERB, GUTTER_WIDTH } from './profile.js';
import { SURF, MARK } from '../core/mesh.js';
import { classRank } from './network.js';

const CLASS_RADIUS = {
  [ROAD_CLASS.SERVICE]: 4.2,
  [ROAD_CLASS.LOCAL]: 6.0,
  [ROAD_CLASS.COLLECTOR]: 7.5,
  [ROAD_CLASS.ARTERIAL]: 10.0,
  [ROAD_CLASS.RAMP]: 13.0,
  [ROAD_CLASS.HIGHWAY]: 16.0,
};

export const ARC_SEGMENTS = 9;

export function cornerRadiusFor(node, bi, bj) {
  if (node.cornerRadius) return node.cornerRadius;
  const r = Math.max(CLASS_RADIUS[bi.edge.profile.class] ?? 6, CLASS_RADIUS[bj.edge.profile.class] ?? 6);
  // the footway/verge rings wrap concentrically inside the kerb arc: keep them from inverting
  const outerI = bi.widthOuterL - bi.widthEdgeL;
  const outerJ = bj.widthOuterR - bj.widthEdgeR;
  return Math.max(r, outerI + 1.4, outerJ + 1.4);
}

const leftOf = (d) => ({ x: -d.z, y: 0, z: d.x });
const rightOf = (d) => ({ x: d.z, y: 0, z: -d.x });

/**
 * Compute trims for every edge end and cache per-node branch data.
 * Must run after net.rebuildAllCurves().
 */
export function solveNetwork(net) {
  const want = new Map(); // `${edgeId}:${end}` -> trim
  const sols = new Map();

  for (const node of net.nodes.values()) {
    const branches = net.branchesAt(node.id);
    node.kind = branches.length >= 3 ? 'junction' : branches.length === 2 ? 'joint' : 'end';
    const k = branches.length;
    const sol = { node, branches, corners: [], kind: node.kind };
    sols.set(node.id, sol);
    if (k === 0) continue;

    if (k === 1) {
      const b = branches[0];
      const key = `${b.edgeId}:${b.atA ? 'a' : 'b'}`;
      want.set(key, Math.max(want.get(key) || 0, 0.1));
      continue;
    }

    const trims = new Array(k).fill(0.6);
    for (let i = 0; i < k; i++) {
      const j = (i + 1) % k;
      const bi = branches[i], bj = branches[j];
      const R = cornerRadiusFor(node, bi, bj);
      const li = leftOf(bi.dir), rj = rightOf(bj.dir);
      const pi = v3madd(node.p, li, bi.widthEdgeL);
      const pj = v3madd(node.p, rj, bj.widthEdgeR);
      const cosA = clamp(v3dot(bi.dir, bj.dir), -1, 1);
      const psi = Math.acos(cosA); // angle between the two branch directions
      let ui = 0.6, uj = 0.6, mitre = null;
      if (k === 2 && psi > Math.PI - 0.35) {
        // straight-through joint: no corner needed
        ui = uj = 0.4;
      } else if (psi > 0.08 && psi < Math.PI - 0.06) {
        mitre = lineIntersectXZ(pi, bi.dir, pj, bj.dir);
        const dt = clamp(R / Math.tan(psi / 2), 0, R * 6);
        if (mitre) {
          const ti = v3madd(mitre, bi.dir, dt);
          const tj = v3madd(mitre, bj.dir, dt);
          ui = v3dot(v3sub(ti, node.p), bi.dir);
          uj = v3dot(v3sub(tj, node.p), bj.dir);
        }
      } else {
        // near-parallel branches pointing the same way (tight fork): taper generously
        const sep = Math.abs(v3dot(v3sub(pj, pi), leftOf(bi.dir)));
        ui = uj = clamp(sep * 2.4 + R * 0.5, 1, R * 5);
      }
      trims[i] = Math.max(trims[i], ui);
      trims[j] = Math.max(trims[j], uj);
      sol.corners.push({ i, j, radius: R, psi });
    }

    for (let i = 0; i < k; i++) {
      const b = branches[i];
      const key = `${b.edgeId}:${b.atA ? 'a' : 'b'}`;
      const v = Math.max(trims[i] + 0.55, b.widthOuterL * 0.18 + 0.8);
      want.set(key, Math.max(want.get(key) || 0, v));
    }
  }

  // clamp so short edges keep a usable ribbon between their two mouths
  for (const e of net.edges.values()) {
    let ta = want.get(`${e.id}:a`) ?? 0.4;
    let tb = want.get(`${e.id}:b`) ?? 0.4;
    const L = e.curve.length;
    const maxTotal = L * 0.84;
    if (ta + tb > maxTotal) {
      const f = maxTotal / (ta + tb);
      ta *= f; tb *= f;
    }
    e.trimA = Math.max(0.1, ta);
    e.trimB = Math.max(0.1, tb);
    e.mouthSA = e.trimA;
    e.mouthSB = L - e.trimB;
  }
  return sols;
}

/** Quadratic-Bezier kerb return between two mouth points, tangent to both road edges. */
function filletPoints(p0, d0, p1, d1, segments) {
  // d0 = direction travelling INTO the corner at p0 ( = -branch i dir )
  // d1 = direction travelling OUT of the corner at p1 ( = +branch j dir )
  const hit = lineIntersectXZ(p0, d0, p1, v3scale(d1, -1));
  let ctrl;
  const chord = v3dist2D(p0, p1);
  if (!hit) ctrl = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2, z: (p0.z + p1.z) / 2 };
  else {
    const a = v3dot(v3sub(hit, p0), d0);
    const b = v3dot(v3sub(hit, p1), v3scale(d1, -1));
    if (a < -0.05 || b < -0.05 || a > chord * 6 + 24 || b > chord * 6 + 24) {
      ctrl = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2, z: (p0.z + p1.z) / 2 };
    } else {
      ctrl = { x: hit.x, y: (p0.y + p1.y) / 2, z: hit.z };
    }
  }
  const out = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const mt = 1 - t;
    out.push({
      x: mt * mt * p0.x + 2 * mt * t * ctrl.x + t * t * p1.x,
      y: mt * mt * p0.y + 2 * mt * t * ctrl.y + t * t * p1.y,
      z: mt * mt * p0.z + 2 * mt * t * ctrl.z + t * t * p1.z,
    });
  }
  return out;
}

function stripOriented(mb, rowA, rowB, posA, posB) {
  // pick the winding that makes the first quad face up
  const a0 = posA[0], a1 = posA[1], b0 = posB[0], b1 = posB[1];
  if (!a1 || !b1) return;
  const ux = a1.x - a0.x, uz = a1.z - a0.z;
  const vx = b0.x - a0.x, vz = b0.z - a0.z;
  const ny = -(ux * vz - uz * vx); // y of (u x v) with y-up convention
  mb.strip(rowA, rowB, ny < 0);
}

function orientLoopUp(loop) {
  return polygonAreaXZ(loop) > 0 ? loop.slice().reverse() : loop;
}

/**
 * Build one junction (k >= 2) into the shared mesh builder.
 * @returns junction info consumed by traffic, props and the block generator
 */
export function buildJunctionMesh(mb, net, node, options = {}) {
  const branches = net.branchesAt(node.id);
  const k = branches.length;
  if (k < 2) return k === 1 ? buildEndCap(mb, net, node, branches[0], options) : null;

  const mouths = branches.map((b) => {
    const s = b.atA ? b.edge.mouthSA : b.edge.mouthSB;
    const row = worldSection(b.edge, s);
    return {
      b, s, row,
      ringL: branchRing(row, 'left', b.flip),
      ringR: branchRing(row, 'right', b.flip),
      carriage: carriagewaySlice(row, b.flip),
      dir: b.dir,
    };
  });

  const wear = Math.max(...branches.map((b) => b.edge.wear));
  const signalised = node.control === 'signal';
  const plateMark = signalised && k >= 3 ? MARK.YELLOW_BOX : MARK.NONE;

  // ---------------------------------------------------------------- corner patches
  // Each kerb return is 6 concentric quad bands swept between the two mouths. Level rows are
  // built ONCE and reused by both adjacent bands, so no duplicate vertices appear on a ring.
  const cornerArcs = [];
  for (let i = 0; i < k; i++) {
    const j = (i + 1) % k;
    const mi = mouths[i], mj = mouths[j];
    const levels = [];
    for (let r = 0; r < 7; r++) {
      const p0 = mi.ringL[r].p, p1 = mj.ringR[r].p;
      const pts = filletPoints(p0, v3scale(mi.dir, -1), p1, mj.dir, ARC_SEGMENTS);
      levels.push({ pts, surfaceA: mi.ringL[r].surface, surfaceB: mj.ringR[r].surface, rowIdx: null });
    }
    cornerArcs.push(levels);

    for (let r = 0; r < 7; r++) {
      const lv = levels[r];
      const row = new Array(ARC_SEGMENTS + 1);
      for (let q = 0; q <= ARC_SEGMENTS; q++) {
        const f = q / ARC_SEGMENTS;
        const surf = f < 0.5 ? lv.surfaceA : lv.surfaceB;
        mb.attr({ surface: surf });
        row[q] = mb.vertex(lv.pts[q], cornerAttrs(lv.pts[q], surf, wear, f, r, node));
      }
      lv.rowIdx = row;
    }
    for (let r = 0; r < 6; r++) {
      stripOriented(mb, levels[r].rowIdx, levels[r + 1].rowIdx, levels[r].pts, levels[r + 1].pts);
    }
  }

  // ---------------------------------------------------------------- carriageway plate
  const loop = [];
  for (let i = 0; i < k; i++) {
    const j = (i + 1) % k;
    for (const q of mouths[i].carriage) loop.push({ p: q.p, surface: SURF.ASPHALT, mouth: i });
    const arc = cornerArcs[i][0].pts;
    for (let a = 1; a < arc.length - 1; a++) loop.push({ p: arc[a], surface: SURF.ASPHALT, corner: i });
  }
  const loopPts = loop.map((q) => q.p);
  const oriented = polygonAreaXZ(loopPts) > 0 ? loop.slice().reverse() : loop;
  const ringPts = oriented.map((q) => q.p);
  const centroid = polygonCentroidXZ(ringPts);
  let cy = 0;
  for (const p of ringPts) cy += p.y;
  cy = cy / ringPts.length + 0.025; // junction crown
  const centre = { x: centroid.x, y: cy, z: centroid.z };

  fillPlate(mb, ringPts, centre, cy, wear, plateMark, node);

  // ---------------------------------------------------------------- info for traffic / props
  const radius = ringPts.reduce((m, p) => Math.max(m, v3dist2D(p, centre)), 0);
  const info = {
    id: node.id,
    node,
    centre,
    radius,
    kind: node.kind,
    control: node.control,
    signalised,
    boundary: ringPts,
    branchCount: k,
    mouths: mouths.map((m) => ({
      edgeId: m.b.edgeId,
      atA: m.b.atA,
      s: m.s,
      dir: m.dir,
      centreP: m.row.frame.p,
      right: m.row.frame.right,
      halfWidth: m.b.widthEdgeR,
      profile: m.b.edge.profile,
      heading: m.b.heading,
      kerbL: m.ringL[2].p,
      kerbR: m.ringR[2].p,
      backWalkL: m.ringL[6].p,
      backWalkR: m.ringR[6].p,
    })),
    corners: cornerArcs.map((levels, i) => ({
      index: i,
      kerb: levels[2].pts,
      back: levels[6].pts,
      mid: levels[2].pts[Math.floor(ARC_SEGMENTS / 2)],
      backMid: levels[6].pts[Math.floor(ARC_SEGMENTS / 2)],
      walkMid: levels[4].pts[Math.floor(ARC_SEGMENTS / 2)],
    })),
  };
  return info;
}

function surfaceOf(level, f) {
  return f < 0.5 ? level.surfaceA : level.surfaceB;
}

function pickSurface(a0, b0, a1, b1, r) {
  // the band between ring level r and r+1 takes the identity of the OUTER of the two
  // (channel->kerb face->kerb top->footway->verge), matching the ribbon's own banding
  return a1 ?? b1 ?? a0 ?? b0;
}

function cornerAttrs(p, surface, wear, f, level, node) {
  return {
    u: p.x, v: p.z,
    surface,
    wear,
    ao: level >= 3 ? 1 : 0.94,
    flags: FLAG.JUNCTION,
    mark: MARK.NONE,
    laneWidth: 3.5,
    laneA: -1e4, laneB: 1e4,
    param: 0,
  };
}

function plateAttrs(p, centre, wear, mark, node, surface = SURF.ASPHALT_JUNCTION) {
  const d = Math.hypot(p.x - centre.x, p.z - centre.z);
  return {
    u: p.x, v: p.z,
    surface,
    wear,
    ao: 1,
    flags: FLAG.JUNCTION,
    mark,
    laneWidth: 3.5,
    laneA: -1e4, laneB: 1e4,
    param: d,
  };
}

/**
 * All-quad plate fill: concentric "spider" rings contracted toward the centre, closed with a
 * midpoint fan. No n-gons, no triangle fans, no T-junctions; the centre pole is the only
 * high-valence vertex and it sits on the flat part of the junction.
 */
function fillPlate(mb, ringPts, centre, cy, wear, plateMark, node) {
  const span = ringPts.reduce((m, p) => Math.max(m, v3dist2D(p, centre)), 0);
  const ringCount = clamp(Math.round(span / 3.2), 2, 5);
  const fractions = [];
  for (let r = 1; r <= ringCount; r++) fractions.push(Math.pow(r / (ringCount + 0.55), 1.22));

  mb.attr({ surface: SURF.ASPHALT, wear: Math.min(1, wear + 0.18) });
  let prevIdx = ringPts.map((p) => mb.vertex(p, plateAttrs(p, centre, wear, plateMark, node, SURF.ASPHALT)));
  let prevPts = ringPts;
  mb.attr({ surface: SURF.ASPHALT_JUNCTION });
  for (const a of fractions) {
    const pts = ringPts.map((p) => ({
      x: lerp(p.x, centre.x, a),
      y: lerp(p.y, cy, Math.min(1, a * 1.15)),
      z: lerp(p.z, centre.z, a),
    }));
    const idx = pts.map((p) => mb.vertex(p, plateAttrs(p, centre, wear, plateMark, node)));
    for (let i = 0; i < pts.length; i++) {
      const n = (i + 1) % pts.length;
      mb.quad(prevIdx[i], prevIdx[n], idx[n], idx[i]);
    }
    prevIdx = idx; prevPts = pts;
  }
  const mids = [];
  for (let i = 0; i < prevPts.length; i++) {
    const n = (i + 1) % prevPts.length;
    mids.push(mb.vertex({
      x: (prevPts[i].x + prevPts[n].x) / 2,
      y: (prevPts[i].y + prevPts[n].y) / 2,
      z: (prevPts[i].z + prevPts[n].z) / 2,
    }, plateAttrs({ x: (prevPts[i].x + prevPts[n].x) / 2, y: 0, z: (prevPts[i].z + prevPts[n].z) / 2 }, centre, wear, plateMark, node)));
  }
  const centreIdx = mb.vertex(centre, plateAttrs(centre, centre, wear, plateMark, node));
  for (let i = 0; i < prevIdx.length; i++) {
    const prev = (i - 1 + prevIdx.length) % prevIdx.length;
    mb.quad(prevIdx[i], mids[i], centreIdx, mids[prev]);
  }
}

/** Dead end: bull-nosed turning head swept from the branch's own cross-section. */
export function buildEndCap(mb, net, node, branch, options = {}) {
  if (!branch) return null;
  const e = branch.edge;
  const s = branch.atA ? e.mouthSA : e.mouthSB;
  const row = worldSection(e, s);
  const dir = branch.dir;                     // points away from the node (into the road)
  const back = v3scale(dir, -1);              // out of the dead end
  const centre = v3madd(node.p, back, 0.0);
  const ringL = branchRing(row, 'left', branch.flip);
  const ringR = branchRing(row, 'right', branch.flip);
  const steps = 10;
  const wear = e.wear;

  // Bull-nose: a true half ellipse swept from the left ring point, around behind the dead end,
  // back to the right ring point. (A fillet is useless here — the two tangents are anti-parallel,
  // which collapses the arc onto the mouth line.)
  const levels = [];
  for (let r = 0; r < 7; r++) {
    const A = ringL[r].p, B = ringR[r].p;
    const mx = (A.x + B.x) / 2, mz = (A.z + B.z) / 2;
    const hx = (A.x - B.x) / 2, hz = (A.z - B.z) / 2;
    const bulge = Math.hypot(hx, hz) * 0.92;
    const pts = [];
    for (let q = 0; q <= steps; q++) {
      const th = (q / steps) * Math.PI;
      const c = Math.cos(th), sn = Math.sin(th);
      pts.push({
        x: mx + hx * c + back.x * bulge * sn,
        y: A.y + (B.y - A.y) * (q / steps),
        z: mz + hz * c + back.z * bulge * sn,
      });
    }
    levels.push({ pts, surface: ringL[r].surface });
  }
  for (let r = 0; r < 6; r++) {
    const A = levels[r], B = levels[r + 1];
    const surf = B.surface;
    mb.attr({ surface: surf, wear, marking: MARK.NONE });
    const rowA = [], rowB = [];
    for (let q = 0; q <= steps; q++) {
      rowA.push(mb.vertex(A.pts[q], cornerAttrs(A.pts[q], A.surface, wear, q / steps, r, node)));
      rowB.push(mb.vertex(B.pts[q], cornerAttrs(B.pts[q], surf, wear, q / steps, r + 1, node)));
    }
    stripOriented(mb, rowA, rowB, A.pts, B.pts);
  }

  // close the carriageway with the same inset ring + fan
  const loop = [...carriagewaySlice(row, branch.flip).map((q) => q.p)];
  const arc = levels[0].pts;
  for (let a = 1; a < arc.length - 1; a++) loop.push(arc[a]);
  const ring = polygonAreaXZ(loop) > 0 ? loop.slice().reverse() : loop;
  const c2 = polygonCentroidXZ(ring);
  let cy = 0; for (const p of ring) cy += p.y;
  cy = cy / ring.length + 0.02;
  const cen = { x: c2.x, y: cy, z: c2.z };
  fillPlate(mb, ring, cen, cy, wear, MARK.NONE, node);

  return {
    id: node.id, node, centre: cen, radius: 8, kind: 'end', control: 'none', signalised: false,
    boundary: ring, branchCount: 1,
    mouths: [{
      edgeId: e.id, atA: branch.atA, s, dir, centreP: row.frame.p, right: row.frame.right,
      halfWidth: branch.widthEdgeR, profile: e.profile, heading: branch.heading,
      kerbL: ringL[2].p, kerbR: ringR[2].p, backWalkL: ringL[6].p, backWalkR: ringR[6].p,
    }],
    corners: [],
  };
}
