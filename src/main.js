// Slate Ocean — realtime spectral ocean simulator. Entry point.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { detectCapabilities } from './core/gpu.js';
import { createShared } from './ocean/shared.js';
import { OceanField } from './ocean/cascades.js';
import { FoamField } from './ocean/foam.js';
import { SpraySystem } from './ocean/spray.js';
import { WaterSurface, Seabed, Sky } from './ocean/water.js';
import { SourceManager } from './ocean/sources.js';
import { ProbeManager, CancellerTuner } from './ocean/probes.js';
import { buildUI } from './ui.js';

function fatal(html) {
  const el = document.getElementById('fatal');
  el.innerHTML = html;
  el.classList.remove('hidden');
  document.getElementById('loader').classList.add('hidden');
  window.__slateError = el.textContent;
}

async function main() {
  const canvas = document.getElementById('scene');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.autoClear = true;

  const caps = detectCapabilities(renderer);
  if (!caps.isWebGL2) {
    fatal('<div><b>WebGL2 is required.</b><br/>Please use a current Chrome, Edge, Firefox or Safari.</div>');
    return;
  }
  if (!caps.floatRT && !caps.halfRT) {
    fatal('<div><b>Float render targets are not supported</b> on this GPU.<br/>The FFT ocean needs EXT_color_buffer_float or half-float rendering.</div>');
    return;
  }

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x9ebac4, 0.0004);
  const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.5, 20000);
  camera.position.set(330, 42, 185);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.maxPolarAngle = 1.53;
  controls.minDistance = 4;
  controls.maxDistance = 2500;
  controls.target.set(80, 0, 0);

  const shared = createShared();
  const field = new OceanField(renderer, caps, shared, { N: 256, tiles: [1024, 256, 64] });
  const foam = new FoamField(renderer, shared, { res: 512, tileSize: 520 });
  const spray = new SpraySystem(renderer, scene, shared, { res: 256, spawnR: 260 });
  const water = new WaterSurface(scene, shared, foam);
  const seabed = new Seabed(scene, shared);
  const sky = new Sky(scene, shared);
  const sources = new SourceManager(scene, shared);
  const probes = new ProbeManager(renderer, field, shared, scene, sources, () => ui.state.bathy);
  const tuner = new CancellerTuner(probes, sources);

  const ui = buildUI({ renderer, scene, camera, controls, shared, field, foam, spray, water, sources, probes, tuner });
  ui.onResize();
  window.addEventListener('resize', () => ui.onResize());

  let lastNow = performance.now();
  let time = 0;
  let frames = 0, fpsTime = 0;
  const fpsEl = document.getElementById('fps');
  let firstFrame = true;

  renderer.setAnimationLoop(() => {
    const nowMs = performance.now();
    const rawDt = Math.min((nowMs - lastNow) / 1000, 0.1);
    lastNow = nowMs;
    const dt = ui.playing ? rawDt * ui.timeScale : 0;
    time += dt;
    shared.uTime.value = time;
    shared.uSkyTime.value += dt;

    const tx = controls.target.x, tz = controls.target.z;
    if (dt > 0 || firstFrame) {
      const step = dt > 0 ? Math.min(dt, 0.05) : 0.016;
      field.update(time);
      foam.update(renderer, tx, tz, step);
      spray.update(tx, tz, step, time);
      if (dt > 0) {
        probes.update(time);
        tuner.update(time, step);
      }
      sources.updateBuoys(time);
    }
    water.follow(tx, tz);
    sky.follow(camera);
    scene.fog.color.copy(shared.uFogColor.value);
    scene.fog.density = shared.uFogDensity.value;

    controls.update();
    // Sim passes leave a sim RT bound; the scene must render to the canvas.
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
    ui.updateGraphs();
    window.__slateFrames = (window.__slateFrames || 0) + 1;

    if (firstFrame) {
      firstFrame = false;
      document.getElementById('loader').classList.add('hidden');
      window.__slateReady = true;
    }
    frames++;
    fpsTime += rawDt;
    if (fpsTime >= 0.5) {
      fpsEl.textContent = `${Math.round(frames / fpsTime)} fps`;
      frames = 0; fpsTime = 0;
    }
  });
}

main().catch((err) => {
  console.error(err);
  fatal(`<div><b>Failed to start.</b><br/>${String(err && err.message ? err.message : err)}</div>`);
});
