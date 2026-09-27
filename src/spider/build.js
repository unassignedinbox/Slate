import * as THREE from 'three';
import {
  BODY, LEG_SEGMENT_FRACTIONS, LEG_SEGMENT_RADII, LEG_ORDER, LEG_PAIRS,
  BASE_LEG_LENGTH, PEDIPALP, CHELICERA, EYES, PALETTE,
} from './proportions.js';
import { LegIKChain } from './ik.js';
import { attachFur } from './fur.js';

const UP = new THREE.Vector3(0, 1, 0);

function taperedSegment(material, r0, r1, length, radialSegments = 9) {
  const geo = new THREE.CylinderGeometry(r1, r0, length, radialSegments, 1, false);
  geo.translate(0, 0, 0);
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.length = length;
  return mesh;
}

function jointSphere(material, radius) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 10, 8), material);
  mesh.castShadow = true;
  return mesh;
}

/** Orient `mesh` (a Y-aligned cylinder) so it spans from a->b in world space. */
export function placeSegmentWorld(mesh, a, b, parentInverseMatrix) {
  _mid.copy(a).add(b).multiplyScalar(0.5);
  _dir.subVectors(b, a);
  const len = _dir.length();
  if (len < 1e-6) return;
  _dir.multiplyScalar(1 / len);
  _quat.setFromUnitVectors(UP, _dir);
  if (parentInverseMatrix) {
    _mid.applyMatrix4(parentInverseMatrix);
  }
  mesh.position.copy(_mid);
  mesh.quaternion.copy(_quat);
  if (parentInverseMatrix) {
    // strip parent rotation/scale from quaternion so world orientation is correct
    const parentQuat = _pq.setFromRotationMatrix(parentInverseMatrix);
    mesh.quaternion.premultiply(parentQuat);
  }
}
const _mid = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _pq = new THREE.Quaternion();

