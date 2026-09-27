import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import { Track } from './track.js';
import { buildEnvironment, drawJumbotron } from './environment.js';
import { Car, LIVERIES } from './car.js';
import { Input } from './input.js';
import { HUD, fmtTime } from './hud.js';
import { EngineAudio } from './audio.js';
import { LANDMARKS } from './trackData.js';
import { smokeTexture } from './textures.js';

const TOTAL_LAPS = 5;
const CAMERAS = ['CHASE', 'CLOSE', 'HOOD', 'TRACKSIDE', 'ORBIT'];

class Game {
  constructor() {
    this.canvas = document.getElementById('scene');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(64, window.innerWidth / window.innerHeight, 0.4, 6000);
    this.camera.position.set(-120, 30, -110);

    this.track = new Track();
    this.scene.add(this.track.group);
    this.env = buildEnvironment(this.scene);

    this.car = new Car(this.track, 0);
    this.scene.add(this.car.mesh);
    this.scene.add(this.car.shadow);

    this._buildParticles();
    this._buildTracksideCams();

    this.input = new Input(this.canvas);
    this.hud = new HUD(this.track);
    this.audio = new EngineAudio();

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enabled = false;
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.495;

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.62, 0.62, 0.72);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.camMode = 0;
    this.camPos = new THREE.Vector3().copy(this.camera.position);
    this.camLook = new THREE.Vector3().copy(this.car.position);
    this.state = 'idle';
    this.countdown = 0;
    this.lap = 0;
    this.lapStart = 0;
    this.current = 0;
    this.best = null;
    this.last = null;
    this.halfPassed = false;
    this.lastIndex = this.car.hint;
    this.clock = new THREE.Clock();
    this.fps = 60;
    this._fpsAcc = 0;
    this._fpsN = 0;
    this._jumboT = 0;
    this.section = '';
    this.finished = false;

