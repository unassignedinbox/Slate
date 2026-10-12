import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  createRoad,
  splitRoad,
  addRoadWithIntersections,
  validateNetwork,
  laneLayout,
  laneDirection,
} from '../src/lib/network.js';
import {
  detailPlacement,
  anchorRoadMarking,
  resolveRoadMarking,
  updatePlacedDetail,
  reconcileRoadDetails,
} from '../src/lib/placement.js';
import { buildTopology } from '../src/lib/topology.js';
import {
  planInfrastructure,
  bridgeSupports,
  PIER_FOOTING,
  distanceToPath,
} from '../src/lib/infrastructure.js';
import { buildProp } from '../src/engine/roads.js';
import { renderRoad } from '../src/engine/features.js';
import { markingPlan } from '../src/lib/markings.js';

const p = (x, z, y = 0) => ({ x, z, y });
const project = (roads, props = []) => ({
  schema: 1,
  name: 'Anchored details',
  size: 2000,
  seed: 42,
  layout: 'grid',
  standard: 'us',
  roads,
  props,
});
const street = () =>
  createRoad('local', [p(0, 0), p(180, 0)], 'street', {
    parking: false,
    lights: false,
    markings: false,
  });
const context = (n) => ({
  network: n,
  topology: buildTopology(n),
  infrastructure: planInfrastructure(n),
});
function anchored(n, type = 'arrow', position = p(135, 1.5)) {
  const placement = detailPlacement(n, type, position);
  assert.ok(placement);
  return anchorRoadMarking({ id: 'paint', type }, placement, {
    snapLane: type === 'arrow',
    standard: n.standard,
  });
}
const close = (a, b, tolerance = 0.00001) =>
  assert.ok(Math.abs(a - b) < tolerance, `${a} should equal ${b}`);

test('arrows have road-frame anchors, snap to a driving lane and respect regional flow', () => {
  for (const standard of ['us', 'uk', 'jp', 'au']) {
    const n = { ...project([street()]), standard },
      prop = anchored(n);
    const band = laneLayout(n.roads[0]).find(
      (b) => b.kind === 'lane' && Math.abs(b.center - prop.roadAnchor.offset) < 0.001,
    );
    assert.ok(band);
    close(prop.roadAnchor.t, 0.75);
    assert.equal(
      Math.abs(prop.roadAnchor.angle) > 1,
      laneDirection(n.roads[0], band.side, standard) === -1,
    );
    validateNetwork({ ...n, props: [prop] });
  }
});

test('numeric marking movement saves the same clamped placement the renderer uses', () => {
  const n = project([street()]),
    prop = anchored(n);
  const moved = updatePlacedDetail(n, prop, { x: 115, z: 5 });
  assert.ok(moved);
  assert.notEqual(moved.z, 5);
  const resolved = resolveRoadMarking(n, moved);
  for (const key of ['x', 'y', 'z', 'rotation', 'width']) close(moved[key], resolved.prop[key]);
  const rotated = updatePlacedDetail(n, moved, { rotation: 0.73 });
  close(rotated.rotation, 0.73);
  const floating = updatePlacedDetail(n, rotated, { surfaceLift: 50 });
  close(floating.roadAnchor.lift, 0.03);
  assert.equal('surfaceLift' in floating, false);
  assert.equal(updatePlacedDetail(n, prop, { x: 10000, z: 10000 }), null);
});

test('attached decals follow road translation, reshaping and deck-height edits', () => {
  const old = project([street()]);
  old.props = [anchored(old)];
  const transformed = {
    ...old,
    roads: old.roads.map((r) => ({
      ...r,
      points: r.points.map((q) => p(q.x + 50, q.z - 30, q.y + 8)),
    })),
  };
  const next = reconcileRoadDetails(transformed, old),
    prop = next.props[0];
  close(prop.x, old.props[0].x + 50);
  close(prop.z, old.props[0].z - 30);
  close(prop.y, 8);
  close(prop.roadAnchor.t, old.props[0].roadAnchor.t);
  const bent = reconcileRoadDetails(
    {
      ...next,
      roads: [{ ...next.roads[0], points: [p(50, -30, 8), p(130, 35, 10), p(230, -30, 8)] }],
    },
    next,
  );
  assert.ok(bent.props[0].z > prop.z + 5);
  assert.ok(bent.props[0].y > 8);
  validateNetwork(bent);
});

test('splitting a road remaps the paint anchor onto the correct child without a jump', () => {
  const old = project([street()]);
  old.props = [anchored(old)];
  const next = reconcileRoadDetails(splitRoad(old, 'street'), old),
    prop = next.props[0];
  assert.notEqual(prop.roadId, 'street');
  assert.ok(next.roads.some((r) => r.id === prop.roadId));
  close(prop.x, old.props[0].x);
  close(prop.z, old.props[0].z);
  close(prop.roadAnchor.t, 0.5);
  validateNetwork(next);
});

test('inserting a crossing remaps anchors by distance and masks the new junction', () => {
  const old = project([street()]);
  old.props = [anchored(old)];
  const next = reconcileRoadDetails(
    addRoadWithIntersections(old, createRoad('local', [p(95, -70), p(95, 70)], 'cross')),
    old,
  );
  const prop = next.props[0],
    resolved = resolveRoadMarking(next, prop);
  assert.notEqual(prop.roadId, 'street');
  close(prop.x, old.props[0].x, 0.01);
  assert.ok(markingPlan(resolved.plan).fits(resolved.distance, 2.4));
  validateNetwork(next);
});

