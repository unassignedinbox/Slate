// props.js — everything placed on the battlefield: the Wall, bunkers, sentry
// turrets, tanks, landing craft, wire, mines, sandbags, barricades, roads dressing
import * as THREE from './vendor/three.module.min.js';
import { TAU, mulberry32, part, mergeGeoms, instMesh, setInst, setInstScale, hideInst, signTexture, hash2 } from './utils.js';
import { S, CFG } from './state.js';
import { H, moundF, trenchNear, roadDist, MOUNDS, TRENCHES, CROSSINGS, WIRES, HEDGEHOGS, ROADS } from './world.js';
import { buildCarMesh } from './car.js';

export function walkPoly(pts, step, fn) {
  let carry = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i][0], az = pts[i][1], bx = pts[i + 1][0], bz = pts[i + 1][1];
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    const ux = dx / len, uz = dz / len;
    let d = carry;
    for (; d < len; d += step) fn(ax + ux * d, az + uz * d, ux, uz);
    carry = d - len;
  }
}

const obstacles = () => S.obstacles;

// ==================================================================
// THE GREAT WALL + wall bunkers + sentries + gate
// ==================================================================
const CONCRETE = 0xa09a90, CONCRETE_D = 0x8b857b, CONCRETE_DD = 0x6f6a61;

export function buildWall() {
  const P = [];
  const y0 = CFG.wallBaseY, top = CFG.wallTopY;
  // two slabs leave the gate opening at x=0
  P.push(part(new THREE.BoxGeometry(165, 16, 5), CONCRETE, { p: [-87.5, y0 + 8, 172.5] }));
  P.push(part(new THREE.BoxGeometry(165, 16, 5), CONCRETE, { p: [87.5, y0 + 8, 172.5] }));
  P.push(part(new THREE.BoxGeometry(11, 8.4, 5), CONCRETE_D, { p: [0, y0 + 12.1, 172.5] })); // lintel over gate
  // buttresses + toe
  for (let x = -156; x <= 156; x += 32) {
    if (Math.abs(x) < 12) continue;
    P.push(part(new THREE.BoxGeometry(2.6, 14.6, 1.7), CONCRETE_D, { p: [x, y0 + 7.3, 169.5] }));
  }
  P.push(part(new THREE.BoxGeometry(340, 1.3, 1.6), CONCRETE_DD, { p: [0, y0 + 0.65, 169.2] }));
  // formwork grooves
  for (const gy of [7.5, 11.5, 15.5]) {
    P.push(part(new THREE.BoxGeometry(330, 0.32, 0.22), CONCRETE_DD, { p: [0, y0 + gy, 169.92] }));
    P.push(part(new THREE.BoxGeometry(330, 0.32, 0.22), CONCRETE_DD, { p: [0, y0 + gy, 175.1] }));
  }
  // crenellations
  for (let x = -168; x <= 168; x += 5.4) {
    if (Math.abs(x) < 11) continue;
    let nearBunker = false;
    for (const bx of SENTRY_XS) if (Math.abs(x - bx) < 6.5) { nearBunker = true; break; }
    if (nearBunker) continue;
    P.push(part(new THREE.BoxGeometry(2.7, 1.1, 0.75), CONCRETE_D, { p: [x, top + 0.55, 168.6] }));
  }
  const wall = new THREE.Mesh(mergeGeoms(P), new THREE.MeshStandardMaterial({
    vertexColors: true, flatShading: true, roughness: 0.96, metalness: 0.02,
  }));
  wall.castShadow = true; wall.receiveShadow = true;
  S.scene.add(wall);

  // ---- gate ----
  const stripes = gateTexture();
  const door = new THREE.Mesh(
    new THREE.BoxGeometry(9.7, 7.6, 0.8),
    new THREE.MeshStandardMaterial({ map: stripes, roughness: 0.7, metalness: 0.35 })
  );
  door.position.set(0, y0 + 3.8, 170.7);
  door.castShadow = true;
  S.scene.add(door);
  const frame = new THREE.Mesh(
    mergeGeoms([
      part(new THREE.BoxGeometry(1.5, 8.6, 2.2), CONCRETE_DD, { p: [-5.6, y0 + 4.3, 170.3] }),
      part(new THREE.BoxGeometry(1.5, 8.6, 2.2), CONCRETE_DD, { p: [5.6, y0 + 4.3, 170.3] }),
      part(new THREE.BoxGeometry(13.4, 1.4, 2.4), CONCRETE_D, { p: [0, y0 + 8.5, 170.3] }),
    ]),
    new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 })
  );
  frame.castShadow = true;
  S.scene.add(frame);
  addSign('GATE 03', null, 0, y0 + 10.4, 169.2, Math.PI, '#c8c3b8', '#3a3128', 2.6, 0.9, false);

  // floodlight pylons beside the gate
  for (const sx of [-12, 12]) {
    const py = new THREE.Mesh(mergeGeoms([
      part(new THREE.CylinderGeometry(0.14, 0.2, 6.4, 8), 0x565b60, { p: [0, 3.2, 0] }),
      part(new THREE.BoxGeometry(0.8, 0.55, 1.0), 0x474c52, { p: [0, 6.5, 0.15], r: [0.35, 0, 0] }),
    ]), new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.8, metalness: 0.4 }));
    py.position.set(sx, y0, 163.5);
    py.castShadow = true;
    S.scene.add(py);
    const lens = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.32, 0.1), new THREE.MeshBasicMaterial({ color: 0xfff2c0 }));
    lens.position.set(sx, y0 + 6.42, 163.5 + 0.62);
    S.scene.add(lens);
  }

  // ---- wall bunkers with sentry turrets ----
  for (const bx of SENTRY_XS) buildWallBunker(bx);
}

const SENTRY_XS = [-140, -75, -30, 30, 90, 145];

