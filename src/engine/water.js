// Water features (85-94). Every node CARVES into the heightfield and records the
// water surface level in st.water (NaN = dry). Water is never a blue overlay mesh.
import { clamp01, smoothstep, boxBlur, gaussBlur, fillDepressions, d8Receivers, flowAccumulation, sample, make, minmax } from './grid.js';
import { perlin } from './noise.js';

const DRY = (N) => new Float32Array(N * N).fill(NaN);
export function ensureWater(st) { if (!st.water) st.water = DRY(st.N); return st.water; }

// Channel network from flow accumulation over a depression-filled surface.
function network(h, N, thresholdFrac) {
  const filled = fillDepressions(h, N);
  const recv = d8Receivers(filled, N);
  const { acc } = flowAccumulation(filled, N, recv);
  let amax = 1; for (const a of acc) if (a > amax) amax = a;
  const chan = new Float32Array(h.length);
  for (let i = 0; i < h.length; i++) chan[i] = acc[i] / amax >= thresholdFrac ? clamp01((acc[i] / amax - thresholdFrac) / (thresholdFrac * 2 + 1e-6) + 0.2) : 0;
  return { filled, recv, acc, amax, chan };
}

const P = (p, k, d) => (p[k] ?? d);

function carveChannels(h, N, st, o) {
  const net = network(h, N, o.threshold);
  const out = Float32Array.from(h);
  const w = ensureWater(st);
  const soft = boxBlur(net.chan, N, o.width);
  for (let i = 0; i < out.length; i++) {
    const c = Math.max(net.chan[i], soft[i] * 0.5);
    if (c <= 0.02) continue;
    const bed = out[i] - o.depth * c;
    out[i] = bed;
    if (net.chan[i] > 0.3) w[i] = bed + o.waterLift;
  }
  return out;
}

