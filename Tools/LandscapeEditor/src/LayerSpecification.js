// LayerSpecification: the layer model. A layer belongs to one family (base shape, relief, erosion, shaping), has one kind
// from that family, a seed, a combine operation, an opacity and an ordered list of masks. Masks can gate any family.

import { GeneratorVariants, GeneratorVariantNames } from "./GeneratorSpecification.js";
import { ErosionVariants, ErosionVariantNames } from "./ErosionSpecification.js";
import { ModifierVariants, ModifierVariantNames } from "./ModifierSpecification.js";
import { MaskVariants, MaskVariantNames } from "./MaskSpecification.js";
import { DefaultsOf, NormalizeParameters } from "./ParameterSpecification.js";

export const LayerFamilies = {
    shape: {
        label: "Base shape",
        icon: "Mountain",
        combine: "replace",
        hint: "Sets the broad form of the land. Usually the first layer.",
        kinds: GeneratorVariantNames,
        table: GeneratorVariants,
    },
    relief: {
        label: "Relief",
        icon: "Sparkles",
        combine: "add",
        hint: "Adds a generator on top of the terrain below it, optionally limited by masks.",
        kinds: GeneratorVariantNames,
        table: GeneratorVariants,
    },
    erosion: {
        label: "Erosion",
        icon: "Droplets",
        combine: "replace",
        hint: "Runs a solver on the terrain beneath it. Masks decide where the erosion acts.",
        kinds: ErosionVariantNames,
        table: ErosionVariants,
    },
    modifier: {
        label: "Shaping",
        icon: "Sliders",
        combine: "replace",
        hint: "Terraces, smooths or uplifts the terrain beneath it.",
        kinds: ModifierVariantNames,
        table: ModifierVariants,
    },
};

export const FamilyNames = Object.keys(LayerFamilies);

export const CombineOperations = {
    replace: "Replace",
    add: "Add",
    subtract: "Subtract",
    max: "Keep higher",
    min: "Keep lower",
};

export const CombineNames = Object.keys(CombineOperations);

export function VariantSpec(family, kind) {
    const table = (LayerFamilies[family] || LayerFamilies.relief).table;
    return table[kind] || table[LayerFamilies[family].kinds[0]];
}

export function VariantParameters(family, kind) {
    return VariantSpec(family, kind).parameters;
}

export function NewIdentifier(prefix) {
    return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

export function CreateMask(kind, options = {}) {
    const spec = MaskVariants[kind] || MaskVariants.coastal;
    const resolvedVariant = MaskVariants[kind] ? kind : "coastal";
    return {
        id: options.id || NewIdentifier("mask"),
        kind: resolvedVariant,
        enabled: options.enabled !== false,
        invert: Boolean(options.invert),
        strength: options.strength ?? 1,
        params: { ...DefaultsOf(spec.parameters), ...(options.params || {}) },
    };
}

export function CreateLayer(family, kind, options = {}) {
    const famKey = LayerFamilies[family] ? family : "relief";
    const spec = VariantSpec(famKey, kind);
    const resolvedVariant = LayerFamilies[famKey].table[kind] ? kind : LayerFamilies[famKey].kinds[0];
    return {
        id: options.id || NewIdentifier("layer"),
        name: options.name || spec.label,
        family: famKey,
        kind: resolvedVariant,
        enabled: options.enabled !== false,
        opacity: options.opacity ?? 1,
        combine: CombineOperations[options.combine] ? options.combine : LayerFamilies[famKey].combine,
        seed: Number.isFinite(options.seed) ? options.seed : Math.floor(Math.random() * 100000),
        params: { ...DefaultsOf(spec.parameters), ...(options.params || {}) },
        masks: (options.masks || []).map((mask) => CreateMask(mask.kind, mask)),
    };
}

// Rebuilds a saved layer, dropping unknown families and kinds and clamping every parameter to its slider range.
export function NormalizeLayer(saved) {
    if (!saved || !LayerFamilies[saved.family]) return null;
    const family = saved.family;
    const kind = LayerFamilies[family].table[saved.kind] ? saved.kind : LayerFamilies[family].kinds[0];
    const spec = VariantSpec(family, kind);
    const masks = (Array.isArray(saved.masks) ? saved.masks : []).filter((m) => MaskVariants[m.kind]).map((m) => {
        const maskSpec = MaskVariants[m.kind];
        return {
            id: m.id || NewIdentifier("mask"),
            kind: m.kind,
            enabled: m.enabled !== false,
            invert: Boolean(m.invert),
            strength: Math.min(1, Math.max(0, Number(m.strength ?? 1))),
            params: NormalizeParameters(maskSpec.parameters, m.params),
        };
    });
    return {
        id: saved.id || NewIdentifier("layer"),
        name: String(saved.name || spec.label).slice(0, 48),
        family,
        kind,
        enabled: saved.enabled !== false,
        opacity: Math.min(1, Math.max(0, Number(saved.opacity ?? 1))),
        combine: CombineOperations[saved.combine] ? saved.combine : LayerFamilies[family].combine,
        seed: Math.floor(Number.isFinite(Number(saved.seed)) ? Number(saved.seed) : 1),
        params: NormalizeParameters(spec.parameters, saved.params),
        masks,
    };
}

export function FamilyIconName(family) {
    return LayerFamilies[family] ? LayerFamilies[family].icon : "Layers";
}

export function MaskIconName(kind) {
    return MaskVariants[kind] ? MaskVariants[kind].icon : "Circle";
}

export { MaskVariants, MaskVariantNames };
