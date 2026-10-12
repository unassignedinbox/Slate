import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateCity, DEFAULT_CITY } from '../src/core/city';
import { parseNetwork, makeRoad, PRESETS, laneBands, roadWidth } from '../src/core/model';
import { buildNetwork } from '../src/render/network-mesh';
import { V } from '../src/core/geometry';

test('preset widths are sane', () => {
  for (const [k, p] of Object.entries(PRESETS)) {
    const w = roadWidth({ lanes: p.lanes });
    if (p.category === 'road' || p.category === 'path') assert.ok(w > 2 && w < 60, `${k} width ${w}`);
  }
  const bands = laneBands(PRESETS.avenue.lanes);
  assert.ok(Math.abs(bands[0].a + roadWidth({ lanes: PRESETS.avenue.lanes }) / 2) < 1e-9);
});

test('simple road builds triangles and the mesh has no NaN', () => {
  const net = { format: 'slate-roads' as const, version: 1 as const, roads: [makeRoad('arterial', [V(0, 0, 0), V(0, 0, 200)])], props: [] };
  const m = buildNetwork(net);
  assert.ok(m.stats.triangles > 0);
  for (const b of m.builder.buckets.values()) {
    assert.ok(b.pos.every(Number.isFinite));
    assert.ok(b.nrm.every(Number.isFinite));
    assert.ok(b.idx.every((i) => i < b.pos.length / 3));
  }
});

test('generated city builds, has every feature, and is free of NaN', () => {
  const net = generateCity(DEFAULT_CITY);
  const kinds = new Set(net.roads.map((r) => r.preset));
  for (const k of ['avenue', 'arterial', 'local', 'highway', 'rail', 'subway', 'footpath']) assert.ok(kinds.has(k), `missing ${k}`);
  assert.ok(net.props.some((p) => p.kind === 'bollard'));
  assert.ok(net.props.some((p) => p.kind === 'speedbump'));
  assert.ok(net.props.some((p) => p.kind === 'busstop'));
  const t0 = Date.now();
  const m = buildNetwork(net);
  const ms = Date.now() - t0;
  console.log(`city: ${net.roads.length} roads, ${net.props.length} props, ${m.stats.triangles} tris, ${m.crossings.length} rail crossings, ${m.junctions.length} junction ends, built in ${ms} ms`);
  assert.ok(m.crossings.length > 0, 'expected auto rail crossings');
  assert.ok(m.junctions.length > 0, 'expected junctions');
  for (const b of m.builder.buckets.values()) {
    assert.ok(b.pos.every(Number.isFinite), 'pos finite');
    assert.ok(b.nrm.every(Number.isFinite), 'nrm finite');
  }
});

test('parseNetwork round-trips and rejects garbage', () => {
  const net = generateCity({ ...DEFAULT_CITY, blocks: 4 });
  const back = parseNetwork(JSON.parse(JSON.stringify(net)));
  assert.equal(back.roads.length, net.roads.length);
  assert.equal(back.props.length, net.props.length);
  assert.throws(() => parseNetwork({ hello: 1 }));
  assert.throws(() => parseNetwork({ format: 'slate-roads', roads: [{ id: 'x', points: [V(0, 0, 0)], lanes: [] }], props: [] }));
});
