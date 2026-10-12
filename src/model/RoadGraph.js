/* ============================================================================
   RoadGraph — the editable road network model.

   Node  : a junction / waypoint in world space (x, elevation, z).
   Edge  : a spline between two nodes, carrying a cross-section (bands) and a
           feature bundle. Edges may also be standalone (roundabouts, loops).

   The model is deliberately separate from any Three.js object so it can be
   rebuilt, diffed, serialised to JSON / glTF and exported to Unreal cleanly.
   ========================================================================== */

import { Curve, dist2, clamp } from '../core/mathx.js';
import { PRESET_BY_ID, cloneBands, KINDS } from './Presets.js';

let _uid = 1;
export const uid = (p = 'e') => `${p}${(_uid++).toString(36)}`;
export const resetUID = (n = 1) => { _uid = n; };

/* --------------------------------------------------------------- Node ---- */

export class RNode {
  constructor(x, y, z, opts = {}) {
    this.id = opts.id || uid('n');
    this.x = x; this.y = y; this.z = z;
    /** Junction tuning. `auto` derives the corner radius from the widest edge. */
    this.junction = {
      radius: opts.radius ?? 0,        // 0 = auto
      type: opts.junctionType ?? 'auto', // auto | priority | signal | roundabout | none
      flatten: opts.flatten ?? true,
      ...(opts.junction || {}),
    };
    this.elevLocked = opts.elevLocked ?? false;
    this.name = opts.name || '';
  }
  get pos() { return { x: this.x, y: this.y, z: this.z }; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; }
  clone() {
    const n = new RNode(this.x, this.y, this.z, { junction: { ...this.junction } });
    n.name = this.name;
    return n;
  }
}

/* --------------------------------------------------------------- Edge ---- */

export class REdge {
  constructor(a, b, opts = {}) {
    this.id = opts.id || uid('e');
    this.a = typeof a === 'object' ? a.id : a;
    this.b = typeof b === 'object' ? b.id : b;
    /** Interior control points [{x,z}] — empty means a straight run. */
    this.pts = (opts.pts || []).map((p) => ({ x: p.x, z: p.z }));
    this.preset = opts.preset || 'local_street';
    this.bands = opts.bands ? opts.bands.map((b) => ({ ...b })) : null; // null = use preset
    this.features = opts.features ? JSON.parse(JSON.stringify(opts.features)) : null;
    this.name = opts.name || '';
    this.speed = opts.speed ?? null;         // km/h, null = preset default
    this.surfaceOverride = opts.surfaceOverride || null;
    this.markStyle = opts.markStyle || 'eu';
    this.bridge = opts.bridge ?? null;       // null=auto {spacing, height}
    this.tunnel = opts.tunnel ?? false;
    this.closed = opts.closed ?? false;      // loop / roundabout
    this.camber = opts.camber ?? 0.025;      // crossfall
    this.bankGain = opts.bankGain ?? 0.0;    // superelevation strength (0..1)
    this.maxBank = opts.maxBank ?? 0.08;     // radians
    this.locked = opts.locked ?? false;
    this.visible = opts.visible ?? true;
    this._curve = null;
    this._len = 0;
  }

  /** Effective bands (preset or override). */
  bandsOf() {
    if (this.bands && this.bands.length) return this.bands;
    const p = PRESET_BY_ID[this.preset];
    return p ? cloneBands(p) : cloneBands(PRESET_BY_ID.local_street);
  }

  featuresOf() {
    if (this.features) return this.features;
    const p = PRESET_BY_ID[this.preset];
    return p ? JSON.parse(JSON.stringify(p.features || {})) : {};
  }

  presetOf() { return PRESET_BY_ID[this.preset] || PRESET_BY_ID.local_street; }

  /** Ordered planar control points including endpoints. */
  controlPoints(net) {
    const A = net.nodes.get(this.a), B = net.nodes.get(this.b);
    const out = [];
    if (A) out.push({ x: A.x, y: A.z });
    for (const p of this.pts) out.push({ x: p.x, y: p.z });
    if (B && !this.closed) out.push({ x: B.x, y: B.z });
    return out;
  }

