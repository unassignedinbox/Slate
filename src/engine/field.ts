// Heightfield container and the shared raster operations Slate builds on:
// separable blurs, resampling, gradients, curvature, and D8 hydrology.

export class Field {
  readonly size: number;
  readonly data: Float32Array;
  version = 0;

  constructor(size: number, data?: Float32Array) {
    this.size = size;
    this.data = data ?? new Float32Array(size * size);
  }

  static zeros(size: number): Field {
    return new Field(size, new Float32Array(size * size));
  }

  get length(): number {
    return this.data.length;
  }

  get(x: number, y: number): number {
    const s = this.size;
    if (x < 0) x = 0;
    else if (x >= s) x = s - 1;
    if (y < 0) y = 0;
    else if (y >= s) y = s - 1;
    return this.data[y * s + x];
  }

  set(x: number, y: number, v: number): void {
    this.data[y * this.size + x] = v;
  }

  at(i: number): number {
    return this.data[i];
  }

  /** Bilinear sample in grid space. */
  sample(x: number, y: number): number {
    const s = this.size;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const xa = clampInt(x0, s - 1);
    const xb = clampInt(x0 + 1, s - 1);
    const ya = clampInt(y0, s - 1);
    const yb = clampInt(y0 + 1, s - 1);
    const v00 = this.data[ya * s + xa];
    const v10 = this.data[ya * s + xb];
    const v01 = this.data[yb * s + xa];
    const v11 = this.data[yb * s + xb];
    const a = v00 + (v10 - v00) * fx;
    const b = v01 + (v11 - v01) * fx;
    return a + (b - a) * fy;
  }

  clone(): Field {
    return new Field(this.size, new Float32Array(this.data));
  }

  fill(v: number): this {
    this.data.fill(v);
    return this;
  }

  min(): number {
    let m = Infinity;
    const d = this.data;
    for (let i = 0; i < d.length; i++) if (d[i] < m) m = d[i];
    return m;
  }

  max(): number {
    let m = -Infinity;
    const d = this.data;
    for (let i = 0; i < d.length; i++) if (d[i] > m) m = d[i];
    return m;
  }

  range(): [number, number] {
    return [this.min(), this.max()];
  }

  /** Normalise in place to 0..1 (flat fields become 0). */
  normalize(lo?: number, hi?: number): this {
    const [a, b] = lo === undefined || hi === undefined ? this.range() : [lo, hi];
    const span = b - a;
    const d = this.data;
    if (span <= 1e-9) {
      d.fill(0);
      return this;
    }
    const inv = 1 / span;
    for (let i = 0; i < d.length; i++) d[i] = (d[i] - a) * inv;
    return this;
  }

  /**
   * Percentile stretch to 0..1. Raw fractal noise clusters around its mean,
   * so generators use this to claim the full height range instead of living
   * in a narrow band in the middle.
   */
  stretch(loPct = 1, hiPct = 99): this {
    const samples: number[] = [];
    const stride = Math.max(1, Math.floor(this.data.length / 40000));
    for (let i = 0; i < this.data.length; i += stride) samples.push(this.data[i]);
    samples.sort((a, b) => a - b);
    const last = samples.length - 1;
    const lo = samples[Math.max(0, Math.floor(last * (loPct / 100)))];
    const hi = samples[Math.min(last, Math.ceil(last * (hiPct / 100)))];
    const span = Math.max(1e-6, hi - lo);
    const d = this.data;
    for (let i = 0; i < d.length; i++) d[i] = clamp01((d[i] - lo) / span);
    return this;
  }

  clamp(lo: number, hi: number): this {
    const d = this.data;
    for (let i = 0; i < d.length; i++) {
      const v = d[i];
      d[i] = v < lo ? lo : v > hi ? hi : v;
    }
    return this;
  }

  addScalar(v: number): this {
    const d = this.data;
    for (let i = 0; i < d.length; i++) d[i] += v;
    return this;
  }

  scale(v: number): this {
    const d = this.data;
    for (let i = 0; i < d.length; i++) d[i] *= v;
    return this;
  }

