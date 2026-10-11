// Road network document model. Pure data + immutable update helpers.
import { MAT } from './materials.js';

export const ROAD_CLASSES = {
  motorway: { label: 'Motorway', lanes: 2, laneWidth: 3.6, speed: 110, median: 4, shoulder: 2.5, curb: 0, sidewalk: false, sidewalkW: 0 },
  arterial: { label: 'Arterial', lanes: 2, laneWidth: 3.4, speed: 60, median: 0, shoulder: 0.5, curb: 0.15, sidewalk: true, sidewalkW: 3.0 },
  collector: { label: 'Collector', lanes: 1, laneWidth: 3.2, speed: 50, median: 0, shoulder: 0.3, curb: 0.15, sidewalk: true, sidewalkW: 2.5 },
  local: { label: 'Local street', lanes: 1, laneWidth: 3.0, speed: 30, median: 0, shoulder: 0.2, curb: 0.15, sidewalk: true, sidewalkW: 2.0 },
  service: { label: 'Service road', lanes: 1, laneWidth: 3.0, speed: 20, median: 0, shoulder: 0.2, curb: 0.12, sidewalk: false, sidewalkW: 0 },
};

export const CONTROLS = ['signal', 'stop', 'yield', 'none'];
export const LIGHT_DESIGNS = ['cobra', 'classic', 'post-top'];
export const BOLLARD_DESIGNS = ['round', 'square', 'fluted', 'ball'];
export const RAIL_DESIGNS = ['w-beam', 'pipe', 'cable', 'jersey'];

export function emptyDoc() {
  return {
    name: 'Untitled network',
    junctions: {},
    roads: {},
    stacks: { asphalt: defaultAsphaltStack(), paving: defaultPavingStack() },
    traffic: { count: 10, speed: 1, seed: 7 },
    env: { time: 10.5, fog: 0.000012, exposure: 1.0, shadows: true, wetness: 0 },
    vis: {
      roads: true, markings: true, curbs: true, crosswalks: true, junctions: true,
      lights: true, bollards: true, railings: true, bumps: true, potholes: true,
      traffic: true, ground: true,
    },
  };
}

// Stack entries reference texture types from textures.js by key.
export function defaultAsphaltStack() {
  return [
    { key: 'aggregate', enabled: true, opacity: 1, scale: 1, intensity: 0.8, roughness: 0.85, color: [0.1, 0.1, 0.11], blend: 'normal', mask: 'none', p: [0, 0, 0, 0] },
    { key: 'chip', enabled: true, opacity: 0.45, scale: 1, intensity: 0.7, roughness: 0.6, color: [0.6, 0.6, 0.6], blend: 'add', mask: 'none', p: [0, 0, 0, 0] },
    { key: 'cracks', enabled: true, opacity: 0.8, scale: 3, intensity: 0.9, roughness: 0.9, color: [0.5, 0.5, 0.5], blend: 'multiply', mask: 'none', p: [1, 0, 0, 0] },
    { key: 'tirewear', enabled: true, opacity: 0.9, scale: 1, intensity: 0.8, roughness: 0.5, color: [0.5, 0.5, 0.5], blend: 'multiply', mask: 'lanes', p: [0, 0, 0, 0] },
    { key: 'oil', enabled: true, opacity: 0.5, scale: 6, intensity: 0.7, roughness: 0.25, color: [0.5, 0.5, 0.5], blend: 'multiply', mask: 'none', p: [0, 0, 0, 0] },
    { key: 'grime', enabled: true, opacity: 0.6, scale: 8, intensity: 0.6, roughness: 0.92, color: [0.5, 0.5, 0.5], blend: 'multiply', mask: 'none', p: [0, 0, 0, 0] },
  ];
}

export function defaultPavingStack() {
  return [
    { key: 'slabs', enabled: true, opacity: 1, scale: 1, intensity: 0.8, roughness: 0.75, color: [0.62, 0.61, 0.58], blend: 'normal', mask: 'none', p: [1.5, 0.012, 0, 0] },
    { key: 'grime', enabled: true, opacity: 0.5, scale: 8, intensity: 0.6, roughness: 0.9, color: [0.5, 0.5, 0.5], blend: 'multiply', mask: 'none', p: [0, 0, 0, 0] },
  ];
}

export function makeRoad(id, name, a, b, wps, cls = 'arterial') {
  const c = ROAD_CLASSES[cls];
  return {
    id, name, a, b, wps, cls,
    lanes: c.lanes, laneWidth: c.laneWidth, speed: c.speed,
    median: c.median, shoulder: c.shoulder,
    curb: c.curb, sidewalk: c.sidewalk, sidewalkW: c.sidewalkW,
    bridge: false, deckT: 1.2,
    lights: { on: false, spacing: 30, side: 'both', design: 'cobra' },
    bollards: { on: false, spacing: 2.5, design: 'round' },
    rail: { on: false, design: 'w-beam' },
    bumps: [],
    potholes: [],
  };
}

