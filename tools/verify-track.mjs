// Headless geometry check for the spine. Run: node tools/verify-track.mjs
import { Track } from '../src/track.js';

const t = new Track().build({ meshes: false });
const d = t.deck;
let minY = Infinity, maxY = -Infinity, minHW = Infinity, maxHW = 0;
let maxTilt = 0, maxKink = 0;
for (let i = 0; i < d.n; i++) {
  minY = Math.min(minY, d.y[i]); maxY = Math.max(maxY, d.y[i]);
  minHW = Math.min(minHW, d.hw[i]); maxHW = Math.max(maxHW, d.hw[i]);
  maxTilt = Math.max(maxTilt, Math.abs(d.tilt[i]));
  const a = d.th[(i - 1 + d.n) % d.n], b = d.th[(i + 1) % d.n];
  let dth = b - a; if (dth > Math.PI) dth -= 2 * Math.PI; else if (dth < -Math.PI) dth += 2 * Math.PI;
  maxKink = Math.max(maxKink, Math.abs(dth));
}
// closure: wrap distance between sample 0 and the step from sample n-1
const closeDx = d.x[0] - (d.x[d.n - 1] + Math.sin(d.th[d.n - 1]) * d.ds);
const closeDz = d.z[0] - (d.z[d.n - 1] + Math.cos(d.th[d.n - 1]) * d.ds);

// self-proximity: closest approach between samples that are far apart in s
let worst = { dist: Infinity, i: 0, j: 0 };
const n = d.n;
for (let i = 0; i < n; i += 2) {
  for (let j = i + 1; j < n; j += 2) {
    const sep = Math.min(Math.abs(j - i), n - Math.abs(j - i));
    if (sep < 120) continue;
    const dx = d.x[i] - d.x[j], dz = d.z[i] - d.z[j];
    const dist = Math.hypot(dx, dz) - d.hw[i] - d.hw[j];
    if (dist < worst.dist) worst = { dist, i, j };
  }
}

console.log('=== SPINE ===');
console.log('samples          ', d.n, ' ds', d.ds, 'm');
console.log('lap length       ', t.length.toFixed(1), 'm   (' + (t.length / 1000).toFixed(3), 'km)');
console.log('closure residual ', Math.hypot(closeDx, closeDz).toExponential(2), 'm');
console.log('heading correction', t.closure.corr.toFixed(4), 'rad');
console.log('elevation        ', minY.toFixed(1), '→', maxY.toFixed(1), 'm');
console.log('half width       ', minHW.toFixed(1), '→', maxHW.toFixed(1), 'm');
console.log('max bank tilt    ', maxTilt.toFixed(3), `(${(Math.atan(maxTilt) * 57.3).toFixed(1)}°)`);
console.log('max kink / sample', (maxKink * 57.3).toFixed(3), '°');
console.log('tightest pass    ', worst.dist.toFixed(1), 'm of clearance between s', worst.i, 'and s', worst.j,
  '(sep', (Math.abs(worst.i - worst.j) * d.ds).toFixed(0), 'm)');
console.log('\n=== FEATURE ANCHORS (s in metres) ===');
for (const [k, v] of Object.entries(t.anchors)) {
  const zone = t.zoneAt(v.mid);
  console.log(`  ${k.padEnd(10)} ${v.s0.toFixed(0).padStart(5)} → ${v.s1.toFixed(0).padStart(5)}  (${(v.s1 - v.s0).toFixed(0)} m)  zone=${zone}`);
}
console.log('\n=== ZONES ===');
for (const z of t.zones.spans) console.log(`  ${z.zone.padEnd(9)} ${z.s0.toFixed(0).padStart(5)} → ${z.s1.toFixed(0).padStart(5)}`);
console.log('\nhigh line:', t.branches.high.length.toFixed(0), 'm  s', t.branches.high.s0World.toFixed(0), '→', t.branches.high.s1World.toFixed(0));
console.log('start/finish s =', t.startS.toFixed(0), ' grid slots:');
for (const p of t.startPositions) console.log('   ', p.x.toFixed(1), p.y.toFixed(1), p.z.toFixed(1), 'yaw', (p.yaw * 57.3).toFixed(1), 's', p.s.toFixed(0), 'e', p.e.toFixed(1));

// projection round-trip test
let maxErr = 0;
let hint = 0;
for (let s = 0; s < t.length; s += 7) {
  for (const e of [-8, 0, 8]) {
    const p = t.point(s, e);
    const pr = d.project(p.x, p.z, hint, 200);
    hint = pr.i;
    let dsErr = Math.abs(((pr.s - s + t.length / 2) % t.length) - t.length / 2);
    maxErr = Math.max(maxErr, dsErr, Math.abs(pr.e - e));
  }
}
console.log('\nproject() round-trip max error:', maxErr.toFixed(3), 'm', maxErr < 1.5 ? 'OK' : 'FAIL');
