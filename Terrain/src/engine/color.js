// 179-203 Colour / texturing. Colour layers return RGB (0-1) which the stack blends into the colour buffer with the
// layer's blend mode, opacity and mask. Map layers return named data (normal, AO, flow, snow, ...) for export and preview.
import { makeDef } from './def.js';
import { num, int, sel, color as colorP, seedParam } from './schema.js';
import { clamp, lerp, smoothstep, scaleToMax } from './grid.js';
import { perlin, fractal, worleyF4 } from './noise.js';
import { derive } from './context.js';
import { fieldOf } from './sampling.js';

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);

export const PALETTES = {
  earth: [[0, '#2d4a2b'], [0.35, '#5d7a3a'], [0.6, '#8a7a52'], [0.8, '#7a6b5a'], [1, '#e8e6e0']],
  alpine: [[0, '#2c4a33'], [0.3, '#4f6b3c'], [0.55, '#8a8068'], [0.75, '#9a9590'], [0.9, '#e9eef2'], [1, '#ffffff']],
  desert: [[0, '#7a5a3a'], [0.4, '#c69c6d'], [0.7, '#e0c08c'], [1, '#f2e3c4']],
  arctic: [[0, '#3d5b75'], [0.5, '#a7bed0'], [1, '#f5fbff']],
  volcanic: [[0, '#1a1a1d'], [0.4, '#3a3436'], [0.7, '#6b4a3e'], [1, '#b8553a']],
  tropical: [[0, '#1d4b2c'], [0.3, '#2f7a3e'], [0.6, '#7fa24a'], [0.85, '#d9c27a'], [1, '#f3efe0']],
};
export const paletteOptions = Object.keys(PALETTES).map((k) => [k, k[0].toUpperCase() + k.slice(1)]);

// Build a function t -> [r, g, b] from colour stops.
export function rampOf(stops) {
  const s = stops.map(([t, c]) => [t, typeof c === 'string' ? hex(c) : c]);
  return (t) => {
    t = clamp(t);
    for (let k = 1; k < s.length; k++) {
      if (t <= s[k][0]) {
        const a = s[k - 1], b = s[k];
        const u = (t - a[0]) / Math.max(1e-6, b[0] - a[0]);
        return [lerp(a[1][0], b[1][0], u), lerp(a[1][1], b[1][1], u), lerp(a[1][2], b[1][2], u)];
      }
    }
    return s[s.length - 1][1];
  };
}
const palRamp = (name) => rampOf(PALETTES[name] || PALETTES.earth);

// Build a colour grid by evaluating fn(i) -> [r,g,b] per cell.
const colourGrid = (N, fn) => {
  const out = new Float32Array(N * N * 3);
  for (let i = 0; i < N * N; i++) {
    const c = fn(i);
    out[i * 3] = c[0]; out[i * 3 + 1] = c[1]; out[i * 3 + 2] = c[2];
  }
  return out;
};
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const scale3 = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const colorOf = (h) => hex(h);

const palettePick = [sel('preset', 'Palette', 'earth', paletteOptions)];
const baseColor = [colorP('colour', 'Colour', '#6b7a4a')];

const texture = (ctx, p, seedOff = 0) => {
  const N = ctx.N, f = p.frequency ?? 14;
  return fieldOf(N, (x, y) => 0.5 + 0.5 * fractal(perlin, (x / N) * f, (y / N) * f, p.seed + seedOff, 4, 2, 0.5));
};

