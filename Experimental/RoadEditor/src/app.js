//==================================================================================================
//  SLATE — ROAD EDITOR
//==================================================================================================
//  Application shell: the build pipeline, the panels, picking, selection, the viewport loop and the
//  import/export surfaces. The generator, the geometry engine and the renderer are separate modules;
//  this file only drives them.
//==================================================================================================

import { clamp, lerp, MAT, MeshBuilder, DEG } from './core.js';
import { generateCity, PRESETS, DEFAULT_PARAMS, DISTRICT_TYPES } from './citygen.js';
import { buildRenderModel, propGeometry } from './build.js';
import { PROFILES, PROFILE_ORDER, sectionOf, halfWidthOf } from './profiles.js';
import { Renderer, mul4 } from './render.js';
import { Camera, Input } from './camera.js';
import { validateNetwork } from './network.js';

//--------------------------------------------------------------------------------------------------
//  DOM helpers
//--------------------------------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return node;
}
const clear = (node) => {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
};
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

//--------------------------------------------------------------------------------------------------
//  Application state
//--------------------------------------------------------------------------------------------------
const State = {
  params: { ...DEFAULT_PARAMS },
  net: null,
  terrain: null,
  report: null,
  model: null,
  selection: null, // { kind:'road'|'node', id }
  libraryProfile: null,
  leftTab: 'build',
  rightTab: 'inspect',
  view: {
    xray: false,
    markings: true,
    props: true,
    shadows: true,
    wire: false,
    time: 10.5,
    fog: 1,
    exposure: 1.05,
    sunAzimuth: 128,
  },
  busy: false,
  dirty: false,
};

const renderer = new Renderer($('gl'));
const camera = new Camera(0, -180, 60);
const input = new Input($('gl'), {
  handlers: {
    onLook: (dx, dy) => camera.look(dx, dy),
    onWheel: (delta) => {
      camera.speed = clamp(camera.speed * Math.pow(1.0018, delta), 3, 3000);
      refreshHud();
    },
    onPointerDown: (e) => {
      if (e.button === 0 && !e.altKey) {
        const rect = $('gl').getBoundingClientRect();
        pick(e.clientX - rect.left, e.clientY - rect.top);
      }
    },
    onKey: (e) => {
      if (e.code === 'KeyX') toggle('xray');
      else if (e.code === 'KeyM') toggle('markings');
      else if (e.code === 'KeyP') toggle('props');
      else if (e.code === 'KeyH') toggle('shadows');
      else if (e.code === 'KeyG') regenerate();
      else if (e.code === 'KeyF') focusSelection();
      else if (e.code === 'Digit1') setPreset('map');
      else if (e.code === 'Digit2') setPreset('top');
      else if (e.code === 'Digit3') setPreset('street');
      else if (e.code === 'Digit4') setPreset('chase');
      else if (e.code === 'Escape') {
        $('helpOverlay').classList.remove('on');
        select(null);
      } else if (e.code === 'Delete' && State.selection && State.selection.kind === 'road') deleteSelected();
    },
  },
});

//--------------------------------------------------------------------------------------------------
//  Build pipeline
//--------------------------------------------------------------------------------------------------
async function regenerate(opts = {}) {
  if (State.busy) return;
  State.busy = true;
  const label = $('progress');
  label.classList.add('on');
  label.querySelector('span').textContent = 'Generating street network…';
  await nextFrame();
  const t0 = performance.now();
  try {
    const P = { ...State.params };
    const { net, terrain, report } = generateCity(P);
    State.net = net;
    State.terrain = terrain;
    State.report = report;
    State.generated = performance.now() - t0;
    label.querySelector('span').textContent = 'Building geometry…';
    await nextFrame();
    const t1 = performance.now();
    const model = buildRenderModel(net, terrain, { props: State.view.props, markings: State.view.markings });
    model.propGeometry = propGeometry;
    State.buildMs = performance.now() - t1;
    label.querySelector('span').textContent = 'Uploading…';
    await nextFrame();
    renderer.setModel(model);
    State.model = model;
    State.dirty = false;
    updateDerived();
    refreshPanels();
    refreshHud();
    setStatus(
      `Network built: ${net.stats().roads.toLocaleString()} roads · ${net.stats().roadKm.toFixed(1)} km · ` +
        `${report.nodes} junctions · ${Math.round(State.generated)} ms generate, ${Math.round(State.buildMs)} ms geometry`,
    );
  } catch (err) {
    showFatal(err);
  } finally {
    label.classList.remove('on');
    State.busy = false;
  }
}

function updateDerived() {
  if (!State.net) return;
  State.stats = State.net.stats();
  State.validation = State.report && State.report.validation ? State.report.validation : validateNetwork(State.net);
}

function setStatus(text) {
  $('status').textContent = text;
}

function showFatal(err) {
  const box = $('fatal');
  box.classList.add('on');
  box.textContent = `Road Editor error\n\n${err && err.stack ? err.stack : err}`;
  console.error(err);
}

//--------------------------------------------------------------------------------------------------
//  Selection and picking
//--------------------------------------------------------------------------------------------------
const pickCache = { matrix: null, w: 0, h: 0, points: null };

function projectPoint(p, vp, w, h) {
  const x = vp[0] * p.x + vp[4] * p.y + vp[8] * p.z + vp[12];
  const y = vp[1] * p.x + vp[5] * p.y + vp[9] * p.z + vp[13];
  const ww = vp[3] * p.x + vp[7] * p.y + vp[11] * p.z + vp[15];
  if (ww <= 0.001) return null;
  return { x: (x / ww * 0.5 + 0.5) * w, y: (1 - (y / ww * 0.5 + 0.5)) * h, depth: ww };
}

function pick(px, py) {
  if (!State.net) return;
  const rect = $('gl').getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;
  const aspect = Math.max(0.2, w / Math.max(1, h));
  const vp = mul4(camera.projectionMatrix(aspect), camera.viewMatrix());
  let best = null;
  const consider = (p, entry) => {
    const s = projectPoint(p, vp, w, h);
    if (!s) return;
    const d = Math.hypot(s.x - px, s.y - py);
    if (d > 26) return;
    const score = d + s.depth * 0.0008;
    if (!best || score < best.score) best = { score, entry };
  };
  for (const road of State.net.roads) {
    const step = Math.max(1, Math.floor(road.path.length / 24));
    for (let i = 0; i < road.path.length; i += step) consider(road.path[i], { kind: 'road', id: road.id, road });
    consider(road.path[road.path.length - 1], { kind: 'road', id: road.id, road });
  }
  for (const node of State.net.nodes) consider({ x: node.x, y: node.y, z: node.z + 1 }, { kind: 'node', id: node.id, node });
  if (best) select(best.entry);
  else select(null);
}

