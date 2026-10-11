// Context inspector: scene settings, layer, texture channel, intersection or road.

import { h, clear, card, slider, toggleRow, selectRow, readout, swatches, actions, mini, rgb } from './widgets.js';
import { icon } from './icons.js';
import { PAVING_PATTERNS, ENV_PRESETS } from '../gfx/materials.js';
import { ROAD_CLASS, defaultProfile } from '../road/profile.js';
import { PRESETS } from '../road/generator.js';

const PAINTS = [
  [0.35, 0.36, 0.38], [0.52, 0.52, 0.53], [0.08, 0.09, 0.10], [0.62, 0.60, 0.56],
  [0.34, 0.38, 0.45], [0.42, 0.33, 0.28], [0.30, 0.40, 0.34], [0.46, 0.44, 0.40],
];

export function renderInspector(editor, root, api) {
  clear(root);
  const sel = editor.selection;
  if (!sel) return sceneInspector(editor, root, api);
  if (sel.type === 'layer') return layerInspector(editor, root, api);
  if (sel.type === 'channel') return channelInspector(editor, root, api);
  if (sel.type === 'junction') return junctionInspector(editor, root, api);
  if (sel.type === 'road') return roadInspector(editor, root, api);
  return sceneInspector(editor, root, api);
}

function head(root, { eyebrow, title, iconName, pill, pillOn }) {
  root.append(h('div', { class: 'insp-top' },
    h('div', { class: 'insp-icon', html: icon(iconName, 22) }),
    h('div', { class: 'insp-head' },
      h('div', { class: 'eyebrow' }, eyebrow),
      h('h1', {}, title)),
    pill ? h('span', { class: `pill${pillOn ? ' on' : ''}` }, pill) : null));
  const body = h('div', { class: 'insp-body' });
  root.append(body);
  return body;
}

// ---------------------------------------------------------------- scene
function sceneInspector(editor, root, api) {
  const s = editor.settings;
  const st = editor.scene?.stats;
  const body = head(root, {
    eyebrow: 'Generator', title: PRESETS[s.preset]?.label || 'Road network', iconName: 'grid',
    pill: `seed ${s.seed}`,
  });

  body.append(card('Network', 'Blocks, cell size and curvature drive the base grid before the hierarchy, motorway and railway are laid over it.',
    selectRow('Preset', s.preset, Object.entries(PRESETS).map(([k, v]) => [k, v.label]), (v) => { editor.setPreset(v); api.refreshAll(); }),
    slider('Blocks across', s.blocksX, { min: 2, max: 8, step: 1, format: (v) => v.toFixed(0), onInput: (v) => editor.setSetting('blocksX', v) }),
    slider('Blocks deep', s.blocksZ, { min: 2, max: 8, step: 1, format: (v) => v.toFixed(0), onInput: (v) => editor.setSetting('blocksZ', v) }),
    slider('Cell size', s.cell, { min: 70, max: 220, step: 1, format: (v) => `${v.toFixed(0)} m`, onInput: (v) => editor.setSetting('cell', v) }),
    slider('Curvature', s.curvature, { min: 0, max: 1, onInput: (v) => editor.setSetting('curvature', v) }),
    slider('Terrain relief', s.terrain, { min: 0, max: 1, onInput: (v) => editor.setSetting('terrain', v) }),
    toggleRow('Motorway + interchange', s.highway, (v) => editor.setSetting('highway', v)),
    toggleRow('Railway + level crossings', s.rail, (v) => editor.setSetting('rail', v)),
    toggleRow('Subway tunnel', s.subway, (v) => editor.setSetting('subway', v)),
    actions(
      mini('Generate network', () => api.generate()),
      mini('New seed', () => { editor.setSetting('seed', (Math.random() * 1e6) | 0); api.generate(); }))));

  body.append(card('Road condition', 'Wear, potholes, patches, speed tables and live roadworks are baked into the carriageway mesh, not faked with decals.',
    slider('Surface damage', s.damage, { min: 0, max: 1, onInput: (v) => editor.setSetting('damage', v) }),
    slider('Roadworks sites', s.works, { min: 0, max: 6, step: 1, format: (v) => v.toFixed(0), onInput: (v) => editor.setSetting('works', v) }),
    slider('Kerbside parking', s.parkingDensity, { min: 0, max: 1, onInput: (v) => editor.setSetting('parkingDensity', v) }),
    toggleRow('Traffic calming (speed tables)', s.calming, (v) => editor.setSetting('calming', v)),
    toggleRow('Parked cars', s.parkedCars, (v) => editor.setSetting('parkedCars', v)),
    slider('Prop density', s.propDensity, { min: 0.2, max: 2, onInput: (v) => editor.setSetting('propDensity', v) }),
    slider('AI vehicles', s.trafficCount, {
      min: 0, max: 25, step: 1, format: (v) => v.toFixed(0),
      onInput: (v) => { editor.setSetting('trafficCount', v); api.setFleet(v); },
    })));

  body.append(envCard(editor, api));

  if (st) {
    body.append(card('Build report', null,
      readout('Roads', `${st.roads} · ${st.lengthKm.toFixed(2)} km`),
      readout('Intersections', `${st.junctions} of ${st.nodes} nodes`),
      readout('City blocks', String(st.blocks)),
      readout('Vertices', st.vertices.toLocaleString()),
      readout('Quads', st.quads.toLocaleString()),
      readout('Triangles', st.triangles.toLocaleString()),
      readout('Quad coverage', `${(st.quadRatio * 100).toFixed(1)} %`),
      readout('Build time', `${(editor.buildMs || 0).toFixed(0)} ms`)));
  }
}

