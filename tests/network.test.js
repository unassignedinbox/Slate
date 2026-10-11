import test from "node:test";
import assert from "node:assert/strict";
import ClipperLib from "clipper-lib";
import {
  preset,
  buildNetwork,
  addCurve,
  validateModel,
  sampleRoad,
  moveJunction,
} from "../src/network.js";
const area = (paths) =>
  Math.abs(paths.reduce((s, p) => s + ClipperLib.Clipper.Area(p) / 1e6, 0));
const triangleArea = (d) => {
  let area = 0;
  for (let i = 0; i < d.indices.length; i += 3) {
    const [a, b, c] = d.indices.slice(i, i + 3).map((v) => v * 3);
    area +=
      Math.abs(
        (d.positions[b] - d.positions[a]) *
          (d.positions[c + 2] - d.positions[a + 2]) -
          (d.positions[b + 2] - d.positions[a + 2]) *
            (d.positions[c] - d.positions[a]),
      ) / 2;
  }
  return area;
};
for (const kind of ["district", "junction", "fork"])
  test(`${kind}: finite, nondegenerate, upward-wound mesh; hole-preserving union area`, () => {
    const m = preset(kind),
      d = buildNetwork(m);
    assert.ok(d.mesh.indices.length);
    assert.ok(d.mesh.positions.every(Number.isFinite));
    assert.ok(Math.abs(triangleArea(d.mesh) - area(d.surface)) < 0.001);
    for (let i = 0; i < d.mesh.indices.length; i += 3) {
      const [a, b, c] = d.mesh.indices.slice(i, i + 3).map((v) => v * 3);
      const signed =
        (d.mesh.positions[b] - d.mesh.positions[a]) *
          (d.mesh.positions[c + 2] - d.mesh.positions[a + 2]) -
        (d.mesh.positions[b + 2] - d.mesh.positions[a + 2]) *
          (d.mesh.positions[c] - d.mesh.positions[a]);
      assert.ok(signed < 0, "upward winding and no zero area triangles");
    }
  });
test("Orthogonal crossing is one union, not two overlapping surfaces", () => {
  const m = preset("junction");
  m.radius = 0;
  const d = buildNetwork(m);
  assert.equal(d.surface.length, 1);
  assert.ok(Math.abs(area(d.surface) - (165 * 12 + 150 * 12 - 144)) < 0.001);
});
test("Acute Y junctions maintain valid union area across 10–70 degrees", () => {
  for (const angle of [10, 15, 20, 30, 45, 70]) {
    const m = preset("fork");
    m.roads.forEach((r) => delete r.control);
    m.nodes[1].x = -90;
    m.nodes[1].z = 0;
    m.nodes[2].x = 90;
    m.nodes[2].z = 0;
    m.nodes[3].x = 90 * Math.cos((angle * Math.PI) / 180);
    m.nodes[3].z = 90 * Math.sin((angle * Math.PI) / 180);
    const d = buildNetwork(m);
    assert.ok(Math.abs(triangleArea(d.mesh) - area(d.surface)) < 0.01);
    assert.ok(d.mesh.positions.every(Number.isFinite));
  }
});
test("Moving one shared junction updates every incident road", () => {
  const m = preset("junction"),
    n = m.nodes[0];
  n.x = 13;
  n.z = 27;
  for (const r of m.roads) {
    const s = sampleRoad(r, m.nodes);
    assert.deepEqual(s[0], [13, 27]);
  }
  assert.ok(buildNetwork(m).mesh.indices.length);
});
test("New crossing splits both roads and shares a four-way graph vertex", () => {
  const m = preset();
  m.nodes = [
    { id: "a", x: -50, z: 0 },
    { id: "b", x: 50, z: 0 },
  ];
  m.roads = [{ id: "r", a: "a", b: "b", width: 10 }];
  addCurve(m, [
    [0, -50],
    [0, 50],
  ]);
  assert.equal(m.roads.length, 4);
  const center = m.nodes.find((n) => n.x === 0 && n.z === 0);
  assert.ok(center);
  assert.equal(
    m.roads.filter((r) => r.a === center.id || r.b === center.id).length,
    4,
  );
  const d = buildNetwork(m);
  assert.equal(d.surface.length, 1);
});
test("Empty networks are valid", () => {
  const m = preset();
  m.roads = [];
  m.nodes = [];
  const d = buildNetwork(m);
  assert.equal(d.mesh.indices.length, 0);
  assert.equal(d.length, 0);
});
test("Imported projects reject invalid geometry and clamp traffic", () => {
  const m = preset();
  m.traffic = 1000;
  assert.equal(validateModel(m).traffic, 25);
  m.nodes[0].x = Infinity;
  assert.throws(() => validateModel(m));
  const m2 = preset();
  m2.roads[0].a = "missing";
  assert.throws(() => validateModel(m2));
});
test("Sidewalk area is outside asphalt, not a duplicate deck", () => {
  const d = buildNetwork(preset());
  assert.ok(area(d.walk) > 0);
  assert.ok(area(d.walkOuter) > area(d.surface));
});

test("Moving sampled road endpoints smoothly deforms attached points", () => {
  const m = preset("junction");
  const r = m.roads[0];
  r.points = [
    [-20, 0],
    [-40, 0],
    [-60, 0],
  ];
  moveJunction(m, m.nodes[0].id, 0, 20);
  assert.deepEqual(r.points, [
    [-20, 15],
    [-40, 10],
    [-60, 5],
  ]);
  assert.deepEqual(sampleRoad(r, m.nodes)[0], [0, 20]);
});
test("Import rejects unsafe material values and unsupported layer keys", () => {
  const m = preset();
  m.materials.asphalt = '\" onmouseover=alert(1)';
  assert.throws(() => validateModel(m));
  const other = preset();
  other.layers.unknown = true;
  assert.throws(() => validateModel(other));
});
