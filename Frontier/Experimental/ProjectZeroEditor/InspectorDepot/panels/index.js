import { moonPanel } from './moon.js';
import { sunPanel } from './sun.js';
import { WindFlowPanel as windPanel } from '../../WindFlowPanel.js';
import { fogPanel } from './fog.js';
import { folderPanel } from './folder.js';
import { cloudsPanel } from './clouds.js';
import { lightPanel } from './lights.js';
import { advancedLightPanel } from './advancedLights.js';

export const CUSTOM_PANELS = {
  folder: { build: folderPanel, owns: ['Group'] },
  pointlight: { build: lightPanel, owns: ['Transform', 'Emission'] },
  spotlight: { build: lightPanel, owns: ['Transform', 'Cone'] },
  ieslight: { build: advancedLightPanel, owns: ['Transform', 'Photometry'] },
  arealight: { build: advancedLightPanel, owns: ['Transform', 'Emitter'] },
  tubelight: { build: advancedLightPanel, owns: ['Transform', 'Emitter'] },
  clouds: { build: cloudsPanel, owns: ['Layer', 'Motion & tint'] },
  moon: { build: moonPanel, owns: ['Orbit', 'Appearance'] },
  sun: { build: sunPanel, owns: ['Orbit', 'Disc & light'] },
  wind: { build: windPanel, owns: ['Field'] },
  fog: { build: fogPanel, owns: ['Volumetrics'] },
};
