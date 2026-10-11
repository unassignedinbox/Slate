import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  preset,
  buildNetwork,
  validateModel,
  addCurve,
} from "../src/network.js";
import {
  buildStreetscape,
  pathOf,
  rampPoint,
  rampHeight,
  pavementHeight,
  area,
  intersection,
} from "../src/streetscape.js";
import { slabShell } from "../src/slab-shell.js";
import { flyDisplacement } from "../src/free-camera.js";
import { DEFAULT_DRIVEWAY } from "../src/street-settings.js";
function renderMesh(d) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(d.positions, 3));
  g.setIndex(d.indices);
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(
    g,
    new THREE.MeshBasicMaterial({ side: THREE.FrontSide }),
  );
  mesh.updateMatrixWorld();
  return mesh;
}
const ring = [
  pathOf([
    [-2, -2],
    [2, -2],
    [2, 2],
    [-2, 2],
  ]),
  pathOf([
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]).reverse(),
];
test("Curb road-facing holes and block-facing outer walls are visible with FrontSide culling", () => {
  const mesh = renderMesh(slabShell(ring, () => 0.27));
  for (const [origin, dir, expected] of [
    [[0, 0.2, 0], [1, 0, 0], 1],
    [[3, 0.2, 0], [-1, 0, 0], 1],
    [[0, 0.2, -3], [0, 0, 1], 1],
    [[0, 0.2, 0], [0, 0, -1], 1],
  ]) {
    const ray = new THREE.Raycaster(
      new THREE.Vector3(...origin),
      new THREE.Vector3(...dir),
    );
    const hits = ray.intersectObject(mesh);
    assert.ok(hits.length, "no missing/backward face");
    assert.ok(Math.abs(hits[0].distance - expected) < 1e-5);
    assert.ok(hits[0].face.normal.dot(ray.ray.direction) < -0.99);
  }
});
test("Slab underside closes the volume and retains the road opening", () => {
  const mesh = renderMesh(slabShell(ring, () => 0.27));
  const under = new THREE.Raycaster(
    new THREE.Vector3(1.5, -1, 0),
    new THREE.Vector3(0, 1, 0),
  );
  assert.ok(Math.abs(under.intersectObject(mesh)[0].distance - 0.8) < 1e-5);
  const hole = new THREE.Raycaster(
    new THREE.Vector3(0, -1, 0),
    new THREE.Vector3(0, 1, 0),
  );
  assert.equal(hole.intersectObject(mesh).length, 0);
});
test("Unreal-style forward, strafe, world vertical and sprint do not speed up diagonally", () => {
  const camera = new THREE.PerspectiveCamera();
  camera.rotation.set(0.3, 0.6, 0, "YXZ");
  for (const keys of [["KeyW"], ["KeyD"], ["KeyQ"], ["KeyW", "KeyD"]])
    assert.ok(
      Math.abs(flyDisplacement(camera, new Set(keys), 1, 12).length() - 12) <
        1e-8,
    );
  assert.equal(flyDisplacement(camera, new Set(["KeyE"]), 1, 12).y, 12);
  assert.equal(flyDisplacement(camera, new Set(["KeyQ"]), 1, 12).y, -12);
  assert.ok(
    Math.abs(
      flyDisplacement(camera, new Set(["KeyW", "ShiftLeft"]), 1, 12).length() -
        48,
    ) < 1e-8,
  );
  assert.equal(
    flyDisplacement(camera, new Set(["KeyW", "KeyS"]), 1, 12).length(),
    0,
  );
});
test("Auto pedestrian layout uses a dropped parallel landing on the existing 2.4 m sidewalk", () => {
  const m = preset("junction"),
    d = buildNetwork(m),
    s = buildStreetscape(m, d);
  assert.equal(s.ramps.length, 8);
  assert.ok(s.ramps.every((r) => r.kind === "parallel"));
  for (const r of s.ramps) {
    assert.ok(r.depth >= 1.22);
    assert.ok(r.run >= 1.8);
    for (const v of [0, 0.7, r.depth])
      assert.ok(Math.abs(rampHeight(r, ...rampPoint(r, 0, v)) - 0.12) < 1e-6);
    for (const sign of [-1, 1])
      assert.ok(
        Math.abs(
          rampHeight(r, ...rampPoint(r, sign * (r.half + r.run), 0.7)) - 0.27,
        ) < 1e-5,
      );
  }
  // A ray from the road at 10 mm above the deck must pass through the curb cut.
  const r = s.ramps[0],
    p = rampPoint(r, 0, -0.3),
    dir = new THREE.Vector3(-r.p.dz * r.side, 0, r.p.dx * r.side),
    shell = renderMesh(slabShell(d.curb, (x, z) => pavementHeight(s, x, z)));
  const ray = new THREE.Raycaster(
    new THREE.Vector3(p[0], 0.13, p[1]),
    dir,
    0,
    0.55,
  );
  assert.equal(ray.intersectObject(shell).length, 0);
});
test("Perpendicular pedestrian ramps use 1:12 runs, 1:10 flares and a retained landing", () => {
  const m = preset("junction");
  m.sidewalk = 3.2;
  const s = buildStreetscape(m, buildNetwork(m));
  assert.equal(s.ramps.length, 8);
  assert.ok(
    s.ramps.every(
      (r) =>
        r.kind === "perpendicular" &&
        0.15 / r.run <= 1 / 12 + 0.0001 &&
        0.15 / r.flare <= 0.1 &&
        m.sidewalk + 0.22 - r.run >= 1.22,
    ),
  );
});
test("Forced perpendicular mode rejects an undersized landing instead of building a steep/wedged ramp", () => {
  const m = preset("junction");
  m.streets.pedestrianMode = "perpendicular";
  const s = buildStreetscape(m, buildNetwork(m));
  assert.equal(s.ramps.length, 0);
  assert.ok(s.warnings.some((w) => w.includes("top landing")));
});
test("Vehicle crossover is separate, flush, non-tactile and preserves a level rear footway", () => {
  const m = preset("junction");
  m.sidewalk = 3.2;
  m.roads[0].driveway = { ...DEFAULT_DRIVEWAY };
  const s = buildStreetscape(m, buildNetwork(m));
  assert.equal(s.driveways.length, 1);
  assert.equal(s.tactiles.length, s.ramps.length);
  const r = s.driveways[0];
  assert.equal(r.kind, "vehicle");
  assert.ok(m.sidewalk + 0.22 - r.run >= 1.22);
  for (const [v, y] of [
    [0, 0.12],
    [r.run / 2, 0.195],
    [r.run, 0.27],
    [r.run + 0.6, 0.27],
  ])
    assert.ok(Math.abs(pavementHeight(s, ...rampPoint(r, 0, v)) - y) < 1e-6);
  assert.ok(s.vehicleRamp.indices.length > 0);
  for (const g of s.grates.filter(
    (g) => g.road === r.roadId && g.side === r.side,
  ))
    assert.ok(Math.abs(g.s - r.s) > r.half + r.flare + 4);
});
test("Turning off vehicle entries restores the original pavement; invalid sites are explicit", () => {
  const m = preset("junction");
  m.roads[0].driveway = { ...DEFAULT_DRIVEWAY };
  let s = buildStreetscape(m, buildNetwork(m));
  assert.equal(s.driveways.length, 0);
  assert.ok(s.warnings.some((w) => w.includes("Vehicle crossover needs")));
  m.sidewalk = 3.2;
  m.layers.driveways = false;
  s = buildStreetscape(m, buildNetwork(m));
  assert.equal(s.driveways.length, 0);
  assert.equal(s.vehicleRamp.indices.length, 0);
});
test("Curve-relative vehicle ramp toe follows curved road edge instead of a straight footprint", () => {
  const m = preset();
  m.nodes = [
    { id: "a", x: -70, z: 0 },
    { id: "b", x: 70, z: 0 },
  ];
  m.roads = [
    {
      id: "curve",
      a: "a",
      b: "b",
      width: 10,
      control: [0, -45],
      driveway: { ...DEFAULT_DRIVEWAY },
    },
  ];
  m.sidewalk = 3.2;
  const s = buildStreetscape(m, buildNetwork(m));
  assert.equal(s.driveways.length, 1);
  const r = s.driveways[0];
  for (const u of [-1.8, -0.9, 0, 0.9, 1.8])
    assert.ok(Math.abs(rampHeight(r, ...rampPoint(r, u, 0)) - 0.12) < 0.001);
});
test("Ramp/driveway settings round-trip and legacy too-steep pedestrian runs migrate safely", () => {
  const m = preset();
  m.roads[0].driveway = { ...DEFAULT_DRIVEWAY };
  m.streets.rampRun = 1.2;
  const restored = validateModel(JSON.parse(JSON.stringify(m)));
  assert.deepEqual(restored.roads[0].driveway, DEFAULT_DRIVEWAY);
  assert.equal(restored.streets.rampRun, 1.8);
  m.roads[0].driveway.side = 0;
  assert.throws(() => validateModel(m));
  assert.throws(() =>
    validateModel({ ...preset(), streets: { pedestrianMode: "invalid" } }),
  );
});

