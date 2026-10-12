// ---------------------------------------------------------------------------
// TRACK — "NEO-KOWLOON SPINE"
//
// The racing line is generated as a heading profile over uniform arc-length
// steps (1 m), then Newton-solved on two smooth periodic basis functions until
// the integrated loop closes exactly (residual < 1e-6 m). Because the solver
// only bends headings and never rescales arc length, features anchored at a
// given s stay anchored. That is what lets hazards be placed pre-closure.
//
//   forward(yaw) = ( sin yaw , cos yaw )      right(yaw) = ( -cos yaw , sin yaw )
//   three.js: mesh.rotation.y = yaw  puts local +Z along forward()
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { clamp, smoothstep } from './config.js';
import { deckTexture, stripTexture, chevronTexture, glowTexture } from './textures.js';

// --- district colours used for deck tinting / HUD / minimap -----------------
export const ZONE_COLOR = {
  grid: 0x2f3b4a,
  zipper: 0x1d5f70,
  traffic: 0x4d6b1f,
  train: 0x6e2424,
  crane: 0x5c1f56,
  hairpin: 0x6a4a16,
  normal: 0x2a3340,
};

const LAYOUT = [
  // -- side 1 (heading 0°) -------------------------------------------------
  { t: 'straight', len: 100, tag: 'grid', hw: 34, zone: 'grid', vary: 30 },
  { t: 'straight', len: 220, tag: 'zipper', hw: 28, zone: 'zipper', vary: 55 },
  { t: 'arc', r: 75, deg: 60, dir: 'R', hw: 24, tag: 'cornerA' },
  // -- side 2 -------------------------------------------------------------
  { t: 'straight', len: 200, tag: 'traffic', hw: 30, zone: 'traffic', vary: 55 },
  { t: 'arc', r: 110, deg: 30, dir: 'R', hw: 24, tag: 'chicaneA2' },
  { t: 'arc', r: 110, deg: 30, dir: 'L', hw: 24, tag: 'chicaneB2' },
  { t: 'straight', len: 40, tag: 'linkA', hw: 24, vary: 30 },
  { t: 'arc', r: 120, deg: 60, dir: 'R', hw: 22, tag: 'cornerB' },
  // -- side 3 -------------------------------------------------------------
  { t: 'straight', len: 220, tag: 'train', hw: 24, zone: 'train', vary: 55 },
  { t: 'straight', len: 40, tag: 'linkB', hw: 24, vary: 25 },
  { t: 'arc', r: 85, deg: 60, dir: 'R', hw: 22, tag: 'cornerC' },
  // -- side 4 (crane yard / Y fork + T split) -----------------------------
  { t: 'straight', len: 140, tag: 'crane', hw: 30, zone: 'crane', vary: 40 },
  { t: 'straight', len: 130, tag: 'tsplit', hw: 26, zone: 'crane', vary: 35 },
  { t: 'arc', r: 62, deg: 60, dir: 'R', hw: 22, tag: 'cornerD' },
  // -- side 5 (second, faster zipper run) ---------------------------------
  { t: 'straight', len: 150, tag: 'zipper2', hw: 26, zone: 'zipper', vary: 35 },
  { t: 'straight', len: 90, tag: 'linkC', hw: 26, vary: 30 },
  { t: 'arc', r: 130, deg: 60, dir: 'R', hw: 22, tag: 'cornerE' },
  // -- side 6 (final drag) ------------------------------------------------
  { t: 'straight', len: 240, tag: 'final', hw: 30, zone: 'normal', vary: 55 },
  { t: 'arc', r: 95, deg: 60, dir: 'R', hw: 22, tag: 'cornerF' },
];

// Straights whose length may be tuned to close the loop. Corner radii and
// angles are never touched, so the designed geometry survives intact.
const TUNEABLE = ['grid', 'zipper', 'traffic', 'linkA', 'train', 'linkB', 'crane', 'tsplit', 'zipper2', 'linkC', 'final'];

const GROUND_Y = 0;
const SKIRT = 7.2;

// ---------------------------------------------------------------------------
// Deck — an indexed frame table (cyclic or open) with projection helpers.
// ---------------------------------------------------------------------------
export class Deck {
  constructor(n, ds, closed) {
    this.n = n; this.ds = ds; this.closed = closed;
    this.length = closed ? n * ds : (n - 1) * ds;
    this.x = new Float32Array(n); this.y = new Float32Array(n); this.z = new Float32Array(n);
    this.th = new Float32Array(n);            // heading (yaw)
    this.tx = new Float32Array(n); this.tz = new Float32Array(n);   // forward
    this.rx = new Float32Array(n); this.rz = new Float32Array(n);   // right
    this.hw = new Float32Array(n);
    this.tilt = new Float32Array(n);          // lateral rise per metre (banking)
    this.zone = new Array(n).fill('normal');
  }

