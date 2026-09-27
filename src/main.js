import * as THREE from 'three';
import './style.css';

const canvas = document.querySelector('#scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.17;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9bb7c4);
scene.fog = new THREE.FogExp2(0x9db8c4, 0.018);

const camera = new THREE.PerspectiveCamera(43, window.innerWidth / window.innerHeight, 0.1, 120);
const clock = new THREE.Clock();

const hemi = new THREE.HemisphereLight(0xc3e8f2, 0x303123, 2.1);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffefd0, 3.5);
sun.position.set(-15, 20, 7);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -22;
sun.shadow.camera.right = 22;
sun.shadow.camera.top = 22;
sun.shadow.camera.bottom = -22;
sun.shadow.bias = -0.0002;
scene.add(sun);

const world = new THREE.Group();
scene.add(world);
const C = {
  steel: new THREE.MeshStandardMaterial({ color: 0x16262f, metalness: 0.88, roughness: 0.25 }),
  steelDark: new THREE.MeshStandardMaterial({ color: 0x071116, metalness: 0.83, roughness: 0.28 }),
  edge: new THREE.MeshStandardMaterial({ color: 0x86aeb3, metalness: 0.92, roughness: 0.18 }),
  policeBlue: new THREE.MeshStandardMaterial({ color: 0x104e71, metalness: 0.75, roughness: 0.19 }),
  policePale: new THREE.MeshStandardMaterial({ color: 0x7acbd1, metalness: 0.7, roughness: 0.2, emissive: 0x08212a, emissiveIntensity: 0.7 }),
  black: new THREE.MeshStandardMaterial({ color: 0x04080a, metalness: 0.65, roughness: 0.18 }),
  eye: new THREE.MeshPhysicalMaterial({ color: 0x020606, metalness: 0.18, roughness: 0.08, clearcoat: 1, emissive: 0x06454b, emissiveIntensity: 0.45 }),
  amber: new THREE.MeshPhysicalMaterial({ color: 0xffb738, transparent: true, opacity: 0.66, roughness: 0.13, metalness: 0.12, emissive: 0x673000, emissiveIntensity: 0.7, depthWrite: false }),
  red: new THREE.MeshStandardMaterial({ color: 0xff3d38, emissive: 0xff0800, emissiveIntensity: 2.8, roughness: 0.22 }),
  cyan: new THREE.MeshStandardMaterial({ color: 0x51f7ed, emissive: 0x13d7cc, emissiveIntensity: 2.4, roughness: 0.2 }),
};

function mesh(geometry, material, cast = true, receive = false) {
  const m = new THREE.Mesh(geometry, material);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}
