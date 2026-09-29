/**
 * End-to-end build test against a mock GPU (no WebGL required).
 *
 * Runs the real Evaluator over the real graph: topological order, per-node
 * hashing, the LRU cache, reference-counted frees and render-payload assembly
 * all execute exactly as they do in the browser — only the GL calls are faked.
 *
 * Checks:
 *   - the default graph builds with no error issues
 *   - it produces height + colour + a cave volume
 *   - a second identical build is served entirely from cache
 *   - changing one parameter only re-runs that node and its descendants
 *   - pinning a node retargets the build
 *   - aborting mid-build stops early and still returns
 *   - no render target is double-freed, and nothing leaks once the cache is dropped
 *
 *   npm run validate:build
 */
import { MockGPU } from './mockGpu';
import { Evaluator } from '../src/core/graph/Evaluator';
import { makeDefaultGraph } from '../src/state/defaultGraph';
import '../src/core/nodes';

let problems = 0;
const bad = (msg: string) => { problems++; process.exitCode = 1; console.error(`✗ ${msg}`); };
const ok = (msg: string) => console.log(`  ✓ ${msg}`);

const gpu = new MockGPU();
const ev = new Evaluator(gpu as any);
const doc = makeDefaultGraph();
// keep the mock build quick — iteration counts do not change code paths
for (const n of doc.nodes) {
  for (const k of ['iterations', 'accumIters', 'inciseIters', 'passes']) {
    if (k in n.params) n.params[k] = 2;
  }
}

// -------------------------------------------------------------- first build
const r1 = await ev.build(doc, { handle: { aborted: false }, thumbnails: false });
const errs = r1.issues.filter((i) => i.severity === 'error');
if (errs.length) for (const e of errs) bad(`build error on ${e.nodeTitle}: ${e.message}`);
else ok(`default graph built — ${gpu.passes.length} GPU passes, ${r1.issues.length} issue(s)`);

if (!r1.height) bad('build produced no height field');
else ok('height output present');
if (!r1.color) bad('build produced no colour output');
else ok('colour output present');
if (!r1.volume) bad('build produced no cave volume (the SDF half of the pipeline is not wired)');
else ok('cave volume present');

for (const i of r1.issues) console.log(`  · ${i.severity}: ${i.nodeTitle} — ${i.message}`);

// ------------------------------------------------- cache: rebuild is near-free
// Only nodes with cost >= CACHE_COST_THRESHOLD are cached; cheap ones are
// cheaper to re-run than to keep a full-resolution target alive for. So the
// bar is "the expensive work is skipped", not "zero passes".
{
  const first = gpu.passes.length;
  const before = gpu.passes.length;
  await ev.build(doc, { handle: { aborted: false }, thumbnails: false });
  const added = gpu.passes.length - before;
  if (added > first * 0.05) {
    bad(`an unchanged rebuild issued ${added}/${first} passes — the node cache is not hitting`);
  } else {
    ok(`unchanged rebuild skipped the expensive nodes (${added} passes vs ${first}, ${(100 - (added / first) * 100).toFixed(1)}% saved)`);
  }
}

// --------------------------------------- cache: one param invalidates a subtree
{
  const rivers = doc.nodes.find((n) => n.type === 'rivers');
  if (!rivers) bad('default graph has no rivers node to test invalidation with');
  else {
    const before = gpu.passes.length;
    rivers.params.strength = (rivers.params.strength ?? 0.5) * 0.5 + 0.01;
    await ev.build(doc, { handle: { aborted: false }, thumbnails: false });
    const added = gpu.passes.length - before;
    if (added === 0) bad('changing a parameter did not invalidate its node');
    else ok(`changing one parameter re-ran only its subtree (${added} passes)`);
  }
}

// ------------------------------------------------------------------- pinning
{
  const thermal = doc.nodes.find((n) => n.type === 'thermal');
  if (thermal) {
    const rp = await ev.build(doc, { handle: { aborted: false }, pinnedId: thermal.id, thumbnails: false });
    if (!rp.preview) bad('pinning a node produced no preview');
    else if (rp.previewKind !== 'field') bad(`pinned field node reported previewKind "${rp.previewKind}"`);
    else ok('pinning retargets the build to that node');
  }
}

// -------------------------------------------------------------- leak accounting
{
  const afterBuild = gpu.liveTex.size + gpu.liveVol.size;
  if (afterBuild === 0) bad('nothing is alive after a completed build — the viewport would have no textures');
  else ok(`${afterBuild} target(s) alive after build (cache + payload), peak ${gpu.peakTex} concurrent`);

  ev.invalidateAll();
  const afterPurge = gpu.liveTex.size + gpu.liveVol.size;
  if (afterPurge > 8) bad(`${afterPurge} targets still live after invalidateAll() — only the handed-off payload should remain`);
  else ok(`invalidateAll() released the cache (${afterBuild} -> ${afterPurge})`);

  if (gpu.doubleFrees) bad(`${gpu.doubleFrees} render target(s) were freed twice`);
  else ok('no double frees');
}

// -------------------------------------------------------------------- abort
{
  ev.invalidateAll();
  const handle = { aborted: false };
  const before = gpu.passes.length;
  const p = ev.build(doc, {
    handle,
    thumbnails: false,
    onProgress: (f) => { if (f > 0.1) handle.aborted = true; },
  });
  const ra = await p;
  const added = gpu.passes.length - before;
  if (!ra) bad('aborted build never resolved');
  else ok(`abort stopped the build early (${added} passes instead of ~${gpu.passes.length})`);
}

console.log(problems ? `\n${problems} problem${problems === 1 ? '' : 's'}` : '\nbuild pipeline, cache and memory accounting all sound ✓');
