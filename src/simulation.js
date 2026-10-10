// Can-Scale Reactor Lab — deliberately reduced-order, browser-local educational model.
//
// The model is not a reactor design tool. It is a deterministic teaching model that makes
// uncertainty, thermal feedback, material substitutions, and fail-safe behaviour visible.
// Units are kept explicit where useful; several coefficients are scaled for a can-scale
// demonstrator and are intentionally not representative of a licensable nuclear system.

export const MODEL_VERSION = "0.4.0";
export const NOMINAL_THERMAL_KW = 4.8;
export const MAX_ELECTRIC_KW = 1.75;

export const MATERIAL_LIBRARY = {
  fuel: {
    ceramic: {
      id: "ceramic",
      label: "Ceramic microfuel",
      short: "UO₂ / SiC",
      color: "#f0b84b",
      reactivity: 0.00000,
      powerFactor: 1.0,
      thermalMass: 19,
      maxTemp: 760,
      note: "stable baseline"
    },
    metallic: {
      id: "metallic",
      label: "Metallic microfuel",
      short: "U–Mo / composite",
      color: "#c5d3de",
      reactivity: 0.00026,
      powerFactor: 1.08,
      thermalMass: 15,
      maxTemp: 690,
      note: "higher output / warmer"
    },
    thorium: {
      id: "thorium",
      label: "Thorium analogue",
      short: "Th-232 proxy",
      color: "#87d1b5",
      reactivity: -0.00014,
      powerFactor: 0.9,
      thermalMass: 23,
      maxTemp: 810,
      note: "lower output / forgiving"
    }
  },
  cladding: {
    sic: {
      id: "sic",
      label: "SiC composite",
      short: "SiC",
      color: "#90a4b5",
      maxTemp: 880,
      vibrationLimit: 0.92,
      shieldBonus: 1.04,
      note: "high-temperature shell"
    },
    steel: {
      id: "steel",
      label: "316 steel",
      short: "316 SS",
      color: "#718194",
      maxTemp: 675,
      vibrationLimit: 0.72,
      shieldBonus: 1.12,
      note: "ductile baseline"
    },
    alloy: {
      id: "alloy",
      label: "Nickel alloy",
      short: "Ni alloy",
      color: "#c8a878",
      maxTemp: 820,
      vibrationLimit: 0.84,
      shieldBonus: 1.08,
      note: "balanced hot-side margin"
    }
  },
  coolant: {
    helium: {
      id: "helium",
      label: "Helium loop",
      short: "He",
      color: "#91d8ef",
      heatTransfer: 0.017,
      capacity: 4.2,
      flowLimit: 1.15,
      note: "clean, high-flow gas"
    },
    water: {
      id: "water",
      label: "Water loop",
      short: "H₂O",
      color: "#5da6ff",
      heatTransfer: 0.022,
      capacity: 4.18,
      flowLimit: 0.98,
      note: "compact heat capacity"
    },
    salt: {
      id: "salt",
      label: "Molten salt analogue",
      short: "FLiBe proxy",
      color: "#f2a15d",
      heatTransfer: 0.014,
      capacity: 2.1,
      flowLimit: 0.88,
      note: "slow, high-temperature loop"
    }
  },
  shield: {
    tungsten: {
      id: "tungsten",
      label: "Tungsten sleeve",
      short: "W",
      color: "#d0d8de",
      attenuation: 0.046,
      thickness: 3.6,
      mass: 8.4,
      note: "dense / heaviest"
    },
    steel: {
      id: "steel",
      label: "Steel + borated liner",
      short: "SS + B",
      color: "#778997",
      attenuation: 0.031,
      thickness: 4.8,
      mass: 6.1,
      note: "balanced shielding"
    },
    water: {
      id: "water",
      label: "Water jacket",
      short: "H₂O jacket",
      color: "#6aa8d4",
      attenuation: 0.024,
      thickness: 6.2,
      mass: 5.2,
      note: "lightest / least margin"
    }
  }
};