function gateTexture() {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 256; c.height = 192;
  const g = c.getContext('2d');
  g.fillStyle = '#5a5f66'; g.fillRect(0, 0, 256, 192);
  g.fillStyle = '#454a50';
  for (let i = 0; i < 6; i++) g.fillRect(0, i * 32 + 24, 256, 5);
  g.save();
  g.beginPath(); g.rect(0, 132, 256, 36); g.clip();
  g.fillStyle = '#c9a53a';
  g.fillRect(0, 132, 256, 36);
  g.fillStyle = '#2c2f33';
  for (let i = -2; i < 10; i++) {
    g.save(); g.translate(i * 40, 132); g.rotate(0.5); g.fillRect(0, -20, 16, 90); g.restore();
  }
  g.restore();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildWallBunker(x) {
  const y0 = CFG.wallBaseY;
  const cy = 11.2;
  const P = [
    part(new THREE.BoxGeometry(9, 4.4, 5.4), CONCRETE, { p: [x, cy, 169.7] }),
    part(new THREE.BoxGeometry(10.2, 0.55, 6.3), CONCRETE_D, { p: [x, cy + 2.45, 169.7] }),
    // embrasure wall (opening 3.6 wide x 1.6 tall at eye level)
    part(new THREE.BoxGeometry(2.7, 4.4, 0.55), CONCRETE_D, { p: [x - 3.15, cy, 167.05] }),
    part(new THREE.BoxGeometry(2.7, 4.4, 0.55), CONCRETE_D, { p: [x + 3.15, cy, 167.05] }),
    part(new THREE.BoxGeometry(3.6, 1.4, 0.55), CONCRETE_D, { p: [x, cy + 1.5, 167.05] }),
    part(new THREE.BoxGeometry(3.6, 1.4, 0.55), CONCRETE_D, { p: [x, cy - 1.5, 167.05] }),
    // dark interior
    part(new THREE.BoxGeometry(3.4, 1.7, 2.6), 0x14161a, { p: [x, cy, 168.0] }),
    // side cheeks
    part(new THREE.BoxGeometry(0.7, 4.4, 3.4), CONCRETE_D, { p: [x - 4.85, cy, 167.3] }),
    part(new THREE.BoxGeometry(0.7, 4.4, 3.4), CONCRETE_D, { p: [x + 4.85, cy, 167.3] }),
  ];
  const m = new THREE.Mesh(mergeGeoms(P), new THREE.MeshStandardMaterial({
    vertexColors: true, flatShading: true, roughness: 0.95,
  }));
  m.castShadow = true; m.receiveShadow = true;
  S.scene.add(m);
  // beacon
  const bc = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), S.beaconMat());
  bc.position.set(x + 4.4, cy + 2.9, 167.4);
  S.scene.add(bc);
  // sandbags across the roof lip
  bagLine(x, 167.5, Math.PI / 2, 8.6, 1, 14.05);
  makeSentry(x, cy - 0.05, 168.35, Math.PI);
}

// forward bunkers dug into two of the great earth mounds
export function buildForwardBunkers() {
  const spots = [[112, 74], [-156, 112]];
  for (const [x, z] of spots) {
    const gy = H(x, z);
    const P = [
      part(new THREE.BoxGeometry(7, 3.4, 6), CONCRETE, { p: [0, 1.3, 0] }),
      part(new THREE.BoxGeometry(8.2, 0.55, 7.1), CONCRETE_D, { p: [0, 3.15, 0] }),
      part(new THREE.BoxGeometry(1.8, 3.4, 0.55), CONCRETE_D, { p: [-2.6, 1.3, -3.05] }),
      part(new THREE.BoxGeometry(1.8, 3.4, 0.55), CONCRETE_D, { p: [2.6, 1.3, -3.05] }),
      part(new THREE.BoxGeometry(3.4, 1.1, 0.55), CONCRETE_D, { p: [0, 2.55, -3.05] }),
      part(new THREE.BoxGeometry(3.4, 1.0, 0.55), CONCRETE_D, { p: [0, 0.4, -3.05] }),
      part(new THREE.BoxGeometry(3.2, 1.5, 2.4), 0x14161a, { p: [0, 1.2, -2.2] }),
      part(new THREE.BoxGeometry(1.1, 2.2, 0.4), 0x2a2e33, { p: [0, 1.1, 3.1] }), // rear door
    ];
    const grp = new THREE.Group();
    grp.position.set(x, gy - 0.35, z);
    const m = new THREE.Mesh(mergeGeoms(P), new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 }));
    m.castShadow = true; m.receiveShadow = true;
    grp.add(m);
    const bc = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), S.beaconMat());
    bc.position.set(3.4, 3.6, -2.4);
    grp.add(bc);
    S.scene.add(grp);
    bagLine(x, z - 3.6, Math.PI / 2, 7.4, 2);
    obstacles().push({ x, z, r: 4.8, type: 'bunker' });
    makeSentry(x, gy + 1.75, z - 0.8, Math.PI);
  }
}

