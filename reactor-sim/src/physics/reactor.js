// Coupled reactor simulation: neutronics, three-node thermal network, coolant loop,
// power conversion, vibration, sensors with 2-out-of-3 voting, protection, decay heat,
// dose and an energy ledger that the test-suite checks for conservation.
//
// Thermal network (explicit Euler, fixed step):
//   C_f dTf/dt = Q_gen - Q_fc                    fuel (volume-average)
//   C_c dTc/dt = Q_fc - Q_cw                     coolant (lumped; flow sets the film coefficient)
//   C_w dTw/dt = (Q_cw - P_e) - Q_env            can wall + shield heat capacity
//   Q_fc   = G_fc (Tf - Tc),   G_fc = 1 / (1/(hA) + 1/(8 pi k H))
//   Q_cw   = G_cw (Tc - Tw),   G_cw = series(converter, gamma shield, neutron shield) cylinders
//   P_e    = eta(Tc, Tw) Q_cw  thermoelectric / Stirling output; the converter is the heat
//            engine between the coolant (hot side) and the can wall (cold side)
//   Q_env  = A [h_conv (Tw - Ta) + eps sigma (Tw^4 - Ta^4)] + UA_sink (Tw - Ta)
//
// Reactivity: rho = rho_ex - (W/N) sum z_i + alpha_D dTf + alpha_M dTc + alpha_void void
//                   + c_vib x_vib + rho_poison.

import { createRng, createOuNoise } from './rng.js';
import { createKinetics, stepKinetics } from './neutronics.js';
import { deriveDesign } from './design.js';
import {
  FUELS,
  COOLANTS,
  fuelConductivity,
  coolantDensity,
  coolantCp,
  saturationK,
  converterEfficiency,
} from './materials.js';
import {
  stackResponse,
  createNarrowbandProcess,
  brittleExceedanceRate,
  fatigueDamageRate,
} from './vibration.js';
import { decayHeatFraction, doseRateAt } from './radiation.js';
import { BETA_TOTAL, CAN_RADIUS_M, SIGMA_SB } from './constants.js';

const VOID_SPAN_K = 20; // coolant superheat over which void fraction rises 0 -> 1 (assumption)
const KILL_POISON_RHO = -0.1; // permanent poison injection worth (Δk/k)
const WARMUP_STEP = 0.05; // s, thermal network is stable at this step for the reference design