function select(entry) {
  State.selection = entry;
  buildSelectionOverlay();
  if (State.rightTab === 'inspect') refreshRight();
  if (entry && entry.kind === 'road') {
    const road = entry.road || State.net.roadById(entry.id);
    if (road) setStatus(`${road.cls.toUpperCase()} ${road.id} · ${road.length.toFixed(1)} m · ${road.profileId}${road.name ? ' · ' + road.name : ''}`);
  } else if (entry && entry.kind === 'node') {
    const node = entry.node || State.net.nodes.find((n) => n.id === entry.id);
    if (node) setStatus(`Node ${node.id} · ${node.kind} · ${node.control} · ${node.arms.length} arms · fillet ${node.fillet.toFixed(1)} m`);
  }
}

function nodeOf(entry) {
  return entry.kind === 'node' ? entry.node || State.net.nodes.find((n) => n.id === entry.id) : null;
}

function buildSelectionOverlay() {
  const mb = new MeshBuilder('overlay');
  const sel = State.selection;
  if (!sel || !State.net) {
    renderer.setOverlay(null);
    return;
  }
  if (sel.kind === 'road') {
    const road = sel.road || State.net.roadById(sel.id);
    if (road) {
      const half = halfWidthOf(road.profile) + 0.6;
      for (let i = 0; i < road.path.length - 1; i++) {
        const a = road.path[i];
        const b = road.path[i + 1];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const l = Math.hypot(dx, dy) || 1;
        const nx = (-dy / l) * half;
        const ny = (dx / l) * half;
        const z = 0.9;
        const c = [1.0, 0.72, 0.2];
        const cols = [
          { x: a.x + nx, y: a.y + ny, z: a.z + z },
          { x: a.x - nx, y: a.y - ny, z: a.z + z },
          { x: b.x + nx, y: b.y + ny, z: b.z + z },
          { x: b.x - nx, y: b.y - ny, z: b.z + z },
        ];
        const n = { x: 0, y: 0, z: 1 };
        const v = cols.map((p) => mb.vertex(p, n, c, MAT.PAINT_YELLOW));
        mb.quadIdx(v[0], v[1], v[2], v[3], true);
        mb.quadIdx(v[2], v[3], v[0], v[1], true);
      }
      for (const end of [road.path[0], road.path[road.path.length - 1]]) {
        mb.box(end.x, end.y, end.z + 1.4, 2.4, 2.4, 2.4, MAT.PAINT_YELLOW, [1, 0.8, 0.3]);
      }
    }
  } else if (sel.kind === 'node') {
    const node = nodeOf(sel);
    if (node) {
      const r = clamp(node.width * 0.5, 3, 26);
      for (let i = 0; i < 40; i++) {
        const a0 = (i / 40) * Math.PI * 2;
        const a1 = ((i + 1) / 40) * Math.PI * 2;
        const p0 = { x: node.x + Math.cos(a0) * r, y: node.y + Math.sin(a0) * r, z: node.z + 1.2 };
        const p1 = { x: node.x + Math.cos(a1) * r, y: node.y + Math.sin(a1) * r, z: node.z + 1.2 };
        const n = { x: 0, y: 0, z: 1 };
        const v0 = mb.vertex(p0, n, [0.5, 0.9, 1], MAT.PAINT_BLUE);
        const v1 = mb.vertex(p1, n, [0.5, 0.9, 1], MAT.PAINT_BLUE);
        const v2 = mb.vertex({ ...p0, z: p0.z + 2.2 }, n, [0.5, 0.9, 1], MAT.PAINT_BLUE);
        const v3 = mb.vertex({ ...p1, z: p1.z + 2.2 }, n, [0.5, 0.9, 1], MAT.PAINT_BLUE);
        mb.quadIdx(v0, v1, v2, v3, true);
        mb.quadIdx(v3, v2, v0, v1, true);
      }
      for (const arm of node.arms) {
        const p = arm.which === 'a' ? arm.road.path[0] : arm.road.path[arm.road.path.length - 1];
        mb.box(p.x, p.y, p.z + 1.6, 1.6, 1.6, 1.6, MAT.PAINT_GREEN, [0.4, 1, 0.6]);
      }
    }
  }
  renderer.setOverlay(mb.toArrays());
}

function deleteSelected() {
  const sel = State.selection;
  if (!sel || sel.kind !== 'road' || !State.net) return;
  const road = sel.road || State.net.roadById(sel.id);
  if (!road) return;
  State.net.removeRoad(road);
  State.net.nodes = State.net.nodes.filter((n) => {
    n.arms = n.arms.filter((a) => a.roadId !== road.id);
    return n.arms.length >= 2;
  });
  refreshModelFromNetwork();
  select(null);
  setStatus(`Deleted ${road.cls} ${road.id}. Geometry rebuilt.`);
}

function refreshModelFromNetwork() {
  State.validation = validateNetwork(State.net);
  const model = buildRenderModel(State.net, State.terrain, { props: State.view.props, markings: State.view.markings });
  model.propGeometry = propGeometry;
  renderer.setModel(model);
  State.model = model;
  State.dirty = true;
  refreshPanels();
}

//--------------------------------------------------------------------------------------------------
//  Panels — left
//--------------------------------------------------------------------------------------------------
function refreshPanels() {
  refreshLeft();
  refreshRight();
  refreshViewTools();
  $('sceneName').textContent = State.net ? `${State.params.preset.toUpperCase()} · SEED ${State.params.seed}` : 'UNTITLED NETWORK';
  $('dirtyDot').classList.toggle('on', State.dirty);
}

function refreshLeft() {
  const body = clear($('leftBody'));
  if (State.leftTab === 'build') buildPanel(body);
  else if (State.leftTab === 'library') libraryPanel(body);
  else issuesPanel(body);
}

function labelledRange(label, value, min, max, step, onChange, format = (v) => v) {
  const val = el('span', { class: 'val', text: format(value) });
  const range = el('input', {
    type: 'range', min, max, step, value,
    oninput: (e) => {
      const v = Number(e.target.value);
      val.textContent = format(v);
      onChange(v);
    },
  });
  return { node: el('div', { class: 'field' }, [el('label', { text: label }), range]), val, range };
}

function switchRow(label, value, onChange) {
  const btn = el('button', { class: value ? 'on' : '' }, [el('i')]);
  btn.addEventListener('click', () => {
    const next = !btn.classList.contains('on');
    btn.classList.toggle('on', next);
    onChange(next);
  });
  return el('div', { class: 'switch' }, [el('span', { text: label }), btn]);
}

