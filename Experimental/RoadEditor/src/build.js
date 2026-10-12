//==================================================================================================
//  ROADEDITOR — GEOMETRY BUILD
//==================================================================================================
//  Turns the network into renderable meshes:
//    buildRoadSurfaces   swept cross-sections, wrapped in a Z-up frame that follows the grade
//    buildJunctions      the intersection surface, its kerb returns and the corner pavements
//    buildMarkings       lane lines, dashes, stop lines, crossings, arrows, glyph words
//    buildProps          instanced street furniture, guardrails, barriers, trees, lamps, signals
//    buildRailways       ballast, sleepers, rail, catenary, level crossings, platforms
//    buildSubways        running tunnels, station boxes, portals
//    buildStructures     bridge decks, piers, parapets, tunnel bores
//    buildXRay           the authoring overlay the editor outlines the network with
//
//  Everything is procedural and material-typed per vertex, so the whole city draws in one pass with
//  no textures and no material switching.
//==================================================================================================

import {
  clamp,
  lerp,
  MeshBuilder,
  MAT,
  MAT_COUNT,
  norm3,
  Rng,
  DEG,
  add3,
  mul3,
  sub3,
  len3,
  dist2,
  glyphWord,
  GLYPHS,
} from './core.js';
import { pathFrames, alongPath, pathLength, subPath, offsetPath } from './spline.js';
import { sectionOf, halfWidthOf } from './profiles.js';

const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

//--------------------------------------------------------------------------------------------------
//  Section transforms
//--------------------------------------------------------------------------------------------------
function transformSection(pos, frame, points) {
  const r = { x: frame.t.y * frame.up.z - frame.t.z * frame.up.y, y: frame.t.z * frame.up.x - frame.t.x * frame.up.z, z: frame.t.x * frame.up.y - frame.t.y * frame.up.x };
  const out = new Array(points.length);
  for (let i = 0; i < points.length; i++) {
    const sp = points[i];
    out[i] = {
      p: { x: pos.x + r.x * sp.x + frame.up.x * sp.z, y: pos.y + r.y * sp.x + frame.up.y * sp.z, z: pos.z + r.z * sp.x + frame.up.z * sp.z },
      n: norm3({ x: r.x * sp.nx + frame.up.x * sp.nz, y: r.y * sp.nx + frame.up.y * sp.nz, z: r.z * sp.nx + frame.up.z * sp.nz }),
      right: r,
      sp,
    };
  }
  return out;
}

/** Lateral offset in world space for a given section x. */
function offsetPoint(pos, frame, x, dz = 0) {
  const r = { x: frame.t.y * frame.up.z - frame.t.z * frame.up.y, y: frame.t.z * frame.up.x - frame.t.x * frame.up.z, z: frame.t.x * frame.up.y - frame.t.y * frame.up.x };
  return {
    x: pos.x + r.x * x + frame.up.x * dz,
    y: pos.y + r.y * x + frame.up.y * dz,
    z: pos.z + r.z * x + frame.up.z * dz,
  };
}

//--------------------------------------------------------------------------------------------------
//  Surface tint: a little procedural wear so six kilometres of asphalt is not one flat colour.
//--------------------------------------------------------------------------------------------------
function wear(x, y, amount = 0.07) {
  const n = Math.sin(x * 0.021) * Math.cos(y * 0.017) + Math.sin((x + y) * 0.0071) * 0.6;
  const f = 1 + n * amount;
  return [f, f, f * (1 + amount * 0.3)];
}

function tintOf(base, x, y, amount) {
  const w = wear(x, y, amount);
  return [base[0] * w[0], base[1] * w[1], base[2] * w[2]];
}

//--------------------------------------------------------------------------------------------------
//  Roads
//--------------------------------------------------------------------------------------------------
export function buildRoadSurfaces(mb, net, ctx) {
  let rowsTotal = 0;
  for (const road of net.roads) {
    if (!road.path || road.path.length < 2) continue;
    const section = sectionOf(road.profile);
    road._geoPath = road.renderPath && road.renderPath.length >= 2 ? road.renderPath : road.path;
    const frames = pathFrames(road._geoPath, false);
    const isPath = road.cls === 'footway' || road.cls === 'cycleway';
    rowsTotal += road._geoPath.length;
    mb.beginGroup(`${road.cls}:${road.profileId}`, { road: road.id, cls: road.cls, kind: 'road' });
    const rows = [];
    const carry = section.carriageway;
    for (let i = 0; i < road._geoPath.length; i++) {
      const t = transformSection(road._geoPath[i], frames[i], section.points);
      rows.push(t);
    }
    for (const ribbon of section.ribbons) {
      const a = ribbon.a;
      const b = ribbon.b;
      const face = ribbon.face;
      for (let i = 0; i < rows.length - 1; i++) {
        const r0 = rows[i];
        const r1 = rows[i + 1];
        const tint = ribbon.tint || [1, 1, 1];
        const c0 = tintOf(tint, r0[a].p.x, r0[a].p.y, isPath ? 0.03 : 0.06);
        const c1 = tintOf(tint, r1[a].p.x, r1[a].p.y, isPath ? 0.03 : 0.06);
        const v0 = mb.vertex(r0[a].p, r0[a].n, c0, ribbon.mat ?? MAT.ASPHALT);
        const v1 = mb.vertex(r0[b].p, r0[b].n, c0, ribbon.mat ?? MAT.ASPHALT);
        const v2 = mb.vertex(r1[a].p, r1[a].n, c1, ribbon.mat ?? MAT.ASPHALT);
        const v3 = mb.vertex(r1[b].p, r1[b].n, c1, ribbon.mat ?? MAT.ASPHALT);
        if (face) mb.quadIdx(v2, v0, v3, v1, true);
        else mb.quadIdx(v0, v1, v2, v3);
      }
    }
    mb.endGroup();
    road._rows = rows;
    road._frames = frames;
    road._section = section;
  }
  return rowsTotal;
}

//--------------------------------------------------------------------------------------------------
//  Baked lane path cache
//--------------------------------------------------------------------------------------------------
function lanePath(road, x, dz = 0.045) {
  const key = `${x}|${dz}`;
  road._laneCache = road._laneCache || new Map();
  if (road._laneCache.has(key)) return road._laneCache.get(key);
  const out = road._geoPath.map((p, i) => {
    const f = road._frames[i];
    return offsetPoint(p, f, x, dz);
  });
  road._laneCache.set(key, out);
  return out;
}

function polylineQuad(mb, a, b, width, mat, tint) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l = Math.hypot(dx, dy) || 1;
  const nx = (-dy / l) * (width / 2);
  const ny = (dx / l) * (width / 2);
  const n = { x: 0, y: 0, z: 1 };
  const p0 = { x: a.x + nx, y: a.y + ny, z: a.z };
  const p1 = { x: a.x - nx, y: a.y - ny, z: a.z };
  const p2 = { x: b.x + nx, y: b.y + ny, z: b.z };
  const p3 = { x: b.x - nx, y: b.y - ny, z: b.z };
  const v0 = mb.vertex(p0, n, tint, mat);
  const v1 = mb.vertex(p1, n, tint, mat);
  const v2 = mb.vertex(p2, n, tint, mat);
  const v3 = mb.vertex(p3, n, tint, mat);
  mb.quadIdx(v0, v1, v2, v3);
}

function strokeSegment(mb, a, b, width, mat, tint = [1, 1, 1]) {
  polylineQuad(mb, { x: a.x, y: a.y, z: a.z }, { x: b.x, y: b.y, z: b.z }, width, mat, tint);
}

/** Strokes a list of glyph polylines into a local frame (origin, x-axis, y-axis). */
function strokeGlyph(mb, strokes, origin, axis, width, mat, tint = [1, 1, 1]) {
  for (const s of strokes) {
    for (let i = 0; i < s.length - 1; i++) {
      const p = { x: origin.x + axis.x.x * s[i].x + axis.y.x * s[i].y, y: origin.y + axis.x.y * s[i].x + axis.y.y * s[i].y, z: origin.z };
      const q = { x: origin.x + axis.x.x * s[i + 1].x + axis.y.x * s[i + 1].y, y: origin.y + axis.x.y * s[i + 1].x + axis.y.y * s[i + 1].y, z: origin.z };
      polylineQuad(mb, p, q, width, mat, tint);
    }
  }
}

