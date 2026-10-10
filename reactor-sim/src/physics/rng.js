// Deterministic pseudo-random number generator (mulberry32) with Box-Muller Gaussians.
// Every stochastic element of a run (pump pulsation, sensor noise, vibration) draws from
// one seeded stream, so any run can be reproduced exactly from its seed.

export function createRng(seed = 1) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let spare = null;
  const gaussian = () => {
    if (spare !== null) {
      const g = spare;
      spare = null;
      return g;
    }
    let u = 0;
    while (u === 0) u = next();
    const v = next();
    const r = Math.sqrt(-2 * Math.log(u));
    spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  };
  return {
    seed,
    next,
    uniform: (a, b) => a + (b - a) * next(),
    gaussian,
  };
}

// Stationary AR(1) process bounded to [-bound, +bound].
//   x_{k+1} = phi x_k + sqrt(1 - phi^2) sigma * N(0,1), then clamped.
// The stationary standard deviation before clamping equals sigma.
export function boundedAr1(rng, x, { phi, sigma, bound }) {
  let next = phi * x + Math.sqrt(Math.max(0, 1 - phi * phi)) * sigma * rng.gaussian();
  if (next > bound) next = bound;
  if (next < -bound) next = -bound;
  return next;
}
