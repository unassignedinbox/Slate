// Keyboard and gamepad. Keys are digital, so steering is eased to feel
// analogue. A gamepad's stick is used as-is.

const KEYS = {
  throttle: ['KeyW', 'ArrowUp'],
  brake: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  handbrake: ['Space'],
};

export function createInput() {
  const down = new Set();
  const pressed = new Set();
  const held = (name) => KEYS[name].some((k) => down.has(k));

  window.addEventListener('keydown', (e) => {
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    if (!down.has(e.code)) pressed.add(e.code);
    down.add(e.code);
  });
  window.addEventListener('keyup', (e) => down.delete(e.code));
  window.addEventListener('blur', () => down.clear());

  let steer = 0;
  let prevButtons = [];
  const pads = () => (navigator.getGamepads ? Array.from(navigator.getGamepads()).filter(Boolean) : []);

  return {
    // Call once per frame. Returns the car's control input and any one-shot presses.
    read(dt) {
      const pad = pads()[0];
      const axis = pad ? pad.axes[0] : 0;
      const dead = Math.abs(axis) < 0.12 ? 0 : axis;
      const padThrottle = pad && pad.buttons[7] ? pad.buttons[7].value : 0;
      const padBrake = pad && pad.buttons[6] ? pad.buttons[6].value : 0;
      const padHand = pad && pad.buttons[0] ? pad.buttons[0].pressed : false;

      const keySteer = (held('right') ? 1 : 0) - (held('left') ? 1 : 0);
      const target = dead !== 0 ? dead : keySteer;
      const rate = target === 0 ? 6 : 5;
      steer += (target - steer) * Math.min(1, rate * dt);
      if (Math.abs(steer) < 1e-3 && target === 0) steer = 0;

      const throttle = Math.max(held('throttle') ? 1 : 0, padThrottle);
      const brake = Math.max(held('brake') ? 1 : 0, padBrake);
      const handbrake = held('handbrake') || padHand;

      const oneShot = (code) => pressed.has(code);
      const padPressed = (i) => !!(pad && pad.buttons[i] && pad.buttons[i].pressed && !prevButtons[i]);
      prevButtons = pad ? pad.buttons.map((b) => b.pressed) : [];

      return {
        input: { throttle, brake, steer: Math.max(-1, Math.min(1, steer)), handbrake },
        respawn: oneShot('KeyR') || padPressed(3),
        camera: oneShot('KeyC') || padPressed(1),
        debug: oneShot('KeyG'),
        map: oneShot('KeyM'),
        overview: oneShot('KeyO'),
        restart: oneShot('Enter'),
      };
    },
    endFrame() {
      pressed.clear();
    },
  };
}
