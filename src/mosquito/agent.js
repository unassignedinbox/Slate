import * as THREE from 'three';
import {
  applyWings, applyWingsFolded, applyLegsFlight, applyProboscis,
  applyAbdomen, solveLeg, clamp, lerp, damp, smoothstep,
} from './kinematics.js';

const D = Math.PI / 180;
const TAU = Math.PI * 2;

export const STATE = {
  CRUISE: 'cruise',
  APPROACH: 'approach',
  HOVER: 'hover',
  LAND: 'land',
  SETTLE: 'settle',
  PROBE: 'probe',
  DRILL: 'drill',
  FEED: 'feed',
  WITHDRAW: 'withdraw',
  TAKEOFF: 'takeoff',
};

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion(), _m4 = new THREE.Matrix4();
const _up = new THREE.Vector3(0, 1, 0);

export class MosquitoAgent {
  constructor(rig, S, M, tank) {
    this.rig = rig; this.S = S; this.m = M; this.tank = tank;

    this.state = STATE.CRUISE;
    this.stateTime = 0;
    this.t = 0;

    this.pos = new THREE.Vector3(6, 3.4, 5);
    this.vel = new THREE.Vector3();
    this.heading = Math.PI;
    this.bank = 0;
    this.pitch = 0;

    this.wingPhase = 0;
    this.sawPhase = 0;
    this.pumpPhase = 0;
    this.drillSpin = 0;

    // continuous 0..1 blends the pose layers read from
    this.b = { fly: 1, fold: 0, bow: 0, extend: 0, drill: 0, pump: 0, droop: 0, plant: 0 };

    this.load = 0;              // litres in the craw
    this.breach = 0;            // 0..1 how far through the tank wall
    this.legPlan = null;
    this.site = null;
    this.orbitAngle = 0;

    this.events = [];
  }

  emit(e) { this.events.push({ ...e, t: this.t }); }

  setState(s) {
    this.state = s;
    this.stateTime = 0;
    this.emit({ type: 'state', state: s });
  }

  /** Pick a spot on the tank to bore, plus the surface frame around it. */
  chooseSite() {
    const s = this.tank.pickSite();
    // surface frame: n = outward normal, f = a tangent the body will face
    const n = s.normal.clone().normalize();
    let f = new THREE.Vector3(0, 1, 0);
    if (Math.abs(f.dot(n)) > 0.9) f.set(1, 0, 0);
    const r = new THREE.Vector3().crossVectors(f, n).normalize();
    f.crossVectors(n, r).normalize();
    this.site = { point: s.point.clone(), n, f, r };
    return this.site;
  }

  update(dt) {
    const m = this.m, S = this.S, rig = this.rig;
    this.t += dt;
    this.stateTime += dt;

    // ---- wingbeat phase. Frequency rises with the load it is carrying. --
    const loadFrac = clamp(this.load / Math.max(1e-6, m.crawCapacity), 0, 1);
    const hz = m.wingbeatHz * (1 + m.loadedWingbeatGain * loadFrac);
    this.wingPhase += hz * dt;
    this.sawPhase += m.sawHz * dt;
    this.pumpPhase += m.pumpHz * dt;
    this.drillSpin += (m.drillRPM / 60) * TAU * dt * this.b.drill;

    switch (this.state) {
      case STATE.CRUISE: this.doCruise(dt); break;
      case STATE.APPROACH: this.doApproach(dt); break;
      case STATE.HOVER: this.doHover(dt); break;
      case STATE.LAND: this.doLand(dt); break;
      case STATE.SETTLE: this.doSettle(dt); break;
      case STATE.PROBE: this.doProbe(dt); break;
      case STATE.DRILL: this.doDrill(dt); break;
      case STATE.FEED: this.doFeed(dt); break;
      case STATE.WITHDRAW: this.doWithdraw(dt); break;
      case STATE.TAKEOFF: this.doTakeoff(dt); break;
    }

    this.pose(dt);
  }

  /* ------------------------------------------------------------------ */
  /*  FLIGHT                                                             */
  /* ------------------------------------------------------------------ */

