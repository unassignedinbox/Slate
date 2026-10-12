//==================================================================================================
//  ROADEDITOR — CROSS-SECTION LIBRARY
//==================================================================================================
//  A road is a swept cross-section. The cross-section is authored as an ordered list of elements
//  running left to right across the road, with x = 0 at the crown (the point the camber drains
//  away from). Every element emits either a flat ribbon, a vertical face, or both, and records the
//  lane, marking line and prop lines that hang off it.
//
//  Element kinds
//    lane     { t:'lane', kind, w, dir?, fall?, mat?, tint? }   carriageway band (car/bus/bike/
//                                                                parking/shoulder/turn/tram/bus-stop)
//    median   { t:'median', w, mat?, barrier? }                 central reservation, optional barrier
//    kerb     { t:'kerb', w?, h?, mat? }                        upstand + gutter
//    walk     { t:'walk', w, mat?, props? }                     footway / pavement
//    verge    { t:'verge', w, mat?, props? }                    soft verge, ditch shoulder, planted
//    shoulder { t:'shoulder', w, mat? }                         hardened outside the edge line
//    ditch    { t:'ditch', w, d?, mat? }                        drainage ditch (drops then returns)
//    guard    { t:'guard', w?, rail? }                          safety barrier line at the outer edge
//    rail     { t:'rail', w? }                                  embedded tram / light-rail tracks
//==================================================================================================

import { clamp, MAT, DEG } from './core.js';

//--------------------------------------------------------------------------------------------------
//  Tints. The surface shader multiplies material colour by the vertex tint, so these read as the
//  "paint" a city actually puts down: red Dutch cycle asphalt, green bus lanes, pale parking bays.
//--------------------------------------------------------------------------------------------------
export const TINT = {
  asphalt: [1, 1, 1],
  worn: [0.9, 0.9, 0.93],
  concrete: [1, 1, 1],
  bus: [0.42, 0.62, 0.42],
  bike: [0.82, 0.36, 0.28],
  parking: [0.86, 0.86, 0.9],
  shoulder: [1.02, 1.0, 0.96],
  kerb: [1, 1, 1],
  grass: [1, 1, 1],
  dirt: [1, 1, 1],
  railbed: [0.72, 0.72, 0.74],
  // Lane-kind -> surface treatment. A lane can override both.
  laneKind(kind) {
    switch (kind) {
      case 'bus':
      case 'busway':
        return { mat: MAT.ASPHALT, tint: TINT.bus };
      case 'bike':
      case 'cycle':
        return { mat: MAT.ASPHALT, tint: TINT.bike };
      case 'parking':
        return { mat: MAT.ASPHALT, tint: TINT.parking };
      case 'shoulder':
        return { mat: MAT.ASPHALT_LIGHT, tint: TINT.shoulder };
      case 'turn':
        return { mat: MAT.ASPHALT, tint: [0.96, 0.96, 0.96] };
      case 'tram':
        return { mat: MAT.CONCRETE, tint: [0.88, 0.88, 0.86] };
      case 'busstop':
        return { mat: MAT.CONCRETE, tint: [0.95, 0.93, 0.88] };
      default:
        return { mat: MAT.ASPHALT, tint: TINT.asphalt };
    }
  },
};

const lane = (kind, w, extra = {}) => ({ t: 'lane', kind, w, ...extra });
const kerb = (extra = {}) => ({ t: 'kerb', w: 0.28, h: 0.13, ...extra });
const walk = (w = 2.5, extra = {}) => ({ t: 'walk', w, mat: MAT.CONCRETE, ...extra });
const verge = (w = 3, extra = {}) => ({ t: 'verge', w, mat: MAT.GRASS, ...extra });
const shoulder = (w = 1.2, extra = {}) => ({ t: 'shoulder', w, mat: MAT.ASPHALT_LIGHT, ...extra });

//--------------------------------------------------------------------------------------------------
//  The library. `cls` drives default marking style and generator placement rules; `hand` is the
//  driving side (RHT roads drain and mark one way, LHT the other).
//--------------------------------------------------------------------------------------------------
export const PROFILES = {};
function def(p) {
  PROFILES[p.id] = {
    kerbHeight: 0.13,
    camber: 0.025, // m per m crossfall
    hand: 'right',
    bands: [],
    ...p,
  };
  return PROFILES[p.id];
}

