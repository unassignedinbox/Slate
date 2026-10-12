// ---------------------------------------------------------------------------
// SPINE RUNNER — bootstrap, cameras, and the frame loop.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

import { CONFIG, clamp, damp } from './config.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { Track } from './track.js';
import { Hazards } from './hazards.js';
import { buildCity } from './city.js';
import { Race } from './race.js';
import { Hud } from './hud.js';

// ---------------------------------------------------------------------------
// renderer / scene
// ---------------------------------------------------------------------------
const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x0a1018, 0.0016);

const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.4, 4200);
camera.position.set(0, 60, 0);

let composer = null, bloomPass = null;
let bloomOn = true;
function buildComposer() {
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight), 0.62, 0.72, 0.68,
  );
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());
  composer.setSize(window.innerWidth, window.innerHeight);
}
buildComposer();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer?.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------------------
// world
// ---------------------------------------------------------------------------
const input = new Input(window);
const audio = new Audio();
const track = new Track().build();
scene.add(track.group);
const city = buildCity(scene, track);
const hazards = new Hazards(scene, track, audio);
const hud = new Hud(track, hazards);
const race = new Race({ scene, track, hazards, audio, hud });

// starting grid framing
const gridP = track.startPositions[1];
camera.position.set(gridP.x - Math.sin(gridP.yaw) * 26, gridP.y + 9, gridP.z - Math.cos(gridP.yaw) * 26);

// ---------------------------------------------------------------------------
// camera rig
// ---------------------------------------------------------------------------
const CAM_MODES = ['chase', 'far', 'cockpit'];
let camMode = 0;
let camPos = camera.position.clone();
let camLook = new THREE.Vector3();
let camRoll = 0;
let shakeT = 0;
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();

function updateCamera(dt, t) {
  const p = race.player;
  const speedNorm = clamp(p.speed / CONFIG.baseTopSpeed, 0, 1.6);
  if (race.state === 'showcase') { tourCamera(dt); return; }
  const mode = CAM_MODES[camMode];
  const fwd = tmpV.set(Math.sin(p.yaw), 0, Math.cos(p.yaw));
  const right = tmpV2.set(-Math.cos(p.yaw), 0, Math.sin(p.yaw));
  let back = 11.6, up = 4.05, aimAhead = 26, aimUp = 1.4;
  if (mode === 'far') { back = 20; up = 6.8; aimAhead = 30; aimUp = 1.8; }
  if (mode === 'cockpit') { back = -1.1; up = 1.15; aimAhead = 46; aimUp = 1.1; }
  const chasing = mode !== 'cockpit';
  const boostPull = p.boostActive ? 2.4 : 0;
  const desired = new THREE.Vector3(
    p.pos.x - fwd.x * (back + boostPull) + right.x * (chasing ? 0.5 : 0),
    p.pos.y + up,
    p.pos.z - fwd.z * (back + boostPull) + right.z * (chasing ? 0.5 : 0),
  );
  // keep the chase camera off the deck
  const minY = track.deck.frame(p.s, {}).y + 1.4;
  desired.y = Math.max(desired.y, minY);
  const rate = chasing ? 5.4 + speedNorm * 2.6 : 14;
  camPos.set(
    damp(camPos.x, desired.x, rate, dt),
    damp(camPos.y, desired.y, rate * 0.9, dt),
    damp(camPos.z, desired.z, rate, dt),
  );
  const aim = new THREE.Vector3(
    p.pos.x + fwd.x * aimAhead, p.pos.y + aimUp, p.pos.z + fwd.z * aimAhead,
  );
  if (!camLook.lengthSq()) camLook.copy(aim);
  camLook.set(
    damp(camLook.x, aim.x, 9, dt),
    damp(camLook.y, aim.y, 7, dt),
    damp(camLook.z, aim.z, 9, dt),
  );
  const targetRoll = -(p.roll + p.latVel * 0.004) * (chasing ? 0.55 : 0.8);
  camRoll = damp(camRoll, targetRoll, 5, dt);
  camera.position.copy(camPos);
  camera.up.set(Math.sin(camRoll) * 0.9, Math.cos(camRoll), Math.sin(camRoll) * 0.2).normalize();
  camera.lookAt(camLook);
  // shake
  const shake = p.shake + (race.pulseActive > 0 ? 0.12 : 0);
  if (shake > 0.001) {
    shakeT += dt * 40;
    const amp = shake * 0.55;
    camera.position.x += Math.sin(shakeT * 1.7) * amp;
    camera.position.y += Math.sin(shakeT * 2.3) * amp * 0.7;
    camera.position.z += Math.cos(shakeT * 1.9) * amp;
  }
  // fov breathes with speed
  const baseFov = mode === 'cockpit' ? 82 : 74;
  camera.fov = damp(camera.fov, baseFov + speedNorm * 16 + (p.boostActive ? 6 : 0), 4, dt);
  camera.updateProjectionMatrix();
  p.mesh.visible = mode !== 'cockpit' && !p.wrecked;
}

