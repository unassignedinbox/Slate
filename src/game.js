import * as THREE from 'three';
import { Terrain, SURF, SURFACE_DUST } from './terrain.js';
import { Ocean } from './water.js';
import { createSky } from './sky.js';
import { Fx } from './fx.js';
import { Colliders } from './physics.js';
import { Car } from './car.js';
import { ChaseCamera, CAM_MODES } from './camera.js';
import { buildWall } from './wall.js';
import { buildTanks } from './tanks.js';
import { buildObstacles } from './obstacles.js';
import { Minefield } from './mines.js';
import { DefenseNetwork } from './defense.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { Hud } from './hud.js';
import { CAR, DIFFICULTY, OBJECTIVE, ROADS, SPAWN, TIDE, WALL } from './config.js';
import {
  clamp,
  lerp,
  damp,
  dampAngle,
  angleDelta,
  smoothstep,
  resamplePolyline,
  formatTime,
} from './util.js';

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

export class Game {
  constructor(container) {
    this.container = container;
    this.state = 'loading';
    this.time = 0;
    this.runTime = 0;
    this.fps = 60;
    this.cameraMode = 0;
    this.recoverHold = 0;
    this.hud = new Hud();
    this.audio = new Audio();
    this.paused = false;
    this.endTimer = 0;
    this.stats = { mines: 0, hits: 0, crashes: 0 };
    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();
    this._camTarget = new THREE.Vector3();
    this._camPos = new THREE.Vector3();
    this._camLook = new THREE.Vector3();
    this.camRoll = 0;
    this._listener = { pos: new THREE.Vector3(), right: new THREE.Vector3(1, 0, 0) };
  }

  /* ---------------------------------------------------------------- */
  /* Boot                                                              */
  /* ---------------------------------------------------------------- */

  async build() {
    const hud = this.hud;
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.02;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(renderer.domElement);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    this.scene = scene;

    this.camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.4, 4600);
    this.camera.position.set(SPAWN.x + 14, 18, SPAWN.z + 34);

    hud.setLoading(0.08, 'Shaping the beach…');
    await nextFrame();
    this.terrain = new Terrain();
    scene.add(this.terrain.mesh);

    hud.setLoading(0.3, 'Bringing in the tide…');
    await nextFrame();
    this.sky = createSky(scene, renderer);
    this.ocean = new Ocean(this.terrain, this.sky.sunDir, 0xb5c2cb);
    scene.add(this.ocean.mesh);
    this.ocean.update(0, false);

    hud.setLoading(0.42, 'Pouring concrete…');
    await nextFrame();
    this.colliders = new Colliders();
    this.fx = new Fx(scene, this.terrain);
    this.wall = buildWall(scene, this.terrain, this.colliders);

    hud.setLoading(0.56, 'Abandoning armour…');
    await nextFrame();
    this.tanks = buildTanks(scene, this.terrain, this.colliders, this.fx);

    hud.setLoading(0.7, 'Laying wire and steel…');
    await nextFrame();
    this.obstacles = buildObstacles(scene, this.terrain, this.colliders, this.ocean);

    hud.setLoading(0.84, 'Burying mines…');
    await nextFrame();
    this.minefield = new Minefield(scene, this.terrain, this.colliders, this.fx);

    hud.setLoading(0.93, 'Manning the bunkers…');
    await nextFrame();
    this.defense = new DefenseNetwork(scene, this.terrain, this.colliders, this.fx, this.wall.mounts);

    this.car = new Car(this.terrain, this.ocean);
    scene.add(this.car.object);
    this.chaseCam = new ChaseCamera(this.camera, this.terrain, this.ocean);
    this._carSmokeTimer = 0;
    this.fx.addEmitter((dt) => this._carFx(dt));

    // Flat list of road points for the recovery feature.
    this.roadPoints = [];
    for (const r of ROADS) {
      for (const p of resamplePolyline(r.points, 6)) this.roadPoints.push(p);
    }

    this.input = new Input(window);
    this.input.onAction = (a) => this.onAction(a);

    window.addEventListener('resize', () => this.onResize());
    this.onResize();

    hud.setLoading(1, 'Ready');
    await nextFrame();
    hud.hideLoading();