export class ReactorSimulation {
  /**
   * @param {object} design  see defaultDesign() in design.js
   * @param {object} opts    { seed, dt, warmUpS, noise, pumpOffsetFrac }
   *   noise: enables sensor noise, flow fluctuation and the per-run pump tolerance draw.
   */
  constructor(design, opts = {}) {
    const { seed = 1, dt = 0.01, warmUpS = 3000, noise = true, protection = true } = opts;
    this.design = structuredClone(design);
    this.g = deriveDesign(this.design);
    this.rng = createRng(seed);
    this.dt = dt;
    this.noiseEnabled = noise;
    this.t = 0;
    this.warmUpS = warmUpS;
    this.events = [];
    this.history = [];
    this.historyEvery = 1; // s
    this._nextSample = 0;
    this.warmed = false;
    this.protectionEnabled = protection; // false = trips disabled (unprotected test case)

    const d = this.design;
    const g = this.g;
    this.runtime = {
      psdMultiplier: 1,
      ambientK: d.ambientK,
      sinkFactor: 1,
      operatorInsertRate: 0, // 1/s of rod-bank reference change; negative = withdraw
      setpointFrac: d.controller.setpointFrac,
    };

    // Pump: per-run tolerance draw (uniform within the design band) when noise is on.
    const tol = d.pump.toleranceFrac;
    this.pump = {
      tripped: false,
      tripTime: null,
      speed: 1,
      toleranceFrac: opts.pumpOffsetFrac ?? (noise ? this.rng.range(-tol, tol) : 0),
    };

    // Thermal state (start near ambient, then warm up to the setpoint)
    this.Tf = d.ambientK + 5;
    this.Tc = d.ambientK + 5;
    this.Tw = d.ambientK + 2;
    this.coolantFrozen = false;

    // Kinetics and rods
    this.kin = createKinetics({ Lambda: g.Lambda, power: 1 });
    this.rods = Array.from({ length: d.rods.count }, () => ({ z: 0, stuck: false }));
    this.zRef = d.excessReactivity / d.rods.worthTotal; // rod insertion that balances excess reactivity
    this.zCommand = this.zRef;
    this.zRefOffset = 0; // accumulated operator reference change
    this.controllerIntegral = 0;
    this.refTemps = { Tf: this.Tf, Tc: this.Tc };
    this.rho = 0;

    this.killed = false;
    this.destroyed = false;
    this.destroyCause = null;
    this.breach = false;
    this.ruptured = false;
    this.converterFailed = false;
    this.fuelDamaged = false;
    this.meltFraction = 0;
    this.dryout = false;
    this.promptSupercritical = false;
    this.releaseFraction = 0;

    this.shutdown = { time: null, P0: 0 };
    this.scram = { requested: false, time: null, cause: null, rodsMoveAt: null };
    this.trip = { latched: false, time: null, causes: [] };

    // Vibration and structural state
    this.vibration = { grms: 0, aRms: 0, xRms: 0, Q: 1 / (2 * d.vibration.zeta), psd: d.vibration.psd };
    this.vibProcess = null;
    this.xMm = 0;
    this.stackStress = 0;
    this.supportStress = 0;
    this.fatigueDamage = 0;
    this._makeVibrationProcess();
    // fractional flow fluctuation driven by vibration: starts at zero, amplitude set per step by
    // vibrationFlowPerG * grms (sigma is passed to step(), so the initial state must not be random)
    this.flowVibNoise = createOuNoise(this.rng, 0, 0.05);

    // Sensor channels: three independent channels per measured quantity
    const s = d.sensors;
    const mk = (sigma) => [0, 1, 2].map(() => createOuNoise(this.rng, sigma, s.tauS));
    this.channels = {
      flux: mk(s.fluxSigma), // relative
      fuelT: mk(s.tempSigmaK), // K
      coolT: mk(s.tempSigmaK), // K
      flow: mk(s.flowSigma), // relative
      grms: mk(s.vibrationSigmaG), // g
    };
    this.readings = null;

    // Energy ledger (J). Identity checked in tests:
    //   thermal = electric + environment + stored.
    this.energy = { thermal: 0, electric: 0, environment: 0, stored: 0 };
    this.maxima = { Tf: this.Tf, Tc: this.Tc, Tw: this.Tw, n: 1, grms: 0, meltFraction: 0 };
    this.lastOutputs = null;

    // Static pressure check: the can must hold the design coolant pressure.
    if (g.hoopStress > g.hoopLimit) {
      this.ruptured = true;
      this._destroy('pressure rupture at start-up', true);
    }

    this._warmUp(warmUpS);
  }

  // ------------------------------------------------------------------ public controls
  scramRods(cause = 'manual SCRAM') {
    if (this.scram.requested) return;
    this.scram.requested = true;
    this.scram.time = this.t;
    this.scram.cause = cause;
    this.scram.rodsMoveAt = this.t + this.design.rods.signalDelayS;
    this.rods.forEach((rod) => {
      rod.stuck = this.forceStuck || (this.noiseEnabled && this.rng.chance(this.design.rods.pStuck));
    });
    const stuck = this.rods.filter((r) => r.stuck).length;
    this._markShutdown();
    this._event(`SCRAM requested (${cause}). Rods stuck: ${stuck}/${this.rods.length}.`);
    if (!this.trip.latched) {
      this.trip.latched = true;
      this.trip.time = this.t;
    }
  }

  /** Failure injection: every rod sticks at its current position on the next SCRAM. */
  forceStuckRods() {
    this.forceStuck = true;
    this._event('Rod-drive fault: all rods will stick on SCRAM.');
  }

  /** Permanent poison injection plus SCRAM. Rods behave as in a SCRAM. */
  killCore(cause = 'core kill') {
    if (this.killed) return;
    this.killed = true;
    this._event(`CORE KILL: permanent poison injected (${cause}).`);
    this.scramRods(cause);
    this._markShutdown();
  }

