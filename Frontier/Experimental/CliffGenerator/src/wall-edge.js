// Traced straight cliff walls, as plain geometry (no SDF).
//
// The cliff line is the 0.5 contour of the escarpment edge map (sim.cliffEdge, from the heightfield).
// It is traced into continuous polylines (marching squares, chained by grid-edge keys), resampled at
// one sim cell, and smoothed along its length, so each cliff edge is one curve instead of per-cell
// pieces. Along it, a vertical wall is built from the lower plateau to the upper plateau, both read
// from the mesh heightfield averaged along the wall, so the top and foot edges run with the wall.
export function buildEdgeWallGeometry(sim, mesh, v = {}) {
  const E = sim.cliffEdge;
  const Ns = sim.resolution, Ss = sim.worldSize;
  const empty = { triangles: 0, chains: 0, length: 0, maxTurn: 0, positions: new Float32Array(0), normals: new Float32Array(0), aux: new Float32Array(0), aux2: new Float32Array(0), aux3: new Float32Array(0) };
  if (!E || !mesh || !mesh.height) return empty;
  const H = mesh.height, Nm = mesh.resolution, Sm = mesh.worldSize;
  const cs = Ss / (Ns - 1);                 // sim cell (m)
  const sigma = v.sdfWallSmooth || 4;     // smoothing along the line, in samples (1 sample = 1 sim cell)
  const Kd = (v.sdfWallPlateauK || 2) * cs; // distance from the wall where the plateau is read (m)
  const Td = (v.sdfWallPlateauT || 4) * cs; // half-length of the plateau average along the wall (m)
  const minDrop = 0.5;

  // 1. marching squares on the 0.5 contour of the sim edge map; crossings keyed by their grid edge
  const lvl = 0.5;
  const crossing = (key) => {
    const [t, i, j] = key.split(',').map((x, n) => (n === 0 ? x : +x));
    if (t === 'h') { const a = E[j * Ns + i], b = E[j * Ns + i + 1]; return [i + (lvl - a) / (b - a), j]; }
    const a = E[j * Ns + i], b = E[(j + 1) * Ns + i]; return [i, j + (lvl - a) / (b - a)];
  };
  const adj = new Map();
  const link = (k1, k2) => {
    if (!adj.has(k1)) adj.set(k1, []); if (!adj.has(k2)) adj.set(k2, []);
    adj.get(k1).push(k2); adj.get(k2).push(k1);
  };
  for (let j = 0; j < Ns - 1; j++) for (let i = 0; i < Ns - 1; i++) {
    const e0 = E[j * Ns + i], e1 = E[j * Ns + i + 1], e2 = E[(j + 1) * Ns + i + 1], e3 = E[(j + 1) * Ns + i];
    const in0 = e0 >= lvl, in1 = e1 >= lvl, in2 = e2 >= lvl, in3 = e3 >= lvl;
    const keys = [];
    if (in0 !== in1) keys.push(`h,${i},${j}`);          // top edge
    if (in1 !== in2) keys.push(`v,${i + 1},${j}`);      // right edge
    if (in3 !== in2) keys.push(`h,${i},${j + 1}`);      // bottom edge
    if (in0 !== in3) keys.push(`v,${i},${j}`);          // left edge
    if (keys.length === 2) link(keys[0], keys[1]);
    else if (keys.length === 4) { link(keys[0], keys[1]); link(keys[2], keys[3]); }
  }

  // 2. chain into polylines (open chains first, then closed loops)
  const used = new Set();
  const chains = [];
  const walk = (start) => {
    const seq = [start]; used.add(start);
    let prev = null, cur = start;
    for (;;) {
      const nb = (adj.get(cur) || []).filter((k) => k !== prev && !used.has(k));
      if (nb.length === 0) break;
      prev = cur; cur = nb[0]; used.add(cur); seq.push(cur);
    }
    return seq;
  };
  for (const [k, nbs] of adj) if (!used.has(k) && nbs.length === 1) chains.push({ pts: walk(k).map(crossing), closed: false });
  for (const k of adj.keys()) if (!used.has(k)) {
    const seq = walk(k);
    const closed = (adj.get(seq[seq.length - 1]) || []).includes(seq[0]);
    chains.push({ pts: seq.map(crossing), closed });
  }

  // 3. resample at one sim cell, smooth along the line (Gaussian, samples), keep open ends fixed
  const smooth = (pts, closed) => {
    // resample by arclength
    const out = [pts[0]]; let carry = 0;
    for (let k = 1; k < pts.length; k++) {
      let [x0, y0] = pts[k - 1]; const [x1, y1] = pts[k];
      let seg = Math.hypot(x1 - x0, y1 - y0);
      while (carry + seg >= 1) {
        const t = (1 - carry) / seg;
        x0 = x0 + (x1 - x0) * t; y0 = y0 + (y1 - y0) * t; seg = Math.hypot(x1 - x0, y1 - y0);
        out.push([x0, y0]); carry = 0;
      }
      carry += seg;
    }
    if (out.length < 3) return out;
    const n = out.length, R = Math.ceil(sigma * 3);
    const res = out.map((p, k) => {
      let sx = 0, sy = 0, sw = 0;
      for (let d = -R; d <= R; d++) {
        let kk = k + d;
        if (closed) kk = ((kk % n) + n) % n; else if (kk < 0 || kk >= n) continue;
        const w = Math.exp(-(d * d) / (2 * sigma * sigma));
        sx += out[kk][0] * w; sy += out[kk][1] * w; sw += w;
      }
      return [sx / sw, sy / sw];
    });
    if (!closed) { res[0] = out[0]; res[n - 1] = out[n - 1]; }
    return res;
  };

  // grid helpers for the mesh heightfield (world metres -> mesh grid)
  const toGrid = (xw, zw) => [(xw / Sm + 0.5) * (Nm - 1), (zw / Sm + 0.5) * (Nm - 1)];
  const bil = (arr, u, w) => {
    u = Math.min(Nm - 1, Math.max(0, u)); w = Math.min(Nm - 1, Math.max(0, w));
    const i = Math.min(Nm - 2, Math.floor(u)), j = Math.min(Nm - 2, Math.floor(w));
    const fu = u - i, fw = w - j;
    const a = arr[j * Nm + i], b = arr[j * Nm + i + 1], c = arr[(j + 1) * Nm + i], d = arr[(j + 1) * Nm + i + 1];
    return (a + (b - a) * fu) * (1 - fw) + (c + (d - c) * fu) * fw;
  };
  const hAt = (xw, zw) => { const [u, w] = toGrid(xw, zw); return bil(H, u, w); };

  const pos = [], nor = [], aux = [], aux2 = [], aux3 = [];
  const sample = (arr, xw, zw) => { if (!arr) return 0; const [u, w] = toGrid(xw, zw); return bil(arr, u, w); };
  const vert = (xw, y, zw, nx, nz) => {
    pos.push(xw, y, zw); nor.push(nx, 0, nz);
    aux.push(sample(mesh.deposit, xw, zw), sample(mesh.flow, xw, zw), sample(mesh.hardness, xw, zw), sample(mesh.cavity, xw, zw));
    aux2.push(sample(mesh.road, xw, zw), sample(mesh.river, xw, zw), sample(mesh.lake, xw, zw), mesh.waterLevel ? sample(mesh.waterLevel, xw, zw) : -1e9);
    aux3.push(sample(mesh.silt, xw, zw), sample(mesh.dirX, xw, zw), sample(mesh.dirZ, xw, zw), 0);
  };

  let triangles = 0, length = 0, maxTurn = 0;
  for (const ch of chains) {
    const P = smooth(ch.pts, ch.closed);
    if (P.length < 2) continue;
    // world coordinates of the samples, tangent and horizontal normal, then the plateau heights either side
    const W = P.map(([sx, sz]) => [(sx / (Ns - 1) - 0.5) * Ss, (sz / (Ns - 1) - 0.5) * Ss]);
    const n = W.length;
    const samp = W.map((p, k) => {
      const a = W[Math.max(0, k - 1)], b = W[Math.min(n - 1, k + 1)];
      let tx = b[0] - a[0], tz = b[1] - a[1]; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      const nx = -tz, nz = tx;
      const side = (s) => {
        let acc = 0, c = 0;
        for (let t = -Td; t <= Td; t += cs) { acc += hAt(p[0] + s * Kd * nx + t * tx, p[1] + s * Kd * nz + t * tz); c++; }
        return acc / c;
      };
      const pp = side(1), pm = side(-1);
      const top = Math.max(pp, pm), bot = Math.min(pp, pm);
      // the wall faces the lower side
      const onn = pp >= pm ? [-nx, -nz] : [nx, nz];
      return { x: p[0], z: p[1], tx, tz, nx: onn[0], nz: onn[1], top, bot, ok: top - bot >= minDrop };
    });
    // Flatten the wall: the plateau heights are noisy sample to sample, which made striped slabs and
    // gaps. Smooth top and foot heights along the line with a wide Gaussian (metres -> samples), then
    // re-derive the drop, so a wall is one clean plane-like face that only stops where it truly ends.
    const hs = v.sdfWallHeightSmooth ?? 12;
    const Rh = Math.ceil(hs * 3);
    const gsm = (key) => samp.map((_, k) => {
      let acc = 0, w = 0;
      for (let d = -Rh; d <= Rh; d++) {
        const kk = k + d;
        if (kk < 0 || kk >= n) continue;
        const g = Math.exp(-(d * d) / (2 * hs * hs));
        acc += samp[kk][key] * g; w += g;
      }
      return acc / w;
    });
    const topS = gsm('top'), botS = gsm('bot');
    samp.forEach((s, k) => { s.top = topS[k]; s.bot = botS[k]; s.ok = s.top - s.bot >= minDrop; });
    for (let k = 0; k + 1 < n; k++) {
      const A = samp[k], B = samp[k + 1];
      if (!A.ok || !B.ok) continue;
      const seg = Math.hypot(B.x - A.x, B.z - A.z);
      length += seg;
      const quad = [
        [A.x, A.bot, A.z], [B.x, B.bot, B.z], [B.x, B.top, B.z], [A.x, A.top, A.z],
      ];
      const ox = (A.nx + B.nx), oz = (A.nz + B.nz);
      const ol = Math.hypot(ox, oz) || 1;
      const onx = ox / ol, onz = oz / ol;
      for (const t of [[0, 1, 2], [0, 2, 3]]) {
        const p0 = quad[t[0]], p1 = quad[t[1]], p2 = quad[t[2]];
        const cx = (p1[1] - p0[1]) * (p2[2] - p0[2]) - (p1[2] - p0[2]) * (p2[1] - p0[1]);
        const cz = (p1[2] - p0[2]) * (p2[0] - p0[0]) - (p1[0] - p0[0]) * (p2[2] - p0[2]);
        const order = cx * onx + cz * onz < 0 ? [t[0], t[2], t[1]] : t;
        for (const q of order) {
          const s = q === 0 || q === 3 ? A : B;
          const top = q === 2 || q === 3;
          vert(s.x, top ? s.top : s.bot, s.z, onx, onz);
        }
        triangles++;
      }
      if (k > 0 && samp[k - 1].ok) {
        const pr = samp[k - 1];
        const dot = pr.tx * A.tx + pr.tz * A.tz;
        maxTurn = Math.max(maxTurn, Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI);
      }
    }
  }
  return {
    triangles, chains: chains.length, length, maxTurn,
    positions: Float32Array.from(pos), normals: Float32Array.from(nor),
    aux: Float32Array.from(aux), aux2: Float32Array.from(aux2), aux3: Float32Array.from(aux3),
  };
}
