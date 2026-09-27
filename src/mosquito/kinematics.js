import * as THREE from 'three';

const D = Math.PI / 180;
const TAU = Math.PI * 2;

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => t * t * (3 - 2 * t);
export const smoothstep = (a, b, x) => smooth(clamp((x - a) / (b - a), 0, 1));
/** frame-rate independent exponential approach */
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

/* ======================================================================
 *  WING STROKE MODEL
 *
 *  Three Euler angles in the stroke-plane frame, the standard description
 *  for insect flight:
 *     phi   - stroke position (fore/aft sweep)
 *     theta - deviation (out of the stroke plane)
 *     alpha - feathering (rotation about the span axis)
 *
 *  The mosquito-specific parts, all from measured kinematics:
 *   * amplitude is tiny (34-54 deg) - less than half of any other insect
 *   * phi is very close to a pure sinusoid (the thorax is a resonator)
 *   * theta is dominated by the 2nd harmonic -> shallow figure of eight
 *   * alpha is near-trapezoidal: the wing holds a constant angle of attack
 *     through the half stroke then flips extremely fast at reversal, and
 *     that rotation LEADS the reversal (advanced rotation). Most of the
 *     weight support comes from that rotation, not from translation.
 * ====================================================================== */

/** tanh-shaped square wave: k -> 0 is a sine, k large is a hard flip */
function trapezoid(x, k) {
  return Math.tanh(k * Math.sin(x)) / Math.tanh(k);
}

/** Warp phase so the downstroke and upstroke can have different durations */
function asymmetricPhase(tau, a) {
  if (Math.abs(a) < 1e-5) return tau;
  const d = 0.5 - a;
  return tau < d ? 0.5 * (tau / d) : 0.5 + 0.5 * ((tau - d) / (1 - d));
}

export function wingAngles(tau, m) {
  const t = asymmetricPhase(tau - Math.floor(tau), m.strokeAsymmetry);
  const x = TAU * t;

  // --- stroke position -------------------------------------------------
  const phi = m.strokeMeanDeg * D + (m.strokeAmplitudeDeg * D * 0.5) * Math.cos(x);
  const phiDot = -(m.strokeAmplitudeDeg * D * 0.5) * Math.sin(x);

  // --- deviation (figure of eight) -------------------------------------
  const ps = m.deviationPhaseDeg * D;
  const A = m.deviationDeg * D;
  const w2 = m.deviationH2, w1 = 1 - w2;
  const theta = A * (w1 * Math.sin(x + ps) + w2 * Math.sin(2 * x + 2 * ps));

  // --- feathering, with advanced rotation ------------------------------
  const adv = m.rotationAdvanceDeg * D;
  const xr = x + adv;
  const k = Math.max(0.05, m.rotationSharpness);
  const s = trapezoid(xr, k);
  const alpha = m.pitchMidDeg * D * Math.sign(s || 1) * 0 + (m.pitchAmplitudeDeg * D * 0.5) * s;
  // instantaneous rotation rate, used to drive spanwise torsion
  const dsdx = (k * Math.cos(xr) * (1 - Math.pow(Math.tanh(k * Math.sin(xr)), 2))) / Math.tanh(k);
  const alphaDot = (m.pitchAmplitudeDeg * D * 0.5) * dsdx;

  // angle of attack offset: the wing never sits edge-on, it holds
  // pitchMid through the translation phase
  const aoa = m.pitchMidDeg * D;

  return { phi, phiDot, theta, alpha, alphaDot, aoa, t };
}

/**
 * Write the stroke onto the rig for one frame.
 *
 * `dt` is the real frame time. It is used to decide how much of the beat
 * happened between this frame and the last, and therefore how hard to
 * blur - the same decision a camera shutter makes.
 */
