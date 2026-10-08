/* ════════════════════════════════════════════════════════════════════
   geometry.js — road ribbon meshing + OBJ export (pure, no DOM/three).
   Y-up, metres. Colours are linear-ish 0..1 vertex colours.
   ════════════════════════════════════════════════════════════════════ */
import {sampleRoad} from './spline.js';

/** Surface presets: road + shoulder vertex colours. */
export const SURFACES = {
  asphalt:  {label: 'Asphalt',  road: [0.200, 0.212, 0.230], shoulder: [0.160, 0.168, 0.182]},
  concrete: {label: 'Concrete', road: [0.585, 0.595, 0.590], shoulder: [0.500, 0.510, 0.505]},
  gravel:   {label: 'Gravel',   road: [0.512, 0.462, 0.372], shoulder: [0.440, 0.394, 0.316]},
  dirt:     {label: 'Dirt',     road: [0.410, 0.300, 0.196], shoulder: [0.345, 0.250, 0.163]}
};
export const SURFACE_IDS = Object.keys(SURFACES);

export const CENTER_MARKINGS = {
  none: 'None', single: 'Single solid', double: 'Double solid', dashed: 'Dashed'
};
export const MARK_WHITE = [0.88, 0.88, 0.86];
export const MARK_YELLOW = [0.91, 0.74, 0.23];
export const KERB_COLOR = [0.62, 0.62, 0.60];
export const RAIL_COLOR = [0.70, 0.72, 0.74];
export const POST_COLOR = [0.42, 0.43, 0.44];

/** Base paved+shoulder width at w=1 (metres). */
export function baseWidth(road) {
  return Math.max(0.5, road.lanes * road.laneWidth + road.shoulderL + road.shoulderR);
}

function shadeVariation(s) {
  return 1 + 0.028 * Math.sin(s * 1.7) + 0.018 * Math.sin(s * 0.43 + 2.0);
}

function pushGrid(part, rows) {
  // rows: array of arrays of {x,y,z, nx,ny,nz, r,g,b, u,v}; triangulate strip grid.
  const R = rows.length, C = rows[0].length;
  const P = [], N = [], Cc = [], U = [], I = [];
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    const v = rows[r][c];
    P.push(v.x, v.y, v.z); N.push(v.nx, v.ny, v.nz);
    Cc.push(v.r, v.g, v.b); U.push(v.u, v.v);
  }
  // Winding (a, a+1, b),(a+1, b+1, b): CCW seen from +Y with S=(-tz,tx) columns. See notes.
  for (let r = 0; r < R - 1; r++) for (let c = 0; c < C - 1; c++) {
    const a = r * C + c, b = (r + 1) * C + c;
    I.push(a, a + 1, b, a + 1, b + 1, b);
  }
  part.positions = new Float32Array(P);
  part.normals = new Float32Array(N);
  part.colors = new Float32Array(Cc);
  part.uvs = new Float32Array(U);
  part.indices = new Uint32Array(I);
  part.triangles = I.length / 3;
}

function frameNormal(tx, tz, grade, crossSlope) {
  // N = normalize(cross(S3, T3)), S3=(-tz,k,tx), T3=(tx,g,tz).
  const Sx = -tz, Sy = crossSlope, Sz = tx;
  const Tx = tx, Ty = grade, Tz = tz;
  let nx = Sy * Tz - Sz * Ty, ny = Sz * Tx - Sx * Tz, nz = Sx * Ty - Sy * Tx;
  const L = Math.hypot(nx, ny, nz) || 1;
  return [nx / L, ny / L, nz / L];
}

/**
 * Build all mesh parts for one road.
 * @param {object} road — project road record.
 * @param {object} opts — {step, terrain: fn(x,z)->y|null}.
 */
