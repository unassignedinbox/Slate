// Gaea-style grayscale influence masks (153-178). Each returns Float32Array in [0,1].
// `st` is the live stack state; `derive(st)` supplies cached slope/curvature/flow/normal.
import { clamp01, smoothstep, clamp, boxBlur, normalize, make } from './grid.js';
import { derivedField } from './ops.js';
import { cacheFor } from './derived.js';

const map = (N, f) => { const o = new Float32Array(N * N); for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) o[y * N + x] = f(x, y, y * N + x); return o; };
const band = (v, lo, hi, soft) => clamp01(smoothstep(lo - soft, lo + soft, v) * (1 - smoothstep(hi - soft, hi + soft, v)));

export const MASKS = {
  153: (p, st, d) => map(st.N, (x, y, i) => smoothstep(p.min ?? 0.2, p.max ?? 0.7, d.slope[i])),
  154: (p, st, d) => map(st.N, (x, y, i) => band(st.h[i], p.min ?? 0.2, p.max ?? 0.8, p.feather ?? 0.05)),
  155: (p, st, d) => map(st.N, (x, y, i) => clamp01(Math.abs(d.curv[i] - 0.5) * 2)),
  156: (p, st, d) => map(st.N, (x, y, i) => clamp01((0.5 - d.curv[i]) * 2)),   // cavity
  157: (p, st, d) => map(st.N, (x, y, i) => clamp01((d.curv[i] - 0.5) * 2)),   // convexity
  158: (p, st, d) => map(st.N, (x, y, i) => smoothstep(p.min ?? 0.2, p.max ?? 0.9, d.flow[i])),
  159: (p, st, d) => map(st.N, (x, y, i) => (st.water && !Number.isNaN(st.water[i])) || st.h[i] < (st.seaLevel ?? -1) ? 1 : 0),
  160: (p, st, d) => map(st.N, (x, y, i) => smoothstep((p.line ?? 0.65) - 0.05, (p.line ?? 0.65) + 0.05, st.h[i]) * (1 - clamp01(d.slope[i] * (p.slopeCut ?? 1.5)))),
  161: (p, st, d) => { // shadow from sun direction (azimuth, altitude) using terrain normal
    const az = ((p.azimuth ?? 315) * Math.PI) / 180, alt = ((p.altitude ?? 35) * Math.PI) / 180;
    const sx = Math.cos(alt) * Math.cos(az), sy = Math.cos(alt) * Math.sin(az), sz = Math.sin(alt);
    return map(st.N, (x, y, i) => {
      const nx = -d.gx[i] * 20, ny = -d.gy[i] * 20; const l = Math.hypot(nx, ny, 1);
      const lit = Math.max(0, (nx * sx + ny * sy + sz) / l);
      return clamp01(1 - lit);
    });
  },
  162: (p, st, d) => { const r = Math.max(2, Math.round(p.radius ?? 8)); const m = boxBlur(st.h, st.N, r); return map(st.N, (x, y, i) => clamp01(0.5 + (m[i] - st.h[i]) * (p.strength ?? 6))); },
  163: (p, st, d) => { const a = ((p.angle ?? 0) * Math.PI) / 180, w = ((p.width ?? 90) * Math.PI) / 180; return map(st.N, (x, y, i) => { const asp = Math.atan2(d.gy[i], d.gx[i]); let diff = Math.atan2(Math.sin(asp - a), Math.cos(asp - a)); return clamp01(1 - Math.abs(diff) / (w / 2 + 1e-6)); }); },
  164: (p, st, d) => derivedField(127, st.h, st.N, { radius: p.radius ?? 2 }),
  165: (p, st, d) => { const s = Math.max(2, p.steps ?? 8), w = p.width ?? 0.15; return map(st.N, (x, y, i) => { const f = (st.h[i] * s) % 1; const dist = Math.min(f, 1 - f); return clamp01(1 - smoothstep(0, w, dist)); }); },
  166: (p, st, d) => map(st.N, (x, y, i) => smoothstep(p.min ?? 0.55, p.max ?? 0.85, d.slope[i])),
  167: (p, st, d) => { const r = boxBlur(st.h, st.N, 6); return map(st.N, (x, y, i) => clamp01((d.curv[i] - 0.5) * 3 * (st.h[i] > r[i] ? 1 : 0))); },
  168: (p, st, d) => { const r = boxBlur(st.h, st.N, 6); return map(st.N, (x, y, i) => clamp01((0.5 - d.curv[i]) * 3 * (st.h[i] < r[i] ? 1 : 0))); },
  169: (p, st, d) => { const w = Math.max(1, (p.width ?? 0.08) * st.N); return map(st.N, (x, y) => clamp01(1 - Math.min(x, y, st.N - 1 - x, st.N - 1 - y) / w)); },
  170: (p, st, d) => { const cx = (p.centerX ?? 0.5) * st.N, cy = (p.centerY ?? 0.5) * st.N, R = Math.max(1, (p.radius ?? 0.4) * st.N); return map(st.N, (x, y) => clamp01(1 - Math.hypot(x - cx, y - cy) / R)); },
  171: (p, st, d) => map(st.N, (x, y) => { const v = p.axis === 'y' ? y / st.N : x / st.N; return band(v, p.min ?? 0, p.max ?? 1, p.feather ?? 0.02); }),
  172: (p, st, d) => { const a = ((p.angle ?? 0) * Math.PI) / 180, w = ((p.width ?? 60) * Math.PI) / 180; return map(st.N, (x, y) => { const t = Math.atan2(y / st.N - 0.5, x / st.N - 0.5); let diff = Math.atan2(Math.sin(t - a), Math.cos(t - a)); return clamp01(1 - Math.abs(diff) / (w / 2 + 1e-6)); }); },
  173: (p, st, d) => { const src = p.source === 'slope' ? d.slope : p.source === 'flow' ? d.flow : p.source === 'curvature' ? d.curv : st.h; return map(st.N, (x, y, i) => band(src[i], p.min ?? 0.2, p.max ?? 0.8, p.feather ?? 0.02)); },
  174: (p, st, d) => { const a = ((p.angle ?? 0) * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a); return map(st.N, (x, y) => clamp01(0.5 + ((x / st.N - 0.5) * c + (y / st.N - 0.5) * s) * (p.extent ?? 1))); },
  175: (p, st, d) => { const cx = p.centerX ?? 0.5, cy = p.centerY ?? 0.5, R = p.radius ?? 0.5; return map(st.N, (x, y) => clamp01(1 - Math.hypot(x / st.N - cx, y / st.N - cy) / R)); },
  176: (p, st, d) => { const cx = p.centerX ?? 0.5, cy = p.centerY ?? 0.5, a0 = ((p.start ?? 0) * Math.PI) / 180, span = ((p.span ?? 90) * Math.PI) / 180; return map(st.N, (x, y) => { let t = Math.atan2(y / st.N - cy, x / st.N - cx) - a0; t = ((t % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI); return t <= span ? 1 : 0; }); },
  177: (p, st, d) => { // manual selection by criteria (combined thresholds)
    const hs = p.height ?? 0.5, ss = p.slope ?? 0.5;
    return map(st.N, (x, y, i) => (st.h[i] >= hs && d.slope[i] >= ss ? 1 : (st.h[i] >= hs || d.slope[i] >= ss ? 0.5 : 0)));
  },
  178: (p, st, d) => (p._painted ? Float32Array.from(p._painted) : make(st.N, 1)),
};
export const maskNames = {
  153: 'Slope', 154: 'Height', 155: 'Curvature', 156: 'Cavity', 157: 'Convexity', 158: 'Flow', 159: 'Water', 160: 'Snow',
  161: 'Shadow', 162: 'Ambient Occlusion', 163: 'Direction', 164: 'Roughness', 165: 'Terrace', 166: 'Cliff', 167: 'Ridge',
  168: 'Valley', 169: 'Edge', 170: 'Distance', 171: 'Position', 172: 'Angle', 173: 'Range', 174: 'Gradient', 175: 'Radial',
  176: 'Angular', 177: 'Select', 178: 'Custom Painted',
};
// Compute the derived field bundle used by masks, caching by terrain version.
export function deriveFor(st) { return cacheFor(st); }
export { normalize, clamp };
