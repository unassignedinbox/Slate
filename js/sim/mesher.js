// Marching tetrahedra mesher with edge-welded vertices, analytic SDF normals,
// and cached per-vertex attributes for instant recoloring.
import { clamp } from './sdf.js';

// 6-tet decomposition of a cube (corners c0..c7), all sharing diagonal c0-c7.
const TETS = [
  [0, 1, 3, 7], [0, 1, 7, 5], [0, 5, 7, 4],
  [0, 3, 2, 7], [0, 2, 6, 7], [0, 6, 4, 7],
];
const CO = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
const E01 = 0, E02 = 1, E03 = 2, E12 = 3, E13 = 4, E23 = 5;
// mask (bit i = tet-vertex i inside) -> triangle edge triples (orientation fixed later via gradient)
const TET_TABLE = {
  1: [[E01, E02, E03]], 2: [[E01, E12, E13]], 4: [[E02, E12, E23]], 8: [[E03, E13, E23]],
  3: [[E02, E03, E13], [E02, E13, E12]], 5: [[E01, E03, E23], [E01, E23, E12]],
  9: [[E01, E02, E23], [E01, E23, E13]], 6: [[E01, E03, E23], [E01, E23, E02]],
  10: [[E01, E02, E23], [E01, E23, E13]], 12: [[E02, E01, E13], [E02, E13, E23]],
  7: [[E03, E13, E23]], 11: [[E02, E23, E12]], 13: [[E01, E12, E13]], 14: [[E01, E02, E03]],
};

