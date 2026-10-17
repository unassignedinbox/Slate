// Level tests: structure, clearance, and a headless drive through the whole
// town with the real physics. Run with `npm test`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFragmentedTown } from '../src/levels/fragmented-town/build.js';
import { LAYOUT } from '../src/levels/fragmented-town/layout.js';
import { runAutopilot } from '../src/engine/autopilot.js';
import { World } from '../src/engine/world.js';
import { hashString, distXZ, UP } from '../src/engine/math.js';

const level = buildFragmentedTown();

test('the level builds deterministically from its seed', () => {
  const a = buildFragmentedTown();
  const b = buildFragmentedTown();
  const sig = (l) =>
    hashString(
      JSON.stringify([
        l.counts,
        l.parts.map((p) => p.route.length),
        l.items.slice(0, 200).map((i) => i.anchor.home.slice(12, 15)),
      ]),
    );
  assert.equal(sig(a), sig(b));
});

test('every zone has a continuous road with only the intended cracks', () => {
  for (const zone of level.parts) {
    let covered = 0;
    let prevEnd = 0;
    for (const p of zone.plates) {
      const gap = p.s0 - prevEnd;
      assert.ok(gap <= 0.2, `zone ${zone.id}: gap of ${gap.toFixed(2)} m before s=${p.s0.toFixed(1)}`);
      assert.ok(p.s1 > p.s0, `zone ${zone.id}: empty plate`);
      covered += p.s1 - p.s0;
      prevEnd = p.s1;
    }
    assert.ok(Math.abs(prevEnd - zone.route.length) < 0.2, `zone ${zone.id}: road ends short of its route`);
    assert.ok(covered / zone.route.length > 0.97, `zone ${zone.id}: road covers ${(covered / zone.route.length * 100).toFixed(1)}%`);
  }
});

test('route geometry is smooth (no sharp kinks or steep climbs)', () => {
  for (const zone of level.parts) {
    const { tan, pts } = zone.route;
    for (let i = 1; i < tan.length; i++) {
      const c = tan[i][0] * tan[i - 1][0] + tan[i][1] * tan[i - 1][1] + tan[i][2] * tan[i - 1][2];
      assert.ok(c > Math.cos(0.12), `zone ${zone.id}: kink at s=${zone.route.s[i].toFixed(0)}`);
      const slope = Math.abs(pts[i][1] - pts[i - 1][1]) / zone.route.spacing;
      assert.ok(slope < Math.tan(0.36), `zone ${zone.id}: climb too steep at s=${zone.route.s[i].toFixed(0)}`);
    }
  }
});

test('portals are paired across different zones and face the direction of travel', () => {
  const entries = level.gates.filter((g) => g.role === 'entry');
  assert.equal(entries.length, LAYOUT.portals.length);
  for (const e of entries) {
    assert.ok(e.pair, `${e.id} has no exit`);
    assert.equal(e.pair.role, 'exit');
    assert.notEqual(e.partId, e.pair.partId, `${e.id} links a zone to itself`);
    const far = distXZ(e.pos, e.pair.pos);
    assert.ok(far > 400, `${e.id} exit is only ${far.toFixed(0)} m away — not a real jump`);
  }
  assert.deepEqual(
    level.gateOrder.map((g) => g.role),
    ['start', 'entry', 'entry', 'finish'],
  );
});

