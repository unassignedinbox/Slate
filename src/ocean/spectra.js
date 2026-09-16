// Oceanographic wave spectra — JS mirror of the GPU spectrum shader.
// Keep formulas identical to src/ocean/glsl.js (SPECTRUM_COMMON).
// Zero dependencies: used by UI, probes, cancellation tuning, and unit tests.

export const G = 9.81;

// UV rotation (radians) applied per cascade when sampling displacement.
// [0] must stay 0 so swell direction matches the UI + sources. Mirrored in GLSL.
export const CASCADE_ROT = [0.0, 0.6, 2.2];

// Finite-depth linear dispersion: w^2 = g k tanh(k D)
export function dispersionOmega(k, D) {
  if (!(k > 0)) return 0;
  if (!(D > 0)) return Math.sqrt(G * k);
  return Math.sqrt(G * k * Math.tanh(k * D));
}

// d(w)/d(k) for the wavenumber<->frequency Jacobian.
export function dispersionDeriv(k, D) {
  if (!(k > 0)) return 0;
  if (!(D > 0)) return 0.5 * Math.sqrt(G / k);
  const w = dispersionOmega(k, D);
  const kd = k * D;
  const s = Math.sinh(2 * kd);
  const corr = s > 1e-6 ? 1 + (2 * kd) / s : 2; // shallow limit -> 2
  return (w / (2 * k)) * corr;
}

// Hasselmann et al. (1973/1976) fetch relations.
export function fetchRelations(U10, F) {
  const U = Math.max(U10, 0.5);
  const fetch = Math.max(F, 100);
  const nd = (G * fetch) / (U * U); // nondimensional fetch
  const alpha = 0.076 * Math.pow(nd, -0.22);
  const fp = 3.5 * (G / U) * Math.pow(nd, -0.33); // Hasselmann: fp*U/g = 3.5*nd^-0.33
  const Hs = 0.0016 * ((U * U) / G) * Math.sqrt(nd); // significant height
  return { alpha, fp, wp: 2 * Math.PI * fp, Hs };
}

// JONSWAP frequency spectrum S(w) [m^2 s].
export function jonswapS(w, alpha, wp, gamma) {
  if (!(w > 0)) return 0;
  const sigma = w <= wp ? 0.07 : 0.09;
  const r = Math.exp(-((w - wp) * (w - wp)) / (2 * sigma * sigma * wp * wp));
  return ((alpha * G * G) / Math.pow(w, 5)) * Math.exp(-1.25 * Math.pow(wp / w, 4)) * Math.pow(gamma, r);
}

// TMA depth factor (Bouws et al. / Kitaigorodskii), ph^2 with piecewise ph.
export function tmaPhi(w, D) {
  if (!(D > 0)) return 1;
  const wh = w * Math.sqrt(D / G);
  let ph;
  if (wh <= 1) ph = 0.5 * wh * wh;
  else if (wh <= 2) { const t = 2 - wh; ph = 1 - 0.5 * t * t; }
  else ph = 1;
  return ph * ph;
}

// Donelan-Banner et al. (1985) spreading sharpness beta(w).
export function donelanBeta(w, wp) {
  const x = w / wp;
  if (x < 0.56) return 2.61 * Math.pow(0.56, 1.3);
  if (x < 0.95) return 2.61 * Math.pow(x, 1.3);
  if (x < 1.6) return 2.28 * Math.pow(x, -1.3);
  return 1.24;
}

export function wrapAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

// Self-normalized sech^2 directional distribution.
export function donelanD(theta, thetaM, beta) {
  const d = wrapAngle(theta - thetaM);
  const c = Math.cosh(beta * d);
  const s = 1 / (c * c);
  return 0.5 * beta * s;
}

