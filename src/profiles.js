// Road cross-section profiles — every class of road you find in the world.
// Bands run LEFT -> RIGHT when looking along the travel direction.
// Offsets are computed from the band list; lanes left of centre run against
// the segment direction (right-hand traffic), lanes right of centre with it.

export const BAND = {
  sidewalk: { label: 'Sidewalk / Paving', color: '#8a8c93', y: 0.15, mat: 'paving' },
  curb: { label: 'Curb', color: '#9a9a9a', y: 0.15, mat: 'curb' },
  mountable: { label: 'Mountable curb', color: '#8e8e8e', y: 0.08, mat: 'curb' },
  drive: { label: 'Driving lane', color: '#4b4e55', y: 0, mat: 'asphalt' },
  bus: { label: 'Bus lane', color: '#6b4a42', y: 0, mat: 'asphaltBus' },
  cycle: { label: 'Cycle lane', color: '#3f5747', y: 0, mat: 'asphaltCycle' },
  parking: { label: 'Parking lane', color: '#55585f', y: 0, mat: 'asphalt' },
  tram: { label: 'Tram track bed', color: '#5a5148', y: -0.04, mat: 'ballast' },
  median: { label: 'Median', color: '#4e5c47', y: 0.12, mat: 'grass' },
  verge: { label: 'Grass verge', color: '#4e5c47', y: 0.1, mat: 'grass' },
  shoulder: { label: 'Hard shoulder', color: '#55585f', y: 0, mat: 'asphalt' },
  platform: { label: 'Tram platform', color: '#8a8c93', y: 0.2, mat: 'paving' },
};

/** Which bands are travelled surfaces (receive markings, define directions). */
export const TRAVEL = new Set(['drive', 'bus', 'cycle', 'parking', 'tram', 'shoulder']);

const S = (t, w) => ({ t, w });

