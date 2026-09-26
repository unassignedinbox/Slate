import * as THREE from 'three';

const canvas = document.querySelector('#race-canvas');
const ui = {
  loading: document.querySelector('#loading'),
  speed: document.querySelector('#speed'),
  gear: document.querySelector('#gear'),
  nitroFill: document.querySelector('#nitro-fill'),
  nitroLabel: document.querySelector('#nitro-label'),
  lap: document.querySelector('#lap'),
  time: document.querySelector('#time'),
  best: document.querySelector('#best'),
  warning: document.querySelector('#track-warning'),
  message: document.querySelector('#center-message'),
};

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x05060b, 1);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.28;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x090b12, 0.006);
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 850);
const clock = new THREE.Clock();
const UP = new THREE.Vector3(0, 1, 0);
const tempV = new THREE.Vector3();

const materials = {
  road: new THREE.MeshStandardMaterial({ color: 0x161c25, roughness: 0.82, metalness: 0.28, vertexColors: true }),
  curbRed: new THREE.MeshStandardMaterial({ color: 0x6a101c, roughness: 0.56, metalness: 0.57, emissive: 0x250006, emissiveIntensity: 0.5 }),
  curbLight: new THREE.MeshStandardMaterial({ color: 0x9bdce2, roughness: 0.33, metalness: 0.7, emissive: 0x0c697c, emissiveIntensity: 1.3 }),
  steel: new THREE.MeshStandardMaterial({ color: 0x1a222a, roughness: 0.68, metalness: 0.75 }),
  blackSteel: new THREE.MeshStandardMaterial({ color: 0x080b0e, roughness: 0.48, metalness: 0.85 }),
  yellow: new THREE.MeshStandardMaterial({ color: 0xe8a524, roughness: 0.45, metalness: 0.45, emissive: 0x613800, emissiveIntensity: 0.6 }),
  redGlow: new THREE.MeshBasicMaterial({ color: 0xff3548 }),
  cyanGlow: new THREE.MeshBasicMaterial({ color: 0x39e6ff }),
};

function remap(v, inMin, inMax, outMin, outMax) {
  return outMin + ((v - inMin) / (inMax - inMin)) * (outMax - outMin);
}
function yawFromVector(v) {
  return Math.atan2(-v.x, -v.z);
}
function makeGlowTexture(color = '#5cecff') {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, color);
  g.addColorStop(0.14, color);
  g.addColorStop(0.44, color + '65');
  g.addColorStop(1, color + '00');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
function glowSprite(color, size, opacity = 1) {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeGlowTexture(color), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity }));
  sprite.scale.set(size, size, 1);
  return sprite;
}

// ---- Light, sky and industrial city ----------------------------------------
const hemi = new THREE.HemisphereLight(0x647d9a, 0x100a0b, 1.25);
scene.add(hemi);
const moon = new THREE.DirectionalLight(0xa6d9ff, 2.2);
moon.position.set(-90, 120, -50);
moon.castShadow = true;
moon.shadow.mapSize.set(2048, 2048);
moon.shadow.camera.left = -160;
moon.shadow.camera.right = 160;
moon.shadow.camera.top = 160;
moon.shadow.camera.bottom = -160;
scene.add(moon);
const redLight = new THREE.PointLight(0xff273a, 75, 95, 2);
redLight.position.set(15, 26, 10);
scene.add(redLight);
const cyanLight = new THREE.PointLight(0x38deff, 55, 100, 2);
cyanLight.position.set(-76, 20, -32);
scene.add(cyanLight);

const moonSprite = glowSprite('#b8e6ff', 48, 0.28);
moonSprite.position.set(-135, 102, -240);
scene.add(moonSprite);

const starsGeometry = new THREE.BufferGeometry();
const stars = [];
for (let i = 0; i < 620; i++) {
  const r = 130 + Math.random() * 350;
  const a = Math.random() * Math.PI * 2;
  stars.push(Math.cos(a) * r, 35 + Math.random() * 155, Math.sin(a) * r);
}
starsGeometry.setAttribute('position', new THREE.Float32BufferAttribute(stars, 3));
scene.add(new THREE.Points(starsGeometry, new THREE.PointsMaterial({ color: 0x9ec9e1, size: 0.7, transparent: true, opacity: 0.7, sizeAttenuation: true })));

