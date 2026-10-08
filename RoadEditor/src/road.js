// road.js — road ribbon geometry, project serialization and presets for the
// Frontier road editor. Pure functions only (no DOM, no three.js): the mesh
// builders return plain typed arrays that main.js turns into BufferGeometry.
// Units: meters, Y-up. Banking sign convention (verified in tests): with the
// right-hand vector R = (tz, 0, -tx), a LEFT turn has positive curvature, and
// the cross slope rises toward the right (outside of the curve).

import {
  clamp, lerp, sampleCenterline, applyElevation, computeStats,
  validateRoad, seededRandom,
} from './spline.js';

export const defaultRoadParams = {
  width: 7,          // asphalt width, meters
  lanes: 2,          // 1..4
  shoulderWidth: 1.5,// meters per side
  banking: 60,       // % of the max bank angle applied on curves
  maxBankAngle: 8,   // degrees of cross slope at full banking
  smoothing: 65,     // 0 = polyline, 100 = full Catmull-Rom
  sampleLength: 2,   // station spacing along the centerline, meters
  markings: true,    // lane markings
  closed: false,     // closed loop
  elevation: 'follow', // follow | flat | grade
  rideHeight: 0.15,  // asphalt height above the terrain, meters
};

export const ELEVATION_MODES = ['follow', 'flat', 'grade'];

export function sanitizeParams(input = {}) {
  const num = (v, fallback) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  return {
    width: clamp(num(input.width, defaultRoadParams.width), 2, 30),
    lanes: clamp(Math.round(num(input.lanes, defaultRoadParams.lanes)), 1, 4),
    shoulderWidth: clamp(num(input.shoulderWidth, defaultRoadParams.shoulderWidth), 0, 5),
    banking: clamp(num(input.banking, defaultRoadParams.banking), 0, 100),
    maxBankAngle: clamp(num(input.maxBankAngle, defaultRoadParams.maxBankAngle), 0, 15),
    smoothing: clamp(num(input.smoothing, defaultRoadParams.smoothing), 0, 100),
    sampleLength: clamp(num(input.sampleLength, defaultRoadParams.sampleLength), 0.5, 20),
    markings: input.markings !== false,
    closed: !!input.closed,
    elevation: ELEVATION_MODES.includes(input.elevation) ? input.elevation : 'follow',
    rideHeight: clamp(num(input.rideHeight, defaultRoadParams.rideHeight), 0, 5),
  };
}

// Sample the full road: centerline stations with elevations applied.
export function sampleRoad(points, params, heightFn = () => 0) {
  const p = sanitizeParams(params);
  const stations = sampleCenterline(points, {
    closed: p.closed,
    smoothing: p.smoothing / 100,
    sampleLength: p.sampleLength,
  });
  applyElevation(stations, p.elevation, {
    heightFn,
    rideHeight: p.rideHeight,
    flatY: points.length ? points[0].y ?? 0 : 0,
  });
  return stations;
}

// Per-station bank cross slope (rise per meter toward the right vector).
function bankSlope(station, params) {
  const e = Math.tan((clamp(params.maxBankAngle, 0, 15) * Math.PI) / 180) * (clamp(params.banking, 0, 100) / 100);
  const f = clamp(Math.abs(station.curv) * 60, 0, 1); // fully banked by ~60 m radius
  return Math.sign(station.curv || 0) * e * f;
}

// Build a triangle strip between two signed offsets (along the right vector)
// of the centerline. offA/offB/yA/yB are per-station functions.
function buildStrip(stations, closed, offA, offB, yA, yB) {
  const n = stations.length;
  if (n < 2) return { positions: new Float32Array(0), uvs: new Float32Array(0), indices: new Uint32Array(0) };
  const positions = new Float32Array(n * 2 * 3);
  const uvs = new Float32Array(n * 2 * 2);
  for (let i = 0; i < n; i++) {
    const st = stations[i];
    const rx = st.tz, rz = -st.tx; // right = up x tangent
    const a = offA(st, i), b = offB(st, i);
    positions[i * 6 + 0] = st.x + rx * a;
    positions[i * 6 + 1] = yA(st, i);
    positions[i * 6 + 2] = st.z + rz * a;
    positions[i * 6 + 3] = st.x + rx * b;
    positions[i * 6 + 4] = yB(st, i);
    positions[i * 6 + 5] = st.z + rz * b;
    uvs[i * 4 + 0] = st.arc; uvs[i * 4 + 1] = a;
    uvs[i * 4 + 2] = st.arc; uvs[i * 4 + 3] = b;
  }
  const quadCount = closed ? n : n - 1;
  const indices = new Uint32Array(quadCount * 6);
  let k = 0;
  for (let i = 0; i < quadCount; i++) {
    const j = (i + 1) % n;
    const a = i * 2, b = i * 2 + 1, c = j * 2, d = j * 2 + 1;
    // Winding chosen so faces point up (+Y) for a left-to-right strip.
    indices[k++] = a; indices[k++] = c; indices[k++] = b;
    indices[k++] = b; indices[k++] = c; indices[k++] = d;
  }
  return { positions, uvs, indices };
}

