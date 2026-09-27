/**
 * Headless logic test: builds the rig, runs the full behaviour cycle in
 * Node and asserts the motion is sane. Catches every runtime error that
 * does not need a GPU.
 *
 *   node tools/simcheck.mjs
 */
import * as THREE from 'three';
import { params } from '../src/core/params.js';
import { buildMosquito } from '../src/mosquito/mosquito.js';
import { MosquitoAgent, STATE } from '../src/mosquito/agent.js';
import { wingAngles } from '../src/mosquito/kinematics.js';

const D = 180 / Math.PI;
let fails = 0;
const ok = (c, msg, extra = '') => {
  if (!c) { fails++; console.log('  FAIL  ' + msg + (extra ? '  ' + extra : '')); }
  else console.log('  ok    ' + msg + (extra ? '  ' + extra : ''));
};

// ---- fake vehicle -------------------------------------------------------
class FakeTank {
  constructor() {
    this.centre = new THREE.Vector3(0, 1.35, 0);
    this.wallThickness = 0.035;
    this.capacity = 60; this.fuel = 60;
  }
  pickSite() {
    return { point: new THREE.Vector3(-1.0, 1.9, 0), normal: new THREE.Vector3(-0.3, 1, 0).normalize() };
  }
}

console.log('\n== wing kinematics ==');
{
  const m = params.mech;
  let minPhi = 1e9, maxPhi = -1e9, maxAlphaRate = 0, prevA = null;
  const N = 2000;
  for (let i = 0; i < N; i++) {
    const k = wingAngles(i / N, m);
    minPhi = Math.min(minPhi, k.phi); maxPhi = Math.max(maxPhi, k.phi);
    if (prevA !== null) maxAlphaRate = Math.max(maxAlphaRate, Math.abs(k.alpha - prevA) * N);
    prevA = k.alpha;
    if (!Number.isFinite(k.phi + k.theta + k.alpha)) { ok(false, 'non-finite angle at tau=' + (i / N)); break; }
  }
  const amp = (maxPhi - minPhi) * D;
  ok(Math.abs(amp - m.strokeAmplitudeDeg) < 1.0,
    'stroke amplitude matches the parameter', `${amp.toFixed(1)}deg vs ${m.strokeAmplitudeDeg}`);
  ok(amp > 30 && amp < 60,
    'amplitude inside the measured mosquito range (34-54 deg)', `${amp.toFixed(1)}deg`);

  // the flip must be fast: peak rotation rate well above a pure sinusoid
  const sineRate = (m.pitchAmplitudeDeg / D) * Math.PI;
  ok(maxAlphaRate > sineRate * 1.6,
    'wing rotation is trapezoidal, not sinusoidal (fast reversal)',
    `peak ${(maxAlphaRate * D).toFixed(0)}deg/cycle vs sine ${(sineRate * D).toFixed(0)}`);

  // Advanced rotation: each feathering flip must happen BEFORE the stroke
  // reversal it belongs to. Collect both event sets and pair them up.
  const at = (t) => wingAngles(t, m);
  const flips = [], revs = [];
  for (let i = 0; i < N; i++) {
    const t0 = i / N, t1 = (i + 1) / N;
    if (Math.sign(at(t0).alpha) !== Math.sign(at(t1).alpha)) flips.push(t0);
    const p0 = at((i - 1 + N) % N / N).phi, p1 = at(t0).phi, p2 = at(t1).phi;
    if ((p1 - p0) * (p2 - p1) < 0) revs.push(t0);
  }
  let minLead = 1e9;
  for (const rv of revs) {
    let best = 1e9;
    for (const fl of flips) {
      let d = rv - fl; if (d < 0) d += 1;
      best = Math.min(best, d);
    }
    minLead = Math.min(minLead, best);
  }
  ok(flips.length === 2 && revs.length === 2,
    'two feathering flips and two stroke reversals per cycle',
    `${flips.length} flips / ${revs.length} reversals`);
  ok(minLead > 0.01 && minLead < 0.4,
    'rotation LEADS stroke reversal (advanced rotation, the mosquito lift trick)',
    `${(minLead * 100).toFixed(1)}% of cycle ahead`);
}

