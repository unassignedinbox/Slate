// Headless boot test: stub WebGL2 + DOM, import main.js, drive a few frames.
// Catches wiring bugs (missing ids, undefined calls, bad imports) without a GPU.
import { JSDOM } from 'jsdom';
import { readFileSync } from 'fs';

const html = readFileSync('/home/user/Slate/index.html', 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost:8123/', pretendToBeVisual: true });
const { window } = dom;

// ── WebGL2 stub ──
const methodImpls = {
  getExtension: () => ({}),
  getShaderParameter: () => true,
  getProgramParameter: () => true,
  getShaderInfoLog: () => '',
  getProgramInfoLog: () => '',
  checkFramebufferStatus: () => 36053,
  getUniformLocation: () => ({ __loc: true }),
  createShader: () => ({}), createProgram: () => ({}), createTexture: () => ({}),
  createFramebuffer: () => ({}), createVertexArray: () => ({}),
  readPixels: (t, x, y, w, h, f, type, buf) => { if (buf && buf.fill) buf.fill(1); },
  getParameter: () => 16384,
};
function makeGL() {
  const target = {};
  return new Proxy(target, {
    get(t, prop) {
      if (prop in methodImpls) return methodImpls[prop];
      if (typeof prop === 'string' && /^(create|delete|bind|draw|enable|disable|viewport|uniform|tex|framebuffer|clear|blend|depth|active|use|shader|attach|link|compile|pixel|scissor|colorMask|stencil|polygon|hint|flush|finish|generateMipmap|copyTex)/.test(prop)) {
        return () => undefined;
      }
      if (typeof prop === 'string' && /^[A-Z][A-Z0-9_]+$/.test(prop)) {
        if (prop === 'FRAMEBUFFER_COMPLETE') return 36053;
        let h = 0; for (const c of prop) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
        return h + 2;
      }
      return 1; // constants
    },
    set() { return true; },
  });
}
window.HTMLCanvasElement.prototype.getContext = function () { return makeGL(); };
window.HTMLCanvasElement.prototype.toBlob = function (cb) { cb({ }); };

let rafCb = null;
window.requestAnimationFrame = (cb) => { rafCb = cb; return 1; };
window.devicePixelRatio = 1;

// globals for the imported module
globalThis.window = window;
globalThis.document = window.document;
globalThis.requestAnimationFrame = window.requestAnimationFrame;
globalThis.location = window.location;
globalThis.URL = window.URL;

const errors = [];
window.addEventListener('error', (e) => errors.push(e.message));

// jsdom lacks setPointerCapture
window.HTMLElement.prototype.setPointerCapture = function () { };
window.HTMLElement.prototype.releasePointerCapture = function () { };

try {
  await import('/home/user/Slate/src/main.js');
} catch (e) {
  console.error('IMPORT FAILED:', e);
  process.exit(1);
}
await new Promise(r => setTimeout(r, 50));

const app = window.slate;
if (!app) {
  console.error('BOOT FAILED — window.slate missing. fatal visible:', !window.document.getElementById('fatal').hidden);
  const msg = window.document.getElementById('fatalMsg').textContent;
  if (msg) console.error('fatal:', msg);
  process.exit(1);
}

// drive frames
for (let i = 0; i < 5; i++) {
  const cb = rafCb; rafCb = null;
  if (!cb) break;
  cb(performance.now() + i * 16);
}
// exercise core paths
app.togglePlay();
for (let i = 0; i < 3; i++) { const cb = rafCb; rafCb = null; cb && cb(performance.now() + 100 + i * 16); }
app.stepOnce();
app.rebuild();

// exercise selection & param edits
const node = app.graph.nodes.find(n => n.type === 'ridged');
app.select(node.id);
node.params.amp = 9.5;
app.onNodeParam(node);
const river = app.graph.nodes.find(n => n.type === 'river');
app.select(river.id);
river.params.srcX = 10;
app.inspector.render();
app.inspector.tab = 'erosion'; app.inspector.render();
app.inspector.tab = 'water'; app.inspector.render();
app.inspector.tab = 'render'; app.inspector.render();
app.inspector.tab = 'export'; app.inspector.render();

// graph ops
app.geditor.tidy();
const sph = app.geditor; void sph;
app.applyQuality('performance');
app.applyQuality('balanced');

// preset switching
for (const p of app.presets) app.loadPreset(p);

console.log('nodes:', app.graph.nodes.length, 'links:', app.graph.links.length,
  'alive:', app.sim.alive, 'fatal shown:', !window.document.getElementById('fatal').hidden);
console.log('errors:', errors.length ? errors : 'none');
console.log('BOOT TEST PASSED');
process.exit(0);
