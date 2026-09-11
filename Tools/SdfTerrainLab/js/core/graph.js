// Node-graph model: type registry, topology, (de)serialization, sim extraction.
// No DOM, no three — safe for node --test.
import { MAT } from './sdf.js';

// param types: float int bool select vec3 spline (river path XZ pts) lake (ellipse+level)
let _uid = 1;
export const nid = (p = 'n') => p + (_uid++) + '_' + Math.floor(Math.random() * 1e6).toString(36);
export function resetUid() { _uid = 1; }

const V3 = (x, y, z) => [x, y, z];
const P = {
  float: (key, label, def, min, max, step = 0.1) => ({ key, label, type: 'float', def, min, max, step }),
  int: (key, label, def, min, max) => ({ key, label, type: 'int', def, min, max }),
  bool: (key, label, def) => ({ key, label, type: 'bool', def }),
  select: (key, label, def, options) => ({ key, label, type: 'select', def, options }),
  vec3: (key, label, def) => ({ key, label, type: 'vec3', def }),
  spline: (key, label) => ({ key, label, type: 'spline' }),
  lake: (key, label) => ({ key, label, type: 'lake' }),
};
const MAT_OPTS = ['Rock', 'Sand', 'Soil', 'Sediment', 'Clay', 'Snow'];

