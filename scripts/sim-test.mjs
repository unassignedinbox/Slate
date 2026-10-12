// Headless simulation check: runs the full game logic on the generated city for several virtual
// minutes and asserts the invariants that matter (no NaNs, racing happens, pursuit escalates,
// gadgets and bollards fire, nothing teleports or exceeds plausible speeds).
import { generateCity } from '../src/map/road/cityGen.js';
import { GameSim } from '../src/game/sim/index.js';

const seconds = Number(process.argv[2] || 240);
const seeds = (process.argv[3] || '1337').split(',').map(Number);
let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) failures++; };

for (const seed of seeds) {
  const net = generateCity({ seed, size: 4096 });
  const sim = new GameSim(net, { seed });
  const counts = { lockdown: 0, busted: 0, tireNet: 0, emp: 0, jam: 0, photon: 0, drone: 0, heli: 0, pit: 0 };
  let nan = 0, maxSpeed = 0, maxLevel = 0, maxCops = 0, maxAir = 0, maxUp = 0, maxStep = 0;
  const prev = new Map();
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i++) {
    sim.step(1 / 60);
    for (const v of sim.vehicles) {
      if (!Number.isFinite(v.x) || !Number.isFinite(v.z) || !Number.isFinite(v.s) || !Number.isFinite(v.v)) nan++;
      maxSpeed = Math.max(maxSpeed, v.v);
      // Drawn position (physics position plus the render-only junction slide).
      const X = v.x + v.vx, Z = v.z + v.vz;
      const p = prev.get(v.id);
      if (p) maxStep = Math.max(maxStep, Math.hypot(X - p.x, Z - p.z));
      prev.set(v.id, { x: X, z: Z });
    }
    maxLevel = Math.max(maxLevel, sim.heat.level);
    maxCops = Math.max(maxCops, sim.police.cops.length);
    maxAir = Math.max(maxAir, sim.air.units.length);
    maxUp = Math.max(maxUp, sim.bollards.gates.filter(g => g.on).length);
  }
  for (const e of sim.events) {
    if (/Security lockdown/.test(e.text)) counts.lockdown++;
    if (/BUSTED/.test(e.text)) counts.busted++;
    if (/Tire net deployed/.test(e.text)) counts.tireNet++;
    if (/EMP pulse/.test(e.text)) counts.emp++;
    if (/jammer/.test(e.text)) counts.jam++;
    if (/Photon wall online/.test(e.text)) counts.photon++;
    if (/Drone wall|Recon drone|Interceptor/.test(e.text)) counts.drone++;
    if (/helicopter/.test(e.text)) counts.heli++;
    if (/PIT/.test(e.text)) counts.pit++;
  }
  const racersMoved = sim.race.racers.filter(r => r.raceDist > 0).length + sim.race.results.length;
  console.log(`seed ${seed}: ${seconds}s sim, ${sim.vehicles.length} vehicles, race ${sim.race.number}, maxLevel ${maxLevel}, maxCops ${maxCops}, maxAir ${maxAir}, maxBollardsUp ${maxUp}`);
  console.log('  events:', JSON.stringify(counts));
  check(nan === 0, `seed ${seed}: no NaN positions or speeds`);
  check(maxSpeed < 60, `seed ${seed}: top speed ${maxSpeed.toFixed(1)} m/s is plausible`);
  check(maxStep < 3.5, `seed ${seed}: no teleporting (max per-step move ${maxStep.toFixed(2)} m)`);
  check(sim.vehicles.filter(v => v.kind === 'civ').length >= 50, `seed ${seed}: civilian traffic present`);
  check(sim.race.racers.some(r => r.raceDist > 500) || sim.race.number > 1, `seed ${seed}: racers make progress`);
  check(maxLevel >= 2, `seed ${seed}: pursuit escalates to heat 2+ (reached ${maxLevel})`);
  check(maxCops >= 1, `seed ${seed}: police units dispatched`);
  check(maxAir >= 1 || counts.drone > 0, `seed ${seed}: air units deployed`);
  check(counts.lockdown + maxUp > 0, `seed ${seed}: bollard gates used`);
  check(sim.events.length > 0, `seed ${seed}: event feed populated`);
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
