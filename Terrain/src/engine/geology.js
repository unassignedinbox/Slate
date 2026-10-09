// 70-84 Geological / tectonic processes. Each layer reshapes the heightfield with a physically motivated
// structure (bedding, offsets, folds, plate boundaries, rift blocks, volcanic cones, impact ejecta) or writes a map.
import { makeDef } from './def.js';
import { num, int, seedParam } from './schema.js';
import { hash2, mulberry32 } from './rng.js';
import { clamp, lerp, smoothstep, blurGauss, distanceFromMask } from './grid.js';
import { worleyF4, perlin } from './noise.js';
import { fieldOf, unitFn, latticeFn, fractalField } from './sampling.js';
import { derive } from './context.js';
import { descentPath } from './hydrology.js';

const TAU = Math.PI * 2;
const unitMap = (ctx, p, fn) => {
  const U = unitFn(ctx, p);
  return fieldOf(ctx.N, (x, y, i) => { const [ux, uy] = U(x, y); return fn(ux, uy, i); });
};
const rot = (p) => { const a = ((p.angle ?? 0) * Math.PI) / 180; return [Math.cos(a), Math.sin(a)]; };
const centred = [num('cx', 'Centre X', 0, -1, 1, 0.01), num('cy', 'Centre Y', 0, -1, 1, 0.01)];