// field = green SDF signal · sim = blue live-simulation signal
export const NODE_TYPES = {
  output: { title: 'Terrain Output', cat: 'output', color: '#e8a33d',
    desc: 'Graph root. The connected field is baked into the SDF volume; sim nodes run live on it.',
    inputs: [{ id: 'field', type: 'field' }], outputs: [], params: [
      P.select('resolution', 'Volume', 'standard', ['draft', 'standard', 'high']),
      P.int('seed', 'Seed', 1337, 1, 99999),
      P.bool('autoRebake', 'Auto rebake', true),
    ] },
  // ── sources ──
  ground: { title: 'Ground Plot', cat: 'field', color: '#7ee787',
    desc: 'Bounded base slab. Every land graph starts here.',
    inputs: [], outputs: [{ id: 'f', type: 'field' }], params: [
      P.float('level', 'Top level', 8, -20, 60), P.float('bottom', 'Bottom', -6, -30, 20),
    ] },
  box: { title: 'Box', cat: 'field', color: '#7ee787', desc: 'Rounded box primitive.',
    inputs: [], outputs: [{ id: 'f', type: 'field' }], params: [
      P.vec3('center', 'Center', V3(0, 16, 0)), P.vec3('size', 'Size', V3(30, 12, 30)),
      P.float('round', 'Round', 1.5, 0, 10), P.select('mat', 'Material', 0, MAT_OPTS),
    ] },
  sphere: { title: 'Sphere', cat: 'field', color: '#7ee787', desc: 'Sphere primitive.',
    inputs: [], outputs: [{ id: 'f', type: 'field' }], params: [
      P.vec3('center', 'Center', V3(0, 18, 0)), P.float('radius', 'Radius', 12, 0.5, 80),
      P.select('mat', 'Material', 0, MAT_OPTS),
    ] },
  ellipsoid: { title: 'Ellipsoid', cat: 'field', color: '#7ee787', desc: 'Ellipsoid primitive.',
    inputs: [], outputs: [{ id: 'f', type: 'field' }], params: [
      P.vec3('center', 'Center', V3(0, 16, 0)), P.vec3('radii', 'Radii', V3(22, 9, 14)),
      P.select('mat', 'Material', 0, MAT_OPTS),
    ] },
  capsule: { title: 'Capsule', cat: 'field', color: '#7ee787', desc: 'Vertical capsule.',
    inputs: [], outputs: [{ id: 'f', type: 'field' }], params: [
      P.vec3('center', 'Center', V3(0, 16, 0)), P.float('radius', 'Radius', 5, 0.5, 40),
      P.float('halfLen', 'Half length', 10, 0, 60), P.select('mat', 'Material', 0, MAT_OPTS),
    ] },
  torus: { title: 'Torus', cat: 'field', color: '#7ee787', desc: 'Flat ring — natural arches when subtracted or unioned.',
    inputs: [], outputs: [{ id: 'f', type: 'field' }], params: [
      P.vec3('center', 'Center', V3(0, 14, 0)), P.float('major', 'Major R', 14, 1, 60),
      P.float('minor', 'Minor R', 3.5, 0.3, 20), P.select('mat', 'Material', 0, MAT_OPTS),
    ] },
  cylinder: { title: 'Cylinder', cat: 'field', color: '#7ee787', desc: 'Vertical cylinder, sea stacks & pillars.',
    inputs: [], outputs: [{ id: 'f', type: 'field' }], params: [
      P.vec3('center', 'Center', V3(0, 14, 0)), P.float('radius', 'Radius', 8, 0.5, 60),
      P.float('halfHeight', 'Half height', 12, 0.5, 60), P.float('round', 'Round', 1, 0, 10),
      P.select('mat', 'Material', 0, MAT_OPTS),
    ] },
  mesa: { title: 'Mesa', cat: 'field', color: '#7ee787', desc: 'Sloped-side butte: radiusTop < radiusBottom gives cliffs.',
    inputs: [], outputs: [{ id: 'f', type: 'field' }], params: [
      P.vec3('center', 'Center', V3(0, 18, 0)), P.float('radiusTop', 'Top R', 14, 1, 80),
      P.float('radiusBottom', 'Base R', 26, 1, 90), P.float('halfHeight', 'Half height', 14, 1, 60),
      P.select('mat', 'Material', 0, MAT_OPTS),
    ] },
  // ── generators ──
  mountain: { title: 'Mountain Range', cat: 'field', color: '#4fd1c5', desc: 'Ridged-multifractal massif, radially masked.',
    inputs: [], outputs: [{ id: 'f', type: 'field' }], params: [
      P.vec3('center', 'Center', V3(0, 0, -30)), P.float('radius', 'Radius', 90, 10, 200),
      P.float('base', 'Base Y', 10, -20, 60), P.float('height', 'Height', 34, 0, 80),
      P.float('feature', 'Feature m', 26, 4, 120), P.int('octaves', 'Octaves', 4, 1, 7),
      P.float('bottom', 'Bottom', -6, -30, 20), P.int('seed', 'Seed', 11, 1, 999),
    ] },
  hills: { title: 'Rolling Hills', cat: 'field', color: '#4fd1c5', desc: 'Billow-noise soil hills.',
    inputs: [], outputs: [{ id: 'f', type: 'field' }], params: [
      P.float('base', 'Base Y', 9, -20, 60), P.float('height', 'Height', 7, 0, 40),
      P.float('feature', 'Feature m', 34, 4, 140), P.int('octaves', 'Octaves', 3, 1, 6),
      P.float('bottom', 'Bottom', -6, -30, 20), P.int('seed', 'Seed', 7, 1, 999),
    ] },
  canyon: { title: 'Canyon Cutter', cat: 'field', color: '#f5a623', desc: 'Meandering channel volume — feed into Subtract.',
    inputs: [], outputs: [{ id: 'f', type: 'field' }], params: [
      P.float('centerX', 'Center X', 0, -90, 90), P.float('bedY', 'Bed Y', 4, -20, 40),
      P.float('width', 'Width', 16, 2, 60), P.float('depth', 'Depth', 26, 2, 70),
      P.float('meander', 'Meander', 9, 0, 30), P.float('bends', 'Bends', 1, 0.2, 3),
      P.float('flare', 'Wall flare', 1.6, 0, 5), P.float('phase', 'Phase', 0, 0, 6.28),
    ] },
  caves: { title: 'Cave Worms', cat: 'field', color: '#f5a623', desc: 'Warped-noise tunnels + worm tubes. Feed into Subtract for real caves.',
    inputs: [], outputs: [{ id: 'f', type: 'field' }], params: [
      P.float('feature', 'Feature m', 22, 6, 80), P.float('radius', 'Radius', 4.5, 0.5, 16),
      P.float('center', 'Threshold', 0.05, -0.5, 0.5), P.float('warp', 'Warp', 6, 0, 20),
      P.float('yMin', 'Floor Y', 2, -20, 40), P.float('yMax', 'Ceil Y', 16, -10, 60),
      P.int('worms', 'Worm tubes', 3, 0, 6), P.int('seed', 'Seed', 21, 1, 999),
    ] },
  dunes: { title: 'Dune Field', cat: 'field', color: '#4fd1c5', desc: 'Wind-sharped sand seas with sinuous crests.',
    inputs: [], outputs: [{ id: 'f', type: 'field' }], params: [
      P.float('base', 'Base Y', 7, -20, 60), P.float('height', 'Height', 6, 0, 30),
      P.float('wavelength', 'Wavelength', 26, 6, 90), P.float('sharpness', 'Sharpness', 1.6, 0.5, 4),
      P.float('windDir', 'Wind dir°', 35, 0, 360), P.float('bottom', 'Bottom', -6, -30, 20),
      P.int('seed', 'Seed', 5, 1, 999),
    ] },
  plateau: { title: 'Plateau', cat: 'field', color: '#4fd1c5', desc: 'Flat-top highland with noisy cliff edges.',
    inputs: [], outputs: [{ id: 'f', type: 'field' }], params: [
      P.vec3('center', 'Center', V3(-30, 0, 10)), P.float('radius', 'Radius', 55, 5, 150),
      P.float('baseLow', 'Low Y', 8, -20, 60), P.float('baseHigh', 'High Y', 30, -10, 70),
      P.float('cliffWidth', 'Cliff width', 12, 1, 40), P.float('feature', 'Edge feat', 30, 5, 120),
      P.float('edgeNoise', 'Edge noise', 14, 0, 50), P.float('bottom', 'Bottom', -6, -30, 20),
      P.int('seed', 'Seed', 9, 1, 999),
    ] },
  // ── combinators ──
  union: { title: 'Union', cat: 'field', color: '#7ee787', desc: 'Hard union of A and B.',
    inputs: [{ id: 'a', type: 'field' }, { id: 'b', type: 'field' }], outputs: [{ id: 'f', type: 'field' }], params: [] },
  smoothUnion: { title: 'Smooth Union', cat: 'field', color: '#7ee787', desc: 'Blended union — dunes against cliffs, talus aprons.',
    inputs: [{ id: 'a', type: 'field' }, { id: 'b', type: 'field' }], outputs: [{ id: 'f', type: 'field' }], params: [
      P.float('smooth', 'Smooth m', 4, 0, 20),
    ] },
  subtract: { title: 'Subtract', cat: 'field', color: '#f0665f', desc: 'Carve B out of A. Canyons, caves, arches.',
    inputs: [{ id: 'a', type: 'field' }, { id: 'b', type: 'field' }], outputs: [{ id: 'f', type: 'field' }], params: [] },
  intersect: { title: 'Intersect', cat: 'field', color: '#c792ea', desc: 'Keep only the overlap of A and B.',
    inputs: [{ id: 'a', type: 'field' }, { id: 'b', type: 'field' }], outputs: [{ id: 'f', type: 'field' }], params: [] },
  // ── modifiers ──
  fbmDisplace: { title: 'fBm Displace', cat: 'field', color: '#6cb6ff', desc: ' Fractal detail displacement near the surface.',
    inputs: [{ id: 'in', type: 'field' }], outputs: [{ id: 'f', type: 'field' }], params: [
      P.float('amount', 'Amount m', 2.5, 0, 20), P.float('feature', 'Feature m', 18, 2, 120),
      P.int('octaves', 'Octaves', 4, 1, 7), P.float('range', 'Range m', 12, 1, 40),
      P.int('seed', 'Seed', 3, 1, 999),
    ] },
  ridgedDisplace: { title: 'Ridged Displace', cat: 'field', color: '#6cb6ff', desc: 'Sharp-crested displacement for badlands & scree slopes.',
    inputs: [{ id: 'in', type: 'field' }], outputs: [{ id: 'f', type: 'field' }], params: [
      P.float('amount', 'Amount m', 2, 0, 20), P.float('feature', 'Feature m', 14, 2, 120),
      P.int('octaves', 'Octaves', 3, 1, 7), P.float('range', 'Range m', 12, 1, 40),
      P.int('seed', 'Seed', 4, 1, 999),
    ] },
  terrace: { title: 'Terrace', cat: 'field', color: '#6cb6ff', desc: 'Stratified benches — sedimentary cliffs.',
    inputs: [{ id: 'in', type: 'field' }], outputs: [{ id: 'f', type: 'field' }], params: [
      P.float('step', 'Step m', 4, 0.5, 20), P.float('sharp', 'Sharp', 0.75, 0, 1),
      P.float('amount', 'Amount', 0.8, 0, 1), P.float('range', 'Range m', 14, 1, 40),
    ] },
  warp: { title: 'Domain Warp', cat: 'field', color: '#6cb6ff', desc: 'Large-scale domain distortion, overhangs & folds.',
    inputs: [{ id: 'in', type: 'field' }], outputs: [{ id: 'f', type: 'field' }], params: [
      P.float('amount', 'Amount m', 6, 0, 40), P.float('feature', 'Feature m', 46, 5, 160),
    ] },
  transform: { title: 'Transform', cat: 'field', color: '#6cb6ff', desc: 'Move / rotate / scale a field branch.',
    inputs: [{ id: 'in', type: 'field' }], outputs: [{ id: 'f', type: 'field' }], params: [
      P.vec3('pos', 'Position', V3(0, 0, 0)), P.vec3('rot', 'Rotation°', V3(0, 0, 0)),
      P.vec3('scale', 'Scale', V3(1, 1, 1)),
    ] },
  materialPaint: { title: 'Material Paint', cat: 'field', color: '#c792ea', desc: 'Override material id wherever Mask is inside solid.',
    inputs: [{ id: 'in', type: 'field' }, { id: 'mask', type: 'field' }], outputs: [{ id: 'f', type: 'field' }], params: [
      P.select('mat', 'Material', 1, MAT_OPTS),
    ] },
  // ── sim nodes ──
  rain: { title: 'Rain Emitter', cat: 'sim', color: '#6cb6ff',
    desc: 'Droplets fall over a region, run off along the surface, erode & deposit with capacity + settling.',
    inputs: [], outputs: [{ id: 's', type: 'sim' }], params: [
      P.bool('enabled', 'Enabled', true), P.float('rate', 'Drops /s', 900, 0, 6000),
      P.float('dropSize', 'Drop size mm', 3, 0.5, 20), P.float('brush', 'Brush vox', 1.1, 0.6, 3),
      P.float('capacity', 'Capacity k', 1.0, 0.1, 4), P.float('erode', 'Erode k', 1.0, 0, 4),
      P.float('deposit', 'Deposit k', 1.0, 0, 4), P.float('evap', 'Evaporate', 0.35, 0, 3),
      P.vec3('center', 'Center', V3(0, 40, 0)), P.vec3('size', 'Area', V3(150, 20, 150)),
    ] },
  river: { title: 'River Emitter', cat: 'sim', color: '#4fd1c5',
    desc: 'High-discharge flow along an editable path. Carves channels, builds point bars & deltas.',
    inputs: [], outputs: [{ id: 's', type: 'sim' }], params: [
      P.bool('enabled', 'Enabled', true), P.float('rate', 'Drops /s', 700, 0, 4000),
      P.float('discharge', 'Discharge', 6, 0.5, 30), P.float('brush', 'Brush vox', 1.4, 0.6, 3.5),
      P.float('capacity', 'Capacity k', 1.4, 0.1, 4), P.float('width', 'Water width', 7, 1, 24),
      P.float('speed', 'Flow speed', 5, 0.5, 14), P.bool('showWater', 'Render water', true),
      P.spline('points', 'Path'),
    ] },
  wind: { title: 'Wind Emitter', cat: 'sim', color: '#e8c33d',
    desc: 'Aeolian grains ride the wind band, abrade windward faces, settle in lee shadows.',
    inputs: [], outputs: [{ id: 's', type: 'sim' }], params: [
      P.bool('enabled', 'Enabled', true), P.float('rate', 'Grains /s', 500, 0, 4000),
      P.float('dir', 'Direction°', 35, 0, 360), P.float('speed', 'Speed m/s', 9, 0, 30),
      P.float('height', 'Band center Y', 22, 0, 70), P.float('band', 'Band half-h', 14, 1, 40),
      P.float('gust', 'Gust', 0.35, 0, 1), P.float('brush', 'Brush vox', 1.0, 0.6, 3),
      P.float('abrade', 'Abrade k', 0.7, 0, 3), P.float('capacity', 'Capacity k', 1.0, 0.1, 4),
    ] },
  thermal: { title: 'Thermal / Talus', cat: 'sim', color: '#f5a623',
    desc: 'Slope relaxation: material above the talus angle avalanches downhill. Runs every N sim steps.',
    inputs: [], outputs: [{ id: 's', type: 'sim' }], params: [
      P.bool('enabled', 'Enabled', true), P.float('talus', 'Talus°', 34, 15, 60),
      P.float('rate', 'Rate', 1.0, 0, 4), P.int('every', 'Every N steps', 4, 1, 30),
      P.int('samples', 'Samples', 1500, 100, 12000),
    ] },
  rockfall: { title: 'Rockfall', cat: 'sim', color: '#f0665f',
    desc: 'Blocks detach from steep cliffs, impact, shatter into scree and build talus cones.',
    inputs: [], outputs: [{ id: 's', type: 'sim' }], params: [
      P.bool('enabled', 'Enabled', true), P.float('rate', 'Rocks /s', 24, 0, 400),
      P.float('minSlope', 'Min slope°', 55, 30, 80), P.float('size', 'Size mm', 260, 30, 1500),
      P.float('restitution', 'Bounce', 0.25, 0, 0.8), P.float('brush', 'Brush vox', 1.6, 0.8, 4),
    ] },
  lake: { title: 'Lake / Sea', cat: 'water', color: '#4fd1c5',
    desc: 'Still water body. Particles entering it deposit everything (sedimentation); renders flow-advected water.',
    inputs: [], outputs: [{ id: 's', type: 'sim' }], params: [
      P.bool('enabled', 'Enabled', true), P.float('level', 'Level Y', 6.5, -20, 60),
      P.float('cx', 'Center X', 0, -96, 96), P.float('cz', 'Center Z', 70, -96, 96),
      P.float('rx', 'Radius X', 46, 2, 120), P.float('rz', 'Radius Z', 30, 2, 120),
      P.float('flow', 'Drift', 0.35, 0, 3), P.bool('showWater', 'Render water', true),
    ] },
};

