// Floating furniture and debris.
//
// Each prop is a root anchor (which bobs and turns slowly, as if nothing is
// holding it up) with a handful of primitive parts. Only the bulky parts are
// solid; thin legs, spokes and pipes are decoration so the car does not snag.

import { Anchor } from '../../engine/anchor.js';
import { mat4Translation, mat4RotY, mat4RotX, mat4RotZ, mat4Mul } from '../../engine/math.js';
import { makeItem } from './items.js';

const T = (x, y, z) => mat4Translation([x, y, z]);
const RY = (a) => mat4RotY(a);
const RX = (a) => mat4RotX(a);
const RZ = (a) => mat4RotZ(a);
const at = (x, y, z, rot = null) => (rot ? mat4Mul(T(x, y, z), rot) : T(x, y, z));

// A part description: kind/dims/mat/solid plus a local transform.
const box = (dims, x, y, z, mat, solid = true, rot = null) => ({ kind: 'box', dims, mat, solid, local: at(x, y, z, rot) });
const cyl = (r, h, x, y, z, mat, solid = true, rot = null) => ({ kind: 'cyl', dims: [r, h], mat, solid, local: at(x, y, z, rot) });
const torus = (R, tube, x, y, z, mat, rot = null) => ({ kind: 'torus', dims: [R, tube], mat, solid: false, local: at(x, y, z, rot) });
const dodeca = (r, x, y, z, mat) => ({ kind: 'dodeca', dims: [r], mat, solid: true, local: at(x, y, z) });

export const PROP_TYPES = {
  chair: { weight: 3 },
  table: { weight: 2 },
  wardrobe: { weight: 2 },
  bed: { weight: 2 },
  bookcase: { weight: 2 },
  barrel: { weight: 2 },
  crate: { weight: 3 },
  cart: { weight: 1 },
  lamp: { weight: 1 },
  wagonWheel: { weight: 1 },
  rubble: { weight: 4 },
  plank: { weight: 3 },
  pipe: { weight: 1 },
  bucket: { weight: 1 },
};

// Build the part list for a prop type. Dimensions are jittered a little so no
// two props look identical.
export function propParts(type, rng) {
  const j = (v, amt = 0.12) => v * rng.range(1 - amt, 1 + amt);
  switch (type) {
    case 'chair':
      return [
        box([0.5, 0.06, 0.5], 0, 0.46, 0, 'wood'),
        box([0.5, 0.5, 0.05], 0, 0.95, -0.22, 'wood'),
        box([0.05, 0.46, 0.05], 0.2, 0.23, 0.2, 'wood', false),
        box([0.05, 0.46, 0.05], -0.2, 0.23, 0.2, 'wood', false),
        box([0.05, 0.46, 0.05], 0.2, 0.23, -0.2, 'wood', false),
        box([0.05, 0.46, 0.05], -0.2, 0.23, -0.2, 'wood', false),
      ];
    case 'table':
      return [
        box([1.2, 0.06, 0.7], 0, 0.75, 0, 'wood'),
        box([0.06, 0.72, 0.06], 0.5, 0.36, 0.28, 'wood', false),
        box([0.06, 0.72, 0.06], -0.5, 0.36, 0.28, 'wood', false),
        box([0.06, 0.72, 0.06], 0.5, 0.36, -0.28, 'wood', false),
        box([0.06, 0.72, 0.06], -0.5, 0.36, -0.28, 'wood', false),
      ];
    case 'wardrobe': {
      const h = j(2.0, 0.1);
      return [
        box([1.2, h, 0.6], 0, h / 2, 0, 'wood'),
        box([1.26, 0.12, 0.66], 0, h + 0.06, 0, 'trim'),
        box([0.03, h * 0.9, 0.02], 0, h / 2, 0.31, 'trim', false),
      ];
    }
    case 'bed':
      return [
        box([1.0, 0.3, 2.0], 0, 0.2, 0, 'wood'),
        box([1.0, 0.8, 0.08], 0, 0.55, -0.96, 'wood'),
        box([0.95, 0.18, 1.9], 0, 0.39, 0, 'fabric', false),
      ];
    case 'bookcase': {
      const h = j(1.9, 0.1);
      return [
        box([1.0, h, 0.35], 0, h / 2, 0, 'wood'),
        box([0.9, 0.04, 0.3], 0, h * 0.5, 0.02, 'trim', false),
        box([0.9, 0.04, 0.3], 0, h * 0.25, 0.02, 'trim', false),
      ];
    }
    case 'barrel': {
      const r = j(0.42, 0.08);
      return [cyl(r, 0.95, 0, 0.475, 0, 'wood')];
    }
    case 'crate': {
      const s = j(0.8, 0.3);
      return [box([s, s, s], 0, s / 2, 0, 'wood')];
    }
    case 'cart':
      return [
        box([1.4, 0.25, 0.9], 0, 0.6, 0, 'wood'),
        torus(0.42, 0.06, -0.75, 0.42, 0, 'metal', RY(Math.PI / 2)),
        torus(0.42, 0.06, 0.75, 0.42, 0, 'metal', RY(Math.PI / 2)),
        box([1.6, 0.07, 0.07], -1.2, 0.8, 0, 'metal', false),
      ];
    case 'lamp':
      return [
        cyl(0.07, 3.6, 0, 1.8, 0, 'metal', false),
        cyl(0.25, 0.35, 0, 3.7, 0, 'metal', false),
      ];
    case 'wagonWheel': {
      const R = j(1.1, 0.1);
      return [
        torus(R, 0.1, 0, R, 0, 'metal'),
        box([2 * R, 0.08, 0.08], 0, R, 0, 'metal', false),
        box([0.08, 2 * R, 0.08], 0, R, 0, 'metal', false),
        cyl(0.18, 0.3, 0, R, 0, 'metal', false, RX(Math.PI / 2)),
      ];
    }
    case 'rubble': {
      const r = j(0.7, 0.45);
      return [dodeca(r, 0, r, 0, 'rubble')];
    }
    case 'plank':
      return [box([j(3.4, 0.2), 0.12, 0.4], 0, 0.06, 0, 'wood')];
    case 'pipe': {
      const len = j(4.0, 0.2);
      return [cyl(0.14, len, 0, 0, 0, 'metal', false, RZ(Math.PI / 2))];
    }
    case 'bucket':
      return [cyl(0.24, 0.45, 0, 0.225, 0, 'metal', false)];
    default:
      throw new Error(`Unknown prop type: ${type}`);
  }
}

// Create a floating prop at `pos` with yaw `yaw`. Returns { root, items, reach }.
export function makeFloatingProp({ rng, partId, type, pos, yaw, idPrefix }) {
  const drift = rng.range(0.18, 0.45);
  const spin = rng.range(0.03, 0.12) * rng.sign();
  const root = new Anchor({
    home: mat4Mul(T(pos[0], pos[1], pos[2]), RY(yaw)),
    wob: {
      ay: rng.range(0.25, 0.55),
      ax: 0.15,
      az: 0.15,
      rx: 0.03,
      rz: 0.03,
      w: drift,
      p: rng.range(0, 6.283),
      spinY: spin,
    },
  });
  const items = [];
  propParts(type, rng).forEach((part, i) => {
    const anchor = new Anchor({ parent: root, home: part.local });
    const item = makeItem({ partId, role: 'prop', kind: part.kind, dims: part.dims, mat: part.mat, anchor, solid: part.solid, cast: true });
    item.id = `${idPrefix}-${type}-${i}`;
    items.push(item);
  });
  return { root, items };
}
