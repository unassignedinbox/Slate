import * as THREE from 'three';
import { buildBody, buildChelicera, buildPedipalp, buildLeg, placeSegmentWorld } from './build.js';
import { legGroup, GAIT } from './gait.js';
import { CHELICERA, LEG_PAIRS, BODY } from './proportions.js';
import { Timeline, Easing, lerp, clamp01 } from '../utils/tween.js';

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _up = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _mat4 = new THREE.Matrix4();
const _rayOrigin = new THREE.Vector3();
const _rayDir = new THREE.Vector3();

export const STATE = {
  IDLE: 'idle',
  WALK: 'walk',
  THREAT: 'threat',
  STRIKE: 'strike',
  RETREAT: 'retreat',
};

export class SpiderController {
  constructor(scene, materials, colliders, opts = {}) {
    this.scene = scene;
    this.materials = materials;
    this.colliders = colliders; // array of THREE.Mesh used for surface raycasts
    this.raycaster = new THREE.Raycaster();

    this.root = new THREE.Group();
    this.root.name = 'spiderRoot';
    this.bodyPitch = new THREE.Group();
    this.bodyPitch.name = 'bodyPitch';
    this.root.add(this.bodyPitch);
    scene.add(this.root);

    const bodyParts = buildBody(materials);
    this.bodyParts = bodyParts;
    this.bodyPitch.add(bodyParts.group);

    // Legs
    this.legs = [];
    for (let pairIndex = 0; pairIndex < 4; pairIndex++) {
      for (const side of [-1, 1]) {
        const leg = buildLeg(pairIndex, side, materials);
        leg.pairIndex = pairIndex;
        leg.group = legGroup(pairIndex, side);
        leg.plantedPoint = new THREE.Vector3();
        leg.plantedNormal = new THREE.Vector3(0, 1, 0);
        leg.swingStart = new THREE.Vector3();
        leg.footWorld = new THREE.Vector3();
        leg.grounded = true;
        leg.initialized = false;
        leg.wasStance = true;
        leg.ikJoints = [];
        for (let i = 0; i <= 5; i++) leg.ikJoints.push(new THREE.Vector3());
        leg.scriptedTarget = null; // Vector3 | null — overrides gait during scripted poses
        leg.scriptedLift = 0;
        this.bodyPitch.add(leg.hipAnchor);
        scene.add(leg.scene);
        this.legs.push(leg);
      }
    }

    // Pedipalps
    this.pedipalps = [-1, 1].map((side) => {
      const p = buildPedipalp(side, materials);
      p.root.position.set(BODY.prosomaLength * 0.46, -BODY.prosomaHeight * 0.1, side * BODY.prosomaWidth * 0.22);
      p.root.rotation.y = side * 0.55;
      p.root.rotation.z = -0.35;
      p.restRotation = { y: p.root.rotation.y, z: p.root.rotation.z };
      this.bodyPitch.add(p.root);
      return p;
    });

    // Chelicerae
    this.chelicerae = [-1, 1].map((side) => {
      const c = buildChelicera(side, materials);
      c.root.position.set(BODY.prosomaLength * 0.5, -BODY.prosomaHeight * 0.05, side * BODY.prosomaWidth * 0.11);
      c.root.rotation.y = side * 0.12;
      this.bodyPitch.add(c.root);
      return c;
    });

    // --- runtime state ---
    this.position = new THREE.Vector3(opts.position?.x ?? 0, opts.position?.y ?? 0, opts.position?.z ?? 0);
    this.up = new THREE.Vector3(0, 1, 0);
    this.forward = new THREE.Vector3(1, 0, 0);
    this.right = new THREE.Vector3(0, 0, 1);
    this.gaitPhase = 0;
    this.speed = 0; // current locomotion speed, m/s
    this.maxWalkSpeed = 0.11;
    this.maxRunSpeed = 0.30;
    this.turnRate = 2.4; // rad/s
    this.yawInput = 0;
    this.moveInput = 0; // -1..1 forward/back
    this.strafeInput = 0;
    this.running = false;

    this.state = STATE.IDLE;
    this.time = 0;
    this.stateLabel = 'idle';

    this._buildTimelines();

    // initial placement: snap to nearest surface below
    this._snapToNearestSurface(true);
    for (const leg of this.legs) this._resetFootToIdeal(leg, true);
  }

  // -------------------------------------------------------------------
  // Public control API
  // -------------------------------------------------------------------
  setMoveInput(forwardAmt, strafeAmt, run) {
    this.moveInput = THREE.MathUtils.clamp(forwardAmt, -1, 1);
    this.strafeInput = THREE.MathUtils.clamp(strafeAmt, -1, 1);
    this.running = !!run;
  }
  setYawInput(v) { this.yawInput = THREE.MathUtils.clamp(v, -1, 1); }

