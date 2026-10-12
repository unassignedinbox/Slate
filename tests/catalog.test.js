import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  ROAD_PRESETS,
  ROAD_VARIANTS,
  BRIDGE_PRESETS,
  BRIDGE_STYLES,
  BASE_ROAD_PRESETS,
  createRoad,
  createBridge,
  createCurve,
  laneLayout,
  roadWidth,
  validateNetwork,
  addRoadWithIntersections,
  splitRoad,
  getRoadPreset,
  isBridge,
  isBridgePreset,
} from '../src/lib/network.js';
import { buildTopology } from '../src/lib/topology.js';
import {
  planInfrastructure,
  bridgeReport,
  bridgeSupports,
  distanceToPath,
} from '../src/lib/infrastructure.js';
import { domain } from '../src/lib/connectivity.js';
import { planBridgeStructure } from '../src/lib/bridges.js';
import { renderBridgeStructure } from '../src/engine/bridges.js';
import { renderRoad } from '../src/engine/features.js';
import { ribbonGeometry, batchRoadSurfaces } from '../src/engine/roads.js';

const p = (x, z, y = 0, nodeId) => ({ x, z, y, ...(nodeId ? { nodeId } : {}) });
const project = (roads) => ({
  schema: 1,
  name: 'Catalog',
  size: 2000,
  seed: 42,
  layout: 'grid',
  standard: 'us',
  roads,
  props: [],
});
const materials = new Map();
const mats = new Proxy(
  {},
  {
    get: (_, id) => {
      if (!materials.has(id))
        materials.set(id, new THREE.MeshStandardMaterial({ name: String(id) }));
      return materials.get(id);
    },
  },
);
const context = (roads) => {
  const n = project(roads);
  return { n, topology: buildTopology(n), infrastructure: planInfrastructure(n) };
};
const finite = (geometry) => {
  for (const a of Object.values(geometry.attributes))
    assert.ok([...a.array].every(Number.isFinite));
  assert.ok(geometry.index);
  assert.ok([...geometry.index.array].every((i) => i < geometry.attributes.position.count));
};

test('catalog adds 24 real road profiles and 12 bridge designs, with stable native domains', () => {
  assert.equal(BASE_ROAD_PRESETS.length, 12);
  assert.equal(ROAD_VARIANTS.length, 24);
  assert.equal(BRIDGE_PRESETS.length, 12);
  assert.equal(ROAD_PRESETS.length, 48);
  assert.equal(new Set(ROAD_PRESETS.map((p) => p.id)).size, 48);
  assert.equal(new Set(BRIDGE_PRESETS.map((p) => p.bridgeStyle)).size, 12);
  assert.equal(ROAD_PRESETS.filter(isBridgePreset).length, 13);
  for (const preset of ROAD_PRESETS) {
    const road = createRoad(preset.id, [p(0, -150), p(0, 150)]);
    assert.equal(road.presetId, preset.id);
    assert.ok(BASE_ROAD_PRESETS.some((base) => base.id === road.type));
    assert.equal(getRoadPreset(road).name, preset.name);
    assert.ok(roadWidth(road) > 0);
    assert.deepEqual(validateNetwork(JSON.parse(JSON.stringify(project([road])))), project([road]));
  }
});

test('new road profiles have distinct physical layouts, surfaces, shoulders or curb treatments', () => {
  const signatures = new Set();
  for (const preset of ROAD_VARIANTS) {
    const r = createRoad(preset.id, [p(-100, 0), p(100, 0)]);
    signatures.add(
      JSON.stringify([
        r.lanes,
        r.laneWidth,
        r.oneWay,
        r.median,
        r.sidewalk,
        r.shoulder,
        r.cycle,
        r.bus,
        r.parking,
        r.curbs,
        r.material,
        r.markings,
      ]),
    );
  }
  assert.equal(signatures.size, 24);
  const highway = createRoad('motorway-eight', [p(0, 0), p(200, 0)]),
    transit = createRoad('transit-boulevard', [p(0, 0), p(200, 0)]);
  assert.equal(laneLayout(highway).filter((b) => b.kind === 'lane').length, 8);
  assert.equal(laneLayout(transit).filter((b) => b.kind === 'bus').length, 2);
  assert.equal(laneLayout(transit).filter((b) => b.kind === 'cycle').length, 2);
  assert.equal(roadWidth(createRoad('promenade', [p(0, 0), p(200, 0)])), 6);
  assert.equal(roadWidth(createRoad('cycleway', [p(0, 0), p(200, 0)])), 3.2);
});

