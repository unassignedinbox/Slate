import { buildScene, defaultSettings } from '../../src/road/scene.js';
const t0 = performance.now();
const s = buildScene(defaultSettings('downtown'));
const ms = performance.now() - t0;
console.log('build', ms.toFixed(0), 'ms');
console.log('timings', Object.fromEntries(Object.entries(s.timings).map(([k,v])=>[k, +v.toFixed(1)])));
console.log('stats', s.stats);
console.log('layers', s.layers.map(l=>`${l.id}:${l.count}`).join(' '));
console.log('lanes', s.laneGraph.lanes.size, 'conns', s.laneGraph.connections.length, 'signalNodes', [...s.laneGraph.nodes.values()].filter(n=>n.signalised).length);
console.log('crossings', s.rail.crossings.length, 'barriers', s.crossing.barriers.length, 'blocks', s.blocks.blocks.length, 'skipped', s.blocks.skipped);
for (let i=0;i<120;i++) { s.traffic.step(1/60); if (s.trains) s.trains.step(1/60, s.traffic); }
const v = s.traffic.vehicles[0];
console.log('after 2s: vehicles', s.traffic.vehicles.length, 'v0', v && {s:+v.s.toFixed(1), v:+v.v.toFixed(1), lane:v.lane?.id, conn: !!v.conn, pos:[+v.pos.x.toFixed(1),+v.pos.y.toFixed(2),+v.pos.z.toFixed(1)]});
const speeds = s.traffic.vehicles.map(x=>x.v);
console.log('speed avg', (speeds.reduce((a,b)=>a+b,0)/speeds.length).toFixed(2), 'min', Math.min(...speeds).toFixed(2), 'max', Math.max(...speeds).toFixed(2));
console.log('trains', s.trains ? s.trains.poses().length : 0);
