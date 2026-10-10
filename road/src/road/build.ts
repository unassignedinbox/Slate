/**
 * Network -> geometry.
 *
 * Two rules decide the topology, and everything else follows from them:
 *
 *  1. A LINK is a profile swept along a spline, so every face is a quad by
 *     construction. No triangulator ever touches the carriageway.
 *  2. A JUNCTION is not two roads laid on top of each other. Each approach is
 *     TRIMMED back to the tangent point of a real kerb fillet, and the hole
 *     left in the middle is filled with a quad ring that reuses the approach
 *     ring vertices by index. The result is one welded surface: there is no
 *     second layer of asphalt anywhere, and no T-junction in the mesh.
 *
 * The kerb radius, the trim distance and the fillet tangents are ordinary
 * highway-design geometry - 6 m radius on a local street, 9-12 m on an
 * arterial - which is why the corners look like corners.
 */
import {
  V3, v3, add, sub, mul, norm, dot, len, dist, lerp, clamp, smoothstep, fbm1, hash2,
} from '../core/vec';
import { RoadGraph, RoadEdge, RoadNode } from './graph';
import { Profile, MAT } from './profile';
import { QuadMesh, V, Vertex } from './mesh';

// ---------------------------------------------------------------- profile expansion

export interface Sample { u: number; h: number; mat: number }
export interface Expanded {
  s: Sample[];
  /** seam[i] = true -> no quad between sample i and i+1 (a hard arris) */
  seam: boolean[];
  iCarrL: number; iCarrR: number;     // carriageway edge (channel / shoulder lip)
  iKerbL: number; iKerbR: number;     // kerb top arris
  iOutL: number; iOutR: number;       // outermost samples
}

const expCache = new Map<string, Expanded>();

export function expand(p: Profile): Expanded {
  const hit = expCache.get(p.id);
  if (hit) return hit;
  const s: Sample[] = [];
  const seam: boolean[] = [];
  const ptIndex: number[] = [];
  const push = (smp: Sample, isSeam: boolean) => {
    if (s.length > 0) seam.push(isSeam);
    s.push(smp);
  };
  for (let i = 0; i < p.pts.length - 1; i++) {
    const a = p.pts[i], b = p.pts[i + 1];
    if (s.length === 0) {
      ptIndex[i] = 0;
      push({ u: a.u, h: a.h, mat: a.mat }, false);
    } else if (a.crease) {
      // duplicate the point so the two sides can hold different normals
      ptIndex[i] = s.length;
      push({ u: a.u, h: a.h, mat: a.mat }, true);
    } else {
      ptIndex[i] = s.length - 1;
    }
    const steps = Math.max(1, a.div + 1);
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      push({ u: lerp(a.u, b.u, t), h: lerp(a.h, b.h, t), mat: a.mat }, false);
    }
  }
  ptIndex[p.pts.length - 1] = s.length - 1;

  // roles: the carriageway edge is the outermost sample sitting at datum level
  let iCarrL = -1, iCarrR = -1;
  for (let i = 0; i < s.length; i++) {
    if (s[i].u < 0 && Math.abs(s[i].h) < 0.002 && iCarrL < 0) iCarrL = i;
    if (s[i].u > 0 && Math.abs(s[i].h) < 0.002) iCarrR = i;
  }
  if (iCarrL < 0) iCarrL = 0;
  if (iCarrR < 0) iCarrR = s.length - 1;
  const out: Expanded = {
    s, seam,
    iCarrL, iCarrR,
    iKerbL: Math.max(0, iCarrL - 1), iKerbR: Math.min(s.length - 1, iCarrR + 1),
    iOutL: 0, iOutR: s.length - 1,
  };
  expCache.set(p.id, out);
  return out;
}

// ---------------------------------------------------------------- junction solving

