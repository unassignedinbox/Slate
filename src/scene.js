import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const PAINTS = {
  factory: 0xc8e944,
  'volt-livery': 0x48d6bd,
  'ghost-livery': 0xa3afb1,
  'neon-kit': 0xc8e944,
  'race-pack': 0xd1ed52,
};

const TIRE_ACCENTS = {
  SOFT: 0xf36f5b,
  MEDIUM: 0xe8ebdd,
  HARD: 0x95b5c2,
  WET: 0x7fdcaa,
};

function standard(color, options = {}) {
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.36,
    metalness: 0.22,
    clearcoat: 0.55,
    clearcoatRoughness: 0.28,
    ...options,
  });
}

function addBox(parent, dimensions, position, material, rotation = [0, 0, 0]) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...dimensions), material);
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function makeExtrudedShape(points, depth, bevel = 0.035) {
  const shape = new THREE.Shape();
  points.forEach(([x, y], index) => {
    if (index === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  });
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    steps: 1,
    curveSegments: 8,
    bevelEnabled: bevel > 0,
    bevelSegments: 3,
    bevelThickness: bevel,
    bevelSize: bevel,
  });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}

function addRim(parent, x, y, z, side, scale = 1) {
  const faceZ = z + side * 0.185 * scale;
  const rimMaterial = standard(0x8d9996, { color: 0x8d9996, metalness: 0.86, roughness: 0.23, clearcoat: 0.1 });
  const darkMetal = standard(0x313a39, { metalness: 0.8, roughness: 0.3 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.225 * scale, 0.029 * scale, 8, 32), rimMaterial);
  ring.position.set(x, y, faceZ);
  parent.add(ring);
  const innerRing = new THREE.Mesh(new THREE.TorusGeometry(0.14 * scale, 0.014 * scale, 6, 28), darkMetal);
  innerRing.position.set(x, y, faceZ + side * 0.008);
  parent.add(innerRing);
  for (let spoke = 0; spoke < 5; spoke += 1) {
    const angle = (Math.PI * 2 * spoke) / 5 + Math.PI / 10;
    const spokeMesh = addBox(parent, [0.28 * scale, 0.027 * scale, 0.025 * scale], [
      x + Math.cos(angle) * 0.095 * scale,
      y + Math.sin(angle) * 0.095 * scale,
      faceZ + side * 0.013,
    ], rimMaterial, [0, 0, angle]);
    spokeMesh.castShadow = false;
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.055 * scale, 0.055 * scale, 0.035 * scale, 20), darkMetal);
  hub.rotation.x = Math.PI / 2;
  hub.position.set(x, y, faceZ + side * 0.023);
  parent.add(hub);
  return { ring, faceZ };
}

function buildWheel(parent, x, y, z, scale = 1, tint = 0x111718) {
  const group = new THREE.Group();
  group.position.set(x, y, z);
  parent.add(group);
  const tireMaterial = standard(tint, { color: tint, roughness: 0.88, metalness: 0.05, clearcoat: 0.08 });
  const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.385 * scale, 0.385 * scale, 0.35 * scale, 40), tireMaterial);
  wheel.rotation.x = Math.PI / 2;
  wheel.castShadow = true;
  wheel.receiveShadow = true;
  group.add(wheel);
  const wheelZ = 0.035 * scale;
  addRim(group, 0, 0, wheelZ, 1, scale);
  addRim(group, 0, 0, wheelZ, -1, scale);
  const outsideSide = 1;
  const outsideRing = new THREE.Mesh(new THREE.TorusGeometry(0.287 * scale, 0.008 * scale, 5, 48), standard(0x4c5653, { metalness: 0.65, roughness: 0.36 }));
  outsideRing.position.z = outsideSide * 0.185 * scale + 0.032 * scale;
  group.add(outsideRing);
  return group;
}

