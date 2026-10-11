// Road network -> quad-based triangle buffer.
//
// Topology rules this file enforces:
//  * Every road is a quad grid: rows follow the centreline arc length, columns follow
//    the cross-section profile (carriage, median, kerb, pavement, skirt).
//  * Road ends are trimmed to a shared "junction ring". Each road contributes its
//    cross-section at the trim line; corners between neighbouring roads are curved
//    (curb returns). The ring is then banded outward with quads that reproduce the
//    curb / pavement / skirt, and the carriageway interior is quad-dominant with a
//    small triangle fan at the very centre.
//  * Roads never overlap each other: a junction is a single merged surface, not
//    stacked ribbons. Grade separation (bridges) is expressed as elevation only.
import { MeshBuilder } from './mesh.js';
import { buildPath, at } from './path.js';
import { MAT } from './materials.js';
import { crossSection, roadControl } from './network.js';
import { add, scale, norm, rightOf, clamp, smoothstep, dist } from './math.js';
import { box, cylinder, sphere, sweepClosed } from './primitives.js';

const UP = [0, 1, 0];
const STEP = 0.6;                 // default longitudinal spacing (m)
const BAND_MATS = [MAT.CURB_FACE, MAT.CURB_TOP, MAT.PAVING, MAT.SKIRT];

export function buildPaths(doc) {
  const out = {};
  for (const r of Object.values(doc.roads)) {
    const ctrl = roadControl(doc, r);
    if (!ctrl) continue;
    out[r.id] = buildPath(ctrl, 0.5);
  }
  return out;
}

// Vertical displacement and ambient occlusion from speed bumps and potholes.
function disp(g, s, x, carr) {
  if (!carr) return { y: 0, ao: 1 };
  let y = 0, ao = 1;
  if (g.vis.bumps) {
    for (const b of g.road.bumps) {
      const s0 = b.t * g.L - b.len / 2;
      const u = (s - s0) / b.len;
      if (u > 0 && u < 1) y += b.h * smoothstep(0, 0.22, u) * (1 - smoothstep(0.78, 1, u));
    }
  }
  if (g.vis.potholes) {
    for (const p of g.road.potholes) {
      const sc = p.t * g.L, xc = p.lat * g.cs.H;
      const ds = (s - sc) / p.r, dx = (x - xc) / p.r;
      const d2 = ds * ds + dx * dx;
      if (d2 < 1.7) {
        const d = Math.sqrt(d2);
        const bowl = d2 < 1 ? -(1 - d2) * (1 - d2) * p.depth : 0;
        const rim = p.depth * 0.2 * Math.exp(-((d - 1) * (d - 1)) / 0.012);
        y += bowl + rim;
        ao *= 1 - 0.6 * (1 - smoothstep(0.7, 1.25, d));
      }
    }
  }
  return { y, ao };
}

// Right-hand profile (centre -> outer edge), then mirrored. Each point carries the
// material of the segment that starts at it and runs to the next point.
function buildProfile(cs, extraX) {
  const { m2, H, cH, cw, H2, O, sh } = cs;
  const R = [];
  R.push({ x: 0, base: m2 > 0 ? cH : 0, ground: false, mat: MAT.ASPHALT });
  if (m2 > 0) {
    R.push({ x: m2, base: cH, ground: false, mat: MAT.MEDIAN });
    R.push({ x: m2, base: 0, ground: false, mat: MAT.MEDIAN });
  }
  const xs = new Set();
  const start = m2;
  const n = Math.max(2, Math.ceil((H - start) / 0.8));
  for (let i = 0; i <= n; i++) xs.add(start + ((H - start) * i) / n);
  if (sh > 0 && H - sh > start) xs.add(H - sh);
  for (const x of extraX) if (x > start && x < H) xs.add(x);
  const last = R[R.length - 1].x;
  const carX = [...xs].filter((x) => x > last + 1e-6).sort((a, b) => a - b);
  for (const x of carX) {
    R.push({ x, base: 0, ground: false, mat: sh > 0 && x > H - sh + 1e-6 ? MAT.SHOULDER : MAT.ASPHALT });
  }
  if (cH > 0) R.push({ x: H, base: cH, ground: false, mat: MAT.CURB_FACE });
  if (cw > 0) R.push({ x: H2, base: cH, ground: false, mat: MAT.CURB_TOP });
  if (O > H2 + 1e-6) R.push({ x: O, base: cH, ground: false, mat: MAT.PAVING });
  R.push({ x: O, base: 0, ground: true, mat: MAT.SKIRT });

  const K = R.length;
  const pts = [];
  for (let k = K - 1; k >= 1; k--) {
    pts.push({ x: -R[k].x, base: R[k].base, ground: R[k].ground, segMat: R[k].mat, carr: !R[k].ground && R[k].x <= H + 1e-9 });
  }
  pts.push({ x: 0, base: R[0].base, ground: false, segMat: K > 1 ? R[1].mat : MAT.ASPHALT, carr: true });
  for (let k = 1; k < K; k++) {
    pts.push({ x: R[k].x, base: R[k].base, ground: R[k].ground, segMat: k + 1 < K ? R[k + 1].mat : -1, carr: !R[k].ground && R[k].x <= H + 1e-9 });
  }
  return pts;
}