  idx(s) {
    const n = this.n;
    if (this.closed) { let i = Math.floor(s / this.ds) % n; if (i < 0) i += n; return i; }
    return clamp(Math.floor(s / this.ds), 0, n - 1);
  }
  frac(s) {
    const i = this.idx(s);
    if (!this.closed && i >= this.n - 1) return 0;
    return (s / this.ds) - Math.floor(s / this.ds);
  }

  /** interpolated frame at arc length s */
  frame(s, out = {}) {
    const i = this.idx(s), j = this.closed ? (i + 1) % this.n : Math.min(this.n - 1, i + 1);
    const f = this.frac(s);
    out.i = i; out.x = this.x[i] + (this.x[j] - this.x[i]) * f;
    out.y = this.y[i] + (this.y[j] - this.y[i]) * f;
    out.z = this.z[i] + (this.z[j] - this.z[i]) * f;
    out.hw = this.hw[i] + (this.hw[j] - this.hw[i]) * f;
    out.tilt = this.tilt[i] + (this.tilt[j] - this.tilt[i]) * f;
    out.zone = this.zone[i];
    let a = this.th[i], b = this.th[j];
    if (b - a > Math.PI) b -= Math.PI * 2; else if (a - b > Math.PI) b += Math.PI * 2;
    out.th = a + (b - a) * f;
    out.tx = Math.sin(out.th); out.tz = Math.cos(out.th);
    out.rx = -Math.cos(out.th); out.rz = Math.sin(out.th);
    return out;
  }

  /** world position at (s, lateral offset e) on the deck surface. */
  posAt(s, e, out = new THREE.Vector3()) {
    const f = this.frame(s, this._f || (this._f = {}));
    out.set(f.x + f.rx * e, f.y + e * f.tilt, f.z + f.rz * e);
    return out;
  }

  /**
   * Project a world point onto the centreline. Windowed search from `from`,
   * so it is safe even where the track runs parallel to itself.
   */
  project(px, pz, from, window = 130, out = {}) {
    const n = this.n;
    let best = -1, bestD = Infinity;
    const start = from == null ? 0 : from - Math.floor(window * 0.35);
    const count = from == null ? n : window;
    for (let k = 0; k < count; k++) {
      let i = this.closed ? ((start + k) % n + n) % n : clamp(start + k, 0, n - 1);
      const dx = px - this.x[i], dz = pz - this.z[i];
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = i; }
    }
    if (best < 0) { out.s = 0; out.e = 0; out.i = 0; out.lat = 0; out.dist = Infinity; return out; }
    // refine: project onto the piecewise-linear centreline around the winner
    let bs = best * this.ds, bl = 0, bd = Infinity;
    for (let o = -1; o <= 0; o++) {
      const i = this.closed ? ((best + o) % n + n) % n : clamp(best + o, 0, n - 1);
      const j = this.closed ? (i + 1) % n : Math.min(n - 1, i + 1);
      const ax = this.x[i], az = this.z[i];
      const bx = this.x[j] - ax, bz = this.z[j] - az;
      const len2 = bx * bx + bz * bz;
      if (len2 < 1e-9) continue;
      let t = ((px - ax) * bx + (pz - az) * bz) / len2;
      t = clamp(t, 0, 1);
      const cx = ax + bx * t, cz = az + bz * t;
      const d = (px - cx) ** 2 + (pz - cz) ** 2;
      if (d < bd) { bd = d; bs = (i + t) * this.ds; bl = (px - cx) * this.rx[i] + (pz - cz) * this.rz[i]; }
    }
    out.s = bs; out.i = best; out.lat = bl;
    out.e = (px - this.x[best]) * this.rx[best] + (pz - this.z[best]) * this.rz[best];
    out.dist = Math.sqrt(bd);
    out.hw = this.hw[best];
    return out;
  }

  /** signed along-track distance a→b, shortest way round on a closed deck */
  delta(a, b) {
    let d = b - a;
    if (this.closed) { d = ((d % this.length) + this.length) % this.length; }
    return d;
  }
}