test("Curb walls split at exact ramp crease points rather than bridging across them", () => {
  const path = pathOf([
      [0, 0],
      [2, 0],
      [2, 1],
      [0, 1],
    ]),
    x = 0.333,
    mesh = slabShell(
      [path],
      (a) => 0.12 + Math.min(0.15, Math.abs(a - x)),
      -0.2,
      0.15,
      [x, 0.12, 0],
    );
  let found = false;
  for (let i = 0; i < mesh.positions.length; i += 3)
    if (
      Math.abs(mesh.positions[i] - x) < 1e-8 &&
      mesh.positions[i + 2] === 0 &&
      Math.abs(mesh.positions[i + 1] - 0.12) < 1e-8
    )
      found = true;
  assert.ok(found);
});
test("A newly drawn road crossing does not duplicate the parent vehicle entry", () => {
  const m = preset();
  m.nodes = [
    { id: "a", x: -80, z: 0 },
    { id: "b", x: 80, z: 0 },
  ];
  m.roads = [
    {
      id: "parent",
      a: "a",
      b: "b",
      width: 10,
      driveway: { ...DEFAULT_DRIVEWAY, position: 0.25 },
    },
  ];
  addCurve(
    m,
    [
      [0, -80],
      [0, 80],
    ],
    10,
  );
  assert.equal(m.roads.filter((r) => r.driveway).length, 1);
  assert.ok(
    Math.abs(m.roads.find((r) => r.driveway).driveway.position - 0.5) < 1e-5,
  );
});

test("Vehicle apron geometry replaces the flat pavement without overlap or lost plan area", () => {
  const m = preset("junction");
  m.sidewalk = 3.2;
  m.roads[0].driveway = { ...DEFAULT_DRIVEWAY };
  const d = buildNetwork(m),
    s = buildStreetscape(m, d),
    r = s.driveways[0];
  assert.ok(area(intersection(s.walk, [r.footprint])) < 1e-8);
  const meshArea = (mesh) => {
    let area = 0;
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const [a, b, c] = mesh.indices
        .slice(i, i + 3)
        .map(
          (j) => new THREE.Vector3(...mesh.positions.slice(j * 3, j * 3 + 3)),
        );
      const cross = b.sub(a).cross(c.sub(a));
      assert.ok(cross.y > 0, "upward, nondegenerate top face");
      area += cross.y / 2;
    }
    return area;
  };
  // Separate polygon clips snap to 1 mm; bound accumulated plan-area
  // rounding across eight pedestrian ramps plus the vehicle apron.
  assert.ok(
    Math.abs(
      area(s.walk) +
        meshArea(s.walkRamp) +
        meshArea(s.vehicleRamp) +
        meshArea(s.tactileMesh) -
        area(d.walk),
    ) < 0.03,
  );
});
