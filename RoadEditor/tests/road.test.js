// Geometry and serialization regression tests for the Frontier road editor.
// Run from RoadEditor/: npm test  (node --test)
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  seededRandom, dedupePoints, polylineLength, sampleCenterline,
  applyElevation, computeStats, findSelfIntersection, validateRoad, clamp,
} from '../src/spline.js';
import { makeTerrainSampler, terrainHeightRange, defaultTerrainParams } from '../src/terrain.js';
import {
  defaultRoadParams, sanitizeParams, sampleRoad, buildRoadMeshData,
  roadToJSON, parseRoadJSON, presetRoads, mergeStrips,
} from '../src/road.js';

const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// ── spline.js ─────────────────────────────────────────────────────────────

test('seededRandom is deterministic, in range, and seed-sensitive', () => {
  const a = seededRandom(28491), b = seededRandom(28491), c = seededRandom(28492);
  const seqA = Array.from({ length: 8 }, a);
  const seqB = Array.from({ length: 8 }, b);
  const seqC = Array.from({ length: 8 }, c);
  assert.deepEqual(seqA, seqB);
  assert.notDeepEqual(seqA, seqC);
  for (const v of seqA) assert.ok(v >= 0 && v < 1, `value ${v} in [0,1)`);
});

test('dedupePoints removes overlaps but keeps endpoints', () => {
  const pts = [{ x: 0, y: 0, z: 0 }, { x: 0.1, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }, { x: 5.2, y: 0, z: 0 }];
  const out = dedupePoints(pts, 0.5);
  assert.equal(out.length, 2);
  assert.deepEqual([out[0].x, out[1].x], [0, 5]);
});

test('sampleCenterline: two points make a straight, correctly-measured line', () => {
  const stations = sampleCenterline([{ x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 0 }], { sampleLength: 2 });
  assert.ok(stations.length >= 50);
  assert.ok(close(stations[0].x, 0) && close(stations[stations.length - 1].x, 100));
  const total = stations[stations.length - 1].arc;
  assert.ok(close(total, 100, 0.01));
  for (const st of stations) {
    assert.ok(close(st.z, 0, 1e-6), 'straight road stays on z=0');
    assert.ok(close(Math.hypot(st.tx, st.tz), 1, 1e-6), 'unit tangent');
    assert.ok(close(st.curv, 0, 1e-6), 'straight road has no curvature');
  }
});

test('sampleCenterline: smoothing=0 follows the polyline exactly', () => {
  const pts = [{ x: 0, y: 0, z: 0 }, { x: 50, y: 0, z: 0 }, { x: 50, y: 0, z: 50 }];
  const stations = sampleCenterline(pts, { smoothing: 0, sampleLength: 1 });
  // Every station lies on one of the two legs.
  for (const st of stations) {
    const onX = close(st.z, 0, 1e-6) && st.x >= -1e-6 && st.x <= 50 + 1e-6;
    const onZ = close(st.x, 50, 1e-6) && st.z >= -1e-6 && st.z <= 50 + 1e-6;
    assert.ok(onX || onZ, `station (${st.x},${st.z}) on the polyline`);
  }
});

test('sampleCenterline: closed loop ends where it starts', () => {
  const pts = [{ x: 0, y: 0, z: 0 }, { x: 40, y: 0, z: 0 }, { x: 40, y: 0, z: 40 }, { x: 0, y: 0, z: 40 }];
  const stations = sampleCenterline(pts, { closed: true, sampleLength: 2 });
  const first = stations[0], last = stations[stations.length - 1];
  assert.ok(close(first.x, last.x, 1e-6) && close(first.z, last.z, 1e-6));
});

