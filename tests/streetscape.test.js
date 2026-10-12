import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  createRoad,
  createCurve,
  junctionFromGesture,
  createDiamond,
  insertRoads,
  validateNetwork,
  roadLength,
  splitRoad,
  getJunctions,
} from '../src/lib/network.js';
import { sampleCurve, frameAt } from '../src/lib/curves.js';
import { buildTopology, SURFACE_Y, PAVING_Y } from '../src/lib/topology.js';
import { planInfrastructure, bridgeReport } from '../src/lib/infrastructure.js';
import {
  planStreetscape,
  curbAccessPlacement,
  anchorCurbAccess,
  resolveCurbAccess,
  streetscapeDistances,
} from '../src/lib/streetscape.js';
import {
  detailPlacement,
  anchorRoadMarking,
  reconcileRoadDetails,
  updatePlacedDetail,
} from '../src/lib/placement.js';
import { markingPlan } from '../src/lib/markings.js';
import { renderSidewalk, renderDrainage } from '../src/engine/streetscape.js';
import { batchRoadSurfaces } from '../src/engine/roads.js';

const p = (x, z, nodeId, y = 0) => ({ x, z, y, ...(nodeId ? { nodeId } : {}) });
const project = (roads, props = []) => ({
  schema: 1,
  name: 'Streetscape',
  size: 2000,
  seed: 42,
  layout: 'grid',
  standard: 'us',
  roads,
  props,
});
const street = (overrides = {}) =>
  createRoad('local', [p(-160, 0, 'a'), p(160, 0, 'b')], 'street', {
    parking: false,
    sidewalk: 2.4,
    lights: false,
    ...overrides,
  });
const context = (network) => ({
  topology: buildTopology(network),
  infrastructure: planInfrastructure(network),
});
const materials = new Proxy(
  {},
  {
    get: (_, name) =>
      new THREE.MeshStandardMaterial({ name: String(name), side: THREE.DoubleSide }),
  },
);
const sceneFor = (network) => {
  const ctx = context(network),
    plan = ctx.topology.plans.get('street'),
    root = new THREE.Group(),
    st = planStreetscape(network, plan, ctx.infrastructure);
  for (const side of [-1, 1])
    renderSidewalk(
      root,
      plan,
      { side, width: plan.road.sidewalk },
      ctx.infrastructure,
      st,
      materials,
    );
  renderDrainage(root, plan, st, materials);
  root.updateMatrixWorld(true);
  return { root, plan, st, ctx };
};
const rayDown = (root, x, z) =>
  new THREE.Raycaster(new THREE.Vector3(x, 3, z), new THREE.Vector3(0, -1, 0)).intersectObject(
    root,
    true,
  );

for (const [type, count, degree] of [
  ['tjunction', 3, 3],
  ['ymerge', 3, 3],
  ['crossroad', 4, 4],
])
  test(`${type} splits the existing road and has a single shared ${degree}-arm junction`, () => {
    const original = street(),
      n = project([original]),
      created = junctionFromGesture(n, type, [p(0, 1), p(-90, 110)], type),
      next = insertRoads(created.base, created.roads);
    assert.equal(next.roads.length, count);
    const nodes = getJunctions(next.roads);
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].roads.length, degree);
    assert.ok(
      Math.abs(
        next.roads
          .filter((r) => r.id === 'street' || r.id.startsWith('street-cut-'))
          .reduce((total, r) => total + roadLength(r), 0) - roadLength(original),
      ) < 0.01,
    );
    assert.equal(validateNetwork(next).roads.length, count);
    if (type === 'ymerge') {
      const curve = createCurve(created.roads[0]);
      assert.ok(curve.getTangentAt(1).dot(createCurve(original).getTangentAt(0.5)) > 0.9999);
      assert.equal(created.roads[0].oneWay, true);
    }
  });