    this._bindKeys();
    window.addEventListener('resize', () => this.resize());
    this.track.setStartLights(0);
    document.getElementById('loading').classList.add('hidden');
    this.hud.message('MOTORBALL CIRCUIT', 'PRESS W / UP TO ROLL OUT', 3200);
  }

  _buildParticles() {
    const COUNT = 260;
    this.pCount = COUNT;
    this.particles = [];
    const pos = new Float32Array(COUNT * 3);
    const life = new Float32Array(COUNT);
    const size = new Float32Array(COUNT);
    const tint = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      life[i] = 1;
      this.particles.push({ p: new THREE.Vector3(), v: new THREE.Vector3(), t: 1, dur: 1, size: 1 });
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aLife', new THREE.BufferAttribute(life, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aTint', new THREE.BufferAttribute(tint, 3));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      uniforms: { uMap: { value: smokeTexture() }, uPR: { value: this.renderer.getPixelRatio() } },
      vertexShader: `
        attribute float aLife; attribute float aSize; attribute vec3 aTint;
        varying float vLife; varying vec3 vTint; uniform float uPR;
        void main(){
          vLife = aLife; vTint = aTint;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uPR * (260.0 / max(1.0, -mv.z));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D uMap; varying float vLife; varying vec3 vTint;
        void main(){
          if (vLife >= 1.0) discard;
          vec4 t = texture2D(uMap, gl_PointCoord);
          float a = t.a * (1.0 - vLife) * 0.55;
          gl_FragColor = vec4(vTint, a);
        }`,
    });
    this.pPoints = new THREE.Points(geo, mat);
    this.pPoints.frustumCulled = false;
    this.scene.add(this.pPoints);
    this.pCursor = 0;
  }

  _emit(p, v, size, dur, tint) {
    const i = this.pCursor % this.pCount;
    this.pCursor++;
    const pt = this.particles[i];
    pt.p.copy(p);
    pt.v.copy(v);
    pt.t = 0;
    pt.dur = dur;
    pt.size = size;
    const c = this.pPoints.geometry.getAttribute('aTint');
    c.setXYZ(i, tint.r, tint.g, tint.b);
    c.needsUpdate = true;
  }

  _updateParticles(dt) {
    const posA = this.pPoints.geometry.getAttribute('position');
    const lifeA = this.pPoints.geometry.getAttribute('aLife');
    const sizeA = this.pPoints.geometry.getAttribute('aSize');
    for (let i = 0; i < this.pCount; i++) {
      const p = this.particles[i];
      if (p.t >= 1) {
        lifeA.setX(i, 1);
        continue;
      }
      p.t += dt / p.dur;
      p.v.multiplyScalar(1 - dt * 1.4);
      p.v.y += dt * 1.6;
      p.p.addScaledVector(p.v, dt);
      posA.setXYZ(i, p.p.x, p.p.y, p.p.z);
      lifeA.setX(i, Math.min(1, p.t));
      sizeA.setX(i, p.size * (1 + p.t * 2.2));
    }
    posA.needsUpdate = true;
    lifeA.needsUpdate = true;
    sizeA.needsUpdate = true;
  }

  _buildTracksideCams() {
    this.tracksideCams = [];
    const N = this.track.N;
    for (let i = 0; i < N; i += Math.round(N / 14)) {
      const p = this.track.pointAt(i, this.track.widths[i] * 1.5, 9);
      p.y += 4;
      this.tracksideCams.push(p);
    }
  }

  _bindKeys() {
    this.input.onPress = (code) => {
      if (this.state === 'idle' && ['KeyW', 'ArrowUp', 'Touch'].includes(code)) this.beginCountdown();
      switch (code) {
        case 'KeyC':
          this.camMode = (this.camMode + 1) % CAMERAS.length;
          this.controls.enabled = CAMERAS[this.camMode] === 'ORBIT';
          if (this.controls.enabled) this.controls.target.copy(this.car.position);
          this.hud.message(CAMERAS[this.camMode] + ' CAM', '', 900);
          break;
        case 'KeyR':
          this.resetRace();
          break;
        case 'KeyL': {
          const L = this.car.setLivery(this.car.liveryIndex + 1);
          this.hud.message(L.name, 'LIVERY', 1100);
          break;
        }
        case 'KeyM':
          this.hud.message(this.audio.toggle() ? 'SOUND ON' : 'SOUND OFF', '', 900);
          break;
        case 'KeyB':
          this.bloom.enabled = !this.bloom.enabled;
          this.hud.message(this.bloom.enabled ? 'BLOOM ON' : 'BLOOM OFF', '', 900);
          break;
        case 'KeyH':
          document.body.classList.toggle('hide-hud');
          break;
        case 'Backquote':
          document.getElementById('help').classList.toggle('open');
          break;
        default:
          break;
      }
      if (!this.audio.ctx) this.audio.start();
    };

    document.querySelectorAll('[data-touch]').forEach((el) => {
      this.input.bindTouchButton(el, el.dataset.touch);
    });
    document.getElementById('helpToggle').addEventListener('click', () => {
      document.getElementById('help').classList.toggle('open');
    });
  }

  beginCountdown() {
    this.state = 'countdown';
    this.countdown = 4.2;
    this.car.respawn();
    this.lastIndex = this.car.hint;
  }

  resetRace() {
    this.car.respawn();
    this.lap = 0;
    this.current = 0;
    this.last = null;
    this.halfPassed = false;
    this.finished = false;
    this.lastIndex = this.car.hint;
    this.track.setStartLights(0);
    this.beginCountdown();
    this.hud.message('RESTART', '', 900);
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
  }

  // ------------------------------------------------------------- lap logic
  _lapCheck(index, dtms) {
    const N = this.track.N;
    const start = this.track.startIndex;
    const half = (start + Math.floor(N / 2)) % N;
    const prev = this.lastIndex;
    const delta = (index - prev + N) % N;
    const forward = delta < N / 2;

    if (forward && delta > 0) {
      const passed = (target) => {
        const d1 = (target - prev + N) % N;
        return d1 > 0 && d1 <= delta;
      };
      if (passed(half)) this.halfPassed = true;
      if (passed(start) && this.halfPassed) {
        this.halfPassed = false;
        if (this.state === 'racing') {
          this.last = this.current;
          if (this.best === null || this.current < this.best) {
            this.best = this.current;
            this.hud.message('FASTEST LAP', fmtTime(this.current), 2000);
          } else {
            this.hud.message(`LAP ${this.lap}`, fmtTime(this.current), 1500);
          }
          this.lap++;
          this.current = 0;
          if (this.lap > TOTAL_LAPS) {
            this.finished = true;
            this.state = 'finished';
            this.hud.message('FINISH', `BEST ${fmtTime(this.best)}`, 6000);
          }
        }
      }
    }
    this.lastIndex = index;
    if (this.state === 'racing' && !this.finished) this.current += dtms;
  }

  _sectionName(p) {
    let best = '';
    let bd = Infinity;
    for (const l of LANDMARKS) {
      const d = (l.x - p.x) ** 2 + (l.z - p.z) ** 2;
      if (d < bd) {
        bd = d;
        best = l.name;
      }
    }
    return best;
  }

  // ---------------------------------------------------------------- camera
  _updateCamera(dt, surf) {
    const car = this.car;
    const mode = CAMERAS[this.camMode];
    const n = surf.normal;
    const f = new THREE.Vector3(Math.sin(car.yaw), 0, Math.cos(car.yaw));
    f.addScaledVector(n, -f.dot(n)).normalize();
    const blendUp = new THREE.Vector3().lerpVectors(new THREE.Vector3(0, 1, 0), n, 0.55).normalize();
    const speedT = THREE.MathUtils.clamp(Math.abs(car.speed) / 80, 0, 1);

    if (mode === 'ORBIT') {
      this.controls.target.lerp(car.position, Math.min(1, dt * 4));
      this.controls.update();
      return;
    }

    let desired = new THREE.Vector3();
    let look = new THREE.Vector3();
    let fov = 64;

    if (mode === 'CHASE' || mode === 'CLOSE') {
      const dist = mode === 'CHASE' ? 10.5 + speedT * 2.6 : 7.2;
      const height = mode === 'CHASE' ? 3.6 : 2.4;
      desired.copy(car.position).addScaledVector(f, -dist).addScaledVector(blendUp, height);
      look.copy(car.position).addScaledVector(f, 7).addScaledVector(blendUp, 1.2);
      fov = 62 + speedT * 12 + (car.boosting ? 5 : 0);
      const lag = Math.min(1, dt * (mode === 'CLOSE' ? 9 : 5.2));
      this.camPos.lerp(desired, lag);
      // never let the camera sink through the road
      const cs = this.track.sample(this.camPos, car.hint, {});
      const above = this.camPos.clone().sub(cs.surface).dot(cs.normal);
      if (above < 1.4) this.camPos.addScaledVector(cs.normal, 1.4 - above);
    } else if (mode === 'HOOD') {
      desired.copy(car.position).addScaledVector(blendUp, 0.95).addScaledVector(f, 0.35);
      look.copy(desired).addScaledVector(f, 30).addScaledVector(blendUp, -0.8);
      fov = 70 + speedT * 12;
      this.camPos.lerp(desired, 1);
    } else if (mode === 'TRACKSIDE') {
      let bestP = this.tracksideCams[0];
      let bd = Infinity;
      for (const p of this.tracksideCams) {
        const d = p.distanceToSquared(car.position);
        if (d < bd) {
          bd = d;
          bestP = p;
        }
      }
      this.camPos.lerp(bestP, Math.min(1, dt * 3));
      look.copy(car.position);
      fov = THREE.MathUtils.clamp(46 - Math.sqrt(bd) * 0.14, 16, 46);
      desired.copy(bestP);
    }

    this.camLook.lerp(look, Math.min(1, dt * 7));
    this.camera.position.copy(this.camPos);
    this.camera.up.copy(blendUp);
    this.camera.lookAt(this.camLook);
    this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 4);
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------ loop
  frame() {
    const dt = Math.min(this.clock.getDelta(), 1 / 20);
    const car = this.car;
    this.input.update(dt);

    // countdown
    if (this.state === 'countdown') {
      this.countdown -= dt;
      const lights = 5 - Math.max(0, Math.ceil((this.countdown - 1.2) / 0.6));
      this.track.setStartLights(THREE.MathUtils.clamp(lights, 0, 5));
      const n = Math.ceil(this.countdown - 1.2);
      if (n > 0 && n <= 3) this.hud.message(String(n), '', 400);
      if (this.countdown <= 1.2) {
        this.track.setStartLights(5, true);
        if (this.state !== 'racing') {
          this.state = 'racing';
          this.lap = 1;
          this.current = 0;
          this.halfPassed = false;
          this.hud.message('GO', '', 900);
        }
      }
    }
    if (this.state === 'racing' && this.countdown > -4) {
      this.countdown -= dt;
      if (this.countdown < -3.8) this.track.setStartLights(0);
    }

    const frozen = this.state === 'countdown' || this.state === 'idle';
    const surf = car.update(dt, this.input, frozen);
    this._lapCheck(surf.index, dt * 1000);

    // tyre smoke + boost sparks
    if (car.grounded && (car.slip > 0.28 || (car.boosting && Math.abs(car.speed) < 55))) {
      const back = new THREE.Vector3(Math.sin(car.yaw), 0, Math.cos(car.yaw)).multiplyScalar(-1.5);
      for (const sx of [-1, 1]) {
        const off = new THREE.Vector3(Math.cos(car.yaw), 0, -Math.sin(car.yaw)).multiplyScalar(sx * 0.85);
        const p = car.position.clone().add(back).add(off).addScaledVector(surf.normal, -0.2);
        this._emit(
          p,
          new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 1.6, (Math.random() - 0.5) * 3),
          1.1 + car.slip * 1.6,
          0.9 + Math.random() * 0.5,
          new THREE.Color(0.75, 0.75, 0.8)
        );
      }
    }
    if (car.boosting && Math.random() < 0.6) {
      const back = new THREE.Vector3(Math.sin(car.yaw), 0, Math.cos(car.yaw)).multiplyScalar(-2.6);
      const p = car.position.clone().add(back).addScaledVector(surf.normal, 0.05);
      this._emit(
        p,
        new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 0.8, (Math.random() - 0.5) * 2),
        0.8,
        0.45,
        new THREE.Color(0.35, 0.85, 1.0)
      );
    }
    this._updateParticles(dt);

    // shadow camera follows the car
    this.env.sun.position.set(car.position.x - 160, car.position.y + 170, car.position.z + 140);
    this.env.sun.target.position.copy(car.position);
    this.env.sun.target.updateMatrixWorld();

    this._updateCamera(dt, surf);
    this.audio.update(car);

    // HUD
    this._fpsAcc += dt;
    this._fpsN++;
    if (this._fpsAcc > 0.5) {
      this.fps = Math.round(this._fpsN / this._fpsAcc);
      this._fpsAcc = 0;
      this._fpsN = 0;
    }
    this.section = this._sectionName(car.position);
    this.hud.update({
      kmh: car.kmh,
      gear: car.gear,
      boost: car.boost,
      boosting: car.boosting,
      lap: Math.min(this.lap, TOTAL_LAPS),
      totalLaps: TOTAL_LAPS,
      current: this.state === 'racing' ? this.current : 0,
      best: this.best,
      last: this.last,
      section: this.section,
      camName: CAMERAS[this.camMode],
      livery: LIVERIES[car.liveryIndex].name,
      fps: this.fps,
    });
    this.hud.drawMap(car);

    this._jumboT += dt;
    if (this._jumboT > 0.2) {
      this._jumboT = 0;
      for (const s of this.env.screens) {
        drawJumbotron(s, { kmh: car.kmh, lap: `${Math.min(this.lap, TOTAL_LAPS)}/${TOTAL_LAPS}`, best: this.best ? fmtTime(this.best) : null });
      }
    }

    this.composer.render();
    requestAnimationFrame(() => this.frame());
  }
}

function fatal(err) {
  console.error(err);
  const l = document.getElementById('loading');
  if (!l) return;
  l.classList.remove('hidden');
  l.innerHTML = `<div class="lodTitle" style="font-size:34px;letter-spacing:6px;color:#ff5470">ENGINE FAULT</div>
    <div class="lodSub" style="max-width:640px;white-space:pre-wrap;text-align:left;color:#ffd0d8">${String(
      err && err.stack ? err.stack : err
    ).replace(/</g, '&lt;')}</div>`;
}

window.addEventListener('error', (e) => fatal(e.error || e.message));
window.addEventListener('unhandledrejection', (e) => fatal(e.reason));

try {
  const game = new Game();
  window.__game = game;
  game.frame();
} catch (err) {
  fatal(err);
}