function envCard(editor, api) {
  const e = editor.env;
  return card('Environment', 'Sun, sky and grading. Street lighting switches on with the night factor.',
    selectRow('Preset', editor.envName, Object.entries(ENV_PRESETS).map(([k, v]) => [k, v.name]), (v) => { editor.setEnv(v); api.refreshInspector(); }),
    slider('Sun azimuth', e.sunAzimuth, { min: 0, max: 6.283, format: (v) => `${((v * 180) / Math.PI).toFixed(0)}°`, onInput: (v) => editor.setEnvValue('sunAzimuth', v) }),
    slider('Sun elevation', e.sunElevation, { min: -0.3, max: 1.5, format: (v) => `${((v * 180) / Math.PI).toFixed(0)}°`, onInput: (v) => editor.setEnvValue('sunElevation', v) }),
    slider('Sun intensity', e.sunIntensity, { min: 0, max: 8, onInput: (v) => editor.setEnvValue('sunIntensity', v) }),
    slider('Night / street lighting', e.night, { min: 0, max: 1, onInput: (v) => editor.setEnvValue('night', v) }),
    slider('Wetness', e.wetness, { min: 0, max: 1, onInput: (v) => editor.setEnvValue('wetness', v) }),
    slider('Shadow strength', e.shadow, { min: 0, max: 1, onInput: (v) => editor.setEnvValue('shadow', v) }),
    slider('Fog density', e.fogDensity * 1000, { min: 0, max: 3, format: (v) => v.toFixed(2), onInput: (v) => editor.setEnvValue('fogDensity', v / 1000) }),
    slider('Exposure', e.exposure, { min: 0.3, max: 2.5, onInput: (v) => editor.setEnvValue('exposure', v) }),
    slider('Global wear', e.wearGain, { min: 0, max: 2, onInput: (v) => editor.setEnvValue('wearGain', v) }),
    toggleRow('Road markings', e.markings !== false, (v) => editor.setEnvValue('markings', v)));
}