test('connector slicing preserves a curved mainline, and invalid attachment is refused', () => {
  const curved = street({
      points: [p(-160, 0), p(-80, 80), p(60, -80), p(160, 0)],
      curveType: 'bezier',
    }),
    n = project([curved]);
  const position = createCurve(curved).getPointAt(0.4),
    built = junctionFromGesture(
      n,
      'tjunction',
      [position, p(position.x, position.z + 100)],
      'curved',
    );
  const source = sampleCurve(curved, 1),
    pieces = built.base.roads.map((r) => sampleCurve(r, 1));
  for (const s of source.samples)
    assert.ok(
      pieces.some((piece) => piece.samples.some((other) => s.point.distanceTo(other.point) < 1.1)),
    );
  assert.throws(
    () => junctionFromGesture(n, 'tjunction', [p(2000, 2000), p(2100, 2000)]),
    /existing road/,
  );
  assert.throws(
    () => junctionFromGesture(project([street()]), 'tjunction', [p(0, 0), p(0, 10)]),
    /24 m/,
  );
});

function routes(network) {
  const edges = new Map(),
    terminals = [];
  const key = (p) => p.nodeId || `${p.x},${p.z},${p.y || 0}`;
  const add = (a, b) => {
    if (!edges.has(a)) edges.set(a, []);
    edges.get(a).push(b);
  };
  for (const road of network.roads) {
    const a = key(road.points[0]),
      b = key(road.points.at(-1));
    add(a, b);
    if (!road.oneWay) add(b, a);
  }
  const incidence = new Map();
  for (const road of network.roads)
    for (const p of [road.points[0], road.points.at(-1)])
      incidence.set(key(p), (incidence.get(key(p)) || 0) + 1);
  for (const road of network.roads)
    for (const [index, p] of [
      [0, road.points[0]],
      [1, road.points.at(-1)],
    ])
      if (incidence.get(key(p)) === 1)
        terminals.push({
          key: key(p),
          p,
          inbound: index === 0 || !road.oneWay,
          outbound: index === 1 || !road.oneWay,
        });
  const reaches = (a, b) => {
    const seen = new Set([a]),
      q = [a];
    for (const n of q)
      for (const e of edges.get(n) || [])
        if (!seen.has(e)) {
          seen.add(e);
          q.push(e);
        }
    return seen.has(b);
  };
  return { terminals, reaches };
}

test('diamond has 13 real roads, six junctions and all twelve directional movements', () => {
  const n = project(createDiamond({ x: 0, z: 0 }, { id: 'diamond' })),
    { terminals, reaches } = routes(n);
  assert.equal(n.roads.length, 13);
  assert.equal(buildTopology(n).junctions.length, 6);
  assert.equal(terminals.length, 6);
  const direction = (p) =>
    Math.abs(p.x) > Math.abs(p.z) ? (p.x > 0 ? 'east' : 'west') : p.z > 0 ? 'south' : 'north';
  let movements = 0;
  for (const start of terminals.filter((t) => t.inbound))
    for (const end of terminals.filter((t) => t.outbound))
      if (direction(start.p) !== direction(end.p)) {
        assert.ok(reaches(start.key, end.key), `${direction(start.p)} → ${direction(end.p)}`);
        movements++;
      }
  assert.equal(movements, 12);
  assert.equal(n.roads.filter((r) => r.type === 'ramp').length, 4);
  assert.ok(bridgeReport(n.roads[1], n).clearance >= 7);
  assert.equal(planInfrastructure(n).crossings.length, 0);
  assert.ok(!getJunctions(n.roads).some((node) => Math.hypot(node.x, node.z) < 4));
});

test('rotated and left-driving diamonds preserve connected nodes and round-trip metadata', () => {
  for (const standard of ['us', 'uk', 'jp', 'au']) {
    const n = {
      ...project(
        createDiamond(
          { x: 125, z: -275 },
          { id: 'rotated', radius: 75, height: 10, rotation: 0.8, standard },
        ),
      ),
      standard,
    };
    assert.deepEqual(validateNetwork(JSON.parse(JSON.stringify(n))), n);
    assert.equal(buildTopology(n).junctions.length, 6);
    const { terminals, reaches } = routes(n);
    for (const source of terminals.filter((t) => t.inbound))
      assert.ok(
        terminals
          .filter((t) => t.outbound)
          .every((dest) => reaches(source.key, dest.key) || source.key === dest.key),
      );
  }
});

