/**
 * Graph + registry sanity test (no GPU required).
 *
 *   - every registered node declares well-formed ports and params
 *   - defaultParams() covers every declared param
 *   - the starting graph references only real nodes/ports, is type-correct,
 *     and is acyclic
 *   - the store's connect() enforces types, rejects cycles, and undo/redo round-trips
 *
 *   npm run validate:graph
 */
import { allNodeDefs, getNodeDef, defaultParams, PORT_COLORS, type PortType } from '../src/core/graph/types';
import '../src/core/nodes';
import { makeDefaultGraph } from '../src/state/defaultGraph';

let problems = 0;
const bad = (msg: string) => { problems++; process.exitCode = 1; console.error(`✗ ${msg}`); };

// ------------------------------------------------------------ 1. registry
const defs = allNodeDefs();
const seenTypes = new Set<string>();
for (const d of defs) {
  if (seenTypes.has(d.type)) bad(`duplicate node type "${d.type}"`);
  seenTypes.add(d.type);
  if (!d.title) bad(`${d.type}: missing title`);
  if (!d.category) bad(`${d.type}: missing category`);

  for (const group of [d.inputs, d.outputs]) {
    const ids = new Set<string>();
    for (const p of group) {
      if (ids.has(p.id)) bad(`${d.type}: duplicate port id "${p.id}"`);
      ids.add(p.id);
      if (!PORT_COLORS[p.type as PortType]) bad(`${d.type}.${p.id}: unknown port type "${p.type}"`);
    }
  }
  if (d.type !== 'output' && d.outputs.length === 0) bad(`${d.type}: no outputs`);

  const params = defaultParams(d.type);
  const pids = new Set<string>();
  for (const p of d.params) {
    if (pids.has(p.id)) bad(`${d.type}: duplicate param id "${p.id}"`);
    pids.add(p.id);
    if (!(p.id in params)) bad(`${d.type}.${p.id}: no default`);
    if (p.kind === 'enum') {
      if (!p.options?.length) bad(`${d.type}.${p.id}: enum with no options`);
      else if (!p.options.some((o) => o.value === p.default)) {
        bad(`${d.type}.${p.id}: default "${p.default}" is not one of its options`);
      }
    }
    if (p.kind === 'float' || p.kind === 'int') {
      if (p.min === undefined || p.max === undefined) bad(`${d.type}.${p.id}: numeric param without min/max`);
      else if (p.min >= p.max) bad(`${d.type}.${p.id}: min >= max`);
      else if (typeof p.default === 'number' && (p.default < p.min || p.default > p.max)) {
        bad(`${d.type}.${p.id}: default ${p.default} outside [${p.min}, ${p.max}]`);
      }
    }
  }
}

// ---------------------------------------------------- 2. the starting graph
const doc = makeDefaultGraph();
const byId = new Map(doc.nodes.map((n) => [n.id, n]));
if (byId.size !== doc.nodes.length) bad('default graph has duplicate node ids');
if (!doc.nodes.some((n) => n.type === 'output')) bad('default graph has no output node');

for (const n of doc.nodes) {
  const def = getNodeDef(n.type);
  if (!def) { bad(`default graph uses unregistered node type "${n.type}"`); continue; }
  for (const p of def.params) {
    if (!(p.id in n.params)) bad(`default graph node ${n.id} (${n.type}) is missing param "${p.id}"`);
  }
}