// Pierson-Moskowitz shape scaled to a target (Hs, Tp): integrates to Hs^2/16.
// Used for the independent swell trains.
export function pmSwellS(w, Hs, Tp) {
  if (!(w > 0) || !(Hs > 0) || !(Tp > 0)) return 0;
  const wp = (2 * Math.PI) / Tp;
  return ((5 / 16) * Hs * Hs * Math.pow(wp, 4)) / Math.pow(w, 5) * Math.exp(-1.25 * Math.pow(wp / w, 4));
}

// Classic Phillips spectrum (Tessendorf 1999), directional in k already.
export function phillips(kx, ky, windX, windY, A = 1) {
  const k2 = kx * kx + ky * ky;
  if (!(k2 > 1e-12)) return 0;
  const k = Math.sqrt(k2);
  const U = Math.hypot(windX, windY);
  if (!(U > 0.01)) return 0;
  const L = (U * U) / G;
  const wk = (kx * windX + ky * windY) / (k * U);
  if (wk <= 0) return 0;
  const l = 0.5; // small-wave cutoff (m)
  return (A * Math.exp(-1 / (k2 * L * L)) * Math.exp(-k2 * l * l) * wk * wk) / (k2 * k2);
}

export function cosFade(k, a, b) {
  if (!(b > a)) return 1;
  const t = Math.min(1, Math.max(0, (k - a) / (b - a)));
  return 0.5 - 0.5 * Math.cos(Math.PI * t);
}

// Default sea parameters (shared with UI + GPU).
export function defaultSeaParams() {
  return {
    specMode: 0,            // 0 = JONSWAP+TMA, 1 = Pierson-Moskowitz, 2 = Phillips
    windSpeed: 9.0,         // U10 m/s
    windDirDeg: 35,         // direction wind blows TOWARD (deg, +x=0, +z=90)
    fetch: 120000,          // m
    gamma: 3.3,             // JONSWAP peak enhancement
    refDepth: 250,          // reference depth for global spectrum/TMA (m)
    energyScale: 1.0,       // artistic master gain on spectral energy
    swellHs: 1.6,           // m
    swellTp: 11.0,          // s
    swellDirDeg: 35,
    swellBeta: 9.0,         // directional narrowness
    swellEnabled: true,
    chop: 1.0,              // horizontal (Gerste r-like) choppiness
    chopLength: 1.2,        // m: attenuates chop of short waves
  };
}

// Cascade tiling: tiles must descend (large -> small).
export function cascadeBands(tiles, N) {
  const bands = [];
  const cross = [];
  for (let i = 0; i < tiles.length - 1; i++) {
    const kmaxA = (Math.PI * N) / tiles[i];
    const kminB = ((2 * Math.PI) / tiles[i + 1]);
    cross.push(Math.sqrt(kmaxA * kminB));
  }
  const F = 1.5; // crossfade half-width factor (~1 octave total)
  for (let i = 0; i < tiles.length; i++) {
    const band = { tile: tiles[i], kLo0: 0, kLo1: 0, kHi0: 0, kHi1: 0 };
    if (i > 0) { const kc = cross[i - 1]; band.kLo0 = kc / F; band.kLo1 = kc * F; }
    if (i < tiles.length - 1) { const kc = cross[i]; band.kHi0 = kc / F; band.kHi1 = kc * F; }
    bands.push(band);
  }
  return bands;
}