// Interpolate a station at an arbitrary arc length (for dash segments).
function stationAtArc(stations, arc) {
  const last = stations[stations.length - 1];
  if (arc <= 0) return { ...stations[0] };
  if (arc >= last.arc) return { ...last };
  let lo = 0, hi = stations.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (stations[mid].arc < arc) lo = mid; else hi = mid;
  }
  const a = stations[lo], b = stations[hi];
  const t = (arc - a.arc) / Math.max(1e-9, b.arc - a.arc);
  return {
    x: lerp(a.x, b.x, t), z: lerp(a.z, b.z, t), y: lerp(a.y, b.y, t),
    arc, tx: lerp(a.tx, b.tx, t), tz: lerp(a.tz, b.tz, t),
    curv: lerp(a.curv, b.curv, t),
  };
}

const MARK_RAISE = 0.03;   // markings float above the asphalt to avoid z-fighting
const EDGE_INSET = 0.25;   // edge line distance from the asphalt edge
const LINE_WIDTH = 0.18;
const DASH_LENGTH = 3;
const DASH_GAP = 4.5;

// Build all road mesh data from sampled stations. Returns plain typed arrays:
// { asphalt, shoulder, markEdges, markDividers, centerline, stats }.
export function buildRoadMeshData(stations, params) {
  const p = sanitizeParams(params);
  const empty = {
    asphalt: { positions: new Float32Array(0), uvs: new Float32Array(0), indices: new Uint32Array(0) },
    shoulder: { positions: new Float32Array(0), uvs: new Float32Array(0), indices: new Uint32Array(0) },
    markEdges: { positions: new Float32Array(0), uvs: new Float32Array(0), indices: new Uint32Array(0) },
    markDividers: { positions: new Float32Array(0), uvs: new Float32Array(0), indices: new Uint32Array(0) },
    centerline: [],
    stats: computeStats(stations, { closed: p.closed }),
  };
  if (!stations || stations.length < 2) return empty;

  const halfW = p.width / 2;
  const sh = p.shoulderWidth;
  const slopeAt = (st) => bankSlope(st, p);
  const surfaceY = (st, offset) => st.y + slopeAt(st) * offset;

  // Asphalt ribbon: -halfW .. +halfW, rotated by the bank slope.
  const asphalt = buildStrip(
    stations, p.closed,
    () => -halfW, () => halfW,
    (st) => surfaceY(st, -halfW), (st) => surfaceY(st, halfW),
  );

  // Shoulders continue the same cross slope outward.
  const shoulderParts = [];
  if (sh > 0) {
    shoulderParts.push(buildStrip(
      stations, p.closed,
      () => -halfW, () => -(halfW + sh),
      (st) => surfaceY(st, -halfW), (st) => surfaceY(st, -(halfW + sh)),
    ));
    shoulderParts.push(buildStrip(
      stations, p.closed,
      () => halfW, () => halfW + sh,
      (st) => surfaceY(st, halfW), (st) => surfaceY(st, halfW + sh),
    ));
  }
  const shoulder = shoulderParts.length ? mergeStrips(shoulderParts) : empty.asphalt;

  // Lane markings, raised slightly above the surface.
  const markY = (st, offset) => surfaceY(st, offset) + MARK_RAISE;
  const markEdges = p.markings ? mergeStrips([
    buildStrip(stations, p.closed,
      () => -(halfW - EDGE_INSET - LINE_WIDTH), () => -(halfW - EDGE_INSET),
      (st) => markY(st, -(halfW - EDGE_INSET - LINE_WIDTH)), (st) => markY(st, -(halfW - EDGE_INSET))),
    buildStrip(stations, p.closed,
      () => halfW - EDGE_INSET - LINE_WIDTH, () => halfW - EDGE_INSET,
      (st) => markY(st, halfW - EDGE_INSET - LINE_WIDTH), (st) => markY(st, halfW - EDGE_INSET)),
  ]) : empty.asphalt;

  const dividerParts = [];
  if (p.markings && p.lanes > 1) {
    const laneW = p.width / p.lanes;
    const total = stations[stations.length - 1].arc;
    const period = DASH_LENGTH + DASH_GAP;
    for (let lane = 1; lane < p.lanes; lane++) {
      const o = -halfW + lane * laneW;
      for (let start = 0; start < total; start += period) {
        const end = Math.min(start + DASH_LENGTH, total);
        if (end - start < Math.max(p.sampleLength, 0.5)) continue;
        // Sample the dash at station resolution for a clean ribbon.
        const steps = Math.max(2, Math.round((end - start) / Math.max(p.sampleLength, 0.5)) + 1);
        const dashStations = Array.from({ length: steps }, (_, i) =>
          stationAtArc(stations, lerp(start, end, i / (steps - 1))));
        dividerParts.push(buildStrip(
          dashStations, false,
          () => o - LINE_WIDTH / 2, () => o + LINE_WIDTH / 2,
          (st) => markY(st, o - LINE_WIDTH / 2), (st) => markY(st, o + LINE_WIDTH / 2),
        ));
      }
    }
  }
  const markDividers = dividerParts.length ? mergeStrips(dividerParts) : empty.asphalt;

  const centerline = stations.map((st) => [st.x, st.y + 0.05, st.z]);

  const triangles =
    asphalt.indices.length / 3 +
    shoulder.indices.length / 3 +
    markEdges.indices.length / 3 +
    markDividers.indices.length / 3;

  return {
    asphalt, shoulder, markEdges, markDividers, centerline,
    stats: { ...empty.stats, triangles: Math.round(triangles) },
  };
}

