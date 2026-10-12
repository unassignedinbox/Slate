/* ============================================================================
   Markings — longitudinal lines, transverse bars, symbols and hatching.

   Everything is real geometry laid a few millimetres above the running
   surface, sampled through the Ribbon so it follows camber, banking and
   speed-hump profiles exactly. Nothing is baked into a texture, so markings
   stay crisp at any zoom and can be re-authored per edge.
   ========================================================================== */

import * as THREE from 'three';
import { lerp } from '../core/mathx.js';
import { MARKING_STYLES } from '../model/Presets.js';

/* Symbol atlas slots (see Textures.buildSymbolAtlas) */
export const SYM = {
  ARROW_F: 0, ARROW_L: 1, ARROW_R: 2,
  ARROW_FL: 3, ARROW_FR: 4, ARROW_LR: 5, ARROW_U: 6,
  CYCLE: 7, BUS: 8, TAXI: 9, DIAMOND: 10,
  PED: 11, CHEVRON: 12, GIVEWAY: 13, RAILX: 14, SLOW: 15,
};

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();

/* ------------------------------------------------------------- stripes --- */

/**
 * Paint a longitudinal stripe.
 * @returns number of quads emitted
 */
export function paintStripe(sink, key, ribbon, l, s0, s1, w, opts = {}) {
  const dash = opts.dash ?? 0;
  const gap = opts.gap ?? 0;
  const lift = opts.lift ?? 0.008;
  const startOffset = opts.startOffset ?? 0;
  const segLen = opts.segLen ?? 3.0;
  const hw = w / 2;

  let count = 0;
  if (dash > 0 && gap > 0) {
    const period = dash + gap;
    let s = s0 + startOffset;
    // align dashes to the period so they read consistently along the road
    let k = Math.floor((s - startOffset) / period);
    s = startOffset + k * period;
    while (s < s1) {
      const a = Math.max(s0, s);
      const b = Math.min(s1, s + dash);
      if (b > a + 0.05) emitBand(a, b);
      s += period;
    }
  } else {
    emitBand(s0, s1);
  }
  return count;

  function emitBand(a, b) {
    const len = b - a;
    const n = Math.max(1, Math.ceil(len / segLen));
    let prevL = null, prevR = null;
    for (let i = 0; i <= n; i++) {
      const s = lerp(a, b, i / n);
      const pl = ribbon.point(s, l - hw, _v.clone());
      ribbon.normal(s, l - hw, _n);
      pl.addScaledVector(_n, lift);
      const pr = ribbon.point(s, l + hw, _v.clone());
      ribbon.normal(s, l + hw, _n);
      pr.addScaledVector(_n, lift);
      if (prevL) {
        sink.flatQuad(key, prevL, prevR, pr, pl, 0, 1, 0, s, false);
      }
      prevL = pl; prevR = pr;
      count++;
    }
  }
}

/* ------------------------------------------------------------- symbols --- */

/**
 * Place an atlas symbol flat on the road, optionally mirrored/rotated.
 * `len` runs along the road, `wid` across.
 */
export function paintSymbol(sink, ribbon, l, s, wid, len, slot, opts = {}) {
  const lift = opts.lift ?? 0.010;
  const grid = 4;                 // 4x4 atlas
  const cell = 1 / grid;
  const cx = (slot % grid) * cell;
  const cy = Math.floor(slot / grid) * cell;
  const pad = 0.008;              // bleed guard
  const u0 = cx + pad, v0 = 1 - (cy + cell - pad);
  const u1 = cx + cell - pad, v1 = 1 - (cy + pad);

  const hl = len / 2, hw = wid / 2;
  const P = [];
  const UV = [];
  const N = [];
  // corners: (s - hl, l - hw) (s - hl, l + hw) (s + hl, l + hw) (s + hl, l - hw)
  const corners = [
    [s - hl, l - hw, u0, v0],
    [s - hl, l + hw, u1, v0],
    [s + hl, l + hw, u1, v1],
    [s + hl, l - hw, u0, v1],
  ];
  for (const [ss, ll, u, v] of corners) {
    const p = ribbon.point(ss, ll, new THREE.Vector3());
    ribbon.normal(ss, ll, _n);
    p.addScaledVector(_n, lift);
    P.push(p.x, p.y, p.z);
    N.push(_n.x, _n.y, _n.z);
    UV.push(u, v);
  }
  sink.quad('symbol', P, N, UV);
}

