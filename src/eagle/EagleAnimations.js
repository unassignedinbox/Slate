import * as THREE from 'three';

/**
 * Biomechanically Authentic Eagle 3D Animation Engine
 * Controls Flap, Glide, Walk, Idle, Screech, and Head Turn cycles
 * with complete secondary dynamics, joint kinematics, and GLTF clip generation.
 */
export class EagleAnimations {
  constructor(eagleModel) {
    this.model = eagleModel;
    this.bones = eagleModel.bones;

    // Animation state
    this.currentAnim = 'flap';
    this.targetAnim = 'flap';
    this.blendFactor = 1.0; // 0 (current) to 1 (target)
    this.transitionSpeed = 3.5; // Blend speed in 1/sec
    this.time = 0;
    this.playbackSpeed = 1.0;
    this.isPaused = false;

    // Dynamic secondary parameters
    this.secondaryMotion = {
      windIntensity: 1.0,
      breathingEnabled: true,
      headStabilization: true,
      featherFlutter: true
    };

    // Store base default bone transforms (rest pose)
    this.restPose = {};
    for (const [name, bone] of Object.entries(this.bones)) {
      this.restPose[name] = {
        pos: bone.position.clone(),
        rot: bone.rotation.clone(),
        quat: bone.quaternion.clone()
      };
    }

    // Animation state weights
    this.weights = {
      flap: 1.0,
      glide: 0.0,
      walk: 0.0,
      idle: 0.0,
      screech: 0.0,
      head_turn: 0.0
    };

    // Custom events
    this.onScreechTrigger = null;
    this.lastScreechPeak = false;
  }

  /**
   * Set target animation with smooth crossfading
   */
  play(animName, duration = 0.4) {
    if (!this.weights.hasOwnProperty(animName)) return;
    if (this.targetAnim === animName && this.blendFactor >= 1.0) return;

    this.currentAnim = this.targetAnim;
    this.targetAnim = animName;
    this.blendFactor = 0.0;
    this.transitionDuration = Math.max(0.05, duration);
  }

  /**
   * Main per-frame update loop
   */
  update(delta) {
    if (this.isPaused) return;

    const dt = delta * this.playbackSpeed;
    this.time += dt;

    // Update crossfade blend weights
    if (this.blendFactor < 1.0) {
      this.blendFactor += (dt / (this.transitionDuration || 0.4));
      if (this.blendFactor >= 1.0) {
        this.blendFactor = 1.0;
        this.currentAnim = this.targetAnim;
      }
    }

    // Recalculate weights for active animations
    for (const key of Object.keys(this.weights)) {
      if (key === this.targetAnim) {
        this.weights[key] = this.blendFactor;
      } else if (key === this.currentAnim) {
        this.weights[key] = 1.0 - this.blendFactor;
      } else {
        this.weights[key] = 0.0;
      }
    }

    // Reset bones to base rest pose
    for (const [name, bone] of Object.entries(this.bones)) {
      bone.position.copy(this.restPose[name].pos);
      bone.rotation.set(0, 0, 0);
    }

    // Evaluate each weighted animation layer
    if (this.weights.flap > 0.001) this.applyFlap(this.weights.flap);
    if (this.weights.glide > 0.001) this.applyGlide(this.weights.glide);
    if (this.weights.walk > 0.001) this.applyWalk(this.weights.walk);
    if (this.weights.idle > 0.001) this.applyIdle(this.weights.idle);
    if (this.weights.screech > 0.001) this.applyScreech(this.weights.screech);
    if (this.weights.head_turn > 0.001) this.applyHeadTurn(this.weights.head_turn);

    // Apply global secondary dynamics (breathing & aero-flutter)
    this.applySecondaryDynamics(dt);
  }

