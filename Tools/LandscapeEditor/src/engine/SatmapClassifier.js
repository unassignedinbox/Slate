//============================================================================================================================================
//                                                            SATMAPCLASSIFIER.JS
//============================================================================================================================================
// 📦 Tools/LandscapeEditor/src/engine/SatmapClassifier.js — Satmap decision rules: driver band membership with soft edges, colour
//    parsing and per-material palette tables.

import { createField, smoothStep } from './HeightSpace.js';
import { materialById } from './SatmapSpecification.js';

//------------------------------------------------------------------------------------------------------------------------
//                                                    BAND MEMBERSHIP
//------------------------------------------------------------------------------------------------------------------------
// Returns a Float32Array in [0, 1]: 1 inside [lo, hi], feathered by soft on both edges.
export function bandWeights(driverField, band)
{
    const out = createField(driverField.length);
    const lo = Math.min(band.lo, band.hi);
    const hi = Math.max(band.lo, band.hi);
    const soft = Math.max(1e-4, band.soft);
    for (let k = 0; k < driverField.length; k++)
    {
        const sample = driverField[k];
        out[k] = smoothStep(lo - soft, lo + soft, sample) * (1 - smoothStep(hi - soft, hi + soft, sample));
    }
    return out;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     COLOUR TABLES
//------------------------------------------------------------------------------------------------------------------------
const paletteMemo = Object.create(null);

function hexToLinearChannels(hex)
{
    const clean = hex.replace('#', '');
    return [
        parseInt(clean.slice(0, 2), 16) / 255,
        parseInt(clean.slice(2, 4), 16) / 255,
        parseInt(clean.slice(4, 6), 16) / 255
    ];
}

// Flattened [r, g, b, r, g, b, ...] in [0, 1] for a material id.
export function materialPalette(materialId)
{
    if (paletteMemo[materialId])
    {
        return paletteMemo[materialId];
    }
    const colors = [];
    for (const hex of materialById(materialId).colors)
    {
        colors.push(...hexToLinearChannels(hex));
    }
    const palette = Float32Array.from(colors);
    paletteMemo[materialId] = palette;
    return palette;
}

export function hexToRgb(hex)
{
    const channels = hexToLinearChannels(hex);
    return [Math.round(channels[0] * 255), Math.round(channels[1] * 255), Math.round(channels[2] * 255)];
}
