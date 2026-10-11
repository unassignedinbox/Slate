// Engine tests: geometry quality, junction topology, traffic cap, textures, serialisation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDemoDoc, emptyDoc, addJunction, addRoad, patchJunction, serialize, deserialize, removeJunction } from '../src/engine/network.js';
import { buildScene, buildPaths } from '../src/engine/roadGeometry.js';
import { Traffic, MAX_VEHICLES } from '../src/engine/traffic.js';
import { buildCarModel } from '../src/engine/carModel.js';
import { packStacks, LAYER_TYPES, newLayer } from '../src/engine/textures.js';
import { sunState } from '../src/engine/sun.js';
import { lookAt, perspective, mul, invert } from '../src/engine/math.js';
import { toScreen, rayFromPixel, groundHit } from '../src/render/picking.js';

const demo = () => buildScene(createDemoDoc());

test('demo network builds with no topology warnings and finite data', () => {
  const s = demo();
  assert.equal(s.stats.warnings.length, 0, JSON.stringify(s.stats.warnings));
  assert.ok(s.stats.quads > 50000, `quads ${s.stats.quads}`);
  assert.equal(s.data.length % 27, 0, 'whole triangles');
  for (let i = 0; i < s.data.length; i++) assert.ok(Number.isFinite(s.data[i]), `non-finite at ${i}`);
});

test('no zero-area triangles are emitted', () => {
  const d = demo().data;
  let zero = 0;
  for (let i = 0; i < d.length; i += 27) {
    const ax = d[i + 9] - d[i], ay = d[i + 10] - d[i + 1], az = d[i + 11] - d[i + 2];
    const bx = d[i + 18] - d[i], by = d[i + 19] - d[i + 1], bz = d[i + 20] - d[i + 2];
    const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
    if (Math.hypot(cx, cy, cz) < 1e-9) zero++;
  }
  assert.equal(zero, 0);
});

test('demo network has one hub per junction node', () => {
  const s = buildScene(createDemoDoc());
  assert.equal(s.stats.junctions, Object.keys(createDemoDoc().junctions).length);
});

test('moving a junction moves the road ends that touch it', () => {
  const doc = createDemoDoc();
  const before = buildPaths(doc);
  const moved = patchJunction(doc, 'J1', { p: [doc.junctions.J1.p[0] + 10, 0, doc.junctions.J1.p[2]] });
  const after = buildPaths(moved);
  const roadsAtJ1 = Object.values(doc.roads).filter((r) => r.a === 'J1');
  assert.ok(roadsAtJ1.length > 0);
  const r = roadsAtJ1[0].id;
  assert.ok(Math.abs(after[r].pts[0][0] - before[r].pts[0][0] - 10) < 1e-6);
});

test('spline drawing: waypoints are passed through by the centreline', () => {
  let doc = emptyDoc();
  let r = addJunction(doc, [0, 0, 0], 'A'); doc = r.doc; const a = r.id;
  r = addJunction(doc, [200, 0, 0], 'B'); doc = r.doc; const b = r.id;
  const wp = [100, 0, 40];
  r = addRoad(doc, a, b, [wp], 'arterial'); doc = r.doc;
  const p = buildPaths(doc)[r.id];
  let best = Infinity;
  for (const q of p.pts) best = Math.min(best, Math.hypot(q[0] - wp[0], q[2] - wp[2]));
  assert.ok(best < 0.6, `spline misses waypoint by ${best}`);
});

test('dead-end road has no fan triangles outside its cap', () => {
  let doc = emptyDoc();
  let r = addJunction(doc, [0, 0, 0], 'A'); doc = r.doc; const a = r.id;
  r = addJunction(doc, [60, 0, 0], 'B'); doc = r.doc; const b = r.id;
  r = addRoad(doc, a, b, [], 'local'); doc = r.doc;
  const s = buildScene(doc);
  assert.equal(s.stats.warnings.length, 0);
  // Every hub triangle's centroid lies within the road's extent plus its width.
  const d = s.data;
  for (let i = 0; i < d.length; i += 27) {
    const mat = d[i + 6];
    if (mat !== 1) continue;
    const cx = (d[i] + d[i + 9] + d[i + 18]) / 3;
    assert.ok(cx > -20 && cx < 80, `asphalt outside extent at x=${cx}`);
  }
});