// ---------------------------------------------------------------- layer
function layerInspector(editor, root, api) {
  const layer = editor.scene.layers.find((l) => l.id === editor.selection.id);
  if (!layer) return sceneInspector(editor, root, api);
  const hidden = editor.hidden.has(layer.id);
  const body = head(root, {
    eyebrow: layer.group, title: layer.name, iconName: layer.icon,
    pill: hidden ? 'hidden' : 'visible', pillOn: !hidden,
  });

  body.append(card('Layer', layerBlurb(layer.id),
    toggleRow('Visible', !hidden, (v) => { editor.toggleLayer(layer.id, v); api.refreshStack(); }),
    readout('Kind', layer.kind === 'instanced' ? 'GPU instanced' : 'Static mesh'),
    layer.mesh ? readout('Vertices', layer.mesh.vertexCount.toLocaleString()) : null,
    layer.mesh ? readout('Quads', layer.mesh.quadCount.toLocaleString()) : null,
    layer.mesh ? readout('Triangles', layer.mesh.triCount.toLocaleString()) : null,
    layer.mesh ? readout('Quad coverage', `${((layer.mesh.quadCount * 2 / Math.max(layer.mesh.triCount, 1)) * 100).toFixed(1)} %`) : null,
    layer.kind === 'instanced' ? readout('Instances', String(layer.count)) : null));

  if (layer.id === 'surface') {
    body.append(card('Carriageway', 'The whole road shell is one welded mesh: ribbons, kerb returns and junction plates share vertices.',
      toggleRow('Quad wireframe', editor.view.wireframe, (v) => editor.setView('wireframe', v)),
      toggleRow('Road markings', editor.env.markings !== false, (v) => editor.setEnvValue('markings', v)),
      slider('Global wear', editor.env.wearGain, { min: 0, max: 2, onInput: (v) => editor.setEnvValue('wearGain', v) })));
  }
  if (layer.id === 'traffic') {
    body.append(card('Simulation', 'Car-following (IDM), signal phases, gap acceptance and level-crossing interlocks. Hard capped at 25 vehicles.',
      toggleRow('Run simulation', editor.view.simulate, (v) => editor.setView('simulate', v)),
      slider('Fleet size', editor.settings.trafficCount, {
        min: 0, max: 25, step: 1, format: (v) => v.toFixed(0),
        onInput: (v) => { editor.setSetting('trafficCount', v); api.setFleet(v); },
      }),
      slider('Time scale', editor.view.timeScale, { min: 0, max: 3, onInput: (v) => editor.setView('timeScale', v) }),
      toggleRow('Show lane graph', editor.view.laneGraph, (v) => editor.setView('laneGraph', v))));
  }
}

function layerBlurb(id) {
  const map = {
    surface: 'Carriageway, gutters, kerbs, footways and every junction plate — welded into a single quad shell.',
    blocks: 'Closed city blocks lifted off the kerb line and paved with one of seven bonds. No buildings, by design.',
    rail: 'Ballast, sleepers and UIC60 rail, broken and re-laid through each level crossing.',
    crossing: 'Barriers, booms and warning lights, interlocked with the train simulation.',
    bridges: 'Decks, parapets and piers where the network crosses itself or the railway.',
    tunnels: 'Portals and linings for the underpass sections.',
    subway: 'Cut-and-cover subway bore under the city, hidden by default.',
    lighting: 'Column, bracket and lantern geometry; each lamp also feeds the GPU light list at night.',
    signals: 'Signal heads whose lenses read the live controller state through the vertex stream.',
  };
  return map[id] || null;
}

