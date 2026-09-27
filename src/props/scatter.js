import * as THREE from 'three';
import { MAT } from './materials.js';
import { box, cyl } from '../util/geo.js';
import { makeRNG } from '../util/mathx.js';

// Small dressing props. Cheap, flat-shaded, all merged by the batcher.

export function ammoCrate(seed = 1) {
  const rng = makeRNG(seed);
  const g = new THREE.Group();
  const w = rng.range(0.8, 1.3);
  const h = rng.range(0.45, 0.7);
  const d = rng.range(0.55, 0.85);
  g.add(box(w, h, d, rng.chance(0.5) ? MAT.olive : MAT.wood, 0, h / 2, 0));
  g.add(box(w * 1.02, 0.07, d * 0.18, MAT.woodDark, 0, h * 0.62, 0));
  g.add(box(w * 0.18, 0.07, d * 1.02, MAT.woodDark, 0, h * 0.62, 0));
  if (rng.chance(0.4)) {
    const h2 = rng.range(0.35, 0.55);
    g.add(box(w * 0.85, h2, d * 0.85, MAT.olive, rng.range(-0.15, 0.15), h + h2 / 2, rng.range(-0.15, 0.15), 0, rng.range(-0.4, 0.4), 0));
  }
  g.rotation.y = rng.range(0, 6.28);
  return g;
}

export function fuelBarrel(seed = 1) {
  const rng = makeRNG(seed);
  const g = new THREE.Group();
  const tipped = rng.chance(0.35);
  const b = cyl(0.36, 0.36, 1.0, 10, rng.chance(0.5) ? MAT.rust : MAT.oliveDark, 0, tipped ? 0.36 : 0.5, 0, tipped ? Math.PI / 2 : 0, 0, 0);
  g.add(b);
  for (const y of [-0.22, 0.22]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.37, 0.035, 3, 10), MAT.steelDark);
    if (tipped) {
      ring.position.set(0, 0.36, y);
      ring.rotation.set(0, 0, 0);
    } else {
      ring.position.set(0, 0.5 + y, 0);
      ring.rotation.x = Math.PI / 2;
    }
    g.add(ring);
  }
  g.rotation.y = rng.range(0, 6.28);
  return g;
}

export function deadTree(seed = 1) {
  const rng = makeRNG(seed);
  const g = new THREE.Group();
  const h = rng.range(3.5, 7);
  g.add(cyl(0.18, 0.42, h, 6, MAT.woodDark, 0, h / 2, 0, rng.range(-0.06, 0.06), 0, rng.range(-0.06, 0.06)));
  const branches = rng.int(2, 4);
  for (let i = 0; i < branches; i++) {
    const a = rng.range(0, 6.28);
    const len = rng.range(1.2, 2.6);
    const y = h * rng.range(0.5, 0.92);
    const br = cyl(0.06, 0.14, len, 5, MAT.woodDark, Math.cos(a) * len * 0.3, y, Math.sin(a) * len * 0.3);
    br.rotation.set(Math.cos(a) * 0.9, 0, -Math.sin(a) * 0.9);
    g.add(br);
  }
  // blasted, splintered top
  g.add(cyl(0.02, 0.2, 0.9, 5, MAT.woodDark, 0, h + 0.35, 0, rng.range(-0.3, 0.3), 0, rng.range(-0.3, 0.3)));
  return g;
}

export function rubblePile(seed = 1) {
  const rng = makeRNG(seed);
  const g = new THREE.Group();
  const n = rng.int(4, 9);
  for (let i = 0; i < n; i++) {
    const s = rng.range(0.25, 0.95);
    g.add(box(s, s * rng.range(0.4, 0.9), s * rng.range(0.6, 1.3), rng.chance(0.6) ? MAT.concreteDark : MAT.rock || MAT.concrete,
      rng.range(-1.4, 1.4), s * 0.3, rng.range(-1.4, 1.4), rng.range(0, 1), rng.range(0, 3), rng.range(0, 1)));
  }
  if (rng.chance(0.4)) g.add(cyl(0.04, 0.04, rng.range(0.8, 1.6), 4, MAT.rust, rng.range(-0.8, 0.8), 0.4, rng.range(-0.8, 0.8), rng.range(0, 1.2), 0, rng.range(0, 1.2)));
  return g;
}

