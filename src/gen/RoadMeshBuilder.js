/* ============================================================================
   RoadMeshBuilder — extrudes a compiled cross-section along an edge's curve.

   Design notes
   ------------
   * Stations are arc-length uniform and curvature-adaptive, so the chord
     error of every span stays under ~2 cm even on a 40 m radius hairpin.
   * Each strip is emitted as its own vertex grid. That duplication is what
     keeps kerb faces hard while the cambered carriageway shades smoothly.
   * Banking (superelevation) rolls the whole section about the centreline.
   * Everything is surfaced in metres of UV, so texel density is constant.
   ========================================================================== */

import * as THREE from 'three';
import { clamp, lerp } from '../core/mathx.js';
import { compileProfile, heightAt } from './CrossSection.js';

const UP = new THREE.Vector3(0, 1, 0);

/* --------------------------------------------------------------- Ribbon --- */

/**
 * Continuous world-space sampler over a road's drivable surface.
 * Markings, props and drainage all query this instead of re-deriving geometry.
 */
export class Ribbon {
  constructor({ section, curve, edge, elevation, terrain, bump, bank, taper }) {
    this.section = section;
    this.curve = curve;
    this.edge = edge;
    this.length = curve.length;
    this.s = curve.stations(edge._step ?? 4, { minStep: 0.5, maxStep: 40 });
    this.elevation = elevation || (() => 0); // (d) -> y   design elevation
    this.terrain = terrain || null;          // { height(x,z) } — drape override
    this.bump = bump;                        // (d) -> y offset on the carriageway
    this.bank = bank;                        // (d) -> radians
    this.taper = taper;                      // (d) -> 0..1 crown flatten factor
    this._cacheFrames();
  }

  _cacheFrames() {
    const S = this.s;
    this.px = new Float64Array(S.length);
    this.pz = new Float64Array(S.length);
    this.rx = new Float64Array(S.length);
    this.rz = new Float64Array(S.length);
    this.ev = new Float64Array(S.length);
    this.bk = new Float64Array(S.length);
    for (let i = 0; i < S.length; i++) {
      const d = S[i];
      const p = this.curve.pos(d, { x: 0, y: 0 });
      const t = this.curve.tangent(d, { x: 1, y: 0 });
      this.px[i] = p.x; this.pz[i] = p.y;
      this.rx[i] = -t.y; this.rz[i] = t.x;
      this.ev[i] = this.elevation(d);
      this.bk[i] = this.bank(d);
    }
  }

  _locate(d) {
    const S = this.s;
    if (d <= 0) return { i: 0, f: 0 };
    if (d >= this.length) return { i: S.length - 2, f: 1 };
    let lo = 0, hi = S.length - 1;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (S[mid] <= d) lo = mid; else hi = mid;
    }
    const span = S[lo + 1] - S[lo] || 1e-9;
    return { i: lo, f: clamp((d - S[lo]) / span, 0, 1) };
  }

  /** Height of a hump / table at station d, for carriageway offsets. */
  bumpAt(d) { return this.bump ? this.bump(d) : 0; }

  /** Crown flattening factor at d (1 = full camber, 0 = dead flat). */
  taperAt(d) { return this.taper ? this.taper(d) : 1; }

  /**
   * World position of the surface at (arc length d, lateral l).
   * The road drapes over the terrain: the ground height is sampled at the
   * final XZ position, then the cross-section height is added on top.
   * @param {THREE.Vector3} out
   */
  point(d, l, out = new THREE.Vector3()) {
    const { i, f } = this._locate(d);
    const j = i + 1;
    const px = lerp(this.px[i], this.px[j], f);
    const pz = lerp(this.pz[i], this.pz[j], f);
    const rx = lerp(this.rx[i], this.rx[j], f);
    const rz = lerp(this.rz[i], this.rz[j], f);
    const bk = lerp(this.bk[i], this.bk[j], f);
    const ev = lerp(this.ev[i], this.ev[j], f);

    const tp = this.taperAt(d);
    let h = heightAt(this.section, l) * tp;
    // humps only lift the running surface, not the footway
    const inCw = l >= this.section.carriageway.l0 - 0.01 && l <= this.section.carriageway.l1 + 0.01;
    if (inCw) h += this.bumpAt(d) * tp;

    const c = Math.cos(bk), s = Math.sin(bk);
    const l2 = l * c - h * s;
    const h2 = l * s + h * c;
    const x = px + rx * l2, z = pz + rz * l2;
    const gy = this.terrain ? this.terrain.height(x, z) : ev;
    out.set(x, gy + h2, z);
    return out;
  }

  /** Surface normal at (d, l) — central differences, robust to camber + bank. */
  normal(d, l, out = new THREE.Vector3()) {
    const a = this.point(d, l - 0.06, new THREE.Vector3());
    const b = this.point(d, l + 0.06, new THREE.Vector3());
    const c = this.point(Math.max(0, d - 0.6), l, new THREE.Vector3());
    const e = this.point(Math.min(this.length, d + 0.6), l, new THREE.Vector3());
    const du = b.sub(a);
    const dv = e.sub(c);
    out.copy(du).cross(dv);
    if (out.lengthSq() < 1e-12) out.set(0, 1, 0); else out.normalize();
    return out;
  }

  /** Forward unit vector at d. */
  forward(d, out = new THREE.Vector3()) {
    const t = this.curve.tangent(clamp(d, 0, this.length), { x: 1, y: 0 });
    return out.set(t.x, 0, t.y);
  }

  /** Right (lateral +) unit vector at d. */
  right(d, out = new THREE.Vector3()) {
    const t = this.curve.tangent(clamp(d, 0, this.length), { x: 1, y: 0 });
    return out.set(-t.y, 0, t.x);
  }

  curvature(d) { return this.curve.curvature(clamp(d, 0, this.length)); }
}

