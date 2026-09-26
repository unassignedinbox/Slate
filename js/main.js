// main.js — bootstrap, input, HUD, game loop
import * as THREE from './vendor/three.module.min.js';
import { S, CFG } from './state.js';
import * as world from './world.js';
import { buildProps } from './props.js';
import { Car } from './car.js';
import { Player } from './player.js';
import { Effects } from './effects.js';
import { AudioSys } from './audio.js';
import { updateCombat } from './combat.js';
import { clamp, clamp01, lerp } from './utils.js';

let renderer, camera, clock, sun;
const input = { fwd: 0, side: 0, sprint: false, jump: false };

const $ = (id) => document.getElementById(id);
let ui = {};

function init() {
  const canvas = $('c');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xc3d2da, 150, 560);
  camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 1400);
  S.scene = scene;
  S.camera = camera;
  S.renderer = renderer;

  // ---- lights ----
  scene.add(new THREE.HemisphereLight(0xbcd7e8, 0x8a7f66, 0.85));
  sun = new THREE.DirectionalLight(0xfff2dd, 2.4);
  sun.position.set(-170, 230, -240);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -100;
  sun.shadow.camera.right = 100;
  sun.shadow.camera.top = 100;
  sun.shadow.camera.bottom = -100;
  sun.shadow.camera.near = 40;
  sun.shadow.camera.far = 760;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 1.5;
  scene.add(sun, sun.target);
  S.sun = sun;

  // ---- world & props ----
  const sunDir = sun.position.clone().normalize();
  world.buildWorld(sunDir);
  S.effects = new Effects(scene);
  buildProps();
  S.car = new Car();
  scene.add(S.car.mesh);
  S.player = new Player();
  S.audio = new AudioSys();

  // ---- UI refs ----
  ui = {
    intro: $('intro'), pause: $('pause'), death: $('death'), win: $('win'),
    startBtn: $('startBtn'), resumeBtn: $('resumeBtn'), redeployBtn: $('redeployBtn'), restartBtn: $('restartBtn'),
    deathCause: $('deathCause'),
    objDist: $('objDist'), tideFill: $('tideFill'), tideState: $('tideState'),
    hpFill: $('hpFill'), vehCard: $('vehCard'), vehFill: $('vehFill'),
    hint: $('hint'), banner: $('banner'), vignette: $('vignette'), waterFx: $('waterFx'), dot: $('dot'),
    statTime: $('statTime'), statDeaths: $('statDeaths'), statMines: $('statMines'), statVehicle: $('statVehicle'),
  };

  // ---- events ----
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', (e) => { S.keys[e.code] = false; });
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('pointerlockchange', onPointerLock);
  document.addEventListener('pointerlockerror', () => enableFallback());
  canvas.addEventListener('mousedown', () => { S.mouseDown = true; });
  window.addEventListener('mouseup', () => { S.mouseDown = false; });
  canvas.addEventListener('click', () => {
    if (S.mode === 'play' && !document.pointerLockElement && !S.plFallback) tryLock(canvas);
  });
  ui.startBtn.addEventListener('click', () => startGame(canvas));
  ui.resumeBtn.addEventListener('click', () => {
    if (S.plFallback) resumePlay();
    else tryLock(canvas);
  });
  ui.redeployBtn.addEventListener('click', () => {
    S.player.respawn();
    S.mode = 'play';
    ui.death.classList.add('hidden');
    if (S.plFallback) resumePlay();
    else tryLock(canvas);
  });
  ui.restartBtn.addEventListener('click', () => window.location.reload());

  clock = new THREE.Clock();
  renderer.setAnimationLoop(loop);
}

function startGame(canvas) {
  S.audio.init();
  S.t = 0;
  S.stats = { deaths: 0, minesTripped: 0, carLost: false };
  S.mode = 'play';
  ui.intro.classList.add('hidden');
  tryLock(canvas);
}

// Pointer lock can be unavailable (e.g. inside a sandboxed iframe preview).
// Fall back to hold-left-mouse-to-look so the game stays playable.
function tryLock(canvas) {
  if (S.plFallback) return;
  try {
    const p = canvas.requestPointerLock();
    if (p && p.catch) p.catch(() => enableFallback());
    setTimeout(() => {
      if (!document.pointerLockElement && S.mode === 'play' && !S.plFallback) enableFallback();
    }, 1200);
  } catch (err) {
    enableFallback();
  }
}

