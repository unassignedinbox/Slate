import * as THREE from 'three';
import { mat, buildLoft, mergeParts } from './materials.js';
import { COLORS } from './config.js';
import { Rng } from './util.js';

/** Hull cross section with chamfered upper corners. */
function hullSection(z, w, yb, yt, chamfer = 0.34) {
  return {
    z,
    pts: [
      [-w, yb],
      [w, yb],
      [w, yt - chamfer],
      [w - chamfer, yt],
      [-(w - chamfer), yt],
      [-w, yt - chamfer],
    ],
  };
}

function trackGeometry(side) {
  const prof = (yb, yt) => [
    [-0.34, yb],
    [0.34, yb],
    [0.34, yt],
    [-0.34, yt],
  ];
  const g = buildLoft([
    { z: -3.55, pts: prof(0.48, 1.0) },
    { z: -3.0, pts: prof(0.06, 1.05) },
    { z: 2.95, pts: prof(0.06, 1.05) },
    { z: 3.5, pts: prof(0.48, 1.0) },
  ]);
  g.translate(side * 1.33, 0, 0);
  return g;
}

function turretGeometry() {
  const hex = (r, squash = 0.82) => {
    const pts = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      pts.push([Math.cos(a) * r * squash, Math.sin(a) * r]);
    }
    return pts;
  };
  // Lofted along +Z then laid flat so the turret is a squat octagonal drum.
  const g = buildLoft([
    { z: 0, pts: hex(1.28) },
    { z: 0.52, pts: hex(1.24) },
    { z: 0.86, pts: hex(1.02) },
  ]);
  g.rotateX(-Math.PI / 2);
  return g;
}

export function createTank(variant = 'intact', rng = new Rng(7)) {
  const g = new THREE.Group();
  const burnt = variant === 'burnt' || variant === 'noturret';
  const bodyColor = burnt ? COLORS.burnt : rng.chance(0.5) ? COLORS.olive : COLORS.oliveDark;
  const bodyMat = mat(bodyColor, { roughness: burnt ? 1.0 : 0.92, metalness: 0.18 });
  const trackMat = mat(burnt ? 0x232221 : 0x35322e, { roughness: 1 });
  const detailMat = mat(burnt ? 0x1f1e1d : 0x3f452f, { roughness: 0.95 });

  /* hull */
  const hull = new THREE.Mesh(
    buildLoft([
      hullSection(3.35, 1.18, 0.62, 1.12, 0.22),
      hullSection(2.55, 1.42, 0.52, 1.52),
      hullSection(1.2, 1.5, 0.5, 1.62),
      hullSection(-1.6, 1.5, 0.5, 1.62),
      hullSection(-2.9, 1.42, 0.52, 1.5),
      hullSection(-3.35, 1.2, 0.6, 1.3, 0.22),
    ]),
    bodyMat
  );
  hull.castShadow = true;
  hull.receiveShadow = true;
  g.add(hull);

  /* tracks + running gear */
  const trackParts = [trackGeometry(-1), trackGeometry(1)];
  for (const side of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      const wheel = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 9);
      wheel.rotateZ(Math.PI / 2);
      wheel.translate(side * 1.33, 0.42, -2.4 + i * 0.96);
      trackParts.push(wheel);
    }
    const sprocket = new THREE.CylinderGeometry(0.46, 0.46, 0.32, 9);
    sprocket.rotateZ(Math.PI / 2);
    sprocket.translate(side * 1.33, 0.62, 3.0);
    trackParts.push(sprocket);
    const idler = sprocket.clone();
    idler.translate(0, 0, -6.05);
    trackParts.push(idler);
  }
  const tracks = new THREE.Mesh(mergeParts(trackParts), trackMat);
  tracks.castShadow = true;
  tracks.receiveShadow = true;
  g.add(tracks);

  /* fenders + stowage */
  const stowParts = [];
  for (const side of [-1, 1]) {
    const fender = new THREE.BoxGeometry(0.8, 0.1, 5.6);
    fender.translate(side * 1.62, 1.1, -0.2);
    stowParts.push(fender);
    for (let i = 0; i < 2; i++) {
      const box = new THREE.BoxGeometry(0.62, 0.42, 0.9);
      box.translate(side * 1.6, 1.34, -1.4 - i * 1.1);
      stowParts.push(box);
    }
  }
  // Spare track links bolted on the glacis.
  for (let i = 0; i < 4; i++) {
    const link = new THREE.BoxGeometry(0.42, 0.1, 0.3);
    link.translate(-0.7 + i * 0.46, 1.25, 2.75);
    stowParts.push(link);
  }
  const stow = new THREE.Mesh(mergeParts(stowParts), detailMat);
  stow.castShadow = true;
  g.add(stow);

  /* turret */
  const turret = new THREE.Group();
  const drum = new THREE.Mesh(turretGeometry(), bodyMat);
  drum.castShadow = true;
  turret.add(drum);

  const mantlet = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.62, 0.5), bodyMat);
  mantlet.position.set(0, 0.42, 1.15);
  turret.add(mantlet);

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 3.5, 9), bodyMat);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.44, 2.9);
  barrel.castShadow = true;
  turret.add(barrel);
  const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.36, 9), detailMat);
  muzzle.rotation.x = Math.PI / 2;
  muzzle.position.set(0, 0.44, 4.5);
  turret.add(muzzle);

  const cupola = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.44, 0.34, 9), bodyMat);
  cupola.position.set(-0.35, 1.0, -0.35);
  turret.add(cupola);
  const hatch = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.08, 9), detailMat);
  hatch.position.set(-0.35, 1.2, -0.62);
  hatch.rotation.x = -1.0;
  turret.add(hatch);

  const mg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.9, 6), detailMat);
  mg.rotation.x = Math.PI / 2 - 0.1;
  mg.position.set(0.5, 1.12, 0.1);
  turret.add(mg);

  turret.position.set(0, 1.58, 0.15);

  if (variant === 'noturret') {
    // Blown clean off and lying upside-down in the sand beside the hull.
    turret.position.set(rng.float(-5.5, -3.5), 0.5, rng.float(-2, 2));
    turret.rotation.set(Math.PI * 0.86, rng.float(0, Math.PI), 0.35);
  } else if (burnt) {
    turret.rotation.y = rng.float(-1.1, 1.1);
    barrel.rotation.x = Math.PI / 2 - 0.22;
  } else {
    turret.rotation.y = rng.float(-0.5, 0.5);
  }
  g.add(turret);
  g.userData.turret = turret;
  g.userData.burnt = burnt;
  return g;
}

