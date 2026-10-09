// In-car tablet scene.
// - The cabin is a stylised set (dashboard, pillars, roof, wheel, moving road). It is not a car model.
// - The tablet body is a WebGL mesh. Its screen is the live HMI (app.html) running in an iframe placed in
//   CSS 3D, so the real DOM and the WebGL suspension view render inside the tablet and take touch/mouse input.
// - The HMI posts its speed to this page, so the road scenery matches what the tablet shows.
import * as THREE from 'three';
import { CSS3DRenderer, CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const SCREEN_PX_W = 1280;
const SCREEN_PX_H = 720;
const SCREEN_W = 0.3;                      // metres: physical width of the tablet screen
const UNIT = SCREEN_W / SCREEN_PX_W;       // metres per CSS pixel (both renderers share this scale)
const BEZEL = 0.0225;                      // metres
const TABLET_POS = new THREE.Vector3(0.0, 1.06, -0.5);
const TABLET_EULER = new THREE.Euler(-0.22, -0.42, 0, 'YXZ');
const CAM_POS = new THREE.Vector3(-0.36, 1.12, 0.32);   // driver's eye point
const CAM_LOOK = new THREE.Vector3(0.0, 1.04, -0.5);   // aim at the tablet

// ---- renderers
const host = document.getElementById('scene');
const webgl = new THREE.WebGLRenderer({ antialias: true });
webgl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
webgl.shadowMap.enabled = true;
webgl.shadowMap.type = THREE.PCFSoftShadowMap;
host.append(webgl.domElement);

const css = new CSS3DRenderer();
css.domElement.classList.add('css-layer');
host.append(css.domElement);

// ---- scene
function skyTexture() {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, '#0a1424');
  grd.addColorStop(0.5, '#1c2e3f');
  grd.addColorStop(0.53, '#1a222c');
  grd.addColorStop(1, '#1a222c');
  g.fillStyle = grd;
  g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const scene = new THREE.Scene();
scene.background = skyTexture();
scene.fog = new THREE.Fog(0x1a2330, 30, 150);
const cssScene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(40, 1, 0.02, 200);
camera.position.copy(CAM_POS);
camera.lookAt(CAM_LOOK);

scene.add(new THREE.HemisphereLight(0xcfe3f5, 0x1a1d22, 1.7));
const sun = new THREE.DirectionalLight(0xffffff, 2.6);
sun.position.set(-2, 4, 2);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -2, right: 2, top: 2, bottom: -2, near: 0.5, far: 12 });
sun.shadow.bias = -0.0008;
scene.add(sun);

const mat = {
  dash: new THREE.MeshStandardMaterial({ color: 0x3a434e, roughness: 0.6, metalness: 0.1 }),
  trim: new THREE.MeshStandardMaterial({ color: 0x1a2028, roughness: 0.8 }),
  rubber: new THREE.MeshStandardMaterial({ color: 0x14181e, roughness: 0.5 }),
  bezel: new THREE.MeshStandardMaterial({ color: 0x07090c, roughness: 0.35, metalness: 0.4 }),
  road: new THREE.MeshStandardMaterial({ color: 0x1d2228, roughness: 0.95 }),
  ground: new THREE.MeshStandardMaterial({ color: 0x2a3138, roughness: 1 }),
  paint: new THREE.MeshBasicMaterial({ color: 0xe8edf2 }),
};

// ---- cabin (stylised, no car model)
const cabin = new THREE.Group();
scene.add(cabin);
function part(w, h, d, m, x, y, z, r = 0.02) {
  const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 4, r), m);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  cabin.add(mesh);
  return mesh;
}
part(1.9, 0.26, 0.8, mat.dash, 0, 0.82, -0.62);              // dashboard
part(0.5, 0.42, 0.5, mat.trim, 0, 0.5, -0.42, 0.04);         // centre console
part(0.08, 0.7, 0.08, mat.trim, -0.86, 1.25, -0.9).rotation.x = 0.3; // A-pillars
part(0.08, 0.7, 0.08, mat.trim, 0.86, 1.25, -0.9).rotation.x = 0.3;
part(1.9, 0.06, 2.6, mat.trim, 0, 1.6, -0.6);                // roof
part(0.12, 0.5, 2.4, mat.trim, -1.0, 0.85, -0.4);            // door trims
part(0.12, 0.5, 2.4, mat.trim, 1.0, 0.85, -0.4);

// Steering wheel (driver side, facing the driver)
const wheel = new THREE.Group();
wheel.position.set(-0.46, 0.96, -0.5);
wheel.rotation.set(-0.5, 0, 0);
const rim = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.017, 12, 48), mat.rubber);
rim.castShadow = true;
wheel.add(rim);
const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 20), mat.trim);
hub.rotation.x = Math.PI / 2;
wheel.add(hub);
for (const a of [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3]) {
  const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.16, 0.02), mat.trim);
  spoke.position.set(Math.sin(a) * 0.09, Math.cos(a) * 0.09, 0);
  spoke.rotation.z = -a;
  wheel.add(spoke);
}
cabin.add(wheel);