  /* =========================================================================
     1. FLAPPING FLIGHT CYCLE
     - Downstroke: Wings fully spread, pronated (forward tilt), high lift, body rises
     - Upstroke: Wrist & elbow fold, supinated, wings retract, body sinks slightly
     - Head remains horizontally stabilized; Tail depresses on downstroke
     ========================================================================= */
  applyFlap(weight) {
    const b = this.bones;
    const freq = 1.8; // 1.8 flaps per second (authentic large eagle cadence)
    const phase = (this.time * freq * Math.PI * 2) % (Math.PI * 2);

    // Kinematic flap curve: downstroke is faster and more explosive (0.0 to 0.45), upstroke is recovery (0.45 to 1.0)
    const sinP = Math.sin(phase);
    const cosP = Math.cos(phase);

    // Downstroke factor: +1 at deepest downstroke, -1 at peak upstroke
    const stroke = Math.sin(phase);
    const isDownstroke = cosP > 0;

    // Body heave (vertical bobbing) & pitch oscillation
    b.root.position.y += weight * (0.08 * -stroke);
    b.root.rotation.x += weight * (0.06 * stroke); // Pitch up during power downstroke

    // Left and Right Wings
    ['L', 'R'].forEach(side => {
      const sign = side === 'L' ? 1 : -1;
      const sh = b[`shoulder_${side}`];
      const hum = b[`humerus_${side}`];
      const elb = b[`elbow_${side}`];
      const wr = b[`wrist_${side}`];
      const tip = b[`wingtip_${side}`];
      const alu = b[`alula_${side}`];

      // Shoulder flapping arc (-35° to +42°)
      sh.rotation.z += weight * sign * (-stroke * 0.65);
      // Shoulder pronation / supination (forward tilt on downstroke)
      sh.rotation.y += weight * sign * (cosP * 0.22);
      sh.rotation.x += weight * (-stroke * 0.15);

      // Humerus articulation
      hum.rotation.z += weight * sign * (-stroke * 0.25);
      hum.rotation.y += weight * sign * (stroke > 0 ? 0.15 : -0.2); // Fold elbow on upstroke

      // Elbow folding during recovery upstroke (flexion)
      if (stroke < 0) {
        // Upstroke: fold wings in to reduce aerodynamic drag
        elb.rotation.z += weight * sign * (-stroke * 0.55);
        elb.rotation.y += weight * sign * (-stroke * 0.45);
        wr.rotation.z += weight * sign * (-stroke * 0.4);
      } else {
        // Downstroke: full extension
        elb.rotation.z += weight * sign * (-stroke * 0.1);
        elb.rotation.y += weight * sign * (stroke * 0.1);
        wr.rotation.z += weight * sign * (-stroke * 0.15);
      }

      // Aero-elastic wingtip lag / flex (Secondary aerodynamic flutter)
      tip.rotation.z += weight * sign * (cosP * 0.35);
      tip.rotation.x += weight * (stroke * 0.25);

      // Alula flare during transition
      alu.rotation.z += weight * sign * (Math.max(0, -cosP) * 0.3);
    });

    // Tail: Counterbalances wing pitch moments (depresses on downstroke, flares on upstroke)
    b.tail_base.rotation.x += weight * (-stroke * 0.18 + 0.05);
    b.tail_tip.rotation.x += weight * (-stroke * 0.12);

    // Legs: Streamlined backward tuck during flight
    ['L', 'R'].forEach(side => {
      const sign = side === 'L' ? 1 : -1;
      b[`hip_${side}`].rotation.x += weight * 0.75; // Tucked back along body
      b[`knee_${side}`].rotation.x += weight * 0.85;
      b[`foot_${side}`].rotation.x += weight * 0.45;
      // Claws relaxed streamlined
      b[`toe_hallux_${side}`].rotation.x += weight * -0.2;
      b[`toe_mid_${side}`].rotation.x += weight * 0.2;
    });

    // Head Vestibulo-Ocular Stabilization (head stays locked forward even as body bobs)
    if (this.secondaryMotion.headStabilization) {
      b.neck_1.rotation.x += weight * (-b.root.rotation.x * 0.5);
      b.neck_2.rotation.x += weight * (-b.root.rotation.x * 0.3);
      b.head.rotation.x += weight * (-b.root.rotation.x * 0.4);
    }
  }

