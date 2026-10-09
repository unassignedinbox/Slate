// 129-152 Combiners / blend modes. The same formulas serve three roles:
//   1. per-layer blend mode (how a layer's output combines with what is below it),
//   2. "Combine" layers (combine the stack below with the nearest cached snapshot),
//   3. channel combination in the colour / map paths.
import { makeDef } from './def.js';
import { num, sel } from './schema.js';
import { clamp } from './grid.js';

const soft = (a, b) => (b < 0.5 ? a - (1 - 2 * b) * a * (1 - a) : a + (2 * b - 1) * (Math.sqrt(a) - a));
const colorBurn = (a, b) => (b <= 0 ? 0 : 1 - Math.min(1, (1 - a) / b));
const colorDodge = (a, b) => (b >= 1 ? 1 : Math.min(1, a / (1 - b)));

export const BLEND_MODES = [
  { id: 129, key: 'add', name: 'Add', fn: (a, b) => a + b },
  { id: 130, key: 'subtract', name: 'Subtract', fn: (a, b) => a - b },
  { id: 131, key: 'multiply', name: 'Multiply', fn: (a, b) => a * b },
  { id: 132, key: 'divide', name: 'Divide', fn: (a, b) => a / Math.max(1e-4, b) },
  { id: 133, key: 'max', name: 'Max', fn: (a, b) => Math.max(a, b) },
  { id: 134, key: 'min', name: 'Min', fn: (a, b) => Math.min(a, b) },
  { id: 135, key: 'average', name: 'Average', fn: (a, b) => (a + b) / 2 },
  { id: 136, key: 'blend', name: 'Blend', fn: (a, b) => b },
  { id: 137, key: 'overlay', name: 'Overlay', fn: (a, b) => (a < 0.5 ? 2 * a * b : 1 - 2 * (1 - a) * (1 - b)) },
  { id: 138, key: 'screen', name: 'Screen', fn: (a, b) => 1 - (1 - a) * (1 - b) },
  { id: 139, key: 'darken', name: 'Darken', fn: (a, b) => Math.min(a, b) },
  { id: 140, key: 'lighten', name: 'Lighten', fn: (a, b) => Math.max(a, b) },
  { id: 141, key: 'difference', name: 'Difference', fn: (a, b) => Math.abs(a - b) },
  { id: 142, key: 'exclusion', name: 'Exclusion', fn: (a, b) => a + b - 2 * a * b },
  { id: 143, key: 'softlight', name: 'Soft Light', fn: soft },
  { id: 144, key: 'hardlight', name: 'Hard Light', fn: (a, b) => (b < 0.5 ? 2 * a * b : 1 - 2 * (1 - a) * (1 - b)) },
  { id: 145, key: 'colordodge', name: 'Color Dodge', fn: colorDodge },
  { id: 146, key: 'colorburn', name: 'Color Burn', fn: colorBurn },
  { id: 147, key: 'lineardodge', name: 'Linear Dodge', fn: (a, b) => a + b },
  { id: 148, key: 'linearburn', name: 'Linear Burn', fn: (a, b) => a + b - 1 },
  { id: 149, key: 'vividlight', name: 'Vivid Light', fn: (a, b) => (b < 0.5 ? colorBurn(a, 2 * b) : colorDodge(a, 2 * b - 1)) },
  { id: 150, key: 'linearlight', name: 'Linear Light', fn: (a, b) => a + 2 * b - 1 },
  { id: 151, key: 'pinlight', name: 'Pin Light', fn: (a, b) => (b < 0.5 ? Math.min(a, 2 * b) : Math.max(a, 2 * b - 1)) },
  { id: 152, key: 'hardmix', name: 'Hard Mix', fn: (a, b) => (a + b >= 1 ? 1 : 0) },
];

export const blendFn = Object.fromEntries(BLEND_MODES.map((m) => [m.key, m.fn]));
export const blendOptions = BLEND_MODES.map((m) => [m.key, m.name]);

// Blend a single pair and clamp to the unit interval.
export const blendValue = (mode, a, b) => clamp(blendFn[mode] ? blendFn[mode](a, b) : b);

// Combine helper used by the stack and by Combine layers. `src` is the top input, `w` is per-cell weight or scalar.
export function combineGrid(base, src, mode, w) {
  const f = blendFn[mode] ?? blendFn.blend;
  const out = new Float32Array(base.length);
  const scalar = typeof w === 'number';
  for (let i = 0; i < base.length; i++) {
    const t = scalar ? w : w[i];
    if (t <= 0) { out[i] = base[i]; continue; }
    const b = clamp(f(base[i], src[i]));
    out[i] = base[i] + (b - base[i]) * t;
  }
  return out;
}

// Combiner layers: take the nearest cached snapshot as the second input and combine it with the live stack.
const combineDef = (mode, idx) => makeDef({
  id: mode.id, key: `combine_${mode.key}`, name: `Combine: ${mode.name}`, cat: 'Combiners',
  params: [sel('source', 'Second input', 'snapshot', [['snapshot', 'Nearest cache snapshot'], ['inverse', 'Inverse of stack']]), num('amount', 'Amount', 1, 0, 1, 0.01)],
  desc: `Combines the stack below with a second input using ${mode.name}. Second input is the nearest Cache snapshot below, or the inverse of the stack.`,
  run: (ctx, p, layer, env) => {
    let src = null;
    if (p.source === 'snapshot') {
      const snap = env.nearestSnapshot();
      if (snap) src = snap.H;
    }
    if (!src) src = Float32Array.from(ctx.H, (v) => 1 - v);
    const out = combineGrid(ctx.H, src, mode.key, p.amount);
    return { height: out };
  },
});

export const blendDefs = BLEND_MODES.map((m, i) => combineDef(m, i));
