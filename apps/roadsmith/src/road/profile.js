// Road cross-sections — the single source of truth for lateral geometry.
//
// Everything lateral comes from here: lane slots, parking bays, channel/gutter, kerb face and top,
// footway cross-fall, verge, shoulders, Jersey barriers and bridge parapets. Section point counts
// outside the carriageway are FIXED (OUTER_RING_COUNT) so any two roads meeting at a junction can
// be stitched corner-to-corner with pure quads, whatever their class.

import { SURF, MARK } from '../core/mesh.js';
import { clamp } from '../core/math.js';

export const ROAD_CLASS = {
  SERVICE: 'service',
  LOCAL: 'local',
  COLLECTOR: 'collector',
  ARTERIAL: 'arterial',
  HIGHWAY: 'highway',
  RAMP: 'ramp',
};

export const CLASS_ORDER = [
  ROAD_CLASS.SERVICE, ROAD_CLASS.LOCAL, ROAD_CLASS.COLLECTOR,
  ROAD_CLASS.ARTERIAL, ROAD_CLASS.HIGHWAY, ROAD_CLASS.RAMP,
];

export const FLAG = {
  PARKING_L: 1 << 0,
  PARKING_R: 1 << 1,
  ONEWAY: 1 << 2,
  CENTRE_DOUBLE: 1 << 3,
  HIGHWAY: 1 << 4,
  BRIDGE: 1 << 5,
  JUNCTION: 1 << 6,
  CROSSWALK: 1 << 7,
  STOPBAR: 1 << 8,
  CONSTRUCTION: 1 << 9,
  TUNNEL: 1 << 10,
  RAIL_CROSSING: 1 << 11,
  BUS_LANE: 1 << 12,
  CYCLE_LANE: 1 << 13,
};

export const KERB = { FACE_BATTER: 0.025, TOP_WIDTH: 0.16, HEIGHT: 0.145 };
export const GUTTER_WIDTH = 0.38;
export const OUTER_RING_COUNT = 6; // points emitted outboard of each carriageway edge

export function defaultProfile(cls = ROAD_CLASS.LOCAL, over = {}) {
  const base = {
    class: cls,
    lanesF: 1, lanesB: 1,
    laneWidth: 3.5,
    median: 0,
    parkingL: false, parkingR: false, parkingWidth: 2.3,
    footwayL: 2.2, footwayR: 2.2,
    vergeL: 0.9, vergeR: 0.9,
    shoulderL: 0, shoulderR: 0,
    camber: 0.022,
    kerbHeight: KERB.HEIGHT,
    barrier: 'none',           // none | jersey | wbeam | parapet | railing
    pavingL: 'slab', pavingR: 'slab',
    speedLimit: 50,
  };
  switch (cls) {
    case ROAD_CLASS.SERVICE:
      Object.assign(base, { laneWidth: 3.0, footwayL: 1.6, footwayR: 1.6, vergeL: 0.4, vergeR: 0.4, speedLimit: 20, lanesF: 1, lanesB: 1 });
      break;
    case ROAD_CLASS.LOCAL:
      Object.assign(base, { parkingL: true, parkingR: true, speedLimit: 30 });
      break;
    case ROAD_CLASS.COLLECTOR:
      Object.assign(base, { lanesF: 1, lanesB: 1, laneWidth: 3.5, parkingR: true, footwayL: 2.6, footwayR: 2.6, speedLimit: 50 });
      break;
    case ROAD_CLASS.ARTERIAL:
      Object.assign(base, {
        lanesF: 2, lanesB: 2, laneWidth: 3.5, median: 2.4,
        footwayL: 3.2, footwayR: 3.2, vergeL: 1.4, vergeR: 1.4, speedLimit: 60,
      });
      break;
    case ROAD_CLASS.HIGHWAY:
      Object.assign(base, {
        lanesF: 3, lanesB: 3, laneWidth: 3.65, median: 3.0,
        footwayL: 0, footwayR: 0, vergeL: 2.5, vergeR: 2.5,
        shoulderL: 3.0, shoulderR: 3.0, camber: 0.02,
        barrier: 'wbeam', speedLimit: 110,
      });
      break;
    case ROAD_CLASS.RAMP:
      Object.assign(base, {
        lanesF: 1, lanesB: 0, laneWidth: 3.7, footwayL: 0, footwayR: 0,
        shoulderL: 1.5, shoulderR: 2.5, vergeL: 1.4, vergeR: 1.4,
        barrier: 'wbeam', speedLimit: 60,
      });
      break;
    default: break;
  }
  return Object.assign(base, over);
}

