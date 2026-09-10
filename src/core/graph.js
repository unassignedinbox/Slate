// Node graph — SLATE's Gaea-style build system.
// Sources/patterns/operators compile to GLSL `scene(p)`; simulation nodes are
// field boundaries: upstream bakes analytically, the sim runs on the volume,
// downstream nodes sample the eroded field through fieldSDF(p).
import { FIELD_GLSL } from './glsl/common.js';

export const CAT = {
  source:  { color: 'var(--cyan)',   label: 'Sources' },
  pattern: { color: 'var(--violet)', label: 'Patterns' },
  operator:{ color: '#e8e8e8',       label: 'Operators' },
  sim:     { color: 'var(--orange)', label: 'Erosion' },
  output:  { color: 'var(--green)',  label: 'Output' },
};

export const DEFS = {
  // ── sources ──
  terrainSlab: {
    cat: 'source', label: 'Terrain Mass', icon: '⛰',
    desc: 'Bounded bedrock mass under a fractal heightfield — the starting landform.',
    inputs: [], output: true,
    params: [
      { k: 'base',    l: 'Base floor', min: -40, max: 10, step: 0.5, def: -30, unit: 'm' },
      { k: 'top',     l: 'Base height', min: -10, max: 34, step: 0.5, def: 8, unit: 'm' },
      { k: 'amp',     l: 'Relief', min: 0, max: 40, step: 0.5, def: 16, unit: 'm' },
      { k: 'freq',    l: 'Feature scale', min: 0.008, max: 0.14, step: 0.002, def: 0.024, unit: '/m' },
      { k: 'oct',     l: 'Octaves', min: 1, max: 8, step: 1, def: 6, unit: '' },
      { k: 'ridged',  l: 'Ridge blend', min: 0, max: 1, step: 0.01, def: 0.35, unit: '' },
      { k: 'seed',    l: 'Seed', min: 0, max: 99, step: 1, def: 7, unit: '' },
    ],
    glsl: (P) => `sdTerrainSlab(p, ${P.base}, ${P.top}, ${P.amp}, ${P.freq}, ${P.oct | 0}, ${P.ridged}, ${P.seed})`,
  },
  sphere: {
    cat: 'source', label: 'Sphere', icon: '●',
    desc: 'Round mass or cavity when subtracted — cave chambers, domes, boulders.',
    inputs: [], output: true,
    params: [
      { k: 'x', l: 'Center X', min: -80, max: 80, step: 0.5, def: 0, unit: 'm' },
      { k: 'y', l: 'Center Y', min: -40, max: 44, step: 0.5, def: 10, unit: 'm' },
      { k: 'z', l: 'Center Z', min: -80, max: 80, step: 0.5, def: 0, unit: 'm' },
      { k: 'r', l: 'Radius', min: 1, max: 60, step: 0.5, def: 12, unit: 'm' },
    ],
    glsl: (P) => `sdSphere(p, vec3(${P.x}, ${P.y}, ${P.z}), ${P.r})`,
  },
  box: {
    cat: 'source', label: 'Box', icon: '▢',
    desc: 'Rounded box mass — mesas, walls, cut blocks.',
    inputs: [], output: true,
    params: [
      { k: 'x', l: 'Center X', min: -80, max: 80, step: 0.5, def: 0, unit: 'm' },
      { k: 'y', l: 'Center Y', min: -40, max: 44, step: 0.5, def: 6, unit: 'm' },
      { k: 'z', l: 'Center Z', min: -80, max: 80, step: 0.5, def: 0, unit: 'm' },
      { k: 'sx', l: 'Size X', min: 1, max: 80, step: 0.5, def: 20, unit: 'm' },
      { k: 'sy', l: 'Size Y', min: 1, max: 44, step: 0.5, def: 10, unit: 'm' },
      { k: 'sz', l: 'Size Z', min: 1, max: 80, step: 0.5, def: 20, unit: 'm' },
      { k: 'rd', l: 'Rounding', min: 0, max: 10, step: 0.1, def: 1.5, unit: 'm' },
    ],
    glsl: (P) => `sdBox(p, vec3(${P.x}, ${P.y}, ${P.z}), vec3(${P.sx}, ${P.sy}, ${P.sz}), ${P.rd})`,
  },
  cylinder: {
    cat: 'source', label: 'Cylinder', icon: '⬤',
    desc: 'Vertical cylinder — shafts, columns, vents.',
    inputs: [], output: true,
    params: [
      { k: 'x', l: 'Center X', min: -80, max: 80, step: 0.5, def: 0, unit: 'm' },
      { k: 'y', l: 'Center Y', min: -40, max: 44, step: 0.5, def: 0, unit: 'm' },
      { k: 'z', l: 'Center Z', min: -80, max: 80, step: 0.5, def: 0, unit: 'm' },
      { k: 'r', l: 'Radius', min: 1, max: 50, step: 0.5, def: 10, unit: 'm' },
      { k: 'h', l: 'Half height', min: 1, max: 44, step: 0.5, def: 16, unit: 'm' },
    ],
    glsl: (P) => `sdCylinder(p, vec3(${P.x}, ${P.y}, ${P.z}), ${P.r}, ${P.h})`,
  },
  cone: {
    cat: 'source', label: 'Cone', icon: '▲',
    desc: 'Tapered cone — peaks, volcanoes, spoil heaps.',
    inputs: [], output: true,
    params: [
      { k: 'x', l: 'Center X', min: -80, max: 80, step: 0.5, def: 0, unit: 'm' },
      { k: 'y', l: 'Base Y', min: -40, max: 44, step: 0.5, def: -6, unit: 'm' },
      { k: 'z', l: 'Center Z', min: -80, max: 80, step: 0.5, def: 0, unit: 'm' },
      { k: 'rb', l: 'Base radius', min: 1, max: 60, step: 0.5, def: 22, unit: 'm' },
      { k: 'rt', l: 'Top radius', min: 0, max: 40, step: 0.5, def: 3, unit: 'm' },
      { k: 'h', l: 'Height', min: 2, max: 60, step: 0.5, def: 26, unit: 'm' },
    ],
    glsl: (P) => `sdCone(p, vec3(${P.x}, ${P.y}, ${P.z}), ${P.rb}, ${P.rt}, ${P.h})`,
  },
  capsule: {
    cat: 'source', label: 'Capsule', icon: '⬮',
    desc: 'Capsule between two points — tunnels, arch roots, ridges.',
    inputs: [], output: true,
    params: [
      { k: 'ax', l: 'A · X', min: -80, max: 80, step: 0.5, def: -18, unit: 'm' },
      { k: 'ay', l: 'A · Y', min: -40, max: 44, step: 0.5, def: 6, unit: 'm' },
      { k: 'az', l: 'A · Z', min: -80, max: 80, step: 0.5, def: 0, unit: 'm' },
      { k: 'bx', l: 'B · X', min: -80, max: 80, step: 0.5, def: 18, unit: 'm' },
      { k: 'by', l: 'B · Y', min: -40, max: 44, step: 0.5, def: 14, unit: 'm' },
      { k: 'bz', l: 'B · Z', min: -80, max: 80, step: 0.5, def: 0, unit: 'm' },
      { k: 'r', l: 'Radius', min: 0.5, max: 30, step: 0.25, def: 5, unit: 'm' },
    ],
    glsl: (P) => `sdCapsule(p, vec3(${P.ax}, ${P.ay}, ${P.az}), vec3(${P.bx}, ${P.by}, ${P.bz}), ${P.r})`,
  },
  torus: {
    cat: 'source', label: 'Torus', icon: '◎',
    desc: 'Ring — craters rims, natural arches when clipped.',
    inputs: [], output: true,
    params: [
      { k: 'x', l: 'Center X', min: -80, max: 80, step: 0.5, def: 0, unit: 'm' },
      { k: 'y', l: 'Center Y', min: -40, max: 44, step: 0.5, def: 10, unit: 'm' },
      { k: 'z', l: 'Center Z', min: -80, max: 80, step: 0.5, def: 0, unit: 'm' },
      { k: 'R', l: 'Major radius', min: 2, max: 50, step: 0.5, def: 16, unit: 'm' },
      { k: 'r', l: 'Thickness', min: 0.5, max: 20, step: 0.25, def: 5, unit: 'm' },
    ],
    glsl: (P) => `sdTorus(p, vec3(${P.x}, ${P.y}, ${P.z}), ${P.R}, ${P.r})`,
  },
  plane: {
    cat: 'source', label: 'Ground Plane', icon: '▭',
    desc: 'Flat ground at a height — basin floors, water beds.',
    inputs: [], output: true,
    params: [
      { k: 'h', l: 'Height', min: -40, max: 40, step: 0.25, def: -8, unit: 'm' },
    ],
    glsl: (P) => `sdPlaneY(p, ${P.h})`,
  },

  // ── patterns ──
  noise: {
    cat: 'pattern', label: 'FBM Noise', icon: '≋',
    desc: 'Additive fractal displacement — organic roughness at any scale.',
    inputs: ['in'], output: true,
    params: [
      { k: 'amp', l: 'Amplitude', min: 0, max: 24, step: 0.25, def: 4, unit: 'm' },
      { k: 'freq', l: 'Frequency', min: 0.01, max: 0.6, step: 0.005, def: 0.09, unit: '/m' },
      { k: 'oct', l: 'Octaves', min: 1, max: 8, step: 1, def: 5, unit: '' },
      { k: 'seed', l: 'Seed', min: 0, max: 99, step: 1, def: 3, unit: '' },
    ],
    glsl: (P, A, mk) => `(${mk(A[0])} + (fbm(p * ${P.freq} + vec3(${P.seed} * 3.1), ${P.oct | 0}) - 0.5) * 2.0 * ${P.amp})`,
  },
  ridged: {
    cat: 'pattern', label: 'Ridged', icon: '⩘',
    desc: 'Sharp ridge noise — mountain crests and rock spines.',
    inputs: ['in'], output: true,
    params: [
      { k: 'amp', l: 'Amplitude', min: 0, max: 24, step: 0.25, def: 5, unit: 'm' },
      { k: 'freq', l: 'Frequency', min: 0.01, max: 0.5, step: 0.005, def: 0.05, unit: '/m' },
      { k: 'oct', l: 'Octaves', min: 1, max: 8, step: 1, def: 5, unit: '' },
      { k: 'seed', l: 'Seed', min: 0, max: 99, step: 1, def: 11, unit: '' },
    ],
    glsl: (P, A, mk) => `(${mk(A[0])} + (ridged(p * ${P.freq} + vec3(${P.seed} * 3.1), ${P.oct | 0}) - 0.5) * 2.0 * ${P.amp})`,
  },
  warp: {
    cat: 'pattern', label: 'Domain Warp', icon: '🌀',
    desc: 'Swirls the domain through noise — flows, folds, realistic irregularity.',
    inputs: ['in'], output: true,
    params: [
      { k: 'str', l: 'Strength', min: 0, max: 30, step: 0.25, def: 6, unit: 'm' },
      { k: 'freq', l: 'Frequency', min: 0.005, max: 0.3, step: 0.005, def: 0.03, unit: '/m' },
      { k: 'seed', l: 'Seed', min: 0, max: 99, step: 1, def: 5, unit: '' },
    ],
    glsl: (P, A) => `${A[0]}(p + (vec3(fbm(p * ${P.freq} + vec3(${P.seed} * 3.1), 4), fbm(p * ${P.freq} + vec3(${P.seed} * 3.1 + 17.0), 4), fbm(p * ${P.freq} + vec3(${P.seed} * 3.1 + 47.0), 4)) - 0.5) * 2.0 * ${P.str})`,
  },
  terrace: {
    cat: 'pattern', label: 'Terrace', icon: '▤',
    desc: 'Quantizes elevation into steps — rice terraces, stratified plateau edges.',
    inputs: ['in'], output: true,
    params: [
      { k: 'step', l: 'Step height', min: 1, max: 16, step: 0.25, def: 4, unit: 'm' },
      { k: 'sharp', l: 'Sharpness', min: 0.05, max: 1, step: 0.05, def: 0.6, unit: '' },
    ],
    glsl: (P, A, mk) => `((p.y - mix(p.y, (floor(p.y / ${P.step}) + 0.5) * ${P.step}, ${P.sharp})) + ${mk(A[0])})`,
  },
  gradient: {
    cat: 'pattern', label: 'Slope', icon: '╱',
    desc: 'Tilts the input along a horizontal direction.',
    inputs: ['in'], output: true,
    params: [
      { k: 'slope', l: 'Grade', min: -1, max: 1, step: 0.01, def: 0.12, unit: '' },
      { k: 'dir', l: 'Direction', min: 0, max: 360, step: 1, def: 0, unit: '°' },
    ],
    glsl: (P, A) => {
      const rad = (P.dir * Math.PI / 180).toFixed(4);
      return (P2, A2, mk) => `` || `(${mk(A[0])} + ${P.slope} * dot(p.xz, vec2(cos(${rad}), sin(${rad}))))`;
    },
  },

  // ── operators ──
  union: {
    cat: 'operator', label: 'Union', icon: '∪', inputs: ['A', 'B'], output: true,
    desc: 'Adds two shapes together.',
    params: [{ k: 'k', l: 'Smooth', min: 0, max: 16, step: 0.1, def: 0, unit: 'm' }],
    glsl: (P, A, mk) => { const a = mk(A[0]), b = mk(A[1]); return P.k > 0.01 ? `opSmoothUnion(${a}, ${b}, ${P.k})` : `opUnion(${a}, ${b})`; },
  },
  subtract: {
    cat: 'operator', label: 'Subtract', icon: '∖', inputs: ['A', 'B'], output: true,
    desc: 'Carves B out of A — caves, arches, canyons.',
    params: [{ k: 'k', l: 'Smooth', min: 0, max: 16, step: 0.1, def: 0, unit: 'm' }],
    glsl: (P, A, mk) => { const a = mk(A[0]), b = mk(A[1]); return P.k > 0.01 ? `opSmoothSubtract(${a}, ${b}, ${P.k})` : `opSubtract(${a}, ${b})`; },
  },
  intersect: {
    cat: 'operator', label: 'Intersect', icon: '∩', inputs: ['A', 'B'], output: true,
    desc: 'Keeps only the shared volume.',
    params: [{ k: 'k', l: 'Smooth', min: 0, max: 16, step: 0.1, def: 0, unit: 'm' }],
    glsl: (P, A, mk) => { const a = mk(A[0]), b = mk(A[1]); return P.k > 0.01 ? `opSmoothIntersect(${a}, ${b}, ${P.k})` : `opIntersect(${a}, ${b})`; },
  },

  // ── simulation (field boundary) ──
  hydraulic: {
    cat: 'sim', label: 'Hydraulic Erosion', icon: '🌧',
    desc: 'Rain agents impact, shear and carry sediment; runoff networks form; load settles as bars.',
    inputs: ['in'], output: true, sim: 'hydraulic',
    params: [
      { k: 'intensity', l: 'Rainfall', min: 0, max: 1, step: 0.01, def: 0.55, unit: '' },
      { k: 'grain', l: 'Drop size', min: 1, max: 8, step: 0.25, def: 3, unit: 'mm' },
      { k: 'impact', l: 'Impact force', min: 0, max: 3, step: 0.05, def: 1, unit: '×' },
      { k: 'evap', l: 'Evaporation', min: 0.005, max: 0.2, step: 0.005, def: 0.035, unit: '/s' },
    ],
    glsl: (P, A, mk) => mk(A[0]),
  },
  river: {
    cat: 'sim', label: 'River', icon: '🗿',
    desc: 'Source-fed flow agents carve a channel downhill, deposit point bars, and paint the flow map the water shader follows.',
    inputs: ['in'], output: true, sim: 'river',
    params: [
      { k: 'srcX', l: 'Source X', min: -70, max: 70, step: 0.5, def: -30, unit: 'm' },
      { k: 'srcZ', l: 'Source Z', min: -70, max: 70, step: 0.5, def: -20, unit: 'm' },
      { k: 'spread', l: 'Source spread', min: 0.5, max: 30, step: 0.5, def: 6, unit: 'm' },
      { k: 'intensity', l: 'Discharge', min: 0, max: 1, step: 0.01, def: 0.4, unit: '' },
      { k: 'speed', l: 'Current', min: 0.2, max: 6, step: 0.1, def: 1.6, unit: 'm/s' },
      { k: 'brush', l: 'Channel brush', min: 0.4, max: 3, step: 0.05, def: 1.1, unit: 'm' },
      { k: 'grain', l: 'Bed load', min: 0.5, max: 12, step: 0.5, def: 5, unit: 'mm' },
    ],
    glsl: (P, A, mk) => mk(A[0]),
  },
  wind: {
    cat: 'sim', label: 'Wind Erosion', icon: '🌬',
    desc: 'Saltating grains ablate windward faces and settle in the lee — yardangs and dune mantles.',
    inputs: ['in'], output: true, sim: 'wind',
    params: [
      { k: 'speed', l: 'Wind speed', min: 0, max: 18, step: 0.25, def: 7, unit: 'm/s' },
      { k: 'dir', l: 'Direction', min: 0, max: 360, step: 1, def: 35, unit: '°' },
      { k: 'height', l: 'Band height', min: 0.5, max: 40, step: 0.5, def: 8, unit: 'm' },
      { k: 'spread', l: 'Band spread', min: 1, max: 40, step: 0.5, def: 12, unit: 'm' },
      { k: 'abrasion', l: 'Abrasion', min: 0, max: 3, step: 0.05, def: 1, unit: '×' },
      { k: 'intensity', l: 'Flux', min: 0, max: 1, step: 0.01, def: 0.45, unit: '' },
    ],
    glsl: (P, A, mk) => mk(A[0]),
  },
  thermal: {
    cat: 'sim', label: 'Thermal Weathering', icon: '⛰',
    desc: 'Talus relaxation — cliffs crumble to their friction angle, screes form at the base.',
    inputs: ['in'], output: true, sim: 'thermal',
    params: [
      { k: 'angle', l: 'Friction angle', min: 20, max: 55, step: 1, def: 38, unit: '°' },
      { k: 'rate', l: 'Rate', min: 0.02, max: 1, step: 0.02, def: 0.35, unit: '' },
    ],
    glsl: (P, A, mk) => mk(A[0]),
  },

  // ── output ──
  output: {
    cat: 'output', label: 'Terrain Out', icon: '⬢',
    desc: 'Final field — rendered, simulated and exported.',
    inputs: ['in'], output: false,
    params: [],
    glsl: (P, A, mk) => mk(A[0]),
  },
};

