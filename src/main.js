// ============================================================================
// main.js — MOTOR BALL GP: Iron City Circuit
// Game bootstrap: renderer, arcade car physics (velocity-catch-up drift model),
// chase camera, lap timing with sector gates, nitro, smoke particles, HUD glue.
// ============================================================================
import * as THREE from 'three';
import { Track } from './track.js';
import { World } from './world.js';
import { buildCar, PAINTS } from './car.js';
import { HUD } from './hud.js';
import { AudioSystem } from './audio.js';

// ---------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.domElement.className = 'game';
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(64, window.innerWidth / window.innerHeight, 0.3, 3400);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------- world
const track = new Track(scene);
const world = new World(scene, track);
const car = buildCar(scene);
const hud = new HUD(track);
const audio = new AudioSystem();

// ---------------------------------------------------------------- input
const keys = {};
window.addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  keys[e.code] = true;
  if (e.code === 'KeyC') cyclePaint();
  if (e.code === 'KeyM') {
    const m = audio.toggleMute();
    hud.message(m ? 'SOUND OFF' : 'SOUND ON', 800);
  }
  if (e.code === 'KeyR') resetCar();
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });

// ---------------------------------------------------------------- car state
const S = {
  x: 0, z: 0, y: 0,
  yaw: 0,
  vx: 0, vz: 0,
  steer: 0,
  nitro: 1,
  boosting: false,
  drift: 0,
  rumble: false,
  wallHit: 0,
  shake: 0,
};

const PHYS = {
  vmax: 55,          // ~200 km/h
  vmaxBoost: 68,
  accel: 13.5,
  brake: 27,
  revMax: 9,
  wheelbase: 2.7,
  latG: 24,
  grip: 7.2,
  dragK: 0.0016,
};
const clampD = () => track.halfW - 0.95;

function cyclePaint() {
  car.paintIndex = (car.paintIndex + 1) % PAINTS.length;
  car.paint.color.setHex(PAINTS[car.paintIndex].color);
  hud.message(PAINTS[car.paintIndex].name, 900);
}

function resetCar() {
  const loc = track.locate(S.x, S.z);
  const pose = track.spawnPose(loc.progress);
  S.x = pose.x; S.z = pose.z; S.yaw = pose.yaw;
  S.vx = 0; S.vz = 0; S.nitro = Math.max(S.nitro, 0.4);
  const n = track.surfaceNormal(loc.i);
  placeCarOnSurface(loc, n, 0);
}

// ---------------------------------------------------------------- lap timing
const timing = {
  state: 'idle',     // idle | count | run
  lap: 1,
  lapStart: 0,
  curMs: 0, lastMs: null, bestMs: null,
  gates: [false, false, false],
  prevProgress: 0,
  firstCross: true,
  wrongWayT: 0,
};

function gatesOK() { return timing.gates[0] && timing.gates[1] && timing.gates[2]; }

function handleProgress(p, now) {
  const t = timing;
  if (t.state !== 'run') { t.prevProgress = p; return; }
  // sector gates
  if (p > 0.25 && t.prevProgress <= 0.25) t.gates[0] = true;
  if (p > 0.5 && t.prevProgress <= 0.5) t.gates[1] = true;
  if (p > 0.75 && t.prevProgress <= 0.75) t.gates[2] = true;

  // line crossing (forward)
  if (t.prevProgress > 0.9 && p < 0.1) {
    if (t.firstCross) {
      t.firstCross = false;
      t.lapStart = now;
      t.gates = [false, false, false];
    } else if (gatesOK()) {
      const lapMs = now - t.lapStart;
      t.lastMs = lapMs;
      let deltaTxt = '';
      if (t.bestMs == null || lapMs < t.bestMs) {
        if (t.bestMs != null) deltaTxt = `Δ −${HUD.fmt(t.bestMs - lapMs).slice(2)}`;
        t.bestMs = lapMs;
      } else deltaTxt = `Δ +${HUD.fmt(lapMs - t.bestMs).slice(2)}`;
      const good = t.bestMs === lapMs;
      hud.lapFlash(`LAP ${t.lap}   ${HUD.fmt(lapMs)}   ${deltaTxt}`, good);
      t.lap++;
      t.lapStart = now;
      t.gates = [false, false, false];
      t.firstCross = false;
    } else {
      // cut/reset — restart timing without recording
      t.lapStart = now;
      t.gates = [false, false, false];
    }
  }
  // wrong way detection
  let dp = p - t.prevProgress;
  if (dp > 0.5) dp -= 1;
  if (dp < -0.5) dp += 1;
  const speed = Math.hypot(S.vx, S.vz);
  if (speed > 5 && dp < -0.00001) t.wrongWayT += 1;
  else t.wrongWayT = Math.max(0, t.wrongWayT - 8);
  t.prevProgress = p;
}

