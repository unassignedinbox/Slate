// Import every browser module with a DOM stub so missing exports fail here, not in the browser.
const noop = () => {};
class El {
  constructor(tag){ this.tagName=tag; this.children=[]; this.style={setProperty:noop}; this.dataset={}; this.classList={add:noop,remove:noop}; }
  appendChild(c){ this.children.push(c); return c; }
  append(...c){ this.children.push(...c); }
  addEventListener(){} removeEventListener(){} setAttribute(){} getAttribute(){return null;}
  remove(){} querySelector(){return null;} get firstChild(){return null;} removeChild(){}
  getBoundingClientRect(){ return {left:0,top:0,width:1280,height:720}; }
  set innerHTML(v){ this._html=v; } get innerHTML(){ return this._html||''; }
  set textContent(v){ this._t=v; } get textContent(){ return this._t||''; }
}
globalThis.document = {
  createElement: (t)=>new El(t), createTextNode: (t)=>({nodeType:3,text:t}),
  getElementById: ()=>new El('div'), querySelector: ()=>new El('div'), body: new El('body'),
};
globalThis.window = { addEventListener: noop, devicePixelRatio: 1 };
try { globalThis.navigator = globalThis.navigator || {}; } catch {}
globalThis.HTMLInputElement = class {};
globalThis.HTMLSelectElement = class {};
globalThis.requestAnimationFrame = () => 0;
globalThis.GPUBufferUsage = new Proxy({}, { get: () => 1 });
globalThis.GPUTextureUsage = new Proxy({}, { get: () => 1 });
globalThis.GPUShaderStage = new Proxy({}, { get: () => 1 });

const mods = [
  '../../src/core/math.js', '../../src/core/rng.js', '../../src/core/spline.js', '../../src/core/mesh.js',
  '../../src/core/geokit.js', '../../src/core/camera.js',
  '../../src/road/profile.js', '../../src/road/network.js', '../../src/road/section.js', '../../src/road/junction.js',
  '../../src/road/roadmesh.js', '../../src/road/build.js', '../../src/road/props.js', '../../src/road/structures.js',
  '../../src/road/rail.js', '../../src/road/blocks.js', '../../src/road/generator.js', '../../src/road/scene.js',
  '../../src/sim/vehicles.js', '../../src/sim/traffic.js',
  '../../src/gfx/materials.js', '../../src/gfx/renderer.js',
  '../../src/gfx/shaders/common.js', '../../src/gfx/shaders/surface.js', '../../src/gfx/shaders/sky.js',
  '../../src/gfx/shaders/post.js', '../../src/gfx/shaders/overlay.js',
  '../../src/app/state.js', '../../src/app/gizmo.js',
  '../../src/ui/widgets.js', '../../src/ui/icons.js', '../../src/ui/layerstack.js', '../../src/ui/inspector.js',
  '../../src/ui/shell.js',
];
let bad = 0;
for (const m of mods) {
  try { await import(m); console.log('\u001b[32m✓\u001b[0m', m.replace('../../', '')); }
  catch (e) { bad++; console.log('\u001b[31m✗\u001b[0m', m.replace('../../', ''), '\n   ', e.message.split('\n')[0]); }
}
// exercise the UI render paths against a real scene
if (!bad) {
  const { Editor } = await import('../../src/app/state.js');
  const { renderStack } = await import('../../src/ui/layerstack.js');
  const { renderInspector } = await import('../../src/ui/inspector.js');
  const ed = new Editor();
  ed.generate();
  const api = new Proxy({}, { get: () => () => {} });
  const root = new El('div');
  for (const tab of ['scene', 'texture']) { ed.stackTab = tab; renderStack(ed, root); }
  const firstJunction = [...ed.scene.net.nodes.values()].find((n) => n.edges.length >= 3);
  const firstRoad = [...ed.scene.net.edges.values()][0];
  const cases = [null,
    { type: 'layer', id: 'surface' }, { type: 'layer', id: 'traffic' },
    { type: 'channel', id: 'asphalt' }, { type: 'channel', id: 'footway' },
    { type: 'junction', id: firstJunction.id }, { type: 'road', id: firstRoad.id }];
  for (const c of cases) {
    ed.selection = c;
    renderInspector(ed, root, api);
    console.log('\u001b[32m✓\u001b[0m inspector', c ? `${c.type}:${c.id}` : 'scene');
  }
}
process.exit(bad ? 1 : 0);