  /** Destroys the core: fission stops at once, fuel inventory is released to the can. */
  destroyCoreNow(cause = 'operator destruct') {
    if (this.destroyed) return;
    this._destroy(cause, false);
  }

  tripPump(cause = 'pump trip') {
    if (this.pump.tripped) return;
    this.pump.tripped = true;
    this.pump.tripTime = this.t;
    this._event(`Pump trip (${cause}): coolant coast-down begins.`);
  }

  setVibrationMultiplier(m) {
    this.runtime.psdMultiplier = m;
    this._makeVibrationProcess();
  }

  setSinkFactor(f) {
    this.runtime.sinkFactor = f;
  }

  setOperatorInsertRate(rate) {
    this.runtime.operatorInsertRate = rate;
  }

  setSetpoint(frac) {
    this.runtime.setpointFrac = frac;
  }

  setAmbient(K) {
    this.runtime.ambientK = K;
  }

  /** Apply a scripted action from a scenario timeline. */
  applyAction(action, params = {}) {
    switch (action) {
      case 'scram':
        return this.scramRods(params.cause ?? 'scripted SCRAM');
      case 'kill':
        return this.killCore(params.cause ?? 'scripted kill');
      case 'destroy':
        return this.destroyCoreNow(params.cause ?? 'scripted destruct');
      case 'pumpTrip':
        return this.tripPump(params.cause ?? 'scripted pump trip');
      case 'vibration':
        this._event(`Vibration environment changed to ${params.multiplier.toFixed(2)}× the design PSD.`);
        return this.setVibrationMultiplier(params.multiplier);
      case 'ambient':
        this._event(`Ambient temperature changed to ${(params.K - 273.15).toFixed(0)} °C.`);
        return this.setAmbient(params.K);
      case 'sink':
        this._event(`Heat-sink conductance set to ${(params.factor * 100).toFixed(0)}% of design.`);
        return this.setSinkFactor(params.factor);
      case 'withdraw':
        this._event(`Operator withdraws rods at ${params.rate} per second.`);
        return this.setOperatorInsertRate(-Math.abs(params.rate));
      case 'setpoint':
        return this.setSetpoint(params.frac);
      case 'stuckRods':
        return this.forceStuckRods();
      default:
        throw new Error(`Unknown action ${action}`);
    }
  }

  // ------------------------------------------------------------------ main loop
  /** Advance by `seconds`, firing timeline actions {t, action, params} at their times. */
  run(seconds, timeline = []) {
    const end = this.t + seconds;
    const pending = timeline.slice().sort((a, b) => a.t - b.t);
    while (this.t < end - 1e-12) {
      while (pending.length && pending[0].t <= this.t + 1e-12) {
        const item = pending.shift();
        this.applyAction(item.action, item.params ?? {});
      }
      this.step(this.dt);
    }
    return this;
  }