/** Diagonal hatch fill over a rectangle of road (yellow boxes, chevrons). */
export function paintHatch(sink, key, ribbon, l0, l1, s0, s1, opts = {}) {
  const barW = opts.barW ?? 0.45;
  const pitch = opts.pitch ?? 1.2;
  const angle = opts.angle ?? 45;
  const lift = opts.lift ?? 0.009;
  const cross = l1 - l0;
  const along = s1 - s0;
  const step = Math.abs(cross) / Math.tan((angle * Math.PI) / 180) || pitch;
  const n = Math.ceil((along + Math.abs(step)) / pitch);
  for (let i = 0; i < n; i++) {
    const sa = s0 + i * pitch;
    const sb = sa + barW;
    if (sa > s1) break;
    const A = ribbon.point(sa, l0, new THREE.Vector3());
    ribbon.normal(sa, l0, _n); A.addScaledVector(_n, lift);
    const B = ribbon.point(sa + step, l1, new THREE.Vector3());
    ribbon.normal(sa + step, l1, _n); B.addScaledVector(_n, lift);
    const C = ribbon.point(sb + step, l1, new THREE.Vector3());
    ribbon.normal(sb + step, l1, _n); C.addScaledVector(_n, lift);
    const D = ribbon.point(sb, l0, new THREE.Vector3());
    ribbon.normal(sb, l0, _n); D.addScaledVector(_n, lift);
    sink.flatQuad(key, A, B, C, D, 0, 1, 0, 0, false);
  }
}

/** Zebra / continental crossing — transverse bars across a lane group. */
export function paintZebra(sink, ribbon, l0, l1, s0, s1, opts = {}) {
  const style = opts.style || MARKING_STYLES.eu;
  const barW = opts.barW ?? style.zebra.w;
  const pitch = barW + (opts.barGap ?? style.zebra.gap);
  const inset = opts.inset ?? 0.25;
  const lift = opts.lift ?? 0.010;
  const along = s1 - s0;
  if (along < barW * 1.2) return;
  const n = Math.max(1, Math.floor((along + pitch * 0.5) / pitch));
  const off = s0 + (along - (n * pitch - (pitch - barW))) / 2;
  for (let i = 0; i < n; i++) {
    const sa = off + i * pitch;
    const sb = sa + barW;
    const A = ribbon.point(sa, l0 + inset, new THREE.Vector3());
    ribbon.normal(sa, l0 + inset, _n); A.addScaledVector(_n, lift);
    const B = ribbon.point(sa, l1 - inset, new THREE.Vector3());
    ribbon.normal(sa, l1 - inset, _n); B.addScaledVector(_n, lift);
    const C = ribbon.point(sb, l1 - inset, new THREE.Vector3());
    ribbon.normal(sb, l1 - inset, _n); C.addScaledVector(_n, lift);
    const D = ribbon.point(sb, l0 + inset, new THREE.Vector3());
    ribbon.normal(sb, l0 + inset, _n); D.addScaledVector(_n, lift);
    sink.flatQuad('paint_w', A, B, C, D, 0, 1, 0, 0, false);
  }
}

/** Transverse stop bar (thick solid line across lanes). */
export function paintStopBar(sink, ribbon, l0, l1, s, opts = {}) {
  const w = opts.w ?? 0.45;
  const lift = opts.lift ?? 0.010;
  const key = opts.key || 'paint_w';
  const A = ribbon.point(s, l0, new THREE.Vector3());
  ribbon.normal(s, l0, _n); A.addScaledVector(_n, lift);
  const B = ribbon.point(s, l1, new THREE.Vector3());
  ribbon.normal(s, l1, _n); B.addScaledVector(_n, lift);
  const C = ribbon.point(s + w, l1, new THREE.Vector3());
  ribbon.normal(s + w, l1, _n); C.addScaledVector(_n, lift);
  const D = ribbon.point(s + w, l0, new THREE.Vector3());
  ribbon.normal(s + w, l0, _n); D.addScaledVector(_n, lift);
  sink.flatQuad(key, A, B, C, D, 0, 1, 0, 0, false);
}

