/**
 * MOTORBALL CIRCUIT — "IRON CITY GRAND PRIX"
 * ------------------------------------------------------------------
 * A redesign of the Motorball track from Alita: Battle Angel, rebuilt
 * for race cars instead of cyborg skaters. See DESIGN.md for the
 * reference research behind every feature.
 *
 * The circuit is authored as a closed polygon of corner vertices, each with
 * a fillet radius, elevation and roadway width. Straights are genuinely
 * straight; corners are true tangent arcs. That keeps the layout readable
 * as a racing circuit instead of a wobbly loop.
 *
 * Topology: a figure-eight. The two lobes cross in the middle of the
 * stadium, where the "Vector Ramp" deck flies over the "Undercross" tunnel
 * on the film's signature bridge.
 *
 *   x = east, z = north, y = up. Racing direction = vertex order.
 */

const V = (x, z, r, y, w, name) => ({ x, z, r, y, w, name });

export const VERTICES = [
  // x      z      radius  y      halfWidth  name
  V(-66.4, -112, 55, 0.4, 15, 'Tunnel Entry'), // left, off the main straight
  V(66.4, 112, 55, 2.0, 15, 'Tunnel Exit'), // right, onto Factory Straight
  V(170, 112, 45, 3.2, 14, 'Trap Left'), // the chicane
  V(215, 92, 45, 3.8, 13, 'Trap Right'),
  V(295, 92, 70, 6.0, 18, 'Bowl Entry'), // Turn 1 — deep banked hairpin
  V(295, -96, 70, 14.5, 21, 'Bowl Exit'),
  V(57, -96, 55, 18.0, 16, 'Bridge Entry'), // top of the Vector Ramp
  V(-62, 105, 55, 16.2, 15, 'Bridge Exit'), // onto the North Sweep
  V(-270, 105, 78, 11.0, 17, 'Grinder In'), // Turn 6 — wide banked hairpin
  V(-270, -112, 78, 4.0, 21, 'Grinder Out'),
];

/* ------------------------------------------------------------------ */
/* Centreline generation: straights + tangent fillet arcs              */
/* ------------------------------------------------------------------ */

function sub(a, b) {
  return { x: a.x - b.x, z: a.z - b.z };
}
function len(a) {
  return Math.hypot(a.x, a.z);
}
function norm(a) {
  const l = len(a) || 1;
  return { x: a.x / l, z: a.z / l };
}

function buildPlan() {
  const n = VERTICES.length;
  const pts = []; // {x, z, key, t} — t = fraction between vertex keyframes

  const edge = [];
  for (let i = 0; i < n; i++) {
    const a = VERTICES[i];
    const b = VERTICES[(i + 1) % n];
    edge.push({ dir: norm(sub(b, a)), length: len(sub(b, a)) });
  }

  // fillet tangent length per vertex
  const fillet = [];
  for (let i = 0; i < n; i++) {
    const dIn = edge[(i - 1 + n) % n].dir;
    const dOut = edge[i].dir;
    const cross = dIn.x * dOut.z - dIn.z * dOut.x;
    let dot = dIn.x * dOut.x + dIn.z * dOut.z;
    dot = Math.max(-1, Math.min(1, dot));
    const turn = Math.atan2(cross, dot); // signed turn angle
    const r = VERTICES[i].r;
    let T = Math.abs(r * Math.tan(Math.abs(turn) / 2));
    T = Math.min(T, edge[(i - 1 + n) % n].length * 0.48, edge[i].length * 0.48);
    fillet.push({ turn, T, r: Math.abs(turn) > 1e-4 ? T / Math.tan(Math.abs(turn) / 2) : 0 });
  }

  for (let i = 0; i < n; i++) {
    const cur = VERTICES[i];
    const dIn = edge[(i - 1 + n) % n].dir;
    const dOut = edge[i].dir;
    const { turn, T, r } = fillet[i];
    const sign = Math.sign(turn) || 1;

    const arcStart = { x: cur.x - dIn.x * T, z: cur.z - dIn.z * T };
    // circle centre: perpendicular to the incoming direction
    const nIn = { x: -dIn.z * sign, z: dIn.x * sign };
    const centre = { x: arcStart.x + nIn.x * r, z: arcStart.z + nIn.z * r };

    // arc samples
    const steps = Math.max(2, Math.ceil(Math.abs(turn) / 0.16));
    const a0 = Math.atan2(arcStart.z - centre.z, arcStart.x - centre.x);
    for (let s = 0; s <= steps; s++) {
      const a = a0 + turn * (s / steps);
      pts.push({
        x: centre.x + Math.cos(a) * r,
        z: centre.z + Math.sin(a) * r,
        key: i,
        t: 0.5 * (s / steps) + 0.25, // arcs sit around the vertex keyframe
        corner: true,
      });
    }

    // straight to the next fillet
    const next = VERTICES[(i + 1) % n];
    const arcEnd = pts[pts.length - 1];
    const nextStart = {
      x: next.x - dOut.x * fillet[(i + 1) % n].T,
      z: next.z - dOut.z * fillet[(i + 1) % n].T,
    };
    const segLen = len(sub(nextStart, arcEnd));
    const divisions = Math.max(1, Math.round(segLen / 42));
    // note: the final point is the *next* fillet's arc start, which that
    // vertex emits itself — duplicating it would cusp the spline
    for (let s = 1; s < divisions; s++) {
      const f = s / divisions;
      pts.push({
        x: arcEnd.x + (nextStart.x - arcEnd.x) * f,
        z: arcEnd.z + (nextStart.z - arcEnd.z) * f,
        key: i,
        t: 0.75 + 0.5 * f, // straights bridge this vertex to the next
        corner: false,
      });
    }
  }
  return pts;
}

