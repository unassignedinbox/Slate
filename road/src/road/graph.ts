/**
 * The road network itself: a graph of junction nodes joined by spline edges.
 *
 * Every edge is a cubic Bezier whose end tangents are owned by the NODES, not
 * by the edge. That is the thing that makes a junction look designed rather
 * than assembled: two roads meeting at a node leave it along directions that
 * were agreed between them, so the kerb lines can be filleted and the surfaces
 * welded instead of overlapped.
 */
import { V3, v3, add, sub, mul, norm, len, dist, cross, angleXZ, clamp } from '../core/vec';
import { Profile, PROFILES } from './profile';

export interface RoadNode {
  id: number;
  p: V3;
  /** elevation handled in p.y; grade separation uses it directly */
  edges: number[];
  /** true if this node should be built as a junction surface */
  junction: boolean;
  /** stop line / signal control */
  signals: boolean;
}

export type FeatureKind = 'crossing' | 'bump' | 'pothole' | 'works' | 'parking';

export interface RoadFeature {
  kind: FeatureKind;
  /** position along the edge, 0..1 of arclength */
  t: number;
  /** longitudinal size, metres */
  size: number;
  /** lateral offset for things that are not full width */
  u?: number;
  seed: number;
}

export interface RoadEdge {
  id: number;
  a: number;
  b: number;
  /** Bezier handle lengths as a fraction of the chord */
  ha: number;
  hb: number;
  /** explicit handle directions; derived from the node fan when null */
  da: V3 | null;
  db: V3 | null;
  profile: string;
  features: RoadFeature[];
  /** grade separation: 0 at grade, +1 viaduct, -1 cutting/tunnel */
  level: number;
  bridge: boolean;
  tunnel: boolean;
}

export class RoadGraph {
  nodes = new Map<number, RoadNode>();
  edges = new Map<number, RoadEdge>();
  private nextN = 1;
  private nextE = 1;
  /** bumped on every structural change so the mesher knows to rebuild */
  revision = 0;

  addNode(p: V3, junction = true): RoadNode {
    const n: RoadNode = { id: this.nextN++, p, edges: [], junction, signals: false };
    this.nodes.set(n.id, n);
    this.revision++;
    return n;
  }

  addEdge(a: number, b: number, profile = 'street'): RoadEdge {
    const e: RoadEdge = {
      id: this.nextE++, a, b, ha: 0.34, hb: 0.34, da: null, db: null,
      profile, features: [], level: 0, bridge: false, tunnel: false,
    };
    this.edges.set(e.id, e);
    this.nodes.get(a)!.edges.push(e.id);
    this.nodes.get(b)!.edges.push(e.id);
    this.revision++;
    return e;
  }

  removeEdge(id: number): void {
    const e = this.edges.get(id);
    if (!e) return;
    for (const n of [this.nodes.get(e.a), this.nodes.get(e.b)]) {
      if (n) n.edges = n.edges.filter((x) => x !== id);
    }
    this.edges.delete(id);
    this.revision++;
  }

  profileOf(e: RoadEdge): Profile { return PROFILES[e.profile] ?? PROFILES.street; }

  /** Unit direction leaving `node` along `edge`, in the ground plane. */
  outDir(nodeId: number, edgeId: number): V3 {
    const e = this.edges.get(edgeId)!;
    const atA = e.a === nodeId;
    const explicit = atA ? e.da : e.db;
    if (explicit) return norm(v3(explicit.x, 0, explicit.z));
    const n = this.nodes.get(nodeId)!;
    // A node with exactly two roads is not a junction, it is a BEND. Give the
    // two edges equal and opposite tangents along the through-chord and the
    // road sweeps through it as one continuous curve - no junction surface, no
    // sheared weld, and the kerb lines stay parallel round the corner.
    if (n.edges.length === 2 && n.junction !== false) {
      const other = n.edges.find((x) => x !== edgeId);
      if (other !== undefined) {
        const far = (id: number): V3 => {
          const oe = this.edges.get(id)!;
          return this.nodes.get(oe.a === nodeId ? oe.b : oe.a)!.p;
        };
        const here = far(edgeId), there = far(other);
        const through = norm(v3(here.x - there.x, 0, here.z - there.z));
        if (Number.isFinite(through.x)) return through;
      }
    }
    const a = this.nodes.get(e.a)!.p, b = this.nodes.get(e.b)!.p;
    const d = atA ? sub(b, a) : sub(a, b);
    return norm(v3(d.x, 0, d.z));
  }

