//============================================================================================================================================
//                                                              THERMALSOLVER.JS
//============================================================================================================================================
// 📦 Tools/LandscapeEditor/src/engine/ThermalSolver.js — Thermal weathering by talus relaxation: Jacobi sweeps move material from
//    slopes steeper than the angle of repose, with harder beds standing steeper.

import { createField, diffuseField } from './HeightSpace.js';

//------------------------------------------------------------------------------------------------------------------------
//                                                    TALUS RELAXATION
//------------------------------------------------------------------------------------------------------------------------
// talusScale multiplies the tangent of the repose angle per cell (harder beds stand steeper). Returns {elevation} in metres.
export function runThermal(elevation, n, dx, p, talusScale)
{
    const count = n * n;
    const work = Float32Array.from(elevation);
    const delta = createField(count);
    const repose = Math.tan((p.talusDeg * Math.PI) / 180);
    const talus = createField(count);
    for (let k = 0; k < count; k++)
    {
        talus[k] = repose * talusScale[k];
    }
    const rate = Math.min(0.45, Math.max(0, p.rate));
    const diagonal = Math.SQRT2;

    const relax = (a, b, distanceScale) =>
    {
        const drop = work[a] - work[b];
        const magnitude = Math.abs(drop);
        if (magnitude <= 0)
        {
            return;
        }
        const high = drop > 0 ? a : b;
        const low = drop > 0 ? b : a;
        const threshold = talus[high] * distanceScale * dx;
        if (magnitude > threshold)
        {
            const move = rate * 0.5 * (magnitude - threshold);
            delta[high] -= move;
            delta[low] += move;
        }
    };

    for (let sweep = 0; sweep < Math.max(1, Math.round(p.iterations)); sweep++)
    {
        delta.fill(0);
        for (let j = 0; j < n; j++)
        {
            for (let i = 0; i < n; i++)
            {
                const k = j * n + i;
                if (i < n - 1)
                {
                    relax(k, k + 1, 1);
                }
                if (j < n - 1)
                {
                    relax(k, k + n, 1);
                    if (i < n - 1)
                    {
                        relax(k, k + n + 1, diagonal);
                    }
                    if (i > 0)
                    {
                        relax(k, k + n - 1, diagonal);
                    }
                }
            }
        }
        for (let k = 0; k < count; k++)
        {
            work[k] += delta[k];
        }
    }
    // Isotropic creep removes the stair-stepping that eight-neighbour relaxation leaves on steep faces; harder beds (higher talus scale) keep their steps.
    const creep = createField(count);
    for (let k = 0; k < count; k++)
    {
        creep[k] = 0.1 / talusScale[k];
    }
    return { elevation: diffuseField(diffuseField(work, n, creep), n, creep) };
}
