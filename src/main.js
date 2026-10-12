// Entry point: generate the city, build the simulation and the 3D view, then run the frame loop.
import { generateCity } from './map/road/cityGen.js';
import { NetworkBuilder } from './map/road/builder.js';
import { GameSim } from './game/sim/index.js';
import { GameView } from './game/view/scene.js';
import { CameraRig } from './game/view/rig.js';
import { HUD } from './game/view/hud.js';

const SPEEDS = [1, 2, 4, 0.5];
const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed')) || 1337;
const size = Number(params.get('size')) || 4096;

const $ = s => document.querySelector(s);
const setLoad = (f, text) => { $('#load-bar').style.width = `${Math.round(f * 100)}%`; $('#load-text').textContent = text; };

async function boot() {
  setLoad(0.02, 'Generating city…');
  await new Promise(r => setTimeout(r, 30));
  const net = generateCity({ seed, size });
  const st = net.stats();
  setLoad(0.25, `Road network: ${st.nodes} junctions, ${st.km.toFixed(0)} km of road. Solving junctions…`);
  const builder = new NetworkBuilder(net);
  await builder.buildAll((f, label) => setLoad(0.25 + f * 0.4, `${label}…`));
  setLoad(0.66, 'Starting simulation…');
  await new Promise(r => setTimeout(r, 20));
  const sim = new GameSim(net, { seed });
  setLoad(0.72, 'Building meshes…');
  await new Promise(r => setTimeout(r, 20));
  const canvas = $('#view');
  const view = new GameView(canvas, sim, net, builder);
  const rig = new CameraRig(view, sim);
  const hud = new HUD(document.querySelector('#hud'), net, sim, view, rig);
  setLoad(1, 'Ready');
  setTimeout(() => $('#loading').classList.add('done'), 250);

  // Start looking over the race start.
  const start = sim.race.racers[0];
  if (start) view.camera.position.set(start.x - 60, 70, start.z - 60);
  view.controls.yaw = -0.7; view.controls.pitch = -0.6; view.controls.applyRotation();
  rig.setMode('director');

  const state = { paused: false, speed: 0 };
  const keyActions = {
    Digit1: () => rig.setMode('free'),
    Digit2: () => rig.setMode('follow'),
    Digit3: () => rig.setMode('director'),
    Tab: (e) => { e.preventDefault(); rig.cycle(e.shiftKey ? -1 : 1); },
    BracketRight: () => rig.cycle(1),
    BracketLeft: () => rig.cycle(-1),
    Space: (e) => { e.preventDefault(); state.paused = !state.paused; hud.raceHint = state.paused ? 'PAUSED' : ''; },
    KeyT: () => { state.speed = (state.speed + 1) % SPEEDS.length; hud.speedLabel = `${SPEEDS[state.speed]}×`; },
    KeyN: () => { sim.race.skip(); sim.event('Race skipped — next grid forming', 'race'); },
    KeyH: () => { hud.showHelp = !hud.showHelp; },
    KeyM: () => { hud.minimapOn = !hud.minimapOn; $('#minimap').style.display = hud.minimapOn ? '' : 'none'; },
    KeyF: () => { const h = sim.race.hottest(); if (h) { rig.target = h; rig.setMode('follow'); } },
  };
  window.addEventListener('keydown', e => {
    const fn = keyActions[e.code];
    if (!fn || (e.target && /INPUT|TEXTAREA/.test(e.target.tagName))) return;
    if (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3') { /* handled by fn */ }
    fn(e);
  });

  let last = performance.now();
  const frame = now => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!state.paused) {
      const scale = SPEEDS[state.speed];
      sim.advance(dt * scale);
    }
    view.sync(dt);
    rig.update(dt);
    view.render();
    hud.update(dt);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // Test hook: lets automated checks read the live state.
  window.__slate = { sim, view, rig, hud, state };
}

boot().catch(err => {
  console.error(err);
  setLoad(1, 'Failed to start: ' + err.message);
});
