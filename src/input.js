import { clamp } from './util.js';

export class Input {
  constructor(target = window) {
    this.keys = new Set();
    this.throttle = 0;
    this.brake = 0;
    this.steer = 0;
    this.handbrake = false;
    this.touch = { left: false, right: false, gas: false, brake: false };
    this.onAction = () => {};
    this.enabled = true;

    const down = (e) => {
      if (e.repeat) return;
      const k = e.code;
      this.keys.add(k);
      if (
        [
          'ArrowUp',
          'ArrowDown',
          'ArrowLeft',
          'ArrowRight',
          'Space',
          'KeyW',
          'KeyA',
          'KeyS',
          'KeyD',
        ].includes(k)
      ) {
        e.preventDefault();
      }
      const map = {
        KeyC: 'camera',
        KeyR: 'recoverStart',
        KeyP: 'pause',
        Escape: 'pause',
        KeyM: 'mute',
        Enter: 'confirm',
        KeyH: 'help',
      };
      if (map[k]) this.onAction(map[k]);
    };
    const up = (e) => {
      this.keys.delete(e.code);
      if (e.code === 'KeyR') this.onAction('recoverEnd');
    };
    target.addEventListener('keydown', down, { passive: false });
    target.addEventListener('keyup', up);
    target.addEventListener('blur', () => this.keys.clear());
    this._down = down;
    this._up = up;

    this._bindTouch();
  }

  _bindTouch() {
    const isTouch = matchMedia('(hover: none)').matches || 'ontouchstart' in window;
    const wrap = document.getElementById('touch');
    if (!wrap) return;
    if (isTouch) wrap.classList.add('on');
    const bind = (id, key) => {
      const el = document.getElementById(id);
      if (!el) return;
      const set = (v) => (e) => {
        e.preventDefault();
        this.touch[key] = v;
      };
      el.addEventListener('touchstart', set(true), { passive: false });
      el.addEventListener('touchend', set(false), { passive: false });
      el.addEventListener('touchcancel', set(false), { passive: false });
      el.addEventListener('mousedown', set(true));
      el.addEventListener('mouseup', set(false));
      el.addEventListener('mouseleave', set(false));
    };
    bind('tLeft', 'left');
    bind('tRight', 'right');
    bind('tGas', 'gas');
    bind('tBrake', 'brake');
  }

  has(...codes) {
    return codes.some((c) => this.keys.has(c));
  }

  update(dt) {
    if (!this.enabled) {
      this.throttle = 0;
      this.brake = 0;
      this.steer = 0;
      this.handbrake = false;
      return;
    }
    let steerInput = 0;
    if (this.has('KeyA', 'ArrowLeft') || this.touch.left) steerInput -= 1;
    if (this.has('KeyD', 'ArrowRight') || this.touch.right) steerInput += 1;

    let gas = this.has('KeyW', 'ArrowUp') || this.touch.gas ? 1 : 0;
    let brake = this.has('KeyS', 'ArrowDown') || this.touch.brake ? 1 : 0;

    // Gamepad (first connected pad).
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const pad of pads) {
      if (!pad) continue;
      const ax = pad.axes[0] || 0;
      if (Math.abs(ax) > 0.15) steerInput += ax;
      const rt = pad.buttons[7] ? pad.buttons[7].value : 0;
      const lt = pad.buttons[6] ? pad.buttons[6].value : 0;
      if (rt > 0.05) gas = Math.max(gas, rt);
      if (lt > 0.05) brake = Math.max(brake, lt);
      if (pad.buttons[0] && pad.buttons[0].pressed) this.handbrakePad = true;
      else this.handbrakePad = false;
      break;
    }

    this.steer = clamp(steerInput, -1, 1);
    this.throttle = clamp(gas, 0, 1);
    this.brake = clamp(brake, 0, 1);
    this.handbrake = this.keys.has('Space') || !!this.handbrakePad;
  }
}