  /* =========================================================================
     2. GLIDE / SOARING CYCLE
     - Majestic dihedral V-wing posture (8-10° upward angle)
     - Organic turbulence flutter on slotted primary finger feathers
     - Subtle banking / rolling trim adjustments and pitch micro-tuning
     ========================================================================= */
  applyGlide(weight) {
    const b = this.bones;
    const t = this.time;

    // Gentle thermal atmospheric draft oscillations
    const bankWave = Math.sin(t * 0.6) * 0.06;
    const pitchWave = Math.sin(t * 0.4 + 1.0) * 0.03;
    const windBuffet = Math.sin(t * 3.5) * 0.02 * this.secondaryMotion.windIntensity;

    // Body soaring attitude
    b.root.position.y += weight * (Math.sin(t * 0.8) * 0.04);
    b.root.rotation.z += weight * bankWave;
    b.root.rotation.x += weight * (0.02 + pitchWave);

    // Dihedral V-Wing Attitude
    ['L', 'R'].forEach(side => {
      const sign = side === 'L' ? 1 : -1;
      const sh = b[`shoulder_${side}`];
      const hum = b[`humerus_${side}`];
      const elb = b[`elbow_${side}`];
      const wr = b[`wrist_${side}`];
      const tip = b[`wingtip_${side}`];

      // Dihedral angle (wings tilted slightly upward 8-12 degrees)
      sh.rotation.z += weight * sign * (0.16 + windBuffet);
      sh.rotation.y += weight * sign * 0.04;
      sh.rotation.x += weight * 0.02;

      // Full aerodynamic span extension
      hum.rotation.z += weight * sign * 0.05;
      elb.rotation.z += weight * sign * 0.02;
      wr.rotation.z += weight * sign * 0.04;

      // Primary Feather Slotted Finger Flutter in Turbulent Updrafts
      const featherTurbulence = Math.sin(t * 5.0 + (side === 'L' ? 0 : 1.2)) * 0.08 * this.secondaryMotion.windIntensity;
      tip.rotation.z += weight * sign * (0.06 + featherTurbulence);
      tip.rotation.x += weight * (featherTurbulence * 0.7);

      // Differential roll trimming (slight asymmetric wing flex for banking)
      if (side === 'L') {
        wr.rotation.x += weight * (bankWave * 0.8);
      } else {
        wr.rotation.x -= weight * (bankWave * 0.8);
      }
    });

    // Tail Rudder & Elevator Trim
    b.tail_base.rotation.x += weight * (0.08 - pitchWave * 1.5);
    b.tail_base.rotation.y += weight * (-bankWave * 1.2); // Tail acts as rudder

    // Flight Tucked Legs
    ['L', 'R'].forEach(side => {
      b[`hip_${side}`].rotation.x += weight * 0.8;
      b[`knee_${side}`].rotation.x += weight * 0.9;
      b[`foot_${side}`].rotation.x += weight * 0.4;
    });

    // Alert Forward Horizon Gaze
    b.head.rotation.x += weight * -0.04;
    b.head.rotation.z += weight * -bankWave;
  }

