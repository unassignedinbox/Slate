/**
 * main.js — viewer: scene, lighting, ground, camera rig and UI.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildEagleSkeleton, MEASURE } from './skeleton.js';
import { buildPlumage } from './plumage.js';
import { Animator, STATES } from './animation.js';

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fb4d6);
scene.fog = new THREE.Fog(0x8fb4d6, 14, 90);

/* ---------------- lighting ---------------- */
const hemi = new THREE.HemisphereLight(0xbfd8f2, 0x5b5140, 0.85);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2dc, 2.5);
sun.position.set(3.4, 5.2, 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera;
sc.near = 0.5; sc.far = 24; sc.left = -3; sc.right = 3; sc.top = 3; sc.bottom = -3;
sun.shadow.bias = -0.0008;
scene.add(sun);
const rim = new THREE.DirectionalLight(0xa9c8ff, 0.7);
rim.position.set(-4, 2.2, -3.5);
scene.add(rim);

/* ---------------- ground ---------------- */
function groundTexture() {
  const s = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const x = cv.getContext('2d');
  x.fillStyle = '#6d7a4c';
  x.fillRect(0, 0, s, s);
  for (let i = 0; i < 9000; i++) {
    const r = Math.random();
    x.fillStyle = `rgba(${60 + r * 70 | 0},${70 + r * 60 | 0},${40 + r * 40 | 0},0.6)`;
    x.fillRect(Math.random() * s, Math.random() * s, 2 + Math.random() * 5, 1 + Math.random() * 3);
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(24, 24);
  t.anisotropy = 8;
  return t;
}
const groundMat = new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 1 });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), groundMat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// a few rocks so forward motion reads on the ground
const rocks = new THREE.Group();
scene.add(rocks);
for (let i = 0; i < 40; i++) {
  const g = new THREE.IcosahedronGeometry(0.06 + Math.random() * 0.22, 0);
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
    color: new THREE.Color().setHSL(0.09, 0.12, 0.28 + Math.random() * 0.15), roughness: 1,
  }));
  m.position.set((Math.random() - 0.5) * 40, 0.02, (Math.random() - 0.5) * 40);
  m.rotation.set(Math.random(), Math.random(), Math.random());
  m.scale.y = 0.5 + Math.random() * 0.4;
  m.castShadow = true; m.receiveShadow = true;
  rocks.add(m);
}

/* ---------------- eagle ---------------- */
const rig = buildEagleSkeleton();
buildPlumage(rig);
scene.add(rig.root);

const anim = new Animator(rig);

// calibrate standing height so the talons rest exactly on the ground
function calibrate() {
  anim.setState('idle'); anim.state = 'idle'; anim.blend = 1; anim.prev = null;
  anim.curY = rig.standHeight;
  anim.update(0.0001);
  rig.root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  let minY = Infinity;
  rig.root.traverse((o) => {
    if (o.isMesh && (o.userData.isClaw || o.parent?.name?.startsWith('toe'))) {
      box.setFromObject(o);
      if (box.min.y < minY) minY = box.min.y;
    }
  });
  if (isFinite(minY)) rig.standHeight += -minY;
}
calibrate();
anim.curY = rig.standHeight;

/* ---------------- camera ---------------- */
const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.05, 300);
camera.position.set(1.5, 0.75, 2.0);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.target.set(0, 0.45, 0.05);
controls.minDistance = 0.45;
controls.maxDistance = 14;
controls.update();