  /** Steer toward a point with a speed cap; returns distance remaining. */
  steerTo(target, speed, dt, arrive = 0.6) {
    _v.subVectors(target, this.pos);
    const dist = _v.length();
    if (dist < 1e-5) return 0;
    _v.divideScalar(dist);

    const want = Math.min(speed, dist / Math.max(arrive, 1e-3));
    _v2.copy(_v).multiplyScalar(want);

    // limited acceleration -> no teleporting, no instant direction changes
    _v3.subVectors(_v2, this.vel);
    const a = this.m.accel * dt;
    if (_v3.length() > a) _v3.setLength(a);
    this.vel.add(_v3);
    this.pos.addScaledVector(this.vel, dt);

    // Mosquitoes turn by rolling and sideslipping, not by yawing.
    const wantHeading = Math.atan2(this.vel.x, this.vel.z);
    let dh = wantHeading - this.heading;
    while (dh > Math.PI) dh -= TAU;
    while (dh < -Math.PI) dh += TAU;
    const maxTurn = this.m.turnRate * dt;
    const turn = clamp(dh, -maxTurn, maxTurn);
    this.heading += turn;
    const wantBank = clamp(-(turn / Math.max(dt, 1e-4)) / this.m.turnRate, -1, 1) * this.m.maxBankDeg * D;
    this.bank = damp(this.bank, wantBank, 6, dt);
    return dist;
  }

  doCruise(dt) {
    // loose orbit around the vehicle while it hunts for a target
    this.orbitAngle += dt * 0.55;
    const c = this.tank.centre;
    _v.set(
      c.x + Math.cos(this.orbitAngle) * 5.2,
      c.y + 2.6 + Math.sin(this.orbitAngle * 1.7) * 0.9,
      c.z + Math.sin(this.orbitAngle) * 5.2
    );
    this.steerTo(_v, this.m.cruiseSpeed, dt, 1.2);
    this.b.fly = damp(this.b.fly, 1, 8, dt);
    this.b.fold = damp(this.b.fold, 0, 8, dt);

    if (this.stateTime > 3.0) { this.chooseSite(); this.setState(STATE.APPROACH); }
  }

  /** Standoff point: out along the surface normal, offset back along the body axis. */
  standoff(h) {
    const L = this.S.bodyLength;
    return _v3.copy(this.site.point)
      .addScaledVector(this.site.n, h * L)
      .addScaledVector(this.site.f, -0.35 * L);
  }

  doApproach(dt) {
    const target = this.standoff(1.9).clone();
    const dist = this.steerTo(target, this.m.approachSpeed * 2.4, dt, 0.9);
    // face the site
    const toSite = _v.subVectors(this.site.point, this.pos);
    this.heading = damp(this.heading, Math.atan2(toSite.x, toSite.z), 4, dt);
    if (dist < 0.35 * this.S.bodyLength) this.setState(STATE.HOVER);
  }

  doHover(dt) {
    const target = this.standoff(1.25).clone();
    this.steerTo(target, this.m.approachSpeed, dt, 0.5);
    const toSite = _v.subVectors(this.site.point, this.pos);
    this.heading = damp(this.heading, Math.atan2(toSite.x, toSite.z), 5, dt);
    if (this.stateTime > 1.1) {
      this.planLanding();
      this.setState(STATE.LAND);
    }
  }

