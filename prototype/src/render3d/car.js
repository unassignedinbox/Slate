// Procedural race car. Placeholder geometry until licensed glTF models arrive
// (docs/HMI_DESIGN.md §7). Suspension, wings and tyre colour are driven by state.
import * as THREE from 'three';
import { heatHex } from '../ui/heat.js';

export const CORNERS = ['FL', 'FR', 'RL', 'RR'];
const POS = {
  FL: { x: -0.82, z: 1.7, sx: -1, front: true },
  FR: { x: 0.82, z: 1.7, sx: 1, front: true },
  RL: { x: -0.82, z: -1.6, sx: -1, front: false },
  RR: { x: 0.82, z: -1.6, sx: 1, front: false },
};
const WHEEL_R = 0.34;
const BODY_Y = 0.42;
const UP = new THREE.Vector3(0, 1, 0);
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// Stretch a unit cylinder between two points (local space).
function setBeam(mesh, a, b) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = Math.max(dir.length(), 1e-4);
  mesh.position.addVectors(a, b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(UP, dir.normalize());
  mesh.scale.set(1, len, 1);
}
const beam = (mat, r) => new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1, 8), mat);

export function buildCar({ livery = '#1B5E3A', accent = '#E10600' } = {}) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const mats = {
    body: new THREE.MeshStandardMaterial({ color: livery, metalness: 0.5, roughness: 0.3 }),
    carbon: new THREE.MeshStandardMaterial({ color: 0x17191d, metalness: 0.2, roughness: 0.5 }),
    accent: new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.2, metalness: 0.2, roughness: 0.4 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 0.8, roughness: 0.3 }),
    rim: new THREE.MeshStandardMaterial({ color: 0xc9ccd2, metalness: 0.9, roughness: 0.22 }),
  };
  const add = (geo, mat, x, y, z, parent = body) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };

  // Bodywork
  add(new THREE.BoxGeometry(0.55, 0.2, 1.5), mats.body, 0, 0.46, 1.85);      // nose
  add(new THREE.BoxGeometry(0.6, 0.34, 1.5), mats.body, 0, 0.6, 0.2);        // tub
  add(new THREE.BoxGeometry(0.42, 0.12, 0.8), mats.carbon, 0, 0.82, 0.15);   // cockpit cover
  add(new THREE.BoxGeometry(0.22, 0.18, 0.2), mats.carbon, 0, 0.9, -0.12);   // headrest
  add(new THREE.CylinderGeometry(0.12, 0.3, 1.4, 12), mats.body, 0, 0.85, -1.05).rotation.x = Math.PI / 2;
  add(new THREE.BoxGeometry(0.46, 0.32, 1.4), mats.body, -0.46, 0.5, 0);     // sidepods
  add(new THREE.BoxGeometry(0.46, 0.32, 1.4), mats.body, 0.46, 0.5, 0);
  add(new THREE.BoxGeometry(1.1, 0.05, 4.3), mats.carbon, 0, 0.26, 0);       // floor

  // Wings: pivot groups so angles follow the aero settings
  const frontWing = new THREE.Group();
  frontWing.position.set(0, 0.24, 2.65);
  body.add(frontWing);
  add(new THREE.BoxGeometry(1.9, 0.03, 0.42), mats.carbon, 0, 0, 0, frontWing);
  add(new THREE.BoxGeometry(0.03, 0.22, 0.5), mats.accent, -0.95, 0.04, 0, frontWing);
  add(new THREE.BoxGeometry(0.03, 0.22, 0.5), mats.accent, 0.95, 0.04, 0, frontWing);

  const rearWing = new THREE.Group();
  rearWing.position.set(0, 1.12, -2.0);
  body.add(rearWing);
  add(new THREE.BoxGeometry(1.5, 0.03, 0.36), mats.carbon, 0, 0, 0, rearWing);
  add(new THREE.BoxGeometry(1.5, 0.03, 0.18), mats.accent, 0, 0.12, -0.1, rearWing);
  add(new THREE.BoxGeometry(0.04, 0.4, 0.06), mats.carbon, -0.5, -0.2, 0, rearWing);
  add(new THREE.BoxGeometry(0.04, 0.4, 0.06), mats.carbon, 0.5, -0.2, 0, rearWing);

  // Corners: wheel + rim + suspension linkage. Group Y = wheel centre (moves with travel).
  const corners = {};
  for (const id of CORNERS) {
    const p = POS[id];
    const group = new THREE.Group();
    group.position.set(p.x, WHEEL_R, p.z);
    root.add(group);

    const tyreMat = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.85 });
    const tyre = new THREE.Mesh(new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.3, 32), tyreMat);
    tyre.rotation.z = Math.PI / 2;
    group.add(tyre);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.32, 24), mats.rim);
    rim.rotation.z = Math.PI / 2;
    group.add(rim);

    const upper = beam(mats.steel, 0.025), lower = beam(mats.steel, 0.025);
    const spring = beam(mats.accent, 0.03), damper = beam(mats.carbon, 0.018);
    group.add(upper, lower, spring, damper);
    corners[id] = { p, group, tyreMat, upper, lower, spring, damper };
  }

  // travelMm: { FL, FR, RL, RR } compression in mm (45 = nominal)
  function update(travelMm) {
    for (const id of CORNERS) {
      const c = corners[id], p = c.p;
      const wy = WHEEL_R + ((travelMm[id] ?? 45) - 45) / 1000 * 0.9;
      c.group.position.y = wy;
      const mx = p.sx * 0.35 - p.x;          // inboard chassis mount, corner space
      const mz = (p.front ? 0.9 : -0.9) - p.z;
      const by = BODY_Y - wy;
      setBeam(c.upper, V(mx, by + 0.14, mz), V(0, 0.12, 0));
      setBeam(c.lower, V(mx, by - 0.14, mz), V(0, -0.12, 0));
      setBeam(c.spring, V(mx * 0.9, 0.62 - wy, mz * 0.9), V(0, 0.3, 0));
      setBeam(c.damper, V(mx * 0.9 + 0.04 * p.sx, 0.5 - wy, mz * 0.9), V(0, -0.02, 0));
    }
  }

  return {
    root,
    corners,
    update,
    setWings(front, rear) {
      frontWing.rotation.x = (-front * Math.PI) / 180 * 0.6;
      rearWing.rotation.x = (-rear * Math.PI) / 180 * 0.6;
    },
    setLivery(hex) { mats.body.color.set(hex); },
    setAccent(hex) { mats.accent.color.set(hex); mats.accent.emissive.set(hex); },
    setTyreTemps(temps) {
      for (const id of CORNERS) {
        const m = corners[id].tyreMat;
        m.emissive.set(heatHex(temps[id] ?? 80));
        m.emissiveIntensity = 0.35;
      }
    },
    setBodyOpacity(a) {
      for (const m of [mats.body, mats.carbon]) {
        m.transparent = a < 1;
        m.opacity = a;
        m.depthWrite = a >= 1;
      }
    },
  };
}

