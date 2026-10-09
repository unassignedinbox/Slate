// Core checks: solver mass balance, stack caching, preset integrity and the naming rule for exported identifiers.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { ResolveStack, CreateStackCache } from "../src/LayerSequence.js";
import { CreateLayer, NormalizeLayer, LayerFamilies } from "../src/LayerSpecification.js";
import { InstantiatePreset, PresetLibrary } from "../src/PresetConfiguration.js";
import { ClassifySurface, SurfaceModeNames } from "../src/SurfaceClassifier.js";
import { RunErosion } from "../src/ErosionSpecification.js";
import { DefaultsOf } from "../src/ParameterSpecification.js";
import { GeneratorVariants } from "../src/GeneratorSpecification.js";
import { MaskVariants } from "../src/MaskSpecification.js";
import { ModifierVariants } from "../src/ModifierSpecification.js";
import { ErosionVariants } from "../src/ErosionSpecification.js";

const here = dirname(fileURLToPath(import.meta.url));
const sourceDir = join(here, "..", "src");

function TotalOf(array) {
    let sum = 0;
    for (let i = 0; i < array.length; i++) sum += array[i];
    return sum;
}

function Terrain(n, seed = 5) {
    const layer = CreateLayer("shape", "perlin", { seed, params: { amplitude: 600, baseline: 0.5 } });
    const configuration = { resolution: n, extent: 2048, sea: -10000 };
    return ResolveStack(configuration, [layer], {}).height;
}

test("hydraulic erosion conserves sediment: eroded volume equals deposited volume", () => {
    const n = 64;
    const cell = 2048 / n;
    const height = Terrain(n);
    const before = TotalOf(height);
    const result = RunErosion("hydraulic", { droplets: 8000 }, height, n, 2048, 3, -10000);
    const eroded = TotalOf(result.erosion);
    const deposited = TotalOf(result.deposition);
    assert.ok(eroded > 0, "hydraulic erosion should remove material");
    assert.ok(Math.abs(eroded - deposited) < 1e-3 * Math.max(1, eroded), `eroded ${eroded} vs deposited ${deposited}`);
    assert.ok(Math.abs(TotalOf(height) - before) < 1e-2 * Math.max(1, before) + 1e-2 * cell * n, "height sum should change only by the net sediment balance");
});

test("thermal relaxation conserves total height", () => {
    const n = 64;
    const height = Terrain(n);
    const before = TotalOf(height);
    RunErosion("thermal", { talus: 25, rate: 0.4, iterations: 30 }, height, n, 2048, 1, -10000);
    assert.ok(Math.abs(TotalOf(height) - before) < 1e-2 * n * n, "thermal transfer must not create or destroy material");
});

test("aeolian transport conserves sand exactly (erosion equals deposition)", () => {
    const n = 64;
    const layer = CreateLayer("shape", "perlin", { seed: 9, params: { amplitude: 20, baseline: 0.5, frequency: 6 } });
    const configuration = { resolution: n, extent: 2048, sea: -10000 };
    const dune = CreateLayer("erosion", "aeolian", { seed: 4, params: { iterations: 60 } });
    const result = ResolveStack(configuration, [layer, dune], {});
    const { erodedVolume, depositedVolume } = result.stats;
    assert.ok(Math.abs(erodedVolume - depositedVolume) < 1e-3 * Math.max(1, erodedVolume), `${erodedVolume} vs ${depositedVolume}`);
    assert.ok(result.stats.relief > 0);
});

test("stack evaluation is deterministic for the same seed", () => {
    const configuration = { resolution: 48, extent: 2048, sea: 0 };
    const make = () => [
        CreateLayer("shape", "ridge", { seed: 17 }),
        CreateLayer("erosion", "fluvial", { seed: 18, params: { iterations: 10 } }),
    ];
    const a = ResolveStack(configuration, make(), {});
    const b = ResolveStack(configuration, make(), {});
    assert.deepEqual(Array.from(a.height), Array.from(b.height));
});

test("the cache reuses unchanged layers and recomputes only what changed above an edit", () => {
    const configuration = { resolution: 48, extent: 2048, sea: 0 };
    const layers = [
        CreateLayer("shape", "perlin", { id: "a", seed: 1 }),
        CreateLayer("relief", "ridge", { id: "b", seed: 2 }),
        CreateLayer("erosion", "thermal", { id: "c", seed: 3 }),
    ];
    const cache = CreateStackCache();
    const first = ResolveStack(configuration, layers, {}, cache);
    assert.equal(first.reusedEntries, 0);
    const second = ResolveStack(configuration, layers, {}, cache);
    assert.equal(second.reusedEntries, 3);
    assert.deepEqual(Array.from(second.height), Array.from(first.height));

    layers[2] = { ...layers[2], params: { ...layers[2].params, iterations: 5 } };
    const third = ResolveStack(configuration, layers, {}, cache);
    assert.equal(third.reusedEntries, 2, "only the edited layer and anything above it should recompute");
});

