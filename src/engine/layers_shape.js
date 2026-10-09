// Slate — shape generators #29–52 (macro landforms).
import { clamp, smoothstep, lerp, TAU } from './util.js';
import { perlin, simplex, valueNoise, fbm, ridged, billow, worley } from './noise.js';

const P = (k, label, min, max, step, def, unit = '', hint = '') =>
  ({ k, label, min, max, step, def, unit, hint, type: 'slider' });
const SEED = P('seed', 'Seed', 0, 9999, 1, 7);
const L = (n, id, name, desc, params, run, extra = {}) =>
  ({ n, id, name, cat: 'shape', desc, targets: ['height'], params, run, ...extra });

function fill(ctx, S, cb) {
  const n = ctx.n;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++)
    S.h[y * n + x] = cb(x, y, x / (n - 1), y / (n - 1));
}
const fall = (d, inner, outer) => 1 - smoothstep(inner, outer, d); // 1 inside -> 0 outside
const mound = (d, sharp = 2) => clamp(1 - d ** sharp, 0, 1);

export const LAYERS_SHAPE = [
  L(29, 'grad-linear', 'Gradient Linear', 'Linear ramp across the tile.', [
    P('angle', 'Angle', 0, 360, 1, 0, '°'), P('lo', 'Low', 0, 1, 0.01, 0), P('hi', 'High', 0, 1, 0.01, 1),
  ], (ctx, p, S) => fill(ctx, S, (x, y, u, v) => {
    const a = (p.angle * Math.PI) / 180;
    return lerp(p.lo, p.hi, clamp((u - 0.5) * Math.cos(a) + (v - 0.5) * Math.sin(a) + 0.5));
  })),
  L(30, 'grad-radial', 'Gradient Radial', 'Radial falloff from a point.', [
    P('x', 'Center X', 0, 1, 0.005, 0.5), P('y', 'Center Y', 0, 1, 0.005, 0.5),
    P('inner', 'Inner', 0, 1, 0.01, 0), P('outer', 'Outer', 0.01, 1.5, 0.01, 0.7), P('invert', 'Invert', 0, 1, 1, 0),
  ], (ctx, p, S) => fill(ctx, S, (x, y, u, v) => {
    const d = Math.hypot(u - p.x, v - p.y);
    const m = 1 - smoothstep(p.inner, Math.max(p.inner + 1e-4, p.outer), d);
    return p.invert ? 1 - m : m;
  })),
  L(31, 'grad-angular', 'Gradient Angular', 'Angular sweep 0→1 around center.', [
    P('x', 'Center X', 0, 1, 0.005, 0.5), P('y', 'Center Y', 0, 1, 0.005, 0.5), P('offset', 'Offset', 0, 360, 1, 0, '°'),
  ], (ctx, p, S) => fill(ctx, S, (x, y, u, v) => {
    let a = Math.atan2(v - p.y, u - p.x) - (p.offset * Math.PI) / 180;
    return (((a % TAU) + TAU) % TAU) / TAU;
  })),
  L(32, 'grad-square', 'Gradient Square', 'Square (chebyshev) falloff.', [
    P('x', 'Center X', 0, 1, 0.005, 0.5), P('y', 'Center Y', 0, 1, 0.005, 0.5),
    P('inner', 'Inner', 0, 1, 0.01, 0.1), P('outer', 'Outer', 0.01, 1, 0.01, 0.5), P('invert', 'Invert', 0, 1, 1, 0),
  ], (ctx, p, S) => fill(ctx, S, (x, y, u, v) => {
    const d = Math.max(Math.abs(u - p.x), Math.abs(v - p.y));
    const m = 1 - smoothstep(p.inner, Math.max(p.inner + 1e-4, p.outer), d);
    return p.invert ? 1 - m : m;
  })),
  L(33, 'shape-circle', 'Shape Circle', 'Circular mound.', [
    P('x', 'Center X', 0, 1, 0.005, 0.5), P('y', 'Center Y', 0, 1, 0.005, 0.5),
    P('radius', 'Radius', 0.02, 0.75, 0.01, 0.3), P('sharp', 'Sharpness', 0.5, 6, 0.1, 2), P('height', 'Height', 0, 1, 0.01, 1),
  ], (ctx, p, S) => fill(ctx, S, (x, y, u, v) =>
    mound(Math.hypot(u - p.x, v - p.y) / p.radius, p.sharp) * p.height)),
  L(34, 'shape-square', 'Shape Square', 'Square mound.', [
    P('x', 'Center X', 0, 1, 0.005, 0.5), P('y', 'Center Y', 0, 1, 0.005, 0.5),
    P('size', 'Half-size', 0.02, 0.6, 0.01, 0.25), P('sharp', 'Sharpness', 0.5, 6, 0.1, 2), P('height', 'Height', 0, 1, 0.01, 1),
  ], (ctx, p, S) => fill(ctx, S, (x, y, u, v) =>
    mound(Math.max(Math.abs(u - p.x), Math.abs(v - p.y)) / p.size, p.sharp) * p.height)),
  L(35, 'shape-triangle', 'Shape Triangle', 'Triangular mound.', [
    P('x', 'Center X', 0, 1, 0.005, 0.5), P('y', 'Center Y', 0, 1, 0.005, 0.5),
    P('size', 'Size', 0.02, 0.75, 0.01, 0.32), P('rot', 'Rotation', 0, 360, 1, 0, '°'), P('height', 'Height', 0, 1, 0.01, 1),
  ], (ctx, p, S) => fill(ctx, S, (x, y, u, v) => {
    const a = (p.rot * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
    const dx = (u - p.x) * ca - (v - p.y) * sa, dy = (u - p.x) * sa + (v - p.y) * ca;
    // distance to triangle edge (equilateral, point-up)
    const s = p.size;
    const d = Math.max(dy / s * 1.2 + 0.35, (Math.abs(dx) * 1.732 + 0.4 - dy * 0.2) / s - 0.9);
    return clamp(1 - d * 1.4, 0, 1) * p.height;
  })),
  L(36, 'shape-star', 'Shape Star', 'Star-shaped mound.', [
    P('x', 'Center X', 0, 1, 0.005, 0.5), P('y', 'Center Y', 0, 1, 0.005, 0.5),
    P('radius', 'Radius', 0.02, 0.75, 0.01, 0.32), P('points', 'Points', 3, 12, 1, 5), P('inner', 'Inner ratio', 0.1, 0.9, 0.05, 0.45), P('height', 'Height', 0, 1, 0.01, 1),
  ], (ctx, p, S) => fill(ctx, S, (x, y, u, v) => {
    const dx = u - p.x, dy = v - p.y;
    const a = Math.atan2(dy, dx), r = Math.hypot(dx, dy) / p.radius;
    const w = 0.5 + 0.5 * Math.cos(a * p.points);
    const edge = lerp(p.inner, 1, w ** 0.7);
    return clamp(1 - r / Math.max(1e-3, edge), 0, 1) ** 1.4 * p.height;
  })),
  L(37, 'mountain', 'Mountain', 'Single ridged mountain with scree skirt.', [
    P('x', 'Center X', 0, 1, 0.005, 0.5), P('y', 'Center Y', 0, 1, 0.005, 0.5),
    P('radius', 'Radius', 0.05, 0.75, 0.01, 0.38), P('height', 'Height', 0, 1, 0.01, 1),
    P('rugged', 'Ruggedness', 0, 1, 0.05, 0.6), P('snow', 'Snow cap', 0, 1, 0.05, 0), P('freq', 'Detail freq', 1, 32, 1, 9), SEED,
  ], (ctx, p, S) => fill(ctx, S, (x, y, u, v) => {
    const d = Math.hypot(u - p.x, v - p.y) / p.radius;
    const base = mound(d, 1.7);
    const r = ridged(perlin, u * p.freq, v * p.freq, { octaves: 5, seed: p.seed });
    const m = base * (1 - p.rugged * 0.55) + base * r * p.rugged * 1.1;
    return clamp(m * p.height + (p.snow > 0 ? smoothstep(0.55, 0.8, m) * p.snow * 0.05 : 0));
  })),
  L(38, 'volcano', 'Volcano', 'Volcanic cone with crater bowl.', [
    P('x', 'Center X', 0, 1, 0.005, 0.5), P('y', 'Center Y', 0, 1, 0.005, 0.5),
    P('radius', 'Radius', 0.05, 0.75, 0.01, 0.36), P('height', 'Height', 0, 1, 0.01, 1),
    P('crater', 'Crater size', 0.05, 0.6, 0.01, 0.28), P('rugged', 'Ruggedness', 0, 1, 0.05, 0.45), P('freq', 'Detail freq', 1, 32, 1, 8), SEED,
  ], (ctx, p, S) => fill(ctx, S, (x, y, u, v) => {
    const d = Math.hypot(u - p.x, v - p.y) / p.radius;
    const cone = mound(d, 1.35);
    const bowl = fall(d, p.crater * 0.35, p.crater);
    const r = fbm(valueNoise, u * p.freq, v * p.freq, { octaves: 4, seed: p.seed });
    return clamp((cone * (1 - bowl * 0.92) * (1 - p.rugged * 0.4 + r * p.rugged * 0.8)) * p.height);
  })),
  L(39, 'mesa', 'Mesa', 'Flat-topped elevation with cliff sides.', [
    P('x', 'Center X', 0, 1, 0.005, 0.5), P('y', 'Center Y', 0, 1, 0.005, 0.5),
    P('radius', 'Radius', 0.05, 0.75, 0.01, 0.34), P('height', 'Height', 0, 1, 0.01, 0.8),
    P('edge', 'Edge hardness', 0.5, 8, 0.1, 4), P('capNoise', 'Cap variation', 0, 0.5, 0.01, 0.08), SEED,
  ], (ctx, p, S) => fill(ctx, S, (x, y, u, v) => {
    const d = Math.hypot(u - p.x, v - p.y) / p.radius;
    const top = clamp(1 - d ** p.edge, 0, 1);
    const cap = fbm(valueNoise, u * 9, v * 9, { octaves: 3, seed: p.seed }) - 0.5;
    return clamp(smoothstep(0, 1, top) * p.height + cap * p.capNoise * top);
  })),
  L(40, 'dunes', 'Dunes', 'Wind-blown sand dune forms.', [
    P('freq', 'Frequency', 1, 40, 0.5, 9), P('angle', 'Wind angle', 0, 180, 1, 25, '°'),
    P('sharp', 'Crest sharpness', 0.5, 6, 0.1, 2.2), P('height', 'Height', 0, 1, 0.01, 0.5), P('warp', 'Warp', 0, 1, 0.05, 0.5), SEED,
  ], (ctx, p, S) => fill(ctx, S, (x, y, u, v) => {
    const a = (p.angle * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
    const w = fbm(perlin, u * 3 + 9, v * 3 + 4, { octaves: 3, seed: p.seed, signed: true }) * p.warp;
    const t = (u * ca + v * sa + w * 0.4) * p.freq;
    const tri = 1 - Math.abs((((t % 1) + 1) % 1) * 2 - 1);
    return clamp(tri ** p.sharp * p.height + fbm(valueNoise, u * 14, v * 14, { octaves: 2, seed: p.seed ^ 5 }) * 0.06);
  })),
  L(41, 'hills', 'Hills', 'Rolling billow hills.', [
    P('freq', 'Frequency', 0.5, 24, 0.5, 4), P('oct', 'Octaves', 1, 8, 1, 4), P('height', 'Height', 0, 1, 0.01, 0.6), SEED,
  ], (ctx, p, S) => fill(ctx, S, (x, y, u, v) =>
    clamp(billow(perlin, u * p.freq, v * p.freq, { octaves: p.oct, seed: p.seed }) * p.height))),
  L(42, 'ridges', 'Ridges', 'Sharp parallel ridge lines.', [
    P('freq', 'Frequency', 1, 40, 0.5, 10), P('angle', 'Angle', 0, 180, 1, 0, '°'),
    P('sharp', 'Sharpness', 0.5, 6, 0.1, 2.5), P('height', 'Height', 0, 1, 0.01, 0.7), P('warp', 'Warp', 0, 1, 0.05, 0.4), SEED,
  ], (ctx, p, S) => fill(ctx, S, (x, y, u, v) => {
    const a = (p.angle * Math.PI) / 180;
    const w = fbm(perlin, u * 4 + 2, v * 4 + 8, { octaves: 3, seed: p.seed, signed: true }) * p.warp;
    const t = 1 - Math.abs((((((u * Math.cos(a) + v * Math.sin(a)) + w * 0.35) * p.freq) % 1) + 1) % 1 * 2 - 1);
    return clamp(t ** p.sharp * p.height);
  })),
  L(43, 'crater', 'Crater', 'Impact crater with rim and bowl.', [
    P('x', 'Center X', 0, 1, 0.005, 0.5), P('y', 'Center Y', 0, 1, 0.005, 0.5),
    P('radius', 'Radius', 0.03, 0.6, 0.01, 0.25), P('depth', 'Depth', 0, 1, 0.01, 0.5),
    P('rim', 'Rim height', 0, 1, 0.01, 0.3), P('base', 'Base level', 0, 1, 0.01, 0.4), SEED,
  ], (ctx, p, S) => fill(ctx, S, (x, y, u, v) => {
    const d = Math.hypot(u - p.x, v - p.y) / p.radius;
    const bowl = d < 1 ? Math.cos(d * Math.PI * 0.5) ** 1.5 : 0;
    const rim = Math.exp(-((d - 1) ** 2) / 0.02);
    const nse = (fbm(valueNoise, u * 16, v * 16, { octaves: 2, seed: p.seed }) - 0.5) * 0.08;
    return clamp(p.base - bowl * p.depth + rim * p.rim + nse * (1 - bowl * 0.5));
  })),
  L(44, 'canyon', 'Canyon', 'Meandering canyon channel.', [
    P('width', 'Width', 0.01, 0.3, 0.005, 0.07), P('depth', 'Depth', 0, 1, 0.01, 0.5),
    P('bend', 'Meander', 0, 3, 0.1, 1.4), P('freq', 'Meander freq', 0.5, 12, 0.5, 3), P('base', 'Base level', 0, 1, 0.01, 0.55),
    P('angle', 'Angle', 0, 180, 1, 90, '°'), SEED,
  ], (ctx, p, S) => fill(ctx, S, (x, y, u, v) => {
    const a = (p.angle * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
    const along = (u - 0.5) * ca + (v - 0.5) * sa + 0.5;
    const across = -(u - 0.5) * sa + (v - 0.5) * ca;
    const bend = fbm(perlin, along * p.freq * 2, p.seed * 0.13, { octaves: 3, seed: p.seed, signed: true }) * 0.22 * p.bend;
    const d = Math.abs(across - bend) / p.width;
    const chan = Math.exp(-d * d * 2.2);
    const strata = 0.5 + 0.5 * Math.sin((p.base - chan * p.depth) * 40);
    return clamp(p.base - chan * p.depth + strata * 0.012 * chan);
  })),
  L(45, 'plain', 'Plain', 'Flat plain with subtle variation.', [
    P('base', 'Base level', 0, 1, 0.01, 0.35), P('var', 'Variation', 0, 0.3, 0.005, 0.05), P('freq', 'Frequency', 0.5, 24, 0.5, 5), SEED,
  ], (ctx, p, S) => fill(ctx, S, (x, y, u, v) =>
    clamp(p.base + (fbm(valueNoise, u * p.freq, v * p.freq, { octaves: 3, seed: p.seed }) - 0.5) * 2 * p.var))),
  L(46, 'plateau', 'Plateau', 'Elevated flat region with slopes.', [
    P('x', 'Center X', 0, 1, 0.005, 0.5), P('y', 'Center Y', 0, 1, 0.005, 0.5),
    P('size', 'Size', 0.05, 0.75, 0.01, 0.36), P('height', 'Height', 0, 1, 0.01, 0.7),
    P('edge', 'Edge softness', 0.01, 0.5, 0.01, 0.15), P('rough', 'Top roughness', 0, 0.4, 0.01, 0.08), SEED,
  ], (ctx, p, S) => fill(ctx, S, (x, y, u, v) => {
    const d = Math.max(Math.abs(u - p.x), Math.abs(v - p.y));
    const m = 1 - smoothstep(p.size - p.edge, p.size + p.edge, d);
    const w = fbm(valueNoise, u * 7, v * 7, { octaves: 3, seed: p.seed });
    return clamp(m * (p.height + (w - 0.5) * p.rough * 2));
  })),
  L(47, 'cliff', 'Cliff', 'Vertical cliff face with talus.', [
    P('angle', 'Angle', 0, 360, 1, 0, '°'), P('pos', 'Position', 0, 1, 0.01, 0.5),
    P('hi', 'High side', 0, 1, 0.01, 0.8), P('lo', 'Low side', 0, 1, 0.01, 0.2),
    P('edge', 'Edge width', 0.001, 0.1, 0.001, 0.012), P('talus', 'Talus', 0, 0.5, 0.01, 0.12), P('rough', 'Roughness', 0, 1, 0.05, 0.5), SEED,
  ], (ctx, p, S) => fill(ctx, S, (x, y, u, v) => {
    const a = (p.angle * Math.PI) / 180;
    const t = (u - 0.5) * Math.cos(a) + (v - 0.5) * Math.sin(a) + 0.5;
    const w = fbm(perlin, (u + v) * 6, p.seed * 0.31, { octaves: 3, seed: p.seed, signed: true });
    const edge = smoothstep(p.pos - p.edge, p.pos + p.edge, t + w * 0.03 * p.rough);
    const tal = Math.exp(-Math.abs(t - p.pos) / Math.max(1e-3, p.talus * 0.4)) * p.talus * (1 - edge);
    const face = (fbm(valueNoise, u * 22, v * 22, { octaves: 2, seed: p.seed ^ 9 }) - 0.5) * 0.1 * p.rough * edge * (1 - edge) * 4;
    return clamp(lerp(p.lo, p.hi, edge) + tal * 0.5 + face);
  })),
  L(48, 'rocky', 'Rocky', 'Rocky outcrop base (tor field).', [
    P('freq', 'Frequency', 1, 32, 0.5, 7), P('tors', 'Tor density', 0, 1, 0.05, 0.6), P('height', 'Height', 0, 1, 0.01, 0.55), SEED,
  ], (ctx, p, S) => fill(ctx, S, (x, y, u, v) => {
    const [f1, f2] = worley(u * p.freq, v * p.freq, p.seed, 1);
    const tor = clamp(1 - f1 * 1.6) ** 1.5;
    const base = billow(perlin, u * 3, v * 3, { octaves: 3, seed: p.seed });
    return clamp(base * 0.4 + tor * p.tors * p.height + clamp(1 - (f2 - f1) * 3) * 0.05);
  })),
  L(49, 'badlands', 'Badlands', 'Eroded badlands topography.', [
    P('freq', 'Frequency', 1, 32, 0.5, 8), P('sharp', 'Sharpness', 0.5, 5, 0.1, 2.4), P('height', 'Height', 0, 1, 0.01, 0.6), SEED,
  ], (ctx, p, S) => fill(ctx, S, (x, y, u, v) => {
    const r = ridged(simplex, u * p.freq, v * p.freq, { octaves: 5, seed: p.seed });
    const g = fbm(valueNoise, u * 2.5, v * 2.5, { octaves: 3, seed: p.seed ^ 3 });
    return clamp((r ** p.sharp * 0.75 + g * 0.25) * p.height);
  })),
  L(50, 'coast', 'Coast', 'Coastal shelf sloping into the sea.', [
    P('angle', 'Angle', 0, 360, 1, 0, '°'), P('shore', 'Shore pos', 0, 1, 0.01, 0.45),
    P('land', 'Land height', 0, 1, 0.01, 0.55), P('sea', 'Sea depth', 0, 1, 0.01, 0.1),
    P('rough', 'Shore roughness', 0, 1, 0.05, 0.5), P('freq', 'Detail freq', 1, 24, 1, 7), SEED,
  ], (ctx, p, S) => fill(ctx, S, (x, y, u, v) => {
    const a = (p.angle * Math.PI) / 180;
    const t = (u - 0.5) * Math.cos(a) + (v - 0.5) * Math.sin(a) + 0.5;
    const w = fbm(perlin, u * 4 + 1, v * 4 + 6, { octaves: 4, seed: p.seed, signed: true }) * 0.14 * p.rough;
    const m = smoothstep(p.shore - 0.25, p.shore + 0.3, t + w);
    const detail = fbm(valueNoise, u * p.freq, v * p.freq, { octaves: 3, seed: p.seed });
    return clamp(lerp(p.sea, p.land, m) + (detail - 0.5) * 0.12 * m);
  })),
  L(51, 'island', 'Island', 'Island landmass with beaches and peak.', [
    P('x', 'Center X', 0, 1, 0.005, 0.5), P('y', 'Center Y', 0, 1, 0.005, 0.5),
    P('radius', 'Radius', 0.05, 0.75, 0.01, 0.4), P('height', 'Height', 0, 1, 0.01, 0.85),
    P('coast', 'Coast roughness', 0, 1, 0.05, 0.55), P('sea', 'Sea level', 0, 1, 0.01, 0.22), SEED,
  ], (ctx, p, S) => fill(ctx, S, (x, y, u, v) => {
    const w = fbm(perlin, u * 5 + 3, v * 5 + 1, { octaves: 4, seed: p.seed, signed: true }) * 0.16 * p.coast;
    const d = (Math.hypot(u - p.x, v - p.y) + w) / p.radius;
    const land = mound(d, 1.6);
    const detail = ridged(perlin, u * 12, v * 12, { octaves: 4, seed: p.seed ^ 2 });
    return clamp(p.sea * (1 - land) * 0.6 + land * (p.height * 0.55 + detail * p.height * 0.45 * land));
  })),
  L(52, 'continent', 'Continent', 'Continental mass with ranges and plains.', [
    P('freq', 'Frequency', 0.5, 12, 0.5, 2.5), P('sea', 'Sea level', 0, 1, 0.01, 0.38),
    P('mount', 'Mountains', 0, 1, 0.05, 0.6), P('height', 'Height', 0, 1, 0.01, 1), SEED,
  ], (ctx, p, S) => fill(ctx, S, (x, y, u, v) => {
    const c = fbm(perlin, u * p.freq, v * p.freq, { octaves: 5, seed: p.seed, signed: true }) * 0.5 + 0.5;
    const m = ridged(perlin, u * p.freq * 3 + 7, v * p.freq * 3 + 2, { octaves: 4, seed: p.seed ^ 8 });
    const land = smoothstep(p.sea - 0.12, p.sea + 0.25, c);
    return clamp(c * 0.35 * (1 - land * 0.5) + land * (0.35 + m * p.mount * 0.5) * p.height);
  })),
];