// ---------------------------------------------------------------------------
// closure solver
// ---------------------------------------------------------------------------
function closeLoop(theta, ds) {
  const n = theta.length;
  const TWO = Math.PI * 2;
  const disp = (c1, c2, out) => {
    let sx = 0, sz = 0;
    for (let i = 0; i < n; i++) {
      const t = theta[i] + c1 * Math.sin(TWO * i / n) + c2 * Math.cos(TWO * i / n);
      sx += Math.sin(t); sz += Math.cos(t);
    }
    out[0] = sx * ds; out[1] = sz * ds;
    return out;
  };
  const f = [0, 0], fp = [0, 0];
  let c1 = 0, c2 = 0;
  const h = 1e-4;
  for (let it = 0; it < 60; it++) {
    disp(c1, c2, f);
    if (Math.hypot(f[0], f[1]) < 1e-6) break;
    disp(c1 + h, c2, fp); const j11 = (fp[0] - f[0]) / h, j21 = (fp[1] - f[1]) / h;
    disp(c1, c2 + h, fp); const j12 = (fp[0] - f[0]) / h, j22 = (fp[1] - f[1]) / h;
    const det = j11 * j22 - j12 * j21;
    if (Math.abs(det) < 1e-12) break;
    const d1 = (-f[0] * j22 + f[1] * j12) / det;
    const d2 = (-f[1] * j11 + f[0] * j21) / det;
    c1 += clamp(d1, -0.4, 0.4); c2 += clamp(d2, -0.4, 0.4);
  }
  for (let i = 0; i < n; i++) theta[i] += c1 * Math.sin(TWO * i / n) + c2 * Math.cos(TWO * i / n);
  const res = disp(0, 0, [0, 0]);
  return { residual: Math.hypot(res[0], res[1]), corr: Math.hypot(c1, c2) };
}

function smooth(arr, passes = 2, win = 6) {
  const n = arr.length, tmp = new Float32Array(n);
  for (let p = 0; p < passes; p++) {
    for (let i = 0; i < n; i++) {
      let s = 0, c = 0;
      for (let k = -win; k <= win; k++) { const j = (i + k + n * 2) % n; s += arr[j]; c++; }
      tmp[i] = s / c;
    }
    arr.set(tmp);
  }
  return arr;
}

// ---------------------------------------------------------------------------
// Track
// ---------------------------------------------------------------------------
export class Track {
  constructor() {
    this.ds = 1.0;
    this.anchors = {};        // tag -> {s0, s1}
    this.deck = null;
    this.branches = {};
    this.group = new THREE.Group();
    this._v = new THREE.Vector3();
    this._f = {};
  }

  /** build the heading profile for a given set of straight-length overrides */
  _heads(lengths) {
    const ds = this.ds;
    const theta = [], meta = [], anchors = {};
    let heading = 0, s = 0;
    for (const seg of LAYOUT) {
      const len = seg.t === 'straight' ? (lengths[seg.tag] ?? seg.len)
        : (seg.deg * Math.PI / 180) * seg.r;
      const steps = Math.max(1, Math.round(len / ds));
      const sign = seg.dir === 'L' ? 1 : -1;    // +yaw turns left
      const sStart = s;
      for (let k = 0; k < steps; k++) {
        theta.push(heading);
        meta.push(seg);
        if (seg.t === 'arc') heading += sign * (seg.deg * Math.PI / 180) / steps;
        s += ds;
      }
      if (seg.tag) anchors[seg.tag] = { s0: sStart, s1: sStart + steps * ds, mid: sStart + steps * ds * 0.5 };
    }
    return { theta, meta, anchors };
  }

  /** net displacement of a heading profile — zero means a closed loop */
  static _disp(theta, ds) {
    let sx = 0, sz = 0;
    for (let i = 0; i < theta.length; i++) { sx += Math.sin(theta[i]); sz += Math.cos(theta[i]); }
    return [sx * ds, sz * ds];
  }

