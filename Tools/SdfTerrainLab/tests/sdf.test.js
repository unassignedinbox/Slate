import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Prim, Op, compileField } from '../js/core/sdf.js';
import { Graph, makeNode } from '../js/core/graph.js';
import { makeNoise } from '../js/core/noise.js';

describe('SDF primitives', () => {
  it('sphere: inside<0, surface≈0, outside>0', () => {
    const p = { center: [0, 10, 0], radius: 5 };
    assert.ok(Prim.sphere(0, 10, 0, p) < 0);
    assert.ok(Math.abs(Prim.sphere(5, 10, 0, p)) < 1e-9);
    assert.ok(Prim.sphere(9, 10, 0, p) > 0);
  });
  it('box: rounded box contains center', () => {
    const p = { center: [0, 0, 0], size: [4, 4, 4], round: 0 };
    assert.ok(Prim.box(0, 0, 0, p) < 0);
    assert.ok(Prim.box(3, 0, 0, p) > 0);
  });
  it('ground slab', () => {
    const p = { level: 8, bottom: -6 };
    assert.ok(Prim.ground(0, 0, 0, p) < 0);
    assert.ok(Prim.ground(0, 20, 0, p) > 0);
    assert.ok(Prim.ground(0, -20, 0, p) > 0);
  });
  it('mesa/capsule/torus/cylinder/ellipsoid finite everywhere', () => {
    const ms = { center: [0, 10, 0], radiusTop: 5, radiusBottom: 10, halfHeight: 8 };
    const cs = { center: [0, 10, 0], radius: 3, halfLen: 6 };
    const ts = { center: [0, 10, 0], major: 8, minor: 2 };
    const ys = { center: [0, 10, 0], radius: 4, halfHeight: 6, round: 1 };
    const es = { center: [0, 10, 0], radii: [6, 3, 4] };
    for (const [x, y, z] of [[0, 10, 0], [50, 50, 50], [0, 0, 0], [-30, 5, 12]]) {
      for (const f of [Prim.mesa(x, y, z, ms), Prim.capsule(x, y, z, cs), Prim.torus(x, y, z, ts), Prim.cylinder(x, y, z, ys), Prim.ellipsoid(x, y, z, es)]) {
        assert.ok(Number.isFinite(f), `non-finite at ${x},${y},${z}`);
      }
    }
  });
  it('smooth union ≤ hard min, equals min far apart', () => {
    assert.ok(Op.su(2, 5, 1) <= 2 + 1e-9);
    assert.ok(Math.abs(Op.su(2, 50, 1) - 2) < 1e-6);
  });
});

describe('field compiler', () => {
  it('compiles ground→output, assigns soil inside', () => {
    const g = new Graph();
    const out = makeNode('output', 0, 0), gr = makeNode('ground', 0, 0);
    gr.params.level = 8;
    g.addNode(out); g.addNode(gr);
    assert.ok(g.connect(gr.id, 'f', out.id, 'field').ok);
    const f = compileField(g, makeNoise(1));
    const o = { mat: -1 };
    assert.ok(f.eval(0, 0, 0, o) < 0);
    assert.equal(o.mat, 2); // soil
    assert.ok(f.eval(0, 50, 0, o) > 0);
  });
  it('subtract carves (canyon pattern)', () => {
    const g = new Graph();
    const out = makeNode('output', 0, 0), gr = makeNode('ground', 0, 0);
    const sub = makeNode('subtract', 0, 0), cut = makeNode('box', 0, 0);
    cut.params.center = [0, 4, 0]; cut.params.size = [6, 20, 200]; cut.params.round = 0;
    g.addNode(out); g.addNode(gr); g.addNode(sub); g.addNode(cut);
    g.connect(gr.id, 'f', sub.id, 'a'); g.connect(cut.id, 'f', sub.id, 'b');
    g.connect(sub.id, 'f', out.id, 'field');
    const f = compileField(g, makeNoise(1));
    const o = { mat: 0 };
    assert.ok(f.eval(0, 4, 0, o) > 0, 'channel is air');
    assert.ok(f.eval(20, 4, 0, o) < 0, 'banks stay solid');
  });
});