  /* =========================================================================
     3. WALK CYCLE (GROUND LOCOMOTION)
     - Realistic heavy raptor ground swagger / waddle
     - Alternating foot liftoff, claw curl in swing, toe spread on impact
     - Lateral hip sway, avian saccadic head bobbing
     - Wings folded tight along flanks with subtle balance shifts
     ========================================================================= */
  applyWalk(weight) {
    const b = this.bones;
    const speed = 2.4; // Cadence
    const phase = (this.time * speed * Math.PI) % (Math.PI * 2);

    const sinP = Math.sin(phase);
    const cosP = Math.cos(phase);

    // Lower root closer to ground for walking
    b.root.position.y += weight * (-0.48 + Math.abs(cosP) * 0.04);
    // Lateral hip waddle swagger
    b.root.rotation.z += weight * (sinP * 0.08);
    b.root.rotation.y += weight * (sinP * 0.06);
    b.root.rotation.x += weight * 0.12; // Forward tilt when walking

    // Left and Right Legs Alternating Gait
    ['L', 'R'].forEach(side => {
      const sign = side === 'L' ? 1 : -1;
      const legPhase = phase + (side === 'L' ? 0 : Math.PI);
      const legSin = Math.sin(legPhase);
      const legCos = Math.cos(legPhase);

      const hip = b[`hip_${side}`];
      const thigh = b[`thigh_${side}`];
      const knee = b[`knee_${side}`];
      const foot = b[`foot_${side}`];

      // Stride kinematics
      hip.rotation.x += weight * (legSin * 0.45 - 0.2);
      thigh.rotation.x += weight * (legSin * 0.25);
      
      // Knee flexion during swing phase (lift foot off ground)
      const isSwing = legCos > 0;
      if (isSwing) {
        knee.rotation.x += weight * (legCos * 0.65 - 0.1);
        foot.rotation.x += weight * (-legCos * 0.4);

        // Claws curl slightly inward during swing to avoid ground dragging
        b[`toe_hallux_${side}`].rotation.x += weight * 0.3;
        b[`toe_mid_${side}`].rotation.x += weight * 0.35;
      } else {
        // Stance phase (weight bearing, foot flat and gripping ground)
        knee.rotation.x += weight * -0.15;
        foot.rotation.x += weight * 0.1;
        // Toes spread wide on ground contact
        b[`toe_inner_${side}`].rotation.y += weight * sign * 0.15;
        b[`toe_outer_${side}`].rotation.y += weight * sign * -0.15;
      }
    });

    // Folded Wings along body with subtle balance swaying
    ['L', 'R'].forEach(side => {
      const sign = side === 'L' ? 1 : -1;
      const sh = b[`shoulder_${side}`];
      const hum = b[`humerus_${side}`];
      const elb = b[`elbow_${side}`];
      const wr = b[`wrist_${side}`];

      // Folded back wing pose
      sh.rotation.set(weight * 0.4, weight * sign * -0.6, weight * sign * -0.8);
      hum.rotation.set(weight * 0.2, weight * sign * 0.8, weight * sign * 0.5);
      elb.rotation.set(weight * -0.3, weight * sign * -1.2, weight * sign * -0.6);
      wr.rotation.set(weight * 0.2, weight * sign * 0.4, weight * sign * 0.3);

      // Subtle dynamic counter-sway
      sh.rotation.x += weight * (cosP * 0.05 * (side === 'L' ? 1 : -1));
    });

    // Avian Saccadic Head Bobbing (head thrusts forward then holds position)
    const headBob = Math.sin(phase * 2) * 0.08;
    b.neck_1.rotation.x += weight * (headBob * 0.6);
    b.neck_2.rotation.x += weight * (headBob * 0.4);
    b.head.rotation.x += weight * (-headBob * 0.8 - 0.12);

    // Tail swagger
    b.tail_base.rotation.y += weight * (-sinP * 0.12);
    b.tail_base.rotation.x += weight * 0.2;
  }