function setShadow(object) {
  object.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return object;
}
function smoothstep(a, b, x) {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
function damp(a, b, lambda, dt) { return THREE.MathUtils.damp(a, b, lambda, dt); }
function dampV(v, target, lambda, dt) { v.x = damp(v.x, target.x, lambda, dt); v.y = damp(v.y, target.y, lambda, dt); v.z = damp(v.z, target.z, lambda, dt); return v; }
function seeded(n) { return (() => { let s = n; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; })(); }
const rand = seeded(2441);

// Ground and quiet canyon silhouettes.
const groundGeo = new THREE.PlaneGeometry(72, 72, 110, 110);
const gp = groundGeo.attributes.position;
for (let i = 0; i < gp.count; i++) {
  const x = gp.getX(i), y = gp.getY(i);
  const d = Math.hypot(x, y);
  const ripple = Math.sin(x * .52) * Math.sin(y * .4) * .12 + Math.sin(x * 1.7 + y) * .035;
  gp.setZ(i, ripple - smoothstep(13, 34, d) * (1.3 + .5 * Math.sin(x * .35)));
}
groundGeo.computeVertexNormals();
const ground = mesh(groundGeo, new THREE.MeshStandardMaterial({ color: 0x746e51, roughness: .96, metalness: .02 }), false, true);
ground.rotation.x = -Math.PI / 2;
world.add(ground);

const rockMats = [0x685c47, 0x806d51, 0x514b3d].map((color) => new THREE.MeshStandardMaterial({ color, roughness: .95, metalness: .01 }));
for (let i = 0; i < 42; i++) {
  const a = rand() * Math.PI * 2;
  const r = 10 + rand() * 22;
  const g = new THREE.DodecahedronGeometry(1, 1);
  const rock = mesh(g, rockMats[i % rockMats.length]);
  const h = .5 + rand() * 3.2;
  rock.scale.set(.8 + rand() * 2.2, h, .7 + rand() * 1.8);
  rock.position.set(Math.cos(a) * r, h * .48 - .1, Math.sin(a) * r);
  rock.rotation.set(rand() * .35, rand() * Math.PI, rand() * .35);
  world.add(rock);
}
for (let i = 0; i < 50; i++) {
  const x = (rand() - .5) * 26, z = (rand() - .5) * 25;
  if (Math.hypot(x, z) < 6) continue;
  const pebble = mesh(new THREE.DodecahedronGeometry(.06 + rand() * .19), rockMats[i % 3], true, true);
  pebble.scale.y = .45;
  pebble.position.set(x, .05, z);
  pebble.rotation.set(rand(), rand(), rand());
  world.add(pebble);
}

// Fuel-hauler: deliberately physical enough to give the drone a convincing landing surface.
const truck = new THREE.Group();
world.add(truck);
const truckPaint = new THREE.MeshStandardMaterial({ color: 0x283e44, metalness: .62, roughness: .29 });
const truckLight = new THREE.MeshStandardMaterial({ color: 0xb9ddd7, metalness: .52, roughness: .24 });
const rubber = new THREE.MeshStandardMaterial({ color: 0x090d0d, roughness: .76, metalness: .07 });
const orange = new THREE.MeshStandardMaterial({ color: 0xf5a044, emissive: 0x4a1600, emissiveIntensity: .55, roughness: .25 });
const chassis = mesh(new THREE.BoxGeometry(2.2, .38, 6.2), C.steelDark); chassis.position.y = .68; truck.add(chassis);
const cab = mesh(new THREE.BoxGeometry(2.05, 1.6, 1.72), truckPaint); cab.position.set(0, 1.55, -2.2); cab.geometry.translate(0, 0, 0); truck.add(cab);
const windscreen = mesh(new THREE.BoxGeometry(1.73, .66, .025), new THREE.MeshPhysicalMaterial({ color: 0x5fadb6, metalness: .25, roughness: .08, transparent: true, opacity: .8 })); windscreen.position.set(0, 1.85, -3.07); truck.add(windscreen);
const grille = mesh(new THREE.BoxGeometry(1.36, .39, .05), C.black); grille.position.set(0, 1.1, -3.1); truck.add(grille);
for (const x of [-.74, .74]) { const headlamp = mesh(new THREE.BoxGeometry(.24, .17, .06), truckLight); headlamp.position.set(x, 1.24, -3.12); truck.add(headlamp); }
const tankMat = new THREE.MeshPhysicalMaterial({ color: 0x7c9592, metalness: .82, roughness: .2, clearcoat: .8, clearcoatRoughness: .14 });
const tank = mesh(new THREE.CylinderGeometry(1.02, 1.02, 3.63, 32, 1, false), tankMat); tank.rotation.x = Math.PI / 2; tank.position.set(0, 1.7, .48); truck.add(tank);
const tankRimMat = new THREE.MeshStandardMaterial({ color: 0x253d40, metalness: .9, roughness: .19 });
for (const z of [-1.32, 2.28]) { const ring = mesh(new THREE.TorusGeometry(1.04, .057, 8, 32), tankRimMat); ring.rotation.x = Math.PI / 2; ring.position.set(0, 1.7, z); truck.add(ring); }
for (const z of [-.66, .45, 1.56]) { const strap = mesh(new THREE.TorusGeometry(1.035, .03, 7, 28), C.edge); strap.rotation.x = Math.PI / 2; strap.position.set(0, 1.7, z); truck.add(strap); }
const cap = mesh(new THREE.CylinderGeometry(.28, .28, .1, 16), C.steel); cap.position.set(0, 2.73, .65); truck.add(cap);
for (const z of [-2.15, 1.9]) {
  for (const x of [-1.15, 1.15]) {
    const tire = mesh(new THREE.CylinderGeometry(.52, .52, .28, 16), rubber); tire.rotation.z = Math.PI / 2; tire.position.set(x, .53, z); truck.add(tire);
    const hub = mesh(new THREE.CylinderGeometry(.22, .22, .3, 16), C.edge); hub.rotation.z = Math.PI / 2; hub.position.set(x * 1.01, .53, z); truck.add(hub);
  }
}
for (const x of [-1.12, 1.12]) { const rail = mesh(new THREE.CylinderGeometry(.028, .028, 4.4, 8), C.edge); rail.rotation.x = Math.PI / 2; rail.position.set(x, .88, .5); truck.add(rail); }

const contactPoint = new THREE.Vector3(1.012, 1.68, .48);
const tankNormal = new THREE.Vector3(1, 0, 0);
const hole = mesh(new THREE.CylinderGeometry(.088, .088, .018, 18), new THREE.MeshStandardMaterial({ color: 0x090b09, roughness: .78, metalness: .18 }));
hole.rotation.z = Math.PI / 2; hole.position.copy(contactPoint).addScaledVector(tankNormal, .01); hole.visible = false; truck.add(hole);
const holeHalo = mesh(new THREE.TorusGeometry(.11, .014, 7, 18), new THREE.MeshStandardMaterial({ color: 0xff842e, emissive: 0xff4312, emissiveIntensity: 0, metalness: .52 })); holeHalo.rotation.y = Math.PI / 2; holeHalo.position.copy(contactPoint).addScaledVector(tankNormal, .022); holeHalo.visible = false; truck.add(holeHalo);

function cylinderBetween(parent, a, b, radius, material, radial = 8) {
  const part = mesh(new THREE.CylinderGeometry(radius, radius * .9, 1, radial), material);
  parent.add(part);
  placeBetween(part, a, b);
  return part;
}
function placeBetween(part, a, b) {
  const delta = new THREE.Vector3().subVectors(b, a);
  part.position.copy(a).addScaledVector(delta, .5);
  part.scale.set(1, delta.length(), 1);
  part.quaternion.setFromUnitVectors(UP, delta.normalize());
}
const UP = new THREE.Vector3(0, 1, 0);

function makeWing(side) {
  const hinge = new THREE.Group();
  // Mosquito wings emerge above the thorax and trail behind it; they are deliberately narrow, not insect-sized fans.
  hinge.position.set(side * .18, .18, .06);
  const wing = new THREE.Group();
  hinge.add(wing);
  const shape = new THREE.Shape();
  shape.moveTo(0, -.025);
  shape.quadraticCurveTo(side * .34, -.16, side * .98, -.15);
  shape.quadraticCurveTo(side * 1.58, -.10, side * 1.77, .03);
  shape.quadraticCurveTo(side * 1.17, .17, side * .48, .18);
  shape.quadraticCurveTo(side * .12, .13, 0, .025);
  const wingMat = new THREE.MeshPhysicalMaterial({ color: 0x8dc6c7, transparent: true, opacity: .31, roughness: .17, metalness: .12, side: THREE.DoubleSide, depthWrite: false });
  const membrane = mesh(new THREE.ShapeGeometry(shape), wingMat, false, false);
  membrane.rotation.x = Math.PI / 2;
  wing.add(membrane);
  const veinMat = new THREE.LineBasicMaterial({ color: 0x31575a, transparent: true, opacity: .92 });
  const veins = [
    [[0, 0, 0], [side * 1.67, 0, .025]],
    [[side * .2, 0, 0], [side * .65, 0, .16]],
    [[side * .45, 0, 0], [side * 1.1, 0, .13]],
    [[side * .8, 0, .005], [side * 1.42, 0, .075]],
    [[side * .3, 0, -.03], [side * .84, 0, -.13]],
  ];
  veins.forEach((points) => {
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points.map((p) => new THREE.Vector3(...p))), veinMat);
    wing.add(line);
  });
  const hub = mesh(new THREE.SphereGeometry(.075, 10, 8), C.edge); wing.add(hub);
  return { hinge, wing, membrane, side };
}

