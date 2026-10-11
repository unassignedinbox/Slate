// Assembles the editor chrome: top bar, viewport, the two right-hand stacks and the status bar.

import { h, clear } from './widgets.js';
import { icon } from './icons.js';
import { renderStack } from './layerstack.js';
import { renderInspector } from './inspector.js';
import { PRESETS, ENV_PRESETS } from '../app/state.js';

export function buildShell(editor, api) {
  const root = document.getElementById('app');
  clear(root);

  // ------------------------------------------------------------ top bar
  const presetSel = h('select', { onchange: (e) => { editor.setPreset(e.target.value); api.generate(); } },
    ...Object.entries(PRESETS).map(([k, v]) => h('option', { value: k, selected: k === editor.settings.preset }, v.label)));
  const seedInput = h('input', {
    type: 'number', value: editor.settings.seed, step: '1',
    onchange: (e) => editor.setSetting('seed', Number(e.target.value) | 0),
  });
  const envSel = h('select', { onchange: (e) => { editor.setEnv(e.target.value); api.refreshInspector(); } },
    ...Object.entries(ENV_PRESETS).map(([k, v]) => h('option', { value: k, selected: k === editor.envName }, v.name)));
  const generateBtn = h('button', { class: 'btn primary', onclick: () => api.generate() },
    h('span', { html: icon('refresh', 15) }), 'Generate');

  const viewButtons = {};
  const viewToggle = (key, label, iconName) => (viewButtons[key] = h('button', {
    'aria-pressed': editor.view[key] ? 'true' : 'false', title: label,
    onclick: (e) => {
      const next = !editor.view[key];
      editor.setView(key, next);
      e.currentTarget.setAttribute('aria-pressed', next ? 'true' : 'false');
    },
  }, h('span', { html: icon(iconName, 14) }), label));

  const topbar = h('div', { class: 'topbar' },
    h('div', { class: 'brand' }, h('b', {}, 'Roadsmith'), h('span', {}, 'WebGPU road network')),
    h('div', { class: 'field' }, h('label', {}, 'Preset'), presetSel),
    h('div', { class: 'field' }, h('label', {}, 'Seed'), seedInput),
    generateBtn,
    h('div', { class: 'spacer' }),
    h('div', { class: 'field' }, h('label', {}, 'Light'), envSel),
    h('div', { class: 'seg' },
      viewToggle('simulate', 'Sim', 'play'),
      viewToggle('wireframe', 'Quads', 'grid'),
      viewToggle('network', 'Splines', 'curve'),
      viewToggle('laneGraph', 'Lanes', 'target')));

  // ------------------------------------------------------------ viewport
  const canvas = h('canvas', { id: 'gpu-canvas' });
  const hud = h('div', { class: 'hud' });
  const busy = h('div', { class: 'busy', style: { display: 'none' } }, 'Rebuilding road network…');
  const note = h('div', { class: 'overlay-note' },
    h('b', {}, 'Click an intersection'), ' to select it, then drag the gizmo arrows (or the blue disc) to move the whole junction. ',
    h('kbd', {}, 'LMB'), ' orbit · ', h('kbd', {}, 'MMB'), '/', h('kbd', {}, 'Shift'), ' pan · ',
    h('kbd', {}, 'Wheel'), ' zoom · ', h('kbd', {}, 'F'), ' frame · ', h('kbd', {}, 'Esc'), ' deselect');
  const viewport = h('div', { class: 'viewport' }, canvas, h('div', { class: 'viewtools' }), note, hud, busy);

  // ------------------------------------------------------------ right column
  const stackScroll = h('div', { class: 'stack-scroll' });
  const tabScene = h('button', { 'aria-pressed': 'true', onclick: () => setTab('scene') }, h('span', { html: icon('layers', 14) }), 'Scene');
  const tabTex = h('button', { 'aria-pressed': 'false', onclick: () => setTab('texture') }, h('span', { html: icon('palette', 14) }), 'Texturing');
  const stackTitle = h('div', { class: 'stack-title' }, 'Layer stack');
  const stack = h('div', { class: 'stack' },
    h('div', { class: 'stack-head' }, stackTitle, h('div', { class: 'seg' }, tabScene, tabTex)),
    stackScroll);
  const inspector = h('div', { class: 'inspector' });
  const side = h('div', { class: 'side' }, stack, inspector);

  function setTab(tab) {
    editor.stackTab = tab;
    tabScene.setAttribute('aria-pressed', tab === 'scene' ? 'true' : 'false');
    tabTex.setAttribute('aria-pressed', tab === 'texture' ? 'true' : 'false');
    stackTitle.textContent = tab === 'scene' ? 'Layer stack' : 'Texture stack';
    if (tab === 'texture' && editor.selection?.type !== 'channel') editor.select({ type: 'channel', id: editor.channels[0].id });
    if (tab === 'scene' && editor.selection?.type === 'channel') editor.select(null);
    api.refreshStack();
    api.refreshInspector();
  }

  // ------------------------------------------------------------ status bar
  const statusLeft = h('span', {}, 'Ready');
  const statusMid = h('span', {});
  const statusRight = h('span', {});
  const statusbar = h('div', { class: 'statusbar' }, statusLeft, h('span', { class: 'spacer' }), statusMid, statusRight);

  root.append(topbar, h('div', { class: 'body' }, viewport, side), statusbar);

  return {
    canvas, viewport, hud, busy, stackScroll, inspector, statusLeft, statusMid, statusRight,
    setBusy(on, label) {
      busy.style.display = on ? 'grid' : 'none';
      if (label) busy.textContent = label;
      generateBtn.disabled = on;
    },
    setTab,
    syncView() {
      for (const [key, btn] of Object.entries(viewButtons)) {
        btn.setAttribute('aria-pressed', editor.view[key] ? 'true' : 'false');
      }
    },
    refreshStack() { renderStack(editor, stackScroll); },
    refreshInspector() { renderInspector(editor, inspector, api); },
    syncTopbar() {
      presetSel.value = editor.settings.preset;
      seedInput.value = editor.settings.seed;
      envSel.value = editor.envName;
    },
    setHud(chips) {
      clear(hud);
      for (const [label, value] of chips) {
        hud.append(h('div', { class: 'chip' }, `${label} `, h('b', {}, value)));
      }
    },
    setStatus(left, mid, right) {
      statusLeft.innerHTML = left;
      statusMid.innerHTML = mid || '';
      statusRight.innerHTML = right || '';
    },
  };
}
