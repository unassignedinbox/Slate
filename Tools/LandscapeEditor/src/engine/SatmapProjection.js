//============================================================================================================================================
//                                                            SATMAPPROJECTION.JS
//============================================================================================================================================
// 📦 Tools/LandscapeEditor/src/engine/SatmapProjection.js — Diagnostic and satmap views: colour ramps and projections from terrain
//    results to RGBA for elevation, protrusion, drainage, sediment, erosion, slope, wetness and bedding.

import { summarizeField, clampNumber, smoothStep } from './HeightSpace.js';
import { sunDirection, hillshadeField } from './SatmapSequence.js';
import { hexToRgb } from './SatmapClassifier.js';

//------------------------------------------------------------------------------------------------------------------------
//                                                     VIEW CATALOGUE
//------------------------------------------------------------------------------------------------------------------------
export const VIEW_MODES = [
    { id: 'satmap', label: 'Satmap', blurb: 'Stylised satellite colour composed from the satmap stack.' },
    { id: 'shaded', label: 'Shaded relief', blurb: 'Grey hillshade of the heightfield.' },
    { id: 'height', label: 'Elevation', blurb: 'Hypsometric tint from sea level to the highest point.' },
    { id: 'protrusion', label: 'Protrusions', blurb: 'Ridges and spurs (warm) against valleys (cool).' },
    { id: 'river', label: 'Rivers & drainage', blurb: 'Channels where catchment area is large.' },
    { id: 'sediment', label: 'Sedimentation', blurb: 'Material deposited by erosion layers.' },
    { id: 'erosion', label: 'Net erosion', blurb: 'Warm where ground was removed, cool where it was built up.' },
    { id: 'slope', label: 'Slope', blurb: 'Steepness in degrees.' },
    { id: 'wetness', label: 'Wetness', blurb: 'Topographic wetness index: hollows that collect water.' },
    { id: 'bedding', label: 'Bedding & caprock', blurb: 'Hard caprock beds (dark) against softer beds (light).' }
];

//------------------------------------------------------------------------------------------------------------------------
//                                                         RAMPS
//------------------------------------------------------------------------------------------------------------------------
// Stops are [position, '#rrggbb'] pairs, ordered by position.
function rampColor(stops, position)
{
    const t = clampNumber(position, 0, 1);
    for (let s = 1; s < stops.length; s++)
    {
        if (t <= stops[s][0])
        {
            const [p0, c0] = stops[s - 1];
            const [p1, c1] = stops[s];
            const local = p1 > p0 ? (t - p0) / (p1 - p0) : 0;
            const a = hexToRgb(c0);
            const b = hexToRgb(c1);
            return [a[0] + (b[0] - a[0]) * local, a[1] + (b[1] - a[1]) * local, a[2] + (b[2] - a[2]) * local];
        }
    }
    return hexToRgb(stops[stops.length - 1][1]);
}

const RAMPS = {
    elevation: [[0, '#1f4e5f'], [0.12, '#3f6e6a'], [0.3, '#7d8f5c'], [0.5, '#b2a15f'], [0.7, '#9c7a58'], [0.85, '#c8c1b8'], [1, '#f4f5f7']],
    protrusion: [[0, '#2c4f8f'], [0.5, '#efeee8'], [1, '#a4402b']],
    river: [[0, '#2a2a26'], [0.45, '#2d5f7d'], [1, '#a8e6f5']],
    sediment: [[0, '#1f1c19'], [0.5, '#7b6443'], [1, '#e6d3a1']],
    erosion: [[0, '#3b6fa6'], [0.5, '#eeebe4'], [1, '#b5452f']],
    slope: [[0, '#eef0e4'], [0.35, '#b9a77d'], [0.7, '#7a6b58'], [1, '#2e2b28']],
    wetness: [[0, '#8a6a45'], [0.5, '#3f7070'], [1, '#17305c']],
    bedding: [[0, '#e8dcc3'], [0.5, '#c9a177'], [1, '#7e4b35']]
};

