import * as THREE from 'three';
import { MAT } from './materials.js';
import { box, cyl, prism, sandbagGeo, taperBox } from '../util/geo.js';
import { makeRNG } from '../util/mathx.js';

const UP = new THREE.Vector3(0, 1, 0);

/** Angle-iron beam (L section) of `len`, centred, pointing along +Y. */
function angleBeam(len, t = 0.34, mat = MAT.steel) {
  const g = new THREE.Group();
  g.add(box(t, len, t * 0.28, mat, t * 0.36, 0, 0));
  g.add(box(t * 0.28, len, t, mat, 0, 0, t * 0.36));
  return g;
}

/**
 * Czech hedgehog - the "X". Three angle-iron beams bolted through a centre
 * plate, ends splaying to six points. This is the real construction, not a
 * couple of crossed sticks.
 */
export function czechHedgehog(seed = 1) {
  const rng = makeRNG(seed);
  const g = new THREE.Group();
  const dirs = [
    new THREE.Vector3(0.95, 1, 0.34),
    new THREE.Vector3(-0.62, 1, 0.82),
    new THREE.Vector3(-0.42, 1, -0.95),
  ];
  const len = 5.4;
  for (const d of dirs) {
    const beam = angleBeam(len, 0.36, rng.chance(0.3) ? MAT.rust : MAT.steel);
    beam.quaternion.setFromUnitVectors(UP, d.clone().normalize());
    g.add(beam);
  }
  // centre gusset plate + bolts
  g.add(box(1.15, 0.16, 1.15, MAT.steelDark, 0, 0.02, 0, 0.3, 0.6, 0.2));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    g.add(cyl(0.09, 0.09, 0.22, 5, MAT.steelDark, Math.cos(a) * 0.42, 0.12, Math.sin(a) * 0.42));
  }
  // half buried: the model sits with its lower points in the sand
  g.position.y = 1.9;
  const wrap = new THREE.Group();
  wrap.add(g);
  return wrap;
}

/** Concrete dragon's tooth. */
export function dragonTooth(seed = 1) {
  const rng = makeRNG(seed);
  const g = new THREE.Group();
  const h = rng.range(1.5, 2.1);
  const t = taperBox(0.78, 0.34, h, 0.78, 0.34, MAT.concrete);
  t.position.y = 0;
  g.add(t);
  g.add(box(1.9, 0.28, 1.9, MAT.concreteDark, 0, 0.1, 0));
  if (rng.chance(0.35)) g.add(box(0.5, 0.22, 0.5, MAT.concreteDark, rng.range(-0.2, 0.2), h * 0.7, rng.range(-0.2, 0.2), 0.3, 0.5, 0.2));
  return g;
}

/**
 * A barbed wire run along a polyline.
 * kind 'concertina' -> screw pickets + a proper coiled roll with barbs.
 * kind 'low'        -> knee-high straight strands between pickets.
 * Points are {x, y, z} in world space; the returned group is world-space.
 */
