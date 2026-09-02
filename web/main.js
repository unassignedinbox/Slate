// ---- on-screen diagnostics (we can't see the browser console) ----
const diagEl = () => document.getElementById('diag');
function diag(msg, ok = true) {
  const el = diagEl(); if (!el) return;
  el.textContent = msg;
  el.style.color = ok ? '#7fe0a0' : '#ff8080';
}
window.addEventListener('error', (e) => diag('ERR: ' + (e.message || e.error), false));
window.addEventListener('unhandledrejection', (e) => diag('PROMISE: ' + (e.reason?.message || e.reason), false));

import { Sketch, seed } from './model.js';
import { renderDirectory, initDirectoryToolbar } from './directory.js';
import { renderBands, renderTiles, initPanel } from './panel.js';
import { initViewport } from './viewport.js';

// seed a couple of folders so the tree reads like a real document
seed();

initPanel();
initDirectoryToolbar();
renderDirectory();
try { initViewport(); diag('viewport ready'); }
catch (err) { diag('initViewport failed: ' + err.message, false); console.error(err); }

// ---- Directory / Tools shared-space switch ----
const paneDir = document.getElementById('panel-directory');
const paneTools = document.getElementById('panel-tools');
const tabDir = document.getElementById('tab-directory');
const tabTools = document.getElementById('tab-tools');
function showPane(which) {
  const dir = which === 'directory';
  paneDir.style.display = dir ? 'flex' : 'none';
  paneTools.style.display = dir ? 'none' : 'flex';
  tabDir.classList.toggle('active', dir);
  tabTools.classList.toggle('active', !dir);
}
tabDir?.addEventListener('click', () => showPane('directory'));
tabTools?.addEventListener('click', () => showPane('tools'));
showPane('tools'); // start on Tools so drawing is one click away

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