export const geologyDefs = [
  makeDef({
    id: 70, key: 'strata', name: 'Strata', cat: 'Geology', status: 'full',
    params: [int('bands', 'Beds', 14, 2, 60), num('hardness', 'Hardness contrast', 0.7, 0, 1, 0.01), num('amount', 'Amount', 0.8, 0, 1, 0.01), num('tilt', 'Dip', 0.05, -0.5, 0.5, 0.005), num('angle', 'Dip direction [deg]', 35, -180, 180, 1)],
    desc: 'Horizontal rock layering: terraces whose risers are sharp (hard beds) or soft (soft beds), optionally dipping.',
    run: (ctx, p) => {
      const [c, s] = rot(p);
      const bands = p.bands;
      return { height: Float32Array.from(ctx.H, (h, i) => {
        const x = (i % ctx.N) / ctx.N, y = Math.floor(i / ctx.N) / ctx.N;
        const t = (h + p.tilt * ((x - 0.5) * c + (y - 0.5) * s)) * bands;
        const layer = Math.floor(t), f = t - layer;
        const hard = 0.5 + 0.5 * hash2(layer, 3, 17) * p.hardness;
        const stepped = (layer + hard * smoothstep(0.55, 1, f)) / bands;
        return clamp(lerp(h, stepped, p.amount));
      }) };
    },
  }),
  makeDef({
    id: 71, key: 'sedimentDeposit', name: 'Sediment', cat: 'Geology', status: 'full',
    params: [num('level', 'Deposit level', 0.3, 0, 1, 0.01), num('amount', 'Amount', 0.5, 0, 1, 0.01), num('flat', 'Flat top softness', 0.15, 0.01, 0.6, 0.01)],
    desc: 'Sedimentary deposition: low ground is built up to a near-flat deposit surface (basin infill).',
    run: (ctx, p) => {
      const smooth = blurGauss(ctx.H, ctx.N, 3);
      return { height: Float32Array.from(ctx.H, (h, i) => {
        const w = (1 - smoothstep(p.level, p.level + p.flat, h)) * p.amount;
        const top = Math.max(h, p.level * 0.5 + smooth[i] * 0.5);
        return clamp(lerp(h, top, w));
      }) };
    },
  }),
  makeDef({
    id: 72, key: 'outcrop', name: 'Outcrop', cat: 'Geology', status: 'full',
    params: [num('height', 'Height', 0.12, 0, 0.5, 0.002), num('threshold', 'Coverage threshold', 0.3, -1, 1, 0.01), num('elevation', 'Elevation share', 0.5, 0, 1, 0.01), num('scale', 'Scale', 5, 0.5, 20, 0.1), seedParam(51)],
    desc: 'Rock outcrops: knobbly protrusions of hard rock on the high ground.',
    run: (ctx, p) => {
      const n = fractalField(ctx, { ...p, octaves: 4, offsetX: 0, offsetY: 0, rotation: 0, lacunarity: 2, gain: 0.5 }, perlin, 'ridged');
      return { height: Float32Array.from(ctx.H, (h, i) => {
        const high = smoothstep(p.elevation * 0.5, 0.9, h);
        const bump = smoothstep(p.threshold, p.threshold + 0.1, n[i]);
        return clamp(h + p.height * bump * high * (0.5 + 0.5 * h));
      }) };
    },
  }),
  makeDef({
    id: 73, key: 'fault', name: 'Fault', cat: 'Geology', status: 'full',
    params: [num('angle', 'Fault strike [deg]', 20, -180, 180, 1), num('offset', 'Position', 0, -1, 1, 0.01), num('throw', 'Throw', 0.12, -0.5, 0.5, 0.005), num('width', 'Fault zone width', 0.02, 0.001, 0.3, 0.001)],
    desc: 'Fault line displacement: one side of a straight fault is lifted (or dropped) relative to the other.',
    run: (ctx, p) => {
      const [c, s] = rot(p);
      return { height: unitMap(ctx, p, (ux, uy, i) => {
        const d = ux * -s + uy * c - p.offset;
        return clamp(ctx.H[i] + p.throw * smoothstep(-p.width, p.width, d));
      }) };
    },
  }),
  makeDef({
    id: 74, key: 'fold', name: 'Fold', cat: 'Geology', status: 'full',
    params: [num('angle', 'Axis [deg]', 0, -180, 180, 1), num('wavelength', 'Wavelength', 0.5, 0.05, 2, 0.01), num('amp', 'Amplitude', 0.06, 0, 0.4, 0.002), num('warp', 'Warp', 0.3, 0, 1, 0.01), seedParam(61)],
    desc: 'Folded strata: anticlines and synclines in a sinusoidal, warped pattern across the axis.',
    run: (ctx, p) => {
      const [c, s] = rot(p);
      const w = fractalField(ctx, { ...p, scale: 2, octaves: 3 }, perlin, 'fbm');
      return { height: unitMap(ctx, p, (ux, uy, i) => {
        const along = (ux * -s + uy * c) / p.wavelength + p.warp * w[i];
        return clamp(ctx.H[i] + p.amp * Math.sin(TAU * along));
      }) };
    },
  }),
  makeDef({
    id: 75, key: 'tectonic', name: 'Tectonic', cat: 'Geology', status: 'full',
    params: [int('plates', 'Plates', 7, 2, 40), num('uplift', 'Collision uplift', 0.18, 0, 0.6, 0.005), num('subside', 'Plate subsidence', 0.05, 0, 0.3, 0.005), num('width', 'Boundary width', 0.04, 0.005, 0.3, 0.001), seedParam(71)],
    desc: 'Plate tectonics: Voronoi plates; collisions along boundaries lift ranges, plate interiors sink or rise individually.',
    run: (ctx, p) => {
      const N = ctx.N;
      const boundary = new Float32Array(N * N), plateLift = new Float32Array(N * N);
      const U = latticeFn(ctx, { scale: p.plates / 2, offsetX: 0, offsetY: 0, rotation: 0 });
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const [u, v] = U(x, y);
        const f = worleyF4(u, v, p.seed, 1);
        const edge = 1 - smoothstep(0, p.width * 10, f.f[1] - f.f[0]);
        boundary[y * N + x] = edge;
        plateLift[y * N + x] = (f.id - 0.5) * 2;
      }
      return { height: Float32Array.from(ctx.H, (h, i) => clamp(h + p.uplift * boundary[i] - p.subside * (1 - boundary[i]) * (0.5 + 0.5 * plateLift[i]))) };
    },
  }),
  makeDef({
    id: 76, key: 'uplift', name: 'Uplift', cat: 'Geology', status: 'full',
    params: [num('amount', 'Amount', 0.15, 0, 0.6, 0.005), num('scale', 'Dome scale', 1, 0.2, 4, 0.05), ...centred, num('radius', 'Dome radius', 0.8, 0.1, 2, 0.01)],
    desc: 'Regional uplift: a broad dome lifting the land around a centre.',
    run: (ctx, p) => ({ height: unitMap(ctx, p, (ux, uy, i) => {
      const d = Math.hypot(ux - p.cx, uy - p.cy) / p.radius;
      return clamp(ctx.H[i] + p.amount * (1 - smoothstep(0, 1, d)));
    }) }),
  }),
  makeDef({
    id: 77, key: 'subsidence', name: 'Subsidence', cat: 'Geology', status: 'full',
    params: [num('amount', 'Amount', 0.15, 0, 0.6, 0.005), ...centred, num('radius', 'Basin radius', 0.8, 0.1, 2, 0.01)],
    desc: 'Regional subsidence: the ground sinks into a broad basin.',
    run: (ctx, p) => ({ height: unitMap(ctx, p, (ux, uy, i) => {
      const d = Math.hypot(ux - p.cx, uy - p.cy) / p.radius;
      return clamp(ctx.H[i] - p.amount * (1 - smoothstep(0, 1, d)));
    }) }),
  }),
  makeDef({
    id: 78, key: 'graben', name: 'Graben', cat: 'Geology', status: 'full',
    params: [num('angle', 'Rift direction [deg]', 0, -180, 180, 1), num('width', 'Rift half width', 0.12, 0.01, 0.6, 0.005), num('depth', 'Rift depth', 0.15, 0, 0.5, 0.005), num('offset', 'Position', 0, -1, 1, 0.01)],
    desc: 'Rift valley: a fault-bounded block dropped between two parallel faults.',
    run: (ctx, p) => {
      const [c, s] = rot(p);
      return { height: unitMap(ctx, p, (ux, uy, i) => {
        const d = Math.abs(ux * -s + uy * c - p.offset);
        return clamp(ctx.H[i] - p.depth * (1 - smoothstep(p.width * 0.6, p.width, d)));
      }) };
    },
  }),
  makeDef({
    id: 79, key: 'horst', name: 'Horst', cat: 'Geology', status: 'full',
    params: [num('angle', 'Ridge direction [deg]', 0, -180, 180, 1), num('width', 'Block half width', 0.12, 0.01, 0.6, 0.005), num('height', 'Uplift', 0.15, 0, 0.5, 0.005), num('offset', 'Position', 0, -1, 1, 0.01)],
    desc: 'Uplifted fault block between two faults (the counterpart of a graben).',
    run: (ctx, p) => {
      const [c, s] = rot(p);
      return { height: unitMap(ctx, p, (ux, uy, i) => {
        const d = Math.abs(ux * -s + uy * c - p.offset);
        return clamp(ctx.H[i] + p.height * (1 - smoothstep(p.width * 0.6, p.width, d)));
      }) };
    },
  }),
  makeDef({
    id: 80, key: 'volcanic', name: 'Volcanic', cat: 'Geology', status: 'full',
    params: [...centred, num('radius', 'Edifice radius', 0.6, 0.1, 1.5, 0.01), num('amp', 'Cone height', 0.35, 0, 1, 0.01), num('lobes', 'Lava lobes', 7, 0, 24, 1), num('lobeAmp', 'Lobe amplitude', 0.05, 0, 0.3, 0.002), seedParam(81)],
    desc: 'Volcanic activity: a shield cone with radial lava lobes spreading from the vent.',
    run: (ctx, p) => {
      const w = fractalField(ctx, { ...p, scale: 2, octaves: 3 }, perlin, 'fbm');
      return { height: unitMap(ctx, p, (ux, uy, i) => {
        const dx = ux - p.cx, dy = uy - p.cy, d = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
        const cone = p.amp * clamp(1 - d / p.radius) ** 2;
        const lobe = 0.5 + 0.5 * Math.cos(p.lobes * a + 3 * w[i]);
        const flow = smoothstep(0.5, 1, lobe) * (1 - smoothstep(p.radius * 0.4, p.radius, d));
        return clamp(ctx.H[i] + cone + p.lobeAmp * flow);
      }) };
    },
  }),
  makeDef({
    id: 81, key: 'lavaFlow', name: 'Lava Flow', cat: 'Geology', status: 'full',
    params: [num('width', 'Flow half width (cells)', 6, 1, 40, 0.5), num('amount', 'Amount', 0.6, 0, 1, 0.01), num('steps', 'Max path length (fraction)', 1, 0.1, 1.5, 0.05)],
    desc: 'Lava flows: from the highest point a steepest-descent path is found and a flat lava sheet is laid along it.',
    run: (ctx, p) => {
      const N = ctx.N, hyd = ctx.get('hydro', derive.hydro);
      let top = 0; for (let i = 1; i < N * N; i++) if (ctx.H[i] > ctx.H[top]) top = i;
      const path = descentPath(hyd.dir, top, Math.round(p.steps * N * 2));
      const pm = new Float32Array(N * N);
      for (const i of path) pm[i] = 1;
      const near = distanceFromMask(pm, N, p.width);
      return { height: Float32Array.from(ctx.H, (h, i) => {
        const w = (1 - smoothstep(0, p.width, near[i])) * p.amount;
        const sheet = Math.max(h, ctx.H[top] * 0.8);
        return clamp(lerp(h, sheet, w));
      }) };
    },
  }),
  makeDef({
    id: 82, key: 'impact', name: 'Impact', cat: 'Geology', status: 'full',
    params: [...centred, num('radius', 'Crater radius', 0.3, 0.03, 1, 0.01), num('depth', 'Bowl depth', 0.25, 0, 1, 0.01), num('ejecta', 'Ejecta height', 0.06, 0, 0.4, 0.002), num('peak', 'Central peak', 0.08, 0, 0.4, 0.002)],
    desc: 'Impact basin: bowl, central peak, raised rim and radial ejecta blanket.',
    run: (ctx, p) => ({ height: unitMap(ctx, p, (ux, uy, i) => {
      const d = Math.hypot(ux - p.cx, uy - p.cy) / p.radius;
      const bowl = d < 1 ? -p.depth * (1 - d * d) : 0;
      const rim = p.ejecta * Math.exp(-(((d - 1) / 0.12) ** 2));
      const blanket = d > 1 ? p.ejecta * 0.35 * Math.exp(-(d - 1) * 1.5) : 0;
      const pk = p.peak * Math.exp(-((d / 0.25) ** 2));
      return clamp(ctx.H[i] + bowl + rim + blanket + pk);
    }) }),
  }),
  makeDef({
    id: 83, key: 'meteor', name: 'Meteor', cat: 'Geology', status: 'full',
    params: [int('count', 'Strikes', 12, 1, 60), num('maxRadius', 'Max radius', 0.06, 0.01, 0.2, 0.002), num('depth', 'Depth', 0.12, 0, 0.5, 0.005), seedParam(91)],
    desc: 'Meteor strikes: many small random craters with rims.',
    run: (ctx, p) => {
      const N = ctx.N, rnd = mulberry32(p.seed);
      const H = Float32Array.from(ctx.H);
      for (let k = 0; k < p.count; k++) {
        const cx = rnd() * 2 - 1, cy = rnd() * 2 - 1, r = p.maxRadius * (0.3 + 0.7 * rnd());
        const d0 = p.depth * (0.4 + 0.6 * rnd());
        const x0 = Math.max(0, Math.floor(((cx + 1) / 2) * (N - 1) - r * N * 1.5)), x1 = Math.min(N - 1, Math.ceil(((cx + 1) / 2) * (N - 1) + r * N * 1.5));
        const y0 = Math.max(0, Math.floor(((cy + 1) / 2) * (N - 1) - r * N * 1.5)), y1 = Math.min(N - 1, Math.ceil(((cy + 1) / 2) * (N - 1) + r * N * 1.5));
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          const ux = (x / (N - 1)) * 2 - 1, uy = (y / (N - 1)) * 2 - 1;
          const d = Math.hypot(ux - cx, uy - cy) / r;
          const j = y * N + x;
          if (d < 1) H[j] -= d0 * (1 - d * d);
          else if (d < 1.4) H[j] += d0 * 0.2 * Math.exp(-(((d - 1) / 0.15) ** 2));
        }
      }
      return { height: Float32Array.from(H, clamp) };
    },
  }),
  makeDef({
    id: 84, key: 'mineral', name: 'Mineral', cat: 'Geology', kind: 'map', status: 'full',
    params: [num('threshold', 'Vein threshold', 0.72, 0, 1, 0.01), num('width', 'Vein width', 0.06, 0.005, 0.3, 0.001), num('scale', 'Vein scale', 4, 0.5, 16, 0.1), seedParam(84)],
    desc: 'Mineral veins: thin ridged-noise seams, written as a "mineral" map that colour layers can read.',
    run: (ctx, p) => {
      const n = fractalField(ctx, { ...p, octaves: 3 }, perlin, 'ridged');
      const data = Float32Array.from(n, (v) => smoothstep(p.threshold, p.threshold + p.width, v));
      return { map: { name: 'mineral', ch: 1, data } };
    },
  }),
];

