import * as THREE from 'three';
import { EagleRigNodes } from './EagleRig';

export type AnimationType = 'flap' | 'glide' | 'walk' | 'idle' | 'screech' | 'head_turn';

export interface PoseState {
  [nodeName: string]: {
    position?: THREE.Vector3;
    rotation?: THREE.Euler;
    scale?: THREE.Vector3;
  };
}

export class AnimationEngine {
  public currentAnim: AnimationType = 'flap';
  public prevAnim: AnimationType = 'flap';
  public transitionProgress = 1.0;
  public transitionDuration = 0.35; // seconds

  public speed = 1.0;
  public isPaused = false;
  public time = 0;
  public normalizedPhase = 0;

  // Interactive Cursor Look-At Target (Normalized -1 to +1)
  public cursorTarget: THREE.Vector2 = new THREE.Vector2(0, 0);
  public isCursorTracking = false;

  // Secondary motion & spring damper states
  private wingtipFlexL = 0;
  private wingtipFlexR = 0;
  private headLag = new THREE.Euler();
  private tailFlutter = 0;
  private nictitatingTimer = 0;

  // Screech trigger timestamp & intensity
  public screechTriggerTime = 0;
  public isScreeching = false;

  constructor() {}

  public playAnimation(name: AnimationType): void {
    if (this.currentAnim === name && this.transitionProgress >= 1.0) return;
    this.prevAnim = this.currentAnim;
    this.currentAnim = name;
    this.transitionProgress = 0.0;
    if (name === 'screech') {
      this.isScreeching = true;
      this.screechTriggerTime = this.time;
    }
  }

  public update(delta: number, rig: EagleRigNodes): void {
    if (!this.isPaused) {
      this.time += delta * this.speed;
    }

    if (this.transitionProgress < 1.0) {
      this.transitionProgress = Math.min(1.0, this.transitionProgress + delta / this.transitionDuration);
    }

    // Evaluate primary current animation
    this.evaluatePose(this.currentAnim, this.time, rig, 1.0);

    // Apply secondary aerodynamic & inertia physics
    this.applySecondaryPhysics(delta, rig);

    // Update eye blinking and nictitating membrane
    this.updateEyeMechanisms(delta, rig);
  }

  /**
   * Main pose evaluation based on avian biomechanics formulas.
   */
  private evaluatePose(anim: AnimationType, t: number, rig: EagleRigNodes, weight = 1.0): void {
    switch (anim) {
      case 'flap':
        this.evaluateFlapCycle(t, rig);
        break;
      case 'glide':
        this.evaluateGlideCycle(t, rig);
        break;
      case 'walk':
        this.evaluateWalkCycle(t, rig);
        break;
      case 'idle':
        this.evaluateIdle(t, rig);
        break;
      case 'screech':
        this.evaluateScreech(t, rig);
        break;
      case 'head_turn':
        this.evaluateHeadTurn(t, rig);
        break;
    }
  }