function buildCar(options = {}) {
  const paint = PAINTS[options.equipped] ?? PAINTS.factory;
  const shellMaterial = standard(paint, { metalness: 0.68, roughness: 0.25, clearcoat: 0.9, clearcoatRoughness: 0.18 });
  const lowerMaterial = standard(0x222a2b, { metalness: 0.72, roughness: 0.39, clearcoat: 0.3 });
  const canopyMaterial = standard(0x111b1c, { color: 0x101819, metalness: 0.68, roughness: 0.19, clearcoat: 1, clearcoatRoughness: 0.08 });
  const trimMaterial = standard(0xe0f1ec, { metalness: 0.78, roughness: 0.24, emissive: 0x20342a, emissiveIntensity: 0.18 });
  const accentColor = options.equipped === 'neon-kit' ? 0xca9cff : 0xd6ff3a;
  const accentMaterial = standard(accentColor, { emissive: accentColor, emissiveIntensity: options.equipped === 'neon-kit' ? 0.8 : 0.48, roughness: 0.31, metalness: 0.34 });
  const headlampMaterial = new THREE.MeshStandardMaterial({ color: 0xd6fff2, emissive: 0x68ffdd, emissiveIntensity: 2.1, roughness: 0.18 });
  const tailMaterial = new THREE.MeshStandardMaterial({ color: 0xff6554, emissive: 0xff2815, emissiveIntensity: 1.4 });
  const group = new THREE.Group();

  const body = new THREE.Mesh(makeExtrudedShape([
    [-2.33, 0.37], [-2.23, 0.59], [-1.56, 0.7], [-0.93, 0.81], [-0.52, 1.08],
    [0.21, 1.08], [0.82, 0.79], [1.55, 0.7], [2.15, 0.55], [2.16, 0.35],
    [1.78, 0.29], [-1.92, 0.29],
  ], 1.3, 0.042), shellMaterial);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const belly = addBox(group, [3.86, 0.15, 1.12], [-0.06, 0.305, 0], lowerMaterial);
  belly.castShadow = true;

  const canopy = new THREE.Mesh(makeExtrudedShape([
    [-0.86, 0.83], [-0.48, 1.14], [-0.13, 1.2], [0.3, 1.16], [0.75, 0.83],
  ], 0.99, 0.025), canopyMaterial);
  canopy.castShadow = true;
  group.add(canopy);

  // The roof spine and glazing make the silhouette read clearly at a glance.
  addBox(group, [0.82, 0.027, 0.022], [-0.08, 1.201, -0.04], trimMaterial, [0, 0, -0.025]);
  addBox(group, [0.78, 0.022, 0.02], [-0.08, 1.197, 0.04], trimMaterial, [0, 0, -0.025]);
  for (const side of [-1, 1]) {
    addBox(group, [1.06, 0.022, 0.027], [-0.06, 0.847, side * 0.645], accentMaterial, [0, 0, 0.008]);
    addBox(group, [0.38, 0.018, 0.03], [0.05, 0.71, side * 0.669], trimMaterial);
  }

  // Wide arches sit over four physically separate wheels.
  const wheels = [];
  const wheelPositions = [
    { x: -1.28, y: 0.405, z: -0.69 },
    { x: -1.28, y: 0.405, z: 0.69 },
    { x: 1.33, y: 0.405, z: -0.69 },
    { x: 1.33, y: 0.405, z: 0.69 },
  ];
  for (const pos of wheelPositions) {
    const wheel = buildWheel(group, pos.x, pos.y, pos.z, 1, 0x101515);
    wheels.push(wheel);
  }

  for (const side of [-1, 1]) {
    addBox(group, [0.72, 0.045, 0.025], [-1.95, 0.295, side * 0.51], lowerMaterial);
    addBox(group, [0.52, 0.043, 0.03], [1.95, 0.3, side * 0.5], lowerMaterial);
    const frontLamp = addBox(group, [0.035, 0.052, 0.26], [-2.27, 0.545, side * 0.38], headlampMaterial, [0.05, 0, 0]);
    frontLamp.castShadow = false;
    const tail = addBox(group, [0.026, 0.045, 0.27], [2.13, 0.54, side * 0.43], tailMaterial);
    tail.castShadow = false;
  }

  const wing = new THREE.Group();
  group.add(wing);
  addBox(wing, [0.065, 0.25, 0.045], [1.82, 0.755, -0.43], lowerMaterial, [0, 0, -0.15]);
  addBox(wing, [0.065, 0.25, 0.045], [1.82, 0.755, 0.43], lowerMaterial, [0, 0, -0.15]);
  const wingMain = addBox(wing, [0.54, 0.065, 1.34], [1.87, 0.89, 0], shellMaterial, [0, 0, -0.02]);
  const wingFlap = addBox(wing, [0.34, 0.035, 1.29], [1.61, 0.951, 0], accentMaterial, [0, 0, 0]);
  wingFlap.geometry.translate(-0.15, 0, 0);
  wingFlap.userData.hingeX = 1.76;
  const drsOpen = Boolean(options.drs);
  wingFlap.position.x = drsOpen ? 1.58 : 1.61;
  wingFlap.position.y = drsOpen ? 0.985 : 0.951;
  wingFlap.rotation.z = drsOpen ? 0.14 : 0;

  const splitter = addBox(group, [0.64, 0.045, 1.48], [-2.03, 0.29, 0], lowerMaterial, [0, 0, -0.03]);
  splitter.castShadow = false;
  addBox(group, [0.6, 0.024, 0.016], [-1.82, 0.655, -0.66], accentMaterial, [0, 0, -0.12]);
  addBox(group, [0.6, 0.024, 0.016], [-1.82, 0.655, 0.66], accentMaterial, [0, 0, -0.12]);
  if (options.equipped === 'neon-kit') {
    const underglow = new THREE.PointLight(0xc291ff, 22, 3.6, 2);
    underglow.position.set(0, 0.24, 0);
    group.add(underglow);
  }

  return { group, wheels, wingFlap, shellMaterial, accentMaterial };
}

