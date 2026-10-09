//============================================================================================================================================
//                                                              GLACIALSOLVER.JS
//============================================================================================================================================
// 📦 Tools/LandscapeEditor/src/engine/GlacialSolver.js — Approximate glacial erosion: ice fed from above the snowline, flux-driven
//    valley incision spread laterally and cirque hollowing; removed rock leaves the tile.

import { createField, gaussianBlur, laplacianField, smoothStep, clampNumber } from './HeightSpace.js';
import { routeDrainage, accumulateDrainage } from './DrainageStructure.js';

//------------------------------------------------------------------------------------------------------------------------
//                                                    ICE FLUX SWEEPS
//------------------------------------------------------------------------------------------------------------------------
// Approximation, not a full ice-flow model. Returns {elevation} in metres.
export function runGlacial(elevation, n, dx, sea, p, erodibility)
{
    const count = n * n;
    const h = Float32Array.from(elevation);
    const ice = createField(count);
    const sweeps = Math.max(1, Math.round(p.iterations));
    const lateralSigma = Math.max(0.5, p.valleyWidthM / dx / 2);

    for (let sweep = 0; sweep < sweeps; sweep++)
    {
        for (let k = 0; k < count; k++)
        {
            ice[k] = smoothStep(p.snowlineM - 250, p.snowlineM + 150, h[k]);
        }
        const route = routeDrainage(h, n, dx, sea);
        const area = accumulateDrainage(route, ice);
        const { recv, outlet } = route;

        const incision = createField(count);
        for (let k = 0; k < count; k++)
        {
            if (outlet[k])
            {
                continue;
            }
            const target = recv[k];
            const offset = Math.abs(target - k);
            const length = offset === 1 || offset === n ? dx : dx * Math.SQRT2;
            const slope = Math.max(0, (h[k] - h[target]) / length);
            incision[k] = Math.min(p.maxRate, p.iceFlux * erodibility[k] * Math.sqrt(area[k]) * slope);
        }
        const spread = gaussianBlur(incision, n, lateralSigma);

        const curvature = laplacianField(h, n, dx);
        const removal = createField(count);
        for (let k = 0; k < count; k++)
        {
            if (h[k] < sea)
            {
                continue;
            }
            const above = smoothStep(p.snowlineM - 200, p.snowlineM + 300, h[k]);
            const hollow = clampNumber(curvature[k] * 20, 0, 1);
            const cirqueLoss = p.cirque * above * hollow * p.maxRate * 0.25;
            const amount = Math.min(p.maxRate, spread[k] + cirqueLoss);
            removal[k] = amount;
        }

        for (let k = 0; k < count; k++)
        {
            h[k] -= removal[k];
        }
    }
    return { elevation: h };
}
