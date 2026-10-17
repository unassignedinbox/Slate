// Prints a designer-facing report of the Fragmented Town: zones, portals,
// counts, and a headless drive with the autopilot.
//   npm run report

import { buildFragmentedTown } from '../src/levels/fragmented-town/build.js';
import { runAutopilot } from '../src/engine/autopilot.js';
import { fmtTime } from '../src/render/hud.js';

const level = buildFragmentedTown();
console.log(`\n${level.name} (in-world: ${level.inWorldName}) — seed ${level.seed}\n`);
console.log('Zones');
for (const z of level.parts) {
  console.log(`  ${z.id}  ${z.name.padEnd(14)} road ${z.route.length.toFixed(0).padStart(5)} m   ${z.subtitle}`);
}
console.log('\nPortals');
for (const g of level.gates.filter((g) => g.role === 'entry')) {
  console.log(`  ${g.label.padEnd(10)} ${g.partId} @ (${g.pos.map((v) => v.toFixed(0)).join(', ')})  →  ${g.pair.partId} @ (${g.pair.pos.map((v) => v.toFixed(0)).join(', ')})`);
}
console.log('\nCounts');
for (const [k, v] of Object.entries(level.counts)) console.log(`  ${k.padEnd(10)} ${v}`);

const r = await runAutopilot(level);
console.log('\nAutopilot drive (cruise 26 m/s, through real physics)');
console.log(`  finished: ${r.finished}   falls: ${r.falls}   scenery hits: ${r.collisionsWithScenery}   kerb hits: ${r.collisionsWithKerbs}`);
let prev = 0;
for (const s of r.splits) {
  console.log(`  ${s.label.padEnd(16)} ${fmtTime(s.t)}   leg ${fmtTime(s.t - prev)}`);
  prev = s.t;
}
console.log('');
