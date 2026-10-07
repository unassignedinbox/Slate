// Builds the terrain surface (and the block skirt) as indexed BufferGeometry.
// Vertex layout: position, normal, aux = (deposit, flow, hardness, cavity).

import * as THREE from 'three';

export function buildTerrainGeometry(field) {
  const { resolution: N, worldSize: size, height, deposit, flow, hardness, cavity } = field;
  const cell = size / (N - 1);
  const count = N * N;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const aux = new Float32Array(count * 4);

  for (let j = 0; j < N; j++) {
    const z = (j / (N - 1) - 0.5) * size;
    const j0 = Math.max(0, j - 1), j1 = Math.min(N - 1, j + 1);
    for (let i = 0; i < N; i++) {
      const idx = j * N + i;
      const x = (i / (N - 1) - 0.5) * size;
      positions[idx * 3] = x;
      positions[idx * 3 + 1] = height[idx];
      positions[idx * 3 + 2] = z;

      const i0 = Math.max(0, i - 1), i1 = Math.min(N - 1, i + 1);
      const dx = (height[j * N + i1] - height[j * N + i0]) / ((i1 - i0) * cell);
      const dz = (height[j1 * N + i] - height[j0 * N + i]) / ((j1 - j0) * cell);
      const nx = -dx, ny = 1, nz = -dz;
      const inv = 1 / Math.hypot(nx, ny, nz);
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
  };
}