const ground = new THREE.Mesh(new THREE.PlaneGeometry(860, 860), new THREE.MeshStandardMaterial({ color: 0x0a0e13, roughness: 0.95, metalness: 0.15 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const groundGrid = new THREE.GridHelper(700, 70, 0x17212b, 0x101821);
groundGrid.position.y = 0.05;
groundGrid.material.transparent = true;
groundGrid.material.opacity = 0.35;
scene.add(groundGrid);

function addBuilding(x, z, w, h, d, accent) {
  const group = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: 0x10171e, roughness: 0.78, metalness: 0.5 }));
  base.position.y = h / 2;
  base.castShadow = true;
  base.receiveShadow = true;
  group.add(base);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(w * 1.06, 0.35, d * 1.06), materials.blackSteel);
  roof.position.y = h + 0.15;
  group.add(roof);
  const windowMat = new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.7 });
  const windows = new THREE.Group();
  const rows = Math.max(1, Math.floor(h / 7));
  for (let r = 0; r < rows; r++) {
    if (Math.random() > 0.72) continue;
    const strip = new THREE.Mesh(new THREE.BoxGeometry(w * 0.72, 0.09, 0.06), windowMat);
    strip.position.set(0, 3 + r * 5.6, d / 2 + 0.04);
    windows.add(strip);
  }
  group.add(windows);
  if (Math.random() > 0.55) {
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.24, 6, 4), accent === 0xff3345 ? materials.redGlow : materials.cyanGlow);
    beacon.position.set((Math.random() - .5) * w * .5, h + .5, (Math.random() - .5) * d * .5);
    group.add(beacon);
  }
  group.position.set(x, 0, z);
  scene.add(group);
}
for (let i = 0; i < 82; i++) {
  const a = Math.random() * Math.PI * 2;
  const radius = 155 + Math.random() * 170;
  const w = 8 + Math.random() * 19;
  const d = 8 + Math.random() * 20;
  const h = 12 + Math.pow(Math.random(), 1.8) * 80;
  addBuilding(Math.cos(a) * radius, Math.sin(a) * radius, w, h, d, Math.random() > .42 ? 0x4edff1 : 0xff4051);
}

// ---- Elevated Motorball circuit ---------------------------------------------
const routeControls = [
  [-124, 7, -8], [-111, 9, -51], [-77, 12, -82], [-22, 15, -96], [35, 20, -88],
  [91, 25, -69], [127, 27, -31], [134, 24, 18], [109, 20, 58], [61, 16, 82],
  [7, 13, 91], [-51, 10, 76], [-101, 7, 48], [-135, 6, 18],
].map(([x, y, z]) => new THREE.Vector3(x, y, z));
const curve = new THREE.CatmullRomCurve3(routeControls, true, 'catmullrom', 0.18);
const TRACK_STEPS = 420;
const TRACK_WIDTH = 24;
const track = [];
for (let i = 0; i < TRACK_STEPS; i++) {
  const t = i / TRACK_STEPS;
  const p = curve.getPointAt(t);
  const next = curve.getPointAt((i + 1) / TRACK_STEPS);
  const prev = curve.getPointAt((i - 1 + TRACK_STEPS) / TRACK_STEPS);
  const tangent = next.clone().sub(prev).normalize();
  const left = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
  const bank = Math.sin(t * Math.PI * 8 - 0.7) * 0.12 + Math.sin(t * Math.PI * 4) * 0.05;
  track.push({ p, tangent, left, bank });
}