/** Give-way "shark's teeth" row. */
export function paintGiveWay(sink, ribbon, l0, l1, s, opts = {}) {
  const depth = opts.depth ?? 1.2;
  const pitch = opts.pitch ?? 0.9;
  const lift = opts.lift ?? 0.010;
  const across = l1 - l0;
  const n = Math.max(2, Math.floor(across / pitch));
  const w = (across / n) * 0.55;
  for (let i = 0; i < n; i++) {
    const c = l0 + (across / n) * (i + 0.5);
    const A = ribbon.point(s, c - w / 2, new THREE.Vector3());
    ribbon.normal(s, c - w / 2, _n); A.addScaledVector(_n, lift);
    const B = ribbon.point(s, c + w / 2, new THREE.Vector3());
    ribbon.normal(s, c + w / 2, _n); B.addScaledVector(_n, lift);
    const C = ribbon.point(s + depth, c, new THREE.Vector3());
    ribbon.normal(s + depth, c, _n); C.addScaledVector(_n, lift);
    sink.tri('paint_w', A, B, C, _n.clone(), [0, 0, 1, 0, 0.5, 1]);
  }
}

/* ---------------------------------------------------------- main pass ---- */

const RUN_KINDS = new Set(['driving', 'bus', 'cycle', 'tram']);

/**
 * Generate all markings for one edge.
 * @param {Object} ctx { trimStart, trimEnd, style }
 */
