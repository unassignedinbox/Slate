import { Sketch } from './model.js';
import { GLYPH, iconSvg } from './icons.js';
import { BANDS, isDrawing } from './tools.js';

const bandsEl = document.getElementById('bands');
const tilesEl = document.getElementById('tiles');
const bandTitle = document.getElementById('band-title');
const bandSub = document.getElementById('band-sub');
const toolsStatus = document.getElementById('tools-status');

let activeBand = 0;   // 2DPrimitives

export function renderBands() {
  bandsEl.innerHTML = '';
  BANDS.forEach((b, i) => {
    const on = i === activeBand;
    const row = document.createElement('div');
    row.className = 'relative mx-2 my-0.5 h-11 px-3 flex items-center gap-3 rounded-[12px] cursor-pointer transition-colors '
      + (on ? 'bg-[#1e1e1e] text-[#f0f0f0]' : 'text-[#888] hover:bg-white/5 hover:text-[#bbb]');
    row.innerHTML =
      (on ? '<div class="absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-[#4a7fff]"></div>' : '')
      + iconSvg('<rect x="3" y="3" width="18" height="18" rx="4"/><path d="m8 12 3 3 5-6"/>', 'w-4 h-4 ' + (on ? 'text-[#4a7fff]' : 'text-[#666]'))
      + `<span class="flex-1 text-[13px] font-medium truncate">${b.name}</span>`
      + `<span class="text-[11px] px-2 py-0.5 rounded-full ${on ? 'bg-[#4a7fff] text-white' : 'bg-[#1e1e1e] text-[#777]'}">${b.tools.length}</span>`;
    row.onclick = () => { activeBand = i; renderBands(); renderTiles(); };
    bandsEl.appendChild(row);
  });
}

export function renderTiles() {
  const band = BANDS[activeBand];
  bandTitle.textContent = band.name;
  bandSub.textContent = `${band.tools.length} of ${band.tools.length} available`;
  tilesEl.innerHTML = '';
  band.tools.forEach(([name, glyph], i) => {
    const on = Sketch.activeTool.band === activeBand && Sketch.activeTool.tool === i;
    const drawable = isDrawing(glyph);
    const tile = document.createElement('button');
    tile.className = 'group aspect-square rounded-[14px] flex flex-col items-center justify-center gap-2 border transition-all '
      + (on
          ? 'bg-[#171c26] border-[#4a7fff] shadow-[0_0_0_1px_#4a7fff55]'
          : 'bg-[#1a1a1a] border-white/5 hover:bg-[#202020] hover:border-white/10');
    tile.innerHTML =
      iconSvg(GLYPH[glyph] || GLYPH.point, 'w-6 h-6 ' + (on ? 'text-[#8fb0ff]' : 'text-[#cfd4dc] group-hover:text-white'))
      + `<span class="text-[11px] ${on ? 'text-[#8fb0ff]' : 'text-[#8a9099]'} font-medium leading-none text-center px-1">${name}</span>`
      + (drawable ? '' : '<span class="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-[#555]" title="not yet interactive"></span>');
    tile.style.position = 'relative';
    tile.onclick = () => {
      Sketch.activeTool = { band: activeBand, tool: i, name, glyph };
      renderTiles();
      Sketch.emit('tool');
    };
    tilesEl.appendChild(tile);
  });
  const live = band.tools.filter(([, g]) => isDrawing(g)).length;
  toolsStatus.textContent = `${live} of ${band.tools.length} live · click a tile, then draw in the viewport`;
}

export function initPanel() {
  // start on Line
  Sketch.activeTool = { band: 0, tool: 0, name: 'Line', glyph: 'line' };
  renderBands();
  renderTiles();
}
