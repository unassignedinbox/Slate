// Node graph: definitions, procedural SDF operators, evaluator, presets. DOM-free.
import { makeNoise, Rng } from './noise.js';
import { AIR, opU, opS, opI, opSU, opSS, sdfSphere, sdfBox, sdfTorus, blurFieldInPlace, clamp01 } from './sdf.js';
import { HydroSim, ThermalSim, WindSim, defaultHydro, defaultThermal, defaultWind } from './erosion.js';

export const CATS = {
  source: { label: 'Sources', color: '#4caf7d' },
  modify: { label: 'Modify', color: '#5aa2ff' },
  combine: { label: 'Combine', color: '#b085ff' },
  carve: { label: 'Carve', color: '#ff9a5a' },
  mask: { label: 'Mask / Hard', color: '#e8d44d' },
  erode: { label: 'Erosion (sim)', color: '#4cd7c4' },
  out: { label: 'Output', color: '#ff6b8a' },
};
const S = (key, label, min, max, step, def) => ({ key, label, type: 'slider', min, max, step, def });
const I = (key, label, min, max, def) => ({ key, label, type: 'int', min, max, def });
const B = (key, label, def) => ({ key, label, type: 'bool', def });
const O = (key, label, opts, def) => ({ key, label, type: 'select', opts, def });