console.log('\n== rig construction ==');
const rig = buildMosquito(params.shape);
{
  let meshes = 0, tris = 0;
  rig.root.traverse((o) => {
    if (o.isMesh) {
      meshes++;
      const g = o.geometry;
      tris += g.index ? g.index.count / 3 : g.attributes.position.count / 3;
    }
  });
  ok(rig.legs.length === 6, 'six legs', `${rig.legs.length}`);
  ok(rig.legs.every((l) => l.tarsomeres.length === params.shape.legTarsomeres),
    '5 tarsomeres per leg');
  ok(rig.wings.length === 2, 'two wings');
  ok(rig.halteres.length === 2, 'two halteres');
  ok(rig.abdomenSegs.length === params.shape.abdomenSegments,
    `${params.shape.abdomenSegments} abdominal terga`);
  ok(rig.maxillae.length === 2 && rig.mandibles.length === 2 && !!rig.labrum && !!rig.hypopharynx,
    'fascicle has all 6 stylets (labrum, hypopharynx, 2 mandibles, 2 maxillae)');
  ok(rig.labiumJoints.length >= 5, 'labium is a chain so it can buckle',
    `${rig.labiumJoints.length} joints`);
  console.log(`  info  ${meshes} meshes, ${Math.round(tris)} triangles`);

  // proportion checks against the real animal
  rig.root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(rig.root);
  const size = box.getSize(new THREE.Vector3());
  console.log(`  info  bounds ${size.x.toFixed(2)} x ${size.y.toFixed(2)} x ${size.z.toFixed(2)} m`);
  const S = params.shape;
  ok(Math.abs(S.palpLength - S.proboscisLength) / S.proboscisLength < 0.15,
    'FEMALE ANOPHELES: maxillary palps as long as the proboscis',
    `palp ${S.palpLength} vs proboscis ${S.proboscisLength}`);
  const ar = (S.wingLength) / (S.wingChord * S.wingLength);
  ok(ar > 4, 'wing aspect ratio is high (long slender mosquito wing)', `AR ~ ${ar.toFixed(1)}`);
  ok(S.legScalePair3 > S.legScalePair2 && S.legScalePair2 > S.legScalePair1,
    'hind legs longest, fore legs shortest');
}

console.log('\n== behaviour cycle ==');
{
  const tank = new FakeTank();
  const agent = new MosquitoAgent(rig, params.shape, params.mech, tank);
  const seen = [];
  const dt = 1 / 120;
  let prevPos = agent.pos.clone();
  let maxStep = 0;
  let nan = false;
  const startFuel = tank.fuel;

  for (let i = 0; i < 120 * 90; i++) {
    agent.update(dt);
    for (const e of agent.events) if (e.type === 'state') seen.push(e.state);
    agent.events.length = 0;
    if (!Number.isFinite(agent.pos.x + agent.pos.y + agent.pos.z)) { nan = true; break; }
    maxStep = Math.max(maxStep, agent.pos.distanceTo(prevPos));
    prevPos.copy(agent.pos);
    if (seen.includes(STATE.CRUISE) && seen.length > 10) break;
  }
  ok(!nan, 'no NaN in the body trajectory');
  ok(maxStep / dt < params.mech.cruiseSpeed * 3.5,
    'no teleporting: per-frame motion stays within the speed limit',
    `peak ${(maxStep / dt).toFixed(2)} m/s`);

  const want = [STATE.APPROACH, STATE.HOVER, STATE.LAND, STATE.SETTLE,
  STATE.PROBE, STATE.DRILL, STATE.FEED, STATE.WITHDRAW, STATE.TAKEOFF];
  for (const w of want) ok(seen.includes(w), `reached state: ${w}`);
  console.log('  info  sequence: ' + seen.join(' -> '));

  ok(tank.fuel < startFuel, 'fuel actually left the vehicle tank',
    `${startFuel} -> ${tank.fuel.toFixed(1)} L`);
}