/* ---------------------------------------------------- elevation / humps --- */

/** Linear elevation ramp between the edge's two end nodes. */
export function makeElevation(edge, net) {
  const A = net.nodes.get(edge.a), B = net.nodes.get(edge.b);
  const ya = A ? A.y : 0, yb = B ? B.y : 0;
  const L = edge.length(net) || 1;
  return (d) => lerp(ya, yb, clamp(d / L, 0, 1));
}

/**
 * Traffic-calming vertical profile: sinusoidal humps, flat-top tables, or
 * speed cushions (which leave a gap for wide vehicle axles).
 */
export function makeBump(edge, net) {
  const f = edge.featuresOf();
  const h = f.humps;
  if (!h || !h.on) return () => 0;
  const spacing = h.spacing ?? 60;
  const len = h.length ?? (h.type === 'table' ? 7.0 : 3.7);
  const height = h.height ?? (h.type === 'table' ? 0.10 : 0.075);
  const type = h.type || 'hump';
  const start = h.start ?? spacing * 0.5;
  return (d) => {
    const u = (d - start) / spacing;
    if (u < 0) return 0;
    const phase = u - Math.floor(u);
    const along = phase * spacing;
    if (along > len) return 0;
    const x = along / len;
    if (type === 'table') {
      // ramp / flat / ramp
      const r = 0.28;
      if (x < r) return height * smooth01(x / r);
      if (x > 1 - r) return height * smooth01((1 - x) / r);
      return height;
    }
    // sinusoidal hump (Watts profile-ish)
    return height * 0.5 * (1 - Math.cos(x * Math.PI * 2));
  };
}

const smooth01 = (t) => t * t * (3 - 2 * t);

/** Superelevation: roll the section so the outside of the curve rises. */
export function makeBank(edge, net) {
  const gain = edge.bankGain ?? 0;
  const maxBank = edge.maxBank ?? 0.08;
  const c = edge.curve(net);
  if (!c || gain <= 0) return () => 0;
  const scale = gain * 40;
  return (d) => clamp(-c.curvature(d) * scale, -maxBank, maxBank);
}

/* ---------------------------------------------------------------- build --- */

/**
 * Build all strip geometry for one edge.
 * @param {MeshSink} sink
 * @param {Object} ctx { net, detail, skirt, bumpMask }
 */
