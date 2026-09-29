/**
 * CPU preview of a generator shader.
 *
 * There is no GPU here, so this is a faithful JS port of the noise stack in
 * src/core/shaders/lib.ts plus the Mountain Range body. It exists so the *shape*
 * of a generator can be inspected as an image instead of guessed at — the
 * Voronoi-web regression that made the starter terrain look like a honeycomb
 * would have been obvious in one glance at this.
 *
 *   npx tsx scripts/preview-generator.ts [size]
 *
 * Writes preview-height.png (raw field) and preview-shaded.png (hillshade).
 */
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

// ---------------------------------------------------------------- GLSL prims
const fract = (x: number) => x - Math.floor(x);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const saturate = (x: number) => clamp(x, 0, 1);
const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0 || 1e-9), 0, 1);
  return t * t * (3 - 2 * t);
};
const TAU = 6.28318530718;

function hash11(p: number) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}
function hash12(x: number, y: number) {
  let p3x = fract(x * 0.1031), p3y = fract(y * 0.1031), p3z = fract(x * 0.1031);
  const d = p3x * (p3y + 33.33) + p3y * (p3z + 33.33) + p3z * (p3x + 33.33);
  p3x += d; p3y += d; p3z += d;
  return fract((p3x + p3y) * p3z);
}
function hash22(x: number, y: number): [number, number] {
  let p3x = fract(x * 0.1031), p3y = fract(y * 0.1030), p3z = fract(x * 0.0973);
  const d = p3x * (p3y + 33.33) + p3y * (p3z + 33.33) + p3z * (p3x + 33.33);
  p3x += d; p3y += d; p3z += d;
  return [fract((p3x + p3y) * p3z), fract((p3x + p3z) * p3y)];
}

function gradDir2(ix: number, iy: number): [number, number] {
  const a = hash12(ix, iy) * TAU;
  return [Math.cos(a), Math.sin(a)];
}
function perlin2(px: number, py: number) {
  const ix = Math.floor(px), iy = Math.floor(py);
  const fx = px - ix, fy = py - iy;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const dg = (gx: number, gy: number) => {
    const g = gradDir2(ix + gx, iy + gy);
    return g[0] * (fx - gx) + g[1] * (fy - gy);
  };
  return mix(mix(dg(0, 0), dg(1, 0), ux), mix(dg(0, 1), dg(1, 1), ux), uy) * 1.4142;
}
function valueNoise2(px: number, py: number) {
  const ix = Math.floor(px), iy = Math.floor(py);
  const fx = px - ix, fy = py - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash12(ix, iy), b = hash12(ix + 1, iy), c = hash12(ix, iy + 1), d = hash12(ix + 1, iy + 1);
  return mix(mix(a, b, ux), mix(c, d, ux), uy) * 2 - 1;
}
function worley2(px: number, py: number): [number, number, number] {
  const ipx = Math.floor(px), ipy = Math.floor(py);
  const fpx = px - ipx, fpy = py - ipy;
  let f1 = 8, f2 = 8, id = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const o = hash22(ipx + i, ipy + j);
    const dx = i + o[0] - fpx, dy = j + o[1] - fpy;
    const d = Math.hypot(dx, dy);
    if (d < f1) { f2 = f1; f1 = d; id = hash12(ipx + i, ipy + j); }
    else if (d < f2) f2 = d;
  }
  return [f1, f2, id];
}
function basis2(px: number, py: number, b: number) {
  if (b === 0) return perlin2(px, py);
  if (b === 2) return valueNoise2(px, py);
  const w = worley2(px, py);
  if (b === 3) return w[0] * 2 - 1;
  return (w[1] - w[0]) * 2 - 1;
}

function fractal2(
  px: number, py: number, mode: number, basis: number, octaves: number,
  lacunarity: number, gain: number, H: number, offsetP: number, warpAmt: number, seed: number,
) {
  px += seed * 137.17; py += seed * 71.93;
  let sum = 0, amp = 1, freq = 1, norm = 0, prev = 1;
  let dsx = 0, dsy = 0;
  const cs = Math.cos(0.5), sn = Math.sin(0.5);
  for (let i = 0; i < octaves && i < 24; i++) {
    let qx = px * freq, qy = py * freq;
    if (warpAmt > 0) { qx += dsx * warpAmt; qy += dsy * warpAmt; }
    let n = basis2(qx, qy, basis);
    if (mode === 1) n = Math.abs(n) * 2 - 1;
    else if (mode === 2) { n = 1 - Math.abs(n); n = n * n * 2 - 1; }
    else if (mode === 4) {
      let sig = offsetP - Math.abs(n);
      sig = sig * sig;
      sum += sig * amp * prev;
      norm += amp;
      prev = clamp(sig * 2, 0, 1);
      amp *= Math.pow(lacunarity, -H); freq *= lacunarity;
      [px, py] = [cs * px - sn * py, sn * px + cs * py];
      continue;
    }
    sum += n * amp;
    norm += amp;
    amp *= gain; freq *= lacunarity;
    [px, py] = [cs * px - sn * py, sn * px + cs * py];
  }
  return sum / Math.max(1e-6, norm);
}

