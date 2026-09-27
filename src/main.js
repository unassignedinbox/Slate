import * as THREE from 'three';
import { buildCave } from './world/cave.js';
import { buildLighting, animateLighting } from './world/lighting.js';
import { buildDust } from './world/dust.js';
import { buildSpiderMaterials } from './spider/materials.js';
import { SpiderController } from './spider/controller.js';
import { CameraRig } from './ui/camera.js';
import { Autopilot } from './ui/autopilot.js';
import { bindHud } from './ui/hud.js';

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

async function main() {
  const canvas = document.getElementById('scene');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.01, 40);

  const hud = bindHud({
    onThreat: () => spider.triggerThreat(),
    onStrike: () => spider.triggerStrike(),
    onToggleTour: () => autopilot.toggle(),
    onCycleCamera: () => cameraRig.cycle(),
    onToggleDebug: () => { debugMarkers.visible = !debugMarkers.visible; },
  });
  hud.setBootProgress(0.05);
  await nextFrame();

  const cave = buildCave(20260927);
  scene.add(cave.group);
  hud.setBootProgress(0.4);
  await nextFrame();

  const lighting = buildLighting(scene);
  const dust = buildDust(320, 2.3);
  scene.add(dust.points);
  hud.setBootProgress(0.55);
  await nextFrame();

  const materials = buildSpiderMaterials();
  hud.setBootProgress(0.65);
  await nextFrame();

  const startPoint = cave.pointOnShell(0.15, 2.4);
  const spider = new SpiderController(scene, materials, cave.colliders, {
    position: startPoint.point,
  });
  hud.setBootProgress(0.9);
  await nextFrame();

  const debugMarkers = new THREE.Group();
  debugMarkers.visible = false;
  const markerGeo = new THREE.SphereGeometry(0.006, 6, 6);
  const markerMat = new THREE.MeshBasicMaterial({ color: 0xff3030 });
  const markers = spider.legs.map(() => {
    const m = new THREE.Mesh(markerGeo, markerMat);
    debugMarkers.add(m);
    return m;
  });
  scene.add(debugMarkers);

  const cameraRig = new CameraRig(camera, renderer.domElement, spider, cave.colliders);
  const autopilot = new Autopilot(cave, spider);

  hud.setBootProgress(1.0);
  await nextFrame();
  hud.hideBoot();

  // ---------------- input ----------------
  const keys = new Set();
  window.addEventListener('keydown', (e) => {
    if (['Space', 'KeyF', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    keys.add(e.code);
    if (e.code === 'Space') spider.triggerThreat();
    if (e.code === 'KeyF') spider.triggerStrike();
    if (e.code === 'KeyC') {
      const label = cameraRig.cycle();
      hud.els.btnCam.textContent = `Camera: ${label}`;
    }
    if (e.code === 'KeyT') {
      const active = autopilot.toggle();
      hud.els.btnPath.textContent = active ? 'Auto Wall-Walk Tour (On)' : 'Auto Wall-Walk Tour';
      hud.els.btnPath.classList.toggle('btn-danger', active);
    }
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));

  function readInput() {
    if (autopilot.active) return; // autopilot drives movement directly
    let f = 0, s = 0, yaw = 0;
    // NOTE on sign convention: yawInput > 0 means "turn right" (matches
    // SpiderController.update, where a positive yaw rotates `forward`
    // toward `right`) — keep this consistent with Autopilot's steering.
    if (keys.has('KeyW') || keys.has('ArrowUp')) f += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) f -= 1;
    if (keys.has('KeyD')) s += 1;
    if (keys.has('KeyA')) s -= 1;
    if (keys.has('ArrowRight')) yaw += 1;
    if (keys.has('ArrowLeft')) yaw -= 1;
    if (keys.has('KeyD') || keys.has('KeyA')) {
      // treat A/D primarily as turning for a more natural crawl-steer feel,
      // with a touch of strafe for responsiveness
      yaw += keys.has('KeyD') ? 0.6 : 0;
      yaw += keys.has('KeyA') ? -0.6 : 0;
      s *= 0.35;
    }
    const running = keys.has('ShiftLeft') || keys.has('ShiftRight');
    spider.setMoveInput(f, s, running);
    spider.setYawInput(yaw);
  }

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // ---------------- main loop ----------------
  const clock = new THREE.Clock();
  let fpsAccum = 0, fpsFrames = 0, fpsTimer = 0;
  const stateNames = { idle: 'Idle', walk: 'Walking', threat: 'Threat Display', strike: 'Strike Attack', retreat: 'Retreat' };

  function frame() {
    requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;

    readInput();
    autopilot.update(dt);
    spider.update(dt);

    let label = stateNames[spider.state] || spider.state;
    if (spider.state === 'idle' && spider.speed > 0.005) label = 'Walking';
    hud.setState(autopilot.active ? `${label} · Auto Tour` : label);

    if (debugMarkers.visible) {
      spider.legs.forEach((leg, i) => markers[i].position.copy(leg.footWorld));
    }

    dust.update(dt, t);
    animateLighting(lighting, t);
    cameraRig.update(dt);

    renderer.render(scene, camera);

    fpsAccum += dt; fpsFrames++; fpsTimer += dt;
    if (fpsTimer > 0.4) {
      const fps = Math.round(fpsFrames / fpsAccum);
      hud.setStats(fps, renderer.info.render.triangles);
      fpsAccum = 0; fpsFrames = 0; fpsTimer = 0;
    }
  }
  requestAnimationFrame(frame);
}

main().catch((err) => {
  console.error(err);
  const boot = document.getElementById('boot');
  if (boot) {
    boot.innerHTML = `<div style="color:#e88;max-width:600px;text-align:left;font-family:monospace;white-space:pre-wrap;">Failed to initialize scene:\n${err.stack || err}</div>`;
  }
});
