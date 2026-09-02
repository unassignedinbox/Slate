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
