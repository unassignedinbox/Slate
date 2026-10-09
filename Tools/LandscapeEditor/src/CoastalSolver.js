// CoastalSolver: wave-cut cliff retreat and beach profiling. Waves erode land within reach of the shore, most strongly
// at sea level (the wave base) and on steep faces, which undercuts cliffs. Beaches are then shaped to a gentle profile.
// Removed rock is discarded for simplicity; the wave-cut platform is the flat left at the wave base.

import { DistanceToWater, Gradient } from "./ElevationSpace.js";

export function RunCoastal(height, n, cell, params, seed, sea, diagnostics) {
    const size = n * n;
    const iterations = Math.round(params.iterations);
    const reach = Math.max(1, params.reach / cell);
    const band = Math.max(0.5, params.band);
    const cliffTan = Math.tan(params.cliffAngle * Math.PI / 180);
    const beachTan = Math.tan(params.beachSlope * Math.PI / 180);
    const beachCells = params.beachWidth / cell;

    for (let it = 0; it < iterations; it++) {
        const distance = DistanceToWater(height, n, sea);
        const { gx, gy } = Gradient(height, n, cell);
        for (let i = 0; i < size; i++) {
            const h = height[i];
            if (h < sea) continue;
            const d = distance[i];
            if (d > reach * 3) continue;
            const waves = Math.exp(-d / reach);
            const above = (h - sea) / band;
            const base = Math.exp(-above * above);
            const steep = Math.min(1, Math.max(0.15, Math.hypot(gx[i], gy[i]) / cliffTan));
            const removal = params.rate * waves * base * steep;
            const next = Math.max(sea, h - removal);
            if (next < h) {
                diagnostics.erosion[i] += h - next;
            }
            height[i] = next;
        }
        if (beachTan > 0) {
            for (let i = 0; i < size; i++) {
                const h = height[i];
                const d = distance[i];
                if (h < sea || d > beachCells) continue;
                const target = sea + d * cell * beachTan;
                if (h > target) {
                    const next = h + (target - h) * 0.5;
                    diagnostics.erosion[i] += h - next;
                    height[i] = next;
                }
            }
        }
    }
    return diagnostics;
}
