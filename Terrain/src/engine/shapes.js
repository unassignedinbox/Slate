// 29-52 Shape generators: macro landforms built from analytic fields and noise. Each returns { height } in [0, 1].
import { makeDef } from './def.js';
import { num, int, sel, seedParam, noiseParams } from './schema.js';
import { perlin, valueNoise } from './noise.js';
import { fieldOf, unitFn, fractalField } from './sampling.js';
import { clamp, smoothstep, lerp } from './grid.js';

const TAU = Math.PI * 2;
// Map a field over unit coordinates.
const uf = (ctx, p, fn) => {
  const U = unitFn(ctx, p);
  return fieldOf(ctx.N, (x, y, i) => { const [ux, uy] = U(x, y); return fn(ux, uy, i); });
};
const centre = [num('cx', 'Centre X', 0, -1, 1, 0.01), num('cy', 'Centre Y', 0, -1, 1, 0.01)];
const sizeP = (def = 0.6) => num('radius', 'Radius', def, 0.05, 1.5, 0.01);
const detailP = [num('detail', 'Detail amount', 0.15, 0, 1, 0.01), int('octaves', 'Detail octaves', 5, 1, 9), seedParam(11)];

// Signed-distance helpers (negative inside).
const sdCircle = (dx, dy, r) => Math.hypot(dx, dy) - r;
const sdBox = (dx, dy, hx, hy, rr) => {
  const qx = Math.abs(dx) - hx + rr, qy = Math.abs(dy) - hy + rr;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rr;
};
const sdTriangle = (dx, dy, r) => {
  const k = Math.sqrt(3);
  let px = Math.abs(dx) - r, py = dy + r / k;
  if (px + k * py > 0) { const nx = (px - k * py) / 2, ny = (-k * px - py) / 2; px = nx; py = ny; }
  px -= clamp(px, -2 * r, 0);
  return -Math.hypot(px, py) * Math.sign(py);
};
const sdStar = (dx, dy, r, n, depth) => {
  const a = Math.atan2(dy, dx), d = Math.hypot(dx, dy);
  const tip = 0.5 + 0.5 * Math.cos(n * a);          // 1 at each point, 0 in each valley
  return d - r * (1 - depth * 0.5 * (1 - tip));
};
// Turn a signed distance into a rounded mound: 1 at the centre, 0 at radius, shoulder controls the crown.
const mound = (sd, r, shoulder) => clamp(1 - sd / r) ** shoulder;

