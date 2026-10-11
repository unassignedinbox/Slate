// Shared cross-section sampling. The ribbon builder AND the junction builder both call
// worldSection() with the same arc-length, so the mouth rows are bit-identical and weld into a
// single mesh — that is what keeps intersections crack-free and overlap-free.

import { crossSection, ROAD_CLASS, FLAG, markingCode, laneBand } from './profile.js';
import { clamp, smoothstep } from '../core/math.js';
import { SURF, MARK } from '../core/mesh.js';

/** Pedestrian ramp profile: 0 away from the junction, 1 at the crossing, ~0.45 at the mouth. */
export function kerbDropAt(d) {
  if (d > 7.5) return 0;
  if (d > 4.6) return smoothstep((7.5 - d) / 2.9) * 0.9;
  if (d > 2.0) return 0.9 + 0.1 * smoothstep((4.6 - d) / 2.6);
  return 0.45 + 0.55 * smoothstep(d / 2.0);
}

/** Per-station section options (ramps, widening, bridge/tunnel furniture, damage cuts). */
export function sectionOptsAt(edge, s) {
  const L = edge.curve.length;
  const opts = {
    bridge: edge.structure === 'bridge',
    tunnel: edge.structure === 'tunnel',
    extraCuts: edge._extraCuts || [],
  };
  const dA = s - edge.trimA;
  const dB = (L - edge.trimB) - s;
  const d = Math.min(dA, dB);
  const wantRamp = !opts.bridge && edge.profile.footwayL > 0.05 && edge._crossingEnds !== 0;
  if (wantRamp) {
    const atA = dA <= dB;
    const allowed = atA ? (edge._crossingEnds & 1) : (edge._crossingEnds & 2);
    if (allowed) {
      const drop = kerbDropAt(Math.max(0, d));
      opts.kerbDropL = drop;
      opts.kerbDropR = drop;
    }
  }
  if (edge._widen) {
    for (const w of edge._widen) {
      if (s >= w.s0 && s <= w.s1) {
        const f = Math.min(smoothstep(clamp((s - w.s0) / Math.max(w.fade, 0.01), 0, 1)),
                           smoothstep(clamp((w.s1 - s) / Math.max(w.fade, 0.01), 0, 1)));
        if (w.side < 0) opts.widenL = Math.max(opts.widenL || 0, w.width * f);
        else opts.widenR = Math.max(opts.widenR || 0, w.width * f);
      }
    }
  }
  return opts;
}

/** Superelevation (bank) on fast curves — limited, signed by curve direction. */
export function rollAt(edge, s) {
  const p = edge.profile;
  if (p.class !== ROAD_CLASS.HIGHWAY && p.class !== ROAD_CLASS.RAMP && p.class !== ROAD_CLASS.ARTERIAL) return 0;
  const k = edge.curve.curvatureAt(s, 3);
  const v = (p.speedLimit || 50) / 3.6;
  const need = clamp((v * v * k) / 9.81, -0.07, 0.07); // e+f balance, capped at 7 %
  return Math.atan(need);
}

/**
 * World-space cross-section at arc-length s.
 * @returns {{frame, sec, pts:[{p,t,y,surface,group}], opts, roll}}
 */
export function worldSection(edge, s, extra = null) {
  const opts = extra ? { ...sectionOptsAt(edge, s), ...extra } : sectionOptsAt(edge, s);
  const sec = crossSection(edge.profile, opts);
  const f = edge.curve.frameAt(s);
  const roll = rollAt(edge, s);
  const cr = Math.cos(roll), sr = Math.sin(roll);
  const pts = sec.pts.map((q) => {
    const lat = q.t * cr - q.y * sr * 0;      // lateral stays metric
    const vert = q.y * cr + q.t * sr;         // bank tilts the section
    return {
      p: { x: f.p.x + f.right.x * lat, y: f.p.y + vert, z: f.p.z + f.right.z * lat },
      t: q.t, y: vert, surface: q.surface, group: q.group,
    };
  });
  return { frame: f, sec, pts, opts, roll };
}

/** Index ranges of a section row: left outer ring, carriageway span, right outer ring. */
export function sectionRanges(row) {
  const n = row.pts.length;
  return { leftOuter: [0, 5], carriage: [6, n - 7], rightOuter: [n - 6, n - 1], n };
}

/**
 * Ring of a branch at a junction, ordered carriageway-edge → outermost (7 entries).
 * side: 'left' | 'right' as seen standing at the node looking outward along the branch.
 */
export function branchRing(row, side, flip) {
  const n = row.pts.length;
  const useLow = (side === 'left') !== flip; // low-t end of the section
  if (useLow) {
    // carriageway edge is index 6, outer ring is 5..0 (inboard → outboard)
    return [row.pts[6], row.pts[5], row.pts[4], row.pts[3], row.pts[2], row.pts[1], row.pts[0]];
  }
  return [row.pts[n - 7], row.pts[n - 6], row.pts[n - 5], row.pts[n - 4], row.pts[n - 3], row.pts[n - 2], row.pts[n - 1]];
}

/** Carriageway slice of a row, ordered from the junction's right side to its left side. */
export function carriagewaySlice(row, flip) {
  const n = row.pts.length;
  const mid = row.pts.slice(6, n - 6);
  return flip ? mid.slice() : mid.slice().reverse();
}

export function vertexAttrsFor(edge, q, s, extraFlags = 0, wear = null, param = 0) {
  const band = laneBand(edge.profile);
  let flags = extraFlags;
  const p = edge.profile;
  if (p.parkingL) flags |= FLAG.PARKING_L;
  if (p.parkingR) flags |= FLAG.PARKING_R;
  if (p.lanesB === 0 || p.lanesF === 0) flags |= FLAG.ONEWAY;
  if (p.lanesB > 0 && p.lanesF > 0 && p.median <= 0) flags |= FLAG.CENTRE_DOUBLE;
  if (p.class === ROAD_CLASS.HIGHWAY || p.class === ROAD_CLASS.RAMP) flags |= FLAG.HIGHWAY;
  if (edge.structure === 'bridge') flags |= FLAG.BRIDGE;
  if (edge.structure === 'tunnel') flags |= FLAG.TUNNEL;
  return {
    u: s, v: q.t,
    surface: q.surface,
    wear: wear ?? edge.wear,
    flags,
    mark: markingCode(p),
    laneWidth: p.laneWidth,
    laneA: band.laneStart,
    laneB: band.laneEnd,
    param,
  };
}

export const SECTION_SURFACES = SURF;
export const SECTION_MARKS = MARK;