//--------------------------------------------------------------------------------------------------
//  Markings
//--------------------------------------------------------------------------------------------------
const LINE_STYLE = {
  'edge-white': { mat: MAT.MARK_WHITE, width: 0.15, dash: 0, solid: true },
  'solid-white': { mat: MAT.MARK_WHITE, width: 0.15, dash: 0, solid: true },
  'dashed-white': { mat: MAT.MARK_WHITE, width: 0.15, dash: 3.0, gap: 4.5 },
  'solid-yellow': { mat: MAT.MARK_YELLOW, width: 0.15, dash: 0, solid: true },
  'double-yellow': { mat: MAT.MARK_YELLOW, width: 0.12, dash: 0, solid: true, double: 0.22 },
  barrier: null,
  none: null,
};

export function buildRoadMarkings(mb, net, opts = {}) {
  const detail = opts.markingDetail ?? 1;
  for (const road of net.roads) {
    if (!road._frames) continue;
    const section = road._section || sectionOf(road.profile);
    const isPath = road.cls === 'footway' || road.cls === 'cycleway';
    if (isPath) continue;
    mb.beginGroup(`markings:${road.cls}`, { road: road.id, kind: 'marking' });
    const total = road.length;
    for (const line of section.lines) {
      const style = LINE_STYLE[line.style];
      if (!style) continue;
      const offset = line.x;
      if (style.double) {
        drawLine(mb, road, offset - style.double / 2, style, total, detail);
        drawLine(mb, road, offset + style.double / 2, style, total, detail);
      } else {
        drawLine(mb, road, offset, style, total, detail);
      }
    }
    // Bus lane lettering and cycle symbols, spaced along the lane.
    for (const lane of section.lanes) {
      const mid = (lane.x0 + lane.x1) / 2;
      if (lane.kind === 'bus' || lane.kind === 'busway') {
        stampWord(mb, road, 'BUS', mid, 3.2, 0.36, MAT.MARK_WHITE, total, 90);
      } else if (lane.kind === 'bike') {
        stampGlyph(mb, road, 'BICYCLE', mid, 1.6, 0.3, MAT.MARK_WHITE, total, 70);
      } else if (lane.kind === 'parking') {
        drawBayTicks(mb, road, lane, total, 6.0);
      }
    }
    mb.endGroup();
  }
}

function drawLine(mb, road, offset, style, total, detail) {
  const path = lanePath(road, offset, 0.04);
  if (style.solid) {
    if (path.length < 2) return;
    const n = { x: 0, y: 0, z: 1 };
    const half = style.width / 2;
    const rows = [];
    for (let i = 0; i < path.length; i++) {
      const a = path[i - 1] || path[i];
      const b = path[i + 1] || path[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const l = Math.hypot(dx, dy) || 1;
      rows.push([
        mb.vertex({ x: path[i].x + (-dy / l) * half, y: path[i].y + (dx / l) * half, z: path[i].z }, n, [1, 1, 1], style.mat),
        mb.vertex({ x: path[i].x - (-dy / l) * half, y: path[i].y - (dx / l) * half, z: path[i].z }, n, [1, 1, 1], style.mat),
      ]);
    }
    for (let i = 0; i < rows.length - 1; i++) mb.quadIdx(rows[i][0], rows[i][1], rows[i + 1][0], rows[i + 1][1]);
    return;
  }
  const period = (style.dash + style.gap) / (detail > 1 ? 1 : 1);
  let s = 0;
  const frames = road._frames;
  while (s < total) {
    const a = sampleWorld(road, s);
    const b = sampleWorld(road, Math.min(total, s + style.dash));
    strokeSegment(mb, a, b, style.width, style.mat);
    s += period;
  }
}

function sampleWorld(road, s) {
  const p = alongPath(road.path, s, false);
  const i = clamp(p.i, 0, road._frames.length - 1);
  const f = road._frames[i];
  return offsetPoint(p, f, 0, 0.04);
}

function stampWord(mb, road, word, offset, height, lineWidth, mat, total, spacing) {
  const glyph = glyphWord(word, height);
  const scale = height;
  let s = 20;
  while (s < total - 6) {
    const p = alongPath(road.path, s, false);
    const f = road._frames[clamp(p.i, 0, road._frames.length - 1)];
    const right = { x: f.t.y * f.up.z - f.t.z * f.up.y, y: f.t.z * f.up.x - f.t.x * f.up.z, z: f.t.x * f.up.y - f.t.y * f.up.x };
    const origin = offsetPoint(p, f, offset - (glyph.width * scale) / 2, 0.045);
    strokeGlyph(mb, glyph.strokes, origin, { x: { x: right.x, y: right.y }, y: { x: f.t.x, y: f.t.y } }, lineWidth, mat);
    s += spacing;
  }
}

function stampGlyph(mb, road, kind, offset, height, lineWidth, mat, total, spacing) {
  const g = GLYPHS[kind];
  if (!g) return;
  let s = 30;
  while (s < total - 6) {
    const p = alongPath(road.path, s, false);
    const f = road._frames[clamp(p.i, 0, road._frames.length - 1)];
    const right = { x: f.t.y * f.up.z - f.t.z * f.up.y, y: f.t.z * f.up.x - f.t.x * f.up.z, z: f.t.x * f.up.y - f.t.y * f.up.x };
    const origin = offsetPoint(p, f, offset - height / 2, 0.045);
    const strokes = g.map((poly) => poly.map(([x, y]) => ({ x: (x - 0.5) * height, y: y * height })));
    strokeGlyph(mb, strokes, origin, { x: { x: right.x, y: right.y }, y: { x: f.t.x, y: f.t.y } }, lineWidth, mat);
    s += spacing;
  }
}

function drawBayTicks(mb, road, lane, total, spacing) {
  const path = road.path;
  const n = Math.max(2, Math.round(total / spacing));
  for (let i = 0; i <= n; i++) {
    const s = (i / n) * total;
    const p = alongPath(path, s, false);
    const idx = clamp(p.i, 0, road._frames.length - 1);
    const f = road._frames[idx];
    const a = offsetPoint(p, f, lane.x0 + 0.1, 0.045);
    const b = offsetPoint(p, f, lane.x1 - 0.1, 0.045);
    strokeSegment(mb, a, b, 0.12, MAT.MARK_WHITE);
  }
}

//--------------------------------------------------------------------------------------------------
//  Junctions
//--------------------------------------------------------------------------------------------------
/**
 * Builds the intersection: the carriageway area between the trimmed arms, the kerb returns that
 * carry the pavement around each corner, and the corner pavements themselves. The arms' own
 * surfaces stop on their cut lines, so this fills exactly the gap between them — no overlap, no
 * cross-fade, no z-fighting.
 */
export function buildJunctions(mb, net, opts = {}, propOut = []) {
  const rng = new Rng(4, 9);
  let built = 0;
  for (const node of net.nodes) {
    const arms = node.arms.filter((a) => a.road && a.road.path.length > 1 && a.road._frames);
    if (arms.length < 2) continue;
    mb.beginGroup('junction', { node: node.id, kind: 'junction' });
    const centre = { x: node.x, y: node.y, z: 0 };
    const entry = arms.map((a) => {
      const road = a.road;
      const geo = road._geoPath && road._geoPath.length > 1 ? road._geoPath : road.path;
      const i = a.which === 'a' ? 0 : geo.length - 1;
      const pos = geo[i];
      const f = road._frames && road._frames[i] ? road._frames[i] : { t: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 } };
      const section = road._section || sectionOf(road.profile);
      const right = { x: f.t.y * f.up.z - f.t.z * f.up.y, y: f.t.z * f.up.x - f.t.x * f.up.z, z: f.t.x * f.up.y - f.t.y * f.up.x };
      // Section x maps to the right of travel; the arm points outward from the node, so the inward
      // direction is the reverse of `outward`.
      const inner = { x: -a.outward.x, y: -a.outward.y, z: 0 };
      const leftEdgeX = section.carriageway.from;
      const rightEdgeX = section.carriageway.to;
      const kerbFrom = section.kerbBands.length ? section.kerbBands[0].x0 : leftEdgeX;
      const kerbTo = section.kerbBands.length ? section.kerbBands[section.kerbBands.length - 1].x1 : rightEdgeX;
      return {
        arm: a,
        road,
        pos,
        f,
        right,
        inner,
        angle: Math.atan2(a.outward.y, a.outward.x),
        carriage: {
          a: offsetPoint(pos, f, rightEdgeX, 0),
          b: offsetPoint(pos, f, leftEdgeX, 0),
        },
        kerb: {
          a: offsetPoint(pos, f, kerbTo, 0),
          b: offsetPoint(pos, f, kerbFrom, 0),
        },
        ctrl: road.ctrl,
        width: rightEdgeX - leftEdgeX,
        oneway: a.oneway,
        section,
      };
    });
    // Order the arms around the node so consecutive pairs form the corners.
    entry.sort((p, q) => p.angle - q.angle);
    // Find the node's own surface height from its arms.
    const zAvg = entry.reduce((s, e) => s + e.pos.z, 0) / entry.length;
    centre.z = zAvg;

    // --- carriageway polygon: kerb-line points with a fillet between consecutive arms
    const ring = [];
    const corners = [];
    for (let i = 0; i < entry.length; i++) {
      const cur = entry[i];
      const next = entry[(i + 1) % entry.length];
      // Kerb points of this arm at its cut line, in ring order (right side first going CCW).
      const kRight = cur.kerb.a;
      const kLeft = cur.kerb.b;
      ring.push(kLeft);
      // corner between this arm's RIGHT kerb and the next arm's LEFT kerb
      const fillet = filletPoints(kRight, cur.inner, next.kerb.b, next.inner, node.fillet, centre);
      for (const p of fillet) ring.push(p);
      corners.push({ cur, next, fillet, kRight, kLeftNext: next.kerb.b });
    }
    // Ring may be inverted depending on arm order; make it CCW about the centre.
    const ccw = polygonIsCCW(ring, centre);
    const ordered = ccw ? ring : ring.slice().reverse();
    const pts = ordered.map((p) => ({ x: p.x, y: p.y, z: zAvg }));
    const normal = { x: 0, y: 0, z: 1 };
    const tint = [0.97, 0.97, 0.98];
    const verts = pts.map((p) => mb.vertex(p, normal, tintOf(tint, p.x, p.y, 0.07), MAT.ASPHALT));
    const ci = mb.vertex(centre, normal, tintOf(tint, centre.x, centre.y, 0.07), MAT.ASPHALT);
    for (let i = 0; i < verts.length; i++) {
      const j = (i + 1) % verts.length;
      if (ccw) mb.tri(ci, verts[i], verts[j]);
      else mb.tri(ci, verts[j], verts[i]);
    }

    // --- kerb returns and corner pavements
    for (const corner of corners) {
      const arc = corner.fillet;
      if (!arc.length) continue;
      const width = cornerWidth(corner.cur.section);
      if (width <= 0.2) continue;
      const kerbH = corner.cur.section.profile.kerbHeight ?? 0.13;
      const walkMat = corner.cur.section.walkBands.length ? corner.cur.section.walkBands[0].mat : MAT.CONCRETE;
      for (let i = 0; i < arc.length - 1; i++) {
        const a = arc[i];
        const b = arc[i + 1];
        const da = norm2({ x: a.x - centre.x, y: a.y - centre.y });
        const db = norm2({ x: b.x - centre.x, y: b.y - centre.y });
        const aTop = { x: a.x + da.x * width, y: a.y + da.y * width, z: a.z + kerbH };
        const bTop = { x: b.x + db.x * width, y: b.y + db.y * width, z: b.z + kerbH };
        // pavement surface
        const nrm = { x: 0, y: 0, z: 1 };
        const v0 = mb.vertex({ x: a.x, y: a.y, z: a.z + kerbH }, nrm, [1, 1, 1], walkMat);
        const v1 = mb.vertex(aTop, nrm, [1, 1, 1], walkMat);
        const v2 = mb.vertex({ x: b.x, y: b.y, z: b.z + kerbH }, nrm, [1, 1, 1], walkMat);
        const v3 = mb.vertex(bTop, nrm, [1, 1, 1], walkMat);
        mb.quadIdx(v0, v1, v2, v3);
        // kerb upstand
        const kf0 = mb.vertex({ x: a.x, y: a.y, z: a.z + kerbH }, { x: -da.x, y: -da.y, z: 0 }, [1, 1, 1], MAT.CONCRETE);
        const kf1 = mb.vertex({ x: a.x, y: a.y, z: a.z }, { x: -da.x, y: -da.y, z: 0 }, [1, 1, 1], MAT.CONCRETE);
        const kf2 = mb.vertex({ x: b.x, y: b.y, z: b.z + kerbH }, { x: -db.x, y: -db.y, z: 0 }, [1, 1, 1], MAT.CONCRETE);
        const kf3 = mb.vertex({ x: b.x, y: b.y, z: b.z }, { x: -db.x, y: -db.y, z: 0 }, [1, 1, 1], MAT.CONCRETE);
        mb.quadIdx(kf0, kf1, kf2, kf3, true);
      }
    }

    // --- junction furniture and paint
    buildJunctionMarkings(mb, node, entry, centre, rng);
    buildJunctionProps(node, entry, centre, rng, propOut);
    node._built = { entry, centre };
    mb.endGroup();
    built++;
  }
  return built;
}

