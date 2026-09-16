// Validates the GPU butterfly tables against naive DFTs + Parseval + an
// end-to-end spectrum->height energy scaling check. Run: npm test
import assert from 'node:assert/strict';
import {
  bitReverse, precomputeButterfly, applyButterfly1D,
  naiveInverseDFT, naiveInverseDFT2D,
} from '../src/core/butterfly.js';
import { defaultSeaParams, wavenumberSpectrum } from '../src/ocean/spectra.js';

// deterministic PRNG
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- bit reversal ---
assert.equal(bitReverse(0b1101, 4), 0b1011);
assert.equal(bitReverse(1, 8), 128);
assert.equal(bitReverse(0, 8), 0);

// --- butterfly table shape ---
{
  const bf = precomputeButterfly(8);
  assert.equal(bf.stages, 3);
  assert.equal(bf.data.length, 8 * 3 * 4);
}

// --- 1D inverse FFT vs naive ---
for (const N of [8, 64, 256]) {
  const bf = precomputeButterfly(N);
  const rand = mulberry32(1234);
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N; i++) { re[i] = rand() * 2 - 1; im[i] = rand() * 2 - 1; }
  const bits = Math.log2(N);
  const brevR = new Float64Array(N), brevI = new Float64Array(N);
  for (let i = 0; i < N; i++) { brevR[bitReverse(i, bits)] = re[i]; brevI[bitReverse(i, bits)] = im[i]; }
  const got = applyButterfly1D(brevR, brevI, N, bf);
  const exp = naiveInverseDFT(re, im);
  let err = 0, ref = 0;
  for (let i = 0; i < N; i++) {
    err += (got.re[i] - exp.re[i]) ** 2 + (got.im[i] - exp.im[i]) ** 2;
    ref += exp.re[i] ** 2 + exp.im[i] ** 2;
  }
  const rel = Math.sqrt(err / ref);
  console.log(`1D N=${N}: rel err vs naive = ${rel.toExponential(2)}`);
  assert.ok(rel < 1e-4, `1D FFT mismatch at N=${N}`);
  // Parseval: sum|Y|^2 = sum|X|^2 / N for the 1/N-scaled IDFT
  let sY = 0, sX = 0;
  for (let i = 0; i < N; i++) {
    sY += got.re[i] ** 2 + got.im[i] ** 2;
    sX += re[i] ** 2 + im[i] ** 2;
  }
  assert.ok(Math.abs(sY - sX / N) / (sX / N) < 1e-6, 'Parseval violated');
}

// --- 2D inverse FFT vs naive (mirrors the GPU row->col flow) ---
{
  const N = 8;
  const bf = precomputeButterfly(N);
  const rand = mulberry32(777);
  const re = new Float64Array(N * N), im = new Float64Array(N * N);
  for (let i = 0; i < N * N; i++) { re[i] = rand() * 2 - 1; im[i] = rand() * 2 - 1; }
  const bits = Math.log2(N);
  const bR = new Float64Array(N * N), bI = new Float64Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++)
    { bR[bitReverse(y, bits) * N + bitReverse(x, bits)] = re[y * N + x]; bI[bitReverse(y, bits) * N + bitReverse(x, bits)] = im[y * N + x]; }
  // rows
  const tR = new Float64Array(N * N), tI = new Float64Array(N * N);
  for (let y = 0; y < N; y++) {
    const r = applyButterfly1D(bR.slice(y * N, y * N + N), bI.slice(y * N, y * N + N), N, bf);
    for (let x = 0; x < N; x++) { tR[y * N + x] = r.re[x]; tI[y * N + x] = r.im[x]; }
  }
  // cols
  const gR = new Float64Array(N * N), gI = new Float64Array(N * N);
  for (let x = 0; x < N; x++) {
    const cr = new Float64Array(N), ci = new Float64Array(N);
    for (let y = 0; y < N; y++) { cr[y] = tR[y * N + x]; ci[y] = tI[y * N + x]; }
    const r = applyButterfly1D(cr, ci, N, bf);
    for (let y = 0; y < N; y++) { gR[y * N + x] = r.re[y]; gI[y * N + x] = r.im[y]; }
  }
  const exp = naiveInverseDFT2D(re, im, N);
  let err = 0, ref = 0;
  for (let i = 0; i < N * N; i++) {
    err += (gR[i] - exp.re[i]) ** 2 + (gI[i] - exp.im[i]) ** 2;
    ref += exp.re[i] ** 2 + exp.im[i] ** 2;
  }
  const rel = Math.sqrt(err / ref);
  console.log(`2D N=${N}: rel err vs naive = ${rel.toExponential(2)}`);
  assert.ok(rel < 1e-5, '2D FFT mismatch');
}

