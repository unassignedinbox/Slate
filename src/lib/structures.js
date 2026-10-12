import { createRoad, roadWidth, ROAD_PRESETS, isBridgePreset } from './profiles.js';
import { createCurve, sampleCurve, frameAt, sliceRoad } from './curves.js';
import { distanceToPath } from './infrastructure.js';

const smooth = (t) => t * t * (3 - 2 * t);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function createOverpass(positions, height = 8, id) {
  return createBridge(positions, 'bridge', height, id);
}

/** Every catalog bridge has ground/snap-height ends and the same smooth,
 * grade-separated approach contract; structure families are real mesh parts. */
export function createBridge(positions, presetId = 'bridge', height, id) {
  const preset = ROAD_PRESETS.find((p) => p.id === presetId);
  if (!isBridgePreset(preset)) throw new Error('Choose a bridge preset.');
  height = Math.max(1, Math.min(40, height ?? preset.elevation ?? 8));
  const source = createCurve({ points: positions.map((p) => ({ ...p, y: 0 })) });
  const anchors = [0, 0.33, 0.67, 1].map((t, i) => {
    const p = source.getPointAt(t);
    return {
      x: p.x,
      z: p.z,
      y: i === 0 ? positions[0].y || 0 : i === 3 ? positions.at(-1).y || 0 : height,
      ...(i === 0 && positions[0].nodeId ? { nodeId: positions[0].nodeId } : {}),
      ...(i === 3 && positions.at(-1).nodeId ? { nodeId: positions.at(-1).nodeId } : {}),
    };
  });
  const points = [anchors[0]];
  for (let i = 0; i < 3; i++) {
    const a = anchors[i],
      b = anchors[i + 1],
      d = Math.hypot(b.x - a.x, b.z - a.z) / 3;
    const ta = source.getTangentAt([0, 0.33, 0.67][i]),
      tb = source.getTangentAt([0.33, 0.67, 1][i]);
    points.push(
      { x: a.x + ta.x * d, z: a.z + ta.z * d, y: a.y },
      { x: b.x - tb.x * d, z: b.z - tb.z * d, y: b.y },
      b,
    );
  }
  const road = createRoad(presetId, points, id, {
    name: preset.name,
    curveType: 'bezier',
    structure: 'overpass',
    elevation: height,
    lights: false,
    deckThickness: preset.deckThickness || 0.8,
  });
  const lengths = createCurve(road).getCurveLengths();
  road.bridgeSpan = { start: lengths[0] / lengths[2], end: lengths[1] / lengths[2] };
  return road;
}

/** Four one-way carriageways, four 270° loops and four exterior connectors.
 * Every exit/merge shares a node with a split mainline. The central crossing
 * is deliberately NOT a node: north/south is elevated above east/west.
 */