  /**
   * Work out the final resting transform and where each of the six feet
   * will be planted, before the descent starts.
   */
  planLanding() {
    const S = this.S, L = S.bodyLength;
    const { point, n, f, r } = this.site;

    // Resting attitude: Anopheles sits at ~45 deg to the substrate with
    // the abdomen raised and the proboscis in line with the body.
    const restPitch = this.m.bodyPitchRestDeg * D;

    // Build the rest basis: body forward points down-and-into the surface.
    const fwd = _v.copy(f).multiplyScalar(Math.cos(restPitch))
      .addScaledVector(n, -Math.sin(restPitch)).normalize().clone();
    const side = new THREE.Vector3().crossVectors(n, fwd).normalize();
    const up = new THREE.Vector3().crossVectors(fwd, side).normalize();

    _m4.makeBasis(side.negate(), up, fwd);
    const restQuat = new THREE.Quaternion().setFromRotationMatrix(_m4);
    this.restQuat = restQuat;
    // stand the labella lobes proud of the panel by their own radius,
    // so they press on the surface instead of sinking into it
    this.restAnchor = point.clone().addScaledVector(n, S.labellaLength * 0.75 * L);

    // Where does the root have to sit for the labella to touch the anchor?
    // Solve it exactly by posing the rig at the rest orientation.
    //
    // Two answers matter: with the proboscis sheathed (the pose it lands
    // in) and with the labium fully buckled (the pose it feeds in). The
    // body physically shifts between them, so the feet get planned at a
    // point between the two and the limbs carry the slack.
    const rig0 = this.rig;
    applyProboscis(rig0, this.m, S, { bow: 0, extend: 0, sawPhase: 0, drillSpin: 0, drilling: 0 });
    const rootLand = this.rootForLabellaAt(this.restAnchor, restQuat);
    applyProboscis(rig0, this.m, S, { bow: 1, extend: 1, sawPhase: 0, drillSpin: 0, drilling: 0 });
    const rootFed = this.rootForLabellaAt(this.restAnchor, restQuat);
    this.restRoot = rootLand;
    const planRoot = rootLand.clone().lerp(rootFed, 0.55);

    // ---- foot plant ring -------------------------------------------
    // Two constraints fight each other here: the feet want to sit in the
    // natural splayed stance, and they have to actually be ON the tank AND
    // inside the reach of the limb that owns them. Pose the rig at the
    // rest transform, then relax each target between the surface and the
    // reachable sphere until both hold.
    const rig = this.rig;
    const sp = rig.root.position.clone(), sq = rig.orient.quaternion.clone();
    rig.root.position.copy(planRoot);
    rig.orient.quaternion.copy(restQuat);
    rig.root.updateMatrixWorld(true);

    const snapTo = (p) => (this.tank.projectToSurface
      ? this.tank.projectToSurface(p)
      : { point: p.clone(), normal: n.clone() });

    const spread = this.m.stanceSpread;
    const plan = [];
    for (const leg of this.rig.legs) {
      const pairFwd = [0.62, 0.12, -0.52][leg.pair];
      const pairOut = [0.62, 0.84, 0.92][leg.pair] * spread;
      const hip = leg.root.getWorldPosition(new THREE.Vector3());
      const reach = leg.lens.coxa + leg.lens.troch + leg.lens.femur + leg.lens.tibia;

      let p = point.clone()
        .addScaledVector(f, pairFwd * L * 0.95)
        .addScaledVector(r, leg.side * pairOut * L * 0.72);

      let snap = snapTo(p);
      for (let it = 0; it < 6; it++) {
        p.copy(snap.point);
        const d = _v.subVectors(p, hip);
        const len = d.length();
        // keep the limb comfortably bent: never locked straight, never folded
        const want = clamp(len, reach * 0.62, reach * 0.80);
        if (Math.abs(want - len) > 1e-4) p.copy(hip).addScaledVector(d, want / len);
        snap = snapTo(p);
      }
      plan.push({ leg, point: snap.point, normal: snap.normal, touched: false });
    }

    rig.root.position.copy(sp);
    rig.orient.quaternion.copy(sq);
    rig.root.updateMatrixWorld(true);
    this.legPlan = plan;
  }

  /** Root world position that puts the labella on `anchor` at orientation `q`. */
  rootForLabellaAt(anchor, q) {
    const rig = this.rig;
    const sp = rig.root.position.clone();
    const sq = rig.orient.quaternion.clone();
    rig.root.position.set(0, 0, 0);
    rig.orient.quaternion.copy(q);
    rig.root.updateMatrixWorld(true);
    const off = rig.labella.getWorldPosition(_v).clone();
    rig.root.position.copy(sp);
    rig.orient.quaternion.copy(sq);
    rig.root.updateMatrixWorld(true);
    return anchor.clone().sub(off);
  }

