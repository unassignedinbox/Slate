/* Headless smoke test — exercises the whole geometry pipeline without WebGL.
   Run:  node tools/smoke.mjs                                              */

import * as THREE from 'three';
import { RoadNetwork } from '../src/model/RoadGraph.js';
import { generateCity, PATTERNS } from '../src/gen/CityGenerator.js';
import { MeshSink, PropSink } from '../src/gen/MeshSink.js';
import { buildRoadSurface, Ribbon, makeElevation, makeBump, makeBank } from '../src/gen/RoadMeshBuilder.js';
import { buildMarkings } from '../src/gen/Markings.js';
import { buildJunction, junctionMouths } from '../src/gen/Junction.js';
import { buildTrack, findCrossings } from '../src/gen/Railway.js';
import { placeProps, buildPropGeometries } from '../src/gen/Props.js';
import { compileProfile } from '../src/gen/CrossSection.js';
import { PRESETS, KINDS } from '../src/model/Presets.js';
import { Terrain } from '../src/core/Terrain.js';

let fails = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) { fails++; console.log(`  FAIL  ${name} ${extra}`); }
  else console.log(`  ok    ${name} ${extra}`);
};

/* ------------------------------------------------ 1. cross-section compiler */
console.log('\n[1] cross-section compiler');
for (const p of PRESETS) {
  try {
    const sec = compileProfile(p.bands, { camber: 0.025 });
    const w = sec.width;
    if (!(w > 0.5)) { fails++; console.log(`  FAIL  ${p.id} width=${w}`); continue; }
    const finite = sec.nodes.every((n) => isFinite(n.l) && isFinite(n.h));
    if (!finite) { fails++; console.log(`  FAIL  ${p.id} non-finite nodes`); continue; }
    const strips = sec.strips.length;
    console.log(`  ok    ${p.id.padEnd(20)} ${w.toFixed(1).padStart(6)}m  ${String(sec.nodes.length).padStart(3)} nodes  ${String(strips).padStart(2)} strips`);
  } catch (e) {
    fails++; console.log(`  FAIL  ${p.id} threw ${e.message}`);
  }
}

/* ----------------------------------------------------- 2. every preset mesh */
console.log('\n[2] extrude every preset');
const net = new RoadNetwork();
for (const p of PRESETS) {
  const sink = new MeshSink();
  const a = net.addNode(0, 0, 0);
  const b = net.addNode(120, 0, 0);
  const e = net.addEdge(a.id, b.id, { preset: p.id });
  const built = buildRoadSurface(e, net, sink, { step: 4, detail: 0 });
  if (!built) { fails++; console.log(`  FAIL  ${p.id} no ribbon`); continue; }
  buildMarkings(e, net, sink, built.ribbon, built.section, { trimStart: 0, trimEnd: 0 });
  placeProps(e, net, new PropSink(), built.ribbon, built.section, { detail: 0 });
  if (e.isRail()) buildTrack(e, net, sink, new PropSink(), built.ribbon, built.section, { crossings: [], detail: 0 });
  const tris = sink.triCount;
  if (tris < 10) { fails++; console.log(`  FAIL  ${p.id} only ${tris} tris`); continue; }
  console.log(`  ok    ${p.id.padEnd(20)} ${String(tris).padStart(6)} tris`);
  net.removeEdge(e.id); net.removeNode(a.id); net.removeNode(b.id);
}

