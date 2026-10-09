// LayerSequence: evaluates the layer stack from bottom to top. Each layer reads the terrain produced so far, applies its
// masks, and combines its contribution in. Snapshots are cached per entry, keyed on the layer's own settings and everything
// beneath it, so editing a top layer only recomputes that layer.

import { CreateMaskContext, MaskWeight } from "./MaskSpecification.js";
import { SampleGenerator } from "./GeneratorSpecification.js";
import { RunErosion } from "./ErosionSpecification.js";
import { ModifierVariants } from "./ModifierSpecification.js";
import { AccumulateArea, ComputeDrainage } from "./DrainageStructure.js";
import { Summary } from "./ElevationSpace.js";

export function CreateStackCache() {
    return { cacheEntries: [] };
}

// Settings that influence the result. Identifiers and names are excluded so renaming never triggers a recompute.
function LayerKey(layer) {
    return JSON.stringify({
        f: layer.family,
        k: layer.kind,
        e: layer.enabled,
        o: layer.opacity,
        b: layer.combine,
        s: layer.seed,
        p: layer.params,
        m: layer.masks.map((m) => ({ k: m.kind, e: m.enabled, i: m.invert, t: m.strength, p: m.params })),
    });
}

function Combine(operation, height, contribution, weight, opacity) {
    for (let i = 0; i < height.length; i++) {
        const a = weight[i] * opacity;
        if (a <= 0) continue;
        const h = height[i];
        const g = contribution[i];
        let target;
        switch (operation) {
            case "add":
                target = h + g;
                break;
            case "subtract":
                target = h - g;
                break;
            case "max":
                target = Math.max(h, g);
                break;
            case "min":
                target = Math.min(h, g);
                break;
            default:
                target = g;
        }
        height[i] = h + (target - h) * a;
    }
}

function Lerp(height, target, weight, opacity) {
    for (let i = 0; i < height.length; i++) {
        const a = weight[i] * opacity;
        if (a > 0) height[i] += (target[i] - height[i]) * a;
    }
}

// Evaluates the stack. Returns the height field plus diagnostics for the satmap: sedimentation, erosion, drainage area and a
// preview of one layer's mask or shape when requested.
export function ResolveStack(configuration, layers, options = {}, cache = CreateStackCache()) {
    const started = performance.now();
    const n = configuration.resolution;
    const extent = configuration.extent;
    const sea = configuration.sea;
    const cell = extent / n;
    const size = n * n;
    const cellArea = cell * cell;
    const previewIndex = options.previewLayerId ? layers.findIndex((layer) => layer.id === options.previewLayerId) : -1;

    let height = new Float32Array(size);
    let sediment = new Float32Array(size);
    let erosion = new Float32Array(size);
    let prefix = JSON.stringify({ n, extent, sea });
    const cacheEntries = [];
    let reused = 0;
    let preview = null;
    let previewLabel = "";

    for (let i = 0; i < layers.length; i++) {
        const layer = layers[i];
        prefix = `${prefix}|${LayerKey(layer)}`;
        const cached = cache.cacheEntries[i];
        if (cached && cached.key === prefix) {
            height = Float32Array.from(cached.height);
            sediment = Float32Array.from(cached.sediment);
            erosion = Float32Array.from(cached.erosion);
            cacheEntries.push(cached);
            reused++;
            if (i === previewIndex) {
                preview = cached.preview;
                previewLabel = layer.name;
            }
            continue;
        }

        let layerPreview = null;
        if (layer.enabled) {
            const seed = layer.seed;
            const mask = new Float32Array(size).fill(1);
            const maskCount = layer.masks.filter((m) => m.enabled).length;
            if (maskCount > 0) {
                const context = CreateMaskContext({ n, extent, sea, seed, height });
                for (const maskSpec of layer.masks) {
                    if (!maskSpec.enabled) continue;
                    const weights = MaskWeight(maskSpec, context);
                    for (let k = 0; k < size; k++) mask[k] *= weights[k];
                }
            }

            if (layer.family === "shape" || layer.family === "relief") {
                const { meters, shape } = SampleGenerator(layer.kind, layer.params, seed, n);
                Combine(layer.combine, height, meters, mask, layer.opacity);
                layerPreview = maskCount > 0 ? mask : shape;
            } else if (layer.family === "erosion") {
                const working = Float32Array.from(height);
                const diagnostics = RunErosion(layer.kind, layer.params, working, n, extent, seed, sea);
                const effect = new Float32Array(size);
                for (let k = 0; k < size; k++) {
                    effect[k] = working[k] - height[k];
                }
                Lerp(height, working, mask, layer.opacity);
                for (let k = 0; k < size; k++) {
                    const a = mask[k] * layer.opacity;
                    if (a <= 0) continue;
                    erosion[k] += diagnostics.erosion[k] * a;
                    sediment[k] += diagnostics.deposition[k] * a;
                }
                if (maskCount > 0) {
                    layerPreview = mask;
                } else {
                    let scale = 1e-6;
                    for (let k = 0; k < size; k++) scale = Math.max(scale, Math.abs(effect[k]));
                    layerPreview = new Float32Array(size);
                    for (let k = 0; k < size; k++) layerPreview[k] = 0.5 + 0.5 * effect[k] / scale;
                }
            } else if (layer.family === "modifier") {
                const spec = ModifierVariants[layer.kind] || ModifierVariants.terrace;
                const target = spec.Apply(layer.params, height, n, sea);
                Lerp(height, target, mask, layer.opacity);
                layerPreview = maskCount > 0 ? mask : null;
            }
        }

        if (i === previewIndex) {
            preview = layerPreview;
            previewLabel = layer.name;
        }
        const snapshot = {
            key: prefix,
            height: Float32Array.from(height),
            sediment: Float32Array.from(sediment),
            erosion: Float32Array.from(erosion),
            preview: layerPreview,
        };
        cacheEntries.push(snapshot);
    }

    cache.cacheEntries = cacheEntries;

    const drainage = ComputeDrainage(height, n, sea);
    const drainedArea = AccumulateArea(drainage);
    const summary = Summary(height, cell);
    let erodedVolume = 0;
    let depositedVolume = 0;
    for (let k = 0; k < size; k++) {
        erodedVolume += erosion[k];
        depositedVolume += sediment[k];
    }

    return {
        height,
        sediment,
        erosion,
        drainedArea,
        preview: preview && options.previewLayerId ? preview : null,
        previewLabel,
        stats: {
            cells: size,
            cell,
            min: summary.min,
            max: summary.max,
            mean: summary.mean,
            relief: summary.relief,
            erodedVolume: erodedVolume * cellArea,
            depositedVolume: depositedVolume * cellArea,
        },
        reusedEntries: reused,
        elapsedMs: performance.now() - started,
    };
}