interface Approach {
  edge: number;
  node: number;
  dir: V3;          // unit, leaving the node
  right: V3;
  prof: Profile;
  exp: Expanded;
  trim: number;     // arclength from the node where the link starts
  ring: number[];   // vertex ids, ordered LEFT -> RIGHT as seen leaving the node
}

export interface Corner {
  /** kerb line at carriageway level, from approach i's right to approach j's left */
  line: V3[];
  radius: number;
}

/** Fillet two kerb lines. Returns tangent distances along each approach. */
function fillet(
  N: V3, a: V3, ra: V3, wa: number, b: V3, rb: V3, wb: number, R: number,
): { ta: number; tb: number; arc: V3[]; ok: boolean } {
  // A's right boundary and B's left boundary
  const oa = add(N, mul(ra, wa));
  const ob = sub(N, mul(rb, wb));
  // intersect oa + s*a  with  ob + t*b
  const den = a.x * b.z - a.z * b.x;
  if (Math.abs(den) < 1e-5) {
    // parallel: a straight kerb run, no arc
    return { ta: 0, tb: 0, arc: [], ok: false };
  }
  const dx = ob.x - oa.x, dz = ob.z - oa.z;
  const s = (dx * b.z - dz * b.x) / den;
  const C = add(oa, mul(a, s));
  // sector angle from a to b
  let th = Math.atan2(b.z, b.x) - Math.atan2(a.z, a.x);
  while (th <= 0) th += Math.PI * 2;
  while (th > Math.PI * 2) th -= Math.PI * 2;
  const halfT = th / 2;
  const sn = Math.sin(halfT);
  if (Math.abs(sn) < 1e-4) return { ta: 0, tb: 0, arc: [], ok: false };
  const T = R / Math.tan(halfT);
  const Pa = add(C, mul(a, T));
  const Pb = add(C, mul(b, T));
  const m = norm(add(a, b));
  const O = add(C, mul(m, R / sn));
  // sweep from Pa to Pb about O
  const a0 = Math.atan2(Pa.z - O.z, Pa.x - O.x);
  let a1 = Math.atan2(Pb.z - O.z, Pb.x - O.x);
  let sweep = a1 - a0;
  while (sweep > Math.PI) sweep -= Math.PI * 2;
  while (sweep < -Math.PI) sweep += Math.PI * 2;
  const rr = Math.hypot(Pa.x - O.x, Pa.z - O.z);
  const segs = Math.max(2, Math.ceil(Math.abs(sweep) * rr / 0.7));
  const arc: V3[] = [];
  for (let i = 1; i < segs; i++) {
    const ang = a0 + sweep * (i / segs);
    arc.push(v3(O.x + Math.cos(ang) * rr, 0, O.z + Math.sin(ang) * rr));
  }
  const ta = dot(sub(Pa, N), a);
  const tb = dot(sub(Pb, N), b);
  return { ta, tb, arc, ok: Number.isFinite(ta) && Number.isFinite(tb) };
}

// ---------------------------------------------------------------- features

function featureLift(e: RoadEdge, arc: number, total: number, u: number, half: number): number {
  let dy = 0;
  for (const f of e.features) {
    const c = f.t * total;
    const d = arc - c;
    if (f.kind === 'bump') {
      // 3.7 m round-top road hump, 75-100 mm high (DfT TAL 2/96 geometry)
      if (Math.abs(d) < f.size * 0.5) {
        const x = d / (f.size * 0.5);
        dy += 0.085 * Math.cos(x * Math.PI * 0.5) ** 2 * clamp(1.1 - Math.abs(u) / half, 0, 1);
      }
    } else if (f.kind === 'pothole') {
      const uu = (f.u ?? 0);
      const r = Math.hypot(d, (u - uu) * 1.4);
      if (r < f.size) {
        const k = 1 - r / f.size;
        dy -= (0.035 + 0.02 * hash2(f.seed, 7)) * k * k * (0.7 + 0.3 * fbm1(r * 9 + f.seed, 3));
      }
    } else if (f.kind === 'works') {
      // excavated trench, rough reinstatement
      if (Math.abs(d) < f.size * 0.5) dy -= 0.03 + 0.012 * fbm1(arc * 2.2 + f.seed, 3);
    }
  }
  return dy;
}

