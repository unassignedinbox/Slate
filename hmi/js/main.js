// HMI entry point: owns the simulation clock, the shared services, and the launcher.
// ?kiosk=1  : non-interactive display mode (auto-cycles apps, no input). Used by the in-car tablet.
import { bus } from './bus.js';
import { VehicleSim } from './vehicle.js';
import { createBackend } from './backend.js';
import { createLauncher } from './launcher.js';
import { APPS } from './apps/index.js';

const params = new URLSearchParams(location.search);
const kiosk = params.has('kiosk');
const embedded = window.parent !== window;
if (kiosk) document.body.classList.add('kiosk');

const sim = new VehicleSim();
const backend = createBackend();
const ctx = { bus, sim, backend, kiosk, toast: null, launch: null, goHome: null };
const launcher = createLauncher(APPS, ctx);

// Scale the fixed 1280x720 screen to fit any window, like a physical display.
const screenEl = document.getElementById('screen');
function fit() {
  const s = Math.min(window.innerWidth / 1280, window.innerHeight / 720);
  screenEl.style.transform = `scale(${s})`;
}
window.addEventListener('resize', fit);
fit();

// One telemetry frame per display refresh (dt clamped for tab switches).
let last = performance.now();
let lastPost = 0;
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const frame = sim.step(dt);
  bus.emit('telemetry', frame);
  launcher.tick(frame, now);
  // When embedded (in-car tablet), share the speed so the parent's road scenery can match it.
  if (embedded && now - lastPost > 100) {
    lastPost = now;
    window.parent.postMessage({ type: 'telemetry', speedKph: frame.speedKph }, '*');
  }
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