/**
 * Highest octave that still lands above the sampling limit.
 *
 * `cycles` is how many times the octave-0 feature repeats across the whole
 * domain. Anything finer than MIN_PX_PER_CYCLE texels is not detail, it is
 * aliasing noise — and once erosion runs on top of it, it is aliasing noise
 * that looks like erosion failed.
 */
const MIN_PX_PER_CYCLE = 3.0;
export function nyquistOctaves(res: number, cycles: number, lacunarity: number, want: number) {
  const limit = res / MIN_PX_PER_CYCLE;
  const maxOct = Math.floor(Math.log2(Math.max(1, limit / Math.max(1e-3, cycles))) / Math.log2(lacunarity)) + 1;
  return Math.max(1, Math.min(want, maxOct));
}

// ------------------------------------------------- Mountain Range, ported 1:1
interface MParams {
  ranges: number; ridgeWidth: number; flank: number; detail: number;
  octaves: number; warpAmt: number; peaks: number; scale: number; seed: number;
}
function mountain(u: number, v: number, P: MParams, res: number) {
  const uSeed = P.seed;
  const px = (u - 0.5) * P.scale, py = (v - 0.5) * P.scale;
  const uBasis = 0, uLac = 2.03, uGain = 0.5, uH = 0.9, uOffsetP = 0.92;

  const wx = fractal2(px * 0.35 + 11.0, py * 0.35 + 11.0, 0, 0, 4, 2.0, 0.5, 1.0, 1.0, 0.0, uSeed);
  const wy = fractal2(px * 0.35 - 7.0, py * 0.35 - 7.0, 0, 0, 4, 2.0, 0.5, 1.0, 1.0, 0.0, uSeed + 3.0);
  const qx = px * P.ranges + wx * P.warpAmt;
  const qy = py * P.ranges + wy * P.warpAmt;

  const span = P.scale * P.ranges;            // domain width in q units
  const oR1 = nyquistOctaves(res, span * 1.2, uLac, Math.min(P.octaves, 8));
  const oR2 = nyquistOctaves(res, span * 3.1, 2.0, 5);
  const oD  = nyquistOctaves(res, P.scale * 5.0, 2.0, 5);

  let mass = fractal2(qx * 0.58, qy * 0.58, 0, uBasis, 4, 2.1, 0.5, 1.0, 1.0, 0.0, uSeed + 41.0);
  mass = smoothstep(-0.50, 0.30, mass);
  mass = Math.pow(mass, 0.45 + P.flank * 0.35);

  let r1 = saturate(fractal2(qx * 1.2, qy * 1.2, 4, uBasis, oR1, uLac, uGain, uH, uOffsetP, 0.0, uSeed + 21.0) * 1.35);
  r1 = Math.pow(r1, mix(1.5, 0.55, saturate(P.ridgeWidth)));

  let r2 = fractal2(qx * 3.1, qy * 3.1, 2, uBasis, oR2, 2.0, 0.5, 0.9, uOffsetP, 0.0, uSeed + 57.0);
  r2 = saturate(r2 * 0.5 + 0.5);
  const ridge = r1 * (0.72 + 0.28 * r2);

  // Summit variation. This used to key off a Voronoi cell id, which jumps at
  // every cell boundary and stamped hard straight seams across the terrain —
  // a low-frequency field varies the same way without the discontinuity.
  const pv = fractal2(qx * 0.42 + 53.0, qy * 0.42 - 29.0, 0, uBasis, 3, 2.0, 0.5, 1.0, 1.0, 0.0, uSeed + 91.0);
  const peakVar = mix(1.0, 0.52 + saturate(pv * 0.5 + 0.5) * 0.88, P.peaks);

  let base = mass * peakVar * (0.15 + 0.85 * ridge);

  const det = fractal2(px * 5.0, py * 5.0, 2, uBasis, oD, 2.0, 0.5, 0.9, 0.92, 0.2, uSeed + 77.0);
  base += (det * 0.5 + 0.5) * P.detail * 0.13 * (0.12 + 0.88 * base);

  return Math.pow(saturate(base), 0.78);
}

