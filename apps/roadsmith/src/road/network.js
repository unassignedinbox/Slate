// The road graph: intersections (nodes) and roads (edges, each a spline + a cross-section profile).
// Pure data + topology queries — no rendering, no DOM, so the validator can run it under Node.

import { Curve } from '../core/spline.js';
import {
  v3, v3sub, v3norm, normXZ, headingOf, angleDelta, clamp, v3dist2D,
} from '../core/math.js';
import { defaultProfile, ROAD_CLASS, crossSection, totalWidth, lanesOf } from './profile.js';

let UID = 1;
export const nextId = (prefix) => `${prefix}${UID++}`;
export const resetIds = () => { UID = 1; };

export class RoadNetwork {
  constructor() {
    this.nodes = new Map();
    this.edges = new Map();
    this.version = 0;
  }

  addNode(p, opts = {}) {
    const node = {
      id: opts.id || nextId('N'),
      p: { x: p.x, y: p.y ?? 0, z: p.z },
      edges: [],
      cornerRadius: opts.cornerRadius ?? null, // null = derive from classes
      control: opts.control ?? 'auto',         // auto | signal | stop | yield | none | roundabout
      crosswalks: opts.crosswalks ?? 'auto',   // auto | all | none
      name: opts.name || null,
      locked: !!opts.locked,
      elevationLocked: !!opts.elevationLocked,
      kind: 'end',
      tag: opts.tag || null,
    };
    this.nodes.set(node.id, node);
    this.version++;
    return node;
  }

  addEdge(aId, bId, opts = {}) {
    const a = this.nodes.get(aId), b = this.nodes.get(bId);
    if (!a || !b) throw new Error(`addEdge: missing node ${aId}/${bId}`);
    const edge = {
      id: opts.id || nextId('R'),
      a: aId,
      b: bId,
      via: (opts.via || []).map((p) => ({ x: p.x, y: p.y ?? 0, z: p.z })),
      profile: opts.profile || defaultProfile(opts.class || ROAD_CLASS.LOCAL),
      name: opts.name || null,
      structure: opts.structure || 'ground',   // ground | bridge | tunnel | cut
      features: {
        speedBumps: opts.speedBumps || [],     // [{s, height, width, type}]
        potholes: opts.potholes || [],         // [{s, t, r, depth}]
        patches: opts.patches || [],           // [{s, t, length, width, kind}]
        construction: opts.construction || [], // [{s0, s1, side, kind}]
        railCrossing: opts.railCrossing || null,
        busStops: opts.busStops || [],
        drains: opts.drains || [],
      },
      wear: opts.wear ?? 0.35,
      trimA: 0, trimB: 0,
      curve: null,
      lanes: null,
      hidden: false,
    };
    this.edges.set(edge.id, edge);
    a.edges.push(edge.id);
    b.edges.push(edge.id);
    this.rebuildCurve(edge);
    this.version++;
    return edge;
  }

  removeEdge(id) {
    const e = this.edges.get(id);
    if (!e) return;
    for (const nid of [e.a, e.b]) {
      const n = this.nodes.get(nid);
      if (n) n.edges = n.edges.filter((x) => x !== id);
    }
    this.edges.delete(id);
    this.version++;
  }

  removeNode(id) {
    const n = this.nodes.get(id);
    if (!n) return;
    for (const eid of [...n.edges]) this.removeEdge(eid);
    this.nodes.delete(id);
    this.version++;
  }

  rebuildCurve(edge) {
    const a = this.nodes.get(edge.a), b = this.nodes.get(edge.b);
    const pts = [a.p, ...edge.via, b.p];
    edge.curve = new Curve(pts, { samples: Math.max(32, Math.ceil(straightLen(pts) / 0.75)) });
    edge.lanes = lanesOf(edge.profile);
    return edge.curve;
  }

  rebuildAllCurves() {
    for (const e of this.edges.values()) this.rebuildCurve(e);
    for (const n of this.nodes.values()) n.kind = n.edges.length >= 3 ? 'junction' : n.edges.length === 2 ? 'joint' : 'end';
    this.version++;
  }

  moveNode(id, p) {
    const n = this.nodes.get(id);
    if (!n || n.locked) return false;
    const dx = p.x - n.p.x, dz = p.z - n.p.z;
    const dy = p.y !== undefined && !n.elevationLocked ? p.y - n.p.y : 0;
    n.p.x = p.x; n.p.z = p.z;
    if (p.y !== undefined && !n.elevationLocked) n.p.y = p.y;
    const touched = new Set([id]);
    for (const eid of n.edges) {
      const e = this.edges.get(eid);
      // soft drag: control points near the moved end follow it so the road bends instead of kinking
      const atA = e.a === id;
      const k = e.via.length;
      for (let i = 0; i < k; i++) {
        const f = (i + 1) / (k + 1);
        const w = Math.pow(atA ? 1 - f : f, 1.5);
        e.via[i].x += dx * w;
        e.via[i].z += dz * w;
        e.via[i].y += dy * w;
      }
      this.rebuildCurve(e);
      touched.add(e.a); touched.add(e.b);
    }
    this.version++;
    return touched;
  }

