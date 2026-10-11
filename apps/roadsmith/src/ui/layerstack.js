// The two layer stacks: scene geometry (+ intersections) and the texturing channels.

import { h, clear, rgb } from './widgets.js';
import { icon } from './icons.js';

export function renderStack(editor, root) {
  clear(root);
  if (editor.stackTab === 'texture') return renderTextureStack(editor, root);
  return renderSceneStack(editor, root);
}

function group(label, count) {
  return h('div', { class: 'group-label' }, h('span', {}, label), h('span', {}, String(count)));
}

function row({ iconName, title, sub, selected, hidden, onSelect, onToggle, dot }) {
  const eye = h('button', {
    class: 'eye', title: hidden ? 'Show' : 'Hide',
    html: icon(hidden ? 'eyeOff' : 'eye'),
    onclick: (e) => { e.stopPropagation(); onToggle?.(); },
  });
  return h('div', {
    class: `row${hidden ? ' hidden' : ''}`,
    'aria-selected': selected ? 'true' : 'false',
    onclick: onSelect,
  },
  dot
    ? h('span', { class: 'ico' }, h('span', { class: 'dot', style: { background: dot } }))
    : h('span', { class: 'ico', html: icon(iconName) }),
  h('span', { class: 'label' }, h('b', {}, title), sub ? h('span', {}, sub) : null),
  onToggle ? eye : h('span'));
}

function renderSceneStack(editor, root) {
  const scene = editor.scene;
  if (!scene) {
    root.append(h('div', { class: 'empty' }, 'No network yet — press Generate.'));
    return;
  }
  const groups = new Map();
  for (const layer of scene.layers) {
    if (!groups.has(layer.group)) groups.set(layer.group, []);
    groups.get(layer.group).push(layer);
  }
  for (const [name, layers] of groups) {
    root.append(group(name, layers.length));
    for (const layer of layers) {
      const hidden = editor.hidden.has(layer.id);
      const sel = editor.selection?.type === 'layer' && editor.selection.id === layer.id;
      root.append(row({
        iconName: layer.icon,
        title: layer.name,
        sub: layer.kind === 'instanced'
          ? `${layer.count} instances`
          : `${layer.count.toLocaleString()} tris`,
        selected: sel,
        hidden,
        onSelect: () => editor.select({ type: 'layer', id: layer.id }),
        onToggle: () => editor.toggleLayer(layer.id),
      }));
    }
  }

  const junctions = [...scene.net.nodes.values()].filter((n) => n.edges.length >= 3);
  root.append(group('Intersections', junctions.length));
  for (const n of junctions) {
    const info = scene.surface.junctions.get(n.id);
    const sel = editor.selection?.type === 'junction' && editor.selection.id === n.id;
    root.append(row({
      iconName: n.control === 'signal' ? 'signal' : 'node',
      title: `${n.id} · ${n.edges.length}-way`,
      sub: `${info ? `${(info.radius ?? 0).toFixed(1)} m` : '—'} · ${info?.control ?? n.control}`,
      selected: sel,
      onSelect: () => editor.select({ type: 'junction', id: n.id }),
    }));
  }
}

function renderTextureStack(editor, root) {
  const groups = new Map();
  for (const c of editor.channels) {
    if (!groups.has(c.group)) groups.set(c.group, []);
    groups.get(c.group).push(c);
  }
  for (const [name, chans] of groups) {
    root.append(group(name, chans.length));
    for (const c of chans) {
      const sel = editor.selection?.type === 'channel' && editor.selection.id === c.id;
      root.append(row({
        dot: rgb(c.albedo),
        title: c.name,
        sub: `${c.ids.length} surface id${c.ids.length === 1 ? '' : 's'} · ${c.enabled ? 'procedural' : 'flat'}`,
        selected: sel,
        hidden: !c.enabled,
        onSelect: () => editor.select({ type: 'channel', id: c.id }),
        onToggle: () => editor.setChannelValue(c.id, 'enabled', !c.enabled),
      }));
    }
  }
}