function buildPanel(root) {
  root.appendChild(
    el('div', { class: 'section' }, [
      el('h3', { text: 'City generator' }),
      el('div', { class: 'row-btns' }, [
        ...Object.entries(PRESETS).map(([key, preset]) =>
          el('button', {
            class: `btn ${State.params.preset === key ? 'primary' : ''}`,
            text: preset.label.split(' — ')[0],
            title: preset.label,
            onclick: () => {
              State.params.preset = key;
              applyPreset(key);
              refreshLeft();
              regenerate();
            },
          }),
        ),
      ]),
    ]),
  );

  const p = State.params;
  const size = el('div', { class: 'section' }, [el('h3', { text: 'Extent and structure' })]);
  const mk = (label, key, min, max, step, fmt, after) =>
    size.appendChild(
      labelledRange(label, p[key], min, max, step, (v) => {
        p[key] = v;
        State.dirty = true;
        if (after) after(v);
      }, fmt).node,
    );
  mk('Map size', 'extent', 800, 9000, 100, (v) => `${(v / 1000).toFixed(1)} km`);
  mk('Rings', 'rings', 0, 3, 1, (v) => `${v}`);
  mk('Radials', 'radials', 3, 12, 1, (v) => `${v}`);
  mk('Motorways', 'motorways', 0, 3, 1, (v) => `${v}`);
  mk('Railways', 'rail', 0, 3, 1, (v) => `${v}`);
  mk('Subway lines', 'subway', 0, 5, 1, (v) => `${v}`);
  mk('Terrain relief', 'relief', 0, 2, 0.05, (v) => v.toFixed(2));
  mk('Block density', 'density', 0.5, 2, 0.05, (v) => `${v.toFixed(2)}×`);
  root.appendChild(size);

  const features = el('div', { class: 'section' }, [el('h3', { text: 'Cross-section features' })]);
  features.appendChild(switchRow('Bus lanes', p.bus, (v) => ((p.bus = v), regenerate())));
  features.appendChild(switchRow('Cycle lanes', p.cycle, (v) => ((p.cycle = v), regenerate())));
  features.appendChild(switchRow('Parking lanes', p.parking, (v) => ((p.parking = v), regenerate())));
  features.appendChild(switchRow('Footways', p.sidewalk, (v) => ((p.sidewalk = v), regenerate())));
  features.appendChild(switchRow('Canyon circuit', p.canyon, (v) => ((p.canyon = v), regenerate())));
  features.appendChild(switchRow('River', p.river, (v) => ((p.river = v), regenerate())));
  root.appendChild(features);

  const seedSection = el('div', { class: 'section' }, [el('h3', { text: 'Seed' })]);
  seedSection.appendChild(
    el('div', { class: 'field' }, [
      el('label', { text: 'Seed' }),
      el('input', { type: 'number', value: p.seed, onchange: (e) => ((p.seed = Number(e.target.value) | 0), regenerate()) }),
    ]),
  );
  seedSection.appendChild(
    el('div', { class: 'row-btns' }, [
      el('button', { class: 'btn', text: 'Randomise seed', onclick: () => ((p.seed = (Math.random() * 1e9) | 0), regenerate()) }),
      el('button', { class: 'btn primary wide', text: 'Regenerate network  (G)', onclick: () => regenerate() }),
    ]),
  );
  seedSection.appendChild(el('p', { class: 'muted', text: 'Generation is deterministic: the same seed always produces the same city. A 6 km metro takes a few seconds.' }));
  root.appendChild(seedSection);
}

function applyPreset(key) {
  const preset = PRESETS[key];
  State.params = { ...State.params, ...preset, preset: key };
}

function profilePreview(profile, width = 54, height = 20) {
  const section = sectionOf(profile);
  const span = section.width || 1;
  const scale = width / span;
  const parts = [];
  const y0 = height - 2;
  for (const band of section.bands) {
    if (band.kind === 'kerb' || band.kind === 'apron') continue;
    const x0 = (band.x0 - section.leftEdge) * scale;
    const w = Math.max(1, (band.x1 - band.x0) * scale);
    const fill = surfaceColour(band);
    parts.push(`<rect x="${x0.toFixed(2)}" y="${(y0 - 5).toFixed(2)}" width="${w.toFixed(2)}" height="5" fill="${fill}"/>`);
  }
  for (const lane of section.lanes) {
    const x0 = (lane.x0 - section.leftEdge) * scale;
    const w = Math.max(1, (lane.x1 - lane.x0) * scale);
    parts.push(`<rect x="${x0.toFixed(2)}" y="${(y0 - 8).toFixed(2)}" width="${w.toFixed(2)}" height="3" fill="${laneColour(lane.kind)}"/>`);
  }
  for (const line of section.lines) {
    const x = (line.x - section.leftEdge) * scale;
    const stroke = line.style.includes('yellow') ? '#d8b53c' : line.style.includes('white') ? '#e8e8e8' : 'none';
    if (stroke !== 'none') parts.push(`<line x1="${x.toFixed(2)}" y1="${(y0 - 9).toFixed(2)}" x2="${x.toFixed(2)}" y2="${y0.toFixed(2)}" stroke="${stroke}" stroke-width="0.7"/>`);
  }
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#141414"/>${parts.join('')}</svg>`;
}

function surfaceColour(band) {
  if (band.kind === 'walk') return '#6f6f6f';
  if (band.kind === 'verge') return '#2f3a2a';
  if (band.kind === 'median') return '#4a4a4a';
  if (band.kind === 'rail') return '#565656';
  if (band.kind === 'ditch') return '#2a3326';
  if (band.kind === 'guard') return '#3a3a3a';
  if (band.tint) {
    const t = band.tint;
    const r = Math.round(clamp(t[0], 0, 1) * 90);
    const g = Math.round(clamp(t[1], 0, 1) * 90);
    const b = Math.round(clamp(t[2], 0, 1) * 90);
    return `rgb(${r},${g},${b})`;
  }
  return '#5a5a5a';
}

function laneColour(kind) {
  switch (kind) {
    case 'bus':
    case 'busway':
      return '#5f9c6a';
    case 'bike':
      return '#b0604f';
    case 'parking':
      return '#7d7d6a';
    case 'turn':
      return '#8a8a9a';
    case 'tram':
      return '#7a6a8a';
    case 'busstop':
      return '#8a8060';
    default:
      return '#4a4a4a';
  }
}

