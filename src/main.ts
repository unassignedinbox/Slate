import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { PhysicsWorld } from './physics';
import { ParticleSystem } from './particles';
import { Ctx, HitInfo, Station } from './stations/common';
import { GlassStation } from './stations/glass';
import { WoodStation } from './stations/wood';
import { WallStation } from './stations/wall';
import { PlasticStation } from './stations/plastic';
import { RockStation } from './stations/rock';
import { playImpact } from './audio';

// ---------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.getElementById('app')!.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x10141b);
scene.fog = new THREE.Fog(0x10141b, 18, 42);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.05, 200);
camera.position.set(0, 2.1, 6.4);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.9, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.495;
controls.minDistance = 1.5;
controls.maxDistance = 18;

// ---------------------------------------------------------------- lights
const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x2a2620, 0.55);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff1dd, 2.6);
sun.position.set(6, 9, 4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -8;
sun.shadow.camera.right = 8;
sun.shadow.camera.top = 8;
sun.shadow.camera.bottom = -4;
sun.shadow.camera.far = 30;
sun.shadow.bias = -0.0005;
scene.add(sun);
const fill = new THREE.DirectionalLight(0x6f87b8, 0.5);
fill.position.set(-5, 4, -6);
scene.add(fill);

// ---------------------------------------------------------------- ground
function groundTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = '#3c414a';
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 2600; i++) {
    const v = 52 + Math.random() * 26;
    g.fillStyle = `rgb(${v},${v + 3},${v + 8})`;
    g.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
  }
  g.strokeStyle = 'rgba(18,20,26,0.55)';
  g.lineWidth = 3;
  g.strokeRect(0, 0, 512, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(24, 24);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const ground = new THREE.Mesh(
  new THREE.CircleGeometry(40, 48).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 0.95, metalness: 0 })
);
ground.receiveShadow = true;
scene.add(ground);

// ---------------------------------------------------------------- core systems
const world = new PhysicsWorld();
world.onRemove = (b) => {
  scene.remove(b.mesh);
  const m = b.mesh as THREE.Mesh;
  if (m.geometry) m.geometry.dispose();
};
const particles = new ParticleSystem(scene);

const hittables = new Map<THREE.Object3D, (hit: HitInfo) => void>();
const hitMeshList: THREE.Object3D[] = [];

const ctx: Ctx = {
  scene,
  world,
  particles,
  registerHittable(mesh, onHit) {
    hittables.set(mesh, onHit);
    hitMeshList.push(mesh);
  },
  unregisterHittable(mesh) {
    hittables.delete(mesh);
    const i = hitMeshList.indexOf(mesh);
    if (i >= 0) hitMeshList.splice(i, 1);
  },
};

// ---------------------------------------------------------------- stations
const stations: Station[] = [
  new GlassStation(ctx, new THREE.Vector3(-4.6, 0, 0)),
  new WoodStation(ctx, new THREE.Vector3(-2.3, 0, 0)),
  new WallStation(ctx, new THREE.Vector3(0, 0, 0)),
  new PlasticStation(ctx, new THREE.Vector3(2.4, 0, 0)),
  new RockStation(ctx, new THREE.Vector3(4.5, 0, 0)),
];
for (const s of stations) scene.add(s.group);

// labels
function label(text: string, x: number, y: number): void {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 96;
  const g = c.getContext('2d')!;
  g.font = '600 44px "Segoe UI", system-ui, sans-serif';
  g.textAlign = 'center';
  g.fillStyle = 'rgba(230,240,255,0.85)';
  g.fillText(text, 256, 62);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.set(1.6, 0.3, 1);
  sp.position.set(x, y, 0);
  scene.add(sp);
}
label('GLASS', -4.6, 1.85);
label('WOOD', -2.3, 1.1);
label('CONCRETE', 0, 1.95);
label('PLASTIC', 2.4, 1.8);
label('ROCK', 4.5, 1.35);

// ---------------------------------------------------------------- projectiles
interface Ball {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  age: number;
}
const balls: Ball[] = [];
const ballGeo = new THREE.SphereGeometry(0.045, 20, 14);
const ballMat = new THREE.MeshStandardMaterial({ color: 0xd8dde5, metalness: 0.95, roughness: 0.25 });
const raycaster = new THREE.Raycaster();

function shoot(ndc: THREE.Vector2, speed: number): void {
  raycaster.setFromCamera(ndc, camera);
  const dir = raycaster.ray.direction.clone().normalize();
  const mesh = new THREE.Mesh(ballGeo, ballMat);
  mesh.castShadow = true;
  mesh.position.copy(camera.position).addScaledVector(dir, 0.3);
  scene.add(mesh);
  balls.push({ mesh, vel: dir.multiplyScalar(speed), age: 0 });
  playImpact('shot', 0.7);
}