// ---------------------------------------------------------------- defs
export const NODE_DEFS = {
  ground: { title: 'Ground Plane', cat: 'source', desc: 'Base slab with gentle relief', inputs: [],
    params: [S('height', 'Height', 0, 60, 0.5, 14), S('rough', 'Roughness', 0, 12, 0.1, 1.6), S('freq', 'Frequency', 0.002, 0.08, 0.001, 0.016), S('hard', 'Hardness', 0, 1, 0.01, 0.45), I('seed', 'Seed', 0, 9999, 11)] },
  mountain: { title: 'Mountain Massif', cat: 'source', desc: 'FBM mountain base', inputs: [],
    params: [S('base', 'Base level', 0, 50, 0.5, 10), S('height', 'Peak height', 5, 70, 0.5, 42), S('freq', 'Frequency', 0.002, 0.06, 0.001, 0.012), I('oct', 'Octaves', 1, 8, 4), S('warp', 'Domain warp', 0, 40, 0.5, 12), S('hard', 'Hardness', 0, 1, 0.01, 0.6), I('seed', 'Seed', 0, 9999, 101)] },
  ridged: { title: 'Ridged Peaks', cat: 'source', desc: 'Sharp alpine ridges', inputs: [],
    params: [S('base', 'Base level', 0, 50, 0.5, 12), S('height', 'Peak height', 5, 70, 0.5, 46), S('freq', 'Frequency', 0.002, 0.06, 0.001, 0.014), I('oct', 'Octaves', 1, 8, 4), S('sharp', 'Sharpness', 0, 1, 0.01, 0.6), S('hard', 'Hardness', 0, 1, 0.01, 0.7), I('seed', 'Seed', 0, 9999, 202)] },
  mesa: { title: 'Mesa Plateau', cat: 'source', desc: 'Flat-top plateau + strata', inputs: [],
    params: [S('base', 'Base level', 0, 50, 0.5, 16), S('height', 'Plateau height', 5, 60, 0.5, 30), S('freq', 'Frequency', 0.002, 0.05, 0.001, 0.01), S('flat', 'Flatness', 0, 1, 0.01, 0.75), S('strata', 'Strata bands', 0, 24, 1, 9), S('hard', 'Hardness', 0, 1, 0.01, 0.55), I('seed', 'Seed', 0, 9999, 303)] },
  island: { title: 'Volcanic Island', cat: 'source', desc: 'Radial island + crater option', inputs: [],
    params: [S('height', 'Peak height', 5, 70, 0.5, 38), S('radius', 'Radius', 20, 110, 1, 72), S('freq', 'Frequency', 0.002, 0.06, 0.001, 0.02), S('crater', 'Crater', 0, 1, 0.01, 0.45), S('hard', 'Hardness', 0, 1, 0.01, 0.5), I('seed', 'Seed', 0, 9999, 404)] },
  sphere: { title: 'Sphere', cat: 'source', desc: 'Primitive (combine it)', inputs: [],
    params: [S('x', 'X', -100, 100, 0.5, 0), S('y', 'Y', 0, 80, 0.5, 30), S('z', 'Z', -100, 100, 0.5, 0), S('r', 'Radius', 1, 60, 0.5, 16), S('hard', 'Hardness', 0, 1, 0.01, 0.6)] },
  box: { title: 'Box', cat: 'source', desc: 'Primitive (combine it)', inputs: [],
    params: [S('x', 'X', -100, 100, 0.5, 0), S('y', 'Y', 0, 80, 0.5, 24), S('z', 'Z', -100, 100, 0.5, 0), S('sx', 'Size X', 1, 80, 0.5, 18), S('sy', 'Size Y', 1, 60, 0.5, 12), S('sz', 'Size Z', 1, 80, 0.5, 18), S('rot', 'Rot Y°', 0, 180, 1, 0), S('hard', 'Hardness', 0, 1, 0.01, 0.6)] },
  torus: { title: 'Torus / Arch', cat: 'source', desc: 'Primitive ring -> arches', inputs: [],
    params: [S('x', 'X', -100, 100, 0.5, 0), S('y', 'Y', 0, 80, 0.5, 26), S('z', 'Z', -100, 100, 0.5, 0), S('R', 'Ring R', 2, 60, 0.5, 20), S('r', 'Tube r', 1, 20, 0.5, 6), S('hard', 'Hardness', 0, 1, 0.01, 0.65)] },
  displace: { title: 'Displace 3D', cat: 'modify', desc: 'Volumetric noise -> overhangs', inputs: ['in'],
    params: [S('amp', 'Amplitude', 0, 20, 0.1, 5), S('freq', 'Frequency', 0.004, 0.1, 0.001, 0.03), I('oct', 'Octaves', 1, 6, 3), I('seed', 'Seed', 0, 9999, 505)] },
  terrace: { title: 'Terrace', cat: 'modify', desc: 'Stepped strata ledges', inputs: ['in'],
    params: [S('steps', 'Steps', 2, 30, 1, 8), S('sharp', 'Sharpness', 0, 1, 0.01, 0.7), S('blend', 'Blend', 0, 1, 0.01, 0.6)] },
  warp: { title: 'Domain Warp', cat: 'modify', desc: 'Bend / twist the volume', inputs: ['in'],
    params: [S('amp', 'Amplitude', 0, 30, 0.1, 8), S('freq', 'Frequency', 0.002, 0.08, 0.001, 0.015), I('seed', 'Seed', 0, 9999, 606)] },
  smooth: { title: 'Smooth', cat: 'modify', desc: 'Blur SDF (soften)', inputs: ['in'],
    params: [I('iters', 'Iterations', 1, 6, 2), S('strength', 'Strength', 0.05, 1, 0.05, 0.5)] },
  shift: { title: 'Shift', cat: 'modify', desc: 'Translate volume', inputs: ['in'],
    params: [S('dx', 'DX', -60, 60, 0.5, 0), S('dy', 'DY', -40, 40, 0.5, 0), S('dz', 'DZ', -60, 60, 0.5, 0)] },
  union: { title: 'Union', cat: 'combine', desc: 'A + B', inputs: ['A', 'B'], params: [] },
  subtract: { title: 'Subtract', cat: 'combine', desc: 'A − B', inputs: ['A', 'B'], params: [] },
  intersect: { title: 'Intersect', cat: 'combine', desc: 'A ∩ B', inputs: ['A', 'B'], params: [] },
  smoothU: { title: 'Smooth Union', cat: 'combine', desc: 'Blended A + B', inputs: ['A', 'B'],
    params: [S('k', 'Blend', 0, 20, 0.1, 6)] },
  smoothS: { title: 'Smooth Subtract', cat: 'combine', desc: 'Blended A − B', inputs: ['A', 'B'],
    params: [S('k', 'Blend', 0, 20, 0.1, 6)] },
  worm: { title: 'Cave Worm', cat: 'carve', desc: 'Tunnels & cave systems', inputs: ['in'],
    params: [I('tunnels', 'Tunnels', 1, 8, 3), S('radius', 'Radius', 1, 12, 0.1, 4.5), S('vary', 'Radius var', 0, 1, 0.01, 0.5), S('yTop', 'Top Y', 5, 75, 0.5, 34), S('yBot', 'Bottom Y', 1, 60, 0.5, 6), S('twist', 'Twist', 0, 3, 0.05, 1), I('seed', 'Seed', 0, 9999, 707)] },
  cracks: { title: 'Voronoi Cracks', cat: 'carve', desc: 'Fracture the rock', inputs: ['in'],
    params: [S('scale', 'Scale', 0.01, 0.15, 0.002, 0.045), S('width', 'Width', 0.02, 1, 0.01, 0.22), S('depth', 'Depth', 0.5, 12, 0.1, 4), S('yMax', 'Max Y', 5, 80, 0.5, 80), I('seed', 'Seed', 0, 9999, 808)] },
  strata: { title: 'Strata Bands', cat: 'mask', desc: 'Layered rock hardness', inputs: ['in'],
    params: [S('bands', 'Bands', 1, 30, 1, 10), S('contrast', 'Contrast', 0, 1, 0.01, 0.7), S('jitter', 'Jitter', 0, 8, 0.1, 2), I('seed', 'Seed', 0, 9999, 909)] },
  paintHard: { title: 'Hardness Zone', cat: 'mask', desc: 'Override hardness by zone', inputs: ['in'],
    params: [O('mode', 'Zone', ['height', 'slope', 'cavity'], 'height'), S('min', 'Min', 0, 80, 0.5, 20), S('max', 'Max', 0, 80, 0.5, 50), S('feather', 'Feather', 0.5, 20, 0.5, 6), S('value', 'Hardness', 0, 1, 0.01, 0.2)] },
  hydraulic: { title: 'Hydraulic Erosion', cat: 'erode', desc: 'Rain droplets + rivers', inputs: ['in'],
    params: [O('spawn', 'Spawn', ['rain', 'sources', 'both'], 'rain'), I('rate', 'Drops/frame', 50, 6000, 900), I('sources', 'River sources', 1, 12, 4), S('capacity', 'Capacity', 0.5, 20, 0.1, 5), S('erode', 'Erode rate', 0.05, 2, 0.05, 0.5), S('deposit', 'Deposit rate', 0.05, 2, 0.05, 0.5), S('evap', 'Evaporation', 0, 0.08, 0.002, 0.012), S('lateral', 'Undercut', 0, 1, 0.05, 0.35), S('radius', 'Drop radius×', 0.4, 3, 0.1, 1), I('life', 'Lifetime', 20, 400, 5, 90), S('riverW', 'River width', 0.5, 8, 0.1, 2.2), B('rivers', 'Extract rivers', true)] },
  thermal: { title: 'Thermal Erosion', cat: 'erode', desc: 'Talus / scree collapse', inputs: ['in'],
    params: [S('talus', 'Talus slope', 0.2, 2, 0.02, 0.75), S('rate', 'Rate', 0.005, 0.4, 0.005, 0.06), I('samples', 'Samples/frame', 200, 30000, 100, 3500)] },
  wind: { title: 'Wind Erosion', cat: 'erode', desc: 'Abrasion + dunes', inputs: ['in'],
    params: [S('direction', 'Direction°', 0, 360, 1, 35), S('speed', 'Speed', 2, 40, 0.5, 16), S('turb', 'Turbulence', 0, 1.5, 0.05, 0.55), I('rate', 'Grains/frame', 50, 5000, 50, 700), S('abrade', 'Abrasion', 0.05, 2, 0.05, 0.5), S('deposit', 'Deposit', 0.05, 2, 0.05, 0.6)] },
  output: { title: 'Terrain Output', cat: 'out', desc: 'Final landscape', inputs: ['in'], params: [] },
};
export function defaultParams(type) {
  const o = {};
  for (const p of (NODE_DEFS[type].params || [])) o[p.key] = p.def;
  return o;
}

