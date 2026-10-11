// Railways: ballasted track, concrete sleepers, UIC-ish rail profile, level crossings cut into the
// carriageway with flangeways and crossing panels, plus the rolling stock mesh used for trains.

import { MeshBuilder, SURF } from '../core/mesh.js';
import { box, cylinder, sweep, loft, lathe, quadPatch, platePoly } from '../core/geokit.js';
import { Curve, resamplePolyline } from '../core/spline.js';
import { v3, v3sub, v3add, v3scale, normXZ, clamp, lerp, TAU, pointSegDist2D } from '../core/math.js';
import { totalWidth, laneBand, GUTTER_WIDTH, KERB } from './profile.js';

export const GAUGE = 1.435;
const RAIL_OFFSET = GAUGE / 2;
const PANEL_HALF = RAIL_OFFSET + 1.5;   // paved panel reaches 1.5 m outside each rail

export function makeRailLine(points, opts = {}) {
  return {
    id: opts.id || 'rail',
    curve: new Curve(points, { samples: 400 }),
    type: opts.type || 'heavy',
    speed: opts.speed ?? 22,
    crossings: [],
  };
}

/** Where does this alignment cross a road at grade? Marks the edges and returns the crossings. */
export function findRailCrossings(net, line) {
  const out = [];
  const railPts = [];
  const steps = Math.max(32, Math.ceil(line.curve.length / 2));
  for (let i = 0; i <= steps; i++) railPts.push({ s: (line.curve.length * i) / steps, p: line.curve.pointAt((line.curve.length * i) / steps) });

  for (const edge of net.edges.values()) {
    if (edge.structure !== 'ground') continue;
    const L = edge.curve.length;
    const eSteps = Math.max(16, Math.ceil(L / 2));
    for (let i = 0; i < eSteps; i++) {
      const sa = (L * i) / eSteps, sb = (L * (i + 1)) / eSteps;
      const a = edge.curve.pointAt(sa), b = edge.curve.pointAt(sb);
      for (let j = 0; j < railPts.length - 1; j++) {
        const c = railPts[j].p, d = railPts[j + 1].p;
        const hit = segIntersect(a, b, c, d);
        if (!hit) continue;
        const sEdge = lerp(sa, sb, hit.t);
        const sRail = lerp(railPts[j].s, railPts[j + 1].s, hit.u);
        if (sEdge < edge.mouthSA + 3 || sEdge > edge.mouthSB - 3) continue;
        // skew matters: a track crossing at 40 degrees needs a much longer panel than a
        // square one, and the paved length along each alignment is a different number.
        const rt = normXZ({ x: d.x - c.x, y: 0, z: d.z - c.z });
        const et = normXZ({ x: b.x - a.x, y: 0, z: b.z - a.z });
        const sinSkew = Math.max(0.34, Math.abs(rt.x * et.z - rt.z * et.x));
        const halfRoad = clamp((PANEL_HALF + 0.7) / sinSkew, 2.6, 11);
        const halfRail = clamp((totalWidth(edge.profile) / 2 + 1.1) / sinSkew, 4, 26);
        edge.features.railCrossing = { s0: sEdge - halfRoad, s1: sEdge + halfRoad, sRail };
        out.push({ edgeId: edge.id, sEdge, sRail, p: hit.p, half: halfRoad, halfRail, sinSkew });
      }
    }
  }
  line.crossings = out;
  return out;
}

function segIntersect(a, b, c, d) {
  const r = { x: b.x - a.x, z: b.z - a.z };
  const s = { x: d.x - c.x, z: d.z - c.z };
  const den = r.x * s.z - r.z * s.x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c.x - a.x) * s.z - (c.z - a.z) * s.x) / den;
  const u = ((c.x - a.x) * r.z - (c.z - a.z) * r.x) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { t, u, p: { x: a.x + r.x * t, y: lerp(a.y, b.y, t), z: a.z + r.z * t } };
}

