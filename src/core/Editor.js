/* ============================================================================
   Editor — application state: selection, tools, drawing, undo, rebuilds.

   The editor owns the network and the world builder. UI panels observe it and
   call into it; nothing in the UI touches Three.js directly except the
   viewport overlay helpers it is handed.
   ========================================================================== */

import * as THREE from 'three';
import { RoadNetwork } from '../model/RoadGraph.js';
import { PRESET_BY_ID } from '../model/Presets.js';
import { WorldBuilder } from './WorldBuilder.js';
import { Terrain } from './Terrain.js';
import { buildPropGeometries } from '../gen/Props.js';
import { generateCity } from '../gen/CityGenerator.js';
import { clamp } from './mathx.js';

export const TOOLS = {
  select: { id: 'select', label: 'Select', hint: 'Click a road to select · drag a node to move it' },
  draw: { id: 'draw', label: 'Draw Road', hint: 'Click to place nodes · Enter or double-click to finish · Esc to cancel' },
  node: { id: 'node', label: 'Add Node', hint: 'Click a road to insert a junction node' },
  paint: { id: 'paint', label: 'Apply Preset', hint: 'Click a road to apply the active preset' },
};

export class Editor {
  constructor({ scene, renderer, camera, materials }) {
    this.scene = scene;
    this.renderer = renderer;
    this.camera = camera;
    this.materials = materials;

    this.net = new RoadNetwork();
    this.terrain = new Terrain({ enabled: false, amplitude: 0 });
    this.propGeos = buildPropGeometries();
    this.world = new WorldBuilder({ scene, net: this.net, materials, propGeos: this.propGeos, terrain: this.terrain });

    this.tool = 'select';
    this.activePreset = 'local_street';
    this.selection = { edges: new Set(), nodes: new Set() };
    this.hover = null;
    this.drawChain = [];
    this.snapping = { grid: true, gridSize: 8, nodes: true, edges: true };
    this.showGrid = true;
    this.showHelpers = true;

    this.listeners = new Map();
    this.history = [];
    this.historyIndex = -1;
    this._suspendHistory = false;

    this.helpers = new THREE.Group();
    this.helpers.name = 'editorHelpers';
    scene.add(this.helpers);

    this._dirtyTiles = new Set();
    this._fullRebuild = false;
    this.lastGenStats = null;

    this.grid = this._makeGrid();
    scene.add(this.grid);

    this.net.on('change', () => { this._index = null; this.emit('network'); });
  }

  /* -------------------------------------------------------- spatial index -- */
  /**
   * Uniform-grid index over curve samples. Without it, picking walks every
   * edge in the city on every mouse move — fine at 200 segments, not at 4000.
   */
  ensureIndex() {
    if (this._index) return this._index;
    const cell = 40;
    const edges = new Map();
    const push = (map, k, id) => {
      let a = map.get(k);
      if (!a) { a = []; map.set(k, a); }
      if (a[a.length - 1] !== id) a.push(id);
    };
    for (const e of this.net.edges.values()) {
      const c = e.curve(this.net);
      if (!c || c.length < 0.5) continue;
      const n = Math.max(2, Math.ceil(c.length / cell));
      for (let i = 0; i <= n; i++) {
        const p = c.pos((c.length * i) / n, { x: 0, y: 0 });
        push(edges, `${Math.floor(p.x / cell)},${Math.floor(p.y / cell)}`, e.id);
      }
    }
    const nodes = new Map();
    for (const n of this.net.nodes.values()) {
      push(nodes, `${Math.floor(n.x / cell)},${Math.floor(n.z / cell)}`, n.id);
    }
    this._index = { cell, edges, nodes };
    return this._index;
  }

