// Keyboard + gamepad input with per-frame edge detection.
const KEYMAP = {
  ArrowUp: 'throttle', KeyW: 'throttle',
  ArrowDown: 'brake', KeyS: 'brake',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  KeyQ: 'airbrakeL', KeyE: 'airbrakeR',
  ShiftLeft: 'boost', ShiftRight: 'boost',
  Space: 'boost',
  KeyZ: 'pulse',
};

export class Input {
  constructor(target = window) {
    this.down = new Set();
    this.pressed = new Set();   // consumed each frame
    this.axis = { steer: 0, throttle: 0, brake: 0, airL: 0, airR: 0, boost: 0 };
    this.enabled = true;
    this.lastDevice = 'keyboard';

    this._onKey = (e, isDown) => {
      const act = KEYMAP[e.code];
      if (act) {
        if (isDown) { if (!this.down.has(act)) this.pressed.add(act); this.down.add(act); }
        else this.down.delete(act);
        e.preventDefault();
      }
      if (isDown && !e.repeat) this.pressed.add('key:' + e.code);
      this.lastDevice = 'keyboard';
    };
    target.addEventListener('keydown', (e) => this._onKey(e, true), { passive: false });
    target.addEventListener('keyup', (e) => this._onKey(e, false), { passive: false });
    target.addEventListener('blur', () => { this.down.clear(); });
  }

  /** call once per frame, before reading */
  pollGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let p = null;
    for (const pad of pads) { if (pad && pad.connected) { p = pad; break; } }
    this.pad = p;
    if (!p) return;
    const dz = (v) => (Math.abs(v) < 0.14 ? 0 : v);
    const s = dz(p.axes[0] || 0);
    const t = p.buttons[7] ? p.buttons[7].value : 0;
    const b = p.buttons[6] ? p.buttons[6].value : 0;
    if (Math.abs(s) > 0.05 || t > 0.05 || b > 0.05) this.lastDevice = 'gamepad';
  }

  read() {
    this.pollGamepad();
    const p = this.pad;
    const k = this.down;
    const g = (i) => (p && p.buttons[i] ? p.buttons[i].pressed : false);

    let steer = (k.has('right') ? 1 : 0) - (k.has('left') ? 1 : 0);
    let throttle = (k.has('throttle') ? 1 : 0) || (g(7) ? 1 : 0);
    let brake = (k.has('brake') ? 1 : 0) || (g(6) ? 1 : 0);
    let airL = (k.has('airbrakeL') ? 1 : 0) || (g(4) ? 1 : 0);
    let airR = (k.has('airbrakeR') ? 1 : 0) || (g(5) ? 1 : 0);
    let boost = 0;
    if (k.has('boost') || g(0) || g(1)) boost = 1;

    if (p) {
      const s = p.axes[0] || 0;
      if (Math.abs(s) > 0.14) steer = Math.max(-1, Math.min(1, steer + s));
      const tt = p.buttons[7] ? p.buttons[7].value : 0;
      const bb = p.buttons[6] ? p.buttons[6].value : 0;
      if (tt > 0.02) throttle = Math.max(throttle, tt);
      if (bb > 0.02) brake = Math.max(brake, bb);
      const l2 = p.buttons[4] ? p.buttons[4].value : 0;
      const r2 = p.buttons[5] ? p.buttons[5].value : 0;
      if (l2 > 0.02) airL = Math.max(airL, l2);
      if (r2 > 0.02) airR = Math.max(airR, r2);
    }
    this.axis = { steer, throttle, brake, airL, airR, boost };
    return this.axis;
  }

  /** one-shot: key or pad button pressed this frame */
  tapped(action) {
    if (this.pressed.has(action)) return true;
    const p = this.pad;
    if (!p) return false;
    if (action === 'pulse') return !!(p.buttons[2] && p.buttons[2].pressed) || !!(p.buttons[3] && p.buttons[3].pressed);
    if (action === 'restart') return !!(p.buttons[9] && p.buttons[9].pressed);
    if (action === 'cam') return !!(p.buttons[8] && p.buttons[8].pressed);
    return false;
  }

  keyTap(code) { return this.pressed.has('key:' + code); }

  endFrame() { this.pressed.clear(); }
}
