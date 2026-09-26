// boot.mjs — boots the REAL game (main.js) in Node with a stubbed DOM + fake
// WebGL context, pumps the game loop, and simulates input. Catches wiring bugs
// in the browser-only path (renderer setup, HUD ids, event handlers, modes).
const noop = () => {};

// ---------- fake DOM ----------
const listeners = new Map(); // target -> {type: [fns]}
function addL(target, type, fn) {
  if (!listeners.has(target)) listeners.set(target, {});
  const m = listeners.get(target);
  if (!m[type]) m[type] = [];
  m[type].push(fn);
}
function fire(target, type, ev = {}) {
  ev.preventDefault = ev.preventDefault || noop;
  ev.stopPropagation = ev.stopPropagation || noop;
  const m = listeners.get(target);
  if (m && m[type]) for (const fn of [...m[type]]) fn(ev);
}

const INIT_HIDDEN = new Set(['pause', 'death', 'win']); // match index.html overlays
function makeEl(id) {
  const cls = new Set();
  if (INIT_HIDDEN.has(id)) cls.add('hidden');
  return {
    id,
    style: {},
    textContent: '',
    innerHTML: '',
    classList: {
      add: (...a) => a.forEach((c) => cls.add(c)),
      remove: (...a) => a.forEach((c) => cls.delete(c)),
      toggle: (c, f) => (f === undefined ? (cls.has(c) ? cls.delete(c) : cls.add(c)) : f ? cls.add(c) : cls.delete(c)),
      contains: (c) => cls.has(c),
    },
    addEventListener: (t, fn) => addL(`el:${id}`, t, fn),
    appendChild: noop,
    requestPointerLock: () => undefined,
    width: 300, height: 150,
    getContext: () => fakeGL,
  };
}
const els = new Map();
const canvasEl = makeEl('c');
els.set('c', canvasEl);

globalThis.document = {
  getElementById: (id) => {
    if (!els.has(id)) els.set(id, makeEl(id));
    return els.get(id);
  },
  createElement: (tag) => makeEl(tag),
  addEventListener: (t, fn) => addL('document', t, fn),
  exitPointerLock: noop,
  pointerLockElement: null,
  body: makeEl('body'),
};
globalThis.window = globalThis;
globalThis.self = globalThis; // three's setAnimationLoop uses `self` as its rAF context
globalThis.innerWidth = 1280;
globalThis.innerHeight = 720;
globalThis.devicePixelRatio = 1;
globalThis.addEventListener = (t, fn) => addL('window', t, fn);
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16);
globalThis.cancelAnimationFrame = (t) => clearTimeout(t);
let reloadCount = 0;
globalThis.location = { reload: () => reloadCount++ };