function createMosquito() {
  const root = new THREE.Group();
  const anatomy = new THREE.Group();
  root.add(anatomy);
  world.add(root);

  // Restrained police hardware follows real mosquito anatomy rather than replacing it with a cartoon robot shell.
  const cuticle = new THREE.MeshStandardMaterial({ color: 0x151f22, metalness: .78, roughness: .34 });
  const stripe = new THREE.MeshStandardMaterial({ color: 0x91a9a1, metalness: .72, roughness: .25 });
  const thorax = mesh(new THREE.SphereGeometry(.42, 24, 16), cuticle); thorax.scale.set(.83, .72, 1.06); anatomy.add(thorax);
  const dorsalPlate = mesh(new THREE.SphereGeometry(.425, 20, 10, 0, Math.PI * 2, 0, Math.PI * .42), C.policeBlue);
  dorsalPlate.scale.set(.835, .725, 1.065); dorsalPlate.rotation.x = -.15; dorsalPlate.position.y = .055; anatomy.add(dorsalPlate);
  const dorsalSeam = mesh(new THREE.BoxGeometry(.04, .025, .71), C.policePale); dorsalSeam.position.set(0, .34, .08); anatomy.add(dorsalSeam);

  const abdomen = new THREE.Group(); abdomen.position.set(0, .005, .72); anatomy.add(abdomen);
  const reservoir = mesh(new THREE.CylinderGeometry(.105, .285, 1.62, 16), C.amber, false);
  reservoir.rotation.x = Math.PI / 2; reservoir.position.z = .09; abdomen.add(reservoir);
  const bands = [];
  for (let i = 0; i < 7; i++) {
    const r = .295 - i * .023;
    const segment = mesh(new THREE.SphereGeometry(.5, 18, 12), i % 2 ? cuticle : C.steelDark);
    segment.scale.set(r * 1.02, r * .76, .185);
    segment.position.z = -.55 + i * .255;
    abdomen.add(segment);
    const band = mesh(new THREE.TorusGeometry(r * .9, .012, 6, 18), stripe);
    band.rotation.x = Math.PI / 2; band.position.z = segment.position.z - .105; abdomen.add(band); bands.push(band);
  }
  const tail = mesh(new THREE.ConeGeometry(.115, .31, 12), cuticle); tail.rotation.x = Math.PI / 2; tail.position.z = 1.15; abdomen.add(tail);

  const head = new THREE.Group(); head.position.set(0, .005, -.48); anatomy.add(head);
  const headShell = mesh(new THREE.SphereGeometry(.255, 18, 14), cuticle); headShell.scale.set(1.04, .84, .9); head.add(headShell);
  const eyes = [];
  for (const side of [-1, 1]) {
    const eye = mesh(new THREE.SphereGeometry(.155, 16, 12), C.eye); eye.scale.set(.72, .95, .74); eye.position.set(side * .16, .015, -.125); head.add(eye); eyes.push(eye);
    const socket = mesh(new THREE.TorusGeometry(.127, .009, 5, 14), C.steel); socket.position.copy(eye.position); socket.rotation.y = Math.PI / 2; head.add(socket);
  }
  const snout = mesh(new THREE.CylinderGeometry(.055, .075, .16, 10), C.black); snout.rotation.x = -Math.PI / 2; snout.position.z = -.205; head.add(snout);
  const proboscis = new THREE.Group(); proboscis.position.z = -.27; head.add(proboscis);
  const needle = mesh(new THREE.CylinderGeometry(.019, .032, 1.17, 9), C.edge); needle.rotation.x = -Math.PI / 2; needle.position.z = -.58; proboscis.add(needle);
  const needleTip = mesh(new THREE.ConeGeometry(.022, .16, 9), C.black); needleTip.rotation.x = -Math.PI / 2; needleTip.position.z = -1.245; proboscis.add(needleTip);
  const fuelTubeMat = new THREE.MeshPhysicalMaterial({ color: 0xffbc43, transparent: true, opacity: .04, emissive: 0x753b00, emissiveIntensity: .55, roughness: .1, depthWrite: false });
  const fuelTube = mesh(new THREE.CylinderGeometry(.009, .009, 1.04, 7), fuelTubeMat, false); fuelTube.rotation.x = -Math.PI / 2; fuelTube.position.z = -.55; proboscis.add(fuelTube);
  // Female Anopheles palps run beside the proboscis; this is a key silhouette cue absent from the previous model.
  for (const side of [-1, 1]) {
    const palp = cylinderBetween(proboscis, new THREE.Vector3(side * .062, .018, -.08), new THREE.Vector3(side * .085, .028, -1.15), .011, C.steel, 6);
    const palpTip = mesh(new THREE.SphereGeometry(.021, 7, 6), C.edge); palpTip.position.set(side * .085, .028, -1.15); proboscis.add(palpTip);
  }
  const antennae = [];
  for (const side of [-1, 1]) {
    const ant = new THREE.Group(); ant.position.set(side * .095, .1, -.17); head.add(ant);
    cylinderBetween(ant, new THREE.Vector3(), new THREE.Vector3(side * .31, .17, -.47), .008, C.edge, 5);
    const tip = mesh(new THREE.SphereGeometry(.015, 7, 5), C.policePale); tip.position.set(side * .31, .17, -.47); ant.add(tip);
    antennae.push({ ant });
  }

  const wings = [makeWing(-1), makeWing(1)]; wings.forEach((wing) => anatomy.add(wing.hinge));
  const lights = [];
  for (const [x, material] of [[-.115, C.red], [.115, C.cyan]]) {
    const lamp = mesh(new THREE.SphereGeometry(.026, 9, 8), material); lamp.position.set(x, .335, -.01); anatomy.add(lamp); lights.push(lamp);
  }

  const legs = [];
  const legSpecs = [
    { side: -1, z: -.28, offset: -.08 }, { side: -1, z: .04, offset: 0 }, { side: -1, z: .31, offset: .1 },
    { side: 1, z: -.28, offset: -.08 }, { side: 1, z: .04, offset: 0 }, { side: 1, z: .31, offset: .1 },
  ];
  legSpecs.forEach((spec, index) => {
    const legRoot = new THREE.Vector3(spec.side * .245, -.12, spec.z);
    const group = new THREE.Group(); anatomy.add(group);
    const coxa = cylinderBetween(group, legRoot, legRoot.clone().add(new THREE.Vector3(spec.side * .21, -.04, 0)), .021, C.steel, 6);
    const femur = cylinderBetween(group, legRoot, legRoot.clone().add(new THREE.Vector3(spec.side * .55, -.29, spec.z * .12)), .019, cuticle, 6);
    const tibia = cylinderBetween(group, legRoot, legRoot.clone().add(new THREE.Vector3(spec.side * .82, -.59, spec.z * .2)), .012, C.edge, 6);
    const tarsus = cylinderBetween(group, legRoot, legRoot.clone().add(new THREE.Vector3(spec.side * .96, -.64, spec.z * .26)), .007, C.black, 5);
    const hip = mesh(new THREE.SphereGeometry(.036, 7, 6), C.steel); group.add(hip);
    const knee = mesh(new THREE.SphereGeometry(.043, 7, 6), cuticle); group.add(knee);
    const ankle = mesh(new THREE.SphereGeometry(.026, 7, 6), C.edge); group.add(ankle);
    const claw = mesh(new THREE.SphereGeometry(.019, 7, 5), C.black); group.add(claw);
    legs.push({ spec, root: legRoot, coxa, femur, tibia, tarsus, hip, knee, ankle, claw, phase: index * .83 });
  });
  const packets = [];
  for (let i = 0; i < 16; i++) {
    const packet = mesh(new THREE.SphereGeometry(.017 + (i % 3) * .004, 8, 7), C.amber, false);
    packet.visible = false; anatomy.add(packet); packets.push({ mesh: packet, offset: i / 16 });
  }
  return { root, anatomy, abdomen, reservoir, bands, head, proboscis, fuelTubeMat, wings, legs, packets, lights, antennae, eyes };
}
const mosquito = createMosquito();
mosquito.root.position.set(5.9, 4.25, -3.1);
mosquito.root.scale.setScalar(1);

