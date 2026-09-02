/**
 * engine.js — powertrain / vehicle dynamics.
 *
 * A one-dimensional lumped-parameter model:
 *
 *     I·dω/dt = T_engine(rpm, throttle, boost) − T_load(gear, v)
 *
 * with a turbo lag filter, a fuel-cut rev limiter, an idle governor, a
 * dual-clutch (or manual) gearbox with a finite shift time, longitudinal vehicle
 * dynamics and, for the two hybrids, an electric assist + regen model.
 *
 * Pure JS, no Web Audio — unit tested in test/engine.test.js.
 */

const G = 9.81;
const RHO = 1.2; // kg/m³ air
const TWO_PI = Math.PI * 2;
const K_CLUTCH = 150; // N·m per rad/s of slip — stiff enough to lock, soft enough to launch
const DRIVETRAIN_EFF = 0.92;
const MAX_STEP = 1 / 400; // fixed integration step (s)

/** Piecewise-linear torque curve lookup, clamped at both ends. */
export function torqueAt(curve, rpm) {
  if (rpm <= curve[0][0]) {
    const slope = (curve[1][1] - curve[0][1]) / (curve[1][0] - curve[0][0]);
    return Math.max(0, curve[0][1] + slope * (rpm - curve[0][0]));
  }
  for (let i = 1; i < curve.length; i++) {
    if (rpm <= curve[i][0]) {
      const [r0, t0] = curve[i - 1];
      const [r1, t1] = curve[i];
      return t0 + ((t1 - t0) * (rpm - r0)) / (r1 - r0);
    }
  }
  const n = curve.length;
  return curve[n - 1][1];
}

export const rpmToOmega = (rpm) => (rpm * TWO_PI) / 60;
export const omegaToRpm = (w) => (w * 60) / TWO_PI;

export class Powertrain {
  constructor(car) {
    this.car = car;
    this.engine = car.engine;
    this.mode = 'dyno'; // 'dyno' | 'road'
    this.auto = true;

    this.rpm = 0;
    this.throttle = 0;
    this.throttleTarget = 0;
    this.brake = 0;
    this.boost = 0;
    this.gear = 1;
    this.clutch = 1;
    this.clutchActual = 0;
    this.shiftTimer = 0;
    this.shiftTo = 0;
    this.shiftCooldown = 0;
    this.pendingShiftCooldown = 0;
    this.speed = 0; // m/s
    this.running = false;
    this.phase = 'off'; // off | cranking | run | stopping
    this.crankTimer = 0;
    this.runTimer = 0;
    this.warmup = 1; // 0 = stone cold
    this.limiterCut = false;
    this.torque = 0;
    this.soc = 1;
    this.assist = 0;
    this.starter = 0; // 0..1 starter engagement, drives the starter whine
    this.blip = 0; // throttle blip used to rev-match downshifts
    this.maxDrop = { 'gtr-nismo': 470, p918: 760, laferrari: 800, 'spyder-718': 540 }[car.id] || 600;
  }

  /* ------------------------------------------------------------- controls */

  start() {
    if (this.phase !== 'off') return;
    this.phase = 'cranking';
    this.crankTimer = 0;
    this.running = true;
    this.starter = 1;
  }

  shutdown() {
    if (this.phase === 'off') return;
    this.phase = 'stopping';
    this.running = true; // still turning, just not fuelling
  }

  setThrottle(t) {
    this.throttleTarget = Math.max(0, Math.min(1, t));
  }

  setBrake(b) {
    this.brake = Math.max(0, Math.min(1, b));
  }

  setMode(mode) {
    this.mode = mode === 'road' ? 'road' : 'dyno';
    if (this.mode === 'dyno') {
      this.speed = 0;
      this.clutch = 1;
      this.shiftTimer = 0;
    }
  }

  get gearCount() {
    return this.car.gears.length;
  }

  get ratio() {
    return this.gear >= 1 && this.gear <= this.gearCount
      ? this.car.gears[this.gear - 1] * this.car.finalDrive
      : 0;
  }

  shiftUp() {
    if (this.shiftTimer > 0 || this.gear >= this.gearCount) return false;
    this.shiftTo = this.gear + 1;
    this.shiftTimer = this.car.shiftTime;
    this.pendingShiftCooldown = 1;
    return true;
  }

  shiftDown() {
    if (this.shiftTimer > 0 || this.gear <= 1) return false;
    this.shiftTo = this.gear - 1;
    this.shiftTimer = this.car.shiftTime * (this.car.shiftTime > 0.25 ? 1.15 : 1);
    this.blip = this.car.shiftTime > 0.25 ? 0.45 : 0.25; // rev match
    this.pendingShiftCooldown = 1;
    return true;
  }

  /* --------------------------------------------------------------- helpers */

  get idleTarget() {
    return this.engine.idle + 480 * (1 - this.warmup);
  }

  /** Turbo boost scaling of the torque curve (spool-dependent). */
  boostScale() {
    const e = this.engine;
    if (e.aspiration !== 'turbo') return 1;
    const [lo, hi] = e.boostRampRpm;
    const rpmGate = Math.max(0, Math.min(1, (this.rpm - lo) / (hi - lo)));
    const norm = Math.max(0, Math.min(1, this.boost / e.maxBoost));
    const scale = 0.32 + 0.68 * norm;
    return 1 - rpmGate * (1 - scale);
  }