function enableFallback() {
  if (S.plFallback) return;
  S.plFallback = true;
  ui.hint.textContent = 'POINTER LOCK UNAVAILABLE — HOLD LEFT MOUSE TO LOOK';
  setTimeout(() => { if (ui.hint) ui.hint.textContent = ''; }, 4000);
}

function resumePlay() {
  S.mode = 'play';
  ui.pause.classList.add('hidden');
}

function onKeyDown(e) {
  S.keys[e.code] = true;
  if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
  if (e.code === 'Escape' && S.plFallback) {
    if (S.mode === 'play') { S.mode = 'pause'; ui.pause.classList.remove('hidden'); }
    else if (S.mode === 'pause') resumePlay();
    return;
  }
  if (S.mode !== 'play') return;
  if (e.code === 'KeyE') S.player.tryEnterExit();
  if (e.code === 'KeyC') S.camMode = S.camMode === 'orbit' ? 'fp' : 'orbit';
  if (e.code === 'KeyM') { S.muted = !S.muted; S.audio.setMuted(S.muted); }
}

function onMouseMove(e) {
  if (S.mode !== 'play') return;
  if (S.camMode === 'orbit' || S.player.inCar) return;
  const locked = !!document.pointerLockElement;
  if (!locked && !(S.plFallback && S.mouseDown)) return;
  S.player.yaw -= e.movementX * 0.0023;
  S.player.pitch = clamp(S.player.pitch + e.movementY * 0.0023, -1.45, 1.45);
}

function onPointerLock() {
  const locked = !!document.pointerLockElement;
  if (!locked && S.mode === 'play') {
    S.mode = 'pause';
    ui.pause.classList.remove('hidden');
  } else if (locked && S.mode === 'pause') {
    resumePlay();
  }
}

function gatherInput() {
  const k = S.keys;
  input.fwd = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0);
  input.side = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
  input.sprint = !!(k.ShiftLeft || k.ShiftRight);
  input.jump = !!k.Space;
}

function applyCamera(dt) {
  const p = S.player;
  if (S.mode === 'intro' || S.camMode === 'orbit') return; // handled elsewhere
  p.applyCamera(camera, dt);
  const sh = S.effects.shakeOffsets();
  camera.rotation.x += sh.rx;
  camera.rotation.y += sh.ry;
  camera.position.y += sh.ty * 0.04;
  const targetFov = (p.inCar && S.car && Math.abs(S.car.speed) > 5) ? 79 : 72;
  if (Math.abs(camera.fov - targetFov) > 0.1) {
    camera.fov = lerp(camera.fov, targetFov, clamp01(dt * 3));
    camera.updateProjectionMatrix();
  }
}

function introCamera() {
  const a = S.realT * 0.06;
  camera.position.set(Math.sin(a) * 130, 52 + Math.sin(a * 0.7) * 10, -60 + Math.cos(a) * 110);
  camera.lookAt(0, 8, 40);
}

function orbitCamera() {
  const p = S.player;
  const a = S.realT * 0.22;
  const cx = p.pos.x + Math.sin(a) * 26;
  const cz = p.pos.z + Math.cos(a) * 26;
  camera.position.set(cx, Math.max(world.H(cx, cz) + 10, p.pos.y + 9), cz);
  camera.lookAt(p.pos.x, p.pos.y + 1.5, p.pos.z);
}

function updateSun() {
  const p = S.player;
  if (!p) return;
  sun.target.position.set(p.pos.x, 0, p.pos.z);
  sun.position.set(p.pos.x - 170, 230, p.pos.z - 240);
}

function checkWin() {
  const p = S.player;
  if (p.alive && p.pos.z > CFG.winZ) {
    S.mode = 'win';
    S.audio.win();
    S.audio.setEngine(false, 0);
    document.exitPointerLock();
    const t = Math.floor(S.t);
    ui.statTime.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    ui.statDeaths.textContent = S.stats.deaths;
    ui.statMines.textContent = S.stats.minesTripped;
    ui.statVehicle.textContent = S.stats.carLost ? 'LOST' : (S.player.inCar ? 'RODE IT HOME' : 'INTACT');
    ui.win.classList.remove('hidden');
  }
}

