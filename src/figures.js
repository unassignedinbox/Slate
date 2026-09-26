import * as THREE from 'three';
import { mat, mergeParts } from './materials.js';

let crewGeo = null;

/**
 * Low-poly crewman, built once and shared. Modelled from the thighs up,
 * because that is all that ever clears a parapet or an embrasure.
 */
export function crewGeometry() {
  if (crewGeo) return crewGeo;

  const uniform = [];
  const gear = [];
  const skin = [];
  const push = (list, geo, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const e = new THREE.Euler(rx, ry, rz);
    const q = new THREE.Quaternion().setFromEuler(e);
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      q,
      new THREE.Vector3(1, 1, 1)
    );
    geo.applyMatrix4(m);
    list.push(geo);
  };

  // Torso, hunched slightly forward over the gun.
  push(uniform, new THREE.BoxGeometry(0.46, 0.5, 0.28), 0, -0.02, -0.12, -0.16);
  push(uniform, new THREE.BoxGeometry(0.56, 0.17, 0.3), 0, 0.22, -0.16, -0.16);
  // Hips / thighs, mostly hidden behind sandbags.
  push(uniform, new THREE.BoxGeometry(0.42, 0.3, 0.3), 0, -0.36, -0.14);
  // Arms reaching to the grips.
  push(uniform, new THREE.BoxGeometry(0.14, 0.14, 0.52), -0.27, 0.02, 0.08, 0.34);
  push(uniform, new THREE.BoxGeometry(0.14, 0.14, 0.52), 0.27, 0.02, 0.08, 0.34);
  // Neck + head.
  push(skin, new THREE.BoxGeometry(0.13, 0.1, 0.13), 0, 0.33, -0.15);
  push(skin, new THREE.BoxGeometry(0.19, 0.2, 0.21), 0, 0.45, -0.13);
  // Stahlhelm: shallow dome plus a flare.
  push(
    gear,
    new THREE.SphereGeometry(0.155, 8, 4, 0, Math.PI * 2, 0, Math.PI * 0.55),
    0,
    0.5,
    -0.13
  );
  push(gear, new THREE.CylinderGeometry(0.185, 0.2, 0.05, 8), 0, 0.5, -0.13);
  // Ammo pouches.
  push(gear, new THREE.BoxGeometry(0.4, 0.12, 0.1), 0, -0.14, 0.02, -0.16);

  crewGeo = {
    uniform: mergeParts(uniform),
    gear: mergeParts(gear),
    skin: mergeParts(skin),
  };
  return crewGeo;
}

/**
 * A crewman: gunner, loader or driver. Shares one set of geometry across every
 * figure in the world.
 */
export function createCrewman() {
  const geo = crewGeometry();
  const g = new THREE.Group();
  const body = new THREE.Mesh(geo.uniform, mat(0x545a46, { roughness: 0.95 }));
  const helmet = new THREE.Mesh(geo.gear, mat(0x3b423b, { roughness: 0.8, metalness: 0.25 }));
  const head = new THREE.Mesh(geo.skin, mat(0xa9866a, { roughness: 1 }));
  body.castShadow = true;
  helmet.castShadow = true;
  g.add(body, helmet, head);
  return g;
}