// ---------- fake WebGL2 ----------
// GL constants get deterministic unique values so they can be told apart
// (three does getParameter(gl.VERSION).indexOf(...), compares enums, ...).
const CONST_VAL = new Map();
const CONST_NAME = new Map();
function constVal(name) {
  if (!CONST_VAL.has(name)) {
    let h = 2166136261;
    for (let i = 0; i < name.length; i++) { h ^= name.charCodeAt(i); h = Math.imul(h, 16777619); }
    let v = (h >>> 0) % 2147483000 || 7;
    while (CONST_NAME.has(v)) v = (v + 1) % 2147483000 || 7;
    CONST_VAL.set(name, v);
    CONST_NAME.set(v, name);
  }
  return CONST_VAL.get(name);
}
const cv = (n) => constVal(n);
globalThis.WebGL2RenderingContext = function WebGL2RenderingContext() {};
const glHandler = {
  get(_t, k) {
    if (typeof k !== 'string') return undefined;
    if (/^[A-Z][A-Z0-9_]*$/.test(k)) return cv(k);                // GL constants
    if (k === 'drawingBufferWidth') return 1280;
    if (k === 'drawingBufferHeight') return 720;
    if (k === 'getParameter') {
      return (p) => {
        const n = CONST_NAME.get(p);
        if (n === 'VERSION') return 'WebGL 2.0 (fake)';
        if (n === 'SHADING_LANGUAGE_VERSION') return 'WebGL GLSL ES 3.00 (fake)';
        if (n === 'VENDOR' || n === 'RENDERER' || n === 'UNMASKED_VENDOR_WEBGL' || n === 'UNMASKED_RENDERER_WEBGL') return 'fake';
        if (n === 'MAX_TEXTURE_MAX_ANISOTROPY_EXT') return 16;
        if (typeof n === 'string' && /^MAX_/.test(n)) return 16;
        if (typeof n === 'string' && /^TEXTURE_BINDING/.test(n)) return {};
        return 8192;
      };
    }
    if (k === 'getShaderParameter' || k === 'getProgramParameter') {
      return (prog, p) => {
        const n = CONST_NAME.get(p);
        return n === 'COMPILE_STATUS' || n === 'LINK_STATUS' ? true : 0;
      };
    }
    if (k === 'getShaderInfoLog' || k === 'getProgramInfoLog') return () => '';
    if (k === 'getUniformLocation') return () => ({});
    if (k === 'getActiveUniform' || k === 'getActiveAttrib') return () => ({ name: 'u', type: 5126, size: 1 });
    if (k === 'getAttribLocation') return () => 0;
    if (k === 'createProgram' || k === 'createShader') return () => ({});
    if (/^create(Buffers?|Textures?|Framebuffers?|Renderbuffers?|VertexArrays?|Queries?|Samplers?|TransformFeedbacks?)?$/.test(k) || /^create[A-Z]/.test(k)) {
      return () => ({}); // fresh object per call (WeakMap-safe)
    }
    if (k === 'getExtension') return () => fakeExt;
    if (k === 'getSupportedExtensions') return () => ['EXT_texture_filter_anisotropic'];
    if (k === 'getShaderPrecisionFormat') return () => ({ precision: 23, rangeMin: 127, rangeMax: 127 });
    if (k === 'checkFramebufferStatus') return () => cv('FRAMEBUFFER_COMPLETE');
    if (k === 'getError') return () => 0;
    return () => undefined;                                       // all other methods: no-op
  },
};
const fakeGL = new Proxy(Object.create(WebGL2RenderingContext.prototype), glHandler);
const fakeExt = new Proxy({}, { get: (_t, k) => (typeof k === 'string' ? cv(k) : undefined) });

// ---------- boot the game ----------
let fails = 0;
const assert = (c, msg) => { if (!c) { console.error('  FAIL:', msg); fails++; } else console.log('  ok:', msg); };

console.log('== importing main.js (full game boot) ==');
await import('../js/main.js');

const S = (await import('../js/state.js')).S;

assert(S.scene && S.camera && S.renderer, 'renderer/scene/camera created');
assert(S.terrainMesh, 'terrain built');
assert(S.car && S.player, 'car & player created');
assert(S.sentries.length === 8, '8 sentries');
assert(S.effects && S.audio, 'effects & audio systems exist');

// all HUD elements must have been found (no nulls used)
console.log('== HUD element ids used by main.js exist in the fake DOM ==');
const uiIds = ['intro', 'pause', 'death', 'win', 'startBtn', 'resumeBtn', 'redeployBtn', 'restartBtn',
  'deathCause', 'objDist', 'tideFill', 'tideState', 'hpFill', 'vehCard', 'vehFill',
  'hint', 'banner', 'vignette', 'waterFx', 'dot',
  'statTime', 'statDeaths', 'statMines', 'statVehicle', 'c'];
for (const id of uiIds) assert(els.has(id), `element #${id}`);

console.log('== simulate: start game, run 600 frames, drive, pause/resume ==');
fire('el:startBtn', 'click');
assert(S.mode === 'play', `mode is play after START (got ${S.mode})`);

// hold W, run frames via the renderer's animation loop (rAF stub)
const keyDown = (code) => fire('document', 'keydown', { code, preventDefault: noop });
const keyUp = (code) => fire('document', 'keyup', { code });
const frames = async (n) => {
  for (let i = 0; i < n; i++) {
    await new Promise((r) => requestAnimationFrame(r));
  }
};

keyDown('KeyW');
await frames(300);
console.log(`  after 300 frames: t=${S.t.toFixed(1)}s player.z=${S.player.pos.z.toFixed(1)} water=${S.waterLevel.toFixed(2)} waterline=${S.waterlineZ.toFixed(0)}`);
assert(S.t > 3, 'mission clock advanced');
assert(S.player.pos.z > -145, 'player moved inland');
assert(S.waterLevel > -3.6, 'tide started rising');