export const PROFILES = {
  motorway: {
    name: 'Motorway / Highway',
    category: 'High speed',
    icon: 'Route',
    desc: 'Dual carriageway · hard shoulders · central barrier',
    speedLimit: 110,
    bands: [S('verge', 2.5), S('shoulder', 2.6), S('drive', 3.65), S('drive', 3.65), S('median', 2.6), S('drive', 3.65), S('drive', 3.65), S('shoulder', 2.6), S('verge', 2.5)],
    markings: { center: 'barrier', edge: true, crosswalk: false },
    barrier: true,
    curbStyle: 'barrier',
  },
  highwayRamp: {
    name: 'Highway ramp',
    category: 'High speed',
    icon: 'TrendingUp',
    desc: 'Single-lane slip road with shoulders',
    speedLimit: 60,
    bands: [S('verge', 1.6), S('shoulder', 1.6), S('drive', 4.4), S('shoulder', 1.6), S('verge', 1.6)],
    markings: { center: 'none', edge: true, crosswalk: false },
    oneWay: true,
    curbStyle: 'mountable',
  },
  boulevard: {
    name: 'Boulevard',
    category: 'City streets',
    icon: 'Trees',
    desc: 'Bus lanes · cycle tracks · parking · wide paving',
    speedLimit: 50,
    bands: [
      S('sidewalk', 3.2), S('curb', 0.24), S('parking', 2.3), S('cycle', 1.9), S('bus', 3.35),
      S('drive', 3.3), S('median', 2.2), S('drive', 3.3), S('bus', 3.35), S('cycle', 1.9),
      S('parking', 2.3), S('curb', 0.24), S('sidewalk', 3.2),
    ],
    markings: { center: 'double-yellow', edge: true, crosswalk: true },
    curbStyle: 'stone',
  },
  avenue: {
    name: 'Avenue',
    category: 'City streets',
    icon: 'Building2',
    desc: 'Four lanes · parking · cycle lanes both ways',
    speedLimit: 50,
    bands: [
      S('sidewalk', 2.6), S('curb', 0.24), S('parking', 2.25), S('cycle', 1.9),
      S('drive', 3.3), S('drive', 3.3), S('drive', 3.3), S('drive', 3.3),
      S('cycle', 1.9), S('parking', 2.25), S('curb', 0.24), S('sidewalk', 2.6),
    ],
    markings: { center: 'double-yellow', edge: true, crosswalk: true },
    curbStyle: 'rounded',
  },
  street: {
    name: 'City street',
    category: 'City streets',
    icon: 'Signpost',
    desc: 'Two lanes · parking · sidewalks',
    speedLimit: 40,
    bands: [
      S('sidewalk', 2.1), S('curb', 0.24), S('parking', 2.2), S('drive', 3.2), S('drive', 3.2),
      S('parking', 2.2), S('curb', 0.24), S('sidewalk', 2.1),
    ],
    markings: { center: 'double-yellow', edge: true, crosswalk: true },
    curbStyle: 'rounded',
  },
  local: {
    name: 'Local street',
    category: 'City streets',
    icon: 'Home',
    desc: 'Quiet two-lane street with paving',
    speedLimit: 30,
    bands: [
      S('sidewalk', 1.9), S('curb', 0.22), S('drive', 3.0), S('drive', 3.0), S('curb', 0.22),
      S('sidewalk', 1.9),
    ],
    markings: { center: 'dashed-white', edge: true, crosswalk: true },
    curbStyle: 'barrier',
  },
  alley: {
    name: 'Alley / Service lane',
    category: 'City streets',
    icon: 'Fence',
    desc: 'Shared surface · mountable curbs · no markings',
    speedLimit: 20,
    bands: [S('mountable', 0.5), S('drive', 3.1), S('drive', 3.1), S('mountable', 0.5)],
    markings: { center: 'none', edge: false, crosswalk: false },
    curbStyle: 'mountable',
  },
  pedestrian: {
    name: 'Pedestrian street',
    category: 'Slow & shared',
    icon: 'Footprints',
    desc: 'Full paving · bollard protected · shared space',
    speedLimit: 15,
    bands: [S('sidewalk', 5), S('sidewalk', 5)],
    markings: { center: 'none', edge: false, crosswalk: false },
    pedestrian: true,
    curbStyle: 'mountable',
  },
  pathway: {
    name: 'Pathway / Walkway',
    category: 'Slow & shared',
    icon: 'Footprints',
    desc: 'Park pathway through green space',
    speedLimit: 10,
    bands: [S('sidewalk', 2.4)],
    markings: { center: 'none', edge: false, crosswalk: false },
    pedestrian: true,
    curbStyle: 'barrier',
  },
  cycleway: {
    name: 'Cycleway',
    category: 'Slow & shared',
    icon: 'Bike',
    desc: 'Dedicated two-way cycle track',
    speedLimit: 25,
    bands: [S('cycle', 1.6), S('cycle', 1.6)],
    markings: { center: 'dashed-white', edge: true, crosswalk: false },
    curbStyle: 'barrier',
  },
  busway: {
    name: 'Busway',
    category: 'Transit',
    icon: 'Bus',
    desc: 'Bus-only running way with platforms',
    speedLimit: 50,
    bands: [S('sidewalk', 2.2), S('curb', 0.24), S('bus', 3.5), S('bus', 3.5), S('curb', 0.24), S('sidewalk', 2.2)],
    markings: { center: 'dashed-white', edge: true, crosswalk: true },
    oneWay: false,
    curbStyle: 'barrier',
  },
  tramStreet: {
    name: 'Tram street',
    category: 'Transit',
    icon: 'TramFront',
    desc: 'Tram tracks set in the carriageway',
    speedLimit: 40,
    bands: [
      S('sidewalk', 2.3), S('curb', 0.22), S('tram', 3.4), S('drive', 3.1), S('drive', 3.1),
      S('tram', 3.4), S('curb', 0.22), S('sidewalk', 2.3),
    ],
    markings: { center: 'dashed-white', edge: true, crosswalk: true },
    tram: true,
    curbStyle: 'stone',
  },
  service: {
    name: 'Service road',
    category: 'City streets',
    icon: 'Warehouse',
    desc: 'Access lane · verge edges · single carriageway',
    speedLimit: 30,
    bands: [S('verge', 1.4), S('curb', 0.22), S('drive', 3.5), S('drive', 3.5), S('curb', 0.22), S('verge', 1.4)],
    markings: { center: 'dashed-white', edge: true, crosswalk: false },
    curbStyle: 'barrier',
  },
  waterfront: {
    name: 'Waterfront promenade',
    category: 'Slow & shared',
    icon: 'Waves',
    desc: 'Paved promenade with cycle strip',
    speedLimit: 20,
    bands: [S('sidewalk', 3.4), S('curb', 0.22), S('cycle', 2.1), S('curb', 0.22), S('sidewalk', 3.4)],
    markings: { center: 'dashed-white', edge: true, crosswalk: false },
    pedestrian: true,
    curbStyle: 'barrier',
  },
  circuit: {
    name: 'Race circuit',
    category: 'High speed',
    icon: 'Flag',
    desc: 'Wide racing asphalt · runoff verges · no curbs',
    speedLimit: 200,
    bands: [S('verge', 4), S('shoulder', 2.2), S('drive', 6.2), S('drive', 6.2), S('shoulder', 2.2), S('verge', 4)],
    markings: { center: 'dashed-white', edge: true, crosswalk: false },
    curbStyle: 'none',
  },
};