for (const type of ['grate', 'inlet', 'slot', 'combined'])
  test(`${type} drainage avoids both-sided ramps, end portals and railway decks`, () => {
    const road = street({ drainage: type, drainSpacing: 20 }),
      base = project([road]);
    const placement = curbAccessPlacement(base, 'driveway', p(0, 5));
    const prop = anchorCurbAccess({ id: 'access', type: 'driveway' }, placement),
      rail = createRoad('railway', [p(80, -90), p(80, 90)], 'rail');
    const n = project([road, rail], [prop]),
      ctx = context(n),
      plan = ctx.topology.plans.get('street'),
      st = planStreetscape(n, plan, ctx.infrastructure);
    if (type === 'slot') {
      assert.equal(st.slotSpans.size, 2);
      assert.ok(st.slotSpans.get(1).length >= 3);
    } else {
      assert.ok(st.drains.length > 6);
      for (const d of st.drains) {
        assert.ok(d.distance > plan.startTrim + 3 && d.distance < plan.length - plan.endTrim - 3);
        assert.ok(Math.abs(d.distance - 240) > 4);
        if (d.side === placement.side)
          assert.ok(Math.abs(d.distance - placement.distance) > prop.width / 2 + 1);
      }
      assert.ok(st.drains.some((d) => d.side === -1));
      assert.ok(st.drains.some((d) => d.side === 1));
    }
  });

test('generated and placed crosswalks receive transverse, paired curb ramps', () => {
  const road = street(),
    branch = createRoad('local', [p(160, 0, 'b'), p(160, 100, 'c')], 'branch');
  const continuation = createRoad('local', [p(160, 0, 'b'), p(300, 0, 'd')], 'next');
  const n = project([road, branch, continuation]),
    ctx = context(n),
    plan = ctx.topology.plans.get('street');
  const generated = markingPlan(plan, []).zebras,
    st = planStreetscape(n, plan, ctx.infrastructure);
  assert.equal(generated.length, 1);
  assert.equal(st.ramps.length, 2);
  assert.ok(st.ramps.every((r) => r.distance === generated[0].distance));
  const placement = detailPlacement(n, 'crosswalk', p(0, 0)),
    crosswalk = anchorRoadMarking({ id: 'crosswalk', type: 'crosswalk' }, placement);
  const manual = planStreetscape({ ...n, props: [crosswalk] }, plan, ctx.infrastructure);
  assert.equal(manual.ramps.filter((r) => r.id === 'crosswalk').length, 2);
  const off = planStreetscape(
    { ...n, props: [crosswalk] },
    { ...plan, road: { ...road, crosswalkRamps: false } },
    ctx.infrastructure,
  );
  assert.equal(off.ramps.length, 0);
});

test('dropped paving and curb are physically flush with the road, and recover sidewalk height', () => {
  const base = project([street()]),
    placement = curbAccessPlacement(base, 'driveway', p(0, 5)),
    prop = anchorCurbAccess({ id: 'access', type: 'driveway' }, placement);
  const { root, plan, st } = sceneFor({ ...base, props: [prop] });
  const side = placement.side,
    d = placement.distance,
    edge = (side * plan.carriage) / 2;
  assert.equal(st.pavingLift(d, edge, side), SURFACE_Y);
  assert.equal(st.pavingLift(d, (side * plan.width) / 2, side), PAVING_Y);
  const s = frameAt(plan.curve, d, plan.length);
  const mouth = s.point.clone().addScaledVector(s.normal, edge + side * 0.001);
  assert.ok(Math.abs(rayDown(root, mouth.x, mouth.z)[0].point.y - SURFACE_Y) < 0.001);
  for (const u of [0.3, 0.9, 1.8, 2.4]) {
    const point = s.point.clone().addScaledVector(s.normal, edge + side * u),
      hits = rayDown(root, point.x, point.z);
    assert.ok(hits.length);
    assert.ok(Math.abs(hits[0].point.y - st.pavingLift(d, edge + side * u, side)) < 0.002);
  }
  const ordinary = frameAt(plan.curve, d + 10, plan.length),
    point = ordinary.point.clone().addScaledVector(ordinary.normal, edge + side * 0.5);
  assert.ok(Math.abs(rayDown(root, point.x, point.z)[0].point.y - PAVING_Y) < 1e-6);
  assert.ok(
    root.children.some((m) => m.name === 'Vehicle_access_apron' && m.userData.propId === prop.id),
  );
  for (const mesh of root.children) {
    assert.ok([...mesh.geometry.attributes.position.array].every(Number.isFinite));
    assert.ok([...mesh.geometry.attributes.normal.array].every(Number.isFinite));
  }
});

