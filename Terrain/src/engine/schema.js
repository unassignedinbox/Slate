// Parameter schema helpers. Every layer type declares its controls with these; the inspector is built from them.
// Types: num (slider + number), int, sel (select), bool, color (hex), paint (brush-painted mask data).

export const num = (k, label, def, min, max, step = 0.01, extra = {}) => ({ k, label, t: 'num', def, min, max, step, ...extra });
export const int = (k, label, def, min, max, extra = {}) => ({ k, label, t: 'int', def, min, max, step: 1, ...extra });
export const sel = (k, label, def, options) => ({ k, label, t: 'sel', def, options: options.map((o) => (Array.isArray(o) ? o : [o, o])) });
export const bool = (k, label, def) => ({ k, label, t: 'bool', def });
export const color = (k, label, def) => ({ k, label, t: 'color', def });
export const seedParam = (def = 1) => int('seed', 'Seed', def, 1, 9999);

// Common controls shared by noise driven generators.
export const noiseParams = [
  num('scale', 'Scale', 2, 0.2, 12, 0.05),
  num('offsetX', 'Offset X', 0, -1, 1, 0.01),
  num('offsetY', 'Offset Y', 0, -1, 1, 0.01),
  num('rotation', 'Rotation [deg]', 0, -180, 180, 1),
  int('octaves', 'Octaves', 6, 1, 10),
  num('lacunarity', 'Lacunarity', 2, 1.2, 3.5, 0.05),
  num('gain', 'Gain', 0.5, 0.05, 0.95, 0.01),
  seedParam(428),
];

// Turns a declared schema into a defaults object.
export function defaultsOf(params) {
  const out = {};
  for (const p of params) out[p.k] = p.def;
  return out;
}