// Full directional wavenumber spectrum Psi(kx,ky) [m^4] + omega.
// `band` = cascade window from cascadeBands(); pass null for unwindowed.
export function wavenumberSpectrum(kx, ky, P, band, refDepth) {
  const k = Math.hypot(kx, ky);
  if (!(k > 1e-9)) return { psi: 0, omega: 0 };
  const theta = Math.atan2(ky, kx);
  const w = dispersionOmega(k, refDepth);
  const dwdk = dispersionDeriv(k, refDepth);
  let psi = 0;

  if (P.specMode === 2) {
    // Phillips, auto-normalized so its variance matches min(PM, fetch-limited) Hs.
    // (Analytic: m0 = A*pi*L^2/4 over the downwind half-plane.)
    const U = Math.max(P.windSpeed, 0.01);
    const L = (U * U) / G;
    const wu = (P.windDirDeg * Math.PI) / 180;
    const nd = (G * Math.max(P.fetch, 100)) / (U * U);
    const HsF = 0.0016 * ((U * U) / G) * Math.sqrt(nd);
    const HsT = Math.min(0.21 * ((U * U) / G), HsF);
    const A = ((HsT * HsT) / 16) * 4 / (Math.PI * L * L);
    psi = phillips(kx, ky, Math.cos(wu) * U, Math.sin(wu) * U, A) * P.energyScale;
    if (P.swellEnabled && P.swellHs > 0) {
      const Ss = pmSwellS(w, P.swellHs, P.swellTp);
      const su = (P.swellDirDeg * Math.PI) / 180;
      psi += ((Ss * donelanD(theta, su, P.swellBeta) * dwdk * P.energyScale) / k);
    }
  } else {
    const { alpha, wp } = fetchRelations(P.windSpeed, P.fetch);
    const gamma = P.specMode === 1 ? 1.0 : P.gamma;
    const Sj = jonswapS(w, alpha, wp, gamma) * tmaPhi(w, refDepth);
    const wu = (P.windDirDeg * Math.PI) / 180;
    // wave direction convention: wind vector (cos,sin) in k-space maps to (x,z)
    const beta = donelanBeta(w, wp);
    const Dj = donelanD(theta, wu, beta);
    let S = Sj * Dj;
    if (P.swellEnabled && P.swellHs > 0) {
      const Ss = pmSwellS(w, P.swellHs, P.swellTp);
      const su = (P.swellDirDeg * Math.PI) / 180;
      S += Ss * donelanD(theta, su, P.swellBeta);
    }
    psi = (S * dwdk * P.energyScale) / k;
  }

  // Suppress sub-grid noise (Tessendorf high-k fade), scaled to cascade grid.
  if (band) {
    const dx = band.tile / band.N;
    const fade = 1.5 * dx;
    psi *= Math.exp(-k * k * fade * fade);
    psi *= cosFade(k, band.kLo0, band.kLo1);
    if (band.kHi0 > 0) psi *= 1 - cosFade(k, band.kHi0, band.kHi1);
  }
  return { psi, omega: w };
}

// Predicted significant wave height of the partitioned spectrum (m0 integral).
export function predictedHs(P, tiles, N) {
  let m0 = 0;
  const bands = cascadeBands(tiles, N);
  for (const band of bands) {
    band.N = N;
    const dk = (2 * Math.PI) / band.tile;
    for (let iy = 0; iy < N; iy++) {
      const ky = dk * (iy <= N / 2 ? iy : iy - N);
      for (let ix = 0; ix < N; ix++) {
        const kx = dk * (ix <= N / 2 ? ix : ix - N);
        const { psi } = wavenumberSpectrum(kx, ky, P, band, P.refDepth);
        m0 += psi * dk * dk;
      }
    }
  }
  return 4 * Math.sqrt(Math.max(m0, 0));
}

// Dominant wave train for cancellation tuning / UI.
export function dominantWave(P) {
  let Tp, dirDeg, Hs;
  const { fp, Hs: HsWind } = fetchRelations(P.windSpeed, P.fetch);
  if (P.swellEnabled && P.swellHs > 0.15 && P.swellHs >= HsWind * 0.6) {
    Tp = P.swellTp; dirDeg = P.swellDirDeg; Hs = P.swellHs;
  } else {
    Tp = 1 / Math.max(fp, 1e-3); dirDeg = P.windDirDeg; Hs = HsWind;
  }
  const omega = (2 * Math.PI) / Tp;
  const k = (omega * omega) / G; // deep-water
  const a = (dirDeg * Math.PI) / 180;
  return { k, omega, Tp, dirX: Math.cos(a), dirZ: Math.sin(a), dirDeg, HsEst: Hs, ampEst: Hs / 2 };
}
