import * as THREE from 'three';
import { flattenStatic, mat, buildLoft, mergeParts } from './materials.js';
import { COLORS, TRENCHES, WALL, ROADS } from './config.js';
import { Rng, clamp, lerp, resamplePolyline } from './util.js';

/* ------------------------------------------------------------------ */
/* Prefab geometries                                                   */
/* ------------------------------------------------------------------ */

export function hedgehogGeometry(size = 1.75) {
  const parts = [];
  const beam = () => new THREE.BoxGeometry(0.2, 0.2, size * 2);
  const angles = [
    [0.62, 0.4],
    [-0.62, 0.4],
    [0, -Math.PI / 2 + 0.2],
  ];
  for (const [ry, rx] of angles) {
    const g = beam();
    g.rotateX(rx);
    g.rotateY(ry);
    parts.push(g);
  }
  // Little welded collar in the middle.
  const collar = new THREE.BoxGeometry(0.34, 0.34, 0.34);
  parts.push(collar);
  const merged = mergeParts(parts);
  merged.translate(0, size * 0.72, 0);
  return merged;
}

export function dragonToothGeometry(base = 1.55, top = 0.55, height = 1.7) {
  const sq = (h) => [
    [-h, -h],
    [h, -h],
    [h, h],
    [-h, h],
  ];
  const g = buildLoft([
    { z: 0, pts: sq(base / 2) },
    { z: height * 0.55, pts: sq(lerp(base, top, 0.62) / 2) },
    { z: height, pts: sq(top / 2) },
  ]);
  g.rotateX(-Math.PI / 2);
  return g;
}

export function belgianGateGeometry(width = 3.4, height = 2.6) {
  const parts = [];
  const post = (x) => {
    const g = new THREE.BoxGeometry(0.16, height, 0.16);
    g.translate(x, height / 2, 0);
    return g;
  };
  parts.push(post(-width / 2), post(0), post(width / 2));
  for (const y of [0.35, height * 0.55, height - 0.12]) {
    const g = new THREE.BoxGeometry(width + 0.2, 0.13, 0.13);
    g.translate(0, y, 0);
    parts.push(g);
  }
  // Diagonal braces
  for (const s of [-1, 1]) {
    const len = Math.hypot(width / 2, height - 0.5);
    const g = new THREE.BoxGeometry(0.1, len, 0.1);
    g.rotateZ((s * Math.PI) / 2 - s * Math.atan2(height - 0.5, width / 2));
    g.translate((s * width) / 4, height / 2, 0);
    parts.push(g);
  }
  // Ground skids
  for (const s of [-1, 1]) {
    const g = new THREE.BoxGeometry(0.16, 0.16, 2.2);
    g.translate((s * width) / 2, 0.12, -0.6);
    parts.push(g);
  }
  return mergeParts(parts);
}

export function logRampGeometry(length = 3.4) {
  const parts = [];
  const log = new THREE.CylinderGeometry(0.15, 0.19, length, 7);
  log.rotateX(-0.55);
  log.translate(0, length * 0.42, -0.5);
  parts.push(log);
  const mine = new THREE.CylinderGeometry(0.33, 0.33, 0.16, 10);
  mine.translate(0, length * 0.82, -1.35);
  parts.push(mine);
  return mergeParts(parts);
}

export function wirePostGeometry(height = 1.25) {
  const parts = [];
  const a = new THREE.BoxGeometry(0.09, height * 1.3, 0.09);
  a.rotateZ(0.42);
  a.translate(0, height * 0.6, 0);
  const b = a.clone();
  b.rotateZ(-0.84);
  parts.push(a, b);
  const stake = new THREE.BoxGeometry(0.08, height * 0.6, 0.08);
  stake.translate(0, height * 0.3, 0);
  parts.push(stake);
  return mergeParts(parts);
}

