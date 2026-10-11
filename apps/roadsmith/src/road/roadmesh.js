// Carriageway ribbon builder: adaptive stationing + true displaced geometry for speed humps,
// raised tables, potholes, sunken trench repairs and construction excavations.
// Longitudinal strips are pure quads — one quad per (station span x section span).

import { worldSection, vertexAttrsFor, sectionOptsAt } from './section.js';
import { FLAG, ROAD_CLASS, laneBand } from './profile.js';
import { SURF } from '../core/mesh.js';
import { clamp, lerp, smoothstep } from '../core/math.js';
import { fbm2D } from '../core/rng.js';

const BASE_STEP = {
  [ROAD_CLASS.SERVICE]: 2.0,
  [ROAD_CLASS.LOCAL]: 2.2,
  [ROAD_CLASS.COLLECTOR]: 2.6,
  [ROAD_CLASS.ARTERIAL]: 3.0,
  [ROAD_CLASS.HIGHWAY]: 4.0,
  [ROAD_CLASS.RAMP]: 2.6,
};

/** Vertical displacement of the carriageway at (s, t) — shared by the mesh and the vehicle sim. */
export function surfaceDisplacement(edge, s, t) {
  const f = edge.features;
  let dy = 0;
  for (const b of f.speedBumps) {
    const d = s - b.s;
    const half = b.length * 0.5;
    if (Math.abs(d) >= half) continue;
    if (b.type === 'cushion' && Math.abs(t - (b.t ?? 0)) > (b.width ?? 1.6) * 0.5) continue;
    if (b.type === 'table') {
      const ramp = Math.min(1.1, half * 0.5);
      dy += b.height * clamp((half - Math.abs(d)) / ramp, 0, 1);
    } else {
      const c = Math.cos((Math.PI * d) / b.length);
      dy += b.height * c * c;
    }
  }
  for (const h of f.potholes) {
    const dd = Math.hypot(s - h.s, (t - h.t) * 1.15);
    const rim = h.r * 1.22;
    if (dd > rim) continue;
    if (dd < h.r) {
      const x = dd / h.r;
      const lobe = 1 - x * x;
      dy -= h.depth * Math.pow(lobe, 0.65) * (0.82 + 0.18 * Math.sin(Math.atan2(t - h.t, s - h.s) * 3 + h.s));
    } else {
      dy += h.depth * 0.18 * (1 - (dd - h.r) / (rim - h.r));
    }
  }
  for (const p of f.patches) {
    const ds = Math.abs(s - p.s) - p.length * 0.5;
    const dt = Math.abs(t - p.t) - p.width * 0.5;
    if (ds > 0.25 || dt > 0.25) continue;
    const fade = clamp(1 - Math.max(ds, dt) / 0.25, 0, 1);
    dy += (p.kind === 'overband' ? 0.012 : -0.016) * fade;
  }
  for (const c of f.construction) {
    if (c.kind !== 'trench') continue;
    const inS = s > c.s0 - 0.5 && s < c.s1 + 0.5;
    if (!inS) continue;
    const insideT = t > c.t0 - 0.35 && t < c.t1 + 0.35;
    if (!insideT) continue;
    const fs = Math.min(clamp((s - c.s0) / 0.45, 0, 1), clamp((c.s1 - s) / 0.45, 0, 1));
    const ft = Math.min(clamp((t - c.t0) / 0.3, 0, 1), clamp((c.t1 - t) / 0.3, 0, 1));
    dy -= c.depth * Math.min(fs, ft);
  }
  return dy;
}

/** Arc-length stations: curvature-adaptive, refined around every surface feature and both mouths. */
export function stationsFor(edge) {
  const L = edge.curve.length;
  const s0 = edge.mouthSA ?? edge.trimA;
  const s1 = edge.mouthSB ?? (L - edge.trimB);
  const base = BASE_STEP[edge.profile.class] ?? 2.2;
  const hard = new Set([s0, s1]);
  const f = edge.features;
  for (const b of f.speedBumps) {
    const half = b.length * 0.5;
    for (let d = -half; d <= half + 1e-6; d += b.length / 10) hard.add(clamp(b.s + d, s0, s1));
  }
  for (const h of f.potholes) {
    for (let d = -h.r * 1.3; d <= h.r * 1.3; d += h.r * 0.32) hard.add(clamp(h.s + d, s0, s1));
  }
  for (const c of f.construction) {
    if (c.kind !== 'trench') continue;
    for (const v of [-0.5, -0.34, -0.22, -0.11, 0, 0.11, 0.22, 0.34, 0.5]) {
      hard.add(clamp(c.s0 + v, s0, s1));
      hard.add(clamp(c.s1 + v, s0, s1));
    }
    for (let s = c.s0; s < c.s1; s += 1.2) hard.add(clamp(s, s0, s1));
  }
  if (f.railCrossing) {
    const rc = f.railCrossing;
    for (let s = rc.s0 - 1.5; s <= rc.s1 + 1.5; s += 0.6) hard.add(clamp(s, s0, s1));
  }

  const out = [];
  let s = s0;
  let guard = 0;
  while (s < s1 - 1e-4 && guard++ < 20000) {
    out.push(s);
    const k = Math.abs(edge.curve.curvatureAt(s, 2));
    let step = base;
    if (k > 1e-4) step = Math.min(step, Math.max(0.6, Math.sqrt((8 * 0.004) / k)));
    const dMouth = Math.min(s - s0, s1 - s);
    if (dMouth < 9) step = Math.min(step, 1.1);
    // snap to the next hard station if it is close
    let next = s + step;
    let nearest = Infinity;
    for (const h of hard) if (h > s + 1e-3 && h < next + step * 0.6) nearest = Math.min(nearest, h);
    if (nearest < Infinity) next = nearest;
    s = next;
  }
  out.push(s1);
  const dedup = [];
  for (const v of out) if (!dedup.length || v - dedup[dedup.length - 1] > 1e-3) dedup.push(v);
  return dedup;
}

