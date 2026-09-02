// ============================================================================
//  Sketch model — the single source of truth for the whole app.
//  Holds a tree of folders and entities, the active tool, and the selection.
//  Emits 'change' whenever anything mutates so the directory, viewport and
//  tools panel can re-render. Coordinates are on the Ground (XZ) workplane,
//  stored as { x, z } in world units (metres); the viewport lifts them to 3D.
// ============================================================================

let nextId = 1;
const uid = (p) => `${p}${nextId++}`;

export const Sketch = {
  // tree nodes: folders contain children (folders or entities); entities are leaves
  root: [],
  // flat index id -> node, for fast lookup
  index: new Map(),
  selection: new Set(),   // ids
  activeTool: { band: 0, tool: 0, name: 'Line', glyph: 'line' },
  hover: null,            // id being hovered in the viewport

  _listeners: new Set(),
  on(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); },
  emit(reason) { for (const fn of this._listeners) fn(reason); },
};

// ---- tree helpers ----------------------------------------------------------
function register(node) { Sketch.index.set(node.id, node); return node; }

export function makeFolder(name, parent = null) {
  const f = register({ id: uid('folder'), type: 'folder', name, open: true, children: [], parent });
  (parent ? parent.children : Sketch.root).push(f);
  return f;
}

export function addEntity(entity, parent = null) {
  entity.id = uid('ent');
  entity.type = 'entity';
  entity.parent = parent;
  register(entity);
  (parent ? parent.children : Sketch.root).push(entity);
  return entity;
}

export function removeNode(id) {
  const node = Sketch.index.get(id);
  if (!node) return;
  // detach children first (recurse)
  if (node.children) [...node.children].forEach((c) => removeNode(c.id));
  const siblings = node.parent ? node.parent.children : Sketch.root;
  const i = siblings.indexOf(node);
  if (i >= 0) siblings.splice(i, 1);
  Sketch.index.delete(id);
  Sketch.selection.delete(id);
}

export function moveNode(id, newParent) {
  const node = Sketch.index.get(id);
  if (!node || node === newParent) return;
  // guard: don't move a folder into its own descendant
  let p = newParent;
  while (p) { if (p === node) return; p = p.parent; }
  const siblings = node.parent ? node.parent.children : Sketch.root;
  const i = siblings.indexOf(node);
  if (i >= 0) siblings.splice(i, 1);
  node.parent = newParent;
  (newParent ? newParent.children : Sketch.root).push(node);
}

// walk all entity leaves
export function eachEntity(fn) {
  const rec = (list) => list.forEach((n) => {
    if (n.type === 'folder') rec(n.children);
    else fn(n);
  });
  rec(Sketch.root);
}

// ---- selection -------------------------------------------------------------
export function setSelection(ids, additive = false) {
  if (!additive) Sketch.selection.clear();
  for (const id of ids) {
    if (additive && Sketch.selection.has(id)) Sketch.selection.delete(id);
    else Sketch.selection.add(id);
  }
  Sketch.emit('selection');
}
export function clearSelection() { Sketch.selection.clear(); Sketch.emit('selection'); }

// ---- geometry helpers ------------------------------------------------------
export function dist(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }

// a nice human label for a freshly created entity
export function labelFor(kind, geom) {
  const n = ({ round: (v) => Math.round(v * 100) / 100 });
  switch (kind) {
    case 'line': return `Line · ${n.round(dist(geom.a, geom.b))} m`;
    case 'rectangle': return `Rectangle · ${n.round(Math.abs(geom.b.x - geom.a.x))}×${n.round(Math.abs(geom.b.z - geom.a.z))}`;
    case 'circle': return `Circle · r ${n.round(geom.r)} m`;
    case 'polygon': return `Polygon · ${geom.sides} sides`;
    case 'polyline': return `Polyline · ${geom.pts.length} pts`;
    case 'point': return `Point`;
    case 'arc': return `Arc`;
    case 'ellipse': return `Ellipse`;
    default: return kind.charAt(0).toUpperCase() + kind.slice(1);
  }
}

// seed a couple of folders so the tree reads like a real document
export function seed() {
  const geom = makeFolder('Geometry');
  makeFolder('Construction');
  Sketch.emit('seed');
  return geom;
}