const TANK_SPOTS = [
  { x: -96, z: 168, v: 'sunk', yaw: 0.6 },
  { x: 62, z: 196, v: 'burnt', yaw: -0.9 },
  { x: 152, z: 176, v: 'intact', yaw: 2.4 },
  { x: -178, z: 150, v: 'intact', yaw: 1.1 },
  { x: -18, z: 128, v: 'noturret', yaw: 0.2 },
  { x: 108, z: 110, v: 'burnt', yaw: 1.9 },
  { x: -136, z: 62, v: 'intact', yaw: -0.4 },
  { x: 34, z: 44, v: 'burnt', yaw: 2.9 },
  { x: 196, z: 36, v: 'sunk', yaw: -1.6 },
  { x: -66, z: -8, v: 'intact', yaw: 0.8 },
  { x: 128, z: -30, v: 'noturret', yaw: -2.2 },
  { x: -206, z: -46, v: 'burnt', yaw: 1.4 },
  { x: -14, z: -68, v: 'intact', yaw: 3.0 },
  { x: 80, z: -96, v: 'burnt', yaw: -0.6 },
  { x: -112, z: -128, v: 'intact', yaw: 1.7 },
  { x: 168, z: -150, v: 'sunk', yaw: 0.3 },
  { x: -52, z: -168, v: 'burnt', yaw: -1.2 },
  { x: 44, z: -200, v: 'noturret', yaw: 2.1 },
  { x: -170, z: -208, v: 'intact', yaw: -0.5 },
  { x: 210, z: -214, v: 'burnt', yaw: 1.0 },
];

export function buildTanks(scene, terrain, colliders, fx) {
  const group = new THREE.Group();
  group.name = 'tanks';
  scene.add(group);
  const rng = new Rng(555);
  const wrecks = [];

  for (const spot of TANK_SPOTS) {
    if (!terrain.inBounds(spot.x, spot.z, 12)) continue;
    const tank = createTank(spot.v, rng);
    // Sample the whole footprint so a hull never sinks into a dune crest.
    let h = terrain.heightAt(spot.x, spot.z);
    for (const [ox, oz] of [[-1.7, -3.3], [1.7, -3.3], [-1.7, 3.3], [1.7, 3.3]]) {
      const wx = spot.x + Math.cos(spot.yaw) * ox + Math.sin(spot.yaw) * oz;
      const wz = spot.z - Math.sin(spot.yaw) * ox + Math.cos(spot.yaw) * oz;
      h = Math.max(h, terrain.heightAt(wx, wz));
    }
    const sink = spot.v === 'sunk' ? 0.7 : 0.08;
    tank.position.set(spot.x, h - sink, spot.z);
    tank.rotation.y = spot.yaw;
    // Settle onto the local slope.
    const n = terrain.normalAt(spot.x, spot.z);
    tank.rotation.x = Math.atan2(-n.z, n.y) * 0.8 + (spot.v === 'sunk' ? rng.float(-0.14, 0.14) : 0);
    tank.rotation.z = Math.atan2(n.x, n.y) * 0.8 + (spot.v === 'sunk' ? rng.float(-0.18, 0.18) : 0);
    group.add(tank);

    colliders.addBox(spot.x, spot.z, 1.75, 3.5, spot.yaw, {
      severity: 1.6,
      damage: 1.5,
      kind: 'solid',
      height: 2.6,
    });
    // Tanks are the best hard cover on the beach.
    colliders.addOccluder(spot.x, h + 1.4, spot.z, 2.9);
    colliders.addOccluder(
      spot.x + Math.sin(spot.yaw) * 2.4,
      h + 1.2,
      spot.z + Math.cos(spot.yaw) * 2.4,
      2.1
    );

    if (tank.userData.burnt) {
      wrecks.push({ x: spot.x, y: h + 1.4, z: spot.z, t: rng.float(0, 4) });
      if (fx && fx.decals) fx.decals.spawn(spot.x, spot.z, 6.5, 0x2a2521, 0.45);
    }
  }

  // Lazy smoke columns drifting off the burnt-out hulls.
  if (fx) {
    fx.addEmitter((dt) => {
      for (const w of wrecks) {
        w.t += dt;
        if (w.t < 0.42) continue;
        w.t = 0;
        fx.smoke(
          { x: w.x + (Math.random() - 0.5) * 1.2, y: w.y, z: w.z + (Math.random() - 0.5) * 1.2 },
          {
            color: Math.random() < 0.35 ? 0x201f1d : 0x4a4744,
            size: 1.6,
            size1: 9,
            alpha: 0.4,
            life: 5.5,
            vy: 2.2,
            gravity: 1.2,
            drag: 0.28,
          }
        );
      }
    });
  }

  wrecks.group = group;
  return wrecks;
}