export const colorDefs = [
  makeDef({
    id: 179, key: 'colorize', name: 'Colorize', cat: 'Color', kind: 'color', params: [...palettePick, num('shift', 'Altitude shift', 0, -0.5, 0.5, 0.01)],
    desc: 'Altitude colour ramp: each height maps onto a palette gradient.',
    run: (ctx, p) => {
      const ramp = palRamp(p.preset);
      return { color: colourGrid(ctx.N, (i) => ramp(ctx.H[i] + p.shift)) };
    },
  }),
  makeDef({
    id: 180, key: 'satmap', name: 'SatMap', cat: 'Color', kind: 'color', params: [seedParam(12), num('detail', 'Detail', 0.5, 0, 1, 0.01)],
    desc: 'Satellite-style photographic colouring: vegetation, rock and soil blended by slope, altitude, moisture and noise.',
    run: (ctx, p) => {
      const s = ctx.get('slopeN', derive.slopeN), f = ctx.get('flowN', derive.flowN);
      const tex = texture(ctx, { frequency: 40, seed: p.seed }, 3);
      const veg = [0.23, 0.36, 0.17], rock = [0.45, 0.41, 0.36], soil = [0.56, 0.47, 0.33], snow = [0.94, 0.95, 0.97];
      return { color: colourGrid(ctx.N, (i) => {
        const h = ctx.H[i];
        const vegW = (1 - smoothstep(0.1, 0.35, s[i])) * (1 - smoothstep(0.55, 0.75, h)) * (0.6 + 0.4 * f[i]);
        const rockW = smoothstep(0.2, 0.5, s[i]);
        let c = mix3(soil, veg, clamp(vegW));
        c = mix3(c, rock, rockW);
        c = mix3(c, snow, smoothstep(0.75, 0.9, h) * (1 - smoothstep(20, 35, s[i] * 90)));
        return scale3(c, 1 + p.detail * 0.2 * (tex[i] - 0.5));
      }) };
    },
  }),
  makeDef({
    id: 181, key: 'clut', name: 'CLUT', cat: 'Color', kind: 'color', params: [...palettePick, int('bands', 'Bands', 8, 2, 48)],
    desc: 'Colour lookup table: height quantised into bands, each band taking a palette entry.',
    run: (ctx, p) => {
      const ramp = palRamp(p.preset);
      return { color: colourGrid(ctx.N, (i) => ramp(Math.floor(ctx.H[i] * p.bands) / Math.max(1, p.bands - 1))) };
    },
  }),
  makeDef({
    id: 182, key: 'colorSlope', name: 'Color Slope', cat: 'Color', kind: 'color', params: [colorP('flat', 'Flat colour', '#7a8a4a'), colorP('steep', 'Steep colour', '#6e5b4c'), num('threshold', 'Steep threshold [deg]', 35, 5, 80, 0.5)],
    desc: 'Colours by slope: gentle ground takes the flat colour, steep ground takes the steep colour.',
    run: (ctx, p) => {
      const s = ctx.get('slope', derive.slope), a = colorOf(p.flat), b = colorOf(p.steep);
      return { color: colourGrid(ctx.N, (i) => mix3(a, b, smoothstep(p.threshold - 5, p.threshold + 5, s[i]))) };
    },
  }),
  makeDef({
    id: 183, key: 'colorHeight', name: 'Color Height', cat: 'Color', kind: 'color', params: [colorP('low', 'Lowland', '#4c6b3a'), colorP('mid', 'Upland', '#9a8b5e'), colorP('high', 'Highland', '#6f675e'), num('split', 'Split', 0.5, 0, 1, 0.01)],
    desc: 'Three height bands: lowland, upland and highland colours.',
    run: (ctx, p) => {
      const lo = colorOf(p.low), mi = colorOf(p.mid), hi = colorOf(p.high);
      return { color: colourGrid(ctx.N, (i) => {
        const h = ctx.H[i];
        return h < p.split ? mix3(lo, mi, smoothstep(p.split - 0.2, p.split, h)) : mix3(mi, hi, smoothstep(p.split, p.split + 0.2, h));
      }) };
    },
  }),
  makeDef({
    id: 184, key: 'colorCurvature', name: 'Color Curvature', cat: 'Color', kind: 'color', params: [colorP('convex', 'Convex (ridge)', '#c9b48a'), colorP('concave', 'Concave (hollow)', '#34402a'), colorP('base', 'Neutral', '#7a7a6a')],
    desc: 'Colours by curvature: ridges light, hollows dark.',
    run: (ctx, p) => {
      const c = ctx.get('curvature', derive.curvature);
      const cv = colorOf(p.convex), cc = colorOf(p.concave), b = colorOf(p.base);
      return { color: colourGrid(ctx.N, (i) => (c[i] >= 0 ? mix3(b, cv, c[i]) : mix3(b, cc, -c[i]))) };
    },
  }),
  makeDef({
    id: 185, key: 'colorFlow', name: 'Color Flow', cat: 'Color', kind: 'color', params: [colorP('dry', 'Dry', '#7a6a4a'), colorP('wet', 'Water flow', '#2a6fa0'), num('threshold', 'Threshold', 0.6, 0, 1, 0.01)],
    desc: 'Colours drainage lines by water flow accumulation.',
    run: (ctx, p) => {
      const f = ctx.get('flowN', derive.flowN), a = colorOf(p.dry), b = colorOf(p.wet);
      return { color: colourGrid(ctx.N, (i) => mix3(a, b, smoothstep(p.threshold - 0.05, p.threshold + 0.1, f[i]))), alpha: Float32Array.from(f, (v) => smoothstep(p.threshold - 0.1, p.threshold, v)) };
    },
  }),
  makeDef({
    id: 186, key: 'colorSnow', name: 'Color Snow', cat: 'Color', kind: 'color', params: [colorP('snow', 'Snow colour', '#f2f5f8'), num('altitude', 'Snowline', 0.65, 0, 1, 0.01), num('slopeMax', 'Max slope [deg]', 35, 0, 90, 0.5)],
    desc: 'Snow cover on high, gentle ground.',
    run: (ctx, p) => {
      const s = ctx.get('slope', derive.slope), sc = colorOf(p.snow);
      return { color: colourGrid(ctx.N, () => sc), alpha: Float32Array.from(ctx.H, (h, i) => smoothstep(p.altitude, p.altitude + 0.1, h) * (1 - smoothstep(p.slopeMax - 5, p.slopeMax + 5, s[i]))) };
    },
  }),
  makeDef({
    id: 187, key: 'colorRock', name: 'Color Rock', cat: 'Color', kind: 'color', params: [colorP('rock', 'Rock colour', '#7d766d'), num('threshold', 'Rock slope [deg]', 40, 5, 80, 0.5)],
    desc: 'Exposed rock on steep faces.',
    run: (ctx, p) => {
      const s = ctx.get('slope', derive.slope), rc = colorOf(p.rock);
      return { color: colourGrid(ctx.N, () => rc), alpha: Float32Array.from(s, (v) => smoothstep(p.threshold - 6, p.threshold + 6, v)) };
    },
  }),
  makeDef({
    id: 188, key: 'colorVegetation', name: 'Color Vegetation', cat: 'Color', kind: 'color', params: [colorP('green', 'Vegetation', '#4a6b32'), num('maxHeight', 'Max altitude', 0.6, 0, 1, 0.01), num('moisture', 'Moisture preference', 0.5, 0, 1, 0.01)],
    desc: 'Vegetation on low, gentle, moist ground.',
    run: (ctx, p) => {
      const s = ctx.get('slopeN', derive.slopeN), f = ctx.get('flowN', derive.flowN), g = colorOf(p.green);
      return { color: colourGrid(ctx.N, () => g), alpha: Float32Array.from(ctx.H, (h, i) => clamp((1 - smoothstep(p.maxHeight - 0.15, p.maxHeight, h)) * (1 - smoothstep(0.1, 0.35, s[i])) * lerp(1, f[i], p.moisture))) };
    },
  }),
  makeDef({
    id: 189, key: 'colorDesert', name: 'Color Desert', cat: 'Color', kind: 'color', params: [colorP('sand', 'Sand colour', '#d7b98a'), num('dry', 'Dryness', 0.7, 0, 1, 0.01)],
    desc: 'Sand and dry ground on flat, low-moisture areas and dunes.',
    run: (ctx, p) => {
      const s = ctx.get('slopeN', derive.slopeN), f = ctx.get('flowN', derive.flowN), sand = colorOf(p.sand);
      return { color: colourGrid(ctx.N, () => sand), alpha: Float32Array.from(f, (v, i) => clamp(p.dry * (1 - v) + 0.3 * (1 - s[i]))) };
    },
  }),
  makeDef({
    id: 190, key: 'colorIce', name: 'Color Ice', cat: 'Color', kind: 'color', params: [colorP('ice', 'Ice colour', '#bfe3f5'), num('altitude', 'Ice altitude', 0.8, 0, 1, 0.01)],
    desc: 'Blue-white glacial ice above the ice line.',
    run: (ctx, p) => {
      const ic = colorOf(p.ice);
      return { color: colourGrid(ctx.N, () => ic), alpha: Float32Array.from(ctx.H, (h) => smoothstep(p.altitude - 0.05, p.altitude + 0.1, h)) };
    },
  }),
  makeDef({
    id: 191, key: 'colorWater', name: 'Color Water', cat: 'Color', kind: 'color', params: [colorP('deep', 'Deep water', '#1b4f6b'), colorP('shallow', 'Shallow water', '#4fa3b8'), num('depth', 'Depth scale', 0.05, 0.001, 0.3, 0.001)],
    desc: 'Water surface colour from depth: shallows are light, deep water is dark.',
    run: (ctx, p) => {
      const d = colorOf(p.deep), sh = colorOf(p.shallow);
      return { color: colourGrid(ctx.N, (i) => mix3(sh, d, smoothstep(0, p.depth, ctx.water[i]))), alpha: Float32Array.from(ctx.water, (w) => smoothstep(0, 0.0005, w)) };
    },
  }),
  makeDef({
    id: 192, key: 'gradientMap', name: 'Gradient Map', cat: 'Color', kind: 'color', params: [colorP('dark', 'Shadow colour', '#1a1d22'), colorP('light', 'Highlight colour', '#e6e2d6')],
    desc: 'Remaps the luminance of the colour buffer through a two-colour gradient.',
    run: (ctx, p) => {
      const a = colorOf(p.dark), b = colorOf(p.light), C = ctx.C;
      return { color: colourGrid(ctx.N, (i) => {
        const l = 0.299 * C[i * 3] + 0.587 * C[i * 3 + 1] + 0.114 * C[i * 3 + 2];
        return mix3(a, b, l);
      }) };
    },
  }),
  makeDef({
    id: 193, key: 'triplanar', name: 'Triplanar', cat: 'Color', kind: 'color', params: [...baseColor, num('scale', 'Texture scale', 40, 4, 200, 1), num('blend', 'Side blend', 0.6, 0, 1, 0.01), seedParam(93)],
    desc: 'Triplanar projection: a procedural texture projected from the top and blended onto steep sides by the surface normal.',
    run: (ctx, p) => {
      const N = ctx.N, base = colorOf(p.colour), s = ctx.get('slopeN', derive.slopeN);
      const topT = fieldOf(N, (x, y) => 0.5 + 0.5 * fractal(perlin, (x / N) * p.scale, (y / N) * p.scale, p.seed, 4, 2, 0.5));
      const sideT = fieldOf(N, (x, y, i) => 0.5 + 0.5 * fractal(perlin, (ctx.H[i] * p.scale), (x / N) * p.scale, p.seed + 5, 4, 2, 0.5));
      return { color: colourGrid(N, (i) => {
        const wSide = clamp(s[i] * (1 + p.blend)) * p.blend;
        const t = lerp(topT[i], sideT[i], wSide);
        return scale3(base, 0.75 + 0.5 * t);
      }) };
    },
  }),
  makeDef({
    id: 194, key: 'splat', name: 'Splat', cat: 'Color', kind: 'color', params: [colorP('a', 'Material A (low)', '#5d7a3a'), colorP('b', 'Material B (mid)', '#8a7a52'), colorP('c', 'Material C (steep)', '#6e5b4c'), colorP('d', 'Material D (high)', '#e8e6e0'), num('sharp', 'Blend sharpness', 6, 0.5, 20, 0.1), seedParam(94)],
    desc: 'Weighted multi-texture splatting: four materials weighted by altitude, slope and noise.',
    run: (ctx, p) => {
      const s = ctx.get('slopeN', derive.slopeN);
      const n = texture(ctx, { frequency: 10, seed: p.seed }, 2);
      const A = colorOf(p.a), B = colorOf(p.b), Cc = colorOf(p.c), D = colorOf(p.d);
      return { color: colourGrid(ctx.N, (i) => {
        const h = ctx.H[i] + (n[i] - 0.5) * 0.1;
        const wa = Math.exp(-p.sharp * Math.max(0, h - 0.2) ** 2);
        const wb = Math.exp(-p.sharp * (h - 0.45) ** 2);
        const wc = clamp(s[i] * 3);
        const wd = smoothstep(0.7, 0.85, h);
        const sum = wa + wb + wc + wd + 1e-6;
        return [0, 1, 2].map((k) => (A[k] * wa + B[k] * wb + Cc[k] * wc + D[k] * wd) / sum);
      }) };
    },
  }),
  makeDef({
    id: 195, key: 'material', name: 'Material', cat: 'Color', kind: 'color', params: [int('materials', 'Material count', 4, 2, 8), seedParam(95)],
    desc: 'Full material assignment: each cell gets one material chosen from altitude and slope bands.',
    run: (ctx, p) => {
      const s = ctx.get('slopeN', derive.slopeN), ramp = palRamp('earth');
      return { color: colourGrid(ctx.N, (i) => {
        const mat = Math.min(p.materials - 1, Math.floor(clamp(ctx.H[i] * 0.7 + s[i] * 0.5 + (worleyF4(i % ctx.N / 40, (i / ctx.N) / 40, p.seed).f[0] - 0.5) * 0.2) * p.materials));
        return ramp(mat / Math.max(1, p.materials - 1));
      }) };
    },
  }),
  makeDef({
    id: 196, key: 'albedo', name: 'Albedo', cat: 'Color', kind: 'color', params: [num('gain', 'Albedo gain', 1, 0, 2, 0.01), num('saturation', 'Saturation', 1, 0, 2, 0.01)],
    desc: 'Albedo output: scales brightness and saturation of the colour buffer (diffuse, no lighting).',
    run: (ctx, p) => {
      const C = ctx.C;
      return { color: colourGrid(ctx.N, (i) => {
        const r = C[i * 3], g = C[i * 3 + 1], b = C[i * 3 + 2];
        const l = 0.299 * r + 0.587 * g + 0.114 * b;
        return [r, g, b].map((c) => clamp(lerp(l, c, p.saturation) * p.gain));
      }) };
    },
  }),
  makeDef({
    id: 197, key: 'normalMap', name: 'Normal Map', cat: 'Color', kind: 'map', params: [num('strength', 'Strength', 1, 0, 4, 0.01)],
    desc: 'Tangent-space normal map from the height gradient (stored as RGB, 0.5 = flat).',
    run: (ctx, p) => {
      const N = ctx.N, g = ctx.get('grad', derive.grad);
      const k = p.strength * N * (ctx.heightScale / ctx.worldSize) * 2;
      const data = new Float32Array(N * N * 3);
      for (let i = 0; i < N * N; i++) {
        let nx = -g.gx[i] * k, ny = -g.gy[i] * k, nz = 1;
        const l = Math.hypot(nx, ny, nz);
        data[i * 3] = nx / l * 0.5 + 0.5; data[i * 3 + 1] = ny / l * 0.5 + 0.5; data[i * 3 + 2] = nz / l * 0.5 + 0.5;
      }
      return { map: { name: 'normal', ch: 3, data } };
    },
  }),
  makeDef({
    id: 198, key: 'roughnessMap', name: 'Roughness Map', cat: 'Color', kind: 'map', params: [num('base', 'Base', 0.7, 0, 1, 0.01), num('variation', 'Variation', 0.3, 0, 1, 0.01)],
    desc: 'Roughness from local roughness and slope (rock is rough, smooth sand is rougher than water).',
    run: (ctx, p) => {
      const r = scaleToMax(ctx.get('roughness', derive.roughness));
      const s = ctx.get('slopeN', derive.slopeN);
      return { map: { name: 'roughness', ch: 1, data: Float32Array.from(r, (v, i) => clamp(p.base + p.variation * (v - 0.5) + 0.1 * s[i])) } };
    },
  }),
  makeDef({
    id: 199, key: 'aoMap', name: 'AO Map', cat: 'Color', kind: 'map', params: [num('strength', 'Strength', 1, 0, 2, 0.01)],
    desc: 'Ambient occlusion map from horizon sampling.',
    run: (ctx, p) => ({ map: { name: 'ao', ch: 1, data: Float32Array.from(ctx.get('ao', derive.ao), (v) => clamp(1 - (1 - v) * p.strength)) } }),
  }),
  makeDef({
    id: 200, key: 'displacementMap', name: 'Displacement Map', cat: 'Color', kind: 'map', params: [],
    desc: 'Displacement output: the normalised height used for vertex displacement.',
    run: (ctx) => ({ map: { name: 'displacement', ch: 1, data: Float32Array.from(ctx.H) } }),
  }),
  makeDef({
    id: 201, key: 'flowMap', name: 'Flow Map', cat: 'Color', kind: 'map', params: [],
    desc: 'Water flow direction (RG = downhill vector, 0.5 = none).',
    run: (ctx) => {
      const N = ctx.N, hyd = ctx.get('hydro', derive.hydro);
      const data = new Float32Array(N * N * 2);
      for (let i = 0; i < N * N; i++) {
        const j = hyd.dir[i];
        let dx = 0, dy = 0;
        if (j >= 0) { dx = (j % N) - (i % N); dy = ((j / N) | 0) - ((i / N) | 0); const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l; }
        data[i * 2] = dx * 0.5 + 0.5; data[i * 2 + 1] = dy * 0.5 + 0.5;
      }
      return { map: { name: 'flow', ch: 2, data } };
    },
  }),
  makeDef({
    id: 202, key: 'moistureMap', name: 'Moisture Map', cat: 'Color', kind: 'map', params: [num('lowland', 'Lowland wetness', 0.6, 0, 1, 0.01)],
    desc: 'Moisture: drainage, low altitude and gentle slopes hold water.',
    run: (ctx, p) => {
      const f = ctx.get('flowN', derive.flowN), s = ctx.get('slopeN', derive.slopeN);
      return { map: { name: 'moisture', ch: 1, data: Float32Array.from(f, (v, i) => clamp(0.55 * v + p.lowland * (1 - ctx.H[i]) * (1 - s[i]))) } };
    },
  }),
  makeDef({
    id: 203, key: 'snowMap', name: 'Snow Map', cat: 'Color', kind: 'map', params: [num('altitude', 'Snowline', 0.65, 0, 1, 0.01), num('slopeMax', 'Max slope [deg]', 35, 0, 90, 0.5)],
    desc: 'Snow coverage (0-1) from altitude and slope.',
    run: (ctx, p) => {
      const s = ctx.get('slope', derive.slope);
      return { map: { name: 'snow', ch: 1, data: Float32Array.from(ctx.H, (h, i) => smoothstep(p.altitude, p.altitude + 0.1, h) * (1 - smoothstep(p.slopeMax - 5, p.slopeMax + 5, s[i]))) } };
    },
  }),
];

