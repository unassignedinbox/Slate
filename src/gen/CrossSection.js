/* ============================================================================
   CrossSection — compiles a band list into an extrudable 2D profile.

   Output is a polyline in (lateral, height) space plus a list of SPANS.
   Contiguous spans sharing a surface and no crease are merged into STRIPS, so
   a cambered carriageway shades smoothly while kerb faces stay razor sharp.

   UVs are authored in metres (u across, v along). Every surface therefore has
   identical texel density at any road width — no stretching, no seams.
   ========================================================================== */

import { KINDS, TRAFFIC_KINDS } from '../model/Presets.js';
import { clamp } from '../core/mathx.js';

const CREASE = 1;
const SMOOTH = 0;

/**
 * @param {Array} bands  left -> right
 * @param {Object} opts  { camber, crossfallCrownR }
 */
export function compileProfile(bands, opts = {}) {
  const camber = opts.camber ?? 0.025;
  const crownR = opts.crownR ?? 1.6;

  const list = bands.map((b) => ({ ...b, w: Math.max(0, b.w ?? KINDS[b.k]?.w ?? 1) }));
  const totalW = list.reduce((s, b) => s + b.w, 0);

  /* --- 1. locate contiguous carriageway runs (each gets its own crown) --- */
  const runs = [];
  let cur = null;
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    if (TRAFFIC_KINDS.has(b.k)) {
      if (!cur) { cur = { i0: i, i1: i, l0: null, l1: null }; runs.push(cur); }
      cur.i1 = i;
    } else cur = null;
  }

  /* --- 2. lateral layout --- */
  let l = -totalW / 2;
  for (const b of list) { b.l0 = l; b.l1 = l + b.w; l += b.w; }
  for (const r of runs) {
    r.l0 = list[r.i0].l0;
    r.l1 = list[r.i1].l1;
    r.crown = (r.l0 + r.l1) / 2;
    r.half = (r.l1 - r.l0) / 2;
  }

  /** Height of a traffic-run surface at lateral offset `x`. */
  const trafficH = (run, x, baseH) => {
    if (camber <= 1e-6 || run.half <= 0.01) return baseH;
    const d = Math.abs(x - run.crown);
    // parabolic crown over crownR, then linear crossfall — matches how a
    // paver/roller actually profiles a road
    const fall = d <= crownR
      ? (d * d) / (2 * crownR)
      : d - crownR / 2;
    const maxFall = run.half - crownR / 2;
    const h = baseH - camber * Math.min(fall, Math.max(0.0001, maxFall));
    return h;
  };

  const runOf = (i) => runs.find((r) => i >= r.i0 && i <= r.i1) || null;

  /* --- 3. emit nodes + spans --- */
  const nodes = [];   // { l, h, crease }
  const spans = [];   // { i0, surface, kind, dir, band, vertical }
  const lanes = [];

  let prevRightH = null;
  let prevBandRight = null;

  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    if (b.k === 'none') { prevRightH = null; continue; }

    const run = runOf(i);
    const baseH = b.h ?? 0;
    let hL, hR;
    if (run) {
      hL = trafficH(run, b.l0, baseH);
      hR = trafficH(run, b.l1, baseH);
    } else {
      hL = baseH;
      hR = baseH;
    }

    /* --- riser / transition from the previous band --- */
    if (prevRightH !== null && nodes.length) {
      const dh = prevRightH - hL;
      const mode = b.riser || (Math.abs(dh) > 1e-4 ? 'curb' : 'none');
      if (Math.abs(dh) > 1e-4 && mode !== 'none') {
        if (mode === 'slope') {
          let sw = clamp(Math.abs(dh) * 3.0, 0.25, Math.max(0.25, b.w * 0.45));
          const nA = { l: b.l0, h: prevRightH, crease: SMOOTH };
          const nB = { l: b.l0 + sw, h: hL, crease: SMOOTH };
          nodes.push(nA, nB);
          spans.push({ i0: nodes.length - 2, surface: b.riserSurface || b.s || 'kerb', kind: 'slope', dir: 0, band: b, vertical: false });
          // remaining width of the band continues from nB
          if (b.w - sw > 1e-3) {
            const nC = { l: b.l1, h: hR, crease: SMOOTH };
            nodes.push(nC);
            spans.push({ i0: nodes.length - 2, surface: b.s, kind: b.k, dir: b.dir || 0, band: b, vertical: false });
            lanes.push(mkLane(b, b.l0 + sw, b.l1, hL, hR));
          }
          prevRightH = hR;
          continue;
        } else {
          // vertical riser: two nodes at the same lateral, hard creases
          const surf = mode === 'wall' ? (b.riserSurface || b.s || 'concrete_brushed') : (b.riserSurface || 'kerb');
          nodes.push({ l: b.l0, h: prevRightH, crease: CREASE });
          nodes.push({ l: b.l0, h: hL, crease: CREASE });
          spans.push({ i0: nodes.length - 2, surface: surf, kind: 'curb', dir: 0, band: b, vertical: true, mode });
        }
      } else if (Math.abs(dh) > 1e-4) {
        // mode 'none' but heights differ: snap (used by 'none' spacers)
        nodes[nodes.length - 1].h = hL;
      }
    }

    /* --- the band itself --- */
    const startIdx = nodes.length;
    if (b.w > 1e-4) {
      nodes.push({ l: b.l0, h: hL, crease: nodes.length ? (b.riser === 'slope' ? SMOOTH : (prevBandRight !== hL ? CREASE : SMOOTH)) : CREASE });
      nodes.push({ l: b.l1, h: hR, crease: SMOOTH });
      spans.push({ i0: startIdx, surface: b.s, kind: b.k, dir: b.dir || 0, band: b, vertical: false });
      lanes.push(mkLane(b, b.l0, b.l1, hL, hR));
    } else if (nodes.length === 0) {
      // zero-width band at the very start (shouldn't happen) — seed a node
      nodes.push({ l: b.l0, h: hL, crease: CREASE });
    }
    prevRightH = hR;
    prevBandRight = hR;
  }

  /* --- 4. merge spans into strips (smooth where possible) --- */
  const strips = [];
  for (const sp of spans) {
    const last = strips[strips.length - 1];
    const canMerge =
      last &&
      !sp.vertical && !last.vertical &&
      last.surface === sp.surface &&
      last.endNode === sp.i0 &&
      nodes[sp.i0].crease === SMOOTH &&
      last.kind === sp.kind ? true :
      (last && !sp.vertical && !last.vertical && last.surface === sp.surface && last.endNode === sp.i0 && nodes[sp.i0].crease === SMOOTH);
    if (canMerge) {
      last.count++;
      last.endNode = sp.i0 + 1;
    } else {
      strips.push({
        startNode: sp.i0, endNode: sp.i0 + 1, count: 1,
        surface: sp.surface, kind: sp.kind, dir: sp.dir,
        vertical: sp.vertical, band: sp.band, mode: sp.mode || null,
      });
    }
  }

  /* --- 5. per-strip node index lists --- */
  for (const st of strips) {
    st.nodes = [];
    for (let i = st.startNode; i <= st.endNode; i++) st.nodes.push(i);
  }

  return {
    nodes, strips, lanes, runs,
    width: totalW,
    l0: -totalW / 2,
    l1: totalW / 2,
    carriageway: runs.length
      ? { l0: Math.min(...runs.map((r) => r.l0)), l1: Math.max(...runs.map((r) => r.l1)) }
      : { l0: -totalW / 2, l1: totalW / 2 },
  };
}