// ---------------------------------------------------------------- texture channel
function channelInspector(editor, root, api) {
  const c = editor.channel(editor.selection.id);
  if (!c) return sceneInspector(editor, root, api);
  const body = head(root, {
    eyebrow: `Texturing · ${c.group}`, title: c.name, iconName: 'palette',
    pill: c.enabled ? 'procedural' : 'flat colour', pillOn: c.enabled,
  });

  const paving = c.id === 'footway' || c.id === 'blocks';
  body.append(card('Material', c.note || 'Procedural material evaluated per pixel in WGSL — no texture files.',
    toggleRow('Procedural detail', c.enabled, (v) => { editor.setChannelValue(c.id, 'enabled', v); api.refreshStack(); api.refreshInspector(); }),
    h('div', { class: 'slider' }, h('div', { class: 'srow' }, h('span', { class: 'sname' }, 'Base colour'), h('span', { class: 'sval' }, rgb(c.albedo))),
      swatches(PAINTS.concat([c.albedo]), c.albedo, (v) => editor.setChannelValue(c.id, 'albedo', v.slice()))),
    slider('Brightness', c.albedo[0], {
      min: 0.02, max: 1, onInput: (v) => {
        const m = Math.max(c.albedo[0], 0.0001);
        editor.setChannelValue(c.id, 'albedo', c.albedo.map((x) => Math.min(1, (x / m) * v)));
      },
    }),
    slider('Roughness', c.roughness, { min: 0.02, max: 1, onInput: (v) => editor.setChannelValue(c.id, 'roughness', v) }),
    slider('Metallic', c.metallic, { min: 0, max: 1, onInput: (v) => editor.setChannelValue(c.id, 'metallic', v) }),
    slider('Pattern scale', c.scale, { min: 0.2, max: 4, onInput: (v) => editor.setChannelValue(c.id, 'scale', v) }),
    slider('Detail strength', c.detail, { min: 0, max: 2, onInput: (v) => editor.setChannelValue(c.id, 'detail', v) }),
    slider('Normal relief', c.normal, { min: 0, max: 3, onInput: (v) => editor.setChannelValue(c.id, 'normal', v) }),
    slider('Wear response', c.wear, { min: 0, max: 2, onInput: (v) => editor.setChannelValue(c.id, 'wear', v) }),
    slider('Water pooling', c.puddle, { min: 0, max: 1, onInput: (v) => editor.setChannelValue(c.id, 'puddle', v) }),
    slider('Emissive', c.emissive, { min: 0, max: 4, onInput: (v) => editor.setChannelValue(c.id, 'emissive', v) }),
    paving
      ? selectRow('Paving bond', String(Math.round(c.pattern)), PAVING_PATTERNS.map((p, i) => [String(i), p]), (v) => editor.setChannelValue(c.id, 'pattern', Number(v)))
      : (c.id === 'markings'
        ? selectRow('Centre line', String(Math.round(c.pattern)), [['0', 'White (EU)'], ['1', 'Yellow (US)']], (v) => editor.setChannelValue(c.id, 'pattern', Number(v)))
        : null)));

  body.append(card('Bound surfaces', 'Every surface id this channel paints.',
    ...c.ids.map((id) => readout(`id ${id}`, surfaceName(id)))));
}

const SURFACE_LABELS = {
  0: 'asphalt', 1: 'junction asphalt', 2: 'gutter', 3: 'kerb face', 4: 'kerb top', 5: 'footway', 6: 'verge',
  7: 'median', 8: 'shoulder', 9: 'concrete', 10: 'bridge soffit', 11: 'rail bed', 12: 'metal', 13: 'painted concrete',
  14: 'tactile', 15: 'dirt', 16: 'water', 17: 'glass', 18: 'rubber', 19: 'plastic', 20: 'cobble', 21: 'brick',
  22: 'grass', 23: 'weathered steel', 24: 'lamp lens', 25: 'signal lens', 26: 'billboard', 27: 'speed sign',
  28: 'stop sign', 29: 'give-way sign', 30: 'info sign', 31: 'cone', 32: 'barrier', 33: 'timber', 34: 'car paint',
  35: 'car glass', 36: 'tyre', 37: 'chrome', 38: 'red lamp', 39: 'white lamp', 40: 'rail steel', 41: 'sleeper',
  42: 'ballast', 43: 'train body', 44: 'road plate', 45: 'paver', 46: 'line paint', 47: 'soil', 48: 'gravel',
  49: 'tunnel lining',
};
const surfaceName = (id) => SURFACE_LABELS[id] || `surface ${id}`;