test('the driveable corridor is clear of solid scenery (kerbs are the only walls)', () => {
  // Measure to each solid's real oriented box (in plan), but only where the
  // box is at car height. A roof high above the road is not a wall.
  const halfW = LAYOUT.roadWidth / 2;
  const carR = 1.15; // car collision radius
  const problems = [];
  for (const it of level.solids) {
    if (it.role === 'kerb' || it.role === 'gate') continue;
    const M = it.anchor.world(0);
    const cx = M[12];
    const cy = M[13];
    const cz = M[14];
    const ax = [M[0], M[2]];
    const az = [M[8], M[10]];
    const h = it.half;
    // Vertical half-extent of the rotated box.
    const hy = Math.abs(M[1]) * h[0] + Math.abs(M[5]) * h[1] + Math.abs(M[9]) * h[2];
    for (const zone of level.parts) {
      const pts = zone.route.pts;
      for (let i = 0; i < pts.length; i += 2) {
        const q = pts[i];
        if (Math.abs(q[1] - cy) > hy + 2.5) continue; // not at car height
        const dx = q[0] - cx;
        const dz = q[2] - cz;
        const u = dx * ax[0] + dz * ax[1];
        const v = dx * az[0] + dz * az[1];
        const ex = Math.max(Math.abs(u) - h[0], 0);
        const ez = Math.max(Math.abs(v) - h[2], 0);
        const d = Math.hypot(ex, ez);
        if (d < halfW + carR * 0.5) {
          problems.push(`${it.id} (${it.role}) is ${d.toFixed(2)} m from the road at s=${zone.route.s[i].toFixed(0)}`);
          break;
        }
      }
      if (problems.length > 5) break;
    }
    if (problems.length > 5) break;
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('the wheel probes always find road under the car on the start line', () => {
  const world = new World(level);
  for (let i = 0; i < 240; i++) world.step(1 / 120, { throttle: 0, brake: 0, steer: 0, handbrake: false });
  assert.ok(world.car.grounded, 'car should be grounded at spawn');
  assert.equal(world.stats.falls, 0);
});

test('falling out of the world respawns the car at the last checkpoint', () => {
  const world = new World(level);
  world.car.pos = [0, -200, 0];
  world.step(1 / 120, { throttle: 0, brake: 0, steer: 0, handbrake: false });
  assert.equal(world.stats.falls, 1);
  assert.ok(Math.abs(world.car.pos[0] - level.spawn.pos[0]) < 1);
  assert.ok(world.car.pos[1] > 30);
});

test('the autopilot drives the whole town: start, two portals, finish', async () => {
  const r = await runAutopilot(level);
  assert.ok(r.finished, `not finished after ${r.simSeconds.toFixed(1)} s of simulated time`);
  assert.equal(r.portals, 2);
  assert.equal(r.falls, 0, 'the car should never fall');
  assert.equal(r.collisionsWithScenery, 0, 'the route should be clear of furniture, houses and debris');
});

test('each leg of the race lasts at least 30 seconds of driving', async () => {
  const r = await runAutopilot(level);
  const get = (id) => r.splits.find((s) => s.id === id).t;
  const legs = [
    ['start → portal 1', get('portal-1') - get('start')],
    ['portal 1 exit → portal 2', get('portal-2') - get('portal-1')],
    ['portal 2 exit → finish', get('finish') - get('portal-2')],
  ];
  for (const [name, t] of legs) {
    assert.ok(t >= 30, `${name} takes only ${t.toFixed(1)} s at autopilot pace`);
  }
  assert.ok(r.time >= 90, `total time ${r.time.toFixed(1)} s`);
});

test('the physics is deterministic: two identical runs give identical times', async () => {
  const a = await runAutopilot(level);
  const b = await runAutopilot(level);
  assert.equal(a.time, b.time);
});

test('the road plates move (the road is alive) but stay attached to the road', () => {
  const plate = level.ground[10];
  const t0 = plate.anchor.world(0);
  const t1 = plate.anchor.world(0.7);
  const dy = Math.abs(t0[13] - t1[13]);
  assert.ok(dy > 0.001 && dy < 0.6, `plate bob ${dy.toFixed(3)} m`);
  assert.ok(Math.abs(t0[13] - (plate.staticCenter[1])) < 0.6);
  void UP;
});

test('buildings are fractured: a house is made of several gapped pieces, not one box', () => {
  const walls = level.items.filter((i) => i.role === 'wall' && i.partId === 'A');
  const houses = new Set(walls.map((w) => w.id.split('-').slice(0, 2).join('-')));
  assert.ok(houses.size >= 10, `only ${houses.size} houses in Chimney Row`);
  const perHouse = walls.length / houses.size;
  assert.ok(perHouse >= 4, `walls per house: ${perHouse.toFixed(1)}`);
});

test('the layout respects the minimum route length for each zone', () => {
  for (const { id, length } of level.legLengths) {
    assert.ok(length > 600, `zone ${id} is only ${length.toFixed(0)} m`);
  }
});
