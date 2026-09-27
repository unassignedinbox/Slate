import * as THREE from 'three';
import { makeNoise } from '../utils/noise.js';
import { buildRockTextureSet, buildGroundTextureSet } from '../utils/proceduralTexture.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';

// Accelerate raycasting against the (high-poly) cave geometry with a BVH —
// the spider casts a dozen+ foot/body/camera rays every single frame, and
// a linear-scan raycast against a ~100k-triangle mesh would tank
// framerate. This drops each cast to an O(log n) tree walk.
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

// -----------------------------------------------------------------------
// A single continuous cavern (walkable floor -> walls -> ceiling) so the
// spider can demonstrate true wall/ceiling locomotion without needing a
// scripted tunnel spline. Built by radially deforming an inverted sphere
// with layered fbm noise, then flattening the noise near the floor so
// there is always a coherent (if rocky) place to stand.
// -----------------------------------------------------------------------

function invertWinding(geometry) {
  const index = geometry.index;
  if (!index) return;
  const arr = index.array;
  for (let i = 0; i < arr.length; i += 3) {
    const tmp = arr[i + 1];
    arr[i + 1] = arr[i + 2];
    arr[i + 2] = tmp;
  }
  index.needsUpdate = true;
}

export function buildCave(seed = 1337) {
  const group = new THREE.Group();
  group.name = 'cave';
  const colliders = [];

  const { fbm3 } = makeNoise(seed);

  const RADIUS = 2.05;
  const SCALE = new THREE.Vector3(2.7, 1.05, 1.55);

  const radiusAt = (nx, ny, nz) => {
    // low-frequency chamber shaping
    const large = fbm3(nx * 0.9 + 4, ny * 0.9 - 8, nz * 0.9 + 2, 4, 2.0, 0.55);
    // mid detail rockiness
    const mid = fbm3(nx * 2.6 - 1, ny * 2.6 + 5, nz * 2.6 - 9, 4, 2.1, 0.5);
    // fine surface roughness
    const fine = fbm3(nx * 8.0 + 3, ny * 8.0 + 3, nz * 8.0 + 3, 3, 2.2, 0.5);

    let r = RADIUS * (1 + large * 0.30 + mid * 0.10 + fine * 0.025);

    // A carved side alcove (the spider's "lair") around a fixed direction.
    const lairDir = _lairDir;
    const dLair = Math.acos(THREE.MathUtils.clamp(nx * lairDir.x + ny * lairDir.y + nz * lairDir.z, -1, 1));
    if (dLair < 0.62) {
      const t = 1 - dLair / 0.62;
      r += t * t * 0.85;
    }

    // Smooth the floor region (ny < -0.35ish in local unit-sphere space)
    // so there is a coherent walking surface, while still keeping gentle
    // undulation. Ceiling/walls keep full jaggedness for atmosphere.
    if (ny < -0.25) {
      const floorBlend = THREE.MathUtils.smoothstep(-0.25 - ny, 0, 0.5);
      const gentle = RADIUS * (1 + large * 0.30 + mid * 0.03);
      r = THREE.MathUtils.lerp(r, gentle, floorBlend * 0.85);
    }
    return r;
  };
  const _lairDir = new THREE.Vector3(-0.35, -0.05, 0.94).normalize();

  const geo = new THREE.SphereGeometry(1, 220, 160);
  const posAttr = geo.attributes.position;
  const nrm = new THREE.Vector3();
  for (let i = 0; i < posAttr.count; i++) {
    nrm.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)).normalize();
    const r = radiusAt(nrm.x, nrm.y, nrm.z);
    posAttr.setXYZ(i, nrm.x * r * SCALE.x, nrm.y * r * SCALE.y, nrm.z * r * SCALE.z);
  }
  invertWinding(geo);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  // UVs based on world-space triplanar-ish projection are handled via
  // shader-free trick: reuse spherical UV but tiled — good enough at
  // cave scale with our seamless-ish noise textures.

  const rockTex = buildRockTextureSet(seed + 3, 512);
  const material = new THREE.MeshStandardMaterial({
    map: rockTex.map,
    normalMap: rockTex.normalMap,
    roughnessMap: rockTex.roughnessMap,
    roughness: 1.0,
    metalness: 0.0,
    side: THREE.FrontSide,
  });
  // triplanar-like tiling: scale UV via existing spherical UVs * repeat already set on textures

  const shell = new THREE.Mesh(geo, material);
  shell.receiveShadow = true;
  shell.castShadow = false;
  shell.name = 'caveShell';
  shell.geometry.computeBoundsTree();
  group.add(shell);
  colliders.push(shell);

  const { fbm3: fbmRock } = makeNoise(seed + 11);

  function rockyDeform(geometry, amount, freq, seedOffset) {
    const { fbm3: f } = makeNoise(seed + seedOffset);
    const pos = geometry.attributes.position;
    const n = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      n.set(pos.getX(i), pos.getY(i), pos.getZ(i));
      const len = n.length() || 1;
      n.multiplyScalar(1 / len);
      const d = 1 + f(n.x * freq, n.y * freq, n.z * freq, 3) * amount;
      pos.setXYZ(i, pos.getX(i) * d, pos.getY(i) * d, pos.getZ(i) * d);
    }
    geometry.computeVertexNormals();
  }

  function makeBoulder(radius, seedOffset) {
    const geo = new THREE.IcosahedronGeometry(radius, 3);
    rockyDeform(geo, 0.35, 2.2, seedOffset);
    const mesh = new THREE.Mesh(geo, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  function pointOnShell(theta, phi) {
    // theta: azimuth 0..2PI, phi: polar 0(top)..PI(bottom)
    const nx = Math.sin(phi) * Math.cos(theta);
    const ny = Math.cos(phi);
    const nz = Math.sin(phi) * Math.sin(theta);
    const r = radiusAt(nx, ny, nz);
    return {
      point: new THREE.Vector3(nx * r * SCALE.x, ny * r * SCALE.y, nz * r * SCALE.z),
      normal: new THREE.Vector3(nx, ny, nz).normalize(),
    };
  }

  // ---- Boulders scattered on the floor ----
  const rand = mulberryLocal(seed + 500);
  for (let i = 0; i < 9; i++) {
    const theta = rand() * Math.PI * 2;
    const phi = Math.PI * (0.68 + rand() * 0.28); // lower hemisphere-ish
    const { point, normal } = pointOnShell(theta, phi);
    const r = 0.09 + rand() * 0.16;
    const b = makeBoulder(r, 30 + i);
    b.position.copy(point).addScaledVector(normal, r * 0.35);
    b.rotation.set(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI);
    b.geometry.computeBoundsTree();
    group.add(b);
    colliders.push(b);
  }

  // ---- Stalactites (ceiling) ----
  for (let i = 0; i < 14; i++) {
    const theta = rand() * Math.PI * 2;
    const phi = Math.PI * (0.06 + rand() * 0.22); // upper hemisphere
    const { point, normal } = pointOnShell(theta, phi);
    const len = 0.22 + rand() * 0.5;
    const rBase = 0.03 + rand() * 0.05;
    const geo = new THREE.ConeGeometry(rBase, len, 7, 1);
    geo.translate(0, -len / 2, 0);
    // slight random bend for organic look
    const pos = geo.attributes.position;
    for (let v = 0; v < pos.count; v++) {
      const y = pos.getY(v);
      const t = -y / len;
      pos.setX(v, pos.getX(v) + Math.sin(t * 3.1 + i) * 0.01 * t);
    }
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, material);
    mesh.castShadow = true;
    mesh.position.copy(point);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal.clone().negate());
    group.add(mesh);
  }

  // ---- Stalagmites (floor) ----
  for (let i = 0; i < 10; i++) {
    const theta = rand() * Math.PI * 2;
    const phi = Math.PI * (0.72 + rand() * 0.22);
    const { point, normal } = pointOnShell(theta, phi);
    const len = 0.14 + rand() * 0.34;
    const rBase = 0.025 + rand() * 0.045;
    const geo = new THREE.ConeGeometry(rBase, len, 7, 1);
    geo.translate(0, len / 2, 0);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.copy(point);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
    group.add(mesh);
  }

  // ---- Floor pebble scatter (instanced) ----
  const pebbleGeo = new THREE.IcosahedronGeometry(1, 0);
  const pebbleMat = material;
  const pebbleCount = 260;
  const pebbles = new THREE.InstancedMesh(pebbleGeo, pebbleMat, pebbleCount);
  pebbles.castShadow = true;
  pebbles.receiveShadow = true;
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  let kept = 0;
  for (let i = 0; i < pebbleCount; i++) {
    const theta = rand() * Math.PI * 2;
    const phi = Math.PI * (0.66 + rand() * 0.32);
    const { point, normal } = pointOnShell(theta, phi);
    const scale = 0.006 + rand() * 0.02;
    q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
    q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(rand() * 6, rand() * 6, rand() * 6)));
    s.set(scale, scale * (0.6 + rand() * 0.6), scale);
    m4.compose(point.addScaledVector(normal, scale * 0.3), q, s);
    pebbles.setMatrixAt(i, m4);
    kept++;
  }
  pebbles.count = kept;
  pebbles.instanceMatrix.needsUpdate = true;
  group.add(pebbles);

  // ---- Silk trip-lines near the lair alcove (thin translucent tubes) ----
  const silkMat = new THREE.MeshBasicMaterial({ color: 0xe4d9bd, transparent: true, opacity: 0.22 });
  const lairPoint = pointOnShell(Math.atan2(_lairDir.z, _lairDir.x), Math.acos(_lairDir.y));
  for (let i = 0; i < 6; i++) {
    const a = lairPoint.point.clone().addScaledVector(lairPoint.normal, 0.05 + rand() * 0.1);
    const dir = new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize();
    const b = a.clone().addScaledVector(dir, 0.35 + rand() * 0.5);
    const curve = new THREE.CatmullRomCurve3([a, a.clone().lerp(b, 0.5).addScaledVector(lairPoint.normal, 0.05), b]);
    const tube = new THREE.TubeGeometry(curve, 8, 0.0012, 4, false);
    const mesh = new THREE.Mesh(tube, silkMat);
    group.add(mesh);
  }

  return { group, colliders, radiusAt, pointOnShell, lairDirection: _lairDir.clone() };
}

function mulberryLocal(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