// Junction ring levels for a cross-section: carriage edge, kerb top, pavement edge, skirt.
function ringLevels(cs) {
  return [
    { x: cs.H, base: 0, ground: false },
    { x: cs.H, base: cs.cH, ground: false },
    { x: cs.H2, base: cs.cH, ground: false },
    { x: cs.O, base: cs.cH, ground: false },
    { x: cs.O, base: 0, ground: true },
  ];
}

function sameLevel(a, b) {
  return Math.abs(a.x - b.x) < 1e-9 && a.base === b.base && a.ground === b.ground;
}

function makeRoadGeometry(doc, road, path, vis) {
  const cs = crossSection(road);
  const L = path.L;
  const T = Math.min(cs.O + 1.2, 0.45 * L);
  const extraX = [];
  if (vis.potholes) {
    for (const p of road.potholes) {
      const xc = p.lat * cs.H;
      for (let x = xc - 1.3 * p.r; x <= xc + 1.3 * p.r + 1e-6; x += 0.14) extraX.push(x);
    }
  }
  const crossing = {
    A: !!doc.junctions[road.a]?.crosswalks,
    B: !!doc.junctions[road.b]?.crosswalks,
  };
  return {
    road, path, cs, L, s0: T, s1: L - T, vis, crossing,
    F: buildProfile(cs, extraX),
    levels: ringLevels(cs),
  };
}

function rowsFor(g) {
  const set = new Set();
  const span = g.s1 - g.s0;
  const n = Math.max(1, Math.ceil(span / STEP));
  for (let i = 0; i <= n; i++) set.add(g.s0 + (span * i) / n);
  if (g.vis.bumps) for (const b of g.road.bumps) {
    const a = b.t * g.L - b.len / 2 - 0.4;
    for (let s = a; s <= a + b.len + 0.8; s += 0.15) set.add(s);
  }
  if (g.vis.potholes) for (const p of g.road.potholes) {
    const c = p.t * g.L;
    for (let s = c - p.r * 1.4; s <= c + p.r * 1.4; s += 0.1) set.add(s);
  }
  return [...set].filter((s) => s >= g.s0 - 1e-6 && s <= g.s1 + 1e-6).sort((a, b) => a - b);
}

function sweepRoad(mb, g) {
  const rows = rowsFor(g);
  const F = g.F, K = F.length, H = g.cs.H;
  const grid = rows.map((s) => {
    const a = at(g.path, s);
    return F.map((pt) => {
      let y, ao = 1;
      if (pt.ground) {
        y = g.cs.deckT > 0 ? a.p[1] - g.cs.deckT : 0;
      } else {
        const d = disp(g, s, pt.x, pt.carr);
        y = a.p[1] + pt.base + d.y;
        ao = d.ao;
      }
      if (pt.carr && Math.abs(pt.x) > H - 0.35) ao *= 0.7;   // gutter occlusion at kerbs
      const u = pt.carr ? (pt.x / H + 1) / 2 : 0.5;
      return [a.p[0] + a.r[0] * pt.x, y, a.p[2] + a.r[2] * pt.x, u, ao];
    });
  });
  for (let i = 0; i + 1 < grid.length; i++) {
    for (let k = 0; k + 1 < K; k++) {
      const mat = F[k].segMat;
      if (mat < 0) continue;
      mb.quad(grid[i][k], grid[i][k + 1], grid[i + 1][k + 1], grid[i + 1][k], mat);
    }
  }
}