const prevPos = new THREE.Vector3();
function updateBalls(dt: number): void {
  for (let i = balls.length - 1; i >= 0; i--) {
    const b = balls[i];
    b.age += dt;
    prevPos.copy(b.mesh.position);
    b.vel.y -= 9.81 * dt;
    b.mesh.position.addScaledVector(b.vel, dt);

    // swept raycast against destructibles
    const seg = b.mesh.position.clone().sub(prevPos);
    const segLen = seg.length();
    if (segLen > 1e-6 && hitMeshList.length) {
      raycaster.set(prevPos, seg.clone().normalize());
      raycaster.far = segLen + 0.05;
      const hits = raycaster.intersectObjects(hitMeshList, false);
      if (hits.length) {
        const h = hits[0];
        const handler = hittables.get(h.object);
        const speed = b.vel.length();
        if (handler) {
          handler({
            point: h.point.clone(),
            dir: b.vel.clone().normalize(),
            speed,
          });
        }
        // the ball punches through, losing most of its energy
        b.mesh.position.copy(h.point).addScaledVector(b.vel.clone().normalize(), 0.03);
        b.vel.multiplyScalar(0.35);
        if (b.vel.length() < 4) {
          scene.remove(b.mesh);
          balls.splice(i, 1);
          continue;
        }
      }
    }

    // ground bounce
    if (b.mesh.position.y < 0.045) {
      b.mesh.position.y = 0.045;
      if (Math.abs(b.vel.y) > 0.8) b.vel.y = -b.vel.y * 0.45;
      else b.vel.y = 0;
      b.vel.x *= 0.85;
      b.vel.z *= 0.85;
    }
    if (b.age > 8 || (b.mesh.position.y <= 0.046 && b.vel.lengthSq() < 0.02)) {
      scene.remove(b.mesh);
      balls.splice(i, 1);
    }
  }
}

// ---------------------------------------------------------------- input
const powerEl = document.getElementById('power') as HTMLInputElement;
const powerVal = document.getElementById('powerVal')!;
powerEl.addEventListener('input', () => (powerVal.textContent = `${powerEl.value} m/s`));

let downPos = { x: 0, y: 0 };
renderer.domElement.addEventListener('pointerdown', (e) => {
  downPos = { x: e.clientX, y: e.clientY };
});
renderer.domElement.addEventListener('pointerup', (e) => {
  const dx = e.clientX - downPos.x;
  const dy = e.clientY - downPos.y;
  if (dx * dx + dy * dy < 25) {
    const ndc = new THREE.Vector2(
      (e.clientX / window.innerWidth) * 2 - 1,
      -(e.clientY / window.innerHeight) * 2 + 1
    );
    shoot(ndc, parseFloat(powerEl.value));
  }
});

let timeScale = 1;
const btnSlow = document.getElementById('btnSlow')!;
function toggleSlow(): void {
  timeScale = timeScale === 1 ? 0.18 : 1;
  btnSlow.classList.toggle('active', timeScale !== 1);
}
btnSlow.addEventListener('click', toggleSlow);

function resetAll(): void {
  world.clear();
  for (const b of balls) scene.remove(b.mesh);
  balls.length = 0;
  for (const s of stations) s.reset();
}
document.getElementById('btnReset')!.addEventListener('click', resetAll);

window.addEventListener('keydown', (e) => {
  if (e.key === 'r' || e.key === 'R') resetAll();
  if (e.key === 's' || e.key === 'S') toggleSlow();
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------- loop
const statsEl = document.getElementById('stats')!;
const clock = new THREE.Clock();
let fpsAcc = 0;
let fpsFrames = 0;
let fpsShown = 60;

function tick(): void {
  requestAnimationFrame(tick);
  const rawDt = Math.min(clock.getDelta(), 0.05);
  const dt = rawDt * timeScale;

  // fixed-ish substeps keep stacks of debris stable
  const sub = dt > 1 / 100 ? 2 : 1;
  for (let i = 0; i < sub; i++) world.step(dt / sub);

  updateBalls(dt);
  particles.update(dt);
  for (const s of stations) s.update(dt);

  controls.update();
  renderer.render(scene, camera);

  fpsAcc += rawDt;
  fpsFrames++;
  if (fpsAcc > 0.5) {
    fpsShown = Math.round(fpsFrames / fpsAcc);
    fpsAcc = 0;
    fpsFrames = 0;
  }
  statsEl.textContent = `${fpsShown} fps · ${world.bodies.length} rigid shards · ${hitMeshList.length} destructible meshes`;
}
tick();