export function buildRoadMesh(road, {step = 1.0, terrain = null} = {}) {
  const parts = [];
  const smp = sampleRoad(road.points, {closed: road.closed, step});
  const stats = {length: smp.length, triangles: 0, minRadius: smp.minRadius ?? Infinity, maxGrade: smp.maxGrade ?? 0};
  if (!smp.count) return {parts, samples: smp, stats};
  const S = smp.samples;
  const surf = SURFACES[road.surface] || SURFACES.asphalt;
  const drape = road.conform === 'drape' && typeof terrain === 'function';
  const drapeOff = +road.drapeOffset || 0;

  const baseY = (p) => {
    if (!drape) return p.y;
    const t = terrain(p.x, p.z);
    return t == null || !Number.isFinite(t) ? p.y : t + drapeOff;
  };
  const halfRoad = (p) => Math.max(0.25, (road.lanes * road.laneWidth * (p.w || 1)) / 2);
  // Cross height at offset o (metres, + = left of travel? S=(-tz,tx) side).
  const crossY = (p, yBase, hr, o) => {
    const ao = Math.abs(o);
    if (ao <= hr) {
      const camber = +road.camber || 0;
      return camber > 0 ? yBase + camber * (1 - (o / hr) * (o / hr)) : yBase;
    }
    return yBase - (ao - hr) * 0.025; // shoulder fall
  };

  /* ── main surface: lanes + shoulders in one grid ── */
  {
    const NL = Math.max(5, road.lanes + 2); // columns across lanes
    // Offsets are fractions resolved per-sample (width varies with w).
    const laneF = [];
    for (let c = 0; c < NL; c++) laneF.push(-1 + (2 * c) / (NL - 1));
    const rows = [];
    for (const p of S) {
      const hr = halfRoad(p);
      const wScale = p.w || 1;
      const shL = Math.max(0, +road.shoulderL || 0) * wScale;
      const shR = Math.max(0, +road.shoulderR || 0) * wScale;
      const offs = [];
      if (shL > 0) offs.push(-hr - shL, -hr - shL * 0.45);
      for (const f of laneF) offs.push(f * hr);
      if (shR > 0) offs.push(hr + shR * 0.45, hr + shR);
      const yB = baseY(p);
      const shade = shadeVariation(p.s);
      const row = offs.map((o) => {
        const y = crossY(p, yB, hr, o);
        const inLane = Math.abs(o) <= hr + 1e-6;
        const col = inLane ? surf.road : surf.shoulder;
        return {o, x: p.x - p.tz * o, y, z: p.z + p.tx * o, r: col[0] * shade, g: col[1] * shade, b: col[2] * shade, u: o, v: p.s};
      });
      // Cross-slope per column from neighbours, then normals.
      for (let c = 0; c < row.length; c++) {
        const a = row[Math.max(0, c - 1)], b = row[Math.min(row.length - 1, c + 1)];
        const k = (b.y - a.y) / Math.max(1e-6, b.o - a.o || 1e-6);
        const [nx, ny, nz] = frameNormal(p.tx, p.tz, p.grade, k);
        row[c].nx = nx; row[c].ny = ny; row[c].nz = nz;
      }
      rows.push(row);
    }
    if (rows.length > 1) {
      const part = {name: 'surface', roadId: road.id};
      pushGrid(part, rows);
      parts.push(part);
    }
  }

  /* ── painted markings (thin lifted strips) ── */
  const strip = (name, oA, oB, color, keep) => {
    const rows = [];
    for (const p of S) {
      if (keep && !keep(p)) continue;
      const hr = halfRoad(p);
      const yB = baseY(p);
      const mk = (o) => {
        const y = crossY(p, yB, hr, o) + 0.02;
        return {x: p.x - p.tz * o, y, z: p.z + p.tx * o, r: color[0], g: color[1], b: color[2], u: o, v: p.s};
      };
      const row = [mk(oA), mk(oB)];
      for (const v of row) {
        const [nx, ny, nz] = frameNormal(p.tx, p.tz, p.grade, 0);
        v.nx = nx; v.ny = ny; v.nz = nz;
      }
      rows.push(row);
    }
    if (rows.length > 1) {
      const part = {name, roadId: road.id};
      pushGrid(part, rows);
      parts.push(part);
    }
  };
  const cm = road.centerMarking || 'none';
  if (cm === 'single') strip('marking-center', -0.07, 0.07, MARK_WHITE);
  else if (cm === 'double') {
    strip('marking-center-L', -0.24, -0.12, MARK_YELLOW);
    strip('marking-center-R', 0.12, 0.24, MARK_YELLOW);
  } else if (cm === 'dashed') {
    strip('marking-center', -0.07, 0.07, MARK_WHITE, (p) => (p.s % 9) < 3);
  }
  if (road.edgeMarking) {
    // Edge lines ride just inside the lane edge; offsets resolved per-sample via w.
    const rows = [];
    for (const side of [-1, 1]) {
      const rr = [];
      for (const p of S) {
        const hr = halfRoad(p);
        if (hr < 0.6) continue;
        const oC = side * (hr - 0.22);
        const yB = baseY(p);
        const mk = (o) => {
          const y = crossY(p, yB, hr, o) + 0.02;
          const [nx, ny, nz] = frameNormal(p.tx, p.tz, p.grade, 0);
          return {x: p.x - p.tz * o, y, z: p.z + p.tx * o, nx, ny, nz, r: MARK_WHITE[0], g: MARK_WHITE[1], b: MARK_WHITE[2], u: o, v: p.s};
        };
        rr.push([mk(oC - 0.06), mk(oC + 0.06)]);
      }
      if (rr.length > 1) {
        const part = {name: side < 0 ? 'marking-edge-L' : 'marking-edge-R', roadId: road.id};
        pushGrid(part, rr);
        parts.push(part);
      }
    }
  }

  /* ── kerbs: small L-profile at the shoulder edge ── */
  for (const side of [-1, 1]) {
    const want = side < 0 ? road.kerbL : road.kerbR;
    if (!want) continue;
    const rows = [];
    for (const p of S) {
      const hr = halfRoad(p);
      const wScale = p.w || 1;
      const sh = side < 0 ? Math.max(0, +road.shoulderL || 0) * wScale : Math.max(0, +road.shoulderR || 0) * wScale;
      const edge = side * (hr + sh);
      const yB = baseY(p);
      const hEdge = crossY(p, yB, hr, edge);
      const prof = [
        {o: edge, y: hEdge + 0.005},
        {o: edge + side * 0.06, y: hEdge + 0.14},
        {o: edge + side * 0.30, y: hEdge + 0.14}
      ];
      const row = prof.map(({o, y}) => {
        const [nx, ny, nz] = frameNormal(p.tx, p.tz, p.grade, side * 0.4);
        return {x: p.x - p.tz * o, y, z: p.z + p.tx * o, nx, ny, nz, r: KERB_COLOR[0], g: KERB_COLOR[1], b: KERB_COLOR[2], u: o, v: p.s};
      });
      rows.push(row);
    }
    if (rows.length > 1) {
      const part = {name: side < 0 ? 'kerb-L' : 'kerb-R', roadId: road.id};
      pushGrid(part, rows);
      parts.push(part);
    }
  }

  /* ── guardrails: band + posts ── */
  for (const side of [-1, 1]) {
    const want = side < 0 ? road.guardrailL : road.guardrailR;
    if (!want) continue;
    // Rail band (vertical ribbon).
    {
      const rows = [];
      for (const p of S) {
        const hr = halfRoad(p);
        const wScale = p.w || 1;
        const sh = side < 0 ? Math.max(0, +road.shoulderL || 0) * wScale : Math.max(0, +road.shoulderR || 0) * wScale;
        const ro = side * (hr + sh + 0.6);
        const y0 = crossY(p, baseY(p), hr, side * (hr + sh));
        const mk = (dy) => ({x: p.x - p.tz * ro, y: y0 + dy, z: p.z + p.tx * ro,
          nx: -p.tz * side, ny: 0.12, nz: p.tx * side,
          r: RAIL_COLOR[0], g: RAIL_COLOR[1], b: RAIL_COLOR[2], u: ro, v: p.s});
        const n = frameNormal(p.tx, p.tz, p.grade, 0);
        const a = mk(0.5), b = mk(0.78);
        a.nx = -p.tz * side; a.ny = 0; a.nz = p.tx * side;
        b.nx = -p.tz * side; b.ny = 0; b.nz = p.tx * side;
        void n;
        rows.push([a, b]);
      }
      if (rows.length > 1) {
        const part = {name: side < 0 ? 'rail-L' : 'rail-R', roadId: road.id};
        pushGrid(part, rows);
        parts.push(part);
      }
    }
    // Posts (boxes every ~4 m, capped).
    {
      const cand = S.filter((p) => (p.s % 4) < (S.length > 1 ? S[1].s - S[0].s : 1) * 1.01);
      const stride = Math.max(1, Math.ceil(cand.length / 1500));
      const P = [], N = [], Cc = [], U = [], I = [];
      let vi = 0;
      const hw = 0.07, hh = 0.42;
      const box = [
        [-hw, -hh, -hw], [hw, -hh, -hw], [hw, -hh, hw], [-hw, -hh, hw],
        [-hw, hh, -hw], [hw, hh, -hw], [hw, hh, hw], [-hw, hh, hw]
      ];
      const faces = [[0, 1, 2], [0, 2, 3], [4, 6, 5], [4, 7, 6], [0, 4, 5], [0, 5, 1],
                     [2, 6, 7], [2, 7, 3], [0, 3, 7], [0, 7, 4], [1, 5, 6], [1, 6, 2]];
      cand.forEach((p, k) => {
        if (k % stride !== 0) return;
        const hr = halfRoad(p);
        const wScale = p.w || 1;
        const sh = side < 0 ? Math.max(0, +road.shoulderL || 0) * wScale : Math.max(0, +road.shoulderR || 0) * wScale;
        const ro = side * (hr + sh + 0.6);
        const cx = p.x - p.tz * ro, cz = p.z + p.tx * ro;
        const cy = crossY(p, baseY(p), hr, side * (hr + sh)) + 0.30;
        // Orient box to the frame (side × up × tangent).
        const sx = -p.tz, sz = p.tx;
        for (const [bx, by, bz] of box) {
          P.push(cx + sx * bx + p.tx * bz, cy + by, cz + sz * bx + p.tz * bz);
          N.push(0, 1, 0);
          Cc.push(POST_COLOR[0], POST_COLOR[1], POST_COLOR[2]);
          U.push(bx, bz);
        }
        for (const f of faces) I.push(vi + f[0], vi + f[1], vi + f[2]);
        vi += 8;
      });
      if (I.length) {
        parts.push({name: side < 0 ? 'posts-L' : 'posts-R', roadId: road.id,
          positions: new Float32Array(P), normals: new Float32Array(N),
          colors: new Float32Array(Cc), uvs: new Float32Array(U),
          indices: new Uint32Array(I), triangles: I.length / 3});
      }
    }
  }

  for (const pt of parts) stats.triangles += pt.triangles;
  return {parts, samples: smp, stats};
}