// Single tyre for the Tyres app: three tread zones (inner / mid / outer) coloured by temperature.
export function buildTyre() {
  const root = new THREE.Group();
  const rubber = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.36, 64), rubber);
  body.rotation.z = Math.PI / 2;
  root.add(body);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.38, 48),
    new THREE.MeshStandardMaterial({ color: 0xc9ccd2, metalness: 0.9, roughness: 0.22 }));
  rim.rotation.z = Math.PI / 2;
  root.add(rim);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.42, 16),
    new THREE.MeshStandardMaterial({ color: 0x888d96, metalness: 1, roughness: 0.3 }));
  hub.rotation.z = Math.PI / 2;
  root.add(hub);

  const zones = ['inner', 'mid', 'outer'].map((k, i) => {
    const mat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x000000, emissiveIntensity: 0.35, roughness: 0.55 });
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.505, 0.505, 0.11, 64, 1, true), mat);
    m.rotation.z = Math.PI / 2;
    m.position.x = (i - 1) * 0.12;
    root.add(m);
    return { k, mat };
  });

  return {
    root,
    setTemps(t) {
      for (const z of zones) {
        const hex = heatHex(t[z.k]);
        z.mat.color.set(hex);
        z.mat.emissive.set(hex);
      }
    },
  };
}
