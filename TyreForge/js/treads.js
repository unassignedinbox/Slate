/* ============================================================================
 * TyreForge — treads.js
 * Procedural tread-pattern engine.
 *
 * A tread is described as a list of geometric "primitives" (grooves, sipes,
 * chevrons, circles, hexagons, ...) authored in TILE space:
 *   x ∈ [0,1] → along the circumference (one pitch of the pattern)
 *   y ∈ [0,1] → across the tread width (0 = left shoulder, 1 = right)
 * The primitives are rasterized into a scalar height-field  (1.0 = brand-new
 * rubber surface, 0.0 = bottom of the deepest groove), which the 3D layer
 * turns into displacement + normal + albedo + roughness maps.
 * ========================================================================== */

'use strict';

/* --------------------------------------------------------------------------
 * TreadField — Float32 height-field with wrapped rasterisation helpers
 * ------------------------------------------------------------------------ */
export class TreadField {
  constructor(w = 1024, h = 512) {
    this.w = w;
    this.h = h;
    this.data = new Float32Array(w * h).fill(1);
    /* Albedo / roughness overlay – written by ops that add markings rather
     * than geometry (e.g. stud pockets, painted tread paint lines).        */
    this.studs = [];
  }

  reset() { this.data.fill(1); this.studs.length = 0; }

  idx(x, y) { return y * this.w + x; }