function createTrackSurface() {
  const vertices = [], colors = [], uvs = [], indices = [];
  for (let i = 0; i < TRACK_STEPS; i++) {
    const r = track[i];
    const liftL = r.bank * (TRACK_WIDTH / 2);
    const liftR = -r.bank * (TRACK_WIDTH / 2);
    const L = r.p.clone().addScaledVector(r.left, TRACK_WIDTH / 2); L.y += liftL;
    const R = r.p.clone().addScaledVector(r.left, -TRACK_WIDTH / 2); R.y += liftR;
    vertices.push(L.x, L.y, L.z, R.x, R.y, R.z);
    const value = i % 13 === 0 ? 0.62 : 0.40;
    colors.push(value * .75, value * .84, value, value * .61, value * .69, value * .82);
    uvs.push(0, i / 3, 1, i / 3);
  }
  for (let i = 0; i < TRACK_STEPS; i++) {
    const n = (i + 1) % TRACK_STEPS;
    indices.push(i * 2, n * 2, n * 2 + 1, i * 2, n * 2 + 1, i * 2 + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const road = new THREE.Mesh(geometry, materials.road);
  road.receiveShadow = true;
  scene.add(road);
}
createTrackSurface();

function addRoadStrip(offset, width, material, every = 1, height = 0.085) {
  const geometry = new THREE.BoxGeometry(width, height, 2.0);
  for (let i = 0; i < TRACK_STEPS; i += every) {
    const r = track[i];
    const obj = new THREE.Mesh(geometry, material);
    const pos = r.p.clone().addScaledVector(r.left, offset);
    pos.y += 0.18 + (offset / (TRACK_WIDTH / 2)) * r.bank * (TRACK_WIDTH / 2);
    obj.position.copy(pos);
    obj.rotation.y = yawFromVector(r.tangent);
    obj.rotation.z = -r.bank;
    scene.add(obj);
  }
}
addRoadStrip(0, 0.28, new THREE.MeshBasicMaterial({ color: 0x89939b, transparent: true, opacity: 0.44 }), 5, 0.04);
addRoadStrip(10.8, 1.35, materials.curbRed, 2, 0.16);
addRoadStrip(-10.8, 1.35, materials.curbRed, 2, 0.16);

function makeTrackInfrastructure() {
  const railGeo = new THREE.BoxGeometry(0.28, 0.26, 3.8);
  const postGeo = new THREE.BoxGeometry(0.34, 1.7, 0.34);
  const supportGeo = new THREE.CylinderGeometry(0.7, 1.15, 1, 8);
  for (let i = 0; i < TRACK_STEPS; i += 5) {
    const r = track[i];
    for (const side of [-1, 1]) {
      const edge = r.p.clone().addScaledVector(r.left, side * (TRACK_WIDTH / 2 + 1.45));
      edge.y += side * r.bank * (TRACK_WIDTH / 2);
      const rail = new THREE.Mesh(railGeo, i % 10 === 0 ? materials.curbLight : materials.steel);
      rail.position.copy(edge).add(new THREE.Vector3(0, 1.0, 0));
      rail.rotation.y = yawFromVector(r.tangent);
      rail.rotation.z = -r.bank;
      scene.add(rail);
      if (i % 10 === 0) {
        const post = new THREE.Mesh(postGeo, materials.blackSteel);
        post.position.copy(edge).add(new THREE.Vector3(0, 0.35, 0));
        post.rotation.z = -r.bank;
        scene.add(post);
      }
    }
    if (i % 28 === 0) {
      const column = new THREE.Mesh(supportGeo, materials.steel);
      const h = Math.max(3, r.p.y - 0.2);
      column.scale.y = h;
      column.position.set(r.p.x, h / 2, r.p.z);
      column.castShadow = true;
      scene.add(column);
      const footing = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.7, 0.6, 8), materials.blackSteel);
      footing.position.set(r.p.x, 0.3, r.p.z);
      scene.add(footing);
    }
  }
}
makeTrackInfrastructure();

function makeCanvasSign(text, accent = '#ff3d4b') {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 180;
  const x = c.getContext('2d');
  x.fillStyle = '#070a0f'; x.fillRect(0, 0, c.width, c.height);
  x.strokeStyle = accent; x.lineWidth = 10; x.strokeRect(10, 10, 492, 160);
  x.fillStyle = accent; x.font = 'bold 57px Arial Black, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, 256, 91);
  x.fillStyle = '#cbd8dc'; x.font = '16px monospace'; x.fillText('RUST BELT // MOTORSPORT', 256, 138);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide });
}
function addBillboard(index, text, color) {
  const r = track[index % TRACK_STEPS];
  const p = r.p.clone().addScaledVector(r.left, TRACK_WIDTH / 2 + 7);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(.42, .55, 10, 6), materials.blackSteel);
  pole.position.copy(p).add(new THREE.Vector3(0, 5, 0));
  scene.add(pole);
  const board = new THREE.Mesh(new THREE.PlaneGeometry(11, 3.8), makeCanvasSign(text, color));
  board.position.copy(p).add(new THREE.Vector3(0, 11.4, 0));
  board.rotation.y = yawFromVector(r.left.clone().multiplyScalar(-1));
  scene.add(board);
}
addBillboard(31, 'SCRAPYARD', '#ff3d4b');
addBillboard(125, 'NO MERCY', '#45ddff');
addBillboard(218, 'BLOOD / STEEL', '#ffcc2e');
addBillboard(335, 'MOTORBALL', '#ff3d4b');

