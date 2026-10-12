/* ============================================================================
   CityGenerator — synthesise a whole road network from a seed.

   Four skeletons are provided, each with its own hierarchy rules:

     grid      Manhattan-style avenue/street lattice with a Broadway diagonal
     radial    concentric rings + radial spokes with a central circus
     organic   irregular lattice — jittered spacing, dropped links, cul-de-sac
     highway   beltway + motorway radials over a local grid, grade separated

   Everything downstream (presets, cross-sections, markings, junctions) is
   derived from the graph this produces, so a generated city is fully
   editable by hand afterwards.
   ========================================================================== */

import { makeRNG, clamp, lerp, TAU } from '../core/mathx.js';
import { findCrossings } from './Railway.js';

export const PATTERNS = [
  { id: 'grid', label: 'Manhattan Grid', desc: 'avenue / street lattice' },
  { id: 'radial', label: 'Radial Concentric', desc: 'rings + spokes' },
  { id: 'organic', label: 'Organic Town', desc: 'irregular historic lattice' },
  { id: 'highway', label: 'Highway Metropolis', desc: 'beltway + radials, grade separated' },
  { id: 'coastal', label: 'Coastal Strip', desc: 'waterfront promenade + grid' },
];

export const DEFAULTS = {
  seed: 20240,
  pattern: 'grid',
  extent: 2400,
  blockLength: 180,
  blockWidth: 96,
  jitter: 0,
  density: 1,
  hierarchy: true,
  roundabouts: 0.1,
  busLanes: true,
  cycleLanes: true,
  parking: true,
  humps: false,
  lighting: true,
  terrain: 0,
  railLines: 1,
  metroLines: 1,
  beltway: false,
  river: false,
  oneWayRatio: 0.25,
};

const ORDINALS = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th', '11th', '12th'];
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

/* ------------------------------------------------------------- helpers --- */

function addNodeAt(net, x, z, y = 0) {
  return net.addNode(x, y, z);
}

/** Split an edge at a list of arc-length distances, preserving its shape. */
function splitEdgeAtDistances(net, edge, dists, extra = {}) {
  const curve = edge.curve(net);
  if (!curve) return [edge];
  const A = net.nodes.get(edge.a), B = net.nodes.get(edge.b);
  if (!A || !B) return [edge];
  const L = curve.length;
  const cuts = [0, ...dists.filter((d) => d > 1.5 && d < L - 1.5).sort((a, b) => a - b), L];
  if (cuts.length <= 2) return [edge];

  const ids = [edge.a];
  for (let i = 1; i < cuts.length - 1; i++) {
    const p = curve.pos(cuts[i], { x: 0, y: 0 });
    const n = net.addNode(p.x, lerp(A.y, B.y, cuts[i] / L), p.y);
    ids.push(n.id);
  }
  ids.push(edge.b);

  const out = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const s0 = cuts[i], s1 = cuts[i + 1];
    const pts = [];
    const n = Math.max(1, Math.round((s1 - s0) / 60));
    for (let k = 1; k < n; k++) {
      const p = curve.pos(s0 + ((s1 - s0) * k) / n, { x: 0, y: 0 });
      pts.push({ x: p.x, z: p.y });
    }
    const e = net.addEdge(ids[i], ids[i + 1], {
      pts,
      preset: edge.preset,
      bands: edge.bands,
      features: edge.features,
      speed: edge.speed,
      markStyle: edge.markStyle,
      camber: edge.camber,
      bankGain: edge.bankGain,
      maxBank: edge.maxBank,
      bridge: edge.bridge,
      tunnel: edge.tunnel,
      name: edge.name,
    });
    out.push(e);
  }
  net.removeEdge(edge.id);
  return out;
}

/** Build a polyline of new nodes/edges (used for rail + motorway corridors). */
function corridor(net, pts, opts) {
  const out = [];
  let prev = net.addNode(pts[0].x, 0, pts[0].z);
  for (let i = 1; i < pts.length; i++) {
    const n = net.addNode(pts[i].x, 0, pts[i].z);
    out.push(net.addEdge(prev.id, n.id, opts));
    prev = n;
  }
  return out;
}