  triggerThreat() {
    if (this.state === STATE.STRIKE) return;
    this.state = STATE.THREAT;
    this.threatTimeline.play();
  }

  triggerStrike() {
    this.state = STATE.STRIKE;
    this.strikeTimeline.play();
  }

  isBusy() {
    return this.state === STATE.THREAT || this.state === STATE.STRIKE;
  }

  // -------------------------------------------------------------------
  // Attack / threat-display choreography
  // -------------------------------------------------------------------
  _buildTimelines() {
    this.rearAmount = 0;       // 0..1 how far reared back we are
    this.fangAmount = 0;       // 0..1 fang swing (0 folded, 1 fully bared)
    this.pedipalpRaise = 0;    // 0..1
    this.lungeAmount = 0;      // -0.3..1 forward lunge of body
    this.frontLegPose = 0;     // 0..1 blend for scripted front-leg pose

    const t = new Timeline();
    t.add(0.0, 0.55, (e) => { this.rearAmount = e; this.pedipalpRaise = Math.min(e, 1); this.frontLegPose = Math.min(e, 1); }, Easing.backOut);
    t.add(0.15, 0.6, (e) => { this.fangAmount = e * 0.55; }, Easing.quadOut);
    t.onComplete = () => { if (this.state === STATE.THREAT) this.stateLabel = 'threat display (holding)'; };
    this.threatTimeline = t;

    const s = new Timeline();
    // quick wind-up, explosive lunge + fang stab, recoil, settle
    s.add(0.0, 0.10, (e) => { this.rearAmount = lerp(this.rearAmount, 1.0, e); this.frontLegPose = lerp(this.frontLegPose, 1, e); }, Easing.quadOut);
    s.add(0.10, 0.22, (e) => {
      this.lungeAmount = e; // snap forward
      this.fangAmount = e;
      this.frontLegPose = 1 + e * 0.6;
    }, Easing.expoOut);
    s.add(0.22, 0.34, (e) => { this.lungeAmount = 1 - e * 0.4; this.fangAmount = 1 - e * 0.3; }, Easing.quadOut);
    s.add(0.34, 0.85, (e) => {
      this.lungeAmount = lerp(0.6, 0, e);
      this.rearAmount = lerp(1.0, 0.0, e);
      this.fangAmount = lerp(0.7, 0.0, e);
      this.pedipalpRaise = lerp(1.0, 0.0, e);
      this.frontLegPose = lerp(1.0, 0.0, e);
    }, Easing.quadOut);
    s.onComplete = () => { this.state = STATE.IDLE; this.rearAmount = 0; this.fangAmount = 0; this.pedipalpRaise = 0; this.lungeAmount = 0; this.frontLegPose = 0; };
    this.strikeTimeline = s;
  }

  // -------------------------------------------------------------------
  // Surface following (this is what makes wall/ceiling walking work)
  // -------------------------------------------------------------------
  _raycastSurface(origin, dir, far) {
    this.raycaster.set(origin, dir);
    this.raycaster.far = far;
    this.raycaster.near = 0;
    const hits = this.raycaster.intersectObjects(this.colliders, false);
    if (hits.length === 0) return null;
    const hit = hits[0];
    const normal = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize() : this.up.clone();
    return { point: hit.point.clone(), normal, distance: hit.distance };
  }