/** Full permanent-way mesh for every alignment. */
export function buildRail(lines, net, settings = {}) {
  const mb = new MeshBuilder('rail');
  const crossingProps = [];

  for (const line of lines) {
    const L = line.curve.length;
    const step = 1.2;
    const n = Math.max(2, Math.ceil(L / step));
    const path = [];
    for (let i = 0; i <= n; i++) {
      const s = (L * i) / n;
      const p = line.curve.pointAt(s);
      path.push({ x: p.x, y: p.y, z: p.z, s });
    }

    const inCrossing = (s) => line.crossings.some((c) => Math.abs(s - c.sRail) < c.half + 1.6);

    // ballast shoulder, broken at level crossings
    let run = [];
    const flushRuns = [];
    for (const p of path) {
      if (inCrossing(p.s)) {
        if (run.length > 1) flushRuns.push(run);
        run = [];
      } else run.push(p);
    }
    if (run.length > 1) flushRuns.push(run);
    mb.attr({ surface: SURF.BALLAST });
    for (const r of flushRuns) {
      sweep(mb, r, [
        { x: -3.3, y: -0.62 }, { x: -2.15, y: -0.05 }, { x: 2.15, y: -0.05 }, { x: 3.3, y: -0.62 },
      ], { surface: SURF.BALLAST });
      // sleepers
      let acc = 1e9;
      for (let i = 0; i < r.length; i++) {
        if (i > 0) acc += Math.hypot(r[i].x - r[i - 1].x, r[i].z - r[i - 1].z);
        if (acc < 0.63) continue;
        acc = 0;
        const p = r[i];
        const prev = r[Math.max(0, i - 1)], next = r[Math.min(r.length - 1, i + 1)];
        const yaw = Math.atan2(next.z - prev.z, next.x - prev.x);
        box(mb, { x: p.x, y: p.y + 0.055, z: p.z }, { x: 0.26, y: 0.16, z: 2.62 },
          { yaw, attrs: { surface: SURF.SLEEPER } });
      }
    }

    // continuous rails over the whole alignment (including crossings)
    const railProfile = (off) => ([
      { x: off - 0.075, y: 0.14 }, { x: off + 0.075, y: 0.14 }, { x: off + 0.075, y: 0.165 },
      { x: off + 0.028, y: 0.20 }, { x: off + 0.033, y: 0.285 }, { x: off + 0.0355, y: 0.30 },
      { x: off - 0.0355, y: 0.30 }, { x: off - 0.033, y: 0.285 }, { x: off - 0.028, y: 0.20 },
      { x: off - 0.075, y: 0.165 },
    ]);
    for (const off of [-RAIL_OFFSET, RAIL_OFFSET]) {
      sweep(mb, path, railProfile(off), { surface: SURF.RAIL_STEEL, closedProfile: true });
    }

    // level crossing panels + flangeways
    for (const c of line.crossings) {
      const edge = net.edges.get(c.edgeId);
      if (!edge) continue;
      const s0 = c.sRail - (c.halfRail ?? c.half) - 0.6, s1 = c.sRail + (c.halfRail ?? c.half) + 0.6;
      const panelPath = [];
      const ps = Math.max(2, Math.ceil((s1 - s0) / 1.0));
      for (let i = 0; i <= ps; i++) {
        const s = clamp(s0 + ((s1 - s0) * i) / ps, 0, L);
        const p = line.curve.pointAt(s);
        panelPath.push({ x: p.x, y: p.y, z: p.z });
      }
      mb.attr({ surface: SURF.ROAD_PLATE });
      // between the rails
      sweep(mb, panelPath, [
        { x: -RAIL_OFFSET + 0.11, y: 0.3 }, { x: RAIL_OFFSET - 0.11, y: 0.3 },
        { x: RAIL_OFFSET - 0.11, y: 0.22 }, { x: -RAIL_OFFSET + 0.11, y: 0.22 },
      ], { surface: SURF.ROAD_PLATE, closedProfile: true });
      // outside each rail
      for (const sgn of [-1, 1]) {
        sweep(mb, panelPath, [
          { x: sgn * (RAIL_OFFSET + 0.11), y: 0.3 }, { x: sgn * (RAIL_OFFSET + 1.5), y: 0.3 },
          { x: sgn * (RAIL_OFFSET + 1.5), y: 0.18 }, { x: sgn * (RAIL_OFFSET + 0.11), y: 0.22 },
        ], { surface: SURF.ROAD_PLATE, closedProfile: true });
      }
      crossingProps.push({ ...c, line });
    }
  }
  return { mesh: mb.vertexCount ? mb.finish() : null, crossings: crossingProps };
}

