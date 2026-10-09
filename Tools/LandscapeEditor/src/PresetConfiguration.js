// PresetConfiguration: starting stacks for the landforms the editor ships with. Each preset is data only: a grid
// resolution, an extent, a sea level, a default satmap mode and an ordered list of layer overrides. Parameters that are
// not listed fall back to their slider defaults, so presets stay short and readable.

import { CreateLayer, VariantSpec } from "./LayerSpecification.js";

export const DefaultConfiguration = { resolution: 192, extent: 4096, sea: 0 };

function Layer(family, kind, name, seed, params = {}, extra = {}) {
    return { family, kind, name, seed, params, ...extra };
}

function Mask(kind, params = {}, extra = {}) {
    return { kind, params, ...extra };
}

export const PresetLibrary = [
    {
        id: "canyons",
        name: "Canyons (sandstone)",
        summary: "Stepped sandstone plateaus cut by a dry river network.",
        resolution: 192,
        sea: -400,
        satmap: "strata",
        layers: [
            Layer("shape", "terraces", "Sandstone plateau", 11, { steps: 9, riser: 0.8, amplitude: 1100, baseline: 0.36, frequency: 1.4 }),
            Layer("relief", "perlin", "Weathered surface", 12, { amplitude: 90, frequency: 7 }, {
                masks: [Mask("stratify", { thickness: 40, hardness: 0.7 })],
            }),
            Layer("erosion", "fluvial", "Canyon incision", 13, { iterations: 50, erodibility: 0.02, uplift: 0.6, hardnessContrast: 0.6 }),
            Layer("erosion", "thermal", "Bed collapse", 14, { talus: 38, iterations: 30 }, {
                masks: [Mask("cliffs", { angle: 34, softness: 5 })],
            }),
        ],
    },
    {
        id: "sandstone-cliffs",
        name: "Sandstone cliffs",
        summary: "Horizontal beds with sharp, layered escarpments.",
        resolution: 192,
        sea: -300,
        satmap: "strata",
        layers: [
            Layer("shape", "terraces", "Mesa field", 21, { steps: 5, riser: 0.9, amplitude: 800, baseline: 0.4, frequency: 2 }),
            Layer("relief", "billow", "Bedding texture", 22, { amplitude: 60, frequency: 9 }, {
                masks: [Mask("stratify", { thickness: 28, hardness: 0.8, dip: 2 })],
            }),
            Layer("erosion", "thermal", "Cliff retreat", 23, { talus: 52, iterations: 45 }, {
                masks: [Mask("cliffs", { angle: 40, softness: 4 })],
            }),
            Layer("erosion", "fluvial", "Gully cutting", 24, { iterations: 30, erodibility: 0.03, uplift: 0.3 }),
        ],
    },
    {
        id: "coastal-cliffs",
        name: "Coastal cliffs",
        summary: "A rocky shoreline cut back by waves, with uplands inland.",
        resolution: 192,
        sea: 0,
        satmap: "natural",
        layers: [
            Layer("shape", "dome", "Coastal upland", 31, { radius: 0.72, falloff: 1.1, amplitude: 1100, baseline: 0.52 }),
            Layer("relief", "ridge", "Inland ridges", 32, { amplitude: 360, frequency: 4 }, {
                masks: [Mask("mountain", { start: 300, softness: 700, ragged: 0.6 })],
            }),
            Layer("erosion", "coastal", "Wave-cut cliffs", 33, { iterations: 60, rate: 1.1, reach: 160, cliffAngle: 40 }),
            Layer("erosion", "thermal", "Talus at the foot", 34, { talus: 36, iterations: 20 }, {
                masks: [Mask("coastal", { falloff: 120, breakup: 0.3 })],
            }),
        ],
    },
    {
        id: "himalayan",
        name: "Himalayan mountain",
        summary: "A massive, steep range with deep gorges and high snowfields.",
        resolution: 192,
        sea: -500,
        satmap: "natural",
        layers: [
            Layer("shape", "mountain", "Range body", 41, { amplitude: 2800, baseline: 0.12, sharpness: 2.6, frequency: 1.6, ridgeShare: 0.8 }),
            Layer("relief", "ridge", "Crest ridges", 42, { amplitude: 700, frequency: 5, sharpness: 2.4 }, {
                masks: [Mask("mountain", { start: 600, softness: 900, ragged: 0.5 })],
            }),
            Layer("erosion", "fluvial", "Gorge incision", 43, { iterations: 80, erodibility: 0.02, uplift: 4, hardnessContrast: 0.5 }),
            Layer("erosion", "thermal", "Scree slopes", 44, { talus: 40, iterations: 40 }, {
                masks: [Mask("cliffs", { angle: 36, softness: 8 })],
            }),
        ],
    },
    {
        id: "icelandic",
        name: "Icelandic",
        summary: "Volcanic plateaus with lava steps, fjord coast and waterfalls.",
        resolution: 192,
        sea: 0,
        satmap: "natural",
        layers: [
            Layer("shape", "dome", "Shield volcano", 51, { radius: 0.6, falloff: 1.8, amplitude: 900, baseline: 0.42 }),
            Layer("relief", "terraces", "Lava steps", 52, { steps: 14, riser: 0.25, amplitude: 90, frequency: 3 }, {
                masks: [Mask("coastal", { falloff: 300, breakup: 0.2 }, { invert: true })],
            }),
            Layer("relief", "billow", "Lava texture", 53, { amplitude: 140, frequency: 6 }, {
                masks: [Mask("height", { low: 200, high: 700 })],
            }),
            Layer("erosion", "fluvial", "Glacial valleys", 54, { iterations: 45, erodibility: 0.03, uplift: 0.2, hardnessContrast: 0.75 }),
            Layer("erosion", "thermal", "Cliff falls", 55, { talus: 35, iterations: 25 }, {
                masks: [Mask("cliffs", { angle: 30, softness: 6 })],
            }),
        ],
    },
    {
        id: "alps",
        name: "Alps",
        summary: "Sharp alpine peaks, glacier-carved valleys and tight ridgelines.",
        resolution: 192,
        sea: -400,
        satmap: "natural",
        layers: [
            Layer("shape", "mountain", "Alpine massif", 61, { amplitude: 2200, baseline: 0.12, sharpness: 2.2, frequency: 2, ridgeShare: 0.8 }),
            Layer("relief", "ridge", "Arêtes", 62, { amplitude: 500, frequency: 6, sharpness: 2.8 }, {
                masks: [Mask("mountain", { start: 800, softness: 700, ragged: 0.4 })],
            }),
            Layer("erosion", "hydraulic", "Valley carving", 63, { droplets: 60000, erodeRate: 0.35, capacity: 5 }),
            Layer("erosion", "fluvial", "Trunk valleys", 64, { iterations: 60, erodibility: 0.04, uplift: 1.2 }),
            Layer("modifier", "smooth", "Settled slopes", 65, { passes: 2 }, {
                masks: [Mask("slope", { from: 45, to: 70 })],
            }),
        ],
    },
    {
        id: "snowy-mountains",
        name: "Snowy mountains",
        summary: "High, rounded summits and smooth snowfields above a rugged base.",
        resolution: 192,
        sea: -600,
        satmap: "natural",
        layers: [
            Layer("shape", "mountain", "Snowy massif", 71, { amplitude: 2600, baseline: 0.12, sharpness: 2.9, frequency: 1.8, detail: 0.4 }),
            Layer("relief", "multifractal", "Cirque texture", 72, { amplitude: 260, frequency: 8, dimension: 0.4 }, {
                masks: [Mask("height", { low: 1200, high: 3000 })],
            }),
            Layer("erosion", "thermal", "Snow shedding", 73, { talus: 42, iterations: 60 }),
            Layer("erosion", "fluvial", "Glacial troughs", 74, { iterations: 30, erodibility: 0.02, uplift: 0.8 }),
            Layer("modifier", "smooth", "Snowfield", 75, { passes: 3 }, {
                masks: [Mask("height", { low: 2000, high: 3200 })],
            }),
        ],
    },
    {
        id: "rugged-outcrops",
        name: "Rugged outcrops",
        summary: "Rock stacks and tors on a broken plateau.",
        resolution: 192,
        sea: -300,
        satmap: "natural",
        layers: [
            Layer("shape", "ridge", "Broken plateau", 81, { amplitude: 500, baseline: 0.52, frequency: 6, sharpness: 1.6 }),
            Layer("relief", "cells", "Tors and plateaus", 82, { amplitude: 260, frequency: 7, edge: 1.2, randomHeight: 0.8 }, {
                masks: [Mask("noise", { frequency: 5, threshold: 0.4, softness: 0.2 })],
            }),
            Layer("relief", "dome", "Stack field", 83, { amplitude: 180, radius: 0.5, falloff: 2 }, {
                masks: [Mask("stacks", { density: 0.35, radius: 60, minHeight: 40, spacing: 9 })],
            }),
            Layer("erosion", "hydraulic", "Weathering runnels", 84, { droplets: 80000, lifetime: 40, capacity: 3 }),
            Layer("erosion", "thermal", "Outcrop faces", 85, { talus: 38, iterations: 25 }, {
                masks: [Mask("cliffs", { angle: 32, softness: 5 })],
            }),
        ],
    },
    {
        id: "desert-dunes",
        name: "Desert dunes",
        summary: "A sand sea of wind-built dunes over gentle, rolling ground.",
        resolution: 128,
        sea: -1000,
        satmap: "natural",
        layers: [
            Layer("shape", "perlin", "Dune sea floor", 91, { amplitude: 60, baseline: 0.5, frequency: 1.5, octaves: 4 }),
            Layer("relief", "billow", "Interdune swells", 92, { amplitude: 25, frequency: 2 }),
            Layer("erosion", "aeolian", "Dune building", 93, { direction: 60, wavelength: 220, iterations: 120, strength: 1, crestAcceleration: 3, sandSupply: 0.9 }),
        ],
    },
    {
        id: "rocky-desert",
        name: "Rocky desert",
        summary: "Mesas, dry washes and wind-polished bedrock.",
        resolution: 192,
        sea: -1000,
        satmap: "strata",
        layers: [
            Layer("shape", "mountain", "Desert ranges", 101, { amplitude: 700, baseline: 0.12, sharpness: 1.6, ridgeShare: 0.5, frequency: 2.5 }),
            Layer("relief", "terraces", "Mesa benches", 102, { steps: 6, riser: 0.7, amplitude: 160, frequency: 3 }, {
                masks: [Mask("stratify", { thickness: 60, hardness: 0.6, dip: 3 })],
            }),
            Layer("erosion", "fluvial", "Dry washes", 103, { iterations: 30, erodibility: 0.015, uplift: 0.2 }),
            Layer("erosion", "thermal", "Mesa scarps", 104, { talus: 36, iterations: 40 }, {
                masks: [Mask("cliffs", { angle: 32, softness: 6 })],
            }),
            Layer("erosion", "aeolian", "Polished bedrock", 105, { iterations: 40, strength: 0.6, sandSupply: 0.3, wavelength: 120 }),
        ],
    },
];

export const PresetNames = PresetLibrary.map((preset) => preset.id);

export function PresetById(id) {
    return PresetLibrary.find((preset) => preset.id === id) || PresetLibrary[0];
}

// Builds the runtime configuration and layer list for a preset. Layers come from CreateLayer so every parameter is
// clamped and filled from its defaults.
export function InstantiatePreset(preset) {
    const configuration = {
        resolution: preset.resolution ?? DefaultConfiguration.resolution,
        extent: preset.extent ?? DefaultConfiguration.extent,
        sea: preset.sea ?? DefaultConfiguration.sea,
    };
    const layers = preset.layers.map((spec, index) => {
        const variant = VariantSpec(spec.family, spec.kind);
        return CreateLayer(spec.family, spec.kind, {
            id: `${preset.id}-${index + 1}`,
            name: spec.name || variant.label,
            seed: spec.seed,
            params: spec.params,
            masks: (spec.masks || []).map((mask) => ({ ...mask, id: undefined })),
            combine: spec.combine,
            opacity: spec.opacity,
        });
    });
    return { configuration, layers, satmap: preset.satmap || "natural" };
}
