// Outliner + tabbed inspector. Stateless render-from-model; main.js owns state.
import { NODE_TYPES, CATEGORIES } from '../core/graph.js';

const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};
const fmtM3 = v => v >= 1000 ? (v / 1000).toFixed(2) + 'k' : v >= 1 ? v.toFixed(1) : v.toFixed(3);

export class Panels {
  constructor(root, hooks) {
    this.hooks = hooks; // {graph, sel, tab, sim, render, shade, onSelect, onParam, onAction, onTab}
    this.olBody = root.querySelector('#outlinerBody');
    this.inspBody = root.querySelector('#inspBody');
    this.tabsEl = root.querySelector('#inspTabs');
    this.tabsEl.querySelectorAll('button').forEach(b => b.onclick = () => { hooks.onTab(b.dataset.tab); });
  }
  get graph() { return this.hooks.graph(); }

  refreshOutliner() {
    const g = this.graph, H = this.hooks, body = this.olBody;
    body.innerHTML = '';
    const groups = ['field', 'sim', 'water', 'output'];
    for (const cat of groups) {
      const nodes = g.nodes.filter(n => NODE_TYPES[n.type].cat === cat);
      if (!nodes.length) continue;
      const box = el('div', 'ol-group');
      box.appendChild(el('h4', '', CATEGORIES[cat].title));
      for (const n of nodes) {
        const def = NODE_TYPES[n.type];
        const row = el('div', 'ol-row' + (H.sel() === n.id ? ' sel' : ''));
        const dot = el('span', 'ol-dot'); dot.style.background = n.disabled ? '#3a4352' : def.color;
        row.appendChild(dot);
        const name = el('span', 'ol-name', def.title);
        if (n.disabled) name.style.opacity = 0.45;
        row.appendChild(name);
        row.appendChild(el('span', 'ol-sub', subInfo(n)));
        const eye = el('button', 'ol-eye' + (n.disabled ? ' off' : ''), n.disabled ? '○' : '●');
        eye.title = n.disabled ? 'Enable node' : 'Disable node';
        eye.onclick = (ev) => { ev.stopPropagation(); H.onAction('toggleNode', n.id); };
        row.appendChild(eye);
        row.onclick = () => H.onSelect(n.id);
        box.appendChild(row);
      }
      body.appendChild(box);
    }
  }

  setTab(tab) {
    this.tabsEl.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    this.refreshInspector();
  }

  refreshInspector() {
    const H = this.hooks, tab = H.tab(), body = this.inspBody;
    body.innerHTML = '';
    if (tab === 'node') this._nodeTab(body);
    else if (tab === 'erosion') this._erosionTab(body);
    else if (tab === 'water') this._waterTab(body);
    else this._renderTab(body);
  }

  // ── Node tab ──
  _nodeTab(body) {
    const H = this.hooks, g = this.graph;
    const n = g.getNode(H.sel());
    if (!n) {
      body.appendChild(el('p', 'insp-note', 'Select a node in the graph or outliner. <b>Tab</b> adds nodes; drag sockets to connect. Field nodes (green) build the SDF; sim nodes (blue) erode it live.'));
      const b = el('div', 'btnrow');
      const add = el('button', 'btn', '＋ Add node'); add.onclick = () => H.onAction('addMenu');
      const fit = el('button', 'btn', 'Fit graph'); fit.onclick = () => H.onAction('fitGraph');
      b.append(add, fit); body.appendChild(b);
      return;
    }
    const def = NODE_TYPES[n.type];
    const head = el('div', 'insp-title');
    const dot = el('span', 'ol-dot'); dot.style.background = def.color;
    head.append(dot, Object.assign(el('b'), { textContent: def.title }), el('span', '', n.id.slice(0, 8)));
    body.appendChild(head);
    body.appendChild(el('p', 'insp-desc', def.desc));
    const sec = el('div', 'insp-sec');
    sec.appendChild(el('h4', '', 'Parameters'));
    const sb = el('div', 'sec-body');
    for (const p of def.params) sb.appendChild(this._widget(n, p));
    sec.appendChild(sb); body.appendChild(sec);
    const row = el('div', 'btnrow');
    const dis = el('button', 'btn', n.disabled ? 'Enable' : 'Disable');
    dis.onclick = () => H.onAction('toggleNode', n.id);
    const del = el('button', 'btn warn', 'Delete');
    del.onclick = () => H.onAction('deleteNode', n.id);
    row.append(dis, del);
    if (n.type === 'river') {
      const ed = el('button', 'btn accent', '✎ Edit path');
      ed.onclick = () => H.onAction('editPath', n.id);
      const cl = el('button', 'btn', 'Clear');
      cl.onclick = () => H.onAction('clearPath', n.id);
      row.append(ed, cl);
    }
    if (n.type === 'output') {
      const rb = el('button', 'btn accent', '⟳ Rebake now');
      rb.onclick = () => H.onAction('rebake');
      row.append(rb);
    }
    body.appendChild(row);
    if (n.type === 'river') {
      const c = (n.params.points || []).length;
      body.appendChild(el('p', 'insp-note', c >= 2
        ? `<b>${c}</b> control points. The river spawns along this path and its water ribbon follows the carved bed.`
        : 'No path yet — press <b>✎ Edit path</b>, then click the terrain in the viewport.'));
    }
  }