// ---------------------------------------------------------------- physics
function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function stepPhysics(dt, input) {
  const speed = Math.hypot(S.vx, S.vz);
  const fx = Math.sin(S.yaw), fz = Math.cos(S.yaw);          // forward
  const rx = -fz, rz = fx;                                    // right = fwd × up
  let fwdSpeed = S.vx * fx + S.vz * fz;

  // --- steering (smoothed), less lock at speed
  const maxSteer = 0.60 / (1 + speed * 0.052);
  const steerTarget = input.steer * maxSteer * 5.2;           // steering wheel units
  const steerRate = 7.5;
  S.steer += THREE.MathUtils.clamp(steerTarget - S.steer, -steerRate * dt, steerRate * dt);
  const delta = S.steer * maxSteer / 5.2 * 5.2;               // actual wheel angle
  const dEff = THREE.MathUtils.clamp(delta, -maxSteer, maxSteer) * (input.handbrake ? 1.25 : 1);

  // --- yaw from bicycle model with lateral-g cap
  if (speed > 0.15) {
    const dirSign = fwdSpeed >= 0 ? 1 : -1;
    let yawRate = (Math.abs(fwdSpeed) / PHYS.wheelbase) * Math.tan(dEff * dirSign) * dirSign;
    const gCap = (PHYS.latG * (input.handbrake ? 1.4 : 1)) / Math.max(speed, 5);
    yawRate = THREE.MathUtils.clamp(yawRate, -gCap, gCap);
    S.yaw = wrapAngle(S.yaw + yawRate * dt);
  }

  const fx2 = Math.sin(S.yaw), fz2 = Math.cos(S.yaw);
  fwdSpeed = S.vx * fx2 + S.vz * fz2;

  // --- longitudinal
  const vmax = S.boosting ? PHYS.vmaxBoost : PHYS.vmax;
  let a = 0;
  if (input.throttle > 0 && timing.state === 'run') {
    a += input.throttle * PHYS.accel * (S.boosting ? 1.55 : 1) *
      Math.max(0.12, 1 - Math.max(0, fwdSpeed) / vmax);
  }
  if (input.brake) {
    if (fwdSpeed > 0.6) a -= PHYS.brake;
    else a -= 7; // reverse
  }
  if (fwdSpeed < -PHYS.revMax && a < 0) a = 0;
  S.vx += fx2 * a * dt;
  S.vz += fz2 * a * dt;

  // --- drag
  const sp2 = Math.hypot(S.vx, S.vz);
  const drag = 1 / (1 + (PHYS.dragK * sp2 + 0.012) * dt * (input.handbrake ? 3 : 1));
  S.vx *= drag; S.vz *= drag;

  // --- grip: rotate velocity toward heading (velocity catch-up drift model)
  const g = PHYS.grip * (input.handbrake ? 0.30 : 1) * (S.rumble ? 0.55 : 1);
  const velAng = Math.atan2(S.vx, S.vz);
  let diff = wrapAngle(S.yaw - velAng);
  if (sp2 > 0.5) {
    const twist = THREE.MathUtils.clamp(diff, -g * dt, g * dt);
    const c = Math.cos(twist), s = Math.sin(twist);
    const nvx = S.vx * c + S.vz * s;
    const nvz = -S.vx * s + S.vz * c;
    S.vx = nvx; S.vz = nvz;
    // tire scrub when sliding
    const scrub = 1 - Math.min(0.5, Math.abs(diff)) * 0.5 * dt * (input.handbrake ? 2 : 1);
    S.vx *= scrub; S.vz *= scrub;
  }
  S.drift = sp2 > 7 ? THREE.MathUtils.clamp(Math.abs(diff), 0, 1.4) : 0;

  // --- integrate
  S.x += S.vx * dt;
  S.z += S.vz * dt;

  // --- surface + walls
  const loc = track.locate(S.x, S.z);
  const absD = Math.abs(loc.d);
  S.rumble = absD > track.halfW - 2.1 && absD <= clampD();
  if (S.rumble && sp2 > 4) {
    S.vx *= 1 - 0.9 * dt; S.vz *= 1 - 0.9 * dt;
    S.shake = Math.min(1, S.shake + 4 * dt);
  }
  if (absD > clampD()) {
    // clamp back inside the arena wall
    const dNew = Math.sign(loc.d) * clampD();
    const P = track.surfacePoint(loc.i, dNew);
    const ox = S.x - P.x, oz = S.z - P.z;
    const od = Math.hypot(ox, oz);
    if (od > 0.0001) { S.x = P.x; S.z = P.z; }
    // kill outward velocity with a small bounce, scrub speed
    const sd = loc.side, sgn = Math.sign(loc.d);
    const vOut = (S.vx * sd.x + S.vz * sd.z) * sgn;
    if (vOut > 0) {
      S.vx -= sd.x * sgn * vOut * 1.3;
      S.vz -= sd.z * sgn * vOut * 1.3;
      S.wallHit = Math.min(1, vOut / 12);
      S.shake = Math.min(1, S.shake + S.wallHit * 0.9);
      const damp = THREE.MathUtils.clamp(1 - vOut * 0.02, 0.72, 1);
      S.vx *= damp; S.vz *= damp;
    }
  }

  S.shake = Math.max(0, S.shake - 3.2 * dt);
  S.wallHit = Math.max(0, S.wallHit - 2 * dt);

  // --- nitro
  S.boosting = !!(input.nitro && S.nitro > 0.02 && input.throttle > 0 && timing.state === 'run');
  if (S.boosting) S.nitro = Math.max(0, S.nitro - dt / 3.2);
  else S.nitro = Math.min(1, S.nitro + dt / 9);

  return loc;
}

