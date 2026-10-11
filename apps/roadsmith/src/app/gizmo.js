// Intersection picking + the translate gizmo, and the editor overlay vertex stream.
// The gizmo moves a whole junction: the node, its kerb returns and every road that meets it.

import { raySphere, rayPlaneY, raySegmentDistance, clamp } from '../core/math.js';

const COL = {
  road: [0.42, 0.47, 0.55, 0.55],
  roadSel: [0.30, 0.66, 1.0, 0.95],
  node: [0.72, 0.78, 0.88, 0.8],
  nodeHover: [0.98, 0.82, 0.35, 1.0],
  nodeSel: [0.30, 0.66, 1.0, 1.0],
  lane: [0.25, 0.85, 0.55, 0.5],
  laneLink: [0.95, 0.65, 0.25, 0.45],
  x: [0.95, 0.31, 0.36, 1],
  z: [0.32, 0.56, 0.98, 1],
  xy: [0.98, 0.78, 0.30, 1],
  ring: [0.85, 0.88, 0.95, 0.75],
};

export class OverlayBuffer {
  constructor(capacity = 1 << 16) {
    this.lines = new Float32Array(capacity * 7);
    this.tris = new Float32Array(capacity * 7);
    this.lineCount = 0;
    this.triCount = 0;
  }
  reset() { this.lineCount = 0; this.triCount = 0; }
  _push(arr, n, p, c) {
    const o = n * 7;
    if (o + 7 > arr.length) return n;
    arr[o] = p.x; arr[o + 1] = p.y; arr[o + 2] = p.z;
    arr[o + 3] = c[0]; arr[o + 4] = c[1]; arr[o + 5] = c[2]; arr[o + 6] = c[3];
    return n + 1;
  }
  line(a, b, c) {
    this.lineCount = this._push(this.lines, this.lineCount, a, c);
    this.lineCount = this._push(this.lines, this.lineCount, b, c);
  }
  tri(a, b, c, col) {
    this.triCount = this._push(this.tris, this.triCount, a, col);
    this.triCount = this._push(this.tris, this.triCount, b, col);
    this.triCount = this._push(this.tris, this.triCount, c, col);
  }
  quad(a, b, c, d, col) { this.tri(a, b, c, col); this.tri(a, c, d, col); }
  polyline(pts, col, close = false) {
    for (let i = 0; i < pts.length - 1; i++) this.line(pts[i], pts[i + 1], col);
    if (close && pts.length > 2) this.line(pts[pts.length - 1], pts[0], col);
  }
  circle(centre, r, col, segments = 48, y = null) {
    let prev = null;
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      const p = { x: centre.x + Math.cos(a) * r, y: y ?? centre.y, z: centre.z + Math.sin(a) * r };
      if (prev) this.line(prev, p, col);
      prev = p;
    }
  }
  disc(centre, r, col, segments = 32) {
    let prev = { x: centre.x + r, y: centre.y, z: centre.z };
    for (let i = 1; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      const p = { x: centre.x + Math.cos(a) * r, y: centre.y, z: centre.z + Math.sin(a) * r };
      this.tri(centre, prev, p, col);
      prev = p;
    }
  }
}

/** World-space pick against junction handles, then roads. */
export function pickScene(scene, ray, { handleScale = 1 } = {}) {
  if (!scene) return null;
  let best = null;
  for (const node of scene.net.nodes.values()) {
    const info = scene.surface.junctions.get(node.id);
    const r = Math.max(2.4, (info?.radius ?? 6) * 0.34) * handleScale;
    const hit = raySphere(ray, { x: node.p.x, y: node.p.y + 0.6, z: node.p.z }, r + 1.2);
    if (hit !== null && (!best || hit < best.t)) {
      best = { t: hit, type: 'junction', id: node.id, node };
    }
  }
  if (best) return best;
  // road pick: closest curve sample within a tolerance that scales with distance
  for (const edge of scene.net.edges.values()) {
    const c = edge.curve;
    if (!c) continue;
    const step = Math.max(4, c.length / 48);
    let prev = c.pointAt(0);
    for (let s = step; s <= c.length; s += step) {
      const p = c.pointAt(Math.min(s, c.length));
      const d = raySegmentDistance(ray, prev, p);
      if (d && d.dist < Math.max(2.2, d.s * 0.012) && (!best || d.s < best.t)) {
        best = { t: d.s, type: 'road', id: edge.id, edge, s };
      }
      prev = p;
    }
  }
  return best;
}

/** Axis handles of the translate gizmo in world space. */
export function gizmoAxes(centre, scale) {
  return [
    { id: 'x', dir: { x: 1, y: 0, z: 0 }, colour: COL.x, length: 9 * scale },
    { id: 'z', dir: { x: 0, y: 0, z: 1 }, colour: COL.z, length: 9 * scale },
  ];
}

export function gizmoScale(camera, centre) {
  const d = Math.hypot(camera.position.x - centre.x, camera.position.y - centre.y, camera.position.z - centre.z);
  return clamp(d / 110, 0.35, 3.4);
}

