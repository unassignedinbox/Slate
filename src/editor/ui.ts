// DOM panels: toolbar, inspector, status bar, city dialog. Everything is driven by
// Editor state; user input is routed back through Editor methods.
import { Editor, TOOLS, type Tool } from './app';
import {
  PRESETS, PROP_INFO, PropKind, LANE_KINDS, LANE_LABEL, LaneKind, SURFACES, Surface, LANE_RAISE, laneBands, roadWidth, Road,
} from '../core/model';
import { CityOptions, DEFAULT_CITY } from '../core/city';

const esc = (s: unknown): string =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const LANE_COLOR: Record<LaneKind, string> = {
  driving: '#6c6f73',
  bus: '#b8362d',
  bike: '#2f8052',
  parking: '#8a8f96',
  shoulder: '#b7a98f',
  median: '#7fa85a',
  sidewalk: '#e2dfd8',
  pedestrian: '#c3bcab',
};

export function mountUI(ed: Editor): () => void {
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const toolbar = $('tools');
  const panel = $('panel');
  const hint = $('hint');
  const stats = $('stats');
  const dialog = $('city-dialog') as HTMLDialogElement;
  const cityForm = $('city-form') as HTMLFormElement;
  const fileInput = $('file-input') as HTMLInputElement;

  // ---- toolbar -------------------------------------------------------------------
  toolbar.innerHTML = TOOLS.map(
    (t) => `<button class="tool" data-tool="${t.id}" title="${esc(t.label)} (${t.key})">${{ select: '⌖', draw: '✎', prop: '▲', erase: '✕' }[t.id]}<kbd>${t.key}</kbd></button>`,
  ).join('');
  toolbar.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button[data-tool]') as HTMLElement | null;
    if (b) ed.setTool(b.dataset.tool as Tool);
  });

  // ---- top bar -------------------------------------------------------------------
  $('btn-undo').onclick = () => ed.undo();
  $('btn-redo').onclick = () => ed.redo();
  $('btn-frame').onclick = () => ed.frameAll();
  $('btn-city').onclick = () => {
    const f = cityForm.elements as unknown as Record<string, HTMLInputElement>;
    f.blocks.value = String(DEFAULT_CITY.blocks);
    f.blockSize.value = String(DEFAULT_CITY.blockSize);
    f.seed.value = String(DEFAULT_CITY.seed);
    f.ring.checked = f.rail.checked = f.subway.checked = f.footpaths.checked = f.props.checked = true;
    dialog.showModal();
  };
  cityForm.addEventListener('submit', (e) => {
    const submitter = (e as SubmitEvent).submitter as HTMLButtonElement | null;
    if (!submitter || submitter.value !== 'ok') return;
    const f = cityForm.elements as unknown as Record<string, HTMLInputElement>;
    const opts: CityOptions = {
      blocks: clamp(parseInt(f.blocks.value, 10) || DEFAULT_CITY.blocks, 4, 60),
      blockSize: clamp(parseFloat(f.blockSize.value) || DEFAULT_CITY.blockSize, 60, 220),
      seed: parseInt(f.seed.value, 10) || 1,
      ring: f.ring.checked,
      rail: f.rail.checked,
      subway: f.subway.checked,
      footpaths: f.footpaths.checked,
      props: f.props.checked,
    };
    ed.generateCity(opts, true);
    ed.frameAll();
  });
  $('btn-import').onclick = () => fileInput.click();
  fileInput.onchange = async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      ed.importJSON(await file.text());
    } catch (err) {
      alert(`Import failed: ${(err as Error).message}`);
    }
    fileInput.value = '';
  };
  $('btn-export').onclick = () => {
    const blob = new Blob([ed.exportJSON()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'slate-roads.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  $('btn-clear').onclick = () => {
    if (confirm('Delete every road and prop in the network? (Undo is available.)')) ed.clearAll();
  };
  ($('tgl-snap') as HTMLInputElement).onchange = (e) => ed.setSnap((e.target as HTMLInputElement).checked);
  ($('tgl-tunnels') as HTMLInputElement).onchange = (e) => ed.setTunnelVisible((e.target as HTMLInputElement).checked);

  // ---- inspector -----------------------------------------------------------------
  const presetOptions = (current: string): string =>
    Object.entries(PRESETS)
      .map(([k, p]) => `<option value="${k}" ${k === current ? 'selected' : ''}>${esc(p.label)}</option>`)
      .join('');

  const surfaceOptions = (current: Surface): string =>
    SURFACES.map((s) => `<option value="${s}" ${s === current ? 'selected' : ''}>${s}</option>`).join('');

  const renderRoad = (road: Road): string => {
    const bands = laneBands(road.lanes);
    const sel = ed.selPoint;
    const pts = road.points
      .map(
        (p, i) =>
          `<button class="${i === sel ? 'sel' : ''}" data-act="pt" data-idx="${i}">${i + 1}${Math.abs(p.y) > 0.01 ? ` · ${p.y.toFixed(1)}m` : ''}</button>`,
      )
      .join('');
    const selPt = sel !== null ? road.points[sel] : null;
    const rows = road.lanes
      .map((l, i) => {
        const band = bands[i];
        return `<tr>
          <td><span class="swatch" style="background:${LANE_COLOR[l.kind]}"></span>
            <select data-field="laneKind" data-idx="${i}">${LANE_KINDS.map((k) => `<option value="${k}" ${k === l.kind ? 'selected' : ''}>${esc(LANE_LABEL[k])}</option>`).join('')}</select></td>
          <td class="w"><input type="number" step="0.1" min="0" data-field="laneWidth" data-idx="${i}" value="${l.width.toFixed(2)}" title="Width (m) · lane spans ${band.a.toFixed(1)}…${band.b.toFixed(1)} m" /></td>
          <td class="w"><select data-field="laneDir" data-idx="${i}">
            <option value="-1" ${l.dir === -1 ? 'selected' : ''}>◀ back</option>
            <option value="0" ${l.dir === 0 ? 'selected' : ''}>• none</option>
            <option value="1" ${l.dir === 1 ? 'selected' : ''}>▶ fwd</option></select></td>
          <td class="acts"><button data-act="laneUp" data-idx="${i}" title="Move left">◂</button><button data-act="laneDown" data-idx="${i}" title="Move right">▸</button><button data-act="laneDel" data-idx="${i}" title="Remove">✕</button></td>
        </tr>`;
      })
      .join('');
    return `
      <h3>Road</h3>
      <label>Name <input data-field="name" value="${esc(road.name)}" /></label>
      <label>Preset <select data-field="preset">${presetOptions(road.preset)}</select></label>
      <div class="muted" style="margin:-4px 0 8px">Applying a preset replaces the cross-section.</div>
      <div class="row">
        <label style="flex:1">Surface <select data-field="surface">${surfaceOptions(road.surface)}</select></label>
        <label style="flex:1">Speed (km/h) <input type="number" data-field="speedLimit" value="${road.speedLimit}" /></label>
      </div>
      <label class="check"><input type="checkbox" data-field="smooth" ${road.smooth ? 'checked' : ''} /> Smooth curve (Catmull-Rom)</label>
      <div class="kv">
        <b>Category</b><span>${road.category}</span>
        <b>Width</b><span>${roadWidth(road).toFixed(1)} m</span>
        <b>Control points</b><span>${road.points.length}</span>
        <b>Lanes</b><span>${road.lanes.length}</span>
      </div>
      <h3>Control points</h3>
      <div class="points">${pts}</div>
      ${
        selPt
          ? `<label style="margin-top:8px">Point ${sel! + 1} elevation (m)
              <div class="row"><input type="number" step="0.25" data-field="pointY" value="${selPt.y}" />
              <button data-act="removePoint">Remove point</button></div></label>`
          : `<div class="muted" style="margin-top:6px">Click a handle to select a point. Drag to move. PageUp/PageDown changes its height.</div>`
      }
      <h3>Cross-section (left → right)</h3>
      <table class="lanes">${rows}</table>
      <div class="row" style="margin-top:6px">
        <button data-act="addLane">+ Driving lane</button>
        <button data-act="addBus">+ Bus</button>
        <button data-act="addBike">+ Bike</button>
      </div>
      <h3>Road actions</h3>
      <div class="row"><button class="danger" data-act="deleteRoad">Delete road</button>
      <button data-act="frame">Frame</button></div>
      <div class="muted" style="margin-top:8px">Raised lanes (sidewalk, median) get curb faces.</div>`;
  };

  const renderProp = (id: string): string => {
    const p = ed.getProp(id);
    if (!p) return '';
    const road = ed.getRoad(p.roadId);
    return `
      <h3>Prop</h3>
      <label>Type <select data-field="propKind">${(Object.keys(PROP_INFO) as PropKind[])
        .map((k) => `<option value="${k}" ${k === p.kind ? 'selected' : ''}>${PROP_INFO[k].label}</option>`)
        .join('')}</select></label>
      <div class="muted" style="margin:-4px 0 8px">On road: ${esc(road?.name ?? '?')}</div>
      <div class="row">
        <label style="flex:1">Distance s (m) <input type="number" step="0.5" data-field="propS" value="${p.s.toFixed(1)}" /></label>
        <label style="flex:1">Offset (m) <input type="number" step="0.1" data-field="propOffset" value="${p.offset.toFixed(2)}" /></label>
      </div>
      <label>Repeat length (m, 0 = single) <input type="number" step="1" min="0" data-field="propLength" value="${p.length}" /></label>
      <div class="muted">Repeats every ${PROP_INFO[p.kind].spacing || '—'} m for bollards and street lights.</div>
      <h3>Prop actions</h3>
      <div class="row"><button class="danger" data-act="deleteProp">Delete prop</button><button data-act="frame">Frame</button></div>`;
  };

  const renderOverview = (): string => {
    const s = ed.summary();
    return `
      <h3>Draw settings</h3>
      <label>New road preset <select data-field="drawPreset">${presetOptions(ed.drawPreset)}</select></label>
      <label>Prop to place <select data-field="propKind">${(Object.keys(PROP_INFO) as PropKind[])
        .map((k) => `<option value="${k}" ${k === ed.propKind ? 'selected' : ''}>${PROP_INFO[k].label}</option>`)
        .join('')}</select></label>
      <label>Snap step (m) <input type="number" step="0.5" min="0.5" data-field="snapStep" value="${ed.snapStep}" /></label>
      <h3>Network</h3>
      <div class="kv">
        <b>Roads</b><span>${s.roads}</span>
        <b>Length</b><span>${s.km.toFixed(1)} km</span>
        <b>Props</b><span>${s.props}</span>
        <b>Junction ends</b><span>${s.junctions}</span>
        <b>Rail crossings</b><span>${s.crossings}</span>
        <b>Triangles</b><span>${(s.tris / 1000).toFixed(0)}k</span>
      </div>
      <h3>Presets</h3>
      <div class="muted" style="line-height:1.5">${Object.values(PRESETS)
        .map((p) => `<div><b style="color:var(--text)">${esc(p.label)}</b></div>`)
        .join('')}</div>
      <h3>Tips</h3>
      <div class="muted" style="line-height:1.5">
        Select a road, then edit its cross-section: bus lanes, bike lanes, parking and curbs all live there.<br/>
        Put a bollard row on a footpath with the prop tool, then set its repeat length.<br/>
        Speed bumps and bus stops attach to the road you click; railway crossings are created automatically wherever a rail line crosses a road.
      </div>`;
  };

  const renderPanel = (): void => {
    let html = '';
    if (ed.selProp) html = renderProp(ed.selProp);
    else {
      const road = ed.getRoad(ed.selRoad);
      html = road ? renderRoad(road) : renderOverview();
    }
    panel.innerHTML = html;
  };

  const onPanelChange = (e: Event) => {
    const t = e.target as HTMLInputElement | HTMLSelectElement;
    const field = t.dataset.field;
    if (!field) return;
    const idx = parseInt(t.dataset.idx ?? '-1', 10);
    const road = ed.getRoad(ed.selRoad);
    const prop = ed.getProp(ed.selProp);
    const num = (v: string) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : 0);
    switch (field) {
      case 'drawPreset': ed.drawPreset = t.value; break;
      case 'propKind': if (prop) ed.updateProp(prop.id, { kind: t.value as PropKind }); else ed.propKind = t.value as PropKind; break;
      case 'snapStep': ed.snapStep = Math.max(0.5, num(t.value)); break;
      case 'name': if (road) ed.updateRoad(road.id, { name: t.value }); break;
      case 'preset': if (road) ed.setRoadPreset(road.id, t.value); break;
      case 'surface': if (road) ed.updateRoad(road.id, { surface: t.value as Surface }); break;
      case 'speedLimit': if (road) ed.updateRoad(road.id, { speedLimit: num(t.value) }); break;
      case 'smooth': if (road) ed.updateRoad(road.id, { smooth: (t as HTMLInputElement).checked }); break;
      case 'laneKind': if (road) ed.updateLane(road.id, idx, { kind: t.value as LaneKind }); break;
      case 'laneWidth': if (road) ed.updateLane(road.id, idx, { width: Math.max(0, num(t.value)) }); break;
      case 'laneDir': if (road) ed.updateLane(road.id, idx, { dir: parseInt(t.value, 10) as -1 | 0 | 1 }); break;
      case 'pointY': if (road && ed.selPoint !== null) ed.setPointHeight(road.id, ed.selPoint, num(t.value)); break;
      case 'propS': if (prop) ed.updateProp(prop.id, { s: Math.max(0, num(t.value)) }); break;
      case 'propOffset': if (prop) ed.updateProp(prop.id, { offset: num(t.value) }); break;
      case 'propLength': if (prop) ed.updateProp(prop.id, { length: Math.max(0, num(t.value)) }); break;
    }
  };
  panel.addEventListener('change', onPanelChange);

  panel.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
    if (!b) return;
    const act = b.dataset.act!;
    const idx = parseInt(b.dataset.idx ?? '-1', 10);
    const road = ed.getRoad(ed.selRoad);
    switch (act) {
      case 'pt': if (road) ed.selectRoad(road.id, idx); break;
      case 'laneUp': if (road) ed.moveLane(road.id, idx, -1); break;
      case 'laneDown': if (road) ed.moveLane(road.id, idx, 1); break;
      case 'laneDel': if (road) ed.removeLane(road.id, idx); break;
      case 'addLane': if (road) ed.addLane(road.id, 'driving'); break;
      case 'addBus': if (road) ed.addLane(road.id, 'bus'); break;
      case 'addBike': if (road) ed.addLane(road.id, 'bike'); break;
      case 'removePoint': if (road && ed.selPoint !== null && road.points.length > 2) {
        const i = ed.selPoint;
        ed.updateRoad(road.id, { points: road.points.filter((_, k) => k !== i) });
        ed.selectRoad(road.id, null);
      } break;
      case 'deleteRoad': ed.deleteSelection(); break;
      case 'deleteProp': ed.deleteSelection(); break;
      case 'frame': ed.frameSelection(); break;
    }
  });

  // ---- status ----------------------------------------------------------------------
  const refresh = (): void => {
    toolbar.querySelectorAll<HTMLButtonElement>('button[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === ed.tool));
    ($('btn-undo') as HTMLButtonElement).disabled = !ed.canUndo;
    ($('btn-redo') as HTMLButtonElement).disabled = !ed.canRedo;
    ($('tgl-snap') as HTMLInputElement).checked = ed.snapOn;
    const t = TOOLS.find((x) => x.id === ed.tool)!;
    hint.textContent = ed.tool === 'draw' && ed.draftCount ? `Drawing: ${ed.draftCount} point(s). Double-click or Enter to finish, Esc to cancel.` : t.hint;
    const s = ed.summary();
    stats.textContent = `${s.roads} roads · ${s.km.toFixed(1)} km · ${s.props} props · ${(s.tris / 1000).toFixed(0)}k tris · rebuild ${s.buildMs} ms`;
    renderPanel();
  };
  ed.onChange = refresh;
  return refresh;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
