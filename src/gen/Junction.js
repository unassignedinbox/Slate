/* ============================================================================
   Junction — intersection patches.

   Construction
   ------------
   1. Sort the incident edges by the compass bearing of their OUTWARD
      direction at the node.
   2. Every edge contributes two boundary lines (its lateral + and − sides).
   3. Consecutive edges bound a wedge; the wedge's kerb corner is the
      intersection of edge i's + line with edge i+1's − line, filleted by a
      kerb radius. Near-parallel pairs (the through movement at a T, or the
      two halves of a bend) simply run straight through — that is what keeps
      the boundary continuous instead of shooting a corner off to infinity.
   4. The resulting closed ring is filled as the running surface, then swept
      outward into a kerb face + footway ring.

   Because the inner ring and the offset outer ring share a vertex count, the
   kerb/footway sweep is a clean quad strip — no triangulation artefacts.
   ========================================================================== */

import * as THREE from 'three';
import { clamp, dot2, sub2, add2, mul2, norm2, lineIntersect2, polygonArea, triangulate } from '../core/mathx.js';
import { compileProfile } from './CrossSection.js';
import { paintZebra, paintStopBar, paintGiveWay, paintSymbol, SYM } from './Markings.js';
import { Ribbon, makeElevation } from './RoadMeshBuilder.js';

const _v = new THREE.Vector3();

/* ------------------------------------------------------------ approaches -- */

/**
 * @returns {Object|null} approach descriptor for one edge at one node
 */
function approach(net, edge, nodeId, cache) {
  const node = net.nodes.get(nodeId);
  if (!node) return null;
  const curve = edge.curve(net);
  if (!curve || curve.length < 0.5) return null;

  let sec = cache.get(edge.id);
  if (!sec) { sec = compileProfile(edge.bandsOf(), { camber: edge.camber ?? 0.025 }); cache.set(edge.id, sec); }

  const atB = edge.b === nodeId;
  const d = atB ? curve.length : 0;
  const t = curve.tangent(clamp(d, 0, curve.length), { x: 1, y: 0 });
  const rl = { x: -t.y, y: t.x };                    // edge lateral + basis
  const outward = atB ? { x: -t.x, y: -t.y } : { x: t.x, y: t.y };
  const plusLat = atB ? sec.l0 : sec.l1;             // lateral + in the outward frame
  const minusLat = atB ? sec.l1 : sec.l0;
  const p = curve.pos(clamp(d, 0, curve.length), { x: 0, y: 0 });

  return {
    edge, nodeId, atB, sec, curve, outward, rl,
    plusLat, minusLat,
    origin: { x: p.x, y: p.y },
    plusPt: { x: p.x + rl.x * plusLat, y: p.y + rl.y * plusLat },
    minusPt: { x: p.x + rl.x * minusLat, y: p.y + rl.y * minusLat },
    width: sec.width,
    half: sec.width / 2,
    carriageway: sec.carriageway,
    sidewalkW: sec.lanes.filter((l) => l.k === 'sidewalk').reduce((s, l) => s + l.w, 0),
    kerbH: Math.max(0.12, ...sec.lanes.filter((l) => l.k === 'sidewalk').map((l) => l.h ?? 0.15)),
    hasFootway: sec.lanes.some((l) => l.k === 'sidewalk'),
    lanes: sec.lanes,
    speed: edge.speed ?? 50,
    angle: Math.atan2(outward.y, outward.x),
  };
}

/**
 * Solve a junction just far enough to learn how far the patch reaches along
 * each approach. The chunk builder needs this BEFORE extruding the roads so it
 * can trim markings and flatten the crown into the patch.
 * @returns {Map<string, number>} edgeId -> mouth distance
 */