  doLand(dt) {
    const S = this.S, L = S.bodyLength;
    // Fly the body onto the exact resting transform, slowly. Touchdown
    // force on a real mosquito is tiny, so the approach has to be gentle.
    this.steerTo(this.restRoot, this.m.approachSpeed * 0.6, dt, 0.5);
    this.rig.orient.quaternion.slerp(this.restQuat, 1 - Math.exp(-3.2 * dt));
    this.b.plant = damp(this.b.plant, 0.5, 3, dt);

    // Touchdown is staggered: hind pair, then mid, then fore.
    const order = this.m.touchdownOrder;
    const stag = this.m.touchdownStagger;
    let all = true;
    for (let i = 0; i < order.length; i++) {
      const pl = this.legPlan[order[i]];
      if (!pl) continue;
      if (!pl.touched && this.stateTime > 0.25 + i * stag) {
        pl.touched = true;
        this.emit({ type: 'touchdown', leg: order[i] });
      }
      if (!pl.touched) all = false;
    }
    if (all && this.stateTime > 0.25 + order.length * stag + 0.15) this.setState(STATE.SETTLE);
  }

  doSettle(dt) {
    const k = smoothstep(0, this.m.gripSettleTime, this.stateTime);
    this.b.fly = damp(this.b.fly, 0, 7, dt);
    this.b.fold = damp(this.b.fold, 1, 5, dt);
    this.b.plant = damp(this.b.plant, 1, 6, dt);
    this.vel.multiplyScalar(Math.exp(-9 * dt));
    this.settleToRest(dt, 7);
    if (this.stateTime > this.m.gripSettleTime + 0.25) this.setState(STATE.PROBE);
  }

  /**
   * Drive the body onto the resting transform and hold it there.
   *
   * This is a closed loop on the LABELLA, not on the root: whatever the
   * mouthparts do - and they move a lot once the labium starts buckling -
   * the tip stays welded to the spot it chose. The correction is speed
   * limited so the body can never snap.
   */
  settleToRest(dt, lambda) {
    const rig = this.rig;
    rig.orient.quaternion.slerp(this.restQuat, 1 - Math.exp(-lambda * dt));
    rig.root.position.copy(this.pos);
    rig.root.updateMatrixWorld(true);

    const lab = rig.labella.getWorldPosition(_v);
    const err = _v2.subVectors(this.restAnchor, lab);
    const step = err.multiplyScalar(1 - Math.exp(-lambda * dt));
    const maxStep = this.m.approachSpeed * 2.2 * dt;
    if (step.length() > maxStep) step.setLength(maxStep);
    this.pos.add(step);
    this.vel.multiplyScalar(Math.exp(-12 * dt));
  }

  doProbe(dt) {
    const m = this.m;
    this.settleToRest(dt, 10);
    this.b.fold = damp(this.b.fold, 1, 6, dt);
    this.b.plant = 1;

    // Labella sweep: the mosquito tastes the surface looking for a seam
    // before it commits. Real behaviour, and it reads as intelligence.
    const s = Math.sin(this.stateTime * m.probeSweepHz * TAU);
    this.probeSweep = s * m.probeSweepDeg * D;
    this.b.bow = damp(this.b.bow, 0.22, 4, dt);

    if (this.stateTime > m.probeDuration) {
      this.emit({ type: 'commit' });
      this.setState(STATE.DRILL);
    }
  }

  doDrill(dt) {
    const m = this.m, S = this.S;
    this.settleToRest(dt, 10);
    this.probeSweep = damp(this.probeSweep || 0, 0, 8, dt);
    this.b.plant = 1;
    this.b.bow = damp(this.b.bow, 1, 3.5, dt);
    this.b.drill = damp(this.b.drill, 1, 4, dt);

    // Boring through the tank wall. Progress is rate-limited so the
    // fascicle visibly creeps in rather than snapping to depth.
    const wall = this.tank.wallThickness;
    this.breach = clamp(this.breach + (m.drillPlungeRate / wall) * dt, 0, 1);
    this.b.extend = damp(this.b.extend, this.breach, 6, dt);

    if (this.breach >= 1) {
      this.emit({ type: 'breach', point: this.site.point.clone() });
      this.setState(STATE.FEED);
    }
  }

