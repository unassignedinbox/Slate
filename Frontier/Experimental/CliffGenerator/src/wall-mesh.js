// Straight cliff walls as plain geometry (no SDF).
//
// The cliff edge is the zero set of the signed distance F to a locally fitted straight line
// (fitWallLines, PCA over the steep cells in a window). Marching squares on F gives the line
// segments where the wall stands. Each segment becomes a vertical quad: its foot sits on the lower
// plateau and its top on the upper plateau, both read from the heightfield averaged along the wall,
// so top and foot edges run straight with the wall. Nothing is displaced, carved or textured here.
import { fitWallLines } from './sdf-chunks.js';

const RADII = [5, 9, 14, 22, 32]; // window half-sizes (grid cells), narrowest first

function boxBlur(arr, N, B) {
  const tmp = new Float32Array(N * N), out = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    let t = 0;
    for (let k = -B; k <= B; k++) t += arr[j * N + Math.min(N - 1, Math.max(0, i + k))];
    tmp[j * N + i] = t / (2 * B + 1);
  }
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    let t = 0;
    for (let k = -B; k <= B; k++) t += tmp[Math.min(N - 1, Math.max(0, j + k)) * N + i];
    out[j * N + i] = t / (2 * B + 1);
  }
  return out;
}

// Builds the wall triangles for a field with `resolution`, `worldSize`, `height`, `sdfWeight`.
// Returns non-indexed attribute arrays (positions, normals, aux, aux2, aux3) and the triangle count.
export function buildWallGeometry(field, v = {}) {
  const N = field.resolution, size = field.worldSize;
  const h = field.height, W = field.sdfWeight;
  if (!h || !W || N < 4) return { triangles: 0 };
  const cell = size / (N - 1);
  const K = v.sdfWallPlateauK || 6;    // cells from the wall at which the plateau is read
  const T = v.sdfWallPlateauT || 8;    // half-length (cells) of the plateau average along the wall
  const minDrop = 0.5;                 // m, walls shorter than this in height are skipped
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

  // fit: the gradient is taken on a lightly smoothed height (box 3), so small rock blobs do not break the line
  const hs = boxBlur(h, N, 3);
  const gradS = (xa, zb) => {
    const i = clamp(Math.round(xa), 1, N - 2), j = clamp(Math.round(zb), 1, N - 2);
    return [(hs[j * N + i + 1] - hs[j * N + i - 1]) / (2 * cell), (hs[(j + 1) * N + i] - hs[(j - 1) * N + i]) / (2 * cell)];
  };
  const fit = fitWallLines({ sdfWeight: W, height: h }, N, N, 0, gradS, RADII);
  const Wb = boxBlur(W, N, 2);

  // grid values (bilinear, clamped) at fractional grid coordinates
  const bil = (arr, u, w) => {
    u = clamp(u, 0, N - 1); w = clamp(w, 0, N - 1);
    const i = Math.min(N - 2, Math.floor(u)), j = Math.min(N - 2, Math.floor(w));
    const fu = u - i, fw = w - j;
    const a = arr[j * N + i], b = arr[j * N + i + 1], c = arr[(j + 1) * N + i], d = arr[(j + 1) * N + i + 1];
    return (a + (b - a) * fu) * (1 - fw) + (c + (d - c) * fu) * fw;
  };
  const normalAt = (u, w) => {
    const nx = bil(fit.nX, u, w), nz = bil(fit.nZ, u, w);
    const l = Math.hypot(nx, nz) || 1;
    return [nx / l, nz / l];
  };
  // signed distance (grid cells) to the fitted line: + on the upper side
  const signed = (u, w) => {
    const [ux, uz] = normalAt(u, w);
    return (u - bil(fit.cX, u, w)) * ux + (w - bil(fit.cZ, u, w)) * uz;
  };
  // plateau heights either side of the wall, averaged along the wall so the top and foot edges are straight
  const plateau = (u, w) => {
    const [ux, uz] = normalAt(u, w);
    const tx = -uz, tz = ux;
    const side = (s) => {
      let acc = 0, n = 0;
      for (let t = -T; t <= T; t += 2) { acc += bil(h, u + s * K * ux + t * tx, w + s * K * uz + t * tz); n++; }
      return acc / n;
    };
    return { up: side(1), down: side(-1) };
  };

  // mask: cells where the fit exists and the cliff weight is present
  const mask = new Uint8Array(N * N);
  const F = new Float32Array(N * N);
  // the wall lives in a narrow band around the fitted line (where the cliff weight is present)
  const band = v.sdfWallBand || 3;
  for (let q = 0; q < N * N; q++) {
    if (!(fit.ok[q] > 0.5) || !(Wb[q] > 0.2)) continue;
    const a = q % N, b = (q - a) / N;
    const d = signed(a, b);
    if (Math.abs(d) > band) continue;
    mask[q] = 1;
    F[q] = d;
  }

  const aux = [], aux2 = [], aux3 = [], pos = [], nor = [];
  const sample = (arr, u, w) => (arr ? bil(arr, u, w) : 0);
  const vert = (u, w, y, nxo, nzo) => {
    pos.push((u / (N - 1) - 0.5) * size, y, (w / (N - 1) - 0.5) * size);
    nor.push(nxo, 0, nzo);
    aux.push(sample(field.deposit, u, w), sample(field.flow, u, w), sample(field.hardness, u, w), sample(field.cavity, u, w));
    aux2.push(sample(field.road, u, w), sample(field.river, u, w), sample(field.lake, u, w), field.waterLevel ? bil(field.waterLevel, u, w) : -1e9);
    aux3.push(sample(field.silt, u, w), sample(field.dirX, u, w), sample(field.dirZ, u, w), 0);
  };
  // one wall quad between plan points A and B (grid coordinates)
  const quad = (A, B) => {
    const pa = plateau(A[0], A[1]), pb = plateau(B[0], B[1]);
    if (pa.up - pa.down < minDrop && pb.up - pb.down < minDrop) { dbg.dropped++; return 0; }
    dbg.quads++;
    const [mx, mz] = normalAt((A[0] + B[0]) / 2, (A[1] + B[1]) / 2);
    const ox = -mx, oz = -mz; // outward: the wall faces the lower side
    const P = [
      [A[0], pa.down, A[1]], [B[0], pb.down, B[1]], [B[0], pb.up, B[1]], [A[0], pa.up, A[1]],
    ].map(([u, y, w]) => [(u / (N - 1) - 0.5) * size, y, (w / (N - 1) - 0.5) * size]);
    const idx = [[0, 1, 2], [0, 2, 3]];
    let made = 0;
    for (const t of idx) {
      const p0 = P[t[0]], p1 = P[t[1]], p2 = P[t[2]];
      const cx = (p1[1] - p0[1]) * (p2[2] - p0[2]) - (p1[2] - p0[2]) * (p2[1] - p0[1]);
      const cz = (p1[2] - p0[2]) * (p2[0] - p0[0]) - (p1[0] - p0[0]) * (p2[2] - p0[2]);
      // the quad is vertical, so its normal is horizontal: keep the winding whose normal faces out
      const flip = cx * ox + cz * oz < 0;
      const order = flip ? [t[0], t[2], t[1]] : t;
      for (const k of order) {
        const [u, w] = k === 0 ? A : k === 1 ? B : k === 2 ? B : A;
        const yv = k === 0 || k === 1 ? (k === 0 ? pa.down : pb.down) : (k === 2 ? pb.up : pa.up);
        vert(u, w, yv, ox, oz);
      }
      made++;
    }
    return made;
  };

  let triangles = 0;
  const dbg = { mask: 0, cells: 0, cross: 0, dropped: 0, quads: 0 };
  for (let q = 0; q < N * N; q++) { dbg.mask += mask[q]; if (mask[q] && Math.abs(F[q]) < 1) dbg.near = (dbg.near || 0) + 1; if (mask[q] && F[q] > 0) dbg.pos = (dbg.pos || 0) + 1; }
  for (let b = 0; b < N - 1; b++) for (let a = 0; a < N - 1; a++) {
    const c = [b * N + a, b * N + a + 1, (b + 1) * N + a + 1, (b + 1) * N + a];
    if (!(mask[c[0]] && mask[c[1]] && mask[c[2]] && mask[c[3]])) continue;
    const f = c.map((q) => F[q]);
    const corner = [[a, b], [a + 1, b], [a + 1, b + 1], [a, b + 1]];
    const pts = [];
    for (let e = 0; e < 4; e++) {
      const p = e, q = (e + 1) % 4;
      if ((f[p] < 0) === (f[q] < 0)) continue;
      const t = f[p] / (f[p] - f[q]);
      pts.push([corner[p][0] + t * (corner[q][0] - corner[p][0]), corner[p][1] + t * (corner[q][1] - corner[p][1])]);
    }
    dbg.cells++; dbg.cross += pts.length > 0 ? 1 : 0;
    if (pts.length === 2) triangles += quad(pts[0], pts[1]);
    else if (pts.length === 4) { triangles += quad(pts[0], pts[1]); triangles += quad(pts[2], pts[3]); }
  }
  return {
    dbg,
    triangles,
    positions: Float32Array.from(pos), normals: Float32Array.from(nor),
    aux: Float32Array.from(aux), aux2: Float32Array.from(aux2), aux3: Float32Array.from(aux3),
  };
}
