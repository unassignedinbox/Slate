//============================================================================================================================================
//                                                             LANDSCAPEHOST.JSX
//============================================================================================================================================
// 📦 Tools/LandscapeEditor/src/LandscapeHost.jsx — Root editor host: owns the project, layer selection and compute queue, and lays
//    out the control bar, layer stack, viewport and inspector.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ControlPanel } from './panels/ControlPanel.jsx';
import { LayerPanel } from './panels/LayerPanel.jsx';
import { InspectorPanel } from './panels/InspectorPanel.jsx';
import { ViewportPanel } from './panels/ViewportPanel.jsx';
import { createComputeQueue } from './engine/ComputeQueue.js';
import { PRESETS, presetById } from './engine/PresetConfiguration.js';
import { presetProject, mergeLayer } from './engine/LayerConfiguration.js';
import './panels/LandscapePanel.css';

//------------------------------------------------------------------------------------------------------------------------
//                                                       CONSTANTS
//------------------------------------------------------------------------------------------------------------------------
const COMPUTE_DEBOUNCE_MS = 140;
const STACK_KEYS = ['heightLayers', 'satmapLayers'];

//------------------------------------------------------------------------------------------------------------------------
//                                                     PROJECT EDITS
//------------------------------------------------------------------------------------------------------------------------
function insertAfterSelection(list, layer, selection, stack)
{
    const anchor = selection && selection.stack === stack ? list.findIndex((candidate) => candidate.id === selection.id) : -1;
    const next = [...list];
    next.splice(anchor >= 0 ? anchor + 1 : next.length, 0, layer);
    return next;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                          HOST
//------------------------------------------------------------------------------------------------------------------------
export function LandscapeHost()
{
    const [project, setProject] = useState(() => presetProject(PRESETS[0]));
    const [presetId, setPresetId] = useState(PRESETS[0].id);
    const [selection, setSelection] = useState(null);
    const [viewId, setViewId] = useState('satmap');
    const [viewMode, setViewMode] = useState('3d');
    const [result, setResult] = useState(null);
    const [compute, setCompute] = useState({ busy: false, error: '', lastMs: 0 });
    const queueRef = useRef(null);

    // One worker for the whole session. The queue keeps only the newest project waiting while an evaluation runs.
    useEffect(() =>
    {
        const worker = new Worker(new URL('./engine/ComputeHost.worker.js', import.meta.url), { type: 'module' });
        queueRef.current = createComputeQueue(worker, {
            onStart: () => setCompute((previous) => ({ ...previous, busy: true })),
            onResult: (message) =>
            {
                setResult(message);
                setCompute({ busy: false, error: '', lastMs: message.timings.totalMs });
            },
            onError: (message) => setCompute((previous) => ({ ...previous, busy: false, error: message }))
        });
        return () =>
        {
            queueRef.current = null;
            worker.terminate();
        };
    }, []);

    useEffect(() =>
    {
        const timer = setTimeout(() =>
        {
            if (queueRef.current)
            {
                queueRef.current.submit({ project, viewId });
            }
        }, COMPUTE_DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [project, viewId]);

    const patchSettings = useCallback((patch) =>
    {
        setProject((previous) => ({ ...previous, settings: { ...previous.settings, ...patch } }));
    }, []);

    const patchBedding = useCallback((patch) =>
    {
        setProject((previous) => ({
            ...previous,
            settings: { ...previous.settings, bedding: { ...previous.settings.bedding, ...patch } }
        }));
    }, []);

    const patchLayer = useCallback((stack, id, patch) =>
    {
        setProject((previous) => ({
            ...previous,
            [stack]: previous[stack].map((layer) => (layer.id === id ? mergeLayer(layer, patch) : layer))
        }));
    }, []);

    const addLayer = useCallback((stack, layer) =>
    {
        setProject((previous) => ({
            ...previous,
            [stack]: insertAfterSelection(previous[stack], layer, selection, stack)
        }));
        setSelection({ stack, id: layer.id });
    }, [selection]);

    const removeLayer = useCallback((stack, id) =>
    {
        setProject((previous) => ({ ...previous, [stack]: previous[stack].filter((layer) => layer.id !== id) }));
        setSelection((current) => (current && current.id === id ? null : current));
    }, []);

    const moveLayer = useCallback((stack, id, delta) =>
    {
        setProject((previous) =>
        {
            const list = [...previous[stack]];
            const index = list.findIndex((layer) => layer.id === id);
            const target = index + delta;
            if (index < 0 || target < 0 || target >= list.length)
            {
                return previous;
            }
            [list[index], list[target]] = [list[target], list[index]];
            return { ...previous, [stack]: list };
        });
    }, []);

    const toggleLayer = useCallback((stack, id) =>
    {
        setProject((previous) => ({
            ...previous,
            [stack]: previous[stack].map((layer) => (layer.id === id ? { ...layer, enabled: layer.enabled === false } : layer))
        }));
    }, []);

    const applyPreset = useCallback((id) =>
    {
        const preset = presetById(id);
        if (!preset)
        {
            return;
        }
        setPresetId(id);
        setProject(presetProject(preset));
        setSelection(null);
    }, []);

    const selected = useMemo(() =>
    {
        if (!selection)
        {
            return null;
        }
        const stack = STACK_KEYS.find((key) => key === selection.stack);
        const layer = stack ? project[stack].find((candidate) => candidate.id === selection.id) : null;
        return layer ? { stack, layer } : null;
    }, [project, selection]);

    return (
        <div className="landscape-root">
            <ControlPanel
                presets={PRESETS}
                presetId={presetId}
                onPreset={applyPreset}
                resolution={project.settings.resolution}
                onResolution={(size) => patchSettings({ resolution: size })}
                compute={compute}
            />
            <main className="landscape-workspace">
                <LayerPanel
                    project={project}
                    selection={selection}
                    onSelect={setSelection}
                    onAdd={addLayer}
                    onRemove={removeLayer}
                    onMove={moveLayer}
                    onToggle={toggleLayer}
                />
                <ViewportPanel
                    viewMode={viewMode}
                    onViewMode={setViewMode}
                    viewId={viewId}
                    onViewId={setViewId}
                    result={result}
                    compute={compute}
                />
                <InspectorPanel
                    selected={selected}
                    settings={project.settings}
                    result={result}
                    onSettings={patchSettings}
                    onBedding={patchBedding}
                    onLayer={patchLayer}
                />
            </main>
        </div>
    );
}

export function mountLandscapeHost(container)
{
    createRoot(container).render(<LandscapeHost />);
}