  /**
   * 1. WING FLAP CYCLE
   * Biomechanical eagle flapping: Downstroke (power/lift) + Upstroke (wrist flexion/pronation).
   */
  private evaluateFlapCycle(t: number, rig: EagleRigNodes): void {
    const cycleFreq = 1.25; // ~1.25 Hz full cycle
    const phase = (t * cycleFreq) % 1.0;
    this.normalizedPhase = phase;

    // Body heave & pitch oscillation (climb on downstroke, sink on upstroke)
    const bodyHeave = Math.sin(phase * Math.PI * 2) * 0.14;
    const bodyPitch = -Math.cos(phase * Math.PI * 2) * 0.12;
    const bodyRoll = Math.sin(phase * Math.PI * 2) * 0.02;

    rig.root.position.set(0, 0.45 + bodyHeave, 0);
    rig.root.rotation.set(bodyPitch, 0, bodyRoll);

    // Flapping kinematic curve (downstroke is faster & more powerful than recovery upstroke)
    // Downstroke: phase 0.0 -> 0.45, Upstroke: phase 0.45 -> 1.0
    let flapStroke = 0;
    let wristFold = 0;
    let wingSpanStretch = 1.0;
    let wingTwist = 0; // Pronation

    if (phase < 0.45) {
      // Downstroke: powerful downward sweep, wings fully spread, slight forward sweep
      const p = phase / 0.45;
      flapStroke = Math.cos(p * Math.PI) * 0.65; // from +0.65 (high) down to -0.65 (low)
      wristFold = 0.08 * Math.sin(p * Math.PI); // minimal fold, maximum span
      wingSpanStretch = 1.0;
      wingTwist = 0.12 * Math.sin(p * Math.PI); // positive camber angle
    } else {
      // Upstroke: wings pulled in, wrist flexed, feathers slicing upward
      const p = (phase - 0.45) / 0.55;
      flapStroke = -Math.cos(p * Math.PI) * 0.65; // from -0.65 up to +0.65
      wristFold = Math.sin(p * Math.PI) * 0.62; // sharp wrist flexion
      wingSpanStretch = 1.0 - Math.sin(p * Math.PI) * 0.28; // span reduced to cut drag
      wingTwist = -0.35 * Math.sin(p * Math.PI); // feather pronation (slicing)
    }

    // Left Wing Rigging
    rig.shoulderL.rotation.set(-wingTwist, -0.15 + flapStroke * 0.2, flapStroke);
    rig.humerusL.rotation.set(0, 0, flapStroke * 0.4);
    rig.forearmL.rotation.set(0, 0, -flapStroke * 0.25 - wristFold * 0.3);
    rig.wristL.rotation.set(wingTwist * 0.5, -wristFold * 0.7, -wristFold * 0.8);
    rig.manusL.rotation.set(0, 0, -flapStroke * 0.35);

    // Right Wing Rigging (Symmetric Mirror)
    rig.shoulderR.rotation.set(-wingTwist, 0.15 - flapStroke * 0.2, -flapStroke);
    rig.humerusR.rotation.set(0, 0, -flapStroke * 0.4);
    rig.forearmR.rotation.set(0, 0, flapStroke * 0.25 + wristFold * 0.3);
    rig.wristR.rotation.set(wingTwist * 0.5, wristFold * 0.7, wristFold * 0.8);
    rig.manusR.rotation.set(0, 0, flapStroke * 0.35);

    // Individual Primary Feathers Dynamic Aero Splay (Outer primaries flex up on downstroke)
    const aeroLoad = Math.max(0, -flapStroke); // high during downstroke
    for (let p = 0; p < rig.primariesL.length; p++) {
      const pMod = (p / 9);
      const tipSplay = aeroLoad * (0.15 + pMod * 0.35);
      rig.primariesL[p].rotation.z = tipSplay;
      rig.primariesR[p].rotation.z = -tipSplay;
    }

    // Secondaries smooth airfoil curve
    for (let s = 0; s < rig.secondariesL.length; s++) {
      const sMod = Math.sin((s / 13) * Math.PI);
      rig.secondariesL[s].rotation.z = aeroLoad * 0.12 * sMod;
      rig.secondariesR[s].rotation.z = -aeroLoad * 0.12 * sMod;
    }

    // Alula dynamic flare
    rig.alulaL.rotation.z = flapStroke > 0.3 ? 0.3 : 0.05;
    rig.alulaR.rotation.z = flapStroke > 0.3 ? -0.3 : -0.05;

    // Tail Pitch & Fan oscillation (compensates for body pitch)
    const tailPitch = -bodyPitch * 1.5;
    const tailSpread = 0.2 + (1.0 - phase) * 0.15;
    rig.tailJoint.rotation.set(tailPitch, 0, 0);

    // Retrices fan modulation
    for (let r = 0; r < rig.retrices.length; r++) {
      const t = (r - 5.5) / 5.5;
      rig.retrices[r].rotation.y = Math.PI + t * (0.55 + tailSpread * 0.2);
    }

    // Head Stabilization (Vestibulo-ocular reflex - head stays horizontal)
    rig.neckBase.rotation.set(-bodyPitch * 0.6, 0, 0);
    rig.neckMid.rotation.set(-bodyPitch * 0.3, 0, 0);
    rig.head.rotation.set(-bodyPitch * 0.4, 0, 0);
    rig.beakLower.rotation.x = 0; // closed during normal flap

    // Legs tucked stream-lined under tail in flight
    this.setTuckedLegs(rig);
  }