test('sampleCenterline: curvature is positive for a left turn (+Z with right = -Z)', () => {
  // Heading +X with right = (tz,0,-tx) = (0,0,-1): turning toward +Z is a LEFT turn.
  const pts = [{ x: 0, y: 0, z: 0 }, { x: 60, y: 0, z: 0 }, { x: 60, y: 0, z: 60 }];
  const stations = sampleCenterline(pts, { smoothing: 1, sampleLength: 1 });
  const maxCurv = Math.max(...stations.map((s) => s.curv));
  assert.ok(maxCurv > 0, `left turn has positive curvature (got ${maxCurv})`);
});

test('applyElevation: follow, flat and grade modes', () => {
  const heightFn = (x) => x; // ramp
  const base = sampleCenterline([{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }], { sampleLength: 1 });
  const follow = applyElevation(base.map((s) => ({ ...s })), 'follow', { heightFn, rideHeight: 0.5 });
  assert.ok(close(follow[0].y, 0.5) && close(follow[follow.length - 1].y, 10.5));
  const flat = applyElevation(base.map((s) => ({ ...s })), 'flat', { flatY: 3 });
  assert.ok(flat.every((s) => close(s.y, 3)));
  const grade = applyElevation(base.map((s) => ({ ...s })), 'grade', { heightFn, rideHeight: 0 });
  assert.ok(close(grade[0].y, 0) && close(grade[grade.length - 1].y, 10));
  const mid = grade[Math.floor(grade.length / 2)];
  assert.ok(mid.y > 3 && mid.y < 7, 'grade interpolates the middle');
});

test('computeStats: length, grade and elevation range', () => {
  const stations = sampleCenterline([{ x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 0 }], { sampleLength: 1 });
  applyElevation(stations, 'follow', { heightFn: (x) => x / 10, rideHeight: 0 }); // 10% ramp
  const stats = computeStats(stations);
  assert.ok(close(stats.length, Math.hypot(100, 10), 0.5), `3D length ~100.5 (got ${stats.length})`);
  assert.ok(close(stats.maxGradePct, 10, 0.01), `grade 10% (got ${stats.maxGradePct})`);
  assert.ok(close(stats.minY, 0, 1e-6) && close(stats.maxY, 10, 1e-6));
});

test('findSelfIntersection: bowtie crosses, square does not', () => {
  const bowtie = [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 10 }, { x: 10, y: 0, z: 0 }, { x: 0, y: 0, z: 10 }];
  assert.ok(findSelfIntersection(bowtie, false));
  const square = [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 10, y: 0, z: 10 }, { x: 0, y: 0, z: 10 }];
  assert.equal(findSelfIntersection(square, true), null);
  assert.equal(findSelfIntersection(square, false), null);
});

test('validateRoad: errors and warnings behave', () => {
  assert.ok(validateRoad([], {}).errors.length >= 1);
  assert.ok(validateRoad([{ x: 0, y: 0, z: 0 }], {}).errors.length >= 1);
  assert.ok(validateRoad([{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }], { closed: true }).errors.length >= 1);
  const dup = validateRoad([{ x: 0, y: 0, z: 0 }, { x: 0.1, y: 0, z: 0 }, { x: 20, y: 0, z: 0 }], {});
  assert.ok(dup.errors.some((e) => e.includes('overlap')));
  const bowtie = validateRoad([{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 10 }, { x: 10, y: 0, z: 0 }, { x: 0, y: 0, z: 10 }], {});
  assert.equal(bowtie.errors.length, 0);
  assert.ok(bowtie.warnings.some((w) => w.includes('crosses itself')));
  const clean = validateRoad([{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 20, y: 0, z: 5 }], {});
  assert.equal(clean.errors.length, 0);
  assert.equal(clean.warnings.length, 0);
});

// ── terrain.js ────────────────────────────────────────────────────────────