function makeGroundStage(scene, mode = 'car') {
  const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x101819, roughness: 0.9, metalness: 0.2, transparent: true, opacity: 0.58 });
  const floor = new THREE.Mesh(new THREE.CircleGeometry(mode === 'suspension' ? 2.4 : 3.75, 80), floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.012;
  floor.receiveShadow = true;
  scene.add(floor);

  const ringMaterial = new THREE.MeshBasicMaterial({ color: 0x96c431, transparent: true, opacity: 0.27, side: THREE.DoubleSide });
  for (const [radius, opacity] of [[2.66, 0.25], [3.12, 0.13]]) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(radius, radius + 0.009, 96), ringMaterial.clone());
    ring.material.opacity = opacity;
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.008;
    scene.add(ring);
  }

  const axisMatX = new THREE.LineBasicMaterial({ color: 0x93d92c, transparent: true, opacity: 0.23 });
  const axisMatZ = new THREE.LineBasicMaterial({ color: 0x5aa49c, transparent: true, opacity: 0.17 });
  const axisX = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-2.8, 0.018, 0), new THREE.Vector3(2.8, 0.018, 0)]);
  const axisZ = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.018, -2.8), new THREE.Vector3(0, 0.018, 2.8)]);
  scene.add(new THREE.Line(axisX, axisMatX), new THREE.Line(axisZ, axisMatZ));
}

function makeSpring(height = 0.76, radius = 0.135, turns = 7, material) {
  const points = [];
  const count = turns * 28;
  for (let i = 0; i <= count; i += 1) {
    const t = i / count;
    const angle = t * turns * Math.PI * 2;
    points.push(new THREE.Vector3(Math.cos(angle) * radius, t * height, Math.sin(angle) * radius));
  }
  const curve = new THREE.CatmullRomCurve3(points);
  const spring = new THREE.Mesh(new THREE.TubeGeometry(curve, count, 0.025, 8, false), material);
  spring.castShadow = true;
  return spring;
}

