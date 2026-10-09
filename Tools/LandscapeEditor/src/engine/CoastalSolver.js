//============================================================================================================================================
//                                                              COASTALSOLVER.JS
//============================================================================================================================================
// 📦 Tools/LandscapeEditor/src/engine/CoastalSolver.js — Approximate coastal erosion: wave energy decaying inland from the shoreline,
//    shore platforms flattened to a surf datum, cliff retreat and talus at the foot of cliffs.

import { createField, distanceField, gradientField, gaussianBlur, smoothStep, diffuseField } from './HeightSpace.js';
import { runThermal } from './ThermalSolver.js';

//------------------------------------------------------------------------------------------------------------------------
//                                                        WAVE CUT
//------------------------------------------------------------------------------------------------------------------------
// Approximation of wave-cut platforms and cliffs; not a sediment-budget model. Returns {elevation} in metres.
export function runCoastal(elevation, n, dx, sea, p, erodibility)
{
    const count = n * n;
    let h = Float32Array.from(elevation);
    const sweeps = Math.max(1, Math.round(p.iterations));
    const talusScale = createField(count, 1);
    const creep = createField(count);
    for (let k = 0; k < count; k++)
    {
        creep[k] = 0.08 * erodibility[k];
    }
    const seaCells = new Uint8Array(count);
    const platform = sea + p.platformM;

    for (let sweep = 0; sweep < sweeps; sweep++)
    {
        for (let k = 0; k < count; k++)
        {
            seaCells[k] = h[k] < sea ? 1 : 0;
        }
        const distance = distanceField(seaCells, n, dx);
        const { gx, gy } = gradientField(h, n, dx);
        const next = Float32Array.from(h);
        const platformField = createField(count);
        const retreatField = createField(count);
        for (let k = 0; k < count; k++)
        {
            if (seaCells[k] || distance[k] > p.reachM)
            {
                continue;
            }
            const exposure = p.waveEnergy * Math.exp(-distance[k] / Math.max(p.fetchM, 1)) * (0.4 + 0.6 * erodibility[k]);
            const surf = Math.exp(-Math.pow((h[k] - sea) / Math.max(p.bandM, 0.1), 2));
            const relax = p.platformRate * exposure * surf;
            platformField[k] = -relax * (h[k] - platform);
            const slope = Math.sqrt(gx[k] * gx[k] + gy[k] * gy[k]);
            const steep = smoothStep(0.5, 2.0, slope);
            retreatField[k] = p.retreat * exposure * surf * steep * 0.05 * dx;
        }
        // Blurred wave fields: cliffs retreat smoothly along the shoreline instead of leaving grid-stepped scarps.
        const platformSoft = gaussianBlur(platformField, n, 1.0);
        const retreatSoft = gaussianBlur(retreatField, n, 1.0);
        for (let k = 0; k < count; k++)
        {
            next[k] += platformSoft[k] - retreatSoft[k];
        }
        h = diffuseField(runThermal(next, n, dx, { talusDeg: 34, rate: 0.25, iterations: 3 }, talusScale).elevation, n, creep);
    }
    return { elevation: h };
}
