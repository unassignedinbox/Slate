// Keyboard + gamepad. Driving: W/S or arrows, A/D steer, Space handbrake.
export class Input {
  constructor(target = window) {
    this.keys = new Set();
    this.pressed = new Set();
    this.state = { throttle: 0, brake: 0, steer: 0, handbrake: false };
    this.pad = null;
    target.addEventListener('keydown', (e) => {
      if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    target.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    this._padPrev = [];
  }
  /** Consume a one-shot key press. */
  hit(code) { if (this.pressed.has(code)) { this.pressed.delete(code); return true; } return false; }
  endFrame() { this.pressed.clear(); }
  poll() {
    const k = this.keys, s = this.state;
    let thr = k.has('KeyW') || k.has('ArrowUp') ? 1 : 0;
    let brk = k.has('KeyS') || k.has('ArrowDown') ? 1 : 0;
    let st = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    let hb = k.has('Space');
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const ax = Math.abs(p.axes[0]) > 0.12 ? p.axes[0] : 0;
      if (ax) st = ax;
      const rt = p.buttons[7]?.value ?? 0, lt = p.buttons[6]?.value ?? 0;
      if (rt > 0.05) thr = rt;
      if (lt > 0.05) brk = lt;
      if (p.buttons[0]?.pressed || p.buttons[1]?.pressed) hb = true;
      const map = { 3: 'KeyR', 9: 'Escape', 8: 'Enter', 2: 'KeyC' };
      for (const [i, code] of Object.entries(map)) {
        const down = !!p.buttons[i]?.pressed;
        if (down && !this._padPrev[i]) this.pressed.add(code);
        this._padPrev[i] = down;
      }
      break;
    }
    s.throttle = thr; s.brake = brk; s.steer = st; s.handbrake = hb;
    return s;
  }
}
