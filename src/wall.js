import * as THREE from 'three';
import {
  mat,
  buildLoft,
  mergeParts,
  flattenStatic,
  tintFaces,
  tintedMaterial,
} from './materials.js';
import { WALL, BUNKERS, WALL_SENTRIES, COLORS, OBJECTIVE } from './config.js';
import { sandbagGeometry } from './obstacles.js';
import { Rng } from './util.js';

const WALL_BASE_Y = 4.6;

/** Sweep a (z,y) profile along the X axis. */
function extrudeAlongX(profile, x0, x1) {
  const geo = buildLoft([
    { z: -x0, pts: profile },
    { z: -x1, pts: profile },
  ]);
  geo.rotateY(-Math.PI / 2);
  return geo;
}

function createBunker(kind, rng) {
  const g = new THREE.Group();
  const conc = mat(COLORS.concrete, { roughness: 0.97 });
  const concDark = mat(COLORS.concreteDark, { roughness: 0.98 });
  const dark = mat(0x121315, { roughness: 1 });
  const steel = mat(COLORS.steel, { roughness: 0.7, metalness: 0.45 });

  const big = kind === 'at';
  const w = big ? 4.3 : 3.2;
  const h = big ? 3.9 : 3.1;
  const d = big ? 3.6 : 2.8;

  const sec = (z, sw, sh) => ({
    z,
    pts: [
      [-sw, 0],
      [sw, 0],
      [sw * 0.84, sh],
      [-sw * 0.84, sh],
    ],
  });
  const shell = new THREE.Mesh(
    buildLoft([
      sec(d, w * 0.78, h * 0.86),
      sec(d * 0.5, w * 0.95, h),
      sec(-d * 0.55, w, h),
      sec(-d, w * 0.9, h * 0.94),
    ]),
    conc
  );
  shell.castShadow = true;
  shell.receiveShadow = true;
  g.add(shell);

  // Overhanging roof slab.
  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(w * 2.25, 0.62, d * 2.35),
    concDark
  );
  roof.position.set(0, h + 0.28, -0.1);
  roof.castShadow = true;
  roof.receiveShadow = true;
  g.add(roof);

  // Embrasure: a real opening in the middle of the face, with a concrete brow
  // and sill standing proud of it so the slot reads as a hole, not a decal.
  const slotY = h * 0.68;
  const slotH = big ? 0.92 : 0.6;
  const slotW = big ? 1.2 : 0.8; // half width
  const faceZ = d - 0.06;
  const slot = new THREE.Mesh(new THREE.BoxGeometry(slotW * 2, slotH, 0.3), dark);
  slot.position.set(0, slotY, faceZ - 0.16);
  g.add(slot);
  // Splayed cheeks either side of the opening.
  for (const side of [-1, 1]) {
    const cheek = new THREE.Mesh(new THREE.BoxGeometry(0.55, slotH + 0.1, 0.34), concDark);
    cheek.position.set(side * (slotW + 0.26), slotY, faceZ - 0.08);
    cheek.rotation.y = side * 0.22;
    cheek.castShadow = true;
    g.add(cheek);
  }
  const brow = new THREE.Mesh(new THREE.BoxGeometry(slotW * 2 + 1.5, 0.4, 0.62), concDark);
  brow.position.set(0, slotY + slotH * 0.5 + 0.2, faceZ + 0.1);
  brow.castShadow = true;
  g.add(brow);
  const sill = new THREE.Mesh(new THREE.BoxGeometry(slotW * 2 + 1.2, 0.3, 0.55), concDark);
  sill.position.set(0, slotY - slotH * 0.5 - 0.15, faceZ + 0.06);
  sill.castShadow = true;
  g.add(sill);

  // Rear entrance + blast wall.
  const door = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.9, 0.3), dark);
  door.position.set(w * 0.35, 0.95, -d * 1.02);
  g.add(door);
  const blast = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.3, 2.4), concDark);
  blast.position.set(w * 0.95, 1.15, -d * 1.5);
  blast.castShadow = true;
  g.add(blast);

  // Vision cupola on top.
  const cupola = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.68, 0.5, 10), steel);
  cupola.position.set(-w * 0.45, h + 0.82, -d * 0.2);
  cupola.castShadow = true;
  g.add(cupola);

  // Aerial.
  const aerial = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 3.4, 5), steel);
  aerial.position.set(w * 0.6, h + 2.2, -d * 0.5);
  aerial.rotation.z = 0.08;
  g.add(aerial);

  // The gun sits in the opening so its barrel clears the concrete.
  g.userData.mount = new THREE.Vector3(0, slotY, faceZ - 0.12);
  g.userData.size = { w, h, d };
  return g;
}