export function createCloverleaf(center = { x: 0, z: 0 }, options = {}) {
  const id = options.id || `clover-${crypto.randomUUID()}`;
  const radius = clamp(options.radius ?? 55, 40, 110),
    height = clamp(options.height ?? 8, 6, 20);
  const rotation = options.rotation || 0,
    left = ['uk', 'jp', 'au'].includes(options.standard);
  const d = 8,
    q = d + radius,
    outer = Math.max(300, radius * 6.8),
    extent = outer + 240;
  const roads = [],
    nodeMap = new Map();
  const transform = (p) => {
    const x = left ? -p.x : p.x;
    return {
      x: center.x + x * Math.cos(rotation) - p.z * Math.sin(rotation),
      z: center.z + x * Math.sin(rotation) + p.z * Math.cos(rotation),
      y: p.y,
      ...(p.nodeId ? { nodeId: p.nodeId } : {}),
    };
  };
  const node = (x, z, y) => {
    const key = `${x},${z},${y}`;
    if (!nodeMap.has(key)) nodeMap.set(key, { x, z, y, nodeId: `${id}-n${nodeMap.size}` });
    return nodeMap.get(key);
  };
  const common = {
    interchangeId: id,
    interchangeRadius: radius,
    interchangeHeight: height,
    oneWay: true,
    median: 0,
    sidewalk: 0,
    cycle: false,
    bus: false,
    parking: false,
    curbs: false,
    lights: false,
    lanes: 2,
    shoulder: 1,
    speed: 80,
    deckThickness: 0.8,
  };
  const add = (type, points, name, extra = {}) => {
    const label = left
      ? name.replace(/East/g, '@').replace(/West/g, 'East').replace(/@/g, 'West')
      : name;
    const road = createRoad(type, points.map(transform), `${id}-r${roads.length}`, {
      ...common,
      name: label,
      ...extra,
    });
    roads.push(road);
    return road;
  };
  const stations = [-extent, -outer, -q, q, outer, extent];
  const routes = [
    { name: 'Eastbound expressway', axis: 'x', fixed: d, stations, upper: false },
    {
      name: 'Westbound expressway',
      axis: 'x',
      fixed: -d,
      stations: [...stations].reverse(),
      upper: false,
    },
    {
      name: 'Northbound overpass',
      axis: 'z',
      fixed: d,
      stations: [...stations].reverse(),
      upper: true,
    },
    { name: 'Southbound overpass', axis: 'z', fixed: -d, stations, upper: true },
  ];
  for (const route of routes) {
    let phase = 0;
    const at = (s) =>
      node(
        route.axis === 'x' ? s : route.fixed,
        route.axis === 'z' ? s : route.fixed,
        route.upper && Math.abs(s) <= outer ? height : 0,
      );
    for (let i = 0; i < route.stations.length - 1; i++) {
      const a = at(route.stations[i]),
        b = at(route.stations[i + 1]);
      const points =
        a.y === b.y
          ? [a, b]
          : [
              a,
              { x: a.x + (b.x - a.x) / 3, z: a.z + (b.z - a.z) / 3, y: a.y },
              { x: a.x + (2 * (b.x - a.x)) / 3, z: a.z + (2 * (b.z - a.z)) / 3, y: b.y },
              b,
            ];
      const road = add(route.upper ? 'bridge' : 'highway', points, route.name, {
        ...(points.length === 4 ? { curveType: 'bezier' } : {}),
        elevation: route.upper ? height : 0,
        ...(route.upper ? { structure: 'overpass' } : {}),
        markingPhase: phase,
        mainline: true,
      });
      phase += createCurve(road).getLength();
    }
  }
  const arc = (cx, cz, r, angle, sweep, y0, y1, name, loop) => {
    const count = Math.ceil(Math.abs(sweep) / (Math.PI / 2)),
      points = [];
    const y = (t) => y0 + (y1 - y0) * smooth(t);
    const dy = (t) => (y1 - y0) * 6 * t * (1 - t);
    for (let i = 0; i < count; i++) {
      const a = angle + (sweep * i) / count,
        b = angle + (sweep * (i + 1)) / count;
      const k = (4 / 3) * Math.tan((b - a) / 4),
        t0 = i / count,
        t1 = (i + 1) / count;
      const p0 = { x: cx + r * Math.cos(a), z: cz + r * Math.sin(a), y: y(t0) };
      const p3 = { x: cx + r * Math.cos(b), z: cz + r * Math.sin(b), y: y(t1) };
      if (i === 0) points.push(p0);
      points.push(
        {
          x: p0.x - k * r * Math.sin(a),
          z: p0.z + k * r * Math.cos(a),
          y: y(t0) + dy(t0) / count / 3,
        },
        {
          x: p3.x + k * r * Math.sin(b),
          z: p3.z - k * r * Math.cos(b),
          y: y(t1) - dy(t1) / count / 3,
        },
        p3,
      );
    }
    for (const i of [0, points.length - 1]) {
      const p = points[i],
        nearest = [...nodeMap.values()].find(
          (n) => Math.hypot(n.x - p.x, n.z - p.z, n.y - p.y) < 0.001,
        );
      if (!nearest) throw new Error('Interchange ramp must connect to a mainline node.');
      points[i] = nearest;
    }
    add('ramp', points, name, {
      lanes: 1,
      shoulder: 0.75,
      curveType: 'bezier',
      elevation: height,
      structure: 'overpass',
      deckThickness: 0.55,
      speed: loop ? 40 : 60,
      loopRamp: loop,
    });
  };
  const turn = Math.PI * 1.5;
  arc(q, q, radius, -Math.PI / 2, turn, 0, height, 'Loop · East to North', true);
  arc(q, -q, radius, Math.PI, turn, height, 0, 'Loop · North to West', true);
  arc(-q, -q, radius, Math.PI / 2, turn, 0, height, 'Loop · West to South', true);
  arc(-q, q, radius, 0, turn, height, 0, 'Loop · South to East', true);
  const r = outer - d;
  arc(-outer, outer, r, -Math.PI / 2, Math.PI / 2, 0, height, 'Connector · East to South', false);
  arc(outer, outer, r, Math.PI, Math.PI / 2, height, 0, 'Connector · North to East', false);
  arc(outer, -outer, r, Math.PI / 2, Math.PI / 2, 0, height, 'Connector · West to North', false);
  arc(-outer, -outer, r, 0, Math.PI / 2, height, 0, 'Connector · South to West', false);
  return roads;
}

export function cloverleafFromGesture(positions, standard = 'us', id) {
  const [a, b] = [positions[0], positions.at(-1)];
  const distance = Math.hypot(b.x - a.x, b.z - a.z);
  return createCloverleaf(a, {
    radius: clamp(distance / 8, 40, 110),
    rotation: Math.atan2(b.z - a.z, b.x - a.x),
    standard,
    id,
  });
}

