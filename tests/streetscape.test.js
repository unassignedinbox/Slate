import test from "node:test";
import assert from "node:assert/strict";
import { preset, buildNetwork, validateModel } from "../src/network.js";
import {
  buildStreetscape,
  area,
  intersection,
  localPoint,
  pavementHeight,
  rampHeight,
} from "../src/streetscape.js";
import { PAVING_PATTERNS } from "../src/street-settings.js";
import { pavingLayout } from "../src/paving.js";
const m = preset("junction");
m.sidewalk = 3.2;
const data = buildNetwork(m),
  street = buildStreetscape(m, data);
const meshArea = (d) => {
  let sum = 0;
  for (let i = 0; i < d.indices.length; i += 3) {
    const [a, b, c] = d.indices.slice(i, i + 3).map((j) => j * 3);
    sum +=
      Math.abs(
        (d.positions[b] - d.positions[a]) *
          (d.positions[c + 2] - d.positions[a + 2]) -
          (d.positions[b + 2] - d.positions[a + 2]) *
            (d.positions[c] - d.positions[a]),
      ) / 2;
  }
  return sum;
};
for (const name of PAVING_PATTERNS)
  test(`${name} pavers tile without overlaps or gaps`, () => {
    const rects = pavingLayout(name);
    for (let x = 0.5; x < 12; x++)
      for (let y = 0.5; y < 12; y++) {
        const covering = rects.filter(
          (r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h,
        );
        assert.equal(covering.length, 1, `cell ${x},${y}`);
      }
  });
test("Four-way crossing has two opposing aligned embedded ramps per approach", () => {
  assert.equal(street.crossings.length, 4);
  assert.equal(street.ramps.length, 8);
  assert.equal(street.tactiles.length, 8);
  for (const c of street.crossings) {
    const ramps = street.ramps.filter((r) => r.crossing === c.id);
    assert.equal(ramps.length, 2);
    assert.deepEqual(
      ramps.map((r) => r.side),
      [-1, 1],
    );
    assert.ok(ramps.every((r) => r.p === c.p && r.half === c.length / 2));
  }
});
test("Ramp toes are flush to asphalt, backs and flares meet unchanged pavement", () => {
  for (const r of street.ramps) {
    for (const [u, v, y] of [
      [0, 0, 0.12],
      [0, r.run, 0.27],
      [r.half + r.flare, 0, 0.27],
      [-r.half - r.flare, 0, 0.27],
    ]) {
      const p = localPoint(r.p, u, r.side * (r.p.width / 2 + v));
      assert.ok(Math.abs(rampHeight(r, ...p) - y) < 1e-8);
      assert.ok(Math.abs(pavementHeight(street, ...p) - y) < 1e-8);
    }
  }
});
test("Pavement and curb patches replace originals rather than stack on them", () => {
  // Independent sloped-face clips snap to the 1 mm grid. Bound accumulated
  // area rounding to 200 cm² across all eight ramps (not a hidden deck overlap).
  assert.ok(
    Math.abs(
      area(street.walk) +
        meshArea(street.walkRamp) +
        meshArea(street.tactileMesh) -
        area(data.walk),
    ) < 0.02,
  );
  assert.ok(
    Math.abs(area(street.curb) + meshArea(street.curbRamp) - area(data.curb)) <
      0.005,
  );
  for (const r of street.ramps)
    assert.ok(area(intersection([r.footprint], street.walk)) < 0.00001);
});
test("Road deck excludes manhole and drainage openings with no duplicate deck under grates", () => {
  assert.ok(street.manholes.length > 0);
  assert.ok(street.grates.length > 0);
  for (const cover of street.manholes)
    assert.ok(area(intersection(street.asphalt, [cover.footprint])) < 0.00001);
  for (const grate of street.grates) {
    assert.ok(area(intersection(street.asphalt, [grate.footprint])) < 0.00001);
    assert.ok(area(intersection(street.gutters, [grate.footprint])) < 0.00001);
  }
  const channels = street.channels.reduce((a, c) => a + area(c.paths), 0),
    covers = street.manholes.reduce((a, c) => a + area([c.footprint]), 0);
  assert.ok(
    Math.abs(area(street.asphalt) + channels + covers - area(data.surface)) <
      0.01,
  );
});
test("Depressed gutter mesh retains open grate slots and drainage is separated from crossings", () => {
  const areaOfGrates = street.grates.reduce(
      (a, g) => a + area([g.footprint]),
      0,
    ),
    areaOfChannels = street.channels.reduce((a, c) => a + area(c.paths), 0);
  assert.ok(
    Math.abs(meshArea(street.gutterMesh) + areaOfGrates - areaOfChannels) <
      0.01,
  );
  const heights = street.gutterMesh.positions.filter((_, i) => i % 3 === 1);
  assert.ok(Math.min(...heights) < 0.096);
  assert.ok(Math.max(...heights) <= 0.120001);
  for (const grate of street.grates)
    for (const c of street.crossings.filter((c) => c.road === grate.road))
      assert.ok(Math.abs(c.s - grate.s) > c.length / 2 + 4);
});
test("New geometry contains finite coordinates, upward triangles and no vertical ramp lips", () => {
  for (const d of [
    street.walkRamp,
    street.curbRamp,
    street.tactileMesh,
    street.gutterMesh,
  ]) {
    assert.ok(d.positions.every(Number.isFinite));
    for (let i = 0; i < d.indices.length; i += 3) {
      const [a, b, c] = d.indices.slice(i, i + 3).map((j) => j * 3);
      const cross =
        (d.positions[b] - d.positions[a]) *
          (d.positions[c + 2] - d.positions[a + 2]) -
        (d.positions[b + 2] - d.positions[a + 2]) *
          (d.positions[c] - d.positions[a]);
      assert.ok(cross < 0);
    }
  }
});
test("Disabling feature layers restores the uncut surfaces", () => {
  const off = structuredClone(m);
  for (const k of ["crossings", "ramps", "drainage", "manholes"])
    off.layers[k] = false;
  const s = buildStreetscape(off, data);
  assert.equal(s.ramps.length, 0);
  assert.equal(s.manholes.length, 0);
  assert.equal(s.grates.length, 0);
  assert.equal(area(s.walk), area(data.walk));
  assert.equal(area(s.asphalt), area(data.surface));
});
test("Narrow pavement suppresses ramps with an explicit design warning", () => {
  const n = structuredClone(m);
  n.sidewalk = 1;
  const s = buildStreetscape(n, buildNetwork(n));
  assert.equal(s.ramps.length, 0);
  assert.ok(s.warnings.some((w) => w.includes("narrow")));
});
test("Streetscape settings round-trip, old projects migrate and invalid inputs are rejected", () => {
  const current = validateModel(JSON.parse(JSON.stringify(m)));
  assert.equal(current.streets.rampRun, 1.8);
  assert.equal(current.materials.paving, "Herringbone");
  const old = structuredClone(m);
  delete old.streets;
  delete old.materials.pavingScale;
  delete old.layers.drainage;
  assert.equal(validateModel(old).streets.drainSpacing, 30);
  assert.equal(validateModel(old).layers.drainage, true);
  for (const patch of [
    { rampRun: -1 },
    { tactile: "yes" },
    { manholeDiameter: 10 },
    { drainSpacing: NaN },
  ])
    assert.throws(() => validateModel({ ...m, streets: patch }));
  assert.throws(() =>
    validateModel({ ...m, materials: { ...m.materials, pavingScale: 10 } }),
  );
});