export function buildWall(scene, terrain, colliders) {
  const group = new THREE.Group();
  group.name = 'wall';
  scene.add(group);
  const rng = new Rng(31415);

  const conc = mat(COLORS.concrete, { roughness: 0.97 });
  const concDark = mat(COLORS.concreteDark, { roughness: 0.98 });
  const concTinted = tintedMaterial({ roughness: 0.97 });
  const steel = mat(COLORS.steel, { roughness: 0.68, metalness: 0.5 });
  const rust = mat(0x6d4a33, { roughness: 0.95, metalness: 0.2 });

  const frontZ = WALL.z + WALL.thickness / 2 + 2.0; // sea-facing foot
  const backZ = WALL.z - WALL.thickness / 2 - 2.0;
  const topY = WALL.height;
  const batter = 2.6;

  const profile = [
    [backZ, 0],
    [frontZ, 0],
    [frontZ - batter, topY],
    [backZ, topY],
  ];

  const gateL = WALL.gateX - WALL.gateHalfWidth;
  const gateR = WALL.gateX + WALL.gateHalfWidth;
  const segs = [
    [-WALL.length / 2, gateL],
    [gateR, WALL.length / 2],
  ];

  const staticParts = [];
  for (const [x0, x1] of segs) {
    staticParts.push(extrudeAlongX(profile, x0, x1));
    // Cornice + parapet.
    const cornice = new THREE.BoxGeometry(x1 - x0, 0.75, WALL.thickness + 5.4);
    cornice.translate((x0 + x1) / 2, topY - 0.38, WALL.z - 0.4);
    staticParts.push(cornice);
    const parapet = new THREE.BoxGeometry(x1 - x0, 1.5, 2.1);
    parapet.translate((x0 + x1) / 2, topY + 0.75, frontZ - batter - 0.6);
    staticParts.push(parapet);
  }

  // Buttresses marching along the sea face.
  for (let x = -WALL.length / 2 + 8; x < WALL.length / 2 - 8; x += 21) {
    if (x > gateL - 12 && x < gateR + 12) continue;
    const bt = new THREE.BoxGeometry(2.4, topY * 0.72, 2.0);
    bt.rotateX(-Math.atan2(batter, topY));
    bt.translate(x, topY * 0.36, frontZ - 0.5);
    staticParts.push(bt);
  }

  const wallMesh = new THREE.Mesh(
    tintFaces(mergeParts(staticParts), COLORS.concrete, 0.07, 11),
    concTinted
  );
  wallMesh.position.y = WALL_BASE_Y;
  wallMesh.castShadow = true;
  wallMesh.receiveShadow = true;
  group.add(wallMesh);

  // Horizontal form lines to give the concrete some scale.
  const lineParts = [];
  for (const [x0, x1] of segs) {
    for (let i = 1; i <= 3; i++) {
      const y = (topY / 4) * i;
      const line = new THREE.BoxGeometry(x1 - x0, 0.16, 0.3);
      line.translate((x0 + x1) / 2, y, frontZ - (batter * y) / topY + 0.08);
      lineParts.push(line);
    }
  }
  const lines = new THREE.Mesh(
    tintFaces(mergeParts(lineParts), COLORS.concreteDark, 0.08, 31),
    concTinted
  );
  lines.position.y = WALL_BASE_Y;
  group.add(lines);

  /* ---- Gate towers ---- */
  const towerParts = [];
  for (const side of [-1, 1]) {
    const cx = WALL.gateX + side * (WALL.gateHalfWidth + 5.5);
    const tw = 5.4;
    const th = topY + 7.5;
    const tower = new THREE.BoxGeometry(tw * 2, th, WALL.thickness + 7);
    tower.translate(cx, th / 2, WALL.z - 0.6);
    towerParts.push(tower);
    const cap = new THREE.BoxGeometry(tw * 2.3, 1.0, WALL.thickness + 8.4);
    cap.translate(cx, th + 0.5, WALL.z - 0.6);
    towerParts.push(cap);
    // Observation slit.
    const slit = new THREE.BoxGeometry(tw * 1.4, 0.7, 0.5);
    slit.translate(cx, th - 3.2, frontZ + 1.4);
    towerParts.push(slit);
  }
  const towers = new THREE.Mesh(
    tintFaces(mergeParts(towerParts), COLORS.concrete, 0.06, 23),
    concTinted
  );
  towers.position.y = WALL_BASE_Y;
  towers.castShadow = true;
  towers.receiveShadow = true;
  group.add(towers);

  /* ---- Gate itself: lintel, raised blast door, rails ---- */
  const gateParts = [];
  const lintelY = 11.5;
  const lintel = new THREE.BoxGeometry(WALL.gateHalfWidth * 2 + 2, topY - lintelY + 1.4, WALL.thickness + 4);
  lintel.translate(WALL.gateX, lintelY + (topY - lintelY + 1.4) / 2, WALL.z);
  gateParts.push(lintel);
  // Passage walls and a sealed far end, so the breach reads as a tunnel into
  // the works rather than a hole with bright beach showing through it.
  const passageDepth = WALL.thickness + 6;
  for (const side of [-1, 1]) {
    const cheek = new THREE.BoxGeometry(1.6, lintelY, passageDepth);
    cheek.translate(
      WALL.gateX + side * (WALL.gateHalfWidth + 0.8),
      lintelY / 2,
      WALL.z - 1
    );
    gateParts.push(cheek);
  }
  const back = new THREE.BoxGeometry(WALL.gateHalfWidth * 2 + 3.2, lintelY, 1.6);
  back.translate(WALL.gateX, lintelY / 2, WALL.z - passageDepth / 2);
  gateParts.push(back);
  const gateMesh = new THREE.Mesh(
    tintFaces(mergeParts(gateParts), COLORS.concreteDark, 0.06, 43),
    concTinted
  );
  gateMesh.position.y = WALL_BASE_Y;
  gateMesh.castShadow = true;
  group.add(gateMesh);

  // Unlit interior: a darker inner face and a floor slab you can see into.
  const shadowMat = mat(0x2b2e31, { roughness: 1 });
  const innerFloor = new THREE.Mesh(
    new THREE.BoxGeometry(WALL.gateHalfWidth * 2, 0.5, passageDepth - 2),
    shadowMat
  );
  innerFloor.position.set(
    WALL.gateX,
    WALL_BASE_Y + 0.25,
    WALL.z - 1
  );
  group.add(innerFloor);
  const innerBack = new THREE.Mesh(
    new THREE.BoxGeometry(WALL.gateHalfWidth * 2, lintelY * 0.9, 0.4),
    shadowMat
  );
  innerBack.position.set(
    WALL.gateX,
    WALL_BASE_Y + lintelY * 0.45,
    WALL.z - passageDepth / 2 + 1
  );
  group.add(innerBack);
  // Rubble heaped against the far end — the sappers have not cleared it yet.
  const rubbleRng = new Rng(4477);
  for (let i = 0; i < 16; i++) {
    const s = rubbleRng.float(0.5, 1.5);
    const chunk = new THREE.Mesh(
      new THREE.BoxGeometry(s, s * 0.7, s * 0.85),
      i % 3 === 0 ? concDark : shadowMat
    );
    chunk.position.set(
      WALL.gateX + rubbleRng.float(-WALL.gateHalfWidth + 1, WALL.gateHalfWidth - 1),
      WALL_BASE_Y + 0.3 + rubbleRng.float(0, 1.1),
      WALL.z - passageDepth / 2 + rubbleRng.float(1.4, 4.5)
    );
    chunk.rotation.set(rubbleRng.float(-0.3, 0.3), rubbleRng.float(0, 3.14), rubbleRng.float(-0.3, 0.3));
    group.add(chunk);
  }

  const doorGroup = new THREE.Group();
  const door = new THREE.Mesh(
    new THREE.BoxGeometry(WALL.gateHalfWidth * 2 - 0.6, 7.5, 0.6),
    rust
  );
  door.position.set(WALL.gateX, WALL_BASE_Y + lintelY + 4.2, WALL.z + 1.2);
  door.castShadow = true;
  doorGroup.add(door);
  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 20, 0.5),
      steel
    );
    rail.position.set(WALL.gateX + side * (WALL.gateHalfWidth - 0.1), WALL_BASE_Y + 10, WALL.z + 1.2);
    doorGroup.add(rail);
  }
  group.add(doorGroup);

  /* ---- Barbed wire coils along the wall top ---- */
  const coilGeo = new THREE.TorusGeometry(0.42, 0.035, 3, 9);
  coilGeo.rotateY(Math.PI / 2);
  const coils = new THREE.InstancedMesh(
    coilGeo,
    mat(0x3c3935, { roughness: 0.9, metalness: 0.3 }),
    Math.ceil(WALL.length / 1.1)
  );
  let ci = 0;
  const m4 = new THREE.Matrix4();
  for (let x = -WALL.length / 2; x < WALL.length / 2; x += 1.1) {
    if (x > gateL - 10 && x < gateR + 10) continue;
    m4.makeTranslation(x, WALL_BASE_Y + topY + 1.75, frontZ - batter - 0.6);
    coils.setMatrixAt(ci++, m4);
  }
  coils.count = ci;
  coils.instanceMatrix.needsUpdate = true;
  coils.castShadow = false;
  group.add(coils);

  /* ---- Colliders for the wall (with the gate left open) ---- */
  for (const [x0, x1] of segs) {
    colliders.addBox((x0 + x1) / 2, WALL.z, (x1 - x0) / 2, WALL.thickness / 2 + 2.6, 0, {
      severity: 2.2,
      damage: 1.8,
      kind: 'solid',
      height: 20,
    });
  }
  for (const side of [-1, 1]) {
    const cx = WALL.gateX + side * (WALL.gateHalfWidth + 5.5);
    colliders.addBox(cx, WALL.z - 0.6, 5.4, WALL.thickness / 2 + 3.5, 0, {
      severity: 2.2,
      damage: 1.8,
      kind: 'solid',
      height: 24,
    });
  }

  /* ---- Bunkers + their sentry mounts ---- */
  const mounts = [];
  const bagSet = [];
  const bagGeo = sandbagGeometry();
  for (const b of BUNKERS) {
    const bunker = createBunker(b.kind, rng);
    const h = terrain.heightAt(b.x, b.z);
    bunker.position.set(b.x, h - 0.35, b.z);
    // The model's local +Z is its embrasure, so this faces it out to sea.
    bunker.rotation.y = b.yaw;
    flattenStatic(bunker, { tint: 0.06 });
    group.add(bunker);

    const size = bunker.userData.size;
    colliders.addBox(b.x, b.z, size.w * 1.15, size.d * 1.2, b.yaw, {
      severity: 2.0,
      damage: 1.7,
      kind: 'solid',
      height: size.h + 1,
    });
    colliders.addOccluder(b.x, h + size.h * 0.6, b.z, size.w * 1.1);

    // Sandbag apron around the front corners.
    const yaw = b.yaw;
    for (let i = 0; i < 26; i++) {
      const side = i < 13 ? -1 : 1;
      const k = i % 13;
      const lx = side * (size.w * 1.25 + (k % 3) * 0.32);
      const lz = size.d * 1.1 - Math.floor(k / 3) * 0.7;
      const row = k % 3;
      const wx = b.x + Math.cos(yaw) * lx + Math.sin(yaw) * lz;
      const wz = b.z - Math.sin(yaw) * lx + Math.cos(yaw) * lz;
      const wy = terrain.heightAt(wx, wz) + 0.14 + row * 0.22;
      bagSet.push({ x: wx, y: wy, z: wz, yaw: yaw + rng.float(-0.2, 0.2) });
    }

    const mountWorld = bunker.userData.mount.clone();
    mountWorld.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    mountWorld.add(bunker.position);
    mounts.push({
      position: mountWorld,
      yaw,
      kind: b.kind,
      host: bunker,
    });
  }

  // Wall-top machine gun posts.
  for (const s of WALL_SENTRIES) {
    const px = s.x;
    const py = WALL_BASE_Y + topY + 1.1;
    const pz = frontZ - batter - 1.6;
    const nest = new THREE.Group();
    for (let i = 0; i < 9; i++) {
      const row = i % 3;
      const col = Math.floor(i / 3);
      bagSet.push({
        x: px - 1.2 + col * 1.0,
        y: py + 0.2 + row * 0.22,
        z: pz + 0.3,
        yaw: rng.float(-0.2, 0.2),
      });
    }
    group.add(nest);
    mounts.push({
      position: new THREE.Vector3(px, py + 0.9, pz),
      yaw: 0, // looking out over the beach
      kind: s.kind,
      host: null,
    });
  }

  // One instanced mesh for every sandbag on the wall line.
  if (bagSet.length) {
    const bagMesh = new THREE.InstancedMesh(bagGeo, mat(COLORS.sandbag, { roughness: 1 }), bagSet.length);
    const mtx = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const sc = new THREE.Vector3(1, 1, 1);
    bagSet.forEach((b, i) => {
      e.set(0, b.yaw, 0);
      q.setFromEuler(e);
      mtx.compose(new THREE.Vector3(b.x, b.y, b.z), q, sc);
      bagMesh.setMatrixAt(i, mtx);
    });
    bagMesh.instanceMatrix.needsUpdate = true;
    bagMesh.castShadow = true;
    bagMesh.receiveShadow = true;
    group.add(bagMesh);
  }

  /* ---- Objective marker at the breach ---- */
  const marker = new THREE.Group();
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0x6cf0c4,
    transparent: true,
    opacity: 0.22,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 6.5, 26, 18, 1, true), beamMat);
  beam.position.set(OBJECTIVE.x, terrain.heightAt(OBJECTIVE.x, OBJECTIVE.z) + 13, OBJECTIVE.z);
  marker.add(beam);
  const ringGeo = new THREE.TorusGeometry(6.2, 0.16, 6, 36);
  ringGeo.rotateX(-Math.PI / 2);
  const ring = new THREE.Mesh(
    ringGeo,
    new THREE.MeshBasicMaterial({ color: 0x8ffde0, transparent: true, opacity: 0.55 })
  );
  ring.position.set(OBJECTIVE.x, terrain.heightAt(OBJECTIVE.x, OBJECTIVE.z) + 1.2, OBJECTIVE.z);
  marker.add(ring);
  group.add(marker);

  return {
    group,
    mounts,
    marker,
    ring,
    beam,
    update(dt, time) {
      ring.rotation.z += dt * 0.6;
      ring.scale.setScalar(1 + Math.sin(time * 2.2) * 0.06);
      beamMat.opacity = 0.16 + Math.sin(time * 2.2) * 0.06;
    },
  };
}