  doFeed(dt) {
    const m = this.m;
    this.settleToRest(dt, 10);
    this.b.plant = 1;
    this.b.bow = 1;
    this.b.extend = damp(this.b.extend, 1, 6, dt);
    this.b.drill = damp(this.b.drill, 0.05, 3, dt);
    this.b.pump = damp(this.b.pump, 1, 4, dt);

    // Fluid transfer. The pump is the throttle; both reservoirs are real.
    const draw = Math.min(
      m.drainRate * dt,
      this.tank.fuel,
      m.crawCapacity - this.load
    );
    this.tank.fuel -= draw;
    this.load += draw;
    this.b.droop = damp(this.b.droop, clamp(this.load / m.crawCapacity, 0, 1), 1.2, dt);

    const full = this.load >= m.crawCapacity * m.detachThreshold;
    if (full || this.tank.fuel <= 1e-4) {
      this.emit({ type: 'sated', load: this.load });
      this.setState(STATE.WITHDRAW);
    }
  }

  doWithdraw(dt) {
    this.settleToRest(dt, 8);
    this.b.plant = 1;
    this.b.pump = damp(this.b.pump, 0, 5, dt);
    this.b.drill = damp(this.b.drill, 0, 5, dt);
    this.b.extend = damp(this.b.extend, 0, 3.2, dt);
    this.b.bow = damp(this.b.bow, 0, 2.6, dt);
    if (this.stateTime > 1.3) this.setState(STATE.TAKEOFF);
  }

  doTakeoff(dt) {
    const m = this.m;
    this.b.fold = damp(this.b.fold, 0, 9, dt);
    this.b.fly = damp(this.b.fly, 1, 9, dt);
    this.b.plant = damp(this.b.plant, 0, 5, dt);

    // Loaded, it leaves badly: shallow climb, heavy, slow.
    const loadFrac = clamp(this.load / m.crawCapacity, 0, 1);
    const climb = m.takeoffImpulse * (1 - m.loadedClimbPenalty * loadFrac);
    if (this.stateTime > 0.22) {
      this.vel.addScaledVector(this.site.n, climb * dt * 3.0);
      this.vel.addScaledVector(_v.set(Math.sin(this.heading), 0, Math.cos(this.heading)), -0.9 * dt);
      // a laden mosquito is slow; cap the departure at cruise speed
      const vmax = m.cruiseSpeed * (1 - 0.5 * loadFrac);
      if (this.vel.length() > vmax) this.vel.setLength(vmax);
      this.pos.addScaledVector(this.vel, dt);
    }
    if (this.stateTime > 2.2) {
      this.load = 0; this.breach = 0; this.b.droop = 0;
      this.legPlan = null;
      this.setState(STATE.CRUISE);
    }
  }

  /* ------------------------------------------------------------------ */
  /*  POSE                                                               */
  /* ------------------------------------------------------------------ */

