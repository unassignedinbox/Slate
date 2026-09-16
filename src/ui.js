// Application state, scenario presets, control panel, and measurement graphs.
import GUI from 'lil-gui';
import * as THREE from 'three';
import {
  defaultSeaParams, dominantWave, predictedHs, cascadeBands,
  wavenumberSpectrum, fetchRelations,
} from './ocean/spectra.js';
import { defaultBathyParams, BATHY_MODES } from './ocean/bathymetry.js';
import { applySeaParams, applyBathyParams, applySky } from './ocean/shared.js';
import { SRC_POINT, SRC_PLANE } from './ocean/sources.js';

export function createState() {
  return {
    sea: defaultSeaParams(),
    bathy: defaultBathyParams(),
    foam: { tau: 3.2, deposit: 1.0, whitecap: 1.0, strength: 1.0 },
    spray: { enabled: true, gain: 1.0, opacity: 0.85, lifeSpray: 1.1, lifeFoam: 6.0, sizeSpray: 0.55, sizeFoam: 1.1, foamFrac: 0.62 },
    sky: { preset: 'Day', azDeg: 35, elDeg: 42, sunColor: '#fff3e2', zenith: '#1a478c', horizon: '#9ebac4', cloudiness: 0.45, fogDensity: 0.00040 },
    view: { fftSize: 256, sprayRes: 256, foamRes: 512, pixelRatio: 1, wireframe: false, detailAmp: 1.0, lip: 1.6 },
    cancel: { enabled: true, gain: 1.0, beamWaves: 3, decayWaves: 8 },
    measure: { window: 30 },
    placeTool: 'probe',
    status: { cancel: '—', meter: '—', probeA: '—', probeB: '—' },
  };
}

export const SKY_PRESETS = {
  Day: { azDeg: 35, elDeg: 42, sunColor: '#fff3e2', zenith: '#1a478c', horizon: '#9ebac4', cloudiness: 0.45, fogDensity: 0.00040 },
  Golden: { azDeg: 68, elDeg: 12, sunColor: '#ffb066', zenith: '#1c2f5e', horizon: '#e8a06a', cloudiness: 0.35, fogDensity: 0.00050 },
  Storm: { azDeg: 20, elDeg: 30, sunColor: '#9aa7b5', zenith: '#1a222c', horizon: '#5a6570', cloudiness: 0.95, fogDensity: 0.00110 },
  Sunrise: { azDeg: 100, elDeg: 7, sunColor: '#ff9a5a', zenith: '#274b73', horizon: '#f0b489', cloudiness: 0.30, fogDensity: 0.00045 },
};

function skyWithDir(sky) {
  const az = (sky.azDeg * Math.PI) / 180;
  const el = (sky.elDeg * Math.PI) / 180;
  return { ...sky, sunDir: [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)] };
}

