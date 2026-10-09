// Voxel form derived from the heightmap. Heights are the primary format; the voxel grid is a view of them.
// Column x,y is solid from z=0 up to round(H * Z). Only faces adjacent to air are kept for rendering.

export function voxelize(H, N, Z) {
  const solid = new Uint8Array(N * N * Z);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const top = Math.min(Z, Math.max(0, Math.round(H[y * N + x] * Z)));
      for (let z = 0; z < top; z++) solid[(z * N + y) * N + x] = 1;
    }
  }
  return solid;
}

// Returns the list of exposed solid voxel indices [x, y, z] (any face touching air or the boundary).
export function exposedVoxels(solid, N, Z, maxCount = 400000) {
  const out = [];
  const at = (x, y, z) => (x < 0 || y < 0 || z < 0 || x >= N || y >= N || z >= Z ? 0 : solid[(z * N + y) * N + x]);
  for (let z = 0; z < Z; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (!solid[(z * N + y) * N + x]) continue;
    if (!at(x + 1, y, z) || !at(x - 1, y, z) || !at(x, y + 1, z) || !at(x, y - 1, z) || !at(x, y, z + 1)) {
      out.push(x, y, z);
      if (out.length / 3 >= maxCount) return { list: out, truncated: true };
    }
  }
  return { list: out, truncated: false };
}

export function voxelStats(solid) {
  let n = 0;
  for (let i = 0; i < solid.length; i++) n += solid[i];
  return { solid: n, total: solid.length };
}