/* ------------------------------------------------------------ 3. junctions */
console.log('\n[3] junction patches');
const jnet = new RoadNetwork();
{
  const configs = [
    ['cross 4-arm', [[1, 0], [-1, 0], [0, 1], [0, -1]]],
    ['T junction', [[1, 0], [-1, 0], [0.4, 0.9]]],
    ['Y junction', [[1, 0], [-0.5, 0.86], [-0.5, -0.86]]],
    ['elbow 90', [[1, 0], [0, 1]]],
    ['5-arm star', [[1, 0], [0.31, 0.95], [-0.81, 0.59], [-0.81, -0.59], [0.31, -0.95]]],
    ['bend 150', [[1, 0], [-0.86, 0.5]]],
  ];
  for (const [name, dirs] of configs) {
    const sink = new MeshSink();
    const c = jnet.addNode(0, 0, 0);
    for (const [dx, dz] of dirs) {
      const n = jnet.addNode(dx * 90, 0, dz * 90);
      jnet.addEdge(c.id, n.id, { preset: dx === 1 || dz === 1 ? 'arterial' : 'local_street' });
    }
    const cache = new Map();
    const mouths = junctionMouths(c, jnet, cache);
    const res = buildJunction(c, jnet, sink, { sections: cache, markings: true, detail: 0 });
    ok(name, !!res && sink.triCount > 6, `${sink.triCount} tris · mouths=[${[...mouths.values()].map((v) => v.toFixed(1)).join(', ')}]`);
    for (const id of [...jnet.edges.keys()]) jnet.removeEdge(id);
    jnet.removeNode(c.id);
  }
  // roundabout
  const sink = new MeshSink();
  const c = jnet.addNode(0, 0, 0);
  c.junction = { type: 'roundabout', outer: 26, width: 8, radius: 10 };
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const n = jnet.addNode(Math.cos(a) * 90, 0, Math.sin(a) * 90);
    jnet.addEdge(c.id, n.id, { preset: 'avenue' });
  }
  const r = buildJunction(c, jnet, sink, { sections: new Map(), markings: true, detail: 0 });
  ok('roundabout', !!r?.roundabout && sink.triCount > 20, `${sink.triCount} tris`);
}

/* -------------------------------------------------------- 4. city patterns */
console.log('\n[4] city generation');
const patterns = ['grid', 'radial', 'organic', 'highway', 'coastal'];
for (const pat of patterns) {
  const cn = new RoadNetwork();
  const t0 = performance.now();
  const st = generateCity(cn, { pattern: pat, extent: 2000, seed: 4242, railLines: 1, metroLines: 1 });
  const ms = performance.now() - t0;
  ok(pat, st.edges > 20 && st.nodes > 10,
    `${String(st.edges).padStart(5)} edges · ${String(st.nodes).padStart(5)} nodes · ${st.km.toFixed(1)} km · ${ms.toFixed(0)} ms`);

  // build the whole thing
  const sink = new MeshSink();
  const props = new PropSink();
  const terrain = new Terrain({ enabled: false, amplitude: 0 });
  const cache = new Map();
  const mouths = new Map();
  for (const n of cn.nodes.values()) {
    const m = junctionMouths(n, cn, cache);
    for (const [eid, d] of m) mouths.set(eid, Math.max(mouths.get(eid) || 0, d));
  }
  const cross = findCrossings(cn);
  let built = 0, err = 0;
  for (const e of cn.edges.values()) {
    try {
      const tr = mouths.get(e.id) || 0;
      const b = buildRoadSurface(e, cn, sink, { step: 4, detail: 0, terrain, mergeStart: tr, mergeEnd: tr });
      if (!b) continue;
      buildMarkings(e, cn, sink, b.ribbon, b.section, { trimStart: tr, trimEnd: tr });
      placeProps(e, cn, props, b.ribbon, b.section, { detail: 0, trimStart: tr, trimEnd: tr });
      if (e.isRail()) {
        e._ribbon = b.ribbon; e._section = b.section;
      }
      built++;
    } catch (ex) { err++; if (err < 3) console.log(`    ! ${e.id} ${ex.message}`); }
  }
  for (const n of cn.nodes.values()) {
    try { buildJunction(n, cn, sink, { sections: cache, markings: true, detail: 0 }); } catch (ex) { err++; if (err < 6) console.log(`    ! junction ${ex.message}`); }
  }
  let nan = 0;
  for (const [key, bk] of sink.buckets) {
    for (let i = 0; i < bk.pos.length; i++) if (!Number.isFinite(bk.pos[i])) { nan++; break; }
    if (nan) { fails++; console.log(`    ! NaN in bucket ${key}`); break; }
  }
  ok(`${pat} build`, err === 0 && built > 0 && nan === 0,
    `${built}/${cn.edges.size} edges · ${sink.triCount} tris · ${props.count} props · ${err} errors · ${cross.length} crossings`);
}

