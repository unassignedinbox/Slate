// AeolianSolver: wind-driven sand transport that grows dune fields. Saltation flux rises where the wind accelerates up a
// windward slope (q = q0 * (1 + beta * dh/dw)). That term is destabilising, so sand piles into crests and forms bedforms.
// A biharmonic term sets the dominant wavelength: its coefficient is nu = q0 * beta * lambda^2 / (8 pi^2). A talus pass
// keeps lee faces at the angle of repose, as avalanching does in real dunes.

import { Gradient } from "./ElevationSpace.js";
import { RunThermal } from "./ThermalSolver.js";

const Degrees = Math.PI / 180;
const ThermalEvery = 5;

// Graph Laplacian over in-domain neighbours only (no-flux edges). Summing it over the grid gives exactly zero, so
// applying it does not create or destroy sand.
function GraphLaplace(src, dst, n, inverseCellSquared) {
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            const i = y * n + x;
            let sum = 0;
            if (x > 0) sum += src[i - 1] - src[i];
            if (x < n - 1) sum += src[i + 1] - src[i];
            if (y > 0) sum += src[i - n] - src[i];
            if (y < n - 1) sum += src[i + n] - src[i];
            dst[i] = sum * inverseCellSquared;
        }
    }
}

export function RunAeolian(height, n, cell, params, seed, sea, diagnostics) {
    const size = n * n;
    const before = Float32Array.from(height);
    const heading = params.direction * Degrees;
    const wx = Math.sin(heading);
    const wy = Math.cos(heading);
    const strength = params.strength;
    const beta = params.crestAcceleration;
    const wavelength = params.wavelength;
    const nu = strength * beta * wavelength * wavelength / (8 * Math.PI * Math.PI);
    const steps = Math.round(params.iterations);
    const supply = params.sandSupply;
    // Largest explicit step that stays stable for the biharmonic term and for the advective term; capped for accuracy.
    // Explicit biharmonic stability needs dt <= cell^4 / (32 nu); this is a quarter of that.
    const biharmonicLimit = nu > 0 ? Math.pow(cell, 4) / (64 * nu) : Infinity;
    const advectiveLimit = strength * beta > 0 ? 0.25 * cell * cell / (strength * beta) : Infinity;
    const dt = Math.min(8, biharmonicLimit, advectiveLimit);
    const qx = new Float32Array(size);
    const qy = new Float32Array(size);
    const scratch = { erosion: new Float32Array(size), deposition: new Float32Array(size) };
    const talus = { talus: 32, rate: 0.5, iterations: 1 };
    const inverseCellSquared = 1 / (cell * cell);
    const lap = new Float32Array(size);
    const bi = new Float32Array(size);

    for (let step = 0; step < steps; step++) {
        const { gx, gy } = Gradient(height, n, cell);
        for (let i = 0; i < size; i++) {
            if (height[i] < sea) {
                qx[i] = 0;
                qy[i] = 0;
                continue;
            }
            const along = gx[i] * wx + gy[i] * wy;
            const factor = Math.min(4, Math.max(0.05, 1 + beta * along));
            const q = strength * supply * factor;
            qx[i] = q * wx;
            qy[i] = q * wy;
        }
        GraphLaplace(height, lap, n, inverseCellSquared);
        GraphLaplace(lap, bi, n, inverseCellSquared);
        // Finite-volume divergence: fluxes are averaged onto cell faces and are zero on the domain edge, so the total
        // sand volume is conserved exactly.
        for (let y = 0; y < n; y++) {
            for (let x = 0; x < n; x++) {
                const i = y * n + x;
                const faceRight = x < n - 1 ? 0.5 * (qx[i] + qx[i + 1]) : 0;
                const faceLeft = x > 0 ? 0.5 * (qx[i - 1] + qx[i]) : 0;
                const faceDown = y < n - 1 ? 0.5 * (qy[i] + qy[i + n]) : 0;
                const faceUp = y > 0 ? 0.5 * (qy[i - n] + qy[i]) : 0;
                const divergence = (faceRight - faceLeft + faceDown - faceUp) / cell;
                height[i] += dt * (-divergence - nu * bi[i]);
            }
        }
        if ((step + 1) % ThermalEvery === 0) {
            RunThermal(height, n, cell, talus, sea, scratch);
        }
    }

    for (let i = 0; i < size; i++) {
        const change = height[i] - before[i];
        if (change < 0) {
            diagnostics.erosion[i] -= change;
        } else {
            diagnostics.deposition[i] += change;
        }
    }
    return diagnostics;
}