test('terrain sampler is deterministic, finite and fades to 0 at the borders', () => {
  const a = makeTerrainSampler({ ...defaultTerrainParams, seed: 42 });
  const b = makeTerrainSampler({ ...defaultTerrainParams, seed: 42 });
  const c = makeTerrainSampler({ ...defaultTerrainParams, seed: 43 });
  for (const [x, z] of [[0, 0], [50, -120], [-199, 88], [123.4, -56.7]]) {
    assert.equal(a(x, z), b(x, z), 'same seed, same height');
    assert.ok(Number.isFinite(a(x, z)));
  }
  assert.notEqual(a(50, -120), c(50, -120), 'different seed, different terrain');
  const size = defaultTerrainParams.size;
  assert.ok(Math.abs(a(size / 2, 0)) < 1e-6, 'east border at y=0');
  assert.ok(Math.abs(a(0, -size / 2)) < 1e-6, 'south border at y=0');
  const { min, max } = terrainHeightRange(a, size);
  assert.ok(min > -defaultTerrainParams.height && max < defaultTerrainParams.height * 1.5);
});

// ── road.js ───────────────────────────────────────────────────────────────

test('sanitizeParams clamps into legal ranges', () => {
  const p = sanitizeParams({ width: 999, lanes: 12, shoulderWidth: -3, banking: 250, elevation: 'nope', sampleLength: 0.01 });
  assert.equal(p.width, 30);
  assert.equal(p.lanes, 4);
  assert.equal(p.shoulderWidth, 0);
  assert.equal(p.banking, 100);
  assert.equal(p.elevation, 'follow');
  assert.equal(p.sampleLength, 0.5);
  assert.equal(sanitizeParams({ markings: false }).markings, false);
  assert.equal(sanitizeParams({}).markings, true);
});

test('buildRoadMeshData: straight road produces a finite, upward-facing strip', () => {
  const params = { ...defaultRoadParams, width: 6, shoulderWidth: 1, markings: true, lanes: 2 };
  const stations = sampleRoad([{ x: 0, y: 0, z: 0 }, { x: 40, y: 0, z: 0 }], params, () => 0);
  const mesh = buildRoadMeshData(stations, params);
  assert.ok(mesh.asphalt.positions.length > 0);
  for (const v of mesh.asphalt.positions) assert.ok(Number.isFinite(v), 'finite positions');
  assert.equal(mesh.asphalt.indices.length % 3, 0);
  assert.ok(mesh.stats.triangles > 0);
  // First triangle must face up (+Y): T=(1,0,0), R=(0,0,-1), strip left→right.
  const pos = mesh.asphalt.positions;
  const idx = mesh.asphalt.indices;
  const a = [pos[idx[0] * 3], pos[idx[0] * 3 + 1], pos[idx[0] * 3 + 2]];
  const b = [pos[idx[1] * 3], pos[idx[1] * 3 + 1], pos[idx[1] * 3 + 2]];
  const c = [pos[idx[2] * 3], pos[idx[2] * 3 + 1], pos[idx[2] * 3 + 2]];
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const ny = u[2] * v[0] - u[0] * v[2];
  assert.ok(ny > 0, 'asphalt faces up');
  // Shoulders and markings exist and sit outside/beside the asphalt width.
  assert.ok(mesh.shoulder.indices.length > 0);
  assert.ok(mesh.markEdges.indices.length > 0);
  assert.ok(mesh.markDividers.indices.length > 0);
  assert.ok(mesh.centerline.length === stations.length);
});

