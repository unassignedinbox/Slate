/**
 * A demo network with the variety the mesher has to survive: right-angle
 * crossroads, skew junctions, a Y fork, tees, curved arterials and a service
 * lane. Deterministic, so the topology report means something.
 */
import { v3, V3 } from '../core/vec';
import { RoadGraph, RoadFeature } from './graph';
import { hash2 } from '../core/vec';

export interface CityOpts {
  cols?: number; rows?: number;
  block?: number;
  jitter?: number;
  seed?: number;
}

export function buildCity(o: CityOpts = {}): RoadGraph {
  const cols = o.cols ?? 4, rows = o.rows ?? 3;
  const B = o.block ?? 86;
  const jit = o.jitter ?? 7;
  const seed = o.seed ?? 3;
  const g = new RoadGraph();

  const id: number[][] = [];
  for (let r = 0; r <= rows; r++) {
    id[r] = [];
    for (let c = 0; c <= cols; c++) {
      const hx = (hash2(c + seed * 31, r) - 0.5) * 2 * jit;
      const hz = (hash2(r + seed * 17, c + 9) - 0.5) * 2 * jit;
      const x = (c - cols / 2) * B + hx;
      const z = (r - rows / 2) * B + hz;
      id[r][c] = g.addNode(v3(x, 0, z)).id;
    }
  }

  // the middle row is the arterial, the middle column an avenue
  const artR = Math.floor(rows / 2);
  const avenueC = Math.max(1, Math.floor(cols / 2));
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c < cols; c++) {
      const prof = r === artR ? 'avenue' : (r === 0 || r === rows) ? 'street' : 'street';
      const e = g.addEdge(id[r][c], id[r][c + 1], prof);
      e.ha = e.hb = r === artR ? 0.30 : 0.26;
    }
  }
  for (let c = 0; c <= cols; c++) {
    for (let r = 0; r < rows; r++) {
      const prof = c === avenueC ? 'boulevard' : 'street';
      const e = g.addEdge(id[r][c], id[r + 1][c], prof);
      e.ha = e.hb = 0.26;
    }
  }

  // a service lane cutting one block diagonally, to force skew junctions
  const mid = g.addNode(v3((0 - cols / 2 + 0.5) * B, 0, (0 - rows / 2 + 0.5) * B));
  g.addEdge(id[0][0], mid.id, 'lane');
  g.addEdge(mid.id, id[1][1], 'lane');

  // a Y fork off the arterial
  const stem = g.addNode(v3((cols / 2) * B + 62, 0, (artR - rows / 2) * B + 6));
  const armA = g.addNode(v3((cols / 2) * B + 138, 0, (artR - rows / 2) * B - 54));
  const armB = g.addNode(v3((cols / 2) * B + 138, 0, (artR - rows / 2) * B + 58));
  const st = g.addEdge(id[artR][cols], stem.id, 'avenue'); st.ha = st.hb = 0.4;
  const ya = g.addEdge(stem.id, armA.id, 'street'); ya.ha = 0.55; ya.hb = 0.4;
  const yb = g.addEdge(stem.id, armB.id, 'street'); yb.ha = 0.55; yb.hb = 0.4;

  // street furniture and defects
  let fs = 11;
  const rnd = () => hash2(fs++, seed * 7 + 3);
  for (const e of g.edges.values()) {
    const p = g.profileOf(e);
    if (p.footway > 0) {
      e.features.push({ kind: 'crossing', t: 0.12, size: 4.0, seed: fs++ });
      e.features.push({ kind: 'crossing', t: 0.88, size: 4.0, seed: fs++ });
    }
    if (e.profile === 'street' && rnd() > 0.55) {
      e.features.push({ kind: 'bump', t: 0.4 + rnd() * 0.2, size: 3.7, seed: fs++ });
    }
    const np = Math.floor(rnd() * 3);
    for (let i = 0; i < np; i++) {
      e.features.push({
        kind: 'pothole', t: 0.2 + rnd() * 0.6, size: 0.35 + rnd() * 0.5,
        u: (rnd() - 0.5) * p.carriageHalf * 1.2, seed: fs++,
      });
    }
    if (rnd() > 0.88) e.features.push({ kind: 'works', t: 0.3 + rnd() * 0.4, size: 14, seed: fs++ });
  }
  for (const n of g.nodes.values()) n.signals = n.edges.length >= 4;
  return g;
}
