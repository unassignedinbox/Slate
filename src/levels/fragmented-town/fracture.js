// Fractured buildings.
//
// A house is not one box. It is a set of wall, floor, roof and chimney
// fragments with gaps between them (the cracks), a few missing pieces, a few
// fallen pieces, and a ragged, broken top. Every fragment is its own anchor, so
// it drifts a little on its own, and the whole house sways gently as one body.
//
// Local frame: origin at the base centre, +X = width, +Y = up, +Z = depth.
// The house is built on the frame (X, UP, Z) passed in by the caller.

import { Anchor } from '../../engine/anchor.js';
import { mat4FromBasis, mat4Translation, mat4RotX, mat4RotZ, mat4RotY, mat4Mul } from '../../engine/math.js';
import { makeItem } from './items.js';

const WALL_T = 0.45;

// Translate, then tilt about X and Z, then yaw. Used for every fragment.
export function localHome(c, { tx = 0, tz = 0, ry = 0 } = {}) {
  return mat4Mul(mat4Translation(c), mat4Mul(mat4RotX(tx), mat4Mul(mat4RotZ(tz), mat4RotY(ry))));
}

// Independent drift for one fragment.
function fragmentWob(rng, amp) {
  return {
    ay: amp * rng.range(0.6, 1.2),
    ax: amp * 0.4,
    az: amp * 0.4,
    rx: 0.004,
    rz: 0.004,
    w: rng.range(0.25, 0.5),
    p: rng.range(0, 6.283),
  };
}