  /**
   * 2. GLIDE CYCLE
   * Soaring in thermal updrafts: flat/dihedral wing plane, slotted tips, micro turbulence.
   */
  private evaluateGlideCycle(t: number, rig: EagleRigNodes): void {
    const cycleFreq = 0.5;
    const phase = (t * cycleFreq) % 1.0;
    this.normalizedPhase = phase;

    // Gentle thermal atmospheric draft oscillations
    const thermalHeave = Math.sin(t * 1.5) * 0.04 + Math.sin(t * 0.7) * 0.02;
    const thermalRoll = Math.sin(t * 0.8) * 0.06;
    const thermalPitch = Math.cos(t * 1.1) * 0.03 - 0.05; // slight nose-down glide path

    rig.root.position.set(0, 0.48 + thermalHeave, 0);
    rig.root.rotation.set(thermalPitch, 0, thermalRoll);

    // Wings held in slight dihedral V-angle (~4°)
    const dihedral = 0.08;
    const microFlutterL = Math.sin(t * 8.0) * 0.015 + Math.sin(t * 4.2) * 0.02;
    const microFlutterR = Math.cos(t * 7.5) * 0.015 + Math.sin(t * 4.5) * 0.02;

    rig.shoulderL.rotation.set(0.04, -0.05, dihedral + microFlutterL);
    rig.humerusL.rotation.set(0, 0, 0.02);
    rig.forearmL.rotation.set(0, 0, -0.01);
    rig.wristL.rotation.set(0.02, 0.02, 0.04);
    rig.manusL.rotation.set(0, 0, 0.03);

    rig.shoulderR.rotation.set(0.04, 0.05, -dihedral - microFlutterR);
    rig.humerusR.rotation.set(0, 0, -0.02);
    rig.forearmR.rotation.set(0, 0, 0.01);
    rig.wristR.rotation.set(0.02, -0.02, -0.04);
    rig.manusR.rotation.set(0, 0, -0.03);

    // Primaries slotted and splayed vertically in thermal airflow
    for (let p = 0; p < rig.primariesL.length; p++) {
      const pMod = p / 9;
      // High upward splay on outer feathers (P6-P10)
      const upwardSplay = 0.12 + Math.pow(pMod, 2) * 0.28 + Math.sin(t * 6.0 + p) * 0.02;
      rig.primariesL[p].rotation.z = upwardSplay;
      rig.primariesR[p].rotation.z = -upwardSplay;
    }

    // Tail Rudder Trim (subtle dynamic yaw/roll trim)
    const rudderYaw = Math.sin(t * 0.9) * 0.08;
    const rudderRoll = -thermalRoll * 0.8;
    const rudderPitch = 0.05 + Math.sin(t * 1.3) * 0.03;
    rig.tailJoint.rotation.set(rudderPitch, rudderYaw, rudderRoll);

    // Wide thermal tail fan
    for (let r = 0; r < rig.retrices.length; r++) {
      const tr = (r - 5.5) / 5.5;
      rig.retrices[r].rotation.y = Math.PI + tr * 0.72; // wide fan for thermal soaring
    }

    // Alert soaring head gaze (scanning forward and down)
    const headScan = Math.sin(t * 0.6) * 0.15;
    rig.neckBase.rotation.set(0.08, headScan * 0.5, 0);
    rig.neckMid.rotation.set(0.05, headScan * 0.3, 0);
    rig.head.rotation.set(-0.06, headScan * 0.6, -headScan * 0.2);

    this.setTuckedLegs(rig);
  }