/** Ordered carriageway slots, left (negative t) to right. */
export function slotsOf(p) {
  const slots = [];
  if (p.shoulderL > 0) slots.push({ type: 'shoulder', width: p.shoulderL, dir: 0 });
  if (p.parkingL) slots.push({ type: 'parking', width: p.parkingWidth, dir: 0, side: -1 });
  for (let i = 0; i < p.lanesB; i++) slots.push({ type: 'lane', width: p.laneWidth, dir: -1, index: i });
  if (p.median > 0) slots.push({ type: 'median', width: p.median, dir: 0 });
  for (let i = 0; i < p.lanesF; i++) slots.push({ type: 'lane', width: p.laneWidth, dir: 1, index: i });
  if (p.parkingR) slots.push({ type: 'parking', width: p.parkingWidth, dir: 0, side: 1 });
  if (p.shoulderR > 0) slots.push({ type: 'shoulder', width: p.shoulderR, dir: 0 });
  return slots;
}

export function carriagewayWidth(p) {
  return slotsOf(p).reduce((a, s) => a + s.width, 0);
}

export function totalWidth(p) {
  const outL = p.footwayL + p.vergeL + GUTTER_WIDTH + KERB.TOP_WIDTH;
  const outR = p.footwayR + p.vergeR + GUTTER_WIDTH + KERB.TOP_WIDTH;
  return carriagewayWidth(p) + outL + outR;
}

/** Lane centrelines in profile space (t is lateral metres; +t is the driver's right of the curve). */
export function lanesOf(p) {
  const slots = slotsOf(p);
  const cw = slots.reduce((a, s) => a + s.width, 0);
  let t = -cw / 2;
  const lanes = [];
  for (const s of slots) {
    const centre = t + s.width / 2;
    if (s.type === 'lane') lanes.push({ centreT: centre, width: s.width, dir: s.dir, index: s.index, type: 'travel' });
    else if (s.type === 'parking') lanes.push({ centreT: centre, width: s.width, dir: 0, type: 'parking', side: s.side });
    else if (s.type === 'shoulder') lanes.push({ centreT: centre, width: s.width, dir: 0, type: 'shoulder' });
    t += s.width;
  }
  return lanes;
}

/** Carriageway extent and lane band used by the marking shader. */
export function laneBand(p) {
  const slots = slotsOf(p);
  const cw = slots.reduce((a, s) => a + s.width, 0);
  let t = -cw / 2;
  let laneStart = null, laneEnd = null;
  for (const s of slots) {
    if (s.type === 'lane') {
      if (laneStart === null) laneStart = t;
      laneEnd = t + s.width;
    }
    t += s.width;
  }
  return { tL: -cw / 2, tR: cw / 2, laneStart: laneStart ?? -cw / 2, laneEnd: laneEnd ?? cw / 2, width: cw };
}

export function profileFlags(p, extra = 0) {
  let f = extra;
  if (p.parkingL) f |= FLAG.PARKING_L;
  if (p.parkingR) f |= FLAG.PARKING_R;
  if (p.lanesB === 0 || p.lanesF === 0) f |= FLAG.ONEWAY;
  if (p.lanesB > 0 && p.lanesF > 0 && p.median <= 0) f |= FLAG.CENTRE_DOUBLE;
  if (p.class === ROAD_CLASS.HIGHWAY || p.class === ROAD_CLASS.RAMP) f |= FLAG.HIGHWAY;
  return f;
}

const pt = (t, y, surface, o = {}) => ({ t, y, surface, group: o.group ?? 'outer', ...o });

/**
 * Full cross-section point list, left (-t) to right (+t).
 * @param {object} p profile
 * @param {object} o {bridge, tunnel, kerbDropL, kerbDropR, widenL, widenR, barrierL, barrierR, groundDrop}
 */
