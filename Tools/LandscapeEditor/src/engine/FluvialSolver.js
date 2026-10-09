//============================================================================================================================================
//                                                              FLUVIALSOLVER.JS
//============================================================================================================================================
// 📦 Tools/LandscapeEditor/src/engine/FluvialSolver.js — Stream-power fluvial erosion: Jacobi incision E = K·A^m·S^n limited to half
//    the local drop, hillslope creep and capped transport-limited deposition, with uplift on land.

import { createField, gaussianBlur, diffuseField } from './HeightSpace.js';
import { routeDrainage, accumulateDrainage } from './DrainageStructure.js';

//------------------------------------------------------------------------------------------------------------------------
//                                                  STREAM POWER SWEEPS
//------------------------------------------------------------------------------------------------------------------------
// Each sweep routes on the current surface, computes incision from the start-of-sweep heights (Jacobi, so no streak-forming update order), limits each cell to half its drop to the receiver, creeps the slopes isotropically and deposits capped transport excess.
// Returns { elevation, uplift } in metres; uplift is the cumulative rise added to land cells.
export function runFluvial(elevation, n, dx, sea, p, erodibility)
{
    const count = n * n;
    const diagonalLength = dx * Math.SQRT2;
    let h = Float32Array.from(elevation);
    const weights = createField(count, p.rainfall);
    const sweeps = Math.max(1, Math.round(p.iterations));
    const upliftStep = p.upliftM / sweeps;
    const uplift = createField(count);
    const eroding = createField(count);
    const flux = createField(count);
    const creep = createField(count);
    const exportedField = createField(count);
    for (let k = 0; k < count; k++)
    {
        creep[k] = 0.1 * erodibility[k];
    }
    const depositCapM = 0.5;

    const lengthTo = (cell, target) =>
    {
        const offset = Math.abs(target - cell);
        return offset === 1 || offset === n ? dx : diagonalLength;
    };

    for (let sweep = 0; sweep < sweeps; sweep++)
    {
        const route = routeDrainage(h, n, dx, sea);
        const { order, recv, outlet } = route;
        const area = gaussianBlur(accumulateDrainage(route, weights), n, 1.5);

        eroding.fill(0);
        for (let cell = 0; cell < count; cell++)
        {
            if (outlet[cell])
            {
                continue;
            }
            const target = recv[cell];
            const drop = h[cell] - h[target];
            if (drop <= 0)
            {
                continue;
            }
            const slope = drop / lengthTo(cell, target);
            const rate = p.streamK * erodibility[cell] * Math.pow(area[cell], p.areaExponent) * Math.pow(slope, p.slopeExponent);
            eroding[cell] = Math.min(rate, 0.5 * drop);
        }

        for (let cell = 0; cell < count; cell++)
        {
            if (h[cell] >= sea)
            {
                h[cell] += upliftStep;
                uplift[cell] += upliftStep;
            }
            h[cell] -= eroding[cell];
        }

        h = diffuseField(h, n, creep);

        flux.fill(0);
        for (let q = count - 1; q >= 0; q--)
        {
            const cell = order[q];
            flux[cell] += eroding[cell];
            if (outlet[cell])
            {
                // Load that reaches a map edge or the sea leaves the map. It is recorded as export, not lost.
                exportedField[cell] += flux[cell];
                flux[cell] = 0;
                continue;
            }
            const target = recv[cell];
            const slope = Math.max(0, (h[cell] - h[target]) / lengthTo(cell, target));
            const capacity = p.transport * Math.pow(area[cell], p.areaExponent) * Math.pow(slope, p.slopeExponent);
            let carried = flux[cell];
            if (carried > capacity)
            {
                const dropped = Math.min((carried - capacity) * p.depositFraction, depositCapM);
                h[cell] += dropped;
                carried -= dropped;
            }
            flux[target] += carried;
            flux[cell] = 0;
        }
    }
    return { elevation: h, uplift, exportedField };
}