    this.state = 'briefing';
    this.cinematic = { t: 0, active: true };
    this.bindUi();
    this.clock = new THREE.Clock();
    this.loop();
  }

  bindUi() {
    const start = document.getElementById('startBtn');
    const tour = document.getElementById('tourBtn');
    const again = document.getElementById('againBtn');
    if (start) start.addEventListener('click', () => this.startRun());
    if (tour) tour.addEventListener('click', () => this.toggleTour());
    if (again) again.addEventListener('click', () => this.restart());
  }

  onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /* ---------------------------------------------------------------- */
  /* Flow                                                              */
  /* ---------------------------------------------------------------- */

  startRun() {
    this.audio.resume();
    this.hud.showBriefing(false);
    this.hud.hideEnd();
    this.state = 'running';
    this.cinematic.active = false;
    this.runTime = 0;
    this.endShown = false;
    this.endCause = null;
    this.input.enabled = true;
    this.hud.hint('Head north — the breach is the glowing gate in the wall', 6);
    this.hintStage = 0;
  }

  toggleTour() {
    this.audio.resume();
    this.cinematic.active = !this.cinematic.active;
    this.hud.showBriefing(!this.cinematic.active);
  }

  restart() {
    this.car.reset();
    this.car.object.visible = true;
    this.ocean.elapsed = 0;
    this.ocean.update(0, false);
    this.runTime = 0;
    this.stats = { mines: 0, hits: 0, crashes: 0 };

    // Re-arm the beach: mines, guns, effects and supply crates.
    this.minefield.reset();
    this.defense.reset();
    this.fx.reset();
    for (const crate of this.obstacles.repairCrates) {
      crate.taken = false;
      crate.object.visible = true;
    }

    this.hud.hideEnd();
    this.hud.showBriefing(false);
    this.hud.flash(0);
    this.state = 'running';
    this.endTimer = 0;
    this.endShown = false;
    this.endCause = null;
    this.hintStage = 0;
    this.recoverHold = 0;
    this.cinematic.active = false;
    this.input.enabled = true;
    if (this.chaseCam) this.chaseCam.snap(this.car);
    this.hud.hint('Fresh attempt — low tide, full minefield', 4);
  }

  finish(won, cause) {
    if (this.state !== 'running') return;
    this.state = won ? 'won' : 'lost';
    this.endTimer = won ? 1.6 : 2.4;
    this.endCause = cause;
    this.input.enabled = false;
    if (!won) {
      this.fx.explosion(this.car.object.position, 2.2, { debrisColor: 0x55504a });
      this.audio.explosion(this.car.object.position, this._listener, 1.4);
      this.car.object.visible = false;
    } else {
      this.audio.beep(660, 0.12, 0.1);
      setTimeout(() => this.audio.beep(990, 0.18, 0.1), 130);
    }
  }

  showEndScreen() {
    const won = this.state === 'won';
    const cause = this.endCause;
    const texts = {
      drown: 'The water came over the sills and the engine drowned. The Channel does not negotiate.',
      gunfire: 'The bunker line found the range. The car went up two hundred metres short of the gate.',
      mine: 'A Teller mine under the front axle. There was not much left to drive.',
      crash: 'Too much speed into too much steel. The chassis folded.',
      impact: 'The landing broke the back of the car.',
    };
    this.hud.showEnd({
      won,
      kicker: won ? 'Mission report · objective secured' : 'Mission report · vehicle lost',
      title: won ? 'Breach reached' : 'Run ended',
      text: won
        ? 'You put a civilian saloon through a minefield, a wire belt and four bunkers of massed fire, and parked it under the wall. The sappers can take it from here.'
        : texts[cause] || 'The beach won this one.',
      time: this.runTime,
      distance: this.car.distanceTravelled,
      hp: this.car.health,
      mines: this.stats.mines,
      tide: this.ocean.tideProgress,
    });
  }

  onAction(action) {
    switch (action) {
      case 'camera':
        this.cameraMode = (this.cameraMode + 1) % 3;
        this.hud.hint(CAM_MODES[this.cameraMode], 1.6);
        break;
      case 'pause':
        if (this.state === 'running') {
          this.paused = !this.paused;
          this.hud.hint(this.paused ? 'Paused' : 'Resumed', 1.5);
        }
        break;
      case 'mute': {
        const m = this.audio.toggleMute();
        this.hud.hint(m ? 'Sound off' : 'Sound on', 1.5);
        break;
      }
      case 'recoverStart':
        this.recoverHold = 0.0001;
        break;
      case 'recoverEnd':
        this.recoverHold = 0;
        break;
      case 'confirm':
        if (this.state === 'briefing') this.startRun();
        else if (this.state === 'won' || this.state === 'lost') this.restart();
        break;
      default:
        break;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Per-frame vehicle effects                                         */
  /* ---------------------------------------------------------------- */

  _carFx(dt) {
    const car = this.car;
    if (!car) return;
    const fx = this.fx;
    const speed = Math.abs(car.speed);
    const pos = car.object.position;

    // Wheel dust / spray.
    this._dustTimer = (this._dustTimer || 0) + dt;
    if (car.alive && speed > 3 && this._dustTimer > 0.045) {
      this._dustTimer = 0;
      const back = car.forward.clone().multiplyScalar(-1.4);
      const side = car.right.clone().multiplyScalar(0.8);
      for (const s of [-1, 1]) {
        const p = {
          x: pos.x + back.x + side.x * s,
          y: this.terrain.heightAt(pos.x + back.x + side.x * s, pos.z + back.z + side.z * s) + 0.1,
          z: pos.z + back.z + side.z * s,
        };
        const depth = car.waterDepth || 0;
        if (depth > 0.06) {
          if (speed > 5) fx.splash(p, clamp(speed / 22, 0.2, 1));
        } else {
          const color = SURFACE_DUST[car.surface] ?? 0xd7c69a;
          fx.dust(p, car.forward, speed > 16 ? 2 : 1, color);
        }
      }
    }

    // Damage smoke / fire.
    if (car.health < 58) {
      this._carSmokeTimer += dt;
      const rate = car.health < 26 ? 0.05 : 0.14;
      if (this._carSmokeTimer > rate) {
        this._carSmokeTimer = 0;
        const hood = car.object.localToWorld(new THREE.Vector3(0, 1.0, 1.6));
        fx.smoke(hood, {
          color: car.health < 26 ? 0x2a2724 : 0x6d6a64,
          size: 0.6,
          size1: 3.4,
          alpha: 0.5,
          life: 1.9,
          vy: 1.6,
          gravity: 1.2,
          drag: 0.7,
        });
        if (car.health < 26) {
          fx.glowPool.spawn(hood.x, hood.y, hood.z, {
            color: 0xff8a2a,
            size: 0.9,
            size1: 0.1,
            alpha: 0.9,
            life: 0.3,
            vy: 2.4,
          });
        }
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* Camera                                                            */
  /* ---------------------------------------------------------------- */

  updateCamera(dt) {
    if (this.cinematic.active) {
      const cam = this.camera;
      this.cinematic.t += dt;
      const t = this.cinematic.t;
      const z = lerp(250, -180, clamp((t % 46) / 46, 0, 1));
      const x = Math.sin(t * 0.12) * 120;
      const y = this.terrain.heightAt(x, z) + lerp(46, 26, clamp((t % 46) / 46, 0, 1));
      cam.position.set(x, y, z);
      this._camTarget.set(
        WALL.gateX + Math.sin(t * 0.2) * 40,
        this.terrain.heightAt(0, -240) + 8,
        WALL.z + 10
      );
      cam.lookAt(this._camTarget);
      cam.fov = 52;
      cam.updateProjectionMatrix();
      this.chaseCam.initialised = false; // re-seat the rig when play resumes
      return;
    }

    this.chaseCam.setMode(this.cameraMode);
    this.chaseCam.update(dt, this.car, { state: this.state, shake: this.fx.shake });
  }

  /* ---------------------------------------------------------------- */
  /* Simulation                                                        */
  /* ---------------------------------------------------------------- */

  update(dt) {
    this.time += dt;
    const running = this.state === 'running' && !this.paused;
    this.input.update(dt);

    if (running) this.runTime += dt;

    this.ocean.update(dt, running);
    this.wall.update(dt, this.time);
    this.obstacles.update(dt, this.time);

    const car = this.car;
    const inputState = {
      throttle: this.input.throttle,
      brake: this.input.brake,
      steer: this.input.steer,
      handbrake: this.input.handbrake,
    };

    let wire = 0;
    if (running || this.state === 'won' || this.state === 'lost') {
      const ctx = { dragPenalty: this._wirePenalty || 0 };
      car.update(dt, running ? inputState : { throttle: 0, brake: 1, steer: 0, handbrake: false }, {
        ...ctx,
        onHardLanding: (p, impact) => {
          this.fx.dust({ x: p.x, y: p.y + 0.2, z: p.z }, null, 6, SURFACE_DUST[car.surface] ?? 0xd7c69a);
          this.fx.addShake(clamp(impact / 26, 0, 0.5));
          this.audio.crash(clamp(impact / 20, 0.2, 1));
        },
      });

      const res = this.colliders.resolveCar(car, dt, {
        onCrash: (item, dmg, point) => {
          this.stats.crashes++;
          this.fx.sparks({ x: point.x, y: car.pos.y + 0.7, z: point.z }, null, 6, 0xffd08a);
          this.fx.addShake(clamp(dmg / 22, 0.05, 0.5));
          this.hud.flash(clamp(dmg / 30, 0.15, 0.8));
          this.audio.crash(clamp(dmg / 18, 0.2, 1));
        },
      });
      wire = res.wire;
      if (res.damage > 0.5) this.hud.flash(clamp(res.damage / 30, 0.1, 0.7));
    }
    this._wirePenalty = wire ? 1 : 0;
    if (wire && car.alive) {
      car.damage(DIFFICULTY.wireDps * dt, 'wire');
      if (Math.random() < 0.06) this.fx.sparks(car.object.position, null, 2, 0xbfc7cc);
    }

    // Mines + defenders.
    const mineCtx = {
      car,
      audio: this.audio,
      listener: this._listener,
    };
    const beforeMines = this.minefield.triggered;
    this.minefield.update(dt, mineCtx);
    if (this.minefield.triggered > beforeMines) {
      this.stats.mines += this.minefield.triggered - beforeMines;
      this.hud.flash(0.55);
    }

    if (this.state !== 'briefing') {
      this.defense.update(dt, car, {
        audio: this.audio,
        listener: this._listener,
        playerVisible: this.state === 'running',
        onShellImpact: (pos) => {
          this.fx.explosion(pos, 1.9, { debrisColor: 0x9b8763 });
          this.audio.explosion(pos, this._listener, 1.2);
          const d = Math.hypot(car.pos.x - pos.x, car.pos.z - pos.z);
          if (d < 12 && car.alive) {
            const falloff = 1 - clamp(d / 12, 0, 1);
            car.damage(DIFFICULTY.atDamage * (0.4 + falloff * 0.8), 'gunfire');
            const push = new THREE.Vector3(car.pos.x - pos.x, 0, car.pos.z - pos.z)
              .normalize()
              .multiplyScalar(9 * falloff);
            push.y = 7 * falloff;
            car.applyImpulse(push);
            this.hud.flash(0.8);
          }
          this.fx.addShake(clamp(24 / Math.max(d, 6), 0, 0.9));
          this.minefield.detonateNear(pos.x, pos.z, 7);
        },
      });
    }

    // Repair crates.
    for (const crate of this.obstacles.repairCrates) {
      if (crate.taken) continue;
      const d = Math.hypot(car.pos.x - crate.x, car.pos.z - crate.z);
      if (d < 3.6 && car.alive) {
        crate.taken = true;
        crate.object.visible = false;
        car.heal(28);
        this.audio.beep(760, 0.1, 0.09);
        setTimeout(() => this.audio.beep(1100, 0.12, 0.07), 90);
        this.hud.hint('Field repair · +28% integrity', 2.6);
      }
    }

    // Recovery (hold R).
    if (this.recoverHold > 0 && this.state === 'running') {
      this.recoverHold += dt;
      if (this.recoverHold > 1.1) {
        this.recoverHold = 0;
        this.recoverToRoad();
      } else if (this.recoverHold > 0.15) {
        this.hud.hint('Recovering…', 0.5);
      }
    }

    this.fx.update(dt, this.camera);
    this.sky.followTarget(car.object.position);

    // Audio listener frame.
    this._listener.pos.copy(this.camera.position);
    this.camera.getWorldDirection(this._tmp);
    this._listener.right.set(this._tmp.z, 0, -this._tmp.x).normalize();
    this.audio.updateEngine(dt, {
      speed: car.speed,
      throttle: this.input.throttle,
      alive: car.alive && this.state === 'running',
      submerged: car.submerged,
    });
    this.audio.updateAmbience(Math.abs(car.pos.z - this.ocean.shorelineZ()), Math.abs(car.speed));

    // Win / lose checks.
    if (this.state === 'running') {
      const dObj = Math.hypot(car.pos.x - OBJECTIVE.x, car.pos.z - OBJECTIVE.z);
      if (dObj < OBJECTIVE.radius) this.finish(true, 'objective');
      else if (!car.alive) this.finish(false, car.deathCause || 'crash');
      this.updateHints(dt, dObj);
    } else if (this.state === 'won' || this.state === 'lost') {
      this.endTimer -= dt;
      if (this.endTimer <= 0 && !this.endShown) {
        this.endShown = true;
        this.showEndScreen();
      }
    }

    this.updateCamera(dt);
  }

  updateHints(dt, dObj) {
    const car = this.car;
    if (car.stuckTimer > 2.6) this.hud.hint('Stuck? Hold R to be recovered onto the nearest track', 3);
    if (this.hintStage === 0 && car.pos.z < 150) {
      this.hintStage = 1;
      this.hud.hint('Wrecked armour and earth mounds block the bunkers’ line of sight', 5);
    } else if (this.hintStage === 1 && car.pos.z < 20) {
      this.hintStage = 2;
      this.hud.hint('Gravel tracks are cleared of mines — but the wall can see them', 5);
    } else if (this.hintStage === 2 && car.pos.z < -140) {
      this.hintStage = 3;
      this.hud.hint('Dragon’s teeth ahead — the breach is the only way through', 5);
    }
  }

  recoverToRoad() {
    const car = this.car;
    let best = null;
    let bestD = Infinity;
    for (const p of this.roadPoints) {
      const d = Math.hypot(p[0] - car.pos.x, p[1] - car.pos.z);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    if (!best) return;
    car.pos.set(best[0], this.terrain.heightAt(best[0], best[1]), best[1]);
    car.vel.set(0, 0, 0);
    car.speed = 0;
    car.yaw = Math.PI;
    car.airborne = false;
    car.damage(5, 'recover');
    car.stuckTimer = 0;
    if (this.chaseCam) this.chaseCam.snap(car);
    this.fx.dust({ x: car.pos.x, y: car.pos.y + 0.4, z: car.pos.z }, null, 8, 0xc9b78d);
    this.hud.hint('Recovered onto the track (−5% integrity)', 2.4);
  }

  /* ---------------------------------------------------------------- */
  /* Loop                                                              */
  /* ---------------------------------------------------------------- */

  loop() {
    const tick = () => {
      requestAnimationFrame(tick);
      const raw = this.clock.getDelta();
      const dt = Math.min(raw, 1 / 20);
      this.fps = lerp(this.fps, 1 / Math.max(raw, 1e-4), 0.08);

      this.update(dt);
      this.renderer.render(this.scene, this.camera);
      this.updateHud(dt);
    };
    tick();
  }

  updateHud(dt) {
    const car = this.car;
    const mineDist = this.minefield.nearest(car.pos.x, car.pos.z, 30);
    const shoreZ = this.ocean.shorelineZ();
    const zone =
      car.pos.z > 150
        ? 'SURF'
        : car.pos.z > 40
        ? 'OPEN BEACH'
        : car.pos.z > -80
        ? 'WIRE LINE'
        : car.pos.z > -180
        ? 'TRENCH LINE'
        : 'WALL APRON';
    const dObj = Math.hypot(car.pos.x - OBJECTIVE.x, car.pos.z - OBJECTIVE.z);

    this.hud.update(dt, {
      distanceToObjective: dObj,
      sector: zone,
      objectiveText: dObj < 60 ? 'Drive into the breach' : 'Reach the breach',
      tideProgress: this.ocean.tideProgress,
      time: this.runTime,
      fps: this.fps,
      health: car.health,
      speed: car.speedKmh,
      onRoad: car.onRoad > 0.4,
      inWater: (car.waterDepth || 0) > 0.25,
      inWire: !!this._wirePenalty,
      airborne: car.airborne,
      underFire: this.defense.targeted && this.state === 'running',
      mineNear: mineDist < 22,
      mineDistance: mineDist,
      drowning: (car.waterDepth || 0) > 0.9,
      critical: car.health < 26,
      carX: car.pos.x,
      carZ: car.pos.z,
      carYaw: car.yaw,
      shorelineZ: shoreZ,
    });

    // Proximity ping for buried mines.
    this._pingTimer = (this._pingTimer || 0) - dt;
    if (mineDist < 18 && this.state === 'running' && this._pingTimer <= 0) {
      this._pingTimer = clamp(mineDist / 26, 0.16, 0.9);
      this.audio.beep(520 + (22 - Math.min(mineDist, 22)) * 26, 0.05, 0.05);
    }
  }
}