export function fencePost(seed = 1) {
  const rng = makeRNG(seed);
  const g = new THREE.Group();
  g.add(cyl(0.09, 0.11, rng.range(1.2, 1.8), 5, MAT.woodDark, 0, 0.7, 0, rng.range(-0.15, 0.15), 0, rng.range(-0.15, 0.15)));
  return g;
}

export function telegraphPole(seed = 1) {
  const rng = makeRNG(seed);
  const g = new THREE.Group();
  const broken = rng.chance(0.22);
  const h = broken ? rng.range(2, 4) : rng.range(6.5, 8);
  g.add(cyl(0.13, 0.19, h, 6, MAT.woodDark, 0, h / 2, 0, broken ? rng.range(-0.25, 0.25) : rng.range(-0.04, 0.04), 0, 0));
  if (!broken) {
    g.add(box(2.0, 0.12, 0.12, MAT.wood, 0, h - 0.5, 0));
    g.add(box(1.4, 0.1, 0.1, MAT.wood, 0, h - 1.1, 0));
    for (const x of [-0.85, -0.3, 0.3, 0.85]) g.add(cyl(0.05, 0.05, 0.16, 5, MAT.glass, x, h - 0.38, 0));
  } else {
    g.add(box(1.4, 0.1, 0.1, MAT.wood, rng.range(-1, 1), 0.15, rng.range(-1, 1), 0, rng.range(0, 3), rng.range(-0.2, 0.2)));
  }
  return g;
}

/**
 * Field repair point: a little engineer dump you drive into to patch the car.
 * Jerrycans, a crate of spares, a fuel drum and a tall pennant so you can see
 * it from up the road.
 */
export function supplyDepot(seed = 1) {
  const rng = makeRNG(seed);
  const g = new THREE.Group();

  // sandbag footing, two courses, laid tight
  for (let row = 0; row < 2; row++) {
    const n = 9 - row;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + row * 0.35;
      const r = 2.1 - row * 0.12;
      g.add(box(1.0, 0.34, 0.6, MAT.sandbag, Math.cos(a) * r, 0.17 + row * 0.33, Math.sin(a) * r, 0, -a, 0));
    }
  }
  // jerrycans with the X rib
  for (let i = 0; i < 4; i++) {
    const jx = -1.0 + (i % 2) * 0.62;
    const jz = -0.5 + Math.floor(i / 2) * 0.58;
    g.add(box(0.5, 0.7, 0.28, MAT.olive, jx, 0.35, jz));
    g.add(box(0.14, 0.09, 0.3, MAT.oliveDark, jx, 0.72, jz));
    for (const sgn of [1, -1]) {
      g.add(box(0.56, 0.07, 0.3, MAT.oliveDark, jx, 0.35, jz, 0, 0, sgn * 0.92));
    }
  }
  // spares crate
  g.add(box(1.5, 0.85, 1.05, MAT.wood, 0.95, 0.42, 0.2, 0, rng.range(-0.25, 0.25), 0));
  g.add(box(1.52, 0.1, 0.2, MAT.woodDark, 0.95, 0.62, 0.2));
  // fuel drum, upright and one tipped
  g.add(cyl(0.42, 0.42, 1.1, 10, MAT.rust, 0.7, 0.55, -1.35));
  g.add(cyl(0.4, 0.4, 1.05, 10, MAT.oliveDark, -1.5, 0.4, 1.3, Math.PI / 2, 0, 0.35));
  // tall pennant so you can pick the dump out from up the road
  g.add(cyl(0.09, 0.12, 5.6, 5, MAT.woodDark, -2.0, 2.8, 1.1));
  g.add(box(0.06, 1.0, 1.55, MAT.white, -2.0, 4.85, 1.95));
  g.add(box(0.09, 0.26, 1.56, MAT.rust, -2.0, 4.85, 1.95));
  g.add(box(0.09, 1.01, 0.4, MAT.rust, -2.0, 4.85, 1.95));
  return g;
}
