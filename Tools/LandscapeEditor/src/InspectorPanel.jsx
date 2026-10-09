import { useState } from "react";
import * as Icons from "lucide-react";
import { Icon } from "./LayerPanel.jsx";
import { LayerFamilies, VariantSpec, CombineOperations, CombineNames, MaskIconName, FamilyIconName } from "./LayerSpecification.js";
import { MaskVariants, MaskVariantNames } from "./MaskSpecification.js";
import { DefaultsOf } from "./ParameterSpecification.js";

// One slider row. Dragging coalesces into one undo step through `historyKey`.
export function ParameterSlider({ parameter, value, onChange, historyKey }) {
    const decimals = Math.max(0, -Math.floor(Math.log10(parameter.step)));
    const shown = Number(value).toFixed(decimals);
    return (
        <div className="row slider-row" title={parameter.hint}>
            <div className="row-label">
                <span>{parameter.label}</span>
                <span className="row-value">{shown}{parameter.unit ? ` ${parameter.unit}` : ""}</span>
            </div>
            <div className="slider-control">
                <span className="range-end">{parameter.low}</span>
                <input
                    type="range"
                    min={parameter.min}
                    max={parameter.max}
                    step={parameter.step}
                    value={value}
                    onChange={(event) => onChange(Number(event.target.value), historyKey)}
                    onDoubleClick={() => onChange(parameter.value, null)}
                    aria-label={parameter.label}
                />
                <span className="range-end">{parameter.high}</span>
            </div>
        </div>
    );
}

function Card({ title, icon, children, action }) {
    return (
        <section className="property-card">
            <header className="card-header">
                {icon && <span className="card-icon"><Icon name={icon} size={14} /></span>}
                <h3>{title}</h3>
                {action}
            </header>
            <div className="card-body">{children}</div>
        </section>
    );
}

