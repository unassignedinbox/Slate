//============================================================================================================================================
//                                                           PRESETCONFIGURATION.JS
//============================================================================================================================================
// 📦 Tools/LandscapeEditor/src/engine/PresetConfiguration.js — The ten landscape presets: each is a complete height stack, satmap
//    stack and settings override, expressed with compact layer builders.

import { generatorDefaults } from './GeneratorSpecification.js';
import { erosionDefaults } from './ErosionSpecification.js';
import { maskDefaults } from './MaskSpecification.js';
import { hashText } from './LayerIndex.js';

//------------------------------------------------------------------------------------------------------------------------
//                                                     LAYER BUILDERS
//------------------------------------------------------------------------------------------------------------------------
function seedFor(presetId, label)
{
    return parseInt(hashText(presetId + label).slice(0, 6), 16) % 99991;
}

function buildMask(spec)
{
    if (!spec)
    {
        return { type: 'none', params: {}, invert: false, featherM: 0 };
    }
    return {
        type: spec.type,
        params: { ...maskDefaults(spec.type), ...(spec.params || {}) },
        invert: Boolean(spec.invert),
        featherM: spec.featherM || 0
    };
}

function makeBuilder(presetId)
{
    let counter = 0;
    const nextId = (prefix) =>
    {
        counter += 1;
        return `${presetId}-${prefix}-${counter}`;
    };
    return {
        shape(name, type, options = {})
        {
            return {
                id: nextId('g'),
                name,
                category: 'generator',
                type,
                enabled: true,
                opacity: 1,
                mixMode: options.mixMode || 'add',
                offsetM: options.offsetM ?? 0,
                amplitudeM: options.amplitudeM ?? 600,
                seed: options.seed ?? seedFor(presetId, name),
                params: { ...generatorDefaults(type), ...(options.params || {}) },
                mask: buildMask(options.mask)
            };
        },
        erode(name, type, options = {})
        {
            return {
                id: nextId('e'),
                name,
                category: 'erosion',
                type,
                enabled: true,
                opacity: options.opacity ?? 1,
                mixMode: 'replace',
                seed: options.seed ?? seedFor(presetId, name),
                params: { ...erosionDefaults(type), ...(options.params || {}) },
                mask: buildMask(options.mask)
            };
        },
        satmap(name, material, driver, band, options = {})
        {
            return {
                id: nextId('s'),
                name,
                category: 'satmap',
                material,
                driver,
                band: { lo: band[0], hi: band[1], soft: band[2] ?? 4 },
                breakup: options.breakup
                    ? { amount: options.breakup.amount, scaleM: options.breakup.scaleM ?? 400, threshold: options.breakup.threshold ?? 0.5 }
                    : { amount: 0, scaleM: 400, threshold: 0.5 },
                mask: buildMask(options.mask),
                opacity: options.opacity ?? 1,
                mixMode: options.mixMode || 'over',
                enabled: true,
                seed: options.seed ?? seedFor(presetId, name)
            };
        }
    };
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   PRESET DEFINITIONS
//------------------------------------------------------------------------------------------------------------------------
function definePreset(id, name, icon, blurb, settings, build)
{
    const builder = makeBuilder(id);
    const built = build(builder);
    const talus = builder.erode('Talus stabilisation', 'thermal', { params: { talusDeg: 38, rate: 0.3, iterations: 120, litho: 0.3 } });
    const heightLayers = [...built.heightLayers, talus];
    return { id, name, icon, blurb, settings, heightLayers, satmapLayers: built.satmapLayers };
}

export const PRESETS = [
    definePreset('canyons', 'Canyons (sandstone canyons)', 'Waypoints', 'Sandstone canyons: stepped benches cut by a dendritic river network, with talus and desert varnish on the walls.',
        { sizeM: 5000, seaLevelM: -400, snowlineM: 4000, stylize: 0.4, seed: 2101, riverKm2: 0.06 },
        (b) => ({
            heightLayers: [
                b.shape('Plateau benches', 'terraces', { amplitudeM: 600, offsetM: 500, mixMode: 'replace', params: { scaleM: 2400, steps: 4, riser: 0.12, octaves: 5, warp: 0.35 } }),
                b.shape('Rolling uplands', 'perlin', { amplitudeM: 120, params: { scaleM: 1800, octaves: 6, warp: 0.3 } }),
                b.erode('Canyon incision', 'fluvial', { params: { upliftM: 280, streamK: 0.55, iterations: 80, transport: 0.25, depositFraction: 0.3, rainfall: 1.4, litho: 0.55 } }),
                b.erode('Scarp talus', 'thermal', { params: { talusDeg: 33, rate: 0.25, iterations: 40, litho: 0.55 } }),
                b.erode('Gully rain', 'hydraulic', { opacity: 0.5, mask: { type: 'slope', params: { lowDeg: 12, highDeg: 40 } }, params: { density: 1.0, lifetime: 60, radius: 2, litho: 0.55 } })
            ],
            satmapLayers: [
                b.satmap('Sandstone bedrock', 'sandstone', 'height', [-1000, 5000, 20]),
                b.satmap('Caprock strata', 'strata', 'bedding', [0.5, 1, 0.1], { breakup: { amount: 0.2, scaleM: 500 } }),
                b.satmap('Desert varnish', 'varnish', 'slope', [6, 22, 4], { opacity: 0.6 }),
                b.satmap('Talus scree', 'scree', 'slope', [22, 50, 5], { opacity: 0.9 }),
                b.satmap('Sand deposits', 'sand', 'sediment', [2, 80, 1.5], { opacity: 0.85 }),
                b.satmap('River water', 'water', 'river', [0.6, 1, 0.1])
            ]
        })),
    definePreset('sandstone-cliffs', 'Sandstone cliffs', 'Landmark', 'Mesas and escarpments of layered sandstone. Hard caprock holds steep cliffs over softer beds.',
        { sizeM: 5000, seaLevelM: -300, snowlineM: 4000, stylize: 0.35, seed: 3307, riverKm2: 0.08 },
        (b) => ({
            heightLayers: [
                b.shape('Mesa field', 'plateau', { amplitudeM: 750, offsetM: 250, mixMode: 'replace', params: { scaleM: 3400, steps: 3, riser: 0.14, spread: 1.0 } }),
                b.shape('Escarpment ridges', 'ridge', { amplitudeM: 300, params: { scaleM: 2600, octaves: 6 } }),
                b.erode('Caprock weathering', 'thermal', { params: { talusDeg: 40, rate: 0.2, iterations: 60, litho: 0.95 } }),
                b.erode('Fluvial dissection', 'fluvial', { params: { upliftM: 120, streamK: 0.3, iterations: 40, rainfall: 1.0, litho: 0.8 } }),
                b.erode('Rain sculpting', 'hydraulic', { opacity: 0.6, params: { density: 0.8, litho: 0.8 } })
            ],
            satmapLayers: [
                b.satmap('Sandstone bedrock', 'sandstone', 'height', [-1000, 5000, 20]),
                b.satmap('Caprock strata', 'strata', 'bedding', [0.5, 1, 0.08], { breakup: { amount: 0.25, scaleM: 420 } }),
                b.satmap('Cliff varnish', 'varnish', 'slope', [34, 70, 5], { opacity: 0.9 }),
                b.satmap('Talus scree', 'scree', 'slope', [14, 34, 5], { opacity: 0.85 }),
                b.satmap('Sand drifts', 'sand', 'sediment', [1, 80, 1.5], { opacity: 0.8 }),
                b.satmap('Sparse scrub', 'scrub', 'slope', [0, 5, 2], { opacity: 0.5, breakup: { amount: 0.6, scaleM: 300, threshold: 0.6 } })
            ]
        })),
    definePreset('coastal-cliffs', 'Coastal cliffs', 'Anchor', 'An island coastline with wave-cut platforms, sea cliffs and talus, inland uplands and shore beaches.',
        { sizeM: 5000, seaLevelM: 0, snowlineM: 2600, stylize: 0.35, seed: 4411, riverKm2: 0.048 },
        (b) => ({
            heightLayers: [
                b.shape('Island mass', 'island', { amplitudeM: 520, offsetM: -180, mixMode: 'replace', params: { radius: 0.8, coastSoftness: 0.16, roughness: 0.9, aspect: 1.15, scaleM: 1800 } }),
                b.shape('Coastal uplands', 'billow', { amplitudeM: 220, offsetM: 80, mask: { type: 'coastal', params: { falloffM: 900, jitterM: 220, side: 'land' } }, params: { scaleM: 1700 } }),
                b.shape('Headland ridges', 'ridge', { amplitudeM: 130, mask: { type: 'coastal', params: { falloffM: 600, jitterM: 140, side: 'land' } }, params: { scaleM: 1500 } }),
                b.erode('Wave-cut cliffs', 'coastal', { params: { waveEnergy: 0.9, fetchM: 160, reachM: 500, bandM: 12, platformM: 2.5, platformRate: 0.18, retreat: 0.5, iterations: 12, litho: 0.7 } }),
                b.erode('Creek incision', 'fluvial', { params: { upliftM: 60, streamK: 0.25, iterations: 30, litho: 0.4 } }),
                b.erode('Cliff talus', 'thermal', { params: { talusDeg: 35, iterations: 30, litho: 0.6 } })
            ],
            satmapLayers: [
                b.satmap('Coastal rock', 'rock', 'height', [-1000, 5000, 20]),
                b.satmap('Underwater shelf', 'water', 'height', [-2000, 0, 1]),
                b.satmap('Beach sand', 'beach', 'height', [-2, 3.5, 1], { mask: { type: 'slope', params: { lowDeg: 0, highDeg: 10 } } }),
                b.satmap('Cliff scree', 'scree', 'slope', [30, 70, 5], { opacity: 0.9 }),
                b.satmap('Coastal grass', 'grass', 'height', [3, 220, 40], { opacity: 0.85, breakup: { amount: 0.6, scaleM: 260, threshold: 0.5 } }),
                b.satmap('Salt marsh', 'wetland', 'wetness', [0.85, 1, 0.05], { opacity: 0.7 })
            ]
        })),
    definePreset('himalayan', 'Himalayan mountain', 'MountainSnow', 'High massif with glacial valleys, gorges, snowfields and forest belts stepping down the flanks.',
        { sizeM: 8000, seaLevelM: -500, snowlineM: 4200, stylize: 0.35, seed: 5519, riverKm2: 0.24 },
        (b) => ({
            heightLayers: [
                b.shape('Range spine', 'mountain', { amplitudeM: 2100, offsetM: 700, mixMode: 'replace', params: { scaleM: 9000, octaves: 5, warp: 0.7, sharpness: 1.4, foothills: 0.3 } }),
                b.shape('High plateau', 'multifractal', { amplitudeM: 600, offsetM: 0, mask: { type: 'massif', params: { lowM: 1800, highM: 6000, shoulderM: 500, breakup: 0.3 } }, params: { scaleM: 5200, roughness: 0.95 } }),
                b.erode('Glacial valleys', 'glacial', { params: { snowlineM: 4200, iceFlux: 0.5, valleyWidthM: 320, cirque: 0.6, iterations: 18, litho: 0.3 } }),
                b.erode('Gorge incision', 'fluvial', { params: { upliftM: 900, streamK: 0.7, iterations: 90, rainfall: 1.3, litho: 0.35 } }),
                b.erode('Talus slopes', 'thermal', { params: { talusDeg: 38, rate: 0.3, iterations: 50, litho: 0.3 } })
            ],
            satmapLayers: [
                b.satmap('Bare rock', 'rock', 'height', [-1000, 9000, 20]),
                b.satmap('Meadow', 'grass', 'height', [800, 1400, 100], { opacity: 0.9 }),
                b.satmap('Conifer forest', 'forest', 'height', [1200, 2600, 120], { mask: { type: 'slope', params: { lowDeg: 15, highDeg: 35 }, invert: true } }),
                b.satmap('Alpine scrub', 'scrub', 'height', [2400, 3600, 150], { opacity: 0.8 }),
                b.satmap('Scree', 'scree', 'slope', [28, 70, 6]),
                b.satmap('Snowfield', 'snow', 'height', [4200, 9000, 120], { mask: { type: 'slope', params: { lowDeg: 28, highDeg: 42 }, invert: true } }),
                b.satmap('Glacier ice', 'ice', 'height', [3800, 6000, 120], { mask: { type: 'slope', params: { lowDeg: 2, highDeg: 14 }, invert: true } })
            ]
        })),
    definePreset('icelandic', 'Icelandic', 'Flame', 'Volcanic shield with fissure swarms, glacier-cut fjords, moss-covered basalt and a black-sand coast.',
        { sizeM: 6000, seaLevelM: 0, snowlineM: 1100, stylize: 0.45, seed: 6623, riverKm2: 0.08 },
        (b) => ({
            heightLayers: [
                b.shape('Lava shield', 'billow', { amplitudeM: 700, offsetM: 120, mixMode: 'replace', params: { scaleM: 3800, octaves: 5 } }),
                b.shape('Fissure ridges', 'ridge', { amplitudeM: 260, mask: { type: 'rift', params: { scaleM: 4200, widthN: 0.06, warp: 0.6 } }, params: { scaleM: 2400 } }),
                b.shape('Coastal lowlands', 'perlin', { amplitudeM: -160, mask: { type: 'coastal', params: { falloffM: 1600, jitterM: 300, side: 'land' } }, params: { scaleM: 2600 } }),
                b.erode('Glacial fjords', 'glacial', { params: { snowlineM: 900, iceFlux: 0.5, valleyWidthM: 240, cirque: 0.5, iterations: 14, litho: 0.2 } }),
                b.erode('River incision', 'fluvial', { params: { upliftM: 0, streamK: 0.35, iterations: 40, rainfall: 1.2, litho: 0.3 } }),
                b.erode('Coastal cliffs', 'coastal', { params: { waveEnergy: 0.45, fetchM: 220, bandM: 10, platformM: 1.5, retreat: 0.3, iterations: 6, litho: 0.3 } })
            ],
            satmapLayers: [
                b.satmap('Basalt', 'basalt', 'height', [-1000, 5000, 20]),
                b.satmap('Black beach', 'basalt', 'coast', [0, 80, 20], { opacity: 0.9 }),
                b.satmap('Moss fields', 'moss', 'height', [60, 800, 60], { opacity: 0.85, breakup: { amount: 0.5, scaleM: 320, threshold: 0.45 } }),
                b.satmap('Lichen patches', 'lichen', 'height', [300, 900, 80], { opacity: 0.6, breakup: { amount: 0.7, scaleM: 180, threshold: 0.6 } }),
                b.satmap('Wetland', 'wetland', 'wetness', [0.85, 1, 0.05], { opacity: 0.7 }),
                b.satmap('Rivers', 'water', 'river', [0.6, 1, 0.1]),
                b.satmap('Scree', 'scree', 'slope', [28, 70, 6]),
                b.satmap('Snowcap', 'snow', 'height', [1100, 6000, 80], { mask: { type: 'slope', params: { lowDeg: 25, highDeg: 40 }, invert: true } })
            ]
        })),
    definePreset('alps', 'Alps', 'Mountain', 'Alpine massifs with cirques and U-shaped glacial troughs, conifer forest, alpine meadows and snowy summits.',
        { sizeM: 6000, seaLevelM: -800, snowlineM: 2350, stylize: 0.35, seed: 7727, riverKm2: 0.12 },
        (b) => ({
            heightLayers: [
                b.shape('Alpine massif', 'mountain', { amplitudeM: 1100, offsetM: 600, mixMode: 'replace', params: { scaleM: 6500, octaves: 4, warp: 0.6, sharpness: 1.3, foothills: 0.4 } }),
                b.shape('Valley floors', 'perlin', { amplitudeM: 160, params: { scaleM: 1500, octaves: 4 } }),
                b.erode('Alpine glaciers', 'glacial', { params: { snowlineM: 2350, iceFlux: 0.55, valleyWidthM: 320, cirque: 0.7, iterations: 20, litho: 0.2 } }),
                b.erode('Torrent incision', 'fluvial', { params: { upliftM: 500, streamK: 0.4, iterations: 70, rainfall: 1.1, litho: 0.2 } }),
                b.erode('Talus cones', 'thermal', { params: { talusDeg: 36, rate: 0.3, iterations: 50, litho: 0.2 } })
            ],
            satmapLayers: [
                b.satmap('Limestone rock', 'rock', 'height', [-1000, 9000, 20]),
                b.satmap('Alpine meadow', 'grass', 'height', [1400, 2350, 120], { mask: { type: 'slope', params: { lowDeg: 0, highDeg: 30 }, invert: true } }),
                b.satmap('Conifer forest', 'forest', 'height', [900, 1900, 120], { mask: { type: 'slope', params: { lowDeg: 12, highDeg: 36 }, invert: true } }),
                b.satmap('Scree', 'scree', 'slope', [35, 70, 5]),
                b.satmap('Glacier ice', 'ice', 'height', [2350, 4000, 100], { mask: { type: 'slope', params: { lowDeg: 0, highDeg: 12 }, invert: true } }),
                b.satmap('Snowfields', 'snow', 'height', [2350, 9000, 80], { mask: { type: 'slope', params: { lowDeg: 32, highDeg: 45 }, invert: true } }),
                b.satmap('Lake & river', 'water', 'river', [0.7, 1, 0.1])
            ]
        })),
    definePreset('snowy-mountains', 'Snowy mountains', 'Snowflake', 'Broad snowbound ranges with glacial carving, cirques, dark rock ridges and snow lying on everything gentle.',
        { sizeM: 6000, seaLevelM: -600, snowlineM: 1800, stylize: 0.3, seed: 8831, riverKm2: 0.14 },
        (b) => ({
            heightLayers: [
                b.shape('Snowfield plateau', 'multifractal', { amplitudeM: 1100, offsetM: 400, mixMode: 'replace', params: { scaleM: 4600, roughness: 0.9, offset: 0.6 } }),
                b.shape('Ridge spines', 'ridge', { amplitudeM: 900, mask: { type: 'massif', params: { lowM: 900, highM: 4000, shoulderM: 500, breakup: 0.4 } }, params: { scaleM: 3600 } }),
                b.erode('Glacial carving', 'glacial', { params: { snowlineM: 1800, iceFlux: 0.7, valleyWidthM: 260, cirque: 0.8, iterations: 22, litho: 0.25 } }),
                b.erode('Thermal shedding', 'thermal', { params: { talusDeg: 32, rate: 0.3, iterations: 50, litho: 0.25 } }),
                b.erode('Meltwater', 'fluvial', { params: { upliftM: 250, streamK: 0.35, iterations: 40, litho: 0.25 } })
            ],
            satmapLayers: [
                b.satmap('Dark rock', 'rock', 'height', [-1000, 9000, 20]),
                b.satmap('Snow', 'snow', 'height', [1800, 9000, 100], { mask: { type: 'slope', params: { lowDeg: 30, highDeg: 42 }, invert: true } }),
                b.satmap('Glacier ice', 'ice', 'height', [2400, 6000, 100], { mask: { type: 'slope', params: { lowDeg: 0, highDeg: 15 }, invert: true } }),
                b.satmap('Forest', 'forest', 'height', [400, 1100, 100], { mask: { type: 'slope', params: { lowDeg: 14, highDeg: 32 }, invert: true } }),
                b.satmap('Meadow', 'grass', 'height', [900, 1500, 100], { opacity: 0.8 }),
                b.satmap('Scree', 'scree', 'slope', [30, 70, 5]),
                b.satmap('Meltwater', 'water', 'river', [0.7, 1, 0.1])
            ]
        })),
    definePreset('rugged-outcrops', 'Rugged outcrops', 'Pickaxe', 'Compact rocky hills of tors and boulder outcrops, crags, frost talus and gullies cutting between them.',
        { sizeM: 3000, seaLevelM: -200, snowlineM: 3000, stylize: 0.4, seed: 9941, riverKm2: 0.024 },
        (b) => ({
            heightLayers: [
                b.shape('Rugged base', 'perlin', { amplitudeM: 300, offsetM: 180, mixMode: 'replace', params: { scaleM: 1400, octaves: 7, warp: 0.7 } }),
                b.shape('Outcrop bosses', 'billow', { amplitudeM: 380, mask: { type: 'breakup', params: { scaleM: 900, threshold: 0.58, softness: 0.1 } }, params: { scaleM: 800, octaves: 6 } }),
                b.shape('Crag ridges', 'ridge', { amplitudeM: 160, params: { scaleM: 900 } }),
                b.erode('Frost talus', 'thermal', { params: { talusDeg: 42, rate: 0.35, iterations: 80, litho: 0.9 } }),
                b.erode('Gullies', 'hydraulic', { opacity: 0.9, params: { density: 1.8, lifetime: 70, radius: 2, erodeRate: 0.4, litho: 0.6 } }),
                b.erode('Creek cutting', 'fluvial', { params: { upliftM: 40, streamK: 0.3, iterations: 30, litho: 0.6 } })
            ],
            satmapLayers: [
                b.satmap('Granite rock', 'rock', 'height', [-1000, 5000, 20]),
                b.satmap('Lichen', 'lichen', 'height', [0, 800, 40], { opacity: 0.7, breakup: { amount: 0.7, scaleM: 160, threshold: 0.55 } }),
                b.satmap('Scree', 'scree', 'slope', [25, 60, 4]),
                b.satmap('Scrub', 'scrub', 'slope', [0, 15, 4], { opacity: 0.7, breakup: { amount: 0.5, scaleM: 220, threshold: 0.5 } }),
                b.satmap('Soil in hollows', 'soil', 'wetness', [0.6, 1, 0.1], { opacity: 0.8 }),
                b.satmap('Creek water', 'water', 'river', [0.6, 1, 0.1])
            ]
        })),
    definePreset('desert-dunes', 'Desert dunes', 'Wind', 'A sand sea of transverse dunes shaped by the prevailing wind, with interdune pavements and crests catching the light.',
        { sizeM: 6000, seaLevelM: -300, snowlineM: 4000, stylize: 0.45, seed: 1043, riverKm2: 0.2 },
        (b) => ({
            heightLayers: [
                b.shape('Sand sheet', 'perlin', { amplitudeM: 80, offsetM: 60, mixMode: 'replace', params: { scaleM: 3200, octaves: 4 } }),
                b.shape('Dune field', 'dunes', { amplitudeM: 90, offsetM: 40, params: { spacingM: 480, windFromDeg: 240, asymmetry: 0.78, sinuosity: 0.45, variation: 0.6, scaleM: 2600 } }),
                b.erode('Wind sculpting', 'aeolian', { params: { windFromDeg: 240, windSpeed: 0.9, saltation: 0.12, deflation: 0.25, supply: 0.04, topoBoost: 2.5, sweeps: 3, maxDeflation: 0.8, litho: 0.1 } })
            ],
            satmapLayers: [
                b.satmap('Sand sea', 'sand', 'height', [-5000, 9000, 20]),
                b.satmap('Gravel pavement', 'gravel', 'slope', [0, 4, 2], { opacity: 0.85 }),
                b.satmap('Dune crests', 'beach', 'protrusion', [12, 200, 10], { opacity: 0.8 }),
                b.satmap('Slip faces', 'varnish', 'slope', [16, 40, 4], { opacity: 0.35 }),
                b.satmap('Interdune scrub', 'scrub', 'wetness', [0.85, 1, 0.05], { opacity: 0.8 })
            ]
        })),
    definePreset('rocky-desert', 'Rocky desert landscape', 'Sun', 'Badlands and desert plateaus: caprock tables, varnished scarps, gullies and washes spreading out across gravel plains.',
        { sizeM: 5000, seaLevelM: -400, snowlineM: 4000, stylize: 0.45, seed: 1151, riverKm2: 0.072 },
        (b) => ({
            heightLayers: [
                b.shape('Desert plateau', 'plateau', { amplitudeM: 520, offsetM: 260, mixMode: 'replace', params: { scaleM: 3000, steps: 3, riser: 0.12, spread: 0.8 } }),
                b.shape('Badlands texture', 'ridge', { amplitudeM: 160, mask: { type: 'breakup', params: { scaleM: 1400, threshold: 0.45, softness: 0.2 } }, params: { scaleM: 1200, octaves: 5, offset: 0.9 } }),
                b.erode('Badland gullies', 'hydraulic', { params: { density: 1.6, lifetime: 70, radius: 2, erodeRate: 0.4, depositRate: 0.25, litho: 0.55 } }),
                b.erode('Wash incision', 'fluvial', { params: { upliftM: 120, streamK: 0.3, iterations: 50, litho: 0.55 } }),
                b.erode('Scree slopes', 'thermal', { params: { talusDeg: 36, rate: 0.3, iterations: 40, litho: 0.7 } }),
                b.erode('Wind polish', 'aeolian', { opacity: 0.5, params: { windFromDeg: 220, windSpeed: 0.6, saltation: 0.04, deflation: 0.2, supply: 0.01, sweeps: 2, litho: 0.3 } })
            ],
            satmapLayers: [
                b.satmap('Bedrock', 'rock', 'height', [-1000, 5000, 20]),
                b.satmap('Caprock tables', 'sandstone', 'bedding', [0.5, 1, 0.1], { breakup: { amount: 0.3, scaleM: 380 } }),
                b.satmap('Desert varnish', 'varnish', 'slope', [14, 60, 4], { opacity: 0.8 }),
                b.satmap('Gravel plains', 'gravel', 'slope', [0, 5, 2], { opacity: 0.85 }),
                b.satmap('Wash sand', 'sand', 'sediment', [1, 80, 1.5], { opacity: 0.85 }),
                b.satmap('Wash water', 'water', 'river', [0.7, 1, 0.1]),
                b.satmap('Desert scrub', 'scrub', 'wetness', [0.8, 1, 0.08], { opacity: 0.7 })
            ]
        }))
];

//------------------------------------------------------------------------------------------------------------------------
//                                                         LOOKUP
//------------------------------------------------------------------------------------------------------------------------
export function presetById(id)
{
    return PRESETS.find((preset) => preset.id === id) || PRESETS[0];
}
