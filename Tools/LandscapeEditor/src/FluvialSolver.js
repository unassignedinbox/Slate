// FluvialSolver: stream-power incision, E = K * A^m * S^n with n = 1, solved implicitly (Braun and Willett 2013).
// Drainage area comes from priority-flood routing, so valleys grow where water converges and ridges stay where it does not.
// Rock hardness is a seeded noise field, so erodibility varies and produces knickpoints and waterfalls. Uplift raises
// all land each iteration, which keeps incision active instead of levelling the map.

import { AccumulateArea, ComputeDrainage, IsDiagonalRoute } from "./DrainageStructure.js";
import { Clamp, Fractal } from "./NoiseSolver.js";

const RefreshInterval = 4;

export function RunFluvial(height, n, cell, params, seed, sea, diagnostics) {
    const size = n * n;
    const iterations = Math.round(params.iterations);
    const erodibility = params.erodibility;
    const exponent = params.areaExponent;
    const uplift = params.uplift;
    const contrast = params.hardnessContrast;

    const hardness = new Float32Array(size);
    for (let y = 0; y < n; y++) {
        const v = (y + 0.5) / n;
        for (let x = 0; x < n; x++) {
            const u = (x + 0.5) / n;
            hardness[y * n + x] = 0.5 + 0.5 * Fractal(u * 4, v * 4, seed + 1201, 4, 2, 0.5);
        }
    }

    let drainage = null;
    let area = null;
    for (let it = 0; it < iterations; it++) {
        if (uplift !== 0) {
            for (let i = 0; i < size; i++) {
                if (height[i] >= sea) {
                    height[i] += uplift;
                }
            }
        }
        if (it % RefreshInterval === 0) {
            drainage = ComputeDrainage(height, n, sea);
            area = AccumulateArea(drainage);
        }
        const { order, receivers } = drainage;
        // Ascending pop order visits receivers before their donors, which the implicit scheme needs.
        for (let k = 0; k < size; k++) {
            const i = order[k];
            const r = receivers[i];
            const z0 = height[i];
            if (r === i || z0 < sea) continue;
            const run = IsDiagonalRoute(i, r, n) ? Math.SQRT2 : 1;
            const localK = erodibility * Clamp(1 + contrast * (2 * hardness[i] - 1), 0, 4);
            const F = localK * Math.pow(area[i], exponent) / run;
            const z = (z0 + F * height[r]) / (1 + F);
            height[i] = z;
            if (z < z0) {
                diagnostics.erosion[i] += z0 - z;
            } else {
                diagnostics.deposition[i] += z - z0;
            }
        }
    }
    return diagnostics;
}
