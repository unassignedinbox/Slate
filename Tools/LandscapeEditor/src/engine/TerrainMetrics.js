//============================================================================================================================================
//                                                             TERRAINMETRICS.JS
//============================================================================================================================================
// 📦 Tools/LandscapeEditor/src/engine/TerrainMetrics.js — Quantitative summary of a terrain result: elevation range, land share,
//    slope statistics, channel length and sediment and erosion volumes.

//------------------------------------------------------------------------------------------------------------------------
//                                                        SUMMARY
//------------------------------------------------------------------------------------------------------------------------
// Volumes are in cubic metres, lengths in metres, angles in degrees.
export function summarizeTerrain(elevation, attrs, context)
{
    const count = elevation.length;
    const dx = context.dx;
    const cellArea = dx * dx;
    let min = Infinity;
    let max = -Infinity;
    let total = 0;
    let land = 0;
    let channelCells = 0;
    let erodedM3 = 0;
    let depositedM3 = 0;
    for (let k = 0; k < count; k++)
    {
        const height = elevation[k];
        if (height < min) min = height;
        if (height > max) max = height;
        total += height;
        if (height >= context.sea)
        {
            land += 1;
        }
        if (attrs.river[k] > 0.5)
        {
            channelCells += 1;
        }
        if (attrs.erosion[k] > 0)
        {
            erodedM3 += attrs.erosion[k] * cellArea;
        }
        depositedM3 += attrs.sediment[k] * cellArea;
    }
    const sortedSlopes = Float32Array.from(attrs.slope).sort();
    const p95 = sortedSlopes[Math.min(count - 1, Math.floor(count * 0.95))];
    let slopeTotal = 0;
    for (let k = 0; k < count; k++)
    {
        slopeTotal += attrs.slope[k];
    }
    return {
        minM: min,
        maxM: max,
        reliefM: max - min,
        meanM: total / count,
        landFraction: land / count,
        meanSlopeDeg: slopeTotal / count,
        p95SlopeDeg: p95,
        channelLengthM: channelCells * dx,
        erodedM3,
        depositedM3,
        exportedM3: context.exportedM3 || 0
    };
}