  /** Nearest node within tol, using the grid index. */
  nodeNear(x, z, tol) {
    const idx = this.ensureIndex();
    const c = idx.cell;
    const r = Math.max(1, Math.ceil(tol / c));
    const ci = Math.floor(x / c), cj = Math.floor(z / c);
    let best = null, bd = tol * tol;
    const seen = new Set();
    for (let i = ci - r; i <= ci + r; i++) {
      for (let j = cj - r; j <= cj + r; j++) {
        const arr = idx.nodes.get(`${i},${j}`);
        if (!arr) continue;
        for (const id of arr) {
          if (seen.has(id)) continue;
          seen.add(id);
          const n = this.net.nodes.get(id);
          if (!n) continue;
          const d = (n.x - x) ** 2 + (n.z - z) ** 2;
          if (d < bd) { bd = d; best = n; }
        }
      }
    }
    return best;
  }

  /** Nearest edge within tol, using the grid index. */
  edgeNear(x, z, tol) {
    const idx = this.ensureIndex();
    const c = idx.cell;
    const r = Math.max(1, Math.ceil((tol + c) / c));
    const ci = Math.floor(x / c), cj = Math.floor(z / c);
    let best = null, bd = tol * tol;
    const seen = new Set();
    for (let i = ci - r; i <= ci + r; i++) {
      for (let j = cj - r; j <= cj + r; j++) {
        const arr = idx.edges.get(`${i},${j}`);
        if (!arr) continue;
        for (const id of arr) {
          if (seen.has(id)) continue;
          seen.add(id);
          const e = this.net.edges.get(id);
          if (!e) continue;
          const cv = e.curve(this.net);
          if (!cv) continue;
          const s = cv.nearest(x, z);
          const p = cv.pos(s, { x: 0, y: 0 });
          const d = (p.x - x) ** 2 + (p.y - z) ** 2;
          if (d < bd) { bd = d; best = { edge: e, dist: Math.sqrt(d), s, point: p }; }
        }
      }
    }
    return best;
  }

  /* ------------------------------------------------------------ events --- */
  on(evt, fn) {
    if (!this.listeners.has(evt)) this.listeners.set(evt, new Set());
    this.listeners.get(evt).add(fn);
    return () => this.listeners.get(evt).delete(fn);
  }
  emit(evt, payload) {
    const s = this.listeners.get(evt);
    if (s) for (const fn of [...s]) fn(payload);
  }

  /* ------------------------------------------------------------- state --- */
  setTool(t) {
    if (this.tool === t) return;
    this.tool = t;
    this.drawChain = [];
    this.emit('tool', t);
    this.emit('draw');
  }

  setPreset(id) {
    if (!PRESET_BY_ID[id]) return;
    this.activePreset = id;
    this.emit('preset', id);
  }

  select(ids = [], additive = false) {
    if (!additive) { this.selection.edges.clear(); this.selection.nodes.clear(); }
    for (const id of ids) {
      if (this.net.edges.has(id)) this.selection.edges.add(id);
      else if (this.net.nodes.has(id)) this.selection.nodes.add(id);
    }
    this.emit('selection');
  }

  selectAll() {
    this.selection.edges.clear();
    this.selection.nodes.clear();
    for (const id of this.net.edges.keys()) this.selection.edges.add(id);
    this.emit('selection');
  }

  clearSelection() { this.select([]); }

  deleteSelection() {
    if (!this.selection.edges.size && !this.selection.nodes.size) return;
    this.pushHistory();
    for (const id of [...this.selection.edges]) this.net.removeEdge(id);
    for (const id of [...this.selection.nodes]) this.net.removeNode(id);
    this.selection.edges.clear();
    this.selection.nodes.clear();
    this.markAllDirty();
    this.emit('selection');
  }

  get primaryEdge() {
    const id = [...this.selection.edges][0];
    return id ? this.net.edges.get(id) : null;
  }
  get primaryNode() {
    const id = [...this.selection.nodes][0];
    return id ? this.net.nodes.get(id) : null;
  }

  /* ------------------------------------------------------------ picking -- */