export function buildRoadSurface(edge, net, sink, ctx = {}) {
  const curve = edge.curve(net);
  if (!curve || curve.length < 0.5) return null;

  edge._step = ctx.step ?? 4.0;
  const bands = edge.bandsOf();
  const section = compileProfile(bands, { camber: edge.camber ?? 0.025 });
  const mergeStart = ctx.mergeStart ?? 0;
  const mergeEnd = ctx.mergeEnd ?? 0;
  const taper = (mergeStart > 0.1 || mergeEnd > 0.1)
    ? (d) => {
      const a = mergeStart > 0.1 ? smooth01(clamp(d / mergeStart, 0, 1)) : 1;
      const b = mergeEnd > 0.1 ? smooth01(clamp((curve.length - d) / mergeEnd, 0, 1)) : 1;
      return Math.min(a, b);
    }
    : null;

  const ribbon = new Ribbon({
    section, curve, edge,
    elevation: makeElevation(edge, net),
    terrain: ctx.terrain || null,
    bump: makeBump(edge, net),
    bank: makeBank(edge, net),
    taper,
  });

  const S = ribbon.s;
  const nn = section.nodes.length;
  const closed = !!edge.closed;

  /* --- ring cache: world position of every section node at every station --- */
  const ring = new Float64Array(S.length * nn * 3);
  const cw = section.carriageway;
  for (let i = 0; i < S.length; i++) {
    const d = S[i];
    const px = ribbon.px[i], pz = ribbon.pz[i];
    const rx = ribbon.rx[i], rz = ribbon.rz[i];
    const ev = ribbon.ev[i], bk = ribbon.bk[i];
    const c = Math.cos(bk), sn = Math.sin(bk);
    const bmp = ribbon.bumpAt(d);
    const tp = taper ? taper(d) : 1;
    for (let n = 0; n < nn; n++) {
      const nd = section.nodes[n];
      let h = nd.h * tp;
      if (nd.l >= cw.l0 - 0.01 && nd.l <= cw.l1 + 0.01) h += bmp * tp;
      const l2 = nd.l * c - h * sn;
      const h2 = nd.l * sn + h * c;
      const x = px + rx * l2, z = pz + rz * l2;
      const gy = ribbon.terrain ? ribbon.terrain.height(x, z) : ev;
      const o = (i * nn + n) * 3;
      ring[o] = x;
      ring[o + 1] = gy + h2;
      ring[o + 2] = z;
    }
  }

  const rowCount = closed ? S.length : S.length; // wrap handled below
  const lastRow = closed ? S.length : S.length - 1;

  /* --- emit each strip as a vertex grid --- */
  for (const st of section.strips) {
    const cols = st.nodes.length;
    if (cols < 2) continue;
    const surface = st.band?.s || st.surface;
    const key = st.surface || surface;

    // cumulative arc length along the section polyline -> u coordinate
    const us = new Float64Array(cols);
    let acc = 0;
    for (let c = 0; c < cols; c++) {
      if (c > 0) {
        const a = section.nodes[st.nodes[c - 1]], b = section.nodes[st.nodes[c]];
        acc += Math.hypot(b.l - a.l, b.h - a.h);
      }
      us[c] = acc;
    }

    const bk = sink.b(key);
    const base = bk.n;
    const idxFrom = bk.idx.length;
    const vPerRow = cols;

    for (let i = 0; i <= lastRow; i++) {
      const si = i % S.length;
      const v = S[si];
      for (let c = 0; c < cols; c++) {
        const o = (si * nn + st.nodes[c]) * 3;
        bk.vert(ring[o], ring[o + 1], ring[o + 2], 0, 1, 0, us[c], v);
      }
    }

    for (let i = 0; i < lastRow; i++) {
      const r0 = base + (i % S.length) * vPerRow;
      const r1 = base + ((i + 1) % S.length) * vPerRow;
      for (let c = 0; c < cols - 1; c++) {
        bk.tri(r0 + c, r0 + c + 1, r1 + c + 1);
        bk.tri(r0 + c, r1 + c + 1, r1 + c);
      }
    }
    if (!st.vertical) sink.orientUp(bk, idxFrom);
    sink._computeRangeNormals(bk, base, idxFrom);
  }

  /* --- slab edge skirts: close the outer profile with a shallow face --- */
  const f = edge.featuresOf();
  const deck = (edge.bridge || f.bridge) ? (f.deckThickness ?? 1.4) : (ctx.skirt ?? 0.22);
  if (!closed && deck > 0.01) {
    buildSkirt(sink, section, ring, S.length, nn, deck, 'kerb', st0(section));
  }

  /* --- structures --- */
  if (edge.bridge || f.bridge) buildBridge(edge, net, sink, ribbon, section, ring, S, nn, f);
  if (edge.tunnel || f.tunnel) buildTunnel(edge, net, sink, ribbon, section, f);
  if (f.tunnels || section.lanes.some((l) => l.k === 'rail')) {
    // subway trench cover handled by the metro builder
  }

  return { ribbon, section, ring, stations: S, nodeCount: nn };
}

function st0(section) { return section.strips[0]?.surface || 'asphalt'; }