function keyLerp(values, key, t, n) {
  // t is expressed relative to `key`: 0..1 walks key -> key+1
  const f = Math.max(0, Math.min(1, t));
  const smooth = f * f * (3 - 2 * f);
  const a = values[key % n];
  const b = values[(key + 1) % n];
  return a + (b - a) * smooth;
}

function buildControlPoints() {
  const plan = buildPlan();
  const n = VERTICES.length;
  const ys = VERTICES.map((v) => v.y);
  const ws = VERTICES.map((v) => v.w);
  return plan.map((p) => {
    // p.t runs 0.25..1.25 across a vertex+straight; fold it into 0..1 between keys
    let key = p.key;
    let t = p.t - 0.25;
    if (t > 1) {
      key += 1;
      t -= 1;
    }
    const y = keyLerp(ys, key, t, n);
    const w = keyLerp(ws, key, t, n);
    return [Math.round(p.x * 10) / 10, Math.round(y * 100) / 100, Math.round(p.z * 10) / 10, Math.round(w * 10) / 10];
  });
}

function dedupe(list, minGap = 1.5) {
  const out = [];
  for (const p of list) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[2] - q[2]) > minGap) out.push(p);
  }
  // also guard the wrap-around seam
  while (out.length > 3 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][2] - out[out.length - 1][2]) < minGap) {
    out.pop();
  }
  return out;
}

export const CONTROL_POINTS = dedupe(buildControlPoints());

/** Where the start/finish gantry sits (nearest track point to this XZ). */
export const START_ANCHOR = [-170, -112];

/** Named sections, shown on the HUD and used for trackside dressing. */
export const LANDMARKS = [
  { name: 'KANSAS STRAIGHT', x: -170, z: -112 },
  { name: 'THE UNDERCROSS', x: 0, z: 0 },
  { name: 'FACTORY STRAIGHT', x: 120, z: 112 },
  { name: 'THE TRAP', x: 195, z: 100 },
  { name: 'THE BOWL', x: 360, z: 0 },
  { name: 'VECTOR RAMP', x: 180, z: -96 },
  { name: 'THE BRIDGE', x: -10, z: 16 },
  { name: 'NORTH SWEEP', x: -170, z: 105 },
  { name: 'THE GRINDER', x: -348, z: -4 },
];

export const TRACK_CONFIG = {
  sampleSpacing: 1.2, // metres between physics/geometry samples
  maxBank: 0.72, // radians (~41 deg) of roadway roll in the bowls
  bankGain: 58.0, // how strongly curvature drives banking
  flatRatio: 0.5, // fraction of half width that stays flat
  rimRatio: 0.36, // trough rim height as a fraction of half width
  wallHeight: 3.0, // barrier height above the rim
};
