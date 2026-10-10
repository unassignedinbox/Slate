// Deterministic, seedable random numbers so every Monte Carlo run can be reproduced.
// mulberry32 for uniform deviates; Marsaglia polar method for Gaussian deviates.

export function createRng(seed = 12345) {
  let state = seed >>> 0;
  let spare = null;

  function uniform() {
    // [0, 1). mulberry32 (Tommy Ettinger's variant constants).
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function gaussian() {
    if (spare !== null) {
      const value = spare;
      spare = null;
      return value;
    }
    let u;
    let v;
    let s;
    do {
      u = 2 * uniform() - 1;
      v = 2 * uniform() - 1;
      s = u * u + v * v;
    } while (s >= 1 || s === 0);
    const factor = Math.sqrt((-2 * Math.log(s)) / s);
    spare = v * factor;
    return u * factor;
  }

  return {
    seed,
    uniform,
    gaussian,
    /** Uniform in [lo, hi). */
    range: (lo, hi) => lo + (hi - lo) * uniform(),
    /** Bernoulli trial. */
    chance: (p) => uniform() < p,
    /** Poisson sampling for small means (Knuth). */
    poisson(mean) {
      if (mean <= 0) return 0;
      const limit = Math.exp(-mean);
      let k = 0;
      let p = 1;
      do {
        k += 1;
        p *= uniform();
      } while (p > limit && k < 1e6);
      return k - 1;
    },
  };
}

/** Mean-reverting Ornstein-Uhlenbeck noise with exact discretisation.
 *  Stationary standard deviation equals `sigma`; correlation time `tau` seconds. */
export function createOuNoise(rng, sigma, tau) {
  let x = sigma * rng.gaussian();
  return {
    value: () => x,
    step(h, nextSigma = sigma) {
      const decay = tau > 0 ? Math.exp(-h / tau) : 0;
      const kick = nextSigma * Math.sqrt(Math.max(0, 1 - decay * decay));
      x = decay * x + kick * rng.gaussian();
      return x;
    },
  };
}