export function makeJunction(id, name, p) {
  return { id, name, p, control: 'signal', crosswalks: true };
}

export function applyClass(road, cls) {
  const c = ROAD_CLASSES[cls];
  return {
    ...road, cls,
    lanes: c.lanes, laneWidth: c.laneWidth, speed: c.speed, median: c.median,
    shoulder: c.shoulder, curb: c.curb, sidewalk: c.sidewalk, sidewalkW: c.sidewalkW,
  };
}

// Derived cross-section numbers used by geometry. All distances in metres.
export function crossSection(r) {
  const m2 = r.median / 2;
  const H = m2 + r.lanes * r.laneWidth + r.shoulder;   // carriageway edge
  const cH = r.curb > 0 ? r.curb : 0;
  const cw = cH > 0 ? 0.25 : 0;
  const sw = r.sidewalk ? r.sidewalkW : 0;
  return {
    m2, H, cH, cw, H2: H + cw, O: H + cw + sw, sh: r.shoulder,
    deckT: r.bridge ? r.deckT : 0,
    lanesPer: r.lanes, laneW: r.laneWidth,
  };
}

// Control points of a road centreline, from junction A to junction B.
export function roadControl(doc, road) {
  const A = doc.junctions[road.a], B = doc.junctions[road.b];
  if (!A || !B) return null;
  return [A.p, ...road.wps, B.p];
}

// ---- immutable operations -------------------------------------------------------

export function nextId(prefix, existing) {
  let n = 1;
  while (existing[`${prefix}${n}`]) n++;
  return `${prefix}${n}`;
}

export function addJunction(doc, p, name) {
  const id = nextId('J', doc.junctions);
  const j = makeJunction(id, name || `Junction ${Object.keys(doc.junctions).length + 1}`, p);
  return { doc: { ...doc, junctions: { ...doc.junctions, [id]: j } }, id };
}

export function patchJunction(doc, id, patch) {
  const j = doc.junctions[id];
  if (!j) return doc;
  return { ...doc, junctions: { ...doc.junctions, [id]: { ...j, ...patch } } };
}

export function addRoad(doc, a, b, wps = [], cls = 'arterial') {
  const id = nextId('R', doc.roads);
  const r = makeRoad(id, `${doc.junctions[a]?.name ?? a} – ${doc.junctions[b]?.name ?? b}`, a, b, wps, cls);
  return { doc: { ...doc, roads: { ...doc.roads, [id]: r } }, id };
}

export function patchRoad(doc, id, patch) {
  const r = doc.roads[id];
  if (!r) return doc;
  const next = typeof patch === 'function' ? patch(r) : { ...r, ...patch };
  return { ...doc, roads: { ...doc.roads, [id]: next } };
}

export function removeRoad(doc, id) {
  const roads = { ...doc.roads };
  delete roads[id];
  return { ...doc, roads };
}

export function removeJunction(doc, id) {
  const junctions = { ...doc.junctions };
  delete junctions[id];
  const roads = {};
  for (const [k, r] of Object.entries(doc.roads)) if (r.a !== id && r.b !== id) roads[k] = r;
  return { ...doc, junctions, roads };
}

// Junction ends touching a junction: [{ road, end: 'A' | 'B' }]
export function roadsAt(doc, jid) {
  const out = [];
  for (const r of Object.values(doc.roads)) {
    if (r.a === jid) out.push({ road: r, end: 'A' });
    if (r.b === jid) out.push({ road: r, end: 'B' });
  }
  return out;
}

export function setWaypoint(doc, roadId, index, p) {
  return patchRoad(doc, roadId, (r) => ({ ...r, wps: r.wps.map((w, i) => (i === index ? p : w)) }));
}

export function insertWaypoint(doc, roadId, index, p) {
  return patchRoad(doc, roadId, (r) => {
    const wps = r.wps.slice();
    wps.splice(index, 0, p);
    return { ...r, wps };
  });
}

export function removeWaypoint(doc, roadId, index) {
  return patchRoad(doc, roadId, (r) => ({ ...r, wps: r.wps.filter((_, i) => i !== index) }));
}

export const DEFAULT_BUMP = { t: 0.5, len: 3.7, h: 0.09 };
export const DEFAULT_POTHOLE = { t: 0.5, lat: 0.35, r: 0.45, depth: 0.07 };