  /* distance (px) from point to segment */
  static segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const L2 = dx * dx + dy * dy;
    let t = L2 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx, cy = ay + t * dy;
    return Math.hypot(px - cx, py - cy);
  }

  /* Apply a cut where `distFn(px,py)` returns distance to the cut centre-line.
   * Pixels closer than halfW are cut to (1-depth), feathered at the lip.
   * Optional bbox {x0,x1,y0,y1} (px, may wrap) limits the scan window.       */
  cutByDistance(distFn, halfW, depth, feather = null, bbox = null) {
    feather = feather == null ? Math.max(1.2, halfW * 0.35) : feather;
    const { w, h, data } = this;
    let y0 = 0, y1 = h - 1, x0 = 0, x1 = w - 1;
    if (bbox) {
      y0 = Math.max(0, Math.floor(bbox.y0)); y1 = Math.min(h - 1, Math.ceil(bbox.y1));
      x0 = Math.floor(bbox.x0); x1 = Math.ceil(bbox.x1);
      if (x1 - x0 >= w) { x0 = 0; x1 = w - 1; }
    }
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = distFn(x, y);
        if (d > halfW + feather) continue;
        const t = Math.max(0, Math.min(1, (halfW + feather - d) / feather));
        const s = t * t * (3 - 2 * t);                     // smooth lip
        const val = 1 - depth * s;
        const wx = ((x % w) + w) % w;
        const i = y * w + wx;
        if (val < data[i]) data[i] = val;
      }
    }
  }

  /** Cut a polyline (wrap-aware in x). pts: [[x,y]...] in NORMALISED units. */
  cutPath(pts, widthFrac, depth, closed = false) {
    const { w, h } = this;
    const halfW = widthFrac * h * 0.5;                 // widths given vs tread width
    const P = pts.map(p => [p[0] * w, p[1] * h]);
    const segs = [];
    for (let i = 0; i < P.length - 1; i++) segs.push([P[i], P[i + 1]]);
    if (closed && P.length > 2) segs.push([P[P.length - 1], P[0]]);
    const pad = halfW + Math.max(2, halfW * 0.5) + 2;
    let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
    for (const p of P) {
      bx0 = Math.min(bx0, p[0]); bx1 = Math.max(bx1, p[0]);
      by0 = Math.min(by0, p[1]); by1 = Math.max(by1, p[1]);
    }
    /* raw bbox may go negative / beyond w — storage wraps, distances use
     * the wrapped segment copies, so it stays correct.                       */
    const bbox = { x0: bx0 - pad, x1: bx1 + pad, y0: by0 - pad, y1: by1 + pad };
    this.cutByDistance((x, y) => {
      let d = Infinity;
      for (const [a, b] of segs) {
        for (const ox of [-w, 0, w]) {
          const dd = TreadField.segDist(x, y, a[0] + ox, a[1], b[0] + ox, b[1]);
          if (dd < d) d = dd;
        }
      }
      return d;
    }, halfW, depth, null, bbox);
  }

  /** Circular groove  (fill=false) or circular pocket (fill=true). */
  cutCircle(cx, cy, radius, thickness, depth, fill = false) {
    const { w, h } = this;
    const R = radius * h, T = thickness * h * 0.5;
    const px = cx * w, py = cy * h;
    const reach = (fill ? R : R + T) + 4;
    this.cutByDistance((x, y) => {
      let d = Infinity;
      for (const ox of [-w, 0, w]) {
        const dd = Math.hypot(x - (px + ox), y - py);
        d = Math.min(d, fill ? dd : Math.abs(dd - R));
      }
      return d;
    }, fill ? R : T, depth, fill ? Math.max(1.5, R * 0.08) : null,
    { x0: px - reach, x1: px + reach, y0: py - reach, y1: py + reach });
  }

  /** Signed distance to a regular hexagon centred at (0,0) in px space. */
  static hexSD(px, py, rpx) {
    let d = Infinity;
    for (let i = 0; i < 6; i++) {
      const a1 = i * Math.PI / 3, a2 = (i + 1) * Math.PI / 3;
      const ax = rpx * Math.cos(a1), ay = rpx * Math.sin(a1);
      const bx = rpx * Math.cos(a2), by = rpx * Math.sin(a2);
      d = Math.min(d, TreadField.segDist(px, py, ax, ay, bx, by));
    }
    const ang = Math.atan2(py, px);
    const inside = Math.hypot(px, py) * Math.cos(((ang % (Math.PI / 3)) + Math.PI / 3) % (Math.PI / 3) - Math.PI / 6) < rpx * 0.866025404;
    return inside ? -d : d;
  }

  /** Hexagonal groove outline or filled pocket. radius in width-fractions. */
  cutHex(cx, cy, radius, rotRad, thickness, depth, fill = false) {
    const { w, h } = this;
    if (fill) {
      const rpx = radius * h;
      const ca = Math.cos(rotRad), sa = Math.sin(rotRad);
      const px0 = cx * w, py0 = cy * h;
      const reach = rpx + 6;
      this.cutByDistance((x, y) => {
        let d = Infinity;
        for (const ox of [-w, 0, w]) {
          const lx = (x - (px0 + ox)) * ca + (y - py0) * sa;
          const ly = -(x - (px0 + ox)) * sa + (y - py0) * ca;
          const sd = TreadField.hexSD(lx, ly, rpx);
          if (sd < d) d = sd;
        }
        return d /* negative inside → always < 0.5 → cut */;
      }, 0.5, depth, Math.max(1.4, rpx * 0.06),
      { x0: px0 - reach, x1: px0 + reach, y0: py0 - reach, y1: py0 + reach });
    } else {
      const pts = [];
      for (let i = 0; i < 6; i++) {
        const a = rotRad + i * Math.PI / 3;
        pts.push([cx + Math.cos(a) * radius, cy + Math.sin(a) * radius]);
      }
      this.cutPath(pts, thickness, depth, true);
    }
  }

  /** Chamfered block cut (rounded-corner rectangle, rotatable). */
  cutBlock(cx, cy, bw, bh, angleRad, chamfer, depth) {
    const { w, h } = this;
    const ca = Math.cos(angleRad), sa = Math.sin(angleRad);
    const bwpx = bw * w, bhpx = bh * h;
    const hw = bwpx / 2 - chamfer * h, hh = bhpx / 2 - chamfer * h;
    const ch = chamfer * h;
    const px = cx * w, py = cy * h;
    const ex = (bwpx / 2) * Math.abs(ca) + (bhpx / 2) * Math.abs(sa) + ch + 4;
    const ey = (bwpx / 2) * Math.abs(sa) + (bhpx / 2) * Math.abs(ca) + ch + 4;
    this.cutByDistance((x, y) => {
      let best = Infinity;
      for (const ox of [-w, 0, w]) {
        const lx = (x - (px + ox)) * ca + (y - py) * sa;
        const ly = -(x - (px + ox)) * sa + (y - py) * ca;
        const qx = Math.max(Math.abs(lx) - hw, 0);
        const qy = Math.max(Math.abs(ly) - hh, 0);
        best = Math.min(best, Math.hypot(qx, qy) - ch);
      }
      return best;
    }, 0.5, depth, Math.max(1.5, ch * 0.35),
    { x0: px - ex, x1: px + ex, y0: py - ey, y1: py + ey });
  }

  /** Register a cosmetic stud dot (rendered later into albedo/roughness). */
  addStud(cx, cy, r) { this.studs.push([cx, cy, r]); }
}

/* --------------------------------------------------------------------------
 * Primitive rasteriser — one entry per editor tool
 * ------------------------------------------------------------------------ */
