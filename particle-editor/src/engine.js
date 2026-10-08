/* Flux engine — Three.js viewport, GPU layer meshes, composer chain
   (render → afterimage trails → bloom → output), transport + capture. */
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {AfterimagePass} from 'three/addons/postprocessing/AfterimagePass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {VERT, FRAG, SHAPES, makeUniforms} from './shaders.js';

export const MAXN = 20000;

function mulberry32(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createEngine(container, store, hooks = {}) {
  const renderer = new THREE.WebGLRenderer({antialias: true});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  container.appendChild(renderer.domElement);
  const canvas = renderer.domElement;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(store.comp.background || '#050507');
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 500);
  const CAM_HOME = {pos: [0, 3.2, 24], tgt: [0, 0.5, 0]};
  camera.position.set(...CAM_HOME.pos);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(...CAM_HOME.tgt);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const trailsPass = new AfterimagePass();
  composer.addPass(trailsPass);
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(1280, 720), 0.9, 0.55, 0);
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());

  const basePlane = new THREE.PlaneGeometry(1, 1);
  const layers = new Map(); // id → {mesh, geo, mat, seeds}
  let time = 0, playing = false, loop = true;
  let afterimageReset = false;
  const wrapHandlers = new Set();

  function fillSeeds(attr, seed) {
    const rnd = mulberry32(seed);
    const arr = attr.array;
    for (let i = 0; i < arr.length; i++) arr[i] = rnd();
    attr.needsUpdate = true;
  }

  function buildLayerMesh(layer) {
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = basePlane.index;
    geo.setAttribute('position', basePlane.getAttribute('position'));
    geo.setAttribute('uv', basePlane.getAttribute('uv'));
    const seeds = new THREE.InstancedBufferAttribute(new Float32Array(MAXN * 4), 4);
    fillSeeds(seeds, layer.seed);
    const idx = new THREE.InstancedBufferAttribute(new Float32Array(MAXN), 1);
    for (let i = 0; i < MAXN; i++) idx.array[i] = i;
    geo.setAttribute('aSeed', seeds);
    geo.setAttribute('aIndex', idx);
    geo.instanceCount = Math.min(layer.emitter.count, MAXN);
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: makeUniforms(),
      transparent: true, depthWrite: false, depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 10;
    return {mesh, geo, mat, seeds};
  }

  function syncLayer(layer) {
    let rec = layers.get(layer.id);
    if (!rec) {
      rec = buildLayerMesh(layer);
      layers.set(layer.id, rec);
      scene.add(rec.mesh);
    }
    const {mesh, geo, mat, seeds} = rec;
    const u = mat.uniforms;
    const E = layer.emitter, F = layer.forces, K = layer.look, B = layer.burst;
    if (rec.seed !== layer.seed) { fillSeeds(seeds, layer.seed); rec.seed = layer.seed; }
    const n = Math.max(1, Math.min(MAXN, Math.round(E.count)));
    geo.instanceCount = n;
    u.uLoop.value = store.comp.duration;
    u.uLife.value = Math.min(E.life, store.comp.duration);
    u.uCount.value = n;
    u.uEmitPos.value.set(...E.pos);
    u.uDir.value.set(...E.dir);
    u.uSpeed.value = E.speed; u.uSpread.value = E.spread;
    u.uShape.value = Math.max(0, SHAPES.indexOf(E.shape));
    u.uRadius.value = E.radius; u.uLength.value = E.length;
    u.uWidth.value = E.width; u.uHeight.value = E.height; u.uDepth.value = E.depth;
    u.uGravity.value = F.gravity;
    u.uWind.value.set(F.wind[0], F.wind[1]);
    u.uTurbAmp.value = F.turbAmp; u.uTurbScale.value = F.turbScale; u.uTurbSpeed.value = F.turbSpeed;
    u.uEvo.value = (layer.seed % 1000) / 1000;
    u.uBurstTime.value = B.time; u.uBurstPower.value = B.on ? B.power : 0;
    u.uSize0.value = K.size0; u.uSize1.value = K.size1; u.uStretch.value = K.stretch;
    u.uColA.value.set(K.colA); u.uColB.value.set(K.colB); u.uColC.value.set(K.colC);
    u.uColBias.value = K.colBias; u.uBright.value = K.bright;
    u.uOpacity.value = K.opacity ?? layer.opacity;
    mat.blending = K.blending === 'normal' ? THREE.NormalBlending : THREE.AdditiveBlending;
    mesh.visible = layer.visible !== false;
    mesh.renderOrder = 10 + store.layers.indexOf(layer);
  }

  function syncAll() {
    const ids = new Set(store.layers.map((l) => l.id));
    for (const [id, rec] of layers) {
      if (!ids.has(id)) {
        scene.remove(rec.mesh);
        rec.geo.dispose(); rec.mat.dispose();
        layers.delete(id);
      }
    }
    for (const l of store.layers) syncLayer(l);
    const c = store.comp;
    scene.background.set(c.background || '#050507');
    renderer.setClearColor(scene.background);
    bloomPass.enabled = !!c.bloom.on;
    bloomPass.strength = c.bloom.strength;
    bloomPass.radius = c.bloom.radius;
    bloomPass.threshold = c.bloom.threshold;
    trailsPass.enabled = !!c.trails.on;
    if (trailsPass.uniforms?.damp) trailsPass.uniforms.damp.value = c.trails.damp;
    if (time > c.duration) time = 0;
  }

  function resize() {
    const r = container.getBoundingClientRect();
    const w = Math.max(50, r.width), h = Math.max(50, r.height);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    composer.setSize(w, h);
  }
  new ResizeObserver(resize).observe(container);

  // Transport + loop.
  let last = performance.now(), fpsEMA = 60, fpsTick = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    let dt = (now - last) / 1000;
    last = now;
    if (!(dt > 0)) dt = 0.016;
    fpsEMA += (1 / Math.min(dt, 0.25) - fpsEMA) * 0.06;
    if (playing) {
      time += Math.min(dt, 0.1);
      const dur = store.comp.duration;
      if (time >= dur) {
        if (loop) {
          time -= dur;
          for (const fn of wrapHandlers) { try { fn(); } catch { /* noop */ } }
        } else { time = dur; setPlaying(false); }
      }
      hooks.onTime?.(time);
    }
    for (const rec of layers.values()) rec.mat.uniforms.uTime.value = time;
    if (afterimageReset && trailsPass.enabled) {
      const d = trailsPass.uniforms.damp.value;
      trailsPass.uniforms.damp.value = 0;
      composer.render();
      trailsPass.uniforms.damp.value = d;
      afterimageReset = false;
    } else {
      composer.render();
    }
    controls.update();
    fpsTick += dt;
    if (fpsTick > 0.5) { fpsTick = 0; hooks.onFps?.(fpsEMA); }
  }

  function setPlaying(v) {
    playing = !!v;
    hooks.onPlaying?.(playing);
  }

  const api = {
    canvas,
    get time() { return time; },
    get playing() { return playing; },
    get loop() { return loop; },
    setLoop(v) { loop = !!v; },
    play: () => setPlaying(true),
    pause: () => setPlaying(false),
    toggle: () => setPlaying(!playing),
    stop() { setPlaying(false); api.seek(0); },
    seek(t) {
      time = Math.max(0, Math.min(store.comp.duration, t));
      afterimageReset = true;
      hooks.onTime?.(time);
    },
    onWrap(fn) { wrapHandlers.add(fn); return () => wrapHandlers.delete(fn); },
    syncAll,
    reseed(id) {
      const rec = layers.get(id);
      if (rec) { rec.seed = undefined; }
    },
    resetCamera() {
      camera.position.set(...CAM_HOME.pos);
      controls.target.set(...CAM_HOME.tgt);
    },
    liveParticles() {
      let n = 0;
      for (const l of store.layers) {
        if (l.visible === false) continue;
        n += Math.min(MAXN, Math.round(l.emitter.count));
      }
      return n;
    },
    captureFrame() {
      composer.render();
      return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    },
  };

  resize();
  syncAll();
  requestAnimationFrame(frame);
  return api;
}