export const CATEGORIES = {
  field: { title: 'Terrain', color: '#7ee787' },
  sim: { title: 'Emitters', color: '#6cb6ff' },
  water: { title: 'Water', color: '#4fd1c5' },
  output: { title: 'System', color: '#e8a33d' },
};

export function defaultParams(type) {
  const def = NODE_TYPES[type];
  const o = {};
  for (const p of def.params) {
    if (p.type === 'vec3') o[p.key] = [...p.def];
    else if (p.type === 'spline') o[p.key] = [];
    else o[p.key] = p.def;
  }
  return o;
}

export function makeNode(type, x = 0, y = 0, params = null) {
  return { id: nid('n'), type, x, y, params: params || defaultParams(type), disabled: false, folded: false };
}

export class Graph {
  constructor() { this.nodes = []; this.links = []; this.version = 0; }
  addNode(node) { this.nodes.push(node); this.version++; return node; }
  removeNode(id) {
    this.nodes = this.nodes.filter(n => n.id !== id);
    this.links = this.links.filter(l => l.from.node !== id && l.to.node !== id);
    this.version++;
  }
  getNode(id) { return this.nodes.find(n => n.id === id) || null; }
  outputNode() { return this.nodes.find(n => n.type === 'output') || null; }
  // Connect output port → input port. Returns {ok, error}.
  connect(fromNode, fromPort, toNode, toPort) {
    const a = this.getNode(fromNode), b = this.getNode(toNode);
    if (!a || !b) return { ok: false, error: 'missing node' };
    const od = NODE_TYPES[a.type].outputs.find(o => o.id === fromPort);
    const id = NODE_TYPES[b.type].inputs.find(i => i.id === toPort);
    if (!od || !id) return { ok: false, error: 'missing port' };
    if (od.type !== id.type) return { ok: false, error: 'type mismatch' };
    if (fromNode === toNode) return { ok: false, error: 'self loop' };
    // single link per input port → replace
    this.links = this.links.filter(l => !(l.to.node === toNode && l.to.port === toPort));
    this.links.push({ id: nid('l'), from: { node: fromNode, port: fromPort }, to: { node: toNode, port: toPort } });
    if (this.hasCycle()) {
      this.links.pop();
      return { ok: false, error: 'would create a cycle' };
    }
    this.version++;
    return { ok: true };
  }
  disconnect(toNode, toPort) {
    const n0 = this.links.length;
    this.links = this.links.filter(l => !(l.to.node === toNode && l.to.port === toPort));
    if (this.links.length !== n0) this.version++;
  }
  hasCycle() {
    const adj = new Map();
    for (const n of this.nodes) adj.set(n.id, []);
    for (const l of this.links) adj.get(l.from.node).push(l.to.node);
    const mark = new Map();
    const visit = (u) => {
      mark.set(u, 1);
      for (const v of adj.get(u) || []) {
        if (mark.get(v) === 1) return true;
        if (!mark.get(v) && visit(v)) return true;
      }
      mark.set(u, 2); return false;
    };
    for (const n of this.nodes) if (!mark.get(n.id) && visit(n.id)) return true;
    return false;
  }
  // field nodes feeding Output, ordered root-first for compile memo
  fieldOrder() {
    const out = this.outputNode();
    if (!out) return [];
    const incoming = new Map();
    for (const l of this.links) incoming.set(l.to.node + ':' + l.to.port, l);
    const seen = new Set(); const order = [];
    const walk = (id) => {
      if (seen.has(id)) return; seen.add(id);
      const def = NODE_TYPES[this.getNode(id)?.type];
      if (!def) return;
      for (const inp of def.inputs) {
        const l = incoming.get(id + ':' + inp.id);
        if (l) walk(l.from.node);
      }
      order.push(id);
    };
    const root = incoming.get(out.id + ':field');
    if (root) walk(root.from.node);
    return order;
  }
  simNodes() { return this.nodes.filter(n => NODE_TYPES[n.type].cat === 'sim' || NODE_TYPES[n.type].cat === 'water'); }
  toJSON() {
    return { app: 'slate-sdf-terrain-lab', v: 1, nodes: this.nodes, links: this.links.map(l => ({ from: l.from, to: l.to })) };
  }
  static fromJSON(data) {
    const g = new Graph();
    if (!data || !Array.isArray(data.nodes)) throw new Error('not a terrain graph');
    for (const n of data.nodes) {
      if (!NODE_TYPES[n.type]) continue;
      const merged = { ...defaultParams(n.type), ...(n.params || {}) };
      g.nodes.push({ id: String(n.id), type: n.type, x: +n.x || 0, y: +n.y || 0, params: merged, disabled: !!n.disabled });
    }
    for (const l of data.links || []) {
      if (l.from && l.to) {
        const r = g.connect(l.from.node, l.from.port, l.to.node, l.to.port);
        if (!r.ok) { /* skip broken links from older versions */ }
      }
    }
    // guarantee single output
    if (!g.outputNode()) g.addNode(makeNode('output', 420, 40));
    g.version++;
    return g;
  }
}

// Extract live emitter configs for the sim. Returns {rain:[], river:[], wind:[], thermal:[], rockfall:[], lake:[]}.
export function collectSim(graph) {
  const sim = { rain: [], river: [], wind: [], thermal: [], rockfall: [], lake: [] };
  for (const n of graph.nodes) {
    if (!sim[n.type] || n.disabled || n.params.enabled === false) continue;
    sim[n.type].push({ id: n.id, p: n.params });
  }
  return sim;
}

export { MAT };
