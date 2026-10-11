// Civil structures: bridge decks with soffits/girders/piers/abutments, underpass retaining walls,
// cut-and-cover tunnels and the subway box + running tunnels seen in the cutaway view.

import { MeshBuilder, SURF } from '../core/mesh.js';
import { box, cylinder, sweep, loft, quadPatch } from '../core/geokit.js';
import { v3, v3add, v3sub, v3scale, v3madd, normXZ, clamp, lerp, TAU } from '../core/math.js';
import { worldSection } from './section.js';
import { laneBand } from './profile.js';

const GROUND_Y = 0;

/** Soffit, fascia, piers and abutments for every bridge edge; walls for every cut edge. */
export function buildStructures(net, surface, settings = {}) {
  const bridges = new MeshBuilder('bridges');
  const retaining = new MeshBuilder('retaining');
  const tunnels = new MeshBuilder('tunnels');
  const piers = [];

  for (const edge of net.edges.values()) {
    const ribbon = surface.ribbons.get(edge.id);
    if (!ribbon) continue;
    if (edge.structure === 'bridge') buildBridge(bridges, edge, ribbon, piers);
    else if (edge.structure === 'cut') buildCutWalls(retaining, edge, ribbon);
    else if (edge.structure === 'tunnel') buildTunnelBox(tunnels, edge, ribbon);
  }

  return {
    meshes: {
      bridges: bridges.vertexCount ? bridges.finish() : null,
      retaining: retaining.vertexCount ? retaining.finish() : null,
      tunnels: tunnels.vertexCount ? tunnels.finish() : null,
    },
    piers,
  };
}

function sectionExtent(edge, s) {
  const row = worldSection(edge, s);
  return { row, left: row.pts[0], right: row.pts[row.pts.length - 1], frame: row.frame };
}

