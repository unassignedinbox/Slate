// LEVEL 01 greybox - browser entry.
import * as THREE from 'three';
import { buildLevel01, LEVEL01 } from './level/level01.js';
import { Car } from './core/vehicle.js';
import { Autopilot } from './core/autopilot.js';
import { Race } from './game/race.js';
import { createGreyboxMaterial } from './render/greyboxMaterial.js';
import { LevelView, buildOverlay, Labels } from './render/levelView.js';
import { createSky, createCloudFloor, createLights, createDebrisField, sunDirection, SKY } from './render/environment.js';
import { loadCarModel } from './render/carModel.js';
import { PortalView } from './render/portalView.js';
import { Input } from './game/input.js';
import { CameraRig } from './game/cameraRig.js';
import { Hud, fmt } from './game/hud.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// reference times measured by tools/headless-run.mjs (autopilot, 120 Hz)
const REF = { S1: 47.7 };

const params = new URLSearchParams(location.search);
const quality = params.get('q') || 'high';
const app = document.getElementById('app');
const loading = document.getElementById('loading');
const status = (t) => { if (loading) loading.querySelector('.st').textContent = t; };

async function boot() {
  status('Building the fractured town...');
  await new Promise((r) => setTimeout(r, 30));
  const level = buildLevel01({ seed: Number(params.get('seed')) || undefined });
  const world = level.world;

  const renderer = new THREE.WebGLRenderer({ antialias: quality !== 'low', powerPreference: 'high-performance', preserveDrawingBuffer: params.has('shot') });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality === 'high' ? 1.75 : 1));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = quality !== 'low';
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
  app.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(SKY.fog, 240, 2600);
  const camera = new THREE.PerspectiveCamera(64, window.innerWidth / window.innerHeight, 0.3, 9000);

  const sunDir = sunDirection(LEVEL01.sun.azimuth, LEVEL01.sun.elevation);
  const sky = createSky(sunDir);
  scene.add(sky);
  const clouds = createCloudFloor();
  scene.add(clouds);
  const lights = createLights(scene, sunDir, quality);
  const debris = createDebrisField(level, quality === 'low' ? 700 : 1300);
  scene.add(debris);

  const pmrem0 = new THREE.PMREMGenerator(renderer);
  const worldEnv = pmrem0.fromScene(new RoomEnvironment(), 0.04).texture;
  const material = createGreyboxMaterial({ envMap: worldEnv, envMapIntensity: 0.28 });
  const view = new LevelView(level, material);
  scene.add(view.mesh);
  const overlay = buildOverlay(level);
  scene.add(overlay);

  status('Loading the ControlVehicle...');
  const carModel = await loadCarModel('assets/control-vehicle.json', worldEnv);
  scene.add(carModel.group);

  const car = new Car(world);
  const race = new Race(level, car, { countdown: params.has('nocountdown') ? 0 : 3 });
  const ap = new Autopilot();
  const portals = level.portals.map((p) => new PortalView(renderer, scene, p, world, quality));
  const input = new Input();
  const rig = new CameraRig(camera, renderer.domElement, world);
  rig.snap(car.pos, car.quat);
  const hud = new Hud(app, level, { ref: REF });
  const ticks = [];
  for (const sec of level.sections) for (let s = 100; s < sec.route.length; s += 100) ticks.push({ text: `${s} m`, pos: sec.route.pos(s).add(new THREE.Vector3(0, 3.6, 0)) });
  const labels = new Labels(app, level.labels, ticks);

  const best = JSON.parse(localStorage.getItem('slate-l01-best') || '{}');
  let autopilot = params.has('auto');
  let paused = false;
  let timeScale = 1;
  let overlayOn = !params.has('clean');
  overlay.visible = overlayOn; labels.setVisible(overlayOn);

  // ---------------------------------------------------------------- designer panel
  const $ = (id) => document.getElementById(id);
  const designer = $('designer');
  if (params.has('designer')) designer.classList.remove('hidden');
  const S1 = level.sections[0];
  $('dSec').innerHTML = `<b>SECTION 1 - FRACTURED TOWN</b><br>${S1.route.length.toFixed(0)} m point-to-point, ${S1.route.beats.length} beats, ref ${fmt(REF.S1)} (autopilot)<br>${level.stats.bodies} moving bodies, ${level.stats.colliders} colliders, ${level.stats.props} loose props, ${(level.stats.tris / 1000).toFixed(0)}k tris`;
  const bl = $('dBeats');
  for (const [si, sec] of level.sections.entries()) {
    for (const b of sec.route.beats) {
      const btn = document.createElement('button');
      btn.innerHTML = `<b>${b.id}</b> ${b.name}<i>${(b.s1 - b.s0).toFixed(0)} m</i>`;
      btn.onclick = () => { teleportTo(si, b.s0 + 2); btn.blur(); };
      bl.appendChild(btn);
    }
  }
  $('dMotion').onchange = (e) => { world.motionScale = e.target.checked ? 1 : 0; };
  $('dFracture').onchange = (e) => { race.fracture = e.target.checked; };
  $('dOverlay').onchange = (e) => { overlayOn = e.target.checked; overlay.visible = overlayOn; labels.setVisible(overlayOn); };
  $('dDebris').onchange = (e) => { debris.visible = e.target.checked; };
  $('dTime').oninput = (e) => { timeScale = Number(e.target.value); $('dTimeV').textContent = `${timeScale.toFixed(2)}x`; };
  $('dAuto').onclick = () => toggleAuto();
  $('dChase').onclick = () => rig.setMode('chase');
  $('dFree').onclick = () => rig.setMode('free');
  $('dOver').onclick = () => overview();
  $('dRestart').onclick = () => restart();

  function toggleAuto() { autopilot = !autopilot; hud.message(autopilot ? 'AUTOPILOT - demo run' : 'AUTOPILOT OFF', 1.5); $('dAuto').classList.toggle('on', autopilot); }
  function overview() {
    const R = race.route;
    const bb = new THREE.Box3();
    for (const s of R.samples) bb.expandByPoint(s.p);
    rig.setMode('overview', bb.getCenter(new THREE.Vector3()), bb.getSize(new THREE.Vector3()).length());
  }
  function teleportTo(si, s) {
    const sec = level.sections[si];
    const f = sec.route.at(s);
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(f.r.clone().negate(), f.u, f.t));
    race.section = si;
    race.state = 'racing';
    race.practice = true;
    for (const c of sec.ctx.crumbles) if (c.sTrigger > s && c.done) { c.done = false; for (const b of c.bodies) world.setFormula(b); }
    // ride whatever the nearest respawn point rides (section 2's plates move)
    let parent = null;
    for (const r of sec.ctx.respawns) if (r.s <= s + 1) parent = r.parent || null;
    race.placeAt({ s, pos: f.p.clone().addScaledVector(f.u, 0.9), quat: q, speed: Math.min(sec.route.vmax[sec.route.index(s)], 24), parent });
    rig.setMode('chase');
    rig.snap(car.pos, car.quat);
    prevPos.copy(car.pos); prevQuat.copy(car.quat);
    hud.message(`PRACTICE - ${sec.route.beatAt(s).id} ${sec.route.beatAt(s).name}`, 2);
  }
  function restart() {
    race.reset();
    race.practice = false;
    race.state = 'countdown'; race.countdown = 3;
    rig.setMode('chase');
    rig.snap(car.pos, car.quat);
    prevPos.copy(car.pos); prevQuat.copy(car.quat);
  }

  // ---------------------------------------------------------------- race events
  function onEvent(e) {
    switch (e.type) {
      case 'go': hud.big('GO', 0.9); break;
      case 'beat': {
        if (race.section === 0 && !race.practice && e.beat.id !== '1A') {
          const t = race.time - race.sectionStart;
          const bestSplit = best.splits?.[e.beat.id];
          if (bestSplit) hud.split(`${e.beat.id}  ${t - bestSplit >= 0 ? '+' : '-'}${Math.abs(t - bestSplit).toFixed(2)}`, t <= bestSplit);
        }
        break;
      }
      case 'portal': {
        rig.teleport(e.xf);
        const st = race.sectionTimes.at(-1);
        if (!race.practice && st) {
          hud.big(fmt(st.time), 3);
          hud.message(`SECTION 1 COMPLETE  -  through the portal to ${e.portal.label}`, 4);
          if (!best.S1 || st.time < best.S1) { best.S1 = st.time; best.splits = { ...race.splits }; localStorage.setItem('slate-l01-best', JSON.stringify(best)); }
        } else hud.message(`PORTAL  >  ${e.portal.label}`, 3);
        break;
      }
      case 'finish': hud.big('END OF GREYBOX', 3); hud.message('Section 2 is a placeholder - press Enter to run Section 1 again', 6); break;
      case 'respawn': rig.snap(car.pos, car.quat); break;
      case 'land': if (e.air > 0.6) rig.shake = Math.min(0.35, e.air * 0.12); break;
      case 'wall': rig.shake = Math.min(0.4, e.dv * 0.03); break;
      default: break;
    }
  }

  // ---------------------------------------------------------------- loop
  const DT = 1 / 120;
  let acc = 0, last = performance.now(), fpsT = 0, frames = 0, fps = 0;
  const prevPos = car.pos.clone(), prevQuat = car.quat.clone();
  const rp = new THREE.Vector3(), rq = new THREE.Quaternion();

  function handleKeys() {
    if (input.hit('KeyG')) designer.classList.toggle('hidden');
    if (input.hit('KeyH')) $('hHelp').classList.toggle('hidden');
    if (input.hit('KeyT')) toggleAuto();
    if (input.hit('KeyP') || input.hit('Escape')) { paused = !paused; hud.message(paused ? 'PAUSED' : '', paused ? 1e9 : 0); }
    if (input.hit('KeyR')) { race.respawn('manual'); prevPos.copy(car.pos); prevQuat.copy(car.quat); }
    if (input.hit('Enter')) restart();
    if (input.hit('KeyM')) { const on = world.motionScale === 0; world.motionScale = on ? 1 : 0; $('dMotion').checked = on; hud.message(on ? 'TOWN MOTION ON' : 'TOWN MOTION FROZEN', 1.5); }
    if (input.hit('KeyC')) rig.setMode(rig.mode === 'chase' ? 'free' : rig.mode === 'free' ? 'overview' : 'chase');
    if (input.hit('KeyF')) rig.setMode(rig.mode === 'free' ? 'chase' : 'free');
    if (input.hit('KeyO')) { if (rig.mode === 'overview') rig.setMode('chase'); else overview(); }
    if (input.hit('BracketLeft')) { timeScale = Math.max(0.1, timeScale - 0.1); $('dTime').value = timeScale; $('dTimeV').textContent = `${timeScale.toFixed(2)}x`; }
    if (input.hit('BracketRight')) { timeScale = Math.min(1, timeScale + 0.1); $('dTime').value = timeScale; $('dTimeV').textContent = `${timeScale.toFixed(2)}x`; }
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    handleKeys();
    const driving = rig.mode === 'chase';
    if (!paused) {
      acc += dt * timeScale;
      let n = 0;
      while (acc >= DT && n < 30) {
        prevPos.copy(car.pos); prevQuat.copy(car.quat);
        const inp = autopilot ? ap.control(car, race.route, race.s) : (driving ? input.poll() : { throttle: 0, brake: car.speed > 0.8 ? 0.4 : 0, steer: 0 });
        race.step(DT, inp);
        for (const e of race.events) { onEvent(e); if (e.type === 'portal' || e.type === 'respawn') { prevPos.copy(car.pos); prevQuat.copy(car.quat); } }
        acc -= DT; n++;
      }
      if (n >= 30) acc = 0;
    }
    const alpha = paused ? 1 : Math.min(1, acc / DT);
    rp.lerpVectors(prevPos, car.pos, alpha);
    rq.slerpQuaternions(prevQuat, car.quat, alpha);
    view.update(world);
    carModel.update(rp, rq, car, dt);
    rig.update(dt, car, rp, rq, input.keys);
    camera.updateMatrixWorld();
    lights.follow(rig.mode === 'chase' ? rp : camera.position);
    sky.position.copy(camera.position);
    clouds.userData.update(world.motionTime, camera.position);
    debris.userData.uniforms.uTime.value = world.motionTime;
    for (const pv of portals) pv.update(camera, now / 1000);
    renderer.render(scene, camera);
    const designing = rig.mode !== 'chase' || !designer.classList.contains('hidden');
    const wide = rig.mode !== 'chase';
    scene.fog.near = wide ? 1200 : 240; scene.fog.far = wide ? 6000 : 2600;
    clouds.visible = !wide; // designer cameras look down: keep the plan readable
    for (const o of overlay.children) if (o.userData.xray) o.visible = designing;
    const bIdx = race.route.beats.indexOf(race.route.beatAt(race.s));
    const near = race.route.beats.slice(Math.max(0, bIdx), bIdx + 2).map((b) => b.id);
    labels.update(camera, window.innerWidth, window.innerHeight, rig.mode !== 'chase', near);
    hud.update(dt, race, car, { best });
    frames++; fpsT += dt;
    if (fpsT > 0.5) { fps = frames / fpsT; frames = 0; fpsT = 0; }
    if (!designer.classList.contains('hidden')) {
      const b = race.route.beatAt(race.s);
      $('dStats').textContent = `fps ${fps.toFixed(0)}   draw calls ${renderer.info.render.calls}   tris ${(renderer.info.render.triangles / 1000).toFixed(0)}k
section ${race.sec.id}   s ${race.s.toFixed(0)} / ${race.route.length.toFixed(0)} m   beat ${b?.id}
speed ${(car.speed * 3.6).toFixed(0)} km/h   wheels ${car.contacts}/4   air ${car.airTime.toFixed(2)} s
respawns ${race.respawnCount}   props hit ${race.stats.props}   crumbles ${race.stats.crumbles}   breaks ${race.stats.breaks}
motion t ${world.motionTime.toFixed(1)} s   x${world.motionScale}   free bodies ${world.free.size}`;
    }
    input.endFrame();
    window.__l01 = {
      level, world, race, car, rig, camera, renderer, hud, teleportTo, overview,
      setAuto: (v) => { autopilot = v; }, setPaused: (v) => { paused = v; },
      /** deterministic: drive N seconds with the autopilot right now, then hold */
      simulate: (sec) => { for (let i = 0; i < sec * 120; i++) { race.step(DT, ap.control(car, race.route, race.s)); for (const e of race.events) onEvent(e); } prevPos.copy(car.pos); prevQuat.copy(car.quat); rig.snap(car.pos, car.quat); for (let i = 0; i < 40; i++) rig.update(1 / 60, car, car.pos, car.quat, input.keys); paused = true; },
    };
  }

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
  if (loading) loading.remove();
  if (params.has('overview')) overview();
  requestAnimationFrame(frame);
}

boot().catch((e) => {
  console.error(e);
  status('Failed to start: ' + e.message);
});
