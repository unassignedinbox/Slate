// HydraulicSolver: particle (droplet) hydraulic erosion with sediment capacity, deposition and brush-weighted removal.
// Follows the Mei et al. and Lague formulation. Capacity scales with slope, speed and water volume, so steep, fast
// drainedArea carves and flat, slow drainedArea deposits. Heights are in metres; the capacity term is converted to metres explicitly.

import { CreateRandom } from "./NoiseSolver.js";
import { SampleBilinear } from "./ElevationSpace.js";

const TwoPi = Math.PI * 2;
// Converts the dimensionless capacity term into metres of carried sediment per droplet step.
const CapacityScale = 0.01;

export function RunHydraulic(height, n, cell, params, seed, sea, diagnostics) {
    const random = CreateRandom(seed ^ 0x5bd1e995);
    const radius = Math.max(1, Math.round(params.radius));
    const brushIndex = [];
    const brushWeight = [];
    let brushTotal = 0;
    for (let oy = -radius; oy <= radius; oy++) {
        for (let ox = -radius; ox <= radius; ox++) {
            const d = Math.hypot(ox, oy);
            if (d >= radius) continue;
            const w = radius - d;
            brushIndex.push([ox, oy]);
            brushWeight.push(w);
            brushTotal += w;
        }
    }
    for (let k = 0; k < brushWeight.length; k++) {
        brushWeight[k] /= brushTotal;
    }

    const droplets = Math.round(params.droplets);
    const lifetime = Math.round(params.lifetime);
    const { inertia, capacity, minSlope, erodeRate, depositRate, evaporation, gravity } = params;
    const erosion = diagnostics.erosion;
    const deposition = diagnostics.deposition;
    const limit = n - 2;

    for (let drop = 0; drop < droplets; drop++) {
        let px = 1 + random() * (n - 3);
        let py = 1 + random() * (n - 3);
        let dx = 0;
        let dy = 0;
        let speed = 1;
        let water = 1;
        let sediment = 0;

        for (let step = 0; step < lifetime; step++) {
            const ix = Math.floor(px);
            const iy = Math.floor(py);
            if (ix < 1 || iy < 1 || ix >= limit || iy >= limit) break;
            const fx = px - ix;
            const fy = py - iy;
            const i = iy * n + ix;
            const h00 = height[i];
            const h10 = height[i + 1];
            const h01 = height[i + n];
            const h11 = height[i + n + 1];
            const gx = (h10 - h00) * (1 - fy) + (h11 - h01) * fy;
            const gy = (h01 - h00) * (1 - fx) + (h11 - h10) * fx;
            const here = h00 * (1 - fx) * (1 - fy) + h10 * fx * (1 - fy) + h01 * (1 - fx) * fy + h11 * fx * fy;

            dx = dx * inertia - gx * (1 - inertia);
            dy = dy * inertia - gy * (1 - inertia);
            let length = Math.hypot(dx, dy);
            if (length < 1e-9) {
                const angle = random() * TwoPi;
                dx = Math.cos(angle);
                dy = Math.sin(angle);
                length = 1;
            }
            dx /= length;
            dy /= length;

            const nx = px + dx;
            const ny = py + dy;
            const there = SampleBilinear(height, n, nx, ny);
            const dH = there - here;
            const carry = capacity * speed * water * Math.max(-dH, minSlope * cell) * CapacityScale;

            if (sediment > carry || dH > 0) {
                const amount = dH > 0 ? Math.min(dH, sediment) : (sediment - carry) * depositRate;
                if (amount > 0) {
                    sediment -= amount;
                    Scatter(height, deposition, n, px, py, amount, sea);
                }
            } else {
                const amount = Math.min((carry - sediment) * erodeRate, -dH);
                if (amount > 0) {
                    const removed = Brush(height, erosion, n, ix, iy, amount, brushIndex, brushWeight, sea);
                    sediment += removed;
                }
            }

            speed = Math.sqrt(Math.max(0, speed * speed - dH * gravity));
            water *= 1 - evaporation;
            px = nx;
            py = ny;
        }

        if (sediment > 0) {
            const ix = Math.floor(px);
            const iy = Math.floor(py);
            if (ix >= 0 && iy >= 0 && ix < n - 1 && iy < n - 1) {
                Scatter(height, deposition, n, px, py, sediment, sea);
            }
        }
    }
    return diagnostics;
}

// Removes up to `amount` from the land cells under the brush, weighted by distance. Weights are renormalised over the cells
// that are actually land and inside the grid, so the removed volume always equals the volume carried away.
function Brush(height, erosion, n, ix, iy, amount, offsets, weights, sea) {
    let total = 0;
    for (let k = 0; k < offsets.length; k++) {
        const x = ix + offsets[k][0];
        const y = iy + offsets[k][1];
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        if (height[y * n + x] < sea) continue;
        total += weights[k];
    }
    if (total <= 0) return 0;
    let removed = 0;
    for (let k = 0; k < offsets.length; k++) {
        const x = ix + offsets[k][0];
        const y = iy + offsets[k][1];
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        const j = y * n + x;
        if (height[j] < sea) continue;
        const take = amount * weights[k] / total;
        height[j] -= take;
        erosion[j] += take;
        removed += take;
    }
    return removed;
}

// Bilinear deposit at fractional cell coordinates, so a droplet's sediment lands on the four neighbours it stands between.
function Scatter(height, deposition, n, px, py, amount, sea) {
    const ix = Math.floor(px);
    const iy = Math.floor(py);
    const fx = px - ix;
    const fy = py - iy;
    const i = iy * n + ix;
    Deposit(height, deposition, i, amount * (1 - fx) * (1 - fy), sea);
    Deposit(height, deposition, i + 1, amount * fx * (1 - fy), sea);
    Deposit(height, deposition, i + n, amount * (1 - fx) * fy, sea);
    Deposit(height, deposition, i + n + 1, amount * fx * fy, sea);
}

function Deposit(height, deposition, j, add, sea) {
    if (add <= 0 || j < 0 || j >= height.length) return;
    if (height[j] < sea && add < 1e-6) return;
    height[j] += add;
    deposition[j] += add;
}
