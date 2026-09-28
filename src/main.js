import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EagleModel } from './eagle/EagleModel.js';
import { EagleAnimations } from './eagle/EagleAnimations.js';
import { EagleAudio } from './eagle/EagleAudio.js';
import { ModelExporter } from './exporters/ModelExporter.js';
import { UIController } from './ui/UIController.js';

class EagleStudioApp {
  constructor() {
    this.container = document.getElementById('canvas-container');
    this.clock = new THREE.Clock();
    
    // Scene & Renderer
    this.initScene();
    this.initLighting();
    this.initEagle();
    this.initControls();
    this.initEnvironment();

    // Audio & Exporter & UI
    this.audio = new EagleAudio();
    this.exporter = new ModelExporter(this.eagle, this.animations);
    this.ui = new UIController(this);

    // Bind audio to screech animation
    this.animations.onScreechTrigger = () => {
      this.audio.playScreech();
      this.ui.showScreechBanner();
    };

    // Auto resize
    window.addEventListener('resize', () => this.onResize());

    // Start render loop
    this.animate();
  }

  initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0c111a);
    this.scene.fog = new THREE.FogExp2(0x0c111a, 0.04);

    this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.05, 100);
    this.camera.position.set(2.4, 1.4, 2.8);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);
  }

  initLighting() {
    this.lightsGroup = new THREE.Group();
    this.scene.add(this.lightsGroup);

    // Ambient Light
    this.ambientLight = new THREE.AmbientLight(0xd9e6f2, 0.8);
    this.lightsGroup.add(this.ambientLight);

    // Key Directional Sun Light
    this.sunLight = new THREE.DirectionalLight(0xfffaed, 2.5);
    this.sunLight.position.set(5, 8, 4);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.width = 2048;
    this.sunLight.shadow.mapSize.height = 2048;
    this.sunLight.shadow.camera.near = 0.5;
    this.sunLight.shadow.camera.far = 25;
    this.sunLight.shadow.camera.left = -3;
    this.sunLight.shadow.camera.right = 3;
    this.sunLight.shadow.camera.top = 3;
    this.sunLight.shadow.camera.bottom = -3;
    this.sunLight.shadow.bias = -0.0005;
    this.lightsGroup.add(this.sunLight);

    // Fill Light
    this.fillLight = new THREE.DirectionalLight(0x7ea0c4, 0.9);
    this.fillLight.position.set(-5, 2, -3);
    this.lightsGroup.add(this.fillLight);

    // Rim / Back Light (Hero feather rim highlight)
    this.rimLight = new THREE.DirectionalLight(0xffe0a3, 1.4);
    this.rimLight.position.set(0, 4, -5);
    this.lightsGroup.add(this.rimLight);
  }

  initEnvironment() {
    // Shadow catching ground with subtle grid
    const groundGeo = new THREE.PlaneGeometry(30, 30);
    const groundMat = new THREE.ShadowMaterial({ opacity: 0.35 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI * 0.5;
    ground.position.y = 0.0;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Atmospheric subtle particle dust
    const particleCount = 150;
    const particleGeo = new THREE.BufferGeometry();
    const particlePos = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount * 3; i += 3) {
      particlePos[i] = (Math.random() - 0.5) * 10;
      particlePos[i + 1] = Math.random() * 5;
      particlePos[i + 2] = (Math.random() - 0.5) * 10;
    }
    particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePos, 3));
    const particleMat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.03,
      transparent: true,
      opacity: 0.35
    });
    this.particles = new THREE.Points(particleGeo, particleMat);
    this.scene.add(this.particles);
  }

  initEagle() {
    this.eagle = new EagleModel({ plumage: 'bald' });
    this.scene.add(this.eagle.group);

    // Skeletal animations
    this.animations = new EagleAnimations(this.eagle);

    // Skeleton Helper for rig inspection
    this.skeletonHelper = new THREE.SkeletonHelper(this.eagle.group);
    this.skeletonHelper.visible = false;
    this.scene.add(this.skeletonHelper);
  }

  initControls() {
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 0.4;
    this.controls.maxDistance = 12.0;
    this.controls.maxPolarAngle = Math.PI * 0.52; // Don't go deep under ground
    this.controls.target.set(0, 1.15, 0);

    this.cameraMode = 'orbit';
    this.targetCamPos = null;
    this.targetControlsTarget = null;
  }

  setCameraPreset(presetKey) {
    this.cameraMode = presetKey;
    if (presetKey === 'orbit') {
      this.targetCamPos = new THREE.Vector3(2.4, 1.4, 2.8);
      this.targetControlsTarget = new THREE.Vector3(0, 1.15, 0);
    } else if (presetKey === 'chase') {
      this.targetCamPos = new THREE.Vector3(0, 1.6, -3.2);
      this.targetControlsTarget = new THREE.Vector3(0, 1.2, 0.5);
    } else if (presetKey === 'beak') {
      this.targetCamPos = new THREE.Vector3(0.35, 1.55, -0.7);
      this.targetControlsTarget = new THREE.Vector3(0, 1.5, -0.3);
    } else if (presetKey === 'talon') {
      this.targetCamPos = new THREE.Vector3(0.5, 0.75, 0.4);
      this.targetControlsTarget = new THREE.Vector3(0, 0.7, 0);
    } else if (presetKey === 'ground') {
      this.targetCamPos = new THREE.Vector3(1.8, 0.35, 1.8);
      this.targetControlsTarget = new THREE.Vector3(0, 0.8, 0);
    }
  }

  focusHotspot(spotKey) {
    const targets = {
      beak:      { cam: [0.25, 1.55, -0.6],  tgt: [0, 1.52, -0.2] },
      cere:      { cam: [0.15, 1.6, -0.55],  tgt: [0, 1.55, -0.15] },
      brow:      { cam: [0.3, 1.62, -0.5],   tgt: [0, 1.56, -0.1] },
      eyes:      { cam: [0.28, 1.58, -0.45], tgt: [0.08, 1.56, -0.1] },
      primaries: { cam: [1.6, 1.4, 0.2],     tgt: [0.9, 1.2, 0] },
      alula:     { cam: [0.8, 1.45, -0.3],   tgt: [0.5, 1.3, -0.1] },
      keel:      { cam: [0.0, 1.2, -1.2],    tgt: [0, 1.2, 0] },
      rectrices: { cam: [0.0, 1.2, 1.6],     tgt: [0, 1.1, 0.3] },
      hallux:    { cam: [0.35, 0.65, 0.4],   tgt: [0.1, 0.65, 0.1] },
      scales:    { cam: [0.4, 0.75, -0.2],   tgt: [0.1, 0.7, 0] }
    };

    const t = targets[spotKey];
    if (t) {
      this.targetCamPos = new THREE.Vector3(...t.cam);
      this.targetControlsTarget = new THREE.Vector3(...t.tgt);
    }
  }

  setPlumage(plumageKey) {
    this.eagle.setPlumage(plumageKey);
  }

  playAnimation(animKey) {
    this.animations.play(animKey);
    // Play sound on flap
    if (animKey === 'flap') {
      this.audio.playWingWhoosh();
    }
  }

  setWireframe(enabled) {
    this.eagle.group.traverse(child => {
      if (child.isMesh && child.material) {
        child.material.wireframe = enabled;
      }
    });
  }

  setSkeletonVisible(enabled) {
    this.skeletonHelper.visible = enabled;
  }

  setEnvironment(mode) {
    if (mode === 0) {
      // High Altitude Sunny Sky
      this.scene.background.set(0x0e1726);
      this.scene.fog.color.set(0x0e1726);
      this.sunLight.color.set(0xfffaed);
      this.sunLight.intensity = 2.5;
      this.fillLight.color.set(0x7ea0c4);
      this.rimLight.color.set(0xffe0a3);
    } else if (mode === 1) {
      // Golden Hour Sunset
      this.scene.background.set(0x210c08);
      this.scene.fog.color.set(0x210c08);
      this.sunLight.color.set(0xff7722);
      this.sunLight.intensity = 3.2;
      this.fillLight.color.set(0x8a3c5a);
      this.rimLight.color.set(0xffd56b);
    } else if (mode === 2) {
      // Dark Moody Studio
      this.scene.background.set(0x07080a);
      this.scene.fog.color.set(0x07080a);
      this.sunLight.color.set(0xffffff);
      this.sunLight.intensity = 1.8;
      this.fillLight.color.set(0x384b66);
      this.rimLight.color.set(0x60a5fa);
    } else if (mode === 3) {
      // Misty Mountain Forest
      this.scene.background.set(0x0f1a14);
      this.scene.fog.color.set(0x0f1a14);
      this.sunLight.color.set(0xd4ecd5);
      this.sunLight.intensity = 2.0;
      this.fillLight.color.set(0x2d4a3e);
      this.rimLight.color.set(0xa7f3d0);
    }
  }

  togglePlayPause() {
    this.animations.isPaused = !this.animations.isPaused;
    return this.animations.isPaused;
  }

  setPlaybackSpeed(speed) {
    this.animations.playbackSpeed = speed;
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    const delta = this.clock.getDelta();

    // Update skeletal biomechanical animations
    this.animations.update(delta);

    // Update skeleton helper if active
    if (this.skeletonHelper.visible) {
      this.skeletonHelper.update();
    }

    // Smooth camera lerp
    if (this.targetCamPos && this.targetControlsTarget) {
      this.camera.position.lerp(this.targetCamPos, 0.08);
      this.controls.target.lerp(this.targetControlsTarget, 0.08);

      if (this.camera.position.distanceTo(this.targetCamPos) < 0.01) {
        this.targetCamPos = null;
        this.targetControlsTarget = null;
      }
    }

    // Cinematic chase cam dynamic sway
    if (this.cameraMode === 'chase' && !this.targetCamPos) {
      const t = this.clock.getElapsedTime();
      this.camera.position.x = Math.sin(t * 0.5) * 0.4;
      this.camera.position.y = 1.6 + Math.cos(t * 0.6) * 0.15;
    }

    // Particle drift
    if (this.particles) {
      this.particles.rotation.y += 0.001;
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}

// Instantiate application on DOM load
window.addEventListener('DOMContentLoaded', () => {
  window.app = new EagleStudioApp();
});