export function rasterizePrimitive(f, p) {
  switch (p.kind) {
    case 'longi': {  // circumferential channel (optionally zig-zag)
      const pts = [];
      const N = 64;
      for (let i = 0; i <= N; i++) {
        const x = i / N;
        const y = p.y + (p.zig || 0) * Math.sin(2 * Math.PI * (p.zigPeriods || 2) * x + (p.zigPhase || 0));
        pts.push([x, y]);
      }
      f.cutPath(pts, p.width, p.depth);
      break;
    }
    case 'lat': {    // lateral groove, angled
      const a = (p.angle * Math.PI) / 180;
      const y0 = p.y0 ?? 0, y1 = p.y1 ?? 1;
      const dx = Math.tan(a) * (y1 - y0) * (f.h / f.w);
      f.cutPath([[p.x - dx / 2, y0], [p.x + dx / 2, y1]], p.width, p.depth);
      break;
    }
    case 'sipe': {   // thin shallow cut, optionally wavy (winter lamella)
      const a = (p.angle * Math.PI) / 180;
      const y0 = p.y0 ?? 0, y1 = p.y1 ?? 1;
      const dx = Math.tan(a) * (y1 - y0) * (f.h / f.w);
      const pts = [];
      const N = 24;
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        const x = p.x - dx / 2 + dx * t +
          (p.wave || 0) * Math.sin(t * Math.PI * (p.waveFreq || 2)) * (f.h / f.w);
        pts.push([x, y0 + (y1 - y0) * t]);
      }
      f.cutPath(pts, p.width, p.depth);
      break;
    }
    case 'chevron': {// directional V groove: apex leads, arms trail
      const arms = p.arm ?? 0.42;            // reach toward each edge
      const lean = (p.lean ?? 0.22);         // x-offset of arm ends
      const pts = [
        [p.x - lean, 0.5 - arms],
        [p.x, p.apexY ?? 0.5],
        [p.x - lean, 0.5 + arms],
      ];
      if (p.trailing) { pts.reverse(); for (const q of pts) q[0] = 2 * p.x - q[0]; }
      f.cutPath(pts, p.width, p.depth);
      break;
    }
    case 'circle': { // ring groove or pocket
      f.cutCircle(p.x, p.y, p.radius, p.thickness, p.depth, !!p.fill);
      break;
    }
    case 'hex': {    // single hexagon
      f.cutHex(p.x, p.y, p.radius, ((p.rot || 0) * Math.PI) / 180, p.thickness, p.depth, !!p.fill);
      break;
    }
    case 'hexgrid': {// pointy-top hexagonal block network across a band
      const r = p.radius, t = p.thickness;
      const colDx = Math.sqrt(3) * r;          // horizontal pitch
      const rowDy = 1.5 * r;                   // vertical pitch
      const y0 = p.y0 ?? 0, y1 = p.y1 ?? 1;
      let row = 0;
      for (let y = y0 - rowDy; y <= y1 + rowDy; y += rowDy, row++) {
        const xoff = (row % 2) ? colDx / 2 : 0;
        for (let x = -colDx + xoff; x <= 1 + colDx; x += colDx) {
          f.cutHex(x, y, r, ((p.rot || 0) * Math.PI) / 180 + Math.PI / 6, t, p.depth, !!p.fill);
        }
      }
      break;
    }
    case 'block': {  // chamfered rectangular pocket (makes lugs)
      f.cutBlock(p.x, p.y, p.bw, p.bh, ((p.rot || 0) * Math.PI) / 180, p.chamfer ?? 0.02, p.depth);
      break;
    }
    case 'studs': {  // cosmetic ice studs — albedo-only
      const nR = p.rows ?? 4;
      for (let i = 0; i < nR; i++) {
        const y = (p.y0 ?? 0.15) + ((p.y1 ?? 0.85) - (p.y0 ?? 0.15)) * (i / (nR - 1));
        for (let x = (i % 2) * 0.25; x < 1; x += 0.5) f.addStud(x, y, p.radius ?? 0.012);
      }
      break;
    }
  }
}

/* --------------------------------------------------------------------------
 * Wear model — height-field post-process
 *  wear      0..0.95   global rubber loss (fraction of treadDepth)
 *  camber    0..0.6    extra wear on shoulders (aggressive alignment)
 *  feather   bool      add circumferential saw-tooth feathering noise
 * ------------------------------------------------------------------------ */
export function applyWear(src, wear, camber = 0, seed = 1) {
  const w = src.w, h = src.h, out = new Float32Array(w * h);
  const top = new Float32Array(w * h);      // local worn-surface height
  const rng = mulberry32(seed);
  const nW = 128, nH = 64, noise = new Float32Array(nW * nH);
  for (let i = 0; i < noise.length; i++) noise[i] = rng();
  const nAt = (x, y) => {
    const xi = ((x * nW / w) | 0) % nW, yi = ((y * nH / h) | 0) % nH;
    return noise[yi * nW + xi];
  };

  for (let y = 0; y < h; y++) {
    const v = y / (h - 1);
    const shoulder = Math.pow(Math.abs(v - 0.5) * 2, 2.4);   // 0 centre → 1 edge
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const hh = src.data[i];
      let cut = wear * (1 + camber * shoulder * 0.9) + (nAt(x, y) - 0.5) * 0.16 * wear;
      cut = Math.min(0.97, Math.max(0, cut));
      /* Wear removes rubber from contacting surfaces: everything exposed above
       * (1 - cut) is ground off. Shallow sipes bridge over; deep grooves stay.  */
      const t = 1 - cut;
      top[i] = t;
      out[i] = Math.min(hh, t);
    }
  }
  return { data: out, top };
}

