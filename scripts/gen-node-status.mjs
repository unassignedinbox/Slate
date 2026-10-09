// Generates docs/NODE_STATUS.md from the registry. Run: npm run docs
import { writeFileSync } from 'node:fs';
import { NODE_LIST } from '../src/engine/registry.js';

// Nodes implemented as simplified approximations of the named Gaea behaviour (not a faithful
// reproduction of QuadSpinner's algorithm). Everything else is a direct implementation of the
// described operation with the parameters listed in the UI.
const APPROX = new Set([
  12, 13, 14, 19, 18, 11, 22, 23,                 // gabor/sparse/wavelet/jordan/swiss/cellular/hex/brick approximations
  59, 60, 61, 62, 63, 64, 65, 67, 68,             // wind, glacial, coastal, cascade, sediment, debris, snowmelt, flow, rain erosion
  55, 56, 57, 66, 69,                             // stream-power variants (one shared solver)
  70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, // geology: analytic/heuristic forms
  90, 91, 92, 93, 94,                             // flood, pond, waterfall, delta, meander: heuristic carving
  180, 181, 182, 183, 184, 185, 186, 187, 188, 189, 190, 191, 193, 194, 195, // colour: palette-driven stand-ins
  199, 200, 201, 202, 203,                        // AO/displacement/flow/moisture/snow: heuristic maps
  224, 225, 229, 230, 231, 233, 234, 235,         // utility: simplified
  236, 237, 238, 239, 240,                        // vegetation: density stand-ins (no instanced meshes)
  127, 128, 164,                                  // roughness/smoothness: local-stddev proxy
]);
const lines = [
  '# Node status', '',
  'Every Gaea node id from the requirement list (1–240) is registered in `src/engine/registry.js`, plus one extra node (241, Substance-style procedural fill).',
  '',
  '- **implemented** — runs the described operation directly with the listed parameters.',
  '- **approximate** — runs, but uses a simplified or heuristic form of the named Gaea behaviour. Do not expect parity with QuadSpinner output.',
  '',
  '| ID | Node | Category | Mode | Status | Params |', '|---|---|---|---|---|---|',
];
for (const n of NODE_LIST) {
  lines.push(`| ${n.id} | ${n.name} | ${n.cat} | ${n.mode} | ${APPROX.has(n.id) ? 'approximate' : 'implemented'} | ${n.params.map((p) => p.k).join(', ') || '—'} |`);
}
const approxCount = NODE_LIST.filter((n) => APPROX.has(n.id)).length;
lines.splice(3, 0, `\nCounts: ${NODE_LIST.length - approxCount} implemented, ${approxCount} approximate.\n`);
writeFileSync(new URL('../docs/NODE_STATUS.md', import.meta.url), lines.join('\n') + '\n');
console.log(`wrote docs/NODE_STATUS.md (${NODE_LIST.length} nodes, ${approxCount} approximate)`);
