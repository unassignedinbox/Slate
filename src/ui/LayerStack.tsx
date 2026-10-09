// Left rail: the layer stack. Height layers on top, satmap layers beneath,
// both drag-reorderable and maskable.

import { useMemo, useState } from 'react';
import {
  Eye,
  EyeOff,
  GripVertical,
  Plus,
  Sparkles,
  Mountain,
  Waves,
  Layers as LayersIcon,
  Filter,
  Grid2x2Check,
} from 'lucide-react';
import type { HeightLayer, Project, SatLayer } from '../engine/types';
import { EROSIONS, FILTERS, GENERATORS } from '../engine/registry';
import type { ComputeResponse } from '../engine/worker';
import Thumb from './Thumb';

export type Selection =
  | { kind: 'project' }
  | { kind: 'layer'; id: string }
  | { kind: 'sat'; id: string };

interface Props {
  project: Project;
  result: ComputeResponse | null;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  onAddTerrain: () => void;
  onAddSatmap: () => void;
  onToggle: (kind: 'layer' | 'sat', id: string) => void;
  onReorder: (kind: 'layer' | 'sat', from: number, to: number) => void;
  onOpenPresets: () => void;
  onRename: (name: string) => void;
}

const ROLE_ICONS: Record<string, React.ReactNode> = {
  generator: <Sparkles size={13} />,
  filter: <Filter size={13} />,
  erosion: <Waves size={13} />,
};

function labelFor(layer: HeightLayer): string {
  if (layer.role === 'generator') return GENERATORS.find((g) => g.id === layer.generator)?.label ?? 'Generator';
  if (layer.role === 'filter') return FILTERS.find((f) => f.id === layer.filter)?.label ?? 'Filter';
  return EROSIONS.find((e) => e.id === layer.erosion)?.label ?? 'Erosion';
}

