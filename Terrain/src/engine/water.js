// 85-94 Water features. Water is carved INTO the heightfield: channels, lake basins and ocean floors are lowered
// and the free surface is returned separately as a depth map (`water`), which the viewport draws as a transparent
// fill inside the carved depression. No water is ever a blue mesh laid on top of the terrain.
import { makeDef } from './def.js';
import { num, int, seedParam } from './schema.js';
import { mulberry32 } from './rng.js';
import { clamp, lerp, smoothstep, blurGauss, distanceFromMask, normalizeGrid } from './grid.js';
import { derive } from './context.js';

const channelOf = (ctx, thr, soft = 0.03) => {
  const f = ctx.get('flowN', derive.flowN);
  return Float32Array.from(f, (v) => smoothstep(thr, thr + soft, v));
};

// Carve a channel network from the flow accumulation and report the water depth inside it.
function carveChannel(ctx, thr, width, depth, bank) {
  const N = ctx.N;
  const ch = channelOf(ctx, thr);
  const core = width > 0.6 ? blurGauss(ch, N, width * 0.5) : ch;
  const f = ctx.get('flowN', derive.flowN);
  const wide = blurGauss(ch, N, width * 2);
  const H = Float32Array.from(ctx.H), water = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) {
    const c = clamp(core[i]);
    const carve = depth * c * (0.5 + 0.5 * f[i]);
    const bankCut = bank * (wide[i] - c) * 0.5;
    H[i] = clamp(H[i] - carve - Math.max(0, bankCut));
    water[i] = c * depth * 0.35;
  }
  return { height: H, water };
}

// Basins: lowest closed depressions (filled - raw) with spacing, carved as bowls with a flat water surface.
function carveBasins(ctx, count, radius, depth, minDepth) {
  const N = ctx.N, hyd = ctx.get('hydro', derive.hydro);
  const D = new Float32Array(N * N);
  for (let i = 0; i < D.length; i++) D[i] = hyd.filled[i] - ctx.H[i];
  const H = Float32Array.from(ctx.H), water = new Float32Array(N * N);
  const R = Math.max(2, radius * N);
  const taken = new Uint8Array(N * N);
  // Greedy seed selection: deepest cells first, suppressed around each chosen seed.
  const order = Array.from({ length: N * N }, (_, i) => i).sort((a, b) => D[b] - D[a]);
  let placed = 0;
  for (const s of order) {
    if (placed >= count) break;
    if (D[s] < minDepth || taken[s]) continue;
    placed++;
    const sx = s % N, sy = (s / N) | 0, level = hyd.filled[s];
    const rr = Math.ceil(R * 1.6);
    for (let y = Math.max(0, sy - rr); y < Math.min(N, sy + rr + 1); y++) {
      for (let x = Math.max(0, sx - rr); x < Math.min(N, sx + rr + 1); x++) {
        const d = Math.hypot(x - sx, y - sy);
        const j = y * N + x;
        if (d < R * 0.6) taken[j] = 1;
        if (d > R) continue;
        const w = (1 - (d / R) ** 2) ** 2;
        const floor = level - depth;
        H[j] = Math.min(H[j], lerp(H[j], floor, w));
        water[j] = Math.max(water[j], Math.max(0, level - H[j]) * (w > 0.02 ? 1 : 0));
      }
    }
  }
  return { height: H, water };
}