function clamp01(v) { return Math.max(0, Math.min(1, v)); }

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* --------------------------------------------------------------------------
 * Tyre-name generator (used by the "Random name" button)
 * ------------------------------------------------------------------------ */
const NAME_A = ['G', 'GT-', 'Apex ', 'Venom ', 'Iron ', 'Red ', 'Night ', 'Turbo ', 'Wild ', 'Silver ', 'Black ', 'Hyper ', 'Road ', 'Storm ', 'Desert '];
const NAME_B = ['Zero', 'Talon', 'Magnum', 'Phantom', 'Kraken', 'Spear', 'Vulture', 'Rhino', 'Cobra', 'Wolf', 'Scorpion', 'Fang', 'Hawk', 'Comet', 'Cyclone', 'Mammoth', 'Drifter', 'Falcon', 'Saber', 'Mantis'];
const NAME_C = ['RS', 'GT', 'SS', 'RT', 'MT', 'X', 'Pro', 'R', 'S', 'EVO', 'II', '4S', 'HP', 'Z'];
export function randomTyreName(rng = Math.random) {
  const r = arr => arr[(arr.length * rng()) | 0];
  let a = r(NAME_A);
  const glue = (a.endsWith(' ') || a.endsWith('-')) ? '' : ' ';
  return a + glue + r(NAME_B) + ' ' + r(NAME_C);
}

/* --------------------------------------------------------------------------
 * PRESET LIBRARY — every tyre: unique name, type, size, tread primitives.
 * Units: widths in mm, rim in inches. Heights = fractions of treadDepth.
 * ------------------------------------------------------------------------ */