export function crossSection(p, o = {}) {
  const band = laneBand(p);
  const camber = p.camber;
  const widenL = o.widenL || 0, widenR = o.widenR || 0;
  const tL = band.tL - widenL, tR = band.tR + widenR;
  const surfaceY = (t) => -camber * Math.abs(t) + (o.crownLift || 0);
  const pts = [];

  // ---- left outboard ring (emitted inboard-to-outboard then reversed)
  pts.push(...outerRing(p, tL, -1, surfaceY(tL), o).reverse());
  // ---- carriageway: a point at every slot boundary, plus the crown
  const slots = slotsOf(p);
  let t = band.tL;
  const cwTs = [t];
  for (const s of slots) { t += s.width; cwTs.push(t); }
  if (!cwTs.some((v) => Math.abs(v) < 1e-6)) cwTs.push(0);
  // subdivide wide slots so camber and damage displacement stay smooth
  const dense = [];
  cwTs.sort((a, b) => a - b);
  for (let i = 0; i < cwTs.length; i++) {
    dense.push(cwTs[i]);
    if (i < cwTs.length - 1) {
      const w = cwTs[i + 1] - cwTs[i];
      const n = Math.max(1, Math.round(w / 1.8));
      for (let k = 1; k < n; k++) dense.push(cwTs[i] + (w * k) / n);
    }
  }
  const extra = o.extraCuts || [];
  for (const c of extra) if (c > band.tL + 0.05 && c < band.tR - 0.05) dense.push(c);
  dense.sort((a, b) => a - b);

  let medianLo = null, medianHi = null;
  {
    let tt = band.tL;
    for (const s of slots) {
      if (s.type === 'median') { medianLo = tt; medianHi = tt + s.width; }
      tt += s.width;
    }
  }

  for (const tt of dense) {
    if (medianLo !== null && tt > medianLo + 1e-4 && tt < medianHi - 1e-4) continue; // median handled below
    const inShoulder = tt < band.laneStart - 1e-4 && p.shoulderL > 0 && tt < band.tL + p.shoulderL + 1e-4;
    const inShoulderR = tt > band.laneEnd + 1e-4 && p.shoulderR > 0 && tt > band.tR - p.shoulderR - 1e-4;
    pts.push(pt(tt + (tt < 0 ? -widenL : widenR) * 0, surfaceY(tt),
      inShoulder || inShoulderR ? SURF.SHOULDER : SURF.ASPHALT, { group: 'carriage' }));
  }

  // ---- raised median (kerbed central reservation, planted strip)
  if (medianLo !== null) {
    const mY = surfaceY(medianLo);
    const list = [
      pt(medianLo + 0.02, mY + p.kerbHeight, SURF.KERB_FACE, { group: 'median' }),
      pt(medianLo + 0.02 + KERB.TOP_WIDTH, mY + p.kerbHeight + 0.005, SURF.KERB_TOP, { group: 'median' }),
      pt((medianLo + medianHi) / 2, mY + p.kerbHeight - 0.03, SURF.MEDIAN, { group: 'median' }),
      pt(medianHi - 0.02 - KERB.TOP_WIDTH, mY + p.kerbHeight + 0.005, SURF.KERB_TOP, { group: 'median' }),
      pt(medianHi - 0.02, mY + p.kerbHeight, SURF.KERB_FACE, { group: 'median' }),
    ];
    const insertAt = pts.findIndex((q) => q.t > medianLo);
    pts.splice(insertAt < 0 ? pts.length : insertAt, 0, ...list);
  }

  // ---- right outboard ring
  pts.push(...outerRing(p, tR, 1, surfaceY(tR), o));

  pts.sort((a, b) => a.t - b.t);
  // de-duplicate coincident t on the same surface (keeps strips clean)
  const outPts = [];
  for (const q of pts) {
    const prev = outPts[outPts.length - 1];
    if (prev && Math.abs(prev.t - q.t) < 1e-5 && prev.surface === q.surface && Math.abs(prev.y - q.y) < 1e-5) continue;
    outPts.push(q);
  }
  return {
    pts: outPts,
    tL: band.tL, tR: band.tR,
    laneStart: band.laneStart, laneEnd: band.laneEnd,
    laneWidth: p.laneWidth,
    carriageway: band.width,
    edgeYL: surfaceY(tL), edgeYR: surfaceY(tR),
    halfOuterL: Math.abs(outPts[0].t), halfOuterR: outPts[outPts.length - 1].t,
  };
}

/**
 * The six fixed points outboard of a carriageway edge, inboard → outboard.
 * side = -1 (left) or +1 (right). Returned with ascending |t|.
 */