// Flat painted strip between lateral offsets x0..x1 along s0..s1 (follows the surface).
function stripe(mb, g, s0, s1, x0, x1, mat, lift = 0.012) {
  if (s1 <= s0) return;
  const n = Math.max(1, Math.ceil((s1 - s0) / 0.5));
  let prev = null;
  for (let i = 0; i <= n; i++) {
    const s = s0 + ((s1 - s0) * i) / n;
    const a = at(g.path, s);
    const row = [
      [a.p[0] + a.r[0] * x0, a.p[1] + disp(g, s, x0, true).y + lift, a.p[2] + a.r[2] * x0, 0.5, 1],
      [a.p[0] + a.r[0] * x1, a.p[1] + disp(g, s, x1, true).y + lift, a.p[2] + a.r[2] * x1, 0.5, 1],
    ];
    if (prev) mb.quad(prev[0], prev[1], row[1], row[0], mat);
    prev = row;
  }
}

function dashed(mb, g, x0, x1, mat, dash = 3, gap = 9) {
  for (let s = g.s0 + 1; s < g.s1; s += dash + gap) {
    stripe(mb, g, s, Math.min(g.s1, s + dash), x0, x1, mat);
  }
}

function markings(mb, g) {
  const cs = g.cs, s0 = g.s0, s1 = g.s1;
  const H = cs.H, m2 = cs.m2, sh = cs.sh;
  const W = MAT.MARK_WHITE, Y = MAT.MARK_YELLOW;
  if (m2 === 0) {
    if (cs.lanesPer > 1) {
      stripe(mb, g, s0, s1, 0.1, 0.22, Y);
      stripe(mb, g, s0, s1, -0.22, -0.1, Y);
    } else {
      dashed(mb, g, -0.06, 0.06, Y);
    }
  }
  for (let k = 1; k < cs.lanesPer; k++) {
    const x = m2 + k * cs.laneW;
    dashed(mb, g, x - 0.06, x + 0.06, W);
    dashed(mb, g, -x - 0.06, -x + 0.06, W);
  }
  const ex = H - sh - 0.25;
  stripe(mb, g, s0, s1, ex, ex + 0.12, W);
  stripe(mb, g, s0, s1, -ex - 0.12, -ex, W);
}

function junctionMarks(mb, g, end) {
  const { cs, s0, s1 } = g;
  const H = cs.H, m2 = cs.m2;
  const sA = end === 'A' ? s0 : s1;
  const dir = end === 'A' ? 1 : -1;
  const at1 = (o) => sA + dir * o;
  const crossings = m2 > 0
    ? [[m2 + 0.3, H - 0.3], [-(H - 0.3), -(m2 + 0.3)]]
    : [[-(H - 0.3), H - 0.3]];
  const span = (a, b) => (dir > 0 ? [a, b] : [b, a]);
  const stop = (x0, x1) => {
    const [a, b] = span(at1(0.3), at1(0.7));
    stripe(mb, g, a, b, x0, x1, MAT.MARK_WHITE);
  };
  for (const [xa, xb] of crossings) {
    stop(xa, xb);
  }
  // Zebra crossing: bars running along the road, spaced across the carriageway.
  for (const [xa, xb] of crossings) {
    for (let x = Math.min(xa, xb); x + 0.6 <= Math.max(xa, xb) + 1e-6; x += 1.2) {
      const [a, b] = span(at1(1.4), at1(4.2));
      stripe(mb, g, a, b, x, x + 0.6, MAT.MARK_WHITE);
    }
  }
}

function bumpPaint(mb, g) {
  for (const b of g.road.bumps) {
    const s0 = b.t * g.L - b.len / 2;
    for (const f of [0.22, 0.72]) {
      const sa = s0 + b.len * f;
      stripe(mb, g, sa, sa + 0.45, -(g.cs.H - 0.3), g.cs.H - 0.3, MAT.MARK_YELLOW, b.h * 0.6 + 0.012);
    }
  }
}