function updateLeg(leg, foot, lift = 0) {
  const root = leg.root;
  const side = leg.spec.side;
  const outward = new THREE.Vector3(side, 0, 0);
  const coxaEnd = root.clone().addScaledVector(outward, .19).add(new THREE.Vector3(0, -.025, -.015));
  const route = new THREE.Vector3().subVectors(foot, coxaEnd);
  const knee = coxaEnd.clone().addScaledVector(route, .38).addScaledVector(outward, .22).add(new THREE.Vector3(0, -.12 - lift, leg.spec.offset));
  const ankle = coxaEnd.clone().addScaledVector(route, .74).addScaledVector(outward, .08).add(new THREE.Vector3(0, -.05 - lift * .35, leg.spec.offset * .35));
  placeBetween(leg.coxa, root, coxaEnd);
  placeBetween(leg.femur, coxaEnd, knee);
  placeBetween(leg.tibia, knee, ankle);
  placeBetween(leg.tarsus, ankle, foot);
  leg.hip.position.copy(coxaEnd);
  leg.knee.position.copy(knee);
  leg.ankle.position.copy(ankle);
  leg.claw.position.copy(foot);
}

const params = { scale: 1, wing: .82, approach: .68, drill: .72, feed: .65 };
for (const key of Object.keys(params)) {
  const element = document.querySelector(`#${key}`);
  const value = document.querySelector(`#${key}-value`);
  element.addEventListener('input', () => { params[key] = Number(element.value); value.value = Number(element.value).toFixed(2); });
}