/** Crossing furniture: half-barriers, warning lights, St Andrew's cross, bells. */
export function buildCrossingFurniture(crossings, net) {
  const mb = new MeshBuilder('crossing-furniture');
  const barriers = [];
  for (const c of crossings) {
    const edge = net.edges.get(c.edgeId);
    if (!edge) continue;
    const f = edge.curve.frameAt(c.sEdge);
    const band = laneBand(edge.profile);
    // the post stands just behind the kerb on the driver's right of each approach
    const kerbOut = GUTTER_WIDTH + KERB.FACE_BATTER + KERB.TOP_WIDTH + 0.5;
    for (const sgn of [-1, 1]) {
      // sgn = -1 is the approach from behind the crossing (travelling +t): keep right.
      const side = -sgn;
      const lat = (side > 0 ? band.tR : band.tL) + side * kerbOut;
      const along = sgn * (c.half + 3.0);
      const base = {
        x: c.p.x + f.t.x * along + f.right.x * lat,
        y: c.p.y + 0.14,
        z: c.p.z + f.t.z * along + f.right.z * lat,
      };
      const faceYaw = Math.atan2(-f.t.z * sgn, -f.t.x * sgn);   // towards the driver
      mb.attr({ surface: SURF.METAL });
      box(mb, { x: base.x, y: base.y + 0.55, z: base.z }, { x: 0.46, y: 1.1, z: 0.46 },
        { yaw: faceYaw, attrs: { surface: SURF.METAL } });
      cylinder(mb, { x: base.x, y: base.y + 1.1, z: base.z }, { x: base.x, y: base.y + 2.95, z: base.z },
        0.07, 0.06, 10, { attrs: { surface: SURF.METAL } });
      // twin red warning lights, looking at the driver
      const rightOfFace = { x: Math.sin(faceYaw), z: -Math.cos(faceYaw) };
      const fwd = { x: Math.cos(faceYaw), z: Math.sin(faceYaw) };
      for (const o of [-0.42, 0.42]) {
        mb.attr({ surface: SURF.SIGNAL_LENS });
        cylinder(mb,
          { x: base.x + rightOfFace.x * o, y: base.y + 2.25, z: base.z + rightOfFace.z * o },
          { x: base.x + rightOfFace.x * o + fwd.x * 0.08, y: base.y + 2.25, z: base.z + rightOfFace.z * o + fwd.z * 0.08 },
          0.13, 0.12, 10, { attrs: { surface: SURF.SIGNAL_LENS, laneA: 63, laneB: 0 } });
      }
      // St Andrew's cross: two arms at 45 degrees, not two copies of one bar
      const saltire = { x: base.x, y: base.y + 3.05, z: base.z };
      for (const rot of [Math.PI / 4, -Math.PI / 4]) {
        const ca = Math.cos(rot), sa = Math.sin(rot);
        const L = 0.62, W = 0.11;
        const pts = [[-L, -W], [L, -W], [L, W], [-L, W]].map(([x, y]) => ({ x: x * ca - y * sa, y: x * sa + y * ca }));
        platePoly(mb, saltire, faceYaw, pts, SURF.SIGN_INFO, 7, 0.03);
      }
      barriers.push({
        pivot: { x: base.x, y: base.y + 1.15, z: base.z },
        // the boom sweeps from the post back across its own half of the carriageway
        axis: Math.atan2(-f.right.z * side, -f.right.x * side),
        length: clamp(Math.abs(lat) + 0.6, 3.2, 9.0),
        side: sgn,
      });
    }
  }
  return { mesh: mb.vertexCount ? mb.finish() : null, barriers };
}