  curve(net, force = false) {
    if (this._curve && !force) return this._curve;
    const pts = this.controlPoints(net);
    if (pts.length < 2) { this._curve = null; return null; }
    this._curve = new Curve(pts, { closed: this.closed, alpha: 0.5, tension: 1, resample: 96 });
    this._len = this._curve.length;
    return this._curve;
  }

  length(net) { this.curve(net); return this._len; }

  invalidate() { this._curve = null; }

  /** Total cross-section width in metres. */
  width() {
    return this.bandsOf().reduce((s, b) => s + (b.w || 0), 0);
  }

  /** Carriageway (traffic-bearing) width in metres. */
  carriagewayWidth() {
    return this.bandsOf().reduce((s, b) => s + (KINDS[b.k]?.traffic ? (b.w || 0) : 0), 0);
  }

  isRail() {
    const f = this.featuresOf();
    return this.bandsOf().some((b) => b.k === 'rail' || b.k === 'tram') || !!f.railOnly;
  }

  clone(net) {
    const e = new REdge(this.a, this.b, {
      pts: this.pts.map((p) => ({ x: p.x, z: p.z })),
      preset: this.preset,
      bands: this.bands ? this.bands.map((b) => ({ ...b })) : null,
      features: this.features,
      name: this.name, speed: this.speed, bridge: this.bridge, tunnel: this.tunnel,
      closed: this.closed, camber: this.camber, markStyle: this.markStyle,
      bankGain: this.bankGain, maxBank: this.maxBank,
    });
    return e;
  }
}

/* ------------------------------------------------------------ Network ---- */

export class RoadNetwork {
  constructor() {
    this.nodes = new Map();
    this.edges = new Map();
    /** Flat ground height (roads sit on this; the terrain mesh matches it). */
    this.ground = 0;
    this.listeners = new Map();
    this._adj = null;
  }

  /* -- events ---------------------------------------------------------- */
  on(evt, fn) {
    if (!this.listeners.has(evt)) this.listeners.set(evt, new Set());
    this.listeners.get(evt).add(fn);
    return () => this.listeners.get(evt).delete(fn);
  }
  emit(evt, payload) {
    const s = this.listeners.get(evt);
    if (s) for (const fn of s) fn(payload);
  }

  /* -- CRUD ------------------------------------------------------------ */
  addNode(x, y, z, opts) {
    const n = new RNode(x, y, z, opts);
    this.nodes.set(n.id, n);
    this._adj = null;
    this.emit('change', { type: 'node:add', id: n.id });
    return n;
  }

  addEdge(a, b, opts) {
    const e = new REdge(a, b, opts);
    this.edges.set(e.id, e);
    this._adj = null;
    this.emit('change', { type: 'edge:add', id: e.id });
    return e;
  }

  removeNode(id) {
    const n = this.nodes.get(id);
    if (!n) return;
    for (const e of [...this.edges.values()]) {
      if (e.a === id || e.b === id) this.removeEdge(e.id);
    }
    this.nodes.delete(id);
    this._adj = null;
    this.emit('change', { type: 'node:remove', id });
  }

  removeEdge(id) {
    if (!this.edges.delete(id)) return;
    this._adj = null;
    this.emit('change', { type: 'edge:remove', id });
  }

  clear() {
    this.nodes.clear();
    this.edges.clear();
    this._adj = null;
    this.emit('change', { type: 'clear' });
  }

  /* -- topology -------------------------------------------------------- */
  adjacency() {
    if (this._adj) return this._adj;
    const adj = new Map();
    for (const id of this.nodes.keys()) adj.set(id, []);
    for (const e of this.edges.values()) {
      if (!adj.has(e.a)) adj.set(e.a, []);
      if (!adj.has(e.b)) adj.set(e.b, []);
      adj.get(e.a).push(e.id);
      if (!e.closed) adj.get(e.b).push(e.id);
    }
    this._adj = adj;
    return adj;
  }