export function sandbagGeometry(w = 0.58, h = 0.24, d = 0.34) {
  const geo = new THREE.BoxGeometry(w, h, d, 1, 1, 1);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    pos.setX(i, x * (1 - Math.abs(y / h) * 0.3));
    pos.setZ(i, z * (1 - Math.abs(y / h) * 0.25) * (1 - Math.abs(x / w) * 0.22));
    pos.setY(i, y * (1 - Math.abs(x / w) * 0.2));
  }
  geo.computeVertexNormals();
  return geo;
}

function signTexture(label = 'MINEN') {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#d9d2c2';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#b32219';
  ctx.beginPath();
  ctx.moveTo(64, 12);
  ctx.lineTo(118, 108);
  ctx.lineTo(10, 108);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#f4efe2';
  ctx.beginPath();
  ctx.moveTo(64, 26);
  ctx.lineTo(104, 98);
  ctx.lineTo(24, 98);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#17181a';
  ctx.font = 'bold 26px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(label, 64, 90);
  ctx.beginPath();
  ctx.arc(64, 56, 13, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f4efe2';
  ctx.beginPath();
  ctx.arc(59, 54, 3.4, 0, Math.PI * 2);
  ctx.arc(69, 54, 3.4, 0, Math.PI * 2);
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ------------------------------------------------------------------ */
/* Instancing helper                                                   */
/* ------------------------------------------------------------------ */

class InstanceSet {
  /**
   * @param tint per-instance brightness jitter (0 = every copy identical).
   *             A field of 200 identical hedgehogs looks stamped without it.
   */
  constructor(geometry, material, castShadow = true, tint = 0.08) {
    this.geometry = geometry;
    this.material = material;
    this.tint = tint;
    this.matrices = [];
    this.castShadow = castShadow;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
  }

  add(x, y, z, yaw = 0, scale = 1, pitch = 0, roll = 0) {
    this._p.set(x, y, z);
    this._e.set(pitch, yaw, roll, 'YXZ');
    this._q.setFromEuler(this._e);
    if (typeof scale === 'number') this._s.set(scale, scale, scale);
    else this._s.copy(scale);
    this._m.compose(this._p, this._q, this._s);
    this.matrices.push(this._m.clone());
  }

  build(parent) {
    if (!this.matrices.length) return null;
    const mesh = new THREE.InstancedMesh(this.geometry, this.material, this.matrices.length);
    this.matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
    if (this.tint > 0) {
      // instanceColor multiplies the material colour, so jitter around 1.0.
      const c = new THREE.Color();
      for (let i = 0; i < this.matrices.length; i++) {
        const h = Math.abs(Math.sin(i * 12.9898 + 4.1) * 43758.5453) % 1;
        const h2 = Math.abs(Math.sin(i * 78.233 + 1.7) * 43758.5453) % 1;
        const k = 1 + (h - 0.5) * 2 * this.tint;
        const warm = 1 + (h2 - 0.5) * this.tint;
        c.setRGB(k * warm, k, k / warm);
        mesh.setColorAt(i, c);
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    mesh.castShadow = this.castShadow;
    mesh.receiveShadow = true;
    parent.add(mesh);
    this.mesh = mesh;
    return mesh;
  }
}

/* ------------------------------------------------------------------ */
/* World dressing                                                      */
/* ------------------------------------------------------------------ */

export function buildObstacles(scene, terrain, colliders, ocean) {
  const group = new THREE.Group();
  group.name = 'obstacles';
  scene.add(group);
  const rng = new Rng(20250606);

  const steelMat = mat(COLORS.steel, { roughness: 0.72, metalness: 0.35 });
  const rustMat = mat(COLORS.rust, { roughness: 0.95, metalness: 0.15 });
  const concreteMat = mat(COLORS.concreteDark, { roughness: 0.96 });
  const woodMat = mat(COLORS.wood, { roughness: 1.0 });
  const bagMat = mat(COLORS.sandbag, { roughness: 1.0 });
  const bagMatAlt = mat(COLORS.sandbagAlt, { roughness: 1.0 });
  const wireMat = mat(0x3d3a36, { roughness: 0.9, metalness: 0.4 });

  const hedgehogs = new InstanceSet(hedgehogGeometry(), steelMat);
  const hedgehogsRust = new InstanceSet(hedgehogGeometry(1.55), rustMat);
  const teeth = new InstanceSet(dragonToothGeometry(), concreteMat);
  const gates = new InstanceSet(belgianGateGeometry(), rustMat);
  const ramps = new InstanceSet(logRampGeometry(), woodMat);
  const posts = new InstanceSet(wirePostGeometry(), woodMat);
  const bags = new InstanceSet(sandbagGeometry(), bagMat);
  const bagsAlt = new InstanceSet(sandbagGeometry(0.54, 0.22, 0.32), bagMatAlt);
  const barrels = new InstanceSet(new THREE.CylinderGeometry(0.3, 0.3, 0.88, 9), rustMat);
  const crates = new InstanceSet(new THREE.BoxGeometry(0.9, 0.7, 0.6), woodMat);

  const wireStrands = [];
  const planks = [];

  const onRoad = (x, z, threshold = 0.18) => terrain.roadMaskAt(x, z) > threshold;
  const nearGate = (x, z) =>
    Math.abs(x - WALL.gateX) < WALL.gateHalfWidth + 9 && z < -196;

  /* ---- Hedgehog belts in the surf and across the tidal flat ---- */
  const belts = [
    { z: 206, count: 46, jitter: 12 },
    { z: 178, count: 42, jitter: 12 },
    { z: 150, count: 34, jitter: 14 },
    { z: 96, count: 22, jitter: 20 },
  ];
  for (const belt of belts) {
    for (let i = 0; i < belt.count; i++) {
      const x = lerp(terrain.minX + 16, terrain.maxX - 16, i / (belt.count - 1)) + rng.float(-9, 9);
      const z = belt.z + rng.float(-belt.jitter, belt.jitter);
      if (onRoad(x, z)) continue;
      const h = terrain.heightAt(x, z);
      const rust = rng.chance(0.45);
      const set = rust ? hedgehogsRust : hedgehogs;
      const s = rng.float(0.85, 1.15);
      set.add(x, h - 0.15, z, rng.float(0, Math.PI * 2), s, rng.float(-0.12, 0.12), rng.float(-0.12, 0.12));
      colliders.addCircle(x, z, 1.55 * s, { severity: 1.0, damage: 1.25, kind: 'solid', height: 2 });
      colliders.addOccluder(x, h + 1, z, 1.1);
    }
  }

  /* ---- Rommel's asparagus (mined log ramps) in the tidal zone ---- */
  for (let i = 0; i < 70; i++) {
    const x = rng.float(terrain.minX + 20, terrain.maxX - 20);
    const z = rng.float(120, 250);
    if (onRoad(x, z)) continue;
    const h = terrain.heightAt(x, z);
    ramps.add(x, h - 0.1, z, rng.float(0, Math.PI * 2), rng.float(0.85, 1.2));
    colliders.addCircle(x, z, 0.85, { severity: 0.8, damage: 1.0, kind: 'solid', height: 3 });
  }

  /* ---- Dragon's teeth rows guarding the wall ---- */
  for (let row = 0; row < 3; row++) {
    const z = -214 - row * 7.2;
    for (let x = terrain.minX + 26; x < terrain.maxX - 26; x += 5.4) {
      const px = x + (row % 2) * 2.7 + rng.float(-0.5, 0.5);
      if (onRoad(px, z, 0.12) || nearGate(px, z)) continue;
      const h = terrain.heightAt(px, z);
      teeth.add(px, h - 0.2, z, rng.float(-0.25, 0.25), rng.float(0.9, 1.15));
      colliders.addCircle(px, z, 1.0, { severity: 1.2, damage: 1.5, kind: 'solid', height: 1.8 });
    }
  }

  /* ---- Belgian gates scattered over the open beach ---- */
  for (let i = 0; i < 26; i++) {
    const x = rng.float(terrain.minX + 24, terrain.maxX - 24);
    const z = rng.float(-120, 140);
    if (onRoad(x, z) || !terrain.isBuildable(x, z, 0.5, -1.5)) continue;
    const h = terrain.heightAt(x, z);
    const yaw = rng.float(0, Math.PI * 2);
    gates.add(x, h - 0.05, z, yaw, rng.float(0.9, 1.15));
    colliders.addBox(x, z, 1.8, 0.45, yaw, { severity: 1.0, damage: 1.1, kind: 'solid', height: 2.6 });
    colliders.addOccluder(x, h + 1.2, z, 1.4);
  }

  /* ---- Chicanes: staggered roadblocks so the fast route still bites ---- */
  const CHICANES = [
    { road: 'causeway', z: 168, side: -1 },
    { road: 'causeway', z: 66, side: 1 },
    { road: 'causeway', z: -58, side: -1 },
    { road: 'causeway', z: -158, side: 1 },
    { road: 'west-track', z: 112, side: 1 },
    { road: 'west-track', z: -96, side: -1 },
    { road: 'east-track', z: 96, side: -1 },
    { road: 'east-track', z: -62, side: 1 },
  ];
  for (const ch of CHICANES) {
    const road = ROADS.find((r) => r.name === ch.road);
    if (!road) continue;
    // Find the centreline point nearest this Z and the local road heading.
    let best = null;
    let bestD = Infinity;
    const dense = resamplePolyline(road.points, 2);
    for (let i = 1; i < dense.length; i++) {
      const d = Math.abs(dense[i][1] - ch.z);
      if (d < bestD) {
        bestD = d;
        best = { p: dense[i], prev: dense[i - 1] };
      }
    }
    if (!best) continue;
    const dirX = best.p[0] - best.prev[0];
    const dirZ = best.p[1] - best.prev[1];
    const len = Math.hypot(dirX, dirZ) || 1;
    const nx = -dirZ / len; // across the road
    const nz = dirX / len;
    const yaw = Math.atan2(nx, nz);
    const halfW = road.width * 0.5;

    // Barricade line covering ~65% of the carriageway.
    for (let k = 0; k < 4; k++) {
      const off = ch.side * (halfW * 1.25 - k * (halfW * 0.52));
      const x = best.p[0] + nx * off;
      const z = best.p[1] + nz * off;
      if (!terrain.inBounds(x, z, 8)) continue;
      const h = terrain.heightAt(x, z);
      if (k === 0 || k === 2) {
        gates.add(x, h - 0.05, z, yaw + rng.float(-0.12, 0.12), 1.05);
        colliders.addBox(x, z, 1.9, 0.5, yaw, {
          severity: 1.0,
          damage: 1.1,
          kind: 'solid',
          height: 2.6,
        });
      } else {
        hedgehogsRust.add(x, h - 0.15, z, rng.float(0, Math.PI * 2), 1.0);
        colliders.addCircle(x, z, 1.5, { severity: 1.0, damage: 1.2, kind: 'solid', height: 2 });
      }
      colliders.addOccluder(x, h + 1.1, z, 1.5);
    }
    // Sandbag emplacement tucked behind the barrier.
    for (let b = 0; b < 12; b++) {
      const row = b % 3;
      const col = Math.floor(b / 3);
      const off = ch.side * (halfW * 1.5 + col * 0.5);
      const along = -ch.side * 1.6;
      const x = best.p[0] + nx * off + (dirX / len) * along;
      const z = best.p[1] + nz * off + (dirZ / len) * along;
      if (!terrain.inBounds(x, z, 8)) continue;
      bags.add(x, terrain.heightAt(x, z) + 0.14 + row * 0.22, z, yaw, 1);
    }
  }

  /* ---- Barbed wire runs ---- */
  const wireRuns = [
    [[-250, 58], [-150, 52], [-70, 62]],
    [[-40, 46], [60, 54], [150, 44], [250, 50]],
    [[-248, -6], [-160, -14], [-90, -4]],
    [[30, -12], [130, -4], [246, -14]],
    [[-244, -104], [-150, -96], [-84, -108]],
    [[24, -100], [120, -110], [244, -98]],
    [[-240, -186], [-170, -178], [-110, -188]],
    [[60, -184], [140, -176], [238, -186]],
  ];
  for (const run of wireRuns) {
    const samples = resamplePolyline(run, 2.6);
    const strandPts = [];
    for (let i = 0; i < samples.length; i++) {
      const [x, z] = samples[i];
      if (!terrain.inBounds(x, z, 6)) continue;
      const h = terrain.heightAt(x, z);
      if (i % 2 === 0 && !onRoad(x, z)) {
        posts.add(x, h - 0.05, z, rng.float(0, Math.PI), rng.float(0.9, 1.15));
      }
      strandPts.push(new THREE.Vector3(x, h, z));
      if (!onRoad(x, z)) {
        colliders.addCircle(x, z, 1.7, { kind: 'wire', severity: 0.2, damage: 0.2, height: 1.2 });
      }
    }
    // Three sagging strands between the posts.
    for (let s = 0; s < 3; s++) {
      const hOff = 0.4 + s * 0.34;
      const curvePts = strandPts.map((p, i) => {
        const sag = Math.sin((i % 2) * Math.PI * 0.5) * 0.12;
        return new THREE.Vector3(p.x, p.y + hOff - sag, p.z);
      });
      if (curvePts.length < 2) continue;
      const curve = new THREE.CatmullRomCurve3(curvePts);
      const tube = new THREE.TubeGeometry(curve, Math.min(220, curvePts.length * 2), 0.035, 3, false);
      wireStrands.push(tube);
    }
  }

  /* ---- Sandbag parapets along the trench lips ---- */
  for (const tr of TRENCHES) {
    const samples = resamplePolyline(tr.points, 3.4);
    for (let i = 0; i < samples.length; i++) {
      const [x, z] = samples[i];
      const px = x;
      const pz = z - tr.width * 0.62; // parapet on the seaward... wall-facing side
      if (!terrain.inBounds(px, pz, 6) || onRoad(px, pz)) continue;
      const h = terrain.heightAt(px, pz);
      const yaw = rng.float(-0.2, 0.2);
      for (let b = 0; b < 3; b++) {
        const set = rng.chance(0.5) ? bags : bagsAlt;
        set.add(
          px + rng.float(-0.9, 0.9),
          h + 0.12 + b * 0.22,
          pz + rng.float(-0.2, 0.2),
          yaw + rng.float(-0.15, 0.15),
          rng.float(0.9, 1.1)
        );
      }
      if (i % 2 === 0) {
        colliders.addCircle(px, pz, 1.1, { severity: 0.55, damage: 0.5, kind: 'solid', height: 1 });
        colliders.addOccluder(px, h + 0.8, pz, 1.3);
      }
    }
    // A few plank crossings / revetments inside the cut.
    for (let i = 4; i < samples.length; i += 9) {
      const [x, z] = samples[i];
      if (!terrain.inBounds(x, z, 8)) continue;
      const h = terrain.heightAt(x, z);
      const g = new THREE.BoxGeometry(2.6, 0.12, 0.42);
      g.rotateY(rng.float(-0.3, 0.3));
      g.translate(x, h + 0.3, z);
      planks.push(g);
    }
  }

  /* ---- Minefield warning signs ---- */
  const signTex = signTexture('MINEN');
  const signMat = new THREE.MeshStandardMaterial({
    map: signTex,
    roughness: 0.95,
    side: THREE.DoubleSide,
  });
  const signGroup = new THREE.Group();
  const signGeo = new THREE.PlaneGeometry(0.85, 0.85);
  for (let i = 0; i < 28; i++) {
    const x = rng.float(terrain.minX + 30, terrain.maxX - 30);
    const z = rng.float(-190, 130);
    if (onRoad(x, z, 0.05) || !terrain.isBuildable(x, z, 0.6, -0.5)) continue;
    const h = terrain.heightAt(x, z);
    const yaw = rng.float(-0.6, 0.6) + Math.PI;
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.5, 0.1), woodMat);
    post.position.set(x, h + 0.75, z);
    post.castShadow = true;
    signGroup.add(post);
    const board = new THREE.Mesh(signGeo, signMat);
    board.position.set(x, h + 1.45, z + 0.06);
    board.rotation.y = yaw;
    signGroup.add(board);
  }
  flattenStatic(signGroup);
  group.add(signGroup);

  /* ---- Telegraph poles along the causeway ---- */
  const poleMat = mat(COLORS.woodDark, { roughness: 1 });
  const poleGroup = new THREE.Group();
  for (let i = 0; i < 16; i++) {
    const z = 250 - i * 30;
    const x = 22 + Math.sin(i * 0.7) * 4;
    if (!terrain.inBounds(x, z, 10)) continue;
    const h = terrain.heightAt(x, z);
    if (h < 0.4) continue;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 7.2, 7), poleMat);
    pole.position.set(x, h + 3.4, z);
    pole.rotation.z = rng.float(-0.06, 0.06);
    pole.castShadow = true;
    poleGroup.add(pole);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.14, 0.14), poleMat);
    arm.position.set(x, h + 6.4, z);
    poleGroup.add(arm);
    colliders.addCircle(x, z, 0.5, { severity: 1.4, damage: 1.6, kind: 'solid', height: 7 });
  }

  flattenStatic(poleGroup);
  group.add(poleGroup);

  /* ---- Beached landing craft in the surf ---- */
  const craftGroup = new THREE.Group();
  const craftPositions = [
    { x: -168, z: 214, yaw: 0.5 },
    { x: -56, z: 236, yaw: -0.25 },
    { x: 88, z: 222, yaw: 0.9 },
    { x: 182, z: 246, yaw: -0.7 },
    { x: 24, z: 186, yaw: 2.6 },
  ];
  for (const c of craftPositions) {
    const craft = createLandingCraft(rng);
    const h = terrain.heightAt(c.x, c.z);
    craft.position.set(c.x, h - 0.35, c.z);
    craft.rotation.set(rng.float(-0.06, 0.06), c.yaw, rng.float(-0.09, 0.09));
    craftGroup.add(craft);
    colliders.addBox(c.x, c.z, 2.6, 5.4, c.yaw, {
      severity: 1.3,
      damage: 1.4,
      kind: 'solid',
      height: 3,
    });
    colliders.addOccluder(c.x, h + 1.6, c.z, 4.2);
  }
  flattenStatic(craftGroup);
  group.add(craftGroup);

  /* ---- Supply clutter ---- */
  for (let i = 0; i < 54; i++) {
    const x = rng.float(terrain.minX + 24, terrain.maxX - 24);
    const z = rng.float(-232, 200);
    if (!terrain.isBuildable(x, z, 0.4, 0.3) || onRoad(x, z, 0.3)) continue;
    const h = terrain.heightAt(x, z);
    if (rng.chance(0.5)) {
      barrels.add(x, h + 0.44, z, rng.float(0, Math.PI), 1, rng.chance(0.25) ? 1.4 : 0);
    } else {
      crates.add(x, h + 0.35, z, rng.float(0, Math.PI), rng.float(0.8, 1.3));
    }
  }

  /* ---- Build the instanced sets ---- */
  hedgehogs.build(group);
  hedgehogsRust.build(group);
  teeth.build(group);
  gates.build(group);
  ramps.build(group);
  posts.build(group);
  bags.build(group);
  bagsAlt.build(group);
  barrels.build(group);
  crates.build(group);

  if (wireStrands.length) {
    const wireMesh = new THREE.Mesh(mergeParts(wireStrands), wireMat);
    wireMesh.castShadow = false;
    group.add(wireMesh);
  }
  if (planks.length) {
    const plankMesh = new THREE.Mesh(mergeParts(planks), woodMat);
    plankMesh.castShadow = true;
    group.add(plankMesh);
  }

  /* ---- Repair crates (pickups) ---- */
  const repairCrates = [];
  const repairSpots = [
    [-124, 22],
    [58, -34],
    [-64, -122],
    [130, -140],
    [-150, -178],
    [16, 108],
  ];
  const crateMat = mat(0x4d6b43, { roughness: 0.9 });
  const crossMat = mat(0xe8e4d8, { roughness: 0.8, emissive: 0x334422, emissiveIntensity: 0.3 });
  for (const [x, z] of repairSpots) {
    const g = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.9, 0.9), crateMat);
    box.castShadow = true;
    g.add(box);
    const bar1 = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.16, 0.05), crossMat);
    bar1.position.z = 0.47;
    g.add(bar1);
    const bar2 = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.55, 0.05), crossMat);
    bar2.position.z = 0.47;
    g.add(bar2);
    const h = terrain.heightAt(x, z);
    g.position.set(x, h + 0.55, z);
    group.add(g);
    repairCrates.push({ object: g, x, z, taken: false, baseY: h + 0.55 });
  }

  return {
    group,
    repairCrates,
    update(dt, time) {
      for (const c of repairCrates) {
        if (c.taken) continue;
        c.object.rotation.y += dt * 0.8;
        c.object.position.y = c.baseY + Math.sin(time * 2 + c.x) * 0.12;
      }
    },
  };
}