// --- Motorways ------------------------------------------------------------------------------------
def({
  id: 'motorway-2x3',
  name: 'Motorway 2 × 3 + shoulders',
  cls: 'motorway',
  speed: 120,
  camber: 0.02,
  bands: [
    shoulder(3.0, { mat: MAT.ASPHALT_LIGHT }),
    lane('car', 3.65), lane('car', 3.65), lane('car', 3.65),
    shoulder(0.6, { mat: MAT.ASPHALT_LIGHT }),
    { t: 'median', w: 4.5, mat: MAT.GRASS, barrier: 'concrete' },
    shoulder(0.6, { mat: MAT.ASPHALT_LIGHT }),
    lane('car', 3.65), lane('car', 3.65), lane('car', 3.65),
    shoulder(3.0, { mat: MAT.ASPHALT_LIGHT }),
  ],
});

def({
  id: 'motorway-2x2',
  name: 'Motorway 2 × 2 + shoulders',
  cls: 'motorway',
  speed: 100,
  camber: 0.02,
  bands: [
    shoulder(2.5),
    lane('car', 3.6), lane('car', 3.6),
    shoulder(0.5),
    { t: 'median', w: 3.0, mat: MAT.GRASS, barrier: 'steel' },
    shoulder(0.5),
    lane('car', 3.6), lane('car', 3.6),
    shoulder(2.5),
  ],
});

def({
  id: 'motorway-ramp',
  name: 'Motorway ramp 1L + shoulders',
  cls: 'ramp',
  speed: 60,
  camber: 0.02,
  bands: [shoulder(1.0), lane('car', 3.7), shoulder(2.0)],
  oneWay: true,
});

def({
  id: 'trunk-2x2-bus',
  name: 'Trunk 2 × 2 + bus lanes',
  cls: 'trunk',
  speed: 80,
  bands: [
    walk(2.0),
    kerb(),
    lane('bike', 2.0),
    kerb({ h: 0.0, w: 0.2 }),
    lane('car', 3.5), lane('bus', 3.5),
    { t: 'median', w: 2.4, mat: MAT.CONCRETE, barrier: 'steel' },
    lane('bus', 3.5), lane('car', 3.5),
    kerb({ h: 0.0, w: 0.2 }),
    lane('bike', 2.0),
    kerb(),
    walk(2.0),
  ],
  busLane: true,
});

// --- Arterials ------------------------------------------------------------------------------------
def({
  id: 'arterial-2x2-complete',
  name: 'Urban arterial 2 × 2 — bus + cycle + parking + footway',
  cls: 'arterial',
  speed: 60,
  bands: [
    verge(2.2, { props: ['lamp'] }),
    kerb(),
    walk(3.0, { props: ['bollard', 'lamp'] }),
    kerb(),
    lane('parking', 2.2),
    lane('bike', 1.8),
    kerb({ h: 0.0, w: 0.2 }),
    lane('car', 3.25), lane('bus', 3.25),
    { t: 'median', w: 1.6, mat: MAT.CONCRETE, barrier: 'none' },
    lane('bus', 3.25), lane('car', 3.25),
    kerb({ h: 0.0, w: 0.2 }),
    lane('bike', 1.8),
    lane('parking', 2.2),
    kerb(),
    walk(3.0, { props: ['bollard', 'lamp'] }),
    kerb(),
    verge(2.2, { props: ['lamp'] }),
  ],
  busLane: true,
  sidewalk: true,
  parking: true,
  cycleway: true,
});

def({
  id: 'arterial-2x2',
  name: 'Urban arterial 2 × 2 + footway',
  cls: 'arterial',
  speed: 60,
  bands: [
    walk(2.5, { props: ['lamp'] }),
    kerb(),
    lane('car', 3.4), lane('car', 3.4),
    { t: 'median', w: 1.2, mat: MAT.CONCRETE },
    lane('car', 3.4), lane('car', 3.4),
    kerb(),
    walk(2.5, { props: ['lamp'] }),
  ],
  sidewalk: true,
});

