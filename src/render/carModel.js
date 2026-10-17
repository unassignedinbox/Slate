// The player car: Frontier Project-Drive's ControlVehicle shell (public/assets/
// control-vehicle.json, authored in metres, +X fwd / +Y left / +Z up) converted with
// a proper rotation into car space (+Z fwd, +Y up, +X left). The shell has no
// separate wheel meshes, so four simple wheels are added at the physics wheel
// positions - they spin, steer and follow the suspension.
import * as THREE from 'three';
import { CAR } from '../core/vehicle.js';

const FAMILY = {
  6: { color: 0x4f7268, metalness: 0.45, roughness: 0.32 },  // body paint
  7: { color: 0x1b2329, metalness: 0.25, roughness: 0.08 },  // glass
  8: { color: 0x26292c, metalness: 0.0, roughness: 0.75 },   // plastic / trim
  9: { color: 0x17181a, metalness: 0.0, roughness: 0.92 },   // rubber seals
  12: { color: 0x9aa0a6, metalness: 0.4, roughness: 0.45 },  // bright trim
  13: { color: 0xf1efe6, metalness: 0.0, roughness: 0.3, emissive: 0x5a5850 }, // headlights
  14: { color: 0x7e2a24, metalness: 0.0, roughness: 0.35, emissive: 0x2a0806 }, // tail lights
  15: { color: 0xd6d5cf, metalness: 0.0, roughness: 0.7 },   // plates
};

export async function loadCarModel(url, envMap = null) {
  let data = null;
  try { data = await (await fetch(url)).json(); } catch (e) { console.warn('car mesh missing, using proxy', e); }
  return buildCarModel(data, envMap);
}

export function buildCarModel(data, envMap = null) {
  const group = new THREE.Group();
  const body = new THREE.Group(); // gets visual roll/pitch
  group.add(body);
  if (data) {
    const P = data.positions, T = data.triangles, Fm = data.families;
    const buckets = {};
    for (let t = 0; t < Fm.length; t++) (buckets[Fm[t]] ??= []).push(t);
    for (const [fam, tris] of Object.entries(buckets)) {
      const idx = new Map(), verts = [], index = [];
      for (const t of tris) for (let k = 0; k < 3; k++) {
        const vi = T[t * 3 + k];
        if (!idx.has(vi)) { idx.set(vi, verts.length / 3); verts.push(P[vi * 3 + 1], P[vi * 3 + 2], P[vi * 3]); } // (y, z, x): proper rotation
        index.push(idx.get(vi));
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      g.setIndex(index);
      g.computeVertexNormals();
      const spec = FAMILY[fam] || FAMILY[8];
      const m = new THREE.MeshStandardMaterial({ color: spec.color, metalness: spec.metalness, roughness: spec.roughness, emissive: spec.emissive ?? 0x000000, emissiveIntensity: spec.emissive ? 1 : 0, envMap, envMapIntensity: 0.9 });
      const mesh = new THREE.Mesh(g, m);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      body.add(mesh);
    }
  } else {
    const m = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.1, 6.0), new THREE.MeshStandardMaterial({ color: FAMILY[6].color }));
    m.position.y = 0.6; m.castShadow = true;
    body.add(m);
  }
  // wheels
  const tyreMat = new THREE.MeshStandardMaterial({ color: 0x1a1b1d, roughness: 0.9 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x8c9196, metalness: 0.6, roughness: 0.4, envMap, envMapIntensity: 0.8 });
  const tyreGeo = new THREE.CylinderGeometry(CAR.wheelRadius, CAR.wheelRadius, 0.34, 20);
  tyreGeo.rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(CAR.wheelRadius * 0.62, CAR.wheelRadius * 0.62, 0.36, 10);
  rimGeo.rotateZ(Math.PI / 2);
  const spokeGeo = new THREE.BoxGeometry(0.37, CAR.wheelRadius * 1.1, 0.07);
  const wheels = CAR.wheelPos.map(([x, y, z]) => {
    const pivot = new THREE.Group(); // steering
    pivot.position.set(x, y, z);
    const spin = new THREE.Group();
    const tyre = new THREE.Mesh(tyreGeo, tyreMat); tyre.castShadow = true;
    const rim = new THREE.Mesh(rimGeo, rimMat);
    const sp1 = new THREE.Mesh(spokeGeo, rimMat), sp2 = new THREE.Mesh(spokeGeo, rimMat);
    sp2.rotation.x = Math.PI / 2;
    spin.add(tyre, rim, sp1, sp2);
    pivot.add(spin);
    group.add(pivot);
    return { pivot, spin, base: new THREE.Vector3(x, y, z) };
  });
  const roll = { r: 0, p: 0 };
  return {
    group, body, wheels,
    /** Sync with physics. pos/quat interpolated; car supplies wheel state. */
    update(pos, quat, car, dt) {
      group.position.copy(pos);
      group.quaternion.copy(quat);
      // visual body lean from tyre forces (does not affect physics)
      const tr = THREE.MathUtils.clamp(car.latAcc * 0.0055, -0.05, 0.05);
      const tp = THREE.MathUtils.clamp(-car.lonAcc * 0.0035, -0.035, 0.035);
      const k = Math.min(1, dt * 8);
      roll.r += (tr - roll.r) * k; roll.p += (tp - roll.p) * k;
      body.rotation.set(roll.p, 0, roll.r);
      const steerAng = -car.steer * (CAR.steerHigh + (CAR.steerLow - CAR.steerHigh) * Math.exp(-Math.abs(car.speed) / (CAR.steerFade * 0.45)));
      for (let i = 0; i < 4; i++) {
        const w = car.wheels[i], v = wheels[i];
        const sag = CAR.travel - CAR.gravity / (4 * CAR.springK);
        v.pivot.position.set(v.base.x, v.base.y + sag + w.offset, v.base.z);
        v.pivot.rotation.y = w.front ? steerAng : 0;
        v.spin.rotation.x = w.spin;
      }
    },
  };
}
