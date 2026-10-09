//============================================================================================================================================
//                                                              FLUVIALSOLVER.JS
//============================================================================================================================================
// 📦 Tools/LandscapeEditor/src/engine/FluvialSolver.js — Stream-power erosion solved implicitly on the receiver tree:
//    E = K·A^m·S^n with uplift, hillslope creep and deposition where rivers lose their gradient.

import { createField, diffuseField, smoothStep } from './HeightSpace.js';
import { routeDrainage, accumulateDrainage } from './DrainageStructure.js';

//------------------------------------------------------------------------------------------------------------------------
//                                                        CONSTANTS
//------------------------------------------------------------------------------------------------------------------------
// Converts the dimensionless erodibility slider into the stream-power coefficient. With streamK 0.35 and 300 m of uplift,
// a trunk river draining about 10 km² settles near a 5 % gradient, the scale of a real mountain river.
const STREAM_POWER_SCALE = 5000;
// Explicit creep is stable for coefficients below about 0.3, so each creep sub-step stays under this limit.
const CREEP_SUBSTEP_LIMIT = 0.2;
// Largest sediment dropped on one cell in one step, in metres. Stops runaway aggradation in lakes and flats.
const MAX_DEPOSIT_M = 0.6;

//------------------------------------------------------------------------------------------------------------------------
//                                                    IMPLICIT INCISION
//------------------------------------------------------------------------------------------------------------------------
// Solves z − lifted + c · (max(z − zRecv, 0) / length)^n = 0 for z ≥ zRecv, where lifted is the surface after uplift and c
// is K · A^m · dt. Exact for n = 1. Otherwise a Newton iteration safeguarded by bisection. Stable for any c, so the step
// count only sets accuracy, not whether the landscape blows up. Returns the new elevation in metres.
function solveIncision(lifted, zRecv, coefficient, length, exponent)
{
    if (coefficient <= 0 || lifted <= zRecv)
    {
        return lifted;
    }
    if (exponent === 1)
    {
        const ratio = coefficient / length;
        return Math.max(zRecv, (lifted + ratio * zRecv) / (1 + ratio));
    }
    let low = zRecv;
    let high = lifted;
    let z = lifted;
    for (let iteration = 0; iteration < 30; iteration++)
    {
        const slope = Math.max(z - zRecv, 0) / length;
        const residual = z - lifted + coefficient * Math.pow(slope, exponent);
        if (residual > 0)
        {
            high = z;
        }
        else
        {
            low = z;
        }
        if (Math.abs(residual) < 1e-6)
        {
            break;
        }
        const derivative = 1 + (coefficient * exponent * Math.pow(Math.max(slope, 1e-9), exponent - 1)) / length;
        let next = z - residual / derivative;
        if (!(next > low && next < high))
        {
            next = 0.5 * (low + high);
        }
        if (Math.abs(next - z) < 1e-6)
        {
            z = next;
            break;
        }
        z = next;
    }
    return z;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     RUN OF STEPS
//------------------------------------------------------------------------------------------------------------------------
// Each step routes the current surface, lets every land cell rise by its share of uplift, incises it against its receiver
// (receivers are solved first, so the update is implicit in time), creeps the hillslopes and deposits sediment where the
// gradient drops below the deposition gradient. Time is normalised to one run, so the step count sets accuracy only.
// Returns { elevation, uplift, exportedField } where exportedField holds sediment that left through the edges or the sea.
export function runFluvial(elevation, n, dx, sea, p, erodibility)
{
    const count = n * n;
    const diagonalLength = dx * Math.SQRT2;
    const h = Float32Array.from(elevation);
    const steps = Math.max(1, Math.round(p.iterations));
    const dt = 1 / steps;
    const upliftStep = p.upliftM * dt;
    const incisionStep = p.streamK * STREAM_POWER_SCALE * dt;
    const cellKm2 = (dx * dx) / 1e6;
    const weights = createField(count, cellKm2 * p.rainfall);
    // Creep is the total hillslope smoothing over the run in cell² units, so it is spread across the steps.
    const creepStep = Math.max(0, p.creep) * dt;
    const subSteps = Math.max(1, Math.ceil(creepStep / CREEP_SUBSTEP_LIMIT));
    const creep = createField(count);
    for (let k = 0; k < count; k++)
    {
        creep[k] = (creepStep / subSteps) * (0.35 + 0.65 * erodibility[k]);
    }
    const uplift = createField(count);
    const exported = createField(count);
    const removed = createField(count);
    const flux = createField(count);

    for (let step = 0; step < steps; step++)
    {
        const route = routeDrainage(h, n, dx, sea);
        const { order, recv, outlet } = route;
        const drainage = accumulateDrainage(route, weights);

        // Receivers come first in the order, so each cell is solved against its receiver's updated elevation.
        for (let q = 0; q < count; q++)
        {
            const cell = order[q];
            const land = h[cell] >= sea;
            const lifted = land ? h[cell] + upliftStep : h[cell];
            if (land)
            {
                uplift[cell] += upliftStep;
            }
            if (outlet[cell])
            {
                h[cell] = lifted;
                removed[cell] = 0;
                continue;
            }
            const target = recv[cell];
            const offset = Math.abs(target - cell);
            const length = offset === 1 || offset === n ? dx : diagonalLength;
            const coefficient = incisionStep * erodibility[cell] * Math.pow(drainage[cell], p.areaExponent);
            const next = solveIncision(lifted, h[target], coefficient, length, p.slopeExponent);
            removed[cell] = Math.max(0, lifted - next);
            h[cell] = next;
        }

        for (let sub = 0; sub < subSteps; sub++)
        {
            h.set(diffuseField(h, n, creep));
        }

        // Donors are processed before receivers, so each cell's flux is complete when it is reached.
        flux.fill(0);
        for (let q = count - 1; q >= 0; q--)
        {
            const cell = order[q];
            flux[cell] += removed[cell];
            if (outlet[cell])
            {
                exported[cell] += flux[cell];
                flux[cell] = 0;
                continue;
            }
            const target = recv[cell];
            const offset = Math.abs(target - cell);
            const length = offset === 1 || offset === n ? dx : diagonalLength;
            const gradient = Math.max(0, (h[cell] - h[target]) / length);
            const settle = 1 - smoothStep(0.5 * p.depositGradient, 1.5 * p.depositGradient, gradient);
            let carried = flux[cell];
            if (settle > 0 && carried > 0)
            {
                const dropped = Math.min(carried * p.depositFraction * settle, MAX_DEPOSIT_M);
                h[cell] += dropped;
                carried -= dropped;
            }
            flux[target] += carried;
            flux[cell] = 0;
        }
    }
    return { elevation: h, uplift, exportedField: exported };
}
