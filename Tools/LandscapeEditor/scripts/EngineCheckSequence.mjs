//============================================================================================================================================
//                                                          ENGINECHECKSEQUENCE.MJS                                                           
//============================================================================================================================================
// 📦 Tools/LandscapeEditor/scripts/EngineCheckSequence.mjs — Engine self-check: validates every preset against the catalogues, checks
//    for non-finite output, proves determinism, confirms the layer index reuses unchanged prefixes, checks mass balance and view
//    orientation, and renders every view mode.

import { PRESETS } from '../src/engine/PresetConfiguration.js';
import { generatorTypeById } from '../src/engine/GeneratorSpecification.js';
import { erosionTypeById } from '../src/engine/ErosionSpecification.js';
import { maskTypeById } from '../src/engine/MaskSpecification.js';
import { materialById, driverById, SATMAP_MIX_MODES } from '../src/engine/SatmapSpecification.js';
import { MIX_MODES } from '../src/engine/LayerSequence.js';
import { VIEW_MODES, renderView } from '../src/engine/SatmapProjection.js';
import { buildTerrain } from '../src/engine/TerrainSequence.js';
import { createLayerIndex } from '../src/engine/LayerIndex.js';
import { presetProject } from '../src/engine/LayerConfiguration.js';

//------------------------------------------------------------------------------------------------------------------------
//                                                        OPTIONS                                                         
//------------------------------------------------------------------------------------------------------------------------
const resolutionArgument = process.argv.find((argument) => argument.startsWith('--resolution='));
// Must be one of the catalogue resolutions (128 to 512); other sizes are normalised back to the default.
const CHECK_RESOLUTION = resolutionArgument ? Number(resolutionArgument.split('=')[1]) : 128;

