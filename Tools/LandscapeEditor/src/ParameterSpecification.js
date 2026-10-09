// ParameterSpecification: shared slider descriptors. Every generator, mask, erosion type and modifier declares its
// sliders as arrays of these records, so the inspector can build its controls and the loader can clamp saved values.

export function Parameter(key, label, min, max, step, value, unit = "", hint = "", low = "", high = "") {
    return { key, label, min, max, step, value, unit, hint, low, high };
}

export function DefaultsOf(parameters) {
    const values = {};
    for (const parameter of parameters) {
        values[parameter.key] = parameter.value;
    }
    return values;
}

// Clamp and fill a saved parameter object against its specification. Unknown keys are dropped.
export function NormalizeParameters(parameters, saved) {
    const values = {};
    for (const parameter of parameters) {
        const raw = Number(saved && saved[parameter.key]);
        const finite = Number.isFinite(raw) ? raw : parameter.value;
        values[parameter.key] = Math.min(parameter.max, Math.max(parameter.min, finite));
    }
    return values;
}