test('inlets cut the actual curb beam and keep a recessed throat, lintel and grate', () => {
  const { root, plan, st } = sceneFor(
    project([street({ drainage: 'combined', drainSpacing: 30 })]),
  );
  const drain = st.drains[0],
    s = frameAt(plan.curve, drain.distance + 0.18, plan.length);
  const start = s.point.clone().addScaledVector(s.normal, drain.side * (plan.carriage / 2 - 0.2));
  start.y = 0.18;
  const ray = new THREE.Raycaster(start, s.normal.clone().multiplyScalar(drain.side));
  const hits = ray.intersectObject(root, true);
  assert.ok(!hits.some((h) => h.object.name === 'Raised_curb_with_ramp_drops' && h.distance < 0.4));
  assert.ok(root.children.some((m) => m.name === 'Kerb_inlet_throat'));
  assert.ok(root.children.some((m) => m.name === 'Gutter_grate_bar'));
});

test('curb ramp width, run and side edits, road reshaping and splitting share one saved anchor', () => {
  let base = project([street()]),
    placement = curbAccessPlacement(base, 'curbRamp', p(90, -5)),
    prop = anchorCurbAccess({ id: 'access', type: 'curbRamp' }, placement);
  base = { ...base, props: [prop] };
  const edited = updatePlacedDetail(base, prop, {
    width: 4,
    rampDepth: 1.5,
    curbSide: -placement.side,
  });
  assert.equal(edited.width, 4);
  assert.equal(edited.rampDepth, 1.5);
  assert.equal(edited.curbAnchor.side, -placement.side);
  const next = reconcileRoadDetails(splitRoad(base, 'street'), base),
    resolved = resolveCurbAccess(next, next.props[0]);
  assert.ok(resolved);
  assert.notEqual(next.props[0].roadId, 'street');
  assert.ok(Math.hypot(resolved.prop.x - prop.x, resolved.prop.z - prop.z) < 0.02);
  const elevated = reconcileRoadDetails(
    {
      ...next,
      roads: next.roads.map((r) => ({
        ...r,
        points: r.points.map((p) => ({ ...p, x: p.x + 20, y: 2 })),
      })),
    },
    next,
  );
  assert.ok(Math.abs(elevated.props[0].x - next.props[0].x - 20) < 0.01);
  assert.equal(elevated.props[0].y, 2);
  assert.equal(resolveCurbAccess({ ...base, roads: [] }, prop), null);
  assert.equal(
    updatePlacedDetail({ ...base, roads: [street({ sidewalk: 0 })] }, prop, { width: 6 }),
    null,
  );
});

test('ramp stations survive coarse sampling, and batching retains access-asset picking IDs', () => {
  const ramp = { distance: 17.3, width: 3, flare: 0.5 };
  const ds = streetscapeDistances(0, 40, [ramp], [0, 10, 20, 30, 40]);
  assert.ok(ds.includes(17.3));
  assert.ok(ds.includes(15.3));
  assert.ok(ds.includes(19.3));
  const root = new THREE.Group(),
    mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 0.3, 2), new THREE.MeshBasicMaterial());
  mesh.userData = { roadId: 'street', propId: 'access' };
  root.add(mesh);
  batchRoadSurfaces(root, true);
  assert.equal(root.children[0].userData.faceRanges[0].propId, 'access');
});

