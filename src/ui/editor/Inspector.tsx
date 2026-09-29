import React, { useMemo, useState } from 'react';
import { useStore } from '../../state/store';
import { getNodeDef, type ParamDef } from '../../core/graph/types';
import { Icon } from '../icons';
import { Field, NumberSlider, Select, Toggle, fmt } from './controls';
import { SATMAPS, lutCSS } from '../../core/nodes/texturing';

const RES_OPTIONS = [256, 512, 768, 1024, 1536, 2048, 4096];
const VOL_OPTIONS = [48, 64, 96, 128, 160, 192, 256];

function ParamRow({ nodeId, def, params }: { nodeId: string; def: ParamDef; params: Record<string, any> }) {
  const setParam = useStore((s) => s.setParam);
  const v = params[def.id];

  if (def.when && !def.when(params)) return null;

  switch (def.kind) {
    case 'bool':
      return (
        <div className="check-row">
          <span className="field-label" title={def.info}>{def.label}</span>
          <Toggle on={!!v} onChange={(nv) => setParam(nodeId, def.id, nv)} />
        </div>
      );
    case 'enum': {
      const isSatmap = def.id === 'preset' && SATMAPS.some((s) => s.id === v);
      return (
        <Field label={def.label} info={def.info}>
          <Select value={String(v)} options={def.options ?? []} onChange={(nv) => setParam(nodeId, def.id, nv)} />
          {isSatmap && (
            <div
              className="gradient-preview"
              style={{ background: lutCSS(SATMAPS.find((s) => s.id === v)!.stops, !!params.reverse) }}
            />
          )}
        </Field>
      );
    }
    case 'seed':
      return (
        <Field label={def.label} value={String(v)} info={def.info}>
          <div style={{ display: 'flex', gap: 6 }}>
            <div style={{ flex: 1 }}>
              <NumberSlider
                value={Number(v) || 0}
                min={0}
                max={9999}
                step={1}
                onChange={(nv) => setParam(nodeId, def.id, Math.round(nv))}
              />
            </div>
            <button
              className="iconbtn sq"
              style={{ width: 26, height: 22, border: '1px solid var(--line)', background: 'var(--bg-input)' }}
              title="Randomise"
              onClick={() => setParam(nodeId, def.id, Math.floor(Math.random() * 9999))}
            >
              <Icon name="refresh" size={12} />
            </button>
          </div>
        </Field>
      );
    case 'int':
      return (
        <Field label={def.label} value={String(Math.round(Number(v)))} info={def.info}>
          <NumberSlider
            value={Number(v)}
            min={def.min ?? 0}
            max={def.max ?? 100}
            step={1}
            curve={def.curve}
            onChange={(nv) => setParam(nodeId, def.id, Math.round(nv))}
          />
        </Field>
      );
    case 'angle':
      return (
        <Field label={def.label} value={`${Math.round(Number(v))}°`} info={def.info}>
          <NumberSlider
            value={Number(v)}
            min={def.min ?? -180}
            max={def.max ?? 180}
            step={def.step ?? 1}
            onChange={(nv) => setParam(nodeId, def.id, nv)}
          />
        </Field>
      );
    default:
      return (
        <Field label={def.label} value={fmt(Number(v), def.step ?? 0.01, def.unit)} info={def.info}>
          <NumberSlider
            value={Number(v)}
            min={def.min ?? 0}
            max={def.max ?? 1}
            step={def.step ?? 0.01}
            curve={def.curve}
            onChange={(nv) => setParam(nodeId, def.id, nv)}
          />
        </Field>
      );
  }
}

