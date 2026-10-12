import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ROAD_PRESETS,
  seededRandom,
  createRoad,
  createInitialNetwork,
  generateNetwork,
  laneLayout,
  roadWidth,
  roadLength,
  getJunctions,
  networkStats,
  movePoint,
  splitRoad,
  validateNetwork,
  addRoadWithIntersections,
  createRoundabout,
  createCurve,
} from '../src/lib/network.js';
import { sampleRoad, ribbonGeometry } from '../src/engine/roads.js';

const project = (roads) => ({
  schema: 1,
  name: 'Test city',
  size: 2000,
  seed: 42,
  layout: 'grid',
  standard: 'us',
  roads,
  props: [],
});
const point = (x, z, nodeId) => ({ x, z, y: 0, ...(nodeId ? { nodeId } : {}) });

function finiteMesh(geometry) {
  assert.ok([...geometry.attributes.position.array].every(Number.isFinite));
  assert.ok([...geometry.attributes.normal.array].every(Number.isFinite));
  assert.ok([...geometry.attributes.uv.array].every(Number.isFinite));
  const vertexCount = geometry.attributes.position.count;
  assert.ok([...geometry.index.array].every((i) => i >= 0 && i < vertexCount));
  geometry.dispose();
}

test('seeded city generation is deterministic', () => {
  for (const layout of ['grid', 'organic', 'radial']) {
    assert.deepEqual(
      generateNetwork({ layout, seed: 719 }),
      generateNetwork({ layout, seed: 719 }),
    );
    assert.doesNotThrow(() => validateNetwork(generateNetwork({ layout, seed: 719 })));
  }
  const a = seededRandom(40),
    b = seededRandom(40);
  assert.equal(a(), b());
  assert.notDeepEqual(
    generateNetwork({ layout: 'organic', seed: 5 }),
    generateNetwork({ layout: 'organic', seed: 6 }),
  );
});

test('starter district has consistent shared bridge endpoints', () => {
  const initial = createInitialNetwork();
  assert.equal(initial.roads.length, 44);
  assert.equal(getJunctions(initial.roads).length, 25);
  assert.ok(networkStats(initial).length > 6000);
  assert.doesNotThrow(() => validateNetwork(initial));
  const bridge = initial.roads.find((r) => r.type === 'bridge');
  assert.equal(bridge.points[0].y, 0);
  assert.equal(bridge.points[1].y, 8);
  assert.equal(bridge.points.at(-1).y, 0);
});

test('all generator feature switches affect the model', () => {
  for (const layout of ['grid', 'organic', 'radial']) {
    const n = generateNetwork({
      layout,
      cycle: false,
      bus: false,
      parking: false,
      bridge: false,
      subway: false,
    });
    assert.ok(n.roads.every((r) => !r.cycle && !r.bus && !r.parking));
    assert.ok(n.roads.every((r) => r.type !== 'bridge' && r.type !== 'subway'));
    assert.ok(!n.props.some((p) => p.type === 'subway'));
    const withBridge = generateNetwork({ layout, bridge: true });
    assert.ok(withBridge.roads.some((r) => r.type === 'bridge'));
    assert.doesNotThrow(() => validateNetwork(withBridge));
  }
});

test('8 km dense city is finite and shares junctions', () => {
  const n = generateNetwork({ size: 8000, density: 13, layout: 'organic', seed: 408 });
  assert.equal(n.size, 8000);
  assert.equal(n.roads.length, 316);
  assert.equal(getJunctions(n.roads).length, 169);
  assert.ok(networkStats(n).length > 100000);
  assert.doesNotThrow(() => validateNetwork(n));
});

test('road bands are contiguous, symmetric and add up to total width', () => {
  for (const preset of ROAD_PRESETS) {
    const road = createRoad(preset.id, [point(0, 0), point(0, 100)], 'example');
    const bands = laneLayout(road);
    assert.ok(roadWidth(road) > 0);
    assert.equal(
      roadWidth(road),
      bands.reduce((sum, band) => sum + band.width, 0),
    );
    for (let i = 1; i < bands.length; i++) {
      assert.ok(
        Math.abs(
          bands[i - 1].center + bands[i - 1].width / 2 - (bands[i].center - bands[i].width / 2),
        ) < 0.00001,
      );
    }
  }
  const road = createRoad('arterial', [point(0, 0), point(0, 100)], 'r');
  assert.equal(roadWidth(road).toFixed(1), '22.2');
  assert.equal(roadWidth({ ...road, bus: true }).toFixed(1), '28.6');
});