export const WATER = {
  // 85 Water Fill: fill depressions up to a level without carving.
  85: (h, N, p, st) => {
    const level = P(p, 'level', 0.25), w = ensureWater(st), f = fillDepressions(h, N);
    for (let i = 0; i < h.length; i++) if (f[i] > h[i] + 1e-5 && f[i] <= level) w[i] = f[i];
    return h;
  },
  // 86 Lake: carve lake basins (depressions) deeper and fill them to their spill level.
  86: (h, N, p, st) => {
    const minDepth = P(p, 'minDepth', 0.02), deepen = P(p, 'deepen', 0.5), w = ensureWater(st);
    const f = fillDepressions(h, N);
    const out = Float32Array.from(h);
    let mx = 1e-9; for (let i = 0; i < h.length; i++) mx = Math.max(mx, f[i] - h[i]);
    // only the deepest basins become lakes: depth must exceed the threshold AND a fraction of the largest basin
    const cut = Math.max(minDepth, mx * P(p, 'selectivity', 0.6));
    for (let i = 0; i < h.length; i++) {
      const d = f[i] - h[i];
      if (d > cut) {
        out[i] = h[i] - deepen * (d / mx) * 0.08;
        w[i] = f[i];
      }
    }
    return out;
  },
  // 87 River: carve a real channel network from D8 flow accumulation.
  87: (h, N, p, st) => carveChannels(h, N, st, { threshold: P(p, 'threshold', 0.03), depth: P(p, 'depth', 0.05), width: P(p, 'width', 1), waterLift: P(p, 'waterLift', 0.004) }),
  // 88 Stream: smaller tributaries, shallower carving.
  88: (h, N, p, st) => carveChannels(h, N, st, { threshold: P(p, 'threshold', 0.008), depth: P(p, 'depth', 0.015), width: P(p, 'width', 0), waterLift: P(p, 'waterLift', 0.002) }),
  // 89 Ocean: sea level; everything below is flooded and the shoreline is carved.
  89: (h, N, p, st) => {
    const level = P(p, 'level', 0.2), shelf = P(p, 'shelf', 0.04), w = ensureWater(st);
    st.seaLevel = level;
    const out = Float32Array.from(h);
    for (let i = 0; i < h.length; i++) {
      if (h[i] < level) { out[i] = Math.min(h[i], level - shelf * clamp01((level - h[i]) * 6)); w[i] = level; }
      else if (h[i] < level + shelf) out[i] = h[i] - (level + shelf - h[i]) * 0.3 * P(p, 'carve', 1);
    }
    return out;
  },
  // 90 Flood: flood plain — water spreads across low ground near channels up to a stage height.
  90: (h, N, p, st) => {
    const stage = P(p, 'stage', 0.02), w = ensureWater(st);
    const net = network(h, N, P(p, 'threshold', 0.02));
    const near = boxBlur(net.chan, N, P(p, 'reach', 8));
    const out = Float32Array.from(h);
    for (let i = 0; i < h.length; i++) {
      if (near[i] > 0.05 && net.chan[i] < 0.2) {
        const bed = net.filled[i];
        const level = bed + stage;
        if (h[i] < level) { out[i] = h[i] * 0.5 + level * 0.5 - stage * 0.1; w[i] = level; }
      }
    }
    return out;
  },
  // 91 Pond: small shallow basins only (filled area limited).
  91: (h, N, p, st) => {
    const minDepth = P(p, 'minDepth', 0.004), maxDepth = P(p, 'maxDepth', 0.04), w = ensureWater(st);
    const f = fillDepressions(h, N);
    const basin = new Float32Array(h.length);
    for (let i = 0; i < h.length; i++) basin[i] = f[i] - h[i] > minDepth ? 1 : 0;
    const local = boxBlur(basin, N, 3);
    const out = Float32Array.from(h);
    for (let i = 0; i < h.length; i++) {
      if (basin[i] && local[i] > 0.6 && f[i] - h[i] < maxDepth) { out[i] = h[i] - (f[i] - h[i]) * 0.4; w[i] = out[i] + (f[i] - out[i]) * 0.6; }
    }
    return out;
  },
  // 92 Waterfall: step drops where the channel crosses steep ground; plunge pool below.
  92: (h, N, p, st) => {
    const net = network(h, N, P(p, 'threshold', 0.02));
    const drop = P(p, 'drop', 0.06), w = ensureWater(st);
    const out = Float32Array.from(h);
    for (let i = 0; i < h.length; i++) {
      if (net.chan[i] < 0.2) continue;
      const r = net.recv[i]; if (r === i) continue;
      const fall = h[i] - h[r];
      if (fall > P(p, 'steep', 0.01)) {
        out[r] -= drop * 0.5;
        out[i] += drop * 0.25;
        w[r] = out[r] + 0.01;
      }
    }
    return out;
  },
  // 93 Delta: deposit a fan of sediment where channels reach sea level.
  93: (h, N, p, st) => {
    const sea = st.seaLevel ?? P(p, 'sea', 0.2), radius = P(p, 'radius', 10), amt = P(p, 'amount', 0.05), w = ensureWater(st);
    const net = network(h, N, P(p, 'threshold', 0.02));
    const mouth = new Float32Array(h.length);
    for (let i = 0; i < h.length; i++) {
      const r = net.recv[i];
      if (net.chan[i] > 0.3 && h[r] <= sea && h[i] > sea - 0.02) mouth[i] = 1;
    }
    const fan = boxBlur(mouth, N, Math.max(2, radius | 0));
    const out = Float32Array.from(h);
    for (let i = 0; i < h.length; i++) {
      if (fan[i] > 0.01 && out[i] < sea + amt) {
        out[i] = Math.max(out[i], sea - 0.005) + fan[i] * amt * 0.5;
        if (out[i] < sea) w[i] = sea;
      }
    }
    return out;
  },
  // 94 Meander: channel carved along a sinusoidally displaced path (domain-warped sampling).
  94: (h, N, p, st) => {
    const amp = P(p, 'amplitude', 0.05) * N, freq = P(p, 'frequency', 3), depth = P(p, 'depth', 0.05), w = ensureWater(st);
    const net = network(h, N, P(p, 'threshold', 0.03));
    const out = Float32Array.from(h);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const sx = x + amp * Math.sin((y / N) * Math.PI * 2 * freq);
      const c = sample(net.chan, N, sx, y);
      if (c > 0.15) {
        const i = y * N + x;
        out[i] -= depth * c;
        if (c > 0.4) w[i] = out[i] + 0.005;
      }
    }
    return out;
  },
};