// Start/finish truss and checkpoint lighting
const startIndex = 36;
const startRecord = track[startIndex];
const startGroup = new THREE.Group();
startGroup.position.copy(startRecord.p);
startGroup.rotation.y = yawFromVector(startRecord.tangent);
const trussMat = new THREE.MeshStandardMaterial({ color: 0x25323b, metalness: .85, roughness: .32 });
const leftPost = new THREE.Mesh(new THREE.BoxGeometry(.65, 10, .65), trussMat); leftPost.position.set(-11, 5, 0);
const rightPost = leftPost.clone(); rightPost.position.x = 11;
const crossbar = new THREE.Mesh(new THREE.BoxGeometry(23, .65, .65), trussMat); crossbar.position.y = 10;
const sign = new THREE.Mesh(new THREE.PlaneGeometry(8.2, 2.4), makeCanvasSign('START', '#50e8ff')); sign.position.set(0, 8.2, .36);
startGroup.add(leftPost, rightPost, crossbar, sign);
for (let x = -9; x <= 9; x += 3) {
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.15, .35, .38), x < 0 ? materials.redGlow : materials.cyanGlow);
  lamp.position.set(x, 9.35, .6); startGroup.add(lamp);
}
scene.add(startGroup);

// Dust and holographic rings in the central arena
const dustGeo = new THREE.BufferGeometry();
const dust = [];
for (let i = 0; i < 220; i++) {
  const a = Math.random() * Math.PI * 2, r = Math.random() * 125;
  dust.push(Math.cos(a) * r, 1 + Math.random() * 30, Math.sin(a) * r);
}
dustGeo.setAttribute('position', new THREE.Float32BufferAttribute(dust, 3));
const dustCloud = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0x84c8df, size: .42, transparent: true, opacity: .35, depthWrite: false }));
scene.add(dustCloud);
const holoRing = new THREE.Mesh(new THREE.TorusGeometry(38, .08, 5, 96), new THREE.MeshBasicMaterial({ color: 0x35dff6, transparent: true, opacity: .46 }));
holoRing.rotation.x = Math.PI / 2; holoRing.position.y = 3.2; scene.add(holoRing);