// orient + place the car mesh on the (banked) surface
const _n = new THREE.Vector3();
const _qAlign = new THREE.Quaternion();
const _qYaw = new THREE.Quaternion();
const _qShadowBase = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
const UP = new THREE.Vector3(0, 1, 0);
let visPitch = 0, visRoll = 0, camFov = 64, bobT = 0;

function placeCarOnSurface(loc, n, speed) {
  bobT += 0.016;
  const fx = Math.sin(S.yaw), fz = Math.cos(S.yaw);
  // road pitch along forward
  const ahead = track.locate(S.x + fx * 1.6, S.z + fz * 1.6);
  const behind = track.locate(S.x - fx * 1.6, S.z - fz * 1.6);
  const roadPitch = Math.atan2(ahead.y - behind.y, 3.2);

  S.y = loc.y;
  car.group.position.set(S.x, loc.y + 0.02, S.z);
  _qAlign.setFromUnitVectors(UP, n);
  _qYaw.setFromAxisAngle(n, S.yaw);
  car.group.quaternion.copy(_qAlign).multiply(_qYaw);

  // visual body language
  const targetRoll = -S.steer * 0.02 * Math.min(1, speed / 18) - (inputKeys.handbrake ? S.drift * 0.02 : 0);
  visRoll += (targetRoll - visRoll) * 0.12;
  const longA = (inputKeys.throttle ? -0.9 : 0) + (inputKeys.brake ? 1.1 : 0);
  visPitch += ((roadPitch + longA * 0.012) - visPitch) * 0.1;
  car.group.rotateX(visPitch);
  car.group.rotateZ(visRoll);

  // wheels
  const spin = (speed / 0.335) * 0.016;
  for (const w of car.wheels) w.rotation.x += spin * (S.vx * fx + S.vz * fz >= 0 ? 1 : -1);
  for (const w of car.frontAxle) w.rotation.y = S.steer * 0.16;

  // blob shadow hugs the surface (plane's native normal is +z → pre-rotate to +y)
  car.shadow.position.set(S.x, loc.y + 0.045, S.z);
  car.shadow.quaternion.copy(_qAlign).multiply(_qShadowBase);

  // brake light glow
  const braking = inputKeys.brake && speed > 1;
  for (const m of car.brakeMats) m.color.setHex(braking ? 0xff2a22 : 0x6b1010);

  // nitro flames
  const fl = S.boosting ? 0.5 + Math.random() * 0.35 : 0.001;
  for (const f of car.flames) f.scale.setScalar(fl);
}

