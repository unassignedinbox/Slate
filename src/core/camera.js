// Orbit camera with inertia — LMB orbit · ⇧LMB / MMB pan · wheel dolly.
import { state } from './config.js';

export class Camera {
  constructor(canvas) {
    this.canvas = canvas;
    this.target = [0, 4, 0];
    this.dist = 190;
    this.az = 0.8;            // radians
    this.el = 0.42;           // radians
    this.fov = 46 * Math.PI / 180;
    this.near = 0.5;
    this.far = 900;
    this.pos = [0, 0, 0];
    this.right = [1, 0, 0];
    this.up = [0, 1, 0];
    this.fwd = [0, 0, -1];
    this.velAz = 0; this.velEl = 0;
    this.update();
    this.attach();
  }

  update() {
    const ce = Math.cos(this.el), se = Math.sin(this.el);
    const ca = Math.cos(this.az), sa = Math.sin(this.az);
    const dir = [ce * sa, se, ce * ca];
    this.pos = [
      this.target[0] + dir[0] * this.dist,
      this.target[1] + dir[1] * this.dist,
      this.target[2] + dir[2] * this.dist,
    ];
    this.fwd = [-dir[0], -dir[1], -dir[2]];
    // right = normalize(cross(worldUp, fwd))
    const wu = [0, 1, 0];
    let rx = wu[1] * this.fwd[2] - wu[2] * this.fwd[1];
    let ry = wu[2] * this.fwd[0] - wu[0] * this.fwd[2];
    let rz = wu[0] * this.fwd[1] - wu[1] * this.fwd[0];
    const rl = Math.hypot(rx, ry, rz) || 1;
    this.right = [rx / rl, ry / rl, rz / rl];
    // up = cross(fwd, right)
    this.up = [
      this.fwd[1] * this.right[2] - this.fwd[2] * this.right[1],
      this.fwd[2] * this.right[0] - this.fwd[0] * this.right[2],
      this.fwd[0] * this.right[1] - this.fwd[1] * this.right[0],
    ];
  }

  frame() {
    const cx = (state.lo[0] + state.hi[0]) / 2;
    const cy = (state.lo[1] + state.hi[1]) / 2;
    const cz = (state.lo[2] + state.hi[2]) / 2;
    this.target = [cx, Math.max(cy, 2), cz];
    const span = Math.max(state.hi[0] - state.lo[0], state.hi[2] - state.lo[2]);
    this.dist = span * 1.35;
    this.update();
  }

  attach() {
    const cv = this.canvas;
    let drag = null;
    cv.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.button !== 1) return;
      drag = { x: e.clientX, y: e.clientY, pan: e.shiftKey || e.button === 1 };
      cv.setPointerCapture(e.pointerId);
      cv.style.cursor = drag.pan ? 'move' : 'grabbing';
    });
    cv.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY;
      if (drag.pan) {
        const k = this.dist * 0.0016;
        for (let i = 0; i < 3; i++) {
          this.target[i] -= this.right[i] * dx * k;
          this.target[i] += this.up[i] * dy * k;
        }
        this.target[1] = Math.min(Math.max(this.target[1], state.lo[1] - 20), state.hi[1] + 40);
      } else {
        this.velAz = -dx * 0.006;
        this.velEl = dy * 0.005;
        this.az += this.velAz;
        this.el = Math.min(Math.max(this.el + this.velEl, -0.05), 1.45);
      }
      this.update();
    });
    const end = (e) => {
      drag = null;
      cv.style.cursor = 'default';
      try { cv.releasePointerCapture(e.pointerId); } catch (_) { /* noop */ }
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const k = Math.exp(e.deltaY * 0.0011);
      const span = state.hi[0] - state.lo[0];
      this.dist = Math.min(Math.max(this.dist * k, span * 0.08), span * 4);
      this.update();
    }, { passive: false });
  }

  tick() {
    // inertia damping
    if (Math.abs(this.velAz) > 1e-4 || Math.abs(this.velEl) > 1e-4) {
      this.az += this.velAz; this.el = Math.min(Math.max(this.el + this.velEl, -0.05), 1.45);
      this.velAz *= 0.88; this.velEl *= 0.88;
      this.update();
    }
  }

  info() {
    const deg = r => (r * 180 / Math.PI).toFixed(0);
    return `persp · az ${deg(this.az)}° · el ${deg(this.el)}° · d ${this.dist.toFixed(0)}`;
  }
}