// Concatenate strips into one mesh payload (offsets indices accordingly).
export function mergeStrips(strips) {
  const positions = new Float32Array(strips.reduce((n, s) => n + s.positions.length, 0));
  const uvs = new Float32Array(strips.reduce((n, s) => n + s.uvs.length, 0));
  let indexCount = 0;
  for (const s of strips) indexCount += s.indices.length;
  const indices = new Uint32Array(indexCount);
  let pv = 0, uv = 0, iv = 0, base = 0;
  for (const s of strips) {
    positions.set(s.positions, pv); pv += s.positions.length;
    uvs.set(s.uvs, uv); uv += s.uvs.length;
    for (let i = 0; i < s.indices.length; i++) indices[iv++] = s.indices[i] + base;
    base += s.positions.length / 3;
  }
  return { positions, uvs, indices };
}

// ── Project serialization (frontier-road v1) ──────────────────────────────

export function roadToJSON({ name = 'Untitled road', points = [], params = {}, stats = null } = {}) {
  return {
    format: 'frontier-road',
    version: 1,
    units: 'meters',
    up: 'Y',
    name,
    points: points.map((p) => ({ x: p.x, y: p.y ?? 0, z: p.z })),
    params: sanitizeParams(params),
    stats,
    note: 'Centerline control points in meters, Y-up. Rebuild the ribbon with the Frontier road editor; OBJ export carries the baked geometry.',
  };
}

function coercePoint(p) {
  if (!p || typeof p !== 'object') return null;
  const x = Number(p.x), y = Number(p.y ?? 0), z = Number(p.z);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  return { x, y: Number.isFinite(y) ? y : 0, z };
}

// Parse a frontier-road project file. Throws Error with a friendly message.
export function parseRoadJSON(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  if (!data || typeof data !== 'object') throw new Error('That file is not a road project.');
  if (data.format !== 'frontier-road') {
    throw new Error('Not a Frontier road project (missing format marker).');
  }
  if (data.version !== 1) {
    throw new Error(`Unsupported road project version ${JSON.stringify(data.version)}.`);
  }
  const points = Array.isArray(data.points) ? data.points.map(coercePoint).filter(Boolean) : [];
  const name = typeof data.name === 'string' && data.name.trim() ? data.name.trim().slice(0, 80) : 'Untitled road';
  return { name, points, params: sanitizeParams(data.params || {}) };
}

// ── Presets ───────────────────────────────────────────────────────────────

// Deterministic road layouts, in meters, centered on the terrain.
// `sampler(x, z)` supplies the authored control-point height.
export function presetRoads(kind, sampler = () => 0, size = 400) {
  const s = size;
  const at = (x, z) => ({ x, y: sampler(x, z), z });
  switch (kind) {
    case 'straight':
      return { closed: false, points: [at(-0.32 * s, -0.08 * s), at(0.34 * s, 0.1 * s)] };
    case 'valley': {
      const points = [];
      for (let i = 0; i < 5; i++) {
        const t = i / 4;
        points.push(at(lerp(-0.36 * s, 0.36 * s, t), Math.sin(t * Math.PI * 1.5) * 0.13 * s));
      }
      return { closed: false, points };
    }
    case 'switchback':
      return {
        closed: false,
        points: [
          at(-0.3 * s, -0.18 * s), at(0.26 * s, -0.14 * s), at(-0.22 * s, -0.02 * s),
          at(0.28 * s, 0.04 * s), at(-0.24 * s, 0.18 * s), at(0.2 * s, 0.24 * s),
        ],
      };
    case 'circuit': {
      const random = seededRandom(1337);
      const points = [];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const jitter = 0.92 + random() * 0.16;
        points.push(at(Math.cos(a) * 0.24 * s * jitter, Math.sin(a) * 0.17 * s * jitter));
      }
      return { closed: true, points };
    }
    default:
      return { closed: false, points: [at(-0.3 * s, 0), at(0.3 * s, 0)] };
  }
}

export { validateRoad, computeStats };
