// One call builds everything the viewport needs: geometry layers, sim graphs and layer metadata.

import { generateCity, defaultSettings, networkBounds } from './generator.js';
import { buildSurface } from './build.js';
import { buildProps, PROP_LAYERS } from './props.js';
import { buildBlocks, buildGround } from './blocks.js';
import { buildStructures, buildSubway } from './structures.js';
import { buildRail, buildCrossingFurniture, buildBoomMesh, buildTrainMesh } from './rail.js';
import { buildLaneGraph, TrafficSim, TrainSim, generateParkedCars } from '../sim/traffic.js';
import { buildVehicleMesh, buildWheelMesh, VEHICLE_TYPES } from '../sim/vehicles.js';
import { makeRng } from '../core/rng.js';
import { quadWireIndices } from '../core/mesh.js';

const timer = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function buildScene(settings = defaultSettings(), opts = {}) {
  const t0 = timer();
  const { net, rails, subway, meta } = generateCity(settings);
  const generateMs = timer() - t0;
  return assembleScene({ net, rails, subway, meta }, settings, { ...opts, generateMs });
}

/** Re-run every geometry stage on an existing network (used after an intersection is dragged). */
export function assembleScene(world, settings, opts = {}) {
  const { net, rails = [], subway = null, meta = {} } = world;
  const t = { generate: opts.generateMs ?? 0 };
  let t0 = timer();
  const surface = buildSurface(net, { seed: settings.seed });
  t.surface = timer() - t0;

  const rng = makeRng(settings.seed ^ 0x5bd1);
  t0 = timer();
  const props = buildProps(net, surface, settings, rng);
  t.props = timer() - t0;

  t0 = timer();
  const blocks = buildBlocks(net, surface, settings, rng);
  const bounds = networkBounds(net);
  const ground = buildGround(bounds, {});
  t.blocks = timer() - t0;

  t0 = timer();
  const structures = buildStructures(net, surface, settings);
  const railBuild = rails.length ? buildRail(rails, net, settings) : { mesh: null, crossings: [] };
  const crossing = railBuild.crossings.length ? buildCrossingFurniture(railBuild.crossings, net) : { mesh: null, barriers: [] };
  const subwayMesh = subway ? buildSubway(subway) : null;
  t.structures = timer() - t0;

  t0 = timer();
  const laneGraph = buildLaneGraph(net, surface);
  const traffic = new TrafficSim(laneGraph, net, { rng, count: settings.trafficCount });
  const trains = rails.length ? new TrainSim(rails, { cars: 4 }) : null;
  const parked = settings.parkedCars ? generateParkedCars(net, surface, rng, settings.parkingDensity, settings.parkedLimit ?? 90) : [];
  t.sim = timer() - t0;

  // instanced meshes
  const vehicleMeshes = {};
  for (const name of VEHICLE_TYPES) vehicleMeshes[name] = buildVehicleMesh(name);
  const wheelMesh = buildWheelMesh();
  const trainMesh = rails.length ? buildTrainMesh() : null;
  const boomMesh = crossing.barriers.length ? buildBoomMesh() : null;

  const layers = buildLayerModel({ surface, props, blocks, ground, structures, railBuild, crossing, subwayMesh, traffic, parked, net });

  return {
    settings, net, rails, subway, meta, surface, props, blocks, ground, structures,
    rail: railBuild, crossing, subwayMesh, laneGraph, traffic, trains, parked,
    vehicleMeshes, wheelMesh, trainMesh, boomMesh, layers, bounds, timings: t,
    stats: collectStats({ surface, props, blocks, ground, structures, railBuild, crossing, subwayMesh, net, traffic, parked }),
  };
}

function meshStats(m) {
  if (!m) return { v: 0, q: 0, t: 0 };
  return { v: m.vertexCount, q: m.quadCount, t: m.triCount };
}

function collectStats(s) {
  const all = [
    s.surface.mesh, s.blocks.mesh, s.ground, s.structures.meshes.bridges, s.structures.meshes.retaining,
    s.structures.meshes.tunnels, s.railBuild.mesh, s.crossing.mesh, s.subwayMesh,
    ...Object.values(s.props.meshes),
  ].filter(Boolean);
  let v = 0, q = 0, tri = 0;
  for (const m of all) { v += m.vertexCount; q += m.quadCount; tri += m.triCount; }
  const quadRatio = tri ? (q * 2) / tri : 1;
  return {
    vertices: v, quads: q, triangles: tri, quadRatio,
    nodes: s.net.nodes.size, roads: s.net.edges.size,
    junctions: [...s.net.nodes.values()].filter((n) => n.edges.length >= 3).length,
    lengthKm: [...s.net.edges.values()].reduce((a, e) => a + (e.curve ? e.curve.length : 0), 0) / 1000,
    vehicles: s.traffic.vehicles.length,
    parked: s.parked.length,
    blocks: s.blocks.blocks.length,
  };
}

/** Layer-stack model consumed by the UI (geometry layers; material layers live in materials.js). */
function buildLayerModel(s) {
  const L = (id, name, mesh, group, icon, extra = {}) => ({
    id, name, group, icon, mesh: mesh || null,
    visible: extra.visible !== false,
    count: mesh ? mesh.triCount : (extra.count ?? 0),
    kind: extra.kind || 'mesh',
    ...extra,
  });
  const layers = [
    L('surface', 'Carriageway + junctions', s.surface.mesh, 'Network', 'road'),
    L('blocks', 'City blocks & paving', s.blocks.mesh, 'Network', 'blocks'),
    L('ground', 'Terrain apron', s.ground, 'Network', 'terrain'),
    L('bridges', 'Bridge decks & piers', s.structures.meshes.bridges, 'Structures', 'bridge'),
    L('retaining', 'Retaining walls', s.structures.meshes.retaining, 'Structures', 'wall'),
    L('tunnels', 'Tunnel linings', s.structures.meshes.tunnels, 'Structures', 'tunnel'),
    L('subway', 'Subway (cutaway)', s.subwayMesh, 'Structures', 'subway', { visible: false }),
    L('rail', 'Railway permanent way', s.railBuild.mesh, 'Rail', 'rail'),
    L('crossing', 'Level crossing furniture', s.crossing.mesh, 'Rail', 'crossing'),
  ];
  const iconFor = {
    lighting: 'lamp', signals: 'signal', signage: 'sign', bollards: 'bollard',
    railings: 'railing', billboards: 'billboard', furniture: 'bench',
    construction: 'cone', drainage: 'drain',
  };
  const nameFor = {
    lighting: 'Street lighting', signals: 'Traffic signals', signage: 'Signs & posts',
    bollards: 'Bollards', railings: 'Guardrails & railings', billboards: 'Billboards',
    furniture: 'Shelters & benches', construction: 'Works & cones', drainage: 'Gullies & covers',
  };
  for (const k of PROP_LAYERS) {
    if (!s.props.meshes[k]) continue;
    layers.push(L(k, nameFor[k] || k, s.props.meshes[k], 'Furniture', iconFor[k] || 'prop'));
  }
  layers.push(L('traffic', 'AI traffic', null, 'Dynamic', 'car', { kind: 'instanced', count: s.traffic.vehicles.length }));
  layers.push(L('parked', 'Kerbside parking', null, 'Dynamic', 'parked', { kind: 'instanced', count: s.parked.length }));
  layers.push(L('trains', 'Trains', null, 'Dynamic', 'train', { kind: 'instanced', count: 4 }));
  return layers;
}

export { defaultSettings };