  _snapToNearestSurface(instant = false, dt = 1 / 60) {
    // search along current -up, then fall back to a wider spherical probe
    let best = this._raycastSurface(_v1.copy(this.position).addScaledVector(this.up, 0.35), _v2.copy(this.up).negate(), 3.0);
    if (!best) {
      // probe several directions to find *some* wall/ceiling nearby
      const dirs = [
        new THREE.Vector3(0, -1, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0),
        new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0),
      ];
      for (const d of dirs) {
        const hit = this._raycastSurface(this.position, d, 4.0);
        if (hit) { best = hit; break; }
      }
    }
    if (best) {
      const targetPos = _v1.copy(best.point).addScaledVector(best.normal, BODY.standHeight);
      if (instant) {
        this.position.copy(targetPos);
        this.up.copy(best.normal);
      } else {
        this.position.lerp(targetPos, 1 - Math.pow(0.0004, dt));
        this.up.lerp(best.normal, 1 - Math.pow(0.004, dt)).normalize();
      }
    }
  }

  _idealHorizontalDir(leg) {
    // leg.outDirLocal already encodes splay + slight downward elevation;
    // strip the local "up" component so the ideal reach direction is
    // measured along the current walking surface, not into it.
    const bodyQuat = this.bodyPitch.getWorldQuaternion(_quat);
    const dirWorld = _v3.copy(leg.outDirLocal).applyQuaternion(bodyQuat).normalize();
    const alongUp = dirWorld.dot(this.up);
    dirWorld.addScaledVector(this.up, -alongUp).normalize();
    return dirWorld;
  }

  _computeIdealContact(leg) {
    const hipWorld = leg.ikRoot.getWorldPosition(_v1.clone());
    const horiz = this._idealHorizontalDir(leg).clone();
    const reach = leg.ikChain.totalLength * GAIT.strideLenFactor;
    const target = hipWorld.clone().addScaledVector(horiz, reach);
    const rayOrigin = target.clone().addScaledVector(this.up, leg.ikChain.totalLength * 0.8);
    const rayDir = this.up.clone().negate();
    const hit = this._raycastSurface(rayOrigin, rayDir, leg.ikChain.totalLength * 2.2);
    if (hit) return hit;
    return { point: target.clone().addScaledVector(this.up, -BODY.standHeight * 0.6), normal: this.up.clone() };
  }

  _resetFootToIdeal(leg, instant) {
    const c = this._computeIdealContact(leg);
    leg.plantedPoint.copy(c.point);
    leg.plantedNormal.copy(c.normal);
    leg.footWorld.copy(c.point);
    leg.swingStart.copy(c.point);
    leg.initialized = true;
  }

  // -------------------------------------------------------------------
  // Main update
  // -------------------------------------------------------------------
  update(dt) {
    this.time += dt;
    this.threatTimeline.update(dt);
    this.strikeTimeline.update(dt);

    if (this.state === STATE.THREAT && !this.threatTimeline.playing) {
      // hold the pose
    } else if (this.state === STATE.STRIKE && !this.strikeTimeline.playing) {
      this.state = STATE.IDLE;
    }

    const busy = this.isBusy();

    // --- locomotion integration (disabled while performing scripted attacks) ---
    if (!busy) {
      // turning
      if (Math.abs(this.yawInput) > 0.001) {
        _quat.setFromAxisAngle(this.up, -this.yawInput * this.turnRate * dt);
        this.forward.applyQuaternion(_quat);
      }
      const maxSpeed = this.running ? this.maxRunSpeed : this.maxWalkSpeed;
      const travelDir = _v1.copy(this.forward).multiplyScalar(this.moveInput)
        .addScaledVector(this.right, this.strafeInput);
      const inputMag = Math.min(1, Math.hypot(this.moveInput, this.strafeInput));
      if (travelDir.lengthSq() > 1e-8) travelDir.normalize();
      const speedScalar = inputMag * maxSpeed;
      this.position.addScaledVector(travelDir, speedScalar * dt);
      this.speed = speedScalar;
    } else {
      this.speed = 0;
    }

    // lunge (strike) drives the body forward independent of normal input
    if (this.lungeAmount !== 0) {
      this.position.addScaledVector(this.forward, this.lungeAmount * 0.006);
    }

    // --- surface following: keep body glued to the cave (floor/wall/ceiling) ---
    this._snapToNearestSurface(false, dt);

    // re-orthonormalize basis around the (possibly new) up vector
    const alongUp = this.forward.dot(this.up);
    this.forward.addScaledVector(this.up, -alongUp);
    if (this.forward.lengthSq() < 1e-6) this.forward.set(1, 0, 0);
    this.forward.normalize();
    this.right.crossVectors(this.forward, this.up).normalize();

    _mat4.makeBasis(this.forward, this.up, this.right);
    _quat.setFromRotationMatrix(_mat4);
    this.root.quaternion.slerp(_quat, 1 - Math.pow(0.0005, dt));
    this.root.position.copy(this.position);

    // idle breathing / body language
    const breathe = Math.sin(this.time * 1.6) * 0.0009 + Math.sin(this.time * 0.37) * 0.0004;
    this.bodyPitch.position.set(0, breathe, 0);
    const rearRad = THREE.MathUtils.degToRad(34) * this.rearAmount;
    this.bodyPitch.rotation.z = -rearRad;
    this.bodyPitch.position.addScaledVector(new THREE.Vector3(0, 1, 0), this.rearAmount * 0.010);
    this.bodyPitch.position.x -= this.rearAmount * 0.006;

    this.root.updateMatrixWorld(true);

    // --- gait ---
    const strideMeters = GAIT.cycleLenMeters;
    if (this.speed > 0.002) {
      this.gaitPhase += (this.speed * dt) / strideMeters;
    } else if (!busy) {
      this.gaitPhase += dt * 0.05; // slow idle creep so it never looks frozen
    }
    this.gaitPhase = this.gaitPhase % 1;
    if (this.gaitPhase < 0) this.gaitPhase += 1;

    for (const leg of this.legs) this._updateLeg(leg, dt);

    // --- pedipalps & chelicerae (threat / strike) ---
    this._updateMouthparts(dt);
  }

  _updateLeg(leg, dt) {
    const hipWorld = leg.ikRoot.getWorldPosition(_v1.clone());

    const isFrontPair = leg.pairIndex === 0;
    const scripted = this.rearAmount > 0.001 && isFrontPair;

    if (scripted) {
      // Front legs lift into a raised, splayed "threat" pose, then jab
      // forward on strike, entirely driven by body-local offsets so they
      // track the rearing body correctly.
      const raise = Math.min(this.frontLegPose, 1);
      const strikeExtra = Math.max(this.frontLegPose - 1, 0); // >0 only during the jab
      const local = new THREE.Vector3(
        lerp(0.15, 0.55, raise) + strikeExtra * 1.6 + this.lungeAmount * 0.9,
        lerp(0.05, 0.85, raise) + this.lungeAmount * -0.55,
        leg.side * 0.55
      ).multiplyScalar(leg.ikChain.totalLength * 0.62);
      const target = hipWorld.clone()
        .addScaledVector(this.forward, local.x)
        .addScaledVector(this.up, local.y)
        .addScaledVector(this.right, local.z);
      leg.footWorld.lerp(target, Math.min(1, dt * 14));
      leg.grounded = false;
    } else {
      const dutyFactor = GAIT.dutyFactor;
      const legPhase = ((this.gaitPhase + (leg.group === 0 ? 0 : 0.5)) % 1 + 1) % 1;
      const stance = legPhase < dutyFactor;

      if (!leg.initialized) this._resetFootToIdeal(leg, true);

      if (stance) {
        if (!leg.wasStance) {
          // touchdown event
          const c = this._computeIdealContact(leg);
          leg.plantedPoint.copy(c.point);
          leg.plantedNormal.copy(c.normal);
        }
        leg.footWorld.copy(leg.plantedPoint);
        leg.grounded = true;
      } else {
        if (leg.wasStance) {
          leg.swingStart.copy(leg.plantedPoint);
        }
        const swingT = clamp01((legPhase - dutyFactor) / (1 - dutyFactor));
        const c = this._computeIdealContact(leg);
        const eased = Easing.sineInOut(swingT);
        _v2.lerpVectors(leg.swingStart, c.point, eased);
        const lift = Math.sin(Math.PI * swingT) * GAIT.liftHeight * (leg.ikChain.totalLength / 0.148);
        _v2.addScaledVector(this.up, lift);
        leg.footWorld.copy(_v2);
        leg.plantedPoint.copy(c.point);
        leg.plantedNormal.copy(c.normal);
        leg.grounded = false;
      }
      leg.wasStance = stance;
    }

    const poleDir = this.up;
    leg.ikChain.solve(hipWorld, leg.footWorld, poleDir, leg.ikJoints);

    for (let i = 0; i < leg.segMeshes.length; i++) {
      placeSegmentWorld(leg.segMeshes[i], leg.ikJoints[i], leg.ikJoints[i + 1]);
      leg.jointSpheres[i].position.copy(leg.ikJoints[i]);
    }
    // claw group at the tip, oriented along the tarsus direction, curled
    // slightly toward the surface it's standing on.
    const tipA = leg.ikJoints[4], tipB = leg.ikJoints[5];
    leg.clawGroup.position.copy(tipB);
    _v3.subVectors(tipB, tipA).normalize();
    _quat.setFromUnitVectors(new THREE.Vector3(0, 1, 0), _v3);
    leg.clawGroup.quaternion.copy(_quat);
  }

  _updateMouthparts(dt) {
    for (const c of this.chelicerae) {
      const rest = THREE.MathUtils.degToRad(CHELICERA.restAngleDeg);
      const strike = THREE.MathUtils.degToRad(CHELICERA.strikeAngleDeg);
      c.fangPivot.rotation.x = lerp(rest, strike, this.fangAmount);
    }
    for (const p of this.pedipalps) {
      const raise = this.pedipalpRaise;
      p.root.rotation.z = lerp(p.restRotation.z, p.restRotation.z - 1.35, raise) - this.lungeAmount * 0.5;
      p.root.rotation.x = lerp(0, -0.5, raise);
    }
  }
}