/** Which painted marking, if any, covers this station. */
function featureMark(e: RoadEdge, arc: number, total: number): number {
  for (const f of e.features) {
    const d = Math.abs(arc - f.t * total);
    if (f.kind === 'crossing' && d < f.size * 0.5) return 1;
    if (f.kind === 'crossing' && d < f.size * 0.5 + 1.6) return 2;    // stop bar behind it
    if (f.kind === 'works' && d < f.size * 0.5) return 3;
  }
  return 0;
}

function featureWear(e: RoadEdge, arc: number, total: number, u: number): number {
  let w = 0;
  for (const f of e.features) {
    const d = Math.abs(arc - f.t * total);
    if (f.kind === 'works' && d < f.size * 0.6) w = Math.max(w, 1);
    if (f.kind === 'pothole' && d < f.size * 1.6) w = Math.max(w, 0.8);
  }
  return w;
}

// ---------------------------------------------------------------- the builder

export interface BuildOut {
  mesh: QuadMesh;
  /** per-node junction centre, for gizmos and picking */
  junctions: Map<number, { centre: V3; radius: number }>;
  /** lane centre polylines for traffic, keyed edge id */
  lanes: Map<number, { left: V3[]; right: V3[] }>;
  stats: { quads: number; tris: number; verts: number; links: number; junctions: number };
}

export interface BuildOpts {
  /** target spacing of cross sections along a link, metres */
  step?: number;
  /** flatten the carriageway crossfall this far back from a junction */
  flatten?: number;
}