test('road variants still connect at-grade and preserve preset identity across cuts', () => {
  const a = createRoad('arterial-six', [p(-150, 0), p(150, 0)], 'a'),
    b = createRoad('cycle-street', [p(0, -150), p(0, 150)], 'b');
  const next = addRoadWithIntersections(project([a]), b);
  assert.equal(next.roads.length, 4);
  assert.equal(buildTopology(next).junctions.length, 1);
  assert.ok(
    next.roads.every(
      (r) => r.presetId === (r.id.startsWith('a') ? 'arterial-six' : 'cycle-street'),
    ),
  );
  assert.doesNotThrow(() => validateNetwork(next));
});

for (const preset of BRIDGE_PRESETS)
  test(`${preset.name} has smooth ground ends, grade separation and finite actual structure meshes`, () => {
    const road = createBridge(
      [p(0, -350, 0, 'south'), p(0, 350, 0, 'north')],
      preset.id,
      undefined,
      'upper',
    );
    const lower = createRoad('local', [p(-100, 0), p(100, 0)], 'lower', {
      lights: false,
      parking: false,
    });
    const { n, topology, infrastructure } = context([road, lower]),
      plan = topology.plans.get(road.id);
    assert.ok(isBridge(road));
    assert.equal(road.points[0].y, 0);
    assert.equal(road.points.at(-1).y, 0);
    assert.equal(road.points[0].nodeId, 'south');
    assert.equal(road.points[3].y, preset.elevation);
    assert.equal(road.points[6].y, preset.elevation);
    assert.ok(bridgeReport(road, n).clearance >= 5.5);
    assert.ok(bridgeReport(road, n).maxGrade < 9);
    assert.equal(addRoadWithIntersections(project([lower]), road).roads.length, 2);
    const parts = planBridgeStructure(road, infrastructure, plan),
      group = new THREE.Group();
    renderBridgeStructure(group, road, plan, infrastructure, mats);
    if (preset.bridgeStyle !== 'beam')
      assert.ok(
        parts.members.length || parts.ribbons.length || parts.sheets.length,
        'not just a renamed deck',
      );
    for (const mesh of group.children) {
      finite(mesh.geometry);
      assert.equal(mesh.userData.roadId, road.id);
      assert.equal(mesh.userData.structure, true);
    }
    assert.deepEqual(validateNetwork(JSON.parse(JSON.stringify(n))), n);
  });

test('arch ties and through-truss crossbeams stay above the driving envelope', () => {
  for (const id of [
    'bridge-arch',
    'bridge-truss',
    'bridge-covered',
    'bridge-cable',
    'bridge-suspension',
  ]) {
    const r = createBridge([p(-350, 0), p(350, 0)], id),
      { topology, infrastructure } = context([r]),
      parts = planBridgeStructure(r, infrastructure, topology.plans.get(r.id));
    const cross = parts.members.filter((m) => /overhead|crossbeam|roof_diagonal/i.test(m.name));
    assert.ok(cross.length);
    for (const m of cross) {
      const a = distanceToPath(m.a, infrastructure.prepared.get(r.id)),
        b = distanceToPath(m.b, infrastructure.prepared.get(r.id));
      assert.ok(m.a.y - a.y >= 6.2);
      assert.ok(m.b.y - b.y >= 6.2);
    }
  }
});