export function applyWings(rig, m, phase, gate = 1, dt = 1 / 60) {
  for (const w of rig.wings) {
    // The two wings are mirror images: same phase, mirrored axes.
    const k = wingAngles(phase, m);
    const s = w.side;

    w.plane.rotation.x = -m.strokePlaneDeg * D;
    w.phi.rotation.y = s * k.phi * gate;
    w.theta.rotation.x = k.theta * gate;
    // feathering about the span axis; the sign flips per side so both
    // wings present the same face to the air
    w.alpha.rotation.z = s * (k.aoa + k.alpha) * gate;

    // spanwise torsion: the tip rotates ahead of the root during the flip
    const lagN = clamp(k.alphaDot * 0.10, -1.2, 1.2);
    w.uni.uTwist.value = -s * lagN * (m.spanwiseTwistLagDeg * D) * gate;
    w.uni.uTwistLag.value = 0.9;
    // aeroelastic bend, opposing the direction of travel
    w.uni.uFlex.value = -k.phiDot * m.wingFlexure * 0.22 * gate;

    // ---- stroke blur -------------------------------------------------
    if (w.ghosts && w.ghosts.length) {
      // fraction of a full beat covered by this frame
      const span = clamp(m.wingbeatHz * dt, 0, 1);
      const n = w.ghosts.length;
      // below ~1/6 of a beat per frame the eye can follow the wing, so
      // fade the ghosts out and let the crisp wing carry it
      const strength = smoothstep(0.16, 0.55, span) * gate;
      const op = strength * 0.30;
      w.ghostMat.opacity = op;
      const on = op > 0.004;
      for (const g of w.ghosts) g.mesh.visible = on;
      w.mesh.material.opacity = lerp(0.55, 0.16, strength);

      if (on) {
        for (let i = 0; i < n; i++) {
          // sample backwards across the beat that just elapsed
          const f = (i + 1) / (n + 1);
          const gk = wingAngles(phase - span * f, m);
          const g = w.ghosts[i];
          g.phi.rotation.y = s * gk.phi;
          g.theta.rotation.x = gk.theta;
          g.alpha.rotation.z = s * (gk.aoa + gk.alpha);
        }
        const gl = clamp(k.alphaDot * 0.10, -1.2, 1.2);
        w.ghostUni.uTwist.value = -s * gl * (m.spanwiseTwistLagDeg * D);
        w.ghostUni.uTwistLag.value = 0.9;
        w.ghostUni.uFlex.value = -k.phiDot * m.wingFlexure * 0.22;
      }
    }
  }

  // Halteres: same frequency, antiphase, they are the gyros.
  const hp = m.haltereAntiphase ? phase + 0.5 : phase;
  const ha = Math.sin(TAU * hp) * m.haltereAmplitudeDeg * D * 0.5 * gate;
  for (const h of rig.halteres) {
    h.node.rotation.x = h.base.x + ha;
    h.node.rotation.y = h.base.y - h.side * ha * 0.25;
  }
}

/** Folded wings, the resting position over the abdomen. */
export function applyWingsFolded(rig, m, blend) {
  for (const w of rig.wings) {
    const s = w.side;
    if (w.ghostMat) {
      w.ghostMat.opacity = lerp(w.ghostMat.opacity, 0, blend);
      const on = w.ghostMat.opacity > 0.004;
      for (const g of w.ghosts) g.mesh.visible = on;
      w.mesh.material.opacity = lerp(w.mesh.material.opacity, 0.55, blend);
    }
    w.plane.rotation.x = lerp(w.plane.rotation.x, -18 * D, blend);
    w.phi.rotation.y = lerp(w.phi.rotation.y, s * -72 * D, blend);
    w.theta.rotation.x = lerp(w.theta.rotation.x, -4 * D, blend);
    w.alpha.rotation.z = lerp(w.alpha.rotation.z, s * 6 * D, blend);
    w.uni.uTwist.value = lerp(w.uni.uTwist.value, 0, blend);
    w.uni.uFlex.value = lerp(w.uni.uFlex.value, 0.02, blend);
  }
  for (const h of rig.halteres) {
    h.node.rotation.x = lerp(h.node.rotation.x, h.base.x, blend);
    h.node.rotation.y = lerp(h.node.rotation.y, h.base.y, blend);
  }
}