// ------------------------------------------------------------------
// sentry turret (the things that shred vehicles)
// ------------------------------------------------------------------
export function makeSentry(x, y, z, baseYaw) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.55, metalness: 0.55 });
  const base = new THREE.Mesh(mergeGeoms([
    part(new THREE.CylinderGeometry(0.55, 0.75, 0.4, 10), 0x2c3036, { p: [0, 0.2, 0] }),
    part(new THREE.CylinderGeometry(0.3, 0.3, 0.3, 8), 0x23262b, { p: [0, 0.45, 0] }),
  ]), mat);
  const yawNode = new THREE.Group();
  yawNode.position.set(0, 0.55, 0);
  const yoke = new THREE.Mesh(mergeGeoms([
    part(new THREE.BoxGeometry(1.05, 0.5, 0.9), 0x3a3f45, { p: [0, 0.12, -0.05] }),
    part(new THREE.BoxGeometry(0.5, 0.42, 0.75), 0x33373d, { p: [-0.62, 0.02, -0.25] }),
    part(new THREE.BoxGeometry(0.34, 0.1, 0.75), 0xc9a53a, { p: [-0.62, 0.24, -0.25] }),
  ]), mat);
  const pitchNode = new THREE.Group();
  pitchNode.position.set(0, 0.34, 0.42);
  const gun = new THREE.Mesh(mergeGeoms([
    part(new THREE.BoxGeometry(0.58, 0.42, 0.85), 0x33373d, { p: [0, 0, 0.15] }),
    part(new THREE.CylinderGeometry(0.075, 0.075, 1.9, 8), 0x26292e, { p: [-0.17, -0.03, 1.45], r: [Math.PI / 2, 0, 0] }),
    part(new THREE.CylinderGeometry(0.075, 0.075, 1.9, 8), 0x26292e, { p: [0.17, -0.03, 1.45], r: [Math.PI / 2, 0, 0] }),
    part(new THREE.BoxGeometry(0.18, 0.18, 0.34), 0x1d1f23, { p: [-0.17, -0.03, 2.45] }),
    part(new THREE.BoxGeometry(0.18, 0.18, 0.34), 0x1d1f23, { p: [0.17, -0.03, 2.45] }),
    part(new THREE.SphereGeometry(0.18, 8, 6), 0x3f444b, { p: [0, 0.34, -0.25] }),
    part(new THREE.BoxGeometry(0.1, 0.07, 0.1), 0x551111, { p: [0, 0.34, -0.06] }),
  ]), mat);
  pitchNode.add(gun);
  const flash = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.42, 0),
    new THREE.MeshBasicMaterial({ color: 0xffd070, transparent: true, opacity: 0.95 })
  );
  flash.position.set(0, -0.03, 2.6);
  flash.visible = false;
  pitchNode.add(flash);
  yawNode.add(yoke, pitchNode);
  const grp = new THREE.Group();
  grp.position.set(x, y, z);
  grp.rotation.y = baseYaw;
  grp.add(base, yawNode);
  grp.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  S.scene.add(grp);
  S.sentries.push({
    group: grp, yawNode, pitchNode, flash,
    x, y, z, baseYaw, yaw: baseYaw, pitch: 0,
    state: 'sweep', phase: Math.random() * TAU,
    target: null, targetPos: new THREE.Vector3(), losT: Math.random() * 0.3,
    burstLeft: 0, fireT: 0, cd: 1 + Math.random() * 2,
    range: 200, flashT: 0,
  });
}

let _beaconMat = null;
S.beaconMat = () => {
  if (!_beaconMat) _beaconMat = new THREE.MeshBasicMaterial({ color: 0xff2a1a });
  return _beaconMat;
};

// ==================================================================
// TANKS (static — wrecks on the beach, dug-in defenders behind the lines)
// ==================================================================
export function buildTanks() {
  const defs = [
    { x: -30, z: -122, yaw: 0.45, kind: 'wreck', turretYaw: 0.55, smoke: true },
    { x: 42, z: -130, yaw: -0.25, kind: 'wreck', turretYaw: -0.4 },
    { x: -78, z: -108, yaw: 0.9, kind: 'wreck', turretOff: true, smoke: true },
    { x: 10, z: 28, yaw: 2.2, kind: 'wreck', turretOff: true },
    { x: -95, z: 48, yaw: Math.PI + 0.15, kind: 'defense', turretYaw: -0.1 },
    { x: 128, z: 58, yaw: Math.PI - 0.3, kind: 'defense', turretYaw: 0.18 },
    { x: -140, z: 100, yaw: Math.PI + 0.05, kind: 'defense', turretYaw: -0.05 },
  ];
  for (const d of defs) {
    buildTank(d);
    obstacles().push({ x: d.x, z: d.z, r: 3.5, type: 'tank' });
  }
  // sandbag collars for the dug-in defenders
  bagArc(-95, 44.2, 3.6, Math.PI, 2);
  bagArc(128, 54.2, 3.6, Math.PI, 2);
}

