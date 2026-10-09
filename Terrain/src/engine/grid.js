// Grid utilities shared by every layer. Heightfields are square Float32Array(N*N), row-major, index = y*N + x.
// Height values are unit-normalised in [0, 1]; world scale (metres) is applied by the caller through `cfg`.

export const clamp = (v, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0 || 1e-9));
  return t * t * (3 - 2 * t);
};

export function newGrid(N, value = 0) {
  const g = new Float32Array(N * N);
  if (value !== 0) g.fill(value);
  return g;
}

export function cloneGrid(a) {
  return new Float32Array(a);
}

export function minMax(a) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < a.length; i++) {
    const v = a[i];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return { min: lo, max: hi };
}

export function normalizeGrid(a) {
  const { min, max } = minMax(a);
  const out = new Float32Array(a.length);
  const r = max - min;
  if (r < 1e-9) return out;
  for (let i = 0; i < a.length; i++) out[i] = (a[i] - min) / r;
  return out;
}

export function mean(a) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i];
  return s / a.length;
}

export function percentile(a, p) {
  // Histogram-based percentile is fast and good enough for thresholds.
  const bins = 512;
  const { min, max } = minMax(a);
  const r = max - min || 1;
  const hist = new Uint32Array(bins);
  for (let i = 0; i < a.length; i++) hist[Math.min(bins - 1, Math.floor(((a[i] - min) / r) * bins))]++;
  const target = p * a.length;
  let acc = 0;
  for (let b = 0; b < bins; b++) {
    acc += hist[b];
    if (acc >= target) return min + ((b + 0.5) / bins) * r;
  }
  return max;
}

// Separable box blur with clamped edges. Radius in cells.
export function blurBox(src, N, r) {
  if (r < 1) return new Float32Array(src);
  const tmp = new Float32Array(N * N), out = new Float32Array(N * N);
  const inv = 1 / (2 * r + 1);
  for (let y = 0; y < N; y++) {
    const row = y * N;
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += src[row + Math.min(N - 1, Math.max(0, k))];
    for (let x = 0; x < N; x++) {
      tmp[row + x] = acc * inv;
      acc += src[row + Math.min(N - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < N; x++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += tmp[Math.min(N - 1, Math.max(0, k)) * N + x];
    for (let y = 0; y < N; y++) {
      out[y * N + x] = acc * inv;
      acc += tmp[Math.min(N - 1, y + r + 1) * N + x] - tmp[Math.max(0, y - r) * N + x];
    }
  }
  return out;
}

// Gaussian approximated by three box passes (variance-matched).
export function blurGauss(src, N, sigma) {
  if (sigma < 0.5) return new Float32Array(src);
  const r = Math.max(1, Math.round(Math.sqrt((12 * sigma * sigma) / 3 + 1) / 2 - 0.5));
  let g = blurBox(src, N, r);
  g = blurBox(g, N, r);
  return blurBox(g, N, r);
}

// Per-cell slope in degrees. `cellSize` [m], `vertScale` [m] per unit height.
export function slopeDegrees(H, N, cellSize, vertScale) {
  const out = new Float32Array(N * N);
  const k = vertScale / (2 * cellSize);
  for (let y = 0; y < N; y++) {
    const ym = Math.max(0, y - 1), yp = Math.min(N - 1, y + 1);
    for (let x = 0; x < N; x++) {
      const xm = Math.max(0, x - 1), xp = Math.min(N - 1, x + 1);
      const dx = (H[y * N + xp] - H[y * N + xm]) * k;
      const dy = (H[yp * N + x] - H[ym * N + x]) * k;
      out[y * N + x] = (Math.atan(Math.hypot(dx, dy)) * 180) / Math.PI;
    }
  }
  return out;
}

// Gradient components in unit height per cell.
export function gradientXY(H, N) {
  const gx = new Float32Array(N * N), gy = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    const ym = Math.max(0, y - 1), yp = Math.min(N - 1, y + 1);
    for (let x = 0; x < N; x++) {
      const xm = Math.max(0, x - 1), xp = Math.min(N - 1, x + 1);
      gx[y * N + x] = (H[y * N + xp] - H[y * N + xm]) * 0.5;
      gy[y * N + x] = (H[yp * N + x] - H[ym * N + x]) * 0.5;
    }
  }
  return { gx, gy };
}

// 5-point Laplacian. Positive values mean the cell sits below its neighbours (concave).
export function laplacian(H, N) {
  const out = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    const ym = Math.max(0, y - 1), yp = Math.min(N - 1, y + 1);
    for (let x = 0; x < N; x++) {
      const xm = Math.max(0, x - 1), xp = Math.min(N - 1, x + 1);
      const c = H[y * N + x];
      out[y * N + x] = H[y * N + xm] + H[y * N + xp] + H[ym * N + x] + H[yp * N + x] - 4 * c;
    }
  }
  return out;
}

export function sampleBilinear(H, N, x, y) {
  const fx = clamp(x, 0, N - 1), fy = clamp(y, 0, N - 1);
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const x1 = Math.min(N - 1, x0 + 1), y1 = Math.min(N - 1, y0 + 1);
  const tx = fx - x0, ty = fy - y0;
  const a = H[y0 * N + x0], b = H[y0 * N + x1], c = H[y1 * N + x0], d = H[y1 * N + x1];
  return lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
}

// Chamfer-free BFS distance (in cells, 8-connected) from the mask cells, capped at `cap`.
export function distanceFromMask(mask, N, cap = 1e9) {
  const dist = new Float32Array(N * N).fill(cap);
  const queue = new Int32Array(N * N);
  let head = 0, tail = 0;
  for (let i = 0; i < N * N; i++) if (mask[i] > 0.5) { dist[i] = 0; queue[tail++] = i; }
  while (head < tail) {
    const i = queue[head++];
    const d = dist[i] + 1;
    if (d > cap) continue;
    const x = i % N, y = (i / N) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const j = ny * N + nx;
        if (d < dist[j]) { dist[j] = d; queue[tail++] = j; }
      }
    }
  }
  return dist;
}

