import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  preset,
  buildNetwork,
  addCurve,
  validateModel,
  intersectionPaths,
} from "../src/network.js";
import { area, buildStreetscape, containsPoint } from "../src/streetscape.js";
import { localMesh } from "../src/local-mesh.js";
import {
  bridgeGeometry,
  snapConnection,
  moveConnectionEnd,
} from "../src/connections.js";
function fixture() {
  const m = preset();
  m.nodes = [
    { id: "a", x: 0, z: -100 },
    { id: "b", x: 0, z: 100 },
  ];
  m.roads = [{ id: "main", a: "a", b: "b", width: 12 }];
  m.connections = [];
  return m;
}
const bridge = () => ({
  id: "bridge",
  kind: "bridge",
  width: 4.5,
  height: 5.5,
  points: [
    [-85, 0],
    [0, 0],
    [85, 0],
  ],
});
function meshArea(g) {
  let area = 0;
  for (let i = 0; i < g.indices.length; i += 3) {
    const [a, b, c] = g.indices
      .slice(i, i + 3)
      .map((j) => new THREE.Vector3(...g.positions.slice(j * 3, j * 3 + 3)));
    area += b.sub(a).cross(c.sub(a)).y / 2;
  }
  return area;
}
test("Default district pavement uses bounded local triangles instead of block-spanning slivers", () => {
  const m = preset(),
    s = buildStreetscape(m, buildNetwork(m)),
    g = localMesh(s.walk, 0.27);
  assert.ok(
    Math.abs(meshArea(g) - area(s.walk)) < 0.04,
    "1 mm boundary clipping tolerance",
  );
  for (let i = 0; i < g.indices.length; i += 3)
    for (let j = 0; j < 3; j++) {
      const a = g.indices[i + j] * 3,
        b = g.indices[i + ((j + 1) % 3)] * 3;
      assert.ok(
        Math.hypot(
          g.positions[a] - g.positions[b],
          g.positions[a + 2] - g.positions[b + 2],
        ) <=
          Math.SQRT2 * 6 + 0.0001,
      );
    }
  assert.ok(g.positions.every(Number.isFinite));
});
test("Park walkway snaps to back of pavement and unions into it without duplicate road coverage", () => {
  const m = fixture(),
    p = snapConnection([-9, -35], m, "walkway");
  assert.ok(Math.abs(p[0] + 8.47) < 0.001);
  m.connections = [
    {
      id: "walk",
      kind: "walkway",
      width: 2.5,
      points: [p, [-40, -35], [-80, -35]],
    },
  ];
  const d = buildNetwork(m);
  assert.equal(d.connectionWarnings.length, 0);
  assert.ok(containsPoint(d.walk, -8.5, -35));
  assert.ok(containsPoint(d.walk, -70, -35));
  assert.equal(area(intersectionPaths(d.walk, d.surface)), 0);
  m.layers.walkways = false;
  assert.ok(!containsPoint(buildNetwork(m).walk, -70, -35));
});
test("A walkway across the carriageway is rejected rather than hiding asphalt", () => {
  const m = fixture();
  m.connections = [
    {
      id: "bad",
      kind: "walkway",
      width: 2.5,
      points: [
        [-30, 0],
        [30, 0],
      ],
    },
  ];
  const d = buildNetwork(m);
  assert.equal(d.walkwayPaths.length, 0);
  assert.equal(d.connectionWarnings.length, 1);
});
test("Concrete access is a real shared graph junction with an exclusive concrete footprint", () => {
  const m = fixture(),
    start = snapConnection([2, 40], m, "concrete");
  addCurve(m, [start, [40, 40], [80, 40]], 5, { surface: "concrete" });
  const d = buildNetwork(m);
  assert.equal(m.roads.length, 3);
  const junction = m.nodes.find(
    (n) => Math.abs(n.x) < 0.01 && Math.abs(n.z - 40) < 0.01,
  );
  assert.equal(
    m.roads.filter((r) => r.a === junction.id || r.b === junction.id).length,
    3,
  );
  assert.ok(containsPoint(d.concreteSurface, 40, 40));
  assert.ok(!containsPoint(d.concreteSurface, 0, 40));
});
test("Bridge is vehicle-width, closed, has grounded ends and clearance over the road", () => {
  const m = fixture(),
    b = bridgeGeometry(bridge(), buildNetwork(m));
  assert.ok(b.valid);
  assert.ok(b.grade < 1 / 12);
  assert.equal(b.frames[0].y, 0.27);
  assert.equal(b.frames.at(-1).y, 0.27);
  for (const p of b.frames.filter((p) => Math.abs(p.x) <= 9))
    assert.ok(p.y - 0.35 - 0.12 >= 5);
  assert.ok(b.width >= 4.8);
  assert.ok(b.positions.every(Number.isFinite));
  const edges = new Map();
  for (let i = 0; i < b.indices.length; i += 3) {
    const v = b.indices.slice(i, i + 3).map((j) =>
      b.positions
        .slice(j * 3, j * 3 + 3)
        .map((v) => v.toFixed(6))
        .join(","),
    );
    for (let k = 0; k < 3; k++) {
      const key = [v[k], v[(k + 1) % 3]].sort().join("|");
      edges.set(key, (edges.get(key) || 0) + 1);
    }
  }
  assert.ok(
    [...edges.values()].every((n) => n === 2),
    "all geometric edges paired",
  );
});
test("Bridge reports steep approaches and prevents endpoints inside the road", () => {
  const m = fixture(),
    d = buildNetwork(m),
    c = bridge();
  c.points = [
    [-30, 0],
    [30, 0],
  ];
  assert.ok(bridgeGeometry(c, d).warnings.some((w) => w.includes("Steep")));
  c.points = [
    [0, 0],
    [50, 0],
  ];
  assert.equal(bridgeGeometry(c, d).valid, false);
});
test("Park connection settings and endpoint edits survive validated serialization", () => {
  const m = fixture(),
    c = bridge();
  m.connections = [c];
  moveConnectionEnd(c, 1, 90, 10);
  assert.deepEqual(c.points[0], [-85, 0]);
  assert.deepEqual(c.points.at(-1), [90, 10]);
  assert.deepEqual(
    validateModel(JSON.parse(JSON.stringify(m))).connections,
    m.connections,
  );
  c.width = 2;
  assert.throws(() => validateModel(m));
  delete m.connections;
  assert.deepEqual(validateModel(m).connections, []);
});