// ---- Low-poly sentra-inspired test car --------------------------------------
function createPrism(points, depth, material) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  geometry.translate(0, 0, -depth / 2);
  return new THREE.Mesh(geometry, material);
}
function createTestCar() {
  const vehicle = new THREE.Group();
  const visual = new THREE.Group();
  vehicle.add(visual);
  const paint = new THREE.MeshStandardMaterial({ color: 0xc12639, metalness: .7, roughness: .28 });
  const paintLight = new THREE.MeshStandardMaterial({ color: 0xf14a53, metalness: .55, roughness: .26 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x07151f, metalness: .8, roughness: .12, transparent: true, opacity: .86 });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x050607, metalness: .25, roughness: .77 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xabbac0, metalness: 1, roughness: .18 });
  const darkPaint = new THREE.MeshStandardMaterial({ color: 0x48111a, metalness: .73, roughness: .36 });

  const skirt = new THREE.Mesh(new THREE.BoxGeometry(3.58, .50, 7.32), darkPaint);
  skirt.position.y = .69; skirt.castShadow = true; visual.add(skirt);
  const hood = createPrism([[-1.52, 0], [1.52, 0], [1.39, .52], [.95, .79], [-.95, .79], [-1.39, .52]], 3.15, paint);
  hood.rotation.y = Math.PI / 2; hood.position.set(0, .84, -1.7); hood.castShadow = true; visual.add(hood);
  const cabin = createPrism([[-1.35, 0], [1.35, 0], [1.12, 1.15], [.72, 1.52], [-.72, 1.52], [-1.12, 1.15]], 2.92, paint);
  cabin.rotation.y = Math.PI / 2; cabin.position.set(0, 1.02, .72); cabin.castShadow = true; visual.add(cabin);
  const trunk = createPrism([[-1.49, 0], [1.49, 0], [1.28, .54], [.88, .65], [-.88, .65], [-1.28, .54]], 1.54, paintLight);
  trunk.rotation.y = Math.PI / 2; trunk.position.set(0, .84, 2.98); trunk.castShadow = true; visual.add(trunk);

  const windscreen = new THREE.Mesh(new THREE.PlaneGeometry(2.06, 1.05), glass);
  windscreen.position.set(0, 1.86, -.35); windscreen.rotation.x = -0.53; visual.add(windscreen);
  const rearGlass = windscreen.clone(); rearGlass.position.set(0, 1.82, 1.82); rearGlass.rotation.x = 0.53; visual.add(rearGlass);
  for (const side of [-1, 1]) {
    const window = new THREE.Mesh(new THREE.PlaneGeometry(1.76, .82), glass);
    window.position.set(side * 1.39, 1.68, .77); window.rotation.y = side * Math.PI / 2; visual.add(window);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(.05, .96, .09), materials.blackSteel);
    trim.position.set(side * 1.43, 1.63, .78); visual.add(trim);
  }
  const grill = new THREE.Mesh(new THREE.BoxGeometry(2.0, .31, .08), materials.blackSteel);
  grill.position.set(0, .88, -3.68); visual.add(grill);
  const bumper = new THREE.Mesh(new THREE.BoxGeometry(3.43, .36, .22), materials.blackSteel);
  bumper.position.set(0, .56, -3.71); visual.add(bumper);
  const rearBumper = bumper.clone(); rearBumper.position.z = 3.72; visual.add(rearBumper);
  const spoiler = new THREE.Group();
  const blade = new THREE.Mesh(new THREE.BoxGeometry(2.62, .16, .39), materials.blackSteel); blade.position.y = 2.05;
  const stanchionA = new THREE.Mesh(new THREE.BoxGeometry(.12,.5,.12), materials.blackSteel); stanchionA.position.set(-.86,1.82,.22);
  const stanchionB = stanchionA.clone(); stanchionB.position.x = .86;
  spoiler.add(blade, stanchionA, stanchionB); spoiler.position.z = 3.32; visual.add(spoiler);
  const headlights = [];
  for (const side of [-1, 1]) {
    const light = new THREE.Mesh(new THREE.BoxGeometry(.8, .22, .1), new THREE.MeshBasicMaterial({ color: 0xdffeff }));
    light.position.set(side * 1.02, 1.13, -3.72); visual.add(light); headlights.push(light);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(.86, .22, .1), materials.redGlow);
    tail.position.set(side * 1.0, 1.06, 3.73); visual.add(tail);
  }
  const underGlow = glowSprite('#ff3045', 5.5, .32); underGlow.position.y = .12; underGlow.scale.y = 1.8; visual.add(underGlow);

  const wheelPivots = [];
  const wheelGeometry = new THREE.CylinderGeometry(.79, .79, .42, 10);
  const rimGeometry = new THREE.CylinderGeometry(.43, .43, .43, 8);
  for (const x of [-1.78, 1.78]) for (const z of [-2.35, 2.33]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, .69, z);
    const tire = new THREE.Mesh(wheelGeometry, tireMat); tire.rotation.z = Math.PI / 2; tire.castShadow = true;
    const rim = new THREE.Mesh(rimGeometry, rimMat); rim.rotation.z = Math.PI / 2;
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(.16, .16, .46, 8), materials.redGlow); hub.rotation.z = Math.PI / 2;
    pivot.add(tire, rim, hub); visual.add(pivot); wheelPivots.push(pivot);
  }
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(.92,.28), new THREE.MeshBasicMaterial({ color: 0xffe8a3 }));
  plate.position.set(0,.65,3.85); plate.rotation.y = Math.PI; visual.add(plate);
  vehicle.userData = { visual, wheelPivots, headlights };
  return vehicle;
}

const car = createTestCar();
car.scale.setScalar(.86);
scene.add(car);

// ---- Driving model / UI ------------------------------------------------------
const input = { throttle: false, brake: false, left: false, right: false, boost: false };
const state = {
  speed: 0,
  heading: 0,
  nitro: 100,
  closest: startIndex,
  lastClosest: startIndex,
  circuitProgress: 0,
  sessionTime: 0,
  lapStart: 0,
  lapNumber: 1,
  bestLap: null,
  started: false,
  cameraMode: 0,
};
function placeAtTrack(index = startIndex) {
  const r = track[index];
  car.position.copy(r.p).add(new THREE.Vector3(0, 1.1, 0));
  car.rotation.y = yawFromVector(r.tangent);
  state.heading = car.rotation.y;
  state.closest = index;
  state.lastClosest = index;
}
placeAtTrack();