def({
  id: 'boulevard-tram',
  name: 'Boulevard with central tram reservation',
  cls: 'arterial',
  speed: 50,
  bands: [
    walk(3.6, { props: ['lamp'] }),
    kerb(),
    lane('bike', 2.0),
    lane('parking', 2.1),
    lane('car', 3.2),
    kerb(),
    { t: 'median', w: 2.0, mat: MAT.CONCRETE, props: ['lamp'] },
    { t: 'rail', w: 3.0, dir: 1 },
    { t: 'median', w: 2.0, mat: MAT.CONCRETE, props: ['lamp'] },
    kerb(),
    lane('car', 3.2),
    lane('parking', 2.1),
    lane('bike', 2.0),
    kerb(),
    walk(3.6, { props: ['lamp'] }),
  ],
  tram: true,
  sidewalk: true,
  parking: true,
  cycleway: true,
});

def({
  id: 'arterial-bus-only',
  name: 'Bus transitway (bus-only + footway)',
  cls: 'transit',
  speed: 50,
  bands: [
    walk(2.6),
    kerb(),
    lane('bus', 3.6), lane('bus', 3.6),
    kerb(),
    walk(2.6),
  ],
  busLane: true,
  sidewalk: true,
  oneWay: false,
});

// --- Collectors and local streets ------------------------------------------------------------------
def({
  id: 'collector-1x1-parking',
  name: 'Collector 1 × 1 + parking both sides',
  cls: 'collector',
  speed: 50,
  bands: [
    walk(2.4, { props: ['lamp'] }),
    kerb(),
    lane('parking', 2.1),
    lane('car', 3.3), lane('car', 3.3),
    lane('parking', 2.1),
    kerb(),
    walk(2.4, { props: ['lamp'] }),
  ],
  sidewalk: true,
  parking: true,
});

def({
  id: 'residential-1x1-cycle',
  name: 'Residential 1 × 1 + cycle lane + footway',
  cls: 'local',
  speed: 30,
  bands: [
    verge(1.0, { props: ['tree', 'lamp'] }),
    kerb(),
    walk(2.0, { props: ['bollard'] }),
    kerb(),
    lane('bike', 1.6),
    lane('car', 3.0), lane('car', 3.0),
    lane('bike', 1.6),
    kerb(),
    walk(2.0, { props: ['bollard'] }),
    kerb(),
    verge(1.0, { props: ['tree', 'lamp'] }),
  ],
  sidewalk: true,
  cycleway: true,
  speedBumps: true,
});

def({
  id: 'residential-1x1',
  name: 'Residential 1 × 1 + footway',
  cls: 'local',
  speed: 30,
  bands: [
    kerb(),
    walk(2.2, { props: ['bollard', 'lamp'] }),
    kerb(),
    lane('parking', 2.0),
    lane('car', 3.0), lane('car', 3.0),
    lane('parking', 2.0),
    kerb(),
    walk(2.2, { props: ['bollard', 'lamp'] }),
    kerb(),
  ],
  sidewalk: true,
  parking: true,
  speedBumps: true,
});

def({
  id: 'woonerf',
  name: 'Shared surface / home zone (kerb-less)',
  cls: 'living',
  speed: 20,
  camber: 0.012,
  bands: [
    { t: 'verge', w: 2.0, mat: MAT.PAVER, props: ['bollard', 'tree'] },
    lane('car', 2.6, { fall: -1, mat: MAT.PAVER, tint: [1, 1, 1] }),
    lane('car', 2.6, { fall: -1, mat: MAT.PAVER, tint: [1, 1, 1] }),
    { t: 'verge', w: 2.0, mat: MAT.PAVER, props: ['bollard', 'tree'] },
  ],
  sidewalk: true,
  sharedSurface: true,
  speedBumps: true,
});

def({
  id: 'oneway-narrow',
  name: 'One-way street + parking both sides',
  cls: 'local',
  speed: 30,
  bands: [
    walk(1.8),
    kerb(),
    lane('parking', 1.9),
    lane('car', 2.9, { fall: -1 }),
    lane('car', 2.9, { fall: -1 }),
    lane('parking', 1.9),
    kerb(),
    walk(1.8),
  ],
  oneWay: true,
  sidewalk: true,
  parking: true,
});

def({
  id: 'alley',
  name: 'Service alley / mews',
  cls: 'service',
  speed: 15,
  camber: 0.015,
  bands: [
    { t: 'verge', w: 1.0, mat: MAT.GRAVEL },
    lane('car', 2.8, { mat: MAT.ASPHALT_LIGHT, tint: TINT.worn }),
    { t: 'verge', w: 1.0, mat: MAT.GRAVEL },
  ],
  service: true,
});