export function junctionMouths(node, net, cache = new Map()) {
  const out = new Map();
  const apps = [];
  for (const e of net.edgesAt(node.id)) {
    const a = approach(net, e, node.id, cache);
    if (a) apps.push(a);
  }
  if (apps.length < 2) return out;
  apps.sort((p, q) => p.angle - q.angle);
  if (apps.length === 2) {
    const dA = Math.abs(((apps[0].angle - apps[1].angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    if (dA < 0.05 && Math.abs(apps[0].width - apps[1].width) < 0.02) return out;
  }
  const jc = node.junction || {};
  if (jc.type === 'roundabout') {
    const width = jc.width ?? 7.5;
    const maxHalf = Math.max(...apps.map((a) => a.half));
    const Ro = jc.outer ?? (maxHalf * 0.9 + width + 4);
    for (const a of apps) out.set(a.edge.id, Ro + 2.5);
    return out;
  }
  const maxHalf = Math.max(...apps.map((a) => a.half));
  const R = jc.radius && jc.radius > 0 ? jc.radius : clamp(maxHalf * 0.85, 2.5, 20);
  const { extent } = buildRing(apps, R, 0);
  for (let i = 0; i < apps.length; i++) out.set(apps[i].edge.id, extent[i]);
  return out;
}

/* --------------------------------------------------------------- solver --- */

function buildRing(apps, R, footwayW) {
  const n = apps.length;
  const corners = [];

  for (let i = 0; i < n; i++) {
    const a = apps[i], b = apps[(i + 1) % n];
    const X = lineIntersect2(a.plusPt, a.outward, b.minusPt, b.outward);
    if (!X) {
      corners.push({ degenerate: true, i });
      continue;
    }
    const da = dot2(sub2(X, a.plusPt), a.outward);
    const db = dot2(sub2(X, b.minusPt), b.outward);
    if (da < 0.2 || db < 0.2 || !isFinite(da) || !isFinite(db)) {
      corners.push({ degenerate: true, i });
      continue;
    }
    // interior angle between the two lines, measured inside the wedge
    const u1 = mul2(a.outward, -1);
    const u2 = mul2(b.outward, -1);
    const cosPhi = clamp(dot2(u1, u2), -1, 1);
    const phi = Math.acos(cosPhi);
    if (phi < 0.12 || phi > Math.PI - 0.12) {
      corners.push({ degenerate: true, i });
      continue;
    }
    const half = phi / 2;
    let dTan = R / Math.tan(half);
    const avail = Math.min(da, db) - 0.4;
    if (dTan > avail) dTan = Math.max(0.05, avail);
    const rEff = dTan * Math.tan(half);

    const T1 = { x: X.x - a.outward.x * dTan, y: X.y - a.outward.y * dTan };
    const T2 = { x: X.x - b.outward.x * dTan, y: X.y - b.outward.y * dTan };
    const bis = norm2(add2(u1, u2));
    const dist = rEff / Math.sin(half);
    const C = { x: X.x + bis.x * dist, y: X.y + bis.y * dist };

    corners.push({
      degenerate: false, i, X, T1, T2, C, rEff,
      distA: da - dTan, distB: db - dTan,
      cornerA: da, cornerB: db,
    });
  }

  /* Two distances per arm:
       mouth  — where the chord across the arm sits (must clear the fillet)
       extent — how far the patch reaches along the arm, used to trim
                markings and flatten the crown                              */
  const mouth = new Array(n).fill(0);
  const extent = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const cPrev = corners[(i - 1 + n) % n];
    const cThis = corners[i];
    let aPlus = 60, aMinus = 60;
    let ePlus = apps[i].half, eMinus = apps[i].half;
    if (!cThis.degenerate) {
      aPlus = Math.min(aPlus, cThis.distA);
      ePlus = Math.max(ePlus, cThis.cornerA);
    }
    if (!cPrev.degenerate) {
      aMinus = Math.min(aMinus, cPrev.distB);
      eMinus = Math.max(eMinus, cPrev.cornerB);
    }
    const chord = clamp(Math.max(1.6, Math.min(aPlus, aMinus) - 0.15), 1.6, 60);
    mouth[i] = chord;
    const cap = clamp(apps[i].half * 2.2, 6, 34);
    extent[i] = clamp(Math.max(ePlus, eMinus, chord) + 1.2, 2.5, cap);
  }

  /* assemble the ring */
  const ring = [];
  const arcSegs = 10;
  for (let i = 0; i < n; i++) {
    const a = apps[i];
    const c = corners[i];
    ring.push({ p: add2(a.minusPt, mul2(a.outward, mouth[i])), crease: true, app: i, side: -1 });
    ring.push({ p: add2(a.plusPt, mul2(a.outward, mouth[i])), crease: true, app: i, side: +1 });
    if (c.degenerate) {
      const b = apps[(i + 1) % n];
      ring.push({ p: add2(b.minusPt, mul2(b.outward, mouth[(i + 1) % n])), crease: true, app: (i + 1) % n, side: -1, bridge: true });
    } else {
      const a1 = Math.atan2(c.T1.y - c.C.y, c.T1.x - c.C.x);
      const a2 = Math.atan2(c.T2.y - c.C.y, c.T2.x - c.C.x);
      let dA = a2 - a1;
      while (dA > Math.PI) dA -= Math.PI * 2;
      while (dA < -Math.PI) dA += Math.PI * 2;
      for (let k = 1; k <= arcSegs; k++) {
        const t = k / arcSegs;
        const ang = a1 + dA * t;
        ring.push({
          p: { x: c.C.x + Math.cos(ang) * c.rEff, y: c.C.y + Math.sin(ang) * c.rEff },
          crease: false, app: i, corner: true,
        });
      }
    }
  }

  return { ring, corners, mouth, extent };
}

/** Outward vertex normals for a dense ring (mitre averaged). */
function ringNormals(ring) {
  const n = ring.length;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const p = ring[(i - 1 + n) % n].p, c = ring[i].p, q = ring[(i + 1) % n].p;
    const e0 = norm2(sub2(c, p));
    const e1 = norm2(sub2(q, c));
    let n0 = { x: e0.y, y: -e0.x };
    let n1 = { x: e1.y, y: -e1.x };
    const bis = norm2(add2(n0, n1));
    const denom = clamp(dot2(bis, n1), 0.25, 1);
    out[i] = mul2(bis, 1 / denom);
  }
  return out;
}

/* ---------------------------------------------------------------- build --- */

/**
 * @param {Object} ctx { net, sink, propSink, sections, markings:boolean }
 */
export function buildJunction(node, net, sink, ctx = {}) {
  /** ribbons: Map<edgeId, Ribbon> — reuse the chunk builder's ribbons so
   *  junction markings don't rebuild a curve sample for every approach. */
  const apps = [];
  const cache = ctx.sections || new Map();
  for (const e of net.edgesAt(node.id)) {
    if (!e.visible) continue;
    const a = approach(net, e, node.id, cache);
    if (a) apps.push(a);
  }
  if (apps.length < 2) return null;
  apps.sort((p, q) => p.angle - q.angle);

  /* skip a straight continuation of identical cross-sections */
  if (apps.length === 2) {
    const dA = Math.abs(((apps[0].angle - apps[1].angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    if (dA < 0.05 && Math.abs(apps[0].width - apps[1].width) < 0.02) return null;
  }

  const jc = node.junction || {};
  if (jc.type === 'roundabout') return buildRoundabout(node, net, sink, apps, ctx);

  const maxHalf = Math.max(...apps.map((a) => a.half));
  const R = jc.radius && jc.radius > 0
    ? jc.radius
    : clamp(maxHalf * 0.85, 2.5, 20);

  const { ring, mouth, extent } = buildRing(apps, R, 0);
  if (ring.length < 3) return null;

  const y0 = node.y;
  const poly = ring.map((r) => r.p);

  /* --- running surface --- */
  const tris = triangulate(poly);
  const bk = sink.b('asphalt');
  const base = bk.n;
  const idxFrom = bk.idx.length;
  for (const r of ring) {
    bk.vert(r.p.x, y0, r.p.y, 0, 1, 0, r.p.x, r.p.y);
  }
  for (let i = 0; i < tris.length; i += 3) {
    bk.tri(base + tris[i], base + tris[i + 1], base + tris[i + 2]);
  }
  // triangulate() hands back a planar triangulation; force it skyward so the
  // patch is visible regardless of the ring's winding
  sink.orientUp(bk, idxFrom);
  sink._computeRangeNormals(bk, base, idxFrom);

  /* --- kerb + footway ring --- */
  const footwayW = Math.max(...apps.map((a) => a.sidewalkW));
  const kerbH = Math.max(...apps.map((a) => a.kerbH));
  const anyFootway = apps.some((a) => a.hasFootway) && footwayW > 0.2;
  if (anyFootway) {
    let cx = 0, cz = 0;
    for (const r of ring) { cx += r.p.x; cz += r.p.y; }
    buildFootwayRing(sink, ring, footwayW, kerbH, y0, cx / ring.length, cz / ring.length);
  }

  /* --- markings --- */
  if (ctx.markings !== false) {
    junctionMarkings(net, sink, apps, mouth, extent, ctx);
  }

  return { ring, mouth, extent, R };
}

/** Kerb face + footway strip swept outward from the junction ring. */
function buildFootwayRing(sink, ring, w, kerbH, y0, cx, cz) {
  const n = ring.length;
  const nrm = ringNormals(ring);
  const bk = sink.b('kerb');
  const bTop = bk.n;
  const idx0 = bk.idx.length;
  // top edge of kerb (inner, raised) and bottom (inner, at road level)
  for (let i = 0; i <= n; i++) {
    const r = ring[i % n];
    const s = i * 1.0;
    bk.vert(r.p.x, y0 + kerbH, r.p.y, 0, 1, 0, s, 0);
    bk.vert(r.p.x, y0, r.p.y, 0, 1, 0, s, kerbH);
  }
  for (let i = 0; i < n; i++) {
    const a = bTop + i * 2;
    bk.tri(a, a + 1, a + 3);
    bk.tri(a, a + 3, a + 2);
  }
  sink.orientRadial(bk, idx0, cx, cz, -1);   // kerb face looks back at the road
  sink._computeRangeNormals(bk, bTop, idx0);

  // footway top: from kerb top outward by w
  const b2 = sink.b('concrete');
  const b2base = b2.n;
  const idx1 = b2.idx.length;
  for (let i = 0; i <= n; i++) {
    const r = ring[i % n];
    const nn = nrm[i % n];
    const s = i * 1.0;
    b2.vert(r.p.x, y0 + kerbH, r.p.y, 0, 1, 0, s, 0);
    b2.vert(r.p.x + nn.x * w, y0 + kerbH, r.p.y + nn.y * w, 0, 1, 0, s, w);
  }
  for (let i = 0; i < n; i++) {
    const a = b2base + i * 2;
    b2.tri(a, a + 2, a + 1);
    b2.tri(a + 1, a + 2, a + 3);
  }
  sink.orientUp(b2, idx1);
  sink._computeRangeNormals(b2, b2base, idx1);

  // outer edge drop
  const b3 = sink.b('kerb');
  const b3base = b3.n;
  const idx2 = b3.idx.length;
  for (let i = 0; i <= n; i++) {
    const r = ring[i % n];
    const nn = nrm[i % n];
    const s = i * 1.0;
    b3.vert(r.p.x + nn.x * w, y0 + kerbH, r.p.y + nn.y * w, 0, 1, 0, s, 0);
    b3.vert(r.p.x + nn.x * w, y0 + kerbH - 0.14, r.p.y + nn.y * w, 0, 1, 0, s, 0.14);
  }
  for (let i = 0; i < n; i++) {
    const a = b3base + i * 2;
    b3.tri(a, a + 1, a + 3);
    b3.tri(a, a + 3, a + 2);
  }
  sink.orientRadial(b3, idx2, cx, cz, 1);    // outer edge drops away from the road
  sink._computeRangeNormals(b3, b3base, idx2);
}

/* ------------------------------------------------------------- markings --- */

function junctionMarkings(net, sink, apps, mouth, extent, ctx) {
  const n = apps.length;
  // rank approaches by importance (carriageway width x speed)
  const rank = apps.map((a) => {
    const cw = a.carriageway.l1 - a.carriageway.l0;
    return cw * (1 + a.speed / 120);
  });
  const top = Math.max(...rank);

  for (let i = 0; i < n; i++) {
    const a = apps[i];
    const edge = a.edge;
    const f = edge.featuresOf();
    if (f.markings === false) continue;
    const L = a.curve.length;
    const m = extent[i];
    // station measured in the edge's own coordinates
    const sMouth = a.atB ? L - m : m;
    const dirSign = a.atB ? -1 : 1;
    const cw = a.carriageway;
    const isMinor = rank[i] < top * 0.82;
    const ribbon = makeMiniRibbon(a, net, ctx.ribbons);

    /* stop / give-way control on the minor arm */
    if (isMinor) {
      const zebraC = sMouth + dirSign * 2.6;
      if (f.crossing !== false && a.hasFootway) {
        const z0 = Math.min(zebraC, zebraC + dirSign * 3.2);
        const z1 = Math.max(zebraC, zebraC + dirSign * 3.2);
        paintZebra(sink, ribbon, cw.l0, cw.l1, z0, z1, {});
      }
      if (f.control === 'stop') {
        const b = sMouth + dirSign * 0.6;
        paintStopBar(sink, ribbon, cw.l0 + 0.2, cw.l1 - 0.2, Math.min(b, b + dirSign * 0.45), { w: 0.45 });
      } else {
        const g = sMouth + dirSign * 6.4;
        paintGiveWay(sink, ribbon, cw.l0 + 0.25, cw.l1 - 0.25, Math.min(g, g + dirSign * 1.2), {});
      }
    }

    /* lane arrows on the approach */
    if (f.arrows !== false && n >= 2) {
      const lanes = a.lanes.filter((l) => l.traffic && ['driving', 'bus'].includes(l.k) && l.w > 1.2);
      const arrowS = sMouth + dirSign * (isMinor ? 12.5 : 19);
      for (let k = 0; k < lanes.length; k++) {
        const ln = lanes[k];
        const slot = pickArrow(k, lanes.length);
        const s = clamp(arrowS, 2, L - 2);
        paintSymbol(sink, ribbon, (ln.l0 + ln.l1) / 2, s, Math.min(1.4, ln.w * 0.5), 4.4, slot);
      }
    }
  }

  /* yellow box for signalised 4-arms */
  const jtype = net.nodes.get(apps[0].nodeId)?.junction?.type || 'auto';
  if (n >= 4 && (jtype === 'signal')) {
    // approximate: hatch the central square bounded by the mouth chords
    const box = [];
    for (let i = 0; i < n; i++) {
      const a = apps[i];
      const p = add2(a.plusPt, mul2(a.outward, mouth[i] * 1.05));
      box.push(p);
    }
    const area = Math.abs(polygonArea(box));
    if (area > 20 && area < 900) {
      const tris = triangulate(box);
      const bk = sink.b('paint_y');
      const b = bk.n;
      const idxB = bk.idx.length;
      for (const p of box) bk.vert(p.x, net.nodes.get(apps[0].nodeId).y + 0.012, p.y, 0, 1, 0, p.x, p.y);
      for (let i = 0; i < tris.length; i += 3) bk.tri(b + tris[i], b + tris[i + 1], b + tris[i + 2]);
      sink.orientUp(bk, idxB);
      sink._computeRangeNormals(bk, b, idxB);
    }
  }
}

function pickArrow(index, total) {
  if (total <= 1) return SYM.ARROW_F;
  if (total === 2) return index === 0 ? SYM.ARROW_L : SYM.ARROW_FR;
  if (total === 3) return [SYM.ARROW_L, SYM.ARROW_FL, SYM.ARROW_R][index] || SYM.ARROW_F;
  return [SYM.ARROW_L, SYM.ARROW_FL, SYM.ARROW_FR, SYM.ARROW_R][index] || SYM.ARROW_F;
}

/**
 * A Ribbon for one approach edge, built on demand so junction markings follow
 * the same camber/bank/hump surface as the road itself.
 */
function makeMiniRibbon(app, net, ribbons) {
  if (app._ribbon) return app._ribbon;
  if (ribbons && ribbons.has(app.edge.id)) {
    app._ribbon = ribbons.get(app.edge.id);
    return app._ribbon;
  }
  const edge = app.edge;
  const curve = app.curve;
  const bank = (edge.bankGain ?? 0) > 0
    ? (d) => clamp(-curve.curvature(d) * (edge.bankGain ?? 0) * 40, -(edge.maxBank ?? 0.08), edge.maxBank ?? 0.08)
    : () => 0;
  app._ribbon = new Ribbon({
    section: app.sec, curve, edge,
    elevation: makeElevation(edge, net),
    bump: () => 0,
    bank,
  });
  return app._ribbon;
}

/* ----------------------------------------------------------- roundabout --- */

function buildRoundabout(node, net, sink, apps, ctx) {
  const jc = node.junction || {};
  const width = jc.width ?? 7.5;
  const maxHalf = Math.max(...apps.map((a) => a.half));
  const Ro = jc.outer ?? (maxHalf * 0.9 + width + 4);
  const Ri = Math.max(2.5, Ro - width);
  const y = node.y;

  const N = 96;
  const outer = [];
  const inner = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    outer.push({ x: node.x + c * Ro, y: node.z + s * Ro });
    inner.push({ x: node.x + c * Ri, y: node.z + s * Ri });
  }

  /* circulatory carriageway */
  const bk = sink.b('asphalt');
  const b = bk.n;
  const iA = bk.idx.length;
  for (let i = 0; i <= N; i++) {
    const o = outer[i % N], inr = inner[i % N];
    bk.vert(o.x, y, o.y, 0, 1, 0, (i / N) * Ro * 2 * Math.PI, 0);
    bk.vert(inr.x, y, inr.y, 0, 1, 0, (i / N) * Ri * 2 * Math.PI, Ro - Ri);
  }
  for (let i = 0; i < N; i++) {
    const a = b + i * 2;
    bk.tri(a, a + 2, a + 1);
    bk.tri(a + 1, a + 2, a + 3);
  }
  sink.orientUp(bk, iA);
  sink._computeRangeNormals(bk, b, iA);

  /* central island: kerb ring + raised planted dome */
  const kerbH = 0.16;
  const kb = sink.b('kerb');
  const kb0 = kb.n;
  const iB = kb.idx.length;
  for (let i = 0; i <= N; i++) {
    const p = inner[i % N];
    kb.vert(p.x, y + kerbH, p.y, 0, 1, 0, i, 0);
    kb.vert(p.x, y, p.y, 0, 1, 0, i, kerbH);
  }
  for (let i = 0; i < N; i++) {
    const a = kb0 + i * 2;
    kb.tri(a, a + 1, a + 3);
    kb.tri(a, a + 3, a + 2);
  }
  sink.orientRadial(kb, iB, node.x, node.z, 1);   // island kerb faces the roadway
  sink._computeRangeNormals(kb, kb0, iB);

  const ib = sink.b('planting');
  const ib0 = ib.n;
  const iC = ib.idx.length;
  const centre = ib.vert(node.x, y + kerbH + 0.35, node.z, 0, 1, 0, 0.5, 0.5);
  for (let i = 0; i < N; i++) {
    const p = inner[i];
    ib.vert(p.x, y + kerbH, p.y, 0, 1, 0, p.x, p.y);
  }
  for (let i = 0; i < N; i++) {
    ib.tri(centre, ib0 + 1 + i, ib0 + 1 + ((i + 1) % N));
  }
  sink.orientUp(ib, iC);
  sink._computeRangeNormals(ib, ib0, iC);

  /* markings: broken line at the outer edge, solid at the island */
  const mb = sink.b('paint_w');
  const mb0 = mb.n;
  const iD = mb.idx.length;
  const midR = (Ro + Ri) / 2;
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    mb.vert(node.x + c * (Ri + 0.25), y + 0.01, node.z + s * (Ri + 0.25), 0, 1, 0, i, 0);
    mb.vert(node.x + c * (Ri + 0.4), y + 0.01, node.z + s * (Ri + 0.4), 0, 1, 0, i, 0.15);
  }
  for (let i = 0; i < N; i++) {
    const a = mb0 + i * 2;
    mb.tri(a, a + 2, a + 1);
    mb.tri(a + 1, a + 2, a + 3);
  }
  sink.orientUp(mb, iD);
  sink._computeRangeNormals(mb, mb0, iD);

  /* outer broken ring */
  const ob = sink.b('paint_w');
  const ob0 = ob.n;
  const iE = ob.idx.length;
  const dash = Math.PI * 2 / 48;
  for (let k = 0; k < 48; k++) {
    const a0 = k * (Math.PI * 2 / 48);
    const a1 = a0 + dash * 0.5;
    for (const [a, u] of [[a0, 0], [a1, 1]]) {
      ob.vert(node.x + Math.cos(a) * (Ro - 0.25), y + 0.01, node.z + Math.sin(a) * (Ro - 0.25), 0, 1, 0, u, 0);
      ob.vert(node.x + Math.cos(a) * (Ro - 0.4), y + 0.01, node.z + Math.sin(a) * (Ro - 0.4), 0, 1, 0, u, 0.15);
    }
    const a = ob0 + k * 4;
    ob.tri(a, a + 2, a + 1); ob.tri(a + 1, a + 2, a + 3);
  }
  sink.orientUp(ob, iE);
  sink._computeRangeNormals(ob, ob0, iE);

  return { roundabout: true, Ro, Ri };
}
