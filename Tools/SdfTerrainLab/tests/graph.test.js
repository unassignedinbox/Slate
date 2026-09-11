import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { Graph, makeNode, NODE_TYPES, collectSim } from '../js/core/graph.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const load = name => Graph.fromJSON(JSON.parse(readFileSync(join(root, 'presets', name), 'utf8')));

describe('graph model', () => {
  it('rejects cycles', () => {
    const g = new Graph();
    const a = makeNode('fbmDisplace', 0, 0), b = makeNode('fbmDisplace', 0, 0);
    g.addNode(a); g.addNode(b);
    assert.ok(g.connect(a.id, 'f', b.id, 'in').ok);
    const r = g.connect(b.id, 'f', a.id, 'in');
    assert.equal(r.ok, false);
    assert.match(r.error, /cycle/);
  });
  it('rejects type mismatch (sim → field)', () => {
    const g = new Graph();
    const rain = makeNode('rain', 0, 0), out = makeNode('output', 0, 0);
    g.addNode(rain); g.addNode(out);
    assert.equal(g.connect(rain.id, 's', out.id, 'field').ok, false);
  });
  it('round-trips JSON', () => {
    const g = load('canyon.json');
    const g2 = Graph.fromJSON(g.toJSON());
    assert.equal(g2.nodes.length, g.nodes.length);
    assert.equal(g2.links.length, g.links.length);
    assert.ok(g2.outputNode());
  });
  it('all presets load with a field feeding output', () => {
    for (const p of ['canyon.json', 'coast.json', 'dunes.json', 'empty.json']) {
      const g = load(p);
      assert.ok(g.outputNode(), p);
      assert.ok(g.fieldOrder().length >= 1, p + ' has field chain');
      assert.equal(g.hasCycle(), false);
    }
  });
  it('collectSim finds emitters; disabled nodes excluded', () => {
    const g = load('canyon.json');
    const sim = collectSim(g);
    assert.ok(sim.rain.length === 1 && sim.river.length === 1 && sim.lake.length === 1 && sim.thermal.length === 1);
    assert.ok(sim.river[0].p.points.length >= 2, 'river has a path');
    g.nodes.find(n => n.type === 'rain').disabled = true;
    assert.equal(collectSim(g).rain.length, 0);
  });
  it('every registered type builds default params', () => {
    for (const t of Object.keys(NODE_TYPES)) {
      const n = makeNode(t, 0, 0);
      assert.ok(n.params, t);
    }
  });
});