let fuel = 1;
let state = 'PATROL';
let stateClock = 0;
let flowClock = 0;
let drilling = 0;
let perch = 0;
let feedPhase = 0;
const flightVelocity = new THREE.Vector3();
const desired = new THREE.Vector3();
const landingBody = new THREE.Vector3();
const hoverPoint = new THREE.Vector3();
const orientationDummy = new THREE.Object3D();
const qFlight = new THREE.Quaternion();
const qLand = new THREE.Quaternion();
const tempV = new THREE.Vector3();
const tempV2 = new THREE.Vector3();

function switchState(next) { state = next; stateClock = 0; }
function resetSimulation() {
  fuel = 1; state = 'PATROL'; stateClock = 0; drilling = 0; perch = 0; feedPhase = 0; flowClock = 0; flightVelocity.set(0, 0, 0);
  mosquito.root.position.set(5.9, 4.25, -3.1);
  mosquito.root.quaternion.identity();
  hole.visible = false; holeHalo.visible = false;
}
document.querySelector('#reset').addEventListener('click', resetSimulation);

function updateSimulation(dt, elapsed) {
  stateClock += dt;
  const normal = tankNormal;
  // The tank normal points out of its skin. The body stays outside it; the head is aimed back into the skin.
  landingBody.copy(contactPoint).addScaledVector(normal, 2.06);
  hoverPoint.copy(contactPoint).add(new THREE.Vector3(4.1, 2.3, -2.25));

  if (state === 'PATROL') {
    desired.set(4.8 + Math.cos(elapsed * .52) * 1.4, 4.35 + Math.sin(elapsed * 1.1) * .48, -1.65 + Math.sin(elapsed * .52) * 1.55);
    if (stateClock > 4.7) switchState('INTERCEPT');
  } else if (state === 'INTERCEPT') {
    desired.copy(hoverPoint);
    if (mosquito.root.position.distanceTo(hoverPoint) < .72 || stateClock > 7.5) switchState('HOVER');
  } else if (state === 'HOVER') {
    desired.copy(hoverPoint).add(new THREE.Vector3(Math.sin(elapsed * 2.4) * .17, Math.sin(elapsed * 3.1) * .12, Math.cos(elapsed * 2.1) * .16));
    if (stateClock > 1.7) switchState('SETTLE');
  } else if (state === 'SETTLE') {
    desired.copy(landingBody);
    if (stateClock > 2.7) { switchState('DRILL'); hole.visible = true; holeHalo.visible = true; }
  } else if (state === 'DRILL') {
    desired.copy(landingBody).add(new THREE.Vector3(Math.sin(elapsed * 44) * .018, Math.cos(elapsed * 37) * .014, 0));
    drilling = damp(drilling, 1, 3.2 * params.drill, dt);
    if (stateClock > 3.05 / params.drill) { switchState('FEED'); feedPhase = 0; }
  } else if (state === 'FEED') {
    desired.copy(landingBody).add(new THREE.Vector3(Math.sin(elapsed * 2.2) * .02, 0, Math.cos(elapsed * 1.5) * .025));
    feedPhase += dt * params.feed;
    fuel = Math.max(.12, fuel - dt * (.038 + params.feed * .05));
    if (stateClock > 10.5 || fuel <= .12) switchState('RELEASE');
  } else if (state === 'RELEASE') {
    desired.set(4.5, 7.4, 2.5);
    if (stateClock > 4.4) resetSimulation();
  }

  const isPerched = ['SETTLE', 'DRILL', 'FEED'].includes(state);
  perch = damp(perch, isPerched ? 1 : 0, isPerched ? 2.8 : 2.1, dt);
  const maxSpeed = (2.4 + params.approach * 4.2) * (state === 'PATROL' ? .78 : 1);
  const gain = isPerched ? 4.4 : 1.5 + params.approach * 1.5;
  tempV.subVectors(desired, mosquito.root.position);
  const desiredVel = tempV.clampLength(0, maxSpeed);
  flightVelocity.lerp(desiredVel, 1 - Math.exp(-gain * dt));
  mosquito.root.position.addScaledVector(flightVelocity, dt);
  if (isPerched) mosquito.root.position.lerp(landingBody, 1 - Math.exp(-4.5 * dt));

  // Orientation follows airspeed while flying and deliberately locks the head normal to the curved fuel tank while perched.
  const heading = flightVelocity.lengthSq() > .02 ? flightVelocity.clone().normalize() : new THREE.Vector3(-1, 0, 0);
  heading.y *= .45;
  heading.normalize();
  orientationDummy.position.copy(mosquito.root.position);
  orientationDummy.up.set(0, 1, 0);
  orientationDummy.lookAt(tempV2.copy(mosquito.root.position).add(heading));
  qFlight.copy(orientationDummy.quaternion);
  orientationDummy.position.copy(landingBody);
  orientationDummy.up.set(0, 1, 0);
  orientationDummy.lookAt(tempV2.copy(landingBody).sub(normal));
  qLand.copy(orientationDummy.quaternion);
  const targetQ = qFlight.clone().slerp(qLand, perch);
  mosquito.root.quaternion.slerp(targetQ, 1 - Math.exp(-(isPerched ? 4.5 : 2.4) * dt));
  mosquito.root.scale.setScalar(params.scale);

  const wingFrequency = 15 + params.wing * 25;
  const wingBeat = Math.sin(elapsed * wingFrequency * Math.PI * 2);
  const wingLift = (1 - perch) * (.34 + params.wing * .48);
  mosquito.wings.forEach((w, i) => {
    const harmonic = Math.sin(elapsed * wingFrequency * Math.PI * 2 + i * .35);
    w.hinge.rotation.z = w.side * (wingBeat * wingLift + perch * .12);
    w.hinge.rotation.y = w.side * (.1 + harmonic * .09 * (1 - perch));
    w.wing.rotation.z = -w.side * .06;
    w.membrane.material.opacity = .28 + (1 - perch) * .18;
  });

  mosquito.anatomy.rotation.x = (1 - perch) * (Math.PI / 18 + heading.y * .14) + drilling * Math.sin(elapsed * 39) * .012;
  mosquito.anatomy.rotation.z = (1 - perch) * THREE.MathUtils.clamp(-flightVelocity.x * .045, -.15, .15);
  mosquito.proboscis.rotation.z = drilling * elapsed * (22 + params.drill * 30);
  mosquito.fuelTubeMat.opacity = .04 + smoothstep(0, 1, feedPhase) * .85;
  mosquito.reservoir.material.opacity = .26 + smoothstep(0, 9, feedPhase) * .51;
  mosquito.reservoir.material.emissiveIntensity = .35 + smoothstep(0, 8, feedPhase) * 1.1;
  const abdomenFill = 1 + smoothstep(0, 10, feedPhase) * .09;
  mosquito.abdomen.scale.set(abdomenFill, abdomenFill, 1);
  mosquito.lights.forEach((lamp, i) => { lamp.material.emissiveIntensity = .45 + Math.max(0, Math.sin(elapsed * 8 + i * Math.PI)) * .8; });
  mosquito.antennae.forEach((a, i) => { a.ant.rotation.y = Math.sin(elapsed * 3.8 + i * 2) * (.1 + (1 - perch) * .15); });

  const localFeet = [
    [-.72, .24, -2.02], [-.93, -.03, -2.02], [-.68, -.32, -2.02],
    [.72, .24, -2.02], [.93, -.03, -2.02], [.68, -.32, -2.02],
  ];
  mosquito.legs.forEach((leg, i) => {
    let foot;
    let lift = 0;
    if (perch > .15) {
      foot = new THREE.Vector3(...localFeet[i]);
      // The feet are kept just inside the skin plane, so they feel attached rather than hanging.
      foot.z += .10 * (1 - perch);
    } else {
      const swing = Math.sin(elapsed * 7.2 + leg.phase);
      foot = leg.root.clone().add(new THREE.Vector3(leg.spec.side * (.62 + .1 * swing), -.56 - .1 * Math.abs(swing), leg.spec.z * .58 - .22));
      lift = .1 * (swing + 1);
    }
    updateLeg(leg, foot, lift);
  });

  const feeding = state === 'FEED';
  mosquito.packets.forEach((packet, i) => {
    packet.mesh.visible = feeding;
    if (feeding) {
      const progress = (elapsed * (1.1 + params.feed * 1.8) + packet.offset) % 1;
      packet.mesh.position.set((i % 2 ? .016 : -.016), .0, -2.0 + progress * 2.72);
      const pulse = .8 + .45 * Math.sin(progress * Math.PI);
      packet.mesh.scale.setScalar(pulse);
    }
  });
  holeHalo.material.emissiveIntensity = state === 'DRILL' ? 2.2 + Math.sin(elapsed * 15) * .8 : (feeding ? .36 : 0);
  holeHalo.visible = hole.visible;
  const fill = document.querySelector('#fuel-fill');
  fill.style.width = `${fuel * 100}%`;
  fill.style.background = fuel < .35 ? 'linear-gradient(90deg,#e9713c,#d42e24)' : 'linear-gradient(90deg,#44c5aa,#e9d36d)';
}