/* --------------------------------------------------------------- grid ---- */

function genGrid(net, rng, o) {
  const half = o.extent / 2;
  const xs = [], zs = [];
  for (let x = -half; x <= half + 0.1; x += o.blockLength) xs.push(x);
  for (let z = -half; z <= half + 0.1; z += o.blockWidth) zs.push(z);

  const grid = [];
  for (let i = 0; i < xs.length; i++) {
    grid[i] = [];
    for (let j = 0; j < zs.length; j++) {
      const jitter = o.jitter * o.blockWidth * 0.45;
      const x = xs[i] + (o.jitter ? rng.gauss(0, jitter) : 0);
      const z = zs[j] + (o.jitter ? rng.gauss(0, jitter) : 0);
      grid[i][j] = addNodeAt(net, x, z);
    }
  }

  const nsNames = [], ewNames = [];
  for (let i = 0; i < xs.length; i++) nsNames.push(`${ORDINALS[i % ORDINALS.length]} Avenue`);
  for (let j = 0; j < zs.length; j++) ewNames.push(`${LETTERS[j % LETTERS.length]} Street`);

  const mk = (i, j) => grid[i]?.[j];
  const dropChance = o.pattern === 'organic' ? 0.14 : 0;

  // avenues (north-south)
  for (let i = 0; i < xs.length; i++) {
    for (let j = 0; j < zs.length - 1; j++) {
      const a = mk(i, j), b = mk(i, j + 1);
      if (!a || !b) continue;
      if (dropChance && rng.chance(dropChance)) continue;
      const edgeRing = i === 0 || i === xs.length - 1;
      const major = o.hierarchy && i % 3 === 0;
      const mid = o.hierarchy && i % 5 === 2;
      const preset = edgeRing && o.beltway ? 'ring_road' : major ? 'arterial' : mid ? 'avenue' : 'local_street';
      const e = net.addEdge(a.id, b.id, { preset, name: nsNames[i], bankGain: 0.0 });
      if (o.hierarchy && rng.chance(o.oneWayRatio) && preset === 'local_street') e.preset = 'one_way';
      if (!o.cycleLanes && preset === 'avenue') e.preset = 'arterial';
    }
  }
  // streets (east-west)
  for (let j = 0; j < zs.length; j++) {
    for (let i = 0; i < xs.length - 1; i++) {
      const a = mk(i, j), b = mk(i + 1, j);
      if (!a || !b) continue;
      if (dropChance && rng.chance(dropChance * 0.8)) continue;
      const edgeRing = j === 0 || j === zs.length - 1;
      const crosstown = o.hierarchy && j % 4 === 1;
      const preset = edgeRing && o.beltway ? 'ring_road' : crosstown ? 'avenue' : 'local_street';
      const e = net.addEdge(a.id, b.id, { preset, name: ewNames[j] });
      if (o.hierarchy && rng.chance(o.oneWayRatio) && preset === 'local_street') e.preset = 'one_way';
    }
  }

  /* a Broadway-style diagonal */
  if (o.hierarchy && xs.length > 4) {
    const pts = [];
    const n = 9;
    const ang = 0.42;
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const z = lerp(-half, half, t);
      const x = lerp(-half * 0.55, half * 0.55, t) + Math.sin(t * 3) * 22;
      pts.push({ x, z });
    }
    const dia = [];
    for (const p of pts) {
      // snap to the nearest existing node so the diagonal forms real junctions
      const near = net.nodeNear(p.x, p.z, o.blockWidth * 0.62);
      dia.push(near || addNodeAt(net, p.x, p.z));
    }
    for (let k = 0; k < dia.length - 1; k++) {
      if (dia[k].id === dia[k + 1].id) continue;
      net.addEdge(dia[k].id, dia[k + 1].id, { preset: 'avenue', name: 'Broadway' });
    }
  }

  return { grid, xs, zs };
}

/* ------------------------------------------------------------- radial ---- */