function closestTrackPoint(position) {
  let best = 0;
  let distanceSq = Infinity;
  for (let i = 0; i < TRACK_STEPS; i++) {
    const p = track[i].p;
    const dx = position.x - p.x, dz = position.z - p.z;
    const d = dx * dx + dz * dz;
    if (d < distanceSq) { distanceSq = d; best = i; }
  }
  const record = track[best];
  const lateral = tempV.set(position.x - record.p.x, 0, position.z - record.p.z).dot(record.left);
  return { index: best, record, lateral, distance: Math.sqrt(distanceSq) };
}

function fmtTime(seconds) {
  const min = Math.floor(seconds / 60).toString().padStart(2, '0');
  const sec = Math.floor(seconds % 60).toString().padStart(2, '0');
  const milli = Math.floor((seconds % 1) * 1000).toString().padStart(3, '0');
  return `${min}:${sec}.${milli}`;
}
function resetCar() {
  placeAtTrack(startIndex);
  state.speed = 0;
  state.circuitProgress = 0;
  state.sessionTime = 0;
  state.lapStart = 0;
  state.lapNumber = 1;
  state.started = false;
  ui.message.classList.remove('hide');
}
function setKey(code, active) {
  if (['KeyW', 'ArrowUp'].includes(code)) input.throttle = active;
  if (['KeyS', 'ArrowDown'].includes(code)) input.brake = active;
  if (['KeyA', 'ArrowLeft'].includes(code)) input.left = active;
  if (['KeyD', 'ArrowRight'].includes(code)) input.right = active;
  if (code === 'ShiftLeft' || code === 'ShiftRight') input.boost = active;
}
window.addEventListener('keydown', e => {
  if (['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','ShiftLeft','ShiftRight','KeyC','KeyR'].includes(e.code)) e.preventDefault();
  if (e.code === 'KeyC' && !e.repeat) state.cameraMode = (state.cameraMode + 1) % 3;
  if (e.code === 'KeyR' && !e.repeat) resetCar();
  setKey(e.code, true);
});
window.addEventListener('keyup', e => setKey(e.code, false));
window.addEventListener('blur', () => Object.keys(input).forEach(k => input[k] = false));

const cameraLook = new THREE.Vector3();
const cameraDesired = new THREE.Vector3();
function updateCamera(dt, forward) {
  const speedFactor = Math.min(Math.abs(state.speed) / 75, 1);
  if (state.cameraMode === 0) {
    cameraDesired.copy(car.position).addScaledVector(forward, -13.5 - speedFactor * 3.4).add(new THREE.Vector3(0, 6.2 + speedFactor * 1.2, 0));
    cameraLook.copy(car.position).addScaledVector(forward, 8).add(new THREE.Vector3(0, 1.1, 0));
  } else if (state.cameraMode === 1) {
    cameraDesired.copy(car.position).addScaledVector(forward, -7.2).add(new THREE.Vector3(0, 2.7, 0));
    cameraLook.copy(car.position).addScaledVector(forward, 13).add(new THREE.Vector3(0, .3, 0));
  } else {
    cameraDesired.copy(car.position).add(new THREE.Vector3(0, 19, 0)).addScaledVector(forward, -4);
    cameraLook.copy(car.position).addScaledVector(forward, 5);
  }
  if (input.boost && state.nitro > 1) cameraDesired.addScaledVector(forward, -Math.random() * .17);
  camera.position.lerp(cameraDesired, 1 - Math.exp(-dt * 4.5));
  camera.lookAt(cameraLook);
  camera.fov = THREE.MathUtils.lerp(camera.fov, input.boost ? 72 : 62, 1 - Math.exp(-dt * 4));
  camera.updateProjectionMatrix();
}