function libraryPanel(root) {
  root.appendChild(
    el('div', { class: 'section' }, [
      el('h3', { text: `Cross-section library — ${PROFILE_ORDER.length} profiles` }),
      el('p', { class: 'muted', text: 'Every road is a swept version of one of these. Select a profile to inspect its lane make-up and apply it to the selected road.' }),
    ]),
  );
  const list = el('div', { class: 'profile-list' });
  const current = selectedRoad();
  for (const id of PROFILE_ORDER) {
    const profile = PROFILES[id];
    if (!profile) continue;
    const section = sectionOf(profile);
    const badges = el('div', { class: 'chips' });
    const kinds = new Set(section.lanes.map((l) => l.kind));
    if (section.lanes.some((l) => l.kind === 'bus' || l.kind === 'busway')) badges.appendChild(el('span', { class: 'badge bus', text: 'BUS' }));
    if (kinds.has('bike')) badges.appendChild(el('span', { class: 'badge bike', text: 'CYCLE' }));
    if (kinds.has('parking')) badges.appendChild(el('span', { class: 'badge park', text: 'PARKING' }));
    if (section.hasSidewalk) badges.appendChild(el('span', { class: 'badge walk', text: 'FOOTWAY' }));
    if (profile.tram) badges.appendChild(el('span', { class: 'badge tram', text: 'TRAM' }));
    const item = el(
      'div',
      {
        class: `profile-item ${current && current.profileId === id ? 'active' : ''}`,
        title: `${profile.name} — ${section.width.toFixed(1)} m kerb to kerb, ${section.lanes.length} lanes`,
        onclick: () => {
          State.libraryProfile = id;
          const road = selectedRoad();
          if (road) {
            road.profileId = id;
            road.profile = PROFILES[id];
            road.profileId = id;
            refreshModelFromNetwork();
            setStatus(`Applied ${profile.name} to ${road.id}.`);
          }
          refreshLeft();
        },
      },
      [
        el('div', { html: profilePreview(profile) }),
        el('div', {}, [el('div', { class: 'name', text: profile.name }), el('div', { class: 'meta', text: `${section.width.toFixed(1)} m · ${section.lanes.length} lanes · ${profile.speed ?? '—'} km/h` }), badges]),
        el('span', { class: 'badge', text: profile.cls }),
      ],
    );
    list.appendChild(item);
  }
  root.appendChild(list);
}

function issuesPanel(root) {
  if (!State.validation) {
    root.appendChild(el('p', { class: 'muted', text: 'Generate a network to run the topology checks.' }));
    return;
  }
  const v = State.validation;
  root.appendChild(
    el('div', { class: 'section' }, [
      el('h3', { text: 'Topology validation' }),
      el('div', { class: 'kv' }, [
        el('span', { text: 'Errors' }),
        el('b', { text: String(v.errors) }),
        el('span', { text: 'Warnings' }),
        el('b', { text: String(v.warnings) }),
        el('span', { text: 'Information' }),
        el('b', { text: String(v.info) }),
      ]),
    ]),
  );
  const list = el('div', {});
  for (const issue of v.issues.slice(0, 220)) {
    list.appendChild(
      el('div', { class: 'issue', onclick: () => flyTo(issue.x, issue.y, 120) }, [
        el('span', { class: `sev ${issue.sev}` }),
        el('div', {}, [el('div', { text: issue.msg }), el('div', { class: 'code', text: issue.code + (issue.roadId ? ` · ${issue.roadId}` : '') })]),
      ]),
    );
  }
  root.appendChild(list);
}

//--------------------------------------------------------------------------------------------------
//  Panels — right
//--------------------------------------------------------------------------------------------------
function selectedRoad() {
  if (!State.selection || State.selection.kind !== 'road' || !State.net) return null;
  return State.selection.road || State.net.roadById(State.selection.id);
}

function refreshRight() {
  const body = clear($('rightBody'));
  if (State.rightTab === 'inspect') inspectorPanel(body);
  else if (State.rightTab === 'book') bookPanel(body);
  else statsPanel(body);
}

function inspectorPanel(root) {
  if (!State.net) {
    root.appendChild(el('p', { class: 'muted', text: 'No network yet. Press Regenerate on the Build tab, or hit the G key.' }));
    return;
  }
  const sel = State.selection;
  if (sel && sel.kind === 'road') {
    const road = selectedRoad();
    if (!road) {
      root.appendChild(el('p', { class: 'muted', text: 'Selected road no longer exists.' }));
      return;
    }
    refreshRoadInspector(root, road);
    return;
  }
  if (sel && sel.kind === 'node') {
    const node = nodeOf(sel);
    if (node) {
      refreshNodeInspector(root, node);
      return;
    }
  }
  root.appendChild(
    el('div', { class: 'section' }, [
      el('h3', { text: 'Selection' }),
      el('p', { class: 'muted', text: 'Click a road in the viewport to inspect it. Click a junction to see its arms, fillet radius and control type.' }),
    ]),
  );
  if (State.stats) {
    const s = State.stats;
    root.appendChild(
      el('div', { class: 'section' }, [
        el('h3', { text: 'Network' }),
        el('div', { class: 'kv' }, [
          el('span', { text: 'Roads' }), el('b', { text: s.roads.toLocaleString() }),
          el('span', { text: 'Junctions' }), el('b', { text: s.nodes.toLocaleString() }),
          el('span', { text: 'Centreline' }), el('b', { text: `${s.roadKm.toFixed(1)} km` }),
          el('span', { text: 'Lane length' }), el('b', { text: `${s.laneKm.toFixed(0)} lane-km` }),
          el('span', { text: 'Footway' }), el('b', { text: `${s.sidewalkKm.toFixed(1)} km` }),
          el('span', { text: 'Bridges' }), el('b', { text: `${s.bridgeKm.toFixed(2)} km` }),
          el('span', { text: 'Rail' }), el('b', { text: `${s.railKm.toFixed(1)} km` }),
          el('span', { text: 'Level crossings' }), el('b', { text: s.crossings }),
          el('span', { text: 'Subway' }), el('b', { text: `${s.subwayKm.toFixed(1)} km · ${s.stations} stations` }),
        ]),
      ]),
    );
  }
}