function genRadial(net, rng, o) {
  const half = o.extent / 2;
  const ringSpacing = Math.max(120, o.blockLength);
  const nRings = Math.max(2, Math.floor((half * 0.94) / ringSpacing));
  const nSpokes = clamp(Math.round((TAU * half) / Math.max(240, o.blockLength * 1.35)), 6, 28);

  const grid = [];
  for (let k = 0; k < nRings; k++) {
    grid[k] = [];
    const r = ringSpacing * (k + 1);
    for (let s = 0; s < nSpokes; s++) {
      const a = (s / nSpokes) * TAU + (k % 2) * (Math.PI / nSpokes) * 0.35;
      const rr = r * (1 + (o.jitter ? rng.gauss(0, 0.05) : 0));
      grid[k][s] = addNodeAt(net, Math.cos(a) * rr, Math.sin(a) * rr);
    }
  }
  // central circus
  const centre = addNodeAt(net, 0, 0);
  centre.junction = { type: 'roundabout', outer: 34, width: 9, radius: 12 };

  for (let s = 0; s < nSpokes; s++) {
    const a = (s / nSpokes) * TAU;
    const first = grid[0][s];
    net.addEdge(centre.id, first.id, { preset: 'avenue', name: `${ORDINALS[s % ORDINALS.length]} Radial` });
  }
  for (let k = 0; k < nRings; k++) {
    const outer = k === nRings - 1;
    const preset = outer && o.beltway ? 'ring_road' : k % 2 === 0 ? 'avenue' : 'local_street';
    for (let s = 0; s < nSpokes; s++) {
      const a = grid[k][s], b = grid[k][(s + 1) % nSpokes];
      if (k === nRings - 1 && o.beltway) {
        net.addEdge(a.id, b.id, { preset: 'ring_road', name: 'Beltway' });
      } else if (rng.chance(1 - (o.pattern === 'organic' ? 0.12 : 0))) {
        net.addEdge(a.id, b.id, { preset, name: `${ORDINALS[k % ORDINALS.length]} Ring` });
      }
    }
  }
  for (let k = 0; k < nRings - 1; k++) {
    for (let s = 0; s < nSpokes; s++) {
      const a = grid[k][s], b = grid[k + 1][s];
      if (!a || !b) continue;
      if (o.pattern === 'organic' && rng.chance(0.1)) continue;
      net.addEdge(a.id, b.id, { preset: k % 2 === 0 ? 'arterial' : 'local_street', name: `${ORDINALS[s % ORDINALS.length]} Radial` });
    }
  }
  return { grid };
}

/* ------------------------------------------------------------ highway ---- */

function genHighway(net, rng, o) {
  // local grid first
  const localOpts = { ...o, beltway: false, hierarchy: true };
  genGrid(net, rng, localOpts);

  const half = o.extent / 2;
  const R = half * 0.62;

  /* beltway: a rounded rectangle of motorway */
  const ringPts = [];
  const sides = 4, per = 7, rad = R * 0.32;
  const corners = [
    { x: -R, z: -R }, { x: R, z: -R }, { x: R, z: R }, { x: -R, z: R },
  ];
  for (let c = 0; c < 4; c++) {
    const a = corners[c], b = corners[(c + 1) % 4];
    for (let k = 0; k < per; k++) {
      const t = k / per;
      ringPts.push({ x: lerp(a.x, b.x, t), z: lerp(a.z, b.z, t) });
    }
  }
  const ringEdges = corridor(net, ringPts, { preset: 'ring_road', name: 'Beltway', closed: false });
  // close the loop
  const firstNode = ringEdges.length ? net.nodes.get(ringEdges[0].a) : null;
  const lastNode = ringEdges.length ? net.nodes.get(ringEdges[ringEdges.length - 1].b) : null;
  if (firstNode && lastNode) net.addEdge(lastNode.id, firstNode.id, { preset: 'ring_road', name: 'Beltway' });
  for (const e of ringEdges) e._elevated = true;

  /* motorway radials */
  const nRad = clamp(Math.round(4 + o.extent / 1400), 4, 10);
  for (let i = 0; i < nRad; i++) {
    const a = (i / nRad) * TAU + rng.range(-0.2, 0.2);
    const pts = [];
    const steps = 8;
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const r = lerp(R * 0.12, R * 1.12, t);
      pts.push({
        x: Math.cos(a) * r + Math.sin(t * 4) * 18 * (1 - t),
        z: Math.sin(a) * r + Math.cos(t * 4) * 18 * (1 - t),
      });
    }
    const eds = corridor(net, pts, { preset: 'motorway', name: `M${i + 1}` });
    for (const e of eds) e._elevated = true;
  }
  return {};
}