test('crosswalk rotation remains transverse and width is clamped to the carriageway', () => {
  const n = project([street()]),
    prop = anchored(n, 'crosswalk');
  const edited = updatePlacedDetail(n, prop, { rotation: 2.5, width: 80 });
  const resolved = resolveRoadMarking(n, edited);
  close(edited.rotation, resolved.rotation);
  close(edited.roadAnchor.angle, 0);
  close(edited.width, resolved.plan.carriage - 0.4);
  close(edited.roadAnchor.offset, 0);
});

test('surface picking distinguishes an upper deck from the road directly below it', () => {
  const lower = street(),
    upper = { ...street(), id: 'upper', points: [p(0, 0, 8), p(180, 0, 8)], type: 'bridge' };
  const n = project([lower, upper]);
  assert.equal(detailPlacement(n, 'arrow', p(135, 1.5, 8)).roadId, 'upper');
  assert.equal(detailPlacement(n, 'arrow', p(135, 1.5, 0)).roadId, 'street');
});

test('deleted or hidden attached roads never fall back to floating boxed paint', () => {
  const n = project([street()]),
    prop = anchored(n);
  for (const roads of [[], [{ ...n.roads[0], hidden: true }]]) {
    const missing = { ...n, roads, props: [prop] },
      group = new THREE.Group();
    const rendered = buildProp(group, prop, context(missing));
    assert.equal(rendered.children.length, 0);
    assert.equal(rendered.userData.invalidAttachment, true);
    assert.equal(resolveRoadMarking(missing, prop), null);
  }
});

test('legacy road-ID decals are upgraded without losing their authoring identity', () => {
  const n = project(
    [street()],
    [
      {
        id: 'legacy',
        type: 'crosswalk',
        roadId: 'street',
        x: 120,
        z: 1,
        y: 0,
        rotation: 0,
        width: 7,
      },
    ],
  );
  const migrated = reconcileRoadDetails(n);
  assert.equal(migrated.props[0].id, 'legacy');
  assert.ok(migrated.props[0].roadAnchor);
  close(migrated.props[0].z, 0);
  validateNetwork(migrated);
});

test('malformed or incomplete marking anchors are rejected at import', () => {
  const n = project([street()]);
  n.props = [anchored(n)];
  for (const [key, value] of [
    ['t', 1.1],
    ['lift', -1],
    ['offset', Infinity],
    ['angle', 20],
  ]) {
    const bad = structuredClone(n);
    bad.props[0].roadAnchor[key] = value;
    assert.throws(() => validateNetwork(bad), /anchor/);
  }
  const missing = structuredClone(n);
  delete missing.props[0].roadAnchor.t;
  assert.throws(() => validateNetwork(missing), /anchor/);
});

test('wide bridge piers avoid a parallel lower road underneath either physical foot', () => {
  const upper = createRoad('bridge', [p(0, 0, 8), p(180, 0, 8)], 'wide', {
    lanes: 12,
    median: 1,
    lights: false,
  });
  const offset = (upper.lanes * upper.laneWidth + upper.median + upper.sidewalk * 2) * 0.34;
  for (const type of ['local', 'railway']) {
    const lower = createRoad(type, [p(0, offset), p(180, offset)], 'lower');
    const n = project([upper, lower]),
      ctx = context(n);
    assert.ok(
      bridgeSupports(
        upper,
        planInfrastructure(project([upper])),
        buildTopology(project([upper])).plans.get('wide'),
      ).length > 0,
    );
    assert.equal(
      bridgeSupports(upper, ctx.infrastructure, ctx.topology.plans.get('wide')).length,
      0,
    );
  }
});

test('planned pier feet, rendered footings and lower-road exclusion share dimensions', () => {
  const upper = createRoad('bridge', [p(0, 0, 8), p(180, 0, 8)], 'upper', {
    lights: false,
    markings: false,
  });
  const lower = createRoad('local', [p(80, -120), p(80, 120)], 'lower');
  const n = project([upper, lower]),
    ctx = context(n),
    plan = ctx.topology.plans.get('upper');
  const supports = bridgeSupports(upper, ctx.infrastructure, plan),
    group = new THREE.Group(),
    surfaces = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial(),
    materials = new Proxy({}, { get: () => mat });
  renderRoad(
    group,
    surfaces,
    plan,
    ctx.infrastructure,
    materials,
    { poles: [], lamps: [], trees: [], trunks: [], bollards: [] },
    { fixtures: false, vegetation: false },
    null,
    'us',
  );
  const footings = group.children.filter((m) => m.name === 'Bridge_pier_footing');
  assert.equal(footings.length, supports.length * 2);
  for (const f of footings) {
    close(f.geometry.parameters.width, PIER_FOOTING.width);
    close(f.geometry.parameters.depth, PIER_FOOTING.length);
    assert.ok(
      f.position.y - PIER_FOOTING.height / 2 < -0.24,
      'base is embedded in the displayed terrain',
    );
    assert.ok(distanceToPath(f.position, ctx.infrastructure.prepared.get('lower')).distance > 5);
  }
  for (const parent of [group, surfaces]) parent.traverse((m) => m.geometry?.dispose());
  mat.dispose();
});
