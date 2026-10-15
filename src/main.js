import * as THREE from 'three';
import { sound } from './audio.js';
import { ParticleSystem } from './particles.js';
import { Car } from './car.js';
import { HUD } from './hud.js';

import { Stage1Rooftops } from './stages/stage1_rooftops.js';
import { Stage2SewerPipe } from './stages/stage2_sewer_pipe.js';
import { Stage3DungRidge } from './stages/stage3_dung_ridge.js';
import { Stage4WaveBollards } from './stages/stage4_wave_bollards.js';
import { Stage5Monorail } from './stages/stage5_monorail.js';
import { Stage6MagneticCrane } from './stages/stage6_magnetic_crane.js';
import { Stage7DDayGauntlet } from './stages/stage7_dday_gauntlet.js';

class GameApp {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.uiLayer = document.getElementById('ui-layer');

    this.currentStageIndex = 1;
    this.currentStage = null;
    this.elapsedTime = 0;
    this.cameraMode = 0; // 0 = Chase, 1 = Hood, 2 = Orbit
    this.cameraShake = 0;

    // Keyboard state
    this.keys = {
      up: false,
      down: false,
      left: false,
      right: false,
      drift: false,
      boost: false
    };

    this.warpTimer = 0;
    this.isWarping = false;
    this.pendingStageIndex = null;

    this._initThree();
    this._initInput();
    this._initHUD();
    this._loadStage(1);

