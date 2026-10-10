/** Editor shell: layer stacks (drag-reorder) + schema-driven inspector. */
import {
  BLEND_MODES, GEN_FIELDS, GEN_TYPES, MAT_FIELDS, genLayer, matLayer,
  type Field, type GenLayer, type MatLayer,
} from './layers';
import type { ErosionSettings, RenderSettings, WorldSettings } from './engine';

type Stack = 'gen' | 'mat';
type Obj = Record<string, unknown>;

const el = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const hex = (c: [number, number, number]) =>
  '#' + c.map(v => Math.round(Math.min(1, Math.max(0, v)) ** (1 / 2.2) * 255).toString(16).padStart(2, '0')).join('');
const unhex = (s: string): [number, number, number] => {
  const n = parseInt(s.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255].map(v => v ** 2.2) as [number, number, number];
};

export interface UIHooks {
  rebuild: () => void;          // terrain stack / world changed -> regenerate
  restartErosion: () => void;
  repaint: () => void;          // material / lighting only
  erosionParams: () => void;
}

export class EditorUI {
  stack: Stack = 'gen';
  selGen = 0;
  selMat = 0;
  private openGroups = new Set<string>(['layer', 'erosion']);

  constructor(
    public gen: GenLayer[],
    public mats: MatLayer[],
    public world: WorldSettings,
    public erosion: ErosionSettings,
    public render: RenderSettings,
    private hooks: UIHooks,
  ) {
    el<HTMLDivElement>('.tabs').addEventListener('click', e => {
      const t = (e.target as HTMLElement).closest('.tab') as HTMLElement | null;
      if (!t) return;
      document.querySelectorAll('.tab').forEach(x => x.classList.remove('on'));
      t.classList.add('on');
      this.stack = t.dataset.stack as Stack;
      this.refresh();
    });
    el('#addLayer').addEventListener('click', () => this.add());
    el('#dupLayer').addEventListener('click', () => this.duplicate());
    el('#delLayer').addEventListener('click', () => this.remove());
    el('#upLayer').addEventListener('click', () => this.move(-1));
    el('#downLayer').addEventListener('click', () => this.move(1));
  }

  private list(): (GenLayer | MatLayer)[] { return this.stack === 'gen' ? this.gen : this.mats; }
  private sel() { return this.stack === 'gen' ? this.selGen : this.selMat; }
  private setSel(i: number) { if (this.stack === 'gen') this.selGen = i; else this.selMat = i; }
  private changed() { this.stack === 'gen' ? this.hooks.rebuild() : this.hooks.repaint(); }

  add() {
    if (this.stack === 'gen') this.gen.splice(this.selGen + 1, 0, genLayer({ name: 'Ridged', type: 1, strength: 0.2 }));
    else this.mats.splice(this.selMat + 1, 0, matLayer({ name: 'Material' }));
    this.setSel(this.sel() + 1);
    this.refresh(); this.changed();
  }
  duplicate() {
    const l = this.list()[this.sel()];
    if (!l) return;
    const copy = { ...l, id: Math.random(), name: l.name + ' copy' } as GenLayer | MatLayer;
    this.list().splice(this.sel() + 1, 0, copy);
    this.setSel(this.sel() + 1);
    this.refresh(); this.changed();
  }
  remove() {
    if (this.list().length <= 1) return;
    this.list().splice(this.sel(), 1);
    this.setSel(Math.max(0, this.sel() - 1));
    this.refresh(); this.changed();
  }
  move(d: number) {
    const i = this.sel(); const j = i + d;
    const L = this.list();
    if (j < 0 || j >= L.length) return;
    [L[i], L[j]] = [L[j], L[i]];
    this.setSel(j);
    this.refresh(); this.changed();
  }

  /* ------------------------------ stack ------------------------------ */