export function buildMarkings(edge, net, sink, ribbon, section, ctx = {}) {
  const f = edge.featuresOf();
  if (f.markings === false) return;
  const style = MARKING_STYLES[edge.markStyle] || MARKING_STYLES.eu;
  const trimStart = ctx.trimStart ?? 0;
  const trimEnd = ctx.trimEnd ?? 0;
  const L = ribbon.length;
  const s0 = trimStart + 0.5;
  const s1 = L - trimEnd - 0.5;
  if (s1 - s0 < 2) return;

  const lanes = section.lanes.filter((l) => l.w > 0.05);
  const runLanes = lanes.filter((l) => RUN_KINDS.has(l.k));
  if (!runLanes.length) return;

  const cwL = runLanes[0].l0;
  const cwR = runLanes[runLanes.length - 1].l1;

  /* ---- 1. continuous edge lines ---- */
  const edgeW = f.edgeLineWidth ?? style.edge;
  paintStripe(sink, 'paint_w', ribbon, cwL + edgeW * 0.6, s0, s1, edgeW, {});
  paintStripe(sink, 'paint_w', ribbon, cwR - edgeW * 0.6, s0, s1, edgeW, {});

  /* ---- 2. lane boundaries ---- */
  for (let i = 0; i < lanes.length - 1; i++) {
    const a = lanes[i], b = lanes[i + 1];
    if (Math.abs(a.l1 - b.l0) > 1e-3) continue;
    const at = a.l1;
    const bothRun = RUN_KINDS.has(a.k) && RUN_KINDS.has(b.k);

    if (bothRun && a.dir !== 0 && b.dir !== 0 && a.dir === b.dir) {
      // same direction: dashed lane line
      if (a.k === 'bus' || b.k === 'bus') {
        paintStripe(sink, 'paint_w', ribbon, at, s0, s1, 0.2, {});
        diamonds(sink, ribbon, at, s0, s1, 18);
      } else if (a.k === 'cycle' || b.k === 'cycle') {
        paintStripe(sink, 'paint_w', ribbon, at, s0, s1, 0.18, {});
      } else {
        paintStripe(sink, 'paint_w', ribbon, at, s0, s1, style.lane, {
          dash: f.laneDash ?? style.dash, gap: f.laneGap ?? style.gap,
        });
      }
    } else if (bothRun && a.dir !== 0 && b.dir !== 0 && a.dir !== b.dir) {
      // opposing flows: centre line
      centreLine(sink, ribbon, at, s0, s1, style, f, lanes.length);
    } else if (bothRun) {
      // one or both bidirectional
      paintStripe(sink, 'paint_w', ribbon, at, s0, s1, style.lane, { dash: style.dash, gap: style.gap });
    } else if ((a.k === 'parking') !== (b.k === 'parking')) {
      // parking bay edge
      paintStripe(sink, 'paint_w', ribbon, at, s0, s1, 0.1, { dash: 1.5, gap: 1.5 });
    } else if ((a.k === 'cycle') !== (b.k === 'cycle')) {
      paintStripe(sink, 'paint_w', ribbon, at, s0, s1, 0.18, {});
    } else if ((a.k === 'tram') !== (b.k === 'tram')) {
      paintStripe(sink, 'paint_y', ribbon, at, s0, s1, 0.15, {});
    }
  }

  /* ---- 3. parking bay T-marks ---- */
  for (const ln of lanes) {
    if (!ln.isParking) continue;
    const pitch = f.bayPitch ?? 5.4;
    const start = ((s0 % pitch) + pitch) % pitch;
    for (let s = s0 + (pitch - start); s < s1 - 0.6; s += pitch) {
      const inner = ln.dir > 0 ? ln.l1 : ln.l0;
      const outer = ln.dir > 0 ? ln.l0 : ln.l1;
      paintStripe(sink, 'paint_w', ribbon, (inner + outer) / 2, s, s + 0.12, Math.abs(inner - outer) * 0.86, {});
      paintStripe(sink, 'paint_w', ribbon, (inner * 0.25 + outer * 0.75), s, s + 2.4, 0.1, {});
    }
  }

  /* ---- 4. cycle lane symbols + colour band ---- */
  for (const ln of lanes) {
    if (!ln.isCycle) continue;
    const pitch = f.cycleSymbolPitch ?? 30;
    for (let s = s0 + pitch * 0.5; s < s1; s += pitch) {
      paintSymbol(sink, ribbon, (ln.l0 + ln.l1) / 2, s, Math.min(0.9, ln.w * 0.62), 1.5, SYM.CYCLE);
    }
  }

  /* ---- 5. bus lane legend ---- */
  for (const ln of lanes) {
    if (!ln.isBus) continue;
    const pitch = f.busLegendPitch ?? 45;
    for (let s = s0 + pitch * 0.5; s < s1; s += pitch) {
      paintSymbol(sink, ribbon, (ln.l0 + ln.l1) / 2, s, Math.min(1.6, ln.w * 0.55), 3.2, SYM.BUS);
    }
  }

  /* ---- 6. bus stop cages ---- */
  if (f.busStops && runLanes.length) {
    const pitch = f.busStopPitch ?? 320;
    for (let s = s0 + pitch * 0.6; s < s1 - 24; s += pitch) {
      const ln = runLanes.find((l) => l.isBus) || runLanes[0];
      const lA = ln.l0 + 0.12, lB = ln.l1 - 0.12;
      paintStopBar(sink, ribbon, lA, lB, s, { w: 0.4 });
      paintStopBar(sink, ribbon, lA, lB, s + 14, { w: 0.4 });
      paintStripe(sink, 'paint_w', ribbon, lA, s, s + 14, 0.2, {});
      paintStripe(sink, 'paint_w', ribbon, lB, s, s + 14, 0.2, {});
      paintHatch(sink, 'paint_y', ribbon, lA, lB, s, s + 14, { barW: 0.35, pitch: 1.4 });
      paintSymbol(sink, ribbon, (lA + lB) / 2, s + 7, Math.min(1.5, (lB - lA) * 0.5), 3.0, SYM.BUS);
    }
  }

  /* ---- 7. rumble strips on shoulders ---- */
  if (f.rumbles) {
    for (const ln of lanes) {
      if (ln.k !== 'shoulder') continue;
      const inner = Math.abs(ln.l0 - section.carriageway.l0) < Math.abs(ln.l0 - section.carriageway.l1) ? ln.l1 : ln.l0;
      const sgn = inner === ln.l1 ? -1 : 1;
      const l = inner + sgn * 0.35;
      for (let s = s0; s < s1; s += 0.9) {
        paintStripe(sink, 'paint_w', ribbon, l, s, s + 0.42, 0.3, {});
      }
    }
  }

  /* ---- 8. speed-hump chevrons ---- */
  const h = f.humps;
  if (h && h.on) {
    const spacing = h.spacing ?? 60;
    const start = h.start ?? spacing * 0.5;
    for (let s = start; s < s1; s += spacing) {
      if (s < s0 || s > s1) continue;
      for (let k = 1; k <= 3; k++) {
        const at = s - 2.2 * k;
        if (at < s0) break;
        const frac = k / 4;
        const lA = lerp(cwL + 0.3, (cwL + cwR) / 2 - 0.4, frac);
        const lB = lerp(cwR - 0.3, (cwL + cwR) / 2 + 0.4, frac);
        // draw two chevron legs
        const mid = (cwL + cwR) / 2;
        chevronLeg(sink, ribbon, lA, mid, at, 1.1, 0.25);
        chevronLeg(sink, ribbon, mid, lB, at, 1.1, 0.25, true);
      }
    }
  }

  /* ---- 9. direction arrows just before a junction ---- */
  if (f.arrows !== false && ctx.arrowLanes && ctx.arrowLanes.length) {
    for (const al of ctx.arrowLanes) {
      if (al.s <= s0 + 2 || al.s >= s1 - 0.5) continue;
      paintSymbol(sink, ribbon, al.l, al.s, Math.min(1.5, al.w * 0.55), 4.5, al.slot);
    }
  }
}