// ---- props -----------------------------------------------------------------------

function lamp(mb, base, inward, a, design) {
  const up = UP;
  if (design === 'post-top') {
    cylinder(mb, base, up, 0.16, 0.1, 9.0, 20, MAT.POLE);
    sphere(mb, add(base, [0, 9.45, 0]), 0.32, MAT.EMISSIVE, 20, 12);
    return;
  }
  cylinder(mb, base, up, 0.16, 0.1, 9.0, 20, MAT.POLE);
  cylinder(mb, base, up, 0.24, 0.22, 0.25, 20, MAT.PIER);
  if (design === 'classic') {
    const top = add(base, [0, 9.0, 0]);
    box(mb, add(top, [0, 0.55, 0]), a.r, up, a.h, 0.2, 0.32, 0.2, MAT.EMISSIVE);
    box(mb, add(top, [0, 1.0, 0]), a.r, up, a.h, 0.26, 0.05, 0.26, MAT.POLE);
    return;
  }
  // cobra: tilted arm reaching over the carriageway
  const arm = norm([inward[0] * 0.9, 0.42, inward[2] * 0.9]);
  const top = add(base, [0, 8.7, 0]);
  cylinder(mb, top, arm, 0.06, 0.05, 2.3, 10, MAT.POLE);
  const head = add(top, scale(arm, 2.3));
  box(mb, head, a.r, up, inward, 0.18, 0.08, 0.35, MAT.LAMP_HOUSING);
  box(mb, add(head, [0, -0.1, 0]), a.r, up, inward, 0.16, 0.02, 0.28, MAT.EMISSIVE);
}

function lightsFor(mb, g) {
  const { road, cs, path } = g;
  if (!road.lights.on) return;
  const sp = Math.max(8, road.lights.spacing);
  const sides = road.lights.side === 'both' ? [-1, 1] : road.lights.side === 'left' ? [-1] : [1];
  for (let s = g.s0 + 4; s <= g.s1 - 4; s += sp) {
    const a = at(path, s);
    for (const side of sides) {
      const xs = side * (cs.sw > 0 ? cs.H2 + 0.6 : cs.H + 0.9);
      const yb = a.p[1] + (cs.sw > 0 ? cs.cH : 0);
      const base = [a.p[0] + a.r[0] * xs, yb, a.p[2] + a.r[2] * xs];
      const inward = [-a.r[0] * side, 0, -a.r[2] * side];
      lamp(mb, base, inward, a, road.lights.design);
    }
  }
}

function bollardsFor(mb, g) {
  const { road, cs, path } = g;
  if (!road.bollards.on) return;
  const sp = Math.max(1, road.bollards.spacing);
  for (let s = g.s0 + 1.5; s <= g.s1 - 1.5; s += sp) {
    const a = at(path, s);
    for (const side of [-1, 1]) {
      const xs = side * (cs.sw > 0 ? cs.H2 + 0.45 : cs.H + 0.45);
      const yb = a.p[1] + (cs.sw > 0 ? cs.cH : 0);
      const base = [a.p[0] + a.r[0] * xs, yb, a.p[2] + a.r[2] * xs];
      switch (road.bollards.design) {
        case 'square':
          box(mb, add(base, [0, 0.45, 0]), a.r, UP, a.h, 0.12, 0.45, 0.12, MAT.BOLLARD_CONCRETE);
          break;
        case 'fluted':
          cylinder(mb, base, UP, 0.14, 0.14, 0.95, 36, MAT.BOLLARD_PAINT, { radiusFn: (th) => 1 + 0.07 * Math.cos(12 * th) });
          break;
        case 'ball':
          cylinder(mb, base, UP, 0.09, 0.09, 0.75, 28, MAT.METAL);
          sphere(mb, add(base, [0, 0.9, 0]), 0.15, MAT.METAL, 28, 16);
          break;
        default:
          cylinder(mb, base, UP, 0.13, 0.13, 0.9, 32, MAT.GALV);
      }
    }
  }
}