// --- Rural, mountain, industrial -------------------------------------------------------------------
def({
  id: 'rural-2lane',
  name: 'Rural road 1 × 1 + verges and ditches',
  cls: 'rural',
  speed: 80,
  camber: 0.03,
  bands: [
    { t: 'verge', w: 3.0, mat: MAT.GRASS },
    shoulder(1.0, { mat: MAT.GRAVEL }),
    lane('car', 3.6), lane('car', 3.6),
    shoulder(1.0, { mat: MAT.GRAVEL }),
    { t: 'ditch', w: 1.6, d: 0.7 },
    { t: 'verge', w: 3.0, mat: MAT.GRASS },
  ],
  rural: true,
});

def({
  id: 'rural-wide',
  name: 'Rural two-way + hard shoulders',
  cls: 'rural',
  speed: 90,
  camber: 0.03,
  bands: [
    { t: 'verge', w: 2.5, mat: MAT.GRASS },
    shoulder(2.0, { mat: MAT.GRAVEL }),
    lane('car', 3.7), lane('car', 3.7),
    shoulder(2.0, { mat: MAT.GRAVEL }),
    { t: 'verge', w: 2.5, mat: MAT.GRASS },
  ],
  rural: true,
});

def({
  id: 'canyon-2lane',
  name: 'Canyon run 1 × 1 + guardrails',
  cls: 'canyon',
  speed: 90,
  camber: 0.03,
  bands: [
    { t: 'guard', w: 0.8, rail: true },
    { t: 'verge', w: 1.2, mat: MAT.GRAVEL },
    lane('car', 3.6), lane('car', 3.6),
    { t: 'verge', w: 1.2, mat: MAT.GRAVEL },
    { t: 'guard', w: 0.8, rail: true },
  ],
  rural: true,
});

def({
  id: 'mountain-2lane',
  name: 'Mountain pass 1 × 1 + rock cut',
  cls: 'canyon',
  speed: 70,
  camber: 0.035,
  bands: [
    { t: 'verge', w: 1.6, mat: MAT.ROCK },
    shoulder(0.8, { mat: MAT.GRAVEL }),
    lane('car', 3.5), lane('car', 3.5),
    shoulder(0.8, { mat: MAT.GRAVEL }),
    { t: 'guard', w: 0.6, rail: true },
  ],
  rural: true,
});

def({
  id: 'gravel-track',
  name: 'Unsealed track',
  cls: 'track',
  speed: 40,
  camber: 0.04,
  bands: [
    { t: 'verge', w: 2.0, mat: MAT.GRASS },
    lane('car', 3.0, { mat: MAT.GRAVEL, tint: [0.95, 0.92, 0.86] }),
    lane('car', 3.0, { mat: MAT.GRAVEL, tint: [0.95, 0.92, 0.86] }),
    { t: 'verge', w: 2.0, mat: MAT.GRASS },
  ],
  rural: true,
});

def({
  id: 'industrial-service',
  name: 'Industrial service road 1 × 1 + hardstands',
  cls: 'service',
  speed: 40,
  bands: [
    shoulder(3.5, { mat: MAT.CONCRETE, tint: [0.94, 0.94, 0.92] }),
    lane('car', 3.8), lane('car', 3.8),
    shoulder(3.5, { mat: MAT.CONCRETE, tint: [0.94, 0.94, 0.92] }),
  ],
  service: true,
  parking: true,
});

def({
  id: 'two-way-bus-only',
  name: 'Bus-only street + bike lane',
  cls: 'transit',
  speed: 30,
  bands: [
    walk(2.2),
    kerb(),
    lane('bike', 1.8),
    lane('bus', 3.5), lane('bus', 3.5),
    lane('bike', 1.8),
    kerb(),
    walk(2.2),
  ],
  busLane: true,
  cycleway: true,
  sidewalk: true,
});

