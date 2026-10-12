import { test } from 'node:test';
import assert from 'node:assert/strict';
import { V, resample, at, nearest, segIntersect, smoothPath, polylineLength } from '../src/core/geometry';

test('resample keeps total length and uniform spacing', () => {
  const pts = [V(0, 0, 0), V(100, 0, 0), V(100, 0, 50)];
  const S = resample(pts, 5);
  assert.ok(Math.abs(S.length - 150) < 1e-9);
  assert.equal(S.pts.length, 31);
  assert.ok(Math.abs(S.s[S.s.length - 1] - 150) < 1e-9);
  const h = at(S, 50);
  assert.ok(Math.abs(h.p.x - 50) < 1e-6 && Math.abs(h.p.z) < 1e-6);
});

test('right normal of a +X travel direction points to -Z (right-handed, y-up)', () => {
  // Travelling along +X, the right-hand side (looking down from above, y up) is +Z? Check convention:
  // forward (0,0,-1) must have right (1,0,0).
  const S = resample([V(0, 0, 0), V(0, 0, -10)], 1);
  const h = at(S, 5);
  assert.ok(Math.abs(h.n.x - 1) < 1e-9, `n.x=${h.n.x}`);
});

test('nearest reports signed lateral offset', () => {
  const S = resample([V(0, 0, 0), V(0, 0, -100)], 2);
  const hit = nearest(S, V(3, 0, -40));
  assert.ok(hit);
  assert.ok(Math.abs(hit!.s - 40) < 1e-6);
  assert.ok(Math.abs(hit!.offset - 3) < 1e-6, `offset=${hit!.offset}`);
  assert.ok(Math.abs(hit!.dist - 3) < 1e-6);
});

test('segment intersection in XZ', () => {
  const hit = segIntersect(V(-5, 0, 0), V(5, 0, 0), V(0, 0, -5), V(0, 0, 5));
  assert.ok(hit);
  assert.ok(Math.abs(hit!.t - 0.5) < 1e-9 && Math.abs(hit!.u - 0.5) < 1e-9);
  assert.equal(segIntersect(V(0, 0, 0), V(1, 0, 0), V(0, 0, 1), V(1, 0, 1)), null);
});

test('smoothPath passes through its control points', () => {
  const pts = [V(0, 0, 0), V(10, 0, 5), V(20, 0, 0), V(30, 0, 10)];
  const dense = smoothPath(pts, 8);
  const hits = pts.map((p) => dense.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 1e-9));
  assert.ok(hits.every(Boolean));
  assert.ok(polylineLength(dense) > polylineLength(pts) * 0.9);
});