test('buildRoadMeshData: banking raises the outside (right) edge of a left turn', () => {
  const params = { ...defaultRoadParams, width: 8, banking: 100, maxBankAngle: 10, smoothing: 100, sampleLength: 1, markings: false, shoulderWidth: 0 };
  // Tight left turn: +X then toward +Z (right vector points -Z, so the right edge is the outside).
  const pts = [{ x: 0, y: 0, z: 0 }, { x: 30, y: 0, z: 0 }, { x: 30, y: 0, z: 30 }];
  const stations = sampleRoad(pts, params, () => 0);
  const mesh = buildRoadMeshData(stations, params);
  const halfW = params.width / 2;
  let checked = 0, maxRise = 0;
  for (let i = 0; i < stations.length; i++) {
    const st = stations[i];
    if (st.curv < 0.01) continue; // only well into the curve
    const leftY = mesh.asphalt.positions[i * 6 + 1];
    const rightY = mesh.asphalt.positions[i * 6 + 4];
    const leftX = mesh.asphalt.positions[i * 6 + 0], leftZ = mesh.asphalt.positions[i * 6 + 2];
    const rightX = mesh.asphalt.positions[i * 6 + 3], rightZ = mesh.asphalt.positions[i * 6 + 5];
    // Sanity: offsets are halfW along the right vector.
    assert.ok(close(Math.hypot(rightX - st.x, rightZ - st.z), halfW, 1e-4));
    assert.ok(close(Math.hypot(leftX - st.x, leftZ - st.z), halfW, 1e-4));
    assert.ok(rightY > leftY, `right (outside) edge raised: ${rightY} > ${leftY}`);
    maxRise = Math.max(maxRise, rightY - leftY);
    checked++;
  }
  assert.ok(checked >= 3, `checked ${checked} banked stations`);
  // Full banking at 10° over an 8 m road: cross-slope rise ≈ tan(10°) * 8 ≈ 1.41 m.
  assert.ok(maxRise > 0.8, `substantial banking applied (rise ${maxRise.toFixed(2)} m)`);
});

test('buildRoadMeshData: banking is zero on straights and scales with the banking slider', () => {
  const pts = [{ x: 0, y: 0, z: 0 }, { x: 30, y: 0, z: 0 }, { x: 30, y: 0, z: 30 }];
  const flat = { ...defaultRoadParams, width: 8, banking: 0, smoothing: 100, sampleLength: 1, markings: false, shoulderWidth: 0 };
  const stations = sampleRoad(pts, flat, () => 0);
  const mesh = buildRoadMeshData(stations, flat);
  for (let i = 0; i < stations.length; i++) {
    assert.ok(close(mesh.asphalt.positions[i * 6 + 1], mesh.asphalt.positions[i * 6 + 4], 1e-6), 'no banking when slider is 0');
  }
  const half = { ...flat, banking: 50 };
  const meshHalf = buildRoadMeshData(sampleRoad(pts, half, () => 0), half);
  const full = { ...flat, banking: 100 };
  const meshFull = buildRoadMeshData(sampleRoad(pts, full, () => 0), full);
  const peak = (m) => Math.max(...stations.map((_, i) => m.asphalt.positions[i * 6 + 4] - m.asphalt.positions[i * 6 + 1]));
  assert.ok(close(peak(meshHalf), peak(meshFull) / 2, 0.05), 'banking slider scales the cross slope linearly');
});

test('buildRoadMeshData: closed loop wraps the final quad', () => {
  const params = { ...defaultRoadParams, closed: true, markings: false, shoulderWidth: 0 };
  const pts = [{ x: 0, y: 0, z: 0 }, { x: 30, y: 0, z: 0 }, { x: 30, y: 0, z: 30 }, { x: 0, y: 0, z: 30 }];
  const stations = sampleRoad(pts, params, () => 0);
  const mesh = buildRoadMeshData(stations, params);
  const n = stations.length;
  assert.equal(mesh.asphalt.positions.length / 3, n * 2, 'closed strip keeps the wrap station');
  // The last quad must reference station 0 (indices 0/1).
  const idx = mesh.asphalt.indices;
  const lastQuad = Array.from(idx.slice(-6));
  assert.ok(lastQuad.includes(0) || lastQuad.includes(1), 'final quad wraps to the first station');
});