/* ======================================================================
 *  LEG IK
 *  Aim the whole limb at the target, then solve femur/tibia analytically
 *  in the plane, then lay the tarsomeres down along the surface.
 * ====================================================================== */

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion(), _e = new THREE.Euler();
const _m = new THREE.Matrix4();

/**
 * Plants the TIBIA TIP (= the base of the tarsus) on `targetWorld`, then
 * lays the five tarsomeres flat along the surface so the animal stands on
 * its feet instead of spearing the panel with its shins.
 *
 * `surfaceNormal` is in world space.
 */
export function solveLeg(leg, targetWorld, thorax, surfaceNormal, opts = {}) {
  const kneeUp = opts.kneeUp !== undefined ? opts.kneeUp : 1;
  const flatten = opts.flatten !== undefined ? opts.flatten : 1;

  // target into the leg-root's parent space (the thorax)
  _v.copy(targetWorld);
  thorax.worldToLocal(_v);
  _v.sub(leg.root.position);

  const dist = _v.length();
  if (dist < 1e-6) return;

  // aim: yaw about Y then pitch about X (rotation.order is YXZ)
  const yaw = Math.atan2(_v.x, _v.z);
  const pitch = -Math.asin(clamp(_v.y / dist, -1, 1));
  leg.root.rotation.set(pitch, yaw, 0, 'YXZ');

  // --- coxal roll -------------------------------------------------------
  // Everything below the coxa hinges on one axis, so the limb lives in a
  // single plane. A real insect rolls the whole leg at the coxa until that
  // plane contains the surface normal, which is what lets the tarsus lie
  // flat on a panel that is not square to the body. Rolling about the aim
  // axis does not move the foot, so the reach solution stays valid.
  thorax.getWorldQuaternion(_q).invert();
  _v2.copy(surfaceNormal).applyQuaternion(_q);           // -> thorax space
  _q.setFromEuler(_e.set(pitch, yaw, 0, 'YXZ')).invert();
  _v2.applyQuaternion(_q).normalize();                   // -> pre-roll frame
  const roll = Math.atan2(-_v2.x, _v2.y);
  leg.root.rotation.z = roll;
  // after the roll the normal is (0, m, nz) in the leg plane
  const nY = Math.hypot(_v2.x, _v2.y);
  const nZ = _v2.z;

  // planar two-link solve from the end of the trochanter
  const base = leg.lens.coxa + leg.lens.troch;
  const L1 = leg.lens.femur;
  const L2 = leg.lens.tibia;
  let d = dist - base;

  const reach = L1 + L2;
  const inner = Math.abs(L1 - L2);
  d = clamp(d, inner + 1e-4, reach - 1e-4);

  const cosKnee = clamp((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1);
  const knee = Math.acos(cosKnee);                 // interior angle
  const cosB1 = clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1);
  const b1 = Math.acos(cosB1);

  leg.coxa.rotation.x = 0;
  leg.troch.rotation.x = 0;
  leg.femur.rotation.x = -kneeUp * b1;
  leg.tibia.rotation.x = kneeUp * (Math.PI - knee);

  // --- lay the tarsus along the surface -------------------------------
  const n = leg.tarsomeres.length;

  // tangent = aim direction with the normal component removed, expressed
  // in the (now rolled) leg plane
  _v3.set(0, -nY * nZ, 1 - nZ * nZ);
  if (_v3.lengthSq() < 1e-9) _v3.set(0, 0, 1);
  _v3.normalize();

  const tibiaPitch = -kneeUp * b1 + kneeUp * (Math.PI - knee);
  const wantPitch = Math.atan2(-_v3.y, _v3.z);
  let delta = wantPitch - tibiaPitch;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  // real tibia-tarsus joints are flexible but not unlimited
  delta = clamp(delta, -140 * Math.PI / 180, 140 * Math.PI / 180) * flatten;

  // The tibio-tarsal joint is the big hinge - in a real insect almost the
  // whole angle is taken there and the tarsus then runs nearly straight
  // along the surface. Spreading the bend evenly would leave the proximal
  // tarsomeres diving through the panel.
  //
  // The tarsomeres then add the panel curvature: over a surface of radius
  // R, travelling a distance l turns the tangent by l/R, so each segment
  // adds that much and the foot wraps the drum instead of bridging it.
  const curv = opts.curvature || 0;               // 1/R, 0 for a flat panel
  const aTar = tibiaPitch + delta;
  const dDot = (-Math.cos(aTar)) * nY + (-Math.sin(aTar)) * nZ;
  const wrapSign = dDot > 0 ? -1 : 1;
  const segFrac = [0.38, 0.22, 0.16, 0.13, 0.11];

  for (let i = 0; i < n; i++) {
    const segLen = leg.lens.tarsus * segFrac[i % 5];
    const wrap = wrapSign * curv * segLen * flatten;
    leg.tarsomeres[i].rotation.x = (i === 0 ? delta : 0) + wrap;
  }
  // claws curl in; extra give in the last joint is the tarsal compliance
  const give = opts.compliance || 0;
  leg.tarsomeres[n - 1].rotation.x += wrapSign * (0.18 + 0.22 * give) * flatten;
}

