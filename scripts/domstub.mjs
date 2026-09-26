// Minimal DOM shims so the game modules can be imported in plain Node.
function makeCtx2D(width, height) {
  return {
    canvas: { width, height },
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    font: '',
    textAlign: 'left',
    globalAlpha: 1,
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    putImageData() {},
    fillRect() {},
    clearRect() {},
    strokeRect() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    fill() {},
    stroke() {},
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    scale() {},
    fillText() {},
    measureText: () => ({ width: 10 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    drawImage() {},
  };
}

export function installDom() {
  if (globalThis.document) return;
  const listeners = new Map();
  const doc = {
    createElement(tag) {
      if (tag === 'canvas') {
        const c = {
          width: 300,
          height: 150,
          style: {},
          getContext: (type) => (type === '2d' ? makeCtx2D(c.width, c.height) : null),
          addEventListener() {},
          removeEventListener() {},
        };
        return c;
      }
      return { style: {}, addEventListener() {}, appendChild() {}, classList: { add() {}, remove() {}, toggle() {} } };
    },
    getElementById: () => null,
    querySelector: () => null,
    addEventListener() {},
    removeEventListener() {},
    body: { appendChild() {}, style: {} },
  };
  globalThis.document = doc;
  globalThis.window = {
    innerWidth: 1280,
    innerHeight: 720,
    devicePixelRatio: 1,
    addEventListener: (k, f) => listeners.set(k, f),
    removeEventListener: () => {},
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    requestAnimationFrame: (f) => setTimeout(() => f(performance.now()), 0),
    location: { href: 'http://localhost/' },
  };
  if (!globalThis.navigator) {
    globalThis.navigator = { userAgent: 'node', getGamepads: () => [] };
  } else if (!globalThis.navigator.getGamepads) {
    try {
      globalThis.navigator.getGamepads = () => [];
    } catch {
      /* read-only navigator in newer node — fine, nothing needs it here */
    }
  }
  globalThis.requestAnimationFrame = globalThis.window.requestAnimationFrame;
  globalThis.matchMedia = globalThis.window.matchMedia;
  globalThis.self = globalThis;
}