  _widget(n, p) {
    const H = this.hooks;
    const row = el('div', 'prow');
    const lab = el('label', '', p.label); lab.title = p.key;
    row.appendChild(lab);
    const commit = (v) => H.onParam(n.id, p.key, v, true);
    const live = (v) => H.onParam(n.id, p.key, v, false);
    if (p.type === 'float') {
      const r = document.createElement('input');
      r.type = 'range'; r.min = p.min; r.max = p.max; r.step = p.step || 0.1; r.value = n.params[p.key];
      const num = document.createElement('input');
      num.type = 'number'; num.min = p.min; num.max = p.max; num.step = p.step || 0.1; num.value = n.params[p.key];
      r.oninput = () => { num.value = r.value; live(parseFloat(r.value)); };
      r.onchange = () => commit(parseFloat(r.value));
      num.onchange = () => { const v = Math.min(p.max, Math.max(p.min, parseFloat(num.value) || 0)); r.value = v; num.value = v; commit(v); };
      row.append(r, num);
    } else if (p.type === 'int') {
      const num = document.createElement('input');
      num.type = 'number'; num.min = p.min; num.max = p.max; num.step = 1; num.value = n.params[p.key];
      num.style.width = '100%';
      num.onchange = () => commit(Math.round(Math.min(p.max, Math.max(p.min, parseFloat(num.value) || 0))));
      row.append(num);
    } else if (p.type === 'bool') {
      const c = document.createElement('input');
      c.type = 'checkbox'; c.checked = !!n.params[p.key];
      c.onchange = () => commit(c.checked);
      row.append(c);
    } else if (p.type === 'select') {
      const s = document.createElement('select');
      p.options.forEach((o, i) => {
        const op = document.createElement('option');
        op.value = i; op.textContent = o;
        if (String(n.params[p.key]) === String(typeof n.params[p.key] === 'number' ? i : o) || n.params[p.key] === o) op.selected = true;
        s.appendChild(op);
      });
      // normalize: params may hold index or string
      s.onchange = () => {
        const cur = n.params[p.key];
        commit(typeof cur === 'number' ? parseInt(s.value, 10) : p.options[parseInt(s.value, 10)]);
      };
      row.append(s);
    } else if (p.type === 'vec3') {
      const wrap = el('div', 'vec3');
      (n.params[p.key] || [0, 0, 0]).forEach((v, i) => {
        const num = document.createElement('input');
        num.type = 'number'; num.step = 'any'; num.value = v;
        num.onchange = () => {
          const arr = [...n.params[p.key]]; arr[i] = parseFloat(num.value) || 0;
          commit(arr);
        };
        wrap.appendChild(num);
      });
      row.append(wrap);
    } else if (p.type === 'spline') {
      const c = (n.params[p.key] || []).length;
      row.appendChild(el('span', 'pval', c >= 2 ? `${c} pts ✓` : 'empty'));
    } else if (p.type === 'lake') {
      row.appendChild(el('span', 'pval', 'ellipse'));
    }
    return row;
  }

