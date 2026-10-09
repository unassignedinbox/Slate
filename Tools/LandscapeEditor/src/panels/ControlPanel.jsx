//============================================================================================================================================
//                                                              CONTROLPANEL.JSX
//============================================================================================================================================
// 📦 Tools/LandscapeEditor/src/panels/ControlPanel.jsx — Control bar panel: brand, preset chooser, resolution selector with a large-
//    grid warning, and the live compute status.

import React from 'react';
import { Mountain, LoaderCircle, TriangleAlert, CircleCheck } from 'lucide-react';
import { RESOLUTIONS } from '../engine/TerrainConfiguration.js';

//------------------------------------------------------------------------------------------------------------------------
//                                                         PANEL
//------------------------------------------------------------------------------------------------------------------------
export function ControlPanel({ presets, presetId, onPreset, resolution, onResolution, compute })
{
    let tone = 'is-ready';
    let text = 'Ready';
    if (compute.error)
    {
        tone = 'is-error';
        text = 'Compute failed';
    }
    else if (compute.busy)
    {
        tone = 'is-busy';
        text = 'Computing…';
    }
    else if (compute.lastMs)
    {
        text = `Ready · ${(compute.lastMs / 1000).toFixed(1)} s`;
    }
    return (
        <header className="control-bar">
            <div className="brand">
                <Mountain size={22} />
                <div>
                    <h1>Landscape Editor</h1>
                    <p>Heightmap, satmap and erosion studio</p>
                </div>
            </div>
            <label className="control-field">
                <span>Preset</span>
                <select value={presetId} onChange={(event) => onPreset(event.target.value)}>
                    {presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
                </select>
            </label>
            <label className="control-field">
                <span>Resolution</span>
                <select value={resolution} onChange={(event) => onResolution(Number(event.target.value))}>
                    {RESOLUTIONS.map((size) => <option key={size} value={size}>{`${size} × ${size}`}</option>)}
                </select>
            </label>
            {resolution > 384 ? (
                <span className="control-warning">
                    <TriangleAlert size={14} />
                    <span>Large grid: each recompute takes several seconds.</span>
                </span>
            ) : null}
            <div className={`status-pill ${tone}`}>
                {compute.busy ? <LoaderCircle size={14} className="spin" /> : <CircleCheck size={14} />}
                <span>{text}</span>
            </div>
        </header>
    );
}