  /**
   * 3. WALK CYCLE (ON GROUND)
   * Terrestrial locomotion: Alternating digitigrade stride, talon curling during swing, waddling body.
   */
  private evaluateWalkCycle(t: number, rig: EagleRigNodes): void {
    const cycleFreq = 1.0; // 1 step cycle per second
    const phase = (t * cycleFreq) % 1.0;
    this.normalizedPhase = phase;

    // Body lateral weight shift (waddle) and vertical bounce
    const bodyWaddle = Math.sin(phase * Math.PI * 2) * 0.07;
    const bodyBounce = -Math.abs(Math.sin(phase * Math.PI * 2)) * 0.035;
    const bodyPitch = 0.18 + Math.sin(phase * Math.PI * 4) * 0.03;

    rig.root.position.set(0, -0.08 + bodyBounce, bodyWaddle * 0.05);
    rig.root.rotation.set(bodyPitch, 0, -bodyWaddle * 0.8);

    // Folded Wings with rhythmic secondary bounce
    const wingBounce = Math.sin(phase * Math.PI * 4) * 0.04;
    this.setFoldedWings(rig, wingBounce);

    // Leg Phasing: Left Leg (0.0 to 1.0), Right Leg (offset by 0.5)
    this.evaluateLegWalk(phase, rig.hipL, rig.thighL, rig.kneeL, rig.shankL, rig.ankleL, rig.tarsusL, rig.footL, rig.halluxL, rig.midToeL, true);
    this.evaluateLegWalk((phase + 0.5) % 1.0, rig.hipR, rig.thighR, rig.kneeR, rig.shankR, rig.ankleR, rig.tarsusR, rig.footR, rig.halluxR, rig.midToeR, false);

    // Saccadic Avian Head-Bobbing (Hold-and-Thrust stabilization)
    // Raptor locks head position in space during stance, then snaps forward during swing
    const stepSubPhase = (phase * 2) % 1.0;
    let headThrust = 0;
    if (stepSubPhase < 0.65) {
      // Hold phase: head translates backwards relative to moving body
      headThrust = -0.06 * (stepSubPhase / 0.65);
    } else {
      // Thrust phase: rapid snap forward
      const p = (stepSubPhase - 0.65) / 0.35;
      headThrust = -0.06 + Math.sin(p * Math.PI * 0.5) * 0.09;
    }

    rig.neckBase.position.set(0.25 + headThrust, 0.12, 0);
    rig.neckBase.rotation.set(-0.15, 0, 0);
    rig.head.rotation.set(-0.05, 0, 0);

    // Tail held low, acting as counter-balance to walk waddle
    rig.tailJoint.rotation.set(-0.35, -bodyWaddle * 1.5, bodyWaddle * 0.5);
    for (let r = 0; r < rig.retrices.length; r++) {
      const tr = (r - 5.5) / 5.5;
      rig.retrices[r].rotation.y = Math.PI + tr * 0.35; // narrow tail fold
    }
  }

  /**
   * Helper for ground walking leg kinematics.
   */
  private evaluateLegWalk(
    phase: number,
    hip: THREE.Group,
    thigh: THREE.Group,
    knee: THREE.Group,
    shank: THREE.Group,
    ankle: THREE.Group,
    tarsus: THREE.Group,
    foot: THREE.Group,
    hallux: THREE.Group,
    midToe: THREE.Group,
    isLeft: boolean
  ): void {
    // Phase 0.0 -> 0.5: Swing Phase (Leg lifts, swings forward, talons curl)
    // Phase 0.5 -> 1.0: Stance Phase (Foot planted on ground, pushes backward)
    if (phase < 0.5) {
      const p = phase / 0.5; // 0 to 1
      const lift = Math.sin(p * Math.PI) * 0.12;
      const legForward = -Math.cos(p * Math.PI) * 0.45;

      thigh.rotation.z = legForward * 0.8 + 0.2;
      knee.rotation.z = -lift * 2.2 - 0.1;
      ankle.rotation.z = lift * 1.8 + legForward * 0.5;

      // Talon Curling during swing phase to avoid snagging rocks
      const talonCurl = Math.sin(p * Math.PI) * 0.5;
      hallux.rotation.z = -talonCurl;
      midToe.rotation.z = talonCurl;
    } else {
      const p = (phase - 0.5) / 0.5; // 0 to 1
      const legPush = Math.cos(p * Math.PI) * 0.45; // moves backward relative to body

      thigh.rotation.z = legPush * 0.6 + 0.2;
      knee.rotation.z = -0.15 + (1 - Math.sin(p * Math.PI)) * 0.1;
      ankle.rotation.z = -legPush * 0.5;

      // Talons spread flat on ground contact
      hallux.rotation.z = 0;
      midToe.rotation.z = 0;
    }
  }