function buildTank(d) {
  const wreck = d.kind === 'wreck';
  const hullC = wreck ? 0x3d3b36 : 0x5a6b46;
  const turC = wreck ? 0x37342e : 0x526243;
  const trkC = wreck ? 0x2a2a2a : 0x33363a;
  const whlC = wreck ? 0x33312d : 0x3c4046;
  const barC = wreck ? 0x2f2d29 : 0x474f42;
  const P = [
    part(new THREE.BoxGeometry(3.3, 0.95, 6.2), hullC, { p: [0, 1.02, 0] }),
    part(new THREE.BoxGeometry(3.3, 0.85, 1.9), hullC, { p: [0, 1.22, 2.85], r: [-0.55, 0, 0] }),
    part(new THREE.BoxGeometry(3.3, 0.55, 1.3), hullC, { p: [0, 1.6, -2.55] }),
    part(new THREE.BoxGeometry(0.66, 1.05, 6.7), trkC, { p: [-1.62, 0.58, 0] }),
    part(new THREE.BoxGeometry(0.66, 1.05, 6.7), trkC, { p: [1.62, 0.58, 0] }),
    part(new THREE.BoxGeometry(0.74, 0.1, 6.9), hullC, { p: [-1.62, 1.18, 0] }),
    part(new THREE.BoxGeometry(0.74, 0.1, 6.9), hullC, { p: [1.62, 1.18, 0] }),
  ];
  for (const sz of [2.4, 1.2, 0, -1.2, -2.4]) {
    P.push(part(new THREE.CylinderGeometry(0.45, 0.45, 0.52, 10), whlC, { p: [-1.66, 0.42, sz], r: [0, 0, Math.PI / 2] }));
    P.push(part(new THREE.CylinderGeometry(0.45, 0.45, 0.52, 10), whlC, { p: [1.66, 0.42, sz], r: [0, 0, Math.PI / 2] }));
  }
  if (!d.turretOff) {
    const tP = [
      part(new THREE.BoxGeometry(2.2, 0.72, 2.7), turC, { p: [0, 1.9, -0.2] }),
      part(new THREE.BoxGeometry(1.0, 0.55, 0.6), turC, { p: [0, 1.95, 1.2] }),
      part(new THREE.CylinderGeometry(0.11, 0.13, 3.3, 8), barC, { p: [0, 1.98, 2.9], r: [Math.PI / 2, 0, 0] }),
      part(new THREE.BoxGeometry(0.26, 0.26, 0.42), barC, { p: [0, 1.98, 4.45] }),
      part(new THREE.CylinderGeometry(0.45, 0.45, 0.34, 8), turC, { p: [0, 2.4, -0.7] }),
      part(new THREE.CylinderGeometry(0.02, 0.02, 2.3, 4), 0x222222, { p: [-0.9, 3.1, -1.0] }),
    ];
    const tur = new THREE.Mesh(mergeGeoms(tP), tankMat());
    tur.position.set(0, 0, -0.2);
    tur.rotation.y = d.turretYaw || 0;
    if (wreck && d.turretYaw) tur.rotation.z = 0.06;
    d._turret = tur;
  } else {
    // turret blown off, lying beside the hull
    const tP = [
      part(new THREE.BoxGeometry(2.2, 0.72, 2.7), turC, { p: [0, 0.36, 0] }),
      part(new THREE.BoxGeometry(1.0, 0.55, 0.6), turC, { p: [0, 0.4, 1.2] }),
      part(new THREE.CylinderGeometry(0.11, 0.13, 3.3, 8), barC, { p: [0.5, 0.3, 2.6], r: [Math.PI / 2 - 0.18, 0.5, 0] }),
    ];
    const tur = new THREE.Mesh(mergeGeoms(tP), tankMat());
    const ty = H(d.x + 2.6, d.z + 1.4);
    tur.position.set(d.x + 2.6, ty, d.z + 1.4);
    tur.rotation.y = (d.turretYaw || 0) + 0.8;
    tur.castShadow = true;
    S.scene.add(tur);
  }
  if (!wreck) {
    P.push(part(new THREE.CylinderGeometry(0.4, 0.4, 0.95, 8), 0x6b6f4a, { p: [-0.5, 1.85, -3.15], r: [0, 0, Math.PI / 2] }));
    P.push(part(new THREE.CylinderGeometry(0.4, 0.4, 0.95, 8), 0x6b6f4a, { p: [0.5, 1.85, -3.15], r: [0, 0, Math.PI / 2] }));
    P.push(part(new THREE.BoxGeometry(0.08, 0.5, 0.08), 0x3a3f35, { p: [-1.2, 1.6, 2.7] })); // pioneer tools hint
  }
  const hull = new THREE.Mesh(mergeGeoms(P), tankMat());
  hull.castShadow = true; hull.receiveShadow = true;
  const grp = new THREE.Group();
  grp.position.set(d.x, H(d.x, d.z), d.z);
  grp.rotation.y = d.yaw;
  grp.add(hull);
  if (d._turret) { d._turret.castShadow = true; grp.add(d._turret); }
  if (wreck) grp.rotation.z = (hash2(d.x, d.z) - 0.5) * 0.05;
  S.scene.add(grp);
  if (d.smoke) addSmokeSpot(d.x, H(d.x, d.z) + 2.4, d.z, 0.55);
}

let _tankMat = null;
function tankMat() {
  if (!_tankMat) _tankMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9, metalness: 0.25 });
  return _tankMat;
}

// ==================================================================
// LANDING CRAFT (spawn cover)
// ==================================================================
export function buildLandingCraft() {
  const x = 4, z = -158, gy = H(x, z);
  const P = [
    part(new THREE.BoxGeometry(6.4, 0.55, 12.5), 0x474340, { p: [0, 0.3, 0] }),
    part(new THREE.BoxGeometry(0.55, 2.7, 12.5), 0x504a45, { p: [-3.2, 1.35, 0] }),
    part(new THREE.BoxGeometry(0.55, 2.7, 12.5), 0x504a45, { p: [3.2, 1.35, 0] }),
    part(new THREE.BoxGeometry(6.4, 2.7, 0.55), 0x4a453f, { p: [0, 1.35, -6.2] }),
    part(new THREE.BoxGeometry(0.55, 2.7, 0.6), 0x4a453f, { p: [-3.2, 1.35, 6.2] }),
    part(new THREE.BoxGeometry(0.55, 2.7, 0.6), 0x4a453f, { p: [3.2, 1.35, 6.2] }),
    part(new THREE.BoxGeometry(6.2, 0.24, 4.8), 0x56504a, { p: [0, 1.75, 8.35], r: [0.3, 0, 0] }),
  ];
  for (let i = -2; i <= 2; i++) {
    P.push(part(new THREE.BoxGeometry(0.16, 2.2, 0.4), 0x3a3733, { p: [-2.85, 1.2, i * 2.4] }));
    P.push(part(new THREE.BoxGeometry(0.16, 2.2, 0.4), 0x3a3733, { p: [2.85, 1.2, i * 2.4] }));
  }
  for (let i = -2; i <= 2; i++) {
    P.push(part(new THREE.BoxGeometry(5.6, 0.1, 1.5), 0x443e38, { p: [0, 0.62, i * 2.4] }));
  }
  const grp = new THREE.Group();
  grp.position.set(x, gy, z);
  grp.rotation.y = 0.08;
  const m = new THREE.Mesh(mergeGeoms(P), new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 }));
  m.castShadow = true; m.receiveShadow = true;
  grp.add(m);
  S.scene.add(grp);
  obstacles().push({ x, z, r: 5.4, type: 'craft' });
  obstacles().push({ x: x + 1.2, z: z + 8.5, r: 3.4, type: 'craft' });
  addSmokeSpot(x - 1.6, gy + 2.6, z - 3, 0.5);
}

// ==================================================================
// BEACH BARRICADES: hedgehogs, jersey barriers, dragon teeth
// ==================================================================
export function buildHedgehogs() {
  const geo = mergeGeoms([
    part(new THREE.BoxGeometry(0.17, 2.75, 0.17), 0x6e4a30, { dir: [1, 1, 0] }),
    part(new THREE.BoxGeometry(0.17, 2.75, 0.17), 0x5c4028, { dir: [-0.5, 1, 0.866] }),
    part(new THREE.BoxGeometry(0.17, 2.75, 0.17), 0x74543a, { dir: [-0.5, 1, -0.866] }),
  ]);
  const im = instMesh([geo], HEDGEHOGS.length, { roughness: 0.85, metalness: 0.3 });
  HEDGEHOGS.forEach((h, i) => {
    setInst(im, i, h[0], H(h[0], h[1]) + 0.78, h[1], h[2], (hash2(h[0], h[1]) - 0.5) * 0.2, (hash2(h[1], h[0]) - 0.5) * 0.2);
    obstacles().push({ x: h[0], z: h[1], r: 1.05, type: 'hedgehog' });
  });
  S.scene.add(im);
}

