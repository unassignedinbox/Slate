// Greybox entry point: scene, input, chase camera, overview map, HUD.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { LEVEL } from '../../levels/fragmented-town/layout.js';
import { buildPaths, buildTown } from '../../levels/fragmented-town/town.js';
import { createRun, stepRun, respawn } from './sim/run.js';
import { T } from './sim/tuning.js';
import { makeMaterials, COLORS } from './render/materials.js';
import { buildTown as buildTownScene, updateTown } from './render/town.js';
import { buildRoads, updateRoads, buildCar } from './render/road.js';

// ---------- renderer, scene, cameras ----------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
scene.background = new THREE.Color(COLORS.sky);
scene.fog = new THREE.Fog(COLORS.fog, 700, 3000);

const chaseCam = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 6000);
const mapCam = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.5, 9000);
mapCam.position.set(700, 1250, 1500);
const orbit = new OrbitControls(mapCam, renderer.domElement);
orbit.target.set(0, 0, 0);
orbit.enableDamping = true;
orbit.enabled = false;

scene.add(new THREE.HemisphereLight(0xe6eaef, 0x5a5f66, 1.5));
const sun = new THREE.DirectionalLight(0xfff6e8, 1.25);
sun.position.set(-300, 500, 200);
scene.add(sun);

// ---------- world ----------
const paths = buildPaths(LEVEL);                // sim copy used for generation
const town = buildTown(LEVEL, paths);           // deterministic town layout
const mats = makeMaterials();
const sceneTown = buildTownScene(town, LEVEL, mats);
scene.add(sceneTown.root);

let run = createRun(LEVEL, town);
const roads = buildRoads(run, sceneTown.shards, mats);
const carModel = buildCar(mats);
scene.add(carModel.group);

// ---------- input ----------
const held = new Set();
let mode = 'drive';      // 'drive' | 'map'
let paused = false;

window.addEventListener('keydown', (e) => {
  if (e.target && e.target.tagName === 'INPUT') return;
  held.add(e.code);
  if (e.repeat) return;
  if (e.code === 'KeyO') setMode(mode === 'map' ? 'drive' : 'map');
  if (e.code === 'KeyP') { paused = !paused; }
  if (e.code === 'KeyR' && e.shiftKey) restart();
  else if (e.code === 'KeyR') respawn(run, 'manual');
  if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
});
window.addEventListener('keyup', (e) => held.delete(e.code));
window.addEventListener('blur', () => held.clear());

function readInput() {
  const f = (...codes) => codes.some((c) => held.has(c));
  return {
    throttle: f('KeyW', 'ArrowUp') ? 1 : 0,
    brake: f('KeyS', 'ArrowDown') ? 1 : 0,
    steer: (f('KeyD', 'ArrowRight') ? 1 : 0) - (f('KeyA', 'ArrowLeft') ? 1 : 0),
    handbrake: f('Space'),
  };
}

function setMode(next) {
  mode = next;
  orbit.enabled = next === 'map';
  for (const r of roads.routes) r.visible = next === 'map';
  hud.mode.textContent = next === 'map' ? 'MAP  (drag to orbit, scroll to zoom, O to return)' : 'DRIVE';
}

// ---------- HUD ----------
const $ = (id) => document.getElementById(id);
const hud = {
  leg: $('leg'),
  legName: $('legname'),
  legTimer: $('legtimer'),
  total: $('total'),
  speed: $('speed'),
  state: $('state'),
  msg: $('msg'),
  splits: $('splits'),
  finish: $('finish'),
  finishBody: $('finishbody'),
  flash: $('flash'),
  mode: $('mode'),
};

