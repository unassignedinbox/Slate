import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_INPUTS,
  MATERIAL_LIBRARY,
  createReactorSimulation,
  materialSet
} from "./simulation.js";

const advance = (engine, inputs = DEFAULT_INPUTS, steps = 180, dt = 0.24, materials = materialSet()) => {
  let snapshot = engine.getState();
  for (let index = 0; index < steps; index += 1) snapshot = engine.step(inputs, dt, materials);
  return snapshot;
};

test("same seed and inputs produce the same noisy trace", () => {
  const left = createReactorSimulation(2026);
  const right = createReactorSimulation(2026);
  for (let index = 0; index < 80; index += 1) {
    const a = left.step(DEFAULT_INPUTS, 0.24, materialSet());
    const b = right.step(DEFAULT_INPUTS, 0.24, materialSet());
    assert.deepEqual(a, b);
  }
});

test("baseline remains finite and produces a bounded can-scale output", () => {
  for (let seed = 1; seed <= 16; seed += 1) {
    const snapshot = advance(createReactorSimulation(seed));
    for (const key of ["coreTemp", "coolantTemp", "powerElectric", "radiation", "integrity", "flowActual"]) {
      assert.ok(Number.isFinite(snapshot[key]), `${key} was not finite for seed ${seed}`);
    }
    assert.equal(snapshot.state, "RUNNING");
    assert.ok(snapshot.powerElectric >= 0 && snapshot.powerElectric <= 1.75);
    assert.ok(snapshot.integrity > 0.9);
    assert.ok(snapshot.radiation >= 0);
  }
});

test("sensor error is bounded and sensor-fault mode widens readback noise", () => {
  const engine = createReactorSimulation(77);
  let observedError = 0;
  for (let index = 0; index < 100; index += 1) {
    const snapshot = engine.step(DEFAULT_INPUTS, 0.2, materialSet());
    observedError = Math.max(observedError, Math.abs(snapshot.flowObserved - snapshot.flowActual) / Math.max(0.001, snapshot.flowActual));
  }
  assert.ok(observedError <= DEFAULT_INPUTS.sensorNoise * 1.01);

  const faulty = createReactorSimulation(77);
  const normal = faulty.step(DEFAULT_INPUTS, 0.2, materialSet());
  faulty.reset(77);
  const noisy = faulty.step({ ...DEFAULT_INPUTS, accident: "sensor-fault" }, 0.2, materialSet());
  assert.equal(noisy.sensorFault, true);
  assert.ok(Math.abs(noisy.flowObserved - noisy.flowActual) >= Math.abs(normal.flowObserved - normal.flowActual));
});

test("material swaps are accepted as IDs or material records", () => {
  const engine = createReactorSimulation(8);
  const metal = materialSet({ fuel: "metallic", cladding: "steel", coolant: "water", shield: "water" });
  const metalSnapshot = advance(engine, DEFAULT_INPUTS, 70, 0.24, metal);
  assert.equal(metalSnapshot.materialIds.fuel, "metallic");
  assert.equal(metalSnapshot.materialIds.coolant, "water");
  const recordSnapshot = engine.step(DEFAULT_INPUTS, 0.24, { fuel: MATERIAL_LIBRARY.fuel.thorium, cladding: MATERIAL_LIBRARY.cladding.alloy, coolant: MATERIAL_LIBRARY.coolant.salt, shield: MATERIAL_LIBRARY.shield.tungsten });
  assert.equal(recordSnapshot.materialIds.fuel, "thorium");
  assert.equal(recordSnapshot.materialIds.coolant, "salt");
});

test("coolant-loss and vibration conditions trip the automatic safety chain", () => {
  const loss = advance(createReactorSimulation(91), { ...DEFAULT_INPUTS, accident: "coolant-loss" }, 30);
  assert.equal(loss.state, "SCRAM");
  assert.equal(loss.autoScram, true);
  assert.match(loss.tripReason, /Coolant/);

  const vibration = advance(createReactorSimulation(91), { ...DEFAULT_INPUTS, vibration: 1 }, 3);
  assert.equal(vibration.state, "SCRAM");
  assert.equal(vibration.autoScram, true);
  assert.match(vibration.tripReason, /Vibration/);
});

test("inerting terminates the simulated chain reaction", () => {
  const engine = createReactorSimulation(4321);
  let snapshot = advance(engine, DEFAULT_INPUTS, 30);
  assert.ok(snapshot.powerElectric > 0);
  for (let index = 0; index < 90; index += 1) snapshot = engine.step({ ...DEFAULT_INPUTS, scram: true, inertCore: true }, 0.24, materialSet());
  assert.equal(snapshot.state, "INERTED");
  assert.equal(snapshot.tripReason, "Core rendered subcritical");
  assert.ok(snapshot.powerElectric < 0.08);
});

test("shield dose follows the attenuation ordering in the model", () => {
  const tungsten = advance(createReactorSimulation(7), DEFAULT_INPUTS, 120, 0.24, materialSet({ shield: "tungsten" }));
  const water = advance(createReactorSimulation(7), DEFAULT_INPUTS, 120, 0.24, materialSet({ shield: "water" }));
  assert.ok(tungsten.radiation < water.radiation);
});