  refresh() {
    const host = el('#stack');
    host.innerHTML = '';
    el('#stackTitle').textContent =
      this.stack === 'gen' ? `Terrain layers (${this.gen.length})` : `Material layers (${this.mats.length})`;
    const L = this.list();
    L.forEach((l, i) => {
      const row = document.createElement('div');
      row.className = 'layer' + (i === this.sel() ? ' sel' : '') + (l.enabled ? '' : ' off');
      row.draggable = true;
      const kind = this.stack === 'gen'
        ? `${GEN_TYPES[(l as GenLayer).type]} · ${BLEND_MODES[(l as GenLayer).blend]}`
        : `${Math.round((l as MatLayer).strength * 100)}%`;
      const swatch = this.stack === 'mat'
        ? `<span class="sw" style="background:${hex((l as MatLayer).albedo)}"></span>` : '';
      row.innerHTML = `<span class="hnd">⠿</span>
        <span class="eye ${l.enabled ? 'on' : ''}">${l.enabled ? '●' : '○'}</span>
        ${swatch}<span class="nm">${l.name}</span><span class="kind">${kind}</span>`;
      row.addEventListener('click', e => {
        if ((e.target as HTMLElement).classList.contains('eye')) {
          l.enabled = !l.enabled; this.refresh(); this.changed(); return;
        }
        this.setSel(i); this.refresh();
      });
      row.addEventListener('dblclick', () => {
        const n = prompt('Layer name', l.name);
        if (n) { l.name = n; this.refresh(); }
      });
      row.addEventListener('dragstart', () => { row.classList.add('drag'); (host as HTMLElement).dataset.from = String(i); });
      row.addEventListener('dragend', () => row.classList.remove('drag'));
      row.addEventListener('dragover', e => e.preventDefault());
      row.addEventListener('drop', e => {
        e.preventDefault();
        const from = Number((host as HTMLElement).dataset.from);
        if (Number.isNaN(from) || from === i) return;
        const [moved] = L.splice(from, 1);
        L.splice(i, 0, moved);
        this.setSel(i);
        this.refresh(); this.changed();
      });
      host.appendChild(row);
    });
    this.buildInspector();
  }

  /* ---------------------------- inspector ---------------------------- */

  private group(title: string, key: string, body: HTMLElement, hint?: string) {
    const g = document.createElement('div');
    g.className = 'group' + (this.openGroups.has(key) ? '' : ' closed');
    const h = document.createElement('div');
    h.className = 'gh';
    h.innerHTML = `<span class="chev">▼</span>${title}`;
    h.addEventListener('click', () => {
      g.classList.toggle('closed');
      if (g.classList.contains('closed')) this.openGroups.delete(key); else this.openGroups.add(key);
    });
    const b = document.createElement('div');
    b.className = 'gb';
    b.appendChild(body);
    if (hint) {
      const p = document.createElement('div');
      p.className = 'hint'; p.textContent = hint;
      b.appendChild(p);
    }
    g.append(h, b);
    return g;
  }

  private fields(obj: Obj, fields: Field[], onChange: () => void) {
    const frag = document.createDocumentFragment();
    for (const f of fields) {
      const row = document.createElement('div');
      row.className = 'fld' + (f.type === 'color' || f.type === 'select' ? ' wide' : '');
      const lab = document.createElement('label');
      lab.textContent = f.label;
      lab.title = f.label;
      row.appendChild(lab);

      if (f.type === 'select') {
        const s = document.createElement('select');
        (f.options ?? []).forEach((o, i) => {
          const op = document.createElement('option');
          op.value = String(i); op.textContent = o;
          s.appendChild(op);
        });
        s.value = String(obj[f.key]);
        s.addEventListener('change', () => { obj[f.key] = Number(s.value); onChange(); this.refresh(); });
        row.appendChild(s);
      } else if (f.type === 'color') {
        const c = document.createElement('input');
        c.type = 'color';
        c.value = hex(obj[f.key] as [number, number, number]);
        c.addEventListener('input', () => { obj[f.key] = unhex(c.value); onChange(); });
        row.appendChild(c);
      } else {
        const r = document.createElement('input');
        r.type = 'range';
        r.min = String(f.min ?? 0); r.max = String(f.max ?? 1); r.step = String(f.step ?? 0.01);
        r.value = String(obj[f.key]);
        const v = document.createElement('input');
        v.className = 'val'; v.type = 'text';
        const fmt = (n: number) => (Math.abs(n) >= 100 ? n.toFixed(0) : Math.abs(n) >= 10 ? n.toFixed(1) : n.toFixed(3));
        v.value = fmt(Number(obj[f.key]));
        r.addEventListener('input', () => { obj[f.key] = Number(r.value); v.value = fmt(Number(r.value)); onChange(); });
        v.addEventListener('change', () => {
          const n = Number(v.value);
          if (!Number.isNaN(n)) { obj[f.key] = n; r.value = String(n); onChange(); }
        });
        row.append(r, v);
      }
      frag.appendChild(row);
    }
    const wrap = document.createElement('div');
    wrap.appendChild(frag);
    return wrap;
  }

