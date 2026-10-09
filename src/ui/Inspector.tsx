// Right rail: the inspector. Renders a different card set for the project, a
// height layer, or a satmap layer, driven entirely by the engine's schemas.

import { useMemo } from 'react';
import {
  Boxes,
  Compass,
  Dices,
  Droplets,
  Layers,
  Mountain,
  Palette,
  Shuffle,
  Sliders,
  Sparkles,
  Sun,
  Trash2,
  Waves,
  Copy,
  Filter,
} from 'lucide-react';
import type {
  ChannelId,
  ColorBlend,
  HeightBlend,
  HeightLayer,
  Project,
  SatLayer,
} from '../engine/types';
import { CHANNELS, EROSIONS, FILTERS, GENERATORS } from '../engine/registry';
import { defaultParams } from '../engine/params';
import type { ComputeResponse } from '../engine/worker';
import { Card, Dropdown, MaskCard, ParamList, RampEditor, Slider, ToggleRow } from './controls';
import type { ChannelDef } from '../engine/types';
import type { Selection } from './LayerStack';
import { RAMPS } from './ramps';

const BLENDS: { value: HeightBlend; label: string }[] = [
  { value: 'add', label: 'Add' },
  { value: 'subtract', label: 'Subtract' },
  { value: 'max', label: 'Lighten (max)' },
  { value: 'min', label: 'Darken (min)' },
  { value: 'replace', label: 'Replace' },
  { value: 'average', label: 'Average' },
  { value: 'multiply', label: 'Multiply' },
  { value: 'difference', label: 'Difference' },
];

const COLOR_BLENDS: { value: ColorBlend; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'overlay', label: 'Overlay' },
  { value: 'multiply', label: 'Multiply' },
  { value: 'softlight', label: 'Soft light' },
  { value: 'screen', label: 'Screen' },
];

const ROLE_ACCENT: Record<string, string> = {
  generator: '#c89a5b',
  filter: '#8fa8c8',
  erosion: '#8fb3ad',
};


/** Approximate material moved by a layer, from its delta thumbnail. */
function thumbMagnitude(thumb: ComputeResponse['thumbs'][number] | undefined, size: number): number {
  if (!thumb || thumb.data instanceof Uint8ClampedArray) return 0;
  const scale = (size / thumb.size) ** 2;
  let sum = 0;
  for (let i = 0; i < thumb.data.length; i++) sum += Math.abs(thumb.data[i]);
  return sum * scale;
}

export interface InspectorProps {
  project: Project;
  result: ComputeResponse | null;
  selection: Selection;
  onProject: (patch: Partial<Project>) => void;
  onRender: (patch: Partial<Project['render']>) => void;
  onLayer: (id: string, patch: Partial<HeightLayer>) => void;
  onLayerParams: (id: string, key: string, value: number | string | boolean) => void;
  onSat: (id: string, patch: Partial<SatLayer>) => void;
  onDelete: (kind: 'layer' | 'sat', id: string) => void;
  onDuplicate: (kind: 'layer' | 'sat', id: string) => void;
}