function outerRing(p, edgeT, side, edgeY, o = {}) {
  const sgn = side;
  const footway = side < 0 ? p.footwayL : p.footwayR;
  const verge = side < 0 ? p.vergeL : p.vergeR;
  const drop = clamp(side < 0 ? (o.kerbDropL ?? 0) : (o.kerbDropR ?? 0), 0, 1); // 1 = flush crossing ramp
  const barrier = o.bridge ? 'parapet' : (side < 0 ? (o.barrierL ?? p.barrier) : (o.barrierR ?? p.barrier));
  const kerbH = p.kerbHeight * (1 - drop) + 0.015 * drop;
  const ring = [];
  let t = edgeT;

  if (footway > 0.05) {
    // urban: channel → kerb face → kerb top → footway (two spans) → verge
    const gY = edgeY - 0.022;
    t += sgn * GUTTER_WIDTH;
    ring.push(pt(t, gY, SURF.GUTTER, { group: 'channel' }));
    t += sgn * KERB.FACE_BATTER;
    ring.push(pt(t, gY + kerbH, SURF.KERB_FACE, { group: 'kerb' }));
    t += sgn * KERB.TOP_WIDTH;
    ring.push(pt(t, gY + kerbH + 0.006, SURF.KERB_TOP, { group: 'kerb' }));
    const walkY0 = gY + kerbH + 0.006;
    t += sgn * footway * 0.5;
    ring.push(pt(t, walkY0 + footway * 0.5 * 0.02, drop > 0.5 ? SURF.TACTILE : SURF.FOOTWAY, { group: 'walk' }));
    t += sgn * footway * 0.5;
    ring.push(pt(t, walkY0 + footway * 0.02, SURF.FOOTWAY, { group: 'walk' }));
    t += sgn * Math.max(verge, 0.25);
    ring.push(pt(t, walkY0 + footway * 0.02 - 0.045, verge > 0.3 ? SURF.GRASS : SURF.FOOTWAY, { group: 'verge' }));
  } else if (barrier === 'parapet') {
    // bridge deck: safety kerb → parapet upstand → coping → outer face → deck edge
    const sY = edgeY;
    t += sgn * 0.45;
    ring.push(pt(t, sY + 0.02, SURF.CONCRETE, { group: 'channel' }));
    t += sgn * 0.08;
    ring.push(pt(t, sY + 0.30, SURF.CONCRETE, { group: 'kerb' }));
    t += sgn * 0.10;
    ring.push(pt(t, sY + 0.95, SURF.CONCRETE, { group: 'kerb' }));
    t += sgn * 0.22;
    ring.push(pt(t, sY + 1.02, SURF.CONCRETE, { group: 'walk' }));
    t += sgn * 0.06;
    ring.push(pt(t, sY + 0.85, SURF.CONCRETE, { group: 'walk' }));
    ring.push(pt(t + sgn * 0.02, sY - 0.25, SURF.CONCRETE, { group: 'verge' }));
  } else if (barrier === 'jersey') {
    const sY = edgeY;
    t += sgn * 0.30;
    ring.push(pt(t, sY, SURF.CONCRETE, { group: 'channel' }));
    t += sgn * 0.14;
    ring.push(pt(t, sY + 0.26, SURF.CONCRETE, { group: 'kerb' }));
    t += sgn * 0.16;
    ring.push(pt(t, sY + 0.81, SURF.CONCRETE, { group: 'kerb' }));
    t += sgn * 0.12;
    ring.push(pt(t, sY + 0.86, SURF.CONCRETE, { group: 'walk' }));
    t += sgn * 0.14;
    ring.push(pt(t, sY + 0.60, SURF.CONCRETE, { group: 'walk' }));
    t += sgn * Math.max(verge, 0.4);
    ring.push(pt(t, sY - 0.12, SURF.GRASS, { group: 'verge' }));
  } else {
    // rural / motorway shoulder: hard strip → edge drop → drainage swale → verge
    const sY = edgeY;
    t += sgn * 0.55;
    ring.push(pt(t, sY - 0.012, SURF.SHOULDER, { group: 'channel' }));
    t += sgn * 0.35;
    ring.push(pt(t, sY - 0.09, SURF.DIRT, { group: 'kerb' }));
    t += sgn * Math.max(verge * 0.45, 0.5);
    ring.push(pt(t, sY - 0.40, SURF.GRASS, { group: 'kerb' }));
    t += sgn * Math.max(verge * 0.35, 0.4);
    ring.push(pt(t, sY - 0.52, SURF.GRASS, { group: 'walk' }));
    t += sgn * Math.max(verge * 0.4, 0.5);
    ring.push(pt(t, sY - 0.30, SURF.GRASS, { group: 'walk' }));
    t += sgn * Math.max(verge * 0.5, 0.6);
    ring.push(pt(t, sY - 0.18, SURF.GRASS, { group: 'verge' }));
  }
  while (ring.length > OUTER_RING_COUNT) ring.pop();
  while (ring.length < OUTER_RING_COUNT) {
    const last = ring[ring.length - 1];
    ring.push(pt(last.t + sgn * 0.3, last.y, last.surface, { group: 'verge' }));
  }
  return ring;
}

/** Marking code for a road's painted scheme (interpreted by the surface shader). */
export function markingCode(p) {
  if (p.class === ROAD_CLASS.HIGHWAY) return MARK.EDGE_SOLID;
  if (p.class === ROAD_CLASS.RAMP) return MARK.EDGE_SOLID;
  if (p.median > 0) return MARK.LANE_DASH;
  if (p.lanesF > 0 && p.lanesB > 0) return MARK.CENTRE_DOUBLE;
  return MARK.LANE_DASH;
}