export const DEFAULT_INPUTS = {
  control: 0.62,
  flow: 0.72,
  vibration: 0.12,
  sensorNoise: 0.025,
  ambient: 22,
  accident: null,
  scram: false,
  inertCore: false,
  automaticScram: true
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const lerp = (a, b, t) => a + (b - a) * t;

// Small deterministic PRNG keeps a run replayable. This is preferable to Math.random for
// experiments because identical inputs and seed produce identical traces.
function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value |= 0;
    value = (value + 0x6d2b79f5) | 0;
    let t = Math.imul(value ^ (value >>> 15), 1 | value);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function centeredNoise(random) {
  return (random() + random() + random() - 1.5) / 1.5;
}

const pickMaterial = (group, value, fallback) => {
  const id = typeof value === "object" && value !== null ? value.id : value;
  return MATERIAL_LIBRARY[group][id] ?? MATERIAL_LIBRARY[group][fallback];
};

export function materialSet(selection = {}) {
  return {
    fuel: pickMaterial("fuel", selection.fuel, "ceramic"),
    cladding: pickMaterial("cladding", selection.cladding, "sic"),
    coolant: pickMaterial("coolant", selection.coolant, "helium"),
    shield: pickMaterial("shield", selection.shield, "tungsten")
  };
}

export function createInitialState(seed = 4317) {
  const material = materialSet();
  return {
    seed,
    time: 0,
    neutronDensity: 0.62,
    precursor: 0.62 * (0.0065 / (0.12 * 0.08)),
    coreTemp: 468,
    coolantTemp: 43,
    pressure: 0.48,
    integrity: 1,
    radiation: 0.16,
    powerThermal: 0,
    powerElectric: 0,
    flowActual: DEFAULT_INPUTS.flow,
    flowObserved: DEFAULT_INPUTS.flow,
    vibrationObserved: DEFAULT_INPUTS.vibration,
    temperatureObserved: 468,
    doseObserved: 0.16,
    state: "RUNNING",
    tripReason: "",
    lastEvent: "Baseline stable",
    material,
    autoScram: false,
    failed: false,
    sensorFault: false
  };
}

function snapshot(state, extras = {}) {
  return { ...state, ...extras };
}

/**
 * Build a simulation engine. `step` advances an explicit point-kinetics + heat-balance
 * approximation and returns a sensor-facing snapshot. The equations are intentionally
 * simple enough to inspect in the UI's Model notes card.
 */
export function createReactorSimulation(seed = 4317) {
  let random = mulberry32(seed);
  let state = createInitialState(seed);

  function reset(nextSeed = seed) {
    random = mulberry32(nextSeed);
    state = createInitialState(nextSeed);
    return snapshot(state);
  }

  function step(rawInputs = DEFAULT_INPUTS, rawDt = 0.25, selection = {}) {
    const inputs = { ...DEFAULT_INPUTS, ...rawInputs };
    const material = materialSet(selection);
    const dt = clamp(Number(rawDt) || 0.25, 0.01, 1.2);
    const previous = state;
    const noise = centeredNoise(random);
    const flowNoise = centeredNoise(random);
    const vibrationNoise = centeredNoise(random);
    const tempNoise = centeredNoise(random);
    const doseNoise = centeredNoise(random);
    const baseSensorNoise = clamp(Number(inputs.sensorNoise) || 0, 0, 0.12);

    const accident = inputs.accident;
    // A sensor-fault test increases readback uncertainty without changing the underlying
    // heat balance. This keeps failures observable while preserving causality.
    const sensorNoise = accident === "sensor-fault" ? Math.max(baseSensorNoise, 0.12) : baseSensorNoise;
    const lossFactor = accident === "coolant-loss" ? 0.22 : accident === "sensor-fault" ? 0.94 : 1;
    const vibrationFlowPenalty = clamp(Math.abs(inputs.vibration) * 0.12, 0, 0.12);
    const actualFlow = clamp(
      Number(inputs.flow) * material.coolant.flowLimit * lossFactor * (1 - vibrationFlowPenalty) *
        (1 + flowNoise * sensorNoise * 0.65),
      0,
      1.18
    );

    const selectedControl = clamp(Number(inputs.control), 0, 1);
    const thermalExcursion = previous.coreTemp - 465;
    // rho is a small reactivity term. beta and Lambda are illustrative point-kinetics
    // coefficients; the UI labels this as a reduced-order teaching model.
    const beta = 0.0065;
    const lambda = 0.08;
    const generationTime = 0.12;
    const baseRho = (selectedControl - 0.5) * 0.003;
    const tempFeedback = -0.000004 * Math.max(0, thermalExcursion);
    const vibrationReactivity = -0.00004 * Math.abs(inputs.vibration);
    const rho = clamp(baseRho + material.fuel.reactivity + tempFeedback + vibrationReactivity, -0.008, 0.004);

    let neutronDensity = previous.neutronDensity;
    let precursor = previous.precursor;
    let stateName = previous.state;
    let tripReason = previous.tripReason;
    let lastEvent = previous.lastEvent;
    let autoScram = previous.autoScram;
    let failed = previous.failed;

    const requestScram = Boolean(inputs.scram || inputs.inertCore);
    const hotLimit = Math.min(material.fuel.maxTemp, material.cladding.maxTemp) - 10;
    const vibrationLimit = material.cladding.vibrationLimit;
    const predictedHot = previous.coreTemp > hotLimit;
    const predictedVibration = Math.abs(inputs.vibration) > vibrationLimit;
    const predictedDose = previous.radiation > 2.5;

    if (inputs.automaticScram && !failed && (predictedHot || predictedVibration || predictedDose || accident === "coolant-loss")) {
      autoScram = true;
      tripReason = predictedHot
        ? "Hot-side limit"
        : predictedVibration
          ? "Vibration limit"
          : predictedDose
            ? "Shield margin"
            : "Coolant-loss test";
      lastEvent = `Automatic SCRAM · ${tripReason}`;
    }

    if (requestScram || autoScram) {
      // A control-rod insertion is represented as prompt negative reactivity. Precursors
      // continue to contribute for a short interval, so power falls rather than teleporting.
      const shutdownRho = -0.009;
      const dn = (((shutdownRho - beta) / generationTime) * neutronDensity + lambda * precursor) * dt;
      const dc = ((beta / generationTime) * neutronDensity - lambda * precursor) * dt;
      neutronDensity = clamp(neutronDensity + dn, 0, 1.6);
      precursor = clamp(precursor + dc, 0, 1.2);
      if (stateName === "RUNNING") {
        stateName = "SCRAM";
        tripReason = tripReason || (inputs.inertCore ? "Operator inerting command" : "Operator SCRAM");
        lastEvent = inputs.inertCore ? "Core inerting sequence initiated" : "Manual SCRAM initiated";
      }
    } else if (!failed) {
      const dn = (((rho - beta) / generationTime) * neutronDensity + lambda * precursor) * dt;
      const dc = ((beta / generationTime) * neutronDensity - lambda * precursor) * dt;
      neutronDensity = clamp(neutronDensity + dn, 0, 1.7);
      precursor = clamp(precursor + dc, 0, 1.3);
    }

    if (inputs.inertCore) {
      neutronDensity = clamp(neutronDensity * Math.exp(-dt * 2.6), 0, 1.7);
      precursor = clamp(precursor * Math.exp(-dt * 1.3), 0, 1.3);
      stateName = "INERTED";
      tripReason = "Core rendered subcritical";
      lastEvent = "Core inert · decay heat only";
    }

    const powerThermal = clamp(
      NOMINAL_THERMAL_KW * neutronDensity * material.fuel.powerFactor * (0.98 + 0.02 * material.coolant.heatTransfer / 0.017),
      0,
      NOMINAL_THERMAL_KW * 1.45
    );
    // Heat balance: m c dT/dt = P - UA·flow·(Tcore-Tcoolant). Coefficients are scaled
    // for a can-scale conceptual loop and are not plant design data.
    const heatRemoved = material.coolant.heatTransfer * actualFlow * Math.max(0, previous.coreTemp - previous.coolantTemp);
    const thermalMass = material.fuel.thermalMass;
    const dCoreTemp = ((powerThermal - heatRemoved) / thermalMass) * dt * 2.4;
    const coolantRise = powerThermal / Math.max(0.3, actualFlow * material.coolant.capacity * 1.8);
    const targetCoolantTemp = inputs.ambient + 17 + coolantRise;
    const coreTemp = clamp(previous.coreTemp + dCoreTemp, inputs.ambient, 1200);
    const coolantTemp = clamp(lerp(previous.coolantTemp, targetCoolantTemp, clamp(dt * 0.55, 0, 0.8)), inputs.ambient, 500);
    const pressure = clamp(0.28 + actualFlow * 0.44 + Math.max(0, coolantTemp - 50) * 0.0018 + Math.abs(inputs.vibration) * 0.035, 0, 1.5);

    const thermalStress = clamp((coreTemp - (hotLimit - 90)) / 180, 0, 1.6);
    const vibrationStress = clamp(Math.abs(inputs.vibration) / Math.max(0.1, vibrationLimit), 0, 1.8);
    const accidentStress = accident === "coolant-loss" ? 0.0014 : 0;
    const damageRate = (thermalStress ** 2 * 0.00022 + vibrationStress ** 2 * 0.00013 + accidentStress) * dt;
    const integrity = clamp(previous.integrity - damageRate, 0, 1);

    const shieldMargin = material.shield.attenuation * material.shield.thickness * material.cladding.shieldBonus * integrity;
    const sourceDose = 0.22 + powerThermal * 0.06 + Math.max(0, coreTemp - 500) * 0.0025;
    const radiation = clamp(sourceDose * Math.exp(-shieldMargin) * (accident === "shield-breach" ? 4.2 : 1), 0, 99);
    const powerElectric = clamp(powerThermal * (0.26 + 0.06 * actualFlow) * (0.86 + 0.14 * integrity), 0, MAX_ELECTRIC_KW);

    if (!failed && integrity <= 0.18) {
      failed = true;
      stateName = "FAILED";
      tripReason = "Structural margin exhausted";
      lastEvent = "Containment test failed · core isolated";
      neutronDensity *= 0.1;
    }
    if (stateName === "SCRAM" && neutronDensity < 0.018) {
      stateName = inputs.inertCore ? "INERTED" : "SAFE SHUTDOWN";
      lastEvent = inputs.inertCore ? "Core inert · safe shutdown confirmed" : "Safe shutdown confirmed";
    }

    const flowObserved = clamp(actualFlow * (1 + flowNoise * sensorNoise), 0, 1.3);
    const tempObserved = Math.max(inputs.ambient, coreTemp + tempNoise * sensorNoise * 18);
    const doseObserved = Math.max(0, radiation * (1 + doseNoise * sensorNoise));
    const vibrationObserved = clamp(Math.abs(inputs.vibration) * (1 + vibrationNoise * sensorNoise), 0, 1.5);

    state = {
      ...previous,
      time: previous.time + dt,
      neutronDensity,
      precursor,
      coreTemp,
      coolantTemp,
      pressure,
      integrity,
      radiation,
      powerThermal,
      powerElectric,
      flowActual: actualFlow,
      flowObserved,
      vibrationObserved,
      temperatureObserved: tempObserved,
      doseObserved,
      state: stateName,
      tripReason,
      lastEvent,
      material,
      autoScram,
      failed,
      sensorFault: accident === "sensor-fault"
    };

    return snapshot(state, {
      inputs,
      rho,
      beta,
      heatRemoved,
      shieldMargin,
      thermalStress,
      vibrationStress,
      noise,
      alarm: stateName === "RUNNING" ? (integrity < 0.7 || radiation > 1.0 ? "CAUTION" : "NOMINAL") : stateName,
      isCritical: stateName === "RUNNING" && (integrity < 0.7 || radiation > 1.0 || thermalStress > 0.9),
      materialIds: {
        fuel: material.fuel.id,
        cladding: material.cladding.id,
        coolant: material.coolant.id,
        shield: material.shield.id
      }
    });
  }

  return {
    getState: () => snapshot(state),
    reset,
    step
  };
}

export function formatMetric(value, decimals = 1) {
  return Number.isFinite(value) ? Number(value).toFixed(decimals) : "—";
}

export const MODEL_NOTES = [
  "Point kinetics: dn/dt = ((ρ − β) / Λ)n + λC; dC/dt = (β / Λ)n − λC.",
  "Heat balance: m·c·dT/dt = P − UA·ṁ·(Tcore − Tcoolant).",
  "Shielding proxy: dose = source × exp(−attenuation × thickness).",
  "Sensor values add deterministic bounded noise; the seed makes comparison runs repeatable.",
  "This is a visual, reduced-order educational simulator—not a safety case, reactor design, or operating procedure."
];
