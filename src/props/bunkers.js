import * as THREE from 'three';
import { MAT } from './materials.js';
import { box, cyl, sandbagGeo, taperBox } from '../util/geo.js';
import { makeRNG } from '../util/mathx.js';

// ---------------------------------------------------------------------------
// Defensive works. Every sentry sits in one of these; the embrasure position
// is published as `userData.mount` so the MG turret lines up inside the slot.
// Local space: +Z is the direction the position faces (down-range).
// ---------------------------------------------------------------------------

function chippedConcrete(g, rng, w, h, d, n = 4) {
  for (let i = 0; i < n; i++) {
    g.add(box(
      rng.range(0.3, 0.9), rng.range(0.2, 0.5), rng.range(0.3, 0.8), MAT.concreteDark,
      rng.range(-w / 2, w / 2), rng.range(0.4, h), d / 2 * rng.sign() + rng.range(-0.1, 0.1),
      rng.range(0, 1), rng.range(0, 1), rng.range(0, 1),
    ));
  }
}

/** Standard MG pillbox: sloped front, deep embrasure, thick roof slab. */
export function mgBunker(seed = 1) {
  const rng = makeRNG(seed);
  const g = new THREE.Group();
  const w = 8.2, h = 3.3, d = 6.4;

  // body: tapered so the front face slopes back (shot deflection)
  const body = taperBox(w / 2, w / 2 - 0.5, h, d / 2, d / 2 - 0.4, MAT.concrete);
  g.add(body);

  // embrasure: front wall is built in pieces around a 3.2 x 0.9 slot
  const slotW = 3.4, slotH = 0.95, slotY = 1.95;
  const fz = d / 2 - 0.15;
  g.add(box((w - slotW) / 2 - 0.2, h, 0.7, MAT.concrete, -(slotW + w) / 4 + 0.1, h / 2, fz));
  g.add(box((w - slotW) / 2 - 0.2, h, 0.7, MAT.concrete, (slotW + w) / 4 - 0.1, h / 2, fz));
  g.add(box(slotW, h - slotY - slotH / 2, 0.7, MAT.concrete, 0, (h + slotY + slotH / 2) / 2, fz));
  g.add(box(slotW, slotY - slotH / 2, 0.7, MAT.concrete, 0, (slotY - slotH / 2) / 2, fz));
  // splayed cheeks inside the slot
  g.add(box(0.5, slotH, 1.1, MAT.concreteDark, -slotW / 2 + 0.2, slotY, fz - 0.6, 0, 0.2, 0));
  g.add(box(0.5, slotH, 1.1, MAT.concreteDark, slotW / 2 - 0.2, slotY, fz - 0.6, 0, -0.2, 0));
  g.add(box(slotW, 0.35, 1.2, MAT.concreteDark, 0, slotY + slotH / 2 + 0.1, fz - 0.5));

  // roof slab with overhang + anti-grenade lip
  g.add(box(w + 1.0, 0.65, d + 1.0, MAT.concreteDark, 0, h + 0.3, -0.1));
  g.add(box(w + 1.2, 0.4, 0.5, MAT.concrete, 0, h + 0.8, d / 2 + 0.3));
  // rear entrance with blast wall
  g.add(box(2.0, 2.2, 0.5, MAT.black, 0, 1.1, -d / 2 - 0.1));
  g.add(box(0.6, 2.6, 3.2, MAT.concrete, 1.9, 1.3, -d / 2 - 1.4));
  // periscope + vent
  g.add(cyl(0.16, 0.16, 0.9, 6, MAT.steelDark, -2.4, h + 0.9, -1.2));
  g.add(cyl(0.3, 0.34, 0.5, 6, MAT.steelDark, 2.6, h + 0.85, -1.6));
  chippedConcrete(g, rng, w, h, d, 5);

  // camouflage: earth and scrub heaped on the roof
  for (let i = 0; i < 7; i++) {
    g.add(box(rng.range(1, 2.4), rng.range(0.3, 0.7), rng.range(1, 2.2), MAT.dirt,
      rng.range(-w / 2, w / 2), h + 0.75, rng.range(-d / 2, d / 4), 0, rng.range(0, 1.5), 0));
  }
  g.userData.mount = new THREE.Vector3(0, slotY, fz - 0.9);
  g.userData.muzzleClear = 1.4;
  return g;
}