//------------------------------------------------------------------------------------------------------------------------
//                                                      PROJECTIONS
//------------------------------------------------------------------------------------------------------------------------
function fillRgba(count, colorAt)
{
    const rgba = new Uint8ClampedArray(count * 4);
    for (let k = 0; k < count; k++)
    {
        const [r, g, b] = colorAt(k);
        rgba[k * 4] = r;
        rgba[k * 4 + 1] = g;
        rgba[k * 4 + 2] = b;
        rgba[k * 4 + 3] = 255;
    }
    return rgba;
}

function grayscale(level)
{
    const v = Math.round(clampNumber(level, 0, 1) * 255);
    return [v, v, v];
}

// Renders one view from a terrain result: { n, elevation, attrs, satmapRgba, sea, settings }.
//------------------------------------------------------------------------------------------------------------------------
//                                                    IMAGE ORIENTATION
//------------------------------------------------------------------------------------------------------------------------
// Grid row j is the north index, so row 0 is the south edge. Image rows run top to bottom, so views are flipped
// vertically to put north at the top. The 3D terrain samples the grid directly and does not use these views.
function northUpPixels(pixels, n)
{
    const stride = n * 4;
    const out = new Uint8ClampedArray(pixels.length);
    for (let row = 0; row < n; row++)
    {
        out.set(pixels.subarray((n - 1 - row) * stride, (n - row) * stride), row * stride);
    }
    return out;
}

// Image pixels for one view, north at the top.
export function renderView(viewId, result)
{
    return northUpPixels(gridViewPixels(viewId, result), result.n);
}

function gridViewPixels(viewId, result)
{
    const n = result.n;
    const count = n * n;
    const attrs = result.attrs;
    const sea = result.settings.seaLevelM;
    const sun = sunDirection(result.settings.sunAzimuthDeg, result.settings.sunElevationDeg);
    switch (viewId)
    {
        case 'satmap':
            return result.satmapRgba;
        case 'shaded':
        {
            const shade = hillshadeField(result.elevation, n, result.dx, sun);
            return fillRgba(count, (k) => grayscale((shade[k] - 0.3) / 1.0));
        }
        case 'height':
        {
            const top = Math.max(summarizeField(result.elevation).max, sea + 1);
            return fillRgba(count, (k) => rampColor(RAMPS.elevation, (result.elevation[k] - sea) / (top - sea)));
        }
        case 'protrusion':
        {
            const range = Math.max(10, Math.max(Math.abs(summarizeField(attrs.protrusion).min), Math.abs(summarizeField(attrs.protrusion).max)));
            return fillRgba(count, (k) => rampColor(RAMPS.protrusion, 0.5 + 0.5 * clampNumber(attrs.protrusion[k] / range, -1, 1)));
        }
        case 'river':
            return fillRgba(count, (k) => rampColor(RAMPS.river, attrs.river[k]));
        case 'sediment':
        {
            const top = Math.max(1, summarizeField(attrs.sediment).max);
            return fillRgba(count, (k) => rampColor(RAMPS.sediment, attrs.sediment[k] / top));
        }
        case 'erosion':
        {
            const range = Math.max(5, Math.max(Math.abs(summarizeField(attrs.erosion).min), Math.abs(summarizeField(attrs.erosion).max)));
            return fillRgba(count, (k) => rampColor(RAMPS.erosion, 0.5 + 0.5 * clampNumber(attrs.erosion[k] / range, -1, 1)));
        }
        case 'slope':
            return fillRgba(count, (k) => rampColor(RAMPS.slope, attrs.slope[k] / 60));
        case 'wetness':
            return fillRgba(count, (k) => rampColor(RAMPS.wetness, attrs.wetness[k]));
        case 'bedding':
            return fillRgba(count, (k) => rampColor(RAMPS.bedding, smoothStep(0, 1, attrs.bedding[k])));
        default:
            return result.satmapRgba;
    }
}