// ---------------------------------------------------------------- graph
let _nid = 1;
export class Graph {
  constructor() { this.nodes = new Map(); this.links = []; _nid = 1; }
  addNode(type, x = 0, y = 0, params = null) {
    const n = { id: _nid++, type, x, y, params: params || defaultParams(type),
      bypass: false, dirty: true, err: null, cacheD: null, cacheH: null, sim: null };
    if (['hydraulic', 'thermal', 'wind'].includes(type)) n.sim = makeEroSim(type, n.id);
    this.nodes.set(n.id, n);
    return n;
  }
  removeNode(id) {
    this.links = this.links.filter(l => l.a !== id && l.b !== id);
    this.nodes.delete(id);
  }
  inputLink(id, bi) { return this.links.find(l => l.b === id && l.bi === bi); }
  outputsOf(id) { return this.links.filter(l => l.a === id); }
  connect(a, ao, b, bi) {
    if (a === b) return false;
    const nb = this.nodes.get(b); if (!nb) return false;
    if (bi < 0 || bi >= (NODE_DEFS[nb.type].inputs.length || 1)) return false;
    // cycle check
    const seen = new Set([a]);
    const stack = [a];
    // walk upstream from a; b must not be reachable... actually check: is a reachable from b?
    const reach = new Set(); const st = [b];
    while (st.length) {
      const c = st.pop();
      if (c === a) return false;
      for (const l of this.links) if (l.b === c && !reach.has(l.a)) { reach.add(l.a); st.push(l.a); }
    }
    this.links = this.links.filter(l => !(l.b === b && l.bi === bi));
    this.links.push({ a, ao: 0, b, bi });
    return true;
  }
  topo() { // topo-sorted nodes (Kahn)
    const indeg = new Map(), adj = new Map();
    for (const n of this.nodes.values()) { indeg.set(n.id, 0); adj.set(n.id, []); }
    for (const l of this.links) {
      if (!indeg.has(l.a) || !indeg.has(l.b)) continue;
      adj.get(l.a).push(l.b);
      indeg.set(l.b, indeg.get(l.b) + 1);
    }
    const q = [];
    for (const [id, dg] of indeg) if (dg === 0) q.push(id);
    const out = [];
    while (q.length) {
      const id = q.shift(); out.push(this.nodes.get(id));
      for (const m of adj.get(id)) { indeg.set(m, indeg.get(m) - 1); if (indeg.get(m) === 0) q.push(m); }
    }
    for (const n of this.nodes.values()) n.err = out.includes(n) ? null : 'cycle?';
    return out;
  }
  serialize() {
    return { nodes: [...this.nodes.values()].map(n => ({ id: n.id, type: n.type, x: n.x, y: n.y, params: n.params, bypass: n.bypass })), links: this.links.map(l => ({ ...l })) };
  }
  deserialize(data) {
    this.nodes.clear(); this.links = []; let mx = 0;
    for (const s of data.nodes || []) {
      const n = { id: s.id, type: s.type, x: s.x, y: s.y, params: { ...defaultParams(s.type), ...(s.params || {}) },
        bypass: !!s.bypass, dirty: true, err: null, cacheD: null, cacheH: null, sim: null };
      if (['hydraulic', 'thermal', 'wind'].includes(s.type)) n.sim = makeEroSim(s.type, s.id);
      this.nodes.set(n.id, n);
      mx = Math.max(mx, n.id);
    }
    _nid = mx + 1;
    this.links = (data.links || []).filter(l => this.nodes.has(l.a) && this.nodes.has(l.b)).map(l => ({ a: l.a, ao: 0, b: l.b, bi: l.bi }));
  }
}
export function makeEroSim(type, id) {
  const s = { type, delta: null, flowA: null, sedA: null, sources: [], prepared: false };
  if (type === 'hydraulic') s.engine = new HydroSim(16000, id * 131 + 7);
  if (type === 'thermal') s.engine = new ThermalSim(id * 131 + 21);
  if (type === 'wind') s.engine = new WindSim(6000, id * 131 + 99);
  return s;
}