// ---------------------------------------------------------------- smoke
const SMOKE_MAX = 220;
const smokeGeo = new THREE.BufferGeometry();
const smokePos = new Float32Array(SMOKE_MAX * 3);
const smokeCol = new Float32Array(SMOKE_MAX * 3);
smokeGeo.setAttribute('position', new THREE.BufferAttribute(smokePos, 3));
smokeGeo.setAttribute('color', new THREE.BufferAttribute(smokeCol, 3));
const smokeTexC = document.createElement('canvas');
smokeTexC.width = smokeTexC.height = 64;
{
  const g = smokeTexC.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 4, 32, 32, 30);
  grd.addColorStop(0, 'rgba(255,255,255,0.85)');
  grd.addColorStop(0.6, 'rgba(255,255,255,0.3)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
}
const smoke = new THREE.Points(smokeGeo, new THREE.PointsMaterial({
  size: 26, map: new THREE.CanvasTexture(smokeTexC), transparent: true,
  vertexColors: true, depthWrite: false, opacity: 0.5, blending: THREE.NormalBlending,
}));
smoke.frustumCulled = false;
scene.add(smoke);
const particles = [];
let smokeCursor = 0;
for (let i = 0; i < SMOKE_MAX; i++) particles.push({ life: 0, maxLife: 1, vx: 0, vy: 0, vz: 0 });

function spawnSmoke(x, y, z, vx, vz, strength) {
  const p = particles[smokeCursor];
  smokeCursor = (smokeCursor + 1) % SMOKE_MAX;
  p.life = p.maxLife = 0.5 + Math.random() * 0.4;
  p.x = x + (Math.random() - 0.5) * 0.6; p.y = y; p.z = z + (Math.random() - 0.5) * 0.6;
  p.vx = vx * 0.25 + (Math.random() - 0.5) * 2;
  p.vz = vz * 0.25 + (Math.random() - 0.5) * 2;
  p.vy = 1.4 + Math.random() * 1.6;
  p.s = strength;
}

function updateSmoke(dt) {
  for (let i = 0; i < SMOKE_MAX; i++) {
    const p = particles[i];
    if (p.life > 0) {
      p.life -= dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const a = Math.max(0, p.life / p.maxLife) * 0.5 * p.s;
      smokePos[i * 3] = p.x; smokePos[i * 3 + 1] = p.y; smokePos[i * 3 + 2] = p.z;
      smokeCol[i * 3] = a; smokeCol[i * 3 + 1] = a; smokeCol[i * 3 + 2] = a;
    } else {
      smokePos[i * 3 + 1] = -100;
      smokeCol[i * 3] = smokeCol[i * 3 + 1] = smokeCol[i * 3 + 2] = 0;
    }
  }
  smokeGeo.attributes.position.needsUpdate = true;
  smokeGeo.attributes.color.needsUpdate = true;
}

