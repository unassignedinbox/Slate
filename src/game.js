import * as THREE from 'three';
import { COURSE, CAR, TIDE, WEAPONS, WORLD } from './config.js';
import { RoadNetwork } from './world/route.js';
import { buildLayout } from './world/layout.js';
import { Field } from './world/field.js';
import { buildTerrain, buildRoads } from './world/terrain.js';
import { buildSky } from './world/sky.js';
import { Ocean } from './world/ocean.js';
import { battlefieldStages } from './world/battlefield.js';
import { Car } from './entities/car.js';
import { BulletPool } from './entities/bullets.js';
import { Effects } from './entities/effects.js';
import { AirSupport } from './entities/planes.js';
import { Sound } from './systems/audio.js';
import { HUD } from './ui/hud.js';
import { clamp, damp, lerp, smoothstep } from './util/mathx.js';

const nextFrame = () =>
  new Promise((r) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(r, 0));
    else setTimeout(r, 0);
  });

/** Stand-in HUD used by the headless simulation harness. */
const nullHUD = {
  startBtn: { addEventListener() {} },
  show() {}, warn() {}, flash() {}, end() {}, update() {},
};

export class Game {
  constructor(container, uiRoot, loaderEl, opts = {}) {
    this.container = container;
    this.uiRoot = uiRoot;
    this.loaderEl = loaderEl;
    this.headless = !!opts.headless;
    this.state = 'loading';
    this.clock = new THREE.Clock();
    this.input = { throttle: 0, brake: 0, steer: 0 };
    this.keys = new Set();
    this.cameraMode = 0;
    this.stats = { mines: 0, hits: 0, bombs: 0 };
    this._shake = 0;
    this._camPos = new THREE.Vector3();
    this._camLook = new THREE.Vector3();
  }

  async load() {
    const setStatus = async (text, pct) => {
      if (!this.headless) {
        this.loaderEl.querySelector('.loadText').textContent = text;
        this.loaderEl.querySelector('.loadBar i').style.width = `${pct}%`;
      }
      await nextFrame();
    };

    // --- renderer ----------------------------------------------------------
    const aspect = this.headless ? 16 / 9 : window.innerWidth / window.innerHeight;
    if (!this.headless) {
      const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.08;
      this.renderer = renderer;
      this.container.appendChild(renderer.domElement);
    }

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(64, aspect, 0.4, 5200);
    this.camera.position.set(0, 12, 340);

    await setStatus('Plotting the beachhead road network', 6);
    this.roads = new RoadNetwork();

    await setStatus('Siting strongpoints, wire and minefields', 12);
    this.layout = buildLayout(this.roads);

    await setStatus('Shaping the ground', 18);
    this.field = new Field(this.layout, this.roads);
    this.roads.gradeTo((x, z) => this.field.base(x, z));
    this.field.bakeRoads({
      minX: -WORLD.halfWidth - 80,
      maxX: WORLD.halfWidth + 80,
      minZ: WORLD.zEnd - 80,
      maxZ: WORLD.zStart + 80,
    });

    await setStatus('Building terrain', 26);
    this.terrain = buildTerrain(this.field, { waterLevel: TIDE.startLevel });
    this.scene.add(this.terrain);

    await setStatus('Grading the roads', 38);
    this.scene.add(buildRoads(this.field, this.roads));

    await setStatus('Raising the sky', 42);
    const sky = buildSky(this.scene);
    this.sun = sky.sun;
    this.clouds = sky.clouds;

    // --- battlefield in stages, so the loader can breathe -------------------
    const { stages, result } = battlefieldStages(this.scene, this.field, this.roads, this.layout);
    let i = 0;
    for (const st of stages) {
      i++;
      await setStatus(st.label, 42 + (i / stages.length) * 44);
      st.run();
    }
    this.colliders = result.colliders;
    this.sentries = result.sentries;
    this.mines = result.mineField;
    this.depots = result.depots;
    this.gate = result.gate;

    await setStatus('Letting the sea in', 90);
    this.ocean = new Ocean(this.field);
    this.scene.add(this.ocean.mesh);

    await setStatus('Warming the engine', 96);
    this.effects = new Effects(this.scene, this.field);
    this.bullets = new BulletPool(this.scene, 512);
    this.audio = new Sound();
    this.planes = new AirSupport(this.scene, this.field, this.effects, this.audio);
    this.car = new Car(this.field, this.colliders, COURSE.spawn);
    this.scene.add(this.car.object);

    this.hud = this.headless ? nullHUD : new HUD(this.uiRoot, this.roads);
    this.hud.startBtn.addEventListener('click', () => this.start());

    if (!this.headless) this.bindEvents();
    await setStatus('Ready', 100);
    if (!this.headless) {
      this.loaderEl.classList.add('hidden');
      this.renderer.setAnimationLoop(() => this.frame());
    }
    this.state = 'brief';
    return this;
  }

