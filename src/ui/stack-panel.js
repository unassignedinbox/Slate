// Left panel: the layer stack (top of list = applied last), add-layer dialog with all nodes.
import { h } from './dom.js';
import { NODE_LIST, CATEGORIES } from '../engine/registry.js';
import { BLEND_NAMES } from './names.js';

export function renderStack(el, project, selectedId, { onSelect, onToggle, onMove, onDelete }) {
  el.replaceChildren();
  if (!project.layers.length) el.append(h('div', { class: 'empty' }, 'No layers yet. Click + Add layer, or load the starter stack.'));
  const rows = project.layers.map((l, idx) => ({ l, idx })).reverse();
  for (const { l, idx } of rows) {
    const node = NODE_LIST.find((n) => n.id === l.nodeId);
    const blendName = node.mode === 'mod' || node.mode === 'obj' || node.mode === 'xform' ? '' : BLEND_NAMES[l.blend] || '';
    const hasMask = l.mask && l.mask.type != null;
    el.append(h('div', { class: 'layer' + (l.id === selectedId ? ' sel' : '') + (l.enabled ? '' : ' off'), onclick: () => onSelect(l.id) },
      h('input', { type: 'checkbox', checked: l.enabled, title: 'Enable layer', onclick: (e) => { e.stopPropagation(); onToggle(l.id); } }),
      h('span', { class: 'tag', title: node.mode }, node.mode),
      h('span', { class: 'lname' }, `${l.name || node.name}`, h('small', {}, ` #${node.id}${blendName ? ' · ' + blendName : ''}${hasMask ? ' · mask ' + l.mask.type : ''}`)),
      h('span', { class: 'ops' },
        h('button', { title: 'Move up', onclick: (e) => { e.stopPropagation(); onMove(l.id, 1); } }, '▲'),
        h('button', { title: 'Move down', onclick: (e) => { e.stopPropagation(); onMove(l.id, -1); } }, '▼'),
        h('button', { title: 'Delete', onclick: (e) => { e.stopPropagation(); onDelete(l.id); } }, '✕')),
    ));
  }
}

export function openAddDialog(onPick) {
  const dlg = h('dialog', { class: 'add' });
  const search = h('input', { placeholder: 'Search nodes by name or id…', autofocus: true });
  const list = h('div', { class: 'nodelist' });
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    list.replaceChildren();
    for (const cat of CATEGORIES) {
      const items = NODE_LIST.filter((n) => n.cat === cat && (!q || n.name.toLowerCase().includes(q) || String(n.id) === q));
      if (!items.length) continue;
      list.append(h('div', { class: 'cat' }, cat));
      for (const n of items) list.append(h('button', { class: 'pick', onclick: () => { onPick(n.id); dlg.close(); dlg.remove(); } }, h('b', {}, `#${n.id}`), ' ' + n.name, h('small', {}, ' ' + n.mode)));
    }
  };
  search.addEventListener('input', draw);
  dlg.append(h('div', { class: 'dlg-h' }, h('b', {}, 'Add layer'), h('button', { onclick: () => { dlg.close(); dlg.remove(); } }, '✕')), search, list);
  document.body.append(dlg);
  draw();
  dlg.showModal();
  search.focus();
}