// ---------------------------------------------------------------------
// Body
// ---------------------------------------------------------------------
export function buildBody(materials) {
  const group = new THREE.Group();
  group.name = 'body';

  const prosomaGeo = new THREE.SphereGeometry(1, 24, 18);
  prosomaGeo.scale(BODY.prosomaLength * 0.5, BODY.prosomaHeight * 0.5, BODY.prosomaWidth * 0.5);
  const prosoma = new THREE.Mesh(prosomaGeo, materials.exoskeleton);
  prosoma.position.set(BODY.opisthosomaLength * 0.02, 0, 0);
  prosoma.castShadow = prosoma.receiveShadow = true;
  group.add(prosoma);

  // Ocular tubercle bump at the front-top of the carapace.
  const tubercle = new THREE.Mesh(new THREE.SphereGeometry(0.006, 10, 8), materials.exoskeleton);
  tubercle.scale.set(1.6, 0.9, 2.0);
  tubercle.position.set(BODY.prosomaLength * 0.46, BODY.prosomaHeight * 0.42, 0);
  prosoma.add(tubercle);

  const pedicel = new THREE.Mesh(
    new THREE.CylinderGeometry(BODY.pedicelRadius, BODY.pedicelRadius * 1.3, BODY.pedicelLength, 8),
    materials.exoskeleton
  );
  pedicel.rotation.z = Math.PI / 2;
  pedicel.position.set(-BODY.prosomaLength * 0.52 - BODY.pedicelLength * 0.4, -BODY.prosomaHeight * 0.05, 0);
  group.add(pedicel);

  const opGeo = new THREE.SphereGeometry(1, 28, 20);
  opGeo.scale(BODY.opisthosomaLength * 0.5, BODY.opisthosomaHeight * 0.5, BODY.opisthosomaWidth * 0.5);
  // bulge it slightly downward/backward like a real abdomen
  const posAttr = opGeo.attributes.position;
  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i), y = posAttr.getY(i), z = posAttr.getZ(i);
    if (x < 0) posAttr.setY(i, y * 1.06);
    if (y < 0) posAttr.setY(i, y * 1.1);
  }
  opGeo.computeVertexNormals();
  const opisthosoma = new THREE.Mesh(opGeo, materials.exoskeleton);
  opisthosoma.position.set(
    -BODY.prosomaLength * 0.52 - BODY.pedicelLength - BODY.opisthosomaLength * 0.46,
    -BODY.opisthosomaHeight * 0.06,
    0
  );
  opisthosoma.castShadow = opisthosoma.receiveShadow = true;
  group.add(opisthosoma);

  // spinnerets
  const spinneretGroup = new THREE.Group();
  for (const [dx, dz] of [[-1, -1], [-1, 1], [-0.4, 0]]) {
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.0045, 0.012, 6), materials.spinneret);
    s.position.set(
      opisthosoma.position.x - BODY.opisthosomaLength * 0.46 + dx * 0.004,
      opisthosoma.position.y - BODY.opisthosomaHeight * 0.05,
      dz * 0.01
    );
    s.rotation.x = Math.PI / 2.6 * Math.sign(dz || 1) * (dz === 0 ? 0 : 1);
    s.rotation.z = 0.15 * dx;
    spinneretGroup.add(s);
  }
  group.add(spinneretGroup);

  // eyes: 8 small eyes clustered on the ocular tubercle, two rows.
  const eyesGroup = new THREE.Group();
  const eyeGeo = new THREE.SphereGeometry(EYES.radius, 8, 6);
  const rows = [
    { z: 0.0085, y: 0.0125, n: 4, spread: 0.012 },
    { z: 0.0035, y: 0.017, n: 4, spread: 0.007 },
  ];
  for (const row of rows) {
    for (let i = 0; i < row.n; i++) {
      const t = row.n === 1 ? 0 : (i / (row.n - 1)) * 2 - 1;
      const eye = new THREE.Mesh(eyeGeo, materials.eye);
      eye.position.set(
        BODY.prosomaLength * 0.49,
        row.y,
        t * row.spread
      );
      eyesGroup.add(eye);
    }
  }
  prosoma.add(eyesGroup);

  const backSweep = new THREE.Vector3(-1, -0.15, 0);
  attachFur(prosoma, {
    material: materials.furCarapace,
    density: 900,
    length: 0.006,
    lengthVariance: 0.5,
    radius: 0.0006,
    combBack: 0.5,
    combDir: backSweep,
  });
  attachFur(opisthosoma, {
    material: materials.furBrown,
    density: 2200,
    length: 0.011,
    lengthVariance: 0.6,
    radius: 0.0007,
    combBack: 0.35,
    combDir: backSweep,
  });
  // dorsal urticating-hair patch (denser, warmer patch on top of the abdomen)
  attachFur(opisthosoma, {
    material: materials.furUrticating,
    density: 1400,
    length: 0.009,
    lengthVariance: 0.4,
    radius: 0.0007,
    combBack: 0.2,
    combDir: backSweep,
    region: (localPos, normal) => normal.y > 0.55 && localPos.x > -0.15,
  });

  return { group, prosoma, opisthosoma, pedicel };
}

// ---------------------------------------------------------------------
// Chelicerae + fangs
// ---------------------------------------------------------------------
export function buildChelicera(side, materials) {
  const root = new THREE.Group();
  root.name = `chelicera_${side > 0 ? 'R' : 'L'}`;

  const base = taperedSegment(materials.exoskeleton, CHELICERA.radius, CHELICERA.radius * 0.75, CHELICERA.length, 10);
  base.rotation.x = Math.PI / 2.3;
  base.position.set(0, -CHELICERA.length * 0.35, 0);
  root.add(base);
  attachFur(base, { material: materials.furBlack, density: 120, length: 0.003, lengthVariance: 0.5, radius: 0.0004, combBack: 0.6 });

  const fangPivot = new THREE.Group();
  fangPivot.position.set(0, -CHELICERA.length * 0.86, 0.001 * side);
  root.add(fangPivot);
  fangPivot.rotation.x = THREE.MathUtils.degToRad(CHELICERA.restAngleDeg);

  const fang = taperedSegment(materials.fang, CHELICERA.fangRadius, 0.0005, CHELICERA.fangLength, 8);
  fang.position.set(0, -CHELICERA.fangLength * 0.5, 0);
  fang.rotation.x = 0; // curvature achieved via pivot + slight bend mesh below
  fangPivot.add(fang);

  return { root, fangPivot, fang };
}

