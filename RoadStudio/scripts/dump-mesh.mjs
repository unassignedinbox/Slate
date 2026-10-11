// Dev tool: builds a document's mesh and writes triangles to JSON for render-topdown.py.
//   node scripts/dump-mesh.mjs [out.json] [docfile.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { createDemoDoc, deserialize } from '../src/engine/network.js';
import { buildScene } from '../src/engine/roadGeometry.js';

const out = process.argv[2] || '/tmp/topdown.json';
const doc = process.argv[3] ? deserialize(readFileSync(process.argv[3], 'utf8')) : createDemoDoc();
const scene = buildScene(doc);
const d = scene.data;
const tris = [];
for (let i = 0; i < d.length; i += 27) {
  // 3 vertices x 9 floats per triangle
  tris.push([d[i], d[i + 1], d[i + 2], d[i + 6], d[i + 9], d[i + 10], d[i + 11], d[i + 15], d[i + 18], d[i + 19], d[i + 20], d[i + 24], d[i + 7]].map((v) => +v.toFixed(3)));
}
writeFileSync(out, JSON.stringify({ stats: { ...scene.stats, warnings: scene.stats.warnings }, tris }));
console.log(`wrote ${tris.length} triangles to ${out}`, JSON.stringify(scene.stats.warnings));
