import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NODES, NODE_LIST, defaultParams } from '../src/engine/registry.js';
import { newState } from '../src/engine/stack.js';
import { makeLayer, newProject, starterProject } from '../src/engine/project.js';
import { evaluate } from '../src/engine/stack.js';
import { deriveFor } from '../src/engine/masks.js';

const N = 64;

test('registry covers Gaea node ids 1-240 exactly once plus extra fill 241', () => {
  for (let i = 1; i <= 240; i++) assert.ok(NODES[i], `missing node ${i}`);
  assert.equal(NODE_LIST.length, 241);
});

test('every node runs on a 64x64 state and returns finite values', () => {
  for (const node of NODE_LIST) {
    const st = newState(N);
    // seed some terrain so erosion/water/mask nodes have something to act on
    for (let i = 0; i < st.h.length; i++) st.h[i] = 0.3 + 0.3 * Math.sin(i * 0.013) * Math.cos((i / N) * 0.07);
    st.version = 1;
    const p = defaultParams(node);
    if (p.iterations) p.iterations = Math.min(p.iterations, 2000);
    let out;
    try {
      out = node.run(p, st, st.h, deriveFor(st));
    } catch (e) {
      throw new Error(`node ${node.id} ${node.name} threw: ${e.message}`);
    }
    const arrs = [];
    if (out instanceof Float32Array) arrs.push(out);
    else if (out && out.h) arrs.push(out.h);
    else if (out && out.rgb) arrs.push(out.rgb);
    else if (out && out.data) arrs.push(out.data);
    for (const a of arrs) for (const v of a) assert.ok(Number.isFinite(v) || Number.isNaN(v) && node.mode === 'mod' && node.id >= 85 && node.id <= 94, `node ${node.id} ${node.name} produced ${v}`);
  }
});

test('stack evaluation is deterministic for the same project', () => {
  const p = starterProject(N);
  const a = evaluate(p), b = evaluate(p);
  assert.deepEqual(Array.from(a.h.slice(0, 200)), Array.from(b.h.slice(0, 200)));
});

test('river node carves channels: carved cells are lower than uncarved', () => {
  const base = newProject(N);
  base.layers = [makeLayer(2, { params: { ...defaultParams(NODES[2]), scale: 3, seed: 2 } })];
  const before = evaluate(base).h;
  const withRiver = { ...base, layers: [...base.layers, makeLayer(87, { params: { ...defaultParams(NODES[87]), depth: 0.1, threshold: 0.02 } })] };
  const st = evaluate(withRiver);
  let lower = 0, higher = 0;
  for (let i = 0; i < before.length; i++) { if (st.h[i] < before[i] - 1e-6) lower++; else if (st.h[i] > before[i] + 1e-6) higher++; }
  assert.ok(lower > 20, `expected carved cells, got ${lower}`);
  assert.equal(higher, 0, 'river must never raise terrain');
  assert.ok(st.water && st.water.some((v) => !Number.isNaN(v)), 'river must record water surface');
});

test('water surfaces never sit below the bed', () => {
  const p = starterProject(N);
  const st = evaluate(p);
  if (st.water) for (let i = 0; i < st.h.length; i++) if (!Number.isNaN(st.water[i])) assert.ok(st.water[i] >= st.h[i] - 1e-5);
});

test('blend modes: Multiply and Add behave as documented', async () => {
  const { BLEND } = await import('../src/engine/ops.js');
  assert.equal(BLEND[131](0.5, 0.5), 0.25);
  assert.equal(BLEND[129](0.2, 0.3), 0.5);
  assert.equal(BLEND[134](0.2, 0.9), 0.2);
  assert.equal(Object.keys(BLEND).length, 24);
});

test('mask layer feeds the next layer and mask type 178 uses painted data', () => {
  const p = newProject(N);
  p.layers = [makeLayer(1, { params: { value: 0 } }), makeLayer(154, {}), makeLayer(2, { opacity: 1, mask: { type: 178, params: {}, invert: false, contrast: 1, feather: 0, painted: { N, data: new Float32Array(N * N).fill(0) } } })];
  const st = evaluate(p);
  assert.ok(st.h.every((v) => v === 0), 'fully-masked-out layer must not change height');
});

test('io: RAW16 round-trips and PNG16 has a valid signature', async () => {
  const { encodeRaw16, decodeRaw16, encodePNG } = await import('../src/engine/io.js');
  const h = new Float32Array(16 * 16).map((_, i) => i / 255);
  const back = decodeRaw16(encodeRaw16(h).buffer);
  assert.equal(back.N, 16);
  for (let i = 0; i < h.length; i++) assert.ok(Math.abs(back.data[i] - h[i]) < 1 / 65535 + 1e-6);
  const png = await encodePNG(16, 16, 1, 16, h);
  assert.deepEqual(Array.from(png.slice(1, 4)), [80, 78, 71]);
});

test('io: stored-deflate fallback produces a PNG that node can inflate', async () => {
  const zlib = await import('node:zlib');
  const { zlibStored } = await import('../src/engine/io.js');
  const data = new Uint8Array(70000).map((_, i) => (i * 31) & 255);
  const back = zlib.inflateSync(Buffer.from(zlibStored(data)));
  assert.equal(back.length, data.length);
  assert.ok(Buffer.from(back).equals(Buffer.from(data)));
});