/* -------------------------------------------------------- 5. big map perf */
console.log('\n[5] large map (6 km grid)');
{
  const bn = new RoadNetwork();
  const t0 = performance.now();
  const st = generateCity(bn, { pattern: 'grid', extent: 6000, seed: 99, railLines: 1, metroLines: 1 });
  const tGen = performance.now() - t0;
  const t1 = performance.now();
  const sink = new MeshSink();
  const cache = new Map();
  const mouths = new Map();
  for (const n of bn.nodes.values()) {
    const m = junctionMouths(n, bn, cache);
    for (const [eid, d] of m) mouths.set(eid, Math.max(mouths.get(eid) || 0, d));
  }
  const tMouth = performance.now() - t1;
  const t2 = performance.now();
  let tri = 0;
  for (const e of bn.edges.values()) {
    const tr = mouths.get(e.id) || 0;
    const b = buildRoadSurface(e, bn, sink, { step: 4, detail: 0, mergeStart: tr, mergeEnd: tr });
    if (b) { buildMarkings(e, bn, sink, b.ribbon, b.section, { trimStart: tr, trimEnd: tr }); }
  }
  for (const n of bn.nodes.values()) buildJunction(n, bn, sink, { sections: cache, markings: true, detail: 0 });
  const tBuild = performance.now() - t2;
  console.log(`  ok    ${st.edges} edges · ${(st.km).toFixed(1)} km · gen ${tGen.toFixed(0)}ms · mouths ${tMouth.toFixed(0)}ms · build ${tBuild.toFixed(0)}ms`);
  console.log(`        ${(sink.triCount / 1e6).toFixed(2)}M tris · ${(sink.vertCount / 1e6).toFixed(2)}M verts · ~${((sink.vertCount * 8 * 4) / 1e6).toFixed(0)} MB`);
  ok('large map builds', sink.triCount > 100000);
}

/* -------------------------------------------------------- 6. prop geometry */
console.log('\n[6] props');
{
  const geos = buildPropGeometries();
  ok('prop geometries', geos.size >= 9, `${geos.size} types`);
  for (const [k, g] of geos) {
    const c = g.attributes.position?.count || 0;
    if (c < 3) { fails++; console.log(`  FAIL  ${k} empty`); }
  }
  console.log(`  ok    ${[...geos.keys()].join(', ')}`);
}

/* ------------------------------------------------------------- 7. terrain */
console.log('\n[7] terrain drape');
{
  const tn = new RoadNetwork();
  const terrain = new Terrain({ enabled: true, amplitude: 22, scale: 520 });
  const a = tn.addNode(0, 0, 0);
  const b = tn.addNode(300, 0, 0);
  const e = tn.addEdge(a.id, b.id, { preset: 'rural_road' });
  terrain.apply(tn);
  const sink = new MeshSink();
  const built = buildRoadSurface(e, tn, sink, { step: 4, detail: 0, terrain });
  const p0 = built.ribbon.point(0, 0, new THREE.Vector3());
  const p1 = built.ribbon.point(150, 0, new THREE.Vector3());
  const g0 = terrain.height(p0.x, p0.z), g1 = terrain.height(p1.x, p1.z);
  ok('road drapes on terrain', Math.abs(p0.y - g0) < 0.05 && Math.abs(p1.y - g1) < 0.05,
    `Δ ${Math.abs(p0.y - g0).toFixed(4)} / ${Math.abs(p1.y - g1).toFixed(4)}`);
}

console.log(`\n${fails === 0 ? 'ALL PASS' : `${fails} FAILURE(S)`}\n`);
process.exit(fails === 0 ? 0 : 1);
