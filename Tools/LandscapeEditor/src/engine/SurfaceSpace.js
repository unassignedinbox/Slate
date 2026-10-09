//============================================================================================================================================
//                                                              SURFACESPACE.JS
//============================================================================================================================================
// 📦 Tools/LandscapeEditor/src/engine/SurfaceSpace.js — Derived surface attributes that drive satmap colour: slope, north-facing
//    exposure, protrusion, drainage channels, wetness, coast distance, bedding, sedimentation and net erosion.

import { createField, gradientField, gaussianBlur, distanceField, normalizeField, smoothStep } from './HeightSpace.js';
import { routeDrainage, accumulateDrainage } from './DrainageStructure.js';
import { computeBedding } from './BeddingSpace.js';

//------------------------------------------------------------------------------------------------------------------------
//                                                  ATTRIBUTE DERIVATION
//------------------------------------------------------------------------------------------------------------------------
// context: { n, dx, sea, bedding, riverKm2, preErosion, uplift, protrusionRadiusM }. Erosion is positive where ground was removed relative to the uplifted surface; sediment is the net accumulation after uplift.
export function deriveSurface(elevation, context)
{
    const n = context.n;
    const dx = context.dx;
    const count = n * n;
    const sea = context.sea;
    const { gx, gy } = gradientField(elevation, n, dx);

    const slope = createField(count);
    const aspect = createField(count);
    const gradientMagnitude = createField(count);
    for (let k = 0; k < count; k++)
    {
        const magnitude = Math.sqrt(gx[k] * gx[k] + gy[k] * gy[k]);
        gradientMagnitude[k] = magnitude;
        slope[k] = (Math.atan(magnitude) * 180) / Math.PI;
        aspect[k] = magnitude > 1e-6 ? 0.5 - 0.5 * (gy[k] / magnitude) : 0.5;
    }

    const smooth = gaussianBlur(elevation, n, Math.max(1, context.protrusionRadiusM / dx / 2));
    const protrusion = createField(count);
    for (let k = 0; k < count; k++)
    {
        protrusion[k] = elevation[k] - smooth[k];
    }

    const route = routeDrainage(elevation, n, dx, sea);
    const area = accumulateDrainage(route, null);
    // Wetness uses a smoothed area, so single D8 paths do not print as one-cell wet lines; rivers keep the raw catchment.
    const smoothArea = gaussianBlur(area, n, 1.5);
    const cellKm2 = (dx * dx) / 1e6;
    const riverFloor = Math.log(Math.max(1e-6, 0.5 * context.riverKm2));
    const riverCeiling = Math.log(Math.max(1e-6, 2 * context.riverKm2));
    const river = createField(count);
    const twi = createField(count);
    for (let k = 0; k < count; k++)
    {
        if (elevation[k] < sea)
        {
            twi[k] = -20;
            continue;
        }
        const catchmentKm2 = Math.max(1e-9, area[k] * cellKm2);
        river[k] = smoothStep(riverFloor, riverCeiling, Math.log(catchmentKm2));
        const specificArea = smoothArea[k] * dx;
        twi[k] = Math.log(specificArea / Math.max(gradientMagnitude[k], 0.01));
    }
    const wetness = normalizeField(twi, 0.01, 0.99);
    // Soften the single-direction (D8) channel lines so drainage reads as natural branching rather than a grid.
    const riverSoft = gaussianBlur(river, n, 1.1);

    const seaCells = new Uint8Array(count);
    for (let k = 0; k < count; k++)
    {
        seaCells[k] = elevation[k] < sea ? 1 : 0;
    }
    const distanceToSea = distanceField(seaCells, n, dx);
    const coast = createField(count);
    for (let k = 0; k < count; k++)
    {
        coast[k] = seaCells[k] ? 0 : distanceToSea[k];
    }

    const bedding = computeBedding(context.bedding, n, dx, elevation);
    const erosion = createField(count);
    const sediment = createField(count);
    for (let k = 0; k < count; k++)
    {
        // Tectonic uplift is removed first, so erosion and sediment describe surface processes only.
        const before = context.preErosion ? context.preErosion[k] : elevation[k];
        const lifted = before + (context.uplift ? context.uplift[k] : 0);
        erosion[k] = Math.max(0, lifted - elevation[k]);
        sediment[k] = Math.max(0, elevation[k] - lifted);
    }

    return {
        height: Float32Array.from(elevation),
        slope,
        aspect,
        protrusion,
        river: riverSoft,
        wetness,
        coast,
        bedding: bedding.hard,
        sediment,
        erosion
    };
}