const seenInput = new Set<string>();
for (const e of doc.edges) {
  const from = byId.get(e.from);
  const to = byId.get(e.to);
  if (!from) { bad(`edge ${e.id}: unknown source node ${e.from}`); continue; }
  if (!to) { bad(`edge ${e.id}: unknown target node ${e.to}`); continue; }
  const fd = getNodeDef(from.type);
  const td = getNodeDef(to.type);
  const op = fd?.outputs.find((p) => p.id === e.fromPort);
  const ip = td?.inputs.find((p) => p.id === e.toPort);
  if (!op) { bad(`edge ${e.id}: ${from.type} has no output "${e.fromPort}"`); continue; }
  if (!ip) { bad(`edge ${e.id}: ${to.type} has no input "${e.toPort}"`); continue; }
  if (op.type !== ip.type) {
    bad(`edge ${e.id}: type mismatch ${from.type}.${e.fromPort} (${op.type}) -> ${to.type}.${e.toPort} (${ip.type})`);
  }
  const key = `${e.to}:${e.toPort}`;
  if (seenInput.has(key)) bad(`input ${to.type}.${e.toPort} has more than one incoming edge`);
  seenInput.add(key);
}

// required inputs must be fed
for (const n of doc.nodes) {
  const def = getNodeDef(n.type);
  if (!def) continue;
  for (const p of def.inputs) {
    if (p.optional) continue;
    if (!seenInput.has(`${n.id}:${p.id}`)) bad(`default graph: ${n.type}.${p.id} is required but unconnected`);
  }
}

// acyclic?
{
  const adj = new Map<string, string[]>();
  for (const e of doc.edges) adj.set(e.from, [...(adj.get(e.from) ?? []), e.to]);
  const state = new Map<string, number>();
  const visit = (id: string): boolean => {
    const st = state.get(id) ?? 0;
    if (st === 1) return false;
    if (st === 2) return true;
    state.set(id, 1);
    for (const nx of adj.get(id) ?? []) if (!visit(nx)) return false;
    state.set(id, 2);
    return true;
  };
  for (const n of doc.nodes) if (!visit(n.id)) { bad('default graph contains a cycle'); break; }
}

// ------------------------------------------------------------- 3. the store
const { useStore } = await import('../src/state/store');
const s = () => useStore.getState();

s().loadDoc(makeDefaultGraph());
const nodeCount = s().doc.nodes.length;

// a type-mismatched connection must be refused
{
  const satmap = s().doc.nodes.find((n) => n.type === 'satmap');
  const hydro = s().doc.nodes.find((n) => n.type === 'hydraulic');
  if (satmap && hydro) {
    const before = s().doc.edges.length;
    s().connect(satmap.id, 'out', hydro.id, 'height'); // color -> field
    if (s().doc.edges.length !== before) bad('store.connect accepted a color -> field edge');
  }
}

// a cycle must be refused
{
  const terrace = s().doc.nodes.find((n) => n.type === 'terrace');
  const mountain = s().doc.nodes.find((n) => n.type === 'mountain');
  if (terrace && mountain) {
    const before = s().doc.edges.length;
    s().connect(terrace.id, 'out', mountain.id, 'warp');
    if (s().doc.edges.length !== before) bad('store.connect accepted an edge that closes a cycle');
  }
}

// add / remove / undo round-trip
{
  const before = s().doc.nodes.length;
  s().addNode('perlin', 10, 10);
  if (s().doc.nodes.length !== before + 1) bad('addNode did not add a node');
  s().undo();
  if (s().doc.nodes.length !== before) bad(`undo did not restore node count (${s().doc.nodes.length} vs ${before})`);
  s().redo();
  if (s().doc.nodes.length !== before + 1) bad('redo did not re-add the node');
  s().undo();
}

// serialize -> loadDoc round-trip
{
  const json = s().serialize();
  const parsed = JSON.parse(json);
  s().loadDoc({ nodes: parsed.nodes, edges: parsed.edges, settings: parsed.settings });
  if (s().doc.nodes.length !== nodeCount) bad('serialize/loadDoc round-trip lost nodes');
}

console.log(`\nregistry: ${defs.length} node types`);
console.log(`default graph: ${doc.nodes.length} nodes, ${doc.edges.length} edges`);
console.log(problems ? `\n${problems} problem${problems === 1 ? '' : 's'}` : 'graph, registry and store all consistent ✓');