test("Park demo has connected footways and a non-steep bridge with no placement warnings", () => {
  const m = validateModel(preset("parks")),
    d = buildNetwork(m),
    b = bridgeGeometry(
      m.connections.find((c) => c.kind === "bridge"),
      d,
    );
  assert.equal(d.connectionWarnings.length, 0);
  assert.ok(b.valid);
  assert.equal(b.warnings.length, 0);
  assert.equal(m.connections.filter((c) => c.kind === "walkway").length, 2);
  assert.ok(containsPoint(d.walk, -8.5, -55));
  assert.ok(containsPoint(d.walk, 8.5, -55));
});
test("A bridge too low for the preview cars is suppressed", () => {
  const m = fixture(),
    c = bridge();
  c.height = 1;
  const b = bridgeGeometry(c, buildNetwork(m));
  assert.equal(b.valid, false);
  assert.ok(b.warnings.some((w) => w.includes("too low")));
});
test("Float32 pavement triangles remain front-facing and cover district contour samples", () => {
  const m = preset(),
    s = buildStreetscape(m, buildNetwork(m)),
    g = localMesh(s.walk, 0.27),
    geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(g.positions, 3),
  );
  geometry.setIndex(g.indices);
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ side: THREE.FrontSide }),
  );
  mesh.updateMatrixWorld(true);
  let checked = 0;
  for (const path of s.walk)
    for (let i = 0; i < path.length; i += 50) {
      const a = path[i],
        b = path[(i + 1) % path.length],
        dx = (b.X - a.X) / 1000,
        dz = (b.Y - a.Y) / 1000,
        length = Math.hypot(dx, dz);
      if (length < 0.001) continue;
      for (const side of [-1, 1]) {
        const x = (a.X + b.X) / 2000 - (dz / length) * 0.45 * side,
          z = (a.Y + b.Y) / 2000 + (dx / length) * 0.45 * side;
        if (!containsPoint(s.walk, x, z)) continue;
        const ray = new THREE.Raycaster(
          new THREE.Vector3(x, 2, z),
          new THREE.Vector3(0, -1, 0),
          0,
          3,
        );
        assert.ok(
          ray.intersectObject(mesh).length,
          `Pavement hole at ${x},${z}`,
        );
        checked++;
      }
    }
  assert.ok(checked > 50);
  geometry.dispose();
  mesh.material.dispose();
});
