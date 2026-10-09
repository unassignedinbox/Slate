// HMI entry point: owns the simulation clock, the shared services, and the launcher.
import { bus } from './bus.js';
import { VehicleSim } from './vehicle.js';
import { createBackend } from './backend.js';
import { createLauncher } from './launcher.js';
import { APPS } from './apps/index.js';

const sim = new VehicleSim();
const backend = createBackend();
const ctx = { bus, sim, backend, toast: null, launch: null, goHome: null };
const launcher = createLauncher(APPS, ctx);

// Scale the fixed 1280x720 screen to fit any window, like a physical display.
const screenEl = document.getElementById('screen');
function fit() {
  const s = Math.min(window.innerWidth / 1280, window.innerHeight / 720);
  screenEl.style.transform = `scale(${s})`;
}
window.addEventListener('resize', fit);
fit();

// Fixed-step-ish loop: one telemetry frame per display refresh (dt clamped for tab switches).
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

// Handy for debugging from the console: window.hmi.sim.set({ wingRear: 0.9 })
window.hmi = { sim, backend, bus, launcher };
