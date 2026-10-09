// Closed-loop track model. Stand-in for real circuit data (sectors, racing line, curvature).
// The reference speed profile is a classic forward/backward pass: accel + brake limits.
export const LAT_G = 2.6;   // reference cornering grip (g)
const ACCEL = 9.5;          // m/s^2 reference max acceleration
const BRAKE = 28;           // m/s^2 reference max braking
const V_MAX = 80;           // m/s (~290 km/h)

function build(N = 1200) {
  const pts = [];
  for (let i = 0; i < N; i++) {
    const phi = (i / N) * Math.PI * 2;
    const w = 1 + 0.12 * Math.sin(3 * phi + 0.4) + 0.07 * Math.cos(5 * phi) + 0.035 * Math.sin(9 * phi);
    pts.push({ x: Math.cos(phi) * 1000 * w, y: Math.sin(phi) * 600 * w });
  }

  const s = new Float64Array(N + 1); // cumulative arc length (m)
  for (let i = 0; i < N; i++) {
    const a = pts[i], b = pts[(i + 1) % N];
    s[i + 1] = s[i] + Math.hypot(b.x - a.x, b.y - a.y);
  }
  const length = s[N];

  const k = new Float32Array(N); // signed curvature (1/m)
  for (let i = 0; i < N; i++) {
    const a = pts[(i - 1 + N) % N], b = pts[i], c = pts[(i + 1) % N];
    const ab = Math.hypot(b.x - a.x, b.y - a.y);
    const bc = Math.hypot(c.x - b.x, c.y - b.y);
    const ac = Math.hypot(c.x - a.x, c.y - a.y);
    k[i] = (2 * ((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x))) / (ab * bc * ac);
  }

  const vRef = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    vRef[i] = Math.min(V_MAX, Math.sqrt((LAT_G * 9.81) / Math.max(Math.abs(k[i]), 1e-4)));
  }
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N, ds = s[i + 1] - s[i];
      vRef[j] = Math.min(vRef[j], Math.sqrt(vRef[i] ** 2 + 2 * ACCEL * ds));
    }
    for (let i = N - 1; i >= 0; i--) {
      const j = (i + 1) % N, ds = s[i + 1] - s[i];
      vRef[i] = Math.min(vRef[i], Math.sqrt(vRef[j] ** 2 + 2 * BRAKE * ds));
    }
  }
  return { N, length, points: pts, s, k, vRef };
}

export const TRACK = build();

// Sample the track at a distance (m, may exceed one lap).
export function trackAt(track, dist) {
  const { N, s, points, k, vRef, length } = track;
  const d = ((dist % length) + length) % length;
  let lo = 0, hi = N - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (s[mid] <= d) lo = mid; else hi = mid - 1;
  }
  const i = lo, j = (i + 1) % N;
  const seg = s[i + 1] - s[i] || 1;
  const f = (d - s[i]) / seg;
  const p = points[i], q = points[j];
  return {
    x: p.x + (q.x - p.x) * f,
    y: p.y + (q.y - p.y) * f,
    heading: Math.atan2(q.y - p.y, q.x - p.x),
    k: k[i] + (k[j] - k[i]) * f,
    v: vRef[i] + (vRef[j] - vRef[i]) * f,
  };
}
