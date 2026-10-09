import '@fontsource/titillium-web/400.css';
import '@fontsource/titillium-web/700.css';
import '@fontsource/share-tech-mono/400.css';
import '@fontsource/roboto/400.css';
import '@fontsource/roboto/500.css';
import './style.css';
import { startSim } from './core/sim.js';
import { mountShell } from './shell/shell.js';

const stage = document.getElementById('stage');

mountShell(stage);
startSim();