/** Big casemate: gun port plus an MG embrasure on the shoulder. */
export function casemate(seed = 2) {
  const rng = makeRNG(seed);
  const g = new THREE.Group();
  const w = 13, h = 5.2, d = 10;
  g.add(taperBox(w / 2, w / 2 - 1.0, h, d / 2, d / 2 - 0.8, MAT.concrete));

  const slotW = 5.0, slotH = 1.7, slotY = 2.9;
  const fz = d / 2 - 0.3;
  g.add(box((w - slotW) / 2 - 0.4, h, 1.0, MAT.concrete, -(slotW + w) / 4 + 0.2, h / 2, fz));
  g.add(box((w - slotW) / 2 - 0.4, h, 1.0, MAT.concrete, (slotW + w) / 4 - 0.2, h / 2, fz));
  g.add(box(slotW, h - slotY - slotH / 2, 1.0, MAT.concrete, 0, (h + slotY + slotH / 2) / 2, fz));
  g.add(box(slotW, slotY - slotH / 2, 1.0, MAT.concrete, 0, (slotY - slotH / 2) / 2, fz));

  // the naval gun inside, static
  g.add(cyl(0.9, 1.0, 1.2, 8, MAT.gunmetal, 0, slotY, fz - 1.4, Math.PI / 2, 0, 0));
  g.add(cyl(0.26, 0.3, 7.2, 8, MAT.gunmetal, 0, slotY, fz + 2.6, Math.PI / 2, 0, 0));
  g.add(cyl(0.38, 0.38, 0.9, 8, MAT.steelDark, 0, slotY, fz + 5.9, Math.PI / 2, 0, 0));

  // wing wall against enfilade + roof
  g.add(box(1.0, h + 0.6, d * 0.8, MAT.concrete, -w / 2 - 0.3, (h + 0.6) / 2, 0.6));
  g.add(box(w + 1.6, 0.9, d + 1.6, MAT.concreteDark, 0, h + 0.45, -0.2));
  g.add(box(2.2, 2.4, 0.6, MAT.black, -2, 1.2, -d / 2 - 0.2));
  g.add(box(0.7, 3.0, 4.0, MAT.concrete, 1.6, 1.5, -d / 2 - 2.0));
  // shoulder MG embrasure
  g.add(box(2.0, 1.2, 0.6, MAT.concreteDark, w / 2 - 1.6, 3.4, fz + 0.2));
  chippedConcrete(g, rng, w, h, d, 7);
  for (let i = 0; i < 9; i++) {
    g.add(box(rng.range(1.2, 3), rng.range(0.3, 0.8), rng.range(1.2, 2.6), MAT.dirt,
      rng.range(-w / 2, w / 2), h + 1.0, rng.range(-d / 2, d / 4), 0, rng.range(0, 1.5), 0));
  }
  g.userData.mount = new THREE.Vector3(w / 2 - 1.6, 3.6, fz + 0.5);
  g.userData.muzzleClear = 1.2;
  return g;
}