export const SCENARIOS = {
  'Beach Break': {
    sea: { windSpeed: 6, windDirDeg: 150, fetch: 120000, gamma: 3.3, swellHs: 1.8, swellTp: 10, swellDirDeg: 0, chop: 1.0 },
    bathy: { mode: 2, shoreX: 60, slope: 0.02, barX: 210, barH: 2.6, barW: 38 },
    sky: 'Day',
    camera: { pos: [330, 42, 185], target: [80, 0, 0] },
  },
  'Pipeline': {
    sea: { windSpeed: 5, windDirDeg: 180, fetch: 80000, gamma: 3.3, swellHs: 2.6, swellTp: 15, swellDirDeg: 0, chop: 1.1 },
    bathy: { mode: 3, shoreX: 260, reefEdge: -160, reefDepth: 1.6, reefDeep: 30 },
    sky: 'Day',
    camera: { pos: [-10, 15, 135], target: [-140, 0, 0] },
  },
  'Mavericks': {
    sea: { windSpeed: 7, windDirDeg: 180, fetch: 200000, swellHs: 5.5, swellTp: 18, swellDirDeg: 0, chop: 1.0 },
    bathy: { mode: 3, shoreX: 320, reefEdge: -260, reefDepth: 7, reefDeep: 42 },
    sky: 'Golden',
    camera: { pos: [-60, 30, 210], target: [-230, 0, 0] },
  },
  'Open Ocean': {
    sea: { windSpeed: 11, windDirDeg: 35, fetch: 300000, swellHs: 2.0, swellTp: 12, swellDirDeg: 35 },
    bathy: { mode: 0 },
    sky: 'Day',
    camera: { pos: [260, 90, 260], target: [0, 0, 0] },
  },
  'Storm': {
    sea: { windSpeed: 24, windDirDeg: 35, fetch: 600000, gamma: 3.3, swellHs: 6.5, swellTp: 14.5, swellDirDeg: 35, chop: 1.25 },
    bathy: { mode: 0 },
    foam: { deposit: 1.2, whitecap: 1.5 },
    sky: 'Storm',
    camera: { pos: [190, 55, 210], target: [0, 0, 0] },
  },
  'Cancellation Lab': {
    sea: { windSpeed: 8, windDirDeg: 0, fetch: 200000, swellHs: 1.2, swellTp: 10, swellDirDeg: 0 },
    bathy: { mode: 0 },
    sky: 'Day',
    camera: { pos: [40, 42, 200], target: [30, 0, 0] },
    actions: 'cancelDemo',
  },
  'Glassy Cove': {
    sea: { windSpeed: 2.5, windDirDeg: 150, fetch: 50000, swellHs: 0.5, swellTp: 9, swellDirDeg: 0, chop: 0.4 },
    bathy: { mode: 1, shoreX: 120, slope: 0.015 },
    sky: 'Sunrise',
    camera: { pos: [280, 26, 160], target: [40, 0, 0] },
  },
};