/**
 * Free-flight leg pose.
 *
 * A mosquito in the air is NOT a star of splayed limbs. The fore and mid
 * legs fold up into tight Z shapes and hang close under the thorax; the
 * hind pair streams straight out behind, past the tip of the abdomen,
 * angled slightly up. Those trailing hind legs are load-bearing for
 * stability - mosquitoes use them as aerodynamic feelers and lose roll
 * authority without them - and they are the single most recognisable
 * thing about a mosquito in flight.
 */
export function applyLegsFlight(rig, m, t, blend = 1, reach = 0) {
  const tuck = m.legTuckDeg * D;
  const trail = m.hindLegTrailDeg * D;
  // `reach` is the landing gear coming down. Mosquitoes hold the hind
  // legs BACKWARD in cruise and swing them FORWARD and down toward a
  // surface as they commit to landing - it is the clearest single tell
  // that a touchdown is about to happen, and its absence is why most
  // insect landings in games look like the animal is being dropped.
  const rch = clamp(reach, 0, 1);
  for (const leg of rig.legs) {
    const s = leg.side;
    let yaw, pitch, roll, femur, tibia, tarsus;
    const reachPitch = m.landingReachDeg * D;
    if (leg.pair === 2) {
      // hind: swept back and near straight in cruise, swung forward and
      // down to feel for the surface on approach
      yaw = lerp(s * (168 * D), s * (118 * D), rch);
      pitch = lerp(-0.10 - trail * 0.16, reachPitch, rch);
      roll = 0;
      femur = lerp(-0.16, -0.30, rch);
      tibia = lerp(0.30, 0.62, rch);
      tarsus = lerp(0.22, 0.10, rch);
    } else if (leg.pair === 1) {
      // mid: femur swings back and up, tibia folds forward under the thorax
      yaw = lerp(s * (78 * D), s * (92 * D), rch);
      pitch = lerp(0.62, reachPitch * 0.85, rch);
      roll = s * 0.30;
      femur = lerp(-tuck * 1.35, -0.45, rch);
      tibia = lerp(tuck * 2.25, 0.85, rch);
      tarsus = lerp(-tuck * 0.55, 0.05, rch);
    } else {
      // fore: folded tightest in cruise, extended last on approach
      yaw = lerp(s * (44 * D), s * (58 * D), rch);
      pitch = lerp(0.70, reachPitch * 0.7, rch);
      roll = s * 0.38;
      femur = lerp(-tuck * 1.45, -0.55, rch);
      tibia = lerp(tuck * 2.40, 1.05, rch);
      tarsus = lerp(-tuck * 0.70, 0.02, rch);
    }
    // passive flutter - limbs are never dead still in the air
    const fl = Math.sin(t * 6.1 + leg.pair * 1.7 + (s > 0 ? 0 : 0.9)) * 0.05;
    const fl2 = Math.sin(t * 9.3 + leg.pair * 2.1) * 0.03;

    leg.root.rotation.y = lerp(leg.root.rotation.y, yaw, blend);
    leg.root.rotation.x = lerp(leg.root.rotation.x, pitch + fl, blend);
    leg.root.rotation.z = lerp(leg.root.rotation.z, roll, blend);
    leg.coxa.rotation.x = lerp(leg.coxa.rotation.x, 0, blend);
    leg.troch.rotation.x = lerp(leg.troch.rotation.x, 0, blend);
    leg.femur.rotation.x = lerp(leg.femur.rotation.x, femur + fl2, blend);
    leg.tibia.rotation.x = lerp(leg.tibia.rotation.x, tibia + fl * 0.7, blend);
    const n = leg.tarsomeres.length;
    for (let i = 0; i < n; i++) {
      // the tarsus curls, it does not stay poker straight
      const curl = tarsus * (i === 0 ? 0.5 : 0.5 / (n - 1));
      leg.tarsomeres[i].rotation.x = lerp(leg.tarsomeres[i].rotation.x, curl + fl2 * 0.5, blend);
    }
  }
}

