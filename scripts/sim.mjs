// Headless playthrough: drives the real game loop with a simple autopilot that
// follows the road, so every per-frame system runs for a few thousand frames.
import { Game } from '../src/game.js';
import { COURSE } from '../src/config.js';

globalThis.performance = globalThis.performance || { now: () => Date.now() };

const game = new Game(null, null, null, { headless: true });
await game.load();
game.start();

const roads = game.roads;
const car = game.car;
const dt = 1 / 60;
let frames = 0;
let maxFrameMs = 0;
const seen = { fired: 0, bulletsAlive: 0, bombs: 0, planes: 0, minesHit: 0 };
const t0 = Date.now();

// autopilot: steer toward a point ~35 m ahead on the main road
function drive() {
  const hit = roads.main.nearest(car.pos.x, car.pos.z, 300);
  const t = hit ? hit.sample.t : 0;
  const ahead = roads.main.at(Math.min(1, t + 0.008));
  const dx = ahead.x - car.pos.x;
  const dz = ahead.z - car.pos.z;
  let want = Math.atan2(dx, dz) - car.yaw;
  while (want > Math.PI) want -= Math.PI * 2;
  while (want < -Math.PI) want += Math.PI * 2;
  game.input.throttle = Math.abs(want) > 0.7 ? 0.4 : 1;
  game.input.brake = 0;
  game.input.steer = Math.max(-1, Math.min(1, want * 2.2));
}

game.readInput = drive;

// tally damage by cause
const tally = {};
const GOD = !!process.env.SIM_GOD;
const origDamage = car.damage.bind(car);
car.damage = (amount, kind) => { tally[kind] = (tally[kind] || 0) + amount; if (!GOD) origDamage(amount, kind); };

const LIMIT = +(process.env.SIM_FRAMES || 9000);
let stuckFrames = 0;
while (frames < LIMIT && game.state === 'playing') {
  const f0 = Date.now();
  game.step(dt);
  maxFrameMs = Math.max(maxFrameMs, Date.now() - f0);
  frames++;
  if (Math.abs(car.speed) < 1.5) stuckFrames++;
  if (frames % 1200 === 0) {
    console.log(
      `t=${(frames * dt).toFixed(0)}s`,
      `z=${car.pos.z.toFixed(0)}`,
      `hp=${car.health.toFixed(0)}`,
      `kmh=${car.kmh.toFixed(0)}`,
      `surf=${car.surface}`,
      `sea=${game.ocean.level.toFixed(1)}`,
      `planes=${game.planes.planes.length}`,
      `bombs=${game.planes.bombs.length}`,
      `mines=${game.stats.mines}`,
      `hits=${game.stats.hits}`,
      `alerted=${game.sentries.filter(s=>s.alerted>0.4).length}`,
    );
  }
}
const liveBullets = game.bullets.bullets.filter(b=>b.alive).length;
console.log('---');
console.log('state', game.state, 'frames', frames, 'sim wall time', (Date.now()-t0)/1000 + 's', 'worst frame', maxFrameMs+'ms');
console.log('final z', car.pos.z.toFixed(0), 'health', car.health.toFixed(1), 'distance', car.distanceTravelled.toFixed(0));
console.log('stats', game.stats, 'live bullets', liveBullets);
console.log('frames below 1.5 m/s', stuckFrames, `(${(stuckFrames/frames*100).toFixed(1)}%)`);
console.log('damage by cause', Object.fromEntries(Object.entries(tally).map(([k,v])=>[k, +v.toFixed(1)])));
