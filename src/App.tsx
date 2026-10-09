// Slate — heightmap landscape editor.
// Left rail: layer stack. Centre: viewport. Right rail: inspector.

import { useCallback, useMemo, useState } from 'react';
import {
  CircleDot,
  Droplets,
  Filter,
  LayoutGrid,
  Mountain,
  Orbit,
  Sparkles,
  Waves,
} from 'lucide-react';
import type {
  ChannelId,
  ErosionLayer,
  FilterLayer,
  GeneratorLayer,
  HeightLayer,
  Project,
  SatLayer,
} from './engine/types';
import { newId } from './engine/types';
import { EROSION_MAP, FILTER_MAP, GENERATOR_MAP } from './engine/registry';
import { defaultParams } from './engine/params';
import { PRESETS, buildPreset } from './engine/presets';
import { clearCaches, defaultSatLayer } from './engine/pipeline';
import { useEngine } from './engine/useEngine';
import { CHANNELS, EROSION_GROUPS, EROSIONS, FILTERS, GENERATORS } from './engine/registry';
import type { ErosionDef } from './engine/registry';

function erosionGroup(id: string): string {
  for (const group of EROSION_GROUPS)
    if (group.items.some((e) => e.id === id)) return group.label.toLowerCase();
  return 'erosion';
}
import LayerStack from './ui/LayerStack';
import type { Selection } from './ui/LayerStack';
import Inspector from './ui/Inspector';
import Viewport from './ui/Viewport';
import HeightmapView from './ui/HeightmapView';
import PickerModal from './ui/PickerModal';
import type { PickerItem } from './ui/PickerModal';
import PresetBrowser from './ui/PresetBrowser';
import { rampForChannel } from './ui/ramps';

type Modal = { kind: 'terrain' } | { kind: 'satmap' } | { kind: 'presets' } | null;
type View = '3d' | '2d';
type Mode2D = 'height' | 'satmap' | 'shaded' | 'channel';