// ---------------------------------------------------------------------------
// showcase tour — a scripted fly-through that narrates the dynamic elements
// ---------------------------------------------------------------------------
const TOUR = (() => {
  const A = track.anchors;
  const z = triggers => triggers;
  return {
    s: A.grid.s0 + 20,
    speed: 34,
    triggers: z([
      { s: A.grid.s0 + 6, title: 'NEO-KOWLOON SPINE', sub: '2.27 km of elevated quarantine circuit. Three laps. Four craft.' },
      { s: A.zipper.s0 - 70, title: '◤ BOLLARD ZIPPER', sub: 'A thousand bollards rise in a travelling wave. The open corridor slides across the deck — read it, then thread it.' },
      { s: A.zipper.s0 + 60, title: '◤ PULSE CALL', sub: 'Your teammate dives into the wave and draws the rising pattern into your lane. A wide gap opens where you actually are.' },
      { s: A.traffic.s0 - 60, title: '◤ TRAFFIC DISTRICT', sub: 'Municipal hover traffic. Two lanes run <span class="k">oncoming</span> — headlights in your racing line.' },
      { s: A.train.s0 - 80, title: '◤ MAGLEV CROSSINGS', sub: 'Freight crosses the deck at 220 km/h on staggered random clocks. Gates flash, horns sound.' },
      { s: A.crane.s0 - 60, title: '◤ Y FORK — CRANE YARD', sub: 'Two yard lanes split around a divider island. Cranes claim a branch and throw you down it.' },
      { s: A.crane.s0 + 40, title: '◤ MAGNET LOCK', sub: 'Caught in the cone, the crane lifts your craft off the deck, carries it, and releases it down the claimed lane. Fight it with airbrakes to keep your line.' },
      { s: A.tsplit.s0 - 40, title: '◤ T SPLIT — HIGH LINE', sub: 'The amber crane claims the flyover. Ride the field up onto the high line, or stay low and boost out of the exit.' },
      { s: A.cornerD.s0 - 90, title: '◤ THE TIGHTEN', sub: 'The tightest corner on the lap. Airbrake, rotate, boost out.' },
      { s: A.final.s0, title: '◤ FINAL DRAG', sub: 'Hyperboost to the line. Watch the hull.' },
    ]),
    fired: new Set(),
  };
})();