/** Open sandbagged MG nest with overhead timber. */
export function mgNest(seed = 3) {
  const rng = makeRNG(seed);
  const g = new THREE.Group();
  const bagGeo = [sandbagGeo(1.55, 0.55, 0.9, 0.07, 5), sandbagGeo(1.5, 0.58, 0.95, 0.09, 17)];
  const R = 4.2;
  for (let row = 0; row < 4; row++) {
    const count = 15;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + row * 0.12;
      // leave the rear open as an entrance
      if (a > Math.PI * 1.15 && a < Math.PI * 1.5) continue;
      const r = R - row * 0.08;
      const m = new THREE.Mesh(bagGeo[(i + row) % 2], (i + row) % 2 ? MAT.sandbag : MAT.sandbagAlt);
      m.position.set(Math.sin(a) * r, 0.28 + row * 0.5, Math.cos(a) * r);
      m.rotation.y = a;
      m.rotation.z = rng.range(-0.05, 0.05);
      g.add(m);
    }
  }
  // firing step + timber overhead cover at the back
  g.add(cyl(R - 0.3, R - 0.3, 0.3, 12, MAT.dirt, 0, 0.15, 0));
  g.add(box(0.9, 0.5, 2.4, MAT.woodDark, 0, 0.55, -1.2));
  for (const s of [-1, 1]) g.add(cyl(0.16, 0.16, 2.4, 5, MAT.woodDark, s * 2.0, 1.2, -3.0));
  g.add(box(4.6, 0.22, 2.2, MAT.woodDark, 0, 2.4, -3.2));
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(bagGeo[i % 2], MAT.sandbagAlt);
    m.position.set(-1.8 + i * 0.75, 2.7, -3.2);
    g.add(m);
  }
  g.add(box(0.7, 0.4, 0.45, MAT.olive, 1.6, 0.45, -2.2, 0, 0.3, 0));
  g.add(box(0.7, 0.4, 0.45, MAT.olive, 2.2, 0.45, -1.6, 0, 0.9, 0));
  g.userData.mount = new THREE.Vector3(0, 1.75, R - 1.2);
  g.userData.muzzleClear = 1.0;
  return g;
}

/** Tower position built into the great wall. */
export function wallTower(height = 22) {
  const g = new THREE.Group();
  const w = 13, d = 12;
  g.add(taperBox(w / 2, w / 2 - 0.4, height, d / 2, d / 2 - 0.4, MAT.concrete));
  g.add(box(w + 1.4, 1.0, d + 1.4, MAT.concreteDark, 0, height + 0.5, 0));
  // embrasures on three faces
  const slotY = height - 2.2;
  for (const [ox, oz, ry] of [[0, d / 2, 0], [-w / 2, 0, Math.PI / 2], [w / 2, 0, -Math.PI / 2]]) {
    const slot = box(3.2, 0.95, 0.5, MAT.black, ox, slotY, oz);
    slot.rotation.y = ry;
    g.add(slot);
  }
  // parapet + searchlight
  g.add(box(1.8, 1.6, 1.8, MAT.concreteDark, 0, height + 1.6, 0));
  g.add(cyl(0.9, 0.9, 0.5, 10, MAT.steelDark, 0, height + 2.6, 0.6, Math.PI / 2, 0, 0));
  g.add(cyl(0.82, 0.82, 0.12, 10, MAT.lamp, 0, height + 2.6, 0.92, Math.PI / 2, 0, 0));
  g.userData.mount = new THREE.Vector3(0, slotY, d / 2 - 0.3);
  g.userData.muzzleClear = 1.1;
  return g;
}

/**
 * THE WALL.
 *
 * 44 m of reinforced concrete right across the map with exactly one gate -
 * the finish line. The crest is dead level (it is a built structure) while
 * every panel, buttress and counterfort is founded on the ground beneath it,
 * so the wall never floats and the gate always opens at road level.
 *
 * @param {function} groundAt (x) -> ground height relative to the wall origin
 */