export function surfaceMesh(field, opts = {}) {
  const { nx, ny, nz, vox } = field;
  const den = field.den;
  const at = (x, y, z) => den[x + nx * (z + nz * y)];
  const cornerId = (x, y, z) => x + nx * (z + nz * y);
  const positions = [];
  const edgeVert = new Map(); // primal-edge key -> vertex index
  const indices = [];
  const g = [0, 0, 0];
  const tmp = [0, 0, 0];
  function vertOnEdge(ax, ay, az, bx, by, bz) {
    let idA = cornerId(ax, ay, az), idB = cornerId(bx, by, bz);
    if (idA > idB) { const t = idA; idA = idB; idB = t; }
    const key = idA * 2200000 + idB;
    let vi = edgeVert.get(key);
    if (vi !== undefined) return vi;
    const da = den[idA], db = den[idB];
    const t = da === db ? 0.5 : clamp(da / (da - db), 0, 1);
    // voxel coords of endpoints a (need original order for position — recompute):
    const pax = ax + (bx - ax) * t, pay = ay + (by - ay) * t, paz = az + (bz - az) * t;
    vi = positions.length / 3;
    positions.push((pax + 0.5) * vox - field.sx / 2, field.y0 + (pay + 0.5) * vox, (paz + 0.5) * vox - field.sz / 2);
    edgeVert.set(key, vi);
    return vi;
  }
  const cellD = new Float32Array(8);
  const tetV = new Int32Array(4);
  for (let y = 0; y < ny - 1; y++) {
    for (let z = 0; z < nz - 1; z++) {
      for (let x = 0; x < nx - 1; x++) {
        for (let c = 0; c < 8; c++) cellD[c] = at(x + CO[c][0], y + CO[c][1], z + CO[c][2]);
        let mask = 0;
        for (let c = 0; c < 8; c++) if (cellD[c] > 0) mask |= 1 << c;
        if (mask === 0 || mask === 255) continue;
        for (const T of TETS) {
          let tm = 0;
          for (let k = 0; k < 4; k++) { tetV[k] = T[k]; if (cellD[T[k]] > 0) tm |= 1 << k; }
          const tris = TET_TABLE[tm];
          if (!tris) continue;
          // tet vertex coords
          const P = [];
          for (let k = 0; k < 4; k++) {
            const c = CO[tetV[k]];
            P.push([x + c[0], y + c[1], z + c[2]]);
          }
          const edgePt = (e) => {
            let A, B;
            if (e === E01) { A = P[0]; B = P[1]; } else if (e === E02) { A = P[0]; B = P[2]; }
            else if (e === E03) { A = P[0]; B = P[3]; } else if (e === E12) { A = P[1]; B = P[2]; }
            else if (e === E13) { A = P[1]; B = P[3]; } else { A = P[2]; B = P[3]; }
            return vertOnEdge(A[0], A[1], A[2], B[0], B[1], B[2]);
          };
          for (const [e0, e1, e2] of tris) {
            const a = edgePt(e0), b = edgePt(e1), c = edgePt(e2);
            // orient: outward normal = -grad(density). Flip if facing inward.
            const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
            const bx = positions[b * 3], by = positions[b * 3 + 1], bz = positions[b * 3 + 2];
            const cx = positions[c * 3], cy = positions[c * 3 + 1], cz = positions[c * 3 + 2];
            const ux = bx - ax, uy = by - ay, uz = bz - az;
            const vx = cx - ax, vy = cy - ay, vz = cz - az;
            let fnx = uy * vz - uz * vy, fny = uz * vx - ux * vz, fnz = ux * vy - uy * vx;
            const cc = field.worldToVox((ax + bx + cx) / 3, (ay + by + cy) / 3, (az + bz + cz) / 3);
            field.gradAt(cc[0], cc[1], cc[2], g);
            // want face normal · (-g) > 0
            if (fnx * -g[0] + fny * -g[1] + fnz * -g[2] < 0) indices.push(a, c, b);
            else indices.push(a, b, c);
          }
        }
      }
    }
    if (opts.onProgress && (y & 31) === 0) opts.onProgress(y / (ny - 1));
  }
  const nv = positions.length / 3;
  const pos = new Float32Array(positions);
  const normals = new Float32Array(nv * 3);
  const attr = { slope: new Float32Array(nv), sed: new Float32Array(nv), wet: new Float32Array(nv), hard: new Float32Array(nv), h: new Float32Array(nv) };
  for (let i = 0; i < nv; i++) {
    const cc = field.worldToVox(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    field.gradAt(cc[0], cc[1], cc[2], g);
    const l = Math.hypot(g[0], g[1], g[2]) || 1;
    const nx_ = -g[0] / l, ny_ = -g[1] / l, nz_ = -g[2] / l;
    normals[i * 3] = nx_; normals[i * 3 + 1] = ny_; normals[i * 3 + 2] = nz_;
    attr.slope[i] = clamp(1 - ny_, 0, 1);
    attr.sed[i] = field.sample(field.sed, cc[0], cc[1], cc[2]);
    attr.wet[i] = clamp(field.sample(field.wet, cc[0], cc[1], cc[2]), 0, 1.5);
    attr.hard[i] = field.sample(field.hard, cc[0], cc[1], cc[2]);
    attr.h[i] = pos[i * 3 + 1];
  }
  return { positions: pos, normals, indices: new Uint32Array(indices), attr, nv, tris: indices.length / 3 };
}

export const COLOR_MODES = ['material', 'height', 'slope', 'sediment', 'wetness', 'hardness'];

// Material model: strata rock + cliff/soil split + sediment/sand + wetness + snow + underwater sand.
export function colorize(mesh, field, mode, seaLevel, snowline) {
  const { nv, attr } = mesh;
  const colors = new Float32Array(nv * 3);
  const ymin = field.y0, ymax = field.y0 + field.sy;
  for (let i = 0; i < nv; i++) {
    const h = attr.h[i], sl = attr.slope[i], sed = attr.sed[i], wet = clamp(attr.wet[i], 0, 1), hard = attr.hard[i];
    let r, g, b;
    if (mode === 'height') {
      const t = clamp((h - ymin) / (ymax - ymin), 0, 1);
      [r, g, b] = ramp([[0.05, 0.1, 0.35], [0.1, 0.5, 0.7], [0.2, 0.7, 0.3], [0.7, 0.7, 0.3], [0.6, 0.35, 0.2], [0.9, 0.9, 0.95]], t);
    } else if (mode === 'slope') {
      [r, g, b] = ramp([[0.1, 0.6, 0.2], [0.9, 0.85, 0.2], [0.85, 0.25, 0.1]], clamp(sl * 1.4, 0, 1));
    } else if (mode === 'sediment') {
      const t = clamp(sed * 2.2, 0, 1);
      [r, g, b] = ramp([[0.08, 0.08, 0.1], [0.5, 0.35, 0.15], [1, 0.85, 0.5]], t);
    } else if (mode === 'wetness') {
      [r, g, b] = ramp([[0.1, 0.1, 0.12], [0.1, 0.35, 0.8], [0.5, 0.9, 1]], wet);
    } else if (mode === 'hardness') {
      [r, g, b] = ramp([[0.9, 0.8, 0.5], [0.5, 0.3, 0.2], [0.25, 0.25, 0.3]], clamp(hard, 0, 1));
    } else {
      // strata bands in rock
      const band = 0.5 + 0.5 * Math.sin(h * 1.1 + 0.4 * Math.sin(h * 3.1));
      let rr = 0.42 + band * 0.1, gg = 0.3 + band * 0.07, bb = 0.22 + band * 0.05;
      // cliff vs soil/grass by slope
      const rockW = clamp((sl - 0.18) / 0.35, 0, 1);
      const grass = [0.25 + hard * 0.1, 0.42, 0.18];
      rr = grass[0] + (rr - grass[0]) * rockW;
      gg = grass[1] + (gg - grass[1]) * rockW;
      bb = grass[2] + (bb - grass[2]) * rockW;
      // fresh sediment / sand
      const s = clamp(sed * 2.0, 0, 1);
      rr = rr + (0.82 - rr) * s * 0.85; gg = gg + (0.7 - gg) * s * 0.85; bb = bb + (0.5 - bb) * s * 0.85;
      // underwater sand
      if (h < seaLevel) { const t = clamp((seaLevel - h) / 4, 0, 1) * 0.7; rr += (0.76 - rr) * t; gg += (0.7 - gg) * t; bb += (0.55 - bb) * t; }
      // snow on high flats
      if (h > snowline && sl < 0.45) { const t = clamp((h - snowline) / 6, 0, 1) * clamp((0.45 - sl) / 0.3, 0, 1); rr += (0.93 - rr) * t; gg += (0.94 - gg) * t; bb += (0.97 - bb) * t; }
      // wetness darkens
      const dk = 1 - wet * 0.45;
      r = rr * dk; g = gg * dk; b = bb * dk;
    }
    colors[i * 3] = r; colors[i * 3 + 1] = g; colors[i * 3 + 2] = b;
  }
  return colors;
}
function ramp(stops, t) {
  const x = clamp(t, 0, 1) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i, a = stops[i], b = stops[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

export function meshToOBJ(mesh) {
  const { positions, normals, indices } = mesh;
  const cols = mesh.colors;
  const nv = positions.length / 3;
  const lines = ['# Slate Terrain Lab export'];
  for (let i = 0; i < nv; i++) {
    if (cols) lines.push(`v ${positions[i * 3].toFixed(4)} ${positions[i * 3 + 1].toFixed(4)} ${positions[i * 3 + 2].toFixed(4)} ${cols[i * 3].toFixed(3)} ${cols[i * 3 + 1].toFixed(3)} ${cols[i * 3 + 2].toFixed(3)}`);
    else lines.push(`v ${positions[i * 3].toFixed(4)} ${positions[i * 3 + 1].toFixed(4)} ${positions[i * 3 + 2].toFixed(4)}`);
  }
  for (let i = 0; i < nv; i++) lines.push(`vn ${normals[i * 3].toFixed(4)} ${normals[i * 3 + 1].toFixed(4)} ${normals[i * 3 + 2].toFixed(4)}`);
  for (let t = 0; t < indices.length; t += 3) lines.push(`f ${indices[t] + 1}//${indices[t] + 1} ${indices[t + 1] + 1}//${indices[t + 1] + 1} ${indices[t + 2] + 1}//${indices[t + 2] + 1}`);
  return lines.join('\n');
}
