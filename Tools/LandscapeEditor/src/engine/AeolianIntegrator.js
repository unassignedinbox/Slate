//============================================================================================================================================
//                                                            AEOLIANINTEGRATOR.JS
//============================================================================================================================================
// 📦 Tools/LandscapeEditor/src/engine/AeolianIntegrator.js — Wind erosion and deposition: upwind-ordered saltation sweeps with
//    topographic speed-up, deflation of soft beds and lee deposition that builds dunes.

import { createField, orderByKey, clampNumber } from './HeightSpace.js';

//------------------------------------------------------------------------------------------------------------------------
//                                                      WIND SWEEPS
//------------------------------------------------------------------------------------------------------------------------
// Cells are visited upwind first. Sediment flux is carried from the upwind neighbour; capacity grows with the cube of wind speed,
// which is sped up on windward slopes and sheltered in lee. Returns {elevation} in metres.
export function runAeolian(elevation, n, dx, sea, p, erodibility)
{
    const count = n * n;
    const h = Float32Array.from(elevation);
    const flux = createField(count);
    const toward = ((p.windFromDeg + 180) * Math.PI) / 180;
    const east = Math.sin(toward);
    const north = Math.cos(toward);
    const keys = createField(count);
    for (let j = 0; j < n; j++)
    {
        for (let i = 0; i < n; i++)
        {
            keys[j * n + i] = i * dx * east + j * dx * north;
        }
    }
    const order = orderByKey(keys);
    const stepX = Math.round(east);
    const stepY = Math.round(north);
    const settle = 0.6;
    const sweeps = Math.max(1, Math.round(p.sweeps));

    for (let sweep = 0; sweep < sweeps; sweep++)
    {
        for (let q = 0; q < count; q++)
        {
            const cell = order[q];
            if (h[cell] < sea)
            {
                flux[cell] = 0;
                continue;
            }
            const i = cell % n;
            const j = (cell - i) / n;
            const ui = i - stepX;
            const uj = j - stepY;
            const inside = ui >= 0 && uj >= 0 && ui < n && uj < n;
            const upwind = inside ? uj * n + ui : -1;
            const inflow = inside ? flux[upwind] : p.supply;
            const upElevation = inside ? h[upwind] : h[cell];
            const slopeAlong = (h[cell] - upElevation) / dx;
            const speed = clampNumber(1 + p.topoBoost * slopeAlong, 0.25, 2.5) * p.windSpeed;
            const capacity = p.saltation * speed * speed * speed;
            let outflow = inflow;
            if (inflow > capacity)
            {
                const dropped = (inflow - capacity) * settle;
                h[cell] += dropped;
                outflow = inflow - dropped;
            }
            else
            {
                const removed = Math.min((capacity - inflow) * p.deflation * erodibility[cell], p.maxDeflation);
                h[cell] -= removed;
                outflow = inflow + removed;
            }
            flux[cell] = outflow;
        }
    }
    return { elevation: h };
}