function circle(cx, cy, r, n = 10) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const th = (i / n) * Math.PI * 2;
    out.push([cx + Math.cos(th) * r, cy + Math.sin(th) * r]);
  }
  return out;
}

function railingsFor(mb, g) {
  const { road, cs, path } = g;
  if (!road.rail.on) return;
  const design = road.rail.design;
  const xr = design === 'jersey' ? cs.H + 0.4 : cs.H + (cs.cH > 0 ? 0.55 : 0.45);
  const rows = [];
  const step = 0.5;
  for (let s = g.s0; s <= g.s1 + 1e-6; s += step) {
    const a = at(path, s);
    rows.push({ c: [a.p[0] + a.r[0] * xr, a.p[1], a.p[2] + a.r[2] * xr], R: a.r, U: UP, a });
  }
  const postEvery = { 'w-beam': 2.0, pipe: 2.5, cable: 3.0, jersey: 0 }[design];
  if (design === 'w-beam') {
    sweepClosed(mb, rows, [[0, 0.45], [0.09, 0.5], [0.09, 0.6], [0, 0.7], [-0.09, 0.6], [-0.09, 0.5]], MAT.GALV);
  } else if (design === 'pipe') {
    sweepClosed(mb, rows, circle(0, 0.5, 0.04), MAT.GALV);
    sweepClosed(mb, rows, circle(0, 0.92, 0.04), MAT.GALV);
  } else if (design === 'cable') {
    for (const h of [0.35, 0.6, 0.85]) sweepClosed(mb, rows, circle(0, h, 0.012, 8), MAT.METAL);
  } else if (design === 'jersey') {
    sweepClosed(mb, rows, [[-0.35, 0], [0.35, 0], [0.22, 0.82], [-0.22, 0.82]], MAT.JERSEY);
  }
  if (postEvery > 0) {
    for (let s = g.s0 + 0.5; s <= g.s1 - 0.5; s += postEvery) {
      const a = at(path, s);
      const c = [a.p[0] + a.r[0] * xr, a.p[1] + 0.4, a.p[2] + a.r[2] * xr];
      box(mb, c, a.r, UP, a.h, 0.05, 0.42, 0.05, design === 'cable' ? MAT.POLE : MAT.GALV);
    }
  }
}

function piersFor(mb, g, groundPts) {
  const { road, cs, path } = g;
  if (!road.bridge || cs.deckT <= 0) return;
  for (let s = g.s0 + 12; s <= g.s1 - 12; s += 24) {
    const a = at(path, s);
    const h = a.p[1] - cs.deckT;
    if (h < 1.5) continue;
    // Keep piers out of ground-level roads: an overpass is not a pier in the carriageway.
    let clear = true;
    for (const q of groundPts) {
      if (Math.abs(q[0] - a.p[0]) < cs.O + 3 && Math.abs(q[2] - a.p[2]) < cs.O + 3) { clear = false; break; }
    }
    if (!clear) continue;
    box(mb, [a.p[0], h / 2, a.p[2]], a.r, UP, a.h, cs.O * 0.8, h / 2, 0.9, MAT.PIER);
  }
}

// ---- junctions -------------------------------------------------------------------

function ringPoint(e, lv, sigma) {
  const { g, P, nOut } = e;
  const x = sigma * lv.x;
  const pos = [P[0] + nOut[0] * x, 0, P[2] + nOut[2] * x];
  const xProfile = sigma * lv.x * (e.side === 'A' ? 1 : -1);
  let y;
  if (lv.ground) y = g.cs.deckT > 0 ? P[1] - g.cs.deckT : 0;
  else y = P[1] + lv.base + disp(g, e.s, xProfile, true).y;
  return [pos[0], y, pos[2]];
}