  /**
   * 4. IDLE ANIMATION
   * Natural perched/standing posture: breathing cycle, weight shift, subtle glances, feather settling.
   */
  private evaluateIdle(t: number, rig: EagleRigNodes): void {
    const cycleFreq = 0.3; // slow natural cadence
    this.normalizedPhase = (t * cycleFreq) % 1.0;

    // Respiration: rhythmic expansion of chest/keel
    const breath = Math.sin(t * 1.8) * 0.035;
    rig.chest.scale.set(1.0 + breath * 0.8, 1.0 + breath, 1.0 + breath * 0.6);

    // Subtle weight shift between left and right feet every ~6 seconds
    const weightShift = Math.sin(t * 0.5) * 0.04;
    rig.root.position.set(0, -0.06, weightShift * 0.08);
    rig.root.rotation.set(0.12, 0, -weightShift * 0.4);

    // Folded Wings resting neatly on flanks
    this.setFoldedWings(rig, breath * 0.3);

    // Legs firmly perched on ground
    rig.thighL.rotation.set(0, 0, 0.25 - weightShift * 0.2);
    rig.kneeL.rotation.set(0, 0, -0.2);
    rig.ankleL.rotation.set(0, 0, 0.1);

    rig.thighR.rotation.set(0, 0, 0.25 + weightShift * 0.2);
    rig.kneeR.rotation.set(0, 0, -0.2);
    rig.ankleR.rotation.set(0, 0, 0.1);

    // Natural ambient head glances
    const headNod = Math.sin(t * 1.2) * 0.04;
    const headYaw = Math.sin(t * 0.4) * 0.25 + Math.sin(t * 0.15) * 0.15;
    const headTilt = Math.sin(t * 0.7) * 0.08;

    rig.neckBase.rotation.set(-0.08 + headNod * 0.5, headYaw * 0.4, 0);
    rig.neckMid.rotation.set(0.04, headYaw * 0.3, headTilt * 0.5);
    rig.head.rotation.set(headNod, headYaw * 0.5, headTilt);

    // Beak closed
    rig.beakLower.rotation.x = 0;

    // Tail resting folded
    rig.tailJoint.rotation.set(-0.45, weightShift * 0.5, 0);
    for (let r = 0; r < rig.retrices.length; r++) {
      const tr = (r - 5.5) / 5.5;
      rig.retrices[r].rotation.y = Math.PI + tr * 0.32;
    }
  }