  /** Ray -> terrain-aware ground point. Iterates because the ground is not flat. */
  groundPoint(raycaster) {
    const ray = raycaster.ray;
    let y = 0;
    let p = null;
    for (let i = 0; i < 5; i++) {
      const t = (y - ray.origin.y) / (ray.direction.y || -1e-9);
      if (t < 0 || !isFinite(t)) return null;
      const pt = ray.origin.clone().addScaledVector(ray.direction, t);
      const gy = this.terrain.height(pt.x, pt.z);
      if (Math.abs(gy - y) < 0.01) { p = pt; break; }
      y = gy; p = pt;
    }
    return p;
  }

  /**
   * Pick the nearest node / edge under the cursor.
   * Tolerance scales with camera distance so distant roads stay clickable.
   */
  pick(raycaster, camera) {
    const p = this.groundPoint(raycaster);
    if (!p) return null;
    const dist = camera.position.distanceTo(p);
    const tol = clamp(dist * 0.012, 1.2, 18);

    const n = this.nodeNear(p.x, p.z, tol * 0.9);
    if (n) return { type: 'node', id: n.id, point: p, node: n };
    const e = this.edgeNear(p.x, p.z, tol);
    if (e) return { type: 'edge', id: e.edge.id, point: p, edge: e.edge, s: e.s };
    return { type: 'ground', point: p };
  }

  snapPoint(p, exclude = []) {
    let out = { x: p.x, z: p.z, snapped: null };
    if (this.snapping.nodes) {
      const n = this.net.nodeNear(p.x, p.z, 6);
      if (n && !exclude.includes(n.id)) return { x: n.x, z: n.z, snapped: { type: 'node', id: n.id } };
    }
    if (this.snapping.edges) {
      const e = this.net.edgeNear(p.x, p.z, 3.0);
      if (e && !exclude.includes(e.edge.id)) {
        return { x: e.point.x, z: e.point.y, snapped: { type: 'edge', id: e.edge.id } };
      }
    }
    if (this.snapping.grid) {
      const g = this.snapping.gridSize;
      out.x = Math.round(out.x / g) * g;
      out.z = Math.round(out.z / g) * g;
    }
    return out;
  }

  /* ----------------------------------------------------------- drawing -- */

  /**
   * Handle a viewport click for the current tool.
   * @returns {boolean} true if the event was consumed
   */
  handleClick(raycaster, camera, { additive = false, alt = false } = {}) {
    const hit = this.pick(raycaster, camera);
    if (!hit) return false;

    switch (this.tool) {
      case 'select': {
        if (hit.type === 'node' || hit.type === 'edge') {
          this.select([hit.id], additive);
          return true;
        }
        if (!additive) this.clearSelection();
        return false;
      }
      case 'draw': {
        if (hit.type === 'ground' || hit.type === 'edge' || hit.type === 'node') {
          const sp = this.snapPoint(hit.point, []);
          this.addDrawPoint(sp.x, sp.z, hit);
          return true;
        }
        return false;
      }
      case 'node': {
        if (hit.type === 'edge') {
          this.pushHistory();
          const r = this.net.splitEdge(hit.id, hit.point.x, hit.point.z);
          if (r) {
            this.markDirty([r.e0.id, r.e1.id]);
            this.select([r.node.id]);
          }
          return true;
        }
        return false;
      }
      case 'paint': {
        if (hit.type === 'edge') {
          this.pushHistory();
          const e = this.net.edges.get(hit.id);
          e.preset = this.activePreset;
          e.bands = null;
          e.features = null;
          this.markDirty([e.id]);
          this.select([e.id], additive);
          this.emit('inspector');
          return true;
        }
        return false;
      }
      default: return false;
    }
  }