// ---------------------------------------------------------------- camera
const camPos = new THREE.Vector3(0, 60, -90);
const camTarget = new THREE.Vector3();
function updateCamera(dt, speed) {
  const fx = Math.sin(S.yaw), fz = Math.cos(S.yaw);
  const back = 8.2 + speed * 0.055;
  const up = 2.9 + speed * 0.012;
  let nx = S.x - fx * back, nz = S.z - fz * back;
  let ny = S.y + up;
  // keep the camera inside the arena walls
  const cl = track.locate(nx, nz);
  if (Math.abs(cl.d) > track.halfW - 0.5) {
    const P = track.surfacePoint(cl.i, Math.sign(cl.d) * (track.halfW - 0.6));
    nx = P.x; nz = P.z;
    ny = Math.max(ny, cl.y + 3.4);
  }
  const k = 1 - Math.exp(-6.5 * dt);
  camPos.x += (nx - camPos.x) * k;
  camPos.y += (ny - camPos.y) * k;
  camPos.z += (nz - camPos.z) * k;
  // camera shake
  const sh = S.shake * 0.22;
  camera.position.set(
    camPos.x + (Math.random() - 0.5) * sh,
    camPos.y + (Math.random() - 0.5) * sh,
    camPos.z + (Math.random() - 0.5) * sh
  );
  camTarget.set(S.x + fx * 5.5, S.y + 1.25, S.z + fz * 5.5);
  camera.lookAt(camTarget);

  const targetFov = 62 + Math.min(1, speed / PHYS.vmaxBoost) * 15 + (S.boosting ? 5.5 : 0);
  camFov += (targetFov - camFov) * (1 - Math.exp(-4 * dt));
  camera.fov = camFov;
  camera.updateProjectionMatrix();
}

// ---------------------------------------------------------------- start seq
const startOverlay = document.getElementById('start');
const playBtn = document.getElementById('playbtn');
document.getElementById('loading').textContent = 'CIRCUIT READY';

playBtn.addEventListener('click', () => {
  audio.start();
  startOverlay.classList.add('hidden');
  hud.show();
  startCountdown();
});

function startCountdown() {
  // spawn just behind the gantry so the start line is ahead
  const pose = track.spawnPose(0.9885);
  S.x = pose.x; S.z = pose.z; S.yaw = pose.yaw;
  S.vx = S.vz = 0;
  timing.state = 'count';
  timing.lap = 1; timing.lastMs = null; timing.bestMs = null;
  timing.gates = [false, false, false];
  timing.firstCross = true;
  timing.lapStart = performance.now();

  const seq = ['3', '2', '1', 'GO!'];
  seq.forEach((txt, i) => {
    setTimeout(() => {
      hud.message(txt === 'GO!' ? 'GO!<span class="sub">GREEN GREEN GREEN</span>' : txt, i === 3 ? 900 : 800);
      // gantry lights: reds build up, all green on GO
      track.startLightMats.forEach((m, k) => {
        if (i === 3) m.color.setHex(0x2aff5e);
        else if (k <= i) m.color.setHex(0xff2222);
      });
      if (i === 3) setTimeout(() => track.startLightMats.forEach(m => m.color.setHex(0x062018)), 4000);
    }, i * 900);
  });
  setTimeout(() => { timing.state = 'run'; timing.lapStart = performance.now(); }, 3 * 900 + 40);
}

