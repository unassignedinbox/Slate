//============================================================================================================================================
//                                                             SATMAPSEQUENCE.JS
//============================================================================================================================================
// 📦 Tools/LandscapeEditor/src/engine/SatmapSequence.js — Satmap stack rendering: driver bands, spatial masks, breakup noise and
//    palette variation composed bottom to top, then hillshaded and stylised into RGBA.

import { createField, gradientField, smoothStep, clampNumber, mixNumber } from './HeightSpace.js';
import { createLattice } from './LatticeSpace.js';
import { fractalBrownian } from './FractalIntegrator.js';
import { computeMask } from './MaskSpecification.js';
import { produceShape } from './GeneratorSpecification.js';
import { bandWeights, materialPalette } from './SatmapClassifier.js';

const SOIL_TONE = [0.42, 0.36, 0.28];

//------------------------------------------------------------------------------------------------------------------------
//                                                        SHADING
//------------------------------------------------------------------------------------------------------------------------
// Unit vector towards the sun from settings (azimuth clockwise from north, elevation above the horizon).
export function sunDirection(azimuthDeg, elevationDeg)
{
    const azimuth = (azimuthDeg * Math.PI) / 180;
    const elevation = (elevationDeg * Math.PI) / 180;
    return {
        east: Math.sin(azimuth) * Math.cos(elevation),
        north: Math.cos(azimuth) * Math.cos(elevation),
        up: Math.sin(elevation)
    };
}