  addDrawPoint(x, z, hit) {
    const y = this.terrain.height(x, z);
    let nodeId = null;

    if (hit?.type === 'node') {
      nodeId = hit.id;
    } else if (hit?.type === 'edge' && this.snapping.edges) {
      const r = this.net.splitEdgeAtPoint(x, z, 2.5);
      if (r) nodeId = r.node.id;
    }
    if (nodeId === null) {
      const existing = this.nodeNear(x, z, 1.2);
      if (existing) nodeId = existing.id;
      else {
        if (this.drawChain.length === 0) this.pushHistory();
        const n = this.net.addNode(x, y, z);
        nodeId = n.id;
      }
    }

    if (this.drawChain.length) {
      const prev = this.drawChain[this.drawChain.length - 1];
      if (prev === nodeId) return;
      const e = this.net.addEdge(prev, nodeId, { preset: this.activePreset });
      this.markDirty([e.id]);
      this.select([e.id]);
    }
    this.drawChain.push(nodeId);
    this.emit('draw');
  }

  /** Finish the current chain. `close` joins the last node back to the first. */
  finishDraw(close = false) {
    if (close && this.drawChain.length > 2) {
      const a = this.drawChain[this.drawChain.length - 1], b = this.drawChain[0];
      const e = this.net.addEdge(a, b, { preset: this.activePreset });
      this.markDirty([e.id]);
    }
    if (this.drawChain.length) this.pushHistory();
    this.drawChain = [];
    this.emit('draw');
  }

  cancelDraw() {
    this.drawChain = [];
    this.emit('draw');
  }

  /* ---------------------------------------------------------- movement -- */

  /** Move a node, keeping its vertical position on the terrain. */
  moveNode(id, x, z, { keepY = null } = {}) {
    const n = this.net.nodes.get(id);
    if (!n) return;
    n.x = x; n.z = z;
    if (keepY !== null) n.y = keepY; else if (!n.elevLocked) n.y = this.terrain.height(x, z);
    for (const e of this.net.edgesAt(id)) { e.invalidate(); this.markDirty([e.id]); }
    this.emit('inspector');
  }

  /* ------------------------------------------------------------ edits --- */

  /** Apply a mutated band list to the selected edges. */
  applyBands(bands) {
    const ids = [...this.selection.edges];
    if (!ids.length) return;
    this.pushHistory();
    for (const id of ids) {
      const e = this.net.edges.get(id);
      if (!e) continue;
      e.bands = bands.map((b) => ({ ...b }));
      e.invalidate();
      this.markDirty([id]);
    }
    this.emit('inspector');
    this.emit('network');
  }

  applyFeatures(features) {
    const ids = [...this.selection.edges];
    if (!ids.length) return;
    this.pushHistory();
    for (const id of ids) {
      const e = this.net.edges.get(id);
      if (!e) continue;
      e.features = JSON.parse(JSON.stringify(features));
      this.markDirty([id]);
    }
    this.emit('inspector');
  }

  resetSelectionToPreset() {
    const ids = [...this.selection.edges];
    if (!ids.length) return;
    this.pushHistory();
    for (const id of ids) {
      const e = this.net.edges.get(id);
      if (!e) continue;
      e.bands = null; e.features = null;
      this.markDirty([id]);
    }
    this.emit('inspector');
  }

  /* ---------------------------------------------------------- undo/redo -- */

  pushHistory(label = '') {
    if (this._suspendHistory) return;
    const snap = { label, json: this.net.toJSON() };
    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push(snap);
    if (this.history.length > 30) this.history.shift();
    this.historyIndex = this.history.length - 1;
    this.emit('history');
  }

  undo() {
    if (this.historyIndex <= 0) return;
    this.historyIndex--;
    this._restore(this.history[this.historyIndex].json);
  }

  redo() {
    if (this.historyIndex >= this.history.length - 1) return;
    this.historyIndex++;
    this._restore(this.history[this.historyIndex].json);
  }