function makeRod(parent, start, end, radius, material) {
  const startPoint = new THREE.Vector3(...start);
  const endPoint = new THREE.Vector3(...end);
  const direction = new THREE.Vector3().subVectors(endPoint, startPoint);
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, direction.length(), 12), material);
  rod.position.copy(startPoint).add(endPoint).multiplyScalar(0.5);
  rod.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  rod.castShadow = true;
  parent.add(rod);
  return rod;
}

function buildSuspension() {
  const assembly = new THREE.Group();
  const frameMat = standard(0x465254, { metalness: 0.76, roughness: 0.29 });
  const armMat = standard(0x86928f, { metalness: 0.86, roughness: 0.24 });
  const damperMat = standard(0xd3ded4, { metalness: 0.88, roughness: 0.2, clearcoat: 0.45 });
  const springMat = standard(0xc9e747, { metalness: 0.62, roughness: 0.24, emissive: 0x556c10, emissiveIntensity: 0.25 });
  const tyreMat = standard(0x121718, { roughness: 0.88, metalness: 0.04 });

  addBox(assembly, [1.65, 0.23, 0.94], [-0.35, 1.64, 0], frameMat, [0, 0, -0.05]);
  addBox(assembly, [0.43, 0.11, 1.26], [-0.45, 1.48, 0], standard(0x222b2c, { metalness: 0.77 }), [0, 0, -0.04]);
  addBox(assembly, [0.35, 0.1, 0.9], [-0.4, 0.37, 0], frameMat);
  const upright = addBox(assembly, [0.11, 0.79, 0.22], [0.93, 0.81, 0], standard(0x9ca9a4, { metalness: 0.85, roughness: 0.27 }), [0, 0, 0.02]);

  const controlPoints = [
    [[-0.86, 1.57, -0.46], [0.88, 0.88, -0.17]],
    [[-0.86, 1.57, 0.46], [0.88, 0.88, 0.17]],
    [[-0.87, 0.53, -0.5], [0.94, 0.61, -0.14]],
    [[-0.87, 0.53, 0.5], [0.94, 0.61, 0.14]],
    [[-0.76, 0.53, 0], [0.84, 0.61, 0]],
  ];
  for (const [start, end] of controlPoints) makeRod(assembly, start, end, 0.042, armMat);
  makeRod(assembly, [-0.15, 1.56, 0], [0.5, 0.86, 0], 0.071, damperMat);
  const spring = makeSpring(0.71, 0.155, 7, springMat);
  spring.position.set(0.17, 0.88, 0);
  assembly.add(spring);
  const topMount = new THREE.Mesh(new THREE.SphereGeometry(0.17, 20, 16), standard(0x5b6868, { metalness: 0.78 }));
  topMount.position.set(0.17, 1.68, 0);
  assembly.add(topMount);
  const lowerMount = new THREE.Mesh(new THREE.SphereGeometry(0.13, 20, 16), armMat);
  lowerMount.position.set(0.17, 0.84, 0);
  assembly.add(lowerMount);

  const wheelGroup = new THREE.Group();
  wheelGroup.position.set(1.15, 0.68, 0);
  assembly.add(wheelGroup);
  const tyre = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.32, 52), tyreMat);
  tyre.rotation.x = Math.PI / 2;
  tyre.castShadow = true;
  tyre.receiveShadow = true;
  wheelGroup.add(tyre);
  const face = new THREE.Mesh(new THREE.CylinderGeometry(0.39, 0.39, 0.34, 40), standard(0x36403f, { metalness: 0.8, roughness: 0.27 }));
  face.rotation.x = Math.PI / 2;
  wheelGroup.add(face);
  const wheelRing = new THREE.Mesh(new THREE.TorusGeometry(0.47, 0.027, 8, 48), damperMat);
  wheelRing.position.z = 0.18;
  wheelGroup.add(wheelRing);
  for (let i = 0; i < 8; i += 1) {
    const angle = (Math.PI * 2 * i) / 8;
    addBox(wheelGroup, [0.48, 0.032, 0.027], [Math.cos(angle) * 0.12, Math.sin(angle) * 0.12, 0.196], armMat, [0, 0, angle]);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.105, 0.04, 24), springMat);
  hub.rotation.x = Math.PI / 2;
  hub.position.z = 0.22;
  wheelGroup.add(hub);

  // A few visible fasteners and the upright's two spherical joints sell the assembly scale.
  for (const y of [0.57, 1.02]) {
    const joint = new THREE.Mesh(new THREE.SphereGeometry(0.09, 18, 14), standard(0x65716f, { metalness: 0.8 }));
    joint.position.set(0.92, y, 0.12);
    assembly.add(joint);
  }
  const labelPlate = addBox(assembly, [0.42, 0.18, 0.03], [-0.64, 1.83, 0.49], standard(0x1c2525, { metalness: 0.55, roughness: 0.32 }));
  labelPlate.castShadow = false;
  const screwMaterial = standard(0xd0dbd2, { metalness: 0.9, roughness: 0.2 });
  for (const x of [-0.79, -0.49]) {
    const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.04, 12), screwMaterial);
    screw.rotation.x = Math.PI / 2;
    screw.position.set(x, 1.83, 0.52);
    assembly.add(screw);
  }

  return {
    group: assembly,
    wheelGroup,
    spring,
    damper: assembly.children.find((child) => child.isMesh && child.geometry?.type === 'CylinderGeometry' && child.scale.y === 1),
  };
}

