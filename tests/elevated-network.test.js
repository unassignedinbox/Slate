import test from "node:test";
import assert from "node:assert/strict";
import {
  preset,
  addCurve,
  buildNetwork,
  validateModel,
  reconcileIntersections,
  snapRoadDrawingPoint,
  intersectionPaths,
  sampleRoad,
} from "../src/network.js";
import {
  heightOf,
  isElevated,
  roadElevation,
  liftRoad,
  landingRun,
} from "../src/road-elevation.js";
import { area } from "../src/streetscape.js";
import { TrafficSimulation } from "../src/traffic.js";
const empty = () => {
  const m = preset("empty");
  m.connections = [];
  m.nodes = [];
  m.roads = [];
  m.layers.landscape = false;
  return m;
};
function crossing(a = 0, b = 6) {
  const m = empty();
  addCurve(
    m,
    [
      [-60, 0],
      [60, 0],
    ],
    10,
    { elevation: a },
  );
  addCurve(
    m,
    [
      [0, -60],
      [0, 60],
    ],
    10,
    { elevation: b },
  );
  return m;
}
const degree = (m, id) =>
  m.roads.filter((r) => r.a === id || r.b === id).length;
test("Grade-separated crossings remain two independent graph edges", () => {
  const m = crossing();
  assert.equal(m.roads.length, 2);
  assert.equal(m.nodes.length, 4);
  assert.ok(m.nodes.every((n) => degree(m, n.id) === 1));
  const d = buildNetwork(m);
  assert.equal(d.groundSampled.length, 1);
  assert.equal(d.structures.filter((p) => p.kind === "road").length, 1);
  assert.ok(d.roadChecks.every((c) => Math.abs(c.clearance - 5.6) < 1e-8));
});
test("Two elevated roads form one shared four-way junction, with disjoint top patches", () => {
  const m = crossing(6, 6),
    d = buildNetwork(m),
    node = m.nodes.find((n) => degree(m, n.id) === 4);
  assert.ok(node);
  assert.equal(node.y, 6);
  assert.equal(m.roads.length, 4);
  assert.equal(d.groundSampled.length, 0);
  assert.equal(d.structures.filter((p) => p.id === node.id).length, 1);
  for (let i = 0; i < d.structures.length; i++)
    for (let j = i + 1; j < d.structures.length; j++)
      assert.ok(
        area(intersectionPaths(d.structures[i].paths, d.structures[j].paths)) <
          0.005,
        "top patches must not overlap",
      );
  assert.ok(
    d.structures.every((p) =>
      p.top.positions.every((v, i) => i % 3 !== 1 || Math.abs(v - 6.12) < 1e-7),
    ),
  );
});
test("Lowering an overpass reconnects the crossing instead of retaining a false overpass", () => {
  const m = crossing();
  liftRoad(m, m.roads.find((r) => isElevated(r, m)).id, 0);
  reconcileIntersections(m);
  assert.equal(m.roads.length, 4);
  assert.ok(m.nodes.some((n) => degree(m, n.id) === 4));
  assert.ok(!buildNetwork(m).structures);
});
test("Raising a shared junction raises incident ends and automatically makes approaches", () => {
  const m = crossing(0, 0),
    n = m.nodes.find((n) => degree(m, n.id) === 4);
  n.y = 6;
  assert.equal(m.roads.filter((r) => isElevated(r, m)).length, 4);
  const d = buildNetwork(m);
  for (const r of d.sampled) {
    assert.equal(
      roadElevation(r, m, r.a === n.id ? 0 : r.samples.lengthMeters),
      6,
    );
    assert.equal(
      roadElevation(r, m, r.a === n.id ? r.samples.lengthMeters : 0),
      0,
    );
    assert.ok(d.structures.some((p) => p.id === r.id));
  }
});
test("Vertical profiles have level landings and continuous first derivative", () => {
  const m = empty();
  addCurve(
    m,
    [
      [0, 0],
      [160, 0],
    ],
    10,
    { levels: [0, 6] },
  );
  const r = {
      ...m.roads[0],
      samples: sampleRoad(m.roads[0], m.nodes, m.roads),
    },
    L = r.samples.lengthMeters,
    a = landingRun(r, m),
    b = L - landingRun(r, m, 1);
  assert.equal(roadElevation(r, m, a), 0);
  assert.equal(roadElevation(r, m, b), 6);
  assert.ok(Math.abs(roadElevation(r, m, L / 2) - 3) < 1e-8);
  for (const s of [a, b])
    assert.ok(
      Math.abs(
        (roadElevation(r, m, s + 0.001) - roadElevation(r, m, s - 0.001)) /
          0.002,
      ) < 0.00001,
    );
});
test("Sloping deck roof, shell and underside contain finite 3D geometry", () => {
  const m = empty();
  addCurve(
    m,
    [
      [0, 0],
      [60, 20],
      [150, 0],
    ],
    10,
    { levels: [0, 6] },
  );
  const d = buildNetwork(m),
    p = d.structures.find((p) => p.kind === "road");
  assert.ok(p.top.indices.length > 100);
  assert.ok(p.shell.indices.length > 100);
  assert.ok([...p.top.positions, ...p.shell.positions].every(Number.isFinite));
  assert.ok(p.top.positions.some((y, i) => i % 3 === 1 && y > 1 && y < 5));
  assert.ok(Math.min(...p.shell.positions.filter((v, i) => i % 3 === 1)) < 0);
});
test("Curved elevated road crossings use their sampled alignment and compatible heights", () => {
  const m = empty();
  addCurve(
    m,
    [
      [-60, -20],
      [0, 20],
      [60, -20],
    ],
    10,
    { elevation: 6 },
  );
  addCurve(
    m,
    [
      [0, -50],
      [0, 60],
    ],
    10,
    { elevation: 6 },
  );
  const n = m.nodes.find((n) => degree(m, n.id) === 4);
  assert.ok(n);
  assert.ok(Math.abs(n.z - 20) < 0.02);
  assert.equal(n.y, 6);
});
test("Snapping selects the intended driving level, not the road below", () => {
  const m = crossing();
  const p = snapRoadDrawingPoint(m, [2, 0], 6);
  assert.ok(Math.abs(p[0]) < 0.02);
  assert.equal(p[2], 6);
  const ground = snapRoadDrawingPoint(m, [2, 1], 0);
  assert.ok(Math.abs(ground[1]) < 0.02);
  assert.equal(ground[2], 0);
});
test("Endpoint welding and collinear splitting avoid duplicate graph edges", () => {
  const m = empty();
  addCurve(
    m,
    [
      [-60, 0],
      [60, 0],
    ],
    10,
    { elevation: 6 },
  );
  addCurve(
    m,
    [
      [-40, 0],
      [20, 0],
    ],
    10,
    { elevation: 6 },
  );
  assert.equal(m.roads.length, 3);
  assert.ok(m.nodes.every((n) => degree(m, n.id) <= 2));
  const n = m.nodes.find((n) => n.x === -40);
  m.nodes.push({ ...n, id: "duplicate" });
  m.roads[0].a = "duplicate";
  reconcileIntersections(m);
  assert.ok(!m.nodes.some((n) => n.id === "duplicate"));
});
test("Low overpasses generate clearance warnings rather than becoming junctions", () => {
  const m = crossing(0, 2),
    d = buildNetwork(m);
  assert.equal(m.roads.length, 2);
  assert.ok(d.roadChecks.some((c) => Math.abs(c.clearance - 1.6) < 1e-8));
});
test("Bridge district is one connected project with more roads, real ramps and safe nominal crossings", () => {
  const m = preset("bridges"),
    d = buildNetwork(m);
  assert.equal(m.connections.length, 0);
  assert.ok(m.roads.length >= 36);
  assert.equal(m.roads.filter((r) => isElevated(r, m)).length, 8);
  const seen = new Set([m.nodes[0].id]);
  for (let i = 0; i < m.nodes.length; i++)
    for (const r of m.roads)
      if (seen.has(r.a) || seen.has(r.b)) {
        seen.add(r.a);
        seen.add(r.b);
      }
  assert.equal(seen.size, m.nodes.length);
  assert.ok(d.roadChecks.length > 0);
  assert.ok(d.roadChecks.every((c) => c.clearance >= 5));
  assert.ok(m.nodes.some((n) => n.y === 6 && degree(m, n.id) === 4));
});
test("AI spans ground and elevated graph edges, keeping the 25-car cap", () => {
  const m = preset("bridges"),
    sim = new TrafficSimulation(buildNetwork(m), m);
  sim.spawn(40);
  assert.equal(sim.cars.length, 25);
  assert.ok(sim.cars.some((c) => sim.pose(c).height > 5.9));
  assert.ok(sim.cars.some((c) => sim.pose(c).height === 0));
});
test("Vehicle height and pitch stay continuous over a ramp into a level bridge", () => {
  const m = empty();
  m.nodes = [
    { id: "a", x: -170, z: 0, y: 0 },
    { id: "b", x: -70, z: 0, y: 0 },
    { id: "c", x: 70, z: 0, y: 6 },
    { id: "d", x: 170, z: 0, y: 6 },
  ];
  m.roads = [
    { id: "ground", a: "a", b: "b", width: 10 },
    { id: "ramp", a: "b", b: "c", width: 10 },
    { id: "deck", a: "c", b: "d", width: 10 },
  ];
  const sim = new TrafficSimulation(buildNetwork(m), m, () => 0);
  sim.spawn(1);
  const car = sim.cars[0];
  car.leg = sim.legs.get("ramp:1");
  car.s = 0;
  car.speed = 8;
  let previous = sim.pose(car),
    crossed = false;
  for (let i = 0; i < 2200; i++) {
    sim.step(1 / 60);
    const p = sim.pose(car);
    assert.ok(Math.abs(p.height - previous.height) < 0.04);
    assert.ok(Math.abs(p.pitch - previous.pitch) < 0.015);
    if (car.leg.road?.id === "deck") crossed = true;
    previous = p;
  }
  assert.ok(crossed);
  assert.ok(Math.abs(previous.height - 6) < 1e-8);
});
test("Elevation JSON persists, accepts old projects and rejects malformed heights", () => {
  const m = preset("bridges"),
    saved = validateModel(JSON.parse(JSON.stringify(m)));
  assert.deepEqual(saved.nodes, m.nodes);
  assert.equal(heightOf({}), 0);
  for (const y of [-1, 41, NaN, "6"]) {
    const bad = structuredClone(m);
    bad.nodes[0].y = y;
    assert.throws(() => validateModel(bad), /elevation/);
  }
  assert.doesNotThrow(() => validateModel(preset("district")));
});
test("Ground-to-bridge junctions share the same ground alignment with rendering and traffic", () => {
  const m = empty();
  m.nodes = [
    { id: "a", x: -90, z: 0 },
    { id: "b", x: 0, z: 0 },
    { id: "c", x: 0, z: 90 },
    { id: "d", x: 90, z: 0, y: 6 },
  ];
  m.roads = [
    { id: "ab", a: "a", b: "b", width: 10 },
    { id: "bc", a: "b", b: "c", width: 10 },
    { id: "bd", a: "b", b: "d", width: 10 },
  ];
  const d = buildNetwork(m);
  for (const r of d.groundSampled)
    assert.deepEqual(r.samples, d.sampled.find((s) => s.id === r.id).samples);
});