// ---------------------------------------------------------------- evaluator
export class Evaluator {
  constructor(field) {
    this.field = field;
    this.tmp = new Float32Array(field.n);
    this.noiseCache = new Map();
  }
  noise(seed) {
    if (!this.noiseCache.has(seed)) this.noiseCache.set(seed, makeNoise(seed));
    return this.noiseCache.get(seed);
  }
  setField(field) {
    this.field = field;
    this.tmp = new Float32Array(field.n);
  }
  ensureCache(n) {
    const f = this.field;
    if (!n.cacheD || n.cacheD.length !== f.n) { n.cacheD = new Float32Array(f.n); n.cacheH = new Float32Array(f.n); }
    if (n.sim) {
      if (!n.sim.delta || n.sim.delta.length !== f.n) {
        n.sim.delta = new Float32Array(f.n); n.sim.flowA = new Float32Array(f.n); n.sim.sedA = new Float32Array(f.n);
      }
    }
  }
  markDirty(graph, id) {
    const n = graph.nodes.get(id); if (!n) return;
    n.dirty = true;
    for (const l of graph.links) if (l.a === id) this.markDirty(graph, l.b);
  }
  markAllDirty(graph) { for (const n of graph.nodes.values()) n.dirty = true; }
  getInput(graph, n, bi) {
    const l = graph.inputLink(n.id, bi);
    if (!l) return null;
    return graph.nodes.get(l.a);
  }
  evaluate(graph, force = false) {
    const order = graph.topo();
    for (const n of order) {
      if (!n || n.err) continue;
      if (!force && !n.dirty && n.cacheD) continue;
      try {
        this.evalNode(graph, n);
        if (typeof n.err === 'string' && n.err.startsWith('needs')) { /* keep soft error */ } else n.err = null;
      } catch (e) { n.err = String(e.message || e).slice(0, 60); }
      n.dirty = false;
    }
    this.compose(graph);
    return order;
  }
  compose(graph) {
    const f = this.field;
    const out = [...graph.nodes.values()].find(n => n.type === 'output');
    const src = out ? this.getInput(graph, out, 0) : null;
    if (src && src.cacheD) { f.d.set(src.cacheD); f.hard.set(src.cacheH); }
    else { f.d.fill(AIR); f.hard.fill(0.5); }
    // viz fields: max-combine of erosion accumulations
    f.flow.fill(0); f.sed.fill(0);
    for (const n of graph.nodes.values()) {
      if (!n.sim || !n.sim.prepared) continue;
      const fa = n.sim.flowA, sa = n.sim.sedA;
      for (let i = 0; i < f.n; i++) {
        if (fa[i] > f.flow[i]) f.flow[i] = fa[i];
        if (sa[i] > f.sed[i]) f.sed[i] = sa[i];
      }
    }
  }
  evalNode(graph, n) {
    const def = NODE_DEFS[n.type];
    this.ensureCache(n);
    if (n.bypass) {
      const inp = this.getInput(graph, n, 0) || this.getInput(graph, n, 1);
      if (inp && inp.cacheD) { n.cacheD.set(inp.cacheD); n.cacheH.set(inp.cacheH); }
      else { n.cacheD.fill(AIR); n.cacheH.fill(0.5); }
      return;
    }
    const need = def.inputs.length;
    if (need === 0) { this.evalSource(n); return; }
    if (need === 1) {
      const inp = this.getInput(graph, n, 0);
      if (!inp || !inp.cacheD) { n.err = 'needs input'; n.cacheD.fill(AIR); n.cacheH.fill(0.5); return; }
      if (n.type === 'output') { n.cacheD.set(inp.cacheD); n.cacheH.set(inp.cacheH); return; }
      if (n.sim) { // erosion: input + accumulated delta
        const dd = n.sim.delta;
        for (let i = 0; i < this.field.n; i++) n.cacheD[i] = inp.cacheD[i] + dd[i];
        n.cacheH.set(inp.cacheH);
        n.sim.prepared = inp.cacheD ? true : n.sim.prepared;
        return;
      }
      n.cacheD.set(inp.cacheD); n.cacheH.set(inp.cacheH);
      this.evalUnary(n);
      return;
    }
    // binary
    const A = this.getInput(graph, n, 0), B = this.getInput(graph, n, 1);
    if ((!A || !A.cacheD) && (!B || !B.cacheD)) { n.err = 'needs A,B'; n.cacheD.fill(AIR); n.cacheH.fill(0.5); return; }
    if (!A || !A.cacheD) { n.err = 'needs A'; n.cacheD.set(B.cacheD); n.cacheH.set(B.cacheH); return; }
    if (!B || !B.cacheD) { n.err = 'needs B'; n.cacheD.set(A.cacheD); n.cacheH.set(A.cacheH); return; }
    this.evalBinary(n, A, B);
  }
  // ------------------------------------------------------------- sources
  colLoop(fn) {
    const f = this.field, R = f.res;
    for (let k = 0; k < R; k++) {
      const z = -f.hx + (k / (R - 1)) * 2 * f.hx;
      for (let i = 0; i < R; i++) {
        const x = -f.hx + (i / (R - 1)) * 2 * f.hx;
        fn(x, z, i, k);
      }
    }
  }
  fillColumn(n, i, k, h, hard) {
    const f = this.field, R = f.res;
    for (let j = 0; j < R; j++) {
      const y = (j / (R - 1)) * f.h;
      const id = (k * R + j) * R + i;
      n.cacheD[id] = y - h;
      n.cacheH[id] = hard;
    }
  }
  evalSource(n) {
    const p = n.params, f = this.field;
    const nz = this.noise(p.seed || 1);
    if (n.type === 'ground') {
      this.colLoop((x, z, i, k) => {
        const h = p.height + nz.fbm(x * p.freq, 3.7, z * p.freq, 3) * 2 * p.rough;
        this.fillColumn(n, i, k, h, p.hard);
      });
    } else if (n.type === 'mountain') {
      this.colLoop((x, z, i, k) => {
        let wx = x, wz = z;
        if (p.warp > 0.01) {
          wx += nz.fbm(x * 0.008 + 9, 1.1, z * 0.008, 3) * 2 * p.warp;
          wz += nz.fbm(x * 0.008, 4.4, z * 0.008 + 3, 3) * 2 * p.warp;
        }
        let m = nz.fbm(wx * p.freq, 7.7, wz * p.freq, p.oct) * 0.5 + 0.5;
        m = Math.pow(Math.min(1, Math.max(0, m)), 1.35);
        this.fillColumn(n, i, k, p.base + m * p.height, Math.min(1, p.hard + m * 0.25));
      });
    } else if (n.type === 'ridged') {
      this.colLoop((x, z, i, k) => {
        let m = nz.ridged(x * p.freq, 2.2, z * p.freq, p.oct);
        m = Math.pow(Math.min(1, Math.max(0, m)), 1 + p.sharp * 1.5);
        this.fillColumn(n, i, k, p.base + m * p.height, Math.min(1, p.hard + m * 0.2));
      });
    } else if (n.type === 'mesa') {
      this.colLoop((x, z, i, k) => {
        let m = nz.fbm(x * p.freq, 5.1, z * p.freq, 4) * 0.5 + 0.5;
        m = m * (1 - p.flat) + (m > 0.45 ? 1 : 0.2) * p.flat;
        const h = p.base + Math.min(1, Math.max(0, m)) * p.height;
        this.fillColumn(n, i, k, h, p.hard);
        if (p.strata > 0) { // strata hardness into column
          const R = f.res;
          for (let j = 0; j < R; j++) {
            const y = (j / (R - 1)) * f.h;
            const band = 0.5 + 0.5 * Math.sin((y / f.h) * p.strata * Math.PI * 2 + m * 3);
            n.cacheH[(k * R + j) * R + i] = Math.min(1, Math.max(0.05, p.hard + (band - 0.5) * 0.7));
          }
        }
      });
    } else if (n.type === 'island') {
      this.colLoop((x, z, i, k) => {
        const r = Math.hypot(x, z) / p.radius;
        const fall = Math.min(1, Math.max(0, 1 - r * r));
        const m = nz.fbm(x * p.freq, 8.8, z * p.freq, 4) * 0.5 + 0.5;
        let h = 6 + fall * fall * (6 + p.height * (0.45 + 0.55 * m));
        if (p.crater > 0.01 && r < 0.35) h -= p.crater * 22 * (1 - r / 0.35);
        this.fillColumn(n, i, k, h, p.hard);
      });
    } else if (n.type === 'sphere' || n.type === 'box' || n.type === 'torus') {
      const R = f.res;
      for (let k = 0; k < R; k++) {
        const z = -f.hx + (k / (R - 1)) * 2 * f.hx;
        for (let j = 0; j < R; j++) {
          const y = (j / (R - 1)) * f.h;
          for (let i = 0; i < R; i++) {
            const x = -f.hx + (i / (R - 1)) * 2 * f.hx;
            const id = (k * R + j) * R + i;
            n.cacheD[id] = n.type === 'sphere' ? sdfSphere(x, y, z, p.x, p.y, p.z, p.r)
              : n.type === 'box' ? sdfBox(x, y, z, p.x, p.y, p.z, p.sx, p.sy, p.sz, (p.rot || 0) * Math.PI / 180)
              : sdfTorus(x, y, z, p.x, p.y, p.z, p.R, p.r);
            n.cacheH[id] = p.hard;
          }
        }
      }
    }
  }
  // ------------------------------------------------------------- unary
  evalUnary(n) {
    const p = n.params, f = this.field, R = f.res;
    const nz = this.noise(p.seed || 1);
    if (n.type === 'displace') {
      for (let k = 0; k < R; k++) {
        const z = -f.hx + (k / (R - 1)) * 2 * f.hx;
        for (let j = 0; j < R; j++) {
          const y = (j / (R - 1)) * f.h;
          for (let i = 0; i < R; i++) {
            const x = -f.hx + (i / (R - 1)) * 2 * f.hx;
            n.cacheD[(k * R + j) * R + i] += nz.fbm(x * p.freq, y * p.freq, z * p.freq, p.oct) * 2 * p.amp;
          }
        }
      }
    } else if (n.type === 'terrace') {
      const span = f.h / Math.max(2, p.steps);
      for (let k = 0; k < R; k++) for (let j = 0; j < R; j++) {
        const y = (j / (R - 1)) * f.h;
        const t = Math.floor(y / span) * span + span * 0.5;
        const pull = (y - t) * p.sharp * p.blend;
        for (let i = 0; i < R; i++) n.cacheD[(k * R + j) * R + i] += pull;
      }
    } else if (n.type === 'warp' || n.type === 'shift') {
      const t = this.tmp;
      const ox = (x, y, z) => n.type === 'shift' ? p.dx : nz.fbm(x * p.freq + 3, y * p.freq, z * p.freq, 3) * 2 * p.amp;
      const oy = (x, y, z) => n.type === 'shift' ? p.dy : nz.fbm(x * p.freq, y * p.freq + 9, z * p.freq, 3) * 2 * p.amp * 0.6;
      const oz = (x, y, z) => n.type === 'shift' ? p.dz : nz.fbm(x * p.freq, y * p.freq, z * p.freq + 5, 3) * 2 * p.amp;
      // resample cacheD into tmp (trilinear on the cache itself)
      const src = n.cacheD;
      const smp = (gx, gy, gz) => {
        gx = Math.min(R - 1.001, Math.max(0, gx)); gy = Math.min(R - 1.001, Math.max(0, gy)); gz = Math.min(R - 1.001, Math.max(0, gz));
        const ix = gx | 0, iy = gy | 0, iz = gz | 0, fx = gx - ix, fy = gy - iy, fz = gz - iz;
        const i000 = (iz * R + iy) * R + ix;
        const x00 = src[i000] + (src[i000 + 1] - src[i000]) * fx;
        const x10 = src[i000 + R] + (src[i000 + R + 1] - src[i000 + R]) * fx;
        const x01 = src[i000 + R * R] + (src[i000 + R * R + 1] - src[i000 + R * R]) * fx;
        const x11 = src[i000 + R * R + R] + (src[i000 + R * R + R + 1] - src[i000 + R * R + R]) * fx;
        return (x00 + (x10 - x00) * fy) + ((x01 + (x11 - x01) * fy) - (x00 + (x10 - x00) * fy)) * fz;
      };
      for (let k = 0; k < R; k++) {
        const z = -f.hx + (k / (R - 1)) * 2 * f.hx;
        for (let j = 0; j < R; j++) {
          const y = (j / (R - 1)) * f.h;
          for (let i = 0; i < R; i++) {
            const x = -f.hx + (i / (R - 1)) * 2 * f.hx;
            const gx = i - ox(x, y, z) / f.dx, gy = j - oy(x, y, z) / f.dy, gz = k - oz(x, y, z) / f.dx;
            t[(k * R + j) * R + i] = smp(gx, gy, gz);
          }
        }
      }
      n.cacheD.set(t);
    } else if (n.type === 'smooth') {
      for (let it = 0; it < p.iters; it++) blurFieldInPlace(n.cacheD, R, p.strength);
    } else if (n.type === 'worm') {
      const rng = new Rng(p.seed || 1);
      for (let tn = 0; tn < p.tunnels; tn++) {
        // random walk control points
        let x = rng.range(-f.hx, f.hx), z = rng.range(-f.hx, f.hx);
        let y = rng.range(p.yBot, p.yTop);
        let hd = rng.range(0, Math.PI * 2);
        const pts = [[x, y, z]];
        const segs = 26;
        for (let s = 0; s < segs; s++) {
          hd += rng.range(-1, 1) * p.twist;
          const stepLen = rng.range(6, 16);
          x += Math.cos(hd) * stepLen; z += Math.sin(hd) * stepLen;
          y += rng.range(-6, 6);
          y = Math.min(p.yTop, Math.max(p.yBot, y));
          x = Math.min(f.hx, Math.max(-f.hx, x)); z = Math.min(f.hx, Math.max(-f.hx, z));
          pts.push([x, y, z]);
        }
        // carve capsules along path (+ occasional chamber)
        for (let s = 0; s < pts.length - 1; s++) {
          const A = pts[s], B = pts[s + 1];
          const r = p.radius * (1 + (nz.n3(s * 0.7 + tn * 9, tn, 3.3)) * p.vary);
          const rr = Math.max(0.8, r);
          if (s % 7 === 3) this.carveSphere(n.cacheD, A[0], A[1], A[2], rr * 1.9);
          this.carveCapsule(n.cacheD, A, B, rr);
        }
      }
    } else if (n.type === 'cracks') {
      const v = [0, 0, 0];
      for (let k = 0; k < R; k++) {
        const z = -f.hx + (k / (R - 1)) * 2 * f.hx;
        for (let j = 0; j < R; j++) {
          const y = (j / (R - 1)) * f.h;
          if (y > p.yMax) continue;
          for (let i = 0; i < R; i++) {
            const id = (k * R + j) * R + i;
            const dv = n.cacheD[id];
            if (dv < -p.depth * 2 || dv > 2) continue;
            const x = -f.hx + (i / (R - 1)) * 2 * f.hx;
            nz.voronoi(x * p.scale, y * p.scale, z * p.scale, v);
            const edge = v[1] - v[0];
            if (edge < p.width) n.cacheD[id] = Math.max(dv, Math.min(p.depth, (p.width - edge) * p.depth * 2));
          }
        }
      }
    } else if (n.type === 'strata') {
      for (let k = 0; k < R; k++) for (let j = 0; j < R; j++) {
        const y = (j / (R - 1)) * f.h;
        for (let i = 0; i < R; i++) {
          const id = (k * R + j) * R + i;
          const x = -f.hx + (i / (R - 1)) * 2 * f.hx;
          const z = -f.hx + (k / (R - 1)) * 2 * f.hx;
          const jit = p.jitter > 0 ? nz.fbm(x * 0.02, y * 0.02, z * 0.02, 2) * 2 * p.jitter : 0;
          const band = 0.5 + 0.5 * Math.sin(((y + jit) / f.h) * p.bands * Math.PI * 2);
          const target = 0.15 + band * 0.75;
          n.cacheH[id] = n.cacheH[id] + (target - n.cacheH[id]) * p.contrast;
        }
      }
    } else if (n.type === 'paintHard') {
      const Rr = R;
      for (let k = 0; k < Rr; k++) for (let j = 0; j < Rr; j++) for (let i = 0; i < Rr; i++) {
        const id = (k * Rr + j) * Rr + i;
        let v;
        if (p.mode === 'height') v = (j / (Rr - 1)) * f.h;
        else if (p.mode === 'slope') {
          const gx = Math.min(Rr - 1, Math.max(0, i));
          const ddx = (n.cacheD[id + (i < Rr - 1 ? 1 : 0)] - n.cacheD[id - (i > 0 ? 1 : 0)]) / (2 * f.dx);
          const ddy = (n.cacheD[Math.min(f.n - 1, id + Rr)] - n.cacheD[Math.max(0, id - Rr)]) / (2 * f.dy);
          const ddz = (n.cacheD[Math.min(f.n - 1, id + Rr * Rr)] - n.cacheD[Math.max(0, id - Rr * Rr)]) / (2 * f.dx);
          v = Math.hypot(ddx, ddz) / Math.max(0.2, Math.abs(ddy)) * 20; // scaled slope
        } else { // cavity: deep inside -> high value
          v = Math.min(80, Math.max(0, -n.cacheD[id] * 2));
        }
        const m0 = Math.min(p.min, p.max), m1 = Math.max(p.min, p.max);
        const dEdge = v < m0 ? m0 - v : v > m1 ? v - m1 : 0;
        const m = clamp01(1 - dEdge / Math.max(0.5, p.feather));
        if (m > 0) n.cacheH[id] = n.cacheH[id] + (p.value - n.cacheH[id]) * m;
      }
    }
  }
  carveSphere(d, cx, cy, cz, r) {
    const f = this.field, R = f.res;
    const g = f.w2g(cx, cy, cz, [0, 0, 0]);
    const rx = r / f.dx, ry = r / f.dy;
    const x0 = Math.max(0, Math.floor(g[0] - rx)), x1 = Math.min(R - 1, Math.ceil(g[0] + rx));
    const y0 = Math.max(0, Math.floor(g[1] - ry)), y1 = Math.min(R - 1, Math.ceil(g[1] + ry));
    const z0 = Math.max(0, Math.floor(g[2] - rx)), z1 = Math.min(R - 1, Math.ceil(g[2] + rx));
    for (let k = z0; k <= z1; k++) for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) {
      const wx = -f.hx + (i / (R - 1)) * 2 * f.hx, wy = (j / (R - 1)) * f.h, wz = -f.hx + (k / (R - 1)) * 2 * f.hx;
      const dist = Math.hypot(wx - cx, wy - cy, wz - cz);
      if (dist < r) {
        const id = (k * R + j) * R + i;
        d[id] = Math.max(d[id], r - dist);
      }
    }
  }
  carveCapsule(d, A, B, r) {
    const f = this.field, R = f.res;
    const x0 = Math.min(A[0], B[0]) - r, x1 = Math.max(A[0], B[0]) + r;
    const y0 = Math.min(A[1], B[1]) - r, y1 = Math.max(A[1], B[1]) + r;
    const z0 = Math.min(A[2], B[2]) - r, z1 = Math.max(A[2], B[2]) + r;
    const gi0 = Math.max(0, Math.floor(((x0 + f.hx) / (2 * f.hx)) * (R - 1)));
    const gi1 = Math.min(R - 1, Math.ceil(((x1 + f.hx) / (2 * f.hx)) * (R - 1)));
    const gj0 = Math.max(0, Math.floor((y0 / f.h) * (R - 1)));
    const gj1 = Math.min(R - 1, Math.ceil((y1 / f.h) * (R - 1)));
    const gk0 = Math.max(0, Math.floor(((z0 + f.hx) / (2 * f.hx)) * (R - 1)));
    const gk1 = Math.min(R - 1, Math.ceil(((z1 + f.hx) / (2 * f.hx)) * (R - 1)));
    const abx = B[0] - A[0], aby = B[1] - A[1], abz = B[2] - A[2];
    const ab2 = abx * abx + aby * aby + abz * abz || 1;
    for (let k = gk0; k <= gk1; k++) {
      const wz = -f.hx + (k / (R - 1)) * 2 * f.hx;
      for (let j = gj0; j <= gj1; j++) {
        const wy = (j / (R - 1)) * f.h;
        for (let i = gi0; i <= gi1; i++) {
          const wx = -f.hx + (i / (R - 1)) * 2 * f.hx;
          const t = Math.min(1, Math.max(0, ((wx - A[0]) * abx + (wy - A[1]) * aby + (wz - A[2]) * abz) / ab2));
          const dx = wx - (A[0] + abx * t), dy = wy - (A[1] + aby * t), dz = wz - (A[2] + abz * t);
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (dist < r) {
            const id = (k * R + j) * R + i;
            d[id] = Math.max(d[id], r - dist);
          }
        }
      }
    }
  }
  // ------------------------------------------------------------- binary
  evalBinary(n, A, B) {
    const p = n.params, a = A.cacheD, b = B.cacheD, ah = A.cacheH, bh = B.cacheH;
    const o = n.cacheD, oh = n.cacheH, N = this.field.n;
    if (n.type === 'union') for (let i = 0; i < N; i++) { const m = a[i] < b[i]; o[i] = m ? a[i] : b[i]; oh[i] = m ? ah[i] : bh[i]; }
    else if (n.type === 'subtract') for (let i = 0; i < N; i++) { o[i] = opS(a[i], b[i]); oh[i] = ah[i]; }
    else if (n.type === 'intersect') for (let i = 0; i < N; i++) { const m = a[i] > b[i]; o[i] = m ? a[i] : b[i]; oh[i] = Math.max(ah[i], bh[i]); }
    else if (n.type === 'smoothU') for (let i = 0; i < N; i++) { const m = a[i] < b[i]; o[i] = opSU(a[i], b[i], p.k); oh[i] = m ? ah[i] : bh[i]; }
    else if (n.type === 'smoothS') for (let i = 0; i < N; i++) { o[i] = opSS(a[i], b[i], p.k); oh[i] = ah[i]; }
  }
  computeSources(graph, n, count) {
    // highest, spread-out surface points for river emitters
    const f = this.field, rng = new Rng(n.id * 77 + 5);
    const cand = [];
    for (let t = 0; t < 600; t++) {
      const x = rng.range(-f.hx * 0.9, f.hx * 0.9), z = rng.range(-f.hx * 0.9, f.hx * 0.9);
      const y = f.findSurface(x, z);
      if (y !== null && y > f.h * 0.35) cand.push([x, y, z]);
    }
    cand.sort((a, b) => b[1] - a[1]);
    const picked = [];
    for (const c of cand) {
      if (picked.length >= count) break;
      if (picked.every(q => Math.hypot(q[0] - c[0], q[2] - c[2]) > f.hx * 0.22)) picked.push([c[0], c[2]]);
    }
    while (picked.length < count && cand.length) picked.push([cand[picked.length % cand.length][0], cand[picked.length % cand.length][2]]);
    return picked;
  }
}

