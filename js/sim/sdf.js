// SDF primitive library. Every layer evaluates a signed distance d(x,y,z)
// (negative = inside solid) in WORLD units, plus a hardness value.
// UI inspector forms are auto-generated from PARAMS schemas.
import { fbm3, ridged3, mulberry32 } from './noise.js';

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smin = (a, b, k) => {
  if (k <= 1e-6) return Math.min(a, b);
  const h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1);
  return lerp(b, a, h) - k * h * (1 - h);
};

const P = (key, label, min, max, step, def) => ({ key, label, min, max, step, def });
export const OPS = ['add', 'sub', 'intersect', 'smooth'];

// kind -> { name, icon, mode: 'analytic'|'stamp'|'modifier', ops, params, eval|apply }
export const LAYERS = {
  slab: {
    name: 'Ground slab', icon: '▤', mode: 'analytic', ops: ['add', 'intersect'],
    params: [
      P('y0', 'Top height', 0, 40, 0.5, 8), P('thick', 'Thickness', 1, 40, 0.5, 12),
      P('noiseAmp', 'Noise amp', 0, 12, 0.1, 2.5), P('noiseFreq', 'Noise freq', 0.005, 0.2, 0.005, 0.045),
      P('hard', 'Hardness', 0, 1, 0.05, 0.55),
    ],
    bbox(p, W) { return { x0: -W.sx / 2, x1: W.sx / 2, y0: p.y0 - p.thick - 2, y1: p.y0 + p.noiseAmp + 2, z0: -W.sz / 2, z1: W.sz / 2 }; },
    eval(x, y, z, p) {
      const n = fbm3(x * p.noiseFreq, 0, z * p.noiseFreq, 4, 0.5, 2.03, 77) - 0.5;
      const top = p.y0 + n * 2 * p.noiseAmp;
      const d = Math.max(y - top, (p.y0 - p.thick) - y);
      return { d, hard: p.hard };
    },
  },
  mountain: {
    name: 'Mountain', icon: '▲', mode: 'analytic', ops: ['add', 'sub', 'smooth'],
    params: [
      P('x', 'X', -60, 60, 1, 0), P('z', 'Z', -60, 60, 1, 0),
      P('radius', 'Radius', 4, 60, 1, 26), P('height', 'Height', 2, 45, 1, 24),
      P('yBase', 'Base Y', -10, 30, 0.5, 6), P('stretch', 'Stretch X', 0.3, 3, 0.05, 1),
      P('ridgeAmp', 'Ridge amp', 0, 14, 0.2, 6), P('ridgeFreq', 'Ridge freq', 0.01, 0.3, 0.005, 0.075),
      P('seed', 'Seed', 0, 9999, 1, 11), P('hard', 'Hardness', 0, 1, 0.05, 0.7),
    ],
    bbox(p) {
      const r = p.radius * Math.max(1, p.stretch) + p.ridgeAmp + 2;
      return { x0: p.x - r, x1: p.x + r, y0: p.yBase - 2, y1: p.yBase + p.height + p.ridgeAmp + 2, z0: p.z - p.radius - p.ridgeAmp - 2, z1: p.z + p.radius + p.ridgeAmp + 2 };
    },
    eval(x, y, z, p) {
      const dx = (x - p.x) / p.stretch, dz = z - p.z;
      const r = Math.hypot(dx, dz) / p.radius;
      const peak = p.yBase + p.height;
      const prof = peak - Math.max(0, r) * p.height;
      const m = clamp(1 - r, 0, 1);
      const rg = ridged3(x * p.ridgeFreq, z * p.ridgeFreq, p.seed * 0.13, 4, 0.5, 2.1, p.seed | 0) - 0.45;
      const d = Math.max(y - (prof + rg * p.ridgeAmp * m), (p.yBase - 3) - y);
      return { d, hard: p.hard };
    },
  },
  mesa: {
    name: 'Mesa', icon: '⬓', mode: 'analytic', ops: ['add', 'sub', 'smooth'],
    params: [
      P('x', 'X', -60, 60, 1, -18), P('z', 'Z', -60, 60, 1, 10),
      P('rTop', 'Top radius', 2, 40, 1, 9), P('rBot', 'Base radius', 2, 45, 1, 15),
      P('height', 'Height', 2, 40, 1, 16), P('yBase', 'Base Y', -10, 30, 0.5, 6),
      P('terrace', 'Terracing', 0, 8, 1, 3), P('noiseAmp', 'Noise amp', 0, 6, 0.1, 1.2),
      P('seed', 'Seed', 0, 9999, 1, 5), P('hard', 'Hardness', 0, 1, 0.05, 0.75),
    ],
    bbox(p) {
      const r = Math.max(p.rTop, p.rBot) + p.noiseAmp + 2;
      return { x0: p.x - r, x1: p.x + r, y0: p.yBase - 2, y1: p.yBase + p.height + 2, z0: p.z - r, z1: p.z + r };
    },
    eval(x, y, z, p) {
      let t = clamp((y - p.yBase) / p.height, 0, 1);
      if (p.terrace > 0.5) {
        const s = Math.round(t * p.terrace) / p.terrace;
        t = lerp(t, s, 0.75);
      }
      const rr = lerp(p.rBot, p.rTop, t);
      const n = fbm3(x * 0.09, y * 0.05, z * 0.09, 3, 0.5, 2, p.seed | 0) - 0.5;
      const d = Math.max(Math.hypot(x - p.x, z - p.z) - (rr + n * 2 * p.noiseAmp),
        Math.abs(y - (p.yBase + p.height / 2)) - p.height / 2);
      return { d, hard: p.hard };
    },
  },
  sphere: {
    name: 'Sphere', icon: '●', mode: 'analytic', ops: ['add', 'sub', 'intersect', 'smooth'],
    params: [P('x', 'X', -60, 60, 0.5, 0), P('y', 'Y', -10, 50, 0.5, 14), P('z', 'Z', -60, 60, 0.5, 0),
      P('r', 'Radius', 0.5, 40, 0.5, 8), P('hard', 'Hardness', 0, 1, 0.05, 0.6)],
    bbox(p) { return { x0: p.x - p.r - 1, x1: p.x + p.r + 1, y0: p.y - p.r - 1, y1: p.y + p.r + 1, z0: p.z - p.r - 1, z1: p.z + p.r + 1 }; },
    eval(x, y, z, p) { return { d: Math.hypot(x - p.x, y - p.y, z - p.z) - p.r, hard: p.hard }; },
  },
  box: {
    name: 'Box', icon: '■', mode: 'analytic', ops: ['add', 'sub', 'intersect', 'smooth'],
    params: [P('x', 'X', -60, 60, 0.5, 0), P('y', 'Y', -10, 50, 0.5, 12), P('z', 'Z', -60, 60, 0.5, 0),
      P('sx', 'Size X', 0.5, 60, 0.5, 14), P('sy', 'Size Y', 0.5, 50, 0.5, 10), P('sz', 'Size Z', 0.5, 60, 0.5, 14),
      P('round', 'Round', 0, 10, 0.25, 1.5), P('hard', 'Hardness', 0, 1, 0.05, 0.6)],
    bbox(p) { return { x0: p.x - p.sx / 2 - 1, x1: p.x + p.sx / 2 + 1, y0: p.y - p.sy / 2 - 1, y1: p.y + p.sy / 2 + 1, z0: p.z - p.sz / 2 - 1, z1: p.z + p.sz / 2 + 1 }; },
    eval(x, y, z, p) {
      const qx = Math.abs(x - p.x) - p.sx / 2 + p.round;
      const qy = Math.abs(y - p.y) - p.sy / 2 + p.round;
      const qz = Math.abs(z - p.z) - p.sz / 2 + p.round;
      const ax = Math.max(qx, 0), ay = Math.max(qy, 0), az = Math.max(qz, 0);
      return { d: Math.hypot(ax, ay, az) + Math.min(Math.max(qx, qy, qz), 0) - p.round, hard: p.hard };
    },
  },
  torus: {
    name: 'Torus (arch)', icon: '◎', mode: 'analytic', ops: ['add', 'sub', 'smooth'],
    params: [P('x', 'X', -60, 60, 0.5, 14), P('y', 'Y', -10, 50, 0.5, 10), P('z', 'Z', -60, 60, 0.5, -8),
      P('R', 'Ring R', 1, 30, 0.5, 8), P('r', 'Tube r', 0.5, 12, 0.25, 2.5),
      P('plane', 'Plane 0:XY 1:XZ 2:YZ', 0, 2, 1, 0), P('hard', 'Hardness', 0, 1, 0.05, 0.7)],
    bbox(p) { const e = p.R + p.r + 1; return { x0: p.x - e, x1: p.x + e, y0: p.y - e, y1: p.y + e, z0: p.z - e, z1: p.z + e }; },
    eval(x, y, z, p) {
      const dx = x - p.x, dy = y - p.y, dz = z - p.z;
      let a, b;
      if (p.plane < 0.5) { a = Math.hypot(dx, dy) - p.R; b = dz; }
      else if (p.plane < 1.5) { a = Math.hypot(dx, dz) - p.R; b = dy; }
      else { a = Math.hypot(dy, dz) - p.R; b = dx; }
      return { d: Math.hypot(a, b) - p.r, hard: p.hard };
    },
  },
  worms: {
    name: 'Cave worms', icon: '➰', mode: 'stamp', ops: ['sub', 'add'],
    params: [P('count', 'Worm count', 1, 24, 1, 6), P('len', 'Length (vox)', 10, 220, 5, 80),
      P('radius', 'Radius (vox)', 1, 8, 0.5, 2.5), P('yMin', 'Y min', 0, 40, 1, 3),
      P('yMax', 'Y max', 1, 45, 1, 16), P('wander', 'Wander', 0, 1, 0.05, 0.45),
      P('seed', 'Seed', 0, 9999, 1, 42)],
    // Stamped directly into the field (see field.js buildStampLayer).
    makePaths(p, field, seedBase) {
      const rng = mulberry32(((p.seed | 0) * 7919 + seedBase) | 0);
      const paths = [];
      for (let w = 0; w < p.count; w++) {
        const pts = [];
        let fx = (0.15 + 0.7 * rng()) * field.nx;
        let fy = field.worldToVoxY(p.yMin + rng() * Math.max(0.5, p.yMax - p.yMin));
        let fz = (0.15 + 0.7 * rng()) * field.nz;
        let dx = rng() - 0.5, dy = (rng() - 0.5) * 0.35, dz = rng() - 0.5;
        const dl = Math.hypot(dx, dy, dz) || 1; dx /= dl; dy /= dl; dz /= dl;
        const rr = p.radius * (0.7 + 0.6 * rng());
        for (let s = 0; s < p.len; s++) {
          dx += (rng() - 0.5) * p.wander * 2; dy += (rng() - 0.5) * p.wander; dz += (rng() - 0.5) * p.wander * 2;
          const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
          fx += dx * 1.6; fy += dy * 1.6; fz += dz * 1.6;
          if (fx < 2 || fy < 1 || fz < 2 || fx > field.nx - 3 || fy > field.ny - 2 || fz > field.nz - 3) break;
          pts.push([fx, fy, fz, rr * (0.75 + 0.5 * Math.sin(s * 0.11 + w))]);
        }
        if (pts.length > 4) paths.push(pts);
      }
      return paths;
    },
  },
  crater: {
    name: 'Crater', icon: '◉', mode: 'stamp', ops: ['sub'],
    params: [P('x', 'X', -60, 60, 1, 6), P('z', 'Z', -60, 60, 1, 6),
      P('radius', 'Radius', 2, 40, 1, 12), P('depth', 'Depth', 1, 25, 0.5, 7),
      P('rim', 'Rim height', 0, 8, 0.25, 2)],
    apply(field, p, op) {
      const c = field.worldToVox(p.x, 0, p.z);
      const rV = p.radius / field.vox, depthD = p.depth, rimD = p.rim;
      const R = Math.ceil(rV * 1.5);
      // Find surface height at center by scanning down.
      let surfY = field.ny - 1;
      for (let y = field.ny - 1; y > 0; y--) {
        if (field.den[field.idx(clamp(Math.round(c[0]), 0, field.nx - 1), y, clamp(Math.round(c[2]), 0, field.nz - 1))] > 0) { surfY = y; break; }
      }
      const surfW = field.voxToWorldY(surfY);
      for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
        const ix = Math.round(c[0]) + dx, iz = Math.round(c[2]) + dz;
        if (ix < 0 || iz < 0 || ix >= field.nx || iz >= field.nz) continue;
        const rr = Math.hypot(dx, dz) / rV;
        if (rr > 1.5) continue;
        const bowl = rr < 1 ? -depthD * (1 - rr * rr) : 0;           // dig (density delta)
        const rim = rimD * Math.exp(-(((rr - 1) * 3.2) ** 2)); // raised rim
        const targetY = surfW + bowl * 0.9 + rim;                     // desired surface height
        for (let y = 0; y < field.ny; y++) {
          const wy = field.voxToWorldY(y);
          const want = targetY - wy;                                   // density for surface at targetY
          const i = field.idx(ix, y, iz);
          if (bowl < 0) field.den[i] = Math.min(field.den[i], want);   // carve only
          else field.den[i] = Math.max(field.den[i], Math.min(want, field.trunc)); // rim add
          if (Math.abs(wy - targetY) < field.vox * 2 && bowl < 0) { field.sed[i] += 0.15; field.hard[i] = Math.min(field.hard[i], 0.35); }
        }
      }
    },
  },
  strata: {
    name: 'Strata bands', icon: '☰', mode: 'modifier', ops: ['add'],
    params: [P('freq', 'Band freq', 0.05, 3, 0.05, 0.55), P('contrast', 'Contrast', 0, 1, 0.05, 0.7),
      P('hardBase', 'Base hard', 0, 1, 0.05, 0.55), P('carve', 'Relief carve', 0, 3, 0.1, 0.6),
      P('phase', 'Phase', 0, 6.28, 0.1, 0)],
    apply(field, p) {
      for (let y = 0; y < field.ny; y++) {
        const wy = field.voxToWorldY(y);
        const b = 0.5 + 0.5 * Math.sin(wy * p.freq * 2 + p.phase + 0.35 * Math.sin(wy * p.freq * 5.3));
        const h = clamp(p.hardBase + (b - 0.5) * 2 * p.contrast * 0.5, 0.02, 1);
        const carve = (b - 0.5) * p.carve * field.vox;
        for (let z = 0; z < field.nz; z++) for (let x = 0; x < field.nx; x++) {
          const i = field.idx(x, y, z);
          if (field.den[i] > -field.vox * 3) {
            field.hard[i] = clamp(field.hard[i] * 0.45 + h * 0.55, 0.02, 1);
            if (field.den[i] > 0) field.den[i] = Math.max(-field.trunc, field.den[i] - Math.max(0, carve));
          }
        }
      }
    },
  },
};

export function defaultParams(kind) {
  const o = {};
  for (const p of LAYERS[kind].params) o[p.key] = p.def;
  return o;
}
let layerSeq = 1;
export function makeLayer(kind, op, params) {
  const def = LAYERS[kind];
  return {
    id: 'L' + (layerSeq++) + '_' + kind,
    kind, name: def.name,
    op: op || def.ops[0],
    k: 2.0, // smooth-blend radius (world units) for op=smooth
    enabled: true,
    params: params || defaultParams(kind),
  };
}