// --- Roundabouts, ramps, grade separations ---------------------------------------------------------
def({
  id: 'roundabout-1x1',
  name: 'Roundabout carriageway (1 lane)',
  cls: 'roundabout',
  speed: 40,
  camber: 0.02,
  bands: [
    { t: 'apron', w: 0.0 },
    lane('car', 5.2, { fall: 1 }),
    { t: 'kerb', w: 0.3, h: 0.15 },
    { t: 'verge', w: 0.0, mat: MAT.GRASS },
  ],
  roundabout: true,
  oneWay: true,
});

def({
  id: 'roundabout-2lane',
  name: 'Roundabout carriageway (2 lane)',
  cls: 'roundabout',
  speed: 40,
  camber: 0.02,
  bands: [
    { t: 'apron', w: 0.0 },
    lane('car', 4.6, { fall: 1 }), lane('car', 4.6, { fall: 1 }),
    { t: 'kerb', w: 0.3, h: 0.15 },
    { t: 'verge', w: 0.0, mat: MAT.GRASS },
  ],
  roundabout: true,
  oneWay: true,
});

def({
  id: 'bridge-deck',
  name: 'Bridge deck 1 × 1 + parapets',
  cls: 'bridge',
  speed: 50,
  camber: 0.02,
  bands: [
    { t: 'guard', w: 0.5, rail: true },
    walk(1.6, { mat: MAT.CONCRETE }),
    kerb(),
    lane('car', 3.5), lane('car', 3.5),
    kerb(),
    walk(1.6, { mat: MAT.CONCRETE }),
    { t: 'guard', w: 0.5, rail: true },
  ],
  bridge: true,
  sidewalk: true,
});

// --- Pathways --------------------------------------------------------------------------------------
def({
  id: 'footpath',
  name: 'Footpath (2.0 m)',
  cls: 'footway',
  speed: 10,
  camber: 0.02,
  bands: [verge(0.5, { mat: MAT.GRASS }), { t: 'walk', w: 2.0, mat: MAT.CONCRETE, props: [] }, verge(0.5, { mat: MAT.GRASS })],
  sidewalk: true,
  path: true,
  oneWay: false,
});

def({
  id: 'cycleway',
  name: 'Cycle superhighway (2-way, 4.0 m)',
  cls: 'cycleway',
  speed: 25,
  camber: 0.02,
  bands: [
    verge(0.6, { mat: MAT.GRASS }),
    lane('bike', 2.0, { mat: MAT.ASPHALT, tint: [0.85, 0.4, 0.32] }),
    lane('bike', 2.0, { mat: MAT.ASPHALT, tint: [0.85, 0.4, 0.32] }),
    verge(0.6, { mat: MAT.GRASS }),
  ],
  path: true,
  cycleway: true,
});

def({
  id: 'promenade',
  name: 'Waterfront promenade (pavers)',
  cls: 'footway',
  speed: 10,
  camber: 0.015,
  bands: [
    { t: 'guard', w: 0.4, rail: true },
    { t: 'walk', w: 6.0, mat: MAT.PAVER, props: ['lamp', 'bollard'] },
    { t: 'verge', w: 1.2, mat: MAT.SAND },
  ],
  path: true,
  sidewalk: true,
});