// ---------------------------------------------------------------------
// Pedipalps (leg-like, but shorter; scripted FK, not IK)
// ---------------------------------------------------------------------
export function buildPedipalp(side, materials) {
  const order = ['coxa', 'trochanter', 'femur', 'patella', 'tibia', 'tarsus'];
  const totalLen = BASE_LEG_LENGTH * PEDIPALP.lengthScale;
  const root = new THREE.Group();
  root.name = `pedipalp_${side > 0 ? 'R' : 'L'}`;

  let cursor = root;
  const joints = [];
  const radii = [];
  for (let i = 0; i < order.length; i++) {
    const key = order[i];
    const len = PEDIPALP.fractions[key] * totalLen;
    const r0 = PEDIPALP.radii[key] * totalLen * 0.5;
    const nextKey = order[i + 1] || null;
    const r1 = (nextKey ? PEDIPALP.radii[nextKey] : PEDIPALP.radii.tip) * totalLen * 0.5;
    const mat = key === 'patella' || key === 'tibia' ? materials.jointGloss : materials.exoskeleton;
    const seg = taperedSegment(mat, r0, r1, len, 8);
    seg.position.set(0, len * 0.5, 0);
    const pivot = new THREE.Group();
    pivot.add(seg);
    cursor.add(pivot);
    pivot.userData.restLen = len;
    joints.push(pivot);
    radii.push(r0);
    const endPivot = new THREE.Group();
    endPivot.position.set(0, len, 0);
    pivot.add(endPivot);
    cursor = endPivot;
    if (key !== 'coxa' && key !== 'trochanter') {
      attachFur(seg, { material: materials.furBrown, density: 90, length: len * 0.22, lengthVariance: 0.6, radius: 0.0005, combBack: 0.5 });
    }
  }
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.0025, 0.006, 6), materials.claw);
  tip.position.set(0, 0.003, 0);
  cursor.add(tip);

  return { root, joints, endEffector: cursor };
}