  /**
   * 5. SCREECH ANIMATION
   * Aggressive / territorial vocal display: lowered chest, craned neck, wide beak gape, throat swell, half-flared wings, tremor.
   */
  private evaluateScreech(t: number, rig: EagleRigNodes): void {
    const elapsed = (t - this.screechTriggerTime) % 3.0; // 3.0 second dramatic loop
    const p = elapsed / 3.0;
    this.normalizedPhase = p;

    let gape = 0;
    let neckCraning = 0;
    let throatSwell = 1.0;
    let mantleFlare = 0;
    let tremor = 0;

    if (p < 0.2) {
      // Anticipation / Inhalation: body crouches slightly, neck pulls back
      const sub = p / 0.2;
      neckCraning = -0.15 * Math.sin(sub * Math.PI);
      gape = 0.1 * sub;
      mantleFlare = 0.2 * sub;
    } else if (p < 0.75) {
      // Climax Screech: Beak wide open, neck thrust forward, throat pulsing, wings mantled, body trembling
      const sub = (p - 0.2) / 0.55;
      gape = 0.85 + Math.sin(sub * Math.PI * 18) * 0.08; // >45 degree gape with acoustic oscillation
      neckCraning = 0.45 * Math.sin(sub * Math.PI);
      throatSwell = 1.45 + Math.sin(sub * Math.PI * 24) * 0.15; // pulsating vocal sac
      mantleFlare = 0.75 * Math.sin(sub * Math.PI);
      tremor = (Math.random() - 0.5) * 0.035; // visceral vocal tremor
    } else {
      // Recovery: Beak closes, throat settles, posture returns
      const sub = (p - 0.75) / 0.25;
      gape = 0.85 * (1.0 - sub);
      neckCraning = 0.45 * (1.0 - sub);
      throatSwell = 1.0 + 0.45 * (1.0 - sub);
      mantleFlare = 0.75 * (1.0 - sub);
    }

    // Body posture: lowered aggressive stance
    rig.root.position.set(0, -0.1 + tremor * 0.5, 0);
    rig.root.rotation.set(0.22 + tremor, 0, 0);

    // Neck craning forward and upward
    rig.neckBase.position.set(0.28 + neckCraning * 0.15, 0.14 + neckCraning * 0.08, 0);
    rig.neckBase.rotation.set(-0.25 + neckCraning * 0.3, 0, 0);
    rig.neckMid.rotation.set(0.18 + neckCraning * 0.2, 0, 0);
    rig.head.rotation.set(0.15 + neckCraning * 0.2 + tremor, 0, 0);

    // Articulated Beak Gape (Maxilla lifts slightly, Mandible drops fully)
    rig.beakUpper.rotation.x = -gape * 0.2;
    rig.beakLower.rotation.x = gape * 0.95; // full wide gape

    // Throat sac pulsing
    rig.throat.scale.set(throatSwell, throatSwell * 1.2, throatSwell);

    // Half-Flared Mantling Wings (Aggressive territorial display)
    rig.shoulderL.rotation.set(mantleFlare * 0.3, mantleFlare * 0.4, mantleFlare * 0.5);
    rig.elbowL.rotation.set(0, -mantleFlare * 0.5, -mantleFlare * 0.6);
    rig.wristL.rotation.set(0, mantleFlare * 0.6, -mantleFlare * 0.5);

    rig.shoulderR.rotation.set(mantleFlare * 0.3, -mantleFlare * 0.4, -mantleFlare * 0.5);
    rig.elbowR.rotation.set(0, mantleFlare * 0.5, mantleFlare * 0.6);
    rig.wristR.rotation.set(0, -mantleFlare * 0.6, mantleFlare * 0.5);

    // Splayed Primaries in mantling stance
    for (let pt = 0; pt < rig.primariesL.length; pt++) {
      rig.primariesL[pt].rotation.z = mantleFlare * 0.35;
      rig.primariesR[pt].rotation.z = -mantleFlare * 0.35;
    }

    // Tail fanned wide and pressed into ground for brace
    rig.tailJoint.rotation.set(-0.55, 0, 0);
    for (let r = 0; r < rig.retrices.length; r++) {
      const tr = (r - 5.5) / 5.5;
      rig.retrices[r].rotation.y = Math.PI + tr * (0.45 + mantleFlare * 0.4);
    }
  }

  /**
   * 6. HEAD TURN ANIMATION
   * Biomechanically accurate raptor saccades: instantaneous snappy turns, 45° head-cocking for binocular depth, sky/ground tracking.
   */
  private evaluateHeadTurn(t: number, rig: EagleRigNodes): void {
    const cycleFreq = 0.2; // 5-second saccadic behavioral sequence
    const phase = (t * cycleFreq) % 1.0;
    this.normalizedPhase = phase;

    let targetYaw = 0;
    let targetPitch = 0;
    let targetRoll = 0; // head cocking for depth perception

    // Sequence of distinct raptor saccadic fixations
    if (phase < 0.2) {
      // Fixation 1: Sharp 55° snap to the left
      targetYaw = 0.95;
      targetPitch = -0.05;
      targetRoll = -0.15;
    } else if (phase < 0.4) {
      // Fixation 2: Head-cocked depth scan (triangulating with binocular fovea)
      targetYaw = 0.85;
      targetPitch = 0.12;
      targetRoll = 0.42; // dramatic raptor head tilt
    } else if (phase < 0.6) {
      // Fixation 3: Sharp 70° snap to the right
      targetYaw = -1.2;
      targetPitch = 0.05;
      targetRoll = -0.35;
    } else if (phase < 0.8) {
      // Fixation 4: Looking up into sky (thermal/aerial predator scan)
      targetYaw = -0.3;
      targetPitch = 0.65;
      targetRoll = 0.1;
    } else {
      // Fixation 5: Looking down at ground (prey hunt)
      targetYaw = 0.1;
      targetPitch = -0.45;
      targetRoll = 0.0;
    }

    // If interactive cursor tracking is enabled, blend in user's cursor target!
    if (this.isCursorTracking) {
      targetYaw = this.cursorTarget.x * 1.3;
      targetPitch = -this.cursorTarget.y * 0.8;
      targetRoll = this.cursorTarget.x * 0.25;
    }

    // Natural raptor saccadic interpolation (rapid snap + steady fixation hold)
    rig.neckBase.rotation.set(targetPitch * 0.35, targetYaw * 0.4, 0);
    rig.neckMid.rotation.set(targetPitch * 0.25, targetYaw * 0.3, targetRoll * 0.4);
    rig.head.rotation.set(targetPitch * 0.4, targetYaw * 0.3, targetRoll * 0.6);

    // Perched body posture
    rig.root.position.set(0, -0.06, 0);
    rig.root.rotation.set(0.12, 0, 0);
    this.setFoldedWings(rig, 0);

    // Beak closed
    rig.beakLower.rotation.x = 0;
    rig.beakUpper.rotation.x = 0;
  }