function cornerWidth(section) {
  if (!section.walkBands.length) return 0;
  return section.walkBands.reduce((s, b) => s + (b.x1 - b.x0), 0) / section.walkBands.length;
}

function norm2(v) {
  const l = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / l, y: v.y / l };
}

function polygonIsCCW(pts, centre) {
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    sum += (a.x - centre.x) * (b.y - centre.y) - (b.x - centre.x) * (a.y - centre.y);
  }
  return sum > 0;
}

/**
 * Kerb return between two inside corners. The two arms' kerb lines are known; the fillet is the arc
 * of radius r tangent to both, on the inside of the wedge. Results run from the first arm's kerb
 * point to the second's, so they can be dropped straight into the junction ring.
 */
function filletPoints(p1, dir1, p2, dir2, radius, centre) {
  const r = Math.max(2.5, radius);
  const u1 = { x: dir1.x, y: dir1.y };
  const u2 = { x: dir2.x, y: dir2.y };
  const den = u1.x * u2.y - u1.y * u2.x;
  if (Math.abs(den) < 0.08) return [{ ...p1 }, { ...p2 }];
  // Intersection of the two kerb lines (extended) is the wedge apex.
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const t = (dx * u2.y - dy * u2.x) / den;
  const apex = { x: p1.x + u1.x * t, y: p1.y + u1.y * t, z: (p1.z + p2.z) / 2 };
  const out1 = norm2({ x: p1.x - apex.x, y: p1.y - apex.y });
  const out2 = norm2({ x: p2.x - apex.x, y: p2.y - apex.y });
  const dot = clamp(out1.x * out2.x + out1.y * out2.y, -1, 1);
  const theta = Math.acos(dot);
  if (theta < 0.12 || theta > Math.PI - 0.12) return [{ ...p1 }, { ...p2 }];
  const cp = Math.cos(theta / 2);
  const half = cp > 1e-3 ? Math.SQRT2 * Math.sqrt(Math.max(0, 1 - cp)) : 1;
  const tanLen = r / Math.tan(theta / 2);
  const distToApex = r / Math.sin(theta / 2);
  const bis = norm2({ x: out1.x + out2.x, y: out1.y + out2.y });
  let cx = apex.x + bis.x * distToApex;
  let cy = apex.y + bis.y * distToApex;
  // Guard against pathological wedges: keep the arc inside the node.
  const far = Math.hypot(cx - centre.x, cy - centre.y);
  if (far > 60) {
    return [{ ...p1 }, { ...p2 }];
  }
  const start = { x: apex.x + out1.x * (tanLen * 1), y: apex.y + out1.y * tanLen, z: apex.z };
  const end = { x: apex.x + out2.x * tanLen, y: apex.y + out2.y * tanLen, z: apex.z };
  const a0 = Math.atan2(start.y - cy, start.x - cx);
  let a1 = Math.atan2(end.y - cy, end.x - cx);
  let sweep = a1 - a0;
  while (sweep > Math.PI) sweep -= Math.PI * 2;
  while (sweep < -Math.PI) sweep += Math.PI * 2;
  const steps = clamp(Math.ceil(Math.abs(sweep) * 3.2), 2, 14);
  const out = [];
  // Blend from the arm's kerb point to the tangent point so the kerb line is continuous.
  out.push({ ...p1 });
  out.push(start);
  for (let i = 1; i < steps; i++) {
    const a = a0 + sweep * (i / steps);
    out.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, z: apex.z });
  }
  out.push(end);
  out.push({ ...p2 });
  return out;
}