/** Vertical skirt along both outer edges of the section. */
function buildSkirt(sink, section, ring, rows, nn, depth, matKey, fallback) {
  const nLast = nn - 1;
  for (const n of [0, nLast]) {
    const bk = sink.b(matKey);
    const base = bk.n;
    const idxFrom = bk.idx.length;
    let run = 0;
    for (let i = 0; i < rows; i++) {
      const o = (i * nn + n) * 3;
      const x = ring[o], y = ring[o + 1], z = ring[o + 2];
      if (i > 0) {
        const op = ((i - 1) * nn + n) * 3;
        run += Math.hypot(x - ring[op], z - ring[op + 2]);
      }
      bk.vert(x, y, z, 0, 1, 0, 0, run);
      bk.vert(x, y - depth, z, 0, 1, 0, depth, run);
    }
    for (let i = 0; i < rows - 1; i++) {
      const a = base + i * 2;
      const b = a + 1, c = a + 2, d = a + 3;
      bk.tri(a, b, d);
      bk.tri(a, d, c);
    }
    sink._computeRangeNormals(bk, base, idxFrom);
  }
}

/* -------------------------------------------------------------- bridge --- */

function buildBridge(edge, net, sink, ribbon, section, ring, S, nn, f) {
  const deckT = f.deckThickness ?? 1.4;
  const rows = S.length;
  const nLast = nn - 1;

  /* underside slab */
  const bk = sink.b('concrete_brushed');
  const base = bk.n;
  const idxFrom = bk.idx.length;
  for (let i = 0; i < rows; i++) {
    const oL = (i * nn + 0) * 3;
    const oR = (i * nn + nLast) * 3;
    const xL = ring[oL], yL = ring[oL + 1], zL = ring[oL + 2];
    const xR = ring[oR], yR = ring[oR + 1], zR = ring[oR + 2];
    const s = S[i];
    const yb = Math.min(yL, yR) - deckT;
    bk.vert(xL, yb, zL, 0, -1, 0, 0, s);
    bk.vert(xR, yb, zR, 0, -1, 0, Math.hypot(xR - xL, zR - zL), s);
  }
  for (let i = 0; i < rows - 1; i++) {
    const a = base + i * 2;
    bk.tri(a, a + 1, a + 2);
    bk.tri(a + 1, a + 3, a + 2);
  }
  sink._computeRangeNormals(bk, base, idxFrom);

  /* piers + pile caps */
  const spacing = edge.bridge?.spacing ?? f.piers?.spacing ?? 30;
  const groundY = f.groundY ?? 0;
  const L = ribbon.length;
  const n = Math.max(0, Math.floor(L / spacing));
  for (let k = 1; k <= n; k++) {
    const d = (L / (n + 1)) * k;
    const p = ribbon.point(d, 0, new THREE.Vector3());
    const r = ribbon.right(d, new THREE.Vector3());
    const w = section.width * 0.62;
    const yTop = p.y - deckT;
    const yBot = Math.min(yTop - 1.0, groundY);
    if (yTop - yBot < 0.6) continue;
    boxBetween(sink, 'concrete_brushed',
      new THREE.Vector3(p.x - r.x * w * 0.5, yTop, p.z - r.z * w * 0.5),
      new THREE.Vector3(p.x + r.x * w * 0.5, yBot, p.z + r.z * w * 0.5),
      2.2, 1);
    // pier cap
    boxBetween(sink, 'concrete_brushed',
      new THREE.Vector3(p.x - r.x * w * 0.62, yTop, p.z - r.z * w * 0.62),
      new THREE.Vector3(p.x + r.x * w * 0.62, yTop - 0.7, p.z + r.z * w * 0.62),
      3.0, 1);
  }

  /* expansion joints at both abutments */
  for (const d of [0.35, L - 0.35]) {
    const w = section.width * 0.5;
    jointStrip(sink, ribbon, d, w, 0.5);
  }
}

function jointStrip(sink, ribbon, d, halfW, width) {
  const A = ribbon.point(d - width / 2, -halfW, new THREE.Vector3());
  const B = ribbon.point(d - width / 2, halfW, new THREE.Vector3());
  const C = ribbon.point(d + width / 2, halfW, new THREE.Vector3());
  const D = ribbon.point(d + width / 2, -halfW, new THREE.Vector3());
  for (const p of [A, B, C, D]) p.y += 0.004;
  sink.flatQuad('rubber', A, B, C, D, 1, 1, 0, 0, false);
}

/* -------------------------------------------------------------- tunnel --- */