  bindEvents() {
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (e.code === 'KeyC') this.cameraMode = (this.cameraMode + 1) % 3;
      if (e.code === 'KeyR') this.restart();
      if (e.code === 'KeyP' && (this.state === 'playing' || this.state === 'paused')) {
        this.state = this.state === 'playing' ? 'paused' : 'playing';
        this.hud.warn(this.state === 'paused' ? 'PAUSED' : 'RESUMED', 1.2);
      }
      if (e.code === 'KeyM' && this.audio) {
        this.audio.enabled = !this.audio.enabled;
        if (this.audio.master) this.audio.master.gain.value = this.audio.enabled ? 0.55 : 0;
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  start() {
    if (!this.headless) this.audio.init();
    this.audio.resume();
    this.hud.show();
    this.state = 'playing';
    this.elapsed = 0;
    this.hud.warn('GO. THE TIDE IS BEHIND YOU.', 3.5);
  }

  restart() {
    // rebuild only what carries state - the world itself is deterministic
    this.car.pos.copy(COURSE.spawn);
    this.car.pos.y = this.field.height(COURSE.spawn.x, COURSE.spawn.z);
    this.car.yaw = Math.PI;
    this.car.speed = 0;
    this.car.vy = 0;
    this.car.health = CAR.maxHealth;
    this.car.alive = true;
    this.car.airborne = false;
    this.car.distanceTravelled = 0;
    this.ocean.time = 0;
    this.ocean.level = TIDE.startLevel;
    this.planes.planes.forEach((p) => {
      this.planes.group.remove(p.model);
      this.planes.group.remove(p.model.userData.shadow);
    });
    this.planes.planes.length = 0;
    this.planes.bombs.forEach((b) => this.planes.group.remove(b.model));
    this.planes.bombs.length = 0;
    this.planes.cooldown = 22;
    this.planes.nearMisses = 0;
    this.stats = { mines: 0, hits: 0, bombs: 0, repairs: 0 };
    this.elapsed = 0;
    for (const d of this.depots) {
      d.taken = false;
      d.model.visible = true;
    }
    if (this.mines.reset) this.mines.reset();
    for (const s of this.sentries) {
      s.state = 'idle';
      s.alerted = 0;
    }
    this.hud.show();
    this.state = 'playing';
    this.hud.warn('AGAIN. GO.', 2.5);
  }

  readInput() {
    const k = this.keys;
    const fwd = k.has('KeyW') || k.has('ArrowUp');
    const back = k.has('KeyS') || k.has('ArrowDown');
    const left = k.has('KeyA') || k.has('ArrowLeft');
    const right = k.has('KeyD') || k.has('ArrowRight');
    const hand = k.has('Space');
    this.input.throttle = fwd ? 1 : 0;
    this.input.brake = back ? 1 : hand ? 1.4 : 0;
    const target = (left ? 1 : 0) - (right ? 1 : 0);
    this.input.steer = target;
  }

  frame() {
    const dt = Math.min(0.05, this.clock.getDelta());
    this.step(dt);
    this.renderer.render(this.scene, this.camera);
  }

  /** One logic tick, renderer-independent (the sim harness drives this). */
  step(dt) {
    if (this.state === 'playing') this.update(dt);
    else if (this.state === 'brief') this.idleCamera(dt);
    else if (this.state !== 'paused') this.updateDead(dt);
  }

  idleCamera(dt) {
    // slow orbit over the surf while the briefing is up
    this.ocean.update(dt * 0.35, this.car.pos);
    const t = performance.now() * 0.00008;
    const r = 60;
    this.camera.position.set(
      this.car.pos.x + Math.sin(t) * r,
      this.field.height(this.car.pos.x, this.car.pos.z) + 22,
      this.car.pos.z + Math.cos(t) * r,
    );
    this.camera.lookAt(this.car.pos.x, this.car.pos.y + 1.2, this.car.pos.z);
    this.effects.update(dt);
    this.updateSun();
  }

  updateDead(dt) {
    this.effects.update(dt);
    this.ocean.update(dt, this.car.pos);
    this.updateCamera(dt);
    this.updateSun();
  }

  update(dt) {
    this.elapsed += dt;
    this.readInput();
    const car = this.car;

    car.update(dt, this.input, this.ocean);
    this.ocean.update(dt, car.pos);

    // --- mines -------------------------------------------------------------
    if (car.alive && Math.abs(car.speed) > 0.6) {
      const near = this.mines.query(car.pos.x, car.pos.z, 2.3);
      for (const m of near) {
        this.mines.detonate(m);
        this.stats.mines++;
        const at = new THREE.Vector3(m.x, m.y + 0.3, m.z);
        if (m.kind === 'tank') {
          this.effects.explosion(at, 2.4);
          car.damage(WEAPONS.tankMineDamage, 'mine');
          car.airborne = true;
          car.vy = 11;
          car.speed *= 0.25;
          this._shake = 1;
          this.audio.mineBlast(1.3);
          this.hud.warn('TELLER MINE', 2.5);
        } else {
          this.effects.explosion(at, 1.1);
          car.damage(WEAPONS.mineDamage, 'mine');
          car.speed *= 0.7;
          this._shake = 0.6;
          this.audio.mineBlast(0.8);
          this.hud.warn('MINE', 2);
        }
      }
    }

    // --- sentries & bullets -------------------------------------------------
    let underFire = false;
    for (const s of this.sentries) {
      s.update(dt, car, this.bullets, this.audio, this.camera);
      if (s.alerted > 0.5 && s.state === 'burst') underFire = true;
    }
    if (underFire) this.hud.warn('UNDER FIRE', 0.6);

    this.bullets.update(dt, this.field, car.alive ? { pos: car.pos, radius: 1.5 } : null, (p, kind) => {
      if (kind === 'car') {
        car.damage(WEAPONS.bulletDamage, 'mg');
        this.stats.hits++;
        this.effects.sparks(new THREE.Vector3(p.x, p.y, p.z));
        this.audio.bulletCrack(0.3);
        this.hud.flash(0.5);
        this._shake = Math.max(this._shake, 0.22);
      } else {
        const d = Math.hypot(p.x - car.pos.x, p.z - car.pos.z);
        if (d < 120) this.effects.dust(new THREE.Vector3(p.x, p.y, p.z), 0.8);
        if (d < 22) this.audio.bulletCrack(0.18);
      }
    });

    // --- aircraft ------------------------------------------------------------
    const progress = this.roads.progress(car.pos.x, car.pos.z);
    const bombsBefore = this.planes.bombs.length;
    this.planes.update(dt, car, progress, this.elapsed);
    if (this.planes.bombs.length > bombsBefore) this.hud.warn('BOMBS AWAY \u2014 GET OFF THE ROAD', 3);
    if (this.planes.planes.length && !this._planeWarned) {
      this.hud.warn('AIRCRAFT INBOUND', 3);
      this._planeWarned = true;
    }
    if (!this.planes.planes.length) this._planeWarned = false;

    // --- field repair dumps ---------------------------------------------------
    if (this.depots) {
      for (const d of this.depots) {
        if (d.taken) continue;
        if (Math.hypot(d.x - car.pos.x, d.z - car.pos.z) > 6.5) continue;
        d.taken = true;
        d.model.visible = false;
        const before = car.health;
        car.health = Math.min(CAR.maxHealth, car.health + 38);
        const gained = Math.round(car.health - before);
        this.stats.repairs = (this.stats.repairs || 0) + 1;
        this.hud.warn(gained > 0 ? `FIELD REPAIR +${gained} HULL` : 'SUPPLIES \u2014 HULL ALREADY GOOD', 2.4);
        this.audio.pickup?.();
        this.effects.dust(new THREE.Vector3(d.x, d.y + 0.8, d.z), 0.7);
      }
    }

    // --- tide ----------------------------------------------------------------
    const depth = this.ocean.level - car.pos.y;
    if (depth > 0.15) {
      if (Math.abs(car.speed) > 4 && Math.random() < 0.6) {
        this.effects.splash(new THREE.Vector3(car.pos.x, this.ocean.level, car.pos.z), 0.8);
      }
      if (depth > 1.25) {
        car.damage(dt * 26, 'drowned');
        this.hud.warn('ENGINE FLOODING', 1);
        this.hud.flash(0.3);
      } else {
        this.hud.warn('WADING \u2014 THE SEA IS HERE', 1);
      }
    }
    const shoreZ = this.ocean.shorelineZ();
    const tideGap = shoreZ - car.pos.z;
    if (tideGap < 90 && tideGap > -5) this.hud.warn('THE TIDE IS ON YOU', 1);

    // --- car condition --------------------------------------------------------
    if (car.damageRatio > 0.45 && Math.random() < car.damageRatio * 0.8) {
      this.effects.smoke(
        new THREE.Vector3(car.pos.x + Math.sin(car.yaw) * 1.9, car.pos.y + 1.0, car.pos.z + Math.cos(car.yaw) * 1.9),
        0.5 + car.damageRatio * 0.6,
        car.damageRatio > 0.8 ? 0x1c1c1c : 0x59595a,
        0x9a9a9a,
      );
    }
    // wheel spray off-road
    const surf = car.surface;
    if (Math.abs(car.speed) > 9 && surf !== 'road' && Math.random() < 0.55) {
      const bx = car.pos.x - Math.sin(car.yaw) * 1.6;
      const bz = car.pos.z - Math.cos(car.yaw) * 1.6;
      this.effects.dust(new THREE.Vector3(bx, this.field.height(bx, bz) + 0.15, bz), 0.7);
    }

    // --- win / lose -------------------------------------------------------------
    const dGate = Math.hypot(car.pos.x - this.gate.x, car.pos.z - this.gate.z);
    if (car.pos.z < COURSE.gateZ + 6 && Math.abs(car.pos.x) < 16) this.finish(true);
    else if (!car.alive) this.finish(false);

    // --- presentation ------------------------------------------------------------
    this.effects.update(dt);
    this.updateCamera(dt);
    this.updateSun();
    this.audio.update(dt, {
      rpm: clamp(Math.abs(car.speed) / CAR.maxSpeed, 0, 1) * (this.input.throttle ? 1 : 0.7) + 0.08,
      load: this.input.throttle,
      surf: clamp(1 - Math.max(0, tideGap) / 420, 0, 1),
      playing: true,
    });

    this.hud.update(dt, {
      distanceToGate: dGate,
      progress,
      tideLevel: this.ocean.level,
      tideGap,
      tideRising: this.ocean.time > TIDE.graceSeconds && this.ocean.level < TIDE.maxLevel,
      shorelineZ: shoreZ,
      health: car.health,
      kmh: car.kmh,
      surface: car.surface,
      carPos: car.pos,
      carYaw: car.yaw,
      sentries: this.sentries,
      planes: this.planes.planes,
    });
  }

  finish(won) {
    if (this.state !== 'playing') return;
    const car = this.car;
    const mins = Math.floor(this.elapsed / 60);
    const secs = Math.floor(this.elapsed % 60);
    const time = `${mins}:${String(secs).padStart(2, '0')}`;
    if (!won) {
      const cause = car.deathCause || 'impact';
      const titles = {
        drowned: 'TAKEN BY THE TIDE',
        mine: 'MINED',
        mg: 'SHOT TO PIECES',
        bomb: 'DIRECT HIT',
        impact: 'WRECKED',
        landing: 'WRECKED',
        wire: 'CAUGHT IN THE WIRE',
      };
      const texts = {
        drowned: 'The sea got into the engine before the wall did.',
        mine: 'A Teller mine under the front axle.',
        mg: 'The bunkers had you in enfilade.',
        bomb: 'Caught in the open by the aircraft.',
        impact: 'The car will not go any further.',
        landing: 'That crest was faster than it looked.',
        wire: 'Wire in the axles, and the guns found you.',
      };
      this.state = 'lost';
      this.hud.end(false, {
        time,
        causeTitle: titles[cause] || 'WRECKED',
        causeText: texts[cause] || 'The car will not go any further.',
        remaining: Math.round(Math.hypot(car.pos.x - this.gate.x, car.pos.z - this.gate.z)),
        distance: Math.round(car.distanceTravelled),
        mines: this.stats.mines,
        hits: this.stats.hits,
        bombs: this.planes.nearMisses || 0,
      });
      this.effects.explosion(new THREE.Vector3(car.pos.x, car.pos.y + 0.8, car.pos.z), car.deathCause === 'drowned' ? 0.6 : 2.6);
      this.audio.explosion(car.pos, 1.4);
    } else {
      this.state = 'won';
      this.hud.end(true, {
        time,
        health: Math.round(car.health),
        distance: Math.round(car.distanceTravelled),
        mines: this.stats.mines,
        hits: this.stats.hits,
        bombs: this.planes.nearMisses || 0,
      });
    }
    this.hud.startBtn.addEventListener('click', () => this.restart());
  }

  updateSun() {
    const c = this.car.pos;
    this.sun.position.set(c.x - 150, c.y + 210, c.z + 130);
    this.sun.target.position.set(c.x, c.y, c.z);
    this.sun.target.updateMatrixWorld();
    this.clouds.position.z -= 0.02;
  }

  updateCamera(dt) {
    const car = this.car;
    const speedK = clamp(Math.abs(car.speed) / CAR.maxSpeed, 0, 1);
    let desired;
    let look;

    if (this.cameraMode === 1) {
      // bonnet cam
      desired = new THREE.Vector3(
        car.pos.x - Math.sin(car.yaw) * -0.2,
        car.pos.y + 1.45,
        car.pos.z - Math.cos(car.yaw) * -0.2,
      );
      look = new THREE.Vector3(
        car.pos.x + Math.sin(car.yaw) * 24,
        car.pos.y + 1.6,
        car.pos.z + Math.cos(car.yaw) * 24,
      );
      this._camPos.copy(desired);
    } else if (this.cameraMode === 2) {
      // high tactical view
      desired = new THREE.Vector3(car.pos.x, car.pos.y + 46, car.pos.z + 34);
      look = new THREE.Vector3(car.pos.x, car.pos.y, car.pos.z - 24);
      this._camPos.lerp(desired, 1 - Math.exp(-6 * dt));
    } else {
      const back = 9.5 + speedK * 3.2;
      const height = 3.6 + speedK * 1.0;
      desired = new THREE.Vector3(
        car.pos.x - Math.sin(car.yaw) * back - Math.cos(car.yaw) * car.slip * 2.2,
        car.pos.y + height,
        car.pos.z - Math.cos(car.yaw) * back + Math.sin(car.yaw) * car.slip * 2.2,
      );
      const ground = this.field.height(desired.x, desired.z) + 1.8;
      desired.y = Math.max(desired.y, ground);
      look = new THREE.Vector3(
        car.pos.x + Math.sin(car.yaw) * 9,
        car.pos.y + 1.7,
        car.pos.z + Math.cos(car.yaw) * 9,
      );
      this._camPos.lerp(desired, 1 - Math.exp(-(7 + speedK * 4) * dt));
    }

    this._camLook.lerp(look, 1 - Math.exp(-9 * dt));

    // shake from impacts, mines, bombs and landings
    this._shake = Math.max(
      this._shake - dt * 1.9,
      Math.max(car.impactShake || 0, car.landShake || 0),
    );
    const sh = this._shake;
    const jitter = sh * 0.55;
    this.camera.position.set(
      this._camPos.x + (Math.random() - 0.5) * jitter,
      this._camPos.y + (Math.random() - 0.5) * jitter,
      this._camPos.z + (Math.random() - 0.5) * jitter,
    );
    this.camera.lookAt(this._camLook);
    this.camera.rotateZ((Math.random() - 0.5) * sh * 0.04 - car.slip * 0.05);

    const targetFov = 64 + speedK * 11 + (car.airborne ? 3 : 0);
    this.camera.fov = damp(this.camera.fov, targetFov, 5, dt);
    this.camera.updateProjectionMatrix();
  }
}
