import { Sketch, seed } from './model.js';
import { renderDirectory, initDirectoryToolbar } from './directory.js';
import { renderBands, renderTiles, initPanel } from './panel.js';
import { initViewport } from './viewport.js';

// seed a couple of folders so the tree reads like a real document
seed();

initPanel();
initDirectoryToolbar();
renderDirectory();
initViewport();

// re-render the directory whenever the model changes
Sketch.on((reason) => {
  if (['draw','remove','move','rename','newfolder','dir','selection','seed'].includes(reason))
    renderDirectory();
});

// keep the tiles' selected-state in sync if a tool is chosen elsewhere
Sketch.on((reason) => { if (reason === 'tool') renderTiles(); });

// ---- fullscreen viewport (clean, panel-free canvas for testing) ----
const viewportEl = document.getElementById('viewport');
const fsBtn = document.getElementById('fullscreen-btn');
function toggleFullscreen() {
  if (!document.fullscreenElement) {
    (viewportEl.requestFullscreen || viewportEl.webkitRequestFullscreen || (()=>{})).call(viewportEl);
  } else {
    (document.exitFullscreen || document.webkitExitFullscreen || (()=>{})).call(document);
  }
}
fsBtn?.addEventListener('click', toggleFullscreen);
window.addEventListener('keydown', (e) => {
  const tag = (e.target && e.target.tagName) || '';
  if (e.key === 'f' && tag !== 'INPUT' && tag !== 'TEXTAREA') toggleFullscreen();
});
// in fullscreen, let the viewport fill the whole screen with a black backdrop
document.addEventListener('fullscreenchange', () => {
  const on = document.fullscreenElement === viewportEl;
  viewportEl.style.background = on ? '#0a0a0a' : '';
  // nudge a resize on the next frame once the browser has applied the new size
  requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
});
