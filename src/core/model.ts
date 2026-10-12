// Data model for the road network. Everything the editor edits is plain JSON,
// so a network can be saved, diffed, versioned and reloaded losslessly.
import { V3, V } from './geometry';

export type LaneKind =
  | 'driving'
  | 'bus'
  | 'bike'
  | 'parking'
  | 'shoulder'
  | 'median'
  | 'sidewalk'
  | 'pedestrian';

export const LANE_KINDS: LaneKind[] = ['driving', 'bus', 'bike', 'parking', 'shoulder', 'median', 'sidewalk', 'pedestrian'];

/** Height (m) above the carriageway for raised kinds. Raised kinds get a curb face. */
export const LANE_RAISE: Record<LaneKind, number> = {
  driving: 0,
  bus: 0,
  bike: 0,
  parking: 0,
  shoulder: 0,
  median: 0.12,
  sidewalk: 0.15,
  pedestrian: 0,
};

export const LANE_LABEL: Record<LaneKind, string> = {
  driving: 'Driving',
  bus: 'Bus lane',
  bike: 'Bike lane',
  parking: 'Parking',
  shoulder: 'Shoulder',
  median: 'Median (raised)',
  sidewalk: 'Sidewalk (curbed)',
  pedestrian: 'Pedestrian / pavement',
};

export interface Lane {
  kind: LaneKind;
  width: number; // metres
  dir: -1 | 0 | 1; // travel direction relative to the centreline (0 = none)
}

export type Surface = 'asphalt' | 'concrete' | 'brick' | 'cobble' | 'gravel' | 'dirt' | 'paving';
export const SURFACES: Surface[] = ['asphalt', 'concrete', 'brick', 'cobble', 'gravel', 'dirt', 'paving'];

export type Category = 'road' | 'path' | 'rail' | 'subway';

export interface Road {
  id: string;
  name: string;
  category: Category;
  preset: string;
  surface: Surface;
  speedLimit: number; // km/h
  smooth: boolean;
  points: V3[];
  lanes: Lane[];
}

export type PropKind = 'bollard' | 'speedbump' | 'streetlight' | 'busstop' | 'station';

export interface Prop {
  id: string;
  kind: PropKind;
  roadId: string;
  s: number;      // metres along the road centreline
  length: number; // >0 repeats the prop along [s, s+length]
  offset: number; // lateral offset from the centreline (m, + = right)
}

export interface Network {
  format: 'slate-roads';
  version: 1;
  roads: Road[];
  props: Prop[];
}

export interface Preset {
  label: string;
  category: Category;
  surface: Surface;
  speedLimit: number;
  smooth: boolean;
  lanes: Lane[];
}

const L = (kind: LaneKind, width: number, dir: -1 | 0 | 1 = 0): Lane => ({ kind, width, dir });

export const PRESETS: Record<string, Preset> = {
  highway: {
    label: 'Highway (dual carriageway)',
    category: 'road',
    surface: 'asphalt',
    speedLimit: 110,
    smooth: true,
    lanes: [L('shoulder', 3), L('driving', 3.6, -1), L('driving', 3.6, -1), L('median', 4), L('driving', 3.6, 1), L('driving', 3.6, 1), L('shoulder', 3)],
  },
  avenue: {
    label: 'Avenue (bus lanes, bike lanes, parking)',
    category: 'road',
    surface: 'asphalt',
    speedLimit: 50,
    smooth: true,
    lanes: [
      L('sidewalk', 3.5), L('parking', 2.3), L('bike', 1.8, -1), L('driving', 3.3, -1), L('bus', 3.5, -1),
      L('median', 1.2), L('bus', 3.5, 1), L('driving', 3.3, 1), L('bike', 1.8, 1), L('parking', 2.3), L('sidewalk', 3.5),
    ],
  },
  arterial: {
    label: 'Arterial (two-way, parking)',
    category: 'road',
    surface: 'asphalt',
    speedLimit: 50,
    smooth: true,
    lanes: [L('sidewalk', 3), L('parking', 2.2), L('driving', 3.4, -1), L('driving', 3.4, 1), L('parking', 2.2), L('sidewalk', 3)],
  },
  local: {
    label: 'Local street (parking both sides)',
    category: 'road',
    surface: 'asphalt',
    speedLimit: 30,
    smooth: true,
    lanes: [L('sidewalk', 2.5), L('parking', 2.0), L('driving', 3.0, -1), L('driving', 3.0, 1), L('parking', 2.0), L('sidewalk', 2.5)],
  },
  alley: {
    label: 'Alley (one-way, cobbles)',
    category: 'road',
    surface: 'cobble',
    speedLimit: 15,
    smooth: false,
    lanes: [L('shoulder', 0.5), L('driving', 3.0, 1), L('shoulder', 0.5)],
  },
  cycleway: {
    label: 'Cycle path (two-way)',
    category: 'path',
    surface: 'asphalt',
    speedLimit: 20,
    smooth: true,
    lanes: [L('bike', 2.5, -1), L('bike', 2.5, 1)],
  },
  footpath: {
    label: 'Footpath',
    category: 'path',
    surface: 'paving',
    speedLimit: 0,
    smooth: true,
    lanes: [L('pedestrian', 2.5)],
  },
  promenade: {
    label: 'Promenade (curbed)',
    category: 'path',
    surface: 'paving',
    speedLimit: 0,
    smooth: true,
    lanes: [L('sidewalk', 2), L('pedestrian', 4), L('sidewalk', 2)],
  },
  rail: {
    label: 'Railway line',
    category: 'rail',
    surface: 'gravel',
    speedLimit: 120,
    smooth: true,
    lanes: [],
  },
  subway: {
    label: 'Subway line (underground)',
    category: 'subway',
    surface: 'asphalt',
    speedLimit: 80,
    smooth: true,
    lanes: [],
  },
};