// ---- road and roadside (moves with the HMI's speed)
const world = new THREE.Group();
scene.add(world);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), mat.ground);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
world.add(ground);
const asphalt = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 400), mat.road);
asphalt.rotation.x = -Math.PI / 2;
asphalt.position.y = 0.002;
world.add(asphalt);
for (const x of [-3.5, 3.5]) {
  const edge = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.006, 400), mat.paint);
  edge.position.set(x, 0.004, 0);
  world.add(edge);
}
const dashes = [];
for (let i = 0; i < 40; i++) {
  const d = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.006, 3), mat.paint);
  d.position.y = 0.004;
  world.add(d);
  dashes.push(d);
}
const posts = [];
for (let i = 0; i < 24; i++) {
  const side = i % 2 ? 1 : -1;
  const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.4, 8), mat.paint);
  p.position.y = 0.7;
  p.userData.side = side;
  p.userData.slot = Math.floor(i / 2);
  world.add(p);
  posts.push(p);
}
const LOOP = 240;

// ---- the tablet (WebGL body + CSS 3D screen)
const tablet = new THREE.Group();
tablet.position.copy(TABLET_POS);
tablet.rotation.copy(TABLET_EULER);
scene.add(tablet);
const screenH = SCREEN_W * (SCREEN_PX_H / SCREEN_PX_W);
const body = new THREE.Mesh(new RoundedBoxGeometry(SCREEN_W + 2 * BEZEL, screenH + 2 * BEZEL, 0.024, 5, 0.012), mat.bezel);
body.castShadow = true;
tablet.add(body);

const iframe = document.createElement('iframe');
iframe.src = 'app.html';   // the live HMI, fully interactive
iframe.title = 'Slate HMI';
iframe.width = String(SCREEN_PX_W);
iframe.height = String(SCREEN_PX_H);
iframe.style.cssText = 'border:0;border-radius:26px;display:block;background:#070b10;';
const wrap = document.createElement('div');
wrap.style.cssText = `width:${SCREEN_PX_W}px;height:${SCREEN_PX_H}px;`;
wrap.append(iframe);
const screen = new CSS3DObject(wrap);
screen.scale.setScalar(UNIT);
cssScene.add(screen);

// Debug/test hook: project a point in iframe pixels (0..1280, 0..720) to page pixels,
// using the same camera the CSS 3D layer uses, so taps can be aimed at the tilted screen.
window.carScene = {
  toPage(lx, ly) {
    screen.updateMatrixWorld(true);
    const p = screen.localToWorld(new THREE.Vector3(lx - SCREEN_PX_W / 2, -(ly - SCREEN_PX_H / 2), 0));
    p.project(camera);
    return { x: (p.x + 1) / 2 * window.innerWidth, y: (1 - p.y) / 2 * window.innerHeight };
  },
};

// ---- sizing and loop
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  webgl.setSize(w, h);
  css.setSize(w, h);
  camera.aspect = w / h;
  camera.fov = w / h < 1.2 ? 56 : 40;   // keep the tablet in frame on portrait windows
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

let speedNow = 0, speedTarget = 60, roadOffset = 0;
window.addEventListener('message', (e) => {
  if (e.source === iframe.contentWindow && e.data?.type === 'telemetry') speedTarget = e.data.speedKph;
});

const clock = new THREE.Clock();
const normal = new THREE.Vector3();
function frame() {
  const dt = Math.min(0.05, clock.getDelta());
  const t = clock.elapsedTime;

  speedNow += (speedTarget - speedNow) * Math.min(1, dt * 4);
  roadOffset += (speedNow / 3.6) * dt;
  dashes.forEach((d, i) => { d.position.z = -((i * 6 + roadOffset) % LOOP) + 6; });
  posts.forEach((p) => { p.position.x = p.userData.side * 4.6; p.position.z = -((p.userData.slot * 20 + roadOffset) % LOOP) + 6; });

  // Gentle idle motion so the scene feels alive without any input.
  camera.position.set(CAM_POS.x + Math.sin(t * 0.35) * 0.012, CAM_POS.y + Math.sin(t * 0.5) * 0.006, CAM_POS.z);
  camera.lookAt(CAM_LOOK);
  tablet.rotation.set(TABLET_EULER.x + Math.sin(t * 0.6) * 0.01, TABLET_EULER.y + Math.sin(t * 0.3) * 0.02, 0, 'YXZ');

  // Keep the CSS screen glued to the front face of the WebGL tablet.
  tablet.updateMatrixWorld();
  normal.set(0, 0, 1).applyQuaternion(tablet.quaternion).multiplyScalar(0.0125);
  screen.position.copy(tablet.position).add(normal);
  screen.quaternion.copy(tablet.quaternion);

  webgl.render(scene, camera);
  css.render(cssScene, camera);
  requestAnimationFrame(frame);
}
frame();