export const shapeDefs = [
  makeDef({
    id: 29, key: 'gradLinear', name: 'Gradient Linear', cat: 'Shapes',
    params: [num('angle', 'Angle [deg]', 0, -180, 180, 1), num('power', 'Curve power', 1, 0.2, 4, 0.05)],
    desc: 'Linear ramp across the map at a given angle.',
    run: (ctx, p) => {
      const a = (p.angle * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
      return { height: uf(ctx, p, (ux, uy) => clamp(0.5 + 0.5 * (ux * c + uy * s)) ** p.power) };
    },
  }),
  makeDef({
    id: 30, key: 'gradRadial', name: 'Gradient Radial', cat: 'Shapes',
    params: [...centre, sizeP(0.8), num('falloff', 'Falloff', 1.5, 0.2, 5, 0.05)],
    desc: 'Radial falloff from a centre point.',
    run: (ctx, p) => ({ height: uf(ctx, p, (ux, uy) => clamp(1 - Math.hypot(ux - p.cx, uy - p.cy) / p.radius) ** p.falloff) }),
  }),
  makeDef({
    id: 31, key: 'gradAngular', name: 'Gradient Angular', cat: 'Shapes',
    params: [...centre, num('phase', 'Phase', 0, 0, 1, 0.01), num('power', 'Curve power', 1, 0.2, 4, 0.05)],
    desc: 'Angular sweep around a centre point.',
    run: (ctx, p) => ({ height: uf(ctx, p, (ux, uy) => {
      const a = Math.atan2(uy - p.cy, ux - p.cx) / TAU + 0.5 + p.phase;
      return (a - Math.floor(a)) ** p.power;
    }) }),
  }),
  makeDef({
    id: 32, key: 'gradSquare', name: 'Gradient Square', cat: 'Shapes',
    params: [...centre, sizeP(0.8), num('falloff', 'Falloff', 1.5, 0.2, 5, 0.05)],
    desc: 'Square (Chebyshev-distance) falloff.',
    run: (ctx, p) => ({ height: uf(ctx, p, (ux, uy) => clamp(1 - Math.max(Math.abs(ux - p.cx), Math.abs(uy - p.cy)) / p.radius) ** p.falloff) }),
  }),
  makeDef({
    id: 33, key: 'shapeCircle', name: 'Shape Circle', cat: 'Shapes',
    params: [...centre, sizeP(0.6), num('shoulder', 'Crown', 0.5, 0.1, 2, 0.01)],
    desc: 'Circular mound with a rounded crown.',
    run: (ctx, p) => ({ height: uf(ctx, p, (ux, uy) => mound(sdCircle(ux - p.cx, uy - p.cy, p.radius), p.radius, p.shoulder)) }),
  }),
  makeDef({
    id: 34, key: 'shapeSquare', name: 'Shape Square', cat: 'Shapes',
    params: [...centre, sizeP(0.6), num('corner', 'Corner rounding', 0.15, 0, 0.9, 0.01), num('shoulder', 'Crown', 0.5, 0.1, 2, 0.01)],
    desc: 'Rounded-square mound.',
    run: (ctx, p) => ({ height: uf(ctx, p, (ux, uy) => {
      const rr = p.corner * p.radius;
      return mound(sdBox(ux - p.cx, uy - p.cy, p.radius, p.radius, rr), p.radius, p.shoulder);
    }) }),
  }),
  makeDef({
    id: 35, key: 'shapeTriangle', name: 'Shape Triangle', cat: 'Shapes',
    params: [...centre, sizeP(0.6), num('shoulder', 'Crown', 0.5, 0.1, 2, 0.01)],
    desc: 'Equilateral triangular mound.',
    run: (ctx, p) => ({ height: uf(ctx, p, (ux, uy) => mound(sdTriangle(ux - p.cx, uy - p.cy, p.radius), p.radius, p.shoulder)) }),
  }),
  makeDef({
    id: 36, key: 'shapeStar', name: 'Shape Star', cat: 'Shapes',
    params: [...centre, sizeP(0.6), int('points', 'Points', 5, 3, 12), num('depth', 'Point depth', 0.6, 0, 1, 0.01), num('shoulder', 'Crown', 0.6, 0.1, 2, 0.01)],
    desc: 'Star-shaped mound with a configurable number of points.',
    run: (ctx, p) => ({ height: uf(ctx, p, (ux, uy) => mound(sdStar(ux - p.cx, uy - p.cy, p.radius, p.points, p.depth), p.radius, p.shoulder)) }),
  }),
  makeDef({
    id: 37, key: 'mountain', name: 'Mountain', cat: 'Shapes',
    params: [...centre, sizeP(0.7), num('height', 'Peak height', 0.9, 0, 1), num('sharp', 'Sharpness', 1.6, 0.5, 4), ...detailP],
    desc: 'Single peak with ridged fractal detail on the flanks.',
    run: (ctx, p) => {
      const rid = fractalField(ctx, { ...p, scale: 2.5, seed: p.seed }, perlin, 'ridged');
      const U = unitFn(ctx, p);
      return { height: fieldOf(ctx.N, (x, y, i) => {
        const [ux, uy] = U(x, y);
        const d = Math.hypot(ux - p.cx, uy - p.cy) / p.radius;
        const base = clamp(1 - d) ** p.sharp;
        return clamp(p.height * base * (1 + p.detail * (rid[i] - 0.5) * 2 * base) + 0.0);
      }) };
    },
  }),
  makeDef({
    id: 38, key: 'volcano', name: 'Volcano', cat: 'Shapes',
    params: [...centre, sizeP(0.7), num('height', 'Cone height', 0.8, 0, 1), num('sharp', 'Cone steepness', 1.2, 0.5, 4),
      num('craterR', 'Crater radius', 0.16, 0.01, 0.6), num('craterDepth', 'Crater depth', 0.35, 0, 1), ...detailP.slice(0, 1)],
    desc: 'Conical volcano with a summit crater.',
    run: (ctx, p) => ({ height: uf(ctx, p, (ux, uy) => {
      const d = Math.hypot(ux - p.cx, uy - p.cy);
      let h = p.height * clamp(1 - d / p.radius) ** p.sharp;
      const cr = p.craterR;
      h -= p.craterDepth * Math.exp(-((d / cr) ** 2)) * h;
      return clamp(h);
    }) }),
  }),
  makeDef({
    id: 39, key: 'mesa', name: 'Mesa', cat: 'Shapes',
    params: [...centre, sizeP(0.7), num('height', 'Height', 0.5, 0, 1), num('cliff', 'Cliff width', 0.12, 0.01, 0.5), num('topNoise', 'Top roughness', 0.03, 0, 0.2), ...detailP.slice(1)],
    desc: 'Flat-topped butte with steep sides.',
    run: (ctx, p) => {
      const n = fractalField(ctx, { ...p, scale: 4 }, valueNoise, 'fbm');
      const U = unitFn(ctx, p);
      return { height: fieldOf(ctx.N, (x, y, i) => {
        const [ux, uy] = U(x, y);
        const d = Math.hypot(ux - p.cx, uy - p.cy) + (n[i] - 0.5) * p.cliff * 0.8;
        const top = smoothstep(p.radius, p.radius - p.cliff, d);
        return clamp(p.height * top + p.topNoise * (n[i] - 0.5) * top);
      }) };
    },
  }),
  makeDef({
    id: 40, key: 'dunes', name: 'Dunes', cat: 'Shapes',
    params: [num('wavelength', 'Wavelength', 0.25, 0.02, 1, 0.01), num('direction', 'Wind direction [deg]', 30, -180, 180, 1),
      num('asym', 'Asymmetry (windward share)', 0.8, 0.5, 0.97, 0.01), num('coverage', 'Coverage', 0.6, 0, 1, 0.01),
      num('amp', 'Amplitude', 0.6, 0, 1, 0.01), ...detailP.slice(2)],
    desc: 'Transverse dune field: gentle windward slopes, sharp slip faces, interdune flats.',
    run: (ctx, p) => {
      const a = (p.direction * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
      const warp = fractalField(ctx, { ...p, scale: 3, seed: p.seed + 3 }, perlin, 'fbm');
      const cov = fractalField(ctx, { ...p, scale: 1.5, seed: p.seed + 5 }, perlin, 'fbm');
      const U = unitFn(ctx, p);
      return { height: fieldOf(ctx.N, (x, y, i) => {
        const [ux, uy] = U(x, y);
        const along = (ux * c + uy * s) / p.wavelength + warp[i] * 0.6;
        const t = along - Math.floor(along);
        const prof = t < p.asym ? t / p.asym : 1 - (t - p.asym) / (1 - p.asym);
        const cv = smoothstep(0.5 - p.coverage * 0.5, 0.5 + p.coverage * 0.5, cov[i]);
        return clamp(0.3 + p.amp * prof * (0.4 + 0.6 * cv) * cv + 0.02 * (cov[i] - 0.5));
      }) };
    },
  }),
  makeDef({
    id: 41, key: 'hills', name: 'Hills', cat: 'Shapes',
    params: [num('amp', 'Amplitude', 0.5, 0, 1, 0.01), num('roundness', 'Roundness', 0.7, 0.2, 1, 0.01), ...noiseParams.slice(0, 1), ...noiseParams.slice(4, 8).map((q) => (q.k === 'octaves' ? { ...q, def: 5 } : q))],
    desc: 'Rolling hills: rounded lobes of fBm noise.',
    run: (ctx, p) => {
      const f = fractalField(ctx, p, perlin, 'fbm');
      return { height: f.map((v) => clamp(0.5 + p.amp * (0.5 * smoothstep(-0.5, 0.5, v * 2) * p.roundness + 0.5 * v * (1 - p.roundness)) * 0.9)) };
    },
  }),
  makeDef({
    id: 42, key: 'ridges', name: 'Ridges', cat: 'Shapes',
    params: [num('sharp', 'Sharpness', 2, 0.5, 6, 0.05), ...noiseParams.slice(0, 1), ...noiseParams.slice(4, 8)],
    desc: 'Sharp ridge lines from the crests of ridged noise.',
    run: (ctx, p) => {
      const f = fractalField(ctx, p, perlin, 'ridged');
      return { height: f.map((v) => clamp(v ** p.sharp)) };
    },
  }),
  makeDef({
    id: 43, key: 'crater', name: 'Crater', cat: 'Shapes',
    params: [...centre, num('radius', 'Crater radius', 0.45, 0.05, 1.2, 0.01), num('depth', 'Bowl depth', 0.5, 0, 1, 0.01),
      num('rim', 'Rim height', 0.15, 0, 0.5, 0.01), num('rimWidth', 'Rim width', 0.08, 0.01, 0.4, 0.01)],
    desc: 'Impact crater: bowl, raised rim and gentle outer apron.',
    run: (ctx, p) => ({ height: uf(ctx, p, (ux, uy) => {
      const d = Math.hypot(ux - p.cx, uy - p.cy) / p.radius;
      const bowl = d < 1 ? -p.depth * (1 - d * d) : 0;
      const rim = p.rim * Math.exp(-(((d - 1) / p.rimWidth) ** 2));
      const apron = d > 1 ? -0.05 * Math.max(0, 1 - (d - 1) * 0.6) : 0;
      return clamp(0.5 + bowl + rim + apron);
    }) }),
  }),
  makeDef({
    id: 44, key: 'canyon', name: 'Canyon', cat: 'Shapes',
    params: [num('cy', 'Centre line Y', 0, -1, 1, 0.01), num('width', 'Half width', 0.12, 0.01, 0.6, 0.01), num('depth', 'Depth', 0.45, 0, 1, 0.01),
      num('meander', 'Meander amplitude', 0.2, 0, 0.8, 0.01), num('wavelength', 'Meander wavelength', 0.7, 0.1, 3, 0.01), num('wall', 'Wall softness', 0.04, 0.005, 0.3, 0.005),
      seedParam(5)],
    desc: 'Sinuous canyon incised into a plateau: vertical-ish walls and a flat floor.',
    run: (ctx, p) => {
      const jitter = fractalField(ctx, { ...p, scale: 2, seed: p.seed }, valueNoise, 'fbm');
      const U = unitFn(ctx, p);
      return { height: fieldOf(ctx.N, (x, y, i) => {
        const [ux, uy] = U(x, y);
        const line = p.cy + p.meander * Math.sin((ux / p.wavelength) * TAU) + (jitter[i] - 0.5) * 0.1;
        const d = Math.abs(uy - line);
        const t = smoothstep(p.width, p.width - p.wall, d);
        return clamp(0.8 - p.depth * t);
      }) };
    },
  }),
  makeDef({
    id: 45, key: 'plain', name: 'Plain', cat: 'Shapes',
    params: [num('level', 'Level', 0.3, 0, 1, 0.01), num('amp', 'Subtle variation', 0.04, 0, 0.3, 0.005), ...noiseParams.slice(0, 1), ...noiseParams.slice(4, 8)],
    desc: 'Flat plain with subtle low-frequency variation.',
    run: (ctx, p) => {
      const f = fractalField(ctx, { ...p, scale: 1.2 }, perlin, 'fbm');
      return { height: f.map((v) => clamp(p.level + p.amp * v)) };
    },
  }),
  makeDef({
    id: 46, key: 'plateau', name: 'Plateau', cat: 'Shapes',
    params: [...centre, num('radius', 'Half size', 0.6, 0.1, 1.5, 0.01), num('height', 'Height', 0.55, 0, 1, 0.01),
      num('edge', 'Edge softness', 0.08, 0.005, 0.5, 0.005), num('warp', 'Edge warp', 0.12, 0, 0.5, 0.01), seedParam(17)],
    desc: 'Elevated flat-topped region with a warped, noisy edge.',
    run: (ctx, p) => {
      const n = fractalField(ctx, { ...p, scale: 3 }, perlin, 'fbm');
      return { height: uf(ctx, p, (ux, uy, i) => {
        const d = Math.max(Math.abs(ux - p.cx), Math.abs(uy - p.cy)) + n[i] * p.warp;
        return clamp(lerp(0.15, p.height, smoothstep(p.radius, p.radius - p.edge, d)));
      }) };
    },
  }),
  makeDef({
    id: 47, key: 'cliff', name: 'Cliff', cat: 'Shapes',
    params: [num('angle', 'Angle [deg]', 0, -180, 180, 1), num('position', 'Position', 0, -1, 1, 0.01), num('height', 'Step height', 0.5, 0, 1, 0.01),
      num('soft', 'Edge softness', 0.02, 0.002, 0.3, 0.002), num('wobble', 'Edge wobble', 0.05, 0, 0.3, 0.005), seedParam(23)],
    desc: 'Vertical cliff: a sharp step between a high and low side along a line.',
    run: (ctx, p) => {
      const a = (p.angle * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
      const w = fractalField(ctx, { ...p, scale: 3 }, perlin, 'fbm');
      return { height: uf(ctx, p, (ux, uy, i) => {
        const d = ux * c + uy * s - p.position + w[i] * p.wobble;
        return clamp(0.2 + p.height * smoothstep(p.soft, -p.soft, d));
      }) };
    },
  }),
  makeDef({
    id: 48, key: 'rocky', name: 'Rocky', cat: 'Shapes',
    params: [num('levels', 'Block levels', 8, 2, 32, 1), num('amp', 'Amplitude', 0.5, 0, 1, 0.01), ...noiseParams.slice(0, 1), ...noiseParams.slice(4, 8)],
    desc: 'Rocky outcrop base: blocky quantised noise with fine breakup.',
    run: (ctx, p) => {
      const f = fractalField(ctx, p, perlin, 'billow');
      const fine = fractalField(ctx, { ...p, scale: p.scale * 4, seed: p.seed + 9, octaves: 2 }, perlin, 'fbm');
      return { height: f.map((v, i) => {
        const b = Math.floor(clamp(v * 0.5 + 0.5) * p.levels) / p.levels;
        return clamp(b * p.amp + 0.1 + 0.03 * fine[i]);
      }) };
    },
  }),
  makeDef({
    id: 49, key: 'badlands', name: 'Badlands', cat: 'Shapes',
    params: [int('levels', 'Terrace levels', 10, 2, 40), num('relief', 'Relief', 0.7, 0, 1, 0.01), ...noiseParams.slice(0, 1), ...noiseParams.slice(4, 8)],
    desc: 'Badlands: eroded ridged relief with stepped strata terraces.',
    run: (ctx, p) => {
      const f = fractalField(ctx, p, perlin, 'ridged');
      return { height: f.map((v) => {
        const t = clamp(v) * p.levels;
        const fl = Math.floor(t);
        const stepped = fl + smoothstep(0.7, 1, t - fl);
        return clamp((stepped / p.levels) * p.relief + (1 - p.relief) * 0.3);
      }) };
    },
  }),
  makeDef({
    id: 50, key: 'coast', name: 'Coast', cat: 'Shapes',
    params: [num('land', 'Land radius', 0.75, 0.2, 1.4, 0.01), num('coast', 'Coastline noise', 0.22, 0, 0.6, 0.01), num('shelf', 'Shelf depth', 0.25, 0, 0.6, 0.01),
      num('sea', 'Sea level', 0.3, 0, 0.8, 0.01), ...noiseParams.slice(0, 1), ...noiseParams.slice(4, 8)],
    desc: 'Coastal shelf: land rising from a sea floor along a fractal coastline.',
    run: (ctx, p) => {
      const n = fractalField(ctx, { ...p, scale: 2.5 }, perlin, 'fbm');
      const U = unitFn(ctx, p);
      return { height: fieldOf(ctx.N, (x, y, i) => {
        const [ux, uy] = U(x, y);
        const d = Math.hypot(ux, uy) + n[i] * p.coast;
        const land = smoothstep(p.land + 0.04, p.land - 0.04, d);
        const seafloor = p.sea - p.shelf * smoothstep(p.land - 0.1, p.land + 0.3, d);
        return clamp(lerp(seafloor, p.sea + 0.25 * (1 - d / p.land) * land, land));
      }) };
    },
  }),
  makeDef({
    id: 51, key: 'island', name: 'Island', cat: 'Shapes',
    params: [num('land', 'Island radius', 0.5, 0.1, 1, 0.01), num('peak', 'Peak height', 0.5, 0, 1, 0.01), num('coast', 'Coastline noise', 0.15, 0, 0.5, 0.01),
      num('sea', 'Sea level', 0.25, 0, 0.6, 0.01), ...noiseParams.slice(0, 1), ...noiseParams.slice(4, 8)],
    desc: 'Island: a central peak falling off into the sea.',
    run: (ctx, p) => {
      const n = fractalField(ctx, { ...p, scale: 3 }, perlin, 'fbm');
      const U = unitFn(ctx, p);
      return { height: fieldOf(ctx.N, (x, y, i) => {
        const [ux, uy] = U(x, y);
        const d = Math.hypot(ux, uy) + n[i] * p.coast;
        const land = smoothstep(p.land, p.land * 0.7, d);
        const core = p.peak * clamp(1 - d / p.land) ** 1.4;
        return clamp(lerp(p.sea * 0.4, p.sea + core, land));
      }) };
    },
  }),
  makeDef({
    id: 52, key: 'continent', name: 'Continent', cat: 'Shapes',
    params: [num('land', 'Continent radius', 0.9, 0.3, 1.5, 0.01), num('belts', 'Mountain belt strength', 0.5, 0, 1, 0.01), num('coast', 'Coastline noise', 0.2, 0, 0.6, 0.01),
      num('sea', 'Sea level', 0.3, 0, 0.8, 0.01), ...noiseParams.slice(0, 1), ...noiseParams.slice(4, 8)],
    desc: 'Continental mass: broad interior with mountain belts and a fractal coastline.',
    run: (ctx, p) => {
      const n = fractalField(ctx, { ...p, scale: 2 }, perlin, 'fbm');
      const belt = fractalField(ctx, { ...p, scale: 2.2, seed: p.seed + 4 }, perlin, 'ridged');
      const U = unitFn(ctx, p);
      return { height: fieldOf(ctx.N, (x, y, i) => {
        const [ux, uy] = U(x, y);
        const d = Math.hypot(ux, uy) + n[i] * p.coast;
        const land = smoothstep(p.land, p.land - 0.12, d);
        const interior = clamp(1 - d / p.land);
        const h = 0.35 + 0.25 * interior + p.belts * belt[i] * 0.4 * interior;
        return clamp(lerp(p.sea * 0.5, h, land));
      }) };
    },
  }),
];