  /** Half-edges at a node, sorted CCW by heading, each pointing away from the node. */
  branchesAt(nodeId) {
    const node = this.nodes.get(nodeId);
    const out = [];
    for (const eid of node.edges) {
      const e = this.edges.get(eid);
      if (!e.curve) this.rebuildCurve(e);
      const atA = e.a === nodeId;
      const L = e.curve.length;
      // direction leaving the node (sampled a little way in so curvature is respected)
      const probe = Math.min(Math.max(2.5, L * 0.08), L * 0.5);
      const p0 = atA ? e.curve.pointAt(0) : e.curve.pointAt(L);
      const p1 = atA ? e.curve.pointAt(probe) : e.curve.pointAt(L - probe);
      const dir = normXZ(v3sub(p1, p0));
      const sec = crossSection(e.profile, { bridge: e.structure === 'bridge' });
      // profile-space t maps to world "driver's right" of the curve direction; for a branch
      // leaving the node at B-end the curve direction is reversed, so sides swap.
      const flip = !atA;
      const outerL = flip ? sec.halfOuterR : sec.halfOuterL;
      const outerR = flip ? sec.halfOuterL : sec.halfOuterR;
      const edgeL = flip ? sec.tR : -sec.tL;
      const edgeR = flip ? -sec.tL : sec.tR;
      out.push({
        edge: e,
        edgeId: eid,
        nodeId,
        other: atA ? e.b : e.a,
        atA,
        flip,
        dir,
        heading: headingOf(dir),
        section: sec,
        widthOuterL: outerL,
        widthOuterR: outerR,
        widthEdgeL: edgeL,
        widthEdgeR: edgeR,
        totalWidth: totalWidth(e.profile),
        length: L,
      });
    }
    out.sort((p, q) => p.heading - q.heading);
    return out;
  }

  edgeEndpoints(edge) { return [this.nodes.get(edge.a), this.nodes.get(edge.b)]; }

  /** Split an edge at arc-length s, inserting a new node. Returns the new node. */
  splitEdge(edgeId, s) {
    const e = this.edges.get(edgeId);
    if (!e) return null;
    const L = e.curve.length;
    s = clamp(s, 2, L - 2);
    const p = e.curve.pointAt(s);
    const node = this.addNode(p, { control: 'none' });
    const viaA = [], viaB = [];
    const stepA = s / 3, stepB = (L - s) / 3;
    for (let i = 1; i < 3; i++) viaA.push(e.curve.pointAt(stepA * i));
    for (let i = 1; i < 3; i++) viaB.push(e.curve.pointAt(s + stepB * i));
    const common = { profile: { ...e.profile }, structure: e.structure, wear: e.wear };
    const a = this.addEdge(e.a, node.id, { ...common, via: viaA });
    const b = this.addEdge(node.id, e.b, { ...common, via: viaB });
    a.features = { ...e.features, speedBumps: [], potholes: [], patches: [], construction: [], busStops: [], drains: [] };
    b.features = { ...e.features, speedBumps: [], potholes: [], patches: [], construction: [], busStops: [], drains: [] };
    this.removeEdge(edgeId);
    return node;
  }

  stats() {
    let len = 0;
    for (const e of this.edges.values()) len += e.curve ? e.curve.length : 0;
    let junctions = 0;
    for (const n of this.nodes.values()) if (n.edges.length >= 3) junctions++;
    return { nodes: this.nodes.size, edges: this.edges.size, junctions, lengthKm: len / 1000 };
  }

  /** Nearest node to a world point within radius. */
  pickNode(p, radius = 8) {
    let best = null, bestD = radius;
    for (const n of this.nodes.values()) {
      const d = v3dist2D(n.p, p);
      if (d < bestD) { bestD = d; best = n; }
    }
    return best;
  }

  toJSON() {
    return {
      nodes: [...this.nodes.values()].map((n) => ({ id: n.id, p: n.p, control: n.control, cornerRadius: n.cornerRadius, name: n.name, tag: n.tag })),
      edges: [...this.edges.values()].map((e) => ({
        id: e.id, a: e.a, b: e.b, via: e.via, profile: e.profile, structure: e.structure,
        features: e.features, wear: e.wear, name: e.name,
      })),
    };
  }

  static fromJSON(data) {
    const net = new RoadNetwork();
    for (const n of data.nodes) net.addNode(n.p, n);
    for (const e of data.edges) net.addEdge(e.a, e.b, e);
    net.rebuildAllCurves();
    return net;
  }
}

function straightLen(pts) {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
  return Math.max(l, 1);
}

/** Classify the turn from branch `from` to branch `to` at a node (for lane connections + signals). */
export function turnType(fromHeading, toHeading) {
  // incoming travel direction is the reverse of the branch direction
  const inDir = fromHeading + Math.PI;
  const d = angleDelta(inDir, toHeading);
  const a = (d * 180) / Math.PI;
  if (Math.abs(a) > 150) return 'uturn';
  if (a > 35) return 'left';
  if (a < -35) return 'right';
  return 'through';
}

export const classRank = {
  [ROAD_CLASS.SERVICE]: 0,
  [ROAD_CLASS.LOCAL]: 1,
  [ROAD_CLASS.COLLECTOR]: 2,
  [ROAD_CLASS.ARTERIAL]: 3,
  [ROAD_CLASS.RAMP]: 3,
  [ROAD_CLASS.HIGHWAY]: 4,
};
