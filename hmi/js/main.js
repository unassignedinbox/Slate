// HMI entry point: owns the simulation clock, the shared services, and the launcher.
// ?kiosk=1  : non-interactive display mode (auto-cycles apps, no input). Used by the in-car tablet.
import { bus } from './bus.js';
import { VehicleSim } from './vehicle.js';
import { createBackend } from './backend.js';
import { createLauncher } from './launcher.js';
import { APPS } from './apps/index.js';

const params = new URLSearchParams(location.search);
const kiosk = params.has('kiosk');
if (kiosk) document.body.classList.add('kiosk');

const sim = new VehicleSim();
const backend = createBackend();
const ctx = { bus, sim, backend, kiosk, toast: null, launch: null, goHome: null };
const launcher = createLauncher(APPS, ctx);

// Scale the fixed 1280x720 screen to fit any window, like a physical display.
const screenEl = document.getElementById('screen');
// The screen's scale and tilt are CSS variables (see css/hmi.css and css/stage3d.css).
const tiltPage = document.body.classList.contains('tilt');
function fit() {
  const margin = tiltPage ? 0.8 : 1;   // leave room for the 3D tilt on the main page
  const s = Math.min(window.innerWidth / 1280, window.innerHeight / 720) * margin;
  document.documentElement.style.setProperty('--fit', s.toFixed(4));
}
window.addEventListener('resize', fit);
fit();
// On the 3D page, the pointer leans the screen a few degrees (hover devices only).
if (tiltPage && matchMedia('(hover: hover)').matches) {
  window.addEventListener('pointermove', (e) => {
    const nx = e.clientX / window.innerWidth - 0.5;
    const ny = e.clientY / window.innerHeight - 0.5;
    document.documentElement.style.setProperty('--tilt-x', `${(4 - ny * 5).toFixed(2)}deg`);
    document.documentElement.style.setProperty('--tilt-y', `${(-6 + nx * 7).toFixed(2)}deg`);
  });
}

// One telemetry frame per display refresh (dt clamped for tab switches).
let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const frame = sim.step(dt);
  bus.emit('telemetry', frame);
  launcher.tick(frame, now);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// Kiosk: cycle through the home screen and every app, with no input required.
// Each app is closed after its turn so its 3D context is released.
if (kiosk) {
  const sequence = ['home', 'cockpit', 'suspension', 'aero', 'tyres', 'weather', 'wallet', 'online'];
  let i = 0, prev = null;
  const step = () => {
    const id = sequence[i];
    i = (i + 1) % sequence.length;
    if (id === 'home') launcher.goHome();
    else launcher.launch(id);
    if (prev && prev !== id) launcher.close(prev);
    prev = id === 'home' ? null : id;
    setTimeout(step, id === 'home' ? 4000 : 9000);
  };
  setTimeout(step, 1500);
}

// Handy for debugging from the console: window.hmi.sim.settings
window.hmi = { sim, backend, bus, launcher };
