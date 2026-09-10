// Naive surface-nets mesher over the SDF + river ribbon builder. DOM-free.
import { clamp01 } from './sdf.js';

// corner offsets for cell (i,j,k): bit0=x, bit1=y, bit2=z
const CORNERS = [[0,0,0],[1,0,0],[0,1,0],[1,1,0],[0,0,1],[1,0,1],[0,1,1],[1,1,1]];
const EDGES = [[0,1],[2,3],[4,5],[6,7],[0,2],[1,3],[4,6],[5,7],[0,4],[1,5],[2,6],[3,7]];

export function surfaceNets(field, opts = {}) {
  const R = field.res, C = R - 1;
  const d = field.d;
  const vid = new Int32Array(C * C * C).fill(-1);
  const pos = [], nrm = [], fl = [], sd = [], hd = [], ao = [];
  const g = [0, 0, 0], pw = [0, 0, 0];
  const cidx = (i, j, k) => (k * C + j) * C + i;
  const nid = (i, j, k) => (k * R + j) * R + i;
  let maxFlow = 1e-6, maxSed = 1e-6;

  for (let k = 0; k < C; k++) {
    for (let j = 0; j < C; j++) {
      for (let i = 0; i < C; i++) {
        const c = [0,0,0,0,0,0,0,0];
        for (let m = 0; m < 8; m++) {
          const o = CORNERS[m];
          c[m] = d[nid(i + o[0], j + o[1], k + o[2])];
        }
        let mask = 0;
        for (let m = 0; m < 8; m++) if (c[m] < 0) mask |= 1 << m;
        if (mask === 0 || mask === 255) continue;
        // average of zero crossings
        let px = 0, py = 0, pz = 0, cnt = 0;
        for (let e = 0; e < 12; e++) {
          const a = c[EDGES[e][0]], b = c[EDGES[e][1]];
          if ((a < 0) === (b < 0)) continue;
          const t = a / (a - b);
          const A = CORNERS[EDGES[e][0]], B = CORNERS[EDGES[e][1]];
          px += A[0] + (B[0] - A[0]) * t;
          py += A[1] + (B[1] - A[1]) * t;
          pz += A[2] + (B[2] - A[2]) * t;
          cnt++;
        }
        if (!cnt) continue;
        field.g2w(i + px / cnt, j + py / cnt, k + pz / cnt, pw);
        pos.push(pw[0], pw[1], pw[2]);
        field.grad(d, pw[0], pw[1], pw[2], g);
        let gl = Math.sqrt(g[0]*g[0] + g[1]*g[1] + g[2]*g[2]);
        if (gl < 1e-6) { g[0] = 0; g[1] = 1; g[2] = 0; gl = 1; }
        const nx = g[0]/gl, ny = g[1]/gl, nz = g[2]/gl;
        nrm.push(nx, ny, nz);
        const f = field.sample(field.flow, pw[0], pw[1], pw[2]);
        const s = field.sample(field.sed, pw[0], pw[1], pw[2]);
        fl.push(f); sd.push(s);
        if (f > maxFlow) maxFlow = f;
        if (s > maxSed) maxSed = s;
        hd.push(field.sample(field.hard, pw[0], pw[1], pw[2]));
        const above = field.sample(d, pw[0] + nx * field.dx * 2, pw[1] + ny * field.dy * 2, pw[2] + nz * field.dx * 2);
        ao.push(clamp01(above / (field.dx * 4)));
        vid[cidx(i, j, k)] = (pos.length / 3) - 1;
      }
    }
  }

  const index = [];
  const qa = [0,0,0], qb = [0,0,0];
  function quad(a, b, c2, dd) {
    if (a < 0 || b < 0 || c2 < 0 || dd < 0) return;
    // orient: geometric normal of (a,b,c) should agree with averaged vertex normals
    const ax = pos[a*3], ay = pos[a*3+1], az = pos[a*3+2];
    const bx = pos[b*3], by = pos[b*3+1], bz = pos[b*3+2];
    const cx = pos[c2*3], cy = pos[c2*3+1], cz = pos[c2*3+2];
    const e1x = bx-ax, e1y = by-ay, e1z = bz-az, e2x = cx-ax, e2y = cy-ay, e2z = cz-az;
    const nx = e1y*e2z - e1z*e2y, ny = e1z*e2x - e1x*e2z, nz = e1x*e2y - e1y*e2x;
    const anx = nrm[a*3]+nrm[b*3]+nrm[c2*3], any = nrm[a*3+1]+nrm[b*3+1]+nrm[c2*3+1], anz = nrm[a*3+2]+nrm[b*3+2]+nrm[c2*3+2];
    if (nx*anx + ny*any + nz*anz < 0) { const t = b; b = dd; dd = t; }
    index.push(a, b, c2, a, c2, dd);
  }
  const sign = (i, j, k) => d[nid(i, j, k)] < 0 ? 1 : 0;
  for (let k = 1; k < C; k++) for (let j = 1; j < C; j++) for (let i = 0; i < C; i++) {
    if (sign(i, j, k) !== sign(i + 1, j, k)) // x-edge
      quad(vid[cidx(i, j - 1, k - 1)], vid[cidx(i, j, k - 1)], vid[cidx(i, j, k)], vid[cidx(i, j - 1, k)]);
  }
  for (let k = 1; k < C; k++) for (let j = 0; j < C; j++) for (let i = 1; i < C; i++) {
    if (sign(i, j, k) !== sign(i, j + 1, k)) // y-edge
      quad(vid[cidx(i - 1, j, k - 1)], vid[cidx(i, j, k - 1)], vid[cidx(i, j, k)], vid[cidx(i - 1, j, k)]);
  }
  for (let k = 0; k < C; k++) for (let j = 1; j < C; j++) for (let i = 1; i < C; i++) {
    if (sign(i, j, k) !== sign(i, j, k + 1)) // z-edge
      quad(vid[cidx(i - 1, j - 1, k)], vid[cidx(i, j - 1, k)], vid[cidx(i, j, k)], vid[cidx(i - 1, j, k)]);
  }

  return {
    positions: new Float32Array(pos), normals: new Float32Array(nrm),
    flow: new Float32Array(fl), sed: new Float32Array(sd),
    hard: new Float32Array(hd), ao: new Float32Array(ao),
    index: (pos.length / 3) > 65535 ? new Uint32Array(index) : new Uint16Array(index),
    maxFlow, maxSed, tris: index.length / 3, verts: pos.length / 3
  };
}