export function defaultParams(type) {
  const def = DEFS[type];
  const p = {};
  def.params.forEach(pr => { p[pr.k] = pr.def; });
  return p;
}

let nid = 1;
export function makeNode(type, x, y) {
  return { id: nid++, type, x, y, params: defaultParams(type), enabled: true };
}
export function setNodeIdCounter(v) { nid = v; }
export function nextNodeId() { return nid++; }

export class Graph {
  constructor() {
    this.nodes = [];
    this.links = []; // {from, to, toInput}
    this.listeners = [];
  }
  add(node) { this.nodes.push(node); this.emit(); return node; }
  remove(id) {
    this.nodes = this.nodes.filter(n => n.id !== id);
    this.links = this.links.filter(l => l.from !== id && l.to !== id);
    this.emit();
  }
  link(from, to, toInput) {
    this.links = this.links.filter(l => !(l.to === to && l.toInput === toInput));
    this.links.push({ from, to, toInput });
    this.emit();
  }
  unlink(to, toInput) {
    this.links = this.links.filter(l => !(l.to === to && l.toInput === toInput));
    this.emit();
  }
  inputOf(id, name) {
    const l = this.links.find(l => l.to === id && l.toInput === name);
    return l ? this.nodes.find(n => n.id === l.from) : null;
  }
  node(id) { return this.nodes.find(n => n.id === id); }
  outputNode() { return this.nodes.find(n => n.type === 'output'); }
  simNodes() { return this.nodes.filter(n => DEFS[n.type].sim); }
  emit() { this.listeners.forEach(f => f()); }
  onChange(f) { this.listeners.push(f); }