function buildBridge(mb, edge, ribbon, piers) {
  const s0 = ribbon.s0, s1 = ribbon.s1;
  const span = s1 - s0;
  const step = clamp(span / Math.max(4, Math.round(span / 4)), 1.5, 5);
  const deckThickness = 0.65;   // slab; girders add the rest of the 1.6 m structure depth
  const rowsSoffit = [];
  const rowsFasciaL = [];
  const rowsFasciaR = [];
  const stations = [];
  for (let s = s0; s <= s1 + 1e-4; s += step) stations.push(Math.min(s, s1));

  for (const s of stations) {
    const { row, frame } = sectionExtent(edge, s);
    const pts = row.pts;
    const L = pts[0], R = pts[pts.length - 1];
    const yTop = Math.min(L.p.y, R.p.y);
    const soffitY = yTop - deckThickness;
    const inset = 0.55;
    const lp = { x: L.p.x, y: L.p.y - 0.35, z: L.p.z };
    const rp = { x: R.p.x, y: R.p.y - 0.35, z: R.p.z };
    const ls = { x: lerp(L.p.x, R.p.x, inset / Math.max(1, dist2(L.p, R.p))), y: soffitY, z: lerp(L.p.z, R.p.z, inset / Math.max(1, dist2(L.p, R.p))) };
    const rs = { x: lerp(R.p.x, L.p.x, inset / Math.max(1, dist2(L.p, R.p))), y: soffitY, z: lerp(R.p.z, L.p.z, inset / Math.max(1, dist2(L.p, R.p))) };
    rowsFasciaL.push([L.p, lp, ls]);
    rowsFasciaR.push([R.p, rp, rs]);
    rowsSoffit.push([ls, rs]);
  }

  mb.attr({ surface: SURF.CONCRETE });
  // soffit
  for (let i = 0; i < rowsSoffit.length - 1; i++) {
    const a = rowsSoffit[i], b = rowsSoffit[i + 1];
    quadPatch(mb, a[1], a[0], b[0], b[1], { attrs: { surface: SURF.CONCRETE } });
  }
  // fascia beams (deck edge -> soffit, with a drip chamfer)
  for (const rows of [rowsFasciaL, rowsFasciaR]) {
    const flip = rows === rowsFasciaR;
    for (let i = 0; i < rows.length - 1; i++) {
      const a = rows[i], b = rows[i + 1];
      for (let j = 0; j < a.length - 1; j++) {
        if (flip) quadPatch(mb, a[j], a[j + 1], b[j + 1], b[j], { attrs: { surface: SURF.CONCRETE } });
        else quadPatch(mb, b[j], b[j + 1], a[j + 1], a[j], { attrs: { surface: SURF.CONCRETE } });
      }
    }
  }
  // longitudinal girders under the deck, spaced like real precast beams (~2.3 m)
  const deckWidth = (() => {
    const { row } = sectionExtent(edge, (s0 + s1) / 2);
    const L = row.pts[0].p, R = row.pts[row.pts.length - 1].p;
    return Math.hypot(R.x - L.x, R.z - L.z);
  })();
  const girderCount = clamp(Math.round((deckWidth - 2.4) / 2.325), 3, 11);
  for (let g = 0; g < girderCount; g++) {
    const f = 0.08 + (0.84 * (g + 0.5)) / girderCount;
    const path = stations.map((s) => {
      const { row } = sectionExtent(edge, s);
      const L = row.pts[0].p, R = row.pts[row.pts.length - 1].p;
      return { x: lerp(L.x, R.x, f), y: Math.min(L.y, R.y) - 0.65, z: lerp(L.z, R.z, f) };
    });
    sweep(mb, path, [
      { x: -0.34, y: 0 }, { x: 0.34, y: 0 }, { x: 0.34, y: -0.08 }, { x: 0.11, y: -0.18 },
      { x: 0.11, y: -0.76 }, { x: 0.30, y: -0.86 }, { x: 0.30, y: -0.95 }, { x: -0.30, y: -0.95 },
      { x: -0.30, y: -0.86 }, { x: -0.11, y: -0.76 }, { x: -0.11, y: -0.18 }, { x: -0.34, y: -0.08 },
    ], { surface: SURF.CONCRETE, closedProfile: true, capEnds: true });
  }

  // piers every ~24 m plus abutments at each end
  const pierSpacing = 48;   // one span between supports, per the reference basis
  const pierCount = Math.max(0, Math.round(span / pierSpacing) - 1);
  for (let i = 1; i <= pierCount; i++) {
    const s = s0 + (span * i) / (pierCount + 1);
    const { row, frame } = sectionExtent(edge, s);
    const L = row.pts[0].p, R = row.pts[row.pts.length - 1].p;
    const c = { x: (L.x + R.x) / 2, y: Math.min(L.y, R.y) - 2.15, z: (L.z + R.z) / 2 };
    const width = Math.hypot(R.x - L.x, R.z - L.z);
    const yaw = Math.atan2(frame.t.z, frame.t.x);
    // pier cap
    box(mb, { x: c.x, y: c.y + 0.45, z: c.z }, { x: 1.5, y: 0.9, z: width * 0.78 },
      { yaw, attrs: { surface: SURF.CONCRETE } });
    const baseY = GROUND_Y - 0.3;
    const colCount = width > 14 ? 2 : 1;
    for (let k = 0; k < colCount; k++) {
      const off = colCount === 1 ? 0 : (k === 0 ? -width * 0.22 : width * 0.22);
      const cp = {
        x: c.x + frame.right.x * off, y: baseY, z: c.z + frame.right.z * off,
      };
      cylinder(mb, cp, { x: cp.x, y: c.y, z: cp.z }, 0.95, 0.8, 18, { attrs: { surface: SURF.CONCRETE } });
      box(mb, { x: cp.x, y: baseY + 0.25, z: cp.z }, { x: 2.6, y: 0.5, z: 2.6 }, { yaw, attrs: { surface: SURF.CONCRETE } });
      piers.push(cp);
    }
  }

  for (const end of [0, 1]) {
    const s = end === 0 ? s0 : s1;
    const { row, frame } = sectionExtent(edge, s);
    const L = row.pts[0].p, R = row.pts[row.pts.length - 1].p;
    const c = { x: (L.x + R.x) / 2, z: (L.z + R.z) / 2 };
    const width = Math.hypot(R.x - L.x, R.z - L.z);
    const top = Math.min(L.y, R.y) - 1.0;
    const yaw = Math.atan2(frame.t.z, frame.t.x);
    const depth = Math.max(0.6, top - (GROUND_Y - 1.2));
    box(mb, { x: c.x, y: top - depth / 2, z: c.z }, { x: 1.6, y: depth, z: width + 0.8 },
      { yaw, attrs: { surface: SURF.CONCRETE } });
    for (const sd of [-1, 1]) {
      const wp = {
        x: c.x + frame.right.x * (width / 2 + 0.3) * sd - frame.t.x * 2.2 * (end === 0 ? 1 : -1),
        y: top - depth / 2 + 0.25,
        z: c.z + frame.right.z * (width / 2 + 0.3) * sd - frame.t.z * 2.2 * (end === 0 ? 1 : -1),
      };
      box(mb, wp, { x: 5.0, y: depth * 0.8, z: 0.6 }, { yaw, attrs: { surface: SURF.CONCRETE } });
    }
  }
}

