import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildEagle } from './eagle.js';
import { EagleAnimator, ANIMATIONS } from './animations.js';

const canvas = document.getElementById('scene');
const statusEl = document.getElementById('status');

// ---------- renderer ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

// ---------- scene ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d1117);
scene.fog = new THREE.Fog(0x0d1117, 8, 26);

// sky gradient backdrop
{
  const geo = new THREE.SphereGeometry(60, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      top: { value: new THREE.Color(0x1b3a63) },
      bot: { value: new THREE.Color(0x0a0d13) },
    },
    vertexShader: `varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
    fragmentShader: `varying vec3 vP; uniform vec3 top; uniform vec3 bot;
      void main(){ float h=clamp((normalize(vP).y*0.5+0.5),0.0,1.0); gl_FragColor=vec4(mix(bot,top,pow(h,0.8)),1.0);} `,
  });
  scene.add(new THREE.Mesh(geo, mat));
}

// ---------- camera + controls ----------
const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(2.9, 1.5, 3.7);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.target.set(0, 0.8, 0);
controls.minDistance = 1.4;
controls.maxDistance = 12;
controls.maxPolarAngle = Math.PI * 0.92;

// ---------- lights ----------
const hemi = new THREE.HemisphereLight(0xbcd4ff, 0x3a2c1e, 0.8);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2dd, 2.4);
sun.position.set(4, 7, 5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 30;
sun.shadow.camera.left = -4; sun.shadow.camera.right = 4;
sun.shadow.camera.top = 4; sun.shadow.camera.bottom = -4;
sun.shadow.bias = -0.0004;
scene.add(sun);
const rim = new THREE.DirectionalLight(0x88aaff, 0.7);
rim.position.set(-5, 3, -4);
scene.add(rim);
const fill = new THREE.DirectionalLight(0xffd9a0, 0.4);
fill.position.set(-2, 1, 5);
scene.add(fill);

// ---------- ground ----------
const ground = new THREE.Group();
scene.add(ground);
{
  const mat = new THREE.MeshStandardMaterial({ color: 0x27313b, roughness: 0.97 });
  const disc = new THREE.Mesh(new THREE.CircleGeometry(20, 64), mat);
  disc.rotation.x = -Math.PI / 2;
  disc.receiveShadow = true;
  ground.add(disc);
  const grid = new THREE.GridHelper(40, 80, 0x3d4b57, 0x2a333d);
  grid.material.transparent = true; grid.material.opacity = 0.35;
  ground.add(grid);
}

// ---------- eagle ----------
const rig = buildEagle();
scene.add(rig.root);
rig.root.position.y = 0.5;
const animator = new EagleAnimator(rig);

// collect meshes for wireframe toggle
const meshes = [];
rig.root.traverse((o) => { if (o.isMesh) meshes.push(o); });

// ---------- UI ----------
let current = ANIMATIONS[1]; // start on Wing Flap (shows off the model in motion)
let speed = 1;

const btnWrap = document.getElementById('animButtons');
const nameEl = document.getElementById('animName');
const descEl = document.getElementById('animDesc');
const buttons = {};
for (const a of ANIMATIONS) {
  const b = document.createElement('button');
  b.innerHTML = `<span>${a.icon}</span> ${a.name}`;
  b.onclick = () => setAnim(a);
  btnWrap.appendChild(b);
  buttons[a.id] = b;
}
function setAnim(a) {
  current = a;
  for (const id in buttons) buttons[id].classList.toggle('active', id === a.id);
  nameEl.textContent = a.name;
  descEl.textContent = a.desc;
}
setAnim(current);

document.getElementById('speed').addEventListener('input', (e) => {
  speed = parseFloat(e.target.value);
  document.getElementById('speedVal').textContent = speed.toFixed(2) + '×';
});
document.getElementById('autoRotate').addEventListener('change', (e) => {
  controls.autoRotate = e.target.checked;
  controls.autoRotateSpeed = 1.2;
});
document.getElementById('showGround').addEventListener('change', (e) => {
  ground.visible = e.target.checked;
});
document.getElementById('wireframe').addEventListener('change', (e) => {
  for (const m of meshes) if (m.material) m.material.wireframe = e.target.checked;
});

// ---------- resize ----------
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ---------- loop ----------
const clock = new THREE.Clock();
statusEl.textContent = 'Ready';
statusEl.classList.add('ready');

function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  animator.update(dt, speed, current.fn);
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
tick();
