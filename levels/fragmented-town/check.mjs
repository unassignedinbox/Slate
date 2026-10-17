// Headless level checker for Section 1 (Tallow Hill).
//
//   node levels/fragmented-town/check.mjs         (or: cd greybox && npm run check)
//
// 1. Validates the layout (clearance, holes, gaps, self-crossing, hand blocks).
// 2. Drives every leg with the autopilot using the REAL car physics and road probe.
//    That gives a par time per leg and proves the leg is drivable with no respawns.
// 3. Enforces the design rule: every leg takes at least LEVEL.minLegSeconds.
//
// Exit code is 0 only if everything passes, so it can gate CI later.

import { LEVEL } from './layout.js';
import { buildPaths, buildTown, validate } from './town.js';
import { createRun, stepRun } from '../../greybox/src/sim/run.js';
import { autopilotInput } from '../../greybox/src/sim/autopilot.js';

const DT = 1 / 60;          // same frame step the browser uses
const MAX_RUN_SECONDS = 600;

const paths = buildPaths(LEVEL);
const town = buildTown(LEVEL, paths);
const report = validate(LEVEL, paths, town);

let failures = [...report.errors];

// ---- drive the whole section with the autopilot
const run = createRun(LEVEL, town);
const respawns = [];
let lastLeg = run.legIndex;
const legAt = [];
let guard = 0;
while (!run.finished && run.t < MAX_RUN_SECONDS && guard++ < 1e7) {
  stepRun(run, autopilotInput(run), DT);
  for (const ev of run.events) {
    if (ev.type === 'respawn') respawns.push({ leg: run.legIndex, s: run.lastGoodS.toFixed(0), why: ev.why, t: run.t.toFixed(1) });
  }
  run.events.length = 0;
  if (run.legIndex !== lastLeg) {
    legAt.push(run.t);
    lastLeg = run.legIndex;
  }
}

const pad = (s, n) => String(s).padEnd(n);
console.log('');
console.log(`${LEVEL.title} - ${LEVEL.subtitle}`);
console.log('-'.repeat(78));
console.log(`${pad('leg', 8)}${pad('shard', 9)}${pad('length', 9)}${pad('gaps (m)', 12)}${pad('par (s)', 10)}${pad('min 30s', 9)}end`);
report.legs.forEach((l, i) => {
  const par = run.legTimes[i];
  const parTxt = par === undefined ? 'DNF' : par.toFixed(1);
  const ok = par !== undefined && par >= LEVEL.minLegSeconds;
  if (par === undefined) failures.push(`${l.id}: autopilot did not finish this leg`);
  else if (!ok) failures.push(`${l.id}: par ${par.toFixed(1)} s is under the ${LEVEL.minLegSeconds} s minimum`);
  if (par !== undefined && par > LEVEL.maxLegSeconds) failures.push(`${l.id}: par ${par.toFixed(1)} s is over the ${LEVEL.maxLegSeconds} s maximum`);
  console.log(
    `${pad(l.id, 8)}${pad(l.shard, 9)}${pad(l.length + ' m', 9)}${pad(l.gaps.length ? l.gaps.join(', ') : '-', 12)}${pad(parTxt, 10)}${pad(ok ? 'yes' : 'NO', 9)}${l.endKind === 'finish' ? 'FINISH' : 'portal -> next shard'}`,
  );
});
console.log('-'.repeat(78));
console.log(`total race time (autopilot): ${run.finished ? run.totalTime.toFixed(1) + ' s' : 'DNF'}`);
console.log(`autopilot respawns: ${respawns.length}`);
for (const r of respawns) console.log(`  - leg ${r.leg + 1} at s=${r.s} m, ${r.why}, t=${r.t}s`);
if (respawns.length) failures.push(`autopilot had ${respawns.length} respawn(s): the road is not drivable at that point`);

if (report.warnings.length) {
  console.log('\nwarnings:');
  for (const w of report.warnings) console.log('  ! ' + w);
}
if (report.errors.length) {
  console.log('\nerrors:');
  for (const e of report.errors) console.log('  x ' + e);
}

// ---- town stats (for the design doc)
console.log('\ntown:');
for (const shard of LEVEL.shards) {
  const t = town.shards[shard.id];
  const autos = t.solids.filter((s) => !s.hand).length;
  const holesRemoved = t.plates.filter((p) => !p.present).length;
  console.log(
    `  ${pad(shard.name, 14)} buildings ${String(autos).padStart(3)} | hand blocks ${t.solids.filter((s) => s.hand).length} | props ${String(t.props.length).padStart(3)} | debris ${String(t.debris.length).padStart(3)} | plates removed ${holesRemoved}/${t.plates.length}`,
  );
}

console.log('');
if (failures.length) {
  console.log('FAIL');
  for (const f of failures) console.log('  - ' + f);
  process.exitCode = 1;
} else {
  console.log('PASS: every leg is drivable and at least ' + LEVEL.minLegSeconds + ' s long.');
}
