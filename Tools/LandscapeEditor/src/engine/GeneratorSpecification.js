//============================================================================================================================================
//                                                         GENERATORSPECIFICATION.JS
//============================================================================================================================================
// 📦 Tools/LandscapeEditor/src/engine/GeneratorSpecification.js — Base shape generator catalogue: parameter schemas and field
//    synthesis for Perlin, multifractal, ridge, mountain, billow, mesa, dune, terrace, island and constant shapes.

import { createField, normalizeField, smoothStep, clampNumber } from './HeightSpace.js';
import { cellularSample, gradientNoise } from './LatticeSpace.js';
import { fractalBrownian, ridgedMultifractal, hybridMultifractal, billowFractal, warpCoordinate } from './FractalIntegrator.js';
import { sliderParameter, initialParameters, clampParameters } from './ParameterSpecification.js';

//------------------------------------------------------------------------------------------------------------------------
//                                                    SAMPLING HELPERS
//------------------------------------------------------------------------------------------------------------------------
// Samples sampler(x, y, k) on the lattice with x, y in feature units (metres divided by scaleM).
function sampleScaled(context, scaleM, sampler)
{
    const n = context.n;
    const dx = context.dx;
    const out = createField(n * n);
    const inverse = 1 / Math.max(scaleM, 1);
    for (let j = 0; j < n; j++)
    {
        const y = j * dx * inverse;
        for (let i = 0; i < n; i++)
        {
            const k = j * n + i;
            out[k] = sampler(i * dx * inverse, y, k);
        }
    }
    return out;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                  GENERATOR CATALOGUE
//------------------------------------------------------------------------------------------------------------------------
export const GENERATOR_TYPES = [
    {
        id: 'perlin',
        label: 'Perlin fBm',
        group: 'Noise',
        blurb: 'Gradient noise summed over octaves. Soft, rolling floorNoise relief for plains and broad uplands.',
        params: [
            sliderParameter('scaleM', 'Feature scale', 400, 12000, 50, 3200, 'm', 'Wavelength of the largest feature.'),
            sliderParameter('octaves', 'Octaves', 1, 8, 1, 6, '', 'Noise bands summed.'),
            sliderParameter('lacunarity', 'Lacunarity', 1.4, 3.2, 0.05, 2.0, '', 'Frequency ratio between octaves.'),
            sliderParameter('gain', 'Gain', 0.2, 0.8, 0.01, 0.42, '', 'Amplitude ratio between octaves. Below 0.5 keeps fine detail gentle.'),
            sliderParameter('warp', 'Domain warp', 0, 1, 0.01, 0.25, '', 'Bends features into organic flow.')
        ],
        produce(context, p)
        {
            return sampleScaled(context, p.scaleM, (x, y) =>
            {
                const w = warpCoordinate(context.lattice, x, y, p.warp);
                return fractalBrownian(context.lattice, w.x, w.y, p.octaves, p.lacunarity, p.gain);
            });
        }
    },
    {
        id: 'multifractal',
        label: 'Multifractal (hybrid)',
        group: 'Noise',
        blurb: 'Hybrid multifractal: smooth lowlands that gain ruggedness at altitude, like eroded continental shields.',
        params: [
            sliderParameter('scaleM', 'Feature scale', 400, 12000, 50, 3000, 'm', 'Wavelength of the largest feature.'),
            sliderParameter('octaves', 'Octaves', 2, 10, 1, 6, '', 'Noise bands summed.'),
            sliderParameter('lacunarity', 'Lacunarity', 1.6, 3.0, 0.05, 2.1, '', 'Frequency ratio between octaves.'),
            sliderParameter('roughness', 'Roughness H', 0.1, 1.4, 0.01, 1.05, '', 'Fractal dimension: above 1 keeps fine detail gentle; below 0.8 gets rugged and steep.'),
            sliderParameter('offset', 'Offset', 0.2, 1.5, 0.01, 0.7, '', 'Lifts the floorNoise so folds stay positive.'),
            sliderParameter('warp', 'Domain warp', 0, 1, 0.01, 0.2, '', 'Bends features into organic flow.')
        ],
        produce(context, p)
        {
            return sampleScaled(context, p.scaleM, (x, y) =>
            {
                const w = warpCoordinate(context.lattice, x, y, p.warp);
                return hybridMultifractal(context.lattice, w.x, w.y, p.octaves, p.lacunarity, p.roughness, p.offset);
            });
        }
    },
    {
        id: 'ridge',
        label: 'Ridge noise',
        group: 'Noise',
        blurb: 'Ridged multifractal: sharp, branching crests separated by valleys. Good for range spines.',
        params: [
            sliderParameter('scaleM', 'Feature scale', 400, 9000, 50, 2400, 'm', 'Wavelength of the largest ridge.'),
            sliderParameter('octaves', 'Octaves', 2, 9, 1, 6, '', 'Noise bands summed.'),
            sliderParameter('gain', 'Gain', 0.3, 0.7, 0.01, 0.42, '', 'Detail carried from octave to octave.'),
            sliderParameter('offset', 'Crest offset', 0.8, 1.2, 0.01, 1.0, '', 'Sharpens or softens crest lines.'),
            sliderParameter('warp', 'Domain warp', 0, 1, 0.01, 0.2, '', 'Bends ridges.')
        ],
        produce(context, p)
        {
            return sampleScaled(context, p.scaleM, (x, y) =>
            {
                const w = warpCoordinate(context.lattice, x, y, p.warp);
                return ridgedMultifractal(context.lattice, w.x, w.y, p.octaves, 2.1, p.gain, p.offset);
            });
        }
    },
    {
        id: 'mountain',
        label: 'Mountain noise',
        group: 'Noise',
        blurb: 'Domain-warped ridges raised to a sharpness exponent, blended with rounded foothills.',
        params: [
            sliderParameter('scaleM', 'Massif scale', 600, 9000, 50, 4200, 'm', 'Wavelength of the largest massif.'),
            sliderParameter('octaves', 'Octaves', 3, 9, 1, 6, '', 'Noise bands summed.'),
            sliderParameter('warp', 'Domain warp', 0, 1, 0.01, 0.6, '', 'Bends massifs into folded chains.'),
            sliderParameter('sharpness', 'Peak sharpness', 0.6, 3, 0.05, 1.7, '', 'Exponent applied to crests.'),
            sliderParameter('foothills', 'Foothills', 0, 1, 0.01, 0.25, '', 'Rounded lower slopes mixed in.')
        ],
        produce(context, p)
        {
            return sampleScaled(context, p.scaleM, (x, y) =>
            {
                const w = warpCoordinate(context.lattice, x, y, p.warp);
                const ridge = clampNumber(ridgedMultifractal(context.lattice, w.x, w.y, p.octaves, 2.1, 0.42, 1.0), 0, 1);
                const peaks = Math.pow(ridge, p.sharpness);
                const foot = 0.5 + 0.5 * billowFractal(context.lattice, x * 0.7, y * 0.7, 4, 2.0, 0.5);
                return peaks * (1 - p.foothills) + foot * p.foothills;
            });
        }
    },
    {
        id: 'billow',
        label: 'Billow hills',
        group: 'Noise',
        blurb: 'Cushion-shaped rounded hills from absolute noise. Suits glacial drumlins and weathered uplands.',
        params: [
            sliderParameter('scaleM', 'Feature scale', 300, 6000, 50, 1600, 'm', 'Wavelength of the largest hill.'),
            sliderParameter('octaves', 'Octaves', 2, 8, 1, 5, '', 'Noise bands summed.'),
            sliderParameter('gain', 'Gain', 0.3, 0.7, 0.01, 0.42, '', 'Detail carried from octave to octave.'),
            sliderParameter('warp', 'Domain warp', 0, 1, 0.01, 0.15, '', 'Bends hills.')
        ],
        produce(context, p)
        {
            return sampleScaled(context, p.scaleM, (x, y) =>
            {
                const w = warpCoordinate(context.lattice, x, y, p.warp);
                return billowFractal(context.lattice, w.x, w.y, p.octaves, 2.0, p.gain);
            });
        }
    },
    {
        id: 'plateau',
        label: 'Mesa & butte',
        group: 'Terraces',
        blurb: 'Cellular plateaus with terraced, cliff-edged tops. Tabletop mesas and buttes.',
        params: [
            sliderParameter('scaleM', 'Feature scale', 800, 9000, 50, 3600, 'm', 'Spacing of mesas.'),
            sliderParameter('steps', 'Terraces', 1, 10, 1, 4, '', 'Stepped benches on each mesa.'),
            sliderParameter('riser', 'Riser softness', 0.02, 0.4, 0.01, 0.14, '', 'Width of each cliff edge.'),
            sliderParameter('roughness', 'Roughness', 0, 1, 0.01, 0.25, '', 'Fine noise on the tops.'),
            sliderParameter('spread', 'Spacing', 0.5, 2.5, 0.05, 1.0, '', 'Density of features per scale.'),
            sliderParameter('irregularity', 'Outline irregularity', 0, 1, 0.01, 0.7, '', 'Warps the mesa outlines so they are not perfect rings.')
        ],
        produce(context, p)
        {
            return sampleScaled(context, p.scaleM, (x, y) =>
            {
                const bendX = p.irregularity * 0.35 * fractalBrownian(context.lattice, x * 1.3 + 5.2, y * 1.3 + 1.7, 3, 2.0, 0.5);
                const bendY = p.irregularity * 0.35 * fractalBrownian(context.lattice, x * 1.3 - 3.1, y * 1.3 + 8.4, 3, 2.0, 0.5);
                const cell = cellularSample(context.lattice, x * p.spread + bendX, y * p.spread + bendY);
                const rim = p.irregularity * 0.22 * fractalBrownian(context.lattice, x * 2.2 + 7.7, y * 2.2 - 4.4, 3, 2.0, 0.5);
                const cone = clampNumber(1 - cell.near * 1.6 + rim, 0, 1);
                const mesa = smoothStep(0.22, 0.5, cone);
                const steps = Math.max(1, Math.round(p.steps));
                const scaled = mesa * steps;
                const level = Math.floor(scaled);
                const fraction = scaled - level;
                const terrace = (level + smoothStep(1 - p.riser, 1, fraction)) / steps;
                return terrace + p.roughness * 0.08 * fractalBrownian(context.lattice, x * 3, y * 3, 4, 2.0, 0.5);
            });
        }
    },
    {
        id: 'dunes',
        label: 'Dune field',
        group: 'Aeolian',
        blurb: 'Transverse dunes with asymmetric windward ramps and steep slip faces, crests across the wind.',
        params: [
            sliderParameter('spacingM', 'Dune spacing', 60, 1500, 5, 420, 'm', 'Crest-to-crest distance.'),
            sliderParameter('windFromDeg', 'Wind from', 0, 360, 1, 225, '°', 'Bearing the wind blows from (0 = north).'),
            sliderParameter('asymmetry', 'Crest position', 0.55, 0.95, 0.01, 0.8, '', 'Fraction of the cycle spent climbing the windward side.'),
            sliderParameter('sinuosity', 'Sinuosity', 0, 1, 0.01, 0.35, '', 'Crest bending.'),
            sliderParameter('variation', 'Size variation', 0, 1, 0.01, 0.5, '', 'Patchy dune height.'),
            sliderParameter('scaleM', 'Patch scale', 600, 6000, 50, 2400, 'm', 'Scale of size variation.')
        ],
        produce(context, p)
        {
            const n = context.n;
            const dx = context.dx;
            const lattice = context.lattice;
            const out = createField(n * n);
            const toward = ((p.windFromDeg + 180) * Math.PI) / 180;
            const east = Math.sin(toward);
            const north = Math.cos(toward);
            const scale = Math.max(p.scaleM, 1);
            const asymmetry = clampNumber(p.asymmetry, 0.05, 0.95);
            for (let j = 0; j < n; j++)
            {
                const yM = j * dx;
                for (let i = 0; i < n; i++)
                {
                    const xM = i * dx;
                    const wobble = p.sinuosity * 0.8 * fractalBrownian(lattice, xM / 1800, yM / 1800, 3, 2.0, 0.5)
                        + p.sinuosity * 0.2 * fractalBrownian(lattice, xM / 420 + 2.4, yM / 420 - 6.1, 2, 2.0, 0.5);
                    const spacingFactor = 1 + 0.45 * fractalBrownian(lattice, xM / 2600 + 4.3, yM / 2600 + 1.1, 3, 2.0, 0.5);
                    const phase = (xM * east + yM * north) / (Math.max(p.spacingM, 1) * spacingFactor) + wobble;
                    const u = phase - Math.floor(phase);
                    const profile = u < asymmetry
                        ? Math.pow(u / asymmetry, 1.5)
                        : Math.pow(1 - (u - asymmetry) / (1 - asymmetry), 0.7);
                    const patch = 0.5 + 0.5 * fractalBrownian(lattice, xM / scale + 9.1, yM / scale + 3.7, 3, 2.0, 0.5);
                    const size = 1 - p.variation + p.variation * patch;
                    out[j * n + i] = profile * size;
                }
            }
            return out;
        }
    },
    {
        id: 'terraces',
        label: 'Stepped terraces',
        group: 'Terraces',
        blurb: 'Quantized noise with cliff risers: layered benches like sedimentary tablelands and canyon rims.',
        params: [
            sliderParameter('scaleM', 'Feature scale', 600, 9000, 50, 3600, 'm', 'Wavelength of the terrace field.'),
            sliderParameter('steps', 'Steps', 2, 12, 1, 5, '', 'Number of benches.'),
            sliderParameter('riser', 'Riser softness', 0.02, 0.4, 0.01, 0.15, '', 'Width of each cliff.'),
            sliderParameter('octaves', 'Octaves', 2, 7, 1, 5, '', 'Noise bands summed.'),
            sliderParameter('warp', 'Domain warp', 0, 1, 0.01, 0.25, '', 'Bends terrace lines.')
        ],
        produce(context, p)
        {
            return sampleScaled(context, p.scaleM, (x, y) =>
            {
                const w = warpCoordinate(context.lattice, x, y, p.warp);
                const floorNoise = fractalBrownian(context.lattice, w.x, w.y, p.octaves, 2.0, 0.5);
                const steps = Math.max(2, Math.round(p.steps));
                const scaled = clampNumber(floorNoise * 0.5 + 0.5, 0, 0.9999) * steps;
                const level = Math.floor(scaled);
                const fraction = scaled - level;
                return (level + smoothStep(1 - p.riser, 1, fraction)) / steps;
            });
        }
    },
    {
        id: 'island',
        label: 'Island (radial)',
        group: 'Coast',
        blurb: 'A radial landmass with a ragged coastline and ridged relief. Pair with a negative offset for seabed.',
        params: [
            sliderParameter('radius', 'Island radius', 0.3, 0.98, 0.01, 0.8, '', 'Fraction of the half-width covered by land.'),
            sliderParameter('coastSoftness', 'Coast softness', 0.01, 0.3, 0.01, 0.08, '', 'Width of the shoreline transition.'),
            sliderParameter('roughness', 'Coast roughness', 0, 1, 0.01, 0.9, '', 'Ragged coastline amount.'),
            sliderParameter('aspect', 'Elongation', 0.6, 1.6, 0.01, 1.15, '', 'Stretches the island along the east-west axis.'),
            sliderParameter('scaleM', 'Relief scale', 300, 6000, 50, 1800, 'm', 'Wavelength of the interior relief.')
        ],
        produce(context, p)
        {
            const n = context.n;
            const dx = context.dx;
            const half = Math.max(context.sizeM * 0.5, 1);
            const lattice = context.lattice;
            const out = createField(n * n);
            const scale = Math.max(p.scaleM, 1);
            for (let j = 0; j < n; j++)
            {
                const yM = j * dx;
                const ny = (yM - half) / half;
                for (let i = 0; i < n; i++)
                {
                    const xM = i * dx;
                    const ex = (xM - half) / half / Math.max(p.aspect, 0.2);
                    const radial = Math.sqrt(ex * ex + ny * ny);
                    const shore = fractalBrownian(lattice, xM / (scale * 1.4) + 3.3, yM / (scale * 1.4) - 2.2, 4, 2.0, 0.5);
                    const bays = fractalBrownian(lattice, xM / (scale * 0.35) - 8.1, yM / (scale * 0.35) + 5.6, 3, 2.0, 0.5);
                    const edge = radial + p.roughness * (0.22 * shore + 0.07 * bays);
                    const coast = 1 - smoothStep(p.radius - p.coastSoftness, p.radius + p.coastSoftness, edge);
                    const relief = clampNumber(ridgedMultifractal(lattice, xM / (scale * 0.7), yM / (scale * 0.7), 6, 2.1, 0.42, 1.0), 0, 1);
                    // Shelf-shaped shore: the land rises gently from the waterline, so cliffs only appear where waves cut them.
                    out[j * n + i] = Math.pow(coast, 1.6) * (0.45 + 0.55 * relief);
                }
            }
            return out;
        }
    },
    {
        id: 'constant',
        label: 'Constant plane',
        group: 'Simple',
        blurb: 'Uniform level. Use with amplitude and offset to carve trenches, flatten or lift a whole region.',
        normalize: false,
        params: [],
        produce(context)
        {
            return createField(context.n * context.n, 1);
        }
    }
];

//------------------------------------------------------------------------------------------------------------------------
//                                                  LOOKUP AND SYNTHESIS
//------------------------------------------------------------------------------------------------------------------------
export function generatorTypeById(id)
{
    return GENERATOR_TYPES.find((type) => type.id === id) || GENERATOR_TYPES[0];
}

export function generatorDefaults(id)
{
    return initialParameters(generatorTypeById(id).params);
}

// Produces a shape field in [0, 1] (or raw for constant planes) for one generator layer.
export function produceShape(context, layer)
{
    const type = generatorTypeById(layer.type);
    const params = clampParameters(type.params, layer.params);
    const raw = type.produce(context, params);
    return type.normalize === false ? raw : normalizeField(raw, 0.001, 0.999);
}
