//============================================================================================================================================
//                                                               LAYERPANEL.JSX
//============================================================================================================================================
// 📦 Tools/LandscapeEditor/src/panels/LayerPanel.jsx — Layer stack panel: the ordered height and satmap layer lists with add menus,
//    enable toggles, reordering and removal.

import React from 'react';
import { Layers, Plus, Eye, EyeOff, ChevronUp, ChevronDown, Trash2, Globe, Waves, Paintbrush, Shapes } from 'lucide-react';
import { GENERATOR_TYPES, generatorTypeById } from '../engine/GeneratorSpecification.js';
import { EROSION_TYPES, erosionTypeById } from '../engine/ErosionSpecification.js';
import { MATERIALS, driverById, materialById } from '../engine/SatmapSpecification.js';
import { newHeightLayer, newSatmapLayer } from '../engine/LayerConfiguration.js';

//------------------------------------------------------------------------------------------------------------------------
//                                                        DEFAULTS
//------------------------------------------------------------------------------------------------------------------------
// Each material starts with the driver that best describes where it occurs. The inspector can change it.
const DEFAULT_DRIVER_BY_MATERIAL = {
    soil: 'wetness', rock: 'slope', sandstone: 'protrusion', strata: 'bedding', basalt: 'slope', scree: 'slope', sand: 'coast',
    varnish: 'protrusion', gravel: 'river', grass: 'wetness', scrub: 'aspect', forest: 'aspect', moss: 'wetness', lichen: 'aspect',
    wetland: 'wetness', snow: 'height', ice: 'height', water: 'river', beach: 'coast'
};

export function describeLayer(layer)
{
    if (layer.category === 'generator')
    {
        return generatorTypeById(layer.type).label;
    }
    if (layer.category === 'erosion')
    {
        return erosionTypeById(layer.type).label;
    }
    return `${materialById(layer.material).label} · ${driverById(layer.driver).label}`;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                       ADD MENUS
//------------------------------------------------------------------------------------------------------------------------
function AddSelectPanel({ icon: Icon, label, options, onPick })
{
    return (
        <label className="add-row">
            <Icon size={14} />
            <select
                value=""
                onChange={(event) =>
                {
                    if (event.target.value)
                    {
                        onPick(event.target.value);
                    }
                }}
            >
                <option value="">{label}</option>
                {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
            <Plus size={14} />
        </label>
    );
}

//------------------------------------------------------------------------------------------------------------------------
//                                                          ROWS
//------------------------------------------------------------------------------------------------------------------------
function LayerRowPanel({ layer, position, count, stack, selected, onSelect, onRemove, onMove, onToggle })
{
    const enabled = layer.enabled !== false;
    const quiet = (action) => (event) =>
    {
        event.stopPropagation();
        action();
    };
    return (
        <div
            className={`layer-row${selected ? ' is-selected' : ''}${enabled ? '' : ' is-off'}`}
            onClick={() => onSelect({ stack, id: layer.id })}
            onKeyDown={(event) =>
            {
                if (event.key === 'Enter')
                {
                    onSelect({ stack, id: layer.id });
                }
            }}
            role="button"
            tabIndex={0}
        >
            <span className="layer-index">{position + 1}</span>
            <span className="layer-text">
                <span className="layer-name">{layer.name}</span>
                <span className="layer-type">{describeLayer(layer)}</span>
            </span>
            <button type="button" className="layer-action" title={enabled ? 'Turn layer off' : 'Turn layer on'} onClick={quiet(() => onToggle(stack, layer.id))}>
                {enabled ? <Eye size={14} /> : <EyeOff size={14} />}
            </button>
            <button type="button" className="layer-action" title="Move up" disabled={position === 0} onClick={quiet(() => onMove(stack, layer.id, -1))}>
                <ChevronUp size={14} />
            </button>
            <button type="button" className="layer-action" title="Move down" disabled={position === count - 1} onClick={quiet(() => onMove(stack, layer.id, 1))}>
                <ChevronDown size={14} />
            </button>
            <button type="button" className="layer-action is-danger" title="Remove layer" onClick={quiet(() => onRemove(stack, layer.id))}>
                <Trash2 size={14} />
            </button>
        </div>
    );
}

function StackSectionPanel({ title, blurb, stack, layers, selection, onSelect, onRemove, onMove, onToggle, addMenus })
{
    return (
        <section className="stack-section">
            <header className="stack-heading">
                <h3>{title}</h3>
                <span className="stack-count">{layers.length}</span>
            </header>
            <p className="stack-blurb">{blurb}</p>
            <div className="layer-list">
                {layers.map((layer, position) => (
                    <LayerRowPanel
                        key={layer.id}
                        layer={layer}
                        position={position}
                        count={layers.length}
                        stack={stack}
                        selected={selection !== null && selection.id === layer.id}
                        onSelect={onSelect}
                        onRemove={onRemove}
                        onMove={onMove}
                        onToggle={onToggle}
                    />
                ))}
                {layers.length === 0 ? <p className="empty-note">No layers yet. Add one below.</p> : null}
            </div>
            <div className="add-stack">{addMenus}</div>
        </section>
    );
}

//------------------------------------------------------------------------------------------------------------------------
//                                                         PANEL
//------------------------------------------------------------------------------------------------------------------------
export function LayerPanel({ project, selection, onSelect, onAdd, onRemove, onMove, onToggle })
{
    const terrainSelected = selection === null;
    return (
        <aside className="layer-panel">
            <header className="panel-heading">
                <Layers size={16} />
                <h2>Layer stack</h2>
            </header>
            <button type="button" className={`terrain-row${terrainSelected ? ' is-selected' : ''}`} onClick={() => onSelect(null)}>
                <Globe size={15} />
                <span>Terrain &amp; bedding</span>
            </button>
            <StackSectionPanel
                title="Height stack"
                blurb="Applied in order. Generators shape the land; erosion carves it."
                stack="heightLayers"
                layers={project.heightLayers}
                selection={selection}
                onSelect={onSelect}
                onRemove={onRemove}
                onMove={onMove}
                onToggle={onToggle}
                addMenus={[
                    <AddSelectPanel key="generator" icon={Shapes} label="Add generator…" options={GENERATOR_TYPES} onPick={(typeId) => onAdd('heightLayers', newHeightLayer('generator', typeId))} />,
                    <AddSelectPanel key="erosion" icon={Waves} label="Add erosion…" options={EROSION_TYPES} onPick={(typeId) => onAdd('heightLayers', newHeightLayer('erosion', typeId))} />
                ]}
            />
            <StackSectionPanel
                title="Satmap stack"
                blurb="Painted in order over the surface, placed by physical drivers such as slope, wetness and caprock."
                stack="satmapLayers"
                layers={project.satmapLayers}
                selection={selection}
                onSelect={onSelect}
                onRemove={onRemove}
                onMove={onMove}
                onToggle={onToggle}
                addMenus={[
                    <AddSelectPanel key="paint" icon={Paintbrush} label="Add paint layer…" options={MATERIALS} onPick={(materialId) => onAdd('satmapLayers', newSatmapLayer(materialId, DEFAULT_DRIVER_BY_MATERIAL[materialId] || 'height'))} />
                ]}
            />
        </aside>
    );
}
