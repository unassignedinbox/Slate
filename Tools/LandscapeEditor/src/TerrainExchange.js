// TerrainExchange: turns a height field into GPU-ready vertex and index arrays. The grid is normalised to a unit square
// with heights scaled by the map's extent and an optional vertical exaggeration, so the camera framing does not depend on
// the metre range of a particular terrain.

export function BuildTerrainGeometry(height, n, extent, options = {}) {
    const exaggeration = options.exaggeration ?? 1;
    const size = n * n;
    let low = Infinity;
    let high = -Infinity;
    for (let i = 0; i < size; i++) {
        if (height[i] < low) low = height[i];
        if (height[i] > high) high = height[i];
    }
    const centre = (low + high) / 2;
    const scale = (2 * exaggeration) / Math.max(1, extent);
    const positions = new Float32Array(size * 3);
    const normals = new Float32Array(size * 3);
    const cell = 2 / (n - 1);
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            const i = y * n + x;
            positions[i * 3] = -1 + x * cell;
            positions[i * 3 + 1] = (height[i] - centre) * scale;
            positions[i * 3 + 2] = -1 + y * cell;
        }
    }
    // Normals from central differences on the height grid.
    for (let y = 0; y < n; y++) {
        const yu = Math.max(0, y - 1);
        const yd = Math.min(n - 1, y + 1);
        for (let x = 0; x < n; x++) {
            const xl = Math.max(0, x - 1);
            const xr = Math.min(n - 1, x + 1);
            const dhx = (height[y * n + xr] - height[y * n + xl]) * scale / Math.max(1e-9, (xr - xl) * cell);
            const dhz = (height[yd * n + x] - height[yu * n + x]) * scale / Math.max(1e-9, (yd - yu) * cell);
            const nx = -dhx;
            const ny = 1;
            const nz = -dhz;
            const length = Math.hypot(nx, ny, nz) || 1;
            const i = (y * n + x) * 3;
            normals[i] = nx / length;
            normals[i + 1] = ny / length;
            normals[i + 2] = nz / length;
        }
    }
    const quads = (n - 1) * (n - 1);
    const indices = new Uint32Array(quads * 6);
    let o = 0;
    for (let y = 0; y < n - 1; y++) {
        for (let x = 0; x < n - 1; x++) {
            const a = y * n + x;
            const b = a + 1;
            const c = a + n;
            const d = c + 1;
            indices[o++] = a;
            indices[o++] = c;
            indices[o++] = b;
            indices[o++] = b;
            indices[o++] = c;
            indices[o++] = d;
        }
    }
    return { positions, normals, indices, low, high, centre, scale };
}
