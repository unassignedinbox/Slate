// GPU inverse-FFT "butterfly" tables (zero dependencies, unit-testable).
//
// We implement an out-of-place decimation-in-time (DIT) FFT where each stage is
// a fullscreen pass:  y[o] = x[a] + W' * x[b]   (complex arithmetic)
// with (a, b, W') precomputed per output index `o` and stage. This follows the
// classic out-of-place formulation (cf. Keith Lantz's ocean FFT walkthrough).
// The time-evolved spectrum pass writes its output in bit-reversed order, so no
// separate permutation pass is needed. Each 1D pass scales by 1/N.

export function bitReverse(v, bits) {
  let r = 0;
  for (let i = 0; i < bits; i++) { r = (r << 1) | (v & 1); v >>= 1; }
  return r;
}

export function isPowerOfTwo(n) { return n > 0 && (n & (n - 1)) === 0; }

// Precompute butterfly texture data for an N-point INVERSE FFT.
// Returns { data: Float32Array(N*stages*4), stages } laid out as [x=output, y=stage]
// RGBA = (W'.re, W'.im, a, b).
export function precomputeButterfly(N) {
  if (!isPowerOfTwo(N)) throw new Error('FFT size must be a power of two');
  const stages = Math.log2(N);
  const data = new Float32Array(N * stages * 4);
  for (let s = 0; s < stages; s++) {
    const size = 1 << (s + 1);       // butterfly group size ("len")
    const half = size >> 1;
    for (let o = 0; o < N; o++) {
      const j = Math.floor(o / size);
      const k = o % size;
      const base = o * size; // group start (== j*size)
      let a, b, ang;
      if (k < half) {
        // y[o] = x[o] + W_len^k * x[o+half]
        a = o; b = o + half; ang = (2 * Math.PI * k) / size;
        setEntry(data, N, o, s, Math.cos(ang), Math.sin(ang), a, b);
      } else {
        // y[o] = x[o-half] - W_len^(k-half) * x[o]  => folded into + W' form
        const kk = k - half;
        a = o - half; b = o; ang = (2 * Math.PI * kk) / size;
        setEntry(data, N, o, s, -Math.cos(ang), -Math.sin(ang), a, b);
      }
      void j; void base;
    }
  }
  return { data, stages, size: N };
}

function setEntry(data, N, o, s, wr, wi, a, b) {
  const idx = (s * N + o) * 4;
  data[idx] = wr; data[idx + 1] = wi; data[idx + 2] = a; data[idx + 3] = b;
}

// ---- CPU reference implementations (used by unit tests) ----

// Apply one 1D inverse FFT along a strided row using the butterfly tables.
// `re`, `im` are Float64Arrays of length N (input must already be bit-reversed).
export function applyButterfly1D(re, im, N, butterfly) {
  const { data, stages } = butterfly;
  let srcR = Float64Array.from(re), srcI = Float64Array.from(im);
  let dstR = new Float64Array(N), dstI = new Float64Array(N);
  for (let s = 0; s < stages; s++) {
    for (let o = 0; o < N; o++) {
      const idx = (s * N + o) * 4;
      const wr = data[idx], wi = data[idx + 1];
      const a = data[idx + 2], b = data[idx + 3];
      const ar = srcR[a], ai = srcI[a], br = srcR[b], bi = srcI[b];
      // y = a + W' * b
      dstR[o] = ar + wr * br - wi * bi;
      dstI[o] = ai + wr * bi + wi * br;
    }
    [srcR, dstR] = [dstR, srcR];
    [srcI, dstI] = [dstI, srcI];
  }
  for (let o = 0; o < N; o++) { srcR[o] /= N; srcI[o] /= N; }
  return { re: srcR, im: srcI };
}

// Naive O(N^2) inverse DFT for validation: x[n] = (1/N) Σ_k X[k] e^{+2πikn/N}
export function naiveInverseDFT(re, im) {
  const N = re.length;
  const outR = new Float64Array(N), outI = new Float64Array(N);
  for (let n = 0; n < N; n++) {
    let sr = 0, si = 0;
    for (let k = 0; k < N; k++) {
      const ang = (2 * Math.PI * k * n) / N;
      const c = Math.cos(ang), s = Math.sin(ang);
      sr += re[k] * c - im[k] * s;
      si += re[k] * s + im[k] * c;
    }
    outR[n] = sr / N; outI[n] = si / N;
  }
  return { re: outR, im: outI };
}

// Naive 2D inverse DFT (row-column), natural order in/out.
export function naiveInverseDFT2D(re, im, N) {
  // rows
  const tR = new Float64Array(N * N), tI = new Float64Array(N * N);
  for (let y = 0; y < N; y++) {
    const rowR = new Float64Array(N), rowI = new Float64Array(N);
    for (let x = 0; x < N; x++) { rowR[x] = re[y * N + x]; rowI[x] = im[y * N + x]; }
    const { re: oR, im: oI } = naiveInverseDFT(rowR, rowI);
    for (let x = 0; x < N; x++) { tR[y * N + x] = oR[x]; tI[y * N + x] = oI[x]; }
  }
  // cols
  const oR = new Float64Array(N * N), oI = new Float64Array(N * N);
  for (let x = 0; x < N; x++) {
    const colR = new Float64Array(N), colI = new Float64Array(N);
    for (let y = 0; y < N; y++) { colR[y] = tR[y * N + x]; colI[y] = tI[y * N + x]; }
    const r = naiveInverseDFT(colR, colI);
    for (let y = 0; y < N; y++) { oR[y * N + x] = r.re[y]; oI[y * N + x] = r.im[y]; }
  }
  return { re: oR, im: oI };
}