export function buildNetwork(g: RoadGraph, o: BuildOpts = {}): BuildOut {
  const step = o.step ?? 2.0;
  const flatLen = o.flatten ?? 9;
  const mesh = new QuadMesh();
  const junctions = new Map<number, { centre: V3; radius: number }>();
  const lanes = new Map<number, { left: V3[]; right: V3[] }>();

  // ---- 1. trim distances, from the kerb fillets at every node
  const trim = new Map<string, number>();            // `${node}:${edge}` -> metres
  const corners = new Map<number, Corner[]>();       // node -> corner kerb lines
  const key = (n: number, e: number) => `${n}:${e}`;

  for (const node of g.nodes.values()) {
    const fan = g.fan(node.id);
    for (const f of fan) trim.set(key(node.id, f.edge), 0);
    if (fan.length < 2) continue;
    if (fan.length === 2 && sameProfile(g, fan[0].edge, fan[1].edge)) continue;   // a bend, welded
    const cs: Corner[] = [];
    for (let i = 0; i < fan.length; i++) {
      const A = fan[i], B = fan[(i + 1) % fan.length];
      if (fan.length === 2 && i === 1) break;         // a two-way node has one gap
      const pa = g.profileOf(g.edges.get(A.edge)!);
      const pb = g.profileOf(g.edges.get(B.edge)!);
      const R = Math.min(pa.kerbRadius, pb.kerbRadius);
      const ra = RoadGraph.right(A.dir), rb = RoadGraph.right(B.dir);
      const f = fillet(node.p, A.dir, ra, pa.carriageHalf, B.dir, rb, pb.carriageHalf, R);
      // An acute fork sends the tangent length to infinity (T = R/tan(th/2)),
      // which would trim an entire street away and leave the two junction
      // surfaces overlapping in the middle. Real layouts use a compound kerb
      // there; capping the trim is the cheap equivalent.
      const capA = pa.carriageHalf * 2.0 + R * 4.0;
      const capB = pb.carriageHalf * 2.0 + R * 4.0;
      const ta = f.ok ? clamp(f.ta, pa.carriageHalf * 0.6, capA) : pa.carriageHalf * 1.1;
      const tb = f.ok ? clamp(f.tb, pb.carriageHalf * 0.6, capB) : pb.carriageHalf * 1.1;
      trim.set(key(node.id, A.edge), Math.max(trim.get(key(node.id, A.edge))!, ta));
      trim.set(key(node.id, B.edge), Math.max(trim.get(key(node.id, B.edge))!, tb));
      cs.push({ line: f.arc, radius: R });
    }
    corners.set(node.id, cs);
  }

  // clamp so a short edge cannot be trimmed away entirely
  for (const e of g.edges.values()) {
    const tab = g.arcTable(e);
    const ka = key(e.a, e.id), kb = key(e.b, e.id);
    let ta = trim.get(ka) ?? 0, tb = trim.get(kb) ?? 0;
    // never eat more than 84 % of a link, and always leave a usable run
    const room = Math.min(tab.total * 0.84, tab.total - 4);
    if (ta + tb > room && room > 0) {
      const k = Math.max(0.05, room / (ta + tb));
      ta *= k; tb *= k;
    }
    trim.set(ka, ta); trim.set(kb, tb);
  }

  // ---- 2. links
  const approaches = new Map<number, Approach[]>();   // node -> approaches
  for (const e of g.edges.values()) {
    const prof = g.profileOf(e);
    const ex = expand(prof);
    const tab = g.arcTable(e);
    const ta = trim.get(key(e.a, e.id))!, tb = trim.get(key(e.b, e.id))!;
    const L = Math.max(1, tab.total - ta - tb);
    const n = Math.max(2, Math.round(L / step));
    const rings: number[][] = [];
    const laneL: V3[] = [], laneR: V3[] = [];

    for (let i = 0; i <= n; i++) {
      const arc = ta + (L * i) / n;
      const t = RoadGraph.tAt(tab, arc);
      const c = RoadGraph.evalBezier(tab.c, t);
      const tg = RoadGraph.tangent(tab.c, t);
      const rt = RoadGraph.right(tg);
      // crossfall is ironed out into the junction so the surfaces meet flat
      const fa = smoothstep(0, flatLen, arc - ta);
      const fb = smoothstep(0, flatLen, (tab.total - tb) - arc);
      const flat = Math.min(fa, fb);
      const ring: number[] = [];
      for (let k = 0; k < ex.s.length; k++) {
        const smp = ex.s[k];
        const inCarr = k >= ex.iCarrL && k <= ex.iCarrR;
        const h = inCarr ? smp.h * flat : smp.h;
        const lift = inCarr ? featureLift(e, arc, tab.total, smp.u, prof.carriageHalf) : 0;
        const p = add(add(c, mul(rt, smp.u)), v3(0, h + lift, 0));
        const wear = clamp(
          0.25 + 0.5 * Math.abs(smp.u) / prof.totalHalf
          + 0.25 * fbm1(arc * 0.06 + e.id * 13.7, 4)
          + featureWear(e, arc, tab.total, smp.u), 0, 1);
        ring.push(mesh.push(V(p, smp.u, arc, smp.mat, 0, prof.carriageHalf, wear,
          prof.laneWidth, prof.lanes, featureMark(e, arc, tab.total))));
      }
      rings.push(ring);
      const off = prof.laneOffsets[0] ?? -1.75;
      laneL.push(add(add(c, mul(rt, off)), v3(0, 0.02, 0)));
      laneR.push(add(add(c, mul(rt, -off)), v3(0, 0.02, 0)));
    }
    for (let i = 0; i < n; i++) mesh.strip(rings[i], rings[i + 1], ex.seam);
    lanes.set(e.id, { left: laneL, right: laneR });

    const reg = (nodeId: number, ring: number[], flip: boolean) => {
      const dir = g.outDir(nodeId, e.id);
      const list = approaches.get(nodeId) ?? [];
      list.push({
        edge: e.id, node: nodeId, dir, right: RoadGraph.right(dir), prof, exp: ex,
        trim: nodeId === e.a ? ta : tb,
        ring: flip ? [...ring].reverse() : ring,
      });
      approaches.set(nodeId, list);
    };
    // leaving node A the profile order already reads left to right;
    // leaving node B it is reversed
    reg(e.a, rings[0], false);
    reg(e.b, rings[n], true);
  }

  // ---- 3. junction surfaces
  let njun = 0;
  for (const node of g.nodes.values()) {
    const list = (approaches.get(node.id) ?? []);
    if (list.length < 2) continue;
    if (list.length === 2 && sameProfile(g, list[0].edge, list[1].edge)) {
      weldBend(mesh, list[0], list[1]);
      continue;
    }
    list.sort((p, q) => Math.atan2(p.dir.z, p.dir.x) - Math.atan2(q.dir.z, q.dir.x));
    buildJunction(mesh, g, node, list);
    njun++;
    const r = Math.max(...list.map((a) => a.trim + a.prof.totalHalf));
    junctions.set(node.id, { centre: node.p, radius: r });
  }

  mesh.computeNormals();
  return {
    mesh, junctions, lanes,
    stats: {
      quads: mesh.quads.length / 4, tris: mesh.tris.length / 3,
      verts: mesh.verts.length, links: g.edges.size, junctions: njun,
    },
  };
}

