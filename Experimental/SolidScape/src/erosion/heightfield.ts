// SolidScape — Heightfield baking from the SDF edit tape (512² fast vertical search)

import type { CompiledField } from '../sdf';
import { EvalField } from '../sdf';

export interface Heightfield
{
    data: Float32Array;     // size*size, row-major (z*size + x), heights [m]
    size: number;           // e.g. 512
    tileSize: number;       // world extent [m] (square)
    cellSize: number;       // tileSize / (size-1)
    worldMin: number;       // = -tileSize/2
    worldMax: number;       // = +tileSize/2
    minH: number;
    maxH: number;
}

/**
 * Bake the current SDF field to a heightfield by vertical ray.
 * Uses a fast 1-D sign-change scan (21 coarse samples + 12 bisect) instead of the generic 3-D raymarch.
 * Top is 60m above ground, bottom -4m; accurate to ~0.005m.
 * Over the sphere we get its dome, over empty we get the ground plane at y=0.
 */
export function BakeHeightfield(field: CompiledField, size: number, tileSize: number): Heightfield
{
    const data = new Float32Array(size * size);
    const worldMin = -tileSize * 0.5;
    const worldMax =  tileSize * 0.5;
    const cellSize = tileSize / (size - 1);

    // fast path: empty field → flat ground
    if (field.count === 0)
    {
        data.fill(0);
        return { data, size, tileSize, cellSize, worldMin, worldMax, minH: 0, maxH: 0 };
    }

    const topY = 60;
    const botY = -4;
    const coarseSteps = 20;
    const coarseDelta = (topY - botY) / coarseSteps;

    let minH = Infinity, maxH = -Infinity;

    for (let iz = 0; iz < size; iz++)
    {
        const z = worldMin + iz * cellSize;
        for (let ix = 0; ix < size; ix++)
        {
            const x = worldMin + ix * cellSize;

            // sample coarse column to find highest sign change (+ -> -)
            let prevY = topY;
            let prevV = EvalField(field.data, field.count, x, prevY, z);
            let hit: number | null = null;

            // if we start inside (prevV<0) — should not happen at topY, but handle
            if (prevV <= 0) { hit = prevY; }
            else
            {
                for (let s = 1; s <= coarseSteps; s++)
                {
                    const y = topY - s * coarseDelta;
                    const v = EvalField(field.data, field.count, x, y, z);
                    if (v <= 0 && prevV > 0)
                    {
                        // bracket [y, prevY] contains top surface — bisect
                        let lo = y, hi = prevY;
                        let vlo = v, vhi = prevV;
                        for (let b = 0; b < 12; b++)
                        {
                            const mid = (lo + hi) * 0.5;
                            const vm = EvalField(field.data, field.count, x, mid, z);
                            if (vm <= 0) { lo = mid; vlo = vm; } else { hi = mid; vhi = vm; }
                            void vlo; void vhi;
                        }
                        hit = (lo + hi) * 0.5;
                        break;
                    }
                    prevY = y;
                    prevV = v;
                }
            }

            const h = hit ?? botY; // if never entered, use bottom (ground at 0 will be hit normally)
            // clamp to ground at least (plane ensures hit, but fallback)
            const ch = Math.max(h, 0);
            data[iz * size + ix] = ch;
            if (ch < minH) minH = ch;
            if (ch > maxH) maxH = ch;
        }
    }

    return { data, size, tileSize, cellSize, worldMin, worldMax, minH, maxH };
}
