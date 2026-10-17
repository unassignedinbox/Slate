// Items are the renderable, optionally solid or drivable, parts of the level.
//
//   kind   'box' (dims [x,y,z]) | 'cyl' ([r,h]) | 'cone' ([r,h]) | 'dodeca' ([r])
//          | 'torus' ([R,tube]) | 'plane' ([w,h])
//   mat    palette key (see render/materials.js)
//   solid  blocks the car (a sphere-vs-box test against `half`)
//   ground drivable surface (the wheel probes land on it)
//   anchor scene-graph node that supplies the world transform each frame

import { mat4Position } from '../../engine/math.js';

export function halfExtents(kind, dims) {
  switch (kind) {
    case 'box':
      return [dims[0] / 2, dims[1] / 2, dims[2] / 2];
    case 'cyl':
    case 'cone':
      return [dims[0], dims[1] / 2, dims[0]];
    case 'dodeca':
      return [dims[0], dims[0], dims[0]];
    default:
      return null; // torus and plane are never solid
  }
}

export function makeItem({ partId, role, kind, dims, mat, anchor, solid = false, ground = false, cast = true }) {
  const half = solid || ground ? halfExtents(kind, dims) : null;
  return {
    partId,
    role,
    kind,
    dims,
    mat,
    anchor,
    solid,
    ground,
    cast,
    half,
    reach: half ? Math.hypot(half[0], half[1], half[2]) : 0,
    staticCenter: null,
  };
}

// Fill in the cached "static centre" used for cheap culling. Call once after
// the anchor graph for the item is complete.
export function finalizeItem(item) {
  item.staticCenter = mat4Position(item.anchor.homeWorld());
  return item;
}