// ---------------------------------------------------------------------
// Walking legs (IK-driven)
// ---------------------------------------------------------------------
export function buildLeg(pairIndex, side, materials) {
  const pair = LEG_PAIRS[pairIndex];
  const totalLen = BASE_LEG_LENGTH * pair.lengthScale;

  const lengths = {};
  for (const key of LEG_ORDER) lengths[key] = LEG_SEGMENT_FRACTIONS[key] * totalLen;
  const radii = {};
  for (const key of LEG_ORDER) radii[key] = LEG_SEGMENT_RADII[key] * totalLen;
  radii.tip = LEG_SEGMENT_RADII.tip * totalLen;

  // Hip anchor: fixed to body, oriented outward at splay/elevation angles.
  const hipAnchor = new THREE.Group();
  hipAnchor.name = `hip_${pair.id}_${side > 0 ? 'R' : 'L'}`;
  const splay = THREE.MathUtils.degToRad(pair.splayDeg) * side;
  const elev = THREE.MathUtils.degToRad(pair.elevDeg);
  hipAnchor.position.set(
    BODY.prosomaLength * 0.5 * pair.attachT * 0.75,
    -BODY.prosomaHeight * 0.15,
    Math.sin(splay) * BODY.prosomaWidth * 0.46 * (splay === 0 ? 0 : 1)
  );
  hipAnchor.position.x = pair.attachT * BODY.prosomaLength * 0.42;
  hipAnchor.position.z = Math.sign(side) * BODY.prosomaWidth * 0.42;

  // outward direction (in body local space) the coxa+trochanter stub points
  const outDir = new THREE.Vector3(Math.cos(splay) * 0.35, -Math.sin(elev), Math.sin(splay)).normalize();

  const materialsBySeg = {
    coxa: materials.exoskeleton,
    trochanter: materials.exoskeleton,
    femur: materials.exoskeleton,
    patella: materials.jointGloss,
    tibia: materials.jointGloss,
    metatarsus: materials.exoskeleton,
    tarsus: materials.tarsusGlossy,
  };

  // coxa + trochanter: short, fixed rigid stub relative to the body.
  const stubGroup = new THREE.Group();
  hipAnchor.add(stubGroup);
  let cursorPos = new THREE.Vector3(0, 0, 0);
  const coxaLen = lengths.coxa, trochLen = lengths.trochanter;
  const coxaEnd = cursorPos.clone().addScaledVector(outDir, coxaLen);
  const coxaMesh = taperedSegment(materialsBySeg.coxa, radii.coxa * 0.5, radii.trochanter * 0.5, coxaLen, 8);
  placeLocalSegment(coxaMesh, cursorPos, coxaEnd);
  stubGroup.add(coxaMesh);
  stubGroup.add(jointSphereAt(materials.exoskeleton, coxaEnd, radii.coxa * 0.45));

  const trochEnd = coxaEnd.clone().addScaledVector(outDir, trochLen * 0.5).addScaledVector(new THREE.Vector3(0, -1, 0), trochLen * 0.4);
  const trochMesh = taperedSegment(materialsBySeg.trochanter, radii.trochanter * 0.5, radii.femur * 0.5, trochLen, 8);
  placeLocalSegment(trochMesh, coxaEnd, trochEnd);
  stubGroup.add(trochMesh);
  stubGroup.add(jointSphereAt(materials.exoskeleton, trochEnd, radii.trochanter * 0.42));

  // IK root marker (world-space anchor for the FABRIK chain = end of trochanter)
  const ikRoot = new THREE.Group();
  ikRoot.position.copy(trochEnd);
  stubGroup.add(ikRoot);

  const ikLengths = [lengths.femur, lengths.patella, lengths.tibia, lengths.metatarsus, lengths.tarsus];
  const ikChain = new LegIKChain(ikLengths);

  const segKeys = ['femur', 'patella', 'tibia', 'metatarsus', 'tarsus'];
  const segMeshes = [];
  const jointSpheres = [];
  const scene = new THREE.Group(); // holds the dynamically-posed IK segments in WORLD space
  for (let i = 0; i < segKeys.length; i++) {
    const key = segKeys[i];
    const nextKey = segKeys[i + 1];
    const r0 = radii[key] * 0.5;
    const r1 = (nextKey ? radii[nextKey] : radii.tip) * 0.5;
    const mesh = taperedSegment(materialsBySeg[key], r0, r1, ikLengths[i], 8);
    scene.add(mesh);
    segMeshes.push(mesh);
    const js = jointSphere(materialsBySeg[key], r0 * 0.9);
    scene.add(js);
    jointSpheres.push(js);

    if (key !== 'tarsus') {
      attachFur(mesh, {
        material: materials.furBrown,
        density: Math.round(90 * (r0 / (radii.femur * 0.5)) + 40),
        length: ikLengths[i] * 0.16,
        lengthVariance: 0.6,
        radius: 0.0005,
        combBack: 0.6,
      });
    } else {
      attachFur(mesh, { material: materials.furBrown, density: 60, length: ikLengths[i] * 0.22, lengthVariance: 0.7, radius: 0.0005, combBack: 0.8 });
    }
  }
  // tip claws
  const clawGroup = new THREE.Group();
  for (const sgn of [-1, 1]) {
    const claw = new THREE.Mesh(new THREE.ConeGeometry(radii.tip * 0.9, radii.tip * 5.5, 6), materials.claw);
    claw.rotation.z = sgn * 0.35;
    clawGroup.add(claw);
  }
  scene.add(clawGroup);

  return {
    pairId: pair.id,
    side,
    hipAnchor, ikRoot, ikChain, ikLengths, totalLen,
    scene, segMeshes, jointSpheres, clawGroup,
    outDirLocal: outDir,
  };
}

function placeLocalSegment(mesh, a, b) {
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const dir = b.clone().sub(a).normalize();
  mesh.position.copy(mid);
  mesh.quaternion.setFromUnitVectors(UP, dir);
}

function jointSphereAt(material, pos, radius) {
  const s = jointSphere(material, radius);
  s.position.copy(pos);
  return s;
}
