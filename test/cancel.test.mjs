// Adaptive canceller loop math (closed-loop simulation, no GPU) + half->float.
import assert from 'node:assert/strict';
import { CancellerTuner, halfToFloat } from '../src/ocean/probes.js';

// --- half float conversion ---
assert.equal(halfToFloat(0x3c00), 1);
assert.equal(halfToFloat(0xc000), -2);
assert.equal(halfToFloat(0x0000), 0);
assert.ok(Math.abs(halfToFloat(0x3555) - 0.33325) < 1e-4, 'half 0x3555');
console.log('ok halfToFloat');

// --- closed-loop cancellation of a synthetic swell ---
const probesStub = {
  sensor: null,
  ensureSensor(x, z) {
    this.sensor = { kind: 'sensor', x, z, t: new Float32Array(4096), h: new Float32Array(4096), n: 0 };
    return this.sensor;
  },
  removeSensor() { this.sensor = null; },
};
const sourcesStub = {
  list: [],
  addSource(o) { const s = { id: 7, ...o }; this.list.push(s); return s; },
  removeSource() { this.list = []; },
  pushUniforms() {},
};

const tuner = new CancellerTuner(probesStub, sourcesStub);
const Tp = 10, omega = (2 * Math.PI) / Tp, k = (omega * omega) / 9.81;
const src = tuner.place(0, 0, { k, omega, Tp, dirX: 1, dirZ: 0 }, { beamWaves: 3, decayWaves: 8 });
assert.ok(src, 'canceller placed');
assert.ok(tuner.G > 0.5 && tuner.G <= 1, `sensor gate G=${tuner.G}`);

// true incoming swell at the sensor: 0.8*sin(wt + 1.2)
const A = 0.8 * Math.cos(1.2), B = 0.8 * Math.sin(1.2);
const dt = 0.05;
let t = 0;
for (let i = 0; i < 1600; i++) {
  t += dt;
  // the sensor measures incoming + our own current emission (what the GPU renders)
  const emit = -(tuner.Aa * Math.sin(omega * t) + tuner.Ba * Math.cos(omega * t));
  const meas = A * Math.sin(omega * t) + B * Math.cos(omega * t) + emit;
  const p = probesStub.sensor;
  p.t[p.n] = t; p.h[p.n] = meas; p.n++;
  tuner.update(t, dt);
}
const fitErr = Math.hypot(tuner.Aa - A, tuner.Ba - B);
console.log(`fit A=${tuner.Aa.toFixed(3)} (true ${A.toFixed(3)}) B=${tuner.Ba.toFixed(3)} (true ${B.toFixed(3)}) err=${fitErr.toFixed(4)}`);
assert.ok(fitErr < 0.12, 'adaptive fit converges to the incoming wave');
assert.equal(tuner.status, 'cancelling');

// residual once the loop output is applied
let res = 0, ref = 0;
for (let i = 0; i < 400; i++) {
  const tt = t + i * dt;
  const f = A * Math.sin(omega * tt) + B * Math.cos(omega * tt);
  const e = -(tuner.Aa * Math.sin(omega * tt) + tuner.Ba * Math.cos(omega * tt));
  res += (f + e) ** 2; ref += f ** 2;
}
const att = 1 - Math.sqrt(res / ref);
console.log(`steady-state cancellation: ${(att * 100).toFixed(1)}%`);
assert.ok(att > 0.85, 'loop attenuates the swell by >85%');
assert.ok(src.amp > 0.5 && src.amp < 1.2, `emitted amp sane (${src.amp.toFixed(2)}m)`);

console.log('cancel.test.mjs: ALL PASS');