// River ribbon mesh from recorded polylines. river = {pts:[[x,y,z]...], w:[..], q:avg discharge}
export function buildRiverRibbons(rivers, lift = 0.35, uvScale = 0.08) {
  const pos = [], uv = [], qq = [], edge = [], index = [];
  let vi = 0;
  for (const r of rivers) {
    const n = r.pts.length;
    if (n < 3) continue;
    let dist = 0;
    let px = r.pts[0][0], pz = r.pts[0][2];
    for (let i = 0; i < n; i++) {
      const p = r.pts[i];
      const pn = r.pts[Math.min(n - 1, i + 1)], pp = r.pts[Math.max(0, i - 1)];
      let tx = pn[0] - pp[0], tz = pn[2] - pp[2];
      const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      if (i > 0) dist += Math.hypot(p[0] - px, p[2] - pz);
      px = p[0]; pz = p[2];
      const w = Math.max(0.4, (r.w ? r.w[i] : r.width || 1.5));
      const ox = -tz * w * 0.5, oz = tx * w * 0.5;
      const u = dist * uvScale;
      pos.push(p[0] - ox, p[1] + lift, p[2] - oz, p[0] + ox, p[1] + lift, p[2] + oz);
      uv.push(u, 0, u, 1);
      const q = r.q || 1;
      qq.push(q, q); edge.push(0, 1);
      if (i > 0) { const b = vi + (i - 1) * 2; index.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
    }
    vi += n * 2;
  }
  return {
    positions: new Float32Array(pos), uv: new Float32Array(uv),
    q: new Float32Array(qq), edge: new Float32Array(edge),
    index: new Uint32Array(index), count: index.length
  };
}

// Top-down heightfield scan for export / minimaps.
export function scanHeightmap(field, size = 256) {
  const out = new Float32Array(size * size);
  for (let j = 0; j < size; j++) {
    const z = -field.hx + (j / (size - 1)) * 2 * field.hx;
    for (let i = 0; i < size; i++) {
      const x = -field.hx + (i / (size - 1)) * 2 * field.hx;
      out[j * size + i] = field.findSurface(x, z) ?? -1;
    }
  }
  return out;
}