function mkLane(band, l0, l1, hL, hR) {
  return {
    k: band.k, l0, l1, w: l1 - l0, dir: band.dir || 0,
    surface: band.s, hL, hR, band,
    traffic: TRAFFIC_KINDS.has(band.k),
    isCycle: band.k === 'cycle',
    isBus: band.k === 'bus',
    isParking: band.k === 'parking',
    isRail: band.k === 'rail' || band.k === 'tram',
  };
}

/* ------------------------------------------------------------------ utils -- */

/** Lateral position of the boundary between lane i and lane i+1. */
export function laneBoundaries(section) {
  const out = [];
  const ls = section.lanes;
  for (let i = 0; i < ls.length - 1; i++) out.push({ l: (ls[i].l1 + ls[i + 1].l0) / 2, a: ls[i], b: ls[i + 1] });
  return out;
}

/** Index of the strip containing lateral `l`, or -1. */
export function stripAt(section, l) {
  for (let i = 0; i < section.strips.length; i++) {
    const st = section.strips[i];
    const a = section.nodes[st.startNode], b = section.nodes[st.endNode];
    if (l >= Math.min(a.l, b.l) - 1e-6 && l <= Math.max(a.l, b.l) + 1e-6) return i;
  }
  return -1;
}

/** Height of the section polyline at lateral `l` (linear interp within strips). */
export function heightAt(section, l) {
  const cl = clamp(l, section.l0, section.l1);
  let best = null, bd = Infinity;
  for (const st of section.strips) {
    if (st.vertical) continue;
    for (let i = st.startNode; i < st.endNode; i++) {
      const a = section.nodes[i], b = section.nodes[i + 1];
      const lo = Math.min(a.l, b.l), hi = Math.max(a.l, b.l);
      if (cl >= lo - 1e-6 && cl <= hi + 1e-6) {
        const t = hi - lo < 1e-9 ? 0 : (cl - a.l) / (b.l - a.l || 1e-9);
        return a.h + (b.h - a.h) * clamp(t, 0, 1);
      }
      const d = Math.min(Math.abs(cl - a.l), Math.abs(cl - b.l));
      if (d < bd) { bd = d; best = a.h; }
    }
  }
  return best ?? 0;
}

/**
 * Road-surface height for a traffic lane, used as the datum for markings and
 * surface-mounted props.
 */
export function surfaceHeightAt(section, l) {
  return heightAt(section, l);
}