/* ------------------------------------------------------------------ */
/* Beached landing craft                                               */
/* ------------------------------------------------------------------ */

function createLandingCraft(rng) {
  const g = new THREE.Group();
  const hullMat = mat(0x4a5347, { roughness: 0.9, metalness: 0.2 });
  const rustMat = mat(0x6b4b34, { roughness: 1 });

  const half = (w, y) => [
    [-w, y],
    [w, y],
  ];
  const sections = [
    { z: -5.4, pts: [[-1.6, 0], [1.6, 0], [2.1, 1.9], [-2.1, 1.9]] },
    { z: -3.0, pts: [[-2.3, -0.2], [2.3, -0.2], [2.7, 2.0], [-2.7, 2.0]] },
    { z: 1.5, pts: [[-2.4, -0.25], [2.4, -0.25], [2.8, 2.05], [-2.8, 2.05]] },
    { z: 4.2, pts: [[-2.1, -0.1], [2.1, -0.1], [2.5, 2.0], [-2.5, 2.0]] },
    { z: 5.6, pts: [[-1.7, 0.15], [1.7, 0.15], [2.1, 1.95], [-2.1, 1.95]] },
  ];
  const hull = new THREE.Mesh(buildLoft(sections), hullMat);
  hull.castShadow = true;
  hull.receiveShadow = true;
  g.add(hull);

  // Dropped bow ramp.
  const ramp = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.16, 4.2), rustMat);
  ramp.position.set(0, 0.25, 7.4);
  ramp.rotation.x = 0.28;
  ramp.castShadow = true;
  g.add(ramp);

  // Wheelhouse + gun tubs at the stern.
  const house = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.1, 1.4), hullMat);
  house.position.set(-1.0, 2.5, -4.2);
  g.add(house);
  const tub = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.7, 9, 1, true), rustMat);
  tub.position.set(1.3, 2.3, -4.0);
  g.add(tub);

  // Battle damage: a couple of holes suggested by dark plates.
  for (let i = 0; i < 3; i++) {
    const hole = new THREE.Mesh(
      new THREE.BoxGeometry(rng.float(0.4, 0.9), rng.float(0.3, 0.7), 0.1),
      mat(0x15171a)
    );
    hole.position.set(rng.sign() * 2.42, rng.float(0.6, 1.6), rng.float(-3, 3));
    hole.rotation.y = Math.PI / 2;
    g.add(hole);
  }
  return g;
}