let hudT = 0;
function updateHUD(dt) {
  const p = S.player, car = S.car;
  if (p) {
    ui.hpFill.style.width = `${clamp(p.health, 0, 100)}%`;
    ui.hpFill.classList.toggle('low', p.health < 35);
    ui.vignette.style.opacity = p.health < 35 ? ((1 - p.health / 35) * 0.45).toFixed(3) : 0;
    ui.waterFx.style.opacity = camera.position.y < S.waterLevel ? 0.5 : 0;
  }
  hudT -= dt;
  if (hudT > 0) return;
  hudT = 0.12;
  if (p) {
    const d = Math.max(0, Math.round(CFG.winZ - p.pos.z));
    ui.objDist.textContent = d > 0 ? `${d} m` : 'AT THE WALL';
    const f = (S.waterLevel - CFG.tideStart) / (CFG.tideMax - CFG.tideStart);
    ui.tideFill.style.width = `${(f * 100).toFixed(1)}%`;
    ui.tideState.textContent = f >= 1 ? 'MAX' : 'RISING';
    if (car && car.alive) {
      ui.vehCard.style.display = 'block';
      ui.vehFill.style.width = `${clamp(car.health, 0, 100)}%`;
      ui.vehFill.classList.toggle('low', car.health < 30);
    } else {
      ui.vehCard.style.display = 'none';
    }
    let hint = '';
    if (p.inCar) hint = 'E — GET OUT · SPACE — BRAKE';
    else if (car && car.alive && Math.hypot(p.pos.x - car.pos.x, p.pos.z - car.pos.z) < 3.6) hint = 'E — ENTER VEHICLE';
    else if (S.wireSlow) hint = 'BARBED WIRE — FIND A GAP';
    else if (p.pos.z < -80) hint = 'MOVE INLAND — THE TIDE IS COMING';
    ui.hint.textContent = hint;
    ui.dot.style.display = p.inCar ? 'none' : 'block';
  }
  for (let i = S.banners.length - 1; i >= 0; i--) {
    S.banners[i].ttl -= 0.12;
    if (S.banners[i].ttl <= 0) S.banners.splice(i, 1);
  }
  if (S.banners.length) {
    const b = S.banners[0];
    ui.banner.textContent = b.text;
    ui.banner.style.color = b.color || '#ffb84d';
    ui.banner.style.opacity = Math.min(1, b.ttl);
  } else {
    ui.banner.style.opacity = 0;
  }
}

function showDeath() {
  ui.deathCause.textContent = S.player.deathCause || 'killed in action';
  ui.death.classList.remove('hidden');
  if (document.pointerLockElement) document.exitPointerLock();
}

function loop() {
  const dt = Math.min(clock.getDelta(), 0.05);
  S.realT += dt;

  world.updateClouds(dt);
  world.updateWaterVisual(S.realT);

  if (S.mode === 'play') {
    S.t += dt;
    gatherInput();
    const p = S.player, car = S.car;
    p.update(dt, input);
    if (p.inCar) {
      car.update(dt, { throttle: input.fwd, steer: input.side, brake: input.jump });
    } else {
      car.update(dt, { throttle: 0, steer: 0, brake: false });
    }
    updateCombat(dt);
    S.effects.update(dt);
    S.audio.setEngine(p.inCar && car.alive && !car.disabled, Math.abs(car.speed) / 23);
    S.audio.update(dt, S.realT);
    updateSun();
    if (S.camMode === 'orbit') orbitCamera();
    else applyCamera(dt);
    checkWin();
    if (S.mode === 'dead') showDeath();
  } else if (S.mode === 'dead') {
    S.effects.update(dt);
    S.audio.update(dt, S.realT);
    camera.position.y = Math.max(camera.position.y - dt * 1.2, world.H(camera.position.x, camera.position.z) + 0.4);
    camera.rotation.z = lerp(camera.rotation.z, 0.12, clamp01(dt * 2));
  } else if (S.mode === 'intro') {
    introCamera();
    S.effects.update(dt);
    for (const s of S.sentries) {
      s.yawNode.rotation.y = Math.sin(S.realT * 0.32 + s.phase) * 0.55;
      s.pitchNode.rotation.x = -0.05 + Math.sin(S.realT * 0.5 + s.phase) * 0.06;
    }
  } else {
    S.effects.update(dt);
    S.audio.update(dt, S.realT);
    if (S.mode === 'win') {
      const a = S.realT * 0.1;
      camera.position.set(Math.sin(a) * 40, 18 + Math.sin(a * 0.6) * 5, CFG.wallFaceZ - 30 + Math.cos(a) * 14);
      camera.lookAt(0, 10, CFG.wallFaceZ);
    }
  }

  updateHUD(dt);
  renderer.render(S.scene, camera);
}

init();