// enter the car (teleport next to it first)
S.player.pos.set(S.car.pos.x + 2, S.car.pos.y, S.car.pos.z);
fire('document', 'keydown', { code: 'KeyE', preventDefault: noop });
assert(S.player.inCar, 'player entered car');
keyUp('KeyW');
keyDown('KeyW');
await frames(240);
console.log(`  car z=${S.car.pos.z.toFixed(1)} speed=${S.car.speed.toFixed(1)} hp=${S.car.health.toFixed(0)}`);
assert(S.car.pos.z > -130, 'car drove inland');

// orbit cam + mute + pause/resume via Esc fallback path
const uiEls = (id) => els.get(id);
fire('document', 'keydown', { code: 'KeyC', preventDefault: noop });
assert(S.camMode === 'orbit', `KeyC toggled orbit cam (got ${S.camMode})`);
fire('document', 'keydown', { code: 'KeyC', preventDefault: noop });
assert(S.camMode === 'fp', `KeyC toggled back to fp (got ${S.camMode})`);
fire('document', 'keydown', { code: 'KeyM', preventDefault: noop });
assert(S.muted === true, `KeyM muted audio (got ${S.muted})`);
fire('document', 'keydown', { code: 'KeyM', preventDefault: noop });
assert(S.muted === false, `KeyM unmuted audio (got ${S.muted})`);

console.log('== pause / resume (Esc fallback) ==');
assert(S.plFallback, `pointer-lock fallback engaged (got ${S.plFallback})`);
fire('document', 'keydown', { code: 'Escape', preventDefault: noop });
await frames(5);
assert(S.mode === 'pause', `Esc paused the game (got ${S.mode})`);
assert(uiEls('pause').classList.contains('hidden') === false, 'pause overlay shown');
const tAtPause = S.t;
await frames(20);
assert(S.t === tAtPause, 'mission clock frozen while paused');
fire('document', 'keydown', { code: 'Escape', preventDefault: noop });
await frames(5);
assert(S.mode === 'play', `Esc resumed the game (got ${S.mode})`);
assert(uiEls('pause').classList.contains('hidden'), 'pause overlay hidden again');

console.log('== mine death + redeploy ==');
// drive the car onto a live tank mine: mine → car destroyed → player killed
keyUp('KeyW');
const world = await import('../js/world.js');
const mine = S.tankMines.find((m) => m.alive);
// place the car so a WHEEL sits exactly on the mine (trigger checks wheels)
S.car.pos.set(mine.x, 0, mine.z);
S.car.pos.y = world.H(mine.x, mine.z);
S.car.speed = 0;
{
  const w = S.car.wheelPositions[0];
  S.car.pos.x += mine.x - w[0];
  S.car.pos.z += mine.z - w[1];
}
await frames(30);
assert(S.stats.minesTripped >= 1, `mine counter tripped (got ${S.stats.minesTripped})`);
assert(S.car.alive === false, `tank mine destroyed the car (alive=${S.car.alive})`);
assert(S.mode === 'dead', `player died in the blast (got ${S.mode})`);
assert(uiEls('death').classList.contains('hidden') === false, 'death overlay shown');
assert(S.stats.deaths === 1, `death counter incremented (got ${S.stats.deaths})`);
fire('el:redeployBtn', 'click');
await frames(5);
assert(S.mode === 'play', `redeploy returned to play (got ${S.mode})`);
assert(S.player.pos.z < -120, `player respawned at the waterline (z=${S.player.pos.z.toFixed(1)})`);
assert(uiEls('death').classList.contains('hidden'), 'death overlay hidden after redeploy');

console.log('== fast-forward: teleport to the wall, check WIN ==');
S.player.inCar = false;
S.player.pos.set(0, 0, 163);
S.player.pos.y = world.H(0, 163);
await frames(10);
assert(S.mode === 'win', `mode is win at the wall (got ${S.mode})`);
assert(uiEls('win').classList.contains('hidden') === false, 'win overlay shown');

// restart button wired
fire('el:restartBtn', 'click');
assert(reloadCount === 1, `restart button reloads the page (called ${reloadCount}x)`);

console.log(fails === 0 ? '\nBOOT TEST PASSED' : `\nBOOT TEST FAILED (${fails})`);
process.exit(fails === 0 ? 0 : 1);
