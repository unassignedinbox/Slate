/* ============================================================================
   main — boot Slate.
   ========================================================================== */

import * as THREE from 'three';
import { bakeAll, buildEnvironment } from './gen/Textures.js';
import { buildMaterials } from './gen/MaterialLibrary.js';
import { CameraController } from './core/CameraController.js';
import { Editor } from './core/Editor.js';
import { createApp } from './ui/App.js';

const bootEl = document.getElementById('boot');
const bootMsg = document.getElementById('boot-msg');
const setBoot = (t, p) => {
  if (bootMsg) bootMsg.textContent = t;
  const bar = document.querySelector('.boot-bar i');
  if (bar) bar.style.width = `${Math.round((p ?? 0.5) * 40) + 30}%`;
};

/** Fail loudly but politely when WebGL is unavailable (no GPU, blocked canvas). */
function requireWebGL(canvas) {
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  if (!gl) throw new Error('WebGL is not available in this browser or environment.');
  return gl;
}

async function main() {
  /* ---------------------------------------------------------- renderer -- */
  const canvas = document.createElement('canvas');
  canvas.className = 'viewport';
  canvas.tabIndex = 0;
  requireWebGL(canvas);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
    logarithmicDepthBuffer: true,
    stencil: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;
  renderer.shadowMap.enabled = false;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#8fa6bb');
  scene.fog = new THREE.Fog('#a8bccd', 900, 6000);

  const camera = new THREE.PerspectiveCamera(62, 1, 0.25, 30000);
  camera.position.set(0, 90, 220);

  /* --------------------------------------------------------- textures --- */
  setBoot('baking surface textures…', 0.1);
  await bakeAll((p, name) => setBoot(`baking ${name}…`, p));

  setBoot('prefiltering environment…', 0.92);
  const env = buildEnvironment(renderer);
  scene.environment = env;

  setBoot('building materials…', 0.96);
  const materials = buildMaterials(env);

  /* ------------------------------------------------------------ lights --- */
  const sun = new THREE.DirectionalLight(0xfff2dd, 2.5);
  sun.position.set(820, 1250, 520);
  scene.add(sun);
  const hemi = new THREE.HemisphereLight(0xbfd4e8, 0x4b4a42, 0.85);
  scene.add(hemi);
  const fill = new THREE.DirectionalLight(0xcfe0f0, 0.4);
  fill.position.set(-600, 400, -700);
  scene.add(fill);

  /* ------------------------------------------------------------ editor --- */
  setBoot('wiring editor…', 0.99);
  const editor = new Editor({ scene, renderer, camera, materials });

  const cameraCtrl = new CameraController(camera, canvas, {
    getGroundY: (x, z) => editor.terrain.height(x, z),
  });
  cameraCtrl.position.set(0, 120, 320);
  cameraCtrl.pitch = -0.5;
  cameraCtrl.yaw = Math.PI;

  const app = createApp({ scene, renderer, canvas, camera, cameraCtrl, editor, materials });
  window.Slate = { editor, app, scene, renderer, camera, cameraCtrl, materials, THREE };

  editor.rebuildGround();
  app.onResize();
  window.addEventListener('resize', app.onResize);

  /* -------------------------------------------------------- first city --- */
  // ?city=0 boots with an empty network; ?city=seed:extent:pattern to override
  const params = new URLSearchParams(location.search);
  const cityFlag = params.get('city');
  let stats = { edges: 0, nodes: 0, km: 0 };
  if (cityFlag === '0') {
    setBoot('ready', 1);
  } else {
    setBoot('generating road network…', 1);
    await new Promise((r) => setTimeout(r, 16));
    const [seed, extent, pattern] = (cityFlag || '').split(':');
    stats = editor.generate({
      seed: Number(seed) || 20240,
      pattern: pattern || 'grid',
      extent: Number(extent) || 2000,
      blockLength: 180,
      blockWidth: 96,
      hierarchy: true,
      roundabouts: 0.1,
      railLines: 1,
      metroLines: 1,
      terrain: 0,
    });
  }

  cameraCtrl.position.set(-240, 110, 340);
  cameraCtrl.yaw = Math.PI * 0.86;
  cameraCtrl.pitch = -0.46;
  app.frameAll();
  app.toast(`${stats.edges} segments · ${stats.km.toFixed(1)} km generated`, 'ok');

  /* ------------------------------------------------------------- loop --- */
  let last = performance.now();
  let frames = 0;

  function tick(now) {
    requestAnimationFrame(tick);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    cameraCtrl.update(dt);
    editor.update(dt, cameraCtrl.position);
    if (frames % 6 === 0) editor.refreshHelpers();
    app.update(dt);

    const cam = app.isTop() ? app.camera : camera;
    renderer.render(scene, cam);
    frames++;
  }
  requestAnimationFrame(tick);

  // dismiss the splash
  setTimeout(() => bootEl && bootEl.classList.add('hidden'), 220);
  setTimeout(() => bootEl && bootEl.remove(), 900);
}

main().catch((e) => {
  console.error(e);
  if (bootEl) bootEl.classList.remove('hidden');
  if (bootMsg) {
    const safe = String(e && e.message ? e.message : e).replace(/</g, '&lt;');
    bootMsg.innerHTML =
      `<span style="color:#ff5d5d">boot failed</span><br>` +
      `<span style="opacity:.6;font-size:11px;line-height:1.5">${safe}</span>`;
  }
});