  /**
   * Close the circuit analytically.
   *
   * Corner radii and sweep angles are *design* — they set how the track feels —
   * so they are held fixed. That fixes the heading of every straight. Closure
   * then becomes a linear constraint on the straight lengths:
   *
   *      Σ  L_i · dir_i  =  0
   *
   * solved as a weighted least-squares "stay near the design" problem:
   *
   *      L = t − S Aᵀ (A S Aᵀ)⁻¹ A t ,   S = diag(σ²)
   *
   * with σ the per-straight budget (how many metres that straight may grow).
   * Exact closure, corner geometry untouched, and the result is a genuine
   * circuit rather than something a solver had to bend into shape.
   */
  _solveClosure() {
    const ds = this.ds;
    const base = {}, sigma = {}, dirs = {};
    let heading = 0;
    for (const seg of LAYOUT) {
      if (seg.t === 'straight') {
        base[seg.tag] = seg.len;
        sigma[seg.tag] = seg.vary ?? 45;
        dirs[seg.tag] = [Math.sin(heading), Math.cos(heading)];
      } else {
        heading += (seg.dir === 'L' ? 1 : -1) * seg.deg * Math.PI / 180;
      }
    }
    const tags = Object.keys(base);
    let at0 = 0, at1 = 0, m00 = 0, m01 = 0, m11 = 0;
    for (const tag of tags) {
      const d = dirs[tag], s2 = sigma[tag] * sigma[tag];
      at0 += d[0] * base[tag]; at1 += d[1] * base[tag];
      m00 += s2 * d[0] * d[0]; m01 += s2 * d[0] * d[1]; m11 += s2 * d[1] * d[1];
    }
    const det = m00 * m11 - m01 * m01;
    if (Math.abs(det) < 1e-9) return this._heads(base) && { theta: this._heads(base).theta, meta: this._heads(base).meta, anchors: this._heads(base).anchors, lengths: base, info: { note: 'degenerate' } };
    const l0 = (m11 * at0 - m01 * at1) / det;
    const l1 = (m00 * at1 - m01 * at0) / det;
    const lengths = {};
    const deltas = {};
    for (const tag of tags) {
      const d = dirs[tag], s2 = sigma[tag] * sigma[tag];
      lengths[tag] = base[tag] - s2 * (d[0] * l0 + d[1] * l1);
      deltas[tag] = lengths[tag] - base[tag];
    }

    // integrate: straight lengths are quantised to whole metres, remainder is
    // polished by the (now tiny) smooth heading basis
    const { theta, meta, anchors } = this._heads(lengths);
    const th = new Float32Array(theta);
    const polish = closeLoop(th, ds);
    for (let i = 0; i < th.length; i++) theta[i] = th[i];

    // report how much of the design's curvature the polish left behind
    let maxTilt = 0;
    const nn = theta.length;
    for (let i = 0; i < nn; i++) {
      const b = th[(i + 1) % nn] - th[(i - 1 + nn) % nn];
      maxTilt = Math.max(maxTilt, Math.abs(b));
    }
    let head = '';
    for (const tag of tags) head += `${tag}:${deltas[tag].toFixed(0)} `;
    return {
      theta, meta, anchors, lengths,
      info: {
        residual: polish.residual, polish: polish.corr,
        deltas, straightDeltas: head.trim(),
        maxAddedCurvature: maxTilt / (2 * ds),
      },
    };
  }

  /** @param {{meshes?:boolean}} opts */
  build(opts = {}) {
    const meshes = opts.meshes !== false;
    const ds = this.ds;

    // ---------- 1. heading profile — analytically closed ----------
    const solved = this._solveClosure();
    this.straightLengths = solved.lengths;
    const { theta, meta, anchors } = solved;
    this.anchors = anchors;
    const n = theta.length;
    const th = new Float32Array(n);
    th.set(theta);
    const info = { corr: solved.info.polish, residual: solved.info.residual, solve: solved.info };

    // ---------- 2. integrate positions ----------
    const deck = new Deck(n, ds, true);
    deck.theta = th;
    let x = 0, z = 0;
    for (let i = 0; i < n; i++) {
      deck.x[i] = x; deck.z[i] = z; deck.th[i] = th[i];
      deck.tx[i] = Math.sin(th[i]); deck.tz[i] = Math.cos(th[i]);
      deck.rx[i] = -Math.cos(th[i]); deck.rz[i] = Math.sin(th[i]);
      x += Math.sin(th[i]) * ds; z += Math.cos(th[i]) * ds;
    }
    const L = n * ds;
    deck.length = L;

    // recentre so the loop straddles the origin (city + camera framing)
    let cx = 0, cz = 0;
    for (let i = 0; i < n; i++) { cx += deck.x[i]; cz += deck.z[i]; }
    cx /= n; cz /= n;
    for (let i = 0; i < n; i++) { deck.x[i] -= cx; deck.z[i] -= cz; }

    // ---------- 3. elevation (periodic → closes exactly) ----------
    const k = Math.PI * 2 / L;
    for (let i = 0; i < n; i++) {
      const t = i * ds;
      deck.y[i] = 30
        + 6.5 * Math.sin(k * t)
        + 3.2 * Math.sin(2 * k * t + 1.7)
        + 1.8 * Math.sin(3 * k * t + 0.4)
        + 1.1 * Math.sin(5 * k * t + 2.9);
    }

    // ---------- 4. curvature → banking ----------
    const kappa = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = th[(i - 1 + n) % n], b = th[(i + 1) % n];
      let d = b - a;
      if (d > Math.PI) d -= Math.PI * 2; else if (d < -Math.PI) d += Math.PI * 2;
      kappa[i] = d / (2 * ds);
    }
    smooth(kappa, 3, 10);
    for (let i = 0; i < n; i++) deck.tilt[i] = clamp(-kappa[i] * 26, -0.36, 0.36);
    smooth(deck.tilt, 2, 8);