export function buildUI(ctx) {
  const { renderer, scene, camera, controls, shared, field, foam, spray, water, sources, probes, tuner } = ctx;
  const state = createState();
  const ui = {
    state,
    playing: true,
    timeScale: 1,
    applyPreset,
    drawSpectrum: () => drawSpectrum(),
    updateGraphs: () => updateGraphs(),
  };

  // ---------------- apply helpers ----------------
  let spectrumTimer = 0;
  function queueSpectrumRedraw() {
    clearTimeout(spectrumTimer);
    spectrumTimer = setTimeout(drawSpectrum, 160);
  }
  function applySea() {
    applySeaParams(shared, state.sea);
    spray.updatePass.material.uniforms.uGain.value = state.spray.gain;
    queueSpectrumRedraw();
    // keep an active canceller matched to the sea (debounced retune)
    if (tuner.source) {
      clearTimeout(applySea._rt);
      applySea._rt = setTimeout(() => {
        const dom = dominantWave(state.sea);
        const lambda = (2 * Math.PI) / dom.k;
        tuner.source.lambda = lambda;
        tuner.source.dirX = dom.dirX; tuner.source.dirZ = dom.dirZ;
        tuner.source.beam = state.cancel.beamWaves * lambda;
        tuner.source.decay = state.cancel.decayWaves * lambda;
        tuner.omega = dom.omega; tuner.k = dom.k;
        tuner.sensS = 0.75 * lambda;
        const sx = tuner.source.x + dom.dirX * tuner.sensS;
        const sz = tuner.source.z + dom.dirZ * tuner.sensS;
        probes.ensureSensor(sx, sz);
        tuner.retune();
        sources.pushUniforms();
      }, 800);
    }
  }
  function applyBathy() { applyBathyParams(shared, state.bathy); }
  function applyFoamSpray() {
    foam.pass.material.uniforms.uTau.value = state.foam.tau;
    foam.pass.material.uniforms.uDeposit.value = state.foam.deposit;
    foam.pass.material.uniforms.uWhitecap.value = state.foam.whitecap;
    shared.uFoamStrength.value = state.foam.strength;
    spray.enabled = state.spray.enabled;
    const U = spray.updatePass.material.uniforms;
    U.uGain.value = state.spray.gain;
    U.uLifeSpray.value = state.spray.lifeSpray;
    U.uLifeFoam.value = state.spray.lifeFoam;
    U.uFoamFrac.value = state.spray.foamFrac;
    spray.pointsMat.uniforms.uOpacity.value = state.spray.opacity;
    spray.pointsMat.uniforms.uSizeSpray.value = state.spray.sizeSpray;
    spray.pointsMat.uniforms.uSizeFoam.value = state.spray.sizeFoam;
  }
  function applySkyUI() { applySky(shared, skyWithDir(state.sky)); }
  function applyView() {
    field.setSize(state.view.fftSize);
    spray.setRes(state.view.sprayRes);
    foam.setRes(renderer, state.view.foamRes);
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2) * state.view.pixelRatio);
    onResize();
    water.material.wireframe = state.view.wireframe;
    shared.uDetailAmp.value = state.view.detailAmp;
    shared.uLip.value = state.view.lip;
    queueSpectrumRedraw();
  }
  function applyCancel() {
    tuner.enabled = state.cancel.enabled;
    tuner.gain = state.cancel.gain;
    if (tuner.source) {
      const lambda = tuner.source.lambda;
      tuner.source.beam = state.cancel.beamWaves * lambda;
      tuner.source.decay = state.cancel.decayWaves * lambda;
      sources.pushUniforms();
    }
  }

  function applyPreset(name) {
    const sc = SCENARIOS[name];
    if (!sc) return;
    Object.assign(state.sea, sc.sea || {});
    Object.assign(state.bathy, sc.bathy || {});
    if (sc.foam) Object.assign(state.foam, sc.foam);
    if (sc.sky && SKY_PRESETS[sc.sky]) {
      state.sky.preset = sc.sky;
      Object.assign(state.sky, SKY_PRESETS[sc.sky]);
    }
    applySea(); applyBathy(); applyFoamSpray(); applySkyUI();
    if (sc.camera) {
      camera.position.set(...sc.camera.pos);
      controls.target.set(...sc.camera.target);
      controls.update();
    }
    // scenario actions
    sources.clear();
    probes.clearUserProbes();
    tuner.clear();
    if (sc.actions === 'cancelDemo') {
      const dom = dominantWave(state.sea);
      tuner.place(0, 0, dom, { beamWaves: state.cancel.beamWaves, decayWaves: state.cancel.decayWaves });
      probes.placeProbe(-70, 0);
      probes.placeProbe(130, 0);
      state.placeTool = 'probe';
    }
    gui.controllersRecursive().forEach((c) => c.updateDisplay());
    document.getElementById('preset-select').value = name;
    drawSpectrum();
  }

  // ---------------- panel ----------------
  const gui = new GUI({ container: document.getElementById('panel-host'), title: 'Ocean Controls' });
  gui.domElement.style.setProperty('--width', '300px');

  const fSea = gui.addFolder('Sea State');
  fSea.add(state.sea, 'windSpeed', 0, 30, 0.1).name('wind U10 (m/s)').onChange(applySea);
  fSea.add(state.sea, 'windDirDeg', 0, 360, 1).name('wind dir → (deg)').onChange(applySea);
  fSea.add(state.sea, 'fetch', 5000, 1000000, 5000).name('fetch (m)').onChange(applySea);
  fSea.add(state.sea, 'gamma', 1, 7, 0.1).name('JONSWAP γ').onChange(applySea);
  fSea.add(state.sea, 'specMode', { 'JONSWAP + TMA': 0, 'Pierson–Moskowitz': 1, 'Phillips (classic)': 2 }).name('spectrum').onChange(applySea);
  fSea.add(state.sea, 'energyScale', 0, 3, 0.05).name('energy ×').onChange(applySea);
  fSea.add(state.sea, 'refDepth', 5, 500, 1).name('spectrum depth (m)').onChange(applySea);
  fSea.add(state.sea, 'chop', 0, 1.6, 0.05).name('choppiness').onChange(applySea);
  fSea.add(state.sea, 'chopLength', 0, 5, 0.1).name('chop length (m)').onChange(applySea);

  const fSwell = gui.addFolder('Swell Trains');
  fSwell.add(state.sea, 'swellEnabled').name('enabled').onChange(applySea);
  fSwell.add(state.sea, 'swellHs', 0, 8, 0.1).name('swell Hs (m)').onChange(applySea);
  fSwell.add(state.sea, 'swellTp', 4, 22, 0.1).name('swell Tp (s)').onChange(applySea);
  fSwell.add(state.sea, 'swellDirDeg', 0, 360, 1).name('swell dir → (deg)').onChange(applySea);
  fSwell.add(state.sea, 'swellBeta', 2, 20, 0.5).name('directional focus').onChange(applySea);

  const fShore = gui.addFolder('Surf & Shore');
  const shoreMode = {};
  BATHY_MODES.forEach((m, i) => (shoreMode[m] = i));
  fShore.add(state.bathy, 'mode', shoreMode).name('coast').onChange(applyBathy);
  fShore.add(state.bathy, 'shoreX', -400, 400, 5).name('shoreline x (m)').onChange(applyBathy);
  fShore.add(state.bathy, 'slope', 0.005, 0.08, 0.001).name('beach slope').onChange(applyBathy);
  fShore.add(state.bathy, 'tide', -1, 1, 0.05).name('tide (m)').onChange(applyBathy);
  fShore.add(state.bathy, 'barX', -200, 500, 5).name('sandbar x').onChange(applyBathy);
  fShore.add(state.bathy, 'barH', 0, 6, 0.1).name('sandbar height').onChange(applyBathy);
  fShore.add(state.bathy, 'barW', 5, 120, 1).name('sandbar width').onChange(applyBathy);
  fShore.add(state.bathy, 'reefEdge', -500, 200, 5).name('reef edge x').onChange(applyBathy);
  fShore.add(state.bathy, 'reefDepth', 0.4, 20, 0.1).name('reef flat depth').onChange(applyBathy);
  fShore.add(state.bathy, 'reefDeep', 5, 80, 1).name('depth off reef').onChange(applyBathy);
  fShore.add(state.bathy, 'angleDeg', 0, 90, 1).name('point angle').onChange(applyBathy);

  const fSrc = gui.addFolder('Sources & Cancellation');
  fSrc.add(state, 'placeTool', { Probe: 'probe', Canceller: 'cancel', 'Point wave': 'point', 'Plane wave': 'plane' }).name('click places');
  fSrc.add(state.cancel, 'enabled').name('canceller on').onChange(applyCancel);
  fSrc.add(state.cancel, 'gain', 0, 1.5, 0.05).name('loop gain').onChange(applyCancel);
  fSrc.add(state.cancel, 'beamWaves', 1, 8, 0.5).name('beam width (λ)').onChange(applyCancel);
  fSrc.add(state.cancel, 'decayWaves', 2, 20, 0.5).name('shadow length (λ)').onChange(applyCancel);
  fSrc.add(state.status, 'cancel').name('loop').disable().listen();
  fSrc.add(state.status, 'meter').name('attenuation').disable().listen();
  fSrc.add({ retune: () => tuner.retune() }, 'retune').name('⟳ retune canceller');
  fSrc.add({ remove: () => { tuner.clear(); } }, 'remove').name('✕ remove canceller');
  fSrc.add({ clear: () => { sources.clear(); tuner.clear(); } }, 'clear').name('✕ clear all sources');

  const fFoam = gui.addFolder('Foam & Spray');
  fFoam.add(state.foam, 'tau', 0.5, 10, 0.1).name('foam life (s)').onChange(applyFoamSpray);
  fFoam.add(state.foam, 'deposit', 0, 3, 0.05).name('deposit ×').onChange(applyFoamSpray);
  fFoam.add(state.foam, 'whitecap', 0, 3, 0.05).name('whitecaps ×').onChange(applyFoamSpray);
  fFoam.add(state.foam, 'strength', 0, 2, 0.05).name('foam brightness').onChange(applyFoamSpray);
  fFoam.add(state.spray, 'enabled').name('particles on').onChange(applyFoamSpray);
  fFoam.add(state.spray, 'gain', 0, 3, 0.05).name('emission ×').onChange(applyFoamSpray);
  fFoam.add(state.spray, 'opacity', 0, 1, 0.05).name('opacity').onChange(applyFoamSpray);
  fFoam.add(state.spray, 'lifeSpray', 0.2, 3, 0.05).name('spray life (s)').onChange(applyFoamSpray);
  fFoam.add(state.spray, 'lifeFoam', 1, 14, 0.1).name('fleck life (s)').onChange(applyFoamSpray);
  fFoam.add(state.spray, 'sizeSpray', 0.1, 2, 0.05).name('spray size').onChange(applyFoamSpray);
  fFoam.add(state.spray, 'sizeFoam', 0.2, 4, 0.05).name('fleck size').onChange(applyFoamSpray);
  fFoam.add(state.spray, 'foamFrac', 0, 1, 0.02).name('fleck fraction').onChange(applyFoamSpray);

  const fSky = gui.addFolder('Sky & Light');
  fSky.add(state.sky, 'preset', Object.keys(SKY_PRESETS)).name('preset').onChange(() => {
    Object.assign(state.sky, SKY_PRESETS[state.sky.preset]);
    gui.controllersRecursive().forEach((c) => c.updateDisplay());
    applySkyUI();
  });
  fSky.add(state.sky, 'azDeg', 0, 360, 1).name('sun azimuth').onChange(applySkyUI);
  fSky.add(state.sky, 'elDeg', 2, 80, 0.5).name('sun elevation').onChange(applySkyUI);
  fSky.addColor(state.sky, 'sunColor').name('sun').onChange(applySkyUI);
  fSky.addColor(state.sky, 'zenith').name('zenith').onChange(applySkyUI);
  fSky.addColor(state.sky, 'horizon').name('horizon').onChange(applySkyUI);
  fSky.add(state.sky, 'cloudiness', 0, 1, 0.02).name('clouds').onChange(applySkyUI);
  fSky.add(state.sky, 'fogDensity', 0.00005, 0.002, 0.00001).name('fog').onChange(applySkyUI);

  const fProbe = gui.addFolder('Probes & Measure');
  fProbe.add(state.measure, 'window', 5, 60, 1).name('stats window (s)');
  fProbe.add(state.status, 'probeA').name('probe A').disable().listen();
  fProbe.add(state.status, 'probeB').name('probe B').disable().listen();
  fProbe.add({ clear: () => probes.clearUserProbes() }, 'clear').name('✕ clear probes');

  const fView = gui.addFolder('View & Quality');
  fView.add(state.view, 'fftSize', [128, 256]).name('FFT size').onChange(applyView);
  fView.add(state.view, 'sprayRes', [128, 256, 512]).name('particles √N').onChange(applyView);
  fView.add(state.view, 'foamRes', [256, 512]).name('foam res').onChange(applyView);
  fView.add(state.view, 'pixelRatio', 0.5, 2, 0.25).name('resolution ×').onChange(applyView);
  fView.add(state.view, 'wireframe').name('wireframe').onChange(applyView);
  fView.add(state.view, 'detailAmp', 0, 2, 0.05).name('detail normals').onChange(applyView);
  fView.add(state.view, 'lip', 0, 4, 0.1).name('breaker lip').onChange(applyView);

  // ---------------- top bar / presets ----------------
  const select = document.getElementById('preset-select');
  for (const name of Object.keys(SCENARIOS)) {
    const opt = document.createElement('option');
    opt.value = name; opt.textContent = name;
    select.appendChild(opt);
  }
  select.addEventListener('change', () => applyPreset(select.value));

  const btnPlay = document.getElementById('btn-play');
  btnPlay.addEventListener('click', togglePlay);
  function togglePlay() {
    ui.playing = !ui.playing;
    btnPlay.textContent = ui.playing ? '⏸' : '▶';
  }
  const timeSlider = document.getElementById('time-scale');
  const timeVal = document.getElementById('time-scale-val');
  timeSlider.addEventListener('input', () => {
    ui.timeScale = parseFloat(timeSlider.value);
    timeVal.textContent = ui.timeScale.toFixed(2).replace(/0$/, '') + '×';
  });

  const help = document.getElementById('help');
  document.getElementById('btn-help').addEventListener('click', () => help.classList.toggle('hidden'));
  document.getElementById('btn-help-close').addEventListener('click', () => help.classList.add('hidden'));
  help.addEventListener('click', (e) => { if (e.target === help) help.classList.add('hidden'); });

  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if (e.key === 'h' || e.key === 'H' || e.key === '?') help.classList.toggle('hidden');
    else if (e.key >= '1' && e.key <= '7') applyPreset(Object.keys(SCENARIOS)[+e.key - 1]);
    else if (e.key === 'c' || e.key === 'C') { state.placeTool = 'cancel'; gui.controllersRecursive().forEach((c) => c.updateDisplay()); }
    else if (e.key === 'p' || e.key === 'P') { state.placeTool = 'probe'; gui.controllersRecursive().forEach((c) => c.updateDisplay()); }
  });

  // ---------------- click to place ----------------
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let downPos = null, downTime = 0;
  renderer.domElement.addEventListener('pointerdown', (e) => {
    downPos = [e.clientX, e.clientY]; downTime = performance.now();
  });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!downPos) return;
    const moved = Math.hypot(e.clientX - downPos[0], e.clientY - downPos[1]);
    const dt = performance.now() - downTime;
    downPos = null;
    if (moved > 6 || dt > 500 || e.button !== 0) return;
    ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const o = ray.ray.origin, d = ray.ray.direction;
    if (d.y >= -1e-4) return;
    const t = -o.y / d.y;
    if (t < 0 || t > 5000) return;
    const x = o.x + d.x * t, z = o.z + d.z * t;
    if (state.placeTool === 'probe') probes.placeProbe(x, z);
    else if (state.placeTool === 'cancel') {
      const dom = dominantWave(state.sea);
      tuner.place(x, z, dom, { beamWaves: state.cancel.beamWaves, decayWaves: state.cancel.decayWaves });
    } else if (state.placeTool === 'point') {
      sources.addSource({ type: SRC_POINT, x, z, amp: 0.5, lambda: 32, decay: 220 });
    } else if (state.placeTool === 'plane') {
      const dom = dominantWave(state.sea);
      sources.addSource({ type: SRC_PLANE, x, z, amp: 0.35, lambda: (2 * Math.PI) / dom.k, dirX: dom.dirX, dirZ: dom.dirZ, beam: 90, decay: 700 });
    }
  });

  // ---------------- spectrum visualization ----------------
  const specCanvas = document.getElementById('spectrum-canvas');
  const specCtx = specCanvas.getContext('2d');
  const specInfo = document.getElementById('spectrum-info');
  const SPEC_N = 96;
  const specImg = specCtx.createImageData(SPEC_N, SPEC_N);

  function drawSpectrum() {
    const P = state.sea;
    const N = state.view.fftSize;
    const tiles = field.tiles;
    const bands = cascadeBands(tiles, N);
    bands.forEach((b) => (b.N = N));
    const kmax = 1.4;
    let lo = 1e9, hi = -1e9;
    const vals = new Float32Array(SPEC_N * SPEC_N);
    for (let j = 0; j < SPEC_N; j++) {
      for (let i = 0; i < SPEC_N; i++) {
        // sqrt-companded k-plane so swell peak + tail are both visible
        const fx = (i / (SPEC_N - 1)) * 2 - 1;
        const fy = (j / (SPEC_N - 1)) * 2 - 1;
        const kx = Math.sign(fx) * fx * fx * kmax;
        const ky = Math.sign(fy) * fy * fy * kmax;
        let psi = 0;
        for (const b of bands) psi += wavenumberSpectrum(kx, ky, P, b, P.refDepth).psi;
        const v = Math.log10(psi + 1e-12);
        vals[j * SPEC_N + i] = v;
        if (v > hi) hi = v;
        if (v > -11 && v < lo) lo = v;
      }
    }
    if (!(hi > lo)) { lo = hi - 1; }
    for (let n = 0; n < vals.length; n++) {
      let t = (vals[n] - lo) / (hi - lo);
      t = Math.min(1, Math.max(0, t));
      // deep blue -> cyan -> yellow -> white
      let r, g, b;
      if (t < 0.45) { const u = t / 0.45; r = 8 + 20 * u; g = 20 + 150 * u; b = 70 + 140 * u; }
      else if (t < 0.75) { const u = (t - 0.45) / 0.3; r = 28 + 210 * u; g = 170 + 60 * u; b = 210 - 130 * u; }
      else { const u = (t - 0.75) / 0.25; r = 238 + 17 * u; g = 230 + 25 * u; b = 80 + 175 * u; }
      specImg.data[n * 4] = r; specImg.data[n * 4 + 1] = g; specImg.data[n * 4 + 2] = b; specImg.data[n * 4 + 3] = 255;
    }
    // offscreen then blit scaled
    const off = drawSpectrum._off || (drawSpectrum._off = document.createElement('canvas'));
    off.width = SPEC_N; off.height = SPEC_N;
    off.getContext('2d').putImageData(specImg, 0, 0);
    specCtx.imageSmoothingEnabled = true;
    specCtx.fillStyle = '#020507';
    specCtx.fillRect(0, 0, specCanvas.width, specCanvas.height);
    const S = 148;
    specCtx.drawImage(off, 0, 0, S, S + 2);
    // wind arrow
    const w = (P.windDirDeg * Math.PI) / 180;
    specCtx.strokeStyle = '#ffffff';
    specCtx.lineWidth = 1.5;
    specCtx.beginPath();
    specCtx.moveTo(S / 2 - Math.cos(w) * 18, S / 2 + Math.sin(w) * 18);
    specCtx.lineTo(S / 2 + Math.cos(w) * 18, S / 2 - Math.sin(w) * 18);
    specCtx.stroke();
    specCtx.fillStyle = '#ffffff';
    specCtx.font = '9px sans-serif';
    specCtx.fillText('k-plane (√ scale)', 6, 12);
    // stats column
    let Hs = 0;
    try { Hs = predictedHs(P, tiles, 64); } catch { Hs = 0; }
    const dom = dominantWave(P);
    const fr = fetchRelations(P.windSpeed, P.fetch);
    specCtx.fillStyle = '#7fa3b3';
    specCtx.font = '10px sans-serif';
    const lines = [
      `model Hs ≈ ${Hs.toFixed(2)} m`,
      `dom Tp ≈ ${dom.Tp.toFixed(1)} s`,
      `λp ≈ ${(2 * Math.PI / dom.k).toFixed(0)} m`,
      `wind Tp ≈ ${(1 / Math.max(fr.fp, 1e-3)).toFixed(1)} s`,
      `bands: ${tiles.map((t) => t + 'm').join(' / ')}`,
    ];
    lines.forEach((L, i) => specCtx.fillText(L, S + 8, 22 + i * 17));
    specCtx.fillStyle = '#46d6c4';
    specCtx.fillText(P.specMode === 2 ? 'Phillips' : P.specMode === 1 ? 'PM' : 'JONSWAP+TMA', S + 8, 22 + 5 * 17);
    specInfo.textContent = `Hs≈${Hs.toFixed(2)}m · Tp≈${dom.Tp.toFixed(1)}s`;
  }

  // ---------------- probe graphs ----------------
  const probeCanvas = document.getElementById('probe-canvas');
  const probeCtx = probeCanvas.getContext('2d');
  const probeInfo = document.getElementById('probe-info');
  let graphTick = 0;

  function updateGraphs() {
    if ((graphTick++ & 1) === 0) drawProbes();
    // status lines
    const sA = probes.stats('A', state.measure.window);
    const sB = probes.stats('B', state.measure.window);
    state.status.probeA = sA ? `Hs ${sA.Hs.toFixed(2)}m · Tp ${sA.Tp.toFixed(1)}s` : '—';
    state.status.probeB = sB ? `Hs ${sB.Hs.toFixed(2)}m · Tp ${sB.Tp.toFixed(1)}s` : '—';
    const m = probes.cancelMeter(state.measure.window);
    state.status.meter = m ? `${m.dB.toFixed(1)} dB (${m.pct.toFixed(0)}%)` : '—';
    state.status.cancel = tuner.source ? `${tuner.status} · A=${tuner.source.amp.toFixed(2)}m` : '—';
    if (m) probeInfo.textContent = `B/A −${m.dB.toFixed(1)} dB`;
    else if (sA) probeInfo.textContent = `A: Hs ${sA.Hs.toFixed(2)} m`;
    else probeInfo.textContent = 'click water to place';
  }

  function drawProbes() {
    const W = probeCanvas.width, H = probeCanvas.height;
    probeCtx.fillStyle = '#020507';
    probeCtx.fillRect(0, 0, W, H);
    probeCtx.strokeStyle = 'rgba(120,200,230,0.25)';
    probeCtx.beginPath();
    probeCtx.moveTo(0, H / 2); probeCtx.lineTo(W, H / 2);
    probeCtx.stroke();
    const win = state.measure.window;
    const tNow = shared.uTime.value;
    let peak = 0.5;
    for (const p of probes.probes) {
      if (p.kind === 'sensor') continue;
      for (let i = 0; i < p.n; i++) {
        if (tNow - p.t[i] < win) peak = Math.max(peak, Math.abs(p.h[i]));
      }
    }
    peak *= 1.15;
    for (const [kind, color] of [['A', '#46d6c4'], ['B', '#ffb454']]) {
      const p = probes.probes.find((q) => q.kind === kind);
      if (!p || p.n < 2) continue;
      probeCtx.strokeStyle = color;
      probeCtx.lineWidth = 1.5;
      probeCtx.beginPath();
      let started = false;
      for (let i = 0; i < p.n; i++) {
        const age = tNow - p.t[i];
        if (age > win) continue;
        const x = W - (age / win) * W;
        const y = H / 2 - (p.h[i] / peak) * (H / 2 - 6);
        if (!started) { probeCtx.moveTo(x, y); started = true; }
        else probeCtx.lineTo(x, y);
      }
      probeCtx.stroke();
    }
    probeCtx.fillStyle = '#7fa3b3';
    probeCtx.font = '9px sans-serif';
    probeCtx.fillText(`±${peak.toFixed(1)}m · ${win}s`, 6, 12);
  }

  function onResize() {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    spray.onResize(renderer.domElement.height, camera.fov);
  }
  ui.onResize = onResize;
  ui.applySea = applySea;

  // first paint
  applySea(); applyBathy(); applyFoamSpray(); applySkyUI();
  applyPreset('Beach Break');
  return ui;
}