export default function App() {
  const [project, setProject] = useState<Project>(() => buildPreset('canyons'));
  const [selection, setSelection] = useState<Selection>({ kind: 'project' });
  const [view, setView] = useState<View>('3d');
  const [mode2d, setMode2d] = useState<Mode2D>('height');
  const [channel, setChannel] = useState<ChannelId>('flow');
  const [contours, setContours] = useState(false);
  const [colour3d, setColour3d] = useState<'satmap' | 'height'>('satmap');
  const [modal, setModal] = useState<Modal>(null);

  const previewChannel: ChannelId | null = view === '2d' && mode2d === 'channel' ? channel : null;
  const maskPreviewId =
    selection.kind === 'layer' || selection.kind === 'sat' ? selection.id : null;
  const { result, busy, error } = useEngine(project, previewChannel, maskPreviewId);

  const selectedLayerId = selection.kind === 'layer' ? selection.id : null;

  /* ---------------------------------------------------------- mutations -- */

  const patchProject = useCallback((patch: Partial<Project>) => {
    setProject((p) => ({ ...p, ...patch }));
  }, []);

  const patchRender = useCallback((patch: Partial<Project['render']>) => {
    setProject((p) => ({ ...p, render: { ...p.render, ...patch } }));
  }, []);

  const mapLayer = useCallback((id: string, fn: (layer: HeightLayer) => HeightLayer) => {
    setProject((p) => ({ ...p, layers: p.layers.map((l) => (l.id === id ? fn(l) : l)) }));
  }, []);

  const onLayer = useCallback(
    (id: string, patch: Partial<HeightLayer>) => {
      mapLayer(id, (l) => ({ ...l, ...patch }) as HeightLayer);
    },
    [mapLayer],
  );

  const onLayerParams = useCallback(
    (id: string, key: string, value: number | string | boolean) => {
      mapLayer(id, (l) => {
        if (l.role === 'erosion' || l.role === 'generator' || l.role === 'filter') {
          return { ...l, params: { ...l.params, [key]: value } } as HeightLayer;
        }
        return l;
      });
    },
    [mapLayer],
  );

  const onSat = useCallback((id: string, patch: Partial<SatLayer>) => {
    setProject((p) => ({ ...p, satmap: p.satmap.map((l) => (l.id === id ? { ...l, ...patch } : l)) }));
  }, []);

  const onToggle = useCallback((kind: 'layer' | 'sat', id: string) => {
    if (kind === 'layer') {
      setProject((p) => ({
        ...p,
        layers: p.layers.map((l) => (l.id === id ? { ...l, enabled: l.enabled === false } : l)),
      }));
    } else {
      setProject((p) => ({
        ...p,
        satmap: p.satmap.map((l) => (l.id === id ? { ...l, enabled: l.enabled === false } : l)),
      }));
    }
  }, []);

  const onReorder = useCallback((kind: 'layer' | 'sat', from: number, to: number) => {
    setProject((p) => {
      if (kind === 'layer') {
        const next = p.layers.slice();
        const [moved] = next.splice(from, 1);
        if (moved) next.splice(to, 0, moved);
        return { ...p, layers: next };
      }
      const next = p.satmap.slice();
      const [moved] = next.splice(from, 1);
      if (moved) next.splice(to, 0, moved);
      return { ...p, satmap: next };
    });
  }, []);

  const onDelete = useCallback(
    (kind: 'layer' | 'sat', id: string) => {
      setProject((p) =>
        kind === 'layer'
          ? { ...p, layers: p.layers.filter((l) => l.id !== id) }
          : { ...p, satmap: p.satmap.filter((l) => l.id !== id) },
      );
      setSelection({ kind: 'project' });
    },
    [],
  );

  const onDuplicate = useCallback((kind: 'layer' | 'sat', id: string) => {
    setProject((p) => {
      if (kind === 'layer') {
        const index = p.layers.findIndex((l) => l.id === id);
        if (index < 0) return p;
        const copy = JSON.parse(JSON.stringify(p.layers[index])) as HeightLayer;
        copy.id = newId('layer');
        copy.name = `${p.layers[index].name} copy`;
        const next = p.layers.slice();
        next.splice(index + 1, 0, copy);
        return { ...p, layers: next };
      }
      const index = p.satmap.findIndex((l) => l.id === id);
      if (index < 0) return p;
      const copy = JSON.parse(JSON.stringify(p.satmap[index])) as SatLayer;
      copy.id = newId('sat');
      copy.name = `${p.satmap[index].name} copy`;
      const next = p.satmap.slice();
      next.splice(index + 1, 0, copy);
      return { ...p, satmap: next };
    });
  }, []);

  /* ------------------------------------------------------------- adding -- */

  const insertIndex = useMemo(() => {
    if (!selectedLayerId) return project.layers.length;
    const index = project.layers.findIndex((l) => l.id === selectedLayerId);
    return index < 0 ? project.layers.length : index + 1;
  }, [project.layers, selectedLayerId]);

  const addHeightLayer = (kind: 'generator' | 'filter' | 'erosion', type: string) => {
    const id = newId('layer');
    let layer: HeightLayer;
    if (kind === 'generator') {
      const def = GENERATOR_MAP[type];
      layer = {
        id,
        name: def ? def.label : 'Generator',
        role: 'generator',
        generator: type,
        params: defaultParams(def ? def.params : []),
        enabled: true,
        opacity: 1,
        low: 0,
        high: 1,
        blend: 'add',
        mask: { type: 'none', params: {}, invert: false, falloff: 0.35, strength: 1 },
      } as GeneratorLayer;
    } else if (kind === 'erosion') {
      const def = EROSION_MAP[type];
      layer = {
        id,
        name: def ? def.label : 'Erosion',
        role: 'erosion',
        erosion: type,
        params: defaultParams(def ? def.params : []),
        enabled: true,
        opacity: 1,
        low: 0,
        high: 1,
        mask: { type: 'none', params: {}, invert: false, falloff: 0.35, strength: 1 },
      } as ErosionLayer;
    } else {
      const def = FILTER_MAP[type];
      layer = {
        id,
        name: def ? def.label : 'Filter',
        role: 'filter',
        filter: type,
        params: defaultParams(def ? def.params : []),
        enabled: true,
        opacity: 1,
        low: 0,
        high: 1,
        mask: { type: 'none', params: {}, invert: false, falloff: 0.35, strength: 1 },
      } as FilterLayer;
    }
    setProject((p) => {
      const next = p.layers.slice();
      next.splice(Math.min(insertIndex, next.length), 0, layer);
      return { ...p, layers: next };
    });
    setSelection({ kind: 'layer', id });
    setModal(null);
  };

  const addSatLayer = (channelId: ChannelId) => {
    const def = CHANNELS.find((c) => c.id === channelId);
    const layer = defaultSatLayer({
      channel: channelId,
      name: def ? def.label : 'Surface',
      ramp: rampForChannel(channelId),
    });
    setProject((p) => ({ ...p, satmap: [...p.satmap, layer] }));
    setSelection({ kind: 'sat', id: layer.id });
    setModal(null);
  };

  const applyPreset = (preset: (typeof PRESETS)[number]) => {
    clearCaches();
    setProject(buildPreset(preset.id));
    setSelection({ kind: 'project' });
    setModal(null);
  };

  /* -------------------------------------------------------------- items -- */

  const terrainItems: PickerItem[] = [
    ...GENERATORS.map((g) => ({
      id: `generator:${g.id}`,
      label: g.label,
      blurb: g.blurb,
      tags: ['procedural'],
      category: 'Generators',
      glyph: <Sparkles size={14} />,
    })),
    ...FILTERS.map((f) => ({
      id: `filter:${f.id}`,
      label: f.label,
      blurb: f.blurb,
      tags: ['sculpt'],
      category: 'Filters',
      glyph: <Filter size={14} />,
    })),
    ...EROSIONS.map((e: ErosionDef) => ({
      id: `erosion:${e.id}`,
      label: e.label,
      blurb: e.blurb,
      tags: [erosionGroup(e.id)],
      category: 'Erosion',
      glyph: <Waves size={14} />,
    })),
  ];

  const satItems: PickerItem[] = CHANNELS.map((c) => ({
    id: c.id,
    label: c.label,
    blurb: c.blurb,
    tags: [c.group],
    category: c.group,
    glyph: <Droplets size={14} />,
  }));

  /* --------------------------------------------------------------- view -- */

  return (
    <div className="shell">
      <LayerStack
        project={project}
        result={result}
        selection={selection}
        onSelect={setSelection}
        onAddTerrain={() => setModal({ kind: 'terrain' })}
        onAddSatmap={() => setModal({ kind: 'satmap' })}
        onToggle={onToggle}
        onReorder={onReorder}
        onOpenPresets={() => setModal({ kind: 'presets' })}
        onRename={(name) => patchProject({ name })}
      />

      <main className="stage">
        <div className="stage-toolbar">
          <div className="segmented">
            <button className={view === '3d' ? 'active' : ''} onClick={() => setView('3d')}>
              <Orbit size={13} /> 3D
            </button>
            <button className={view === '2d' ? 'active' : ''} onClick={() => setView('2d')}>
              <LayoutGrid size={13} /> 2D
            </button>
          </div>

          {view === '2d' ? (
            <>
              <div className="segmented">
                {(['height', 'satmap', 'shaded', 'channel'] as Mode2D[]).map((m) => (
                  <button key={m} className={mode2d === m ? 'active' : ''} onClick={() => setMode2d(m)}>
                    {m === 'shaded' ? 'relief' : m}
                  </button>
                ))}
              </div>
              <button
                className={`tool-button ${contours ? 'on' : ''}`}
                onClick={() => setContours((v) => !v)}
              >
                <CircleDot size={12} /> Contours
              </button>
            </>
          ) : (
            <button
              className="tool-button"
              onClick={() => setColour3d((c) => (c === 'satmap' ? 'height' : 'satmap'))}
            >
              <Mountain size={12} /> {colour3d === 'satmap' ? 'Satmap colours' : 'Height colours'}
            </button>
          )}

          <span className="spacer" />
          {error ? <span className="stage-error">{error}</span> : null}
          <span className="stage-status">
            {busy ? (
              <span className="stage-busy">
                <span className="spin" /> simulating
              </span>
            ) : result ? (
              <>
                <b>{project.resolution}²</b> · {(project.extent / 1000).toFixed(1)} km ·{' '}
                {project.heightScale} m relief · {result.stats.timeMs} ms
              </>
            ) : null}
          </span>
        </div>

        {view === '3d' ? (
          <Viewport project={project} result={result} colour={colour3d} />
        ) : (
          <HeightmapView
            project={project}
            result={result}
            mode={mode2d}
            channel={channel}
            contours={contours}
            onChannel={setChannel}
          />
        )}
      </main>

      <Inspector
        project={project}
        result={result}
        selection={selection}
        onProject={patchProject}
        onRender={patchRender}
        onLayer={onLayer}
        onLayerParams={onLayerParams}
        onSat={onSat}
        onDelete={onDelete}
        onDuplicate={onDuplicate}
      />

      {modal?.kind === 'terrain' ? (
        <PickerModal
          title="Add height layer"
          items={terrainItems}
          onPick={(id) => {
            const [kind, type] = id.split(':');
            addHeightLayer(kind as 'generator' | 'filter' | 'erosion', type);
          }}
          onClose={() => setModal(null)}
        />
      ) : null}

      {modal?.kind === 'satmap' ? (
        <PickerModal
          title="Add satmap layer"
          items={satItems}
          onPick={(id) => addSatLayer(id as ChannelId)}
          onClose={() => setModal(null)}
        />
      ) : null}

      {modal?.kind === 'presets' ? (
        <PresetBrowser onPick={applyPreset} onClose={() => setModal(null)} />
      ) : null}
    </div>
  );
}