function cornerPoints(p0, p2, d1, d2, M, cap) {
  const mid = [(p0[0] + p2[0]) / 2, (p0[1] + p2[1]) / 2, (p0[2] + p2[2]) / 2];
  const chord = dist(p0, p2);
  let X = null;
  if (cap) {
    X = [mid[0] + d1[0] * chord / 2, mid[1], mid[2] + d1[2] * chord / 2];
  } else {
    const w0 = p2[0] - p0[0], w2 = p2[2] - p0[2];
    const den = d1[0] * d2[2] - d1[2] * d2[0];
    if (Math.abs(den) > 1e-3) {
      const t = (w0 * d2[2] - w2 * d2[0]) / den;
      const Xc = [p0[0] + t * d1[0], mid[1], p0[2] + t * d1[2]];
      if (dist(Xc, mid) < 2.5 * (chord + 4)) X = Xc;
    }
    if (!X) X = mid;
  }
  const out = [];
  for (let j = 1; j <= M; j++) {
    const u = j / (M + 1), a = (1 - u) * (1 - u), b = 2 * (1 - u) * u, c = u * u;
    out.push([
      a * p0[0] + b * X[0] + c * p2[0],
      a * p0[1] + b * X[1] + c * p2[1],
      a * p0[2] + b * X[2] + c * p2[2],
    ]);
  }
  return out;
}

function buildJunction(mb, J, ends, stats) {
  const n = ends.length;
  if (n === 0) return;
  ends.sort((a, b) => Math.atan2(a.dOut[2], a.dOut[0]) - Math.atan2(b.dOut[2], b.dOut[0]));
  // Narrow angles between neighbouring roads fold the hub; report them.
  if (n > 1) {
    for (let i = 0; i < n; i++) {
      const a = ends[i].dOut, b = ends[(i + 1) % n].dOut;
      const ang = Math.abs(Math.atan2(a[0] * b[2] - a[2] * b[0], a[0] * b[0] + a[2] * b[2])) * 180 / Math.PI;
      if (ang < 22) stats.warnings.push({ junction: J.id, msg: `Roads meet at ${ang.toFixed(0)}°. Move the junction or add a waypoint to open the angle.` });
    }
  }
  const lvCount = 5;
  const rings = Array.from({ length: lvCount }, () => []);
  for (let i = 0; i < n; i++) {
    const e = ends[i];
    const nx = ends[(i + 1) % n];
    for (let l = 0; l < lvCount; l++) {
      rings[l].push(ringPoint(e, e.levels[l], -1));
      rings[l].push(ringPoint(e, e.levels[l], 1));
    }
    const chordOuter = dist(ringPoint(e, e.levels[4], 1), ringPoint(nx, nx.levels[4], -1));
    const M = clamp(Math.round(chordOuter / 1.6), 2, 12);
    for (let l = 0; l < lvCount; l++) {
      const p0 = ringPoint(e, e.levels[l], 1);
      const p2 = n === 1 ? ringPoint(e, e.levels[l], -1) : ringPoint(nx, nx.levels[l], -1);
      const pts = cornerPoints(p0, p2, e.dOut, n === 1 ? e.dOut : nx.dOut, M, n === 1);
      rings[l].push(...pts);
    }
  }
  const N = rings[0].length;
  // Hub centre is the centroid of the outer ring. The junction point itself can sit
  // outside the trimmed road ends (dead ends, offset gizmo), which would fold the fan.
  const C = [0, J.p[1], 0];
  for (const p of rings[0]) { C[0] += p[0]; C[2] += p[2]; }
  C[0] /= N; C[2] /= N;
  const shrink = 0.4;
  const inner = rings[0].map((p) => [C[0] + (p[0] - C[0]) * shrink, C[1], C[2] + (p[2] - C[2]) * shrink]);
  const v = (p, u = 0.5, ao = 1) => [p[0], p[1], p[2], u, ao];
  for (let k = 0; k < N; k++) {
    const k2 = (k + 1) % N;
    mb.quad(v(rings[0][k]), v(rings[0][k2]), v(inner[k2]), v(inner[k]), MAT.ASPHALT);
    mb.tri(v(C, 0.5, 1), v(inner[k2]), v(inner[k]), MAT.ASPHALT);
  }
  // Curb bands (vertical kerb face, kerb top, pavement, skirt) built from the same ring.
  for (let l = 0; l < lvCount - 1; l++) {
    const allSame = ends.every((e) => sameLevel(e.levels[l], e.levels[l + 1]));
    if (allSame) continue;
    const mat = BAND_MATS[l];
    for (let k = 0; k < N; k++) {
      const k2 = (k + 1) % N;
      mb.quad(v(rings[l][k]), v(rings[l][k2]), v(rings[l + 1][k2]), v(rings[l + 1][k]), mat);
    }
  }
  stats.junctions++;
}