export function barbedWireRun(points, kind = 'concertina', seed = 7) {
  const rng = makeRNG(seed);
  const g = new THREE.Group();
  if (points.length < 2) return g;

  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p.x, p.y, p.z)), false, 'catmullrom', 0.2);
  const len = curve.getLength();

  // --- pickets ---
  const postCount = Math.max(2, Math.round(len / 6));
  const postH = kind === 'concertina' ? 1.35 : 1.0;
  for (let i = 0; i <= postCount; i++) {
    const p = curve.getPointAt(i / postCount);
    const post = angleBeam(postH + 0.5, 0.2, MAT.steelDark);
    post.position.set(p.x, p.y + postH * 0.5, p.z);
    post.rotation.set(rng.range(-0.05, 0.05), rng.range(0, 3.14), rng.range(-0.05, 0.05));
    g.add(post);
    // screw picket eye
    const eye = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.035, 3, 6), MAT.steelDark);
    eye.position.set(p.x, p.y + postH + 0.18, p.z);
    eye.rotation.y = rng.range(0, 3.14);
    g.add(eye);
  }

  const barbGeo = new THREE.OctahedronGeometry(0.055, 0);
  const barbs = [];

  if (kind === 'concertina') {
    // helix wound around the centreline -> a real concertina coil
    const radius = 0.8;
    const turns = Math.max(3, Math.round(len / 1.7));
    const perTurn = 8;
    const steps = turns * perTurn;
    const pts = [];
    const tangent = new THREE.Vector3();
    const right = new THREE.Vector3();
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const c = curve.getPointAt(t);
      curve.getTangentAt(t, tangent);
      right.crossVectors(tangent, UP).normalize();
      const a = t * turns * Math.PI * 2;
      const wob = 1 + Math.sin(a * 0.7) * 0.08;
      pts.push(new THREE.Vector3(
        c.x + right.x * Math.cos(a) * radius * wob,
        c.y + radius + Math.sin(a) * radius * 0.92 * wob,
        c.z + right.z * Math.cos(a) * radius * wob,
      ));
      if (i % 3 === 0) barbs.push(pts[pts.length - 1].clone());
    }
    const coil = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.4);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(coil, Math.min(1600, steps), 0.038, 4, false), MAT.steelDark);
    g.add(tube);
  } else {
    for (const h of [0.3, 0.55, 0.8, 1.02]) {
      const pts = [];
      const n = Math.max(6, Math.round(len / 2));
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const c = curve.getPointAt(t);
        const sag = Math.abs(Math.sin(t * n * Math.PI * 0.5)) * 0.13;
        pts.push(new THREE.Vector3(c.x, c.y + h - Math.abs(sag), c.z));
        if (i % 2 === 0) barbs.push(pts[pts.length - 1].clone());
      }
      const strand = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.3);
      g.add(new THREE.Mesh(new THREE.TubeGeometry(strand, Math.min(700, n * 2), 0.026, 3, false), MAT.steelDark));
    }
  }

  // barbs: little 4-point stars clipped onto the wire
  for (const b of barbs) {
    const m = new THREE.Mesh(barbGeo, MAT.steelDark);
    m.position.copy(b);
    m.rotation.set(rng.range(0, 3), rng.range(0, 3), rng.range(0, 3));
    m.scale.set(1, 2.0, 1);
    g.add(m);
  }
  return g;
}

/** Stacked sandbag wall following a world-space polyline of {x,y,z}. */
export function sandbagWallRun(points, height = 3, seed = 3) {
  const rng = makeRNG(seed);
  const g = new THREE.Group();
  if (points.length < 2) return g;
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p.x, p.y, p.z)), false, 'catmullrom', 0.2);
  const len = curve.getLength();
  const bagLen = 1.55;
  const rows = Math.max(2, Math.round(height / 0.55));
  const tangent = new THREE.Vector3();
  const geos = [sandbagGeo(1.55, 0.55, 0.92, 0.07, 11), sandbagGeo(1.5, 0.58, 0.95, 0.09, 29)];
  for (let r = 0; r < rows; r++) {
    const inset = r * 0.055;
    const count = Math.max(2, Math.floor(len / bagLen));
    const stagger = (r % 2) * 0.5;
    for (let i = 0; i < count; i++) {
      const t = Math.min(0.999, (i + stagger) / count);
      const c = curve.getPointAt(t);
      curve.getTangentAt(t, tangent);
      const m = new THREE.Mesh(geos[(i + r) % 2], (i + r) % 2 ? MAT.sandbag : MAT.sandbagAlt);
      m.position.set(c.x, c.y + 0.28 + r * 0.5, c.z);
      m.rotation.y = Math.atan2(tangent.x, tangent.z) + Math.PI / 2 + rng.range(-0.06, 0.06);
      m.rotation.z = rng.range(-0.05, 0.05);
      m.scale.setScalar(1 - inset);
      g.add(m);
    }
  }
  return g;
}

