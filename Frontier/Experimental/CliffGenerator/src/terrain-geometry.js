// Builds the terrain surface (and the block skirt) as indexed BufferGeometry.
// Vertex layout: position, normal, aux = (deposit, flow, hardness, cavity).

import * as THREE from 'three';

import { SimplexNoise, GradientNoise3 } from './noise.js';

// Face displacement: moves vertices horizontally along the outward face normal so that hard beds
// stand proud of the face and soft beds are recessed. Because this is applied to the mesh (not the
// heightfield) it produces genuine overhangs, ledges and alcoves that a heightmap cannot represent.
export function makeDisplacement(field, v) {
  const { resolution: N, worldSize: size } = field;
  const cell = size / (N - 1);
  const noise = new SimplexNoise((v.seed || 1) * 13 + 5);
  const overhang = v.overhang || 0;
  const buttress = v.buttress || 0;
  const ledge = v.ledgeNoise || 0;
  // Keep displacement below the cell size so the grid never folds over itself.
  const limit = cell * 0.85;
  return {
    limit,
    // returns horizontal offset (dx, dz) and a small vertical sag for a grid vertex
    at(i, j, nx, ny, nz, hardness, x, z, h) {
      const steep = Math.min(1, Math.max(0, (1 - ny - 0.25) / 0.45)); // 0 below ~40°, 1 above ~70°
      if (steep <= 0 || overhang + buttress <= 0) return [0, 0, 0];
      const hl = Math.hypot(nx, nz) || 1e-6;
      const ox = nx / hl, oz = nz / hl;
      // caprock out, soft beds in; notch the ledges with noise so they are not continuous shelves
      let bed = (hardness - 0.45) * 2;
      const notch = noise.fbm(x * 0.03 + h * 0.05, z * 0.03, 3);
      bed *= 1 - ledge * 0.6 * Math.max(0, notch);
      let d = bed * overhang;
      // large buttresses / alcoves
      d += buttress * noise.fbm(x * 0.006, z * 0.006 + h * 0.004, 3) * limit * 1.4;
      d = Math.max(-limit, Math.min(limit, d)) * steep;
      // a lip sags slightly under its own weight
      const sag = Math.min(0, -Math.max(0, d) * 0.15);
      return [ox * d, oz * d, sag];
    },
  };
}


// Catmull-Rom bicubic upsampling of every field map, so the mesh can carry more vertices than the
// simulated heightfield (erosion cost grows with N², mesh detail is cheap by comparison).
const MAX_MESH_SIDE = 2049;
export function meshSubdivision(field, v) {
  const want = Math.max(1, Math.round(v.meshSubdivision || 1));
  const maxK = Math.max(1, Math.floor((MAX_MESH_SIDE - 1) / (field.resolution - 1)));
  return Math.min(want, maxK);
}
function cubic(p0, p1, p2, p3, t) {
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
}
function upsampleMap(src, N, k, smoothOnly) {
  const M = (N - 1) * k + 1;
  const out = new Float32Array(M * M);
  const at = (i, j) => src[Math.min(N - 1, Math.max(0, j)) * N + Math.min(N - 1, Math.max(0, i))];
  const col = new Float32Array(4);
  for (let J = 0; J < M; J++) {
    const gj = J / k, j = Math.min(N - 2, Math.floor(gj)), tj = gj - j;
    for (let I = 0; I < M; I++) {
      const gi = I / k, i = Math.min(N - 2, Math.floor(gi)), ti = gi - i;
      if (smoothOnly) {
        // bilinear for the auxiliary maps (no overshoot on masks)
        out[J * M + I] = at(i, j) * (1 - ti) * (1 - tj) + at(i + 1, j) * ti * (1 - tj) + at(i, j + 1) * (1 - ti) * tj + at(i + 1, j + 1) * ti * tj;
      } else {
        for (let r = -1; r <= 2; r++) col[r + 1] = cubic(at(i - 1, j + r), at(i, j + r), at(i + 1, j + r), at(i + 2, j + r), ti);
        out[J * M + I] = cubic(col[0], col[1], col[2], col[3], tj);
      }
    }
  }
  return out;
}
export function refineField(field, v) {
  const k = meshSubdivision(field, v);
  if (k <= 1) return field;
  if (field._refined && field._refined.k === k) return field._refined.field;
  const N = field.resolution;
  const fine = {
    resolution: (N - 1) * k + 1,
    worldSize: field.worldSize,
    height: upsampleMap(field.height, N, k, false),
    hardness: upsampleMap(field.hardness, N, k, true),
    deposit: upsampleMap(field.deposit, N, k, true),
    flow: upsampleMap(field.flow, N, k, true),
    cavity: upsampleMap(field.cavity, N, k, true),
    slope: upsampleMap(field.slope, N, k, true),
    stats: field.stats,
    base: field,
  };
  field._refined = { k, field: fine };
  return fine;
}