function buildJunctionMarkings(mb, node, entry, centre, rng) {
  const hasSignals = node.control === 'signal';
  const N = { x: 0, y: 0, z: 1 };
  for (const e of entry) {
    const section = e.section;
    const inward = e.inner;              // direction of travel for a vehicle approaching the node
    const right = e.right;               // right of travel for a vehicle LEAVING the node
    const travelRight = { x: -right.x, y: -right.y, z: -right.z };
    const carFrom = section.carriageway.from;
    const carTo = section.carriageway.to;
    const halfRoad = (carTo - carFrom) / 2;

    // Stop line, set back from the junction edge.
    if (hasSignals) {
      const base = { x: e.pos.x + inward.x * 0.9, y: e.pos.y + inward.y * 0.9, z: e.pos.z };
      const a = offsetPoint(base, e.f, carTo - 0.15, 0.05);
      const b = offsetPoint(base, e.f, carFrom + 0.15, 0.05);
      strokeSegment(mb, a, b, 0.45, MAT.MARK_WHITE);
    }

    const long = e.road.length > 34;
    if (section.hasSidewalk && long) {
      // Zebra crossing: bars run along the direction of travel, repeated across the road.
      const crossZ = 2.4;
      const base0 = { x: e.pos.x + inward.x * 3.2, y: e.pos.y + inward.y * 3.2, z: e.pos.z };
      const bars = Math.max(4, Math.round((carTo - carFrom) / 1.1));
      const barW = (carTo - carFrom) / bars;
      for (let i = 0; i < bars; i++) {
        const x0 = carFrom + barW * i + barW * 0.14;
        const x1 = x0 + barW * 0.72;
        const p0 = offsetPoint(base0, e.f, x0, 0.05);
        const p1 = offsetPoint(base0, e.f, x1, 0.05);
        const base1 = { x: base0.x + inward.x * crossZ, y: base0.y + inward.y * crossZ, z: base0.z };
        const p2 = offsetPoint(base1, e.f, x0, 0.05);
        const p3 = offsetPoint(base1, e.f, x1, 0.05);
        const v0 = mb.vertex(p0, N, [1, 1, 1], MAT.MARK_WHITE);
        const v1 = mb.vertex(p1, N, [1, 1, 1], MAT.MARK_WHITE);
        const v2 = mb.vertex(p2, N, [1, 1, 1], MAT.MARK_WHITE);
        const v3 = mb.vertex(p3, N, [1, 1, 1], MAT.MARK_WHITE);
        mb.quadIdx(v0, v1, v2, v3);
      }
      // Give-way line ahead of the crossing on an unsignalled approach.
      if (!hasSignals && e.road.family <= 4) {
        const base = { x: e.pos.x + inward.x * 7.4, y: e.pos.y + inward.y * 7.4, z: e.pos.z };
        const a = offsetPoint(base, e.f, carTo - 0.3, 0.05);
        const b = offsetPoint(base, e.f, carFrom + 0.3, 0.05);
        strokeSegment(mb, a, b, 0.3, MAT.MARK_WHITE);
      }
    }

    // Turn arrows in the approach lanes, where the arm is long enough to hold them.
    if (hasSignals && e.road.length > 42 && section.lanes.length) {
      const lanes = section.lanes.slice().sort((a, b) => a.x0 - b.x0);
      const n = Math.min(lanes.length, 4);
      for (let li = 0; li < n; li++) {
        const lane = lanes[li];
        const kind = n === 1 ? 'ARROW_STRAIGHT' : li === 0 ? 'ARROW_LEFT' : li === n - 1 ? 'ARROW_RIGHT' : 'ARROW_STRAIGHT';
        const g = GLYPHS[kind];
        if (!g) continue;
        const mid = (lane.x0 + lane.x1) / 2;
        const base = { x: e.pos.x + inward.x * 13, y: e.pos.y + inward.y * 13, z: e.pos.z };
        const centre = offsetPoint(base, e.f, mid, 0.05);
        const w = 1.5;
        const h = 3.4;
        // Local frame: +x to the driver's right, +y along travel.
        const origin = { x: centre.x - travelRight.x * (w / 2), y: centre.y - travelRight.y * (w / 2), z: centre.z };
        const strokes = g.map((poly) => poly.map(([x, y]) => ({ x: (x - 0.5) * w, y: (y - 0.5) * h })));
        strokeGlyph(mb, strokes, origin, { x: { x: travelRight.x, y: travelRight.y }, y: { x: inward.x, y: inward.y } }, 0.24, MAT.MARK_WHITE);
      }
    }
  }
}

/**
 * Street furniture that belongs to the junction rather than to a road: signal heads on the approach
 * kerbs, and a keep-right bollard on the nose of a roundabout island.
 */
function buildJunctionProps(node, entry, centre, rng, out) {
  const majors = entry.filter((e) => e.road.family >= 4);
  if (node.control === 'signal' && entry.length >= 3 && majors.length >= 2) {
    const withKerb = majors.filter((e) => e.section.kerbBands.length);
    const chosen = withKerb.length ? withKerb.slice(0, 3) : [];
    for (const e of chosen) {
      const kerbs = e.section.kerbBands;
      for (const side of [1]) {
        const x = side < 0 ? kerbs[0].x0 : kerbs[kerbs.length - 1].x1;
        const base = offsetPoint(
          { x: e.pos.x + e.inner.x * 1.6, y: e.pos.y + e.inner.y * 1.6, z: e.pos.z },
          e.f,
          x + side * 0.35,
          e.section.profile.kerbHeight ?? 0.13,
        );
        out.push({ kind: 'signal', x: base.x, y: base.y, z: base.z, rot: Math.atan2(-e.inner.y, -e.inner.x), scale: 1, road: e.road.id });
      }
    }
  }
  if (node.roundabout && node.centreIslandRadius) {
    const r = node.centreIslandRadius;
    out.push({ kind: 'keepright', x: centre.x - r - 1.2, y: centre.y, z: centre.z + 0.05, rot: 0, scale: 1 });
  }
}

//--------------------------------------------------------------------------------------------------
//  Props
//--------------------------------------------------------------------------------------------------
/**
 * Walks every road's prop lines and produces placement records. Prop geometry is drawn instanced,
 * so a sixty-kilometre network costs one draw call per prop type instead of one per lamp post.
 */