/** Concrete road block / jersey barrier. */
export function concreteBarricade(len = 9, seed = 5) {
  const rng = makeRNG(seed);
  const g = new THREE.Group();
  const profile = [
    [-1.1, 0], [1.1, 0], [0.78, 0.55], [0.5, 1.45], [-0.5, 1.45], [-0.78, 0.55],
  ];
  const body = prism(profile, len, MAT.concrete);
  body.rotation.y = Math.PI / 2;
  g.add(body);
  for (let i = 0; i < 3; i++) {
    g.add(box(0.3, 0.3, 0.3, MAT.concreteDark, rng.range(-len / 2, len / 2), rng.range(0.3, 1.2), rng.range(-0.5, 0.5), rng.range(0, 1), rng.range(0, 1), rng.range(0, 1)));
  }
  // rebar poking out of a chipped end
  g.add(cyl(0.05, 0.05, 1.1, 4, MAT.rust, len / 2 - 0.2, 1.5, 0.1, 0.2, 0, 0.4));
  return g;
}

/** Log barricade on trestles. */
export function logBarricade(len = 8, seed = 5) {
  const rng = makeRNG(seed);
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const log = cyl(0.28, 0.32, len, 6, i % 2 ? MAT.wood : MAT.woodDark, 0, 0.55 + i * 0.52, rng.range(-0.1, 0.1), 0, 0, Math.PI / 2);
    g.add(log);
  }
  for (const s of [-1, 1]) {
    g.add(cyl(0.18, 0.2, 2.6, 5, MAT.woodDark, s * (len / 2 - 0.4), 1.1, 0.7, 0.42, 0, 0));
    g.add(cyl(0.18, 0.2, 2.6, 5, MAT.woodDark, s * (len / 2 - 0.4), 1.1, -0.7, -0.42, 0, 0));
  }
  g.add(box(0.1, 0.1, len, MAT.steelDark, 0, 1.6, 0.35));
  return g;
}

/** Wooden revetment + duckboards dressing a trench cross-section. */
export function trenchDressing(ax, ay, az, bx, by, bz, halfWidth, depth, seed = 2) {
  const rng = makeRNG(seed);
  const g = new THREE.Group();
  const dx = bx - ax;
  const dz = bz - az;
  const len = Math.hypot(dx, dz);
  if (len < 0.5) return g;
  const yaw = Math.atan2(dx, dz);
  const nx = -dz / len;
  const nz = dx / len;
  const mx = (ax + bx) / 2;
  const mz = (az + bz) / 2;
  const my = (ay + by) / 2;

  for (const side of [-1, 1]) {
    const px = mx + nx * halfWidth * side;
    const pz = mz + nz * halfWidth * side;
    // vertical planking
    const planks = Math.max(2, Math.round(len / 1.1));
    for (let i = 0; i < planks; i++) {
      const t = (i + 0.5) / planks - 0.5;
      const plank = box(0.1, depth * 0.95, 0.95, i % 2 ? MAT.wood : MAT.woodDark,
        px + (dx / len) * t * len, my - depth * 0.45 + rng.range(-0.05, 0.05), pz + (dz / len) * t * len);
      plank.rotation.y = yaw;
      g.add(plank);
    }
    // sandbag lip
    const bagCount = Math.max(1, Math.round(len / 1.6));
    for (let i = 0; i < bagCount; i++) {
      const t = (i + 0.5) / bagCount - 0.5;
      const m = new THREE.Mesh(sandbagGeo(1.5, 0.5, 0.9, 0.07, 13 + i), i % 2 ? MAT.sandbag : MAT.sandbagAlt);
      m.position.set(px + (dx / len) * t * len + nx * side * 0.45, my + 0.26, pz + (dz / len) * t * len + nz * side * 0.45);
      m.rotation.y = yaw + Math.PI / 2;
      g.add(m);
    }
  }
  // duckboards on the floor
  const boards = Math.max(2, Math.round(len / 1.5));
  for (let i = 0; i < boards; i++) {
    const t = (i + 0.5) / boards - 0.5;
    const b = box(halfWidth * 1.3, 0.08, 1.15, MAT.woodDark, mx + (dx / len) * t * len, my - depth + 0.1, mz + (dz / len) * t * len);
    b.rotation.y = yaw;
    g.add(b);
  }
  if (rng.chance(0.25)) {
    // ladder out of the trench
    const l = new THREE.Group();
    for (let i = 0; i < 4; i++) l.add(box(0.7, 0.07, 0.07, MAT.wood, 0, -depth + 0.4 + i * 0.75, 0));
    l.add(box(0.07, depth, 0.07, MAT.wood, -0.33, -depth * 0.5 + 0.3, 0));
    l.add(box(0.07, depth, 0.07, MAT.wood, 0.33, -depth * 0.5 + 0.3, 0));
    l.position.set(mx, my, mz);
    l.rotation.y = yaw;
    g.add(l);
  }
  return g;
}

