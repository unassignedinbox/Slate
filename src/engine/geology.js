// Geological / tectonic nodes (70-84). Each takes (h, N, p, st) and returns a new heightfield
// (and may add entries to st.maps). Operate in height units [0,1].
import { clamp01, smoothstep, gaussBlur, boxBlur, slopeOf, d8Receivers, fillDepressions, flowAccumulation, sample } from './grid.js';
import { fbm, perlin, voronoiDists, hash2 } from './noise.js';

const bumpFn = (d, r) => clamp01(1 - d / r);
const cosBump = (d, r) => (d >= r ? 0 : 0.5 + 0.5 * Math.cos((Math.PI * d) / r));
const P = (p, k, d) => (p[k] ?? d);

export const GEOLOGY = {
  // 70 Strata: quantised, tilted rock layers with hardness varying per layer.
  70: (h, N, p) => {
    const layers = Math.max(2, P(p, 'layers', 12)), tilt = P(p, 'tilt', 0.4), amt = P(p, 'amount', 0.5);
    const sd = P(p, 'seed', 1);
    const out = new Float32Array(h.length);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = y * N + x; const u = x / N, v = y / N;
      const s = h[i] * layers + (u * tilt + v * tilt * 0.5) * layers;
      const f = Math.floor(s), t = s - f;
      const hard = 0.6 + 0.4 * hash2(f, 0, sd);
      const step = (f + smoothstep(0.35, 0.65, t) * hard) / layers;
      out[i] = h[i] * (1 - amt) + step * amt;
    }
    return out;
  },
  // 71 Sediment: deposition fills low, flat valley floors.
  71: (h, N, p, st) => {
    const sl = st.derived ? st.derived.slope : slopeOf(h, N, 1);
    const b = gaussBlur(h, N, P(p, 'radius', 6));
    const amt = P(p, 'amount', 0.3);
    return h.map((v, i) => { const low = clamp01(1 - sl[i] * 3) * clamp01((b[i] - v) * 20 + 0.5); return v + (b[i] - v) * low * amt + low * 0.01 * amt; });
  },
  // 72 Outcrop: resistant rock protrusions on high ground.
  72: (h, N, p) => {
    const sd = P(p, 'seed', 3), th = P(p, 'threshold', 0.55), amt = P(p, 'amount', 0.12);
    return h.map((v, i) => {
      const x = (i % N) / N, y = ((i / N) | 0) / N;
      const n = 1 - Math.abs(fbm(perlin, x * 10, y * 10, sd, 4));
      const m = clamp01((v - th) * 4);
      return v + amt * clamp01((n - 0.6) * 3) * m;
    });
  },
  // 73 Fault: vertical displacement across a line.
  73: (h, N, p) => {
    const a = (P(p, 'angle', 30) * Math.PI) / 180, off = P(p, 'offset', 0), throwAmt = P(p, 'throw', 0.12), w = P(p, 'softness', 0.02);
    const c = Math.cos(a), s = Math.sin(a);
    return h.map((v, i) => {
      const x = (i % N) / N - 0.5, y = ((i / N) | 0) / N - 0.5;
      const d = x * -s + y * c - off;
      return v + throwAmt * smoothstep(-w, w, d) - throwAmt * 0.5;
    });
  },
  // 74 Fold: sinusoidal anticline/syncline bands.
  74: (h, N, p) => {
    const amp = P(p, 'amplitude', 0.08), f = P(p, 'frequency', 3), a = (P(p, 'angle', 0) * Math.PI) / 180;
    const c = Math.cos(a), s = Math.sin(a);
    return h.map((v, i) => {
      const x = (i % N) / N - 0.5, y = ((i / N) | 0) / N - 0.5;
      const d = x * c + y * s;
      return v + amp * Math.sin(d * f * Math.PI * 2) * clamp01(1 - Math.hypot(x, y) * 0.8);
    });
  },
  // 75 Tectonic: uplift along plate boundaries (Voronoi cell edges) plus fractured ridged noise.
  75: (h, N, p) => {
    const amp = P(p, 'amount', 0.15), sc = P(p, 'scale', 4), sd = P(p, 'seed', 7), w = P(p, 'width', 0.05);
    return h.map((v, i) => {
      const x = ((i % N) / N) * sc, y = (((i / N) | 0) / N) * sc;
      const d = voronoiDists(x, y, sd, 1).d;
      const edge = clamp01(1 - (d[1] - d[0]) / w);
      return v + amp * edge * (0.6 + 0.4 * Math.abs(perlin(x * 2, y * 2, sd)));
    });
  },
  // 76 Uplift: broad regional rise.
  76: (h, N, p) => { const amt = P(p, 'amount', 0.15), r = P(p, 'radius', 0.5), cx = P(p, 'centerX', 0.5), cy = P(p, 'centerY', 0.5); return h.map((v, i) => v + amt * cosBump(Math.hypot((i % N) / N - cx, ((i / N) | 0) / N - cy), r)); },
  // 77 Subsidence: regional basin.
  77: (h, N, p) => { const amt = P(p, 'amount', 0.15), r = P(p, 'radius', 0.5), cx = P(p, 'centerX', 0.5), cy = P(p, 'centerY', 0.5); return h.map((v, i) => v - amt * cosBump(Math.hypot((i % N) / N - cx, ((i / N) | 0) / N - cy), r)); },
  // 78 Graben: down-dropped rift between two parallel faults.
  78: (h, N, p) => { const amt = P(p, 'amount', 0.12), w = P(p, 'width', 0.12), a = (P(p, 'angle', 0) * Math.PI) / 180; const c = Math.cos(a), s = Math.sin(a); return h.map((v, i) => { const x = (i % N) / N - 0.5, y = ((i / N) | 0) / N - 0.5; const d = Math.abs(-x * s + y * c); return v - amt * (1 - smoothstep(w * 0.8, w, d)); }); },
  // 79 Horst: up-thrown block between faults.
  79: (h, N, p) => { const amt = P(p, 'amount', 0.12), w = P(p, 'width', 0.12), a = (P(p, 'angle', 0) * Math.PI) / 180; const c = Math.cos(a), s = Math.sin(a); return h.map((v, i) => { const x = (i % N) / N - 0.5, y = ((i / N) | 0) / N - 0.5; const d = Math.abs(-x * s + y * c); return v + amt * (1 - smoothstep(w * 0.8, w, d)); }); },
  // 80 Volcanic: cone with summit crater and radial lava lobes.
  80: (h, N, p) => {
    const cx = P(p, 'centerX', 0.5), cy = P(p, 'centerY', 0.5), R = P(p, 'radius', 0.35), H = P(p, 'height', 0.45), sd = P(p, 'seed', 2);
    return h.map((v, i) => {
      const x = (i % N) / N, y = ((i / N) | 0) / N; const dx = x - cx, dy = y - cy; const d = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);
      const lobe = 1 + 0.12 * perlin(a * 2, d * 4, sd);
      const cone = clamp01(1 - (d * lobe) / R) ** 1.6;
      const crater = smoothstep(0, R * 0.18, d);
      return Math.max(v, cone * H * (0.5 + 0.5 * crater) + v * 0.6);
    });
  },
  // 81 Lava flow: deposits along the steepest-descent path from the highest point.
  81: (h, N, p) => {
    const filled = fillDepressions(h, N); const recv = d8Receivers(filled, N);
    let top = 0; for (let i = 1; i < h.length; i++) if (h[i] > h[top]) top = i;
    const thick = P(p, 'thickness', 0.02), len = P(p, 'length', 500);
    const out = Float32Array.from(h); let cur = top;
    for (let k = 0; k < len && recv[cur] !== cur; k++) {
      const r = recv[cur];
      out[cur] += thick * (1 - k / len);
      cur = r;
    }
    return boxBlur(out, N, 1);
  },
  // 82 Impact: large crater with raised rim and central peak.
  82: (h, N, p) => {
    const cx = P(p, 'centerX', 0.5), cy = P(p, 'centerY', 0.5), R = P(p, 'radius', 0.2), depth = P(p, 'depth', 0.12);
    return h.map((v, i) => {
      const x = (i % N) / N, y = ((i / N) | 0) / N; const d = Math.hypot(x - cx, y - cy) / R;
      const bowl = d < 1 ? -depth * (1 - d * d) : 0;
      const rim = d >= 1 && d < 1.35 ? depth * 0.5 * (1 - (d - 1) / 0.35) ** 2 : 0;
      const peak = d < 0.25 ? depth * 0.35 * (1 - d / 0.25) : 0;
      return v + bowl + rim + peak;
    });
  },
  // 83 Meteor: many small impact pits scattered by hash.
  83: (h, N, p) => {
    const count = Math.round(P(p, 'count', 25)), R = P(p, 'radius', 0.03), depth = P(p, 'depth', 0.04), sd = P(p, 'seed', 11);
    const out = Float32Array.from(h);
    for (let k = 0; k < count; k++) {
      const cx = hash2(k, 1, sd), cy = hash2(k, 2, sd), r = R * (0.5 + hash2(k, 3, sd));
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const d = Math.hypot(x / N - cx, y / N - cy) / r;
        if (d < 1.3) out[y * N + x] += depth * (d < 1 ? -(1 - d * d) : 0.3 * (1.3 - d) * -1) * 0.6;
      }
    }
    return out;
  },
  // 84 Mineral: thin ridged vein lines (also written to a mineral map).
  84: (h, N, p, st) => {
    const sd = P(p, 'seed', 5), amt = P(p, 'amount', 0.03), sc = P(p, 'scale', 6);
    const mineral = new Float32Array(h.length);
    const out = h.map((v, i) => {
      const x = ((i % N) / N) * sc, y = (((i / N) | 0) / N) * sc;
      const vein = clamp01(1 - Math.abs(perlin(x, y, sd)) * 14);
      mineral[i] = vein;
      return v + amt * vein;
    });
    if (st) st.maps.mineral = mineral;
    return out;
  },
};