export default function Inspector(props: InspectorProps) {
  const { project, result, selection } = props;
  const thumbs = useMemo(() => {
    const map = new Map<string, ComputeResponse['thumbs'][number]>();
    for (const t of result?.thumbs ?? []) map.set(t.id, t);
    return map;
  }, [result]);

  const layer =
    selection.kind === 'layer' ? project.layers.find((l) => l.id === selection.id) ?? null : null;
  const sat = selection.kind === 'sat' ? project.satmap.find((l) => l.id === selection.id) ?? null : null;

  const maskPreview = result?.maskPreview ?? null;

  return (
    <aside className="inspector">
      <div className="inspector-scroll">
        {selection.kind === 'project' || (!layer && !sat) ? (
          <ProjectInspector
            project={project}
            result={result}
            onProject={props.onProject}
            onRender={props.onRender}
          />
        ) : null}

        {layer ? (
          <LayerInspector
            layer={layer}
            index={project.layers.findIndex((l) => l.id === layer.id)}
            moved={thumbMagnitude(thumbs.get(layer.id), project.resolution)}
            maskPreview={maskPreview && maskPreview.id === layer.id ? maskPreview.data : null}
            onLayer={props.onLayer}
            onLayerParams={props.onLayerParams}
            onDelete={() => props.onDelete('layer', layer.id)}
            onDuplicate={() => props.onDuplicate('layer', layer.id)}
          />
        ) : null}

        {sat ? (
          <SatInspector
            sat={sat}
            maskPreview={maskPreview && maskPreview.id === sat.id ? maskPreview.data : null}
            onSat={props.onSat}
            onDelete={() => props.onDelete('sat', sat.id)}
            onDuplicate={() => props.onDuplicate('sat', sat.id)}
          />
        ) : null}
      </div>
      <div className="inspector-footer">
        <span className="eyebrow">Simulation</span>
        <b>{result ? `${result.stats.triangles.toLocaleString()} triangles` : '—'}</b>
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------- project ---- */

function ProjectInspector({
  project,
  result,
  onProject,
  onRender,
}: {
  project: Project;
  result: ComputeResponse | null;
  onProject: (patch: Partial<Project>) => void;
  onRender: (patch: Partial<Project['render']>) => void;
}) {
  return (
    <>
      <header className="object-header">
        <span className="object-icon" style={{ '--accent': '#b9b9b9' } as React.CSSProperties}>
          <Mountain size={20} />
        </span>
        <span className="object-title">
          <span className="eyebrow">Terrain</span>
          {project.name}
        </span>
        <span className="enabled-pill">live</span>
      </header>

      <div className="cards">
        <Card title="Terrain" icon={<Boxes size={13} />} note="The physical size of the world being simulated.">
          <Dropdown
            label="Resolution"
            value={String(project.resolution)}
            options={[
              { value: '256', label: '256 × 256 — draft' },
              { value: '512', label: '512 × 512 — balanced' },
              { value: '1024', label: '1024 × 1024 — final' },
            ]}
            onChange={(v) => onProject({ resolution: Number(v) as Project['resolution'] })}
          />
          <Slider
            label="Extent"
            value={project.extent / 1000}
            min={0.5}
            max={60}
            step={0.1}
            unit="km"
            onChange={(v) => onProject({ extent: Math.round(v * 1000) })}
          />
          <Slider
            label="Height scale"
            value={project.heightScale}
            min={50}
            max={6000}
            step={10}
            unit="m"
            onChange={(v) => onProject({ heightScale: v })}
          />
          <Slider
            label="Sea level"
            value={project.seaLevel}
            min={-0.2}
            max={0.8}
            step={0.005}
            onChange={(v) => onProject({ seaLevel: v })}
            labels={['Dry', 'Flooded']}
          />
          <div className="row-actions" style={{ marginTop: 4 }}>
            <button
              className="tool-button"
              onClick={() => onProject({ seed: Math.floor(Math.random() * 100000) })}
            >
              <Dices size={12} /> Reseed
            </button>
            <input
              className="small-pill"
              type="number"
              value={project.seed}
              onChange={(e) => onProject({ seed: Number(e.target.value) || 0 })}
              aria-label="Seed"
            />
          </div>
        </Card>

        <Card
          title="Measurement"
          icon={<Sliders size={13} />}
          note="What the stack produced on the last pass."
        >
          <div className="stat-grid">
            <div className="metric">
              <span>Min</span>
              <b>{result ? result.stats.minHeight.toFixed(3) : '—'}</b>
            </div>
            <div className="metric">
              <span>Mean</span>
              <b>{result ? result.stats.meanHeight.toFixed(3) : '—'}</b>
            </div>
            <div className="metric">
              <span>Max</span>
              <b>{result ? result.stats.maxHeight.toFixed(3) : '—'}</b>
            </div>
            <div className="metric">
              <span>Under sea</span>
              <b>{result ? `${(result.stats.seaCoverage * 100).toFixed(1)}%` : '—'}</b>
            </div>
          </div>
          {result ? (
            <div className="stat-grid" style={{ marginTop: 12 }}>
              <div className="metric">
                <span>Cut</span>
                <b>{result.stats.cut.toFixed(0)}</b>
              </div>
              <div className="metric">
                <span>Fill</span>
                <b>{result.stats.fill.toFixed(0)}</b>
              </div>
              <div className="metric">
                <span>Moved</span>
                <b>{result.stats.moved.toFixed(0)}</b>
              </div>
              <div className="metric">
                <span>Pass</span>
                <b>{result.stats.timeMs} ms</b>
              </div>
            </div>
          ) : null}
          <p className="muted" style={{ marginTop: 12 }}>
            Cut and fill are the summed height changes made by every layer, in cells; erosion should
            move material, not invent it.
          </p>
        </Card>

        <Card
          title="Sun & render"
          icon={<Sun size={13} />}
          note="Viewport lighting. The simulation itself is independent of the sun."
        >
          <Slider
            label="Sun azimuth"
            value={project.render.sunAzimuth}
            min={0}
            max={360}
            step={1}
            unit="°"
            onChange={(v) => onRender({ sunAzimuth: v })}
          />
          <Slider
            label="Sun elevation"
            value={project.render.sunElevation}
            min={5}
            max={85}
            step={1}
            unit="°"
            onChange={(v) => onRender({ sunElevation: v })}
          />
          <Slider
            label="Shading"
            value={project.render.shading}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => onRender({ shading: v })}
          />
        </Card>

        <Card
          title="Snow & water"
          icon={<Droplets size={13} />}
          note="These feed the simulation: the snowline steers glacial and periglacial passes."
        >
          <Slider
            label="Snowline"
            value={project.render.snowline}
            min={0}
            max={1.2}
            step={0.01}
            onChange={(v) => onRender({ snowline: v })}
          />
          <Slider
            label="Snow amount"
            value={project.render.snowAmount}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => onRender({ snowAmount: v })}
          />
          <Slider
            label="Ambient occlusion"
            value={project.render.occlusion}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => onRender({ occlusion: v })}
          />
        </Card>
      </div>
    </>
  );
}

