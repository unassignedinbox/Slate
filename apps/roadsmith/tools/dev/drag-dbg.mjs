import { buildScene, assembleScene, defaultSettings } from '../../src/road/scene.js';
import { solveNetwork } from '../../src/road/junction.js';
const settings = defaultSettings('downtown');
const scene = buildScene(settings);
const movable = [...scene.net.nodes.values()].filter((n) => n.edges.length >= 3 && !n.locked);
const t = movable[Math.floor(movable.length / 2)];
const i0 = scene.surface.junctions.get(t.id);
console.log('node', t.id, 'arms', t.edges.length, 'p', t.p.x.toFixed(2), t.p.z.toFixed(2));
console.log('plate before offset from node:', (i0.centre.x - t.p.x).toFixed(2), (i0.centre.z - t.p.z).toFixed(2), 'radius', i0.radius?.toFixed(2));
scene.net.moveNode(t.id, { x: t.p.x + 13.5, z: t.p.z - 9.25 });
solveNetwork(scene.net);
const moved = assembleScene({ net: scene.net, rails: scene.rails, subway: scene.subway, meta: scene.meta }, settings);
const i1 = moved.surface.junctions.get(t.id);
console.log('plate after  offset from node:', (i1.centre.x - t.p.x).toFixed(2), (i1.centre.z - t.p.z).toFixed(2), 'radius', i1.radius?.toFixed(2));
console.log('arms:');
for (const eid of t.edges) {
  const e = scene.net.edges.get(eid);
  console.log(' ', eid, e.profile.class, 'len', e.curve.length.toFixed(1), 'trimA', e.trimA.toFixed(2), 'trimB', e.trimB.toFixed(2), 'via', e.via.length);
}
