import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  createRoad,
  generateNetwork,
  createCloverleaf,
  createOverpass,
  validateNetwork,
  addRoadWithIntersections,
  splitRoad,
  createCurve,
  getJunctions,
  laneDirection,
  roadWidth,
  createRoundabout,
} from '../src/lib/network.js';
import { buildTopology, SURFACE_Y, PAVING_Y } from '../src/lib/topology.js';
import {
  networkSurfaceGeometry,
  pavementReturnGeometry,
  volumeRibbonGeometry,
  pathSamples,
  polygonVolumeGeometry,
} from '../src/engine/geometry.js';
import { curveIntersections } from '../src/lib/connectivity.js';
import {
  planInfrastructure,
  bridgeSupports,
  bridgeReport,
  distanceToPath,
} from '../src/lib/infrastructure.js';
import { markingPlan } from '../src/lib/markings.js';
import { addBezierHandle } from '../src/lib/curves.js';

const p = (x, z, nodeId, y = 0) => ({ x, z, y, ...(nodeId ? { nodeId } : {}) });
const project = (roads) => ({
  schema: 1,
  name: 'Infrastructure test',
  size: 2000,
  seed: 42,
  layout: 'grid',
  standard: 'us',
  roads,
  props: [],
});
const assertFinite = (g) => {
  for (const attribute of ['position', 'normal', 'uv'])
    assert.ok(
      [...g.attributes[attribute].array].every(Number.isFinite),
      `${attribute} must be finite`,
    );
  assert.ok([...g.index.array].every((i) => i >= 0 && i < g.attributes.position.count));
};
const edgeCounts = (g) => {
  const counts = new Map();
  for (let i = 0; i < g.index.count; i += 3) {
    const face = [g.index.getX(i), g.index.getX(i + 1), g.index.getX(i + 2)];
    for (let j = 0; j < 3; j++) {
      const a = face[j],
        b = face[(j + 1) % 3],
        key = a < b ? `${a},${b}` : `${b},${a}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return counts;
};
function assertStitched(topology) {
  const geometry = networkSurfaceGeometry(topology),
    edges = edgeCounts(geometry),
    positions = geometry.attributes.position;
  const find = (p) => {
    for (let i = 0; i < positions.count; i++)
      if (
        Math.hypot(positions.getX(i) - p.x, positions.getY(i) - p.y, positions.getZ(i) - p.z) <
        0.0002
      )
        return i;
    return -1;
  };
  for (const node of topology.junctions)
    for (const arm of node.arms) {
      const s = arm.start ? arm.plan.samples[0] : arm.plan.samples.at(-1);
      const ends = [-1, 1].map((sign) => {
        const p = s.point.clone().addScaledVector(s.normal, (sign * arm.carriage) / 2);
        p.y += SURFACE_Y;
        return find(p);
      });
      assert.ok(
        ends.every((i) => i >= 0),
        `portal vertices missing: ${node.id}`,
      );
      const key = ends[0] < ends[1] ? ends.join(',') : ends.reverse().join(',');
      assert.equal(
        edges.get(key),
        2,
        `${node.id} / ${arm.road.id}: a stitched portal must have two incident faces`,
      );
    }
  assertFinite(geometry);
  assert.ok(
    [...edges.values()].every((count) => count <= 2),
    'surface has no non-manifold edges',
  );
  geometry.dispose();
}

const curvedJunction = () => {
  const n = p(0, 0, 'junction');
  return project([
    createRoad('arterial', [n, p(24, 6), p(75, 80), p(130, 100)], 'curve'),
    createRoad('local', [n, p(-100, -12)], 'west'),
    createRoad('local', [n, p(-20, 100)], 'south'),
  ]);
};

test('curved junctions use the actual trimmed spline sections, not control-point chords', () => {
  const topology = buildTopology(curvedJunction());
  assert.equal(topology.junctions.length, 1);
  for (const arm of topology.junctions[0].arms) {
    const s = arm.start ? arm.plan.samples[0] : arm.plan.samples.at(-1);
    assert.ok(arm.center.distanceTo(s.point) < 1e-10);
    assert.ok(Math.abs(arm.center.y - s.point.y) < 1e-10);
  }
  assertStitched(topology);
});

test('starter, organic, radial and cloverleaf surfaces have welded road/junction portal edges', () => {
  for (const layout of ['grid', 'organic', 'radial', 'cloverleaf'])
    assertStitched(buildTopology(generateNetwork({ layout, size: 1800, density: 5 })));
});

test('junction surfaces are at road height and paving is a ring, not an overlapping hull', () => {
  const t = buildTopology(curvedJunction()),
    j = t.junctions[0];
  const g = networkSurfaceGeometry(t);
  for (let i = 0; i < g.attributes.position.count; i++)
    assert.ok(Math.abs(g.attributes.position.getY(i) - SURFACE_Y) < 1e-6);
  for (const ret of j.returns) {
    const pavement = pavementReturnGeometry(ret.inner, ret.outer);
    for (let i = 0; i < pavement.attributes.position.count; i++)
      assert.ok(Math.abs(pavement.attributes.position.getY(i) - PAVING_Y) < 1e-6);
    assertFinite(pavement);
    pavement.dispose();
  }
  g.dispose();
});

test('ray coverage along every curved junction portal has no open triangle gaps', () => {
  const t = buildTopology(curvedJunction()),
    g = networkSurfaceGeometry(t);
  const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  mesh.updateMatrixWorld();
  const ray = new THREE.Raycaster();
  for (const j of t.junctions)
    for (const a of j.arms) {
      const s = a.start ? a.plan.samples[0] : a.plan.samples.at(-1);
      for (const along of [-0.08, 0.08])
        for (const side of [-0.85, -0.3, 0, 0.3, 0.85]) {
          const q = s.point
            .clone()
            .addScaledVector(s.normal, (side * a.carriage) / 2)
            .addScaledVector(s.tangent, along);
          ray.set(new THREE.Vector3(q.x, 5, q.z), new THREE.Vector3(0, -1, 0));
          assert.ok(ray.intersectObject(mesh).length, `surface gap at ${a.road.id}`);
        }
    }
  g.dispose();
  mesh.material.dispose();
});

test('degree-two circular seams share cross-sections without bulky junction patches', () => {
  const roads = createRoundabout({ x: 0, z: 0 }, 35),
    t = buildTopology(project(roads));
  assert.equal(t.junctions.length, 0);
  for (const node of t.nodes.values()) {
    const caps = node.arms.map((a) => (a.start ? a.plan.samples[0] : a.plan.samples.at(-1)));
    const edgeSets = caps.map((s) =>
      [-1, 1].map((v) => s.point.clone().addScaledVector(s.normal, (v * roadWidth(roads[0])) / 2)),
    );
    assert.ok(edgeSets[0].every((p) => edgeSets[1].some((q) => p.distanceTo(q) < 1e-8)));
  }
});

test('short, acute joins retain finite geometry after trim clamping', () => {
  const a = p(0, 0, 'a'),
    b = p(0, 9, 'b');
  const roads = [
    createRoad('boulevard', [a, b], 'short'),
    createRoad('local', [a, p(-70, 4)], 'in'),
    createRoad('local', [b, p(65, 25)], 'out'),
  ];
  const t = buildTopology(project(roads));
  assertStitched(t);
});

test('curved at-grade crossings split into connected roads while retaining shape', () => {
  const a = createRoad('local', [p(-140, -60), p(0, 15), p(140, -60)], 'curved');
  const b = createRoad('local', [p(0, -100), p(0, 100)], 'straight');
  const before = createCurve(a).getLength() + createCurve(b).getLength();
  const n = addRoadWithIntersections(project([a]), b);
  assert.equal(n.roads.length, 4);
  assert.equal(getJunctions(n.roads).length, 1);
  assert.ok(
    Math.abs(n.roads.reduce((sum, r) => sum + createCurve(r).getLength(), 0) - before) < 0.1,
  );
  assert.doesNotThrow(() => validateNetwork(n));
  assertStitched(buildTopology(n));
});

test('Bézier splitting and added handles preserve the curve and tangents', () => {
  const road = createCloverleaf({ x: 0, z: 0 }, { id: 'analytic' }).find((r) => r.loopRamp);
  const original = createCurve(road),
    changed = createCurve({ ...road, points: addBezierHandle(road) });
  for (let i = 0; i <= 20; i++)
    assert.ok(original.getPointAt(i / 20).distanceTo(changed.getPointAt(i / 20)) < 0.03);
  const n = splitRoad(project([road]), road.id),
    curves = n.roads.map(createCurve);
  assert.equal(n.roads.length, 2);
  assert.ok(Math.abs(curves[0].getLength() + curves[1].getLength() - original.getLength()) < 0.03);
  assert.ok(curves[0].getTangentAt(1).dot(curves[1].getTangentAt(0)) > 0.999);
  assert.doesNotThrow(() => validateNetwork(n));
});

test('continuous rail intersects roads without creating a road connection', () => {
  const road = createRoad('local', [p(-120, 0), p(120, 0)], 'street');
  const rail = createRoad('railway', [p(0, -100), p(0, 100)], 'rail');
  const n = addRoadWithIntersections(project([road]), rail),
    infra = planInfrastructure(n);
  assert.equal(n.roads.length, 2);
  assert.equal(getJunctions(n.roads).length, 0);
  assert.equal(infra.crossings.length, 1);
  assert.ok(infra.roadCrossings.get(road.id)[0][1] > infra.roadCrossings.get(road.id)[0][0]);
  assert.equal(roadWidth(rail), 8.4);
  assert.equal(rail.gauge, 1.435);
  assert.doesNotThrow(() => validateNetwork(n));
});

test('grade-separated rail/road crossings never receive ground crossing panels', () => {
  const upper = createRoad('bridge', [p(-100, 0, undefined, 8), p(100, 0, undefined, 8)], 'upper');
  const rail = createRoad('railway', [p(0, -100), p(0, 100)], 'rail');
  assert.equal(planInfrastructure(project([upper, rail])).crossings.length, 0);
});

test('angled and curved railway crossings are detected and reserve wider decks', () => {
  const road = createRoad('arterial', [p(-160, 0), p(160, 0)], 'street');
  const rail = createRoad('railway', [p(-70, -150), p(0, 12), p(90, 150)], 'rail');
  const i = planInfrastructure(project([road, rail]));
  assert.equal(i.crossings.length, 1);
  const c = i.crossings[0];
  assert.ok(c.sine < 1 && c.sine > 0.5);
  assert.ok(c.roadSpan[1] - c.roadSpan[0] > roadWidth(rail));
});

test('overpass has a flat high span, gentle ramps and measured lower-road clearance', () => {
  const upper = createOverpass([p(0, -350), p(0, 350)], 8, 'overpass');
  const lower = createRoad('local', [p(-200, 0), p(200, 0)], 'lower');
  const n = project([upper, lower]),
    report = bridgeReport(upper, n);
  assert.ok(Math.abs(createCurve(upper).getPointAt(0.5).y - 8) < 0.001);
  assert.equal(report.crossings.length, 1);
  assert.ok(report.clearance > 7 && report.clearance < 7.3);
  assert.ok(report.maxGrade < 6);
  assert.equal(getJunctions(n.roads).length, 0);
  assert.doesNotThrow(() => validateNetwork(n));
});

test('bridge piers avoid every lower road and railway footprint', () => {
  const upper = createOverpass([p(0, -350), p(0, 350)], 8, 'overpass');
  const road = createRoad('boulevard', [p(-200, 0), p(200, 0)], 'lower');
  const rail = createRoad('railway', [p(-200, 36), p(200, 36)], 'rail');
  const n = project([upper, road, rail]),
    i = planInfrastructure(n),
    t = buildTopology(n);
  const supports = bridgeSupports(upper, i, t.plans.get(upper.id));
  assert.ok(supports.length > 3);
  for (const support of supports)
    for (const lower of [road, rail])
      assert.ok(
        distanceToPath(support.point, i.prepared.get(lower.id)).distance >=
          roadWidth(lower) / 2 + 4,
      );
});

test('paint footprint tests prevent arrows and lane lines entering junction or rail buffers', () => {
  const n = curvedJunction(),
    t = buildTopology(n),
    plan = t.plans.get('curve');
  const rail = [[60, 76]],
    m = markingPlan(plan, rail);
  assert.equal(m.fits(plan.startTrim + 2, 2.5), false);
  assert.equal(m.fits(68, 2.5), false);
  assert.equal(m.fits(59, 2.5), false);
  assert.equal(m.fits(94, 2.5), true);
  for (const [a, b] of m.allowed) assert.ok(b <= 57 || a >= 79);
});

test('cloverleaf has 28 real segments, 16 shared merges and eight directed connectors', () => {
  const roads = createCloverleaf({ x: 20, z: -30 }, { id: 'clover-test' }),
    n = project(roads);
  assert.equal(roads.length, 28);
  assert.equal(roads.filter((r) => r.type === 'ramp').length, 8);
  assert.equal(roads.filter((r) => r.loopRamp).length, 4);
  assert.equal(getJunctions(roads).length, 16);
  assert.ok(getJunctions(roads).every((j) => j.roads.length === 3));
  assert.ok(roads.every((r) => r.oneWay));
  assert.doesNotThrow(() => validateNetwork(n));
  assert.deepEqual(validateNetwork(JSON.parse(JSON.stringify(n))), n);
});

test('all twelve straight/left/right movements through the cloverleaf are connected', () => {
  const roads = createCloverleaf({ x: 0, z: 0 }, { id: 'routes' });
  const entries = roads.filter(
    (r) => r.mainline && !roads.some((other) => other.points.at(-1).nodeId === r.points[0].nodeId),
  );
  const exits = roads.filter(
    (r) => r.mainline && !roads.some((other) => other.points[0].nodeId === r.points.at(-1).nodeId),
  );
  assert.equal(entries.length, 4);
  assert.equal(exits.length, 4);
  const reachable = (start) => {
    const seen = new Set(),
      queue = [start.points[0].nodeId];
    while (queue.length) {
      const id = queue.shift();
      if (seen.has(id)) continue;
      seen.add(id);
      for (const r of roads) if (r.points[0].nodeId === id) queue.push(r.points.at(-1).nodeId);
    }
    return seen;
  };
  for (const entry of entries) {
    const seen = reachable(entry);
    const destinations = exits.filter(
      (r) =>
        r.name !==
        {
          'Eastbound expressway': 'Westbound expressway',
          'Westbound expressway': 'Eastbound expressway',
          'Northbound overpass': 'Southbound overpass',
          'Southbound overpass': 'Northbound overpass',
        }[entry.name],
    );
    assert.equal(destinations.length, 3);
    assert.ok(
      destinations.every((r) => seen.has(r.points.at(-1).nodeId)),
      `${entry.name} must connect to straight, left and right exits`,
    );
  }
});

test('central cloverleaf mainlines are separated by height, not a four-way node', () => {
  const roads = createCloverleaf({ x: 0, z: 0 }, { id: 'grade' });
  const eb = roads.find(
    (r) => r.name === 'Eastbound expressway' && r.points[0].x < 0 && r.points.at(-1).x > 0,
  );
  const nb = roads.find(
    (r) => r.name === 'Northbound overpass' && r.points[0].z > 0 && r.points.at(-1).z < 0,
  );
  const hits = curveIntersections(eb, nb);
  assert.equal(hits.length, 1);
  assert.ok(hits[0].bY - hits[0].aY > 7.9);
  assert.ok(!getJunctions(roads).some((j) => j.roads.includes(eb.id) && j.roads.includes(nb.id)));
  assert.ok(bridgeReport(nb, project(roads)).clearance > 7);
});

test('cloverleaf templates support rotated placement and left-driving profiles', () => {
  for (const standard of ['us', 'uk', 'jp', 'au', 'eu']) {
    const roads = createCloverleaf(
      { x: 500, z: -280 },
      { id: `clover-${standard}`, rotation: 0.73, standard, radius: 45 },
    );
    const n = { ...project(roads), standard };
    validateNetwork(n);
    assertStitched(buildTopology(n));
  }
  const street = createRoad('local', [p(0, 0), p(0, 100)], 'two-way');
  assert.equal(laneDirection(street, 1, 'us'), 1);
  assert.equal(laneDirection(street, -1, 'uk'), 1);
});

test('cloverleaf generator is deterministic and surface rail is an independent feature', () => {
  const options = {
    layout: 'cloverleaf',
    seed: 907,
    railway: true,
    loopRadius: 60,
    bridgeHeight: 9,
  };
  const a = generateNetwork(options),
    b = generateNetwork(options);
  assert.deepEqual(a, b);
  assert.equal(a.roads.length, 29);
  validateNetwork(a);
  assert.equal(planInfrastructure(a).crossings.length, 2);
  assert.equal(generateNetwork({ ...options, railway: false }).roads.length, 28);
});

test('closed guardrail/slab meshes have finite attributes and correctly oriented top faces', () => {
  const t = buildTopology(curvedJunction()),
    j = t.junctions[0],
    samples = pathSamples(j.returns[0].inner, true);
  const beam = volumeRibbonGeometry(samples, 0.2, 0.1, 0.1, 0.32);
  assertFinite(beam);
  assert.ok(beam.attributes.normal.getY(0) > 0.99);
  const slab = polygonVolumeGeometry(j.boundary, -0.7, 0.075, j);
  assertFinite(slab);
  beam.dispose();
  slab.dispose();
});

test('hidden roads cannot leave detached junction patches in the live topology', () => {
  const n = curvedJunction();
  n.roads[1].hidden = true;
  const t = buildTopology(n);
  assert.equal(t.plans.size, 2);
  assert.ok(t.junctions.every((j) => j.arms.every((a) => !a.road.hidden)));
  assert.equal(buildTopology(n, { includeHidden: true }).plans.size, 3);
});

test('validation rejects malformed new curve and infrastructure parameters', () => {
  const road = createOverpass([p(0, -200), p(0, 200)]);
  assert.throws(
    () => validateNetwork(project([{ ...road, points: road.points.slice(0, -1) }])),
    /Bézier/,
  );
  assert.throws(
    () => validateNetwork(project([{ ...road, deckThickness: Infinity }])),
    /deckThickness/,
  );
  const rail = createRoad('railway', [p(-100, 0), p(100, 0)]);
  assert.throws(() => validateNetwork(project([{ ...rail, gauge: NaN }])), /gauge/);
  assert.throws(() => validateNetwork(project([{ ...rail, crossings: 'yes' }])), /crossings/);
  assert.throws(() => validateNetwork(project([{ ...rail, lanes: 8 }])), /track count/);
});

test('rail crossing at a junction also lowers paving returns to the shared deck portals', async () => {
  const { renderRoad, renderJunction } = await import('../src/engine/features.js');
  const node = p(0, 0, 'shared');
  const roads = [
    createRoad('local', [node, p(100, 0)], 'east', {
      parking: false,
      markings: false,
      lights: false,
    }),
    createRoad('local', [node, p(-100, 0)], 'west', {
      parking: false,
      markings: false,
      lights: false,
    }),
    createRoad('local', [node, p(0, 100)], 'south', {
      parking: false,
      markings: false,
      lights: false,
    }),
    createRoad('railway', [p(-130, -130), p(130, 130)], 'rail'),
  ];
  const n = project(roads),
    t = buildTopology(n),
    i = planInfrastructure(n),
    group = new THREE.Group(),
    surfaces = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial(),
    materials = new Proxy({}, { get: () => mat });
  const instances = { poles: [], lamps: [], trees: [], trunks: [], bollards: [] };
  for (const plan of t.plans.values())
    renderRoad(
      group,
      surfaces,
      plan,
      i,
      materials,
      instances,
      { vegetation: false, fixtures: false },
      null,
      'us',
    );
  renderJunction(group, surfaces, t.junctions[0], i, materials, null);
  const returns = group.children.filter((m) => m.name === 'Pavement_return');
  assert.equal(returns.length, 3);
  for (const m of returns) {
    const vertices = m.geometry.attributes.position;
    for (const index of [0, 1, vertices.count - 2, vertices.count - 1])
      assert.ok(
        Math.abs(vertices.getY(index) - SURFACE_Y) < 0.000001,
        'crossing pavement must meet the deck without a raised gap',
      );
    assertFinite(m.geometry);
  }
  for (const parent of [group, surfaces]) parent.traverse((m) => m.geometry?.dispose());
  mat.dispose();
});

test('placed decals snap into valid road spans and remain inside carriageway edges', async () => {
  const { detailPlacement } = await import('../src/lib/placement.js');
  const { arrowGeometry } = await import('../src/engine/features.js');
  const n = curvedJunction(),
    t = buildTopology(n),
    plan = t.plans.get('curve');
  const s = plan.curve.getPointAt(0.4),
    placement = detailPlacement(n, 'arrow', s, 'curve');
  assert.ok(placement);
  assert.ok(placement.distance > plan.startTrim + 2.4);
  const g = arrowGeometry(placement.plan, placement.distance, placement.offset, 1, Math.PI / 2);
  assertFinite(g);
  const positions = g.attributes.position;
  for (let index = 0; index < positions.count; index++) {
    const q = new THREE.Vector3().fromBufferAttribute(positions, index);
    assert.ok(
      distanceToPath(q, planInfrastructure(n).prepared.get('curve')).distance < plan.carriage / 2,
    );
  }
  assert.equal(detailPlacement(n, 'arrow', p(10000, 10000)), null);
  g.dispose();
});

test('template placement rejects overlapping parallel streets instead of duplicating their surfaces', async () => {
  const { structurePlacementConflict } = await import('../src/lib/infrastructure.js');
  const street = createRoad('boulevard', [p(-400, 0), p(400, 0)], 'existing');
  assert.equal(
    structurePlacementConflict(project([street]), createCloverleaf({ x: 0, z: 0 })),
    street.name,
  );
  assert.equal(
    structurePlacementConflict(project([street]), createCloverleaf({ x: 1800, z: 1200 })),
    null,
  );
});

test('material batching retains paint draw order, semantic flags and picking ranges', async () => {
  const { batchRoadSurfaces } = await import('../src/engine/roads.js');
  const group = new THREE.Group(),
    material = new THREE.MeshBasicMaterial();
  for (const [id, order] of [
    ['body', 0],
    ['paint', 3],
  ]) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    mesh.renderOrder = order;
    mesh.userData = { roadId: id, ...(order ? { decal: true } : { surface: true }) };
    group.add(mesh);
  }
  batchRoadSurfaces(group, true, true);
  assert.equal(group.children.length, 2);
  const paint = group.children.find((m) => m.renderOrder === 3);
  assert.equal(paint.userData.decal, true);
  assert.equal(paint.userData.faceRanges[0].roadId, 'paint');
  assert.equal(group.children.find((m) => m.renderOrder === 0).userData.surface, true);
  group.children.forEach((m) => m.geometry.dispose());
  material.dispose();
});

test('imports reject missing or inconsistent interchange deck-height metadata', () => {
  const n = project(createCloverleaf(p(0, 0)));
  const missing = structuredClone(n);
  delete missing.roads[0].interchangeHeight;
  assert.throws(() => validateNetwork(missing), /shared deck height/);
  const inconsistent = structuredClone(n);
  inconsistent.roads[1].interchangeHeight = 9;
  assert.throws(() => validateNetwork(inconsistent), /inconsistent/);
});