/* ======================================================================
 *  PROBOSCIS
 *
 *  The labium does not enter the target. As the fascicle is driven in,
 *  the labium buckles backwards into a bow and the labella stay pressed
 *  against the surface. Inside, the two maxillae act as alternating
 *  microsaws (~15 Hz) while the mandibles and labrum advance between
 *  saw strokes.
 * ====================================================================== */

export function applyProboscis(rig, m, S, state) {
  const {
    bow = 0,        // 0 = sheathed and straight, 1 = fully buckled
    extend = 0,     // fascicle travel, 0..1
    sawPhase = 0,   // 0..1 within a saw cycle
    drillSpin = 0,  // radians
    drilling = 0,   // 0..1 how hard it is boring
  } = state;

  const L = S.bodyLength;
  const pl = S.proboscisLength * L;

  // --- labium bow ------------------------------------------------------
  // Distribute the bend along the chain with the sharpest curvature just
  // distal to the base, which is what the high-speed footage shows.
  const n = rig.labiumJoints.length;
  const total = m.labiumBowDeg * D * bow;
  let wsum = 0;
  const ws = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const w = Math.exp(-Math.pow((t - 0.30) / 0.34, 2)) + 0.28;
    ws.push(w); wsum += w;
  }
  for (let i = 0; i < n; i++) {
    rig.labiumJoints[i].rotation.x = (ws[i] / wsum) * total;
    rig.labiumJoints[i].rotation.z = 0;
  }
  // Labella splay open and stay flat on the surface.
  const splay = bow * 0.55;
  if (rig.labellaL) {
    rig.labellaL.rotation.y = splay; rig.labellaL.rotation.z = -splay * 0.4;
    rig.labellaR.rotation.y = -splay; rig.labellaR.rotation.z = splay * 0.4;
  }
  if (rig.labella) rig.labella.rotation.x = -total * 0.22;

  // --- fascicle travel -------------------------------------------------
  const travel = pl * m.fascicleExtend * extend;
  rig.fascicle.position.z = travel;
  // As the labium bows away, the fascicle has to pitch down to stay
  // aimed at the hole it is cutting.
  rig.fascicle.rotation.x = total * 0.06;

  // --- alternating microsaws ------------------------------------------
  const sp = sawPhase - Math.floor(sawPhase);
  const stroke = pl * m.sawStroke * extend;
  const alt = m.maxillaAlternation;
  // left leads on the first half of the cycle, right on the second
  const lPush = Math.max(0, Math.sin(TAU * sp));
  const rPush = Math.max(0, Math.sin(TAU * sp + Math.PI * alt));
  if (rig.maxillae.length === 2) {
    rig.maxillae[0].position.z = stroke * lPush;
    rig.maxillae[1].position.z = stroke * rPush;
  }
  // mandibles + labrum creep forward between the saw strokes
  const creep = stroke * 0.45 * (0.5 + 0.5 * Math.sin(TAU * sp * 2 + Math.PI));
  for (const md of rig.mandibles) md.position.z = creep;
  if (rig.labrum) rig.labrum.position.z = creep * 0.8;
  if (rig.hypopharynx) rig.hypopharynx.position.z = creep * 0.9;

  // --- rotary boring head ---------------------------------------------
  rig.drill.rotation.z = drillSpin;
  const wob = m.drillWobbleDeg * D * drilling;
  rig.drill.rotation.x = Math.sin(drillSpin * 0.7) * wob;
  rig.drill.rotation.y = Math.cos(drillSpin * 0.7) * wob;
  if (rig.drillGlow) {
    rig.drillGlow.visible = drilling > 0.02;
    const s = 0.6 + 0.5 * drilling * (0.75 + 0.25 * Math.sin(drillSpin * 3.1));
    rig.drillGlow.scale.setScalar(s);
    rig.drillGlow.material.emissiveIntensity = 3.0 + 6.0 * drilling;
  }
}

