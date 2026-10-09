import { useCallback, useEffect, useRef, useState } from "react";
import * as Icons from "lucide-react";
import LayerPanel, { Icon } from "./LayerPanel.jsx";
import InspectorPanel from "./InspectorPanel.jsx";
import ViewportPanel from "./ViewportPanel.jsx";
import { PresetLibrary, PresetById, InstantiatePreset } from "./PresetConfiguration.js";
import { CreateLayer, CreateMask, NormalizeLayer, VariantSpec } from "./LayerSpecification.js";
import { CreateRevisionSequence } from "./RevisionSequence.js";
import { SerializeProject, ParseProject, NormalizeConfiguration } from "./StorageCodec.js";
import { EncodeHeightPng } from "./PngCodec.js";
import { SurfaceModes, SurfaceModeNames } from "./SurfaceClassifier.js";

const AutosaveKey = "slate-landscape-autosave";
const SatmapChoices = SurfaceModeNames.map((id) => ({ id, label: SurfaceModes[id].label }));

function StartingProject() {
    try {
        const saved = window.localStorage.getItem(AutosaveKey);
        if (saved) return { ...ParseProject(saved), presetId: null };
    } catch {
        // Corrupt or unavailable storage: fall back to a preset.
    }
    const preset = PresetById("alps");
    return { ...InstantiatePreset(preset), presetId: preset.id };
}

