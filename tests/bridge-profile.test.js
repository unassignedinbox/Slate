import test from "node:test";
import assert from "node:assert/strict";
import {
  approachProfile,
  requiredApproachRun,
  DEFAULT_BRIDGE_GRADE,
  DEFAULT_BRIDGE_BLEND,
} from "../src/bridge-profile.js";
import { preset, buildNetwork, validateModel } from "../src/network.js";
import { bridgeGeometry } from "../src/connections.js";
const close = (a, b, tol = 1e-7) =>
  assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);
const fixture = () => {
  const m = preset("parks");
  return { m, c: m.connections[0], data: buildNetwork(m) };
};
test("Parabolic toe and crest blends have continuous height and gradient", () => {
  for (const [h, l, b] of [
    [5.5, 75, 3],
    [1, 4, 12],
    [12, 120, 8],
  ]) {
    const p = approachProfile(h, l, b);
    close(p.heightAt(0), 0);
    close(p.heightAt(l), h);
    close(p.slopeAt(0), 0);
    close(p.slopeAt(l), 0);
    for (const x of [0, p.blend, l - p.blend, l]) {
      close(p.heightAt(x - 1e-6), p.heightAt(x + 1e-6), 1e-5);
      close(p.slopeAt(x - 1e-6), p.slopeAt(x + 1e-6), 1e-5);
    }
    let previous = -1;
    for (let x = 0; x <= l; x += l / 100) {
      const y = p.heightAt(x);
      assert.ok(y >= previous);
      assert.ok(p.slopeAt(x) <= p.grade + 1e-9);
      previous = y;
    }
    close(p.slopeAt(l / 2), p.grade);
  }
});
test("Required approach run meets the grade target, including short triangular-gradient blends", () => {
  for (const h of [1, 5.5, 12])
    for (const g of [0.02, 0.083, 0.15])
      for (const b of [1, 3, 12]) {
        const run = requiredApproachRun(h, g, b),
          p = approachProfile(h, run, b);
        close(p.grade, g);
        assert.ok(approachProfile(h, run * 0.95, b).grade > g);
      }
});
test("Smoothing keeps both bridge landings grounded and its protected corridor level", () => {
  const { c, data } = fixture(),
    d = bridgeGeometry(c, data);
  assert.ok(d.valid);
  close(d.frames[0].y, 0.27);
  close(d.frames.at(-1).y, 0.27);
  for (const p of d.frames.filter((p) => p.s >= d.start && p.s <= d.end))
    close(p.y, 0.27 + c.height);
  for (const boundary of [2, d.start, d.end, d.length - 2]) {
    const i = d.frames.findIndex((p) => Math.abs(p.s - boundary) < 0.001);
    assert.ok(i >= 0);
    const a = d.frames[Math.max(0, i - 1)],
      b = d.frames[i],
      e = d.frames[Math.min(d.frames.length - 1, i + 1)];
    const left = (b.y - a.y) / (b.s - a.s || 1),
      right = (e.y - b.y) / (e.s - b.s || 1);
    assert.ok(
      Math.abs(left - right) < 0.025,
      "No old full-grade jump at landing or crest",
    );
  }
  assert.deepEqual(c.points, [
    [-88, -10],
    [0, -10],
    [88, -10],
  ]);
});
test("Grade and clearance targets change warnings, not geometry or endpoints", () => {
  const { c, data } = fixture(),
    base = bridgeGeometry(c, data);
  c.gradeTarget = 0.04;
  c.clearanceTarget = 6;
  const tight = bridgeGeometry(c, data);
  assert.ok(
    tight.warnings.some((w) => w.includes("Additional approach length")),
  );
  assert.ok(tight.warnings.some((w) => w.includes("Nominal road clearance")));
  assert.ok(tight.approaches.every((p) => p.additionalRun > 0));
  assert.deepEqual(tight.positions, base.positions);
  c.gradeTarget = 0.15;
  c.clearanceTarget = 4;
  assert.equal(bridgeGeometry(c, data).warnings.length, 0);
});
test("Longer blends soften curvature but correctly report their increased peak grade", () => {
  const { c, data } = fixture(),
    short = bridgeGeometry({ ...c, transition: 1 }, data),
    long = bridgeGeometry({ ...c, transition: 10 }, data);
  assert.ok(long.grade > short.grade);
  assert.ok(long.approaches[0].blend > short.approaches[0].blend);
  close(long.frames.at(-1).y, 0.27);
  close(long.clearance, short.clearance);
});
test("Asymmetric approaches report independent length shortfalls", () => {
  const { c, data } = fixture();
  c.points = [
    [-50, -10],
    [0, -10],
    [88, -10],
  ];
  const d = bridgeGeometry(c, data);
  assert.ok(d.valid);
  assert.ok(d.approaches[0].additionalRun > d.approaches[1].additionalRun);
  assert.ok(d.approaches[0].grade > d.approaches[1].grade);
});
test("Bridge design settings round-trip, legacy settings default, invalid values are rejected", () => {
  const { m, c, data } = fixture(),
    legacy = bridgeGeometry(c, data);
  close(legacy.targetGrade, DEFAULT_BRIDGE_GRADE);
  close(legacy.approaches[0].blend, DEFAULT_BRIDGE_BLEND);
  c.gradeTarget = 0.065;
  c.transition = 4.5;
  c.clearanceTarget = 5.75;
  assert.deepEqual(
    validateModel(JSON.parse(JSON.stringify(m))).connections,
    m.connections,
  );
  for (const [key, value] of [
    ["gradeTarget", 0],
    ["gradeTarget", 0.16],
    ["gradeTarget", "0.08"],
    ["transition", 0],
    ["transition", 13],
    ["clearanceTarget", 1],
    ["clearanceTarget", 11],
  ]) {
    const copy = structuredClone(m);
    copy.connections[0][key] = value;
    assert.throws(() => validateModel(copy));
  }
});