  copyFrom(other: Field): this {
    this.data.set(other.data);
    return this;
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function clampInt(v: number, max: number): number {
  return v < 0 ? 0 : v > max ? max : v;
}

/** Separable box blur, `radius` in cells. Runs in O(n). */
export function boxBlur(src: Field, radius: number, passes = 2): Field {
  const n = src.size;
  if (radius < 1) return src.clone();
  let a = new Float32Array(src.data);
  let b = new Float32Array(src.data.length);
  const width = radius * 2 + 1;
  for (let p = 0; p < passes; p++) {
    // Horizontal
    for (let y = 0; y < n; y++) {
      const row = y * n;
      let sum = 0;
      for (let k = -radius; k <= radius; k++) sum += a[row + clampInt(k, n - 1)];
      for (let x = 0; x < n; x++) {
        b[row + x] = sum / width;
        const out = a[row + clampInt(x - radius, n - 1)];
        const inn = a[row + clampInt(x + radius + 1, n - 1)];
        sum += inn - out;
      }
    }
    // Vertical
    for (let x = 0; x < n; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) sum += b[clampInt(k, n - 1) * n + x];
      for (let y = 0; y < n; y++) {
        a[y * n + x] = sum / width;
        const out = b[clampInt(y - radius, n - 1) * n + x];
        const inn = b[clampInt(y + radius + 1, n - 1) * n + x];
        sum += inn - out;
      }
    }
  }
  return new Field(n, a);
}

/** Gaussian-ish blur: three box passes approximate a true Gaussian well. */
export function blur(src: Field, radius: number): Field {
  return boxBlur(src, Math.max(1, Math.round(radius)), 3);
}

/** Downsample to a square thumbnail of `out` cells (box filtered). */
export function downsample(src: Field, out: number): Float32Array {
  const n = src.size;
  const result = new Float32Array(out * out);
  if (n === out) {
    result.set(src.data);
    return result;
  }
  const step = n / out;
  const radius = Math.max(1, Math.floor(step / 2));
  for (let y = 0; y < out; y++) {
    const cy = Math.min(n - 1, Math.floor((y + 0.5) * step));
    for (let x = 0; x < out; x++) {
      const cx = Math.min(n - 1, Math.floor((x + 0.5) * step));
      let sum = 0;
      let count = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        const yy = clampInt(cy + dy, n - 1);
        for (let dx = -radius; dx <= radius; dx++) {
          const xx = clampInt(cx + dx, n - 1);
          sum += src.data[yy * n + xx];
          count++;
        }
      }
      result[y * out + x] = sum / count;
    }
  }
  return result;
}

/** Bilinear resample to a new resolution (used for thumbnail previews). */
export function resample(src: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return new Float32Array(src);
  const out = new Float32Array(to * to);
  const scale = from / to;
  for (let y = 0; y < to; y++) {
    const sy = Math.min(from - 1.001, (y + 0.5) * scale - 0.5);
    const y0 = Math.floor(sy);
    const fy = sy - y0;
    const y1 = Math.min(from - 1, y0 + 1);
    for (let x = 0; x < to; x++) {
      const sx = Math.min(from - 1.001, (x + 0.5) * scale - 0.5);
      const x0 = Math.floor(sx);
      const fx = sx - x0;
      const x1 = Math.min(from - 1, x0 + 1);
      const v00 = src[y0 * from + x0];
      const v10 = src[y0 * from + x1];
      const v01 = src[y1 * from + x0];
      const v11 = src[y1 * from + x1];
      const a = v00 + (v10 - v00) * fx;
      const b = v01 + (v11 - v01) * fx;
      out[y * to + x] = a + (b - a) * fy;
    }
  }
  return out;
}

/**
 * Local prominence: how much a cell stands above its surroundings.
 * This is the "protrusion" channel — it separates summits and spur crests from
 * valley floors far better than raw height does.
 */
export function protrusion(height: Field, radius: number): Field {
  const smoothed = blur(height, radius);
  const out = Field.zeros(height.size);
  const d = out.data;
  const h = height.data;
  const s = smoothed.data;
  for (let i = 0; i < d.length; i++) d[i] = h[i] - s[i];
  return out;
}

/** Terrain ruggedness: mean absolute deviation from the local mean. */
export function roughness(height: Field, radius: number): Field {
  const mean = blur(height, radius);
  const diff = Field.zeros(height.size);
  const d = diff.data;
  for (let i = 0; i < d.length; i++) {
    const v = height.data[i] - mean.data[i];
    d[i] = v < 0 ? -v : v;
  }
  const smoothed = blur(diff, radius);
  return smoothed;
}

/** Multi-scale cavity / ambient-occlusion proxy (cheap, no ray marching). */
export function cavityMap(height: Field, relief: number): Field {
  const n = height.size;
  const out = Field.zeros(n);
  const scales = [
    { r: Math.max(1, Math.round(n / 128)), w: 0.5 },
    { r: Math.max(2, Math.round(n / 48)), w: 0.32 },
    { r: Math.max(3, Math.round(n / 16)), w: 0.18 },
  ];
  for (const s of scales) {
    const b = blur(height, s.r);
    const d = b.data;
    for (let i = 0; i < out.data.length; i++) {
      out.data[i] += ((height.data[i] - d[i]) / Math.max(1e-4, relief * 0.16)) * s.w;
    }
  }
  const d = out.data;
  for (let i = 0; i < d.length; i++) d[i] = 1 / (1 + Math.exp(-(d[i] * 2.2 - 0.15)));
  return out;
}