// Fine relief added along the surface normal: rock bumps / knobs on steep faces, gentle hummocks on
// flat ground. Independent of the heightfield so it survives any resolution.
export function makeDetail(field, v) {
  const amp = v.detailRelief || 0;
  const scale = Math.max(0.5, v.detailScale || 6);
  const cliffBias = v.detailCliffBias == null ? 0.8 : v.detailCliffBias;
  if (amp <= 0) return { amp: 0, at: () => 0 };
  const noise = new GradientNoise3((v.seed || 1) * 31 + 11);
  const cell = field.worldSize / (field.resolution - 1);
  const limit = cell * 0.9;
  return {
    amp,
    at(x, y, z, ny, hardness) {
      const steep = Math.min(1, Math.max(0, (1 - ny - 0.2) / 0.4));
      const weight = (1 - cliffBias) + cliffBias * steep;
      if (weight <= 0.001) return 0;
      const n = noise.fbm(x / scale, y / scale, z / scale, 3, 2.1, 0.55);
      // harder beds knobbly, softer beds smoother
      const d = n * amp * weight * (0.6 + 0.6 * hardness);
      return Math.max(-limit, Math.min(limit, d));
    },
  };
}

export function buildTerrainGeometry(field, v = {}) {
  const { resolution: N, worldSize: size, height, deposit, flow, hardness, cavity } = field;
  const cell = size / (N - 1);
  const count = N * N;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const aux = new Float32Array(count * 4);
  const disp = makeDisplacement(field, v);
  const detail = makeDetail(field, v);
  const fadeCells = 3;

  for (let j = 0; j < N; j++) {
    const z = (j / (N - 1) - 0.5) * size;
    const j0 = Math.max(0, j - 1), j1 = Math.min(N - 1, j + 1);
    for (let i = 0; i < N; i++) {
      const idx = j * N + i;
      const x = (i / (N - 1) - 0.5) * size;
      const i0 = Math.max(0, i - 1), i1 = Math.min(N - 1, i + 1);
      const dx = (height[j * N + i1] - height[j * N + i0]) / ((i1 - i0) * cell);
      const dz = (height[j1 * N + i] - height[j0 * N + i]) / ((j1 - j0) * cell);
      const nx = -dx, ny = 1, nz = -dz;
      const inv = 1 / Math.hypot(nx, ny, nz);
      const edge = i === 0 || j === 0 || i === N - 1 || j === N - 1;
      const [ox, oz, sag] = edge ? [0, 0, 0] : disp.at(i, j, nx * inv, ny * inv, nz * inv, hardness[idx], x, z, height[idx]);
      let det = 0;
      if (detail.amp > 0 && !edge) {
        const border = Math.min(i, j, N - 1 - i, N - 1 - j) / fadeCells;
        det = detail.at(x, height[idx], z, ny * inv, hardness[idx]) * Math.min(1, border);
      }
      positions[idx * 3] = x + ox + nx * inv * det;
      positions[idx * 3 + 1] = height[idx] + sag + ny * inv * det;
      positions[idx * 3 + 2] = z + oz + nz * inv * det;
      normals[idx * 3] = nx * inv;
      normals[idx * 3 + 1] = ny * inv;
      normals[idx * 3 + 2] = nz * inv;
      aux[idx * 4] = deposit[idx];
      aux[idx * 4 + 1] = flow[idx];
      aux[idx * 4 + 2] = hardness[idx];
      aux[idx * 4 + 3] = cavity[idx];
    }
  }

  const indices = new Uint32Array((N - 1) * (N - 1) * 6);
  let k = 0;
  for (let j = 0; j < N - 1; j++) {
    for (let i = 0; i < N - 1; i++) {
      const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
      // Alternate the diagonal to avoid a directional bias on steep faces.
      if ((i + j) & 1) {
        indices[k++] = a; indices[k++] = c; indices[k++] = b;
        indices[k++] = b; indices[k++] = c; indices[k++] = d;
      } else {
        indices[k++] = a; indices[k++] = c; indices[k++] = d;
        indices[k++] = a; indices[k++] = d; indices[k++] = b;
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('aux', new THREE.BufferAttribute(aux, 4));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  if ((v.overhang || 0) + (v.buttress || 0) + (v.detailRelief || 0) > 0) {
    // displaced faces need true mesh normals; blend with the heightfield normal to keep them smooth
    const smooth = normals.slice();
    geometry.computeVertexNormals();
    const mesh = geometry.getAttribute('normal').array;
    for (let n = 0; n < mesh.length; n += 3) {
      const x = mesh[n] * 0.75 + smooth[n] * 0.25, y = mesh[n + 1] * 0.75 + smooth[n + 1] * 0.25, z = mesh[n + 2] * 0.75 + smooth[n + 2] * 0.25;
      const l = 1 / (Math.hypot(x, y, z) || 1);
      mesh[n] = x * l; mesh[n + 1] = y * l; mesh[n + 2] = z * l;
    }
  }
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return geometry;
}

// Vertical walls around the tile so the terrain reads as a cut block of ground.
export function buildSkirtGeometry(field, floorY) {
  const { resolution: N, worldSize: size, height, hardness } = field;
  const edges = [
    { count: N, at: (t) => [t, 0], normal: [0, 0, -1] },            // north  (j = 0)
    { count: N, at: (t) => [N - 1 - t, N - 1], normal: [0, 0, 1] }, // south  (j = N-1)
    { count: N, at: (t) => [0, N - 1 - t], normal: [-1, 0, 0] },    // west   (i = 0)
    { count: N, at: (t) => [N - 1, t], normal: [1, 0, 0] },         // east   (i = N-1)
  ];
  const positions = [], normals = [], aux = [], indices = [];
  let base = 0;
  for (const edge of edges) {
    for (let t = 0; t < edge.count; t++) {
      const [i, j] = edge.at(t);
      const x = (i / (N - 1) - 0.5) * size;
      const z = (j / (N - 1) - 0.5) * size;
      const idx = j * N + i;
      positions.push(x, height[idx], z, x, floorY, z);
      normals.push(...edge.normal, ...edge.normal);
      aux.push(0, 0, hardness[idx], 0, 0, 0, hardness[idx], 0);
    }
    for (let t = 0; t < edge.count - 1; t++) {
      const a = base + t * 2, b = a + 1, c = a + 2, d = a + 3;
      indices.push(a, b, c, b, d, c);
    }
    base += edge.count * 2;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('aux', new THREE.Float32BufferAttribute(aux, 4));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

// Bilinear sampling helpers for rock placement.
export function makeSampler(field) {
  const { resolution: N, worldSize: size } = field;
  const toGrid = (x, z) => [((x / size) + 0.5) * (N - 1), ((z / size) + 0.5) * (N - 1)];
  const bilinear = (arr, gx, gz) => {
    const i = Math.max(0, Math.min(N - 2, Math.floor(gx)));
    const j = Math.max(0, Math.min(N - 2, Math.floor(gz)));
    const u = Math.min(1, Math.max(0, gx - i)), v = Math.min(1, Math.max(0, gz - j));
    const idx = j * N + i;
    return arr[idx] * (1 - u) * (1 - v) + arr[idx + 1] * u * (1 - v) + arr[idx + N] * (1 - u) * v + arr[idx + N + 1] * u * v;
  };
  const cell = size / (N - 1);
  return {
    height: (x, z) => { const [gx, gz] = toGrid(x, z); return bilinear(field.height, gx, gz); },
    normal: (x, z) => {
      const [gx, gz] = toGrid(x, z);
      const h = (dx, dz) => bilinear(field.height, gx + dx, gz + dz);
      const nx = -(h(1, 0) - h(-1, 0)) / (2 * cell), nz = -(h(0, 1) - h(0, -1)) / (2 * cell);
      const inv = 1 / Math.hypot(nx, 1, nz);
      return [nx * inv, inv, nz * inv];
    },
    map: (name, x, z) => { const [gx, gz] = toGrid(x, z); return bilinear(field[name], gx, gz); },
    // world-space point on the rendered surface at (x, z): heightfield + face displacement + detail
    surface(x, z, v) {
      const [gx, gz] = toGrid(x, z);
      const h = bilinear(field.height, gx, gz);
      const n = this.normal(x, z);
      let px = x, py = h, pz = z;
      if (v && ((v.overhang || 0) + (v.buttress || 0)) > 0) {
        if (!this._disp || this._disp.v !== v) { this._disp = makeDisplacement(field, v); this._disp.v = v; }
        const [ox, oz, sag] = this._disp.at(0, 0, n[0], n[1], n[2], bilinear(field.hardness, gx, gz), x, z, h);
        px += ox; pz += oz; py += sag;
      }
      if (v && (v.detailRelief || 0) > 0) {
        if (!this._det || this._det.v !== v) { this._det = makeDetail(field, v); this._det.v = v; }
        const d = this._det.at(x, h, z, n[1], bilinear(field.hardness, gx, gz));
        px += n[0] * d; py += n[1] * d; pz += n[2] * d;
      }
      return [px, py, pz];
    },
    // horizontal offset the face displacement applies near (x, z)
    displaced(x, z, v) {
      if (!v || ((v.overhang || 0) + (v.buttress || 0)) <= 0) return [x, z];
      if (!this._disp || this._disp.v !== v) { this._disp = makeDisplacement(field, v); this._disp.v = v; }
      const [gx, gz] = toGrid(x, z);
      const h = bilinear(field.height, gx, gz);
      const n = this.normal(x, z);
      const [ox, oz] = this._disp.at(0, 0, n[0], n[1], n[2], bilinear(field.hardness, gx, gz), x, z, h);
      return [x + ox, z + oz];
    },
  };
}