//------------------------------------------------------------------------------------------------------------------------
//                                                        HELPERS                                                         
//------------------------------------------------------------------------------------------------------------------------
function fingerprintBytes(array)
{
    const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    let hash = 2166136261 >>> 0;
    for (let k = 0; k < bytes.length; k++)
    {
        hash ^= bytes[k];
        hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
}

function allFinite(array)
{
    for (let k = 0; k < array.length; k++)
    {
        if (!Number.isFinite(array[k]))
        {
            return false;
        }
    }
    return true;
}

function unknownKeys(params, schema)
{
    return Object.keys(params || {}).filter((key) => !schema.some((entry) => entry.key === key));
}

//------------------------------------------------------------------------------------------------------------------------
//                                                  CATALOGUE VALIDATION                                                  
//------------------------------------------------------------------------------------------------------------------------
function validatePreset(preset, failures)
{
    const problems = [];
    const project = presetProject(preset);
    for (const layer of project.heightLayers)
    {
        if (layer.category === 'erosion')
        {
            const type = erosionTypeById(layer.type);
            if (type.id !== layer.type)
            {
                problems.push(`${layer.name}: unknown erosion type ${layer.type}`);
            }
            problems.push(...unknownKeys(layer.params, type.params).map((key) => `${layer.name}: unknown erosion key ${key}`));
        }
        else
        {
            const type = generatorTypeById(layer.type);
            if (type.id !== layer.type)
            {
                problems.push(`${layer.name}: unknown generator ${layer.type}`);
            }
            problems.push(...unknownKeys(layer.params, type.params).map((key) => `${layer.name}: unknown generator key ${key}`));
        }
        if (!MIX_MODES.some((mode) => mode.id === layer.mixMode))
        {
            problems.push(`${layer.name}: unknown mix mode ${layer.mixMode}`);
        }
        problems.push(...validateMask(layer, 'height'));
    }
    for (const layer of project.satmapLayers)
    {
        if (materialById(layer.material).id !== layer.material)
        {
            problems.push(`${layer.name}: unknown material ${layer.material}`);
        }
        if (driverById(layer.driver).id !== layer.driver)
        {
            problems.push(`${layer.name}: unknown driver ${layer.driver}`);
        }
        if (!SATMAP_MIX_MODES.some((mode) => mode.id === layer.mixMode))
        {
            problems.push(`${layer.name}: unknown satmap mix mode ${layer.mixMode}`);
        }
        if (!Number.isFinite(layer.band.lo) || !Number.isFinite(layer.band.hi) || !Number.isFinite(layer.band.soft))
        {
            problems.push(`${layer.name}: band is not finite`);
        }
        if (layer.generator)
        {
            const type = generatorTypeById(layer.generator.type);
            if (type.id !== layer.generator.type)
            {
                problems.push(`${layer.name}: unknown satmap generator ${layer.generator.type}`);
            }
        }
        problems.push(...validateMask(layer, 'satmap'));
    }
    if (problems.length)
    {
        failures.push(...problems.map((problem) => `${preset.id}: ${problem}`));
    }
    return problems.length;
}

function validateMask(layer, stackName)
{
    const mask = layer.mask;
    if (!mask)
    {
        return [`${stackName} layer ${layer.name}: missing mask`];
    }
    const type = maskTypeById(mask.type);
    const problems = [];
    if (type.id !== mask.type)
    {
        problems.push(`${layer.name}: unknown mask ${mask.type}`);
    }
    problems.push(...unknownKeys(mask.params, type.params).map((key) => `${layer.name}: unknown mask key ${key}`));
    return problems;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   EVALUATION CHECKS                                                    
//------------------------------------------------------------------------------------------------------------------------
function checkPreset(preset, failures)
{
    const project = presetProject(preset);
    project.settings.resolution = CHECK_RESOLUTION;
    const index = createLayerIndex(24);

    const first = buildTerrain(project, index);
    const expectedCount = CHECK_RESOLUTION * CHECK_RESOLUTION;
    if (first.elevation.length !== expectedCount || first.satmapRgba.length !== expectedCount * 4)
    {
        failures.push(`${preset.id}: output sizes do not match ${CHECK_RESOLUTION}²`);
    }
    if (!allFinite(first.elevation))
    {
        failures.push(`${preset.id}: elevation contains NaN or infinity`);
    }
    if (!Object.values(first.metrics).every((value) => Number.isFinite(value)))
    {
        failures.push(`${preset.id}: metrics contain NaN or infinity`);
    }

    const second = buildTerrain(project, createLayerIndex(24));
    const firstHash = fingerprintBytes(first.elevation) + fingerprintBytes(first.satmapRgba);
    const secondHash = fingerprintBytes(second.elevation) + fingerprintBytes(second.satmapRgba);
    if (firstHash !== secondHash)
    {
        failures.push(`${preset.id}: output is not deterministic`);
    }

    const reused = buildTerrain(project, index);
    const enabledCount = project.heightLayers.filter((layer) => layer.enabled !== false).length;
    const reusedCount = reused.log.filter((entry) => entry.reused).length;
    if (enabledCount > 0 && reusedCount === 0)
    {
        failures.push(`${preset.id}: layer index reused nothing on an unchanged project`);
    }

    // Mass balance: eroded minus deposited must equal the load exported through map edges and the sea.
    const balanceError = Math.abs(first.metrics.erodedM3 - first.metrics.depositedM3 - first.metrics.exportedM3);
    if (balanceError > 0.03 * Math.max(first.metrics.erodedM3, 1))
    {
        failures.push(`${preset.id}: eroded - deposited differs from exported load by ${balanceError.toFixed(0)} m³`);
    }

    for (const view of VIEW_MODES)
    {
        const pixels = renderView(view.id, first);
        if (pixels.length !== expectedCount * 4)
        {
            failures.push(`${preset.id}: view ${view.id} has the wrong size`);
        }
    }

    return {
        id: preset.id,
        name: preset.name,
        reliefM: Math.round(first.metrics.reliefM),
        p95SlopeDeg: Number(first.metrics.p95SlopeDeg.toFixed(1)),
        channelKm: Number((first.metrics.channelLengthM / 1000).toFixed(2)),
        totalMs: Math.round(first.timings.totalMs),
        reusedLayers: reusedCount,
        balancePct: Number((100 * Math.abs(first.metrics.erodedM3 - first.metrics.depositedM3 - first.metrics.exportedM3) / Math.max(first.metrics.erodedM3, 1)).toFixed(2)),
        fingerprint: firstHash
    };
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      ORIENTATION                                                       
//------------------------------------------------------------------------------------------------------------------------
// Grid row 0 is the south edge. The 2D views must place it at the bottom, so the top row shows the north edge.
function checkOrientation(failures)
{
    const size = 2;
    const grid = new Uint8ClampedArray([
        255, 0, 0, 255,   255, 0, 0, 255,
        0, 0, 255, 255,   0, 0, 255, 255
    ]);
    const synthetic = { n: size, dx: 1, settings: { seaLevelM: 0 }, attrs: {}, elevation: new Float32Array(size * size), satmapRgba: grid };
    const pixels = renderView('satmap', synthetic);
    const topIsNorth = pixels[0] === 0 && pixels[2] === 255;
    if (!topIsNorth)
    {
        failures.push('orientation: the satmap view does not place north (grid row n-1) at the top');
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                          RUN                                                           
//------------------------------------------------------------------------------------------------------------------------
const failures = [];
let catalogueProblems = 0;
for (const preset of PRESETS)
{
    catalogueProblems += validatePreset(preset, failures);
}
checkOrientation(failures);
const rows = PRESETS.map((preset) => checkPreset(preset, failures));
console.log(`Engine check at ${CHECK_RESOLUTION} × ${CHECK_RESOLUTION}: ${PRESETS.length} presets, ${VIEW_MODES.length} views each`);
console.table(rows);
if (failures.length)
{
    console.error(`FAILED with ${failures.length} problem(s):`);
    for (const failure of failures)
    {
        console.error(`  - ${failure}`);
    }
    process.exitCode = 1;
}
else
{
    console.log(`PASSED: catalogue keys valid (${catalogueProblems} problems), outputs finite, deterministic, layer index reuse confirmed.`);
}
