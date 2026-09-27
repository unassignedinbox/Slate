import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import GUI from 'lil-gui';

import { params, SHAPE, MECHANICS } from './core/params.js';
import { buildMosquito } from './mosquito/mosquito.js';
import { MosquitoAgent, STATE } from './mosquito/agent.js';
import { Vehicle } from './scene/vehicle.js';
import { Effects } from './scene/effects.js';

/* ---------------------------------------------------------------- setup */
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0c1014);
scene.fog = new THREE.Fog(0x0c1014, 26, 90);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.02, 400);
camera.position.set(6.4, 3.3, 7.2);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.target.set(-1.4, 1.6, -0.6);

/* --------------------------------------------------------------- lights */
const hemi = new THREE.HemisphereLight(0x8fb4d8, 0x20180f, 0.55);
scene.add(hemi);

const key = new THREE.DirectionalLight(0xfff2dd, 2.4);
key.position.set(8, 12, 6);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.near = 1; key.shadow.camera.far = 50;
const sc = 12;
key.shadow.camera.left = -sc; key.shadow.camera.right = sc;
key.shadow.camera.top = sc; key.shadow.camera.bottom = -sc;
key.shadow.bias = -0.0006;
scene.add(key);

const rim = new THREE.DirectionalLight(0x5fa8ff, 1.1);
rim.position.set(-7, 4, -8);
scene.add(rim);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(220, 220),
  new THREE.MeshStandardMaterial({ color: 0x1a1f24, roughness: 0.96, metalness: 0.0 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

/* ---------------------------------------------------------------- world */
const vehicle = new Vehicle(scene);
const effects = new Effects(scene);

let rig = null, agent = null;

function build() {
  if (rig) {
    scene.remove(rig.root);
    rig.root.traverse((o) => {
      if (o.isMesh) {
        o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) m.dispose();
      }
    });
  }
  rig = buildMosquito(params.shape);
  scene.add(rig.root);

  const prev = agent;
  agent = new MosquitoAgent(rig, params.shape, params.mech, vehicle);
  if (prev) {
    agent.pos.copy(prev.pos);
    agent.vel.copy(prev.vel);
    agent.heading = prev.heading;
    agent.state = prev.state;
    agent.stateTime = prev.stateTime;
    agent.site = prev.site;
    agent.load = prev.load;
    agent.breach = prev.breach;
    agent.restQuat = prev.restQuat;
    agent.restAnchor = prev.restAnchor;
    Object.assign(agent.b, prev.b);
    // foot plan has to be re-bound to the new leg objects
    if (prev.legPlan) {
      agent.legPlan = prev.legPlan.map((pl, i) => ({
        leg: rig.legs[i], point: pl.point, touched: pl.touched,
      }));
    }
  }
}
build();

/* ------------------------------------------------------------------ gui */
const gui = new GUI({ title: 'Anopheles' });
let rebuildQueued = false;
const queueRebuild = () => { rebuildQueued = true; };

const S = params.shape, M = params.mech;

const fShape = gui.addFolder('Shape');
const gGlobal = fShape.addFolder('Global');
gGlobal.add(S, 'bodyLength', 0.05, 4.0, 0.01).onFinishChange(queueRebuild);

const gHead = fShape.addFolder('Head');
[['headLength', 0.06, 0.3], ['headWidth', 0.06, 0.34], ['eyeRadius', 0.02, 0.14],
['eyeSeparation', 0.02, 0.16]].forEach(([k, a, b]) =>
  gHead.add(S, k, a, b, 0.001).onFinishChange(queueRebuild));
gHead.add(S, 'eyeFacetDensity', 6, 60, 1).onFinishChange(queueRebuild);

const gMouth = fShape.addFolder('Proboscis & palps');
[['proboscisLength', 0.15, 1.0], ['proboscisBaseRadius', 0.005, 0.05],
['proboscisTipRadius', 0.001, 0.02], ['fascicleRadius', 0.15, 0.8],
['labellaLength', 0.01, 0.12], ['palpLength', 0.0, 0.8], ['palpRadius', 0.003, 0.03]]
  .forEach(([k, a, b]) => gMouth.add(S, k, a, b, 0.001).onFinishChange(queueRebuild));
gMouth.add(S, 'palpSegments', 2, 8, 1).onFinishChange(queueRebuild);
gMouth.add(S, 'labiumSegments', 3, 14, 1).onFinishChange(queueRebuild);
gMouth.add(S, 'labiumWallThickness', 0.08, 0.8, 0.01).onFinishChange(queueRebuild);
gMouth.add(S, 'drillFluteCount', 2, 6, 1).onFinishChange(queueRebuild);
gMouth.add(S, 'drillFlutePitch', 0.02, 0.3, 0.005).onFinishChange(queueRebuild);

const gAnt = fShape.addFolder('Antennae');
[['antennaLength', 0.1, 0.9], ['antennaBaseRadius', 0.003, 0.03],
['antennaWhorlLength', 0.0, 0.1], ['antennaSpread', 0.0, 1.4]]
  .forEach(([k, a, b]) => gAnt.add(S, k, a, b, 0.001).onFinishChange(queueRebuild));
gAnt.add(S, 'antennaFlagellomeres', 4, 16, 1).onFinishChange(queueRebuild);
gAnt.add(S, 'antennaWhorlCount', 0, 14, 1).onFinishChange(queueRebuild);

const gThx = fShape.addFolder('Thorax');
[['thoraxLength', 0.1, 0.45], ['thoraxHeight', 0.08, 0.4],
['thoraxWidth', 0.08, 0.4], ['scutumHump', 0.0, 0.7]]
  .forEach(([k, a, b]) => gThx.add(S, k, a, b, 0.001).onFinishChange(queueRebuild));

const gAbd = fShape.addFolder('Abdomen');
[['abdomenLength', 0.25, 1.0], ['abdomenRadius', 0.03, 0.2],
['abdomenTaper', 0.2, 1.0], ['abdomenMaxDistension', 1.0, 4.0]]
  .forEach(([k, a, b]) => gAbd.add(S, k, a, b, 0.001).onFinishChange(queueRebuild));
gAbd.add(S, 'abdomenSegments', 4, 12, 1).onFinishChange(queueRebuild);
gAbd.add(S, 'ribCount', 0, 16, 1).onFinishChange(queueRebuild);

const gWing = fShape.addFolder('Wings & halteres');
[['wingLength', 0.3, 1.1], ['wingChord', 0.07, 0.4], ['wingCamber', 0.0, 0.14],
['wingTwistDeg', 0, 40], ['wingRootHeight', 0.0, 1.2], ['wingRootOffset', -0.3, 0.3],
['haltereLength', 0.03, 0.25], ['haltereKnobRadius', 0.005, 0.05]]
  .forEach(([k, a, b]) => gWing.add(S, k, a, b, 0.001).onFinishChange(queueRebuild));
gWing.add(S, 'wingVeinCount', 2, 10, 1).onFinishChange(queueRebuild);
gWing.add(S, 'wingScaleBlocks', 0, 10, 1).onFinishChange(queueRebuild);

const gLeg = fShape.addFolder('Legs');
[['legCoxa', 0.01, 0.15], ['legTrochanter', 0.005, 0.1], ['legFemur', 0.1, 0.8],
['legTibia', 0.1, 0.9], ['legTarsus', 0.1, 0.9], ['legRadius', 0.004, 0.04],
['legScalePair1', 0.4, 1.6], ['legScalePair2', 0.4, 1.6], ['legScalePair3', 0.4, 1.8],
['clawLength', 0.0, 0.08]]
  .forEach(([k, a, b]) => gLeg.add(S, k, a, b, 0.001).onFinishChange(queueRebuild));
gLeg.add(S, 'legTarsomeres', 1, 7, 1).onFinishChange(queueRebuild);
gLeg.add(S, 'legTaper', 0.1, 1.0, 0.01).onFinishChange(queueRebuild);

/* -------- mechanics: live, no rebuild -------- */
const fMech = gui.addFolder('Mechanics');
fMech.add(M, 'timeScale', 0.01, 2.0, 0.01);

const mWing = fMech.addFolder('Wing kinematics');
mWing.add(M, 'wingbeatHz', 1, 900, 0.5);
mWing.add(M, 'strokeAmplitudeDeg', 10, 140, 0.5);
mWing.add(M, 'strokeMeanDeg', -40, 40, 0.5);
mWing.add(M, 'strokePlaneDeg', 0, 110, 0.5);
mWing.add(M, 'deviationDeg', 0, 35, 0.1);
mWing.add(M, 'deviationH2', 0, 1, 0.01);
mWing.add(M, 'deviationPhaseDeg', -180, 180, 1);
mWing.add(M, 'pitchMidDeg', 0, 90, 0.5);
mWing.add(M, 'pitchAmplitudeDeg', 0, 140, 0.5);
mWing.add(M, 'rotationSharpness', 0.2, 12, 0.1);
mWing.add(M, 'rotationAdvanceDeg', -90, 90, 1);
mWing.add(M, 'spanwiseTwistLagDeg', 0, 70, 0.5);
mWing.add(M, 'wingFlexure', 0, 1.2, 0.01);
mWing.add(M, 'strokeAsymmetry', -0.25, 0.25, 0.005);
mWing.add(M, 'haltereAmplitudeDeg', 0, 140, 1);
mWing.add(M, 'haltereAntiphase');

const mBody = fMech.addFolder('Body & flight');
mBody.add(M, 'bodyPitchHoverDeg', -20, 80, 0.5);
mBody.add(M, 'bodyPitchRestDeg', 0, 80, 0.5);
mBody.add(M, 'heaveAmplitude', 0, 0.06, 0.0005);
mBody.add(M, 'yawJitterDeg', 0, 15, 0.1);
mBody.add(M, 'yawJitterHz', 0.2, 20, 0.1);
mBody.add(M, 'maxBankDeg', 0, 80, 1);
mBody.add(M, 'cruiseSpeed', 0.2, 10, 0.05);
mBody.add(M, 'approachSpeed', 0.05, 4, 0.01);
mBody.add(M, 'accel', 0.2, 14, 0.1);
mBody.add(M, 'turnRate', 0.2, 10, 0.05);

const mLegs = fMech.addFolder('Legs & landing');
mLegs.add(M, 'legTuckDeg', 0, 110, 0.5);
mLegs.add(M, 'hindLegTrailDeg', 0, 110, 0.5);
mLegs.add(M, 'landingReachDeg', 0, 110, 0.5);
mLegs.add(M, 'touchdownStagger', 0, 0.4, 0.005);
mLegs.add(M, 'tarsalCompliance', 0, 1, 0.01);
mLegs.add(M, 'gripSettleTime', 0.05, 2, 0.01);
mLegs.add(M, 'stanceSpread', 0.4, 1.8, 0.01);
mLegs.add(M, 'walkStride', 0.0, 1.4, 0.01);
mLegs.add(M, 'walkDuration', 0.3, 6, 0.05);
mLegs.add(M, 'stepLift', 0.0, 0.2, 0.002);

const mProbe = fMech.addFolder('Probe / pierce / drill');
mProbe.add(M, 'probeSweepDeg', 0, 45, 0.5);
mProbe.add(M, 'probeSweepHz', 0.2, 8, 0.1);
mProbe.add(M, 'probeDuration', 0.2, 8, 0.1);
mProbe.add(M, 'labiumBowDeg', 0, 175, 1);
mProbe.add(M, 'fascicleExtend', 0, 1, 0.01);
mProbe.add(M, 'sawHz', 1, 60, 0.5);
mProbe.add(M, 'sawStroke', 0, 0.12, 0.001);
mProbe.add(M, 'maxillaAlternation', 0, 1, 0.01);
mProbe.add(M, 'drillRPM', 0, 8000, 10);
mProbe.add(M, 'drillPlungeRate', 0.005, 0.6, 0.005);
mProbe.add(M, 'drillWobbleDeg', 0, 8, 0.1);
mProbe.add(M, 'sparkRate', 0, 400, 5);

const mFeed = fMech.addFolder('Feeding');
mFeed.add(M, 'pumpHz', 0.2, 12, 0.1);
mFeed.add(M, 'pumpStroke', 0, 0.5, 0.005);
mFeed.add(M, 'pumpPhaseOffset', 0, 1, 0.01);
mFeed.add(M, 'distensionLag', 0.05, 4, 0.05);
mFeed.add(M, 'drainRate', 0.1, 30, 0.1);
mFeed.add(M, 'tankCapacity', 5, 200, 1).onChange((v) => {
  vehicle.capacity = v; vehicle.fuel = Math.min(vehicle.fuel, v);
});
mFeed.add(M, 'crawCapacity', 1, 120, 0.5);
mFeed.add(M, 'detachThreshold', 0.1, 1, 0.01);
mFeed.add(M, 'loadedWingbeatGain', 0, 1, 0.01);
mFeed.add(M, 'loadedClimbPenalty', 0, 1, 0.01);
mFeed.add(M, 'takeoffImpulse', 0.1, 6, 0.05);
mFeed.add(M, 'takeoffSpool', 0.05, 3, 0.05);
mFeed.add(M, 'takeoffLegPush', 0.0, 0.5, 0.005);

gui.folders.forEach((f) => f.close());
fMech.open(); mWing.open();

/* --------------------------------------------------------------- camera */
let follow = false;
addEventListener('keydown', (e) => {
  if (e.key === 'f' || e.key === 'F') follow = !follow;
  if (e.key === 'r' || e.key === 'R') { vehicle.fuel = vehicle.capacity; }
});

/* ----------------------------------------------------------------- loop */
const clock = new THREE.Clock();
const _p = new THREE.Vector3();
let sparkAccum = 0, mistAccum = 0;

function tick() {
  requestAnimationFrame(tick);
  if (rebuildQueued) { rebuildQueued = false; build(); }

  const raw = Math.min(clock.getDelta(), 1 / 20);
  const dt = raw * params.mech.timeScale;

  vehicle.capacity = params.mech.tankCapacity;
  agent.update(dt);

  // ---- drive the effects off the agent's real state ----
  if (agent.b.drill > 0.05 && agent.state === STATE.DRILL) {
    sparkAccum += params.mech.sparkRate * agent.b.drill * dt;
    while (sparkAccum >= 1) {
      sparkAccum -= 1;
      rig.drill.getWorldPosition(_p);
      effects.burstSparks(_p, agent.site.n, 1, 2.6);
    }
  }
  if (agent.b.pump > 0.1 && agent.site) {
    mistAccum += 26 * agent.b.pump * dt;
    while (mistAccum >= 1) {
      mistAccum -= 1;
      rig.labella.getWorldPosition(_p);
      effects.mist(_p, agent.site.n, 1);
    }
  }
  for (const e of agent.events) {
    if (e.type === 'breach') {
      vehicle.markBreach(e.point);
      effects.burstSparks(e.point, agent.site.n, 40, 4.2);
    }
  }
  agent.events.length = 0;

  effects.update(raw);
  vehicle.update();

  if (follow) {
    rig.thorax.getWorldPosition(_p);
    controls.target.lerp(_p, 1 - Math.exp(-6 * raw));
  }
  controls.update();
  renderer.render(scene, camera);
}
tick();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