export function buildBarriers() {
  // jersey barriers (extruded profile, instanced)
  const shape = new THREE.Shape();
  shape.moveTo(-1.0, 0); shape.lineTo(-0.95, 0.18); shape.lineTo(-0.3, 0.74);
  shape.lineTo(0.3, 0.74); shape.lineTo(0.95, 0.18); shape.lineTo(1.0, 0);
  shape.closePath();
  const geo = part(new THREE.ExtrudeGeometry(shape, { depth: 2.3, bevelEnabled: false }), 0xa8a49b);
  const defs = [
    [-66, -84, 0.1], [-53, -86, -0.08], [49, -84, 0.06], [62, -86, -0.1],
    [-10, 142, 0.35], [10, 142, -0.35], [-17, 149, 0.25], [17, 149, -0.25],
    [-9, 156, 0.3], [9, 156, -0.3],
    [-60, -22, 0.12], [55, 34, -0.1], [-28, 88, 0.2], [68, 102, -0.15],
  ];
  const im = instMesh([geo], defs.length, { roughness: 0.95 });
  defs.forEach((b, i) => {
    setInst(im, i, b[0], H(b[0], b[1]), b[1], b[2] + Math.PI / 2);
    obstacles().push({ x: b[0], z: b[1], r: 1.5, type: 'barrier' });
  });
  S.scene.add(im);

  // dragon teeth row
  const tooth = part(new THREE.CylinderGeometry(0.42, 0.88, 1.3, 4, 1), 0x94908a, { r: [0, Math.PI / 4, 0] });
  const teeth = [];
  for (let x = -162; x <= 162; x += 4.4) {
    if (roadDist(x, 132) < 4.6) continue;
    if (moundF(x, 132) > 0.2) continue;
    teeth.push(x);
  }
  const imT = instMesh([tooth], teeth.length, { roughness: 0.98 });
  teeth.forEach((x, i) => {
    const sc = 0.85 + hash2(x, 132) * 0.3;
    setInstScale(imT, i, x, H(x, 132), 132, hash2(x, 7) * TAU, sc, sc * (0.9 + hash2(x, 3) * 0.25), sc);
    obstacles().push({ x, z: 132, r: 1.0, type: 'teeth' });
  });
  S.scene.add(imT);
}

// ==================================================================
// MINES — tank mines (pressure plates for vehicles) + AP mines
// ==================================================================
export function buildMines() {
  // ---- tank mines ----
  const tmGeo = mergeGeoms([
    part(new THREE.CylinderGeometry(0.55, 0.62, 0.17, 12), 0x4c5538, { p: [0, 0.085, 0] }),
    part(new THREE.TorusGeometry(0.44, 0.05, 4, 14), 0xc9a53a, { p: [0, 0.16, 0], r: [Math.PI / 2, 0, 0] }),
    part(new THREE.CylinderGeometry(0.035, 0.035, 0.16, 6), 0x3a4230, { p: [0.24, 0.2, 0] }),
    part(new THREE.CylinderGeometry(0.035, 0.035, 0.16, 6), 0x3a4230, { p: [-0.12, 0.2, 0.21] }),
    part(new THREE.CylinderGeometry(0.035, 0.035, 0.16, 6), 0x3a4230, { p: [-0.12, 0.2, -0.21] }),
  ]);
  const list = [];
  // mined roads
  const roadMines = [
    [-60, -25], [-60, -3], [-61, 19], [-59, 41], [-58, 63], [-56, 85], [-53, 107],
    [55, -25], [55, -3], [56, 19], [57, 41], [58, 63], [56, 85], [52, 107],
  ];
  for (const r of roadMines) list.push(r);
  // the field belt
  const rng = mulberry32(90210);
  let guard = 0;
  while (list.length < 58 && guard++ < 900) {
    const x = -158 + rng() * 316;
    const z = -36 + rng() * 38;
    if (trenchNear(x, z) < 8) continue;
    if (roadDist(x, z) < 3) continue;
    if (moundF(x, z) > 0.5) continue;
    let ok = true;
    for (const m of list) if (Math.hypot(x - m[0], z - m[1]) < 4.2) { ok = false; break; }
    if (!ok) continue;
    list.push([x, z]);
  }
  // gate approach
  list.push([-13, 146], [13, 146], [-15, 156], [15, 156], [0, 151]);
  const im = instMesh([tmGeo], list.length, { castShadow: false });
  list.forEach((m, i) => {
    setInst(im, i, m[0], H(m[0], m[1]) + 0.02, m[1], rng() * TAU);
    S.tankMines.push({ x: m[0], z: m[1], alive: true, i });
  });
  S.tankMineMesh = im;
  S.scene.add(im);

  // ---- AP mines ----
  const apGeo = mergeGeoms([
    part(new THREE.SphereGeometry(0.21, 8, 5, 0, TAU, 0, Math.PI / 2), 0x40482f, { p: [0, 0.02, 0] }),
    part(new THREE.CylinderGeometry(0.16, 0.2, 0.07, 8), 0x333a26, { p: [0, 0.03, 0] }),
    part(new THREE.BoxGeometry(0.03, 0.14, 0.03), 0x2c3222, { p: [0.1, 0.12, 0] }),
  ]);
  const blinkGeo = part(new THREE.SphereGeometry(0.05, 6, 4), 0xffffff, { p: [0, 0.13, 0.1] });
  const aps = [];
  const rng2 = mulberry32(555);
  const pushCluster = (cx, cz, r, n) => {
    let g = 0;
    while (n > 0 && g++ < 80) {
      const a = rng2() * TAU, rr = rng2() * r;
      const x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr;
      let ok = true;
      for (const m of aps) if (Math.hypot(x - m[0], z - m[1]) < 1.4) { ok = false; break; }
      if (!ok) continue;
      aps.push([x, z]); n--;
    }
  };
  pushCluster(0, -86, 7, 8);       // centre wire gap
  pushCluster(0, -53, 4, 3);       // trench crossing
  pushCluster(-60, -51.5, 3, 2);
  pushCluster(55, -53, 3, 2);
  pushCluster(-44, 128, 4, 3);     // dragon teeth gaps
  pushCluster(47, 128, 4, 3);
  let g2 = 0;
  while (aps.length < 38 && g2++ < 500) {
    const x = -150 + rng2() * 300, z = -30 + rng2() * 160;
    if (roadDist(x, z) < 2.5) continue;
    if (trenchNear(x, z) < 3.5) continue;
    if (moundF(x, z) > 0.4) continue;
    let ok = true;
    for (const m of aps) if (Math.hypot(x - m[0], z - m[1]) < 3.5) { ok = false; break; }
    if (!ok) continue;
    aps.push([x, z]);
  }
  const imA = instMesh([apGeo], aps.length, { castShadow: false });
  S.apBlinkMat = new THREE.MeshBasicMaterial({ color: 0xff3020 });
  const imB = new THREE.InstancedMesh(blinkGeo, S.apBlinkMat, aps.length);
  aps.forEach((m, i) => {
    const y = H(m[0], m[1]);
    setInst(imA, i, m[0], y, m[1], rng2() * TAU);
    setInst(imB, i, m[0], y, m[1], rng2() * TAU);
    S.apMines.push({ x: m[0], z: m[1], alive: true, i });
  });
  S.apMineMesh = imA; S.apBlinkMesh = imB;
  S.scene.add(imA, imB);
}