function refreshRoadInspector(root, road) {
  const section = sectionOf(road.profile);
  root.appendChild(
    el('div', { class: 'section' }, [
      el('h3', { text: `Selected · ${road.cls}` }),
      el('div', { class: 'kv' }, [
        el('span', { text: 'Identifier' }), el('b', { text: road.id }),
        el('span', { text: 'Profile' }), el('b', { text: road.profileId }),
        el('span', { text: 'Length' }), el('b', { text: `${road.length.toFixed(1)} m` }),
        el('span', { text: 'Kerb to kerb' }), el('b', { text: `${section.width.toFixed(2)} m` }),
        el('span', { text: 'Traffic lanes' }), el('b', { text: String(section.lanes.length) }),
        el('span', { text: 'Direction' }), el('b', { text: road.oneway ? 'one way' : 'two way' }),
        el('span', { text: 'Grade' }), el('b', { text: `${gradeOf(road).toFixed(1)} %` }),
        el('span', { text: 'Start node' }), el('b', { text: road.startNode ? road.startNode.id : '—' }),
        el('span', { text: 'End node' }), el('b', { text: road.endNode ? road.endNode.id : '—' }),
      ]),
    ]),
  );
  root.appendChild(el('div', { class: 'section' }, [el('h3', { text: 'Cross-section' }), el('div', { html: profilePreview(road.profile, 260, 34) })]));
  const laneList = el('div', { class: 'section' }, [el('h3', { text: 'Lanes, kerb to kerb' })]);
  for (const lane of section.lanes) {
    laneList.appendChild(
      el('div', { class: 'kv' }, [
        el('span', { text: `${lane.kind} · ${lane.dir < 0 ? 'inbound' : 'outbound'}` }),
        el('b', { text: `${(lane.x1 - lane.x0).toFixed(2)} m` }),
      ]),
    );
  }
  root.appendChild(laneList);

  const actions = el('div', { class: 'section' }, [el('h3', { text: 'Edit' })]);
  const profileSelect = el('select', {
    onchange: (e) => {
      road.profileId = e.target.value;
      road.profile = PROFILES[e.target.value];
      refreshModelFromNetwork();
      refreshRight();
    },
  });
  for (const id of PROFILE_ORDER) {
    if (!PROFILES[id]) continue;
    const opt = el('option', { value: id, text: PROFILES[id].name });
    if (id === road.profileId) opt.selected = true;
    profileSelect.appendChild(opt);
  }
  actions.appendChild(el('div', { class: 'field' }, [el('label', { text: 'Profile' }), profileSelect]));
  actions.appendChild(
    el('div', { class: 'row-btns' }, [
      el('button', {
        class: 'btn',
        text: road.oneway ? 'Make two-way' : 'Make one-way',
        onclick: () => {
          road.oneway = !road.oneway;
          refreshModelFromNetwork();
          refreshRight();
        },
      }),
      el('button', { class: 'btn', text: 'Focus  (F)', onclick: () => focusSelection() }),
      el('button', { class: 'btn danger', text: 'Delete  (Del)', onclick: () => deleteSelected() }),
    ]),
  );
  root.appendChild(actions);
}

function gradeOf(road) {
  if (road.path.length < 2) return 0;
  let max = 0;
  for (let i = 1; i < road.path.length; i++) {
    const dh = road.path[i].z - road.path[i - 1].z;
    const dl = Math.hypot(road.path[i].x - road.path[i - 1].x, road.path[i].y - road.path[i - 1].y) || 1e-6;
    max = Math.max(max, Math.abs(dh / dl));
  }
  return max * 100;
}

function refreshNodeInspector(root, node) {
  root.appendChild(
    el('div', { class: 'section' }, [
      el('h3', { text: 'Junction' }),
      el('div', { class: 'kv' }, [
        el('span', { text: 'Identifier' }), el('b', { text: node.id }),
        el('span', { text: 'Arms' }), el('b', { text: String(node.arms.length) }),
        el('span', { text: 'Form' }), el('b', { text: node.kind }),
        el('span', { text: 'Control' }), el('b', { text: node.control }),
        el('span', { text: 'Kerb return radius' }), el('b', { text: `${node.fillet.toFixed(1)} m` }),
        el('span', { text: 'Footprint' }), el('b', { text: `${node.width.toFixed(1)} m` }),
        el('span', { text: 'Grade separated' }), el('b', { text: node.gradeSep ? 'yes' : 'no' }),
      ]),
    ]),
  );
  const arms = el('div', { class: 'section' }, [el('h3', { text: 'Arms, clockwise' })]);
  for (const arm of node.arms) {
    const bearing = ((Math.atan2(arm.outward.x, arm.outward.y) / DEG + 360) % 360).toFixed(0);
    arms.appendChild(
      el('div', { class: 'kv' }, [
        el('span', { text: `${arm.cls} · ${arm.lanes} lanes · ${bearing}°` }),
        el('b', { text: `${arm.halfWidth.toFixed(1)} m` }),
      ]),
    );
  }
  root.appendChild(arms);
  root.appendChild(
    el('div', { class: 'row-btns' }, [
      el('button', { class: 'btn', text: 'Focus', onclick: () => flyTo(node.x, node.y, 80) }),
    ]),
  );
}

function bookPanel(root) {
  if (!State.net) {
    root.appendChild(el('p', { class: 'muted', text: 'Nothing to list yet.' }));
    return;
  }
  const sortKey = State.bookSort || 'length';
  const roads = State.net.roads.slice().sort((a, b) => (sortKey === 'length' ? b.length - a.length : a.id.localeCompare(b.id)));
  const head = el('tr', {}, [
    el('th', { text: 'Road', onclick: () => ((State.bookSort = 'id'), refreshRight()), style: 'cursor:pointer' }),
    el('th', { text: 'Class', onclick: () => ((State.bookSort = 'id'), refreshRight()), style: 'cursor:pointer' }),
    el('th', { text: 'Lanes' }),
    el('th', { text: 'Profile' }),
    el('th', { text: 'Length', onclick: () => ((State.bookSort = 'length'), refreshRight()), style: 'cursor:pointer' }),
  ]);
  const table = el('table', { class: 'book' }, [el('thead', {}, [head])]);
  const body = el('tbody');
  const sel = selectedRoad();
  for (const road of roads.slice(0, 400)) {
    const section = sectionOf(road.profile);
    body.appendChild(
      el(
        'tr',
        {
          class: sel && sel.id === road.id ? 'sel' : '',
          onclick: () => {
            select({ kind: 'road', id: road.id, road });
            refreshRight();
            flyTo(road.path[0].x, road.path[0].y, Math.max(60, road.length * 0.5));
          },
        },
        [
          el('td', { text: road.id }),
          el('td', { text: road.cls }),
          el('td', { text: String(section.lanes.length) }),
          el('td', { text: road.profileId, title: road.profileId }),
          el('td', { text: `${road.length.toFixed(0)} m` }),
        ],
      ),
    );
  }
  table.appendChild(body);
  root.appendChild(el('p', { class: 'muted', text: `Showing ${Math.min(400, roads.length)} of ${State.net.roads.length} roads, longest first. Click a row to select and fly to it.` }));
  root.appendChild(table);
}

