/**
 * Minimal radix-2 FFT for the offline verification harness. Not used at runtime.
 */
export function fft(re, im) {
  const n = re.length;
  if (n & (n - 1)) throw new Error('fft length must be a power of two');
  // bit reversal
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k];
        const ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/** Magnitude spectrum (linear freq bins → magnitude) of a mono Float32Array. */
export function magnitudeSpectrum(samples, windowed = true) {
  let n = 1;
  while (n * 2 <= samples.length) n *= 2;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const w = windowed ? 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)) : 1; // Hann
    re[i] = samples[i] * w;
  }
  fft(re, im);
  const out = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) out[i] = Math.hypot(re[i], im[i]) / n;
  return out;
}

export function rms(samples) {
  let s = 0;
  for (let i = 0; i < samples.length; i++) s += samples[i] * samples[i];
  return Math.sqrt(s / samples.length);
}

/** Peak frequency within a band, plus the band's magnitude. */
export function peakIn(mags, sampleRate, loHz, hiHz) {
  const binHz = sampleRate / (mags.length * 2);
  const lo = Math.max(1, Math.floor(loHz / binHz));
  const hi = Math.min(mags.length - 1, Math.ceil(hiHz / binHz));
  let best = { freq: 0, mag: 0 };
  for (let i = lo; i <= hi; i++) {
    if (mags[i] > best.mag) best = { freq: i * binHz, mag: mags[i] };
  }
  return best;
}

/** Parabolic interpolation of a peak for sub-bin frequency accuracy. */
export function refinePeak(mags, sampleRate, approxHz, span = 6) {
  const binHz = sampleRate / (mags.length * 2);
  const c = Math.round(approxHz / binHz);
  const lo = Math.max(1, c - span);
  const hi = Math.min(mags.length - 2, c + span);
  let bi = lo;
  for (let i = lo; i <= hi; i++) if (mags[i] > mags[bi]) bi = i;
  const a = mags[bi - 1];
  const b = mags[bi];
  const d = mags[bi + 1];
  const denom = a - 2 * b + d;
  const shift = denom !== 0 ? (0.5 * (a - d)) / denom : 0;
  return { bin: bi, freq: (bi + shift) * binHz, mag: b };
}