export default function InspectorPanel({ layer, configuration, onConfiguration, onLayer, onAddMask, onMask, onRemoveMask, onShuffleSeed, stats, satmapLabel }) {
    const [maskChoice, setMaskChoice] = useState("coastal");

    if (!layer) {
        return (
            <aside className="panel inspector-panel" aria-label="Inspector">
                <header className="panel-header">
                    <span className="panel-title">Inspector</span>
                    <span className="panel-count">Terrain</span>
                </header>
                <div className="inspector-body">
                    <Card title="Terrain" icon="Mountain">
                        <ParameterSlider
                            parameter={{ label: "Grid resolution", min: 64, max: 512, step: 32, value: 192, unit: "cells", low: "Coarse", high: "Fine", hint: "Cells per side. Finer grids show more detail but solve more slowly." }}
                            value={configuration.resolution}
                            onChange={(value) => onConfiguration({ resolution: value }, "config:resolution")}
                        />
                        <ParameterSlider
                            parameter={{ label: "Map extent", min: 1024, max: 16384, step: 256, value: 4096, unit: "m", low: "Small", high: "Large", hint: "Width of the square map in metres." }}
                            value={configuration.extent}
                            onChange={(value) => onConfiguration({ extent: value }, "config:extent")}
                        />
                        <ParameterSlider
                            parameter={{ label: "Sea level", min: -2000, max: 2000, step: 10, value: 0, unit: "m", low: "Dry", high: "Flooded", hint: "Heights below this are water." }}
                            value={configuration.sea}
                            onChange={(value) => onConfiguration({ sea: value }, "config:sea")}
                        />
                    </Card>
                    {stats && (
                        <Card title="Solver results" icon="Droplets">
                            <dl className="stat-list">
                                <div><dt>Cells</dt><dd>{stats.cells.toLocaleString()}</dd></div>
                                <div><dt>Cell size</dt><dd>{stats.cell.toFixed(1)} m</dd></div>
                                <div><dt>Mean height</dt><dd>{stats.mean.toFixed(1)} m</dd></div>
                                <div><dt>Satmap</dt><dd>{satmapLabel}</dd></div>
                            </dl>
                        </Card>
                    )}
                    <p className="inspector-footer">Select a layer in the stack to edit its generator, solver, or masks. Double-click a slider to reset it.</p>
                </div>
            </aside>
        );
    }

    const family = LayerFamilies[layer.family];
    const variant = VariantSpec(layer.family, layer.kind);
    const kinds = Object.entries(family.table);

    return (
        <aside className="panel inspector-panel" aria-label="Inspector">
            <header className="panel-header">
                <span className="panel-title">Inspector</span>
                <span className="panel-count"><Icon name={FamilyIconName(layer.family)} size={12} /> {family.label}</span>
            </header>
            <div className="inspector-body">
                <Card title="Layer" icon={FamilyIconName(layer.family)}>
                    <div className="row">
                        <div className="row-label"><span>Name</span></div>
                        <input type="text" className="text-input" value={layer.name} maxLength={48} onChange={(event) => onLayer(layer.id, { name: event.target.value }, `name:${layer.id}`)} />
                    </div>
                    <div className="row">
                        <div className="row-label"><span>{family.label} type</span></div>
                        <select value={layer.kind} onChange={(event) => onLayer(layer.id, { kind: event.target.value, params: DefaultsOf(VariantSpec(layer.family, event.target.value).parameters) })}>
                            {kinds.map(([key, spec]) => (
                                <option key={key} value={key}>{spec.label}</option>
                            ))}
                        </select>
                    </div>
                    <div className="row">
                        <div className="row-label"><span>Combine</span></div>
                        <select value={layer.combine} onChange={(event) => onLayer(layer.id, { combine: event.target.value })}>
                            {CombineNames.map((key) => (
                                <option key={key} value={key}>{CombineOperations[key]}</option>
                            ))}
                        </select>
                    </div>
                    <ParameterSlider
                        parameter={{ label: "Opacity", min: 0, max: 1, step: 0.01, value: 1, unit: "", low: "0", high: "100%", hint: "How strongly this layer changes the terrain beneath it." }}
                        value={layer.opacity}
                        onChange={(value, key) => onLayer(layer.id, { opacity: value }, key || `opacity:${layer.id}`)}
                    />
                    <div className="row seed-row">
                        <div className="row-label"><span>Seed</span></div>
                        <div className="seed-control">
                            <input type="number" value={layer.seed} onChange={(event) => onLayer(layer.id, { seed: Math.floor(Number(event.target.value) || 0) })} />
                            <button type="button" className="button" onClick={() => onShuffleSeed(layer.id)} title="New random seed">
                                <Icons.Dices size={14} /> Shuffle
                            </button>
                        </div>
                    </div>
                    <label className="check-row">
                        <input type="checkbox" checked={layer.enabled} onChange={(event) => onLayer(layer.id, { enabled: event.target.checked })} />
                        <span>Layer enabled</span>
                    </label>
                </Card>

                <Card title={variant.label} icon={FamilyIconName(layer.family)}>
                    {variant.hint && <p className="card-hint">{variant.hint}</p>}
                    {variant.parameters.length === 0 && <p className="card-hint">No adjustable parameters.</p>}
                    {variant.parameters.map((parameter) => (
                        <ParameterSlider
                            key={parameter.key}
                            parameter={parameter}
                            value={layer.params[parameter.key]}
                            historyKey={`param:${layer.id}:${parameter.key}`}
                            onChange={(value, key) => onLayer(layer.id, { params: { ...layer.params, [parameter.key]: value } }, key || `param:${layer.id}:${parameter.key}`)}
                        />
                    ))}
                </Card>

                <Card
                    title={`Masks (${layer.masks.length})`}
                    icon="Layers"
                    action={null}
                >
                    <div className="add-row">
                        <select aria-label="Mask type" value={maskChoice} onChange={(event) => setMaskChoice(event.target.value)}>
                            {MaskVariantNames.map((key) => (
                                <option key={key} value={key}>{MaskVariants[key].label}</option>
                            ))}
                        </select>
                        <button type="button" className="button" onClick={() => onAddMask(layer.id, maskChoice)}>
                            <Icons.Plus size={14} /> Add mask
                        </button>
                    </div>
                    {layer.masks.length === 0 && <p className="card-hint">Masks limit where this layer acts. Without masks it applies everywhere.</p>}
                    {layer.masks.map((mask) => {
                        const spec = MaskVariants[mask.kind];
                        return (
                            <div key={mask.id} className={`mask-item${mask.enabled ? "" : " off"}`}>
                                <div className="mask-head">
                                    <span className="card-icon"><Icon name={MaskIconName(mask.kind)} size={13} /></span>
                                    <span className="mask-title" title={spec.hint}>{spec.label}</span>
                                    <button type="button" className={`pill${mask.invert ? " on" : ""}`} onClick={() => onMask(layer.id, mask.id, { invert: !mask.invert })}>Invert</button>
                                    <button type="button" className="icon-button" title={mask.enabled ? "Disable mask" : "Enable mask"} onClick={() => onMask(layer.id, mask.id, { enabled: !mask.enabled })}>
                                        {mask.enabled ? <Icons.Eye size={14} /> : <Icons.EyeOff size={14} />}
                                    </button>
                                    <button type="button" className="icon-button" title="Remove mask" onClick={() => onRemoveMask(layer.id, mask.id)}>
                                        <Icons.X size={14} />
                                    </button>
                                </div>
                                <ParameterSlider
                                    parameter={{ label: "Strength", min: 0, max: 1, step: 0.01, value: 1, low: "Off", high: "Full", hint: "How much the mask gates this layer." }}
                                    value={mask.strength}
                                    onChange={(value, key) => onMask(layer.id, mask.id, { strength: value }, key || `strength:${mask.id}`)}
                                />
                                {spec.parameters.map((parameter) => (
                                    <ParameterSlider
                                        key={parameter.key}
                                        parameter={parameter}
                                        value={mask.params[parameter.key]}
                                        onChange={(value, key) => onMask(layer.id, mask.id, { params: { ...mask.params, [parameter.key]: value } }, key || `mask:${mask.id}:${parameter.key}`)}
                                    />
                                ))}
                            </div>
                        );
                    })}
                </Card>
            </div>
        </aside>
    );
}
