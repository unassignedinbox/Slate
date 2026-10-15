import * as THREE from 'three';
import { sound } from './audio.js';

export class Portal {
  constructor(scene, particles, position, targetStageIndex, label = 'STAGE PORTAL') {
    this.scene = scene;
    this.particles = particles;
    this.targetStageIndex = targetStageIndex;
    this.label = label;
    this.radius = 4.2;
    this.active = true;

    this.group = new THREE.Group();
    this.group.position.copy(position);
    this.scene.add(this.group);

    this._buildMesh();
  }

  _buildMesh() {
    // Outer Arch / Ring
    const outerTorusGeom = new THREE.TorusGeometry(this.radius, 0.45, 16, 48);
    const outerMat = new THREE.MeshStandardMaterial({
      color: 0x1a1a24,
      metalness: 0.95,
      roughness: 0.2
    });
    this.outerRing = new THREE.Mesh(outerTorusGeom, outerMat);
    this.outerRing.position.y = this.radius;
    this.group.add(this.outerRing);

    // Glowing Neon Energy Ring
    const neonTorusGeom = new THREE.TorusGeometry(this.radius * 0.95, 0.12, 12, 48);
    const neonMat = new THREE.MeshStandardMaterial({
      color: 0x00f0ff,
      emissive: 0x00d4ff,
      emissiveIntensity: 3.5,
      roughness: 0.1
    });
    this.neonRing = new THREE.Mesh(neonTorusGeom, neonMat);
    this.neonRing.position.y = this.radius;
    this.group.add(this.neonRing);

    // Counter-spinning inner energetic torus
    const innerTorusGeom = new THREE.TorusGeometry(this.radius * 0.82, 0.08, 12, 36);
    const innerMat = new THREE.MeshStandardMaterial({
      color: 0xaa22ff,
      emissive: 0x8800ff,
      emissiveIntensity: 2.8,
      roughness: 0.1
    });
    this.innerRing = new THREE.Mesh(innerTorusGeom, innerMat);
    this.innerRing.position.y = this.radius;
    this.group.add(this.innerRing);

    // Event Horizon Vortex Disc
    const discGeom = new THREE.CircleGeometry(this.radius * 0.88, 32);
    this.discMat = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        color1: { value: new THREE.Color(0x00e1ff) },
        color2: { value: new THREE.Color(0x7b00ff) }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform vec3 color1;
        uniform vec3 color2;
        varying vec2 vUv;
        void main() {
          vec2 centered = vUv - vec2(0.5);
          float dist = length(centered) * 2.0;
          if (dist > 1.0) discard;

          float angle = atan(centered.y, centered.x);
          float swirl = sin(dist * 18.0 - time * 6.0 + angle * 3.0);
          float rings = sin(dist * 30.0 - time * 8.0);

          vec3 col = mix(color1, color2, sin(dist * 3.14 - time * 2.0) * 0.5 + 0.5);
          col += vec3(0.3) * swirl;
          float alpha = smoothstep(1.0, 0.2, dist) * (0.8 + 0.2 * rings);

          gl_FragColor = vec4(col, alpha);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    this.vortex = new THREE.Mesh(discGeom, this.discMat);
    this.vortex.position.y = this.radius;
    this.group.add(this.vortex);

    // Pulsating Point Light
    this.light = new THREE.PointLight(0x00d4ff, 3.5, 25);
    this.light.position.set(0, this.radius, 0);
    this.group.add(this.light);

    // Floating Checkpoint Beacon Banner
    const beaconGeom = new THREE.CylinderGeometry(0.04, 0.04, 18, 8);
    const beaconMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.45
    });
    this.beacon = new THREE.Mesh(beaconGeom, beaconMat);
    this.beacon.position.y = 9;
    this.group.add(this.beacon);
  }

  update(dt, carPos, onTrigger) {
    if (!this.active) return;

    this.discMat.uniforms.time.value += dt;

    // Spin rings in opposite directions
    this.neonRing.rotation.z += dt * 1.8;
    this.innerRing.rotation.z -= dt * 2.5;

    // Pulse light
    this.light.intensity = 2.5 + Math.sin(this.discMat.uniforms.time.value * 4.0) * 1.2;

    // Check collision with car
    const dx = carPos.x - this.group.position.x;
    const dy = carPos.y - (this.group.position.y + this.radius);
    const dz = carPos.z - this.group.position.z;
    const distSq = dx * dx + dz * dz;

    if (distSq < this.radius * this.radius * 1.2 && Math.abs(dy) < this.radius * 1.4) {
      this.active = false;
      sound.playPortalWarp();
      this.particles.triggerWarp(true);
      if (onTrigger) {
        onTrigger(this.targetStageIndex, this.label);
      }
    }
  }

  destroy() {
    this.scene.remove(this.group);
  }
}