function ProjectPanel() {
  const settings = useStore((s) => s.doc.settings);
  const setSettings = useStore((s) => s.setSettings);
  const issues = useStore((s) => s.issues);
  const buildMs = useStore((s) => s.buildMs);

  const cell = settings.worldSize / settings.resolution;
  const memHF = ((settings.resolution ** 2 * 4) / 1048576).toFixed(1);
  const memVol = ((settings.volumeResolution ** 3 * 4) / 1048576).toFixed(1);

  return (
    <>
      <div className="insp-group">Build</div>
      <Field
        label="Heightfield Resolution"
        value={`${settings.resolution}²`}
        info={`${cell.toFixed(1)} m per texel · ${memHF} MB per field. Erosion detail is bounded by this — below 512² channels and cliff edges smear.`}
      >
        <Select
          value={String(settings.resolution)}
          options={RES_OPTIONS.map((r) => ({ value: String(r), label: `${r} × ${r}` }))}
          onChange={(v) => setSettings({ resolution: Number(v) })}
        />
      </Field>
      <Field
        label="Cave Volume Resolution"
        value={`${settings.volumeResolution}³`}
        info={`${memVol} MB. Only cave walls live here — the terrain surface stays at full heightfield resolution.`}
      >
        <Select
          value={String(settings.volumeResolution)}
          options={VOL_OPTIONS.map((r) => ({ value: String(r), label: `${r}³` }))}
          onChange={(v) => setSettings({ volumeResolution: Number(v) })}
        />
      </Field>
      <Field label="Terrain Size" value={`${(settings.worldSize / 1000).toFixed(2)} km`} info="Physical footprint. Erosion rates are in metres, so this changes how aggressive erosion looks.">
        <NumberSlider value={settings.worldSize} min={256} max={32768} step={64} curve={2} onChange={(v) => setSettings({ worldSize: Math.round(v) })} />
      </Field>
      <Field label="Height Scale" value={`${Math.round(settings.heightScale)} m`}>
        <NumberSlider value={settings.heightScale} min={20} max={6000} step={10} curve={2} onChange={(v) => setSettings({ heightScale: Math.round(v) })} />
      </Field>
      <Field label="Seed" value={String(settings.seed)}>
        <div style={{ display: 'flex', gap: 6 }}>
          <div style={{ flex: 1 }}>
            <NumberSlider value={settings.seed} min={0} max={9999} step={1} onChange={(v) => setSettings({ seed: Math.round(v) })} />
          </div>
          <button
            className="iconbtn sq"
            style={{ width: 26, height: 22, border: '1px solid var(--line)', background: 'var(--bg-input)' }}
            title="Randomise"
            onClick={() => setSettings({ seed: Math.floor(Math.random() * 9999) })}
          >
            <Icon name="refresh" size={12} />
          </button>
        </div>
      </Field>

      <div className="insp-group">Build Log</div>
      {buildMs > 0 && (
        <div className="issue-item" style={{ color: 'var(--txt-3)' }}>
          Last build {buildMs < 1000 ? `${Math.round(buildMs)} ms` : `${(buildMs / 1000).toFixed(2)} s`}
        </div>
      )}
      {issues.length === 0 && <div className="hint">No warnings. Select a node to edit its parameters.</div>}
      {issues.map((it, i) => (
        <div key={i} className={`issue-item ${it.severity}`}>
          <Icon name="alert" size={12} />
          <span>
            {it.nodeTitle && <span className="who">{it.nodeTitle}: </span>}
            {it.message}
          </span>
        </div>
      ))}
    </>
  );
}

export function Inspector({ onClose }: { onClose(): void }) {
  const selection = useStore((s) => s.selection);
  const nodes = useStore((s) => s.doc.nodes);
  const issues = useStore((s) => s.issues);
  const pinned = useStore((s) => s.pinned);
  const pin = useStore((s) => s.pin);
  const renameNode = useStore((s) => s.renameNode);
  const [renaming, setRenaming] = useState(false);

  const node = selection.length === 1 ? nodes.find((n) => n.id === selection[0]) : undefined;
  const def = node ? getNodeDef(node.type) : undefined;

  const groups = useMemo(() => {
    if (!def) return [];
    const m = new Map<string, ParamDef[]>();
    for (const p of def.params) {
      const g = p.group ?? '';
      if (!m.has(g)) m.set(g, []);
      m.get(g)!.push(p);
    }
    return [...m.entries()];
  }, [def]);

  const nodeIssues = node ? issues.filter((i) => i.nodeId === node.id) : [];

  return (
    <div className="inspector">
      <div className="insp-head">
        <div className="node-glyph" style={{ width: 26, height: 26, borderRadius: 8 }}>
          <Icon name={def?.icon ?? 'sliders'} size={14} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          {renaming && node ? (
            <input
              className="text-input"
              autoFocus
              defaultValue={node.title ?? def?.title ?? ''}
              onBlur={(e) => { renameNode(node.id, e.target.value.trim()); setRenaming(false); }}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRenaming(false); }}
            />
          ) : (
            <>
              <div className="node-title" onDoubleClick={() => node && setRenaming(true)}>
                {node ? node.title ?? def?.title ?? node.type : 'Project'}
              </div>
              <div className="node-sub">{node ? def?.subtitle : 'Global build settings'}</div>
            </>
          )}
        </div>
        {node && (
          <button
            className={`iconbtn${pinned === node.id ? ' accent on' : ''}`}
            title="Preview this node in the viewport"
            onClick={() => pin(pinned === node.id ? null : node.id)}
          >
            <Icon name="eye" size={14} />
          </button>
        )}
        <button className="iconbtn" title="Close" onClick={onClose}><Icon name="x" size={14} /></button>
      </div>

      <div className="insp-body">
        {!node && <ProjectPanel />}
        {node && def && (
          <>
            {nodeIssues.map((it, i) => (
              <div key={i} className={`issue-item ${it.severity}`} style={{ margin: '4px 0' }}>
                <Icon name="alert" size={12} />
                <span>{it.message}</span>
              </div>
            ))}
            {def.minRes && (
              <div className="hint" style={{ paddingBottom: 0 }}>
                Wants ≥ {def.minRes}² build resolution.
              </div>
            )}
            {groups.map(([g, params]) => (
              <React.Fragment key={g || 'main'}>
                {g && <div className="insp-group">{g}</div>}
                {!g && <div style={{ height: 8 }} />}
                {params.map((p) => (
                  <ParamRow key={p.id} nodeId={node.id} def={p} params={node.params} />
                ))}
              </React.Fragment>
            ))}
          </>
        )}
        {selection.length > 1 && (
          <div className="hint">{selection.length} nodes selected. Select a single node to edit parameters.</div>
        )}
      </div>
    </div>
  );
}