/* --------------------------------------------------------------- layer ---- */

function LayerInspector({
  layer,
  index,
  moved,
  maskPreview,
  onLayer,
  onLayerParams,
  onDelete,
  onDuplicate,
}: {
  layer: HeightLayer;
  index: number;
  moved: number;
  maskPreview: Float32Array | null;
  onLayer: (id: string, patch: Partial<HeightLayer>) => void;
  onLayerParams: (id: string, key: string, value: number | string | boolean) => void;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  const accent = ROLE_ACCENT[layer.role];
  const isGenerator = layer.role === 'generator';
  const isErosion = layer.role === 'erosion';

  const defs = isGenerator
    ? GENERATORS
    : isErosion
      ? EROSIONS
      : FILTERS;
  const key = isGenerator ? 'generator' : isErosion ? 'erosion' : 'filter';
  const current =
    layer.role === 'generator' ? layer.generator : layer.role === 'erosion' ? layer.erosion : layer.filter;
  const def = defs.find((d) => d.id === current) ?? defs[0];
  const icon = isGenerator ? <Sparkles size={13} /> : isErosion ? <Waves size={13} /> : <Filter size={13} />;

  const swapType = (id: string) => {
    const next = defs.find((d) => d.id === id);
    if (!next) return;
    onLayer(layer.id, {
      [key]: id,
      params: defaultParams(next.params),
      name: layer.name === def.label ? next.label : layer.name,
    } as Partial<HeightLayer>);
  };

  const title = isErosion ? 'Erosion' : isGenerator ? 'Generator' : 'Filter';

  return (
    <>
      <header className="object-header">
        <span className="object-icon" style={{ '--accent': accent } as React.CSSProperties}>
          {isErosion ? <Waves size={20} /> : isGenerator ? <Sparkles size={20} /> : <Filter size={20} />}
        </span>
        <span className="object-title">
          <span className="eyebrow">
            {title} · layer {index + 1}
          </span>
          <input
            className="object-name"
            value={layer.name}
            aria-label="Layer name"
            onChange={(e) => onLayer(layer.id, { name: e.target.value } as Partial<HeightLayer>)}
          />
        </span>
        <span
          className={`enabled-pill ${layer.enabled === false ? 'disabled' : ''}`}
          role="switch"
          aria-checked={layer.enabled !== false}
          tabIndex={0}
          onClick={() => onLayer(layer.id, { enabled: layer.enabled === false } as Partial<HeightLayer>)}
        >
          {layer.enabled === false ? 'off' : 'on'}
        </span>
      </header>

      <div className="cards">
        <Card title={`${title} type`} icon={icon} accent={accent} note={def.blurb}>
          <Dropdown
            label={isErosion ? 'Erosion type' : isGenerator ? 'Noise type' : 'Filter type'}
            value={current}
            options={defs.map((d) => ({ value: d.id, label: d.label }))}
            onChange={swapType}
          />
          <div style={{ marginTop: 12 }}>
            <ParamList defs={def.params} values={layer.params} onChange={(k, v) => onLayerParams(layer.id, k, v)} accent={accent} />
          </div>
        </Card>

        {isErosion ? (
          <Card title="Erosion budget" icon={<Sliders size={13} />} accent={accent} note="How much work this pass did on the last run.">
            <div className="stat-grid">
              <div className="metric">
                <span>Material moved</span>
                <b>{moved.toFixed(0)}</b>
              </div>
            </div>
            <p className="muted" style={{ marginTop: 10 }}>
              Erosion passes read the terrain as it arrives: order matters, and a pass sitting under
              a generator will be buried by it.
            </p>
          </Card>
        ) : (
          <Card title="Output range" icon={<Sliders size={13} />} accent={accent} note="Remap the layer's 0–1 value before it is blended.">
            <Slider
              label="Low"
              value={layer.low}
              min={-1}
              max={1}
              step={0.01}
              accent={accent}
              onChange={(v) => onLayer(layer.id, { low: Math.min(v, layer.high - 0.01) } as Partial<HeightLayer>)}
            />
            <Slider
              label="High"
              value={layer.high}
              min={0}
              max={2}
              step={0.01}
              accent={accent}
              onChange={(v) => onLayer(layer.id, { high: Math.max(v, layer.low + 0.01) } as Partial<HeightLayer>)}
            />
          </Card>
        )}

        <Card title="Blend" icon={<Layers size={13} />} accent={accent}>
          {isGenerator ? (
            <Dropdown
              label="Mode"
              value={layer.blend ?? 'add'}
              options={BLENDS}
              onChange={(v) => onLayer(layer.id, { blend: v as HeightBlend } as Partial<HeightLayer>)}
            />
          ) : null}
          <Slider
            label={isErosion ? 'Rate' : 'Strength'}
            value={layer.opacity}
            min={0}
            max={isErosion ? 3 : 1}
            step={0.01}
            accent={accent}
            labels={['Off', isErosion ? '3×' : 'Full']}
            onChange={(v) => onLayer(layer.id, { opacity: v } as Partial<HeightLayer>)}
          />
        </Card>

        <MaskCard
          mask={layer.mask}
          accent={accent}
          preview={maskPreview}
          onChange={(mask) => onLayer(layer.id, { mask } as Partial<HeightLayer>)}
        />

        <div className="row-actions" style={{ padding: '4px 2px 24px' }}>
          <button className="tool-button" onClick={onDuplicate}>
            <Copy size={12} /> Duplicate
          </button>
          <span className="spacer" />
          <button className="icon-button danger" onClick={onDelete} aria-label="Delete layer">
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </>
  );
}

/* ----------------------------------------------------------------- sat ---- */

function groupOf(channel: ChannelId): string {
  return CHANNELS.find((c: ChannelDef) => c.id === channel)?.group ?? 'Elevation';
}

function SatInspector({
  sat,
  maskPreview,
  onSat,
  onDelete,
  onDuplicate,
}: {
  sat: SatLayer;
  maskPreview: Float32Array | null;
  onSat: (id: string, patch: Partial<SatLayer>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  const accent = '#c89a5b';
  const set = (patch: Partial<SatLayer>) => onSat(sat.id, patch);
  const channelDef = CHANNELS.find((c: ChannelDef) => c.id === sat.channel);
  const groups = [...new Set(CHANNELS.map((c: ChannelDef) => c.group))];

  return (
    <>
      <header className="object-header">
        <span className="object-icon" style={{ '--accent': accent } as React.CSSProperties}>
          <Palette size={20} />
        </span>
        <span className="object-title">
          <span className="eyebrow">Satmap layer</span>
          <input
            className="object-name"
            value={sat.name}
            aria-label="Layer name"
            onChange={(e) => set({ name: e.target.value })}
          />
        </span>
        <span
          className={`enabled-pill ${sat.enabled === false ? 'disabled' : ''}`}
          role="switch"
          aria-checked={sat.enabled !== false}
          tabIndex={0}
          onClick={() => set({ enabled: sat.enabled === false })}
        >
          {sat.enabled === false ? 'off' : 'on'}
        </span>
      </header>

      <div className="cards">
        <Card title="Terrain attribute" icon={<Compass size={13} />} accent={accent} note={channelDef?.blurb}>
          <div className="field">
            <div className="field-head">
              <span>Channel</span>
            </div>
            <select
              className="select"
              value={sat.channel}
              onChange={(e) => set({ channel: e.target.value as ChannelId })}
              aria-label="Channel"
            >
              {groups.map((group) => {
                const items = CHANNELS.filter((c: ChannelDef) => c.group === group);
                if (!items.length) return null;
                return (
                  <optgroup key={group} label={group}>
                    {items.map((c: ChannelDef) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
          </div>
          <p className="muted" style={{ marginTop: 10 }}>
            {groupOf(sat.channel)} channel — painted wherever the mask allows, bottom layer first.
          </p>
          <div className="row-actions" style={{ marginTop: 8 }}>
            <button
              className="tool-button"
              onClick={() =>
                set({
                  ramp: (RAMPS[Math.floor(Math.random() * RAMPS.length)].stops ?? []).map((s) => ({ ...s })),
                })
              }
            >
              <Shuffle size={12} /> Random ramp
            </button>
          </div>
        </Card>

        <Card title="Colour ramp" icon={<Palette size={13} />} accent={accent} note="Sampled across the channel's 0–1 range.">
          <RampEditor ramp={sat.ramp} onChange={(ramp) => set({ ramp })} />
          <div className="preset-swatches">
            {RAMPS.map((r) => (
              <button
                key={r.name}
                className="swatch-button"
                title={r.name}
                aria-label={`Apply ${r.name} ramp`}
                onClick={() => set({ ramp: r.stops.map((s) => ({ ...s })) })}
                style={{
                  background: `linear-gradient(90deg, ${r.stops
                    .map((s) => `${s.color} ${(s.at * 100).toFixed(0)}%`)
                    .join(', ')})`,
                }}
              />
            ))}
          </div>
        </Card>

        <Card title="Response" icon={<Sliders size={13} />} accent={accent}>
          <Slider label="Black point" value={sat.min} min={0} max={1} step={0.01} accent={accent} onChange={(v) => set({ min: Math.min(v, sat.max - 0.01) })} />
          <Slider label="White point" value={sat.max} min={0} max={1} step={0.01} accent={accent} onChange={(v) => set({ max: Math.max(v, sat.min + 0.01) })} />
          <Slider label="Gamma" value={sat.gamma} min={0.25} max={3} step={0.01} accent={accent} onChange={(v) => set({ gamma: v })} />
          <ToggleRow label="Invert channel" value={sat.invert} onChange={(v) => set({ invert: v })} />
        </Card>

        <Card title="Break-up" icon={<Sparkles size={13} />} accent={accent} note="Stops satmaps from looking painted on.">
          <Slider label="Detail mix" value={sat.detail} min={0} max={1} step={0.01} accent={accent} onChange={(v) => set({ detail: v })} />
          <Slider label="Detail scale" value={sat.detailScale} min={2} max={200} step={1} accent={accent} onChange={(v) => set({ detailScale: v })} />
          <Slider label="Grain" value={sat.jitter} min={0} max={1} step={0.01} accent={accent} onChange={(v) => set({ jitter: v })} />
          <Slider
            label="Slope falloff"
            value={sat.slopeBlend}
            min={0}
            max={1}
            step={0.01}
            accent={accent}
            labels={['Everywhere', 'Flatter only']}
            onChange={(v) => set({ slopeBlend: v })}
          />
        </Card>

        <Card title="Blend" icon={<Layers size={13} />} accent={accent}>
          <Dropdown label="Mode" value={sat.blend} options={COLOR_BLENDS} onChange={(v) => set({ blend: v as ColorBlend })} />
          <Slider label="Opacity" value={sat.opacity} min={0} max={1} step={0.01} accent={accent} onChange={(v) => set({ opacity: v })} />
        </Card>

        <MaskCard mask={sat.mask} accent={accent} preview={maskPreview} onChange={(mask) => set({ mask })} />

        <div className="row-actions" style={{ padding: '4px 2px 24px' }}>
          <button className="tool-button" onClick={onDuplicate}>
            <Copy size={12} /> Duplicate
          </button>
          <span className="spacer" />
          <button className="icon-button danger" onClick={onDelete} aria-label="Delete layer">
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </>
  );
}
