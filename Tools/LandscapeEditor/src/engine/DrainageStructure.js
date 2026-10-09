//============================================================================================================================================
//                                                            DRAINAGESTRUCTURE.JS
//============================================================================================================================================
// 📦 Tools/LandscapeEditor/src/engine/DrainageStructure.js — Drainage topology on heightfields: priority-flood depression filling
//    with jittered flat resolution, D8 receivers and upstream area accumulation in topological order.

import { hashCell } from './LatticeSpace.js';

//------------------------------------------------------------------------------------------------------------------------
//                                                 PRIORITY-FLOOD ROUTING
//------------------------------------------------------------------------------------------------------------------------
// Returns { filled, order, recv, outlet }. order is ascending by filled elevation, so every receiver precedes its donors.
// Outlets are map-edge cells and cells at or below the sea level. recv is -1 at outlets.
export function routeDrainage(elevation, n, dx, sea)
{
    const count = n * n;
    const outlet = new Uint8Array(count);
    const filled = new Float32Array(count);
    const visited = new Uint8Array(count);
    const order = new Uint32Array(count);
    const heapKey = new Float32Array(count + 1);
    const heapCell = new Uint32Array(count + 1);
    let heapSize = 0;

    const push = (key, cell) =>
    {
        let at = ++heapSize;
        while (at > 1)
        {
            const upper = at >> 1;
            if (heapKey[upper] <= key)
            {
                break;
            }
            heapKey[at] = heapKey[upper];
            heapCell[at] = heapCell[upper];
            at = upper;
        }
        heapKey[at] = key;
        heapCell[at] = cell;
    };

    const pop = () =>
    {
        const top = heapCell[1];
        const key = heapKey[heapSize];
        const cell = heapCell[heapSize];
        heapSize--;
        let at = 1;
        while (true)
        {
            let lower = at << 1;
            if (lower > heapSize)
            {
                break;
            }
            if (lower + 1 <= heapSize && heapKey[lower + 1] < heapKey[lower])
            {
                lower++;
            }
            if (heapKey[lower] >= key)
            {
                break;
            }
            heapKey[at] = heapKey[lower];
            heapCell[at] = heapCell[lower];
            at = lower;
        }
        heapKey[at] = key;
        heapCell[at] = cell;
        return top;
    };

    for (let j = 0; j < n; j++)
    {
        for (let i = 0; i < n; i++)
        {
            const k = j * n + i;
            if (i === 0 || j === 0 || i === n - 1 || j === n - 1 || elevation[k] <= sea)
            {
                outlet[k] = 1;
                filled[k] = elevation[k];
                visited[k] = 1;
                push(elevation[k], k);
            }
        }
    }

    // Flats receive a tiny gradient towards their outlet. The per-cell jitter breaks Chebyshev-shaped ties, so drainage in flats does not collapse onto straight axis-aligned lines.
    const epsilon = 1e-3;
    let emitted = 0;
    while (heapSize > 0)
    {
        const cell = pop();
        order[emitted++] = cell;
        const level = filled[cell];
        const i = cell % n;
        const j = (cell - i) / n;
        for (let dj = -1; dj <= 1; dj++)
        {
            const nj = j + dj;
            if (nj < 0 || nj >= n)
            {
                continue;
            }
            for (let di = -1; di <= 1; di++)
            {
                const ni = i + di;
                if ((di === 0 && dj === 0) || ni < 0 || ni >= n)
                {
                    continue;
                }
                const neighbour = nj * n + ni;
                if (visited[neighbour])
                {
                    continue;
                }
                visited[neighbour] = 1;
                const fill = Math.max(elevation[neighbour], level + epsilon * (0.25 + 1.5 * hashCell(ni, nj, 4711)));
                filled[neighbour] = fill;
                push(fill, neighbour);
            }
        }
    }

    const recv = new Int32Array(count).fill(-1);
    const diagonalLength = dx * Math.SQRT2;
    for (let j = 0; j < n; j++)
    {
        for (let i = 0; i < n; i++)
        {
            const k = j * n + i;
            if (outlet[k])
            {
                continue;
            }
            let bestCell = -1;
            let bestSlope = -Infinity;
            for (let dj = -1; dj <= 1; dj++)
            {
                const nj = j + dj;
                if (nj < 0 || nj >= n)
                {
                    continue;
                }
                for (let di = -1; di <= 1; di++)
                {
                    const ni = i + di;
                    if ((di === 0 && dj === 0) || ni < 0 || ni >= n)
                    {
                        continue;
                    }
                    const neighbour = nj * n + ni;
                    const length = di !== 0 && dj !== 0 ? diagonalLength : dx;
                    const slope = (filled[k] - filled[neighbour]) / length;
                    if (slope > bestSlope)
                    {
                        bestSlope = slope;
                        bestCell = neighbour;
                    }
                }
            }
            recv[k] = bestCell;
        }
    }
    return { filled, order, recv, outlet };
}

//------------------------------------------------------------------------------------------------------------------------
//                                                 UPSTREAM ACCUMULATION
//------------------------------------------------------------------------------------------------------------------------
// Sums weights (or 1 per cell) over each cell's upstream catchment, in cell-equivalents.
export function accumulateDrainage(route, weights = null)
{
    const count = route.recv.length;
    const area = new Float32Array(count);
    if (weights)
    {
        area.set(weights);
    }
    else
    {
        area.fill(1);
    }
    const order = route.order;
    const recv = route.recv;
    for (let q = count - 1; q >= 0; q--)
    {
        const cell = order[q];
        const target = recv[cell];
        if (target >= 0)
        {
            area[target] += area[cell];
        }
    }
    return area;
}