    this.clock = new THREE.Clock();
    this._animate();
  }

  _initThree() {
    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0c18);
    this.scene.fog = new THREE.FogExp2(0x0a0c18, 0.0075);

    // Camera
    this.camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.2, 800);
    this.camera.position.set(0, 5, 12);

    // Main Directional Sun / Moonlight
    this.dirLight = new THREE.DirectionalLight(0xffeedd, 2.2);
    this.dirLight.position.set(45, 60, 40);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.width = 2048;
    this.dirLight.shadow.mapSize.height = 2048;
    this.dirLight.shadow.camera.near = 10;
    this.dirLight.shadow.camera.far = 180;
    const shadowD = 55;
    this.dirLight.shadow.camera.left = -shadowD;
    this.dirLight.shadow.camera.right = shadowD;
    this.dirLight.shadow.camera.top = shadowD;
    this.dirLight.shadow.camera.bottom = -shadowD;
    this.scene.add(this.dirLight);

    // Ambient fill
    this.hemiLight = new THREE.HemisphereLight(0x7799bb, 0x111622, 1.2);
    this.scene.add(this.hemiLight);

    // Particle manager
    this.particles = new ParticleSystem(this.scene);

    // Car (Frontier PROTO-X Coupe)
    this.car = new Car(this.scene, this.particles);

    // Window resize
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  _initInput() {
    window.addEventListener('keydown', (e) => {
      sound.init();
      sound.resume();

      switch (e.code) {
        case 'KeyW':
        case 'ArrowUp':
          this.keys.up = true;
          break;
        case 'KeyS':
        case 'ArrowDown':
          this.keys.down = true;
          break;
        case 'KeyA':
        case 'ArrowLeft':
          this.keys.left = true;
          break;
        case 'KeyD':
        case 'ArrowRight':
          this.keys.right = true;
          break;
        case 'Space':
          this.keys.drift = true;
          e.preventDefault();
          break;
        case 'ShiftLeft':
        case 'ShiftRight':
          this.keys.boost = true;
          break;
        case 'KeyC':
          this.toggleCamera();
          break;
        case 'KeyR':
          this.resetCar();
          break;
        case 'KeyM':
          sound.toggleMute();
          break;
        case 'Escape':
          this.hud.toggleMenu();
          break;
      }
    });

    window.addEventListener('keyup', (e) => {
      switch (e.code) {
        case 'KeyW':
        case 'ArrowUp':
          this.keys.up = false;
          break;
        case 'KeyS':
        case 'ArrowDown':
          this.keys.down = false;
          break;
        case 'KeyA':
        case 'ArrowLeft':
          this.keys.left = false;
          break;
        case 'KeyD':
        case 'ArrowRight':
          this.keys.right = false;
          break;
        case 'Space':
          this.keys.drift = false;
          break;
        case 'ShiftLeft':
        case 'ShiftRight':
          this.keys.boost = false;
          break;
      }
    });
  }

  _initHUD() {
    this.hud = new HUD(
      this.uiLayer,
      (stageIdx) => this._loadStage(stageIdx),
      (hexColor) => this.car.setPaintColor(hexColor),
      () => this.resetCar(),
      () => this.toggleCamera()
    );
  }

  toggleCamera() {
    this.cameraMode = (this.cameraMode + 1) % 3;
    const modes = ['CHASE VIEW', 'HOOD CAM', 'ORBIT VIEW'];
    this.hud.showBanner(modes[this.cameraMode], 'Camera angle switched', 1.2);
  }

  resetCar() {
    if (this.currentStage) {
      this.car.respawn(this.currentStage.spawn.pos, this.currentStage.spawn.heading);
      this.hud.showBanner('VEHICLE RESET', 'Position restored to sector spawn', 1.2);
    }
  }

  _loadStage(stageIndex) {
    if (this.currentStage) {
      this.currentStage.destroy();
      this.currentStage = null;
    }

    this.currentStageIndex = stageIndex;

    switch (stageIndex) {
      case 1:
        this.currentStage = new Stage1Rooftops(this.scene, this.particles);
        break;
      case 2:
        this.currentStage = new Stage2SewerPipe(this.scene, this.particles);
        break;
      case 3:
        this.currentStage = new Stage3DungRidge(this.scene, this.particles);
        break;
      case 4:
        this.currentStage = new Stage4WaveBollards(this.scene, this.particles);
        break;
      case 5:
        this.currentStage = new Stage5Monorail(this.scene, this.particles);
        break;
      case 6:
        this.currentStage = new Stage6MagneticCrane(this.scene, this.particles);
        break;
      case 7:
        this.currentStage = new Stage7DDayGauntlet(this.scene, this.particles);
        break;
      default:
        this.currentStage = new Stage1Rooftops(this.scene, this.particles);
        this.currentStageIndex = 1;
        break;
    }

    // Update atmospheric lighting & fog
    this.scene.background.setHex(this.currentStage.skyColor);
    this.scene.fog.color.setHex(this.currentStage.fogColor);

    // Place car at stage start
    this.car.respawn(this.currentStage.spawn.pos, this.currentStage.spawn.heading);

    // Banner announcement
    this.hud.showBanner(
      `STAGE ${this.currentStageIndex}: ${this.currentStage.name}`,
      this.currentStage.subtitle,
      3.0
    );
  }

  _onPortalTrigger(targetStageIndex, targetName) {
    if (this.isWarping) return;
    this.isWarping = true;
    this.pendingStageIndex = targetStageIndex;
    this.warpTimer = 1.0;

    this.hud.showBanner('CHECKPOINT PORTAL', `WARPING TO ${targetName}...`, 2.0);
  }

  _onRaceFinish() {
    const mins = Math.floor(this.elapsedTime / 60);
    const secs = Math.floor(this.elapsedTime % 60);
    const millis = Math.floor((this.elapsedTime % 1) * 100);
    const timeStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(millis).padStart(2, '0')}`;

    this.hud.showVictory(timeStr, this.car.driftScore, this.car.health);
  }

  _updateCamera(dt) {
    if (this.cameraShake > 0) {
      this.cameraShake = Math.max(0, this.cameraShake - dt * 3.0);
    }

    const shakeX = (Math.random() - 0.5) * this.cameraShake * 0.4;
    const shakeY = (Math.random() - 0.5) * this.cameraShake * 0.4;

    const carPos = this.car.pos;
    const carHeading = this.car.heading;
    const fwdX = -Math.sin(carHeading);
    const fwdZ = -Math.cos(carHeading);

    // Target FOV: expands during nitro boost
    const baseFov = 65;
    const boostFov = this.car.isBoosting ? 82 : (baseFov + Math.min(Math.abs(this.car.speed) / 50.0, 1.0) * 8.0);
    this.camera.fov += (boostFov - this.camera.fov) * Math.min(dt * 6.0, 1.0);
    this.camera.updateProjectionMatrix();

    if (this.cameraMode === 0) {
      // Chase Camera (dynamic smooth follow)
      const chaseDist = 7.5 + Math.min(Math.abs(this.car.speed) / 30.0, 3.0);
      const chaseHeight = 2.8 + this.car.liftMultiplier * 2.0;

      const targetCamX = carPos.x - fwdX * chaseDist + shakeX;
      const targetCamY = carPos.y + chaseHeight + shakeY;
      const targetCamZ = carPos.z - fwdZ * chaseDist;

      this.camera.position.lerp(new THREE.Vector3(targetCamX, targetCamY, targetCamZ), Math.min(dt * 7.5, 1.0));

      // Look slightly ahead of car
      const lookTarget = carPos.clone().add(new THREE.Vector3(fwdX * 4.0, 1.2, fwdZ * 4.0));
      this.camera.lookAt(lookTarget);

    } else if (this.cameraMode === 1) {
      // Hood Camera
      const hoodOffset = new THREE.Vector3(0, 1.05, -0.6).applyAxisAngle(new THREE.Vector3(0, 1, 0), carHeading);
      this.camera.position.copy(carPos).add(hoodOffset).add(new THREE.Vector3(shakeX, shakeY, 0));

      const lookTarget = carPos.clone().add(new THREE.Vector3(fwdX * 25.0, 1.0, fwdZ * 25.0));
      this.camera.lookAt(lookTarget);

    } else if (this.cameraMode === 2) {
      // Orbit / Free Camera
      const orbitAngle = this.elapsedTime * 0.4;
      const orbitDist = 9.0;
      this.camera.position.set(
        carPos.x + Math.sin(orbitAngle) * orbitDist,
        carPos.y + 3.2,
        carPos.z + Math.cos(orbitAngle) * orbitDist
      );
      this.camera.lookAt(carPos.clone().add(new THREE.Vector3(0, 1.0, 0)));
    }

    // Directional light follows car
    this.dirLight.position.set(carPos.x + 40, carPos.y + 60, carPos.z + 40);
    this.dirLight.target.position.copy(carPos);
    this.dirLight.target.updateMatrixWorld();
  }

  _animate() {
    requestAnimationFrame(() => this._animate());

    const dt = Math.min(this.clock.getDelta(), 0.1);
    this.elapsedTime += dt;

    // Merge keyboard and touch input
    const combinedInput = {
      up: this.keys.up || this.hud.touchInput.up,
      down: this.keys.down || this.hud.touchInput.down,
      left: this.keys.left || this.hud.touchInput.left,
      right: this.keys.right || this.hud.touchInput.right,
      drift: this.keys.drift || this.hud.touchInput.drift,
      boost: this.keys.boost || this.hud.touchInput.boost
    };

    // Update Car physics
    const trackQuery = (x, z) => this.currentStage ? this.currentStage.querySurface(x, z) : { height: 0, normal: new THREE.Vector3(0, 1, 0) };
    this.car.update(dt, combinedInput, trackQuery);

    // Update active stage
    if (this.currentStage) {
      if (this.currentStageIndex === 7) {
        this.currentStage.update(dt, this.car, () => this._onRaceFinish());
      } else {
        this.currentStage.update(dt, this.car, (targetStage, label) => this._onPortalTrigger(targetStage, label));
      }
    }

    // Warp transition timer
    if (this.isWarping) {
      this.warpTimer -= dt;
      if (this.warpTimer <= 0) {
        this.isWarping = false;
        this.particles.triggerWarp(false);
        this._loadStage(this.pendingStageIndex);
      }
    }

    // Update particles
    const fwdDir = new THREE.Vector3(-Math.sin(this.car.heading), 0, -Math.cos(this.car.heading));
    this.particles.update(dt, this.car.pos, fwdDir);

    // Camera follow & shake
    this._updateCamera(dt);

    // HUD telemetry
    if (this.currentStage) {
      this.hud.update(
        this.car,
        this.currentStageIndex,
        this.currentStage.name,
        this.currentStage.subtitle,
        this.elapsedTime
      );
    }

    // Render 3D Scene
    this.renderer.render(this.scene, this.camera);
  }
}

// Start application on page load
window.addEventListener('DOMContentLoaded', () => {
  new GameApp();
});
