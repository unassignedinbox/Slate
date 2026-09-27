import { RoadNetwork } from '../src/world/route.js';
import { buildLayout } from '../src/world/layout.js';
import { Field } from '../src/world/field.js';
import { buildTerrain, buildRoads } from '../src/world/terrain.js';
import { WORLD, COURSE, TIDE } from '../src/config.js';

const t0 = Date.now();
const roads = new RoadNetwork();
console.log('roads', roads.paths.map(p => `${p.name}:${p.length.toFixed(0)}m/${p.samples.length}`).join(' '), Date.now()-t0+'ms');

let t = Date.now();
const layout = buildLayout(roads);
console.log('layout', Date.now()-t+'ms', {
  mounds: layout.mounds.length, craters: layout.craters.length, trenches: layout.trenches.length,
  bunkers: layout.bunkers.length, wire: layout.wire.length, sandbags: layout.sandbags.length,
  hedgehogs: layout.hedgehogs.length, teeth: layout.dragonTeeth.length, barricades: layout.barricades.length,
  mines: layout.mines.length, tanks: layout.tanks.length, props: layout.props.length,
  tankMines: layout.mines.filter(m=>m.kind==='tank').length,
});

t = Date.now();
const field = new Field(layout, roads);
roads.gradeTo((x,z)=>field.base(x,z));
field.bakeRoads({minX:-WORLD.halfWidth-80,maxX:WORLD.halfWidth+80,minZ:WORLD.zEnd-80,maxZ:WORLD.zStart+80});
console.log('field+raster', Date.now()-t+'ms');

t = Date.now();
const terrain = buildTerrain(field, {waterLevel: TIDE.startLevel});
console.log('terrain', Date.now()-t+'ms', 'verts', terrain.geometry.attributes.position.count, 'tris', terrain.geometry.index.count/3);

t = Date.now();
const rmesh = buildRoads(field, roads);
console.log('roadmesh', Date.now()-t+'ms');

// sanity probes
const probe = (x,z)=>`(${x},${z}) y=${field.height(x,z).toFixed(2)} surf=${field.surface(x,z)}`;
console.log('spawn', probe(COURSE.spawn.x, COURSE.spawn.z));
console.log('gate ', probe(0, COURSE.gateZ));
console.log('wall ', probe(0, COURSE.wallZ));
console.log('offroad', probe(300, -1000), probe(-300,-2000));
// road continuity: max grade along main
let maxG=0, prev=null;
for (const s of roads.main.samples){ if(prev){ const g=Math.abs(s.y-prev.y)/Math.max(0.01,(s.dist-prev.dist)); maxG=Math.max(maxG,g);} prev=s; }
console.log('max road grade', maxG.toFixed(3));
// road height vs terrain mismatch
let maxMismatch=0;
for (const s of roads.main.samples){ const d=Math.abs(field.height(s.x,s.z)-s.y); if(d>maxMismatch) maxMismatch=d; }
console.log('max road/terrain mismatch', maxMismatch.toFixed(3));
// mines on road check
let onRoad=0; for(const m of layout.mines){ if (field.roadDist(m.x,m.z)<0) onRoad++; }
console.log('mines on carriageway', onRoad, '/', layout.mines.length);
// tide reach
for (const lvl of [-9.5, 0, 8, 17.5]) {
  let lo=-2800, hi=460; for(let i=0;i<30;i++){ const mid=(lo+hi)/2; if(field.profile(mid)>lvl) lo=mid; else hi=mid; }
  console.log('sea level', lvl, '-> shoreline z', ((lo+hi)/2).toFixed(0));
}
console.log('total', Date.now()-t0+'ms');