//--------------------------------------------------------------------------------------------------
//  Section builder. Walks the element list and produces:
//    points[]   cross-section vertices { x, z, n (lateral/vertical normal), mat, tint, tag, band }
//    ribbons[]  index pairs that become swept quad strips
//    lanes[]    carriageway bands with their direction, for markings and junction connectors
//    lines[]    painted lines with a style and lateral offset
//    props[]    prop lines with spacing
//--------------------------------------------------------------------------------------------------
export function buildSection(profile) {
  const camber = profile.camber ?? 0.025;
  const kerbH = profile.kerbHeight ?? 0.13;
  const bands = profile.bands;
  const points = [];
  const ribbons = [];
  const lanes = [];
  const lines = [];
  const props = [];
  const bandGeom = [];

  const total = bands.reduce((s, b) => s + (b.w || 0), 0);
  let x = -total / 2;
  let z = 0;

  const pushPoint = (px, pz, nx, nz, mat, tint, tag, band, extra = {}) => {
    points.push({ x: px, z: pz, nx, nz, mat, tint: tint || [1, 1, 1], tag, band, ...extra });
    return points.length - 1;
  };

  // The camber falls away from x = 0 (the crown). An element may force a direction.
  const fallOf = (mid, el) => (el.fall !== undefined ? el.fall : mid < 0 ? -1 : 1);

  let prevTop = null; // last surface point index at the running surface height

  for (let bi = 0; bi < bands.length; bi++) {
    const el = bands[bi];
    const w = el.w ?? 0;
    const mid = x + w / 2;
    const bandInfo = { band: bi, el, x0: x, x1: x + w, z0: z, z1: z };
    const startZ = z;

    if (el.t === 'kerb') {
      const kw = el.w ?? 0.28;
      const h = el.h ?? kerbH;
      const mat = el.mat ?? MAT.CONCRETE;
      // Gutter (flat, no rise) then the upstand then the kerb top.
      const gx = x;
      const gz = z;
      const i0 = prevTop !== null && Math.abs(points[prevTop].x - gx) < 1e-6 ? prevTop : pushPoint(gx, gz, 0, 1, mat, [1, 1, 1], 'kerb-foot', bi);
      const i1 = pushPoint(gx, gz + h, 1, 0, mat, [1, 1, 1], 'kerb-face-top', bi, { face: true });
      ribbons.push({ a: i0, b: i1, face: true, mat, band: bi, tag: 'kerb-face' });
      const i2 = pushPoint(gx + kw, gz + h, 0, 1, mat, [1, 1, 1], 'kerb-top', bi);
      ribbons.push({ a: i1, b: i2, face: false, mat, band: bi, tag: 'kerb-top' });
      x += kw;
      z = gz + h;
      prevTop = i2;
      bandInfo.z1 = z;
      bandGeom.push({ ...bandInfo, kind: 'kerb', points: [i0, i1, i2], top: i2 });
      // Kerb is where bollards, drainage and crossing gaps live.
      if (!el.drop) props.push({ x: gx + kw * 0.5, z: z, kind: 'kerb', band: bi, spacing: 0 });
      continue;
    }

    if (el.t === 'ditch') {
      const mat = el.mat ?? MAT.GRASS;
      const d = el.d ?? 0.6;
      const i0 = pushPoint(x, z, 0, 1, mat, [1, 1, 1], 'ditch-in', bi);
      const i1 = pushPoint(x + w * 0.5, z - d, 0.7, 0.7, mat, [1, 1, 1], 'ditch-bottom', bi);
      const i2 = pushPoint(x + w, z, 0, 1, mat, [1, 1, 1], 'ditch-out', bi);
      ribbons.push({ a: i0, b: i1, mat, band: bi, tag: 'ditch' });
      ribbons.push({ a: i1, b: i2, mat, band: bi, tag: 'ditch' });
      x += w;
      z = startZ;
      prevTop = i2;
      bandGeom.push({ ...bandInfo, kind: 'ditch', points: [i0, i1, i2], top: i2 });
      continue;
    }

    if (el.t === 'median') {
      const mat = el.mat ?? MAT.CONCRETE;
      const dir = mid < 0 ? -1 : mid > 0 ? 1 : 1;
      // A median is crowned at its own centre when it straddles the crown.
      const half = w / 2;
      const i0 = prevTop !== null && Math.abs(points[prevTop].x - x) < 1e-6 ? prevTop : pushPoint(x, z, 0, 1, mat, [1, 1, 1], 'median-in', bi);
      let zc = z + half * camber * (Math.abs(x) < half ? 1 : 0);
      const xc = x + half;
      const ic = pushPoint(xc, zc, 0, 1, mat, [1, 1, 1], 'median-crown', bi);
      const i1 = pushPoint(x + w, zc - half * camber, 0, 1, mat, [1, 1, 1], 'median-out', bi);
      ribbons.push({ a: i0, b: ic, mat, band: bi, tag: 'median' });
      ribbons.push({ a: ic, b: i1, mat, band: bi, tag: 'median' });
      x += w;
      z = points[i1].z;
      prevTop = i1;
      bandGeom.push({ ...bandInfo, kind: 'median', points: [i0, ic, i1], top: i1, barrier: el.barrier });
      if (el.barrier && el.barrier !== 'none') props.push({ x: xc, z: zc, kind: el.barrier === 'concrete' ? 'barrier-concrete' : 'barrier-steel', band: bi, spacing: 'continuous' });
      for (const p of el.props || []) props.push({ x: xc, z: zc, kind: p, band: bi, spacing: 0 });
      continue;
    }

    if (el.t === 'rail') {
      const mat = MAT.CONCRETE;
      const i0 = prevTop !== null && Math.abs(points[prevTop].x - x) < 1e-6 ? prevTop : pushPoint(x, z, 0, 1, mat, [0.9, 0.9, 0.9], 'railbed-in', bi);
      const i1 = pushPoint(x + w, z, 0, 1, mat, [0.9, 0.9, 0.9], 'railbed-out', bi);
      ribbons.push({ a: i0, b: i1, mat, band: bi, tag: 'trambed' });
      bandGeom.push({ ...bandInfo, kind: 'rail', points: [i0, i1], top: i1, dir: el.dir ?? 1 });
      props.push({ x: x + w / 2, z, kind: 'tram-track', band: bi, spacing: 'continuous' });
      x += w;
      prevTop = i1;
      continue;
    }

    if (el.t === 'guard') {
      const gx = x + w / 2;
      props.push({ x: gx, z, kind: el.rail === false ? 'guardpost' : 'guardrail', band: bi, spacing: 2.0 });
      bandGeom.push({ ...bandInfo, kind: 'guard' });
      x += w;
      continue;
    }

    if (el.t === 'apron') {
      // Truck apron of a roundabout: rises gently to the kerb of the central island.
      bandGeom.push({ ...bandInfo, kind: 'apron' });
      continue;
    }

    // Default: a flat band (lane, walk, verge, shoulder, parking...).
    const fall = el.fall !== undefined ? el.fall : fallOf(mid, el);
    const dz = -fall * w * camber;
    const kindMeta = el.t === 'lane' ? TINT.laneKind(el.kind) : { mat: el.mat ?? MAT.CONCRETE, tint: el.tint ?? [1, 1, 1] };
    const mat = el.mat ?? kindMeta.mat;
    const tint = el.tint ?? kindMeta.tint;
    const nrm = { nx: 0, nz: 1 };
    const i0 = prevTop !== null && Math.abs(points[prevTop].x - x) < 1e-6 ? prevTop : pushPoint(x, z, nrm.nx, nrm.nz, mat, tint, 'band-in', bi);
    const i1 = pushPoint(x + w, z + dz, nrm.nx, nrm.nz, mat, tint, 'band-out', bi);
    const dir = el.dir ?? (mid < 0 ? -1 : mid > 0 ? 1 : 1);
    ribbons.push({ a: i0, b: i1, mat, band: bi, tag: el.t, laneKind: el.kind, dir, tint });
    x += w;
    z += dz;
    prevTop = i1;
    bandGeom.push({ ...bandInfo, kind: el.t, points: [i0, i1], top: i1, mat, tint, dir, z0: startZ, z1: z });
    if (el.t === 'lane') {
      lanes.push({ band: bi, idx: lanes.length, kind: el.kind, dir, w, x0: bandInfo.x0, x1: bandInfo.x1, mat, tint });
    }
    for (const p of el.props || []) props.push({ x: x - w / 2, z: z + 0.0, kind: p, band: bi, spacing: 0 });
  }

  // Painted lines: edge lines, lane dividers, centre lines, bike and bus lane boundaries.
  const laneBands = lanes.slice().sort((a, b) => a.x0 - b.x0);
  for (let i = 0; i < laneBands.length; i++) {
    const l = laneBands[i];
    const prev = laneBands[i - 1];
    if (!prev) {
      lines.push({ x: l.x0 + 0.18, style: edgeStyle(profile), side: -1 });
      lines.push({ x: l.x0 - 0.18 + 0.36, style: 'none', side: -1 });
    }
    if (prev) {
      const sameDir = prev.dir === l.dir;
      const boundaryIsBay = l.kind === 'parking' || prev.kind === 'parking';
      const boundaryBike = l.kind === 'bike' || prev.kind === 'bike';
      const boundaryBus = l.kind === 'bus' || prev.kind === 'bus';
      let style = sameDir ? 'dashed-white' : centreStyle(profile);
      if (boundaryIsBay) style = 'solid-white';
      if (boundaryBike) style = 'solid-white';
      if (boundaryBus && sameDir) style = 'dashed-white';
      if (l.x0 - prev.x1 > 0.6) style = 'none'; // a separated element sits between them
      lines.push({ x: (prev.x1 + l.x0) / 2, style, side: sameDir ? 1 : -1 });
    }
    if (i === laneBands.length - 1) lines.push({ x: l.x1 - 0.18, style: edgeStyle(profile), side: 1 });
  }

  const minX = points.reduce((m, p) => Math.min(m, p.x), 0);
  const maxX = points.reduce((m, p) => Math.max(m, p.x), 0);
  return {
    profile,
    points,
    ribbons,
    lanes,
    lines,
    props,
    bands: bandGeom,
    leftEdge: minX,
    rightEdge: maxX,
    halfLeft: -minX,
    halfRight: maxX,
    width: maxX - minX,
    carriageway: lanes.length ? { from: Math.min(...lanes.map((l) => l.x0)), to: Math.max(...lanes.map((l) => l.x1)) } : { from: 0, to: 0 },
    walkBands: bandGeom.filter((b) => b.kind === 'walk'),
    kerbBands: bandGeom.filter((b) => b.kind === 'kerb'),
    hasSidewalk: bandGeom.some((b) => b.kind === 'walk'),
    surfaceZ0: 0,
  };
}

