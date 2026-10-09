// ElevationSpace: scalar-field helpers on square N x N Float32Arrays (row-major, index = y * N + x, +Y is north).
// Heights are metres. Cell size is metres per cell. Every helper is allocation-light and side-effect free on its inputs.

export const Degrees = 180 / Math.PI;

export function CreateField(size, fill = 0) {
    const field = new Float32Array(size);
    if (fill !== 0) {
        field.fill(fill);
    }
    return field;
}

// Central-difference gradient in metres per metre, with clamped edges.
export function Gradient(height, n, cell) {
    const gx = new Float32Array(n * n);
    const gy = new Float32Array(n * n);
    const inv = 1 / (2 * cell);
    for (let y = 0; y < n; y++) {
        const yu = y > 0 ? y - 1 : y;
        const yd = y < n - 1 ? y + 1 : y;
        for (let x = 0; x < n; x++) {
            const xl = x > 0 ? x - 1 : x;
            const xr = x < n - 1 ? x + 1 : x;
            const i = y * n + x;
            gx[i] = (height[y * n + xr] - height[y * n + xl]) * inv;
            gy[i] = (height[yd * n + x] - height[yu * n + x]) * inv;
        }
    }
    return { gx, gy };
}

export function SlopeDegrees(height, n, cell) {
    const { gx, gy } = Gradient(height, n, cell);
    const slope = new Float32Array(n * n);
    for (let i = 0; i < slope.length; i++) {
        slope[i] = Math.atan(Math.hypot(gx[i], gy[i])) * Degrees;
    }
    return slope;
}

// Five-point Laplacian in metres per square metre (used for curvature and diffusion).
export function Laplacian(height, n, cell) {
    const out = new Float32Array(n * n);
    const inv = 1 / (cell * cell);
    for (let y = 0; y < n; y++) {
        const yu = y > 0 ? y - 1 : y;
        const yd = y < n - 1 ? y + 1 : y;
        for (let x = 0; x < n; x++) {
            const xl = x > 0 ? x - 1 : x;
            const xr = x < n - 1 ? x + 1 : x;
            const i = y * n + x;
            out[i] = (height[y * n + xl] + height[y * n + xr] + height[yu * n + x] + height[yd * n + x] - 4 * height[i]) * inv;
        }
    }
    return out;
}

// Repeated 3 x 3 box filter. Returns a new array; the input is not modified.
export function BoxSmooth(height, n, passes) {
    let current = Float32Array.from(height);
    let next = new Float32Array(n * n);
    for (let p = 0; p < passes; p++) {
        for (let y = 0; y < n; y++) {
            const yu = y > 0 ? y - 1 : y;
            const yd = y < n - 1 ? y + 1 : y;
            for (let x = 0; x < n; x++) {
                const xl = x > 0 ? x - 1 : x;
                const xr = x < n - 1 ? x + 1 : x;
                next[y * n + x] = (
                    current[yu * n + xl] + current[yu * n + x] + current[yu * n + xr] +
                    current[y * n + xl] + current[y * n + x] + current[y * n + xr] +
                    current[yd * n + xl] + current[yd * n + x] + current[yd * n + xr]
                ) / 9;
            }
        }
        const swap = current;
        current = next;
        next = swap;
    }
    return current;
}

// Chamfer (1, sqrt2) distance from every cell to the nearest water cell (height below sea level), in cells.
export function DistanceToWater(height, n, sea) {
    const far = 1e9;
    const d = new Float32Array(n * n);
    for (let i = 0; i < d.length; i++) {
        d[i] = height[i] < sea ? 0 : far;
    }
    const diagonal = Math.SQRT2;
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            const i = y * n + x;
            let best = d[i];
            if (x > 0) best = Math.min(best, d[i - 1] + 1);
            if (y > 0) best = Math.min(best, d[i - n] + 1);
            if (x > 0 && y > 0) best = Math.min(best, d[i - n - 1] + diagonal);
            if (x < n - 1 && y > 0) best = Math.min(best, d[i - n + 1] + diagonal);
            d[i] = best;
        }
    }
    for (let y = n - 1; y >= 0; y--) {
        for (let x = n - 1; x >= 0; x--) {
            const i = y * n + x;
            let best = d[i];
            if (x < n - 1) best = Math.min(best, d[i + 1] + 1);
            if (y < n - 1) best = Math.min(best, d[i + n] + 1);
            if (x < n - 1 && y < n - 1) best = Math.min(best, d[i + n + 1] + diagonal);
            if (x > 0 && y < n - 1) best = Math.min(best, d[i + n - 1] + diagonal);
            d[i] = best;
        }
    }
    return d;
}

export function Summary(height, cell) {
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    for (let i = 0; i < height.length; i++) {
        const v = height[i];
        if (v < min) min = v;
        if (v > max) max = v;
        sum += v;
    }
    const count = height.length || 1;
    return { min, max, mean: sum / count, relief: max - min, cellArea: cell * cell };
}

// Bilinear sample of a field at fractional cell coordinates (clamped to the grid).
export function SampleBilinear(height, n, px, py) {
    const x = Math.min(n - 1.001, Math.max(0, px));
    const y = Math.min(n - 1.001, Math.max(0, py));
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const i = y0 * n + x0;
    return (
        height[i] * (1 - fx) * (1 - fy) +
        height[i + 1] * fx * (1 - fy) +
        height[i + n] * (1 - fx) * fy +
        height[i + n + 1] * fx * fy
    );
}