// keyboard state → physics input
const inputKeys = { throttle: 0, brake: false, steer: 0, handbrake: false, nitro: false };
function readInput() {
  inputKeys.throttle = (keys.KeyW || keys.ArrowUp) ? 1 : 0;
  inputKeys.brake = !!(keys.KeyS || keys.ArrowDown);
  inputKeys.steer = ((keys.KeyA || keys.ArrowLeft) ? 1 : 0) - ((keys.KeyD || keys.ArrowRight) ? 1 : 0);
  inputKeys.handbrake = !!keys.Space;
  inputKeys.nitro = !!(keys.ShiftLeft || keys.ShiftRight);
}

// ---------------------------------------------------------------- loop
let last = performance.now();
let jumboTimer = 0, hudTimer = 0;

function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  readInput();
  const loc = stepPhysics(dt, inputKeys);
  handleProgress(loc.progress, now);
  const n = track.surfaceNormal(loc.i, _n);
  const speed = Math.hypot(S.vx, S.vz);
  placeCarOnSurface(loc, n, speed);
  updateCamera(dt, speed);

  // smoke
  if ((S.drift > 0.4 && speed > 8) || (inputKeys.handbrake && speed > 6)) {
    const fx = Math.sin(S.yaw), fz = Math.cos(S.yaw);
    spawnSmoke(S.x - fx * 1.6 - (-fz) * 0.8, S.y + 0.25, S.z - fz * 1.6 - fx * 0.8, S.vx, S.vz, Math.min(1, S.drift));
    spawnSmoke(S.x - fx * 1.6 + (-fz) * 0.8, S.y + 0.25, S.z - fz * 1.6 + fx * 0.8, S.vx, S.vz, Math.min(1, S.drift));
  }
  updateSmoke(dt);

  world.update(now / 1000);

  if (timing.state === 'run') {
    timing.curMs = now - timing.lapStart;
  } else timing.curMs = 0;

  // HUD @ ~30 Hz
  hudTimer -= dt;
  if (hudTimer <= 0) {
    hudTimer = 0.033;
    const kmh = speed * 3.6;
    const sr = Math.min(1, speed / PHYS.vmax);
    const fwd = S.vx * Math.sin(S.yaw) + S.vz * Math.cos(S.yaw);
    const gearLabel = fwd < -0.5 ? 'R' : speed < 1 ? 'N' : String(Math.min(5, 1 + Math.floor(sr * 5)));
    hud.update({
      lap: timing.lap, curMs: timing.curMs, lastMs: timing.lastMs, bestMs: timing.bestMs,
      kmh, gearLabel, nitro: S.nitro, boosting: S.boosting,
    });
    hud.drawMap(S.x, S.z, S.yaw, loc.progress);
  }

  // wrong way
  if (timing.wrongWayT > 40) {
    hud.message('WRONG WAY<span class="sub">TURN AROUND</span>', 700);
    timing.wrongWayT = -30;
  }

  // jumbotron @ 4 Hz
  jumboTimer -= dt;
  if (jumboTimer <= 0) {
    jumboTimer = 0.25;
    const line2 = timing.state === 'run'
      ? `LAP ${timing.lap}  ·  ${HUD.fmt(timing.curMs)}  ·  ${Math.round(speed * 3.6)} KM/H`
      : 'RACE START…';
    world.drawJumbo('MOTOR BALL GP', line2, timing.state === 'run' ? '#2ee6ff' : '#ffd320');
  }

  audio.update(dt, {
    speed, vmax: PHYS.vmax,
    throttle: inputKeys.throttle, drift: S.drift,
    boosting: S.boosting, offLine: S.rumble,
  });

  renderer.render(scene, camera);
}

// initial camera before start
camPos.set(0, 30, -120);
camera.position.copy(camPos);
camera.lookAt(0, 4, 100);
// park the car on display at spawn
{
  const pose = track.spawnPose(0.9885);
  S.x = pose.x; S.z = pose.z; S.yaw = pose.yaw;
  const loc = track.locate(S.x, S.z);
  placeCarOnSurface(loc, track.surfaceNormal(loc.i, _n), 0);
}
requestAnimationFrame(frame);