// ==================================================================
// BARBED WIRE — belts of screw pickets, wire lines and concertina coils
// ==================================================================
export function buildWire() {
  let segId = 0;
  for (const belt of WIRES) {
    // collect post positions
    const posts = [];
    walkPoly(belt.pts, 2.6, (x, z, ux, uz) => posts.push([x, z, ux, uz]));
    const postGeo = mergeGeoms([
      part(new THREE.BoxGeometry(0.09, 1.32, 0.09), 0x5d6b70, { p: [0, 0.66, 0] }),
      part(new THREE.BoxGeometry(0.06, 0.06, 0.52), 0x525f64, { p: [0, 0.34, 0.1], r: [0, 0.5, 0] }),
      part(new THREE.BoxGeometry(0.06, 0.06, 0.52), 0x525f64, { p: [0, 0.7, -0.08], r: [0, 1.6, 0] }),
      part(new THREE.BoxGeometry(0.06, 0.06, 0.52), 0x525f64, { p: [0, 1.06, 0.06], r: [0, 2.6, 0] }),
    ]);
    const imPost = instMesh([postGeo], posts.length, { castShadow: false, roughness: 0.6, metalness: 0.5 });
    const coilGeo = part(new THREE.TorusGeometry(0.5, 0.05, 4, 12), 0x4a5257, { r: [Math.PI / 2, 0, 0] });
    const imCoil = instMesh([coilGeo], Math.max(1, posts.length - 1), { castShadow: false, roughness: 0.6, metalness: 0.5 });
    const wireMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.6, metalness: 0.4 });
    const chunks = [];
    for (let i = 0; i < posts.length - 1; i += 4) {
      const end = Math.min(i + 4, posts.length - 1);
      const P = [];
      const segs = [];
      for (let k = i; k < end; k++) {
        const a = posts[k], b = posts[k + 1];
        const dx = b[0] - a[0], dz = b[1] - a[1];
        const len = Math.hypot(dx, dz);
        const yaw = Math.atan2(dx, dz);
        const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
        const gy = (H(a[0], a[1]) + H(b[0], b[1])) / 2;
        for (const h of [0.35, 0.72, 1.08]) {
          P.push(part(new THREE.BoxGeometry(0.045, 0.045, len), 0x3f464b, { p: [mx, gy + h, mz], r: [0, yaw, 0] }));
        }
        segs.push({ ax: a[0], az: a[1], bx: b[0], bz: b[1], id: segId++ });
      }
      const mesh = new THREE.Mesh(mergeGeoms(P), wireMat);
      S.scene.add(mesh);
      const postIds = [], coilIds = [];
      for (let k = i; k <= end; k++) if (!postIds.includes(k)) postIds.push(k);
      for (let k = i; k < end; k++) coilIds.push(k);
      const chunk = { mesh, postIds, coilIds, segs, destroyed: false };
      segs.forEach((sg) => { sg.chunk = chunk; S.wireSegs.push(sg); });
      chunks.push(chunk);
    }
    // place instances
    posts.forEach((p, idx) => {
      setInst(imPost, idx, p[0], H(p[0], p[1]), p[1], Math.atan2(p[2], p[3]) + Math.PI / 2);
      if (idx < posts.length - 1) {
        const b = posts[idx + 1];
        setInstScale(imCoil, idx, (p[0] + b[0]) / 2, (H(p[0], p[1]) + H(b[0], b[1])) / 2 + 1.34, (p[1] + b[1]) / 2,
          Math.atan2(b[0] - p[0], b[1] - p[1]), 1, 0.5, 1);
      }
    });
    S.scene.add(imPost, imCoil);
    S.wires.push({ imPost, imCoil, chunks });
  }
}

export function destroyWireChunk(chunk) {
  if (chunk.destroyed) return;
  chunk.destroyed = true;
  chunk.mesh.visible = false;
  const belt = S.wires.find((w) => w.chunks.includes(chunk));
  if (belt) {
    for (const id of chunk.postIds) hideInst(belt.imPost, id);
    for (const id of chunk.coilIds) hideInst(belt.imCoil, id);
  }
  for (const sg of chunk.segs) {
    const i = S.wireSegs.indexOf(sg);
    if (i >= 0) S.wireSegs.splice(i, 1);
  }
}

