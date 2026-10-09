//============================================================================================================================================
//                                                              BEDDINGSPACE.JS
//============================================================================================================================================
// 📦 Tools/LandscapeEditor/src/engine/BeddingSpace.js — Sedimentary bedding model: dipping, warped strata with a hard caprock
//    fraction per period, giving lithologic hardness used by erosion, masks and colour.

import { createField, smoothStep } from './HeightSpace.js';
import { createLattice, gradientNoise } from './LatticeSpace.js';

const BEDDING_WARP_LATTICE_SEED = 4242;
const BEDDING_WARP_SCALE_M = 1500;

//------------------------------------------------------------------------------------------------------------------------
//                                                     BEDDING FIELDS
//------------------------------------------------------------------------------------------------------------------------
// Returns { hard, band }: hard ∈ [0, 1] is 1 inside caprock beds, band ∈ [0, 1) is the fractional position within a bed period.
export function computeBedding(bedding, n, dx, elevation)
{
    const count = n * n;
    const hard = createField(count);
    const band = createField(count);
    const lattice = createLattice(BEDDING_WARP_LATTICE_SEED);
    const thickness = Math.max(1, bedding.thicknessM);
    const tanDip = Math.tan((bedding.dipDeg * Math.PI) / 180);
    const dipRadians = (bedding.dipDirDeg * Math.PI) / 180;
    const dirEast = Math.sin(dipRadians);
    const dirNorth = Math.cos(dipRadians);
    const edge = 0.06;
    const hardFraction = bedding.hardFraction;
    for (let j = 0; j < n; j++)
    {
        const yM = j * dx;
        for (let i = 0; i < n; i++)
        {
            const k = j * n + i;
            const xM = i * dx;
            const warp = bedding.warpM * gradientNoise(lattice, xM / BEDDING_WARP_SCALE_M, yM / BEDDING_WARP_SCALE_M);
            const bedCount = (elevation[k] + (xM * dirEast + yM * dirNorth) * tanDip + warp) / thickness;
            const phase = bedCount - Math.floor(bedCount);
            band[k] = phase;
            hard[k] = 1 - smoothStep(hardFraction - edge, hardFraction + edge, phase);
        }
    }
    return { hard, band };
}
