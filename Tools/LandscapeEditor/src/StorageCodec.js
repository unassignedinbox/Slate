// StorageCodec: reads and writes project files. A project is the configuration, the satmap mode and the ordered layer
// stack. Loading always goes through NormalizeLayer and range checks, so a hand-edited or old file cannot put the solvers
// outside their supported ranges.

import { NormalizeLayer } from "./LayerSpecification.js";

export const ProjectFormat = "slate-landscape";
export const ProjectVersion = 1;
export const ResolutionLimits = { min: 64, max: 512 };

export function SerializeProject(project) {
    return JSON.stringify(
        {
            format: ProjectFormat,
            version: ProjectVersion,
            configuration: project.configuration,
            satmap: project.satmap,
            layers: project.layers,
        },
        null,
        2,
    );
}

export function ParseProject(text) {
    let data;
    try {
        data = JSON.parse(text);
    } catch {
        throw new Error("The file is not valid JSON.");
    }
    if (!data || data.format !== ProjectFormat) {
        throw new Error("The file is not a landscape project.");
    }
    if (data.version !== ProjectVersion) {
        throw new Error(`Unsupported project version ${data.version}.`);
    }
    const configuration = NormalizeConfiguration(data.configuration);
    const layers = (Array.isArray(data.layers) ? data.layers : []).map(NormalizeLayer).filter(Boolean);
    if (layers.length === 0) {
        throw new Error("The project has no usable layers.");
    }
    return { configuration, layers, satmap: typeof data.satmap === "string" ? data.satmap : "natural" };
}

export function NormalizeConfiguration(saved = {}) {
    const resolution = Math.round(Number(saved.resolution));
    const extent = Number(saved.extent);
    const sea = Number(saved.sea);
    return {
        resolution: Number.isFinite(resolution) ? Math.min(ResolutionLimits.max, Math.max(ResolutionLimits.min, resolution)) : 192,
        extent: Number.isFinite(extent) ? Math.min(20000, Math.max(256, extent)) : 4096,
        sea: Number.isFinite(sea) ? Math.min(2000, Math.max(-2000, sea)) : 0,
    };
}