// Lightweight orbit camera; keeps the vehicle readable but lets the model be inspected from every side.
const orbit = { radius: 9.4, theta: .76, phi: 1.08, target: new THREE.Vector3(.55, 1.55, .25), dragging: false, x: 0, y: 0 };
function updateCamera() {
  const sinPhi = Math.sin(orbit.phi);
  camera.position.set(
    orbit.target.x + orbit.radius * sinPhi * Math.sin(orbit.theta),
    orbit.target.y + orbit.radius * Math.cos(orbit.phi),
    orbit.target.z + orbit.radius * sinPhi * Math.cos(orbit.theta),
  );
  camera.lookAt(orbit.target);
}
canvas.addEventListener('pointerdown', (event) => { orbit.dragging = true; orbit.x = event.clientX; orbit.y = event.clientY; canvas.setPointerCapture(event.pointerId); });
canvas.addEventListener('pointermove', (event) => {
  if (!orbit.dragging) return;
  orbit.theta -= (event.clientX - orbit.x) * .008;
  orbit.phi = THREE.MathUtils.clamp(orbit.phi + (event.clientY - orbit.y) * .008, .35, 1.48);
  orbit.x = event.clientX; orbit.y = event.clientY;
});
canvas.addEventListener('pointerup', () => { orbit.dragging = false; });
canvas.addEventListener('wheel', (event) => { orbit.radius = THREE.MathUtils.clamp(orbit.radius + event.deltaY * .009, 6.2, 22); }, { passive: true });

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function frame() {
  const dt = Math.min(clock.getDelta(), .05);
  const elapsed = clock.elapsedTime;
  updateSimulation(dt, elapsed);
  updateCamera();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
updateCamera();
frame();