/** Classic diamond: raised one-way highway pair, ground cross-street,
 * two shared ramp terminals and four directional slip roads. */
export function createDiamond(center = { x: 0, z: 0 }, options = {}) {
  const id = options.id || `diamond-${crypto.randomUUID()}`;
  const radius = clamp(options.radius ?? 55, 40, 110),
    height = clamp(options.height ?? 8, 6, 20);
  const rotation = options.rotation || 0,
    left = ['uk', 'jp', 'au'].includes(options.standard);
  const roads = [],
    nodes = new Map(),
    d = 8,
    exit = radius * 4,
    extent = radius * 7.6,
    cross = radius * 1.8;
  const node = (x, z, y = 0) => {
    const key = `${x},${z},${y}`;
    if (!nodes.has(key)) nodes.set(key, { x, z, y, nodeId: `${id}-n${nodes.size}` });
    return nodes.get(key);
  };
  const transform = (p) => {
    const x = left ? -p.x : p.x;
    return {
      ...p,
      x: center.x + x * Math.cos(rotation) - p.z * Math.sin(rotation),
      z: center.z + x * Math.sin(rotation) + p.z * Math.cos(rotation),
    };
  };
  const common = {
    interchangeId: id,
    interchangeType: 'diamond',
    interchangeRadius: radius,
    interchangeHeight: height,
    sidewalk: 0,
    median: 0,
    lanes: 2,
    oneWay: true,
    cycle: false,
    bus: false,
    parking: false,
    lights: false,
    curbs: false,
    shoulder: 1,
    deckThickness: 0.8,
    drainage: 'none',
  };
  const add = (type, points, name, overrides = {}) => {
    const road = createRoad(type, points.map(transform), `${id}-r${roads.length}`, {
      ...common,
      name,
      ...overrides,
    });
    roads.push(road);
    return road;
  };
  for (const [name, z, stations] of [
    ['Eastbound diamond mainline', d, [-extent, -exit, exit, extent]],
    ['Westbound diamond mainline', -d, [extent, exit, -exit, -extent]],
  ]) {
    let phase = 0;
    for (let i = 0; i < stations.length - 1; i++) {
      const a = node(stations[i], z, Math.abs(stations[i]) === extent ? 0 : height),
        b = node(stations[i + 1], z, Math.abs(stations[i + 1]) === extent ? 0 : height);
      const points =
        a.y === b.y
          ? [a, b]
          : [
              a,
              { x: a.x + (b.x - a.x) / 3, z, y: a.y },
              { x: a.x + (2 * (b.x - a.x)) / 3, z, y: b.y },
              b,
            ];
      const road = add('bridge', points, name, {
        ...(points.length > 2 ? { curveType: 'bezier' } : {}),
        mainline: true,
        elevation: height,
        speed: 90,
        markingPhase: phase,
      });
      phase += createCurve(road).getLength();
    }
  }
  const crossStations = [-radius * 6.5, -cross, cross, radius * 6.5];
  for (let i = 0; i < crossStations.length - 1; i++)
    add(
      'local',
      [node(0, crossStations[i]), node(0, crossStations[i + 1])],
      'Diamond cross-street',
      {
        oneWay: false,
        mainline: true,
        lanes: 2,
        sidewalk: 2.2,
        laneWidth: 3.3,
        shoulder: 0,
        curbs: true,
        crosswalkRamps: true,
        speed: 40,
      },
    );
  const ramp = (a, b, t0, t1, name) => {
    const length = Math.hypot(b.x - a.x, b.z - a.z) * 0.45;
    add(
      'ramp',
      [a, { x: a.x + t0 * length, z: a.z, y: a.y }, { x: b.x - t1 * length, z: b.z, y: b.y }, b],
      name,
      {
        curveType: 'bezier',
        lanes: 1,
        shoulder: 0.75,
        elevation: height,
        deckThickness: 0.55,
        speed: 45,
        structure: 'overpass',
      },
    );
  };
  ramp(node(-exit, d, height), node(0, cross), 1, 1, 'Diamond · Eastbound exit');
  ramp(node(0, -cross), node(-exit, -d, height), -1, -1, 'Diamond · Westbound entry');
  ramp(node(exit, -d, height), node(0, -cross), -1, -1, 'Diamond · Westbound exit');
  ramp(node(0, cross), node(exit, d, height), 1, 1, 'Diamond · Eastbound entry');
  return roads;
}