  // topological chain from the output node (depth-first, cycle-safe)
  chain() {
    const out = this.outputNode();
    if (!out) return [];
    const seen = new Set(); const order = [];
    const visit = (n) => {
      if (!n || seen.has(n.id)) return;
      seen.add(n.id);
      DEFS[n.type].inputs.forEach(inp => visit(this.inputOf(n.id, inp)));
      order.push(n);
    };
    visit(out);
    return order;
  }

  // Compile to GLSL functions: { preFns, preEntry, postFns, postEntry, hasSim }
  // Pre  — the full analytic chain, simulation nodes transparent.
  // Post — nodes upstream of any enabled sim collapse to fieldSDF(p);
  //        downstream nodes re-apply analytically (post-erosion CSG works).
  compile() {
    const out = this.outputNode();
    if (!out) return null;
    const order = this.chain();
    const enabledSims = order.filter(n => DEFS[n.type].sim && n.enabled !== false);
    const hasSim = enabledSims.length > 0;

    // ancestors of any enabled sim (their effect is already baked in the field)
    const ancestors = new Set();
    const mark = (n) => {
      if (!n || ancestors.has(n.id)) return;
      ancestors.add(n.id);
      DEFS[n.type].inputs.forEach(inp => mark(this.inputOf(n.id, inp)));
    };
    enabledSims.forEach(s => mark(s));

    const lit = v => (typeof v === 'number' ? (Number.isInteger(v) ? v.toFixed(1) : String(v)) : v);
    const emit = (inField) => {
      const memo = new Set();
      const fns = [];
      const fname = n => `f${n.id}${inField ? 'b' : 'a'}`;
      const buildBody = (n) => {
        const def = DEFS[n.type];
        const inRef = (i) => {
          const c = this.inputOf(n.id, def.inputs[i]);
          return c ? `${fname(c)}(p)` : '1e5';
        };
        if (def.sim) return inField ? 'fieldSDF(p)' : inRef(0);
        if (n.type === 'output') return inRef(0);
        if (n.enabled === false) {
          if (!def.inputs.length) return '1e5';   // disabled source = empty space
          return inRef(0);                        // disabled node = passthrough
        }
        const Pl = new Proxy(n.params, { get: (t, k) => lit(t[k]) });
        const names = def.inputs.map((inp, i) => {
          const c = this.inputOf(n.id, def.inputs[i]);
          return c ? fname(c) : 'EMPTY';
        });
        const mk = name => `${name}(p)`;
        return def.glsl(Pl, names, mk);
      };
      const visit = (n) => {
        if (!n || memo.has(n.id)) return;
        memo.add(n.id);
        DEFS[n.type].inputs.forEach(inp => visit(this.inputOf(n.id, inp)));
        if (n.type !== 'output') {
          fns.push(`float ${fname(n)}(vec3 p){ return ${buildBody(n)}; }`);
        }
      };
      visit(out);
      // in field mode, pre-sim ancestors collapse without recursion
      if (inField) {
        fns.length = 0;
        memo.clear();
        const visitF = (n) => {
          if (!n || memo.has(n.id)) return;
          memo.add(n.id);
          if (ancestors.has(n.id)) {
            if (n.type !== 'output') fns.push(`float ${fname(n)}(vec3 p){ return fieldSDF(p); }`);
            return;
          }
          DEFS[n.type].inputs.forEach(inp => visitF(this.inputOf(n.id, inp)));
          if (n.type !== 'output') {
            fns.push(`float ${fname(n)}(vec3 p){ return ${buildBody(n)}; }`);
          }
        };
        visitF(out);
      }
      return { fns: fns.join('\n'), entry: buildBody(out) };
    };
    const pre = emit(false);
    const post = hasSim ? emit(true) : null;
    return { preFns: pre.fns, preEntry: pre.entry, postFns: post ? post.fns : '', postEntry: post ? post.entry : '', hasSim, order, ancestors };
  }
}