export const waterDefs = [
  makeDef({
    id: 85, key: 'waterFill', name: 'Water Fill', cat: 'Water', status: 'full',
    params: [num('level', 'Water level', 0.25, 0, 1, 0.005)],
    desc: 'Fill depressions to a water level: basins below the level get a flat surface, the ground itself is untouched.',
    run: (ctx, p) => {
      const filled = ctx.get('hydro', derive.hydro).filled;
      const water = new Float32Array(ctx.H.length);
      for (let i = 0; i < water.length; i++) {
        const surface = Math.min(filled[i], p.level);
        water[i] = Math.max(0, surface - ctx.H[i]) * (ctx.H[i] < p.level ? 1 : 0);
      }
      return { water };
    },
  }),
  makeDef({
    id: 86, key: 'lake', name: 'Lake', cat: 'Water', status: 'full',
    params: [int('count', 'Lakes', 4, 1, 40), num('radius', 'Basin radius (fraction)', 0.06, 0.01, 0.3, 0.005), num('depth', 'Basin depth', 0.06, 0, 0.4, 0.002), num('minDepth', 'Min depression depth', 0.002, 0, 0.1, 0.0005)],
    desc: 'Lake basins carved at the deepest closed depressions, with a flat water surface at the spill level.',
    run: (ctx, p) => carveBasins(ctx, p.count, p.radius, p.depth, p.minDepth),
  }),
  makeDef({
    id: 87, key: 'river', name: 'River', cat: 'Water', status: 'full',
    params: [num('threshold', 'Drainage threshold', 0.7, 0, 1, 0.01), num('width', 'Width (cells)', 2, 0.5, 10, 0.1), num('depth', 'Channel depth', 0.05, 0, 0.3, 0.001), num('bank', 'Bank cut', 0.2, 0, 1, 0.01)],
    desc: 'Major river channels carved along the drainage network.',
    run: (ctx, p) => carveChannel(ctx, p.threshold, p.width, p.depth, p.bank),
  }),
  makeDef({
    id: 88, key: 'stream', name: 'Stream', cat: 'Water', status: 'full',
    params: [num('threshold', 'Drainage threshold', 0.5, 0, 1, 0.01), num('width', 'Width (cells)', 1, 0.5, 6, 0.1), num('depth', 'Channel depth', 0.02, 0, 0.2, 0.001), num('bank', 'Bank cut', 0.05, 0, 1, 0.01)],
    desc: 'Small streams: narrow, shallow channels on the upper drainage.',
    run: (ctx, p) => carveChannel(ctx, p.threshold, p.width, p.depth, p.bank),
  }),
  makeDef({
    id: 89, key: 'ocean', name: 'Ocean', cat: 'Water', status: 'full',
    params: [num('level', 'Sea level', 0.25, 0, 1, 0.005), num('bed', 'Shelf deepening', 0.4, 0, 2, 0.01), num('shore', 'Shore smoothing', 0.5, 0, 1, 0.01)],
    desc: 'Ocean: everything below sea level is water; the sea floor is deepened and the shore smoothed.',
    run: (ctx, p) => {
      const N = ctx.N;
      const sm = blurGauss(ctx.H, N, 2);
      const H = Float32Array.from(ctx.H, (h, i) => {
        if (h >= p.level) return lerp(h, sm[i], p.shore * (1 - smoothstep(0, 0.1, Math.abs(h - p.level))) * 0.5);
        return clamp(h - p.bed * (p.level - h));
      });
      const water = Float32Array.from(H, (h) => Math.max(0, p.level - h));
      return { height: H, water };
    },
  }),
  makeDef({
    id: 90, key: 'flood', name: 'Flood', cat: 'Water', status: 'full',
    params: [num('level', 'Flood level', 0.32, 0, 1, 0.005), num('reach', 'Reach from channel (cells)', 16, 1, 80, 0.5), num('flatness', 'Flatness required', 0.7, 0, 1, 0.01), num('threshold', 'Channel threshold', 0.6, 0, 1, 0.01)],
    desc: 'Flood plain: low, flat ground near the drainage is inundated to a flood level.',
    run: (ctx, p) => {
      const N = ctx.N, ch = channelOf(ctx, p.threshold);
      const dist = distanceFromMask(ch, N, p.reach);
      const s = ctx.get('slopeN', derive.slopeN);
      const H = Float32Array.from(ctx.H), water = new Float32Array(N * N);
      for (let i = 0; i < N * N; i++) {
        const near = 1 - smoothstep(0, p.reach, dist[i]);
        const flat = 1 - smoothstep(0.02, 0.2 + (1 - p.flatness) * 0.5, s[i]);
        const m = near * flat * (ctx.H[i] < p.level ? 1 : 0);
        H[i] = lerp(ctx.H[i], p.level, m);
        water[i] = m * Math.max(0, p.level - ctx.H[i]);
      }
      return { height: H, water };
    },
  }),
  makeDef({
    id: 91, key: 'pond', name: 'Pond', cat: 'Water', status: 'full',
    params: [int('count', 'Ponds', 14, 1, 80), num('radius', 'Pond radius (fraction)', 0.025, 0.005, 0.15, 0.001), num('depth', 'Pond depth', 0.02, 0, 0.2, 0.001)],
    desc: 'Many small pond basins at the shallow depressions.',
    run: (ctx, p) => carveBasins(ctx, p.count, p.radius, p.depth, 0.0008),
  }),
  makeDef({
    id: 92, key: 'waterfall', name: 'Waterfall', cat: 'Water', status: 'full',
    params: [num('threshold', 'Channel threshold', 0.6, 0, 1, 0.01), num('steep', 'Min steepness [deg]', 25, 5, 80, 0.5), num('drop', 'Drop height', 0.04, 0, 0.3, 0.001)],
    desc: 'Waterfalls: steep channel reaches are dropped by a step, with a thin water film over the lip.',
    run: (ctx, p) => {
      const N = ctx.N, ch = channelOf(ctx, p.threshold);
      const s = ctx.get('slope', derive.slope);
      const H = Float32Array.from(ctx.H), water = new Float32Array(N * N);
      for (let i = 0; i < H.length; i++) {
        const w = ch[i] * smoothstep(p.steep - 3, p.steep + 3, s[i]);
        H[i] = clamp(H[i] - p.drop * w);
        water[i] = w * 0.003;
      }
      return { height: blurGauss(H, N, 0.6), water };
    },
  }),
  makeDef({
    id: 93, key: 'delta', name: 'Delta', cat: 'Water', status: 'full',
    params: [num('sea', 'Sea level', 0.25, 0, 1, 0.005), num('threshold', 'Channel threshold', 0.6, 0, 1, 0.01), num('reach', 'Fan radius (cells)', 14, 2, 60, 0.5), num('deposit', 'Deposit height', 0.04, 0, 0.3, 0.001)],
    desc: 'River delta: sediment fans out at the river mouth, building land up to the sea level.',
    run: (ctx, p) => {
      const N = ctx.N, ch = channelOf(ctx, p.threshold);
      const mouth = new Float32Array(N * N);
      for (let i = 0; i < mouth.length; i++) mouth[i] = ch[i] * (Math.abs(ctx.H[i] - p.sea) < 0.06 ? 1 : 0);
      const fan = blurGauss(mouth, N, p.reach / 3);
      const fm = normalizeGrid(fan);
      const H = Float32Array.from(ctx.H, (h, i) => {
        const add = p.deposit * fm[i] * smoothstep(0.02, 0.2, fm[i]);
        return clamp(h + add);
      });
      const water = Float32Array.from(H, (h) => Math.max(0, p.sea - h) * 0.5);
      return { height: H, water };
    },
  }),
  makeDef({
    id: 94, key: 'meander', name: 'Meander', cat: 'Water', status: 'full',
    params: [num('threshold', 'Channel threshold', 0.65, 0, 1, 0.01), num('amplitude', 'Meander amplitude (fraction)', 0.06, 0, 0.3, 0.001), num('wavelength', 'Wavelength (fraction)', 0.25, 0.02, 1, 0.005),
      num('depth', 'Channel depth', 0.05, 0, 0.3, 0.001), seedParam(41)],
    desc: 'Meandering river: the drainage channel is re-sampled along a sinuous, warped path and carved there.',
    run: (ctx, p) => {
      const N = ctx.N, f = ctx.get('flowN', derive.flowN);
      const rnd = mulberry32(p.seed);
      const phase = rnd() * Math.PI * 2;
      const amp = p.amplitude * N, k = (2 * Math.PI) / Math.max(1, p.wavelength * N);
      const warped = new Float32Array(N * N);
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const sx = Math.min(N - 1, Math.max(0, Math.round(x + amp * Math.sin(y * k + phase))));
        warped[y * N + x] = f[y * N + sx];
      }
      const ch = Float32Array.from(warped, (v) => smoothstep(p.threshold, p.threshold + 0.03, v));
      const H = Float32Array.from(ctx.H, (h, i) => clamp(h - p.depth * ch[i]));
      const water = Float32Array.from(ch, (c) => c * p.depth * 0.35);
      return { height: H, water };
    },
  }),
];

