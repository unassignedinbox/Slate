import * as THREE from 'three';
import { MAT } from './materials.js';
import { box, cyl, prism, taperBox } from '../util/geo.js';
import { makeRNG } from '../util/mathx.js';

// ---------------------------------------------------------------------------
// Static armour. The brief is explicit: tanks are scenery/cover, they do not
// move. They are built properly though - running gear, sponsons, mantlet,
// stowage - because they are the things you drive past at 2 metres.
// Local space: +Z = forward (muzzle direction).
// ---------------------------------------------------------------------------

function runningGear(len, wheelCount, wheelR, trackW, gauge, mat = MAT.steelDark) {
  const g = new THREE.Group();
  for (const s of [-1, 1]) {
    const x = s * gauge;
    // track as a closed loop: bottom run, top run, rounded ends
    g.add(box(trackW, wheelR * 0.42, len, MAT.black, x, wheelR * 0.2, 0));
    g.add(box(trackW, wheelR * 0.42, len * 0.92, MAT.black, x, wheelR * 2.0, 0));
    g.add(cyl(wheelR * 1.05, wheelR * 1.05, trackW, 9, MAT.black, x, wheelR * 1.1, len / 2 - wheelR * 0.5, 0, 0, Math.PI / 2));
    g.add(cyl(wheelR * 1.05, wheelR * 1.05, trackW, 9, MAT.black, x, wheelR * 1.1, -len / 2 + wheelR * 0.5, 0, 0, Math.PI / 2));
    for (let i = 0; i < wheelCount; i++) {
      const t = wheelCount === 1 ? 0.5 : i / (wheelCount - 1);
      const z = -len / 2 + wheelR + t * (len - wheelR * 2);
      g.add(cyl(wheelR, wheelR, trackW * 0.7, 8, mat, x, wheelR * 0.95, z, 0, 0, Math.PI / 2));
    }
    // return rollers
    for (let i = 0; i < 3; i++) {
      g.add(cyl(wheelR * 0.4, wheelR * 0.4, trackW * 0.5, 6, mat, x, wheelR * 1.85, -len / 3 + i * (len / 3), 0, 0, Math.PI / 2));
    }
    // track guard
    g.add(box(trackW + 0.25, 0.12, len * 0.8, MAT.oliveDark, x, wheelR * 2.35, 0));
  }
  return g;
}