test('traffic is capped at 25 vehicles and stays on the network', () => {
  const doc = { ...createDemoDoc(), traffic: { count: 60, speed: 1, seed: 3 } };
  const s = buildScene(doc);
  const tr = new Traffic(3);
  tr.sync(doc, s.paths);
  assert.equal(tr.cars.length, MAX_VEHICLES);
  for (let i = 0; i < 1800; i++) tr.update(1 / 30, doc, s.paths);
  const inst = tr.instances(doc, s.paths);
  assert.equal(inst.length, MAX_VEHICLES);
  for (const c of inst) for (const v of c.m) assert.ok(Number.isFinite(v));
  for (const c of tr.cars) assert.ok(s.paths[c.road], 'car on a road that exists');
});

test('traffic off in the Display settings removes all vehicles', () => {
  const doc = { ...createDemoDoc(), vis: { ...createDemoDoc().vis, traffic: false } };
  const s = buildScene(doc);
  const tr = new Traffic(1);
  tr.sync(doc, s.paths);
  assert.equal(tr.cars.length, 0);
});

test('car model is finite and has the expected material ids', () => {
  const m = buildCarModel();
  assert.equal(m.length % 9, 0);
  const mats = new Set();
  for (let i = 0; i < m.length; i += 9) {
    mats.add(m[i + 6]);
    for (let k = 0; k < 9; k++) assert.ok(Number.isFinite(m[i + k]));
  }
  assert.ok(mats.has(20), 'car paint');
  assert.ok(mats.has(16), 'tyre');
});

test('texture packing matches the shader layout and layer ids', () => {
  const doc = createDemoDoc();
  const packed = packStacks(doc.stacks);
  assert.equal(packed.length, 2 * 8 * 16);
  // Enabled layers in order carry the LAYER_TYPES id in their first float.
  const ids = doc.stacks.asphalt.map((L) => LAYER_TYPES.findIndex((t) => t.key === L.key));
  ids.forEach((id, i) => assert.equal(packed[i * 16], id));
  assert.deepEqual(LAYER_TYPES.map((t) => t.id), LAYER_TYPES.map((_, i) => i));
  assert.equal(newLayer('bricks').p.length, 4);
});

test('sun direction is unit length and sets daylight', () => {
  for (const t of [0, 6, 9, 12, 17, 22]) {
    const s = sunState(t);
    const len = Math.hypot(...s.sunDir);
    assert.ok(Math.abs(len - 1) < 1e-6);
  }
  assert.equal(sunState(2).sunIntensity, 0);
  assert.ok(sunState(12).sunIntensity > 1);
});

test('camera projection round-trips through screen picking', () => {
  const eye = [100, 200, 300], target = [10, 0, -20];
  const vp = mul(perspective(0.66, 1.6, 0.5, 6000), lookAt(eye, target, [0, 1, 0]));
  const c = toScreen(vp, target, 800, 600);
  assert.ok(Math.abs(c[0] - 400) < 1e-3 && Math.abs(c[1] - 300) < 1e-3);
  const inv = invert(vp);
  const hit = groundHit(rayFromPixel(inv, 123, 456, 800, 600), 0);
  const back = toScreen(vp, hit, 800, 600);
  assert.ok(Math.abs(back[0] - 123) < 0.05 && Math.abs(back[1] - 456) < 0.05, 'round trip within 0.05 px');
});

test('serialise / deserialise round-trips the document', () => {
  const doc = createDemoDoc();
  const back = deserialize(serialize(doc));
  assert.deepEqual(back.junctions, doc.junctions);
  assert.deepEqual(back.roads, doc.roads);
  assert.throws(() => deserialize('{"hello":1}'));
});

test('removing a junction removes its roads', () => {
  const doc = createDemoDoc();
  const next = removeJunction(doc, 'J1');
  for (const r of Object.values(next.roads)) assert.ok(r.a !== 'J1' && r.b !== 'J1');
});