  /* =========================================================================
     4. IDLE / PERCHED POSTURE
     - Folded wings resting neatly over mantle and flanks
     - Deep rhythmic respiration (chest expanding)
     - Alert micro-saccadic head glances and scanning
     - Tail feather settling and talon grip micro-adjustments
     ========================================================================= */
  applyIdle(weight) {
    const b = this.bones;
    const t = this.time;

    // Lower root for perched stance
    b.root.position.y += weight * -0.45;
    b.root.rotation.x += weight * 0.15;

    // Respiration breathing expansion (0.25 Hz slow breath)
    const breath = Math.sin(t * 1.5) * 0.03;
    b.chest.scale.set(1 + breath * 0.4, 1 + breath * 0.5, 1 + breath * 0.4);
    b.chest.rotation.x += weight * (breath * 0.3);

    // Natural raptor alert micro-saccades (random sharp looking twitches)
    const saccade1 = Math.sin(t * 0.8) * Math.sin(t * 1.7);
    const saccadeX = Math.sin(t * 0.5) * 0.08;
    const saccadeY = Math.sin(t * 0.7 + Math.sin(t * 2)) * 0.18;

    b.neck_1.rotation.y += weight * (saccadeY * 0.3);
    b.neck_2.rotation.y += weight * (saccadeY * 0.3);
    b.head.rotation.y += weight * (saccadeY * 0.4);
    b.head.rotation.x += weight * (saccadeX - 0.1);
    b.head.rotation.z += weight * (Math.sin(t * 1.1) * 0.04); // Inquisitive head tilt

    // Neatly Folded Wings Resting on Body
    ['L', 'R'].forEach(side => {
      const sign = side === 'L' ? 1 : -1;
      b[`shoulder_${side}`].rotation.set(weight * 0.45, weight * sign * -0.65, weight * sign * -0.85);
      b[`humerus_${side}`].rotation.set(weight * 0.25, weight * sign * 0.85, weight * sign * 0.55);
      b[`elbow_${side}`].rotation.set(weight * -0.35, weight * sign * -1.25, weight * sign * -0.65);
      b[`wrist_${side}`].rotation.set(weight * 0.25, weight * sign * 0.45, weight * sign * 0.35);
    });

    // Tail resting downward
    b.tail_base.rotation.x += weight * 0.32;
    b.tail_base.rotation.y += weight * (Math.sin(t * 0.6) * 0.02);

    // Perched gripping talons
    ['L', 'R'].forEach(side => {
      b[`hip_${side}`].rotation.x += weight * -0.35;
      b[`thigh_${side}`].rotation.x += weight * 0.45;
      b[`knee_${side}`].rotation.x += weight * -0.55;
      b[`foot_${side}`].rotation.x += weight * 0.25;

      // Curved claws grasping perch
      b[`toe_hallux_${side}`].rotation.x += weight * -0.45;
      b[`toe_inner_${side}`].rotation.x += weight * 0.35;
      b[`toe_mid_${side}`].rotation.x += weight * 0.42;
      b[`toe_outer_${side}`].rotation.x += weight * 0.35;
    });
  }

  /* =========================================================================
     5. SCREECH ANIMATION (MAJESTIC RAPTOR CRY)
     - Anticipation: Pulls head back, expands chest
     - Vocalization Climax: Thrusts head/neck forward & up, BEAK SNAPS WIDE OPEN (45°),
       vibrating tongue and throat, wings flare out, tail fans out
     - Synchronized Audio Screech Sound!
     - Recovery back to alert posture
     ========================================================================= */
  applyScreech(weight) {
    const b = this.bones;
    const dur = 2.4; // 2.4 second screech cycle
    const p = (this.time % dur) / dur; // 0.0 to 1.0

    let neckExt = 0, neckPitch = 0, gape = 0, throatVibe = 0, wingFlare = 0, tailSpread = 0;

    if (p < 0.2) {
      // 1. Anticipation (0.0 to 0.2): Draw back, inhale
      const tNorm = p / 0.2;
      neckExt = -0.05 * tNorm;
      neckPitch = 0.1 * tNorm;
      gape = 0.05 * tNorm;
    } else if (p < 0.7) {
      // 2. Vocalization Screech Climax (0.2 to 0.7): Powerful thrust & wide open beak
      const tNorm = (p - 0.2) / 0.5;
      const intensity = Math.sin(tNorm * Math.PI);
      neckExt = 0.12 * intensity;
      neckPitch = -0.45 * intensity; // Tilt head up to scream to the skies
      gape = 0.65 * intensity; // Open mandible wide (45 degrees!)
      throatVibe = Math.sin(this.time * 45) * 0.05 * intensity; // High frequency throat tremor
      wingFlare = 0.35 * intensity;
      tailSpread = 0.25 * intensity;

      // Screech audio peak trigger
      if (intensity > 0.6 && !this.lastScreechPeak) {
        this.lastScreechPeak = true;
        if (this.onScreechTrigger) this.onScreechTrigger();
      }
    } else {
      // 3. Recovery (0.7 to 1.0): Close beak, settle feathers
      this.lastScreechPeak = false;
      const tNorm = (p - 0.7) / 0.3;
      const decay = 1.0 - tNorm;
      neckExt = 0.02 * decay;
      neckPitch = -0.1 * decay;
      gape = 0.1 * decay;
    }

    // Apply Mandible Open Gape (exposes inner mouth cavity and tongue)
    b.jaw_lower.rotation.x += weight * (gape * 0.85);

    // Neck Thrust & Pitch
    b.neck_1.position.z += weight * (-neckExt * 0.5);
    b.neck_1.rotation.x += weight * (neckPitch * 0.3 + throatVibe);
    b.neck_2.rotation.x += weight * (neckPitch * 0.4);
    b.neck_3.rotation.x += weight * (neckPitch * 0.3);
    b.head.rotation.x += weight * (neckPitch * 0.5 + throatVibe * 1.5);

    // Chest expansion & throat vibration
    b.chest.scale.set(1 + weight * (gape * 0.3), 1 + weight * (gape * 0.35), 1 + weight * (gape * 0.2));

    // Wings flare slightly outward in magnificent raptor dominance display
    ['L', 'R'].forEach(side => {
      const sign = side === 'L' ? 1 : -1;
      b[`shoulder_${side}`].rotation.z += weight * sign * (wingFlare * 0.4);
      b[`shoulder_${side}`].rotation.y += weight * sign * (-wingFlare * 0.3);
      b[`elbow_${side}`].rotation.z += weight * sign * (wingFlare * 0.3);
      b[`wingtip_${side}`].rotation.z += weight * sign * (wingFlare * 0.4 + throatVibe);
    });

    // Tail fans and depresses
    b.tail_base.rotation.x += weight * (tailSpread * 0.4);
  }

