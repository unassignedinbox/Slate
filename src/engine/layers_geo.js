// Slate — geological / tectonic #70–84.
import { clamp, smoothstep, lerp, mulberry32, bilinear } from './util.js';
import { perlin, valueNoise, fbm, worley } from './noise.js';

const P = (k, label, min, max, step, def, unit = '', hint = '') =>
  ({ k, label, min, max, step, def, unit, hint, type: 'slider' });
const SEED = P('seed', 'Seed', 0, 9999, 1, 33);
const L = (n, id, name, desc, params, run, extra = {}) =>
  ({ n, id, name, cat: 'geo', desc, targets: ['height'], params, run, ...extra });

export const LAYERS_GEO = [
  L(70, 'strata', 'Strata', 'Horizontal rock layering (terrace bands + hardness).', [
    P('layers', 'Layers', 2, 40, 1, 12), P('strength', 'Strength', 0, 0.15, 0.005, 0.04),
    P('warp', 'Warp', 0, 1, 0.05, 0.35), P('hard', 'Hardness var', 0, 1, 0.05, 0.6), SEED,
  ], (ctx, p, S) => {
    const n = ctx.n, rnd = mulberry32(p.seed * 3 + 1);
    const hard = [];
    for (let i = 0; i < p.layers; i++) hard.push(0.4 + rnd() * 0.6);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const w = fbm(perlin, x / n * 5, y / n * 5, { octaves: 3, seed: p.seed, signed: true }) * p.warp * 0.5;
      const t = clamp((S.h[i] + w * 0.1) * p.layers, 0, p.layers - 1e-3);
      const li = Math.floor(t), f = t - li;
      const step = smoothstep(0.35, 0.65, f); // cliff-ish riser
      S.h[i] += (step - f) * p.strength * (0.5 + hard[li] * 0.5);
    }
  }),
  L(71, 'sediment-depo', 'Sediment', 'Sediment deposition in lows and flats.', [
    P('amount', 'Amount', 0, 0.3, 0.005, 0.06), P('flatOnly', 'Flat bias', 0, 1, 0.05, 0.7),
  ], (ctx, p, S) => {
    const n = ctx.n;
    for (let y = 1; y < n - 1; y++) for (let x = 1; x < n - 1; x++) {
      const i = y * n + x;
      const gx = (S.h[i + 1] - S.h[i - 1]) * 0.5, gy = (S.h[i + n] - S.h[i - n]) * 0.5;
      const sl = Math.hypot(gx, gy);
      const flat = 1 - smoothstep(0.005, 0.06, sl);
      const low = 1 - smoothstep(0.2, 0.6, S.h[i]);
      S.h[i] += p.amount * (flat * p.flatOnly + low * (1 - p.flatOnly) * 0.7 + 0.1);
    }
  }, { also: ['moist'] }),
  L(72, 'outcrop', 'Outcrop', 'Rock outcrop protrusions (tor bumps).', [
    P('count', 'Outcrops', 2, 120, 1, 24), P('size', 'Size', 1, 20, 0.5, 6, 'px'),
    P('height', 'Height', 0, 0.3, 0.005, 0.08), P('rough', 'Roughness', 0, 1, 0.05, 0.5), SEED,
  ], (ctx, p, S) => {
    const n = ctx.n, rnd = mulberry32(p.seed * 7 + 2);
    for (let k = 0; k < p.count; k++) {
      const cx = rnd() * (n - 1), cy = rnd() * (n - 1);
      const r = p.size * (0.5 + rnd());
      const hh = p.height * (0.5 + rnd());
      const rr = Math.ceil(r * 1.5);
      for (let oy = -rr; oy <= rr; oy++) for (let ox = -rr; ox <= rr; ox++) {
        const nx = Math.round(cx) + ox, ny = Math.round(cy) + oy;
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        const d = Math.hypot(ox, oy) / r;
        if (d > 1.5) continue;
        const bump = Math.exp(-d * d * 2.5);
        const nz = (valueNoise(nx * 0.4, ny * 0.4, p.seed + k) - 0.5) * p.rough;
        S.h[ny * n + nx] += bump * hh * (1 + nz);
      }
    }
  }),
  L(73, 'fault', 'Fault', 'Fault-line displacement (strike-slip + dip).', [
    P('angle', 'Strike', 0, 180, 1, 30, '°'), P('pos', 'Position', 0, 1, 0.01, 0.5),
    P('throw', 'Throw', -0.4, 0.4, 0.005, 0.12), P('width', 'Zone width', 0.002, 0.1, 0.002, 0.015),
    P('rough', 'Roughness', 0, 1, 0.05, 0.4), SEED,
  ], (ctx, p, S) => {
    const n = ctx.n, a = (p.angle * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const u = x / (n - 1) - 0.5, v = y / (n - 1) - 0.5;
      const across = -u * sa + v * ca + 0.5;
      const along = u * ca + v * sa;
      const w = fbm(perlin, along * 8, p.seed * 0.7, { octaves: 3, seed: p.seed, signed: true }) * 0.03 * p.rough;
      const m = smoothstep(p.pos - p.width, p.pos + p.width, across + w);
      S.h[y * n + x] += (m - 0.5) * p.throw; // antisymmetric throw across the line
    }
  }),
  L(74, 'fold', 'Fold', 'Geological folding (anticline/syncline waves).', [
    P('freq', 'Frequency', 0.5, 16, 0.5, 3.5), P('angle', 'Axis angle', 0, 180, 1, 0, '°'),
    P('amp', 'Amplitude', 0, 0.3, 0.005, 0.08), P('asym', 'Asymmetry', 0, 1, 0.05, 0.3), P('plunge', 'Plunge', 0, 1, 0.05, 0),
  ], (ctx, p, S) => {
    const n = ctx.n, a = (p.angle * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const u = x / (n - 1), v = y / (n - 1);
      const t = ((u - 0.5) * ca + (v - 0.5) * sa) * p.freq + (v * p.plunge);
      let w = Math.sin(t * Math.PI * 2);
      w = w + p.asym * Math.sin(t * Math.PI * 4 + 1.3) * 0.5; // asymmetric limbs
      S.h[y * n + x] += w * p.amp;
    }
  }),
  L(75, 'tectonic', 'Tectonic', 'Tectonic plates: ridges at boundaries, drift tilt.', [
    P('plates', 'Plates', 2, 8, 1, 4), P('relief', 'Relief', 0, 0.4, 0.01, 0.15),
    P('ridge', 'Boundary ridges', 0, 1, 0.05, 0.7), P('angle', 'Drift angle', 0, 360, 1, 20, '°'), SEED,
  ], (ctx, p, S) => {
    const n = ctx.n, rnd = mulberry32(p.seed * 11 + 4);
    const pts = [];
    for (let k = 0; k < p.plates; k++) pts.push([rnd(), rnd(), (rnd() - 0.5) * 2]);
    const a = (p.angle * Math.PI) / 180;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const u = x / (n - 1), v = y / (n - 1);
      let d1 = 9, d2 = 9, v1 = 0;
      for (const [px, py, pv] of pts) {
        const d = Math.hypot(u - px, v - py);
        if (d < d1) { d2 = d1; d1 = d; v1 = pv; } else if (d < d2) d2 = d;
      }
      const edge = d2 - d1;
      const ridge = Math.exp(-(edge * edge) / 0.0012) * p.ridge;
      const tilt = ((u - 0.5) * Math.cos(a) + (v - 0.5) * Math.sin(a)) * v1 * 0.2;
      S.h[y * n + x] += (v1 * 0.12 + ridge * 0.25 + tilt) * p.relief * 2.2;
    }
  }),
  L(76, 'uplift', 'Uplift', 'Regional domal uplift.', [
    P('x', 'Center X', 0, 1, 0.005, 0.5), P('y', 'Center Y', 0, 1, 0.005, 0.5),
    P('radius', 'Radius', 0.05, 1, 0.01, 0.45), P('amount', 'Amount', 0, 0.5, 0.005, 0.15), P('sharp', 'Sharpness', 0.5, 5, 0.1, 1.8),
  ], (ctx, p, S) => {
    const n = ctx.n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const d = Math.hypot(x / (n - 1) - p.x, y / (n - 1) - p.y) / p.radius;
      if (d < 1.2) S.h[y * n + x] += clamp(1 - d ** p.sharp, 0, 1) * p.amount;
    }
  }),
  L(77, 'subsidence', 'Subsidence', 'Ground sinking (basin sag).', [
    P('x', 'Center X', 0, 1, 0.005, 0.5), P('y', 'Center Y', 0, 1, 0.005, 0.5),
    P('radius', 'Radius', 0.05, 1, 0.01, 0.4), P('amount', 'Amount', 0, 0.5, 0.005, 0.12), P('sharp', 'Sharpness', 0.5, 5, 0.1, 2),
  ], (ctx, p, S) => {
    const n = ctx.n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const d = Math.hypot(x / (n - 1) - p.x, y / (n - 1) - p.y) / p.radius;
      if (d < 1.2) S.h[y * n + x] -= clamp(1 - d ** p.sharp, 0, 1) * p.amount;
    }
  }),
  L(78, 'graben', 'Graben', 'Rift valley: dropped block between faults.', [
    P('angle', 'Strike', 0, 180, 1, 60, '°'), P('pos', 'Position', 0, 1, 0.01, 0.5),
    P('width', 'Width', 0.02, 0.5, 0.005, 0.14), P('drop', 'Drop', 0, 0.5, 0.005, 0.16),
    P('edge', 'Edge width', 0.002, 0.08, 0.002, 0.012), P('rough', 'Roughness', 0, 1, 0.05, 0.35), SEED,
  ], (ctx, p, S) => {
    const n = ctx.n, a = (p.angle * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const u = x / (n - 1) - 0.5, v = y / (n - 1) - 0.5;
      const across = -u * sa + v * ca + 0.5;
      const along = u * ca + v * sa;
      const w = fbm(perlin, along * 9, 3.3, { octaves: 3, seed: p.seed, signed: true }) * 0.02 * p.rough;
      const d = Math.abs(across + w - p.pos);
      const m = 1 - smoothstep(p.width * 0.5 - p.edge, p.width * 0.5 + p.edge, d);
      S.h[y * n + x] -= m * p.drop;
    }
  }),
  L(79, 'horst', 'Horst', 'Uplifted block between faults.', [
    P('angle', 'Strike', 0, 180, 1, 60, '°'), P('pos', 'Position', 0, 1, 0.01, 0.5),
    P('width', 'Width', 0.02, 0.5, 0.005, 0.14), P('lift', 'Lift', 0, 0.5, 0.005, 0.16),
    P('edge', 'Edge width', 0.002, 0.08, 0.002, 0.012), P('rough', 'Roughness', 0, 1, 0.05, 0.35), SEED,
  ], (ctx, p, S) => {
    const n = ctx.n, a = (p.angle * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const u = x / (n - 1) - 0.5, v = y / (n - 1) - 0.5;
      const across = -u * sa + v * ca + 0.5;
      const along = u * ca + v * sa;
      const w = fbm(perlin, along * 9, 8.8, { octaves: 3, seed: p.seed, signed: true }) * 0.02 * p.rough;
      const d = Math.abs(across + w - p.pos);
      const m = 1 - smoothstep(p.width * 0.5 - p.edge, p.width * 0.5 + p.edge, d);
      S.h[y * n + x] += m * p.lift;
    }
  }),
  L(80, 'volcanic', 'Volcanic', 'Volcanic field: cones + flows + ash.', [
    P('cones', 'Cones', 1, 24, 1, 5), P('height', 'Cone height', 0, 0.4, 0.01, 0.16),
    P('flows', 'Flow length', 0, 1, 0.05, 0.5), P('ash', 'Ash soften', 0, 1, 0.05, 0.3), SEED,
  ], (ctx, p, S) => {
    const n = ctx.n, rnd = mulberry32(p.seed * 17 + 6);
    const cones = [];
    for (let k = 0; k < p.cones; k++) cones.push([rnd(), rnd(), 0.05 + rnd() * 0.12]);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const u = x / (n - 1), v = y / (n - 1);
      let add = 0;
      for (const [cx, cy, r] of cones) {
        const d = Math.hypot(u - cx, v - cy) / r;
        if (d < 2.5) {
          const cone = Math.exp(-d * d * 1.6);
          const crater = Math.exp(-(d * d) / 0.03) * 0.7;
          add += Math.max(0, cone - crater) * p.height;
          if (p.flows > 0) {
            const fl = Math.exp(-d * 1.2) * 0.3 * p.flows *
              (0.5 + 0.5 * valueNoise(u * 20 + cx * 40, v * 20, p.seed));
            add += fl * p.height * 0.5;
          }
        }
      }
      S.h[y * n + x] += add;
    }
    if (p.ash > 0) {
      const src = Float32Array.from(S.h);
      for (let y = 1; y < n - 1; y++) for (let x = 1; x < n - 1; x++) {
        const i = y * n + x;
        S.h[i] = lerp(src[i], (src[i - 1] + src[i + 1] + src[i - n] + src[i + n]) * 0.25, p.ash * 0.4);
      }
    }
  }),
  L(81, 'lava-flow', 'Lava Flow', 'Lava flow paths downhill from vents.', [
    P('vents', 'Vents', 1, 12, 1, 3), P('length', 'Length', 20, 600, 5, 260, 'px'),
    P('width', 'Width', 0.5, 8, 0.25, 2.5, 'px'), P('build', 'Levee build', 0, 0.15, 0.005, 0.03), SEED,
  ], (ctx, p, S) => {
    const n = ctx.n, rnd = mulberry32(p.seed * 23 + 8);
    for (let k = 0; k < p.vents; k++) {
      let x = rnd() * (n - 1), y = rnd() * (n - 1);
      for (let s = 0; s < p.length; s++) {
        const xi = Math.round(x), yi = Math.round(y);
        if (xi < 1 || yi < 1 || xi >= n - 1 || yi >= n - 1) break;
        const gx = (bilinear(S.h, n, x + 1, y) - bilinear(S.h, n, x - 1, y)) * 0.5;
        const gy = (bilinear(S.h, n, x, y + 1) - bilinear(S.h, n, x, y - 1)) * 0.5;
        let dx = -gx + (rnd() - 0.5) * 0.01, dy = -gy + (rnd() - 0.5) * 0.01;
        const l = Math.hypot(dx, dy) || 1;
        x += (dx / l); y += (dy / l);
        const r = Math.ceil(p.width * 2.2);
        for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) {
          const nx = Math.round(x) + ox, ny = Math.round(y) + oy;
          if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
          const dd = Math.hypot(ox, oy) / p.width;
          if (dd > 2.2) continue;
          const chan = Math.exp(-dd * dd * 1.4);          // molten channel (slight crust sag)
          const levee = Math.exp(-((dd - 1.3) ** 2) * 4);  // levee ridges
          S.h[ny * n + nx] += (-chan * 0.3 + levee) * p.build;
        }
      }
    }
  }),
  L(82, 'impact', 'Impact', 'Meteor impact structure (central peak + ejecta).', [
    P('x', 'Center X', 0, 1, 0.005, 0.5), P('y', 'Center Y', 0, 1, 0.005, 0.5),
    P('radius', 'Radius', 0.03, 0.5, 0.01, 0.2), P('depth', 'Depth', 0, 0.5, 0.01, 0.2),
    P('peak', 'Central peak', 0, 1, 0.05, 0.5), P('ejecta', 'Ejecta', 0, 1, 0.05, 0.6), SEED,
  ], (ctx, p, S) => {
    const n = ctx.n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const u = x / (n - 1), v = y / (n - 1);
      const d = Math.hypot(u - p.x, v - p.y) / p.radius;
      if (d > 3) continue;
      const bowl = d < 1 ? Math.cos(d * Math.PI * 0.5) ** 1.2 : 0;
      const rim = Math.exp(-((d - 1) ** 2) / 0.015);
      const peak = Math.exp(-(d * d) / 0.02) * p.peak * 0.5;
      const ej = d >= 1 ? Math.exp(-(d - 1) * 2.2) * p.ejecta * 0.25 *
        (0.5 + valueNoise(u * 40, v * 40, p.seed)) : 0;
      S.h[y * n + x] += (-bowl * p.depth + rim * p.depth * 0.45 + peak * p.depth + ej * p.depth);
    }
  }),
  L(83, 'meteor', 'Meteor', 'Meteor strike field (clustered small craters).', [
    P('count', 'Strikes', 1, 80, 1, 14), P('size', 'Max size', 2, 40, 1, 14, 'px'),
    P('depth', 'Depth', 0, 0.3, 0.005, 0.08), P('cluster', 'Clustering', 0, 1, 0.05, 0.6), SEED,
  ], (ctx, p, S) => {
    const n = ctx.n, rnd = mulberry32(p.seed * 29 + 10);
    const cx = rnd() * n, cy = rnd() * n;
    for (let k = 0; k < p.count; k++) {
      const px = lerp(rnd() * n, cx + (rnd() - 0.5) * n * 0.4, p.cluster);
      const py = lerp(rnd() * n, cy + (rnd() - 0.5) * n * 0.4, p.cluster);
      const r = 1.5 + Math.pow(rnd(), 2) * p.size;
      const dep = p.depth * (0.4 + rnd() * 0.8) * (r / p.size + 0.3);
      const rr = Math.ceil(r * 1.6);
      for (let oy = -rr; oy <= rr; oy++) for (let ox = -rr; ox <= rr; ox++) {
        const nx = Math.round(px) + ox, ny = Math.round(py) + oy;
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        const d = Math.hypot(ox, oy) / r;
        if (d > 1.6) continue;
        const bowl = d < 1 ? Math.cos(d * Math.PI * 0.5) : 0;
        const rim = Math.exp(-((d - 1) ** 2) / 0.03);
        S.h[ny * n + nx] += -bowl * dep + rim * dep * 0.4;
      }
    }
  }),
  L(84, 'mineral', 'Mineral', 'Mineral vein deposits (ridged veins + enrichment).', [
    P('freq', 'Frequency', 1, 32, 0.5, 9), P('width', 'Vein width', 0.01, 0.3, 0.005, 0.06),
    P('relief', 'Relief', 0, 0.12, 0.005, 0.03), P('enrich', 'Enrichment', 0, 1, 0.05, 0.5), SEED,
  ], (ctx, p, S) => {
    const n = ctx.n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const u = x / (n - 1), v = y / (n - 1);
      const [f1, f2] = worley(u * p.freq, v * p.freq, p.seed, 1);
      const vein = 1 - smoothstep(0, p.width * 2, f2 - f1);
      const ore = fbm(valueNoise, u * 5, v * 5, { octaves: 3, seed: p.seed ^ 1 });
      S.h[y * n + x] += vein * p.relief * (0.4 + ore);
      S.moist[y * n + x] = clamp(S.moist[y * n + x] + vein * p.enrich * ore, 0, 1);
    }
  }, { also: ['moist'] }),
];
