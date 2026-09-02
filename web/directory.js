import { Sketch, makeFolder, removeNode, setSelection, moveNode } from './model.js';
import { GLYPH, iconSvg } from './icons.js';

const dirEl = document.getElementById('directory');
const dirCount = document.getElementById('dir-count');

function kindColor(node) {
  if (node.type === 'folder') return 'text-[#e8c07a]';
  if (node.construction) return 'text-[#9aa4b2]';
  switch (node.kind) {
    case 'point': return 'text-[#c0c6d0]';
    case 'rectangle': case 'circle': case 'polygon': case 'ellipse': case 'slot': return 'text-[#7ee787]';
    case 'line': case 'polyline': case 'arc': return 'text-[#8fb0ff]';
    default: return 'text-[#9aa4b2]';
  }
}
function nodeIcon(node) {
  if (node.type === 'folder') return node.open ? GLYPH.folderOpen : GLYPH.folder;
  return GLYPH[node.glyph] || GLYPH.point;
}

let dragId = null;

export function renderDirectory() {
  dirEl.innerHTML = '';
  let count = 0;

  const addRow = (node, depth) => {
    const isFolder = node.type === 'folder';
    if (!isFolder) count++;
    const selected = Sketch.selection.has(node.id);

    const row = document.createElement('div');
    row.className = 'group relative flex items-center gap-1.5 h-9 pr-2 cursor-pointer transition-colors '
      + (selected ? 'bg-[#20242c] text-[#f0f0f0]' : 'text-[#aeb4bd] hover:bg-white/5');
    row.style.paddingLeft = (8 + depth * 16) + 'px';
    row.dataset.id = node.id;
    row.draggable = true;

    // left accent when selected
    const bar = selected
      ? '<div class="absolute left-0 top-0 h-full w-[3px] bg-[#4a7fff]"></div>' : '';

    // chevron for folders
    const chev = isFolder
      ? `<button class="chev w-4 h-4 shrink-0 flex items-center justify-center text-[#777] hover:text-[#ccc] transition-transform ${node.open ? 'rotate-90' : ''}">`
        + iconSvg(GLYPH.chevron, 'w-3 h-3') + '</button>'
      : '<span class="w-4 shrink-0"></span>';

    row.innerHTML = bar + chev
      + iconSvg(nodeIcon(node), 'w-4 h-4 shrink-0 ' + kindColor(node))
      + `<span class="label text-[12.5px] font-medium truncate flex-1">${node.name}</span>`
      + (isFolder
          ? `<span class="text-[10px] text-[#666] px-1.5 rounded-full bg-white/5">${node.children.length}</span>`
          : `<button class="del opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center text-[#777] hover:text-[#ff6b6b] transition" title="Delete">${iconSvg(GLYPH.trash, 'w-3.5 h-3.5')}</button>`);

    // ---- events ----
    row.querySelector('.chev')?.addEventListener('click', (e) => {
      e.stopPropagation(); node.open = !node.open; Sketch.emit('dir'); });

    row.querySelector('.del')?.addEventListener('click', (e) => {
      e.stopPropagation(); removeNode(node.id); Sketch.emit('remove'); });

    row.addEventListener('click', (e) => {
      setSelection([node.id], e.shiftKey || e.ctrlKey || e.metaKey);
    });

    // rename on double-click
    row.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      const span = row.querySelector('.label');
      const input = document.createElement('input');
      input.value = node.name;
      input.className = 'label flex-1 bg-[#0a0a0a] border border-[#4a7fff] rounded px-1 text-[12.5px] text-[#f0f0f0] outline-none';
      span.replaceWith(input);
      input.focus(); input.select();
      const commit = () => { node.name = input.value.trim() || node.name; Sketch.emit('rename'); };
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { commit(); }
        if (ev.key === 'Escape') { Sketch.emit('rename'); }
      });
      input.addEventListener('blur', commit);
    });

    // drag & drop into folders
    row.addEventListener('dragstart', (e) => { dragId = node.id; e.dataTransfer.effectAllowed = 'move'; });
    row.addEventListener('dragover', (e) => {
      if (!isFolder || dragId === node.id) return;
      e.preventDefault(); row.classList.add('ring-1', 'ring-[#4a7fff]', 'ring-inset');
    });
    row.addEventListener('dragleave', () => row.classList.remove('ring-1', 'ring-[#4a7fff]', 'ring-inset'));
    row.addEventListener('drop', (e) => {
      row.classList.remove('ring-1', 'ring-[#4a7fff]', 'ring-inset');
      if (!isFolder || !dragId) return;
      e.preventDefault(); moveNode(dragId, node); dragId = null; Sketch.emit('move');
    });

    dirEl.appendChild(row);
    if (isFolder && node.open) node.children.forEach((c) => addRow(c, depth + 1));
  };

  Sketch.root.forEach((n) => addRow(n, 0));

  // drop-to-root zone
  const rootZone = document.createElement('div');
  rootZone.className = 'h-8';
  rootZone.addEventListener('dragover', (e) => { e.preventDefault(); rootZone.classList.add('bg-white/5'); });
  rootZone.addEventListener('dragleave', () => rootZone.classList.remove('bg-white/5'));
  rootZone.addEventListener('drop', (e) => {
    rootZone.classList.remove('bg-white/5');
    if (dragId) { moveNode(dragId, null); dragId = null; Sketch.emit('move'); }
  });
  dirEl.appendChild(rootZone);

  dirCount.textContent = `${count} ${count === 1 ? 'item' : 'items'}`;
}

// wire the "new folder" button in the header
export function initDirectoryToolbar() {
  document.getElementById('new-folder')?.addEventListener('click', () => {
    // put the new folder inside the first selected folder, else at root
    let parent = null;
    for (const id of Sketch.selection) {
      const n = Sketch.index.get(id);
      if (n?.type === 'folder') { parent = n; break; }
      if (n?.parent) { parent = n.parent; break; }
    }
    const f = makeFolder('New Folder', parent);
    if (parent) parent.open = true;
    setSelection([f.id]);
    Sketch.emit('newfolder');
  });

  document.getElementById('del-selected')?.addEventListener('click', () => {
    [...Sketch.selection].forEach((id) => removeNode(id));
    Sketch.emit('remove');
  });
}