function sameProfile(g: RoadGraph, ea: number, eb: number): boolean {
  return g.edges.get(ea)!.profile === g.edges.get(eb)!.profile;
}

/**
 * Two roads of the same type meeting at a bend: stitch the end rings straight
 * to each other. Both were generated from the same profile at the same station
 * with equal and opposite tangents, so the strip is seamless.
 */
function weldBend(mesh: QuadMesh, A: Approach, B: Approach): void {
  const ra = A.ring, rb = [...B.ring].reverse();
  const n = Math.min(ra.length, rb.length);
  for (let i = 0; i < n - 1; i++) {
    if (A.exp.seam[i]) continue;
    mesh.quad(ra[i], ra[i + 1], rb[i + 1], rb[i]);
  }
}

/** The welded junction surface: kerb corners, footway corners and the infill. */
function buildJunction(mesh: QuadMesh, g: RoadGraph, node: RoadNode, ap: Approach[]): void {
  const n = ap.length;
  const P = (i: number) => mesh.verts[i].p;

  /** carriageway boundary loop, as vertex ids */
  const loop: number[] = [];
  /** matching kerb-top and footway-outer loops (-1 where the profile has none) */
  const kerbTop: number[] = [];
  const footOut: number[] = [];

  for (let i = 0; i < n; i++) {
    const A = ap[i], B = ap[(i + 1) % n];
    const ea = A.exp, eb = B.exp;

    // --- the approach chord, carriageway edge to carriageway edge.
    // Crease seams in the profile are two vertices at ONE position; the
    // boundary loop must take one of them or every inset quad built off it is
    // born degenerate.
    for (let k = ea.iCarrL; k <= ea.iCarrR; k++) {
      if (k > ea.iCarrL && ea.seam[k - 1]) continue;
      loop.push(A.ring[k]);
      kerbTop.push(k === ea.iCarrL ? A.ring[ea.iKerbL] : k === ea.iCarrR ? A.ring[ea.iKerbR] : -1);
      footOut.push(k === ea.iCarrL ? A.ring[ea.iOutL] : k === ea.iCarrR ? A.ring[ea.iOutR] : -1);
    }
    if (n === 2 && i === 1) break;

    // --- the kerb corner between A's right and B's left
    const pa = A.prof, pb = B.prof;
    const R = Math.min(pa.kerbRadius, pb.kerbRadius);
    const f = fillet(node.p, A.dir, A.right, pa.carriageHalf, B.dir, B.right, pb.carriageHalf, R);
    const startV = A.ring[ea.iCarrR];
    const endV = B.ring[eb.iCarrL];
    const y0 = P(startV).y, y1 = P(endV).y;
    const pts = f.ok ? f.arc : [];
    const kerbA = pa.kerbH, kerbB = pb.kerbH;
    const fwA = pa.footway, fwB = pb.footway;
    for (let k = 0; k < pts.length; k++) {
      const t = (k + 1) / (pts.length + 1);
      const gy = lerp(y0, y1, t);
      const base = v3(pts[k].x, gy, pts[k].z);
      // outward normal of the kerb line, away from the junction centre
      const outw = norm(v3(base.x - node.p.x, 0, base.z - node.p.z));
      const kh = lerp(kerbA, kerbB, t);
      const fw = lerp(fwA, fwB, t);
      const vb = mesh.push(V(base, 0, 0, MAT.GUTTER, 2, pa.carriageHalf, 0.5));
      loop.push(vb);
      const vk = mesh.push(V(add(base, v3(0, kh, 0)), 0, 0, MAT.KERB_FACE, 2, pa.carriageHalf, 0.35));
      kerbTop.push(vk);
      if (fw > 0.05) {
        const o = add(add(base, v3(0, kh + fw * 0.02, 0)), mul(outw, fw));
        footOut.push(mesh.push(V(o, 0, 0, MAT.FOOTWAY, 2, pa.carriageHalf, 0.3)));
      } else {
        footOut.push(-1);
      }
    }
  }

  // --- kerb face and footway around the corners
  for (let i = 0; i < loop.length; i++) {
    const j = (i + 1) % loop.length;
    const a = kerbTop[i], b = kerbTop[j];
    if (a < 0 || b < 0) continue;
    mesh.quad(loop[i], loop[j], b, a);                 // vertical kerb face
    const c = footOut[i], d = footOut[j];
    if (c >= 0 && d >= 0) mesh.quad(a, b, d, c);       // footway
  }

  // --- infill.
  // Concentric rings shrunk towards a centre, then a paired fan. The centre
  // must NOT be the centroid: a junction boundary is strongly non-convex
  // (every kerb fillet bulges inwards) and a centroid can easily sit where
  // parts of the boundary are not visible from it, which makes the inner
  // rings cross each other - stacked asphalt, exactly what we are trying to
  // avoid. The pole of inaccessibility, the point furthest from the
  // boundary, is visible from far more of the loop.
  const N = loop.length;
  if (N < 4) return;
  const pts2 = loop.map((i) => P(i));
  const centre = poleOfInaccessibility(pts2);
  for (const i of loop) centre.y += P(i).y / N;

  // How far the centre can see in the direction of each boundary vertex. A
  // junction boundary is NOT star-shaped - every kerb fillet curves inwards,
  // and on a five-way with an acute arm some of the loop hides behind another
  // part of it. Shrinking rings by a plain fraction then folds them through
  // the boundary and lays asphalt over asphalt. Clamping each ray to its
  // first boundary crossing keeps every ring inside the surface.
  const reach: number[] = [];
  for (let i = 0; i < N; i++) {
    const p = pts2[i];
    const dx = p.x - centre.x, dz = p.z - centre.z;
    const d = Math.hypot(dx, dz) || 1e-6;
    const ux = dx / d, uz = dz / d;
    let best = d;
    for (let k = 0; k < N; k++) {
      const a = pts2[k], b = pts2[(k + 1) % N];
      const ex = b.x - a.x, ez = b.z - a.z;
      const den = ux * ez - uz * ex;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((a.x - centre.x) * ez - (a.z - centre.z) * ex) / den;
      const sgm = ((a.x - centre.x) * uz - (a.z - centre.z) * ux) / -den;
      if (t > 1e-4 && sgm > 1e-4 && sgm < 1 - 1e-4) best = Math.min(best, t);
    }
    reach.push(Math.min(d, best * 0.985));
  }

  let ring = loop;
  const fracs = [0.66, 0.40, 0.18];
  for (const f of fracs) {
    // Shrink along each ray, then RELAX. A plain radial shrink of a boundary
    // this concave folds the ring through itself; a few Laplacian passes pull
    // the reentrant kerb fillets out of the way, so each successive ring is
    // rounder than the last and no two of them ever cross.
    const px: number[] = [], pz: number[] = [], py: number[] = [];
    for (let i = 0; i < N; i++) {
      const p = pts2[i];
      const dx = p.x - centre.x, dz = p.z - centre.z;
      const d = Math.hypot(dx, dz) || 1e-6;
      const r = f * Math.min(reach[i], d);
      px.push(centre.x + (dx / d) * r);
      pz.push(centre.z + (dz / d) * r);
      py.push(lerp(centre.y, p.y, f));
    }
    const passes = Math.round((1 - f) * 16);
    for (let it = 0; it < passes; it++) {
      const ox = [...px], oz = [...pz];
      for (let i = 0; i < N; i++) {
        const a = (i + N - 1) % N, b = (i + 1) % N;
        px[i] = ox[i] + ((ox[a] + ox[b]) * 0.5 - ox[i]) * 0.55;
        pz[i] = oz[i] + ((oz[a] + oz[b]) * 0.5 - oz[i]) * 0.55;
      }
    }
    const next: number[] = [];
    for (let i = 0; i < N; i++) {
      next.push(mesh.push(V(v3(px[i], py[i], pz[i]), 0, 0, MAT.ASPHALT, 1, 8, 0.55)));
    }
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      mesh.quad(ring[i], ring[j], next[j], next[i]);
    }
    ring = next;
  }
  const ci = mesh.push(V(centre, 0, 0, MAT.ASPHALT, 1, 8, 0.6));
  if (N % 2 === 0) {
    for (let i = 0; i < N; i += 2) mesh.quad(ring[i], ring[(i + 1) % N], ring[(i + 2) % N], ci);
  } else {
    for (let i = 0; i < N - 1; i += 2) mesh.quad(ring[i], ring[i + 1], ring[(i + 2) % N], ci);
    mesh.tris.push(ring[N - 1], ring[0], ci);          // one triangle on an odd loop
  }
}