function edgeStyle(profile) {
  if (profile.rural || profile.cls === 'rural' || profile.cls === 'canyon') return 'edge-white';
  if (profile.cls === 'motorway' || profile.cls === 'trunk' || profile.cls === 'ramp') return 'edge-white';
  return 'edge-white';
}

function centreStyle(profile) {
  if (profile.cls === 'rural' || profile.cls === 'canyon') return 'double-yellow';
  if (profile.cls === 'motorway' || profile.cls === 'trunk') return 'barrier';
  if (profile.speed >= 60) return 'solid-yellow';
  return 'dashed-white';
}

/**
 * Built sections are cached on the profile definition. Every consumer asks for the section, never
 * the raw element list, so a road's width, lanes, kerb lines and marking plan are computed once.
 */
export function sectionOf(profile) {
  if (!profile._section) profile._section = buildSection(profile);
  return profile._section;
}
export function halfWidthOf(profile) {
  const s = sectionOf(profile);
  return Math.max(s.halfLeft, s.halfRight);
}

/** Ordered profile ids for the library panel. */
export const PROFILE_ORDER = [
  'motorway-2x3',
  'motorway-2x2',
  'motorway-ramp',
  'trunk-2x2-bus',
  'arterial-2x2-complete',
  'arterial-2x2',
  'boulevard-tram',
  'arterial-bus-only',
  'collector-1x1-parking',
  'residential-1x1-cycle',
  'residential-1x1',
  'woonerf',
  'oneway-narrow',
  'alley',
  'rural-2lane',
  'rural-wide',
  'canyon-2lane',
  'mountain-2lane',
  'gravel-track',
  'industrial-service',
  'two-way-bus-only',
  'roundabout-1x1',
  'roundabout-2lane',
  'bridge-deck',
  'footpath',
  'cycleway',
  'promenade',
];

