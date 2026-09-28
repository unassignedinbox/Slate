import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildEagle } from './eagle.js';
import { Animator } from './animator.js';
import { groundTexture, skyTexture, hash } from './util.js';
import { exportGLB } from './export.js';

// ---------------- renderer / scene ----------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = skyTexture();
scene.fog = new THREE.Fog(0xcfdde8, 18, 60);

const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.05, 200);
camera.position.set(1.9, 1.0, 2.6);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 0.8;
controls.maxDistance = 14;
controls.maxPolarAngle = Math.PI * 0.55;

// ---------------- lights ----------------
const hemi = new THREE.HemisphereLight(0xbfd6ec, 0x51503a, 1.0);
scene.add(new THREE.AmbientLight(0x707a86, 0.35));
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
sun.position.set(4, 7, 3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -3; sun.shadow.camera.right = 3;
sun.shadow.camera.top = 4; sun.shadow.camera.bottom = -2;
sun.shadow.camera.near = 1; sun.shadow.camera.far = 20;
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.025;
scene.add(sun);
const rim = new THREE.DirectionalLight(0x9db8d9, 0.7);
rim.position.set(-4, 3, -4);
scene.add(rim);

// ---------------- environment ----------------
const gtex = groundTexture();
gtex.repeat.set(7, 7);
const ground = new THREE.Mesh(
  new THREE.CircleGeometry(30, 48),
  new THREE.MeshStandardMaterial({ map: gtex, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// distant hills
const hillMat = new THREE.MeshStandardMaterial({ color: 0x5a7257, roughness: 1, flatShading: true });
for (let i = 0; i < 11; i++) {
  const a = (i / 11) * Math.PI * 2 + hash(i) * 0.5;
  const r = 34 + hash(i * 3) * 10;
  const h = 4 + hash(i * 7) * 9;
  const hill = new THREE.Mesh(new THREE.ConeGeometry(8 + hash(i * 5) * 9, h, 7), hillMat);
  hill.position.set(Math.cos(a) * r, h / 2 - 0.5, Math.sin(a) * r);
  hill.rotation.y = hash(i * 9) * 3;
  scene.add(hill);
}
// clouds (billboards)
const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, fog: false, depthWrite: false });
for (let i = 0; i < 8; i++) {
  const a = (i / 8) * Math.PI * 2 + hash(i + 40) * 0.8;
  const c = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), cloudMat);
  c.position.set(Math.cos(a) * (24 + hash(i) * 14), 9 + hash(i * 2 + 1) * 7, Math.sin(a) * (24 + hash(i + 7) * 14));
  c.scale.set(4 + hash(i * 3) * 4, 1 + hash(i * 5) * 0.8, 2.2);
  scene.add(c);
}

// ---------------- eagle ----------------
const eagle = buildEagle();
scene.add(eagle.root);
const anim = new Animator(eagle);

anim.onGroundScroll = (v) => { gtex.offset.y += v * clock._dt * 0.030; };

// ---------------- plumage variants ----------------
const PLUMAGES = {
  bald: {
    label: 'Bald Eagle',
    primary: '#241a10', secondary: '#332516', covertDark: '#3d2c1a', covertMid: '#4a3722',
    bodyDark: '#382817', bodyMid: '#4d3921', bodyLight: '#5d4729',
    white: '#e9e4d8', whiteBright: '#f4f0e6',
    torso: '#3a2a18', skin: '#e7e2d5', beak: '#f0b429', cere: '#d89b1f',
    foot: '#eeb838', eye: '#e8c53a', membrane: '#33251a',
  },
  golden: {
    label: 'Golden Eagle',
    primary: '#1f1710', secondary: '#2b2014', covertDark: '#3f2f1c', covertMid: '#5a432a',
    bodyDark: '#3b2c1a', bodyMid: '#523e27', bodyLight: '#6d5335',
    white: '#a8813f', whiteBright: '#3a2c1d',
    torso: '#3a2b19', skin: '#57402a', beak: '#767c85', cere: '#d9b23a',
    foot: '#e5b53e', eye: '#a06f2c', membrane: '#33251a',
  },
  falcon: {
    label: 'Gyrfalcon (dark)',
    primary: '#22252b', secondary: '#2c3037', covertDark: '#363b43', covertMid: '#454c55',
    bodyDark: '#3f454e', bodyMid: '#4a515a', bodyLight: '#5d656f',
    white: '#b9bcc0', whiteBright: '#6a727c',
    torso: '#343a41', skin: '#3b4148', beak: '#8a92a0', cere: '#e3c04a',
    foot: '#eec545', eye: '#2f2319', membrane: '#2a2d33',
  },
};
function setPlumage(key) {
  const p = PLUMAGES[key];
  if (!p) return;
  for (const [k, mat] of Object.entries(eagle.materials)) {
    if (p[k]) mat.color.set(p[k]);
  }
  document.querySelector('#panel h1').textContent = '\u{1F985} ' + p.label;
}