/**
 * Point inside a polygon furthest from its boundary, by grid search and
 * refinement. Cheap, deterministic, and good enough to keep the junction fan
 * star-shaped.
 */
function poleOfInaccessibility(poly: V3[]): V3 {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  const inside = (x: number, z: number): boolean => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) c = !c;
    }
    return c;
  };
  const clearance = (x: number, z: number): number => {
    let d = Infinity;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      const dx = b.x - a.x, dz = b.z - a.z;
      const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1e-9), 0, 1);
      d = Math.min(d, Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t)));
    }
    return inside(x, z) ? d : -d;
  };
  let bx = (minX + maxX) / 2, bz = (minZ + maxZ) / 2, bd = clearance(bx, bz);
  let stepX = (maxX - minX) / 18, stepZ = (maxZ - minZ) / 18;
  for (let gx = 0; gx <= 18; gx++) {
    for (let gz = 0; gz <= 18; gz++) {
      const x = minX + stepX * gx, z = minZ + stepZ * gz;
      const d = clearance(x, z);
      if (d > bd) { bd = d; bx = x; bz = z; }
    }
  }
  for (let pass = 0; pass < 3; pass++) {
    stepX *= 0.4; stepZ *= 0.4;
    for (let gx = -2; gx <= 2; gx++) {
      for (let gz = -2; gz <= 2; gz++) {
        const x = bx + stepX * gx, z = bz + stepZ * gz;
        const d = clearance(x, z);
        if (d > bd) { bd = d; bx = x; bz = z; }
      }
    }
  }
  return v3(bx, 0, bz);
}
