// Vehicle body built once in local space (+X forward, +Y up, +Z right) and instanced.
import { MeshBuilder } from './mesh.js';
import { MAT } from './materials.js';
import { box, cylinder } from './primitives.js';

export function buildCarModel() {
  const mb = new MeshBuilder(1 << 12);
  const X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1];
  box(mb, [0, 0.62, 0], Z, Y, X, 0.9, 0.27, 2.2, MAT.CAR_PAINT);          // body
  box(mb, [-0.2, 1.12, 0], Z, Y, X, 0.8, 0.26, 1.2, MAT.GLASS);           // greenhouse
  for (const x of [-1.4, 1.4]) {
    for (const z of [-0.95, 0.55]) {
      cylinder(mb, [x, 0.34, z], Z, 0.34, 0.34, 0.4, 16, MAT.TIRE);      // wheels
    }
  }
  box(mb, [2.21, 0.62, 0.6], Z, Y, X, 0.18, 0.07, 0.02, MAT.EMISSIVE);   // headlights
  box(mb, [2.21, 0.62, -0.6], Z, Y, X, 0.18, 0.07, 0.02, MAT.EMISSIVE);
  box(mb, [-2.21, 0.62, 0.6], Z, Y, X, 0.18, 0.07, 0.02, MAT.LAMP_HOUSING);
  box(mb, [-2.21, 0.62, -0.6], Z, Y, X, 0.18, 0.07, 0.02, MAT.LAMP_HOUSING);
  return mb.result();
}
