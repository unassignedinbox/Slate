import '@fontsource/titillium-web/400.css';
import '@fontsource/titillium-web/700.css';
import '@fontsource/share-tech-mono/400.css';
import '@fontsource/roboto/400.css';
import '@fontsource/roboto/500.css';
import './style.css';
import { startSim } from './core/sim.js';
import { mountShell } from './shell/shell.js';

const stage = document.getElementById('stage');
const DESIGN_W = 1920;
const DESIGN_H = 720;

// Scale the fixed cluster canvas to fit any browser window (letterboxed).
function fit() {
  const s = Math.min(innerWidth / DESIGN_W, innerHeight / DESIGN_H);
  stage.style.transform = `translate(-50%, -50%) scale(${s})`;
}
addEventListener('resize', fit);
fit();

mountShell(stage);
startSim();
