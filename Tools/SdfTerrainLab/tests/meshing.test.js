import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Volume } from '../js/core/volume.js';
import { surfaceNets } from '../js/core/meshing.js';

describe('surface nets mesher', () => {
  it('meshes a sphere: closed-ish, outward normals, finite', () => {
    const vol = new Volume({ nx: 40, ny: 24, nz: 40 }, { x0: -20, y0: 0, z0: -20, sx: 40, sy: 24, sz: 40 });
    vol.bake((x, y, z) => Math.hypot(x, y - 12, z) - 8, null);
    const m = surfaceNets(vol, { mode: 'full' });
    const nv = m.positions.length / 3;
    assert.ok(nv > 300, `enough verts (got ${nv})`);
    assert.equal(m.indices.length % 3, 0);
    for (let i = 0; i < m.positions.length; i++) assert.ok(Number.isFinite(m.positions[i]));
    // normals agree with SDF gradient (outward)
    const g = [0, 0, 0];
    let agree = 0, checked = 0;
    for (let v = 0; v < nv; v += 7) {
      vol.gradient(m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2], g);
      const d = g[0] * m.normals[v * 3] + g[1] * m.normals[v * 3 + 1] + g[2] * m.normals[v * 3 + 2];
      if (d > 0.5) agree++;
      checked++;
    }
    assert.ok(agree / checked > 0.9, `normals outward (${agree}/${checked})`);
    assert.ok(m.colors && m.colors.length === m.positions.length, 'colors baked');
  });
  it('empty volume → empty mesh (no crash)', () => {
    const vol = new Volume({ nx: 16, ny: 8, nz: 16 });
    vol.bake(() => 5, null);
    const m = surfaceNets(vol, {});
    assert.equal(m.positions.length, 0);
    assert.equal(m.indices.length, 0);
  });
});