/** Slope in radians (central differences), honouring cell size in metres. */
export function slopeMap(height: Field, cellSize: number, verticalScale: number): Field {
  const n = height.size;
  const out = Field.zeros(n);
  const h = height.data;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const xl = h[y * n + (x > 0 ? x - 1 : x)];
      const xr = h[y * n + (x < n - 1 ? x + 1 : x)];
      const yu = h[(y > 0 ? y - 1 : y) * n + x];
      const yd = h[(y < n - 1 ? y + 1 : y) * n + x];
      const dx = ((xr - xl) * verticalScale) / (2 * cellSize);
      const dy = ((yd - yu) * verticalScale) / (2 * cellSize);
      out.data[i] = Math.atan(Math.sqrt(dx * dx + dy * dy));
    }
  }
  return out;
}

/** Downhill aspect in radians, 0 = north, increasing clockwise. */
export function aspectMap(height: Field): Field {
  const n = height.size;
  const out = Field.zeros(n);
  const h = height.data;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const xl = h[y * n + (x > 0 ? x - 1 : x)];
      const xr = h[y * n + (x < n - 1 ? x + 1 : x)];
      const yu = h[(y > 0 ? y - 1 : y) * n + x];
      const yd = h[(y < n - 1 ? y + 1 : y) * n + x];
      const dx = xr - xl;
      const dy = -(yd - yu);
      let a = Math.atan2(dx, -dy);
      if (a < 0) a += Math.PI * 2;
      out.data[i] = a;
    }
  }
  return out;
}

/** Mean curvature (positive = convex crest, negative = concave hollow). */
export function curvatureMap(height: Field): Field {
  const n = height.size;
  const out = Field.zeros(n);
  const h = height.data;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const c = h[i];
      const xl = h[y * n + (x > 0 ? x - 1 : x)];
      const xr = h[y * n + (x < n - 1 ? x + 1 : x)];
      const yu = h[(y > 0 ? y - 1 : y) * n + x];
      const yd = h[(y < n - 1 ? y + 1 : y) * n + x];
      out.data[i] = (xl + xr + yu + yd) * 0.25 - c;
    }
  }
  return out;
}

/** Reusable scratch for the radix sort — the fluvial pass sorts every
 *  iteration, so allocating a megabyte each time shows up in the profile. */
let sortScratch: Uint32Array = new Uint32Array(0);
let sortScratchKey: Uint32Array = new Uint32Array(0);
let sortKey: Uint32Array = new Uint32Array(0);
const radixCount = new Uint32Array(1 << 16);

/** LSD radix sort of 32-bit float heights (fast enough to run every iteration). */
export function sortIndicesDesc(keys: Float32Array, into: Uint32Array): Uint32Array {
  const n = keys.length;
  if (into.length !== n) into = new Uint32Array(n);
  if (sortKey.length < n) {
    sortKey = new Uint32Array(n);
    sortScratch = new Uint32Array(n);
    sortScratchKey = new Uint32Array(n);
  }
  const tmpKey = sortKey;
  const scratch = sortScratch;
  const scratchKey = sortScratchKey;
  // Bias the IEEE bit pattern so the ordering matches signed float ordering.
  for (let i = 0; i < n; i++) {
    const bits = f32ToU32(keys[i]);
    tmpKey[i] = (bits & 0x80000000) === 0 ? bits ^ 0x80000000 : ~bits;
  }
  for (let i = 0; i < n; i++) into[i] = i;
  const BITS = 16;
  const BUCKETS = 1 << BITS;
  const count = radixCount;
  for (let shift = 0; shift < 32; shift += BITS) {
    count.fill(0);
    for (let i = 0; i < n; i++) count[(tmpKey[i] >>> shift) & 0xffff]++;
    let sum = 0;
    for (let b = 0; b < BUCKETS; b++) {
      const c = count[b];
      count[b] = sum;
      sum += c;
    }
    for (let i = 0; i < n; i++) {
      const k = (tmpKey[i] >>> shift) & 0xffff;
      const dst = count[k]++;
      scratchKey[dst] = tmpKey[i];
      scratch[dst] = into[i];
    }
    into.set(scratch);
    tmpKey.set(scratchKey);
  }
  // Descending
  for (let i = 0, j = n - 1; i < j; i++, j--) {
    const t = into[i];
    into[i] = into[j];
    into[j] = t;
  }
  return into;
}

