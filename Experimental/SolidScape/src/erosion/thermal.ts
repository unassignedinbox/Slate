// SolidScape — Thermal (talus) erosion on a heightfield (512², CPU)
// Simple 8-neighbour slump: material flows from high to low if slope > talus.
// Runs on raw Float32 heights in-place, double-buffered per iteration.

export interface ThermalParams
{
    talusDeg: number;   // e.g. 33°
    iterations: number; // 0..8
}

const DIRS: [number, number][] = [
    [-1,-1],[0,-1],[1,-1],
    [-1, 0],      [1, 0],
    [-1, 1],[0, 1],[1, 1],
];

/**
 * One thermal pass writes into `out` (must be size*size).
 * Returns true if any transfer occurred.
 */
export function ThermalStep(
    heights: Float32Array,
    out: Float32Array,
    size: number,
    cellSize: number,
    talusDeg: number,
): boolean
{
    const tanTalus = Math.tan(talusDeg * Math.PI / 180);
    const threshold = tanTalus * cellSize; // max allowed vertical diff per cell step
    let changed = false;

    // copy border unchanged (no neighbours)
    out.set(heights);

    // interior only
    for (let z = 1; z < size - 1; z++)
    {
        for (let x = 1; x < size - 1; x++)
        {
            const idx = z * size + x;
            const h = heights[idx];

            // find lowest neighbour
            let lowestH = h;
            let lowestIdx = -1;
            for (const [dx, dz] of DIRS)
            {
                const nIdx = (z + dz) * size + (x + dx);
                const nh = heights[nIdx];
                if (nh < lowestH) { lowestH = nh; lowestIdx = nIdx; }
            }

            const diff = h - lowestH;
            if (lowestIdx !== -1 && diff > threshold)
            {
                // transfer a fraction of the excess — 0.15 is conservative; large diffs on the sphere wall would otherwise launch material 5 m in one step
                const excess = diff - threshold;
                const transfer = excess * 0.18;
                // clamp to avoid overshoot: don't make centre lower than neighbour + threshold
                const t = Math.min(transfer, diff * 0.35);
                out[idx] -= t;
                out[lowestIdx] += t;
                changed = true;
            }
        }
    }

    return changed;
}

export function ThermalErode(
    heights: Float32Array,
    size: number,
    cellSize: number,
    params: ThermalParams,
): void
{
    if (params.iterations <= 0) return;
    const buf = new Float32Array(heights.length) as Float32Array;
    let src: Float32Array = heights;
    let dst: Float32Array = buf;
    let ping = true;

    for (let i = 0; i < params.iterations; i++)
    {
        const changed = ThermalStep(src, dst, size, cellSize, params.talusDeg);
        if (!changed) break;
        // swap buffers
        const tmp = src;
        src = dst;
        dst = tmp;
        ping = !ping;
    }

    // if we ended on the auxiliary buffer, copy back into original
    if (!ping)
    {
        // src is actually buf (the last written), dst is original heights buffer -> need to copy src into heights
        // but heights is the original array reference the caller holds; if odd number of swaps, heights already holds latest?
        // Simpler: after loop, ensure heights contains final data
        // Our ping tracks whether heights is src. If !ping, then heights is dst (stale), src is buf holding latest.
        (heights as Float32Array).set(src as Float32Array);
    }
    // else heights already is src with latest
}