/** Road class -> default profile, used by the generator when a district asks for a class. */
export const CLASS_DEFAULT = {
  motorway: 'motorway-2x3',
  trunk: 'trunk-2x2-bus',
  arterial: 'arterial-2x2-complete',
  collector: 'collector-1x1-parking',
  local: 'residential-1x1-cycle',
  living: 'woonerf',
  service: 'industrial-service',
  alley: 'alley',
  rural: 'rural-2lane',
  canyon: 'canyon-2lane',
  track: 'gravel-track',
  ramp: 'motorway-ramp',
  roundabout: 'roundabout-1x1',
  bridge: 'bridge-deck',
  footway: 'footpath',
  cycleway: 'cycleway',
  transit: 'arterial-bus-only',
};

export const CLASS_ORDER = ['local', 'alley', 'service', 'collector', 'arterial', 'trunk', 'motorway', 'ramp', 'rural', 'canyon', 'track', 'footway', 'cycleway', 'living', 'transit'];
export const CLASS_FAMILY = {
  motorway: 6,
  trunk: 5,
  arterial: 4,
  transit: 4,
  collector: 3,
  industrial: 3,
  local: 2,
  living: 1,
  alley: 1,
  service: 1,
  rural: 3,
  canyon: 2,
  track: 1,
  footway: 0,
  cycleway: 0,
  ramp: 5,
};