test('masonry/timber below-deck members and physical piers respect lower road corridors', () => {
  for (const id of ['bridge-stone', 'bridge-timber', 'bridge-viaduct']) {
    const r = createBridge([p(-350, 0), p(350, 0)], id, undefined, 'upper'),
      lower = createRoad('rural-wide', [p(0, -200), p(0, 200)], 'lower');
    const { topology, infrastructure } = context([r, lower]),
      parts = planBridgeStructure(r, infrastructure, topology.plans.get(r.id)),
      lowerPath = infrastructure.prepared.get('lower');
    for (const member of parts.members)
      for (let i = 0; i <= 8; i++) {
        const point = member.a.clone().lerp(member.b, i / 8),
          near = distanceToPath(point, lowerPath);
        assert.ok(
          near.distance >= roadWidth(lower) / 2 + 0.3 ||
            point.y - Math.max(...member.size) >= near.y + 5.5,
        );
      }
    for (const support of parts.supports)
      for (const foot of support.feet)
        assert.ok(distanceToPath(foot, lowerPath).distance > roadWidth(lower) / 2 + 1);
  }
});

test('support spacing and structural rise/tower height change real parts', () => {
  const r = createBridge([p(-350, 0), p(350, 0)], 'bridge-cable'),
    { topology, infrastructure } = context([r]),
    plan = topology.plans.get(r.id);
  const original = planBridgeStructure(r, infrastructure, plan),
    taller = planBridgeStructure({ ...r, bridgeTowerHeight: 30 }, infrastructure, plan);
  assert.ok(
    Math.max(...taller.members.map((p) => Math.max(p.a.y, p.b.y))) >
      Math.max(...original.members.map((p) => Math.max(p.a.y, p.b.y))) + 10,
  );
  assert.ok(
    bridgeSupports({ ...r, bridgeSupportSpacing: 20 }, infrastructure, plan).length >
      bridgeSupports({ ...r, bridgeSupportSpacing: 80 }, infrastructure, plan).length,
  );
  const arch = createBridge([p(-350, 0), p(350, 0)], 'bridge-arch'),
    ctx = context([arch]),
    ap = ctx.topology.plans.get(arch.id);
  const peak = (rise) =>
    Math.max(
      ...planBridgeStructure({ ...arch, bridgeRise: rise }, ctx.infrastructure, ap).members.map(
        (m) => m.a.y,
      ),
    );
  assert.ok(peak(20) > peak(8) + 10);
});

test('curved and rotated bridge families share the actual deck frame', () => {
  for (const preset of BRIDGE_PRESETS) {
    const r = createBridge([p(-320, -120), p(0, 90), p(320, 120)], preset.id),
      ctx = context([r]),
      parts = planBridgeStructure(r, ctx.infrastructure, ctx.topology.plans.get(r.id));
    for (const part of parts.members)
      assert.ok([...part.a.toArray(), ...part.b.toArray()].every(Number.isFinite));
    const group = new THREE.Group();
    renderBridgeStructure(group, r, ctx.topology.plans.get(r.id), ctx.infrastructure, mats);
    for (const mesh of group.children) finite(mesh.geometry);
  }
});

test('footbridges use the path domain but receive real slabs, guardrails and lower-road clearance', () => {
  const r = createBridge([p(-350, 0), p(350, 0)], 'bridge-foot'),
    { topology, infrastructure } = context([r]),
    group = new THREE.Group(),
    surfaces = new THREE.Group();
  assert.equal(domain(r), 'path');
  assert.equal(r.lanes, 0);
  assert.equal(roadWidth(r), 4);
  renderRoad(
    group,
    surfaces,
    topology.plans.get(r.id),
    infrastructure,
    mats,
    { poles: [], lamps: [], trees: [], trunks: [], bollards: [] },
    { vegetation: false },
    ribbonGeometry,
    'us',
  );
  for (const name of ['Bridge_deck_slab', 'Guardrail_beam', 'Truss_diagonal'])
    assert.ok(
      group.children.some((m) => m.name === name),
      name,
    );
});

test('bridge spans and profile identity survive a split without structures on the approach tails', () => {
  const r = createBridge([p(-350, 0), p(350, 0)], 'bridge-arch', undefined, 'arch'),
    next = splitRoad(project([r]), r.id);
  for (const child of next.roads) {
    assert.equal(child.presetId, r.presetId);
    assert.equal(child.bridgeStyle, 'arch');
    assert.ok(child.bridgeSpan.start >= 0 && child.bridgeSpan.end <= 1);
  }
  assert.doesNotThrow(() => validateNetwork(next));
});