const fmt = (sec) => {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`;
};

let msgTimer = 0;
function toast(text, seconds = 2.6) {
  hud.msg.textContent = text;
  hud.msg.classList.add('show');
  msgTimer = seconds;
}

function flashScreen() {
  hud.flash.classList.remove('go');
  void hud.flash.offsetWidth;
  hud.flash.classList.add('go');
}

function renderSplits() {
  hud.splits.innerHTML = '';
  run.legTimes.forEach((t, i) => {
    const li = document.createElement('li');
    const leg = LEVEL.legs[i];
    li.textContent = `${leg.end.kind === 'finish' ? 'Finish' : leg.end.name}  ${fmt(t)}`;
    hud.splits.appendChild(li);
  });
}

function showFinish() {
  const rows = run.legTimes.map((t, i) => {
    const leg = LEVEL.legs[i];
    return `<tr><td>${leg.name}</td><td>${fmt(t)}</td></tr>`;
  }).join('');
  hud.finishBody.innerHTML = `
    <h2>Section 1 complete</h2>
    <p class="big">${fmt(run.totalTime)}</p>
    <table>${rows}</table>
    <p class="hint">Shift+R to run it again</p>`;
  hud.finish.classList.add('show');
}

function restart() {
  run = createRun(LEVEL, town);
  hud.finish.classList.remove('show');
  hud.splits.innerHTML = '';
  toast('Restarted. Good luck.');
}

function handleEvents() {
  for (const ev of run.events) {
    if (ev.type === 'checkpoint') {
      flashScreen();
      toast(`${ev.name} reached  ·  leg ${fmt(ev.legTime)}`);
      renderSplits();
    } else if (ev.type === 'finish') {
      flashScreen();
      renderSplits();
      showFinish();
    } else if (ev.type === 'respawn') {
      const why = ev.why === 'manual' ? 'Back to the road' : ev.why === 'fell' ? 'Lost in the air. Back to the road' : 'Off the road. Back on it';
      toast(why, 2);
    }
  }
  run.events.length = 0;
}

// ---------- camera ----------
const camPos = new THREE.Vector3();
const camLook = new THREE.Vector3();
let camReady = false;

function updateChaseCam(dt) {
  const car = run.car;
  const fx = Math.sin(car.h);
  const fz = Math.cos(car.h);
  const desired = new THREE.Vector3(car.x - fx * 10.5, car.y + 3.8, car.z - fz * 10.5);
  const look = new THREE.Vector3(car.x + fx * 7, car.y + 1.2, car.z + fz * 7);
  if (!camReady || camPos.distanceTo(desired) > 60) {
    camPos.copy(desired);
    camLook.copy(look);
    camReady = true;
  } else {
    const k = 1 - Math.exp(-dt * 7);
    camPos.lerp(desired, k);
    camLook.lerp(look, 1 - Math.exp(-dt * 10));
  }
  chaseCam.position.copy(camPos);
  chaseCam.lookAt(camLook);
}

// ---------- main loop ----------
function updateCarModel(dt) {
  const car = run.car;
  carModel.group.position.set(car.x, car.y, car.z);
  carModel.group.rotation.set(
    THREE.MathUtils.clamp(-car.vy * 0.02, -0.15, 0.15),
    car.h,
    0,
    'YXZ',
  );
  const spin = car.wheel;
  for (const w of carModel.wheels) w.rotation.x = spin;
  void dt;
}

let last = performance.now();
let frameMsg = 0;

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (!paused) stepRun(run, readInput(), dt);
  handleEvents();

  const t = run.t;
  updateTown(sceneTown, t);
  updateRoads(roads, t);
  updateCarModel(dt);

  if (mode === 'drive') updateChaseCam(dt);
  else orbit.update();

  // HUD
  const car = run.car;
  const kmh = Math.abs(car.vf) * 3.6;
  hud.speed.textContent = `${Math.round(kmh)} km/h`;
  hud.state.textContent = car.grounded ? 'on road' : 'airborne';
  hud.state.classList.toggle('air', !car.grounded);
  hud.total.textContent = fmt(run.clock);
  if (!run.finished) {
    const legIdx = run.legIndex;
    const leg = LEVEL.legs[legIdx];
    hud.leg.textContent = `Leg ${legIdx + 1} of ${LEVEL.legs.length}`;
    hud.legName.textContent = `${leg.name}  →  ${leg.end.kind === 'finish' ? 'Finish' : leg.end.name}`;
    hud.legTimer.textContent = fmt(run.clock - run.legStartClock);
  } else {
    hud.leg.textContent = 'Finished';
    hud.legName.textContent = '';
    hud.legTimer.textContent = '';
  }
  if (paused) hud.mode.textContent = 'PAUSED  (P to resume)';
  else if (mode === 'drive') hud.mode.textContent = 'DRIVE';

  if (msgTimer > 0) {
    msgTimer -= dt;
    if (msgTimer <= 0) hud.msg.classList.remove('show');
  }

  const cam = mode === 'map' ? mapCam : chaseCam;
  cam.aspect = window.innerWidth / window.innerHeight;
  cam.updateProjectionMatrix();
  renderer.render(scene, cam);
  frameMsg++;
  requestAnimationFrame(frame);
}

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
});

window.__slate = { run: () => run, T, LEVEL, setMode, restart };   // handy for debugging in the console
hud.mode.textContent = 'DRIVE';
toast('Hold W to go. A/D to steer. Space to brake-slide. R to recover. O for the map.', 6);
requestAnimationFrame(frame);
