// Headless level test: builds Level 01 in Node, hands the car to the autopilot
// and drives Section 1 at a fixed 120 Hz step, through the portal into Section 2.
// Proves the section is completable and measures its length in time.
//   node tools/headless-run.mjs [--phase=<seconds of town motion before start>] [--no-motion] [--no-fracture] [--quiet]
import { buildLevel01 } from '../src/level/level01.js';
import { Car } from '../src/core/vehicle.js';
import { Autopilot } from '../src/core/autopilot.js';
import { Race } from '../src/game/race.js';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const level = buildLevel01();
const car = new Car(level.world);
const race = new Race(level, car, { fracture: !args['no-fracture'] });
if (args['no-motion']) level.world.motionScale = 0;
level.world.motionTime = Number(args.phase || 0);
const ap = new Autopilot();
const dt = 1 / 120;
const q = !!args.quiet;
let t = 0, nan = false, s1Time = null, lastLog = -1;
const beatLog = [];
const t0 = Date.now();
while (t < 240) {
  const input = ap.control(car, race.route, race.s);
  race.step(dt, input);
  t += dt;
  if (!Number.isFinite(car.pos.x + car.pos.y + car.pos.z + car.vel.x)) { nan = true; break; }
  for (const e of race.events) {
    if (e.type === 'portal') { s1Time = race.sectionTimes[0].time; if (!q) console.log(`PORTAL at t=${t.toFixed(2)} -> ${e.portal.label}  (S1 time ${s1Time.toFixed(2)} s)`); }
    if (e.type === 'beat' && race.section === 0) beatLog.push(`${e.beat.id} ${race.time.toFixed(2)}s`);
    if (e.type === 'respawn' && !q) console.log(`  respawn (${e.reason}) at s=${race.respawnLog.at(-1).s} t=${t.toFixed(2)}`);
  }
  if (!q && Math.floor(t / 4) !== lastLog) {
    lastLog = Math.floor(t / 4);
    console.log(`t=${t.toFixed(1).padStart(5)} sec=${race.sec.id} s=${race.s.toFixed(0).padStart(5)} v=${(car.speed * 3.6).toFixed(0).padStart(4)} km/h  y=${car.pos.y.toFixed(1)} contacts=${car.contacts} beat=${race.route.beatAt(race.s).id}`);
  }
  if (race.state === 'finished') break;
}
const st = race.stats;
const result = {
  completedS1: s1Time !== null, s1Time: s1Time && +s1Time.toFixed(2), finished: race.state === 'finished', total: +race.time.toFixed(2),
  respawns: race.respawnLog, nan, maxSpeedKmh: +(st.maxSpeed * 3.6).toFixed(0), avgSpeedKmh: s1Time ? +((level.sections[0].route.length / s1Time) * 3.6).toFixed(0) : null,
  airTime: +st.air.toFixed(1), longestAir: +st.maxAir.toFixed(2), wallHits: st.walls, propHits: st.props, breaks: st.breaks, crumbles: st.crumbles,
  splits: beatLog.join('  '), wallClockMs: Date.now() - t0,
};
console.log(JSON.stringify(result, null, 1));
const ok = result.completedS1 && result.s1Time >= 30 && !nan;
console.log(ok ? `PASS: Section 1 completed in ${result.s1Time} s (>= 30 s), ${race.respawnLog.length} respawns` : 'FAIL');
process.exit(ok ? 0 : 1);
