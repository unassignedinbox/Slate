//============================================================================================================================================
//                                                           LAYERCONFIGURATION.JS
//============================================================================================================================================
// 📦 Tools/LandscapeEditor/src/engine/LayerConfiguration.js — Runtime layer factories and project assembly: new generator, erosion,
//    paint and mask layers with catalogue defaults, layer merging, and preset-to-project conversion.

import { generatorTypeById, generatorDefaults } from './GeneratorSpecification.js';
import { erosionTypeById, erosionDefaults } from './ErosionSpecification.js';
import { maskDefaults } from './MaskSpecification.js';
import { driverById, materialById } from './SatmapSpecification.js';
import { normalizeSettings } from './TerrainConfiguration.js';

//------------------------------------------------------------------------------------------------------------------------
//                                                 IDENTIFIERS AND SEEDS
//------------------------------------------------------------------------------------------------------------------------
let issuedCount = 0;

export function issueLayerIdentifier(prefix)
{
    issuedCount += 1;
    return `${prefix}-${Date.now().toString(36)}-${issuedCount.toString(36)}`;
}

export function randomSeed()
{
    return Math.floor(Math.random() * 99991);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     MASK SETTINGS
//------------------------------------------------------------------------------------------------------------------------
export function buildMaskSetting(typeId = 'none')
{
    return { type: typeId, params: maskDefaults(typeId), invert: false, featherM: 0 };
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    LAYER FACTORIES
//------------------------------------------------------------------------------------------------------------------------
export function newHeightLayer(category, typeId)
{
    if (category === 'erosion')
    {
        const type = erosionTypeById(typeId);
        return {
            id: issueLayerIdentifier('e'),
            name: type.label,
            category: 'erosion',
            type: type.id,
            enabled: true,
            opacity: 1,
            mixMode: 'replace',
            seed: randomSeed(),
            params: erosionDefaults(type.id),
            mask: buildMaskSetting('none')
        };
    }
    const type = generatorTypeById(typeId);
    return {
        id: issueLayerIdentifier('g'),
        name: type.label,
        category: 'generator',
        type: type.id,
        enabled: true,
        opacity: 1,
        mixMode: 'add',
        offsetM: 0,
        amplitudeM: 300,
        seed: randomSeed(),
        params: generatorDefaults(type.id),
        mask: buildMaskSetting('none')
    };
}

export function newSatmapLayer(materialId = 'rock', driverId = 'height')
{
    const material = materialById(materialId);
    const driver = driverById(driverId);
    return {
        id: issueLayerIdentifier('s'),
        name: material.label,
        category: 'satmap',
        material: material.id,
        driver: driver.id,
        band: { lo: driver.lo, hi: driver.hi, soft: driver.soft },
        breakup: { amount: 0, scaleM: 400, threshold: 0.5 },
        generator: null,
        mask: buildMaskSetting('none'),
        opacity: 1,
        mixMode: 'over',
        enabled: true,
        seed: randomSeed()
    };
}

export function newSatmapGenerator(typeId)
{
    const type = generatorTypeById(typeId);
    return { type: type.id, params: generatorDefaults(type.id), enabled: true };
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     LAYER MERGING
//------------------------------------------------------------------------------------------------------------------------
function isPlainRecord(candidate)
{
    return candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate);
}

// Shallow merge with one-level deep merge for records. A type change replaces params wholesale so stale keys cannot leak across catalogues.
export function mergeLayer(layer, patch)
{
    const out = { ...layer };
    const typeChanged = Object.prototype.hasOwnProperty.call(patch, 'type') && patch.type !== layer.type;
    for (const key of Object.keys(patch))
    {
        const incoming = patch[key];
        const current = layer[key];
        if (key === 'params' && typeChanged)
        {
            out.params = incoming;
        }
        else if (isPlainRecord(incoming) && isPlainRecord(current))
        {
            out[key] = { ...current, ...incoming };
        }
        else
        {
            out[key] = incoming;
        }
    }
    return out;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                        PROJECTS
//------------------------------------------------------------------------------------------------------------------------
export function cloneProject(project)
{
    return JSON.parse(JSON.stringify(project));
}

export function presetProject(preset)
{
    const settings = normalizeSettings({ ...preset.settings, name: preset.name });
    return cloneProject({ settings, heightLayers: preset.heightLayers, satmapLayers: preset.satmapLayers });
}