function statsPanel(root) {
  if (!State.stats || !State.model) {
    root.appendChild(el('p', { class: 'muted', text: 'Generate a network first.' }));
    return;
  }
  const s = State.stats;
  const m = State.model;
  const tri = (b) => b.triCount.toLocaleString();
  root.appendChild(
    el('div', { class: 'section' }, [
      el('h3', { text: 'Geometry' }),
      el('div', { class: 'kv' }, [
        el('span', { text: 'Road surfaces' }), el('b', { text: `${tri(m.surfaces)} tris` }),
        el('span', { text: 'Markings' }), el('b', { text: `${tri(m.markings)} tris` }),
        el('span', { text: 'Structures' }), el('b', { text: `${tri(m.structures)} tris` }),
        el('span', { text: 'Rail' }), el('b', { text: `${tri(m.rail)} tris` }),
        el('span', { text: 'Subway' }), el('b', { text: `${tri(m.subway)} tris` }),
        el('span', { text: 'Props (instanced)' }), el('b', { text: `${m.instances.length.toLocaleString()} instances` }),
        el('span', { text: 'Overlay' }), el('b', { text: `${tri(m.xray)} tris` }),
      ]),
    ]),
  );
  const kinds = el('div', { class: 'section' }, [el('h3', { text: 'Prop inventory' })]);
  for (const [kind, count] of Object.entries(m.instanceKinds)) {
    kinds.appendChild(el('div', { class: 'kv' }, [el('span', { text: kind }), el('b', { text: count.toLocaleString() })]));
  }
  root.appendChild(kinds);
  const timing = el('div', { class: 'section' }, [el('h3', { text: 'Build timings' })]);
  timing.appendChild(el('div', { class: 'kv' }, [
    el('span', { text: 'Network generation' }), el('b', { text: `${Math.round(State.generated || 0)} ms` }),
    el('span', { text: 'Geometry build' }), el('b', { text: `${Math.round(State.buildMs || 0)} ms` }),
    ...Object.entries(State.report && State.report.stages ? State.report.stages : {}).map(([k, v]) => [el('span', { text: `· ${k}` }), el('b', { text: `${Math.round(v)} ms` })]).flat(),
  ]));
  root.appendChild(timing);
  const cls = el('div', { class: 'section' }, [el('h3', { text: 'Roads by class' })]);
  for (const [k, v] of Object.entries(s.byClass)) {
    cls.appendChild(el('div', { class: 'kv' }, [el('span', { text: k }), el('b', { text: String(v) })]));
  }
  root.appendChild(cls);
}

//--------------------------------------------------------------------------------------------------
//  View tools
//--------------------------------------------------------------------------------------------------
function refreshViewTools() {
  const box = clear($('viewTools'));
  const mk = (label, key, title) =>
    el('button', { class: `tool ${State.view[key] ? 'active' : ''}`, text: label, title, onclick: () => toggle(key) });
  box.appendChild(mk('X-ray', 'xray', 'Skeleton overlay of the network (X)'));
  box.appendChild(mk('Markings', 'markings', 'Lane lines, crossings and arrows (M)'));
  box.appendChild(mk('Props', 'props', 'Street furniture (P)'));
  box.appendChild(mk('Shadows', 'shadows', 'Directional shadows (H)'));

  const time = el('div', { class: 'tool', title: 'Time of day' }, [
    el('span', { text: 'Sun ' }),
    el('input', {
      type: 'range', min: 4, max: 21, step: 0.1, value: State.view.time,
      oninput: (e) => {
        State.view.time = Number(e.target.value);
        refreshHud();
      },
    }),
  ]);
  box.appendChild(time);
  box.appendChild(
    el('div', { class: 'tool', title: 'Fog density' }, [
      el('span', { text: 'Haze ' }),
      el('input', {
        type: 'range', min: 0, max: 3, step: 0.05, value: State.view.fog,
        oninput: (e) => {
          State.view.fog = Number(e.target.value);
        },
      }),
    ]),
  );
}

function toggle(key) {
  State.view[key] = !State.view[key];
  if (key === 'markings' || key === 'props') {
    refreshModelFromNetwork();
  } else {
    refreshViewTools();
  }
  if (key === 'xray') refreshViewTools();
}

function setPreset(kind) {
  const centre = State.net ? { x: 0, y: 0, z: 0 } : { x: 0, y: 0, z: 0 };
  const extent = State.params.extent;
  camera.preset(kind, centre, extent);
  document.querySelectorAll('#viewPresets button').forEach((b) => b.classList.toggle('active', b.dataset.preset === kind));
  refreshHud();
}

function focusSelection() {
  const road = selectedRoad();
  if (road) {
    const mid = road.path[Math.floor(road.path.length / 2)];
    camera.focus(mid.x, mid.y, mid.z, Math.max(30, road.length * 0.35));
    setStatus(`Focused ${road.id}.`);
    return;
  }
  const node = State.selection && State.selection.kind === 'node' ? nodeOf(State.selection) : null;
  if (node) {
    camera.focus(node.x, node.y, node.z, 70);
    return;
  }
  setStatus('Nothing selected.');
}

function flyTo(x, y, distance = 120) {
  camera.position = { x: x - Math.sin(camera.yaw) * distance * 0.8, y: y - Math.cos(camera.yaw) * distance * 0.8, z: (State.terrain ? State.terrain.height(x, y) : 0) + distance * 0.5 };
  camera.pitch = -22 * DEG;
}

//--------------------------------------------------------------------------------------------------
//  Sun / sky from the time of day
//--------------------------------------------------------------------------------------------------
function sunState() {
  const t = State.view.time;
  const dayFraction = (t - 6) / 12; // 6am sunrise, 6pm sunset
  const elevation = Math.sin(clamp(dayFraction, -0.35, 1.35) * Math.PI) * 78 - 6;
  const azimuth = State.view.sunAzimuth + (dayFraction - 0.5) * 60;
  const el_ = elevation * DEG;
  const az = azimuth * DEG;
  const dir = { x: Math.cos(el_) * Math.sin(az), y: Math.cos(el_) * Math.cos(az), z: Math.max(-0.25, Math.sin(el_)) };
  const warm = clamp(1 - Math.max(0, dir.z) * 1.6, 0, 1);
  const intensity = clamp(0.12 + Math.max(0, dir.z) * 1.5, 0.12, 1.6);
  const sunColour = [intensity * lerp(1.0, 1.25, warm), intensity * lerp(0.98, 1.05, warm), intensity * lerp(0.94, 0.72, warm)];
  const dusk = Math.max(0, 1 - Math.abs(t - 6) / 2.2) + Math.max(0, 1 - Math.abs(t - 19) / 2.4);
  const skyColour = [
    lerp(0.35, 0.55, clamp(dir.z, 0, 1)) + dusk * 0.25,
    lerp(0.45, 0.68, clamp(dir.z, 0, 1)) + dusk * 0.08,
    lerp(0.62, 0.92, clamp(dir.z, 0, 1)) - dusk * 0.06,
  ];
  const groundColour = [0.1 + dusk * 0.12, 0.11 + dusk * 0.08, 0.12 + dusk * 0.06];
  return { dir, sunColour, skyColour, groundColour, night: dir.z < 0.02 };
}

