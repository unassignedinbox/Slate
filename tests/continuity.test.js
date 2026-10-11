import test from "node:test";
import assert from "node:assert/strict";
import {
  preset,
  buildNetwork,
  validateModel,
  addCurve,
} from "../src/network.js";
import { atStation, distance, sampleRoad } from "../src/alignment.js";
import {
  lanePath,
  roadLeg,
  connectorPath,
  TrafficSimulation,
} from "../src/traffic.js";
import {
  DEFAULT_HUMP,
  humpHeight,
  humpSpec,
  humpMesh,
} from "../src/traffic-calming.js";
function bend(reverse = false, width = 9) {
  const m = preset();
  m.nodes = [
    { id: "a", x: -70, z: 0 },
    { id: "b", x: 0, z: 0 },
    { id: "c", x: 0, z: 70 },
  ];
  m.roads = [
    { id: "ab", a: "a", b: "b", width: 9 },
    { id: "bc", a: reverse ? "c" : "b", b: reverse ? "b" : "c", width },
  ];
  return m;
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
for (const reverse of [false, true])
  test(`90-degree road bend has shared endpoint tangents, both lane directions (reversed storage=${reverse})`, () => {
    const m = bend(reverse),
      data = buildNetwork(m),
      [a, b] = data.sampled,
      dir = reverse ? -1 : 1;
    const ta = a.samples.tangents.at(-1),
      tb = b.samples.tangents[reverse ? b.samples.length - 1 : 0].map(
        (x) => x * dir,
      );
    assert.ok(dot(ta, tb) > 1 - 1e-10);
    assert.deepEqual(
      a.samples.at(-1),
      b.samples[reverse ? b.samples.length - 1 : 0],
    );
    for (const trafficDir of [-1, 1]) {
      const first = lanePath(a, trafficDir),
        second = lanePath(b, dir * trafficDir);
      const p = trafficDir > 0 ? first.at(-1) : first[0],
        q = trafficDir > 0 ? second[0] : second.at(-1);
      assert.ok(distance(p, q) < 1e-8);
    }
    const la = roadLeg(a, 1, m),
      lb = roadLeg(b, dir, m);
    assert.equal(connectorPath(la, lb), null);
  });
test("Width-changing bend tapers to one common seam width and lane position", () => {
  const m = bend(false, 14),
    [a, b] = buildNetwork(m).sampled;
  assert.equal(a.samples.widths.at(-1), 11.5);
  assert.equal(b.samples.widths[0], 11.5);
  assert.ok(distance(lanePath(a).at(-1), lanePath(b)[0]) < 1e-8);
});
test("Default district corners and split-polyline corners remain tangent continuous", () => {
  for (const m of [preset(), bend()]) {
    if (m.nodes.length === 3) {
      m.roads[0].points = [
        [-50, 0],
        [-25, 0],
        [-10, 0],
      ];
    }
    const d = buildNetwork(m);
    for (const n of m.nodes) {
      const incident = d.sampled.filter((r) => r.a === n.id || r.b === n.id);
      if (incident.length !== 2) continue;
      const outward = incident.map((r) => {
        const t = r.samples.tangents[r.a === n.id ? 0 : r.samples.length - 1];
        return t.map((v) => v * (r.a === n.id ? 1 : -1));
      });
      assert.ok(dot(...outward) < -0.999999);
    }
  }
});
test("Vehicle position and heading are continuous through the old snapping corner", () => {
  const m = bend(),
    sim = new TrafficSimulation(buildNetwork(m), m, () => 0);
  sim.spawn(1);
  const c = sim.cars[0];
  c.leg = sim.legs.get("ab:1");
  c.s = c.leg.path.lengthMeters - 2;
  c.speed = 4;
  let prev = sim.pose(c),
    crossed = false;
  for (let i = 0; i < 300; i++) {
    sim.step(1 / 60);
    const p = sim.pose(c);
    assert.ok(distance([p.x, p.z], [prev.x, prev.z]) < 0.17, "no teleport");
    assert.ok(p.dx * prev.dx + p.dz * prev.dz > 0.999, "no orientation snap");
    if (c.leg.key === "bc:1") crossed = true;
    prev = p;
  }
  assert.ok(crossed);
});
test("Junction connectors match incoming and outgoing positions and tangents", () => {
  const m = preset("junction"),
    d = buildNetwork(m);
  const a = roadLeg(d.sampled[0], -1, m),
    b = roadLeg(d.sampled[2], 1, m),
    path = connectorPath(a, b);
  assert.ok(path);
  const x = atStation(a.path, a.path.lengthMeters),
    y = atStation(b.path, 0);
  assert.ok(distance(path[0], [x.x, x.z]) < 1e-9);
  assert.ok(distance(path.at(-1), [y.x, y.z]) < 1e-9);
  assert.ok(dot(path.tangents[0], [x.dx, x.dz]) > 1 - 1e-9);
  assert.ok(dot(path.tangents.at(-1), [y.dx, y.dz]) > 1 - 1e-9);
});
test("Terminal roads stop vehicles instead of instant U-turns", () => {
  const m = bend(),
    sim = new TrafficSimulation(buildNetwork(m), m);
  sim.spawn(1);
  const c = sim.cars[0];
  c.leg = sim.legs.get("bc:1");
  c.s = c.leg.path.lengthMeters - 0.1;
  c.speed = 4;
  for (let i = 0; i < 200; i++) sim.step(1 / 60);
  assert.equal(c.leg.key, "bc:1");
  assert.ok(c.s <= c.leg.path.lengthMeters);
  assert.ok(c.speed < 0.01);
});
test("Speed hump is actual 75 mm raised geometry with flush, flat-slope ends", () => {
  const m = bend();
  m.roads[0].speedHump = { ...DEFAULT_HUMP };
  const r = buildNetwork(m).sampled[0],
    h = humpSpec(r, m),
    mesh = humpMesh(r, m);
  assert.ok(h);
  assert.equal(humpHeight(h.center, h), 0.075);
  for (const sign of [-1, 1]) {
    const end = h.center + (sign * h.length) / 2;
    assert.equal(humpHeight(end, h), 0);
    assert.ok(humpHeight(end - sign * 0.001, h) < 1e-7);
  }
  assert.ok(
    Math.abs(
      Math.max(...mesh.positions.filter((_, i) => i % 3 === 1)) - 0.195,
    ) < 1e-9,
  );
  assert.ok(mesh.positions.every(Number.isFinite));
  assert.equal(mesh.indices.length, 64 * 24 * 6);
  assert.ok(mesh.paintIndices.length > 0);
});
test("Speed hump vehicle slowdown, vertical response and visibility use the same profile", () => {
  const m = bend();
  m.roads[0].speedHump = { ...DEFAULT_HUMP };
  const sim = new TrafficSimulation(buildNetwork(m), m, () => 0);
  sim.spawn(1);
  const c = sim.cars[0];
  c.leg = sim.legs.get("ab:1");
  const h = humpSpec(c.leg.road, m);
  c.s = h.center - 5;
  c.speed = m.speed / 3.6;
  const before = c.speed;
  sim.step(0.1);
  assert.ok(c.speed < before);
  c.s = h.center;
  assert.ok(sim.pose(c).height > 0);
  m.layers.calming = false;
  assert.equal(sim.pose(c).height, 0);
  assert.equal(humpMesh(c.leg.road, m), null);
});
test("Speed hump serialization validates bounds and suppresses unsafe short approaches", () => {
  const m = bend();
  m.roads[0].speedHump = { ...DEFAULT_HUMP };
  assert.deepEqual(
    validateModel(JSON.parse(JSON.stringify(m))).roads[0].speedHump,
    DEFAULT_HUMP,
  );
  m.roads[0].speedHump.height = 1;
  assert.throws(() => validateModel(m));
  m.roads[0].speedHump = { ...DEFAULT_HUMP };
  m.nodes[0].x = -12;
  assert.equal(humpSpec(m.roads[0], m), null);
});
test("Crossing split never duplicates the parent road speed hump", () => {
  const m = bend();
  m.roads[0].speedHump = { ...DEFAULT_HUMP, position: 0.3 };
  addCurve(m, [
    [-35, -40],
    [-35, 40],
  ]);
  assert.equal(m.roads.filter((r) => r.speedHump).length, 1);
});