/* ---------------- UI ---------------- */
const ui = {
  state: 'glide', speed: 1, skeleton: false, plumage: true,
  autoRotate: false, follow: true,
};
const btnBar = document.getElementById('states');
for (const k of Object.keys(STATES)) {
  const b = document.createElement('button');
  b.textContent = STATES[k].label;
  b.dataset.k = k;
  b.onclick = () => { ui.state = k; anim.setState(k); syncButtons(); };
  btnBar.appendChild(b);
}
function syncButtons() {
  [...btnBar.children].forEach((b) => b.classList.toggle('on', b.dataset.k === ui.state));
  document.getElementById('info').textContent = DESC[ui.state];
}
const DESC = {
  flap: '2.6 Hz wingbeat · 0.54 downstroke ratio · humeral elevation +42°/−48° · wrist and elbow flexed through the upstroke · pronation leads the stroke · body heave and pitch reaction · head stabilised by the neck · feather aeroelastic lag.',
  glide: 'Wings at slight dihedral, wrist part-flexed, primary slots open, alula closed. Thermal gusts perturb roll/pitch/heave; the wings trim asymmetrically and the head stays locked on the horizon.',
  walk: '1.15 s stride, 0.72 duty factor. Avian sprawled-femur gait — the visible joint is the ankle. Lateral waddle, twice-per-stride heave, and the thrust-and-hold head bob.',
  idle: 'Perched: ~25 breaths/min, slow weight shifts between feet, discrete head saccades, periodic rousing (whole-body feather shake), tail twitches, grip adjustment.',
  screech: 'Anticipation crouch → neck extension and 38° gape with five call pulses → settle. Wings lift off the flanks, tail depresses, body lunges forward.',
  headturn: '175° cervical rotation distributed over 14 vertebrae, with counter-rotation anticipation, saccadic hold, head roll, and return. The body stays almost still.',
};
anim.setState('glide'); anim.state = 'glide'; anim.blend = 1; anim.prev = null;
syncButtons();

document.getElementById('speed').oninput = (e) => {
  anim.speed = parseFloat(e.target.value);
  document.getElementById('speedv').textContent = anim.speed.toFixed(2) + '×';
};
document.getElementById('skel').onchange = (e) => {
  ui.skeleton = e.target.checked; applyVis();
};
document.getElementById('plum').onchange = (e) => {
  ui.plumage = e.target.checked; applyVis();
};
document.getElementById('rot').onchange = (e) => { controls.autoRotate = e.target.checked; };
controls.autoRotateSpeed = 0.8;

function applyVis() {
  rig.root.traverse((o) => {
    if (!o.isMesh) return;
    if (o.userData.isBone) o.visible = ui.skeleton;
    else if (o.userData.isFlesh) o.visible = ui.plumage;
  });
  if (!ui.plumage && !ui.skeleton) { ui.skeleton = true; document.getElementById('skel').checked = true; applyVis(); }
}
applyVis();

/* ---------------- loop ---------------- */
const clock = new THREE.Clock();
let travel = 0;

function tick() {
  const dt = Math.min(0.05, clock.getDelta());
  anim.update(dt);

  // ground-speed illusion: scroll the world past the bird
  const airborne = STATES[anim.state].airborne;
  const speed = airborne ? (anim.state === 'flap' ? 11.0 : 13.5) : (anim.state === 'walk' ? 0.62 : 0);
  travel += speed * dt * anim.speed;
  groundMat.map.offset.y = -travel / 5;
  for (const r of rocks.children) {
    r.position.z += speed * dt * anim.speed;
    if (r.position.z > 20) r.position.z -= 40;
  }
  ground.position.y = airborne ? -14 : 0;
  scene.fog.near = airborne ? 20 : 14;

  if (ui.follow) {
    const y = rig.root.position.y;
    controls.target.lerp(new THREE.Vector3(0, y + 0.06, 0.02), 0.08);
  }
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

function resize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}
addEventListener('resize', resize);
resize();
tick();

// quick keyboard access
addEventListener('keydown', (e) => {
  const keys = { 1: 'flap', 2: 'glide', 3: 'walk', 4: 'idle', 5: 'screech', 6: 'headturn' };
  if (keys[e.key]) { ui.state = keys[e.key]; anim.setState(keys[e.key]); syncButtons(); }
});

console.log('Bald eagle rig — bone measurements (m):', MEASURE);