//--------------------------------------------------------------------------------------------------
//  HUD
//--------------------------------------------------------------------------------------------------
function refreshHud() {
  const box = clear($('hud'));
  const p = camera.position;
  const rows = [
    `pos  ${p.x.toFixed(0)}, ${p.y.toFixed(0)}, ${p.z.toFixed(0)}`,
    `mode ${camera.mode}${input.state.mode === 'orbit' ? ' (orbit)' : ''}  ·  speed ${camera.speed.toFixed(0)} m/s`,
    `look  ${(((camera.yaw / DEG) % 360 + 360) % 360).toFixed(0)}° / ${(camera.pitch / DEG).toFixed(0)}°`,
    `time  ${State.view.time.toFixed(1)} h  ·  haze ${State.view.fog.toFixed(2)}`,
  ];
  for (const r of rows) box.appendChild(el('div', { class: 'row', text: r }));
  const legend = clear($('legend'));
  const items = [
    ['motorway', '#ff5252'], ['trunk', '#ffb142'], ['arterial', '#ffe066'], ['collector', '#c8f56b'],
    ['local', '#8fd3ff'], ['alley', '#7d8bff'], ['service', '#b39ddb'], ['canyon', '#26c6da'],
    ['footway', '#f48fb1'], ['cycleway', '#69f0ae'], ['ramp', '#ff7043'],
  ];
  for (const [name, colour] of items) {
    legend.appendChild(el('div', { class: 'row' }, [el('span', { html: `<span style="display:inline-block;width:8px;height:3px;background:${colour};vertical-align:middle;margin-right:6px"></span>` }), el('span', { text: name })]));
  }
  legend.style.display = State.view.xray ? 'grid' : 'none';
}

//--------------------------------------------------------------------------------------------------
//  Export / import
//--------------------------------------------------------------------------------------------------
function download(name, text, type = 'text/plain') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function exportJSON() {
  if (!State.net) return setStatus('Nothing to export.');
  const data = {
    format: 'slate-road-network',
    version: 1,
    params: State.params,
    roads: State.net.roads.map((r) => ({
      id: r.id, cls: r.cls, profile: r.profileId, oneway: r.oneway, name: r.name,
      path: r.path.map((p) => [Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100, Math.round(p.z * 100) / 100]),
    })),
    railways: State.net.railways.map((r) => ({ id: r.id, name: r.name, path: r.path.map((p) => [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10, Math.round(p.z * 10) / 10]) })),
    subways: State.net.subways.map((s) => ({ id: s.id, name: s.name, colour: s.colour, stations: s.stations.map((st) => ({ name: st.name, x: st.x, y: st.y })), path: s.path.map((p) => [Math.round(p.x), Math.round(p.y), Math.round(p.z)]) })),
  };
  download(`slate-network-${State.params.seed}.json`, JSON.stringify(data), 'application/json');
  setStatus('Network exported as JSON.');
}

function exportOBJ() {
  if (!State.model) return setStatus('Nothing to export.');
  const parts = [];
  let base = 1;
  const push = (mesh, name) => {
    parts.push(`o ${name}`);
    const pos = mesh.position;
    for (let i = 0; i < pos.length; i += 3) parts.push(`v ${pos[i].toFixed(3)} ${pos[i + 1].toFixed(3)} ${pos[i + 2].toFixed(3)}`);
    const idx = mesh.index;
    const big = idx.length > 65535 || mesh.index32;
    for (let i = 0; i < idx.length; i += 3) parts.push(`f ${idx[i] + base} ${idx[i + 1] + base} ${idx[i + 2] + base}`);
    base += pos.length / 3;
  };
  push(State.model.surfaces, 'road_surfaces');
  push(State.model.markings, 'road_markings');
  push(State.model.structures, 'structures');
  push(State.model.rail, 'railway');
  push(State.model.subway, 'subway');
  download(`slate-city-${State.params.seed}.obj`, parts.join('\n'), 'text/plain');
  setStatus(`OBJ exported (${(parts.length / 1e6).toFixed(1)}M lines). Large maps take a while in Blender.`);
}

function screenshot() {
  const canvas = $('gl');
  const url = canvas.toDataURL('image/png');
  const a = el('a', { href: url, download: `slate-view-${Date.now()}.png` });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setStatus('Screenshot saved.');
}

function saveLocal() {
  if (!State.net) return setStatus('Nothing to save.');
  try {
    localStorage.setItem('slate.roadeditor.v1', JSON.stringify({ params: State.params, at: Date.now() }));
    setStatus('Session parameters saved to local storage. Exported JSON holds the actual network.');
  } catch (e) {
    setStatus('Local storage refused the save.');
  }
}

function loadLocal() {
  try {
    const raw = localStorage.getItem('slate.roadeditor.v1');
    if (!raw) return setStatus('No saved session.');
    const data = JSON.parse(raw);
    State.params = { ...State.params, ...data.params };
    refreshPanels();
    regenerate();
  } catch (e) {
    setStatus('Saved session could not be read.');
  }
}

//--------------------------------------------------------------------------------------------------
//  Render loop
//--------------------------------------------------------------------------------------------------
let last = performance.now();
let frames = 0;
let fpsTime = 0;
let fps = 0;

function frame(nowMs) {
  const dt = Math.min(0.05, (nowMs - last) / 1000);
  last = nowMs;
  const state = input.consume();
  input.mode = camera.mode;
  state.mode = camera.mode;
  camera.update(dt, state);
  const sun = sunState();
  const rect = $('gl').getBoundingClientRect();
  const aspect = Math.max(0.2, rect.width / Math.max(1, rect.height));
  const view = {
    eye: camera.position,
    forward: camera.forward,
    view: camera.viewMatrix(),
    projection: camera.projectionMatrix(aspect),
    sunDir: sun.dir,
    sunColour: sun.sunColour,
    skyColour: sun.skyColour,
    groundColour: sun.groundColour,
    exposure: State.view.exposure,
    fogDensity: 0.00016 * State.view.fog,
    time: nowMs / 1000,
    shadows: State.view.shadows,
    xray: State.view.xray,
    pulse: 0.5 + 0.5 * Math.sin(nowMs / 400),
    shadowRadius: Math.max(180, Math.min(700, camera.speed * 4)),
  };
  try {
    const stats = renderer.render(view);
    frames++;
    fpsTime += dt;
    if (fpsTime > 0.5) {
      fps = frames / fpsTime;
      frames = 0;
      fpsTime = 0;
    }
    $('perf').textContent = `${fps.toFixed(0)} fps · ${stats.drawCalls} draws · ${(stats.tris / 1000).toFixed(0)}k tris`;
  } catch (err) {
    showFatal(err);
    return;
  }
  input.endFrame();
  requestAnimationFrame(frame);
}