// Lambert shading of the heightfield, returned as a multiplier around 0.3 to 1.2.
export function hillshadeField(elevation, n, dx, sun)
{
    const { gx, gy } = gradientField(elevation, n, dx);
    const out = createField(n * n);
    for (let k = 0; k < out.length; k++)
    {
        const nx = -gx[k];
        const ny = -gy[k];
        const length = Math.sqrt(nx * nx + ny * ny + 1);
        const lambert = Math.max(0, (nx * sun.east + ny * sun.north + sun.up) / length);
        out[k] = 0.42 + 0.72 * lambert;
    }
    return out;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   STACK COMPOSITION
//------------------------------------------------------------------------------------------------------------------------
// Returns Uint8ClampedArray RGBA, north-up in map coordinates (row j = north index).
export function renderSatmap(context, layers, elevation, attrs)
{
    const n = context.n;
    const count = n * n;
    const dx = context.dx;
    const red = createField(count, SOIL_TONE[0]);
    const green = createField(count, SOIL_TONE[1]);
    const blue = createField(count, SOIL_TONE[2]);
    const variationLattice = createLattice(context.seed * 17 + 911);
    const variation = createField(count);
    for (let j = 0; j < n; j++)
    {
        for (let i = 0; i < n; i++)
        {
            const noise = 0.5 + 0.5 * fractalBrownian(variationLattice, (i * dx) / 160, (j * dx) / 160, 3, 2.0, 0.5);
            variation[j * n + i] = clampNumber(noise, 0, 1);
        }
    }

    for (let position = 0; position < layers.length; position++)
    {
        const layer = layers[position];
        if (layer.enabled === false)
        {
            continue;
        }
        const seed = layer.seed | 0;
        const layerContext = {
            ...context,
            seed,
            lattice: createLattice(seed),
            maskLattice: createLattice(seed * 31 + 7)
        };
        const palette = materialPalette(layer.material);
        const paletteCount = palette.length / 3;
        const driverField = attrs[layer.driver] || attrs.height;
        const weights = bandWeights(driverField, layer.band);
        const spatial = computeMask(layerContext, layer.mask, elevation);
        // Optional generator: a noise or shape field that modulates where the paint lands.
        const shaping = layer.generator && layer.generator.type && layer.generator.enabled !== false
            ? produceShape(layerContext, { type: layer.generator.type, params: layer.generator.params || {} })
            : null;
        const breakupAmount = clampNumber(layer.breakup?.amount ?? 0, 0, 1);
        let breakup = null;
        if (breakupAmount > 0)
        {
            breakup = createField(count);
            const scale = Math.max(layer.breakup.scaleM, 1);
            const threshold = clampNumber(layer.breakup.threshold, 0, 1);
            for (let j = 0; j < n; j++)
            {
                for (let i = 0; i < n; i++)
                {
                    const noise = 0.5 + 0.5 * fractalBrownian(layerContext.maskLattice, (i * dx) / scale, (j * dx) / scale, 4, 2.0, 0.5);
                    breakup[j * n + i] = smoothStep(threshold - 0.12, threshold + 0.12, clampNumber(noise, 0, 1));
                }
            }
        }
        const opacity = clampNumber(layer.opacity ?? 1, 0, 1);
        const mode = layer.mixMode || 'over';
        for (let k = 0; k < count; k++)
        {
            let weight = weights[k] * opacity * (spatial ? spatial[k] : 1) * (shaping ? shaping[k] : 1);
            if (breakup)
            {
                weight *= mixNumber(1, breakup[k], breakupAmount);
            }
            if (weight < 0.003)
            {
                continue;
            }
            const position01 = variation[k] * (paletteCount - 1);
            const first = Math.min(paletteCount - 2, Math.floor(position01));
            const fraction = paletteCount > 1 ? position01 - first : 0;
            const a = paletteCount > 1 ? first * 3 : 0;
            const b = paletteCount > 1 ? a + 3 : 0;
            const cr = paletteCount > 1 ? mixNumber(palette[a], palette[b], fraction) : palette[0];
            const cg = paletteCount > 1 ? mixNumber(palette[a + 1], palette[b + 1], fraction) : palette[1];
            const cb = paletteCount > 1 ? mixNumber(palette[a + 2], palette[b + 2], fraction) : palette[2];
            if (mode === 'multiply')
            {
                red[k] = mixNumber(red[k], red[k] * cr, weight);
                green[k] = mixNumber(green[k], green[k] * cg, weight);
                blue[k] = mixNumber(blue[k], blue[k] * cb, weight);
            }
            else if (mode === 'lighten')
            {
                red[k] = mixNumber(red[k], Math.max(red[k], cr), weight);
                green[k] = mixNumber(green[k], Math.max(green[k], cg), weight);
                blue[k] = mixNumber(blue[k], Math.max(blue[k], cb), weight);
            }
            else if (mode === 'darken')
            {
                red[k] = mixNumber(red[k], Math.min(red[k], cr), weight);
                green[k] = mixNumber(green[k], Math.min(green[k], cg), weight);
                blue[k] = mixNumber(blue[k], Math.min(blue[k], cb), weight);
            }
            else
            {
                red[k] = mixNumber(red[k], cr, weight);
                green[k] = mixNumber(green[k], cg, weight);
                blue[k] = mixNumber(blue[k], cb, weight);
            }
        }
    }

    const shade = hillshadeField(elevation, n, dx, sunDirection(context.sunAzimuthDeg, context.sunElevationDeg));
    const saturation = 1 + 0.6 * context.stylize;
    const contrast = 1 + 0.25 * context.stylize;
    const rgba = new Uint8ClampedArray(count * 4);
    for (let k = 0; k < count; k++)
    {
        let r = clampNumber(red[k] * shade[k], 0, 1);
        let g = clampNumber(green[k] * shade[k], 0, 1);
        let b = clampNumber(blue[k] * shade[k], 0, 1);
        const luma = 0.3 * r + 0.59 * g + 0.11 * b;
        r = luma + (r - luma) * saturation;
        g = luma + (g - luma) * saturation;
        b = luma + (b - luma) * saturation;
        r = clampNumber((r - 0.5) * contrast + 0.5, 0, 1);
        g = clampNumber((g - 0.5) * contrast + 0.5, 0, 1);
        b = clampNumber((b - 0.5) * contrast + 0.5, 0, 1);
        rgba[k * 4] = Math.round(r * 255);
        rgba[k * 4 + 1] = Math.round(g * 255);
        rgba[k * 4 + 2] = Math.round(b * 255);
        rgba[k * 4 + 3] = 255;
    }
    return rgba;
}