/** Retaining walls for a depressed (cut) road: verge top up to ground level, with coping. */
function buildCutWalls(mb, edge, ribbon) {
  const stations = ribbon.stations.map((st) => st.s);
  const left = [], right = [];
  for (const s of stations) {
    const { row } = sectionExtent(edge, s);
    left.push(row.pts[0].p);
    right.push(row.pts[row.pts.length - 1].p);
  }
  mb.attr({ surface: SURF.CONCRETE });
  for (const [side, path] of [[-1, left], [1, right]]) {
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i], b = path[i + 1];
      if (a.y > GROUND_Y - 0.8) continue;
      const at = { x: a.x, y: GROUND_Y + 0.25, z: a.z };
      const bt = { x: b.x, y: GROUND_Y + 0.25, z: b.z };
      const ao = { x: a.x + (side * 0.35), y: GROUND_Y + 0.25, z: a.z };
      const bo = { x: b.x + (side * 0.35), y: GROUND_Y + 0.25, z: b.z };
      if (side < 0) {
        quadPatch(mb, a, at, bt, b, { attrs: { surface: SURF.CONCRETE } });
        quadPatch(mb, at, ao, bo, bt, { attrs: { surface: SURF.CONCRETE } });
      } else {
        quadPatch(mb, b, bt, at, a, { attrs: { surface: SURF.CONCRETE } });
        quadPatch(mb, bt, bo, ao, at, { attrs: { surface: SURF.CONCRETE } });
      }
    }
  }
}

/** Cut-and-cover box: walls + ceiling + portal headwalls. */
function buildTunnelBox(mb, edge, ribbon) {
  const stations = ribbon.stations.map((st) => st.s);
  const clearance = 5.2;
  const rows = [];
  for (const s of stations) {
    const { row } = sectionExtent(edge, s);
    const L = row.pts[0].p, R = row.pts[row.pts.length - 1].p;
    rows.push([
      { x: L.x, y: L.y, z: L.z },
      { x: L.x, y: L.y + clearance, z: L.z },
      { x: R.x, y: R.y + clearance, z: R.z },
      { x: R.x, y: R.y, z: R.z },
    ]);
  }
  mb.attr({ surface: SURF.TUNNEL_LINING });
  for (let i = 0; i < rows.length - 1; i++) {
    const a = rows[i], b = rows[i + 1];
    for (let j = 0; j < 3; j++) {
      quadPatch(mb, a[j], b[j], b[j + 1], a[j + 1], { attrs: { surface: SURF.TUNNEL_LINING } });
    }
  }
}

/** Subway running tunnel + station box, drawn only in the cutaway layer. */
export function buildSubway(path, settings = {}) {
  const mb = new MeshBuilder('subway');
  const radius = settings.radius ?? 3.1;
  const depth = settings.depth ?? -11.5;
  const segments = 14;
  const sections = path.map((p, i) => {
    const prev = path[Math.max(0, i - 1)], next = path[Math.min(path.length - 1, i + 1)];
    const dir = normXZ(v3sub(next, prev));
    const right = { x: dir.z, y: 0, z: -dir.x };
    const ring = [];
    for (let k = 0; k < segments; k++) {
      const a = (k / segments) * TAU;
      ring.push({
        x: p.x + right.x * Math.cos(a) * radius,
        y: depth + Math.sin(a) * radius,
        z: p.z + right.z * Math.cos(a) * radius,
        surface: SURF.TUNNEL_LINING,
      });
    }
    return ring;
  });
  loft(mb, sections, { closed: true, surface: SURF.TUNNEL_LINING });

  // running rails + platform slab inside
  const trackPath = path.map((p) => ({ x: p.x, y: depth - radius + 0.45, z: p.z }));
  sweep(mb, trackPath, [
    { x: -2.2, y: 0 }, { x: 2.2, y: 0 }, { x: 2.2, y: -0.25 }, { x: -2.2, y: -0.25 },
  ], { surface: SURF.CONCRETE, closedProfile: true });
  for (const off of [-0.7175, 0.7175]) {
    sweep(mb, trackPath.map((p) => ({ x: p.x, y: p.y + 0.02, z: p.z })), [
      { x: off - 0.07, y: 0 }, { x: off + 0.07, y: 0 }, { x: off + 0.07, y: 0.03 },
      { x: off + 0.025, y: 0.06 }, { x: off + 0.035, y: 0.15 }, { x: off - 0.035, y: 0.15 },
      { x: off - 0.025, y: 0.06 }, { x: off - 0.07, y: 0.03 },
    ], { surface: SURF.RAIL_STEEL, closedProfile: true });
  }

  // station box at the middle of the alignment
  const mid = path[Math.floor(path.length / 2)];
  const prev = path[Math.max(0, Math.floor(path.length / 2) - 1)];
  const yaw = Math.atan2(mid.z - prev.z, mid.x - prev.x);
  box(mb, { x: mid.x, y: depth + 0.5, z: mid.z }, { x: 76, y: 9.5, z: 17 },
    { yaw, attrs: { surface: SURF.TUNNEL_LINING } });
  box(mb, { x: mid.x, y: depth - radius + 1.2, z: mid.z }, { x: 70, y: 0.5, z: 11 },
    { yaw, attrs: { surface: SURF.CONCRETE } });
  return mb.finish();
}

function dist2(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }
