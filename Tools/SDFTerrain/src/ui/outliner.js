//==========================================================================================
// Outliner — the left column: what is in the scene, which recipe is loaded, and the mass
// audit. The audit matters more than it looks: erosion solvers that quietly invent or destroy
// material are the reason terrain tools produce impossible landforms. Eroded, deposited,
// carried and exported are reported separately so the sum can be checked against reality.
//==========================================================================================

import { PRESETS } from '../kernel/graph/doc.js';
import { formatNumber } from './shell.js';

const SCENE_ROWS = [
    { id: 'terrain', name: 'Terrain volume', hint: 'SDF', setting: 'showTerrain' },
    { id: 'water', name: 'Water surface', hint: 'rivers', setting: 'showWater' },
    { id: 'parcels', name: 'Erosion parcels', hint: 'live', setting: 'showParticles' },
    { id: 'sky', name: 'Sky and sun', hint: 'look', setting: 'showSky' },
    { id: 'grid', name: 'Reference grid', hint: '1 km', setting: 'showGrid' },
];

export function buildOutliner(host, state, handlers)
{
    host.innerHTML = '';

    for (const row of SCENE_ROWS)
    {
        const element = document.createElement('div');
        element.className = 'list-row';
        const enabled = state.visibility[row.setting] !== false;
        element.innerHTML = `
            <span class="swatch" style="background:${enabled ? '#6c77ff' : '#3a3a3a'}"></span>
            <span class="name">${row.name}</span>
            <span class="badge">${row.hint}</span>`;
        element.onclick = () => handlers.onToggle(row.setting);
        host.appendChild(element);
    }

    const divider = document.createElement('div');
    divider.className = 'divider';
    host.appendChild(divider);

    const bakeRow = document.createElement('div');
    bakeRow.className = 'list-row';
    bakeRow.innerHTML = `
        <span class="swatch" style="background:#22c55e"></span>
        <span class="name">Bake volume</span>
        <span class="badge">${state.bakeStride > 1 ? `stride ${state.bakeStride}` : 'full'}</span>`;
    bakeRow.onclick = () => handlers.onBake();
    host.appendChild(bakeRow);

    const collectRow = document.createElement('div');
    collectRow.className = 'list-row';
    collectRow.innerHTML = `
        <span class="swatch" style="background:#f59e0b"></span>
        <span class="name">Clear erosion state</span>
        <span class="badge">reset</span>`;
    collectRow.onclick = () => handlers.onResetErosion();
    host.appendChild(collectRow);
}

export function buildPresets(host, state, handlers)
{
    host.innerHTML = '';
    for (const preset of PRESETS)
    {
        const element = document.createElement('div');
        element.className = `list-row${state.preset === preset.id ? ' active' : ''}`;
        element.innerHTML = `
            <span class="swatch" style="background:${state.preset === preset.id ? '#ffffff' : '#6c77ff'}"></span>
            <span class="name">${preset.title}</span>
            <span class="badge">load</span>`;
        element.title = preset.note;
        element.onclick = () => handlers.onLoadPreset(preset.id);
        host.appendChild(element);
    }

    const note = document.createElement('div');
    note.className = 'warn-text';
    note.style.marginTop = '6px';
    const active = PRESETS.find((entry) => entry.id === state.preset);
    note.textContent = active ? active.note : 'Pick a starting landform; the graph then drives everything.';
    host.appendChild(note);
}

export function updateBalance(state)
{
    const stats = state.stats || {};
    const set = (id, value) => {
        const node = document.getElementById(id);
        if (node)
        {
            node.textContent = value;
        }
    };
    set('balEroded', formatNumber(stats.eroded || 0));
    set('balDeposited', formatNumber(stats.deposited || 0));
    set('balCarried', formatNumber(stats.carried || 0));
    set('balEscaped', formatNumber(stats.escaped || 0));

    const note = document.getElementById('balanceNote');
    if (note)
    {
        const eroded = stats.eroded || 0;
        const deposited = stats.deposited || 0;
        const carried = stats.carried || 0;
        const escaped = stats.escaped || 0;
        const accounted = deposited + carried + escaped;
        const drift = eroded > 0 ? Math.abs(1 - accounted / eroded) : 0;
        if (eroded < 1e-6)
        {
            note.textContent = 'No material moved yet. Press Run; rainfall drives the first channels.';
        }
        else
        {
            note.textContent = `Bedrock cut ${formatNumber(eroded)} m³ · redeposited ${formatNumber(deposited)} · still suspended ${formatNumber(carried)} · left the map ${formatNumber(escaped)}. Closure ${(100 - drift * 100).toFixed(1)}%.`;
        }
    }
}

// Diagnostics list in the outliner footer: shader compile problems, device errors, solver
// warnings. Anything that would otherwise only reach the console ends up here.
export function pushDiagnostic(state, message, kind = 'info')
{
    state.diagnostics.unshift({ message, kind, time: Date.now() });
    state.diagnostics.length = Math.min(state.diagnostics.length, 24);
}