export const PROFILE_CATEGORIES = [...new Set(Object.values(PROFILES).map((p) => p.category))];

/** Total paved width of a profile. */
export function profileWidth(profile) {
  return profile.bands.reduce((a, b) => a + b.w, 0);
}

/**
 * Lay out bands -> [{type, width, x0, x1, center, dir}] where x runs left(-)
 * to right(+) from the centreline, dir is +1 with the segment direction.
 */
export function layoutBands(profile) {
  const bands = profile.bands;
  const total = profileWidth(profile);
  let x = -total / 2;
  const out = [];
  for (const b of bands) {
    const x0 = x;
    const x1 = x + b.w;
    const center = (x0 + x1) / 2;
    let dir = 0;
    if (TRAVEL.has(b.t)) dir = profile.oneWay ? 1 : center > 0.001 ? 1 : center < -0.001 ? -1 : 1;
    out.push({ ...b, x0, x1, center, dir });
    x = x1;
  }
  return out;
}

/**
 * Marking boundaries between consecutive bands: [{x, style, laneDash}]
 * style: 'center-double'|'center-single'|'center-dashed'|'solid'|'dash'|'none'
 */
export function markingBoundaries(profile, layout) {
  const out = [];
  for (let i = 1; i < layout.length; i++) {
    const a = layout[i - 1];
    const b = layout[i];
    const x = a.x1;
    const aTravel = TRAVEL.has(a.t);
    const bTravel = TRAVEL.has(b.t);
    if (aTravel && bTravel) {
      if (a.dir !== b.dir) {
        const c = profile.markings.center;
        if (c === 'double-yellow') out.push({ x, style: 'center-double' });
        else if (c === 'single-yellow') out.push({ x, style: 'center-single' });
        else if (c === 'dashed-white') out.push({ x, style: 'center-dashed' });
        else if (c === 'solid-white') out.push({ x, style: 'solid', yellow: true });
        // 'barrier' and 'none' draw nothing here
      } else if (a.t === 'parking' || b.t === 'parking') {
        out.push({ x, style: 'dash' });
      } else if (a.t === 'cycle' || b.t === 'cycle') {
        out.push({ x, style: 'solid' });
      } else if (a.t === 'bus' || b.t === 'bus') {
        out.push({ x, style: 'solid' });
      } else {
        out.push({ x, style: 'dash' });
      }
    } else if (aTravel !== bTravel) {
      const other = aTravel ? b : a;
      if (other.t === 'curb' || other.t === 'mountable') {
        if (profile.markings.edge) out.push({ x, style: 'solid' });
      } else if (other.t === 'median' || other.t === 'verge') {
        out.push({ x, style: 'solid' });
      }
    }
  }
  return out;
}
