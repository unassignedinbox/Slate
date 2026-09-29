/**
 * UI smoke test (jsdom, no browser, no GPU).
 *
 * Mounts the real component tree into a real DOM so that render-time crashes —
 * bad destructuring, missing store fields, undefined node defs, stale prop
 * names — fail here instead of showing up as a white screen. WebGL is absent,
 * so the panels are mounted individually rather than through <App>, which would
 * (correctly) short-circuit to its "GPU initialisation failed" state.
 *
 *   npm run validate:ui
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  pretendToBeVisual: true,
  url: 'http://localhost/',
});
const g = globalThis as any;
g.window = dom.window;
g.document = dom.window.document;
Object.defineProperty(g, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
g.HTMLElement = dom.window.HTMLElement;
g.HTMLCanvasElement = dom.window.HTMLCanvasElement;
g.Element = dom.window.Element;
g.Node = dom.window.Node;
g.SVGElement = dom.window.SVGElement;
g.getComputedStyle = dom.window.getComputedStyle;
g.requestAnimationFrame = (cb: any) => setTimeout(() => cb(Date.now()), 0);
g.cancelAnimationFrame = (id: any) => clearTimeout(id);
g.IS_REACT_ACT_ENVIRONMENT = true;
// jsdom has no layout engine; give elements a plausible box so the editor's
// framing maths has something to work with
dom.window.Element.prototype.getBoundingClientRect = function () {
  return { x: 0, y: 0, top: 0, left: 0, right: 900, bottom: 900, width: 900, height: 900, toJSON() {} } as any;
};

const React = (await import('react')).default;
const { createRoot } = await import('react-dom/client');
const { act } = await import('react');
const { useStore } = await import('../src/state/store');
const { makeDefaultGraph } = await import('../src/state/defaultGraph');
const { allNodeDefs, defaultParams } = await import('../src/core/graph/types');
await import('../src/core/nodes');
const { NodeEditor } = await import('../src/ui/editor/NodeEditor');
const { Inspector } = await import('../src/ui/editor/Inspector');
const { AddPalette } = await import('../src/ui/editor/AddPalette');
const { ViewSettings } = await import('../src/ui/editor/ViewSettings');
const { ViewportPanel } = await import('../src/ui/viewport/ViewportPanel');

let problems = 0;
const bad = (msg: string) => { problems++; process.exitCode = 1; console.error(`✗ ${msg}`); };

const errors: string[] = [];
const origError = console.error;
console.error = (...a: any[]) => {
  const s = a.map(String).join(' ');
  if (/Warning: |not wrapped in act|validateDOMNesting|Each child in a list/.test(s)) errors.push(s.split('\n')[0]);
  else origError(...a);
};

const host = dom.window.document.getElementById('root')!;
const root = createRoot(host);

function mount(label: string, el: any): string {
  try {
    act(() => { root.render(el); });
    const html = host.innerHTML;
    if (!html || html.length < 20) bad(`${label}: rendered almost nothing (${html.length} chars)`);
    return html;
  } catch (e: any) {
    bad(`${label}: threw during render — ${e?.message ?? e}`);
    if (e?.stack) origError(String(e.stack).split('\n').slice(1, 6).join('\n'));
    return '';
  }
}

const st = () => useStore.getState();

// ------------------------------------------------ 1. editor on the real graph
act(() => { st().loadDoc(makeDefaultGraph()); });
{
  const html = mount('NodeEditor (default graph)', <NodeEditor />);
  for (const cls of ['editor-root', 'editor-world', 'wire-layer', 'node-head', 'ed-top', 'build-status']) {
    if (!html.includes(cls)) bad(`NodeEditor output is missing .${cls}`);
  }
  const wires = (html.match(/class="wire"/g) ?? []).length;
  if (wires !== st().doc.edges.length) bad(`NodeEditor drew ${wires} wires for ${st().doc.edges.length} edges`);
}

// ------------------------------------------- 2. every node type renders a card
{
  const defs = allNodeDefs();
  act(() => {
    st().loadDoc({
      nodes: defs.map((d, i) => ({
        id: `n${i}`, type: d.type,
        x: (i % 8) * 280, y: Math.floor(i / 8) * 300,
        params: defaultParams(d.type),
      })),
      edges: [],
      settings: st().doc.settings,
    } as any);
  });
  const html = mount('NodeEditor (every node type)', <NodeEditor />);
  for (const d of defs) {
    const esc = d.title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    if (!html.includes(esc)) bad(`node "${d.type}" (${d.title}) did not render its title`);
  }
  const cards = (html.match(/class="node[ "]/g) ?? []).length;
  if (cards !== defs.length) bad(`expected ${defs.length} node cards, rendered ${cards}`);
}

// ------------------------------------ 3. inspector for every node type + project
{
  for (const n of [...st().doc.nodes]) {
    act(() => { st().select([n.id]); });
    const html = mount(`Inspector[${n.type}]`, <Inspector />);
    if (html && !html.includes('insp-head')) bad(`Inspector[${n.type}] did not render its header`);
  }
  act(() => { st().select([]); });
  const proj = mount('Inspector (project panel)', <Inspector />);
  if (proj && !proj.includes('Project')) bad('Inspector with no selection did not fall back to the project panel');
}

// ------------------------------------------------- 4. palette, view settings
{
  const pal = mount('AddPalette', <AddPalette x={100} y={100} onClose={() => {}} onPick={() => {}} />);
  if (pal && !pal.includes('palette-search')) bad('AddPalette did not render its search box');
  mount('ViewSettings', <ViewSettings onClose={() => {}} />);
}

// --------------------------------------------------------- 5. viewport panel
{
  const ref = { current: dom.window.document.createElement('canvas') as HTMLCanvasElement };
  const html = mount('ViewportPanel', <ViewportPanel canvasRef={ref as any} engine={null} />);
  for (const cls of ['viewport-canvas', 'vp-top', 'vp-rail', 'vp-bottom', 'vp-badge']) {
    if (html && !html.includes(cls)) bad(`ViewportPanel is missing .${cls}`);
  }
}

// ------------------------------------------------- 6. empty / broken graphs
{
  act(() => { st().loadDoc({ nodes: [], edges: [], settings: st().doc.settings } as any); });
  mount('NodeEditor (empty graph)', <NodeEditor />);

  act(() => {
    st().loadDoc({
      nodes: [{ id: 'x', type: 'does-not-exist', x: 40, y: 40, params: {} }],
      edges: [], settings: st().doc.settings,
    } as any);
  });
  const broken = mount('NodeEditor (unknown node type)', <NodeEditor />);
  if (broken && !broken.includes('has-error')) bad('an unknown node type did not render the error card');

  // an edge pointing at a node that no longer exists must not crash the editor
  act(() => {
    st().loadDoc({
      nodes: [{ id: 'a', type: 'perlin', x: 0, y: 0, params: defaultParams('perlin') }],
      edges: [{ id: 'e1', from: 'a', fromPort: 'out', to: 'ghost', toPort: 'height' }],
      settings: st().doc.settings,
    } as any);
  });
  mount('NodeEditor (dangling edge)', <NodeEditor />);
}

act(() => { root.unmount(); });
console.error = origError;

if (errors.length) {
  console.error('\nReact warnings:');
  for (const e of [...new Set(errors)]) console.error(`  ! ${e}`);
  problems += new Set(errors).size;
  process.exitCode = 1;
}

console.log(problems ? `\n${problems} problem${problems === 1 ? '' : 's'}` : '\nevery panel, node card and inspector mounts cleanly ✓');