export const PRESETS = [
  {
    id: 'gzero-rs', name: 'GZERO RS', type: 'slick',
    desc: 'Full racing slick. Zero void, maximum contact patch.',
    size: { sw: 325, ar: 25, rim: 19, rimW: 12.0 },
    treadDepth: 2.6, treadWidthFrac: 0.78, tiles: 1, crown: 1.6, shoulderArc: 8,
    compound: { color: 0x232323, rough: 0.42, name: 'SLK-SOFT', wearTW: 60 },
    sidewall: { ring: '#d9291c', text: 'RACING SLICK · TW60', arrow: false },
    wear: 0.0, camber: 0.12,
    prims: [
      { kind: 'longi', y: 0.34, width: 0.014, depth: 0.16 },
      { kind: 'longi', y: 0.66, width: 0.014, depth: 0.16 },
    ],
  },
  {
    id: 'apex-talon', name: 'APEX TALON R', type: 'semi-slick',
    desc: 'DOT-legal semi-slick. Two channels, huge shoulders.',
    size: { sw: 265, ar: 35, rim: 18, rimW: 9.5 },
    treadDepth: 5.5, treadWidthFrac: 0.80, tiles: 18, crown: 1.8, shoulderArc: 9,
    compound: { color: 0x1c1d1f, rough: 0.5, name: 'R-COMP 200', wearTW: 200 },
    sidewall: { ring: '#e8c832', text: 'SEMI-SLICK · TW200', arrow: false },
    wear: 0.0, camber: 0.08,
    prims: [
      { kind: 'longi', y: 0.30, width: 0.075, depth: 0.95 },
      { kind: 'longi', y: 0.70, width: 0.075, depth: 0.95 },
      { kind: 'lat', x: 0.15, angle: 12, width: 0.030, depth: 0.75, y0: 0.0, y1: 0.16 },
      { kind: 'lat', x: 0.65, angle: 12, width: 0.030, depth: 0.75, y0: 0.0, y1: 0.16 },
      { kind: 'lat', x: 0.40, angle: -12, width: 0.030, depth: 0.75, y0: 0.84, y1: 1.0 },
      { kind: 'lat', x: 0.90, angle: -12, width: 0.030, depth: 0.75, y0: 0.84, y1: 1.0 },
      { kind: 'sipe', x: 0.5, angle: 6, width: 0.012, depth: 0.35, y0: 0.36, y1: 0.64 },
    ],
  },
  {
    id: 'street-phantom', name: 'STREET PHANTOM 4S', type: 'street',
    desc: 'UHP street tyre. 4 ribs, balanced wet & dry.',
    size: { sw: 245, ar: 40, rim: 18, rimW: 8.5 },
    treadDepth: 7.8, treadWidthFrac: 0.82, tiles: 24, crown: 2.0, shoulderArc: 10,
    compound: { color: 0x1a1a1a, rough: 0.62, name: 'SILICA HP', wearTW: 340 },
    sidewall: { ring: '#3a78d6', text: 'ULTRA HIGH PERF · TW340', arrow: false },
    wear: 0.0, camber: 0.0,
    prims: [
      { kind: 'longi', y: 0.20, width: 0.052, depth: 0.95 },
      { kind: 'longi', y: 0.40, width: 0.052, depth: 0.95 },
      { kind: 'longi', y: 0.60, width: 0.055, depth: 0.95 },
      { kind: 'longi', y: 0.80, width: 0.052, depth: 0.95 },
      { kind: 'lat', x: 0.10, angle: 38, width: 0.032, depth: 0.85, y0: 0.0, y1: 0.18 },
      { kind: 'lat', x: 0.35, angle: 38, width: 0.032, depth: 0.85, y0: 0.0, y1: 0.18 },
      { kind: 'lat', x: 0.60, angle: -38, width: 0.032, depth: 0.85, y0: 0.82, y1: 1.0 },
      { kind: 'lat', x: 0.85, angle: -38, width: 0.032, depth: 0.85, y0: 0.82, y1: 1.0 },
      { kind: 'sipe', x: 0.22, angle: 20, width: 0.010, depth: 0.38, y0: 0.24, y1: 0.38 },
      { kind: 'sipe', x: 0.72, angle: -20, width: 0.010, depth: 0.38, y0: 0.62, y1: 0.76 },
      { kind: 'sipe', x: 0.47, angle: 0, width: 0.010, depth: 0.38, y0: 0.44, y1: 0.56 },
    ],
  },
  {
    id: 'hydro-spear', name: 'HYDRO SPEAR V', type: 'wet',
    desc: 'Directional rain tyre. V-grooves fight aquaplaning.',
    size: { sw: 235, ar: 45, rim: 17, rimW: 8.0 },
    treadDepth: 8.5, treadWidthFrac: 0.83, tiles: 16, crown: 2.2, shoulderArc: 10,
    compound: { color: 0x17181a, rough: 0.58, name: 'WET-RACE', wearTW: 180 },
    sidewall: { ring: '#2196f3', text: 'RAIN · ROTATION →', arrow: true },
    wear: 0.0, camber: 0.0,
    prims: [
      { kind: 'chevron', x: 0.5, apexY: 0.5, arm: 0.44, lean: 0.30, width: 0.062, depth: 1.0 },
      { kind: 'chevron', x: 0.0, apexY: 0.5, arm: 0.44, lean: 0.30, width: 0.062, depth: 1.0 },
      { kind: 'chevron', x: 0.25, apexY: 0.5, arm: 0.30, lean: 0.22, width: 0.030, depth: 0.6 },
      { kind: 'chevron', x: 0.75, apexY: 0.5, arm: 0.30, lean: 0.22, width: 0.030, depth: 0.6 },
      { kind: 'longi', y: 0.06, width: 0.05, depth: 0.9 },
      { kind: 'longi', y: 0.94, width: 0.05, depth: 0.9 },
      { kind: 'sipe', x: 0.65, angle: 30, width: 0.009, depth: 0.3, y0: 0.1, y1: 0.3 },
    ],
  },
  {
    id: 'grizzly-magnum', name: 'GRIZZLY MAGNUM MT', type: 'offroad',
    desc: 'Mud-terrain. Deep lugs, hex centre blocks, stone ejectors.',
    size: { sw: 285, ar: 70, rim: 17, rimW: 8.5 },
    treadDepth: 15.0, treadWidthFrac: 0.74, tiles: 10, crown: 2.4, shoulderArc: 14,
    compound: { color: 0x151515, rough: 0.8, name: 'MT-HARD', wearTW: 500 },
    sidewall: { ring: '#c8c8c8', text: 'MUD-TERRAIN · 8PR', arrow: false, raised: true },
    wear: 0.0, camber: 0.0,
    prims: [
      { kind: 'hexgrid', radius: 0.085, thickness: 0.030, depth: 1.0, y0: 0.33, y1: 0.67, rot: 0 },
      { kind: 'block', x: 0.15, y: 0.13, bw: 0.30, bh: 0.16, rot: 12, chamfer: 0.03, depth: 1.0 },
      { kind: 'block', x: 0.65, y: 0.13, bw: 0.30, bh: 0.16, rot: 12, chamfer: 0.03, depth: 1.0 },
      { kind: 'block', x: 0.40, y: 0.87, bw: 0.30, bh: 0.16, rot: -12, chamfer: 0.03, depth: 1.0 },
      { kind: 'block', x: 0.90, y: 0.87, bw: 0.30, bh: 0.16, rot: -12, chamfer: 0.03, depth: 1.0 },
      { kind: 'lat', x: 0.5, y0: 0.0, y1: 0.08, width: 0.05, depth: 1.0, angle: 20 },
      { kind: 'lat', x: 0.25, y0: 0.92, y1: 1.0, width: 0.05, depth: 1.0, angle: -20 },
    ],
  },
  {
    id: 'drift-kaiju', name: 'DRIFT KAIJU SS', type: 'drift',
    desc: 'Stretched drift spare. Hard, shallow, pre-smoked.',
    size: { sw: 215, ar: 35, rim: 18, rimW: 9.5 },
    treadDepth: 7.0, treadWidthFrac: 0.84, tiles: 20, crown: 1.4, shoulderArc: 7,
    compound: { color: 0x24252a, rough: 0.38, name: 'DRIFT-HARD', wearTW: 400 },
    sidewall: { ring: '#9e9e9e', text: 'DRIFT SPEC · HARD', arrow: false },
    wear: 0.30, camber: 0.5,
    prims: [
      { kind: 'longi', y: 0.30, width: 0.045, depth: 0.55 },
      { kind: 'longi', y: 0.70, width: 0.045, depth: 0.55 },
      { kind: 'sipe', x: 0.3, angle: 10, width: 0.014, depth: 0.3, y0: 0.05, y1: 0.22 },
      { kind: 'sipe', x: 0.7, angle: -10, width: 0.014, depth: 0.3, y0: 0.78, y1: 0.95 },
    ],
  },
  {
    id: 'baja-scorpion', name: 'BAJA SCORPION RT', type: 'rally',
    desc: 'Rally raid hybrid — gravel bite, tarmac manners.',
    size: { sw: 235, ar: 65, rim: 17, rimW: 7.5 },
    treadDepth: 11.0, treadWidthFrac: 0.78, tiles: 14, crown: 2.6, shoulderArc: 12,
    compound: { color: 0x191919, rough: 0.72, name: 'RT-GRAVEL', wearTW: 460 },
    sidewall: { ring: '#e67e22', text: 'RAID SPEC · RT', arrow: false },
    wear: 0.05, camber: 0.0,
    prims: [
      { kind: 'longi', y: 0.5, width: 0.085, depth: 1.0, zig: 0.055, zigPeriods: 2 },
      { kind: 'block', x: 0.20, y: 0.22, bw: 0.30, bh: 0.22, rot: 20, chamfer: 0.04, depth: 0.95 },
      { kind: 'block', x: 0.70, y: 0.78, bw: 0.30, bh: 0.22, rot: 20, chamfer: 0.04, depth: 0.95 },
      { kind: 'block', x: 0.70, y: 0.22, bw: 0.24, bh: 0.20, rot: -25, chamfer: 0.04, depth: 0.95 },
      { kind: 'block', x: 0.20, y: 0.78, bw: 0.24, bh: 0.20, rot: -25, chamfer: 0.04, depth: 0.95 },
      { kind: 'sipe', x: 0.45, angle: 15, width: 0.012, depth: 0.4, y0: 0.30, y1: 0.44 },
    ],
  },
  {
    id: 'ice-fang', name: 'ICE FANG S', type: 'snow',
    desc: 'Studded winter tyre. Wavy lamellae + carbide studs.',
    size: { sw: 205, ar: 55, rim: 16, rimW: 6.5 },
    treadDepth: 9.5, treadWidthFrac: 0.80, tiles: 22, crown: 2.0, shoulderArc: 9,
    compound: { color: 0x1d1e22, rough: 0.66, name: 'ARCTIC SOFT', wearTW: 300 },
    sidewall: { ring: '#80d8ff', text: 'STUDDED · M+S ❄', arrow: true },
    wear: 0.0, camber: 0.0,
    prims: [
      { kind: 'hexgrid', radius: 0.07, thickness: 0.024, depth: 1.0, y0: 0.06, y1: 0.94, rot: 0 },
      { kind: 'sipe', x: 0.2, angle: 0, wave: 0.03, waveFreq: 3, width: 0.010, depth: 0.5, y0: 0.1, y1: 0.9 },
      { kind: 'sipe', x: 0.6, angle: 0, wave: 0.03, waveFreq: 3, width: 0.010, depth: 0.5, y0: 0.1, y1: 0.9 },
      { kind: 'studs', rows: 3, y0: 0.2, y1: 0.8, radius: 0.012 },
    ],
  },
  {
    id: 'tempest-gt', name: 'TEMPEST GT INT', type: 'race-wet',
    desc: 'GT intermediate. Hand-cut diagonal grooves.',
    size: { sw: 300, ar: 30, rim: 18, rimW: 11.0 },
    treadDepth: 5.0, treadWidthFrac: 0.79, tiles: 22, crown: 1.7, shoulderArc: 8,
    compound: { color: 0x181a21, rough: 0.48, name: 'GT-INT', wearTW: 120 },
    sidewall: { ring: '#f5f5f5', text: 'INTERMEDIATE · WET', arrow: true },
    wear: 0.0, camber: 0.1,
    prims: [
      { kind: 'longi', y: 0.26, width: 0.055, depth: 0.8 },
      { kind: 'longi', y: 0.74, width: 0.055, depth: 0.8 },
      { kind: 'lat', x: 0.2, angle: 28, width: 0.035, depth: 0.6, y0: 0.05, y1: 0.5 },
      { kind: 'lat', x: 0.6, angle: -28, width: 0.035, depth: 0.6, y0: 0.5, y1: 0.95 },
      { kind: 'lat', x: 0.85, angle: 28, width: 0.030, depth: 0.5, y0: 0.1, y1: 0.45 },
      { kind: 'lat', x: 0.05, angle: -28, width: 0.030, depth: 0.5, y0: 0.55, y1: 0.9 },
    ],
  },
  {
    id: 'cyber-orbit', name: 'CYBER ORBIT X', type: 'concept',
    desc: 'Concept EV tyre — orbital ring grooves, hex cell blocks.',
    size: { sw: 255, ar: 30, rim: 21, rimW: 9.0 },
    treadDepth: 7.5, treadWidthFrac: 0.80, tiles: 8, crown: 1.6, shoulderArc: 9,
    compound: { color: 0x1f2025, rough: 0.44, name: 'CONCEPT-X', wearTW: 999 },
    sidewall: { ring: '#7b61ff', text: 'CONCEPT · AUTONOMOUS', arrow: false },
    wear: 0.0, camber: 0.0,
    prims: [
      { kind: 'circle', x: 0.25, y: 0.5, radius: 0.30, thickness: 0.05, depth: 1.0, fill: false },
      { kind: 'circle', x: 0.75, y: 0.5, radius: 0.30, thickness: 0.05, depth: 1.0, fill: false },
      { kind: 'circle', x: 0.25, y: 0.5, radius: 0.10, thickness: 0.04, depth: 0.8, fill: false },
      { kind: 'circle', x: 0.75, y: 0.5, radius: 0.10, thickness: 0.04, depth: 0.8, fill: false },
      { kind: 'hex', x: 0.5, y: 0.5, radius: 0.09, rot: 30, thickness: 0.04, depth: 0.9, fill: false },
      { kind: 'hexgrid', radius: 0.06, thickness: 0.026, depth: 0.85, y0: 0.02, y1: 0.16, rot: 0 },
      { kind: 'hexgrid', radius: 0.06, thickness: 0.026, depth: 0.85, y0: 0.84, y1: 0.98, rot: 0 },
      { kind: 'circle', x: 0.0, y: 0.5, radius: 0.05, thickness: 0.05, depth: 0.7, fill: true },
    ],
  },
  {
    id: 'eco-whisper', name: 'ECO WHISPER LRR', type: 'touring',
    desc: 'EV touring. Five thin ribs, silent & frugal.',
    size: { sw: 195, ar: 55, rim: 15, rimW: 6.0 },
    treadDepth: 8.0, treadWidthFrac: 0.81, tiles: 30, crown: 2.2, shoulderArc: 10,
    compound: { color: 0x1b1b1b, rough: 0.6, name: 'ECO SILICA', wearTW: 480 },
    sidewall: { ring: '#58c469', text: 'LOW ROLLING RES · EV', arrow: false },
    wear: 0.0, camber: 0.0,
    prims: [
      { kind: 'longi', y: 0.16, width: 0.035, depth: 0.9 },
      { kind: 'longi', y: 0.33, width: 0.035, depth: 0.9 },
      { kind: 'longi', y: 0.50, width: 0.035, depth: 0.9 },
      { kind: 'longi', y: 0.67, width: 0.035, depth: 0.9 },
      { kind: 'longi', y: 0.84, width: 0.035, depth: 0.9 },
      { kind: 'sipe', x: 0.15, angle: 55, wave: 0.02, waveFreq: 2, width: 0.008, depth: 0.35, y0: 0.05, y1: 0.3 },
      { kind: 'sipe', x: 0.5, angle: -55, wave: 0.02, waveFreq: 2, width: 0.008, depth: 0.35, y0: 0.35, y1: 0.62 },
      { kind: 'sipe', x: 0.85, angle: 55, wave: 0.02, waveFreq: 2, width: 0.008, depth: 0.35, y0: 0.68, y1: 0.95 },
    ],
  },
];

