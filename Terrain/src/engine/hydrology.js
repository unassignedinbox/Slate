// Hydrology core: depression filling (priority flood), D8 flow routing and flow accumulation.
// These are shared by river / lake / erosion layers and by the flow, moisture and water masks.

// Min-heap keyed by a Float32Array priority. Stores cell indices.
class CellHeap {
  constructor(capacity, key) {
    this.key = key;
    this.items = new Int32Array(capacity);
    this.size = 0;
  }
  push(i) {
    let k = this.size++;
    const items = this.items, key = this.key;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (key[items[p]] <= key[i]) break;
      items[k] = items[p];
      k = p;
    }
    items[k] = i;
  }
  pop() {
    const items = this.items, key = this.key;
    const top = items[0];
    const last = items[--this.size];
    let k = 0;
    while (true) {
      let c = 2 * k + 1;
      if (c >= this.size) break;
      if (c + 1 < this.size && key[items[c + 1]] < key[items[c]]) c++;
      if (key[items[c]] >= key[last]) break;
      items[k] = items[c];
      k = c;
    }
    if (this.size > 0) items[k] = last;
    return top;
  }
}

// Priority-flood (Barnes 2014): raises closed depressions to their spill level plus a tiny epsilon
// so that every interior cell drains. Borders are treated as outlets.
export function fillDepressions(H, N, eps = 1e-6) {
  const out = new Float32Array(H);
  const open = new Uint8Array(N * N);
  const heap = new CellHeap(N * N, out);
  const push = (i) => { open[i] = 1; heap.push(i); };
  for (let x = 0; x < N; x++) { push(x); push((N - 1) * N + x); }
  for (let y = 1; y < N - 1; y++) { push(y * N); push(y * N + N - 1); }
  while (heap.size > 0) {
    const i = heap.pop();
    const x = i % N, y = (i / N) | 0;
    const h = out[i];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const j = ny * N + nx;
        if (open[j]) continue;
        open[j] = 1;
        if (out[j] < h + eps) out[j] = h + eps;
        heap.push(j);
      }
    }
  }
  return out;
}

// D8 flow direction on a depression-free surface. Returns neighbour index or -1 for outlets.
const D8 = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const D8_DIST = [1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2];
export function flowDirections(F, N) {
  const dir = new Int32Array(N * N).fill(-1);
  const slope = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      let best = 0, bestK = -1;
      for (let k = 0; k < 8; k++) {
        const nx = x + D8[k][0], ny = y + D8[k][1];
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const s = (F[i] - F[ny * N + nx]) / D8_DIST[k];
        if (s > best) { best = s; bestK = k; }
      }
      if (bestK >= 0) dir[i] = (y + D8[bestK][1]) * N + (x + D8[bestK][0]);
      slope[i] = best;
    }
  }
  return { dir, slope };
}

// Flow accumulation: number of upstream cells that drain through each cell (including itself).
export function flowAccumulation(F, dir, N) {
  const order = new Int32Array(N * N);
  for (let i = 0; i < order.length; i++) order[i] = i;
  // Sort highest first so every donor is processed before its receiver.
  order.sort((a, b) => F[b] - F[a]);
  const acc = new Float32Array(N * N).fill(1);
  for (let k = 0; k < order.length; k++) {
    const i = order[k];
    const d = dir[i];
    if (d >= 0) acc[d] += acc[i];
  }
  return acc;
}

// Full hydrology bundle used by the context cache.
export function routeWater(H, N) {
  const F = fillDepressions(H, N);
  const { dir, slope } = flowDirections(F, N);
  const acc = flowAccumulation(F, dir, N);
  return { filled: F, dir, slope, acc };
}

// Follow the steepest descent from a start cell until an outlet, a pit or the step limit.
export function descentPath(dir, start, maxSteps) {
  const path = [];
  let i = start;
  for (let s = 0; s < maxSteps && i >= 0; s++) {
    path.push(i);
    const d = dir[i];
    if (d < 0 || d === i) break;
    i = d;
  }
  return path;
}

// Mark an arbitrary set of indices (e.g. river cells) with a value, as a Float32Array.
export function markCells(indices, N, value = 1) {
  const m = new Float32Array(N * N);
  for (const i of indices) m[i] = value;
  return m;
}