/** Medium tank, Sherman-ish: cast turret, sponsons, big 75. */
export function shermanTank(seed = 1, burnt = false) {
  const rng = makeRNG(seed);
  const g = new THREE.Group();
  const paint = burnt ? MAT.charred : MAT.olive;
  const paintDark = burnt ? MAT.black : MAT.oliveDark;

  g.add(runningGear(6.2, 6, 0.52, 0.55, 1.45, burnt ? MAT.charred : MAT.steelDark));

  // hull: sloped glacis via extruded side profile
  const hull = prism([
    [-3.1, 0], [1.9, 0], [3.1, 0.85], [3.1, 1.5], [-3.1, 1.5],
  ], 2.9, paint);
  hull.rotation.y = Math.PI / 2;
  hull.position.y = 0.95;
  g.add(hull);
  g.add(box(3.0, 0.3, 1.0, paintDark, 0, 1.55, 2.2)); // driver plate
  g.add(box(0.8, 0.22, 0.8, paintDark, -0.75, 2.5, 1.6)); // hatches
  g.add(box(0.8, 0.22, 0.8, paintDark, 0.75, 2.5, 1.6));
  g.add(cyl(0.22, 0.22, 0.8, 6, MAT.gunmetal, 0.95, 2.05, 2.75, Math.PI / 2, 0, 0)); // bow MG

  // turret
  const turret = new THREE.Group();
  turret.add(cyl(1.45, 1.6, 1.0, 9, paint, 0, 0.5, 0));
  turret.add(cyl(1.2, 1.4, 0.45, 9, paint, 0, 1.15, 0));
  turret.add(box(1.0, 0.75, 1.1, paint, 0, 0.55, 1.35)); // mantlet housing
  turret.add(cyl(0.34, 0.38, 0.9, 8, MAT.gunmetal, 0, 0.6, 1.9, Math.PI / 2, 0, 0));
  turret.add(cyl(0.17, 0.2, 4.0, 8, MAT.gunmetal, 0, 0.6, 3.7, Math.PI / 2, 0, 0));
  turret.add(cyl(0.24, 0.24, 0.5, 8, MAT.gunmetal, 0, 0.6, 5.6, Math.PI / 2, 0, 0)); // muzzle brake
  turret.add(cyl(0.45, 0.45, 0.28, 8, paintDark, -0.55, 1.5, -0.2)); // commander cupola
  turret.add(cyl(0.12, 0.12, 0.8, 5, MAT.gunmetal, 0.5, 1.7, -0.1)); // AA MG pintle
  turret.add(box(1.2, 0.5, 0.7, MAT.olive, 0, 0.9, -1.5)); // stowage bin
  turret.position.set(0, 2.25, 0.15);
  turret.rotation.y = rng.range(-0.5, 0.5);
  g.add(turret);

  // stowage + markings
  for (let i = 0; i < 4; i++) {
    g.add(box(0.5, 0.35, 0.5, i % 2 ? MAT.wood : MAT.olive, rng.range(-1.2, 1.2), 1.95, rng.range(-2.6, -1.4), 0, rng.range(0, 1), 0));
  }
  g.add(cyl(0.28, 0.28, 0.6, 8, MAT.oliveDark, -1.2, 2.0, -2.9, 0, 0, Math.PI / 2)); // fuel drum
  if (burnt) {
    g.add(box(2.2, 0.2, 2.2, MAT.charred, 0, 2.7, 0, 0.2, 0.4, 0.1));
    for (let i = 0; i < 3; i++) g.add(box(rng.range(0.4, 1.2), 0.15, rng.range(0.4, 1.2), MAT.rust, rng.range(-2, 2), 1.7, rng.range(-2, 2), rng.range(0, 1), rng.range(0, 1), 0));
  }
  return g;
}

/** German medium, Panzer IV-ish: boxy turret, schurzen, long 75. */
export function panzerTank(seed = 2, burnt = false) {
  const rng = makeRNG(seed);
  const g = new THREE.Group();
  const paint = burnt ? MAT.charred : MAT.dirt;
  const paintDark = burnt ? MAT.black : MAT.woodDark;

  g.add(runningGear(6.0, 8, 0.44, 0.5, 1.5, burnt ? MAT.charred : MAT.steelDark));
  const hull = prism([
    [-3.0, 0], [3.0, 0], [3.0, 0.7], [2.1, 1.35], [-3.0, 1.35],
  ], 3.0, paint);
  hull.rotation.y = Math.PI / 2;
  hull.position.y = 1.0;
  g.add(hull);
  g.add(box(3.1, 0.55, 2.2, paint, 0, 2.05, -0.6)); // superstructure
  g.add(box(3.3, 0.12, 5.4, paintDark, 0, 1.72, -0.2)); // deck
  // schurzen side skirts
  for (const s of [-1, 1]) g.add(box(0.08, 0.9, 4.6, MAT.steelDark, s * 1.85, 1.9, -0.3));

  const turret = new THREE.Group();
  turret.add(taperBox(1.35, 1.2, 0.95, 1.5, 1.3, paint));
  turret.add(box(1.0, 0.6, 0.5, paint, 0, 0.5, 1.5));
  turret.add(cyl(0.16, 0.19, 4.6, 8, MAT.gunmetal, 0, 0.5, 3.6, Math.PI / 2, 0, 0));
  turret.add(cyl(0.26, 0.26, 0.7, 8, MAT.gunmetal, 0, 0.5, 5.7, Math.PI / 2, 0, 0));
  turret.add(cyl(0.42, 0.42, 0.35, 8, paintDark, 0, 1.1, -0.7));
  turret.add(box(1.4, 0.45, 0.6, MAT.steelDark, 0, 0.75, -1.5));
  turret.position.set(0, 2.3, -0.4);
  turret.rotation.y = rng.range(-0.6, 0.6);
  g.add(turret);
  for (let i = 0; i < 3; i++) g.add(cyl(0.1, 0.1, 0.55, 6, MAT.steelDark, -1.3, 2.45, -1.6 + i * 0.3, 0.4, 0, 0));
  return g;
}