export function greatWall(spec, groundAt = () => 0) {
  const g = new THREE.Group();
  const { halfWidth, height, gateWidth } = spec;
  const thick = 10;
  const gateH = 15;
  const rng = makeRNG(99);

  // --- main slab, built in chunks that follow the ground -------------------
  const CH = 22;
  for (let x = -halfWidth; x < halfWidth; x += CH) {
    const x0 = x;
    const x1 = Math.min(halfWidth, x + CH);
    const cx = (x0 + x1) / 2;
    if (Math.abs(cx) < gateWidth / 2 + 1) continue;    // the gate
    const foot = Math.min(groundAt(x0), groundAt(x1)) - 4;
    const h = height - foot;
    const panel = taperBox((x1 - x0) / 2 + 0.05, (x1 - x0) / 2 + 0.05, h, thick / 2, thick / 2 - 1.4, MAT.concrete);
    panel.position.set(cx, foot, 0);
    g.add(panel);
  }

  // --- the gate ------------------------------------------------------------
  const gateFoot = groundAt(0);
  g.add(box(gateWidth + 4.4, height - gateH - gateFoot, thick - 1, MAT.concrete, 0, gateFoot + gateH + (height - gateH - gateFoot) / 2, 0));
  for (const s of [-1, 1]) {
    g.add(box(2.6, gateH, thick + 1.6, MAT.concreteDark, s * (gateWidth / 2 + 1.3), gateFoot + gateH / 2, 0));
    // steel gate leaf, swung open against the face
    const leaf = new THREE.Group();
    for (let i = 0; i < 7; i++) leaf.add(box(0.35, gateH - 2.0, 0.6, MAT.rust, 0, (gateH - 2.0) / 2, -3 + i * 1.0));
    leaf.add(box(0.5, 0.7, 7, MAT.rust, 0, gateH - 2.2, 0));
    leaf.add(box(0.5, 0.7, 7, MAT.rust, 0, 0.5, 0));
    leaf.position.set(s * (gateWidth / 2 + 2.0), gateFoot, thick / 2 + 3.4);
    leaf.rotation.y = s * 1.15;
    g.add(leaf);
    // gate lamp
    g.add(box(0.7, 0.5, 0.5, MAT.steelDark, s * (gateWidth / 2 + 1.3), gateFoot + gateH + 1.2, thick / 2 + 0.4));
  }

  // --- buttresses and counterforts ----------------------------------------
  for (let x = -halfWidth + 12; x <= halfWidth - 12; x += 26) {
    if (Math.abs(x) < gateWidth / 2 + 8) continue;
    const foot = groundAt(x) - 2.5;
    const bh = (height - foot) * 0.84;
    const b = taperBox(2.6, 1.5, bh, 3.4, 1.3, MAT.concreteDark);
    b.position.set(x, foot, thick / 2 + 1.6);
    g.add(b);
    g.add(box(2.8, bh * 0.7, 5, MAT.concreteDark, x, foot + bh * 0.35, -thick / 2 - 2.4));
  }

  // --- level crest: walkway, parapets, crenellations ------------------------
  g.add(box(halfWidth * 2, 1.2, thick + 4.5, MAT.concreteDark, 0, height + 0.6, -1));
  for (const s of [-1, 1]) {
    g.add(box(halfWidth * 2, 2.4, 1.0, MAT.concrete, 0, height + 2.4, s * (thick / 2 + 1.4)));
  }
  for (let x = -halfWidth + 4; x < halfWidth; x += 7) {
    g.add(box(3.4, 1.5, 1.2, MAT.concrete, x, height + 4.3, thick / 2 + 1.4));
  }

  // --- weathering: staining, shell scars, and a few hits that went deep -----
  for (let i = 0; i < 110; i++) {
    const x = rng.range(-halfWidth, halfWidth);
    if (Math.abs(x) < gateWidth / 2 + 3) continue;
    const gy = groundAt(x);
    g.add(box(rng.range(1.5, 5), rng.range(0.8, 3.0), 0.5, MAT.concreteDark, x, rng.range(gy + 1, height - 1), thick / 2 - 0.1));
  }
  for (let i = 0; i < 30; i++) {
    const x = rng.range(-halfWidth, halfWidth);
    if (Math.abs(x) < gateWidth / 2 + 5) continue;
    const gy = groundAt(x);
    g.add(box(rng.range(1, 3), rng.range(1, 3), 0.8, MAT.concreteDark, x, rng.range(gy + 3, height - 3), thick / 2 - 0.2, 0, 0, rng.range(0, 1.5)));
  }

  // --- apron slab in front, following the ground ---------------------------
  for (let x = -halfWidth; x < halfWidth; x += CH) {
    const cx = x + CH / 2;
    if (Math.abs(cx) < gateWidth / 2 + 1) continue;
    g.add(box(CH + 0.4, 0.7, 11, MAT.concreteDark, cx, groundAt(cx) + 0.25, thick / 2 + 6.5));
  }
  return g;
}
