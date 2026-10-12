import {
  ROAD_PRESETS,
  BASE_ROAD_PRESETS,
  BRIDGE_STYLES,
  DETAILS,
  STANDARDS,
  createRoad,
  laneLayout,
  roadWidth,
  laneDirection,
  canEnterRoad,
} from './profiles.js';
import { createCurve, sliceRoad } from './curves.js';
import { insertRoads } from './connectivity.js';
import { createCloverleaf } from './structures.js';
export { insertRoads } from './connectivity.js';
export {
  createCloverleaf,
  createOverpass,
  createBridge,
  cloverleafFromGesture,
  createDiamond,
  diamondFromGesture,
  junctionFromGesture,
} from './structures.js';
export {
  ROAD_PRESETS,
  BASE_ROAD_PRESETS,
  ROAD_VARIANTS,
  BRIDGE_PRESETS,
  BRIDGE_STYLES,
  getRoadPreset,
  isBridgePreset,
  isBridge,
  STRUCTURE_PRESETS,
  DETAILS,
  STANDARDS,
  createRoad,
  laneLayout,
  roadWidth,
  laneDirection,
  canEnterRoad,
} from './profiles.js';
export { createCurve } from './curves.js';

export function seededRandom(seed = 2841) {
  let s = Number(seed) >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function roadLength(road) {
  return createCurve(road).getLength();
}

export function getJunctions(roads) {
  const nodes = new Map();
  roads
    .filter((r) => !['subway', 'path', 'railway'].includes(r.type))
    .forEach((road) => {
      [road.points[0], road.points.at(-1)].forEach((point) => {
        const key =
          point.nodeId ||
          `${point.x.toFixed(2)},${point.z.toFixed(2)},${(point.y || 0).toFixed(2)}`;
        if (!nodes.has(key)) nodes.set(key, { id: key, ...point, roads: [], width: 0 });
        const node = nodes.get(key);
        if (!node.roads.includes(road.id)) node.roads.push(road.id);
        node.width = Math.max(node.width, roadWidth(road));
      });
    });
  return [...nodes.values()].filter((n) => n.roads.length >= 2);
}

export function networkStats(network) {
  const length = network.roads.reduce((sum, road) => sum + roadLength(road), 0);
  return {
    segments: network.roads.length,
    junctions: getJunctions(network.roads).length,
    length,
    details: network.props.length,
  };
}

const STREET_NAMES = [
  'Harbor Avenue',
  'Foundry Street',
  'Westhaven Drive',
  'Parkside Avenue',
  'Canal Street',
  'Oak Street',
  'Mercer Road',
  'Crescent Avenue',
  'Northgate Boulevard',
];

export function generateNetwork(options = {}) {
  const {
    name = 'Westhaven',
    size = 2000,
    seed = 2841,
    layout = 'grid',
    density = 5,
    cycle = true,
    bus = true,
    parking = true,
    bridge = true,
    subway = true,
    railway = false,
    standard = 'us',
    loopRadius = 55,
    bridgeHeight = 8,
  } = options;
  if (layout === 'cloverleaf') {
    const roads = createCloverleaf(
      { x: 0, z: 0 },
      { id: `interchange-${seed}`, radius: loopRadius, height: bridgeHeight, standard },
    );
    if (railway)
      roads.push(
        createRoad(
          'railway',
          [
            { x: -Math.max(300, loopRadius * 6.8) - 70, z: -size * 0.42, y: 0 },
            { x: -Math.max(300, loopRadius * 6.8) - 70, z: size * 0.42, y: 0 },
          ],
          `rail-${seed}`,
          { name: 'Cross-city railway' },
        ),
      );
    return {
      schema: 1,
      name,
      size: Number(size),
      seed: Number(seed),
      layout,
      standard,
      roads,
      props: [],
    };
  }
  const rand = seededRandom(seed);
  const roads = [];
  const props = [];
  let serial = 0;
  const extent = size * 0.32;
  const n = Math.max(3, Math.min(13, Number(density)));
  const step = (2 * extent) / (n - 1);
  const middle = Math.floor((n - 1) / 2);
  const add = (type, points, extra = {}) => {
    const road = createRoad(type, points, `road-${++serial}`, {
      cycle: cycle && (type === 'arterial' || type === 'boulevard'),
      bus: bus && type === 'boulevard',
      parking: parking && type === 'local',
      ...extra,
    });
    roads.push(road);
    return road;
  };

  if (layout === 'radial') {
    const center = { x: 0, z: 0, nodeId: 'center' };
    const rings = Math.max(2, Math.floor(n / 2));
    const spokes = 8;
    const nodes = Array.from({ length: rings }, (_, ring) =>
      Array.from({ length: spokes }, (_, spoke) => {
        const a = (spoke * Math.PI * 2) / spokes;
        return {
          x: (Math.cos(a) * extent * (ring + 1)) / rings,
          z: (Math.sin(a) * extent * (ring + 1)) / rings,
          nodeId: `r${ring}-${spoke}`,
        };
      }),
    );
    for (let ring = 0; ring < rings; ring++) {
      for (let spoke = 0; spoke < spokes; spoke++) {
        const a = (spoke * Math.PI * 2) / spokes;
        const r = (extent * (ring + 1)) / rings;
        add(
          ring === 0 ? 'arterial' : 'local',
          [
            nodes[ring][spoke],
            { x: Math.cos(a + Math.PI / spokes) * r, z: Math.sin(a + Math.PI / spokes) * r },
            nodes[ring][(spoke + 1) % spokes],
          ],
          { name: ring === 0 ? 'Inner Ring Road' : 'Outer Ring Road' },
        );
        add(
          spoke % 2 === 0 ? 'boulevard' : 'arterial',
          [ring === 0 ? center : nodes[ring - 1][spoke], nodes[ring][spoke]],
          { name: STREET_NAMES[spoke] },
        );
      }
    }
    if (bridge) {
      const start = nodes[rings - 1][0];
      add(
        'bridge',
        [
          start,
          { x: extent * 1.12, z: start.z, y: 8 },
          { x: extent * 1.6, z: start.z, y: 8 },
          { x: extent * 1.78, z: start.z, y: 0, nodeId: 'bridge-end' },
        ],
        { name: 'Eastbank Bridge', structure: 'river' },
      );
    }
  } else {
    const nodes = Array.from({ length: n }, (_, z) =>
      Array.from({ length: n }, (_, x) => {
        const jitter = layout === 'organic' ? step * 0.22 : 0;
        return {
          x: -extent + x * step + (rand() - 0.5) * jitter,
          z: -extent + z * step + (rand() - 0.5) * jitter,
          nodeId: `n${x}-${z}`,
        };
      }),
    );
    for (let z = 0; z < n; z++) {
      for (let x = 0; x < n; x++) {
        if (x < n - 1) {
          const type = z === middle ? 'boulevard' : z === 0 ? 'arterial' : 'local';
          const points = [nodes[z][x], nodes[z][x + 1]];
          if (layout === 'organic')
            points.splice(1, 0, {
              x: (points[0].x + points[1].x) / 2,
              z: (points[0].z + points[1].z) / 2 + (rand() - 0.5) * step * 0.18,
            });
          add(type, points, { name: STREET_NAMES[z % STREET_NAMES.length] });
        }
        if (z < n - 1) {
          const type = x === middle ? 'arterial' : x === n - 1 ? 'arterial' : 'local';
          const points = [nodes[z][x], nodes[z + 1][x]];
          if (layout === 'organic')
            points.splice(1, 0, {
              x: (points[0].x + points[1].x) / 2 + (rand() - 0.5) * step * 0.18,
              z: (points[0].z + points[1].z) / 2,
            });
          add(type, points, {
            name: x === middle ? 'Harbor Avenue' : STREET_NAMES[(x + 3) % STREET_NAMES.length],
          });
        }
      }
    }
    // An attached, gently sweeping perimeter connector. It shares both end nodes.
    add(
      'highway',
      [
        nodes[0][0],
        { x: -extent * 1.18, z: -extent * 1.28 },
        { x: -extent * 0.2, z: -extent * 1.47 },
        { x: extent * 0.8, z: -extent * 1.36 },
        nodes[0][n - 1],
      ],
      { name: 'Northshore Expressway', lights: false },
    );
    if (bridge) {
      const start = nodes[middle][n - 1];
      add(
        'bridge',
        [
          start,
          { x: extent * 1.12, z: start.z, y: 8 },
          { x: extent * 1.6, z: start.z, y: 8 },
          { x: extent * 1.78, z: start.z, y: 0, nodeId: 'bridge-end' },
        ],
        { name: 'Eastbank Bridge', structure: 'river' },
      );
    }
    const pathStart = nodes[n - 1][0];
    const pathEnd = nodes[n - 1][n - 1];
    add(
      'path',
      [
        pathStart,
        { x: -extent * 0.45, z: extent * 1.2 },
        { x: extent * 0.25, z: extent * 1.25 },
        pathEnd,
      ],
      { name: 'Riverside Greenway', lights: false },
    );
  }

  if (subway) {
    add(
      'subway',
      [
        { x: -extent * 1.12, z: extent * 0.24, y: -9 },
        { x: 0, z: extent * 0.24, y: -9 },
        { x: extent * 1.1, z: extent * 0.24, y: -9 },
      ],
      { name: 'Metro Line 01', markings: false, lights: false },
    );
    props.push({
      id: 'metro-station',
      type: 'subway',
      x: extent * 0.04,
      z: extent * 0.24 + 12,
      y: 0,
      rotation: 0,
    });
  }
  if (railway)
    add(
      'railway',
      [
        { x: -extent * 1.1, z: -extent * 0.57, y: 0 },
        { x: extent * 1.1, z: extent * 0.59, y: 0 },
      ],
      { name: 'Cross-city railway' },
    );
  const crossRoad = roads.find((r) => r.type === 'local');
  if (crossRoad) {
    const a = crossRoad.points[0],
      b = crossRoad.points.at(-1);
    props.push({
      id: 'speed-hump',
      type: 'bump',
      x: (a.x + b.x) / 2,
      z: (a.z + b.z) / 2,
      y: 0.3,
      rotation: Math.atan2(b.x - a.x, b.z - a.z),
      width: crossRoad.lanes * crossRoad.laneWidth,
    });
  }
  return {
    schema: 1,
    name,
    size: Number(size),
    seed: Number(seed),
    layout,
    standard,
    roads,
    props,
  };
}

export function createInitialNetwork() {
  const network = generateNetwork({ name: 'Westhaven', size: 760, density: 5, seed: 2841 });
  network.size = 2000;
  return network;
}

export function updateRoad(network, id, changes) {
  return { ...network, roads: network.roads.map((r) => (r.id === id ? { ...r, ...changes } : r)) };
}

export function movePoint(network, roadId, pointIndex, position) {
  const road = network.roads.find((r) => r.id === roadId);
  if (!road || !road.points[pointIndex]) return network;
  const point = road.points[pointIndex];
  const next = {
    ...network,
    roads: network.roads.map((r) => {
      const changed = r.points.some(
        (p, index) =>
          (point.nodeId && p.nodeId === point.nodeId) || (r.id === roadId && index === pointIndex),
      );
      return {
        ...r,
        ...(changed ? { customSpline: true } : {}),
        points: r.points.map((p, index) =>
          (point.nodeId && p.nodeId === point.nodeId) || (r.id === roadId && index === pointIndex)
            ? { ...p, ...position }
            : p,
        ),
      };
    }),
  };
  if (
    next.roads.some(
      (r) =>
        roadLength(r) < 0.5 || !r.points.every((p) => [p.x, p.z, p.y || 0].every(Number.isFinite)),
    )
  )
    return network;
  return next;
}

export function splitRoad(network, roadId) {
  const road = network.roads.find((r) => r.id === roadId);
  if (!road || road.points.length < 2) return network;
  if (road.closed) return network;
  const curve = createCurve(road);
  const mid = curve.getPointAt(0.5);
  const middle = { x: mid.x, z: mid.z, y: mid.y, nodeId: `split-${crypto.randomUUID()}` };
  const aRoad = sliceRoad(road, 0, 0.5, road.points[0], middle);
  const bRoad = sliceRoad(
    road,
    0.5,
    1,
    middle,
    road.points.at(-1),
    `${road.id}-split-${crypto.randomUUID().slice(0, 6)}`,
  );
  return { ...network, roads: [...network.roads.map((r) => (r.id === roadId ? aRoad : r)), bRoad] };
}

export function createRoundabout(center, radius = 30) {
  const id = `circle-${crypto.randomUUID()}`;
  radius = Math.max(18, Math.min(400, radius));
  const count = 12;
  const nodes = Array.from({ length: count }, (_, i) => ({
    x: center.x + Math.cos((i / count) * Math.PI * 2) * radius,
    z: center.z + Math.sin((i / count) * Math.PI * 2) * radius,
    y: 0,
    nodeId: `${id}-node-${i}`,
  }));
  return nodes.map((point, i) => {
    const startAngle = (i / count) * Math.PI * 2,
      endAngle = ((i + 1) / count) * Math.PI * 2;
    const middle = {
      x: center.x + Math.cos((startAngle + endAngle) / 2) * radius,
      z: center.z + Math.sin((startAngle + endAngle) / 2) * radius,
      y: 0,
    };
    return createRoad('roundabout', [point, middle, nodes[(i + 1) % count]], `${id}-arc-${i}`, {
      center: { x: center.x, z: center.z },
      radius,
      startAngle,
      endAngle,
      roundaboutId: id,
      island: i === 0,
      lights: false,
    });
  });
}

export function addRoadWithIntersections(network, added) {
  return insertRoads(network, [added]);
}

export function validateNetwork(value) {
  if (!value || value.schema !== 1 || !Array.isArray(value.roads) || !Array.isArray(value.props))
    throw new Error('This is not a Frontier Road Studio project (schema 1).');
  if (value.roads.length > 2000 || value.props.length > 5000)
    throw new Error('Project exceeds the browser editor limit (2,000 roads / 5,000 details).');
  if (!Number.isFinite(value.size) || value.size < 100 || value.size > 20000)
    throw new Error('World size must be between 100 and 20,000 meters.');
  if (typeof value.name !== 'string' || value.name.length > 100)
    throw new Error('Project name must be a string of up to 100 characters.');
  if (!Number.isFinite(value.seed)) throw new Error('Generation seed must be a finite number.');
  const ids = new Set();
  const sharedNodes = new Map();
  const interchangeHeights = new Map();
  for (const r of value.roads) {
    if (typeof r.id !== 'string' || ids.has(r.id))
      throw new Error('Road IDs must be unique strings.');
    ids.add(r.id);
    if (r.oneWay !== undefined && typeof r.oneWay !== 'boolean')
      throw new Error('Invalid one-way flag.');
    if (typeof r.name !== 'string' || r.name.length > 160)
      throw new Error('Road names must be short strings.');
    if (
      r.center &&
      (![r.center.x, r.center.z, r.radius].every(
        (v) => Number.isFinite(v) && Math.abs(v) <= 100000,
      ) ||
        r.radius < 1 ||
        r.radius > 10000)
    )
      throw new Error('Invalid circular road geometry.');
    if (r.roundaboutId && ![r.startAngle, r.endAngle].every(Number.isFinite))
      throw new Error('Invalid roundabout angles.');
    if (r.roundaboutId && Math.abs(r.endAngle - r.startAngle) > Math.PI * 2)
      throw new Error('A circular segment cannot exceed one revolution.');
    if (!['asphalt', 'paving', 'concrete', 'gravel', 'timber'].includes(r.material))
      throw new Error('Unsupported road surface material.');
    if (!BASE_ROAD_PRESETS.some((p) => p.id === r.type))
      throw new Error(`Unsupported road type: ${r.type}`);
    if (r.presetId !== undefined) {
      const preset = ROAD_PRESETS.find((p) => p.id === r.presetId);
      if (!preset || (preset.type || preset.id) !== r.type)
        throw new Error('Invalid road preset identity.');
    }
    if (
      r.bridgeStyle !== undefined &&
      (!['bridge', 'path'].includes(r.type) || !BRIDGE_STYLES.some((s) => s.id === r.bridgeStyle))
    )
      throw new Error('Invalid bridge structure family.');
    for (const [key, min, max] of [
      ['bridgeRise', 2, 30],
      ['bridgeTowerHeight', 8, 40],
      ['bridgeSupportSpacing', 16, 120],
    ])
      if (r[key] !== undefined && (!Number.isFinite(r[key]) || r[key] < min || r[key] > max))
        throw new Error(`Invalid ${key}.`);
    if (
      r.bridgeRise !== undefined &&
      ((['truss', 'covered'].includes(r.bridgeStyle) && r.bridgeRise < 6.5) ||
        (r.bridgeStyle === 'footbridge' && r.bridgeRise < 2.8))
    )
      throw new Error('Structural rise is below the bridge clearance envelope.');
    if (
      r.bridgeSpan !== undefined &&
      (!r.bridgeSpan ||
        Array.isArray(r.bridgeSpan) ||
        ![r.bridgeSpan.start, r.bridgeSpan.end].every(Number.isFinite) ||
        r.bridgeSpan.start < 0 ||
        r.bridgeSpan.end > 1 ||
        r.bridgeSpan.start > r.bridgeSpan.end)
    )
      throw new Error('Invalid bridge span.');
    for (const key of ['cycle', 'bus', 'parking', 'curbs', 'markings', 'lights'])
      if (typeof r[key] !== 'boolean') throw new Error(`Invalid ${key} flag.`);
    if (!Array.isArray(r.points) || r.points.length < 2 || r.points.length > 128)
      throw new Error('Each road must have 2–128 spline points.');
    if (r.curveType && !['bezier', 'polyline'].includes(r.curveType))
      throw new Error('Unsupported spline representation.');
    if (r.curveType === 'bezier' && (r.points.length < 4 || (r.points.length - 1) % 3 !== 0))
      throw new Error('Bézier splines require 3n + 1 control points.');
    for (const [key, min, max] of [
      ['shoulder', 0, 5],
      ['gauge', 1, 1.7],
      ['deckThickness', 0.2, 3],
      ['interchangeHeight', 6, 20],
      ['interchangeRadius', 40, 110],
    ])
      if (r[key] !== undefined && (!Number.isFinite(r[key]) || r[key] < min || r[key] > max))
        throw new Error(`Invalid ${key}.`);
    if (r.interchangeId !== undefined) {
      if (
        typeof r.interchangeId !== 'string' ||
        !r.interchangeId.length ||
        r.interchangeId.length > 200 ||
        !Number.isFinite(r.interchangeHeight)
      )
        throw new Error('Interchange members need an ID and a valid shared deck height.');
      const previous = interchangeHeights.get(r.interchangeId);
      if (previous !== undefined && Math.abs(previous - r.interchangeHeight) > 0.000001)
        throw new Error('Interchange deck heights are inconsistent.');
      interchangeHeights.set(r.interchangeId, r.interchangeHeight);
    }
    if (
      r.drainage !== undefined &&
      !['none', 'grate', 'inlet', 'slot', 'combined'].includes(r.drainage)
    )
      throw new Error('Invalid curb drainage type.');
    if (
      r.drainSpacing !== undefined &&
      (!Number.isFinite(r.drainSpacing) || r.drainSpacing < 8 || r.drainSpacing > 100)
    )
      throw new Error('Invalid drain spacing.');
    if (r.crosswalkRamps !== undefined && typeof r.crosswalkRamps !== 'boolean')
      throw new Error('Invalid crosswalk ramp flag.');
    for (const key of ['crossings', 'barriers'])
      if (r[key] !== undefined && typeof r[key] !== 'boolean')
        throw new Error(`Invalid ${key} flag.`);
    if (r.type === 'railway' && (r.lanes < 1 || r.lanes > 4))
      throw new Error('Railway track count must be 1–4.');
    for (const p of r.points) {
      if (![p.x, p.z, p.y ?? 0].every((v) => Number.isFinite(v) && Math.abs(v) <= 100000))
        throw new Error('Invalid road coordinates.');
      if (p.nodeId) {
        const previous = sharedNodes.get(p.nodeId);
        if (
          previous &&
          Math.hypot(p.x - previous.x, p.z - previous.z, (p.y || 0) - (previous.y || 0)) > 0.01
        )
          throw new Error('Shared junction coordinates are inconsistent.');
        sharedNodes.set(p.nodeId, p);
      }
    }
    if (!Number.isInteger(r.lanes) || r.lanes < 0 || r.lanes > 12)
      throw new Error('Travel lane count must be 0–12.');
    for (const [key, max] of [
      ['laneWidth', 6],
      ['median', 12],
      ['sidewalk', 12],
      ['speed', 200],
    ]) {
      if (!Number.isFinite(r[key]) || r[key] < 0 || r[key] > max)
        throw new Error(`Invalid ${key}.`);
    }
    if (roadLength(r) < 0.5) throw new Error('Roads must be at least 0.5 meters long.');
  }
  const propIds = new Set();
  for (const p of value.props) {
    if (typeof p.id !== 'string' || propIds.has(p.id))
      throw new Error('Street detail IDs must be unique strings.');
    propIds.add(p.id);
    if (
      p.roadId !== undefined &&
      (typeof p.roadId !== 'string' || !p.roadId.length || p.roadId.length > 200)
    )
      throw new Error('Invalid street detail road attachment.');
    if (p.curbAnchor !== undefined) {
      if (
        !['driveway', 'curbRamp'].includes(p.type) ||
        !p.roadId ||
        !p.curbAnchor ||
        typeof p.curbAnchor !== 'object' ||
        Array.isArray(p.curbAnchor) ||
        !Number.isFinite(p.curbAnchor.t) ||
        p.curbAnchor.t < 0 ||
        p.curbAnchor.t > 1 ||
        ![-1, 1].includes(p.curbAnchor.side)
      )
        throw new Error('Invalid curb ramp anchor.');
    }
    if (['driveway', 'curbRamp'].includes(p.type) && (!p.curbAnchor || !p.roadId))
      throw new Error('Curb ramps must be attached to a road.');
    if (
      p.rampDepth !== undefined &&
      (!Number.isFinite(p.rampDepth) || p.rampDepth < 0.5 || p.rampDepth > 12)
    )
      throw new Error('Invalid curb ramp depth.');
    if (p.roadAnchor !== undefined) {
      const anchor = p.roadAnchor;
      if (
        !['arrow', 'crosswalk'].includes(p.type) ||
        !p.roadId ||
        !anchor ||
        typeof anchor !== 'object' ||
        Array.isArray(anchor)
      )
        throw new Error('Invalid road marking anchor.');
      for (const [key, min, max] of [
        ['t', 0, 1],
        ['offset', -100, 100],
        ['lift', 0, 0.03],
        ['angle', -Math.PI, Math.PI],
      ])
        if (!Number.isFinite(anchor[key]) || anchor[key] < min || anchor[key] > max)
          throw new Error(`Invalid road marking anchor ${key}.`);
    }
    if (p.width !== undefined && (!Number.isFinite(p.width) || p.width < 0.2 || p.width > 200))
      throw new Error('Invalid street detail width.');
    if (
      !DETAILS.some((d) => d.id === p.type) ||
      ![p.x, p.z, p.y ?? 0, p.rotation ?? 0].every(
        (v) => Number.isFinite(v) && Math.abs(v) <= 100000,
      )
    )
      throw new Error('Invalid street detail.');
  }
  return {
    ...value,
    standard: STANDARDS.some((s) => s.id === value.standard) ? value.standard : 'us',
  };
}

export function downloadFile(name, data, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