  /** One fixed step of length h (seconds). Returns the step outputs. */
  step(h) {
    const d = this.design;
    const g = this.g;
    this.t += h;

    // ---- pump and flow -------------------------------------------------------------
    if (this.pump.tripped) {
      const tau = d.pump.coastDownTauS;
      this.pump.speed = Math.max(d.pump.naturalCirculationFrac, Math.exp(-(this.t - this.pump.tripTime) / tau));
    }
    const vibFlow = this.noiseEnabled
      ? this.flowVibNoise.step(h, d.pump.vibrationFlowPerG * this.vibration.grms)
      : 0;
    const mdotTrue = g.flowNom * (1 + this.pump.toleranceFrac) * this.pump.speed * (1 + vibFlow);
    const mdotFloor = d.pump.naturalCirculationFrac * g.flowNom; // natural circulation floor
    const mdotEff = Math.max(mdotTrue, mdotFloor);

    // ---- coolant state -------------------------------------------------------------
    const coolant = COOLANTS[d.coolant];
    const pMPa = d.coolantPressureMPa;
    const tSat = saturationK(d.coolant, pMPa);
    const Tc = this.Tc;
    this.coolantFrozen = this.coolantFrozen
      ? Tc < coolant.freezeK + 5 // thaw hysteresis
      : coolant.freezeK > 0 && Tc < coolant.freezeK;
    const void_ = Math.min(1, Math.max(0, (Tc - tSat) / VOID_SPAN_K));
    if (void_ > 0.9 && !this.dryout) {
      this.dryout = true;
      this._event('Coolant dry-out: void fraction above 0.9, heat-transfer collapse.');
    }
    const h0 = coolant.h0 * (this.coolantFrozen ? 0.1 : 1);
    const hCoef = h0 * Math.pow(Math.max(mdotEff, 1e-12) / g.flowNom, 0.8) * (1 - 0.9 * void_);
    const Aff = 2 * Math.PI * g.rf * g.H;
    const kf = fuelConductivity(d.fuel, this.Tf);
    const Gfc = 1 / (1 / Math.max(hCoef * Aff, 1e-12) + 1 / (8 * Math.PI * kf * g.H));
    const cpc = coolantCp(d.coolant, Tc);
    const Cc = coolantDensity(d.coolant, Tc, pMPa) * g.coolantVolume * cpc;
    const Tsink = this.runtime.ambientK;

    // ---- sensors (sampled once per step) --------------------------------------------
    const nTrue = this.destroyed ? 0 : this.kin.n;
    this.readings = this._readSensors(h, { nNorm: nTrue, Tf: this.Tf, Tc, mdotEff, grms: this.vibration.grms });

    // ---- vibration and structural integrity ---------------------------------------------
    this._vibrationStep(h);

    // ---- control and kinetics ---------------------------------------------------------------
    this._controlRods(h);
    const rhoRods = -(d.rods.worthTotal / d.rods.count) * this.rods.reduce((s, r) => s + r.z, 0);
    const alphaF = FUELS[d.fuel].alphaDoppler;
    const alphaM = coolant.alphaModerator;
    const alphaV = coolant.alphaVoid;
    const rhoFb =
      alphaF * (this.Tf - this.refTemps.Tf) + alphaM * (Tc - this.refTemps.Tc) + alphaV * void_;
    const rhoVib = d.vibrationReactivityPerMm * this.xMm;
    const rhoPoison = this.killed ? KILL_POISON_RHO : 0;
    const rho = d.excessReactivity + rhoRods + rhoFb + rhoVib + rhoPoison;
    this.rho = rho;
    if (!this.destroyed) {
      stepKinetics(this.kin, rho, h);
      if (this.kin.n < 0) this.kin.n = 0;
    }
    const nNow = this.destroyed ? 0 : this.kin.n;
    const Pfis = nNow * g.ratedPowerW;
    if (rho > BETA_TOTAL && !this.promptSupercritical) {
      this.promptSupercritical = true;
      this._event(`Prompt-supercritical: rho = ${(rho / BETA_TOTAL).toFixed(2)} $ exceeds beta.`);
    }

    // ---- decay heat -------------------------------------------------------------------
    let Pdecay = 0;
    if (this.shutdown.time !== null && this.shutdown.P0 > 0) {
      const tSince = this.t - this.shutdown.time;
      const opTime = this.warmUpS + this.shutdown.time;
      Pdecay = this.shutdown.P0 * decayHeatFraction(tSince, opTime);
    }
    const Pth = Pfis + Pdecay;

    // ---- conversion and thermal network ----------------------------------------------------
    const Ta = Tsink;
    const Qcw = g.gCoolantToWall * (Tc - this.Tw); // coolant -> converter -> shields -> wall
    const Qfc = Gfc * (this.Tf - Tc);
    let Pe = 0;
    if (!this.converterFailed && Qcw > 0) {
      if (Tc > g.converter.tHotMax) {
        this.converterFailed = true;
        this._event(
          `Converter overheated (${(Tc - 273.15).toFixed(0)} °C > ${(g.converter.tHotMax - 273.15).toFixed(0)} °C limit).`,
        );
      } else {
        Pe = converterEfficiency(d.converter, Tc, this.Tw) * Qcw;
      }
    }
    const UA = d.sinkUAWPerK * this.runtime.sinkFactor; // external radiator / heat-sink conductance
    const Qenv =
      g.canOuterArea *
        (d.convectionWPerM2K * (this.Tw - Ta) + d.emissivity * SIGMA_SB * (Math.pow(this.Tw, 4) - Math.pow(Ta, 4))) +
      UA * (this.Tw - Ta);
    const Cf = FUELS[d.fuel].rho * g.fuelVolume * FUELS[d.fuel].cp;
    const Cw = g.wallHeatCapacity;
    const dTf = (h * (Pth - Qfc)) / Cf;
    const dTc = (h * (Qfc - Qcw)) / Cc;
    const dTw = (h * (Qcw - Pe - Qenv)) / Cw;
    this.Tf += dTf;
    this.Tc += dTc;
    this.Tw += dTw;

    // energy ledger uses exactly the discrete fluxes applied above:
    //   thermal = electric + environment + stored
    this.energy.thermal += Pth * h;
    this.energy.electric += Pe * h;
    this.energy.environment += Qenv * h;
    this.energy.stored += Cf * dTf + Cc * dTc + Cw * dTw;

    // ---- damage bookkeeping -------------------------------------------------------------
    if (this.Tf > g.tFuelDamage && !this.fuelDamaged) {
      this.fuelDamaged = true;
      this._event(
        `Fuel damage onset at ${(this.Tf - 273.15).toFixed(0)} °C (limit ${(g.tFuelDamage - 273.15).toFixed(0)} °C).`,
      );
    }
    if (this.Tf > g.tFuelMelt) {
      this.meltFraction = Math.min(1, this.meltFraction + d.meltRatePerKPerS * (this.Tf - g.tFuelMelt) * h);
    }
    if (this.meltFraction >= 0.5 && !this.destroyed) {
      this._destroy('core melt', false);
    }
    if (this.Tw > g.tWallLimit && !this.breach) {
      this.breach = true;
      this.releaseFraction = Math.max(this.releaseFraction, d.releaseFractionBreach);
      this._event(
        `Containment breach: can wall at ${(this.Tw - 273.15).toFixed(0)} °C exceeds ${(g.tWallLimit - 273.15).toFixed(0)} °C.`,
      );
    }

    // ---- protection: 2-out-of-3 voting on the sensed quantities --------------------------
    this._evaluateTrips(this.readings, { tSat, Tw: this.Tw });

    // ---- maxima and sampling -------------------------------------------------------------
    this.maxima.Tf = Math.max(this.maxima.Tf, this.Tf);
    this.maxima.Tc = Math.max(this.maxima.Tc, Tc);
    this.maxima.Tw = Math.max(this.maxima.Tw, this.Tw);
    this.maxima.n = Math.max(this.maxima.n, nNow);
    this.maxima.grms = Math.max(this.maxima.grms, this.vibration.grms);
    this.maxima.meltFraction = Math.max(this.maxima.meltFraction, this.meltFraction);

    this.lastOutputs = {
      Pfis,
      Pdecay,
      Pth,
      Pe,
      Qenv,
      Qfc,
      Qcw,
      Gfc,
      Cc,
      Cf,
      Cw,
      rho,
      rhoRods,
      rhoFb,
      rhoVib,
      mdotTrue,
      mdotEff,
      h: hCoef,
      tSat,
      void: void_,
      Tsink,
      UA,
    };
    if (this.t >= this._nextSample) {
      this._nextSample = this.t + this.historyEvery;
      this._sample();
    }
    return this.lastOutputs;
  }