// ---------------------------------------------------------------- presets
export const PRESETS = {
  canyon: {
    label: 'Canyon Rivers', desc: 'Stratified plateau carved by rain + rivers',
    build(g) {
      const m = g.addNode('mesa', -260, -40, { base: 12, height: 34, freq: 0.011, flat: 0.8, strata: 11, hard: 0.55, seed: 41 });
      const s = g.addNode('strata', -60, -40, { bands: 12, contrast: 0.75, jitter: 2.5, seed: 7 });
      const h = g.addNode('hydraulic', 140, -40, { spawn: 'both', rate: 1100, sources: 5, capacity: 6, erode: 0.55, deposit: 0.5, evap: 0.012, lateral: 0.4, radius: 1, life: 100, riverW: 2.4, rivers: true });
      const t = g.addNode('thermal', 340, -40, { talus: 0.7, rate: 0.07, samples: 3000 });
      const o = g.addNode('output', 520, -40);
      g.connect(m.id, 0, s.id, 0); g.connect(s.id, 0, h.id, 0); g.connect(h.id, 0, t.id, 0); g.connect(t.id, 0, o.id, 0);
    }
  },
  island: {
    label: 'Volcanic Island', desc: 'Crater island, shoreline sedimentation',
    build(g) {
      const m = g.addNode('island', -260, -40, { height: 44, radius: 78, freq: 0.02, crater: 0.55, hard: 0.5, seed: 77 });
      const d = g.addNode('displace', -60, -40, { amp: 3.5, freq: 0.03, oct: 3, seed: 12 });
      const h = g.addNode('hydraulic', 140, -40, { spawn: 'both', rate: 1200, sources: 6, capacity: 5.5, erode: 0.5, deposit: 0.55, evap: 0.012, lateral: 0.3, radius: 1, life: 90, riverW: 2, rivers: true });
      const o = g.addNode('output', 340, -40);
      g.connect(m.id, 0, d.id, 0); g.connect(d.id, 0, h.id, 0); g.connect(h.id, 0, o.id, 0);
    }
  },
  caves: {
    label: 'Cave System', desc: 'Massif with worm tunnels + arches',
    build(g) {
      const m = g.addNode('mountain', -300, -80, { base: 8, height: 46, freq: 0.013, oct: 4, warp: 10, hard: 0.62, seed: 9 });
      const w = g.addNode('worm', -100, -80, { tunnels: 4, radius: 4.2, vary: 0.55, yTop: 30, yBot: 5, twist: 1.1, seed: 21 });
      const t = g.addNode('torus', -300, 140, { x: 30, y: 22, z: -20, R: 22, r: 7, hard: 0.6 });
      const u = g.addNode('smoothU', -100, 60, { k: 7 });
      const h = g.addNode('hydraulic', 120, 0, { spawn: 'rain', rate: 700, sources: 3, capacity: 4, erode: 0.4, deposit: 0.5, evap: 0.014, lateral: 0.3, radius: 1, life: 80, riverW: 1.8, rivers: true });
      const o = g.addNode('output', 320, 0);
      g.connect(m.id, 0, w.id, 0); g.connect(w.id, 0, u.id, 0); g.connect(t.id, 0, u.id, 1);
      g.connect(u.id, 0, h.id, 0); g.connect(h.id, 0, o.id, 0);
    }
  },
  dunes: {
    label: 'Dune Field', desc: 'Wind abrasion + dune deposition',
    build(g) {
      const m = g.addNode('ground', -260, -40, { height: 16, rough: 3.5, freq: 0.02, hard: 0.3, seed: 5 });
      const w = g.addNode('warp', -60, -40, { amp: 10, freq: 0.012, seed: 3 });
      const e = g.addNode('wind', 140, -40, { direction: 35, speed: 18, turb: 0.6, rate: 900, abrade: 0.6, deposit: 0.7 });
      const t = g.addNode('thermal', 340, -40, { talus: 0.65, rate: 0.09, samples: 4000 });
      const o = g.addNode('output', 520, -40);
      g.connect(m.id, 0, w.id, 0); g.connect(w.id, 0, e.id, 0); g.connect(e.id, 0, t.id, 0); g.connect(t.id, 0, o.id, 0);
    }
  },
  empty: {
    label: 'Empty', desc: 'Ground plane, build your own',
    build(g) {
      const m = g.addNode('ground', -120, -20);
      const o = g.addNode('output', 120, -20);
      g.connect(m.id, 0, o.id, 0);
    }
  }
};