// ---------------- screech audio (synthesized) ----------------
let audioCtx = null;
function screechSound() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const ctx = audioCtx, t0 = ctx.currentTime;
    const dur = 1.05;
    const master = ctx.createGain();
    master.gain.setValueAtTime(0, t0);
    master.gain.linearRampToValueAtTime(0.22, t0 + 0.04);
    master.gain.setValueAtTime(0.22, t0 + 0.35);
    master.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    master.connect(ctx.destination);
    // tonal core: descending "keeee-arr"
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(2950, t0);
    osc.frequency.setValueAtTime(2950, t0 + 0.14);
    osc.frequency.exponentialRampToValueAtTime(1250, t0 + 0.9);
    const vib = ctx.createOscillator(); vib.frequency.value = 27;
    const vibG = ctx.createGain(); vibG.gain.value = 70;
    vib.connect(vibG); vibG.connect(osc.frequency);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 4200;
    const og = ctx.createGain(); og.gain.value = 0.55;
    osc.connect(lp); lp.connect(og); og.connect(master);
    // raspy noise through a tracking bandpass
    const nBuf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
    const d = nBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource(); noise.buffer = nBuf;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 7;
    bp.frequency.setValueAtTime(3300, t0);
    bp.frequency.exponentialRampToValueAtTime(1500, t0 + 0.9);
    const ng = ctx.createGain(); ng.gain.value = 0.8;
    noise.connect(bp); bp.connect(ng); ng.connect(master);
    osc.start(t0); osc.stop(t0 + dur);
    vib.start(t0); vib.stop(t0 + dur);
    noise.start(t0);
  } catch (e) { /* audio unavailable */ }
}

// ---------------- UI ----------------
const stateLabel = document.getElementById('stateLabel');
anim.listeners.push(s => {
  stateLabel.textContent = ({
    idle: 'Idle', walk: 'Walk', flight: 'Flight', glide: 'Glide / Soar',
    takeoff: 'Taking off…', landing: 'Landing…',
  })[s] || s;
  document.querySelectorAll('#panel button[data-state]').forEach(b =>
    b.classList.toggle('active', b.dataset.state === s));
});
document.querySelectorAll('#panel button[data-state]').forEach(b => {
  b.addEventListener('click', () => anim.request(b.dataset.state));
});
document.getElementById('screech').addEventListener('click', () => { anim.doScreech(); screechSound(); });
document.getElementById('plumage').addEventListener('change', e => setPlumage(e.target.value));
document.getElementById('orbit').addEventListener('change', e => { controls.autoRotate = e.target.checked; });
controls.autoRotateSpeed = 1.1;
// cry on launch
anim.listeners.push(s => { if (s === 'takeoff') setTimeout(screechSound, 450); });
document.getElementById('speed').addEventListener('input', e => {
  anim.speed = parseFloat(e.target.value);
  document.getElementById('speedVal').textContent = anim.speed.toFixed(1) + '×';
});
document.getElementById('export').addEventListener('click', async () => {
  const btn = document.getElementById('export');
  btn.disabled = true; btn.textContent = 'Baking clips…';
  await new Promise(r => setTimeout(r, 30));
  try { await exportGLB(eagle, anim); btn.textContent = 'Export .GLB'; }
  catch (err) { console.error(err); btn.textContent = 'Export failed'; }
  btn.disabled = false;
});

// ---------------- loop ----------------
const clock = new THREE.Clock();
clock._dt = 0;
const camTarget = new THREE.Vector3(0, 0.5, 0);
const bodyWorld = new THREE.Vector3();

let frozen = null;
function frame() {
  requestAnimationFrame(frame);
  let dt = Math.min(clock.getDelta(), 0.05);
  if (frozen !== null) { anim.time = frozen; dt = 0; }
  clock._dt = dt;
  anim.update(dt);
  // camera follows body height smoothly
  eagle.bones.body.getWorldPosition(bodyWorld);
  camTarget.lerp(new THREE.Vector3(bodyWorld.x * 0.3, bodyWorld.y, bodyWorld.z * 0.3), Math.min(1, dt * 2.5));
  controls.target.copy(camTarget);
  // keep sun shadow centered on the bird
  sun.position.set(4, 7 + bodyWorld.y * 0.5, 3);
  sun.target.position.set(0, bodyWorld.y * 0.5, 0);
  sun.target.updateMatrixWorld();
  controls.update();
  renderer.render(scene, camera);
}
frame();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// debug hooks for automated review
window.EAGLE = {
  anim,
  setState: (s) => anim.request(s),
  freeze: (t) => { frozen = t; },
  unfreeze: () => { frozen = null; },
  forceState: (s) => {   // hard-set weights (review use)
    anim.oneshot = null; anim.state = s;
    for (const k of Object.keys(anim.weights)) anim.weights[k] = k === s ? 1 : 0;
    anim.grounded = (s === 'idle' || s === 'walk');
    anim._notify();
  },
  eagle,
  export: async (opts) => {
    const m = await import('./export.js');
    return m.exportGLB(eagle, anim, opts);
  },
  cam: (x, y, z, tx = 0, ty = 0.5, tz = 0) => {
    camera.position.set(x, y, z);
    controls.target.set(tx, ty, tz);
    camTarget.set(tx, ty, tz);
    controls.update();
  },
};
