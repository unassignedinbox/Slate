// Layer definition factory. A definition is the single source of truth for one Gaea-equivalent node:
// its catalogue number, category, output kind, parameter schema, implementation and honesty status.
//   kind: 'height' (returns height), 'color' (returns colour), 'map' (returns a named scalar/vector map),
//         'mask' (mask generator), 'blend' (blend mode), 'util' (pipeline / inspection), 'veg' (vegetation).
//   status: 'full' = implemented as its own algorithm; 'approx' = functional equivalent with simplified physics.
import { defaultsOf } from './schema.js';

export function makeDef({ id, key, name, cat, kind = 'height', params = [], desc = '', status = 'full', run }) {
  return { id, key, name, cat, kind, params, desc, status, run, defaults: defaultsOf(params) };
}
