import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildRex, DIM } from './skeleton.js';
import { RexAnimator } from './anim.js';

const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0c0e12);
scene.fog = new THREE.FogExp2(0x0c0e12, 0.011);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.06).texture;
scene.environmentIntensity = 0.35;

const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 400);
camera.position.set(9.5, 3.4, 11.5);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.target.set(0, 2.5, 0);
controls.maxPolarAngle = Math.PI * 0.495;
controls.minDistance = 3;
controls.maxDistance = 60;

/* ---------------- lighting: museum-hall key/fill/rim ---------------- */
const key = new THREE.DirectionalLight(0xfff2e0, 2.6);
key.position.set(9, 14, 7);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.near = 1; key.shadow.camera.far = 60;
const S = 12;
Object.assign(key.shadow.camera, { left: -S, right: S, top: S, bottom: -S });
key.shadow.bias = -0.0009;
key.shadow.normalBias = 0.02;
scene.add(key);
const keyTargetGroup = new THREE.Object3D();
scene.add(keyTargetGroup);
key.target = keyTargetGroup;

const fill = new THREE.DirectionalLight(0x93b5ff, 0.55);
fill.position.set(-10, 6, -8);
scene.add(fill);
const rim = new THREE.SpotLight(0xffd9a8, 180, 60, 0.7, 0.6, 1.6);
rim.position.set(-6, 9, -12);
scene.add(rim);
scene.add(new THREE.HemisphereLight(0x6f8dbb, 0x201a14, 0.45));

/* ---------------- ground ---------------- */
const groundMat = new THREE.MeshStandardMaterial({ color: 0x14161b, roughness: 0.95, metalness: 0.0 });
const ground = new THREE.Mesh(new THREE.CircleGeometry(120, 96), groundMat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const grid = new THREE.GridHelper(120, 120, 0x2b3140, 0x232833);
scene.add(grid);
grid.material.opacity = 0.32; grid.material.transparent = true;
grid.position.y = 0.002;

/* ---------------- the animal ---------------- */
const rig = buildRex();
scene.add(rig.root);
const anim = new RexAnimator(rig);

/* dust puffs on footfall */
const dustGeo = new THREE.BufferGeometry();
const DUST = 260;
const dpos = new Float32Array(DUST * 3), dvel = new Float32Array(DUST * 3), dlife = new Float32Array(DUST);
dustGeo.setAttribute('position', new THREE.BufferAttribute(dpos, 3));
const dustMat = new THREE.PointsMaterial({ color: 0x8b7f6d, size: 0.16, transparent: true, opacity: 0.35, depthWrite: false });
const dust = new THREE.Points(dustGeo, dustMat);
scene.add(dust);
let dustHead = 0;
function puff(x, y, z, power) {
  for (let i = 0; i < 12; i++) {
    const k = dustHead = (dustHead + 1) % DUST;
    dpos[k * 3] = x + (Math.random() - 0.5) * 0.3;
    dpos[k * 3 + 1] = y + Math.random() * 0.1;
    dpos[k * 3 + 2] = z + (Math.random() - 0.5) * 0.3;
    dvel[k * 3] = (Math.random() - 0.5) * 0.8 * power;
    dvel[k * 3 + 1] = Math.random() * 0.7 * power;
    dvel[k * 3 + 2] = (Math.random() - 0.5) * 0.8 * power;
    dlife[k] = 1;
  }
}
function stepDust(dt) {
  for (let i = 0; i < DUST; i++) {
    if (dlife[i] <= 0) continue;
    dlife[i] -= dt * 0.85;
    dpos[i * 3] += dvel[i * 3] * dt;
    dpos[i * 3 + 1] += dvel[i * 3 + 1] * dt;
    dpos[i * 3 + 2] += dvel[i * 3 + 2] * dt;
    dvel[i * 3 + 1] -= dt * 0.6;
    if (dlife[i] <= 0) { dpos[i * 3 + 1] = -999; }
  }
  dustGeo.getAttribute('position').needsUpdate = true;
}

/* ---------------- UI ---------------- */
const ui = {
  gait: document.querySelectorAll('[data-gait]'),
  roar: document.getElementById('roar'),
  sniff: document.getElementById('sniff'),
  follow: document.getElementById('follow'),
  hud: document.getElementById('hud'),
};
let followCam = true;
ui.gait.forEach(b => b.addEventListener('click', () => {
  ui.gait.forEach(x => x.classList.remove('on'));
  b.classList.add('on');
  anim.setGait(b.dataset.gait);
}));
ui.roar.addEventListener('click', () => anim.trigger('roar'));
ui.sniff.addEventListener('click', () => anim.trigger('sniff'));
ui.follow.addEventListener('click', () => {
  followCam = !followCam;
  ui.follow.classList.toggle('on', followCam);
});
addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (k === '1') document.querySelector('[data-gait="idle"]').click();
  if (k === '2') document.querySelector('[data-gait="walk"]').click();
  if (k === '3') document.querySelector('[data-gait="run"]').click();
  if (k === 'r') anim.trigger('roar');
  if (k === 's') anim.trigger('sniff');
  if (k === 'f') ui.follow.click();
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
renderer.setSize(innerWidth, innerHeight);

/* ---------------- loop ---------------- */
const clock = new THREE.Clock();
let lastPlant = { L: true, R: true };
const tmp = new THREE.Vector3();

function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  anim.update(dt);

  // footfall dust
  for (const s of ['L', 'R']) {
    const leg = rig.joints[s === 'L' ? 'legL' : 'legR'];
    if (leg._plant && !lastPlant[s]) {
      leg.foot.getWorldPosition(tmp);
      puff(tmp.x, 0.02, tmp.z, 0.6 + anim.params.speed * 0.18);
    }
    lastPlant[s] = leg._plant;
  }
  stepDust(dt);

  // camera + light follow the animal down the hall
  const p = rig.root.position;
  keyTargetGroup.position.set(p.x, 2, p.z);
  key.position.set(p.x + 9, 14, p.z + 7);
  rim.position.set(p.x - 6, 9, p.z - 12);
  rim.target.position.copy(p); rim.target.updateMatrixWorld();
  grid.position.x = Math.round(p.x);
  grid.position.z = Math.round(p.z);
  if (followCam) {
    controls.target.lerp(tmp.set(p.x, 2.4, p.z), 1 - Math.exp(-dt * 3));
    camera.position.x += (p.x - (controls.target.x - camera.position.x) * 0 - camera.position.x) * 0;
  }
  controls.update();

  ui.hud.textContent = `${anim.gait.toUpperCase()}  ·  ${anim.params.speed.toFixed(2)} m/s  ·  stride ${anim.params.stride.toFixed(2)} m  ·  ${(anim.params.freq).toFixed(2)} Hz  ·  travelled ${anim.distance.toFixed(1)} m`;

  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
tick();

// keep the camera trailing the animal rather than being left behind
let prevX = 0, prevZ = 0;
setInterval(() => {
  const p = rig.root.position;
  if (followCam) {
    camera.position.x += p.x - prevX;
    camera.position.z += p.z - prevZ;
  }
  prevX = p.x; prevZ = p.z;
}, 16);

window.__rex = { rig, anim, scene, camera, renderer, THREE };