function Download(name, blob) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function LandscapeHost() {
    const [project, setProject] = useState(StartingProject);
    const [selectedId, setSelectedId] = useState(null);
    const [view, setView] = useState("satmap");
    const [showPreview, setShowPreview] = useState(false);
    const [result, setResult] = useState(null);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState("");
    const projectRef = useRef(project);
    projectRef.current = project;
    const historyRef = useRef(null);
    if (historyRef.current === null) historyRef.current = CreateRevisionSequence();
    const pumpRef = useRef(null);
    const fileRef = useRef(null);
    const [, forceRender] = useState(0);

    // Worker: only one request runs at a time, and a newer request replaces any queued one.
    useEffect(() => {
        const worker = new Worker(new URL("./ElevationWorker.js", import.meta.url), { type: "module" });
        const state = { next: 1, inFlight: null, queued: null, current: null };
        const pump = (payload) => {
            if (state.inFlight !== null) {
                state.queued = payload;
                return;
            }
            const id = state.next++;
            state.inFlight = id;
            state.current = payload;
            setBusy(true);
            worker.postMessage({ id, ...payload });
        };
        worker.onmessage = (event) => {
            const reply = event.data;
            if (reply.id !== state.inFlight) return;
            state.inFlight = null;
            if (reply.ok) {
                setResult({ ...reply, resolution: state.current.configuration.resolution });
                setMessage("");
            } else {
                setMessage(`Solver error: ${reply.message}`);
            }
            if (state.queued) {
                const next = state.queued;
                state.queued = null;
                pump(next);
            } else {
                setBusy(false);
            }
        };
        worker.onerror = (event) => setMessage(`Worker failed: ${event.message || "unknown error"}`);
        pumpRef.current = pump;
        return () => {
            worker.terminate();
            pumpRef.current = null;
        };
    }, []);

    // Recompute whenever the project, the selection used for the mask preview, or the satmap changes.
    useEffect(() => {
        if (!pumpRef.current) return;
        pumpRef.current({
            configuration: project.configuration,
            layers: project.layers,
            satmap: project.satmap,
            previewLayerId: showPreview && selectedId ? selectedId : null,
        });
    }, [project, selectedId, showPreview]);

    // Autosave, debounced.
    useEffect(() => {
        const timer = setTimeout(() => {
            try {
                window.localStorage.setItem(AutosaveKey, SerializeProject(project));
            } catch {
                // Storage full or blocked: the project still works, it just is not remembered.
            }
        }, 600);
        return () => clearTimeout(timer);
    }, [project]);

    const commit = useCallback((next, key = null) => {
        historyRef.current.record(projectRef.current, key);
        setProject(next);
    }, []);

    const undo = useCallback(() => {
        const previous = historyRef.current.undo(projectRef.current);
        if (previous) setProject(previous);
        forceRender((n) => n + 1);
    }, []);

    const redo = useCallback(() => {
        const next = historyRef.current.redo(projectRef.current);
        if (next) setProject(next);
        forceRender((n) => n + 1);
    }, []);

    useEffect(() => {
        const onKey = (event) => {
            const tag = event.target && event.target.tagName;
            if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
            const mod = event.ctrlKey || event.metaKey;
            if (mod && event.key.toLowerCase() === "z" && !event.shiftKey) {
                event.preventDefault();
                undo();
            } else if (mod && ((event.key.toLowerCase() === "z" && event.shiftKey) || event.key.toLowerCase() === "y")) {
                event.preventDefault();
                redo();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [undo, redo]);

    const current = projectRef.current;
    const selected = current.layers.find((layer) => layer.id === selectedId) || null;

    // Any edit to the stack or the terrain settings turns a preset into a custom project.
    const replaceLayers = (layers, key = null, extra = {}) => commit({ ...current, presetId: null, ...extra, layers }, key);

    const updateLayer = (id, patch, key = null) => {
        const before = current.layers.find((layer) => layer.id === id);
        const layers = current.layers.map((layer) => {
            if (layer.id !== id) return layer;
            const next = { ...layer, ...patch };
            // Keep the default name in step with the chosen type, but never overwrite a name the user typed.
            if (patch.kind !== undefined && layer.name === VariantSpec(before.family, before.kind).label) {
                next.name = VariantSpec(before.family, patch.kind).label;
            }
            return next;
        });
        replaceLayers(layers, key);
    };

    const updateMask = (layerId, maskId, patch, key = null) => {
        const layers = current.layers.map((layer) => {
            if (layer.id !== layerId) return layer;
            return { ...layer, masks: layer.masks.map((mask) => (mask.id === maskId ? { ...mask, ...patch } : mask)) };
        });
        replaceLayers(layers, key);
    };

    const addLayer = (family, kind) => {
        const layer = CreateLayer(family, kind);
        replaceLayers([...current.layers, layer]);
        setSelectedId(layer.id);
    };

    const removeLayer = (id) => {
        replaceLayers(current.layers.filter((layer) => layer.id !== id));
        if (selectedId === id) setSelectedId(null);
    };

    const moveLayer = (id, direction) => {
        const index = current.layers.findIndex((layer) => layer.id === id);
        const target = index + direction;
        if (index < 0 || target < 0 || target >= current.layers.length) return;
        const layers = [...current.layers];
        [layers[index], layers[target]] = [layers[target], layers[index]];
        replaceLayers(layers);
    };

    const duplicateLayer = (id) => {
        const source = current.layers.find((layer) => layer.id === id);
        if (!source) return;
        const copy = NormalizeLayer({
            ...source,
            id: undefined,
            name: `${source.name} copy`,
            seed: source.seed + 1,
            masks: source.masks.map((mask) => ({ ...mask, id: undefined })),
        });
        const index = current.layers.findIndex((layer) => layer.id === id);
        const layers = [...current.layers];
        layers.splice(index + 1, 0, copy);
        replaceLayers(layers);
        setSelectedId(copy.id);
    };

    const addMask = (layerId, kind) => {
        const mask = CreateMask(kind);
        const layers = current.layers.map((layer) => (layer.id === layerId ? { ...layer, masks: [...layer.masks, mask] } : layer));
        replaceLayers(layers);
    };

    const removeMask = (layerId, maskId) => {
        const layers = current.layers.map((layer) => (layer.id === layerId ? { ...layer, masks: layer.masks.filter((mask) => mask.id !== maskId) } : layer));
        replaceLayers(layers);
    };

    const shuffleSeed = (id) => {
        const seed = Math.floor(Math.random() * 100000);
        updateLayer(id, { seed });
    };

    const updateConfiguration = (patch, key) => {
        commit({ ...current, presetId: null, configuration: NormalizeConfiguration({ ...current.configuration, ...patch }) }, key);
    };

    const setSatmap = (mode) => commit({ ...current, satmap: mode }, "satmap");

    const applyPreset = (id) => {
        const preset = PresetById(id);
        const instance = InstantiatePreset(preset);
        commit({ ...instance, presetId: preset.id });
        setSelectedId(null);
        setMessage("");
    };

    const saveProject = () => {
        Download("landscape.json", new Blob([SerializeProject(current)], { type: "application/json" }));
    };

    const openProject = (event) => {
        const file = event.target.files && event.target.files[0];
        event.target.value = "";
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const loaded = ParseProject(String(reader.result));
                commit({ ...loaded, presetId: null });
                setSelectedId(null);
                setMessage("");
            } catch (failure) {
                setMessage(failure.message);
            }
        };
        reader.readAsText(file);
    };

    const exportHeightmap = () => {
        if (!result) return;
        const png = EncodeHeightPng(result.height, result.resolution, result.stats.min, result.stats.max);
        Download("heightmap.png", new Blob([png], { type: "image/png" }));
    };

    const satmapLabel = SurfaceModes[current.satmap] ? SurfaceModes[current.satmap].label : "Natural";

    return (
        <div className="app">
            <header className="topbar">
                <div className="brand">
                    <Icons.Mountain size={16} strokeWidth={1.8} />
                    <span>Landscape editor</span>
                </div>
                <label className="topbar-field">
                    <span>Preset</span>
                    <select value={current.presetId || ""} onChange={(event) => event.target.value && applyPreset(event.target.value)}>
                        {current.presetId === null && <option value="">Custom</option>}
                        {PresetLibrary.map((preset) => (
                            <option key={preset.id} value={preset.id} title={preset.summary}>{preset.name}</option>
                        ))}
                    </select>
                </label>
                <div className="topbar-group">
                    <button type="button" className="icon-button" title="Undo (Ctrl+Z)" onClick={undo} disabled={!historyRef.current.canUndo}>
                        <Icons.Undo2 size={15} />
                    </button>
                    <button type="button" className="icon-button" title="Redo (Ctrl+Shift+Z)" onClick={redo} disabled={!historyRef.current.canRedo}>
                        <Icons.Redo2 size={15} />
                    </button>
                </div>
                <div className="topbar-group">
                    <button type="button" className="button" onClick={() => fileRef.current && fileRef.current.click()}>
                        <Icons.FolderOpen size={14} /> Open
                    </button>
                    <button type="button" className="button" onClick={saveProject}>
                        <Icons.Save size={14} /> Save
                    </button>
                    <button type="button" className="button" onClick={exportHeightmap} disabled={!result}>
                        <Icons.Download size={14} /> Heightmap PNG
                    </button>
                </div>
                <span className="topbar-spacer" />
                <span className={`topbar-message${message ? " error" : ""}`}>{message || (busy ? "Computing…" : "")}</span>
                <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={openProject} />
            </header>
            <div className="workspace">
                <LayerPanel
                    layers={current.layers}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    onToggle={(id) => updateLayer(id, { enabled: !current.layers.find((l) => l.id === id).enabled })}
                    onMove={moveLayer}
                    onRemove={removeLayer}
                    onDuplicate={duplicateLayer}
                    onAdd={addLayer}
                />
                <ViewportPanel
                    result={result}
                    view={view}
                    onView={setView}
                    showPreview={showPreview && Boolean(selectedId)}
                    previewAvailable={Boolean(selectedId)}
                    onShowPreview={setShowPreview}
                    satmap={current.satmap}
                    satmapModes={SatmapChoices}
                    onSatmap={setSatmap}
                    sea={current.configuration.sea}
                    extent={current.configuration.extent}
                    busy={busy}
                />
                <InspectorPanel
                    layer={selected}
                    configuration={current.configuration}
                    onConfiguration={updateConfiguration}
                    onLayer={updateLayer}
                    onAddMask={addMask}
                    onMask={updateMask}
                    onRemoveMask={removeMask}
                    onShuffleSeed={shuffleSeed}
                    stats={result ? result.stats : null}
                    satmapLabel={satmapLabel}
                />
            </div>
        </div>
    );
}