/** Total triangle estimate for a project (for UI budgets). */
export function countProjectTriangles(project, opts = {}) {
  let t = 0;
  for (const road of project.roads) {
    if (road.visible === false) continue;
    t += buildRoadMesh(road, opts).stats.triangles;
  }
  return t;
}

const safeName = (s) => String(s || 'road').replace(/[^A-Za-z0-9_.-]+/g, '_').slice(0, 48) || 'road';

/**
 * Serialize a project to Wavefront OBJ (Y-up metres, geometry only —
 * same header convention as Terrain Lab exports). Returns a string.
 */
export function roadNetworkToOBJ(project, {step = 1.0, terrain = null} = {}) {
  const lines = [];
  const stamp = new Date().toISOString();
  lines.push('# Frontier road network | units: meters | Y-up');
  lines.push(`# Project: ${project.name || 'untitled'} | roads: ${project.roads.length} | exported: ${stamp}`);
  const summary = project.roads.map((r) => {
    const smp = sampleRoad(r.points, {closed: r.closed, step});
    return {name: r.name, closed: !!r.closed, points: r.points.length, length_m: +smp.length.toFixed(2),
      lanes: r.lanes, laneWidth_m: r.laneWidth, surface: r.surface};
  });
  lines.push(`# Roads: ${JSON.stringify(summary)}`);
  let vo = 0;
  for (const road of project.roads) {
    if (road.visible === false) continue;
    const {parts} = buildRoadMesh(road, {step, terrain});
    const rn = safeName(`${road.name || road.id}`);
    for (const part of parts) {
      lines.push(`o ${rn}__${part.name}`);
      const {positions: P, normals: N, uvs: U, indices: I} = part;
      for (let i = 0; i < P.length; i += 3) lines.push(`v ${P[i].toFixed(4)} ${P[i + 1].toFixed(4)} ${P[i + 2].toFixed(4)}`);
      for (let i = 0; i < U.length; i += 2) lines.push(`vt ${U[i].toFixed(3)} ${U[i + 1].toFixed(3)}`);
      for (let i = 0; i < N.length; i += 3) lines.push(`vn ${N[i].toFixed(5)} ${N[i + 1].toFixed(5)} ${N[i + 2].toFixed(5)}`);
      for (let i = 0; i < I.length; i += 3) {
        const a = I[i] + 1 + vo, b = I[i + 1] + 1 + vo, c = I[i + 2] + 1 + vo;
        lines.push(`f ${a}/${a}/${a} ${b}/${b}/${b} ${c}/${c}/${c}`);
      }
      vo += P.length / 3;
    }
  }
  return lines.join('\n') + '\n';
}