// ---------------------------------------------------------------- junction
function junctionInspector(editor, root, api) {
  const net = editor.scene.net;
  const node = net.nodes.get(editor.selection.id);
  if (!node) return sceneInspector(editor, root, api);
  const info = editor.scene.surface.junctions.get(node.id);
  const body = head(root, {
    eyebrow: `${node.edges.length}-arm intersection`,
    title: node.name || node.id,
    iconName: node.control === 'signal' ? 'signal' : 'node',
    pill: info?.control ?? node.control, pillOn: (info?.control ?? node.control) === 'signal',
  });

  body.append(card('Placement', 'Drag the gizmo in the viewport, or type exact coordinates. The whole intersection — plate, kerb returns and every road that meets it — is re-solved as one mesh.',
    numberPair(node, api),
    slider('Corner radius override', node.cornerRadius ?? 0, {
      min: 0, max: 24, step: 0.5, format: (v) => (v <= 0 ? 'auto' : `${v.toFixed(1)} m`),
      onInput: (v) => { node.cornerRadius = v <= 0 ? null : v; api.markDirty(); },
    }),
    toggleRow('Lock position', !!node.locked, (v) => { node.locked = v; api.refreshStack(); }),
    actions(
      mini('Frame', () => api.frame(node.p, 70)),
      mini('Rebuild now', () => api.rebuild()))));

  body.append(card('Control', 'Signals cycle in two groups split across the widest axis; priority junctions fall back to gap acceptance by road class.',
    selectRow('Control', node.control, [
      ['auto', 'Automatic'], ['signal', 'Traffic signals'], ['stop', 'All-way stop'],
      ['yield', 'Give way'], ['none', 'Uncontrolled'],
    ], (v) => { node.control = v; api.markDirty(); api.refreshStack(); }),
    selectRow('Crosswalks', node.crosswalks, [['auto', 'Automatic'], ['all', 'All arms'], ['none', 'None']],
      (v) => { node.crosswalks = v; api.markDirty(); })));

  body.append(card('Geometry', null,
    readout('Node', node.id),
    readout('Arms', String(node.edges.length)),
    readout('Plate radius', info ? `${(info.radius ?? 0).toFixed(2)} m` : '—'),
    readout('Kerb returns', info ? String(info.corners.length) : '—'),
    readout('Position', `${node.p.x.toFixed(2)}, ${node.p.z.toFixed(2)}`),
    ...node.edges.map((eid) => {
      const e = net.edges.get(eid);
      return readout(eid, `${e.profile.class} · ${e.curve.length.toFixed(0)} m`);
    })));
}

function numberPair(node, api) {
  const mk = (axis) => h('input', {
    type: 'number', step: '0.5', value: node.p[axis].toFixed(2),
    style: { width: '100%', background: '#1c1c1c', border: '1px solid #2c2c2c', borderRadius: '9px', padding: '9px 11px', outline: 'none' },
    onchange: (e) => {
      const v = Number(e.target.value);
      if (!Number.isFinite(v)) return;
      api.moveNode(node.id, axis === 'x' ? v : node.p.x, axis === 'z' ? v : node.p.z);
    },
  });
  return h('div', { class: 'grid2', style: { marginTop: '4px' } },
    h('div', {}, h('div', { class: 'eyebrow', style: { marginBottom: '5px' } }, 'X metres'), mk('x')),
    h('div', {}, h('div', { class: 'eyebrow', style: { marginBottom: '5px' } }, 'Z metres'), mk('z')));
}