function buildTunnel(edge, net, sink, ribbon, section, f) {
  const h = f.tunnelHeight ?? 5.6;
  const L = ribbon.length;
  const step = Math.max(1.6, (edge._step ?? 4) * 0.5);
  const n = Math.max(2, Math.ceil(L / step));
  const halfW = section.width * 0.5 - 0.6;
  const wall = f.wallSurface || 'tile';

  const prof = [];
  const segs = 12;
  // rectangular tube with a rounded top corner (simplified bore)
  const r = Math.min(1.8, h * 0.3);
  const pts = [
    [-halfW, 0.05], [-halfW, h - r],
  ];
  for (let i = 0; i <= segs; i++) {
    const a = -Math.PI / 2 + (i / segs) * Math.PI;
    pts.push([-halfW + r + r * Math.cos(a) * 0 + (i / segs) * (halfW * 2 - 2 * r), h - r + r * Math.sin(a)]);
  }
  pts.push([halfW, h - r], [halfW, 0.05]);

  const frames = [];
  for (let i = 0; i <= n; i++) {
    const d = (L * i) / n;
    const o = ribbon.point(d, 0, new THREE.Vector3());
    const fwd = ribbon.forward(d, new THREE.Vector3());
    const rt = ribbon.right(d, new THREE.Vector3());
    frames.push({ o, r: rt, u: new THREE.Vector3(0, 1, 0), f: fwd, s: d });
  }
  // inner surface (flip by reversing profile order)
  sink.extrude(wall, pts.slice().reverse().map(([x, y]) => ({ x, y })), frames, { uvScale: 1, facing: 'in' });

  /* portal headwalls */
  for (const [d, sign] of [[0.1, -1], [L - 0.1, 1]]) {
    const o = ribbon.point(d, 0, new THREE.Vector3());
    const rt = ribbon.right(d, new THREE.Vector3());
    const fw = ribbon.forward(d, new THREE.Vector3());
    const face = [];
    for (const [x, y] of pts) face.push({ x, y });
    face.push({ x: halfW + 1.4, y: -0.5 });
    face.push({ x: -halfW - 1.4, y: -0.5 });
    const fr = [
      { o: o.clone().addScaledVector(fw, sign * 0.0), r: rt.clone(), u: UP.clone(), s: d },
      { o: o.clone().addScaledVector(fw, sign * 0.9), r: rt.clone(), u: UP.clone(), s: d },
    ];
    sink.extrude('concrete_brushed', face, fr, { uvScale: 1, caps: true, facing: 'out' });
  }
}

/* ---------------------------------------------------------------- utils --- */

/** Axis-oriented box spanning two corner points with a given width along `r`. */
export function boxBetween(sink, key, a, b, width, _pad = 1) {
  // a and b are diagonally opposite corners of the box footprint in XZ;
  // vertical extent is a.y .. b.y
  const yTop = Math.max(a.y, b.y), yBot = Math.min(a.y, b.y);
  const cx = (a.x + b.x) / 2, cz = (a.z + b.z) / 2;
  const dx = b.x - a.x, dz = b.z - a.z;
  const l = Math.hypot(dx, dz);
  const ux = l > 1e-6 ? dx / l : 1, uz = l > 1e-6 ? dz / l : 0;
  const w = width / 2;
  const px = -uz * w, pz = ux * w;
  const P = [
    [cx - ux * l / 2 + px, cz - uz * l / 2 + pz],
    [cx + ux * l / 2 + px, cz + uz * l / 2 + pz],
    [cx + ux * l / 2 - px, cz + uz * l / 2 - pz],
    [cx - ux * l / 2 - px, cz - uz * l / 2 - pz],
  ];
  const bk = sink.b(key);
  const base = bk.n;
  const idxFrom = bk.idx.length;
  const H = yTop - yBot;
  // 4 side faces + top + bottom
  const ring = P.map(([x, z]) => [x, z]);
  for (const [x, z] of ring) {
    bk.vert(x, yBot, z, 0, 0, 1, 0, 0);
    bk.vert(x, yTop, z, 0, 0, 1, 0, H);
  }
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    const a0 = base + i * 2, a1 = base + i * 2 + 1;
    const b0 = base + j * 2, b1 = base + j * 2 + 1;
    bk.tri(a0, a1, b1);
    bk.tri(a0, b1, b0);
  }
  // top
  const t0 = bk.vert(ring[0][0], yTop, ring[0][1], 0, 1, 0, 0, 0);
  const t1 = bk.vert(ring[1][0], yTop, ring[1][1], 0, 1, 0, l, 0);
  const t2 = bk.vert(ring[2][0], yTop, ring[2][1], 0, 1, 0, l, w * 2);
  const t3 = bk.vert(ring[3][0], yTop, ring[3][1], 0, 1, 0, 0, w * 2);
  bk.tri(t0, t1, t2); bk.tri(t0, t2, t3);
  sink._computeRangeNormals(bk, base, idxFrom);
}
