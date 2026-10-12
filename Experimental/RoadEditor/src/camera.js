//==================================================================================================
//  ROADEDITOR — CAMERA AND CONTROLS
//==================================================================================================
//  A fly camera in the shape Unreal's viewport uses: WASD to move, right-drag (or left-drag with
//  the look modifier) to aim, wheel to change fly speed, Alt+drag to orbit a focus point, F to
//  focus the selection, and number keys for the standard view presets.
//==================================================================================================

import { clamp, DEG } from './core.js';
import { lookAt, perspective } from './render.js';

export class Camera {
  constructor(x = 0, y = 0, z = 40) {
    this.position = { x, y, z };
    this.yaw = 180 * DEG; // 0 looks along +Y; start looking back at the origin
    this.pitch = -18 * DEG;
    this.fov = 62;
    this.near = 0.4;
    this.far = 12000;
    this.speed = 60;
    this.mode = 'fly';
    this.target = { x, y, z: 0 };
    this.orbitYaw = 0;
    this.orbitPitch = -35 * DEG;
    this.distance = 600;
  }

  get forward() {
    const cp = Math.cos(this.pitch);
    return { x: Math.sin(this.yaw) * cp, y: Math.cos(this.yaw) * cp, z: Math.sin(this.pitch) };
  }
  get right() {
    return { x: Math.cos(this.yaw), y: -Math.sin(this.yaw), z: 0 };
  }

  viewMatrix() {
    const f = this.forward;
    return lookAt(this.position, { x: this.position.x + f.x, y: this.position.y + f.y, z: this.position.z + f.z }, { x: 0, y: 0, z: 1 });
  }
  projectionMatrix(aspect) {
    return perspective(this.fov * DEG, aspect, this.near, this.far);
  }

  update(dt, input) {
    const fast = input.shift ? 6 : 1;
    const slow = input.ctrl ? 0.22 : 1;
    const rate = this.speed * fast * slow;
    const f = this.forward;
    const r = this.right;
    let mx = 0;
    let my = 0;
    let mz = 0;
    if (input.mode === 'orbit') {
      // Orbit keeps the focus point fixed and moves the eye around it.
      const p = this.position;
      const dx = p.x - this.target.x;
      const dy = p.y - this.target.y;
      const dz = p.z - this.target.z;
      let dist = Math.hypot(dx, dy, dz) || this.distance;
      let yaw = Math.atan2(dx, dy);
      let pitch = Math.asin(clamp(dz / dist, -1, 1));
      if (input.orbitDX) yaw -= input.orbitDX;
      if (input.orbitDY) pitch = clamp(pitch + input.orbitDY, -1.5, 1.5);
      if (input.wheel) dist = clamp(dist * Math.pow(1.0015, input.wheel), 6, 6000);
      if (input.panX || input.panY) {
        const cr = { x: Math.cos(yaw), y: -Math.sin(yaw), z: 0 };
        const cu = { x: -Math.sin(yaw) * Math.sin(pitch), y: -Math.cos(yaw) * Math.sin(pitch), z: Math.cos(pitch) };
        this.target.x -= (cr.x * input.panX + cu.x * input.panY) * dist * 0.0016;
        this.target.y -= (cr.y * input.panX + cu.y * input.panY) * dist * 0.0016;
        this.target.z -= (cr.z * input.panX + cu.z * input.panY) * dist * 0.0016;
      }
      this.distance = dist;
      const cp = Math.cos(pitch);
      this.position = {
        x: this.target.x + Math.sin(yaw) * cp * dist,
        y: this.target.y + Math.cos(yaw) * cp * dist,
        z: this.target.z + Math.sin(pitch) * dist,
      };
      // The orbit owns the eye position, so it also has to own the aim: an orbit camera that keeps
      // the yaw it had before it started orbiting is looking at the horizon behind the target.
      this.yaw = Math.atan2(this.target.x - this.position.x, this.target.y - this.position.y);
      this.pitch = Math.asin(clamp((this.target.z - this.position.z) / dist, -1, 1));
      return;
    }
    if (input.forward) {
      mx += f.x * input.forward;
      my += f.y * input.forward;
      mz += f.z * input.forward;
    }
    if (input.strafe) {
      mx += r.x * input.strafe;
      my += r.y * input.strafe;
    }
    if (input.up) mz += 1;
    if (input.down) mz -= 1;
    const l = Math.hypot(mx, my, mz);
    if (l > 1e-4) {
      this.position = {
        x: this.position.x + (mx / l) * rate * dt,
        y: this.position.y + (my / l) * rate * dt,
        z: this.position.z + (mz / l) * rate * dt,
      };
    }
    const targetZ = 16;
    if (!input.freeVertical && this.position.z < targetZ) this.position.z = targetZ;
  }

