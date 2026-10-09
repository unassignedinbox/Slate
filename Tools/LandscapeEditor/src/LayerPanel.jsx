import { useState } from "react";
import * as Icons from "lucide-react";
import { Mountain, Sparkles, Droplets, Sliders, Waves, Layers, Triangle, Zap, TrendingUp, Circle, ArrowUp, Minus, Route, Wind } from "lucide-react";
import { LayerFamilies, FamilyNames, VariantSpec, FamilyIconName, MaskIconName } from "./LayerSpecification.js";
import { MaskVariants } from "./MaskSpecification.js";

// Named icons only, so the bundle keeps tree-shaking. Names come from the icon fields of the layer and mask specs.
const NamedIcons = { Mountain, Sparkles, Droplets, Sliders, Waves, Layers, Triangle, Zap, TrendingUp, Circle, ArrowUp, Minus, Route, Wind };

export function Icon({ name, size = 15 }) {
    const Component = NamedIcons[name] || Circle;
    return <Component size={size} strokeWidth={1.8} aria-hidden="true" />;
}

// The stack is shown top to bottom, so the layer applied last sits at the top of the list.
export default function LayerPanel({ layers, selectedId, onSelect, onToggle, onMove, onRemove, onDuplicate, onAdd }) {
    const [family, setFamily] = useState("erosion");
    const [kind, setKind] = useState("hydraulic");
    const kinds = Object.entries(LayerFamilies[family].table);

    const chooseFamily = (next) => {
        setFamily(next);
        setKind(Object.keys(LayerFamilies[next].table)[0]);
    };

    return (
        <aside className="panel layer-panel" aria-label="Layer stack">
            <header className="panel-header">
                <span className="panel-title">Layer stack</span>
                <span className="panel-count">{layers.length}</span>
            </header>
            <ol className="layer-list">
                {[...layers].reverse().map((layer, reversedIndex) => {
                    const index = layers.length - 1 - reversedIndex;
                    const spec = VariantSpec(layer.family, layer.kind);
                    const selected = layer.id === selectedId;
                    return (
                        <li key={layer.id} className={`layer-row${selected ? " selected" : ""}${layer.enabled ? "" : " disabled"}`}>
                            <button type="button" className="layer-main" onClick={() => onSelect(layer.id)}>
                                <span className="layer-icon"><Icon name={FamilyIconName(layer.family)} /></span>
                                <span className="layer-text">
                                    <span className="layer-name">{layer.name}</span>
                                    <span className="layer-sub">{spec.label} · {LayerFamilies[layer.family].label}{layer.masks.length ? ` · ${layer.masks.length} mask${layer.masks.length > 1 ? "s" : ""}` : ""}</span>
                                </span>
                            </button>
                            {layer.masks.length > 0 && (
                                <span className="layer-masks" aria-hidden="true">
                                    {layer.masks.map((mask) => (
                                        <span key={mask.id} className={`mask-chip${mask.enabled ? "" : " off"}`} title={MaskVariants[mask.kind].label}>
                                            <Icon name={MaskIconName(mask.kind)} size={11} />
                                        </span>
                                    ))}
                                </span>
                            )}
                            <div className="layer-tools">
                                <button type="button" className="icon-button" title={layer.enabled ? "Disable layer" : "Enable layer"} aria-pressed={layer.enabled} onClick={() => onToggle(layer.id)}>
                                    {layer.enabled ? <Icons.Eye size={14} /> : <Icons.EyeOff size={14} />}
                                </button>
                                <button type="button" className="icon-button" title="Move up" disabled={index === layers.length - 1} onClick={() => onMove(layer.id, 1)}>
                                    <Icons.ChevronUp size={14} />
                                </button>
                                <button type="button" className="icon-button" title="Move down" disabled={index === 0} onClick={() => onMove(layer.id, -1)}>
                                    <Icons.ChevronDown size={14} />
                                </button>
                                <button type="button" className="icon-button" title="Duplicate" onClick={() => onDuplicate(layer.id)}>
                                    <Icons.Copy size={14} />
                                </button>
                                <button type="button" className="icon-button" title="Delete" onClick={() => onRemove(layer.id)}>
                                    <Icons.Trash2 size={14} />
                                </button>
                            </div>
                        </li>
                    );
                })}
            </ol>
            <div className="add-layer">
                <div className="segmented family" role="group" aria-label="Layer family">
                    {FamilyNames.map((name) => (
                        <button key={name} type="button" className={family === name ? "on" : ""} title={LayerFamilies[name].hint} onClick={() => chooseFamily(name)}>
                            <Icon name={FamilyIconName(name)} size={14} />
                            <span>{LayerFamilies[name].label}</span>
                        </button>
                    ))}
                </div>
                <div className="add-row">
                    <select aria-label="Layer kind" value={kind} onChange={(event) => setKind(event.target.value)}>
                        {kinds.map(([key, spec]) => (
                            <option key={key} value={key}>{spec.label}</option>
                        ))}
                    </select>
                    <button type="button" className="button primary" onClick={() => onAdd(family, kind)}>
                        <Icons.Plus size={14} /> Add layer
                    </button>
                </div>
                <p className="family-hint">{LayerFamilies[family].hint}</p>
            </div>
        </aside>
    );
}