function buildTire(compound = 'SOFT') {
  const group = new THREE.Group();
  const rubber = standard(0x14191a, { roughness: 0.9, metalness: 0.02, clearcoat: 0.06 });
  const alloy = standard(0x87928e, { metalness: 0.88, roughness: 0.21, clearcoat: 0.3 });
  const inner = standard(0x272f30, { metalness: 0.72, roughness: 0.31 });
  const accent = standard(TIRE_ACCENTS[compound] ?? TIRE_ACCENTS.SOFT, { emissive: TIRE_ACCENTS[compound] ?? TIRE_ACCENTS.SOFT, emissiveIntensity: 0.35, metalness: 0.35, roughness: 0.25 });

  const tire = new THREE.Mesh(new THREE.TorusGeometry(0.79, 0.22, 22, 80), rubber);
  tire.castShadow = true;
  tire.receiveShadow = true;
  group.add(tire);
  const outerBead = new THREE.Mesh(new THREE.TorusGeometry(0.81, 0.014, 7, 64), standard(0x5c6662, { metalness: 0.5, roughness: 0.4 }));
  outerBead.position.z = 0.11;
  group.add(outerBead);
  const sidewallStripe = new THREE.Mesh(new THREE.TorusGeometry(0.672, 0.017, 8, 72), accent);
  sidewallStripe.position.z = 0.19;
  group.add(sidewallStripe);
  const innerBead = new THREE.Mesh(new THREE.TorusGeometry(0.58, 0.031, 8, 64), alloy);
  innerBead.position.z = 0.22;
  group.add(innerBead);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.56, 0.56, 0.14, 56), inner);
  hub.rotation.x = Math.PI / 2;
  hub.position.z = 0.07;
  group.add(hub);
  const rimRing = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.04, 8, 64), alloy);
  rimRing.position.z = 0.16;
  group.add(rimRing);
  for (let i = 0; i < 10; i += 1) {
    const angle = (Math.PI * 2 * i) / 10;
    const spoke = addBox(group, [0.62, 0.036, 0.055], [Math.cos(angle) * 0.17, Math.sin(angle) * 0.17, 0.17], alloy, [0, 0, angle]);
    spoke.castShadow = false;
  }
  const center = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.09, 32), accent);
  center.rotation.x = Math.PI / 2;
  center.position.z = 0.205;
  group.add(center);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.073, 0.073, 0.1, 24), inner);
  cap.rotation.x = Math.PI / 2;
  cap.position.z = 0.257;
  group.add(cap);

  // Short, raised tread blocks make the rubber read as a usable race tyre in 3D.
  const treadMat = standard(0x242b2b, { roughness: 0.94, metalness: 0.02 });
  for (let i = 0; i < 38; i += 1) {
    const angle = (Math.PI * 2 * i) / 38;
    const tread = addBox(group, [0.056, 0.034, 0.245], [Math.cos(angle) * 0.985, Math.sin(angle) * 0.985, 0], treadMat, [0, 0, angle]);
    tread.castShadow = false;
  }
  return { group, accent };
}