/** Barrier booms are drawn as instanced parts so they can animate. */
export function buildBoomMesh() {
  const mb = new MeshBuilder('boom');
  mb.attr({ surface: SURF.BARRIER });
  box(mb, { x: 2.4, y: 0, z: 0 }, { x: 4.8, y: 0.12, z: 0.1 }, { attrs: { surface: SURF.BARRIER } });
  for (let i = 0; i < 4; i++) {
    box(mb, { x: 0.6 + i * 1.2, y: -0.2, z: 0 }, { x: 0.08, y: 0.3, z: 0.08 }, { attrs: { surface: SURF.METAL } });
  }
  return mb.finish();
}

/** One EMU carriage: lofted shell, window band, doors, bogies. */
export function buildTrainMesh(opts = {}) {
  const mb = new MeshBuilder('train');
  const len = opts.length ?? 19.5;
  const w = 1.42, h = 2.0;
  const floor = 1.22;
  const sections = [];
  const profileAt = (f) => {
    // f: 0..1 along the carriage, tapering the nose at both ends
    const taper = Math.min(1, Math.min(f, 1 - f) * 16);
    const ww = w * (0.55 + 0.45 * taper);
    const hh = h * (0.7 + 0.3 * taper);
    const ring = [];
    const n = 18;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const ca = Math.cos(a), sa = Math.sin(a);
      const px = Math.sign(ca) * Math.pow(Math.abs(ca), 0.55) * ww;
      const py = Math.sign(sa) * Math.pow(Math.abs(sa), 0.62) * hh;
      ring.push({ x: (f - 0.5) * len, y: floor + h * 0.55 + py, z: px, surface: SURF.TRAIN_BODY });
    }
    return ring;
  };
  const steps = 22;
  for (let i = 0; i <= steps; i++) sections.push(profileAt(i / steps));
  loft(mb, sections, { closed: true, surface: SURF.TRAIN_BODY });

  // window band + doors
  mb.attr({ surface: SURF.CAR_GLASS });
  for (const sgn of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      const x = -len / 2 + 2.4 + i * ((len - 4.8) / 5);
      box(mb, { x, y: floor + 1.45, z: sgn * (w * 0.97) }, { x: 1.5, y: 0.78, z: 0.05 },
        { attrs: { surface: SURF.CAR_GLASS } });
    }
    box(mb, { x: -len / 2 + 0.55, y: floor + 1.5, z: sgn * (w * 0.8) }, { x: 0.5, y: 0.9, z: 0.06 },
      { attrs: { surface: SURF.CAR_GLASS } });
  }
  mb.attr({ surface: SURF.METAL });
  for (const bx of [-len * 0.32, len * 0.32]) {
    box(mb, { x: bx, y: 0.62, z: 0 }, { x: 2.9, y: 0.5, z: 2.3 }, { attrs: { surface: SURF.METAL } });
    for (const sgn of [-1, 1]) {
      for (const wx of [-1.05, 1.05]) {
        cylinder(mb,
          { x: bx + wx, y: 0.46, z: sgn * 0.72 },
          { x: bx + wx, y: 0.46, z: sgn * 0.78 },
          0.46, 0.46, 16, { attrs: { surface: SURF.RAIL_STEEL } });
      }
    }
  }
  mb.attr({ surface: SURF.LIGHT_WHITE });
  for (const sgn of [-1, 1]) {
    for (const zz of [-0.8, 0.8]) {
      box(mb, { x: sgn * (len / 2 - 0.12), y: floor + 0.55, z: zz }, { x: 0.08, y: 0.22, z: 0.3 },
        { attrs: { surface: SURF.LIGHT_WHITE } });
    }
  }
  return mb.finish();
}