export function addBump(doc, roadId, t) {
  return patchRoad(doc, roadId, (r) => ({ ...r, bumps: [...r.bumps, { ...DEFAULT_BUMP, t }] }));
}

export function addPothole(doc, roadId, t, lat) {
  return patchRoad(doc, roadId, (r) => ({ ...r, potholes: [...r.potholes, { ...DEFAULT_POTHOLE, t, lat }] }));
}

export function patchFeature(doc, roadId, kind, index, patch) {
  return patchRoad(doc, roadId, (r) => ({
    ...r,
    [kind]: r[kind].map((f, i) => (i === index ? { ...f, ...patch } : f)),
  }));
}

export function removeFeature(doc, roadId, kind, index) {
  return patchRoad(doc, roadId, (r) => ({ ...r, [kind]: r[kind].filter((_, i) => i !== index) }));
}

export function serialize(doc) {
  return JSON.stringify({ format: 'road-studio', version: 1, ...doc }, null, 2);
}

export function deserialize(text) {
  const d = JSON.parse(text);
  if (!d || !d.junctions || !d.roads) throw new Error('Not a Road Studio file');
  const base = emptyDoc();
  return { ...base, ...d, stacks: { ...base.stacks, ...(d.stacks || {}) }, vis: { ...base.vis, ...(d.vis || {}) }, env: { ...base.env, ...(d.env || {}) }, traffic: { ...base.traffic, ...(d.traffic || {}) } };
}

export function createDemoDoc() {
  let doc = emptyDoc();
  doc.name = 'Crossroads with overpass';
  const J = {};
  const add = (name, p) => {
    const r = addJunction(doc, p, name);
    doc = r.doc;
    J[name] = r.id;
    return r.id;
  };
  const cross = add('Central', [0, 0, 0]);
  const north = add('North gate', [0, 0, -140]);
  const south = add('South gate', [0, 0, 140]);
  const east = add('East gate', [140, 0, 0]);
  const west = add('West gate', [-140, 0, 0]);
  const road = (a, b, wps, cls, name) => {
    const r = addRoad(doc, a, b, wps, cls);
    doc = patchRoad(r.doc, r.id, { name });
    return r.id;
  };
  const rN = road(cross, north, [[0, 0, -70]], 'arterial', 'North arterial');
  const rS = road(cross, south, [], 'arterial', 'South arterial');
  const rE = road(cross, east, [], 'arterial', 'East arterial');
  const rW = road(cross, west, [], 'arterial', 'West arterial');
  // Local loop street with a bend, on the south-east quadrant.
  const local = add('Market corner', [50, 0, 70]);
  road(cross, local, [[24, 0, 36]], 'local', 'Market street');
  // Motorway overpass: rises from ground at both ends, crosses above the central junction.
  const mwW = add('Motorway west', [-260, 0, -60]);
  const mwE = add('Motorway east', [260, 0, -60]);
  const mw = road(mwW, mwE, [[-170, 7, -60], [-60, 7.2, -60], [60, 7.2, -60], [170, 7, -60]], 'motorway', 'Overpass motorway');
  doc = patchRoad(doc, mw, (r) => ({ ...r, bridge: true }));
  // Props and surface features: a demonstration of each feature class.
  doc = patchRoad(doc, rN, (r) => ({ ...r, bumps: [{ ...DEFAULT_BUMP, t: 0.3 }], potholes: [{ ...DEFAULT_POTHOLE, t: 0.62, lat: 0.4, r: 0.5, depth: 0.08 }], lights: { ...r.lights, on: true }, rail: { on: false, design: 'w-beam' } }));
  doc = patchRoad(doc, rS, (r) => ({ ...r, lights: { ...r.lights, on: true, spacing: 28 }, bollards: { on: true, spacing: 2.2, design: 'round' } }));
  doc = patchRoad(doc, rE, (r) => ({ ...r, lights: { ...r.lights, on: true, design: 'classic' }, bollards: { on: true, spacing: 3.0, design: 'fluted' } }));
  doc = patchRoad(doc, rW, (r) => ({ ...r, lights: { ...r.lights, on: true, design: 'post-top' }, bollards: { on: true, spacing: 2.5, design: 'square' }, rail: { on: true, design: 'pipe' } }));
  doc = patchRoad(doc, mw, (r) => ({ ...r, rail: { on: true, design: 'jersey' } }));
  // Junction control defaults
  doc = patchJunction(doc, cross, { control: 'signal' });
  doc = patchJunction(doc, local, { control: 'stop' });
  return doc;
}

export const CONTROL_NAMES = { signal: 'Signal', stop: 'Stop', yield: 'Yield', none: 'Uncontrolled' };
export { MAT };