test('moving a shared handle updates every connected road', () => {
  const n = createInitialNetwork(),
    road = n.roads[0],
    node = road.points[0];
  const next = movePoint(n, road.id, 0, { x: 30, z: 40 });
  assert.notEqual(next, n);
  assert.notEqual(next.roads[0].points[0].x, n.roads[0].points[0].x);
  const all = next.roads.flatMap((r) => r.points).filter((p) => p.nodeId === node.nodeId);
  assert.ok(all.length >= 2);
  assert.ok(all.every((p) => p.x === 30 && p.z === 40));
  assert.doesNotThrow(() => validateNetwork(next));
});

test('splitting a spline keeps its shape and creates a shared junction', () => {
  const road = createRoad(
    'arterial',
    [point(-100, 0, 'a'), point(0, 70), point(100, 0, 'b')],
    'curve',
  );
  const n = splitRoad(project([road]), 'curve');
  assert.equal(n.roads.length, 2);
  assert.deepEqual(n.roads[0].points.at(-1), n.roads[1].points[0]);
  assert.ok(Math.abs(n.roads.reduce((sum, r) => sum + roadLength(r), 0) - roadLength(road)) < 1);
  assert.equal(getJunctions(n.roads).length, 1);
  assert.doesNotThrow(() => validateNetwork(n));
});

test('new at-grade roads split crossings into connected four-way junctions', () => {
  const vertical = createRoad(
    'arterial',
    [point(0, -100, 'north'), point(0, 100, 'south')],
    'vertical',
  );
  const horizontal = createRoad(
    'local',
    [point(-100, 0, 'west'), point(100, 0, 'east')],
    'horizontal',
  );
  const n = addRoadWithIntersections(project([vertical]), horizontal);
  assert.equal(n.roads.length, 4);
  const junctions = getJunctions(n.roads);
  assert.equal(junctions.length, 1);
  assert.equal(junctions[0].roads.length, 4);
  assert.doesNotThrow(() => validateNetwork(n));
  assert.ok(Math.abs(networkStats(n).length - 400) < 0.001);
});

test('grade-separated bridges never create surface crossings', () => {
  const vertical = createRoad(
    'bridge',
    [
      { x: 0, z: -100, y: 8 },
      { x: 0, z: 100, y: 8 },
    ],
    'bridge',
  );
  const horizontal = createRoad('local', [point(-100, 0), point(100, 0)], 'street');
  const n = addRoadWithIntersections(project([vertical]), horizontal);
  assert.equal(n.roads.length, 2);
  assert.equal(getJunctions(n.roads).length, 0);
});

test('roundabouts have twelve shared, snappable nodes and smooth circular arcs', () => {
  const roads = createRoundabout({ x: 10, z: 20 }, 35);
  const n = project(roads);
  assert.equal(roads.length, 12);
  assert.equal(getJunctions(roads).length, 12);
  assert.equal(roads.filter((r) => r.island).length, 1);
  assert.ok(Math.abs(networkStats(n).length - 2 * Math.PI * 35) < 0.01);
  assert.doesNotThrow(() => validateNetwork(n));
  const entry = createRoad('local', [point(100, 20), roads[0].points[0]], 'entry');
  const connected = addRoadWithIntersections(n, entry);
  assert.ok(getJunctions(connected.roads).some((j) => j.roads.length === 3));
  for (const r of roads) {
    const curve = createCurve(r),
      mid = curve.getPointAt(0.5);
    assert.ok(Math.abs(Math.hypot(mid.x - 10, mid.z - 20) - 35) < 0.000001);
  }
});

test('indexed ribbon topology shares longitudinal vertices and faces upward', () => {
  const road = createRoad('arterial', [point(0, 0), point(0, 100)], 'straight');
  const samples = sampleRoad(road);
  const geometry = ribbonGeometry(samples, 8);
  assert.equal(geometry.attributes.position.count, samples.length * 2);
  assert.equal(geometry.index.count, (samples.length - 1) * 6);
  for (let i = 1; i < geometry.attributes.normal.array.length; i += 3)
    assert.ok(geometry.attributes.normal.array[i] > 0.999);
  finiteMesh(geometry);
});