/** Belgian gate (Element C) - the big steel beach frame. */
export function belgianGate() {
  const g = new THREE.Group();
  const w = 3.2;
  const h = 3.0;
  for (const s of [-1, 1]) g.add(box(0.22, h, 0.22, MAT.rust, s * w / 2, h / 2, 0));
  for (let i = 0; i < 4; i++) g.add(box(w, 0.16, 0.16, MAT.rust, 0, 0.3 + i * 0.85, 0));
  g.add(box(w * 1.4, 0.16, 0.16, MAT.rust, 0, h * 0.55, 0, 0, 0, 0.72));
  g.add(box(w * 1.4, 0.16, 0.16, MAT.rust, 0, h * 0.55, 0, 0, 0, -0.72));
  // rollers + braces
  for (const s of [-1, 1]) {
    g.add(cyl(0.22, 0.22, 0.3, 6, MAT.steelDark, s * w / 2, 0.22, 1.4, Math.PI / 2, 0, 0));
    g.add(box(0.16, 0.16, 3.0, MAT.rust, s * w / 2, 1.2, 0.7, -0.5, 0, 0));
  }
  return g;
}

/** Angled log ramp with a Teller mine wired to the top. */
export function rampLog(seed = 1) {
  const g = new THREE.Group();
  const log = cyl(0.26, 0.32, 5.2, 6, MAT.woodDark, 0, 1.15, 0, -0.62, 0, 0);
  g.add(log);
  g.add(cyl(0.2, 0.22, 1.6, 5, MAT.wood, 0, 0.7, -1.1, 0.5, 0, 0));
  const mine = cyl(0.42, 0.44, 0.22, 8, MAT.oliveDark, 0, 2.45, 1.9, -0.62, 0, 0);
  g.add(mine);
  return g;
}

/** Hedgehog stake / Rommel's asparagus. */
export function beachStake(seed = 1) {
  const rng = makeRNG(seed);
  const g = new THREE.Group();
  g.add(cyl(0.16, 0.22, 3.4, 6, MAT.woodDark, 0, 1.4, 0, rng.range(0.2, 0.45), rng.range(0, 3.14), 0));
  if (rng.chance(0.4)) g.add(cyl(0.34, 0.36, 0.2, 8, MAT.oliveDark, 0.55, 2.7, 0, 0.3, 0, 0));
  return g;
}

/** MINEN warning sign. */
export function mineSign() {
  const g = new THREE.Group();
  g.add(cyl(0.07, 0.07, 1.7, 5, MAT.woodDark, 0, 0.85, 0));
  const board = box(1.25, 0.72, 0.06, MAT.white, 0, 1.6, 0);
  g.add(board);
  // crude skull + text blocks (kept as geometry, no textures anywhere)
  g.add(box(0.26, 0.3, 0.03, MAT.black, -0.34, 1.68, 0.05));
  g.add(box(0.07, 0.08, 0.03, MAT.white, -0.41, 1.72, 0.07));
  g.add(box(0.07, 0.08, 0.03, MAT.white, -0.27, 1.72, 0.07));
  for (let i = 0; i < 5; i++) g.add(box(0.1, 0.13, 0.03, MAT.red, -0.02 + i * 0.14, 1.66, 0.05));
  return g;
}
