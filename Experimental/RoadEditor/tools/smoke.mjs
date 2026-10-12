// Headless generator smoke test. Runs the whole procedural build with no DOM and prints the
// topology report, so a change to the generator can be checked in a terminal.
import { generateCity, PRESETS } from '../src/citygen.js';
import { buildRenderModel } from '../src/build.js';

const preset = process.argv[2] || 'city';
const seed = Number(process.argv[3] || 20261012);
const P = PRESETS[preset] || PRESETS.city;

const t0 = performance.now();
const { net, terrain, report } = generateCity({ ...P, preset, seed });
const t1 = performance.now();

const stats = net.stats();
console.log('=== ROAD NETWORK ===');
console.log(`preset ${preset}  seed ${seed}  extent ${P.extent} m`);
console.log(`generate        ${(t1 - t0).toFixed(0)} ms`);
console.log('stages', Object.entries(report.stages || {}).map(([k, v]) => `${k} ${v.toFixed(0)}ms`).join('  '));
console.log(`roads ${stats.roads}   nodes ${stats.nodes}   road ${stats.roadKm.toFixed(1)} km   lanes ${stats.laneKm.toFixed(1)} lane-km`);
console.log(`kerb ${stats.kerbKm.toFixed(1)} km  footway ${stats.sidewalkKm.toFixed(1)} km  bridges ${stats.bridgeKm.toFixed(2)} km`);
console.log(`rail ${stats.railKm.toFixed(1)} km   level crossings ${stats.crossings}   subway ${stats.subwayKm.toFixed(1)} km  stations ${stats.stations}`);
console.log(`blocks ${stats.blocks}`);
console.log('by class', stats.byClass);
console.log(`validation: ${report.validation.errors} errors, ${report.validation.warnings} warnings, ${report.validation.info} info`);
for (const issue of report.validation.issues.slice(0, 12)) console.log(`  [${issue.sev}] ${issue.code}: ${issue.msg}`);

const t2 = performance.now();
const model = buildRenderModel(net, terrain, {});
const t3 = performance.now();
console.log('=== GEOMETRY ===');
console.log(`build           ${(t3 - t2).toFixed(0)} ms`);
console.log(`surfaces  ${model.surfaces.vertexCount} verts  ${model.surfaces.triCount} tris  ${model.surfaces.groups.length} groups`);
console.log(`markings  ${model.markings.vertexCount} verts  ${model.markings.triCount} tris`);
console.log(`props     ${Object.keys(model.instanceKinds).length} instanced kinds  ${model.instances.length} instances`, model.instanceKinds);
console.log(`structures ${model.structures.triCount} tris   rail ${model.rail.triCount} tris   subway ${model.subway.triCount} tris   terrain ${model.terrainVerts} verts`);
console.log(`render paths ${report.renderPaths.pointsAfter} of ${report.renderPaths.pointsBefore} points`);
console.log(`xray      ${model.xray.vertexCount} verts  ${model.xray.triCount} tris`);
if (model.warnings.length) console.log('warnings', model.warnings);

console.log('=== SUMMARY ===');
console.log(`generated and built without throwing; ${report.validation.errors} validation errors, ${report.validation.warnings} warnings`);
if (process.argv.includes('--strict') && report.validation.errors > 0) {
  console.log('strict mode: failing because the validation list is not empty');
  process.exit(1);
}