// --- end-to-end: spectrum -> H(k,t) -> IFFT conserves energy ---
{
  const N = 16, L = 64, t = 3.7;
  const P = defaultSeaParams();
  const band = { tile: L, N, kLo0: 0, kLo1: 0, kHi0: 0, kHi1: 0 };
  const dk = (2 * Math.PI) / L;
  const rand = mulberry32(42);
  const gauss = () => {
    const u1 = Math.max(rand(), 1e-9), u2 = rand();
    const r = Math.sqrt(-2 * Math.log(u1)), th = 2 * Math.PI * u2;
    return [r * Math.cos(th), r * Math.sin(th)];
  };
  const Hre = new Float64Array(N * N), Him = new Float64Array(N * N);
  const psiGrid = new Float64Array(N * N);
  let m0 = 0;
  const amp = (N * N * dk) / Math.SQRT2; // must match SPECTRUM_FRAG
  // pre-generate gaussian field (one draw per mode, like the shader's hash)
  const G = [];
  for (let i = 0; i < N * N; i++) G.push(gauss());
  for (let ny = 0; ny < N; ny++) {
    for (let nx = 0; nx < N; nx++) {
      if (nx === N / 2 || ny === N / 2) continue; // Nyquist zeroed, like shader
      const kx = (nx <= N / 2 ? nx : nx - N) * dk;
      const ky = (ny <= N / 2 ? ny : ny - N) * dk;
      const { psi, omega } = wavenumberSpectrum(kx, ky, P, band, P.refDepth);
      psiGrid[ny * N + nx] = psi;
      m0 += psi * dk * dk;
      const mx = (N - nx) % N, my = (N - ny) % N;
      const mkx = (mx <= N / 2 ? mx : mx - N) * dk;
      const mky = (my <= N / 2 ? my : my - N) * dk;
      const psiM = wavenumberSpectrum(mkx, mky, P, band, P.refDepth).psi;
      const [g1r, g1i] = G[ny * N + nx];
      const [g2r, g2i] = G[my * N + mx];
      const h0kr = g1r * amp * Math.sqrt(psi), h0ki = g1i * amp * Math.sqrt(psi);
      const h0mr = g2r * amp * Math.sqrt(psiM), h0mi = g2i * amp * Math.sqrt(psiM);
      const c = Math.cos(omega * t), s = Math.sin(omega * t);
      // H = h0k*e^{-iwt} + conj(h0m)*e^{+iwt}
      const t1r = h0kr * c + h0ki * s, t1i = -h0kr * s + h0ki * c;
      const t2r = h0mr * c + h0mi * s, t2i = h0mr * s - h0mi * c;
      Hre[ny * N + nx] = t1r + t2r;
      Him[ny * N + nx] = t1i + t2i;
    }
  }
  // bit-reverse + 2D IFFT via butterfly
  const bf = precomputeButterfly(N);
  const bits = Math.log2(N);
  const bR = new Float64Array(N * N), bI = new Float64Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++)
    { bR[bitReverse(y, bits) * N + bitReverse(x, bits)] = Hre[y * N + x]; bI[bitReverse(y, bits) * N + bitReverse(x, bits)] = Him[y * N + x]; }
  const tR = new Float64Array(N * N), tI = new Float64Array(N * N);
  for (let y = 0; y < N; y++) {
    const r = applyButterfly1D(bR.slice(y * N, y * N + N), bI.slice(y * N, y * N + N), N, bf);
    for (let x = 0; x < N; x++) { tR[y * N + x] = r.re[x]; tI[y * N + x] = r.im[x]; }
  }
  let vRe = 0, vIm = 0;
  for (let x = 0; x < N; x++) {
    const cr = new Float64Array(N), ci = new Float64Array(N);
    for (let y = 0; y < N; y++) { cr[y] = tR[y * N + x]; ci[y] = tI[y * N + x]; }
    const r = applyButterfly1D(cr, ci, N, bf);
    for (let y = 0; y < N; y++) { vRe += r.re[y] ** 2; vIm += r.im[y] ** 2; }
  }
  vRe /= N * N; vIm /= N * N;
  const ratio = vRe / m0;
  console.log(`e2e energy: spatial var=${vRe.toExponential(3)} target m0=${m0.toExponential(3)} ratio=${ratio.toFixed(3)} imagFrac=${(vIm / vRe).toExponential(2)}`);
  assert.ok(ratio > 0.5 && ratio < 2.0, `energy scaling off: ratio=${ratio}`);
  assert.ok(vIm / vRe < 0.05, 'IFFT of Hermitian spectrum should be (near-)real');
}

console.log('fft.test.mjs: ALL PASS');