  _restore(json) {
    this._suspendHistory = true;
    const sel = { edges: [...this.selection.edges], nodes: [...this.selection.nodes] };
    const restored = RoadNetwork.fromJSON(json);
    this.net.nodes = restored.nodes;
    this.net.edges = restored.edges;
    this.net.ground = restored.ground;
    this.net._adj = null;
    for (const e of this.net.edges.values()) e.invalidate();
    this._suspendHistory = false;
    this.markAllDirty();
    this.select([...sel.edges, ...sel.nodes].filter((id) => this.net.edges.has(id) || this.net.nodes.has(id)));
    this.emit('history');
    this.emit('network');
  }

  get canUndo() { return this.historyIndex > 0; }
  get canRedo() { return this.historyIndex < this.history.length - 1; }

  /* -------------------------------------------------------- generation -- */

  generate(opts) {
    this.clearSelection();
    const stats = generateCity(this.net, opts);
    if (opts.terrain !== undefined) {
      this.terrain.set({ enabled: opts.terrain > 0, amplitude: opts.terrain });
    }
    this.terrain.apply(this.net);
    this.rebuildGround();
    this.lastGenStats = { ...stats, opts };
    this.pushHistory('generate');
    this.markAllDirty();
    this.emit('network');
    this.emit('generated', stats);
    return stats;
  }

  setTerrain(amplitude, scale = 420) {
    this.terrain.set({ enabled: amplitude > 0, amplitude, scale });
    this.terrain.apply(this.net);
    this.rebuildGround();
    this.markAllDirty();
    this.emit('network');
  }

  rebuildGround() {
    if (this.groundMesh) {
      this.scene.remove(this.groundMesh);
      this.groundMesh.geometry.dispose();
    }
    const g = this.terrain.buildMesh(16000, 200);
    const m = new THREE.Mesh(g, this.materials.get('ground'));
    m.name = 'ground';
    m.frustumCulled = false;
    m.renderOrder = -1;
    this.groundMesh = m;
    this.scene.add(m);
  }

  /* ---------------------------------------------------------- rebuilds -- */

  markDirty(edgeIds) {
    for (const id of edgeIds) {
      const e = this.net.edges.get(id);
      if (!e) continue;
      const A = this.net.nodes.get(e.a), B = this.net.nodes.get(e.b);
      const mx = ((A?.x ?? 0) + (B?.x ?? 0)) / 2;
      const mz = ((A?.z ?? 0) + (B?.z ?? 0)) / 2;
      const i = Math.floor(mx / this.world.tileSize), j = Math.floor(mz / this.world.tileSize);
      this._dirtyTiles.add(`${i},${j}`);
      // junction nodes move too
      for (const nid of [e.a, e.b]) {
        const n = this.net.nodes.get(nid);
        if (!n) continue;
        this._dirtyTiles.add(`${Math.floor(n.x / this.world.tileSize)},${Math.floor(n.z / this.world.tileSize)}`);
      }
    }
  }

  markAllDirty() { this._fullRebuild = true; }

  /** Called every frame: flush rebuild jobs. */
  update(dt, cameraPos) {
    if (this._fullRebuild) {
      this._fullRebuild = false;
      this._dirtyTiles.clear();
      this.world.rebuild();
    } else if (this._dirtyTiles.size) {
      const keys = [...this._dirtyTiles];
      this._dirtyTiles.clear();
      for (const k of keys) {
        const t = this.world.tiles.get(k);
        if (t) {
          this.world._disposeTile(t);
          this.world._buildTile(t, this.world._desiredDetail(t, cameraPos));
        }
      }
      this.world._recount();
    }
    const busy = this.world.update(dt, cameraPos, 9);
    return busy;
  }

  /* ---------------------------------------------------------- overlays -- */

  _makeGrid() {
    const g = new THREE.Group();
    const size = 16000, div = 320;
    const grid = new THREE.GridHelper(size, div, 0x2a3340, 0x1a2029);
    grid.material.transparent = true;
    grid.material.opacity = 0.5;
    grid.material.depthWrite = false;
    g.add(grid);
    const grid2 = new THREE.GridHelper(size, div / 10, 0x3d4a5c, 0x3d4a5c);
    grid2.material.transparent = true;
    grid2.material.opacity = 0.6;
    grid2.material.depthWrite = false;
    g.add(grid2);
    g.position.y = 0.02;
    g.name = 'grid';
    return g;
  }