function updateDrive(dt) {
  const found = closestTrackPoint(car.position);
  const onTrack = Math.abs(found.lateral) < TRACK_WIDTH * .5 - .6;
  const offTrack = !onTrack;
  const boostActive = input.boost && input.throttle && state.nitro > .3 && state.speed > 5 && onTrack;
  let maxSpeed = offTrack ? 30 : 70;
  if (boostActive) maxSpeed = 91;
  if (input.throttle) state.speed += (boostActive ? 35 : 23) * dt;
  else state.speed -= (offTrack ? 10 : 5.4) * dt;
  if (input.brake) state.speed -= state.speed > 0 ? 41 * dt : -18 * dt;
  state.speed = THREE.MathUtils.clamp(state.speed, -16, maxSpeed);
  if (Math.abs(state.speed) < .12 && !input.throttle && !input.brake) state.speed = 0;
  const steer = (input.left ? 1 : 0) - (input.right ? 1 : 0);
  const steeringRate = 1.55 * (0.18 + Math.min(Math.abs(state.speed) / 62, 1));
  state.heading += steer * steeringRate * dt * (state.speed >= 0 ? 1 : -1);
  const forward = new THREE.Vector3(-Math.sin(state.heading), 0, -Math.cos(state.heading));
  car.position.addScaledVector(forward, state.speed * dt);
  car.rotation.y = state.heading;
  const after = closestTrackPoint(car.position);
  car.position.y = THREE.MathUtils.damp(car.position.y, after.record.p.y + 1.1, 10, dt);
  const roll = -steer * Math.min(Math.abs(state.speed) / 85, 1) * .085;
  car.userData.visual.rotation.z = THREE.MathUtils.damp(car.userData.visual.rotation.z, roll, 7, dt);
  car.userData.visual.rotation.x = THREE.MathUtils.damp(car.userData.visual.rotation.x, input.brake ? .055 : input.throttle ? -.022 : 0, 8, dt);
  car.userData.wheelPivots.forEach(w => { w.rotation.x -= state.speed * dt / .77; });

  if (boostActive) state.nitro = Math.max(0, state.nitro - 26 * dt);
  else state.nitro = Math.min(100, state.nitro + (input.throttle ? 2.4 : 8) * dt);
  if (offTrack && after.distance > 33) {
    car.position.lerp(after.record.p.clone().add(new THREE.Vector3(0, 1.1, 0)), 1 - Math.exp(-dt * 2.1));
    state.speed *= .92;
  }
  ui.warning.classList.toggle('show', offTrack && state.speed > 5);

  let delta = after.index - state.lastClosest;
  if (delta < -TRACK_STEPS / 2) delta += TRACK_STEPS;
  if (delta > TRACK_STEPS / 2) delta -= TRACK_STEPS;
  if (Math.abs(delta) < 12) state.circuitProgress += delta / TRACK_STEPS;
  state.lastClosest = after.index;
  if (state.circuitProgress >= 1) {
    const lapTime = state.sessionTime - state.lapStart;
    if (!state.bestLap || lapTime < state.bestLap) state.bestLap = lapTime;
    state.circuitProgress -= 1;
    state.lapNumber = Math.min(3, state.lapNumber + 1);
    state.lapStart = state.sessionTime;
  }

  if ((input.throttle || input.brake) && !state.started) {
    state.started = true;
    ui.message.classList.add('hide');
  }
  return forward;
}
function updateHUD() {
  const kph = Math.round(Math.abs(state.speed) * 3.6);
  ui.speed.textContent = String(kph).padStart(3, '0');
  ui.gear.textContent = state.speed < -1 ? 'R' : state.speed > 1 ? (kph > 185 ? '5' : kph > 135 ? '4' : kph > 85 ? '3' : kph > 35 ? '2' : '1') : 'N';
  ui.nitroFill.style.width = `${state.nitro}%`;
  ui.nitroLabel.textContent = `${Math.ceil(state.nitro)}%`;
  ui.lap.innerHTML = `${String(state.lapNumber).padStart(2,'0')} <em>/ 03</em>`;
  ui.time.textContent = fmtTime(state.sessionTime);
  ui.best.textContent = state.bestLap ? fmtTime(state.bestLap) : '--:--.---';
}

function animate() {
  const dt = Math.min(clock.getDelta(), .05);
  if (state.started) state.sessionTime += dt;
  const forward = updateDrive(dt);
  updateCamera(dt, forward);
  dustCloud.rotation.y += dt * .008;
  holoRing.rotation.z += dt * .07;
  redLight.intensity = 60 + Math.sin(state.sessionTime * 3.1) * 14;
  updateHUD();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

setTimeout(() => ui.loading.classList.add('done'), 650);
animate();