export const PROP_INFO: Record<PropKind, { label: string; spacing: number; height: number }> = {
  bollard: { label: 'Bollard', spacing: 1.5, height: 0.9 },
  speedbump: { label: 'Speed bump', spacing: 0, height: 0.09 },
  streetlight: { label: 'Street light', spacing: 35, height: 6.5 },
  busstop: { label: 'Bus stop', spacing: 0, height: 2.9 },
  station: { label: 'Subway entrance', spacing: 0, height: 3.6 },
};

export function roadWidth(road: Pick<Road, 'lanes'>): number {
  return road.lanes.reduce((acc, l) => acc + l.width, 0);
}

/** Lateral bands of the cross-section, left to right, relative to the centreline. */
export function laneBands(lanes: Lane[]): { lane: Lane; index: number; a: number; b: number }[] {
  const out: { lane: Lane; index: number; a: number; b: number }[] = [];
  let x = -roadWidth({ lanes }) / 2;
  lanes.forEach((lane, index) => {
    out.push({ lane, index, a: x, b: x + lane.width });
    x += lane.width;
  });
  return out;
}

let counter = 0;
export function uid(prefix: string): string {
  counter++;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function emptyNetwork(): Network {
  return { format: 'slate-roads', version: 1, roads: [], props: [] };
}

export function makeRoad(presetKey: string, points: V3[], name?: string): Road {
  const p = PRESETS[presetKey] ?? PRESETS.arterial;
  return {
    id: uid('r_'),
    name: name ?? `${p.label.split(' (')[0]} ${uid('').slice(-4)}`,
    category: p.category,
    preset: presetKey in PRESETS ? presetKey : 'arterial',
    surface: p.surface,
    speedLimit: p.speedLimit,
    smooth: p.smooth,
    points: points.map((q) => V(q.x, q.y, q.z)),
    lanes: p.lanes.map((l) => ({ ...l })),
  };
}

/** Validate and normalise untrusted JSON (import). Throws on structural errors. */
export function parseNetwork(raw: unknown): Network {
  if (!raw || typeof raw !== 'object') throw new Error('Not a JSON object');
  const o = raw as Partial<Network>;
  if (o.format !== 'slate-roads' || !Array.isArray(o.roads) || !Array.isArray(o.props)) {
    throw new Error('Not a Slate road network file (format "slate-roads")');
  }
  const roads: Road[] = o.roads.map((r) => {
    const pts = (r.points ?? []).map((p) => V(num(p.x), num(p.y), num(p.z)));
    if (pts.length < 2) throw new Error(`Road ${r.id} needs at least 2 points`);
    return {
      id: String(r.id),
      name: String(r.name ?? r.id),
      category: r.category ?? 'road',
      preset: String(r.preset ?? 'arterial'),
      surface: r.surface ?? 'asphalt',
      speedLimit: num(r.speedLimit ?? 50),
      smooth: r.smooth !== false,
      points: pts,
      lanes: (r.lanes ?? []).map((l) => ({ kind: l.kind, width: num(l.width), dir: (l.dir ?? 0) as -1 | 0 | 1 })),
    };
  });
  const ids = new Set(roads.map((r) => r.id));
  const props: Prop[] = o.props
    .filter((p) => ids.has(p.roadId))
    .map((p) => ({
      id: String(p.id),
      kind: p.kind,
      roadId: p.roadId,
      s: num(p.s),
      length: Math.max(0, num(p.length ?? 0)),
      offset: num(p.offset ?? 0),
    }));
  return { format: 'slate-roads', version: 1, roads, props };
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) throw new Error(`Invalid number: ${String(v)}`);
  return n;
}

