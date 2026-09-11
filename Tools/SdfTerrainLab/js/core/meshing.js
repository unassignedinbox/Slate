// Surface-nets polygonizer over the SDF volume + vertex attribute baking.
// Produces raw arrays (renderer-agnostic); the viewport uploads them to three.js.
import { MAT } from './sdf.js';

// Surface nets: one vertex per sign-changing cell, quads stitched between neighbours.
export function surfaceNets(vol, opts = {}) {
  const { nx, ny, nz } = vol;
  const t0 = now();
  const dom = vol.dom;
  // Nodal field: SDF sampled at grid corners. Every sign-changing grid edge is
  // then surrounded by 4 cubes that provably contain vertices (classic result),
  // so no quad is ever skipped and no vertex orphaned.
  const gx = nx + 1, gy = ny + 1, gz = nz + 1;
  const node = new Float32Array(gx * gy * gz);
  let p = 0;
  for (let iy = 0; iy < gy; iy++) {
    const y = dom.y0 + iy * vol.vy;
    for (let iz = 0; iz < gz; iz++) {
      const z = dom.z0 + iz * vol.vz;
      for (let ix = 0; ix < gx; ix++, p++) node[p] = vol.sampleDist(dom.x0 + ix * vol.vx, y, z);
    }
  }
  const N = (x, y, z) => node[(y * gz + z) * gx + x];
  const insideN = (x, y, z) => N(x, y, z) < 0;
  const cidx = (x, y, z) => (y * nz + z) * nx + x;

  // pass 1: one vertex per sign-changing cube, at the mean of its edge crossings
  const indexOf = new Int32Array(nx * ny * nz).fill(-1);
  const pos = [];
  const vid = []; // vertex → voxel id (for recolor/debug)
  const CO = [[0, 0, 0], [1, 0, 0], [0, 0, 1], [1, 0, 1], [0, 1, 0], [1, 1, 0], [0, 1, 1], [1, 1, 1]];
  const CE = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  for (let y = 0; y < ny; y++) {
    for (let z = 0; z < nz; z++) {
      for (let x = 0; x < nx; x++) {
        const d0 = N(x, y, z), d1 = N(x + 1, y, z), d2 = N(x, y, z + 1), d3 = N(x + 1, y, z + 1);
        const d4 = N(x, y + 1, z), d5 = N(x + 1, y + 1, z), d6 = N(x, y + 1, z + 1), d7 = N(x + 1, y + 1, z + 1);
        const dd = [d0, d1, d2, d3, d4, d5, d6, d7];
        let mask = 0;
        for (let c = 0; c < 8; c++) if (dd[c] < 0) mask |= (1 << c);
        if (mask === 0 || mask === 255) continue;
        let px = 0, py = 0, pz = 0, m = 0;
        for (let e = 0; e < 12; e++) {
          const a = CE[e][0], b = CE[e][1];
          if ((dd[a] < 0) === (dd[b] < 0)) continue;
          const t = dd[a] / (dd[a] - dd[b]);
          px += CO[a][0] + (CO[b][0] - CO[a][0]) * t;
          py += CO[a][1] + (CO[b][1] - CO[a][1]) * t;
          pz += CO[a][2] + (CO[b][2] - CO[a][2]) * t;
          m++;
        }
        if (!m) continue;
        pos.push(dom.x0 + (x + px / m) * vol.vx, dom.y0 + (y + py / m) * vol.vy, dom.z0 + (z + pz / m) * vol.vz);
        indexOf[cidx(x, y, z)] = (pos.length / 3) - 1;
        vid.push(cidx(x, y, z));
      }
    }
  }
  // pass 2: one quad per sign-changing grid edge; winding follows the flip side
  const quads = [];
  const V = (x, y, z) => (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) ? -1 : indexOf[cidx(x, y, z)];
  for (let y = 0; y < ny; y++) {
    for (let z = 0; z < nz; z++) {
      for (let x = 0; x < nx; x++) {
        // X edge (x,y,z)→(x+1,y,z): outward +X iff solid at −x (away from solid)
        if (y > 0 && z > 0) {
          const s0 = insideN(x, y, z), s1 = insideN(x + 1, y, z);
          if (s0 !== s1) {
            const a = V(x, y, z), b = V(x, y, z - 1), c = V(x, y - 1, z - 1), e = V(x, y - 1, z);
            if (a >= 0 && b >= 0 && c >= 0 && e >= 0) {
              if (s0) quads.push(a, c, b, a, e, c);
              else quads.push(a, b, c, a, c, e);
            }
          }
        }
        // Y edge (x,y,z)→(x,y+1,z): outward −Y iff inside above
        if (x > 0 && z > 0) {
          const s0 = insideN(x, y, z), s1 = insideN(x, y + 1, z);
          if (s0 !== s1) {
            const a = V(x, y, z), b = V(x, y, z - 1), c = V(x - 1, y, z - 1), e = V(x - 1, y, z);
            if (a >= 0 && b >= 0 && c >= 0 && e >= 0) {
              if (s1) quads.push(a, e, c, a, c, b);   // solid above → face down
              else quads.push(a, c, e, a, b, c);      // solid below → face up
            }
          }
        }
        // Z edge (x,y,z)→(x,y,z+1): outward +Z iff solid at −z (away from solid)
        if (x > 0 && y > 0) {
          const s0 = insideN(x, y, z), s1 = insideN(x, y, z + 1);
          if (s0 !== s1) {
            const a = V(x, y, z), b = V(x, y - 1, z), c = V(x - 1, y - 1, z), e = V(x - 1, y, z);
            if (a >= 0 && b >= 0 && c >= 0 && e >= 0) {
              if (s0) quads.push(a, e, c, a, c, b);
              else quads.push(a, c, e, a, b, c);
            }
          }
        }
      }
    }
  }
  const positions = new Float32Array(pos);
  const indices = new Uint32Array(quads);
  // smooth normals by face accumulation (fast; shared verts → smooth shading)
  const normals = new Float32Array(positions.length);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const wx = positions[c] - positions[a], wy = positions[c + 1] - positions[a + 1], wz = positions[c + 2] - positions[a + 2];
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const L = Math.hypot(nx, ny, nz);
    if (L > 1e-12) { nx /= L; ny /= L; nz /= L; }
    normals[a] += nx; normals[a + 1] += ny; normals[a + 2] += nz;
    normals[b] += nx; normals[b + 1] += ny; normals[b + 2] += nz;
    normals[c] += nx; normals[c + 1] += ny; normals[c + 2] += nz;
  }
  for (let i = 0; i < normals.length; i += 3) {
    const L = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
    normals[i] /= L; normals[i + 1] /= L; normals[i + 2] /= L;
  }
  // runtime winding guard: majority vote of spread samples vs the SDF gradient
  if (indices.length >= 3 && positions.length >= 3) {
    const g = [0, 0, 0];
    const nv = positions.length / 3;
    let votes = 0, total = 0;
    for (let v = 0; v < nv && total < 9; v += Math.max(1, Math.floor(nv / 9)), total++) {
      vol.gradient(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2], g);
      votes += (g[0] * normals[v * 3] + g[1] * normals[v * 3 + 1] + g[2] * normals[v * 3 + 2]) > 0 ? 1 : -1;
    }
    if (votes < 0) {
      for (let t = 0; t < indices.length; t += 3) {
        const tmp = indices[t + 1]; indices[t + 1] = indices[t + 2]; indices[t + 2] = tmp;
      }
      for (let i = 0; i < normals.length; i++) normals[i] = -normals[i];
    }
  }
  const mesh = {
    positions, normals, indices, voxelOf: new Int32Array(vid),
    ms: now() - t0, colors: null, mode: 'full',
  };
  bakeColors(vol, mesh, opts.mode || 'full', opts);
  return mesh;
}