// Separable max / min filter (morphological dilate and erode).
export function morphFilter(src, N, r, useMax) {
  const pick = useMax ? Math.max : Math.min;
  const tmp = new Float32Array(N * N), out = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let v = useMax ? -Infinity : Infinity;
    for (let k = -r; k <= r; k++) v = pick(v, src[y * N + Math.min(N - 1, Math.max(0, x + k))]);
    tmp[y * N + x] = v;
  }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let v = useMax ? -Infinity : Infinity;
    for (let k = -r; k <= r; k++) v = pick(v, tmp[Math.min(N - 1, Math.max(0, y + k)) * N + x]);
    out[y * N + x] = v;
  }
  return out;
}

// Blend two grids with a weight grid or scalar.
export function mixGrid(a, b, w) {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) {
    const t = typeof w === 'number' ? w : w[i];
    out[i] = a[i] + (b[i] - a[i]) * t;
  }
  return out;
}

// Standard deviation over a square window (local roughness).
export function localStdDev(H, N, r) {
  const m1 = blurBox(H, N, r);
  const sq = new Float32Array(N * N);
  for (let i = 0; i < H.length; i++) sq[i] = H[i] * H[i];
  const m2 = blurBox(sq, N, r);
  const out = new Float32Array(N * N);
  for (let i = 0; i < out.length; i++) out[i] = Math.sqrt(Math.max(0, m2[i] - m1[i] * m1[i]));
  return out;
}

// Normalised 0..1 copy of a non-negative grid by its own maximum (or a given reference).
export function scaleToMax(a, ref) {
  const out = new Float32Array(a.length);
  const m = ref ?? minMax(a).max;
  if (m <= 1e-12) return out;
  for (let i = 0; i < a.length; i++) out[i] = clamp(a[i] / m);
  return out;
}