// ------------------------------------------------------------------ tiny PNG
function png(w: number, h: number, rgb: Uint8Array): Buffer {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    rgb.subarray(y * w * 3, (y + 1) * w * 3).forEach((b, i) => { raw[y * (w * 3 + 1) + 1 + i] = b; });
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crcTable: number[] = [];
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
    let crc = 0xffffffff;
    for (const b of td) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
    const cb = Buffer.alloc(4); cb.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([len, td, cb]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------- run
const N = Number(process.argv[2] ?? 320);
// exactly what makeDefaultGraph() feeds the Mountain Range node
const P: MParams = { ranges: 1.7, ridgeWidth: 0.45, flank: 1.35, detail: 0.42, octaves: 9, warpAmt: 0.5, peaks: 0.5, scale: 2.0, seed: 1337 * 0.7351 };

const H = new Float64Array(N * N);
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) H[y * N + x] = mountain((x + 0.5) / N, (y + 0.5) / N, P, N);

let mn = Infinity, mx = -Infinity;
for (const v of H) { if (v < mn) mn = v; if (v > mx) mx = v; }
for (let i = 0; i < H.length; i++) H[i] = (H[i] - mn) / (mx - mn || 1); // autoLevel

// histogram — a bimodal field is the tell-tale of the web bug
const bins = new Array(10).fill(0);
for (const v of H) bins[Math.min(9, Math.floor(v * 10))]++;
console.log(`range [${mn.toFixed(3)}, ${mx.toFixed(3)}]  mean ${(H.reduce((a, b) => a + b, 0) / H.length).toFixed(3)}`);
console.log('height histogram (decile -> % of surface):');
bins.forEach((c, i) => console.log(`  0.${i}–0.${i + 1}  ${String((c / H.length * 100).toFixed(1)).padStart(5)}%  ${'#'.repeat(Math.round(c / H.length * 120))}`));

const grey = new Uint8Array(N * N * 3);
for (let i = 0; i < N * N; i++) { const b = Math.round(H[i] * 255); grey[i * 3] = grey[i * 3 + 1] = grey[i * 3 + 2] = b; }
writeFileSync('preview-height.png', png(N, N, grey));

// hillshade so ridge structure is legible
const shade = new Uint8Array(N * N * 3);
const sun = [Math.cos(0.6) * Math.cos(2.3), Math.sin(0.6), Math.cos(0.6) * Math.sin(2.3)];
// physically-scaled slope: dH is in normalised height, so convert with the real
// heightScale / worldSize ratio the app uses, otherwise everything looks flat
const HEIGHT_SCALE = 900, WORLD_SIZE = 4096;
const relief = (N / 2) * (HEIGHT_SCALE / WORLD_SIZE);
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
  const l = H[y * N + Math.max(0, x - 1)], r = H[y * N + Math.min(N - 1, x + 1)];
  const d = H[Math.max(0, y - 1) * N + x], u = H[Math.min(N - 1, y + 1) * N + x];
  let nx = (l - r) * relief, ny = 1, nz = (d - u) * relief;
  const len = Math.hypot(nx, ny, nz); nx /= len; ny /= len; nz /= len;
  const ndl = Math.max(0, nx * sun[0] + ny * sun[1] + nz * sun[2]);
  const h = H[y * N + x];
  // rough verdant-style ramp so the colour read matches the app
  const ramp: [number, number[]][] = [[0, [30, 51, 32]], [0.24, [47, 81, 48]], [0.46, [78, 112, 60]], [0.66, [126, 140, 84]], [0.84, [169, 157, 120]], [1, [226, 222, 209]]];
  let c = ramp[0][1], c2 = ramp[ramp.length - 1][1], f = 0;
  for (let s = 0; s < ramp.length - 1; s++) if (h >= ramp[s][0] && h <= ramp[s + 1][0]) { c = ramp[s][1]; c2 = ramp[s + 1][1]; f = (h - ramp[s][0]) / (ramp[s + 1][0] - ramp[s][0]); break; }
  for (let k = 0; k < 3; k++) {
    const alb = mix(c[k], c2[k], f) / 255;
    shade[(y * N + x) * 3 + k] = Math.round(255 * Math.pow(saturate(alb * (0.28 + 1.5 * ndl)), 1 / 2.2));
  }
}
writeFileSync('preview-shaded.png', png(N, N, shade));
console.log('\nwrote preview-height.png and preview-shaded.png');
