// ThermalSolver: talus (thermal weathering) relaxation. Material moves from any cell that is steeper than the talus angle
// to its steepest-dropping neighbour until the slope is at or below the angle of repose. Mass is conserved.

import { Degrees } from "./ElevationSpace.js";

const Offsets = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

export function RunThermal(height, n, cell, params, sea, diagnostics) {
    const tanTalus = Math.tan(params.talus / Degrees);
    const rate = params.rate;
    const iterations = Math.round(params.iterations);
    const size = n * n;
    const delta = new Float32Array(size);
    for (let it = 0; it < iterations; it++) {
        delta.fill(0);
        for (let y = 0; y < n; y++) {
            for (let x = 0; x < n; x++) {
                const i = y * n + x;
                const h = height[i];
                if (h < sea) continue;
                let best = 0;
                let target = -1;
                for (let k = 0; k < 8; k++) {
                    const nx = x + Offsets[k][0];
                    const ny = y + Offsets[k][1];
                    if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
                    const diagonal = Offsets[k][0] !== 0 && Offsets[k][1] !== 0;
                    const run = diagonal ? cell * Math.SQRT2 : cell;
                    const j = ny * n + nx;
                    const excess = (h - height[j]) - tanTalus * run;
                    if (excess > best) {
                        best = excess;
                        target = j;
                    }
                }
                if (target >= 0) {
                    const move = best * 0.5 * rate;
                    delta[i] -= move;
                    delta[target] += move;
                }
            }
        }
        for (let i = 0; i < size; i++) {
            const d = delta[i];
            if (d === 0) continue;
            height[i] += d;
            if (d < 0) {
                diagnostics.erosion[i] -= d;
            } else {
                diagnostics.deposition[i] += d;
            }
        }
    }
    return diagnostics;
}