function chevronLeg(sink, ribbon, l0, l1, s, depth, w, mirror = false) {
  const lift = 0.010;
  const n = new THREE.Vector3();
  const a = ribbon.point(s, l0, new THREE.Vector3()); ribbon.normal(s, l0, n); a.addScaledVector(n, lift);
  const b = ribbon.point(s, l1, new THREE.Vector3()); ribbon.normal(s, l1, n); b.addScaledVector(n, lift);
  const c = ribbon.point(s + depth, l1, new THREE.Vector3()); ribbon.normal(s + depth, l1, n); c.addScaledVector(n, lift);
  const d = ribbon.point(s + depth + w, l1, new THREE.Vector3()); ribbon.normal(s + depth + w, l1, n); d.addScaledVector(n, lift);
  const e = ribbon.point(s + w, l0, new THREE.Vector3()); ribbon.normal(s + w, l0, n); e.addScaledVector(n, lift);
  // parallelogram a-b-c + a-c-...
  sink.flatQuad('paint_w', a, b, c, e, 0, 1, 0, 0, false);
  sink.flatQuad('paint_w', c, d, e, e, 0, 1, 0, 0, false);
}

function centreLine(sink, ribbon, at, s0, s1, style, f, laneCount) {
  const mode = f.centreMode ?? (laneCount <= 2 ? 'dash' : 'double');
  const w = style.centre;
  if (mode === 'double') {
    paintStripe(sink, 'paint_y', ribbon, at - 0.09, s0, s1, w, {});
    paintStripe(sink, 'paint_y', ribbon, at + 0.09, s0, s1, w, {});
  } else if (mode === 'solid') {
    paintStripe(sink, 'paint_w', ribbon, at, s0, s1, w, {});
  } else if (mode === 'solid_dash') {
    paintStripe(sink, 'paint_w', ribbon, at - 0.09, s0, s1, w, {});
    paintStripe(sink, 'paint_w', ribbon, at + 0.09, s0, s1, w, { dash: style.dash, gap: style.gap });
  } else {
    paintStripe(sink, 'paint_w', ribbon, at, s0, s1, w, { dash: style.dash * 0.6, gap: style.gap * 0.5 });
  }
}

function diamonds(sink, ribbon, at, s0, s1, pitch) {
  for (let s = s0 + pitch * 0.5; s < s1; s += pitch) {
    const lift = 0.010;
    const n = new THREE.Vector3();
    const a = ribbon.point(s - 0.9, at, new THREE.Vector3()); ribbon.normal(s - 0.9, at, n); a.addScaledVector(n, lift);
    const b = ribbon.point(s, at - 0.32, new THREE.Vector3()); ribbon.normal(s, at - 0.32, n); b.addScaledVector(n, lift);
    const c = ribbon.point(s + 0.9, at, new THREE.Vector3()); ribbon.normal(s + 0.9, at, n); c.addScaledVector(n, lift);
    const d = ribbon.point(s, at + 0.32, new THREE.Vector3()); ribbon.normal(s, at + 0.32, n); d.addScaledVector(n, lift);
    sink.flatQuad('paint_w', a, b, c, d, 0, 1, 0, 0, false);
  }
}