  /* =========================================================================
     6. HEAD TURN / SCANNING ANIMATION
     - Rapid saccadic predator surveillance motion
     - 85° sharp snap to left, 0.8s focus pause with monocular ground inspection tilt
     - 170° crisp swing across to right, downward angle inspection
     - Smooth return to forward horizon
     ========================================================================= */
  applyHeadTurn(weight) {
    const b = this.bones;
    const dur = 4.0; // 4.0 second surveillance sequence
    const p = (this.time % dur) / dur;

    let targetYaw = 0;
    let targetPitch = 0;
    let targetRoll = 0;

    if (p < 0.25) {
      // Snap to Left (Look at ground/prey on left)
      const tNorm = Math.min(1.0, (p / 0.1) * 1.0); // Fast saccade
      targetYaw = THREE.MathUtils.lerp(0, 1.35, tNorm); // ~77 degrees
      targetPitch = -0.15;
      targetRoll = 0.12; // Inquisitive tilt
    } else if (p < 0.45) {
      // Hold Left focus
      targetYaw = 1.35 + Math.sin(this.time * 2) * 0.05;
      targetPitch = -0.18 + Math.sin(this.time * 3) * 0.03;
      targetRoll = 0.14;
    } else if (p < 0.70) {
      // Saccade swing across from Left to Right
      const tNorm = Math.min(1.0, ((p - 0.45) / 0.12) * 1.0);
      targetYaw = THREE.MathUtils.lerp(1.35, -1.40, tNorm); // Swing to ~ -80 degrees
      targetPitch = -0.22;
      targetRoll = -0.15;
    } else if (p < 0.88) {
      // Hold Right focus
      targetYaw = -1.40 + Math.sin(this.time * 2) * 0.04;
      targetPitch = -0.24;
      targetRoll = -0.15;
    } else {
      // Return to Center forward
      const tNorm = Math.min(1.0, ((p - 0.88) / 0.1) * 1.0);
      targetYaw = THREE.MathUtils.lerp(-1.40, 0, tNorm);
      targetPitch = THREE.MathUtils.lerp(-0.24, -0.05, tNorm);
      targetRoll = THREE.MathUtils.lerp(-0.15, 0, tNorm);
    }

    // Distribute rotation naturally across the 3 cervical neck vertebrae and head
    b.neck_1.rotation.y += weight * (targetYaw * 0.25);
    b.neck_2.rotation.y += weight * (targetYaw * 0.35);
    b.neck_3.rotation.y += weight * (targetYaw * 0.25);
    b.head.rotation.y += weight * (targetYaw * 0.15);

    b.neck_2.rotation.x += weight * (targetPitch * 0.5);
    b.head.rotation.x += weight * (targetPitch * 0.5);

    b.head.rotation.z += weight * targetRoll;

    // Body maintains poised perched posture
    this.applyIdle(weight * 0.7);
  }

