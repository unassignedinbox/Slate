// Procedural city generator. Produces a jittered street grid with three tiers
// (avenues with bus/bike lanes, arterials, local streets), a highway ring with
// ramps, a railway that crosses the grid (crossings are derived automatically),
// subway lines with stations, footpaths, and street furniture.
import { V3, V, sub, len3 } from './geometry';
import { Network, Prop, Road, PRESETS, laneBands, makeRoad, uid, emptyNetwork } from './model';

export interface CityOptions {
  blocks: number;      // blocks per side
  blockSize: number;   // metres per block
  seed: number;
  subway: boolean;
  rail: boolean;
  ring: boolean;
  footpaths: boolean;
  props: boolean;
}

export const DEFAULT_CITY: CityOptions = {
  blocks: 24,
  blockSize: 110,
  seed: 1337,
  subway: true,
  rail: true,
  ring: true,
  footpaths: true,
  props: true,
};

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Tier = 'avenue' | 'arterial' | 'local';
const tierOf = (idx: number): Tier => (idx % 6 === 0 ? 'avenue' : idx % 3 === 0 ? 'arterial' : 'local');
const PRESET_OF: Record<Tier, string> = { avenue: 'avenue', arterial: 'arterial', local: 'local' };

export function generateCity(opts: CityOptions): Network {
  const rnd = mulberry32(opts.seed);
  const n = opts.blocks + 1;
  const bs = opts.blockSize;
  const half = (opts.blocks * bs) / 2;
  const roads: Road[] = [];
  const props: Prop[] = [];

  // Jittered grid nodes (border nodes are kept straight so the ring meets them cleanly).
  const node: V3[][] = [];
  for (let i = 0; i < n; i++) {
    node[i] = [];
    for (let j = 0; j < n; j++) {
      const edge = i === 0 || j === 0 || i === n - 1 || j === n - 1;
      const jx = edge ? 0 : (rnd() - 0.5) * 0.12 * bs;
      const jz = edge ? 0 : (rnd() - 0.5) * 0.12 * bs;
      node[i][j] = V(-half + i * bs + jx, 0, -half + j * bs + jz);
    }
  }

  const sidewalkOffsets = (preset: string): { left: number; right: number } => {
    const bands = laneBands(PRESETS[preset].lanes);
    const sw = bands.filter((b) => b.lane.kind === 'sidewalk');
    if (sw.length === 0) return { left: -4, right: 4 };
    return { left: (sw[0].a + sw[0].b) / 2, right: (sw[sw.length - 1].a + sw[sw.length - 1].b) / 2 };
  };

  const addRoad = (preset: string, pts: V3[], name?: string, smooth?: boolean): Road => {
    const r = makeRoad(preset, pts, name);
    if (smooth !== undefined) r.smooth = smooth;
    roads.push(r);
    return r;
  };

  // ---- Street grid -------------------------------------------------------------------
  // Horizontal line j runs along X and uses tier(j); vertical line i runs along Z and uses tier(i).
  const segFor = (a: V3, b: V3, tier: Tier): Road | null => {
    if (tier === 'local' && rnd() < 0.07) return null; // occasional gap, keeps the grid organic
    const mid = V((a.x + b.x) / 2, 0, (a.z + b.z) / 2);
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l = Math.hypot(dx, dz) || 1;
    const off = (rnd() - 0.5) * 0.08 * bs;
    const m = V(mid.x - (dz / l) * off, 0, mid.z + (dx / l) * off);
    if (tier === 'avenue') return addRoad(PRESET_OF[tier], [a, b], undefined, false);
    return addRoad(PRESET_OF[tier], [a, m, b], undefined, true);
  };

  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n - 1; i++) {
      const r = segFor(node[i][j], node[i + 1][j], tierOf(j));
      if (r) r.name = `${tierOf(j)} E-W ${j}.${i}`;
    }
  }
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n - 1; j++) {
      const r = segFor(node[i][j], node[i][j + 1], tierOf(i));
      if (r) r.name = `${tierOf(i)} N-S ${i}.${j}`;
    }
  }

  // ---- Highway ring + ramps ----------------------------------------------------------
  if (opts.ring) {
    const R = half + bs * 1.6;
    const corners = [V(-R, 0, -R), V(R, 0, -R), V(R, 0, R), V(-R, 0, R)];
    for (let k = 0; k < 4; k++) {
      addRoad('highway', [corners[k], corners[(k + 1) % 4]], `Ring highway ${k + 1}`, false);
    }
    const edgeMid = [V(0, 0, -half), V(half, 0, 0), V(0, 0, half), V(-half, 0, 0)];
    const midGrid = [
      node[Math.floor(n / 2)][0],
      node[n - 1][Math.floor(n / 2)],
      node[Math.floor(n / 2)][n - 1],
      node[0][Math.floor(n / 2)],
    ];
    for (let k = 0; k < 4; k++) {
      const m = edgeMid[k];
      const target = V(m.x * (R / half), 0, m.z * (R / half));
      addRoad('arterial', [midGrid[k], target], `Ramp ${k + 1}`, false);
    }
  }

  // ---- Railway crossing the grid -----------------------------------------------------
  if (opts.rail) {
    addRoad(
      'rail',
      [V(-half - bs * 2, 0, -half * 0.2 + 0.37 * bs), V(0, 0, 0.37 * bs + 0.05 * bs), V(half + bs * 2, 0, half * 0.5 + 0.37 * bs)],
      'Main line',
      true,
    );
  }

  // ---- Subway lines (underground, stations at nodes) ---------------------------------
  if (opts.subway) {
    const jL = Math.min(6, n - 1);
    const lineA: V3[] = [];
    for (let i = 0; i < n; i++) lineA.push(node[i][jL]);
    const iL = Math.min(6, n - 1);
    const lineB: V3[] = [];
    for (let j = 0; j < n; j++) lineB.push(node[iL][j]);
    for (const [line, name] of [[lineA, 'Metro Line 1'], [lineB, 'Metro Line 2']] as const) {
      const r = addRoad('subway', line.map((p) => V(p.x, p.y, p.z)), name, false);
      if (opts.props) {
        // Station entrances at every second node, on the left sidewalk of the avenue.
        const sw = sidewalkOffsets('avenue').left;
        let s = 0;
        for (let k = 0; k < line.length; k++) {
          if (k > 0) s += len3(sub(line[k], line[k - 1]));
          if (k % 2 === 0 && k > 0 && k < line.length - 1) {
            props.push({ id: uid('p_'), kind: 'station', roadId: r.id, s, length: 0, offset: sw });
          }
        }
      }
    }
  }

  // ---- Footpaths through blocks --------------------------------------------------------
  if (opts.footpaths) {
    for (let i = 1; i < n - 2; i += 4) {
      for (let j = 1; j < n - 2; j += 5) {
        if (rnd() < 0.5) continue;
        const a = node[i][j];
        const b = node[i + 1][j + 1];
        const fp = addRoad('footpath', [a, V((a.x + b.x) / 2, 0, (a.z + b.z) / 2), b], 'Footpath', true);
        if (opts.props) {
          const L = len3(sub(b, a)) * 1.05;
          props.push({ id: uid('p_'), kind: 'bollard', roadId: fp.id, s: 1, length: L - 2, offset: 1.15 });
          props.push({ id: uid('p_'), kind: 'bollard', roadId: fp.id, s: 1, length: L - 2, offset: -1.15 });
        }
      }
    }
  }

  // ---- Street furniture ----------------------------------------------------------------
  if (opts.props) {
    roads.forEach((r) => {
      if (r.category !== 'road') return;
      const len = roadLengthApprox(r);
      if (r.preset === 'local' || r.preset === 'arterial') {
        if (rnd() < 0.5) props.push({ id: uid('p_'), kind: 'streetlight', roadId: r.id, s: 3, length: Math.max(0, len - 6), offset: sidewalkOffsets(r.preset).left });
        if (rnd() < 0.2) props.push({ id: uid('p_'), kind: 'speedbump', roadId: r.id, s: len / 2, length: 0, offset: 0 });
      }
      if (r.preset === 'avenue') {
        const sw = sidewalkOffsets('avenue');
        props.push({ id: uid('p_'), kind: 'streetlight', roadId: r.id, s: 3, length: Math.max(0, len - 6), offset: sw.left });
        props.push({ id: uid('p_'), kind: 'streetlight', roadId: r.id, s: 3, length: Math.max(0, len - 6), offset: sw.right });
        if (rnd() < 0.6) props.push({ id: uid('p_'), kind: 'busstop', roadId: r.id, s: len / 2, length: 0, offset: sw.left });
      }
    });
  }

  const net = emptyNetwork();
  net.roads = roads;
  net.props = props;
  return net;
}

export function roadLengthApprox(r: Road): number {
  let L = 0;
  for (let i = 1; i < r.points.length; i++) L += len3(sub(r.points[i], r.points[i - 1]));
  return L;
}