const u32 = new Uint32Array(1);
const f32 = new Float32Array(u32.buffer);
function f32ToU32(v: number): number {
  f32[0] = v;
  return u32[0];
}

export const D8_DX = [1, 1, 0, -1, -1, -1, 0, 1];
export const D8_DY = [0, 1, 1, 1, 0, -1, -1, -1];
export const D8_DIST = [1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2];

let receiverScratch: Int32Array = new Int32Array(0);

/**
 * D8 flow accumulation. Cells are visited highest-first so a single pass
 * propagates the full upstream area. Returns raw contributing cell counts.
 */
export function flowAccumulation(height: Field, order?: Uint32Array): Float32Array {
  const n = height.size;
  const h = height.data;
  const count = n * n;
  const orderIdx = sortIndicesDesc(h, order ?? new Uint32Array(count));
  if (receiverScratch.length < count) receiverScratch = new Int32Array(count);
  const receiver = receiverScratch;
  receiver.fill(-1, 0, count);
  for (let k = 0; k < count; k++) {
    const i = orderIdx[k];
    const x = i % n;
    const y = (i / n) | 0;
    let best = -1;
    let bestDrop = 0;
    const hi = h[i];
    for (let d = 0; d < 8; d++) {
      const nx = x + D8_DX[d];
      const ny = y + D8_DY[d];
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      const j = ny * n + nx;
      const drop = (hi - h[j]) / D8_DIST[d];
      if (drop > bestDrop) {
        bestDrop = drop;
        best = j;
      }
    }
    receiver[i] = best;
  }
  const acc = new Float32Array(count).fill(1);
  for (let k = count - 1; k >= 0; k--) {
    const i = orderIdx[k];
    const r = receiver[i];
    if (r >= 0) acc[r] += acc[i];
  }
  return acc;
}

/** Binary min-heap keyed by float priority. */
class MinHeap {
  private keys: Float64Array;
  private vals: Uint32Array;
  private count = 0;

  constructor(capacity: number) {
    this.keys = new Float64Array(capacity);
    this.vals = new Uint32Array(capacity);
  }

  get size(): number {
    return this.count;
  }

  push(key: number, val: number): void {
    if (this.count === this.keys.length) this.grow();
    let i = this.count++;
    this.keys[i] = key;
    this.vals[i] = val;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent] <= this.keys[i]) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): number {
    const val = this.vals[0];
    this.count--;
    if (this.count > 0) {
      this.keys[0] = this.keys[this.count];
      this.vals[0] = this.vals[this.count];
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.count && this.keys[l] < this.keys[m]) m = l;
        if (r < this.count && this.keys[r] < this.keys[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return val;
  }

  private swap(a: number, b: number): void {
    const k = this.keys[a];
    this.keys[a] = this.keys[b];
    this.keys[b] = k;
    const v = this.vals[a];
    this.vals[a] = this.vals[b];
    this.vals[b] = v;
  }

  private grow(): void {
    const keys = new Float64Array(this.keys.length * 2);
    const vals = new Uint32Array(this.vals.length * 2);
    keys.set(this.keys);
    vals.set(this.vals);
    this.keys = keys;
    this.vals = vals;
  }
}

/**
 * Priority-flood depression fill (Barnes et al.) — makes flow routing
 * hydrologically sane before river networks are extracted.
 */
export function fillSinks(height: Field, epsilon = 1e-5): Field {
  const n = height.size;
  const src = height.data;
  const data = new Float32Array(src);
  const total = n * n;
  const visited = new Uint8Array(total);
  const heap = new MinHeap(total);
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) {
      if (x === 0 || y === 0 || x === n - 1 || y === n - 1) {
        const i = y * n + x;
        visited[i] = 1;
        heap.push(data[i], i);
      }
    }
  }
  while (heap.size > 0) {
    const i = heap.pop();
    const x = i % n;
    const y = (i / n) | 0;
    const hi = data[i];
    for (let d = 0; d < 8; d++) {
      const nx = x + D8_DX[d];
      const ny = y + D8_DY[d];
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      const j = ny * n + nx;
      if (visited[j]) continue;
      visited[j] = 1;
      const floorLevel = hi + epsilon * D8_DIST[d];
      if (data[j] < floorLevel) data[j] = floorLevel;
      heap.push(data[j], j);
    }
  }
  return new Field(n, data);
}
