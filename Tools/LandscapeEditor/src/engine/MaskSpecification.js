//============================================================================================================================================
//                                                            MASKSPECIFICATION.JS
//============================================================================================================================================
// 📦 Tools/LandscapeEditor/src/engine/MaskSpecification.js — Spatial mask catalogue: coastal falloff, mountain altitude band, slope
//    and cliff bands, bedding, rift lines, breakup noise, protrusion and radial falloffs with feather and invert.

import { createField, gaussianBlur, gradientField, distanceField, smoothStep, clampNumber, mixNumber } from './HeightSpace.js';
import { gradientNoise } from './LatticeSpace.js';
import { fractalBrownian, warpCoordinate } from './FractalIntegrator.js';
import { computeBedding } from './BeddingSpace.js';
import { sliderParameter, choiceParameter, initialParameters, clampParameters } from './ParameterSpecification.js';

//------------------------------------------------------------------------------------------------------------------------
//                                                     MASK CATALOGUE
//------------------------------------------------------------------------------------------------------------------------
export const MASK_TYPES = [
    {
        id: 'none',
        label: 'No mask',
        blurb: 'The layer applies everywhere.',
        params: [],
        produce()
        {
            return null;
        }
    },
    {
        id: 'coastal',
        label: 'Coastal falloff',
        blurb: 'Smooth taper from the shoreline inland, or offshore for shelves. Jitter breaks the coast into bays.',
        params: [
            sliderParameter('falloffM', 'Falloff distance', 20, 2000, 10, 350, 'm', 'Distance over which the mask fades in from the coast.'),
            sliderParameter('jitterM', 'Shoreline jitter', 0, 600, 5, 120, 'm', 'Irregular bays along the shore.'),
            choiceParameter('side', 'Side', [{ id: 'land', label: 'Land' }, { id: 'sea', label: 'Offshore' }], 'land', 'Which side of the shoreline the mask covers.')
        ],
        produce(context, p, elevation)
        {
            const n = context.n;
            const dx = context.dx;
            const count = n * n;
            const sea = context.sea;
            const seaCells = new Uint8Array(count);
            const landCells = new Uint8Array(count);
            for (let k = 0; k < count; k++)
            {
                const isSea = elevation[k] < sea ? 1 : 0;
                seaCells[k] = isSea;
                landCells[k] = 1 - isSea;
            }
            const land = p.side === 'land';
            const distance = distanceField(land ? seaCells : landCells, n, dx);
            const out = createField(count);
            for (let j = 0; j < n; j++)
            {
                for (let i = 0; i < n; i++)
                {
                    const k = j * n + i;
                    const isLand = landCells[k] === 1;
                    if (land !== isLand)
                    {
                        continue;
                    }
                    const jitter = p.jitterM * fractalBrownian(context.maskLattice, (i * dx) / 1200, (j * dx) / 1200, 4, 2.0, 0.5);
                    out[k] = smoothStep(0, p.falloffM, distance[k] + jitter);
                }
            }
            return out;
        }
    },
    {
        id: 'massif',
        label: 'Mountain falloff',
        blurb: 'Altitude band with smooth shoulders: lifts the mask over foothills and lets it fade near the summit. Breakup keeps it non-continuous.',
        params: [
            sliderParameter('lowM', 'Lower altitude', 0, 4000, 10, 900, 'm', 'Above this height the mask starts.'),
            sliderParameter('highM', 'Upper altitude', 0, 6000, 10, 3200, 'm', 'Above this height the mask fades out.'),
            sliderParameter('shoulderM', 'Shoulder width', 10, 1500, 5, 400, 'm', 'Softness of both altitude edges.'),
            sliderParameter('breakup', 'Breakup', 0, 1, 0.01, 0.5, '', 'Patchy, non-continuous massifs.'),
            sliderParameter('scaleM', 'Breakup scale', 300, 6000, 50, 1800, 'm', 'Size of the breakup patches.'),
            sliderParameter('exponent', 'Contrast', 0.5, 3, 0.05, 1.0, '', 'Sharpens or softens the falloff curve.')
        ],
        produce(context, p, elevation)
        {
            const n = context.n;
            const dx = context.dx;
            const sea = context.sea;
            const scale = Math.max(p.scaleM, 1);
            const out = createField(n * n);
            for (let j = 0; j < n; j++)
            {
                for (let i = 0; i < n; i++)
                {
                    const k = j * n + i;
                    const height = elevation[k] - sea;
                    const rising = smoothStep(p.lowM - p.shoulderM, p.lowM + p.shoulderM, height);
                    const falling = 1 - smoothStep(p.highM - p.shoulderM, p.highM + p.shoulderM, height);
                    let mask = rising * falling;
                    if (p.breakup > 0)
                    {
                        const noise = 0.5 + 0.5 * fractalBrownian(context.maskLattice, (i * dx) / scale, (j * dx) / scale, 5, 2.0, 0.5);
                        mask *= mixNumber(1, smoothStep(0.35, 0.65, noise), p.breakup);
                    }
                    out[k] = Math.pow(clampNumber(mask, 0, 1), p.exponent);
                }
            }
            return out;
        }
    },
    {
        id: 'slope',
        label: 'Slope band',
        blurb: 'Mask by surface steepness between two angles. Gentle slopes or steep faces only.',
        params: [
            sliderParameter('lowDeg', 'Lower angle', 0, 60, 0.5, 15, '°', 'Slopes below this are excluded.'),
            sliderParameter('highDeg', 'Upper angle', 5, 80, 0.5, 35, '°', 'Slopes above this are fully included.')
        ],
        produce(context, p, elevation)
        {
            const { gx, gy } = gradientField(elevation, context.n, context.dx);
            const out = createField(context.n * context.n);
            for (let k = 0; k < out.length; k++)
            {
                const degrees = (Math.atan(Math.sqrt(gx[k] * gx[k] + gy[k] * gy[k])) * 180) / Math.PI;
                out[k] = smoothStep(p.lowDeg, p.highDeg, degrees);
            }
            return out;
        }
    },
    {
        id: 'cliff',
        label: 'Cliff faces',
        blurb: 'Only the steep, near-vertical faces between two angles. Use to carve rock walls and escarpments.',
        params: [
            sliderParameter('lowDeg', 'Lower angle', 10, 80, 0.5, 38, '°', 'Start of the cliff band.'),
            sliderParameter('highDeg', 'Upper angle', 20, 90, 0.5, 65, '°', 'End of the cliff band.'),
            sliderParameter('softDeg', 'Edge softness', 0.5, 20, 0.5, 6, '°', 'Feathering of both edges.')
        ],
        produce(context, p, elevation)
        {
            const { gx, gy } = gradientField(elevation, context.n, context.dx);
            const out = createField(context.n * context.n);
            for (let k = 0; k < out.length; k++)
            {
                const degrees = (Math.atan(Math.sqrt(gx[k] * gx[k] + gy[k] * gy[k])) * 180) / Math.PI;
                out[k] = smoothStep(p.lowDeg - p.softDeg, p.lowDeg + p.softDeg, degrees)
                    * (1 - smoothStep(p.highDeg - p.softDeg, p.highDeg + p.softDeg, degrees));
            }
            return out;
        }
    },
    {
        id: 'bedding',
        label: 'Stratify (bedding)',
        blurb: 'Follows dipping sedimentary beds. Selects caprock or the softer beds beneath.',
        params: [
            choiceParameter('band', 'Select', [{ id: 'hard', label: 'Hard caprock' }, { id: 'soft', label: 'Soft beds' }], 'hard', 'Which beds the mask keeps.')
        ],
        produce(context, p, elevation)
        {
            const bedding = computeBedding(context.bedding, context.n, context.dx, elevation);
            const out = createField(context.n * context.n);
            for (let k = 0; k < out.length; k++)
            {
                out[k] = p.band === 'hard' ? bedding.hard[k] : 1 - bedding.hard[k];
            }
            return out;
        }
    },
    {
        id: 'rift',
        label: 'Rift lines',
        blurb: 'Thin, meandering lines from zero crossings of warped noise: fault traces and rift valleys.',
        params: [
            sliderParameter('scaleM', 'Line spacing', 800, 12000, 50, 4000, 'm', 'Typical distance between rift lines.'),
            sliderParameter('widthN', 'Line width', 0.01, 0.2, 0.005, 0.05, '', 'Width of each line in noise units.'),
            sliderParameter('warp', 'Meander', 0, 1, 0.01, 0.4, '', 'Bends the lines.')
        ],
        produce(context, p)
        {
            const n = context.n;
            const dx = context.dx;
            const scale = Math.max(p.scaleM, 1);
            const out = createField(n * n);
            for (let j = 0; j < n; j++)
            {
                for (let i = 0; i < n; i++)
                {
                    const w = warpCoordinate(context.maskLattice, (i * dx) / scale, (j * dx) / scale, p.warp);
                    const line = Math.abs(gradientNoise(context.maskLattice, w.x, w.y));
                    out[j * n + i] = 1 - smoothStep(0, p.widthN, line);
                }
            }
            return out;
        }
    },
    {
        id: 'breakup',
        label: 'Noise breakup',
        blurb: 'Fractal noise thresholded into patches. Use to scatter any effect irregularly.',
        params: [
            sliderParameter('scaleM', 'Patch scale', 200, 6000, 50, 1200, 'm', 'Size of the patches.'),
            sliderParameter('octaves', 'Octaves', 1, 7, 1, 5, '', 'Edge detail.'),
            sliderParameter('threshold', 'Threshold', 0, 1, 0.01, 0.5, '', 'Coverage: higher keeps less.'),
            sliderParameter('softness', 'Edge softness', 0.01, 0.5, 0.01, 0.15, '', 'Feathering of patch edges.')
        ],
        produce(context, p)
        {
            const n = context.n;
            const dx = context.dx;
            const scale = Math.max(p.scaleM, 1);
            const out = createField(n * n);
            for (let j = 0; j < n; j++)
            {
                for (let i = 0; i < n; i++)
                {
                    const noise = 0.5 + 0.5 * fractalBrownian(context.maskLattice, (i * dx) / scale, (j * dx) / scale, p.octaves, 2.0, 0.5);
                    out[j * n + i] = smoothStep(p.threshold - p.softness, p.threshold + p.softness, noise);
                }
            }
            return out;
        }
    },
    {
        id: 'protrusion',
        label: 'Protrusion (ridges)',
        blurb: 'Selects ridges and spurs that rise above their surroundings (topographic position). Uses the current surface.',
        params: [
            sliderParameter('radiusM', 'Neighbourhood', 80, 1500, 10, 350, 'm', 'Size of the surrounding area used as reference.'),
            sliderParameter('lowM', 'Lower threshold', -100, 100, 1, 0, 'm', 'Protrusion below this is excluded.'),
            sliderParameter('highM', 'Upper threshold', -100, 200, 1, 40, 'm', 'Protrusion above this is fully included.')
        ],
        produce(context, p, elevation)
        {
            const smooth = gaussianBlur(elevation, context.n, p.radiusM / context.dx / 2);
            const out = createField(context.n * context.n);
            for (let k = 0; k < out.length; k++)
            {
                out[k] = smoothStep(p.lowM, p.highM, elevation[k] - smooth[k]);
            }
            return out;
        }
    },
    {
        id: 'radial',
        label: 'Radial falloff',
        blurb: 'Full inside an inner radius, fading to nothing at the outer radius. Centred on the map.',
        params: [
            sliderParameter('innerFrac', 'Inner radius', 0, 1.4, 0.01, 0.25, '', 'Fraction of the half-width kept fully.'),
            sliderParameter('outerFrac', 'Outer radius', 0.05, 1.5, 0.01, 0.95, '', 'Fraction of the half-width where the mask reaches zero.')
        ],
        produce(context, p)
        {
            const n = context.n;
            const dx = context.dx;
            const half = Math.max(context.sizeM * 0.5, 1);
            const out = createField(n * n);
            for (let j = 0; j < n; j++)
            {
                const ny = (j * dx - half) / half;
                for (let i = 0; i < n; i++)
                {
                    const ex = (i * dx - half) / half;
                    const radial = Math.sqrt(ex * ex + ny * ny);
                    out[j * n + i] = 1 - smoothStep(p.innerFrac, p.outerFrac, radial);
                }
            }
            return out;
        }
    }
];

//------------------------------------------------------------------------------------------------------------------------
//                                                 LOOKUP AND APPLICATION
//------------------------------------------------------------------------------------------------------------------------
export function maskTypeById(id)
{
    return MASK_TYPES.find((type) => type.id === id) || MASK_TYPES[0];
}

export function maskDefaults(id)
{
    return initialParameters(maskTypeById(id).params);
}

// Returns a Float32Array in [0, 1] or null when the layer has no mask. Applies feather then invert.
export function computeMask(context, mask, elevation)
{
    if (!mask || mask.type === 'none')
    {
        return null;
    }
    const type = maskTypeById(mask.type);
    const params = clampParameters(type.params, mask.params);
    const raw = type.produce(context, params, elevation);
    if (!raw)
    {
        return null;
    }
    let out = raw;
    if (mask.featherM && mask.featherM > 0.5)
    {
        out = gaussianBlur(out, context.n, mask.featherM / context.dx);
    }
    if (mask.invert)
    {
        for (let k = 0; k < out.length; k++)
        {
            out[k] = 1 - out[k];
        }
    }
    return out;
}