function addAirflow(scene, flowMaterial) {
  const flowLines = [];
  const levels = [
    { y: 0.82, z: -0.83, lift: 0.2 },
    { y: 1.04, z: -0.62, lift: 0.46 },
    { y: 1.38, z: -0.34, lift: 0.7 },
    { y: 1.56, z: 0, lift: 0.76 },
    { y: 1.38, z: 0.34, lift: 0.7 },
    { y: 1.04, z: 0.62, lift: 0.46 },
    { y: 0.82, z: 0.83, lift: 0.2 },
  ];
  for (const [index, line] of levels.entries()) {
    const points = [
      new THREE.Vector3(-3.2, line.y, line.z),
      new THREE.Vector3(-2.6, line.y + 0.02, line.z),
      new THREE.Vector3(-1.85, line.y + line.lift * 0.35, line.z),
      new THREE.Vector3(-0.9, line.y + line.lift, line.z),
      new THREE.Vector3(0.05, line.y + line.lift * 0.91, line.z),
      new THREE.Vector3(1.06, line.y + line.lift * 0.38, line.z),
      new THREE.Vector3(2.08, line.y + 0.02, line.z),
      new THREE.Vector3(2.86, line.y + 0.05, line.z),
    ];
    const curve = new THREE.CatmullRomCurve3(points);
    const material = flowMaterial.clone();
    material.opacity = index === 3 ? 0.72 : 0.41;
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 64, index === 3 ? 0.012 : 0.009, 6, false), material);
    scene.add(tube);
    flowLines.push({ curve, tube, material });
    const bead = new THREE.Mesh(new THREE.SphereGeometry(index === 3 ? 0.034 : 0.023, 10, 8), standard(0xd9ff52, { emissive: 0x8dbe20, emissiveIntensity: 1.3, roughness: 0.3 }));
    bead.userData.phase = index / levels.length;
    scene.add(bead);
    flowLines[flowLines.length - 1].bead = bead;
  }
  return flowLines;
}