// ==================================================================
// SANDBAGS (instanced) + MG nests + trench furniture + bridges
// ==================================================================
const BAGS = [];
export function bagLine(x, z, yaw, len, rows, yAbs) {
  const ux = Math.sin(yaw), uz = Math.cos(yaw);
  const n = Math.max(2, Math.round(len / 0.64));
  for (let row = 0; row < rows; row++) {
    const off = (row % 2) * 0.32;
    for (let i = 0; i < n - (row % 2); i++) {
      const t = (i + 0.5) / n - 0.5 + off / len;
      const bx = x + ux * t * len;
      const bz = z + uz * t * len;
      const by = yAbs !== undefined ? yAbs + row * 0.26 : H(bx, bz) + 0.13 + row * 0.26;
      BAGS.push([bx, by, bz, yaw + (hash2(bx, bz) - 0.5) * 0.2, 0.92 + hash2(bz, bx) * 0.16]);
    }
  }
}
export function bagArc(cx, cz, r, facing, rows) {
  const arc = 2.4;
  const n = Math.max(4, Math.round((r * arc) / 0.64));
  for (let row = 0; row < rows; row++) {
    for (let i = 0; i < n; i++) {
      const a = facing - arc / 2 + (arc * (i + (row % 2) * 0.5)) / n;
      const bx = cx + Math.sin(a) * r, bz = cz + Math.cos(a) * r;
      BAGS.push([bx, H(bx, bz) + 0.13 + row * 0.26, bz, a + Math.PI / 2 + (hash2(bx, bz) - 0.5) * 0.25, 0.92 + hash2(bz, bx) * 0.16]);
    }
  }
}

function buildSandbagMesh() {
  const geo = part(new THREE.SphereGeometry(0.5, 7, 5), 0xffffff, { s: [0.79, 0.31, 0.48] });
  const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ flatShading: true, roughness: 1 }), BAGS.length);
  const col = new THREE.Color();
  const tones = [0xc2ad84, 0xb5a077, 0xcab692];
  BAGS.forEach((b, i) => {
    setInstScale(im, i, b[0], b[1], b[2], b[3], b[4], b[4], b[4]);
    col.set(tones[i % 3]).multiplyScalar(0.94 + hash2(b[0], b[1]) * 0.12);
    im.setColorAt(i, col);
  });
  im.castShadow = true; im.receiveShadow = true;
  if (im.instanceColor) im.instanceColor.needsUpdate = true;
  S.scene.add(im);
}

function buildNests() {
  const nests = [
    [-95, -54, Math.PI], [30, -57, Math.PI],
    [-70, 33.4, Math.PI], [10, 33.6, Math.PI],
    [-55, 119.6, Math.PI], [70, 117.4, Math.PI],
  ];
  const P = [];
  for (const [x, z, yaw] of nests) {
    bagArc(x, z, 1.9, yaw, 2);
    const gy = H(x, z);
    // MG prop on plinth
    const g = new THREE.Group();
    g.position.set(x, gy, z);
    g.rotation.y = yaw;
    const mg = new THREE.Mesh(mergeGeoms([
      part(new THREE.BoxGeometry(1.3, 0.5, 1.3), 0x6a5c44, { p: [0, 0.25, 0] }),
      part(new THREE.BoxGeometry(0.24, 0.26, 0.95), 0x363b3d, { p: [0, 0.85, 0] }),
      part(new THREE.CylinderGeometry(0.05, 0.05, 0.95, 6), 0x2c3033, { p: [0, 0.88, 0.85], r: [Math.PI / 2, 0, 0] }),
      part(new THREE.BoxGeometry(0.6, 0.42, 0.05), 0x3d4247, { p: [0, 1.0, 0.5] }),
      part(new THREE.BoxGeometry(0.07, 0.6, 0.07), 0x2c3033, { p: [0.22, 0.55, 0], r: [0, 0, 0.4] }),
      part(new THREE.BoxGeometry(0.07, 0.6, 0.07), 0x2c3033, { p: [-0.22, 0.55, 0], r: [0, 0, -0.4] }),
      part(new THREE.BoxGeometry(0.07, 0.6, 0.07), 0x2c3033, { p: [0, 0.55, -0.28], r: [0.5, 0, 0] }),
      part(new THREE.BoxGeometry(0.34, 0.2, 0.3), 0x50565b, { p: [-0.35, 0.78, -0.4] }),
    ]), new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.8, metalness: 0.3 }));
    mg.castShadow = true;
    g.add(mg);
    S.scene.add(g);
    // ammo crates
    P.push(part(new THREE.BoxGeometry(0.7, 0.45, 0.5), 0x6d5e42, { p: [x + 1.6, gy + 0.22, z + 0.4], r: [0, 0.6, 0] }));
    P.push(part(new THREE.BoxGeometry(0.6, 0.4, 0.55), 0x7a6a4c, { p: [x - 1.7, gy + 0.2, z - 0.5], r: [0, -0.4, 0] }));
  }
  if (P.length) {
    const m = new THREE.Mesh(mergeGeoms(P), new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 }));
    m.castShadow = true;
    S.scene.add(m);
  }
}