test('curved, elevated and dashed meshes contain finite coordinates and valid indices', () => {
  const r = createRoad(
    'bridge',
    [
      { x: 0, z: 0, y: 0 },
      { x: 20, z: 50, y: 8 },
      { x: -10, z: 100, y: 8 },
      { x: 0, z: 150, y: 0 },
    ],
    'elevated',
  );
  const samples = sampleRoad(r, 12, 12);
  finiteMesh(ribbonGeometry(samples, 3.5, 2, 0.2));
  finiteMesh(ribbonGeometry(samples, 0.15, 2, 0.2, [3, 6]));
});

test('project validation rejects malformed geometry, limits and materials', () => {
  const initial = createInitialNetwork();
  assert.throws(() => validateNetwork({ ...initial, schema: 9 }), /schema/);
  assert.throws(() => validateNetwork({ ...initial, size: Infinity }), /World size/);
  assert.throws(
    () => validateNetwork({ ...initial, roads: [initial.roads[0], initial.roads[0]] }),
    /unique/,
  );
  assert.throws(
    () => validateNetwork({ ...initial, roads: [{ ...initial.roads[0], lanes: 40 }] }),
    /lane count/,
  );
  assert.throws(
    () => validateNetwork({ ...initial, roads: [{ ...initial.roads[0], material: 'untrusted' }] }),
    /material/,
  );
  assert.throws(
    () =>
      validateNetwork({
        ...initial,
        props: [{ id: 'bad', type: 'bump', x: 0, z: 0, width: Infinity }],
      }),
    /width/,
  );
  const changed = structuredClone(initial);
  changed.roads[0].points[0].y = 100;
  assert.throws(() => validateNetwork(changed), /inconsistent/);
});

test('JSON round trips preserve the complete authoring project', () => {
  const n = createInitialNetwork();
  const decoded = validateNetwork(JSON.parse(JSON.stringify(n)));
  assert.deepEqual(decoded, n);
});

test('handle moves that collapse a road are refused', () => {
  const road = createRoad('arterial', [point(0, 0, 'a'), point(0, 100, 'b')], 'road');
  const n = project([road]);
  assert.equal(movePoint(n, road.id, 0, { x: 0, z: 100 }), n);
});

test('splitting roundabout arcs updates angular ranges without duplicating the island', () => {
  const circle = createRoundabout({ x: 0, z: 0 }, 35);
  const initial = project(circle);
  const divided = splitRoad(initial, circle[0].id);
  assert.equal(divided.roads.length, 13);
  assert.equal(divided.roads.filter((r) => r.island).length, 1);
  assert.ok(Math.abs(networkStats(initial).length - networkStats(divided).length) < 0.02);
  assert.doesNotThrow(() => validateNetwork(divided));
});

test('imports reject duplicate detail IDs, extreme coordinates and non-boolean flags', () => {
  const n = createInitialNetwork();
  assert.throws(() => validateNetwork({ ...n, props: [n.props[0], n.props[0]] }), /unique/);
  assert.throws(
    () => validateNetwork({ ...n, props: [{ ...n.props[0], x: 1e300 }] }),
    /Invalid street detail/,
  );
  assert.throws(
    () => validateNetwork({ ...n, roads: [{ ...n.roads[0], cycle: 'false' }] }),
    /cycle flag/,
  );
  assert.throws(() => validateNetwork({ ...n, seed: NaN }), /finite/);
});

test('one-way and regional roundabout circulation stays consistent', async () => {
  const { laneDirection, canEnterRoad } = await import('../src/lib/network.js');
  const road = createRoad('local', [point(0, 0), point(0, 100)], 'oneway', { oneWay: true });
  assert.equal(laneDirection(road, -1, 'us'), 1);
  assert.equal(laneDirection(road, 1, 'uk'), 1);
  assert.equal(canEnterRoad(road, point(0, 0)), true);
  assert.equal(canEnterRoad(road, point(0, 100)), false);
  const circle = createRoundabout({ x: 0, z: 0 }, 30)[0];
  assert.equal(laneDirection(circle, -1, 'us'), -1);
  assert.equal(laneDirection(circle, 1, 'uk'), 1);
  assert.equal(canEnterRoad(circle, circle.points.at(-1), 'us'), true);
  assert.equal(canEnterRoad(circle, circle.points[0], 'uk'), true);
});