  /** Rebuild selection / hover / draw overlays. */
  refreshHelpers() {
    const g = this.helpers;
    while (g.children.length) {
      const c = g.children.pop();
      c.geometry?.dispose?.();
    }
    if (!this.showHelpers) return;

    const mkLine = (pts, color, width = 1, dashed = false) => {
      if (pts.length < 2) return null;
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const mat = dashed
        ? new THREE.LineDashedMaterial({ color, dashSize: 4, gapSize: 3, transparent: true, opacity: 0.9, depthTest: false })
        : new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95, depthTest: false });
      const l = new THREE.Line(geo, mat);
      if (dashed) l.computeLineDistances();
      l.renderOrder = 10;
      return l;
    };

    // hover
    if (this.hover && this.hover.type === 'edge' && !this.selection.edges.has(this.hover.id)) {
      const e = this.net.edges.get(this.hover.id);
      const c = e?.curve(this.net);
      if (c) {
        const pts = [];
        for (let i = 0; i <= 60; i++) {
          const p = c.pos((c.length * i) / 60, { x: 0, y: 0 });
          pts.push(new THREE.Vector3(p.x, this.terrain.height(p.x, p.y) + 0.35, p.y));
        }
        const l = mkLine(pts, 0xffb340);
        if (l) g.add(l);
      }
    }

    // selection
    for (const id of this.selection.edges) {
      const e = this.net.edges.get(id);
      const c = e?.curve(this.net);
      if (!c) continue;
      const pts = [];
      const n = Math.max(8, Math.min(200, Math.ceil(c.length / 3)));
      for (let i = 0; i <= n; i++) {
        const p = c.pos((c.length * i) / n, { x: 0, y: 0 });
        pts.push(new THREE.Vector3(p.x, this.terrain.height(p.x, p.y) + 0.45, p.y));
      }
      const l = mkLine(pts, 0x35c8ff, 2);
      if (l) g.add(l);

      // control points
      for (const [nid, isEnd] of [[e.a, true], [e.b, true]]) {
        const n = this.net.nodes.get(nid);
        if (!n) continue;
        const s = new THREE.Mesh(new THREE.OctahedronGeometry(1.6), this.materials.get('helper:node'));
        s.position.set(n.x, n.y + 1.0, n.z);
        s.renderOrder = 12;
        g.add(s);
      }
      for (const p of e.pts) {
        const s = new THREE.Mesh(new THREE.OctahedronGeometry(1.1), this.materials.get('helper:node'));
        s.position.set(p.x, this.terrain.height(p.x, p.z) + 1.0, p.z);
        s.renderOrder = 12;
        g.add(s);
      }
    }

    // selected nodes
    for (const id of this.selection.nodes) {
      const n = this.net.nodes.get(id);
      if (!n) continue;
      const s = new THREE.Mesh(new THREE.OctahedronGeometry(2.2), this.materials.get('helper:nodeSel'));
      s.position.set(n.x, n.y + 1.4, n.z);
      s.renderOrder = 12;
      g.add(s);
    }

    // draw chain
    if (this.drawChain.length) {
      const pts = this.drawChain.map((id) => {
        const n = this.net.nodes.get(id);
        return new THREE.Vector3(n.x, n.y + 0.8, n.z);
      });
      const l = mkLine(pts, 0x7ddc6a, 1, true);
      if (l) g.add(l);
      for (const p of pts) {
        const s = new THREE.Mesh(new THREE.OctahedronGeometry(1.4), this.materials.get('helper:nodeSel'));
        s.position.copy(p);
        s.renderOrder = 12;
        g.add(s);
      }
    }
  }

  dispose() {
    this.world.dispose();
    this.scene.remove(this.grid);
  }
}