  // ------------------------------------------------------------------ internals
  _warmUp(seconds) {
    const saveNoise = this.noiseEnabled;
    const saveMult = this.runtime.psdMultiplier;
    // quiet pre-start: no vibration, no sensor noise, no flow fluctuation
    this.noiseEnabled = false;
    this.runtime.psdMultiplier = 0;
    this._makeVibrationProcess();
    const steps = Math.round(seconds / WARMUP_STEP);
    for (let i = 0; i < steps; i += 1) this.step(WARMUP_STEP);

    // Hand over at steady state: feedback reference = current temperatures and the rod
    // reference = current rod position, so reactivity is continuous at t = 0.
    // rho = rho_ex - W z + fb  with fb = rhoFb at hand-over.  Choose zRef so that
    // rho_ex - W zRef = 0 after the feedback reference is moved (rho stays at its end-of-warm-up value).
    const fbEnd = this.lastOutputs.rhoFb;
    this.refTemps = { Tf: this.Tf, Tc: this.Tc };
    this.zRef = this.zCommand - fbEnd / this.design.rods.worthTotal;
    this.zCommand = this.zRef; // rods are set to the corrected position at hand-over (no rate limit)
    this.rods.forEach((rod) => {
      rod.z = this.zCommand;
    });
    this.controllerIntegral = 0;
    this.t = 0;
    this._nextSample = 0;
    this.history = [];
    this.events = [];
    this.trip = { latched: false, time: null, causes: [] };
    this.scram = { requested: false, time: null, cause: null, rodsMoveAt: null };
    this.energy = { thermal: 0, electric: 0, environment: 0, stored: 0 };
    this.maxima = { Tf: this.Tf, Tc: this.Tc, Tw: this.Tw, n: this.kin.n, grms: 0, meltFraction: 0 };
    this.fatigueDamage = 0;
    this.runtime.psdMultiplier = saveMult;
    this.noiseEnabled = saveNoise;
    this._makeVibrationProcess();
    this.warmed = true;
    this._event(
      `Warm-up complete at ${(this.runtime.setpointFrac * 100).toFixed(0)}% power; steady temperatures established.`,
    );
  }