  buildInspector() {
    const host = el('#inspector');
    host.innerHTML = '';
    const L = this.list()[this.sel()];

    if (L) {
      const isGen = this.stack === 'gen';
      const fields = isGen ? GEN_FIELDS : MAT_FIELDS;
      const body = this.fields(L as unknown as Obj, fields, () => {
        isGen ? this.hooks.rebuild() : this.hooks.repaint();
      });
      host.appendChild(this.group(
        `${isGen ? 'Layer' : 'Material'} · ${L.name}`, 'layer', body,
        isGen
          ? 'Operators evaluate top to bottom. “Mask from/to” restricts a layer to an altitude band of the result below it — that is how you keep ridges off the plains.'
          : 'Materials composite top to bottom. Rules are multiplied: altitude × slope × concavity × flow × sediment × scour × openness × breakup.',
      ));
    }

    host.appendChild(this.group('World', 'world', this.fields(this.world as unknown as Obj, [
      { key: 'worldSize', label: 'Terrain size (m)', min: 1000, max: 24000, step: 100 },
      { key: 'heightScale', label: 'Height (m)', min: 100, max: 4000, step: 10 },
      { key: 'seaLevel', label: 'Sea level', min: 0, max: 0.6, step: 0.002 },
      { key: 'strataScale', label: 'Strata frequency', min: 1, max: 40, step: 0.5 },
      { key: 'strataContrast', label: 'Strata hardness', min: 0, max: 1, step: 0.01 },
      { key: 'strataTilt', label: 'Strata tilt', min: -1, max: 1, step: 0.01 },
    ], () => this.hooks.rebuild()), 'Hard and soft bands make cliffs undercut and bench instead of melting into smooth cones.'));

    host.appendChild(this.group('Erosion', 'erosion', this.fields(this.erosion as unknown as Obj, [
      { key: 'iterations', label: 'Target iterations', min: 0, max: 2000, step: 10 },
      { key: 'rain', label: 'Rainfall', min: 0, max: 0.05, step: 0.0005 },
      { key: 'rainSpotAmount', label: 'Rain patchiness', min: 0, max: 1, step: 0.01 },
      { key: 'evaporation', label: 'Evaporation', min: 0.002, max: 0.2, step: 0.001 },
      { key: 'capacity', label: 'Carry capacity', min: 0.05, max: 3, step: 0.01 },
      { key: 'dissolve', label: 'Dissolve rate', min: 0.01, max: 1.5, step: 0.01 },
      { key: 'deposit', label: 'Deposit rate', min: 0.01, max: 1.5, step: 0.01 },
      { key: 'minSlope', label: 'Min slope', min: 0.001, max: 0.12, step: 0.001 },
      { key: 'inertia', label: 'Flow inertia', min: 0.5, max: 0.995, step: 0.005 },
      { key: 'dt', label: 'Time step', min: 0.01, max: 0.2, step: 0.005 },
      { key: 'hardnessInfluence', label: 'Strata influence', min: 0, max: 1, step: 0.01 },
      { key: 'talus', label: 'Talus angle', min: 0.05, max: 2.5, step: 0.01 },
      { key: 'thermalRate', label: 'Slump rate', min: 0, max: 1, step: 0.01 },
      { key: 'thermalEvery', label: 'Slump interval', min: 1, max: 20, step: 1 },
    ], () => this.hooks.erosionParams()), 'Pipe-model shallow water: flux → velocity → capacity → scour/deposit → sediment advection. Changes apply to the running simulation.'));

    host.appendChild(this.group('Lighting & look', 'light', this.fields(this.render as unknown as Obj, [
      { key: 'sunAzimuth', label: 'Sun azimuth', min: 0, max: 360, step: 1 },
      { key: 'sunElevation', label: 'Sun elevation', min: -5, max: 89, step: 0.5 },
      { key: 'sunIntensity', label: 'Sun intensity', min: 0, max: 10, step: 0.05 },
      { key: 'sunColor', label: 'Sun colour', type: 'color' },
      { key: 'zenith', label: 'Sky zenith', type: 'color' },
      { key: 'horizon', label: 'Sky horizon', type: 'color' },
      { key: 'ambient', label: 'Sky light', min: 0, max: 3, step: 0.01 },
      { key: 'bounce', label: 'Ground bounce', min: 0, max: 1, step: 0.01 },
      { key: 'exposure', label: 'Exposure', min: 0.2, max: 3, step: 0.01 },
      { key: 'fog', label: 'Aerial perspective', min: 0, max: 5, step: 0.02 },
      { key: 'shadowSteps', label: 'Shadow steps', min: 0, max: 96, step: 1 },
      { key: 'detail', label: 'Micro detail', min: 0, max: 1, step: 0.01 },
    ], () => this.hooks.repaint())));

    host.appendChild(this.group('Analysis bake', 'analysis', this.fields(this.world as unknown as Obj, [
      { key: 'aoDirs', label: 'AO directions', min: 4, max: 32, step: 1 },
      { key: 'aoSteps', label: 'AO steps', min: 4, max: 32, step: 1 },
      { key: 'aoRadius', label: 'AO radius (m)', min: 50, max: 4000, step: 10 },
      { key: 'flowGain', label: 'Wetness gain', min: 1, max: 400, step: 1 },
      { key: 'depGain', label: 'Sediment gain', min: 1, max: 200, step: 1 },
      { key: 'eroGain', label: 'Scour gain', min: 1, max: 200, step: 1 },
    ], () => this.hooks.repaint()), 'Horizon-scan occlusion and the mask set the texture stack reads.'));
  }
}
