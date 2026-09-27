/** Keyboard + gamepad + touch input, normalised to a driving state. */
export class Input {
  constructor(dom) {
    this.keys = new Set();
    this.throttle = 0;
    this.brake = 0;
    this.steer = 0;
    this.boost = false;
    this.handbrake = false;
    this.anyPressed = false;
    this.onPress = () => {};
    this._steerSmooth = 0;
    this.touch = { left: false, right: false, gas: false, brake: false, boost: false };

    window.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.onPress(e.code);
      this.keys.add(e.code);
      this.anyPressed = true;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    void dom;
  }

  bindTouchButton(el, name) {
    const set = (v) => (e) => {
      e.preventDefault();
      this.touch[name] = v;
      if (v) {
        this.anyPressed = true;
        this.onPress('Touch');
      }
    };
    el.addEventListener('touchstart', set(true), { passive: false });
    el.addEventListener('touchend', set(false), { passive: false });
    el.addEventListener('touchcancel', set(false), { passive: false });
    el.addEventListener('mousedown', set(true));
    window.addEventListener('mouseup', set(false));
  }

  update(dt) {
    const k = this.keys;
    const up = k.has('KeyW') || k.has('ArrowUp') || this.touch.gas;
    const down = k.has('KeyS') || k.has('ArrowDown') || this.touch.brake;
    const left = k.has('KeyA') || k.has('ArrowLeft') || this.touch.left;
    const right = k.has('KeyD') || k.has('ArrowRight') || this.touch.right;

    let steerTarget = (right ? 1 : 0) - (left ? 1 : 0);
    let throttle = up ? 1 : 0;
    let brake = down ? 1 : 0;
    let boost = k.has('ShiftLeft') || k.has('ShiftRight') || this.touch.boost;
    let handbrake = k.has('Space');

    // gamepad
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p) continue;
      const ax = p.axes[0] || 0;
      if (Math.abs(ax) > 0.12) steerTarget = ax;
      throttle = Math.max(throttle, p.buttons[7] ? p.buttons[7].value : 0);
      brake = Math.max(brake, p.buttons[6] ? p.buttons[6].value : 0);
      if (p.buttons[0] && p.buttons[0].pressed) handbrake = true;
      if (p.buttons[1] && p.buttons[1].pressed) boost = true;
      if (throttle > 0.05) this.anyPressed = true;
    }

    const rate = Math.min(1, dt * 7.5);
    this._steerSmooth += (steerTarget - this._steerSmooth) * rate;
    this.steer = Math.abs(this._steerSmooth) < 0.004 ? 0 : this._steerSmooth;
    this.throttle = throttle;
    this.brake = brake;
    this.boost = boost;
    this.handbrake = handbrake;
  }
}