export function diamondFromGesture(positions, standard = 'us', id) {
  const [a, b] = [positions[0], positions.at(-1)];
  return createDiamond(a, {
    radius: clamp(Math.hypot(b.x - a.x, b.z - a.z) / 7.6, 40, 110),
    rotation: Math.atan2(b.z - a.z, b.x - a.x),
    standard,
    id,
  });
}

/** Attach a junction to the actual existing spline and split that street once.
 * No copy of the existing carriageway is created by these connector tools.
 */
export function junctionFromGesture(network, type, positions, id = `join-${crypto.randomUUID()}`) {
  const [position, finish] = [positions[0], positions.at(-1)];
  let best;
  for (const road of network.roads.filter(
    (r) => !r.hidden && !['railway', 'subway', 'path'].includes(r.type),
  )) {
    const path = sampleCurve(road, 2),
      near = distanceToPath(position, path);
    const score = near.distance + 2 * Math.abs(near.y - (position.y || 0));
    if (near.distance < roadWidth(road) / 2 + 2 && (!best || score < best.score))
      best = { road, path, near, score };
  }
  if (!best)
    throw new Error('First click must be on an existing road. Then click the branch endpoint.');
  const { road, path } = best;
  // Refine the closest point on curved streets; sampled-chord points leave gaps.
  let lo = Math.max(0, best.near.along - 3),
    hi = Math.min(path.length, best.near.along + 3);
  const distance = (d) => {
    const p = path.curve.getPointAt(d / path.length);
    return Math.hypot(p.x - position.x, p.z - position.z);
  };
  for (let i = 0; i < 28; i++) {
    const a = lo + (hi - lo) / 3,
      b = hi - (hi - lo) / 3;
    if (distance(a) < distance(b)) hi = b;
    else lo = a;
  }
  const along = (lo + hi) / 2,
    frame = frameAt(path.curve, along, path.length);
  if (frame.point.y > 0.3 && type !== 'ymerge')
    throw new Error(
      'T and four-way junctions need a ground-level street. Use a ramp for elevated merges.',
    );
  const anchor =
    along < 0.1
      ? road.points[0]
      : path.length - along < 0.1
        ? road.points.at(-1)
        : { x: frame.point.x, y: frame.point.y, z: frame.point.z, nodeId: `${id}-node` };
  const length = Math.hypot(finish.x - anchor.x, finish.z - anchor.z);
  if (length < 24) throw new Error('Place the branch endpoint at least 24 m away.');
  const dir = { x: (finish.x - anchor.x) / length, z: (finish.z - anchor.z) / length };
  if (distanceToPath(finish, path).distance < roadWidth(road) / 2 + 0.75)
    throw new Error(
      'Place the branch endpoint outside the existing road, not along its carriageway.',
    );
  if (
    type !== 'ymerge' &&
    Math.abs(dir.x * frame.normal.x + dir.z * frame.normal.z) < Math.sin(Math.PI / 12)
  )
    throw new Error(
      'Aim the branch at least 15° away from the road. Use Y merge for a shallow entry.',
    );
  const roads = [];
  if (type === 'ymerge') {
    const points = [
      { ...finish, y: finish.y || 0 },
      {
        x: finish.x - dir.x * length * 0.35,
        z: finish.z - dir.z * length * 0.35,
        y: finish.y || 0,
      },
      {
        x: anchor.x - frame.tangent.x * length * 0.35,
        z: anchor.z - frame.tangent.z * length * 0.35,
        y: anchor.y,
      },
      anchor,
    ];
    roads.push(
      createRoad('ramp', points, `${id}-r0`, {
        name: 'Y merge · entry ramp',
        curveType: 'bezier',
        elevation: anchor.y,
        lights: false,
        junctionTemplate: 'ymerge',
      }),
    );
  } else {
    roads.push(
      createRoad('local', [anchor, { ...finish, y: 0 }], `${id}-r0`, {
        name: type === 'crossroad' ? 'Four-way · branch A' : 'T-junction · branch',
        parking: false,
        junctionTemplate: type,
      }),
    );
    if (type === 'crossroad')
      roads.push(
        createRoad(
          'local',
          [anchor, { x: anchor.x - dir.x * length, z: anchor.z - dir.z * length, y: 0 }],
          `${id}-r1`,
          { name: 'Four-way · branch B', parking: false, junctionTemplate: type },
        ),
      );
  }
  const pieces =
    anchor === road.points[0] || anchor === road.points.at(-1)
      ? [road]
      : [
          sliceRoad(road, 0, along / path.length, road.points[0], anchor),
          sliceRoad(
            road,
            along / path.length,
            1,
            anchor,
            road.points.at(-1),
            `${road.id}-cut-${id}`,
          ),
        ];
  return {
    base: { ...network, roads: network.roads.flatMap((r) => (r.id === road.id ? pieces : [r])) },
    roads,
    connectedRoad: road.id,
  };
}