//--------------------------------------------------------------------------------------------------
//  Wiring
//--------------------------------------------------------------------------------------------------
function buildShell() {
  const presets = $('viewPresets');
  for (const [key, label] of [['map', 'Map'], ['top', 'Top'], ['street', 'Street'], ['chase', 'Chase']]) {
    presets.appendChild(el('button', { text: label, 'data-preset': key, onclick: () => setPreset(key) }));
  }
  document.querySelectorAll('#leftTabs button').forEach((btn) =>
    btn.addEventListener('click', () => {
      document.querySelectorAll('#leftTabs button').forEach((b) => b.classList.toggle('active', b === btn));
      State.leftTab = btn.dataset.tab;
      refreshLeft();
    }),
  );
  document.querySelectorAll('#rightTabs button').forEach((btn) =>
    btn.addEventListener('click', () => {
      document.querySelectorAll('#rightTabs button').forEach((b) => b.classList.toggle('active', b === btn));
      State.rightTab = btn.dataset.tab;
      refreshRight();
    }),
  );
  $('btnSave').addEventListener('click', saveLocal);
  $('btnLoad').addEventListener('click', loadLocal);
  $('btnExportJson').addEventListener('click', exportJSON);
  $('btnExportObj').addEventListener('click', exportOBJ);
  $('btnShot').addEventListener('click', screenshot);
  $('btnHelp').addEventListener('click', () => $('helpOverlay').classList.toggle('on'));
  $('helpOverlay').addEventListener('click', () => $('helpOverlay').classList.remove('on'));

  const help = $('helpOverlay');
  const rows = [
    ['Move', 'W A S D'],
    ['Up / down', 'E / Q  (Space, C)'],
    ['Look', 'hold right mouse and drag'],
    ['Fast / slow', 'Shift / Ctrl'],
    ['Fly speed', 'mouse wheel'],
    ['Orbit', 'hold Alt + drag  (or middle drag)'],
    ['Focus selection', 'F'],
    ['View presets', '1 map · 2 top · 3 street · 4 chase'],
    ['Skeleton overlay', 'X'],
    ['Markings / props / shadows', 'M / P / H'],
    ['Regenerate', 'G'],
    ['Delete selected road', 'Del'],
    ['Deselect / close', 'Esc'],
  ];
  help.appendChild(el('h3', { text: 'Controls' }));
  const grid = el('div', { class: 'help-grid' });
  for (const [label, keys] of rows) grid.appendChild(el('div', {}, [el('span', { text: label }), el('b', { text: keys })]));
  help.appendChild(grid);
  help.appendChild(el('p', { class: 'muted', text: 'Click anywhere to close. The camera starts in the air over the city centre; press 2 for the map view or 3 for a street view.' }));
}

function init() {
  buildShell();
  refreshPanels();
  refreshHud();
  setPreset('map');
  requestAnimationFrame(frame);
  setTimeout(() => regenerate(), 60);
  window.addEventListener('resize', () => refreshHud());
}

try {
  init();
  if (!globalThis.__SLATE_HEADLESS) setTimeout(() => regenerate(), 60);
} catch (err) {
  showFatal(err);
}

//--------------------------------------------------------------------------------------------------
//  Test hooks. The headless harness drives exactly the same functions the UI does; there is no
//  second code path that could pass while the real one fails.
//--------------------------------------------------------------------------------------------------
export const __state = State;
export const __renderer = renderer;
export const __camera = camera;
export const __input = input;
export const __regenerate = regenerate;
export const __regenerateForTest = () => regenerate();
export const __setParams = (p) => {
  State.params = { ...State.params, ...p };
};
export const __selectNearest = (x, y) => pick(x, y);
export const __probePick = (px, py) => {
  if (!State.net) return { error: 'no network' };
  const rect = $('gl').getBoundingClientRect();
  const vp = mul4(camera.projectionMatrix(rect.width / Math.max(1, rect.height)), camera.viewMatrix());
  let min = Infinity;
  let inside = 0;
  let total = 0;
  for (const road of State.net.roads) {
    for (const p of road.path) {
      total++;
      const s = projectPoint(p, vp, rect.width, rect.height);
      if (!s) continue;
      if (s.x >= 0 && s.x <= rect.width && s.y >= 0 && s.y <= rect.height) inside++;
      const d = Math.hypot(s.x - px, s.y - py);
      if (d < min) min = d;
    }
  }
  return { total, inside, nearest: +min.toFixed(1), camera: { x: camera.position.x, y: camera.position.y, z: camera.position.z, mode: camera.mode, yaw: +camera.yaw.toFixed(2), pitch: +camera.pitch.toFixed(2) } };
};
export const __select = select;
export const __refreshPanels = refreshPanels;
export const __refreshHud = refreshHud;
export const __refreshModel = refreshModelFromNetwork;
export const __setLeftTab = (t) => {
  State.leftTab = t;
  refreshLeft();
};
export const __setRightTab = (t) => {
  State.rightTab = t;
  refreshRight();
};
export const __setPreset = setPreset;
export const __setView = (k, v) => {
  State.view[k] = v;
  if (k === 'markings' || k === 'props') refreshModelFromNetwork();
  else refreshViewTools();
};
export const __sunState = sunState;
export const __renderOnce = () => {
  const rect = $('gl').getBoundingClientRect();
  const sun = sunState();
  return renderer.render({
    eye: camera.position,
    forward: camera.forward,
    view: camera.viewMatrix(),
    projection: camera.projectionMatrix(rect.width / Math.max(1, rect.height)),
    sunDir: sun.dir,
    sunColour: sun.sunColour,
    skyColour: sun.skyColour,
    groundColour: sun.groundColour,
    exposure: State.view.exposure,
    fogDensity: 0.00016 * State.view.fog,
    time: 12,
    shadows: State.view.shadows,
    xray: State.view.xray,
    pulse: 1,
    shadowRadius: 300,
  });
};
export const __exportJSONForTest = () => exportJSON();