export function buildPropInstances(net, opts = {}) {
  const rng = new Rng(opts.seed ?? 7, 3);
  const out = [];
  const lampSpacing = { motorway: 52, trunk: 44, arterial: 38, collector: 34, local: 30 };
  for (const road of net.roads) {
    if (!road._frames) continue;
    const section = road._section || sectionOf(road.profile);
    const total = road.length;
    for (const prop of section.props) {
      if (!prop.kind) continue;
      if (prop.spacing === 'continuous') continue; // continuous furniture is geometry, not instances
      if (prop.kind === 'kerb') {
        // Kerb lines carry gully gratings, not a bollard every few metres.
        const total2 = road.length;
        for (let s = 18; s < total2 - 6; s += 42) {
          const p = alongPath(road.path, s, false);
          const idx = clamp(p.i, 0, road._frames.length - 1);
          const f = road._frames[idx];
          const world = offsetPoint(p, f, prop.x + (prop.x < 0 ? -0.25 : 0.25), 0.02);
          out.push({ kind: 'drain', x: world.x, y: world.y, z: world.z, rot: Math.atan2(f.t.y, f.t.x), scale: 1, road: road.id });
        }
        continue;
      }
      const spacing =
        prop.kind === 'bollard' ? 13 : prop.kind === 'lamp' ? lampSpacing[road.cls] || 34 : prop.kind === 'tree' ? 17 : prop.kind === 'guardrail' ? 2.4 : prop.spacing || 26;
      const side = prop.x < 0 ? -1 : 1;
      for (let s = spacing * 0.5; s < total - 1.5; s += spacing) {
        if (prop.kind === 'lamp' && road.cls === 'motorway' && Math.round(s / spacing) % 2 !== 0) continue;
        if (prop.kind === 'tree' && rng.bool(0.14)) continue;
        if (prop.kind === 'bollard' && rng.bool(0.2)) continue;
        if (prop.kind === 'tree' && s < 18) continue;
        const p = alongPath(road.path, s, false);
        const idx = clamp(p.i, 0, road._frames.length - 1);
        const f = road._frames[idx];
        const world = offsetPoint(p, f, prop.x, prop.z);
        const heading = Math.atan2(f.t.y, f.t.x);
        out.push({
          kind: prop.kind,
          x: world.x,
          y: world.y,
          z: world.z,
          rot: heading,
          scale: rng.f(0.9, 1.1),
          road: road.id,
          side,
        });
      }
    }
    // Mirrors: a traffic sign at the start of the kerb line on one side of every street.
    if (section.hasSidewalk && road.family >= 3 && total > 60) {
      const signCount = clamp(Math.round(total / 150), 1, 6);
      for (let i = 0; i < signCount; i++) {
        const s = ((i + 0.5) / signCount) * total;
        const p = alongPath(road.path, s, false);
        const idx = clamp(p.i, 0, road._frames.length - 1);
        const f = road._frames[idx];
        const kerb = section.kerbBands.length ? section.kerbBands[section.kerbBands.length - 1].x1 : section.carriageway.to;
        const world = offsetPoint(p, f, kerb + 0.6, 0.13);
        out.push({ kind: 'sign', x: world.x, y: world.y, z: world.z, rot: Math.atan2(f.t.y, f.t.x) + Math.PI, scale: 1, road: road.id });
      }
    }
    // Speed humps on the local streets that asked for them.
    if (road.profile && road.profile.speedBumps && total > 90) {
      const count = clamp(Math.round(total / 110), 1, 5);
      for (let i = 0; i < count; i++) {
        const s = ((i + 0.5) / count) * total;
        const p = alongPath(road.path, s, false);
        const idx = clamp(p.i, 0, road._frames.length - 1);
        const f = road._frames[idx];
        const world = offsetPoint(p, f, 0, 0);
        out.push({ kind: 'speedhump', x: world.x, y: world.y, z: world.z, rot: Math.atan2(f.t.y, f.t.x), scale: 1, road: road.id, width: section.carriageway.to - section.carriageway.from });
      }
    }
    // Traffic calming / pedestrian crossings on footways: P signs and the tactile paving strip.
  }
  return out;
}

/**
 * Local mesh for one prop kind: base at the origin, +X across, +Z up. Cached, because the renderer
 * builds one instanced batch per kind.
 */
const propCache = new Map();
export function propGeometry(kind) {
  if (propCache.has(kind)) return propCache.get(kind);
  const mb = new MeshBuilder(kind);
  const add = (builder) => builder(mb);
  const builders = {
    lamp: (m) => {
      m.box(0, 0, 0.18, 0.5, 0.5, 0.36, MAT.CONCRETE, [0.85, 0.85, 0.85]);
      m.box(0, 0, 4.2, 0.16, 0.16, 8.0, MAT.METAL, [0.62, 0.64, 0.66]);
      m.box(-0.75, 0, 8.1, 1.6, 0.14, 0.14, MAT.METAL, [0.62, 0.64, 0.66]);
      m.box(-1.45, 0, 8.0, 0.6, 0.3, 0.18, MAT.GLASS, [1, 0.95, 0.8]);
    },
    bollard: (m) => {
      m.box(0, 0, 0.45, 0.16, 0.16, 0.9, MAT.METAL, [0.75, 0.76, 0.78]);
      m.box(0, 0, 0.82, 0.18, 0.18, 0.12, MAT.MARK_WHITE, [1, 1, 1]);
    },
    tree: (m) => {
      m.box(0, 0, 1.4, 0.3, 0.3, 2.8, MAT.WOOD, [0.7, 0.6, 0.5]);
      // Three offset lobes read as a crown without needing a sphere primitive.
      for (const [dx, dy, dz, r] of [[0, 0, 4.4, 1.5], [0.8, 0.3, 3.9, 1.1], [-0.7, -0.4, 4.0, 1.05]]) {
        m.box(dx, dy, dz, r * 2, r * 2, r * 2, MAT.FOLIAGE, [0.85, 0.95, 0.8]);
      }
    },
    guardpost: (m) => {
      m.box(0, 0, 0.55, 0.2, 0.2, 1.1, MAT.METAL, [0.7, 0.7, 0.72]);
    },
    guardrail: (m) => {
      m.box(0, 0, 0.6, 0.18, 0.18, 1.2, MAT.METAL, [0.7, 0.7, 0.72]);
      // W-beam: three plates so it catches light like a real corrugated rail.
      m.box(0, 0, 0.95, 0.06, 0.45, 0.22, MAT.METAL, [0.85, 0.86, 0.88], Math.PI / 2);
      m.box(0, 0, 0.72, 0.06, 0.45, 0.18, MAT.METAL, [0.7, 0.72, 0.74], Math.PI / 2);
    },
    barrier: (m) => {
      m.box(0, 0, 0.45, 0.2, 0.9, 0.9, MAT.CONCRETE, [0.9, 0.9, 0.9]);
      m.box(0, 0, 0.06, 0.3, 1.2, 0.13, MAT.CONCRETE, [0.85, 0.85, 0.85]);
    },
    sign: (m) => {
      m.box(0, 0, 1.3, 0.09, 0.09, 2.6, MAT.METAL, [0.7, 0.72, 0.74]);
      m.box(0, 0, 2.75, 0.06, 0.75, 0.75, MAT.MARK_RED, [1, 1, 1]);
      m.box(0.04, 0, 2.75, 0.03, 0.6, 0.6, MAT.MARK_WHITE, [1, 1, 1]);
    },
    signal: (m) => {
      m.box(0, 0, 1.6, 0.14, 0.14, 3.2, MAT.METAL, [0.55, 0.57, 0.6]);
      m.box(0.25, 0, 3.6, 0.6, 0.28, 0.9, MAT.METAL, [0.3, 0.32, 0.34]);
      m.box(0.25, 0, 3.95, 0.2, 0.1, 0.2, MAT.MARK_RED, [1, 0.3, 0.3]);
      m.box(0.25, 0, 3.6, 0.2, 0.1, 0.2, MAT.MARK_YELLOW, [1, 0.8, 0.2]);
      m.box(0.25, 0, 3.25, 0.2, 0.1, 0.2, MAT.MARK_GREEN, [0.3, 1, 0.4]);
    },
    speedhump: (m) => {
      m.box(0, 0, 0.06, 3.7, 3.2, 0.12, MAT.ASPHALT_LIGHT, [0.86, 0.86, 0.88], 0);
      m.box(0, 0, 0.11, 3.0, 3.0, 0.1, MAT.MARK_WHITE, [1, 1, 1]);
    },
    keepright: (m) => {
      m.box(0, 0, 0.2, 0.4, 0.6, 0.4, MAT.MARK_WHITE, [1, 1, 1]);
    },
    drain: (m) => {
      m.box(0, 0, 0.01, 0.5, 0.34, 0.04, MAT.METAL, [0.35, 0.36, 0.38]);
    },
  };
  const b = builders[kind];
  if (b) b(mb);
  const arrays = mb.toArrays();
  propCache.set(kind, arrays);
  return arrays;
}

