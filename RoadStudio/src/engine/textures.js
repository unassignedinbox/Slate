// Texture layer library. Each entry defines a procedural layer type that the
// fragment shader evaluates in order. The shader index equals `id` below.
export const LAYER_TYPES = [
  { id: 0, key: 'aggregate', label: 'Asphalt aggregate', group: 'Base', params: [] },
  { id: 1, key: 'chip', label: 'Chip seal speckle', group: 'Surface', params: [] },
  { id: 2, key: 'cracks', label: 'Hairline cracks', group: 'Damage', params: [['Crack density', 0, 3, 0.1]] },
  { id: 3, key: 'alligator', label: 'Fatigue (alligator) cracking', group: 'Damage', params: [['Pattern density', 0, 3, 0.1]] },
  { id: 4, key: 'patch', label: 'Patch repair', group: 'Repair', params: [['Patch frequency', 0, 1, 0.05]] },
  { id: 5, key: 'tirewear', label: 'Tire polish bands', group: 'Wear', params: [] },
  { id: 6, key: 'oil', label: 'Oil & fluid stains', group: 'Wear', params: [['Stain amount', 0, 1, 0.05]] },
  { id: 7, key: 'grime', label: 'Dust & grime', group: 'Wear', params: [] },
  { id: 8, key: 'slabs', label: 'Concrete slabs', group: 'Paving', params: [['Slab size (m)', 0.3, 4, 0.05], ['Joint width (m)', 0.002, 0.04, 0.001]] },
  { id: 9, key: 'bricks', label: 'Clay brick pavers', group: 'Paving', params: [['Brick length (m)', 0.1, 0.4, 0.005], ['Brick height (m)', 0.04, 0.12, 0.002], ['Mortar (m)', 0.004, 0.03, 0.001]] },
  { id: 10, key: 'setts', label: 'Granite setts', group: 'Paving', params: [['Sett size (m)', 0.1, 0.6, 0.01], ['Gap (m)', 0.002, 0.03, 0.001]] },
  { id: 11, key: 'gravel', label: 'Gravel & sand', group: 'Surface', params: [] },
  { id: 12, key: 'wet', label: 'Wet sheen', group: 'Wear', params: [] },
  { id: 13, key: 'paint', label: 'Paint scuffs', group: 'Wear', params: [] },
];

export const BLEND = { normal: 0, multiply: 1, add: 2 };
export const MASK = { none: 0, lanes: 1, curb: 2, blotch: 3 };
export const STACK_SLOTS = 8;
export const STACK_NAMES = { asphalt: 'Carriageway (asphalt)', paving: 'Sidewalk & plaza (paving)' };

const TYPE_BY_KEY = Object.fromEntries(LAYER_TYPES.map((t) => [t.key, t]));
export const typeOf = (key) => TYPE_BY_KEY[key];

export function newLayer(key) {
  const t = TYPE_BY_KEY[key];
  const defaults = t.params.map((p) => p[1] + (p[2] - p[1]) * 0.25);
  const p = [0, 0, 0, 0].map((_, i) => defaults[i] ?? 0);
  if (key === 'slabs') { p[0] = 1.5; p[1] = 0.012; }
  if (key === 'bricks') { p[0] = 0.215; p[1] = 0.065; p[2] = 0.01; }
  if (key === 'setts') { p[0] = 0.2; p[1] = 0.01; }
  return {
    key, enabled: true, opacity: 1, scale: 1, intensity: 0.7, roughness: 0.8,
    color: [0.5, 0.5, 0.5], blend: 'normal', mask: 'none', p,
  };
}

// Packs both stacks into a flat Float32Array matching the WGSL uniform layout:
// per layer 4 vec4: [type, blend, opacity, enabled] [scale, intensity, rough, seed]
// [r, g, b, mask] [p0, p1, p2, p3]. Stacks are concatenated: asphalt, then paving.
export function packStacks(stacks) {
  const out = new Float32Array(2 * STACK_SLOTS * 16);
  ['asphalt', 'paving'].forEach((name, si) => {
    const list = (stacks[name] || []).slice(0, STACK_SLOTS);
    list.forEach((L, li) => {
      const t = TYPE_BY_KEY[L.key];
      const base = (si * STACK_SLOTS + li) * 16;
      const v = [
        t ? t.id : 0, BLEND[L.blend] ?? 0, L.opacity, L.enabled ? 1 : 0,
        L.scale, L.intensity, L.roughness, (li + 1) * 7.31 + si * 3.7,
        L.color[0], L.color[1], L.color[2], MASK[L.mask] ?? 0,
        L.p[0] ?? 0, L.p[1] ?? 0, L.p[2] ?? 0, L.p[3] ?? 0,
      ];
      out.set(v, base);
    });
  });
  return out;
}