/** Which part of the gizmo does this ray hit: 'x' | 'z' | 'plane' | null */
export function pickGizmo(camera, centre, ray) {
  const scale = gizmoScale(camera, centre);
  const c = { x: centre.x, y: centre.y + 0.35, z: centre.z };
  const planeR = 3.1 * scale;
  const plane = rayPlaneY(ray, c.y);
  const hitPlane = plane ? plane.point : null;
  if (hitPlane) {
    const dx = hitPlane.x - c.x, dz = hitPlane.z - c.z;
    const r = Math.hypot(dx, dz);
    if (r < planeR) return { part: 'plane', scale, hit: hitPlane };
  }
  for (const a of gizmoAxes(c, scale)) {
    const tip = { x: c.x + a.dir.x * a.length, y: c.y, z: c.z + a.dir.z * a.length };
    const d = raySegmentDistance(ray, c, tip);
    if (d && d.dist < 1.0 * scale) return { part: a.id, scale, hit: hitPlane };
  }
  if (hitPlane) {
    const r = Math.hypot(hitPlane.x - c.x, hitPlane.z - c.z);
    if (r < 11 * scale) return { part: 'plane', scale, hit: hitPlane };
  }
  return null;
}

export function drawGizmo(ov, camera, centre, active) {
  const scale = gizmoScale(camera, centre);
  const y = centre.y + 0.35;
  const c = { x: centre.x, y, z: centre.z };
  // ground disc
  ov.disc({ x: c.x, y: y + 0.02, z: c.z }, 2.5 * scale, [0.25, 0.55, 0.95, active === 'plane' ? 0.35 : 0.14]);
  ov.circle(c, 2.5 * scale, [0.45, 0.72, 1.0, 0.7], 36);
  for (const a of gizmoAxes(c, scale)) {
    const col = active === a.id ? [1, 0.93, 0.5, 1] : a.colour;
    const tip = { x: c.x + a.dir.x * a.length, y, z: c.z + a.dir.z * a.length };
    ov.line(c, tip, col);
    // arrow head as two thin triangles
    const perp = { x: -a.dir.z, y: 0, z: a.dir.x };
    const base = { x: tip.x - a.dir.x * 1.6 * scale, y, z: tip.z - a.dir.z * 1.6 * scale };
    const w = 0.55 * scale;
    ov.tri(tip,
      { x: base.x + perp.x * w, y, z: base.z + perp.z * w },
      { x: base.x - perp.x * w, y, z: base.z - perp.z * w }, col);
    ov.tri(tip,
      { x: base.x, y: y + w, z: base.z },
      { x: base.x, y: y - w, z: base.z }, col);
  }
}

/** Network graph, control handles, lane graph and selection rings. */
export function buildOverlay(ov, scene, { camera, view, selection, hover, dragging }) {
  ov.reset();
  if (!scene) return ov;
  const net = scene.net;

  if (view.network) {
    for (const edge of net.edges.values()) {
      const sel = selection?.type === 'road' && selection.id === edge.id;
      const col = sel ? COL.roadSel : COL.road;
      const c = edge.curve;
      const n = Math.max(2, Math.ceil(c.length / 6));
      const pts = [];
      for (let i = 0; i <= n; i++) {
        const p = c.pointAt((i / n) * c.length);
        pts.push({ x: p.x, y: p.y + 0.35, z: p.z });
      }
      ov.polyline(pts, col);
      if (sel) {
        for (const v of edge.via) ov.circle({ x: v.x, y: v.y + 0.4, z: v.z }, 1.1, COL.roadSel, 16);
      }
    }
  }

  if (view.handles) {
    for (const node of net.nodes.values()) {
      const info = scene.surface.junctions.get(node.id);
      const isSel = selection?.type === 'junction' && selection.id === node.id;
      const isHover = hover?.type === 'junction' && hover.id === node.id;
      const col = isSel ? COL.nodeSel : isHover ? COL.nodeHover : COL.node;
      const r = Math.max(2.2, (info?.radius ?? 5) * 0.32);
      const y = node.p.y + 0.42;
      ov.circle({ x: node.p.x, y, z: node.p.z }, r, col, node.edges.length >= 3 ? 24 : 12);
      if (isSel || isHover) {
        ov.disc({ x: node.p.x, y: y + 0.01, z: node.p.z }, r * 0.75, [col[0], col[1], col[2], 0.3]);
        if (info) ov.circle({ x: info.centre.x, y: y + 0.02, z: info.centre.z }, info.radius ?? r, [col[0], col[1], col[2], 0.35], 48);
      }
      if (node.locked) {
        const s = r * 0.8;
        ov.line({ x: node.p.x - s, y, z: node.p.z - s }, { x: node.p.x + s, y, z: node.p.z + s }, [0.9, 0.4, 0.4, 0.8]);
        ov.line({ x: node.p.x - s, y, z: node.p.z + s }, { x: node.p.x + s, y, z: node.p.z - s }, [0.9, 0.4, 0.4, 0.8]);
      }
    }
  }

  if (view.laneGraph && scene.laneGraph) {
    for (const lane of scene.laneGraph.lanes.values()) {
      const pts = lane.pts;
      for (let i = 0; i < pts.length - 1; i += 2) {
        ov.line({ x: pts[i].x, y: pts[i].y + 0.08, z: pts[i].z },
          { x: pts[i + 1].x, y: pts[i + 1].y + 0.08, z: pts[i + 1].z }, COL.lane);
      }
    }
    for (const conn of scene.laneGraph.connections) {
      const pts = conn.path;
      for (let i = 0; i < pts.length - 1; i++) {
        ov.line({ x: pts[i].x, y: pts[i].y + 0.1, z: pts[i].z },
          { x: pts[i + 1].x, y: pts[i + 1].y + 0.1, z: pts[i + 1].z }, COL.laneLink);
      }
    }
  }

  if (selection?.type === 'junction' && view.gizmo) {
    const node = net.nodes.get(selection.id);
    if (node) drawGizmo(ov, camera, { x: node.p.x, y: node.p.y, z: node.p.z }, dragging);
  }
  return ov;
}
