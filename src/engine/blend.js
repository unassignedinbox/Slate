// Slate — combiners / blend modes #129–152. Scalar fns: fn(base, layer, t).
import { clamp, lerp } from './util.js';

const B = (n, id, name, desc, fn) => ({ n, id, name, desc, fn });
const safe = (v) => (Number.isFinite(v) ? v : 0);

export const BLENDS = [
  B(129, 'add', 'Add', 'Additive: base + layer', (a, b, t) => a + b * t),
  B(130, 'subtract', 'Subtract', 'Subtractive: base − layer', (a, b, t) => a - b * t),
  B(131, 'multiply', 'Multiply', 'Multiplicative: base × layer', (a, b, t) => lerp(a, a * b, t)),
  B(132, 'divide', 'Divide', 'Division: base ÷ layer', (a, b, t) => lerp(a, safe(a / Math.max(1e-4, b)), t)),
  B(133, 'max', 'Max', 'Take maximum (lighten to peak)', (a, b, t) => lerp(a, Math.max(a, b), t)),
  B(134, 'min', 'Min', 'Take minimum (darken to pit)', (a, b, t) => lerp(a, Math.min(a, b), t)),
  B(135, 'average', 'Average', 'Mean of base and layer', (a, b, t) => lerp(a, (a + b) / 2, t)),
  B(136, 'blend', 'Blend', 'Linear interpolation (normal alpha)', (a, b, t) => lerp(a, b, t)),
  B(137, 'overlay', 'Overlay', 'Overlay: multiply darks, screen lights', (a, b, t) => {
    const v = a < 0.5 ? 2 * a * b : 1 - 2 * (1 - a) * (1 - b);
    return lerp(a, v, t);
  }),
  B(138, 'screen', 'Screen', 'Screen: inverse multiply', (a, b, t) => lerp(a, 1 - (1 - a) * (1 - b), t)),
  B(139, 'darken', 'Darken', 'Darken: per-pixel minimum', (a, b, t) => lerp(a, Math.min(a, b), t)),
  B(140, 'lighten', 'Lighten', 'Lighten: per-pixel maximum', (a, b, t) => lerp(a, Math.max(a, b), t)),
  B(141, 'difference', 'Difference', 'Absolute difference', (a, b, t) => lerp(a, Math.abs(a - b), t)),
  B(142, 'exclusion', 'Exclusion', 'Soft difference', (a, b, t) => lerp(a, a + b - 2 * a * b, t)),
  B(143, 'soft-light', 'Soft Light', 'Gentle contrast lift', (a, b, t) => {
    const v = b < 0.5 ? a - (1 - 2 * b) * a * (1 - a) : a + (2 * b - 1) * (Math.sqrt(Math.max(0, a)) - a);
    return lerp(a, v, t);
  }),
  B(144, 'hard-light', 'Hard Light', 'Strong contrast (overlay swapped)', (a, b, t) => {
    const v = b < 0.5 ? 2 * a * b : 1 - 2 * (1 - a) * (1 - b);
    return lerp(a, v, t);
  }),
  B(145, 'color-dodge', 'Color Dodge', 'Brighten by layer (division)', (a, b, t) =>
    lerp(a, b >= 1 ? 1 : safe(a / Math.max(1e-4, 1 - b)), t)),
  B(146, 'color-burn', 'Color Burn', 'Darken by layer (inverse division)', (a, b, t) =>
    lerp(a, b <= 0 ? 0 : 1 - safe((1 - a) / Math.max(1e-4, b)), t)),
  B(147, 'linear-dodge', 'Linear Dodge', 'Linear brighten (add, clamped)', (a, b, t) => lerp(a, clamp(a + b), t)),
  B(148, 'linear-burn', 'Linear Burn', 'Linear darken (add − 1, clamped)', (a, b, t) => lerp(a, clamp(a + b - 1), t)),
  B(149, 'vivid-light', 'Vivid Light', 'Dodge light tones, burn dark tones', (a, b, t) => {
    const v = b < 0.5
      ? (b <= 0 ? 0 : 1 - safe((1 - a) / Math.max(1e-4, 2 * b)))
      : (b >= 1 ? 1 : safe(a / Math.max(1e-4, 2 * (1 - b))));
    return lerp(a, v, t);
  }),
  B(150, 'linear-light', 'Linear Light', 'Linear dodge/burn around mid', (a, b, t) => lerp(a, clamp(a + 2 * b - 1), t)),
  B(151, 'pin-light', 'Pin Light', 'Darken lights / lighten darks toward layer', (a, b, t) => {
    const v = b < 0.5 ? Math.min(a, 2 * b) : Math.max(a, 2 * b - 1);
    return lerp(a, v, t);
  }),
  B(152, 'hard-mix', 'Hard Mix', 'Posterized vivid mix', (a, b, t) => lerp(a, a + b >= 1 ? 1 : 0, t)),
];
export const BLEND_MAP = Object.fromEntries(BLENDS.map((b) => [b.id, b]));