console.log('\n== proboscis mechanism ==');
{
  const tank = new FakeTank();
  const agent = new MosquitoAgent(rig, params.shape, params.mech, tank);
  const dt = 1 / 120;
  let bowMax = 0, extMax = 0, worstDepth = 1e9, sampled = 0;
  let sawL = [], sawR = [];
  for (let i = 0; i < 120 * 60; i++) {
    agent.update(dt);
    agent.events.length = 0;
    if (agent.state === STATE.DRILL || agent.state === STATE.FEED) {
      bowMax = Math.max(bowMax, agent.b.bow);
      extMax = Math.max(extMax, agent.b.extend);
      rig.root.updateMatrixWorld(true);
      // signed distance of the LABELLA above the surface - must stay >= 0
      const lab = rig.labella.getWorldPosition(new THREE.Vector3());
      worstDepth = Math.min(worstDepth, lab.sub(agent.site.point).dot(agent.site.n));
      sampled++;
      if (sawL.length < 200) { sawL.push(rig.maxillae[0].position.z); sawR.push(rig.maxillae[1].position.z); }
    }
    if (agent.state === STATE.WITHDRAW) break;
  }
  ok(sampled > 100, 'reached and held the drilling phase', `${sampled} frames`);
  ok(bowMax > 0.9, 'labium buckles into a full bow', `${(bowMax * 100).toFixed(0)}%`);
  ok(extMax > 0.9, 'fascicle drives fully in', `${(extMax * 100).toFixed(0)}%`);
  ok(worstDepth > -0.02 * params.shape.bodyLength,
    'labium/labella stay ON the surface - they never enter the target',
    `deepest ${(worstDepth * 1000).toFixed(1)} mm`);
  const fz = rig.fascicle.position.z;
  ok(fz > 0.3 * params.shape.proboscisLength * params.shape.bodyLength,
    'fascicle translates relative to the labium', `${(fz * 1000).toFixed(0)} mm of travel`);
  const lead = sawL.map((v, i) => v - sawR[i]);
  ok(Math.max(...lead) > 1e-5 && Math.min(...lead) < -1e-5,
    'maxillae alternate as microsaws (left leads, then right)');
}

console.log('\n== leg IK ==');
{
  const tank = new FakeTank();
  const agent = new MosquitoAgent(rig, params.shape, params.mech, tank);
  const dt = 1 / 120;
  for (let i = 0; i < 120 * 60; i++) {
    agent.update(dt); agent.events.length = 0;
    if (agent.state === STATE.FEED && agent.stateTime > 1.0) break;
  }
  rig.root.updateMatrixWorld(true);
  ok(agent.legPlan && agent.legPlan.every((p) => p.touched), 'all six feet touched down');

  let worst = 0;
  for (const pl of agent.legPlan) {
    // the planted joint is the tibia tip = the base of the tarsus
    const tip = pl.leg.tarsomeres[0].getWorldPosition(new THREE.Vector3());
    worst = Math.max(worst, tip.distanceTo(pl.point));
  }
  const tol = 0.04 * params.shape.bodyLength;
  ok(worst < tol, 'every tibia tip reaches its planted world position',
    `worst ${(worst * 1000).toFixed(1)} mm (tol ${(tol * 1000).toFixed(0)} mm)`);

  // the tarsus must lie ALONG the surface, not stab through it
  let deepest = 1e9;
  for (const pl of agent.legPlan) {
    for (const seg of [...pl.leg.tarsomeres, pl.leg.pretarsus]) {
      const wp = seg.getWorldPosition(new THREE.Vector3());
      deepest = Math.min(deepest, wp.sub(pl.point).dot(pl.normal));
    }
  }
  ok(deepest > -0.03 * params.shape.bodyLength,
    'tarsomeres lie on the surface instead of spearing it',
    `deepest ${(deepest * 1000).toFixed(1)} mm`);

  let bad = 0;
  for (const leg of rig.legs) {
    if (Math.abs(leg.tibia.rotation.x) > Math.PI) bad++;
    if (!Number.isFinite(leg.femur.rotation.x + leg.root.rotation.x)) bad++;
  }
  ok(bad === 0, 'no inverted or non-finite joints');
}

console.log('\n== abdomen load ==');
{
  const tank = new FakeTank();
  const agent = new MosquitoAgent(rig, params.shape, params.mech, tank);
  const dt = 1 / 120;
  let before = null, after = null, peakLoad = 0;
  for (let i = 0; i < 120 * 90; i++) {
    agent.update(dt); agent.events.length = 0;
    if (agent.state === STATE.FEED) {
      if (before === null) before = rig.abdomenSegs[1].holder.scale.x;
      after = rig.abdomenSegs[1].holder.scale.x;
      peakLoad = Math.max(peakLoad, agent.load);
    }
    if (agent.state === STATE.WITHDRAW) break;
  }
  ok(before !== null, 'entered the feeding phase');
  ok(after > before * 1.15, 'abdomen distends as it fills',
    `${before.toFixed(3)} -> ${after.toFixed(3)}`);
  ok(peakLoad > params.mech.crawCapacity * 0.9, 'craw fills to the detach threshold',
    `${peakLoad.toFixed(1)} / ${params.mech.crawCapacity} L`);
}

console.log(fails === 0 ? '\nALL CHECKS PASSED\n' : `\n${fails} CHECK(S) FAILED\n`);
process.exit(fails === 0 ? 0 : 1);