  edgesAt(nodeId) {
    const adj = this.adjacency();
    return (adj.get(nodeId) || []).map((id) => this.edges.get(id)).filter(Boolean);
  }

  /** Degree of a node (an endpoint of a closed loop counts once). */
  degree(nodeId) { return this.edgesAt(nodeId).length; }

  /**
   * Split an edge at the given planar point, inserting a node.
   * Returns { node, e0, e1 } or null.
   */
  splitEdge(edgeId, x, z, { minSeg = 3 } = {}) {
    const e = this.edges.get(edgeId);
    if (!e) return null;
    const c = e.curve(this);
    if (!c) return null;
    const d = c.nearest(x, z);
    if (d < minSeg || d > c.length - minSeg) return null;

    // Keep interior control points on their original side of the split.
    const left = [], right = [];
    let acc = 0;
    const segLens = [];
    const cpts = e.controlPoints(this);
    for (let i = 0; i < cpts.length - 1; i++) {
      const L = dist2(cpts[i], cpts[i + 1]);
      segLens.push(L);
    }
    // Approximate mapping from arc length to control-point index.
    let total = segLens.reduce((a, b) => a + b, 0) || 1;
    let run = 0;
    const splitFrac = d / c.length;
    for (let i = 0; i < segLens.length; i++) {
      run += segLens[i];
      if (run / total < splitFrac) left.push(cpts[i]);
      else right.push(cpts[i + 1]);
    }

    const p = c.pos(d, { x: 0, y: 0 });
    const node = this.addNode(p.x, this.ground, p.y);

    const e0 = this.addEdge(e.a, node.id, {
      pts: left.slice(1).map((q) => ({ x: q.x, z: q.y })),
      preset: e.preset, bands: e.bands, features: e.features, speed: e.speed,
      bridge: e.bridge, tunnel: e.tunnel, camber: e.camber, markStyle: e.markStyle,
      bankGain: e.bankGain, maxBank: e.maxBank, name: e.name,
    });
    const e1 = this.addEdge(node.id, e.b, {
      pts: right.slice(0, Math.max(0, right.length - 1)).map((q) => ({ x: q.x, z: q.y })),
      preset: e.preset, bands: e.bands, features: e.features, speed: e.speed,
      bridge: e.bridge, tunnel: e.tunnel, camber: e.camber, markStyle: e.markStyle,
      bankGain: e.bankGain, maxBank: e.maxBank, name: e.name,
    });
    this.removeEdge(edgeId);
    return { node, e0, e1 };
  }

  /**
   * Insert (or reuse) a node at a planar position within `tol` of an existing
   * edge, splitting it. Used when drawing roads that cross other roads.
   */
  splitEdgeAtPoint(x, z, tol = 2.0) {
    let best = null;
    for (const e of this.edges.values()) {
      const c = e.curve(this);
      if (!c || c.length < 6) continue;
      const d = c.nearest(x, z);
      const p = c.pos(d, { x: 0, y: 0 });
      const dd = Math.hypot(p.x - x, p.y - z);
      if (dd < tol && (!best || dd < best.dd)) best = { e, d, dd, p };
    }
    if (!best) return null;
    return this.splitEdge(best.e.id, best.p.x, best.p.y);
  }

  /** Merge two nodes (keeps `keepId`), re-pointing all edges. */
  mergeNodes(keepId, dropId) {
    if (keepId === dropId) return;
    const A = this.nodes.get(keepId), B = this.nodes.get(dropId);
    if (!A || !B) return;
    A.x = (A.x + B.x) / 2; A.z = (A.z + B.z) / 2;
    for (const e of this.edges.values()) {
      if (e.a === dropId) e.a = keepId;
      if (e.b === dropId) e.b = keepId;
      e.invalidate();
    }
    this.nodes.delete(dropId);
    this._adj = null;
    this.emit('change', { type: 'node:merge', id: keepId });
  }

