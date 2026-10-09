// Deterministic random sources. Everything in Slate is reproducible from the
// project seed, so a landscape can be reopened and re-simulated exactly.

export function hashSeed(seed: number, salt = 0): number {
  let h = (seed | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (salt + 0x85ebca6b), 0xcc9e2d51);
  h = Math.imul(h ^ (h >>> 13), 0x1b873593);
  return (h ^ (h >>> 16)) >>> 0;
}

/** mulberry32 — small, fast, good enough for terrain work. */
export function makeRng(seed: number): () => number {
  let a = (seed >>> 0) || 1;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates shuffle driven by a seeded rng. */
export function shuffle<T>(list: T[], rng: () => number): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = list[i];
    list[i] = list[j];
    list[j] = t;
  }
  return list;
}