  look(dx, dy) {
    this.yaw -= dx * 0.0026;
    this.pitch = clamp(this.pitch - dy * 0.0026, -1.53, 1.53);
    this.yaw = ((this.yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  }

  focus(x, y, z, distance = 90) {
    this.target = { x, y, z };
    this.distance = distance;
    this.position = { x: x - Math.sin(this.yaw) * distance, y: y - Math.cos(this.yaw) * distance, z: z + distance * 0.45 };
  }

  preset(kind, centre = { x: 0, y: 0, z: 0 }, extent = 1000) {
    switch (kind) {
      case 'top':
        this.mode = 'fly';
        this.position = { x: centre.x, y: centre.y, z: extent * 1.15 };
        this.pitch = -89.5 * DEG;
        this.yaw = 0;
        this.far = Math.max(12000, extent * 8);
        break;
      case 'map':
        this.mode = 'orbit';
        this.target = { x: centre.x, y: centre.y, z: 0 };
        this.distance = extent * 0.8;
        this.yaw = 0;
        this.pitch = -40 * DEG;
        this.position = { x: centre.x, y: centre.y - extent * 0.62, z: extent * 0.52 };
        this.speed = 120;
        break;
      case 'street':
        this.mode = 'orbit';
        this.target = { x: centre.x, y: centre.y, z: 1.6 };
        this.yaw = 0.5;
        this.pitch = -12 * DEG;
        this.position = { x: centre.x + 14, y: centre.y - 18, z: 5.5 };
        this.speed = 24;
        break;
      case 'chase':
        this.mode = 'fly';
        this.position = { x: centre.x, y: centre.y - 30, z: 6 };
        this.pitch = -6 * DEG;
        this.speed = 90;
        break;
    }
  }
}

//--------------------------------------------------------------------------------------------------
//  Input: keyboard + pointer, collected into the small object the camera consumes each frame.
//--------------------------------------------------------------------------------------------------
export class Input {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.keys = new Set();
    this.state = {
      forward: 0,
      strafe: 0,
      up: 0,
      down: 0,
      shift: false,
      ctrl: false,
      mode: opts.mode || 'fly',
      wheel: 0,
      orbitDX: 0,
      orbitDY: 0,
      panX: 0,
      panY: 0,
      freeVertical: false,
    };
    this.mouse = { x: 0, y: 0, down: false, button: 0, dragging: false };
    this.handlers = opts.handlers || {};
    this.bind();
  }

  bind() {
    const c = this.canvas;
    const H = this.handlers;
    window.addEventListener('keydown', (e) => {
      if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
      this.keys.add(e.code);
      if (H.onKey) H.onKey(e);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      this.mouse.down = true;
      this.mouse.button = e.button;
      this.mouse.dragging = true;
      this.mouse.lastX = e.clientX;
      this.mouse.lastY = e.clientY;
      if (H.onPointerDown) H.onPointerDown(e);
    });
    c.addEventListener('pointerup', (e) => {
      this.mouse.down = false;
      this.mouse.dragging = false;
      if (H.onPointerUp) H.onPointerUp(e);
    });
    c.addEventListener('pointermove', (e) => {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      if (this.mouse.dragging) {
        const dx = e.clientX - (this.mouse.lastX ?? e.clientX);
        const dy = e.clientY - (this.mouse.lastY ?? e.clientY);
        this.mouse.lastX = e.clientX;
        this.mouse.lastY = e.clientY;
        const lookButton = this.mouse.button === 2 || this.keys.has('AltLeft') || this.keys.has('AltRight') || this.keys.has('KeyZ');
        if (lookButton) {
          if (this.state.mode === 'orbit' && this.keys.has('AltLeft')) {
            this.state.orbitDX = dx * 0.0055;
            this.state.orbitDY = dy * 0.0055;
          } else if (this.state.mode === 'orbit' && this.mouse.button === 1) {
            this.state.orbitDX = dx * 0.0055;
            this.state.orbitDY = dy * 0.0055;
          } else if (H.onLook) {
            H.onLook(dx, dy);
          }
        } else if (this.mouse.button === 1 || this.keys.has('AltLeft') || this.state.mode === 'orbit') {
          this.state.panX = dx;
          this.state.panY = dy;
        }
        if (H.onPointerMove) H.onPointerMove(e);
      }
    });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = -e.deltaY;
      if (e.shiftKey || H.wheelIsSpeed) this.state.wheel = delta;
      else this.state.wheel = delta;
      if (H.onWheel) H.onWheel(delta, e);
    }, { passive: false });
  }

  consume() {
    const s = this.state;
    s.forward = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
    s.strafe = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
    s.up = (this.keys.has('KeyE') || this.keys.has('Space') ? 1 : 0) - (this.keys.has('KeyQ') || this.keys.has('KeyC') ? 1 : 0);
    s.down = 0;
    s.shift = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    s.ctrl = this.keys.has('ControlLeft') || this.keys.has('ControlRight');
    return s;
  }

  endFrame() {
    this.state.wheel = 0;
    this.state.orbitDX = 0;
    this.state.orbitDY = 0;
    this.state.panX = 0;
    this.state.panY = 0;
  }
}