  _makeVibrationProcess() {
    const d = this.design;
    const psd = d.vibration.psd * this.runtime.psdMultiplier;
    const res = stackResponse({
      psd,
      fLo: d.vibration.fLoHz,
      fHi: d.vibration.fHiHz,
      fnHz: this.g.fnStack,
      zeta: d.vibration.zeta,
    });
    this.vibration = { ...res, psd };
    this.xMm = 0;
    this.vibProcess =
      psd > 0
        ? createNarrowbandProcess({
            fnHz: this.g.fnStack,
            zeta: d.vibration.zeta,
            sigma: res.xRms,
            h: this.dt,
            rng: this.rng,
          })
        : null;
  }

  _readSensors(h, truth) {
    const on = this.noiseEnabled;
    const relative = (chs, v) => chs.map((ch) => v * (1 + (on ? ch.step(h) : 0)));
    const additive = (chs, v) => chs.map((ch) => v + (on ? ch.step(h) : 0));
    return {
      flux: relative(this.channels.flux, truth.nNorm),
      fuelT: additive(this.channels.fuelT, truth.Tf),
      coolT: additive(this.channels.coolT, truth.Tc),
      flow: relative(this.channels.flow, truth.mdotEff / this.g.flowNom),
      grms: additive(this.channels.grms, truth.grms),
    };
  }

  _controlRods(h) {
    const d = this.design;
    if (this.scram.requested) {
      if (this.t >= this.scram.rodsMoveAt) {
        const step = (h / d.rods.dropTimeS);
        this.rods.forEach((rod) => {
          if (!rod.stuck) rod.z = Math.min(1, rod.z + step);
        });
      }
      return;
    }
    if (this.killed || this.destroyed) return;

    // PI control of power, using the median of three flux channels
    const nMeas = median(this.readings.flux);
    const e = this.runtime.setpointFrac - nMeas;
    const cfg = d.controller;
    this.zRefOffset += this.runtime.operatorInsertRate * h;
    const zRefMoving = this.zRef + this.zRefOffset;
    const zTarget = zRefMoving - cfg.kp * e - cfg.ki * this.controllerIntegral;
    const zClamped = Math.min(1, Math.max(0, zTarget));
    // conditional integration (anti-windup): integrate only when not saturated
    if (zClamped === zTarget) this.controllerIntegral += e * h;
    const maxStep = cfg.maxRateSPerS * h;
    const dz = Math.max(-maxStep, Math.min(maxStep, zClamped - this.zCommand));
    this.zCommand += dz;
    this.rods.forEach((rod) => {
      rod.z = this.zCommand;
    });
  }