/** Burnt-out hulk, half buried. */
export function tankWreck(seed = 3) {
  const rng = makeRNG(seed);
  const g = rng.chance(0.5) ? shermanTank(seed, true) : panzerTank(seed, true);
  g.rotation.z = rng.range(-0.12, 0.12);
  g.rotation.x = rng.range(-0.08, 0.08);
  g.position.y = -0.55;
  const wrap = new THREE.Group();
  wrap.add(g);
  // scorch ring + blown-off track links
  wrap.add(cyl(4.6, 4.6, 0.06, 12, MAT.black, 0, 0.04, 0));
  for (let i = 0; i < 6; i++) {
    wrap.add(box(0.5, 0.12, 0.35, MAT.charred, rng.range(-6, 6), 0.1, rng.range(-6, 6), 0, rng.range(0, 3), rng.range(-0.3, 0.3)));
  }
  return wrap;
}

/** Tank dug into an earth revetment, only turret and gun showing. */
export function dugInTank(seed = 4) {
  const g = new THREE.Group();
  const tank = shermanTank(seed);
  tank.position.y = -1.9;
  g.add(tank);
  // earth berm ring
  const rng = makeRNG(seed + 5);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const r = 5.6 + rng.range(-0.4, 0.4);
    g.add(box(rng.range(2.2, 3.2), rng.range(1.0, 1.9), rng.range(1.6, 2.4), MAT.dirt,
      Math.sin(a) * r, rng.range(0.3, 0.7), Math.cos(a) * r, 0, a, rng.range(-0.1, 0.1)));
  }
  return g;
}

/** Burnt supply truck blocking the road. */
export function truckWreck(seed = 6) {
  const rng = makeRNG(seed);
  const g = new THREE.Group();
  const burnt = rng.chance(0.6);
  const paint = burnt ? MAT.charred : MAT.oliveDark;
  g.add(box(2.1, 0.5, 5.6, paint, 0, 0.95, 0));
  g.add(box(2.0, 1.1, 1.6, paint, 0, 1.6, 1.6)); // cab
  g.add(box(1.9, 0.9, 0.12, MAT.glass, 0, 1.9, 2.32));
  g.add(box(1.7, 0.8, 1.3, paint, 0, 1.25, 2.6)); // bonnet
  // cargo bed + hoops
  g.add(box(2.2, 0.5, 3.2, paint, 0, 1.45, -1.2));
  if (!burnt) {
    for (let i = 0; i < 4; i++) {
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.06, 3, 7, Math.PI), MAT.woodDark);
      hoop.position.set(0, 1.7, -2.6 + i * 0.95);
      hoop.rotation.y = Math.PI / 2;
      g.add(hoop);
    }
  }
  for (const s of [-1, 1]) {
    for (const z of [1.8, -0.9, -2.0]) {
      g.add(cyl(0.6, 0.6, 0.42, 9, MAT.tyre, s * 1.05, 0.6, z, 0, 0, Math.PI / 2));
    }
  }
  g.rotation.z = rng.range(-0.15, 0.15);
  if (burnt) {
    g.add(box(2.0, 0.15, 3.0, MAT.charred, 0, 1.75, -1.2, 0.1, 0, 0.05));
    g.add(cyl(3.4, 3.4, 0.05, 10, MAT.black, 0, 0.03, 0));
  }
  return g;
}