/* ======================================================================
 *  ABDOMEN
 *  Distension while feeding plus the cibarial / pharyngeal pump, which
 *  run alternately at ~3-4 Hz and are clearly visible as peristalsis.
 * ====================================================================== */

/**
 * The two pumps.
 *
 * A mosquito has a cibarial pump in the head and a pharyngeal pump in the
 * thorax, and they run ALTERNATELY rather than together - that offset is
 * what makes a feeding mosquito look like it is working rather than
 * vibrating. Both chambers get their own node so they can pulse without
 * dragging the legs, wings or mouthparts with them.
 */
export function applyPumps(rig, m, pumpPhase, pumping) {
  const a = Math.sin(TAU * pumpPhase);
  const b = Math.sin(TAU * (pumpPhase + m.pumpPhaseOffset));
  const k = pumping * m.pumpStroke;
  if (rig.cibarialPump) {
    rig.cibarialPump.scale.set(1 + k * 0.55 * a, 1 + k * 0.7 * a, 1 - k * 0.2 * a);
  }
  if (rig.pharyngealPump) {
    rig.pharyngealPump.scale.set(1 + k * 0.22 * b, 1 + k * 0.30 * b, 1 - k * 0.1 * b);
  }
}

export function applyAbdomen(rig, m, S, { load, pumpPhase, pumping, droop }) {
  const segs = rig.abdomenSegs;
  const n = segs.length;
  const maxD = S.abdomenMaxDistension;

  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    // the anterior segments fill first and swell most
    const fillBias = clamp((load * 1.35) - t * 0.55, 0, 1);
    const radial = 1 + (Math.pow(maxD, 1 / 3) - 1) * fillBias;

    // peristaltic wave travelling aft from the pump
    const wave = pumping * m.pumpStroke *
      Math.sin(TAU * (pumpPhase - t * 0.55)) * (1 - t * 0.5);

    const s = segs[i];
    s.holder.scale.set(radial * (1 + wave * 0.35), radial * (1 + wave * 0.35), 1 + wave * 0.1);
    // segments separate as the abdomen fills
    if (i > 0) s.joint.position.z = (s.joint.userData.z0 ??= s.joint.position.z) * (1 + 0.42 * fillBias);
    // the loaded abdomen hangs
    s.joint.rotation.x = droop * (0.04 + 0.05 * t) + wave * 0.02;

    if (s.window) {
      s.window.material.opacity = clamp(fillBias * 0.9, 0, 0.9);
      s.window.material.emissiveIntensity = 0.3 + 0.9 * fillBias;
    }
  }
}