function now() { return (typeof performance !== 'undefined' ? performance : Date).now(); }

// ── coloring ──
const C = {
  rock: [0.42, 0.36, 0.31], rockDark: [0.23, 0.20, 0.19],
  sand: [0.82, 0.68, 0.45], soil: [0.36, 0.28, 0.19],
  sed: [0.55, 0.45, 0.32], clay: [0.58, 0.36, 0.26],
  grass: [0.32, 0.47, 0.22], grassDry: [0.52, 0.50, 0.28],
  snow: [0.90, 0.92, 0.96],
};
const MAT_ID_COLORS = [
  [0.55, 0.42, 0.38], [0.90, 0.75, 0.45], [0.35, 0.55, 0.30],
  [0.80, 0.60, 0.35], [0.70, 0.35, 0.30], [0.92, 0.94, 0.97],
];

export function bakeColors(vol, mesh, mode, opts = {}) {
  const n = mesh.positions.length / 3;
  const col = new Float32Array(n * 3);
  const snowY = opts.snowY ?? 46, grassUpTo = opts.grassUpTo ?? 34;
  let fluxMax = 1e-9;
  if (mode === 'flux') for (let i = 0; i < vol.flux.length; i += 3) if (vol.flux[i] > fluxMax) fluxMax = vol.flux[i];
  for (let v = 0; v < n; v++) {
    const id = mesh.voxelOf[v];
    const x = mesh.positions[v * 3], y = mesh.positions[v * 3 + 1], z = mesh.positions[v * 3 + 2];
    const ny = mesh.normals[v * 3 + 1];
    const slope = 1 - Math.abs(ny);
    let r, g, b;
    if (mode === 'clay') { r = g = b = 0.72; }
    else if (mode === 'flux') {
      const f = Math.min(vol.flux[id] / fluxMax, 1);
      const t = Math.pow(f, 0.35);
      r = 0.05 + t * 0.3; g = 0.10 + t * 0.65; b = 0.16 + t * 0.84;
    }
    else if (mode === 'wet') { const w = vol.wet[id]; r = 0.06 + w * 0.2; g = 0.12 + w * 0.5; b = 0.22 + w * 0.75; }
    else if (mode === 'sed') { const s = Math.min(vol.sed[id] * 4, 1); r = 0.10 + s * 0.75; g = 0.08 + s * 0.55; b = 0.06 + s * 0.25; }
    else if (mode === 'mat') { const c = MAT_ID_COLORS[vol.mat[id] % 6]; r = c[0]; g = c[1]; b = c[2]; }
    else if (mode === 'normal') { r = mesh.normals[v * 3] * 0.5 + 0.5; g = ny * 0.5 + 0.5; b = mesh.normals[v * 3 + 2] * 0.5 + 0.5; }
    else {
      // — full look: material base → strata banding → slope rock → grass/snow → wetness —
      const m = vol.mat[id];
      let base;
      if (m === MAT.SAND) base = C.sand;
      else if (m === MAT.SOIL) base = C.soil;
      else if (m === MAT.SEDIMENT) base = C.sed;
      else if (m === MAT.CLAY) base = C.clay;
      else if (m === MAT.SNOW) base = C.snow;
      else base = C.rock;
      // sedimentary strata on steep rock
      let strata = 0;
      if (m === MAT.ROCK && slope > 0.35) {
        strata = 0.5 + 0.5 * Math.sin(y * 1.4 + Math.sin(x * 0.11) * 2 + Math.sin(z * 0.13) * 1.6);
        strata = Math.pow(strata, 3) * 0.35;
      }
      const rockiness = Math.min(slope / 0.42, 1);
      r = base[0]; g = base[1]; b = base[2];
      r = r + (C.rockDark[0] + strata * 0.5 - r) * rockiness;
      g = g + (C.rockDark[1] + strata * 0.42 - g) * rockiness;
      b = b + (C.rockDark[2] + strata * 0.36 - b) * rockiness;
      // vegetation on gentle low soil/sediment
      if (slope < 0.38 && y < grassUpTo && (m === MAT.SOIL || m === MAT.SEDIMENT || m === MAT.CLAY)) {
        const veg = (1 - slope / 0.38) * Math.min(Math.max((grassUpTo - y) / 12, 0), 1);
        const dry = 0.5 + 0.5 * Math.sin(x * 0.23 + z * 0.31);
        const gr = [C.grass[0] + (C.grassDry[0] - C.grass[0]) * dry * 0.6,
                    C.grass[1] + (C.grassDry[1] - C.grass[1]) * dry * 0.6,
                    C.grass[2] + (C.grassDry[2] - C.grass[2]) * dry * 0.6];
        r += (gr[0] - r) * veg * 0.9; g += (gr[1] - g) * veg * 0.9; b += (gr[2] - b) * veg * 0.9;
      }
      // snow caps
      if (y > snowY && slope < 0.45) {
        const s = Math.min((y - snowY) / 6, 1) * (1 - slope / 0.45);
        r += (C.snow[0] - r) * s; g += (C.snow[1] - g) * s; b += (C.snow[2] - b) * s;
      }
      // wetness darkening + flux sheen
      const w = vol.wet[id];
      if (w > 0.01) { const dk = 1 - w * 0.42; r *= dk; g *= dk; b *= dk; }
      // grain
      const gr2 = 1 + (hash(v) - 0.5) * 0.07;
      r *= gr2; g *= gr2; b *= gr2;
    }
    col[v * 3] = r; col[v * 3 + 1] = g; col[v * 3 + 2] = b;
  }
  mesh.colors = col;
  mesh.mode = mode;
  return mesh;
}

function hash(i) {
  let h = (i * 374761393 + 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