// ---------------------------------------------------------------- road
function roadInspector(editor, root, api) {
  const net = editor.scene.net;
  const edge = net.edges.get(editor.selection.id);
  if (!edge) return sceneInspector(editor, root, api);
  const p = edge.profile;
  const body = head(root, {
    eyebrow: `${p.class} road`, title: edge.name || edge.id, iconName: 'curve',
    pill: edge.structure, pillOn: edge.structure !== 'ground',
  });

  body.append(card('Cross section', 'Lanes, parking and footways are rebuilt from the profile — the mesh follows the section exactly.',
    selectRow('Class', p.class, Object.values(ROAD_CLASS).map((c) => [c, c]), (v) => {
      const keep = { wear: edge.wear };
      edge.profile = defaultProfile(v);
      Object.assign(edge, keep);
      api.markDirty(); api.refreshInspector();
    }),
    slider('Lanes forward', p.lanesF, { min: 0, max: 4, step: 1, format: (v) => v.toFixed(0), onInput: (v) => { p.lanesF = v; api.markDirty(); } }),
    slider('Lanes back', p.lanesB, { min: 0, max: 4, step: 1, format: (v) => v.toFixed(0), onInput: (v) => { p.lanesB = v; api.markDirty(); } }),
    slider('Lane width', p.laneWidth, { min: 2.6, max: 4.2, format: (v) => `${v.toFixed(2)} m`, onInput: (v) => { p.laneWidth = v; api.markDirty(); } }),
    slider('Median', p.median, { min: 0, max: 8, format: (v) => `${v.toFixed(1)} m`, onInput: (v) => { p.median = v; api.markDirty(); } }),
    slider('Footway · left', p.footwayL, { min: 0, max: 6, format: (v) => `${v.toFixed(1)} m`, onInput: (v) => { p.footwayL = v; api.markDirty(); } }),
    slider('Footway · right', p.footwayR, { min: 0, max: 6, format: (v) => `${v.toFixed(1)} m`, onInput: (v) => { p.footwayR = v; api.markDirty(); } }),
    slider('Speed limit', p.speedLimit, { min: 20, max: 120, step: 5, format: (v) => `${v.toFixed(0)} km/h`, onInput: (v) => { p.speedLimit = v; api.markDirty(); } }),
    toggleRow('Parking · left', !!p.parkingL, (v) => { p.parkingL = v; api.markDirty(); }),
    toggleRow('Parking · right', !!p.parkingR, (v) => { p.parkingR = v; api.markDirty(); })));

  body.append(card('Condition', 'Damage is displaced geometry: potholes, sunken patches, speed tables and excavated trenches.',
    slider('Wear', edge.wear, { min: 0, max: 1, onInput: (v) => { edge.wear = v; api.markDirty(); } }),
    readout('Speed bumps', String(edge.features.speedBumps.length)),
    readout('Potholes', String(edge.features.potholes.length)),
    readout('Patches', String(edge.features.patches.length)),
    readout('Works zones', String(edge.features.construction.length)),
    readout('Level crossing', edge.features.railCrossing ? 'yes' : 'no'),
    actions(
      mini('Add pothole', () => { api.addFeature(edge, 'pothole'); }),
      mini('Add speed table', () => { api.addFeature(edge, 'bump'); }),
      mini('Add works zone', () => { api.addFeature(edge, 'works'); }),
      mini('Clear damage', () => { api.addFeature(edge, 'clear'); }, 'danger'))));

  body.append(card('Alignment', null,
    selectRow('Structure', edge.structure, [['ground', 'At grade'], ['bridge', 'Bridge'], ['tunnel', 'Tunnel']],
      (v) => { edge.structure = v; api.markDirty(); }),
    readout('Length', `${edge.curve.length.toFixed(1)} m`),
    readout('Control points', String(edge.via.length + 2)),
    readout('From → to', `${edge.a} → ${edge.b}`),
    readout('Trim', `${edge.trimA.toFixed(2)} / ${edge.trimB.toFixed(2)} m`)));
}
