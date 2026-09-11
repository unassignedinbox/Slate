import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Volume } from '../js/core/volume.js';
import { ErosionSim } from '../js/core/erosion.js';

const DOM = { x0: -12, y0: 0, z0: -12, sx: 24, sy: 14, sz: 24 };
function slabVolume() {
  const v = new Volume({ nx: 32, ny: 16, nz: 32 }, DOM);
  // tilted slab: surface y = 7 + 0.25x (runoff toward -x), plus flat apron
  v.bake((x, y) => y - (7 + 0.25 * x), null);
  return v;
}
function rainOnly(rate = 400) {
  return {
    rain: [{ id: 'r0', p: { enabled: true, rate, dropSize: 3, brush: 1.1, capacity: 1, erode: 1, deposit: 1, evap: 0.35, center: [0, 10, 0], size: [20, 6, 20] } }],
    river: [], wind: [], thermal: [], rockfall: [],
    lake: [{ id: 'l0', p: { enabled: true, level: 3.5, cx: -9, cz: 0, rx: 6, rz: 12, flow: 0.2, showWater: true } }],
  };
}

describe('erosion sim', () => {
  it('erodes, deposits, and conserves mass', () => {
    const vol = slabVolume();
    const sim = new ErosionSim(vol, { maxAlive: 1500, seed: 7 });
    sim.setEmitters(rainOnly(500));
    for (let i = 0; i < 240; i++) sim.step(1 / 30); // 8 sim-seconds
    const L = sim.ledger;
    assert.ok(L.eroded > 0.01, `something eroded (got ${L.eroded})`);
    assert.ok(L.deposited > 0, 'something deposited');
    const bal = sim.balance();
    assert.ok(Math.abs(bal - 1) < 0.10, `mass balance ≈1 (got ${bal})`);
  });

  it('settle guarantee: every particle terminates and retires its load', () => {
    const vol = slabVolume();
    const sim = new ErosionSim(vol, { maxAlive: 1500, seed: 11 });
    sim.setEmitters(rainOnly(600));
    for (let i = 0; i < 120; i++) sim.step(1 / 30);
    assert.ok(sim.n > 0, 'particles alive mid-storm');
    sim.setEmitters(rainOnly(0)); // rain stops
    let i = 0;
    for (; i < 4000 && sim.n > 0; i++) sim.step(1 / 30);
    assert.equal(sim.n, 0, `all particles settled (ran ${i} steps)`);
    assert.ok(sim.ledger.suspended < 1e-6, 'no suspended residue');
    const bal = sim.balance();
    assert.ok(Math.abs(bal - 1) < 0.10, `ledger balances after full settle (got ${bal})`);
  });

  it('cannot drill an unbounded hole: depth stays bounded', () => {
    const vol = slabVolume();
    const sim = new ErosionSim(vol, { maxAlive: 800, seed: 3 });
    // abusive emitter: huge drops, tiny area, no evaporation
    sim.setEmitters({
      rain: [{ id: 'r0', p: { enabled: true, rate: 300, dropSize: 20, brush: 0.8, capacity: 4, erode: 4, deposit: 0.2, evap: 0, center: [0, 10, 0], size: [4, 6, 4] } }],
      river: [], wind: [], thermal: [], rockfall: [], lake: [],
    });
    for (let i = 0; i < 600; i++) sim.step(1 / 30); // 20 sim-seconds of abuse
    // deepest cut vs base checkpoint
    let maxCut = 0;
    for (let i = 0; i < vol.dist.length; i++) {
      const cut = vol.dist[i] - vol.baseDist[i];
      if (cut > maxCut) maxCut = cut;
    }
    const vox = (vol.vx + vol.vy + vol.vz) / 3;
    assert.ok(maxCut < vox * 14, `cut ${maxCut.toFixed(2)}m < 14 voxels (${(vox * 14).toFixed(2)}m)`);
  });

  it('thermal pass moves super-talus material downhill, balanced', () => {
    const vol = slabVolume();
    const sim = new ErosionSim(vol, { maxAlive: 100, seed: 5 });
    // steep cone to guarantee super-talus slopes
    vol.bake((x, y, z) => Math.hypot(x, y - 4, z) - 5, null);
    const before = sim.ledger.eroded;
    sim.setEmitters({ rain: [], river: [], wind: [], rockfall: [], lake: [], thermal: [{ id: 't', p: { enabled: true, talus: 30, rate: 2, every: 1, samples: 2000 } }] });
    for (let i = 0; i < 10; i++) sim.step(1 / 30);
    assert.ok(sim.ledger.eroded > before, 'thermal moved material');
    const bal = sim.balance();
    assert.ok(Math.abs(bal - 1) < 0.12, `thermal balanced (got ${bal})`);
  });

  it('wind grains transport and settle without wetting', () => {
    const vol = slabVolume();
    const sim = new ErosionSim(vol, { maxAlive: 800, seed: 9 });
    sim.setEmitters({
      rain: [], river: [], thermal: [], rockfall: [], lake: [],
      wind: [{ id: 'w', p: { enabled: true, rate: 400, dir: 0, speed: 10, height: 9, band: 4, gust: 0.3, brush: 1, abrade: 1, capacity: 1 } }],
    });
    for (let i = 0; i < 200; i++) sim.step(1 / 30);
    let wet = 0;
    for (let i = 0; i < vol.wet.length; i++) wet += vol.wet[i];
    assert.equal(wet, 0, 'dry wind leaves no wetness');
    assert.ok(sim.ledger.born > 100, 'grains were emitted');
  });
});