  /** Incident edges sorted by heading, which is the order junctions are built in. */
  fan(nodeId: number): { edge: number; dir: V3; ang: number }[] {
    const n = this.nodes.get(nodeId)!;
    return n.edges
      .map((edge) => { const dir = this.outDir(nodeId, edge); return { edge, dir, ang: angleXZ(dir) }; })
      .sort((p, q) => p.ang - q.ang);
  }

  /** Control points of the edge's centreline Bezier. */
  bezier(e: RoadEdge): [V3, V3, V3, V3] {
    const a = this.nodes.get(e.a)!.p, b = this.nodes.get(e.b)!.p;
    const L = dist(a, b);
    const da = this.outDir(e.a, e.id), db = this.outDir(e.b, e.id);
    return [a, add(a, mul(da, L * e.ha)), add(b, mul(db, L * e.hb)), b];
  }

  static evalBezier(c: [V3, V3, V3, V3], t: number): V3 {
    const s = 1 - t;
    const w0 = s * s * s, w1 = 3 * s * s * t, w2 = 3 * s * t * t, w3 = t * t * t;
    return v3(
      c[0].x * w0 + c[1].x * w1 + c[2].x * w2 + c[3].x * w3,
      c[0].y * w0 + c[1].y * w1 + c[2].y * w2 + c[3].y * w3,
      c[0].z * w0 + c[1].z * w1 + c[2].z * w2 + c[3].z * w3,
    );
  }

  static tangent(c: [V3, V3, V3, V3], t: number): V3 {
    const s = 1 - t;
    const d = v3(
      3 * s * s * (c[1].x - c[0].x) + 6 * s * t * (c[2].x - c[1].x) + 3 * t * t * (c[3].x - c[2].x),
      3 * s * s * (c[1].y - c[0].y) + 6 * s * t * (c[2].y - c[1].y) + 3 * t * t * (c[3].y - c[2].y),
      3 * s * s * (c[1].z - c[0].z) + 6 * s * t * (c[2].z - c[1].z) + 3 * t * t * (c[3].z - c[2].z),
    );
    return norm(d);
  }

  /** Arclength table so road furniture and markings space out evenly. */
  arcTable(e: RoadEdge, n = 96): { s: number[]; total: number; c: [V3, V3, V3, V3] } {
    const c = this.bezier(e);
    const s = [0];
    let prev = RoadGraph.evalBezier(c, 0), total = 0;
    for (let i = 1; i <= n; i++) {
      const p = RoadGraph.evalBezier(c, i / n);
      total += dist(prev, p);
      s.push(total);
      prev = p;
    }
    return { s, total, c };
  }

  /** t at a given arclength, by inverting the table. */
  static tAt(tab: { s: number[]; total: number }, arc: number): number {
    const n = tab.s.length - 1;
    const target = clamp(arc, 0, tab.total);
    let lo = 0, hi = n;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (tab.s[mid] <= target) lo = mid; else hi = mid;
    }
    const span = tab.s[hi] - tab.s[lo] || 1;
    return (lo + (target - tab.s[lo]) / span) / n;
  }

  /** Right-hand lateral for a ground-plane tangent. */
  static right(t: V3): V3 { return norm(cross(t, v3(0, 1, 0))); }

  serialise(): string {
    return JSON.stringify({
      nodes: [...this.nodes.values()],
      edges: [...this.edges.values()],
    });
  }
}

export { len, norm, sub, add, mul };
