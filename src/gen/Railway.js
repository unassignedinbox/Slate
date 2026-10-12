/* ============================================================================
   Railway — track, slab track, tram grooves, level crossings, OLE and
   platforms.

   Crossing detection is grid-accelerated: curve samples are bucketed into
   cells so a city with 40 km of railway doesn't degenerate into an O(n²)
   scan against every road.
   ========================================================================== */

import * as THREE from 'three';
import { lerp } from '../core/mathx.js';
import { paintStopBar, paintSymbol, SYM } from './Markings.js';

/* ------------------------------------------------------ crossing search --- */

/**
 * Find every place a road edge crosses a rail edge.
 * @returns {Array<{rail, road, sRail, sRoad, x, z}>}
 */
export function findCrossings(net, cell = 24) {
  const grid = new Map();
  const key = (cx, cz) => `${cx},${cz}`;
  const samples = [];

  for (const e of net.edges.values()) {
    const isRail = e.isRail();
    const c = e.curve(net);
    if (!c || c.length < 4) continue;
    const n = Math.max(2, Math.ceil(c.length / 6));
    const rec = { edge: e, isRail, pts: [] };
    for (let i = 0; i <= n; i++) {
      const d = (c.length * i) / n;
      const p = c.pos(d, { x: 0, y: 0 });
      rec.pts.push({ x: p.x, z: p.y, d });
    }
    samples.push(rec);
    for (const p of rec.pts) {
      const k = key(Math.floor(p.x / cell), Math.floor(p.z / cell));
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push({ rec, i: rec.pts.length - 1 });
    }
  }

  const out = [];
  const seen = new Set();
  for (const rec of samples) {
    if (!rec.isRail) continue;
    const near = new Map();
    for (let i = 0; i < rec.pts.length; i++) {
      const p = rec.pts[i];
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          const bucket = grid.get(key(Math.floor(p.x / cell) + dx, Math.floor(p.z / cell) + dz));
          if (!bucket) continue;
          for (const b of bucket) {
            if (b.rec === rec || b.rec.isRail) continue;
            near.set(b.rec.edge.id, b.rec);
          }
        }
      }
    }
    for (const other of near.values()) {
      const hits = intersectCurves(rec.pts, other.pts);
      for (const h of hits) {
        const sig = `${rec.edge.id}|${other.edge.id}|${h.sA.toFixed(1)}`;
        if (seen.has(sig)) continue;
        seen.add(sig);
        out.push({ rail: rec.edge, road: other.edge, sRail: h.sA, sRoad: h.sB, x: h.x, z: h.z });
      }
    }
  }
  return out;
}