  pose(dt) {
    const rig = this.rig, m = this.m, S = this.S;
    const L = S.bodyLength;
    const flying = this.b.fly;

    rig.root.position.copy(this.pos);

    if (flying > 0.02) {
      // airborne attitude: nose-up hover plus bank, plus the small yaw
      // wander real mosquitoes never stop doing
      const jitter = Math.sin(this.t * m.yawJitterHz * TAU) * 0.6
        + Math.sin(this.t * m.yawJitterHz * TAU * 0.37 + 1.1) * 0.4;
      const yaw = this.heading + jitter * m.yawJitterDeg * D * flying;
      const speed = this.vel.length();
      const pitchTarget = -m.bodyPitchHoverDeg * D + clamp(speed / 6, 0, 1) * 22 * D;
      this.pitch = damp(this.pitch, pitchTarget, 5, dt);

      const q = _q.setFromEuler(new THREE.Euler(this.pitch, yaw, this.bank, 'YXZ'));
      rig.orient.quaternion.slerp(q, 1 - Math.exp(-14 * dt * flying));
    }

    // per-wingbeat heave: the body bobs against the stroke
    const heave = Math.sin(TAU * this.wingPhase * 2) * m.heaveAmplitude * L * flying;
    rig.body.position.y = heave;
    rig.body.position.z = Math.cos(TAU * this.wingPhase * 2) * m.heaveAmplitude * L * 0.4 * flying;

    // ---- wings --------------------------------------------------------
    if (flying > 0.02) applyWings(rig, m, this.wingPhase, flying);
    if (this.b.fold > 0.02) applyWingsFolded(rig, m, this.b.fold * (1 - flying * 0.6));

    // ---- legs ---------------------------------------------------------
    const plant = this.b.plant;
    if (plant < 0.999) applyLegsFlight(rig, m, this.t, 1 - plant);
    if (plant > 0.001 && this.legPlan) {
      rig.root.updateMatrixWorld(true);
      for (const pl of this.legPlan) {
        if (!pl.touched) continue;
        // the tarsus eases onto the panel as weight comes on
        pl.leg.contact = damp(pl.leg.contact, 1, 8, dt);
        const flatten = pl.leg.contact;
        // per-foot normal: on a curved drum every foot sits on a
        // different tangent plane, so the site normal will not do
        solveLeg(pl.leg, pl.point, rig.thorax, pl.normal || this.site.n, {
          kneeUp: 1, flatten,
          compliance: m.tarsalCompliance,
          curvature: this.tank.surfaceCurvature || 0,
        });
        if (pl.leg.pad) pl.leg.pad.material.emissiveIntensity = 2.2 * pl.leg.contact;
      }
    } else {
      for (const leg of rig.legs) {
        leg.contact = damp(leg.contact, 0, 6, dt);
        if (leg.pad) leg.pad.material.emissiveIntensity = 0;
      }
    }

    // ---- head / probe sweep -------------------------------------------
    rig.head.rotation.y = damp(rig.head.rotation.y, (this.probeSweep || 0), 12, dt);
    rig.head.rotation.x = damp(rig.head.rotation.x, this.b.bow * 0.10, 6, dt);

    // ---- proboscis -----------------------------------------------------
    applyProboscis(rig, m, S, {
      bow: this.b.bow,
      extend: this.b.extend,
      sawPhase: this.sawPhase,
      drillSpin: this.drillSpin,
      drilling: this.b.drill,
    });
    if (rig.fluidColumn) {
      rig.fluidColumn.visible = this.b.pump > 0.05;
      rig.fluidColumn.material.opacity = clamp(this.b.pump, 0, 1) * 0.85;
    }

    // ---- abdomen -------------------------------------------------------
    applyAbdomen(rig, m, S, {
      load: clamp(this.load / m.crawCapacity, 0, 1),
      pumpPhase: this.pumpPhase,
      pumping: this.b.pump,
      droop: this.b.droop,
    });

    // ---- antennae: passive lag, they are feathers not rods -------------
    const sway = Math.sin(this.t * 3.3) * 0.02 * (0.3 + flying);
    for (const side of ['antennaL', 'antennaR']) {
      const chain = rig[side];
      if (!chain) continue;
      for (let i = 1; i < chain.length; i++) {
        chain[i].rotation.x = Math.sin(this.t * 5.5 - i * 0.35) * 0.012 * (0.4 + flying * 1.6);
        chain[i].rotation.y = sway * (i / chain.length);
      }
    }
    // palps stay parallel to the proboscis, lifting slightly while probing
    for (const side of ['palpL', 'palpR']) {
      const chain = rig[side];
      if (!chain) continue;
      chain[0].rotation.x = damp(chain[0].rotation.x, -this.b.bow * 0.28, 5, dt);
    }

    // ---- strobe --------------------------------------------------------
    if (rig.beacon) {
      const on = (Math.sin(this.t * 7.5) > 0.6) ? 1 : 0.06;
      rig.beacon.material.emissiveIntensity = 3.0 * on;
    }
  }
}