test('new drainage and access fields round-trip, malformed imports are rejected', () => {
  const road = street({ drainage: 'combined', drainSpacing: 24, crosswalkRamps: true }),
    n = project([road]);
  n.props.push(
    anchorCurbAccess(
      { id: 'access', type: 'driveway' },
      curbAccessPlacement(n, 'driveway', p(50, 5)),
    ),
  );
  assert.deepEqual(validateNetwork(JSON.parse(JSON.stringify(n))), n);
  for (const changes of [
    { drainage: 'pipe' },
    { drainSpacing: 0 },
    { drainSpacing: NaN },
    { crosswalkRamps: 1 },
  ])
    assert.throws(() => validateNetwork({ ...n, roads: [{ ...road, ...changes }] }));
  for (const changes of [
    { curbAnchor: { t: 1.1, side: 1 } },
    { curbAnchor: { t: 0.5, side: 0 } },
    { curbAnchor: null },
    { roadId: null },
    { rampDepth: -1 },
  ])
    assert.throws(() => validateNetwork({ ...n, props: [{ ...n.props[0], ...changes }] }));
});

test('connector tools refuse parallel mainline duplication and shallow T crossings', () => {
  const n = project([street()]);
  for (const type of ['tjunction', 'crossroad', 'ymerge'])
    assert.throws(
      () => junctionFromGesture(n, type, [p(0, 0), p(100, 0)]),
      /outside the existing road/,
    );
  assert.throws(() => junctionFromGesture(n, 'tjunction', [p(0, 0), p(100, 10)]), /15°/);
});

test("automatic drops use the renderer's clamped crossing position; custom pads replace coincident defaults", () => {
  const road = street(),
    placement = detailPlacement(project([road]), 'crosswalk', p(0, 0));
  const crossing = anchorRoadMarking({ id: 'zebra', type: 'crosswalk' }, placement);
  crossing.roadAnchor.t = 0;
  const n = project([road], [crossing]),
    ctx = context(n),
    plan = ctx.topology.plans.get('street');
  const st = planStreetscape(n, plan, ctx.infrastructure);
  assert.equal(st.ramps.length, 2);
  assert.ok(st.ramps.every((r) => r.distance > 1.65));
  const custom = anchorCurbAccess(
    { id: 'custom', type: 'curbRamp' },
    curbAccessPlacement(n, 'curbRamp', p(0, 5)),
  );
  const centred = anchorRoadMarking({ ...crossing, roadAnchor: undefined }, placement);
  const merged = planStreetscape({ ...n, props: [centred, custom] }, plan, ctx.infrastructure);
  assert.equal(merged.ramps.length, 2);
  assert.equal(merged.ramps.filter((r) => r.propId === custom.id).length, 1);
});

test('pedestrian pad and paving follow both sides of a curved, graded road without invalid normals', () => {
  const road = street({
      points: [
        p(-160, 0, undefined, 0),
        p(-70, 70, undefined, 1),
        p(70, -70, undefined, 2),
        p(160, 0, undefined, 3),
      ],
      curveType: 'bezier',
    }),
    n = project([road]);
  const source = createCurve(road).getPointAt(0.5);
  const placement = curbAccessPlacement(n, 'curbRamp', source),
    prop = anchorCurbAccess({ id: 'ped', type: 'curbRamp' }, placement);
  const { root, st, plan } = sceneFor({ ...n, props: [prop] });
  assert.ok(root.children.some((m) => m.name === 'Tactile_crosswalk_warning_pad'));
  assert.equal(
    st.pavingLift(placement.distance, (placement.side * plan.carriage) / 2, placement.side),
    SURFACE_Y,
  );
  for (const mesh of root.children)
    for (const attr of Object.values(mesh.geometry.attributes))
      assert.ok([...attr.array].every(Number.isFinite));
});
