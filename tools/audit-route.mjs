// Route joint audit: proves the moving, fractured surfaces stay drivable.
//
// For many moments of the town's motion it raycasts the real colliders along the
// racing line (centre and +-3 m) every 0.5 m and checks:
//   STEP-UP  a sudden rise between consecutive samples beyond what the line's own
//            grade explains (a kerb the car would slam into). Limit: 0.15 m.
//   HOLE     a stretch with no drivable surface that is NOT an authored gap/jump.
//            Cracks up to 2.2 m are fine at speed; longer holes are reported.
// Also reports how much each joint moves over time (the motion is real, not frozen).
//   node tools/audit-route.mjs [--seconds=90] [--step=0.5]
import * as THREE from 'three';
import { buildLevel01 } from '../src/level/level01.js';
import { F } from '../src/core/world.js';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const SECONDS = Number(args.seconds ?? 90), TSTEP = Number(args.step ?? 0.5);
const STEP_LIMIT = 0.15, HOLE_LIMIT = 2.2, DS = 0.5;
const level = buildLevel01();
const W = level.world;
const route = level.sections[0].route;
const filt = (c) => c.drivable && (c.body.flags & F.ROUTE);
const hit = { t: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), collider: null };
const down = new THREE.Vector3(0, -1, 0);
const lats = [-3, 0, 3];
const N = Math.floor(route.length / DS);
const isAir = new Uint8Array(N + 1);
for (let i = 0; i <= N; i++) isAir[i] = route.at(i * DS).surface === 'air' ? 1 : 0;
const worstStep = new Float32Array(N + 1).fill(-9);
const stepMin = new Float32Array(N + 1).fill(9), stepMax = new Float32Array(N + 1).fill(-9);
const holes = new Map();
const detail = [];
let samples = 0;
const o = new THREE.Vector3();
const t0 = Date.now();
for (let tm = 0; tm <= SECONDS; tm += TSTEP) {
  W.motionTime = tm;
  W.stamp++;
  for (const lat of lats) {
    let prevH = null, holeStart = -1;
    for (let i = 0; i <= N; i++) {
      const s = i * DS;
      const f = route.at(s);
      o.copy(f.p).addScaledVector(f.r, lat).add(new THREE.Vector3(0, 3, 0));
      let h = isAir[i] ? null : W.raycast(o, down, 9, filt, hit);
      if (h && h.normal.y < 0.6) h = null; // grazing a crack wall is not a surface
      samples++;
      if (!h) {
        if (!isAir[i] && holeStart < 0) holeStart = s;
        prevH = isAir[i] ? null : prevH;
        if (isAir[i] && holeStart >= 0) { holeStart = -1; }
        continue;
      }
      if (holeStart >= 0) {
        const len = s - holeStart;
        if (len > HOLE_LIMIT) { const key = `${Math.round(holeStart)}@${lat}`; holes.set(key, Math.max(holes.get(key) || 0, len)); }
        holeStart = -1;
      }
      const y = h.point.y;
      if (prevH !== null) {
        const expected = (route.at(s).p.y - route.at(prevH.s).p.y);
        const step = (y - prevH.y) - expected;
        // only count abrupt rises across a joint (different bodies), not a body's own slope
        if (h.collider.body !== prevH.body) {
          if (step > worstStep[i]) { worstStep[i] = step; detail[i] = `${prevH.body.name}#${prevH.body.id} -> ${h.collider.body.name}#${h.collider.body.id} t=${tm} lat=${lat}`; }
          if (lat === 0) { stepMin[i] = Math.min(stepMin[i], y - prevH.y); stepMax[i] = Math.max(stepMax[i], y - prevH.y); }
        }
      }
      prevH = { y, body: h.collider.body, s };
    }
  }
}
const bad = [];
for (let i = 0; i <= N; i++) if (worstStep[i] > STEP_LIMIT) bad.push({ s: i * DS, step: +worstStep[i].toFixed(3), beat: route.at(i * DS).beat, d: detail[i] });
let joints = 0, moveSum = 0, moveMax = 0, moveAt = 0;
for (let i = 0; i <= N; i++) if (stepMax[i] > -9) { joints++; const m = stepMax[i] - stepMin[i]; moveSum += m; if (m > moveMax) { moveMax = m; moveAt = i * DS; } }
const worst = Math.max(...worstStep);
console.log(`audited ${SECONDS}s of motion @${TSTEP}s, ${samples.toLocaleString()} raycasts in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(`joints crossed on the centre line: ${joints}; joint height variation over time: mean ${(moveSum / Math.max(1, joints) * 100).toFixed(1)} cm, max ${(moveMax * 100).toFixed(1)} cm (at s=${moveAt} ${route.at(moveAt).beat})`);
console.log(`worst step-up anywhere (incl. +-3 m): ${(worst * 100).toFixed(1)} cm (limit ${STEP_LIMIT * 100} cm)`);
if (bad.length) { console.log('STEP-UPS over limit:'); for (const b of bad.slice(0, 40)) console.log(`  s=${b.s} ${b.beat} +${(b.step * 100).toFixed(1)} cm   ${b.d}`); }
if (holes.size) { console.log('HOLES (non-authored) over', HOLE_LIMIT, 'm:'); for (const [k, v] of [...holes].slice(0, 40)) console.log(`  from s=${k} m (lat) length ${v.toFixed(1)} m`); }
const ok = !bad.length && !holes.size;
console.log(ok ? 'PASS: every joint stays drivable through the motion' : 'FAIL');
process.exit(ok ? 0 : 1);