test("renaming a layer does not invalidate the cache", () => {
    const configuration = { resolution: 32, extent: 2048, sea: 0 };
    const layers = [CreateLayer("shape", "perlin", { id: "a", seed: 1, name: "One" })];
    const cache = CreateStackCache();
    ResolveStack(configuration, layers, {}, cache);
    layers[0] = { ...layers[0], name: "Renamed" };
    const again = ResolveStack(configuration, layers, {}, cache);
    assert.equal(again.reusedEntries, 1);
});

test("every preset instantiates with known parameter keys and resolves to finite terrain", () => {
    for (const preset of PresetLibrary) {
        for (const spec of preset.layers) {
            const variants = LayerFamilies[spec.family].table;
            assert.ok(variants[spec.kind], `${preset.id}: unknown kind ${spec.kind} for ${spec.family}`);
            const known = new Set(Object.keys(DefaultsOf(variants[spec.kind].parameters)));
            for (const key of Object.keys(spec.params || {})) {
                assert.ok(known.has(key), `${preset.id}/${spec.name}: unknown parameter ${key} on ${spec.kind}`);
            }
            for (const mask of spec.masks || []) {
                assert.ok(MaskVariants[mask.kind], `${preset.id}: unknown mask ${mask.kind}`);
                const maskKeys = new Set(Object.keys(DefaultsOf(MaskVariants[mask.kind].parameters)));
                for (const key of Object.keys(mask.params || {})) {
                    assert.ok(maskKeys.has(key), `${preset.id}: mask ${mask.kind} has no parameter ${key}`);
                }
            }
        }
        const { configuration, layers } = InstantiatePreset(preset);
        const small = { ...configuration, resolution: Math.min(configuration.resolution, 48) };
        const result = ResolveStack(small, layers, {});
        assert.ok(result.height.every(Number.isFinite), `${preset.id}: non-finite height`);
        assert.ok(result.stats.relief > 0, `${preset.id}: flat terrain`);
    }
});

test("preset ids are unique and each preset has at least one shape layer", () => {
    const ids = PresetLibrary.map((p) => p.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const preset of PresetLibrary) {
        assert.equal(preset.layers[0].family, "shape", `${preset.id} should start with a base shape`);
    }
    const names = PresetLibrary.map((p) => p.name);
    for (const required of ["Canyons (sandstone)", "Sandstone cliffs", "Coastal cliffs", "Himalayan mountain", "Icelandic", "Alps", "Snowy mountains", "Rugged outcrops", "Desert dunes", "Rocky desert"]) {
        assert.ok(names.some((name) => name.startsWith(required)), `missing preset ${required}`);
    }
});

test("NormalizeLayer clamps parameters, drops unknown families and keeps valid masks", () => {
    const saved = {
        family: "erosion",
        kind: "thermal",
        params: { talus: 999, iterations: -4 },
        opacity: 3,
        masks: [{ kind: "coastal", params: { falloff: 1e9 }, strength: 4 }, { kind: "nonsense" }],
    };
    const layer = NormalizeLayer(saved);
    assert.equal(layer.family, "erosion");
    assert.equal(layer.params.talus, ErosionVariants.thermal.parameters.find((p) => p.key === "talus").max);
    assert.equal(layer.params.iterations, 1);
    assert.equal(layer.opacity, 1);
    assert.equal(layer.masks.length, 1);
    assert.equal(layer.masks[0].strength, 1);
    assert.equal(NormalizeLayer({ family: "bogus" }), null);
});

test("satmap classifier returns opaque RGBA for every mode", () => {
    const n = 32;
    const layers = InstantiatePreset(PresetLibrary[0]).layers.map((layer) => ({ ...layer }));
    const configuration = { resolution: n, extent: 2048, sea: -400 };
    const field = ResolveStack(configuration, layers, {});
    for (const mode of SurfaceModeNames) {
        const rgba = ClassifySurface(field, n, 2048 / n, configuration.sea, mode, 3);
        assert.equal(rgba.length, n * n * 4, mode);
        for (let i = 3; i < rgba.length; i += 4) assert.equal(rgba[i], 255, mode);
    }
});

test("generator, mask, modifier and erosion tables all expose parameter lists", () => {
    for (const table of [GeneratorVariants, MaskVariants, ModifierVariants, ErosionVariants]) {
        for (const [key, spec] of Object.entries(table)) {
            assert.ok(Array.isArray(spec.parameters), `${key} has no parameter list`);
        }
    }
});

test("exported identifiers avoid the banned naming words", () => {
    const banned = /(Map|Base|Blend|Grid|Flow|Filter|Stage|Stratum|Source|Pass|Mesh|Kind|Data)/;
    const files = readdirSync(sourceDir).filter((f) => f.endsWith(".js") || f.endsWith(".jsx"));
    for (const file of files) {
        const text = readFileSync(join(sourceDir, file), "utf8");
        const exports = [...text.matchAll(/export\s+(?:const|function|class|let)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
        const listed = [...text.matchAll(/export\s*\{([^}]*)\}/g)].flatMap((m) => m[1].split(",").map((s) => s.trim()).filter(Boolean));
        for (const name of [...exports, ...listed]) {
            assert.ok(!banned.test(name), `${file} exports ${name}, which contains a banned word`);
        }
        assert.ok(!banned.test(file.replace(/\.jsx?$/, "")), `${file} has a banned word in its name`);
    }
});