  _vibrationStep(h) {
    const d = this.design;
    const g = this.g;
    if (this.vibProcess && this.noiseEnabled) {
      this.xMm = this.vibProcess.step() * 1000;
    } else {
      this.xMm = 0;
    }
    const aRms = this.vibration.aRms;
    const supportStress = (g.fuelMass * aRms) / d.supportAreaM2; // Pa rms, supports
    const stackStress = (g.fuelMass * aRms) / (Math.PI * g.rf * g.rf); // Pa rms, fuel section
    this.supportStress = supportStress;
    this.stackStress = stackStress;
    if (!this.destroyed) {
      const structure = g.structure;
      this.fatigueDamage += fatigueDamageRate(supportStress, g.fnStack, structure.fatigueCoeff, structure.fatigueExponent) * h;
      if (this.fatigueDamage >= 1) this._destroy('fatigue failure of fuel supports', false);
      if (FUELS[d.fuel].brittle && !this.destroyed) {
        const lambda = brittleExceedanceRate(stackStress, FUELS[d.fuel].sigmaUlt, g.fnStack);
        if (lambda > 0 && this.rng.chance(1 - Math.exp(-lambda * h))) {
          this._destroy('brittle fuel fracture under vibration', false);
        }
      }
    }
    if (!this.converterFailed && this.vibration.grms > g.converter.vibLimitG) {
      this.converterFailed = true;
      this._event(
        `Converter failed: ${this.vibration.grms.toFixed(1)} g rms exceeds its ${g.converter.vibLimitG} g limit.`,
      );
    }
  }

  _evaluateTrips(r, s) {
    const d = this.design;
    const g = this.g;
    const tempLimit = g.tFuelDamage * d.trips.fuelTempFrac;
    const voted = {
      power: vote(r.flux, (v) => v > d.trips.powerFrac),
      fuelTemp: vote(r.fuelT, (v) => v > tempLimit),
      flow: vote(r.flow, (v) => v < d.trips.flowFrac),
      vibration: vote(r.grms, (v) => v > d.trips.grmsG),
      coolantBoil: vote(r.coolT, (v) => v > s.tSat - d.trips.coolantMarginK),
      wall: s.Tw > g.tWallLimit * d.trips.wallTempMargin,
    };
    const causes = Object.keys(voted).filter((k) => voted[k]);
    if (causes.length) {
      this.trip.causes = causes;
      if (this.protectionEnabled && !this.trip.latched && !this.killed) {
        this.scramRods(`protection trip: ${causes.join(', ')}`);
      }
    }
  }

  _markShutdown() {
    if (this.shutdown.time === null) {
      this.shutdown.time = this.t;
      this.shutdown.P0 = this.g.ratedPowerW * this.kin.n;
    }
  }

  _destroy(cause, atInit) {
    this.destroyed = true;
    this.destroyCause = cause;
    this.releaseFraction = Math.max(this.releaseFraction, this.design.releaseFractionDestroyed);
    if (atInit) {
      this.shutdown.time = 0;
      this.shutdown.P0 = 0; // never operated
    } else {
      this._markShutdown();
    }
    this._event(`CORE DESTROYED: ${cause}. Fission stopped; decay heat and release remain.`);
  }

  _event(message) {
    this.events.push({ t: this.t, message });
    if (this.events.length > 300) this.events.shift();
  }

  _sample() {
    const o = this.lastOutputs;
    this.history.push({
      t: this.t,
      Pth: o.Pth,
      Pe: o.Pe,
      Pfis: o.Pfis,
      Tf: this.Tf,
      Tc: this.Tc,
      Tw: this.Tw,
      flow: o.mdotEff,
      grms: this.vibration.grms,
      rhoDollar: o.rho / BETA_TOTAL,
      z: this.zCommand,
    });
    if (this.history.length > 4000) this.history.shift();
  }