export const TYPES = [
  { id: 'slick', label: 'Slick', hint: 'no tread · dry track' },
  { id: 'semi-slick', label: 'Semi-Slick', hint: 'track day / time attack' },
  { id: 'street', label: 'Street / Grip', hint: 'UHP road' },
  { id: 'wet', label: 'Rain', hint: 'directional wet' },
  { id: 'drift', label: 'Drift', hint: 'stretched · hard' },
  { id: 'rally', label: 'Rally', hint: 'gravel hybrid' },
  { id: 'offroad', label: 'Off-Road', hint: 'mud terrain' },
  { id: 'snow', label: 'Snow / Ice', hint: 'studded' },
  { id: 'race-wet', label: 'GT Wet', hint: 'intermediate' },
  { id: 'concept', label: 'Concept', hint: 'rings & hex cells' },
  { id: 'touring', label: 'Touring / Eco', hint: 'daily' },
];

/* Editor tool defaults — each "Add" button clones one of these */
export const TOOL_DEFAULTS = {
  longi:   { kind: 'longi', y: 0.5, width: 0.05, depth: 0.95, zig: 0, zigPeriods: 2 },
  lat:     { kind: 'lat', x: 0.5, angle: 30, width: 0.035, depth: 0.9, y0: 0, y1: 1 },
  sipe:    { kind: 'sipe', x: 0.5, angle: 0, width: 0.01, depth: 0.35, y0: 0.1, y1: 0.9, wave: 0, waveFreq: 2 },
  chevron: { kind: 'chevron', x: 0.5, apexY: 0.5, arm: 0.42, lean: 0.25, width: 0.055, depth: 1.0, trailing: false },
  circle:  { kind: 'circle', x: 0.5, y: 0.5, radius: 0.18, thickness: 0.045, depth: 0.9, fill: false },
  hex:     { kind: 'hex', x: 0.5, y: 0.5, radius: 0.14, rot: 0, thickness: 0.05, depth: 0.9, fill: false },
  hexgrid: { kind: 'hexgrid', radius: 0.08, thickness: 0.03, depth: 1.0, y0: 0.1, y1: 0.9, rot: 0, fill: false },
  block:   { kind: 'block', x: 0.5, y: 0.5, bw: 0.3, bh: 0.2, rot: 15, chamfer: 0.03, depth: 0.95 },
  studs:   { kind: 'studs', rows: 3, y0: 0.2, y1: 0.8, radius: 0.012 },
};

