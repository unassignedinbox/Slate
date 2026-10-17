// Boot: build the level, create the world and the view, run the loop.
//
// Dev-only URL options (handy for reviewing the greybox):
//   ?overview        start in a top-down overview of the whole town
//   ?from=B          drop the car at zone B's entry (also A or C)
//   ?debug           show route centrelines and wheel probes

import './style.css';
import { buildFragmentedTown } from './levels/fragmented-town/build.js';
import { World, PHYSICS_DT } from './engine/world.js';
import { createSceneView } from './render/scene.js';
import { createHud } from './render/hud.js';
import { createInput } from './render/input.js';
import { routeAt } from './engine/spline.js';

const params = new URLSearchParams(window.location.search);
const level = buildFragmentedTown();
const world = new World(level);

if (params.has('from') && level.partsById[params.get('from')]) {
  const zone = level.partsById[params.get('from')];
  const s = zone.startS;
  const smp = routeAt(zone.route, s + 6);
  world.car.reset({ pos: smp.p, yaw: Math.atan2(smp.F[0], smp.F[2]), speed: 0 });
  world.partId = zone.id;
}

const canvas = document.getElementById('scene');
const view = createSceneView(level, canvas);
const hud = createHud(level, world);
const input = createInput();

if (params.has('debug')) view.setDebug(true);
if (params.has('overview')) view.setOverview(true);

let acc = 0;
let last = performance.now();
let mapTimer = 0;

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  const c = input.read(dt);
  if (c.debug) view.setDebug(!view.debug);
  if (c.camera) view.setCameraMode(view.cameraMode === 'chase' ? 'cockpit' : 'chase');
  if (c.overview) view.setOverview(!view.overview);
  if (c.map) hud.setMapVisible(!hud.mapVisible);
  if (c.restart && world.finished) {
    world.reset();
    hud.say('Race restarted');
  } else if (c.respawn) {
    if (world.finished) {
      world.reset();
      hud.say('Race restarted');
    } else {
      world.respawn();
      hud.say('Back to the last checkpoint');
    }
  }

  acc += dt;
  while (acc >= PHYSICS_DT) {
    world.step(PHYSICS_DT, c.input);
    for (const ev of world.events) {
      if (ev.type === 'start') hud.say('Go!');
      if (ev.type === 'portal') hud.say(`Portal → ${level.partsById[ev.partId].name}`, 2);
      if (ev.type === 'finish') hud.say('Finish');
    }
    acc -= PHYSICS_DT;
  }
  input.endFrame();

  view.update(world, dt);
  hud.update(world, dt);
  if (hud.mapVisible) {
    mapTimer += dt;
    if (mapTimer > 1 / 30) {
      mapTimer = 0;
      hud.drawMap(world);
    }
  }
  view.render();
  requestAnimationFrame(frame);
}

window.__slate = { level, world, view, hud };
requestAnimationFrame(frame);