  /** Dose rates at 1 m and at the can surface, and the released-inventory dose. */
  radiation() {
    const d = this.design;
    const g = this.g;
    const o = this.lastOutputs;
    const pfis = o ? o.Pfis : 0;
    const gammaLayers = [{ id: g.gammaShield.id, thicknessM: g.gammaShield.thicknessM }];
    const neutronLayers = [{ id: g.neutronShield.id, thicknessM: g.neutronShield.thicknessM }];
    const pdec = o ? o.Pdecay : 0;
    const at1m = doseRateAt({
      fissionPowerW: pfis,
      decayPowerW: pdec,
      distanceM: d.dosePointM,
      gammaLayers,
      neutronLayers,
    });
    const atCanSurface = doseRateAt({
      fissionPowerW: pfis,
      decayPowerW: pdec,
      distanceM: CAN_RADIUS_M,
      gammaLayers,
      neutronLayers,
    });
    // Released inventory: decay-heat gamma with no shielding (point-source approximation).
    const released = o ? o.Pdecay * this.releaseFraction : 0;
    const env = doseRateAt({ fissionPowerW: 0, decayPowerW: released, distanceM: d.dosePointM });
    return { at1m, atCanSurface, releasedAt1m: env.totalSvPerH, releaseFraction: this.releaseFraction };
  }

  /** Full state snapshot for the UI and for tests. */
  snapshot() {
    const o = this.lastOutputs;
    const g = this.g;
    return {
      t: this.t,
      rho: this.rho,
      rhoDollar: this.rho / BETA_TOTAL,
      n: this.destroyed ? 0 : this.kin.n,
      Pfis: o ? o.Pfis : 0,
      Pdecay: o ? o.Pdecay : 0,
      Pth: o ? o.Pth : 0,
      Pe: o ? o.Pe : 0,
      efficiency: o && o.Pth > 0 ? o.Pe / o.Pth : 0,
      Tf: this.Tf,
      Tc: this.Tc,
      Tw: this.Tw,
      Tsat: o ? o.tSat : 0,
      void: o ? o.void : 0,
      flowTrue: o ? o.mdotTrue : 0,
      flowEff: o ? o.mdotEff : 0,
      flowNom: g.flowNom,
      flowMeasured: this.readings ? this.readings.flow : null,
      grms: this.vibration.grms,
      aRms: this.vibration.aRms,
      xMm: this.xMm,
      fn: g.fnStack,
      stackStress: this.stackStress,
      supportStress: this.supportStress,
      fatigueDamage: this.fatigueDamage,
      rods: this.rods.map((r) => ({ z: r.z, stuck: r.stuck })),
      scramRequested: this.scram.requested,
      scramTime: this.scram.time,
      tripCauses: this.trip.causes,
      killed: this.killed,
      destroyed: this.destroyed,
      destroyCause: this.destroyCause,
      meltFraction: this.meltFraction,
      breach: this.breach,
      converterFailed: this.converterFailed,
      dryout: this.dryout,
      fuelDamaged: this.fuelDamaged,
      coolantFrozen: this.coolantFrozen,
      promptSupercritical: this.promptSupercritical,
      pumpTripped: this.pump.tripped,
      pumpSpeed: this.pump.speed,
      releaseFraction: this.releaseFraction,
      radiation: this.radiation(),
      maxima: { ...this.maxima },
      energy: { ...this.energy },
      readings: this.readings,
      limits: {
        tFuelDamage: g.tFuelDamage,
        tFuelMelt: g.tFuelMelt,
        tWallLimit: g.tWallLimit,
        ratedPowerW: g.ratedPowerW,
      },
    };
  }
}

function median(values) {
  const s = values.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** Two-out-of-three voting. */
function vote(values, predicate) {
  return values.filter(predicate).length >= 2;
}

/** Coarse outcome classification used by the scenario and Monte Carlo layers. */
export function outcomeOf(sim) {
  if (sim.destroyed) return 'DESTROYED';
  if (sim.breach) return 'BREACH';
  if (sim.maxima.Tf > sim.g.tFuelDamage) return 'FUEL_DAMAGE';
  if (sim.killed || sim.scram.requested) return 'SHUTDOWN';
  return 'OPERATING';
}