/* ------------------------------------------------------------- coastal --- */

function genCoastal(net, rng, o) {
  genGrid(net, rng, { ...o, extent: o.extent * 0.62 });
  const half = o.extent / 2;
  // a waterfront promenade following a gentle curve
  const pts = [];
  const n = 26;
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const x = lerp(-half, half, t);
    const z = half * 0.72 + Math.sin(t * 5.2) * 55 + Math.cos(t * 2.1) * 30;
    pts.push({ x, z });
  }
  corridor(net, pts, { preset: 'promenade', name: 'Marine Parade' });
  corridor(net, pts.map((p) => ({ x: p.x, z: p.z + 14 })), { preset: 'dual_carriageway', name: 'Esplanade' });
  return {};
}

/* --------------------------------------------------------- post passes --- */

function assignRoundabouts(net, rng, prob) {
  let n = 0;
  for (const node of net.nodes.values()) {
    if (net.degree(node.id) !== 4) continue;
    if (!rng.chance(prob)) continue;
    const w = rng.range(6.0, 9.5);
    node.junction = { type: 'roundabout', width: w, outer: w + 12, radius: w };
    n++;
  }
  return n;
}

function assignSignals(net, rng) {
  let n = 0;
  for (const node of net.nodes.values()) {
    const d = net.degree(node.id);
    if (d < 3) continue;
    if (node.junction?.type === 'roundabout') continue;
    const major = net.edgesAt(node.id).some((e) => ['arterial', 'avenue', 'dual_carriageway', 'boulevard'].includes(e.preset));
    if (major && d >= 3) { node.junction = { type: 'signal', radius: 0 }; n++; }
  }
  return n;
}

function addRail(net, rng, o) {
  const half = o.extent / 2;
  let added = 0;
  for (let i = 0; i < (o.railLines || 0); i++) {
    const a = rng.range(0, Math.PI);
    const off = rng.range(-half * 0.5, half * 0.5);
    const pts = [];
    const n = 12;
    for (let k = 0; k <= n; k++) {
      const t = k / n - 0.5;
      const x = Math.cos(a) * t * half * 2 - Math.sin(a) * off;
      const z = Math.sin(a) * t * half * 2 + Math.cos(a) * off + Math.sin(t * 3.1) * 40;
      pts.push({ x, z });
    }
    corridor(net, pts, { preset: 'heavy_rail', name: `Main Line ${i + 1}` });
    added++;
  }
  for (let i = 0; i < (o.metroLines || 0); i++) {
    const a = rng.range(0, Math.PI) + 0.6;
    const off = rng.range(-half * 0.35, half * 0.35);
    const pts = [];
    const n = 14;
    for (let k = 0; k <= n; k++) {
      const t = k / n - 0.5;
      const x = Math.cos(a) * t * half * 2 - Math.sin(a) * off;
      const z = Math.sin(a) * t * half * 2 + Math.cos(a) * off;
      pts.push({ x, z });
    }
    // alternate between trench and elevated along the line for visual variety
    let above = rng.chance(0.5);
    let prev = net.addNode(pts[0].x, 0, pts[0].z);
    for (let k = 1; k < pts.length; k++) {
      const n2 = net.addNode(pts[k].x, 0, pts[k].z);
      if (k % 4 === 0) above = !above;
      net.addEdge(prev.id, n2.id, {
        preset: above ? 'metro_viaduct' : 'metro_trench',
        name: `Metro Line ${String.fromCharCode(65 + i)}`,
      });
      prev = n2;
    }
    added++;
  }
  return added;
}

/**
 * Raise motorway corridors over everything they cross: split the corridor at
 * each crossing, lift the centre, and turn the span into a bridge.
 */