  /* =========================================================================
     SECONDARY DYNAMICS ENGINE
     - Breathing chest expansion
     - Aerodynamic micro-flutter on primary flight feathers and tail
     ========================================================================= */
  applySecondaryDynamics(dt) {
    const t = this.time;
    const b = this.bones;

    // Breathing dynamics
    if (this.secondaryMotion.breathingEnabled) {
      const breath = Math.sin(t * 1.6) * 0.015;
      b.chest.scale.y *= (1 + breath);
      b.chest.scale.x *= (1 + breath * 0.8);
    }

    // High frequency primary flight feather wind flutter
    if (this.secondaryMotion.featherFlutter) {
      const flutter = Math.sin(t * 18.0) * 0.015 * this.secondaryMotion.windIntensity;
      ['L', 'R'].forEach(side => {
        const sign = side === 'L' ? 1 : -1;
        b[`wingtip_${side}`].rotation.z += sign * flutter;
      });
      b.tail_tip.rotation.x += Math.cos(t * 14.0) * 0.012 * this.secondaryMotion.windIntensity;
    }
  }

  /**
   * Generate Three.js AnimationClip for GLTF/GLB Export
   */
  generateAnimationClip(animName, duration = 1.0, fps = 30) {
    const totalFrames = Math.floor(duration * fps);
    const tracks = [];
    const boneNames = Object.keys(this.bones);

    // Sample transforms at each frame
    const originalTime = this.time;
    const originalCurrent = this.currentAnim;
    const originalTarget = this.targetAnim;
    const originalBlend = this.blendFactor;

    this.currentAnim = animName;
    this.targetAnim = animName;
    this.blendFactor = 1.0;

    // Sample data structures
    const boneData = {};
    boneNames.forEach(name => {
      boneData[name] = {
        times: [],
        positions: [],
        rotations: [],
        scales: []
      };
    });

    for (let f = 0; f <= totalFrames; f++) {
      const t = (f / totalFrames) * duration;
      this.time = t;

      // Force evaluate exact animation
      for (const [name, bone] of Object.entries(this.bones)) {
        bone.position.copy(this.restPose[name].pos);
        bone.rotation.set(0, 0, 0);
        bone.scale.set(1, 1, 1);
      }

      if (animName === 'flap') this.applyFlap(1.0);
      else if (animName === 'glide') this.applyGlide(1.0);
      else if (animName === 'walk') this.applyWalk(1.0);
      else if (animName === 'idle') this.applyIdle(1.0);
      else if (animName === 'screech') this.applyScreech(1.0);
      else if (animName === 'head_turn') this.applyHeadTurn(1.0);

      this.applySecondaryDynamics(0.016);

      // Record keyframes
      boneNames.forEach(name => {
        const bone = this.bones[name];
        boneData[name].times.push(t);
        boneData[name].positions.push(bone.position.x, bone.position.y, bone.position.z);

        const q = new THREE.Quaternion().setFromEuler(bone.rotation);
        boneData[name].rotations.push(q.x, q.y, q.z, q.w);
        boneData[name].scales.push(bone.scale.x, bone.scale.y, bone.scale.z);
      });
    }

    // Build tracks
    boneNames.forEach(name => {
      const d = boneData[name];
      const posTrack = new THREE.VectorKeyframeTrack(`${name}.position`, d.times, d.positions);
      const rotTrack = new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, d.times, d.rotations);
      const scaleTrack = new THREE.VectorKeyframeTrack(`${name}.scale`, d.times, d.scales);
      tracks.push(posTrack, rotTrack, scaleTrack);
    });

    // Restore state
    this.time = originalTime;
    this.currentAnim = originalCurrent;
    this.targetAnim = originalTarget;
    this.blendFactor = originalBlend;

    return new THREE.AnimationClip(animName, duration, tracks);
  }

  /**
   * Get all AnimationClips for export
   */
  getAllAnimationClips() {
    return [
      this.generateAnimationClip('flap', 1.0, 30),
      this.generateAnimationClip('glide', 3.0, 30),
      this.generateAnimationClip('walk', 1.2, 30),
      this.generateAnimationClip('idle', 4.0, 30),
      this.generateAnimationClip('screech', 2.4, 30),
      this.generateAnimationClip('head_turn', 4.0, 30)
    ];
  }
}