export default function LayerStack({
  project,
  result,
  selection,
  onSelect,
  onAddTerrain,
  onAddSatmap,
  onToggle,
  onReorder,
  onOpenPresets,
  onRename,
}: Props) {
  const [drag, setDrag] = useState<{ kind: 'layer' | 'sat'; index: number } | null>(null);
  const [over, setOver] = useState<{ kind: 'layer' | 'sat'; index: number; after: boolean } | null>(null);

  const thumbs = useMemo(() => {
    const map = new Map<string, NonNullable<ComputeResponse['thumbs']>[number]>();
    for (const t of result?.thumbs ?? []) map.set(t.id, t);
    return map;
  }, [result]);

  const satCount = project.satmap.length;
  const activeErosion = project.layers.filter((l) => l.role === 'erosion' && l.enabled !== false).length;

  const move = (kind: 'layer' | 'sat', to: number, after: boolean) => {
    if (!drag || drag.kind !== kind) return;
    const target = after ? to + 1 : to;
    if (target === drag.index || target === drag.index + 1) return;
    onReorder(kind, drag.index, target > drag.index ? target - 1 : target);
    setDrag(null);
    setOver(null);
  };

  const renderLayer = (layer: HeightLayer, index: number, total: number) => {
    const thumb = thumbs.get(layer.id);
    const selected = selection.kind === 'layer' && selection.id === layer.id;
    const disabled = layer.enabled === false;
    const hasMask = layer.mask && layer.mask.type !== 'none';
    const classes = [
      'layer-row',
      selected ? 'selected' : '',
      drag && drag.kind === 'layer' && drag.index === index ? 'dragging' : '',
      over && over.kind === 'layer' && over.index === index ? (over.after ? 'drop-after' : 'drop-before') : '',
      disabled ? 'disabled' : '',
    ]
      .filter(Boolean)
      .join(' ');
    return (
      <li
        key={layer.id}
        className={classes}
        draggable
        onDragStart={() => setDrag({ kind: 'layer', index })}
        onDragEnd={() => {
          setDrag(null);
          setOver(null);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          const rect = e.currentTarget.getBoundingClientRect();
          setOver({ kind: 'layer', index, after: e.clientY > rect.top + rect.height / 2 });
        }}
        onDrop={(e) => {
          e.preventDefault();
          move('layer', index, over?.after ?? false);
        }}
        onClick={() => onSelect({ kind: 'layer', id: layer.id })}
      >
        {thumb ? (
          <Thumb size={thumb.size} data={thumb.data} range={thumb.range} mask={thumb.mask} showMask />
        ) : (
          <span className="thumb thumb-empty" />
        )}
        <div className="layer-main">
          <div className="layer-name">{layer.name}</div>
          <div className="layer-meta">
            <span className="dot">{ROLE_ICONS[layer.role]}</span>
            {labelFor(layer)}
            {layer.role === 'generator' && layer.blend !== 'add' ? ` · ${layer.blend}` : ''}
            {layer.opacity < 0.995 ? ` · ${Math.round(layer.opacity * 100)}%` : ''}
          </div>
        </div>
        {layer.role === 'erosion' ? <span className="badge erosion">erosion</span> : null}
        {hasMask ? <span className="badge mask">mask</span> : null}
        <button
          className="visibility"
          aria-label={disabled ? 'Enable layer' : 'Disable layer'}
          onClick={(e) => {
            e.stopPropagation();
            onToggle('layer', layer.id);
          }}
        >
          {disabled ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
        <span className="row-actions">
          <GripVertical size={14} />
        </span>
        {index === total - 1 ? <span className="stack-edge" /> : null}
      </li>
    );
  };

  const renderSat = (layer: SatLayer, index: number) => {
    const thumb = thumbs.get(layer.id);
    const selected = selection.kind === 'sat' && selection.id === layer.id;
    const disabled = layer.enabled === false;
    const classes = [
      'layer-row',
      selected ? 'selected' : '',
      drag && drag.kind === 'sat' && drag.index === index ? 'dragging' : '',
      over && over.kind === 'sat' && over.index === index ? (over.after ? 'drop-after' : 'drop-before') : '',
      disabled ? 'disabled' : '',
    ]
      .filter(Boolean)
      .join(' ');
    return (
      <li
        key={layer.id}
        className={classes}
        draggable
        onDragStart={() => setDrag({ kind: 'sat', index })}
        onDragEnd={() => {
          setDrag(null);
          setOver(null);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          const rect = e.currentTarget.getBoundingClientRect();
          setOver({ kind: 'sat', index, after: e.clientY > rect.top + rect.height / 2 });
        }}
        onDrop={(e) => {
          e.preventDefault();
          move('sat', index, over?.after ?? false);
        }}
        onClick={() => onSelect({ kind: 'sat', id: layer.id })}
      >
        {thumb && thumb.data instanceof Uint8ClampedArray ? (
          <Thumb size={thumb.size} data={thumb.data} mask={thumb.mask} showMask />
        ) : (
          <span className="thumb thumb-empty" />
        )}
        <div className="layer-main">
          <div className="layer-name">{layer.name}</div>
          <div className="layer-meta">
            <span className="dot" />
            {layer.blend}
            {layer.opacity < 0.995 ? ` · ${Math.round(layer.opacity * 100)}%` : ''}
          </div>
        </div>
        {layer.mask.type !== 'none' ? <span className="badge mask">mask</span> : null}
        <button
          className="visibility"
          aria-label={disabled ? 'Enable layer' : 'Disable layer'}
          onClick={(e) => {
            e.stopPropagation();
            onToggle('sat', layer.id);
          }}
        >
          {disabled ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
        <span className="row-actions">
          <GripVertical size={14} />
        </span>
      </li>
    );
  };

  return (
    <aside className="stack">
      <div className="brand">Slate</div>
      <div className="project-row">
        <button
          className={`object-header ${selection.kind === 'project' ? 'selected-header' : ''}`}
          onClick={() => onSelect({ kind: 'project' })}
        >
          <span className="object-icon" style={{ '--accent': '#b9b9b9' } as React.CSSProperties}>
            <Mountain size={16} />
          </span>
          <span className="object-title">
            <span className="eyebrow">Project</span>
            <input
              className="project-name"
              value={project.name}
              onChange={(e) => onRename(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              aria-label="Project name"
            />
          </span>
        </button>
        <button className="tool-button" onClick={onOpenPresets}>
          <Grid2x2Check size={12} /> Presets
        </button>
      </div>

      <div className="stack-scroll">
        <div className="group-label">
          <span>Height stack</span>
          <span className="group-count">{project.layers.length}</span>
          <span className="spacer" />
          <button className="tool-button" onClick={onAddTerrain} aria-label="Add height layer">
            <Plus size={12} /> Add
          </button>
        </div>
        <ul className="layers">
          {project.layers.map((layer, index) => renderLayer(layer, index, project.layers.length))}
        </ul>

        <div className="group-label" style={{ marginTop: 22 }}>
          <span>Satmap</span>
          <span className="group-count">{satCount}</span>
          <span className="spacer" />
          <button className="tool-button" onClick={onAddSatmap} aria-label="Add satmap layer">
            <Plus size={12} /> Add
          </button>
        </div>
        <ul className="layers">
          {project.satmap.map((layer, index) => renderSat(layer, index))}
        </ul>
        <div className="scroll-hint">
          <LayersIcon size={12} /> {project.layers.length} height · {satCount} colour · {activeErosion} erosion
        </div>
      </div>

      <div className="stack-footer">
        <div className="stat">
          <span>Resolution</span>
          <b>{project.resolution}²</b>
        </div>
        <div className="stat">
          <span>Extent</span>
          <b>
            {(project.extent / 1000).toFixed(1)} km · {(project.extent / project.resolution).toFixed(1)} m/cell
          </b>
        </div>
        <div className="stat">
          <span>Relief</span>
          <b>{project.heightScale} m</b>
        </div>
        <div className="stat">
          <span>Last pass</span>
          <b>{result ? `${result.stats.timeMs} ms` : '…'}</b>
        </div>
      </div>
    </aside>
  );
}
