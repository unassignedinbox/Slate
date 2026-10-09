//============================================================================================================================================
//                                                              LAYERSEQUENCE.JS
//============================================================================================================================================
// 📦 Tools/LandscapeEditor/src/engine/LayerSequence.js — Ordered height-stack evaluation: generator and erosion layers applied bottom
//    to top with masks, mix modes and opacity, reusing unchanged prefixes from the layer index.

import { createField, mixNumber, clampNumber } from './HeightSpace.js';
import { createLattice } from './LatticeSpace.js';
import { produceShape } from './GeneratorSpecification.js';
import { computeMask } from './MaskSpecification.js';
import { runErosion } from './ErosionSpecification.js';
import { hashText } from './LayerIndex.js';

//------------------------------------------------------------------------------------------------------------------------
//                                                       MIX MODES
//------------------------------------------------------------------------------------------------------------------------
export const MIX_MODES = [
    { id: 'replace', label: 'Replace' },
    { id: 'add', label: 'Add' },
    { id: 'subtract', label: 'Subtract' },
    { id: 'raise', label: 'Keep higher' },
    { id: 'lower', label: 'Keep lower' }
];

export function mixWithMode(previous, candidate, weight, mode)
{
    switch (mode)
    {
        case 'add':
            return previous + candidate * weight;
        case 'subtract':
            return previous - candidate * weight;
        case 'raise':
            return mixNumber(previous, Math.max(previous, candidate), weight);
        case 'lower':
            return mixNumber(previous, Math.min(previous, candidate), weight);
        default:
            return mixNumber(previous, candidate, weight);
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                  IDENTITY AND CONTEXT
//------------------------------------------------------------------------------------------------------------------------
// Cosmetic fields are excluded so renaming a layer does not invalidate reuse.
export function layerIdentity(layer)
{
    const { name, id, ...identity } = layer;
    return identity;
}

export function settingsIdentity(settings)
{
    return JSON.stringify({
        n: settings.resolution,
        sizeM: settings.sizeM,
        sea: settings.seaLevelM,
        seed: settings.seed,
        bedding: settings.bedding,
        snowlineM: settings.snowlineM
    });
}

function layerContext(settings, layer)
{
    const n = settings.resolution;
    const seed = layer.seed | 0;
    return {
        n,
        dx: settings.sizeM / (n - 1),
        sizeM: settings.sizeM,
        sea: settings.seaLevelM,
        seed,
        lattice: createLattice(seed),
        maskLattice: createLattice(seed * 31 + 7),
        bedding: settings.bedding,
        snowlineM: settings.snowlineM
    };
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    STACK EVALUATION
//------------------------------------------------------------------------------------------------------------------------
// layers are stored in evaluation order (index 0 applied first). Returns { elevation, preErosion, uplift, log }: preErosion is the surface before the first erosion layer, uplift the cumulative tectonic rise [m] added by erosion layers.
export function buildElevation(settings, layers, index)
{
    const n = settings.resolution;
    const count = n * n;
    let elevation = createField(count);
    let preErosion = null;
    let uplift = createField(count);
    let exportedM3 = 0;
    const log = [];
    let prefix = hashText(settingsIdentity(settings));
    for (let position = 0; position < layers.length; position++)
    {
        const layer = layers[position];
        prefix = hashText(prefix + JSON.stringify(layerIdentity(layer)));
        const summary = { id: layer.id, name: layer.name, category: layer.category, type: layer.type };
        if (layer.enabled === false)
        {
            log.push({ ...summary, skipped: true, reused: false, ms: 0 });
            continue;
        }
        const reused = index ? index.get(prefix) : null;
        if (reused)
        {
            elevation = reused.elevation;
            preErosion = reused.preErosion;
            uplift = reused.uplift;
            exportedM3 = reused.exportedM3;
            log.push({ ...summary, skipped: false, reused: true, ms: 0 });
            continue;
        }
        const started = performance.now();
        const context = layerContext(settings, layer);
        const opacity = clampNumber(layer.opacity ?? 1, 0, 1);
        const mask = computeMask(context, layer.mask, elevation);
        if (layer.category === 'erosion')
        {
            if (preErosion === null)
            {
                preErosion = elevation;
            }
            const result = runErosion(context, layer, elevation);
            const next = new Float32Array(count);
            const nextUplift = new Float32Array(count);
            let exportedHeight = 0;
            for (let k = 0; k < count; k++)
            {
                const weight = opacity * (mask ? mask[k] : 1);
                next[k] = mixNumber(elevation[k], result.elevation[k], weight);
                nextUplift[k] = uplift[k] + (result.uplift ? weight * result.uplift[k] : 0);
                exportedHeight += result.exportedField ? weight * result.exportedField[k] : 0;
            }
            // Export is weighted like the blend it came from, so masked or partial layers report what they really remove.
            const layerExportedM3 = exportedHeight * context.dx * context.dx;
            exportedM3 += layerExportedM3;
            summary.exportedM3 = layerExportedM3;
            elevation = next;
            uplift = nextUplift;
        }
        else
        {
            const shape = produceShape(context, layer);
            const next = new Float32Array(count);
            const offset = layer.offsetM ?? 0;
            const amplitude = layer.amplitudeM ?? 0;
            for (let k = 0; k < count; k++)
            {
                const candidate = offset + amplitude * shape[k];
                const weight = opacity * (mask ? mask[k] : 1);
                next[k] = mixWithMode(elevation[k], candidate, weight, layer.mixMode);
            }
            // Shape layers stacked above the first erosion layer are rise or fall of the land, not surface processes,
            // so their change is carried in uplift. Erosion and sediment then describe erosion layers only.
            let nextUplift = uplift;
            if (preErosion !== null)
            {
                nextUplift = new Float32Array(count);
                for (let k = 0; k < count; k++)
                {
                    nextUplift[k] = uplift[k] + (next[k] - elevation[k]);
                }
            }
            elevation = next;
            uplift = nextUplift;
        }
        // preErosion stays null until the first erosion layer, so reused entries must keep that sentinel.
        const entry = { elevation, preErosion, uplift, exportedM3 };
        if (index)
        {
            index.set(prefix, entry);
        }
        log.push({ ...summary, skipped: false, reused: false, ms: performance.now() - started });
    }
    return { elevation, preErosion: preErosion || elevation, uplift, exportedM3, log };
}