// Build one fractured building.
//   rng       seeded generator (fork it per building)
//   partId    which zone it belongs to
//   base      [x,y,z] of the base centre
//   frame     { X, Z } horizontal unit vectors (Y is up)
//   w, d      footprint: width along X, depth along Z
//   floors    number of storeys, floorH metres each
//   roof      build a broken gable roof
//   chimney   add a split chimney
//   tower     { size, height } — a broken tower on the front-right corner (chapel)
export function buildFracturedBuilding(opts) {
  const { rng, partId, base, frame, w, d, floors, floorH = 3.2, roof = true, chimney = true, tower = null, idPrefix } = opts;
  const UPV = [0, 1, 0];
  const rootHome = mat4FromBasis(base, frame.X, UPV, frame.Z);
  const root = new Anchor({
    home: rootHome,
    wob: { ay: 0.2, ax: 0.06, az: 0.06, rx: 0.003, rz: 0.003, w: rng.range(0.2, 0.35), p: rng.range(0, 6.283) },
  });
  const items = [];
  let n = 0;
  const nextId = (tag) => `${idPrefix}-${tag}-${n++}`;
  const H = floors * floorH;
  const wt = WALL_T;

  const addFragment = (role, dims, c, mat, { tx, tz, ry, amp = 0.12, solid = true, parent = root } = {}) => {
    const anchor = new Anchor({
      parent,
      home: localHome(c, { tx, tz, ry }),
      wob: amp > 0 ? fragmentWob(rng, amp) : null,
    });
    const item = makeItem({ partId, role, kind: 'box', dims, mat, anchor, solid, cast: true });
    item.id = nextId(role);
    items.push(item);
    return { item, anchor };
  };

  // ── Walls: 2–4 pieces each, with cracks between, ragged tops, the odd hole.
  const wallDefs = [
    { axis: 'x', L: w, fixed: d / 2 - wt / 2, out: [0, 0, 1] },
    { axis: 'x', L: w, fixed: -(d / 2 - wt / 2), out: [0, 0, -1] },
    { axis: 'z', L: d, fixed: w / 2 - wt / 2, out: [1, 0, 0] },
    { axis: 'z', L: d, fixed: -(w / 2 - wt / 2), out: [-1, 0, 0] },
  ];
  for (const wd of wallDefs) {
    const k = rng.int(2, 4);
    const fr = Array.from({ length: k - 1 }, () => rng.range(0.22, 0.78)).sort((a, b) => a - b);
    const bounds = [0, ...fr, 1];
    for (let i = 0; i < k; i++) {
      if (i > 0 && rng.chance(0.07)) continue; // a hole in the wall
      const gap = rng.range(0.3, 0.6);
      const a = bounds[i] * wd.L - wd.L / 2;
      const b = bounds[i + 1] * wd.L - wd.L / 2;
      const len = b - a - gap;
      const u = (a + b) / 2;
      const broken = rng.chance(0.35);
      const Hp = broken ? H * rng.range(0.45, 0.85) : H;
      const fallen = rng.chance(0.12);
      let c = wd.axis === 'x' ? [u, Hp / 2, wd.fixed] : [wd.fixed, Hp / 2, u];
      let tx;
      let tz;
      if (fallen) {
        c = [c[0] + wd.out[0] * rng.range(0.5, 1.1), c[1] + rng.range(-0.2, 0.2), c[2] + wd.out[2] * rng.range(0.5, 1.1)];
        tx = wd.axis === 'z' ? rng.range(-0.08, 0.08) : undefined;
        tz = wd.axis === 'x' ? rng.range(-0.08, 0.08) : undefined;
      }
      const dims = wd.axis === 'x' ? [len, Hp, wt] : [wt, Hp, len];
      const { anchor } = addFragment('wall', dims, c, 'wall', { tx, tz, amp: fallen ? 0.2 : 0.1 });

      // Cracks: thin dark lines painted on the outer face (not solid).
      if (rng.chance(0.55)) {
        const hc = rng.range(1.0, Math.min(2.6, Hp * 0.8));
        const along = rng.range(-len / 3, len / 3);
        const yRel = rng.range(-Hp / 3, Hp / 3);
        const face = wt / 2 + 0.015;
        const cc = wd.axis === 'x' ? [along, yRel, wd.out[2] * face] : [wd.out[0] * face, yRel, along];
        const cdims = wd.axis === 'x' ? [0.07, hc, 0.03] : [0.03, hc, 0.07];
        const cAnchor = new Anchor({ parent: anchor, home: localHome(cc, { tz: rng.range(-0.25, 0.25) }) });
        const crack = makeItem({ partId, role: 'crack', kind: 'box', dims: cdims, mat: 'crack', anchor: cAnchor, solid: false, cast: false });
        crack.id = nextId('crack');
        items.push(crack);
      }
    }
  }

  // ── Floors: interior slabs in strips, a few missing, a few sagging.
  for (let f = 0; f < floors; f++) {
    const m = rng.int(2, 3);
    const inner = w - 2 * wt;
    const sw = inner / m;
    for (let i = 0; i < m; i++) {
      if (f > 0 && rng.chance(0.12)) continue;
      const x = -inner / 2 + sw * (i + 0.5);
      const y = f * floorH + 0.15;
      const sag = rng.chance(0.15);
      addFragment(
        'floor',
        [sw - 0.3, 0.3, d - 2 * wt],
        [x, y + (sag ? rng.range(-0.3, 0.1) : 0), 0],
        'floor',
        { tx: sag ? rng.range(-0.05, 0.05) : 0, tz: sag ? rng.range(-0.05, 0.05) : 0, amp: 0.08 },
      );
    }
  }

  // ── Roof: two broken pitched planes, planks in strips, gaps between.
  let rise = 0;
  if (roof) {
    rise = rng.range(2.0, 3.0);
    const reach = d / 2 + 0.4;
    const Lp = Math.hypot(reach, rise);
    const alpha = Math.atan2(rise, reach);
    for (const s of [1, -1]) {
      const m = rng.int(3, 5);
      const totalW = w + 0.8;
      const pw = totalW / m;
      for (let i = 0; i < m; i++) {
        if (rng.chance(0.14)) continue;
        const x = -totalW / 2 + pw * (i + 0.5);
        const yc = H + rise / 2;
        const zc = (s * reach) / 2;
        const fallen = rng.chance(0.15);
        const c = fallen ? [x, yc + rng.range(0.4, 0.9), zc + s * rng.range(0.2, 0.6)] : [x, yc, zc];
        addFragment('roof', [pw - 0.3, 0.3, Lp], c, 'roof', {
          tx: s * alpha + (fallen ? rng.range(-0.12, 0.12) : 0),
          tz: fallen ? rng.range(-0.08, 0.08) : 0,
          amp: fallen ? 0.25 : 0.12,
        });
      }
    }
  }

  // ── Chimney: a stack that has split into two pieces, the top one floating.
  if (chimney && roof && rng.chance(0.6)) {
    const cx = (w * 0.25) * rng.sign();
    const cz = -d * 0.12;
    const yRoof = H + rise * (1 - Math.abs(cz) / (d / 2 + 0.4));
    addFragment('chimney', [1.0, 1.8, 1.0], [cx, yRoof + 0.9, cz], 'chimney', { amp: 0.06 });
    addFragment('chimney', [1.1, 1.1, 1.1], [cx + rng.range(-0.6, 0.6), yRoof + 3.0, cz + rng.range(-0.5, 0.5)], 'chimney', {
      tx: rng.range(-0.15, 0.15),
      tz: rng.range(-0.15, 0.15),
      amp: 0.3,
    });
  }

  // ── Optional tower (chapel): stacked fragments with gaps, then a detached spire.
  let towerTop = 0;
  if (tower) {
    const tw = tower.size;
    const cx = w / 2 - tw / 2;
    const cz = d / 2 - tw / 2;
    const pieces = 4;
    const each = tower.height / pieces;
    let y = 0;
    for (let i = 0; i < pieces; i++) {
      const ph = each - 0.5;
      const off = i === pieces - 1 ? rng.range(0.3, 0.6) : rng.range(-0.15, 0.15);
      addFragment('tower', [tw, ph, tw], [cx + off, y + ph / 2, cz - off * 0.5], 'wall', { amp: 0.15 });
      y += each;
    }
    towerTop = y;
    const spireH = tw * 2.6;
    addFragment('spire', [tw * 1.4, spireH, tw * 1.4], [cx + 0.5, y + spireH / 2 + 1.8, cz], 'roof', {
      tz: 0.1,
      amp: 0.35,
    });
    // The spire is a cone in the mesh, a box in collision: same footprint.
    items[items.length - 1].kind = 'cone';
    items[items.length - 1].dims = [tw * 0.9, spireH];
    items[items.length - 1].half = [tw * 0.9, spireH / 2, tw * 0.9];
    items[items.length - 1].reach = Math.hypot(tw * 0.9, spireH / 2, tw * 0.9);
    towerTop = y + spireH + 1.8;
  }

  return {
    root,
    items,
    footprint: { hw: w / 2 + 1.2, hd: d / 2 + 1.2 },
    top: Math.max(H + rise + 0.5, towerTop),
  };
}
