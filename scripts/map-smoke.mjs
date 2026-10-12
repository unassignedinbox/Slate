// Headless map check: the Frontier road generator produces a drivable network and meshes build.
import { generateCity } from '../src/map/road/cityGen.js';
import { NetworkBuilder } from '../src/map/road/builder.js';

const seed = Number(process.argv[2] || 1337), size = Number(process.argv[3] || 4096);
const t0 = performance.now();
const net = generateCity({ seed, size });
const st = net.stats();
const b = new NetworkBuilder(net);
await b.buildAll();
let tris = 0, nan = 0;
for (const o of b.outs.values()) for (const k in o.mesh) { tris += o.mesh[k].i.length / 3; for (const v of o.mesh[k].p) if (!Number.isFinite(v)) { nan++; break; } }
console.log(`map seed ${seed}: ${st.nodes} nodes, ${st.edges} edges, ${st.km.toFixed(1)} km road, ${Math.round(tris)} triangles, ${nan} bad pieces, ${((performance.now() - t0) / 1000).toFixed(1)} s`);
if (st.nodes < 100 || nan) { console.log('FAIL'); process.exit(1); }
console.log('PASS');