  // ── Erosion tab ──
  _erosionTab(body) {
    const H = this.hooks, sim = H.sim();
    const sec = el('div', 'insp-sec');
    sec.appendChild(el('h4', '', 'Transport'));
    const sb = el('div', 'sec-body');
    const row = el('div', 'btnrow');
    const play = el('button', 'btn play', H.playing() ? '⏸ Pause' : '▶ Run');
    play.onclick = () => H.onAction('togglePlay');
    const step = el('button', 'btn', 'Step'); step.onclick = () => H.onAction('step');
    const rst = el('button', 'btn warn', 'Reset sim'); rst.onclick = () => H.onAction('resetSim');
    row.append(play, step, rst); sb.appendChild(row);
    sb.appendChild(el('p', 'insp-note', 'Reset clears particles + carved sediment and restores the baked base field.'));
    sec.appendChild(sb); body.appendChild(sec);

    const L = sim.ledger;
    const led = el('div', 'insp-sec');
    led.appendChild(el('h4', '', 'Mass ledger (m³)'));
    const lb = el('div', 'sec-body');
    const kv = (k, v) => lb.appendChild(el('div', 'kv', `${k}<b>${v}</b>`));
    kv('eroded', fmtM3(L.eroded)); kv('deposited', fmtM3(L.deposited));
    kv('suspended', fmtM3(L.suspended)); kv('exited', fmtM3(L.exited));
    kv('settled', String(L.settled)); kv('alive', `${sim.n} / ${sim.maxAlive}`);
    kv('by type R/r/W/k', sim.aliveByType.join(' / '));
    const bal = sim.balance();
    kv('balance', L.eroded > 1e-9 ? (bal * 100).toFixed(1) + '%' : '—');
    led.appendChild(lb); body.appendChild(led);

    const em = el('div', 'insp-sec');
    em.appendChild(el('h4', '', 'Emitters'));
    const eb = el('div', 'sec-body');
    const simNodes = this.graph.nodes.filter(n => ['sim', 'water'].includes(NODE_TYPES[n.type].cat));
    if (!simNodes.length) eb.appendChild(el('p', 'insp-note', 'No emitters — add Rain / River / Wind / Thermal / Rockfall from the graph.'));
    for (const n of simNodes) {
      const r = el('div', 'ol-row');
      const dot = el('span', 'ol-dot'); dot.style.background = NODE_TYPES[n.type].color;
      r.append(dot, el('span', 'ol-name', NODE_TYPES[n.type].title));
      const c = document.createElement('input');
      c.type = 'checkbox'; c.checked = !n.disabled && n.params.enabled !== false;
      c.title = 'Enabled';
      c.onclick = (ev) => ev.stopPropagation();
      c.onchange = () => H.onParam(n.id, 'enabled', c.checked, true);
      r.appendChild(c);
      r.onclick = () => H.onSelect(n.id);
      eb.appendChild(r);
    }
    em.appendChild(eb); body.appendChild(em);

    const ps = el('div', 'insp-sec');
    ps.appendChild(el('h4', '', 'Particles (view)'));
    const pb = el('div', 'sec-body');
    pb.appendChild(this._miniFloat('Dot size px', H.render().pSize, 1, 8, 0.5, v => H.onAction('pSize', v)));
    pb.appendChild(this._miniFloat('Opacity', H.render().pOpacity, 0.1, 1, 0.05, v => H.onAction('pOpacity', v)));
    const pr = el('div', 'prow');
    pr.appendChild(el('label', '', 'Show'));
    const c = document.createElement('input');
    c.type = 'checkbox'; c.checked = H.render().showParticles;
    c.onchange = () => H.onAction('toggleParticles');
    pr.appendChild(c); pb.appendChild(pr);
    ps.appendChild(pb); body.appendChild(ps);
  }

  _miniFloat(label, val, min, max, step, fn) {
    const row = el('div', 'prow');
    row.appendChild(el('label', '', label));
    const r = document.createElement('input');
    r.type = 'range'; r.min = min; r.max = max; r.step = step; r.value = val;
    const num = el('span', 'pval', String(val));
    r.oninput = () => { num.textContent = r.value; fn(parseFloat(r.value)); };
    row.append(r, num);
    return row;
  }