//--------------------------------------------------------------------------------------------------
//  Structures: bridges and tunnels
//--------------------------------------------------------------------------------------------------
export function buildStructures(mb, net, terrain, opts = {}) {
  const stats = { bridges: 0, tunnels: 0, piers: 0 };
  for (const road of net.roads) {
    if (!road._frames) continue;
    const section = road._section || sectionOf(road.profile);
    const spans = (road.bridgePockets || []).concat(road.bridges || []);
    const merged = mergeSpans(spans);
    for (const span of merged) {
      if (span.s1 - span.s0 < 6) continue;
      mb.beginGroup('bridge', { road: road.id, kind: 'bridge' });
      const spanHalf = (span.s1 - span.s0) / 2;
      const zs = [0, spanHalf, spanHalf * 2];
      const deckPath = subPath(road.path, span.s0, span.s1, false);
      if (deckPath.length < 2) {
        mb.endGroup();
        continue;
      }
      const frames = pathFrames(deckPath, false);
      const half = halfWidthOf(road.profile);
      const deckDrop = 0.55;
      const deckZ = [];
      const rows = deckPath.map((p, i) => {
        const f = frames[i];
        const right = { x: f.t.y * f.up.z - f.t.z * f.up.y, y: f.t.z * f.up.x - f.t.x * f.up.z, z: f.t.x * f.up.y - f.t.y * f.up.x };
        const top = 0.0;
        const bot = -deckDrop;
        const l = { pos: p, f, right, top, bot };
        return l;
      });
      // Deck soffit
      for (let i = 0; i < rows.length - 1; i++) {
        const a = rows[i];
        const b = rows[i + 1];
        const aL = { x: a.pos.x + a.right.x * half, y: a.pos.y + a.right.y * half, z: a.pos.z + a.bot };
        const aR = { x: a.pos.x - a.right.x * half, y: a.pos.y - a.right.y * half, z: a.pos.z + a.bot };
        const bL = { x: b.pos.x + b.right.x * half, y: b.pos.y + b.right.y * half, z: b.pos.z + b.bot };
        const bR = { x: b.pos.x - b.right.x * half, y: b.pos.y - b.right.y * half, z: b.pos.z + b.bot };
        const nDown = { x: 0, y: 0, z: -1 };
        const nmL = { x: a.right.x, y: a.right.y, z: 0 };
        const nmR = { x: -a.right.x, y: -a.right.y, z: 0 };
        const v0 = mb.vertex(aL, nDown, [0.9, 0.9, 0.92], MAT.CONCRETE);
        const v1 = mb.vertex(aR, nDown, [0.9, 0.9, 0.92], MAT.CONCRETE);
        const v2 = mb.vertex(bL, nDown, [0.9, 0.9, 0.92], MAT.CONCRETE);
        const v3 = mb.vertex(bR, nDown, [0.9, 0.9, 0.92], MAT.CONCRETE);
        mb.quadIdx(v2, v1, v0, v3, true);
        // Side faces of the deck slab
        const f0 = mb.vertex({ ...aL, z: a.pos.z + 0.05 }, nmL, [1, 1, 1], MAT.CONCRETE);
        const f1 = mb.vertex({ ...bL, z: b.pos.z + 0.05 }, nmL, [1, 1, 1], MAT.CONCRETE);
        const f2 = mb.vertex(aL, nmL, [1, 1, 1], MAT.CONCRETE);
        const f3 = mb.vertex(bL, nmL, [1, 1, 1], MAT.CONCRETE);
        mb.quadIdx(f0, f1, f2, f3, true);
        const g0 = mb.vertex({ ...bR, z: b.pos.z + 0.05 }, nmR, [1, 1, 1], MAT.CONCRETE);
        const g1 = mb.vertex({ ...aR, z: a.pos.z + 0.05 }, nmR, [1, 1, 1], MAT.CONCRETE);
        const g2 = mb.vertex(bR, nmR, [1, 1, 1], MAT.CONCRETE);
        const g3 = mb.vertex(aR, nmR, [1, 1, 1], MAT.CONCRETE);
        mb.quadIdx(g0, g1, g2, g3, true);
      }
      // Piers where the deck is high enough, spaced along the span.
      const clear = span.clearance ?? 6.5;
      const pierCount = clamp(Math.floor((span.s1 - span.s0) / 32), 1, 6);
      for (let pi = 1; pi <= pierCount; pi++) {
        const s = span.s0 + ((span.s1 - span.s0) * pi) / (pierCount + 1);
        const p = alongPath(road.path, s, false);
        const idx = clamp(p.i, 0, road._frames.length - 1);
        const f = road._frames[idx];
        const groundZ = terrain ? terrain.baseHeight(p.x, p.y) : p.z - clear;
        const height = Math.max(1, p.z - groundZ);
        if (height < 2.5) continue;
        const pierW = 1.5;
        const right = { x: f.t.y * f.up.z - f.t.z * f.up.y, y: f.t.z * f.up.x - f.t.x * f.up.z, z: f.t.x * f.up.y - f.t.y * f.up.x };
        for (const side of [-1, 1]) {
          const cx = p.x + right.x * half * 0.62 * side;
          const cy = p.y + right.y * half * 0.62 * side;
          mb.box(cx, cy, groundZ + height / 2, pierW, pierW, height, MAT.CONCRETE, [0.94, 0.94, 0.94], Math.atan2(f.t.y, f.t.x));
          stats.piers++;
        }
        // Pier cap
        mb.box(p.x, p.y, groundZ + height - 0.4, pierW * 1.1, pierW * 1.1, 0.8, MAT.CONCRETE, [0.9, 0.9, 0.9], Math.atan2(f.t.y, f.t.x));
      }
      stats.bridges++;
      mb.endGroup();
    }
  }
  return stats;
}

function mergeSpans(spans) {
  const sorted = spans.slice().sort((a, b) => a.s0 - b.s0);
  const out = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.s0 <= last.s1 + 6) {
      last.s1 = Math.max(last.s1, s.s1);
      last.clearance = Math.max(last.clearance ?? 0, s.clearance ?? 0);
    } else out.push({ ...s });
  }
  return out;
}