  /**
   * Helper to set realistic folded wing resting posture along body flanks.
   */
  private setFoldedWings(rig: EagleRigNodes, bounce = 0): void {
    // Left Wing Folded
    rig.shoulderL.rotation.set(0.2 + bounce, 0.45, 0.35);
    rig.humerusL.rotation.set(0, 0, 0.1);
    rig.forearmL.rotation.set(0, -0.85, -0.95);
    rig.wristL.rotation.set(0, 0.95, -0.8);
    rig.manusL.rotation.set(0, 0, -0.4);

    // Right Wing Folded (Symmetric)
    rig.shoulderR.rotation.set(0.2 + bounce, -0.45, -0.35);
    rig.humerusR.rotation.set(0, 0, -0.1);
    rig.forearmR.rotation.set(0, 0.85, 0.95);
    rig.wristR.rotation.set(0, -0.95, 0.8);
    rig.manusR.rotation.set(0, 0, 0.4);

    // Flat resting primaries
    for (let p = 0; p < rig.primariesL.length; p++) {
      rig.primariesL[p].rotation.z = -0.05;
      rig.primariesR[p].rotation.z = 0.05;
    }
  }

  /**
   * Helper to set flight tucked legs.
   */
  private setTuckedLegs(rig: EagleRigNodes): void {
    rig.thighL.rotation.set(0.2, 0, -0.45);
    rig.kneeL.rotation.set(0, 0, 0.85);
    rig.ankleL.rotation.set(0, 0, -0.65);
    rig.halluxL.rotation.set(0, 0, 0.2);
    rig.midToeL.rotation.set(0, 0, -0.2);

    rig.thighR.rotation.set(0.2, 0, 0.45);
    rig.kneeR.rotation.set(0, 0, -0.85);
    rig.ankleR.rotation.set(0, 0, 0.65);
    rig.halluxR.rotation.set(0, 0, 0.2);
    rig.midToeR.rotation.set(0, 0, -0.2);
  }

  /**
   * Secondary Physics Simulation (Feather Inertia, Elastic Recovery, Head Lag).
   */
  private applySecondaryPhysics(delta: number, rig: EagleRigNodes): void {
    // Micro feather flutter and inertial damping
    this.tailFlutter = Math.sin(this.time * 12.0) * 0.008;
    rig.tailJoint.rotation.z += this.tailFlutter;
  }

  /**
   * Eye Mechanics: Nictitating membrane sweep and eyelid blinks.
   */
  private updateEyeMechanisms(delta: number, rig: EagleRigNodes): void {
    this.nictitatingTimer += delta;

    // Nictitating sweep every 4.5 seconds (lasts 0.15 seconds)
    const sweepInterval = 4.5;
    const sweepDuration = 0.18;
    const cycleTime = this.nictitatingTimer % sweepInterval;

    if (cycleTime < sweepDuration) {
      // Rapid sweep across the eyeball
      const sweepProgress = Math.sin((cycleTime / sweepDuration) * Math.PI);
      rig.nictitatingL.scale.set(0.01 + sweepProgress * 1.05, 1, 1);
      rig.nictitatingR.scale.set(0.01 + sweepProgress * 1.05, 1, 1);
    } else {
      rig.nictitatingL.scale.set(0.01, 1, 1);
      rig.nictitatingR.scale.set(0.01, 1, 1);
    }
  }
}