  // ── Water tab ──
  _waterTab(body) {
    const H = this.hooks;
    const sec = el('div', 'insp-sec');
    sec.appendChild(el('h4', '', 'Bodies'));
    const sb = el('div', 'sec-body');
    const waters = this.graph.nodes.filter(n => n.type === 'lake' || n.type === 'river');
    if (!waters.length) sb.appendChild(el('p', 'insp-note', 'Add a Lake or River node to get current-following water.'));
    for (const n of waters) {
      const r = el('div', 'ol-row');
      const dot = el('span', 'ol-dot'); dot.style.background = NODE_TYPES[n.type].color;
      const info = n.type === 'lake' ? `Y ${n.params.level}` : `${(n.params.points || []).length} pts`;
      r.append(dot, el('span', 'ol-name', NODE_TYPES[n.type].title), el('span', 'ol-sub', info));
      r.onclick = () => H.onSelect(n.id);
      sb.appendChild(r);
    }
    const row = el('div', 'btnrow');
    const rw = el('button', 'btn', 'Rebuild water'); rw.onclick = () => H.onAction('rebuildWater');
    const tw = el('button', 'btn', (H.render().showWater ? 'Hide' : 'Show') + ' water'); tw.onclick = () => H.onAction('toggleWater');
    row.append(rw, tw); sb.appendChild(row);
    sec.appendChild(sb); body.appendChild(sec);

    const wm = el('div', 'insp-sec');
    wm.appendChild(el('h4', '', 'Water material'));
    const wb = el('div', 'sec-body');
    const R = H.render();
    const colorRow = (label, get, set) => {
      const pr = el('div', 'prow');
      pr.appendChild(el('label', '', label));
      const c = document.createElement('input');
      c.type = 'color'; c.value = get();
      c.onchange = () => set(c.value);
      pr.appendChild(c); wb.appendChild(pr);
    };
    colorRow('Deep', () => R.waterDeep, v => H.onAction('waterDeep', v));
    colorRow('Shallow', () => R.waterShallow, v => H.onAction('waterShallow', v));
    wb.appendChild(this._miniFloat('Sun glint', R.sunI, 0, 5, 0.1, v => H.onAction('sunI', v)));
    wm.appendChild(wb); body.appendChild(wm);
    body.appendChild(el('p', 'insp-note', 'Lake flow blends each lake\'s drift with recorded runoff flux; river ribbons advect strictly along their path tangents, with rapids foam where the bed drops.'));
  }

  // ── Render tab ──
  _renderTab(body) {
    const H = this.hooks, R = H.render();
    const sec = el('div', 'insp-sec');
    sec.appendChild(el('h4', '', 'Viewport'));
    const sb = el('div', 'sec-body');
    sb.appendChild(this._miniFloat('Exposure', R.exposure, 0.4, 1.8, 0.05, v => H.onAction('exposure', v)));
    sb.appendChild(this._miniFloat('Snow line Y', R.snowY, 20, 70, 1, v => H.onAction('snowY', v)));
    sb.appendChild(this._miniFloat('Grass up to Y', R.grassY, 0, 60, 1, v => H.onAction('grassY', v)));
    const toggles = [
      ['Wireframe', R.wire, 'toggleWire'], ['Shadows', R.shadows, 'toggleShadows'],
      ['Guides', R.guides, 'toggleGuides'], ['Ortho (5)', R.ortho, 'toggleOrtho'],
    ];
    for (const [label, val, act] of toggles) {
      const pr = el('div', 'prow');
      pr.appendChild(el('label', '', label));
      const c = document.createElement('input');
      c.type = 'checkbox'; c.checked = !!val;
      c.onchange = () => H.onAction(act);
      pr.appendChild(c); sb.appendChild(pr);
    }
    sec.appendChild(sb); body.appendChild(sec);

    const ex = el('div', 'insp-sec');
    ex.appendChild(el('h4', '', 'Export'));
    const xb = el('div', 'sec-body');
    const mk = (label, act) => {
      const b = el('button', 'btn', label);
      b.onclick = () => H.onAction(act);
      return b;
    };
    const r1 = el('div', 'btnrow'); r1.append(mk('Mesh .PLY', 'exportPLY'), mk('Mesh .OBJ', 'exportOBJ'));
    const r2 = el('div', 'btnrow'); r2.append(mk('Height PNG', 'exportHeight'), mk('Flowmap PNG', 'exportFlow'));
    const r3 = el('div', 'btnrow'); r3.append(mk('Graph .JSON', 'saveGraph'), mk('Screenshot', 'screenshot'));
    xb.append(r1, r2, r3);
    xb.appendChild(el('p', 'insp-note', 'PLY keeps vertex colors. The flowmap (RG dir / B flux) plugs straight into engine water shaders.'));
    ex.appendChild(xb); body.appendChild(ex);

    const st = el('div', 'insp-sec');
    st.appendChild(el('h4', '', 'Scene stats'));
    const tb = el('div', 'sec-body');
    const S = H.stats();
    const kv = (k, v) => tb.appendChild(el('div', 'kv', `${k}<b>${v}</b>`));
    kv('verts', S.verts); kv('tris', S.tris);
    kv('mesh build', S.meshMs); kv('bake', S.bakeMs);
    kv('solid', S.solid);
    st.appendChild(tb); body.appendChild(st);
  }
}

function subInfo(n) {
  if (n.type === 'river') return `${(n.params.points || []).length}p`;
  if (n.type === 'rain' || n.type === 'wind') return `${n.params.rate}/s`;
  if (n.type === 'lake') return `Y${n.params.level}`;
  if (n.type === 'output') return n.params.resolution;
  return '';
}