//--------------------------------------------------------------------------------------------------
//  Railways
//--------------------------------------------------------------------------------------------------
export function buildRailways(mb, net, terrain, opts = {}) {
  const stats = { sleeperCount: 0, crossingCount: 0 };
  for (const rail of net.railways) {
    if (rail.path.length < 2) continue;
    const frames = pathFrames(rail.path, false);
    mb.beginGroup('railway', { rail: rail.id, kind: 'rail' });
    // Ballast shoulder
    const ballastRows = [];
    for (let i = 0; i < rail.path.length; i++) {
      const p = rail.path[i];
      const f = frames[i];
      const right = { x: f.t.y * f.up.z - f.t.z * f.up.y, y: f.t.z * f.up.x - f.t.x * f.up.z, z: f.t.x * f.up.y - f.t.y * f.up.x };
      const w = 3.6;
      const h = 0.55;
      const a = mb.vertex({ x: p.x + right.x * w, y: p.y + right.y * w, z: p.z - h }, norm3({ x: right.x * 0.7, y: right.y * 0.7, z: 0.7 }), [1, 1, 1], MAT.BALLAST);
      const b = mb.vertex({ x: p.x, y: p.y, z: p.z }, { x: 0, y: 0, z: 1 }, [1, 1, 1], MAT.BALLAST);
      const c = mb.vertex({ x: p.x - right.x * w, y: p.y - right.y * w, z: p.z - h }, norm3({ x: -right.x * 0.7, y: -right.y * 0.7, z: 0.7 }), [1, 1, 1], MAT.BALLAST);
      ballastRows.push([a, b, c]);
    }
    for (let i = 0; i < ballastRows.length - 1; i++) {
      mb.strip([ballastRows[i][0], ballastRows[i][1]], [ballastRows[i + 1][0], ballastRows[i + 1][1]]);
      mb.strip([ballastRows[i][1], ballastRows[i][2]], [ballastRows[i + 1][1], ballastRows[i + 1][2]]);
    }
    // Sleepers and rails
    const gauge = 1.435;
    let s = 0;
    while (s < rail.length) {
      const p = alongPath(rail.path, s, false);
      const idx = clamp(p.i, 0, frames.length - 1);
      const f = frames[idx];
      const right = { x: f.t.y * f.up.z - f.t.z * f.up.y, y: f.t.z * f.up.x - f.t.x * f.up.z, z: f.t.x * f.up.y - f.t.y * f.up.x };
      const yaw = Math.atan2(f.t.y, f.t.x);
      mb.box(p.x, p.y, p.z - 0.06, 0.26, 2.6, 0.16, MAT.WOOD, [0.85, 0.8, 0.75], yaw);
      stats.sleeperCount++;
      s += 0.62;
    }
    for (const side of [-1, 1]) {
      const railPath = rail.path.map((p, i) => {
        const f = frames[i];
        const right = { x: f.t.y * f.up.z - f.t.z * f.up.y, y: f.t.z * f.up.x - f.t.x * f.up.z, z: f.t.x * f.up.y - f.t.y * f.up.x };
        return { x: p.x + right.x * (gauge / 2) * side, y: p.y + right.y * (gauge / 2) * side, z: p.z + 0.13 };
      });
      for (let i = 0; i < railPath.length - 1; i++) {
        const a = railPath[i];
        const b = railPath[i + 1];
        const width = 0.075;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const l = Math.hypot(dx, dy) || 1;
        const nx = (-dy / l) * (width / 2);
        const ny = (dx / l) * (width / 2);
        const nLow = { x: 0, y: 0, z: 1 };
        const nSide = { x: nx / (width / 2 || 1), y: ny / (width / 2 || 1), z: 0 };
        const t0 = mb.vertex({ x: a.x + nx, y: a.y + ny, z: a.z + 0.09 }, nLow, [1, 1, 1], MAT.RAILSTEEL);
        const t1 = mb.vertex({ x: b.x + nx, y: b.y + ny, z: b.z + 0.09 }, nLow, [1, 1, 1], MAT.RAILSTEEL);
        const t2 = mb.vertex({ x: b.x - nx, y: b.y - ny, z: b.z + 0.09 }, nLow, [1, 1, 1], MAT.RAILSTEEL);
        const t3 = mb.vertex({ x: a.x - nx, y: a.y - ny, z: a.z + 0.09 }, nLow, [1, 1, 1], MAT.RAILSTEEL);
        mb.quadIdx(t0, t1, t2, t3);
      }
    }
    // Catenary masts and wire
    if (rail.electrified) {
      let m = 0;
      while (m < rail.length) {
        const p = alongPath(rail.path, m, false);
        const idx = clamp(p.i, 0, frames.length - 1);
        const f = frames[idx];
        const right = { x: f.t.y * f.up.z - f.t.z * f.up.y, y: f.t.z * f.up.x - f.t.x * f.up.z, z: f.t.x * f.up.y - f.t.y * f.up.x };
        const px = p.x + right.x * 3.4;
        const py = p.y + right.y * 3.4;
        const groundZ = terrain ? terrain.height(px, py) : p.z - 0.5;
        const h = clamp(p.z - groundZ, 2, 9) + 3.2;
        mb.box(px, py, groundZ + h / 2, 0.24, 0.24, h, MAT.METAL, [0.7, 0.72, 0.75], Math.atan2(f.t.y, f.t.x));
        // cantilever arm
        mb.box(px - right.x * 1.7, py - right.y * 1.7, groundZ + h - 0.25, 3.4, 0.16, 0.16, MAT.METAL, [0.7, 0.72, 0.75], Math.atan2(f.t.y, f.t.x));
        m += 46;
      }
    }
    // Level crossings: rubber panels, the white stop line ahead of them and the boom barriers.
    for (const crossing of rail.crossings) {
      if (crossing.kind === 'over') continue;
      const p = alongPath(rail.path, crossing.s, false);
      const idx = clamp(p.i, 0, frames.length - 1);
      const f = frames[idx];
      const right = { x: f.t.y * f.up.z - f.t.z * f.up.y, y: f.t.z * f.up.x - f.t.x * f.up.z, z: f.t.x * f.up.y - f.t.y * f.up.x };
      const yaw = Math.atan2(f.t.y, f.t.x);
      mb.box(p.x, p.y, p.z + 0.02, 3.4, 8.2, 0.12, MAT.ASPHALT_LIGHT, [0.95, 0.95, 0.93], yaw);
      mb.box(p.x, p.y, p.z + 0.14, 3.4, 0.35, 0.12, MAT.MARK_WHITE, [1, 1, 1], yaw);
      if (crossing.protected) {
        for (const side of [-1, 1]) {
          const bx = p.x + right.x * 4.8 * side;
          const by = p.y + right.y * 4.8 * side;
          // Barrier pedestal, boom and the two warning lights.
          mb.box(bx, by, p.z + 0.75, 0.4, 0.4, 1.5, MAT.METAL, [0.8, 0.8, 0.82], yaw);
          mb.box(bx, by, p.z + 1.55, 0.18, 0.18, 0.5, MAT.MARK_RED, [1, 1, 1], yaw);
          mb.box(bx - right.x * 1.0 * side, by - right.y * 1.0 * side, p.z + 1.45, 0.14, 1.9, 0.14, MAT.MARK_RED, [1, 1, 1], yaw);
          for (const light of [-0.25, 0.25]) {
            mb.box(bx + Math.cos(yaw) * light, by + Math.sin(yaw) * light, p.z + 2.1, 0.2, 0.2, 0.2, MAT.MARK_AMBER, [1, 0.75, 0.2], yaw);
          }
          // St Andrew's cross panel beside the road.
          const cx = bx + right.x * 1.6 * side;
          const cy = by + right.y * 1.6 * side;
          for (const dir of [1, -1]) {
            const arm = { x: (right.x * side + f.t.x * dir) * 0.6, y: (right.y * side + f.t.y * dir) * 0.6 };
            mb.box(cx + arm.x, cy + arm.y, p.z + 1.3, 0.06, 0.36, 1.5, MAT.MARK_WHITE, [1, 1, 1], yaw + dir * 0.6);
          }
        }
      }
      stats.crossingCount++;
    }
    mb.endGroup();
  }
  return stats;
}

//--------------------------------------------------------------------------------------------------
//  Subway
//--------------------------------------------------------------------------------------------------
export function buildSubways(mb, net, opts = {}) {
  const stats = { stations: 0, tunnelKm: 0 };
  for (const line of net.subways) {
    if (line.path.length < 2) continue;
    mb.beginGroup('subway', { line: line.id, kind: 'subway' });
    const frames = pathFrames(line.path, false);
    const radius = 2.9;
    const sides = 12;
    const rows = [];
    for (let i = 0; i < line.path.length; i++) {
      const p = line.path[i];
      const f = frames[i];
      const right = { x: f.t.y * f.up.z - f.t.z * f.up.y, y: f.t.z * f.up.x - f.t.x * f.up.z, z: f.t.x * f.up.y - f.t.y * f.up.x };
      const row = [];
      for (let k = 0; k < sides; k++) {
        const a = (k / sides) * Math.PI * 2;
        const off = { x: right.x * Math.cos(a) + f.up.x * Math.sin(a), y: right.y * Math.cos(a) + f.up.y * Math.sin(a), z: right.z * Math.cos(a) + f.up.z * Math.sin(a) };
        const pos = { x: p.x + off.x * radius, y: p.y + off.y * radius, z: p.z + off.z * radius };
        row.push(mb.vertex(pos, { x: -off.x, y: -off.y, z: -off.z }, [0.8, 0.8, 0.82], MAT.TUNNEL_WALL));
      }
      rows.push(row);
    }
    for (let i = 0; i < rows.length - 1; i++) mb.stripClosed(rows[i], rows[i + 1], true);
    stats.tunnelKm += line.length / 1000;
    // Station boxes
    for (const st of line.stations) {
      const p = alongPath(line.path, st.s, false);
      const idx = clamp(p.i, 0, frames.length - 1);
      const f = frames[idx];
      const yaw = Math.atan2(f.t.y, f.t.x);
      const depth = -p.z;
      // A box the size of a real platform pair, reaching to the surface.
      mb.box(p.x, p.y, p.z, 22, 12, 6, MAT.TUNNEL_WALL, [0.9, 0.88, 0.86], yaw);
      mb.box(p.x, p.y, -depth / 2, 16, 10, depth, MAT.TUNNEL_WALL, [0.75, 0.75, 0.78], yaw);
      // Surface entrance canopy
      mb.box(p.x, p.y, 0.2, 5.0, 3.4, 0.4, MAT.CONCRETE, [0.9, 0.9, 0.9], yaw);
      mb.box(p.x, p.y, 1.6, 4.0, 2.6, 0.25, MAT.GLASS, [0.7, 0.8, 0.9], yaw);
      for (const sx of [-1.6, 1.6]) {
        const cx = p.x + Math.cos(yaw) * sx;
        const cy = p.y + Math.sin(yaw) * sx;
        mb.box(cx, cy, 1.1, 0.22, 0.22, 2.2, MAT.METAL, [0.8, 0.8, 0.8], yaw);
      }
      stats.stations++;
    }
    mb.endGroup();
  }
  return stats;
}