  /* ---------------------------------------------------------------- update */

  /**
   * Advance the simulation by `dt` seconds. The integrator is internally
   * sub-stepped to MAX_STEP so the result never depends on the caller's frame
   * rate (the UI calls at 1/400, offline tools at 1/60).
   */
  update(dt) {
    let remaining = Math.max(0, Math.min(dt, 0.25));
    let snap = this.snapshot();
    while (remaining > 1e-9) {
      const h = Math.min(MAX_STEP, remaining);
      snap = this._step(h);
      remaining -= h;
    }
    return snap;
  }

  _step(dt) {
    const car = this.car;
    const e = this.engine;

    // throttle: drive-by-wire lag
    const tbw = this.phase === 'run' ? 9 : 25;
    this.throttle += (this.throttleTarget - this.throttle) * Math.min(1, dt * tbw);
    if (this.blip > 0) {
      this.blip = Math.max(0, this.blip - dt * 2.2);
    }

    // warm-up / cranking state machine
    if (this.phase === 'cranking') {
      this.crankTimer += dt;
      this.rpm += (265 - this.rpm) * Math.min(1, dt * 9);
      this.starter = 1;
      if (this.crankTimer > 0.55) {
        this.phase = 'run';
        this.starter = 0;
        this.warmup = 0.15;
        this.runTimer = 0;
      }
    } else if (this.phase === 'stopping') {
      this.starter = 0;
    } else {
      this.starter = 0;
    }
    if (this.phase === 'run') {
      this.warmup = Math.min(1, this.warmup + dt / 25);
      this.runTimer += dt;
    }

    /* ------------------------------------------------ engine torque */
    const fuelling = this.phase === 'run';
    const limitRpm = e.redline;
    if (this.rpm > e.fuelCut) this.limiterCut = true;
    else if (this.rpm < e.fuelCut - 220) this.limiterCut = false;
    const softCut = this.rpm > limitRpm && !this.limiterCut;

    let throttleEff = this.throttle + this.blip;
    if (this.limiterCut) throttleEff = 0;
    else if (softCut) throttleEff *= 0.25;
    throttleEff = Math.max(0, Math.min(1.15, throttleEff));

    // turbo lag
    if (e.aspiration === 'turbo') {
      const [lo, hi] = e.boostRampRpm;
      const gate = Math.max(0, Math.min(1, (this.rpm - lo) / (hi - lo)));
      const target = e.maxBoost * this.throttle * gate;
      const tau = e.boostTimeConstant * (1.5 - 0.7 * gate);
      this.boost += (target - this.boost) * Math.min(1, dt / tau);
      this.boost = Math.max(0, this.boost);
    }

    const tqCurve = torqueAt(e.torqueCurve, this.rpm) * this.boostScale();
    // idle governor: enough torque to hold idle, capped so the engine "catches"
    // from cranking speed instead of lurching
    const idleError = Math.max(0, Math.min(1.6, (this.idleTarget - this.rpm) / 220));
    const idleNeed = fuelling ? idleError * 95 * Math.max(0, 1 - this.throttle * 1.4) : 0;
    const frictionScale = e.displacement / 4000;
    const fric =
      (8 + 6 * (this.rpm / 1000) + 0.9 * Math.pow(this.rpm / 1000, 2)) *
      frictionScale *
      (1 - 0.55 * this.throttle);

    let tq = fuelling ? tqCurve * throttleEff + Math.max(0, idleNeed) : 0;
    tq -= fric;
    this.torque = tq;

    /* ------------------------------------------------ drivetrain / load */
    // Two-mass model: engine inertia and vehicle mass are coupled by a clutch
    // that transmits torque proportional to slip, so the engine can idle while
    // the car is stationary, launch, creep, and be dragged down on a downshift.
    const omega = rpmToOmega(this.rpm);
    const inGear = this.mode === 'road' && this.gear >= 1 && this.phase !== 'off';

    // gearbox / clutch command
    if (this.shiftTimer > 0) {
      this.shiftTimer = Math.max(0, this.shiftTimer - dt);
      const half = this.car.shiftTime / 2;
      const t = this.car.shiftTime - this.shiftTimer;
      this.clutch = t < half ? 1 - t / half : this.shiftTimer / half;
      if (this.shiftTimer === 0) {
        this.gear = this.shiftTo;
        this.clutch = 1;
      }
    } else {
      this.clutch = Math.min(1, this.clutch + dt * 12);
    }

    let fMotor = 0;
    if (inGear) {
      const reflected = (this.speed / car.wheelRadius) * this.ratio;
      // A dual clutch never fully locks below idle speed: it slips to let the
      // engine run, and closes with throttle (with a little creep at rest).
      const nearStop = reflected < rpmToOmega(e.idle) * 0.9;
      const command = nearStop
        ? this.clutch * Math.min(1, 0.18 + 1.6 * this.throttle)
        : this.clutch;
      this.clutchActual += (command - this.clutchActual) * Math.min(1, dt * 25);
    } else {
      this.clutchActual = 0;
    }

    // longitudinal forces
    let fResist = 0;
    if (this.mode === 'road') {
      const v = this.speed;
      const fDrag = 0.5 * RHO * car.cda * v * v;
      const fRoll = car.crr * car.mass * G * (v > 0.15 ? 1 : 0);
      const fBrake = this.brake * 15000 * (v > 0.02 ? 1 : 0);
      let fRegen = 0;
      if (car.hybrid) {
        const available = car.hybrid.kw * 1000 * Math.min(1, this.soc / 0.15);
        const assist = this.throttle * available;
        this.assist = available > 0 ? Math.min(1, assist / (car.hybrid.kw * 1000)) : 0;
        fMotor = v > 0.8 ? assist / v : assist / 0.8;
        this.soc = Math.max(0, this.soc - (assist * dt) / (car.hybrid.kwh * 3.6e6));
        const regenPower = (this.brake > 0.02 || this.throttle < 0.06 ? 1 : 0) * 0.35 * car.hybrid.kw * 1000;
        fRegen = v > 1 ? regenPower / v : 0;
        this.soc = Math.min(1, this.soc + (regenPower * 0.55 * dt) / (car.hybrid.kwh * 3.6e6));
      } else {
        this.assist = 0;
      }
      fResist = fDrag + fRoll + fBrake + fRegen;
    }

    /* ------------------------------------------------ integrate */
    // The clutch is a stiff spring: explicit Euler would need dt < 2·I/K to stay
    // stable (≈1.3 ms for the V12), so the clutch term is integrated exactly —
    // ω(τ) = ω∞ + (ω₀ − ω∞)·e^(−K·τ/I), with ω∞ = reflected + T_other/K.
    // Unconditionally stable at any step size.
    const kEff = inGear ? this.clutchActual * K_CLUTCH : 0;
    const ratioNow = this.ratio;
    const reflected = inGear ? (this.speed / car.wheelRadius) * ratioNow : 0;
    let nextOmega;
    let clutchAvg = 0;
    if (kEff > 1e-6) {
      const wInf = reflected + tq / kEff;
      const decay = Math.exp((-kEff / e.inertia) * dt);
      nextOmega = wInf + (omega - wInf) * decay;
      clutchAvg = kEff * 0.5 * ((omega - reflected) + (nextOmega - reflected));
      const maxTq = e.peakTorque * 1.6;
      clutchAvg = Math.max(-maxTq, Math.min(maxTq, clutchAvg));
    } else {
      nextOmega = omega + (tq / e.inertia) * dt;
    }

    // limit how fast the engine can fall (throttle-body damping, clutch drag)
    let dw = nextOmega - omega;
    if (dw < 0) dw = Math.max(dw, -this.maxDrop * dt);
    nextOmega = Math.max(0, omega + dw);
    this.rpm = omegaToRpm(nextOmega);
    this.clutchTorque = clutchAvg;

    // vehicle
    if (this.mode === 'road') {
      const fDrive = inGear ? (clutchAvg * ratioNow * DRIVETRAIN_EFF) / car.wheelRadius : 0;
      const dv = ((fDrive + fMotor - fResist) / car.mass) * dt;
      this.speed = Math.max(0, this.speed + dv);
    }

    // stall: only once the engine has had time to catch from cranking speed
    if (this.phase === 'run' && this.runTimer > 0.35 && this.rpm < 320 && this.throttle < 0.05) {
      this.phase = 'stopping';
    }
    if (this.phase === 'stopping' && this.rpm < 25) {
      this.phase = 'off';
      this.running = false;
      this.rpm = 0;
      this.boost = 0;
    }

    /* ------------------------------------------------ automatic gearbox */
    this.shiftCooldown = Math.max(0, (this.shiftCooldown || 0) - dt);
    if (this.shiftTimer === 0 && this.pendingShiftCooldown > 0) {
      this.pendingShiftCooldown = 0;
      this.shiftCooldown = 0.3;
    }
    if (
      this.auto &&
      this.mode === 'road' &&
      this.phase === 'run' &&
      this.shiftTimer <= 0 &&
      this.shiftCooldown <= 0
    ) {
      if (this.rpm > e.redline - 150 && this.gear < this.gearCount) this.shiftUp();
      else if (this.rpm < e.idle + 350 && this.gear > 1 && this.throttle > 0.05) this.shiftDown();
    }

    return this.snapshot();
  }

  snapshot() {
    return {
      rpm: this.rpm,
      throttle: this.throttle,
      boost: this.boost,
      gear: this.gear,
      gearCount: this.gearCount,
      speed: this.speed,
      speedKph: this.speed * 3.6,
      clutch: this.clutchActual,
      phase: this.phase,
      running: this.phase === 'run' || this.phase === 'cranking' || this.phase === 'stopping',
      starter: this.starter,
      warmup: this.warmup,
      torque: this.torque,
      limiter: this.limiterCut,
      soc: this.soc,
      assist: this.assist,
      mode: this.mode,
      auto: this.auto,
      engineOff: this.phase === 'off',
    };
  }
}