    // ---------- 5. width + zone per sample ----------
    const keys = [];
    for (const seg of LAYOUT) {
      const a = this.anchors[seg.tag];
      if (seg.hw && a) keys.push([a.s0, seg.hw], [a.s1, seg.hw]);
    }
    keys.sort((p, q) => p[0] - q[0]);
    for (let i = 0; i < n; i++) {
      const t = i * ds;
      let hw = keys.length ? keys[0][1] : 24;
      for (let j = 0; j < keys.length - 1; j++) {
        if (t >= keys[j][0] && t <= keys[j + 1][0]) {
          const f = smoothstep((t - keys[j][0]) / Math.max(1e-6, keys[j + 1][0] - keys[j][0]));
          hw = keys[j][1] + (keys[j + 1][1] - keys[j][1]) * f;
          break;
        }
        if (t > keys[keys.length - 1][0]) hw = keys[keys.length - 1][1];
      }
      deck.hw[i] = hw;
      deck.zone[i] = meta[i].zone || 'normal';
    }
    smooth(deck.hw, 2, 9);
    this.deck = deck;
    this.length = L;
    this.closure = info;
    this.zones = this._buildZones(meta);

    // ---------- 6. meshes ----------
    if (meshes) {
      this._buildDeckMesh();
      this._buildRails();
      this._buildPillars();
      this._buildStartGate();
      this._buildIslands();
    } else {
      this.startS = this.anchors.grid.s1 - 54;
      this.island = { s0: this.anchors.crane.s0 + 26, s1: this.anchors.crane.s1 - 26, halfWidth: 1.9 };
    }
    this.branches.high = this._buildHighLine(meshes);
    return this;
  }

  _buildZones(meta) {
    const out = [];
    let cur = null;
    for (let i = 0; i < meta.length; i++) {
      const z = meta[i].zone || 'normal';
      if (!cur || cur.zone !== z) {
        if (cur) out.push(cur);
        cur = { zone: z, s0: i * this.ds, s1: i * this.ds };
      }
      cur.s1 = (i + 1) * this.ds;
    }
    if (cur) out.push(cur);
    const named = {};
    for (const a of Object.keys(this.anchors)) named[a] = this.anchors[a];
    return { spans: out, named };
  }

  zoneAt(s) {
    const i = this.deck.idx(s);
    return this.deck.zone[i];
  }

  // --- deck surface + skirts -------------------------------------------------
  _buildDeckMesh() {
    const d = this.deck, n = d.n;
    const pos = new Float32Array(n * 2 * 3);
    const uv = new Float32Array(n * 2 * 2);
    const col = new Float32Array(n * 2 * 3);
    const skirtPos = new Float32Array(n * 4 * 3);
    const skirtCol = new Float32Array(n * 4 * 3);
    const tmpC = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const x = d.x[i], y = d.y[i], z = d.z[i], hw = d.hw[i], tilt = d.tilt[i];
      const rx = d.rx[i], rz = d.rz[i];
      const lx = x - rx * hw, lz = z - rz * hw, ly = y - hw * tilt;
      const rxp = x + rx * hw, rzp = z + rz * hw, ryp = y + hw * tilt;
      pos.set([lx, ly, lz], i * 6);
      pos.set([rxp, ryp, rzp], i * 6 + 3);
      uv.set([0, i * this.ds / 8], i * 4);
      uv.set([1, i * this.ds / 8], i * 4 + 2);
      tmpC.setHex(ZONE_COLOR[d.zone[i]] || 0x2a3340);
      const shade = 0.82 + 0.18 * Math.sin(i * 0.35);   // panel variety
      col.set([tmpC.r * shade, tmpC.g * shade, tmpC.b * shade], i * 6);
      col.set([tmpC.r * shade, tmpC.g * shade, tmpC.b * shade], i * 6 + 3);
      // skirts (vertical wall under each edge)
      skirtPos.set([lx, ly, lz], i * 12);
      skirtPos.set([lx, ly - SKIRT, lz], i * 12 + 3);
      skirtPos.set([rxp, ryp, rzp], i * 12 + 6);
      skirtPos.set([rxp, ryp - SKIRT, rzp], i * 12 + 9);
      const dark = 0.32;
      skirtCol.set([tmpC.r * dark, tmpC.g * dark, tmpC.b * dark], i * 12);
      skirtCol.set([0.03, 0.04, 0.06], i * 12 + 3);
      skirtCol.set([tmpC.r * dark, tmpC.g * dark, tmpC.b * dark], i * 12 + 6);
      skirtCol.set([0.03, 0.04, 0.06], i * 12 + 9);
    }
    const idx = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, a = i * 2, b = j * 2;
      idx.push(a, b, a + 1, a + 1, b, b + 1);         // +Y facing
    }
    const gTop = new THREE.BufferGeometry();
    gTop.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    gTop.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    gTop.setAttribute('color', new THREE.BufferAttribute(col, 3));
    gTop.setIndex(idx);
    gTop.computeVertexNormals();
    const deckMat = new THREE.MeshStandardMaterial({
      map: deckTexture(), vertexColors: true, roughness: 0.72, metalness: 0.22,
    });
    const top = new THREE.Mesh(gTop, deckMat);
    top.receiveShadow = true;
    this.group.add(top);
    this.deckMesh = top;

    // skirts — two separate ribbons so winding stays outward on both sides
    const buildSide = (left) => {
      const p = new Float32Array(n * 2 * 3), c = new Float32Array(n * 2 * 3);
      for (let i = 0; i < n; i++) {
        const hw = d.hw[i], tilt = d.tilt[i], sgn = left ? -1 : 1;
        const x = d.x[i] + sgn * d.rx[i] * hw, z = d.z[i] + sgn * d.rz[i] * hw;
        const y = d.y[i] + sgn * hw * tilt;
        p.set([x, y, z], i * 6); p.set([x, y - SKIRT, z], i * 6 + 3);
        const tcc = new THREE.Color(ZONE_COLOR[d.zone[i]] || 0x2a3340);
        c.set([tcc.r * 0.3, tcc.g * 0.3, tcc.b * 0.34], i * 6);
        c.set([0.02, 0.03, 0.05], i * 6 + 3);
      }
      const ii = [];
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n, a = i * 2, b = j * 2;
        if (left) ii.push(a, a + 1, b, a + 1, b + 1, b);
        else ii.push(a, b, a + 1, a + 1, b, b + 1);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(p, 3));
      g.setAttribute('color', new THREE.BufferAttribute(c, 3));
      g.setIndex(ii);
      g.computeVertexNormals();
      return new THREE.Mesh(g, new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.85, metalness: 0.35, side: THREE.DoubleSide,
      }));
    };
    this.group.add(buildSide(true), buildSide(false));
    void skirtPos; void skirtCol;
  }

  // --- glowing edge rails ----------------------------------------------------
  _buildRails() {
    const d = this.deck, n = d.n;
    const mk = (left) => {
      const p = new Float32Array(n * 2 * 3), uv = new Float32Array(n * 2 * 2), c = new Float32Array(n * 2 * 3);
      for (let i = 0; i < n; i++) {
        const hw = d.hw[i] + 0.55, tilt = d.tilt[i], sgn = left ? -1 : 1;
        const x = d.x[i] + sgn * d.rx[i] * hw, z = d.z[i] + sgn * d.rz[i] * hw;
        const y = d.y[i] + sgn * hw * tilt;
        p.set([x, y + 1.25, z], i * 6);
        p.set([x, y + 0.15, z], i * 6 + 3);
        uv.set([0, i * this.ds / 6], i * 4); uv.set([1, i * this.ds / 6], i * 4 + 2);
        const col = new THREE.Color(ZONE_COLOR[d.zone[i]] || 0x2a3340).offsetHSL(0, 0.35, 0.28);
        c.set([col.r, col.g, col.b], i * 6); c.set([col.r * 0.2, col.g * 0.2, col.b * 0.2], i * 6 + 3);
      }
      const ii = [];
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n, a = i * 2, b = j * 2;
        if (left) ii.push(a, b, a + 1, a + 1, b, b + 1);
        else ii.push(a, a + 1, b, a + 1, b + 1, b);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(p, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      g.setAttribute('color', new THREE.BufferAttribute(c, 3));
      g.setIndex(ii);
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
        map: stripTexture(), vertexColors: true, emissive: 0xffffff, emissiveIntensity: 0.55,
        emissiveMap: stripTexture(), transparent: true, roughness: 0.4, metalness: 0.1,
        side: THREE.DoubleSide, depthWrite: false,
      }));
      m.renderOrder = 1;
      return m;
    };
    this.group.add(mk(true), mk(false));
  }

  // --- support pillars down to the city floor --------------------------------
  _buildPillars() {
    const d = this.deck;
    const step = 26, count = Math.floor(d.length / step);
    const g = new THREE.BoxGeometry(6.5, 1, 6.5);
    const mat = new THREE.MeshStandardMaterial({ color: 0x1a2029, roughness: 0.9, metalness: 0.3 });
    const inst = new THREE.InstancedMesh(g, mat, count * 2);
    const m = new THREE.Matrix4();
    const v = new THREE.Vector3();
    let k = 0;
    for (let c = 0; c < count; c++) {
      const s = c * step;
      const f = d.frame(s, this._f);
      for (const side of [-1, 1]) {
        const e = side * (f.hw - 3.5);
        const px = f.x + f.rx * e + (this._v.set(0, 0, 0).x || 0);
        const pz = f.z + f.rz * e;
        const py = f.y + e * f.tilt;
        const h = Math.max(4, py - SKIRT - GROUND_Y);
        m.makeTranslation(px, py - SKIRT - h * 0.5, pz);
        m.scale(new THREE.Vector3(1, h, 1));
        inst.setMatrixAt(k++, m);
        void v;
      }
    }
    inst.count = k;
    inst.instanceMatrix.needsUpdate = true;
    inst.frustumCulled = false;
    this.group.add(inst);
  }

  _buildStartGate() {
    const deck = this.deck;
    const s = this.anchors.grid.s1 - 54;
    const f = deck.frame(s, this._f);
    const g = new THREE.Group();
    const hw = f.hw;
    const pillar = new THREE.BoxGeometry(1.6, 14, 1.6);
    const pm = new THREE.MeshStandardMaterial({ color: 0x223040, roughness: 0.6, metalness: 0.6 });
    for (const side of [-1, 1]) {
      const m = new THREE.Mesh(pillar, pm);
      m.position.set(f.x + f.rx * (hw - 1) * side, f.y + 7, f.z + f.rz * (hw - 1) * side);
      m.rotation.y = f.th;
      g.add(m);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.6, hw * 2 + 2), pm);
    beam.position.set(f.x, f.y + 12.4, f.z);
    beam.rotation.y = f.th;
    g.add(beam);
    const signMat = new THREE.MeshBasicMaterial({ map: chevronTexture('#ff3ec8'), color: 0xffffff });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(hw * 1.9, 1.9), signMat);
    sign.position.set(f.x, f.y + 12.4, f.z);
    sign.rotation.y = f.th + Math.PI / 2;
    sign.rotation.z = 0;
    sign.position.y += 0.0;
    // face the sign across the track
    sign.rotation.y = f.th + Math.PI / 2;
    g.add(sign);
    // deck start line
    const lineG = new THREE.PlaneGeometry(hw * 2, 3.4);
    const line = new THREE.Mesh(lineG, new THREE.MeshBasicMaterial({
      map: chevronTexture('#ffffff', '#0b1018'), color: 0xffffff, transparent: true, opacity: 0.9,
    }));
    line.position.set(f.x, f.y + 0.06, f.z);
    line.rotation.x = -Math.PI / 2;
    line.rotation.z = -f.th;
    g.add(line);
    this.group.add(g);
    this.startS = s;
    this.startFrame = { ...f };
  }

  // --- Y-fork islands (crane yard) ------------------------------------------
  _buildIslands() {
    const deck = this.deck;
    const A = this.anchors.crane;
    const y0 = A.s0 + 26, y1 = A.s1 - 26;
    const seg = Math.round((y1 - y0) / 4);
    const g = new THREE.BoxGeometry(3.4, 2.4, (y1 - y0) / seg + 0.6);
    const mat = new THREE.MeshStandardMaterial({ color: 0x2b2f3a, roughness: 0.7, metalness: 0.5 });
    const inst = new THREE.InstancedMesh(g, mat, seg);
    const m = new THREE.Matrix4();
    for (let i = 0; i < seg; i++) {
      const s = y0 + i * 4;
      const f = deck.frame(s, this._f);
      m.makeTranslation(f.x, f.y + 1.2, f.z);
      m.multiply(new THREE.Matrix4().makeRotationY(f.th));
      inst.setMatrixAt(i, m);
    }
    inst.instanceMatrix.needsUpdate = true;
    this.group.add(inst);
    this.island = { s0: y0, s1: y1, halfWidth: 1.9 };

    // warning chevrons painted on the deck either side of the fork throat
    for (const s of [A.s0 + 6, A.s0 + 16]) {
      const f = deck.frame(s, this._f);
      for (const side of [-1, 1]) {
        const q = new THREE.Mesh(new THREE.PlaneGeometry(12, 8), new THREE.MeshBasicMaterial({
          map: chevronTexture('#ff3ec2', '#101820'), transparent: true, opacity: 0.5,
        }));
        q.position.set(f.x + f.rx * side * 8, f.y + 0.07, f.z + f.rz * side * 8);
        q.rotation.x = -Math.PI / 2; q.rotation.z = -f.th;
        this.group.add(q);
      }
    }
  }

  /** Raised T-split lane that flies over the deck and merges back down. */
  _buildHighLine(withMeshes = true) {
    const deck = this.deck;
    const T = this.anchors.tsplit;
    const s0 = T.s0 + 14, s1 = T.s1 - 14;
    const len = s1 - s0;
    const step = 1.0, count = Math.floor(len / step) + 1;
    const br = new Deck(count, step, false);
    for (let i = 0; i < count; i++) {
      const t = i * step, u = t / len;
      const rise = Math.min(1, u / 0.32) * Math.min(1, (1 - u) / 0.32);
      const ease = smoothstep(clamp(rise, 0, 1));
      const s = s0 + t;
      const f = deck.frame(s, this._f);
      const lateral = -9.5 * ease;
      const h = 9.5 * ease;
      br.x[i] = f.x + f.rx * lateral; br.z[i] = f.z + f.rz * lateral; br.y[i] = f.y + h;
      br.th[i] = f.th; br.tx[i] = f.tx; br.tz[i] = f.tz; br.rx[i] = f.rx; br.rz[i] = f.rz;
      br.hw[i] = 12; br.tilt[i] = f.tilt * 0.4; br.zone[i] = 'crane';
    }
    br.s0World = s0; br.s1World = s1;

    if (withMeshes) {
      const n = count;
      const pos = new Float32Array(n * 2 * 3), uv = new Float32Array(n * 2 * 2);
      const col = new Float32Array(n * 2 * 3), wallP = new Float32Array(n * 4 * 3);
      const c1 = new THREE.Color(0x3a2140);
      for (let i = 0; i < n; i++) {
        const x = br.x[i], y = br.y[i], z = br.z[i], hw = br.hw[i];
        const lx = x - br.rx[i] * hw, lz = z - br.rz[i] * hw;
        const rxp = x + br.rx[i] * hw, rzp = z + br.rz[i] * hw;
        pos.set([lx, y, lz], i * 6); pos.set([rxp, y, rzp], i * 6 + 3);
        uv.set([0, i / 8], i * 4); uv.set([1, i / 8], i * 4 + 2);
        col.set([c1.r, c1.g, c1.b], i * 6); col.set([c1.r, c1.g, c1.b], i * 6 + 3);
        wallP.set([lx, y + 1.3, lz], i * 12); wallP.set([lx, y - 1.6, lz], i * 12 + 3);
        wallP.set([rxp, y + 1.3, rzp], i * 12 + 6); wallP.set([rxp, y - 1.6, rzp], i * 12 + 9);
      }
      const idx = [];
      for (let i = 0; i < n - 1; i++) {
        const a = i * 2, b = (i + 1) * 2;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.setIndex(idx); g.computeVertexNormals();
      const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
        map: chevronTexture('#ff3ec8', '#1a0f1e'), vertexColors: true, emissive: 0xff3ec8,
        emissiveIntensity: 0.13, roughness: 0.6, metalness: 0.3, side: THREE.DoubleSide,
      }));
      this.group.add(mesh);

      const widx = [];
      for (let i = 0; i < n - 1; i++) {
        const a = i * 4, b = (i + 1) * 4;
        widx.push(a, a + 1, b, a + 1, b + 1, b);             // left wall
        widx.push(a + 2, b + 2, a + 3, a + 3, b + 2, b + 3); // right wall
      }
      const wg = new THREE.BufferGeometry();
      wg.setAttribute('position', new THREE.BufferAttribute(wallP, 3));
      wg.setIndex(widx); wg.computeVertexNormals();
      const walls = new THREE.Mesh(wg, new THREE.MeshBasicMaterial({
        color: 0xff3ec8, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false,
      }));
      walls.renderOrder = 2;
      this.group.add(walls);

      // merge markers: where the high line meets the deck again
      for (const s of [s0, s1]) {
        const f = deck.frame(s, this._f);
        const q = new THREE.Mesh(new THREE.PlaneGeometry(30, 10), new THREE.MeshBasicMaterial({
          map: chevronTexture('#ffb42e', '#12100a'), transparent: true, opacity: 0.45,
        }));
        q.position.set(f.x, f.y + 0.07, f.z);
        q.rotation.x = -Math.PI / 2; q.rotation.z = -f.th;
        this.group.add(q);
      }
    }
    return br;
  }

  // --- queries --------------------------------------------------------------
  /** deck surface height at (s,e) for whichever deck is active */
  surfaceY(deck, s, e) {
    const f = deck.frame(s, this._f);
    return f.y + e * f.tilt;
  }

  /** convenience: world position of a lateral offset on the main deck */
  point(s, e, out) { return this.deck.posAt(s, e, out); }

  get startPositions() {
    const out = [];
    const d = this.deck;
    const base = this.startS - 26;
    const offs = [[-11, 0], [11, -14], [-11, -28], [11, -42]];
    for (let i = 0; i < 4; i++) {
      const [e, back] = offs[i];
      const s = base - back;
      const f = d.frame(s, this._f);
      out.push({
        x: f.x + f.rx * e, y: f.y + e * f.tilt + 0.6, z: f.z + f.rz * e,
        yaw: f.th, s, e,
      });
    }
    return out;
  }
}