//--------------------------------------------------------------------------------------------------
//  Terrain
//--------------------------------------------------------------------------------------------------
/**
 * The ground the city sits on. Sampled from the heightfield after the road corridors were stamped
 * into it, so a carriageway is never left hanging over a hill it is supposed to be cut into. The
 * grid runs a little past the map edge and drops away, which hides the boundary instead of ending
 * the world in a cliff of triangles.
 */
export function buildTerrainMesh(mb, terrain, opts = {}) {
  if (!terrain) return 0;
  const res = clamp(opts.terrainResolution ?? 240, 32, 512);
  const E = terrain.extent * 1.14;
  const step = E / (res - 1);
  const x0 = -E / 2;
  const y0 = -E / 2;
  const n = res;
  const heights = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) heights[j * n + i] = terrain.height(x0 + i * step, y0 + j * step);
  const rows = [];
  mb.beginGroup('terrain', { kind: 'terrain' });
  for (let j = 0; j < n; j++) {
    const row = [];
    for (let i = 0; i < n; i++) {
      const x = x0 + i * step;
      const y = y0 + j * step;
      const h = heights[j * n + i];
      const hl = heights[j * n + Math.max(0, i - 1)];
      const hr = heights[j * n + Math.min(n - 1, i + 1)];
      const hd = heights[Math.max(0, j - 1) * n + i];
      const hu = heights[Math.min(n - 1, j + 1) * n + i];
      const nrm = norm3({ x: hl - hr, y: hd - hu, z: 2 * step });
      const slope = 1 - nrm.z;
      const near = clamp((terrain.waterLevel + 9 - h) / 9, 0, 1);
      let mat = MAT.GRASS;
      let tint = [1, 1, 1];
      if (h < terrain.waterLevel + 0.35) {
        mat = MAT.SAND;
        tint = [0.62, 0.6, 0.53];
      } else if (near > 0.3) {
        mat = MAT.SAND;
        tint = [0.93, 0.9, 0.8];
      } else if (slope > 0.42) {
        mat = MAT.ROCK;
        tint = [0.85, 0.82, 0.8];
      } else if (slope > 0.22) {
        mat = MAT.GRAVEL;
        tint = [0.95, 0.93, 0.88];
      }
      const relief = clamp((h - terrain.waterLevel) / 130, 0, 1);
      tint = [tint[0] * (1 - relief * 0.14), tint[1] * (1 - relief * 0.18), tint[2] * (1 - relief * 0.24)];
      row.push(mb.vertex({ x, y, z: h }, nrm, tint, mat));
    }
    rows.push(row);
  }
  for (let j = 0; j < rows.length - 1; j++) mb.strip(rows[j], rows[j + 1], true);
  mb.endGroup();
  return n * n;
}

//--------------------------------------------------------------------------------------------------
//  X-ray overlay: the network's skeleton and its nodes
//--------------------------------------------------------------------------------------------------
export function buildXRay(mb, net, opts = {}) {
  const colour = { local: [0.55, 0.75, 1], collector: [0.7, 0.95, 0.55], arterial: [1, 0.9, 0.4], trunk: [1, 0.65, 0.3], motorway: [1, 0.35, 0.35], canyon: [0.4, 0.95, 1], footway: [1, 0.6, 0.8], alley: [0.6, 0.6, 1], rural: [0.7, 1, 0.7], service: [0.75, 0.7, 0.95], transit: [1, 0.5, 0.7], ramp: [1, 0.55, 0.35] };
  for (const road of net.roads) {
    if (road.cls === 'footway' || road.cls === 'cycleway') continue;
    const c = colour[road.cls] || [1, 1, 1];
    const path = road.path;
    for (let i = 0; i < path.length - 1; i++) {
      const a = { x: path[i].x, y: path[i].y, z: path[i].z + 0.6 };
      const b = { x: path[i + 1].x, y: path[i + 1].y, z: path[i + 1].z + 0.6 };
      const n = { x: 0, y: 0, z: 1 };
      const v0 = mb.vertex(a, n, c, MAT.PAINT_WHITE);
      const v1 = mb.vertex(b, n, c, MAT.PAINT_WHITE);
      const v2 = mb.vertex({ x: a.x, y: a.y, z: a.z + 0.5 }, n, c, MAT.PAINT_WHITE);
      const v3 = mb.vertex({ x: b.x, y: b.y, z: b.z + 0.5 }, n, c, MAT.PAINT_WHITE);
      mb.quadIdx(v0, v1, v2, v3, true);
      mb.quadIdx(v3, v2, v0, v1);
    }
  }
  for (const node of net.nodes) {
    const size = clamp(node.width * 0.35, 1.4, 8);
    mb.box(node.x, node.y, node.z + 0.4, size, size, 0.6, MAT.PAINT_WHITE, [1, 1, 1]);
  }
  return mb;
}

//--------------------------------------------------------------------------------------------------
//  Whole model
//--------------------------------------------------------------------------------------------------
export function buildRenderModel(net, terrain, opts = {}) {
  const t0 = now();
  const surfaces = new MeshBuilder('surfaces');
  const markings = new MeshBuilder('markings');
  const structures = new MeshBuilder('structures');
  const railMesh = new MeshBuilder('rail');
  const subwayMesh = new MeshBuilder('subway');
  const xray = new MeshBuilder('xray');
  const water = new MeshBuilder('water');
  const warnings = [];
  const props = new MeshBuilder('instance-anchors');

  const tA = now();
  buildRoadSurfaces(surfaces, net, opts);
  const tB = now();
  const junctionProps = [];
  buildJunctions(surfaces, net, opts, junctionProps);
  const tC = now();
  if (opts.markings !== false) buildRoadMarkings(markings, net, opts);
  const tD = now();
  const instances = opts.props === false ? [] : buildPropInstances(net, opts).concat(junctionProps);
  const tE = now();
  if (opts.structures !== false) buildStructures(structures, net, terrain, opts);
  const tF = now();
  if (opts.rail !== false) buildRailways(railMesh, net, terrain, opts);
  const tG = now();
  if (opts.subway !== false) buildSubways(subwayMesh, net, opts);
  const tH = now();
  buildXRay(xray, net, opts);
  const tI = now();
  if (terrain && terrain.river) terrain.buildWaterMesh(water);
  const tJ = now();
  const terrainVerts = opts.terrain === false ? 0 : buildTerrainMesh(surfaces, terrain, opts);
  const tK = now();

  if (net.roads.length === 0) warnings.push('network is empty');
  const instanceKinds = {};
  for (const it of instances) instanceKinds[it.kind] = (instanceKinds[it.kind] || 0) + 1;

  return {
    surfaces: surfaces.toArrays(),
    markings: markings.toArrays(),
    instances,
    instanceKinds,
    structures: structures.toArrays(),
    rail: railMesh.toArrays(),
    subway: subwayMesh.toArrays(),
    xray: xray.toArrays(),
    water: water.toArrays(),
    terrainVerts,
    timings: { surfaces: tB - tA, junctions: tC - tB, markings: tD - tC, props: tE - tD, structures: tF - tE, rail: tG - tF, subway: tH - tG, xray: tI - tH, water: tJ - tI, terrain: tK - tJ, total: tK - t0 },
    warnings,
  };
}