/** Crosswalk/stop-line availability per end, driven by the node's control + crosswalk policy. */
export function prepareEdge(net, edge) {
  const a = net.nodes.get(edge.a), b = net.nodes.get(edge.b);
  const allow = (n) => {
    if (!n) return false;
    if (n.crosswalks === 'none') return false;
    if (n.crosswalks === 'all') return true;
    return n.edges.length >= 3 && edge.profile.footwayL > 0.05 && edge.structure === 'ground';
  };
  edge._crossingEnds = (allow(a) ? 1 : 0) | (allow(b) ? 2 : 0);
  const cuts = new Set();
  for (const h of edge.features.potholes) {
    for (let i = -3; i <= 3; i++) cuts.add(h.t + (h.r * i) / 3);
  }
  for (const c of edge.features.construction) {
    if (c.kind !== 'trench') continue;
    for (const v of [-0.34, -0.22, -0.11, 0, 0.11, 0.22, 0.34]) { cuts.add(c.t0 + v); cuts.add(c.t1 + v); }
    for (let t = c.t0; t < c.t1; t += 0.8) cuts.add(t);
  }
  edge._extraCuts = [...cuts].sort((x, y) => x - y);
  return edge;
}

/**
 * Build the ribbon between the two junction mouths.
 * @returns {{stations:[{s,frame,row,indices}], length:number}}
 */
export function buildRoadRibbon(mb, net, edge, ctx = {}) {
  const stations = stationsFor(edge);
  const L = edge.curve.length;
  const s0 = edge.mouthSA, s1 = edge.mouthSB;
  const band = laneBand(edge.profile);
  const damageSeed = ctx.seed ?? 7;
  const rows = [];
  let prevIdx = null, prevRow = null;

  for (let i = 0; i < stations.length; i++) {
    const s = stations[i];
    const row = worldSection(edge, s);
    const dA = s - s0, dB = s1 - s;
    const dMouth = Math.min(dA, dB);
    const nearA = dA <= dB;
    const hasCross = nearA ? (edge._crossingEnds & 1) : (edge._crossingEnds & 2);
    let flags = 0;
    if (hasCross && dMouth < 7.5) flags |= FLAG.CROSSWALK;
    if (dMouth < 9) flags |= FLAG.STOPBAR;
    for (const c of edge.features.construction) if (s > c.s0 - 3 && s < c.s1 + 3) flags |= FLAG.CONSTRUCTION;
    const rc = edge.features.railCrossing;
    if (rc && s > rc.s0 - 2 && s < rc.s1 + 2) flags |= FLAG.RAIL_CROSSING;

    const idx = new Array(row.pts.length);
    for (let j = 0; j < row.pts.length; j++) {
      const q = row.pts[j];
      let p = q.p;
      let wear = edge.wear;
      let ao = 1;
      if (q.group === 'carriage') {
        const dy = surfaceDisplacement(edge, s, q.t);
        if (dy !== 0) p = { x: p.x, y: p.y + dy, z: p.z };
        // polished wheel paths + grime towards the channel
        const lanePhase = Math.abs(((q.t - band.laneStart) % edge.profile.laneWidth) / edge.profile.laneWidth - 0.5);
        wear = clamp(edge.wear + 0.25 * (1 - lanePhase * 2) - 0.12 * smoothstep(clamp((Math.abs(q.t) - band.laneEnd * 0.8) / 2, 0, 1)), 0, 1);
        wear += 0.12 * (fbm2D(p.x * 0.05, p.z * 0.05, 3, damageSeed) - 0.5);
        if (dMouth < 14) wear = clamp(wear + (1 - dMouth / 14) * 0.22, 0, 1);
        ao = 1 - 0.1 * smoothstep(clamp((Math.abs(q.t) - band.laneEnd + 1.2) / 1.6, 0, 1));
      } else if (q.group === 'channel') { ao = 0.88; wear = clamp(edge.wear + 0.3, 0, 1); }
      else if (q.group === 'kerb') { ao = 0.82; }
      else if (q.group === 'walk') { ao = 0.97; }
      else if (q.group === 'verge') { ao = 0.9; }

      const attrs = vertexAttrsFor(edge, q, s, flags, wear, dMouth);
      attrs.ao = ao;
      attrs.normal = { x: 0, y: 1, z: 0 };
      attrs.tangent = row.frame.t;
      mb.attr({ surface: q.surface });
      idx[j] = mb.vertex(p, attrs);
      row.pts[j].world = p;
    }
    if (prevIdx) mb.strip(prevIdx, idx);
    rows.push({ s, frame: row.frame, row, indices: idx });
    prevIdx = idx; prevRow = row;
  }
  return { stations: rows, s0, s1, length: s1 - s0 };
}
