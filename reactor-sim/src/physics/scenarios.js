// Named scenarios for the coke-can reactor. Each one is a partial configuration plus the
// behaviour the model is expected to show. `expect` is checked by tests/scenarios.test.mjs.
//
// Source strengths: `cf252` uses micrograms of Cf-252 (2.31e6 n/s per ug, 536 Ci/g);
// `nps` sets the neutron source directly in n/s.

export const NOISE_OFF = {
  pulsationPct: 0, clampPct: 0, flowSensorNoisePct: 0, powerNoisePct: 0,
  dosimeterNoisePct: 0, sensorBiasPct: 0,
};

export const SCENARIOS = [
  {
    id: 'nominal',
    name: 'Nominal operation (10 pg Cf-252 start-up source)',
    config: {},
    duration: 1800,
    dt: 0.5,
    expect: { state: 'RUNNING', accidents: [], trips: [] },
  },
  {
    id: 'pump_trip',
    name: 'Pump trip at 60 s',
    config: { events: [{ t: 60, type: 'pump_trip' }] },
    duration: 600,
    dt: 0.25,
    expect: { state: 'SCRAMMED', trips: ['low_flow'], accidents: [] },
  },
  {
    id: 'blockage_loss_of_cooling',
    name: 'Pump trip with 95 % channel blockage (loss of cooling)',
    config: { events: [{ t: 0, type: 'blockage', value: 0.95 }, { t: 60, type: 'pump_trip' }] },
    duration: 600,
    dt: 0.25,
    expect: { state: 'DESTROYED', accidents: ['loss_of_cooling'] },
  },
  {
    id: 'source_surge_scram',
    name: 'Source surge x1e4 for 60 s (overpower / dose)',
    config: {
      events: [{ t: 100, type: 'source_surge', value: 1e4, duration: 60 }],
    },
    duration: 400,
    dt: 0.25,
    // A surge large enough to trip overpower also drives the can surface past its dose limit,
    // which is an accident: the core is destroyed and the generator cut.
    expect: { state: 'DESTROYED', trips: ['overpower'], accidents: ['dose_exceeded'] },
  },
  {
    id: 'shield_breach',
    name: 'Shield breach to 20 % thickness (10 pg Cf-252 start-up source)',
    config: {
      events: [{ t: 30, type: 'shield_breach', value: 0.2 }],
      safety: { autoCoreKill: false },
    },
    duration: 120,
    dt: 0.25,
    expect: { doseRises: true },
  },
  {
    id: 'coolant_overtemp',
    // Test-only overrides: dose and power trips are raised so that the thermal path is reached.
    name: 'Coolant over-temperature with SCRAM protection (2e11 n/s generator, thermal test)',
    // Dose and power thresholds are raised so the thermal path is reached. The temperature SCRAM
    // then cuts the generator and the core cools down without an accident.
    config: {
      source: { kind: 'nps', nps: 2e11 },
      safety: { doseLimitSurfaceUSvh: 1e15, designPowerW: 1e3, overpowerFactor: 1e9 },
    },
    duration: 6000,
    dt: 1,
    expect: { state: 'SCRAMMED', trips: ['temperature'], accidents: [] },
  },
  {
    id: 'coolant_overtemp_unprotected',
    name: 'Coolant over-temperature with temperature trips disabled (2e11 n/s generator)',
    config: {
      source: { kind: 'nps', nps: 2e11 },
      safety: { doseLimitSurfaceUSvh: 1e15, designPowerW: 1e3, overpowerFactor: 1e9, tripMarginK: -1e4 },
    },
    duration: 20000,
    dt: 1,
    expect: { accidentAny: ['coolant_overtemp', 'fuel_melt', 'clad_breach'], state: 'DESTROYED' },
  },
  {
    id: 'manual_scram',
    name: 'Operator manual SCRAM at 50 s',
    config: { events: [{ t: 50, type: 'manual_scram' }] },
    duration: 200,
    dt: 0.25,
    expect: { state: 'SCRAMMED', trips: ['manual'] },
  },
  {
    id: 'manual_kill',
    name: 'Operator core kill at 50 s',
    config: { events: [{ t: 50, type: 'manual_kill' }] },
    duration: 200,
    dt: 0.25,
    expect: { state: 'DESTROYED', killReason: 'manual_kill' },
  },
  {
    id: 'truck_vibration_316L',
    name: 'Truck vibration, SS316L mount, 6 mm x 20 mm',
    config: { vibration: { profile: 'truck', scale: 1 }, materials: { structure: 'SS316L' } },
    duration: 600,
    dt: 0.25,
    expect: { accidentAny: ['structural_fatigue', 'structural_yield'] },
  },
  {
    id: 'truck_vibration_ti64_isolated',
    name: 'Truck vibration, Ti-6Al-4V mount, 12 mm x 20 mm',
    config: {
      vibration: { profile: 'truck', scale: 1 },
      materials: { structure: 'TI64' },
      support: { dMm: 12, LMm: 20, zeta: null },
    },
    duration: 600,
    dt: 0.25,
    expect: {},
  },
  {
    id: 'aircraft_vibration',
    name: 'Aircraft vibration, IN718 mount, 8 mm x 20 mm',
    config: { vibration: { profile: 'aircraft', scale: 1 }, materials: { structure: 'IN718' }, support: { dMm: 8, LMm: 20, zeta: null } },
    duration: 600,
    dt: 0.25,
    expect: {},
  },
];

export function scenarioById(id) {
  const s = SCENARIOS.find((x) => x.id === id);
  if (!s) throw new Error(`unknown scenario ${id}`);
  return s;
}