// ---- top level -------------------------------------------------------------------

export function buildScene(doc, options = {}) {
  const vis = { ...doc.vis, ...(options.vis || {}) };
  const mb = new MeshBuilder(1 << 18);
  const stats = { roads: 0, junctions: 0, warnings: [], skipped: [] };
  const paths = buildPaths(doc);
  const geo = [];
  for (const road of Object.values(doc.roads)) {
    const path = paths[road.id];
    if (!path) continue;
    const g = makeRoadGeometry(doc, road, path, vis);
    if (g.s1 - g.s0 < 1) { stats.skipped.push(road.id); continue; }
    geo.push(g);
  }

  // Junction hubs: collect every road end at each junction.
  const endsByJ = {};
  for (const g of geo) {
    for (const side of ['A', 'B']) {
      const jid = side === 'A' ? g.road.a : g.road.b;
      const s = side === 'A' ? g.s0 : g.s1;
      const a = at(g.path, s);
      const dOut = side === 'A' ? a.h : [-a.h[0], 0, -a.h[2]];
      const nOut = rightOf(dOut);
      (endsByJ[jid] ||= []).push({ g, side, s, P: a.p, dOut, nOut, levels: g.levels });
    }
  }
  if (vis.junctions) {
    for (const [jid, ends] of Object.entries(endsByJ)) {
      const J = doc.junctions[jid];
      if (J) buildJunction(mb, J, ends, stats);
    }
  }
  // Road body, markings, props.
  const groundPts = [];
  for (const g of geo) {
    for (let s = 0; s <= g.L; s += 2) {
      const a = at(g.path, s);
      if (a.p[1] < 1) groundPts.push([a.p[0], a.p[1], a.p[2]]);
    }
  }
  for (const g of geo) {
    stats.roads++;
    if (vis.roads) sweepRoad(mb, g);
    if (vis.markings) {
      markings(mb, g);
      if (vis.bumps) bumpPaint(mb, g);
    }
    if (vis.crosswalks) {
      if (g.crossing.A) junctionMarks(mb, g, 'A');
      if (g.crossing.B) junctionMarks(mb, g, 'B');
    }
    if (vis.lights) lightsFor(mb, g);
    if (vis.bollards) bollardsFor(mb, g);
    if (vis.railings) railingsFor(mb, g);
    if (g.road.bridge && vis.roads) piersFor(mb, g, groundPts.filter((q) => q[1] < 1));
  }
  // Ground plane (grid of quads so the surface can be lit with per-vertex data).
  if (vis.ground) {
    const pts = Object.values(doc.junctions).map((j) => j.p);
    const minX = Math.min(-200, ...pts.map((p) => p[0])) - 200;
    const maxX = Math.max(200, ...pts.map((p) => p[0])) + 200;
    const minZ = Math.min(-200, ...pts.map((p) => p[2])) - 200;
    const maxZ = Math.max(200, ...pts.map((p) => p[2])) + 200;
    const nx = 8, nz = 8;
    for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) {
      const x0 = minX + ((maxX - minX) * i) / nx, x1 = minX + ((maxX - minX) * (i + 1)) / nx;
      const z0 = minZ + ((maxZ - minZ) * k) / nz, z1 = minZ + ((maxZ - minZ) * (k + 1)) / nz;
      mb.quad([x0, -0.03, z0, 0.5, 1], [x1, -0.03, z0, 0.5, 1], [x1, -0.03, z1, 0.5, 1], [x0, -0.03, z1, 0.5, 1], MAT.GROUND);
    }
  }
  return {
    data: mb.result(),
    paths,
    stats: {
      roads: stats.roads,
      junctions: stats.junctions,
      quads: mb.quads,
      tris: mb.tris,
      vertices: mb.n / 9,
      degenerate: mb.degenerate,
      warnings: stats.warnings,
      skipped: stats.skipped,
    },
  };
}