test('buildRoadMeshData: markings toggle and lane count control dividers', () => {
  const pts = [{ x: 0, y: 0, z: 0 }, { x: 60, y: 0, z: 0 }];
  const off = buildRoadMeshData(sampleRoad(pts, { ...defaultRoadParams, markings: false }, () => 0), { ...defaultRoadParams, markings: false });
  assert.equal(off.markEdges.indices.length, 0);
  assert.equal(off.markDividers.indices.length, 0);
  const oneLane = buildRoadMeshData(sampleRoad(pts, { ...defaultRoadParams, lanes: 1 }, () => 0), { ...defaultRoadParams, lanes: 1 });
  assert.equal(oneLane.markDividers.indices.length, 0, 'single lane has no dividers');
  const fourLane = buildRoadMeshData(sampleRoad(pts, { ...defaultRoadParams, lanes: 4 }, () => 0), { ...defaultRoadParams, lanes: 4 });
  assert.ok(fourLane.markDividers.indices.length > 0, 'four lanes produce dividers');
  // More lanes → more divider triangles.
  const twoLane = buildRoadMeshData(sampleRoad(pts, { ...defaultRoadParams, lanes: 2 }, () => 0), { ...defaultRoadParams, lanes: 2 });
  assert.ok(fourLane.markDividers.indices.length > twoLane.markDividers.indices.length);
});

test('buildRoadMeshData: presets build clean geometry with no NaN', () => {
  const sampler = makeTerrainSampler({ ...defaultTerrainParams, seed: 7 });
  for (const kind of ['straight', 'valley', 'switchback', 'circuit']) {
    const preset = presetRoads(kind, sampler, 400);
    const params = { ...defaultRoadParams, closed: preset.closed };
    const stations = sampleRoad(preset.points, params, sampler);
    const mesh = buildRoadMeshData(stations, params);
    assert.ok(mesh.stats.length > 10, `${kind}: road has length`);
    for (const v of mesh.asphalt.positions) assert.ok(Number.isFinite(v), `${kind}: finite asphalt`);
    for (const v of mesh.shoulder.positions) assert.ok(Number.isFinite(v), `${kind}: finite shoulder`);
  }
});

test('road project JSON round-trips and rejects bad input', () => {
  const project = roadToJSON({
    name: 'Test pass',
    points: [{ x: 1, y: 2, z: 3 }, { x: 40, y: 5, z: -6 }],
    params: { ...defaultRoadParams, width: 9.5, lanes: 3, closed: true },
    stats: { length: 123.4 },
  });
  assert.equal(project.format, 'frontier-road');
  assert.equal(project.version, 1);
  assert.equal(project.units, 'meters');
  const parsed = parseRoadJSON(JSON.stringify(project));
  assert.equal(parsed.name, 'Test pass');
  assert.equal(parsed.points.length, 2);
  assert.deepEqual(parsed.points[0], { x: 1, y: 2, z: 3 });
  assert.equal(parsed.params.width, 9.5);
  assert.equal(parsed.params.lanes, 3);
  assert.equal(parsed.params.closed, true);
  assert.throws(() => parseRoadJSON('not json'), /not valid JSON/);
  assert.throws(() => parseRoadJSON('{"format":"other"}'), /Not a Frontier road project/);
  assert.throws(() => parseRoadJSON('{"format":"frontier-road","version":99}'), /Unsupported road project version/);
  // Garbage points are dropped, not fatal.
  const salvaged = parseRoadJSON('{"format":"frontier-road","version":1,"points":[{"x":1,"z":2},{"x":"bad","z":0},null]}');
  assert.equal(salvaged.points.length, 1);
});

test('mergeStrips offsets indices correctly', () => {
  const a = { positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]), uvs: new Float32Array(8), indices: new Uint32Array([0, 1, 2, 1, 3, 2]) };
  const b = { positions: new Float32Array([5, 0, 0, 6, 0, 0, 5, 1, 0, 6, 1, 0]), uvs: new Float32Array(8), indices: new Uint32Array([0, 1, 2, 1, 3, 2]) };
  const merged = mergeStrips([a, b]);
  assert.equal(merged.positions.length, 24);
  assert.equal(merged.indices.length, 12);
  assert.deepEqual(Array.from(merged.indices.slice(6)), [4, 5, 6, 5, 7, 6]);
});

test('clamp behaves at the boundaries', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-5, 0, 10), 0);
  assert.equal(clamp(50, 0, 10), 10);
});