test('structure batching retains semantic feature metadata for GLB export', () => {
  const r = createBridge([p(-350, 0), p(350, 0)], 'bridge-cable'),
    { topology, infrastructure } = context([r]),
    root = new THREE.Group();
  renderBridgeStructure(root, r, topology.plans.get(r.id), infrastructure, mats);
  batchRoadSurfaces(root, false);
  assert.ok(root.children.some((m) => m.userData.bridgeFeatures?.Cable_stayed_fan > 0));
  assert.ok(root.children.every((m) => m.userData.structure));
});

test('unknown identities, families, unsafe rise, spacing, tower parameters and spans are rejected', () => {
  const r = createBridge([p(-350, 0), p(350, 0)], 'bridge-truss');
  for (const bad of [
    { presetId: 'imaginary' },
    { presetId: 'cycleway' },
    { bridgeStyle: 'magic' },
    { bridgeRise: 3 },
    { bridgeTowerHeight: 1 },
    { bridgeSupportSpacing: 0 },
    { bridgeSpan: { start: 0.8, end: 0.2 } },
    { bridgeSpan: { start: NaN, end: 0.8 } },
  ])
    assert.throws(() => validateNetwork(project([{ ...r, ...bad }])));
  assert.throws(() => createBridge([p(0, 0), p(100, 0)], 'local'), /bridge preset/);
  const legacy = createRoad('bridge', [p(0, 0, 8), p(0, 100, 8)]);
  delete legacy.presetId;
  assert.doesNotThrow(() => validateNetwork(project([legacy])));
});

test('exposed girders and hollow boxes are not buried inside a full-depth concrete slab', () => {
  for (const id of ['bridge-girder', 'bridge-box', 'bridge-timber']) {
    const r = createBridge([p(-350, 0), p(350, 0)], id),
      ctx = context([r]),
      group = new THREE.Group();
    renderRoad(
      group,
      new THREE.Group(),
      ctx.topology.plans.get(r.id),
      ctx.infrastructure,
      mats,
      { poles: [], lamps: [], trees: [], trunks: [], bollards: [] },
      { vegetation: false },
      ribbonGeometry,
      'us',
    );
    const slab = group.children.find((m) => m.name === 'Bridge_deck_slab'),
      position = slab.geometry.attributes.position;
    const central = Array.from({ length: position.count }, (_, i) => i)
      .filter((i) => Math.abs(position.getX(i)) < 1.1)
      .map((i) => position.getY(i));
    assert.ok(central.length);
    assert.ok(Math.min(...central) > r.elevation - 0.3);
    assert.ok(
      group.children.some(
        (m) =>
          /girder|soffit|stringer/.test(m.name) &&
          [...m.geometry.attributes.position.array].some(
            (_, i, a) => i % 3 === 1 && a[i] < r.elevation - 0.5,
          ),
      ),
    );
  }
});

test('every bridge family splits to finite analytic controls at its flat-span midpoint', () => {
  for (const preset of BRIDGE_PRESETS) {
    const r = createBridge([p(-350, 0), p(350, 0)], preset.id),
      next = splitRoad(project([r]), r.id);
    assert.doesNotThrow(() => validateNetwork(next));
    for (const child of next.roads) {
      assert.equal(child.presetId, preset.id);
      assert.ok(child.points.every((p) => [p.x, p.y, p.z].every(Number.isFinite)));
    }
  }
});

test('curved arch/cable members stay outside the low vehicle corridor', () => {
  for (const id of ['bridge-arch', 'bridge-cable', 'bridge-suspension']) {
    const r = createBridge([p(-350, 0), p(0, 110), p(350, 0)], id),
      ctx = context([r]),
      parts = planBridgeStructure(r, ctx.infrastructure, ctx.topology.plans.get(r.id));
    for (const member of parts.members)
      for (let j = 0; j <= 20; j++) {
        const point = member.a.clone().lerp(member.b, j / 20),
          near = distanceToPath(point, ctx.infrastructure.prepared.get(r.id));
        assert.ok(
          point.y - near.y >= 5.5 || near.distance > (roadWidth(r) - 2 * r.sidewalk) / 2 + 0.2,
        );
      }
  }
});