/* Human-readable names + editable params for each primitive kind */
export const TOOL_META = {
  longi:   { label: '➖ Longitudinal channel', params: { y: ['Centre', 0, 1], width: ['Width', 0.01, 0.2], depth: ['Depth', 0, 1], zig: ['Zig-zag', 0, 0.15], zigPeriods: ['Zig periods', 1, 6, 1] } },
  lat:     { label: '⬍ Lateral groove', params: { x: ['Position', 0, 1], angle: ['Angle°', -70, 70], width: ['Width', 0.01, 0.2], depth: ['Depth', 0, 1], y0: ['From', 0, 1], y1: ['To', 0, 1] } },
  sipe:    { label: '〰 Sipe / lamella', params: { x: ['Position', 0, 1], angle: ['Angle°', -80, 80], width: ['Width', 0.004, 0.05], depth: ['Depth', 0, 1], y0: ['From', 0, 1], y1: ['To', 0, 1], wave: ['Wave', 0, 0.08], waveFreq: ['Wave freq', 1, 6, 1] } },
  chevron: { label: '⋀ Chevron (V)', params: { x: ['Apex pos', 0, 1], arm: ['Arm span', 0.1, 0.5], lean: ['Lean', 0.05, 0.45], width: ['Width', 0.02, 0.15], depth: ['Depth', 0, 1], trailing: ['Flip', 'bool'] } },
  circle:  { label: '◯ Circle / ring', params: { x: ['X', 0, 1], y: ['Y', 0, 1], radius: ['Radius', 0.03, 0.45], thickness: ['Thickness', 0.01, 0.15], depth: ['Depth', 0, 1], fill: ['Filled', 'bool'] } },
  hex:     { label: '⬡ Hexagon', params: { x: ['X', 0, 1], y: ['Y', 0, 1], radius: ['Radius', 0.03, 0.4], rot: ['Rotation°', 0, 60], thickness: ['Thickness', 0.01, 0.12], depth: ['Depth', 0, 1], fill: ['Filled', 'bool'] } },
  hexgrid: { label: '⬡⬡ Hex block grid', params: { radius: ['Cell size', 0.04, 0.16], thickness: ['Gap', 0.012, 0.08], depth: ['Depth', 0, 1], y0: ['From Y', 0, 1], y1: ['To Y', 0, 1], rot: ['Rotation°', 0, 30], fill: ['Filled', 'bool'] } },
  block:   { label: '▛ Lug pocket', params: { x: ['X', 0, 1], y: ['Y', 0, 1], bw: ['Len', 0.05, 0.6], bh: ['Width', 0.05, 0.5], rot: ['Angle°', -60, 60], chamfer: ['Chamfer', 0.005, 0.08], depth: ['Depth', 0, 1] } },
  studs:   { label: '✣ Ice studs', params: { rows: ['Rows', 2, 6, 1], y0: ['From Y', 0, 1], y1: ['To Y', 0, 1], radius: ['Size', 0.006, 0.03] } },
};