function setCanvasSize(renderer, camera, element) {
  const width = Math.max(1, element.clientWidth);
  const height = Math.max(1, element.clientHeight);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

export function mountScene(container, type, options = {}) {
  const canvasHolder = container.querySelector('.model-canvas');
  if (!canvasHolder) return null;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 80);
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.className = 'three-canvas';
  renderer.domElement.setAttribute('aria-hidden', 'true');
  canvasHolder.appendChild(renderer.domElement);

  const hemi = new THREE.HemisphereLight(0xd7e5d7, 0x192120, 2.15);
  scene.add(hemi);
  const keyLight = new THREE.DirectionalLight(0xfff6dc, 3.3);
  keyLight.position.set(-3.5, 7, 4.5);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(1024, 1024);
  keyLight.shadow.camera.left = -5;
  keyLight.shadow.camera.right = 5;
  keyLight.shadow.camera.top = 5;
  keyLight.shadow.camera.bottom = -5;
  keyLight.shadow.bias = -0.0004;
  scene.add(keyLight);
  const rimLight = new THREE.PointLight(0xb8f735, 55, 10, 1.85);
  rimLight.position.set(2.5, 2.7, -2.8);
  scene.add(rimLight);
  const fillLight = new THREE.PointLight(0x45a9a0, 32, 9, 1.8);
  fillLight.position.set(-3.2, 2.4, 3.5);
  scene.add(fillLight);

  let controls;
  let model;
  let flowLines = [];
  let selectedWheel;
  let suspensionParts;
  let animationFrame = 0;
  let destroyed = false;
  const clock = new THREE.Clock();

  const baseControls = () => {
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.enablePan = false;
    controls.minPolarAngle = 0.48;
    controls.maxPolarAngle = 1.48;
    controls.minDistance = 3.2;
    controls.maxDistance = 9;
    controls.rotateSpeed = 0.57;
    controls.zoomSpeed = 0.62;
    controls.target.set(0, 0.65, 0);
    controls.update();
  };

  if (type === 'suspension') {
    camera.position.set(3.65, 2.72, 4.6);
    camera.fov = 36;
    const suspension = buildSuspension();
    suspensionParts = suspension;
    scene.add(suspension.group);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.055;
    controls.enablePan = false;
    controls.minPolarAngle = 0.58;
    controls.maxPolarAngle = 1.54;
    controls.minDistance = 2.6;
    controls.maxDistance = 6.6;
    controls.target.set(0.1, 0.98, 0);
    controls.update();
    makeGroundStage(scene, 'suspension');
    suspensionParts.wheelGroup.position.y = 0.68 + ((options.setup?.frontRide ?? 62) - 62) * 0.008;
  } else if (type === 'tyre') {
    camera.position.set(2.95, 2.84, 4.7);
    camera.fov = 33;
    const tyre = buildTire(options.tyres?.compound);
    selectedWheel = tyre;
    model = tyre.group;
    model.position.y = 0.82;
    scene.add(model);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.055;
    controls.enablePan = false;
    controls.minPolarAngle = 0.4;
    controls.maxPolarAngle = 1.6;
    controls.minDistance = 2.3;
    controls.maxDistance = 5.6;
    controls.target.set(0, 0.82, 0);
    controls.update();
    makeGroundStage(scene, 'tyre');
  } else {
    camera.position.set(5.3, 3.15, 5.35);
    camera.fov = type === 'car' ? 34 : 36;
    const car = buildCar({ equipped: options.equipped, drs: options.aero?.drs });
    model = car.group;
    model.scale.setScalar(type === 'car' && container.dataset.variant === 'hero' ? 1.08 : 0.94);
    scene.add(model);
    baseControls();
    makeGroundStage(scene, 'car');
    if (type === 'aero') {
      const flowMaterial = new THREE.MeshBasicMaterial({ color: 0xc8ff32, transparent: true, opacity: 0.42, depthWrite: false });
      flowLines = addAirflow(scene, flowMaterial);
      controls.target.set(0, 0.88, 0);
      controls.minDistance = 4.1;
      controls.maxDistance = 8.5;
      camera.position.set(5.25, 3.35, 5.9);
      controls.update();
    } else if (type === 'garage') {
      controls.target.set(0, 0.62, 0);
      controls.update();
    }
  }

  setCanvasSize(renderer, camera, canvasHolder);
  const resizeObserver = new ResizeObserver(() => setCanvasSize(renderer, camera, canvasHolder));
  resizeObserver.observe(canvasHolder);

  const renderFrame = () => {
    if (destroyed) return;
    animationFrame = window.requestAnimationFrame(renderFrame);
    controls?.update();
    if (flowLines.length) {
      const elapsed = clock.getElapsedTime();
      for (const { curve, bead } of flowLines) {
        bead.position.copy(curve.getPoint((elapsed * 0.14 + bead.userData.phase) % 1));
      }
    }
    renderer.render(scene, camera);
  };
  renderFrame();

  return {
    setSuspension(height) {
      if (!suspensionParts) return;
      const delta = (height - 62) * 0.008;
      suspensionParts.wheelGroup.position.y = 0.68 + delta;
      suspensionParts.spring.scale.y = Math.max(0.72, 1 + delta * 0.52);
      suspensionParts.spring.position.y = 0.88 + Math.max(-0.12, delta * 0.32);
    },
    destroy() {
      destroyed = true;
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      controls?.dispose();
      scene.traverse((object) => {
        if (object.geometry) object.geometry.dispose();
        if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
        else if (object.material) object.material.dispose();
      });
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