let tourCaptionT = 0;
function tourCamera(dt) {
  const A = track.anchors;
  TOUR.s += TOUR.speed * dt;
  if (TOUR.s > track.length) { TOUR.s -= track.length; TOUR.fired.clear(); }
  const f = track.deck.frame(TOUR.s, {});
  const ahead = track.deck.frame(TOUR.s + 42, {});
  const e = -f.hw * 0.42;
  const desired = new THREE.Vector3(
    f.x + f.rx * e, f.y + 9.5, f.z + f.rz * e,
  );
  camPos.set(
    damp(camPos.x, desired.x, 2.6, dt),
    damp(camPos.y, desired.y, 2.4, dt),
    damp(camPos.z, desired.z, 2.6, dt),
  );
  const aimE = ahead.hw * 0.3;
  const aim = new THREE.Vector3(
    ahead.x + ahead.rx * aimE, ahead.y + 1.6, ahead.z + ahead.rz * aimE,
  );
  camLook.set(
    damp(camLook.x, aim.x, 3.4, dt),
    damp(camLook.y, aim.y, 3.2, dt),
    damp(camLook.z, aim.z, 3.4, dt),
  );
  camRoll = damp(camRoll, -f.tilt * 0.3, 2, dt);
  camera.position.copy(camPos);
  camera.up.set(Math.sin(camRoll) * 0.6, Math.cos(camRoll), Math.sin(camRoll) * 0.15).normalize();
  camera.lookAt(camLook);
  camera.fov = damp(camera.fov, 68, 2, dt);
  camera.updateProjectionMatrix();

  for (let i = 0; i < TOUR.triggers.length; i++) {
    const tr = TOUR.triggers[i];
    if (TOUR.fired.has(i)) continue;
    const d = ((TOUR.s - tr.s + track.length) % track.length);
    if (d < 6 && d < 60) {
      TOUR.fired.add(i);
      hud.caption(tr.title, tr.sub);
      tourCaptionT = 5.4;
      audio.tone('ui', 0.16);
      // demo the pulse mechanic when the tour reaches the zipper
      if (i === 2) hazards.zipper.callPulse({ e: 9.5 });
      if (i === 6) hazards.cranes[0].swingSpeed = 0.75;
    }
  }
  if (tourCaptionT > 0) {
    tourCaptionT -= dt;
    if (tourCaptionT <= 0) document.getElementById('caption').classList.remove('on');
  }
  void A;
}

// ---------------------------------------------------------------------------
// session wiring
// ---------------------------------------------------------------------------
let paused = false;
let showcase = false;
let lastT = performance.now();
let acc = 0;
let fps = 60;
let fpsAcc = 0, fpsN = 0;

function startRace() {
  audio.start(); audio.resume();
  showcase = false;
  paused = false;
  race.reset(false);
  race.player.onFinished = () => {
    const rows = race.results();
    const win = rows[0]?.you;
    hud.fillResults(rows, win ? 'RACE WON' : `FINISHED P${race.player.place}`,
      `best lap ${fmt(race.player.bestLap)} · total ${fmt(race.time)}`);
    hud.show('results');
  };
  hud.show('race');
  hud.banner('GRID', 'three laps · watch the scan panel', 'cyan', 2.0);
  camMode = 0;
  const gp = track.startPositions[0];
  camPos.set(gp.x - Math.sin(gp.yaw) * 13 - 4, gp.y + 4.4, gp.z - Math.cos(gp.yaw) * 13);
}

function startShowcase() {
  audio.start(); audio.resume();
  showcase = true;
  paused = false;
  race.reset(true);
  TOUR.s = track.anchors.grid.s0 + 20;
  TOUR.fired.clear();
  hud.show('showcase');
  hud.banner('SHOWCASE RUN', 'spectating · the pack races without you', 'mag', 2.6);
}