function gradeSeparate(net, crossings, clearance = 7.0, span = 150) {
  let n = 0;
  for (const c of crossings) {
    const A = c.rail, B = c.road;
    let hi = null, lo = null;
    if (A._elevated && !B._elevated) { hi = A; lo = B; }
    else if (B._elevated && !A._elevated) { hi = B; lo = A; }
    if (!hi || !lo) continue;
    const s = hi === A ? c.sRail : c.sRoad;
    const curve = hi.curve(net);
    if (!curve) continue;
    const L = curve.length;
    const a = clamp(s - span, 2, L - 2);
    const b = clamp(s + span, 2, L - 2);
    if (b - a < 20) continue;
    const parts = splitEdgeAtDistances(net, hi, [a, s, b]);
    // parts: [0..a] [a..s] [s..b] [b..L]
    for (let i = 1; i < parts.length - 1; i++) {
      parts[i].bridge = { spacing: 34, deckThickness: 1.8 };
      const na = net.nodes.get(parts[i].a), nb = net.nodes.get(parts[i].b);
      const ya = net.nodes.get(parts[0].a)?.y ?? 0;
      const yb = net.nodes.get(parts[parts.length - 1].b)?.y ?? 0;
      if (na) na.y = i === 1 ? clearance * 0.34 : clearance;
      if (nb) nb.y = clearance;
      na && (na.elevLocked = true);
      nb && (nb.elevLocked = true);
    }
    // the two nodes at ±span become the ramp feet
    n++;
  }
  return n;
}

/* ---------------------------------------------------------------- main --- */

/**
 * Generate a complete road network.
 * @param {import('../model/RoadGraph.js').RoadNetwork} net
 * @param {Object} opts
 */
export function generateCity(net, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const rng = makeRNG(o.seed >>> 0);

  net.clear();
  net.ground = 0;

  switch (o.pattern) {
    case 'radial': genRadial(net, rng, o); break;
    case 'organic': genGrid(net, rng, { ...o, jitter: Math.max(o.jitter, 0.35), hierarchy: false }); break;
    case 'highway': genHighway(net, rng, o); break;
    case 'coastal': genCoastal(net, rng, o); break;
    default: genGrid(net, rng, o);
  }

  /* --- hierarchy + furniture tuning --- */
  for (const e of net.edges.values()) {
    const f = e.featuresOf();
    if (!o.busLanes && f.busStops) f.busStops = false;
    if (!o.lighting) f.lighting = { on: false };
    if (o.humps && ['local_street', 'one_way', 'woonerf', 'mews'].includes(e.preset)) {
      f.humps = { on: true, spacing: rng.range(45, 85), type: rng.chance(0.35) ? 'table' : 'hump' };
    }
    if (!o.parking) {
      e.bands = e.bandsOf().filter((b) => b.k !== 'parking');
    }
    if (o.cycleLanes && ['arterial', 'avenue'].includes(e.preset) && rng.chance(0.4)) {
      e.preset = rng.chance(0.5) ? 'complete_street' : e.preset;
    }
    e.features = f;
    e.markStyle = o.markStyle || 'eu';
  }

  /* --- rail corridors --- */
  if (o.railLines || o.metroLines) addRail(net, rng, o);

  /* --- junctions --- */
  const round = o.roundabouts > 0 ? assignRoundabouts(net, rng, o.roundabouts) : 0;
  const signals = assignSignals(net, rng);

  /* --- grade separation for elevated corridors --- */
  for (const e of net.edges.values()) e.invalidate();
  let grades = 0;
  {
    const elevated = new Set();
    for (const e of net.edges.values()) if (e._elevated) elevated.add(e.id);
    if (elevated.size) {
      const xs = findCrossings(net);
      grades = gradeSeparate(net, xs.filter((c) => elevated.has(c.rail.id) || elevated.has(c.road.id)));
    }
  }

  /* --- gentle bank on the fast roads --- */
  for (const e of net.edges.values()) {
    if (['motorway', 'expressway', 'ring_road', 'rural_highway', 'autobahn'].includes(e.preset)) {
      e.bankGain = 0.55;
      e.maxBank = 0.07;
    }
  }

  const st = net.stats();
  return {
    ...st,
    roundabouts: round,
    signals,
    gradeSeparations: grades,
    pattern: o.pattern,
    seed: o.seed,
  };
}
