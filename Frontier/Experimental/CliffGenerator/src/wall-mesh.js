// Straight cliff walls as plain geometry (no SDF, no carving, no texture).
//
// 1. Candidates: grid cells in the steep band (smoothed slope above the cliff threshold) that are
//    local maxima of the slope across the face (non-maximum suppression along the uphill direction).
//    That ridge is the cliff edge: the steepest line of the face.
// 2. Each connected ridge is ordered along its principal axis and smoothed, so it becomes one
//    continuous polyline instead of per-cell pieces.
// 3. For every polyline segment the wall is a vertical quad from the lower plateau to the upper
//    plateau. The plateau heights are read on both sides of the ridge and averaged along it, so the
//    top and foot edges run with the polyline.
const K_PLATEAU = 6;  // cells from the ridge where the plateau height is read
const T_ALONG = 6;    // half-length (cells) of the plateau average along the ridge
const SMOOTH = 2;     // half-window (points) for smoothing the ridge and plateau heights

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

export function buildWallGeometry(field, v = {}) {
  const N = field.resolution, size = field.worldSize;
  const h = field.height, W = field.sdfWeight;
  const empty = { triangles: 0, positions: new Float32Array(0), normals: new Float32Array(0), aux: new Float32Array(0), aux2: new Float32Array(0), aux3: new Float32Array(0), dbg: {} };
  if (!h || !W || N < 8) return empty;
  const cell = size / (N - 1);
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const Kp = v.sdfWallPlateauK || K_PLATEAU, Tp = v.sdfWallPlateauT || T_ALONG;
  const steepMin = v.sdfWallSlope || 0.7;   // m/m, the cliff threshold (about 35 degrees)
  const minChain = v.sdfWallMinChain || 6;  // cells
  const minDrop = 0.5;
  const minLen = v.sdfWallMinLen || 24;      // ridge points
  const minDropMean = v.sdfWallMinDrop || 8; // m

  const hs = boxBlur(h, N, 2);
  const gx = new Float32Array(N * N), gz = new Float32Array(N * N), mag = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const i0 = Math.max(0, i - 1), i1 = Math.min(N - 1, i + 1), j0 = Math.max(0, j - 1), j1 = Math.min(N - 1, j + 1);
    const q = j * N + i;
    gx[q] = (hs[j * N + i1] - hs[j * N + i0]) / ((i1 - i0) * cell);
    gz[q] = (hs[j1 * N + i] - hs[j0 * N + i]) / ((j1 - j0) * cell);
    mag[q] = Math.hypot(gx[q], gz[q]);
  }
  const Wb = boxBlur(W, N, 2);

  const bil = (arr, u, w) => {
    u = clamp(u, 0, N - 1); w = clamp(w, 0, N - 1);
    const i = Math.min(N - 2, Math.floor(u)), j = Math.min(N - 2, Math.floor(w));
    const fu = u - i, fw = w - j;
    const a = arr[j * N + i], b = arr[j * N + i + 1], c = arr[(j + 1) * N + i], d = arr[(j + 1) * N + i + 1];
    return (a + (b - a) * fu) * (1 - fw) + (c + (d - c) * fu) * fw;
  };

  // 1. candidates: steep band + non-maximum suppression across the face
  const cand = new Uint8Array(N * N);
  for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
    const q = j * N + i;
    if (Wb[q] < 0.3 || mag[q] < steepMin) continue;
    const m = Math.hypot(gx[q], gz[q]);
    const dx = gx[q] / m, dz = gz[q] / m;  // uphill, in metres: convert to cells below
    const sx = dx * cell, sz = dz * cell;  // one cell along the uphill direction, per unit slope
    const up = bil(mag, i + dx, j + dz), dn = bil(mag, i - dx, j - dz);
    if (mag[q] >= up && mag[q] >= dn) cand[q] = 1;
    void sx; void sz;
  }

  // 2. connected ridges (8-neighbours), ordered along their principal axis, then smoothed
  const seen = new Uint8Array(N * N);
  const chains = [];
  for (let q0 = 0; q0 < N * N; q0++) {
    if (!cand[q0] || seen[q0]) continue;
    const comp = [], stack = [q0];
    seen[q0] = 1;
    while (stack.length) {
      const q = stack.pop();
      comp.push(q);
      const i = q % N, j = (q - i) / N;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue;
        const r = jj * N + ii;
        if (cand[r] && !seen[r]) { seen[r] = 1; stack.push(r); }
      }
    }
    if (comp.length < minChain) continue;
    let mx = 0, mz = 0;
    for (const q of comp) { mx += q % N; mz += Math.floor(q / N); }
    mx /= comp.length; mz /= comp.length;
    let cxx = 0, cxz = 0, czz = 0;
    for (const q of comp) { const a = q % N - mx, b = Math.floor(q / N) - mz; cxx += a * a; cxz += a * b; czz += b * b; }
    const th = 0.5 * Math.atan2(2 * cxz, cxx - czz);
    const ex = Math.cos(th), ez = Math.sin(th);
    const ordered = comp.map((q) => ({ u: q % N, w: Math.floor(q / N), t: (q % N - mx) * ex + (Math.floor(q / N) - mz) * ez }))
      .sort((p, r) => p.t - r.t);
    chains.push(ordered);
  }

  // 3. quads along each chain
  const pos = [], nor = [], aux = [], aux2 = [], aux3 = [];
  const sample = (arr, u, w) => (arr ? bil(arr, u, w) : 0);
  const vert = (u, w, y, ox, oz) => {
    pos.push((u / (N - 1) - 0.5) * size, y, (w / (N - 1) - 0.5) * size);
    nor.push(ox, 0, oz);
    aux.push(sample(field.deposit, u, w), sample(field.flow, u, w), sample(field.hardness, u, w), sample(field.cavity, u, w));
    aux2.push(sample(field.road, u, w), sample(field.river, u, w), sample(field.lake, u, w), field.waterLevel ? bil(field.waterLevel, u, w) : -1e9);
    aux3.push(sample(field.silt, u, w), sample(field.dirX, u, w), sample(field.dirZ, u, w), 0);
  };
  const dbg = { chains: chains.length, points: 0, quads: 0, dropped: 0, length: 0 };
  let triangles = 0;

  for (const ch of chains) {
    const n = ch.length;
    // smoothed positions along the chain
    const su = new Float64Array(n), sw = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let a = 0, b = 0, c = 0;
      for (let k = -SMOOTH; k <= SMOOTH; k++) { const p = ch[clamp(i + k, 0, n - 1)]; a += p.u; b += p.w; c++; }
      su[i] = a / c; sw[i] = b / c;
    }
    // uphill normal and tangent per point, plateau heights on both sides
    const nxA = new Float64Array(n), nzA = new Float64Array(n), up = new Float64Array(n), dn = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const i0 = clamp(i - 1, 0, n - 1), i1 = clamp(i + 1, 0, n - 1);
      let tx = su[i1] - su[i0], tz = sw[i1] - sw[i0];
      const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      let nx = -tz, nz = tx;
      const u = su[i], w = sw[i];
      const ggx = bil(gx, u, w), ggz = bil(gz, u, w);
      if (nx * ggx + nz * ggz < 0) { nx = -nx; nz = -nz; }
      nxA[i] = nx; nzA[i] = nz;
      const side = (s) => {
        let acc = 0, c = 0;
        for (let t = -Tp; t <= Tp; t += 2) { acc += bil(h, u + s * Kp * nx + t * tx, w + s * Kp * nz + t * tz); c++; }
        return acc / c;
      };
      up[i] = side(1); dn[i] = side(-1);
    }
    const smooth1 = (arr) => { const o = new Float64Array(n); for (let i = 0; i < n; i++) { let a = 0, c = 0; for (let k = -SMOOTH; k <= SMOOTH; k++) { a += arr[clamp(i + k, 0, n - 1)]; c++; } o[i] = a / c; } return o; };
    const upS = smooth1(up), dnS = smooth1(dn);
    dbg.points += n;
    // a real cliff is a long ridge with a big drop: short ridges and small steps are gullies, not walls
    let drop = 0;
    for (let i = 0; i < n; i++) drop += upS[i] - dnS[i];
    if (n < minLen || drop / n < minDropMean) { dbg.rejected = (dbg.rejected || 0) + 1; continue; }
    for (let i = 0; i + 1 < n; i++) {
      const A = [su[i], sw[i]], B = [su[i + 1], sw[i + 1]];
      const seg = Math.hypot(B[0] - A[0], B[1] - A[1]);
      if (seg > 4 || seg < 1e-6) { dbg.dropped++; continue; }
      if (upS[i] - dnS[i] < minDrop && upS[i + 1] - dnS[i + 1] < minDrop) { dbg.dropped++; continue; }
      dbg.length += seg;
      let ox = -(nxA[i] + nxA[i + 1]), oz = -(nzA[i] + nzA[i + 1]);
      const ol = Math.hypot(ox, oz) || 1; ox /= ol; oz /= ol;
      const P = [
        [(A[0] / (N - 1) - 0.5) * size, dnS[i], (A[1] / (N - 1) - 0.5) * size],
        [(B[0] / (N - 1) - 0.5) * size, dnS[i + 1], (B[1] / (N - 1) - 0.5) * size],
        [(B[0] / (N - 1) - 0.5) * size, upS[i + 1], (B[1] / (N - 1) - 0.5) * size],
        [(A[0] / (N - 1) - 0.5) * size, upS[i], (A[1] / (N - 1) - 0.5) * size],
      ];
      const corner = [[A, 0], [B, 0], [B, 1], [A, 1]];
      for (const t of [[0, 1, 2], [0, 2, 3]]) {
        const p0 = P[t[0]], p1 = P[t[1]], p2 = P[t[2]];
        const cx = (p1[1] - p0[1]) * (p2[2] - p0[2]) - (p1[2] - p0[2]) * (p2[1] - p0[1]);
        const cz = (p1[2] - p0[2]) * (p2[0] - p0[0]) - (p1[0] - p0[0]) * (p2[2] - p0[2]);
        const order = cx * ox + cz * oz < 0 ? [t[0], t[2], t[1]] : t;
        for (const k of order) {
          const [pt, yi] = corner[k];
          vert(pt[0], pt[1], P[k][1], ox, oz);
        }
        triangles++;
      }
      dbg.quads++;
    }
  }
  dbg.length = +(dbg.length * cell).toFixed(0);
  return {
    dbg, triangles,
    positions: Float32Array.from(pos), normals: Float32Array.from(nor),
    aux: Float32Array.from(aux), aux2: Float32Array.from(aux2), aux3: Float32Array.from(aux3),
  };
}