function fmt(t) {
  if (!t) return '--:--.--';
  const m = Math.floor(t / 60), s = Math.floor(t % 60), c = Math.floor((t * 100) % 100);
  return `${m}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}

function togglePause(force) {
  paused = force ?? !paused;
  if (paused) {
    hud.el.pauseInfo.textContent = `lap ${Math.min(race.player.lap + 1, CONFIG.laps)}/${CONFIG.laps} · `
      + `best ${fmt(race.player.bestLap)} · hull ${Math.round(race.player.hull)}%`;
    hud.show('pause');
  } else hud.show(showcase ? 'showcase' : 'race');
}

document.getElementById('btnRace').addEventListener('click', startRace);
document.getElementById('btnShowcase').addEventListener('click', startShowcase);
document.getElementById('btnDemo').addEventListener('click', () => { startShowcase(); TOUR.speed = 30; });
document.getElementById('btnResume').addEventListener('click', () => togglePause(false));
document.getElementById('btnRestart').addEventListener('click', () => { togglePause(false); startRace(); });
document.getElementById('btnQuit').addEventListener('click', () => { paused = false; hud.show('briefing');
{
  const el = document.getElementById('tracklen');
  if (el) el.textContent = (track.length / 1000).toFixed(2);
} });
document.getElementById('btnAgain').addEventListener('click', startRace);
document.getElementById('btnBriefing2').addEventListener('click', () => hud.show('briefing'));

hud.show('briefing');
{
  const el = document.getElementById('tracklen');
  if (el) el.textContent = (track.length / 1000).toFixed(2);
}

// ---------------------------------------------------------------------------
// frame loop
// ---------------------------------------------------------------------------
function frame() {
  requestAnimationFrame(frame);
  const now = performance.now();
  let dt = (now - lastT) / 1000;
  lastT = now;
  if (dt > 0.25) dt = 0.25;
  const t = now / 1000;
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 0.5) { fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }

  // ---- global keys ----
  if (input.keyTap('KeyP') || input.tapped('restart')) togglePause();
  if (input.keyTap('KeyR')) { togglePause(false); startRace(); }
  if (input.keyTap('KeyC')) { camMode = (camMode + 1) % CAM_MODES.length; hud.banner(CAM_MODES[camMode].toUpperCase(), '', 'cyan', 0.9); }
  if (input.keyTap('KeyM')) { audio.toggleMute(); hud.banner(audio.muted ? 'AUDIO MUTED' : 'AUDIO ON', '', 'cyan', 0.9); }
  if (input.keyTap('KeyH')) hud.show(document.getElementById('briefing').classList.contains('hidden') ? 'briefing' : (showcase ? 'showcase' : 'race'));
  if (input.keyTap('KeyB')) {
    bloomOn = !bloomOn;
    hud.banner(bloomOn ? 'BLOOM ON' : 'BLOOM OFF', '', 'cyan', 0.9);
  }
  if (input.keyTap('Enter') && !document.getElementById('briefing').classList.contains('hidden')) startRace();
  if (input.keyTap('KeyZ') && !paused && race.state === 'racing') race.callPulse();
  if (input.keyTap('Space') && showcase) TOUR.speed = TOUR.speed > 100 ? 34 : 130;

  // ---- sim ----
  const step = CONFIG.fixedStep;
  if (!paused) {
    acc += Math.min(dt, 0.1);
    let iter = 0;
    while (acc >= step && iter < CONFIG.maxSubSteps) {
      race.update(step, t, input);
      input.endFrame();
      acc -= step;
      iter++;
    }
    if (iter === 0) input.endFrame();
    if (race.state === 'racing' || race.state === 'showcase') {
      city.update(t, dt);
    }
    audio.update(race.player.speed, CONFIG.boostTopSpeed, race.player.boostActive, dt,
      race.state === 'racing' && !paused);
  }

  updateCamera(dt, t);
  hud.update(race, fps, dt);
  if (bloomOn && composer) {
    if (bloomPass) {
      const boost = race.player.boostActive ? 0.24 : 0;
      const pulse = race.pulseActive > 0 ? 0.18 : 0;
      bloomPass.strength = damp(bloomPass.strength, 0.6 + boost + pulse, 3, dt);
    }
    composer.render();
  } else {
    renderer.render(scene, camera);
  }
  input.endFrame();
}
frame();

// expose for debugging
window.__spine = { track, hazards, race, hud, scene, camera, renderer, TOUR };