function intersectCurves(A, B) {
  const out = [];
  for (let i = 0; i < A.length - 1; i++) {
    for (let j = 0; j < B.length - 1; j++) {
      const a0 = A[i], a1 = A[i + 1], b0 = B[j], b1 = B[j + 1];
      const r = { x: a1.x - a0.x, z: a1.z - a0.z };
      const s = { x: b1.x - b0.x, z: b1.z - b0.z };
      const den = r.x * s.z - r.z * s.x;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((b0.x - a0.x) * s.z - (b0.z - a0.z) * s.x) / den;
      const u = ((b0.x - a0.x) * r.z - (b0.z - a0.z) * r.x) / den;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
        out.push({
          x: a0.x + r.x * t, z: a0.z + r.z * t,
          sA: lerp(a0.d, a1.d, t), sB: lerp(b0.d, b1.d, u),
        });
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------- profile --- */

/** Simplified flat-bottom rail section (Vignole), metres. */
const RAIL_PROFILE = [
  { x: -0.075, y: 0.000 },
  { x: -0.075, y: 0.032 },
  { x: -0.028, y: 0.040 },
  { x: -0.028, y: 0.115 },
  { x: -0.036, y: 0.145 },
  { x: 0.036, y: 0.145 },
  { x: 0.028, y: 0.115 },
  { x: 0.028, y: 0.040 },
  { x: 0.075, y: 0.032 },
  { x: 0.075, y: 0.000 },
];

/** Grooved tram rail (girder rail) — only the head sits proud. */
const GIRDER_PROFILE = [
  { x: -0.055, y: -0.030 },
  { x: -0.055, y: 0.012 },
  { x: -0.030, y: 0.018 },
  { x: -0.030, y: 0.040 },
  { x: -0.040, y: 0.052 },
  { x: 0.040, y: 0.052 },
  { x: 0.030, y: 0.040 },
  { x: 0.030, y: 0.018 },
  { x: 0.055, y: 0.012 },
  { x: 0.055, y: -0.030 },
];

/* ---------------------------------------------------------------- build --- */

/**
 * Track geometry for one edge.
 * @param {Array} crossings  crossing records that touch this edge
 */
export function buildTrack(edge, net, sink, propSink, ribbon, section, ctx = {}) {
  const crossings = ctx.crossings || [];
  const myCross = crossings.filter((c) => c.rail === edge || c.road === edge);
  const f = edge.featuresOf();
  const edgeStep = edge._step ?? 4;

  for (const lane of section.lanes) {
    if (lane.k !== 'rail' && lane.k !== 'tram') continue;
    const gauge = lane.band?.gauge ?? 1.435;
    const nRails = lane.band?.rails ?? 2;
    const slab = !!lane.band?.slab;
    const tram = lane.k === 'tram';
    const centre = (lane.l0 + lane.l1) / 2;
    const offsets = [];
    if (nRails === 2) offsets.push(-gauge / 2, gauge / 2);
    else { for (let i = 0; i < nRails; i++) offsets.push(lerp(-gauge / 2, gauge / 2, i / (nRails - 1))); }

    /* --- ballast shoulder (slopes down at the sides of the bed) --- */
    if (!slab && !tram) {
      const bedHalf = lane.w / 2;
      buildBedShoulder(sink, ribbon, centre - bedHalf, centre + bedHalf, 'ballast');
    }

    /* --- sleepers / bearers --- */
    if (!slab && !tram) {
      const pitch = f.sleeperPitch ?? 0.62;
      const n = Math.max(2, Math.round(ribbon.length / pitch));
      for (let i = 0; i <= n; i++) {
        const s = (ribbon.length * i) / n;
        if (inCrossing(myCross, s, 1.9)) continue;
        const p = ribbon.point(s, centre, new THREE.Vector3());
        const fwd = ribbon.forward(s, new THREE.Vector3());
        const ry = Math.atan2(fwd.x, fwd.z);
        propSink.addTRS('sleeper', p.x, p.y + 0.03, p.z, ry);
      }
    } else if (slab) {
      // slab track: a continuous concrete plinth under the rails
      const w = Math.min(lane.w, gauge + 1.4);
      buildSlab(sink, ribbon, centre - w / 2, centre + w / 2, 'concrete', -0.02);
    }

    /* --- rails --- */
    for (const off of offsets) {
      buildRail(sink, ribbon, centre + off, tram ? GIRDER_PROFILE : RAIL_PROFILE, tram, edgeStep);
    }

    /* --- check rails inside the crossing (flangeways) --- */
    for (const c of myCross) {
      if (c.rail !== edge) continue;
      buildCrossing(edge, net, sink, propSink, ribbon, section, c, { gauge, centre, lane, detail: ctx.detail ?? 0 });
    }

    /* --- overhead line equipment --- */
    if (f.catenary && ctx.detail === 0) {
      buildOLE(edge, net, sink, propSink, ribbon, section, ctx);
    }

    /* --- platforms --- */
    if (f.platforms && ctx.detail === 0) {
      buildPlatforms(edge, net, sink, ribbon, section, ctx);
    }
  }
}

function inCrossing(list, s, pad) {
  for (const c of list) {
    const d = c.rail ? c.sRail : c.sRoad;
    if (Math.abs(d - s) < (c.halfLength ?? 6) + pad) return true;
  }
  return false;
}

function buildBedShoulder(sink, ribbon, l0, l1, key) {
  // Ballast wedge falling away outside the sleeper ends. Each side is wound by
  // testing its own first quad against the outward lateral direction, so the
  // two sides never need opposite hard-coded windings.
  const step = 3.0;
  const n = Math.max(1, Math.ceil(ribbon.length / step));
  const bk = sink.b(key);
  const idxFrom = bk.idx.length;
  const base = bk.n;

  const triN = (i0, i1, i2) => {
    const a = i0 * 3, b = i1 * 3, c = i2 * 3;
    const ux = bk.pos[b] - bk.pos[a], uy = bk.pos[b + 1] - bk.pos[a + 1], uz = bk.pos[b + 2] - bk.pos[a + 2];
    const vx = bk.pos[c] - bk.pos[a], vy = bk.pos[c + 1] - bk.pos[a + 1], vz = bk.pos[c + 2] - bk.pos[a + 2];
    return { x: uy * vz - uz * vy, y: uz * vx - ux * vz, z: ux * vy - uy * vx };
  };

  for (const [l, out] of [[l0, -0.85], [l1, 0.85]]) {
    const base = bk.n;
    for (let i = 0; i <= n; i++) {
      const s = (ribbon.length * i) / n;
      const a = ribbon.point(s, l, new THREE.Vector3());
      const b = ribbon.point(s, l + out, new THREE.Vector3());
      b.y -= 0.42;
      bk.vert(a.x, a.y + 0.02, a.z, 0, 1, 0, 0, s);
      bk.vert(b.x, b.y, b.z, 0, 1, 0, 0.85, s);
    }
    // probe winding against the outward lateral at mid-station
    const mid = ribbon.right(ribbon.length / 2, new THREE.Vector3()).multiplyScalar(Math.sign(out));
    const probe = triN(base, base + 1, base + 3);
    const flip = (probe.x * mid.x + probe.z * mid.z) < 0;
    for (let i = 0; i < n; i++) {
      const a = base + i * 2;
      if (flip) { bk.tri(a, a + 3, a + 1); bk.tri(a, a + 2, a + 3); }
      else { bk.tri(a, a + 1, a + 3); bk.tri(a, a + 3, a + 2); }
    }
  }
  sink._computeRangeNormals(bk, base, idxFrom);
}

function buildSlab(sink, ribbon, l0, l1, key, dy) {
  const step = 4.0;
  const n = Math.max(1, Math.ceil(ribbon.length / step));
  const bk = sink.b(key);
  const base = bk.n;
  const idxFrom = bk.idx.length;
  for (let i = 0; i <= n; i++) {
    const s = (ribbon.length * i) / n;
    const a = ribbon.point(s, l0, new THREE.Vector3());
    const b = ribbon.point(s, l1, new THREE.Vector3());
    bk.vert(a.x, a.y + dy, a.z, 0, 1, 0, 0, s);
    bk.vert(b.x, b.y + dy, b.z, 0, 1, 0, l1 - l0, s);
  }
  for (let i = 0; i < n; i++) {
    const a = base + i * 2;
    bk.tri(a, a + 1, a + 3);
    bk.tri(a, a + 3, a + 2);
  }
  sink._computeRangeNormals(bk, base, idxFrom);
}

function buildRail(sink, ribbon, l, profile, tram, edgeStep = 4) {
  const step = Math.max(1.2, edgeStep * 0.5);
  const n = Math.max(2, Math.ceil(ribbon.length / step));
  const frames = [];
  for (let i = 0; i <= n; i++) {
    const s = (ribbon.length * i) / n;
    const o = ribbon.point(s, l, new THREE.Vector3());
    const fwd = ribbon.forward(s, new THREE.Vector3());
    const rt = ribbon.right(s, new THREE.Vector3());
    const up = new THREE.Vector3().crossVectors(rt, fwd).normalize();
    if (up.y < 0) up.negate();
    frames.push({ o, r: rt, u: up, f: fwd, s });
  }
  sink.extrude(tram ? 'galv' : 'steel', profile, frames, { uvScale: 1, facing: 'out' });
}

/* ------------------------------------------------------ level crossing --- */

function buildCrossing(edge, net, sink, propSink, ribbon, section, c, info = {}) {
  const { gauge, centre, detail = 0 } = info;
  const roadWidth = c.road.width ? c.road.width() : 8;
  const halfAlong = Math.max(3.2, roadWidth * 0.5 + 1.2);
  c.halfLength = halfAlong;

  /* --- crossing deck: rubber / concrete panels spanning the approaches --- */
  const railEdge = c.rail;
  const railCurve = railEdge.curve(net);
  const rp = railCurve.pos(c.sRail, { x: 0, y: 0 });
  const rt = railCurve.tangent(c.sRail, { x: 1, y: 0 });
  const rl = { x: -rt.y, y: rt.x };

  const roadCurve = c.road.curve(net);
  const rt2 = roadCurve.tangent(c.sRoad, { x: 1, y: 0 });
  const rl2 = { x: -rt2.y, y: rt2.x };

  const y = ribbon.point(c.sRail, centre, new THREE.Vector3()).y;
  const deckHalfAcross = gauge / 2 + 1.35;
  const corners = [
    [rp.x + rl2.x * -halfAlong + rt.x * -deckHalfAcross, rp.y + rl2.y * -halfAlong + rt.y * -deckHalfAcross],
    [rp.x + rl2.x * halfAlong + rt.x * -deckHalfAcross, rp.y + rl2.y * halfAlong + rt.y * -deckHalfAcross],
    [rp.x + rl2.x * halfAlong + rt.x * deckHalfAcross, rp.y + rl2.y * halfAlong + rt.y * deckHalfAcross],
    [rp.x + rl2.x * -halfAlong + rt.x * deckHalfAcross, rp.y + rl2.y * -halfAlong + rt.y * deckHalfAcross],
  ].map(([x, z]) => new THREE.Vector3(x, y + 0.045, z));
  sink.flatQuad('rubber', corners[0], corners[1], corners[2], corners[3], 1, 1, 0, 0, false);

  /* --- flangeway channels either side of each rail --- */
  for (const off of [-gauge / 2, gauge / 2]) {
    for (const side of [-1, 1]) {
      const l = centre + off + side * 0.085;
      const a = ribbon.point(c.sRail - halfAlong, l, new THREE.Vector3());
      const b = ribbon.point(c.sRail - halfAlong, l + side * 0.055, new THREE.Vector3());
      const cc = ribbon.point(c.sRail + halfAlong, l + side * 0.055, new THREE.Vector3());
      const d = ribbon.point(c.sRail + halfAlong, l, new THREE.Vector3());
      for (const p of [a, b, cc, d]) p.y += 0.05;
      sink.flatQuad('rubber', a, b, cc, d, 1, 1, 0, 0, false);
    }
  }

  /* --- road-side markings + furniture --- */
  const roadRibbon = c.road._ribbon;
  if (roadRibbon) {
    const sec = c.road._section;
    if (sec) {
      const cw = sec.carriageway;
      const sAt = c.sRoad;
      // stop line + transverse ladder bars on both approaches
      for (const dirSign of [-1, 1]) {
        const stopS = sAt + dirSign * (halfAlong + 0.9);
        if (stopS > 1 && stopS < roadRibbon.length - 1) {
          paintStopBar(sink, roadRibbon, cw.l0 + 0.2, cw.l1 - 0.2, Math.min(stopS, stopS + dirSign * 0.4), { w: 0.4 });
        }
        // ladder: three bars of decreasing width
        const widths = [0.6, 0.45, 0.3];
        for (let k = 0; k < 3; k++) {
          const s = sAt + dirSign * (halfAlong + 3.2 + k * 3.0);
          if (s > 1 && s < roadRibbon.length - 1) {
            paintStopBar(sink, roadRibbon, cw.l0 + 0.35, cw.l1 - 0.35, Math.min(s, s + dirSign * widths[k]), { w: widths[k] });
          }
        }
        const symS = sAt + dirSign * (halfAlong + 14.5);
        if (symS > 2 && symS < roadRibbon.length - 2) {
          paintSymbol(sink, roadRibbon, (cw.l0 + cw.l1) / 2, symS, 1.4, 1.4, SYM.RAILX);
        }
      }
    }
  }

  if ((c.road.featuresOf().levelCrossing ?? true) && detail === 0) {
    // St Andrew's cross + half-boom barriers on both approaches
    for (const dirSign of [-1, 1]) {
      const s = c.sRoad + dirSign * (halfAlong + 2.6);
      if (s < 0.5 || s > (roadCurve?.length ?? 0) - 0.5) continue;
      const p = roadCurve.pos(s, { x: 0, y: 0 });
      const t = roadCurve.tangent(s, { x: 1, y: 0 });
      const r = { x: -t.y, y: t.x };
      const side = -dirSign;
      const bx = p.x + r.x * side * (c.road.width() / 2 + 0.9);
      const bz = p.y + r.y * side * (c.road.width() / 2 + 0.9);
      propSink.addTRS('crossbuck', bx, net.nodes.get(c.road.a)?.y ?? 0, bz, Math.atan2(-t.x * side, -t.y * side));
      propSink.addTRS('boom', bx + r.x * side * 0.9, net.nodes.get(c.road.a)?.y ?? 0, bz + r.y * side * 0.9, Math.atan2(-t.x * side, -t.y * side));
    }
  }
}

/* -------------------------------------------------------------- the OLE --- */

function buildOLE(edge, net, sink, propSink, ribbon, section, ctx) {
  const spacing = 42;
  const L = ribbon.length;
  const n = Math.floor(L / spacing);
  if (n < 1) return;
  const l = section.width * 0.5 - 0.9;
  const h = 6.2;
  const masts = [];
  for (let i = 0; i <= n; i++) {
    const s = (L * i) / n;
    const p = ribbon.point(s, -l, new THREE.Vector3());
    propSink.addTRS('catenaryMast', p.x, p.y, p.z, 0);
    masts.push({ x: p.x, y: p.y + h, z: p.z, s });
  }
  // contact wire + catenary: two sagging tubes between mast tops
  for (const [sag, r] of [[0.55, 0.012], [0.30, 0.008]]) {
    const frames = [];
    const steps = Math.max(2, Math.round(L / 3));
    for (let i = 0; i <= steps; i++) {
      const s = (L * i) / steps;
      const p = ribbon.point(s, -l * 0.15, new THREE.Vector3());
      const fwd = ribbon.forward(s, new THREE.Vector3());
      // sag between masts
      const phase = (s / spacing) % 1;
      const drop = -sag * 4 * phase * (1 - phase);
      frames.push({
        o: new THREE.Vector3(p.x, p.y + h + drop, p.z),
        r: new THREE.Vector3(1, 0, 0), u: new THREE.Vector3(0, 1, 0), f: fwd, s,
      });
    }
    const prof = [];
    const seg = 4;
    for (let k = 0; k < seg; k++) {
      const a = (k / seg) * Math.PI * 2;
      prof.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
    }
    sink.extrude('galv', prof, frames, { uvScale: 1, facing: 'out' });
  }
}

/* ---------------------------------------------------------- platforms --- */

function buildPlatforms(edge, net, sink, ribbon, section, ctx) {
  const L = ribbon.length;
  const spacing = 400;
  const n = Math.floor(L / spacing);
  if (n < 1) return;
  const w = 3.4;
  for (let i = 1; i <= n; i++) {
    const s = (L * i) / (n + 1);
    const p = ribbon.point(s, 0, new THREE.Vector3());
    const rt = ribbon.right(s, new THREE.Vector3());
    const fwd = ribbon.forward(s, new THREE.Vector3());
    const len = 90;
    // platform slab on both sides
    for (const side of [-1, 1]) {
      const cx = p.x + rt.x * side * (section.width * 0.5 - w * 0.5);
      const cz = p.z + rt.z * side * (section.width * 0.5 - w * 0.5);
      const a = new THREE.Vector3(cx - fwd.x * len / 2, p.y + 0.95, cz - fwd.z * len / 2);
      const b = new THREE.Vector3(cx + fwd.x * len / 2, p.y + 0.95, cz + fwd.z * len / 2);
      // top
      const corners = [
        new THREE.Vector3(a.x + rt.x * side * w / 2, a.y, a.z + rt.z * side * w / 2),
        new THREE.Vector3(b.x + rt.x * side * w / 2, b.y, b.z + rt.z * side * w / 2),
        new THREE.Vector3(b.x - rt.x * side * w / 2, b.y, b.z - rt.z * side * w / 2),
        new THREE.Vector3(a.x - rt.x * side * w / 2, a.y, a.z - rt.z * side * w / 2),
      ];
      sink.flatQuad('concrete', corners[0], corners[1], corners[2], corners[3], 1, 1, 0, 0, false);
      // tactile strip along the platform edge (track side)
      const t0 = new THREE.Vector3(corners[0].x - rt.x * side * 0.5, a.y + 0.006, corners[0].z - rt.z * side * 0.5);
      const t1 = new THREE.Vector3(corners[1].x - rt.x * side * 0.5, b.y + 0.006, corners[1].z - rt.z * side * 0.5);
      const t2 = new THREE.Vector3(corners[1].x - rt.x * side * 0.9, b.y + 0.006, corners[1].z - rt.z * side * 0.9);
      const t3 = new THREE.Vector3(corners[0].x - rt.x * side * 0.9, a.y + 0.006, corners[0].z - rt.z * side * 0.9);
      sink.flatQuad('paint_y', t0, t1, t2, t3, 1, 1, 0, 0, false);
    }
  }
}