function buildTrenchFurniture() {
  const P = [];
  for (const tr of TRENCHES) {
    let dist = 0;
    walkPoly(tr.pts, 1.3, (x, z, ux, uz) => {
      const fy = H(x, z);
      P.push(part(new THREE.BoxGeometry(0.78, 0.07, 1.18), hash2(x, z) > 0.5 ? 0x8a6f4e : 0x7d654a, {
        p: [x, fy + 0.05, z], r: [0, Math.atan2(ux, uz), 0],
      }));
      dist += 1.3;
      if (Math.floor(dist / 1.3) % 2 === 0) {
        for (const side of [-1, 1]) {
          const px = x + uz * side * 1.75, pz = z - ux * side * 1.75;
          P.push(part(new THREE.BoxGeometry(0.16, 1.25, 0.36), 0x6e5a40, {
            p: [px, H(px, pz) + 0.5, pz], r: [0, Math.atan2(ux, uz), side * 0.1],
          }));
        }
      }
    });
  }
  // plank bridges at the vehicle crossings
  for (const c of CROSSINGS) {
    const gy = H(c[0], c[1]);
    P.push(part(new THREE.BoxGeometry(5.4, 0.18, 4.2), 0x84683f, { p: [c[0], gy + 0.1, c[1]] }));
    P.push(part(new THREE.BoxGeometry(5.4, 0.1, 0.14), 0x6e5a40, { p: [c[0], gy + 0.55, c[1] - 1.9] }));
    P.push(part(new THREE.BoxGeometry(5.4, 0.1, 0.14), 0x6e5a40, { p: [c[0], gy + 0.55, c[1] + 1.9] }));
    for (const sx of [-2.5, 2.5]) {
      P.push(part(new THREE.BoxGeometry(0.16, 0.62, 0.16), 0x6e5a40, { p: [c[0] + sx, gy + 0.34, c[1] - 1.9] }));
      P.push(part(new THREE.BoxGeometry(0.16, 0.62, 0.16), 0x6e5a40, { p: [c[0] + sx, gy + 0.34, c[1] + 1.9] }));
    }
  }
  const m = new THREE.Mesh(mergeGeoms(P), new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }));
  m.receiveShadow = true;
  S.scene.add(m);
}

// ==================================================================
// SIGNS, CRATES, FLAGS, WRECKED CARS
// ==================================================================
function addSign(l1, l2, x, y, z, yaw, bg, fg, w = 1.15, h = 0.8, skull = true) {
  const tex = signTexture(l1, l2, { bg, fg, skull });
  const grp = new THREE.Group();
  grp.position.set(x, y, z);
  grp.rotation.y = yaw;
  const post = new THREE.Mesh(
    mergeGeoms([part(new THREE.BoxGeometry(0.09, 1.7, 0.09), 0x6e5a40, { p: [0, -0.75, 0] })]),
    new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true })
  );
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, 0.06),
    tex ? new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }) : new THREE.MeshStandardMaterial({ color: 0xc9b98c })
  );
  post.castShadow = true; board.castShadow = true;
  grp.add(post, board);
  S.scene.add(grp);
}

function buildSignsAndCrateClusters() {
  const signPos = [
    [-24, -42], [24, -40], [-80, -2], [80, -2], [-52, -46], [48, -44], [-44, 122], [46, 121],
  ];
  for (const [x, z] of signPos) {
    addSign('DANGER', 'MINES', x, H(x, z) + 1.35, z, Math.PI + (hash2(x, z) - 0.5) * 0.3, '#c9b98c', '#8a1c12');
  }
  // crate & barrel clusters
  const rng = mulberry32(31337);
  const P = [];
  const clusters = [
    [-92, -50], [34, -55], [-66, 30], [14, 34], [88, 32], [-48, 120], [75, 118],
    [-58, -90], [58, -88], [-6, 145], [22, 150],
  ];
  for (const [cx, cz] of clusters) {
    const n = 2 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
      const ox = (rng() - 0.5) * 3.4, oz = (rng() - 0.5) * 3.4;
      const x = cx + ox, z = cz + oz;
      const gy = H(x, z);
      if (rng() > 0.45) {
        P.push(part(new THREE.BoxGeometry(0.9, 0.55, 0.62), rng() > 0.5 ? 0x7a6a4c : 0x6d5e42, { p: [x, gy + 0.28, z], r: [0, rng() * TAU, 0] }));
        P.push(part(new THREE.BoxGeometry(0.94, 0.1, 0.66), 0x54482f, { p: [x, gy + 0.4, z], r: [0, rng() * TAU, 0] }));
        obstacles().push({ x, z, r: 0.8, type: 'crate' });
      } else {
        P.push(part(new THREE.CylinderGeometry(0.36, 0.36, 0.92, 10), rng() > 0.5 ? 0x5d6b46 : 0x6e4a30, { p: [x, gy + 0.46, z] }));
        obstacles().push({ x, z, r: 0.6, type: 'crate' });
      }
    }
  }
  const m = new THREE.Mesh(mergeGeoms(P), new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 }));
  m.castShadow = true; m.receiveShadow = true;
  S.scene.add(m);
}

function buildFlags() {
  const P = [];
  for (const fx of [-120, 120]) {
    P.push(part(new THREE.CylinderGeometry(0.07, 0.09, 5.2, 6), 0x8b8578, { p: [fx, CFG.wallTopY + 2.6, 170.5] }));
    P.push(part(new THREE.BoxGeometry(3.0, 1.7, 0.06), 0x8a2f28, { p: [fx - 1.55, CFG.wallTopY + 4.6, 170.5], r: [0, 0.06, 0] }));
    P.push(part(new THREE.BoxGeometry(1.1, 0.7, 0.08), 0xc9b98c, { p: [fx - 1.0, CFG.wallTopY + 4.6, 170.56] }));
  }
  const m = new THREE.Mesh(mergeGeoms(P), new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9, side: THREE.DoubleSide }));
  m.castShadow = true;
  S.scene.add(m);
}

function buildWreckedCars() {
  const defs = [
    { x: -38, z: -66, yaw: 1.2 }, { x: 35, z: 118, yaw: 2.8 },
  ];
  for (const d of defs) {
    const car = buildCarMesh(0x4a4038, true);
    car.group.position.set(d.x, H(d.x, d.z), d.z);
    car.group.rotation.y = d.yaw;
    S.scene.add(car.group);
    obstacles().push({ x: d.x, z: d.z, r: 1.7, type: 'carwreck' });
  }
}

// ==================================================================
// smoke columns for burning wrecks
// ==================================================================
export function addSmokeSpot(x, y, z, rate) {
  if (!S.smokeSpots) S.smokeSpots = [];
  S.smokeSpots.push({ x, y, z, rate, t: 0 });
}

// ==================================================================
export function buildProps() {
  buildWall();
  buildForwardBunkers();
  buildTanks();
  buildLandingCraft();
  buildHedgehogs();
  buildBarriers();
  buildMines();
  buildWire();
  buildNests();
  buildTrenchFurniture();
  buildSignsAndCrateClusters();
  buildFlags();
  buildWreckedCars();
  buildSandbagMesh();
}
