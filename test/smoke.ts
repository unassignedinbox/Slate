/* Headless sanity harness for the fracture solvers. */
import { boxConvex, blobConvex, massProperties } from '../src/geom/convex';
import { MATERIALS, rayleighSpeed, terminalSpeed, criticalFlaw } from '../src/sim/materials';
import { fractureSolid } from '../src/frac/solid';
import { CrackNetwork } from '../src/frac/crack2d';
import { RegionExtractor } from '../src/frac/regions';
import { rng, v3, norm } from '../src/core/math';

function hr(s: string) { console.log('\n=== ' + s + ' ' + '='.repeat(Math.max(0, 60 - s.length))); }

hr('material constants');
for (const m of Object.values(MATERIALS)) {
  console.log(
    m.label.padEnd(30),
    'cR=' + rayleighSpeed(m).toFixed(0).padStart(5),
    'vTerm=' + terminalSpeed(m).toFixed(0).padStart(5),
    'aC=' + (criticalFlaw(m) * 1e6).toFixed(1).padStart(7) + 'um',
  );
}

hr('solid fracture');
for (const id of ['granite', 'spruce', 'abs-plastic', 'concrete'] as const) {
  const mat = MATERIALS[id];
  const body = id === 'granite' ? blobConvex(0.52, rng(11), 0.35)
    : id === 'spruce' ? boxConvex(1.25, 0.11, 0.11) : boxConvex(0.42, 0.34, 0.34);
  const v0 = massProperties(body).volume;
  for (const E of [120, 1500, 12000]) {
    const t0 = Date.now();
    const frags = fractureSolid(body, mat, {
      point: v3(0, 0.1, 0.3), dir: norm(v3(0, -0.2, -1)), energy: E,
      impulse: Math.sqrt(2 * E * 0.6) * 1.6, radius: 0.02,
    }, { maxFragments: mat.ductility > 0.6 ? 26 : 150, seed: 7 });
    let vol = 0, maxv = 0, minv = Infinity;
    for (const f of frags) { vol += f.volume; maxv = Math.max(maxv, f.volume); minv = Math.min(minv, f.volume); }
    console.log(
      `${id.padEnd(12)} E=${String(E).padStart(4)}J  frags=${String(frags.length).padStart(4)}`,
      ` volErr=${(((vol - v0) / v0) * 100).toFixed(2)}%`,
      ` size ratio max/min=${(maxv / Math.max(minv, 1e-12)).toFixed(0).padStart(7)}`,
      ` ${Date.now() - t0}ms`,
    );
  }
}

hr('crack network (2D)');
for (const id of ['annealed-glass', 'tempered-glass', 'acrylic'] as const) {
  const mat = MATERIALS[id];
  for (const E of [10, 60, 300]) {
    const net = new CrackNetwork({ width: 1.7, height: 1.15, thickness: 0.006, material: mat, res: 380, seed: 42 });
    const n = net.impact({ x: 0.1, y: 0.05, energy: E, radius: 0.01, penetration: 0.3 });
    const t0 = Date.now();
    let steps = 0;
    const dt = (net.h / 1900) * 0.8;
    while (!net.done && steps < 200000) { net.step(dt); steps++; }
    const s = net.stats();
    const th = Date.now();
    const ex = new RegionExtractor(net);
    const fr = ex.harvest(false, 3);
    const fr2 = ex.harvest(true, 3);
    const harvestMs = Date.now() - th;
    let area = 0;
    for (const f of [...fr, ...fr2]) area += f.area;
    console.log(
      `${id.padEnd(16)} E=${String(E).padStart(3)}J seeds=${String(n).padStart(4)}`,
      ` paths=${String(s.paths).padStart(5)} len=${s.length.toFixed(2).padStart(7)}m`,
      ` Esurf=${s.surfaceEnergy.toFixed(1).padStart(6)}J`,
      ` free=${String(fr.length).padStart(4)} +border=${String(fr2.length).padStart(4)}`,
      ` areaCov=${((area / (1.7 * 1.15)) * 100).toFixed(0)}%`,
      ` skip=${ex.skipped}`,
      ` ${steps} steps ${Date.now() - t0}ms (harvest ${harvestMs}ms)`,
    );
  }
}

hr('done');