  /* -- queries --------------------------------------------------------- */
  /** Nearest node within tol (planar). */
  nodeNear(x, z, tol = 4) {
    let best = null, bd = tol;
    for (const n of this.nodes.values()) {
      const d = Math.hypot(n.x - x, n.z - z);
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  /** Nearest edge within tol (planar), returns {edge, dist, s}. */
  edgeNear(x, z, tol = 3) {
    let best = null, bd = tol;
    for (const e of this.edges.values()) {
      const c = e.curve(this);
      if (!c) continue;
      const s = c.nearest(x, z);
      const p = c.pos(s, { x: 0, y: 0 });
      const d = Math.hypot(p.x - x, p.y - z);
      if (d < bd) { bd = d; best = { edge: e, dist: d, s, point: p }; }
    }
    return best;
  }

  bounds() {
    let mnx = Infinity, mnz = Infinity, mxx = -Infinity, mxz = -Infinity;
    if (!this.nodes.size) return { mnx: -100, mnz: -100, mxx: 100, mxz: 100 };
    for (const n of this.nodes.values()) {
      mnx = Math.min(mnx, n.x); mnz = Math.min(mnz, n.z);
      mxx = Math.max(mxx, n.x); mxz = Math.max(mxz, n.z);
    }
    return { mnx, mnz, mxx, mxz };
  }

  totalLength() {
    let L = 0;
    for (const e of this.edges.values()) L += e.length(this);
    return L;
  }

  stats() {
    const byPreset = new Map();
    let rail = 0, bridge = 0, path = 0;
    for (const e of this.edges.values()) {
      byPreset.set(e.preset, (byPreset.get(e.preset) || 0) + 1);
      const f = e.featuresOf();
      if (e.isRail()) rail++;
      if (e.bridge || f.bridge) bridge++;
      const p = e.presetOf();
      if (p.group === 'Pedestrian') path++;
    }
    return {
      nodes: this.nodes.size,
      edges: this.edges.size,
      km: this.totalLength() / 1000,
      rail, bridge, path, byPreset,
    };
  }

  /* -- serialisation --------------------------------------------------- */
  toJSON() {
    return {
      version: 1,
      ground: this.ground,
      nodes: [...this.nodes.values()].map((n) => ({
        id: n.id, x: n.x, y: n.y, z: n.z, name: n.name, junction: n.junction,
      })),
      edges: [...this.edges.values()].map((e) => ({
        id: e.id, a: e.a, b: e.b, pts: e.pts, preset: e.preset,
        bands: e.bands, features: e.features, name: e.name, speed: e.speed,
        markStyle: e.markStyle, bridge: e.bridge, tunnel: e.tunnel,
        closed: e.closed, camber: e.camber, bankGain: e.bankGain, maxBank: e.maxBank,
      })),
    };
  }

  static fromJSON(data) {
    const net = new RoadNetwork();
    net.ground = data.ground ?? 0;
    for (const n of data.nodes || []) {
      const nn = new RNode(n.x, n.y ?? 0, n.z, { id: n.id, junction: n.junction, name: n.name });
      net.nodes.set(nn.id, nn);
    }
    for (const e of data.edges || []) {
      const ee = new REdge(e.a, e.b, {
        id: e.id, pts: e.pts, preset: e.preset, bands: e.bands, features: e.features,
        name: e.name, speed: e.speed, markStyle: e.markStyle, bridge: e.bridge,
        tunnel: e.tunnel, closed: e.closed, camber: e.camber ?? 0.025,
        bankGain: e.bankGain ?? 0, maxBank: e.maxBank ?? 0.08,
      });
      net.edges.set(ee.id, ee);
    }
    // keep the uid counter ahead of loaded ids
    let max = 1;
    const scan = (s) => { const m = /(\d+)$/.exec(String(s)); if (m) max = Math.max(max, parseInt(m[1], 36)); };
    for (const id of net.nodes.keys()) scan(id);
    for (const id of net.edges.keys()) scan(id);
    resetUID(max + 2);
    return net;
  }
}

export { KINDS };
